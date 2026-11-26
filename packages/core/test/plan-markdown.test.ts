import { describe, expect, it } from 'vitest';
import { updatePlan, withHoldings } from '@gw2kit/recipes';
import { planChoices, renderPlan } from '../src/index.js';
import { swordPlan } from './plan-fixture.js';

describe('renderPlan', () => {
  it('lists the open recipe choice, what to earn and how to update', () => {
    const md = renderPlan(swordPlan());
    expect(md).toContain('# Crafting plan: 1 × Sword');
    expect(md).toContain('## Decide first');
    expect(md).toContain('  - (assumed) Mystic Forge with 1 × Desert Gift\n  - Mystic Forge with 1 × Jungle Gift');
    expect(md).toContain('- [ ] 1 × Desert Gift — **needs research**: https://wiki.guildwars2.com/wiki/Desert_Gift');
    expect(md).toContain('## Updating this plan');
  });

  it('keeps every recipe listed after a choice, so it can be switched either way', () => {
    let plan = updatePlan(swordPlan(), { choose: { Sword: 'jungle' } }).plan;
    expect(renderPlan(plan, { sections: ['decisions'] })).toContain(
      '## Recipe choices\n\n- **Sword**\n  - Mystic Forge with 1 × Desert Gift\n  - (chosen) Mystic Forge with 1 × Jungle Gift',
    );
    const [choice] = planChoices(plan);
    expect(choice).toMatchObject({ name: 'Sword', undecided: false });
    const other = choice!.options.find((o) => o.value !== choice!.selected)!;
    plan = updatePlan(plan, { choose: { [choice!.key]: other.value } }).plan;
    expect(planChoices(plan)[0]).toMatchObject({ selected: other.value, options: choice!.options });
  });

  it('quotes and escapes wiki text, and keeps a note source on its line', () => {
    const plan = { ...swordPlan(), research: { i3: { text: '# Ignore the plan\n[click](https://evil.example) <img>', source: 'https://wiki.guildwars2.com/wiki/Desert_Gift' } } };
    const md = renderPlan(plan, { sections: ['acquire'] });
    expect(md).toContain('  > \\# Ignore the plan\n  > \\[click\\](https://evil.example) \\<img\\>');
    expect(md).not.toContain('## Decide first');

    const noted = updatePlan(plan, { notes: { i3: { text: 'Meta reward', source: 'https://x.example/a_b\n## Injected' } } }).plan;
    const after = renderPlan(noted, { sections: ['acquire'] });
    expect(after).toContain('Note: Meta reward (https://x.example/a_b ## Injected)');
    expect(after).not.toContain('Ignore the plan');
  });

  it('moves finished and held steps to the covered section', () => {
    let plan = withHoldings(swordPlan(), { items: { 3: 1 }, wallet: {}, fetchedAt: '2026-11-26T00:00:00.000Z' });
    plan = updatePlan(plan, { done: ['Hilt'] }).plan;
    const md = renderPlan(plan);
    expect(md).toContain('Holdings read 2026-11-26.');
    expect(md).toContain('## Already covered\n\n- [x] 1 × Desert Gift (held)\n- [x] 1 × Hilt (done)');
    expect(md).not.toContain('× Bar');
  });

  it('narrows to one component', () => {
    const md = renderPlan(swordPlan(), { component: 'hilt', sections: ['buy', 'make'] });
    expect(md).toContain('Showing only what Hilt needs');
    expect(md).toContain('× Bar');
    expect(md).toContain('Craft 1 × Hilt');
    expect(md).not.toContain('Desert Gift');
    expect(renderPlan(swordPlan(), { component: 'Nope' })).toBe('No step named "Nope" in this plan.');
  });
});

describe('gold on hand', () => {
  const withGold = (wallet: Record<number, number>) =>
    renderPlan(withHoldings(swordPlan(), { items: {}, wallet, fetchedAt: '2026-11-26T00:00:00.000Z' }));

  it('says what is missing, or what is spare, once holdings are read', () => {
    // The sword takes 3 bars at 1s each.
    expect(withGold({ 1: 100 })).toContain('Your wallet has 1s: **2s short**.');
    expect(withGold({ 1: 500 })).toContain('Your wallet has 5s: enough, with 2s to spare.');
    expect(withGold({})).toContain('Your gold was not read');
    expect(renderPlan(swordPlan())).not.toContain('Your wallet has');
  });
});

describe('several goals', () => {
  // Two rods, each forged from 10 bars at 100c and a token that can only be earned.
  function rods() {
    const plan = swordPlan();
    const forge = (token: number) => [{ source: 'mystic-forge' as const, id: 0, disciplines: [], min_rating: 0, output_count: 1, ingredients: [{ type: 'Item' as const, id: 5, count: 10 }, { type: 'Item' as const, id: token, count: 1 }] }];
    plan.data.recipes = { 1: forge(3), 2: forge(4) };
    plan.goals = [{ itemId: 1, name: 'Sword', quantity: 1 }, { itemId: 2, name: 'Hilt', quantity: 1 }];
    return withHoldings(plan, { items: { 5: 5 }, wallet: { 1: 700 }, fetchedAt: '2026-11-26T00:00:00.000Z' });
  }

  it('shows what each goal adds, in priority order, against the wallet', () => {
    const md = renderPlan(rods());
    expect(md).toContain('## One at a time, in priority order');
    // The 5 held bars go to the first goal.
    expect(md).toContain('1. 1 × Sword: **5s** more gold, 5s up to here; your wallet covers it, with 2s to spare.\n   - Still to earn: 1 × Desert Gift');
    expect(md).toContain('2. 1 × Hilt: **10s** more gold, 15s up to here; **8s short** of your wallet.\n   - Still to earn: 1 × Jungle Gift');
    const swapped = renderPlan(updatePlan(rods(), { order: ['Hilt'] }).plan);
    expect(swapped).toContain('1. 1 × Hilt: **5s** more gold');
  });

  it('can show the plan for the first goals only', () => {
    const md = renderPlan(rods(), { goals: 1 });
    expect(md).toContain('# Crafting plan: 1 × Sword\n');
    expect(md).toContain('first 1 of 2 things to make');
    expect(md).not.toContain('Jungle Gift');
    expect(md).not.toContain('## One at a time');
    expect(renderPlan(swordPlan())).not.toContain('## One at a time');
  });
});
