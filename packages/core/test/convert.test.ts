import { describe, expect, it } from 'vitest';
import { planConversions, planSales, promotionRecipes, renderSales, type ConversionData, type MarketItem, type Sellable } from '../src/index.js';

const market = (over: Record<number, MarketItem> = {}): Map<number, MarketItem> =>
  new Map(
    Object.entries({
      1: { name: 'Ore', buy: 100, sell: 110 },
      2: { name: 'Ingot', buy: 400, sell: 440 },
      3: { name: 'Reagent', buy: 5, sell: 10 },
      ...over,
    }).map(([id, item]) => [Number(id), item]),
  );

const ingot: ConversionData['recipes'][number] = { kind: 'craft', output: 2, count: 1, inputs: [[1, 2]], disciplines: ['Weaponsmith'], rating: 400 };

describe('planConversions', () => {
  it('crafts when the result sells for more than its materials', () => {
    const [c] = planConversions(new Map([[1, 200]]), { recipes: [ingot], market: market() }, { minGain: 0 });
    // 100 ingots at 4s less 15% = 340s; 200 ore as they are = 170s.
    expect(c).toMatchObject({ crafts: 100, units: 100, revenue: 34_000, gain: 17_000, buys: [] });
  });

  it('stops where the buy orders for the result run out of value', () => {
    const thin = market({ 2: { name: 'Ingot', buy: 400, sell: 440, book: [{ price: 400, quantity: 10 }, { price: 10, quantity: 500 }] } });
    const [c] = planConversions(new Map([[1, 200]]), { recipes: [ingot], market: thin }, { minGain: 0 });
    expect(c!.crafts).toBe(10);
  });

  it('buys small parts, but not more than the materials are worth', () => {
    const recipe = { ...ingot, inputs: [[1, 2], [3, 1]] as const };
    const [c] = planConversions(new Map([[1, 20]]), { recipes: [recipe], market: market() }, { minGain: 0 });
    expect(c!.buys).toEqual([{ id: 3, name: 'Reagent', count: 10, cost: 100 }]);
    const dear = market({ 3: { name: 'Reagent', buy: 900, sell: 1000 } });
    expect(planConversions(new Map([[1, 20]]), { recipes: [recipe], market: dear }, { minGain: 0 })).toEqual([]);
  });

  it('does not use the same materials twice', () => {
    const other = { ...ingot, output: 3 };
    const prices = market({ 3: { name: 'Plate', buy: 300, sell: 330 } });
    const found = planConversions(new Map([[1, 200]]), { recipes: [other, ingot], market: prices }, { minGain: 0 });
    expect(found.map((c) => c.name)).toEqual(['Ingot']);
  });

  it('counts a promotion in Spirit Shards, needs one to start, and respects the wallet', () => {
    // 20796 is the Philosopher's Stone, 10 per shard.
    const recipe = { kind: 'promote' as const, output: 2, count: 6, inputs: [[1, 50], [20796, 5]] as const };
    const data = { recipes: [recipe], market: market({ 2: { name: 'Claw', buy: 2000, sell: 2200 } }) };
    const [c] = planConversions(new Map([[1, 100]]), data, { minGain: 0 });
    expect(c).toMatchObject({ crafts: 2, units: 13, spiritShards: 1, buys: [{ id: 2, count: 1, cost: 2200 }] });
    expect(planConversions(new Map([[1, 100], [2, 1]]), data, { minGain: 0 })[0]!.buys).toEqual([]);
    expect(planConversions(new Map([[1, 100]]), { ...data, spiritShards: 0 }, { minGain: 0 })).toEqual([]);
  });

  it('promotes only material the player has, never material bought for it', () => {
    const recipe = { kind: 'promote' as const, output: 2, count: 6, inputs: [[1, 50], [3, 5]] as const };
    const data = { recipes: [recipe], market: market({ 2: { name: 'Claw', buy: 9000, sell: 9900 } }) };
    // Plenty of the small part, too little of the lower tier.
    expect(planConversions(new Map([[1, 49], [2, 1], [3, 5000]]), data, { minGain: 0 })).toEqual([]);
  });

  it('has the bundled promotion snapshot', () => {
    expect(promotionRecipes().length).toBeGreaterThan(50);
  });
});

describe('planSales with conversions', () => {
  const ore: Sellable = { id: 1, name: 'Ore', count: 300, material: true, vendor: 0, buy: 100, sell: 110 };

  it('sells the converted result, and only the leftovers as they are', () => {
    const sales = planSales([ore], { conversions: { recipes: [ingot], market: market() }, reserve: new Map([[1, 99]]) });
    // 201 spare: 100 ingots from 200, and 1 ore left over.
    expect(sales.lines.map((l) => [l.name, l.quantity])).toEqual([['Ingot', 100], ['Ore', 1]]);
    expect(renderSales(sales)).toContain('Craft 100 × Ingot (Weaponsmith 400) from 200 × Ore');
  });

  it('does not fill the same buy orders with held and converted copies', () => {
    const book = [{ price: 400, quantity: 100 }];
    const ingots: Sellable = { id: 2, name: 'Ingot', count: 100, material: true, vendor: 0, buy: 400, sell: 440, book };
    const prices = market({ 2: { name: 'Ingot', buy: 400, sell: 440, book } });
    const sales = planSales([ore, ingots], { conversions: { recipes: [ingot], market: prices } });
    // 100 orders exist: the converted ingots take them, so the held ones have no buyer.
    expect(sales.lines.filter((l) => l.name === 'Ingot')).toHaveLength(1);
  });

  it('does not craft something that is to be kept', () => {
    const sales = planSales([ore], { conversions: { recipes: [ingot], market: market() }, keep: ['Ingot'] });
    expect(sales.lines.map((l) => l.name)).toEqual(['Ore']);
  });

  it('never converts what is kept', () => {
    expect(planSales([ore], { conversions: { recipes: [ingot], market: market() }, keep: ['Ore'] }).lines).toEqual([]);
  });
});
