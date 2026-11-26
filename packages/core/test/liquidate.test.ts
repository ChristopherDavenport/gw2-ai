import { Gw2Client, RateLimiter } from '@gw2kit/client';
import { describe, expect, it } from 'vitest';
import { updatePlan, withHoldings } from '@gw2kit/recipes';
import { planReserve, planSales, planShortfall, readSellables, renderPlan, renderSales, salesForPlan, type Sellable } from '../src/index.js';
import { swordPlan } from './plan-fixture.js';

const item = (id: number, name: string, count: number, over: Partial<Sellable> = {}): Sellable => ({
  id,
  name,
  count,
  material: true,
  vendor: 0,
  buy: 900,
  sell: 1000,
  ...over,
});

describe('planSales', () => {
  it('sells what keeps most of its value first, and only as much as needed', () => {
    const sales = planSales([item(1, 'Wide', 100, { buy: 500 }), item(2, 'Narrow', 100, { buy: 990 })], { target: 20_000, minLine: 0 });
    // 990c less 15% is 841.5c a unit: 24 raise 2g.
    expect(sales.lines).toEqual([expect.objectContaining({ name: 'Narrow', quantity: 24, held: 100, how: 'instant' })]);
    expect(sales.total).toBeGreaterThanOrEqual(20_000);
    expect(sales.short).toBe(0);
  });

  it('can put the biggest sales first instead', () => {
    const items = [item(1, 'Big', 1000, { buy: 500 }), item(2, 'Narrow', 100, { buy: 990 })];
    expect(planSales(items, { target: 20_000, order: 'fewest' }).lines.map((l) => l.name)).toEqual(['Big']);
  });

  it('walks the buy orders, and never counts more than they take', () => {
    const [line] = planSales([item(1, 'Thin', 10, { book: [{ price: 900, quantity: 2 }, { price: 100, quantity: 3 }] })]).lines;
    expect(line).toMatchObject({ quantity: 5, revenue: 1530 + 255 });
  });

  it('uses a vendor when that pays more, and lists when asked', () => {
    expect(planSales([item(1, 'Junk', 10, { vendor: 880 })]).lines[0]).toMatchObject({ how: 'vendor', revenue: 8800 });
    expect(planSales([item(1, 'Ore', 10)], { method: 'list' }).lines[0]).toMatchObject({ how: 'list', revenue: 8500, kept: 1 });
  });

  it('holds back reserved, kept, non-material and precious items, and says what is still missing', () => {
    const items = [
      item(1, 'Reserved', 10),
      item(2, 'Kept', 10),
      item(3, 'Sword', 1, { material: false }),
      item(4, 'Gift', 1, { rarity: 'Ascended' }),
    ];
    const sales = planSales(items, { target: 100_000, reserve: new Map([[1, 8]]), keep: ['kept'] });
    expect(sales.lines.map((l) => [l.name, l.quantity])).toEqual([['Reserved', 2]]);
    expect(sales.short).toBe(100_000 - sales.total);
    expect(renderSales(sales)).toContain('short**');
    expect(planSales(items, { everything: true }).lines.map((l) => l.name)).toContain('Sword');
  });
});

describe('composing with a plan', () => {
  const plan = () => withHoldings(swordPlan(), { items: { 5: 1 }, wallet: { 1: 50 }, fetchedAt: '2026-11-26T00:00:00.000Z' });

  it('keeps what the plan uses and aims at the shortfall', () => {
    // 3 bars needed, 1 owned: 2s to buy, 50c in the wallet.
    expect(planReserve(plan())).toEqual(new Map([[5, 1]]));
    expect(planShortfall(plan())).toBe(150);
    const sales = salesForPlan(plan(), [item(5, 'Bar', 1), item(9, 'Spare', 5)]);
    expect(sales.lines.map((l) => l.name)).toEqual(['Spare']);
    expect(sales.target).toBe(150);
    expect(renderPlan(plan(), { sales: { plan: sales } })).toContain('## Raise the gold from spare materials');
  });

  it('has no shortfall until the wallet has been read', () => {
    expect(planShortfall(swordPlan())).toBeUndefined();
    expect(planShortfall(updatePlan(plan(), { settings: { useOwnMaterials: false } }).plan)).toBe(250);
  });
});

describe('readSellables', () => {
  const client = () => {
    const defs: Record<number, { type: string; flags?: string[]; vendor_value?: number }> = {
      1: { type: 'Gizmo' },
      2: { type: 'CraftingMaterial', vendor_value: 8 },
      3: { type: 'Weapon', flags: ['NoSell'], vendor_value: 500 },
      4: { type: 'Trophy', flags: ['AccountBound'] },
    };
    return new Gw2Client({
      apiKey: 'key',
      maxRetries: 0,
      rateLimiter: new RateLimiter(10_000, 600_000),
      fetch: (async (input: URL | string) => {
        const url = new URL(String(input));
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number);
        const ok = (body: unknown) => new Response(JSON.stringify(body));
        switch (url.pathname) {
          case '/v2/account/materials':
            return ok([{ id: 1, category: 5, count: 20 }]);
          case '/v2/account/bank':
            return ok([{ id: 2, count: 3 }, { id: 2, count: 100, binding: 'Account' }, null, { id: 4, count: 1 }]);
          case '/v2/account/inventory':
            return ok([{ id: 1, count: 5, binding: 'Character' }, { id: 3, count: 1 }]);
          case '/v2/characters':
            return ok([{ name: 'Alice', bags: [null, { id: 9, size: 20, inventory: [{ id: 2, count: 4 }, null] }] }]);
          case '/v2/commerce/delivery':
            return ok({ coins: 77, items: [] });
          case '/v2/items':
            return ok(ids.map((id) => ({ id, name: `Item ${id}`, rarity: 'Basic', flags: [], vendor_value: 0, ...defs[id] })));
          case '/v2/commerce/prices':
            return ok(ids.map((id) => ({ id, buys: { unit_price: 1000, quantity: 50 }, sells: { unit_price: 1200, quantity: 50 } })));
          case '/v2/commerce/listings':
            return ok(ids.map((id) => ({ id, buys: [{ unit_price: 1000, quantity: 50, listings: 1 }], sells: [] })));
          default:
            return new Response(JSON.stringify({ text: 'not found' }), { status: 404 });
        }
      }) as typeof globalThis.fetch,
    });
  };

  it('counts unbound stacks, marks materials and reads the delivery box', async () => {
    const { items, delivery, notes } = await readSellables(client(), ['account', 'inventories', 'characters', 'tradingpost']);
    const byId = new Map(items.map((i) => [i.id, i]));
    // Bound slots and account-bound items are left out.
    expect([...byId.keys()].sort()).toEqual([1, 2, 3]);
    expect(byId.get(2)).toMatchObject({ count: 7, material: true, vendor: 8, buy: 1000, sell: 1200 });
    // Stored in material storage, so a material whatever its type.
    expect(byId.get(1)).toMatchObject({ count: 20, material: true, book: [{ price: 1000, quantity: 50 }] });
    expect(byId.get(3)).toMatchObject({ material: false, vendor: 0 });
    expect(delivery).toBe(77);
    expect(notes).toEqual([]);
  });

  it('skips the delivery box without `tradingpost`, and says so', async () => {
    const read = await readSellables(client(), ['account', 'inventories']);
    expect(read).not.toHaveProperty('delivery');
    expect(renderSales(planSales(read.items), { notes: read.notes })).toContain('delivery box unavailable (needs `tradingpost`)');
  });
});

describe('delivery box', () => {
  it('takes waiting coins off what has to be raised', () => {
    const plan = withHoldings(swordPlan(), { items: {}, wallet: { 1: 50 }, fetchedAt: '2026-11-26T00:00:00.000Z' });
    expect(salesForPlan(plan, [item(9, 'Spare', 5)], { delivery: 100 }).target).toBe(150);
  });
});
