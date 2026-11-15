import { ROUTES, type Route } from './routes/index.js';
import type { Permission } from './spec.js';

export const ALL_PERMISSIONS: readonly Permission[] = [
  'account',
  'builds',
  'characters',
  'guilds',
  'inventories',
  'progression',
  'pvp',
  'tradingpost',
  'unlocks',
  'wallet',
  'wvw',
];

export const PERMISSION_HELP: Record<Permission, string> = {
  account: 'account name, world, access, guild membership',
  builds: 'character equipment and build templates',
  characters: 'character list, levels, crafting',
  guilds: 'guild stash, treasury, log (guild leaders)',
  inventories: 'bank, material storage, shared and character inventories',
  progression: "achievements, masteries, dailies, raids, Wizard's Vault",
  pvp: 'PvP stats and games',
  tradingpost: 'trading post orders, history, delivery box',
  unlocks: 'skins, dyes, minis, recipes, legendary armory',
  wallet: 'currencies',
  wvw: 'WvW team and rank',
};

/** Permissions `route` needs that `granted` lacks (every key has `account`). */
export function missingPermissions(granted: readonly Permission[], route: Route): Permission[];
export function missingPermissions(granted: readonly Permission[], required: readonly Permission[]): Permission[];
export function missingPermissions(granted: readonly Permission[], need: Route | readonly Permission[]): Permission[] {
  const required = typeof need === 'string' ? ['account' as const, ...ROUTES[need].permissions] : need;
  const have = new Set(granted);
  return [...new Set(required)].filter((p) => !have.has(p));
}

/**
 * Loose shape check before a key is sent anywhere: an API key
 * (8-4-4-4-20-4-4-4-12 hex) or a subtoken (a JWT).
 */
export function looksLikeApiKey(key: string): boolean {
  const k = key.trim();
  return (
    /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{20}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/i.test(k) ||
    /^[\w-]+\.[\w-]+\.[\w-]+$/.test(k)
  );
}
