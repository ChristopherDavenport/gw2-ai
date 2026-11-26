/** Gather what `planSalesPaths` needs: live prices and the account's wallet, ratings and unlocks. */
import { TTL, type Gw2Client, type Permission } from '@gw2kit/client';
import type { MarketItem } from './convert.js';
import { CURRENCY_NAMES, CURRENCY_PATHS } from './currency-paths-data.js';
import { craftingRatings } from './convert-read.js';
import type { SalesPathData } from './sales-paths.js';

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
  if (!wallet) return { notes: ['paths that spend wallet currencies were not considered (needs `wallet`)'] };
  const balances = Object.fromEntries(wallet.map((w) => [w.id, w.value]));
  // A path whose currency the account has none of can't be used, so it isn't priced.
  const paths = CURRENCY_PATHS.filter((p) => (balances[p.currency] ?? 0) > 0);
  const outputs = paths.map((p) => p.output);
  const ids = [...new Set([...outputs, ...paths.flatMap((p) => p.items.map(([id]) => id))])];

  const [prices, listings, ratings, learned] = await Promise.all([
    client.many('/v2/commerce/prices', ids),
    client.many('/v2/commerce/listings', outputs).catch(() => undefined),
    permissions.includes('characters') ? craftingRatings(client).catch(() => undefined) : undefined,
    permissions.includes('unlocks') ? client.get('/v2/account/recipes', account).catch(() => undefined) : undefined,
  ]);
  const names = new Map(paths.flatMap((p) => [[p.output, p.name] as const, ...p.items.map(([id, , name]) => [id, name] as const)]));
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
      ...(ratings ? { ratings } : {}),
      ...(learned ? { learned: new Set(learned) } : {}),
    },
    notes: listings || !outputs.length ? [] : ['buy order depth unavailable for crafted sales'],
  };
}
