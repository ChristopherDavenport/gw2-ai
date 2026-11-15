import { describe, expect, it } from 'vitest';
import { reportFilename } from './filename.js';

describe('reportFilename', () => {
  it('uses the account name and local date', () => {
    expect(reportFilename('Player.1234', new Date(2026, 0, 5))).toBe('gw2-Player.1234-2026-01-05.md');
  });
  it('makes unsafe names filename-safe', () => {
    expect(reportFilename('../a b/c', new Date(2026, 10, 15))).toBe('gw2-a-b-c-2026-11-15.md');
    expect(reportFilename('', new Date(2026, 10, 15))).toBe('gw2-account-2026-11-15.md');
  });
});
