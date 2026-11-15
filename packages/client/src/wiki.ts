import { MemoryCache, TTL, type CacheStore } from './cache.js';
import { RateLimiter, sleep } from './rate-limit.js';

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

export function pageUrl(title: string): string {
  return `${WIKI_BASE}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
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
