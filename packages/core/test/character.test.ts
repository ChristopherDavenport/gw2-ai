import { Gw2Client, RateLimiter } from '@gw2kit/client';
import { describe, expect, it } from 'vitest';
import { CharacterNotFoundError, buildReport, fetchCharacter, renderCharacter } from '../src/index.js';

const KEY = '00000000-0000-0000-0000-00000000000000000000-0000-0000-0000-000000000000';

const ITEMS: Record<number, { name: string; rarity: string; type?: string }> = {
  1000: { name: 'Zojja\'s Breastplate', rarity: 'Ascended' },
  1001: { name: 'Perfected Envoy Armor', rarity: 'Legendary' },
  2000: { name: 'Superior Rune of the Scholar', rarity: 'Exotic' },
  2001: { name: 'Superior Sigil of Force', rarity: 'Exotic' },
  3000: { name: 'Mighty +9 Agony Infusion', rarity: 'Ascended' },
  4000: { name: 'Unbound Magic Harvesting Sickle', rarity: 'Rare' },
};

const build = (name: string, spec: number) => ({
  name,
  profession: 'Guardian',
  specializations: [{ id: spec, traits: [1, 2, 3] }, { id: null, traits: [null, null, null] }],
  skills: { heal: 10, utilities: [11, null, 12], elite: 13 },
  aquatic_skills: { heal: null, utilities: [null, null, null], elite: null },
});

const coat = (id: number) => ({ id, slot: 'Coat', location: 'Equipped', stats: { id: 161, attributes: {} }, upgrades: [2000], infusions: [3000] });
const noPvp = { amulet: null, rune: null, sigils: [null, null, null, null] };

const ALICE = {
  name: 'Alice', race: 'Human', gender: 'Female', profession: 'Guardian', level: 80, age: 7200,
  created: '2020-01-01T00:00:00Z', deaths: 3, flags: [], backstory: [], crafting: [],
  build_tabs_unlocked: 3, active_build_tab: 2, equipment_tabs_unlocked: 3, active_equipment_tab: 1,
  build_tabs: [
    { tab: 1, is_active: false, build: build('Raid', 62) },
    { tab: 2, is_active: true, build: build('Open world', 42) },
    { tab: 3, is_active: false, build: build('Copy of raid', 62) },
  ],
  equipment_tabs: [
    { tab: 1, name: 'Power', is_active: true, equipment: [coat(1000)], equipment_pvp: noPvp },
    { tab: 2, name: 'Legendary', is_active: false, equipment: [{ ...coat(1001), location: 'LegendaryArmory' }],
      equipment_pvp: { amulet: 7, rune: 2000, sigils: [2001, null, null, null] } },
    { tab: 3, name: '', is_active: false, equipment: [coat(1000)], equipment_pvp: noPvp },
  ],
  equipment: [
    { ...coat(1000), tabs: [1, 3] },
    { id: 1001, slot: 'Coat', location: 'LegendaryArmory', tabs: [2] },
    { id: 4000, slot: 'Sickle', location: 'Equipped' },
  ],
};

function client(permissions: string[]) {
  const fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    const ok = (body: unknown) => new Response(JSON.stringify(body));
    switch (url.pathname) {
      case '/v2/tokeninfo':
        return ok({ id: 'x', name: 'test key', permissions });
      case '/v2/characters':
        return ok(['Alice']);
      case '/v2/characters/Alice':
        return ok(ALICE);
      case '/v2/items':
        return ok(ids.map(Number).filter((id) => ITEMS[id]).map((id) => ({ id, type: 'Armor', flags: [], details: {}, ...ITEMS[id] })));
      case '/v2/itemstats':
        return ok(ids.map((id) => ({ id: Number(id), name: 'Berserker\'s', attributes: [] })));
      case '/v2/specializations':
        return ok(ids.map((id) => ({ id: Number(id), name: id === '62' ? 'Firebrand' : 'Radiance', elite: id === '62' })));
      case '/v2/traits':
        return ok(ids.map((id) => ({ id: Number(id), name: `Trait ${id}` })));
      case '/v2/skills':
        return ok(ids.map((id) => ({ id: Number(id), name: `Skill ${id}` })));
      case '/v2/pvp/amulets':
        return ok(ids.map((id) => ({ id: Number(id), name: 'Berserker Amulet', icon: '', attributes: {} })));
      default:
        return new Response(JSON.stringify({ text: 'no such character' }), { status: 404 });
    }
  }) as typeof globalThis.fetch;
  return new Gw2Client({ apiKey: KEY, fetch, rateLimiter: new RateLimiter(10_000, 600_000), maxRetries: 0 });
}

const ALL = ['account', 'characters', 'builds', 'inventories'];

describe('renderCharacter', () => {
  it('shows every build and equipment template and marks the active ones', async () => {
    const c = client(ALL);
    const md = await renderCharacter(c, await fetchCharacter(c, 'Alice'), ALL);
    expect(md).toContain('- **Templates:** 3 build (active: 2), 3 equipment (active: 1) unlocked.');
    expect(md).toContain('## Build template 1: Raid\n');
    expect(md).toContain('## Build template 2: Open world (active)');
    expect(md).toContain('| Firebrand (elite) | 62 | Trait 1 / Trait 2 / Trait 3 | 1, 2, 3 |');
    expect(md).toContain('## Equipment template 1: Power (active)');
    expect(md).toContain('| Coat | Zojja\'s Breastplate | 1000 | Ascended | Berserker\'s | Superior Rune of the Scholar | Mighty +9 Agony Infusion |');
    expect(md).toContain('| Coat | Perfected Envoy Armor | 1001 | Legendary |');
    expect(md).toContain('- **PvP:** Amulet Berserker Amulet (7) · Rune Superior Rune of the Scholar · Sigils Superior Sigil of Force, —, —, —');
  });

  it('points identical templates at the first copy', async () => {
    const c = client(ALL);
    const md = await renderCharacter(c, await fetchCharacter(c, 'Alice'), ALL);
    expect(md).toContain('## Build template 3: Copy of raid\n\nSame build as build template 1.');
    expect(md).toContain('## Equipment template 3\n\nSame gear as equipment template 1.');
    // Underwater bar is empty, so it is left out.
    expect(md).not.toContain('Underwater skills');
  });

  it('lists gear outside the templates once', async () => {
    const c = client(ALL);
    const md = await renderCharacter(c, await fetchCharacter(c, 'Alice'), ALL);
    expect(md).toContain('## Other equipped gear (not in any template)');
    expect(md.match(/Unbound Magic Harvesting Sickle/g)).toHaveLength(1);
  });

  it('shows only the active templates when asked', async () => {
    const c = client(ALL);
    const md = await renderCharacter(c, await fetchCharacter(c, 'Alice'), ALL, { templates: 'active', headingLevel: 3 });
    expect(md).toContain('### Build template 2: Open world (active)');
    expect(md).toContain('### Equipment template 1: Power (active)');
    expect(md).not.toContain('Build template 1');
    expect(md).not.toContain('Equipment template 2');
    expect(md).toContain('only the active ones are shown');
  });

  it('names the permissions it lacks', async () => {
    const c = client(['account', 'characters']);
    const md = await renderCharacter(c, await fetchCharacter(c, 'Alice'), ['account', 'characters']);
    expect(md).toContain('the API key lacks `builds` (build and equipment templates) and `inventories` (bags)');
  });

  it('throws CharacterNotFoundError with the visible names', async () => {
    const err = await fetchCharacter(client(ALL), 'Bob').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CharacterNotFoundError);
    expect((err as CharacterNotFoundError).names).toEqual(['Alice']);
  });
});

describe('buildReport with characters', () => {
  it('adds a section per character and says which characters have gear', async () => {
    const report = await buildReport(client(ALL), { sections: [], characters: ['Alice', 'Bob'] });
    expect(report.sections.map((s) => [s.id, s.status])).toEqual([
      ['character:Alice', 'ok'],
      ['character:Bob', 'error'],
    ]);
    expect(report.markdown).toContain('## Character: Alice\n\n- **Profession:** Guardian');
    expect(report.markdown).toContain('### Build template 2: Open world (active)');
    expect(report.markdown).toContain('build templates and equipment templates are included only for Alice.');
    expect(report.sections[1]?.reason).toContain('No character named "Bob"');
  });

  it('skips characters without the characters permission', async () => {
    const report = await buildReport(client(['account']), { sections: [], characters: ['Alice'] });
    expect(report.sections[0]).toMatchObject({ status: 'skipped', reason: 'API key lacks permission: characters' });
    expect(report.markdown).toContain('build templates and equipment templates are not in this report');
  });
});
