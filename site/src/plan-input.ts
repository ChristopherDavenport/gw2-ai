/** Parsing for what the player types or pastes into the crafting plan form. Pure. */
import type { PlanNote, PlanUpdate } from '@gw2kit/recipes';

export const MAX_QUANTITY = 10_000;

/** Trimmed, single spaced, with the apostrophe item names use. */
export const cleanName = (input: string): string => input.trim().replace(/\s+/g, ' ').replace(/\u2019/g, "'");

export type Goal = { id: number } | { name: string };

/** An item id (digits only) or an exact item name. Undefined when empty. */
export function parseGoal(input: string): Goal | undefined {
  const value = cleanName(input);
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) return { name: value };
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? { id } : undefined;
}

/** A quantity typed for one item; undefined unless it is a whole number a plan accepts. */
export function parseQuantity(input: string): number | undefined {
  const quantity = Number(input);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY ? quantity : undefined;
}

export const QUANTITY_ERROR = `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`;

export type Entry =
  | { goal: Goal; input: string; quantity: number }
  | { error: string; field: 'item' | 'quantity' };

/**
 * The item and quantity typed to add one item. The name is never split, since
 * names can hold commas and apostrophes.
 */
export function parseEntry(item: string, typed: string): Entry {
  const goal = parseGoal(item);
  if (!goal) return { error: 'Enter an item name or id.', field: 'item' };
  const quantity = parseQuantity(typed);
  return quantity === undefined ? { error: QUANTITY_ERROR, field: 'quantity' } : { goal, input: item, quantity };
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function tryJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** The one JSON object in `text`: the whole of it, or a fenced block among prose. */
function findJson(text: string): Json {
  const source = text.replace(/\r\n?/g, '\n').trim();
  if (!source) throw new Error("Paste the AI's reply, or just its JSON update, first.");
  const whole = tryJson(source);
  if ('value' in whole && isRecord(whole.value)) return whole.value;

  const found: Json[] = [];
  let broken = '';
  const fence = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
  for (const [, , language = '', body = ''] of source.matchAll(fence)) {
    if (language && language.toLowerCase() !== 'json') continue;
    const parsed = tryJson(body);
    if ('error' in parsed) broken = parsed.error;
    else if (isRecord(parsed.value)) found.push(parsed.value);
  }
  if (broken) throw new Error(`A JSON block doesn't parse: ${broken}`);
  if (found.length > 1) throw new Error(`Found ${found.length} JSON blocks. Paste only the update to apply.`);
  if (found[0]) return found[0];
  if (source.startsWith('{') && 'error' in whole) throw new Error(`The JSON doesn't parse: ${whole.error}`);
  throw new Error('No JSON update found: paste a JSON object, or a reply with a ```json block.');
}

function entries(value: unknown, field: string): [string, unknown][] {
  if (!isRecord(value)) throw new Error(`"${field}" must be an object of step names.`);
  return Object.entries(value);
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string')) {
    throw new Error(`"${field}" must be a list of step names.`);
  }
  return value;
}

/** Keeps only the note's known fields. */
function note(value: unknown, step: string): PlanNote | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.text !== 'string') throw new Error(`The note for "${step}" needs a "text" string, or null.`);
  const out: PlanNote = { text: value.text };
  for (const key of ['source', 'gate'] as const) {
    const field = value[key];
    if (field === undefined || field === null || field === '') continue;
    if (typeof field !== 'string') throw new Error(`"${key}" in the note for "${step}" must be a string.`);
    // The plan's markdown prints the source as is, so it must not be able to start new lines.
    out[key] = field.replace(/\s+/g, ' ').trim();
  }
  return out;
}

const FIELDS = ['choose', 'done', 'undone', 'notes', 'quantities', 'settings'];

/**
 * The update in a pasted reply, checked for shape. Whether the steps and routes
 * exist is for updatePlan to say. Throws with a message for the player.
 */
export function parsePlanUpdate(text: string): PlanUpdate {
  const json = findJson(text);
  const unknown = Object.keys(json).filter((k) => !FIELDS.includes(k));
  if (unknown.length) throw new Error(`Unknown field "${unknown[0]}". An update has only ${FIELDS.join(', ')}.`);

  const update: PlanUpdate = {};
  if (json.choose !== undefined) {
    update.choose = Object.fromEntries(
      entries(json.choose, 'choose').map(([step, route]) => {
        if (route !== null && typeof route !== 'string') throw new Error(`The choice for "${step}" must be a string or null.`);
        return [step, route];
      }),
    );
  }
  if (json.done !== undefined) update.done = strings(json.done, 'done');
  if (json.undone !== undefined) update.undone = strings(json.undone, 'undone');
  if (json.notes !== undefined) {
    update.notes = Object.fromEntries(entries(json.notes, 'notes').map(([step, value]) => [step, note(value, step)]));
  }
  if (json.quantities !== undefined) {
    update.quantities = Object.fromEntries(
      entries(json.quantities, 'quantities').map(([goal, value]) => {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_QUANTITY) {
          throw new Error(`The quantity of "${goal}" must be a whole number from 0 (remove it) to ${MAX_QUANTITY}.`);
        }
        return [goal, value];
      }),
    );
  }
  if (json.settings !== undefined) {
    update.settings = Object.fromEntries(
      entries(json.settings, 'settings').map(([name, value]) => {
        if (typeof value !== 'boolean') throw new Error(`The setting "${name}" must be true or false.`);
        return [name, value];
      }),
    );
  }
  const size =
    Object.keys(update.settings ?? {}).length +
    Object.keys(update.quantities ?? {}).length +
    Object.keys(update.choose ?? {}).length +
    (update.done?.length ?? 0) +
    (update.undone?.length ?? 0) +
    Object.keys(update.notes ?? {}).length;
  if (!size) throw new Error('The update is empty.');
  return update;
}
