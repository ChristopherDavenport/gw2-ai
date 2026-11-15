import type { MetaTable } from '../spec.js';
import type {
  Account,
  AccountAchievement,
  AccountBuildStorageSlot,
  AccountFinisher,
  AccountHomesteadDecoration,
  AccountLegendaryArmoryItem,
  AccountLuck,
  AccountMastery,
  AccountMasteryPoints,
  AccountMaterial,
  AccountProgression,
  AccountWalletCurrency,
  AccountWizardsVaultListing,
  AccountWizardsVaultPeriod,
  AccountWizardsVaultSpecial,
  AccountWvw,
  CreateSubtokenQuery,
  Subtoken,
  TokenInfo,
  WizardsVaultListing,
  WizardsVaultObjective,
  WizardsVaultSeason,
} from '../types/account.js';
import type { InventorySlot } from '../types/common.js';

/**
 * /v2/account*, /v2/tokeninfo, /v2/createsubtoken, /v2/wizardsvault*.
 *
 * Account unlock lists (`/v2/account/skins`, `/dyes`, ...) return bare id
 * arrays and ignore `?ids=`, so none of them is a bulk route. Daily and
 * weekly lists (`/worldbosses`, `/raids`, ...) hold what was done since the
 * last reset.
 */
export interface AccountRoutes {
  '/v2/account': { response: Account };
  '/v2/account/achievements': { response: AccountAchievement[] };
  /** Bank slots in order; `null` is an empty slot. */
  '/v2/account/bank': { response: (InventorySlot | null)[] };
  /** Build storage slot indices; each slot is fetched by index. */
  '/v2/account/buildstorage': { response: number[]; item: AccountBuildStorageSlot; id: number };
  /** /v2/dailycrafting ids crafted since the daily reset. */
  '/v2/account/dailycrafting': { response: string[] };
  /** /v2/dungeons path ids completed since the daily reset. */
  '/v2/account/dungeons': { response: string[] };
  /** /v2/colors ids. */
  '/v2/account/dyes': { response: number[] };
  /** /v2/emotes ids. */
  '/v2/account/emotes': { response: string[] };
  '/v2/account/finishers': { response: AccountFinisher[] };
  /** /v2/gliders ids. */
  '/v2/account/gliders': { response: number[] };
  /** Index: sub-route names (`cats`, `nodes`). */
  '/v2/account/home': { response: string[] };
  /** /v2/home/cats ids. */
  '/v2/account/home/cats': { response: number[] };
  /** /v2/home/nodes ids. */
  '/v2/account/home/nodes': { response: string[] };
  /** Index: sub-route names. */
  '/v2/account/homestead': { response: string[] };
  /** Empty if the account has no homestead. */
  '/v2/account/homestead/decorations': { response: AccountHomesteadDecoration[] };
  /** /v2/homestead/glyphs ids. */
  '/v2/account/homestead/glyphs': { response: string[] };
  /** Shared inventory slots; `null` is an empty slot. */
  '/v2/account/inventory': { response: (InventorySlot | null)[] };
  /** /v2/jadebots ids. */
  '/v2/account/jadebots': { response: number[] };
  '/v2/account/legendaryarmory': { response: AccountLegendaryArmoryItem[] };
  /** One entry, or empty if the account has consumed no luck. */
  '/v2/account/luck': { response: AccountLuck[] };
  /** /v2/mailcarriers ids. */
  '/v2/account/mailcarriers': { response: number[] };
  /** /v2/mapchests ids opened since the daily reset. */
  '/v2/account/mapchests': { response: string[] };
  '/v2/account/masteries': { response: AccountMastery[] };
  '/v2/account/mastery/points': { response: AccountMasteryPoints };
  '/v2/account/materials': { response: AccountMaterial[] };
  /** /v2/minis ids. */
  '/v2/account/minis': { response: number[] };
  /** Index: sub-route names (`types`, `skins`). */
  '/v2/account/mounts': { response: string[] };
  /** /v2/mounts/skins ids. */
  '/v2/account/mounts/skins': { response: number[] };
  /** /v2/mounts/types ids. */
  '/v2/account/mounts/types': { response: string[] };
  /** /v2/novelties ids. */
  '/v2/account/novelties': { response: number[] };
  /** /v2/outfits ids. */
  '/v2/account/outfits': { response: number[] };
  '/v2/account/progression': { response: AccountProgression[] };
  /** /v2/pvp/heroes ids. */
  '/v2/account/pvp/heroes': { response: number[] };
  /** /v2/raids encounter ids cleared since the weekly reset. */
  '/v2/account/raids': { response: string[] };
  /** /v2/recipes ids learned from recipe sheets. */
  '/v2/account/recipes': { response: number[] };
  /** /v2/skiffs ids. */
  '/v2/account/skiffs': { response: number[] };
  /** /v2/skins ids. */
  '/v2/account/skins': { response: number[] };
  /** /v2/titles ids. */
  '/v2/account/titles': { response: number[] };
  '/v2/account/wallet': { response: AccountWalletCurrency[] };
  '/v2/account/wizardsvault/daily': { response: AccountWizardsVaultPeriod };
  '/v2/account/wizardsvault/listings': { response: AccountWizardsVaultListing[] };
  '/v2/account/wizardsvault/special': { response: AccountWizardsVaultSpecial };
  '/v2/account/wizardsvault/weekly': { response: AccountWizardsVaultPeriod };
  /** /v2/worldbosses ids killed since the daily reset. */
  '/v2/account/worldbosses': { response: string[] };
  '/v2/account/wvw': { response: AccountWvw };
  '/v2/createsubtoken': { response: Subtoken; query: CreateSubtokenQuery };
  '/v2/tokeninfo': { response: TokenInfo };
  /** Not in v2.json, but live. */
  '/v2/wizardsvault': { response: WizardsVaultSeason };
  '/v2/wizardsvault/listings': { response: number[]; item: WizardsVaultListing; id: number };
  '/v2/wizardsvault/objectives': { response: number[]; item: WizardsVaultObjective; id: number };
}

const UNLOCKS = { auth: true, permissions: ['unlocks'], lang: false } as const;
const PROGRESSION = { auth: true, permissions: ['progression'], lang: false } as const;
const INVENTORIES = { auth: true, permissions: ['inventories'], lang: false } as const;
const INDEX = { auth: false, permissions: [], lang: false } as const;

export const ACCOUNT_ROUTES: MetaTable<AccountRoutes> = {
  '/v2/account': { auth: true, permissions: [], lang: false },
  '/v2/account/achievements': PROGRESSION,
  '/v2/account/bank': INVENTORIES,
  // The wiki lists only `account`.
  '/v2/account/buildstorage': { auth: true, permissions: [], lang: false, bulk: 'all' },
  '/v2/account/dailycrafting': PROGRESSION,
  '/v2/account/dungeons': PROGRESSION,
  '/v2/account/dyes': UNLOCKS,
  '/v2/account/emotes': { auth: true, permissions: [], lang: false },
  '/v2/account/finishers': UNLOCKS,
  '/v2/account/gliders': UNLOCKS,
  '/v2/account/home': INDEX,
  '/v2/account/home/cats': { auth: true, permissions: ['progression', 'unlocks'], lang: false },
  '/v2/account/home/nodes': { auth: true, permissions: ['progression', 'unlocks'], lang: false },
  '/v2/account/homestead': INDEX,
  '/v2/account/homestead/decorations': UNLOCKS,
  '/v2/account/homestead/glyphs': UNLOCKS,
  '/v2/account/inventory': INVENTORIES,
  '/v2/account/jadebots': UNLOCKS,
  '/v2/account/legendaryarmory': { auth: true, permissions: ['inventories', 'unlocks'], lang: false },
  '/v2/account/luck': { auth: true, permissions: ['progression', 'unlocks'], lang: false },
  '/v2/account/mailcarriers': UNLOCKS,
  '/v2/account/mapchests': PROGRESSION,
  '/v2/account/masteries': PROGRESSION,
  '/v2/account/mastery/points': PROGRESSION,
  '/v2/account/materials': INVENTORIES,
  '/v2/account/minis': UNLOCKS,
  '/v2/account/mounts': INDEX,
  '/v2/account/mounts/skins': UNLOCKS,
  '/v2/account/mounts/types': UNLOCKS,
  '/v2/account/novelties': UNLOCKS,
  '/v2/account/outfits': UNLOCKS,
  '/v2/account/progression': { auth: true, permissions: ['progression', 'unlocks'], lang: false },
  '/v2/account/pvp/heroes': UNLOCKS,
  '/v2/account/raids': PROGRESSION,
  '/v2/account/recipes': UNLOCKS,
  '/v2/account/skiffs': UNLOCKS,
  '/v2/account/skins': UNLOCKS,
  '/v2/account/titles': UNLOCKS,
  '/v2/account/wallet': { auth: true, permissions: ['wallet'], lang: false },
  '/v2/account/wizardsvault/daily': PROGRESSION,
  '/v2/account/wizardsvault/listings': PROGRESSION,
  '/v2/account/wizardsvault/special': PROGRESSION,
  '/v2/account/wizardsvault/weekly': PROGRESSION,
  '/v2/account/worldbosses': PROGRESSION,
  '/v2/account/wvw': { auth: true, permissions: ['wvw'], lang: false },
  '/v2/createsubtoken': { auth: true, permissions: [], lang: false },
  '/v2/tokeninfo': { auth: true, permissions: [], lang: false },
  // Not in v2.json; the season title is not localized.
  '/v2/wizardsvault': INDEX,
  '/v2/wizardsvault/listings': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/wizardsvault/objectives': { auth: false, permissions: [], lang: true, bulk: 'all' },
};
