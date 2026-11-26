/** Gather the recipes and prices `planConversions` needs for an account's materials. */
import { mapLimit, TTL, type Gw2Client, type Permission, type Recipe } from '@gw2kit/client';
import { promotionRecipes, type ConversionData, type ConversionRecipe, type MarketItem } from './convert.js';
import { sellProceeds } from './fees.js';
import { STONES_PER_SHARD } from './promotions-data.js';
import type { Sellable } from './liquidate.js';

const SPIRIT_SHARD = 23;
/** Most materials whose recipes are looked up, the most valuable first. */
const MATERIALS_SEARCHED = 150;
/** Materials worth less than this in all aren't looked up. */
const MIN_STACK = 10_000;

export interface ReadConversionOptions {
  /** Crafting and refinement. Default true. */
  craft?: boolean;
  /** Mystic Forge promotions: random yields, paid partly in Spirit Shards. Default false. */
  promote?: boolean;
}

export interface Conversions extends ConversionData {
  notes: string[];
}

/** Highest rating per crafting discipline across characters. */
async function ratings(client: Gw2Client): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const character of await client.all('/v2/characters', { ttlMs: TTL.account })) {
    for (const c of character.crafting ?? []) out.set(c.discipline, Math.max(out.get(c.discipline) ?? 0, c.rating));
  }
  return out;
}

/** Recipes using the account's materials that this account can craft. */
async function craftRecipes(
  client: Gw2Client,
  permissions: readonly Permission[],
  items: readonly Sellable[],
  notes: string[],
): Promise<ConversionRecipe[]> {
  const worth = (i: Sellable) => (i.buy ?? 0) * i.count;
  const searched = items
    .filter((i) => i.material && worth(i) >= MIN_STACK)
    .sort((a, b) => worth(b) - worth(a))
    .slice(0, MATERIALS_SEARCHED);
  let failed = 0;
  const found = await mapLimit(searched, 8, (i) =>
    client.get('/v2/recipes/search', { query: { input: i.id } }).catch(() => {
      failed++;
      return [];
    }),
  );
  if (failed && failed === searched.length) throw new Error('recipe search failed');
  if (failed) notes.push(`recipe lookup failed for ${failed} materials`);
  const recipes = await client.many('/v2/recipes', found.flat());

  const skill = permissions.includes('characters') ? await ratings(client).catch(() => undefined) : undefined;
  if (!skill) notes.push('crafting ratings unknown (needs `characters`): check each craft is within yours');
  const known = permissions.includes('unlocks')
    ? new Set(await client.get('/v2/account/recipes', { ttlMs: TTL.account }).catch(() => []))
    : undefined;
  if (!known) notes.push('learned recipes unknown (needs `unlocks`): only automatically learned recipes are considered');

  const canCraft = (r: Recipe) =>
    (r.flags.includes('AutoLearned') || known?.has(r.id) === true) &&
    (!skill || r.disciplines.some((d) => (skill.get(d) ?? -1) >= r.min_rating));

  return [...recipes.values()]
    .filter((r) => r.ingredients.every((i) => i.type === 'Item') && canCraft(r))
    .map((r) => ({
      kind: 'craft',
      output: r.output_item_id,
      count: r.output_item_count,
      inputs: r.ingredients.map((i) => [i.id, i.count] as const),
      disciplines: r.disciplines,
      rating: r.min_rating,
    }));
}

/** Recipes and market prices for turning `items` into something else before selling. */
export async function readConversions(
  client: Gw2Client,
  permissions: readonly Permission[],
  items: readonly Sellable[],
  options: ReadConversionOptions = {},
): Promise<Conversions> {
  const notes: string[] = [];
  const owned = new Set(items.map((i) => i.id));
  const all = [
    ...((options.craft ?? true) ? await craftRecipes(client, permissions, items, notes) : []),
    ...(options.promote ? promotionRecipes().filter((r) => r.inputs.some(([id]) => owned.has(id))) : []),
  ];

  const ids = new Set(all.flatMap((r) => [r.output, ...r.inputs.map(([id]) => id)]));
  const [defs, prices] = await Promise.all([client.many('/v2/items', ids), client.many('/v2/commerce/prices', ids)]);
  const market = new Map<number, MarketItem>();
  for (const id of ids) {
    const def = defs.get(id);
    if (!def) continue;
    const price = prices.get(id);
    market.set(id, {
      name: def.name,
      ...(price?.buys.unit_price ? { buy: price.buys.unit_price } : {}),
      ...(price?.sells.unit_price ? { sell: price.sells.unit_price } : {}),
      ...(def.flags.includes('NoSell') || !def.vendor_value ? {} : { vendor: def.vendor_value }),
    });
  }

  // Keep recipes that could pay at today's top prices, then read depth for just those.
  const recipes = all.filter((r) => {
    const out = market.get(r.output);
    if (!out?.sell && !out?.buy) return false;
    const inputs = r.inputs.reduce((sum, [id, n]) => sum + (STONES_PER_SHARD[id] ? 0 : (market.get(id)?.buy ?? 0) * n), 0);
    return sellProceeds(Math.round((out.sell ?? out.buy!) * r.count)) > sellProceeds(Math.max(1, inputs));
  });
  const deep = new Set(recipes.flatMap((r) => [r.output, ...r.inputs.map(([id]) => id)]).filter((id) => market.get(id)?.buy));
  const listings = await client.many('/v2/commerce/listings', deep).catch(() => undefined);
  if (!listings) notes.push('buy order depth unavailable for conversions');
  for (const [id, listing] of listings ?? []) {
    const item = market.get(id);
    if (item) market.set(id, { ...item, book: listing.buys.map((b) => ({ price: b.unit_price, quantity: b.quantity })) });
  }

  const wallet =
    options.promote && permissions.includes('wallet')
      ? await client.get('/v2/account/wallet', { ttlMs: TTL.account }).catch(() => undefined)
      : undefined;
  if (options.promote && !wallet) notes.push('Spirit Shards unknown (needs `wallet`): check you have enough');
  return {
    recipes,
    market,
    notes,
    ...(wallet ? { spiritShards: wallet.find((w) => w.id === SPIRIT_SHARD)?.value ?? 0 } : {}),
  };
}
