import {
  ALL_PERMISSIONS,
  Gw2ApiError,
  PERMISSION_HELP,
  missingPermissions,
  type Character,
  type Gw2Client,
  type Item,
  type Permission,
  type TokenInfo,
} from '@gw2kit/client';
import { buildRecipeTree, solvePlan, withHoldings } from '@gw2kit/recipes';
import type { WikiClient } from '@gw2kit/wiki';
import {
  ACCOUNT,
  DEFAULT_VENDOR_CURRENCY,
  CharacterNotFoundError,
  SECTIONS,
  TOKEN_TTL,
  collectHoldings,
  createContext,
  fetchCharacter,
  readHoldings,
  readSellables,
  renderPlan,
  renderSales,
  planSales,
  planShortfall,
  salesForPlan,
  type SaleOptions,
  fmt,
  nameOf,
  renderCharacter,
  type CharacterOptions,
  renderRecipeTree,
} from '@gw2-ai/core';
import { loadPlan, plansDir, savePlan } from '@gw2-ai/core/plans';
import { accountPath, checkParams, compactJson } from './paths.js';

const { num, table, text } = fmt;

function tokenInfo(client: Gw2Client): Promise<TokenInfo> {
  return client.get('/v2/tokeninfo', { ttlMs: TOKEN_TTL });
}

/** What each tool needs, for gw2_key_info and permission errors. */
export const TOOL_PERMISSIONS: Record<string, { required: Permission[]; optional: Permission[]; note: string }> = {
  gw2_find_item: { required: ['inventories'], optional: ['characters', 'unlocks', 'builds'], note: 'characters adds bags, unlocks adds the legendary armory, builds adds equipped gear' },
  gw2_character: { required: ['characters'], optional: ['builds', 'inventories'], note: 'builds adds build and equipment templates, inventories adds bags' },
  gw2_shopping_list: { required: ['inventories'], optional: ['characters', 'wallet'], note: 'characters adds character bags to the holdings, wallet compares vendor currencies with your balances' },
  gw2_raise_gold: { required: ['inventories'], optional: ['characters', 'tradingpost', 'wallet'], note: 'characters adds character bags, tradingpost adds coins waiting in the delivery box, wallet works out what a plan is short' },
  gw2_plan_holdings: { required: ['inventories'], optional: ['characters', 'wallet'], note: 'characters adds character bags to the holdings, wallet counts currency balances toward the plan' },
};

export class MissingPermissionError extends Error {}

async function requirePermissions(client: Gw2Client, tool: string): Promise<Permission[]> {
  const info = await tokenInfo(client);
  const spec = TOOL_PERMISSIONS[tool];
  if (spec) {
    const missing = missingPermissions(info.permissions, spec.required);
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
    const missing = missingPermissions(info.permissions, s.permissions);
    return [s.id, missing.length ? `skipped (needs ${missing.join(', ')})` : 'available', s.summary];
  });
  const toolRows = Object.entries(TOOL_PERMISSIONS).map(([tool, spec]) => {
    const missing = missingPermissions(info.permissions, spec.required);
    const missingOpt = missingPermissions(info.permissions, spec.optional);
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
    `- **Type:** ${info.type}${info.expires_at ? ` · **Expires:** ${info.expires_at}` : ''}`,
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
    client.get('/v2/account/materials', ACCOUNT).catch(() => undefined),
    perms.has('unlocks') ? client.get('/v2/account/legendaryarmory', ACCOUNT).catch(() => undefined) : undefined,
    perms.has('characters') ? client.all('/v2/characters', ACCOUNT).catch(() => undefined) : undefined,
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
    defs = await client.many('/v2/items', ids);
  } else {
    defs = await client.many('/v2/items', where.keys());
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

export async function character(client: Gw2Client, name: string, templates: CharacterOptions['templates'] = 'all'): Promise<string> {
  const perms = await requirePermissions(client, 'gw2_character');
  let ch: Character;
  try {
    ch = await fetchCharacter(client, name);
  } catch (err) {
    if (err instanceof CharacterNotFoundError) {
      return `No character named "${text(name)}" on this account. Characters: ${err.names.map(text).join(', ') || '(none visible)'}. Names are case-sensitive.`;
    }
    throw err;
  }
  const body = await renderCharacter(client, ch, perms, { templates, headingLevel: 2 });
  return `# ${text(ch.name)}\n\n${body}\n\nUse gw2_find_item to locate a specific item from the bags.`;
}

// ---------------------------------------------------------------- shopping list

export async function shoppingList(client: Gw2Client, wiki: WikiClient, itemId: number, quantity: number): Promise<string> {
  const perms = await requirePermissions(client, 'gw2_shopping_list');
  const { holdings, notes: unread, walletRead } = await readHoldings(client, perms);
  const wallet = walletRead ? new Map(Object.entries(holdings.wallet).map(([id, value]) => [Number(id), value])) : undefined;
  const have = new Map(Object.entries(holdings.items).map(([id, count]) => [Number(id), count]));

  const tree = await buildRecipeTree(client, itemId, quantity, { have, wiki, vendorCurrency: DEFAULT_VENDOR_CURRENCY });
  const md = renderRecipeTree(tree, {
    title: `Shopping list: ${num(quantity)} × ${tree.name} (${itemId})`,
    raw: false,
    ...(wallet ? { wallet } : {}),
  });
  // The sentence about the wallet below already says when it wasn't read.
  const rest = unread.filter((n) => !n.startsWith('wallet '));
  const notes = rest.length ? ` Notes: ${rest.join('; ')}.` : '';
  return (
    md +
    `\nHoldings counted: bank, shared slots, character bags, material storage (${num(have.size)} distinct items). ` +
    `Equipped gear, the delivery box and guild storage are not subtracted. ${wallet ? 'Wallet balances are compared with the vendor currencies needed.' : 'Wallet balances are not shown (the key lacks `wallet`).'}${notes} Costs use current TP sell listings.\n`
  );
}

// ---------------------------------------------------------------- crafting plan

/** Read the account into the saved plan `name`. */
async function syncPlan(client: Gw2Client, permissions: readonly Permission[], name: string, dir: string) {
  await loadPlan(name, dir); // fail on a bad name before reading the account
  const { holdings, notes } = await readHoldings(client, permissions);
  // Loaded again: the plan may have been updated while the account was read.
  const plan = withHoldings(await loadPlan(name, dir), holdings);
  await savePlan(name, plan, dir);
  return { plan, notes };
}

/** Write what the account holds into a saved plan. */
export async function planHoldings(client: Gw2Client, name: string, dir = plansDir()): Promise<string> {
  const perms = await requirePermissions(client, 'gw2_plan_holdings');
  const { plan, notes } = await syncPlan(client, perms, name, dir);
  return [
    `Holdings saved to plan \`${name}\`: bank, shared slots, character bags, material storage and wallet. ` +
      `Equipped gear, the delivery box and guild storage are not counted.${notes.length ? ` Notes: ${notes.join('; ')}.` : ''}`,
    renderPlan(plan, { sections: ['decisions', 'covered'] }),
    `For the remaining steps, use gw2_plan_show {plan: "${name}"} on gw2-data.`,
  ].join('\n\n');
}

// ---------------------------------------------------------------- raise gold

export interface RaiseGoldArgs {
  /** Gold to raise (not copper). */
  targetGold?: number | undefined;
  /** Saved plan whose materials are held back and whose shortfall is the default target. */
  plan?: string | undefined;
  method?: SaleOptions['method'] | undefined;
  order?: SaleOptions['order'] | undefined;
  keep?: SaleOptions['keep'] | undefined;
  everything?: boolean | undefined;
}

const NOTHING_SOLD =
  'Nothing has been sold: the API is read-only, so make these sales in game. Bound items, equipped gear and guild storage are never considered, ' +
  'and nothing is refined, salvaged or converted from currencies first.';

/** What the player could sell to raise gold, on its own or for a saved plan. */
export async function raiseGold(client: Gw2Client, args: RaiseGoldArgs, dir = plansDir()): Promise<string> {
  const perms = await requirePermissions(client, 'gw2_raise_gold');
  const options: SaleOptions = {
    ...(args.targetGold === undefined ? {} : { target: Math.round(args.targetGold * 10_000) }),
    ...(args.method ? { method: args.method } : {}),
    ...(args.order ? { order: args.order } : {}),
    ...(args.keep ? { keep: args.keep } : {}),
    ...(args.everything ? { everything: true } : {}),
  };
  const read = async () => {
    const { items, notes, delivery } = await readSellables(client, perms);
    return { items, extra: { notes, ...(delivery === undefined ? {} : { delivery }) } };
  };

  if (args.plan === undefined) {
    const { items, extra } = await read();
    return `${renderSales(planSales(items, options), extra)}\n\n${NOTHING_SOLD}`;
  }

  const { plan, notes } = await syncPlan(client, perms, args.plan, dir);
  const saved = `Holdings saved to plan \`${args.plan}\`.${notes.length ? ` Notes: ${notes.join('; ')}.` : ''}`;
  if (options.target === undefined && planShortfall(plan) === 0) {
    return [
      saved,
      renderPlan(plan, { sections: [] }),
      'The wallet covers the gold this plan still needs, so nothing needs selling. Pass `target_gold` to raise an amount anyway.',
    ].join('\n\n');
  }
  const { items, extra } = await read();
  const undecided = solvePlan(plan).steps.some((s) => s.undecided);
  return [
    saved,
    renderPlan(plan, { sections: [], sales: { plan: salesForPlan(plan, items, { ...options, delivery: extra.delivery }), ...extra } }),
    `Held back: what you own that this plan uses. Other saved plans are not considered; name their materials in \`keep\`.` +
      (undecided ? ' Recipe choices are still open, and only the assumed routes are protected: settle them before selling.' : ''),
    NOTHING_SOLD,
  ].join('\n\n');
}

// ---------------------------------------------------------------- escape hatch

export async function accountGet(
  client: Gw2Client,
  path: string,
  params: Record<string, string | number | boolean> | undefined,
  maxChars: number,
): Promise<string> {
  const clean = accountPath(path);
  const body = await client.raw(clean, { query: checkParams(params), auth: true, ttlMs: 30_000 });
  const json = compactJson(body);
  const text = `GET ${clean}\n\n\`\`\`json\n${json}\n\`\`\``;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Truncated: showing ${maxChars.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters. Use params such as page and page_size, or a narrower path.]`;
}
