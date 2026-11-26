/**
 * Whether spare materials raise more gold turned into something else first: by
 * crafting (including refinement) or Mystic Forge promotion. One step only.
 * Pure; `readConversions` in convert-read.ts gathers what it needs.
 */
import { sellProceeds } from './fees.js';
import { PROMOTIONS, STONES_PER_SHARD } from './promotions-data.js';

/** One way to turn materials into a tradeable item. */
export interface ConversionRecipe {
  kind: 'craft' | 'promote';
  output: number;
  /** Units per craft or forge; an average for promotions. */
  count: number;
  inputs: readonly (readonly [id: number, count: number])[];
  /** Crafting only. */
  disciplines?: readonly string[];
  rating?: number;
}

/** What an item can be bought and sold for. */
export interface MarketItem {
  name: string;
  buy?: number;
  sell?: number;
  vendor?: number;
  book?: readonly { price: number; quantity: number }[];
}

export interface ConversionData {
  recipes: readonly ConversionRecipe[];
  /** Every output and ingredient the recipes mention that can be traded. */
  market: ReadonlyMap<number, MarketItem>;
  /** Spirit Shards in the wallet; absent: promotions are not limited by them. */
  spiritShards?: number;
}

export interface Conversion {
  kind: 'craft' | 'promote';
  output: number;
  name: string;
  crafts: number;
  /** Units sold; for promotions an average, so the real number will differ. */
  units: number;
  /** Owned materials used up. */
  uses: { id: number; name: string; count: number }[];
  /** What has to be bought first, with gold. */
  buys: { id: number; name: string; count: number; cost: number }[];
  /** Copper from selling the result, after fees, less `buys`. */
  revenue: number;
  /** `revenue` less what selling the used materials as they are would raise. */
  gain: number;
  spiritShards: number;
  /** Share of listing value the sale of the result keeps. */
  kept: number;
  /** Crafting only. */
  disciplines?: readonly string[];
  rating?: number;
}

/** The snapshot of Mystic Forge material promotions as conversion recipes. */
export const promotionRecipes = (): ConversionRecipe[] =>
  PROMOTIONS.map((p) => ({ kind: 'promote', output: p.output, count: p.net, inputs: p.inputs }));

/** Conversions that gain less than this aren't worth the clicks. */
const DEFAULT_MIN_GAIN = 5_000;
/** Batch sizes tried per recipe. */
const SIZES = 40;

/** Copper for selling `units` of an item that already has `before` units planned for sale. */
function proceeds(item: MarketItem | undefined, units: number, method: 'instant' | 'list'): number {
  if (!item || units <= 0) return 0;
  const vendor = (item.vendor ?? 0) * units;
  if (method === 'list') return Math.max(vendor, item.sell ? sellProceeds(item.sell * units) : 0);
  if (!item.buy) return vendor;
  let left = units;
  let total = 0;
  for (const level of item.book ?? [{ price: item.buy, quantity: units }]) {
    const take = Math.min(level.quantity, left);
    if (take <= 0) break;
    total += sellProceeds(level.price * take);
    left -= take;
  }
  return Math.max(vendor, total);
}

interface State {
  /** Spare units still unused. */
  spare: Map<number, number>;
  /** Output units earlier conversions will already be selling. */
  selling: Map<number, number>;
  shards: number;
}

/** A promotion's lower-tier material: the input it takes most of. */
const lowerTier = (recipe: ConversionRecipe) => [...recipe.inputs].sort((a, b) => b[1] - a[1])[0]?.[0];

/** `crafts` of `recipe` from what is left, or undefined when it can't be done. */
function evaluate(
  recipe: ConversionRecipe,
  crafts: number,
  state: State,
  market: ReadonlyMap<number, MarketItem>,
  method: 'instant' | 'list',
): Conversion | undefined {
  const uses: Conversion['uses'] = [];
  const buys: Conversion['buys'] = [];
  let asIs = 0;
  let shards = 0;
  const promoted = recipe.kind === 'promote' ? lowerTier(recipe) : undefined;
  for (const [id, each] of recipe.inputs) {
    const wanted = each * crafts;
    const stones = STONES_PER_SHARD[id];
    const item = market.get(id);
    const have = state.spare.get(id) ?? 0;
    const used = Math.min(have, wanted);
    if (used > 0) {
      uses.push({ id, name: item?.name ?? `#${id}`, count: used });
      asIs += proceeds(item, have, method) - proceeds(item, have - used, method);
    }
    const missing = wanted - used;
    if (missing === 0) continue;
    if (stones) shards += Math.ceil(missing / stones);
    // Buying the material to be promoted would be speculating on a random yield.
    else if (item?.sell && id !== promoted) buys.push({ id, name: item.name, count: missing, cost: item.sell * missing });
    else return undefined;
  }
  if (uses.length === 0 || shards > state.shards) return undefined;

  const output = market.get(recipe.output);
  if (!output) return undefined;
  let units = Math.floor(recipe.count * crafts);
  // A promotion takes one of what it makes to start; without one it has to be bought.
  if (recipe.kind === 'promote' && (state.spare.get(recipe.output) ?? 0) < 1) {
    if (!output.sell) return undefined;
    buys.push({ id: recipe.output, name: output.name, count: 1, cost: output.sell });
    units += 1;
  }
  const before = state.selling.get(recipe.output) ?? 0;
  const sale = proceeds(output, before + units, method) - proceeds(output, before, method);
  const spent = buys.reduce((sum, b) => sum + b.cost, 0);
  // The player's materials must be the bulk of it, or this is just trading.
  if (spent > asIs) return undefined;
  const reference = output.sell ?? output.buy;
  const listed = reference ? sellProceeds(reference * units) : sale;
  return {
    kind: recipe.kind,
    output: recipe.output,
    name: output.name,
    crafts,
    units,
    uses,
    buys,
    revenue: sale - spent,
    gain: sale - spent - asIs,
    spiritShards: shards,
    kept: listed > 0 ? Math.min(1, sale / listed) : 1,
    ...(recipe.disciplines ? { disciplines: recipe.disciplines, rating: recipe.rating ?? 0 } : {}),
  };
}

/** The batch of `recipe` that gains most, trying sizes up to what the materials allow. */
function best(
  recipe: ConversionRecipe,
  state: State,
  market: ReadonlyMap<number, MarketItem>,
  method: 'instant' | 'list',
): Conversion | undefined {
  // Bounded by the input worth most: the others may be bought.
  const worth = (id: number, count: number) => (market.get(id)?.buy ?? 0) * count;
  const mainId = recipe.kind === 'promote' ? lowerTier(recipe) : undefined;
  const main = recipe.inputs.find(([id]) => id === mainId) ?? [...recipe.inputs].sort((a, b) => worth(b[0], b[1]) - worth(a[0], a[1]))[0];
  if (!main) return undefined;
  const most = Math.floor((state.spare.get(main[0]) ?? 0) / main[1]);
  if (most < 1) return undefined;
  const sizes = new Set<number>([most]);
  for (let i = 1; i <= Math.min(SIZES, most); i++) sizes.add(Math.max(1, Math.floor((most * i) / Math.min(SIZES, most))));
  let chosen: Conversion | undefined;
  for (const crafts of sizes) {
    const c = evaluate(recipe, crafts, state, market, method);
    if (c && (!chosen || c.gain > chosen.gain)) chosen = c;
  }
  return chosen;
}

/**
 * The conversions worth doing with `spare` (item id → units), best gain first.
 * Greedy: each takes its materials before the next is chosen.
 */
export function planConversions(
  spare: ReadonlyMap<number, number>,
  data: ConversionData,
  options: { method?: 'instant' | 'list'; minGain?: number } = {},
): Conversion[] {
  const method = options.method ?? 'instant';
  const minGain = options.minGain ?? DEFAULT_MIN_GAIN;
  const state: State = { spare: new Map(spare), selling: new Map(), shards: data.spiritShards ?? Infinity };
  const open = new Set(data.recipes);
  const out: Conversion[] = [];
  for (;;) {
    let pick: { recipe: ConversionRecipe; conversion: Conversion } | undefined;
    for (const recipe of open) {
      const conversion = best(recipe, state, data.market, method);
      // Materials only run out, so a recipe that can't gain now never will.
      if (!conversion || conversion.gain < minGain) open.delete(recipe);
      else if (!pick || conversion.gain > pick.conversion.gain) pick = { recipe, conversion };
    }
    if (!pick) return out;
    const { recipe, conversion } = pick;
    open.delete(recipe);
    out.push(conversion);
    for (const u of conversion.uses) state.spare.set(u.id, (state.spare.get(u.id) ?? 0) - u.count);
    state.selling.set(conversion.output, (state.selling.get(conversion.output) ?? 0) + conversion.units);
    state.shards -= conversion.spiritShards;
  }
}
