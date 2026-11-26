/** DOM helpers shared by the page's sections. Text only ever goes in as text, never as HTML. */
import { Gw2ApiError } from '@gw2kit/client';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
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

export type Tone = 'info' | 'ok' | 'error';

export function setStatus(node: HTMLElement, text: string, tone: Tone = 'info'): void {
  node.textContent = text;
  node.dataset.tone = tone;
}

export function describeError(err: unknown): string {
  if (err instanceof Gw2ApiError) {
    if (err.isAuthError) return `The GW2 API rejected this key: ${err.text}`;
    if (err.status === 0) return `Couldn't reach api.guildwars2.com (${err.text}). Check your connection and try again.`;
    return `The GW2 API returned an error (${err.status}): ${err.text}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Wire up an ARIA tab list (click and arrow keys). Returns the function that selects a tab. */
export function setupTabs(tabs: HTMLButtonElement[]): (index: number) => void {
  const select = (index: number): void => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute('aria-controls') ?? '').hidden = !selected;
    });
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (event) => {
      let next: number | undefined;
      if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      tabs[next]?.focus();
    });
  });
  return select;
}
