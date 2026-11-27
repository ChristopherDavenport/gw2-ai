// Response types for items, recipes, trading post, currencies and
// collectables (minis, novelties, outfits, gliders, mounts, ...).
// Checked against schema 2025-08-29T01:00:00.000Z.
import type { Attribute, CraftingDiscipline, IdCount, Profession, Race, Rarity } from './common.js';

// ---------------------------------------------------------------------------
// /v2/items

/** Item flags. */
export type ItemFlag =
  | 'AccountBindOnUse'
  | 'AccountBound'
  | 'Attuned'
  | 'BulkConsume'
  | 'DeleteWarning'
  | 'HideSuffix'
  | 'Infused'
  | 'MonsterOnly'
  | 'NoMysticForge'
  | 'NoSalvage'
  | 'NoSell'
  | 'NotUpgradeable'
  | 'NoUnderwater'
  | 'SoulbindOnAcquire'
  | 'SoulBindOnUse'
  | 'Tonic'
  | 'Unique';

/** Game modes an item can be used in. */
export type ItemGameType = 'Activity' | 'Dungeon' | 'Pve' | 'Pvp' | 'PvpLobby' | 'Wvw';

/** Who may use an item: a race, a profession, or `Female`. */
export type ItemRestriction = Race | Profession | 'Female';

/** How an item turns into another (`upgrades_into` / `upgrades_from`). */
export interface ItemUpgradeLink {
  upgrade: 'Attunement' | 'Infusion';
  /** /v2/items id of the other item. */
  item_id: number;
}

/** Fields every item has, whatever its `type`. */
export interface ItemBase {
  id: number;
  chat_link: string;
  name: string;
  icon?: string;
  description?: string;
  rarity: Rarity;
  /** Required character level. */
  level: number;
  /** Copper paid by vendors; can be non-zero even with `NoSell`. */
  vendor_value: number;
  flags: ItemFlag[];
  game_types: ItemGameType[];
  restrictions: ItemRestriction[];
  /** Items this one can be infused or attuned into. */
  upgrades_into?: ItemUpgradeLink[];
  /** Items this one can be infused or attuned from. */
  upgrades_from?: ItemUpgradeLink[];
}

/** Stat bonuses fixed on an item or upgrade component. */
export interface ItemInfixUpgrade {
  /** /v2/itemstats id. */
  id: number;
  attributes: { attribute: Attribute; modifier: number }[];
  /** Extra effect: boon/condition duration, or the bonus lines of ascended gear. */
  buff?: {
    /** /v2/skills id of the effect. */
    skill_id: number;
    description?: string;
  };
}

export interface ItemInfusionSlot {
  /** At most one value. */
  flags: ('Enrichment' | 'Infusion')[];
  /** /v2/items id of an infusion that comes pre-slotted. */
  item_id?: number;
}

/** Details shared by armor, weapons, trinkets and back items. */
export interface ItemEquipmentDetails {
  /** Empty when the item has no infusion slots. */
  infusion_slots: ItemInfusionSlot[];
  /** Combined with /v2/itemstats multipliers and values to compute stats. */
  attribute_adjustment: number;
  /** Absent on selectable-stat items (see `stat_choices`) and items with no stats. */
  infix_upgrade?: ItemInfixUpgrade;
  /** /v2/items id of the built-in rune, sigil or jewel. */
  suffix_item_id?: number;
  /** /v2/items id of the second built-in sigil (two-handed weapons only). */
  secondary_suffix_item_id?: number;
  /** /v2/itemstats ids the player can choose from. */
  stat_choices?: number[];
}

export type ItemArmorSlot = 'Boots' | 'Coat' | 'Gloves' | 'Helm' | 'HelmAquatic' | 'Leggings' | 'Shoulders';

export type ItemArmorWeight = 'Clothing' | 'Heavy' | 'Light' | 'Medium';

export interface ItemArmorDetails extends ItemEquipmentDetails {
  type: ItemArmorSlot;
  weight_class: ItemArmorWeight;
  defense: number;
}

export type ItemBackDetails = ItemEquipmentDetails;

export interface ItemBagDetails {
  /** Number of slots. */
  size: number;
  /** Invisible/safe bag: contents are hidden from vendors and sorting. */
  no_sell_or_sort: boolean;
}

export type ItemConsumableType =
  | 'AppearanceChange'
  | 'Booze'
  | 'ContractNpc'
  | 'Currency'
  | 'Food'
  | 'Generic'
  | 'Halloween'
  | 'Immediate'
  | 'MountRandomUnlock'
  | 'RandomUnlock'
  | 'TeleportToFriend'
  | 'Transmutation'
  | 'Unlock'
  | 'UpgradeRemoval'
  | 'Utility';

/** What an `Unlock` consumable unlocks. */
export type ItemUnlockType =
  | 'BagSlot'
  | 'BankTab'
  | 'BuildLibrarySlot'
  | 'BuildLoadoutTab'
  | 'Champion'
  | 'CollectibleCapacity'
  | 'Content'
  | 'CraftingRecipe'
  | 'Dye'
  | 'GearLoadoutTab'
  | 'GliderSkin'
  | 'JadeBotSkin'
  | 'MagicDoorSkin'
  | 'Minipet'
  /** Mount skin. */
  | 'Ms'
  | 'Outfit'
  | 'SharedSlot'
  | 'WardrobeTemplateTab';

export interface ItemConsumableDetails {
  type: ItemConsumableType;
  /** Effect description, for consumables that apply an effect. */
  description?: string;
  /** Effect duration. */
  duration_ms?: number;
  /** Stacks of the effect applied. */
  apply_count?: number;
  /** Effect name. */
  name?: string;
  /** Effect icon URL. */
  icon?: string;
  /** `Unlock` consumables only. */
  unlock_type?: ItemUnlockType;
  /** /v2/colors id, for dye unlocks. */
  color_id?: number;
  /** /v2/recipes id, for recipe unlocks. */
  recipe_id?: number;
  /** Further /v2/recipes ids unlocked by the same sheet. */
  extra_recipe_ids?: number[];
  /** /v2/guild/upgrades id the item deposits. */
  guild_upgrade_id?: number;
  /** /v2/skins ids unlocked, for `Transmutation` consumables. */
  skins?: number[];
}

export interface ItemContainerDetails {
  /** `GiftBox`: presents and dye kits; `Immediate`: opens without UI; `OpenUI`: own UI (Black Lion Chest). */
  type: 'Default' | 'GiftBox' | 'Immediate' | 'OpenUI';
}

export interface ItemGatheringDetails {
  /** Foraging/Logging/Mining: harvesting tools; Bait, Lure, Fishing: fishing gear. */
  type: 'Bait' | 'Fishing' | 'Foraging' | 'Logging' | 'Lure' | 'Mining';
}

export interface ItemGizmoDetails {
  type: 'ContainerKey' | 'Default' | 'RentableContractNpc' | 'UnlimitedConsumable';
  /** /v2/guild/upgrades id deposited into guild storage on use. */
  guild_upgrade_id?: number;
  vendor_ids?: number[];
}

export interface ItemMiniPetDetails {
  /** /v2/minis id. */
  minipet_id: number;
}

export interface ItemToolDetails {
  type: 'Salvage';
  charges: number;
}

export interface ItemTrinketDetails extends ItemEquipmentDetails {
  type: 'Accessory' | 'Amulet' | 'Ring';
}

/** What an upgrade component can be applied to. */
export type ItemUpgradeFlag =
  | 'HeavyArmor'
  | 'LightArmor'
  | 'MediumArmor'
  | 'Trinket'
  | Exclude<ItemWeaponType, 'LargeBundle' | 'SmallBundle' | 'Toy' | 'ToyTwoHanded'>;

export interface ItemUpgradeComponentDetails {
  /** `Default`: infusions and jewels; `Gem`: universal upgrades. */
  type: 'Default' | 'Gem' | 'Rune' | 'Sigil';
  flags: ItemUpgradeFlag[];
  /** Slot type for infusions; empty otherwise. */
  infusion_upgrade_flags: ('Enrichment' | 'Infusion')[];
  /** Suffix added to the item name, e.g. `of Force`. */
  suffix: string;
  infix_upgrade: ItemInfixUpgrade;
  attribute_adjustment: number;
  /** Rune set bonuses, one line per tier. */
  bonuses?: string[];
}

/** Weapon types as used by items and recipes. Skins spell some differently, see {@link SkinWeaponType}. */
export type ItemWeaponType =
  | 'Axe'
  | 'Dagger'
  | 'Focus'
  | 'Greatsword'
  | 'Hammer'
  /** Spear (underwater). */
  | 'Harpoon'
  | 'LargeBundle'
  | 'LongBow'
  | 'Mace'
  | 'Pistol'
  | 'Rifle'
  | 'Scepter'
  | 'Shield'
  | 'ShortBow'
  | 'SmallBundle'
  | 'Speargun'
  | 'Staff'
  | 'Sword'
  | 'Torch'
  | 'Toy'
  | 'ToyTwoHanded'
  | 'Trident'
  | 'Warhorn';

export type ItemDamageType = 'Choking' | 'Fire' | 'Ice' | 'Lightning' | 'Physical';

export interface ItemWeaponDetails extends ItemEquipmentDetails {
  type: ItemWeaponType;
  damage_type: ItemDamageType;
  /** Weapon strength range. */
  min_power: number;
  max_power: number;
  /** Non-zero on shields. */
  defense: number;
}

export interface ItemArmor extends ItemBase {
  type: 'Armor';
  /** /v2/skins id. */
  default_skin: number;
  details: ItemArmorDetails;
}

export interface ItemBack extends ItemBase {
  type: 'Back';
  /** /v2/skins id. */
  default_skin: number;
  details: ItemBackDetails;
}

export interface ItemBag extends ItemBase {
  type: 'Bag';
  details: ItemBagDetails;
}

export interface ItemConsumable extends ItemBase {
  type: 'Consumable';
  details: ItemConsumableDetails;
}

export interface ItemContainer extends ItemBase {
  type: 'Container';
  details: ItemContainerDetails;
}

export interface ItemGathering extends ItemBase {
  type: 'Gathering';
  details: ItemGatheringDetails;
}

export interface ItemGizmo extends ItemBase {
  type: 'Gizmo';
  details: ItemGizmoDetails;
}

export interface ItemMiniPet extends ItemBase {
  type: 'MiniPet';
  details: ItemMiniPetDetails;
}

export interface ItemTool extends ItemBase {
  type: 'Tool';
  details: ItemToolDetails;
}

export interface ItemTrinket extends ItemBase {
  type: 'Trinket';
  details: ItemTrinketDetails;
}

export interface ItemUpgradeComponent extends ItemBase {
  type: 'UpgradeComponent';
  details: ItemUpgradeComponentDetails;
}

export interface ItemWeapon extends ItemBase {
  type: 'Weapon';
  /** /v2/skins id. */
  default_skin: number;
  details: ItemWeaponDetails;
}

/**
 * Item types without a `details` object. `JadeTechModule` covers jade bot
 * sensory arrays and service chips; `Trait` (trait guides) is documented but
 * no current item has it.
 */
export interface ItemWithoutDetails extends ItemBase {
  type: 'CraftingMaterial' | 'JadeTechModule' | 'Key' | 'PowerCore' | 'Relic' | 'Trait' | 'Trophy';
}

/** An item; narrow on `type` to reach the matching `details`. */
export type Item =
  | ItemArmor
  | ItemBack
  | ItemBag
  | ItemConsumable
  | ItemContainer
  | ItemGathering
  | ItemGizmo
  | ItemMiniPet
  | ItemTool
  | ItemTrinket
  | ItemUpgradeComponent
  | ItemWeapon
  | ItemWithoutDetails;

export type ItemType = Item['type'];

// ---------------------------------------------------------------------------
// /v2/itemstats

export interface ItemStat {
  id: number;
  /** Prefix name, e.g. `Berserker's`; empty for some internal sets. */
  name: string;
  attributes: ItemStatAttribute[];
}

/** Value = item `attribute_adjustment` × `multiplier` + `value`. */
export interface ItemStatAttribute {
  attribute: Attribute;
  multiplier: number;
  value: number;
}

// ---------------------------------------------------------------------------
// /v2/skins

export type SkinFlag = 'HideIfLocked' | 'NoCost' | 'OverrideRarity' | 'ShowInWardrobe';

/** Dye material of a dye slot (skins, mounts, skiffs). `fur` only on mounts. */
export type DyeMaterial = 'cloth' | 'fur' | 'leather' | 'metal';

/** Default dye in one channel. */
export interface SkinDyeSlot {
  /** /v2/colors id. */
  color_id: number;
  material: DyeMaterial;
}

export type SkinDyeOverrideKey =
  | 'AsuraFemale'
  | 'AsuraMale'
  | 'CharrFemale'
  | 'CharrMale'
  | 'HumanFemale'
  | 'HumanMale'
  | 'NornFemale'
  | 'NornMale'
  | 'SylvariFemale'
  | 'SylvariMale';

/** Weapon types as spelled by skins (items use `LongBow`, `ShortBow`, `Harpoon`). */
export type SkinWeaponType =
  | Exclude<ItemWeaponType, 'Harpoon' | 'LongBow' | 'ShortBow'>
  | 'Longbow'
  | 'Shortbow'
  | 'Spear';

export interface SkinBase {
  id: number;
  name: string;
  flags: SkinFlag[];
  /** Races that may use the skin; empty means all. */
  restrictions: Race[];
  icon?: string;
  rarity: Rarity;
  description?: string;
}

export interface SkinArmor extends SkinBase {
  type: 'Armor';
  details: {
    type: ItemArmorSlot;
    weight_class: ItemArmorWeight;
    /**
     * Default dye per channel; `null` means the channel cannot be dyed unless
     * an override for the character's race and gender says otherwise.
     */
    dye_slots?: {
      default: (SkinDyeSlot | null)[];
      overrides: Partial<Record<SkinDyeOverrideKey, (SkinDyeSlot | null)[]>>;
    };
  };
}

export interface SkinWeapon extends SkinBase {
  type: 'Weapon';
  details: { type: SkinWeaponType; damage_type: ItemDamageType };
}

export interface SkinBack extends SkinBase {
  type: 'Back';
}

export interface SkinGathering extends SkinBase {
  type: 'Gathering';
  details: { type: ItemGatheringDetails['type'] };
}

/** A wardrobe skin; narrow on `type` to reach the matching `details`. */
export type Skin = SkinArmor | SkinBack | SkinGathering | SkinWeapon;

// ---------------------------------------------------------------------------
// /v2/recipes

export type RecipeType =
  // Weapons
  | 'Axe'
  | 'Dagger'
  | 'Focus'
  | 'Greatsword'
  | 'Hammer'
  | 'Harpoon'
  | 'LongBow'
  | 'Mace'
  | 'Pistol'
  | 'Rifle'
  | 'Scepter'
  | 'Shield'
  | 'ShortBow'
  | 'Speargun'
  | 'Staff'
  | 'Sword'
  | 'Torch'
  | 'Trident'
  | 'Warhorn'
  // Armor
  | 'Boots'
  | 'Coat'
  | 'Gloves'
  | 'Helm'
  | 'Leggings'
  | 'Shoulders'
  // Trinkets
  | 'Amulet'
  | 'Earring'
  | 'Ring'
  // Food
  | 'Dessert'
  | 'Feast'
  | 'Food'
  | 'IngredientCooking'
  | 'Meal'
  | 'Seasoning'
  | 'Snack'
  | 'Soup'
  // Components and refinement
  | 'Component'
  | 'Inscription'
  | 'Insignia'
  | 'LegendaryComponent'
  | 'Refinement'
  | 'RefinementEctoplasm'
  | 'RefinementObsidian'
  // Guild
  | 'GuildConsumable'
  | 'GuildConsumableWvw'
  | 'GuildDecoration'
  // Other
  | 'Backpack'
  | 'Bag'
  | 'Bulk'
  | 'Consumable'
  | 'Dye'
  | 'Potion'
  | 'UpgradeComponent';

/** Crafting disciplines that can appear on a recipe, including homestead refinement. */
export type RecipeDiscipline = CraftingDiscipline | 'Homesteader';

export interface RecipeIngredient {
  type: 'Currency' | 'GuildUpgrade' | 'Item';
  /** /v2/items, /v2/currencies or /v2/guild/upgrades id, per `type`. */
  id: number;
  count: number;
}

export interface Recipe {
  id: number;
  type: RecipeType;
  /** /v2/items id of the product. */
  output_item_id: number;
  output_item_count: number;
  time_to_craft_ms: number;
  disciplines: RecipeDiscipline[];
  /** Discipline rating needed. */
  min_rating: number;
  /** `AutoLearned`: unlocked by rating; `LearnedFromItem`: unlocked by a recipe sheet. */
  flags: ('AutoLearned' | 'LearnedFromItem')[];
  /** Guild upgrades used appear here with `type: 'GuildUpgrade'` (no separate `guild_ingredients` at this schema). */
  ingredients: RecipeIngredient[];
  /** /v2/guild/upgrades id produced, for guild recipes. */
  output_upgrade_id?: number;
  chat_link: string;
}

/** `/v2/recipes/search` takes exactly one of these. */
export type RecipeSearchQuery =
  /** Recipes that use this /v2/items id. */
  | { input: number }
  /** Recipes that produce this /v2/items id. */
  | { output: number };

// ---------------------------------------------------------------------------
// /v2/commerce

/** Best price and total quantity on one side of the order book. Both 0 when there are no orders. */
export interface CommercePriceSide {
  /** Copper: highest buy order or lowest sell offer. */
  unit_price: number;
  quantity: number;
}

export interface CommercePrice {
  /** /v2/items id. */
  id: number;
  /** Free-to-play accounts may trade it. */
  whitelisted: boolean;
  buys: CommercePriceSide;
  sells: CommercePriceSide;
}

/** All orders at one price. */
export interface CommerceListingEntry {
  /** Number of individual orders at this price. */
  listings: number;
  /** Copper. */
  unit_price: number;
  quantity: number;
}

export interface CommerceListing {
  /** /v2/items id. */
  id: number;
  /** Highest price first. */
  buys: CommerceListingEntry[];
  /** Lowest price first. */
  sells: CommerceListingEntry[];
}

/** Gem exchange quote. */
export interface ExchangeRate {
  /** Copper per gem at this quantity. */
  coins_per_gem: number;
  /** What you receive: gems for `/coins`, copper for `/gems`. */
  quantity: number;
}

/** Items and coins waiting for pickup at the trading post. */
export interface CommerceDelivery {
  /** Copper. */
  coins: number;
  /** /v2/items ids. */
  items: IdCount[];
}

/** Paging for the transaction lists: 50 per page unless `page_size` (at most 200) says otherwise. */
export interface TransactionPageQuery {
  /** Zero-based. */
  page?: number;
  page_size?: number;
}

/** An open order (`/v2/commerce/transactions/current/*`). */
export interface CommerceTransaction {
  /** Transaction id. */
  id: number;
  /** /v2/items id. */
  item_id: number;
  /** Copper per unit. */
  price: number;
  quantity: number;
  /** ISO-8601 timestamp. */
  created: string;
}

/** A fulfilled order from the last 90 days (`/v2/commerce/transactions/history/*`). */
export interface CommerceCompletedTransaction extends CommerceTransaction {
  /** ISO-8601 timestamp. */
  purchased: string;
}

// ---------------------------------------------------------------------------
// /v2/materials, /v2/currencies, /v2/colors, /v2/legendaryarmory

/** A material storage category. */
export interface MaterialCategory {
  id: number;
  name: string;
  /** /v2/items ids stored in this category. */
  items: number[];
  order: number;
}

export interface Currency {
  /** /v2/currencies id, as used by the wallet. */
  id: number;
  name: string;
  description: string;
  icon: string;
  order: number;
}

/** Appearance of a dye on one material. */
export interface ColorMaterialDetails {
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
  lightness: number;
  /** Precomputed `[r, g, b]`. */
  rgb: number[];
}

export type ColorHue = 'Blue' | 'Brown' | 'Gray' | 'Green' | 'Orange' | 'Purple' | 'Red' | 'Yellow';
export type ColorMaterial = 'Leather' | 'Metal' | 'Vibrant';
export type ColorRarity = 'Common' | 'Exclusive' | 'Rare' | 'Starter' | 'Uncommon';

export interface Color {
  id: number;
  name: string;
  /** `[r, g, b]`. */
  base_rgb: number[];
  cloth: ColorMaterialDetails;
  leather: ColorMaterialDetails;
  metal: ColorMaterialDetails;
  fur?: ColorMaterialDetails;
  /** /v2/items id of the dye item. */
  item?: number;
  /** Empty only for Dye Remover. */
  categories: [] | [ColorHue, ColorMaterial, ColorRarity];
}

export interface LegendaryArmoryItem {
  /** /v2/items id. */
  id: number;
  /** How many copies the armory can hold (e.g. 2 for rings). */
  max_count: number;
}

// ---------------------------------------------------------------------------
// Collectables

export interface Mini {
  id: number;
  name: string;
  /** How to unlock it; only on a few minis. */
  unlock?: string;
  icon: string;
  order: number;
  /** /v2/items id that unlocks it. */
  item_id: number;
}

export type NoveltySlot = 'Chair' | 'HeldItem' | 'Miscellaneous' | 'Music' | 'Tonic';

export interface Novelty {
  id: number;
  name: string;
  description: string;
  icon: string;
  slot: NoveltySlot;
  /** /v2/items ids that unlock it. */
  unlock_item: number[];
}

export interface Outfit {
  id: number;
  name: string;
  icon: string;
  /** /v2/items ids that unlock it. */
  unlock_items: number[];
}

export interface Glider {
  id: number;
  name: string;
  description: string;
  icon: string;
  /** Not unique. */
  order: number;
  /** /v2/items ids that unlock it. */
  unlock_items?: number[];
  /** /v2/colors ids. */
  default_dyes: number[];
}

export interface Finisher {
  id: number;
  name: string;
  /** How to unlock it; may contain `<c=@reminder>` markup or be empty. */
  unlock_details: string;
  /** /v2/items ids that unlock it. */
  unlock_items: number[];
  order: number;
  icon: string;
}

export interface MailCarrier {
  id: number;
  name: string;
  icon: string;
  order: number;
  /** /v2/items ids that unlock it. */
  unlock_items: number[];
  /** `Default` on the carrier every account has. */
  flags: 'Default'[];
}

export interface Jadebot {
  id: number;
  name: string;
  description: string;
  /** /v2/items id that unlocks it. */
  unlock_item: number;
}

export interface Skiff {
  id: number;
  name: string;
  icon: string;
  dye_slots: SkinDyeSlot[];
}

export interface Emote {
  /** Emote name, e.g. `Bless`; not always capitalized (`step`). */
  id: string;
  /** Chat commands in each language, e.g. `/bless`. */
  commands: string[];
  /** /v2/items ids that unlock it. */
  unlock_items: number[];
}

export interface Title {
  id: number;
  name: string;
  /** Deprecated: first of `achievements`. */
  achievement?: number;
  /** /v2/achievements ids that grant it. Absent on AP titles. */
  achievements?: number[];
  /** Achievement points needed, for AP titles. */
  ap_required?: number;
}

// ---------------------------------------------------------------------------
// /v2/mounts

export type MountTypeId =
  | 'griffon'
  | 'jackal'
  | 'raptor'
  | 'roller_beetle'
  | 'skimmer'
  | 'skyscale'
  | 'springer'
  | 'turtle'
  | 'warclaw';

export interface MountType {
  id: MountTypeId;
  name: string;
  /** /v2/mounts/skins id. */
  default_skin: number;
  /** /v2/mounts/skins ids. */
  skins: number[];
  /** Mount skills; `id` is a /v2/skills id, `slot` is `Weapon_1` to `Weapon_4`. */
  skills: { id: number; slot: string }[];
  /** Matches `mount_guid` on its skins. */
  guid: string;
}

export interface MountSkin {
  id: number;
  name: string;
  icon: string;
  /** `guid` of the /v2/mounts/types entry this skin belongs to. */
  mount_guid: string;
  dye_slots: SkinDyeSlot[];
}
