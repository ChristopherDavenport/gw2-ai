/**
 * Routes that follow what the player holds, worked out while solving: which
 * vendor offer they can pay, whether materials they own are better used than
 * sold, and what fills a recipe that takes any of a pool of items. Choices the
 * player made are never changed. Pure.
 */
import { sellProceeds } from './fees.js';
import { buyPrice, DAILY_ITEMS, planSettings, type Choice, type CraftingPlan, type PlanInput, type PlanRoute, type PlanStep, type Solution, type StepKey } from './plan.js';
import type { RecipeData, TreeVendorOffer } from './tree.js';

/** What a pool route uses: owned stacks first, in this order, then bought ones. */
export interface PoolFill {
  owned: { key: StepKey; count: number }[];
  buy: StepKey;
}

export interface Decisions {
  /** Steps that take another route than the default. */
  routes: Map<StepKey, PlanRoute>;
  /** Pool routes' ingredients. Without one, all of them are the cheapest to buy. */
  fills: Map<StepKey, PoolFill>;
}

export const NO_DECISIONS: Decisions = { routes: new Map(), fills: new Map() };

/** The inputs of `times` forges of a pool route. */
export function poolInputs(data: RecipeData, route: PlanRoute, times: number, fill: PoolFill | undefined): PlanInput[] {
  const fixed = route.inputs.slice(0, -1);
  const fallback = route.inputs.at(-1)!;
  const used = new Map<StepKey, number>();
  let left = route.pool!.stacks * route.pool!.stack * times;
  for (const { key, count } of fill?.owned ?? []) {
    const take = Math.min(count, left);
    if (take > 0) used.set(key, (used.get(key) ?? 0) + take);
    left -= take;
  }
  const buy = fill?.buy ?? fallback.key;
  if (left > 0) used.set(buy, (used.get(buy) ?? 0) + left);
  const out = fixed.map((i) => ({ ...i, count: i.count * times }));
  for (const [key, count] of used) {
    const same = out.find((i) => i.key === key);
    if (same) same.count += count;
    else out.push({ key, name: data.items[Number(key.slice(1))]?.name ?? `#${key.slice(1)}`, count });
  }
  return out;
}

/** Vendor ordering follows a currency preference; plans saved before it was recorded. */
const PREFERRED_BEFORE = new Set([19925]);
/** Levels of made inputs weighed when comparing routes; deeper ones take the default. */
const DEPTH = 3;
const DAYS: [keyof TreeVendorOffer['caps'], number][] = [
  ['daily', 1],
  ['weekly', 7],
  ['season', 91],
];

const itemId = (key: StepKey) => Number(key.slice(1));
const timesFor = (count: number, output: number) => Math.max(1, Math.ceil(count / (output > 0 ? output : 1) - 1e-9));

/** Days a purchase limit stretches `purchases` over; Infinity when it can't be done at all. */
function offerDays(offer: TreeVendorOffer, purchases: number): number {
  const { caps } = offer;
  if ((caps.total !== undefined && purchases > caps.total) || (caps.character !== undefined && purchases > caps.character)) return Infinity;
  return Math.max(0, ...DAYS.map(([cap, days]) => (caps[cap] === undefined || purchases <= caps[cap] ? 0 : Math.ceil(purchases / caps[cap]) * days)));
}

interface Quote {
  cost: number;
  /** False when something in it has no gold value. */
  priced: boolean;
  /** Something the player holds went into it. */
  used: boolean;
  /** It takes days: more than one of a once-a-day item has to be made. */
  gated?: boolean;
}

export function decide(
  plan: CraftingPlan,
  choose: (key: StepKey) => Choice,
  solve: (decisions: Decisions, skip?: ReadonlySet<StepKey>) => Solution,
): Decisions {
  const { data, holdings } = plan;
  const settings = planSettings(plan);
  const ownItems = settings.useOwnMaterials && Object.keys(holdings.items).length > 0;
  const hasStock = ownItems || Object.keys(holdings.wallet).length > 0;
  const hasPools = Object.keys(data.pools ?? {}).length > 0;
  const decisions: Decisions = { routes: new Map(), fills: new Map() };
  if (!hasStock && !hasPools) return decisions;

  const goals = new Map(plan.goals.map((g, i) => [`i${g.itemId}`, i]));
  const done = new Set(plan.done);
  const chosen = (key: StepKey) => plan.choices[key] !== undefined && choose(key).route.key === plan.choices[key];
  const routesOf = (key: StepKey) => {
    const { route, options } = choose(key);
    return [route, ...options];
  };
  const routeOf = (key: StepKey) => decisions.routes.get(key) ?? choose(key).route;

  const stockOf = (key: StepKey): number =>
    key.startsWith('c') ? (holdings.wallet[itemId(key)] ?? 0) : key.startsWith('i') && settings.useOwnMaterials ? (holdings.items[itemId(key)] ?? 0) : 0;

  /** What selling one owned unit would net: 0 when it can't be sold. */
  const saleValue = (id: number): number => {
    const item = data.items[id];
    if (!item) return 0;
    return Math.max(item.bound || !item.buy ? 0 : sellProceeds(item.buy), item.vendor ?? 0);
  };

  /** Vendor offers in rank order, when the default route is one of several. */
  const offers = (key: StepKey): PlanRoute[] => {
    if (!hasStock || chosen(key) || choose(key).route.action !== 'vendor') return [];
    const list = routesOf(key)
      .filter((r) => r.action === 'vendor')
      .sort((a, b) => Number(a.key.slice(7)) - Number(b.key.slice(7)));
    return list.length > 1 ? list : [];
  };

  /** Routes whose gold costs can be set against each other. */
  const comparable = (key: StepKey): PlanRoute[] => {
    const { route } = choose(key);
    if (chosen(key) || route.action === 'vendor' || route.action === 'earn') return [];
    return routesOf(key).filter((r) => {
      if (r.action === 'earn') return false;
      // What is being made is never bought by default.
      if (r.action === 'buy') return !goals.has(key);
      // A purchase limit would make it slow.
      if (r.action === 'vendor') return Object.keys(r.offer?.caps ?? {}).length === 0;
      return true;
    });
  };

  /** Whether making `from` by the routes in use would need `target`. */
  const reaches = (from: StepKey, target: StepKey, seen = new Set<StepKey>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return routeOf(from).inputs.some((i) => reaches(i.key, target, seen));
  };

  /**
   * Owned pool items worth using, cheapest to give up first, in whole stacks:
   * one that sells for more than the cheapest costs is better sold.
   */
  const fillFor = (route: PlanRoute, remaining: (key: StepKey) => number): PoolFill => {
    const buy = route.inputs.at(-1)!.key;
    const price = buyPrice(plan, itemId(buy)) ?? 0;
    const { stack, items } = route.pool!;
    const owned = items
      .map((key) => ({ key, count: Math.floor(remaining(key) / stack) * stack, value: saleValue(itemId(key)) }))
      .filter((o) => o.count > 0 && o.value <= price)
      .sort((a, b) => a.value - b.value || itemId(a.key) - itemId(b.key));
    return { owned: owned.map(({ key, count }) => ({ key, count })), buy };
  };

  /** Gold-equivalent cost of `count` units by `route`, taking from `stock` as it goes. */
  const quoteRoute = (route: PlanRoute, count: number, stock: Stock, path: Set<StepKey>): Quote => {
    const times = timesFor(count, route.output);
    const total: Quote = { cost: 0, priced: true, used: false };
    const inputs = route.pool ? poolInputs(data, route, times, fillFor(route, stock.left)) : route.inputs.map((i) => ({ ...i, count: i.count * times }));
    for (const input of inputs) {
      const q = quoteItem(input.key, input.count, stock, path);
      total.cost += q.cost;
      // A promotion's stones cost Spirit Shards, which turning promotions on accepts.
      total.priced &&= q.priced || (route.promotion === true && (input.key === 'i20796' || input.key === 'i20799'));
      total.used ||= q.used;
      if (q.gated) total.gated = true;
    }
    return total;
  };

  const quoteItem = (key: StepKey, count: number, stock: Stock, path: Set<StepKey>): Quote => {
    if (key === 'c1') return { cost: count, priced: true, used: false };
    if (!key.startsWith('i')) return { cost: 0, priced: false, used: false };
    if (done.has(key)) return { cost: 0, priced: true, used: false };
    const own = Math.min(stock.left(key), count);
    stock.take(key, own);
    const held: Quote = { cost: own * saleValue(itemId(key)), priced: true, used: own > 0 };
    const rest = count - own;
    if (rest === 0) return held;
    const price = buyPrice(plan, itemId(key));
    const fallback = routeOf(key);
    if (path.has(key)) {
      return { cost: held.cost + (price ?? 0) * rest, priced: price !== undefined, used: held.used };
    }
    const daily = DAILY_ITEMS.has(itemId(key));
    let candidates = [fallback];
    if (!chosen(key) && path.size <= DEPTH) {
      // A once-a-day item is not turned into a craft, only the other way.
      candidates = [...new Set([fallback, ...comparable(key).filter((r) => !daily || r.action === 'buy')])];
    }
    let best: { quote: Quote; stock: Stock } | undefined;
    let used = false;
    for (const route of candidates) {
      const trial = stock.copy();
      let q: Quote;
      if (route.action === 'buy') q = { cost: (price ?? 0) * rest, priced: price !== undefined, used: false };
      else if (route.action === 'earn' || path.size > DEPTH + 3) q = { cost: route.unitCost * rest, priced: route.priced, used: false };
      else q = quoteRoute(route, rest, trial, new Set(path).add(key));
      if (daily && rest > 1 && (route.action === 'craft' || route.action === 'vendor')) q = { ...q, gated: true };
      used ||= q.used;
      if (!best || better(q, best.quote)) best = { quote: q, stock: trial };
    }
    stock.set(best!.stock);
    return { ...best!.quote, cost: held.cost + best!.quote.cost, used: held.used || used };
  };

  /** The offer to pay: the default when covered, else one that is, else the least short. */
  const payable = (key: StepKey, count: number, list: PlanRoute[], remaining: (key: StepKey) => number): PlanRoute => {
    const usual = choose(key).route;
    const rate = (route: PlanRoute) => {
      const purchases = timesFor(count, route.output);
      return {
        route,
        // The share that can't be paid for: that of the cost held least.
        short: Math.max(0, ...route.inputs.map((i) => 1 - remaining(i.key) / (i.count * purchases))),
        days: offerDays(route.offer!, purchases),
      };
    };
    const current = rate(usual);
    if (current.short === 0) return usual;
    // Never one that limits make slower than the default, or impossible.
    const others = list
      .filter((r) => r.key !== usual.key && !r.inputs.some((i) => reaches(i.key, key)))
      .map(rate)
      .filter((r) => r.days !== Infinity && r.days <= current.days);
    const covered = others.find((r) => r.short === 0);
    if (covered) return covered.route;
    const { vendors } = data;
    if (vendors[itemId(key)]?.preferred ?? PREFERRED_BEFORE.has(itemId(key))) return usual;
    return others.reduce((best, r) => (r.short < best.short ? r : best), current).route;
  };

  const reconsider = (step: PlanStep, solution: Solution, pending: PlanStep[]): void => {
    const { key, count } = step;
    decisions.routes.delete(key);
    decisions.fills.delete(key);
    // What everything else needs: steps still to be given their offer reserve nothing yet.
    const other = solve(decisions, new Set([key, ...pending.filter((s) => offers(s.key).length).map((s) => s.key)]));
    const remaining = (input: StepKey) => Math.max(0, stockOf(input) - (other.demand.get(input) ?? 0));
    const usual = choose(key).route;

    let route = usual;
    const list = offers(key);
    if (list.length) route = payable(key, count, list, remaining);
    else {
      const candidates = comparable(key);
      const pooled = candidates.some((r) => r.pool);
      if (candidates.length > 1 && (ownItems || pooled) && candidates.includes(usual)) {
        const daily = DAILY_ITEMS.has(itemId(key));
        const quotes = candidates
          // A once-a-day item is not turned into a craft, only the other way.
          .filter((r) => r === usual || !daily || r.action === 'buy')
          .filter((r) => !r.inputs.some((i) => reaches(i.key, key)))
          .map((r) => {
            const stock = new Stock(remaining);
            const quote =
              r.action === 'buy'
                ? { cost: (buyPrice(plan, itemId(key)) ?? 0) * count, priced: true, used: false }
                : quoteRoute(r, count, stock, new Set([key]));
            return { route: r, quote };
          });
        const current = quotes.find((q) => q.route === usual);
        // Pools are weighed for the quantity needed even with nothing held.
        if (current?.quote.priced && (pooled || quotes.some((q) => q.quote.used))) {
          route = quotes
            // Saving gold is no reason to add days of waiting.
            .filter((q) => q === current || !q.quote.gated || current.quote.gated)
            .reduce((best, q) => (better(q.quote, best.quote) ? q : best), current).route;
        }
      }
    }
    if (route !== usual) decisions.routes.set(key, route);
    if (route.pool) decisions.fills.set(key, fillFor(route, remaining));
  };

  const open = (step: PlanStep) =>
    step.kind === 'Item' && step.count > 0 && (offers(step.key).length > 0 || comparable(step.key).length > 1 || routeOf(step.key).pool !== undefined);
  const priority = (step: PlanStep) => Math.min(...step.goals.map((g) => goals.get(g) ?? goals.size));

  // Twice over, since a later decision can change what an earlier step needs.
  for (let round = 0; round < 2; round++) {
    const visited = new Set<StepKey>();
    for (;;) {
      const solution = solve(decisions);
      // Earlier goals first; within one, consumers come before what they consume.
      const waiting = solution.steps
        .filter((s) => !visited.has(s.key) && open(s))
        .sort((a, b) => priority(a) - priority(b));
      const [next, ...pending] = waiting;
      if (!next) break;
      visited.add(next.key);
      reconsider(next, solution, pending);
    }
  }
  return decisions;
}

/** Cheaper, with a complete price beating a partial one. */
const better = (a: Quote, b: Quote) => (a.priced !== b.priced ? a.priced : a.cost < b.cost - 0.5);

/** What is left to take while one route is priced. */
class Stock {
  #taken = new Map<StepKey, number>();
  readonly remaining: (key: StepKey) => number;
  constructor(remaining: (key: StepKey) => number) {
    this.remaining = remaining;
  }
  readonly left = (key: StepKey): number => this.remaining(key) - (this.#taken.get(key) ?? 0);
  take(key: StepKey, count: number): void {
    if (count) this.#taken.set(key, (this.#taken.get(key) ?? 0) + count);
  }
  copy(): Stock {
    const next = new Stock(this.remaining);
    next.#taken = new Map(this.#taken);
    return next;
  }
  set(from: Stock): void {
    this.#taken = from.#taken;
  }
}
