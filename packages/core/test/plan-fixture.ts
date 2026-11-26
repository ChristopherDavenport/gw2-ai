import { planFromData, type CraftingPlan, type RecipeData, type SourceRecipe } from '@gw2kit/recipes';

const forge = (ingredients: [number, number][]): SourceRecipe => ({
  source: 'mystic-forge',
  id: 0,
  disciplines: [],
  min_rating: 0,
  output_count: 1,
  ingredients: ingredients.map(([id, count]) => ({ type: 'Item', id, count })),
});

/** A sword with two forge recipes that gold can't compare, one part made and one only earned. */
export function swordPlan(): CraftingPlan {
  const data: RecipeData = {
    version: 1,
    rootId: 1,
    maxDepth: 10,
    fetchedAt: '2026-11-26T00:00:00.000Z',
    items: { 1: { name: 'Sword' }, 2: { name: 'Hilt' }, 3: { name: 'Desert Gift' }, 4: { name: 'Jungle Gift' }, 5: { name: 'Bar', sell: 100 } },
    searched: [1, 2, 3, 4, 5],
    recipes: {
      1: [forge([[2, 1], [3, 1]]), forge([[2, 1], [4, 1]])],
      2: [{ ...forge([[5, 3]]), source: 'crafting', id: 10, disciplines: ['Artificer'], min_rating: 400 }],
    },
    currencies: {},
    guildUpgrades: {},
    vendors: {},
    vendorUnmatched: [],
    status: {},
  };
  return planFromData(data);
}
