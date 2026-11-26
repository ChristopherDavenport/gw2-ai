/**
 * Trading post fees. Selling costs 15% in total: a 5% listing fee paid when
 * the listing is posted and a 10% exchange fee taken when it sells. Each is
 * rounded to the nearest copper with a 1c minimum.
 */
export const LISTING_FEE_RATE = 0.05;
export const EXCHANGE_FEE_RATE = 0.1;

export function listingFee(price: number): number {
  return Math.max(1, Math.round(price * LISTING_FEE_RATE));
}

export function exchangeFee(price: number): number {
  return Math.max(1, Math.round(price * EXCHANGE_FEE_RATE));
}

/** Copper received for one unit sold at `price`, after both fees. */
export function sellProceeds(price: number): number {
  return price - listingFee(price) - exchangeFee(price);
}

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
