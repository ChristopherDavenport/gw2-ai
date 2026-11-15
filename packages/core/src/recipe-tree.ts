import type { VendorCaps } from '@gw2kit/wiki';
import { pageUrl } from '@gw2kit/wiki';
import { flattenLeaves, stockUsed, type RecipeTreeNode, type TreeLeaf, type TreeVendor, type TreeVendorOffer } from '@gw2kit/recipes';
import { coins, num, table } from './format.js';

const COIN_CURRENCY = 1;

/**
 * Vendor currencies the gw2-ai tools assume, for FetchRecipeOptions.vendorCurrency.
 * Obsidian Shard (19925): Karma (2), the usual karma-for-obsidian exchange,
 * not the Laurel offer most vendors list.
 */
export const DEFAULT_VENDOR_CURRENCY: ReadonlyMap<number, number> = new Map([[19925, 2]]);

export interface RenderTreeOptions {
  /** Heading for the output. */
  title?: string;
  /** Expand subtrees of nodes that are cheaper to buy. Default false. */
  expandAll?: boolean;
  /** Max tree lines before truncating. Default 150. */
  maxLines?: number;
  /** Include the "craft everything" raw material table. Default true. */
  raw?: boolean;
  /**
   * Wallet balances (currency id → amount, Coin in copper). Adds "In wallet"
   * and "Still needed" columns to the currency table.
   */
  wallet?: ReadonlyMap<number, number>;
}

interface RenderContext {
  forge: boolean;
  vendors: boolean;
  wallet?: ReadonlyMap<number, number>;
}

/** Markdown: summary, indented tree, shopping table, currencies, unpriced leaves. */
export function renderRecipeTree(tree: RecipeTreeNode, options: RenderTreeOptions = {}): string {
  const maxLines = options.maxLines ?? 150;
  const ctx: RenderContext = {
    forge: tree.mysticForge?.status === 'ok',
    vendors: tree.vendors !== undefined && tree.vendors.status !== 'failed',
    ...(options.wallet ? { wallet: options.wallet } : {}),
  };
  const out: string[] = [];
  const total = tree.count + tree.owned;
  out.push(`# ${options.title ?? `Recipe tree: ${num(total)} × ${tree.name} (${tree.itemId})`}`, '');
  out.push(summaryLine(tree, ctx), '');
  out.push(
    ['Prices are current trading post lowest sell listings (instant buy). Craft costs exclude leftover output and assume you know the recipes.', forgeNote(tree), vendorNote(tree)]
      .filter(Boolean)
      .join(' '),
    '',
  );

  const lines: string[] = [];
  let omitted = 0;
  const walk = (n: RecipeTreeNode, depth: number): void => {
    if (lines.length >= maxLines) {
      omitted++;
    } else {
      lines.push(`${'  '.repeat(depth)}- ${nodeLine(n, ctx)}`);
    }
    if (n.best === 'craft' || n.best === 'vendor' || (options.expandAll && n.children.length > 0 && n.best !== 'owned')) {
      for (const c of n.children) walk(c, depth + 1);
    }
  };
  walk(tree, 0);
  out.push('## Tree', '', ...lines);
  if (omitted) out.push('', `_${num(omitted)} more nodes not shown. Query a sub-component's item id for its own tree._`);

  const leaves = flattenLeaves(tree, 'best');
  out.push('', ...leafTables(leaves, 'Materials to buy (cheapest route)', ctx));

  const used = stockUsed(tree);
  if (used.length) {
    out.push('', '## Taken from your holdings', '', table(['Item', 'Item id', 'Count'], used.map((u) => [u.name, u.itemId, num(u.count)])));
  }

  if (options.raw ?? true) {
    const raw = flattenLeaves(tree, 'raw');
    if (!sameLeaves(raw, leaves)) out.push('', ...leafTables(raw, 'Raw materials if you craft every component', ctx));
  }
  return out.join('\n') + '\n';
}

function forgeNote(tree: RecipeTreeNode): string {
  switch (tree.mysticForge?.status) {
    case 'ok':
      return 'Mystic Forge recipes come from the GW2 wiki (the API has none). Chance-based forges such as Mystic Clovers use the wiki\'s average yield, so their counts are expected values, not guarantees.';
    case 'failed':
      return `Looking up Mystic Forge recipes on the wiki failed (${tree.mysticForge.error ?? 'unknown error'}), so forge-made items such as legendary gifts appear as unpriced leaves; check the wiki for them.`;
    default:
      return 'Mystic Forge recipes (most legendary gifts) are not in the API, so those items appear as unpriced leaves; check the wiki for them.';
  }
}

function vendorNote(tree: RecipeTreeNode): string {
  switch (tree.vendors?.status) {
    case 'ok':
      return 'Items with no recipe and no trading post listing are bought from NPC vendors (offers from the wiki) and costed in the currencies those vendors take: a coin-only offer if there is one, else the price most vendors charge, except Obsidian Shards, which assume the karma exchange; other offers are listed on the node.';
    case 'partial':
      return `Vendor offers come from the wiki; some lookups failed (${tree.vendors.error ?? 'unknown error'}), so a few vendor items may show as unpriced.`;
    case 'failed':
      return `Looking up vendor offers on the wiki failed (${tree.vendors.error ?? 'unknown error'}), so vendor items appear as unpriced leaves.`;
    default:
      return '';
  }
}

/** Why an item has no route, given which sources were checked. */
function noRoute(ctx: RenderContext): string {
  if (ctx.forge && ctx.vendors) return 'no crafting or Mystic Forge recipe, no vendor offer and not on the TP: a reward or drop';
  if (ctx.forge) return 'no crafting or Mystic Forge recipe and not on the TP: a vendor, reward or drop';
  return 'no API recipe and not on the TP: Mystic Forge, vendor or drop';
}

function noRecipe(ctx: RenderContext): string {
  return ctx.forge
    ? 'It has no crafting or Mystic Forge recipe: it comes from vendors, rewards or drops, so check its wiki page.'
    : 'There is no crafting-station recipe for it in the API: legendaries, gifts and many trophies are made in the Mystic Forge or bought from vendors, so check its wiki page.';
}

function costText(c: TreeVendorOffer['costs'][number], times = 1): string {
  return c.kind === 'Currency' && c.id === COIN_CURRENCY ? coins(c.amount * times) : `${num(c.amount * times)} ${c.name}`;
}

function offerText(o: TreeVendorOffer): string {
  const more = o.vendors.length > 1 ? ` (${o.vendors.length} vendors)` : '';
  return `${num(o.quantity)} for ${o.costs.map((c) => costText(c)).join(' + ')}${more}`;
}

function capText(caps: VendorCaps, purchases: number): string {
  const limits: [number | undefined, string][] = [
    [caps.daily, 'day'],
    [caps.weekly, 'week'],
    [caps.season, 'season'],
    [caps.character, 'character'],
    [caps.total, 'account, ever'],
  ];
  return limits
    .filter((l): l is [number, string] => l[0] !== undefined)
    .map(([n, per]) => `limit ${num(n)} per ${per}${purchases > n && per !== 'account, ever' ? ` (≈${num(Math.ceil(purchases / n))} ${per}s for ${num(purchases)})` : ''}`)
    .join(', ');
}

function vendorText(v: TreeVendor): string {
  const o = v.offer;
  const who = o.vendors.slice(0, 3).join(', ') + (o.vendors.length > 3 ? ` +${o.vendors.length - 3} more` : '');
  const caps = capText(o.caps, v.purchases);
  const alt = v.alternatives.length ? `; other offers: ${v.alternatives.map(offerText).join('; ')}` : '';
  return `${num(v.purchases)} × (${num(o.quantity)} for ${o.costs.map((c) => costText(c)).join(' + ')}) from ${who}${caps ? `, ${caps}` : ''}${alt}; ${v.url}`;
}

function summaryLine(tree: RecipeTreeNode, ctx: RenderContext): string {
  const partial = tree.complete ? '' : ' + unpriced items listed below';
  const buy = tree.buyPrice !== undefined ? `buy outright: ${coins(tree.buyPrice)}` : 'not buyable on the trading post';
  switch (tree.best) {
    case 'owned':
      return `**You already hold ${num(tree.owned)}; nothing to buy.**`;
    case 'craft':
      return `**Cheapest route: craft for ${coins(tree.cost ?? 0)}${partial}** (${buy}).`;
    case 'vendor':
      return `**Bought from a vendor:** ${tree.vendor ? tree.vendor.offer.costs.map((c) => costText(c, tree.vendor!.purchases)).join(' + ') : '—'} (not on the trading post).`;
    case 'buy':
      return `**Cheapest route: buy for ${coins(tree.cost ?? 0)}**${
        tree.craftCost !== undefined
          ? ` (craft: ${coins(tree.craftCost)}${tree.craftComplete ? '' : ' + unpriced items'}).`
          : `. ${noRecipe(ctx)}`
      }`;
    case 'unavailable':
      return `**No priced route:** it is not on the trading post. ${noRecipe(ctx)}`;
  }
}

function nodeLine(n: RecipeTreeNode, ctx: RenderContext): string {
  if (n.kind === 'Currency' && n.itemId === COIN_CURRENCY) return `${coins(n.count)} in coin`;
  const parts: string[] = [];
  const owned = n.owned && n.count ? ` (+${num(n.owned)} from holdings)` : '';
  const shown = n.count || n.owned;
  const head = `${num(shown)} × ${n.name} \`${n.itemId}\`${n.kind === 'Item' ? '' : ` (${n.kind})`}${owned}`;
  switch (n.best) {
    case 'owned':
      parts.push('**from holdings**');
      break;
    case 'craft':
      parts.push(`**craft** ${coins(n.cost ?? 0)}${n.complete ? '' : ' + unpriced'}`);
      if (n.buyPrice !== undefined) parts.push(`buy ${coins(n.buyPrice)}`);
      break;
    case 'vendor':
      parts.push(`**vendor**${n.complete ? ` ${coins(n.cost ?? 0)}` : ''}`);
      if (n.vendor) parts.push(vendorText(n.vendor));
      break;
    case 'buy':
      parts.push(`**buy** ${coins(n.cost ?? 0)}${n.count > 1 && n.unitPrice ? ` (${coins(n.unitPrice)} ea)` : ''}`);
      if (n.craftCost !== undefined) parts.push(`craft ${coins(n.craftCost)}${n.craftComplete ? '' : ' + unpriced'}`);
      break;
    case 'unavailable':
      if (n.kind === 'Currency') parts.push('**wallet currency**');
      else if (n.kind !== 'Item') parts.push('**unpriced**');
      else if (n.vendorUnmatched) parts.push(`**unpriced**: sold by vendors for a currency this tool couldn't match (${pageUrl(n.name)})`);
      else parts.push(`**unpriced**: ${noRoute(ctx)}? ${pageUrl(n.name)}`);
      break;
  }
  if (n.recipe) {
    const r = n.recipe;
    const alt = n.alternatives ? `, ${n.alternatives} other recipe${n.alternatives > 1 ? 's' : ''}` : '';
    if (r.source === 'mystic-forge') {
      const makes = Number.isInteger(r.output_count)
        ? r.output_count > 1 ? `, makes ${r.output_count} per forge` : ''
        : `, ~${r.output_count} per forge on average`;
      parts.push(`Mystic Forge (×${num(r.crafts)}${makes}${alt}; ${r.wiki?.url ?? pageUrl(n.name)})`);
    } else {
      const makes = r.output_count > 1 ? `, makes ${r.output_count} per craft` : '';
      parts.push(`recipe ${r.id} (${r.disciplines.join('/')} ${r.min_rating}, ×${num(r.crafts)}${makes}${alt})`);
    }
  }
  if (n.stop) parts.push(`not expanded: ${n.stop}`);
  return `${head} — ${parts.join(' · ')}`;
}

function leafTables(leaves: TreeLeaf[], heading: string, ctx: RenderContext): string[] {
  const isCoin = (l: TreeLeaf) => l.kind === 'Currency' && l.itemId === COIN_CURRENCY;
  const priced = leaves.filter((l) => !l.unpriced && !isCoin(l));
  const coin = leaves.filter(isCoin).reduce((s, l) => s + l.count, 0);
  const currencies = leaves.filter((l) => l.kind === 'Currency' && !isCoin(l));
  const unpriced = leaves.filter((l) => l.unpriced && l.kind !== 'Currency');
  const total = priced.reduce((s, l) => s + (l.cost ?? 0), 0) + coin;
  const out = [`## ${heading}`, ''];
  out.push(
    table(
      ['Item', 'Item id', 'Count', 'Unit price', 'Cost'],
      priced.map((l) => [l.name, l.itemId, num(l.count), coins(l.unitPrice ?? 0), coins(l.cost ?? 0)]),
    ),
  );
  const extra = [
    currencies.length ? `${currencies.length} wallet currenc${currencies.length === 1 ? 'y' : 'ies'}` : '',
    unpriced.length ? `${unpriced.length} unpriced item(s)` : '',
  ].filter(Boolean);
  out.push(
    '',
    `**Total: ${coins(total)}**${coin ? ` (includes ${coins(coin)} paid to vendors)` : ''}${extra.length ? ` plus ${extra.join(' and ')}:` : ''}`,
  );
  if (currencies.length) {
    const wallet = ctx.wallet;
    out.push(
      '',
      wallet
        ? table(
            ['Currency', 'Currency id', 'Amount', 'In wallet', 'Still needed'],
            currencies.map((l) => {
              const have = wallet.get(l.itemId) ?? 0;
              return [l.name, l.itemId, num(l.count), num(have), num(Math.max(0, l.count - have))];
            }),
          )
        : table(['Currency', 'Currency id', 'Amount'], currencies.map((l) => [l.name, l.itemId, num(l.count)])),
    );
  }
  if (unpriced.length) {
    out.push(
      '',
      ...unpriced.map((l) =>
        l.kind === 'Item'
          ? `- ${num(l.count)} × ${l.name} (item ${l.itemId}): ${l.vendorUnmatched ? "sold by vendors for a currency this tool couldn't match" : noRoute(ctx)}; see ${pageUrl(l.name)}`
          : `- ${num(l.count)} × ${l.name} (${l.kind} ${l.itemId})`,
      ),
    );
  }
  return out;
}

function sameLeaves(a: TreeLeaf[], b: TreeLeaf[]): boolean {
  if (a.length !== b.length) return false;
  const key = (l: TreeLeaf) => `${l.kind}:${l.itemId}:${l.count}`;
  const set = new Set(a.map(key));
  return b.every((l) => set.has(key(l)));
}
