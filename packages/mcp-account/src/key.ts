import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { looksLikeApiKey } from '@gw2-ai/client';

export const KEY_ENV = 'GW2_API_KEY';
export const APPLICATIONS_URL = 'https://account.arena.net/applications';

type Env = Record<string, string | undefined>;

/** `${XDG_CONFIG_HOME:-~/.config}/gw2-ai/api-key` */
export function keyFilePath(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'gw2-ai', 'api-key');
}

/**
 * Why a key file with this mode/owner must not be read, or undefined when it
 * is safe: group/other permission bits must be clear and the file must belong
 * to the current user. Windows has no POSIX modes, so the check is skipped.
 */
export function unsafeKeyFile(
  info: { mode: number; uid: number },
  path: string,
  platform: NodeJS.Platform = process.platform,
  uid: number | undefined = process.getuid?.(),
): string | undefined {
  if (platform === 'win32') return undefined;
  if ((info.mode & 0o077) !== 0) {
    const mode = (info.mode & 0o777).toString(8).padStart(3, '0');
    return `Refusing to read the API key file ${path}: other users can access it (mode ${mode}). Run \`chmod 600 "${path}"\` and try again.`;
  }
  if (uid !== undefined && info.uid !== uid) {
    return `Refusing to read the API key file ${path}: it is owned by another user (uid ${info.uid}).`;
  }
  return undefined;
}

export type KeyLoad =
  | { ok: true; key: string; source: 'env' | 'file'; path?: string }
  | { ok: false; reason: 'missing' | 'unsafe' | 'invalid'; message: string };

export function setupHelp(): string {
  return [
    `To configure a key: create one at ${APPLICATIONS_URL} (tick the permissions you want; account, inventories, characters, builds, wallet, progression, unlocks and tradingpost cover every tool), then either:`,
    '',
    `- run \`gw2-mcp-account set-key\` in a terminal (from this repo: \`node packages/mcp-account/dist/index.js set-key\`). It reads the key without echoing it, checks it against the API and saves it to ${keyFilePath()} with mode 600. No restart needed; the key is read on every call.`,
    `- or set \`${KEY_ENV}\` in this MCP server's environment and restart it.`,
    '',
    'Do not paste the key into the chat.',
  ].join('\n');
}

/**
 * The key from $GW2_API_KEY, else from the key file. Read fresh on each call
 * so `set-key` takes effect without restarting the server.
 */
export async function loadApiKey(env: Env = process.env): Promise<KeyLoad> {
  const fromEnv = env[KEY_ENV]?.trim();
  if (fromEnv) {
    if (!looksLikeApiKey(fromEnv)) {
      return { ok: false, reason: 'invalid', message: `${KEY_ENV} is set but does not look like a GW2 API key or subtoken.` };
    }
    return { ok: true, key: fromEnv, source: 'env' };
  }

  const path = keyFilePath(env);
  let info;
  try {
    info = await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: 'missing', message: 'No Guild Wars 2 API key is configured, so account tools cannot run.' };
    }
    return { ok: false, reason: 'invalid', message: `Cannot read ${path}: ${(err as Error).message}` };
  }
  if (!info.isFile()) return { ok: false, reason: 'invalid', message: `${path} is not a regular file.` };
  const unsafe = unsafeKeyFile(info, path);
  if (unsafe) return { ok: false, reason: 'unsafe', message: unsafe };

  const key = (await readFile(path, 'utf8')).trim();
  if (!looksLikeApiKey(key)) {
    return { ok: false, reason: 'invalid', message: `${path} does not contain a valid-looking GW2 API key.` };
  }
  return { ok: true, key, source: 'file', path };
}

/** Write the key file atomically with mode 0600 inside a 0700 directory. */
export async function saveApiKey(key: string, env: Env = process.env): Promise<string> {
  const path = keyFilePath(env);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, `${key.trim()}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return path;
}
