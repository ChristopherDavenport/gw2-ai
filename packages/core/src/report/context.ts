import { TTL, type Gw2Client, type Permission } from '@gw2-ai/client';

export interface ReportOptions {
  /** Price items at trading post buy-order prices. Costs extra requests. */
  valuation?: boolean;
  /**
   * `summary` (default): long lists show their most valuable rows in a table
   * and the rest as a compact `Name ×count` line. `full`: every row in tables.
   */
  detail?: 'summary' | 'full';
  /** Max rows in long tables when `detail` is `full`. */
  maxRows?: number;
}

/**
 * A headline number a section found, shown in the report's "At a glance"
 * block. Models weight the start of a document most and are unreliable at
 * summing table columns, so totals are stated there instead of left to them.
 */
export interface Fact {
  /** Position in the block; lower comes first. */
  order: number;
  label: string;
  value: string;
}

/** Copper values that combine into the total-wealth fact. */
export interface Totals {
  wallet?: number;
  materials?: number;
  items?: number;
}

export interface ReportContext {
  client: Gw2Client;
  options: Required<ReportOptions>;
  facts: Fact[];
  totals: Totals;
}

/**
 * Call options for authenticated routes in a report. The client does not
 * cache authenticated responses by default; a short TTL lets sections that
 * read the same route (e.g. /v2/characters) share one request.
 */
export const ACCOUNT = { ttlMs: TTL.account };

export interface ReportSection {
  id: string;
  title: string;
  /** One line telling a model what the section answers. */
  summary: string;
  permissions: readonly Permission[];
  render(ctx: ReportContext): Promise<string>;
}

export function createContext(client: Gw2Client, options: ReportOptions = {}): ReportContext {
  return {
    client,
    options: {
      valuation: options.valuation ?? true,
      detail: options.detail ?? 'summary',
      maxRows: options.maxRows ?? 200,
    },
    facts: [],
    totals: {},
  };
}
