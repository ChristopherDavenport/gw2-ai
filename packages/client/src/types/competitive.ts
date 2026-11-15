// Response types for /v2/pvp*, /v2/wvw*, /v2/worlds.
//
// Written against schema 2025-08-29T01:00:00.000Z and checked with
// scripts/verify-samples.mjs. Since the 2024 World Restructuring, WvW
// matchups are made of alliance teams rather than worlds; the match routes
// still name the fields `worlds`/`all_worlds` and mix world ids (1xxx/2xxx)
// with team ids (11xxx/12xxx).

import type { Attribute, Profession } from './common.js';

// ---------------------------------------------------------------------------
// PvP

/** Sub-routes listed by `/v2/pvp`. */
export type PvpIndexEntry = 'stats' | 'games' | 'amulets' | 'ranks' | 'seasons';

/** `/v2/pvp/amulets`: an amulet from the old PvP build system. */
export interface PvpAmulet {
  id: number;
  name: string;
  icon: string;
  /** Attribute bonuses the amulet grants. */
  attributes: Partial<Record<Attribute, number>>;
}

/** Wins and losses for one category in `/v2/pvp/stats`. */
export interface PvpWinLoss {
  wins: number;
  losses: number;
  desertions: number;
  byes: number;
  forfeits: number;
}

/**
 * Ladder keys in `/v2/pvp/stats`. Wiki-documented: `unranked`, `ranked`,
 * `2v2ranked`, `3v3ranked`, `ctfranked`, `soloarenarated`, `teamarenarated`.
 */
export type PvpLadder =
  | 'unranked'
  | 'ranked'
  | '2v2ranked'
  | '3v3ranked'
  | 'ctfranked'
  | 'soloarenarated'
  | 'teamarenarated';

/** Win/loss record per ladder; only ladders played appear. */
export type PvpLadderStats = Partial<Record<PvpLadder, PvpWinLoss>>;

/** `/v2/pvp/stats` (key with `pvp`): the account's PvP rank and win/loss record. */
export interface PvpStats {
  pvp_rank: number;
  pvp_rank_points: number;
  /** Rank-ups past rank 80; 0 below it. */
  pvp_rank_rollovers: number;
  /** All matches ever played. */
  aggregate: PvpWinLoss;
  /** Per profession, keyed by lowercase profession name. Only professions played appear. */
  professions: Partial<Record<Lowercase<Profession>, PvpWinLoss>>;
  /** Per ladder. Only ladders played appear. */
  ladders: PvpLadderStats;
}

/**
 * Game mode of a PvP game. `Placeholder`: placement match at the start of a
 * season; `None`: custom arena.
 */
export type PvpRatingType =
  | 'Placeholder'
  | 'Ranked'
  | '2v2Ranked'
  | '3v3Ranked'
  | 'CtFRanked'
  | 'Unranked'
  | 'None';

/** `/v2/pvp/games` (key with `pvp`): one of the account's 10 most recent games. */
export interface PvpGame {
  /** Game UUID. */
  id: string;
  /** /v2/maps id. */
  map_id: number;
  /** ISO 8601 timestamp. */
  started: string;
  /** ISO 8601 timestamp. */
  ended: string;
  /** Known values: `Victory`, `Defeat`, `Forfeit`, `Desertion`, `Bye`. */
  result: string;
  /** Team the player was on. */
  team: 'Red' | 'Blue';
  profession: Profession;
  rating_type: PvpRatingType;
  /** Rating gained (negative when lost). */
  rating_change: number;
  /** /v2/pvp/seasons id, for games played during a season. */
  season?: string;
  /** Final score per team. */
  scores: { red: number; blue: number };
}

/** `/v2/pvp/heroes`: a Mist Champion. */
export interface PvpHero {
  /** Hero UUID. */
  id: string;
  name: string;
  description: string;
  /** Flavor type, e.g. `Offensive Hero`, `Defensive Hero`, `Specialist Hero`. */
  type: string;
  /** Rating out of 5 (or so) for each stat. */
  stats: { offense: number; defense: number; speed: number };
  /** Art URL. */
  overlay: string;
  /** Art URL. */
  underlay: string;
  skins: PvpHeroSkin[];
}

export interface PvpHeroSkin {
  /** Hero skin id; /v2/account/pvp/heroes lists unlocked ones. */
  id: number;
  name: string;
  icon: string;
  /** The skin every account has. */
  default: boolean;
  /** /v2/items ids that unlock the skin. */
  unlock_items: number[];
}

/** `/v2/pvp/ranks`: a PvP rank band and the finisher it unlocks. */
export interface PvpRank {
  id: number;
  /** /v2/finishers id. */
  finisher_id: number;
  name: string;
  icon: string;
  min_rank: number;
  max_rank: number;
  levels: PvpRankLevel[];
}

export interface PvpRankLevel {
  min_rank: number;
  max_rank: number;
  /** Rank points needed per rank in this range. */
  points: number;
}

/** Division flags in a season. `CanLosePoints`/`CanLoseTiers` appear only in seasons 1-4. */
export type PvpDivisionFlag = 'CanLosePoints' | 'CanLoseTiers' | 'Repeatable';

export interface PvpSeasonDivision {
  name: string;
  flags: PvpDivisionFlag[];
  large_icon: string;
  small_icon: string;
  pip_icon: string;
  tiers: { /** Pips to complete the tier. */ points: number }[];
}

/** Skill-rating badge (Bronze, Silver, ...), from season 5 on. */
export interface PvpSeasonRank {
  name: string;
  description: string;
  icon: string;
  overlay: string;
  overlay_small: string;
  tiers: { /** Rating threshold for the tier. */ rating: number }[];
}

/** Leaderboards a season has: `ladder` from season 5 on, `legendary` and `guild` in seasons 1-4. */
export type PvpLeaderboardName = 'ladder' | 'legendary' | 'guild';

export interface PvpLeaderboardTier {
  /** Two leaderboard positions, the larger first: `[250, 101]`. Can be fractional. */
  range: [number, number];
  /** Guild leaderboard only, e.g. `#EAC117`. */
  color?: string;
  /** Guild leaderboard only. Known value: `Rank`. */
  type?: string;
  /** Guild leaderboard only. */
  name?: string;
}

export interface PvpLeaderboardScoring {
  /** Scoring UUID; matched by `scores[].id` in leaderboard entries. */
  id: string;
  /** Known value: `Integer`. */
  type: string;
  description: string;
  /** e.g. `Rating`, `Wins`, `Losses`. */
  name: string;
  ordering: 'MoreIsBetter' | 'LessIsBetter';
}

export interface PvpSeasonLeaderboard {
  settings: {
    /** Always empty so far. */
    name: string;
    /** Always null so far. */
    duration: number | null;
    /** The primary `scorings[].id`. */
    scoring: string;
    tiers: PvpLeaderboardTier[];
  };
  scorings: PvpLeaderboardScoring[];
}

/** `/v2/pvp/seasons`: a PvP League season. */
export interface PvpSeason {
  /** Season UUID. */
  id: string;
  name: string;
  /** ISO 8601 timestamp. Missing for some seasons that never ran. */
  start?: string;
  /** ISO 8601 timestamp. Missing for some seasons that never ran. */
  end?: string;
  active: boolean;
  divisions: PvpSeasonDivision[];
  /** Skill-rating badges, from season 5 on. */
  ranks?: PvpSeasonRank[];
  leaderboards: Partial<Record<PvpLeaderboardName, PvpSeasonLeaderboard>>;
}

/** Leaderboard region, the `:region` of /v2/pvp/seasons/:id/leaderboards/:board/:region. */
export type PvpRegion = 'na' | 'eu';

/** `/v2/pvp/seasons/:id/leaderboards/:board/:region`: one leaderboard row. */
export interface PvpLeaderboardEntry {
  /** Account name, or guild name on the `guild` board. */
  name: string;
  rank: number;
  /** `guild` board only: /v2/guild/:id id. */
  id?: string;
  /** `guild` board only: team name. */
  team?: string;
  /** `guild` board only: internal team id. */
  team_id?: number;
  /** ISO 8601 timestamp the rank was reached. */
  date: string;
  /** Values keyed by the season's `leaderboards[board].scorings[].id`. */
  scores: { id: string; value: number }[];
}

export interface PvpStandingProgress {
  total_points: number;
  /** Index into the season's `divisions`. */
  division: number;
  /** Index into that division's `tiers`. */
  tier: number;
  points: number;
  /** Times the account has completed the repeatable division. */
  repeats: number;
}

/** `/v2/pvp/standings` (key with `pvp`): the account's progress in each season. */
export interface PvpStanding {
  current: PvpStandingProgress & {
    /** Season 5 on: current skill rating. */
    rating?: number;
    /** Season 5 on: current rating decay. */
    decay?: number;
  };
  best: PvpStandingProgress;
  /** /v2/pvp/seasons id. */
  season_id: string;
}

// ---------------------------------------------------------------------------
// Worlds

/** `/v2/worlds`: a pre-2024 home world. Still listed, but WvW matchmaking now uses teams. */
export interface World {
  /** First digit: region (1 NA, 2 EU); second digit on EU: language (1 FR, 2 DE, 3 ES). */
  id: number;
  name: string;
  population: 'Low' | 'Medium' | 'High' | 'VeryHigh' | 'Full';
}

// ---------------------------------------------------------------------------
// WvW

/** Team colors as they appear in keys (`red`) and owner values (`Red`). */
export type WvwTeamColor = 'red' | 'green' | 'blue';
export type WvwOwner = 'Red' | 'Green' | 'Blue' | 'Neutral';

/** A number per team color: scores, kills, deaths, victory points. */
export type WvwTeamValues<T = number> = Record<WvwTeamColor, T>;

/** Map in a match. `Center` is Eternal Battlegrounds. */
export type WvwMapType = 'Center' | 'RedHome' | 'GreenHome' | 'BlueHome';

/** `/v2/wvw/abilities`: a WvW mastery line. */
export interface WvwAbility {
  id: number;
  name: string;
  description: string;
  icon: string;
  ranks: { /** WvW ability points for this rank. */ cost: number; effect: string }[];
}

/** WvW region, used by /v2/wvw/guilds and the timers. */
export type WvwRegion = 'na' | 'eu';

/**
 * `/v2/wvw/guilds/:region`: every guild that chose a WvW guild in the
 * region, mapped to its team. Keys are /v2/guild/:id ids; values are team ids
 * as strings (`"11007"`), which no route resolves.
 */
export type WvwGuildTeams = Record<string, string>;

/** `/v2/wvw/timers/lockout` and `/v2/wvw/timers/teamAssignment`: an ISO 8601 timestamp per region. */
export type WvwRegionTimes = Record<WvwRegion, string>;

/** Shared head of the /v2/wvw/matches* objects. */
export interface WvwMatchBase {
  /** Match id, `<region>-<tier>` (`1-3`: NA tier 3). */
  id: string;
}

/**
 * Ids per side: since 2024, a team id (11xxx NA, 12xxx EU) plus the old
 * /v2/worlds ids linked to it.
 */
export interface WvwMatchWorlds {
  /** One id per side: the side's main /v2/worlds id. */
  worlds: WvwTeamValues;
  /** Every id on each side, team ids (11xxx/12xxx) and /v2/worlds ids mixed. */
  all_worlds: WvwTeamValues<number[]>;
}

/** `/v2/wvw/matches/overview`: who is fighting whom, and when. */
export interface WvwMatchOverview extends WvwMatchBase, WvwMatchWorlds {
  /** ISO 8601 timestamp. */
  start_time: string;
  /** ISO 8601 timestamp. */
  end_time: string;
}

export interface WvwSkirmish {
  /** 1-based skirmish number within the match. */
  id: number;
  scores: WvwTeamValues;
  map_scores: { type: WvwMapType; scores: WvwTeamValues }[];
}

/** `/v2/wvw/matches/scores`. */
export interface WvwMatchScores extends WvwMatchBase {
  scores: WvwTeamValues;
  victory_points: WvwTeamValues;
  skirmishes: WvwSkirmish[];
  maps: { /** /v2/maps id. */ id: number; type: WvwMapType; scores: WvwTeamValues }[];
}

/** `/v2/wvw/matches/stats`. */
export interface WvwMatchStats extends WvwMatchBase {
  kills: WvwTeamValues;
  deaths: WvwTeamValues;
  maps: { /** /v2/maps id. */ id: number; type: WvwMapType; kills: WvwTeamValues; deaths: WvwTeamValues }[];
}

/** Objective type in a live match. `Mercenary`: Dredge, Krait or Frog NPC camps. */
export type WvwMatchObjectiveType = 'Spawn' | 'Camp' | 'Ruins' | 'Tower' | 'Keep' | 'Castle' | 'Mercenary';

/** Live state of one objective in `/v2/wvw/matches` `maps[].objectives`. */
export interface WvwMatchObjective {
  /** /v2/wvw/objectives id. */
  id: string;
  type: WvwMatchObjectiveType;
  owner: WvwOwner;
  /** ISO 8601 timestamp of the last capture. */
  last_flipped: string;
  /** /v2/guild/:id id of the claiming guild; null when unclaimed, absent on unclaimable objectives. */
  claimed_by?: string | null;
  /** ISO 8601 timestamp of the claim; null when unclaimed, absent on unclaimable objectives. */
  claimed_at?: string | null;
  /** War score per tick. */
  points_tick: number;
  /** War score for capturing. */
  points_capture: number;
  /** Claimable objectives only: /v2/guild/upgrades ids slotted by the claiming guild. */
  guild_upgrades?: number[];
  /** Claimable objectives only: dolyaks delivered since capture, across all tiers. */
  yaks_delivered?: number;
}

export interface WvwMatchMap {
  /** /v2/maps id. */
  id: number;
  type: WvwMapType;
  scores: WvwTeamValues;
  kills: WvwTeamValues;
  deaths: WvwTeamValues;
  /** Map bonuses held. Empty when nobody holds one. */
  bonuses: { /** Known value: `Bloodlust`. */ type: string; owner: Exclude<WvwOwner, 'Neutral'> }[];
  objectives: WvwMatchObjective[];
}

/** `/v2/wvw/matches`: the full live state of a match. */
export interface WvwMatch extends WvwMatchOverview {
  scores: WvwTeamValues;
  kills: WvwTeamValues;
  deaths: WvwTeamValues;
  victory_points: WvwTeamValues;
  maps: WvwMatchMap[];
  skirmishes: WvwSkirmish[];
}

/**
 * `/v2/wvw/matches/stats/:id/teams/:team/top/kdr|kills`: top guilds on a team.
 * Undocumented, and every match and team returned `[]` when sampled on
 * 2026-11-15; the fields follow a community client's fixture and are
 * unverified.
 */
export interface WvwMatchTopGuild {
  /** /v2/guild/:id id. */
  guild_id: string;
  kills?: WvwTeamValues;
  deaths?: WvwTeamValues;
}

/**
 * `/v2/wvw/matches/stats/:id/guilds/:guild_id`: undocumented. Every guild
 * sampled on 2026-11-15 (claimants of live objectives) returned 404
 * "no data for guild", so the shape is unknown.
 */
export type WvwMatchGuildStats = unknown;

/** Objective type in the static catalog; adds non-capturable markers to {@link WvwMatchObjectiveType}. */
export type WvwObjectiveType = WvwMatchObjectiveType | 'Generic' | 'Resource';

/** `/v2/wvw/objectives`: static objective data. */
export interface WvwObjective {
  /** `<map_id>-<n>`, e.g. `38-6`. */
  id: string;
  name: string;
  /** Map sector id (see /v2/continents). */
  sector_id: number;
  type: WvwObjectiveType;
  /** `EdgeOfTheMists` for Edge of the Mists objectives, which never appear in matches. */
  map_type: WvwMapType | 'EdgeOfTheMists';
  /** /v2/maps id. */
  map_id: number;
  /** /v2/wvw/upgrades id. */
  upgrade_id?: number;
  /** Marker position: x, y, z. */
  coord?: [number, number, number];
  /** Sector centroid: x, y. */
  label_coord?: [number, number];
  /** Neutral gray icon URL. */
  marker?: string;
  chat_link: string;
}

/** `/v2/wvw/ranks`: a WvW rank title. */
export interface WvwRank {
  id: number;
  title: string;
  /** Lowest WvW level that holds the title. */
  min_rank: number;
}

/** `/v2/wvw/upgrades`: the automatic upgrade path of an objective. */
export interface WvwUpgrade {
  /** Matched by /v2/wvw/objectives `upgrade_id`. */
  id: number;
  tiers: WvwUpgradeTier[];
}

export interface WvwUpgradeTier {
  /** e.g. `Secured`, `Reinforced`, `Fortified`. */
  name: string;
  /** Dolyaks needed to reach the tier. */
  yaks_required: number;
  upgrades: { name: string; description: string; icon: string }[];
}
