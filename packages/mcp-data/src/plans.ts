/** The crafting-plan tools: load or build a plan, change it, save it, render it. */
import type { Gw2Client } from '@gw2kit/client';
import { createPlan, refreshPrices, solvePlan, updatePlan, type CraftingPlan, type PlanNote, type PlanUpdate } from '@gw2kit/recipes';
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

export async function planCreate(
  client: Gw2Client,
  wiki: WikiClient,
  args: { itemId: number; quantity: number; name?: string | undefined; replace?: boolean },
  dir = plansDir(),
): Promise<string> {
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
  const created = await createPlan(client, args.itemId, args.quantity, { wiki, vendorCurrency: DEFAULT_VENDOR_CURRENCY });
  if (!created.data.items[args.itemId]) throw new Error(`No item with id ${args.itemId}.`);
  const name = args.name ?? planSlug(created.goal.name);
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
  const rows = saved.map((p) => [p.name, p.goal ? `${num(p.goal.quantity)} × ${p.goal.name}` : 'unreadable file', day(p.updatedAt)]);
  return `# Saved crafting plans\n\n${table(['Plan', 'Goal', 'Last changed'], rows)}`;
}

/** PlanUpdate as the tool's schema hands it over, with absent fields undefined. */
export interface PlanUpdateArgs {
  choose?: Record<string, string | null> | undefined;
  done?: string[] | undefined;
  undone?: string[] | undefined;
  notes?: Record<string, { text: string; source?: string | undefined; gate?: string | undefined } | null> | undefined;
  refreshPrices?: boolean;
  sections?: readonly PlanSectionId[] | undefined;
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
  const update: PlanUpdate = {
    ...(args.choose ? { choose: args.choose } : {}),
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
  const errors = applied.errors.length ? `Not applied:\n${applied.errors.map((e) => `- ${text(e)}`).join('\n')}` : '';
  const added = new Set(found.added.map(([key]) => key));
  const looked = solvePlan(found.plan).steps.filter((s) => added.has(s.key));
  return [
    errors,
    `Plan \`${name}\` saved.`,
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
