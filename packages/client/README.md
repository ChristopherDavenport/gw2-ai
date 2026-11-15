# @gw2kit/client

A typed client for the [Guild Wars 2 API](https://wiki.guildwars2.com/wiki/API:Main). Every `/v2` route is in its route table, so the path, path parameters, query parameters and response type are checked at compile time. The API key is attached only to routes that need it. No runtime dependencies; works in Node 22+ and browsers. For wiki data (Mystic Forge recipes, vendor offers) see [`@gw2kit/wiki`](https://www.npmjs.com/package/@gw2kit/wiki); for recipe trees, [`@gw2kit/recipes`](https://www.npmjs.com/package/@gw2kit/recipes).

```sh
npm install @gw2kit/client
```

```ts
import { Gw2Client } from '@gw2kit/client';

const gw2 = new Gw2Client({ apiKey: process.env.GW2_API_KEY });

const account = await gw2.get('/v2/account');                // Account
const wallet = await gw2.get('/v2/account/wallet');          // AccountWalletCurrency[]
const core = await gw2.get('/v2/characters/:id/core', { path: { id: 'Example Name' } });
const rate = await gw2.get('/v2/commerce/exchange/coins', { query: { quantity: 1_000_000 } });

const items = await gw2.many('/v2/items', [19721, 19976]);   // Map<number, Item>
const ecto = await gw2.one('/v2/items', 19721);               // Item | undefined
const bosses = await gw2.all('/v2/worldbosses');              // WorldBoss[]

const item = items.get(19721);
if (item?.type === 'Weapon') item.details.damage_type;       // details narrowed by item type
```

These don't compile:

```ts
gw2.get('/v2/acount');                                         // unknown route
gw2.get('/v2/characters/:id/core');                            // missing path param
gw2.get('/v2/commerce/exchange/coins');                        // missing required query
gw2.many('/v2/items', ['19721']);                              // item ids are numbers
gw2.get('/v2/wvw/matches/stats/:id/teams/:team/top/kdr', { path: { id: '1-1', team: 'Red' } }); // team is 'red' | 'green' | 'blue'
```

## What it handles

- **Auth:** the key goes in the `access_token` query parameter, the only form browsers can use (an `Authorization` header fails the API's CORS preflight). Routes that work with or without a key (`/v2/guild/:id`) get it when one is configured. Error messages never contain the key.
- **Batching:** `many()` splits id lists into requests of 200, runs them in parallel, and drops unknown ids. `all()` uses `ids=all` where the route supports it.
- **Caching:** public data is cached per id (24 hours for definitions, 1 minute for prices). Authenticated responses are not cached unless you pass `ttlMs`. Plug in your own store with the `cache` option (`CacheStore`).
- **Rate limiting and retries:** a token bucket at the API's 600 requests/minute, with retries on 429 and 5xx.
- **Schema version:** every request pins `?v=2025-08-29T01:00:00.000Z`, the version the types describe.
- **Escape hatch:** `gw2.raw('/v2/some/path')` returns `unknown` for anything the table doesn't cover.

Also exported: `ROUTES` (runtime metadata per route: auth, permissions, language, bulk mode), `missingPermissions(granted, route)`, `looksLikeApiKey`, and every response type.

## How the types are checked

The response types were written against real responses: 172 of the 182 routes are checked by a script that captures a live response from each route and type-checks it with `satisfies`, which also catches fields the types don't declare. The remaining routes (guild-leader routes, `createsubtoken`, one WvW stat route that returns 404) follow the wiki. See `scripts/` in the [repository](https://github.com/ChristopherDavenport/gw2-ai).

MIT licensed. Not affiliated with ArenaNet.
