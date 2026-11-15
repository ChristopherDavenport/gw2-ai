import { describe, expect, it } from 'vitest';
import { Gw2ApiError, Gw2Client, RateLimiter, buildReport, fmt, looksLikeApiKey } from '../src/index.js';

const KEY = '00000000-0000-0000-0000-00000000000000000000-0000-0000-0000-000000000000';

type Handler = (url: URL) => { status?: number; body: unknown; headers?: Record<string, string> };

function fakeFetch(handler: Handler) {
  const calls: URL[] = [];
  const fn = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    const { status = 200, body, headers = {} } = handler(url);
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return { fn, calls };
}

function client(handler: Handler, apiKey?: string) {
  const f = fakeFetch(handler);
  const c = new Gw2Client({
    ...(apiKey ? { apiKey } : {}),
    fetch: f.fn,
    rateLimiter: new RateLimiter(10_000, 600_000),
    maxRetries: 2,
  });
  return { c, calls: f.calls };
}

describe('Gw2Client', () => {
  it('splits id lists into chunks of 200 and caches each id', async () => {
    const { c, calls } = client((url) => ({
      body: url.searchParams.get('ids')!.split(',').map((id) => ({ id: Number(id), name: `item ${id}` })),
    }));
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const first = await c.getMany<{ id: number; name: string }>('/v2/items', ids);
    expect(first.size).toBe(450);
    expect(calls).toHaveLength(3);

    const second = await c.getMany('/v2/items', [1, 2, 451]);
    expect(second.size).toBe(3);
    expect(calls).toHaveLength(4);
    expect(calls[3]!.searchParams.get('ids')).toBe('451');
  });

  it('treats "all ids invalid" 404 as an empty result', async () => {
    const { c } = client(() => ({ status: 404, body: { text: 'all ids provided are invalid' } }));
    expect((await c.getMany('/v2/items', [999999999])).size).toBe(0);
  });

  it('sends the key only to authenticated endpoints, as a query parameter', async () => {
    const { c, calls } = client(() => ({ body: {} }), KEY);
    await c.get('/v2/account');
    await c.get('/v2/items/1');
    expect(calls[0]!.searchParams.get('access_token')).toBe(KEY);
    expect(calls[1]!.searchParams.has('access_token')).toBe(false);
    expect(calls[0]!.searchParams.get('v')).toMatch(/^\d{4}-/);
  });

  it('never puts the key in error messages', async () => {
    const { c } = client(() => ({ status: 403, body: { text: 'requires scope wallet' } }), KEY);
    const err = await c.get('/v2/account/wallet').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Gw2ApiError);
    expect((err as Gw2ApiError).isAuthError).toBe(true);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).toContain('requires scope wallet');
  });

  it('fails fast on an authenticated endpoint with no key', async () => {
    const { c, calls } = client(() => ({ body: {} }));
    await expect(c.get('/v2/account')).rejects.toThrow(/needs an API key/);
    expect(calls).toHaveLength(0);
  });

  it('retries 429 and 5xx', async () => {
    let n = 0;
    const { c, calls } = client(() =>
      ++n < 3 ? { status: n === 1 ? 429 : 503, body: {}, headers: { 'retry-after': '0' } } : { body: [1, 2] },
    );
    expect(await c.get('/v2/items')).toEqual([1, 2]);
    expect(calls).toHaveLength(3);
  });

  it('collapses concurrent identical requests', async () => {
    const { c, calls } = client(() => ({ body: { ok: true } }));
    await Promise.all([c.get('/v2/build'), c.get('/v2/build'), c.get('/v2/build')]);
    expect(calls).toHaveLength(1);
  });
});

describe('buildReport', () => {
  it('skips sections the key lacks permissions for', async () => {
    const { c } = client((url) => {
      if (url.pathname === '/v2/tokeninfo') return { body: { id: 'x', name: 'test key', permissions: ['account', 'wallet'] } };
      if (url.pathname === '/v2/account/wallet') return { body: [{ id: 1, value: 1234567 }, { id: 2, value: 50 }] };
      if (url.pathname === '/v2/currencies')
        return { body: [{ id: 1, name: 'Coin', order: 1 }, { id: 2, name: 'Karma', order: 2 }] };
      return { status: 404, body: { text: 'not found' } };
    }, KEY);
    const report = await buildReport(c, { sections: ['wallet', 'characters'] });
    expect(report.sections.map((s) => [s.id, s.status])).toEqual([
      ['wallet', 'ok'],
      ['characters', 'skipped'],
    ]);
    expect(report.markdown).toContain('| Coin | 123g 45s 67c | 1 |');
    expect(report.markdown).toContain('lacks permission: characters');
  });

  it('rejects unknown section ids', async () => {
    const { c } = client(() => ({ body: { permissions: [] } }), KEY);
    await expect(buildReport(c, { sections: ['nope'] })).rejects.toThrow(/Unknown report sections/);
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

  it('recognises keys and subtokens', () => {
    expect(looksLikeApiKey(KEY)).toBe(true);
    expect(looksLikeApiKey('aaa.bbb.ccc')).toBe(true);
    expect(looksLikeApiKey('hello')).toBe(false);
  });
});
