import { planFromData } from '@gw2kit/recipes';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadPlan, savePlan, withoutHoldings } from './plan-store.js';

const plan = planFromData({
  version: 1,
  rootId: 1,
  maxDepth: 1,
  fetchedAt: '2026-01-01T00:00:00.000Z',
  items: { 1: { name: 'Thing' } },
  searched: [],
  recipes: {},
  currencies: {},
  guildUpgrades: {},
  vendors: {},
  vendorUnmatched: [],
  status: {},
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('plan store', () => {
  it('keeps the latest plan', async () => {
    expect(await loadPlan()).toBeUndefined();
    await savePlan(plan);
    await savePlan({ ...plan, done: ['i1'] });
    expect(await loadPlan()).toEqual({ ...plan, done: ['i1'] });
  });

  it('withoutHoldings drops holdings and when they were read', () => {
    const held = { ...plan, holdings: { items: { 1: 2 }, wallet: { 1: 3 }, fetchedAt: '2026-01-01' } };
    expect(withoutHoldings(held).holdings).toEqual({ items: {}, wallet: {} });
  });
});
