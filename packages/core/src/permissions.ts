import type { Gw2Client } from './client.js';
import type { Permission, TokenInfo } from './types.js';

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
  progression: 'achievements, masteries, dailies, raids, Wizard\'s Vault',
  pvp: 'PvP stats and games',
  tradingpost: 'trading post orders, history, delivery box',
  unlocks: 'skins, dyes, minis, recipes, legendary armory',
  wallet: 'currencies',
  wvw: 'WvW team and rank',
};

export async function tokenInfo(c: Gw2Client): Promise<TokenInfo> {
  return c.get<TokenInfo>('/v2/tokeninfo', { ttlMs: 5 * 60 * 1000 });
}

/** Permissions from `required` that the key lacks. */
export function missingPermissions(info: TokenInfo, required: readonly Permission[]): Permission[] {
  const have = new Set(info.permissions);
  return required.filter((p) => !have.has(p));
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
