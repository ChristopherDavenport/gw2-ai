import { describe, expect, it } from 'vitest';
import { Gw2Client, RateLimiter } from '@gw2kit/client';
import { buildRecipeTree, flattenLeaves } from '@gw2kit/recipes';
import { WikiClient } from '@gw2kit/wiki';
import { DEFAULT_VENDOR_CURRENCY, renderRecipeTree } from '../src/index.js';

interface FakeRecipe {
  id: number;
  out: number;
  outCount?: number;
  ing: [type: 'Item' | 'Currency', id: number, count: number][];
  rating?: number;
}

const ITEMS: Record<number, { name: string; sell?: number }> = {
  100: { name: 'Widget', sell: 1000 },
  200: { name: 'Bar', sell: 100 },
  300: { name: 'Gem', sell: 300 },
  400: { name: 'Ore', sell: 5 },
  500: { name: 'Gift of Testing' },
  600: { name: 'Loop A', sell: 50 },
  601: { name: 'Loop B', sell: 50 },
  700: { name: 'Karma Thing', sell: 10_000 },
  800: { name: 'Gift of Forging' },
  801: { name: 'Clover' },
  802: { name: 'Coin', sell: 100 },
  803: { name: 'Vendor Stone' },
};

interface FakeForge {
  out: number;
  qty: number;
  ing: [id: number | undefined, count: number, name: string][];
  base?: boolean;
  name?: string;
}

// Mystic Forge recipes as the wiki holds them.
const FORGE: FakeForge[] = [
  { out: 800, qty: 1, ing: [[801, 2, 'Clover'], [400, 5, 'Ore']] },
  // Random-output recipe: the wiki flags it unfit for totals...
  { out: 801, qty: 1, ing: [[802, 1, 'Coin']], base: false, name: '1 Clover or other materials (random)' },
  // ...and gives its average yield as a separate recipe.
  { out: 801, qty: 0.5, ing: [[802, 1, 'Coin'], [803, 2, 'Vendor Stone']], name: 'Clover Average' },
  // An ingredient with no game id on the wiki: unusable.
  { out: 300, qty: 1, ing: [[undefined, 1, 'Mystery']] },
];

interface FakeOffer {
  item: number;
  vendor: string;
  qty: number;
  cost: [amount: number, currency: string][];
  weekly?: number;
  historical?: boolean;
}

// NPC vendor offers as the wiki holds them.
const OFFERS: FakeOffer[] = [
  { item: 803, vendor: 'Miyani', qty: 10, cost: [[1, 'Spirit Shards']] },
  { item: 803, vendor: 'Mystic Forge Attendant', qty: 10, cost: [[1, 'Spirit Shard']] },
  { item: 803, vendor: 'Box Trader', qty: 6, cost: [[1, 'Bauble Bubble'], [288, 'Coin']] },
  { item: 803, vendor: 'Old Trader', qty: 100, cost: [[1, 'Karma']], historical: true },
  { item: 500, vendor: 'Gift Merchant', qty: 1, cost: [[2500, 'Coin']] },
  { item: 500, vendor: 'Gift Merchant', qty: 1, cost: [[5, 'Ore']], weekly: 1 },
];

function wikiSetup(fail = false) {
  const queries: string[] = [];
  const fetch = (async (input: URL | string) => {
    const query = new URL(String(input)).searchParams.get('query') ?? '';
    queries.push(query);
    if (fail) return new Response(JSON.stringify({ error: { info: 'query timed out' } }));
    const reply = (results: Record<string, unknown>) => new Response(JSON.stringify({ query: { results } }));
    const ok = (title: string, id: number) => [title, { fulltext: title, fullurl: '', printouts: { 'Has game id': [id] } }] as const;
    // Item pages by game id, and game ids by page title.
    const byId = /^\[\[Has game id::([\d|]+)\]\]/.exec(query);
    if (byId) {
      const ids = byId[1]!.split('||').map(Number);
      return reply(Object.fromEntries(ids.filter((id) => ITEMS[id]).map((id) => ok(ITEMS[id]!.name, id))));
    }
    const byTitle = /^\[\[([^:\]]+)\]\]\[\[Has context::Item\]\]/.exec(query);
    if (byTitle) {
      const titles = byTitle[1]!.split('||');
      const found = Object.entries(ITEMS).filter(([, v]) => titles.includes(v.name));
      return reply(Object.fromEntries(found.map(([id, v]) => ok(v.name, Number(id)))));
    }
    const sells = /^\[\[Sells item::([^\]]+)\]\]/.exec(query);
    if (sells) {
      const id = Number(Object.entries(ITEMS).find(([, v]) => v.name === sells[1])?.[0]);
      const rows = OFFERS.filter((o) => o.item === id).map((o, i) => [
        `${o.vendor}#vendor${i + 1}`,
        {
          printouts: {
            'Has vendor': [{ fulltext: o.vendor }],
            'Sells item': [{ fulltext: sells[1] }],
            'Has item quantity': [o.qty],
            'Has item cost': o.cost.map(([amount, name]) => ({ 'Has item value': { item: [String(amount)] }, 'Has item currency': { item: [name] } })),
            'Is historical': [o.historical ? 't' : 'f'],
            'Has weekly purchase cap': o.weekly ? [o.weekly] : [],
          },
        },
      ]);
      return reply(Object.fromEntries(rows));
    }
    const ids = (/Has output game id::([\d|]+)/.exec(query)?.[1] ?? '').split('||').map(Number);
    const results: Record<string, unknown> = {};
    FORGE.filter((f) => ids.includes(f.out)).forEach((f, i) => {
      results[`${ITEMS[f.out]!.name}#recipe${i + 1}`] = {
        printouts: {
          'Has output game id': [f.out],
          'Has output quantity': [f.qty],
          'Has canonical name': f.name ? [f.name] : [],
          'Can be queried for base ingredients': [f.base === false ? 'f' : 't'],
          'Has ingredient with id': f.ing.map(([id, count, name], j) => ({
            'Has ingredient index': { item: [j + 1] },
            'Has ingredient quantity': { item: [count] },
            'Has ingredient name': { item: [{ fulltext: name }] },
            'Has ingredient id': { item: id === undefined ? [] : [id] },
          })),
        },
      };
    });
    return new Response(JSON.stringify({ query: { results } }));
  }) as typeof globalThis.fetch;
  return { wiki: new WikiClient({ fetch, rateLimiter: new RateLimiter(10_000, 600_000) }), queries };
}

const RECIPES: FakeRecipe[] = [
  // Two recipes for the widget; the second is dearer.
  { id: 1, out: 100, ing: [['Item', 200, 2], ['Item', 300, 1]] },
  { id: 2, out: 100, ing: [['Item', 300, 10]] },
  // One craft makes 5 bars.
  { id: 3, out: 200, outCount: 5, ing: [['Item', 400, 10]] },
  // Cycle.
  { id: 4, out: 600, ing: [['Item', 601, 1]] },
  { id: 5, out: 601, ing: [['Item', 600, 1]] },
  // Currency and an unpriced Mystic Forge-style leaf.
  { id: 6, out: 700, ing: [['Currency', 2, 500], ['Item', 500, 1], ['Item', 400, 3]] },
];

function setup() {
  const calls: URL[] = [];
  const fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number);
    let body: unknown;
    let status = 200;
    switch (url.pathname) {
      case '/v2/items':
        body = ids.filter((id) => ITEMS[id]).map((id) => ({ id, name: ITEMS[id]!.name, flags: [] }));
        break;
      case '/v2/commerce/prices':
        body = ids
          .filter((id) => ITEMS[id]?.sell)
          .map((id) => ({ id, buys: { unit_price: 1, quantity: 1 }, sells: { unit_price: ITEMS[id]!.sell, quantity: 1 } }));
        if ((body as unknown[]).length === 0) {
          status = 404;
          body = { text: 'all ids provided are invalid' };
        }
        break;
      case '/v2/recipes/search': {
        const out = Number(url.searchParams.get('output'));
        body = RECIPES.filter((r) => r.out === out).map((r) => r.id);
        break;
      }
      case '/v2/recipes':
        body = RECIPES.filter((r) => ids.includes(r.id)).map((r) => ({
          id: r.id,
          output_item_id: r.out,
          output_item_count: r.outCount ?? 1,
          disciplines: ['Artificer'],
          min_rating: r.rating ?? 400,
          ingredients: r.ing.map(([type, id, count]) => ({ type, id, count })),
        }));
        break;
      case '/v2/currencies':
        body = [{ id: 1, name: 'Coin' }, { id: 2, name: 'Karma' }, { id: 23, name: 'Spirit Shard' }];
        break;
      default:
        status = 404;
        body = { text: 'not found' };
    }
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  const client = new Gw2Client({ fetch, rateLimiter: new RateLimiter(10_000, 600_000), maxRetries: 0 });
  return { client, calls };
}

describe('buildRecipeTree', () => {
  it('picks the cheapest recipe and decides craft vs buy per node', async () => {
    const { client, calls } = setup();
    const tree = await buildRecipeTree(client, 100, 2);
    // Recipe 1: 4 bars (1 craft of 5 → 10 ore = 50c, cheaper than 400c buying) + 2 gems (600c) = 650c.
    expect(tree.recipe?.id).toBe(1);
    expect(tree.alternatives).toBe(1);
    expect(tree.best).toBe('craft');
    expect(tree.cost).toBe(650);
    expect(tree.buyPrice).toBe(2000);
    const bar = tree.children.find((c) => c.itemId === 200)!;
    expect(bar.count).toBe(4);
    expect(bar.recipe?.crafts).toBe(1);
    expect(bar.best).toBe('craft');
    expect(bar.children[0]).toMatchObject({ itemId: 400, count: 10, best: 'buy', cost: 50 });

    expect(flattenLeaves(tree).map((l) => [l.name, l.count, l.cost])).toEqual([
      ['Gem', 2, 600],
      ['Ore', 10, 50],
    ]);

    // Item lookups are batched per tree level, not per item.
    const itemCalls = calls.filter((u) => u.pathname === '/v2/items');
    expect(itemCalls).toHaveLength(3);
    expect(itemCalls[1]!.searchParams.get('ids')!.split(',').sort()).toEqual(['200', '300']);
  });

  it('uses holdings before buying or crafting', async () => {
    const { client } = setup();
    const tree = await buildRecipeTree(client, 100, 1, { have: new Map([[200, 2], [300, 5]]) });
    expect(tree.best).toBe('craft');
    expect(tree.cost).toBe(0);
    const leaves = flattenLeaves(tree);
    expect(leaves).toHaveLength(0);
    expect(renderRecipeTree(tree)).toContain('Taken from your holdings');
  });

  it('stops at cycles', async () => {
    const { client } = setup();
    const tree = await buildRecipeTree(client, 600, 1);
    const b = tree.children[0]!;
    expect(b.itemId).toBe(601);
    expect(b.children[0]).toMatchObject({ itemId: 600, stop: 'cycle', best: 'buy' });
  });

  it('marks currency and unpriced leaves and prefers buying over an incomplete craft', async () => {
    const { client } = setup();
    const tree = await buildRecipeTree(client, 700, 1);
    expect(tree.craftComplete).toBe(false);
    expect(tree.best).toBe('buy');
    const raw = flattenLeaves(tree, 'raw');
    expect(raw.find((l) => l.kind === 'Currency')).toMatchObject({ name: 'Karma', count: 500, unpriced: true });
    expect(raw.find((l) => l.itemId === 500)).toMatchObject({ unpriced: true });

    const md = renderRecipeTree(tree, { expandAll: true });
    expect(md).toContain('Gift of Testing');
    expect(md).toContain('no API recipe');
    expect(md).toContain('Raw materials if you craft every component');
  });

  it('resolves Mystic Forge recipes from the wiki', async () => {
    const { client } = setup();
    const { wiki, queries } = wikiSetup();
    const tree = await buildRecipeTree(client, 800, 1, { wiki, vendors: false });
    expect(tree.mysticForge).toEqual({ status: 'ok' });
    expect(tree.vendors).toBeUndefined();
    expect(tree.recipe).toMatchObject({ source: 'mystic-forge', crafts: 1, wiki: { url: 'https://wiki.guildwars2.com/wiki/Gift_of_Forging' } });
    expect(tree.best).toBe('craft');
    // 2 clovers at 0.5 per forge on average = 4 forges: 4 coins and 8 vendor stones.
    const clover = tree.children.find((c) => c.itemId === 801)!;
    expect(clover.recipe).toMatchObject({ source: 'mystic-forge', output_count: 0.5, crafts: 4, wiki: { name: 'Clover Average' } });
    expect(clover.alternatives).toBe(0);
    expect(flattenLeaves(tree).map((l) => [l.name, l.count, l.cost])).toEqual([
      ['Coin', 4, 400],
      ['Ore', 5, 25],
      ['Vendor Stone', 8, undefined],
    ]);
    const md = renderRecipeTree(tree);
    expect(md).toContain('Mystic Forge (×4, ~0.5 per forge on average; https://wiki.guildwars2.com/wiki/Clover)');
    expect(md).toContain('8 × Vendor Stone (item 803): no crafting or Mystic Forge recipe and not on the TP: a vendor, reward or drop');
    expect(md).toContain('Mystic Forge recipes come from the GW2 wiki');
    // Only items without an API recipe are looked up on the wiki.
    expect(queries.join(' ')).not.toMatch(/::[\d|]*\b200\b/);
  });

  it('skips wiki recipes with an ingredient that has no id', async () => {
    const { client } = setup();
    const tree = await buildRecipeTree(client, 300, 1, { wiki: wikiSetup().wiki });
    expect(tree.recipe).toBeUndefined();
    expect(tree.best).toBe('buy');
  });

  it('falls back to API recipes when the wiki fails', async () => {
    const { client } = setup();
    const tree = await buildRecipeTree(client, 800, 1, { wiki: wikiSetup(true).wiki });
    expect(tree.mysticForge).toEqual({ status: 'failed', error: 'GW2 wiki error: query timed out' });
    expect(tree.best).toBe('unavailable');
    expect(renderRecipeTree(tree)).toContain('Looking up Mystic Forge recipes on the wiki failed (GW2 wiki error: query timed out)');
  });

  it('costs vendor items in wallet currencies', async () => {
    const { client } = setup();
    const tree = await buildRecipeTree(client, 800, 1, { wiki: wikiSetup().wiki });
    expect(tree.vendors).toEqual({ status: 'ok' });
    const stone = tree.children.find((c) => c.itemId === 801)!.children.find((c) => c.itemId === 803)!;
    // The offer two vendors share wins over the one-vendor offer; the historical one is ignored.
    expect(stone.best).toBe('vendor');
    expect(stone.vendor).toMatchObject({
      purchases: 1,
      offer: { quantity: 10, costs: [{ kind: 'Currency', id: 23, name: 'Spirit Shard', amount: 1 }], vendors: ['Miyani', 'Mystic Forge Attendant'] },
      url: 'https://wiki.guildwars2.com/wiki/Vendor_Stone',
    });
    expect(stone.vendor?.alternatives).toHaveLength(0); // Bauble Bubble isn't a known currency or item.
    expect(stone.children).toMatchObject([{ kind: 'Currency', itemId: 23, count: 1, best: 'unavailable' }]);
    expect(flattenLeaves(tree).find((l) => l.kind === 'Currency')).toMatchObject({ itemId: 23, count: 1 });

    const md = renderRecipeTree(tree, { wallet: new Map([[23, 0]]) });
    expect(md).toContain('8 × Vendor Stone `803` — **vendor** · 1 × (10 for 1 Spirit Shard) from Miyani, Mystic Forge Attendant; https://wiki.guildwars2.com/wiki/Vendor_Stone');
    expect(md).toContain('1 × Spirit Shard `23` (Currency) — **wallet currency**');
    expect(md).toContain('| Spirit Shard | 23 | 1 | 0 | 1 |');
    expect(md).toContain('plus 1 wallet currency');
  });

  it('prices a coin-only vendor offer and lists the others', async () => {
    const { client } = setup();
    const tree = await buildRecipeTree(client, 700, 1, { wiki: wikiSetup().wiki });
    const gift = tree.children.find((c) => c.itemId === 500)!;
    expect(gift).toMatchObject({ best: 'vendor', cost: 2500, complete: true });
    expect(gift.vendor?.alternatives[0]).toMatchObject({ quantity: 1, costs: [{ kind: 'Item', id: 400, amount: 5 }], caps: { weekly: 1 } });
    const md = renderRecipeTree(tree, { expandAll: true });
    expect(md).toContain('other offers: 1 for 5 Ore');
    expect(md).toContain('25s in coin');
  });

  it('flags vendor items whose costs it cannot match', async () => {
    const { client } = setup();
    const saved = OFFERS.splice(0, 2); // leave only the Bauble Bubble offer for the stone
    try {
      const tree = await buildRecipeTree(client, 803, 8, { wiki: wikiSetup().wiki });
      expect(tree).toMatchObject({ best: 'unavailable', vendorUnmatched: true });
      expect(renderRecipeTree(tree)).toContain("sold by vendors for a currency this tool couldn't match");
    } finally {
      OFFERS.unshift(...saved);
    }
  });

  it('pays in a preferred currency when asked, and defaults Obsidian Shard to karma', async () => {
    expect(DEFAULT_VENDOR_CURRENCY.get(19925)).toBe(2);
    const { client } = setup();
    OFFERS.push(
      { item: 803, vendor: 'Karma Mixer', qty: 1, cost: [[5, 'Spirit Shard'], [20, 'Karma']] },
      { item: 803, vendor: 'Karma Bulk', qty: 10, cost: [[300, 'Karma']] },
      { item: 803, vendor: 'Karma Single', qty: 1, cost: [[30, 'Karma']] },
    );
    try {
      const tree = await buildRecipeTree(client, 803, 8, { wiki: wikiSetup().wiki, vendorCurrency: new Map([[803, 2]]) });
      // Karma-only beats the mixed offer; equal per-unit prices pick the smaller bundle.
      expect(tree.vendor?.offer).toMatchObject({ quantity: 1, costs: [{ kind: 'Currency', id: 2, amount: 30 }], vendors: ['Karma Single'] });
      expect(tree.children).toMatchObject([{ kind: 'Currency', itemId: 2, count: 240 }]);
      // Without the preference, the offer most vendors share still wins.
      const plain = await buildRecipeTree(client, 803, 8, { wiki: wikiSetup().wiki });
      expect(plain.vendor?.offer.vendors).toEqual(['Miyani', 'Mystic Forge Attendant']);
    } finally {
      OFFERS.splice(-3, 3);
    }
  });
});
