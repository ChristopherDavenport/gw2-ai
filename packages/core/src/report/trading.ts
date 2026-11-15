import type { CommerceCompletedTransaction } from '@gw2kit/client';
import { nameOf } from '../catalog.js';
import { coins, day, num, table } from '../format.js';
import { ACCOUNT, type ReportSection } from './context.js';

export const tradingPost: ReportSection = {
  id: 'trading-post',
  title: 'Trading post',
  summary: 'Delivery box, open buy and sell orders compared to current prices, and recent sales and purchases.',
  permissions: ['account', 'tradingpost'],
  async render(ctx) {
    const [delivery, buys, sells, bought, sold] = await Promise.all([
      ctx.client.get('/v2/commerce/delivery', ACCOUNT),
      ctx.client.get('/v2/commerce/transactions/current/buys', ACCOUNT),
      ctx.client.get('/v2/commerce/transactions/current/sells', ACCOUNT),
      ctx.client.get('/v2/commerce/transactions/history/buys', ACCOUNT),
      ctx.client.get('/v2/commerce/transactions/history/sells', ACCOUNT),
    ]);
    const ids = new Set<number>([
      ...delivery.items.map((i) => i.id),
      ...[...buys, ...sells, ...bought, ...sold].map((t) => t.item_id),
    ]);
    const [defs, prices] = await Promise.all([
      ctx.client.many('/v2/items', ids),
      ctx.client.many('/v2/commerce/prices', [...buys, ...sells].map((t) => t.item_id)),
    ]);

    const outbid = buys.filter((t) => (prices.get(t.item_id)?.buys.unit_price ?? 0) > t.price).length;
    const undercut = sells.filter((t) => {
      const lowest = prices.get(t.item_id)?.sells.unit_price;
      return lowest !== undefined && lowest < t.price;
    }).length;
    ctx.facts.push({
      order: 50,
      label: 'Trading post',
      value:
        `delivery box ${coins(delivery.coins)} and ${delivery.items.length} item stacks; ` +
        `${buys.length} buy orders (${outbid} outbid); ${sells.length} sell listings (${undercut} undercut)`,
    });
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
    const historyRows = ctx.options.detail === 'summary' ? 10 : 25;
    // The API returns one page (50) of the last 90 days unless paged.
    const of = (list: readonly unknown[]) => `${num(list.length)}${list.length >= 50 ? '+' : ''}`;
    if (sold.length > historyRows || bought.length > historyRows) {
      ctx.omissions.push(
        `Trading post history: newest ${historyRows} of ${of(sold)} sales and ${of(bought)} purchases ` +
          '(more: `gw2_account_get` path `/v2/commerce/transactions/history/sells` or `/buys`)',
      );
    }
    const footer = (list: readonly unknown[]) =>
      list.length > historyRows ? `\n\n_Newest ${historyRows} of ${of(list)} in the last 90 days._` : '';
    const history = (list: CommerceCompletedTransaction[]) =>
      list
        .slice(0, historyRows)
        .map((t) => [nameOf(defs, t.item_id), num(t.quantity), coins(t.price), day(t.purchased), t.item_id]);

    return [
      `### Delivery box\n\nCoins waiting: **${coins(delivery.coins)}**\n\n${table(['Item', 'Count', 'Item id'], deliveryRows)}`,
      `### Open buy orders\n\n${table(['Item', 'Qty', 'Unit price', 'Status', 'Placed', 'Item id'], buyRows)}`,
      `### Open sell listings\n\n${table(['Item', 'Qty', 'Unit price', 'Status', 'Listed', 'Item id'], sellRows)}`,
      `### Recent sales (last 90 days, newest ${historyRows})\n\n${table(['Item', 'Qty', 'Unit price', 'Sold', 'Item id'], history(sold))}${footer(sold)}`,
      `### Recent purchases (last 90 days, newest ${historyRows})\n\n${table(['Item', 'Qty', 'Unit price', 'Bought', 'Item id'], history(bought))}${footer(bought)}`,
    ].join('\n\n');
  },
};
