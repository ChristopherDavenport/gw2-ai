import { describe, expect, it } from 'vitest';
import { addGoal, mergeLookups, parsePlan, planFromData, solvePlan, updatePlan, withHoldings, type RecipeData, type SolvedPlan, type SourceRecipe } from '../src/index.js';

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

describe('trading post orders', () => {
  const orders = { buys: { 5: [{ quantity: 3, price: 80 }], 999: [{ quantity: 1, price: 1 }] }, sells: { 6: [{ quantity: 7, price: 9 }] }, market: { 5: { buy: 90 }, 999: { buy: 2 } } };

  it('counts units on buy order after owned ones, and never units listed for sale', () => {
    const plan = withHoldings(desert(), { items: { 5: 1 }, wallet: {}, orders });
    expect(plan.holdings.orders).toEqual({ buys: { 5: orders.buys[5] }, sells: orders.sells, market: { 5: { buy: 90 } } });
    const solved = solvePlan(parsePlan(JSON.stringify(plan)));
    // 6 bars: 1 held, 3 on order, so 2 to make: one craft of 5 from 10 ore.
    expect(step(solved, 'Bar')).toMatchObject({ need: 6, owned: 1, ordered: 3, count: 2, times: 1 });
    expect(step(solved, 'Ore')).toMatchObject({ need: 10, owned: 0, ordered: 0, count: 10 });
    expect(solved.fullCoin).toBeGreaterThan(solved.coin);
  });

  it('covers a step wholly on order, and leaves orders out with own materials off', () => {
    let plan = withHoldings(desert(), { items: {}, wallet: {}, orders: { buys: { 5: [{ quantity: 4, price: 80 }, { quantity: 4, price: 70 }] }, sells: {} } });
    let solved = solvePlan(plan);
    expect(step(solved, 'Bar')).toMatchObject({ action: 'have', ordered: 6, count: 0 });
    expect(step(solved, 'Ore')).toBeUndefined();
    plan = updatePlan(plan, { settings: { useOwnMaterials: false } }).plan;
    solved = solvePlan(plan);
    expect(step(solved, 'Bar')).toMatchObject({ ordered: 0, count: 6 });
  });

  it('reads plans saved without orders, and rejects malformed ones', () => {
    expect(step(solvePlan(parsePlan(JSON.stringify(desert()))), 'Bar')!.ordered).toBe(0);
    expect(() => parsePlan({ ...desert(), holdings: { items: {}, wallet: {}, orders: { buys: {} } } })).toThrow('Not a crafting plan.');
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
    expect(() => parsePlan('{"version":1}')).toThrow('Not a crafting plan');
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
  it('prices purchases at buy orders when asked, and offers vendors without defaulting to them', () => {
    const d = data();
    d.items[6] = { name: 'Ore', sell: 5, buy: 3 };
    d.vendors[6] = { url: 'https://wiki.guildwars2.com/wiki/Ore', offers: [{ quantity: 1, costs: [{ kind: 'Currency', id: 2, name: 'Karma', amount: 9 }], vendors: ['B'], caps: { weekly: 5 } }] };
    const plan = planFromData(d);
    const instant = solvePlan(plan);
    expect(step(instant, 'Ore')).toMatchObject({ action: 'buy', coin: 100 });
    expect(step(instant, 'Ore')!.options.map((o) => o.action)).toContain('vendor');
    expect(step(solvePlan(updatePlan(plan, { settings: { useBuyOrders: true } }).plan), 'Ore')).toMatchObject({ coin: 60 });
    expect(step(solvePlan(updatePlan(plan, { choose: { Ore: 'karma' } }).plan), 'Ore')).toMatchObject({ action: 'vendor', coin: 0 });
  });

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

describe('mergeLookups', () => {
  it('adds late lookups without undoing what the player changed meanwhile', () => {
    const base = planFromData(data());
    const found = structuredClone(base);
    found.data.vendors[6] = { url: 'u', offers: [] };
    found.data.items[999] = { name: 'Ticket' };
    found.research = { i3: { text: 'old', source: 'u' }, i4: { text: 'new', source: 'u' } };
    const changed = { ...updatePlan(base, { done: ['Hilt'] }).plan, research: { i3: { text: 'mine', source: 'u' } } };

    const merged = mergeLookups(changed, found);
    expect(merged.done).toEqual(changed.done);
    expect(merged.data.vendors).toHaveProperty('6');
    expect(merged.data.vendors).toHaveProperty('3');
    expect(merged.data.items).toHaveProperty('999');
    expect(merged.research).toMatchObject({ i3: { text: 'mine' }, i4: { text: 'new' } });
  });

  it('ignores a plan for something else', () => {
    const other = planFromData({ ...data(), rootId: 2 });
    const plan = planFromData(data());
    expect(mergeLookups(plan, other)).toBe(plan);
  });
});

describe('several goals', () => {
  const two = () => planFromData(data(), [{ itemId: 1 }, { itemId: 2, quantity: 2 }]);

  it('sums what they share before rounding crafts', () => {
    const solved = solvePlan(two());
    // The sword needs 1 hilt, and 2 more are goals: 3 hilts, 9 bars, plus 3 for the sword.
    expect(step(solved, 'Hilt')).toMatchObject({ need: 3, goals: expect.arrayContaining(['i1', 'i2']) });
    expect(step(solved, 'Bar')).toMatchObject({ need: 12, times: 3 });
  });

  it('lets an owned copy of a goal cover other uses, never the goal itself', () => {
    const solved = solvePlan(withHoldings(two(), { items: { 2: 5 }, wallet: {} }));
    expect(step(solved, 'Hilt')).toMatchObject({ need: 3, owned: 1, count: 2 });
  });

  it('changes and removes quantities, keeping at least one goal', () => {
    const removed = updatePlan(two(), { quantities: { Hilt: 0 } });
    expect(removed.plan.goals.map((g) => g.name)).toEqual(['Sword']);
    expect(updatePlan(removed.plan, { quantities: { Sword: 0 } }).errors).toHaveLength(1);
    expect(updatePlan(two(), { quantities: { Sword: 3, Ore: 1 } }).errors).toHaveLength(1);
  });

  it('reads a version 1 plan', () => {
    const { goals, ...rest } = planFromData(data());
    expect(parsePlan({ ...rest, version: 1, goal: goals[0] }).goals).toEqual(goals);
  });

  it('adds to the quantity of a goal already there without fetching', async () => {
    const plan = await addGoal(undefined as never, two(), 1, 2);
    expect(plan.goals[0]).toMatchObject({ itemId: 1, quantity: 3 });
  });
});
