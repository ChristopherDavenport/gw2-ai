import type { MetaTable } from '../spec.js';
import type {
  Achievement,
  AchievementCategory,
  AchievementGroup,
  Continent,
  ContinentFloor,
  ContinentMap,
  ContinentPoi,
  ContinentRegion,
  ContinentSector,
  ContinentTask,
  DailyCrafting,
  Dungeon,
  GameMap,
  HomeCat,
  HomeNode,
  HomesteadDecoration,
  HomesteadDecorationCategory,
  HomesteadGlyph,
  Legend,
  MapChest,
  Mastery,
  Pet,
  ProfessionInfo,
  Quest,
  RaceInfo,
  Raid,
  Skill,
  Specialization,
  Story,
  StorySeason,
  Trait,
  WorldBoss,
} from '../types/content.js';
import type { Profession, Race } from '../types/common.js';

/**
 * Game content and mechanics: /v2/achievements*, /v2/masteries, /v2/professions,
 * /v2/specializations, /v2/traits, /v2/skills, /v2/legends, /v2/pets, /v2/races,
 * /v2/stories*, /v2/quests, /v2/raids, /v2/dungeons, /v2/worldbosses,
 * /v2/mapchests, /v2/dailycrafting, /v2/maps, /v2/continents*, /v2/home*,
 * /v2/homestead*.
 *
 * The /v2/continents/:id/floors... routes are not listed in v2.json; their
 * templates follow the API's URL structure.
 */
export interface ContentRoutes {
  '/v2/achievements': { response: number[]; item: Achievement; id: number };
  '/v2/achievements/categories': { response: number[]; item: AchievementCategory; id: number };
  '/v2/achievements/groups': { response: string[]; item: AchievementGroup; id: string };
  '/v2/masteries': { response: number[]; item: Mastery; id: number };
  '/v2/professions': { response: Profession[]; item: ProfessionInfo; id: Profession };
  '/v2/specializations': { response: number[]; item: Specialization; id: number };
  '/v2/traits': { response: number[]; item: Trait; id: number };
  '/v2/skills': { response: number[]; item: Skill; id: number };
  '/v2/legends': { response: string[]; item: Legend; id: string };
  '/v2/pets': { response: number[]; item: Pet; id: number };
  '/v2/races': { response: Race[]; item: RaceInfo; id: Race };
  '/v2/stories': { response: number[]; item: Story; id: number };
  '/v2/stories/seasons': { response: string[]; item: StorySeason; id: string };
  '/v2/quests': { response: number[]; item: Quest; id: number };
  '/v2/raids': { response: string[]; item: Raid; id: string };
  '/v2/dungeons': { response: string[]; item: Dungeon; id: string };
  '/v2/worldbosses': { response: string[]; item: WorldBoss; id: string };
  '/v2/mapchests': { response: string[]; item: MapChest; id: string };
  '/v2/dailycrafting': { response: string[]; item: DailyCrafting; id: string };
  '/v2/maps': { response: number[]; item: GameMap; id: number };
  '/v2/continents': { response: number[]; item: Continent; id: number };
  '/v2/continents/:id/floors': { response: number[]; item: ContinentFloor; id: number };
  '/v2/continents/:id/floors/:floor/regions': { response: number[]; item: ContinentRegion; id: number };
  '/v2/continents/:id/floors/:floor/regions/:region/maps': { response: number[]; item: ContinentMap; id: number };
  '/v2/continents/:id/floors/:floor/regions/:region/maps/:map/sectors': {
    response: number[];
    item: ContinentSector;
    id: number;
  };
  '/v2/continents/:id/floors/:floor/regions/:region/maps/:map/pois': { response: number[]; item: ContinentPoi; id: number };
  '/v2/continents/:id/floors/:floor/regions/:region/maps/:map/tasks': { response: number[]; item: ContinentTask; id: number };
  /** Sub-endpoint names (`cats`, `nodes`); `?ids=` returns the same strings. */
  '/v2/home': { response: string[] };
  '/v2/home/cats': { response: number[]; item: HomeCat; id: number };
  '/v2/home/nodes': { response: string[]; item: HomeNode; id: string };
  /** Sub-endpoint names (e.g. `glyphs`); `?ids=` returns the same strings. */
  '/v2/homestead': { response: string[] };
  '/v2/homestead/decorations': { response: number[]; item: HomesteadDecoration; id: number };
  '/v2/homestead/decorations/categories': { response: number[]; item: HomesteadDecorationCategory; id: number };
  '/v2/homestead/decorations/categories/:id': { response: HomesteadDecorationCategory };
  '/v2/homestead/glyphs': { response: string[]; item: HomesteadGlyph; id: string };
}

const pub = { auth: false, permissions: [] } as const;

export const CONTENT_ROUTES: MetaTable<ContentRoutes> = {
  '/v2/achievements': { ...pub, lang: true, bulk: 'ids' },
  '/v2/achievements/categories': { ...pub, lang: true, bulk: 'all' },
  '/v2/achievements/groups': { ...pub, lang: true, bulk: 'all' },
  '/v2/masteries': { ...pub, lang: true, bulk: 'all' },
  '/v2/professions': { ...pub, lang: true, bulk: 'all' },
  '/v2/specializations': { ...pub, lang: true, bulk: 'all' },
  '/v2/traits': { ...pub, lang: true, bulk: 'all' },
  '/v2/skills': { ...pub, lang: true, bulk: 'ids' },
  '/v2/legends': { ...pub, lang: false, bulk: 'all' },
  '/v2/pets': { ...pub, lang: true, bulk: 'all' },
  '/v2/races': { ...pub, lang: true, bulk: 'all' },
  '/v2/stories': { ...pub, lang: true, bulk: 'all' },
  '/v2/stories/seasons': { ...pub, lang: true, bulk: 'all' },
  '/v2/quests': { ...pub, lang: true, bulk: 'all' },
  '/v2/raids': { ...pub, lang: true, bulk: 'all' },
  '/v2/dungeons': { ...pub, lang: true, bulk: 'all' },
  '/v2/worldbosses': { ...pub, lang: true, bulk: 'all' },
  '/v2/mapchests': { ...pub, lang: true, bulk: 'all' },
  '/v2/dailycrafting': { ...pub, lang: true, bulk: 'all' },
  '/v2/maps': { ...pub, lang: true, bulk: 'ids' },
  '/v2/continents': { ...pub, lang: true, bulk: 'all' },
  '/v2/continents/:id/floors': { ...pub, lang: true, bulk: 'all' },
  '/v2/continents/:id/floors/:floor/regions': { ...pub, lang: true, bulk: 'all' },
  '/v2/continents/:id/floors/:floor/regions/:region/maps': { ...pub, lang: true, bulk: 'all' },
  '/v2/continents/:id/floors/:floor/regions/:region/maps/:map/sectors': { ...pub, lang: true, bulk: 'all' },
  '/v2/continents/:id/floors/:floor/regions/:region/maps/:map/pois': { ...pub, lang: true, bulk: 'all' },
  '/v2/continents/:id/floors/:floor/regions/:region/maps/:map/tasks': { ...pub, lang: true, bulk: 'all' },
  '/v2/home': { ...pub, lang: false },
  '/v2/home/cats': { ...pub, lang: true, bulk: 'all' },
  '/v2/home/nodes': { ...pub, lang: true, bulk: 'all' },
  '/v2/homestead': { ...pub, lang: false },
  '/v2/homestead/decorations': { ...pub, lang: true, bulk: 'ids' },
  '/v2/homestead/decorations/categories': { ...pub, lang: true, bulk: 'all' },
  '/v2/homestead/decorations/categories/:id': { ...pub, lang: true },
  '/v2/homestead/glyphs': { ...pub, lang: true, bulk: 'all' },
};
