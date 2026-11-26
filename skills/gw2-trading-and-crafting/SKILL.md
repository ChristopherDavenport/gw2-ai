---
name: gw2-trading-and-crafting
description: Guild Wars 2 (GW2) trading post and crafting economics. Use when the user asks what an item sells or costs ("price of Glob of Ectoplasm", "how much is a Mystic Coin"), whether a flip is profitable, what to sell or buy, whether to craft or buy something ("is it cheaper to craft Deldrimor Steel Ingots"), what they need to buy to craft an item, what an item is used in, the gem-to-gold or gold-to-gem exchange rate, or about trading post fees, buy orders, sell listings, undercutting and market depth.
---

# GW2 trading and crafting

Prices change minute to minute. Always fetch live data; never quote prices from memory.

Tools come from two MCP servers. **gw2-data** (no key): `gw2_item_search`, `gw2_item`, `gw2_prices`, `gw2_listings`, `gw2_recipe_tree`, `gw2_recipes_using`, `gw2_gem_exchange`. **gw2-account** (key): `gw2_shopping_list`, `gw2_find_item`. **gw2-wiki** (no key): `gw2_wiki_page` for where unpriced items come from. Mystic Forge recipes and NPC vendor prices are already in `gw2_recipe_tree` and `gw2_shopping_list` (read from the wiki); `gw2_recipes_using` lists forge recipes too. In Claude Code they appear as `mcp__plugin_gw2-ai_<server>__<tool>` (plugin) or `mcp__<server>__<tool>` (manual config).

## Without the MCP servers

If the user pasted a GW2 account report instead, its `Value` columns are instant-sell totals (count times the highest buy order, before fees) and its Trading post section shows open orders with `outbid`/`undercut` status, all as of the report's `Generated` time. You can still do the fee math, craft-vs-buy structure and advice below from those numbers, but say the prices are from the report time and recommend checking current prices in game or with the gw2-data server before acting. Don't make up current prices.

## Always start by resolving ids

Names are ambiguous (rarity variants, skins vs items, "Mystic Coin" vs "Mystic Clover"). Call `gw2_item_search {query}` and pick the exact match; if several plausible items remain, show them with ids and ask, or price all of them. Reuse ids from a pasted account report when present.

## Price vocabulary

`gw2_prices {item_ids}` returns two numbers per item. Use these names consistently:

| API field | Meaning | You get/pay it by |
| --- | --- | --- |
| `buys.unit_price` | highest buy order | **instant-sell**: selling now to that order |
| `sells.unit_price` | lowest sell listing | **instant-buy**: buying now from that listing |

The other routes are patient: place a buy order (usually 1c above the top order) and wait, or list for sale (usually 1c below the lowest listing) and wait. Patient routes get better prices but may never fill.

## Fees (exact rules)

Selling on the trading post costs 15% of the sale price, in two parts:

- **Listing fee, 5%** of the listing price, minimum 1c, paid up front from the wallet when you list, and also on an instant sell. Not refunded if you cancel.
- **Exchange fee, 10%** of the sale price, minimum 1c, deducted from the coins you receive when it sells.

Buyers pay no fee. For a sale at unit price `P` copper:

```
net per unit   = P - max(1, round(0.05 * P)) - max(1, round(0.10 * P))  ≈ 0.85 * P
flip profit    = 0.85 * sell_price - buy_price          (per unit)
break-even     = buy_price / 0.85                        ≈ 1.1765 * buy_price
ROI            = flip profit / buy_price
```

Example: list at 2g (20,000c): listing fee 1,000c, exchange fee 2,000c, you receive 1g 70s. Each fee is rounded to whole copper, so treat the 0.85 factor as exact to within a copper or two per unit. A single trade is capped at 250 units.

`gw2_prices` reports a flip profit that already takes off the 15%; check which prices it used (buy order to sell listing) before quoting it.

## Procedures

**"What's X worth?"** `gw2_item_search` then `gw2_prices`. Report both prices, and what the player would net by instant-selling (`0.85 * buys`) and by listing (`0.85 * sells`). For more than a few hundred units, or a thin market, call `gw2_listings {item_id, depth}` and say how far down the order book the quantity would go.

**"Is this flip worth it?"** Need: buy order price `B`, sell listing price `S`, supply/demand depth. Profit per unit = `0.85*S - B`. Flag it as weak when profit is a few copper, the spread exists because volume is tiny, or one large listing sits at the top of the book (`gw2_listings`). Margins are snapshots; competing traders will move them.

**"Craft or buy?"**
1. `gw2_recipe_tree {item_id, quantity}` for the full ingredient tree, crafting and Mystic Forge recipes alike. Chance-based forges (Mystic Clover) are costed at the wiki's average yield: say the count is an expectation. Vendor items are costed in wallet currencies (a separate table; Karma for Obsidian Shards). Leaves marked **unpriced** have no recipe, TP price or vendor: look them up on the wiki (`gw2_wiki_page`).
2. Price every tradable ingredient with `gw2_prices` in one call. Choose a price basis and say which: instant-buy (`sells`) for speed, buy orders (`buys`) for patience.
3. Compare total ingredient cost with buying the output (`sells` of the output). If the player would sell the result, compare with `0.85 *` its price instead.
4. Note blockers: the recipe may need to be learned (`LearnedFromItem` flag) and a discipline at `min_rating`; check the account's characters (gw2-account skill). Some intermediates are time-gated by daily crafting (for example the ascended refinements listed in `/v2/dailycrafting`). Account-bound ingredients have no price: say how to get them, don't count them as free.
5. Items the player already owns aren't free either: their cost is what they would sell for. When the user asks "with what I have", use `gw2_shopping_list {item_id, quantity}`, which counts account holdings and prices only the remainder.
6. For a legendary or another goal worked on over days or weeks, switch to a saved crafting plan (`gw2_plan_create`, the gw2-goals skill) instead of repeating the tree.

**"What can I make with X / what uses X?"** `gw2_recipes_using {item_id}`. To find a profitable use, price the outputs and compare with the inputs, as above.

**Gem exchange.** `gw2_gem_exchange {gems: N}` gives coins received for selling N gems; `{coins: C}` (copper) gives gems received for spending C. Rates depend on the quantity and include the exchange's spread, so quote for the amount the user actually means, and don't reverse one quote to get the other direction.

## Caveats to state when relevant

- Prices are live snapshots and can move within minutes, especially after patches and during sales.
- Account-bound, soulbound and `NoSell` items have no trading post price (the API returns no price or "no such id"). Never report their value as 0; say they can't be traded.
- Some items are limited for free-to-play accounts (`whitelisted: false` in the price data).
- Large quantities move the price: the top-of-book price is only good for the quantity listed at it.
- The listing fee is lost if a listing is cancelled, so frequent relisting to undercut has a cost.

## Presenting results

- Write coins as `1g 23s 45c` (1g = 100s = 10,000c). Show copper math only when asked.
- For comparisons, use a small table: item, quantity, unit price, total, price basis.
- State the price basis (instant vs orders) and the time of the quote ("as of now"), and remind the user that net sale proceeds are after the 15% fee.
