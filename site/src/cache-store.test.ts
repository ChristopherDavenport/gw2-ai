import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { CACHE_DB, CACHE_STORE, IdbCache } from './cache-store.js';
import { withStore } from './idb.js';

function persistedKeys(): Promise<IDBValidKey[] | undefined> {
  return withStore<IDBValidKey[]>(CACHE_DB, CACHE_STORE, 'readonly', (s) => s.getAllKeys());
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('IdbCache', () => {
  it('persists public entries across instances', async () => {
    const a = new IdbCache();
    a.set('v:/v2/items/1?lang=en', { id: 1, name: 'Item' }, 60_000);
    expect(await a.get('v:/v2/items/1?lang=en')).toEqual({ id: 1, name: 'Item' });
    await a.flush();

    const b = new IdbCache();
    expect(await b.get('v:/v2/items/1?lang=en')).toEqual({ id: 1, name: 'Item' });
  });

  it('never persists authenticated entries', async () => {
    const a = new IdbCache();
    a.set('auth:abc:v:/v2/tokeninfo?lang=en', { name: 'secret' }, 60_000);
    a.set('v:/v2/items/2?lang=en', { id: 2 }, 60_000);
    expect(await a.get('auth:abc:v:/v2/tokeninfo?lang=en')).toEqual({ name: 'secret' });
    await a.flush();

    expect(await persistedKeys()).toEqual(['v:/v2/items/2?lang=en']);
    expect(await new IdbCache().get('auth:abc:v:/v2/tokeninfo?lang=en')).toBeUndefined();
  });

  it('ignores ttl <= 0', async () => {
    const a = new IdbCache();
    a.set('k', 1, 0);
    await a.flush();
    expect(await a.get('k')).toBeUndefined();
    expect(await persistedKeys()).toEqual([]);
  });

  it('drops expired entries on load', async () => {
    await withStore(CACHE_DB, CACHE_STORE, 'readwrite', (s) => {
      s.put({ value: 'old', expires: Date.now() - 1 }, 'old');
      s.put({ value: 'new', expires: Date.now() + 60_000 }, 'new');
      s.put({ value: 'x', expires: Date.now() + 60_000 }, 'auth:leaked');
    });
    const c = new IdbCache();
    expect(await c.get('old')).toBeUndefined();
    expect(await c.get('new')).toBe('new');
    expect(await persistedKeys()).toEqual(['new']);
  });

  it('clear() removes persisted entries', async () => {
    const a = new IdbCache();
    a.set('k', 1, 60_000);
    await a.flush();
    await a.clear();
    expect(await persistedKeys()).toEqual([]);
    expect(await new IdbCache().get('k')).toBeUndefined();
  });
});
