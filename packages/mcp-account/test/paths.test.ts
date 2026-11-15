import { describe, expect, it } from 'vitest';
import { accountPath, checkParams, normalizeApiPath } from '../src/paths.js';

describe('accountPath', () => {
  it('accepts account endpoints and normalises them', () => {
    expect(accountPath('/v2/account/bank')).toBe('/v2/account/bank');
    expect(accountPath('account/wallet')).toBe('/v2/account/wallet');
    expect(accountPath('/v2/account')).toBe('/v2/account');
    expect(accountPath('/v2/characters/Some Name/inventory')).toBe('/v2/characters/Some%20Name/inventory');
    expect(accountPath('/v2/characters/Some%20Name')).toBe('/v2/characters/Some%20Name');
    expect(accountPath('/v2/commerce/delivery')).toBe('/v2/commerce/delivery');
    expect(accountPath('/v2/commerce/transactions/history/sells')).toBe('/v2/commerce/transactions/history/sells');
    expect(accountPath('/v2/pvp/stats')).toBe('/v2/pvp/stats');
    expect(accountPath('/v2/guild/ABC-123/stash')).toBe('/v2/guild/ABC-123/stash');
    expect(accountPath('/v2/account/bank/')).toBe('/v2/account/bank');
  });

  it('rejects endpoints outside the allowlist', () => {
    for (const p of ['/v2/items', '/v2/tokeninfo', '/v2/createsubtoken', '/v2/accounts', '/v2/commerce/prices', '/v2/commerce/deliveryx']) {
      expect(() => accountPath(p), p).toThrow(/not an account endpoint/);
    }
  });

  it('rejects traversal, URLs, query strings and control characters', () => {
    const bad = [
      '/v2/account/../tokeninfo',
      '/v2/account/%2e%2e/createsubtoken',
      '/v2/account/./bank',
      '/v2/characters/a%2Fb',
      'https://evil.example/v2/account',
      '//evil.example/v2/account',
      '/v2/account?access_token=x',
      '/v2/account#x',
      '/v2/account\\bank',
      '/v2/account/\nbank',
      '/v2//account',
      '/v2/account/%zz',
    ];
    for (const p of bad) expect(() => accountPath(p), p).toThrow();
  });

  it('never lets callers set access_token or the schema version', () => {
    expect(() => checkParams({ access_token: 'x' })).toThrow(/cannot be overridden/);
    expect(() => checkParams({ ACCESS_TOKEN: 'x' })).toThrow(/cannot be overridden/);
    expect(() => checkParams({ v: 'latest' })).toThrow(/cannot be overridden/);
    expect(() => checkParams({ 'a&b': 1 })).toThrow(/Invalid parameter/);
    expect(checkParams({ page: 0, page_size: 50 })).toEqual({ page: 0, page_size: 50 });
  });

  it('prefixes /v2 when missing', () => {
    expect(normalizeApiPath('characters')).toBe('/v2/characters');
  });
});
