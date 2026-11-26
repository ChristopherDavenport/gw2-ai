import { pageUrl, type VendorCaps } from '@gw2kit/wiki';
import { planSettings, solvePlan, type CraftingPlan, type PlanRoute, type PlanSettings, type PlanStep, type SolvedPlan, type StepKey } from '@gw2kit/recipes';
import { cell, coins, day, num, text } from './format.js';
import { needsResearch } from './research.js';

export const PLAN_SECTIONS = ['decisions', 'gates', 'acquire', 'buy', 'vendor', 'make', 'covered', 'updating'] as const;
export type PlanSectionId = (typeof PLAN_SECTIONS)[number];

export interface RenderPlanOptions {
  /** Sections to include, after the summary. Default: all of them. */
  sections?: readonly PlanSectionId[];
  /**
   * Only the steps one part of the goal needs, named as in the Make headings
   * (e.g. `Mystic Tribute`).
   */
  component?: string;
}

/** Wiki excerpt, quoted and escaped: it is untrusted text a model will read. */
export function quoteExcerpt(excerpt: string, indent = ''): string {
  return excerpt
    .split('\n')
    .map((line) => `${indent}> ${text(line)}`)
    .join('\n');
}

/** On a vendor step the excerpt is for drops and containers, which the player can pick instead. */
function researchText(step: PlanStep): string {
  const r = step.research;
  if (!r || step.note) return '';
  const lead = step.action === 'vendor' ? 'Other ways to get it (choose `earn` to use one), from' : 'From';
  return `\n  - ${lead} ${cell(r.source)}:\n\n${quoteExcerpt(r.text, '  ')}\n`;
}

const box = (step: PlanStep) => `- [${step.count === 0 ? 'x' : ' '}]`;
const amount = (count: number, name: string) => `${num(count)} × ${text(name)}`;
const inputText = (step: PlanStep) => step.inputs.map((i) => (i.key === 'c1' ? coins(i.count) : amount(i.count, i.name))).join(', ');
const held = (step: PlanStep) => (step.owned > 0 ? ` (have ${num(step.owned)} of ${num(step.need)})` : '');

function noteText(step: PlanStep): string {
  const n = step.note;
  if (!n) return '';
  return `\n  - Note: ${text(n.text)}${n.source ? ` (${cell(n.source)})` : ''}`;
}

const PERIODS: [keyof VendorCaps, string][] = [
  ['daily', 'day'],
  ['weekly', 'week'],
  ['season', 'season'],
  ['character', 'character'],
  ['total', 'account, ever'],
];

/** Vendor limits, and for the per-day and per-week ones, how long they take. */
function capText(step: PlanStep): string {
  return PERIODS.flatMap(([key, per]) => {
    const limit = step.caps?.[key];
    if (limit === undefined) return [];
    const periods = Math.ceil(step.times / limit);
    const takes = (key === 'daily' || key === 'weekly' || key === 'season') && periods > 1 ? `, so ${num(periods)} ${per}s` : '';
    return [`limit ${num(limit)} per ${per}${takes}`];
  }).join('; ');
}

/** How one route differs from the others, by the inputs only it uses. Plain text. */
function routeLabel(route: PlanRoute, all: readonly PlanRoute[]): string {
  if (route.action === 'buy') return `buy on the trading post (${coins(route.unitCost)} each)`;
  if (route.action === 'earn') return 'earn it some other way';
  const others = all.filter((r) => r !== route && r.inputs.length);
  const unique = route.inputs.filter((i) => !others.every((r) => r.inputs.some((o) => o.key === i.key)));
  // A vendor price is shown whole; recipes are told apart by what only they use.
  const inputs = (route.action !== 'vendor' && unique.length ? unique : route.inputs)
    .map((i) => (i.key === 'c1' ? coins(i.count) : `${num(i.count)} × ${i.name}`))
    .join(', ');
  const verb = route.promotion ? 'Mystic Forge promotion' : route.action === 'forge' ? 'Mystic Forge' : route.action === 'vendor' ? 'vendor' : 'craft';
  return `${verb} with ${inputs}`;
}

export interface PlanChoice {
  key: StepKey;
  name: string;
  /** Route key in use. */
  selected: string;
  /** True while the route in use is only the default among recipes gold can't compare. */
  undecided: boolean;
  /** Every route, in an order that doesn't change with the selection. Labels are plain text. */
  options: { value: string; label: string }[];
}

/**
 * The steps where the player has a real choice: several recipes, drops or
 * containers instead of a vendor, or a choice already made (so it can be
 * changed back). Pass `route key` values to updatePlan's `choose`.
 */
export function planChoices(plan: CraftingPlan, solved: SolvedPlan = solvePlan(plan)): PlanChoice[] {
  return solved.steps.flatMap((s) => {
    if (!s.route) return [];
    const routes = [s.route, ...s.options].sort((a, b) => a.key.localeCompare(b.key));
    const recipes = routes.filter((r) => r.action === 'craft' || r.action === 'forge');
    const otherSources = s.route.action === 'vendor' && s.research !== undefined;
    if (recipes.length < 2 && !otherSources && plan.choices[s.key] === undefined) return [];
    return [
      {
        key: s.key,
        name: s.name,
        selected: s.route.key,
        undecided: s.undecided,
        // "Earn" only means something where there are drops or containers to use.
        options: routes
          .filter((r) => r.action !== 'earn' || s.research !== undefined || r.key === s.route!.key)
          .map((r) => ({ value: r.key, label: routeLabel(r, routes) })),
      },
    ];
  });
}

/** Open choices first, then the ones made, each with every route so it can be changed. */
function decisions(choices: PlanChoice[]): string[] {
  return [...choices]
    .sort((a, b) => Number(b.undecided) - Number(a.undecided))
    .map((c) => {
      const head = c.undecided
        ? `- **${text(c.name)}**: not chosen yet; gold can't compare these, and the plan assumes the one marked.`
        : `- **${text(c.name)}**`;
      const lines = c.options.map(
        (o) => `  - ${o.value === c.selected ? (c.undecided ? '(assumed) ' : '(chosen) ') : ''}${text(o.label)}`,
      );
      return `${head}\n${lines.join('\n')}`;
    });
}

function gates(steps: PlanStep[]): string[] {
  return steps.flatMap((s) => {
    const daily = s.perDay ? `${s.perDay} per day${s.count > s.perDay ? `, so ${num(Math.ceil(s.count / s.perDay))} days` : ''}` : '';
    const gate = [daily, capText(s), s.note?.gate ? text(s.note.gate) : ''].filter(Boolean).join('; ');
    return s.count > 0 && gate ? [`- ${amount(s.count, s.name)}: ${gate}`] : [];
  });
}

/** Things to earn: currencies, drops and rewards. Unknown ones are flagged. */
function acquire(steps: PlanStep[]): string[] {
  return steps
    .filter((s) => s.action === 'earn')
    .sort((a, b) => Number(a.kind !== 'Item') - Number(b.kind !== 'Item') || a.name.localeCompare(b.name))
    .map((s) => {
      const how = needsResearch(s)
        ? ` — **needs research**${s.research ? '' : `: ${pageUrl(s.name)}`}`
        : s.options.some((o) => o.action === 'buy') && !s.note
          ? ' — you chose to earn it'
          : '';
      return `${box(s)} ${amount(s.count, s.name)}${held(s)}${s.bound ? ' [bound]' : ''}${how}${noteText(s)}${researchText(s)}`;
    });
}

function buy(steps: PlanStep[], plan: CraftingPlan): string[] {
  return steps
    .filter((s) => s.action === 'buy')
    .sort((a, b) => b.coin - a.coin)
    .map((s) => {
      const item = plan.data.items[s.id];
      const order = item?.buy ? `; by buy order ≈ ${coins(item.buy * s.count)}` : '';
      const make = s.options.find((o) => o.action === 'craft' || o.action === 'forge');
      const other = make && !make.priced ? `\n  - Can also be made, at a cost gold can't compare: ${routeLabel(make, [make])}` : '';
      return `${box(s)} ${amount(s.count, s.name)}${held(s)}: **${coins(s.coin)}** (${coins(item?.sell ?? 0)} each${order})${other}${noteText(s)}${researchText(s)}`;
    });
}

function vendor(steps: PlanStep[]): string[] {
  return steps
    .filter((s) => s.action === 'vendor')
    .map((s) => {
      const offer = s.route!.offer!;
      const who = offer.vendors.slice(0, 2).map(text).join(' or ');
      const caps = capText(s);
      return `${box(s)} ${amount(s.count, s.name)}${held(s)} from ${who}, for ${inputText(s)}${caps ? ` (${caps})` : ''}${noteText(s)}${researchText(s)}`;
    });
}

function makeLine(s: PlanStep): string {
  const verb = s.action === 'forge' ? 'Forge' : 'Craft';
  const recipe = s.route!.recipe!;
  const how = s.route!.promotion
    ? `, by promotion: about ${num(s.times)} forges at an average net gain of ${s.route!.output} (random; you need 1 × ${text(s.name)} to put in)`
    : s.action === 'forge'
      ? s.route!.output < 1
        ? `, about ${num(s.times)} forges at an average yield of ${s.route!.output} (random, so keep spares)`
        : ''
      : ` (${recipe.disciplines.join('/')} ${recipe.min_rating})`;
  return `${box(s)} ${s.route!.promotion ? 'Promote to' : verb} ${amount(s.count, s.name)}${held(s)}${how}: ${inputText(s)}${noteText(s)}`;
}

/** Crafts and forges, inputs before outputs, grouped by the part of the goal. */
function make(solved: SolvedPlan): string[] {
  const goal = `i${solved.goal.itemId}`;
  const names = new Map(solved.steps.map((s) => [s.key, s.name]));
  const groups = new Map<string, string[]>();
  for (const s of [...solved.steps].reverse()) {
    if (s.action !== 'craft' && s.action !== 'forge') continue;
    const title =
      s.key === goal ? 'Finish' : s.components.length === 1 ? text(names.get(s.components[0]!) ?? 'Other') : 'Shared by several parts';
    (groups.get(title) ?? groups.set(title, []).get(title)!).push(makeLine(s));
  }
  const rank = (title: string) => (title === 'Shared by several parts' ? 0 : title === 'Finish' ? 2 : 1);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([title, lines]) => `### ${title}\n\n${lines.join('\n')}`);
}

const UPDATING = `To change this plan, reply with a JSON update. Steps are named as written above; leave out what you don't need.

\`\`\`json
{
  "choose": { "<step>": "buy | earn | vendor | an ingredient only the wanted recipe uses" },
  "done": ["<step>"],
  "undone": ["<step>"],
  "notes": { "<step>": { "text": "how to get it", "source": "<url>", "gate": "1 per day" } },
  "settings": { "useOwnMaterials": true, "dailyCrafts": true, "forgePromotions": false, "deductOwnedValue": true }
}
\`\`\``;

/** What each setting is called, for the plan's header and the site's checkboxes. */
export const PLAN_SETTING_LABELS: Readonly<Record<keyof PlanSettings, string>> = {
  useOwnMaterials: 'Use my own materials',
  dailyCrafts: 'Craft daily cooldown items',
  forgePromotions: 'Use Mystic Forge promotions',
  deductOwnedValue: 'Subtract my materials from the value',
};

/** The gold headline: what is left to pay, or the whole value with owned materials counted in. */
function valueText(plan: CraftingPlan, solved: SolvedPlan, gold: number, scoped: boolean): string {
  const settings = planSettings(plan);
  const priced = `at trading post sell listings of ${day(plan.data.fetchedAt)}`;
  const owned = scoped ? 0 : Math.max(0, solved.fullCoin - solved.coin);
  if (!owned) return `Gold still to spend: **${coins(gold)}** ${priced}.`;
  return settings.deductOwnedValue
    ? `Gold still to spend: **${coins(gold)}** ${priced}, after your materials (worth ${coins(owned)} here).`
    : `Total value: **${coins(solved.fullCoin)}** ${priced}, including ${coins(owned)} of your own materials; ${coins(gold)} left to spend.`;
}

/** Markdown for a plan: what to decide, what takes time, what to get and what to make. */
export function renderPlan(plan: CraftingPlan, options: RenderPlanOptions = {}): string {
  const solved = solvePlan(plan);
  const wanted = options.sections ?? PLAN_SECTIONS;

  let steps = solved.steps;
  let scope = '';
  if (options.component) {
    const name = options.component.trim().toLowerCase();
    const part = steps.find((s) => s.name.toLowerCase() === name);
    if (!part) return `No step named "${text(options.component)}" in this plan.`;
    steps = steps.filter((s) => s.key === part.key || s.components.includes(part.key));
    scope = ` Showing only what ${text(part.name)} needs; counts include other parts' demand.`;
  }

  const open = steps.filter((s) => s.count > 0);
  const research = open.filter(needsResearch);
  const gold = open.reduce((sum, s) => sum + s.coin, 0);
  const { data, holdings } = plan;
  const warnings = [
    data.status.mysticForge?.status === 'failed' ? 'The Mystic Forge lookup failed, so forge recipes are missing: rebuild the plan.' : '',
    data.status.vendors && data.status.vendors.status !== 'ok' ? 'Some vendor lookups failed, so some vendor routes are missing.' : '',
  ].filter(Boolean);

  const out = [
    `# Crafting plan: ${amount(plan.goal.quantity, plan.goal.name)}`,
    `${valueText(plan, solved, gold, scope !== '')} ` +
      `${num(open.length)} steps open, ${num(research.length)} needing research. ` +
      (!planSettings(plan).useOwnMaterials
        ? 'Your own materials are not used.'
        : holdings.fetchedAt
          ? `Holdings read ${day(holdings.fetchedAt)}.`
          : 'Account holdings are not counted.') +
      scope,
    `Settings: ${Object.entries(PLAN_SETTING_LABELS)
      .map(([key, label]) => `${label.toLowerCase()}: ${planSettings(plan)[key as keyof PlanSettings] ? 'yes' : 'no'}`)
      .join(' · ')}.`,
    ...warnings,
  ];

  const sections: Record<PlanSectionId, [string, () => string[]]> = {
    decisions: [
      steps.some((s) => s.undecided) ? 'Decide first' : 'Recipe choices',
      () => decisions(planChoices(plan, { ...solved, steps })),
    ],
    gates: ['Time-gated: start these early', () => gates(steps)],
    acquire: ['Earn', () => acquire(open)],
    buy: ['Buy on the trading post', () => buy(open, plan)],
    vendor: ['Buy from vendors', () => vendor(open)],
    make: ['Make, in order', () => make({ ...solved, steps: steps.filter((s) => s.count > 0) })],
    covered: [
      'Already covered',
      () => steps.filter((s) => s.count === 0).map((s) => `- [x] ${amount(s.need, s.name)}${s.done ? ' (done)' : ' (held)'}`),
    ],
    updating: ['Updating this plan', () => [UPDATING]],
  };
  for (const id of PLAN_SECTIONS) {
    if (!wanted.includes(id)) continue;
    const [title, lines] = sections[id];
    const body = lines();
    if (body.length) out.push(`## ${title}\n\n${body.join(id === 'make' ? '\n\n' : '\n')}`);
  }
  return `${out.join('\n\n')}\n`;
}
