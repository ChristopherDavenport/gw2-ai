import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { withStore } from './idb.js';
import {
  VAULT_DB,
  VAULT_STORE,
  clearSession,
  forgetKey,
  hasSavedKey,
  loadKey,
  saveKey,
  sessionApiKey,
  useForSession,
  type VaultRecord,
} from './vault.js';

const KEY = 'ABCDEF01-2345-6789-ABCD-EF0123456789ABCDEF01-2345-6789-ABCD-EF0123456789';

function readRecord(): Promise<VaultRecord | undefined> {
  return withStore<VaultRecord | undefined>(VAULT_DB, VAULT_STORE, 'readonly', (s) => s.get('apiKey'));
}

function writeRecord(record: VaultRecord): Promise<unknown> {
  return withStore(VAULT_DB, VAULT_STORE, 'readwrite', (s) => s.put(record, 'apiKey'));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  clearSession();
});

describe('vault', () => {
  it('has nothing saved initially', async () => {
    expect(await hasSavedKey()).toBe(false);
    expect(await loadKey()).toBeUndefined();
  });

  it('round-trips a key through encryption', async () => {
    await saveKey(`  ${KEY}\n`);
    expect(sessionApiKey()).toBe(KEY);
    clearSession();
    expect(sessionApiKey()).toBeUndefined();
    expect(await hasSavedKey()).toBe(true);
    expect(await loadKey()).toBe(KEY);
    expect(sessionApiKey()).toBe(KEY);
  });

  it('stores only ciphertext, an IV, and a non-extractable CryptoKey', async () => {
    await saveKey(KEY);
    const record = await readRecord();
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.cryptoKey).toBeInstanceOf(CryptoKey);
    expect(record.cryptoKey.extractable).toBe(false);
    expect(record.cryptoKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', record.cryptoKey)).rejects.toThrow();
    expect(record.iv.byteLength).toBe(12);

    // Neither the plaintext nor any recognisable chunk of it is in the stored record.
    const bytes = new TextDecoder('latin1').decode(record.ciphertext);
    expect(bytes).not.toContain(KEY);
    expect(bytes).not.toContain(KEY.slice(0, 8));
    expect(JSON.stringify(record)).not.toContain(KEY.slice(0, 8));
    // AES-GCM: ciphertext is plaintext length + 16-byte tag.
    expect(record.ciphertext.byteLength).toBe(KEY.length + 16);
  });

  it('uses a fresh key and IV on every save', async () => {
    await saveKey(KEY);
    const first = await readRecord();
    await saveKey(KEY);
    const second = await readRecord();
    expect(first && second).toBeTruthy();
    expect(Buffer.from(first!.iv).equals(Buffer.from(second!.iv))).toBe(false);
    expect(Buffer.from(first!.ciphertext).equals(Buffer.from(second!.ciphertext))).toBe(false);
    clearSession();
    expect(await loadKey()).toBe(KEY);
  });

  it('replaces the previous key', async () => {
    await saveKey(KEY);
    const other = KEY.replace('ABCDEF01', '11111111');
    await saveKey(other);
    clearSession();
    expect(await loadKey()).toBe(other);
  });

  it('refuses to decrypt a tampered record', async () => {
    await saveKey(KEY);
    const record = (await readRecord())!;
    const tampered = new Uint8Array(record.ciphertext.slice(0));
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await writeRecord({ ...record, ciphertext: tampered.buffer });
    clearSession();
    await expect(loadKey()).rejects.toThrow(/could not be decrypted/);
    expect(sessionApiKey()).toBeUndefined();
  });

  it('refuses to decrypt with a different CryptoKey', async () => {
    await saveKey(KEY);
    const record = (await readRecord())!;
    const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await writeRecord({ ...record, cryptoKey: otherKey });
    clearSession();
    await expect(loadKey()).rejects.toThrow(/could not be decrypted/);
  });

  it('forgets the stored record and the session copy', async () => {
    await saveKey(KEY);
    await forgetKey();
    expect(sessionApiKey()).toBeUndefined();
    expect(await hasSavedKey()).toBe(false);
    expect(await readRecord()).toBeUndefined();
    expect(await loadKey()).toBeUndefined();
  });

  it('can hold a key for the session without saving it', async () => {
    useForSession(KEY);
    expect(await loadKey()).toBe(KEY);
    expect(await hasSavedKey()).toBe(false);
  });

  it('rejects an empty key', async () => {
    await expect(saveKey('   ')).rejects.toThrow(/empty/);
    expect(await hasSavedKey()).toBe(false);
  });
});
