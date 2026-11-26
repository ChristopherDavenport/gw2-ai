/** Make `value` filename-safe, falling back to `fallback` when nothing is left. */
function slug(value: string, fallback: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || fallback;
}

/** `yyyy-mm-dd`, local date. */
function day(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `gw2-<account-name>-<yyyy-mm-dd>.md`, with the account name made filename-safe. Uses the local date. */
export function reportFilename(account: string, date: Date): string {
  return `gw2-${slug(account, 'account')}-${day(date)}.md`;
}

/** `gw2-plan-<goal-name>-<yyyy-mm-dd>.<md|json>`. The name may come from a loaded file. */
export function planFilename(goal: string, date: Date, extension: 'md' | 'json'): string {
  return `gw2-plan-${slug(goal, 'item').slice(0, 80)}-${day(date)}.${extension}`;
}
