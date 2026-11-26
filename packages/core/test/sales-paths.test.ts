import { planFromData, type RecipeData } from '@gw2kit/recipes';
import { describe, expect, it } from 'vitest';
import { CURRENCY_PATHS, pathCap, planSales, planSalesPaths, renderSales, salesForPlan, type CurrencyPath, type MarketItem, type SalesPathData, type Sellable } from '../src/index.js';

const FAVOR = 68;
const NOTES = 61;

const path = (output: number, name: string, over: Partial<CurrencyPath> = {}): CurrencyPath => ({
  currency: FAVOR,
  output,
  name,
  currencies: [[1, 100], [NOTES, 50], [FAVOR, 1000]],
  items: [[9, 2, 'Part']],
  unobtainable: [],
  limits: [],
  crafts: [{ recipes: [output * 10], name, disciplines: ['Weaponsmith'], rating: 500, unlock: true }],
  volume: { list: 4.5, instant: 4.5, from: '2026-10-28', to: '2026-11-25', days: 29 },
  ...over,
});

const market = (over: Record<number, MarketItem> = {}) =>
  new Map<number, MarketItem>(
    Object.entries({
      1: { name: 'Axe', buy: 10_000, sell: 12_000 },
      2: { name: 'Bow', buy: 20_000, sell: 24_000 },
      9: { name: 'Part', sell: 500 },
      ...over,
    }).map(([id, item]) => [Number(id), item as MarketItem]),
  );

const data = (over: Partial<SalesPathData> = {}): SalesPathData => ({
  paths: [path(1, 'Axe'), path(2, 'Bow')],
  currencyNames: { 61: 'Research Note', 68: 'Imperial Favor' },
  market: market(),
  wallet: { 1: 1_000_000, [NOTES]: 10_000, [FAVOR]: 100_000 },
  ...over,
});

describe('pathCap', () => {
  it('is a share of the volume over the days waited, at least one, none without volume', () => {
    expect(pathCap(4.5)).toBe(3);
    expect(pathCap(0.4)).toBe(1);
    expect(pathCap(0)).toBe(0);
    expect(pathCap(10, 0.2, 3)).toBe(6);
  });
});

describe('planSalesPaths', () => {
  it('counts profit after fees and gold inputs, up to each cap', () => {
    const plan = planSalesPaths(data());
    expect(plan.sales.map((s) => [s.path.name, s.units])).toEqual([['Bow', 3], ['Axe', 3]]);
    // 2g less 15%, less 2 parts at 5s and 1s to the vendor.
    expect(plan.sales[0]!.profits).toEqual([15_900, 15_900, 15_900]);
    expect(plan.upfront).toBe(6 * 1100);
    expect(plan.binding.map((b) => b.kind)).toEqual(['cap', 'cap']);
    expect(plan.binding[0]).toMatchObject({ name: 'Bow', cap: 3, days: 9 });
  });

  it('shares each currency, the better path first, and says what is short', () => {
    const plan = planSalesPaths(data({ wallet: { [FAVOR]: 2500, [NOTES]: 10_000 } }));
    expect(plan.sales.map((s) => [s.path.name, s.units])).toEqual([['Bow', 2]]);
    expect(plan.binding[0]).toMatchObject({ kind: 'currency', name: 'Bow', short: [{ id: FAVOR, amount: 500 }] });
    // What is reserved is not there to spend.
    expect(planSalesPaths(data({ wallet: { [FAVOR]: 2500, [NOTES]: 10_000 } }), { reserve: new Map([[FAVOR, 2000]]) }).sales).toEqual([]);
  });

  it('walks buy orders for instant sales and takes the lowest listing when listing', () => {
    const thin = data({ paths: [path(2, 'Bow')], market: market({ 2: { name: 'Bow', buy: 20_000, sell: 24_000, book: [{ price: 20_000, quantity: 1 }, { price: 1000, quantity: 9 }] } }) });
    expect(planSalesPaths(thin).sales[0]!.units).toBe(1);
    const listed = planSalesPaths(thin, { method: 'list' }).sales[0]!;
    // 5% of it is paid to list.
    expect([listed.units, listed.profits[0], listed.unitFee]).toEqual([3, 19_300, 1200]);
  });

  it('leaves out what loses, never sells, or cannot be made', () => {
    const volume = { list: 0, instant: 0, from: '2026-10-28', to: '2026-11-25', days: 29 };
    const reasons = (d: SalesPathData) => planSalesPaths(d).blocked.map((b) => b.reason);
    expect(planSalesPaths(data({ market: market({ 9: { name: 'Part', sell: 50_000 } }) })).sales).toEqual([]);
    expect(reasons(data({ paths: [path(1, 'Axe', { volume })] }))).toEqual(['none were sold in the volume snapshot']);
    expect(reasons(data({ paths: [path(1, 'Axe', { unobtainable: [[5, 'Soul', 1]] })] }))).toEqual(["needs Soul, which can't be bought"]);
    expect(reasons(data({ paths: [path(1, 'Axe')], ratings: new Map([['Weaponsmith', 400]]) }))).toEqual(['needs Weaponsmith 500']);
    expect(reasons(data({ paths: [path(1, 'Axe')], learned: new Set() }))).toEqual(['recipes not unlocked: Axe']);
  });
});

describe('currency paths in sales', () => {
  const spare: Sellable[] = [{ id: 50, name: 'Ore', count: 100, material: true, vendor: 0, buy: 200, sell: 220 }];

  it('are only mentioned until asked for', () => {
    const sales = planSales(spare, { paths: data() });
    expect(sales.lines.map((l) => l.name)).toEqual(['Ore']);
    expect(renderSales(sales)).toContain('Not included: paths that need gold up front');
  });

  it('count toward the target when on, only as many units as it takes', () => {
    const sales = planSales(spare, { paths: data(), upfront: true, target: 20_000 });
    const made = sales.lines.find((l) => l.path)!;
    expect([made.name, made.quantity]).toEqual(['Bow', 1]);
    expect(sales.lines.map((l) => l.name)).toEqual(['Ore', 'Bow']);
    expect(sales.short).toBe(0);
    const markdown = renderSales(sales);
    expect(markdown).toContain('Gold needed up front: **11s**');
    expect(markdown).toContain('trade volume is a snapshot of 2026-10-28 to 2026-11-25');
  });

  it('leave a crafting plan the currencies it needs', () => {
    const recipes: RecipeData = {
      version: 1,
      rootId: 70,
      maxDepth: 10,
      fetchedAt: '2026-11-26T00:00:00.000Z',
      items: { 70: { name: 'Goal' } },
      searched: [],
      recipes: { 70: [{ source: 'crafting', id: 1, disciplines: ['Artificer'], min_rating: 400, output_count: 1, ingredients: [{ type: 'Currency', id: FAVOR, count: 99_000 }] }] },
      currencies: { 68: 'Imperial Favor' },
      guildUpgrades: {},
      vendors: {},
      vendorUnmatched: [],
      status: {},
    };
    const sales = salesForPlan(planFromData(recipes), [], { paths: data(), upfront: true });
    // 1,000 favor are left of 100,000.
    expect(sales.lines.map((l) => [l.name, l.quantity])).toEqual([['Bow', 1]]);
  });

  it('ships the sixteen Imperial Favor weapons, all made from things that can be had', () => {
    expect(CURRENCY_PATHS).toHaveLength(16);
    expect(CURRENCY_PATHS.every((p) => p.currencies.some(([id]) => id === FAVOR) && !p.unobtainable.length && !p.limits.length)).toBe(true);
  });
});
