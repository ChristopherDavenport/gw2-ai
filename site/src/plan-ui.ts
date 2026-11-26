/**
 * The crafting plan section: build, show, update and keep one plan.
 *
 * Plan content can come from a loaded file or a pasted AI reply, so it is
 * untrusted: it reaches the DOM only as text, or as markdown through
 * renderMarkdown's sanitizer.
 */
import { Gw2Client, missingPermissions, type CacheStore, type TokenInfo } from '@gw2kit/client';
import { DEFAULT_VENDOR_CURRENCY, PLAN_SETTING_LABELS, planChoices, readHoldings, renderPlan, researchPlan, type PlanChoice } from '@gw2-ai/core';
import { createPlan, parsePlan, planSettings, refreshPrices, updatePlan, withHoldings, type CraftingPlan, type PlanSettings, type PlanUpdate } from '@gw2kit/recipes';
import { WikiClient } from '@gw2kit/wiki';
import { $, describeError, downloadText, el, setStatus, setupTabs, type Tone } from './dom.js';
import { planFilename } from './filename.js';
import { renderMarkdown } from './markdown.js';
import { parseGoal, parsePlanUpdate } from './plan-input.js';
import { deletePlan, loadPlan, savePlan, withoutHoldings } from './plan-store.js';

/** Far above any real plan; stops a wrong file from freezing the page. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_QUANTITY = 10_000;

export interface PlanSectionOptions {
  /** For public data: item definitions, recipes, wiki pages. */
  cache: CacheStore & { flush(): Promise<void> };
  /** The client holding the player's key, when there is one. */
  account(): { client: Gw2Client; token: TokenInfo | undefined } | undefined;
}

export interface PlanSection {
  /** Call when a key is added or removed. */
  keyChanged(): void;
  /** Remove account data from the plan, in memory and in storage. */
  forgetHoldings(): Promise<void>;
}

export function initPlanSection(options: PlanSectionOptions): PlanSection {
  const form = $<HTMLFormElement>('plan-form');
  const goalInput = $<HTMLInputElement>('plan-goal');
  const quantityInput = $<HTMLInputElement>('plan-quantity');
  const buildBtn = $<HTMLButtonElement>('plan-build');
  const loadBtn = $<HTMLButtonElement>('plan-load');
  const fileInput = $<HTMLInputElement>('plan-file');
  const status = $('plan-status');
  const elapsed = $('plan-elapsed');
  const output = $('plan-output');
  const holdingsBtn = $<HTMLButtonElement>('plan-holdings');
  const pricesBtn = $<HTMLButtonElement>('plan-prices');
  const raw = $<HTMLTextAreaElement>('plan-raw');
  const preview = $('plan-panel-preview');
  const copyStatus = $('plan-copy-status');
  const updateForm = $<HTMLFormElement>('plan-update-form');
  const updateInput = $<HTMLTextAreaElement>('plan-update');
  const applyBtn = $<HTMLButtonElement>('plan-apply');
  const updateStatus = $('plan-update-status');
  const updateErrors = $('plan-update-errors');
  const choiceBox = $<HTMLFieldSetElement>('plan-choices');
  const choiceList = $('plan-choice-list');
  const selectTab = setupTabs([$<HTMLButtonElement>('plan-tab-raw'), $<HTMLButtonElement>('plan-tab-preview')]);

  const client = new Gw2Client({ cache: options.cache });
  const wiki = new WikiClient({ cache: options.cache });

  const settingsBox = $<HTMLFieldSetElement>('plan-settings');
  const settingInputs = (Object.entries(PLAN_SETTING_LABELS) as [keyof PlanSettings, string][]).map(([name, label]) => {
    const input = el('input');
    input.type = 'checkbox';
    input.id = `plan-setting-${name}`;
    input.addEventListener('change', () => change({ settings: { [name]: input.checked } }, label, () => (input.checked = !input.checked)));
    $('plan-setting-list').append(el('label', {}, input, ` ${label}`));
    return { name, input };
  });

  let current: { plan: CraftingPlan; markdown: string } | undefined;
  let busy = false;
  /** Bumped when the key is forgotten, so work already running can't bring holdings back. */
  let holdingsEpoch = 0;

  function updateControls(): void {
    for (const b of [buildBtn, loadBtn, pricesBtn, applyBtn]) b.disabled = busy;
    choiceBox.disabled = busy;
    settingsBox.disabled = busy;
    const account = options.account();
    holdingsBtn.hidden = !account;
    holdingsBtn.disabled = busy;
  }

  /** Show `plan` and store it. Throws, changing nothing, if it can't be rendered. */
  async function commit(plan: CraftingPlan, epoch = holdingsEpoch): Promise<void> {
    const next = epoch === holdingsEpoch ? plan : withoutHoldings(plan);
    show(next, renderPlan(next));
    await persist(next);
  }

  function show(plan: CraftingPlan, markdown: string): void {
    current = { plan, markdown };
    raw.value = markdown;
    preview.replaceChildren(renderMarkdown(markdown));
    setStatus(copyStatus, '');
    output.hidden = false;
    const settings = planSettings(plan);
    for (const { name, input } of settingInputs) input.checked = settings[name];
    showChoices(planChoices(plan));
  }

  // ---- Choices ----

  function showChoices(choices: PlanChoice[]): void {
    const focused = document.activeElement?.id;
    choiceBox.hidden = choices.length === 0;
    choiceList.replaceChildren(
      ...choices
        .sort((a, b) => Number(b.undecided) - Number(a.undecided))
        .map((choice) => {
          const select = el('select');
          select.id = `plan-choice-${choice.key}`;
          select.append(
            ...choice.options.map((option) => {
              const node = el('option', { text: option.label });
              node.value = option.value;
              return node;
            }),
          );
          select.value = choice.selected;
          select.addEventListener('change', () => choose(choice, select.value));
          const label = el('label', { text: choice.undecided ? `${choice.name} (not chosen yet)` : choice.name });
          label.htmlFor = select.id;
          const rows: Node[] = [label, select];
          // Picking the assumed route fires no change event, so confirming it needs a button.
          if (choice.undecided) {
            const keep = el('button', { text: 'Use this' });
            keep.type = 'button';
            keep.addEventListener('click', () => choose(choice, select.value));
            rows.push(keep);
          }
          return el('div', { className: 'plan-choice' }, ...rows);
        }),
    );
    if (focused) document.getElementById(focused)?.focus();
  }

  function choose(choice: PlanChoice, route: string): void {
    change({ choose: { [choice.key]: route } }, choice.name);
  }

  /** Apply a change made with the page's controls; `revert` undoes the control if it can't be. */
  function change(update: PlanUpdate, what: string, revert?: () => void): void {
    if (!current || busy) return;
    const { plan } = current;
    const epoch = holdingsEpoch;
    void run(copyStatus, `Changing ${what}...`, async () => {
      const result = updatePlan(plan, update);
      if (result.errors.length) {
        revert?.();
        return [result.errors.join(' '), 'error'];
      }
      const note = await commitAndResearch(result.plan, copyStatus, epoch);
      return [`Plan updated.${note}`, 'ok'];
    });
  }

  async function persist(plan: CraftingPlan): Promise<void> {
    try {
      await savePlan(plan);
    } catch (err) {
      setStatus(copyStatus, `Couldn't save the plan in this browser, so a reload will lose it: ${describeError(err)}`, 'error');
    }
  }

  /** Run one slow operation at a time, with its controls disabled and a running clock. */
  async function run(node: HTMLElement, message: string, task: () => Promise<[text: string, tone: Tone]>): Promise<void> {
    if (busy) return;
    busy = true;
    updateControls();
    setStatus(node, message);
    const started = Date.now();
    const tick = () => {
      elapsed.textContent = `Working: ${Math.round((Date.now() - started) / 1000)}s`;
    };
    elapsed.hidden = node !== status;
    tick();
    const timer = setInterval(tick, 1000);
    try {
      setStatus(node, ...(await task()));
    } catch (err) {
      setStatus(node, describeError(err), 'error');
    } finally {
      clearInterval(timer);
      elapsed.hidden = true;
      busy = false;
      updateControls();
      void options.cache.flush();
    }
  }

  const replaceOk = () =>
    !current ||
    !(current.plan.done.length || Object.keys(current.plan.choices).length || Object.keys(current.plan.notes).length) ||
    window.confirm('Replace the current plan? Its choices, finished steps and notes will be lost unless you downloaded its .json.');

  /** Show the plan, then look up the steps that have no known route. */
  async function commitAndResearch(plan: CraftingPlan, node: HTMLElement, epoch: number): Promise<string> {
    await commit(plan, epoch);
    setStatus(node, 'Reading the wiki for steps with no known route...');
    try {
      const researched = await researchPlan(plan, wiki);
      await commit(researched.plan, epoch);
      return researched.failed.length ? ` No wiki text found for: ${researched.failed.join(', ')}.` : '';
    } catch (err) {
      return ` The wiki lookup failed: ${describeError(err)}`;
    }
  }

  // ---- Build ----

  async function resolveItem(input: string): Promise<number> {
    const goal = parseGoal(input);
    if (!goal) throw new Error('Enter an item name or id.');
    if ('id' in goal) {
      if (!(await client.one('/v2/items', goal.id))) throw new Error(`There is no item with id ${goal.id}.`);
      return goal.id;
    }
    // Wiki titles start with a capital and are otherwise case sensitive.
    const title = goal.name.charAt(0).toUpperCase() + goal.name.slice(1);
    const [id] = (await wiki.itemIdsByTitle([title])).values();
    if (id === undefined) throw new Error(`No item named "${goal.name}" on the wiki. Use its exact name, or its id.`);
    return id;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    const input = goalInput.value;
    const quantity = Number(quantityInput.value);
    if (!parseGoal(input)) {
      setStatus(status, 'Enter an item name or id.', 'error');
      goalInput.focus();
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      setStatus(status, `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`, 'error');
      quantityInput.focus();
      return;
    }
    if (!replaceOk()) return;
    void run(status, 'Looking up the item...', async () => {
      const id = await resolveItem(input);
      setStatus(status, 'Fetching recipes, prices and vendors. A legendary takes about half a minute...');
      const plan = await createPlan(client, id, quantity, { wiki, vendorCurrency: DEFAULT_VENDOR_CURRENCY });
      setStatus(updateStatus, '');
      updateErrors.replaceChildren();
      const note = await commitAndResearch(plan, status, holdingsEpoch);
      return [`Plan ready.${note}`, 'ok'];
    });
  });

  // ---- Files and clipboard ----

  loadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || busy || !replaceOk()) return;
    void run(status, 'Reading the file...', async () => {
      if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large to be a crafting plan.');
      const text = await file.text();
      try {
        await commit(parsePlan(text));
      } catch {
        // parser and renderer messages quote internals or the file itself
        throw new Error("Couldn't load that file: it isn't a version 1 crafting plan, or it is damaged.");
      }
      setStatus(updateStatus, '');
      updateErrors.replaceChildren();
      return ['Plan loaded.', 'ok'];
    });
  });

  $('plan-copy').addEventListener('click', () => {
    if (!current) return;
    navigator.clipboard.writeText(current.markdown).then(
      () => setStatus(copyStatus, 'Copied the plan to the clipboard.', 'ok'),
      () => {
        selectTab(0);
        raw.focus();
        raw.select();
        setStatus(copyStatus, "Couldn't copy automatically. The markdown is selected: press Ctrl+C (Cmd+C on Mac).", 'error');
      },
    );
  });

  function download(extension: 'md' | 'json'): void {
    if (!current) return;
    const { plan, markdown } = current;
    const name = planFilename(String(plan.goal.name), new Date(), extension);
    if (extension === 'md') downloadText(name, markdown, 'text/markdown');
    else downloadText(name, JSON.stringify(plan), 'application/json');
    setStatus(copyStatus, `Downloaded ${name}.`, 'ok');
  }
  $('plan-download-md').addEventListener('click', () => download('md'));
  $('plan-download-json').addEventListener('click', () => download('json'));

  // ---- Holdings and prices ----

  holdingsBtn.addEventListener('click', () => {
    const account = options.account();
    if (!account || !current) return;
    const { plan } = current;
    const epoch = holdingsEpoch;
    void run(copyStatus, 'Reading your bank, bags, materials and wallet...', async () => {
      const token = account.token ?? (await account.client.get('/v2/tokeninfo'));
      const missing = missingPermissions(token.permissions, ['inventories']);
      if (missing.length) throw new Error(`The key needs the ${missing.join(', ')} permission to read holdings.`);
      const { holdings, notes } = await readHoldings(account.client, token.permissions);
      if (epoch !== holdingsEpoch) return ['The key was forgotten, so the holdings were discarded.', 'info'];
      await commit(withHoldings(plan, holdings), epoch);
      return notes.length ? [`Holdings read, with gaps: ${notes.join('; ')}.`, 'info'] : ['Holdings read.', 'ok'];
    });
  });

  pricesBtn.addEventListener('click', () => {
    if (!current) return;
    const { plan } = current;
    const epoch = holdingsEpoch;
    void run(copyStatus, 'Refreshing trading post prices...', async () => {
      // A client with no cache yet, so no price comes from an earlier request.
      await commit(await refreshPrices(new Gw2Client(), plan), epoch);
      return ['Prices refreshed.', 'ok'];
    });
  });

  // ---- Updates ----

  updateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || busy) return;
    const { plan } = current;
    const epoch = holdingsEpoch;
    updateErrors.replaceChildren();
    void run(updateStatus, 'Applying the update...', async () => {
      const result = updatePlan(plan, parsePlanUpdate(updateInput.value));
      updateErrors.replaceChildren(...result.errors.map((message) => el('li', { text: message })));
      const changed = (p: CraftingPlan) => JSON.stringify([p.choices, p.done, p.notes, p.settings]);
      if (result.errors.length && changed(result.plan) === changed(plan)) return ['Nothing was changed:', 'error'];
      const note = await commitAndResearch(result.plan, updateStatus, epoch);
      if (result.errors.length) return [`Applied in part.${note} These entries were not applied:`, 'error'];
      updateInput.value = '';
      return [`Update applied.${note}`, 'ok'];
    });
  });

  // ---- Restore ----

  const restored = (async () => {
    try {
      const stored = await loadPlan();
      if (stored === undefined) return;
      const plan = parsePlan(stored);
      const markdown = renderPlan(plan);
      // A build or load that finished first wins.
      if (!current) show(plan, markdown);
    } catch (err) {
      setStatus(status, `Couldn't restore the saved plan: ${describeError(err)}`, 'error');
    }
  })();

  updateControls();

  return {
    keyChanged: updateControls,
    async forgetHoldings() {
      holdingsEpoch++;
      await restored;
      if (current) await commit(withoutHoldings(current.plan));
      // A saved plan that couldn't be restored may still hold account data.
      else await deletePlan().catch(() => undefined);
    },
  };
}
