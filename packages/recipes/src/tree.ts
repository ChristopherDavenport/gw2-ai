import { mapLimit, type Gw2Client, type Recipe, type RecipeIngredient } from '@gw2kit/client';
import { pageUrl, type MysticForgeRecipe, type VendorCaps, type VendorOffer, type WikiClient } from '@gw2kit/wiki';

export type IngredientKind = RecipeIngredient['type'];

/**
 * How to get a node: buy it on the trading post, craft it from its children
 * (at a crafting station or in the Mystic Forge), buy it from an NPC vendor
 * for its children (currencies or items), take it from the account's stock
 * (`owned`), or no known route exists (rewards, drops, currencies, guild
 * upgrades).
 */
export type TreeChoice = 'buy' | 'craft' | 'vendor' | 'owned' | 'unavailable';

/** One distinct vendor price for an item, and who charges it. */
export interface TreeVendorOffer {
  /** Units received per purchase. */
  quantity: number;
  /** Paid per purchase: wallet currencies (`Currency`, Coin in copper) and items. */
  costs: { kind: 'Item' | 'Currency'; id: number; name: string; amount: number }[];
  /** Vendors (wiki page titles) with this exact offer. */
  vendors: string[];
  /** Purchase limits of the first vendor listed. */
  caps: VendorCaps;
}

export interface TreeVendor {
  /**
   * The offer the tree costs: one paid in the preferred currency if one was
   * set, else coin-only if one exists, else the one most vendors use.
   */
  offer: TreeVendorOffer;
  /** Purchases needed: ceil(count / offer.quantity). */
  purchases: number;
  /** Other current offers, most common first. */
  alternatives: TreeVendorOffer[];
  /** The item's wiki page. */
  url: string;
}

export interface TreeRecipe {
  /** `crafting`: a /v2/recipes recipe. `mystic-forge`: a wiki recipe (the API has none). */
  source: 'crafting' | 'mystic-forge';
  /** /v2/recipes id; 0 for Mystic Forge recipes. */
  id: number;
  disciplines: string[];
  min_rating: number;
  /**
   * Units per craft or forge. Fractional for chance-based Mystic Forge
   * recipes, where it is the wiki's average yield (Mystic Clover: 0.31).
   */
  output_count: number;
  /** Times the recipe has to be crafted: ceil(count / output_count). */
  crafts: number;
  /** Mystic Forge only: the wiki recipe's name and page. */
  wiki?: { name: string; url: string };
}

/** A recipe from either source, as stored in RecipeData. */
export interface SourceRecipe {
  source: TreeRecipe['source'];
  id: number;
  disciplines: string[];
  min_rating: number;
  output_count: number;
  ingredients: { type: IngredientKind; id: number; count: number }[];
  wiki?: { name: string; url: string };
}

export interface RecipeTreeNode {
  kind: IngredientKind;
  /** Item id, currency id or guild upgrade id, depending on `kind`. */
  itemId: number;
  name: string;
  /** Units still needed after taking `owned` from holdings. */
  count: number;
  /** Units taken from the account's holdings (0 unless `have` was given). */
  owned: number;
  recipe?: TreeRecipe;
  /** Other API recipes for this output that were not picked. */
  alternatives: number;
  children: RecipeTreeNode[];
  /** Lowest trading post sell listing, per unit. */
  unitPrice?: number;
  /** unitPrice × count. */
  buyPrice?: number;
  /** Sum of the children's best costs (priced children only; see craftComplete). */
  craftCost?: number;
  /** False when some leaf under the recipe has no price. */
  craftComplete: boolean;
  best: TreeChoice;
  /** Cost of the chosen route (0 for owned). Undefined when unavailable. */
  cost?: number;
  /** False when `cost` leaves out unpriced leaves. */
  complete: boolean;
  /** Why the node was not expanded further. */
  stop?: 'cycle' | 'depth-limit' | 'size-limit';
  /** Set when `best` is `vendor`: the offer used and the alternatives. */
  vendor?: TreeVendor;
  /**
   * The wiki lists vendors for this item, but none of their offers could be
   * costed (a cost currency the tool couldn't match, or only retired offers).
   */
  vendorUnmatched?: boolean;
  /**
   * Root only, when a wiki client was given: whether the Mystic Forge lookup
   * worked. On failure the tree has API recipes only.
   */
  mysticForge?: { status: 'ok' | 'failed'; error?: string };
  /**
   * Root only, when vendor lookups ran: `partial` when some items' lookups
   * failed (those stay unpriced).
   */
  vendors?: { status: 'ok' | 'partial' | 'failed'; error?: string };
}

export interface FetchRecipeOptions {
  /** Max recipe depth below the root. Default 10. */
  maxDepth?: number;
  /** Max distinct items fetched. Default 600. */
  maxItems?: number;
  /**
   * Look up Mystic Forge recipes on the wiki for items with no API recipe
   * (legendary weapons and gifts, clovers...). Without it, those items are
   * unpriced leaves. Costs about one wiki query per 10 such items per level.
   */
  wiki?: WikiClient;
  /**
   * With `wiki`: price items that have no recipe and no trading post listing
   * at their NPC vendors (Philosopher's Stone for Spirit Shards, Blessing of
   * the Jade Empress for Imperial Favor...). One wiki query per such item,
   * often 1-10 s each. Default true.
   */
  vendors?: boolean;
  /**
   * Item id → wallet currency id to pay its vendors in, overriding the "most
   * vendors" choice; e.g. `new Map([[19925, 2]])` buys Obsidian Shards with
   * Karma. Applied when fetching, since it decides which costs are looked up.
   */
  vendorCurrency?: ReadonlyMap<number, number>;
  /**
   * With `wiki`: also collect Mystic Forge material promotions, and what they
   * take, into `RecipeData.promotions`. The tree solver ignores them.
   */
  promotions?: boolean;
  /** Most vendor offers kept per item, best first. Default 5. */
  maxOffers?: number;
  /** Called as lookups finish. */
  onProgress?: (progress: FetchProgress) => void;
  /**
   * Called once recipes and prices are in, before vendor lookups, with the data
   * so far. It goes on changing: read it now or copy it.
   */
  onRecipes?: (data: RecipeData) => void;
}

export interface FetchProgress {
  /** `recipes`: the graph. `vendors`: items with no other route. `offers`: other places to buy. */
  phase: 'recipes' | 'vendors' | 'offers';
  done: number;
  /** Unknown while the graph is still growing. */
  total?: number;
}

export interface SolveRecipeOptions {
  /**
   * Holdings to use up before buying or crafting (item id → count). Not
   * mutated. Intermediate items are used first, so owning a crafted part
   * removes its whole subtree from the shopping list.
   */
  have?: ReadonlyMap<number, number>;
}

export type RecipeTreeOptions = FetchRecipeOptions & SolveRecipeOptions;

type Status<S extends string> = { status: S; error?: string };

/**
 * Everything solveRecipeTree needs, fetched once. Plain JSON: save it with
 * JSON.stringify and solve again later, offline, for other quantities or
 * holdings. Prices are a snapshot from `fetchedAt`.
 */
export interface RecipeData {
  /** Format version of this object. */
  version: 1;
  rootId: number;
  maxDepth: number;
  /** ISO time the data was fetched. */
  fetchedAt: string;
  /**
   * Item id → name, lowest trading post sell listing and highest buy order
   * (copper; absent when there is none), and whether the item is bound.
   */
  items: Record<number, { name: string; sell?: number; buy?: number; bound?: boolean }>;
  /** Item ids whose recipes were looked up; others are leaves at the fetch limits. */
  searched: number[];
  /** Output item id → recipes that make it. */
  recipes: Record<number, SourceRecipe[]>;
  /**
   * Output item id → material promotions, with `output_count` the average net
   * gain: the one unit of the output each forge takes is left out of both
   * sides. Present only when asked for.
   */
  promotions?: Record<number, SourceRecipe[]>;
  /** Currency id → name. */
  currencies: Record<number, string>;
  /** Guild upgrade id → name. */
  guildUpgrades: Record<number, string>;
  /** Item id → its wiki page and current vendor offers, best first. */
  vendors: Record<number, { url: string; offers: TreeVendorOffer[] }>;
  /** Items the wiki lists vendors for, none of whose offers could be costed. */
  vendorUnmatched: number[];
  /** ISO time other vendor offers were looked up (see addVendorOffers); absent until then. */
  offersFetchedAt?: string;
  /** Whether the wiki lookups worked; absent when they didn't run. */
  status: { mysticForge?: Status<'ok' | 'failed'>; vendors?: Status<'ok' | 'partial' | 'failed'> };
}

/** Most items looked up at vendors per tree; the rest stay unpriced. */
const MAX_VENDOR_ITEMS = 40;
/** Rounds of vendor lookups: items a vendor charges are looked up in the next round. */
const VENDOR_ROUNDS = 3;
/** Alternatives kept per vendor item, after the chosen offer. */
const VENDOR_ALTERNATIVES = 4;
const COIN_CURRENCY = 1;
const MAX_NODES = 20_000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const has = <T extends object>(record: T, key: number) => Object.hasOwn(record, key);

/**
 * Crafting tree for `quantity` of `itemId`: fetchRecipeData then
 * solveRecipeTree. Use those two directly to fetch once and solve many times.
 */
export async function buildRecipeTree(
  client: Gw2Client,
  itemId: number,
  quantity = 1,
  options: RecipeTreeOptions = {},
): Promise<RecipeTreeNode> {
  const data = await fetchRecipeData(client, itemId, options);
  return solveRecipeTree(data, quantity, options.have ? { have: options.have } : {});
}

/**
 * Fetch what a tree for `itemId` needs: items, trading post prices and API
 * recipes, level by level (one /v2/items, /v2/commerce/prices and /v2/recipes
 * call per 200 ids, plus one /v2/recipes/search per item, since the API has
 * no bulk search). With `options.wiki`, also Mystic Forge recipes, and NPC vendor offers for items with no recipe and no
 * trading post listing.
 */
export async function fetchRecipeData(
  client: Gw2Client,
  itemIds: number | readonly number[],
  options: FetchRecipeOptions = {},
): Promise<RecipeData> {
  // Several roots share one graph, so what they have in common is fetched once.
  const roots = [...new Set(typeof itemIds === 'number' ? [itemIds] : itemIds)];
  const itemId = roots[0];
  if (itemId === undefined) throw new Error('No item to fetch recipes for.');
  const maxDepth = options.maxDepth ?? 10;
  const maxItems = (options.maxItems ?? 600) * roots.length;
  const wiki = options.wiki;
  const data: RecipeData = {
    version: 1,
    rootId: itemId,
    maxDepth,
    fetchedAt: new Date().toISOString(),
    items: {},
    searched: [],
    recipes: {},
    currencies: {},
    guildUpgrades: {},
    vendors: {},
    vendorUnmatched: [],
    status: {},
    ...(options.promotions && wiki ? { promotions: {} } : {}),
  };
  const searched = new Set<number>();
  const seen = new Set<number>(roots);
  const currencyIds = new Set<number>();
  const upgradeIds = new Set<number>();
  let frontier = roots;

  for (let depth = 0; frontier.length > 0 && depth <= maxDepth; depth++) {
    const search = depth < maxDepth;
    const [recipeIdLists] = await Promise.all([
      search ? mapLimit(frontier, 8, (id) => client.get('/v2/recipes/search', { query: { output: id } })) : Promise.resolve([]),
      addItems(client, data, frontier),
    ]);
    if (search) for (const id of frontier) searched.add(id);

    const found: [output: number, recipe: SourceRecipe][] = [];
    const recipes = await client.many('/v2/recipes', recipeIdLists.flat());
    for (const r of recipes.values()) found.push([r.output_item_id, fromApi(r)]);

    const promoted: typeof found = [];
    // Mystic Forge recipes from the wiki. Items the API can craft can have one too.
    if (search && wiki && data.status.mysticForge?.status !== 'failed') {
      try {
        for (const r of await wiki.mysticForgeRecipes(frontier)) {
          const recipe = fromForge(r);
          if (recipe) found.push([r.output_item_id, recipe]);
          const promotion = data.promotions && fromPromotion(r);
          if (promotion) promoted.push([r.output_item_id, promotion]);
        }
        data.status.mysticForge = { status: 'ok' };
      } catch (err) {
        data.status.mysticForge = { status: 'failed', error: errorText(err) };
      }
    }

    const next: number[] = [];
    for (const [output, r] of found) (data.recipes[output] ??= []).push(r);
    for (const [output, r] of promoted) (data.promotions![output] ??= []).push(r);
    for (const [, r] of [...found, ...promoted]) {
      for (const ing of r.ingredients) {
        if (ing.type === 'Currency') currencyIds.add(ing.id);
        else if (ing.type === 'GuildUpgrade') upgradeIds.add(ing.id);
        else if (!seen.has(ing.id) && seen.size < maxItems) {
          seen.add(ing.id);
          next.push(ing.id);
        }
      }
    }
    frontier = next;
    options.onProgress?.({ phase: 'recipes', done: seen.size });
  }
  data.searched = [...searched].sort((a, b) => a - b);

  // Currency and upgrade names first, so the partial data reads properly.
  if (currencyIds.size > 0) await addCurrencies(client, data);
  if (upgradeIds.size > 0) {
    for (const [id, u] of await client.many('/v2/guild/upgrades', upgradeIds)) data.guildUpgrades[id] = u.name;
  }
  options.onRecipes?.(data);
  if (wiki && options.vendors !== false) {
    const unpriced = Object.keys(data.items).map(Number).filter((id) => unpricedLeaf(data, searched, id));
    await addVendors(client, wiki, data, searched, unpriced, options, 'vendors', MAX_VENDOR_ITEMS * roots.length);
  }
  data.searched = [...searched].sort((a, b) => a - b);
  return data;
}

/** Names and trading post sell prices for `ids`. */
async function addItems(client: Gw2Client, data: RecipeData, ids: Iterable<number>): Promise<void> {
  const [defs, prices] = await Promise.all([client.many('/v2/items', ids), client.many('/v2/commerce/prices', ids)]);
  for (const [id, item] of defs) {
    const sell = prices.get(id)?.sells.unit_price ?? 0;
    const buy = prices.get(id)?.buys?.unit_price ?? 0;
    const bound = item.flags?.some((f) => f === 'AccountBound' || f === 'SoulbindOnAcquire') ?? false;
    data.items[id] = { name: item.name, ...(sell > 0 ? { sell } : {}), ...(buy > 0 ? { buy } : {}), ...(bound ? { bound } : {}) };
  }
}

async function addCurrencies(client: Gw2Client, data: RecipeData): Promise<{ id: number; name: string }[]> {
  const currencies = await client.all('/v2/currencies');
  for (const c of currencies) data.currencies[c.id] = c.name;
  return currencies;
}

const unpricedLeaf = (data: RecipeData, searched: ReadonlySet<number>, id: number) =>
  searched.has(id) && !has(data.recipes, id) && has(data.items, id) && data.items[id]!.sell === undefined;

/**
 * Vendor offers for items that have a recipe or a trading post listing, which
 * fetchRecipeData skips: Mystic Coins and Clovers from the Wizard's Vault and
 * weekly vendors. One wiki query per item. Adds to `data`.
 */
export async function addVendorOffers(
  client: Gw2Client,
  wiki: WikiClient,
  data: RecipeData,
  ids: readonly number[],
  options: Pick<FetchRecipeOptions, 'vendorCurrency' | 'maxOffers' | 'onProgress'> = {},
): Promise<void> {
  const wanted = ids.filter((id) => has(data.items, id) && !has(data.vendors, id));
  if (wanted.length) await addVendors(client, wiki, data, new Set(data.searched), wanted, options, 'offers');
}

/**
 * Vendor offers for `first` (items with no recipe and no trading post price). Cost
 * names are matched to wallet currencies (/v2/currencies) or to items (wiki
 * item pages); offers with a cost that matches neither are left out. Items
 * the chosen offer charges (Obsidian Shard for Funerary Incense) are looked
 * up in later rounds.
 */
async function addVendors(
  client: Gw2Client,
  wiki: WikiClient,
  data: RecipeData,
  searched: Set<number>,
  first: readonly number[],
  options: Pick<FetchRecipeOptions, 'vendorCurrency' | 'maxOffers' | 'onProgress'>,
  phase: FetchProgress['phase'] = 'vendors',
  maxLooked = MAX_VENDOR_ITEMS,
): Promise<void> {
  const prefer = options.vendorCurrency ?? new Map<number, number>();
  const maxOffers = options.maxOffers ?? 1 + VENDOR_ALTERNATIVES;
  const looked = new Set<number>();
  const unmatched = new Set<number>();
  let candidates = [...first];
  let failures = 0;
  let attempts = 0;
  let lastError = '';
  let currencyByName: Map<string, { id: number; name: string }> | undefined;

  for (let round = 0; round < VENDOR_ROUNDS && candidates.length; round++) {
    candidates = candidates.filter((id) => !looked.has(id)).slice(0, maxLooked - looked.size);
    if (!candidates.length) break;
    for (const id of candidates) looked.add(id);

    let pages: Map<number, string>;
    try {
      pages = await wiki.itemPages(candidates);
    } catch (err) {
      failures++;
      attempts++;
      lastError = errorText(err);
      break;
    }
    const offersById = new Map<number, VendorOffer[]>();
    let finished = 0;
    options.onProgress?.({ phase, done: 0, total: pages.size });
    await mapLimit([...pages], 3, async ([id, title]) => {
      attempts++;
      try {
        const offers = (await wiki.vendorOffers(title)).filter((o) => !o.historical);
        if (offers.length) offersById.set(id, offers);
      } catch (err) {
        failures++;
        lastError = errorText(err);
      }
      options.onProgress?.({ phase, done: ++finished, total: pages.size });
    });
    if (!offersById.size) break;

    // Match cost names: wallet currencies first, then wiki item pages.
    currencyByName ??= new Map(
      (await addCurrencies(client, data)).filter((c) => c.name).map((c) => [currencyKey(c.name), c]),
    );
    const resolved = new Map<string, { kind: 'Item' | 'Currency'; id: number; name: string }>();
    const itemNames: string[] = [];
    for (const name of new Set([...offersById.values()].flat().flatMap((o) => o.costs.map((c) => c.name)))) {
      const currency = currencyByName.get(currencyKey(name));
      if (currency) resolved.set(name, { kind: 'Currency', id: currency.id, name: currency.name });
      else itemNames.push(name);
    }
    if (itemNames.length) {
      const ids = await wiki.itemIdsByTitle(itemNames.flatMap(nameVariants)).catch(() => new Map<string, number>());
      for (const name of itemNames) {
        const hit = nameVariants(name).find((v) => ids.has(v));
        if (hit) resolved.set(name, { kind: 'Item', id: ids.get(hit)!, name: hit });
      }
    }

    const costItems = new Set<number>();
    for (const [id, offers] of offersById) {
      const ranked = rankOffers(offers, resolved, prefer.get(id));
      if (!ranked.length) {
        unmatched.add(id);
        continue;
      }
      data.vendors[id] = { url: pageUrl(pages.get(id)!), offers: ranked.slice(0, maxOffers) };
      // The tree only costs the first offer; keeping more means pricing what they charge too.
      const priced = options.maxOffers ? ranked.slice(0, maxOffers) : ranked.slice(0, 1);
      for (const c of priced.flatMap((o) => o.costs)) if (c.kind === 'Item' && !has(data.items, c.id)) costItems.add(c.id);
    }

    // Cost items are priced at the trading post and not crafted; unpriced ones go to the next round.
    if (costItems.size) {
      await addItems(client, data, costItems);
      for (const id of costItems) searched.add(id);
    }
    candidates = Object.values(data.vendors)
      .flatMap((v) => v.offers[0]!.costs.filter((c) => c.kind === 'Item').map((c) => c.id))
      .filter((id) => !has(data.vendors, id) && unpricedLeaf(data, searched, id));
  }
  data.vendorUnmatched = [...new Set([...data.vendorUnmatched, ...unmatched])].sort((a, b) => a - b);
  // A later pass must not hide an earlier one's failures.
  if (attempts && (failures > 0 || !data.status.vendors)) {
    data.status.vendors = failures === 0 ? { status: 'ok' } : { status: failures >= attempts ? 'failed' : 'partial', error: lastError };
  }
}

/**
 * Currency names compared word by word in singular form: the wiki writes
 * `Tale of Dungeon Delving` and `Trade Contracts` where the API has `Tales of
 * Dungeon Delving` and `Trade Contract`.
 */
function currencyKey(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/ies$/, 'y').replace(/s$/, ''))
    .join(' ');
}

/** `Trade Contracts` → also try `Trade Contract`, and the reverse. */
function nameVariants(name: string): string[] {
  const out = [name];
  if (/ies$/.test(name)) out.push(name.replace(/ies$/, 'y'));
  if (/s$/.test(name)) out.push(name.replace(/s$/, ''));
  else out.push(`${name}s`);
  return out;
}

/**
 * Group current offers by price per unit and rank them, best first. With a
 * preferred currency: offers paid only in it, then offers that include it,
 * cheapest in it per unit. Otherwise: the cheapest coin-only offer if any,
 * else the price the most vendors charge (ties: fewer cost lines). Empty when
 * no offer's costs could all be matched.
 */
function rankOffers(
  offers: readonly VendorOffer[],
  resolved: ReadonlyMap<string, { kind: 'Item' | 'Currency'; id: number; name: string }>,
  preferred?: number,
): TreeVendorOffer[] {
  const groups = new Map<string, TreeVendorOffer>();
  for (const o of offers) {
    const costs = o.costs.map((c) => {
      const r = resolved.get(c.name);
      return r ? { ...r, amount: c.amount } : undefined;
    });
    if (costs.some((c) => c === undefined)) continue;
    const list = (costs as TreeVendorOffer['costs']).sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
    const key = JSON.stringify([o.quantity, list.map((c) => [c.kind, c.id, c.amount])]);
    const g = groups.get(key);
    if (g) {
      if (!g.vendors.includes(o.vendor)) g.vendors.push(o.vendor);
    } else {
      groups.set(key, { quantity: o.quantity, costs: list, vendors: [o.vendor], caps: o.caps });
    }
  }
  const coinOnly = (g: TreeVendorOffer) => g.costs.every((c) => c.kind === 'Currency' && c.id === COIN_CURRENCY);
  const perUnitCoin = (g: TreeVendorOffer) => g.costs.reduce((s, c) => s + c.amount, 0) / g.quantity;
  /** Preferred-currency ordering: paid only in it, then including it, then cheapest in it per unit, then smaller bundles. */
  const byPreferred = (a: TreeVendorOffer, b: TreeVendorOffer): number => {
    if (preferred === undefined) return 0;
    const perUnit = (g: TreeVendorOffer) => (g.costs.find((c) => c.kind === 'Currency' && c.id === preferred)?.amount ?? Infinity) / g.quantity;
    const only = (g: TreeVendorOffer) => g.costs.every((c) => c.kind === 'Currency' && c.id === preferred);
    const has = (g: TreeVendorOffer) => perUnit(g) < Infinity;
    return (
      Number(only(b)) - Number(only(a)) ||
      Number(has(b)) - Number(has(a)) ||
      (has(a) && has(b) ? perUnit(a) - perUnit(b) || a.quantity - b.quantity : 0)
    );
  };
  return [...groups.values()].sort(
    (a, b) =>
      byPreferred(a, b) ||
      Number(coinOnly(b)) - Number(coinOnly(a)) ||
      (coinOnly(a) && coinOnly(b) ? perUnitCoin(a) - perUnitCoin(b) : 0) ||
      b.vendors.length - a.vendors.length ||
      a.costs.length - b.costs.length,
  );
}

function fromApi(r: Recipe): SourceRecipe {
  return {
    source: 'crafting',
    id: r.id,
    disciplines: r.disciplines,
    min_rating: r.min_rating,
    output_count: r.output_item_count,
    ingredients: r.ingredients,
  };
}

/**
 * A wiki recipe the tree can use, or undefined. Only `base` recipes count:
 * the wiki marks random-output, promotion and demotion recipes as unfit for
 * material totals (and gives chance-based ones an average-yield twin).
 */
function fromForge(r: MysticForgeRecipe): SourceRecipe | undefined {
  if (!r.base) return undefined;
  const ingredients: SourceRecipe['ingredients'] = [];
  for (const i of r.ingredients) {
    if (i.item_id === undefined) return undefined;
    ingredients.push({ type: 'Item', id: i.item_id, count: i.count });
  }
  return {
    source: 'mystic-forge',
    id: 0,
    disciplines: [],
    min_rating: 0,
    output_count: r.output_item_count,
    ingredients,
    wiki: { name: r.name, url: r.url },
  };
}

const PHILOSOPHERS_STONE = 20796;

/**
 * Average yield of a material promotion by its minimum, which is what the wiki
 * data holds (from the wiki's Mystic Forge/Material Promotion page): common
 * tiers 1-4 and 5, then fine tiers 1-4 and 5.
 */
const PROMOTION_AVERAGE: Record<number, number> = { 40: 86.34, 10: 18.92, 7: 18.51, 5: 6.91 };

/** A material promotion: a random forge that takes one of what it makes, plus a Philosopher's Stone. */
function fromPromotion(r: MysticForgeRecipe): SourceRecipe | undefined {
  const seed = r.ingredients.find((i) => i.item_id === r.output_item_id);
  const average = PROMOTION_AVERAGE[r.output_item_count];
  if (r.base || !seed || !average || !r.ingredients.some((i) => i.item_id === PHILOSOPHERS_STONE)) return undefined;
  const recipe = fromForge({ ...r, base: true, ingredients: r.ingredients.filter((i) => i !== seed) });
  return recipe && { ...recipe, output_count: Math.round((average - seed.count) * 100) / 100 };
}

/**
 * The cheapest route to `quantity` of `data.rootId`: a buy-or-craft choice per
 * node at the fetched trading post prices, vendor routes for items with
 * neither, and `options.have` used up first. Pure: no requests.
 */
export function solveRecipeTree(data: RecipeData, quantity = 1, options: SolveRecipeOptions = {}): RecipeTreeNode {
  const ctx: Solve = {
    data,
    searched: new Set(data.searched),
    unmatched: new Set(data.vendorUnmatched),
    budget: { nodes: 0 },
  };
  const have = new Map(options.have ?? []);
  const root = solveNode(ctx, 'Item', data.rootId, Math.max(1, Math.floor(quantity)), 0, new Set(), have);
  if (data.status.mysticForge) root.mysticForge = data.status.mysticForge;
  if (data.status.vendors) root.vendors = data.status.vendors;
  return root;
}

interface Solve {
  data: RecipeData;
  searched: ReadonlySet<number>;
  unmatched: ReadonlySet<number>;
  budget: { nodes: number };
}

function solveNode(
  ctx: Solve,
  kind: IngredientKind,
  id: number,
  count: number,
  depth: number,
  path: ReadonlySet<number>,
  have: Map<number, number>,
): RecipeTreeNode {
  const { data } = ctx;
  ctx.budget.nodes++;
  if (kind !== 'Item') {
    const name = (kind === 'Currency' ? data.currencies : data.guildUpgrades)[id] ?? `#${id}`;
    const node: RecipeTreeNode = {
      kind,
      itemId: id,
      name,
      count,
      owned: 0,
      alternatives: 0,
      children: [],
      craftComplete: false,
      best: 'unavailable',
      complete: false,
    };
    if (kind === 'Currency' && id === COIN_CURRENCY) {
      // Coin ingredients are counted in copper.
      node.unitPrice = 1;
      node.buyPrice = count;
      node.best = 'buy';
      node.cost = count;
      node.complete = true;
    }
    return node;
  }

  const item = data.items[id];
  const stock = have.get(id) ?? 0;
  const owned = Math.min(stock, count);
  if (owned > 0) have.set(id, stock - owned);
  const need = count - owned;

  const node: RecipeTreeNode = {
    kind,
    itemId: id,
    name: item?.name || `#${id}`,
    count: need,
    owned,
    alternatives: 0,
    children: [],
    craftComplete: false,
    best: 'unavailable',
    complete: false,
  };
  if (item?.sell !== undefined) {
    node.unitPrice = item.sell;
    node.buyPrice = item.sell * need;
  }
  if (need === 0) {
    node.best = 'owned';
    node.cost = 0;
    node.complete = true;
    return node;
  }

  const recipes = data.recipes[id] ?? [];
  if (path.has(id)) node.stop = 'cycle';
  else if (ctx.budget.nodes > MAX_NODES || (!ctx.searched.has(id) && depth < data.maxDepth)) node.stop = 'size-limit';
  else if (depth >= data.maxDepth) node.stop = 'depth-limit';

  if (!node.stop && recipes.length > 0) {
    const childPath = new Set(path).add(id);
    let picked: { recipe: SourceRecipe; children: RecipeTreeNode[]; cost: number; complete: boolean; have: Map<number, number> } | undefined;
    for (const recipe of recipes) {
      const crafts = craftsFor(need, recipe.output_count);
      const trial = new Map(have);
      const children = recipe.ingredients.map((ing) => solveNode(ctx, ing.type, ing.id, ing.count * crafts, depth + 1, childPath, trial));
      const cost = children.reduce((sum, c) => sum + (c.cost ?? 0), 0);
      const complete = children.every((c) => c.complete);
      if (!picked || better({ recipe, cost, complete }, picked)) picked = { recipe, children, cost, complete, have: trial };
    }
    if (picked) {
      const r = picked.recipe;
      node.recipe = {
        source: r.source,
        id: r.id,
        disciplines: r.disciplines,
        min_rating: r.min_rating,
        output_count: r.output_count,
        crafts: craftsFor(need, r.output_count),
        ...(r.wiki ? { wiki: r.wiki } : {}),
      };
      node.alternatives = recipes.length - 1;
      node.children = picked.children;
      node.craftCost = picked.cost;
      node.craftComplete = picked.complete;

      const craftWins = node.buyPrice === undefined || (picked.complete && picked.cost < node.buyPrice);
      if (craftWins) {
        node.best = 'craft';
        node.cost = picked.cost;
        node.complete = picked.complete;
        // Commit the holdings the chosen recipe consumed.
        have.clear();
        for (const [k, v] of picked.have) have.set(k, v);
        return node;
      }
    }
  }

  if (node.buyPrice !== undefined) {
    node.best = 'buy';
    node.cost = node.buyPrice;
    node.complete = true;
    return node;
  }

  // No recipe and no trading post price: an NPC vendor, if the wiki has one.
  const vendor = data.vendors[id];
  const offer = vendor?.offers[0];
  if (vendor && offer && !node.stop) {
    const purchases = craftsFor(need, offer.quantity);
    const childPath = new Set(path).add(id);
    node.children = offer.costs.map((c) => solveNode(ctx, c.kind, c.id, c.amount * purchases, depth + 1, childPath, have));
    node.vendor = { offer, purchases, alternatives: vendor.offers.slice(1), url: vendor.url };
    node.best = 'vendor';
    node.cost = node.children.reduce((sum, c) => sum + (c.cost ?? 0), 0);
    node.complete = node.children.every((c) => c.complete);
  } else if (ctx.unmatched.has(id)) {
    node.vendorUnmatched = true;
  }
  return node;
}

/**
 * Crafts or forges needed for `need` units. A fractional `output` (average
 * yield of a chance-based forge) gives the expected number of forges; the
 * epsilon keeps float error (10 / 0.1) from adding one.
 */
function craftsFor(need: number, output: number): number {
  return Math.max(1, Math.ceil(need / (output > 0 ? output : 1) - 1e-9));
}

function better(
  a: { recipe: SourceRecipe; cost: number; complete: boolean },
  b: { recipe: SourceRecipe; cost: number; complete: boolean },
): boolean {
  if (a.complete !== b.complete) return a.complete;
  if (a.cost !== b.cost) return a.cost < b.cost;
  return a.recipe.min_rating < b.recipe.min_rating;
}

export interface TreeLeaf {
  kind: IngredientKind;
  itemId: number;
  name: string;
  /** Units to acquire. */
  count: number;
  unitPrice?: number;
  /** Total cost at unitPrice, when priced. */
  cost?: number;
  /** True when no API recipe and no trading post price exists for it. */
  unpriced: boolean;
  /** Sold by vendors, but for costs the tool couldn't match. */
  vendorUnmatched?: boolean;
}

/**
 * Leaves to acquire, summed by id. `best` follows the buy-or-craft choice at
 * each node (the shopping list); `raw` expands every node that has a recipe
 * (the raw materials for crafting everything yourself).
 */
export function flattenLeaves(tree: RecipeTreeNode, mode: 'best' | 'raw' = 'best'): TreeLeaf[] {
  const out = new Map<string, TreeLeaf>();
  const visit = (n: RecipeTreeNode): void => {
    if (n.best === 'owned' || n.count === 0) return;
    const expand = n.children.length > 0 && (mode === 'raw' || n.best === 'craft' || n.best === 'vendor');
    if (expand) {
      for (const c of n.children) visit(c);
      return;
    }
    const key = `${n.kind}:${n.itemId}`;
    const leaf = out.get(key) ?? {
      kind: n.kind,
      itemId: n.itemId,
      name: n.name,
      count: 0,
      ...(n.unitPrice !== undefined ? { unitPrice: n.unitPrice } : {}),
      unpriced: n.unitPrice === undefined,
      ...(n.vendorUnmatched ? { vendorUnmatched: true } : {}),
    };
    leaf.count += n.count;
    if (leaf.unitPrice !== undefined) leaf.cost = leaf.unitPrice * leaf.count;
    out.set(key, leaf);
  };
  visit(tree);
  return [...out.values()].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.name.localeCompare(b.name));
}

/** Holdings the chosen route uses, summed by item id. */
export function stockUsed(tree: RecipeTreeNode): { itemId: number; name: string; count: number }[] {
  const out = new Map<number, { itemId: number; name: string; count: number }>();
  const visit = (n: RecipeTreeNode): void => {
    if (n.owned > 0) {
      const e = out.get(n.itemId) ?? { itemId: n.itemId, name: n.name, count: 0 };
      e.count += n.owned;
      out.set(n.itemId, e);
    }
    if (n.best === 'craft' || n.best === 'vendor') for (const c of n.children) visit(c);
  };
  visit(tree);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

