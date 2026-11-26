import type { Gw2Client, Permission } from '@gw2kit/client';
import type { PlanHoldings } from '@gw2kit/recipes';
import { ACCOUNT, createContext } from './report/context.js';
import { collectHoldings } from './report/items.js';

/**
 * What the account can spend on a plan: bank, shared slots, character bags,
 * material storage and (with `wallet`) wallet balances. Equipped gear, the
 * delivery box and guild storage are not counted. `notes` says what could not
 * be read; `walletRead` tells an unread wallet from an empty one.
 */
export async function readHoldings(
  client: Gw2Client,
  permissions: readonly Permission[],
): Promise<{ holdings: PlanHoldings; notes: string[]; walletRead: boolean }> {
  const [held, materials, wallet] = await Promise.all([
    collectHoldings(createContext(client, { valuation: false })),
    client.get('/v2/account/materials', ACCOUNT).catch(() => undefined),
    permissions.includes('wallet') ? client.get('/v2/account/wallet', ACCOUNT).catch(() => undefined) : undefined,
  ]);
  const notes = [...held.notes];
  const items: Record<number, number> = {};
  for (const h of held.holdings.values()) items[h.id] = (items[h.id] ?? 0) + h.count;
  if (materials) for (const m of materials) if (m.count > 0) items[m.id] = (items[m.id] ?? 0) + m.count;
  if (!materials) notes.push('material storage unavailable');
  if (!wallet) notes.push('wallet unavailable (needs `wallet`)');
  return {
    holdings: {
      items,
      wallet: Object.fromEntries((wallet ?? []).map((w) => [w.id, w.value])),
      fetchedAt: new Date().toISOString(),
    },
    notes,
    walletRead: wallet !== undefined,
  };
}
