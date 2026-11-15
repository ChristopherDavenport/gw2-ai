#!/usr/bin/env node
import { Gw2ApiError, Gw2Client } from '@gw2kit/client';
import { WikiClient } from '@gw2kit/wiki';
import { SECTIONS, SECTION_IDS, buildReport } from '@gw2-ai/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadApiKey, setupHelp } from './key.js';
import { ACCOUNT_PATH_HELP } from './paths.js';
import { setKeyCommand } from './set-key.js';
import * as tools from './tools.js';

const VERSION = '0.1.0';
const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/** Log to stderr; stdout carries the MCP transport. Never pass the key here. */
function log(...args: unknown[]): void {
  console.error('[gw2-account]', ...args);
}

class NoKeyError extends Error {}

let cached: { key: string; client: Gw2Client } | undefined;

/** Public wiki, for Mystic Forge recipes. It never sees the API key. */
const wiki = new WikiClient();

/** Client for the configured key, re-read on each call so `set-key` applies without a restart. */
async function currentClient(): Promise<Gw2Client> {
  const load = await loadApiKey();
  if (!load.ok) {
    cached = undefined;
    throw new NoKeyError(`${load.message}\n\n${setupHelp()}`);
  }
  if (cached?.key !== load.key) cached = { key: load.key, client: new Gw2Client({ apiKey: load.key }) };
  return cached.client;
}

async function withClient(body: (client: Gw2Client) => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: await body(await currentClient()) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: errorText(err) }], isError: true };
  }
}

function errorText(err: unknown): string {
  if (err instanceof Gw2ApiError && err.status === 400 && /invalid key|invalid access token/i.test(err.text)) {
    return `The GW2 API rejected the configured key (${err.text}): it is wrong, deleted or expired.\n\n${setupHelp()}`;
  }
  if (err instanceof Gw2ApiError && err.isAuthError) {
    return `${err.message}\n\nThe API key was rejected or lacks a permission for this endpoint. Run gw2_key_info to see what it can access.`;
  }
  if (err instanceof Gw2ApiError && err.status === 404) return `Not found: ${err.path} (${err.text}).`;
  return err instanceof Error ? err.message : String(err);
}

const sectionList = SECTIONS.map((s) => `${s.id} (${s.summary.replace(/\.$/, '')})`).join('; ');

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'gw2-account', version: VERSION },
    {
      instructions:
        'Guild Wars 2 account data via the player\'s API key: report, item locations, characters and builds, crafting shopping lists. ' +
        'Start with gw2_key_info if unsure what the key allows. Never ask the user to paste their API key into the chat; if none is configured, ' +
        'tell them to run `gw2-mcp-account set-key` in a terminal. Account data can lag the game by up to ~5 minutes. ' +
        'Use gw2-data for public item/price lookups and gw2-wiki for wiki pages.',
    },
  );

  server.registerTool(
    'gw2_key_info',
    {
      title: 'API key permissions',
      description:
        'Shows the configured API key\'s name and permissions, what each permission unlocks, which gw2_account_report sections and tools will work, ' +
        'and which are skipped. Call this first when a tool reports a permission error, or when no key is configured (it explains how to set one up). Cost: 1 API call.',
      annotations: READ_ONLY,
    },
    () => withClient((c) => tools.keyInfo(c)),
  );

  server.registerTool(
    'gw2_account_report',
    {
      title: 'Account report',
      description:
        'Markdown report of the account, by section. Use for broad questions ("what is my account worth", "summarize my progress") and pick only the sections you need. ' +
        `Sections: ${sectionList}. ` +
        'Starts with an "At a glance" block of precomputed totals (wealth, Wizard\'s Vault, lockouts, trading post); prefer those over summing tables. ' +
        'detail "summary" (default) shows the most valuable rows of long lists and the rest as compact `Name ×count` lines; "full" puts every row in tables. ' +
        'Sections the key lacks permissions for are skipped with a note. valuation prices items at TP buy orders (extra calls). ' +
        'Cost: 2-10 API calls per section; a full report is ~12k tokens in summary mode, so prefer specific sections.',
      inputSchema: {
        sections: z
          .array(z.enum(SECTION_IDS as [string, ...string[]]))
          .min(1)
          .optional()
          .describe('Section ids to include; all when omitted.'),
        valuation: z.boolean().default(true).describe('Add trading post values to items and materials.'),
        detail: z
          .enum(['summary', 'full'])
          .default('summary')
          .describe('summary: top rows in tables, the rest as compact lines. full: every row in tables (much longer).'),
        max_rows: z.number().int().min(5).max(1000).default(200).describe('Max rows in long tables when detail is full.'),
        characters: z
          .array(z.string().min(1).max(100))
          .max(20)
          .optional()
          .describe('Exact character names to add a "Character: <name>" section for, with every build and equipment template. Prefer gw2_character for a single character.'),
      },
      annotations: READ_ONLY,
    },
    ({ sections, valuation, detail, max_rows, characters }) =>
      withClient(async (c) => {
        const report = await buildReport(c, {
          ...(sections ? { sections } : {}),
          ...(characters ? { characters } : {}),
          valuation,
          detail,
          maxRows: max_rows,
        });
        return report.markdown;
      }),
  );

  server.registerTool(
    'gw2_find_item',
    {
      title: 'Find an item on the account',
      description:
        'Where the account holds an item: bank, shared inventory slots, each character\'s bags and equipped gear, material storage and legendary armory, with counts per location. ' +
        'Pass item_id for an exact item, or query to match names (case-insensitive substring) among items the account holds; no global item search needed. ' +
        'Use for "do I have X", "where is my X", "how many X do I own". Needs `inventories` (plus `characters` for bags). Cost: ~5-8 API calls.',
      inputSchema: {
        query: z.string().min(2).max(100).optional().describe('Part of the item name, e.g. "ectoplasm".'),
        item_id: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ_ONLY,
    },
    ({ query, item_id, limit }) =>
      withClient(async (c) => {
        if (query === undefined && item_id === undefined) throw new Error('Pass either query or item_id.');
        return tools.findItem(c, query, item_id, limit);
      }),
  );

  server.registerTool(
    'gw2_character',
    {
      title: 'Character details',
      description:
        'One character in detail: profession, level, race, playtime, crafting disciplines; every build template (specializations with chosen trait names, heal/utility/elite skill names, legends or pets) ' +
        'and every equipment template (item, rarity, stat set such as Berserker\'s, runes/sigils/infusions, PvP amulet/rune/sigils), with the active ones marked; and bag usage. ' +
        'Templates identical to an earlier one are shown as "Same ... as template N". ' +
        'Use for setting up or reviewing a character, build checks, gear audits, "what is my X wearing". The name is case-sensitive; an unknown name returns the list of characters. ' +
        'Needs `characters`; `builds` adds templates, `inventories` adds bags (missing ones are reported). Cost: ~6-10 API calls.',
      inputSchema: {
        name: z.string().min(1).max(100).describe('Exact character name.'),
        templates: z
          .enum(['all', 'active'])
          .default('all')
          .describe('all: every build and equipment template. active: only the ones in use (shorter).'),
      },
      annotations: READ_ONLY,
    },
    ({ name, templates }) => withClient((c) => tools.character(c, name, templates)),
  );

  server.registerTool(
    'gw2_shopping_list',
    {
      title: 'Crafting shopping list',
      description:
        'What the account still needs to buy to craft N of an item: the recipe tree with a buy-vs-craft choice per component, minus what the account already holds ' +
        '(material storage, bank, shared slots, character bags; intermediates are used first), priced at current TP sell listings. ' +
        'Mystic Forge recipes (legendary weapons and gifts, clovers) come from the GW2 wiki; chance-based forges use the wiki\'s average yield. ' +
        'Items with no recipe and no TP price are priced at NPC vendors (from the wiki) in wallet currencies; with `wallet`, a table compares the currencies needed with the balances. ' +
        'Leaves with no recipe, TP price or vendor (rewards, drops) are listed separately with wiki links. ' +
        'Use for "what do I need for X", "how much more gold to craft X". Needs `inventories`. Cost: the recipe tree (about 1 call per distinct component, plus wiki lookups that take 10-60 s for a legendary) and ~6 account calls.',
      inputSchema: {
        item_id: z.number().int().positive(),
        quantity: z.number().int().min(1).max(10_000).default(1),
      },
      annotations: READ_ONLY,
    },
    ({ item_id, quantity }) => withClient((c) => tools.shoppingList(c, wiki, item_id, quantity)),
  );

  server.registerTool(
    'gw2_account_get',
    {
      title: 'Raw account API request',
      description:
        `Escape hatch: GET any authenticated endpoint under ${ACCOUNT_PATH_HELP} and return the JSON (truncated at max_chars). ` +
        'Examples: /v2/account/wallet, /v2/account/achievements, /v2/account/dailycrafting, /v2/account/wizardsvault/weekly, /v2/characters/<name>/inventory, ' +
        '/v2/commerce/transactions/history/sells, /v2/pvp/stats. Prefer the dedicated tools when one fits; ids in the JSON can be resolved with gw2-data tools. ' +
        'Endpoint list: https://wiki.guildwars2.com/wiki/API:Main. Cost: 1 API call.',
      inputSchema: {
        path: z.string().min(2).max(300).describe('e.g. /v2/account/wallet. No query string; use params.'),
        params: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Query parameters, e.g. {"page": 0, "page_size": 50}.'),
        max_chars: z.number().int().min(1000).max(100_000).default(24_000),
      },
      annotations: READ_ONLY,
    },
    ({ path, params, max_chars }) => withClient((c) => tools.accountGet(c, path, params, max_chars)),
  );

  return server;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'set-key') {
    process.exitCode = await setKeyCommand();
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(
      'Usage:\n  gw2-mcp-account           run the MCP server on stdio\n  gw2-mcp-account set-key   store a GW2 API key (read from stdin without echo)\n',
    );
    return;
  }
  if (command) {
    process.stderr.write(`Unknown command "${command}". Try --help.\n`);
    process.exitCode = 2;
    return;
  }
  await createServer().connect(new StdioServerTransport());
  const load = await loadApiKey();
  log(`gw2-account ${VERSION} ready on stdio; ${load.ok ? `API key loaded from ${load.source === 'env' ? 'GW2_API_KEY' : load.path}` : load.message}`);
}

main().catch((err: unknown) => {
  log('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
