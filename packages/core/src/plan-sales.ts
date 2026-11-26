/** Raising a crafting plan's missing gold from materials it doesn't use. */
import { solvePlan, type CraftingPlan, type SolvedPlan } from '@gw2kit/recipes';
import { planSales, type SaleOptions, type SalePlan, type Sellable } from './liquidate.js';

/** Item id → owned units the plan counts on, which selling would only make it buy back. */
export function planReserve(plan: CraftingPlan): Map<number, number> {
  const solved: SolvedPlan = solvePlan({ ...plan, settings: { ...plan.settings, useOwnMaterials: true } });
  return new Map(solved.steps.filter((s) => s.kind === 'Item' && s.owned > 0).map((s) => [s.id, s.owned]));
}

const SPIRIT_SHARD = 23;

/** Currency id → what the plan's steps call for. Coin is the target, not listed here. */
export function planCurrencies(plan: CraftingPlan): Map<number, number> {
  return new Map(solvePlan(plan).steps.filter((s) => s.kind === 'Currency').map((s) => [s.id, s.need]));
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
  options: Omit<SaleOptions, 'reserve' | 'currencyReserve'> & { delivery?: number | undefined } = {},
): SalePlan {
  const { delivery = 0, ...sale } = options;
  const shortfall = planShortfall(plan);
  // Coins waiting in the delivery box are gold already, so nothing is sold to raise them.
  const target = sale.target ?? (shortfall === undefined ? undefined : Math.max(0, shortfall - delivery));
  // Currencies the plan will spend are not there for promotions or paths.
  const currencies = planCurrencies(plan);
  const shards = sale.conversions?.spiritShards;
  const conversions =
    sale.conversions && shards !== undefined
      ? { ...sale.conversions, spiritShards: Math.max(0, shards - (currencies.get(SPIRIT_SHARD) ?? 0)) }
      : sale.conversions;
  return planSales(items, {
    ...sale,
    ...(conversions ? { conversions } : {}),
    ...(target !== undefined ? { target } : {}),
    reserve: planReserve(plan),
    currencyReserve: currencies,
  });
}
