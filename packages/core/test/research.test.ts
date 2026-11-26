import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@gw2kit/client';
import { updatePlan, type CraftingPlan } from '@gw2kit/recipes';
import { WikiClient } from '@gw2kit/wiki';
import { renderPlan, researchPlan } from '../src/index.js';
import { swordPlan } from './plan-fixture.js';

/** Pages by title: an HTML Acquisition section, and an intro naming the page. */
function wiki(sections: Record<string, string>) {
  const fetch = (async (input: URL | string) => {
    const q = new URL(String(input)).searchParams;
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    const title = q.get('titles') ?? q.get('page')!;
    if (q.get('action') === 'query') return ok({ query: { pages: { 1: { title, extract: `${title} intro.\nMore.` } } } });
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
    expect(plan.research?.i3?.text).toBe(
      'Desert Gift intro.\nMore.\nAcquisition\nGathered from\n- Noxious Pod (chance)\nAbout Noxious Pod: Noxious Pod intro.',
    );
    expect(renderPlan(plan, { sections: ['vendor'] })).toContain('> - Noxious Pod (chance)');
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
