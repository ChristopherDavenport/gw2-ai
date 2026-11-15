/**
 * Pluggable cache. The client stores parsed JSON values keyed by request
 * path + params (never including the access token). Node uses the in-memory
 * store; the browser site can supply a persistent one.
 */
export interface CacheStore {
  get(key: string): Promise<unknown> | unknown;
  set(key: string, value: unknown, ttlMs: number): Promise<void> | void;
}

interface Entry {
  value: unknown;
  expires: number;
}

/** Bounded in-memory cache; evicts the oldest-inserted entry when full. */
export class MemoryCache implements CacheStore {
  readonly #entries = new Map<string, Entry>();
  readonly #maxEntries: number;

  constructor(maxEntries = 50_000) {
    this.#maxEntries = maxEntries;
  }

  get(key: string): unknown {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.#entries.delete(key);
    this.#entries.set(key, { value, expires: Date.now() + ttlMs });
    if (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** Cache lifetimes, chosen from how often the underlying data changes. */
export const TTL = {
  /** Item, recipe, achievement, currency definitions: change only on game builds. */
  static: 24 * 60 * 60 * 1000,
  /** Trading post prices and listings. */
  market: 60 * 1000,
  /** Gem exchange rates. */
  exchange: 5 * 60 * 1000,
  /** Account state; the API itself refreshes it every few minutes. */
  account: 60 * 1000,
} as const;
