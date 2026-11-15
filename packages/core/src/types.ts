// Response shapes for the endpoints this project uses, at schema version
// SCHEMA_VERSION (see client.ts). Fields the API marks optional are optional
// here; anything not modelled is still present at runtime.

export type Permission =
  | 'account'
  | 'builds'
  | 'characters'
  | 'guilds'
  | 'inventories'
  | 'progression'
  | 'pvp'
  | 'tradingpost'
  | 'unlocks'
  | 'wallet'
  | 'wvw';

export interface TokenInfo {
  id: string;
  name: string;
  permissions: Permission[];
  type?: 'APIKey' | 'Subtoken';
  expires_at?: string;
  issued_at?: string;
  urls?: string[];
}

export interface Account {
  id: string;
  name: string;
  age: number;
  world?: number;
  guilds: string[];
  guild_leader?: string[];
  created: string;
  access: string[];
  commander: boolean;
  fractal_level?: number;
  daily_ap?: number;
  monthly_ap?: number;
  wvw?: { team_id?: number; rank?: number };
  last_modified?: string;
  build_storage_slots?: number;
}

export interface IdValue {
  id: number;
  value: number;
}

export interface Currency {
  id: number;
  name: string;
  description: string;
  icon: string;
  order: number;
}

export interface AccountMaterial {
  id: number;
  category: number;
  binding?: 'Account';
  count: number;
}

export interface MaterialCategory {
  id: number;
  name: string;
  items: number[];
  order: number;
}

export interface ItemSlot {
  id: number;
  count: number;
  charges?: number;
  skin?: number;
  upgrades?: number[];
  infusions?: number[];
  binding?: 'Account' | 'Character';
  bound_to?: string;
}

export type Rarity =
  | 'Junk'
  | 'Basic'
  | 'Fine'
  | 'Masterwork'
  | 'Rare'
  | 'Exotic'
  | 'Ascended'
  | 'Legendary';

export interface Item {
  id: number;
  name: string;
  description?: string;
  type: string;
  level: number;
  rarity: Rarity;
  vendor_value: number;
  default_skin?: number;
  game_types: string[];
  flags: string[];
  restrictions: string[];
  chat_link: string;
  icon?: string;
  upgrades_into?: { upgrade: string; item_id: number }[];
  upgrades_from?: { upgrade: string; item_id: number }[];
  details?: Record<string, unknown>;
}

export interface Price {
  id: number;
  whitelisted: boolean;
  buys: { quantity: number; unit_price: number };
  sells: { quantity: number; unit_price: number };
}

export interface Listing {
  id: number;
  buys: { listings: number; unit_price: number; quantity: number }[];
  sells: { listings: number; unit_price: number; quantity: number }[];
}

export interface Transaction {
  id: number;
  item_id: number;
  price: number;
  quantity: number;
  created: string;
  purchased?: string;
}

export interface Delivery {
  coins: number;
  items: { id: number; count: number }[];
}

export interface ExchangeRate {
  coins_per_gem: number;
  quantity: number;
}

export interface RecipeIngredient {
  type: 'Item' | 'Currency' | 'GuildUpgrade';
  id: number;
  count: number;
}

export interface Recipe {
  id: number;
  type: string;
  output_item_id: number;
  output_item_count: number;
  time_to_craft_ms: number;
  disciplines: string[];
  min_rating: number;
  flags: string[];
  ingredients: RecipeIngredient[];
  guild_ingredients?: { upgrade_id: number; count: number }[];
  output_upgrade_id?: number;
  chat_link: string;
}

export interface CraftingDiscipline {
  discipline: string;
  rating: number;
  active: boolean;
}

export interface Bag {
  id: number;
  size: number;
  inventory: (ItemSlot | null)[];
}

export interface EquipmentSlot extends ItemSlot {
  slot?: string;
  location?: string;
  tabs?: number[];
  stats?: { id: number; attributes: Record<string, number> };
  dyes?: (number | null)[];
}

export interface Character {
  name: string;
  race: string;
  gender: string;
  flags: string[];
  profession: string;
  level: number;
  guild?: string;
  age: number;
  created: string;
  last_modified?: string;
  deaths: number;
  title?: number;
  crafting: CraftingDiscipline[];
  bags?: (Bag | null)[];
  equipment?: EquipmentSlot[];
  build_tabs_unlocked?: number;
  active_build_tab?: number;
  equipment_tabs_unlocked?: number;
  active_equipment_tab?: number;
  build_tabs?: BuildTab[];
}

export interface BuildTab {
  tab: number;
  is_active: boolean;
  build: {
    name: string;
    profession: string;
    specializations: { id: number | null; traits: (number | null)[] }[];
    skills?: { heal: number | null; utilities: (number | null)[]; elite: number | null };
    aquatic_skills?: { heal: number | null; utilities: (number | null)[]; elite: number | null };
    legends?: (string | null)[];
    pets?: { terrestrial: (number | null)[]; aquatic: (number | null)[] };
  };
}

export interface AccountAchievement {
  id: number;
  current?: number;
  max?: number;
  done: boolean;
  bits?: number[];
  repeated?: number;
  unlocked?: boolean;
}

export interface Achievement {
  id: number;
  name: string;
  description: string;
  requirement: string;
  locked_text: string;
  type: string;
  flags: string[];
  tiers: { count: number; points: number }[];
  prerequisites?: number[];
  rewards?: { type: string; id?: number; count?: number; region?: string }[];
  bits?: { type: string; id?: number; text?: string }[];
  point_cap?: number;
}

export interface WizardsVaultObjective {
  id: number;
  title: string;
  track: 'PvE' | 'PvP' | 'WvW' | string;
  acclaim: number;
  progress_current: number;
  progress_complete: number;
  claimed: boolean;
}

export interface WizardsVaultPeriod {
  meta_progress_current?: number;
  meta_progress_complete?: number;
  meta_reward_item_id?: number;
  meta_reward_astral?: number;
  meta_reward_claimed?: boolean;
  objectives: WizardsVaultObjective[];
}

export interface MasteryPoints {
  totals: { region: string; spent: number; earned: number }[];
  unlocked: number[];
}

export interface LegendaryArmoryEntry {
  id: number;
  count: number;
}
