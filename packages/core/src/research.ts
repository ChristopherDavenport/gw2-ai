import { mapLimit } from '@gw2kit/client';
import { solvePlan, type CraftingPlan, type PlanRequirement, type PlanResearch, type PlanSource, type PlanStep, type StepKey } from '@gw2kit/recipes';
import { pageUrl, type SoldByRow, type WikiClient } from '@gw2kit/wiki';

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
  for (const line of current(section).split('\n')) {
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

/** Lines about sources that are gone, and the wiki's footnotes. */
const STALE_LINE = /^- (\^|.*\([^)]*\b(historical|discontinued)\b[^)]*\)\s*$)/i;
const current = (section: string) => section.split('\n').filter((line) => !STALE_LINE.test(line)).join('\n');

const firstSentences = (text: string) => text.split('\n')[0]!.split(/(?<=\.)\s+/).slice(0, 2).join(' ');

const untradeable = (step: PlanStep) => step.route?.action !== 'buy' && !step.options.some((o) => o.action === 'buy');

/** Open items with no known route that nobody has written a note about yet. */
export const needsResearch = (step: PlanStep): boolean =>
  step.count > 0 && step.action === 'earn' && step.kind === 'Item' && !step.note && !step.research?.method && untradeable(step);

/** An Acquisition line that is the whole way to get the item. */
const MAP_COMPLETION = /^- (Completing the map [^\n]+)$/m;
const MAX_REQUIREMENTS = 3;
const REQUIREMENT = /\bRequires .+?(?:\.(?=\s|$)|$)/g;

/**
 * What each vendor demands before selling. Only what every one of a vendor's
 * rows says: a demand on one of several offers can't be matched to the offer.
 */
export function vendorRequirements(rows: readonly SoldByRow[]): PlanRequirement[] {
  const byVendor = new Map<string, string[]>();
  for (const { vendor, notes } of rows) {
    const found = notes.match(REQUIREMENT)?.map((r) => r.trim()) ?? [];
    const before = byVendor.get(vendor);
    byVendor.set(vendor, before ? before.filter((r) => found.includes(r)) : [...new Set(found)]);
  }
  return [...byVendor].flatMap(([vendor, texts]) => texts.slice(0, MAX_REQUIREMENTS).map((text) => ({ vendor, text })));
}

/**
 * Vendor items that can't be bought from players: the wiki may list drops or
 * containers the recipe graph can't see (Noxious Pods in Dragon's Stand).
 */
const mayHaveOtherSources = (step: PlanStep): boolean =>
  step.count > 0 && step.action === 'vendor' && step.kind === 'Item' && !step.note && untradeable(step);

async function excerpt(
  wiki: WikiClient,
  step: PlanStep,
  always: boolean,
  intros: Map<string, string>,
): Promise<PlanResearch | 'none' | undefined> {
  // The vendor tables, for what each vendor asks of the buyer.
  const requires = step.action === 'vendor' ? vendorRequirements(await wiki.soldBy(step.name)) : [];
  // Vendor offers are already in the graph, and their tables would crowd out the rest.
  const section = await wiki.section(step.name, 'Acquisition', { maxChars: SECTION_CHARS, omit: ['Sold by'] });
  if (!always && !requires.length && !(section && OTHER_SOURCES.test(section.text))) return 'none';

  const sources = parseSources(section?.text ?? '');
  const described = sources.filter((s) => s.kind === 'gathered').slice(0, DESCRIBED_SOURCES);
  // One request for the step and its sources; sources seen before are not asked for again.
  const unknown = [step.name, ...described.map((s) => s.name)].filter((name) => !intros.has(name));
  if (unknown.length) {
    const found = await wiki.intros(unknown, { maxChars: INTRO_CHARS }).catch(() => undefined);
    if (found) for (const name of unknown) intros.set(name, found.get(name) ?? '');
  }
  for (const source of described) {
    const about = intros.get(source.name);
    if (about) source.about = firstSentences(about);
  }

  const url = section?.url ?? (intros.get(step.name) ? pageUrl(step.name) : undefined);
  const text = [intros.get(step.name), section && current(section.text).slice(0, EXCERPT_CHARS)].filter(Boolean).join('\n');
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

export interface ResearchOptions {
  /** Steps to look up instead of the default, by name or key, whatever their route. */
  only?: readonly string[];
  /** Called as each step finishes, with what was found for it. */
  onProgress?: (done: number, total: number, found?: { key: StepKey; research: PlanResearch }) => void;
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
  options: ResearchOptions = {},
): Promise<{ plan: CraftingPlan; failed: string[] }> {
  const only = options.only?.map((n) => n.trim().toLowerCase());
  const steps = solvePlan(plan).steps.filter((s) =>
    only ? only.includes(s.name.toLowerCase()) || only.includes(s.key) : (needsResearch(s) || mayHaveOtherSources(s)) && !s.research,
  );
  const found: Record<StepKey, PlanResearch> = {};
  const failed: string[] = [];
  const intros = new Map<string, string>();
  let done = 0;
  options.onProgress?.(0, steps.length);
  await mapLimit(steps, 3, async (step) => {
    let hit: PlanResearch | undefined;
    try {
      const result = await excerpt(wiki, step, only !== undefined || needsResearch(step), intros);
      if (result === undefined) failed.push(step.name);
      else if (result !== 'none') hit = found[step.key] = result;
    } catch {
      failed.push(step.name);
    }
    options.onProgress?.(++done, steps.length, hit && { key: step.key, research: hit });
  });
  for (const name of only ?? []) {
    if (!steps.some((s) => s.name.toLowerCase() === name || s.key === name)) failed.push(name);
  }
  return { plan: { ...plan, research: { ...plan.research, ...found } }, failed: failed.sort() };
}
