# @gw2kit/wiki

A client for the [official Guild Wars 2 wiki](https://wiki.guildwars2.com) that turns its structured (Semantic MediaWiki) data into typed records: Mystic Forge recipes, NPC vendor offers, and item pages by game id. The official API has none of these. It also does search, plain-text page reads and raw `ask` queries. Works in Node 22+ and browsers.

```sh
npm install @gw2kit/wiki
```

```ts
import { WikiClient } from '@gw2kit/wiki';

const wiki = new WikiClient();

// Mystic Forge recipes that make Gift of Mastery and Mystic Clover.
const forge = await wiki.mysticForgeRecipes([19674, 19675]);
// [{ output_item_id: 19674, output_item_count: 1, base: true,
//    ingredients: [{ item_id: 20797, name: 'Bloodstone Shard', count: 1 }, ...] }, ...]

// What uses Glob of Ectoplasm in the forge.
const using = await wiki.mysticForgeRecipesUsing(19721);

// NPC vendors for an item, by its wiki page title.
const pages = await wiki.itemPages([20796]);                 // Map { 20796 => "Philosopher's Stone" }
const offers = await wiki.vendorOffers("Philosopher's Stone");
// [{ vendor: 'Miyani', quantity: 10, costs: [{ name: 'Spirit Shard', amount: 1 }], caps: {}, historical: false }, ...]

const hits = await wiki.search('Twilight');
const page = await wiki.page('Twilight', { intro: true });
const rows = await wiki.ask('[[Has game id::19721]]|?Has context');
```

## Things to know about the data

- **Chance-based forges.** `base` is the wiki's "Can be queried for base ingredients" flag. Random-output recipes (Mystic Clover) are `false` and have a separate `base` twin whose `output_item_count` is the measured average (0.31). Use `base` recipes for material totals.
- **Vendor costs are names, not ids.** A cost is `{ name, amount }` as the wiki writes it: wallet currencies (`Spirit Shard`, `Karma`, `Coin` in copper), sometimes plural (`Trade Contracts`), or items (`Glob of Ectoplasm`). [`@gw2kit/recipes`](https://www.npmjs.com/package/@gw2kit/recipes) matches them to `/v2/currencies` ids and item ids.
- **Query limits.** The wiki rejects `ask` queries with more than about 12 OR'd values, so id lookups go in batches of 10. Vendor queries are slow (often 1-10 s) and time out when batched, so `vendorOffers` takes one item.
- **Politeness.** Requests are rate limited (20 burst, 120 per minute by default), cached, and retried on 429/5xx. Outside browsers a descriptive `User-Agent` is sent, since the wiki rejects Node's default one.

The parsers depend on wiki template property names (`Has output game id`, `Sells item`, `Has item cost`...), which wiki editors can change. Versions stay `0.x` while that holds.

MIT licensed. Not affiliated with ArenaNet.
