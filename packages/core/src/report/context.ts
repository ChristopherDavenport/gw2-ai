import { TTL, type Gw2Client, type Permission } from '@gw2-ai/client';

export interface ReportOptions {
  /** Price items at trading post buy-order prices. Costs extra requests. */
  valuation?: boolean;
  /** Max rows in long tables (items, achievements). */
  maxRows?: number;
}

export interface ReportContext {
  client: Gw2Client;
  options: Required<ReportOptions>;
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
    options: { valuation: options.valuation ?? true, maxRows: options.maxRows ?? 200 },
  };
}
