/**
 * Type-level description of the API. Each route is keyed by its template
 * from https://api.guildwars2.com/v2.json (e.g. `/v2/characters/:id/core`)
 * and described twice:
 *
 * - a {@link RouteSpec} in the `Routes` interface: response types, which the
 *   compiler uses to type every call;
 * - a {@link RouteMeta} in the runtime `ROUTES` table: auth, permissions,
 *   language support and bulk behaviour, which the client uses to build
 *   requests.
 *
 * `MetaTable<Routes>` ties the two together so a route cannot exist in one
 * and not the other, and bulk routes must declare how they batch.
 */

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

export interface RouteSpec {
  /** Response of `GET <route>` with no `ids`. For bulk routes, the id list. */
  response: unknown;
  /** Bulk routes only: one element of `GET <route>?ids=...`. */
  item?: unknown;
  /** Bulk routes only: the id type accepted by `?ids=`. */
  id?: number | string;
  /**
   * Bulk routes only: the field of `item` that holds its id, when it isn't
   * `id` (e.g. `name` for /v2/characters). Must match `RouteMeta.key`.
   */
  key?: string;
  /** Query parameters beyond ids/lang. Required keys make `query` required. */
  query?: object;
  /**
   * Narrower types for the template's `:params` (e.g. `{ team: 'red' | 'green' | 'blue' }`).
   * Params not listed accept `string | number`.
   */
  path?: object;
}

export interface RouteMeta {
  /**
   * `true`: needs an API key (`auth` in v2.json). `'optional'`: works without
   * one and returns more with one (e.g. /v2/guild/:id for members); the client
   * sends the key when it has one.
   */
  readonly auth: boolean | 'optional';
  /** Permissions the key needs, in addition to `account` which every key has. */
  readonly permissions: readonly Permission[];
  /** Accepts `?lang=`. */
  readonly lang: boolean;
  /**
   * How the route batches. `ids`: accepts `?ids=1,2,3` (max 200).
   * `all`: also accepts `?ids=all`. Absent: not a bulk route.
   */
  readonly bulk?: 'ids' | 'all';
  /** Data changes within minutes (prices, matches); cached briefly. */
  readonly live?: boolean;
  /** Bulk routes whose objects carry their id in a field other than `id`. */
  readonly key?: string;
}

/** Runtime metadata table that must cover exactly the routes in `R`. */
export type MetaTable<R> = {
  readonly [K in keyof R]: R[K] extends { item: unknown }
    ? RouteMeta & { readonly bulk: 'ids' | 'all' } & (R[K] extends { key: infer F } ? { readonly key: F } : { readonly key?: never })
    : RouteMeta & { readonly bulk?: never; readonly key?: never };
};

// ---------------------------------------------------------------------------
// Helpers over a routes interface. Exported so tests and consumers can name
// the types (e.g. `ItemOf<'/v2/items'>`).

/** Names of `:params` in a route template. */
export type ParamNames<S extends string> = S extends `${string}:${infer P}/${infer Rest}`
  ? P | ParamNames<`/${Rest}`>
  : S extends `${string}:${infer P}`
    ? P
    : never;

export type PathParams<S extends string> = { [K in ParamNames<S>]: string | number };

type PathArg<S extends string, Spec> = [ParamNames<S>] extends [never]
  ? object
  : { path: Spec extends { path: infer P } ? Omit<PathParams<S>, keyof P> & P : PathParams<S> };

type QueryArg<Spec> = Spec extends { query: infer Q }
  ? object extends Q
    ? { query?: Q }
    : { query: Q }
  : object;

export interface CallOptions {
  /** Cache lifetime in ms; 0 disables. Defaults depend on the route. */
  ttlMs?: number;
}

export type RequestArgs<S extends string, Spec> = PathArg<S, Spec> & QueryArg<Spec> & CallOptions;

/** Makes the options argument optional only when nothing in it is required. */
export type ArgsTuple<S extends string, Spec> =
  object extends RequestArgs<S, Spec> ? [args?: RequestArgs<S, Spec>] : [args: RequestArgs<S, Spec>];
