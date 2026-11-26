import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gw2Client, RateLimiter } from '@gw2kit/client';
import { WikiClient } from '@gw2kit/wiki';
import { loadPlan, savePlan } from '@gw2-ai/core/plans';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planCreate, planResearch, planShow, planUpdate } from '../src/plans.js';

// A gift forged from a tradeable ore and a trophy with no known source.
const client = new Gw2Client({
  rateLimiter: new RateLimiter(10_000, 600_000),
  maxRetries: 0,
  fetch: (async (input: URL | string) => {
    const url = new URL(String(input));
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number);
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    const names: Record<number, string> = { 1: 'Gift of Tests', 2: 'Ore', 3: 'Trophy' };
    switch (url.pathname) {
      case '/v2/items':
        return ok(ids.filter((id) => names[id]).map((id) => ({ id, name: names[id], flags: [] })));
      case '/v2/commerce/prices':
        return ok(ids.filter((id) => id === 2).map((id) => ({ id, buys: { unit_price: 1, quantity: 1 }, sells: { unit_price: 10, quantity: 1 } })));
      case '/v2/recipes/search':
        return ok(url.searchParams.get('output') === '1' ? [7] : []);
      case '/v2/recipes':
        return ok([
          { id: 7, output_item_id: 1, output_item_count: 1, disciplines: ['Artificer'], min_rating: 0,
            ingredients: [{ type: 'Item', id: 2, count: 4 }, { type: 'Item', id: 3, count: 1 }] },
        ].filter((r) => ids.includes(r.id)));
      default:
        return new Response(JSON.stringify({ text: 'not found' }), { status: 404 });
    }
  }) as typeof globalThis.fetch,
});

const wiki = new WikiClient({
  rateLimiter: new RateLimiter(10_000, 600_000),
  fetch: (async (input: URL | string) => {
    const q = new URL(String(input)).searchParams;
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    const page = q.get('titles') ?? q.get('page') ?? '';
    if (q.get('action') === 'ask') return ok({ query: { results: [] } });
    if (q.get('action') === 'query') return ok({ query: { pages: { 1: { title: page, extract: `${page} is a thing.` } } } });
    if (q.get('prop') === 'sections') return ok({ parse: { title: page, sections: [{ line: 'Acquisition', index: '1' }] } });
    return ok({ parse: { text: { '*': '<ul><li>Dropped by [bosses]</li></ul>' } } });
  }) as typeof globalThis.fetch,
});

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gw2-plan-tools-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('plan tools', () => {
  it('creates a researched plan and will not overwrite it unasked', async () => {
    const out = await planCreate(client, wiki, { itemId: 1, quantity: 1 }, dir);
    expect(out).toContain('Saved as plan `gift-of-tests`');
    expect(out).toContain('> - Dropped by \\[bosses\\]');
    await expect(planCreate(client, wiki, { itemId: 1, quantity: 2 }, dir)).rejects.toThrow(/already saved/);
    await expect(planCreate(client, wiki, { itemId: 1, quantity: 1, name: '../x' }, dir)).rejects.toThrow(/not a plan name/);
    await expect(planCreate(client, wiki, { itemId: 99, quantity: 1 }, dir)).rejects.toThrow(/No item with id 99/);
    expect(await planCreate(client, wiki, { itemId: 1, quantity: 2, replace: true }, dir)).toContain('2 × Gift of Tests');
  });

  it('lists, shows, updates and researches', async () => {
    expect(await planShow(undefined, {}, dir)).toContain('| gift-of-tests | 2 × Gift of Tests |');
    expect(await planShow('gift-of-tests', { sections: ['buy'] }, dir)).toContain('8 × Ore');

    const out = await planUpdate(client, wiki, 'gift-of-tests', { done: ['Trophy', 'Nope'], sections: ['covered'] }, dir);
    expect(out).toContain('Not applied:\n- No step named "Nope".');
    expect(out).toContain('- [x] 2 × Trophy (done)');
    expect(out).not.toContain('## Buy on the trading post');

    expect(await planResearch(wiki, 'gift-of-tests', ['Ore', 'Nothing'], dir)).toMatch(/## Ore[\s\S]*Ore is a thing[\s\S]*No wiki excerpt for: nothing/);
    expect((await loadPlan('gift-of-tests', dir)).research).toHaveProperty('i2');
  });

  it('creates one plan for several goals, from `items` and `item_id` together', async () => {
    await expect(planCreate(client, wiki, {}, dir)).rejects.toThrow(/Pass `item_id`/);
    await expect(planCreate(client, wiki, { items: [{ itemId: 1, quantity: 1 }, { itemId: 99, quantity: 1 }] }, dir)).rejects.toThrow(/No item with id 99/);

    const out = await planCreate(client, wiki, { items: [{ itemId: 1, quantity: 1 }, { itemId: 2, quantity: 5 }] }, dir);
    expect(out).toContain('Saved as plan `gift-of-tests-and-ore`');
    expect(out).toContain('# Crafting plan: 1 × Gift of Tests + 5 × Ore');
    // 4 for the gift and 5 for their own sake.
    expect(out).toContain('9 × Ore');
    expect(await planShow(undefined, {}, dir)).toContain('| gift-of-tests-and-ore | 1 × Gift of Tests, 5 × Ore |');
  });

  it('adds goals, changes quantities and removes them', async () => {
    await planCreate(client, wiki, { itemId: 1, quantity: 1, name: 'grow' }, dir);
    const plan = await loadPlan('grow', dir);
    await savePlan('grow', { ...plan, holdings: { items: {}, wallet: {}, fetchedAt: '2026-11-26T00:00:00.000Z' } }, dir);

    const added = await planUpdate(client, wiki, 'grow', { add: [{ itemId: 2, quantity: 3 }, { itemId: 99, quantity: 1 }] }, dir);
    expect(added).toContain('Not applied:\n- No item with id 99.');
    expect(added).toContain('Run gw2_plan_holdings on gw2-account again');
    expect(added).toContain('# Crafting plan: 1 × Gift of Tests + 3 × Ore');

    const changed = await planUpdate(client, wiki, 'grow', { quantities: { 'Gift of Tests': 0, Ore: 7 } }, dir);
    expect(changed).toContain('# Crafting plan: 7 × Ore');
    expect((await loadPlan('grow', dir)).goals).toEqual([{ itemId: 2, name: 'Ore', quantity: 7 }]);
  });
});

describe('plan priority', () => {
  it('reorders goals and shows the first ones only', async () => {
    const plan = await loadPlan('gift-of-tests', dir);
    plan.data.items[4] = { name: 'Other Thing', sell: 5 };
    plan.goals = [...plan.goals, { itemId: 4, name: 'Other Thing', quantity: 1 }];
    await savePlan('two-things', plan, dir);
    const out = await planUpdate(client, wiki, 'two-things', { order: ['Other Thing'] }, dir);
    expect(out).toContain('# Crafting plan: 1 × Other Thing + 2 × Gift of Tests');
    expect(await planShow('two-things', { firstGoals: 1 }, dir)).toContain('# Crafting plan: 1 × Other Thing\n');
  });
});
