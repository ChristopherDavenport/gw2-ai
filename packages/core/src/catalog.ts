import type { Gw2Client, Item, ItemInfixUpgrade } from '@gw2-ai/client';

/** Name for an id, falling back to "#id" when the lookup missed. */
export function nameOf<K>(map: ReadonlyMap<K, { name: string }>, id: K): string {
  return map.get(id)?.name || `#${String(id)}`;
}

/** Index rows by their `id`, e.g. the array from `client.all('/v2/currencies')`. */
export function byId<T extends { id: number | string }>(rows: readonly T[]): Map<T['id'], T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Case-insensitive item search by name. The API has no name search, so this
 * scans the full item list, which costs ~370 requests on first use. Callers
 * should prefer the wiki (`Has game id`) for one-off lookups and use this
 * only when the cache is warm or the caller accepts the cost.
 */
export async function searchItemsByName(c: Gw2Client, query: string, limit = 20): Promise<Item[]> {
  const items = await c.all('/v2/items');
  const q = query.toLowerCase();
  const matches = items.filter((i) => i.name.toLowerCase().includes(q));
  matches.sort((a, b) => {
    const ae = a.name.toLowerCase() === q ? 0 : 1;
    const be = b.name.toLowerCase() === q ? 0 : 1;
    return ae - be || a.name.length - b.name.length;
  });
  return matches.slice(0, limit);
}

/**
 * The stat block of an equipment item or upgrade component (`infix_upgrade`
 * in its details), or undefined for items that have none.
 */
export function infixUpgrade(item: Item): ItemInfixUpgrade | undefined {
  switch (item.type) {
    case 'Armor':
    case 'Back':
    case 'Trinket':
    case 'Weapon':
    case 'UpgradeComponent':
      return item.details.infix_upgrade;
    default:
      return undefined;
  }
}
