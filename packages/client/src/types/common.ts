// Shapes shared by several API areas. Area-specific types live in the
// sibling files; put a type here only when two or more areas use it.

export type Rarity =
  | 'Junk'
  | 'Basic'
  | 'Fine'
  | 'Masterwork'
  | 'Rare'
  | 'Exotic'
  | 'Ascended'
  | 'Legendary';

/** Stat set chosen on a selectable-stat item. */
export interface SelectedStats {
  /** /v2/itemstats id. */
  id: number;
  attributes: Partial<Record<Attribute, number>>;
}

export type Attribute =
  | 'AgonyResistance'
  | 'BoonDuration'
  | 'ConditionDamage'
  | 'ConditionDuration'
  | 'CritDamage'
  | 'Healing'
  | 'Power'
  | 'Precision'
  | 'Toughness'
  | 'Vitality';

/**
 * One occupied slot in the bank, shared inventory, a character bag, or a
 * guild stash. Empty slots are `null` in the containing array.
 */
export interface InventorySlot {
  /** /v2/items id. */
  id: number;
  count: number;
  charges?: number;
  /** /v2/skins id when transmuted. */
  skin?: number;
  /** /v2/items ids of runes/sigils. */
  upgrades?: number[];
  /** Positions of `upgrades` in their slots, when not contiguous. */
  upgrade_slot_indices?: number[];
  /** /v2/items ids of infusions. */
  infusions?: number[];
  /** /v2/colors ids, per dye channel. */
  dyes?: (number | null)[];
  binding?: 'Account' | 'Character';
  /** Character name, when `binding` is `Character`. */
  bound_to?: string;
  stats?: SelectedStats;
}

/** `{ id, count }` pairs: delivery box items, legendary armory, etc. */
export interface IdCount {
  id: number;
  count: number;
}

/** `{ id, value }` pairs: wallet, progression. */
export interface IdValue<Id = number> {
  id: Id;
  value: number;
}

export type Profession =
  | 'Guardian'
  | 'Warrior'
  | 'Engineer'
  | 'Ranger'
  | 'Thief'
  | 'Elementalist'
  | 'Mesmer'
  | 'Necromancer'
  | 'Revenant';

export type Race = 'Asura' | 'Charr' | 'Human' | 'Norn' | 'Sylvari';

export type CraftingDiscipline =
  | 'Armorsmith'
  | 'Artificer'
  | 'Chef'
  | 'Homesteader'
  | 'Huntsman'
  | 'Jeweler'
  | 'Leatherworker'
  | 'Scribe'
  | 'Tailor'
  | 'Weaponsmith';

// Builds: the same shape in /v2/characters/:id/buildtabs and /v2/account/buildstorage.

export interface BuildSpecialization {
  /** /v2/specializations id, or `null` when the line is empty. */
  id: number | null;
  /** Three /v2/traits ids (adept, master, grandmaster); `null` where none is chosen. */
  traits: (number | null)[];
}

/** Skill bar slots 6-10. All values are /v2/skills ids or `null` when empty. */
export interface BuildSkillBar {
  heal: number | null;
  /** Three utility skills. */
  utilities: (number | null)[];
  /** Absent on some Engineer builds. */
  elite?: number | null;
}

export interface BuildPets {
  /** /v2/pets ids of the two land pets; `null` where none is chosen. */
  terrestrial: (number | null)[];
  /** /v2/pets ids of the two water pets; `null` where none is chosen. */
  aquatic: (number | null)[];
}

/** A build: specializations, skills, and profession-specific extras. */
export interface Build {
  /** Player-given name; empty string when unnamed. */
  name: string;
  profession: Profession;
  /** Three specialization lines. */
  specializations: BuildSpecialization[];
  skills: BuildSkillBar;
  aquatic_skills: BuildSkillBar;
  /** Revenant only: two /v2/legends ids (`Legend1`...), `null` where none is chosen. */
  legends?: (string | null)[];
  /** Revenant only: underwater legends, as `legends`. */
  aquatic_legends?: (string | null)[];
  /** Ranger only. */
  pets?: BuildPets;
}
