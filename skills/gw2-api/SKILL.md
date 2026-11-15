---
name: gw2-api
description: Reference for writing code against the official Guild Wars 2 (GW2) API (api.guildwars2.com/v2) and the GW2 wiki API (wiki.guildwars2.com). Use when writing, debugging or reviewing code or scripts that call GW2 endpoints, handle GW2 API keys, permissions or subtokens, page or batch ids, deal with schema versions, rate limits, CORS in the browser, 206/404 responses, or query the wiki's MediaWiki / Semantic MediaWiki API; also when choosing which endpoint returns some piece of GW2 data, or calling the generic `gw2_api_get` / `gw2_account_get` MCP tools.
---

# GW2 API for code

Facts below were checked against the live API on 2026-11-15. The endpoint catalog, with the permissions each route needs, is in [reference.md](reference.md). Don't invent endpoints: if a route isn't in the catalog, fetch `https://api.guildwars2.com/v2.json?v=latest` to check.

In this repository, `@gw2-ai/client` (`packages/client`: `Gw2Client`, `WikiClient`) already implements everything here: batching, caching, rate limiting, retries, schema pinning. Use it rather than re-implementing. Every `/v2` route is typed, so pass the route template and the response type follows; use the client's exported types (`Item`, `Character`, `CommercePrice`...) instead of declaring your own:

```ts
const gw2 = new Gw2Client({ apiKey });
const bank = await gw2.get('/v2/account/bank');                           // (InventorySlot | null)[]
const build = await gw2.get('/v2/characters/:id/buildtabs/active', { path: { id: name } });
const prices = await gw2.many('/v2/commerce/prices', [19721]);            // Map<number, CommercePrice>
const recipeIds = await gw2.get('/v2/recipes/search', { query: { output: 19721 } });
```

`packages/core` builds on it: the markdown account report, recipe trees and formatting helpers.

## Requests

- **Base URL**: `https://api.guildwars2.com/v2/...`. JSON only. Errors come back as `{"text": "..."}`.
- **Auth**: append `access_token=<key>` to the query string. Server-side code may instead send `Authorization: Bearer <key>`, but **browsers must use the query parameter**: a custom `Authorization` header forces a CORS preflight, and the API answers `OPTIONS` with 404, so the request fails. Simple GETs get `Access-Control-Allow-Origin: *`. Don't log full URLs: they contain the key.
- **Schema version**: pin it with `?v=2025-08-29T01:00:00.000Z` (the latest, and what this project uses). Without it you get an old default schema with different field layouts (for example `/v2/account` has WvW fields under `wvw` and `team_id` only from 2024-07-20). The `X-Schema-Version` header also works server-side but triggers a preflight in browsers. `schema_versions` in `/v2.json` lists each change.
- **Language**: `?lang=en|es|de|fr|zh` on routes with localized text.

## Ids, bulk and paging

| Request | Result |
| --- | --- |
| `/v2/items` | array of every id (74,000+) |
| `/v2/items/19721` or `?id=19721` | one object; unknown id: 404 `no such id` |
| `?ids=1,2,3` | array of objects, **max 200 ids** (201 gives 400 `id list too long; this endpoint is limited to 200 ids at once`) |
| some ids invalid | **206 Partial Content** with only the valid objects |
| all ids invalid | **404** `all ids provided are invalid` (treat as an empty result in bulk code) |
| `?ids=all` | whole collection, **only on small routes** (currencies, materials, raids, worldbosses, characters...). `/v2/items?ids=all` gives 400 `unable to use 'all' keyword for this API` |
| `?page=0&page_size=200` | one page of objects. `page` is 0-based, `page_size` 1–200; out of range gives 400. Headers: `X-Page-Total`, `X-Page-Size`, `X-Result-Total`, `X-Result-Count`, `Link` (next/first/last) |

For large id sets, split into chunks of 200 and run a few requests in parallel; cache per id. The API has no name search: to find an item by name use the wiki (below), or scan all items once and cache (about 370 requests).

## Rate limit and caching

- Responses carry `x-rate-limit-limit: 600` (requests per minute). Exceeding it returns 429; back off (respect `Retry-After` if present) and retry. Retry 5xx with exponential backoff too.
- Static data sends `cache-control: public,max-age=3600`; cache it. Item, recipe and skin definitions only change with game builds (`/v2/build`).
- **Account data lags the game by up to ~5 minutes** (the API caches it). Don't poll faster; tell users a just-finished action may not show yet.
- Trading post prices are live; cache for a minute or two at most.

## Keys, permissions and subtokens

- Players create keys at https://account.arena.net/applications. Format: 72 characters, `8-4-4-4-20-4-4-4-12` uppercase hex groups. Permissions can't be changed after creation; the player makes a new key.
- Permissions (scopes): `account` (always on), `builds`, `characters`, `guilds`, `inventories`, `progression`, `pvp`, `tradingpost`, `unlocks`, `wallet`, `wvw`. See reference.md for which routes need which.
- **Call `/v2/tokeninfo` first**: `{id, name, permissions}` (subtokens add `expires_at`, `issued_at`, `urls`). Decide what to fetch from `permissions` instead of firing requests that will fail.
- Errors: no key or a non-key string gives 401 `Invalid access token`; a key-shaped but unknown or deleted key gives 400 `invalid key`; a key without the route's scope is also rejected with a 4xx. Treat 400s whose text mentions key/token as auth errors.
- **Subtokens**: `GET /v2/createsubtoken?access_token=<key>&expire=<ISO-8601>&permissions=account,wallet&urls=/v2/account,/v2/account/wallet` returns `{"subtoken": "<JWT>"}`. A subtoken can't exceed its parent's permissions, can be limited to specific `urls`, and stops working at `expire` or when the parent key is deleted. Use them to hand a third party narrow, expiring access.
- Treat keys as secrets: keep them out of URLs that get logged, out of source control, and out of LLM prompts. Store them encrypted or in a 0600 file.

## Wiki API

`https://wiki.guildwars2.com/api.php` is MediaWiki with TextExtracts, CirrusSearch and Semantic MediaWiki.

- **User-Agent**: the wiki returns **403 to Node's default `fetch` agent** and to an empty agent. Send a descriptive one server-side, such as `my-tool/1.0 (contact or repo URL)`. In browsers, don't set it (a custom User-Agent forces a preflight); the browser's agent is accepted.
- **CORS**: add `origin=*` to every browser request.
- Common calls (`format=json&formatversion=2`):
  - search: `action=query&list=search&srsearch=<text>&srnamespace=0&srlimit=10`
  - plain text: `action=query&prop=extracts&explaintext=1&redirects=1&titles=<Title>` (add `exintro=1` for the intro only)
  - wikitext: `action=parse&page=<Title>&prop=wikitext`
  - SMW query: `action=ask&query=[[Has game id::19721]][[Has context::Item]]|?Has context|limit=10`
- **Game ids collide across contexts.** Item, skin, achievement, trait, skill and location ids overlap: `[[Has game id::100]]` returns an achievement, a skin, an achievement category, an item and a location. Always add `[[Has context::Item]]` (or `Skin`, `Achievement`, `Skill`, `Trait`...) when mapping an API id to a wiki page.
- API route documentation lives at `API:2/<route>`, for example `API:2/account/bank`; its infobox `scope` field lists the required permissions.
- Mystic Forge recipes, collection steps, vendor prices and event timers exist only on the wiki. In this repository, `WikiClient.mysticForgeRecipes(outputIds)` and `mysticForgeRecipesUsing(itemId)` read the wiki's recipe data (SMW `Has recipe source::Mystic forge`); only recipes with `base: true` are fit for material totals, and chance-based ones (Mystic Clover) have a fractional average `output_item_count`. The wiki rejects `ask` queries with more than about 12 OR'd values.

## MCP tools in this repo

When the MCP servers are connected, prefer their focused tools. For anything else: `gw2_api_get {path, ids?, params?}` (gw2-data, public routes) and `gw2_account_get {path, params?}` (gw2-account, authenticated routes; the server adds the key). Paths are as in reference.md, for example `{path: "/v2/account/masteries"}`.
