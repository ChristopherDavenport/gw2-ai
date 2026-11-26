/**
 * What `readConversions` found for one read of the account. Crafting and
 * promotions are read apart, so changing options reads only what is new, and
 * never the slow recipe lookups twice. Held in memory with the sellables it was
 * read for, and dropped with them.
 */
import type { ConversionData, Conversions, MarketItem } from '@gw2-ai/core';

export type ConversionKind = 'craft' | 'promote';
export type ConversionWants = Record<ConversionKind, boolean>;

const KINDS: readonly ConversionKind[] = ['craft', 'promote'];
const LABEL: Record<ConversionKind, string> = { craft: 'crafting', promote: 'Mystic Forge promotions' };

export class ConversionReads {
  readonly #read: (kind: ConversionKind) => Promise<Conversions>;
  readonly #done = new Map<ConversionKind, Conversions | 'failed'>();
  readonly #pending = new Map<ConversionKind, Promise<void>>();

  constructor(read: (kind: ConversionKind) => Promise<Conversions>) {
    this.#read = read;
  }

  /** Wanted kinds not read yet. A failed read isn't retried until the account is read again. */
  missing(wants: ConversionWants): ConversionKind[] {
    return KINDS.filter((kind) => wants[kind] && !this.#done.has(kind));
  }

  /** Read what is missing. Never rejects: a failure becomes a note. */
  async load(wants: ConversionWants): Promise<void> {
    await Promise.all(
      this.missing(wants).map((kind) => {
        let pending = this.#pending.get(kind);
        if (!pending) {
          pending = this.#read(kind)
            .then(
              (found) => void this.#done.set(kind, found),
              () => void this.#done.set(kind, 'failed'),
            )
            .finally(() => this.#pending.delete(kind));
          this.#pending.set(kind, pending);
        }
        return pending;
      }),
    );
  }

  /** The wanted data that has been read, and what to say about the rest. */
  get(wants: ConversionWants): { conversions?: ConversionData; notes: string[] } {
    const notes: string[] = [];
    const parts: Conversions[] = [];
    for (const kind of KINDS) {
      if (!wants[kind]) continue;
      const part = this.#done.get(kind);
      if (part === undefined) notes.push(`${LABEL[kind]} not checked yet`);
      else if (part === 'failed') notes.push(`${LABEL[kind]} could not be checked, so materials are sold without it (read what you can sell again to retry)`);
      else {
        parts.push(part);
        notes.push(...part.notes);
      }
    }
    return { ...(parts.length ? { conversions: merge(parts) } : {}), notes };
  }
}

function merge(parts: readonly ConversionData[]): ConversionData {
  const market = new Map<number, MarketItem>();
  for (const part of parts) {
    for (const [id, item] of part.market) {
      // Buy order depth is only read where it was needed, so keep the entry that has it.
      if (!market.get(id)?.book) market.set(id, item);
    }
  }
  const shards = parts.find((p) => p.spiritShards !== undefined)?.spiritShards;
  return {
    recipes: parts.flatMap((p) => p.recipes),
    market,
    ...(shards === undefined ? {} : { spiritShards: shards }),
  };
}
