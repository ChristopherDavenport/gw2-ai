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
