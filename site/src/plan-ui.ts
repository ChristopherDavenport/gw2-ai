/**
 * The crafting plan section: build, show, update and keep one plan, which may
 * make several items. Sales to cover its shortfall are added to the markdown
 * from account data held in memory; they are never part of the stored plan.
 *
 * Plan content can come from a loaded file or a pasted AI reply, so it is
 * untrusted: it reaches the DOM only as text, or as markdown through
 * renderMarkdown's sanitizer.
 */
import { Gw2Client, missingPermissions, type CacheStore } from '@gw2kit/client';
import { DEFAULT_VENDOR_CURRENCY, PLAN_SETTING_LABELS, planChoices, planShortfall, readHoldings, renderPlan, researchPlan, salesForPlan, type PlanChoice } from '@gw2-ai/core';
import { addGoal, addOtherOffers, createPlan, mergeLookups, parsePlan, planFromData, planSettings, refreshPrices, updatePlan, withHoldings, type CraftingPlan, type FetchProgress, type PlanGoal, type RecipeData, type PlanSettings, type PlanUpdate } from '@gw2kit/recipes';
import { WikiClient } from '@gw2kit/wiki';
import { $, describeError, downloadText, el, setStatus, setupTabs, startClock, type Tone } from './dom.js';
import { planFilename } from './filename.js';
import { renderMarkdown } from './markdown.js';
import { MAX_QUANTITY, parseGoalRows, parsePlanUpdate, type Goal, type GoalRows } from './plan-input.js';
import { deletePlan, loadPlan, savePlan, withoutHoldings } from './plan-store.js';
import { checkingText, keepWarning, readAccountSellables, readConvertControls, readSaleControls, type Account, type AccountSales } from './sales-ui.js';

/** Far above any real plan; stops a wrong file from freezing the page. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_GOAL_ROWS = 20;

export interface PlanSectionOptions {
  /** For public data: item definitions, recipes, wiki pages. */
  cache: CacheStore & { flush(): Promise<void> };
  /** The client holding the player's key, when there is one. */
  account(): Account | undefined;
}

export interface PlanSection {
  /** Call when a key is added or removed. */
  keyChanged(): void;
  /** Remove account data from the plan, in memory and in storage. */
  forgetHoldings(): Promise<void>;
}

export function initPlanSection(options: PlanSectionOptions): PlanSection {
  const form = $<HTMLFormElement>('plan-form');
  const rowsBox = $('plan-goal-rows');
  const anotherBtn = $<HTMLButtonElement>('plan-goal-another');
  const addBtn = $<HTMLButtonElement>('plan-add');
  const goalBox = $<HTMLFieldSetElement>('plan-goals');
  const goalList = $('plan-goal-list');
  const sellBox = $<HTMLFieldSetElement>('plan-sales');
  const sellToggle = $<HTMLInputElement>('plan-sales-on');
  const sellControls = $('plan-sales-controls');
  const sellHint = $('plan-sales-hint');
  const buildBtn = $<HTMLButtonElement>('plan-build');
  const loadBtn = $<HTMLButtonElement>('plan-load');
  const fileInput = $<HTMLInputElement>('plan-file');
  const status = $('plan-status');
  const elapsed = $('plan-elapsed');
  const output = $('plan-output');
  const holdingsHint = $('plan-holdings-hint');
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
    input.addEventListener('change', () => {
      // Using your own materials means reading them first.
      if (name === 'useOwnMaterials' && input.checked) return useHoldings();
      change({ settings: { [name]: input.checked } }, label, () => (input.checked = !input.checked));
    });
    const row = el('label', {}, input, ` ${label}`);
    $('plan-setting-list').append(row);
    return { name, input, row };
  });

  const background = $('plan-background');
  const outputButtons = ['plan-copy', 'plan-download-md', 'plan-download-json'].map((id) => $<HTMLButtonElement>(id));

  /** `build` counts builds and loads, so late lookups for a replaced plan are dropped. */
  let current: { plan: CraftingPlan; markdown: string; build: number } | undefined;
  let builds = 0;
  let shownChoices = '';
  let shownGoals = '';
  /** Bumped when goals are added, so the background worker looks their offers up too. */
  let graphs = 0;
  /** Set while sales are wanted in the markdown; `read` is absent while being read. */
  let selling: { client: Gw2Client; read?: AccountSales } | undefined;
  let busy = false;
  /** Bumped when the key is forgotten, so work already running can't bring holdings back. */
  let holdingsEpoch = 0;

  function updateControls(): void {
    for (const b of [buildBtn, addBtn, loadBtn, pricesBtn, applyBtn, ...outputButtons]) b.disabled = busy;
    choiceBox.disabled = busy;
    goalBox.disabled = busy;
    sellBox.disabled = busy;
    settingsBox.disabled = busy;
    showSettings();
  }

  /** The key permission holdings need that the saved key lacks; undefined when it can read them. */
  function holdingsBlocker(): string | undefined {
    const token = options.account()?.token;
    if (!token) return 'Save an API key with the inventories permission to use your own materials.';
    const missing = missingPermissions(token.permissions, ['inventories']);
    return missing.length ? `Your key needs the ${missing.join(', ')} permission to use your own materials.` : undefined;
  }

  const holdingsInUse = (plan: CraftingPlan) =>
    !holdingsBlocker() && planSettings(plan).useOwnMaterials && plan.holdings.fetchedAt !== undefined;

  function showSettings(): void {
    if (!current) return;
    addBtn.hidden = false;
    const settings = planSettings(current.plan);
    const blocker = holdingsBlocker();
    const using = holdingsInUse(current.plan);
    for (const { name, input, row } of settingInputs) {
      input.checked = name === 'useOwnMaterials' ? using : settings[name];
      if (name === 'useOwnMaterials') row.hidden = blocker !== undefined;
      if (name === 'deductOwnedValue') row.hidden = !using;
    }
    holdingsHint.textContent = blocker ?? (using ? 'Untick and tick again to re-read your holdings.' : '');
    showSelling(current.plan, using);
  }

  function showSelling(plan: CraftingPlan, using: boolean): void {
    // Without holdings there is no shortfall, and nothing to hold back for the plan.
    if (!using) selling = undefined;
    sellBox.hidden = !using;
    sellToggle.checked = selling !== undefined;
    sellControls.hidden = selling === undefined;
    const sellables = selling?.read?.sellables;
    if (!sellables) {
      sellHint.textContent = '';
      return;
    }
    const short = planShortfall(plan);
    sellHint.textContent = [
      short === 0 ? 'Your wallet already covers this plan, so no sales are listed.' : '',
      short === undefined ? 'Your gold was not read (the key needs `wallet`), so everything spare is listed.' : '',
      keepWarning(readSaleControls('plan-sales').keep, sellables),
      'Untick and tick again to re-read what you can sell.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** The plan's markdown, with sales for its shortfall when asked for. */
  function render(plan: CraftingPlan): string {
    const read = selling?.read;
    if (!read || !holdingsInUse(plan) || planShortfall(plan) === 0) return renderPlan(plan);
    const { items, delivery, notes } = read.sellables;
    const converted = read.conversions.get(readConvertControls('plan-sales'));
    const sales = salesForPlan(plan, items, {
      ...readSaleControls('plan-sales'),
      delivery,
      ...(converted.conversions ? { conversions: converted.conversions } : {}),
    });
    return renderPlan(plan, {
      sales: { plan: sales, notes: [...notes, ...converted.notes], ...(delivery ? { delivery } : {}) },
    });
  }

  function rerender(): void {
    if (current) show(current.plan, render(current.plan), current.build);
  }

  /**
   * Show `plan` and store it. Throws, changing nothing, if it can't be rendered.
   * `grown`: goals were added, so other offers have to be looked up again.
   */
  async function commit(plan: CraftingPlan, epoch = holdingsEpoch, replace = false, grown = false): Promise<void> {
    // Keep what background lookups added since `plan` was taken.
    let merged = current && !replace ? mergeLookups(plan, current.plan) : plan;
    if (grown) {
      // The merge brings back the old stamp, which doesn't cover the new goals.
      const { offersFetchedAt: _, ...data } = merged.data;
      merged = { ...merged, data };
      graphs++;
    }
    if (replace) selling = undefined;
    const next = epoch === holdingsEpoch ? merged : withoutHoldings(merged);
    show(next, render(next), replace ? ++builds : builds);
    if (replace) setStatus(copyStatus, '');
    await persist(next);
  }

  function show(plan: CraftingPlan, markdown: string, build = builds): void {
    current = { plan, markdown, build };
    showMarkdown(markdown);
    showSettings();
    const choices = planChoices(plan);
    // Rebuilding the selects would close one the player has open.
    const signature = JSON.stringify(choices);
    if (signature !== shownChoices || choiceBox.hidden !== (choices.length === 0)) showChoices(choices);
    shownChoices = signature;
    const goals = JSON.stringify(plan.goals);
    if (goals !== shownGoals) showGoals(plan.goals);
    shownGoals = goals;
  }

  function showMarkdown(markdown: string): void {
    raw.value = markdown;
    preview.replaceChildren(renderMarkdown(markdown));
    output.hidden = false;
  }

  const progressText = ({ phase, done, total }: FetchProgress) =>
    phase === 'recipes'
      ? `Reading recipes and prices: ${done} items so far...`
      : phase === 'vendors'
        ? `Checking vendors for items with no other route: ${done} of ${total ?? '?'}...`
        : `Looking for other places to buy: ${done} of ${total ?? '?'}`;

  /** The plan as far as it goes before vendors are checked. Not kept or copyable. */
  function showPartial(data: RecipeData, goals: { itemId: number; quantity: number }[]): void {
    for (const box of [choiceBox, goalBox, sellBox]) box.hidden = true;
    shownChoices = '';
    shownGoals = '';
    showMarkdown(`> Still loading: vendors are being checked, so steps and totals will change.\n\n${renderPlan(planFromData(data, goals))}`);
  }

  // ---- Goals ----

  function showGoals(goals: PlanGoal[]): void {
    const focused = document.activeElement?.id;
    goalBox.hidden = false;
    goalList.replaceChildren(
      ...goals.map((goal) => {
        const input = el('input');
        input.type = 'number';
        input.id = `plan-goal-qty-${goal.itemId}`;
        input.min = '1';
        input.max = String(MAX_QUANTITY);
        input.step = '1';
        input.value = String(goal.quantity);
        const revert = () => (input.value = String(goal.quantity));
        input.addEventListener('change', () => {
          const quantity = Number(input.value);
          if (busy || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
            revert();
            setStatus(copyStatus, `Quantity must be a whole number from 1 to ${MAX_QUANTITY}. Use Remove to drop an item.`, 'error');
            return;
          }
          change({ quantities: { [`i${goal.itemId}`]: quantity } }, goal.name, revert);
        });
        const label = el('label', { text: goal.name });
        label.htmlFor = input.id;
        const remove = el('button', { text: 'Remove' });
        remove.type = 'button';
        remove.id = `plan-goal-remove-${goal.itemId}`;
        remove.setAttribute('aria-label', `Remove ${goal.name}`);
        // A plan needs something to make.
        remove.disabled = goals.length === 1;
        remove.addEventListener('click', () => change({ quantities: { [`i${goal.itemId}`]: 0 } }, goal.name));
        return el('li', {}, label, input, remove);
      }),
    );
    if (focused) document.getElementById(focused)?.focus();
  }

  const itemRows = () => [...rowsBox.querySelectorAll<HTMLElement>('.goal-row')];
  const rowInput = (row: HTMLElement, field: 'item' | 'quantity') =>
    row.querySelector<HTMLInputElement>(field === 'item' ? '.goal-name' : '.goal-quantity')!;
  const readRows = () => itemRows().map((row) => ({ item: rowInput(row, 'item').value, quantity: rowInput(row, 'quantity').value }));

  function addRow(): void {
    if (itemRows().length >= MAX_GOAL_ROWS) return;
    const number = itemRows().length + 1;
    const name = el('input', { className: 'goal-name' });
    name.type = 'text';
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.placeholder = 'Exact item name or id';
    name.setAttribute('aria-label', `Item name or id ${number}`);
    const quantity = el('input', { className: 'goal-quantity' });
    quantity.type = 'number';
    quantity.min = '1';
    quantity.max = String(MAX_QUANTITY);
    quantity.step = '1';
    quantity.value = '1';
    quantity.setAttribute('aria-label', `Quantity ${number}`);
    const remove = el('button', { text: 'Remove row' });
    remove.type = 'button';
    const row = el('div', { className: 'row goal-row' }, name, quantity, remove);
    remove.addEventListener('click', () => {
      row.remove();
      anotherBtn.focus();
    });
    rowsBox.append(row);
    name.focus();
  }
  anotherBtn.addEventListener('click', addRow);

  /** Empty the rows once used, unless the player has typed something else meanwhile. */
  function clearRows(used: string): void {
    if (JSON.stringify(readRows()) !== used) return;
    const [first, ...rest] = itemRows();
    for (const row of rest) row.remove();
    rowInput(first!, 'item').value = '';
    rowInput(first!, 'quantity').value = '1';
  }

  /** The rows' items, or undefined after pointing at what is wrong with them. */
  function checkedRows(): Extract<GoalRows, { goals: unknown }>['goals'] | undefined {
    const parsed = parseGoalRows(readRows());
    if ('goals' in parsed) return parsed.goals;
    setStatus(status, parsed.error, 'error');
    rowInput(itemRows()[parsed.row]!, parsed.field).focus();
    return undefined;
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
      await commit(result.plan, epoch);
      void enrich(builds);
      return ['Plan updated.', 'ok'];
    });
  }

  async function persist(plan: CraftingPlan): Promise<void> {
    try {
      await savePlan(plan);
    } catch (err) {
      setStatus(copyStatus, `Couldn't save the plan in this browser, so a reload will lose it: ${describeError(err)}`, 'error');
    }
  }

  /** The build the background worker is on, and whether the plan changed since it last looked. */
  let working: number | undefined;
  let again = false;

  /**
   * What only adds detail to a finished plan: other places to buy, then wiki
   * text for steps. Runs while the plan is in use; call it after any change that
   * can add steps, and a worker already on this build takes another pass.
   */
  async function enrich(build: number): Promise<void> {
    if (working === build) {
      again = true;
      return;
    }
    working = build;
    const mine = () => current?.build === build;
    const say = (text: string, tone: Tone = 'info') => {
      if (mine()) setStatus(background, text, tone);
    };
    /** Fold looked-up data into whatever the plan has become. */
    const add = async (found: CraftingPlan) => {
      if (mine()) await commit(mergeLookups(current!.plan, found));
    };
    try {
      let offersFetchedAt: string | undefined;
      /** The `graphs` the offers were looked up for. */
      let looked: number | undefined;
      const failed = new Set<string>();
      do {
        if (!mine()) return;
        again = false;
        if (!current!.plan.data.offersFetchedAt && looked !== graphs) {
          looked = graphs;
          say('Looking for other places to buy. The plan is ready to use meanwhile.');
          const offered = await addOtherOffers(client, current!.plan, {
            wiki,
            vendorCurrency: DEFAULT_VENDOR_CURRENCY,
            onProgress: (p) => say(`${progressText(p)}. The plan is ready to use meanwhile.`),
          });
          // Marked as looked up only once everything is in, so a reload part way finishes the job.
          const { offersFetchedAt: at, ...data } = offered.data;
          offersFetchedAt = at;
          await add({ ...offered, data });
          if (!mine()) return;
        }

        let waiting: NonNullable<CraftingPlan['research']> = {};
        let last = Date.now();
        const flush = async () => {
          const research = waiting;
          waiting = {};
          last = Date.now();
          if (mine() && Object.keys(research).length) await add({ ...current!.plan, research });
        };
        const researched = await researchPlan(current!.plan, wiki, {
          onProgress: (done, total, found) => {
            if (total) say(`Reading the wiki for map sources and requirements: ${done} of ${total}`);
            if (found) waiting[found.key] = found.research;
            if (Date.now() - last > 3000) void flush();
          },
        });
        await flush();
        for (const name of researched.failed) failed.add(name);
      } while (again);
      // Cleared before the last write, so a change made during it starts a new worker.
      working = undefined;
      if (offersFetchedAt && looked === graphs && mine()) {
        await add({ ...current!.plan, data: { ...current!.plan.data, offersFetchedAt } });
      }
      say(failed.size ? `All loaded. No wiki text found for: ${[...failed].join(', ')}.` : 'All loaded.', 'ok');
    } catch (err) {
      say(`Couldn't load every detail: ${describeError(err)}. The plan itself is complete.`, 'error');
    } finally {
      if (working === build) working = undefined;
      void options.cache.flush();
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
    !(
      current.plan.goals.length > 1 ||
      current.plan.done.length ||
      Object.keys(current.plan.choices).length ||
      Object.keys(current.plan.notes).length
    ) ||
    window.confirm('Replace the current plan? Its items, choices, finished steps and notes will be lost unless you downloaded its .json.');

  // ---- Build and add ----

  async function resolveItem(goal: Goal, input: string): Promise<number> {
    if ('id' in goal) {
      if (!(await client.one('/v2/items', goal.id))) throw new Error(`There is no item with id ${goal.id}.`);
      return goal.id;
    }
    // Wiki titles start with a capital and are otherwise case sensitive.
    const title = goal.name.charAt(0).toUpperCase() + goal.name.slice(1);
    const [id] = (await wiki.itemIdsByTitle([title])).values();
    if (id === undefined) throw new Error(`No item named "${input.trim()}" on the wiki. Use its exact name, or its id.`);
    return id;
  }

  /** Look the rows up, with `have` already being made. Throws before anything is changed. */
  async function resolveGoals(
    rows: Extract<GoalRows, { goals: unknown }>['goals'],
    have: readonly PlanGoal[] = [],
  ): Promise<{ itemId: number; quantity: number }[]> {
    const totals = new Map(have.map((g) => [g.itemId, g.quantity]));
    const wanted: { itemId: number; quantity: number }[] = [];
    for (const { goal, input, quantity } of rows) {
      const itemId = await resolveItem(goal, input);
      const total = (totals.get(itemId) ?? 0) + quantity;
      if (total > MAX_QUANTITY) throw new Error(`A plan makes at most ${MAX_QUANTITY} of one item.`);
      totals.set(itemId, total);
      wanted.push({ itemId, quantity });
    }
    return wanted;
  }

  const fetchOptions = {
    wiki,
    vendorCurrency: DEFAULT_VENDOR_CURRENCY,
    onProgress: (p: FetchProgress) => setStatus(status, progressText(p)),
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    const used = JSON.stringify(readRows());
    const rows = checkedRows();
    if (!rows || !replaceOk()) return;
    void run(status, 'Looking up the items...', async () => {
      const wanted = await resolveGoals(rows);
      setStatus(status, 'Reading recipes and prices...');
      setStatus(background, '');
      const epoch = holdingsEpoch;
      try {
        const plan = await createPlan(client, wanted, 1, {
          ...fetchOptions,
          otherOffers: false,
          onRecipes: (data) => showPartial(data, wanted),
        });
        setStatus(updateStatus, '');
        updateErrors.replaceChildren();
        await commit(plan, epoch, true);
      } catch (err) {
        // Put back what the partial plan covered up.
        if (current) rerender();
        else output.hidden = true;
        throw err;
      }
      clearRows(used);
      void enrich(builds);
      return ['Plan ready.', 'ok'];
    });
  });

  /**
   * The plan keeps only the holdings its graph can use, so a grown graph needs
   * them read again. Returns what to tell the player when that isn't possible.
   */
  async function rereadHoldings(plan: CraftingPlan): Promise<{ plan: CraftingPlan; note: string }> {
    if (!plan.holdings.fetchedAt) return { plan, note: '' };
    const account = options.account();
    const failed = "Your holdings weren't re-read, so materials only the new items use aren't counted.";
    if (!account || holdingsBlocker()) return { plan, note: failed };
    setStatus(status, 'Reading your holdings again...');
    try {
      const token = account.token ?? (await account.client.get('/v2/tokeninfo'));
      const { holdings } = await readHoldings(account.client, token.permissions);
      return { plan: withHoldings(plan, holdings), note: '' };
    } catch (err) {
      return { plan, note: `${failed} ${describeError(err)}` };
    }
  }

  addBtn.addEventListener('click', () => {
    if (!current || busy) return;
    const used = JSON.stringify(readRows());
    const rows = checkedRows();
    if (!rows) return;
    const base = current.plan;
    const epoch = holdingsEpoch;
    void run(status, 'Looking up the items...', async () => {
      const wanted = await resolveGoals(rows, base.goals);
      setStatus(status, 'Reading recipes and prices...');
      let plan = base;
      for (const { itemId, quantity } of wanted) plan = await addGoal(client, plan, itemId, quantity, fetchOptions);
      // More of something already being made leaves the graph as it was.
      const grown = plan.data !== base.data;
      let note = '';
      if (grown) ({ plan, note } = await rereadHoldings(plan));
      await commit(plan, epoch, false, grown);
      clearRows(used);
      void enrich(builds);
      return note ? [`Added to the plan. ${note}`, 'info'] : ['Added to the plan.', 'ok'];
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
        await commit(parsePlan(text), holdingsEpoch, true);
      } catch {
        // parser and renderer messages quote internals or the file itself
        throw new Error("Couldn't load that file: it isn't a crafting plan, or it is damaged.");
      }
      setStatus(updateStatus, '');
      setStatus(background, '');
      updateErrors.replaceChildren();
      if (!current!.plan.data.offersFetchedAt) void enrich(builds);
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
    const name = planFilename(plan.goals.map((g) => String(g.name)), new Date(), extension);
    if (extension === 'md') downloadText(name, markdown, 'text/markdown');
    else downloadText(name, JSON.stringify(plan), 'application/json');
    setStatus(copyStatus, `Downloaded ${name}.`, 'ok');
  }
  $('plan-download-md').addEventListener('click', () => download('md'));
  $('plan-download-json').addEventListener('click', () => download('json'));

  // ---- Holdings and prices ----

  function useHoldings(): void {
    const account = options.account();
    if (!account || !current || busy) return showSettings();
    const { plan } = current;
    const epoch = holdingsEpoch;
    void run(copyStatus, 'Reading your bank, bags, materials and wallet...', async () => {
      try {
        const token = account.token ?? (await account.client.get('/v2/tokeninfo'));
        const { holdings, notes } = await readHoldings(account.client, token.permissions);
        if (epoch !== holdingsEpoch) return ['The key was forgotten, so the holdings were discarded.', 'info'];
        const on = updatePlan(withHoldings(plan, holdings), { settings: { useOwnMaterials: true } }).plan;
        await commit(on, epoch);
        return notes.length ? [`Using your materials, with gaps: ${notes.join('; ')}.`, 'info'] : ['Using your materials.', 'ok'];
      } catch (err) {
        showSettings();
        throw err;
      }
    });
  }

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

  // ---- Sales for the shortfall ----

  /** Read the conversions the boxes ask for, saying so and counting the wait. */
  async function loadConversions(read: AccountSales): Promise<void> {
    const wants = readConvertControls('plan-sales');
    const missing = read.conversions.missing(wants);
    if (!missing.length) return;
    setStatus(copyStatus, checkingText(missing));
    const stop = startClock($('plan-sales-elapsed'));
    try {
      await read.conversions.load(wants);
    } finally {
      stop();
    }
  }

  function readSales(): void {
    const account = options.account();
    if (!account || !current || busy) return showSettings();
    const epoch = holdingsEpoch;
    const wanted = (selling = { client: account.client });
    void run(copyStatus, 'Reading what you can sell...', async () => {
      try {
        const read = await readAccountSellables(account);
        const discarded = () => epoch !== holdingsEpoch || selling !== wanted;
        if (!discarded()) await loadConversions(read);
        if (discarded()) return ['What was read to sell was discarded.', 'info'];
        selling = { ...wanted, read };
        rerender();
        return ['Sales added to the plan.', 'ok'];
      } catch (err) {
        selling = undefined;
        showSettings();
        throw err;
      }
    });
  }

  /** A conversion box was ticked that needs data not read yet. */
  function readMoreConversions(read: AccountSales): void {
    const epoch = holdingsEpoch;
    const wanted = selling;
    void run(copyStatus, 'Reading...', async () => {
      await loadConversions(read);
      if (epoch !== holdingsEpoch || selling !== wanted) return ['What was read to sell was discarded.', 'info'];
      rerender();
      return ['Sales updated.', 'ok'];
    });
  }

  sellBox.addEventListener('change', (event) => {
    if (busy) return;
    if (event.target === sellToggle && sellToggle.checked) return readSales();
    if (event.target === sellToggle) selling = undefined;
    const read = selling?.read;
    if (read && read.conversions.missing(readConvertControls('plan-sales')).length) return readMoreConversions(read);
    rerender();
    setStatus(copyStatus, '');
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
      const changed = (p: CraftingPlan) => JSON.stringify([p.goals, p.choices, p.done, p.notes, p.settings]);
      if (result.errors.length && changed(result.plan) === changed(plan)) return ['Nothing was changed:', 'error'];
      await commit(result.plan, epoch);
      void enrich(builds);
      if (result.errors.length) return ['Applied in part. These entries were not applied:', 'error'];
      updateInput.value = '';
      return ['Update applied.', 'ok'];
    });
  });

  // ---- Restore ----

  const restored = (async () => {
    try {
      const stored = await loadPlan();
      if (stored === undefined) return;
      const plan = parsePlan(stored);
      const markdown = render(plan);
      // A build or load that finished first wins.
      if (!current) {
        show(plan, markdown);
        // A reload part way through the background lookups finishes them.
        if (!plan.data.offersFetchedAt) void enrich(builds);
      }
    } catch (err) {
      setStatus(status, `Couldn't restore the saved plan: ${describeError(err)}`, 'error');
    }
  })();

  updateControls();

  return {
    keyChanged() {
      // What was read to sell belongs to the key that read it.
      if (selling && selling.client !== options.account()?.client) {
        selling = undefined;
        rerender();
      }
      updateControls();
    },
    async forgetHoldings() {
      holdingsEpoch++;
      selling = undefined;
      await restored;
      if (current) await commit(withoutHoldings(current.plan));
      // A saved plan that couldn't be restored may still hold account data.
      else await deletePlan().catch(() => undefined);
    },
  };
}
