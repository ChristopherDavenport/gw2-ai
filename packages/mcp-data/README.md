# @gw2-ai/mcp-data

MCP server for public Guild Wars 2 data. No API key needed.

```json
{
  "mcpServers": {
    "gw2-data": { "command": "npx", "args": ["-y", "@gw2-ai/mcp-data"] }
  }
}
```

Claude Code: `claude mcp add --scope user gw2-data -- npx -y @gw2-ai/mcp-data`, or install the [gw2-ai plugin](https://github.com/ChristopherDavenport/gw2-ai), which adds all three servers plus skills.

## Tools

- `gw2_item_search`: item name to ids (via the wiki's item index), with type, rarity and price.
- `gw2_item`: item details: stats, flags, vendor value, chat link, trading post price, wiki link.
- `gw2_prices`: buy/sell prices, spread, and flip profit after the 15% trading post fee.
- `gw2_listings`: the order book for an item.
- `gw2_recipe_tree`: the full crafting tree with the cheaper of crafting or buying at each step. Mystic Forge recipes (legendary weapons and gifts, clovers) and NPC vendor prices (Philosopher's Stone for Spirit Shards, Obsidian Shard for Karma) come from the wiki, so account-bound parts add up to wallet-currency totals.
- `gw2_plan_create`: start a saved crafting plan for a large goal such as a legendary.
- `gw2_plan_show`: a plan as markdown (all of it, chosen sections or one component), or the list of saved plans.
- `gw2_plan_update`: record recipe choices, finished steps and notes; optionally refresh prices.
- `gw2_plan_research`: wiki intro and Acquisition section (without the vendor table) for named steps.
- `gw2_recipes_using`: crafting and Mystic Forge recipes that use an item.
- `gw2_gem_exchange`: gems to gold and gold to gems.
- `gw2_achievement`: achievement details with reward and step names resolved.
- `gw2_api_get`: raw JSON from any public `/v2` route.

## Crafting plans

The loop for a model: create the plan; settle the "Decide first" items with the player; count holdings with `gw2_plan_holdings` on [`@gw2-ai/mcp-account`](https://www.npmjs.com/package/@gw2-ai/mcp-account); write notes for steps needing research from the wiki excerpts; then update as the player progresses. A model that was only given the pasted markdown can reply with the JSON update block at the bottom of the plan, whose fields `gw2_plan_update` takes as they are.

Plans are JSON files in `~/.local/share/gw2-ai/plans/` (`$XDG_DATA_HOME/gw2-ai/plans/` if set). The `gw2_plan_*` tools are the only ones here that write anything.

MIT licensed. Not affiliated with ArenaNet. Part of [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai).
