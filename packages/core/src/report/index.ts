import type { Gw2Client } from '../client.js';
import { missingPermissions, tokenInfo } from '../permissions.js';
import type { TokenInfo } from '../types.js';
import { characters, overview, wallet } from './account.js';
import { createContext, type ReportOptions, type ReportSection } from './context.js';
import { items, legendaryArmory, materials, unlocks } from './items.js';
import { achievements, resets, wizardsVault } from './progress.js';
import { tradingPost } from './trading.js';

export type { ReportContext, ReportOptions, ReportSection } from './context.js';
export { createContext } from './context.js';
export { collectHoldings } from './items.js';

/** All report sections, in the order they appear in a full report. */
export const SECTIONS: readonly ReportSection[] = [
  overview,
  wallet,
  characters,
  wizardsVault,
  resets,
  items,
  materials,
  tradingPost,
  achievements,
  legendaryArmory,
  unlocks,
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

export interface SectionResult {
  id: string;
  title: string;
  status: 'ok' | 'skipped' | 'error';
  /** Why it was skipped or failed. */
  reason?: string;
  markdown: string;
}

export interface Report {
  markdown: string;
  token: TokenInfo;
  sections: SectionResult[];
  generatedAt: string;
}

export interface BuildReportOptions extends ReportOptions {
  /** Section ids to include. Defaults to all. */
  sections?: readonly string[];
  /** Called as each section finishes, for progress UIs. */
  onSection?: (result: SectionResult) => void;
}

/**
 * Build a markdown report of the account behind `client`'s key. Sections the
 * key lacks permissions for are skipped with a note rather than failing the
 * whole report.
 */
export async function buildReport(client: Gw2Client, options: BuildReportOptions = {}): Promise<Report> {
  const token = await tokenInfo(client);
  const wanted = options.sections ? new Set(options.sections) : undefined;
  const unknown = options.sections?.filter((id) => !SECTION_IDS.includes(id)) ?? [];
  if (unknown.length) throw new Error(`Unknown report sections: ${unknown.join(', ')}. Valid: ${SECTION_IDS.join(', ')}`);

  const ctx = createContext(client, options);
  const chosen = SECTIONS.filter((s) => !wanted || wanted.has(s.id));
  const results = await Promise.all(
    chosen.map(async (s): Promise<SectionResult> => {
      const missing = missingPermissions(token, s.permissions);
      let result: SectionResult;
      if (missing.length) {
        const reason = `API key lacks permission: ${missing.join(', ')}`;
        result = { id: s.id, title: s.title, status: 'skipped', reason, markdown: `_Skipped: ${reason}._` };
      } else {
        try {
          result = { id: s.id, title: s.title, status: 'ok', markdown: await s.render(ctx) };
        } catch (err) {
          const reason = (err as Error).message;
          result = { id: s.id, title: s.title, status: 'error', reason, markdown: `_Failed: ${reason}_` };
        }
      }
      options.onSection?.(result);
      return result;
    }),
  );

  const generatedAt = new Date().toISOString();
  const markdown = renderReport(results, token, generatedAt);
  return { markdown, token, sections: results, generatedAt };
}

function renderReport(results: SectionResult[], token: TokenInfo, generatedAt: string): string {
  const header = [
    '# Guild Wars 2 account report',
    '',
    `Generated ${generatedAt} from the official GW2 API (api.guildwars2.com).`,
    `API key "${token.name}" permissions: ${token.permissions.join(', ')}.`,
    'Ids in the tables are GW2 API ids: look items up at /v2/items/{id} or on wiki.guildwars2.com. Coin amounts are written as g/s/c (100c = 1s, 100s = 1g). Account data can lag the game by up to ~5 minutes.',
    '',
    '## Contents',
    '',
    ...results.map((r) => `- [${r.title}](#${anchor(r.title)})${r.status === 'ok' ? '' : ` (${r.status})`}`),
  ];
  const body = results.map((r) => `## ${r.title}\n\n${r.markdown}`);
  return [header.join('\n'), ...body].join('\n\n') + '\n';
}

/** GitHub-style heading anchor. */
function anchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
