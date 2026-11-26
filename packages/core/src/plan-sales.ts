/** Raising a crafting plan's missing gold from materials it doesn't use. */
import { solvePlan, type CraftingPlan, type SolvedPlan } from '@gw2kit/recipes';
import { planSales, type SaleOptions, type SalePlan, type Sellable } from './liquidate.js';

/** Item id → owned units the plan counts on, which selling would only make it buy back. */
export function planReserve(plan: CraftingPlan): Map<number, number> {
  const solved: SolvedPlan = solvePlan({ ...plan, settings: { ...plan.settings, useOwnMaterials: true } });
  return new Map(solved.steps.filter((s) => s.kind === 'Item' && s.owned > 0).map((s) => [s.id, s.owned]));
}

/** Gold the plan needs beyond the wallet; undefined until holdings, wallet included, have been read. */
export function planShortfall(plan: CraftingPlan): number | undefined {
  const wallet = plan.holdings.wallet[1];
  if (!plan.holdings.fetchedAt || wallet === undefined) return undefined;
  return Math.max(0, solvePlan(plan).coin - wallet);
}

/**
 * Sales that cover the plan's shortfall (or `options.target`) without touching
 * what the plan uses. Without a known shortfall, lists everything spare.
 */
export function salesForPlan(
  plan: CraftingPlan,
  items: readonly Sellable[],
  options: Omit<SaleOptions, 'reserve'> & { delivery?: number | undefined } = {},
): SalePlan {
  const { delivery = 0, ...sale } = options;
  const shortfall = planShortfall(plan);
  // Coins waiting in the delivery box are gold already, so nothing is sold to raise them.
  const target = sale.target ?? (shortfall === undefined ? undefined : Math.max(0, shortfall - delivery));
  return planSales(items, { ...sale, ...(target !== undefined ? { target } : {}), reserve: planReserve(plan) });
}
