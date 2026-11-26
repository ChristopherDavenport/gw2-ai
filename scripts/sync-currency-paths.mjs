#!/usr/bin/env node
// Collect what it takes to craft the tradeable items that a wallet currency
// pays toward, and how many of them trade per day, once, into
// packages/core/src/currency-paths-data.ts. Prices and account contents are
// not stored: those stay live. Re-run when the game changes, or to refresh the
// trade volumes (needs `pnpm build` first):
//
//   node scripts/sync-currency-paths.mjs
//
// Items bought with a currency directly from vendors (for Imperial Favor:
// antique armor and Spindrift weapons) are left out: they are worth far less
// per unit of the currency and need weekly unlocks.
import { writeFileSync } from 'node:fs';
import { Gw2Client } from '../packages/client/dist/index.js';
import { createPlan, planFromData, solvePlan, updatePlan } from '../packages/recipes/dist/index.js';
import { WikiClient } from '../packages/wiki/dist/index.js';

/**
 * One entry per currency: the vendor item it buys that recipes then take. Every
 * tradeable item found upward from it is a path. Add Rift Essence, Mursaat
 * Remnants and the like here.
 */
const SOURCES = [{ currency: 68, via: 'Blessing of the Jade Empress', least: 16 }];

/** Recipes walked upward from `via` before giving up on reaching a tradeable item. */
const LEVELS = 3;
const VOLUME_DAYS = 30;
const VOLUME_SOURCE = 'https://api.datawars2.ie/gw2/v1/history';
const COIN = 1;

const gw2 = new Gw2Client();
const wiki = new WikiClient();
const today = new Date().toISOString().slice(0, 10);

const tradeable = (item) => !item.flags.some((f) => f === 'AccountBound' || f === 'SoulbindOnAcquire');

/** The first tradeable outputs reached by following recipes upward from `id`. */
async function outputsAbove(id) {
  const found = new Set();
  let frontier = [id];
  for (let level = 0; level < LEVELS && frontier.length; level++) {
    const searched = await Promise.all(frontier.map((input) => gw2.get('/v2/recipes/search', { query: { input } })));
    const recipes = await gw2.many('/v2/recipes', searched.flat());
    const outputs = [...new Set([...recipes.values()].map((r) => r.output_item_id))];
    const items = await gw2.many('/v2/items', outputs);
    frontier = [];
    for (const [out, item] of items) {
      if (tradeable(item)) found.add(out);
      else frontier.push(out);
    }
  }
  return [...found].sort((a, b) => a - b);
}

async function volume(id) {
  const start = new Date(Date.now() - VOLUME_DAYS * 86_400_000).toISOString().slice(0, 10);
  const response = await fetch(`${VOLUME_SOURCE}?itemID=${id}&start=${start}&end=${today}`);
  if (!response.ok) throw new Error(`volume history for ${id}: HTTP ${response.status}`);
  const days = (await response.json()).filter((d) => d.date.slice(0, 10) < today);
  if (!days.length) return { list: 0, instant: 0, from: start, to: today, days: 0 };
  const average = (key) => Math.round((days.reduce((sum, d) => sum + (d[key] ?? 0), 0) / days.length) * 100) / 100;
  // `sell_sold`: listings bought; `buy_sold`: instant sales into buy orders.
  return {
    list: average('sell_sold'),
    instant: average('buy_sold'),
    from: days[0].date.slice(0, 10),
    to: days.at(-1).date.slice(0, 10),
    days: days.length,
  };
}

/** What one `output` takes, from the plan's own solver with nothing held. */
function requirements(data, output) {
  let plan = planFromData(data, [{ itemId: output }]);
  // A path is repeated, so it takes no once-a-day craft where the part can be bought.
  plan = { ...plan, settings: { dailyCrafts: false } };
  let solved = solvePlan(plan);
  // Random forges are bought instead where they can be: a path's costs have to be certain.
  for (let round = 0; round < 5; round++) {
    const random = solved.steps.filter((s) => s.action === 'forge' && data.items[s.id]?.sell !== undefined && !plan.choices[s.key]);
    if (!random.length) break;
    const updated = updatePlan(plan, { choose: Object.fromEntries(random.map((s) => [s.key, 'buy'])) });
    if (updated.errors.length) throw new Error(updated.errors.join(' '));
    plan = updated.plan;
    solved = solvePlan(plan);
  }

  const currencies = new Map();
  const items = [];
  const unobtainable = [];
  const limits = [];
  const crafts = [];
  const add = (id, amount) => currencies.set(id, (currencies.get(id) ?? 0) + amount);
  for (const step of solved.steps) {
    for (const input of step.inputs) if (input.key === `c${COIN}`) add(COIN, input.count);
    if (step.kind === 'Currency') add(step.id, step.need);
    else if (step.kind === 'GuildUpgrade') unobtainable.push([step.id, step.name, step.need]);
    else if (step.action === 'buy') items.push([step.id, step.count, step.name]);
    else if (step.action === 'earn') unobtainable.push([step.id, step.name, step.count]);
    else if (step.action === 'craft') crafts.push({ output: step.id, recipe: step.route.recipe });
    else if (step.action === 'forge') {
      if (step.route.output < 1 || step.route.pool || step.route.promotion) unobtainable.push([step.id, step.name, step.count]);
    }
    if (step.caps) limits.push(`${step.name}: ${Object.entries(step.caps).map(([per, n]) => `${n} ${per}`).join(', ')}`);
    if (step.perDay) limits.push(`${step.name}: ${step.perDay} per day`);
  }
  return {
    currencies: [...currencies].sort((a, b) => a[0] - b[0]),
    items: items.sort((a, b) => a[0] - b[0]),
    unobtainable,
    limits,
    crafts,
  };
}

const currencyNames = new Map((await gw2.all('/v2/currencies')).map((c) => [c.id, c.name]));
const paths = [];
const used = new Set();
for (const source of SOURCES) {
  const via = (await wiki.itemIdsByTitle([source.via])).get(source.via);
  if (!via) throw new Error(`no item id for ${source.via}`);
  const outputs = await outputsAbove(via);
  if (outputs.length < source.least) throw new Error(`only ${outputs.length} outputs above ${source.via}`);
  const { data } = await createPlan(gw2, outputs.map((itemId) => ({ itemId })), 1, { wiki, otherOffers: false });
  if (data.status.mysticForge?.status === 'failed' || (data.status.vendors && data.status.vendors.status !== 'ok')) {
    throw new Error('a wiki lookup failed');
  }
  const solved = outputs.map((output) => ({ output, ...requirements(data, output) }));
  // The API can list one recipe once per discipline: unlocking any of them counts.
  const same = (a, b) => JSON.stringify(a.ingredients) === JSON.stringify(b.ingredients);
  const variants = ({ output, recipe }) => data.recipes[output].filter((r) => r.source === 'crafting' && same(r, recipe)).map((r) => r.id);
  const recipes = await gw2.many('/v2/recipes', solved.flatMap((p) => p.crafts.flatMap(variants)));
  for (const { output, crafts, ...rest } of solved) {
    if (!rest.currencies.some(([id]) => id === source.currency)) throw new Error(`${output} does not take ${source.via}`);
    for (const [id] of rest.currencies) used.add(id);
    paths.push({
      currency: source.currency,
      output,
      name: data.items[output].name,
      ...rest,
      crafts: crafts.map((craft) => {
        const found = variants(craft).map((id) => recipes.get(id));
        if (!found.length || found.some((r) => !r)) throw new Error(`recipe for ${craft.output} not found`);
        return {
          recipes: found.map((r) => r.id),
          name: data.items[craft.output].name,
          disciplines: [...new Set(found.flatMap((r) => r.disciplines))],
          rating: Math.min(...found.map((r) => r.min_rating)),
          unlock: found.every((r) => !r.flags.includes('AutoLearned')),
        };
      }),
      volume: await volume(output),
    });
  }
}

const line = (value) => JSON.stringify(value).replace(/"(\w+)":/g, '$1: ');
writeFileSync(
  new URL('../packages/core/src/currency-paths-data.ts', import.meta.url),
  `// Generated by scripts/sync-currency-paths.mjs; do not edit.
// Sources: /v2/recipes and wiki.guildwars2.com vendor and recipe data (what
// each item takes), and ${VOLUME_SOURCE} (daily trade
// volume, averaged over the dates given). No prices are stored.
// Direct vendor purchases with these currencies (antique armor, Spindrift
// weapons) are left out.

import type { CurrencyPath } from './sales-paths.js';

export const CURRENCY_PATHS_AS_OF = '${today}';

export const CURRENCY_NAMES: Readonly<Record<number, string>> = ${line(Object.fromEntries([...used].sort((a, b) => a - b).map((id) => [id, currencyNames.get(id)])))};

export const CURRENCY_PATHS: readonly CurrencyPath[] = [
${paths.map((p) => `  ${line(p)},`).join('\n')}
];
`,
);
for (const p of paths) {
  console.log(
    p.name,
    line(p.currencies),
    `items ${p.items.length}`,
    p.unobtainable.length ? `UNOBTAINABLE ${line(p.unobtainable)}` : '',
    p.limits.length ? `LIMITS ${line(p.limits)}` : '',
    `list ${p.volume.list}/day instant ${p.volume.instant}/day`,
  );
}
