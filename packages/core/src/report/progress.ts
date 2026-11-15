import { catalog } from '../catalog.js';
import { num, pct, table } from '../format.js';
import type { AccountAchievement, WizardsVaultPeriod } from '../types.js';
import type { ReportSection } from './context.js';

function vaultTable(period: WizardsVaultPeriod): string {
  const rows = period.objectives.map((o) => [
    o.title,
    o.track,
    `${o.progress_current}/${o.progress_complete}`,
    o.claimed ? 'claimed' : o.progress_current >= o.progress_complete ? 'ready to claim' : 'open',
    o.acclaim,
  ]);
  const meta =
    period.meta_progress_complete !== undefined
      ? `Meta: ${period.meta_progress_current ?? 0}/${period.meta_progress_complete}` +
        `${period.meta_reward_claimed ? ' (claimed)' : ''}\n\n`
      : '';
  return meta + table(['Objective', 'Track', 'Progress', 'Status', 'Astral acclaim'], rows);
}

export const wizardsVault: ReportSection = {
  id: 'wizards-vault',
  title: "Wizard's Vault",
  summary: "Daily, weekly and special Wizard's Vault objectives with progress and claim state.",
  permissions: ['account', 'progression'],
  async render(ctx) {
    const periods = ['daily', 'weekly', 'special'] as const;
    const parts = await Promise.all(
      periods.map(async (p) => {
        try {
          const data = await ctx.account<WizardsVaultPeriod>(`/v2/account/wizardsvault/${p}`);
          return `### ${p[0]!.toUpperCase()}${p.slice(1)}\n\n${vaultTable(data)}`;
        } catch (err) {
          return `### ${p}\n\n_Unavailable: ${(err as Error).message}_`;
        }
      }),
    );
    return parts.join('\n\n');
  },
};

/** Completed vs. remaining for a daily/weekly reset list. */
async function resetList(
  ctx: Parameters<ReportSection['render']>[0],
  label: string,
  allPath: string,
  donePath: string,
): Promise<string> {
  const [all, done] = await Promise.all([
    ctx.client.get<{ id: string }[]>(allPath, { params: { ids: 'all' } }),
    ctx.account<string[]>(donePath),
  ]);
  const doneSet = new Set(done);
  const remaining = all.map((x) => x.id).filter((id) => !doneSet.has(id));
  return [
    `**${label}:** ${done.length}/${all.length} done.`,
    `- Done: ${done.length ? done.map((d) => `\`${d}\``).join(', ') : 'none'}`,
    `- Remaining: ${remaining.length ? remaining.map((d) => `\`${d}\``).join(', ') : 'none'}`,
  ].join('\n');
}

export const resets: ReportSection = {
  id: 'resets',
  title: 'Daily and weekly lockouts',
  summary: 'World bosses, map chests and daily crafting done today; raid encounters cleared this week.',
  permissions: ['account', 'progression'],
  async render(ctx) {
    const parts = await Promise.allSettled([
      resetList(ctx, 'World bosses (daily)', '/v2/worldbosses', '/v2/account/worldbosses'),
      resetList(ctx, "Hero's Choice map chests (daily)", '/v2/mapchests', '/v2/account/mapchests'),
      resetList(ctx, 'Daily crafting', '/v2/dailycrafting', '/v2/account/dailycrafting'),
      (async () => {
        const [raids, cleared] = await Promise.all([
          ctx.client.get<{ id: string; wings: { id: string; events: { id: string; type: string }[] }[] }[]>(
            '/v2/raids',
            { params: { ids: 'all' } },
          ),
          ctx.account<string[]>('/v2/account/raids'),
        ]);
        const done = new Set(cleared);
        const rows = raids.flatMap((r) =>
          r.wings.map((w) => {
            const bosses = w.events.filter((e) => e.type === 'Boss');
            const left = bosses.filter((b) => !done.has(b.id)).map((b) => b.id);
            return [w.id, `${bosses.length - left.length}/${bosses.length}`, left.join(', ') || 'all cleared'];
          }),
        );
        return `**Raids (weekly):**\n\n${table(['Wing', 'Bosses cleared', 'Remaining'], rows)}`;
      })(),
    ]);
    return parts
      .map((p) => (p.status === 'fulfilled' ? p.value : `_Unavailable: ${(p.reason as Error).message}_`))
      .join('\n\n');
  },
};

export const achievements: ReportSection = {
  id: 'achievements',
  title: 'Achievements closest to completion',
  summary: 'Unfinished achievements sorted by percent complete, for picking easy next goals.',
  permissions: ['account', 'progression'],
  async render(ctx) {
    const progress = await ctx.account<AccountAchievement[]>('/v2/account/achievements');
    const open = progress
      .filter((a) => !a.done && a.max && (a.current ?? 0) > 0)
      .sort((a, b) => (b.current ?? 0) / (b.max ?? 1) - (a.current ?? 0) / (a.max ?? 1))
      .slice(0, Math.min(ctx.options.maxRows, 50));
    const defs = await catalog.achievements(ctx.client, open.map((a) => a.id));
    const rows = open.map((a) => {
      const def = defs.get(a.id);
      return [
        def?.name ?? `#${a.id}`,
        `${num(a.current ?? 0)}/${num(a.max ?? 0)}`,
        pct(a.current ?? 0, a.max ?? 0),
        def?.requirement.replace(/\s+/g, ' ') ?? '',
        a.id,
      ];
    });
    const doneCount = progress.filter((a) => a.done).length;
    return (
      `${num(doneCount)} achievements complete; ${num(progress.length - doneCount)} tracked but unfinished.\n\n` +
      table(['Achievement', 'Progress', '%', 'Requirement', 'Achievement id'], rows)
    );
  },
};
