// Response types for game content and mechanics: achievements, masteries,
// professions/specializations/traits/skills, story, instances, maps and
// continents, home instance and homestead. Shapes match schema version
// 2025-08-29T01:00:00.000Z.

import type { Attribute, Profession, Race } from './common.js';

// ---------------------------------------------------------------------------
// Achievements

export type AchievementFlag =
  | 'CategoryDisplay'
  | 'Daily'
  | 'Hidden'
  | 'IgnoreNearlyComplete'
  | 'Monthly'
  | 'MoveToTop'
  | 'Permanent'
  | 'Pvp'
  | 'RepairOnLogin'
  | 'Repeatable'
  | 'RequiresUnlock'
  | 'Weekly';

/** /v2/achievements item. */
export interface Achievement {
  id: number;
  name: string;
  description: string;
  /** What the player has to do. */
  requirement: string;
  /** Shown while the achievement is locked. */
  locked_text: string;
  /** `ItemSet`: a collection achievement. */
  type: 'Default' | 'ItemSet';
  flags: AchievementFlag[];
  /** Progress thresholds; `count` is cumulative, `points` is awarded per tier. */
  tiers: AchievementTier[];
  icon?: string;
  /** /v2/achievements ids that must be completed first. */
  prerequisites?: number[];
  rewards?: AchievementReward[];
  /** Individual objectives of collection-style achievements. */
  bits?: AchievementBit[];
  /** Maximum achievement points a repeatable achievement can award; -1 for no cap. */
  point_cap?: number;
}

export interface AchievementTier {
  count: number;
  points: number;
}

export type AchievementReward =
  | { type: 'Coins'; /** Copper. */ count: number }
  | { type: 'Item'; /** /v2/items id. */ id: number; count: number }
  | { type: 'Mastery'; /** /v2/masteries id. */ id: number; region: MasteryRegion }
  | { type: 'Title'; /** /v2/titles id. */ id: number };

export type AchievementBit =
  | { type: 'Text'; text: string }
  | { type: 'Item'; /** /v2/items id. */ id: number; text?: string }
  | { type: 'Minipet'; /** /v2/minis id. */ id: number; text?: string }
  | { type: 'Skin'; /** /v2/skins id. */ id: number; text?: string };

/** /v2/achievements/categories item. */
export interface AchievementCategory {
  id: number;
  name: string;
  description: string;
  /** Sort order within its group. */
  order: number;
  icon: string;
  achievements: AchievementCategoryEntry[];
  /** Achievements that will be in this category tomorrow (daily categories). */
  tomorrow?: AchievementCategoryEntry[];
}

export interface AchievementCategoryEntry {
  /** /v2/achievements id. */
  id: number;
  /** Known values: PvE, PvP, WvW, SpecialEvent. */
  flags?: string[];
  /** Account access the entry is limited to. */
  required_access?: {
    /** Known values: GuildWars2, HeartOfThorns, PathOfFire, EndOfDragons. */
    product: string;
    condition: 'HasAccess' | 'NoAccess';
  };
  /** Character level range `[min, max]` the entry is shown for. */
  level?: [number, number];
}

/** /v2/achievements/groups item. */
export interface AchievementGroup {
  /** GUID. */
  id: string;
  name: string;
  description: string;
  order: number;
  /** /v2/achievements/categories ids. */
  categories: number[];
}

// ---------------------------------------------------------------------------
// Masteries

/** Mastery track region. */
export type MasteryRegion = 'Tyria' | 'Maguuma' | 'Desert' | 'Tundra' | 'Jade' | 'Sky' | 'Wild' | 'Magic';

/** /v2/masteries item. */
export interface Mastery {
  id: number;
  name: string;
  requirement: string;
  order: number;
  /** Background image URL. */
  background: string;
  region: MasteryRegion;
  levels: MasteryLevel[];
}

export interface MasteryLevel {
  name: string;
  description: string;
  instruction: string;
  icon: string;
  /** Mastery points needed to unlock the level. */
  point_cost: number;
  /** Experience needed to train the level. */
  exp_cost: number;
}

// ---------------------------------------------------------------------------
// Skill and trait facts

/** Elementalist attunement. */
export type SkillAttunement = 'Fire' | 'Water' | 'Air' | 'Earth';

/** Weapon names used as keys of a profession's `weapons` and in skill data. */
export type ProfessionWeaponType =
  | 'Axe'
  | 'Dagger'
  | 'Focus'
  | 'Greatsword'
  | 'Hammer'
  | 'Longbow'
  | 'Mace'
  | 'Pistol'
  | 'Rifle'
  | 'Scepter'
  | 'Shield'
  | 'Shortbow'
  | 'Spear'
  | 'Speargun'
  | 'Staff'
  | 'Sword'
  | 'Torch'
  | 'Trident'
  | 'Warhorn';

export type ComboFieldType =
  | 'Air'
  | 'Dark'
  | 'Ethereal'
  | 'Fire'
  | 'Ice'
  | 'Light'
  | 'Lightning'
  | 'Poison'
  | 'Smoke'
  | 'Water';

export type ComboFinisherType = 'Blast' | 'Leap' | 'Projectile' | 'Whirl';

interface FactBase {
  /** Label shown in the tooltip. */
  text?: string;
  icon?: string;
}

export interface FactAttributeAdjust extends FactBase {
  type: 'AttributeAdjust';
  /** Amount the attribute changes by. */
  value?: number;
  target?: Attribute | 'None';
  hit_count?: number;
}
export interface FactBuff extends FactBase {
  type: 'Buff';
  /** Name of the boon/condition/effect. */
  status?: string;
  description?: string;
  /** Seconds. */
  duration?: number;
  /** Stacks applied. */
  apply_count?: number;
}
/** No data beyond the icon. */
export interface FactBuffArray extends FactBase {
  type: 'BuffArray';
}
/** Converts a percentage of one attribute into another. */
export interface FactBuffConversion extends FactBase {
  type: 'BuffConversion';
  source: Attribute;
  target: Attribute;
  percent: number;
}
export interface FactComboField extends FactBase {
  type: 'ComboField';
  field_type: ComboFieldType;
}
export interface FactComboFinisher extends FactBase {
  type: 'ComboFinisher';
  finisher_type: ComboFinisherType;
  /** Chance to trigger, in percent. */
  percent: number;
  /** Seen on one skill; meaning undocumented. */
  chance?: number;
}
export interface FactDamage extends FactBase {
  type: 'Damage';
  hit_count: number;
  /** Multiplied by weapon strength and power to get damage. */
  dmg_multiplier: number;
}
export interface FactDistance extends FactBase {
  type: 'Distance';
  distance: number;
}
export interface FactDuration extends FactBase {
  type: 'Duration';
  /** Seconds. */
  duration: number;
}
export interface FactHeal extends FactBase {
  type: 'Heal';
  hit_count: number;
}
export interface FactHealingAdjust extends FactBase {
  type: 'HealingAdjust';
  hit_count: number;
}
/** A label with no value (e.g. "Breaks Stun", "Unblockable"). */
export interface FactNoData extends FactBase {
  type: 'NoData';
}
export interface FactNumber extends FactBase {
  type: 'Number';
  value: number;
}
export interface FactPercent extends FactBase {
  type: 'Percent';
  percent?: number;
  /** Used instead of `percent` on a few facts. */
  value?: number;
}
/** A buff applied together with another (the `prefix`). */
export interface FactPrefixedBuff extends FactBase {
  type: 'PrefixedBuff';
  status?: string;
  description?: string;
  /** Seconds. */
  duration?: number;
  apply_count?: number;
  prefix: {
    text?: string;
    icon?: string;
    status?: string;
    description?: string;
  };
}
export interface FactRadius extends FactBase {
  type: 'Radius';
  distance: number;
}
export interface FactRange extends FactBase {
  type: 'Range';
  value: number;
}
export interface FactRecharge extends FactBase {
  type: 'Recharge';
  /** Seconds. */
  value: number;
}
export interface FactStunBreak extends FactBase {
  type: 'StunBreak';
  value: true;
}
export interface FactTime extends FactBase {
  type: 'Time';
  /** Seconds. */
  duration: number;
}
export interface FactUnblockable extends FactBase {
  type: 'Unblockable';
  value: true;
}
/** A few facts (e.g. necromancer "Life Force Cost") carry no `type`. */
export interface FactUntyped extends FactBase {
  type?: undefined;
  percent?: number;
  value?: number;
}

/** One tooltip fact of a skill or trait, discriminated by `type`. */
export type Fact =
  | FactAttributeAdjust
  | FactBuff
  | FactBuffArray
  | FactBuffConversion
  | FactComboField
  | FactComboFinisher
  | FactDamage
  | FactDistance
  | FactDuration
  | FactHeal
  | FactHealingAdjust
  | FactNoData
  | FactNumber
  | FactPercent
  | FactPrefixedBuff
  | FactRadius
  | FactRange
  | FactRecharge
  | FactStunBreak
  | FactTime
  | FactUnblockable
  | FactUntyped;

export type FactType = NonNullable<Fact['type']>;

/** A fact that applies only when a trait is selected. */
export type TraitedFact = Fact & {
  /** /v2/traits id that enables this fact. */
  requires_trait: number;
  /** Index into `facts` of the fact this one replaces. */
  overrides?: number;
};

// ---------------------------------------------------------------------------
// Skills

export type SkillType =
  | 'Bundle'
  | 'Elite'
  | 'Heal'
  | 'Monster'
  | 'Pet'
  | 'Profession'
  | 'Toolbelt'
  | 'Transform'
  | 'Utility'
  | 'Weapon';

export type SkillSlot =
  | 'Downed_1'
  | 'Downed_2'
  | 'Downed_3'
  | 'Downed_4'
  | 'Elite'
  | 'Heal'
  | 'Pet'
  | 'Profession_1'
  | 'Profession_2'
  | 'Profession_3'
  | 'Profession_4'
  | 'Profession_5'
  | 'Toolbelt'
  | 'Utility'
  | 'Weapon_1'
  | 'Weapon_2'
  | 'Weapon_3'
  | 'Weapon_4'
  | 'Weapon_5';

/** /v2/skills item. */
export interface Skill {
  id: number;
  name: string;
  description: string;
  icon?: string;
  chat_link: string;
  type?: SkillType;
  /** `None` for weaponless skills; `Nothing` for some bundle/transform skills. */
  weapon_type?: ProfessionWeaponType | 'None' | 'Nothing';
  professions?: Profession[];
  slot?: SkillSlot;
  flags: ('GroundTargeted' | 'NoUnderwater')[];
  facts?: Fact[];
  traited_facts?: TraitedFact[];
  /**
   * Skill categories. Known values: Arcane, Banner, Burst, Cantrip,
   * CelestialAvatar, Clone, Conjure, Consecration, Corruption, Deception,
   * DualWield, Elixir, Gadget, Glamour, Glyph, Kit, LegendaryAssassin,
   * LegendaryDemon, LegendaryDragon, LegendaryDwarf, Manipulation, Mantra,
   * Mark, Meditation, Minion, Overload, Phantasm, Physical, PrimalBurst, Rage,
   * Shout, Signet, Spectral, Spirit, SpiritWeapon, Stance, StealthAttack,
   * Survival, Symbol, Transform, Trap, Trick, Turret, Venom, Virtue, Ward, Well.
   */
  categories?: string[];
  /** Elementalist attunement the skill belongs to. */
  attunement?: SkillAttunement;
  /** Second attunement for Weaver dual-attunement skills. */
  dual_attunement?: SkillAttunement;
  /** Revenant energy cost. */
  cost?: number;
  /** Thief initiative cost. */
  initiative?: number;
  /** Thief: off-hand weapon this dual-wield skill requires. */
  dual_wield?: ProfessionWeaponType | 'None' | 'Nothing';
  /** /v2/specializations id required to use the skill. */
  specialization?: number;
  /** /v2/skills id this skill flips into (e.g. second stage of a skill). */
  flip_skill?: number;
  /** /v2/skills id of the next skill in an auto-attack chain. */
  next_chain?: number;
  /** /v2/skills id of the previous skill in an auto-attack chain. */
  prev_chain?: number;
  /** /v2/skills id of the engineer toolbelt skill paired with this one. */
  toolbelt_skill?: number;
  /** /v2/skills ids granted while holding this bundle. */
  bundle_skills?: number[];
  /** /v2/skills ids available while transformed. */
  transform_skills?: number[];
  /** Skills granted per attunement or form (e.g. Elementalist conjures, Druid Celestial Avatar). */
  subskills?: SkillSubskill[];
}

export interface SkillSubskill {
  /** /v2/skills id. */
  id: number;
  attunement?: SkillAttunement;
  /** Known values: CelestialAvatar. */
  form?: string;
}

// ---------------------------------------------------------------------------
// Traits and specializations

/** /v2/traits item. */
export interface Trait {
  id: number;
  name: string;
  icon: string;
  description: string;
  /** /v2/specializations id. */
  specialization: number;
  /** 1-3 for adept/master/grandmaster; 0 for the weapon trait. */
  tier: number;
  /** Position within the tier (0-2). */
  order: number;
  slot: 'Major' | 'Minor';
  facts?: Fact[];
  traited_facts?: TraitedFact[];
  /** Skills granted or described by the trait. */
  skills?: TraitSkill[];
}

/** A skill embedded in a trait. */
export interface TraitSkill {
  /** /v2/skills id. */
  id: number;
  name: string;
  description: string;
  icon: string;
  chat_link: string;
  flags: string[];
  facts?: Fact[];
  traited_facts?: TraitedFact[];
  /** Same values as {@link Skill.categories}. */
  categories?: string[];
}

/** /v2/specializations item. */
export interface Specialization {
  id: number;
  name: string;
  profession: Profession;
  elite: boolean;
  /** /v2/traits ids. */
  minor_traits: number[];
  /** /v2/traits ids. */
  major_traits: number[];
  /** /v2/traits id of the weapon proficiency trait (elite specs). */
  weapon_trait?: number;
  icon: string;
  /** Background image URL. */
  background: string;
  /** Elite specs only. */
  profession_icon?: string;
  /** Elite specs only. */
  profession_icon_big?: string;
}

// ---------------------------------------------------------------------------
// Professions, legends, pets, races

/** /v2/professions item. */
export interface ProfessionInfo {
  id: Profession;
  name: string;
  /** Profession code used in build template chat links. */
  code: number;
  icon: string;
  icon_big: string;
  /** /v2/specializations ids. */
  specializations: number[];
  weapons: Partial<Record<ProfessionWeaponType, ProfessionWeapon>>;
  flags: ('NoRacialSkills' | 'NoWeaponSwap')[];
  /** Utility, heal, elite and profession-mechanic skills. */
  skills: ProfessionSkill[];
  training: ProfessionTraining[];
  /** `[palette id, /v2/skills id]` pairs, used to decode build template chat links. */
  skills_by_palette: [number, number][];
}

export interface ProfessionWeapon {
  /** /v2/specializations id required to wield it. */
  specialization?: number;
  flags: ('Aquatic' | 'Mainhand' | 'Offhand' | 'TwoHand')[];
  skills: ProfessionWeaponSkill[];
}

export interface ProfessionWeaponSkill {
  /** /v2/skills id. */
  id: number;
  slot: SkillSlot;
  /** Thief dual-wield: off-hand weapon required (`Nothing` for none). */
  offhand?: ProfessionWeaponType | 'Nothing';
  attunement?: SkillAttunement;
}

export interface ProfessionSkill {
  /** /v2/skills id. */
  id: number;
  slot: SkillSlot;
  type: 'Elite' | 'Heal' | 'Profession' | 'Utility';
  /** Profession the skill is stolen from or borrowed from. */
  source?: Profession;
  attunement?: SkillAttunement;
}

export interface ProfessionTraining {
  /** /v2/skills id or /v2/specializations id, depending on `category`. */
  id: number;
  category: 'EliteSpecializations' | 'Skills' | 'Specializations';
  name: string;
  track: ProfessionTrainingStep[];
}

export type ProfessionTrainingStep =
  | { type: 'Skill'; /** Hero points. */ cost: number; /** /v2/skills id. */ skill_id: number }
  | { type: 'Trait'; /** Hero points. */ cost: number; /** /v2/traits id. */ trait_id: number };

/** /v2/legends item (Revenant). */
export interface Legend {
  /** e.g. `Legend1`. */
  id: string;
  /** Legend code used in build template chat links. */
  code: number;
  /** /v2/skills id of the legend swap skill. */
  swap: number;
  /** /v2/skills id. */
  heal: number;
  /** /v2/skills id. */
  elite: number;
  /** /v2/skills ids. */
  utilities: number[];
}

/** /v2/pets item (Ranger). */
export interface Pet {
  id: number;
  name: string;
  description: string;
  icon: string;
  /** /v2/skills ids. */
  skills: { id: number }[];
}

/** /v2/races item. */
export interface RaceInfo {
  id: Race;
  name: string;
  /** /v2/skills ids of racial skills. */
  skills: number[];
}

// ---------------------------------------------------------------------------
// Story, quests, instances

/** /v2/stories item. */
export interface Story {
  id: number;
  /** /v2/stories/seasons id. */
  season: string;
  name: string;
  description: string;
  /** In-game year, e.g. `1325 AE`; may be empty. */
  timeline: string;
  /** Minimum level. */
  level: number;
  order: number;
  chapters: { name: string }[];
  /** Races the story is limited to (personal story). */
  races?: Race[];
  flags?: 'RequiresUnlock'[];
}

/** /v2/stories/seasons item. */
export interface StorySeason {
  /** GUID. */
  id: string;
  name: string;
  order: number;
  /** /v2/stories ids. */
  stories: number[];
}

/** /v2/quests item. */
export interface Quest {
  id: number;
  name: string;
  level: number;
  /** /v2/stories id. */
  story: number;
  goals: { active: string; complete: string }[];
}

/** /v2/raids item. */
export interface Raid {
  /** e.g. `forsaken_thicket`. */
  id: string;
  wings: RaidWing[];
}

export interface RaidWing {
  id: string;
  /** Encounters; ids match /v2/account/raids. */
  events: { id: string; type: 'Boss' | 'Checkpoint' }[];
}

/** /v2/dungeons item. */
export interface Dungeon {
  /** e.g. `ascalonian_catacombs`. */
  id: string;
  /** Path ids match /v2/account/dungeons. */
  paths: { id: string; type: 'Story' | 'Explorable' }[];
}

/** /v2/worldbosses item. Ids match /v2/account/worldbosses. */
export interface WorldBoss {
  id: string;
}

/** /v2/mapchests item (Hero's Choice chests). Ids match /v2/account/mapchests. */
export interface MapChest {
  id: string;
}

/** /v2/dailycrafting item. Ids match /v2/account/dailycrafting. */
export interface DailyCrafting {
  id: string;
}

// ---------------------------------------------------------------------------
// Maps and continents

/** `[x, y]` in map or continent coordinates. */
export type MapCoord = [number, number];

/** `[[x1, y1], [x2, y2]]`: two opposite corners of a rectangle. */
export type MapRect = [MapCoord, MapCoord];

export type MapType =
  | 'BlueHome'
  | 'Center'
  | 'EdgeOfTheMists'
  | 'GreenHome'
  | 'Instance'
  | 'JumpPuzzle'
  | 'Public'
  | 'Pvp'
  | 'RedHome'
  | 'Tutorial'
  | 'Unknown';

/** /v2/maps item. */
export interface GameMap {
  id: number;
  name: string;
  min_level: number;
  max_level: number;
  default_floor: number;
  type: MapType;
  floors: number[];
  /** /v2/continents/:id/floors/:floor/regions id. */
  region_id?: number;
  region_name?: string;
  /** /v2/continents id. */
  continent_id?: number;
  continent_name?: string;
  /** Map bounds in map coordinates. */
  map_rect: MapRect;
  /** Map bounds in continent coordinates. */
  continent_rect: MapRect;
}

/** /v2/continents item. */
export interface Continent {
  /** 1 = Tyria, 2 = Mists. */
  id: number;
  name: string;
  /** `[width, height]`. */
  continent_dims: [number, number];
  min_zoom: number;
  max_zoom: number;
  /** /v2/continents/:id/floors ids. */
  floors: number[];
}

/** /v2/continents/:id/floors item. */
export interface ContinentFloor {
  id: number;
  /** `[width, height]` of the floor texture. */
  texture_dims: [number, number];
  /** Rectangle the map view is limited to. */
  clamped_view?: MapRect;
  /** Keyed by region id. */
  regions: Record<string, ContinentRegion>;
}

/** /v2/continents/:id/floors/:floor/regions item. */
export interface ContinentRegion {
  id: number;
  name: string;
  label_coord: MapCoord;
  continent_rect: MapRect;
  /** Keyed by /v2/maps id. */
  maps: Record<string, ContinentMap>;
}

/** /v2/continents/:id/floors/:floor/regions/:region/maps item. */
export interface ContinentMap {
  /** /v2/maps id. */
  id: number;
  name: string;
  min_level: number;
  max_level: number;
  default_floor: number;
  label_coord?: MapCoord;
  map_rect: MapRect;
  continent_rect: MapRect;
  /** Keyed by POI id. */
  points_of_interest: Record<string, ContinentPoi>;
  /** Orr temple shrines. */
  god_shrines?: ContinentGodShrine[];
  /** Renown hearts, keyed by task id. */
  tasks: Record<string, ContinentTask>;
  /** Hero challenges. */
  skill_challenges: ContinentSkillChallenge[];
  /** Areas, keyed by sector id. */
  sectors: Record<string, ContinentSector>;
  adventures: ContinentAdventure[];
  mastery_points: ContinentMasteryPoint[];
}

/** .../maps/:map/pois item. */
export interface ContinentPoi {
  id: number;
  name?: string;
  /** `unlock`: dungeon or other entrance. */
  type: 'landmark' | 'unlock' | 'vista' | 'waypoint';
  floor: number;
  coord: MapCoord;
  chat_link: string;
  icon?: string;
}

export interface ContinentGodShrine {
  id: number;
  name: string;
  name_contested: string;
  icon: string;
  icon_contested: string;
  /** Id of the POI at the shrine. */
  poi_id: number;
  coord: MapCoord;
}

/** .../maps/:map/tasks item (renown heart). */
export interface ContinentTask {
  id: number;
  objective: string;
  level: number;
  coord: MapCoord;
  /** Polygon outlining the area. */
  bounds: MapCoord[];
  chat_link: string;
}

export interface ContinentSkillChallenge {
  /** `<expansion>-<id>`, e.g. `0-29`. */
  id?: string;
  coord: MapCoord;
}

/** .../maps/:map/sectors item. */
export interface ContinentSector {
  id: number;
  name?: string;
  level: number;
  coord: MapCoord;
  /** Polygon outlining the area. */
  bounds: MapCoord[];
  chat_link: string;
}

export interface ContinentAdventure {
  /** GUID. */
  id: string;
  name: string;
  description: string;
  coord: MapCoord;
}

export interface ContinentMasteryPoint {
  id: number;
  region: MasteryRegion;
  coord: MapCoord;
}

// ---------------------------------------------------------------------------
// Home instance and homestead

/** /v2/home/cats item. */
export interface HomeCat {
  id: number;
  /** How the cat is obtained. */
  hint?: string;
}

/** /v2/home/nodes item. Ids match /v2/account/home/nodes. */
export interface HomeNode {
  id: string;
}

/** /v2/homestead/decorations item. */
export interface HomesteadDecoration {
  id: number;
  name: string;
  description: string;
  icon: string;
  /** /v2/homestead/decorations/categories ids. */
  categories: number[];
  /** Maximum number that can be stored. */
  max_count: number;
}

/** /v2/homestead/decorations/categories item. */
export interface HomesteadDecorationCategory {
  id: number;
  name: string;
}

/** /v2/homestead/glyphs item. */
export interface HomesteadGlyph {
  id: string;
  /** /v2/items id of the glyph. */
  item_id: number;
  /** Gathering node type it applies to. */
  slot: 'harvesting' | 'logging' | 'mining';
}
