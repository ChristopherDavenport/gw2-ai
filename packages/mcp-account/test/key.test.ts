import { mkdtemp, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keyFilePath, loadApiKey, saveApiKey, unsafeKeyFile } from '../src/key.js';

const KEY = '00000000-0000-0000-0000-00000000000000000000-0000-0000-0000-000000000000';
const posix = process.platform !== 'win32';

describe('unsafeKeyFile', () => {
  const uid = 1000;
  it('accepts 0600 and 0400 owned by the user', () => {
    expect(unsafeKeyFile({ mode: 0o100600, uid }, '/k', 'linux', uid)).toBeUndefined();
    expect(unsafeKeyFile({ mode: 0o100400, uid }, '/k', 'linux', uid)).toBeUndefined();
  });
  it('rejects any group or other bits', () => {
    for (const mode of [0o644, 0o640, 0o604, 0o660, 0o610, 0o601, 0o777]) {
      expect(unsafeKeyFile({ mode: 0o100000 | mode, uid }, '/k', 'linux', uid)).toMatch(/chmod 600/);
    }
  });
  it('rejects files owned by someone else', () => {
    expect(unsafeKeyFile({ mode: 0o100600, uid: 0 }, '/k', 'linux', uid)).toMatch(/another user/);
  });
  it('skips the check on Windows', () => {
    expect(unsafeKeyFile({ mode: 0o100666, uid: 0 }, '/k', 'win32', uid)).toBeUndefined();
  });
});

describe('loadApiKey / saveApiKey', () => {
  let dir: string;
  let env: Record<string, string | undefined>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gw2-ai-key-'));
    env = { XDG_CONFIG_HOME: dir };
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('uses XDG_CONFIG_HOME', () => {
    expect(keyFilePath(env)).toBe(join(dir, 'gw2-ai', 'api-key'));
  });

  it('prefers GW2_API_KEY', async () => {
    expect(await loadApiKey({ ...env, GW2_API_KEY: ` ${KEY} ` })).toEqual({ ok: true, key: KEY, source: 'env' });
  });

  it.runIf(posix)('treats an empty or blank GW2_API_KEY as unset and falls back to the file', async () => {
    const path = await saveApiKey(KEY, env);
    for (const blank of ['', '   ', '\n']) {
      expect(await loadApiKey({ ...env, GW2_API_KEY: blank })).toEqual({ ok: true, key: KEY, source: 'file', path });
    }
  });

  it('reports a missing key', async () => {
    expect(await loadApiKey(env)).toMatchObject({ ok: false, reason: 'missing' });
  });

  it.runIf(posix)('saves with mode 600 in a 700 directory and loads it back', async () => {
    const path = await saveApiKey(KEY, env);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'gw2-ai'))).mode & 0o777).toBe(0o700);
    expect(await loadApiKey(env)).toEqual({ ok: true, key: KEY, source: 'file', path });
  });

  it.runIf(posix)('refuses a group- or world-readable key file', async () => {
    const path = await saveApiKey(KEY, env);
    await chmod(path, 0o644);
    const load = await loadApiKey(env);
    expect(load).toMatchObject({ ok: false, reason: 'unsafe' });
    expect(JSON.stringify(load)).not.toContain(KEY);
  });

  it.runIf(posix)('rejects a file that does not hold a key', async () => {
    const path = await saveApiKey(KEY, env);
    await writeFile(path, 'not a key\n');
    expect(await loadApiKey(env)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
