/**
 * Stores the GW2 API key encrypted at rest in IndexedDB.
 *
 * The AES-GCM key is generated as non-extractable, so its raw bytes never
 * reach JavaScript; IndexedDB stores the CryptoKey object itself (the browser
 * keeps the key material in its own storage). Next to it we store a fresh
 * random IV and the ciphertext. The plaintext API key lives only in a
 * module-scoped variable for the current page session.
 *
 * This keeps the key out of plain-text browser storage, sync, and backups.
 * It does not protect against script running on this page or someone using
 * this unlocked browser profile: both can ask the browser to decrypt.
 */
import { withStore } from './idb.js';

export const VAULT_DB = 'gw2-ai-vault';
export const VAULT_STORE = 'vault';
const RECORD_KEY = 'apiKey';

export interface VaultRecord {
  cryptoKey: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  savedAt: string;
}

let sessionKey: string | undefined;

/** Encrypt `apiKey` and store it, replacing any saved key. Also sets it for this session. */
export async function saveKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new Error('API key is empty');
  const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(key));
  const record: VaultRecord = { cryptoKey, iv, ciphertext, savedAt: new Date().toISOString() };
  await withStore(VAULT_DB, VAULT_STORE, 'readwrite', (s) => s.put(record, RECORD_KEY));
  sessionKey = key;
}

/**
 * The saved API key, decrypted. Returns the session copy if already loaded,
 * or undefined when nothing is saved. Throws if the stored record can't be
 * decrypted (corrupted or tampered with).
 */
export async function loadKey(): Promise<string | undefined> {
  if (sessionKey !== undefined) return sessionKey;
  const record = await withStore<VaultRecord | undefined>(VAULT_DB, VAULT_STORE, 'readonly', (s) => s.get(RECORD_KEY));
  if (!record) return undefined;
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, record.cryptoKey, record.ciphertext);
  } catch {
    throw new Error('The saved API key could not be decrypted. Forget it and enter it again.');
  }
  sessionKey = new TextDecoder().decode(plain);
  return sessionKey;
}

/** True if an encrypted key is saved in this browser. */
export async function hasSavedKey(): Promise<boolean> {
  const count = await withStore<number>(VAULT_DB, VAULT_STORE, 'readonly', (s) => s.count(RECORD_KEY));
  return (count ?? 0) > 0;
}

/** Use `apiKey` for this page session only, without saving it (e.g. when IndexedDB is unavailable). */
export function useForSession(apiKey: string): void {
  sessionKey = apiKey.trim() || undefined;
}

/** The decrypted key for this session, if loaded. */
export function sessionApiKey(): string | undefined {
  return sessionKey;
}

/** Drop the decrypted copy from memory; the encrypted record stays. */
export function clearSession(): void {
  sessionKey = undefined;
}

/** Delete the saved key (ciphertext, IV, and CryptoKey) and the session copy. */
export async function forgetKey(): Promise<void> {
  sessionKey = undefined;
  await withStore(VAULT_DB, VAULT_STORE, 'readwrite', (s) => s.clear());
}
