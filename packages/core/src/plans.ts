/// <reference types="node" />
/**
 * Crafting plans as JSON files, for the MCP servers. Node only, so it is the
 * `@gw2-ai/core/plans` subpath and not part of the index a browser bundles.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parsePlan, type CraftingPlan } from '@gw2kit/recipes';

type Env = Record<string, string | undefined>;

/** Lowercase words joined by hyphens: no separators or dots, so no path traversal. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 80;

/** `${XDG_DATA_HOME:-~/.local/share}/gw2-ai/plans` */
export function plansDir(env: Env = process.env): string {
  const base = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
  return join(base, 'gw2-ai', 'plans');
}

/** A plan name from free text such as the goal's name. */
export function planSlug(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ'’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_NAME)
    .replace(/^-+|-+$/g, '');
  return slug || 'plan';
}

/** The file for plan `name`. Throws for anything but a slug. */
export function planPath(name: string, dir = plansDir()): string {
  if (name.length > MAX_NAME || !NAME.test(name)) {
    throw new Error(`"${name}" is not a plan name: use up to ${MAX_NAME} lowercase letters and digits, joined by single hyphens.`);
  }
  return join(dir, `${name}.json`);
}

const isMissing = (err: unknown) => (err as { code?: string }).code === 'ENOENT';

export async function planExists(name: string, dir = plansDir()): Promise<boolean> {
  try {
    await stat(planPath(name, dir));
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

export async function loadPlan(name: string, dir = plansDir()): Promise<CraftingPlan> {
  const path = planPath(name, dir);
  let json: string;
  try {
    json = await readFile(path, 'utf8');
  } catch (err) {
    if (isMissing(err)) throw new Error(`No saved plan named "${name}" in ${dir}.`);
    throw err;
  }
  try {
    return parsePlan(json);
  } catch (err) {
    throw new Error(`Can't read the plan file ${path}: ${(err as Error).message}`);
  }
}

/** Write a plan, replacing any file of that name. Returns the path. */
export async function savePlan(name: string, plan: CraftingPlan, dir = plansDir()): Promise<string> {
  const path = planPath(name, dir);
  await mkdir(dir, { recursive: true });
  // Written beside the target and renamed, so a reader never sees half a plan.
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(plan));
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return path;
}

export interface SavedPlan {
  name: string;
  /** Absent when the file can't be read as a plan. */
  goals?: CraftingPlan['goals'];
  /** ISO time the file was last written. */
  updatedAt: string;
}

/** Saved plans, most recently written first. */
export async function listPlans(dir = plansDir()): Promise<SavedPlan[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const names = files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
  const plans = await Promise.all(
    names
      .filter((name) => name.length <= MAX_NAME && NAME.test(name))
      .map(async (name): Promise<SavedPlan> => {
        const updatedAt = (await stat(planPath(name, dir))).mtime.toISOString();
        const goals = await loadPlan(name, dir).then(
          (p) => p.goals,
          () => undefined,
        );
        return { name, updatedAt, ...(goals ? { goals } : {}) };
      }),
  );
  return plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
