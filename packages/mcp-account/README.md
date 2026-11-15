# @gw2-ai/mcp-account

MCP server for your Guild Wars 2 account. Tools return compact markdown with API ids, so an assistant can answer "what should I do today?", "where is my Mystic Coin?" or "what do I still need for this?" without dumping raw JSON.

```json
{
  "mcpServers": {
    "gw2-account": { "command": "npx", "args": ["-y", "@gw2-ai/mcp-account"] }
  }
}
```

Claude Code: `claude mcp add --scope user gw2-account -- npx -y @gw2-ai/mcp-account`, or install the [gw2-ai plugin](https://github.com/ChristopherDavenport/gw2-ai), which adds all three servers plus skills.

## Tools

- `gw2_key_info`: the key's name and permissions, and which report sections they allow.
- `gw2_account_report`: a markdown report of chosen sections (overview, wallet, characters, wizards-vault, resets, items, materials, trading-post, achievements, legendary-armory, unlocks), optionally valued at trading post prices. `characters` adds a full section for each named character.
- `gw2_find_item`: where an item is held: bank, shared slots, each character, material storage, legendary armory.
- `gw2_character`: one character in detail: every build template (trait and skill names) and equipment template (stats, runes, sigils, infusions, PvP gear) with the active ones marked, crafting, bags. `templates: "active"` limits it to the templates in use.
- `gw2_shopping_list`: a crafting tree for an item minus what the account already holds, with the rest priced.
- `gw2_account_get`: raw JSON from any authenticated account route (allowlisted paths only).

## API key

Create a key at <https://account.arena.net/applications>. No permission lets a key spend gold or gems, but keys can read inventories and trading history, so give it only what you need. The server reads the key from:

1. the `GW2_API_KEY` environment variable, or
2. `~/.config/gw2-ai/api-key` (`$XDG_CONFIG_HOME/gw2-ai/api-key` if set), which `npx @gw2-ai/mcp-account set-key` writes with mode 0600 after checking the key. The server refuses to read the file if other users can.

The key is read on every call, so `set-key` takes effect without a restart. It is only ever sent to api.guildwars2.com and never appears in tool output or logs.

MIT licensed. Not affiliated with ArenaNet. Part of [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai).
