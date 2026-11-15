import type { MetaTable } from '../spec.js';
import type {
  ApiFile,
  BackstoryAnswer,
  BackstoryQuestion,
  Character,
  CharacterBackstory,
  CharacterBuildTab,
  CharacterCore,
  CharacterCrafting,
  CharacterEquipment,
  CharacterEquipmentTab,
  CharacterInventory,
  CharacterRecipes,
  CharacterSab,
  CharacterTraining,
  EmblemPart,
  GameBuild,
  Guild,
  GuildLogEntry,
  GuildLogQuery,
  GuildMember,
  GuildPermission,
  GuildRank,
  GuildSearchQuery,
  GuildStashSection,
  GuildStorageItem,
  GuildTeam,
  GuildTreasuryItem,
  GuildUpgrade,
  Logo,
  Quaggan,
} from '../types/characters.js';

/**
 * /v2/characters*, /v2/guild*, /v2/backstory*, /v2/emblem*, /v2/files,
 * /v2/quaggans, /v2/logos, /v2/build.
 *
 * Left out: `/v2/characters/:id/skills` and `/v2/characters/:id/specializations`
 * are still listed in v2.json but return 404 at the pinned schema version;
 * their data is in `/v2/characters/:id/buildtabs/active`.
 *
 * `/v2/characters/:id/buildtabs` and `/equipmenttabs` return tab numbers.
 * They select tabs with `?tab=` / `?tabs=` rather than `?ids=`, which changes
 * the response shape, so they are typed as plain id lists; use the `/active`
 * routes or the full character for tab contents.
 *
 * Not in v2.json but served by the API: `/v2/characters/:id` (one full
 * character) and `/v2/emblem/backgrounds` / `/v2/emblem/foregrounds`.
 */
export interface CharacterRoutes {
  /** Character names. */
  '/v2/characters': { response: string[]; item: Character; id: string; key: 'name' };
  '/v2/characters/:id': { response: Character };
  '/v2/characters/:id/backstory': { response: CharacterBackstory };
  /** Build tab numbers, 1..build_tabs_unlocked. */
  '/v2/characters/:id/buildtabs': { response: number[] };
  '/v2/characters/:id/buildtabs/active': { response: CharacterBuildTab };
  '/v2/characters/:id/core': { response: CharacterCore };
  '/v2/characters/:id/crafting': { response: CharacterCrafting };
  '/v2/characters/:id/equipment': { response: CharacterEquipment };
  /** Equipment tab numbers, 1..equipment_tabs_unlocked. */
  '/v2/characters/:id/equipmenttabs': { response: number[] };
  '/v2/characters/:id/equipmenttabs/active': { response: CharacterEquipmentTab };
  /** Hero challenge ids completed, matching `skill_challenges[].id` in /v2/continents maps (e.g. `"0-1"`). */
  '/v2/characters/:id/heropoints': { response: string[] };
  '/v2/characters/:id/inventory': { response: CharacterInventory };
  /** /v2/quests ids of the story steps chosen. */
  '/v2/characters/:id/quests': { response: number[] };
  '/v2/characters/:id/recipes': { response: CharacterRecipes };
  '/v2/characters/:id/sab': { response: CharacterSab };
  '/v2/characters/:id/training': { response: CharacterTraining };

  '/v2/guild/:id': { response: Guild };
  /** Roughly the last 100 events of each type, newest first. */
  '/v2/guild/:id/log': { response: GuildLogEntry[]; query: GuildLogQuery };
  '/v2/guild/:id/members': { response: GuildMember[] };
  '/v2/guild/:id/ranks': { response: GuildRank[] };
  '/v2/guild/:id/stash': { response: GuildStashSection[] };
  '/v2/guild/:id/storage': { response: GuildStorageItem[] };
  '/v2/guild/:id/teams': { response: GuildTeam[] };
  '/v2/guild/:id/treasury': { response: GuildTreasuryItem[] };
  /** /v2/guild/upgrades ids the guild has built. */
  '/v2/guild/:id/upgrades': { response: number[] };
  '/v2/guild/permissions': { response: string[]; item: GuildPermission; id: string };
  /** Guild ids (/v2/guild/:id) of the guild with this exact name; empty if none. */
  '/v2/guild/search': { response: string[]; query: GuildSearchQuery };
  '/v2/guild/upgrades': { response: number[]; item: GuildUpgrade; id: number };

  '/v2/backstory/answers': { response: string[]; item: BackstoryAnswer; id: string };
  '/v2/backstory/questions': { response: number[]; item: BackstoryQuestion; id: number };

  /** The sub-route names: `["foregrounds", "backgrounds"]`. */
  '/v2/emblem': { response: string[] };
  '/v2/emblem/backgrounds': { response: number[]; item: EmblemPart; id: number };
  '/v2/emblem/foregrounds': { response: number[]; item: EmblemPart; id: number };
  '/v2/files': { response: string[]; item: ApiFile; id: string };
  '/v2/quaggans': { response: string[]; item: Quaggan; id: string };
  '/v2/logos': { response: string[]; item: Logo; id: string };
  '/v2/build': { response: GameBuild };
}

const CHAR = { auth: true, lang: false } as const;
const GUILD = { auth: true, permissions: ['guilds'], lang: false } as const;
const PUBLIC = { auth: false, permissions: [], lang: false } as const;

export const CHARACTER_ROUTES: MetaTable<CharacterRoutes> = {
  '/v2/characters': { ...CHAR, permissions: ['characters'], bulk: 'all', key: 'name' },
  '/v2/characters/:id': { ...CHAR, permissions: ['characters'] },
  '/v2/characters/:id/backstory': { ...CHAR, permissions: ['characters'] },
  '/v2/characters/:id/buildtabs': { ...CHAR, permissions: ['characters', 'builds'] },
  '/v2/characters/:id/buildtabs/active': { ...CHAR, permissions: ['characters', 'builds'] },
  '/v2/characters/:id/core': { ...CHAR, permissions: ['characters'] },
  '/v2/characters/:id/crafting': { ...CHAR, permissions: ['characters'] },
  // The wiki lists both; in practice either builds or inventories suffices.
  '/v2/characters/:id/equipment': { ...CHAR, permissions: ['characters', 'builds', 'inventories'] },
  '/v2/characters/:id/equipmenttabs': { ...CHAR, permissions: ['characters', 'builds'] },
  '/v2/characters/:id/equipmenttabs/active': { ...CHAR, permissions: ['characters', 'builds'] },
  '/v2/characters/:id/heropoints': { ...CHAR, permissions: ['characters', 'progression'] },
  '/v2/characters/:id/inventory': { ...CHAR, permissions: ['characters', 'inventories'] },
  '/v2/characters/:id/quests': { ...CHAR, permissions: ['characters', 'progression'] },
  '/v2/characters/:id/recipes': { ...CHAR, permissions: ['characters', 'inventories'] },
  '/v2/characters/:id/sab': { ...CHAR, permissions: ['characters'] },
  '/v2/characters/:id/training': { ...CHAR, permissions: ['characters', 'builds'] },

  // Works without a key too (id, name, tag, emblem only); a member's key with
  // `guilds` adds the rest. v2.json marks it auth, so the key is required here.
  // Public: id, name, tag, emblem. With a member's key: also level, motd, influence, etc.
  '/v2/guild/:id': { auth: 'optional', permissions: [], lang: false },
  // The remaining /v2/guild/:id/* routes also need the key's account to lead the guild.
  '/v2/guild/:id/log': GUILD,
  '/v2/guild/:id/members': GUILD,
  '/v2/guild/:id/ranks': GUILD,
  '/v2/guild/:id/stash': GUILD,
  '/v2/guild/:id/storage': GUILD,
  '/v2/guild/:id/teams': GUILD,
  '/v2/guild/:id/treasury': GUILD,
  '/v2/guild/:id/upgrades': GUILD,
  '/v2/guild/permissions': { ...PUBLIC, lang: true, bulk: 'all' },
  '/v2/guild/search': PUBLIC,
  '/v2/guild/upgrades': { ...PUBLIC, lang: true, bulk: 'all' },

  '/v2/backstory/answers': { ...PUBLIC, lang: true, bulk: 'all' },
  '/v2/backstory/questions': { ...PUBLIC, lang: true, bulk: 'all' },

  '/v2/emblem': PUBLIC,
  '/v2/emblem/backgrounds': { ...PUBLIC, bulk: 'all' },
  '/v2/emblem/foregrounds': { ...PUBLIC, bulk: 'all' },
  '/v2/files': { ...PUBLIC, bulk: 'all' },
  '/v2/quaggans': { ...PUBLIC, bulk: 'all' },
  '/v2/logos': { ...PUBLIC, bulk: 'all' },
  '/v2/build': PUBLIC,
};
