/**
 * The raise-gold section, and what the crafting plan shares with it. What the
 * account holds is account data: it stays in memory and is never stored.
 */
import { missingPermissions, type Gw2Client, type TokenInfo } from '@gw2kit/client';
import { planSales, readConversions, readSellables, renderSales, type SaleOptions, type Sellables } from '@gw2-ai/core';
import { ConversionReads, type ConversionKind, type ConversionWants } from './conversions.js';
import { $, describeError, downloadText, setStatus, setupTabs, startClock } from './dom.js';
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

/** What the `<prefix>-craft` and `-promote` boxes say. */
export function readConvertControls(prefix: string): ConversionWants {
  return { craft: $<HTMLInputElement>(`${prefix}-craft`).checked, promote: $<HTMLInputElement>(`${prefix}-promote`).checked };
}

/** What to say while `kinds` are being read. */
export const checkingText = (kinds: readonly ConversionKind[]): string =>
  kinds.includes('craft')
    ? 'Checking which materials are worth crafting first. Looking up recipes takes about 20 seconds...'
    : 'Checking Mystic Forge promotions...';

/** One read of the account: what can be sold, and the conversions looked up for it so far. */
export interface AccountSales {
  sellables: Sellables;
  conversions: ConversionReads;
}

/** Read what the account could sell. Conversions are read when first asked for. */
export async function readAccountSellables({ client, token }: Account): Promise<AccountSales> {
  const info = token ?? (await client.get('/v2/tokeninfo'));
  const sellables = await readSellables(client, info.permissions);
  const conversions = new ConversionReads((kind) =>
    readConversions(client, info.permissions, sellables.items, { craft: kind === 'craft', promote: kind === 'promote' }),
  );
  return { sellables, conversions };
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
  let read: (AccountSales & { client: Gw2Client }) | undefined;
  /** Set while the account or conversions are being read. */
  let reading: Gw2Client | undefined;
  let stopClock = () => {};

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
          missingPermissions(token.permissions, ['unlocks']).length
            ? 'without `unlocks`, only automatically learned recipes are considered'
            : '',
          missingPermissions(token.permissions, ['wallet']).length
            ? 'without `wallet`, Spirit Shards for promotions are not checked'
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
    // While reading, the output would not yet match the options.
    if (!read || reading) return;
    const target = parseGold(targetInput.value);
    targetInput.setAttribute('aria-invalid', String(target === null));
    if (target === null) {
      clearOutput();
      setStatus(status, 'The gold target must be a number above 0, or blank to list everything.', 'error');
      return;
    }
    const sale = readSaleControls('sales');
    const { sellables } = read;
    const { conversions, notes } = read.conversions.get(readConvertControls('sales'));
    const plan = planSales(sellables.items, {
      ...sale,
      ...(target === undefined ? {} : { target }),
      ...(conversions ? { conversions } : {}),
    });
    const markdown = `${renderSales(plan, {
      ...(sellables.delivery ? { delivery: sellables.delivery } : {}),
      notes: [...sellables.notes, ...notes],
    })}\n`;
    raw.value = markdown;
    preview.replaceChildren(renderMarkdown(markdown));
    output.hidden = false;
    setStatus(copyStatus, '');
    const warning = keepWarning(sale.keep, sellables);
    setStatus(status, warning, warning ? 'error' : 'info');
  }

  /**
   * Run a read for `client`, then plan the sales. `current` turns false once the
   * key is forgotten or replaced, and what the read found is then dropped.
   */
  async function whileReading(client: Gw2Client, task: (current: () => boolean) => Promise<void>): Promise<void> {
    const current = () => reading === client;
    reading = client;
    clearOutput();
    updateControls();
    stopClock = startClock($('sales-elapsed'));
    let failed = false;
    try {
      await task(current);
    } catch (err) {
      failed = true;
      if (current()) setStatus(status, describeError(err), 'error');
    }
    if (current()) {
      reading = undefined;
      stopClock();
      updateControls();
      if (!failed) render();
    }
    void options.cache.flush();
  }

  /** Read the conversions the boxes ask for; they may be changed while this runs. */
  async function loadConversions(conversions: ConversionReads, current: () => boolean): Promise<void> {
    let missing = conversions.missing(readConvertControls('sales'));
    while (missing.length && current()) {
      setStatus(status, checkingText(missing));
      await conversions.load(readConvertControls('sales'));
      missing = conversions.missing(readConvertControls('sales'));
    }
  }

  form.addEventListener('change', () => {
    if (reading) return;
    const last = read;
    if (last && last.conversions.missing(readConvertControls('sales')).length) {
      void whileReading(last.client, (current) => loadConversions(last.conversions, current));
    } else render();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const account = options.account();
    if (!account || blocker() || reading) return;
    if (parseGold(targetInput.value) === null) {
      setStatus(status, 'The gold target must be a number above 0, or blank to list everything.', 'error');
      targetInput.focus();
      return;
    }
    read = undefined;
    void whileReading(account.client, async (current) => {
      setStatus(status, 'Reading your materials, bank, bags and trading post prices...');
      const found = await readAccountSellables(account);
      // The key may have been forgotten or replaced meanwhile.
      if (!current()) return;
      await loadConversions(found.conversions, current);
      if (current()) read = { client: account.client, ...found };
    });
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
        stopClock();
        clearOutput();
        setStatus(status, '');
      }
      updateControls();
    },
  };
}
