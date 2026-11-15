import type { AccountMaterial, CommercePrice, InventorySlot, Item } from '@gw2kit/client';
import { byId, nameOf } from '../catalog.js';
import { coins, inlineCounts, num, table } from '../format.js';
import { ACCOUNT, type ReportContext, type ReportSection } from './context.js';

interface Holding {
  id: number;
  count: number;
  where: Map<string, number>;
}

function add(holdings: Map<number, Holding>, slot: InventorySlot | null, where: string): void {
  if (!slot) return;
  let h = holdings.get(slot.id);
  if (!h) {
    h = { id: slot.id, count: 0, where: new Map() };
    holdings.set(slot.id, h);
  }
  h.count += slot.count;
  h.where.set(where, (h.where.get(where) ?? 0) + slot.count);
}

/** Copper value of `count` units at the instant-sell (highest buy order) price. */
function value(prices: Map<number, CommercePrice>, id: number, count: number): number | undefined {
  const p = prices.get(id);
  return p && p.buys.unit_price > 0 ? p.buys.unit_price * count : undefined;
}

/**
 * Legendary and Ascended items with no trading post price: gifts, clovers,
 * ascended chests and gear. Sorting by value alone would bury them, and they
 * are what progression questions are about.
 */
function notable(item: Item | undefined, v: number | undefined): boolean {
  return v === undefined && (item?.rarity === 'Legendary' || item?.rarity === 'Ascended');
}

async function pricesFor(ctx: ReportContext, items: Map<number, Item>): Promise<Map<number, CommercePrice>> {
  if (!ctx.options.valuation) return new Map();
  const tradable = [...items.values()]
    .filter((i) => !i.flags.includes('AccountBound') && !i.flags.includes('SoulbindOnAcquire'))
    .map((i) => i.id);
  return ctx.client.many('/v2/commerce/prices', tradable);
}

/** Gather bank, shared inventory and (if allowed) character bags into one map. */
export async function collectHoldings(ctx: ReportContext): Promise<{ holdings: Map<number, Holding>; notes: string[] }> {
  const holdings = new Map<number, Holding>();
  const notes: string[] = [];
  const [bank, shared, chars] = await Promise.allSettled([
    ctx.client.get('/v2/account/bank', ACCOUNT),
    ctx.client.get('/v2/account/inventory', ACCOUNT),
    ctx.client.all('/v2/characters', ACCOUNT),
  ]);
  if (bank.status === 'fulfilled') for (const s of bank.value) add(holdings, s, 'Bank');
  else notes.push('bank unavailable');
  if (shared.status === 'fulfilled') for (const s of shared.value) add(holdings, s, 'Shared slots');
  if (chars.status === 'fulfilled') {
    for (const ch of chars.value) {
      for (const bag of ch.bags ?? []) for (const s of bag?.inventory ?? []) add(holdings, s, ch.name);
    }
  } else {
    notes.push('character bags unavailable (needs `characters`)');
  }
  return { holdings, notes };
}

/** Rows shown as a table in summary mode; the rest go on one compact line. */
const SUMMARY_ITEM_ROWS = 30;
const SUMMARY_MATERIAL_ROWS = 8;

export const items: ReportSection = {
  id: 'items',
  title: 'Items (bank, shared slots, character bags)',
  summary: 'Every stack the account holds outside material storage, summed across locations, with trading post value.',
  permissions: ['inventories'],
  async render(ctx) {
    const { holdings, notes } = await collectHoldings(ctx);
    const defs = await ctx.client.many('/v2/items', holdings.keys());
    const prices = await pricesFor(ctx, defs);
    const list = [...holdings.values()].map((h) => ({ h, v: value(prices, h.id, h.count) }));
    list.sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || b.h.count - a.h.count);

    const total = list.reduce((sum, x) => sum + (x.v ?? 0), 0);
    if (ctx.options.valuation) {
      ctx.totals.items = total;
      ctx.facts.push({ order: 31, label: 'Items (bank, bags)', value: `${coins(total)} instant-sell, ${num(holdings.size)} distinct items` });
    }
    const summary = ctx.options.detail === 'summary';
    const limit = summary ? SUMMARY_ITEM_ROWS : ctx.options.maxRows;
    const rows = list.slice(0, limit).map(({ h, v }) => {
      const def = defs.get(h.id);
      const where = [...h.where].map(([k, n]) => `${k} ${n}`).join(', ');
      return [def?.name ?? `#${h.id}`, def?.rarity, num(h.count), v === undefined ? '' : coins(v), where, h.id];
    });
    const beyond = list.slice(limit);
    const pinned = summary ? beyond.filter(({ h, v }) => notable(defs.get(h.id), v)) : [];
    const rest = summary ? beyond.filter((x) => !pinned.includes(x)) : beyond;
    const head = [
      `${num(holdings.size)} distinct items.`,
      ctx.options.valuation ? ` Instant-sell value of tradable items: **${coins(total)}**.` : '',
      beyond.length ? ` The ${num(limit)} most valuable are in the table.` : '',
      notes.length ? ` (${notes.join('; ')})` : '',
    ].join('');
    let tail = '';
    if (pinned.length) {
      tail +=
        `\n\n**Notable without a trading post price** (Legendary and Ascended, ${num(pinned.length)}): ` +
        inlineCounts(pinned.map(({ h }) => ({ name: defs.get(h.id)?.name ?? `#${h.id}`, count: h.count })));
    }
    if (rest.length && summary) {
      const restValue = rest.reduce((sum, x) => sum + (x.v ?? 0), 0);
      // Grouped by item type so "which ascended weapons do I have?" is a scan of one line.
      const byType = new Map<string, { name: string; count: number }[]>();
      for (const { h } of rest) {
        const def = defs.get(h.id);
        const type = def?.type ?? 'Unknown';
        byType.set(type, [...(byType.get(type) ?? []), { name: def?.name ?? `#${h.id}`, count: h.count }]);
      }
      const lines = [...byType]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([type, list]) => `- **${type}** (${list.length}): ${inlineCounts(list)}`);
      tail +=
        `\n\nAlso held, by type (${num(rest.length)} more, ${coins(restValue)} together; ` +
        `most are account bound so have no price; locations via the gw2_find_item tool):\n\n${lines.join('\n')}`;
    } else if (rest.length) {
      tail = `\n\n_${num(rest.length)} lower-value items not shown (raise maxRows)._`;
    }
    if (beyond.length) {
      ctx.omissions.push(
        summary
          ? `Items: past the top ${limit}, stacks are listed by name and count only, without locations (\`gw2_find_item\`)`
          : `Items: ${num(rest.length)} lower-value stacks beyond the ${limit}-row table`,
      );
    }
    return `${head}\n\n${table(['Item', 'Rarity', 'Count', 'Value', 'Where', 'Item id'], rows)}${tail}`;
  },
};

export const materials: ReportSection = {
  id: 'materials',
  title: 'Material storage',
  summary: 'Material storage contents grouped by category, with trading post value.',
  permissions: ['inventories'],
  async render(ctx) {
    const [mats, categories] = await Promise.all([
      ctx.client.get('/v2/account/materials', ACCOUNT),
      ctx.client.all('/v2/materials').then(byId),
    ]);
    const held = mats.filter((m) => m.count > 0);
    const defs = await ctx.client.many('/v2/items', held.map((m) => m.id));
    const prices = await pricesFor(ctx, defs);
    const summary = ctx.options.detail === 'summary';

    const byCat = new Map<number, AccountMaterial[]>();
    for (const m of held) byCat.set(m.category, [...(byCat.get(m.category) ?? []), m]);
    let grand = 0;
    const sections = [...byCat]
      .sort(([a], [b]) => (categories.get(a)?.order ?? 0) - (categories.get(b)?.order ?? 0))
      .map(([cat, list]) => {
        const valued = list
          .map((m) => ({ m, v: value(prices, m.id, m.count) }))
          .sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || b.m.count - a.m.count);
        const catTotal = valued.reduce((sum, x) => sum + (x.v ?? 0), 0);
        grand += catTotal;
        const top = summary ? valued.slice(0, SUMMARY_MATERIAL_ROWS) : valued;
        const pinned = summary ? valued.slice(SUMMARY_MATERIAL_ROWS).filter(({ m, v }) => notable(defs.get(m.id), v)) : [];
        const shown = [...top, ...pinned];
        const rest = summary ? valued.filter((x) => !shown.includes(x)) : [];
        const rows = shown.map(({ m, v }) => [
          nameOf(defs, m.id),
          num(m.count),
          v !== undefined ? coins(v) : notable(defs.get(m.id), v) ? 'account bound' : '',
          m.id,
        ]);
        const tail = rest.length
          ? `\n\nAlso: ${inlineCounts(rest.map(({ m }) => ({ name: nameOf(defs, m.id), count: m.count })))}`
          : '';
        const valueNote = ctx.options.valuation ? ` — ${coins(catTotal)}` : '';
        return `### ${nameOf(categories, cat)}${valueNote}\n\n${table(['Material', 'Count', 'Value', 'Item id'], rows)}${tail}`;
      });
    if (summary) {
      ctx.omissions.push('Material storage: the 8 most valuable per category plus Legendary/Ascended ones are table rows; the rest are on `Also` lines, name and count only');
    }
    if (ctx.options.valuation) {
      ctx.totals.materials = grand;
      ctx.facts.push({ order: 30, label: 'Material storage', value: `${coins(grand)} instant-sell, ${num(held.length)} materials` });
    }
    const head = ctx.options.valuation ? `Instant-sell value: **${coins(grand)}**.\n\n` : '';
    return head + sections.join('\n\n');
  },
};

export const legendaryArmory: ReportSection = {
  id: 'legendary-armory',
  title: 'Legendary armory',
  summary: 'Legendary items unlocked in the armory and how many copies are stored.',
  permissions: ['account', 'inventories', 'unlocks'],
  async render(ctx) {
    const entries = await ctx.client.get('/v2/account/legendaryarmory', ACCOUNT);
    const defs = await ctx.client.many('/v2/items', entries.map((e) => e.id));
    const rows = entries
      .map((e) => {
        const d = defs.get(e.id);
        return { name: d?.name ?? `#${e.id}`, type: d?.type ?? '', sub: d ? subtype(d) : '', count: e.count, id: e.id };
      })
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.sub.localeCompare(b.sub))
      .map((r) => [r.name, r.type, r.sub, r.count, r.id]);
    return table(['Item', 'Type', 'Subtype', 'Count', 'Item id'], rows);
  },
};

/**
 * Item subtype for the armory table. Armor adds its weight class, since the
 * armory holds one copy of each piece per weight (e.g. "Gloves (Heavy)").
 */
function subtype(item: Item): string {
  if (item.type === 'Armor') return `${item.details.type} (${item.details.weight_class})`;
  return 'details' in item && 'type' in item.details ? item.details.type : '';
}

type AccountUnlockRoute =
  | '/v2/account/skins'
  | '/v2/account/dyes'
  | '/v2/account/minis'
  | '/v2/account/outfits'
  | '/v2/account/gliders'
  | '/v2/account/mounts/skins'
  | '/v2/account/finishers'
  | '/v2/account/novelties'
  | '/v2/account/titles'
  | '/v2/account/recipes';

type UnlockCatalogRoute =
  | '/v2/skins'
  | '/v2/colors'
  | '/v2/minis'
  | '/v2/outfits'
  | '/v2/gliders'
  | '/v2/mounts/skins'
  | '/v2/finishers'
  | '/v2/novelties'
  | '/v2/titles'
  | '/v2/recipes';

const UNLOCKS: [label: string, accountRoute: AccountUnlockRoute, allRoute: UnlockCatalogRoute][] = [
  ['Skins', '/v2/account/skins', '/v2/skins'],
  ['Dyes', '/v2/account/dyes', '/v2/colors'],
  ['Minis', '/v2/account/minis', '/v2/minis'],
  ['Outfits', '/v2/account/outfits', '/v2/outfits'],
  ['Gliders', '/v2/account/gliders', '/v2/gliders'],
  ['Mount skins', '/v2/account/mounts/skins', '/v2/mounts/skins'],
  ['Finishers', '/v2/account/finishers', '/v2/finishers'],
  ['Novelties', '/v2/account/novelties', '/v2/novelties'],
  ['Titles', '/v2/account/titles', '/v2/titles'],
  ['Recipes', '/v2/account/recipes', '/v2/recipes'],
];

export const unlocks: ReportSection = {
  id: 'unlocks',
  title: 'Collection unlocks',
  summary: 'How many skins, dyes, minis, outfits, gliders, mount skins, finishers, novelties, titles and recipes are unlocked.',
  permissions: ['account', 'unlocks'],
  async render(ctx) {
    const rows = await Promise.all(
      UNLOCKS.map(async ([label, mine, all]) => {
        try {
          const [owned, total] = await Promise.all([
            ctx.client.get(mine, ACCOUNT),
            ctx.client.ids(all),
          ]);
          return [label, num(owned.length), num(total.length), `${Math.floor((owned.length / total.length) * 100)}%`];
        } catch {
          return [label, '—', '—', '—'];
        }
      }),
    );
    return table(['Collection', 'Unlocked', 'Total', '%'], rows);
  },
};
