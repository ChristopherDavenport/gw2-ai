import { describe, expect, it } from 'vitest';
import { parseGoal, parsePlanUpdate } from './plan-input.js';

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
