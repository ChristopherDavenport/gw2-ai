import { describe, expectTypeOf, it } from 'vitest';
import type { Account, Item, ResponseOf, WorldBoss } from '../src/index.js';
import { Gw2Client } from '../src/index.js';

// Keeps the examples in README.md honest. Type-checked only; never called.
declare const gw2: Gw2Client;

describe('README examples', () => {
  it('compiles the positive examples with the stated types', () => {
    void (async () => {
      expectTypeOf(await gw2.get('/v2/account')).toEqualTypeOf<Account>();
      expectTypeOf(await gw2.get('/v2/account/wallet')).toEqualTypeOf<ResponseOf<'/v2/account/wallet'>>();
      await gw2.get('/v2/characters/:id/core', { path: { id: 'Example Name' } });
      await gw2.get('/v2/commerce/exchange/coins', { query: { quantity: 1_000_000 } });
      expectTypeOf(await gw2.many('/v2/items', [19721, 19976])).toEqualTypeOf<Map<number, Item>>();
      expectTypeOf(await gw2.one('/v2/items', 19721)).toEqualTypeOf<Item | undefined>();
      expectTypeOf(await gw2.all('/v2/worldbosses')).toEqualTypeOf<WorldBoss[]>();
      const item = (await gw2.many('/v2/items', [19721])).get(19721);
      if (item?.type === 'Weapon') void item.details.damage_type;
    });
  });

  it('rejects the negative examples', () => {
    void (async () => {
      // @ts-expect-error unknown route
      await gw2.get('/v2/acount');
      // @ts-expect-error missing path param
      await gw2.get('/v2/characters/:id/core');
      // @ts-expect-error missing required query
      await gw2.get('/v2/commerce/exchange/coins');
      // @ts-expect-error item ids are numbers
      await gw2.many('/v2/items', ['19721']);
      // @ts-expect-error team is lowercase
      await gw2.get('/v2/wvw/matches/stats/:id/teams/:team/top/kdr', { path: { id: '1-1', team: 'Red' } });
    });
  });
});
