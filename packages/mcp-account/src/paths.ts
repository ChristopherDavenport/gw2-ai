/**
 * Normalise a user-supplied API path to `/v2/...` with each segment
 * percent-encoded. Rejects absolute URLs, query strings, fragments, dot
 * segments and control characters, so the result can only name a path on
 * api.guildwars2.com under /v2.
 */
export function normalizeApiPath(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('Path is empty.');
  if (raw.length > 300) throw new Error('Path is too long.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    throw new Error('Give a path such as /v2/account/bank, not a URL.');
  }
  if (/[?#\\]/.test(raw)) throw new Error('Put query parameters in `params`, not in the path.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error('Path contains control characters.');

  let segments = raw.replace(/^\/+/, '').split('/');
  if (segments[0] !== 'v2') segments = ['v2', ...segments];
  while (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();

  const encoded = segments.map((seg) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      throw new Error(`Bad percent-encoding in path segment "${seg}".`);
    }
    if (decoded === '' || decoded === '.' || decoded === '..') throw new Error('Path may not contain empty, "." or ".." segments.');
    if (/[/\\?#]/.test(decoded)) throw new Error('Path segments may not encode "/", "\\", "?" or "#".');
    return encodeURIComponent(decoded);
  });
  return '/' + encoded.join('/');
}

const ACCOUNT_PATHS: RegExp[] = [
  /^\/v2\/account(\/|$)/,
  /^\/v2\/characters(\/|$)/,
  /^\/v2\/commerce\/delivery$/,
  /^\/v2\/commerce\/transactions(\/|$)/,
  /^\/v2\/pvp(\/|$)/,
  /^\/v2\/guild\/[^/]+(\/|$)/,
];

export const ACCOUNT_PATH_HELP =
  '/v2/account/*, /v2/characters/*, /v2/commerce/delivery, /v2/commerce/transactions/*, /v2/pvp/*, /v2/guild/:id/*';

/** Normalise `input` and check it is an authenticated path this server may call. */
export function accountPath(input: string): string {
  const path = normalizeApiPath(input);
  if (!ACCOUNT_PATHS.some((re) => re.test(path))) {
    throw new Error(`${path} is not an account endpoint. Allowed: ${ACCOUNT_PATH_HELP}. Use gw2_api_get on gw2-data for public endpoints.`);
  }
  return path;
}

/** Query parameters a caller may pass through. The key is never accepted. */
export function checkParams(params: Record<string, string | number | boolean> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(k)) throw new Error(`Invalid parameter name "${k}".`);
    if (/^(access_token|v)$/i.test(k)) throw new Error(`Parameter "${k}" is set by the server and cannot be overridden.`);
    out[k] = v;
  }
  return out;
}

/**
 * JSON that reads well and stays small: an array puts one compact element
 * per line, an object one compact top-level field per line.
 */
export function compactJson(value: unknown): string {
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => JSON.stringify(v)).join(',\n')}\n]` : '[]';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return entries.length ? `{\n${entries.join(',\n')}\n}` : '{}';
  }
  return JSON.stringify(value);
}
