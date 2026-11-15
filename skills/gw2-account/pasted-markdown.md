# Reading a pasted GW2 account report

The gw2-ai site and the `gw2_account_report` tool produce the same markdown. This page describes it so you can answer from a pasted copy without any tools.

## Header

```
# Guild Wars 2 account report

Generated 2026-11-15T12:00:00.000Z from the official GW2 API (api.guildwars2.com).
API key "<key name>" permissions: account, characters, inventories, ...
```

- The timestamp is when the report was built. Anything time-sensitive (Wizard's Vault, lockouts, trading post orders, prices) is only as fresh as that, plus up to ~5 minutes of API lag. If the report is from an earlier day, daily items have reset since (00:00 UTC daily, Monday 07:30 UTC weekly); say so.
- The permission list tells you which sections could be filled.
- `## Contents` lists every section. A section marked `(skipped)` lacked a permission; `(error)` failed for another reason.

## Conventions

- **Coins** are `Ng Ns Nc`: 1 gold = 100 silver = 10,000 copper. `1,234g 5s 6c` = 12,340,506 copper.
- **Ids** are GW2 API ids, in the last column of most tables (`Item id`, `Currency id`, `Achievement id`). Use them with gw2-data tools (`gw2_item`, `gw2_prices`, `gw2_recipe_tree`) or `gw2_wiki_by_id`.
- `—` means no data. `_None._` means an empty table. `_Skipped: API key lacks permission: X._` and `_Failed: ..._` replace a section body.
- **Values** are instant-sell prices: units times the highest current buy order, before the 15% trading post fees. Blank value = account-bound, soulbound, not tradable, or no buy orders.

## Sections

Section ids (used by `gw2_account_report {sections}`) are in the second column.

| Heading | Id | Needs | Contents |
| --- | --- | --- | --- |
| Account overview | `overview` | account | Bullets: account name, created date and hours played, access (expansions owned), commander tag, fractal level, WvW rank and team, guilds (`(leader)` marks guilds the player leads), daily/monthly AP. Sub-table "Mastery points" (Region, Earned, Spent, Unspent); luck total. Fractal level and masteries need progression |
| Wallet | `wallet` | wallet | Currency, Amount, Currency id. Coin (id 1) is in g/s/c; other currencies are plain counts |
| Characters | `characters` | characters | Name, Profession, Elite spec, Level, Race, Played, Deaths, Crafting (`Armorsmith 500, Chef 400 (inactive)`), Created. Elite spec needs builds; without it the column shows `—` and a note |
| Wizard's Vault | `wizards-vault` | account, progression | `### Daily`, `### Weekly`, `### Special`, each with `Meta: x/y` and a table: Objective, Track (PvE/PvP/WvW), Progress, Status (`claimed`, `ready to claim`, `open`), Astral acclaim |
| Daily and weekly lockouts | `resets` | account, progression | World bosses, Hero's Choice map chests and daily crafting as `x/y done` with `Done:` and `Remaining:` id lists; a raid table (Wing, Bosses cleared, Remaining) |
| Items (bank, shared slots, character bags) | `items` | inventories (character bags also need characters) | Count of distinct items and total instant-sell value, then Item, Rarity, Count, Value, Where (`Bank 250, Shared slots 1, Charname 3`), Item id. Sorted by value. Capped at `max_rows` (default 200) with a "Showing the top N" note. **Excludes** equipped gear, material storage, the legendary armory and guild storage |
| Material storage | `materials` | inventories | Total value, then one `### Category — value` table per material category: Material, Count, Value, Item id |
| Trading post | `trading-post` | account, tradingpost | Delivery box (coins and items waiting for pickup); open buy orders with status `top order` or `outbid (top X)`; open sell listings with `lowest listing` or `undercut (lowest X)`; the newest 25 sales and purchases from the last 90 days |
| Achievements closest to completion | `achievements` | account, progression | Totals, then up to 50 unfinished achievements by percent done: Achievement, Progress, %, Requirement, Achievement id |
| Legendary armory | `legendary-armory` | account, inventories, unlocks | Item, Type, Subtype, Count, Item id. Count is copies stored in the armory |
| Collection unlocks | `unlocks` | account, unlocks | Collection (Skins, Dyes, Minis, Outfits, Gliders, Mount skins, Finishers, Novelties, Titles, Recipes), Unlocked, Total, % |

## What a report can't answer

Equipped gear, build templates, guild stash, homestead decorations, masteries per track, PvP stats, and anything newer than the timestamp. With the MCP server, use `gw2_character {name}` or `gw2_account_get {path}`. Without it, ask the user to regenerate the report or look in game.
