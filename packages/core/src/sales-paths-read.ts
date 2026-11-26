/** Gather what `planSalesPaths` needs: live prices and what the account holds, can craft and has unlocked. */
import { TTL, type Gw2Client, type InventorySlot, type Permission } from '@gw2kit/client';
import type { MarketItem } from './convert.js';
import { CONTENT_VOLUME_DATES, CURRENCY_LEFT_OUT, CURRENCY_NAMES, CURRENCY_PATHS, CURRENCY_PATHS_AS_OF, ITEM_CURRENCIES } from './currency-paths-data.js';
import { craftingRatings } from './convert-read.js';
import type { SalesPathData } from './sales-paths.js';

/** How many of each of `ids` the account holds, wherever it can be read. */
async function heldItems(client: Gw2Client, permissions: readonly Permission[], ids: readonly number[]): Promise<Record<number, number> | undefined> {
  if (!permissions.includes('inventories')) return undefined;
  const account = { ttlMs: TTL.account };
  const [materials, bank, shared, characters] = await Promise.all([
    client.get('/v2/account/materials', account).catch(() => undefined),
    client.get('/v2/account/bank', account).catch(() => undefined),
    client.get('/v2/account/inventory', account).catch(() => undefined),
    permissions.includes('characters') ? client.all('/v2/characters', account).catch(() => undefined) : undefined,
  ]);
  if (!materials) return undefined;
  const slots: ({ id: number; count: number } | InventorySlot | null)[] = [
    ...materials,
    ...(bank ?? []),
    ...(shared ?? []),
    ...(characters ?? []).flatMap((c) => (c.bags ?? []).flatMap((bag) => bag?.inventory ?? [])),
  ];
  const held = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const slot of slots) if (slot && held[slot.id] !== undefined) held[slot.id]! += slot.count;
  return held;
}

/**
 * The snapshot of currency paths with today's prices and what the account holds.
 * Without `wallet` there is no data, and `notes` says so.
 */
export async function readSalesPaths(
  client: Gw2Client,
  permissions: readonly Permission[],
): Promise<{ data?: SalesPathData; notes: string[] }> {
  const account = { ttlMs: TTL.account };
  const wallet = permissions.includes('wallet') ? await client.get('/v2/account/wallet', account).catch(() => undefined) : undefined;
  if (!wallet) return { notes: ['paths that spend currencies were not considered (needs `wallet`)'] };
  const items = await heldItems(client, permissions, ITEM_CURRENCIES);
  const balances: Record<number, number> = { ...Object.fromEntries(wallet.map((w) => [w.id, w.value])), ...items };
  // A path whose currency the account has none of can't be used, so it isn't priced.
  const paths = CURRENCY_PATHS.filter((p) => (balances[p.currency] ?? 0) > 0);

  const names = new Map<number, string>();
  /** Items sold, whose buy orders matter. */
  const sold = new Set<number>();
  for (const path of paths) {
    for (const [id, , name] of path.items) names.set(id, name);
    if (!path.contents) {
      names.set(path.output, path.name);
      sold.add(path.output);
      continue;
    }
    for (const [id, name, , , list, instant] of path.contents.yields) {
      if (list <= 0 && instant <= 0) continue;
      names.set(id, name);
      sold.add(id);
    }
  }
  const ids = [...names.keys()];

  const [prices, listings, ratings, learned] = await Promise.all([
    client.many('/v2/commerce/prices', ids),
    client.many('/v2/commerce/listings', sold).catch(() => undefined),
    permissions.includes('characters') ? craftingRatings(client).catch(() => undefined) : undefined,
    permissions.includes('unlocks') ? client.get('/v2/account/recipes', account).catch(() => undefined) : undefined,
  ]);
  const market = new Map<number, MarketItem>();
  for (const id of ids) {
    const price = prices.get(id);
    const book = listings?.get(id)?.buys.map((b) => ({ price: b.unit_price, quantity: b.quantity }));
    market.set(id, {
      name: names.get(id)!,
      ...(price?.buys.unit_price ? { buy: price.buys.unit_price } : {}),
      ...(price?.sells.unit_price ? { sell: price.sells.unit_price } : {}),
      ...(book ? { book } : {}),
    });
  }
  return {
    data: {
      paths,
      currencyNames: CURRENCY_NAMES,
      market,
      wallet: balances,
      itemCurrencies: ITEM_CURRENCIES,
      leftOut: CURRENCY_LEFT_OUT,
      asOf: CURRENCY_PATHS_AS_OF,
      contentDates: CONTENT_VOLUME_DATES,
      ...(ratings ? { ratings } : {}),
      ...(learned ? { learned: new Set(learned) } : {}),
    },
    notes: [
      listings || !sold.size ? '' : 'buy order depth unavailable for sales from currencies',
      items ? '' : 'account-bound currencies kept as items (Curious Mursaat Remnants) were not read (needs `inventories`)',
    ].filter(Boolean),
  };
}
