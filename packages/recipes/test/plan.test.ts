import { describe, expect, it } from 'vitest';
import { parsePlan, planFromData, solvePlan, updatePlan, withHoldings, type RecipeData, type SolvedPlan, type SourceRecipe } from '../src/index.js';

const craft = (id: number, ingredients: [number, number][], output_count = 1): SourceRecipe => ({
  source: 'crafting',
  id,
  disciplines: ['Artificer'],
  min_rating: 400,
  output_count,
  ingredients: ingredients.map(([item, count]) => ({ type: 'Item', id: item, count })),
});

const forge = (ingredients: [number, number][]): SourceRecipe => ({ ...craft(0, ingredients), source: 'mystic-forge', disciplines: [], min_rating: 0 });

// A tradeable goal with two forge recipes that gold can't compare: each needs
// an unpriced token. Both use Bar, which two parents share.
function data(): RecipeData {
  return {
    version: 1,
    rootId: 1,
    maxDepth: 10,
    fetchedAt: '2026-11-26T00:00:00.000Z',
    items: {
      1: { name: 'Sword', sell: 10 },
      2: { name: 'Hilt' },
      3: { name: 'Desert Gift', bound: true },
      4: { name: 'Jungle Gift', bound: true },
      5: { name: 'Bar', sell: 100 },
      6: { name: 'Ore', sell: 5 },
    },
    searched: [1, 2, 3, 4, 5, 6],
    recipes: {
      1: [forge([[2, 1], [3, 1], [5, 3]]), forge([[2, 1], [4, 1], [5, 3]])],
      2: [craft(10, [[5, 3]])],
      5: [craft(11, [[6, 10]], 5)],
    },
    currencies: { 1: 'Coin', 2: 'Karma' },
    guildUpgrades: {},
    vendors: {
      3: { url: 'https://wiki.guildwars2.com/wiki/Desert_Gift', offers: [{ quantity: 1, costs: [{ kind: 'Currency', id: 2, name: 'Karma', amount: 500 }, { kind: 'Currency', id: 1, name: 'Coin', amount: 40 }], vendors: ['A'], caps: { daily: 1 } }] },
    },
    vendorUnmatched: [],
    status: {},
  };
}

const desert = () => updatePlan(planFromData(data()), { choose: { Sword: 'Desert Gift' } }).plan;

const step = (solved: SolvedPlan, name: string) => solved.steps.find((s) => s.name === name);

describe('solvePlan', () => {
  it('makes the goal even when it is cheaper to buy, and flags the recipe choice', () => {
    const solved = solvePlan(planFromData(data()));
    expect(step(solved, 'Sword')).toMatchObject({ action: 'forge', undecided: true });
  });

  it('sums demand for a shared item before rounding up crafts', () => {
    const solved = solvePlan(planFromData(data()));
    // 3 for the sword + 3 for the hilt = 6 bars: 2 crafts of 5, not 1 each.
    expect(step(solved, 'Bar')).toMatchObject({ action: 'craft', need: 6, times: 2 });
    expect(step(solved, 'Ore')).toMatchObject({ need: 20, coin: 100 });
    expect(step(solved, 'Bar')!.components.sort()).toEqual(['i2', 'i5']);
  });

  it('totals coin once, including the coin part of vendor prices', () => {
    const solved = solvePlan(desert());
    expect(step(solved, 'Desert Gift')).toMatchObject({ action: 'vendor', coin: 40, caps: { daily: 1 }, bound: true });
    expect(solved.coin).toBe(140);
  });

  it('orders consumers before what they consume', () => {
    const solved = solvePlan(planFromData(data()));
    const keys = solved.steps.map((s) => s.key);
    for (const s of solved.steps) for (const i of s.inputs) if (i.key !== 'c1') expect(keys.indexOf(i.key)).toBeGreaterThan(keys.indexOf(s.key));
  });

  it('takes holdings and finished steps out, but never counts an owned goal', () => {
    let plan = withHoldings(desert(), { items: { 1: 1, 5: 4, 999: 3 }, wallet: { 2: 200, 99: 5 } });
    expect(plan.holdings).toEqual({ items: { 1: 1, 5: 4 }, wallet: { 2: 200 } });
    let solved = solvePlan(plan);
    expect(step(solved, 'Sword')!.count).toBe(1);
    expect(step(solved, 'Bar')).toMatchObject({ owned: 4, count: 2, times: 1 });
    expect(step(solved, 'Karma')).toMatchObject({ owned: 200, count: 300 });

    plan = updatePlan(plan, { done: ['Hilt'] }).plan;
    solved = solvePlan(plan);
    expect(step(solved, 'Hilt')).toMatchObject({ action: 'have', done: true, inputs: [] });
    expect(step(solved, 'Bar')).toMatchObject({ need: 3, count: 0, action: 'have' });
    expect(step(solved, 'Ore')).toBeUndefined();
  });
});

describe('updatePlan', () => {
  it('chooses a recipe by an ingredient name, through JSON', () => {
    const { plan, errors } = updatePlan(planFromData(data()), { choose: { sword: 'Jungle Gift' }, notes: { i4: { text: 'Meta event reward' } } });
    expect(errors).toEqual([]);
    const solved = solvePlan(parsePlan(JSON.stringify(plan)));
    expect(step(solved, 'Sword')!.undecided).toBe(false);
    expect(step(solved, 'Jungle Gift')).toMatchObject({ action: 'earn', note: { text: 'Meta event reward' } });
    expect(step(solved, 'Desert Gift')).toBeUndefined();
  });

  it('lets a tradeable item be earned instead of bought', () => {
    const { plan } = updatePlan(planFromData(data()), { choose: { Ore: 'earn' } });
    expect(step(solvePlan(plan), 'Ore')).toMatchObject({ action: 'earn', coin: 0 });
  });

  it('reports what it cannot apply', () => {
    const { plan, errors } = updatePlan(planFromData(data()), { choose: { Sword: 'forge', Nothing: 'buy' }, done: ['Nope'] });
    expect(plan.choices).toEqual({});
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('matches several routes');
  });

  it('rejects other JSON', () => {
    expect(() => parsePlan('{"version":1}')).toThrow('Not a version 1 crafting plan');
  });
});

describe('items only an alternative vendor offer charges', () => {
  const withToken = (): RecipeData => {
    const d = data();
    d.vendors[3]!.offers.push({ quantity: 1, costs: [{ kind: 'Item', id: 77, name: 'Token', amount: 5 }], vendors: ['B'], caps: {} });
    return d;
  };

  it('can be held and named', () => {
    const plan = withHoldings(planFromData(withToken()), { items: { 77: 3 }, wallet: {} });
    expect(plan.holdings.items).toEqual({ 77: 3 });
    const { plan: chosen, errors } = updatePlan(plan, { choose: { Sword: 'Desert Gift', 'Desert Gift': 'vendor:1' }, done: ['Token'] });
    expect(errors).toEqual([]);
    expect(chosen.done).toEqual(['i77']);
  });
});

describe('plan settings', () => {
  const solve = (plan: ReturnType<typeof desert>, settings: Record<string, boolean>) => {
    const result = updatePlan(plan, { settings });
    expect(result.errors).toEqual([]);
    return solvePlan(parsePlan(JSON.stringify(result.plan)));
  };

  it('can ignore owned materials, and always says what they are worth', () => {
    const plan = withHoldings(desert(), { items: { 6: 20 }, wallet: {} });
    const using = solve(plan, {});
    expect([using.coin, using.fullCoin]).toEqual([40, 140]);
    const ignoring = solve(plan, { useOwnMaterials: false });
    expect([ignoring.coin, ignoring.fullCoin]).toEqual([140, 140]);
    expect(step(ignoring, 'Ore')).toMatchObject({ owned: 0, count: 20 });
  });

  it('stops scheduling daily crafts when asked', () => {
    const d = data();
    // 46742 is Lump of Mithrillium, one of the daily items.
    d.items[46742] = { name: 'Lump', bound: true };
    d.searched.push(46742);
    d.recipes[2] = [craft(10, [[46742, 3]])];
    d.recipes[46742] = [craft(12, [[6, 1]])];
    const plan = planFromData(d);
    expect(step(solvePlan(plan), 'Lump')).toMatchObject({ action: 'craft', perDay: 1, count: 3 });
    const off = solve(plan, { dailyCrafts: false });
    expect(step(off, 'Lump')).toMatchObject({ action: 'earn', inputs: [] });
    expect(step(off, 'Lump')!.perDay).toBeUndefined();
  });

  it('uses promotions only when on, treating their stones as costing no gold', () => {
    const d = data();
    d.items[7] = { name: 'Fine Ore', sell: 1000 };
    d.items[20796] = { name: "Philosopher's Stone" };
    d.searched.push(7, 20796);
    d.recipes[2] = [craft(10, [[7, 12]])];
    d.promotions = { 7: [{ ...forge([[6, 50], [20796, 5]]), output_count: 6 }] };
    const plan = planFromData(d);
    expect(step(solvePlan(plan), 'Fine Ore')!.action).toBe('buy');
    expect(step(solve(plan, { forgePromotions: true }), 'Fine Ore')).toMatchObject({ action: 'forge', times: 2, route: { promotion: true } });
  });

  it('rejects settings it does not know', () => {
    const result = updatePlan(planFromData(data()), { settings: { nope: true, forgePromotions: true } as never });
    expect(result.errors).toHaveLength(2);
  });
});
