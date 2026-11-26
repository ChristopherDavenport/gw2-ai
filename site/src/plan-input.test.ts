import { describe, expect, it } from 'vitest';
import { parseGoal, parseGoalRows, parsePlanUpdate } from './plan-input.js';

describe('parseGoal', () => {
  it('reads ids and names', () => {
    expect(parseGoal(' 90551 ')).toEqual({ id: 90551 });
    expect(parseGoal('  Gift  of Mastery ')).toEqual({ name: 'Gift of Mastery' });
  });
  it('rejects empty input and id 0', () => {
    expect(parseGoal('   ')).toBeUndefined();
    expect(parseGoal('0')).toBeUndefined();
  });
});

describe('parseGoalRows', () => {
  it('keeps one item per row, apostrophes and commas included, and skips blank rows', () => {
    const rows = [
      { item: 'Exordium', quantity: '1' },
      { item: '  ', quantity: '' },
      { item: 'Aurene\u2019s Weight', quantity: '2' },
      { item: 'Strawberry, Cilantro Cheesecake', quantity: '3' },
      { item: '19721', quantity: '4' },
    ];
    expect(parseGoalRows(rows)).toMatchObject({
      goals: [
        { goal: { name: 'Exordium' }, quantity: 1 },
        { goal: { name: "Aurene's Weight" }, quantity: 2 },
        { goal: { name: 'Strawberry, Cilantro Cheesecake' }, quantity: 3 },
        { goal: { id: 19721 }, quantity: 4 },
      ],
    });
  });
  it('points at the row and field that is wrong', () => {
    expect(parseGoalRows([{ item: '', quantity: '1' }])).toMatchObject({ row: 0, field: 'item' });
    expect(parseGoalRows([{ item: 'a', quantity: '1' }, { item: '0', quantity: '1' }])).toMatchObject({ row: 1, field: 'item' });
    for (const quantity of ['', '0', '1.5', '10001']) {
      expect(parseGoalRows([{ item: 'a', quantity }])).toMatchObject({ row: 0, field: 'quantity' });
    }
  });
});

describe('parsePlanUpdate', () => {
  const json = '{ "choose": { "Gift": "buy" }, "done": ["i1"] }';
  const expected = { choose: { Gift: 'buy' }, done: ['i1'] };

  it('accepts a bare object', () => {
    expect(parsePlanUpdate(json)).toEqual(expected);
  });
  it('finds a fenced block inside prose, tagged json or not', () => {
    expect(parsePlanUpdate(`Sure! Here you go:\r\n\r\n\`\`\`json\r\n${json}\r\n\`\`\`\r\nEnjoy.`)).toEqual(expected);
    expect(parsePlanUpdate(`Update:\n\`\`\`\n${json}\n\`\`\``)).toEqual(expected);
  });
  it('reads new quantities, 0 included', () => {
    expect(parsePlanUpdate('{"quantities":{"Exordium":0,"Aurene\'s Weight":2}}')).toEqual({
      quantities: { Exordium: 0, "Aurene's Weight": 2 },
    });
  });
  it('skips blocks in other languages', () => {
    expect(parsePlanUpdate(`\`\`\`text\nhi\n\`\`\`\n\n\`\`\`json\n${json}\n\`\`\``)).toEqual(expected);
  });
  it('keeps only known note fields, on one line, and allows null', () => {
    const update = parsePlanUpdate('{"notes":{"a":{"text":"t","source":"x\\n## y","gate":"","extra":1},"b":null},"choose":{"c":null}}');
    expect(update).toEqual({ notes: { a: { text: 't', source: 'x ## y' }, b: null }, choose: { c: null } });
  });
  it.each([
    ['', /first/],
    ['no json here', /No JSON update/],
    ['{ "done": [', /doesn't parse/],
    ['```json\n{ oops }\n```', /doesn't parse/],
    [`\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``, /Found 2/],
    ['[1]', /No JSON update/],
    ['{}', /empty/],
    ['{"done":[]}', /empty/],
    ['{"chose":{}}', /Unknown field "chose"/],
    ['{"quantities":["a"]}', /"quantities" must be/],
    ['{"quantities":{"a":-1}}', /quantity of "a"/],
    ['{"quantities":{"a":1.5}}', /quantity of "a"/],
    ['{"quantities":{"a":"2"}}', /quantity of "a"/],
    ['{"quantities":{}}', /empty/],
    ['{"choose":["a"]}', /"choose" must be/],
    ['{"choose":{"a":1}}', /choice for "a"/],
    ['{"done":"a"}', /"done" must be/],
    ['{"undone":[1]}', /"undone" must be/],
    ['{"notes":{"a":"text"}}', /needs a "text"/],
    ['{"notes":{"a":{"text":"t","gate":1}}}', /"gate"/],
  ])('rejects %j', (input, message) => {
    expect(() => parsePlanUpdate(input)).toThrow(message);
  });
});
