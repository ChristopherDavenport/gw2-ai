import { MemoryCache, TTL, type CacheStore } from './cache.js';
import { RateLimiter, sleep } from './rate-limit.js';

export const API_BASE = 'https://api.guildwars2.com';

/**
 * Pinned response schema. Newer schemas change field layouts, so the types in
 * types.ts are written against this version. 2025-08-29 is the latest as of
 * writing (see https://api.guildwars2.com/v2.json?v=latest).
 */
export const SCHEMA_VERSION = '2025-08-29T01:00:00.000Z';

/** The API rejects `ids=` lists longer than this. */
export const MAX_IDS_PER_REQUEST = 200;

export type Lang = 'en' | 'es' | 'de' | 'fr' | 'zh';

export type Params = Record<string, string | number | boolean | undefined>;

export interface Gw2ClientOptions {
  /** API key from https://account.arena.net/applications. Required only for authenticated endpoints. */
  apiKey?: string;
  lang?: Lang;
  schemaVersion?: string;
  cache?: CacheStore;
  /** Injected for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  rateLimiter?: RateLimiter;
  /** Parallel requests when splitting large id lists. */
  concurrency?: number;
  maxRetries?: number;
}

export interface RequestOptions {
  params?: Params;
  /** Cache lifetime in ms. 0 disables caching for this call. */
  ttlMs?: number;
  /** Send the API key. Defaults to true for /v2/account*, /v2/characters*, etc. */
  auth?: boolean;
}

/**
 * Error from the API. The message is built from the path only, never the full
 * URL, so the access token (sent as a query parameter) cannot leak into logs.
 */
export class Gw2ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly text: string,
  ) {
    super(`GW2 API ${status} on ${path}: ${text}`);
    this.name = 'Gw2ApiError';
  }

  /** True when the key is missing, invalid, or lacks a permission. */
  get isAuthError(): boolean {
    // A malformed or revoked key comes back as 400 "invalid key".
    return this.status === 401 || this.status === 403 || (this.status === 400 && /key|token/i.test(this.text));
  }
}

const AUTH_PREFIXES = [
  '/v2/account',
  '/v2/characters',
  '/v2/commerce/delivery',
  '/v2/commerce/transactions',
  '/v2/tokeninfo',
  '/v2/createsubtoken',
  '/v2/pvp/games',
  '/v2/pvp/standings',
  '/v2/pvp/stats',
];

function requiresAuth(path: string): boolean {
  return (
    AUTH_PREFIXES.some((p) => path === p || path.startsWith(p + '/')) ||
    /^\/v2\/guild\/[^/]+(\/|$)/.test(path) && !/^\/v2\/guild\/(search|permissions|upgrades)/.test(path)
  );
}

export class Gw2Client {
  readonly lang: Lang;
  readonly hasKey: boolean;
  readonly #apiKey: string | undefined;
  readonly #schema: string;
  readonly #cache: CacheStore;
  readonly #fetch: typeof fetch;
  readonly #limiter: RateLimiter;
  readonly #concurrency: number;
  readonly #maxRetries: number;
  /** Scopes cached authenticated responses to this client (and so this key). */
  readonly #authScope = Math.random().toString(36).slice(2);
  readonly #inflight = new Map<string, Promise<unknown>>();

  constructor(options: Gw2ClientOptions = {}) {
    const key = options.apiKey?.trim();
    this.#apiKey = key ? key : undefined;
    this.hasKey = this.#apiKey !== undefined;
    this.lang = options.lang ?? 'en';
    this.#schema = options.schemaVersion ?? SCHEMA_VERSION;
    this.#cache = options.cache ?? new MemoryCache();
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#limiter = options.rateLimiter ?? new RateLimiter();
    this.#concurrency = options.concurrency ?? 4;
    this.#maxRetries = options.maxRetries ?? 3;
  }

  /** GET a single endpoint. Concurrent identical requests share one fetch. */
  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? requiresAuth(path);
    const ttl = options.ttlMs ?? (auth ? 0 : TTL.static);
    const params: Params = { ...options.params, lang: this.lang };
    const key = this.#cacheKey(path, params, auth);

    if (ttl > 0) {
      const hit = await this.#cache.get(key);
      if (hit !== undefined) return hit as T;
    }
    const pending = this.#inflight.get(key);
    if (pending) return pending as Promise<T>;

    const request = this.#request<T>(path, params, auth).then(async (value) => {
      if (ttl > 0) await this.#cache.set(key, value, ttl);
      return value;
    });
    this.#inflight.set(key, request);
    try {
      return await request;
    } finally {
      this.#inflight.delete(key);
    }
  }

  /**
   * Fetch many objects by id from a bulk-expanded endpoint (/v2/items,
   * /v2/recipes, ...). Each id is cached separately, so repeated lookups only
   * fetch ids not seen yet. Unknown ids are omitted from the result.
   */
  async getMany<T extends { id: number | string }>(
    path: string,
    ids: Iterable<number | string>,
    options: Omit<RequestOptions, 'params'> = {},
  ): Promise<Map<T['id'], T>> {
    const auth = options.auth ?? requiresAuth(path);
    const ttl = options.ttlMs ?? (auth ? 0 : TTL.static);
    const result = new Map<T['id'], T>();
    const missing: (number | string)[] = [];

    for (const id of new Set(ids)) {
      const hit = ttl > 0 ? await this.#cache.get(this.#idKey(path, id, auth)) : undefined;
      if (hit !== undefined) result.set(id as T['id'], hit as T);
      else missing.push(id);
    }

    const chunks: (number | string)[][] = [];
    for (let i = 0; i < missing.length; i += MAX_IDS_PER_REQUEST) {
      chunks.push(missing.slice(i, i + MAX_IDS_PER_REQUEST));
    }
    await mapLimit(chunks, this.#concurrency, async (chunk) => {
      let rows: T[];
      try {
        rows = await this.#request<T[]>(path, { ids: chunk.join(','), lang: this.lang }, auth);
      } catch (err) {
        // "all ids provided are invalid" comes back as 404.
        if (err instanceof Gw2ApiError && err.status === 404) return;
        throw err;
      }
      for (const row of rows) {
        result.set(row.id, row);
        if (ttl > 0) await this.#cache.set(this.#idKey(path, row.id, auth), row, ttl);
      }
    });
    return result;
  }

  /** Every id an endpoint exposes (GET /v2/items with no params, etc.). */
  listIds(path: string): Promise<number[]> {
    return this.get<number[]>(path, { auth: false, ttlMs: TTL.static });
  }

  async #request<T>(path: string, params: Params, auth: boolean): Promise<T> {
    if (auth && !this.#apiKey) {
      throw new Gw2ApiError(401, path, 'this endpoint needs an API key, and none is configured');
    }
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    url.searchParams.set('v', this.#schema);
    // Query-string auth: an Authorization header triggers a CORS preflight,
    // which the API answers with 404, so browsers can only use access_token.
    if (auth && this.#apiKey) url.searchParams.set('access_token', this.#apiKey);

    for (let attempt = 0; ; attempt++) {
      await this.#limiter.take();
      let res: Response;
      try {
        res = await this.#fetch(url, { headers: { Accept: 'application/json' } });
      } catch (err) {
        if (attempt < this.#maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new Gw2ApiError(0, path, `network error: ${(err as Error).message}`);
      }

      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.#maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      throw new Gw2ApiError(res.status, path, await errorText(res));
    }
  }

  #cacheKey(path: string, params: Params, auth: boolean): string {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('&');
    return `${auth ? `auth:${this.#authScope}:` : ''}${this.#schema}:${path}?${query}`;
  }

  #idKey(path: string, id: number | string, auth: boolean): string {
    return `${auth ? `auth:${this.#authScope}:` : ''}${this.#schema}:${path}/${id}?lang=${this.lang}`;
  }
}

function backoff(attempt: number): number {
  return 500 * 2 ** attempt + Math.random() * 250;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { text?: string };
    return body.text ?? res.statusText;
  } catch {
    return res.statusText || 'request failed';
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}
