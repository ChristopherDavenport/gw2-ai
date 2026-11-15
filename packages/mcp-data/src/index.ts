#!/usr/bin/env node
import { Gw2Client, WikiClient } from '@gw2-ai/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as tools from './tools.js';
import { MAX_OUTPUT, READ_ONLY, log, run } from './util.js';


const VERSION = '0.1.0';

export function createServer(): McpServer {
  // No key, ever: this server only reads public endpoints.
  const client = new Gw2Client();
  const wiki = new WikiClient();

  const server = new McpServer(
    { name: 'gw2-data', version: VERSION },
    {
      instructions:
        'Public Guild Wars 2 game data (no API key): items, trading post prices and order books, crafting trees, gem exchange, achievements. ' +
        'Find item ids with gw2_item_search first, then pass ids to the other tools. Coin amounts are written g/s/c (1g = 100s = 10,000c). ' +
        'For account data (bank, characters, wallet) use the gw2-account server; for wiki text use gw2-wiki.',
    },
  );

  const itemId = z.number().int().positive();

  server.registerTool(
    'gw2_item',
    {
      title: 'Item details',
      description:
        'Full details for up to 50 items by id: type/subtype, rarity, level, flags (account bound, soulbound, no sell...), stats with the stat set name ' +
        '(e.g. Berserker\'s) or the list of selectable stats, upgrade/infusion slots, rune bonuses, consumable effects, vendor value, chat link, ' +
        'current trading post buy/sell, and a wiki link. Use when you have item ids (from gw2_item_search, account tools or recipes). ' +
        'Cost: 2-4 API calls total regardless of how many ids.',
      inputSchema: { ids: z.array(itemId).min(1).max(50).describe('Item ids, e.g. [19721] for Glob of Ectoplasm.') },
      annotations: READ_ONLY,
    },
    ({ ids }) => run(() => tools.itemDetails(client, ids)),
  );

  server.registerTool(
    'gw2_item_search',
    {
      title: 'Find items by name',
      description:
        'Turn an item name (or part of one) into GW2 item ids, with type, rarity, level and current TP sell price. ' +
        'Use this first whenever the user names an item. Searches the wiki\'s item index (fast, 1-4 wiki calls plus 2 API calls). ' +
        'Matching is a substring match on the wiki page name; several items can share a name (check type/rarity). ' +
        'Set exhaustive: true only if the wiki finds nothing: it scans all ~70k items (~370 API calls, minutes on first use, cached afterwards).',
      inputSchema: {
        query: z.string().min(2).max(100).describe('Item name or part of it, e.g. "Mystic Clover".'),
        limit: z.number().int().min(1).max(100).default(20),
        exhaustive: z.boolean().default(false).describe('Scan the whole item list instead of the wiki (slow).'),
      },
      annotations: READ_ONLY,
    },
    ({ query, limit, exhaustive }) => run(() => tools.itemSearch(client, wiki, query, limit, exhaustive)),
  );

  server.registerTool(
    'gw2_prices',
    {
      title: 'Trading post prices',
      description:
        'Current trading post prices for up to 200 items: highest buy order, lowest sell listing, spread, demand/supply, ' +
        'flip profit per unit after the 15% sell fee (5% listing + 10% exchange), ROI and break-even listing price. ' +
        'Use for "how much is X worth", "is X worth flipping", or valuing a list of items. Cost: 2 API calls. Prices are cached for 1 minute.',
      inputSchema: { item_ids: z.array(itemId).min(1).max(200) },
      annotations: READ_ONLY,
    },
    ({ item_ids }) => run(() => tools.prices(client, item_ids)),
  );

  server.registerTool(
    'gw2_listings',
    {
      title: 'Trading post order book',
      description:
        'Order book for one item: sell listings (cheapest first) and buy orders (highest first) per price level with quantities and cumulative depth. ' +
        'Use to see how much buying or selling N units would really cost, beyond the single best price from gw2_prices. Cost: 2 API calls.',
      inputSchema: {
        item_id: itemId,
        depth: z.number().int().min(1).max(100).default(10).describe('Price levels per side.'),
      },
      annotations: READ_ONLY,
    },
    ({ item_id, depth }) => run(() => tools.listings(client, item_id, depth)),
  );

  server.registerTool(
    'gw2_recipe_tree',
    {
      title: 'Crafting tree and cost',
      description:
        'Full crafting tree for N of an item: every component with its recipe (discipline and minimum rating), a buy-vs-craft decision per node at ' +
        'current TP prices, the cheapest total, the shopping list of materials to buy, and raw materials if you craft everything. ' +
        'Mystic Forge recipes (most legendary gifts, clovers) are NOT in the API: those show as unpriced leaves with a wiki link. ' +
        'For "what do I still need given what I own", use gw2_shopping_list on the gw2-account server. ' +
        'Cost: about 1 API call per distinct component plus a few batched calls (5-150 calls; cached for a day except prices).',
      inputSchema: {
        item_id: itemId,
        quantity: z.number().int().min(1).max(10_000).default(1),
        expand_all: z
          .boolean()
          .default(false)
          .describe('Also expand components that are cheaper to buy than to craft.'),
      },
      annotations: READ_ONLY,
    },
    ({ item_id, quantity, expand_all }) => run(() => tools.recipeTree(client, item_id, quantity, expand_all)),
  );

  server.registerTool(
    'gw2_recipes_using',
    {
      title: 'Recipes that use an item',
      description:
        'What an item is an ingredient in: each crafting recipe that consumes it, with the output item, how many it uses, discipline and rating. ' +
        'Use for "what can I make with X" or "why is X expensive". Mystic Forge recipes are not included. Cost: 3+ API calls (common materials appear in hundreds of recipes).',
      inputSchema: {
        item_id: itemId,
        limit: z.number().int().min(1).max(500).default(50),
      },
      annotations: READ_ONLY,
    },
    ({ item_id, limit }) => run(() => tools.recipesUsing(client, item_id, limit)),
  );

  server.registerTool(
    'gw2_gem_exchange',
    {
      title: 'Gem exchange rates',
      description:
        'Current currency exchange: how much gold you get for selling `gems`, and how many gems you get for `coins` (in copper; 10000 = 1 gold). ' +
        'Defaults to 400 gems and 100 gold. Use for "how much gold is X gems" or "how many gems can I buy with Y gold". Cost: 2 API calls.',
      inputSchema: {
        gems: z.number().int().min(1).max(100_000).default(400).describe('Gems to sell for gold.'),
        coins: z.number().int().min(1).max(10_000_000_000).default(1_000_000).describe('Copper to spend on gems (10000 = 1g).'),
      },
      annotations: READ_ONLY,
    },
    ({ gems, coins }) => run(() => tools.gemExchange(client, gems, coins)),
  );

  server.registerTool(
    'gw2_achievement',
    {
      title: 'Achievement details',
      description:
        'Details for up to 50 achievements by id: description, requirement, unlock text, tiers and AP, prerequisites, rewards (items, titles, mastery, gold, ' +
        'resolved to names) and objectives/bits (items, skins, minis resolved to names, with hints). Use for collection achievements and "what do I need for X". ' +
        'Find ids with gw2_wiki_by_id / gw2_wiki_search or the account report. Cost: 2-6 API calls.',
      inputSchema: { ids: z.array(z.number().int().positive()).min(1).max(50) },
      annotations: READ_ONLY,
    },
    ({ ids }) => run(() => tools.achievements(client, ids)),
  );

  server.registerTool(
    'gw2_api_get',
    {
      title: 'Raw public API request',
      description:
        'Escape hatch: GET any public GW2 API v2 endpoint and return JSON, e.g. /v2/skins, /v2/specializations, /v2/worldbosses, /v2/wvw/matches, ' +
        '/v2/legends, /v2/build. With `ids`, fetches those ids in batches of 200 (path must be a bulk endpoint). No API key is ever sent; ' +
        'for account endpoints use gw2_account_get on gw2-account. Prefer the dedicated tools when one fits. Output is truncated at max_chars. ' +
        'Endpoint list: https://wiki.guildwars2.com/wiki/API:Main. Cost: 1+ API calls.',
      inputSchema: {
        path: z.string().min(2).max(300).describe('Path such as /v2/skins or /v2/achievements/daily. No query string.'),
        ids: z.array(z.union([z.number().int(), z.string().max(100)])).max(1000).optional(),
        params: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Query parameters, e.g. {"page": 0, "page_size": 50}.'),
        max_chars: z.number().int().min(1000).max(100_000).default(MAX_OUTPUT),
      },
      annotations: READ_ONLY,
    },
    ({ path, ids, params, max_chars }) => run(() => tools.apiGet(client, path, ids, params, max_chars)),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  log(`gw2-data ${VERSION} ready on stdio`);
}

main().catch((err: unknown) => {
  log('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
