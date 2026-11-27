# @gw2-ai/core

Markdown output for AI assistants, built on the [`@gw2kit`](https://www.npmjs.com/org/gw2kit) libraries: the Guild Wars 2 account report (overview, wallet, characters, Wizard's Vault, daily and weekly lockouts, items, materials, trading post, achievements, legendary armory, collections), character pages, recipe-tree rendering (`renderRecipeTree` for trees from `@gw2kit/recipes`), and markdown formatting helpers that escape player-controlled names. `DEFAULT_VENDOR_CURRENCY` holds the vendor currencies the gw2-ai tools assume (Obsidian Shard → Karma).

```ts
import { Gw2Client } from '@gw2kit/client';
import { buildReport } from '@gw2-ai/core';

const report = await buildReport(new Gw2Client({ apiKey }), { sections: ['wallet', 'wizards-vault'] });

// One character's build and equipment templates, crafting and bags, with no account sections:
const setup = await buildReport(new Gw2Client({ apiKey }), { sections: [], characters: ['Example Name'] });
console.log(report.markdown);
```

Crafting plans (`CraftingPlan` from `@gw2kit/recipes`):

- `renderPlan(plan, { sections, component, goals, sales })`: markdown with, for several goals, what each adds in priority order (the `goals` section; `goals: k` shows the plan for the first k only), open decisions, time gates, what to earn, buy and make, and what is covered. It ends with the JSON update block a model without tools can reply with. Wiki excerpts are quoted and escaped. A plan with several goals groups its crafts by the goal that needs them.
- `researchPlan(plan, wiki, { only })`: adds the wiki intro and Acquisition text (without vendor tables) to steps with no known source, and to untradeable vendor items the wiki lists drops or containers for. Vendor requirements are kept with the vendor they belong to and printed only for the vendors a step names; research saved before this holds none that can be attributed, so rebuild the plan to see them.
- `readHoldings(client, permissions)`: bank, shared slots, character bags, material storage, wallet and (with `tradingpost`) the delivery box and open trading post orders with their current prices, for `withHoldings`.
- `@gw2-ai/core/plans` (Node only): `listPlans`, `loadPlan` and `savePlan` keep plans as JSON files in `$XDG_DATA_HOME/gw2-ai/plans/` (default `~/.local/share/gw2-ai/plans/`).

Raising gold, with or without a plan:

```ts
import { planSales, readSellables, renderPlan, renderSales, salesForPlan } from '@gw2-ai/core';

const { items, delivery, notes } = await readSellables(client, permissions);
renderSales(planSales(items, { target: 2_000_000 }), { delivery, notes }); // 200g, in copper

const sales = salesForPlan(plan, items);                                   // plan: holdings freshly read
renderPlan(plan, { sections: [], sales: { plan: sales, delivery, notes } });

// Craft (or promote) materials first where that raises more.
const { notes: unchecked, ...conversions } = await readConversions(client, permissions, items, { craft: true, promote: false });
renderSales(planSales(items, { conversions }), { delivery, notes: [...notes, ...unchecked] });
salesForPlan(plan, items, { conversions });
```

- `readSellables(client, permissions)`: unbound items in material storage, the bank, shared slots and character bags, with prices and buy-order depth, plus coins in the delivery box (`tradingpost`). `notes` says what could not be read.
- `planSales(items, options)`: pure. Options: `target` (copper; all of it when absent), `method` (`instant` or `list`), `order` (`least-loss` or `fewest`), `reserve`, `keep`, `everything`, `minLine`, `conversions`, `paths`, `upfront`, `spend`, `pathShare`, `pathDays`, `currencyReserve`.
- `readConversions(client, permissions, items, { craft, promote })`: recipes and prices for turning `items` into something else first. `craft` (default true) covers crafting and refining, using `characters` for ratings and `unlocks` for learned recipes; it takes about 20 seconds. `promote` (default false) adds Mystic Forge material promotions and uses `wallet` for Spirit Shards. `planConversions` is the pure part.
- `promotionRecipes()` and `PROMOTIONS_AS_OF`: the bundled promotion snapshot, refreshed with `node scripts/sync-promotions.mjs` in the repository after `pnpm build`.
- `salesForPlan(plan, items, options)`: holds back what the plan uses (`planReserve`) and aims at its shortfall (`planShortfall`, unknown until the wallet has been read).
- `readSalesPaths(client, permissions)`: what spending currencies could raise (needs `wallet`; `inventories` for Curious Mursaat Remnants, `characters` and `unlocks` for ratings and recipes). Pass its `data` as `paths`: lines needing only currencies count unless `spend: false`, those needing gold first with `upfront: true`. `planSalesPaths` is the pure part. `salesForPlan` holds back the currencies the plan needs.
- `CURRENCY_PATHS`, `CURRENCY_LEFT_OUT` and `CURRENCY_PATHS_AS_OF`: the bundled snapshot of what each path takes, containers' average contents (openings recorded on the wiki) and daily trade volumes, refreshed with `node scripts/sync-currency-paths.mjs` after `pnpm build`.

Limits: only one conversion step for spare materials; no salvaging; currency paths cover only Imperial Favor, Rift Essences, Curious Mursaat Remnants and Volatile Magic, with drop rates and volumes from a snapshot and container contents as averages; recipes needing discovery or an unlock are skipped unless `unlocks` shows them; promotion yields are random averages, and some promotions (such as Pile of Crystalline Dust) are missing from the snapshot; listed sales are not guaranteed; bound items, equipped gear and guild storage are never considered, and Legendary and Ascended items are never suggested.

Sections the key has no permission for are skipped with a note instead of failing the report. Used by the [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai) MCP servers and report site.

MIT licensed. Not affiliated with ArenaNet.
