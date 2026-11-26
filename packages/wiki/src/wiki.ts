import { MemoryCache, RateLimiter, TTL, sleep, type CacheStore } from '@gw2kit/client';

export const WIKI_BASE = 'https://wiki.guildwars2.com';
const API = `${WIKI_BASE}/api.php`;

export interface WikiSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WikiPage {
  title: string;
  url: string;
  /** Plain-text body; section headings come back as "== Heading ==". */
  text: string;
  truncated: boolean;
}

export interface MysticForgeIngredient {
  /** /v2/items id; absent when the ingredient's wiki page has no game id. */
  item_id?: number;
  /** Ingredient name as written in the recipe (normally its wiki page title). */
  name: string;
  count: number;
}

/**
 * A Mystic Forge recipe from the wiki's `{{Recipe}}` data. The official API
 * has no Mystic Forge recipes, so the wiki is the source for legendary gifts,
 * clovers and similar items.
 */
export interface MysticForgeRecipe {
  /** Recipe subobject, e.g. `Gift of Mastery#recipe1`. */
  subject: string;
  /** Recipe name, e.g. `Mystic Clover Average`; the page title when unnamed. */
  name: string;
  /** Wiki page that holds the recipe. */
  url: string;
  /** /v2/items id of the output. */
  output_item_id: number;
  /**
   * Units per forge. Fractional for chance-based recipes, where it is the
   * wiki's measured average (Mystic Clover: 0.31).
   */
  output_item_count: number;
  ingredients: MysticForgeIngredient[];
  /**
   * The wiki's "Can be queried for base ingredients" flag: true for recipes
   * fit for totalling materials. False for promotions, demotions and the
   * random-output forms whose average has its own recipe.
   */
  base: boolean;
}

export interface VendorCost {
  /**
   * Currency or item name as the wiki writes it: a wallet currency
   * (`Spirit Shard`, `Karma`, `Coin` in copper), sometimes plural
   * (`Trade Contracts`), or an item (`Glob of Ectoplasm`).
   */
  name: string;
  amount: number;
}

/** Purchase limits; absent when unlimited. */
export interface VendorCaps {
  daily?: number;
  weekly?: number;
  season?: number;
  character?: number;
  total?: number;
}

/** One vendor offer from the wiki's `{{Vendor table row}}` data. */
export interface VendorOffer {
  /** Offer subobject, e.g. `Miyani#vendor2`. */
  subject: string;
  /** Vendor NPC (its wiki page title). */
  vendor: string;
  url: string;
  /** Wiki page title of the item sold. */
  item: string;
  /** Units received per purchase. */
  quantity: number;
  /** Everything one purchase costs; several entries are all paid together. */
  costs: VendorCost[];
  caps: VendorCaps;
  /** Retired, temporary or unreleased offers. */
  historical: boolean;
}

/** TextExtracts returns at most this many introductions per query. */
const INTROS_PER_QUERY = 20;

/** Output ids per `ask` query: the wiki rejects queries of more than ~12 OR'd values. */
const FORGE_IDS_PER_QUERY = 10;
const FORGE_PRINTOUTS =
  '|?Has output game id|?Has output quantity|?Has ingredient with id|?Has canonical name|?Can be queried for base ingredients';

export interface WikiClientOptions {
  cache?: CacheStore;
  fetch?: typeof fetch;
  rateLimiter?: RateLimiter;
  /**
   * Sent outside browsers only. The wiki's load balancer rejects Node's
   * default agent with 403; in a browser a custom User-Agent would force a
   * CORS preflight, and the browser's own agent is accepted.
   */
  userAgent?: string;
}

const DEFAULT_USER_AGENT = 'gw2-ai/0.1 (Guild Wars 2 tools for AI assistants)';
const IN_BROWSER = typeof (globalThis as { document?: unknown }).document !== 'undefined';

/**
 * Client for the official GW2 wiki (MediaWiki with TextExtracts, CirrusSearch
 * and Semantic MediaWiki). `origin=*` makes every call CORS-safe in browsers.
 */
export class WikiClient {
  readonly #cache: CacheStore;
  readonly #fetch: typeof fetch;
  readonly #limiter: RateLimiter;
  readonly #headers: Record<string, string>;

  constructor(options: WikiClientOptions = {}) {
    this.#headers = { Accept: 'application/json' };
    if (!IN_BROWSER) this.#headers['User-Agent'] = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#cache = options.cache ?? new MemoryCache(2_000);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#limiter = options.rateLimiter ?? new RateLimiter(20, 120);
  }

  async search(query: string, limit = 10): Promise<WikiSearchHit[]> {
    const data = await this.#call<{
      query?: { search: { title: string; snippet: string }[] };
    }>({ action: 'query', list: 'search', srsearch: query, srlimit: limit, srnamespace: 0 });
    return (data.query?.search ?? []).map((h) => ({
      title: h.title,
      url: pageUrl(h.title),
      snippet: stripHtml(h.snippet),
    }));
  }

  /**
   * Page body as plain text, following redirects. `maxChars` keeps large
   * pages (e.g. legendary collections) from flooding a model's context.
   */
  async page(title: string, options: { maxChars?: number; intro?: boolean } = {}): Promise<WikiPage | null> {
    const data = await this.#call<{
      query?: { pages: Record<string, { title: string; missing?: string; extract?: string }> };
    }>({
      action: 'query',
      prop: 'extracts',
      explaintext: 1,
      exsectionformat: 'wiki',
      redirects: 1,
      titles: title,
      ...(options.intro ? { exintro: 1 } : {}),
    });
    const page = Object.values(data.query?.pages ?? {})[0];
    if (!page || page.missing !== undefined || page.extract === undefined) return null;
    const max = options.maxChars ?? 12_000;
    const text = page.extract.replace(/\n{3,}/g, '\n\n').trim();
    return {
      title: page.title,
      url: pageUrl(page.title),
      text: text.length > max ? text.slice(0, max) : text,
      truncated: text.length > max,
    };
  }

  /**
   * Plain-text introductions of several pages, 20 to a request, keyed by the
   * titles asked for. Missing pages are left out.
   */
  async intros(titles: readonly string[], options: { maxChars?: number } = {}): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const wanted = [...new Set(titles)].filter((t) => t && !t.includes('|'));
    for (let i = 0; i < wanted.length; i += INTROS_PER_QUERY) {
      const batch = wanted.slice(i, i + INTROS_PER_QUERY);
      const data = await this.#call<{
        query?: {
          normalized?: { from: string; to: string }[];
          redirects?: { from: string; to: string }[];
          pages: Record<string, { title: string; extract?: string }>;
        };
      }>({ action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, exlimit: 'max', redirects: 1, titles: batch.join('|') });
      const follow = (list: { from: string; to: string }[] | undefined, title: string) => list?.find((r) => r.from === title)?.to ?? title;
      const pages = new Map(Object.values(data.query?.pages ?? {}).map((p) => [p.title, p.extract]));
      for (const title of batch) {
        const extract = pages.get(follow(data.query?.redirects, follow(data.query?.normalized, title)))?.trim();
        if (extract) out.set(title, extract.slice(0, options.maxChars ?? 600));
      }
    }
    return out;
  }

  /**
   * One section of a page as rendered, with tables and template-generated
   * lists, which `page()` drops: where an item comes from is mostly in those.
   * Rows are `cell | cell` lines. Null when the page or section is missing.
   * `omit` names subsections to leave out (e.g. a long `Sold by` table).
   */
  async section(
    title: string,
    heading = 'Acquisition',
    options: { maxChars?: number; omit?: readonly string[] } = {},
  ): Promise<WikiPage | null> {
    const index = await this.#call<{ parse?: { title: string; sections: { line: string; index: string }[] } }>({
      action: 'parse',
      prop: 'sections',
      redirects: 1,
      page: title,
    }).catch((err: Error) => {
      // action=parse reports a missing page as an error.
      if (/doesn't exist/.test(err.message)) return undefined;
      throw err;
    });
    const wanted = index?.parse?.sections.find((s) => s.line.toLowerCase() === heading.toLowerCase());
    if (!index?.parse || !wanted) return null;
    const data = await this.#call<{ parse?: { text: { '*': string } } }>({
      action: 'parse',
      prop: 'text',
      redirects: 1,
      page: title,
      section: wanted.index,
      disableeditsection: 1,
      disablelimitreport: 1,
    });
    const html = data.parse?.text['*'];
    if (html === undefined) return null;
    const text = htmlToText(omitSubsections(html, options.omit ?? []));
    const max = options.maxChars ?? 4_000;
    return {
      title: index.parse.title,
      url: pageUrl(index.parse.title),
      text: text.slice(0, max),
      truncated: text.length > max,
    };
  }

  /**
   * Semantic MediaWiki query, e.g. `[[Has game id::19721]]|?Has context`.
   * Returns rows of {title, url, ...printouts}.
   */
  async ask(query: string, limit = 50): Promise<Record<string, unknown>[]> {
    const data = await this.#call<{
      query?: {
        results?: Record<string, { fulltext: string; fullurl: string; printouts: Record<string, unknown[]> }> | [];
      };
    }>({ action: 'ask', query: `${query}|limit=${limit}` });
    const results = data.query?.results;
    if (!results || Array.isArray(results)) return [];
    return Object.values(results).map((r) => {
      const row: Record<string, unknown> = { title: r.fulltext, url: r.fullurl };
      for (const [k, v] of Object.entries(r.printouts)) {
        row[k] = v.map((x) => (typeof x === 'object' && x && 'fulltext' in x ? (x as { fulltext: string }).fulltext : x));
      }
      return row;
    });
  }

  /** Wiki page titles for a game id (items, skills, traits, achievements...). */
  async titlesForGameId(id: number): Promise<string[]> {
    const rows = await this.ask(`[[Has game id::${id}]]`, 10);
    return rows.map((r) => String(r.title));
  }

  /**
   * Mystic Forge recipes that make any of `outputIds`, in batches of 10 ids
   * per query. Includes non-`base` recipes; filter on `base` for material
   * totals.
   */
  async mysticForgeRecipes(outputIds: Iterable<number>): Promise<MysticForgeRecipe[]> {
    const ids = [...new Set(outputIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += FORGE_IDS_PER_QUERY) chunks.push(ids.slice(i, i + FORGE_IDS_PER_QUERY));
    const results = await Promise.all(
      chunks.map((chunk) => this.#forgeQuery(`[[Has recipe source::Mystic forge]][[Has output game id::${chunk.join('||')}]]`, 200)),
    );
    return results.flat();
  }

  /** Mystic Forge recipes that take `itemId` as an ingredient. */
  async mysticForgeRecipesUsing(itemId: number, limit = 100): Promise<MysticForgeRecipe[]> {
    if (!Number.isInteger(itemId) || itemId <= 0) return [];
    return this.#forgeQuery(`[[Has recipe source::Mystic forge]][[Has ingredient with id::?;?;?;${itemId}]]`, limit);
  }

  /**
   * Wiki item page titles for item ids (`Has context::Item` pages only), in
   * batches of 10 ids. Ids without a page are missing from the map.
   */
  async itemPages(itemIds: Iterable<number>): Promise<Map<number, string>> {
    const ids = [...new Set(itemIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
    const out = new Map<number, string>();
    for (const chunk of chunked(ids, FORGE_IDS_PER_QUERY)) {
      const rows = await this.ask(`[[Has game id::${chunk.join('||')}]][[Has context::Item]]|?Has game id`, 50);
      for (const row of rows) {
        for (const id of (row['Has game id'] as unknown[] | undefined) ?? []) {
          const n = Number(id);
          if (chunk.includes(n) && !out.has(n)) out.set(n, String(row.title));
        }
      }
    }
    return out;
  }

  /**
   * Item ids for wiki item page titles (exact titles, `Has context::Item`),
   * in batches of 10. Titles that aren't item pages are missing from the map.
   */
  async itemIdsByTitle(titles: Iterable<string>): Promise<Map<string, number>> {
    const names = [...new Set(titles)].filter((t) => t && !/[[\]|{}]/.test(t));
    const out = new Map<string, number>();
    for (const chunk of chunked(names, FORGE_IDS_PER_QUERY)) {
      const rows = await this.ask(`[[${chunk.join('||')}]][[Has context::Item]]|?Has game id`, 50);
      for (const row of rows) {
        const id = Number((row['Has game id'] as unknown[] | undefined)?.[0]);
        if (id > 0) out.set(String(row.title), id);
      }
    }
    return out;
  }

  /**
   * Vendor offers for an item, by its wiki page title (see itemPages).
   * Includes historical offers; filter on `historical`. The wiki answers
   * these slowly (often 1-10 s), so query only the items you need.
   */
  async vendorOffers(itemTitle: string, limit = 200): Promise<VendorOffer[]> {
    if (!itemTitle || /[[\]|{}]/.test(itemTitle)) return [];
    const data = await this.#call<AskResponse>({
      action: 'ask',
      query:
        `[[Sells item::${itemTitle}]]|?Has vendor|?Sells item|?Has item quantity|?Has item cost|?Is historical` +
        `|?Has daily purchase cap|?Has weekly purchase cap|?Has seasonal purchase cap|?Has character purchase cap|?Has total purchase cap|limit=${limit}`,
    });
    const results = data.query?.results;
    if (!results || Array.isArray(results)) return [];
    const offers: VendorOffer[] = [];
    for (const [subject, row] of Object.entries(results)) {
      const offer = parseVendorOffer(subject, row.printouts, itemTitle);
      if (offer) offers.push(offer);
    }
    return offers;
  }

  async #forgeQuery(conditions: string, limit: number): Promise<MysticForgeRecipe[]> {
    const data = await this.#call<AskResponse>({ action: 'ask', query: `${conditions}${FORGE_PRINTOUTS}|limit=${limit}` });
    const results = data.query?.results;
    if (!results || Array.isArray(results)) return [];
    const recipes: MysticForgeRecipe[] = [];
    for (const [subject, row] of Object.entries(results)) {
      const recipe = parseForgeRecipe(subject, row.printouts);
      if (recipe) recipes.push(recipe);
    }
    return recipes;
  }

  async #call<T>(params: Record<string, string | number>): Promise<T> {
    const url = new URL(API);
    for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: 1, origin: '*' })) {
      url.searchParams.set(k, String(v));
    }
    const key = `wiki:${url.search}`;
    const hit = await this.#cache.get(key);
    if (hit !== undefined) return hit as T;

    const res = await this.#fetchWithRetry(url, String(params.action));
    const body = (await res.json()) as T & { error?: { info?: string } };
    if (body.error) throw new Error(`GW2 wiki error: ${body.error.info ?? 'unknown'}`);
    await this.#cache.set(key, body, TTL.static);
    return body;
  }

  /** The wiki is slow and returns occasional 503s under load; retry those. */
  async #fetchWithRetry(url: URL, action: string, retries = 2): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await this.#limiter.take();
      let res: Response;
      try {
        res = await this.#fetch(url, { headers: this.#headers });
      } catch (err) {
        if (attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new Error(`GW2 wiki network error for ${action}: ${(err as Error).message}`);
      }
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`GW2 wiki ${res.status} for ${action}`);
    }
  }
}

interface AskResponse {
  query?: { results?: Record<string, { printouts: Record<string, unknown[]> }> | [] };
}

/** A record printout field: `{ item: [...] }`. */
function field(record: unknown, key: string): unknown {
  const f = (record as Record<string, { item?: unknown[] } | undefined>)[key];
  const v = f?.item?.[0];
  return typeof v === 'object' && v !== null && 'fulltext' in v ? (v as { fulltext: string }).fulltext : v;
}

function first(printouts: Record<string, unknown[]>, key: string): unknown {
  const v = printouts[key]?.[0];
  return typeof v === 'object' && v !== null && 'fulltext' in v ? (v as { fulltext: string }).fulltext : v;
}

function parseForgeRecipe(subject: string, p: Record<string, unknown[]>): MysticForgeRecipe | undefined {
  const output = Number(first(p, 'Has output game id'));
  const count = Number(first(p, 'Has output quantity') ?? 1);
  if (!(output > 0) || !(count > 0)) return undefined;
  const ingredients = (p['Has ingredient with id'] ?? [])
    .map((rec) => ({
      index: Number(field(rec, 'Has ingredient index')),
      count: Number(field(rec, 'Has ingredient quantity')),
      name: String(field(rec, 'Has ingredient name') ?? ''),
      id: Number(field(rec, 'Has ingredient id')),
    }))
    .filter((i) => i.count > 0 && i.name)
    .sort((a, b) => a.index - b.index)
    .map((i): MysticForgeIngredient => (i.id > 0 ? { item_id: i.id, name: i.name, count: i.count } : { name: i.name, count: i.count }));
  if (!ingredients.length) return undefined;
  const page = subject.split('#')[0] ?? subject;
  const name = first(p, 'Has canonical name');
  return {
    subject,
    name: typeof name === 'string' && name ? name : page,
    url: pageUrl(page),
    output_item_id: output,
    output_item_count: count,
    ingredients,
    base: first(p, 'Can be queried for base ingredients') === 't',
  };
}

function chunked<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function parseVendorOffer(subject: string, p: Record<string, unknown[]>, itemTitle: string): VendorOffer | undefined {
  const costs = (p['Has item cost'] ?? [])
    .map((rec) => ({ name: String(field(rec, 'Has item currency') ?? '').trim(), amount: Number(field(rec, 'Has item value')) }))
    .filter((c) => c.name && c.amount > 0);
  if (!costs.length) return undefined;
  const vendor = String(first(p, 'Has vendor') ?? subject.split('#')[0] ?? subject);
  const cap = (key: string): number | undefined => {
    const n = Number(first(p, key));
    return n > 0 ? n : undefined;
  };
  const caps: VendorCaps = {};
  const daily = cap('Has daily purchase cap');
  const weekly = cap('Has weekly purchase cap');
  const season = cap('Has seasonal purchase cap');
  const character = cap('Has character purchase cap');
  const total = cap('Has total purchase cap');
  if (daily) caps.daily = daily;
  if (weekly) caps.weekly = weekly;
  if (season) caps.season = season;
  if (character) caps.character = character;
  if (total) caps.total = total;
  const quantity = Number(first(p, 'Has item quantity') ?? 1);
  return {
    subject,
    vendor,
    url: pageUrl(vendor),
    item: String(first(p, 'Sells item') ?? itemTitle),
    quantity: quantity > 0 ? quantity : 1,
    costs,
    caps,
    historical: first(p, 'Is historical') === 't',
  };
}

export function pageUrl(title: string): string {
  return `${WIKI_BASE}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Cut each named heading and everything up to the next heading. */
function omitSubsections(html: string, headings: readonly string[]): string {
  if (!headings.length) return html;
  const drop = new Set(headings.map((h) => h.toLowerCase()));
  return html
    .split(/(?=<h[1-6]\b)/i)
    .filter((part) => {
      const heading = /^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(part);
      return !heading || !drop.has(htmlToText(heading[2]!).toLowerCase());
    })
    .join('');
}

/** Rendered wiki HTML as plain lines: headings, list items and table rows. */
export function htmlToText(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'", '#039': "'", times: '×' };
  return html
    .replace(/<(style|script|sup)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Long sections render their own table of contents; mark its entries to drop.
    .replace(/<span class="tocnumber">/g, '\u0000')
    .replace(/\s+/g, ' ')
    .replace(/<\/t[dh]>\s*(?=<t[dh]\b)/gi, ' | ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(p|div|tr|table|ul|ol|dl|dt|dd|h[1-6]|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, name: string) =>
      entities[name] ?? (/^#\d+$/.test(name) ? String.fromCodePoint(Number(name.slice(1))) : m),
    )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && line !== '-' && line !== 'Contents' && !line.includes('\u0000'))
    .join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
