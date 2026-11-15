import type { AccountWizardsVaultPeriod, AccountWizardsVaultSpecial } from '@gw2-ai/client';
import { num, pct, table, titleCase } from '../format.js';
import { ACCOUNT, type ReportSection } from './context.js';

type VaultPeriod = AccountWizardsVaultPeriod | AccountWizardsVaultSpecial;
type VaultStatus = 'ready to claim' | 'open' | 'open (progress not tracked by the API)' | 'claimed';

function vaultStatus(o: VaultPeriod['objectives'][number]): VaultStatus {
  if (o.claimed) return 'claimed';
  // Collection objectives report 0/0: the API doesn't track them, which is
  // not the same as complete.
  if (o.progress_complete === 0) return 'open (progress not tracked by the API)';
  return o.progress_current >= o.progress_complete ? 'ready to claim' : 'open';
}

/** Actionable objectives as a table; claimed ones only as a count. */
function vaultTable(period: VaultPeriod): string {
  const rank: Record<VaultStatus, number> = { 'ready to claim': 0, open: 1, 'open (progress not tracked by the API)': 2, claimed: 3 };
  const todo = period.objectives
    .map((o) => ({ o, status: vaultStatus(o) }))
    .filter((x) => x.status !== 'claimed')
    .sort((a, b) => rank[a.status] - rank[b.status] || ratio(b.o) - ratio(a.o));
  const claimed = period.objectives.length - todo.length;
  // The special period has no meta reward.
  const meta =
    'meta_progress_complete' in period
      ? `Meta: ${period.meta_progress_current}/${period.meta_progress_complete}` +
        `${period.meta_reward_claimed ? ' (claimed)' : ''}. `
      : '';
  const head = `${meta}${claimed} of ${period.objectives.length} objectives claimed.`;
  if (!todo.length) return head;
  const rows = todo.map(({ o, status }) => [
    o.title,
    o.track,
    o.progress_complete ? `${o.progress_current}/${o.progress_complete}` : '—',
    status,
    o.acclaim,
  ]);
  return `${head}\n\n${table(['Objective', 'Track', 'Progress', 'Status', 'Astral acclaim'], rows)}`;
}

function ratio(o: { progress_current: number; progress_complete: number }): number {
  return o.progress_complete ? o.progress_current / o.progress_complete : 0;
}

function vaultFact(label: string, period: VaultPeriod): string {
  const open = period.objectives.filter((o) => vaultStatus(o) !== 'claimed').length;
  const meta =
    'meta_progress_complete' in period
      ? `meta ${period.meta_progress_current}/${period.meta_progress_complete}${period.meta_reward_claimed ? ' claimed' : ''}, `
      : '';
  return `${label} ${meta}${open} unclaimed`;
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
    const facts: string[] = [];
    const parts = await Promise.all(
      periods.map(async ([p, load]) => {
        try {
          const period = await load();
          if (p !== 'special') facts.push(vaultFact(p, period));
          return `### ${p[0]!.toUpperCase()}${p.slice(1)}\n\n${vaultTable(period)}`;
        } catch (err) {
          return `### ${p}\n\n_Unavailable: ${errorMessage(err)}_`;
        }
      }),
    );
    if (facts.length) ctx.facts.push({ order: 40, label: "Wizard's Vault", value: facts.sort().join('; ') });
    return parts.join('\n\n');
  },
};

interface ResetResult {
  markdown: string;
  fact: string;
}

/**
 * Remaining entries of a daily/weekly list by readable name. Done entries are
 * only counted: "what's left" is the question this answers.
 */
async function resetList(
  label: string,
  allList: Promise<readonly { id: string }[]>,
  doneList: Promise<readonly string[]>,
  name: (id: string) => string = titleCase,
): Promise<ResetResult> {
  const [all, done] = await Promise.all([allList, doneList]);
  const doneSet = new Set(done);
  const remaining = all.map((x) => x.id).filter((id) => !doneSet.has(id));
  const summary = `${done.length}/${all.length} done`;
  return {
    markdown: `**${label}:** ${summary}.${remaining.length ? ` Remaining: ${remaining.map(name).join(', ')}.` : ''}`,
    fact: `${label} ${summary}`,
  };
}

/** `auric_basin_heros_choice_chest` → `Auric Basin`. */
function mapChestName(id: string): string {
  return titleCase(id.replace(/_heros_choice_chest$/, ''));
}

export const resets: ReportSection = {
  id: 'resets',
  title: 'Daily and weekly lockouts',
  summary: 'World bosses, map chests and daily crafting still available today; raid bosses left this week.',
  permissions: ['account', 'progression'],
  async render(ctx) {
    const parts = await Promise.allSettled([
      resetList('World bosses today', ctx.client.all('/v2/worldbosses'), ctx.client.get('/v2/account/worldbosses', ACCOUNT)),
      resetList("Hero's Choice chests today", ctx.client.all('/v2/mapchests'), ctx.client.get('/v2/account/mapchests', ACCOUNT), mapChestName),
      resetList('Daily crafting', ctx.client.all('/v2/dailycrafting'), ctx.client.get('/v2/account/dailycrafting', ACCOUNT)),
      (async (): Promise<ResetResult> => {
        const [raids, cleared] = await Promise.all([
          ctx.client.all('/v2/raids'),
          ctx.client.get('/v2/account/raids', ACCOUNT),
        ]);
        const done = new Set(cleared);
        let total = 0;
        let killed = 0;
        const rows = raids.flatMap((r) =>
          r.wings.map((w) => {
            const bosses = w.events.filter((e) => e.type === 'Boss');
            const left = bosses.filter((b) => !done.has(b.id));
            total += bosses.length;
            killed += bosses.length - left.length;
            return [titleCase(w.id), `${bosses.length - left.length}/${bosses.length}`, left.map((b) => titleCase(b.id)).join(', ') || 'all cleared'];
          }),
        );
        return {
          markdown: `**Raid bosses this week:** ${killed}/${total} cleared.\n\n${table(['Wing', 'Cleared', 'Remaining'], rows)}`,
          fact: `raid bosses this week ${killed}/${total}`,
        };
      })(),
    ]);
    const facts = parts.flatMap((p) => (p.status === 'fulfilled' ? [p.value.fact] : []));
    if (facts.length) ctx.facts.push({ order: 41, label: 'Lockouts', value: facts.join('; ') });
    return parts
      .map((p) => (p.status === 'fulfilled' ? p.value.markdown : `_Unavailable: ${errorMessage(p.reason)}_`))
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
      .slice(0, ctx.options.detail === 'summary' ? 25 : Math.min(ctx.options.maxRows, 50));
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
    const unfinished = progress.length - doneCount;
    ctx.omissions.push(
      `Achievements: only the ${rows.length} closest to completion of ${num(unfinished)} unfinished; ones with no progress are not listed ` +
        '(one achievement: `gw2_account_get` path `/v2/account/achievements` with params `{"ids": "<id>"}`)',
    );
    return (
      `${num(doneCount)} achievements complete; ${num(unfinished)} tracked but unfinished.\n\n` +
      table(['Achievement', 'Progress', '%', 'Requirement', 'Achievement id'], rows) +
      `\n\n_Showing the ${rows.length} unfinished achievements closest to completion, of ${num(unfinished)}. ` +
      'An achievement missing here may still be in progress: do not assume it is unstarted._'
    );
  },
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
