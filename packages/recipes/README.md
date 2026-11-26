# @gw2kit/recipes

Recipe trees for Guild Wars 2: the cheapest way to get N of any item, combining crafting recipes from the API, Mystic Forge recipes from the wiki, and NPC vendor offers from the wiki, priced at the trading post. Account-bound parts end as wallet currencies with `/v2/currencies` ids, such as Spirit Shards, Karma and map currencies.

```sh
npm install @gw2kit/recipes @gw2kit/client @gw2kit/wiki
```

```ts
import { Gw2Client } from '@gw2kit/client';
import { WikiClient } from '@gw2kit/wiki';
import { buildRecipeTree, flattenLeaves } from '@gw2kit/recipes';

const tree = await buildRecipeTree(new Gw2Client(), 30704 /* Twilight */, 1, {
  wiki: new WikiClient(),
  vendorCurrency: new Map([[19925, 2]]), // buy Obsidian Shards with Karma
});

tree.best;                 // 'buy' | 'craft' | 'vendor' | 'owned' | 'unavailable'
tree.cost;                 // copper for the priced part
flattenLeaves(tree);       // what to buy: items with TP prices, plus { kind: 'Currency', itemId: 2, count: 1047900 }...
```

## Fetch once, solve many times

`buildRecipeTree` is `fetchRecipeData` followed by `solveRecipeTree`. The fetch does all the requests and returns `RecipeData`, plain JSON with names, sell prices, recipes by output, ranked vendor offers and lookup status. A legendary weapon's data is about 13 KiB. The solve is pure, so you can save the data and solve again offline, for other quantities or holdings:

```ts
import { fetchRecipeData, solveRecipeTree } from '@gw2kit/recipes';

const data = await fetchRecipeData(client, 30704, { wiki });
await fs.writeFile('twilight.json', JSON.stringify(data));

const three = solveRecipeTree(data, 3);
const mine = solveRecipeTree(data, 1, { have: new Map([[19675, 77]]) }); // already own 77 Mystic Clovers
```

Prices in `RecipeData` are a snapshot (`fetchedAt`); fetch again when you need current ones.

## Crafting plans

A `CraftingPlan` is the `RecipeData` plus what the player decided, finished, learned and owns: plain JSON with no I/O of its own. `solvePlan` turns it into steps, each consumer before what it consumes, with demand for a shared item summed before crafts are rounded up.

```ts
import { createPlan, parsePlan, solvePlan, updatePlan, withHoldings } from '@gw2kit/recipes';

let plan = await createPlan(client, 30704, 1, { wiki });
({ plan } = updatePlan(plan, { done: ['Gift of Mastery'] }));       // also choose, undone, notes, settings; returns `errors`
plan = withHoldings(plan, { items: { 19675: 77 }, wallet: {} });

const { steps, coin } = solvePlan(plan);
steps.filter((s) => s.undecided);                                   // recipe choices gold can't compare
parsePlan(JSON.stringify(plan));                                    // read one back; throws if it isn't a plan
```
`settings` takes four booleans (defaults in `DEFAULT_PLAN_SETTINGS`):

- `useOwnMaterials` (true): take owned items off what the plan calls for. Wallet balances always count.
- `dailyCrafts` (true): craft the five once-a-day items. Off, they are not scheduled, so a tradeable product such as Deldrimor Steel Ingot is bought instead.
- `forgePromotions` (false): use Mystic Forge material promotions where their gold cost beats buying. Spirit Shard stones count as no gold, and yields are wiki averages. Needs a plan built with `createPlan`, which fetches them.
- `deductOwnedValue` (true): state value net of owned materials. `solvePlan` always returns both `coin` and `fullCoin`.


`refreshPrices(client, plan)` reads trading post prices again without refetching the graph. [`@gw2-ai/core`](https://www.npmjs.com/package/@gw2-ai/core) renders a plan as markdown.

## How choices are made

- **Buy or craft:** each node takes the cheaper of the trading post's lowest sell listing and its cheapest complete recipe. A recipe with unpriced parts only wins when the item can't be bought.
- **Mystic Forge:** only recipes the wiki marks fit for material totals are used. Chance-based forges use the wiki's average yield, so 77 Mystic Clovers cost 249 forges.
- **Vendors:** an item with no recipe and no TP listing uses one of its current vendor offers, picked in this order:
  1. one paid in the currency `vendorCurrency` names for that item
  2. else a coin-only offer
  3. else the price the most vendors charge

  Other offers, purchase limits and the vendors' names are kept on the node. Items a vendor charges are looked up too: Funerary Incense costs an Obsidian Shard, which costs Karma.
- **Holdings:** `have` is used up before buying or crafting, intermediates first, so owning a Gift of Fortune removes its whole subtree.

Each node says why it stopped: `cycle`, `depth-limit` or `size-limit`. The root says whether the wiki lookups worked; if they failed, the tree uses API recipes only.

MIT licensed. Not affiliated with ArenaNet.
