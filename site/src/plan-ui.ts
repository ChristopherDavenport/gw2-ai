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
import { parseEntry, parsePlanUpdate, parseQuantity, MAX_QUANTITY, QUANTITY_ERROR, type Entry, type Goal } from './plan-input.js';
import { addToSelection, iconUrl, type SelectedGoal } from './plan-selection.js';
import { deletePlan, loadPlan, savePlan, withoutHoldings } from './plan-store.js';
import { checkingText, keepWarning, readAccountSellables, readConvertControls, readSaleControls, type Account, type AccountSales } from './sales-ui.js';

/** Far above any real plan; stops a wrong file from freezing the page. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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
  const entryName = $<HTMLInputElement>('plan-goal');
  const entryQuantity = $<HTMLInputElement>('plan-quantity');
  const newBtn = $<HTMLButtonElement>('plan-new');
  const goalHint = $('plan-goal-hint');
  const addBtn = $<HTMLButtonElement>('plan-add');
  const goalBox = $<HTMLFieldSetElement>('plan-goals');
  const goalList = $('plan-goal-list');
  const sellBox = $<HTMLDetailsElement>('plan-sales');
  const sellStatus = $('plan-sales-status');
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
  const sellToggle = el('input');
  sellToggle.type = 'checkbox';
  sellToggle.id = 'plan-sell';
  const sellRow = el('label', {}, sellToggle, ' Sell spare materials for the remaining gold');
  settingInputs.find((s) => s.name === 'useOwnMaterials')!.row.after(sellRow);

  const background = $('plan-background');
  const outputButtons = ['plan-copy', 'plan-download-md', 'plan-download-json'].map((id) => $<HTMLButtonElement>(id));

  /** `build` counts builds and loads, so late lookups for a replaced plan are dropped. */
  let current: { plan: CraftingPlan; markdown: string; build: number } | undefined;
  let builds = 0;
  let shownChoices = '';
  let shownGoals = '';
  /** The items picked before there is a plan; with one, its goals are the rows. */
  let pending: SelectedGoal[] = [];
  /** Item id → icon URL; '' when the item has none. */
  const icons = new Map<number, string>();
  const iconsWanted = new Set<number>();
  /** Bumped when goals are added, so the background worker looks their offers up too. */
  let graphs = 0;
  /** Set while sales are wanted in the markdown; `read` is absent while being read. */
  let selling: { client: Gw2Client; read?: AccountSales } | undefined;
  let busy = false;
  /** Bumped when the key is forgotten, so work already running can't bring holdings back. */
  let holdingsEpoch = 0;

  function updateControls(): void {
    for (const b of [buildBtn, newBtn, addBtn, loadBtn, pricesBtn, applyBtn, ...outputButtons]) b.disabled = busy;
    choiceBox.disabled = busy;
    goalBox.disabled = busy;
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
    // Before the sales are read, the holdings may still be on their way.
    if (selling?.read && !using) dropSales();
    sellRow.hidden = holdingsBlocker() !== undefined;
    sellToggle.checked = selling !== undefined;
    sellBox.hidden = selling === undefined;
    const sellables = selling?.read?.sellables;
    if (!sellables) {
      sellHint.textContent = '';
      return;
    }
    sellHint.textContent = [
      shortfallText(planShortfall(plan)),
      keepWarning(readSaleControls('plan-sales').keep, sellables),
      'Untick and tick “Sell spare materials” again to re-read what you can sell.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  function shortfallText(short: number | undefined): string {
    if (short === 0) return 'Your wallet already covers this plan: there is no remaining gold to raise, so no sales are listed.';
    if (short !== undefined) return 'The sales are in the plan under “Raise the gold from spare materials”.';
    const permitted = options.account()?.token?.permissions.includes('wallet');
    const why = permitted ? 'no gold balance was read from your wallet' : 'your key lacks the wallet permission';
    return `How much gold you still need is unknown, because ${why}. Everything spare is listed instead.`;
  }

  function dropSales(): void {
    selling = undefined;
    setStatus(sellStatus, '');
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
    if (replace) dropSales();
    const next = epoch === holdingsEpoch ? merged : withoutHoldings(merged);
    show(next, render(next), replace ? ++builds : builds);
    if (replace) {
      pending = [];
      setStatus(copyStatus, '');
    }
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
    showGoals();
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
    for (const box of [choiceBox, sellBox]) box.hidden = true;
    sellToggle.checked = false;
    sellHint.textContent = '';
    shownChoices = '';
    showMarkdown(`> Still loading: vendors are being checked, so steps and totals will change.\n\n${renderPlan(planFromData(data, goals))}`);
  }

  // ---- Goals ----

  /** The one list of what is being made: the plan's goals, or what is picked for one. */
  function showGoals(): void {
    const goals: readonly PlanGoal[] = current?.plan.goals ?? pending;
    buildBtn.hidden = current !== undefined;
    newBtn.hidden = current === undefined;
    // A plan needs something to make.
    const last = current !== undefined && goals.length === 1;
    goalHint.textContent = !goals.length
      ? 'Nothing selected yet.'
      : last
        ? 'A plan makes at least one item. To drop this one, add another first or start a new plan.'
        : '';
    // Rebuilding the rows would drop a quantity being typed.
    const signature = JSON.stringify([current !== undefined, goals]);
    if (signature === shownGoals) return;
    shownGoals = signature;
    const focused = document.activeElement?.id;
    goalList.replaceChildren(...goals.map((goal) => goalRow(goal, last)));
    if (focused) document.getElementById(focused)?.focus();
    showIcons();
    void loadIcons(goals.map((g) => g.itemId));
  }

  function goalRow(goal: PlanGoal, last: boolean): HTMLLIElement {
    const icon = el('span', { className: 'item-icon' });
    icon.dataset.itemId = String(goal.itemId);
    const input = el('input');
    input.type = 'number';
    input.id = `plan-goal-qty-${goal.itemId}`;
    input.min = '1';
    input.max = String(MAX_QUANTITY);
    input.step = '1';
    input.value = String(goal.quantity);
    input.addEventListener('change', () => setQuantity(goal, input));
    const label = el('label', {}, el('span', { className: 'visually-hidden', text: 'Quantity of ' }), goal.name);
    label.htmlFor = input.id;
    const remove = el('button', { text: 'Remove' });
    remove.type = 'button';
    remove.id = `plan-goal-remove-${goal.itemId}`;
    remove.setAttribute('aria-label', `Remove ${goal.name}`);
    remove.disabled = last;
    remove.addEventListener('click', () => removeGoal(goal));
    return el('li', {}, icon, label, input, remove);
  }

  function setQuantity(goal: PlanGoal, input: HTMLInputElement): void {
    const revert = () => (input.value = String(goal.quantity));
    const quantity = parseQuantity(input.value);
    if (busy || quantity === undefined) {
      revert();
      if (!busy) setStatus(status, `${QUANTITY_ERROR} Use Remove to drop an item.`, 'error');
      return;
    }
    if (current) return void change({ quantities: { [`i${goal.itemId}`]: quantity } }, goal.name, revert, status);
    pending = pending.map((g) => (g.itemId === goal.itemId ? { ...g, quantity } : g));
    setStatus(status, '');
    showGoals();
  }

  function removeGoal(goal: PlanGoal): void {
    if (busy) return;
    if (current) {
      // The row that had focus goes with the item.
      void change({ quantities: { [`i${goal.itemId}`]: 0 } }, goal.name, undefined, status).then(focusEntry);
      return;
    }
    pending = pending.filter((g) => g.itemId !== goal.itemId);
    setStatus(status, `Removed ${goal.name}.`);
    showGoals();
    entryName.focus();
  }

  /** Put the icons that are known into their rows. A row without one stays blank. */
  function showIcons(): void {
    for (const box of goalList.querySelectorAll<HTMLElement>('.item-icon')) {
      const url = icons.get(Number(box.dataset.itemId));
      if (!url || box.firstChild) continue;
      const image = el('img');
      image.alt = '';
      image.width = 32;
      image.height = 32;
      image.addEventListener('error', () => image.remove());
      image.src = url;
      box.append(image);
    }
  }

  /** Icons come from the API alone, never from a plan, which may be anyone's file. */
  async function loadIcons(itemIds: number[]): Promise<void> {
    const ids = itemIds.filter((id) => Number.isSafeInteger(id) && id > 0 && !icons.has(id) && !iconsWanted.has(id));
    if (!ids.length) return;
    for (const id of ids) iconsWanted.add(id);
    try {
      const items = await client.many('/v2/items', ids);
      for (const id of ids) icons.set(id, iconUrl(items.get(id)?.icon) ?? '');
      showIcons();
      await options.cache.flush();
    } catch {
      // Decoration only: the next change to the list tries again.
    } finally {
      for (const id of ids) iconsWanted.delete(id);
    }
  }

  /** Ready the entry field for the next item, unless the player has moved elsewhere. */
  function focusEntry(): void {
    const at = document.activeElement;
    if (!at || at === document.body || at === addBtn || at === buildBtn) entryName.focus();
  }

  /** The typed item, or undefined after pointing at what is wrong with it. */
  function checkedEntry(): Extract<Entry, { goal: Goal }> | undefined {
    const parsed = parseEntry(entryName.value, entryQuantity.value);
    if ('goal' in parsed) return parsed;
    setStatus(status, parsed.error, 'error');
    (parsed.field === 'item' ? entryName : entryQuantity).focus();
    return undefined;
  }

  const readEntry = () => JSON.stringify([entryName.value, entryQuantity.value]);

  /** Empty the entry once used, unless the player has typed something else meanwhile. */
  function clearEntry(used: string): void {
    if (readEntry() !== used) return;
    entryName.value = '';
    entryQuantity.value = '1';
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
  function change(update: PlanUpdate, what: string, revert?: () => void, node = copyStatus): Promise<void> {
    if (!current || busy) return Promise.resolve();
    const { plan } = current;
    const epoch = holdingsEpoch;
    return run(node, `Changing ${what}...`, async () => {
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
    // Disabling a control takes focus from it.
    const focused = document.activeElement?.id;
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
      if (focused && document.activeElement === document.body) document.getElementById(focused)?.focus();
      void options.cache.flush();
    }
  }

  const replaceOk = (question = 'Replace the current plan?') =>
    !current ||
    !(
      current.plan.goals.length > 1 ||
      current.plan.done.length ||
      Object.keys(current.plan.choices).length ||
      Object.keys(current.plan.notes).length
    ) ||
    window.confirm(`${question} Its items, choices, finished steps and notes will be lost unless you downloaded its .json.`);

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

  /** Look a typed item up. Throws when there is no such item. */
  async function lookUp({ goal, input, quantity }: Extract<Entry, { goal: Goal }>): Promise<SelectedGoal> {
    const itemId = await resolveItem(goal, input);
    const item = await client.one('/v2/items', itemId);
    if (!item) throw new Error(`The GW2 API has no item for "${input.trim()}".`);
    icons.set(itemId, iconUrl(item.icon) ?? '');
    return { itemId, name: item.name, quantity };
  }

  const fetchOptions = {
    wiki,
    vendorCurrency: DEFAULT_VENDOR_CURRENCY,
    onProgress: (p: FetchProgress) => setStatus(status, progressText(p)),
  };

  buildBtn.addEventListener('click', () => {
    if (busy || current) return;
    // A name typed but not added is meant to be part of the plan.
    const typed = entryName.value.trim() ? checkedEntry() : undefined;
    if (entryName.value.trim() && !typed) return;
    if (!typed && !pending.length) {
      setStatus(status, 'Enter an item name or id.', 'error');
      entryName.focus();
      return;
    }
    const used = readEntry();
    void run(status, 'Looking up the items...', async () => {
      await restored;
      if (current) return ['Your saved plan was restored. Add the item to it, or start a new plan.', 'info'];
      if (typed) {
        pending = addToSelection(pending, await lookUp(typed));
        showGoals();
        clearEntry(used);
      }
      const wanted = pending;
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
        // Take down the partial plan.
        output.hidden = true;
        throw err;
      }
      void enrich(builds);
      return ['Plan ready.', 'ok'];
    }).then(focusEntry);
  });

  newBtn.addEventListener('click', () => {
    if (!current || busy || !replaceOk('Start a new plan?')) return;
    current = undefined;
    // Lookups still running belong to the plan that was dropped.
    builds++;
    dropSales();
    shownChoices = '';
    output.hidden = true;
    raw.value = '';
    preview.replaceChildren();
    updateInput.value = '';
    updateErrors.replaceChildren();
    for (const node of [status, background, copyStatus, updateStatus]) setStatus(node, '');
    showGoals();
    entryName.focus();
    void deletePlan().catch((err) => setStatus(status, `Couldn't remove the saved plan, so a reload will bring it back: ${describeError(err)}`, 'error'));
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

  // Enter in either entry field submits the form, which adds the item.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    const typed = checkedEntry();
    if (!typed) return;
    const used = readEntry();
    const epoch = holdingsEpoch;
    void run(status, 'Looking up the item...', async () => {
      // So the item joins a saved plan still being read, not a list it would replace.
      await restored;
      const found = await lookUp(typed);
      const base = current?.plan;
      const selection = addToSelection(base?.goals ?? pending, found);
      if (!base) {
        pending = selection;
        showGoals();
        clearEntry(used);
        return [`Added ${found.name}.`, 'ok'];
      }
      setStatus(status, 'Reading recipes and prices...');
      let plan = await addGoal(client, base, found.itemId, found.quantity, fetchOptions);
      // More of something already being made leaves the graph as it was.
      const grown = plan.data !== base.data;
      let note = '';
      if (grown) ({ plan, note } = await rereadHoldings(plan));
      await commit(plan, epoch, false, grown);
      clearEntry(used);
      void enrich(builds);
      return note ? [`Added to the plan. ${note}`, 'info'] : ['Added to the plan.', 'ok'];
    }).then(focusEntry);
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

  const READING_HOLDINGS = 'Reading your bank, bags, materials and wallet...';

  /**
   * Read holdings and use them in `plan`. Resolves to the gaps in what was read,
   * or undefined when the key was forgotten meanwhile and nothing was kept.
   */
  async function applyHoldings({ client, token }: Account, plan: CraftingPlan, epoch: number): Promise<string[] | undefined> {
    const info = token ?? (await client.get('/v2/tokeninfo'));
    const { holdings, notes } = await readHoldings(client, info.permissions);
    if (epoch !== holdingsEpoch) return undefined;
    await commit(updatePlan(withHoldings(plan, holdings), { settings: { useOwnMaterials: true } }).plan, epoch);
    return notes;
  }

  const HOLDINGS_DISCARDED = 'The key was forgotten, so the holdings were discarded.';

  function useHoldings(): void {
    const account = options.account();
    if (!account || !current || busy) return showSettings();
    const { plan } = current;
    const epoch = holdingsEpoch;
    void run(copyStatus, READING_HOLDINGS, async () => {
      try {
        const notes = await applyHoldings(account, plan, epoch);
        if (!notes) return [HOLDINGS_DISCARDED, 'info'];
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

  /** Like `run`, reporting beside the selling checkbox and counting the whole wait. */
  function whileSelling(message: string, task: () => Promise<[text: string, tone: Tone]>): void {
    setStatus(copyStatus, '');
    void run(sellStatus, message, async () => {
      const stop = startClock($('plan-sales-elapsed'));
      try {
        return await task();
      } finally {
        stop();
      }
    });
  }

  /** Read the conversions the boxes ask for, saying so. */
  async function loadConversions(read: AccountSales): Promise<void> {
    const wants = readConvertControls('plan-sales');
    const missing = read.conversions.missing(wants);
    if (!missing.length) return;
    setStatus(sellStatus, checkingText(missing));
    await read.conversions.load(wants);
  }

  /** Add sales to the plan, using the player's materials first if it doesn't yet. */
  function readSales(): void {
    const account = options.account();
    if (!account || !current || busy) return showSettings();
    const { plan } = current;
    const epoch = holdingsEpoch;
    const wanted = (selling = { client: account.client });
    const discarded = () => epoch !== holdingsEpoch || selling !== wanted;
    const using = holdingsInUse(plan);
    const reading = 'Reading what you can sell...';
    whileSelling(using ? reading : READING_HOLDINGS, async () => {
      try {
        let gaps: string[] = [];
        if (!using) {
          const notes = await applyHoldings(account, plan, epoch);
          if (!notes) return [HOLDINGS_DISCARDED, 'info'];
          gaps = notes;
          setStatus(sellStatus, reading);
        }
        const read = await readAccountSellables(account);
        if (!discarded()) await loadConversions(read);
        if (discarded()) return ['What was read to sell was discarded.', 'info'];
        selling = { ...wanted, read };
        rerender();
        return gaps.length ? [`Using your materials, with gaps: ${gaps.join('; ')}.`, 'info'] : ['', 'ok'];
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
    whileSelling('Reading...', async () => {
      await loadConversions(read);
      if (epoch !== holdingsEpoch || selling !== wanted) return ['What was read to sell was discarded.', 'info'];
      rerender();
      return ['Sales updated.', 'ok'];
    });
  }

  sellToggle.addEventListener('change', () => {
    if (busy) return;
    if (sellToggle.checked) return readSales();
    dropSales();
    rerender();
    setStatus(copyStatus, '');
  });

  // The selling options.
  sellBox.addEventListener('change', () => {
    if (busy) return;
    const read = selling?.read;
    if (read && read.conversions.missing(readConvertControls('plan-sales')).length) return readMoreConversions(read);
    setStatus(sellStatus, '');
    setStatus(copyStatus, '');
    rerender();
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

  showGoals();
  updateControls();

  return {
    keyChanged() {
      // What was read to sell belongs to the key that read it.
      if (selling && selling.client !== options.account()?.client) {
        dropSales();
        rerender();
      }
      updateControls();
    },
    async forgetHoldings() {
      holdingsEpoch++;
      dropSales();
      await restored;
      if (current) await commit(withoutHoldings(current.plan));
      // A saved plan that couldn't be restored may still hold account data.
      else await deletePlan().catch(() => undefined);
    },
  };
}
