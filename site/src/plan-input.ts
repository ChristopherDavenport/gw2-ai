/** Parsing for what the player types or pastes into the crafting plan form. Pure. */
import type { PlanNote, PlanUpdate } from '@gw2kit/recipes';

/** An item id (digits only) or an exact item name. Undefined when empty. */
export function parseGoal(input: string): { id: number } | { name: string } | undefined {
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) return { name: value };
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? { id } : undefined;
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

const FIELDS = ['choose', 'done', 'undone', 'notes'];

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
  const size =
    Object.keys(update.choose ?? {}).length +
    (update.done?.length ?? 0) +
    (update.undone?.length ?? 0) +
    Object.keys(update.notes ?? {}).length;
  if (!size) throw new Error('The update is empty.');
  return update;
}
