import { catalog, nameOf } from '../catalog.js';
import { coins, num, table } from '../format.js';
import type {
  AccountMaterial,
  Character,
  Item,
  ItemSlot,
  LegendaryArmoryEntry,
  Price,
} from '../types.js';
import type { ReportContext, ReportSection } from './context.js';

interface Holding {
  id: number;
  count: number;
  where: Map<string, number>;
}

function add(holdings: Map<number, Holding>, slot: ItemSlot | null, where: string): void {
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
function value(prices: Map<number, Price>, id: number, count: number): number | undefined {
  const p = prices.get(id);
  return p && p.buys.unit_price > 0 ? p.buys.unit_price * count : undefined;
}

async function pricesFor(ctx: ReportContext, items: Map<number, Item>): Promise<Map<number, Price>> {
  if (!ctx.options.valuation) return new Map();
  const tradable = [...items.values()]
    .filter((i) => !i.flags.includes('AccountBound') && !i.flags.includes('SoulbindOnAcquire'))
    .map((i) => i.id);
  return catalog.prices(ctx.client, tradable);
}

/** Gather bank, shared inventory and (if allowed) character bags into one map. */
export async function collectHoldings(ctx: ReportContext): Promise<{ holdings: Map<number, Holding>; notes: string[] }> {
  const holdings = new Map<number, Holding>();
  const notes: string[] = [];
  const [bank, shared, chars] = await Promise.allSettled([
    ctx.account<(ItemSlot | null)[]>('/v2/account/bank'),
    ctx.account<(ItemSlot | null)[]>('/v2/account/inventory'),
    ctx.account<Character[]>('/v2/characters', { ids: 'all' }),
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

export const items: ReportSection = {
  id: 'items',
  title: 'Items (bank, shared slots, character bags)',
  summary: 'Every stack the account holds outside material storage, summed across locations, with trading post value.',
  permissions: ['inventories'],
  async render(ctx) {
    const { holdings, notes } = await collectHoldings(ctx);
    const defs = await catalog.items(ctx.client, holdings.keys());
    const prices = await pricesFor(ctx, defs);
    const list = [...holdings.values()].map((h) => ({ h, v: value(prices, h.id, h.count) }));
    list.sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || b.h.count - a.h.count);

    const total = list.reduce((sum, x) => sum + (x.v ?? 0), 0);
    const rows = list.slice(0, ctx.options.maxRows).map(({ h, v }) => {
      const def = defs.get(h.id);
      const where = [...h.where].map(([k, n]) => `${k} ${n}`).join(', ');
      return [def?.name ?? `#${h.id}`, def?.rarity, num(h.count), v === undefined ? '' : coins(v), where, h.id];
    });
    const head = [
      `${num(holdings.size)} distinct items.`,
      ctx.options.valuation ? ` Instant-sell value of tradable items: **${coins(total)}**.` : '',
      list.length > ctx.options.maxRows ? ` Showing the top ${ctx.options.maxRows}.` : '',
      notes.length ? ` (${notes.join('; ')})` : '',
    ].join('');
    return `${head}\n\n${table(['Item', 'Rarity', 'Count', 'Value', 'Where', 'Item id'], rows)}`;
  },
};

export const materials: ReportSection = {
  id: 'materials',
  title: 'Material storage',
  summary: 'Material storage contents grouped by category, with trading post value.',
  permissions: ['inventories'],
  async render(ctx) {
    const [mats, categories] = await Promise.all([
      ctx.account<AccountMaterial[]>('/v2/account/materials'),
      catalog.materialCategories(ctx.client),
    ]);
    const held = mats.filter((m) => m.count > 0);
    const defs = await catalog.items(ctx.client, held.map((m) => m.id));
    const prices = await pricesFor(ctx, defs);

    const byCat = new Map<number, AccountMaterial[]>();
    for (const m of held) byCat.set(m.category, [...(byCat.get(m.category) ?? []), m]);
    let grand = 0;
    const sections = [...byCat]
      .sort(([a], [b]) => (categories.get(a)?.order ?? 0) - (categories.get(b)?.order ?? 0))
      .map(([cat, list]) => {
        let catTotal = 0;
        const rows = list
          .map((m) => ({ m, v: value(prices, m.id, m.count) }))
          .sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || b.m.count - a.m.count)
          .map(({ m, v }) => {
            catTotal += v ?? 0;
            return [nameOf(defs, m.id), num(m.count), v === undefined ? '' : coins(v), m.id];
          });
        grand += catTotal;
        const valueNote = ctx.options.valuation ? ` — ${coins(catTotal)}` : '';
        return `### ${nameOf(categories, cat)}${valueNote}\n\n${table(['Material', 'Count', 'Value', 'Item id'], rows)}`;
      });
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
    const entries = await ctx.account<LegendaryArmoryEntry[]>('/v2/account/legendaryarmory');
    const defs = await catalog.items(ctx.client, entries.map((e) => e.id));
    const rows = entries
      .map((e) => {
        const d = defs.get(e.id);
        const sub = (d?.details?.type as string | undefined) ?? '';
        return [d?.name ?? `#${e.id}`, d?.type, sub, e.count, e.id];
      })
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0])));
    return table(['Item', 'Type', 'Subtype', 'Count', 'Item id'], rows);
  },
};

const UNLOCKS: [label: string, accountPath: string, allPath: string][] = [
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
            ctx.account<unknown[]>(mine),
            ctx.client.listIds(all),
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
