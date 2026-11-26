import { describe, expect, it } from 'vitest';
import { parseGold, parseKeep, unmatchedKeep } from './sales-input.js';

describe('parseKeep', () => {
  it('takes one name per line without splitting on commas or apostrophes', () => {
    expect(parseKeep(" Strawberry, Cilantro Cheesecake \r\n\nVial of  Powerful Blood\nAurene’s Weight\n19721\n")).toEqual([
      'Strawberry, Cilantro Cheesecake',
      'Vial of Powerful Blood',
      "Aurene's Weight",
      '19721',
    ]);
  });
});

describe('parseGold', () => {
  it('reads gold as copper', () => {
    expect(parseGold(' 100 ')).toBe(1_000_000);
    expect(parseGold('2.5')).toBe(25_000);
    expect(parseGold('.0001')).toBe(1);
    expect(parseGold('  ')).toBeUndefined();
  });
  it('rejects anything else', () => {
    for (const bad of ['0', '-1', '1e3', '1,000', 'ten', '1.00001', '9'.repeat(30)]) expect(parseGold(bad)).toBeNull();
  });
});

describe('unmatchedKeep', () => {
  it('lists entries that name nothing held', () => {
    const items = [{ id: 19721, name: 'Glob of Ectoplasm', count: 1, material: true, vendor: 0 }];
    expect(unmatchedKeep(['glob of ectoplasm', '19721', 'Mystic Coim'], items)).toEqual(['Mystic Coim']);
  });
});
