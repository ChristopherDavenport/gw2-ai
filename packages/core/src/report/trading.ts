import { catalog, nameOf } from '../catalog.js';
import { coins, day, num, table } from '../format.js';
import type { Delivery, Transaction } from '../types.js';
import type { ReportSection } from './context.js';

export const tradingPost: ReportSection = {
  id: 'trading-post',
  title: 'Trading post',
  summary: 'Delivery box, open buy and sell orders compared to current prices, and recent sales and purchases.',
  permissions: ['account', 'tradingpost'],
  async render(ctx) {
    const [delivery, buys, sells, bought, sold] = await Promise.all([
      ctx.account<Delivery>('/v2/commerce/delivery'),
      ctx.account<Transaction[]>('/v2/commerce/transactions/current/buys'),
      ctx.account<Transaction[]>('/v2/commerce/transactions/current/sells'),
      ctx.account<Transaction[]>('/v2/commerce/transactions/history/buys'),
      ctx.account<Transaction[]>('/v2/commerce/transactions/history/sells'),
    ]);
    const ids = new Set<number>([
      ...delivery.items.map((i) => i.id),
      ...[...buys, ...sells, ...bought, ...sold].map((t) => t.item_id),
    ]);
    const [defs, prices] = await Promise.all([
      catalog.items(ctx.client, ids),
      catalog.prices(ctx.client, [...buys, ...sells].map((t) => t.item_id)),
    ]);

    const deliveryRows = delivery.items.map((i) => [nameOf(defs, i.id), num(i.count), i.id]);
    const buyRows = buys.map((t) => {
      const best = prices.get(t.item_id)?.buys.unit_price;
      const status = best === undefined ? '' : best > t.price ? `outbid (top ${coins(best)})` : 'top order';
      return [nameOf(defs, t.item_id), num(t.quantity), coins(t.price), status, day(t.created), t.item_id];
    });
    const sellRows = sells.map((t) => {
      const best = prices.get(t.item_id)?.sells.unit_price;
      const status = best === undefined ? '' : best < t.price ? `undercut (lowest ${coins(best)})` : 'lowest listing';
      return [nameOf(defs, t.item_id), num(t.quantity), coins(t.price), status, day(t.created), t.item_id];
    });
    const history = (list: Transaction[]) =>
      list
        .slice(0, 25)
        .map((t) => [nameOf(defs, t.item_id), num(t.quantity), coins(t.price), day(t.purchased), t.item_id]);

    return [
      `### Delivery box\n\nCoins waiting: **${coins(delivery.coins)}**\n\n${table(['Item', 'Count', 'Item id'], deliveryRows)}`,
      `### Open buy orders\n\n${table(['Item', 'Qty', 'Unit price', 'Status', 'Placed', 'Item id'], buyRows)}`,
      `### Open sell listings\n\n${table(['Item', 'Qty', 'Unit price', 'Status', 'Listed', 'Item id'], sellRows)}`,
      `### Recent sales (last 90 days, newest 25)\n\n${table(['Item', 'Qty', 'Unit price', 'Sold', 'Item id'], history(sold))}`,
      `### Recent purchases (last 90 days, newest 25)\n\n${table(['Item', 'Qty', 'Unit price', 'Bought', 'Item id'], history(bought))}`,
    ].join('\n\n');
  },
};
