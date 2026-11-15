import { defineConfig, type Plugin } from 'vite';

/**
 * Content Security Policy for the built site. Injected only at build time:
 * the dev server needs inline scripts and websockets for hot reload.
 * frame-ancestors can't be set from a <meta> tag, so it's absent here.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https://render.guildwars2.com data:",
  'connect-src https://api.guildwars2.com https://wiki.guildwars2.com',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'gw2-ai:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Right after <meta charset>, so the policy covers every later element.
        const charset = /<meta charset="utf-8"\s*\/?>/i;
        if (!charset.test(html)) throw new Error('index.html needs <meta charset="utf-8"> for the CSP plugin');
        return html.replace(charset, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [csp()],
  build: {
    target: 'es2022',
    // The polyfill is an inline script, which the CSP forbids.
    modulePreload: { polyfill: false },
    // Keep everything as files; data: URIs for scripts would also violate the CSP.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
