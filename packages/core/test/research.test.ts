import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@gw2kit/client';
import { parsePlan, updatePlan, type CraftingPlan } from '@gw2kit/recipes';
import { WikiClient } from '@gw2kit/wiki';
import { renderPlan, researchPlan, parseSources } from '../src/index.js';
import { swordPlan } from './plan-fixture.js';

/** Pages by title: an HTML Acquisition section, and an intro naming the page. */
function wiki(sections: Record<string, string>) {
  const fetch = (async (input: URL | string) => {
    const q = new URL(String(input)).searchParams;
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    const title = q.get('titles') ?? q.get('page')!;
    if (q.get('action') === 'query') {
      return ok({ query: { pages: Object.fromEntries(title.split('|').map((t, i) => [i, { title: t, extract: `${t} intro.\nMore.` }])) } });
    }
    if (!(title in sections)) return ok({ error: { info: "The page you specified doesn't exist." } });
    if (q.get('prop') === 'sections') return ok({ parse: { title, sections: [{ line: 'Acquisition', index: '1' }] } });
    return ok({ parse: { text: { '*': sections[title] } } });
  }) as typeof globalThis.fetch;
  return new WikiClient({ fetch, rateLimiter: new RateLimiter(1000, 60_000) });
}

/** The sword, with its Desert Gift sold by a vendor for Karma. */
function vendorPlan(): CraftingPlan {
  const plan = swordPlan();
  plan.data.currencies = { 2: 'Karma' };
  plan.data.vendors = {
    3: { url: 'https://wiki.guildwars2.com/wiki/Desert_Gift', offers: [{ quantity: 1, costs: [{ kind: 'Currency', id: 2, name: 'Karma', amount: 500 }], vendors: ['A'], caps: {} }] },
  };
  return plan;
}

describe('researchPlan', () => {
  it('adds other sources of an untradeable vendor item, naming what it is gathered from', async () => {
    const html = '<h2>Acquisition</h2><h3>Sold by</h3><ul><li>Vendor A</li></ul><h3>Gathered from</h3><ul><li>Noxious Pod (chance)</li></ul>';
    const { plan, failed } = await researchPlan(vendorPlan(), wiki({ 'Desert Gift': html }));
    expect(failed).toEqual([]);
    expect(plan.research?.i3?.text).toBe('Desert Gift intro.\nMore.\nAcquisition\nGathered from\n- Noxious Pod (chance)');
    expect(plan.research?.i3?.sources).toEqual([{ kind: 'gathered', name: 'Noxious Pod', detail: 'chance', about: 'Noxious Pod intro.' }]);
    expect(renderPlan(plan, { sections: ['vendor'] })).toContain('  - Collect on the map:\n    - Noxious Pod (chance): Noxious Pod intro.');
  });

  it('skips a vendor item with no other source, unless it is named', async () => {
    const pages = wiki({ 'Desert Gift': '<h2>Acquisition</h2><h3>Sold by</h3><ul><li>Vendor A</li></ul>' });
    const auto = await researchPlan(vendorPlan(), pages);
    expect(auto.plan.research).toEqual({});
    expect(auto.failed).toEqual([]);
    expect((await researchPlan(vendorPlan(), pages, { only: ['desert gift'] })).plan.research).toHaveProperty('i3');
  });

  it('looks up steps with no source once, and reports names it cannot match', async () => {
    const first = await researchPlan(swordPlan(), wiki({ 'Desert Gift': '<ul><li>A meta event</li></ul>' }));
    expect(first.plan.research?.i3?.text).toContain('- A meta event');
    const noted = updatePlan(first.plan, { notes: { 'Desert Gift': { text: 'Meta' } } }).plan;
    expect((await researchPlan(noted, wiki({}))).plan.research).toEqual(first.plan.research);
    expect((await researchPlan(swordPlan(), wiki({}), { only: ['Nothing'] })).failed).toEqual(['nothing']);
  });
});

describe('vendor requirements', () => {
  const row = (vendor: string, notes: string) => `<tr><td><a href="/wiki/${vendor}" title="${vendor}">${vendor}</a></td><td>${notes}</td></tr>`;
  const html = `<h2>Acquisition</h2><h3>Sold by</h3><table class="npc table"><tr><th>Vendor</th><th>Notes</th></tr>${[
    row('A', 'Requires the mastery Gliding. Limit 1 per day.'),
    row('B', 'Requires the festival Lunar New Year.'),
    row('C', 'Requires the renown heart.'),
    row('C', 'Limit 2 per week.'),
  ].join('')}</table>`;

  it('belong to a vendor, and only those of the vendors shown are printed', async () => {
    const { plan } = await researchPlan(vendorPlan(), wiki({ 'Desert Gift': html }));
    // C asks it on one of two offers only, so it can't be told which.
    expect(plan.research?.i3?.requires).toEqual([
      { vendor: 'A', text: 'Requires the mastery Gliding.' },
      { vendor: 'B', text: 'Requires the festival Lunar New Year.' },
    ]);
    const md = renderPlan(plan, { sections: ['vendor'] });
    expect(md).toContain('  - Vendor requirements: A: Requires the mastery Gliding.');
    expect(md).not.toContain('Lunar New Year');
  });

  it('are dropped from research saved without vendors', () => {
    const plan = vendorPlan();
    const old = { text: 't', source: 's', requires: ['Requires the festival Lunar New Year.'] };
    plan.research = { i3: old as unknown as NonNullable<CraftingPlan['research']>[string] };
    const md = renderPlan(parsePlan(JSON.stringify(plan)), { sections: ['vendor'] });
    expect(md).toContain('Desert Gift from A');
    expect(md).not.toContain('Requires');
  });
});

describe('parseSources', () => {
  it('lists map and container sources once each, with their odds', () => {
    const section = [
      'Acquisition',
      'Gathered from',
      '- Exalted Chest (chance)',
      '- Exalted Chest (5, 10) (chance)',
      '- Glorious Chest (Wyvern Matriarch) (1-11) (guaranteed)',
      'Contained in',
      "- Dragon's Stand: Hero's Choice Chest (choice)",
      'Rewarded by',
      '- Act 1',
    ].join('\n');
    expect(parseSources(section)).toEqual([
      { kind: 'gathered', name: 'Exalted Chest', detail: 'chance, 5, 10' },
      { kind: 'gathered', name: 'Glorious Chest (Wyvern Matriarch)', detail: '1-11, guaranteed' },
      { kind: 'contained', name: "Dragon's Stand: Hero's Choice Chest", detail: 'choice' },
    ]);
  });
});
