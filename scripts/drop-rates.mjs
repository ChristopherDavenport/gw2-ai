// Read recorded openings from a wiki "<Container>/Drop rate" page's wikitext.
// Two layouts are understood; anything else, or a row that doesn't add up, is
// left out rather than guessed at. Used by sync-currency-paths.mjs.

const strip = (text) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '');

/** The `{{name ...}}` templates of `text`, each as its body. */
function templates(text, name) {
  const found = [];
  const open = new RegExp(`\\{\\{\\s*${name}\\s*(?=[|}])`, 'g');
  for (const match of text.matchAll(open)) {
    let depth = 0;
    for (let i = match.index; i < text.length - 1; i++) {
      const pair = text.slice(i, i + 2);
      if (pair === '{{') {
        depth++;
        i++;
      } else if (pair === '}}') {
        depth--;
        if (depth === 0) {
          found.push(text.slice(match.index + match[0].length, i));
          break;
        }
        i++;
      }
    }
  }
  return found;
}

/** A template body split at its own `|`, not those inside links or templates. */
function fields(body) {
  const out = [''];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const pair = body.slice(i, i + 2);
    if (pair === '{{' || pair === '[[') depth++;
    else if (pair === '}}' || pair === ']]') depth--;
    else if (body[i] === '|' && depth === 0) {
      out.push('');
      continue;
    } else {
      out[out.length - 1] += body[i];
      continue;
    }
    out[out.length - 1] += pair;
    i++;
  }
  return out.map((f) => f.trim()).filter(Boolean);
}

/**
 * `{{SDRH}}` names the columns and each `{{SDRL}}` is one contributor's totals:
 * `Total` containers opened, and how many of each item came out. A row without a
 * usable `Total`, with a column the header doesn't name, or whose items per
 * container are far from the page's, is rejected.
 */
function summedRows(text) {
  const header = templates(text, 'SDRH');
  if (header.length !== 1) return undefined;
  // `| Item Name | s1 = alias`: rows use the alias, or the name without one.
  const columns = [];
  for (const field of fields(header[0])) {
    const [, key, value] = /^([\w ]+?)\s*=\s*([\s\S]*)$/.exec(field) ?? [];
    if (key === undefined) columns.push({ name: field, key: field });
    else if (/^s\d+$/.test(key) && columns.length) columns.at(-1).key = value.trim();
  }
  const known = new Map(columns.map((c) => [c.key, c.name]));

  const rows = [];
  let rejected = 0;
  for (const body of templates(text, 'SDRL')) {
    let total;
    let ok = true;
    const counts = new Map();
    for (const field of fields(body)) {
      const [, key, value] = /^([^=[{<]+?)\s*=\s*([\s\S]*)$/.exec(field) ?? [];
      // The signature.
      if (key === undefined) continue;
      const number = /^\d+$/.test(value.trim()) ? Number(value) : value.trim() === '' ? 0 : undefined;
      if (key === 'Total') total = number;
      else if (known.has(key) && number !== undefined) counts.set(known.get(key), number);
      else ok = false;
    }
    if (ok && total > 0 && counts.size) rows.push({ total, counts });
    else rejected++;
  }
  return { rows, rejected };
}

/**
 * A table with one line per container opened: cells of `16 {{item icon|Name}}`.
 * A line holding anything else with a number in it is rejected.
 */
function listedRows(text) {
  if (!text.includes('{{Individual contents header}}')) return undefined;
  const rows = [];
  let rejected = 0;
  for (const table of text.match(/\{\|[\s\S]*?\n\|\}/g) ?? []) {
    for (const line of table.split(/\n\|-[^\n]*/).slice(1)) {
      const cells = line
        .replace(/\n\|\}$/, '')
        .split(/\|\||\n\|/)
        .map((c) => c.trim().replace(/^\|\s*/, ''));
      const counts = new Map();
      let ok = true;
      let items = 0;
      for (const cell of cells) {
        const found = /^(\d+)?\s*\{\{item icon\|([^|}]+)\}\}/.exec(cell);
        if (!found) continue;
        const name = found[2].trim();
        counts.set(name, (counts.get(name) ?? 0) + Number(found[1] ?? 1));
        items++;
      }
      if (cells[0]?.startsWith('!')) continue;
      if (!items) {
        if (line.includes('{{item icon')) ok = false;
        else continue;
      }
      if (ok) rows.push({ total: 1, counts });
      else rejected++;
    }
  }
  return { rows, rejected };
}

/** Items per container a row may differ from the page's median by. */
const SPREAD = 0.25;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Average items per container over the rows that hold up:
 * `{ sample, rejected, yields: [name, perContainer][] }`; undefined when the
 * page is in neither layout or no rows are usable.
 */
export function parseDropRates(wikitext) {
  const text = strip(wikitext);
  const summed = summedRows(text);
  const read = summed?.rows.length ? summed : listedRows(text);
  if (!read?.rows.length) return undefined;
  let { rows, rejected } = read;
  if (read === summed) {
    // A row that is off by a lot was mistyped or counts something else.
    const per = (row) => [...row.counts.values()].reduce((a, b) => a + b, 0) / row.total;
    const large = rows.filter((r) => r.total >= 20);
    const usual = median((large.length ? large : rows).map(per));
    const fits = rows.filter((r) => Math.abs(per(r) - usual) <= usual * SPREAD);
    rejected += rows.length - fits.length;
    rows = fits;
  }
  const totals = new Map();
  let sample = 0;
  for (const row of rows) {
    sample += row.total;
    for (const [name, count] of row.counts) totals.set(name, (totals.get(name) ?? 0) + count);
  }
  return { sample, rejected, yields: [...totals].filter(([, n]) => n > 0).map(([name, n]) => [name, n / sample]) };
}
