import { TTL } from './cache.js';
import type { Gw2Client } from './client.js';
import type {
  Achievement,
  Currency,
  Item,
  MaterialCategory,
  Price,
  Recipe,
} from './types.js';

/**
 * Bulk lookups that turn the bare ids in account responses into names and
 * prices. All go through Gw2Client.getMany, so they batch and cache per id.
 */
export const catalog = {
  items: (c: Gw2Client, ids: Iterable<number>) => c.getMany<Item>('/v2/items', ids),
  recipes: (c: Gw2Client, ids: Iterable<number>) => c.getMany<Recipe>('/v2/recipes', ids),
  achievements: (c: Gw2Client, ids: Iterable<number>) =>
    c.getMany<Achievement>('/v2/achievements', ids),
  prices: (c: Gw2Client, ids: Iterable<number>) =>
    c.getMany<Price>('/v2/commerce/prices', ids, { ttlMs: TTL.market }),

  async currencies(c: Gw2Client): Promise<Map<number, Currency>> {
    const all = await c.get<Currency[]>('/v2/currencies', { params: { ids: 'all' } });
    return new Map(all.map((x) => [x.id, x]));
  },

  async materialCategories(c: Gw2Client): Promise<Map<number, MaterialCategory>> {
    const all = await c.get<MaterialCategory[]>('/v2/materials', { params: { ids: 'all' } });
    return new Map(all.map((x) => [x.id, x]));
  },

  /** Recipe ids that produce `itemId`. */
  recipesFor: (c: Gw2Client, itemId: number) =>
    c.get<number[]>('/v2/recipes/search', { params: { output: itemId }, auth: false }),

  /** Recipe ids that consume `itemId`. */
  recipesUsing: (c: Gw2Client, itemId: number) =>
    c.get<number[]>('/v2/recipes/search', { params: { input: itemId }, auth: false }),
};

/** Name for an id, falling back to "#id" when the lookup missed. */
export function nameOf(map: Map<number, { name: string }>, id: number): string {
  return map.get(id)?.name || `#${id}`;
}

/**
 * Case-insensitive item search by name. The API has no name search, so this
 * scans the full item list, which costs ~370 requests on first use. Callers
 * should prefer the wiki (`Has game id`) for one-off lookups and use this
 * only when the cache is warm or the caller accepts the cost.
 */
export async function searchItemsByName(
  c: Gw2Client,
  query: string,
  limit = 20,
): Promise<Item[]> {
  const ids = await c.listIds('/v2/items');
  const items = await c.getMany<Item>('/v2/items', ids);
  const q = query.toLowerCase();
  const matches = [...items.values()].filter((i) => i.name.toLowerCase().includes(q));
  matches.sort((a, b) => {
    const ae = a.name.toLowerCase() === q ? 0 : 1;
    const be = b.name.toLowerCase() === q ? 0 : 1;
    return ae - be || a.name.length - b.name.length;
  });
  return matches.slice(0, limit);
}
