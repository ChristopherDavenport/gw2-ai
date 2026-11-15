# @gw2-ai/mcp-wiki

MCP server for the official Guild Wars 2 wiki (wiki.guildwars2.com). No API key needed.

```json
{
  "mcpServers": {
    "gw2-wiki": { "command": "npx", "args": ["-y", "@gw2-ai/mcp-wiki"] }
  }
}
```

Claude Code: `claude mcp add --scope user gw2-wiki -- npx -y @gw2-ai/mcp-wiki`, or install the [gw2-ai plugin](https://github.com/ChristopherDavenport/gw2-ai), which adds all three servers plus skills.

## Tools

- `gw2_wiki_search`: full-text search.
- `gw2_wiki_page`: a page as plain text, following redirects, optionally just the intro.
- `gw2_wiki_ask`: a Semantic MediaWiki query, e.g. `[[Has context::Item]][[~*Clover*]]|?Has game id`.
- `gw2_wiki_by_id`: game id (item, skill, trait, achievement...) to wiki page.

MIT licensed. Not affiliated with ArenaNet. Part of [gw2-ai](https://github.com/ChristopherDavenport/gw2-ai).
