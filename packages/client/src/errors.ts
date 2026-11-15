/**
 * Error from the GW2 API. The message is built from the path only, never the
 * full URL, so the access token (sent as a query parameter) can't leak into
 * logs.
 */
export class Gw2ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly text: string,
  ) {
    super(`GW2 API ${status} on ${path}: ${text}`);
    this.name = 'Gw2ApiError';
  }

  /** The key is missing, invalid, or lacks a permission. */
  get isAuthError(): boolean {
    // A malformed or revoked key comes back as 400 "invalid key".
    return this.status === 401 || this.status === 403 || (this.status === 400 && /key|token/i.test(this.text));
  }
}
