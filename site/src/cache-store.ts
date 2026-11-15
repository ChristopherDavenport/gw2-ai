/**
 * Persistent CacheStore for public, unauthenticated API data (item, recipe,
 * currency definitions, prices). Authenticated responses, whose cache keys
 * the core client prefixes with `auth:`, stay in memory only and vanish
 * with the page.
 *
 * The whole persisted cache is read into memory on first use (one getAll),
 * because the client looks ids up one at a time; writes are batched into a
 * single transaction per tick.
 */
import { MemoryCache, type CacheStore } from '@gw2-ai/core';
import { withStore } from './idb.js';

export const CACHE_DB = 'gw2-ai-cache';
export const CACHE_STORE = 'entries';

interface Entry {
  value: unknown;
  expires: number;
}

export function isAuthKey(key: string): boolean {
  return key.startsWith('auth:');
}

export class IdbCache implements CacheStore {
  readonly #session = new MemoryCache();
  readonly #entries = new Map<string, Entry>();
  #loaded: Promise<void> | undefined;
  #pending = new Map<string, Entry>();
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #flushing: Promise<void> = Promise.resolve();
  /** False once IndexedDB fails; the cache then works in memory only. */
  #persistent = true;

  async get(key: string): Promise<unknown> {
    if (isAuthKey(key)) return this.#session.get(key);
    await this.#load();
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
    if (isAuthKey(key)) {
      this.#session.set(key, value, ttlMs);
      return;
    }
    const entry = { value, expires: Date.now() + ttlMs };
    this.#entries.set(key, entry);
    if (!this.#persistent) return;
    this.#pending.set(key, entry);
    this.#flushTimer ??= setTimeout(() => void this.flush(), 0);
  }

  /** Write buffered entries now. Resolves when they are committed. */
  flush(): Promise<void> {
    if (this.#flushTimer !== undefined) clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    const batch = this.#pending;
    this.#pending = new Map();
    if (batch.size && this.#persistent) {
      this.#flushing = this.#flushing.then(() =>
        withStore(CACHE_DB, CACHE_STORE, 'readwrite', (s) => {
          for (const [k, e] of batch) s.put(e, k);
        }).then(
          () => undefined,
          (err: unknown) => this.#disable(err),
        ),
      );
    }
    return this.#flushing;
  }

  /** Delete every persisted entry. */
  async clear(): Promise<void> {
    this.#entries.clear();
    this.#pending.clear();
    if (this.#persistent) await withStore(CACHE_DB, CACHE_STORE, 'readwrite', (s) => s.clear());
  }

  #load(): Promise<void> {
    this.#loaded ??= this.#readAll().catch((err: unknown) => this.#disable(err));
    return this.#loaded;
  }

  async #readAll(): Promise<void> {
    const now = Date.now();
    await withStore(CACHE_DB, CACHE_STORE, 'readwrite', (s) => {
      const req = s.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const entry = cursor.value as Entry;
        if (typeof cursor.key !== 'string' || isAuthKey(cursor.key) || !(entry.expires > now)) {
          cursor.delete();
        } else if (!this.#entries.has(cursor.key)) {
          this.#entries.set(cursor.key, entry);
        }
        cursor.continue();
      };
    });
  }

  #disable(err: unknown): void {
    if (this.#persistent) console.warn('Persistent cache unavailable, using memory only:', err);
    this.#persistent = false;
    this.#pending.clear();
  }
}
