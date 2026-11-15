import {
  Gw2ApiError,
  type Character,
  type CharacterBuild,
  type CharacterBuildTab,
  type CharacterEquipmentPiece,
  type CharacterEquipmentPvp,
  type CharacterEquipmentSlot,
  type CharacterEquipmentTab,
  type CharacterSkillBar,
  type Gw2Client,
  type Item,
  type Permission,
} from '@gw2-ai/client';
import { infixUpgrade, nameOf } from './catalog.js';
import { day, hours, num, table, text } from './format.js';
import { ACCOUNT } from './report/context.js';

export interface CharacterOptions {
  /**
   * `all` (default): every build and equipment template, so a model can set
   * up or compare any of them. `active`: only the templates in use.
   */
  templates?: 'all' | 'active';
  /** Markdown level of the character's subsection headings. Default 2. */
  headingLevel?: number;
}

/** The account has no character with the requested name. */
export class CharacterNotFoundError extends Error {
  constructor(
    readonly requested: string,
    /** Names the key can see, for suggesting the right one. */
    readonly names: readonly string[],
  ) {
    super(
      `No character named "${requested}" on this account. Characters: ${names.join(', ') || '(none visible)'}. Names are case-sensitive.`,
    );
  }
}

/** One full character by exact name. Throws CharacterNotFoundError on a 404. */
export async function fetchCharacter(client: Gw2Client, name: string): Promise<Character> {
  try {
    return await client.get('/v2/characters/:id', { path: { id: name.trim() }, ...ACCOUNT });
  } catch (err) {
    if (err instanceof Gw2ApiError && err.status === 404) {
      const names = await client.ids('/v2/characters', ACCOUNT).catch(() => []);
      throw new CharacterNotFoundError(name, names);
    }
    throw err;
  }
}

const SLOT_ORDER: readonly CharacterEquipmentSlot[] = [
  'Helm', 'Shoulders', 'Coat', 'Gloves', 'Leggings', 'Boots',
  'WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2',
  'Backpack', 'Accessory1', 'Accessory2', 'Amulet', 'Ring1', 'Ring2', 'Relic',
  'HelmAquatic', 'WeaponAquaticA', 'WeaponAquaticB',
  'Sickle', 'Axe', 'Pick', 'PowerCore', 'SensoryArray', 'ServiceChip', 'FishingRod', 'FishingBait', 'FishingLure',
];

function slotRank(slot: CharacterEquipmentSlot | undefined): number {
  const i = slot ? SLOT_ORDER.indexOf(slot) : -1;
  return i < 0 ? SLOT_ORDER.length : i;
}

const present = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;

/** An equipped item from /equipment or from an equipment template. */
type GearPiece = CharacterEquipmentPiece & { slot?: CharacterEquipmentSlot };

/**
 * Markdown for one character: core facts, crafting, build templates (trait
 * and skill names), equipment templates (items, stat sets, runes, sigils,
 * infusions, PvP gear) and bags. Parts the key's `permissions` can't read are
 * named in a "Not shown" line rather than silently left out.
 */
export async function renderCharacter(
  client: Gw2Client,
  ch: Character,
  permissions: readonly Permission[],
  options: CharacterOptions = {},
): Promise<string> {
  const h = '#'.repeat(options.headingLevel ?? 2);
  const activeOnly = options.templates === 'active';
  const perms = new Set(permissions);

  const buildTabs = (ch.build_tabs ?? []).filter((t) => !activeOnly || isActiveBuild(ch, t));
  const equipmentTabs = (ch.equipment_tabs ?? []).filter((t) => !activeOnly || isActiveEquipment(ch, t));
  const loose = looseGear(ch);
  // Older or partial responses carry `equipment` without `equipment_tabs`.
  const equippedFallback = ch.equipment_tabs ? [] : (ch.equipment ?? []).filter((e) => !e.location || e.location.startsWith('Equipped'));
  const pieces: GearPiece[] = [...equipmentTabs.flatMap((t) => t.equipment), ...loose, ...equippedFallback];
  const bags = (ch.bags ?? []).filter(present);
  const bagContents = bags.flatMap((b) => b.inventory.filter(present));

  // Fetch every name the templates need in one round of bulk requests.
  const builds = buildTabs.map((t) => t.build);
  const bars = builds.flatMap((b) => [b.skills, b.aquatic_skills].filter(present));
  const legendIds = builds.flatMap((b) => [...(b.legends ?? []), ...(b.aquatic_legends ?? [])]).filter(present);
  const pvp = equipmentTabs.map((t) => t.equipment_pvp).filter(present);
  const [guild, title, specs, traits, legends, pets, amulets, items] = await Promise.all([
    ch.guild ? client.get('/v2/guild/:id', { path: { id: ch.guild } }).catch(() => undefined) : undefined,
    ch.title ? client.one('/v2/titles', ch.title).catch(() => undefined) : undefined,
    client.many('/v2/specializations', builds.flatMap((b) => b.specializations.map((s) => s.id)).filter(present)),
    client.many('/v2/traits', builds.flatMap((b) => b.specializations.flatMap((s) => s.traits)).filter(present)),
    client.many('/v2/legends', legendIds),
    client.many('/v2/pets', builds.flatMap((b) => [...(b.pets?.terrestrial ?? []), ...(b.pets?.aquatic ?? [])]).filter(present)),
    client.many('/v2/pvp/amulets', pvp.map((p) => p.amulet).filter(present)),
    client.many('/v2/items', [
      ...pieces.flatMap((p) => [p.id, ...(p.upgrades ?? []), ...(p.infusions ?? [])]),
      ...pvp.flatMap((p) => [p.rune, ...p.sigils]).filter(present),
      ...bags.map((b) => b.id),
      ...bagContents.map((s) => s.id),
    ]),
  ]);
  const statIdOf = (p: CharacterEquipmentPiece): number | undefined => {
    const item = items.get(p.id);
    return p.stats?.id ?? (item ? infixUpgrade(item)?.id : undefined);
  };
  const [skills, stats] = await Promise.all([
    client.many('/v2/skills', [
      ...bars.flatMap((s) => [s.heal, ...s.utilities, s.elite]).filter(present),
      ...[...legends.values()].map((l) => l.swap),
    ]),
    client.many('/v2/itemstats', pieces.map(statIdOf).filter(present)),
  ]);
  const name = {
    skill: (id: number | null | undefined) => (id ? nameOf(skills, id) : '—'),
    trait: (id: number | null) => (id ? nameOf(traits, id) : '—'),
    pet: (id: number | null) => (id ? `${nameOf(pets, id)} (${id})` : '—'),
    legend: (id: string | null) => {
      if (!id) return '—';
      const l = legends.get(id);
      return l ? `${nameOf(skills, l.swap)} (${id})` : id;
    },
    item: (id: number | null) => (id ? nameOf(items, id) : '—'),
    stats: (p: CharacterEquipmentPiece) => {
      const id = statIdOf(p);
      return id ? nameOf(stats, id) : '—';
    },
  };

  // Core facts.
  const out: string[] = [
    `- **Profession:** ${ch.profession} · **Level:** ${ch.level} · **Race:** ${ch.race} (${ch.gender})`,
    `- **Played:** ${hours(ch.age)} · **Deaths:** ${num(ch.deaths)} · **Created:** ${day(ch.created)}`,
  ];
  if (guild) out.push(`- **Representing:** ${text(guild.name)} \\[${text(guild.tag)}\\]`);
  if (title) out.push(`- **Title:** ${text(title.name)}`);
  const templates = templateSummary(ch, activeOnly);
  if (templates) out.push(`- **Templates:** ${templates}`);
  const missing: string[] = [];
  if (!perms.has('builds')) missing.push('`builds` (build and equipment templates)');
  if (!perms.has('inventories')) missing.push('`inventories` (bags)');
  if (missing.length) out.push(`- **Not shown:** the API key lacks ${missing.join(' and ')}.`);

  if (ch.crafting.length) {
    out.push('', `${h} Crafting`, '', table(['Discipline', 'Rating', 'Active'], ch.crafting.map((c) => [c.discipline, c.rating, c.active ? 'yes' : 'no'])));
  }

  // Build templates. Identical templates point at the first copy instead of repeating it.
  const seenBuilds = new Map<string, number>();
  for (const tab of buildTabs) {
    out.push('', `${h} ${tabHeading('Build', tab.tab, tab.build.name, isActiveBuild(ch, tab))}`, '');
    const key = buildSignature(tab.build);
    const same = seenBuilds.get(key);
    if (same !== undefined) {
      out.push(`Same build as build template ${same}.`);
      continue;
    }
    seenBuilds.set(key, tab.tab);
    out.push(...renderBuild(tab.build, specs, name));
  }

  // Equipment templates.
  const seenGear = new Map<string, number>();
  for (const tab of equipmentTabs) {
    out.push('', `${h} ${tabHeading('Equipment', tab.tab, tab.name, isActiveEquipment(ch, tab))}`, '');
    const key = gearSignature(tab);
    const same = seenGear.get(key);
    if (same !== undefined) {
      out.push(`Same gear as equipment template ${same}.`);
      continue;
    }
    seenGear.set(key, tab.tab);
    out.push(tab.equipment.length ? gearTable(tab.equipment, items, name) : '_Empty._');
    const pvpLine = renderPvp(tab.equipment_pvp, amulets, name);
    if (pvpLine) out.push('', pvpLine);
  }
  if (loose.length) {
    out.push('', `${h} Other equipped gear (not in any template)`, '', gearTable(loose, items, name));
  }
  if (equippedFallback.length) {
    out.push('', `${h} Equipped gear`, '', gearTable(equippedFallback, items, name));
  }

  if (ch.bags) out.push('', ...renderBags(h, bags, items));
  return out.join('\n');
}

function isActiveBuild(ch: Character, t: CharacterBuildTab): boolean {
  return t.is_active || t.tab === ch.active_build_tab;
}

function isActiveEquipment(ch: Character, t: CharacterEquipmentTab): boolean {
  return t.is_active || t.tab === ch.active_equipment_tab;
}

function tabHeading(kind: 'Build' | 'Equipment', tab: number, label: string, active: boolean): string {
  return `${kind} template ${tab}${label ? `: ${text(label)}` : ''}${active ? ' (active)' : ''}`;
}

function templateSummary(ch: Character, activeOnly: boolean): string {
  const parts: string[] = [];
  if (ch.build_tabs_unlocked !== undefined) {
    parts.push(`${ch.build_tabs_unlocked} build${ch.active_build_tab !== undefined ? ` (active: ${ch.active_build_tab})` : ''}`);
  }
  if (ch.equipment_tabs_unlocked !== undefined) {
    parts.push(`${ch.equipment_tabs_unlocked} equipment${ch.active_equipment_tab !== undefined ? ` (active: ${ch.active_equipment_tab})` : ''}`);
  }
  if (!parts.length) return '';
  return `${parts.join(', ')} unlocked${activeOnly ? '; only the active ones are shown' : ''}.`;
}

/**
 * Equipped items that belong to no template, such as gathering tools and
 * fishing gear. Slots a template already fills are left out so nothing is
 * listed twice.
 */
function looseGear(ch: Character): GearPiece[] {
  if (!ch.equipment_tabs || !ch.equipment) return [];
  const templated = new Set(ch.equipment_tabs.flatMap((t) => t.equipment.map((e) => e.slot)));
  return ch.equipment
    .filter((e) => !e.tabs && (!e.location || e.location.startsWith('Equipped')) && !(e.slot && templated.has(e.slot)))
    .sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
}

function buildSignature(b: CharacterBuild): string {
  const { name: _name, ...rest } = b;
  return JSON.stringify(rest);
}

/** Item, stats and upgrades per slot; skins and dyes are cosmetic and not shown. */
function gearSignature(t: CharacterEquipmentTab): string {
  const gear = [...t.equipment]
    .sort((a, b) => slotRank(a.slot) - slotRank(b.slot))
    .map((e) => [e.slot, e.id, e.stats?.id, e.upgrades, e.infusions]);
  return JSON.stringify([gear, t.equipment_pvp]);
}

interface Names {
  skill(id: number | null | undefined): string;
  trait(id: number | null): string;
  pet(id: number | null): string;
  legend(id: string | null): string;
  item(id: number | null): string;
  stats(p: CharacterEquipmentPiece): string;
}

function renderBuild(build: CharacterBuild, specs: ReadonlyMap<number, { name: string; elite: boolean }>, name: Names): string[] {
  const lines: string[] = [];
  const chosen = build.specializations.filter((s): s is { id: number; traits: (number | null)[] } => s.id !== null);
  if (chosen.length) {
    lines.push(
      table(
        ['Specialization', 'Spec id', 'Major traits (adept / master / grandmaster)', 'Trait ids'],
        chosen.map((s) => [
          `${nameOf(specs, s.id)}${specs.get(s.id)?.elite ? ' (elite)' : ''}`,
          s.id,
          s.traits.map(name.trait).join(' / '),
          s.traits.map((t) => t ?? '—').join(', '),
        ]),
      ),
      '',
    );
  } else {
    lines.push('_No specializations chosen._', '');
  }
  const bar = (label: string, s: CharacterSkillBar | undefined) => {
    if (!s) return;
    const ids = [s.heal, ...s.utilities, s.elite];
    if (!ids.some(present)) return;
    lines.push(
      `- **${label}:** Heal ${name.skill(s.heal)} · Utilities ${s.utilities.map(name.skill).join(', ')} · Elite ${name.skill(s.elite)}` +
        ` (skill ids ${ids.map((x) => x ?? '—').join(', ')})`,
    );
  };
  bar('Skills', build.skills);
  bar('Underwater skills', build.aquatic_skills);
  if (build.legends?.some(present)) lines.push(`- **Legends:** ${build.legends.map(name.legend).join(', ')}`);
  if (build.aquatic_legends?.some(present)) lines.push(`- **Underwater legends:** ${build.aquatic_legends.map(name.legend).join(', ')}`);
  if (build.pets?.terrestrial.some(present)) lines.push(`- **Pets:** ${build.pets.terrestrial.map(name.pet).join(', ')}`);
  if (build.pets?.aquatic.some(present)) lines.push(`- **Underwater pets:** ${build.pets.aquatic.map(name.pet).join(', ')}`);
  // Drop the blank line left after the table when no skill lines follow.
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function gearTable(pieces: readonly GearPiece[], items: ReadonlyMap<number, Item>, name: Names): string {
  const rows = [...pieces]
    .sort((a, b) => slotRank(a.slot) - slotRank(b.slot))
    .map((e) => {
      const item = items.get(e.id);
      return [
        e.slot ?? '—',
        item?.name ?? `#${e.id}`,
        e.id,
        item?.rarity,
        name.stats(e),
        (e.upgrades ?? []).map(name.item).join(', '),
        (e.infusions ?? []).map(name.item).join(', '),
      ];
    });
  return table(['Slot', 'Item', 'Item id', 'Rarity', 'Stats', 'Runes / sigils', 'Infusions'], rows);
}

function renderPvp(p: CharacterEquipmentPvp | undefined, amulets: ReadonlyMap<number, { name: string }>, name: Names): string {
  if (!p || (p.amulet === null && p.rune === null && !p.sigils.some(present))) return '';
  const amulet = p.amulet !== null ? `${nameOf(amulets, p.amulet)} (${p.amulet})` : '—';
  return `- **PvP:** Amulet ${amulet} · Rune ${name.item(p.rune)} · Sigils ${p.sigils.map(name.item).join(', ')}`;
}

function renderBags(h: string, bags: readonly NonNullable<NonNullable<Character['bags']>[number]>[], items: ReadonlyMap<number, Item>): string[] {
  const contents = bags.flatMap((b) => b.inventory.filter(present));
  const rows = bags.map((b) => {
    const used = b.inventory.filter(present).length;
    return [nameOf(items, b.id), b.id, b.size, used, b.size - used];
  });
  const size = bags.reduce((s, b) => s + b.size, 0);
  const stacks = new Map<number, number>();
  for (const s of contents) stacks.set(s.id, (stacks.get(s.id) ?? 0) + s.count);
  const top = [...stacks]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id, n]) => `${text(nameOf(items, id))} ×${num(n)} (${id})`)
    .join(', ');
  return [
    `${h} Bags`,
    '',
    `${contents.length} of ${size} slots used (${size - contents.length} free).`,
    '',
    table(['Bag', 'Item id', 'Slots', 'Used', 'Free'], rows),
    ...(top ? ['', `**Largest stacks:** ${top}.`] : []),
  ];
}
