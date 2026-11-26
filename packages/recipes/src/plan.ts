import type { Gw2Client } from '@gw2kit/client';
import type { VendorCaps } from '@gw2kit/wiki';
import { addVendorOffers, fetchRecipeData, type FetchRecipeOptions, type RecipeData, type SourceRecipe, type TreeVendorOffer } from './tree.js';

/**
 * A crafting plan: the recipe graph as fetched, plus what the player decided,
 * finished and learned. Plain JSON, with no I/O of its own, so a browser can
 * keep it in storage or a file. `solvePlan` derives the steps from it.
 */
export interface PlanGoal {
  itemId: number;
  name: string;
  quantity: number;
}

export interface CraftingPlan {
  version: 2;
  /** What is being made: at least one, each item once. */
  goals: PlanGoal[];
  /** Every known route for every item reachable from the goals. */
  data: RecipeData;
  /** Step key → route key (see PlanRoute.key). Absent: the default route. */
  choices: Record<string, string>;
  /** Step keys the player has finished; their inputs drop out of the plan. */
  done: string[];
  /** Step key → what was learned about getting it. */
  notes: Record<string, PlanNote>;
  /** Step key → source text gathered for steps with no known route, to write notes from. */
  research?: Record<string, PlanResearch>;
  holdings: PlanHoldings;
  /** What differs from DEFAULT_PLAN_SETTINGS. */
  settings?: Partial<PlanSettings>;
}

export interface PlanSettings {
  /** Take owned items off what the plan calls for. Wallet balances always count. */
  useOwnMaterials: boolean;
  /**
   * Craft the once-a-day items. Off: the plan doesn't schedule them, and they
   * come from a vendor or are earned.
   */
  dailyCrafts: boolean;
  /** Use Mystic Forge material promotions where their gold cost beats buying. */
  forgePromotions: boolean;
  /** State the plan's value net of the materials you own, not including them. */
  deductOwnedValue: boolean;
  /** Price trading post purchases at the highest buy order instead of buying at once. */
  useBuyOrders: boolean;
}

export const DEFAULT_PLAN_SETTINGS: Readonly<PlanSettings> = {
  useOwnMaterials: true,
  dailyCrafts: true,
  forgePromotions: false,
  deductOwnedValue: true,
  useBuyOrders: false,
};

export const planSettings = (plan: CraftingPlan): PlanSettings => ({ ...DEFAULT_PLAN_SETTINGS, ...plan.settings });

export interface PlanHoldings {
  /** Item id → count owned. */
  items: Record<number, number>;
  /** Wallet currency id → balance. */
  wallet: Record<number, number>;
  /** ISO time the holdings were read; absent when never read. */
  fetchedAt?: string;
}

export interface PlanResearch {
  text: string;
  source: string;
  /** Places to get the item that aren't vendors or recipes, when the wiki lists them. */
  sources?: PlanSource[];
  /** The whole answer when the wiki states one, e.g. `Completing the map Auric Basin.` */
  method?: string;
  /** What vendors demand before selling, e.g. a mastery. */
  requires?: string[];
}

export interface PlanSource {
  /** `gathered`: collected out in the world. `contained`: from a container, including choice chests. */
  kind: 'gathered' | 'contained';
  name: string;
  /** Quantity and odds as the wiki gives them, e.g. `1-10, chance`. */
  detail?: string;
  /** What and where it is. */
  about?: string;
}

export interface PlanNote {
  text: string;
  /** Where it came from, usually a wiki URL. */
  source?: string;
  /** A time gate the recipe data doesn't know about, e.g. "1 per day". */
  gate?: string;
}

/** `i<item id>`, `c<currency id>` or `g<guild upgrade id>`. */
export type StepKey = string;

export interface PlanInput {
  key: StepKey;
  name: string;
  /** Per craft, forge or purchase. */
  count: number;
}

/** One way to get an item. */
export interface PlanRoute {
  /**
   * `buy` (trading post), `craft:<recipe id>`, `forge:<ingredient ids>`,
   * `vendor:<offer index>`, or `earn` (get it some other way: drops, rewards,
   * dailies).
   */
  key: string;
  action: 'craft' | 'forge' | 'buy' | 'vendor' | 'earn';
  /** Units per craft, forge or purchase; fractional for chance-based forges. */
  output: number;
  inputs: PlanInput[];
  recipe?: SourceRecipe;
  offer?: TreeVendorOffer;
  /** Copper per unit, counting priced inputs only. */
  unitCost: number;
  /** False when `unitCost` leaves out something with no gold price. */
  priced: boolean;
  /** A random Mystic Forge promotion; `output` is the average net gain. */
  promotion?: boolean;
}

export interface PlanStep {
  key: StepKey;
  kind: 'Item' | 'Currency' | 'GuildUpgrade';
  id: number;
  name: string;
  /** `have`: nothing left to do (held or marked done). */
  action: PlanRoute['action'] | 'have';
  /** Units the plan calls for. */
  need: number;
  /** Of those, units covered by holdings or the wallet. */
  owned: number;
  /** Units still to get: need − owned, 0 when done. */
  count: number;
  done: boolean;
  /** The chosen route; absent when `action` is `have`. */
  route?: PlanRoute;
  /** Crafts, forges or purchases of `route`. */
  times: number;
  /** Total inputs for `times`. */
  inputs: PlanInput[];
  /** Every other route this step could take. */
  options: PlanRoute[];
  /** True when routes differ in ways gold can't compare and none was chosen. */
  undecided: boolean;
  /** Gold spent at this step itself: a TP purchase, or the coin part of a vendor purchase. */
  coin: number;
  /** Account or soulbound: can't be bought from other players. */
  bound: boolean;
  /** Vendor purchase limits that apply to this step. */
  caps?: VendorCaps;
  /** Set when the item can be had only this many times a day. */
  perDay?: number;
  /** The direct inputs of the goals that need this step. */
  components: StepKey[];
  /** The goals that need this step, a goal itself included. */
  goals: StepKey[];
  note?: PlanNote;
  research?: PlanResearch;
}

export interface SolvedPlan {
  goals: PlanGoal[];
  /** Every step comes before the steps it consumes. */
  steps: PlanStep[];
  /** Total gold still to spend, in copper. */
  coin: number;
  /** The same with no owned items, so `fullCoin − coin` is what yours are worth to this plan. */
  fullCoin: number;
}

const COIN_KEY = 'c1';
/**
 * The items /v2/dailycrafting tracks: Charged Quartz Crystal, Spool of Silk
 * Weaving Thread, Lump of Mithrillium, Glob of Elder Spirit Residue and Spool
 * of Thick Elonian Cord. One a day, by crafting or from a vendor.
 */
const DAILY_ITEMS: ReadonlySet<number> = new Set([43772, 46740, 46742, 46744, 46745]);
/** Philosopher's Stone and Mystic Crystal: paid in Spirit Shards, which have no gold price. */
const SPIRIT_SHARD_ITEMS: ReadonlySet<StepKey> = new Set(['i20796', 'i20799']);

export const stepKey = (kind: PlanStep['kind'], id: number): StepKey => `${kind === 'Item' ? 'i' : kind === 'Currency' ? 'c' : 'g'}${id}`;

function parseKey(key: StepKey): { kind: PlanStep['kind']; id: number } {
  const kind = key.startsWith('i') ? 'Item' : key.startsWith('c') ? 'Currency' : 'GuildUpgrade';
  return { kind, id: Number(key.slice(1)) };
}

function nameOf(data: RecipeData, key: StepKey): string {
  const { kind, id } = parseKey(key);
  const found = kind === 'Item' ? data.items[id]?.name : kind === 'Currency' ? data.currencies[id] : data.guildUpgrades[id];
  if (found) return found;
  // Alternative vendor offers can charge items nothing else in the graph uses.
  return vendorCosts(data).find((c) => c.kind === kind && c.id === id)?.name ?? `#${id}`;
}

const vendorCosts = (data: RecipeData) => Object.values(data.vendors).flatMap((v) => v.offers.flatMap((o) => o.costs));

/** Fetch the graph for `quantity` of `itemId` and start an empty plan. */
export async function createPlan(
  client: Gw2Client,
  goals: number | readonly { itemId: number; quantity?: number }[],
  quantity = 1,
  options: CreatePlanOptions = {},
): Promise<CraftingPlan> {
  const wanted = typeof goals === 'number' ? [{ itemId: goals, quantity }] : goals;
  // Promotions are fetched so the setting can be flipped later without a rebuild.
  const data = await fetchRecipeData(client, wanted.map((g) => g.itemId), { promotions: true, maxOffers: PLAN_OFFERS, ...options });
  const plan = planFromData(data, wanted);
  return options.otherOffers === false ? plan : addOtherOffers(client, plan, options);
}

export interface CreatePlanOptions extends FetchRecipeOptions {
  /** Look up other places to buy (addOtherOffers) before returning. Default true. */
  otherOffers?: boolean;
}

/**
 * The plan with other places to buy looked up, for bound forge results and the
 * biggest purchases. It only adds routes to steps that have one, so no step or
 * total changes until the player picks one. Needs `options.wiki`.
 */
export async function addOtherOffers(client: Gw2Client, plan: CraftingPlan, options: FetchRecipeOptions = {}): Promise<CraftingPlan> {
  if (!options.wiki || options.vendors === false) return plan;
  // addVendorOffers writes into the data it is given.
  const data = structuredClone(plan.data);
  await addVendorOffers(client, options.wiki, data, worthAnotherRoute(plan), { maxOffers: PLAN_OFFERS, ...options });
  data.offersFetchedAt = new Date().toISOString();
  return { ...plan, data };
}

/**
 * `plan` with what `extra`, an earlier or later copy of the same build, has
 * looked up and it lacks: vendor offers, the items they charge and wiki
 * research. `plan` wins everywhere else, so lookups finishing late can't undo
 * the player's changes.
 */
export function mergeLookups(plan: CraftingPlan, extra: CraftingPlan): CraftingPlan {
  if (plan.data.rootId !== extra.data.rootId) return plan;
  // A copy from before a goal was added never looked up that goal's offers.
  const covered = new Set(extra.goals.map((g) => g.itemId));
  const offersFetchedAt =
    plan.data.offersFetchedAt ?? (plan.goals.every((g) => covered.has(g.itemId)) ? extra.data.offersFetchedAt : undefined);
  const research = { ...extra.research, ...plan.research };
  return {
    ...plan,
    data: {
      ...plan.data,
      items: { ...extra.data.items, ...plan.data.items },
      currencies: { ...extra.data.currencies, ...plan.data.currencies },
      vendors: { ...extra.data.vendors, ...plan.data.vendors },
      ...(offersFetchedAt ? { offersFetchedAt } : {}),
    },
    ...(Object.keys(research).length ? { research } : {}),
  };
}

/** Vendor offers kept per item: enough for every map's exchange. */
const PLAN_OFFERS = 20;
/** The biggest purchases that are also looked up at vendors. */
const PRICIEST_BUYS = 8;

/**
 * Items the graph already has a route for where a vendor is worth knowing
 * about: bound forge results (Mystic Clover) and the biggest purchases.
 */
function worthAnotherRoute(plan: CraftingPlan): number[] {
  const goals = new Set(plan.goals.map((g) => g.itemId));
  const steps = solvePlan(plan).steps.filter((s) => s.kind === 'Item' && !goals.has(s.id));
  const forged = steps.filter((s) => s.action === 'forge' && s.bound);
  const bought = steps.filter((s) => s.action === 'buy').sort((a, b) => b.coin - a.coin).slice(0, PRICIEST_BUYS);
  return [...forged, ...bought].map((s) => s.id);
}

/** What a trading post purchase of `id` costs per unit under the plan's settings. */
export function buyPrice(plan: CraftingPlan, id: number): number | undefined {
  const item = plan.data.items[id];
  if (item?.sell === undefined) return undefined;
  return planSettings(plan).useBuyOrders ? (item.buy ?? item.sell) : item.sell;
}

const wholeNumber = (n: number | undefined) => Math.max(1, Math.floor(n ?? 1));

/** A new plan over fetched data: for its root item, or for the `goals` it was fetched for. */
export function planFromData(
  data: RecipeData,
  goals: number | readonly { itemId: number; quantity?: number }[] = 1,
): CraftingPlan {
  const wanted = typeof goals === 'number' ? [{ itemId: data.rootId, quantity: goals }] : goals;
  const quantities = new Map<number, number>();
  for (const g of wanted) quantities.set(g.itemId, (quantities.get(g.itemId) ?? 0) + wholeNumber(g.quantity));
  return {
    version: 2,
    goals: [...quantities].map(([itemId, quantity]) => ({ itemId, name: nameOf(data, stepKey('Item', itemId)), quantity })),
    data,
    choices: {},
    done: [],
    notes: {},
    holdings: { items: {}, wallet: {} },
  };
}

/**
 * The plan with `quantity` more of `itemId` to make, its recipes fetched and
 * added to the graph. Decisions and progress are kept. Run addOtherOffers
 * afterwards for the new goal's vendor offers.
 */
export async function addGoal(
  client: Gw2Client,
  plan: CraftingPlan,
  itemId: number,
  quantity = 1,
  options: FetchRecipeOptions = {},
): Promise<CraftingPlan> {
  const existing = plan.goals.find((g) => g.itemId === itemId);
  if (existing) {
    const goals = plan.goals.map((g) => (g === existing ? { ...g, quantity: g.quantity + wholeNumber(quantity) } : g));
    return { ...plan, goals };
  }
  const fetched = await fetchRecipeData(client, itemId, { promotions: true, maxOffers: PLAN_OFFERS, ...options });
  const data = mergeData(plan.data, fetched);
  return {
    ...plan,
    data,
    goals: [...plan.goals, { itemId, name: nameOf(data, stepKey('Item', itemId)), quantity: wholeNumber(quantity) }],
  };
}

/** Two graphs as one; `next` has the newer prices. */
function mergeData(base: RecipeData, next: RecipeData): RecipeData {
  const { offersFetchedAt: _offers, ...kept } = base;
  const worst = <T extends { status: string }>(a: T | undefined, b: T | undefined) => (a && a.status !== 'ok' ? a : (b ?? a));
  const mysticForge = worst(base.status.mysticForge, next.status.mysticForge);
  const vendors = worst(base.status.vendors, next.status.vendors);
  return {
    ...kept,
    items: { ...base.items, ...next.items },
    searched: [...new Set([...base.searched, ...next.searched])].sort((a, b) => a - b),
    recipes: { ...next.recipes, ...base.recipes },
    ...(base.promotions || next.promotions ? { promotions: { ...next.promotions, ...base.promotions } } : {}),
    currencies: { ...base.currencies, ...next.currencies },
    guildUpgrades: { ...base.guildUpgrades, ...next.guildUpgrades },
    vendors: { ...next.vendors, ...base.vendors },
    vendorUnmatched: [...new Set([...base.vendorUnmatched, ...next.vendorUnmatched])],
    status: { ...(mysticForge ? { mysticForge } : {}), ...(vendors ? { vendors } : {}) },
  };
}

/** The same plan with trading post prices read again; the graph is not refetched. */
export async function refreshPrices(client: Gw2Client, plan: CraftingPlan): Promise<CraftingPlan> {
  const ids = Object.keys(plan.data.items).map(Number);
  // Skip the cache, or prices read at creation would be stamped as new.
  const prices = await client.many('/v2/commerce/prices', ids, { ttlMs: 0 });
  const items: RecipeData['items'] = {};
  for (const id of ids) {
    const { sell: _sell, buy: _buy, ...rest } = plan.data.items[id]!;
    const p = prices.get(id);
    items[id] = {
      ...rest,
      ...(p?.sells.unit_price ? { sell: p.sells.unit_price } : {}),
      ...(p?.buys.unit_price ? { buy: p.buys.unit_price } : {}),
    };
  }
  return { ...plan, data: { ...plan.data, items, fetchedAt: new Date().toISOString() } };
}

/** Check a value read back from storage or a file. Throws when it isn't a plan. */
export function parsePlan(value: unknown): CraftingPlan {
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  let p = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  // Version 1 had a single `goal`.
  if (isRecord(p) && p.version === 1 && isRecord(p.goal)) {
    const { goal, ...rest } = p;
    p = { ...rest, version: 2, goals: [goal] };
  }
  const isGoal = (g: unknown) => isRecord(g) && typeof g.itemId === 'number' && typeof g.quantity === 'number' && typeof g.name === 'string';
  if (
    !isRecord(p) ||
    p.version !== 2 ||
    !Array.isArray(p.goals) ||
    p.goals.length === 0 ||
    !p.goals.every(isGoal) ||
    !isRecord(p.data) ||
    p.data.version !== 1 ||
    !isRecord(p.data.items) ||
    !isRecord(p.data.recipes) ||
    !isRecord(p.data.vendors) ||
    !isRecord(p.data.currencies) ||
    !isRecord(p.data.guildUpgrades) ||
    !isRecord(p.data.status) ||
    !Array.isArray(p.data.vendorUnmatched) ||
    !Array.isArray(p.data.searched) ||
    !isRecord(p.choices) ||
    !Array.isArray(p.done) ||
    !isRecord(p.notes) ||
    !isRecord(p.holdings) ||
    !isRecord(p.holdings.items) ||
    !isRecord(p.holdings.wallet) ||
    (p.settings !== undefined && !isRecord(p.settings))
  ) {
    throw new Error('Not a crafting plan.');
  }
  return p as unknown as CraftingPlan;
}

// ---------------------------------------------------------------- routes

const forgeKey = (r: SourceRecipe) =>
  `forge:${r.ingredients
    .map((i) => `${i.count}x${i.id}`)
    .sort()
    .join('+')}`;

/**
 * One recipe per set of ingredients and yield: the API lists the same recipe
 * once per discipline group. The disciplines are combined.
 */
function distinct(recipes: readonly SourceRecipe[]): SourceRecipe[] {
  const out = new Map<string, SourceRecipe>();
  for (const r of recipes) {
    const key = `${r.source} ${r.output_count} ${forgeKey(r)}`;
    const seen = out.get(key);
    out.set(
      key,
      seen
        ? { ...seen, disciplines: [...new Set([...seen.disciplines, ...r.disciplines])], min_rating: Math.min(seen.min_rating, r.min_rating) }
        : r,
    );
  }
  return [...out.values()];
}

interface Choice {
  route: PlanRoute;
  options: PlanRoute[];
  undecided: boolean;
}

/**
 * Pick one route per step. A route is picked per item, not per occurrence, so
 * an intermediate used in several places is made the same way everywhere.
 */
function chooseRoutes(plan: CraftingPlan): (key: StepKey) => Choice {
  const { data } = plan;
  const settings = planSettings(plan);
  const goals = new Set(plan.goals.map((g) => stepKey('Item', g.itemId)));
  const memo = new Map<StepKey, Choice>();
  const path = new Set<StepKey>();

  const leaf = (action: 'buy' | 'earn', unitCost: number, priced: boolean): PlanRoute => ({
    key: action,
    action,
    output: 1,
    inputs: [],
    unitCost,
    priced,
  });

  const priceInputs = (
    inputs: PlanInput[],
    output: number,
    ignore?: ReadonlySet<StepKey>,
  ): { unitCost: number; priced: boolean } | undefined => {
    let total = 0;
    let priced = true;
    for (const input of inputs) {
      if (path.has(input.key)) return undefined; // a route that needs its own output
      const sub = choose(input.key).route;
      total += sub.unitCost * input.count;
      priced &&= sub.priced || (ignore?.has(input.key) ?? false);
    }
    return { unitCost: total / (output > 0 ? output : 1), priced };
  };

  const choose = (key: StepKey): Choice => {
    const known = memo.get(key);
    if (known) return known;
    const { kind, id } = parseKey(key);
    if (kind !== 'Item') {
      const route = key === COIN_KEY ? leaf('buy', 1, true) : leaf('earn', 0, false);
      const result = { route, options: [], undecided: false };
      memo.set(key, result);
      return result;
    }

    path.add(key);
    const made: PlanRoute[] = [];
    const promotions = settings.forgePromotions ? (data.promotions?.[id] ?? []) : [];
    const recipes = [
      ...distinct(data.recipes[id] ?? []).map((recipe) => ({ recipe, promotion: false })),
      ...promotions.map((recipe) => ({ recipe, promotion: true })),
    ];
    for (const { recipe, promotion } of recipes) {
      // A daily item the player doesn't want to craft, unless they chose this recipe for it.
      if (!settings.dailyCrafts && DAILY_ITEMS.has(id) && !goals.has(key) && plan.choices[key] !== `craft:${recipe.id}`) continue;
      const inputs = recipe.ingredients.map((i) => {
        const k = stepKey(i.type, i.id);
        return { key: k, name: nameOf(data, k), count: i.count };
      });
      // Turning promotions on accepts that their stones cost Spirit Shards, not gold.
      const cost = priceInputs(inputs, recipe.output_count, promotion ? SPIRIT_SHARD_ITEMS : undefined);
      if (!cost) continue;
      const forge = recipe.source === 'mystic-forge';
      made.push({
        key: forge ? forgeKey(recipe) : `craft:${recipe.id}`,
        ...(promotion ? { promotion } : {}),
        action: forge ? 'forge' : 'craft',
        output: recipe.output_count,
        inputs,
        recipe,
        ...cost,
      });
    }
    // Cheapest first, complete prices before partial ones, then the lowest rating.
    made.sort(
      (a, b) => Number(b.priced) - Number(a.priced) || a.unitCost - b.unitCost || (a.recipe?.min_rating ?? 0) - (b.recipe?.min_rating ?? 0),
    );
    const vended: PlanRoute[] = [];
    for (const [index, offer] of (data.vendors[id]?.offers ?? []).entries()) {
      const inputs = offer.costs.map((c) => ({ key: stepKey(c.kind, c.id), name: c.name, count: c.amount }));
      const cost = priceInputs(inputs, offer.quantity);
      if (cost) vended.push({ key: `vendor:${index}`, action: 'vendor', output: offer.quantity, inputs, offer, ...cost });
    }
    path.delete(key);

    const sell = buyPrice(plan, id);
    const buy = sell === undefined ? undefined : leaf('buy', sell, true);
    // Earning something tradeable still gives up its price, so compare it at that.
    const earn = leaf('earn', sell ?? 0, sell !== undefined);
    const options = [...made, ...(buy ? [buy] : []), ...vended, earn];

    const picked = options.find((r) => r.key === plan.choices[key]);
    let route: PlanRoute;
    let undecided = false;
    // A chosen vendor for something tradeable is still compared at its price, so its parent stays made.
    if (picked) route = !picked.priced && sell !== undefined && picked.action === 'vendor' ? { ...picked, unitCost: sell, priced: true } : picked;
    else if (!goals.has(key) && buy) route = made[0]?.priced && made[0].unitCost < buy.unitCost ? made[0] : buy;
    else {
      route = made[0] ?? vended[0] ?? buy ?? earn;
      undecided = made.length > 1 && !made[0]!.priced;
    }
    const result = { route, options: options.filter((r) => r.key !== route.key), undecided };
    memo.set(key, result);
    return result;
  };
  return choose;
}

// ---------------------------------------------------------------- solving

/**
 * The steps still needed to finish the plan. Demand for each item is summed
 * across the whole graph before holdings are taken off and crafts are rounded
 * up. Pure: no requests.
 */
export function solvePlan(plan: CraftingPlan): SolvedPlan {
  const solved = solveSteps(plan);
  const owns = planSettings(plan).useOwnMaterials && Object.keys(plan.holdings.items).length > 0;
  const fullCoin = owns ? solveSteps({ ...plan, holdings: { ...plan.holdings, items: {} } }).coin : solved.coin;
  return { ...solved, fullCoin };
}

function solveSteps(plan: CraftingPlan): Omit<SolvedPlan, 'fullCoin'> {
  const { data } = plan;
  const settings = planSettings(plan);
  const choose = chooseRoutes(plan);
  const wanted = new Map(plan.goals.map((g) => [stepKey('Item', g.itemId), g.quantity]));
  const done = new Set(plan.done);

  // Order the chosen graph so that every consumer precedes what it consumes.
  const postOrder: StepKey[] = [];
  const state = new Map<StepKey, 'open' | 'closed'>();
  const visit = (key: StepKey): void => {
    if (state.has(key)) return;
    state.set(key, 'open');
    for (const input of choose(key).route.inputs) visit(input.key);
    state.set(key, 'closed');
    postOrder.push(key);
  };
  for (const goal of wanted.keys()) visit(goal);

  const demand = new Map<StepKey, number>(wanted);
  const components = new Map<StepKey, Set<StepKey>>();
  const neededBy = new Map<StepKey, Set<StepKey>>([...wanted.keys()].map((goal) => [goal, new Set([goal])]));
  const steps: PlanStep[] = [];
  let coin = 0;
  for (const key of postOrder.reverse()) {
    const need = demand.get(key) ?? 0;
    if (need === 0) continue;
    if (key === COIN_KEY) {
      coin += need;
      continue;
    }
    const { kind, id } = parseKey(key);
    const { route, options, undecided } = choose(key);
    const isDone = done.has(key);
    const stock =
      kind === 'Item'
          ? settings.useOwnMaterials
            ? (plan.holdings.items[id] ?? 0)
            : 0
          : kind === 'Currency'
            ? (plan.holdings.wallet[id] ?? 0)
            : 0;
    // A goal is what's being made, so owned copies only cover other steps' use of it.
    const owned = Math.min(stock, need - (wanted.get(key) ?? 0));
    const count = isDone ? 0 : need - owned;
    const times = count === 0 ? 0 : Math.max(1, Math.ceil(count / (route.output > 0 ? route.output : 1) - 1e-9));
    const inputs = times === 0 ? [] : route.inputs.map((i) => ({ ...i, count: i.count * times }));

    const mine = components.get(key) ?? new Set<StepKey>();
    for (const input of inputs) {
      demand.set(input.key, (demand.get(input.key) ?? 0) + input.count);
      const theirs = components.get(input.key) ?? new Set<StepKey>();
      if (wanted.has(key)) theirs.add(input.key);
      else for (const c of mine) theirs.add(c);
      components.set(input.key, theirs);
      const users = neededBy.get(input.key) ?? new Set<StepKey>();
      for (const goal of neededBy.get(key) ?? []) users.add(goal);
      neededBy.set(input.key, users);
    }

    const sell = kind === 'Item' ? buyPrice(plan, id) : undefined;
    let spent = 0;
    if (route.action === 'buy' && count > 0) spent = (sell ?? 0) * count;
    // The coin part of a vendor price is counted here, not as a step.
    const coinInput = inputs.find((i) => i.key === COIN_KEY);
    const stepCoin = spent + (coinInput?.count ?? 0);
    coin += spent;

    const note = plan.notes[key];
    const caps = route.offer && Object.keys(route.offer.caps).length ? route.offer.caps : undefined;
    steps.push({
      key,
      kind,
      id,
      name: nameOf(data, key),
      action: count === 0 ? 'have' : route.action,
      need,
      owned,
      count,
      done: isDone,
      ...(count === 0 ? {} : { route }),
      times,
      inputs,
      options,
      undecided: undecided && count > 0,
      coin: stepCoin,
      bound: kind === 'Item' && data.items[id]?.bound === true,
      ...(caps && count > 0 ? { caps } : {}),
      ...(count > 0 && kind === 'Item' && DAILY_ITEMS.has(id) && (route.action === 'craft' || route.action === 'vendor') ? { perDay: 1 } : {}),
      components: [...mine],
      goals: [...(neededBy.get(key) ?? [])],
      ...(note ? { note } : {}),
      ...(plan.research?.[key] ? { research: plan.research[key] } : {}),
    });
  }
  return { goals: plan.goals, steps, coin };
}

// ---------------------------------------------------------------- updates

/**
 * A change to a plan, small enough for a model or a person to write by hand.
 * Steps are named by key (`i19976`) or by item or currency name.
 */
export interface PlanUpdate {
  /**
   * Step → route: a route key, an action (`buy`, `craft`, `forge`, `vendor`,
   * `earn`), the name of an ingredient only one recipe uses, or null for the
   * default again.
   */
  choose?: Record<string, string | null>;
  done?: string[];
  undone?: string[];
  /** Step → note, or null to remove it. */
  notes?: Record<string, PlanNote | null>;
  settings?: Partial<PlanSettings>;
  /** Goal → new quantity; 0 removes it. Adding a goal needs its recipes: see addGoal. */
  quantities?: Record<string, number>;
}

/** Apply `update`. Entries that don't match anything are reported, not applied. */
export function updatePlan(plan: CraftingPlan, update: PlanUpdate): { plan: CraftingPlan; errors: string[] } {
  const errors: string[] = [];
  const { data } = plan;
  const keys = new Map<string, StepKey>();
  const add = (key: StepKey) => {
    keys.set(key, key);
    keys.set(nameOf(data, key).toLowerCase(), key);
  };
  for (const id of Object.keys(data.guildUpgrades)) add(`g${id}`);
  for (const id of Object.keys(data.currencies)) add(`c${id}`);
  for (const c of vendorCosts(data)) add(stepKey(c.kind, c.id));
  for (const id of Object.keys(data.items)) add(`i${id}`);
  const resolve = (ref: string): StepKey | undefined => {
    const key = keys.get(ref.trim().toLowerCase());
    if (!key) errors.push(`No step named "${ref}".`);
    return key;
  };

  const choices = { ...plan.choices };
  const notes = { ...plan.notes };
  const done = new Set(plan.done);

  for (const [ref, wanted] of Object.entries(update.choose ?? {})) {
    const key = resolve(ref);
    if (!key) continue;
    if (wanted === null) {
      delete choices[key];
      continue;
    }
    const { route, options } = chooseRoutes({ ...plan, choices: {} })(key);
    const routes = [route, ...options];
    const text = wanted.trim().toLowerCase();
    let matches = routes.filter((r) => r.key === wanted);
    if (!matches.length) matches = routes.filter((r) => r.action === text);
    if (!matches.length) matches = routes.filter((r) => r.inputs.some((i) => i.name.toLowerCase() === text));
    // Part of an ingredient's name is enough when it picks one route: "maguuma".
    if (!matches.length && text) matches = routes.filter((r) => r.inputs.some((i) => i.name.toLowerCase().includes(text)));
    // Vendor offers are ranked, so "vendor" means the first.
    if (matches.length > 1 && text === 'vendor') matches = matches.slice(0, 1);
    if (matches.length === 1) choices[key] = matches[0]!.key;
    else {
      const list = routes.map((r) => `${r.key}${r.inputs.length ? ` (${r.inputs.map((i) => i.name).join(', ')})` : ''}`).join('; ');
      errors.push(`"${wanted}" ${matches.length ? 'matches several routes' : 'is not a route'} for ${nameOf(data, key)}. Routes: ${list}.`);
    }
  }
  for (const ref of update.done ?? []) {
    const key = resolve(ref);
    if (key) done.add(key);
  }
  for (const ref of update.undone ?? []) {
    const key = resolve(ref);
    if (key) done.delete(key);
  }
  for (const [ref, note] of Object.entries(update.notes ?? {})) {
    const key = resolve(ref);
    if (!key) continue;
    if (note === null) delete notes[key];
    else if (typeof note.text === 'string') notes[key] = note;
    else errors.push(`The note for "${ref}" needs a "text".`);
  }
  let goals = plan.goals;
  for (const [ref, quantity] of Object.entries(update.quantities ?? {})) {
    const key = resolve(ref);
    if (!key) continue;
    const goal = goals.find((g) => stepKey('Item', g.itemId) === key);
    if (!goal) errors.push(`"${ref}" is not something this plan makes.`);
    else if (!Number.isInteger(quantity) || quantity < 0) errors.push(`The quantity of "${ref}" must be a whole number, 0 to remove it.`);
    else if (quantity === 0 && goals.length === 1) errors.push('A plan needs at least one thing to make.');
    else goals = quantity === 0 ? goals.filter((g) => g !== goal) : goals.map((g) => (g === goal ? { ...g, quantity } : g));
  }

  const settings = { ...plan.settings };
  for (const [name, value] of Object.entries(update.settings ?? {})) {
    if (!Object.hasOwn(DEFAULT_PLAN_SETTINGS, name)) errors.push(`No setting named "${name}". Settings: ${Object.keys(DEFAULT_PLAN_SETTINGS).join(', ')}.`);
    else if (typeof value !== 'boolean') errors.push(`The setting "${name}" is true or false.`);
    else {
      settings[name as keyof PlanSettings] = value;
      if (name === 'forgePromotions' && value && !data.promotions) errors.push('This plan was built without promotion data: rebuild it to use promotions.');
    }
  }
  return {
    plan: { ...plan, goals, choices, notes, done: [...done], ...(Object.keys(settings).length ? { settings } : {}) },
    errors,
  };
}

/** Replace the plan's holdings with what the account has now. */
export function withHoldings(plan: CraftingPlan, holdings: PlanHoldings): CraftingPlan {
  // Keep only what the graph can use, so the plan stays small.
  const used = new Set<number>(Object.keys(plan.data.items).map(Number));
  for (const c of vendorCosts(plan.data)) if (c.kind === 'Item') used.add(c.id);
  const items: Record<number, number> = {};
  for (const [id, count] of Object.entries(holdings.items)) if (used.has(Number(id)) && count > 0) items[Number(id)] = count;
  const wallet: Record<number, number> = {};
  for (const [id, value] of Object.entries(holdings.wallet)) {
    if (Number(id) === 1 || plan.data.currencies[Number(id)] !== undefined) wallet[Number(id)] = value;
  }
  return { ...plan, holdings: { items, wallet, ...(holdings.fetchedAt ? { fetchedAt: holdings.fetchedAt } : {}) } };
}
