import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@gw2kit/client';
import { WikiClient } from '../src/index.js';
import { htmlToText } from '../src/wiki.js';

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

describe('htmlToText', () => {
  it('keeps list items and table rows, and drops markup, footnotes and the table of contents', () => {
    const html = `<div id="toc" class="toc"><h2>Contents</h2><ul>
      <li class="toclevel-1"><a href="#a"><span class="tocnumber">1</span> <span class="toctext">Sold by</span></a></li></ul></div>
      <h3>Sold by</h3><!-- note --><style>.x{}</style>
      <ul><li>250 <a href="/wiki/Obsidian_Shard">Obsidian Shard</a><sup>[1]</sup></li><li>Miyani &amp; Leivas &#215; 2</li></ul>
      <table><tr><th>Vendor</th> <th>Cost</th></tr>
      <tr><td>Miyani</td>
      <td>1&nbsp;000</td></tr></table>`;
    expect(htmlToText(html)).toBe(
      ['Sold by', '- 250 Obsidian Shard', '- Miyani & Leivas × 2', 'Vendor | Cost', 'Miyani | 1 000'].join('\n'),
    );
  });
});

describe('WikiClient.section', () => {
  function sectionWiki() {
    const fetch = (async (input: URL | string) => {
      const q = new URL(String(input)).searchParams;
      if (q.get('page') === 'Nothing') {
        return new Response(JSON.stringify({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } }));
      }
      if (q.get('prop') === 'sections') {
        return new Response(JSON.stringify({ parse: { title: 'Mystic Coin', sections: [{ line: 'Notes', index: '1' }, { line: 'Acquisition', index: '2' }] } }));
      }
      expect(q.get('section')).toBe('2');
      return new Response(JSON.stringify({ parse: { text: { '*': '<h2>Acquisition</h2><ul><li>Daily login</li></ul>' } } }));
    }) as typeof globalThis.fetch;
    return new WikiClient({ fetch, rateLimiter: new RateLimiter(1000, 60_000) });
  }

  it('reads one section as text, cut to maxChars', async () => {
    expect(await sectionWiki().section('mystic coin', 'acquisition')).toEqual({
      title: 'Mystic Coin',
      url: 'https://wiki.guildwars2.com/wiki/Mystic_Coin',
      text: 'Acquisition\n- Daily login',
      truncated: false,
    });
    expect(await sectionWiki().section('Mystic Coin', 'Acquisition', { maxChars: 5 })).toMatchObject({ text: 'Acqui', truncated: true });
  });

  it('returns null for a missing page or section', async () => {
    expect(await sectionWiki().section('Mystic Coin', 'Trivia')).toBeNull();
    expect(await sectionWiki().section('Nothing')).toBeNull();
  });
});

describe('WikiClient.section omit', () => {
  it('leaves out a named subsection and keeps the ones after it', async () => {
    const html = '<h2>Acquisition</h2><h3><span>Sold by</span></h3><table><tr><td>Miyani</td></tr></table><h3>Contained in</h3><ul><li>Chest</li></ul>';
    const fetch = (async (input: URL | string) => {
      const sections = new URL(String(input)).searchParams.get('prop') === 'sections';
      const parse = sections ? { title: 'Coin', sections: [{ line: 'Acquisition', index: '1' }] } : { text: { '*': html } };
      return new Response(JSON.stringify({ parse }));
    }) as typeof globalThis.fetch;
    const client = new WikiClient({ fetch, rateLimiter: new RateLimiter(1000, 60_000) });
    expect((await client.section('Coin', 'Acquisition', { omit: ['sold by'] }))?.text).toBe('Acquisition\nContained in\n- Chest');
  });
});

describe('intros', () => {
  it('asks 20 titles at a time and answers under the titles asked for', async () => {
    const asked: string[][] = [];
    const fetch = (async (input: URL | string) => {
      const titles = new URL(String(input)).searchParams.get('titles')!.split('|');
      asked.push(titles);
      const pages = Object.fromEntries(
        titles.filter((t) => t !== 'gone').map((t, i) => [i, { title: t === 'noxious pod' ? 'Noxious Pod' : t, extract: `About ${t}.` }]),
      );
      return new Response(JSON.stringify({ query: { normalized: [{ from: 'noxious pod', to: 'Noxious Pod' }], pages } }));
    }) as typeof globalThis.fetch;
    const titles = ['noxious pod', 'gone', ...Array.from({ length: 20 }, (_, i) => `T${i}`)];
    const found = await new WikiClient({ fetch }).intros(titles);
    expect(asked.map((a) => a.length)).toEqual([20, 2]);
    expect(found.get('noxious pod')).toBe('About noxious pod.');
    expect(found.has('gone')).toBe(false);
    expect(found.size).toBe(21);
  });
});
