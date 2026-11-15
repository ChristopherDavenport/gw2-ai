import { MemoryCache, TTL, type CacheStore } from './cache.js';
import { Gw2ApiError } from './errors.js';
import { RateLimiter, sleep } from './rate-limit.js';
import {
  ROUTES,
  matchRoute,
  type BulkRoute,
  type IdOf,
  type ItemOf,
  type KeyedBulkRoute,
  type ResponseOf,
  type Route,
  type Routes,
} from './routes/index.js';
import type { ArgsTuple, CallOptions, RouteMeta } from './spec.js';

export const API_BASE = 'https://api.guildwars2.com';

/**
 * Response schema every request pins with `?v=`. The response types in
 * src/types are written and verified against this version (see
 * https://api.guildwars2.com/v2.json?v=latest for the list).
 */
export const SCHEMA_VERSION = '2025-08-29T01:00:00.000Z';

/** The API rejects `ids=` lists longer than this. */
export const MAX_IDS_PER_REQUEST = 200;

export type Lang = 'en' | 'es' | 'de' | 'fr' | 'zh';

export type QueryValue = string | number | boolean | undefined;

export interface Gw2ClientOptions {
  /** API key or subtoken (https://account.arena.net/applications). Needed only for authenticated routes. */
  apiKey?: string;
  lang?: Lang;
  cache?: CacheStore;
  /** Injected for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  rateLimiter?: RateLimiter;
  /** Parallel requests when splitting large id lists. */
  concurrency?: number;
  maxRetries?: number;
}

interface Resolved {
  path: string;
  meta: RouteMeta;
  /** Whether this call sends the key (resolves `auth: 'optional'`). */
  auth: boolean;
  query: Record<string, QueryValue>;
  ttlMs: number;
}

/**
 * Typed client for the GW2 API. Every method takes a route template from
 * {@link Routes}; the response type, required path params and query params
 * follow from it, and the API key is attached exactly when the route needs it.
 *
 * ```ts
 * const gw2 = new Gw2Client({ apiKey });
 * const account = await gw2.get('/v2/account');                       // Account
 * const core = await gw2.get('/v2/characters/:id/core', { path: { id: 'Ash Legion' } });
 * const items = await gw2.many('/v2/items', [19721, 19976]);          // Map<number, Item>
 * ```
 */
export class Gw2Client {
  readonly lang: Lang;
  readonly hasKey: boolean;
  readonly #apiKey: string | undefined;
  readonly #cache: CacheStore;
  readonly #fetch: typeof fetch;
  readonly #limiter: RateLimiter;
  readonly #concurrency: number;
  readonly #maxRetries: number;
  /** Scopes cached authenticated responses to this client, and so to this key. */
  readonly #authScope = Math.random().toString(36).slice(2);
  readonly #inflight = new Map<string, Promise<unknown>>();

  constructor(options: Gw2ClientOptions = {}) {
    const key = options.apiKey?.trim();
    this.#apiKey = key ? key : undefined;
    this.hasKey = this.#apiKey !== undefined;
    this.lang = options.lang ?? 'en';
    this.#cache = options.cache ?? new MemoryCache();
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#limiter = options.rateLimiter ?? new RateLimiter();
    this.#concurrency = options.concurrency ?? 4;
    this.#maxRetries = options.maxRetries ?? 3;
  }

  /** GET a route. Concurrent identical calls share one request. */
  get<R extends Route>(route: R, ...args: ArgsTuple<R, Routes[R]>): Promise<ResponseOf<R>> {
    const r = this.#resolve(route, args[0]);
    return this.#cached(r, this.#key(r), () => this.#request(r.path, r.query, r.auth));
  }

  /**
   * Fetch objects by id from a bulk route, 200 ids per request. Each object is
   * cached by id, so repeat lookups only fetch ids not seen yet. Unknown ids
   * are left out of the result.
   */
  async many<R extends KeyedBulkRoute>(
    route: R,
    ids: Iterable<IdOf<R>>,
    ...args: ArgsTuple<R, Routes[R]>
  ): Promise<Map<IdOf<R>, ItemOf<R>>> {
    const r = this.#resolve(route, args[0]);
    const result = new Map<IdOf<R>, ItemOf<R>>();
    const missing: IdOf<R>[] = [];

    for (const id of new Set(ids)) {
      const hit = r.ttlMs > 0 ? await this.#cache.get(this.#key(r, id)) : undefined;
      if (hit !== undefined) result.set(id, hit as ItemOf<R>);
      else missing.push(id);
    }

    for (const row of await this.#fetchIds(r, missing)) {
      result.set(this.#idOf(r, row) as IdOf<R>, row as ItemOf<R>);
    }
    return result;
  }

  /** One object from a bulk route, or undefined if the id doesn't exist. */
  async one<R extends KeyedBulkRoute>(route: R, id: IdOf<R>, ...args: ArgsTuple<R, Routes[R]>): Promise<ItemOf<R> | undefined> {
    return (await this.many(route, [id], ...args)).get(id);
  }

  /** Every id a bulk route exposes. */
  ids<R extends BulkRoute>(route: R, ...args: ArgsTuple<R, Routes[R]>): Promise<IdOf<R>[]> {
    return this.get(route, ...args) as Promise<IdOf<R>[]>;
  }

  /**
   * Every object a bulk route exposes: one `ids=all` request where the route
   * supports it, otherwise the id list followed by batched lookups. On large
   * routes (/v2/items: ~75k objects, ~370 requests) this is slow the first time.
   */
  async all<R extends BulkRoute>(route: R, ...args: ArgsTuple<R, Routes[R]>): Promise<ItemOf<R>[]> {
    const r = this.#resolve(route, args[0]);
    if (r.meta.bulk === 'all') {
      const q = { ...r.query, ids: 'all' };
      const resolved = { ...r, query: q };
      return this.#cached(resolved, this.#key(resolved), () => this.#request(r.path, q, r.auth)) as Promise<ItemOf<R>[]>;
    }
    const ids = await this.ids(route, ...args);
    return (await this.#fetchIds(r, ids)) as ItemOf<R>[];
  }

  /**
   * GET `?ids=` in chunks of 200, in parallel up to the concurrency limit.
   * Caches each row by its id when the route's objects have one. Unknown ids
   * are dropped (an all-invalid chunk is a 404).
   */
  async #fetchIds(r: Resolved, ids: readonly (number | string)[]): Promise<unknown[]> {
    const chunks: (number | string)[][] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) chunks.push(ids.slice(i, i + MAX_IDS_PER_REQUEST));
    const results = await mapLimit(chunks, this.#concurrency, async (chunk) => {
      let rows: unknown;
      try {
        rows = await this.#request(r.path, { ...r.query, ids: chunk.join(',') }, r.auth);
      } catch (err) {
        if (err instanceof Gw2ApiError && err.status === 404) return [];
        throw err;
      }
      if (!Array.isArray(rows)) throw new Gw2ApiError(200, r.path, 'expected an array for an ids= request');
      if (r.ttlMs > 0) {
        for (const row of rows) {
          const id = this.#idOf(r, row);
          if (id !== undefined) await this.#cache.set(this.#key(r, id), row, r.ttlMs);
        }
      }
      return rows as unknown[];
    });
    return results.flat();
  }

  #idOf(r: Resolved, row: unknown): number | string | undefined {
    const id = (row as Record<string, unknown> | null)?.[r.meta.key ?? 'id'];
    return typeof id === 'number' || typeof id === 'string' ? id : undefined;
  }

  /**
   * Untyped escape hatch for a concrete path (`/v2/characters/Ash Legion/sab`).
   * The route table decides whether the key is sent; unknown paths are
   * treated as public unless `auth` says otherwise.
   */
  raw(path: string, options: { query?: Record<string, QueryValue>; auth?: boolean; ttlMs?: number } = {}): Promise<unknown> {
    const match = matchRoute(path);
    const meta: RouteMeta = {
      auth: options.auth ?? match?.meta.auth ?? false,
      permissions: match?.meta.permissions ?? [],
      lang: match?.meta.lang ?? false,
    };
    const auth = this.#sendsKey(meta);
    const query = { ...options.query, ...(meta.lang ? { lang: this.lang } : {}) };
    const r: Resolved = { path, meta, auth, query, ttlMs: options.ttlMs ?? defaultTtl(auth, meta) };
    return this.#cached(r, this.#key(r), () => this.#request(path, query, auth));
  }

  /** Runtime metadata for a route: auth, permissions, bulk behaviour. */
  static meta(route: Route): RouteMeta {
    return ROUTES[route];
  }

  #resolve(route: Route, args: (CallOptions & { path?: object; query?: object }) | undefined): Resolved {
    const meta = ROUTES[route];
    const params = (args?.path ?? {}) as Record<string, string | number | undefined>;
    const path = route.replace(/:([a-z_]+)/g, (_, name: string) => {
      const value = params[name];
      if (value === undefined || value === '') throw new TypeError(`${route}: missing path parameter "${name}"`);
      return encodeURIComponent(String(value));
    });
    const query: Record<string, QueryValue> = { ...(args?.query as Record<string, QueryValue> | undefined) };
    if (meta.lang) query.lang = this.lang;
    const auth = this.#sendsKey(meta);
    return { path, meta, auth, query, ttlMs: args?.ttlMs ?? defaultTtl(auth, meta) };
  }

  #sendsKey(meta: RouteMeta): boolean {
    return meta.auth === true || (meta.auth === 'optional' && this.hasKey);
  }

  async #cached<T>(r: Resolved, key: string, load: () => Promise<unknown>): Promise<T> {
    if (r.ttlMs > 0) {
      const hit = await this.#cache.get(key);
      if (hit !== undefined) return hit as T;
    }
    const pending = this.#inflight.get(key);
    if (pending) return pending as Promise<T>;
    const request = load().then(async (value) => {
      if (r.ttlMs > 0) await this.#cache.set(key, value, r.ttlMs);
      return value;
    });
    this.#inflight.set(key, request);
    try {
      return (await request) as T;
    } finally {
      this.#inflight.delete(key);
    }
  }

  async #request(path: string, query: Record<string, QueryValue>, auth: boolean): Promise<unknown> {
    if (auth && !this.#apiKey) {
      throw new Gw2ApiError(401, path, 'this endpoint needs an API key, and none is configured');
    }
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    url.searchParams.set('v', SCHEMA_VERSION);
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
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < this.#maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      throw new Gw2ApiError(res.status, path, await errorText(res));
    }
  }

  /** Cache key: path + sorted query, never the access token. */
  #key(r: Resolved, id?: number | string): string {
    const query = Object.entries(r.query)
      .filter(([k, v]) => v !== undefined && k !== 'ids')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`);
    // many() caches per id; an ids list reaches the key only through all() (`ids=all`) or raw().
    if (r.query.ids !== undefined) query.push(`ids=${String(r.query.ids)}`);
    const scope = r.auth ? `auth:${this.#authScope}:` : '';
    return `${scope}${SCHEMA_VERSION}:${r.path}${id === undefined ? '' : `/${id}`}?${query.join('&')}`;
  }
}

function defaultTtl(sendsKey: boolean, meta: RouteMeta): number {
  if (sendsKey) return 0;
  return meta.live ? TTL.market : TTL.static;
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
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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
