/** `gw2-<account-name>-<yyyy-mm-dd>.md`, with the account name made filename-safe. Uses the local date. */
export function reportFilename(account: string, date: Date): string {
  const slug = account.replace(/[^\w.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'account';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `gw2-${slug}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
}
