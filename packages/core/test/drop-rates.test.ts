import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain script without types, used by sync-currency-paths.mjs.
import { parseDropRates } from '../../../scripts/drop-rates.mjs';

const parse = parseDropRates as (
  text: string,
) => { sample: number; rejected: number; yields: [string, number][] } | undefined;

describe('parseDropRates', () => {
  it('adds up contributors, by column alias, and rejects rows that do not fit', () => {
    const page = `
{{SDRH | class = item | size = 40
  | Large Bone | s1 = Bone
  | Large Claw
}}
{{SDRL | Total = 100 | Bone = 300 | Large Claw = 200 | [[User:A|A]] ([[User talk:A|talk]]) }}
{{SDRL | Total = 50 | Bone = 140 | Large Claw = 110 | ~~~~ }}
{{SDRL | Total = 40 | Bone = 900 | Large Claw = 80 | typo }}
{{SDRL | Total = 40 | Bone = 100 | Totem = 80 | unknown column }}
<!--{{SDRL | Total = 999 | Bone = 1 | Large Claw = 1 }}-->
{{SDRF}}`;
    expect(parse(page)).toEqual({ sample: 150, rejected: 2, yields: [['Large Bone', 440 / 150], ['Large Claw', 310 / 150]] });
  });

  it('reads one line per container opened', () => {
    const page = `{{Individual contents header}}
{| {{STDT}}
|-
! colspan="3" | [[Box]] !! by !! sig
|-
| 23 {{item icon|Green Wood Log}} || 16 {{item icon|Wool Scrap}} || {{item icon|Barb}}
| || {{coin|0}} || {{e}}80 || A 2021-04-19
|-
| 21 {{item icon|Wool Scrap}}
| || {{coin|0}} || A
|}`;
    expect(parse(page)).toEqual({
      sample: 2,
      rejected: 0,
      yields: [['Green Wood Log', 11.5], ['Wool Scrap', 18.5], ['Barb', 0.5]],
    });
  });

  it('returns nothing for a page in neither layout', () => {
    expect(parse('== Drop rate ==\nAbout half of the time.')).toBeUndefined();
  });
});
