// Response types for /v2/account*, /v2/tokeninfo, /v2/createsubtoken and
// /v2/wizardsvault*, at schema 2025-08-29T01:00:00.000Z.

import type { Permission } from '../spec.js';
import type {
  Build,
  BuildPets,
  BuildSkillBar,
  BuildSpecialization,
  IdCount,
  IdValue,
  InventorySlot,
  Profession,
} from './common.js';

// ---------------------------------------------------------------------------
// /v2/account

/**
 * Content an account owns. The known values are listed; `string & {}` keeps
 * the type open so a new expansion's flag doesn't break callers, while
 * editors still suggest the known names.
 */
export type AccountAccess = KnownAccountAccess | (string & {});

export type KnownAccountAccess =
  | 'None'
  | 'PlayForFree'
  | 'GuildWars2'
  | 'HeartOfThorns'
  | 'PathOfFire'
  | 'EndOfDragons'
  | 'SecretsOfTheObscure'
  | 'JanthirWilds';

export interface Account {
  /** Persistent account GUID. Prefer this over `name`, which can change. */
  id: string;
  /** Account name with numeric suffix, e.g. `Name.1234`. */
  name: string;
  /** Account age in seconds. Counts time played, not time since `created`. */
  age: number;
  /** ISO-8601 time the account data last changed, as seen by the API. */
  last_modified: string;
  /** /v2/worlds id of the home world. Superseded by `wvw.team_id` for WvW. */
  world: number;
  /** /v2/guild ids of the guilds the account is in. */
  guilds: string[];
  /** /v2/guild ids of the guilds the account leads. Needs the `guilds` scope. */
  guild_leader?: string[];
  /** ISO-8601 creation time. */
  created: string;
  access: AccountAccess[];
  /** Owns the Commander's Compendium (the Catmander tag does not count). */
  commander: boolean;
  /** Personal fractal reward level. Needs the `progression` scope. */
  fractal_level?: number;
  /** Daily achievement points. Needs the `progression` scope. */
  daily_ap?: number;
  /** Monthly achievement points. Needs the `progression` scope. */
  monthly_ap?: number;
  wvw: AccountWvwSummary;
  /** Unlocked build storage slots. Needs the `builds` scope. */
  build_storage_slots?: number;
}

/** The `wvw` block of /v2/account. */
export interface AccountWvwSummary {
  /** WvW team id from the world restructuring (e.g. 11001); see /v2/wvw/guilds/:region. */
  team_id: number;
  /** Personal WvW rank. Needs the `progression` scope. */
  rank?: number;
}

// ---------------------------------------------------------------------------
// Progress

/**
 * Progress on one achievement the account has started. Achievements with no
 * progress are omitted.
 */
export interface AccountAchievement {
  /** /v2/achievements id. */
  id: number;
  /**
   * Indices into the achievement's `bits` (from /v2/achievements) that are
   * done. Omitted once the achievement is done.
   */
  bits?: number[];
  current?: number;
  max?: number;
  done: boolean;
  /** Times completed, for repeatable achievements. */
  repeated?: number;
  /** False when the achievement is still locked; absent means unlocked. */
  unlocked?: boolean;
}

export interface AccountMastery {
  /** /v2/masteries id. */
  id: number;
  /** 0-based index into the mastery's `levels`: the highest level unlocked. Absent if not started. */
  level?: number;
}

export interface AccountMasteryPoints {
  /** One entry per region the account has entered. */
  totals: AccountMasteryPointTotal[];
  /** Mastery point ids the account has earned (see `mastery` rewards in /v2/achievements). */
  unlocked: number[];
}

export interface AccountMasteryPointTotal {
  /**
   * Mastery region. Known values: `Central Tyria`, `Heart of Thorns`,
   * `Path of Fire`, `Icebrood Saga`, `End of Dragons`,
   * `Secrets of the Obscure`, `Janthir Wilds`, `Visions of Eternity`.
   */
  region: string;
  spent: number;
  earned: number;
}

/** Ids returned by /v2/account/progression. */
export type AccountProgressionId =
  | 'fractal_agony_impedance'
  | 'fractal_empowerment'
  | 'fractal_karmic_retribution'
  | 'luck';

/** One /v2/account/progression entry. `luck` is the total luck consumed. */
export type AccountProgression = IdValue<AccountProgressionId>;

/** The single /v2/account/luck entry: total luck consumed (can exceed the cap). */
export type AccountLuck = IdValue<'luck'>;

// ---------------------------------------------------------------------------
// Storage

/** One currency in /v2/account/wallet; `id` is a /v2/currencies id. */
export type AccountWalletCurrency = IdValue;

/** One material storage slot. Every material is listed, including count 0. */
export interface AccountMaterial {
  /** /v2/items id. */
  id: number;
  /** /v2/materials id. */
  category: number;
  count: number;
  binding?: 'Account';
}

/** One unlocked legendary armory item; `id` is a /v2/items and /v2/legendaryarmory id, `count` the copies usable per template. */
export type AccountLegendaryArmoryItem = IdCount;

/** One decoration placed in the homestead; `id` is a /v2/homestead/decorations id. */
export type AccountHomesteadDecoration = IdCount;

// ---------------------------------------------------------------------------
// Unlocks

export interface AccountFinisher {
  /** /v2/finishers id. */
  id: number;
  permanent: boolean;
  /** Remaining uses when `permanent` is false. */
  quantity?: number;
}

// ---------------------------------------------------------------------------
// /v2/account/buildstorage

/** One saved build template in account build storage. */
/** One /v2/account/buildstorage slot. */
export type AccountBuildStorageSlot = Build;
export type AccountBuildSpecialization = BuildSpecialization;
export type AccountBuildSkills = BuildSkillBar;
export type AccountBuildPets = BuildPets;

// ---------------------------------------------------------------------------
// /v2/account/wvw

export interface AccountWvw {
  /** WvW team id; names are listed on the wiki page for /v2/wvw/guilds/:region. */
  team: number;
  /** /v2/guild id of the selected WvW guild. */
  guild: string;
}

// ---------------------------------------------------------------------------
// Wizard's Vault

/** Wizard's Vault objective track. */
export type WizardsVaultTrack = 'PvE' | 'PvP' | 'WvW';

/**
 * Where a reward appears in the vault: the hero banner, the rewards table,
 * or the Legacy Vault section.
 */
export type WizardsVaultListingType = 'Featured' | 'Normal' | 'Legacy';

/** /v2/wizardsvault: the current season. */
export interface WizardsVaultSeason {
  title: string;
  /** ISO-8601 season start. */
  start: string;
  /** ISO-8601 season end. */
  end: string;
  /** /v2/wizardsvault/listings ids. */
  listings: number[];
  /** /v2/wizardsvault/objectives ids. */
  objectives: number[];
}

export interface WizardsVaultListing {
  id: number;
  /** /v2/items id. */
  item_id: number;
  item_count: number;
  type: WizardsVaultListingType;
  /** Price in Astral Acclaim. */
  cost: number;
}

export interface WizardsVaultObjective {
  id: number;
  title: string;
  track: WizardsVaultTrack;
  /** Astral Acclaim awarded. */
  acclaim: number;
}

/** A listing with the account's purchase state. */
export interface AccountWizardsVaultListing extends WizardsVaultListing {
  /** Times bought. Absent for unlimited rewards. */
  purchased?: number;
  /** Purchase cap. Absent for unlimited rewards. */
  purchase_limit?: number;
}

/** An objective in the current period with the account's progress. */
export interface AccountWizardsVaultObjective extends WizardsVaultObjective {
  progress_current: number;
  progress_complete: number;
  /** Reward claimed. */
  claimed: boolean;
}

/** /v2/account/wizardsvault/special: objectives with no meta reward. */
export interface AccountWizardsVaultSpecial {
  objectives: AccountWizardsVaultObjective[];
}

/** /v2/account/wizardsvault/daily and /weekly: objectives plus the meta reward for finishing enough of them. */
export interface AccountWizardsVaultPeriod extends AccountWizardsVaultSpecial {
  meta_progress_current: number;
  /** Progress needed before the meta reward can be claimed. */
  meta_progress_complete: number;
  /** /v2/items id of the meta reward. */
  meta_reward_item_id: number;
  /** Astral Acclaim from the meta reward. */
  meta_reward_astral: number;
  meta_reward_claimed: boolean;
}

// ---------------------------------------------------------------------------
// Keys

/** /v2/tokeninfo: the key or subtoken used for the request. */
export interface TokenInfo {
  /** First half of the API key. */
  id: string;
  /** Name the owner gave the key. Not escaped: may contain HTML or script. */
  name: string;
  permissions: Permission[];
  type: 'APIKey' | 'Subtoken';
  /** Subtokens only: ISO-8601 expiry. */
  expires_at?: string;
  /** Subtokens only: ISO-8601 creation time. */
  issued_at?: string;
  /** Subtokens only: the endpoints the subtoken is restricted to, if any. */
  urls?: string[];
}

/** /v2/createsubtoken query. */
export interface CreateSubtokenQuery {
  /** Comma-separated permissions to inherit; ones the key lacks are ignored. */
  permissions: string;
  /** ISO-8601 expiry; clamped to one year from now. */
  expire?: string;
  /** Comma-separated endpoints the subtoken may call, e.g. `/v2/account/bank,/v2/account/inventory`. */
  urls?: string;
}

export interface Subtoken {
  /** JWT usable in place of an API key, within the requested limits. */
  subtoken: string;
}
