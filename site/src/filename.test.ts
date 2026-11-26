import { describe, expect, it } from 'vitest';
import { planFilename, reportFilename } from './filename.js';

describe('reportFilename', () => {
  it('uses the account name and local date', () => {
    expect(reportFilename('Player.1234', new Date(2026, 0, 5))).toBe('gw2-Player.1234-2026-01-05.md');
  });
  it('makes unsafe names filename-safe', () => {
    expect(reportFilename('../a b/c', new Date(2026, 10, 15))).toBe('gw2-a-b-c-2026-11-15.md');
    expect(reportFilename('', new Date(2026, 10, 15))).toBe('gw2-account-2026-11-15.md');
  });
});

describe('planFilename', () => {
  const date = new Date(2026, 10, 15);
  it('names the goal and the date', () => {
    expect(planFilename('Exordium', date, 'md')).toBe('gw2-plan-Exordium-2026-11-15.md');
    expect(planFilename('Gift of Mastery', date, 'json')).toBe('gw2-plan-Gift-of-Mastery-2026-11-15.json');
  });
  it('makes unsafe and overlong names filename-safe', () => {
    expect(planFilename('../..', date, 'md')).toBe('gw2-plan-item-2026-11-15.md');
    expect(planFilename('x'.repeat(500), date, 'md')).toHaveLength('gw2-plan--2026-11-15.md'.length + 80);
  });
});
