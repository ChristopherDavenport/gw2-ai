import { TTL } from '../cache.js';
import type { Gw2Client } from '../client.js';
import type { Permission } from '../types.js';

export interface ReportOptions {
  /** Price items at trading post buy-order prices. Costs extra requests. */
  valuation?: boolean;
  /** Max rows in long tables (items, achievements). */
  maxRows?: number;
}

export interface ReportContext {
  client: Gw2Client;
  options: Required<ReportOptions>;
  /** Fetch an authenticated endpoint once per report, shared across sections. */
  account<T>(path: string, params?: Record<string, string | number>): Promise<T>;
}

export interface ReportSection {
  id: string;
  title: string;
  /** One line telling a model what the section answers. */
  summary: string;
  permissions: readonly Permission[];
  render(ctx: ReportContext): Promise<string>;
}

export function createContext(client: Gw2Client, options: ReportOptions = {}): ReportContext {
  const memo = new Map<string, Promise<unknown>>();
  return {
    client,
    options: { valuation: options.valuation ?? true, maxRows: options.maxRows ?? 200 },
    account<T>(path: string, params?: Record<string, string | number>): Promise<T> {
      const key = `${path}?${JSON.stringify(params ?? {})}`;
      let p = memo.get(key);
      if (!p) {
        p = client.get<T>(path, { auth: true, ttlMs: TTL.account, ...(params ? { params } : {}) });
        memo.set(key, p);
      }
      return p as Promise<T>;
    },
  };
}
