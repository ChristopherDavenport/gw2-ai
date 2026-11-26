/**
 * Keeps the current crafting plan in IndexedDB so a reload keeps it. A plan can
 * carry holdings read with the API key (item counts and wallet balances, never
 * the key); forgetting the key removes them.
 */
import type { CraftingPlan } from '@gw2kit/recipes';
import { withStore } from './idb.js';

export const PLAN_DB = 'gw2-ai-plan';
export const PLAN_STORE = 'plan';
const RECORD_KEY = 'current';

export async function savePlan(plan: CraftingPlan): Promise<void> {
  await withStore(PLAN_DB, PLAN_STORE, 'readwrite', (s) => s.put(plan, RECORD_KEY));
}

/** The stored value, unchecked: pass it to parsePlan. */
export async function loadPlan(): Promise<unknown> {
  return withStore<unknown>(PLAN_DB, PLAN_STORE, 'readonly', (s) => s.get(RECORD_KEY));
}

export async function deletePlan(): Promise<void> {
  await withStore(PLAN_DB, PLAN_STORE, 'readwrite', (s) => s.delete(RECORD_KEY));
}

export function withoutHoldings(plan: CraftingPlan): CraftingPlan {
  return { ...plan, holdings: { items: {}, wallet: {} } };
}
