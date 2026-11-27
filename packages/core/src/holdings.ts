import type { CommerceTransaction, Gw2Client, Permission } from '@gw2kit/client';
import type { PlanHoldings, PlanOrder } from '@gw2kit/recipes';
import { ACCOUNT, createContext } from './report/context.js';
import { collectHoldings } from './report/items.js';

/** The most the API returns per page. */
const PAGE_SIZE = 200;

/** Every open order of one kind: the API pages them. */
async function openOrders(
  client: Gw2Client,
  route: '/v2/commerce/transactions/current/buys' | '/v2/commerce/transactions/current/sells',
): Promise<CommerceTransaction[]> {
  const orders: CommerceTransaction[] = [];
  for (let page = 0; ; page++) {
    let rows: CommerceTransaction[];
    try {
      rows = await client.get(route, { query: { page, page_size: PAGE_SIZE }, ...ACCOUNT });
    } catch (err) {
      // A full last page is followed by one that is out of range.
      if (page > 0) return orders;
      throw err;
    }
    orders.push(...rows);
    if (rows.length < PAGE_SIZE) return orders;
  }
}

/** Orders by item id, with those at the same price added together. */
function byItem(orders: readonly CommerceTransaction[]): Record<number, PlanOrder[]> {
  const out: Record<number, PlanOrder[]> = {};
  for (const o of orders) {
    const list = (out[o.item_id] ??= []);
    const same = list.find((p) => p.price === o.price);
    if (same) same.quantity += o.quantity;
    else list.push({ quantity: o.quantity, price: o.price });
  }
  return out;
}

/**
 * What the account can spend on a plan: bank, shared slots, character bags,
 * material storage, (with `wallet`) wallet balances and (with `tradingpost`)
 * items waiting in the delivery box and open trading post orders. Equipped
 * gear and guild storage are not counted. `notes` says what could not be
 * read; `walletRead` tells an unread wallet from an empty one.
 */
export async function readHoldings(
  client: Gw2Client,
  permissions: readonly Permission[],
): Promise<{ holdings: PlanHoldings; notes: string[]; walletRead: boolean }> {
  const trading = permissions.includes('tradingpost');
  const [held, materials, wallet, delivery, orders] = await Promise.all([
    collectHoldings(createContext(client, { valuation: false })),
    client.get('/v2/account/materials', ACCOUNT).catch(() => undefined),
    permissions.includes('wallet') ? client.get('/v2/account/wallet', ACCOUNT).catch(() => undefined) : undefined,
    trading ? client.get('/v2/commerce/delivery', ACCOUNT).catch(() => undefined) : undefined,
    trading
      ? Promise.all([
          openOrders(client, '/v2/commerce/transactions/current/buys'),
          openOrders(client, '/v2/commerce/transactions/current/sells'),
        ]).catch(() => undefined)
      : undefined,
  ]);
  // Prices as the orders stand, so the plan can say which are outbid or undercut.
  const market = orders
    ? await client.many('/v2/commerce/prices', new Set(orders.flat().map((o) => o.item_id))).catch(() => undefined)
    : undefined;
  const notes = [...held.notes];
  const items: Record<number, number> = {};
  for (const h of held.holdings.values()) items[h.id] = (items[h.id] ?? 0) + h.count;
  if (materials) for (const m of materials) if (m.count > 0) items[m.id] = (items[m.id] ?? 0) + m.count;
  if (delivery) for (const d of delivery.items) items[d.id] = (items[d.id] ?? 0) + d.count;
  if (!materials) notes.push('material storage unavailable');
  if (!wallet) notes.push('wallet unavailable (needs `wallet`)');
  if (!delivery) notes.push('delivery box unavailable (needs `tradingpost`)');
  if (!orders) notes.push('trading post orders unavailable (needs `tradingpost`)');
  else if (!market) notes.push('current prices for your trading post orders unavailable');
  return {
    holdings: {
      items,
      wallet: Object.fromEntries((wallet ?? []).map((w) => [w.id, w.value])),
      fetchedAt: new Date().toISOString(),
      ...(orders
        ? {
            orders: {
              buys: byItem(orders[0]),
              sells: byItem(orders[1]),
              ...(market
                ? {
                    market: Object.fromEntries(
                      [...market].map(([id, p]) => [
                        id,
                        { ...(p.buys.unit_price ? { buy: p.buys.unit_price } : {}), ...(p.sells.unit_price ? { sell: p.sells.unit_price } : {}) },
                      ]),
                    ),
                  }
                : {}),
            },
          }
        : {}),
    },
    notes,
    walletRead: wallet !== undefined,
  };
}
