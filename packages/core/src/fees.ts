/** Trading post fee arithmetic; the fees themselves live in @gw2kit/recipes, which values owned materials. */
import { EXCHANGE_FEE_RATE, LISTING_FEE_RATE, sellProceeds } from '@gw2kit/recipes';

export { EXCHANGE_FEE_RATE, exchangeFee, LISTING_FEE_RATE, listingFee, sellProceeds } from '@gw2kit/recipes';

/**
 * Profit per unit from buying at `buyPrice` (filling a buy order) and
 * relisting at `sellPrice`. Undefined when either side has no orders.
 */
export function flipProfit(buyPrice: number, sellPrice: number): number | undefined {
  if (buyPrice <= 0 || sellPrice <= 0) return undefined;
  return sellProceeds(sellPrice) - buyPrice;
}

/** Lowest listing price whose proceeds cover `cost`. */
export function breakEvenPrice(cost: number): number {
  let p = Math.max(1, Math.ceil(cost / (1 - LISTING_FEE_RATE - EXCHANGE_FEE_RATE)) - 2);
  while (sellProceeds(p) < cost) p++;
  return p;
}
