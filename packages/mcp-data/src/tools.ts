import {
  TTL,
  buildRecipeTree,
  catalog,
  fmt,
  nameOf,
  pageUrl,
  renderRecipeTree,
  searchItemsByName,
  type Achievement,
  type ExchangeRate,
  type Gw2Client,
  type Item,
  type Listing,
  type Price,
  type WikiClient,
} from '@gw2-ai/core';
import { breakEvenPrice, flipProfit } from './fees.js';
import { checkParams, compactJson, normalizeApiPath, truncate } from './util.js';

const { coins, num, table, plain } = fmt;

type Named = { id: number; name: string };

/** API attribute keys to the names players know. */
const ATTRIBUTE_NAMES: Record<string, string> = {
  CritDamage: 'Ferocity',
  ConditionDamage: 'Condition Damage',
  ConditionDuration: 'Expertise',
  BoonDuration: 'Concentration',
  Healing: 'Healing Power',
  AgonyResistance: 'Agony Resistance',
};

export function attributeName(key: string): string {
  return ATTRIBUTE_NAMES[key] ?? key;
}

// ---------------------------------------------------------------- items

interface InfixUpgrade {
  id?: number;
  attributes?: { attribute: string; modifier: number }[];
  buff?: { skill_id?: number; description?: string };
}

export async function itemDetails(client: Gw2Client, ids: number[]): Promise<string> {
  const items = await catalog.items(client, ids);
  const statIds = new Set<number>();
  const upgradeIds = new Set<number>();
  for (const item of items.values()) {
    const d = item.details ?? {};
    const infix = d.infix_upgrade as InfixUpgrade | undefined;
    if (infix?.id) statIds.add(infix.id);
    for (const s of (d.stat_choices as number[] | undefined) ?? []) statIds.add(s);
    for (const k of ['suffix_item_id', 'secondary_suffix_item_id']) {
      const v = Number(d[k]);
      if (v > 0) upgradeIds.add(v);
    }
  }
  const [prices, stats, upgrades] = await Promise.all([
    catalog.prices(client, items.keys()),
    client.getMany<Named>('/v2/itemstats', statIds),
    catalog.items(client, upgradeIds),
  ]);

  const blocks = ids.map((id) => {
    const item = items.get(id);
    if (!item) return `## #${id}\n\n_No item with this id in /v2/items._`;
    return renderItem(item, prices.get(id), stats, upgrades);
  });
  return blocks.join('\n\n');
}

function renderItem(item: Item, price: Price | undefined, stats: Map<number, Named>, upgrades: Map<number, Item>): string {
  const d = item.details ?? {};
  const subtype = typeof d.type === 'string' ? ` / ${d.type}` : '';
  const lines = [
    `## ${item.name} (${item.id})`,
    '',
    `- **Type:** ${item.type}${subtype} · **Rarity:** ${item.rarity} · **Level:** ${item.level}`,
  ];
  if (item.description) lines.push(`- **Description:** ${plain(item.description)}`);
  if (item.flags.length) lines.push(`- **Flags:** ${item.flags.join(', ')}${bindingNote(item.flags)}`);
  if (item.restrictions.length) lines.push(`- **Restrictions:** ${item.restrictions.join(', ')}`);
  lines.push(...detailLines(d, stats, upgrades));
  lines.push(`- **Vendor value:** ${coins(item.vendor_value)} · **Chat link:** \`${item.chat_link}\``);
  if (price) {
    const b = price.buys;
    const s = price.sells;
    lines.push(
      `- **Trading post:** buy order ${b.unit_price ? coins(b.unit_price) : '—'} (${num(b.quantity)} wanted) · sell listing ${s.unit_price ? coins(s.unit_price) : '—'} (${num(s.quantity)} listed)`,
    );
  } else {
    lines.push('- **Trading post:** not tradable');
  }
  if (item.upgrades_into?.length) {
    lines.push(`- **Upgrades into:** ${item.upgrades_into.map((u) => `${u.upgrade} → item ${u.item_id}`).join('; ')}`);
  }
  if (item.upgrades_from?.length) {
    lines.push(`- **Upgrades from:** ${item.upgrades_from.map((u) => `${u.upgrade} ← item ${u.item_id}`).join('; ')}`);
  }
  lines.push(`- **Wiki:** ${pageUrl(item.name)}`);
  return lines.join('\n');
}

function bindingNote(flags: string[]): string {
  if (flags.includes('AccountBound')) return ' (account bound: cannot be traded)';
  if (flags.includes('SoulbindOnAcquire')) return ' (soulbound: cannot be traded)';
  if (flags.includes('AccountBindOnUse') || flags.includes('SoulBindOnUse')) return ' (binds on use: tradable until used)';
  return '';
}

const HANDLED_DETAILS = new Set([
  'type',
  'infix_upgrade',
  'stat_choices',
  'infusion_slots',
  'suffix_item_id',
  'secondary_suffix_item_id',
  'bonuses',
  'description',
  'min_power',
  'max_power',
  'duration_ms',
  'attribute_adjustment',
  'icon',
]);

function detailLines(d: Record<string, unknown>, stats: Map<number, Named>, upgrades: Map<number, Item>): string[] {
  const out: string[] = [];
  if (typeof d.min_power === 'number') out.push(`- **Weapon strength:** ${d.min_power}–${d.max_power}`);
  const infix = d.infix_upgrade as InfixUpgrade | undefined;
  if (infix) {
    const set = infix.id ? stats.get(infix.id)?.name : undefined;
    const attrs = (infix.attributes ?? []).map((a) => `+${a.modifier} ${attributeName(a.attribute)}`).join(', ');
    const parts = [set ? `${set} (itemstats ${infix.id})` : infix.id ? `itemstats ${infix.id}` : '', attrs].filter(Boolean);
    if (parts.length) out.push(`- **Stats:** ${parts.join(': ')}`);
    if (infix.buff?.description) out.push(`- **Buff:** ${plain(infix.buff.description.replace(/\n/g, ', '))}`);
  }
  const choices = d.stat_choices as number[] | undefined;
  if (choices?.length) {
    out.push(`- **Selectable stats (${choices.length}):** ${choices.map((s) => stats.get(s)?.name ?? `#${s}`).join(', ')}`);
  }
  const slots = d.infusion_slots as { flags: string[] }[] | undefined;
  if (slots?.length) out.push(`- **Infusion slots:** ${slots.map((s) => s.flags.join('/') || 'any').join(', ')}`);
  for (const k of ['suffix_item_id', 'secondary_suffix_item_id']) {
    const v = Number(d[k]);
    if (v > 0) out.push(`- **Upgrade:** ${upgrades.get(v)?.name ?? `#${v}`} (item ${v})`);
  }
  const bonuses = d.bonuses as string[] | undefined;
  if (bonuses?.length) out.push(`- **Bonuses:** ${bonuses.map((b, i) => `(${i + 1}) ${plain(b)}`).join('; ')}`);
  if (typeof d.description === 'string' && d.description) out.push(`- **Effect:** ${plain(d.description)}`);
  if (typeof d.duration_ms === 'number') out.push(`- **Duration:** ${Math.round(d.duration_ms / 60_000)} min`);
  const rest = Object.entries(d)
    .filter(([k, v]) => !HANDLED_DETAILS.has(k) && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  if (rest.length) out.push(`- **Details:** ${rest.join('; ')}`);
  return out;
}

// ---------------------------------------------------------------- search

/** Strip characters that would break out of an SMW condition. */
export function smwEscape(text: string): string {
  return text.replace(/[[\]|{}\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(s: string): string {
  return s.replace(/(^|[\s(-])(\p{Ll})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

function gameIds(rows: Record<string, unknown>[]): number[] {
  const ids: number[] = [];
  for (const r of rows) for (const v of (r['Has game id'] as unknown[] | undefined) ?? []) if (Number(v) > 0) ids.push(Number(v));
  return ids;
}

export async function itemSearch(
  client: Gw2Client,
  wiki: WikiClient,
  query: string,
  limit: number,
  exhaustive: boolean,
): Promise<string> {
  let items: Item[];
  let source: string;
  if (exhaustive) {
    items = await searchItemsByName(client, query, limit);
    source = 'full /v2/items scan';
  } else {
    const q = smwEscape(query);
    if (!q) throw new Error('Query is empty after removing [ ] | { } characters.');
    // SMW `~` matching is case-sensitive; try the query as typed, then Title Case.
    const variants = [...new Set([q, titleCase(q), q.charAt(0).toUpperCase() + q.slice(1)])];
    // SMW sorts by title, so fetch generously and rank locally.
    const results = await Promise.all(
      variants.map((v) => wiki.ask(`[[Has context::Item]][[~*${v}*]]|?Has game id`, Math.max(200, limit * 4))),
    );
    const ids = new Set<number>(results.flatMap(gameIds));
    source = 'wiki item index';
    if (ids.size === 0) {
      // Fall back to full-text search (case-insensitive), then map titles to item ids.
      const hits = await wiki.search(query, 10);
      if (hits.length) {
        const titles = hits.map((h) => smwEscape(h.title)).join('||');
        for (const id of gameIds(await wiki.ask(`[[Has context::Item]][[${titles}]]|?Has game id`, 50))) ids.add(id);
        source = 'wiki full-text search';
      }
    }
    items = [...(await catalog.items(client, ids)).values()];
  }

  const q = query.toLowerCase().trim();
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
  // Exact name, then whole-word matches, then partial-word matches.
  const rank = (name: string) => {
    const n = name.toLowerCase();
    if (n === q) return 0;
    if (word.test(n)) return 1;
    return n.startsWith(q) ? 2 : n.includes(q) ? 3 : 4;
  };
  items.sort((a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length || a.id - b.id);
  const shown = items.slice(0, limit);
  if (shown.length === 0) {
    return `No items found for "${query}" (${source}). Try a shorter or differently spelled name, gw2_wiki_search, or exhaustive: true (slow full scan).`;
  }
  const prices = await catalog.prices(client, shown.map((i) => i.id));
  const rows = shown.map((i) => {
    const p = prices.get(i.id);
    return [i.name, i.id, i.type, i.rarity, i.level, p?.sells.unit_price ? coins(p.sells.unit_price) : p ? '—' : 'not tradable'];
  });
  const more = items.length > shown.length ? ` Showing ${shown.length} of ${items.length}; raise \`limit\` for more.` : '';
  return `# Items matching "${query}"\n\nSource: ${source}.${more} Several items can share a name (e.g. account-bound and tradable versions); check type and rarity.\n\n${table(['Name', 'Item id', 'Type', 'Rarity', 'Level', 'TP sell'], rows)}`;
}

// ---------------------------------------------------------------- market

export async function prices(client: Gw2Client, ids: number[]): Promise<string> {
  const [px, items] = await Promise.all([catalog.prices(client, ids), catalog.items(client, ids)]);
  const rows = ids
    .filter((id) => px.has(id))
    .map((id) => {
      const p = px.get(id)!;
      const buy = p.buys.unit_price;
      const sell = p.sells.unit_price;
      const profit = flipProfit(buy, sell);
      return [
        nameOf(items, id),
        id,
        buy ? coins(buy) : '—',
        sell ? coins(sell) : '—',
        buy && sell ? coins(sell - buy) : '—',
        `${num(p.buys.quantity)} / ${num(p.sells.quantity)}`,
        profit === undefined ? '—' : coins(profit),
        profit === undefined ? '—' : `${((profit / buy) * 100).toFixed(1)}%`,
        buy ? coins(breakEvenPrice(buy)) : '—',
      ];
    });
  const missing = ids.filter((id) => !px.has(id));
  const out = [
    '# Trading post prices',
    '',
    'Buy = highest buy order (what you get selling instantly). Sell = lowest sell listing (what you pay buying instantly). ' +
      'Flip profit = sell listing minus the 15% fee (5% listing + 10% exchange, 1c minimum each) minus buy order, per unit. Break-even = lowest listing price that recovers the buy-order price after fees.',
    '',
    table(['Item', 'Item id', 'Buy', 'Sell', 'Spread', 'Demand / Supply', 'Flip profit', 'ROI', 'Break-even'], rows),
  ];
  if (missing.length) {
    out.push('', `Not tradable or unknown: ${missing.map((id) => `${nameOf(items, id)} (${id})`).join(', ')}.`);
  }
  return out.join('\n');
}

export async function listings(client: Gw2Client, id: number, depth: number): Promise<string> {
  const [book, items] = await Promise.all([
    client.get<Listing>(`/v2/commerce/listings/${id}`, { ttlMs: TTL.market }),
    catalog.items(client, [id]),
  ]);
  const side = (rows: Listing['buys']) => {
    let cum = 0;
    return rows.slice(0, depth).map((r) => {
      cum += r.quantity;
      return [coins(r.unit_price), num(r.quantity), num(r.listings), num(cum)];
    });
  };
  const sells = [...book.sells].sort((a, b) => a.unit_price - b.unit_price);
  const buys = [...book.buys].sort((a, b) => b.unit_price - a.unit_price);
  const total = (rows: Listing['buys']) => num(rows.reduce((s, r) => s + r.quantity, 0));
  const headers = ['Unit price', 'Quantity', 'Listings', 'Cumulative'];
  return [
    `# Order book: ${nameOf(items, id)} (${id})`,
    '',
    `Showing the best ${depth} price levels per side. Total: ${total(book.sells)} for sale over ${num(book.sells.length)} levels, ${total(book.buys)} wanted over ${num(book.buys.length)} levels.`,
    '',
    '## Sell listings (cheapest first: what buying instantly costs)',
    '',
    table(headers, side(sells)),
    '',
    '## Buy orders (highest first: what selling instantly pays)',
    '',
    table(headers, side(buys)),
  ].join('\n');
}

export async function gemExchange(client: Gw2Client, gems: number, copper: number): Promise<string> {
  const [sellGems, buyGems] = await Promise.all([
    client.get<ExchangeRate>('/v2/commerce/exchange/gems', { params: { quantity: gems }, ttlMs: TTL.exchange }),
    client.get<ExchangeRate>('/v2/commerce/exchange/coins', { params: { quantity: copper }, ttlMs: TTL.exchange }),
  ]);
  return [
    '# Gem exchange',
    '',
    `- **${num(gems)} gems → ${coins(sellGems.quantity)}** (${coins(sellGems.coins_per_gem)} per gem when selling gems)`,
    `- **${coins(copper)} → ${num(buyGems.quantity)} gems** (${coins(buyGems.coins_per_gem)} per gem when buying gems)`,
    `- 400 gems at the buying rate cost about ${coins(buyGems.coins_per_gem * 400)}.`,
    '',
    'Rates move with volume, and large trades get a worse rate. Buying gems always costs more per gem than selling them pays.',
  ].join('\n');
}

// ---------------------------------------------------------------- crafting

export async function recipeTree(client: Gw2Client, id: number, quantity: number, expandAll: boolean): Promise<string> {
  const tree = await buildRecipeTree(client, id, quantity);
  return renderRecipeTree(tree, { expandAll });
}

export async function recipesUsing(client: Gw2Client, id: number, limit: number): Promise<string> {
  const recipeIds = await catalog.recipesUsing(client, id);
  const [self, recipes] = await Promise.all([catalog.items(client, [id]), catalog.recipes(client, recipeIds)]);
  const outputs = await catalog.items(client, [...recipes.values()].map((r) => r.output_item_id));
  const list = [...recipes.values()].sort(
    (a, b) => nameOf(outputs, a.output_item_id).localeCompare(nameOf(outputs, b.output_item_id)) || a.min_rating - b.min_rating,
  );
  const rows = list.slice(0, limit).map((r) => {
    const out = outputs.get(r.output_item_id);
    const uses = r.ingredients.find((i) => i.type === 'Item' && i.id === id)?.count ?? 0;
    return [
      out?.name ?? `#${r.output_item_id}`,
      r.output_item_id,
      out?.rarity,
      num(uses),
      r.output_item_count,
      `${r.disciplines.join('/')} ${r.min_rating}`,
      r.id,
    ];
  });
  const more = list.length > limit ? ` Showing ${limit}; raise \`limit\` to see more.` : '';
  const note =
    '\n\nOnly crafting-station recipes are in the API; Mystic Forge combinations are not (see the wiki for those).';
  return `# Recipes using ${nameOf(self, id)} (${id})\n\n${num(list.length)} recipes.${more}${note}\n\n${table(
    ['Makes', 'Item id', 'Rarity', 'Uses', 'Output qty', 'Discipline / rating', 'Recipe id'],
    rows,
  )}`;
}

// ---------------------------------------------------------------- achievements

export async function achievements(client: Gw2Client, ids: number[]): Promise<string> {
  const achs = await catalog.achievements(client, ids);
  const itemIds = new Set<number>();
  const skinIds = new Set<number>();
  const miniIds = new Set<number>();
  const titleIds = new Set<number>();
  const prereqIds = new Set<number>();
  for (const a of achs.values()) {
    for (const r of a.rewards ?? []) {
      if (r.type === 'Item' && r.id) itemIds.add(r.id);
      if (r.type === 'Title' && r.id) titleIds.add(r.id);
    }
    for (const b of a.bits ?? []) {
      if (!b.id) continue;
      if (b.type === 'Item') itemIds.add(b.id);
      if (b.type === 'Skin') skinIds.add(b.id);
      if (b.type === 'Minipet') miniIds.add(b.id);
    }
    for (const p of a.prerequisites ?? []) prereqIds.add(p);
  }
  const [items, skins, minis, titles, prereqs] = await Promise.all([
    catalog.items(client, itemIds),
    client.getMany<Named>('/v2/skins', skinIds),
    client.getMany<Named>('/v2/minis', miniIds),
    client.getMany<Named>('/v2/titles', titleIds),
    catalog.achievements(client, prereqIds),
  ]);

  return ids
    .map((id) => {
      const a = achs.get(id);
      if (!a) return `## #${id}\n\n_No achievement with this id._`;
      return renderAchievement(a, { items, skins, minis, titles, prereqs });
    })
    .join('\n\n');
}

function renderAchievement(
  a: Achievement,
  names: {
    items: Map<number, Named>;
    skins: Map<number, Named>;
    minis: Map<number, Named>;
    titles: Map<number, Named>;
    prereqs: Map<number, Named>;
  },
): string {
  const lines = [`## ${a.name} (${a.id})`, ''];
  if (a.description) lines.push(`- **Description:** ${plain(a.description)}`);
  if (a.requirement) lines.push(`- **Requirement:** ${plain(a.requirement)}`);
  if (a.locked_text) lines.push(`- **Unlock:** ${plain(a.locked_text)}`);
  lines.push(`- **Type:** ${a.type}${a.flags.length ? ` · **Flags:** ${a.flags.join(', ')}` : ''}`);
  const points = a.tiers.reduce((s, t) => s + t.points, 0);
  lines.push(`- **Tiers:** ${a.tiers.map((t) => `${num(t.count)} → ${t.points} AP`).join('; ')} (total ${points} AP${a.point_cap ? `, repeatable up to ${a.point_cap}` : ''})`);
  if (a.prerequisites?.length) {
    lines.push(`- **Prerequisites:** ${a.prerequisites.map((p) => `${nameOf(names.prereqs, p)} (${p})`).join(', ')}`);
  }
  if (a.rewards?.length) {
    const rewards = a.rewards.map((r) => {
      switch (r.type) {
        case 'Coins':
          return coins(r.count ?? 0);
        case 'Item':
          return `${r.count ?? 1} × ${nameOf(names.items, r.id ?? 0)} (item ${r.id})`;
        case 'Mastery':
          return `${r.region ?? ''} mastery point`;
        case 'Title':
          return `title "${nameOf(names.titles, r.id ?? 0)}" (${r.id})`;
        default:
          return `${r.type}${r.id ? ` ${r.id}` : ''}`;
      }
    });
    lines.push(`- **Rewards:** ${rewards.join('; ')}`);
  }
  const bits = a.bits ?? [];
  if (bits.length) {
    const cap = 60;
    const rows = bits.slice(0, cap).map((b, i) => {
      const id = b.id ?? 0;
      const name =
        b.type === 'Item'
          ? nameOf(names.items, id)
          : b.type === 'Skin'
            ? nameOf(names.skins, id)
            : b.type === 'Minipet'
              ? nameOf(names.minis, id)
              : '';
      return [i, b.type, name || plain(b.text), b.id ?? '', name ? plain(b.text) : ''];
    });
    lines.push('', `### Objectives (${bits.length})`, '', table(['Bit', 'Type', 'Name', 'Id', 'Hint'], rows));
    if (bits.length > cap) lines.push('', `_${bits.length - cap} more objectives not shown._`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- escape hatch

export async function apiGet(
  client: Gw2Client,
  path: string,
  ids: (number | string)[] | undefined,
  params: Record<string, string | number | boolean> | undefined,
  maxChars: number,
): Promise<string> {
  const clean = normalizeApiPath(path);
  // Basic guild info is public even though the rest of /v2/guild/:id needs a key.
  const auth = /^\/v2\/guild\/[^/]+$/.test(clean) ? { auth: false } : {};
  let body: unknown;
  if (ids?.length) {
    body = [...(await client.getMany<{ id: number | string }>(clean, ids, auth)).values()];
  } else {
    body = await client.get(clean, { params: checkParams(params), ...auth });
  }
  const json = compactJson(body);
  return truncate(
    `GET ${clean}${ids?.length ? ` (ids: ${ids.length})` : ''}\n\n\`\`\`json\n${json}\n\`\`\``,
    maxChars,
    'Narrow the request with `ids`, or `params` such as page and page_size.',
  );
}
