// Response types for /v2/characters*, /v2/guild*, /v2/backstory*, /v2/emblem*,
// /v2/files, /v2/quaggans, /v2/logos and /v2/build.

import type {
  Build,
  BuildPets,
  BuildSkillBar,
  BuildSpecialization,
  CraftingDiscipline,
  InventorySlot,
  Profession,
  Race,
  SelectedStats,
} from './common.js';
import type { PvpGame, PvpLadderStats, PvpWinLoss } from './competitive.js';

// ---------------------------------------------------------------------------
// Characters. Each sub-route returns one part of the full character, and
// `Character` (from /v2/characters?ids=) is composed from those parts.

export type CharacterGender = 'Male' | 'Female';

/** /v2/characters/:id/core */
export interface CharacterCore {
  name: string;
  race: Race;
  gender: CharacterGender;
  profession: Profession;
  level: number;
  /** /v2/guild id of the represented guild; `null` or absent when none. */
  guild?: string | null;
  /** Seconds played. */
  age: number;
  /** ISO-8601 time the character last changed, as seen by the API. */
  last_modified: string;
  /** ISO-8601 creation time. */
  created: string;
  deaths: number;
  /** /v2/titles id of the selected title; absent when none is selected. */
  title?: number;
}

/** /v2/characters/:id/backstory */
export interface CharacterBackstory {
  /** /v2/backstory/answers ids, e.g. `"7-54"`. */
  backstory: string[];
}

export interface CharacterCraftingDiscipline {
  discipline: CraftingDiscipline;
  rating: number;
  /** Whether the discipline is one of the character's two active ones. */
  active: boolean;
}

/** /v2/characters/:id/crafting */
export interface CharacterCrafting {
  crafting: CharacterCraftingDiscipline[];
}

/** A bag in a bag slot. */
export interface CharacterBag {
  /** /v2/items id of the bag. */
  id: number;
  size: number;
  /** Exactly `size` slots; `null` is an empty slot. */
  inventory: (InventorySlot | null)[];
}

/** /v2/characters/:id/inventory */
export interface CharacterInventory {
  /** One entry per bag slot; `null` is an empty bag slot. */
  bags: (CharacterBag | null)[];
}

/** /v2/characters/:id/recipes */
export interface CharacterRecipes {
  /** /v2/recipes ids the character has learned. */
  recipes: number[];
}

export interface CharacterTrainingTree {
  /** Training tree id from the `training` list of /v2/professions. */
  id: number;
  /** Hero points spent in this tree. */
  spent: number;
  /** Whether the tree is fully trained. */
  done: boolean;
}

/** /v2/characters/:id/training */
export interface CharacterTraining {
  training: CharacterTrainingTree[];
}

export interface CharacterSabZone {
  /** Internal id unique per world, zone and mode. */
  id: number;
  mode: 'infantile' | 'normal' | 'tribulation';
  world: number;
  zone: number;
}

export interface CharacterSabUnlock {
  id: number;
  /** Unlocalized name such as `chain_stick`; absent for some unlocks. */
  name?: string;
}

export interface CharacterSabSong {
  id: number;
  /** Unlocalized name: `secret_song`, `gatekeeper_lullaby`, `shatter_serenade`. */
  name: string;
}

/** /v2/characters/:id/sab: Super Adventure Box progress. */
export interface CharacterSab {
  zones: CharacterSabZone[];
  unlocks: CharacterSabUnlock[];
  songs: CharacterSabSong[];
}

export interface CharacterWvwAbility {
  /** /v2/wvw/abilities id. */
  id: number;
  rank: number;
}

/** Documented character flags. */
export type CharacterFlag = 'Beta';

// Equipment --------------------------------------------------------------

export type CharacterEquipmentSlot =
  | 'Helm'
  | 'HelmAquatic'
  | 'Shoulders'
  | 'Coat'
  | 'Gloves'
  | 'Leggings'
  | 'Boots'
  | 'Backpack'
  | 'Accessory1'
  | 'Accessory2'
  | 'Amulet'
  | 'Ring1'
  | 'Ring2'
  | 'Relic'
  | 'WeaponA1'
  | 'WeaponA2'
  | 'WeaponB1'
  | 'WeaponB2'
  | 'WeaponAquaticA'
  | 'WeaponAquaticB'
  | 'Sickle'
  | 'Axe'
  | 'Pick'
  | 'FishingRod'
  | 'FishingBait'
  | 'FishingLure'
  | 'PowerCore'
  | 'SensoryArray'
  | 'ServiceChip';

/**
 * Where an equipped item lives. `Armory` and `LegendaryArmory` mean it is
 * used only by inactive equipment tabs; the `LegendaryArmory` forms mean the
 * item is the account-wide copy from /v2/account/legendaryarmory.
 */
export type CharacterEquipmentLocation = 'Equipped' | 'Armory' | 'EquippedFromLegendaryArmory' | 'LegendaryArmory';

/** Fields shared by /equipment entries and equipment tab entries. */
export interface CharacterEquipmentPiece {
  /** /v2/items id. */
  id: number;
  location: CharacterEquipmentLocation;
  /** /v2/skins id when transmuted. */
  skin?: number;
  /** /v2/items ids of runes and sigils. */
  upgrades?: number[];
  /** /v2/items ids of infusions. */
  infusions?: number[];
  /** /v2/colors ids, one per dye channel; `null` for an undyed or unavailable channel. */
  dyes?: (number | null)[];
  /** Chosen stats, for selectable-stat items. */
  stats?: SelectedStats;
  binding?: 'Account' | 'Character';
  /** Character name, when `binding` is `Character`. */
  bound_to?: string;
}

/** One entry of /v2/characters/:id/equipment: every item across all equipment tabs. */
export interface CharacterEquipmentItem extends CharacterEquipmentPiece {
  /** Absent for items that are only in inactive tabs (`Armory`, `LegendaryArmory`). */
  slot?: CharacterEquipmentSlot;
  /** Equipment tab numbers that use this item. Absent for gathering tools, fishing gear and some trinkets. */
  tabs?: number[];
  /** Stack count; present on `Armory` and `LegendaryArmory` items. */
  count?: number;
  charges?: number;
}

/** /v2/characters/:id/equipment */
export interface CharacterEquipment {
  equipment: CharacterEquipmentItem[];
}

/** One item in an equipment tab. */
export interface CharacterEquipmentTabItem extends CharacterEquipmentPiece {
  slot: CharacterEquipmentSlot;
}

/** PvP equipment of an equipment tab; `null` where nothing is selected. */
export interface CharacterEquipmentPvp {
  /** /v2/pvp/amulets id. */
  amulet: number | null;
  /** /v2/items id of the rune. */
  rune: number | null;
  /** /v2/items ids, ordered primary 1, secondary 1, primary 2, secondary 2. */
  sigils: (number | null)[];
}

/** /v2/characters/:id/equipmenttabs/active, and one element of `equipment_tabs`. */
export interface CharacterEquipmentTab {
  /** Tab number, from 1. */
  tab: number;
  name: string;
  is_active: boolean;
  equipment: CharacterEquipmentTabItem[];
  equipment_pvp: CharacterEquipmentPvp;
}

// Builds -----------------------------------------------------------------

export type CharacterSpecializationLine = BuildSpecialization;
export type CharacterSkillBar = BuildSkillBar;
export type CharacterBuildPets = BuildPets;
export type CharacterBuild = Build;

/** /v2/characters/:id/buildtabs/active, and one element of `build_tabs`. */
export interface CharacterBuildTab {
  /** Tab number, from 1. */
  tab: number;
  is_active: boolean;
  build: CharacterBuild;
}

// Full character ---------------------------------------------------------

/**
 * One character from /v2/characters?ids=. Combines the sub-routes. Fields
 * behind another permission are left out when the key lacks it (checked with
 * subtokens): `bags` and `recipes` need `inventories`; `build_tabs`,
 * `active_build_tab`, `build_tabs_unlocked` and `training` need `builds`;
 * `equipment` and the equipment tab fields need `builds` or `inventories`;
 * `wvw_abilities` needs `progression`.
 */
export interface Character
  extends CharacterCore,
    CharacterBackstory,
    CharacterCrafting,
    Partial<CharacterEquipment>,
    Partial<CharacterInventory>,
    Partial<CharacterRecipes>,
    Partial<CharacterTraining> {
  flags: CharacterFlag[];
  wvw_abilities?: CharacterWvwAbility[];
  build_tabs_unlocked?: number;
  /** `tab` of the active build tab. */
  active_build_tab?: number;
  build_tabs?: CharacterBuildTab[];
  equipment_tabs_unlocked?: number;
  /** `tab` of the active equipment tab. */
  active_equipment_tab?: number;
  equipment_tabs?: CharacterEquipmentTab[];
}

// ---------------------------------------------------------------------------
// Guilds

export interface GuildEmblemLayer {
  /** /v2/emblem/backgrounds or /v2/emblem/foregrounds id. */
  id: number;
  /** /v2/colors ids, one per layer colour. */
  colors: number[];
}

export type GuildEmblemFlag =
  | 'FlipBackgroundHorizontal'
  | 'FlipBackgroundVertical'
  | 'FlipForegroundHorizontal'
  | 'FlipForegroundVertical';

export interface GuildEmblem {
  background: GuildEmblemLayer;
  foreground: GuildEmblemLayer;
  flags: GuildEmblemFlag[];
}

/**
 * /v2/guild/:id. Without a key, or with a key that isn't a member's, only
 * `id`, `name`, `tag` and `emblem` are present; a member's or leader's key
 * with the `guilds` permission adds the rest.
 */
export interface Guild {
  id: string;
  name: string;
  tag: string;
  /** Absent when the guild has no emblem. */
  emblem?: GuildEmblem;
  level?: number;
  /** Message of the day. */
  motd?: string;
  influence?: number;
  aetherium?: number;
  favor?: number;
  resonance?: number;
  member_count?: number;
  member_capacity?: number;
}

interface GuildLogBase {
  /** Unique within the guild only; pass to `?since=` to page. */
  id: number;
  /** ISO-8601 time of the event. */
  time: string;
  /** Account name of the member the entry is about; absent on some entries (e.g. queued upgrades). */
  user?: string;
}

export interface GuildLogJoined extends GuildLogBase {
  type: 'joined';
}
export interface GuildLogInvited extends GuildLogBase {
  type: 'invited';
  /** Account name. */
  invited_by: string;
}
export interface GuildLogInviteDeclined extends GuildLogBase {
  type: 'invite_declined';
  /** Account name; absent when `user` declined. */
  declined_by?: string;
}
export interface GuildLogKick extends GuildLogBase {
  type: 'kick';
  /** Account name; equals `user` when the member left. */
  kicked_by: string;
}
export interface GuildLogRankChange extends GuildLogBase {
  type: 'rank_change';
  /** Account name. */
  changed_by: string;
  /** /v2/guild/:id/ranks id. */
  old_rank: string;
  /** /v2/guild/:id/ranks id. */
  new_rank: string;
}
export interface GuildLogTreasury extends GuildLogBase {
  type: 'treasury';
  /** /v2/items id. */
  item_id: number;
  count: number;
}
export interface GuildLogStash extends GuildLogBase {
  type: 'stash';
  operation: 'deposit' | 'withdraw' | 'move';
  /** /v2/items id; 0 for coin operations. */
  item_id: number;
  count: number;
  /** Copper. */
  coins: number;
}
export interface GuildLogMotd extends GuildLogBase {
  type: 'motd';
  motd: string;
}
export interface GuildLogUpgrade extends GuildLogBase {
  type: 'upgrade';
  action: 'queued' | 'cancelled' | 'completed' | 'sped_up';
  /** /v2/guild/upgrades id. */
  upgrade_id: number;
  /** /v2/recipes id, when a scribe crafted the upgrade. */
  recipe_id?: number;
  /** /v2/items id, when an item was consumed. */
  item_id?: number;
  /** Upgrades added; present when `action` is `completed`. */
  count?: number;
}
export interface GuildLogInfluence extends GuildLogBase {
  type: 'influence';
  activity: 'daily_login' | 'gifted';
  participants: number;
  /** Account names of the participants. */
  total_participants: string[];
}
export interface GuildLogMission extends GuildLogBase {
  type: 'mission';
  state: 'start' | 'success' | 'fail';
  /** Influence awarded. */
  influence: number;
}

/** One entry of /v2/guild/:id/log, discriminated by `type`. */
export type GuildLogEntry =
  | GuildLogJoined
  | GuildLogInvited
  | GuildLogInviteDeclined
  | GuildLogKick
  | GuildLogRankChange
  | GuildLogTreasury
  | GuildLogStash
  | GuildLogMotd
  | GuildLogUpgrade
  | GuildLogInfluence
  | GuildLogMission;

export interface GuildLogQuery {
  /** Return only entries with a greater `id`. */
  since?: number;
}

/** One entry of /v2/guild/:id/members. */
export interface GuildMember {
  /** Account name. */
  name: string;
  /** /v2/guild/:id/ranks id. */
  rank: string;
  /** ISO-8601 join time; `null` for members who joined before March 2013. */
  joined: string | null;
  /** Whether the member has chosen this guild for WvW. */
  wvw_member: boolean;
}

/** One entry of /v2/guild/:id/ranks. */
export interface GuildRank {
  /** Rank name, which is also its id. */
  id: string;
  /** Sort order, lowest first. */
  order: number;
  /** /v2/guild/permissions ids. */
  permissions: string[];
  /** Icon URL. */
  icon: string;
}

export interface GuildStashSlot {
  /** /v2/items id. */
  id: number;
  count: number;
}

/** One vault section of /v2/guild/:id/stash. */
export interface GuildStashSection {
  /** /v2/guild/upgrades id of the upgrade that added this section. */
  upgrade_id: number;
  size: number;
  /** Copper. */
  coins: number;
  /** Section description, when one is set. */
  note?: string;
  /** Exactly `size` slots; `null` is an empty slot. */
  inventory: (GuildStashSlot | null)[];
}

/** One entry of /v2/guild/:id/storage. */
export interface GuildStorageItem {
  /** /v2/guild/upgrades id of the consumable (banners, siege, ...). */
  id: number;
  count: number;
}

export interface GuildTreasuryNeed {
  /** /v2/guild/upgrades id. */
  upgrade_id: number;
  /** Total the upgrade needs. */
  count: number;
}

/** One entry of /v2/guild/:id/treasury. */
export interface GuildTreasuryItem {
  /** /v2/items id. */
  item_id: number;
  count: number;
  /** In-progress upgrades that need this item. */
  needed_by: GuildTreasuryNeed[];
}

export interface GuildTeamMember {
  /** Account name, as in /v2/guild/:id/members. */
  name: string;
  role: 'Captain' | 'Member';
}

export interface GuildTeamSeason {
  /** /v2/pvp/seasons id. */
  id: string;
  wins: number;
  losses: number;
  rating: number;
}

/** One entry of /v2/guild/:id/teams: a PvP guild team. */
export interface GuildTeam {
  /** Unique within the guild only. */
  id: number;
  members: GuildTeamMember[];
  name: string;
  /** Known value: `Active`. */
  state: string;
  aggregate: PvpWinLoss;
  ladders: PvpLadderStats;
  /** Recent games, as in /v2/pvp/games without `profession`. */
  games: Omit<PvpGame, 'profession'>[];
  seasons?: GuildTeamSeason[];
}

/** One element of /v2/guild/permissions. */
export interface GuildPermission {
  /** e.g. `Admin`, `EditBGM`. */
  id: string;
  name: string;
  description: string;
}

export type GuildUpgradeType =
  | 'AccumulatingCurrency'
  | 'BankBag'
  | 'Boost'
  | 'Claimable'
  | 'Consumable'
  | 'Decoration'
  | 'GuildHall'
  | 'GuildHallExpedition'
  | 'Hub'
  | 'Queue'
  | 'Unlock';

export interface GuildUpgradeCost {
  type: 'Item' | 'Collectible' | 'Currency' | 'Coins';
  /** Absent for `Coins`. */
  name?: string;
  count: number;
  /** /v2/items id, for `Item` and `Collectible` costs. */
  item_id?: number;
}

/** One element of /v2/guild/upgrades. */
export interface GuildUpgrade {
  id: number;
  name: string;
  description: string;
  type: GuildUpgradeType;
  icon: string;
  /** Build time in minutes. */
  build_time: number;
  /** Guild level needed. */
  required_level: number;
  /** Guild experience awarded. */
  experience: number;
  /** /v2/guild/upgrades ids that must be built first. */
  prerequisites: number[];
  costs: GuildUpgradeCost[];
  /** `BankBag` only: slots in the vault section. */
  bag_max_items?: number;
  /** `BankBag` only: copper the vault section can hold. */
  bag_max_coins?: number;
}

/** /v2/guild/search query. */
export interface GuildSearchQuery {
  /** Exact guild name. */
  name: string;
}

// ---------------------------------------------------------------------------
// Backstory

/** One element of /v2/backstory/answers. */
export interface BackstoryAnswer {
  /** `<question>-<answer>`, e.g. `"7-54"`. */
  id: string;
  title: string;
  description: string;
  /** Text added to the character's biography. */
  journal: string;
  /** /v2/backstory/questions id. */
  question: number;
  /** Only these professions can pick the answer; absent means any. */
  professions?: Profession[];
  /** Only these races can pick the answer; absent means any. */
  races?: Race[];
}

/** One element of /v2/backstory/questions. */
export interface BackstoryQuestion {
  id: number;
  title: string;
  description: string;
  /** /v2/backstory/answers ids. */
  answers: string[];
  /** Position in character creation. */
  order: number;
  /** Only asked of these professions; absent means any. */
  professions?: Profession[];
  /** Only asked of these races; absent means any. */
  races?: Race[];
}

// ---------------------------------------------------------------------------
// Miscellany

/** One element of /v2/emblem/backgrounds or /v2/emblem/foregrounds. */
export interface EmblemPart {
  id: number;
  /** Image URLs of the layers, drawn in order. */
  layers: string[];
}

/** One element of /v2/files: a commonly used game icon. */
export interface ApiFile {
  /** e.g. `map_complete`, `icon_ranger`. */
  id: string;
  /** Image URL. */
  icon: string;
}

/** One element of /v2/quaggans. */
export interface Quaggan {
  id: string;
  /** Image URL. */
  url: string;
}

/** One element of /v2/logos. */
export interface Logo {
  id: string;
  /** Image or video URL. */
  url: string;
}

/** /v2/build */
export interface GameBuild {
  /** Current game build number. */
  id: number;
}
