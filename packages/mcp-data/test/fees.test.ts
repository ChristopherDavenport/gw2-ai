import { describe, expect, it } from 'vitest';
import { breakEvenPrice, exchangeFee, flipProfit, listingFee, sellProceeds } from '../src/fees.js';
import { checkParams, normalizeApiPath } from '../src/util.js';

describe('trading post fees', () => {
  it('charges 5% listing and 10% exchange, rounded, 1c minimum each', () => {
    expect(listingFee(10_000)).toBe(500);
    expect(exchangeFee(10_000)).toBe(1_000);
    expect(sellProceeds(10_000)).toBe(8_500);
    expect(listingFee(1)).toBe(1);
    expect(exchangeFee(1)).toBe(1);
    expect(sellProceeds(1)).toBe(-1);
    expect(sellProceeds(2)).toBe(0);
    // 15c: 5% = 0.75 → 1c, 10% = 1.5 → 2c.
    expect(sellProceeds(15)).toBe(12);
  });

  it('computes flip profit per unit', () => {
    expect(flipProfit(8_000, 10_000)).toBe(500);
    expect(flipProfit(9_000, 10_000)).toBe(-500);
    expect(flipProfit(0, 10_000)).toBeUndefined();
    expect(flipProfit(100, 0)).toBeUndefined();
  });

  it('finds the lowest break-even listing price', () => {
    for (const cost of [1, 7, 100, 8_500, 123_457]) {
      const p = breakEvenPrice(cost);
      expect(sellProceeds(p)).toBeGreaterThanOrEqual(cost);
      expect(sellProceeds(p - 1)).toBeLessThan(cost);
    }
    expect(breakEvenPrice(8_500)).toBe(10_000);
  });
});

describe('gw2_api_get path checks', () => {
  it('normalises public paths', () => {
    expect(normalizeApiPath('/v2/items')).toBe('/v2/items');
    expect(normalizeApiPath('items/19721')).toBe('/v2/items/19721');
    expect(normalizeApiPath('/v2/achievements/daily/')).toBe('/v2/achievements/daily');
  });
  it('rejects URLs, traversal and query strings', () => {
    for (const p of ['http://x/v2/items', '//x/v2', '/v2/../v1', '/v2/items?ids=1', '/v2/%2e%2e/x', '/v2/a%2fb'])
      expect(() => normalizeApiPath(p), p).toThrow();
  });
  it('rejects access_token in params', () => {
    expect(() => checkParams({ access_token: 'x' })).toThrow();
  });
});
