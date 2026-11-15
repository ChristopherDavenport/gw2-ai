/**
 * Markdown preview. Report text includes player-controlled strings (character
 * and guild names, item inscriptions), so marked's HTML is always passed
 * through DOMPurify before it reaches the DOM.
 */
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/** Same slug rule as the report's table of contents (GitHub-style). */
function anchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

const marked = new Marked({ gfm: true, async: false });
marked.use({
  renderer: {
    heading({ tokens, depth, text }) {
      const id = anchor(text);
      const inner = this.parser.parseInline(tokens);
      return id ? `<h${depth} id="${id}">${inner}</h${depth}>\n` : `<h${depth}>${inner}</h${depth}>\n`;
    },
  },
});

const purifier = DOMPurify();
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLAnchorElement) {
    const href = node.getAttribute('href') ?? '';
    if (href && !href.startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

/** Render markdown to sanitized HTML (as a DocumentFragment, ready to insert). */
export function renderMarkdown(md: string): DocumentFragment {
  // DOMPurify returns its input untouched when it can't run; fail closed instead.
  if (!purifier.isSupported) {
    const fragment = document.createDocumentFragment();
    const pre = document.createElement('pre');
    pre.textContent = md;
    fragment.append(pre);
    return fragment;
  }
  const html = marked.parse(md, { async: false });
  return purifier.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style'],
  });
}
