/**
 * Raising gold by spending a wallet currency: craft what it pays toward, from
 * materials bought with gold, and sell it. What each output takes and how many
 * trade per day come from a snapshot (currency-paths-data.ts); prices, the
 * wallet and what the account can craft are the caller's. Pure;
 * `readSalesPaths` in sales-paths-read.ts gathers them.
 */
import type { MarketItem } from './convert.js';
import { sellProceeds } from './fees.js';
import { coins, num, text } from './format.js';

export interface CurrencyPath {
  /** Wallet currency the path is there to spend. */
  currency: number;
  /** Item crafted and sold. */
  output: number;
  name: string;
  /** Per unit, by wallet currency id; 1 is coin paid to vendors, in copper. */
  currencies: readonly (readonly [id: number, amount: number])[];
  /** Bought on the trading post, per unit. */
  items: readonly (readonly [id: number, count: number, name: string])[];
  /** Needed and not for sale (bound or random): a path with any is never used. */
  unobtainable: readonly (readonly [id: number, name: string, count: number])[];
  /** Daily, weekly and other limits on getting the parts: a path with any is never used. */
  limits: readonly string[];
  crafts: readonly {
    /** The /v2/recipes ids of this recipe; any one of them unlocked is enough. */
    recipes: readonly number[];
    name: string;
    /** Any one of these, at `rating`. */
    disciplines: readonly string[];
    rating: number;
    /** Not learned automatically. */
    unlock: boolean;
  }[];
  /** Units traded per day on average: listings bought, and instant sales to buy orders. */
  volume: { list: number; instant: number; from: string; to: string; days: number };
}

export interface SalesPathData {
  paths: readonly CurrencyPath[];
  currencyNames: Readonly<Record<number, string>>;
  /** Outputs and inputs; `book` is the outputs' buy orders. */
  market: ReadonlyMap<number, MarketItem>;
  /** Currency id → balance, coin (1) included; without coin, gold up front is not limited. */
  wallet: Readonly<Record<number, number>>;
  /** Highest rating per discipline; absent when unknown. */
  ratings?: ReadonlyMap<string, number>;
  /** Unlocked recipe ids; absent when unknown. */
  learned?: ReadonlySet<number>;
}

/** The share of daily volume to sell, and how many days of it to wait out. */
export const DEFAULT_PATH_SHARE = 0.1;
export const DEFAULT_PATH_DAYS = 7;

const COIN = 1;

export interface PathOptions {
  method?: 'instant' | 'list';
  share?: number;
  days?: number;
  /** Currency id → balance spoken for. */
  reserve?: ReadonlyMap<number, number>;
  /** Output names or ids not to make for sale. */
  keep?: readonly (string | number)[];
}

export interface PathSale {
  path: CurrencyPath;
  units: number;
  /** Most units the volume allows. */
  cap: number;
  /** Gold per unit for materials and vendors, in copper. */
  unitCost: number;
  /** Listing fee per unit, paid when listing; already inside the profit. */
  unitFee: number;
  /** Profit of the first, second, ... unit: sale after fees, less `unitCost`. */
  profits: number[];
}

export type PathBinding =
  /** One more `name` is worth making but takes this much more of these. */
  | { kind: 'currency'; name: string; short: { id: number; name: string; amount: number }[]; profit: number }
  /** Another unit would pay, but the volume cap is reached; `days` of waiting would allow one more. */
  | { kind: 'cap'; name: string; cap: number; days: number };

export interface PathPlan {
  method: 'instant' | 'list';
  share: number;
  days: number;
  sales: PathSale[];
  profit: number;
  /** Gold to spend before anything sells: materials, vendor coin and listing fees. */
  upfront: number;
  binding: PathBinding[];
  /** Paths that can't be used, and why. */
  blocked: { name: string; reason: string }[];
  /** Currencies the paths take that were held back, and how much of each. */
  reserved: { name: string; amount: number }[];
  /** The dates the trade volumes cover. */
  volume: { from: string; to: string };
  currencyNames: Readonly<Record<number, string>>;
  /** What the account was not checked for. */
  unchecked: { ratings: boolean; unlocks: boolean };
}

/** Copper after fees for selling `units`; undefined when the buy orders run out first. */
function proceeds(item: MarketItem, units: number, method: 'instant' | 'list'): number | undefined {
  if (units === 0) return 0;
  if (method === 'list') return item.sell ? sellProceeds(item.sell * units) : undefined;
  if (!item.buy) return undefined;
  let left = units;
  let total = 0;
  for (const level of item.book ?? [{ price: item.buy, quantity: units }]) {
    const take = Math.min(level.quantity, left);
    if (take <= 0) break;
    total += sellProceeds(level.price * take);
    left -= take;
  }
  return left > 0 ? undefined : total;
}

/** Most units of an output to sell: a share of what trades in the days waited. */
export function pathCap(volume: number, share = DEFAULT_PATH_SHARE, days = DEFAULT_PATH_DAYS): number {
  return volume > 0 && share > 0 && days > 0 ? Math.max(1, Math.floor(share * days * volume + 1e-9)) : 0;
}

/** Discipline requirements of a path, without those another one already implies. */
export function pathDisciplines(path: CurrencyPath): string {
  const needs = path.crafts.map((c) => ({ any: [...c.disciplines].sort(), rating: c.rating }));
  const single = needs.filter((n) => n.any.length === 1);
  const shown = needs.filter((n) => n.any.length === 1 || !single.some((s) => n.any.includes(s.any[0]!) && s.rating >= n.rating));
  const best = new Map<string, number>();
  for (const n of shown) {
    const names = n.any.length > 3 ? `${n.any.slice(0, 2).join('/')} or ${n.any.length - 2} more` : n.any.join('/');
    best.set(names, Math.max(best.get(names) ?? 0, n.rating));
  }
  return [...best].map(([names, rating]) => `${names} ${rating}`).join(', ');
}

function blocker(path: CurrencyPath, data: SalesPathData): string | undefined {
  if (path.unobtainable.length) return `needs ${path.unobtainable.map(([, name]) => name).join(', ')}, which can't be bought`;
  if (path.limits.length) return `limited: ${path.limits.join('; ')}`;
  const skill = data.ratings;
  if (skill) {
    const missing = path.crafts.find((c) => !c.disciplines.some((d) => (skill.get(d) ?? -1) >= c.rating));
    if (missing) return `needs ${missing.disciplines.join('/')} ${missing.rating}`;
  }
  if (data.learned) {
    const locked = path.crafts.filter((c) => c.unlock && !c.recipes.some((id) => data.learned!.has(id)));
    if (locked.length) return `recipes not unlocked: ${locked.map((c) => c.name).join(', ')}`;
  }
  const unpriced = path.items.find(([id]) => !data.market.get(id)?.sell);
  if (unpriced) return `${unpriced[2]} has no listing to buy`;
  return undefined;
}

/**
 * How many of which outputs to make and sell for the most gold: each only while
 * it profits and within its volume cap, with the currencies and gold held shared
 * between them, the best profit for the scarcest currency first. Pure.
 */
export function planSalesPaths(data: SalesPathData, options: PathOptions = {}): PathPlan {
  const method = options.method ?? 'instant';
  const share = options.share ?? DEFAULT_PATH_SHARE;
  const days = options.days ?? DEFAULT_PATH_DAYS;
  const keep = new Set((options.keep ?? []).map((k) => String(k).trim().toLowerCase()));
  const blocked: PathPlan['blocked'] = [];

  const open: (PathSale & { takes: [number, number][]; volume: number })[] = [];
  for (const path of data.paths) {
    if (keep.has(String(path.output)) || keep.has(path.name.toLowerCase())) continue;
    const output = data.market.get(path.output);
    const volume = method === 'list' ? path.volume.list : path.volume.instant;
    const cap = pathCap(volume, share, days);
    const reason =
      blocker(path, data) ??
      (cap === 0 ? 'none were sold in the volume snapshot' : undefined) ??
      (!output || !(method === 'list' ? output.sell : output.buy) ? 'nothing to price the sale by' : undefined);
    if (reason) {
      blocked.push({ name: path.name, reason });
      continue;
    }
    const vendorCoin = path.currencies.find(([id]) => id === COIN)?.[1] ?? 0;
    const unitCost = path.items.reduce((sum, [id, count]) => sum + data.market.get(id)!.sell! * count, vendorCoin);
    const unitFee = method === 'list' ? Math.max(1, Math.round(output!.sell! * 0.05)) : 0;
    const takes: [number, number][] = path.currencies.filter(([id]) => id !== COIN).map(([id, amount]) => [id, amount]);
    if (data.wallet[COIN] !== undefined) takes.push([COIN, unitCost + unitFee]);
    open.push({ path, units: 0, cap, unitCost, unitFee, profits: [], takes, volume });
  }

  const left = new Map<number, number>();
  for (const [id, value] of Object.entries(data.wallet)) {
    left.set(Number(id), Math.max(0, value - (options.reserve?.get(Number(id)) ?? 0)));
  }
  const start = new Map(left);
  /** Profit of one more unit; undefined when the buy orders can't take it. */
  const next = (s: (typeof open)[number]): number | undefined => {
    const item = data.market.get(s.path.output)!;
    const more = proceeds(item, s.units + 1, method);
    return more === undefined ? undefined : more - proceeds(item, s.units, method)! - s.unitCost;
  };
  const affordable = (s: (typeof open)[number]) => s.takes.every(([id, amount]) => amount <= (left.get(id) ?? 0));

  for (;;) {
    let best: { sale: (typeof open)[number]; profit: number; score: number } | undefined;
    for (const sale of open) {
      const profit = sale.units < sale.cap ? next(sale) : undefined;
      if (profit === undefined || profit <= 0 || !affordable(sale)) continue;
      // The share of the scarcest thing it takes.
      const weight = Math.max(1e-9, ...sale.takes.map(([id, amount]) => amount / start.get(id)!));
      const score = profit / weight;
      if (!best || score > best.score) best = { sale, profit, score };
    }
    if (!best) break;
    best.sale.units++;
    best.sale.profits.push(best.profit);
    for (const [id, amount] of best.sale.takes) left.set(id, left.get(id)! - amount);
  }

  const binding: PathBinding[] = [];
  const wanting = open
    .map((sale) => ({ sale, profit: next(sale) ?? 0 }))
    .filter((w) => w.profit > 0)
    .sort((a, b) => b.profit - a.profit);
  const short = wanting.find((w) => w.sale.units < w.sale.cap);
  if (short) {
    binding.push({
      kind: 'currency',
      name: short.sale.path.name,
      profit: short.profit,
      short: short.sale.takes
        .filter(([id, amount]) => amount > (left.get(id) ?? 0))
        .map(([id, amount]) => ({ id, name: id === COIN ? 'gold' : (data.currencyNames[id] ?? `currency ${id}`), amount: amount - (left.get(id) ?? 0) })),
    });
  }
  for (const { sale } of wanting) {
    if (sale.units < sale.cap) continue;
    binding.push({ kind: 'cap', name: sale.path.name, cap: sale.cap, days: Math.ceil((sale.cap + 1) / (share * sale.volume) - 1e-9) });
  }

  const sales: PathSale[] = open
    .filter((s) => s.units > 0)
    .map(({ takes: _takes, volume: _volume, ...sale }) => sale)
    .sort((a, b) => total(b.profits) - total(a.profits));
  const dates = data.paths.flatMap((p) => [p.volume.from, p.volume.to]).sort();
  return {
    method,
    share,
    days,
    sales,
    profit: sales.reduce((sum, s) => sum + total(s.profits), 0),
    upfront: sales.reduce((sum, s) => sum + (s.unitCost + s.unitFee) * s.units, 0),
    binding,
    blocked,
    reserved: [...(options.reserve ?? [])]
      .filter(([id, amount]) => amount > 0 && data.paths.some((p) => p.currencies.some(([c]) => c === id && c !== COIN)))
      .map(([id, amount]) => ({ name: data.currencyNames[id] ?? `currency ${id}`, amount })),
    volume: { from: dates[0] ?? '', to: dates.at(-1) ?? '' },
    currencyNames: data.currencyNames,
    unchecked: {
      ratings: !data.ratings,
      unlocks: !data.learned && data.paths.some((p) => p.crafts.some((c) => c.unlock)),
    },
  };
}

const total = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0);

// ---------------------------------------------------------------- rendering

/** One checklist line for making and selling `units` of a path's output. */
export function pathText(sale: PathSale, units: number, how: string, names: PathPlan['currencyNames']): string {
  const { path } = sale;
  const profit = total(sale.profits.slice(0, units));
  const cost = sale.unitCost * units;
  const fee = sale.unitFee * units;
  const spends = path.currencies
    .filter(([id]) => id !== COIN)
    .map(([id, amount]) => `${num(amount * units)} ${text(names[id] ?? `currency ${id}`)}`);
  const unlock = path.crafts.some((c) => c.unlock) ? '; recipes must be unlocked' : '';
  const buys = path.items.map(([, count, name]) => `${num(count * units)} × ${text(name)}`).join(', ');
  const vendor = path.currencies.find(([id]) => id === COIN)?.[1];
  return [
    `- [ ] Craft ${num(units)} × ${text(path.name)} (${pathDisciplines(path)}${unlock}) and sell ${how}: ` +
      `about **${coins(profit)} profit** (${coins(profit + cost)} after fees, less ${coins(cost)} spent first)`,
    `  - Spends ${spends.join(', ')}`,
    `  - Buy first: ${buys}${vendor ? `, and pay vendors ${coins(vendor * units)}` : ''}`,
    fee ? `  - Listing fee paid up front: ${coins(fee)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

/** The caveats and limits under the sales; `full`: every unit the paths found is in them. */
export function pathNotes(plan: PathPlan, upfront: number, full: boolean): string {
  const lines = [
    `- Gold needed up front: **${coins(upfront)}**.`,
    `- Estimates: prices are today's, materials are priced at the lowest listing, and trade volume is a snapshot of ${plan.volume.from} to ${plan.volume.to}. ` +
      `Each item is capped at ${percent(plan.share)} of ${num(plan.days)} days of ${plan.method === 'list' ? 'listing' : 'instant sale'} volume, at least 1.` +
      (plan.method === 'list' ? ' Listings can take that long to sell, or longer.' : ''),
  ];
  if (full) {
    for (const b of plan.binding) {
      if (b.kind === 'cap') {
        lines.push(`- ${text(b.name)}: at its volume cap of ${num(b.cap)}. One more would take waiting ${num(b.days)} days (or a larger share).`);
      } else if (b.short.length) {
        const more = b.short.map((s) => (s.id === COIN ? `${coins(s.amount)} more gold` : `${num(s.amount)} more ${text(s.name)}`));
        lines.push(`- Binding: one more ${text(b.name)} (about ${coins(b.profit)} profit) needs ${more.join(' and ')}.`);
      }
    }
  }
  const unchecked = [plan.unchecked.ratings ? 'crafting ratings (needs `characters`)' : '', plan.unchecked.unlocks ? 'recipe unlocks (needs `unlocks`)' : ''].filter(Boolean);
  if (unchecked.length) lines.push(`- Not checked: ${unchecked.join(' and ')}.`);
  lines.push(...reservedText(plan), ...blockedText(plan));
  lines.push('- Buying items straight from vendors with these currencies is not considered: it is worth far less and needs weekly unlocks.');
  return lines.join('\n');
}

export function reservedText(plan: PathPlan): string[] {
  if (!plan.reserved.length) return [];
  return [`- Held back first, for the crafting plan and promotions: ${plan.reserved.map((r) => `${num(r.amount)} ${text(r.name)}`).join(', ')}.`];
}

/** Paths ruled out, grouped by reason. */
function blockedText(plan: PathPlan): string[] {
  const reasons = new Map<string, string[]>();
  for (const b of plan.blocked) (reasons.get(b.reason) ?? reasons.set(b.reason, []).get(b.reason)!).push(b.name);
  return [...reasons].map(([reason, names]) => `- Left out, ${text(reason)}: ${names.map(text).join(', ')}.`);
}
