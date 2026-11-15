import type { MetaTable, RouteMeta } from '../spec.js';
import { ACCOUNT_ROUTES, type AccountRoutes } from './account.js';
import { CHARACTER_ROUTES, type CharacterRoutes } from './characters.js';
import { COMPETITIVE_ROUTES, type CompetitiveRoutes } from './competitive.js';
import { CONTENT_ROUTES, type ContentRoutes } from './content.js';
import { ECONOMY_ROUTES, type EconomyRoutes } from './economy.js';

/** Every /v2 route the client knows, keyed by v2.json template. */
export interface Routes extends AccountRoutes, CharacterRoutes, EconomyRoutes, ContentRoutes, CompetitiveRoutes {}

export type Route = keyof Routes & string;

export const ROUTES: MetaTable<Routes> = {
  ...ACCOUNT_ROUTES,
  ...CHARACTER_ROUTES,
  ...ECONOMY_ROUTES,
  ...CONTENT_ROUTES,
  ...COMPETITIVE_ROUTES,
};

/** Routes that accept `?ids=`. */
export type BulkRoute = { [K in Route]: Routes[K] extends { item: unknown } ? K : never }[Route];
/**
 * Bulk routes whose objects carry their id (in `id`, or the field named by
 * the spec's `key`), so results can be keyed by it. /v2/account/buildstorage
 * returns objects with no id at all; it works with `all()` only.
 */
export type KeyedBulkRoute = {
  [K in BulkRoute]: Routes[K] extends { item: { id: unknown } } | { key: string } ? K : never;
}[BulkRoute];
export type ResponseOf<R extends Route> = Routes[R]['response'];
export type ItemOf<R extends BulkRoute> = Routes[R] extends { item: infer I } ? I : never;
export type IdOf<R extends BulkRoute> = Routes[R] extends { id: infer I extends number | string } ? I : never;

interface Compiled {
  route: Route;
  meta: RouteMeta;
  pattern: RegExp;
}

const COMPILED: Compiled[] = (Object.entries(ROUTES) as [Route, RouteMeta][])
  .map(([route, meta]) => ({
    route,
    meta,
    pattern: new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[a-z_]+/g, '[^/]+')}$`),
  }))
  // Prefer literal segments over params: /v2/guild/search before /v2/guild/:id.
  .sort((a, b) => (a.route.match(/:/g)?.length ?? 0) - (b.route.match(/:/g)?.length ?? 0));

/**
 * Find the route template for a concrete path such as
 * `/v2/characters/Ash Legion/core`. Returns undefined for unknown paths.
 */
export function matchRoute(path: string): { route: Route; meta: RouteMeta } | undefined {
  const hit = COMPILED.find((c) => c.pattern.test(path));
  if (hit) return { route: hit.route, meta: hit.meta };
  // `/v2/skills/123` or `/v2/characters/Name`: one object from a bulk route.
  const parent = path.replace(/\/[^/]+$/, '');
  const bulk = parent !== path ? COMPILED.find((c) => c.meta.bulk && c.pattern.test(parent)) : undefined;
  return bulk ? { route: bulk.route, meta: bulk.meta } : undefined;
}
