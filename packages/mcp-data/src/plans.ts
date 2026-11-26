/** The crafting-plan tools: load or build a plan, change it, save it, render it. */
import type { Gw2Client } from '@gw2kit/client';
import { addGoal, addOtherOffers, createPlan, refreshPrices, solvePlan, updatePlan, type CraftingPlan, type PlanNote, type PlanUpdate, type PlanSettings } from '@gw2kit/recipes';
import type { WikiClient } from '@gw2kit/wiki';
import { DEFAULT_VENDOR_CURRENCY, fmt, quoteExcerpt, renderPlan, researchPlan, type PlanSectionId } from '@gw2-ai/core';
import { listPlans, loadPlan, planExists, planPath, planSlug, plansDir, savePlan } from '@gw2-ai/core/plans';
import { truncate } from './util.js';

/** A whole legendary plan with its excerpts is longer than other tool output. */
const MAX_PLAN_OUTPUT = 48_000;

const { day, num, table, text } = fmt;

function render(plan: CraftingPlan, sections?: readonly PlanSectionId[], component?: string): string {
  const md = renderPlan(plan, { ...(sections ? { sections } : {}), ...(component ? { component } : {}) });
  return truncate(md, MAX_PLAN_OUTPUT, 'Use gw2_plan_show with `sections` or `component`.');
}

/**
 * Save the excerpts research added, onto the plan as it is now: the lookups are
 * slow, and holdings or another update may have been saved meanwhile.
 */
async function research(wiki: WikiClient, name: string, dir: string, only?: readonly string[]) {
  const before = await loadPlan(name, dir);
  const result = await researchPlan(before, wiki, only ? { only } : {});
  const added = Object.entries(result.plan.research ?? {}).filter(([key, value]) => before.research?.[key] !== value);
  const latest = await loadPlan(name, dir);
  const plan = { ...latest, research: { ...latest.research, ...Object.fromEntries(added) } };
  if (added.length) await savePlan(name, plan, dir);
  return { plan, added, failed: result.failed };
}

const failedNote = (failed: string[]) => (failed.length ? `No wiki excerpt for: ${failed.map(text).join(', ')}.` : '');

export interface GoalArgs {
  itemId: number;
  quantity: number;
}

/** `twilight`, `twilight-and-bolt`, or `twilight-and-2-more`. */
function defaultName(goals: CraftingPlan['goals']): string {
  const [first, second] = goals;
  const rest = goals.length > 2 ? ` and ${goals.length - 1} more` : second ? ` and ${second.name}` : '';
  return planSlug(`${first!.name}${rest}`);
}

export async function planCreate(
  client: Gw2Client,
  wiki: WikiClient,
  args: {
    itemId?: number | undefined;
    quantity?: number;
    /** Further things to make in the same plan. */
    items?: readonly GoalArgs[] | undefined;
    name?: string | undefined;
    replace?: boolean;
  },
  dir = plansDir(),
): Promise<string> {
  const wanted = [...(args.itemId === undefined ? [] : [{ itemId: args.itemId, quantity: args.quantity ?? 1 }]), ...(args.items ?? [])];
  if (!wanted.length) throw new Error('Pass `item_id`, or `items` for several things to make.');
  const taken = async (name: string) => {
    if (!args.replace && (await planExists(name, dir))) {
      throw new Error(
        `A plan named "${name}" is already saved. Show it with gw2_plan_show, pass another \`name\`, or pass \`replace: true\` to discard its choices and progress.`,
      );
    }
  };
  // Checked before the slow fetch when the name is given.
  if (args.name !== undefined) {
    planPath(args.name, dir);
    await taken(args.name);
  }
  const created = await createPlan(client, wanted, 1, { wiki, vendorCurrency: DEFAULT_VENDOR_CURRENCY });
  const unknown = created.goals.filter((g) => !created.data.items[g.itemId]).map((g) => g.itemId);
  if (unknown.length) throw new Error(`No item with id ${unknown.join(', ')}.`);
  const name = args.name ?? defaultName(created.goals);
  await taken(name);
  const { plan, failed } = await researchPlan(created, wiki);
  const path = await savePlan(name, plan, dir);
  return [`Saved as plan \`${name}\` (${path}).`, failedNote(failed), render(plan)].filter(Boolean).join('\n\n');
}

export async function planShow(
  name: string | undefined,
  options: { sections?: readonly PlanSectionId[] | undefined; component?: string | undefined } = {},
  dir = plansDir(),
): Promise<string> {
  if (name !== undefined) return render(await loadPlan(name, dir), options.sections, options.component);
  const saved = await listPlans(dir);
  if (!saved.length) return `No saved plans in ${dir}. Start one with gw2_plan_create.`;
  const rows = saved.map((p) => [
    p.name,
    p.goals ? p.goals.map((g) => `${num(g.quantity)} × ${g.name}`).join(', ') : 'unreadable file',
    day(p.updatedAt),
  ]);
  return `# Saved crafting plans\n\n${table(['Plan', 'Goals', 'Last changed'], rows)}`;
}

/** PlanUpdate as the tool's schema hands it over, with absent fields undefined. */
export interface PlanUpdateArgs {
  /** More to make: a new goal, or more of one the plan has. */
  add?: readonly GoalArgs[] | undefined;
  /** Goal → new quantity; 0 removes it. */
  quantities?: Record<string, number> | undefined;
  choose?: Record<string, string | null> | undefined;
  done?: string[] | undefined;
  undone?: string[] | undefined;
  notes?: Record<string, { text: string; source?: string | undefined; gate?: string | undefined } | null> | undefined;
  settings?: { [K in keyof PlanSettings]?: boolean | undefined } | undefined;
  refreshPrices?: boolean;
  sections?: readonly PlanSectionId[] | undefined;
}

/**
 * The plan with `goals` added. Items that don't exist are reported in `errors`.
 * Their other places to buy are looked up too.
 */
async function addGoals(client: Gw2Client, wiki: WikiClient, plan: CraftingPlan, goals: readonly GoalArgs[]) {
  const options = { wiki, vendorCurrency: DEFAULT_VENDOR_CURRENCY };
  const errors: string[] = [];
  let grown = plan;
  for (const { itemId, quantity } of goals) {
    const next = await addGoal(client, grown, itemId, quantity, options);
    if (next.data.items[itemId]) grown = next;
    else errors.push(`No item with id ${itemId}.`);
  }
  if (grown !== plan) grown = await addOtherOffers(client, grown, options);
  return { plan: grown, errors };
}

const toNote = (n: { text: string; source?: string | undefined; gate?: string | undefined }): PlanNote => ({
  text: n.text,
  ...(n.source ? { source: n.source } : {}),
  ...(n.gate ? { gate: n.gate } : {}),
});

export async function planUpdate(
  client: Gw2Client,
  wiki: WikiClient,
  name: string,
  args: PlanUpdateArgs,
  dir = plansDir(),
): Promise<string> {
  let plan = await loadPlan(name, dir);
  if (args.refreshPrices) plan = await refreshPrices(client, plan);
  // Added first, so the rest of the update can name the new steps.
  let unknown: string[] = [];
  let grew = false;
  if (args.add?.length) {
    const grown = await addGoals(client, wiki, plan, args.add);
    unknown = grown.errors;
    grew = grown.plan !== plan;
    // Loaded again, as the lookups are slow: only the graph and goals are ours.
    if (grew) plan = { ...(await loadPlan(name, dir)), data: grown.plan.data, goals: grown.plan.goals };
  }
  const settings = Object.entries(args.settings ?? {}).filter((e): e is [string, boolean] => e[1] !== undefined);
  const update: PlanUpdate = {
    ...(settings.length ? { settings: Object.fromEntries(settings) } : {}),
    ...(args.choose ? { choose: args.choose } : {}),
    ...(args.quantities ? { quantities: args.quantities } : {}),
    ...(args.done ? { done: args.done } : {}),
    ...(args.undone ? { undone: args.undone } : {}),
    ...(args.notes
      ? { notes: Object.fromEntries(Object.entries(args.notes).map(([step, n]) => [step, n && toNote(n)])) }
      : {}),
  };
  const applied = updatePlan(plan, update);
  await savePlan(name, applied.plan, dir);
  // A new route can bring in steps nobody has looked up.
  const found = await research(wiki, name, dir);
  const rejected = [...unknown, ...applied.errors];
  const errors = rejected.length ? `Not applied:\n${rejected.map((e) => `- ${text(e)}`).join('\n')}` : '';
  // Holdings keep only what the graph used when they were read.
  const resync =
    grew && found.plan.holdings.fetchedAt
      ? 'Run gw2_plan_holdings on gw2-account again: what you own of the new materials is not counted yet.'
      : '';
  const added = new Set(found.added.map(([key]) => key));
  const looked = solvePlan(found.plan).steps.filter((s) => added.has(s.key));
  return [
    errors,
    `Plan \`${name}\` saved.`,
    resync,
    looked.length ? `New wiki excerpts for: ${looked.map((s) => text(s.name)).join(', ')} (see the "acquire" and "vendor" sections).` : '',
    failedNote(found.failed),
    render(found.plan, args.sections ?? ['decisions']),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function planResearch(wiki: WikiClient, name: string, steps: string[], dir = plansDir()): Promise<string> {
  const { plan, added, failed } = await research(wiki, name, dir, steps);
  const names = new Map(solvePlan(plan).steps.map((s) => [s.key, s.name]));
  const out = added.map(
    ([key, r]) => `## ${text(names.get(key) ?? key)}\n\nFrom ${fmt.cell(r.source)}:\n\n${quoteExcerpt(r.text)}`,
  );
  if (failed.length) out.push(`${failedNote(failed)} Each name must be a step the plan still has open or covered, with a wiki page of that title.`);
  return out.join('\n\n');
}
