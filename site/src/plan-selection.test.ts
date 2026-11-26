import { describe, expect, it } from 'vitest';
import { addToSelection, iconUrl } from './plan-selection.js';

const exordium = { itemId: 90551, name: 'Exordium', quantity: 1 };
const weight = { itemId: 95612, name: "Aurene's Weight", quantity: 2 };

describe('addToSelection', () => {
  it('appends new items and sums repeats, keeping order', () => {
    const both = addToSelection(addToSelection([], exordium), weight);
    expect(both).toEqual([exordium, weight]);
    expect(addToSelection(both, { ...exordium, quantity: 3 })).toEqual([{ ...exordium, quantity: 4 }, weight]);
  });
  it('refuses more of one item than a plan makes, leaving the list alone', () => {
    const list = [{ ...exordium, quantity: 10_000 }];
    expect(() => addToSelection(list, exordium)).toThrow('at most 10000');
    expect(list[0]!.quantity).toBe(10_000);
  });
});

describe('iconUrl', () => {
  it('accepts the render service', () => {
    const url = 'https://render.guildwars2.com/file/ABC/123.png';
    expect(iconUrl(url)).toBe(url);
  });
  it('refuses anything else', () => {
    for (const value of [
      undefined,
      42,
      '',
      '/file/a.png',
      'http://render.guildwars2.com/a.png',
      'https://render.guildwars2.com.example.com/a.png',
      'https://example.com/https://render.guildwars2.com/a.png',
      'https://user@render.guildwars2.com/a.png',
      'https://render.guildwars2.com:8443/a.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
    ]) {
      expect(iconUrl(value)).toBeUndefined();
    }
  });
});
