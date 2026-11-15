import { describe, expectTypeOf, it } from 'vitest';
import type { PvpLeaderboardEntry, WvwGuildTeams, WvwMatchTopGuild } from '../src/index.js';
import { Gw2Client } from '../src/index.js';

// Checked by `tsc -p tsconfig.test.json`; the bodies never run against the network.
declare const gw2: Gw2Client;

describe('competitive path params', () => {
  it('narrows :team to lowercase team colors', () => {
    const top = () => gw2.get('/v2/wvw/matches/stats/:id/teams/:team/top/kdr', { path: { id: '1-1', team: 'red' } });
    expectTypeOf(top).returns.resolves.toEqualTypeOf<WvwMatchTopGuild[]>();
    // @ts-expect-error the API wants lowercase colors
    void (() => gw2.get('/v2/wvw/matches/stats/:id/teams/:team/top/kills', { path: { id: '1-1', team: 'Red' } }));
  });

  it('narrows :region to na/eu', () => {
    const guilds = () => gw2.get('/v2/wvw/guilds/:region', { path: { region: 'eu' } });
    expectTypeOf(guilds).returns.resolves.toEqualTypeOf<WvwGuildTeams>();
    // @ts-expect-error not a region
    void (() => gw2.get('/v2/wvw/guilds/:region', { path: { region: 'us' } }));
  });

  it('narrows :board and :region but leaves :id open', () => {
    const board = () =>
      gw2.get('/v2/pvp/seasons/:id/leaderboards/:board/:region', {
        path: { id: '8C6177C2-3733-410C-966E-DCB006A3143E', board: 'ladder', region: 'na' },
      });
    expectTypeOf(board).returns.resolves.toEqualTypeOf<PvpLeaderboardEntry[]>();
    void (() =>
      gw2.get('/v2/pvp/seasons/:id/leaderboards/:board/:region', {
        // @ts-expect-error not a leaderboard
        path: { id: 'x', board: 'solo', region: 'na' },
      }));
  });
});
