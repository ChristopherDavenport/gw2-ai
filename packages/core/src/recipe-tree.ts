import { catalog } from './catalog.js';
import { mapLimit, type Gw2Client } from './client.js';
import { coins, num, table } from './format.js';
import type { Item, Price, Recipe, RecipeIngredient } from './types.js';
import { pageUrl } from './wiki.js';

export type IngredientKind = RecipeIngredient['type'];

/**
 * How to get a node: buy it on the trading post, craft it from its children,
 * take it from the account's stock (`owned`), or no priced route exists
 * (Mystic Forge recipes, vendor/karma items, currencies, guild upgrades).
 */
export type TreeChoice = 'buy' | 'craft' | 'owned' | 'unavailable';

export interface TreeRecipe {
  id: number;
  disciplines: string[];
  min_rating: number;
  output_count: number;
  /** Times the recipe has to be crafted: ceil(count / output_count). */
  crafts: number;
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
}

interface TreeData {
  items: Map<number, Item>;
  prices: Map<number, Price>;
  recipesByOutput: Map<number, Recipe[]>;
  /** Item ids whose recipes were searched. */
  searched: Set<number>;
  currencies: Map<number, { name: string }>;
  guildUpgrades: Map<number, { name: string }>;
}

const COIN_CURRENCY = 1;
const MAX_NODES = 20_000;

/**
 * Crafting tree for `quantity` of `itemId`, priced at the trading post, with
 * a buy-or-craft choice per node. Lookups are batched per tree level: one
 * /v2/items, /v2/commerce/prices and /v2/recipes call per 200 ids, plus one
 * /v2/recipes/search per distinct item (the API has no bulk search).
 *
 * Mystic Forge recipes are not in the API, so items such as legendary gifts
 * come back as leaves with no recipe and (if account bound) no price.
 */
export async function buildRecipeTree(
  client: Gw2Client,
  itemId: number,
  quantity = 1,
  options: RecipeTreeOptions = {},
): Promise<RecipeTreeNode> {
  const maxDepth = options.maxDepth ?? 10;
  const data = await fetchTreeData(client, itemId, maxDepth, options.maxItems ?? 600);
  const have = new Map(options.have ?? []);
  const budget = { nodes: 0 };
  return buildNode(data, 'Item', itemId, Math.max(1, Math.floor(quantity)), 0, new Set(), have, maxDepth, budget);
}

async function fetchTreeData(client: Gw2Client, rootId: number, maxDepth: number, maxItems: number): Promise<TreeData> {
  const data: TreeData = {
    items: new Map(),
    prices: new Map(),
    recipesByOutput: new Map(),
    searched: new Set(),
    currencies: new Map(),
    guildUpgrades: new Map(),
  };
  const seen = new Set<number>([rootId]);
  const currencyIds = new Set<number>();
  const upgradeIds = new Set<number>();
  let frontier = [rootId];

  for (let depth = 0; frontier.length > 0 && depth <= maxDepth; depth++) {
    const search = depth < maxDepth;
    const [defs, prices, recipeIdLists] = await Promise.all([
      catalog.items(client, frontier),
      catalog.prices(client, frontier),
      search ? mapLimit(frontier, 8, (id) => catalog.recipesFor(client, id)) : Promise.resolve([]),
    ]);
    for (const [id, item] of defs) data.items.set(id, item);
    for (const [id, price] of prices) data.prices.set(id, price);
    if (search) for (const id of frontier) data.searched.add(id);

    const recipes = await catalog.recipes(client, recipeIdLists.flat());
    const next: number[] = [];
    for (const r of recipes.values()) {
      const list = data.recipesByOutput.get(r.output_item_id) ?? [];
      list.push(r);
      data.recipesByOutput.set(r.output_item_id, list);
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

  if (currencyIds.size > 0) data.currencies = await catalog.currencies(client);
  if (upgradeIds.size > 0) {
    data.guildUpgrades = await client.getMany<{ id: number; name: string }>('/v2/guild/upgrades', upgradeIds, {
      auth: false,
    });
  }
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
    let picked: { recipe: Recipe; children: RecipeTreeNode[]; cost: number; complete: boolean; have: Map<number, number> } | undefined;
    for (const recipe of recipes) {
      const crafts = Math.ceil(need / Math.max(1, recipe.output_item_count));
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
        id: r.id,
        disciplines: r.disciplines,
        min_rating: r.min_rating,
        output_count: r.output_item_count,
        crafts: Math.ceil(need / Math.max(1, r.output_item_count)),
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
  }
  return node;
}

function better(
  a: { recipe: Recipe; cost: number; complete: boolean },
  b: { recipe: Recipe; cost: number; complete: boolean },
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
    const expand = n.children.length > 0 && (mode === 'raw' || n.best === 'craft');
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
    if (n.best === 'craft') for (const c of n.children) visit(c);
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
}

/** Markdown: summary, indented tree, shopping table, unpriced leaves. */
export function renderRecipeTree(tree: RecipeTreeNode, options: RenderTreeOptions = {}): string {
  const maxLines = options.maxLines ?? 150;
  const out: string[] = [];
  const total = tree.count + tree.owned;
  out.push(`# ${options.title ?? `Recipe tree: ${num(total)} × ${tree.name} (${tree.itemId})`}`, '');
  out.push(summaryLine(tree), '');
  out.push(
    'Prices are current trading post lowest sell listings (instant buy). Craft costs exclude leftover output and assume you know the recipes. ' +
      'Mystic Forge recipes (most legendary gifts) are not in the API, so those items appear as unpriced leaves; check the wiki for them.',
    '',
  );

  const lines: string[] = [];
  let omitted = 0;
  const walk = (n: RecipeTreeNode, depth: number): void => {
    if (lines.length >= maxLines) {
      omitted++;
    } else {
      lines.push(`${'  '.repeat(depth)}- ${nodeLine(n)}`);
    }
    if (n.best === 'craft' || (options.expandAll && n.children.length > 0 && n.best !== 'owned')) {
      for (const c of n.children) walk(c, depth + 1);
    }
  };
  walk(tree, 0);
  out.push('## Tree', '', ...lines);
  if (omitted) out.push('', `_${num(omitted)} more nodes not shown. Query a sub-component's item id for its own tree._`);

  const leaves = flattenLeaves(tree, 'best');
  out.push('', ...leafTables(leaves, 'Materials to buy (cheapest route)'));

  const used = stockUsed(tree);
  if (used.length) {
    out.push('', '## Taken from your holdings', '', table(['Item', 'Item id', 'Count'], used.map((u) => [u.name, u.itemId, num(u.count)])));
  }

  if (options.raw ?? true) {
    const raw = flattenLeaves(tree, 'raw');
    if (!sameLeaves(raw, leaves)) out.push('', ...leafTables(raw, 'Raw materials if you craft every component'));
  }
  return out.join('\n') + '\n';
}

const NO_RECIPE =
  'There is no crafting-station recipe for it in the API: legendaries, gifts and many trophies are made in the Mystic Forge or bought from vendors, so check its wiki page.';

function summaryLine(tree: RecipeTreeNode): string {
  const partial = tree.complete ? '' : ' + unpriced items listed below';
  const buy = tree.buyPrice !== undefined ? `buy outright: ${coins(tree.buyPrice)}` : 'not buyable on the trading post';
  switch (tree.best) {
    case 'owned':
      return `**You already hold ${num(tree.owned)}; nothing to buy.**`;
    case 'craft':
      return `**Cheapest route: craft for ${coins(tree.cost ?? 0)}${partial}** (${buy}).`;
    case 'buy':
      return `**Cheapest route: buy for ${coins(tree.cost ?? 0)}**${
        tree.craftCost !== undefined
          ? ` (craft: ${coins(tree.craftCost)}${tree.craftComplete ? '' : ' + unpriced items'}).`
          : `. ${NO_RECIPE}`
      }`;
    case 'unavailable':
      return `**No priced route:** it is not on the trading post. ${NO_RECIPE}`;
  }
}

function nodeLine(n: RecipeTreeNode): string {
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
    case 'buy':
      parts.push(`**buy** ${coins(n.cost ?? 0)}${n.count > 1 && n.unitPrice ? ` (${coins(n.unitPrice)} ea)` : ''}`);
      if (n.craftCost !== undefined) parts.push(`craft ${coins(n.craftCost)}${n.craftComplete ? '' : ' + unpriced'}`);
      break;
    case 'unavailable':
      parts.push(
        n.kind === 'Item'
          ? `**unpriced**: no API recipe, not on TP (Mystic Forge, vendor or drop? ${pageUrl(n.name)})`
          : '**unpriced**',
      );
      break;
  }
  if (n.recipe) {
    const r = n.recipe;
    const makes = r.output_count > 1 ? `, makes ${r.output_count} per craft` : '';
    const alt = n.alternatives ? `, ${n.alternatives} other recipe${n.alternatives > 1 ? 's' : ''}` : '';
    parts.push(`recipe ${r.id} (${r.disciplines.join('/')} ${r.min_rating}, ×${num(r.crafts)}${makes}${alt})`);
  }
  if (n.stop) parts.push(`not expanded: ${n.stop}`);
  return `${head} — ${parts.join(' · ')}`;
}

function leafTables(leaves: TreeLeaf[], heading: string): string[] {
  const priced = leaves.filter((l) => !l.unpriced);
  const unpriced = leaves.filter((l) => l.unpriced);
  const total = priced.reduce((s, l) => s + (l.cost ?? 0), 0);
  const out = [`## ${heading}`, ''];
  out.push(
    table(
      ['Item', 'Item id', 'Count', 'Unit price', 'Cost'],
      priced.map((l) => [l.name, l.itemId, num(l.count), coins(l.unitPrice ?? 0), coins(l.cost ?? 0)]),
    ),
  );
  out.push('', `**Total: ${coins(total)}**${unpriced.length ? ` plus ${unpriced.length} unpriced item(s):` : ''}`);
  if (unpriced.length) {
    out.push(
      '',
      ...unpriced.map((l) =>
        l.kind === 'Item'
          ? `- ${num(l.count)} × ${l.name} (item ${l.itemId}): no API recipe and not on the TP; see ${pageUrl(l.name)}`
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
