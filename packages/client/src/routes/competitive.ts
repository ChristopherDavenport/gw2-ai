import type { MetaTable } from '../spec.js';
import type {
  PvpAmulet,
  PvpGame,
  PvpHero,
  PvpIndexEntry,
  PvpLeaderboardEntry,
  PvpLeaderboardName,
  PvpRank,
  PvpRegion,
  PvpSeason,
  PvpStanding,
  PvpStats,
  World,
  WvwAbility,
  WvwGuildTeams,
  WvwMatch,
  WvwMatchGuildStats,
  WvwMatchOverview,
  WvwMatchScores,
  WvwMatchStats,
  WvwMatchTopGuild,
  WvwObjective,
  WvwRank,
  WvwRegion,
  WvwRegionTimes,
  WvwTeamColor,
  WvwUpgrade,
} from '../types/competitive.js';

// The four /v2/wvw/matches* routes also accept `?world=<world or team id>`,
// which returns a single match object instead of the id list. `response`
// can't vary with the query, so `world` is not declared here; use
// `raw()` for it, or look the match up by id.

/** PvP, WvW and worlds: /v2/pvp*, /v2/wvw*, /v2/worlds */
export interface CompetitiveRoutes {
  // PvP
  '/v2/pvp': { response: PvpIndexEntry[] };
  '/v2/pvp/amulets': { response: number[]; item: PvpAmulet; id: number };
  /** Game UUIDs of the account's 10 most recent games. */
  '/v2/pvp/games': { response: string[]; item: PvpGame; id: string };
  '/v2/pvp/heroes': { response: string[]; item: PvpHero; id: string };
  '/v2/pvp/ranks': { response: number[]; item: PvpRank; id: number };
  '/v2/pvp/seasons': { response: string[]; item: PvpSeason; id: string };
  /** Boards for the season; `:board` in the next route. */
  '/v2/pvp/seasons/:id/leaderboards': { response: PvpLeaderboardName[] };
  /** `:board` from the previous route. Top entries only. */
  '/v2/pvp/seasons/:id/leaderboards/:board/:region': {
    response: PvpLeaderboardEntry[];
    path: { board: PvpLeaderboardName; region: PvpRegion };
  };
  /** One entry per season the account played. */
  '/v2/pvp/standings': { response: PvpStanding[] };
  '/v2/pvp/stats': { response: PvpStats };

  // Worlds
  '/v2/worlds': { response: number[]; item: World; id: number };

  // WvW
  '/v2/wvw/abilities': { response: number[]; item: WvwAbility; id: number };
  '/v2/wvw/guilds': { response: WvwRegion[] };
  '/v2/wvw/guilds/:region': { response: WvwGuildTeams; path: { region: WvwRegion } };
  '/v2/wvw/matches': { response: string[]; item: WvwMatch; id: string };
  '/v2/wvw/matches/overview': { response: string[]; item: WvwMatchOverview; id: string };
  '/v2/wvw/matches/scores': { response: string[]; item: WvwMatchScores; id: string };
  '/v2/wvw/matches/stats': { response: string[]; item: WvwMatchStats; id: string };
  /** `:id` a match id, `:guild_id` a /v2/guild/:id id. */
  '/v2/wvw/matches/stats/:id/guilds/:guild_id': { response: WvwMatchGuildStats };
  /** `:team` is lowercase; `Red` is a 400. */
  '/v2/wvw/matches/stats/:id/teams/:team/top/kdr': { response: WvwMatchTopGuild[]; path: { team: WvwTeamColor } };
  /** `:team` is lowercase; `Red` is a 400. */
  '/v2/wvw/matches/stats/:id/teams/:team/top/kills': { response: WvwMatchTopGuild[]; path: { team: WvwTeamColor } };
  '/v2/wvw/objectives': { response: string[]; item: WvwObjective; id: string };
  '/v2/wvw/ranks': { response: number[]; item: WvwRank; id: number };
  '/v2/wvw/timers': { response: ('lockout' | 'teamAssignment')[] };
  /** When team selection locks before the next relink. */
  '/v2/wvw/timers/lockout': { response: WvwRegionTimes };
  /** When the next relink assigns teams. */
  '/v2/wvw/timers/teamAssignment': { response: WvwRegionTimes };
  '/v2/wvw/upgrades': { response: number[]; item: WvwUpgrade; id: number };
}

export const COMPETITIVE_ROUTES: MetaTable<CompetitiveRoutes> = {
  '/v2/pvp': { auth: false, permissions: [], lang: false },
  '/v2/pvp/amulets': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/pvp/games': { auth: true, permissions: ['pvp'], lang: false, bulk: 'all' },
  '/v2/pvp/heroes': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/pvp/ranks': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/pvp/seasons': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/pvp/seasons/:id/leaderboards': { auth: false, permissions: [], lang: false },
  '/v2/pvp/seasons/:id/leaderboards/:board/:region': { auth: false, permissions: [], lang: false, live: true },
  '/v2/pvp/standings': { auth: true, permissions: ['pvp'], lang: false },
  '/v2/pvp/stats': { auth: true, permissions: ['pvp'], lang: false },

  '/v2/worlds': { auth: false, permissions: [], lang: true, bulk: 'all' },

  '/v2/wvw/abilities': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/wvw/guilds': { auth: false, permissions: [], lang: false },
  '/v2/wvw/guilds/:region': { auth: false, permissions: [], lang: false },
  '/v2/wvw/matches': { auth: false, permissions: [], lang: false, bulk: 'all', live: true },
  '/v2/wvw/matches/overview': { auth: false, permissions: [], lang: false, bulk: 'all' },
  '/v2/wvw/matches/scores': { auth: false, permissions: [], lang: false, bulk: 'all', live: true },
  '/v2/wvw/matches/stats': { auth: false, permissions: [], lang: false, bulk: 'all', live: true },
  '/v2/wvw/matches/stats/:id/guilds/:guild_id': { auth: false, permissions: [], lang: false, live: true },
  '/v2/wvw/matches/stats/:id/teams/:team/top/kdr': { auth: false, permissions: [], lang: false, live: true },
  '/v2/wvw/matches/stats/:id/teams/:team/top/kills': { auth: false, permissions: [], lang: false, live: true },
  '/v2/wvw/objectives': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/wvw/ranks': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/wvw/timers': { auth: false, permissions: [], lang: false },
  '/v2/wvw/timers/lockout': { auth: false, permissions: [], lang: false },
  '/v2/wvw/timers/teamAssignment': { auth: false, permissions: [], lang: false },
  '/v2/wvw/upgrades': { auth: false, permissions: [], lang: true, bulk: 'all' },
};
