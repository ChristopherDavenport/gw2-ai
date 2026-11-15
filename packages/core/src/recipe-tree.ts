import {
  mapLimit,
  pageUrl,
  type CommercePrice,
  type Gw2Client,
  type Item,
  type MysticForgeRecipe,
  type Recipe,
  type RecipeIngredient,
  type VendorCaps,
  type VendorOffer,
  type WikiClient,
} from '@gw2-ai/client';
import { byId } from './catalog.js';
import { coins, num, table } from './format.js';

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
  /** The offer the tree costs: coin-only if one exists, else the one most vendors use. */
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

/** A recipe from either source, as the tree uses it. */
interface SourceRecipe {
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

export interface RecipeTreeOptions {
  /** Max recipe depth below the root. Default 10. */
  maxDepth?: number;
  /** Max distinct items fetched. Default 600. */
  maxItems?: number;
  /**
   * Holdings to use up before buying or crafting (item id → count). Not
   * mutated. Intermediate items are used first, so owning a crafted part
   * removes its whole subtree from the shopping list.
   */
  have?: ReadonlyMap<number, number>;
  /**
   * Look up Mystic Forge recipes on the wiki for items with no API recipe
   * (legendary weapons and gifts, clovers...). Without it, those items are
   * unpriced leaves. Costs about one wiki query per 10 such items per level.
   */
  wiki?: WikiClient;
  /**
   * With `wiki`: price items that have no recipe and no trading post listing
   * at their NPC vendors (Philosopher's Stone for Spirit Shards, Blessing for
   * Imperial Favor...). One wiki query per such item, often 1-10 s each.
   * Default true.
   */
  vendors?: boolean;
  /**
   * Item id → wallet currency id to pay its vendors in, overriding the "most
   * vendors" choice. Merged over DEFAULT_VENDOR_CURRENCY.
   */
  vendorCurrency?: ReadonlyMap<number, number>;
}

/**
 * Vendor currencies assumed by default. Obsidian Shard (19925): Karma (2),
 * the usual karma-for-obsidian exchange, not the Laurel offer most vendors
 * list.
 */
export const DEFAULT_VENDOR_CURRENCY: ReadonlyMap<number, number> = new Map([[19925, 2]]);

/** Most items looked up at vendors per tree; the rest stay unpriced. */
const MAX_VENDOR_ITEMS = 40;

interface TreeData {
  items: Map<number, Item>;
  prices: Map<number, CommercePrice>;
  recipesByOutput: Map<number, SourceRecipe[]>;
  /** Item ids whose recipes were searched. */
  searched: Set<number>;
  currencies: Map<number, { name: string }>;
  guildUpgrades: Map<number, { name: string }>;
  forge?: { status: 'ok' | 'failed'; error?: string };
  vendors: Map<number, TreeVendor>;
  vendorUnmatched: Set<number>;
  vendorStatus?: { status: 'ok' | 'partial' | 'failed'; error?: string };
}

const COIN_CURRENCY = 1;
const MAX_NODES = 20_000;

/**
 * Crafting tree for `quantity` of `itemId`, priced at the trading post, with
 * a buy-or-craft choice per node. Lookups are batched per tree level: one
 * /v2/items, /v2/commerce/prices and /v2/recipes call per 200 ids, plus one
 * /v2/recipes/search per distinct item (the API has no bulk search).
 *
 * Mystic Forge recipes are not in the API. With `options.wiki` they come from
 * the wiki for items that have no API recipe; without it, items such as
 * legendary gifts are leaves with no recipe and (if account bound) no price.
 */
export async function buildRecipeTree(
  client: Gw2Client,
  itemId: number,
  quantity = 1,
  options: RecipeTreeOptions = {},
): Promise<RecipeTreeNode> {
  const maxDepth = options.maxDepth ?? 10;
  const data = await fetchTreeData(client, options.wiki, itemId, maxDepth, options.maxItems ?? 600);
  if (options.wiki && options.vendors !== false) {
    const prefer = new Map([...DEFAULT_VENDOR_CURRENCY, ...(options.vendorCurrency ?? [])]);
    await addVendors(client, options.wiki, data, prefer);
  }
  const have = new Map(options.have ?? []);
  const budget = { nodes: 0 };
  const root = buildNode(data, 'Item', itemId, Math.max(1, Math.floor(quantity)), 0, new Set(), have, maxDepth, budget);
  if (data.forge) root.mysticForge = data.forge;
  if (data.vendorStatus) root.vendors = data.vendorStatus;
  return root;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Rounds of vendor lookups: items a vendor charges are looked up in the next round. */
const VENDOR_ROUNDS = 3;

/**
 * Vendor offers for items with no recipe and no trading post price. Cost
 * names are matched to wallet currencies (/v2/currencies) or to items (wiki
 * item pages); offers with a cost that matches neither are left out. Items a
 * chosen offer charges (Obsidian Shard for Funerary Incense) are looked up
 * in later rounds.
 */
async function addVendors(client: Gw2Client, wiki: WikiClient, data: TreeData, prefer: ReadonlyMap<number, number>): Promise<void> {
  const unpricedLeaf = (id: number) =>
    data.searched.has(id) && !data.recipesByOutput.has(id) && !((data.prices.get(id)?.sells.unit_price ?? 0) > 0);
  const looked = new Set<number>();
  let candidates = [...data.items.keys()].filter(unpricedLeaf);
  let failures = 0;
  let attempts = 0;
  let lastError = '';
  let currencyByName: Map<string, { id: number; name: string }> | undefined;

  for (let round = 0; round < VENDOR_ROUNDS && candidates.length; round++) {
    candidates = candidates.filter((id) => !looked.has(id)).slice(0, MAX_VENDOR_ITEMS - looked.size);
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
    await mapLimit([...pages], 3, async ([id, title]) => {
      attempts++;
      try {
        const offers = (await wiki.vendorOffers(title)).filter((o) => !o.historical);
        if (offers.length) offersById.set(id, offers);
      } catch (err) {
        failures++;
        lastError = errorText(err);
      }
    });
    if (!offersById.size) break;

    // Match cost names: wallet currencies first, then wiki item pages.
    if (!currencyByName) {
      const currencies = await client.all('/v2/currencies');
      data.currencies = byId(currencies);
      currencyByName = new Map(currencies.filter((c) => c.name).map((c) => [currencyKey(c.name), c]));
    }
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
      const vendor = chooseOffer(offers, resolved, pages.get(id)!, prefer.get(id));
      if (!vendor) {
        data.vendorUnmatched.add(id);
        continue;
      }
      data.vendors.set(id, vendor);
      for (const c of vendor.offer.costs) if (c.kind === 'Item' && !data.items.has(c.id)) costItems.add(c.id);
    }

    // Cost items are priced at the trading post and not crafted; unpriced ones go to the next round.
    if (costItems.size) {
      const [defs, prices] = await Promise.all([client.many('/v2/items', costItems), client.many('/v2/commerce/prices', costItems)]);
      for (const [id, item] of defs) data.items.set(id, item);
      for (const [id, price] of prices) data.prices.set(id, price);
      for (const id of costItems) data.searched.add(id);
    }
    candidates = [...costItems, ...[...data.vendors.values()].flatMap((v) => v.offer.costs.filter((c) => c.kind === 'Item').map((c) => c.id))].filter(
      (id) => data.items.has(id) && unpricedLeaf(id),
    );
  }
  if (attempts) {
    data.vendorStatus =
      failures === 0 ? { status: 'ok' } : { status: failures >= attempts ? 'failed' : 'partial', error: lastError };
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
 * Group current offers by price per unit and pick one. With a preferred
 * currency: offers paid only in it, then offers that include it, cheapest in
 * it per unit. Otherwise: the cheapest coin-only offer if any, else the price
 * the most vendors charge (ties: fewer cost lines). Undefined when no offer's
 * costs could all be matched.
 */
function chooseOffer(
  offers: readonly VendorOffer[],
  resolved: ReadonlyMap<string, { kind: 'Item' | 'Currency'; id: number; name: string }>,
  title: string,
  preferred?: number,
): TreeVendor | undefined {
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
  if (!groups.size) return undefined;
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
  const ranked = [...groups.values()].sort(
    (a, b) =>
      byPreferred(a, b) ||
      Number(coinOnly(b)) - Number(coinOnly(a)) ||
      (coinOnly(a) && coinOnly(b) ? perUnitCoin(a) - perUnitCoin(b) : 0) ||
      b.vendors.length - a.vendors.length ||
      a.costs.length - b.costs.length,
  );
  return { offer: ranked[0]!, purchases: 0, alternatives: ranked.slice(1, 5), url: pageUrl(title) };
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

async function fetchTreeData(
  client: Gw2Client,
  wiki: WikiClient | undefined,
  rootId: number,
  maxDepth: number,
  maxItems: number,
): Promise<TreeData> {
  const data: TreeData = {
    items: new Map(),
    prices: new Map(),
    recipesByOutput: new Map(),
    searched: new Set(),
    currencies: new Map(),
    guildUpgrades: new Map(),
    vendors: new Map(),
    vendorUnmatched: new Set(),
  };
  const seen = new Set<number>([rootId]);
  const currencyIds = new Set<number>();
  const upgradeIds = new Set<number>();
  let frontier = [rootId];

  for (let depth = 0; frontier.length > 0 && depth <= maxDepth; depth++) {
    const search = depth < maxDepth;
    const [defs, prices, recipeIdLists] = await Promise.all([
      client.many('/v2/items', frontier),
      client.many('/v2/commerce/prices', frontier),
      search
        ? mapLimit(frontier, 8, (id) => client.get('/v2/recipes/search', { query: { output: id } }))
        : Promise.resolve([]),
    ]);
    for (const [id, item] of defs) data.items.set(id, item);
    for (const [id, price] of prices) data.prices.set(id, price);
    if (search) for (const id of frontier) data.searched.add(id);

    const found: [output: number, recipe: SourceRecipe][] = [];
    const recipes = await client.many('/v2/recipes', recipeIdLists.flat());
    for (const r of recipes.values()) found.push([r.output_item_id, fromApi(r)]);

    // Mystic Forge recipes from the wiki, for items the API can't craft.
    if (search && wiki && data.forge?.status !== 'failed') {
      const crafted = new Set(found.map(([out]) => out));
      const uncrafted = frontier.filter((id) => !crafted.has(id));
      try {
        for (const r of await wiki.mysticForgeRecipes(uncrafted)) {
          const recipe = fromForge(r);
          if (recipe) found.push([r.output_item_id, recipe]);
        }
        data.forge = { status: 'ok' };
      } catch (err) {
        data.forge = { status: 'failed', error: errorText(err) };
      }
    }

    const next: number[] = [];
    for (const [output, r] of found) {
      const list = data.recipesByOutput.get(output) ?? [];
      list.push(r);
      data.recipesByOutput.set(output, list);
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
  }

  if (currencyIds.size > 0) data.currencies = byId(await client.all('/v2/currencies'));
  if (upgradeIds.size > 0) data.guildUpgrades = await client.many('/v2/guild/upgrades', upgradeIds);
  return data;
}

function buildNode(
  data: TreeData,
  kind: IngredientKind,
  id: number,
  count: number,
  depth: number,
  path: ReadonlySet<number>,
  have: Map<number, number>,
  maxDepth: number,
  budget: { nodes: number },
): RecipeTreeNode {
  budget.nodes++;
  if (kind !== 'Item') {
    const name = (kind === 'Currency' ? data.currencies : data.guildUpgrades).get(id)?.name ?? `#${id}`;
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

  const item = data.items.get(id);
  const stock = have.get(id) ?? 0;
  const owned = Math.min(stock, count);
  if (owned > 0) have.set(id, stock - owned);
  const need = count - owned;

  const sell = data.prices.get(id)?.sells.unit_price ?? 0;
  const unitPrice = sell > 0 ? sell : undefined;
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
  if (unitPrice !== undefined) {
    node.unitPrice = unitPrice;
    node.buyPrice = unitPrice * need;
  }
  if (need === 0) {
    node.best = 'owned';
    node.cost = 0;
    node.complete = true;
    return node;
  }

  const recipes = data.recipesByOutput.get(id) ?? [];
  if (path.has(id)) node.stop = 'cycle';
  else if (budget.nodes > MAX_NODES || (!data.searched.has(id) && depth < maxDepth)) node.stop = 'size-limit';
  else if (depth >= maxDepth) node.stop = 'depth-limit';

  if (!node.stop && recipes.length > 0) {
    const childPath = new Set(path).add(id);
    let picked: { recipe: SourceRecipe; children: RecipeTreeNode[]; cost: number; complete: boolean; have: Map<number, number> } | undefined;
    for (const recipe of recipes) {
      const crafts = craftsFor(need, recipe.output_count);
      const trial = new Map(have);
      const children = recipe.ingredients.map((ing) =>
        buildNode(data, ing.type, ing.id, ing.count * crafts, depth + 1, childPath, trial, maxDepth, budget),
      );
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

      const craftWins =
        node.buyPrice === undefined || (picked.complete && picked.cost < node.buyPrice);
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
  const vendor = data.vendors.get(id);
  if (vendor && !node.stop) {
    const purchases = craftsFor(need, vendor.offer.quantity);
    const childPath = new Set(path).add(id);
    node.children = vendor.offer.costs.map((c) =>
      buildNode(data, c.kind, c.id, c.amount * purchases, depth + 1, childPath, have, maxDepth, budget),
    );
    node.vendor = { ...vendor, purchases };
    node.best = 'vendor';
    node.cost = node.children.reduce((sum, c) => sum + (c.cost ?? 0), 0);
    node.complete = node.children.every((c) => c.complete);
  } else if (data.vendorUnmatched.has(id)) {
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

export interface RenderTreeOptions {
  /** Heading for the output. */
  title?: string;
  /** Expand subtrees of nodes that are cheaper to buy. Default false. */
  expandAll?: boolean;
  /** Max tree lines before truncating. Default 150. */
  maxLines?: number;
  /** Include the "craft everything" raw material table. Default true. */
  raw?: boolean;
  /**
   * Wallet balances (currency id → amount, Coin in copper). Adds "In wallet"
   * and "Still needed" columns to the currency table.
   */
  wallet?: ReadonlyMap<number, number>;
}

interface RenderContext {
  forge: boolean;
  vendors: boolean;
  wallet?: ReadonlyMap<number, number>;
}

/** Markdown: summary, indented tree, shopping table, currencies, unpriced leaves. */
export function renderRecipeTree(tree: RecipeTreeNode, options: RenderTreeOptions = {}): string {
  const maxLines = options.maxLines ?? 150;
  const ctx: RenderContext = {
    forge: tree.mysticForge?.status === 'ok',
    vendors: tree.vendors !== undefined && tree.vendors.status !== 'failed',
    ...(options.wallet ? { wallet: options.wallet } : {}),
  };
  const out: string[] = [];
  const total = tree.count + tree.owned;
  out.push(`# ${options.title ?? `Recipe tree: ${num(total)} × ${tree.name} (${tree.itemId})`}`, '');
  out.push(summaryLine(tree, ctx), '');
  out.push(
    ['Prices are current trading post lowest sell listings (instant buy). Craft costs exclude leftover output and assume you know the recipes.', forgeNote(tree), vendorNote(tree)]
      .filter(Boolean)
      .join(' '),
    '',
  );

  const lines: string[] = [];
  let omitted = 0;
  const walk = (n: RecipeTreeNode, depth: number): void => {
    if (lines.length >= maxLines) {
      omitted++;
    } else {
      lines.push(`${'  '.repeat(depth)}- ${nodeLine(n, ctx)}`);
    }
    if (n.best === 'craft' || n.best === 'vendor' || (options.expandAll && n.children.length > 0 && n.best !== 'owned')) {
      for (const c of n.children) walk(c, depth + 1);
    }
  };
  walk(tree, 0);
  out.push('## Tree', '', ...lines);
  if (omitted) out.push('', `_${num(omitted)} more nodes not shown. Query a sub-component's item id for its own tree._`);

  const leaves = flattenLeaves(tree, 'best');
  out.push('', ...leafTables(leaves, 'Materials to buy (cheapest route)', ctx));

  const used = stockUsed(tree);
  if (used.length) {
    out.push('', '## Taken from your holdings', '', table(['Item', 'Item id', 'Count'], used.map((u) => [u.name, u.itemId, num(u.count)])));
  }

  if (options.raw ?? true) {
    const raw = flattenLeaves(tree, 'raw');
    if (!sameLeaves(raw, leaves)) out.push('', ...leafTables(raw, 'Raw materials if you craft every component', ctx));
  }
  return out.join('\n') + '\n';
}

function forgeNote(tree: RecipeTreeNode): string {
  switch (tree.mysticForge?.status) {
    case 'ok':
      return 'Mystic Forge recipes come from the GW2 wiki (the API has none). Chance-based forges such as Mystic Clovers use the wiki\'s average yield, so their counts are expected values, not guarantees.';
    case 'failed':
      return `Looking up Mystic Forge recipes on the wiki failed (${tree.mysticForge.error ?? 'unknown error'}), so forge-made items such as legendary gifts appear as unpriced leaves; check the wiki for them.`;
    default:
      return 'Mystic Forge recipes (most legendary gifts) are not in the API, so those items appear as unpriced leaves; check the wiki for them.';
  }
}

function vendorNote(tree: RecipeTreeNode): string {
  switch (tree.vendors?.status) {
    case 'ok':
      return 'Items with no recipe and no trading post listing are bought from NPC vendors (offers from the wiki) and costed in the currencies those vendors take: a coin-only offer if there is one, else the price most vendors charge, except Obsidian Shards, which assume the karma exchange; other offers are listed on the node.';
    case 'partial':
      return `Vendor offers come from the wiki; some lookups failed (${tree.vendors.error ?? 'unknown error'}), so a few vendor items may show as unpriced.`;
    case 'failed':
      return `Looking up vendor offers on the wiki failed (${tree.vendors.error ?? 'unknown error'}), so vendor items appear as unpriced leaves.`;
    default:
      return '';
  }
}

/** Why an item has no route, given which sources were checked. */
function noRoute(ctx: RenderContext): string {
  if (ctx.forge && ctx.vendors) return 'no crafting or Mystic Forge recipe, no vendor offer and not on the TP: a reward or drop';
  if (ctx.forge) return 'no crafting or Mystic Forge recipe and not on the TP: a vendor, reward or drop';
  return 'no API recipe and not on the TP: Mystic Forge, vendor or drop';
}

function noRecipe(ctx: RenderContext): string {
  return ctx.forge
    ? 'It has no crafting or Mystic Forge recipe: it comes from vendors, rewards or drops, so check its wiki page.'
    : 'There is no crafting-station recipe for it in the API: legendaries, gifts and many trophies are made in the Mystic Forge or bought from vendors, so check its wiki page.';
}

function costText(c: TreeVendorOffer['costs'][number], times = 1): string {
  return c.kind === 'Currency' && c.id === COIN_CURRENCY ? coins(c.amount * times) : `${num(c.amount * times)} ${c.name}`;
}

function offerText(o: TreeVendorOffer): string {
  const more = o.vendors.length > 1 ? ` (${o.vendors.length} vendors)` : '';
  return `${num(o.quantity)} for ${o.costs.map((c) => costText(c)).join(' + ')}${more}`;
}

function capText(caps: VendorCaps, purchases: number): string {
  const limits: [number | undefined, string][] = [
    [caps.daily, 'day'],
    [caps.weekly, 'week'],
    [caps.season, 'season'],
    [caps.character, 'character'],
    [caps.total, 'account, ever'],
  ];
  return limits
    .filter((l): l is [number, string] => l[0] !== undefined)
    .map(([n, per]) => `limit ${num(n)} per ${per}${purchases > n && per !== 'account, ever' ? ` (≈${num(Math.ceil(purchases / n))} ${per}s for ${num(purchases)})` : ''}`)
    .join(', ');
}

function vendorText(v: TreeVendor): string {
  const o = v.offer;
  const who = o.vendors.slice(0, 3).join(', ') + (o.vendors.length > 3 ? ` +${o.vendors.length - 3} more` : '');
  const caps = capText(o.caps, v.purchases);
  const alt = v.alternatives.length ? `; other offers: ${v.alternatives.map(offerText).join('; ')}` : '';
  return `${num(v.purchases)} × (${num(o.quantity)} for ${o.costs.map((c) => costText(c)).join(' + ')}) from ${who}${caps ? `, ${caps}` : ''}${alt}; ${v.url}`;
}

function summaryLine(tree: RecipeTreeNode, ctx: RenderContext): string {
  const partial = tree.complete ? '' : ' + unpriced items listed below';
  const buy = tree.buyPrice !== undefined ? `buy outright: ${coins(tree.buyPrice)}` : 'not buyable on the trading post';
  switch (tree.best) {
    case 'owned':
      return `**You already hold ${num(tree.owned)}; nothing to buy.**`;
    case 'craft':
      return `**Cheapest route: craft for ${coins(tree.cost ?? 0)}${partial}** (${buy}).`;
    case 'vendor':
      return `**Bought from a vendor:** ${tree.vendor ? tree.vendor.offer.costs.map((c) => costText(c, tree.vendor!.purchases)).join(' + ') : '—'} (not on the trading post).`;
    case 'buy':
      return `**Cheapest route: buy for ${coins(tree.cost ?? 0)}**${
        tree.craftCost !== undefined
          ? ` (craft: ${coins(tree.craftCost)}${tree.craftComplete ? '' : ' + unpriced items'}).`
          : `. ${noRecipe(ctx)}`
      }`;
    case 'unavailable':
      return `**No priced route:** it is not on the trading post. ${noRecipe(ctx)}`;
  }
}

function nodeLine(n: RecipeTreeNode, ctx: RenderContext): string {
  if (n.kind === 'Currency' && n.itemId === COIN_CURRENCY) return `${coins(n.count)} in coin`;
  const parts: string[] = [];
  const owned = n.owned && n.count ? ` (+${num(n.owned)} from holdings)` : '';
  const shown = n.count || n.owned;
  const head = `${num(shown)} × ${n.name} \`${n.itemId}\`${n.kind === 'Item' ? '' : ` (${n.kind})`}${owned}`;
  switch (n.best) {
    case 'owned':
      parts.push('**from holdings**');
      break;
    case 'craft':
      parts.push(`**craft** ${coins(n.cost ?? 0)}${n.complete ? '' : ' + unpriced'}`);
      if (n.buyPrice !== undefined) parts.push(`buy ${coins(n.buyPrice)}`);
      break;
    case 'vendor':
      parts.push(`**vendor**${n.complete ? ` ${coins(n.cost ?? 0)}` : ''}`);
      if (n.vendor) parts.push(vendorText(n.vendor));
      break;
    case 'buy':
      parts.push(`**buy** ${coins(n.cost ?? 0)}${n.count > 1 && n.unitPrice ? ` (${coins(n.unitPrice)} ea)` : ''}`);
      if (n.craftCost !== undefined) parts.push(`craft ${coins(n.craftCost)}${n.craftComplete ? '' : ' + unpriced'}`);
      break;
    case 'unavailable':
      if (n.kind === 'Currency') parts.push('**wallet currency**');
      else if (n.kind !== 'Item') parts.push('**unpriced**');
      else if (n.vendorUnmatched) parts.push(`**unpriced**: sold by vendors for a currency this tool couldn't match (${pageUrl(n.name)})`);
      else parts.push(`**unpriced**: ${noRoute(ctx)}? ${pageUrl(n.name)}`);
      break;
  }
  if (n.recipe) {
    const r = n.recipe;
    const alt = n.alternatives ? `, ${n.alternatives} other recipe${n.alternatives > 1 ? 's' : ''}` : '';
    if (r.source === 'mystic-forge') {
      const makes = Number.isInteger(r.output_count)
        ? r.output_count > 1 ? `, makes ${r.output_count} per forge` : ''
        : `, ~${r.output_count} per forge on average`;
      parts.push(`Mystic Forge (×${num(r.crafts)}${makes}${alt}; ${r.wiki?.url ?? pageUrl(n.name)})`);
    } else {
      const makes = r.output_count > 1 ? `, makes ${r.output_count} per craft` : '';
      parts.push(`recipe ${r.id} (${r.disciplines.join('/')} ${r.min_rating}, ×${num(r.crafts)}${makes}${alt})`);
    }
  }
  if (n.stop) parts.push(`not expanded: ${n.stop}`);
  return `${head} — ${parts.join(' · ')}`;
}

function leafTables(leaves: TreeLeaf[], heading: string, ctx: RenderContext): string[] {
  const isCoin = (l: TreeLeaf) => l.kind === 'Currency' && l.itemId === COIN_CURRENCY;
  const priced = leaves.filter((l) => !l.unpriced && !isCoin(l));
  const coin = leaves.filter(isCoin).reduce((s, l) => s + l.count, 0);
  const currencies = leaves.filter((l) => l.kind === 'Currency' && !isCoin(l));
  const unpriced = leaves.filter((l) => l.unpriced && l.kind !== 'Currency');
  const total = priced.reduce((s, l) => s + (l.cost ?? 0), 0) + coin;
  const out = [`## ${heading}`, ''];
  out.push(
    table(
      ['Item', 'Item id', 'Count', 'Unit price', 'Cost'],
      priced.map((l) => [l.name, l.itemId, num(l.count), coins(l.unitPrice ?? 0), coins(l.cost ?? 0)]),
    ),
  );
  const extra = [
    currencies.length ? `${currencies.length} wallet currenc${currencies.length === 1 ? 'y' : 'ies'}` : '',
    unpriced.length ? `${unpriced.length} unpriced item(s)` : '',
  ].filter(Boolean);
  out.push(
    '',
    `**Total: ${coins(total)}**${coin ? ` (includes ${coins(coin)} paid to vendors)` : ''}${extra.length ? ` plus ${extra.join(' and ')}:` : ''}`,
  );
  if (currencies.length) {
    const wallet = ctx.wallet;
    out.push(
      '',
      wallet
        ? table(
            ['Currency', 'Currency id', 'Amount', 'In wallet', 'Still needed'],
            currencies.map((l) => {
              const have = wallet.get(l.itemId) ?? 0;
              return [l.name, l.itemId, num(l.count), num(have), num(Math.max(0, l.count - have))];
            }),
          )
        : table(['Currency', 'Currency id', 'Amount'], currencies.map((l) => [l.name, l.itemId, num(l.count)])),
    );
  }
  if (unpriced.length) {
    out.push(
      '',
      ...unpriced.map((l) =>
        l.kind === 'Item'
          ? `- ${num(l.count)} × ${l.name} (item ${l.itemId}): ${l.vendorUnmatched ? "sold by vendors for a currency this tool couldn't match" : noRoute(ctx)}; see ${pageUrl(l.name)}`
          : `- ${num(l.count)} × ${l.name} (${l.kind} ${l.itemId})`,
      ),
    );
  }
  return out;
}

function sameLeaves(a: TreeLeaf[], b: TreeLeaf[]): boolean {
  if (a.length !== b.length) return false;
  const key = (l: TreeLeaf) => `${l.kind}:${l.itemId}:${l.count}`;
  const set = new Set(a.map(key));
  return b.every((l) => set.has(key(l)));
}
