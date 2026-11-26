import { planFromData, type RecipeData } from '@gw2kit/recipes';
import { describe, expect, it } from 'vitest';
import { CURRENCY_LEFT_OUT, CURRENCY_PATHS, pathCap, planSales, planSalesPaths, renderSales, salesForPlan, type CurrencyPath, type MarketItem, type SalesPathData, type Sellable } from '../src/index.js';

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
    expect(reasons(data({ paths: [path(1, 'Axe')], learned: new Set() }))).toEqual(['recipe not unlocked']);
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
    const favor = CURRENCY_PATHS.filter((p) => p.currency === FAVOR);
    expect(favor).toHaveLength(16);
    expect(favor.every((p) => p.currencies.some(([id]) => id === FAVOR) && !p.unobtainable.length && !p.limits.length)).toBe(true);
  });

  it('ships paths that take their currency, with averages from enough openings', () => {
    expect(new Set(CURRENCY_PATHS.map((p) => p.currency))).toEqual(new Set([68, 78, 79, 80, 45, 104829]));
    for (const p of CURRENCY_PATHS) {
      expect(p.currencies.some(([id]) => id === p.currency), p.name).toBe(true);
      expect(p.unobtainable, p.name).toEqual([]);
      if (p.contents) expect(p.contents.sample, p.name).toBeGreaterThanOrEqual(100);
      else expect(p.volume, p.name).toBeDefined();
    }
    expect(CURRENCY_LEFT_OUT.some(([, name, reason]) => name === 'Skritt Supply Box' && reason.includes('openings'))).toBe(true);
  });
});

const ESSENCE = 78;

/** A container holding 2 ore (10c at a vendor, 100c sold), and half a trinket nobody trades. */
const bag = (over: Partial<CurrencyPath> = {}): CurrencyPath => ({
  currency: ESSENCE,
  output: 500,
  name: 'Bag',
  vendor: 'Trader',
  currencies: [[ESSENCE, 10]],
  items: [],
  unobtainable: [],
  limits: [],
  crafts: [],
  contents: {
    sample: 250,
    source: 'Bag/Drop rate',
    yields: [
      [7, 'Ore', 2, 10, 1000, 1000],
      [8, 'Trinket', 0.5, 6, 0, 0],
    ],
  },
  ...over,
});

const bags = (over: Partial<SalesPathData> = {}): SalesPathData => ({
  paths: [bag()],
  currencyNames: { 78: 'Fine Rift Essence' },
  market: new Map([[7, { name: 'Ore', buy: 100, sell: 120 }]]),
  wallet: { 1: 0, [ESSENCE]: 100 },
  leftOut: [[ESSENCE, 'Box', 'only 4 openings are recorded']],
  asOf: '2026-11-26',
  contentDates: { from: '2026-10-27', to: '2026-11-26' },
  ...over,
});

describe('containers bought with a currency', () => {
  it('are worth their average contents, bound ones at vendor value', () => {
    const [sale] = planSalesPaths(bags()).sales;
    // 2 ore at 100c less 15%, and half a trinket at 6c.
    expect([sale!.units, sale!.profits[0]]).toEqual([10, 173]);
    expect(sale!.expected).toEqual([
      { name: 'Ore', sell: 20, vendor: 0, revenue: 1700 },
      { name: 'Trinket', sell: 0, vendor: 5, revenue: 30 },
    ]);
  });

  it('sell no more of an item than its volume cap, between them', () => {
    const volume = (n: number) => bag({ contents: { sample: 250, source: 'x', yields: [[7, 'Ore', 2, 10, n, n]] } });
    // A cap of 7: three bags in full, then half of one's ore, the rest at 10c.
    const plan = planSalesPaths(bags({ paths: [volume(10), { ...volume(10), name: 'Sack', output: 501 }] }));
    expect(plan.sales.reduce((sum, s) => sum + s.units, 0)).toBe(4);
    expect(plan.sales.flatMap((s) => s.profits)).toEqual([170, 170, 170, 95]);
    expect(plan.binding).toContainEqual({ kind: 'contents', name: 'Bag', units: 4 });
  });

  it('walk the buy orders behind what is already being sold', () => {
    const market = new Map([[7, { name: 'Ore', buy: 100, book: [{ price: 100, quantity: 6 }, { price: 20, quantity: 100 }] }]]);
    expect(planSalesPaths(bags({ market })).sales[0]!.profits).toEqual([173, 173, 173]);
    expect(planSalesPaths(bags({ market }), { taken: new Map([[7, 4]]) }).sales[0]!.profits).toEqual([173]);
  });

  it('respect a purchase limit shared between currencies', () => {
    const limits = [['Mass', 1, 3]] as const;
    const paths = [bag({ limits }), bag({ limits, currency: 79, currencies: [[79, 10]] })];
    const plan = planSalesPaths(bags({ paths, wallet: { [ESSENCE]: 100, 79: 100 } }));
    expect(plan.sales.reduce((sum, s) => sum + s.units, 0)).toBe(3);
    expect(plan.binding[0]).toMatchObject({ kind: 'limit', perWeek: 3 });
  });

  it('count without being asked when no gold is needed, unless turned off', () => {
    const sales = planSales([], { paths: bags(), target: 200 });
    expect(sales.lines.map((l) => [l.name, l.quantity])).toEqual([['Bag', 2]]);
    expect(planSales([], { paths: bags(), spend: false }).lines).toEqual([]);
    const markdown = renderSales(sales);
    expect(markdown).toContain('Buy 2 × Bag from Trader, open them and sell what is inside to buy orders');
    expect(markdown).toContain('Spends 20 Fine Rift Essence');
    expect(markdown).toContain('No gold needed up front');
    expect(markdown).toContain('Expect about 4 × Ore, 1 × Trinket');
    expect(markdown).toContain('An average of 250 openings recorded on the wiki page Bag/Drop rate');
    expect(markdown).toContain('Container contents are random');
    expect(markdown).toContain('Left out, only 4 openings are recorded: Box.');
  });

  it('need asking for when gold has to be paid first', () => {
    const paid = bags({ paths: [bag({ currencies: [[1, 50], [ESSENCE, 10]] })], wallet: { 1: 1000, [ESSENCE]: 100 } });
    const off = planSales([], { paths: paid });
    expect(off.lines).toEqual([]);
    expect(off.paths!.withheld).toMatchObject({ profit: 1230, upfront: 500, names: ['Bag'], units: 10 });
    expect(planSales([], { paths: paid, upfront: true }).lines[0]!.revenue).toBe(1230);
  });

  it('leave account-bound currencies the plan holds back', () => {
    const data = bags({ itemCurrencies: [ESSENCE] });
    expect(planSales([], { paths: data, reserve: new Map([[ESSENCE, 80]]) }).lines[0]!.quantity).toBe(2);
  });
});

describe('vendor goods bought with a currency', () => {
  it('are bought and sold in the batches the vendor sells', () => {
    const flower = path(1, 'Axe', { batch: 10, crafts: [], items: [], currencies: [[FAVOR, 12]], vendor: 'Ward' });
    const sales = planSales([], { paths: data({ paths: [flower], wallet: { [FAVOR]: 30 } }) });
    // A volume cap of 3 still allows one lot.
    expect([sales.lines[0]!.quantity, sales.lines[0]!.revenue]).toEqual([1, 85_000]);
    expect(renderSales(sales)).toContain('Buy 10 × Axe from Ward and sell to buy orders');
  });
});
