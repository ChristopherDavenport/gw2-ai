import {
  Gw2ApiError,
  Gw2Client,
  TTL,
  looksLikeApiKey,
  missingPermissions,
  type TokenInfo,
} from '@gw2kit/client';
import { SECTIONS, TOKEN_TTL, buildReport, characterSectionId, type Report, type SectionResult } from '@gw2-ai/core';
import { IdbCache } from './cache-store.js';
import { reportFilename } from './filename.js';
import { renderMarkdown } from './markdown.js';
import * as vault from './vault.js';
import './style.css';

// ---- DOM helpers ----------------------------------------------------------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

type Tone = 'info' | 'ok' | 'error';

function setStatus(node: HTMLElement, text: string, tone: Tone = 'info'): void {
  node.textContent = text;
  node.dataset.tone = tone;
}

// ---- Elements -------------------------------------------------------------

const keyForm = $<HTMLFormElement>('key-form');
const keyInput = $<HTMLInputElement>('key-input');
const keySubmit = $<HTMLButtonElement>('key-submit');
const keySaved = $('key-saved');
const keyName = $('key-name');
const keyPerms = $('key-perms');
const keyForget = $<HTMLButtonElement>('key-forget');
const keyStatus = $('key-status');

const reportForm = $<HTMLFormElement>('report-form');
const sectionList = $('section-list');
const characterList = $('character-list');
const characterStatus = $('character-status');
const optValuation = $<HTMLInputElement>('opt-valuation');
const optFull = $<HTMLInputElement>('opt-full');
const generateBtn = $<HTMLButtonElement>('generate');
const generateHint = $('generate-hint');
const reportStatus = $('report-status');
const progressList = $('progress');

const output = $('output');
const raw = $<HTMLTextAreaElement>('raw');
const preview = $('panel-preview');
const copyStatus = $('copy-status');
const sectionCopy = $('section-copy');
const tabs = [$<HTMLButtonElement>('tab-raw'), $<HTMLButtonElement>('tab-preview')];

// ---- State ----------------------------------------------------------------

const cache = new IdbCache();
let client: Gw2Client | undefined;
let token: TokenInfo | undefined;
let report: Report | undefined;
let accountName = 'account';
let generating = false;

// ---- Key handling ---------------------------------------------------------

function describeError(err: unknown): string {
  if (err instanceof Gw2ApiError) {
    if (err.isAuthError) return `The GW2 API rejected this key: ${err.text}`;
    if (err.status === 0) return `Couldn't reach api.guildwars2.com (${err.text}). Check your connection and try again.`;
    return `The GW2 API returned an error (${err.status}): ${err.text}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function checkKey(key: string): Promise<{ c: Gw2Client; info: TokenInfo }> {
  const c = new Gw2Client({ apiKey: key, cache });
  const info = await tokenInfo(c);
  return { c, info };
}

function tokenInfo(c: Gw2Client): Promise<TokenInfo> {
  return c.get('/v2/tokeninfo', { ttlMs: TOKEN_TTL });
}

function showKey(info: TokenInfo | undefined): void {
  keyForm.hidden = true;
  keySaved.hidden = false;
  keyName.textContent = info ? `"${info.name}"` : '(not checked)';
  keyPerms.textContent = info ? `· ${info.permissions.join(', ')}` : '';
  renderSections();
  void loadCharacters();
}

function showKeyForm(): void {
  keyForm.hidden = false;
  keySaved.hidden = true;
  renderSections();
  characterList.replaceChildren();
  setStatus(characterStatus, 'Add an API key to list your characters.');
}

keyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitKey();
});

async function submitKey(): Promise<void> {
  const key = keyInput.value.trim();
  if (!key) {
    setStatus(keyStatus, 'Paste your API key first.', 'error');
    keyInput.focus();
    return;
  }
  if (!looksLikeApiKey(key)) {
    setStatus(keyStatus, "That doesn't look like a GW2 API key.", 'error');
    keyInput.setAttribute('aria-invalid', 'true');
    keyInput.focus();
    return;
  }
  keyInput.removeAttribute('aria-invalid');
  keySubmit.disabled = true;
  keyInput.disabled = true;
  setStatus(keyStatus, 'Checking the key...');
  try {
    const checked = await checkKey(key);
    let note = '';
    try {
      await vault.saveKey(key);
    } catch (err) {
      vault.useForSession(key);
      note = `Using the key for this visit only: it couldn't be saved in this browser (${describeError(err)}).`;
    }
    client = checked.c;
    token = checked.info;
    keyInput.value = '';
    showKey(token);
    setStatus(keyStatus, note, note ? 'error' : 'ok');
    generateBtn.focus();
  } catch (err) {
    keyInput.setAttribute('aria-invalid', 'true');
    setStatus(keyStatus, describeError(err), 'error');
  } finally {
    keySubmit.disabled = false;
    keyInput.disabled = false;
  }
}

keyForget.addEventListener('click', () => {
  void forget();
});

async function forget(): Promise<void> {
  try {
    await vault.forgetKey();
    setStatus(keyStatus, 'Key forgotten.', 'ok');
  } catch (err) {
    vault.clearSession();
    setStatus(keyStatus, `Couldn't delete the saved key: ${describeError(err)}`, 'error');
  }
  client = undefined;
  token = undefined;
  report = undefined;
  output.hidden = true;
  raw.value = '';
  preview.replaceChildren();
  sectionCopy.replaceChildren();
  progressList.hidden = true;
  progressList.replaceChildren();
  setStatus(reportStatus, '');
  showKeyForm();
  keyInput.focus();
}

async function restoreKey(): Promise<void> {
  let key: string | undefined;
  try {
    if (!(await vault.hasSavedKey())) return;
    key = await vault.loadKey();
  } catch (err) {
    showKey(undefined);
    setStatus(keyStatus, describeError(err), 'error');
    return;
  }
  if (!key) return;
  client = new Gw2Client({ apiKey: key, cache });
  showKey(undefined);
  setStatus(keyStatus, 'Checking the saved key...');
  try {
    token = await tokenInfo(client);
    showKey(token);
    setStatus(keyStatus, '');
  } catch (err) {
    setStatus(keyStatus, `${describeError(err)}. If the key was deleted or changed, forget it and enter a new one.`, 'error');
  }
}

// ---- Sections -------------------------------------------------------------

function sectionBoxes(): HTMLInputElement[] {
  return [...sectionList.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
}

function renderSections(): void {
  const previous = new Map(sectionBoxes().map((b) => [b.value, b.checked]));
  sectionList.replaceChildren();
  for (const s of SECTIONS) {
    const id = `sec-${s.id}`;
    const box = el('input');
    box.type = 'checkbox';
    box.id = id;
    box.value = s.id;
    const missing = token ? missingPermissions(token.permissions, s.permissions) : [];
    box.disabled = missing.length > 0;
    box.checked = !box.disabled && (previous.get(s.id) ?? true);

    const label = el('label', { className: 'option' });
    label.htmlFor = id;
    const text = el(
      'span',
      {},
      el('span', { className: 'option-title', text: s.title }),
      el('span', { className: 'option-help', text: s.summary }),
    );
    if (missing.length) {
      const reasonId = `${id}-reason`;
      const reason = el('span', { className: 'option-reason', text: `Needs permission: ${missing.join(', ')}` });
      reason.id = reasonId;
      box.setAttribute('aria-describedby', reasonId);
      text.append(reason);
    }
    label.append(box, text);
    sectionList.append(el('li', { className: missing.length ? 'disabled' : '' }, label));
  }
  updateGenerate();
}

// ---- Characters -----------------------------------------------------------

function characterBoxes(): HTMLInputElement[] {
  return [...characterList.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
}

let characterLoad = 0;

async function loadCharacters(): Promise<void> {
  const load = ++characterLoad;
  const previous = new Set(characterBoxes().filter((b) => b.checked).map((b) => b.value));
  characterList.replaceChildren();
  if (!client || !token) {
    setStatus(characterStatus, client ? '' : 'Add an API key to list your characters.');
    return;
  }
  const missing = missingPermissions(token.permissions, ['characters']);
  if (missing.length) {
    setStatus(characterStatus, 'Needs permission: characters. Create a key with it to include characters.', 'error');
    return;
  }
  setStatus(characterStatus, 'Loading characters...');
  let names: string[];
  try {
    names = await client.ids('/v2/characters', { ttlMs: TTL.account });
  } catch (err) {
    if (load === characterLoad) setStatus(characterStatus, `Couldn't list characters: ${describeError(err)}`, 'error');
    return;
  }
  if (load !== characterLoad) return;
  names.forEach((name, i) => {
    const id = `char-${i}`;
    const box = el('input');
    box.type = 'checkbox';
    box.id = id;
    box.value = name;
    box.checked = previous.has(name);
    const label = el('label', { className: 'option' });
    label.htmlFor = id;
    label.append(box, el('span', {}, el('span', { className: 'option-title', text: name })));
    characterList.append(el('li', {}, label));
  });
  const noBuilds = missingPermissions(token.permissions, ['builds']).length > 0;
  setStatus(
    characterStatus,
    !names.length
      ? 'No characters on this account.'
      : noBuilds
        ? 'The key lacks the builds permission, so templates and gear will be left out; crafting and bags are still included.'
        : '',
    noBuilds && names.length ? 'error' : 'info',
  );
}

function updateGenerate(): void {
  generateBtn.disabled = generating || !client;
  generateHint.hidden = Boolean(client);
}

$('select-all').addEventListener('click', () => {
  for (const b of sectionBoxes()) if (!b.disabled) b.checked = true;
});
$('select-none').addEventListener('click', () => {
  for (const b of sectionBoxes()) b.checked = false;
});

// ---- Generate -------------------------------------------------------------

reportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void generate();
});

const STATUS_LABEL: Record<SectionResult['status'] | 'pending', string> = {
  pending: 'working',
  ok: 'done',
  skipped: 'skipped',
  error: 'failed',
};

async function generate(): Promise<void> {
  if (!client || generating) return;
  const chosen = sectionBoxes().filter((b) => b.checked && !b.disabled).map((b) => b.value);
  const characters = characterBoxes().filter((b) => b.checked).map((b) => b.value);
  const total = chosen.length + characters.length;
  if (!total) {
    setStatus(reportStatus, 'Pick at least one section or character.', 'error');
    return;
  }
  generating = true;
  updateGenerate();
  setStatus(reportStatus, `Generating ${total} section${total === 1 ? '' : 's'}...`);

  const rows = new Map<string, HTMLLIElement>();
  progressList.replaceChildren();
  const planned = [
    ...chosen.map((id) => ({ id, title: SECTIONS.find((s) => s.id === id)?.title ?? id })),
    ...characters.map((name) => ({ id: characterSectionId(name), title: `Character: ${name}` })),
  ];
  for (const { id, title } of planned) {
    const row = el('li', {}, el('span', { className: 'progress-title', text: title }), progressBadge('pending'));
    row.dataset.status = 'pending';
    rows.set(id, row);
    progressList.append(row);
  }
  progressList.hidden = false;

  const started = performance.now();
  try {
    const result = await buildReport(client, {
      sections: chosen,
      characters,
      valuation: optValuation.checked,
      detail: optFull.checked ? 'full' : 'summary',
      onSection: (r) => {
        const row = rows.get(r.id);
        if (!row) return;
        row.dataset.status = r.status;
        row.replaceChildren(el('span', { className: 'progress-title', text: r.title }), progressBadge(r.status));
        if (r.reason) row.append(el('span', { className: 'progress-reason', text: r.reason }));
      },
    });
    accountName = await fetchAccountName(client);
    report = result;
    showReport(result);
    const failed = result.sections.filter((s) => s.status !== 'ok').length;
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    setStatus(
      reportStatus,
      failed
        ? `Report ready in ${secs}s. ${failed} section${failed === 1 ? '' : 's'} skipped or failed; see the list below.`
        : `Report ready in ${secs}s.`,
      failed ? 'info' : 'ok',
    );
  } catch (err) {
    setStatus(reportStatus, describeError(err), 'error');
  } finally {
    generating = false;
    updateGenerate();
    void cache.flush();
  }
}

function progressBadge(status: SectionResult['status'] | 'pending'): HTMLSpanElement {
  return el('span', { className: `badge status-${status}`, text: STATUS_LABEL[status] });
}

async function fetchAccountName(c: Gw2Client): Promise<string> {
  try {
    const account = await c.get('/v2/account', { ttlMs: TTL.account });
    return account.name;
  } catch {
    return 'account';
  }
}

// ---- Output ---------------------------------------------------------------

function showReport(r: Report): void {
  raw.value = r.markdown;
  preview.replaceChildren(renderMarkdown(r.markdown));
  sectionCopy.replaceChildren();
  for (const s of r.sections) {
    const btn = el('button', { text: `Copy "${s.title}"` });
    btn.type = 'button';
    btn.addEventListener('click', () => void copy(`## ${s.title}\n\n${s.markdown}\n`, `"${s.title}"`));
    const li = el('li', {}, btn);
    if (s.status !== 'ok') li.append(el('span', { className: 'muted', text: ` (${STATUS_LABEL[s.status]})` }));
    sectionCopy.append(li);
  }
  setStatus(copyStatus, '');
  output.hidden = false;
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(copyStatus, `Copied ${what} to the clipboard.`, 'ok');
  } catch {
    // Clipboard API can be unavailable (permissions, insecure context): select the text instead.
    selectTab(0);
    raw.focus();
    raw.select();
    setStatus(copyStatus, 'Couldn\'t copy automatically. The markdown is selected: press Ctrl+C (Cmd+C on Mac).', 'error');
  }
}

$('copy-all').addEventListener('click', () => {
  if (report) void copy(report.markdown, 'the report');
});

$('download').addEventListener('click', () => {
  if (!report) return;
  const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = reportFilename(accountName, new Date());
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus(copyStatus, `Downloaded ${a.download}.`, 'ok');
});

function selectTab(index: number): void {
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = $(tab.getAttribute('aria-controls') ?? '');
    panel.hidden = !selected;
  });
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(i));
  tab.addEventListener('keydown', (event) => {
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(next);
    tabs[next]?.focus();
  });
});

// ---- Start ----------------------------------------------------------------

renderSections();
setStatus(characterStatus, 'Add an API key to list your characters.');
void restoreKey();
