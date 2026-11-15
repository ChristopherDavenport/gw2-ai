import { describe, expect, it } from 'vitest';
import { Gw2ApiError, Gw2Client, ROUTES, RateLimiter, looksLikeApiKey, matchRoute, missingPermissions } from '../src/index.js';

const KEY = '00000000-0000-0000-0000-00000000000000000000-0000-0000-0000-000000000000';

type Handler = (url: URL) => { status?: number; body: unknown; headers?: Record<string, string> };

function client(handler: Handler, apiKey?: string) {
  const calls: URL[] = [];
  const fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    const { status = 200, body, headers = {} } = handler(url);
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof globalThis.fetch;
  const c = new Gw2Client({
    ...(apiKey ? { apiKey } : {}),
    fetch,
    rateLimiter: new RateLimiter(10_000, 600_000),
    maxRetries: 2,
  });
  return { c, calls };
}

const echoIds: Handler = (url) => ({
  body: url.searchParams.get('ids')!.split(',').map((id) => ({ id: Number(id), name: `item ${id}` })),
});

describe('Gw2Client', () => {
  it('splits id lists into chunks of 200 and caches each id', async () => {
    const { c, calls } = client(echoIds);
    const first = await c.many('/v2/items', Array.from({ length: 450 }, (_, i) => i + 1));
    expect(first.size).toBe(450);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.searchParams.get('lang')).toBe('en');

    const second = await c.many('/v2/items', [1, 2, 451]);
    expect(second.size).toBe(3);
    expect(calls).toHaveLength(4);
    expect(calls[3]!.searchParams.get('ids')).toBe('451');
  });

  it('treats "all ids invalid" 404 as an empty result', async () => {
    const { c } = client(() => ({ status: 404, body: { text: 'all ids provided are invalid' } }));
    expect((await c.many('/v2/items', [999999999])).size).toBe(0);
    expect(await c.one('/v2/items', 999999999)).toBeUndefined();
  });

  it('uses ids=all on routes that support it', async () => {
    const { c, calls } = client(() => ({ body: [{ id: 'drakkar' }] }));
    expect(await c.all('/v2/worldbosses')).toEqual([{ id: 'drakkar' }]);
    expect(calls[0]!.searchParams.get('ids')).toBe('all');
  });

  it('sends the key only to authenticated routes, as a query parameter', async () => {
    const { c, calls } = client((url) => ({ body: url.searchParams.has('ids') ? [] : {} }), KEY);
    await c.get('/v2/account');
    await c.one('/v2/items', 1);
    expect(calls[0]!.searchParams.get('access_token')).toBe(KEY);
    expect(calls[1]!.searchParams.has('access_token')).toBe(false);
    expect(calls[0]!.searchParams.get('v')).toMatch(/^\d{4}-/);
    // lang only goes to routes that accept it.
    expect(calls[0]!.searchParams.has('lang')).toBe(false);
  });

  it('fills and encodes path params', async () => {
    const { c, calls } = client(() => ({ body: {} }), KEY);
    await c.get('/v2/characters/:id/core', { path: { id: 'Zoë Name' } });
    expect(calls[0]!.pathname).toBe('/v2/characters/Zo%C3%AB%20Name/core');
    expect(calls[0]!.searchParams.get('access_token')).toBe(KEY);
  });

  it('passes route query params', async () => {
    const { c, calls } = client(() => ({ body: { coins_per_gem: 3000, quantity: 3 } }));
    await c.get('/v2/commerce/exchange/coins', { query: { quantity: 10_000 } });
    expect(calls[0]!.searchParams.get('quantity')).toBe('10000');
  });

  it('never puts the key in error messages', async () => {
    const { c } = client(() => ({ status: 403, body: { text: 'requires scope wallet' } }), KEY);
    const err = await c.get('/v2/account').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Gw2ApiError);
    expect((err as Gw2ApiError).isAuthError).toBe(true);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('fails fast on an authenticated route with no key', async () => {
    const { c, calls } = client(() => ({ body: {} }));
    await expect(c.get('/v2/account')).rejects.toThrow(/needs an API key/);
    expect(calls).toHaveLength(0);
  });

  it('retries 429 and 5xx', async () => {
    let n = 0;
    const { c, calls } = client(() =>
      ++n < 3 ? { status: n === 1 ? 429 : 503, body: {}, headers: { 'retry-after': '0' } } : { body: [1, 2] },
    );
    expect(await c.ids('/v2/items')).toEqual([1, 2]);
    expect(calls).toHaveLength(3);
  });

  it('collapses concurrent identical requests and caches public routes', async () => {
    const { c, calls } = client(() => ({ body: [1] }));
    await Promise.all([c.ids('/v2/items'), c.ids('/v2/items'), c.ids('/v2/items')]);
    await c.ids('/v2/items');
    expect(calls).toHaveLength(1);
  });

  it('does not cache authenticated routes by default', async () => {
    const { c, calls } = client(() => ({ body: {} }), KEY);
    await c.get('/v2/account');
    await c.get('/v2/account');
    expect(calls).toHaveLength(2);
  });

  it('raw() keys its cache by the ids query', async () => {
    const { c, calls } = client(echoIds);
    const [a, b] = await Promise.all([c.raw('/v2/items', { query: { ids: '1,2' } }), c.raw('/v2/items', { query: { ids: '3' } })]);
    expect(a).toHaveLength(2);
    expect(b).toEqual([{ id: 3, name: 'item 3' }]);
    await c.raw('/v2/items', { query: { ids: '3' } });
    expect(calls).toHaveLength(2);
  });

  it('raw() decides auth from the route table', async () => {
    const { c, calls } = client(() => ({ body: {} }), KEY);
    await c.raw('/v2/characters/Someone/core');
    await c.raw('/v2/items/19721');
    expect(calls[0]!.searchParams.get('access_token')).toBe(KEY);
    expect(calls[1]!.searchParams.has('access_token')).toBe(false);
  });
});

describe('route table', () => {
  it('matches concrete paths to templates', () => {
    expect(matchRoute('/v2/characters/Some%20One/core')?.route).toBe('/v2/characters/:id/core');
    expect(matchRoute('/v2/account')?.route).toBe('/v2/account');
    expect(matchRoute('/v2/nope')).toBeUndefined();
    // Single objects from bulk routes resolve to the bulk route.
    expect(matchRoute('/v2/items/19721')?.route).toBe('/v2/items');
    expect(matchRoute('/v2/characters/Some%20One')?.meta.auth).toBe(true);
    expect(matchRoute('/v2/account/nope')).toBeUndefined();
  });

  it('reports missing permissions for a route', () => {
    expect(missingPermissions(['account'], '/v2/characters/:id/core')).toEqual(['characters']);
    expect(missingPermissions(['account', 'characters'], '/v2/characters/:id/core')).toEqual([]);
  });

  it('only marks routes with an api key requirement as auth', () => {
    expect(ROUTES['/v2/account'].auth).toBe(true);
    expect(ROUTES['/v2/items'].auth).toBe(false);
  });

  it('recognises keys and subtokens', () => {
    expect(looksLikeApiKey(KEY)).toBe(true);
    expect(looksLikeApiKey('aaa.bbb.ccc')).toBe(true);
    expect(looksLikeApiKey('hello')).toBe(false);
  });
});

describe('keyed bulk routes', () => {
  it('keys /v2/characters results by name', async () => {
    const { c } = client(
      (url) => ({ body: url.searchParams.get('ids')!.split(',').map((name) => ({ name, level: 80 })) }),
      KEY,
    );
    const chars = await c.many('/v2/characters', ['Alpha', 'Beta Two']);
    expect([...chars.keys()]).toEqual(['Alpha', 'Beta Two']);
  });
});

describe('optional auth', () => {
  it('sends the key to /v2/guild/:id only when one is configured', async () => {
    const anon = client(() => ({ body: { id: 'g', name: 'Guild', tag: 'G' } }));
    await anon.c.get('/v2/guild/:id', { path: { id: 'g' } });
    expect(anon.calls[0]!.searchParams.has('access_token')).toBe(false);

    const keyed = client(() => ({ body: { id: 'g', name: 'Guild', tag: 'G' } }), KEY);
    await keyed.c.get('/v2/guild/:id', { path: { id: 'g' } });
    expect(keyed.calls[0]!.searchParams.get('access_token')).toBe(KEY);
  });
});
