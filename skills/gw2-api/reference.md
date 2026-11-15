# GW2 API endpoint catalog

Generated on 2026-11-15 from `https://api.guildwars2.com/v2.json?v=latest` (active routes only). Re-generate when in doubt: that file lists every route with `auth`, `lang` and `active` flags, plus `schema_versions`.

- **Auth**: `—` means public. `key: a, b` lists the API key permissions (scopes) the route needs, taken from each route's page on wiki.guildwars2.com (`API:2/...`); every key has `account`. The API is the final word: a missing scope is rejected, so check `/v2/tokeninfo` first.
- **Lang**: `yes` means the response has localized text and honours `?lang=en|es|de|fr|zh`.
- **Index** routes return the names of their sub-routes (`/v2/account/mounts` returns `["types","skins"]`).
- Most public collection routes are bulk-expanded: no params lists all ids, `/route/:id` or `?id=` returns one object, `?ids=1,2,3` returns many (max 200), and `?page=&page_size=` pages through objects.

## Key and meta

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/build` | — |  |
| `/v2/createsubtoken` | key: account |  |
| `/v2/tokeninfo` | key: account |  |

## Account (`/v2/account/*`)

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/account` | key: account |  |
| `/v2/account/achievements` | key: account, progression |  |
| `/v2/account/bank` | key: account, inventories |  |
| `/v2/account/buildstorage` | key: account |  |
| `/v2/account/dailycrafting` | key: account, progression |  |
| `/v2/account/dungeons` | key: account, progression |  |
| `/v2/account/dyes` | key: account, unlocks |  |
| `/v2/account/emotes` | key: account |  |
| `/v2/account/finishers` | key: account, unlocks |  |
| `/v2/account/gliders` | key: account, unlocks |  |
| `/v2/account/home` | index: lists sub-routes |  |
| `/v2/account/home/cats` | key: account, progression, unlocks |  |
| `/v2/account/home/nodes` | key: account, progression, unlocks |  |
| `/v2/account/homestead` | index: lists sub-routes |  |
| `/v2/account/homestead/decorations` | key: account, unlocks |  |
| `/v2/account/homestead/glyphs` | key: account, unlocks |  |
| `/v2/account/inventory` | key: account, inventories |  |
| `/v2/account/jadebots` | key: account, unlocks |  |
| `/v2/account/legendaryarmory` | key: account, unlocks, inventories |  |
| `/v2/account/luck` | key: account, progression, unlocks |  |
| `/v2/account/mailcarriers` | key: account, unlocks |  |
| `/v2/account/mapchests` | key: account, progression |  |
| `/v2/account/masteries` | key: account, progression |  |
| `/v2/account/mastery/points` | key: account, progression |  |
| `/v2/account/materials` | key: account, inventories |  |
| `/v2/account/minis` | key: account, unlocks |  |
| `/v2/account/mounts` | index: lists sub-routes |  |
| `/v2/account/mounts/skins` | key: account, unlocks |  |
| `/v2/account/mounts/types` | key: account, unlocks |  |
| `/v2/account/novelties` | key: account, unlocks |  |
| `/v2/account/outfits` | key: account, unlocks |  |
| `/v2/account/progression` | key: progression, unlocks |  |
| `/v2/account/pvp/heroes` | key: account, unlocks |  |
| `/v2/account/raids` | key: account, progression |  |
| `/v2/account/recipes` | key: account, unlocks |  |
| `/v2/account/skiffs` | key: account, unlocks |  |
| `/v2/account/skins` | key: account, unlocks |  |
| `/v2/account/titles` | key: account, unlocks |  |
| `/v2/account/wallet` | key: account, wallet |  |
| `/v2/account/wizardsvault/daily` | key: account, progression |  |
| `/v2/account/wizardsvault/listings` | key: account, progression |  |
| `/v2/account/wizardsvault/special` | key: account, progression |  |
| `/v2/account/wizardsvault/weekly` | key: account, progression |  |
| `/v2/account/worldbosses` | key: account, progression |  |
| `/v2/account/wvw` | key: account, wvw |  |

## Characters (`/v2/characters/:id/*`, `:id` is the URL-encoded character name)

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/characters` | key: account, characters |  |
| `/v2/characters/:id/backstory` | key: account, characters |  |
| `/v2/characters/:id/buildtabs` | key: account, builds, characters |  |
| `/v2/characters/:id/buildtabs/active` | key: account, builds, characters |  |
| `/v2/characters/:id/core` | key: account, characters |  |
| `/v2/characters/:id/crafting` | key: account, characters |  |
| `/v2/characters/:id/equipment` | key: account, builds, characters, inventories |  |
| `/v2/characters/:id/equipmenttabs` | key: account, builds, characters |  |
| `/v2/characters/:id/equipmenttabs/active` | key: account, builds, characters |  |
| `/v2/characters/:id/heropoints` | key: account, characters, progression |  |
| `/v2/characters/:id/inventory` | key: account, characters, inventories |  |
| `/v2/characters/:id/quests` | key: account, characters, progression |  |
| `/v2/characters/:id/recipes` | key: account, characters, inventories |  |
| `/v2/characters/:id/sab` | key: account, characters |  |
| `/v2/characters/:id/skills` | key: account, builds, characters |  |
| `/v2/characters/:id/specializations` | key: account, builds, characters |  |
| `/v2/characters/:id/training` | key: account, builds, characters |  |

## Trading post and gem exchange

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/commerce/delivery` | key: account, tradingpost |  |
| `/v2/commerce/exchange` | index: lists sub-routes |  |
| `/v2/commerce/listings` | — |  |
| `/v2/commerce/prices` | — |  |
| `/v2/commerce/transactions` | key: account, tradingpost |  |

## Guilds

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/emblem` | — |  |
| `/v2/guild/:id` | optional: public name/tag/emblem without a key; a key with `guilds` for a guild the account is in adds more |  |
| `/v2/guild/:id/log` | key: account, guilds |  |
| `/v2/guild/:id/members` | key: account, guilds |  |
| `/v2/guild/:id/ranks` | key: account, guilds |  |
| `/v2/guild/:id/stash` | key: account, guilds |  |
| `/v2/guild/:id/storage` | key: account, guilds |  |
| `/v2/guild/:id/teams` | key: account, guilds |  |
| `/v2/guild/:id/treasury` | key: account, guilds |  |
| `/v2/guild/:id/upgrades` | key: account, guilds |  |
| `/v2/guild/permissions` | — | yes |
| `/v2/guild/search` | — |  |
| `/v2/guild/upgrades` | — | yes |

## Items, crafting and unlockables

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/colors` | — | yes |
| `/v2/currencies` | — | yes |
| `/v2/dailycrafting` | — | yes |
| `/v2/emotes` | — | yes |
| `/v2/finishers` | — | yes |
| `/v2/gliders` | — | yes |
| `/v2/items` | — | yes |
| `/v2/itemstats` | — | yes |
| `/v2/jadebots` | — | yes |
| `/v2/legendaryarmory` | — |  |
| `/v2/mailcarriers` | — | yes |
| `/v2/materials` | — | yes |
| `/v2/minis` | — | yes |
| `/v2/mounts` | index: lists sub-routes |  |
| `/v2/mounts/skins` | — | yes |
| `/v2/mounts/types` | — | yes |
| `/v2/novelties` | — | yes |
| `/v2/outfits` | — | yes |
| `/v2/recipes` | — |  |
| `/v2/recipes/search` | — |  |
| `/v2/skiffs` | — | yes |
| `/v2/skins` | — | yes |
| `/v2/titles` | — | yes |

## Achievements, progression and lockouts

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/achievements` | — | yes |
| `/v2/achievements/categories` | — | yes |
| `/v2/achievements/groups` | — | yes |
| `/v2/backstory/answers` | — | yes |
| `/v2/backstory/questions` | — | yes |
| `/v2/dungeons` | — | yes |
| `/v2/mapchests` | — | yes |
| `/v2/masteries` | — | yes |
| `/v2/quests` | — | yes |
| `/v2/raids` | — | yes |
| `/v2/stories` | — | yes |
| `/v2/stories/seasons` | — | yes |
| `/v2/wizardsvault/listings` | — | yes |
| `/v2/wizardsvault/objectives` | — | yes |
| `/v2/worldbosses` | — | yes |

## Professions and builds

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/legends` | — |  |
| `/v2/pets` | — | yes |
| `/v2/professions` | — | yes |
| `/v2/races` | — | yes |
| `/v2/skills` | — | yes |
| `/v2/specializations` | — | yes |
| `/v2/traits` | — | yes |

## World, maps and home instance

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/continents` | — | yes |
| `/v2/files` | — |  |
| `/v2/home` | index: lists sub-routes |  |
| `/v2/home/cats` | — | yes |
| `/v2/home/nodes` | — | yes |
| `/v2/homestead` | index: lists sub-routes |  |
| `/v2/homestead/decorations` | — | yes |
| `/v2/homestead/decorations/categories` | — | yes |
| `/v2/homestead/decorations/categories/:id` | — | yes |
| `/v2/homestead/glyphs` | — | yes |
| `/v2/logos` | — |  |
| `/v2/maps` | — | yes |
| `/v2/quaggans` | — |  |
| `/v2/worlds` | — | yes |

## PvP

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/pvp` | index: lists sub-routes |  |
| `/v2/pvp/amulets` | — | yes |
| `/v2/pvp/games` | key: account, pvp |  |
| `/v2/pvp/heroes` | — | yes |
| `/v2/pvp/ranks` | — | yes |
| `/v2/pvp/seasons` | — | yes |
| `/v2/pvp/seasons/:id/leaderboards` | — |  |
| `/v2/pvp/seasons/:id/leaderboards/:board/:region` | — |  |
| `/v2/pvp/standings` | key: account, pvp |  |
| `/v2/pvp/stats` | key: account, pvp |  |

## WvW

| Route | Auth | Lang |
| --- | --- | --- |
| `/v2/wvw/abilities` | — | yes |
| `/v2/wvw/guilds` | — |  |
| `/v2/wvw/guilds/:region` | — |  |
| `/v2/wvw/matches` | — |  |
| `/v2/wvw/matches/overview` | — |  |
| `/v2/wvw/matches/scores` | — |  |
| `/v2/wvw/matches/stats` | — |  |
| `/v2/wvw/matches/stats/:id/guilds/:guild_id` | — |  |
| `/v2/wvw/matches/stats/:id/teams/:team/top/kdr` | — |  |
| `/v2/wvw/matches/stats/:id/teams/:team/top/kills` | — |  |
| `/v2/wvw/objectives` | — | yes |
| `/v2/wvw/ranks` | — | yes |
| `/v2/wvw/timers` | — |  |
| `/v2/wvw/timers/lockout` | — |  |
| `/v2/wvw/timers/teamAssignment` | — |  |
| `/v2/wvw/upgrades` | — | yes |

## Route details worth knowing

- `/v2/characters` lists character names; `/v2/characters?ids=all` returns every character in full; `/v2/characters/:name` one character (URL-encode the name, spaces as `%20`). Sub-routes such as `/inventory` and `/equipment` return just that part.
- `/v2/commerce/transactions/{current|history}/{buys|sells}`: open orders and the last 90 days of history. Paged; use `page` and `page_size` (max 200).
- `/v2/commerce/prices?ids=` returns `{id, whitelisted, buys: {quantity, unit_price}, sells: {quantity, unit_price}}`. `buys.unit_price` is the highest buy order, `sells.unit_price` the lowest listing. Untradable ids are missing (404 `no such id` for a single id).
- `/v2/commerce/listings?ids=` returns the order book: `buys` and `sells` arrays of `{listings, unit_price, quantity}`.
- `/v2/commerce/exchange/gems?quantity=N` returns `{coins_per_gem, quantity}` where `quantity` is copper received for selling N gems; `/v2/commerce/exchange/coins?quantity=C` returns the gems received for C copper.
- `/v2/recipes/search?output=<item_id>` and `?input=<item_id>` return recipe ids. Recipes give `ingredients: [{type: "Item"|"Currency"|"GuildUpgrade", id, count}]`, `disciplines`, `min_rating`, and `flags` (`AutoLearned`, `LearnedFromItem`). Mystic Forge recipes are not in the API (the gw2-data tools read them from the wiki).
- `/v2/account/achievements?ids=` returns progress `{id, current, max, done, bits?, repeated?}` only for achievements the account has started; `bits` are indices into the achievement's `bits` list from `/v2/achievements`.
- `/v2/account/wizardsvault/{daily|weekly|special}` return the current period's objectives with `progress_current`, `progress_complete`, `claimed`, plus meta progress fields.
- `/v2/account/worldbosses`, `/mapchests`, `/dailycrafting` return ids done since the daily reset (00:00 UTC); `/v2/account/raids` returns encounter ids cleared since the weekly reset (Monday 07:30 UTC). Compare with `/v2/worldbosses`, `/v2/mapchests`, `/v2/dailycrafting`, `/v2/raids` for the full lists.
- `/v2/build` returns the current game build id; useful as a cache-busting key for static data.

## Disabled routes

These appear in `v2.json` with `active: false` and should not be used: `/v2/account/mail`, `/v2/achievements/daily`, `/v2/achievements/daily/tomorrow` (replaced by the Wizard's Vault), `/v2/adventures` and its leaderboards, `/v2/characters/:id/dungeons`, `/v2/events`, `/v2/events-state`, `/v2/gemstore/catalog`, `/v2/pvp/rewardtracks`, `/v2/pvp/runes`, `/v2/pvp/sigils`, `/v2/vendors`, `/v2/wvw/rewardtracks`.
