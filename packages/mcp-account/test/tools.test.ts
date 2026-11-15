import { Gw2Client, RateLimiter, WikiClient } from '@gw2-ai/client';
import { describe, expect, it } from 'vitest';
import { character, findItem, keyInfo, shoppingList } from '../src/tools.js';

const KEY = '00000000-0000-0000-0000-00000000000000000000-0000-0000-0000-000000000000';

const ITEMS: Record<number, { name: string; rarity?: string; details?: unknown }> = {
  19721: { name: 'Glob of Ectoplasm', rarity: 'Exotic' },
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
      /^\/v2\/(account|characters|tokeninfo)/.test(url.pathname),
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
