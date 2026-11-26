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
