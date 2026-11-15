#!/usr/bin/env node
import { WikiClient, pageUrl } from '@gw2kit/wiki';
import { fmt } from '@gw2-ai/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const VERSION = '0.1.0';
const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

function log(...args: unknown[]): void {
  console.error('[gw2-wiki]', ...args);
}

async function run(body: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: await body() }] };
  } catch (err) {
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

/** Strip characters that would break out of an SMW condition. */
function smwEscape(text: string): string {
  return text.replace(/[[\]|{}\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

function printoutCell(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : String(v ?? '');
}

export function createServer(): McpServer {
  const wiki = new WikiClient();
  const server = new McpServer(
    { name: 'gw2-wiki', version: VERSION },
    {
      instructions:
        'The official Guild Wars 2 wiki (wiki.guildwars2.com): search, read pages as plain text, run Semantic MediaWiki queries, and map game ids to pages. ' +
        'Use it for mechanics, guides, Mystic Forge recipes, collection steps, lore and anything the API lacks. Use gw2-data for live prices and item stats.',
    },
  );

  server.registerTool(
    'gw2_wiki_search',
    {
      title: 'Search the GW2 wiki',
      description:
        'Full-text search of the official GW2 wiki. Returns page titles, URLs and a text snippet per hit. Use when you need a page title for ' +
        'gw2_wiki_page, or to find guides, mechanics, events, collections and Mystic Forge recipes. Case-insensitive. Cost: 1 wiki call.',
      inputSchema: {
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: READ_ONLY,
    },
    ({ query, limit }) =>
      run(async () => {
        const hits = await wiki.search(query, limit);
        if (!hits.length) return `No wiki pages match "${query}".`;
        return [`# Wiki search: "${query}"`, '', ...hits.map((h) => `- **${h.title}** (${h.url}): ${h.snippet}`)].join('\n');
      }),
  );

  server.registerTool(
    'gw2_wiki_page',
    {
      title: 'Read a GW2 wiki page',
      description:
        'A wiki page as plain text (section headings as "== Heading =="), following redirects. Use intro_only for a short summary; ' +
        'full pages can be long (legendary collections, map pages), so output is cut at max_chars with a note. ' +
        'Needs the exact title (case matters after the first letter); if it is not found, closest search hits are suggested. Cost: 1-2 wiki calls.',
      inputSchema: {
        title: z.string().min(1).max(255).describe('Exact page title, e.g. "Glob of Ectoplasm".'),
        max_chars: z.number().int().min(500).max(60_000).default(12_000),
        intro_only: z.boolean().default(false).describe('Only the lead section before the first heading.'),
      },
      annotations: READ_ONLY,
    },
    ({ title, max_chars, intro_only }) =>
      run(async () => {
        const page = await wiki.page(title, { maxChars: max_chars, intro: intro_only });
        if (!page) {
          const hits = await wiki.search(title, 5);
          const suggest = hits.length ? ` Closest pages: ${hits.map((h) => `"${h.title}"`).join(', ')}.` : '';
          return `No wiki page titled "${title}".${suggest}`;
        }
        const note = page.truncated
          ? `\n\n[Truncated at ${max_chars.toLocaleString('en-US')} characters. Raise max_chars (up to 60000) or use intro_only.]`
          : '';
        return `# ${page.title}\n\n${page.url}\n\n${page.text || '_(empty page)_'}${note}`;
      }),
  );

  server.registerTool(
    'gw2_wiki_ask',
    {
      title: 'Semantic MediaWiki query',
      description:
        'Run a raw Semantic MediaWiki #ask query against the wiki: conditions in [[...]] then |?Property printouts. Returns a table of page titles and printouts. ' +
        'Use for structured lookups the API cannot do. Examples: ' +
        '`[[Has game id::19721]]|?Has context` (what has game id 19721); ' +
        '`[[Has context::Item]][[~*Mystic Clover*]]|?Has game id` (item pages whose title contains "Mystic Clover"; ~ matching is case-sensitive); ' +
        '`[[Category:Legendary weapons]]|?Has game id` (members of a category with their ids). ' +
        'Do not add |limit=; use `limit`. Cost: 1 wiki call.',
      inputSchema: {
        query: z.string().min(3).max(1000),
        limit: z.number().int().min(1).max(500).default(50),
      },
      annotations: READ_ONLY,
    },
    ({ query, limit }) =>
      run(async () => {
        const rows = await wiki.ask(query.replace(/\|\s*limit\s*=\s*\d+/gi, ''), limit);
        if (!rows.length) return `No results for \`${query}\`. Check property names and capitalisation (~ matches are case-sensitive).`;
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k !== 'title' && k !== 'url')))];
        const table = fmt.table(
          ['Page', ...keys],
          rows.map((r) => [r.title, ...keys.map((k) => printoutCell(r[k]))]),
        );
        const more = rows.length >= limit ? `\n\nShowing the first ${limit}; raise \`limit\` for more.` : '';
        return `${rows.length} result(s). Page URLs are https://wiki.guildwars2.com/wiki/<title with spaces as underscores>.${more}\n\n${table}`;
      }),
  );

  server.registerTool(
    'gw2_wiki_by_id',
    {
      title: 'Wiki page for a game id',
      description:
        'Map a GW2 API id (item, skill, trait, achievement, specialization...) to its wiki page title(s), with each page\'s intro text. ' +
        'Pass `context` to disambiguate, because the same number is used by different kinds of things (item 5 and specialization 5 are unrelated). ' +
        'Common contexts: Item, Skill, Trait, Specialization, Achievement, Achievement category, Effect, Location. Cost: 1 + up to 5 wiki calls.',
      inputSchema: {
        id: z.number().int().positive(),
        context: z.string().max(50).optional().describe('e.g. "Item", "Skill", "Trait", "Achievement".'),
      },
      annotations: READ_ONLY,
    },
    ({ id, context }) =>
      run(async () => {
        const cond = context ? `[[Has context::${smwEscape(context)}]]` : '';
        const rows = await wiki.ask(`[[Has game id::${id}]]${cond}|?Has context`, 20);
        if (!rows.length) {
          return `No wiki page has game id ${id}${context ? ` with context ${context}` : ''}. Try without context, or gw2_wiki_search by name.`;
        }
        const pages = await Promise.all(
          rows.slice(0, 5).map(async (r) => {
            const title = String(r.title);
            const ctx = printoutCell(r['Has context']);
            const base = title.split('#')[0] ?? title;
            const page = await wiki.page(base, { intro: true, maxChars: 1_500 }).catch(() => null);
            const intro = page?.text ? `\n\n${page.text}${page.truncated ? ' […]' : ''}` : '';
            return `## ${title} (${ctx || 'unknown context'})\n\n${pageUrl(base)}${intro}`;
          }),
        );
        const more = rows.length > 5 ? `\n\n${rows.length - 5} more: ${rows.slice(5).map((r) => `${String(r.title)} (${printoutCell(r['Has context'])})`).join(', ')}` : '';
        return `# Wiki pages for game id ${id}\n\n${pages.join('\n\n')}${more}`;
      }),
  );

  return server;
}

async function main(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
  log(`gw2-wiki ${VERSION} ready on stdio`);
}

main().catch((err: unknown) => {
  log('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
