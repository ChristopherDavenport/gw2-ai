import { ALL_PERMISSIONS, Gw2ApiError, Gw2Client, PERMISSION_HELP, looksLikeApiKey, type TokenInfo } from '@gw2-ai/client';
import { APPLICATIONS_URL, saveApiKey } from './key.js';

/**
 * Read one line from stdin without echoing it. Uses raw mode on a TTY;
 * piped input (`gw2-mcp-account set-key < keyfile`) is read as-is.
 */
export function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk: string) => (data += chunk));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0]?.trim() ?? ''));
      stdin.on('error', reject);
    });
  }

  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  let buf = '';
  return new Promise((resolve, reject) => {
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          finish();
          // Drop bracketed-paste markers if the terminal sent them.
          resolve(buf.replace(/\[20[01]~/g, '').trim());
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** `gw2-mcp-account set-key`: validate a key and store it. Returns an exit code. */
export async function setKeyCommand(): Promise<number> {
  let key: string;
  try {
    key = await readSecret(`Paste your GW2 API key from ${APPLICATIONS_URL} (input hidden), then press Enter: `);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 130;
  }
  if (!key) {
    process.stderr.write('No key entered; nothing saved.\n');
    return 1;
  }
  if (!looksLikeApiKey(key)) {
    process.stderr.write('That does not look like a GW2 API key (8-4-4-4-20-4-4-4-12 hex) or subtoken; nothing saved.\n');
    return 1;
  }

  let info: TokenInfo;
  try {
    info = await new Gw2Client({ apiKey: key }).get('/v2/tokeninfo');
  } catch (err) {
    const reason =
      err instanceof Gw2ApiError && err.isAuthError
        ? 'the API rejected the key (wrong, deleted, or expired)'
        : err instanceof Error
          ? err.message
          : String(err);
    process.stderr.write(`Could not verify the key: ${reason}. Nothing saved.\n`);
    return 1;
  }

  const path = await saveApiKey(key);
  const missing = ALL_PERMISSIONS.filter((p) => !info.permissions.includes(p));
  const lines = [
    `Saved API key "${info.name}" to ${path} (mode 600).`,
    `Permissions: ${info.permissions.join(', ') || 'none'}.`,
  ];
  if (missing.length) {
    lines.push(`Missing (some tools will be limited): ${missing.map((p) => `${p} (${PERMISSION_HELP[p]})`).join('; ')}.`);
  }
  lines.push('The gw2-account MCP server reads the key on each call; no restart needed.');
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}
