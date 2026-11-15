import type { MetaTable } from '../spec.js';
import type {
  Color,
  CommerceCompletedTransaction,
  CommerceDelivery,
  CommerceListing,
  CommercePrice,
  CommerceTransaction,
  Currency,
  Emote,
  ExchangeRate,
  Finisher,
  Glider,
  Item,
  ItemStat,
  Jadebot,
  LegendaryArmoryItem,
  MailCarrier,
  MaterialCategory,
  Mini,
  MountSkin,
  MountType,
  MountTypeId,
  Novelty,
  Outfit,
  Recipe,
  RecipeSearchQuery,
  Skiff,
  Skin,
  Title,
} from '../types/economy.js';

/** Items, recipes, trading post, currencies and collectables: /v2/items, /v2/itemstats, /v2/skins, /v2/recipes*, /v2/commerce/*, /v2/materials, /v2/currencies, /v2/colors, /v2/legendaryarmory, /v2/minis, /v2/novelties, /v2/outfits, /v2/gliders, /v2/finishers, /v2/mailcarriers, /v2/jadebots, /v2/skiffs, /v2/emotes, /v2/titles, /v2/mounts* */
export interface EconomyRoutes {
  // Items and crafting
  '/v2/items': { response: number[]; item: Item; id: number };
  '/v2/itemstats': { response: number[]; item: ItemStat; id: number };
  '/v2/skins': { response: number[]; item: Skin; id: number };
  '/v2/recipes': { response: number[]; item: Recipe; id: number };
  /** Recipe ids that use (`input`) or produce (`output`) an item. */
  '/v2/recipes/search': { response: number[]; query: RecipeSearchQuery };
  '/v2/materials': { response: number[]; item: MaterialCategory; id: number };
  '/v2/currencies': { response: number[]; item: Currency; id: number };
  '/v2/colors': { response: number[]; item: Color; id: number };
  '/v2/legendaryarmory': { response: number[]; item: LegendaryArmoryItem; id: number };

  // Trading post
  /** Ids of tradable items. */
  '/v2/commerce/prices': { response: number[]; item: CommercePrice; id: number };
  /** Ids of tradable items. */
  '/v2/commerce/listings': { response: number[]; item: CommerceListing; id: number };
  '/v2/commerce/exchange': { response: ('coins' | 'gems')[] };
  /** Gems received for `quantity` copper. */
  '/v2/commerce/exchange/coins': { response: ExchangeRate; query: { quantity: number } };
  /** Copper received for `quantity` gems. */
  '/v2/commerce/exchange/gems': { response: ExchangeRate; query: { quantity: number } };
  '/v2/commerce/delivery': { response: CommerceDelivery };
  '/v2/commerce/transactions': { response: ('current' | 'history')[] };
  /** Open buy orders. Paged. */
  '/v2/commerce/transactions/current/buys': { response: CommerceTransaction[] };
  /** Open sell listings. Paged. */
  '/v2/commerce/transactions/current/sells': { response: CommerceTransaction[] };
  /** Fulfilled buy orders, last 90 days. Paged. */
  '/v2/commerce/transactions/history/buys': { response: CommerceCompletedTransaction[] };
  /** Completed sales, last 90 days. Paged. */
  '/v2/commerce/transactions/history/sells': { response: CommerceCompletedTransaction[] };

  // Collectables
  '/v2/minis': { response: number[]; item: Mini; id: number };
  '/v2/novelties': { response: number[]; item: Novelty; id: number };
  '/v2/outfits': { response: number[]; item: Outfit; id: number };
  '/v2/gliders': { response: number[]; item: Glider; id: number };
  '/v2/finishers': { response: number[]; item: Finisher; id: number };
  '/v2/mailcarriers': { response: number[]; item: MailCarrier; id: number };
  '/v2/jadebots': { response: number[]; item: Jadebot; id: number };
  '/v2/skiffs': { response: number[]; item: Skiff; id: number };
  '/v2/emotes': { response: string[]; item: Emote; id: string };
  '/v2/titles': { response: number[]; item: Title; id: number };
  '/v2/mounts': { response: ('types' | 'skins')[] };
  '/v2/mounts/types': { response: MountTypeId[]; item: MountType; id: MountTypeId };
  '/v2/mounts/skins': { response: number[]; item: MountSkin; id: number };
}

export const ECONOMY_ROUTES: MetaTable<EconomyRoutes> = {
  '/v2/items': { auth: false, permissions: [], lang: true, bulk: 'ids' },
  '/v2/itemstats': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/skins': { auth: false, permissions: [], lang: true, bulk: 'ids' },
  '/v2/recipes': { auth: false, permissions: [], lang: false, bulk: 'ids' },
  '/v2/recipes/search': { auth: false, permissions: [], lang: false },
  '/v2/materials': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/currencies': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/colors': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/legendaryarmory': { auth: false, permissions: [], lang: false, bulk: 'all' },

  '/v2/commerce/prices': { auth: false, permissions: [], lang: false, bulk: 'ids', live: true },
  '/v2/commerce/listings': { auth: false, permissions: [], lang: false, bulk: 'ids', live: true },
  '/v2/commerce/exchange': { auth: false, permissions: [], lang: false },
  '/v2/commerce/exchange/coins': { auth: false, permissions: [], lang: false, live: true },
  '/v2/commerce/exchange/gems': { auth: false, permissions: [], lang: false, live: true },
  '/v2/commerce/delivery': { auth: true, permissions: ['tradingpost'], lang: false },
  '/v2/commerce/transactions': { auth: true, permissions: ['tradingpost'], lang: false },
  '/v2/commerce/transactions/current/buys': { auth: true, permissions: ['tradingpost'], lang: false },
  '/v2/commerce/transactions/current/sells': { auth: true, permissions: ['tradingpost'], lang: false },
  '/v2/commerce/transactions/history/buys': { auth: true, permissions: ['tradingpost'], lang: false },
  '/v2/commerce/transactions/history/sells': { auth: true, permissions: ['tradingpost'], lang: false },

  '/v2/minis': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/novelties': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/outfits': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/gliders': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/finishers': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/mailcarriers': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/jadebots': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/skiffs': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/emotes': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/titles': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/mounts': { auth: false, permissions: [], lang: false },
  '/v2/mounts/types': { auth: false, permissions: [], lang: true, bulk: 'all' },
  '/v2/mounts/skins': { auth: false, permissions: [], lang: true, bulk: 'all' },
};
