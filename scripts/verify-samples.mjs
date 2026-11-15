#!/usr/bin/env node
// Check the client's response types against real responses in .samples/
// (captured by scripts/capture-samples.mjs). Each sample is emitted as an
// object literal with `satisfies <declared type>`, so tsc reports both wrong
// types and fields the type doesn't declare.
//
//   node scripts/verify-samples.mjs [route-prefix ...]
//
// Reads ROUTES straight from packages/client/src (via tsx); no build needed.
// A route may have several sample files (e.g. .samples/items__by_type.json
// with the same `route`); `index` is optional on extra samples.
// Output files live in .samples/ (gitignored: auth samples are private data).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tsImport } from 'tsx/esm/api';

const root = new URL('..', import.meta.url).pathname;
const samplesDir = join(root, '.samples');
const { ROUTES } = await tsImport(join(root, 'packages/client/src/routes/index.ts'), import.meta.url);
const prefixes = process.argv.slice(2);
const wanted = (route) => prefixes.length === 0 || prefixes.some((p) => route.startsWith(p));

const samples = new Map();
for (const f of readdirSync(samplesDir)) {
  if (!f.endsWith('.json')) continue;
  const s = JSON.parse(readFileSync(join(samplesDir, f), 'utf8'));
  samples.set(s.route, [...(samples.get(s.route) ?? []), s]);
}

const lines = [`import type { ItemOf, ResponseOf } from '../packages/client/src/index.js';`, ''];
const lineRoute = [];
const emit = (route, code) => {
  const start = lines.length + 1;
  lines.push(code);
  for (let i = start; i <= lines.length + code.split('\n').length; i++) lineRoute[i] = route;
};
const unverified = [];
let n = 0;
for (const route of Object.keys(ROUTES).filter(wanted).sort()) {
  const ok = (samples.get(route) ?? []).filter((s) => s.status === 200 || s.status === 206);
  if (!ok.length) {
    const s = samples.get(route)?.[0];
    unverified.push(`${route}${s ? ` (sample status ${s.status})` : ' (no sample)'}`);
    continue;
  }
  ok.forEach((s, k) => {
    if (s.index !== undefined) emit(route, `export const r${n}_${k} = (${JSON.stringify(s.index)}) satisfies ResponseOf<'${route}'>;`);
    if (ROUTES[route].bulk && Array.isArray(s.items)) {
      emit(route, `export const i${n}_${k} = (${JSON.stringify(s.items)}) satisfies ItemOf<'${route}'>[];`);
    }
  });
  n++;
}
const notInClient = [...samples.values()]
  .map((list) => list[0])
  .filter((s) => (s.status === 200 || s.status === 206) && wanted(s.route) && !(s.route in ROUTES))
  .map((s) => s.route)
  .sort();

const tag = prefixes.length ? createHash('sha1').update(prefixes.join('\n')).digest('hex').slice(0, 10) : 'all';
const checkFile = join(samplesDir, `checks-${tag}.ts`);
const tsconfig = join(samplesDir, `tsconfig-${tag}.json`);
writeFileSync(checkFile, lines.join('\n') + '\n');
writeFileSync(
  tsconfig,
  JSON.stringify({
    extends: '../tsconfig.base.json',
    compilerOptions: { noEmit: true, noUnusedLocals: false },
    files: [`checks-${tag}.ts`],
  }),
);

let output = '';
try {
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', tsconfig, '--pretty', 'false'], { encoding: 'utf8' });
} catch (err) {
  output = String(err.stdout ?? '') + String(err.stderr ?? '');
}

const byRoute = new Map();
for (const line of output.split('\n')) {
  const m = line.match(/checks-[\w]+\.ts\((\d+),\d+\): error (TS\d+: .*)/);
  if (!m) continue;
  const route = lineRoute[Number(m[1])] ?? '?';
  // Trim the huge literal types tsc echoes back.
  const msg = m[2].length > 400 ? m[2].slice(0, 400) + ' …' : m[2];
  byRoute.set(route, [...(byRoute.get(route) ?? []), msg]);
}

const verified = n - byRoute.size;
console.log(`verified ${verified}/${n} routes with samples${prefixes.length ? ` (prefix ${prefixes.join(', ')})` : ''}`);
for (const [route, errs] of byRoute) {
  console.log(`\nFAIL ${route}`);
  for (const e of errs.slice(0, 8)) console.log(`  ${e}`);
  if (errs.length > 8) console.log(`  … ${errs.length - 8} more`);
}
if (unverified.length) console.log(`\nIn client but not verifiable:\n  ${unverified.join('\n  ')}`);
if (notInClient.length) console.log(`\nSampled but missing from the client:\n  ${notInClient.join('\n  ')}`);
process.exitCode = byRoute.size || notInClient.length ? 1 : 0;
