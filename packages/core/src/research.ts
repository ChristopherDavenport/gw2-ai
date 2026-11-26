import { mapLimit } from '@gw2kit/client';
import { solvePlan, type CraftingPlan, type PlanResearch, type PlanStep, type StepKey } from '@gw2kit/recipes';
import type { WikiClient } from '@gw2kit/wiki';

const INTRO_CHARS = 300;
const EXCERPT_CHARS = 900;
/** Sources whose intro is added, to say where they are and what opens them. */
const FOLLOWED_SOURCES = 3;
/** Acquisition subsections that name ways other than vendors and recipes. */
const OTHER_SOURCES = /^(Gathered from|Contained in|Rewarded by|Salvaged from)\b/im;

const untradeable = (step: PlanStep) => step.route?.action !== 'buy' && !step.options.some((o) => o.action === 'buy');

/** Open items with no known route that nobody has written a note about yet. */
export const needsResearch = (step: PlanStep): boolean =>
  step.count > 0 && step.action === 'earn' && step.kind === 'Item' && !step.note && untradeable(step);

/**
 * Vendor items that can't be bought from players: the wiki may list drops or
 * containers the recipe graph can't see (Noxious Pods in Dragon's Stand).
 */
const mayHaveOtherSources = (step: PlanStep): boolean =>
  step.count > 0 && step.action === 'vendor' && step.kind === 'Item' && !step.note && untradeable(step);

async function excerpt(wiki: WikiClient, step: PlanStep, always: boolean): Promise<PlanResearch | 'none' | undefined> {
  // Vendor offers are already in the graph, and their tables would crowd out the rest.
  const [intro, section] = await Promise.all([
    wiki.page(step.name, { intro: true, maxChars: INTRO_CHARS }),
    wiki.section(step.name, 'Acquisition', { maxChars: EXCERPT_CHARS, omit: ['Sold by'] }),
  ]);
  if (!always && !(section && OTHER_SOURCES.test(section.text))) return 'none';
  const source = section?.url ?? intro?.url;
  const parts = [intro?.text, section?.text];

  const gathered = /^Gathered from\n((?:- .*(?:\n|$))+)/m.exec(section?.text ?? '')?.[1] ?? '';
  const listed = gathered
    .split('\n')
    .map((line) => line.replace(/^- /, '').replace(/ \(.*/, '').trim())
    .filter(Boolean);
  // A chest is often listed once per drop quantity.
  const names = [...new Set(listed)].slice(0, FOLLOWED_SOURCES);
  for (const name of names) {
    const about = await wiki.page(name, { intro: true, maxChars: INTRO_CHARS }).catch(() => null);
    if (about?.text) parts.push(`About ${name}: ${about.text.split('\n')[0]}`);
  }
  const text = parts.filter(Boolean).join('\n');
  return text && source ? { text, source } : undefined;
}

/**
 * Add wiki intros and Acquisition text to steps, by default those with no
 * known route, and untradeable vendor items the wiki lists other sources for.
 * `only` names steps to look up instead, whatever their route (e.g. `Mystic
 * Coin`). A browser can run this: the excerpts go into the plan's markdown, so
 * a model without tools can write the notes.
 */
export async function researchPlan(
  plan: CraftingPlan,
  wiki: WikiClient,
  options: { only?: readonly string[] } = {},
): Promise<{ plan: CraftingPlan; failed: string[] }> {
  const only = options.only?.map((n) => n.trim().toLowerCase());
  const steps = solvePlan(plan).steps.filter((s) =>
    only ? only.includes(s.name.toLowerCase()) || only.includes(s.key) : (needsResearch(s) || mayHaveOtherSources(s)) && !s.research,
  );
  const found: Record<StepKey, PlanResearch> = {};
  const failed: string[] = [];
  await mapLimit(steps, 3, async (step) => {
    try {
      const result = await excerpt(wiki, step, only !== undefined || needsResearch(step));
      if (result === undefined) failed.push(step.name);
      else if (result !== 'none') found[step.key] = result;
    } catch {
      failed.push(step.name);
    }
  });
  for (const name of only ?? []) {
    if (!steps.some((s) => s.name.toLowerCase() === name || s.key === name)) failed.push(name);
  }
  return { plan: { ...plan, research: { ...plan.research, ...found } }, failed: failed.sort() };
}
