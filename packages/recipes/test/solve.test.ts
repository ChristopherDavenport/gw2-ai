import { describe, expect, it } from 'vitest';
import { flattenLeaves, solveRecipeTree, stockUsed, type RecipeData, type SourceRecipe } from '../src/index.js';

// Fetching is tested against fake API and wiki responses in @gw2-ai/core; these
// tests solve hand-written RecipeData with no requests at all.

const craft = (id: number, ingredients: [number, number][], output_count = 1): SourceRecipe => ({
  source: 'crafting',
  id,
  disciplines: ['Artificer'],
  min_rating: 400,
  output_count,
  ingredients: ingredients.map(([item, count]) => ({ type: 'Item', id: item, count })),
});

function data(over: Partial<RecipeData> = {}): RecipeData {
  return {
    version: 1,
    rootId: 100,
    maxDepth: 10,
    fetchedAt: '2026-11-15T00:00:00.000Z',
    items: {
      100: { name: 'Widget', sell: 1000 },
      200: { name: 'Bar', sell: 100 },
      300: { name: 'Gem', sell: 300 },
      400: { name: 'Ore', sell: 5 },
      500: { name: 'Clover' },
      600: { name: 'Stone' },
    },
    searched: [100, 200, 300, 400, 500, 600],
    recipes: {
      // 2 bars + 1 gem; one craft of bars makes 5 from 10 ore.
      100: [craft(1, [[200, 2], [300, 1]])],
      200: [craft(3, [[400, 10]], 5)],
      // Chance-based forge: 0.5 clovers per forge on average.
      500: [{ ...craft(0, [[400, 1], [600, 2]], 0.5), source: 'mystic-forge', disciplines: [], min_rating: 0, wiki: { name: 'Clover Average', url: 'https://wiki.guildwars2.com/wiki/Clover' } }],
    },
    currencies: { 1: 'Coin', 23: 'Spirit Shard' },
    guildUpgrades: {},
    vendors: {
      600: {
        url: 'https://wiki.guildwars2.com/wiki/Stone',
        offers: [
          { quantity: 10, costs: [{ kind: 'Currency', id: 23, name: 'Spirit Shard', amount: 1 }], vendors: ['Miyani'], caps: {} },
          { quantity: 1, costs: [{ kind: 'Currency', id: 1, name: 'Coin', amount: 50 }], vendors: ['Somebody'], caps: { weekly: 5 } },
        ],
      },
    },
    vendorUnmatched: [],
    status: { mysticForge: { status: 'ok' }, vendors: { status: 'ok' } },
    ...over,
  };
}

describe('solveRecipeTree', () => {
  it('decides craft vs buy per node from the fetched prices', () => {
    const tree = solveRecipeTree(data(), 2);
    // 4 bars = 1 craft of 5 (10 ore, 50c) + 2 gems (600c) = 650c, cheaper than 2000c.
    expect(tree).toMatchObject({ best: 'craft', cost: 650, buyPrice: 2000, recipe: { id: 1, crafts: 2 } });
    expect(flattenLeaves(tree).map((l) => [l.name, l.count, l.cost])).toEqual([
      ['Gem', 2, 600],
      ['Ore', 10, 50],
    ]);
    expect(tree.mysticForge).toEqual({ status: 'ok' });
  });

  it('solves the same tree from data that went through JSON', () => {
    const d = data();
    const again = JSON.parse(JSON.stringify(d)) as RecipeData;
    expect(solveRecipeTree(again, 3)).toEqual(solveRecipeTree(d, 3));
  });

  it('uses holdings first and does not mutate them', () => {
    const have = new Map([[200, 2]]);
    const tree = solveRecipeTree(data(), 1, { have });
    expect(tree.cost).toBe(300);
    expect(stockUsed(tree)).toEqual([{ itemId: 200, name: 'Bar', count: 2 }]);
    expect(have.get(200)).toBe(2);
  });

  it('costs chance-based forges at the average yield and vendor items in currencies', () => {
    const tree = solveRecipeTree(data({ rootId: 500 }), 3);
    // 3 clovers at 0.5 per forge = 6 forges: 6 ore and 12 stones; stones come 10 per Spirit Shard.
    expect(tree.recipe).toMatchObject({ source: 'mystic-forge', crafts: 6 });
    const stone = tree.children.find((c) => c.itemId === 600)!;
    expect(stone).toMatchObject({ best: 'vendor', count: 12, vendor: { purchases: 2, offer: { vendors: ['Miyani'] } } });
    expect(stone.vendor?.alternatives).toHaveLength(1);
    expect(flattenLeaves(tree).map((l) => [l.kind, l.name, l.count])).toEqual([
      ['Item', 'Ore', 6],
      ['Currency', 'Spirit Shard', 2],
    ]);
    expect(tree.complete).toBe(false);
  });

  it('marks items whose vendors could not be costed', () => {
    const tree = solveRecipeTree(data({ rootId: 600, vendors: {}, vendorUnmatched: [600] }), 1);
    expect(tree).toMatchObject({ best: 'unavailable', vendorUnmatched: true });
  });
});
