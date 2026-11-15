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

Sections the key has no permission for are skipped with a note instead of failing the report. Used by the [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai) MCP servers and report site.

MIT licensed. Not affiliated with ArenaNet.
