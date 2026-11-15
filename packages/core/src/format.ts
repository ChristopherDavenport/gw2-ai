/** Format copper as "12g 34s 56c". Negative values keep their sign. */
export function coins(copper: number): string {
  const sign = copper < 0 ? '-' : '';
  let c = Math.abs(Math.round(copper));
  const g = Math.floor(c / 10_000);
  c -= g * 10_000;
  const s = Math.floor(c / 100);
  c -= s * 100;
  const parts: string[] = [];
  if (g) parts.push(`${g.toLocaleString('en-US')}g`);
  if (s || (g && c)) parts.push(`${s}s`);
  if (c || parts.length === 0) parts.push(`${c}c`);
  return sign + parts.join(' ');
}

/** Seconds as "123h 45m". Used for character and account age. */
export function hours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toLocaleString('en-US')}h ${m}m`;
}

export function num(n: number): string {
  return n.toLocaleString('en-US');
}

export function pct(current: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.floor((current / total) * 100)}%`;
}

/** ISO timestamp to YYYY-MM-DD. */
export function day(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '—';
}

/**
 * Escape untrusted text (character, guild, key names, objective titles) for
 * inline markdown so it cannot add emphasis, links, HTML or headings to a
 * report a model or renderer will read.
 */
export function text(value: unknown): string {
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/[\\`*_[\]<>#|]/g, (ch) => `\\${ch}`);
}

/**
 * Escape text for a markdown table cell. Lighter than text(): `_` and `#`
 * can't start emphasis or a heading inside a cell in practice, and escaping
 * them would corrupt URLs and snake_case ids that cells often hold.
 */
export function cell(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/[\\`*[\]<>|]/g, (ch) => `\\${ch}`);
}

/** Render a GitHub-flavored markdown table. Returns "_None._" for no rows. */
export function table(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '_None._';
  const lines = [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
  return lines.join('\n');
}

/** Strip the in-game markup (<c=@flavor>...</c>, <br>) from descriptions. */
export function plain(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?c(=[^>]*)?>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
