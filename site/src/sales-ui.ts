/**
 * The raise-gold section, and what the crafting plan shares with it. What the
 * account holds is account data: it stays in memory and is never stored.
 */
import { missingPermissions, type Gw2Client, type TokenInfo } from '@gw2kit/client';
import { planSales, readSellables, renderSales, type SaleOptions, type Sellables } from '@gw2-ai/core';
import { $, describeError, downloadText, setStatus, setupTabs } from './dom.js';
import { salesFilename } from './filename.js';
import { renderMarkdown } from './markdown.js';
import { parseGold, parseKeep, unmatchedKeep } from './sales-input.js';

export interface Account {
  client: Gw2Client;
  token: TokenInfo | undefined;
}

/** What the `<prefix>-method`, `-order`, `-keep` and `-everything` controls say. */
export function readSaleControls(prefix: string): Pick<SaleOptions, 'method' | 'order' | 'everything'> & { keep: string[] } {
  return {
    method: $<HTMLSelectElement>(`${prefix}-method`).value === 'list' ? 'list' : 'instant',
    order: $<HTMLSelectElement>(`${prefix}-order`).value === 'fewest' ? 'fewest' : 'least-loss',
    keep: parseKeep($<HTMLTextAreaElement>(`${prefix}-keep`).value),
    everything: $<HTMLInputElement>(`${prefix}-everything`).checked,
  };
}

export function keepWarning(keep: readonly string[], sellables: Sellables): string {
  const unknown = unmatchedKeep(keep, sellables.items);
  return unknown.length ? `Nothing you can sell is called: ${unknown.join(', ')}. Check the spelling.` : '';
}

/** Read what the account could sell. */
export async function readAccountSellables({ client, token }: Account): Promise<Sellables> {
  const info = token ?? (await client.get('/v2/tokeninfo'));
  return readSellables(client, info.permissions);
}

export function initSalesSection(options: { account(): Account | undefined; cache: { flush(): Promise<void> } }): {
  keyChanged(): void;
} {
  const form = $<HTMLFormElement>('sales-form');
  const targetInput = $<HTMLInputElement>('sales-target');
  const findBtn = $<HTMLButtonElement>('sales-find');
  const hint = $('sales-key-hint');
  const status = $('sales-status');
  const output = $('sales-output');
  const raw = $<HTMLTextAreaElement>('sales-raw');
  const preview = $('sales-panel-preview');
  const copyStatus = $('sales-copy-status');
  const selectTab = setupTabs([$<HTMLButtonElement>('sales-tab-raw'), $<HTMLButtonElement>('sales-tab-preview')]);

  /** The last read, and the client it was made with. */
  let read: { client: Gw2Client; sellables: Sellables } | undefined;
  let reading: Gw2Client | undefined;

  function blocker(): string | undefined {
    const token = options.account()?.token;
    if (!token) return 'Save an API key with the inventories permission to find what you can sell.';
    const missing = missingPermissions(token.permissions, ['inventories']);
    return missing.length ? `Your key needs the ${missing.join(', ')} permission to find what you can sell.` : undefined;
  }

  function updateControls(): void {
    const blocked = blocker();
    findBtn.disabled = blocked !== undefined || reading !== undefined;
    const token = options.account()?.token;
    const gaps = token
      ? [
          missingPermissions(token.permissions, ['characters']).length ? 'without `characters`, character bags are not read' : '',
          missingPermissions(token.permissions, ['tradingpost']).length
            ? 'without `tradingpost`, the delivery box is not checked'
            : '',
        ].filter(Boolean)
      : [];
    hint.textContent = blocked ?? (gaps.length ? `Your key is missing some optional permissions: ${gaps.join('; ')}.` : '');
  }

  function clearOutput(): void {
    output.hidden = true;
    raw.value = '';
    preview.replaceChildren();
    setStatus(copyStatus, '');
  }

  /** Plan the sales again from the last read. */
  function render(): void {
    if (!read) return;
    const target = parseGold(targetInput.value);
    targetInput.setAttribute('aria-invalid', String(target === null));
    if (target === null) {
      clearOutput();
      setStatus(status, 'The gold target must be a number above 0, or blank to list everything.', 'error');
      return;
    }
    const sale = readSaleControls('sales');
    const { sellables } = read;
    const plan = planSales(sellables.items, { ...sale, ...(target === undefined ? {} : { target }) });
    const markdown = `${renderSales(plan, {
      ...(sellables.delivery ? { delivery: sellables.delivery } : {}),
      notes: sellables.notes,
    })}\n`;
    raw.value = markdown;
    preview.replaceChildren(renderMarkdown(markdown));
    output.hidden = false;
    setStatus(copyStatus, '');
    const warning = keepWarning(sale.keep, sellables);
    setStatus(status, warning, warning ? 'error' : 'info');
  }

  form.addEventListener('change', render);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const account = options.account();
    if (!account || blocker() || reading) return;
    if (parseGold(targetInput.value) === null) {
      setStatus(status, 'The gold target must be a number above 0, or blank to list everything.', 'error');
      targetInput.focus();
      return;
    }
    reading = account.client;
    read = undefined;
    clearOutput();
    updateControls();
    setStatus(status, 'Reading your materials, bank, bags and trading post prices...');
    void (async () => {
      try {
        const sellables = await readAccountSellables(account);
        // The key may have been forgotten or replaced meanwhile.
        if (reading !== account.client) return;
        read = { client: account.client, sellables };
        render();
      } catch (err) {
        if (reading === account.client) setStatus(status, describeError(err), 'error');
      } finally {
        if (reading === account.client) reading = undefined;
        updateControls();
        void options.cache.flush();
      }
    })();
  });

  $('sales-copy').addEventListener('click', () => {
    if (!read) return;
    navigator.clipboard.writeText(raw.value).then(
      () => setStatus(copyStatus, 'Copied the sales to the clipboard.', 'ok'),
      () => {
        selectTab(0);
        raw.focus();
        raw.select();
        setStatus(copyStatus, "Couldn't copy automatically. The markdown is selected: press Ctrl+C (Cmd+C on Mac).", 'error');
      },
    );
  });

  $('sales-download').addEventListener('click', () => {
    if (!read) return;
    const name = salesFilename(new Date());
    downloadText(name, raw.value, 'text/markdown');
    setStatus(copyStatus, `Downloaded ${name}.`, 'ok');
  });

  updateControls();

  return {
    keyChanged() {
      const client = options.account()?.client;
      if ((read && read.client !== client) || (reading && reading !== client)) {
        read = undefined;
        reading = undefined;
        clearOutput();
        setStatus(status, '');
      }
      updateControls();
    },
  };
}
