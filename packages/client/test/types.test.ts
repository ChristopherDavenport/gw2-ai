import { describe, expectTypeOf, it } from 'vitest';
import type { Account, CharacterCore, ExchangeRate, Item, ParamNames, WorldBoss } from '../src/index.js';
import { Gw2Client } from '../src/index.js';

// These tests are checked by `tsc -p tsconfig.test.json`; the bodies never run
// against the network (the functions are declared, not called).
declare const gw2: Gw2Client;

describe('route typing', () => {
  it('infers response types from the route', () => {
    const account = () => gw2.get('/v2/account');
    expectTypeOf(account).returns.resolves.toEqualTypeOf<Account>();
  });

  it('requires path params named in the template', () => {
    const core = () => gw2.get('/v2/characters/:id/core', { path: { id: 'Ash Legion' } });
    expectTypeOf(core).returns.resolves.toEqualTypeOf<CharacterCore>();
    // @ts-expect-error path params are required
    void (() => gw2.get('/v2/characters/:id/core'));
    // @ts-expect-error wrong param name
    void (() => gw2.get('/v2/characters/:id/core', { path: { name: 'x' } }));
  });

  it('requires query params that have required keys', () => {
    const rate = () => gw2.get('/v2/commerce/exchange/coins', { query: { quantity: 10000 } });
    expectTypeOf(rate).returns.resolves.toEqualTypeOf<ExchangeRate>();
    // @ts-expect-error quantity is required
    void (() => gw2.get('/v2/commerce/exchange/coins'));
  });

  it('rejects unknown routes', () => {
    // @ts-expect-error not a route
    void (() => gw2.get('/v2/acount'));
  });

  it('types bulk lookups by id and element', () => {
    const items = () => gw2.many('/v2/items', [19721]);
    expectTypeOf(items).returns.resolves.toEqualTypeOf<Map<number, Item>>();
    const bosses = () => gw2.all('/v2/worldbosses');
    expectTypeOf(bosses).returns.resolves.toEqualTypeOf<WorldBoss[]>();
    // @ts-expect-error item ids are numbers
    void (() => gw2.many('/v2/items', ['19721']));
    // @ts-expect-error /v2/account is not a bulk route
    void (() => gw2.many('/v2/account', [1]));
  });

  it('extracts param names', () => {
    expectTypeOf<ParamNames<'/v2/pvp/seasons/:id/leaderboards/:board/:region'>>().toEqualTypeOf<'id' | 'board' | 'region'>();
    expectTypeOf<ParamNames<'/v2/account'>>().toEqualTypeOf<never>();
  });
});

describe('bulk keying', () => {
  it('rejects many() on bulk routes whose items have no id', () => {
    // @ts-expect-error buildstorage slots carry no id; use all()
    void (() => gw2.many('/v2/account/buildstorage', [0]));
    void (() => gw2.all('/v2/account/buildstorage'));
  });
});
