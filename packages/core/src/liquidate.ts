/**
 * Turning what an account holds into gold: what to sell, how, and how much of
 * it, to raise a target. Nothing here knows about crafting; a caller that has
 * plans for some items passes them as `reserve`.
 */
import { TTL, type Gw2Client, type InventorySlot, type Permission } from '@gw2kit/client';
import { sellProceeds } from './fees.js';
import { cell, coins, num, text } from './format.js';

/** One item the account could sell. Prices are copper per unit, before fees. */
export interface Sellable {
  id: number;
  name: string;
  count: number;
  /** A crafting material or trophy, wherever it is stored; false for gear, consumables and the rest. */
  material: boolean;
  rarity?: string;
  /** What a vendor pays; 0 when vendors won't buy it. */
  vendor: number;
  /** Highest buy order; absent when it can't be sold on the trading post or nobody is buying. */
  buy?: number;
  /** Lowest sell listing. */
  sell?: number;
  /** Buy orders from the highest down, when read: what selling at once really pays. */
  book?: { price: number; quantity: number }[];
}

export interface SaleOptions {
  /** Copper to raise. Absent: everything that can be sold. */
  target?: number;
  /** `instant` (default): to buy orders. `list`: at the lowest listing, which waits for buyers. */
  method?: 'instant' | 'list';
  /**
   * `least-loss` (default): sell first what keeps most of its listing value.
   * `fewest`: sell first what raises the most, for fewer sales.
   */
  order?: 'least-loss' | 'fewest';
  /** Item id → units to hold back. */
  reserve?: ReadonlyMap<number, number>;
  /** Names or ids never to sell. */
  keep?: readonly (string | number)[];
  /** Also sell gear, consumables and other non-materials. Legendary and Ascended are never sold. */
  everything?: boolean;
  /** Sales raising less than this are used only when the larger ones fall short. Default 1g. */
  minLine?: number;
}

export interface SaleLine {
  id: number;
  name: string;
  quantity: number;
  /** Units the account has. */
  held: number;
  how: 'instant' | 'list' | 'vendor';
  /** Copper received, after fees. */
  revenue: number;
  /** `revenue` as a share of what listing the same units at the lowest price would bring. */
  kept: number;
}

export interface SalePlan {
  lines: SaleLine[];
  total: number;
  /** Everything sellable under these options, whatever the target. */
  available: number;
  target?: number;
  /** Copper the target is still missing after every sale. */
  short: number;
  method: 'instant' | 'list';
}

const DEFAULT_MIN_LINE = 10_000;
const NEVER_SOLD: ReadonlySet<string> = new Set(['Legendary', 'Ascended']);

/** Selling `units` into the buy orders, fees taken per price level as the game charges them. */
function walkBook(book: readonly { price: number; quantity: number }[], units: number): { revenue: number; filled: number } {
  let revenue = 0;
  let filled = 0;
  for (const level of book) {
    const take = Math.min(level.quantity, units - filled);
    if (take <= 0) break;
    revenue += sellProceeds(level.price * take);
    filled += take;
  }
  return { revenue, filled };
}

/** The best way to sell `units` of one item at once, and what it pays. */
function quote(item: Sellable, units: number, method: 'instant' | 'list'): Omit<SaleLine, 'held' | 'id' | 'name'> | undefined {
  const offers: { how: SaleLine['how']; quantity: number; revenue: number }[] = [];
  if (method === 'list' && item.sell) offers.push({ how: 'list', quantity: units, revenue: sellProceeds(item.sell * units) });
  if (method === 'instant' && item.buy) {
    const walked = walkBook(item.book ?? [{ price: item.buy, quantity: units }], units);
    if (walked.filled > 0) offers.push({ how: 'instant', quantity: walked.filled, revenue: walked.revenue });
  }
  if (item.vendor > 0) offers.push({ how: 'vendor', quantity: units, revenue: item.vendor * units });
  const best = offers.sort((a, b) => b.revenue - a.revenue)[0];
  if (!best || best.revenue <= 0) return undefined;
  const reference = item.sell ?? item.buy;
  const listed = reference ? sellProceeds(reference * best.quantity) : best.revenue;
  return { ...best, kept: listed > 0 ? Math.min(1, best.revenue / listed) : 1 };
}

/** The fewest units of `item` that raise `amount`. */
function unitsFor(item: Sellable, most: number, amount: number, method: 'instant' | 'list'): number {
  let low = 1;
  let high = most;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((quote(item, middle, method)?.revenue ?? 0) >= amount) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Which items to sell, and how many, to raise `options.target`. Pure. */
export function planSales(items: readonly Sellable[], options: SaleOptions = {}): SalePlan {
  const method = options.method ?? 'instant';
  const minLine = options.minLine ?? DEFAULT_MIN_LINE;
  const keep = new Set((options.keep ?? []).map((k) => String(k).trim().toLowerCase()));

  const candidates = items.flatMap((item) => {
    if (!options.everything && !item.material) return [];
    if (item.rarity && NEVER_SOLD.has(item.rarity)) return [];
    if (keep.has(String(item.id)) || keep.has(item.name.toLowerCase())) return [];
    const units = item.count - (options.reserve?.get(item.id) ?? 0);
    if (units <= 0) return [];
    const q = quote(item, units, method);
    return q ? [{ item, line: { id: item.id, name: item.name, held: item.count, ...q } }] : [];
  });

  // Worthwhile sales first, then the preferred order within each group.
  candidates.sort(
    (a, b) =>
      Number(b.line.revenue >= minLine) - Number(a.line.revenue >= minLine) ||
      (options.order === 'fewest' ? 0 : Math.round(b.line.kept * 100) - Math.round(a.line.kept * 100)) ||
      b.line.revenue - a.line.revenue,
  );
  const available = candidates.reduce((sum, c) => sum + c.line.revenue, 0);

  const target = options.target;
  let chosen = candidates;
  if (target !== undefined) {
    chosen = [];
    let raised = 0;
    for (const c of candidates) {
      if (raised >= target) break;
      chosen.push(c);
      raised += c.line.revenue;
    }
    // Drop sales the later, larger ones made unnecessary, worst first.
    for (let i = chosen.length - 2; i >= 0; i--) {
      if (raised - chosen[i]!.line.revenue >= target) raised -= chosen.splice(i, 1)[0]!.line.revenue;
    }
    // Only part of the last sale may be needed.
    const last = chosen.at(-1);
    if (last && raised > target) {
      const wanted = last.line.revenue - (raised - target);
      const units = unitsFor(last.item, last.line.quantity, wanted, method);
      chosen[chosen.length - 1] = { item: last.item, line: { ...last.line, ...quote(last.item, units, method)! } };
    }
  }

  const lines = chosen.map((c) => c.line);
  const total = lines.reduce((sum, l) => sum + l.revenue, 0);
  return {
    lines,
    total,
    available,
    method,
    ...(target !== undefined ? { target } : {}),
    short: target === undefined ? 0 : Math.max(0, target - total),
  };
}

// ---------------------------------------------------------------- reading

export interface Sellables {
  items: Sellable[];
  /** Copper waiting at the trading post to be picked up; absent when not read. */
  delivery?: number;
  /** What could not be read. */
  notes: string[];
}

/** Item types that are materials wherever they sit. */
const MATERIAL_TYPES: ReadonlySet<string> = new Set(['CraftingMaterial', 'Trophy']);
/** Most items whose buy orders are read in depth. */
const DEPTH_ITEMS = 200;

/**
 * Unbound items in material storage, the bank, shared slots and character
 * bags, priced at the trading post. Equipped gear and guild storage are never
 * read. Buy order depth is read for sales worth more than 1g.
 */
export async function readSellables(client: Gw2Client, permissions: readonly Permission[]): Promise<Sellables> {
  const account = { ttlMs: TTL.account };
  const [materials, bank, shared, characters, delivery] = await Promise.all([
    client.get('/v2/account/materials', account).catch(() => undefined),
    client.get('/v2/account/bank', account).catch(() => undefined),
    client.get('/v2/account/inventory', account).catch(() => undefined),
    client.all('/v2/characters', account).catch(() => undefined),
    permissions.includes('tradingpost') ? client.get('/v2/commerce/delivery', account).catch(() => undefined) : undefined,
  ]);
  const notes = [
    materials ? '' : 'material storage unavailable',
    bank ? '' : 'bank unavailable',
    shared ? '' : 'shared inventory slots unavailable',
    characters ? '' : 'character bags unavailable (needs `characters`)',
    delivery ? '' : `trading post delivery box unavailable${permissions.includes('tradingpost') ? '' : ' (needs `tradingpost`)'}`,
  ].filter(Boolean);

  const counts = new Map<number, number>();
  const stored = new Set<number>();
  const add = (id: number, count: number) => counts.set(id, (counts.get(id) ?? 0) + count);
  for (const m of materials ?? []) {
    if (m.count <= 0 || m.binding) continue;
    add(m.id, m.count);
    stored.add(m.id);
  }
  // Bound stacks can't be traded, and the player may be keeping them.
  const slots: (InventorySlot | null)[] = [
    ...(bank ?? []),
    ...(shared ?? []),
    ...(characters ?? []).flatMap((c) => (c.bags ?? []).flatMap((bag) => bag?.inventory ?? [])),
  ];
  for (const slot of slots) if (slot && !slot.binding) add(slot.id, slot.count);

  const [defs, prices] = await Promise.all([client.many('/v2/items', counts.keys()), client.many('/v2/commerce/prices', counts.keys())]);
  const items: Sellable[] = [];
  for (const [id, count] of counts) {
    const def = defs.get(id);
    if (!def) continue;
    const bound = def.flags.includes('AccountBound') || def.flags.includes('SoulbindOnAcquire');
    if (bound) continue;
    const price = prices.get(id);
    items.push({
      id,
      name: def.name,
      count,
      material: stored.has(id) || MATERIAL_TYPES.has(def.type),
      rarity: def.rarity,
      vendor: def.flags.includes('NoSell') ? 0 : def.vendor_value,
      ...(price?.buys.unit_price ? { buy: price.buys.unit_price } : {}),
      ...(price?.sells.unit_price ? { sell: price.sells.unit_price } : {}),
    });
  }

  const deep = items
    .filter((i) => i.buy && i.buy * i.count >= DEFAULT_MIN_LINE)
    .sort((a, b) => b.buy! * b.count - a.buy! * a.count)
    .slice(0, DEPTH_ITEMS);
  const listings = await client.many('/v2/commerce/listings', deep.map((i) => i.id)).catch(() => undefined);
  if (!listings) notes.push('buy order depth unavailable: instant sales assume the top order takes everything');
  for (const item of deep) {
    const buys = listings?.get(item.id)?.buys;
    if (buys) item.book = buys.map((b) => ({ price: b.unit_price, quantity: b.quantity }));
  }
  return { items, notes, ...(delivery ? { delivery: delivery.coins } : {}) };
}

// ---------------------------------------------------------------- rendering

const HOW: Record<SaleLine['how'], string> = { instant: 'to buy orders', list: 'listed', vendor: 'to a vendor' };
/** Sales listed one by one; the rest are totalled. */
const LISTED_SALES = 60;

/** Markdown checklist of the sales, headed by what they raise. */
export function renderSales(sales: SalePlan, options: { heading?: string; delivery?: number; notes?: readonly string[] } = {}): string {
  const head =
    sales.target === 0
      ? 'Nothing needs selling: the gold is already covered.'
      : sales.target === undefined
      ? `Selling everything below raises about **${coins(sales.total)}** after fees.`
      : sales.short > 0
        ? `These sales raise **${coins(sales.total)}** of ${coins(sales.target)}: still **${coins(sales.short)} short** with everything sellable sold.`
        : `These sales raise **${coins(sales.total)}**, covering ${coins(sales.target)}. Up to ${coins(sales.available)} could be raised in all.`;
  const shown = sales.lines.slice(0, LISTED_SALES);
  const lines = shown.map((l) => {
    const kept = l.how === 'vendor' ? '' : `, ${Math.round(l.kept * 100)}% of listing value`;
    const part = l.quantity < l.held ? ` of ${num(l.held)}` : '';
    return `- [ ] Sell ${num(l.quantity)}${part} × ${text(l.name)} ${HOW[l.how]}: ${coins(l.revenue)}${l.how === 'list' ? '' : kept}`;
  });
  const rest = sales.lines.slice(LISTED_SALES);
  if (rest.length) lines.push(`- and ${num(rest.length)} smaller sales worth ${coins(rest.reduce((sum, l) => sum + l.revenue, 0))}`);
  return [
    `## ${cell(options.heading ?? 'Raise gold')}`,
    head,
    options.delivery ? `Pick up first: ${coins(options.delivery)} is waiting in the trading post delivery box.` : '',
    sales.method === 'list' ? 'Listed sales pay only when a buyer takes them, which can be days.' : '',
    lines.join('\n') || (sales.target === 0 ? '' : '_Nothing sellable._'),
    // Notes are our own sentences, with code spans to keep.
    options.notes?.length ? `Not read: ${options.notes.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
