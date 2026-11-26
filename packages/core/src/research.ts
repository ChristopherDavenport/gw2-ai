import { mapLimit } from '@gw2kit/client';
import { solvePlan, type CraftingPlan, type PlanResearch, type PlanSource, type PlanStep, type StepKey } from '@gw2kit/recipes';
import type { WikiClient } from '@gw2kit/wiki';

const INTRO_CHARS = 300;
const EXCERPT_CHARS = 900;
/** Enough for the whole Acquisition section: the lists run past the excerpt. */
const SECTION_CHARS = 20_000;
/** Map sources whose intro is read, to say where they are and what opens them. */
const DESCRIBED_SOURCES = 8;
/** Acquisition subsections that name ways other than vendors and recipes. */
const OTHER_SOURCES = /^(Gathered from|Contained in|Rewarded by|Salvaged from)\b/im;
const SOURCE_HEADINGS: Record<string, PlanSource['kind'] | null> = {
  'Gathered from': 'gathered',
  'Contained in': 'contained',
  'Rewarded by': null,
  'Salvaged from': null,
  Achievements: null,
  Recipe: null,
};
/** A quantity or odds in brackets at the end of a source line. */
const TRAILING_DETAIL = /\s*\(([\d\s,?-]+|chance|guaranteed|choice)\)$/i;

/** The `Gathered from` and `Contained in` lists of an Acquisition section. */
export function parseSources(section: string): PlanSource[] {
  const found = new Map<string, { kind: PlanSource['kind']; name: string; details: string[] }>();
  let kind: PlanSource['kind'] | null = null;
  for (const line of section.split('\n')) {
    if (Object.hasOwn(SOURCE_HEADINGS, line)) kind = SOURCE_HEADINGS[line]!;
    if (!kind || !line.startsWith('- ')) continue;
    let name = line.slice(2).trim();
    const details: string[] = [];
    for (let m = TRAILING_DETAIL.exec(name); m; m = TRAILING_DETAIL.exec(name)) {
      details.unshift(m[1]!);
      name = name.slice(0, m.index);
    }
    // A chest is often listed once per drop quantity.
    const entry = found.get(`${kind} ${name}`) ?? { kind, name, details: [] };
    entry.details.push(...details.filter((d) => !entry.details.includes(d)));
    found.set(`${kind} ${name}`, entry);
  }
  return [...found.values()].map(({ details, ...rest }) => ({ ...rest, ...(details.length ? { detail: details.join(', ') } : {}) }));
}

const firstSentences = (text: string) => text.split('\n')[0]!.split(/(?<=\.)\s+/).slice(0, 2).join(' ');

const untradeable = (step: PlanStep) => step.route?.action !== 'buy' && !step.options.some((o) => o.action === 'buy');

/** Open items with no known route that nobody has written a note about yet. */
export const needsResearch = (step: PlanStep): boolean =>
  step.count > 0 && step.action === 'earn' && step.kind === 'Item' && !step.note && !step.research?.method && untradeable(step);

/** An Acquisition line that is the whole way to get the item. */
const MAP_COMPLETION = /^- (Completing the map [^\n]+)$/m;
const MAX_REQUIREMENTS = 4;

/**
 * Vendor items that can't be bought from players: the wiki may list drops or
 * containers the recipe graph can't see (Noxious Pods in Dragon's Stand).
 */
const mayHaveOtherSources = (step: PlanStep): boolean =>
  step.count > 0 && step.action === 'vendor' && step.kind === 'Item' && !step.note && untradeable(step);

async function excerpt(wiki: WikiClient, step: PlanStep, always: boolean): Promise<PlanResearch | 'none' | undefined> {
  // Vendor offers are already in the graph, and their tables would crowd out the rest.
  // The same page, read again with the vendor tables, for what they ask of the buyer.
  const sold = await wiki.section(step.name, 'Acquisition', { maxChars: SECTION_CHARS });
  const requires =
    step.action === 'vendor'
      ? [...new Set(sold?.text.match(/\bRequires [^|\n]+/g)?.map((r) => r.trim()))].slice(0, MAX_REQUIREMENTS)
      : [];
  const [intro, section] = await Promise.all([
    wiki.page(step.name, { intro: true, maxChars: INTRO_CHARS }),
    wiki.section(step.name, 'Acquisition', { maxChars: SECTION_CHARS, omit: ['Sold by'] }),
  ]);
  if (!always && !requires.length && !(section && OTHER_SOURCES.test(section.text))) return 'none';
  const url = section?.url ?? intro?.url;
  const text = [intro?.text, section?.text.slice(0, EXCERPT_CHARS)].filter(Boolean).join('\n');

  const sources = parseSources(section?.text ?? '');
  await mapLimit(sources.filter((s) => s.kind === 'gathered').slice(0, DESCRIBED_SOURCES), 3, async (source) => {
    const about = await wiki.page(source.name, { intro: true, maxChars: INTRO_CHARS }).catch(() => null);
    if (about?.text) source.about = firstSentences(about.text);
  });
  const method = MAP_COMPLETION.exec(section?.text ?? '')?.[1];
  return text && url
    ? {
        text,
        source: url,
        ...(sources.length ? { sources } : {}),
        ...(method ? { method } : {}),
        ...(requires.length ? { requires } : {}),
      }
    : undefined;
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
