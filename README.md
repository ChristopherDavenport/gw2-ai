# gw2-ai

Tools that let an AI assistant read Guild Wars 2 data quickly and correctly: your account (through the official API and your API key), game data and trading post prices, and the official wiki.

There are three ways to use it:

| Piece | What it is | Needs |
| --- | --- | --- |
| **Report site** (`site/`) | A static web page. Store your API key in the browser, generate a markdown report of your account, paste it into any AI chat. | A browser |
| **MCP servers** (`packages/mcp-*`) | Three servers any MCP client can run: `gw2-account` (your account and what to sell to raise gold, needs a key), `gw2-data` (items, recipes, crafting plans, prices, gem exchange, raw API), `gw2-wiki` (search and read wiki.guildwars2.com). | Node.js 22+ |
| **Skills** (`skills/`) | Instructions that teach Claude how to answer account questions, trade and craft, plan legendaries and collections, and write GW2 API code. They work with the MCP servers or with a pasted report. | Claude Code, or any client that loads skills |

The Claude Code plugin in this repository bundles the skills and the three servers.

## Quickstart

### Claude Code plugin

> **Experimental.** Releases are `0.0.x` while the tools and the `@gw2kit` library APIs settle; expect breaking changes between versions.

Inside Claude Code:

```
/plugin marketplace add ChristopherDavenport/gw2-ai
/plugin install gw2-ai@gw2-ai
```

The plugin runs each server with `npx -y @gw2-ai/mcp-<name>@<version>`, so the only requirement is Node.js 22+. There is nothing to build.

**Check it works:** run `/mcp` and look for `plugin:gw2-ai:gw2-account`, `plugin:gw2-ai:gw2-data` and `plugin:gw2-ai:gw2-wiki`. Then ask something like "what's in my Wizard's Vault today?" or "what does a Glob of Ectoplasm sell for?". The skills are also available as `/gw2-ai:gw2-account`, `/gw2-ai:gw2-trading-and-crafting`, `/gw2-ai:gw2-goals` and `/gw2-ai:gw2-api`.

**API key for the plugin.** `gw2-data` and `gw2-wiki` need no key. `gw2-account` looks for one in this order:

1. The `GW2_API_KEY` environment variable of the shell that started Claude Code.
2. The plugin's `api_key` option. `/plugin` asks for it when you install or enable the plugin; change it later with `/plugin configure gw2-ai@gw2-ai`. It is marked sensitive, so Claude Code stores it in your system's credential store, not in `settings.json`.
3. The file `~/.config/gw2-ai/api-key` (`$XDG_CONFIG_HOME/gw2-ai/api-key` if that is set), written with mode 0600 by `npx @gw2-ai/mcp-account set-key`. A blank `GW2_API_KEY` counts as unset; a non-blank value that isn't a valid key is an error and does not fall back to the file.

### Claude Desktop and other MCP clients

Add the servers to your client's config. For Claude Desktop the file is `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "gw2-account": { "command": "npx", "args": ["-y", "@gw2-ai/mcp-account"] },
    "gw2-data": { "command": "npx", "args": ["-y", "@gw2-ai/mcp-data"] },
    "gw2-wiki": { "command": "npx", "args": ["-y", "@gw2-ai/mcp-wiki"] }
  }
}
```

Give `gw2-account` its key once with `npx @gw2-ai/mcp-account set-key` (reads the key without echoing it, checks it, saves it with mode 0600). You can instead add `"env": { "GW2_API_KEY": "..." }` to its entry, but that leaves the key in plain text in the config file.

For Claude Code without the plugin: `claude mcp add --scope user gw2-data -- npx -y @gw2-ai/mcp-data`, and the same for the other two. To use the skills without the plugin, copy the folders under `skills/` into `~/.claude/skills/`.

### Using the client library

The servers are built on three libraries under the `@gw2kit` scope, usable on their own in Node or the browser:

- [`@gw2kit/client`](packages/client/README.md): the typed GW2 API client.
- [`@gw2kit/wiki`](packages/wiki/README.md): wiki client with typed Mystic Forge recipes and NPC vendor offers.
- [`@gw2kit/recipes`](packages/recipes/README.md): recipe trees and crafting plans across crafting, the Mystic Forge and vendors, with fetching separate from solving.

### Crafting plans

For a goal that takes weeks, such as a legendary, ask the assistant to plan it. One plan can make several things at once, counting the materials they share once, and goals can be added, resized or removed later. A plan is a JSON document that renders to markdown: recipe choices to make, time gates, what to earn, buy and make, and wiki excerpts for the parts with no known source. The assistant builds it up in steps: `gw2_plan_create`, then your answers to the open decisions, then `gw2_plan_holdings` to subtract what you own, then notes and progress with `gw2_plan_update`. Plans are saved as files in `~/.local/share/gw2-ai/plans/` (`$XDG_DATA_HOME/gw2-ai/plans/` if set), shared by `gw2-data` and `gw2-account`.

A model with no tools can work from the markdown pasted into a chat: the bottom of the plan shows a JSON update block (`choose`, `done`, `undone`, `notes`, `quantities`, `settings`) it can reply with.

### Raising gold

Ask "what can I sell?" or "I need 200g". `gw2_raise_gold` on `gw2-account` lists what to sell, how many and how, from material storage, the bank, shared slots and character bags, after the trading post's 15% fee. It works on its own or with a saved plan: then it holds back the materials the plan uses and aims at the gold the plan is short. It never sells anything, because the API is read-only; you make the sales in game.

Its limits:

- Sales are one step only. It does not refine, salvage or convert wallet currencies into gold first, even where that would pay more.
- Listed sales are not guaranteed: they pay only if a buyer takes them. Instant sales are priced from the buy orders of the moment.
- Bound items, equipped gear and guild storage are never considered. Legendary and Ascended items are never suggested. Gear and other non-materials only when asked.
- With a plan, only that plan's materials are held back, for the recipes currently chosen. Other saved plans are not protected.

### Report site

The site is a static page that talks to the GW2 API directly from your browser; nothing goes through a server of ours. Once GitHub Pages is enabled for the repository it is served from `https://christopherdavenport.github.io/gw2-ai/`; locally, run `pnpm dev:site`.

1. Create an API key (see below) and save it on the page.
2. Pick the report sections you want, and any characters whose build and equipment templates you want included, then generate the report. To set up a single character, pick only that character.
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
pnpm build        # build the libraries, core, the MCP servers and the site
pnpm test         # run all tests
pnpm typecheck    # type-check every package
pnpm dev:site     # run the report site locally with Vite
```

All GW2 API calls go through `@gw2kit/client`. Its route table types every `/v2` route, so the path, the parameters and the response are checked at compile time, and the key is attached only to routes that need one:

```ts
import { Gw2Client } from '@gw2kit/client';

const gw2 = new Gw2Client({ apiKey });
const account = await gw2.get('/v2/account');                                   // Account
const core = await gw2.get('/v2/characters/:id/core', { path: { id: 'Example Name' } });
const items = await gw2.many('/v2/items', [19721, 19976]);                      // Map<number, Item>
```

`gw2.raw(path)` is the untyped escape hatch; only the `gw2_api_get` and `gw2_account_get` MCP tools use it. After changing response types in `packages/client/src/types`, run `node scripts/verify-samples.mjs` to check them against captured responses.

Working in this repository, Claude Code picks up `.mcp.json`, which runs the three servers from `packages/*/dist` (build first). Check the plugin manifests with `claude plugin validate .`.

## Project layout

```
.claude-plugin/
  plugin.json        Claude Code plugin manifest (skills + three MCP servers)
  marketplace.json   lets `/plugin marketplace add` install this repo
.mcp.json            MCP servers for local development
packages/
  client/            @gw2kit/client: typed GW2 API client (every /v2 route), cache, rate limiter
  wiki/              @gw2kit/wiki: wiki client; Mystic Forge recipes and vendor offers from wiki data
  recipes/           @gw2kit/recipes: recipe trees and crafting plans (crafting, Mystic Forge, vendors); fetch and solve
  core/              @gw2-ai/core: markdown for models: account report, character pages, recipe trees, crafting plans, sales to raise gold
  mcp-account/       MCP server for the player's account (needs an API key)
  mcp-data/          MCP server for items, recipes, prices, gem exchange, raw API
  mcp-wiki/          MCP server for wiki.guildwars2.com
site/                static report site (Vite)
skills/
  gw2-account/                 account questions, raising gold; how to read a pasted report
  gw2-trading-and-crafting/    prices, flips, fees, craft vs buy, gem exchange
  gw2-goals/                   legendaries, collections, achievements, masteries
  gw2-api/                     writing code against the GW2 and wiki APIs
```

## License

MIT. See [LICENSE](LICENSE). Guild Wars 2 is a trademark of ArenaNet; this project is not affiliated with ArenaNet or NCSoft. The captured wiki responses in `packages/wiki/test/fixtures/` are not MIT: see the README there.
