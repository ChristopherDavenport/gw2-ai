---
name: gw2-goals
description: Plan long Guild Wars 2 (GW2) goals against what the player's account already has. Use when the user wants to make or work toward a legendary weapon, armor, trinket or backpack ("how do I make Twilight", "what do I still need for Aurora", "plan my legendary"), finish a collection or achievement, unlock masteries, gather a precursor or Mystic Forge gift (Gift of Mastery, Gift of Fortune, Gift of Might...), or wants a checklist, shopping list or cost estimate for a long-term goal.
---

# GW2 goal planning

Produce a checklist of every component of the goal, marked against what the account already has, with what's left to buy, craft or earn. Combine three sources:

- **gw2-account** (key): `gw2_key_info`, `gw2_find_item`, `gw2_shopping_list`, `gw2_account_report`, `gw2_account_get`.
- **gw2-data** (no key): `gw2_item_search`, `gw2_item`, `gw2_recipe_tree`, `gw2_prices`, `gw2_achievement`.
- **gw2-wiki** (no key): `gw2_wiki_search`, `gw2_wiki_page`, `gw2_wiki_ask`, `gw2_wiki_by_id`.

In Claude Code the tools appear as `mcp__plugin_gw2-ai_<server>__<tool>` (plugin) or `mcp__<server>__<tool>` (manual config).

The API knows crafting recipes, items, prices and achievement progress. Mystic Forge recipes and NPC vendor prices come from the wiki through `gw2_recipe_tree` and `gw2_shopping_list`, so account-bound parts end as wallet currencies (Spirit Shards, Karma, map currencies). Collection steps and how to earn those currencies are only on wiki pages. Never fill those gaps from memory: legendary recipes have changed over the years and differ between generations.

## Procedure

1. **Pin down the target.** `gw2_item_search {query}` for item goals; `gw2_wiki_search` for collections, achievements and masteries. Confirm with the user if more than one match is plausible (for example a legendary vs its skin).
2. **Check it isn't already done.** `gw2_key_info`, then `gw2_find_item {item_id}` (legendaries can sit in the legendary armory) or the achievement's progress (step 5).
3. **Get the full tree.** `gw2_recipe_tree {item_id, quantity, expand_all: true}` expands crafting and Mystic Forge recipes together (a legendary's four forge components, their gifts, clovers at the wiki's average yield). Use `expand_all` because the default stops at components that are cheaper to buy, which hides the gifts.
4. **Read the currencies and what's left.** Vendor items (Bloodstone Shard, Philosopher's Stone, Obsidian Shard, Gift of the Itzel...) are costed in the currency their vendors take, summed in a "Currency / Currency id / Amount" table; ids are /v2/currencies ids, so compare them with the wallet. The tree picks one offer per item (Obsidian Shard assumes Karma; otherwise the price most vendors charge) and lists the others on the node: mention them when the player is short of the chosen currency. Leaves still marked **unpriced** (Gift of Exploration, Gift of Battle, Charged Quartz Crystal) are rewards or drops: `gw2_wiki_page {title}` says where they come from. If the tree says a wiki lookup failed, read that part from the item's wiki page instead, one level at a time.
5. **Check collections and achievements.** `gw2_achievement {ids}` gives the requirement and the list of bits (items, skins or text steps). The player's progress is `gw2_account_get {path: "/v2/account/achievements", params: {ids: "<id>"}}`: `current`/`max`, `done`, and `bits` (indices of completed steps). Map bit indices to the achievement's `bits` list to name what's left. The wiki page for the collection says where each step comes from. `gw2_wiki_ask` can list structured data, for example `[[Has game id::<id>]][[Has context::Item]]|?Has context` (game ids collide across items, skills, achievements and skins, so always filter by context).
6. **Count what the account has.** `gw2_shopping_list {item_id, quantity}` subtracts held items and prices the rest; with the `wallet` permission its currency table adds "In wallet" and "Still needed". For anything else account-bound (Legendary Insights, map currencies not in the tree), check `gw2_account_report {sections: ["wallet", "materials"], valuation: false}` and `gw2_find_item`.
7. **Price the remainder.** `gw2_prices` in one batch for tradable items not covered by the shopping list. Use buy-order prices for a patient plan and instant-buy for "if I bought it today", and say which.

Without a key (or with a pasted report), do steps 1, 3, 4 and 7 the same way and mark holdings from the pasted report's Items, Material storage, Wallet and Legendary armory sections. If those sections are missing, produce the checklist with a blank "have" column and say so.

If a permission is missing (`inventories` for holdings, `wallet` for currencies, `progression` for achievements, `unlocks` for the legendary armory), say what part of the checklist is unchecked because of it.

## Output format

```markdown
## <Goal> — plan (prices as of <time>)

**Remaining cost if bought now:** 1,234g 56s (buy orders) / 1,310g (instant)
**Time-gated or account-bound:** <short list with daily/weekly limits>

### <Component 1> (e.g. Gift of Mastery)
- [x] Gift of Battle — have 1
- [ ] Bloodstone Shard — 0/1, 200 Spirit Shards (have 145)
- [ ] Gift of Exploration — needs world completion (wiki: Gift of Exploration)

### Shopping list
| Item | Have | Need | Missing | Unit price | Cost |
| --- | --- | --- | --- | --- | --- |
```

- Group by top-level component, then list leaves with have/need counts.
- Separate what can be bought from what must be earned (map completion, achievements, WvW/PvP reward tracks, daily-crafted ascended materials, vendor currencies). For earned items, give the source and any daily/weekly cap from the wiki, and an honest time estimate only if the wiki states one.
- Suggest an order: time-gated items first (start daily crafting and reward tracks early), then cheap gathered materials, then expensive purchases last (prices move; the player may farm some).
- Link wiki pages by title so the player can verify.
- Totals: write coins as `1,234g 56s 78c`. Remind the player that prices are a snapshot.
