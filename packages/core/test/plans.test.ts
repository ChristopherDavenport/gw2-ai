import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listPlans, loadPlan, planExists, planPath, planSlug, plansDir, savePlan } from '../src/plans.js';
import { swordPlan } from './plan-fixture.js';

let dir: string;
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'gw2-plans-')), 'plans');
});
afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true });
});

describe('plan files', () => {
  it('lives under XDG_DATA_HOME', () => {
    expect(plansDir({ XDG_DATA_HOME: '/data' })).toBe(join('/data', 'gw2-ai', 'plans'));
    expect(plansDir({})).toMatch(/\.local[/\\]share[/\\]gw2-ai[/\\]plans$/);
  });

  it('round-trips and lists plans, leaving no temporary files', async () => {
    expect(await listPlans(dir)).toEqual([]);
    await savePlan('sword', swordPlan(), dir);
    await savePlan('sword', swordPlan(), dir);
    expect(await loadPlan('sword', dir)).toEqual(swordPlan());
    expect(await planExists('sword', dir)).toBe(true);
    expect(await planExists('shield', dir)).toBe(false);
    await writeFile(join(dir, 'broken.json'), '{');
    expect(await readdir(dir)).toEqual(['broken.json', 'sword.json']);
    const listed = await listPlans(dir);
    expect(listed.find((p) => p.name === 'sword')?.goals?.[0]?.name).toBe('Sword');
    expect(listed.find((p) => p.name === 'broken')).not.toHaveProperty('goal');
    await expect(loadPlan('broken', dir)).rejects.toThrow(/Can't read the plan file/);
    await expect(loadPlan('shield', dir)).rejects.toThrow(/No saved plan named "shield"/);
  });

  it('refuses names that are not slugs', async () => {
    for (const name of ['', '../etc', 'a/b', 'a\\b', '.hidden', 'A', 'a.json', 'a--b', '-a', 'x'.repeat(81)]) {
      expect(() => planPath(name, dir), name).toThrow(/is not a plan name/);
      await expect(savePlan(name, swordPlan(), dir)).rejects.toThrow(/is not a plan name/);
    }
  });

  it('makes a slug from any item name', () => {
    expect(planSlug("The Predator's Édge: Vol. 2")).toBe('the-predators-edge-vol-2');
    expect(planSlug('../..')).toBe('plan');
    expect(planPath(planSlug('x'.repeat(79) + ' y'), dir)).toContain('.json');
  });
});
