import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gw2Client, RateLimiter } from '@gw2kit/client';
import { WikiClient } from '@gw2kit/wiki';
import { describe, expect, it } from 'vitest';
import { planFromData } from '@gw2kit/recipes';
import { loadPlan, savePlan } from '@gw2-ai/core/plans';
import { character, findItem, keyInfo, planHoldings, raiseGold, shoppingList } from '../src/tools.js';

const KEY = '00000000-0000-0000-0000-00000000000000000000-0000-0000-0000-000000000000';

const ITEMS: Record<number, { name: string; rarity?: string; type?: string; details?: unknown }> = {
  19721: { name: 'Glob of Ectoplasm', rarity: 'Exotic', type: 'CraftingMaterial' },
  19700: { name: 'Mithril Ore', rarity: 'Basic' },
  19684: { name: 'Mithril Ingot', rarity: 'Basic' },
  46742: { name: 'Lump of Mithrillium', rarity: 'Ascended' },
  46747: { name: 'Thermocatalytic Reagent', rarity: 'Basic' },
  1000: { name: 'Zojja\'s Breastplate', rarity: 'Ascended' },
  2000: { name: 'Superior Rune of the Scholar', rarity: 'Exotic' },
  3000: { name: '20 Slot Invisible Bag', rarity: 'Ascended' },
};

function setup(permissions: string[]) {
  const calls: string[] = [];
  const fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    expect(url.searchParams.get('access_token') === KEY).toBe(
      /^\/v2\/(account|characters|tokeninfo|commerce\/delivery)/.test(url.pathname),
    );
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number);
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    switch (url.pathname) {
      case '/v2/tokeninfo':
        return ok({ id: 'x', name: 'test key', permissions });
      case '/v2/account/bank':
        return ok([{ id: 19721, count: 5 }, null, { id: 46742, count: 1 }]);
      case '/v2/account/inventory':
        return ok([{ id: 19721, count: 2 }]);
      case '/v2/account/materials':
        return ok([{ id: 19700, category: 5, count: 150 }, { id: 46747, count: 0, category: 5 }]);
      case '/v2/account/wallet':
        return ok([{ id: 1, value: 100 }]);
      case '/v2/commerce/delivery':
        return ok({ coins: 12_345, items: [] });
      case '/v2/account/legendaryarmory':
        return ok([]);
      case '/v2/characters':
        return url.searchParams.get('ids') === 'all'
          ? ok([{ name: 'Alice', bags: [{ id: 3000, size: 20, inventory: [{ id: 19721, count: 3 }, null] }], equipment: [] }])
          : ok(['Alice']);
      case '/v2/characters/Alice':
        return ok({
          name: 'Alice', race: 'Human', gender: 'Female', profession: 'Guardian', level: 80, age: 7200, created: '2020-01-01T00:00:00Z',
          deaths: 3, flags: [], crafting: [{ discipline: 'Armorsmith', rating: 500, active: true }],
          active_build_tab: 1, active_equipment_tab: 1,
          build_tabs: [{ tab: 1, is_active: true, build: { name: 'Raid', profession: 'Guardian',
            specializations: [{ id: 42, traits: [1, 2, 3] }],
            skills: { heal: 10, utilities: [11, null, 12], elite: 13 } } }],
          equipment: [
            { id: 1000, slot: 'Coat', location: 'Equipped', tabs: [1], upgrades: [2000], count: 1 },
            { id: 1000, slot: 'Coat', location: 'Armory', tabs: [2], count: 1 },
          ],
          bags: [{ id: 3000, size: 20, inventory: [{ id: 19721, count: 3 }, null] }],
        });
      case '/v2/characters/Bob':
        return new Response(JSON.stringify({ text: 'no such character' }), { status: 404 });
      case '/v2/items':
        return ok(ids.filter((id) => ITEMS[id]).map((id) => ({ id, flags: [], ...ITEMS[id] })));
      case '/v2/itemstats':
        return ok([]);
      case '/v2/specializations':
        return ok([{ id: 42, name: 'Firebrand', elite: true }]);
      case '/v2/traits':
        return ok(ids.map((id) => ({ id, name: `Trait ${id}` })));
      case '/v2/skills':
        return ok(ids.map((id) => ({ id, name: `Skill ${id}` })));
      case '/v2/commerce/prices':
        return ok(ids.filter((id) => [19721, 19700, 46747, 19684].includes(id)).map((id) => ({
          id, buys: { unit_price: 1, quantity: 1 }, sells: { unit_price: id === 19721 ? 2000 : id === 19684 ? 200 : 10, quantity: 1 },
        })));
      case '/v2/recipes/search':
        return ok(url.searchParams.get('output') === '46742' ? [1] : url.searchParams.get('output') === '19684' ? [2] : []);
      case '/v2/recipes':
        return ok([
          { id: 1, output_item_id: 46742, output_item_count: 1, disciplines: ['Armorsmith'], min_rating: 450,
            ingredients: [{ type: 'Item', id: 19684, count: 50 }, { type: 'Item', id: 19721, count: 1 }, { type: 'Item', id: 46747, count: 10 }] },
          { id: 2, output_item_id: 19684, output_item_count: 1, disciplines: ['Armorsmith'], min_rating: 150,
            ingredients: [{ type: 'Item', id: 19700, count: 2 }] },
        ].filter((r) => ids.includes(r.id)));
      default:
        return new Response(JSON.stringify({ text: 'not found' }), { status: 404 });
    }
  }) as typeof globalThis.fetch;
  const client = new Gw2Client({ apiKey: KEY, fetch, rateLimiter: new RateLimiter(10_000, 600_000), maxRetries: 0 });
  return { client, calls };
}

const ALL = ['account', 'inventories', 'characters', 'builds', 'unlocks'];

/** A wiki with no Mystic Forge recipes. */
const noForge = new WikiClient({
  fetch: (async () => new Response(JSON.stringify({ query: { results: [] } }))) as typeof globalThis.fetch,
  rateLimiter: new RateLimiter(1000, 60_000),
});

describe('account tools', () => {
  it('gw2_key_info lists available and skipped sections', async () => {
    const md = await keyInfo(setup(['account', 'wallet']).client);
    expect(md).toContain('| wallet | available |');
    expect(md).toMatch(/\| items \| skipped \(needs inventories\)/);
    expect(md).toContain('**gw2_character**: unavailable (needs characters)');
  });

  it('gw2_find_item sums counts per location by name', async () => {
    const md = await findItem(setup(ALL).client, 'ecto', undefined, 50);
    expect(md).toContain('| Glob of Ectoplasm | 19721 | Exotic | 10 |');
    expect(md).toContain('Bank: 5');
    expect(md).toContain('Alice: 3');
    expect(md).toContain('Shared slots: 2');
  });

  it('gw2_find_item refuses without inventories', async () => {
    await expect(findItem(setup(['account']).client, 'ecto', undefined, 50)).rejects.toThrow(/needs the `inventories` permission/);
  });

  it('gw2_character shows build, equipped gear and bags', async () => {
    const md = await character(setup(ALL).client, 'Alice');
    expect(md).toContain('Firebrand (elite)');
    expect(md).toContain('Trait 1 / Trait 2 / Trait 3');
    expect(md).toContain('## Build template 1: Raid (active)');
    expect(md).toContain('Heal Skill 10 · Utilities Skill 11, —, Skill 12 · Elite Skill 13');
    expect(md).toContain('| Coat | Zojja\'s Breastplate | 1000 | Ascended | — | Superior Rune of the Scholar | — |');
    expect(md.match(/Zojja/g)).toHaveLength(1);
    expect(md).toContain('1 of 20 slots used');
  });

  it('gw2_character lists names for an unknown character', async () => {
    expect(await character(setup(ALL).client, 'Bob')).toContain('Characters: Alice');
  });

  it('gw2_shopping_list subtracts holdings, intermediates first', async () => {
    // Need 2 lumps; own 1. The other needs 50 ingots (100 ore, 150 owned), 1 ecto (10 owned), 10 reagents (none).
    const md = await shoppingList(setup(ALL).client, noForge, 46742, 2);
    expect(md).toContain('| Thermocatalytic Reagent | 46747 | 10 | 10c | 1s |');
    expect(md).not.toMatch(/\| Mithril Ore \| 19700 \| \d+ \| 10c/);
    expect(md).toContain('**Total: 1s**');
    expect(md).toContain('Taken from your holdings');
  });
});

const lumpPlan = (quantity = 1) =>
  planFromData({
    version: 1, rootId: 46742, maxDepth: 10, fetchedAt: '2026-11-26T00:00:00.000Z',
    items: { 46742: { name: 'Lump of Mithrillium' }, 19700: { name: 'Mithril Ore', sell: 10 } },
    searched: [46742, 19700],
    recipes: { 46742: [{ source: 'crafting', id: 1, disciplines: ['Armorsmith'], min_rating: 450, output_count: 1, ingredients: [{ type: 'Item', id: 19700, count: 100 }] }] },
    currencies: {}, guildUpgrades: {}, vendors: {}, vendorUnmatched: [], status: {},
  }, quantity);

async function inTempDir(body: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'gw2-holdings-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('planHoldings', () => {
  it('saves what the account holds into the plan', () =>
    inTempDir(async (dir) => {
      await savePlan('lump', lumpPlan(), dir);
      const out = await planHoldings(setup(['account', 'inventories']).client, 'lump', dir);
      expect(out).toContain('Holdings saved to plan `lump`');
      expect(out).toContain('wallet unavailable');
      expect(out).toContain('- [x] 100 × Mithril Ore (held)');
      expect((await loadPlan('lump', dir)).holdings.items).toEqual({ 19700: 150, 46742: 1 });
    }));

  it('needs inventories', async () => {
    await expect(planHoldings(setup(['account']).client, 'lump')).rejects.toThrow(/gw2_plan_holdings needs the `inventories`/);
  });
});

describe('raiseGold', () => {
  const SELLER = ['account', 'inventories', 'characters', 'wallet', 'tradingpost'];

  it('lists sales without a plan, and sells nothing it should not', async () => {
    const md = await raiseGold(setup(SELLER).client, { method: 'list' });
    expect(md).toContain('10 × Glob of Ectoplasm listed');
    expect(md).toContain('150 × Mithril Ore listed');
    expect(md).not.toContain('Mithrillium');
    expect(md).toContain('1g 23s 45c is waiting in the trading post delivery box');
    expect(md).toContain('Nothing has been sold');
  });

  it('works without the optional permissions and says what was not read', async () => {
    const { client, calls } = setup(['account', 'inventories']);
    const md = await raiseGold(client, { targetGold: 0.5, method: 'list', keep: ['Mithril Ore'] });
    expect(md).toContain('covering 50s');
    expect(md).toMatch(/3 of 10 × Glob of Ectoplasm/);
    expect(md).not.toContain('× Mithril Ore');
    expect(md).toContain('trading post delivery box unavailable (needs `tradingpost`)');
    expect(calls).not.toContain('/v2/commerce/delivery');
  });

  it('refuses without inventories', async () => {
    await expect(raiseGold(setup(['account']).client, {})).rejects.toThrow(/gw2_raise_gold needs the `inventories`/);
  });

  it('refreshes a plan, aims at its shortfall and holds back what it uses', () =>
    inTempDir(async (dir) => {
      // 200 ore needed, 150 held, 100c in the wallet: 4s short.
      await savePlan('lump', lumpPlan(2), dir);
      const md = await raiseGold(setup(SELLER).client, { plan: 'lump', method: 'list' }, dir);
      expect(md).toContain('## Raise the gold from spare materials');
      // The 1g 23s 45c in the delivery box covers it, so nothing is sold.
      expect(md).toContain('Nothing needs selling');
      expect(md).toContain('waiting in the trading post delivery box');
      expect(md).not.toContain('× Glob of Ectoplasm');
      // Without the delivery box (no `tradingpost`), the shortfall is raised from sales.
      const unread = await raiseGold(setup(['account', 'inventories', 'characters', 'wallet']).client, { plan: 'lump', method: 'list' }, dir);
      expect(unread).toContain('covering 4s');
      expect(unread).toContain('× Glob of Ectoplasm listed');
      expect(md).not.toMatch(/Sell [\d,]+( of [\d,]+)? × Mithril Ore/);
      expect((await loadPlan('lump', dir)).holdings.items[19700]).toBe(150);
    }));

  it('says so when a plan is not short, unless given a target', () =>
    inTempDir(async (dir) => {
      await savePlan('lump', lumpPlan(), dir);
      const { client, calls } = setup(SELLER);
      const md = await raiseGold(client, { plan: 'lump' }, dir);
      expect(md).toContain('nothing needs selling');
      expect(md).not.toContain('- [ ] Sell');
      expect(calls).not.toContain('/v2/commerce/delivery');
      expect(await raiseGold(client, { plan: 'lump', targetGold: 1, method: 'list' }, dir)).toContain('- [ ] Sell');
    }));
});
