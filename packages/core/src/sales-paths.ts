/**
 * Raising gold by spending a currency: on a craft, on something a vendor sells
 * that can be sold on, or on containers whose contents are sold. What each
 * path takes, what containers hold on average and how much of everything trades
 * per day come from a snapshot (currency-paths-data.ts); prices, what the
 * account holds and what it can craft are the caller's. Pure; `readSalesPaths`
 * in sales-paths-read.ts gathers them.
 */
import type { MarketItem } from './convert.js';
import { sellProceeds } from './fees.js';
import { coins, num, text } from './format.js';

/** The average contents of a container, from openings recorded on the wiki. */
export interface PathContents {
  /** Containers opened for the average. */
  sample: number;
  /** Title of the wiki page the openings are recorded on. */
  source: string;
  /** Per container; `list` and `instant` are units traded per day, 0 for what can't be sold. */
  yields: readonly (readonly [id: number, name: string, count: number, vendor: number, list: number, instant: number])[];
}

export interface CurrencyPath {
  /** The currency the path is there to spend: a wallet currency id, or the item id of one in `itemCurrencies`. */
  currency: number;
  /** Item crafted or bought to sell; with `contents`, the container opened. */
  output: number;
  name: string;
  /** Units of `output` in one unit of the path. Default 1. */
  batch?: number;
  /** Who sells what the currency is spent on, as the wiki names them. */
  vendor?: string;
  /** What has to be got first. */
  how?: string;
  /** Per unit, by currency id; 1 is coin paid to vendors, in copper. */
  currencies: readonly (readonly [id: number, amount: number])[];
  /** Bought on the trading post, per unit. */
  items: readonly (readonly [id: number, count: number, name: string])[];
  /** Needed and not for sale (bound or random): a path with any is never used. */
  unobtainable: readonly (readonly [id: number, name: string, count: number])[];
  /** Purchase limits: how much of one a unit takes, and the most in a week. Paths naming the same one share it. */
  limits: readonly (readonly [name: string, perUnit: number, perWeek: number])[];
  /** Empty when nothing has to be crafted. */
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
  /** Units of `output` traded per day on average: listings bought, and instant sales to buy orders. Absent for containers. */
  volume?: { list: number; instant: number; from: string; to: string; days: number };
  contents?: PathContents;
}

/** Something a currency buys that is not a path, and why. */
export type LeftOut = readonly [currency: number, name: string, reason: string];

export interface SalesPathData {
  paths: readonly CurrencyPath[];
  currencyNames: Readonly<Record<number, string>>;
  /** Outputs, inputs and contents; `book` is their buy orders. */
  market: ReadonlyMap<number, MarketItem>;
  /** Currency id → balance, coin (1) included; without coin, gold up front is not limited. */
  wallet: Readonly<Record<number, number>>;
  /** Highest rating per discipline; absent when unknown. */
  ratings?: ReadonlyMap<string, number>;
  /** Unlocked recipe ids; absent when unknown. */
  learned?: ReadonlySet<number>;
  /** Ids in `wallet` that are account-bound items spent like a currency. */
  itemCurrencies?: readonly number[];
  leftOut?: readonly LeftOut[];
  /** When the drop rates were read. */
  asOf?: string;
  /** The days the contents' trade volumes cover. */
  contentDates?: { from: string; to: string };
}

/** The share of daily volume to sell, and how many days of it to wait out. */
export const DEFAULT_PATH_SHARE = 0.1;
export const DEFAULT_PATH_DAYS = 7;
/** Another container is opened only while it raises at least this much of what the first would. */
const WORTH_OPENING = 0.5;

const COIN = 1;

export interface PathOptions {
  method?: 'instant' | 'list';
  share?: number;
  days?: number;
  /** Currency id → balance spoken for. */
  reserve?: ReadonlyMap<number, number>;
  /** Names or ids not to make, buy or sell. */
  keep?: readonly (string | number)[];
  /** Paths that need gold spent first. Default true. */
  gold?: boolean;
  /** Paths that need only currencies. Default true. */
  free?: boolean;
  /** Item id → units other sales already put into its buy orders. */
  taken?: ReadonlyMap<number, number>;
}

export interface PathSale {
  path: CurrencyPath;
  /** Times the path is done: `units × batch` of `path.name`. */
  units: number;
  /** Most units the volume or the purchase limit allows; Infinity for containers without a limit. */
  cap: number;
  /** Gold per unit for materials and vendors, in copper; 0 when none is needed. */
  unitCost: number;
  /** Listing fee per unit, paid when listing; already inside the profit. */
  unitFee: number;
  /** Profit of the first, second, ... unit: sale after fees, less `unitCost`. */
  profits: number[];
  /** For containers: what all units are expected to hold that is worth anything. */
  expected?: { name: string; sell: number; vendor: number; revenue: number }[];
}

export type PathBinding =
  /** One more `name` is worth making but takes this much more of these. */
  | { kind: 'currency'; name: string; short: { id: number; name: string; amount: number }[]; profit: number }
  /** Another unit would pay, but the volume cap is reached; `days` of waiting would allow one more. */
  | { kind: 'cap'; name: string; cap: number; days: number }
  /** The contents of more would be more than can be sold. */
  | { kind: 'contents'; name: string; units: number }
  /** The vendor sells no more this week. */
  | { kind: 'limit'; name: string; limit: string; perWeek: number };

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
  /** What the currencies held also buy that is not a path. */
  leftOut: { currency: string; name: string; reason: string }[];
  /** Currencies the paths take that were held back, and how much of each. */
  reserved: { name: string; amount: number }[];
  /** The dates the trade volumes cover. */
  volume: { from: string; to: string };
  asOf?: string;
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
  for (const level of item.book ?? [{ price: item.buy, quantity: Infinity }]) {
    const take = Math.min(level.quantity, left);
    if (take <= 0) break;
    total += sellProceeds(level.price * take);
    left -= take;
  }
  return left > 0 ? undefined : total;
}

/** What is kept of a price after fees, for expected (fractional) quantities. */
const NET = 0.85;

/**
 * Copper for `units` more of an item after `from` of it: from buy orders worth
 * more than `floor`, or at the lowest listing. `sold` is how many that takes.
 */
function expectedProceeds(item: MarketItem, from: number, units: number, method: 'instant' | 'list', floor: number): { revenue: number; sold: number } {
  const price = method === 'list' ? item.sell : item.buy;
  if (!price || price * NET <= floor) return { revenue: 0, sold: 0 };
  if (method === 'list' || !item.book) return { revenue: price * NET * units, sold: units };
  let start = 0;
  let revenue = 0;
  let sold = 0;
  for (const level of item.book) {
    if (level.price * NET <= floor || sold >= units) break;
    const take = Math.min(start + level.quantity, from + units) - Math.max(start, from);
    if (take > 0) {
      revenue += level.price * NET * take;
      sold += take;
    }
    start += level.quantity;
  }
  return { revenue, sold };
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
  const skill = data.ratings;
  if (skill) {
    const missing = path.crafts.find((c) => !c.disciplines.some((d) => (skill.get(d) ?? -1) >= c.rating));
    if (missing) return `needs ${missing.disciplines.join('/')} ${missing.rating}`;
  }
  if (data.learned) {
    const locked = path.crafts.filter((c) => c.unlock && !c.recipes.some((id) => data.learned!.has(id)));
    // The paths' own names are listed after the reason, so alike ones group.
    if (locked.length === 1 && locked[0]!.name === path.name) return 'recipe not unlocked';
    if (locked.length) return `recipes not unlocked: ${locked.map((c) => c.name).join(', ')}`;
  }
  const unpriced = path.items.find(([id]) => !data.market.get(id)?.sell);
  if (unpriced) return `${unpriced[2]} has no listing to buy`;
  return undefined;
}

/** What one more unit of a path would sell, given what is already being sold. */
interface Step {
  profit: number;
  revenue: number;
  /** Item id → units it adds to the market. */
  sells: [number, number][];
  parts: { name: string; sell: number; vendor: number; revenue: number }[];
  /** Listing fee. */
  fee: number;
}

/**
 * How much of which paths to do for the most gold: each only while it profits,
 * with the currencies and gold held, the vendors' weekly limits and each item's
 * volume cap shared between them, the best profit for the scarcest currency
 * first. Pure.
 */
export function planSalesPaths(data: SalesPathData, options: PathOptions = {}): PathPlan {
  const method = options.method ?? 'instant';
  const share = options.share ?? DEFAULT_PATH_SHARE;
  const days = options.days ?? DEFAULT_PATH_DAYS;
  const keep = new Set((options.keep ?? []).map((k) => String(k).trim().toLowerCase()));
  const kept = (id: number, name: string) => keep.has(String(id)) || keep.has(name.toLowerCase());
  const blocked: PathPlan['blocked'] = [];
  const weeks = Math.max(1, Math.floor(days / 7));
  /** Item id → units these paths put on the market. */
  const selling = new Map<number, number>();
  const offset = (id: number) => (method === 'instant' ? (options.taken?.get(id) ?? 0) : 0);

  /** The next unit of a path when `already(id)` of each item are being sold; undefined when it can't be sold. */
  const stepOf = (path: CurrencyPath, unitCost: number, already: (id: number) => number): Step | undefined => {
    const batch = path.batch ?? 1;
    if (!path.contents) {
      const item = data.market.get(path.output)!;
      const from = offset(path.output) + already(path.output);
      const before = proceeds(item, from, method);
      const after = proceeds(item, from + batch, method);
      if (before === undefined || after === undefined) return undefined;
      const revenue = after - before;
      const fee = method === 'list' ? Math.max(1, Math.round(item.sell! * batch * 0.05)) : 0;
      return { revenue, profit: revenue - unitCost, sells: [[path.output, batch]], parts: [], fee };
    }
    const sells: Step['sells'] = [];
    const parts: Step['parts'] = [];
    let revenue = 0;
    let fee = 0;
    for (const [id, name, count, vendor, list, instant] of path.contents.yields) {
      if (kept(id, name)) continue;
      const units = count * batch;
      const item = data.market.get(id);
      const volume = method === 'list' ? list : instant;
      const room = Math.max(0, pathCap(volume, share, days) - already(id));
      const sale = item && room > 0 ? expectedProceeds(item, offset(id) + already(id), Math.min(units, room), method, vendor) : { revenue: 0, sold: 0 };
      const rest = units - sale.sold;
      const got = sale.revenue + rest * vendor;
      if (sale.sold) sells.push([id, sale.sold]);
      if (method === 'list') fee += (sale.revenue / NET) * 0.05;
      if (got > 0) parts.push({ name, sell: sale.sold, vendor: vendor > 0 ? rest : 0, revenue: got });
      revenue += got;
    }
    revenue = Math.floor(revenue);
    return { revenue, profit: revenue - unitCost, sells, parts, fee: Math.round(fee) };
  };

  interface Open extends PathSale {
    takes: [number, number][];
    /** Units per day, for outputs sold as they are. */
    volume: number;
    /** What the first unit would raise with nothing else being sold. */
    first: number;
    parts: Map<string, { name: string; sell: number; vendor: number; revenue: number }>;
  }
  const open: Open[] = [];
  for (const path of data.paths) {
    if (kept(path.output, path.name)) continue;
    const vendorCoin = path.currencies.find(([id]) => id === COIN)?.[1] ?? 0;
    const needsGold = vendorCoin > 0 || path.items.length > 0;
    if (needsGold ? options.gold === false : options.free === false) continue;
    const batch = path.batch ?? 1;
    const output = data.market.get(path.output);
    const volume = path.contents ? 0 : ((method === 'list' ? path.volume?.list : path.volume?.instant) ?? 0);
    const most = path.contents ? Infinity : pathCap(volume, share, days);
    const reason =
      blocker(path, data) ??
      (most === 0 ? 'none were sold in the volume snapshot' : undefined) ??
      (!path.contents && !(method === 'list' ? output?.sell : output?.buy) ? 'nothing to price the sale by' : undefined);
    if (reason) {
      blocked.push({ name: path.name, reason });
      continue;
    }
    const unitCost = path.items.reduce((sum, [id, count]) => sum + data.market.get(id)!.sell! * count, vendorCoin);
    const first = stepOf(path, unitCost, () => 0);
    const unitFee = first?.fee ?? 0;
    const takes: [number, number][] = path.currencies.filter(([id]) => id !== COIN).map(([id, amount]) => [id, amount]);
    if (data.wallet[COIN] !== undefined && unitCost + unitFee > 0) takes.push([COIN, unitCost + unitFee]);
    const cap = Math.min(
      path.contents ? Infinity : Math.max(1, Math.floor(most / batch)),
      ...path.limits.map(([, perUnit, perWeek]) => Math.floor((perWeek * weeks) / perUnit)),
    );
    open.push({ path, units: 0, cap, unitCost, unitFee, profits: [], takes, volume, first: first?.revenue ?? 0, parts: new Map() });
  }

  const left = new Map<number, number>();
  for (const [id, value] of Object.entries(data.wallet)) {
    left.set(Number(id), Math.max(0, value - (options.reserve?.get(Number(id)) ?? 0)));
  }
  const start = new Map(left);
  /** Limit name → how much of it is used. */
  const bought = new Map<string, number>();
  const already = (id: number) => selling.get(id) ?? 0;
  const next = (s: Open) => stepOf(s.path, s.unitCost, already);
  const worth = (s: Open, step: Step) => step.profit > 0 && (!s.path.contents || step.revenue >= s.first * WORTH_OPENING);
  const reached = (s: Open) =>
    s.path.limits.find(([name, perUnit, perWeek]) => (bought.get(name) ?? 0) + perUnit > perWeek * weeks);
  const affordable = (s: Open) => s.takes.every(([id, amount]) => amount <= (left.get(id) ?? 0));

  for (;;) {
    let best: { sale: Open; step: Step; score: number } | undefined;
    for (const sale of open) {
      if (sale.units >= sale.cap || reached(sale) || !affordable(sale)) continue;
      const step = next(sale);
      if (!step || !worth(sale, step)) continue;
      // The share of the scarcest thing it takes.
      const weight = Math.max(1e-9, ...sale.takes.map(([id, amount]) => amount / start.get(id)!));
      const score = step.profit / weight;
      if (!best || score > best.score) best = { sale, step, score };
    }
    if (!best) break;
    const { sale, step } = best;
    sale.units++;
    sale.profits.push(step.profit);
    for (const [id, amount] of sale.takes) left.set(id, left.get(id)! - amount);
    for (const [name, perUnit] of sale.path.limits) bought.set(name, (bought.get(name) ?? 0) + perUnit);
    for (const [id, units] of step.sells) selling.set(id, already(id) + units);
    for (const part of step.parts) {
      const sum = sale.parts.get(part.name) ?? { name: part.name, sell: 0, vendor: 0, revenue: 0 };
      sum.sell += part.sell;
      sum.vendor += part.vendor;
      sum.revenue += part.revenue;
      sale.parts.set(part.name, sum);
    }
  }

  const binding: PathBinding[] = [];
  /** One short-of-currency note for each currency. */
  const short = new Map<number, { sale: Open; profit: number }>();
  const full: PathBinding[] = [];
  // Those another unit would earn most from are said first.
  const wanting = open.map((sale) => ({ sale, step: next(sale) }));
  wanting.sort((a, b) => (b.step?.profit ?? 0) - (a.step?.profit ?? 0));
  for (const { sale, step } of wanting) {
    const limit = reached(sale);
    if (limit && step && worth(sale, step)) {
      full.push({ kind: 'limit', name: sale.path.name, limit: limit[0], perWeek: limit[2] });
    } else if (sale.path.contents) {
      if (step && worth(sale, step)) {
        const best = short.get(sale.path.currency);
        if (!best || step.profit > best.profit) short.set(sale.path.currency, { sale, profit: step.profit });
      } else if (sale.units > 0) full.push({ kind: 'contents', name: sale.path.name, units: sale.units * (sale.path.batch ?? 1) });
    } else if (step && step.profit > 0) {
      if (sale.units < sale.cap) {
        const best = short.get(sale.path.currency);
        if (!best || step.profit > best.profit) short.set(sale.path.currency, { sale, profit: step.profit });
      } else {
        const batch = sale.path.batch ?? 1;
        full.push({ kind: 'cap', name: sale.path.name, cap: sale.cap * batch, days: Math.ceil(((sale.cap + 1) * batch) / (share * sale.volume) - 1e-9) });
      }
    }
  }
  for (const { sale, profit } of [...short.values()].sort((a, b) => b.profit - a.profit)) {
    binding.push({
      kind: 'currency',
      name: sale.path.name,
      profit,
      short: sale.takes
        .filter(([id, amount]) => amount > (left.get(id) ?? 0))
        .map(([id, amount]) => ({ id, name: id === COIN ? 'gold' : (data.currencyNames[id] ?? `currency ${id}`), amount: amount - (left.get(id) ?? 0) })),
    });
  }
  binding.push(...full);

  const sales: PathSale[] = open
    .filter((s) => s.units > 0)
    .map(({ takes: _takes, volume: _volume, first: _first, parts, ...sale }) => ({
      ...sale,
      ...(sale.path.contents ? { expected: [...parts.values()].sort((a, b) => b.revenue - a.revenue) } : {}),
    }))
    .sort((a, b) => total(b.profits) - total(a.profits));
  const volumes = data.paths.flatMap((p) => (p.volume ? [p.volume] : []));
  if (data.contentDates && data.paths.some((p) => p.contents)) volumes.push({ ...data.contentDates, list: 0, instant: 0, days: 0 });
  const dates = volumes.flatMap((v) => [v.from, v.to]).sort();
  const name = (id: number) => data.currencyNames[id] ?? `currency ${id}`;
  return {
    method,
    share,
    days,
    sales,
    profit: sales.reduce((sum, s) => sum + total(s.profits), 0),
    upfront: sales.reduce((sum, s) => sum + (s.unitCost + s.unitFee) * s.units, 0),
    binding,
    blocked,
    leftOut: (data.leftOut ?? [])
      .filter(([currency]) => (data.wallet[currency] ?? 0) > 0)
      .map(([currency, item, reason]) => ({ currency: name(currency), name: item, reason })),
    reserved: [...(options.reserve ?? [])]
      .filter(([id, amount]) => amount > 0 && data.paths.some((p) => p.currencies.some(([c]) => c === id && c !== COIN)))
      .map(([id, amount]) => ({ name: name(id), amount })),
    volume: { from: dates[0] ?? '', to: dates.at(-1) ?? '' },
    ...(data.asOf ? { asOf: data.asOf } : {}),
    currencyNames: data.currencyNames,
    unchecked: {
      ratings: !data.ratings && data.paths.some((p) => p.crafts.length > 0),
      unlocks: !data.learned && data.paths.some((p) => p.crafts.some((c) => c.unlock)),
    },
  };
}

const total = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0);

// ---------------------------------------------------------------- rendering

/** Contents named on a container's line; the rest are totalled. */
const NAMED_CONTENTS = 6;

const quantity = (n: number) => (n >= 9.5 ? num(Math.round(n)) : num(Math.round(n * 10) / 10));

/** One checklist line for doing `units` of a path. */
export function pathText(sale: PathSale, units: number, how: string, names: PathPlan['currencyNames']): string {
  const { path } = sale;
  const profit = total(sale.profits.slice(0, units));
  const cost = sale.unitCost * units;
  const fee = sale.unitFee * units;
  const count = units * (path.batch ?? 1);
  const spends = path.currencies
    .filter(([id]) => id !== COIN)
    .map(([id, amount]) => `${num(amount * units)} ${text(names[id] ?? `currency ${id}`)}`);
  const vendorCoin = path.currencies.find(([id]) => id === COIN)?.[1];
  const buys = path.items.map(([, each, name]) => `${num(each * units)} × ${text(name)}`).join(', ');
  const vendor = path.vendor ? ` from ${text(path.vendor)}` : '';
  const earned = cost ? `about **${coins(profit)} profit** (${coins(profit + cost)} after fees, less ${coins(cost)} spent first)` : `about **${coins(profit)}** after fees`;

  let head: string;
  if (path.crafts.length) {
    const unlock = path.crafts.some((c) => c.unlock) ? '; recipes must be unlocked' : '';
    head = `Craft ${num(count)} × ${text(path.name)} (${pathDisciplines(path)}${unlock}) and sell ${how}: ${earned}`;
  } else if (path.contents) {
    head = `Buy ${num(count)} × ${text(path.name)}${vendor}, open them and sell what is inside ${how}: ${earned}, on average`;
  } else {
    head = `Buy ${num(count)} × ${text(path.name)}${vendor} and sell ${how}: ${earned}`;
  }

  let expected = '';
  if (path.contents && sale.expected) {
    // A share of the units is expected to hold that share of the contents.
    const part = units / sale.units;
    // What there is at least one of, the most valuable first.
    const shown = sale.expected.filter((e) => (e.sell + e.vendor) * part >= 0.5).slice(0, NAMED_CONTENTS);
    const rest = sale.expected.length - shown.length;
    const list = shown.map((e) => `${quantity((e.sell + e.vendor) * part)} × ${text(e.name)}`).join(', ');
    expected =
      (list ? `  - Expect about ${list}${rest ? ` and ${num(rest)} other kinds` : ''}\n` : '') +
      `  - An average of ${num(path.contents.sample)} openings recorded on the wiki page ${text(path.contents.source)}; yours will differ`;
  }
  const paid = [buys ? `buy ${buys}` : '', vendorCoin ? `pay the vendor ${coins(vendorCoin * units)}` : ''].filter(Boolean).join(' and ');
  return [
    `- [ ] ${head}`,
    path.how ? `  - First, ${text(path.how)}` : '',
    `  - Spends ${spends.join(', ')}`,
    paid ? `  - Gold up front ${coins(cost)}: ${paid}` : `  - No gold needed up front${fee ? ' beyond the listing fee' : ''}`,
    expected,
    fee ? `  - Listing fee paid up front: ${coins(fee)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

/** The caveats and limits under the sales; `full`: every unit the paths found is in them. */
export function pathNotes(plan: PathPlan, upfront: number, full: boolean): string {
  const containers = plan.sales.some((s) => s.path.contents);
  const lines = [
    upfront ? `- Gold needed up front: **${coins(upfront)}**.` : '- No gold needs spending first.',
    `- Estimates: prices are today's, materials are priced at the lowest listing, and trade volume is a snapshot of ${plan.volume.from} to ${plan.volume.to}. ` +
      `Each item sold is capped at ${percent(plan.share)} of ${num(plan.days)} days of ${plan.method === 'list' ? 'listing' : 'instant sale'} volume, at least 1.` +
      (plan.method === 'list' ? ' Listings can take that long to sell, or longer.' : ''),
  ];
  if (containers) {
    lines.push(
      `- Container contents are averages of openings players recorded on the wiki${plan.asOf ? `, read ${plan.asOf}` : ''}, not what you will get. ` +
        'Contents beyond the volume cap, and what is bound or junk, count only at what a vendor pays.',
    );
  }
  if (full) {
    for (const b of plan.binding) {
      if (b.kind === 'cap') {
        lines.push(`- ${text(b.name)}: at its volume cap of ${num(b.cap)}. One more would take waiting ${num(b.days)} days (or a larger share).`);
      } else if (b.kind === 'contents') {
        lines.push(`- ${text(b.name)}: stopped at ${num(b.units)}; more would hold more than can be sold in that time.`);
      } else if (b.kind === 'limit') {
        lines.push(`- ${text(b.name)}: the vendor sells at most ${num(b.perWeek)} a week.`);
      } else if (b.short.length) {
        const more = b.short.map((s) => (s.id === COIN ? `${coins(s.amount)} more gold` : `${num(s.amount)} more ${text(s.name)}`));
        lines.push(`- Binding: one more ${text(b.name)} (about ${coins(b.profit)}) needs ${more.join(' and ')}.`);
      }
    }
  }
  const unchecked = [plan.unchecked.ratings ? 'crafting ratings (needs `characters`)' : '', plan.unchecked.unlocks ? 'recipe unlocks (needs `unlocks`)' : ''].filter(Boolean);
  if (unchecked.length) lines.push(`- Not checked: ${unchecked.join(' and ')}.`);
  lines.push('- Vendors are not checked for access: some need an expansion, a mastery or a portable exchanger item.');
  lines.push(...reservedText(plan), ...blockedText(plan));
  return lines.join('\n');
}

export function reservedText(plan: PathPlan): string[] {
  if (!plan.reserved.length) return [];
  return [`- Held back first, for the crafting plan and promotions: ${plan.reserved.map((r) => `${num(r.amount)} ${text(r.name)}`).join(', ')}.`];
}

/** Paths ruled out, and what was never a path, grouped by reason. */
function blockedText(plan: PathPlan): string[] {
  const group = (entries: readonly { name: string; reason: string }[]) => {
    const reasons = new Map<string, Set<string>>();
    for (const b of entries) (reasons.get(b.reason) ?? reasons.set(b.reason, new Set()).get(b.reason)!).add(b.name);
    return [...reasons].map(([reason, names]) => `- Left out, ${text(reason)}: ${[...names].map(text).join(', ')}.`);
  };
  return [...group(plan.blocked), ...group(plan.leftOut)];
}
