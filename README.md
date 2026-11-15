# gw2-ai

Tools that let an AI assistant read Guild Wars 2 data quickly and correctly: your account (through the official API and your API key), game data and trading post prices, and the official wiki.

There are three ways to use it:

| Piece | What it is | Needs |
| --- | --- | --- |
| **Report site** (`site/`) | A static web page. Store your API key in the browser, generate a markdown report of your account, paste it into any AI chat. | A browser |
| **MCP servers** (`packages/mcp-*`) | Three servers any MCP client can run: `gw2-account` (your account, needs a key), `gw2-data` (items, recipes, prices, gem exchange, raw API), `gw2-wiki` (search and read wiki.guildwars2.com). | Node.js 22+ |
| **Skills** (`skills/`) | Instructions that teach Claude how to answer account questions, trade and craft, plan legendaries and collections, and write GW2 API code. They work with the MCP servers or with a pasted report. | Claude Code, or any client that loads skills |

The Claude Code plugin in this repository bundles the skills and the three servers.

## Quickstart

### Claude Code plugin

The MCP servers are TypeScript and `dist/` isn't committed, so the plugin must be built after you get it. Requirements: Node.js 22+ and pnpm 10 (`corepack enable` provides it).

**Recommended: install from a local clone.** Claude Code loads a plugin from a local marketplace in place, so you build once and updates are a `git pull`.

```sh
git clone https://github.com/ChristopherDavenport/gw2-ai.git
cd gw2-ai
pnpm install && pnpm build
claude plugin marketplace add ./
claude plugin install gw2-ai@gw2-ai
```

To update: `git pull && pnpm install && pnpm build`, then run `/reload-plugins` in Claude Code.

**From GitHub.** Inside Claude Code:

```
/plugin marketplace add ChristopherDavenport/gw2-ai
/plugin install gw2-ai@gw2-ai
```

Claude Code copies the plugin into its cache without building it, so the servers won't start until you build that copy:

```sh
cd ~/.claude/plugins/cache/gw2-ai/gw2-ai/0.1.0
pnpm install && pnpm build
```

Then run `/reload-plugins`. Repeat after each plugin update (the version directory changes). This is a known rough edge until the servers are published as packages.

**Check it works:** run `/mcp` and look for `plugin:gw2-ai:gw2-account`, `plugin:gw2-ai:gw2-data` and `plugin:gw2-ai:gw2-wiki`. Then ask something like "what's in my Wizard's Vault today?" or "what does a Glob of Ectoplasm sell for?". The skills are also available as `/gw2-ai:gw2-account`, `/gw2-ai:gw2-trading-and-crafting`, `/gw2-ai:gw2-goals` and `/gw2-ai:gw2-api`.

**API key for the plugin.** `gw2-data` and `gw2-wiki` need no key. `gw2-account` looks for one in this order:

1. The `GW2_API_KEY` environment variable of the shell that started Claude Code.
2. The plugin's `api_key` option. `/plugin` asks for it when you install or enable the plugin; change it later with `/plugin configure gw2-ai@gw2-ai`. It is marked sensitive, so Claude Code stores it in your system's credential store, not in `settings.json`.
3. The file `~/.config/gw2-ai/api-key` (`$XDG_CONFIG_HOME/gw2-ai/api-key` if that is set), written with mode 0600 by the server's `set-key` command: `node packages/mcp-account/dist/index.js set-key` (or `gw2-mcp-account set-key` if the package is on your `PATH`). A blank `GW2_API_KEY` counts as unset; a non-blank value that isn't a valid key is an error and does not fall back to the file.

### Claude Desktop and other MCP clients

Build a clone as above, then add the servers to your client's config with absolute paths. For Claude Desktop the file is `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "gw2-account": {
      "command": "node",
      "args": ["/absolute/path/to/gw2-ai/packages/mcp-account/dist/index.js"]
    },
    "gw2-data": {
      "command": "node",
      "args": ["/absolute/path/to/gw2-ai/packages/mcp-data/dist/index.js"]
    },
    "gw2-wiki": {
      "command": "node",
      "args": ["/absolute/path/to/gw2-ai/packages/mcp-wiki/dist/index.js"]
    }
  }
}
```

Give `gw2-account` its key with `set-key` (above). You can instead add `"env": { "GW2_API_KEY": "..." }` to its entry, but that leaves the key in plain text in the config file.

For Claude Code without the plugin: `claude mcp add --scope user gw2-data -- node /absolute/path/to/gw2-ai/packages/mcp-data/dist/index.js`, and the same for the other two. To use the skills without the plugin, copy the folders under `skills/` into `~/.claude/skills/`.

### Report site

The site is a static page that talks to the GW2 API directly from your browser; nothing goes through a server of ours. Once GitHub Pages is enabled for the repository it is served from `https://christopherdavenport.github.io/gw2-ai/`; locally, run `pnpm dev:site`.

1. Create an API key (see below) and save it on the page.
2. Pick the report sections you want and generate the report.
3. Copy or download the markdown and paste it into any AI chat. Ask questions about it, or load the skills so the assistant knows how to read it.

The report contains your account name, characters and holdings, so share it only with assistants you trust. It does not contain the API key.

## API keys

Create keys at https://account.arena.net/applications. The GW2 API is read-only: a key can't change anything on your account, but it does reveal what you own and do.

- **Use a dedicated key** for each tool (for example "gw2-ai site" and "gw2-ai claude"), so you can delete one without affecting the others.
- **Tick only the permissions you need.** `account` is always on. Permissions can't be changed later; create a new key instead.

  | Permission | Used for |
  | --- | --- |
  | wallet | gold and currencies |
  | inventories | bank, material storage, shared slots, legendary armory |
  | characters | character list, crafting levels, character bags |
  | builds | equipped gear, elite specs, templates |
  | progression | Wizard's Vault, world bosses, map chests, raids, achievements, masteries |
  | unlocks | skins, dyes, minis, recipes, legendary armory |
  | tradingpost | your buy and sell orders, history, delivery box |
  | guilds, pvp, wvw | guild storage (leaders), PvP stats, WvW rank and team |

- **Never paste a key into a chat.** Give it to the site or the MCP server instead.
- **Where it is stored:**
  - Site: in your browser's IndexedDB, encrypted with a non-extractable AES-GCM key held by the browser. Anyone who can run script on the page or use your unlocked browser profile can still decrypt it. Delete it from the page, or clear the site's data, when you're done.
  - Plugin option: your operating system's credential store.
  - `set-key`: `~/.config/gw2-ai/api-key` (or under `$XDG_CONFIG_HOME`), mode 0600.
  - Environment variable: wherever you set it (shell profile, client config).
- Delete a key on the applications page at any time; it stops working immediately.

## Development

```sh
pnpm install      # install all workspace packages
pnpm build        # build core, the MCP servers and the site
pnpm test         # run all tests
pnpm typecheck    # type-check every package
pnpm dev:site     # run the report site locally with Vite
```

Working in this repository, Claude Code picks up `.mcp.json`, which runs the three servers from `packages/*/dist` (build first). Check the plugin manifests with `claude plugin validate .`.

## Project layout

```
.claude-plugin/
  plugin.json        Claude Code plugin manifest (skills + three MCP servers)
  marketplace.json   lets `/plugin marketplace add` install this repo
.mcp.json            MCP servers for local development
packages/
  core/              GW2 API client, wiki client, markdown account report
  mcp-account/       MCP server for the player's account (needs an API key)
  mcp-data/          MCP server for items, recipes, prices, gem exchange, raw API
  mcp-wiki/          MCP server for wiki.guildwars2.com
site/                static report site (Vite)
skills/
  gw2-account/                 account questions; how to read a pasted report
  gw2-trading-and-crafting/    prices, flips, fees, craft vs buy, gem exchange
  gw2-goals/                   legendaries, collections, achievements, masteries
  gw2-api/                     writing code against the GW2 and wiki APIs
```

## License

MIT. See [LICENSE](LICENSE). Guild Wars 2 is a trademark of ArenaNet; this project is not affiliated with ArenaNet or NCSoft.
