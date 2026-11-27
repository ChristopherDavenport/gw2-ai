import { pageUrl, type VendorCaps } from '@gw2kit/wiki';
import { buyPrice, planSettings, solvePlan, type CraftingPlan, type PlanRoute, type PlanSettings, type PlanSource, type PlanStep, type SolvedPlan, type StepKey } from '@gw2kit/recipes';
import { cell, coins, day, num, text } from './format.js';
import { needsResearch } from './research.js';
import { renderSales, type SalePlan } from './liquidate.js';

export const PLAN_SECTIONS = ['goals', 'decisions', 'gates', 'acquire', 'buy', 'vendor', 'make', 'covered', 'updating'] as const;
export type PlanSectionId = (typeof PLAN_SECTIONS)[number];

export interface RenderPlanOptions {
  /** Sections to include, after the summary. Default: all of them. */
  sections?: readonly PlanSectionId[];
  /**
   * Only the steps one part of the goal needs, named as in the Make headings
   * (e.g. `Mystic Tribute`).
   */
  component?: string;
  /** Show the plan for the first this many goals only, as if nothing else were planned. */
  goals?: number;
  /** Sales to cover the gold shortfall, from salesForPlan, shown after the summary. */
  sales?: { plan: SalePlan; delivery?: number; notes?: readonly string[] };
}

/** Wiki excerpt, quoted and escaped: it is untrusted text a model will read. */
export function quoteExcerpt(excerpt: string, indent = ''): string {
  return excerpt
    .split('\n')
    .map((line) => `${indent}> ${text(line)}`)
    .join('\n');
}

/** On a vendor step the excerpt is for drops and containers, which the player can pick instead. */
function sourceList(sources: readonly PlanSource[]): string {
  const line = (s: PlanSource) =>
    `    - ${text(s.name)}${s.detail ? ` (${text(s.detail)})` : ''}${s.about ? `: ${text(s.about)}` : ''}`;
  return (
    [
      ['Collect on the map', sources.filter((s) => s.kind === 'gathered')],
      ['From containers and choice chests', sources.filter((s) => s.kind === 'contained')],
    ] as const
  )
    .filter(([, list]) => list.length)
    .map(([title, list]) => `\n  - ${title}:\n${list.map(line).join('\n')}`)
    .join('');
}

/** What the vendors named on a step demand. Other vendors' demands don't apply to it. */
function requirementText(step: PlanStep): string {
  const shown = step.action === 'vendor' ? (step.route?.offer?.vendors.slice(0, NAMED_VENDORS) ?? []) : [];
  // Older research holds bare strings with no vendor, which are left out.
  const lines = (step.research?.requires ?? []).filter((r) => typeof r === 'object' && r !== null && shown.includes(r.vendor));
  return lines.length ? `\n  - Vendor requirements: ${lines.map((r) => `${text(r.vendor)}: ${text(r.text)}`).join(' ')}` : '';
}

function researchText(step: PlanStep): string {
  const r = step.research;
  if (!r || step.note) return '';
  if (r.method) return `\n  - How: ${text(r.method)} (${cell(r.source)})`;
  const requires = requirementText(step);
  // A vendor step's excerpt is only worth showing for the drops and containers in it.
  if (step.action === 'vendor' && !r.sources) return requires;
  const lead = step.action === 'vendor' ? 'Other ways to get it (choose `earn` to use one), from' : 'From';
  const body = r.sources ? sourceList(r.sources) : `\n\n${quoteExcerpt(r.text, '  ')}\n`;
  return `${requires}\n  - ${lead} ${cell(r.source)}:${body}`;
}

/** Vendors named per offer. */
const NAMED_VENDORS = 2;

/** Vendor offers listed per step; the route choices hold all of them. */
const LISTED_OFFERS = 10;

/** Vendor prices besides the route in use: other vendors, exchanges and their limits. */
function offerText(step: PlanStep): string {
  const offers = step.options.flatMap((r) => (r.offer ? [r.offer] : []));
  if (!offers.length) return '';
  const lines = offers.slice(0, LISTED_OFFERS).map((o) => {
    const costs = o.costs.map((c) => (c.kind === 'Currency' && c.id === 1 ? coins(c.amount) : `${num(c.amount)} ${text(c.name)}`));
    const limits = PERIODS.flatMap(([key, per]) => (o.caps[key] === undefined ? [] : [`limit ${num(o.caps[key])} per ${per}`]));
    const who = o.vendors.slice(0, 2).map(text).join(' or ');
    return `    - ${num(o.quantity)} for ${costs.join(' + ')} from ${who}${limits.length ? ` (${limits.join(', ')})` : ''}`;
  });
  if (offers.length > LISTED_OFFERS) lines.push(`    - and ${offers.length - LISTED_OFFERS} more`);
  return `\n  - ${step.action === 'vendor' ? 'Other prices' : 'Also sold by vendors'}:\n${lines.join('\n')}`;
}

/** Says when a step doesn't take its usual route. */
function pickedText(step: PlanStep): string {
  const usual = step.usual;
  if (!usual || !step.route) return '';
  const why = step.paid
    ? `Picked because your wallet covers ${step.paid.spends.map((i) => amount(i.count, i.name)).join(', ')} after the rest of the plan, ` +
      `and crafting is then about ${coins(step.paid.saves)} cheaper in gold (your own materials counted at what they would sell for)`
    : 'Picked for what you hold and need';
  return `\n  - ${why}, in place of: ${text(routeLabel(usual, [usual, step.route]))}`;
}

/** On a step still bought: what a craft paid in currencies would save, and what stands in the way. */
function unpaidText(step: PlanStep): string {
  const u = step.unpaid;
  if (!u) return '';
  const missing = u.missing.map((i) => amount(i.count, i.name)).join(', ');
  const why = [missing ? `you are short ${missing}` : '', u.gated ? 'it would wait on daily or weekly limits' : ''].filter(Boolean).join(', and ');
  return `\n  - Crafting would save about ${coins(u.saves)} in gold, but ${why}.`;
}

const box = (step: PlanStep) => `- [${step.count === 0 ? 'x' : ' '}]`;
const amount = (count: number, name: string) => `${num(count)} × ${text(name)}`;
const inputText = (step: PlanStep) => step.inputs.map((i) => (i.key === 'c1' ? coins(i.count) : amount(i.count, i.name))).join(', ');
const held = (step: PlanStep) => {
  const parts = [step.owned > 0 ? `have ${num(step.owned)}` : '', step.ordered > 0 ? `${num(step.ordered)} on buy order` : ''].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')}, of ${num(step.need)})` : '';
};

/**
 * The player's orders for one item with the price that now beats them, e.g.
 * `20 at 1s 50c (outbid: the top buy order is 1s 60c)`. Empty with no orders.
 */
function orderList(plan: CraftingPlan, id: number, side: 'buys' | 'sells'): string {
  const mine = [...(plan.holdings.orders?.[side][id] ?? [])].sort((x, y) => (side === 'buys' ? y.price - x.price : x.price - y.price));
  if (!mine.length) return '';
  const best = plan.holdings.orders?.market?.[id]?.[side === 'buys' ? 'buy' : 'sell'];
  const total = mine.reduce((sum, o) => sum + o.quantity, 0);
  const beaten = best === undefined ? 0 : mine.filter((o) => (side === 'buys' ? o.price < best : o.price > best)).reduce((sum, o) => sum + o.quantity, 0);
  const [word, what] = side === 'buys' ? ['outbid', 'the top buy order'] : ['undercut', 'the lowest listing'];
  const status =
    best === undefined
      ? ''
      : beaten === 0
        ? ` (${what})`
        : ` (${beaten < total ? `${num(beaten)} ` : ''}${word}: ${what} is ${coins(best)})`;
  return `${mine.map((o) => `${num(o.quantity)} at ${coins(o.price)}`).join(', ')}${status}`;
}

/** What the player's own trading post orders mean for a step still open. */
function ordersText(plan: CraftingPlan, step: PlanStep): string {
  if (step.kind !== 'Item') return '';
  const buying = step.ordered > 0 ? orderList(plan, step.id, 'buys') : '';
  const selling = orderList(plan, step.id, 'sells');
  return (
    (buying ? `\n  - On buy order: ${buying}.` : '') +
    (selling
      ? `\n  - Listed for sale, not counted here: ${selling}. Cancelling a listing gets the items back, but not its 5% listing fee.`
      : '')
  );
}

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
function routeLabel(route: PlanRoute, all: readonly PlanRoute[], sources: readonly PlanSource[] = []): string {
  if (route.action === 'buy') return `buy on the trading post (${coins(route.unitCost)} each)`;
  if (route.action === 'earn') {
    const names = sources.filter((s) => s.kind === 'gathered').map((s) => s.name);
    if (!names.length) return 'earn it some other way';
    const chests = sources.some((s) => s.name.includes("Hero's Choice")) ? ", or a Hero's Choice Chest" : '';
    return `collect it: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}${chests}`;
  }
  if (route.pool) {
    const { stacks, stack, label } = route.pool;
    const fixed = route.inputs.slice(0, -1).map((i) => `${num(i.count)} × ${i.name}`);
    return `Mystic Forge with ${[...fixed, `${num(stacks * stack)} × any ${label}`].join(', ')} (${route.output} per forge on average)`;
  }
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
  /** True when the route in use was picked for what the player holds or the quantity needed. */
  auto: boolean;
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
    const otherSources = s.route.action === 'vendor' && s.research?.sources !== undefined;
    const alsoSold = s.route.action !== 'vendor' && routes.some((r) => r.action === 'vendor');
    if (recipes.length < 2 && !otherSources && !alsoSold && !s.usual && plan.choices[s.key] === undefined) return [];
    return [
      {
        key: s.key,
        name: s.name,
        selected: s.route.key,
        undecided: s.undecided,
        auto: s.usual !== undefined,
        // "Earn" only means something where there are drops or containers to use.
        options: routes
          .filter((r) => r.action !== 'earn' || s.research !== undefined || r.key === s.route!.key)
          .map((r) => ({ value: r.key, label: routeLabel(r, routes, s.research?.sources) })),
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
      const mark = c.undecided ? '(assumed) ' : c.auto ? '(picked for you) ' : '(chosen) ';
      const lines = c.options.map((o) => `  - ${o.value === c.selected ? mark : ''}${text(o.label)}`);
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
function acquire(steps: PlanStep[], plan: CraftingPlan, averaged: ReadonlySet<StepKey>): string[] {
  return steps
    .filter((s) => s.action === 'earn')
    .sort((a, b) => Number(a.kind !== 'Item') - Number(b.kind !== 'Item') || a.name.localeCompare(b.name))
    .map((s) => {
      const how = needsResearch(s)
        ? ` — **needs research**${s.research ? '' : `: ${pageUrl(s.name)}`}`
        : s.options.some((o) => o.action === 'buy') && !s.note && !s.research?.method
          ? ' — you chose to earn it'
          : '';
      return `${box(s)} ${amount(s.count, s.name)}${averageMark(averaged, s)}${held(s)}${s.bound ? ' [bound]' : ''}${how}${ordersText(plan, s)}${noteText(s)}${researchText(s)}${offerText(s)}`;
    });
}

function buy(steps: PlanStep[], plan: CraftingPlan, averaged: ReadonlySet<StepKey>): string[] {
  return steps
    .filter((s) => s.action === 'buy')
    .sort((a, b) => b.coin - a.coin)
    .map((s) => {
      const item = plan.data.items[s.id];
      const ordering = planSettings(plan).useBuyOrders;
      const other_ = ordering ? item?.sell : item?.buy;
      const order = other_ ? `; ${ordering ? 'buying at once' : 'by buy order'} ≈ ${coins(other_ * s.count)}` : '';
      const make = s.options.find((o) => o.action === 'craft' || o.action === 'forge');
      const other = make && !make.priced && !s.unpaid ? `\n  - Can also be made, at a cost gold can't compare: ${routeLabel(make, [make])}` : '';
      return `${box(s)} ${amount(s.count, s.name)}${averageMark(averaged, s)}${held(s)}: **${coins(s.coin)}** (${coins(buyPrice(plan, s.id) ?? 0)} each${order})${pickedText(s)}${unpaidText(s)}${other}${ordersText(plan, s)}${noteText(s)}${researchText(s)}${offerText(s)}`;
    });
}

function vendor(steps: PlanStep[], plan: CraftingPlan, averaged: ReadonlySet<StepKey>): string[] {
  return steps
    .filter((s) => s.action === 'vendor')
    .map((s) => {
      const offer = s.route!.offer!;
      const who = offer.vendors.slice(0, NAMED_VENDORS).map(text).join(' or ');
      const caps = capText(s);
      return `${box(s)} ${amount(s.count, s.name)}${averageMark(averaged, s)}${held(s)} from ${who}, for ${inputText(s)}${caps ? ` (${caps})` : ''}${pickedText(s)}${ordersText(plan, s)}${noteText(s)}${researchText(s)}${offerText(s)}`;
    });
}

/** Whether a step's yield is a matter of luck, so its quantities are averages. */
const isAveraged = (s: PlanStep): boolean =>
  s.count > 0 && s.route !== undefined && (s.route.pool !== undefined || s.route.promotion === true || (s.action === 'forge' && s.route.output < 1));

/** Everything an averaged step takes, directly or further down: those quantities move with luck. */
function averagedInputs(steps: readonly PlanStep[]): Set<StepKey> {
  const out = new Set<StepKey>();
  // Consumers come before what they consume, so one pass follows the chain.
  for (const s of steps) if (isAveraged(s) || out.has(s.key)) for (const i of s.inputs) out.add(i.key);
  return out;
}

/** The warning that goes above the totals. */
function averageText(steps: readonly PlanStep[]): string {
  const random = steps.filter(isAveraged);
  if (!random.length) return '';
  const names = random.map((s) => `${amount(s.count, s.name)} (about ${num(s.times)} forges)`).join(', ');
  return (
    `**Averages, not guarantees:** ${names} depend on random Mystic Forge yields. Gold, material and currency totals, ` +
    'including what your wallet covers, assume average luck; you may need more or less. Lines marked (average) move with it.'
  );
}

const averageMark = (averaged: ReadonlySet<StepKey>, s: PlanStep) => (averaged.has(s.key) ? ' (average)' : '');

function makeLine(s: PlanStep, plan: CraftingPlan): string {
  const verb = s.action === 'forge' ? 'Forge' : 'Craft';
  const recipe = s.route!.recipe!;
  const pool = s.route!.pool;
  const how = pool
    ? `, about ${num(s.times)} forges at ${s.route!.output} each (yields are averages, so you may need more or fewer)`
    : s.route!.promotion
    ? `, by promotion: about ${num(s.times)} forges at an average net gain of ${s.route!.output} (random; you need 1 × ${text(s.name)} to put in)`
    : s.action === 'forge'
      ? s.route!.output < 1
        ? `, about ${num(s.times)} forges at an average yield of ${s.route!.output} (random, so keep spares)`
        : ''
      : ` (${recipe.disciplines.join('/')} ${recipe.min_rating})`;
  const used = pool ? poolText(s, pool) : inputText(s);
  return `${box(s)} ${s.route!.promotion ? 'Promote to' : verb} ${amount(s.count, s.name)}${held(s)}${how}: ${used}${pickedText(s)}${unpaidText(s)}${ordersText(plan, s)}${noteText(s)}${offerText(s)}`;
}

/** A pool forge's inputs: the fixed ones, then which items make up the pool's share. */
function poolText(step: PlanStep, pool: NonNullable<PlanRoute['pool']>): string {
  const list = (inputs: PlanStep['inputs']) => inputs.map((i) => amount(i.count, i.name)).join(', ');
  const fixed = step.inputs.filter((i) => !pool.items.includes(i.key));
  const mixed = step.inputs.filter((i) => pool.items.includes(i.key));
  const total = mixed.reduce((sum, i) => sum + i.count, 0);
  return `${list(fixed)}, and ${num(total)} × ${pool.label} (three stacks of ${pool.stack} per forge, any mix): ${list(mixed)}`;
}

/** Crafts and forges, inputs before outputs, grouped by the part of the goal. */
function make(solved: SolvedPlan, plan: CraftingPlan): string[] {
  const goals = new Set(solved.goals.map((g) => `i${g.itemId}`));
  const several = goals.size > 1;
  const names = new Map(solved.steps.map((s) => [s.key, s.name]));
  const groups = new Map<string, string[]>();
  for (const s of [...solved.steps].reverse()) {
    if (s.action !== 'craft' && s.action !== 'forge') continue;
    // One goal: group by its parts. Several: by the goal that needs them.
    const owners = several ? s.goals : s.components;
    const title = goals.has(s.key)
      ? 'Finish'
      : owners.length === 1
        ? text(names.get(owners[0]!) ?? 'Other')
        : several
          ? 'Shared between goals'
          : 'Shared by several parts';
    (groups.get(title) ?? groups.set(title, []).get(title)!).push(makeLine(s, plan));
  }
  const rank = (title: string) => (title.startsWith('Shared ') ? 0 : title === 'Finish' ? 2 : 1);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([title, lines]) => `### ${title}\n\n${lines.join('\n')}`);
}

const UPDATING = `To change this plan, reply with a JSON update. Steps are named as written above; leave out what you don't need.

\`\`\`json
{
  "choose": { "<step>": "buy | earn | vendor | an ingredient only the wanted recipe uses" },
  "done": ["<step>"],
  "undone": ["<step>"],
  "notes": { "<step>": { "text": "how to get it", "source": "<url>", "gate": "1 per day" } },
  "quantities": { "<something being made>": 0 },
  "order": ["<make first>", "<then>"],
  "settings": { "useOwnMaterials": true, "dailyCrafts": true, "forgePromotions": false, "deductOwnedValue": true, "useBuyOrders": false }
}
\`\`\``;

/** What each setting is called, for the plan's header and the site's checkboxes. */
export const PLAN_SETTING_LABELS: Readonly<Record<keyof PlanSettings, string>> = {
  useOwnMaterials: 'Use my own materials',
  dailyCrafts: 'Craft daily cooldown items',
  forgePromotions: 'Use Mystic Forge promotions',
  deductOwnedValue: 'Subtract my materials from the value',
  useBuyOrders: 'Price by buy orders',
};

/** The gold headline: what is left to pay, or the whole value with owned materials counted in. */
function valueText(plan: CraftingPlan, solved: SolvedPlan, gold: number, scoped: boolean): string {
  const settings = planSettings(plan);
  const priced = `at ${settings.useBuyOrders ? 'highest buy orders' : 'trading post sell listings'} of ${day(plan.data.fetchedAt)}`;
  const owned = scoped ? 0 : Math.max(0, solved.fullCoin - solved.coin);
  if (!owned) return `Gold still to spend: **${coins(gold)}** ${priced}.`;
  return settings.deductOwnedValue
    ? `Gold still to spend: **${coins(gold)}** ${priced}, after your materials (worth ${coins(owned)} here).`
    : `Total value: **${coins(solved.fullCoin)}** ${priced}, including ${coins(owned)} of your own materials; ${coins(gold)} left to spend.`;
}

/** The gold in the wallet against what is left to spend; empty until holdings have been read. */
function walletText(plan: CraftingPlan, gold: number): string {
  if (!plan.holdings.fetchedAt || gold <= 0) return '';
  const have = plan.holdings.wallet[1];
  if (have === undefined) return 'Your gold was not read (the key needs `wallet`), so the shortfall is unknown. ';
  return have >= gold
    ? `Your wallet has ${coins(have)}: enough, with ${coins(have - gold)} to spare. `
    : `Your wallet has ${coins(have)}: **${coins(gold - have)} short**. `;
}

/** What the open purchases would cost the other way: buy orders save gold and take time. */
function orderNote(plan: CraftingPlan, open: PlanStep[]): string {
  const difference = open
    .filter((s) => s.action === 'buy' && s.kind === 'Item')
    .reduce((sum, s) => {
      const item = plan.data.items[s.id];
      return sum + (item?.sell && item.buy ? (item.sell - item.buy) * s.count : 0);
    }, 0);
  if (difference <= 0) return '';
  return planSettings(plan).useBuyOrders
    ? `Orders can take a while to fill; buying at once would cost ${coins(difference)} more. `
    : `Placing buy orders instead would save about ${coins(difference)}. `;
}

/** Shortages listed per goal. */
const LISTED_SHORTAGES = 8;

/** What has to be earned, and the days limits add, by step key. */
function shortages(solved: SolvedPlan): { earn: Map<StepKey, PlanStep>; days: Map<StepKey, number> } {
  const earn = new Map<StepKey, PlanStep>();
  const days = new Map<StepKey, number>();
  for (const s of solved.steps) {
    if (s.count === 0) continue;
    if (s.action === 'earn') earn.set(s.key, s);
    // Days to wait: today's, and this week's, allowance can be used at once.
    const waits = Math.max(
      s.perDay ? Math.ceil(s.count / s.perDay) - 1 : 0,
      s.caps?.daily ? Math.ceil(s.times / s.caps.daily) - 1 : 0,
      s.caps?.weekly ? (Math.ceil(s.times / s.caps.weekly) - 1) * 7 : 0,
    );
    if (waits > 0) days.set(s.key, waits);
  }
  return { earn, days };
}

/**
 * Each goal in priority order, with what it adds to those above it. Goals share
 * stock, so goal k is the plan for goals 1 to k less the one for 1 to k−1.
 */
function goalProgress(plan: CraftingPlan, all: SolvedPlan): string[] {
  const wallet = plan.holdings.fetchedAt ? plan.holdings.wallet[1] : undefined;
  let before = { coin: 0, ...shortages({ goals: [], steps: [], coin: 0, fullCoin: 0 }) };
  const lines = plan.goals.map((goal, i) => {
    const solved = i === plan.goals.length - 1 ? all : solvePlan({ ...plan, goals: plan.goals.slice(0, i + 1) });
    const now = { coin: solved.coin, ...shortages(solved) };
    const more = now.coin - before.coin;
    const gold = more >= 0 ? `**${coins(more)}** more gold` : `**${coins(-more)}** less gold (it changes how shared things are got)`;
    const against =
      wallet === undefined
        ? ''
        : wallet >= now.coin
          ? `; your wallet covers it, with ${coins(wallet - now.coin)} to spare`
          : `; **${coins(now.coin - wallet)} short** of your wallet`;
    const missing = [...now.earn.values()]
      .map((s) => ({ s, count: s.count - (before.earn.get(s.key)?.count ?? 0) }))
      .filter((m) => m.count > 0)
      .sort((a, b) => Number(a.s.kind !== 'Currency') - Number(b.s.kind !== 'Currency') || a.s.name.localeCompare(b.s.name));
    const listed = missing.slice(0, LISTED_SHORTAGES).map((m) => amount(m.count, m.s.name));
    if (missing.length > LISTED_SHORTAGES) listed.push(`and ${num(missing.length - LISTED_SHORTAGES)} more`);
    const names = new Map(solved.steps.map((s) => [s.key, s.name]));
    const gates = [...now.days]
      .map(([key, days]) => ({ key, days: days - (before.days.get(key) ?? 0) }))
      .filter((g) => g.days > 0)
      .sort((a, b) => b.days - a.days)
      .slice(0, LISTED_SHORTAGES)
      .map((g) => `${text(names.get(g.key) ?? g.key)} (${num(g.days)} ${g.days === 1 ? 'day' : 'days'})`);
    before = now;
    return [
      `${i + 1}. ${amount(goal.quantity, goal.name)}: ${gold}, ${coins(now.coin)} up to here${against}.`,
      listed.length ? `   - Still to earn: ${listed.join(', ')}` : '',
      gates.length ? `   - Waiting on daily or weekly limits, if today's and this week's are unused: ${gates.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return ['Holdings and wallet go to earlier items first; each line is what that item adds to those above it.\n', ...lines];
}

/** Markdown for a plan: what to decide, what takes time, what to get and what to make. */
export function renderPlan(whole: CraftingPlan, options: RenderPlanOptions = {}): string {
  const first = options.goals === undefined ? whole.goals.length : Math.max(1, Math.floor(options.goals));
  const cut = first < whole.goals.length;
  const plan = cut ? { ...whole, goals: whole.goals.slice(0, first) } : whole;
  const solved = solvePlan(plan);
  const wanted = options.sections ?? PLAN_SECTIONS;

  let steps = solved.steps;
  let scope = '';
  if (options.component) {
    const name = options.component.trim().toLowerCase();
    const part = steps.find((s) => s.name.toLowerCase() === name);
    if (!part) return `No step named "${text(options.component)}" in this plan.`;
    steps = steps.filter((s) => s.key === part.key || s.components.includes(part.key) || s.goals.includes(part.key));
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
    `# Crafting plan: ${plan.goals.map((g) => amount(g.quantity, g.name)).join(' + ')}`,
    `${valueText(plan, solved, gold, scope !== '')} ` +
      `${walletText(plan, gold)}${orderNote(plan, open)}${num(open.length)} steps open, ${num(research.length)} needing research. ` +
      (!planSettings(plan).useOwnMaterials
        ? 'Your own materials are not used.'
        : holdings.fetchedAt
          ? `Holdings read ${day(holdings.fetchedAt)}.`
          : 'Account holdings are not counted.') +
      (cut ? ` Showing only the first ${num(plan.goals.length)} of ${num(whole.goals.length)} things to make, as if nothing else were planned.` : '') +
      scope,
    `Settings: ${Object.entries(PLAN_SETTING_LABELS)
      .map(([key, label]) => {
        // Nothing of the player's is used until their holdings have been read.
        const needsHoldings = key === 'useOwnMaterials' || key === 'deductOwnedValue';
        const on = planSettings(plan)[key as keyof PlanSettings] && (!needsHoldings || holdings.fetchedAt !== undefined);
        return `${label.toLowerCase()}: ${on ? 'yes' : 'no'}`;
      })
      .join(' · ')}.`,
    ...(averageText(open) ? [averageText(open)] : []),
    ...warnings,
  ];

  const sections: Record<PlanSectionId, [string, () => string[]]> = {
    goals: [
      'One at a time, in priority order',
      () => {
        if (plan.goals.length < 2 || options.component) return [];
        const lines = goalProgress(plan, solved);
        return open.some(isAveraged) ? [...lines, 'These figures assume average Mystic Forge yields.'] : lines;
      },
    ],
    decisions: [
      steps.some((s) => s.undecided) ? 'Decide first' : 'Recipe choices',
      () => decisions(planChoices(plan, { ...solved, steps })),
    ],
    gates: ['Time-gated: start these early', () => gates(steps)],
    acquire: ['Earn', () => acquire(open, plan, averagedInputs(open))],
    buy: ['Buy on the trading post', () => buy(open, plan, averagedInputs(open))],
    vendor: ['Buy from vendors', () => vendor(open, plan, averagedInputs(open))],
    make: ['Make, in order', () => make({ ...solved, steps: steps.filter((s) => s.count > 0) }, plan)],
    covered: [
      'Already covered',
      () =>
        steps
          .filter((s) => s.count === 0)
          .map((s) => {
            const how = s.done
              ? 'done'
              : s.ordered === 0
                ? 'held'
                : `${s.owned > 0 ? `${num(s.owned)} held; ` : ''}on buy order: ${orderList(plan, s.id, 'buys')}`;
            return `- [x] ${amount(s.need, s.name)} (${how})`;
          }),
    ],
    updating: ['Updating this plan', () => [UPDATING]],
  };
  if (options.sales) {
    const { plan: sales, delivery, notes } = options.sales;
    out.push(
      renderSales(sales, { heading: 'Raise the gold from spare materials', ...(delivery ? { delivery } : {}), ...(notes ? { notes } : {}) }),
    );
  }
  for (const id of PLAN_SECTIONS) {
    if (!wanted.includes(id)) continue;
    const [title, lines] = sections[id];
    const body = lines();
    if (body.length) out.push(`## ${title}\n\n${body.join(id === 'make' ? '\n\n' : '\n')}`);
  }
  return `${out.join('\n\n')}\n`;
}
