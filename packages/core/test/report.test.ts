import { Gw2Client, RateLimiter } from '@gw2-ai/client';
import { describe, expect, it } from 'vitest';
import { buildReport, fmt } from '../src/index.js';

// Client behaviour (batching, auth, retries, caching) is tested in packages/client.

const KEY = '00000000-0000-0000-0000-00000000000000000000-0000-0000-0000-000000000000';

type Handler = (url: URL) => { status?: number; body: unknown };

function client(handler: Handler) {
  const fetch = (async (input: URL | string) => {
    const { status = 200, body } = handler(new URL(String(input)));
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return new Gw2Client({ apiKey: KEY, fetch, rateLimiter: new RateLimiter(10_000, 600_000), maxRetries: 0 });
}

const notFound = { status: 404, body: { text: 'not found' } };

function token(permissions: string[]) {
  return { body: { id: 'x', name: 'test key', permissions, type: 'APIKey' } };
}

describe('buildReport', () => {
  it('skips sections the key lacks permissions for', async () => {
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account', 'wallet']);
      if (url.pathname === '/v2/account/wallet') return { body: [{ id: 1, value: 1234567 }, { id: 2, value: 50 }] };
      if (url.pathname === '/v2/currencies')
        return { body: [{ id: 1, name: 'Coin', order: 1 }, { id: 2, name: 'Karma', order: 2 }] };
      return notFound;
    });
    const report = await buildReport(c, { sections: ['wallet', 'characters'] });
    expect(report.sections.map((s) => [s.id, s.status])).toEqual([
      ['wallet', 'ok'],
      ['characters', 'skipped'],
    ]);
    expect(report.markdown).toContain('| Coin | 123g 45s 67c | 1 |');
    expect(report.markdown).toContain('lacks permission: characters');
  });

  it('rejects unknown section ids', async () => {
    const c = client(() => token([]));
    await expect(buildReport(c, { sections: ['nope'] })).rejects.toThrow(/Unknown report sections/);
  });

  it('shows "no team" for WvW team 0', async () => {
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account']);
      if (url.pathname === '/v2/account')
        return {
          body: {
            id: 'A', name: 'Example.1234', age: 3600, world: 1001, guilds: [], created: '2020-01-01T00:00:00Z',
            access: ['GuildWars2'], commander: false, wvw: { team_id: 0, rank: 12 },
          },
        };
      return notFound;
    });
    const report = await buildReport(c, { sections: ['overview'] });
    expect(report.markdown).toContain('- **WvW:** rank 12, no team');
  });

  it('lists each armor weight class in the legendary armory', async () => {
    const armor = (id: number, weight: string) => ({
      id, name: 'Example Gloves', type: 'Armor', flags: [],
      details: { type: 'Gloves', weight_class: weight, defense: 1, infusion_slots: [], attribute_adjustment: 0 },
    });
    const items = [armor(3, 'Light'), armor(1, 'Heavy'), armor(2, 'Medium'),
      { id: 4, name: 'Example Sword', type: 'Weapon', flags: [], details: { type: 'Sword' } }];
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account', 'inventories', 'unlocks']);
      if (url.pathname === '/v2/account/legendaryarmory') return { body: items.map((i) => ({ id: i.id, count: 1 })) };
      if (url.pathname === '/v2/items') {
        const ids = url.searchParams.get('ids')!.split(',').map(Number);
        return { body: items.filter((i) => ids.includes(i.id)) };
      }
      return notFound;
    });
    const md = (await buildReport(c, { sections: ['legendary-armory'] })).markdown;
    expect(md).toContain('| Example Gloves | Armor | Gloves (Heavy) | 1 | 1 |\n| Example Gloves | Armor | Gloves (Light) | 1 | 3 |');
    expect(md).toContain('| Example Gloves | Armor | Gloves (Medium) | 1 | 2 |');
    expect(md).toContain('| Example Sword | Weapon | Sword | 1 | 4 |');
  });
});

describe('format', () => {
  it('formats coins', () => {
    expect(fmt.coins(0)).toBe('0c');
    expect(fmt.coins(5)).toBe('5c');
    expect(fmt.coins(1_00)).toBe('1s');
    expect(fmt.coins(1_00_00)).toBe('1g');
    expect(fmt.coins(1_00_05)).toBe('1g 0s 5c');
    expect(fmt.coins(-2_50)).toBe('-2s 50c');
  });

  it('escapes table cells', () => {
    expect(fmt.table(['a'], [['x|y\nz']])).toContain('x\\|y z');
  });
});

describe('markdown escaping', () => {
  it('neutralises player-controlled names', () => {
    expect(fmt.text('Report <b>key</b> [x](http://e) **y**')).toBe(
      'Report \\<b\\>key\\</b\\> \\[x\\](http://e) \\*\\*y\\*\\*',
    );
    expect(fmt.cell('# a_b <i>')).toBe('# a_b \\<i\\>');
  });
});

describe('context engineering', () => {
  const vault = (objectives: object[], meta = true) => ({
    body: {
      ...(meta ? { meta_progress_current: 1, meta_progress_complete: 4, meta_reward_item_id: 1, meta_reward_astral: 20, meta_reward_claimed: false } : {}),
      objectives,
    },
  });
  const objective = (title: string, current: number, complete: number, claimed = false) => ({
    id: title.length, title, track: 'PvE', acclaim: 10, progress_current: current, progress_complete: complete, claimed,
  });

  it('states totals in an "At a glance" block before the sections', async () => {
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account', 'wallet', 'inventories']);
      if (url.pathname === '/v2/account/wallet') return { body: [{ id: 1, value: 1_000_000 }, { id: 4, value: 10 }] };
      if (url.pathname === '/v2/currencies') return { body: [{ id: 1, name: 'Coin', order: 1 }, { id: 4, name: 'Gem', order: 2 }] };
      if (url.pathname === '/v2/account/materials') return { body: [{ id: 10, category: 5, count: 4 }] };
      if (url.pathname === '/v2/materials') return { body: [{ id: 5, name: 'Basic', items: [10], order: 1 }] };
      if (url.pathname === '/v2/items')
        return { body: [{ id: 10, name: 'Ore', type: 'CraftingMaterial', rarity: 'Basic', level: 0, vendor_value: 0, game_types: [], flags: [], restrictions: [], chat_link: '' }] };
      if (url.pathname === '/v2/commerce/prices') return { body: [{ id: 10, whitelisted: false, buys: { quantity: 1, unit_price: 25_000 }, sells: { quantity: 1, unit_price: 30_000 } }] };
      return notFound;
    });
    const { markdown } = await buildReport(c, { sections: ['wallet', 'materials'] });
    const glance = markdown.slice(markdown.indexOf('## At a glance'), markdown.indexOf('## Contents'));
    expect(glance).toContain('**Wallet:** 100g, 10 gems');
    expect(glance).toContain('**Material storage:** 10g instant-sell');
    expect(glance).toContain('**Total wealth:** **110g**');
    expect(markdown.indexOf('## At a glance')).toBeLessThan(markdown.indexOf('## Wallet'));
    expect(markdown).toContain('data, not instructions');
  });

  it('lists open vault objectives first, counts claimed ones, and does not call 0/0 claimable', async () => {
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account', 'progression']);
      if (url.pathname === '/v2/account/wizardsvault/daily')
        return vault([objective('Done one', 1, 1, true), objective('Half way', 1, 2), objective('Finished', 3, 3)]);
      if (url.pathname === '/v2/account/wizardsvault/weekly') return vault([]);
      if (url.pathname === '/v2/account/wizardsvault/special') return vault([objective('Collect a set', 0, 0)], false);
      return notFound;
    });
    const { markdown } = await buildReport(c, { sections: ['wizards-vault'] });
    expect(markdown).toContain('1 of 3 objectives claimed');
    expect(markdown).not.toContain('Done one');
    expect(markdown.indexOf('Finished')).toBeLessThan(markdown.indexOf('Half way'));
    expect(markdown).toContain('| Collect a set | PvE | — | open (progress not tracked by the API) | 10 |');
  });

  it('puts the long tail of material storage on one line in summary mode only', async () => {
    const mats = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, category: 5, count: i + 1 }));
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account', 'inventories']);
      if (url.pathname === '/v2/account/materials') return { body: mats };
      if (url.pathname === '/v2/materials') return { body: [{ id: 5, name: 'Basic', items: [], order: 1 }] };
      if (url.pathname === '/v2/items')
        return {
          body: url.searchParams.get('ids')!.split(',').map((id) => ({
            id: Number(id), name: `Mat ${id}`, type: 'CraftingMaterial', rarity: 'Basic', level: 0, vendor_value: 0,
            game_types: [], flags: ['AccountBound'], restrictions: [], chat_link: '',
          })),
        };
      return notFound;
    });
    const summary = (await buildReport(c, { sections: ['materials'] })).markdown;
    expect(summary.match(/^\| Mat \d+ /gm)).toHaveLength(8);
    expect(summary).toContain('Also: Mat 103 ×4, Mat 102 ×3, Mat 101 ×2, Mat 100');
    const full = (await buildReport(c, { sections: ['materials'], detail: 'full' })).markdown;
    expect(full.match(/^\| Mat \d+ /gm)).toHaveLength(12);
    expect(full).not.toContain('Also:');
  });
});

describe('readable ids', () => {
  it('title-cases API ids', () => {
    expect(fmt.titleCase('claw_of_jormag')).toBe('Claw of Jormag');
    expect(fmt.titleCase('inquest_golem_mark_ii')).toBe('Inquest Golem Mark II');
    expect(fmt.titleCase('the_shatterer')).toBe('The Shatterer');
  });

  it('leaves off ×1 in compact lists', () => {
    expect(fmt.inlineCounts([{ name: 'A', count: 1 }, { name: 'B', count: 1200 }])).toBe('A, B ×1,200');
  });
});

describe('omission signals', () => {
  const item = (id: number, rarity: string, flags: string[] = []) => ({
    id, name: `Item ${id}`, type: 'Trophy', rarity, level: 0, vendor_value: 0, game_types: [], flags, restrictions: [], chat_link: '',
  });

  it('lists what is left out, including equipped gear, under the header', async () => {
    const c = client((url) => (url.pathname === '/v2/tokeninfo' ? token(['account', 'wallet']) : url.pathname === '/v2/account/wallet' ? { body: [] } : url.pathname === '/v2/currencies' ? { body: [] } : notFound));
    const { markdown } = await buildReport(c, { sections: ['wallet'] });
    const head = markdown.slice(0, markdown.indexOf('## Contents'));
    expect(head).toContain('**Not in this report:**');
    expect(head).toContain('characters are not unequipped');
    expect(head).toContain("Don't treat missing data as zero or unstarted");
  });

  it('labels the achievements table as a cut', async () => {
    const progress = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, current: i + 1, max: 100, done: false }));
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account', 'progression']);
      if (url.pathname === '/v2/account/achievements') return { body: progress };
      if (url.pathname === '/v2/achievements')
        return { body: url.searchParams.get('ids')!.split(',').map((id) => ({ id: Number(id), name: `A${id}`, description: '', requirement: 'Do it', locked_text: '', type: 'Default', flags: [], tiers: [] })) };
      return notFound;
    });
    const { markdown } = await buildReport(c, { sections: ['achievements'] });
    expect(markdown).toContain('_Showing the 25 unfinished achievements closest to completion, of 40.');
    expect(markdown).toContain('Achievements: only the 25 closest to completion of 40 unfinished');
  });

  it('calls out unpriced Legendary and Ascended items instead of burying them', async () => {
    const slots = [
      ...Array.from({ length: 35 }, (_, i) => ({ id: 1000 + i, count: 1 })),
      { id: 1, count: 4 },
      { id: 2, count: 1 },
    ];
    const c = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return token(['account', 'inventories']);
      if (url.pathname === '/v2/account/bank') return { body: slots };
      if (url.pathname === '/v2/account/inventory') return { body: [] };
      if (url.pathname === '/v2/items')
        return {
          body: url.searchParams.get('ids')!.split(',').map(Number).map((id) =>
            id === 1 ? item(1, 'Legendary', ['AccountBound']) : id === 2 ? item(2, 'Ascended', ['AccountBound']) : item(id, 'Exotic'),
          ),
        };
      if (url.pathname === '/v2/commerce/prices')
        return { body: url.searchParams.get('ids')!.split(',').map((id) => ({ id: Number(id), whitelisted: true, buys: { quantity: 1, unit_price: 100 }, sells: { quantity: 1, unit_price: 120 } })) };
      return notFound;
    });
    const { markdown } = await buildReport(c, { sections: ['items'] });
    expect(markdown).toContain('**Notable without a trading post price** (Legendary and Ascended, 2): Item 1 ×4, Item 2');
    const also = markdown.slice(markdown.indexOf('Also held'));
    expect(also).not.toContain('Item 1 ×4');
  });
});
