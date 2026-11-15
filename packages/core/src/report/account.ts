import { byId, nameOf } from '../catalog.js';
import { coins, day, hours, num, table, text } from '../format.js';
import { ACCOUNT, type ReportContext, type ReportSection } from './context.js';

const COIN_ID = 1;

export const overview: ReportSection = {
  id: 'overview',
  title: 'Account overview',
  summary: 'Account name, age, expansions owned, guilds, WvW team, fractal level, mastery points.',
  permissions: ['account'],
  async render(ctx: ReportContext) {
    const a = await ctx.client.get('/v2/account', ACCOUNT);
    const guilds = await Promise.all(
      a.guilds.map(async (id) => {
        try {
          const g = await ctx.client.get('/v2/guild/:id', { path: { id } });
          const leader = a.guild_leader?.includes(id) ? ' (leader)' : '';
          return `${text(g.name)} \\[${text(g.tag)}\\]${leader} \`${id}\``;
        } catch {
          return `\`${id}\``;
        }
      }),
    );

    const lines = [
      `- **Account:** ${text(a.name)} (\`${a.id}\`)`,
      `- **Created:** ${day(a.created)}; played ${hours(a.age)}`,
      `- **Access:** ${a.access.join(', ')}`,
      `- **Commander tag:** ${a.commander ? 'yes' : 'no'}`,
      `- **Fractal level:** ${a.fractal_level ?? '— (needs progression)'}`,
      `- **WvW:** rank ${a.wvw.rank ?? '—'}, ${a.wvw.team_id ? `team ${a.wvw.team_id}` : 'no team'}`,
      `- **Guilds:** ${guilds.length ? guilds.join('; ') : 'none'}`,
    ];
    if (a.daily_ap !== undefined) {
      lines.push(`- **Daily/monthly AP:** ${a.daily_ap} / ${a.monthly_ap ?? 0}`);
    }

    // Progression extras are optional: the key may not have the permission.
    const [mastery, luck] = await Promise.allSettled([
      ctx.client.get('/v2/account/mastery/points', ACCOUNT),
      ctx.client.get('/v2/account/luck', ACCOUNT),
    ]);
    if (mastery.status === 'fulfilled') {
      const rows = mastery.value.totals.map((t) => [t.region, t.earned, t.spent, t.earned - t.spent]);
      lines.push('', '### Mastery points', '', table(['Region', 'Earned', 'Spent', 'Unspent'], rows));
    }
    if (luck.status === 'fulfilled') {
      const total = luck.value.find((l) => l.id === 'luck')?.value ?? 0;
      lines.push('', `- **Luck:** ${num(total)}`);
    }
    return lines.join('\n');
  },
};

export const wallet: ReportSection = {
  id: 'wallet',
  title: 'Wallet',
  summary: 'Every currency the account holds (gold, karma, laurels, gems, map currencies...).',
  permissions: ['wallet'],
  async render(ctx) {
    const [entries, currencies] = await Promise.all([
      ctx.client.get('/v2/account/wallet', ACCOUNT),
      ctx.client.all('/v2/currencies').then(byId),
    ]);
    const rows = entries
      .filter((e) => e.value > 0)
      .sort((x, y) => (currencies.get(x.id)?.order ?? 999) - (currencies.get(y.id)?.order ?? 999))
      .map((e) => [
        nameOf(currencies, e.id),
        e.id === COIN_ID ? coins(e.value) : num(e.value),
        e.id,
      ]);
    return table(['Currency', 'Amount', 'Currency id'], rows);
  },
};

export const characters: ReportSection = {
  id: 'characters',
  title: 'Characters',
  summary: 'Each character: profession, active elite spec, level, playtime, crafting disciplines.',
  permissions: ['characters'],
  async render(ctx) {
    const chars = await ctx.client.all('/v2/characters', ACCOUNT);
    const specIds = new Set<number>();
    for (const ch of chars) {
      const active = ch.build_tabs?.find((t) => t.is_active);
      for (const s of active?.build.specializations ?? []) if (s.id) specIds.add(s.id);
    }
    const specs = await ctx.client.many('/v2/specializations', specIds);

    const rows = [...chars]
      .sort((a, b) => b.age - a.age)
      .map((ch) => {
        const active = ch.build_tabs?.find((t) => t.is_active);
        const specNames = (active?.build.specializations ?? [])
          .map((s) => (s.id ? specs.get(s.id) : undefined))
          .filter((s) => s !== undefined);
        const elite = specNames.find((s) => s.elite)?.name;
        const crafting = ch.crafting
          .map((c) => `${c.discipline} ${c.rating}${c.active ? '' : ' (inactive)'}`)
          .join(', ');
        return [
          ch.name,
          ch.profession,
          elite ?? (active ? 'core' : '—'),
          ch.level,
          ch.race,
          hours(ch.age),
          num(ch.deaths),
          crafting || '—',
          day(ch.created),
        ];
      });
    const note = chars.some((c) => c.build_tabs)
      ? ''
      : '\n\n_Elite specs need the `builds` permission._';
    return (
      table(
        ['Name', 'Profession', 'Elite spec', 'Level', 'Race', 'Played', 'Deaths', 'Crafting', 'Created'],
        rows,
      ) + note
    );
  },
};
