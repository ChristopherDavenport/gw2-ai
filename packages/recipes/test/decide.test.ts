import { describe, expect, it } from 'vitest';
import { FORGE_POOLS, planFromData, solvePlan, updatePlan, withHoldings, type CraftingPlan, type RecipeData, type SolvedPlan, type SourceRecipe } from '../src/index.js';

const recipe = (id: number, ingredients: [number, number][], output_count = 1): SourceRecipe => ({
  source: 'crafting',
  id,
  disciplines: ['Artificer'],
  min_rating: 400,
  output_count,
  ingredients: ingredients.map(([item, count]) => ({ type: 'Item', id: item, count })),
});

const empty = (items: RecipeData['items']): RecipeData => ({
  version: 1,
  rootId: 1,
  maxDepth: 10,
  fetchedAt: '2026-11-26T00:00:00.000Z',
  items,
  searched: [],
  recipes: {},
  currencies: { 1: 'Coin', 2: 'Karma', 34: 'Trade Contract', 45: 'Volatile Magic' },
  guildUpgrades: {},
  vendors: {},
  vendorUnmatched: [],
  status: {},
});

const own = (plan: CraftingPlan, items: Record<number, number>, wallet: Record<number, number> = {}) =>
  withHoldings(plan, { items, wallet, fetchedAt: '2026-11-26T00:00:00.000Z' });
const step = (solved: SolvedPlan, key: string) => solved.steps.find((s) => s.key === key)!;
const used = (solved: SolvedPlan, key: string) => step(solved, key).inputs.map((i) => [i.key, i.count]);

const currency = (id: number, amount: number) => ({ kind: 'Currency' as const, id, name: `c${id}`, amount });
const offer = (...costs: ReturnType<typeof currency>[]) => ({ quantity: 1, costs, vendors: ['A'], caps: {} });

// A sword takes 10 tributes (sold for Volatile Magic or Trade Contracts) and a
// badge, which only takes Volatile Magic.
function vendors(): CraftingPlan {
  const data = empty({ 1: { name: 'Sword' }, 2: { name: 'Tribute' }, 3: { name: 'Badge' } });
  data.recipes = { 1: [recipe(1, [[2, 10], [3, 1]])] };
  data.vendors = {
    2: { url: 'u', offers: [offer(currency(45, 20)), offer(currency(34, 20))] },
    3: { url: 'u', offers: [offer(currency(45, 100))] },
  };
  return planFromData(data);
}

describe('vendor offers follow the wallet', () => {
  it('keeps the default without holdings, and when it is covered', () => {
    expect(used(solvePlan(vendors()), 'i2')).toEqual([['c45', 200]]);
    const solved = solvePlan(own(vendors(), {}, { 45: 300, 34: 999 }));
    expect(used(solved, 'i2')).toEqual([['c45', 200]]);
    expect(step(solved, 'i2').usual).toBeUndefined();
  });

  it('reserves what other steps need first, then takes an offer that is covered', () => {
    // 250 Volatile Magic would cover the tributes, but 100 of it is the badge's.
    const solved = solvePlan(own(vendors(), {}, { 45: 250, 34: 200 }));
    expect(used(solved, 'i2')).toEqual([['c34', 200]]);
    expect(step(solved, 'i2').usual?.key).toBe('vendor:0');
    expect(step(solved, 'c45')).toMatchObject({ need: 100, count: 0 });
  });

  it('takes the offer shortest by least when none is covered', () => {
    expect(used(solvePlan(own(vendors(), {}, { 45: 150, 34: 150 })), 'i2')).toEqual([['c34', 200]]);
    expect(used(solvePlan(own(vendors(), {}, { 45: 100 })), 'i2')).toEqual([['c45', 200]]);
  });

  it('keeps a preferred currency unless something else is covered', () => {
    const plan = vendors();
    plan.data.vendors[2]!.preferred = true;
    expect(used(solvePlan(own(plan, {}, { 45: 100, 34: 150 })), 'i2')).toEqual([['c45', 200]]);
    expect(used(solvePlan(own(plan, {}, { 34: 200 })), 'i2')).toEqual([['c34', 200]]);
  });

  it('never overrides a choice', () => {
    const chosen = updatePlan(vendors(), { choose: { Tribute: 'vendor:0' } }).plan;
    expect(used(solvePlan(own(chosen, {}, { 34: 999 })), 'i2')).toEqual([['c45', 200]]);
  });
});

// A gem (sells for 100) is forged from a dust and 9 orbs, or 75 and 5 ectos for
// 11.5, from any of three kinds of orb. A crown takes `gems` of them.
function gems(count: number): CraftingPlan {
  const data = empty({
    1: { name: 'Crown' },
    10: { name: 'Gem', sell: 100, buy: 90 },
    11: { name: 'Dust', sell: 10, buy: 8 },
    12: { name: 'Ecto', sell: 20, buy: 18 },
    20: { name: 'Red Orb', sell: 20, buy: 10 },
    21: { name: 'Blue Orb', sell: 15, buy: 12 },
    22: { name: 'Gold Orb', sell: 900, buy: 800 },
  });
  const pool = { stacks: 3, label: 'orbs', items: [20, 21, 22] };
  const forge = (fixed: [number, number], stack: number, output: number): SourceRecipe => ({
    ...recipe(0, [fixed], output),
    source: 'mystic-forge',
    pool: { ...pool, stack },
  });
  data.recipes = {
    1: [recipe(1, [[10, count]])],
    // The wiki's one variant, which the pool recipe covers.
    10: [{ ...recipe(0, [[11, 1], [20, 9]]), source: 'mystic-forge' }],
  };
  data.pools = { 10: [forge([11, 1], 3, 1), forge([12, 5], 25, 11.5)] };
  return planFromData(data);
}

describe('pool forges', () => {
  it('weighs the forms for the quantity needed, buying the cheapest orb', () => {
    // One gem: buying (100) beats a whole bulk forge, though its unit cost is lower.
    const one = step(solvePlan(gems(1)), 'i10');
    expect(one.action).toBe('buy');
    // The wiki's single variant is covered by the pool recipe, so it isn't a route of its own.
    expect(one.options.map((o) => o.key).sort()).toEqual(['earn', 'forge:1x11+9xany', 'forge:5x12+75xany']);
    // 23 gems: two bulk forges (2 × 1,225) cost more than buying them (2,300).
    expect(step(solvePlan(gems(23)), 'i10').action).toBe('buy');
    const cheap = gems(23);
    cheap.data.items[21]!.sell = 5;
    expect(step(solvePlan(cheap), 'i10')).toMatchObject({ action: 'forge', times: 2 });
    expect(used(solvePlan(cheap), 'i10')).toEqual([['i12', 10], ['i21', 150]]);
  });

  it('fills from spare orbs, cheapest first and in whole stacks, before buying', () => {
    const solved = solvePlan(own(gems(23), { 20: 60, 21: 40, 22: 500 }));
    expect(step(solved, 'i10')).toMatchObject({ action: 'forge', times: 2 });
    // 150 orbs: Red (worth less) in two stacks of 25, Blue in one, the rest bought as Blue.
    // Gold is worth more than a bought orb, so it is not used.
    expect(used(solved, 'i10')).toEqual([['i12', 10], ['i20', 50], ['i21', 100]]);
    // All 40 Blue count: the bought ones fill up the same stacks.
    expect(step(solved, 'i21')).toMatchObject({ action: 'buy', owned: 40, count: 60 });
    expect(step(solved, 'i22')).toBeUndefined();
  });

  it('ships the gemstone pool: two forms over the same items', () => {
    expect(FORGE_POOLS.map((p) => [p.output, p.count, p.stack, p.items.length])).toEqual([
      [68063, 1, 3, 25],
      [68063, 11.5, 25, 25],
    ]);
  });
});

// An ingot takes an ore; both can be bought. Owned ore sells for 51 after fees.
function ingots(count: number): CraftingPlan {
  const data = empty({ 1: { name: 'Anvil' }, 5: { name: 'Ingot', sell: 100, buy: 90 }, 6: { name: 'Ore', sell: 110, buy: 60 } });
  data.recipes = { 1: [recipe(1, [[5, count]])], 5: [recipe(5, [[6, 1]])] };
  return planFromData(data);
}

describe('owned materials are used before selling them', () => {
  it('values owned units at what they would sell for, and the rest at the buy price', () => {
    expect(step(solvePlan(ingots(10)), 'i5').action).toBe('buy');
    expect(step(solvePlan(own(ingots(10), { 6: 10 })), 'i5')).toMatchObject({ action: 'craft', usual: { key: 'buy' } });
    // 1 owned at 51 and 9 bought at 110 costs more than 10 ingots at 100; 2 and 8 cost less.
    expect(step(solvePlan(own(ingots(10), { 6: 1 })), 'i5').action).toBe('buy');
    expect(step(solvePlan(own(ingots(10), { 6: 2 })), 'i5').action).toBe('craft');
  });

  it('counts an unsellable item as free, and leaves what other steps need', () => {
    const plan = ingots(10);
    plan.data.recipes[1] = [recipe(1, [[5, 10], [6, 8]])];
    // 8 of 9 are the anvil's, which leaves one for the ingots.
    expect(step(solvePlan(own(plan, { 6: 9 })), 'i5').action).toBe('buy');
    plan.data.items[6]!.bound = true;
    expect(step(solvePlan(own(plan, { 6: 18 })), 'i5').action).toBe('craft');
  });

  it('does nothing with own materials off or a route chosen', () => {
    const off = updatePlan(own(ingots(10), { 6: 10 }), { settings: { useOwnMaterials: false } }).plan;
    expect(step(solvePlan(off), 'i5').action).toBe('buy');
    const chosen = updatePlan(own(ingots(10), { 6: 10 }), { choose: { Ingot: 'buy' } }).plan;
    expect(step(solvePlan(chosen), 'i5').action).toBe('buy');
  });

  it('does not add days of daily crafting to save gold', () => {
    // Charged Quartz Crystal (43772) can be crafted once a day.
    const data = empty({ 1: { name: 'Anvil' }, 43772: { name: 'Crystal', sell: 100, buy: 90 }, 6: { name: 'Ore', sell: 110, buy: 60 } });
    data.recipes = { 1: [recipe(1, [[43772, 5]])], 43772: [recipe(5, [[6, 1]])] };
    expect(step(solvePlan(own(planFromData(data), { 6: 5 })), 'i43772').action).toBe('buy');
  });
});

describe('goal priority', () => {
  // Two goals, each wanting 10 tributes; Trade Contracts cover only one lot.
  function two(): CraftingPlan {
    const data = empty({ 1: { name: 'Sword' }, 2: { name: 'Axe' }, 3: { name: 'Hilt' }, 4: { name: 'Haft' } });
    data.recipes = { 1: [recipe(1, [[3, 10]])], 2: [recipe(2, [[4, 10]])] };
    const offers = [offer(currency(45, 20)), offer(currency(34, 20))];
    data.vendors = { 3: { url: 'u', offers }, 4: { url: 'u', offers } };
    return planFromData(data, [{ itemId: 1 }, { itemId: 2 }]);
  }

  it('gives the wallet to the earlier goal, and follows a new order', () => {
    const plan = own(two(), {}, { 34: 200 });
    expect(used(solvePlan(plan), 'i3')).toEqual([['c34', 200]]);
    expect(used(solvePlan(plan), 'i4')).toEqual([['c45', 200]]);
    const { plan: swapped, errors } = updatePlan(plan, { order: ['Axe'] });
    expect(errors).toEqual([]);
    expect(swapped.goals.map((g) => g.name)).toEqual(['Axe', 'Sword']);
    expect(used(solvePlan(swapped), 'i4')).toEqual([['c34', 200]]);
    expect(used(solvePlan(swapped), 'i3')).toEqual([['c45', 200]]);
  });

  it('reports names it cannot order and keeps the rest', () => {
    const { plan, errors } = updatePlan(two(), { order: ['Hilt', 'Nope', 'i2', 'Axe'] });
    expect(plan.goals.map((g) => g.name)).toEqual(['Axe', 'Sword']);
    expect(errors).toEqual(['"Hilt" is not something this plan makes.', 'No step named "Nope".']);
  });
});
