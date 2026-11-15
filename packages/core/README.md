# @gw2-ai/core

Markdown output for AI assistants, built on [`@gw2-ai/client`](https://www.npmjs.com/package/@gw2-ai/client): the Guild Wars 2 account report (overview, wallet, characters, Wizard's Vault, daily and weekly lockouts, items, materials, trading post, achievements, legendary armory, collections), recipe trees with craft-vs-buy costing, and markdown formatting helpers that escape player-controlled names.

```ts
import { Gw2Client } from '@gw2-ai/client';
import { buildReport } from '@gw2-ai/core';

const report = await buildReport(new Gw2Client({ apiKey }), { sections: ['wallet', 'wizards-vault'] });
console.log(report.markdown);
```

Sections the key has no permission for are skipped with a note instead of failing the report. Used by the [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai) MCP servers and report site.

MIT licensed. Not affiliated with ArenaNet.
