import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@gw2kit/client';
import { WikiClient } from '../src/index.js';

// Real /api.php?action=ask response for outputs 19674 (Gift of Mastery) and 19675 (Mystic Clover).
const FIXTURE = readFileSync(new URL('./fixtures/wiki-mystic-forge.json', import.meta.url), 'utf8');

function wiki(body = FIXTURE) {
  const queries: string[] = [];
  const fetch = (async (input: URL | string) => {
    queries.push(new URL(String(input)).searchParams.get('query') ?? '');
    return new Response(body);
  }) as typeof globalThis.fetch;
  return { client: new WikiClient({ fetch, rateLimiter: new RateLimiter(1000, 60_000) }), queries };
}

describe('WikiClient Mystic Forge recipes', () => {
  it('parses recipes with ingredient ids, counts and the base flag', async () => {
    const recipes = await wiki().client.mysticForgeRecipes([19674, 19675]);
    const mastery = recipes.find((r) => r.subject === 'Gift of Mastery#recipe1');
    expect(mastery).toMatchObject({
      name: 'Gift of Mastery',
      url: 'https://wiki.guildwars2.com/wiki/Gift_of_Mastery',
      output_item_id: 19674,
      output_item_count: 1,
      base: true,
    });
    expect(mastery?.ingredients).toEqual([
      { item_id: 20797, name: 'Bloodstone Shard', count: 1 },
      { item_id: 19925, name: 'Obsidian Shard', count: 250 },
      { item_id: 19677, name: 'Gift of Exploration', count: 1 },
      { item_id: 19678, name: 'Gift of Battle', count: 1 },
    ]);
    const clovers = recipes.filter((r) => r.output_item_id === 19675);
    expect(clovers.map((r) => [r.output_item_count, r.base])).toEqual([[1, false], [10, false], [0.31, true]]);
  });

  it('batches output ids under the wiki query size limit', async () => {
    const { client, queries } = wiki('{"query":{"results":[]}}');
    await client.mysticForgeRecipes(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('[[Has output game id::1||2||3||4||5||6||7||8||9||10]]');
  });

  it('queries recipes using an item by id', async () => {
    const { client, queries } = wiki('{"query":{"results":[]}}');
    expect(await client.mysticForgeRecipesUsing(19721)).toEqual([]);
    expect(queries[0]).toContain('[[Has ingredient with id::?;?;?;19721]]');
  });
});

// Real /api.php?action=ask response for [[Sells item::Philosopher's Stone]].
const VENDOR_FIXTURE = readFileSync(new URL('./fixtures/wiki-vendor-offers.json', import.meta.url), 'utf8');

describe('WikiClient vendor offers', () => {
  it('parses vendor, quantity, every cost line and the historical flag', async () => {
    const offers = await wiki(VENDOR_FIXTURE).client.vendorOffers("Philosopher's Stone");
    expect(offers.find((o) => o.vendor === 'Miyani')).toMatchObject({
      url: 'https://wiki.guildwars2.com/wiki/Miyani',
      item: "Philosopher's Stone",
      quantity: 10,
      costs: [{ name: 'Spirit Shard', amount: 1 }],
      historical: false,
    });
    expect(offers.find((o) => o.vendor === 'Super Adventure Box Trader')?.costs).toEqual([
      { name: 'Bauble Bubble', amount: 1 },
      { name: 'Coin', amount: 288 },
    ]);
  });

  it('refuses titles that would change the query', async () => {
    const { client, queries } = wiki();
    expect(await client.vendorOffers('X]][[Has vendor::Y')).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});
