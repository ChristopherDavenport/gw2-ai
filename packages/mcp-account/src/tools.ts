import {
  ALL_PERMISSIONS,
  Gw2ApiError,
  PERMISSION_HELP,
  SECTIONS,
  TTL,
  buildRecipeTree,
  catalog,
  collectHoldings,
  createContext,
  fmt,
  missingPermissions,
  nameOf,
  renderRecipeTree,
  tokenInfo,
  type AccountMaterial,
  type Character,
  type EquipmentSlot,
  type Gw2Client,
  type Item,
  type LegendaryArmoryEntry,
  type Permission,
} from '@gw2-ai/core';
import { accountPath, checkParams, compactJson } from './paths.js';

const { day, hours, num, table, text } = fmt;

type Named = { id: number; name: string };

/** What each tool needs, for gw2_key_info and permission errors. */
export const TOOL_PERMISSIONS: Record<string, { required: Permission[]; optional: Permission[]; note: string }> = {
  gw2_find_item: { required: ['inventories'], optional: ['characters', 'unlocks', 'builds'], note: 'characters adds bags, unlocks adds the legendary armory, builds adds equipped gear' },
  gw2_character: { required: ['characters'], optional: ['builds', 'inventories'], note: 'builds adds build and equipment, inventories adds bags' },
  gw2_shopping_list: { required: ['inventories'], optional: ['characters'], note: 'characters adds character bags to the holdings' },
};

export class MissingPermissionError extends Error {}

async function requirePermissions(client: Gw2Client, tool: string): Promise<Permission[]> {
  const info = await tokenInfo(client);
  const spec = TOOL_PERMISSIONS[tool];
  if (spec) {
    const missing = missingPermissions(info, spec.required);
    if (missing.length) {
      throw new MissingPermissionError(
        `${tool} needs the \`${missing.join('`, `')}\` permission, which the API key "${info.name}" lacks. ` +
          'Create a key with it at https://account.arena.net/applications and save it with `gw2-mcp-account set-key`.',
      );
    }
  }
  return info.permissions;
}

// ---------------------------------------------------------------- key info

export async function keyInfo(client: Gw2Client): Promise<string> {
  const info = await tokenInfo(client);
  const have = new Set(info.permissions);
  const permRows = ALL_PERMISSIONS.map((p) => [p, have.has(p) ? 'yes' : 'no', PERMISSION_HELP[p]]);
  const sectionRows = SECTIONS.map((s) => {
    const missing = missingPermissions(info, s.permissions);
    return [s.id, missing.length ? `skipped (needs ${missing.join(', ')})` : 'available', s.summary];
  });
  const toolRows = Object.entries(TOOL_PERMISSIONS).map(([tool, spec]) => {
    const missing = missingPermissions(info, spec.required);
    const missingOpt = missingPermissions(info, spec.optional);
    const status = missing.length
      ? `unavailable (needs ${missing.join(', ')})`
      : missingOpt.length
        ? `partial (without ${missingOpt.join(', ')})`
        : 'full';
    return [tool, status, spec.note];
  });
  const lines = [
    `# API key "${text(info.name)}"`,
    '',
    `- **Type:** ${info.type ?? 'APIKey'}${info.expires_at ? ` · **Expires:** ${info.expires_at}` : ''}`,
    `- **Permissions:** ${info.permissions.join(', ') || 'none'}`,
    '',
    '## Permissions',
    '',
    table(['Permission', 'Granted', 'Unlocks'], permRows),
    '',
    '## gw2_account_report sections',
    '',
    table(['Section id', 'Status', 'What it answers'], sectionRows),
    '',
    '## Other tools',
    '',
    ...toolRows.map(([tool, status, note]) => `- **${tool}**: ${status}. ${note}.`),
    '',
    'gw2_account_get works for any endpoint whose permission the key has.',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------- find item

export async function findItem(client: Gw2Client, query: string | undefined, itemId: number | undefined, limit: number): Promise<string> {
  const perms = new Set(await requirePermissions(client, 'gw2_find_item'));
  const ctx = createContext(client, { valuation: false });
  const [held, mats, armory, chars] = await Promise.all([
    collectHoldings(ctx),
    ctx.account<AccountMaterial[]>('/v2/account/materials').catch(() => undefined),
    perms.has('unlocks') ? ctx.account<LegendaryArmoryEntry[]>('/v2/account/legendaryarmory').catch(() => undefined) : undefined,
    perms.has('characters') ? ctx.account<Character[]>('/v2/characters', { ids: 'all' }).catch(() => undefined) : undefined,
  ]);

  const where = new Map<number, Map<string, number>>();
  const add = (id: number, loc: string, n: number) => {
    if (n <= 0) return;
    const m = where.get(id) ?? new Map<string, number>();
    m.set(loc, (m.get(loc) ?? 0) + n);
    where.set(id, m);
  };
  for (const h of held.holdings.values()) for (const [loc, n] of h.where) add(h.id, loc, n);
  for (const m of mats ?? []) add(m.id, 'Material storage', m.count);
  for (const a of armory ?? []) add(a.id, 'Legendary armory', a.count);
  for (const ch of chars ?? []) {
    for (const e of ch.equipment ?? []) {
      if (e.location === 'LegendaryArmory' || e.location === 'EquippedFromLegendaryArmory') continue;
      add(e.id, `${ch.name} (equipped)`, e.count || 1);
    }
  }

  const checked = [
    'bank',
    'shared inventory slots',
    perms.has('characters') ? 'character bags and equipped gear' : null,
    mats ? 'material storage' : null,
    armory ? 'legendary armory' : null,
  ].filter(Boolean);
  const notChecked = [
    !perms.has('characters') ? 'character bags/equipment (needs `characters`)' : null,
    !armory ? 'legendary armory (needs `unlocks`)' : null,
    'trading post delivery box',
    'guild storage',
  ].filter(Boolean);
  const footer = `\n\nChecked: ${checked.join(', ')}. Not checked: ${notChecked.join(', ')}.${held.notes.length ? ` Notes: ${held.notes.join('; ')}.` : ''}`;

  let ids: number[];
  let defs: Map<number, Item>;
  if (itemId !== undefined) {
    ids = [itemId];
    defs = await catalog.items(client, ids);
  } else {
    defs = await catalog.items(client, where.keys());
    const q = (query ?? '').toLowerCase();
    ids = [...where.keys()].filter((id) => defs.get(id)?.name.toLowerCase().includes(q));
    ids.sort((a, b) => nameOf(defs, a).localeCompare(nameOf(defs, b)));
  }
  const label = itemId !== undefined ? `${nameOf(defs, itemId)} (${itemId})` : `"${query}"`;
  const found = ids.filter((id) => where.has(id));
  if (!found.length) {
    return `# Where is ${label}?\n\nThe account holds none${itemId === undefined ? ' of any item whose name contains that text' : ''}.${footer}`;
  }
  const rows = found.slice(0, limit).map((id) => {
    const locs = [...where.get(id)!].sort((a, b) => b[1] - a[1]);
    const total = locs.reduce((s, [, n]) => s + n, 0);
    return [nameOf(defs, id), id, defs.get(id)?.rarity, num(total), locs.map(([l, n]) => `${l}: ${num(n)}`).join('; ')];
  });
  const more = found.length > limit ? `\n\nShowing ${limit} of ${found.length} matching items; narrow the query or raise \`limit\`.` : '';
  return `# Where is ${label}?\n\n${table(['Item', 'Item id', 'Rarity', 'Total', 'Locations'], rows)}${more}${footer}`;
}

// ---------------------------------------------------------------- character

const SLOT_ORDER = [
  'Helm', 'Shoulders', 'Coat', 'Gloves', 'Leggings', 'Boots',
  'WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2',
  'Backpack', 'Accessory1', 'Accessory2', 'Amulet', 'Ring1', 'Ring2', 'Relic',
  'HelmAquatic', 'WeaponAquaticA', 'WeaponAquaticB',
  'Sickle', 'Axe', 'Pick', 'PowerCore', 'SensoryArray', 'ServiceChip', 'FishingRod', 'FishingBait', 'FishingLure',
];

function slotRank(slot: string | undefined): number {
  const i = SLOT_ORDER.indexOf(slot ?? '');
  return i < 0 ? SLOT_ORDER.length : i;
}

export async function character(client: Gw2Client, name: string): Promise<string> {
  const perms = new Set(await requirePermissions(client, 'gw2_character'));
  let ch: Character;
  try {
    ch = await client.get<Character>(`/v2/characters/${encodeURIComponent(name.trim())}`, { ttlMs: TTL.account });
  } catch (err) {
    if (err instanceof Gw2ApiError && err.status === 404) {
      const names = await client.get<string[]>('/v2/characters', { ttlMs: TTL.account }).catch(() => []);
      return `No character named "${text(name)}" on this account. Characters: ${names.map(text).join(', ') || '(none visible)'}. Names are case-sensitive.`;
    }
    throw err;
  }

  const out: string[] = [`# ${text(ch.name)}`, ''];
  const missing: string[] = [];
  if (!perms.has('builds')) missing.push('`builds` (active build and equipment)');
  if (!perms.has('inventories')) missing.push('`inventories` (bags)');

  // Core info.
  const [guild, title] = await Promise.all([
    ch.guild ? client.get<{ name: string; tag: string }>(`/v2/guild/${ch.guild}`, { auth: false }).catch(() => undefined) : undefined,
    ch.title ? client.getMany<Named>('/v2/titles', [ch.title]).then((m) => m.get(ch.title!)).catch(() => undefined) : undefined,
  ]);
  out.push(
    `- **Profession:** ${ch.profession} · **Level:** ${ch.level} · **Race:** ${ch.race} (${ch.gender})`,
    `- **Played:** ${hours(ch.age)} · **Deaths:** ${num(ch.deaths)} · **Created:** ${day(ch.created)}`,
  );
  if (guild) out.push(`- **Representing:** ${text(guild.name)} \\[${text(guild.tag)}\\]`);
  if (title) out.push(`- **Title:** ${text(title.name)}`);
  if (missing.length) out.push(`- **Not shown:** the API key lacks ${missing.join(' and ')}.`);

  if (ch.crafting.length) {
    out.push('', '## Crafting', '', table(['Discipline', 'Rating', 'Active'], ch.crafting.map((c) => [c.discipline, c.rating, c.active ? 'yes' : 'no'])));
  }

  const build = ch.build_tabs?.find((t) => t.is_active) ?? ch.build_tabs?.find((t) => t.tab === ch.active_build_tab);
  if (build) out.push('', ...(await renderBuild(client, build.build, build.tab)));

  const equipped = (ch.equipment ?? []).filter(
    (e) =>
      (!e.location || e.location.startsWith('Equipped')) &&
      (!e.tabs || ch.active_equipment_tab === undefined || e.tabs.includes(ch.active_equipment_tab)),
  );
  if (equipped.length) out.push('', ...(await renderEquipment(client, equipped, ch.active_equipment_tab)));

  if (ch.bags) out.push('', ...(await renderBags(client, ch)));
  return out.join('\n');
}

async function renderBuild(client: Gw2Client, build: NonNullable<Character['build_tabs']>[number]['build'], tab: number): Promise<string[]> {
  const specIds = build.specializations.map((s) => s.id).filter((x): x is number => !!x);
  const traitIds = build.specializations.flatMap((s) => s.traits).filter((x): x is number => !!x);
  const sk = build.skills;
  const skillIds = sk ? [sk.heal, ...sk.utilities, sk.elite].filter((x): x is number => !!x) : [];
  const legendIds = (build.legends ?? []).filter((x): x is string => !!x);
  const petIds = (build.pets?.terrestrial ?? []).filter((x): x is number => !!x);

  const [specs, traits, legends, pets] = await Promise.all([
    client.getMany<Named & { elite: boolean }>('/v2/specializations', specIds),
    client.getMany<Named>('/v2/traits', traitIds),
    legendIds.length ? client.getMany<{ id: string; swap: number }>('/v2/legends', legendIds) : new Map<string, { id: string; swap: number }>(),
    petIds.length ? client.getMany<Named>('/v2/pets', petIds) : new Map<number, Named>(),
  ]);
  const legendSkillIds = [...legends.values()].map((l) => l.swap).filter(Boolean);
  const skills = await client.getMany<Named>('/v2/skills', [...skillIds, ...legendSkillIds]);
  const skillName = (id: number | null) => (id ? nameOf(skills, id) : '—');

  const lines = [`## Active build (tab ${tab}${build.name ? `: ${text(build.name)}` : ''})`, ''];
  const rows = build.specializations
    .filter((s) => s.id)
    .map((s) => [
      `${nameOf(specs, s.id!)}${specs.get(s.id!)?.elite ? ' (elite)' : ''}`,
      s.id,
      s.traits.map((t) => (t ? nameOf(traits, t) : '—')).join(' / '),
      s.traits.map((t) => t ?? '—').join(', '),
    ]);
  lines.push(table(['Specialization', 'Spec id', 'Major traits (adept / master / grandmaster)', 'Trait ids'], rows));
  if (sk) {
    lines.push(
      '',
      `- **Heal:** ${skillName(sk.heal)} · **Utilities:** ${sk.utilities.map(skillName).join(', ')} · **Elite:** ${skillName(sk.elite)}` +
        ` (skill ids ${[sk.heal, ...sk.utilities, sk.elite].map((x) => x ?? '—').join(', ')})`,
    );
  }
  if (legendIds.length) {
    lines.push(`- **Legends:** ${legendIds.map((id) => { const l = legends.get(id); return l ? `${nameOf(skills, l.swap)} (${id})` : id; }).join(', ')}`);
  }
  if (petIds.length) lines.push(`- **Pets:** ${petIds.map((id) => `${nameOf(pets, id)} (${id})`).join(', ')}`);
  return lines;
}

async function renderEquipment(client: Gw2Client, equipped: EquipmentSlot[], tab: number | undefined): Promise<string[]> {
  const upgradeIds = equipped.flatMap((e) => [...(e.upgrades ?? []), ...(e.infusions ?? [])]);
  const items = await catalog.items(client, [...equipped.map((e) => e.id), ...upgradeIds]);
  const statIds = new Set<number>();
  for (const e of equipped) {
    const id = e.stats?.id ?? ((items.get(e.id)?.details?.infix_upgrade as { id?: number } | undefined)?.id);
    if (id) statIds.add(id);
  }
  const stats = await client.getMany<Named>('/v2/itemstats', statIds);
  const rows = [...equipped]
    .sort((a, b) => slotRank(a.slot) - slotRank(b.slot))
    .map((e) => {
      const item = items.get(e.id);
      const statId = e.stats?.id ?? ((item?.details?.infix_upgrade as { id?: number } | undefined)?.id);
      const upgrades = (e.upgrades ?? []).map((u) => nameOf(items, u));
      const infusions = (e.infusions ?? []).map((u) => nameOf(items, u));
      const extras = [...upgrades, ...(infusions.length ? [`infusions: ${infusions.join(', ')}`] : [])].join('; ');
      return [e.slot ?? '—', item?.name ?? `#${e.id}`, e.id, item?.rarity, statId ? nameOf(stats, statId) : '—', extras || '—'];
    });
  return [
    `## Equipment${tab !== undefined ? ` (tab ${tab})` : ''}`,
    '',
    table(['Slot', 'Item', 'Item id', 'Rarity', 'Stats', 'Upgrades / infusions'], rows),
  ];
}

async function renderBags(client: Gw2Client, ch: Character): Promise<string[]> {
  const bags = (ch.bags ?? []).filter((b) => b !== null);
  const contents = bags.flatMap((b) => b.inventory.filter((s) => s !== null));
  const defs = await catalog.items(client, [...bags.map((b) => b.id), ...contents.map((s) => s.id)]);
  const rows = bags.map((b) => {
    const used = b.inventory.filter((s) => s !== null).length;
    return [nameOf(defs, b.id), b.id, b.size, used, b.size - used];
  });
  const size = bags.reduce((s, b) => s + b.size, 0);
  const used = contents.length;

  const stacks = new Map<number, number>();
  for (const s of contents) stacks.set(s.id, (stacks.get(s.id) ?? 0) + s.count);
  const top = [...stacks]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id, n]) => `${nameOf(defs, id)} ×${num(n)} (${id})`)
    .join(', ');
  return [
    '## Bags',
    '',
    `${used} of ${size} slots used (${size - used} free).`,
    '',
    table(['Bag', 'Item id', 'Slots', 'Used', 'Free'], rows),
    ...(top ? ['', `**Largest stacks:** ${top}. Use gw2_find_item to locate a specific item.`] : []),
  ];
}

// ---------------------------------------------------------------- shopping list

export async function shoppingList(client: Gw2Client, itemId: number, quantity: number): Promise<string> {
  await requirePermissions(client, 'gw2_shopping_list');
  const ctx = createContext(client, { valuation: false });
  const [held, mats] = await Promise.all([
    collectHoldings(ctx),
    ctx.account<AccountMaterial[]>('/v2/account/materials').catch(() => [] as AccountMaterial[]),
  ]);
  const have = new Map<number, number>();
  for (const h of held.holdings.values()) have.set(h.id, (have.get(h.id) ?? 0) + h.count);
  for (const m of mats) if (m.count > 0) have.set(m.id, (have.get(m.id) ?? 0) + m.count);

  const tree = await buildRecipeTree(client, itemId, quantity, { have });
  const md = renderRecipeTree(tree, {
    title: `Shopping list: ${num(quantity)} × ${tree.name} (${itemId})`,
    raw: false,
  });
  const notes = held.notes.length ? ` Notes: ${held.notes.join('; ')}.` : '';
  return (
    md +
    `\nHoldings counted: bank, shared slots, character bags, material storage (${num(have.size)} distinct items). ` +
    `Equipped gear, wallet currencies, the delivery box and guild storage are not subtracted.${notes} Costs use current TP sell listings.\n`
  );
}

// ---------------------------------------------------------------- escape hatch

export async function accountGet(
  client: Gw2Client,
  path: string,
  params: Record<string, string | number | boolean> | undefined,
  maxChars: number,
): Promise<string> {
  const clean = accountPath(path);
  const body = await client.get(clean, { params: checkParams(params), auth: true, ttlMs: 30_000 });
  const json = compactJson(body);
  const text = `GET ${clean}\n\n\`\`\`json\n${json}\n\`\`\``;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Truncated: showing ${maxChars.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters. Use params such as page and page_size, or a narrower path.]`;
}
