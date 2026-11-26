#!/usr/bin/env node
// Collect, once, what turning each currency into something to sell takes: the
// recipes and vendor offers, the recorded openings of the containers it buys,
// and how many of everything trade per day, into
// packages/core/src/currency-paths-data.ts. Prices and account contents are
// not stored: those stay live. Re-run when the game changes, or to refresh the
// drop rates and trade volumes (needs `pnpm build` first):
//
//   node scripts/sync-currency-paths.mjs
//
// Every vendor offer listed below is checked against the wiki, and a container
// with too few recorded openings is left out. Items bought with Imperial Favor
// straight from vendors (antique armor, Spindrift weapons) are left out: they
// are worth far less per unit and need weekly unlocks.
import { writeFileSync } from 'node:fs';
import { Gw2Client } from '../packages/client/dist/index.js';
import { createPlan, planFromData, solvePlan, updatePlan } from '../packages/recipes/dist/index.js';
import { WikiClient } from '../packages/wiki/dist/index.js';
import { parseDropRates } from './drop-rates.mjs';

const COIN = 1;
const KARMA = 2;
const VOLATILE_MAGIC = 45;
const FAVOR = 68;
const FINE = 78;
const RARE = 79;
const MASTERWORK = 80;
/** Account-bound items spent like a currency are keyed by their item id. */
const REMNANTS = 104829;
const ITEM_CURRENCIES = new Map([[REMNANTS, 'Curious Mursaat Remnants']]);
const TYRIAN_DEFENSE_SEAL = 60;
const RESIDUE = 105004;

/** Recipes walked upward from an item before giving up on reaching a tradeable one. */
const LEVELS = 3;
const VOLUME_DAYS = 30;
const VOLUME_SOURCE = 'https://api.datawars2.ie/gw2/v1/history';
/** Fewest recorded openings a container's average is taken from. */
const MIN_SAMPLE = 100;
const USER_AGENT = 'gw2-ai/0.1 (Guild Wars 2 tools for AI assistants)';

const GHARR = 'Gharr Leadclaw';
const WARD = 'Ward Trader Sampaguita';
const SEASON_4 = 'a Living World Season 4 vendor (Alaleh, Ethall, Kynon, Mist Warden Quartermaster or Nalar)';

const gw2 = new Gw2Client();
const wiki = new WikiClient();
const today = new Date().toISOString().slice(0, 10);
const volumeFrom = new Date(Date.now() - VOLUME_DAYS * 86_400_000).toISOString().slice(0, 10);

const tradeable = (item) => !item.flags.some((f) => f === 'AccountBound' || f === 'SoulbindOnAcquire');

const idCache = new Map();
async function itemId(title) {
  if (!idCache.has(title)) {
    const id = (await wiki.itemIdsByTitle([title])).get(title);
    if (!id) throw new Error(`no item id for ${title}`);
    idCache.set(title, id);
  }
  return idCache.get(title);
}

const currencyNames = new Map((await gw2.all('/v2/currencies')).map((c) => [c.id, c.name]));
for (const [id, name] of ITEM_CURRENCIES) currencyNames.set(id, name);
const used = new Set();

/**
 * Fail unless the wiki still lists `quantity` of `item` at `vendor` (a page
 * title or the start of one) for exactly these costs, by wiki name, and caps.
 */
async function offered(item, vendor, costs, caps = {}, quantity = 1) {
  const offers = await wiki.vendorOffers(item);
  const same = (offer) =>
    !offer.historical &&
    offer.quantity === quantity &&
    offer.vendor.startsWith(vendor) &&
    offer.costs.length === Object.keys(costs).length &&
    offer.costs.every((c) => costs[c.name] === c.amount) &&
    (offer.caps.daily ?? 0) === (caps.daily ?? 0) &&
    (offer.caps.weekly ?? 0) === (caps.weekly ?? 0);
  if (!offers.some(same)) {
    const seen = offers.filter((o) => o.vendor.startsWith(vendor)).map((o) => `${o.costs.map((c) => `${c.amount} ${c.name}`).join(' + ')} ${JSON.stringify(o.caps)}`);
    throw new Error(`the wiki no longer lists ${item} at ${vendor} for ${JSON.stringify(costs)}; it lists: ${seen.join('; ')}`);
  }
}

// ---------------------------------------------------------------- recipes

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

const volumes = new Map();
/** Average units traded per day over the snapshot's days. */
async function volume(id) {
  if (!volumes.has(id)) {
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch(`${VOLUME_SOURCE}?itemID=${id}&start=${volumeFrom}&end=${today}`, { headers: { 'User-Agent': USER_AGENT } });
      if (response.ok) break;
      await new Promise((done) => setTimeout(done, 2000 * 2 ** attempt));
    }
    if (!response.ok) throw new Error(`volume history for ${id}: HTTP ${response.status}`);
    const days = (await response.json()).filter((d) => d.date.slice(0, 10) < today);
    const average = (key) => (days.length ? Math.round((days.reduce((sum, d) => sum + (d[key] ?? 0), 0) / days.length) * 100) / 100 : 0);
    // `sell_sold`: listings bought; `buy_sold`: instant sales into buy orders.
    volumes.set(id, {
      list: average('sell_sold'),
      instant: average('buy_sold'),
      from: days[0]?.date.slice(0, 10) ?? volumeFrom,
      to: days.at(-1)?.date.slice(0, 10) ?? today,
      days: days.length,
    });
  }
  return volumes.get(id);
}

/** What one `output` takes, from the plan's own solver with nothing held. */
function requirements(data, output, buy = []) {
  let plan = planFromData(data, [{ itemId: output }]);
  // A path is repeated, so it takes no once-a-day craft where the part can be bought.
  plan = { ...plan, settings: { dailyCrafts: false } };
  const choose = (keys, how = 'buy') => {
    const updated = updatePlan(plan, { choose: Object.fromEntries(keys.map((key) => [key, how])) });
    if (updated.errors.length) throw new Error(updated.errors.join(' '));
    plan = updated.plan;
  };
  let solved = solvePlan(plan);
  // The solver buys what costs less than its priced parts; the path is the craft.
  if (solved.steps.find((s) => s.id === output && s.kind === 'Item').action === 'buy') {
    choose([`i${output}`], 'craft');
    solved = solvePlan(plan);
  }
  const forced = solved.steps.filter((s) => buy.includes(s.id) && s.action !== 'buy').map((s) => s.key);
  if (forced.length) {
    choose(forced);
    solved = solvePlan(plan);
  }
  // Random forges are bought instead where they can be: a path's costs have to be certain.
  for (let round = 0; round < 5; round++) {
    const random = solved.steps.filter((s) => s.action === 'forge' && data.items[s.id]?.sell !== undefined && !plan.choices[s.key]);
    if (!random.length) break;
    choose(random.map((s) => s.key));
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
    if (step.kind === 'Item' && ITEM_CURRENCIES.has(step.id)) {
      add(step.id, step.need);
      continue;
    }
    if (step.kind === 'Currency') add(step.id, step.need);
    else if (step.kind === 'GuildUpgrade') unobtainable.push([step.id, step.name, step.need]);
    else if (step.action === 'buy') items.push([step.id, step.count, step.name]);
    else if (step.action === 'earn') unobtainable.push([step.id, step.name, step.count]);
    else if (step.action === 'craft') crafts.push({ output: step.id, recipe: step.route.recipe });
    else if (step.action === 'forge') {
      if (step.route.output < 1 || step.route.pool || step.route.promotion) unobtainable.push([step.id, step.name, step.count]);
    }
    // [what is limited, how much of it one output takes, most of it in a week]
    const weekly = [step.caps?.weekly, step.caps?.daily && step.caps.daily * 7, step.perDay && step.perDay * 7].filter(Boolean);
    if (weekly.length) limits.push([step.name, step.count, Math.min(...weekly)]);
    else if (step.caps) unobtainable.push([step.id, step.name, step.count]);
  }
  return {
    currencies: [...currencies].sort((a, b) => a[0] - b[0]),
    items: items.sort((a, b) => a[0] - b[0]),
    unobtainable,
    limits,
    crafts,
  };
}

/** Paths that craft `outputs`, each paying `currencyOf` it. */
async function craftPaths(outputs, currencyOf, { buy = [], replace } = {}) {
  const { data } = await createPlan(gw2, outputs.map((id) => ({ itemId: id })), 1, { wiki, otherOffers: false });
  if (data.status.mysticForge?.status === 'failed' || (data.status.vendors && data.status.vendors.status !== 'ok')) {
    throw new Error('a wiki lookup failed');
  }
  const solved = outputs.map((output) => {
    const found = { output, ...requirements(data, output, buy) };
    if (!replace) return found;
    // Take `replace.item` from its vendor instead of the trading post.
    const index = found.items.findIndex(([id]) => id === replace.item);
    if (index < 0) throw new Error(`${output} does not take item ${replace.item}`);
    const [[, count]] = found.items.splice(index, 1);
    for (const [id, name, each] of replace.items.map(([id, each, name]) => [id, name, each])) {
      const same = found.items.find((i) => i[0] === id);
      if (same) same[1] += each * count;
      else found.items.push([id, each * count, name]);
    }
    for (const [id, amount] of replace.currencies) {
      const same = found.currencies.find((c) => c[0] === id);
      if (same) same[1] += amount * count;
      else found.currencies.push([id, amount * count]);
    }
    found.items.sort((a, b) => a[0] - b[0]);
    found.currencies.sort((a, b) => a[0] - b[0]);
    return found;
  });
  // The API can list one recipe once per discipline: unlocking any of them counts.
  const same = (a, b) => JSON.stringify(a.ingredients) === JSON.stringify(b.ingredients);
  const variants = ({ output, recipe }) => data.recipes[output].filter((r) => r.source === 'crafting' && same(r, recipe)).map((r) => r.id);
  const recipes = await gw2.many('/v2/recipes', solved.flatMap((p) => p.crafts.flatMap(variants)));
  const paths = [];
  for (const { output, crafts, ...rest } of solved) {
    const currency = currencyOf(rest.currencies.map(([id]) => id));
    if (currency === undefined) throw new Error(`${output} does not take its currency`);
    for (const [id] of rest.currencies) used.add(id);
    paths.push({
      currency,
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
  return paths;
}

/**
 * A path crafted by one known recipe, its item ingredients bought. For recipes
 * that /v2/recipes/search doesn't list (the Rift Motivations).
 */
async function recipePath(recipeId, currency) {
  const recipe = (await gw2.many('/v2/recipes', [recipeId])).get(recipeId);
  if (!recipe) throw new Error(`recipe ${recipeId} not found`);
  const parts = recipe.ingredients.filter((i) => i.type === 'Item');
  const spent = recipe.ingredients.filter((i) => i.type === 'Currency');
  if (parts.length + spent.length !== recipe.ingredients.length || recipe.output_item_count !== 1) throw new Error(`recipe ${recipeId} has changed`);
  if (!spent.some((i) => i.id === currency)) throw new Error(`recipe ${recipeId} no longer takes currency ${currency}`);
  const items = await gw2.many('/v2/items', [recipe.output_item_id, ...parts.map((i) => i.id)]);
  for (const item of items.values()) if (!tradeable(item)) throw new Error(`${item.name} can't be traded`);
  const currencies = spent.map((i) => [i.id, i.count]).sort((a, b) => a[0] - b[0]);
  for (const [id] of currencies) used.add(id);
  const name = items.get(recipe.output_item_id).name;
  return {
    currency,
    output: recipe.output_item_id,
    name,
    currencies,
    items: parts.map((i) => [i.id, i.count, items.get(i.id).name]).sort((a, b) => a[0] - b[0]),
    unobtainable: [],
    limits: [],
    crafts: [
      {
        recipes: [recipe.id],
        name,
        disciplines: recipe.disciplines,
        rating: recipe.min_rating,
        unlock: !recipe.flags.includes('AutoLearned'),
      },
    ],
    volume: await volume(recipe.output_item_id),
  };
}

// ---------------------------------------------------------------- vendor purchases

/** A path that is one purchase: `batch` of `name`, to sell as it is. */
async function buyPath({ currency, name, batch = 1, currencies, items = [], vendor, how, weekly }) {
  const output = await itemId(name);
  const item = (await gw2.many('/v2/items', [output])).get(output);
  if (!tradeable(item)) throw new Error(`${name} can't be traded`);
  for (const [id] of currencies) used.add(id);
  return {
    currency,
    output,
    name,
    ...(batch > 1 ? { batch } : {}),
    vendor,
    ...(how ? { how } : {}),
    currencies,
    items: await Promise.all(items.map(async ([title, count]) => [await itemId(title), count, title])),
    unobtainable: [],
    limits: weekly ? [[name, 1, weekly]] : [],
    crafts: [],
    volume: await volume(output),
  };
}

// ---------------------------------------------------------------- containers

const leftOut = [];

async function dropRates(name) {
  const url = `https://wiki.guildwars2.com/index.php?title=${encodeURIComponent(`${name}/Drop rate`.replace(/ /g, '_'))}&action=raw`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (response.status === 404) return { reason: 'the wiki records no openings of it' };
  if (!response.ok) throw new Error(`drop rates of ${name}: HTTP ${response.status}`);
  const read = parseDropRates(await response.text());
  if (!read) return { reason: 'its recorded openings could not be read reliably' };
  if (read.sample < MIN_SAMPLE) return { reason: `only ${read.sample} openings are recorded (at least ${MIN_SAMPLE} are needed)` };
  return { read };
}

const containers = new Map();
/** Average contents of one `name`; undefined, with a reason noted, without enough data. */
async function container(name) {
  if (containers.has(name)) return containers.get(name);
  const { read, reason } = await dropRates(name);
  if (!read) {
    containers.set(name, { reason });
    return containers.get(name);
  }
  const ids = await wiki.itemIdsByTitle(read.yields.map(([title]) => title));
  const items = await gw2.many('/v2/items', [...ids.values()]);
  const yields = [];
  const unknown = [];
  for (const [title, count] of read.yields) {
    const id = ids.get(title);
    const item = id && items.get(id);
    // Counted as worth nothing.
    if (!item) {
      unknown.push(title);
      continue;
    }
    const vendor = item.flags.includes('NoSell') ? 0 : item.vendor_value;
    const sold = tradeable(item) ? await volume(id) : undefined;
    const average = Math.round(count * 100_000) / 100_000;
    // [id, name, per container, vendor value, listings bought per day, instant sales per day]
    if (average > 0) yields.push([id, item.name, average, vendor, sold?.list ?? 0, sold?.instant ?? 0]);
  }
  console.log(`${name}: ${read.sample} openings, ${yields.length} items, ${read.rejected} rows rejected${unknown.length ? `, unknown: ${unknown.join(', ')}` : ''}`);
  containers.set(name, {
    contents: { sample: read.sample, source: `${name}/Drop rate`, yields },
  });
  return containers.get(name);
}

/** A path that buys `batch` of the container `name` and sells what is in them. */
async function containerPath({ currency, name, batch = 1, currencies, vendor, how, weekly }) {
  const found = await container(name);
  if (!found.contents) {
    leftOut.push([currency, name, found.reason]);
    return [];
  }
  for (const [id] of currencies) used.add(id);
  return [
    {
      currency,
      output: await itemId(name),
      name,
      ...(batch > 1 ? { batch } : {}),
      vendor,
      ...(how ? { how } : {}),
      currencies,
      items: [],
      unobtainable: [],
      limits: weekly ? [[name, batch, weekly]] : [],
      crafts: [],
      contents: name,
    },
  ];
}

// ---------------------------------------------------------------- the paths

const paths = [];

// Imperial Favor: whatever is crafted from the vendor's Blessing.
const blessing = await outputsAbove(await itemId('Blessing of the Jade Empress'));
if (blessing.length < 16) throw new Error(`only ${blessing.length} outputs above Blessing of the Jade Empress`);
paths.push(...(await craftPaths(blessing, (ids) => (ids.includes(FAVOR) ? FAVOR : undefined))));

// Rift essence: the motivations are the tradeable crafts that take it.
paths.push(await recipePath(14029, FINE), await recipePath(14018, MASTERWORK));
const essences = [
  [FINE, 'Fine Rift Essence'],
  [MASTERWORK, 'Masterwork Rift Essence'],
  [RARE, 'Rare Rift Essence'],
];
// Gharr Leadclaw's weekly sale: 42 in all, whichever essence pays.
for (const [currency, essence] of essences) {
  await offered('Astral Fluctuating Mass', GHARR, { [essence]: 25 });
  paths.push(...(await containerPath({ currency, name: 'Astral Fluctuating Mass', currencies: [[currency, 25]], vendor: `${GHARR} (42 a week in all)`, weekly: 42 })));
}
// Seals: 35 essence buys 10, and the bags they pay toward cost 25 (Skritt
// Supply Box 23 without the Dragon Slayer discount), once a day.
for (const [currency, essence] of essences) {
  await offered('Tyrian Defense Seal', GHARR, { [essence]: 35 }, {}, 10);
  const how = `for every 2 bags, buy 50 Tyrian Defense Seals from ${GHARR} (10 for 35 ${essence})`;
  const exchange = "your Wizard's Gobbler or Portable Wizard's Tower Exchange";
  await offered('Medium Karmic Crafting Bag', "Wizard's Gobbler/Crystal Desert", { 'Tyrian Defense Seal': 25 });
  paths.push(
    ...(await containerPath({ currency, name: 'Medium Karmic Crafting Bag', batch: 2, currencies: [[currency, 175]], vendor: exchange, how })),
  );
}
await offered('Skritt Supply Box', "Wizard's Gobbler/Tyrn Ironmaw", { 'Tyrian Defense Seal': 23 }, { daily: 1 });
if ((await container('Skritt Supply Box')).contents) throw new Error('Skritt Supply Box now has enough openings: add its path (70 essence per 20 seals)');
for (const [currency] of essences) leftOut.push([currency, 'Skritt Supply Box', containers.get('Skritt Supply Box').reason]);

// Shipments: a stack of one kind of material, for currency and 1 gold.
for (const name of ['Trophy Shipment', 'Cloth Shipment', 'Leather Shipment', 'Metal Shipment', 'Wood Shipment']) {
  await offered(name, GHARR, { 'Rare Rift Essence': 50, Gold: 1 });
  paths.push(...(await containerPath({ currency: RARE, name, currencies: [[COIN, 10_000], [RARE, 50]], vendor: GHARR })));
  await offered(name, 'Alaleh', { Coin: 10_000, 'Volatile Magic': 250 });
  paths.push(
    ...(await containerPath({ currency: VOLATILE_MAGIC, name, currencies: [[COIN, 10_000], [VOLATILE_MAGIC, 250]], vendor: SEASON_4 })),
  );
}

// Curious Mursaat Remnants.
await offered('Trophy Shipment', WARD, { Coin: 10_000, 'Curious Mursaat Remnants': 15 });
paths.push(...(await containerPath({ currency: REMNANTS, name: 'Trophy Shipment', currencies: [[COIN, 10_000], [REMNANTS, 15]], vendor: WARD })));
await offered('Heavy Crafting Bag', WARD, { 'Curious Mursaat Remnants': 8 }, { daily: 2 });
paths.push(
  ...(await containerPath({ currency: REMNANTS, name: 'Heavy Crafting Bag', currencies: [[REMNANTS, 8]], vendor: `${WARD} (2 a day)`, weekly: 14 })),
);
await offered('Large Crafting Bag', WARD, { 'Curious Mursaat Remnants': 5 });
paths.push(...(await containerPath({ currency: REMNANTS, name: 'Large Crafting Bag', currencies: [[REMNANTS, 5]], vendor: WARD })));

for (const name of ['Honey Flower', 'Lowland Pine Log', 'Charged Titan Ore', 'Mursaat Obsidian Chunk', 'Rotted Titan Amber', 'Titan Heatstone']) {
  await offered(name, WARD, { 'Curious Mursaat Remnants': 12 }, {}, 10);
  paths.push(await buyPath({ currency: REMNANTS, name, batch: 10, currencies: [[REMNANTS, 12]], vendor: WARD }));
}
// Without the Janthir Explorer Proficiency discount.
await offered('Kodan Cache Key', 'Davo Zes', { 'Curious Mursaat Remnants': 2, Karma: 2100 }, { daily: 21 });
paths.push(
  await buyPath({ currency: REMNANTS, name: 'Kodan Cache Key', currencies: [[KARMA, 2100], [REMNANTS, 2]], vendor: 'Davo Zes (21 a day)', weekly: 147 }),
);
await offered('Shard of Bava Nisos', WARD, { 'Amalgamated Gemstone': 1, Karma: 1400, 'Curious Mursaat Remnants': 2 }, { weekly: 20 });
paths.push(
  await buyPath({
    currency: REMNANTS,
    name: 'Shard of Bava Nisos',
    currencies: [[KARMA, 1400], [REMNANTS, 2]],
    items: [['Amalgamated Gemstone', 1]],
    vendor: `${WARD} (20 a week)`,
    weekly: 20,
  }),
);

const intermediates = ['Sweet-Treated Pine Plank', 'Neutralized Titan Alloy', 'Vial of Titan Melted Liquid Obsidian'];
await offered('Mists Gate Residue', WARD, { ...Object.fromEntries(intermediates.map((n) => [n, 1])), 'Curious Mursaat Remnants': 10 });
const residue = await buyPath({
  currency: REMNANTS,
  name: 'Mists Gate Residue',
  currencies: [[REMNANTS, 10]],
  items: intermediates.map((n) => [n, 1]),
  vendor: WARD,
});
paths.push(residue);
const lightborne = (await outputsAbove(RESIDUE)).filter((id) => id !== RESIDUE);
if (lightborne.length < 16) throw new Error(`only ${lightborne.length} outputs above Mists Gate Residue`);
paths.push(
  ...(await craftPaths(lightborne, (ids) => (ids.includes(REMNANTS) ? REMNANTS : undefined), {
    buy: [RESIDUE],
    replace: { item: RESIDUE, items: residue.items, currencies: residue.currencies },
  })).map((p) => ({ ...p, how: `get its Mists Gate Residue from ${WARD}` })),
);

/** What else the currencies buy that could be sold, and why it isn't a path. */
for (const [currency] of essences) {
  for (const [name, why] of [
    ['Karmic crafting bags of other sizes, trophy bags, bags of obsidian and the other 25-seal bags', 'the wiki records no openings of them'],
    ['Rune Bag (rare) and Sigil Bag (rare)', 'the recorded openings are of the Karmic Converter versions'],
    ['Box of WvW Supplies', 'its recorded openings mix experience with items and could not be checked'],
    ['Writs, for Imperial Favor', 'turning essence into favor for the precursors is not followed'],
    ['Map currencies, gobbler exchanges and gifts', 'they buy nothing sold as it is'],
  ]) {
    leftOut.push([currency, name, why]);
  }
}
leftOut.push(
  [REMNANTS, 'Curious Lowland Honeycomb, Curious Mursaat Currency and Ruin Shards (once a day each)', 'they are spent at other vendors, which is not followed'],
  [REMNANTS, 'Ursus Oblige (5 for each remnant consumed)', 'Ursus Oblige is not covered'],
  [VOLATILE_MAGIC, 'Mist-Entangled Item, Volatile Mass', 'the wiki records no openings of them'],
  [VOLATILE_MAGIC, "Plaguedoctor's gear", 'its recipes are bought with Laurels and each piece sells less than once a day'],
  [VOLATILE_MAGIC, "Diviner's gear, Superior Rune and Sigil of the Stars, Corsair consumables", 'none sold for more than their materials when this was collected'],
);

const line = (value) => JSON.stringify(value).replace(/"(\w+)":/g, '$1: ');
const contentNames = [...new Set(paths.map((p) => p.contents).filter(Boolean))];
const constant = (name) => name.toUpperCase().replace(/[^A-Z]+/g, '_');
writeFileSync(
  new URL('../packages/core/src/currency-paths-data.ts', import.meta.url),
  `// Generated by scripts/sync-currency-paths.mjs; do not edit.
// Sources, read ${today}: /v2/recipes and wiki.guildwars2.com vendor and recipe
// data (what each path takes), the wiki's "<Container>/Drop rate" pages
// (average contents of containers, with how many openings are recorded), and
// ${VOLUME_SOURCE} (daily trade volume, averaged over
// the dates given). No prices are stored.
// Direct vendor purchases with Imperial Favor (antique armor, Spindrift
// weapons) are left out.

import type { CurrencyPath, LeftOut, PathContents } from './sales-paths.js';

export const CURRENCY_PATHS_AS_OF = '${today}';

/** The days the trade volumes of containers' contents cover. */
export const CONTENT_VOLUME_DATES = ${line({ from: volumeFrom, to: today })};

/** By wallet currency id, or item id for the account-bound items spent like one. */
export const CURRENCY_NAMES: Readonly<Record<number, string>> = ${line(Object.fromEntries([...used].sort((a, b) => a - b).map((id) => [id, currencyNames.get(id)])))};

export const ITEM_CURRENCIES: readonly number[] = ${line([...ITEM_CURRENCIES.keys()])};

${contentNames.map((name) => `const ${constant(name)}: PathContents = ${line(containers.get(name).contents)};`).join('\n')}

export const CURRENCY_PATHS: readonly CurrencyPath[] = [
${paths.map((p) => `  ${line({ ...p, ...(p.contents ? { contents: `$${constant(p.contents)}$` } : {}) }).replace(/"\$([A-Z_]+)\$"/, '$1')},`).join('\n')}
];

export const CURRENCY_LEFT_OUT: readonly LeftOut[] = ${line(leftOut)};
`,
);
for (const p of paths) {
  console.log(
    p.name,
    line(p.currencies),
    `items ${p.items.length}`,
    p.unobtainable.length ? `UNOBTAINABLE ${line(p.unobtainable)}` : '',
    p.limits.length ? `LIMITS ${line(p.limits)}` : '',
    p.volume ? `list ${p.volume.list}/day instant ${p.volume.instant}/day` : 'container',
  );
}
for (const [currency, name, reason] of leftOut) console.log(`left out (${currencyNames.get(currency)}): ${name}: ${reason}`);
