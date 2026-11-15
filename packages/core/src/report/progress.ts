import type { AccountWizardsVaultPeriod, AccountWizardsVaultSpecial } from '@gw2-ai/client';
import { num, pct, table } from '../format.js';
import { ACCOUNT, type ReportSection } from './context.js';

function vaultTable(period: AccountWizardsVaultPeriod | AccountWizardsVaultSpecial): string {
  const rows = period.objectives.map((o) => [
    o.title,
    o.track,
    `${o.progress_current}/${o.progress_complete}`,
    o.claimed ? 'claimed' : o.progress_current >= o.progress_complete ? 'ready to claim' : 'open',
    o.acclaim,
  ]);
  // The special period has no meta reward.
  const meta =
    'meta_progress_complete' in period
      ? `Meta: ${period.meta_progress_current}/${period.meta_progress_complete}` +
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
    const periods: [label: string, load: () => Promise<AccountWizardsVaultPeriod | AccountWizardsVaultSpecial>][] = [
      ['daily', () => ctx.client.get('/v2/account/wizardsvault/daily', ACCOUNT)],
      ['weekly', () => ctx.client.get('/v2/account/wizardsvault/weekly', ACCOUNT)],
      ['special', () => ctx.client.get('/v2/account/wizardsvault/special', ACCOUNT)],
    ];
    const parts = await Promise.all(
      periods.map(async ([p, load]) => {
        try {
          return `### ${p[0]!.toUpperCase()}${p.slice(1)}\n\n${vaultTable(await load())}`;
        } catch (err) {
          return `### ${p}\n\n_Unavailable: ${errorMessage(err)}_`;
        }
      }),
    );
    return parts.join('\n\n');
  },
};

/** Completed vs. remaining for a daily/weekly reset list. */
async function resetList(
  label: string,
  allList: Promise<readonly { id: string }[]>,
  doneList: Promise<readonly string[]>,
): Promise<string> {
  const [all, done] = await Promise.all([allList, doneList]);
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
      resetList('World bosses (daily)', ctx.client.all('/v2/worldbosses'), ctx.client.get('/v2/account/worldbosses', ACCOUNT)),
      resetList("Hero's Choice map chests (daily)", ctx.client.all('/v2/mapchests'), ctx.client.get('/v2/account/mapchests', ACCOUNT)),
      resetList('Daily crafting', ctx.client.all('/v2/dailycrafting'), ctx.client.get('/v2/account/dailycrafting', ACCOUNT)),
      (async () => {
        const [raids, cleared] = await Promise.all([
          ctx.client.all('/v2/raids'),
          ctx.client.get('/v2/account/raids', ACCOUNT),
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
      .map((p) => (p.status === 'fulfilled' ? p.value : `_Unavailable: ${errorMessage(p.reason)}_`))
      .join('\n\n');
  },
};

export const achievements: ReportSection = {
  id: 'achievements',
  title: 'Achievements closest to completion',
  summary: 'Unfinished achievements sorted by percent complete, for picking easy next goals.',
  permissions: ['account', 'progression'],
  async render(ctx) {
    const progress = await ctx.client.get('/v2/account/achievements', ACCOUNT);
    const open = progress
      .filter((a) => !a.done && a.max && (a.current ?? 0) > 0)
      .sort((a, b) => (b.current ?? 0) / (b.max ?? 1) - (a.current ?? 0) / (a.max ?? 1))
      .slice(0, Math.min(ctx.options.maxRows, 50));
    const defs = await ctx.client.many('/v2/achievements', open.map((a) => a.id));
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
