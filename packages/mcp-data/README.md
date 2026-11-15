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
- `gw2_recipe_tree`: the full crafting tree with the cheaper of crafting or buying at each step. Mystic Forge recipes (legendary weapons and gifts, clovers) come from the wiki, since the API has none.
- `gw2_recipes_using`: crafting and Mystic Forge recipes that use an item.
- `gw2_recipes_using`: recipes an item is an ingredient in.
- `gw2_gem_exchange`: gems to gold and gold to gems.
- `gw2_achievement`: achievement details with reward and step names resolved.
- `gw2_api_get`: raw JSON from any public `/v2` route.

MIT licensed. Not affiliated with ArenaNet. Part of [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai).
