/** The list of items picked for a crafting plan. Pure. */
import type { PlanGoal } from '@gw2kit/recipes';
import { MAX_QUANTITY } from './plan-input.js';

export type SelectedGoal = PlanGoal;

/** The list with `goal` added; an item already on it gets the extra quantity. */
export function addToSelection(selection: readonly SelectedGoal[], goal: SelectedGoal): SelectedGoal[] {
  const existing = selection.find((g) => g.itemId === goal.itemId);
  const quantity = (existing?.quantity ?? 0) + goal.quantity;
  if (quantity > MAX_QUANTITY) throw new Error(`A plan makes at most ${MAX_QUANTITY} of one item.`);
  return existing ? selection.map((g) => (g === existing ? { ...g, quantity } : g)) : [...selection, goal];
}

/** `value` when it is an image on the game's render service, the one image host the page allows. */
export function iconUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.origin === 'https://render.guildwars2.com' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
