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

- `renderPlan(plan, { sections, component, sales })`: markdown with open decisions, time gates, what to earn, buy and make, and what is covered. It ends with the JSON update block a model without tools can reply with. Wiki excerpts are quoted and escaped. A plan with several goals groups its crafts by the goal that needs them.
- `researchPlan(plan, wiki, { only })`: adds the wiki intro and Acquisition text (without vendor tables) to steps with no known source, and to untradeable vendor items the wiki lists drops or containers for.
- `readHoldings(client, permissions)`: bank, shared slots, character bags, material storage and wallet, for `withHoldings`.
- `@gw2-ai/core/plans` (Node only): `listPlans`, `loadPlan` and `savePlan` keep plans as JSON files in `$XDG_DATA_HOME/gw2-ai/plans/` (default `~/.local/share/gw2-ai/plans/`).

Raising gold, with or without a plan:

```ts
import { planSales, readSellables, renderPlan, renderSales, salesForPlan } from '@gw2-ai/core';

const { items, delivery, notes } = await readSellables(client, permissions);
renderSales(planSales(items, { target: 2_000_000 }), { delivery, notes }); // 200g, in copper

const sales = salesForPlan(plan, items);                                   // plan: holdings freshly read
renderPlan(plan, { sections: [], sales: { plan: sales, delivery, notes } });
```

- `readSellables(client, permissions)`: unbound items in material storage, the bank, shared slots and character bags, with prices and buy-order depth, plus coins in the delivery box (`tradingpost`). `notes` says what could not be read.
- `planSales(items, options)`: pure. Options: `target` (copper; all of it when absent), `method` (`instant` or `list`), `order` (`least-loss` or `fewest`), `reserve`, `keep`, `everything`, `minLine`.
- `salesForPlan(plan, items, options)`: holds back what the plan uses (`planReserve`) and aims at its shortfall (`planShortfall`, unknown until the wallet has been read).
- Trading post fee arithmetic: `sellProceeds`, `listingFee`, `exchangeFee`, `flipProfit`, `breakEvenPrice`.

Limits: sales are one step only (no refining, salvaging or converting currencies into gold first); listed sales are not guaranteed; bound items, equipped gear and guild storage are never considered, and Legendary and Ascended items are never suggested.

Sections the key has no permission for are skipped with a note instead of failing the report. Used by the [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai) MCP servers and report site.

MIT licensed. Not affiliated with ArenaNet.
