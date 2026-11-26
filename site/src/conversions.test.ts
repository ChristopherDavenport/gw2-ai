import type { Conversions } from '@gw2-ai/core';
import { describe, expect, it } from 'vitest';
import { ConversionReads, type ConversionKind } from './conversions.js';

const part = (kind: ConversionKind): Conversions => ({
  recipes: [{ kind, output: 2, count: 1, inputs: [[1, 2]] }],
  market: new Map([[1, kind === 'craft' ? { name: 'Ore', book: [{ price: 1, quantity: 1 }] } : { name: 'Ore' }]]),
  notes: [`${kind} note`],
  ...(kind === 'promote' ? { spiritShards: 7 } : {}),
});

const reader = (fail: ConversionKind[] = []) => {
  const calls: ConversionKind[] = [];
  const reads = new ConversionReads(async (kind) => {
    calls.push(kind);
    if (fail.includes(kind)) throw new Error('down');
    return part(kind);
  });
  return { reads, calls };
};

const CRAFT = { craft: true, promote: false };
const BOTH = { craft: true, promote: true };

describe('ConversionReads', () => {
  it('reads each kind once, and only what is wanted', async () => {
    const { reads, calls } = reader();
    expect(reads.get(CRAFT)).toEqual({ notes: ['crafting not checked yet'] });
    await Promise.all([reads.load(CRAFT), reads.load(CRAFT)]);
    await reads.load(BOTH);
    expect(calls).toEqual(['craft', 'promote']);
    expect(reads.get({ craft: false, promote: false })).toEqual({ notes: [] });
    expect(reads.get(CRAFT).conversions!.recipes.map((r) => r.kind)).toEqual(['craft']);
  });

  it('merges both, keeping buy order depth and Spirit Shards', async () => {
    const { reads } = reader();
    await reads.load(BOTH);
    const { conversions, notes } = reads.get(BOTH);
    expect(conversions!.recipes).toHaveLength(2);
    expect(conversions!.market.get(1)!.book).toHaveLength(1);
    expect(conversions!.spiritShards).toBe(7);
    expect(notes).toEqual(['craft note', 'promote note']);
  });

  it('notes a failure, keeps the rest and does not retry', async () => {
    const { reads, calls } = reader(['craft']);
    await reads.load(BOTH);
    await reads.load(BOTH);
    expect(calls).toEqual(['craft', 'promote']);
    const { conversions, notes } = reads.get(BOTH);
    expect(conversions!.recipes.map((r) => r.kind)).toEqual(['promote']);
    expect(notes[0]).toContain('crafting could not be checked');
  });
});
