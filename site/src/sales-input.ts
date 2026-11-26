/** Parsing for the controls that say what to sell. Pure. */
import type { Sellable } from '@gw2-ai/core';
import { cleanName } from './plan-input.js';

/** One item name or id per line: names can hold commas, so lines are never split further. */
export function parseKeep(input: string): string[] {
  return input.split('\n').map(cleanName).filter(Boolean);
}

/** Gold typed by the player as copper; undefined when blank, null when it isn't a positive amount. */
export function parseGold(input: string): number | undefined | null {
  const value = input.trim();
  if (!value) return undefined;
  if (!/^(\d+(\.\d{0,4})?|\.\d{1,4})$/.test(value)) return null;
  const copper = Math.round(Number(value) * 10_000);
  return Number.isSafeInteger(copper) && copper > 0 ? copper : null;
}

/** Entries to keep that match nothing the account could sell: often a typo. */
export function unmatchedKeep(keep: readonly string[], items: readonly Sellable[]): string[] {
  const known = new Set(items.flatMap((i) => [String(i.id), i.name.toLowerCase()]));
  return keep.filter((k) => !known.has(k.toLowerCase()));
}
