#!/usr/bin/env node
// Capture one real response per GW2 API route into .samples/ (gitignored).
// Used to write and verify the response types in packages/client.
// Authenticated routes are captured only when GW2_API_KEY is set; their
// samples contain private account data and must never be committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://api.guildwars2.com';
const SCHEMA = '2025-08-29T01:00:00.000Z';
const OUT = new URL('../.samples/', import.meta.url).pathname;
const KEY = process.env.GW2_API_KEY?.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, query = {}, auth = false) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  url.searchParams.set('v', SCHEMA);
  if (auth && KEY) url.searchParams.set('access_token', KEY);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'gw2-ai sample capture' } });
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** i); continue; }
    let body; try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  }
  return { status: 0, body: null };
}

const spec = (await get('/v2.json', { v: 'latest' })).body;
mkdirSync(OUT, { recursive: true });

// Fill path params from the account where possible.
const fill = {};
if (KEY) {
  const chars = (await get('/v2/characters', {}, true)).body;
  fill.character = Array.isArray(chars) ? chars[0] : undefined;
  const acct = (await get('/v2/account', {}, true)).body;
  fill.guild = acct?.guild_leader?.[0] ?? acct?.guilds?.[0];
}
const seasons = (await get('/v2/pvp/seasons')).body;
fill.season = Array.isArray(seasons) ? seasons.at(-1) : undefined;
const decoCats = (await get('/v2/homestead/decorations/categories')).body;
fill.decoCat = Array.isArray(decoCats) ? decoCats[0] : undefined;

function concrete(route) {
  let p = route;
  if (p.startsWith('/v2/characters/:id')) p = p.replace(':id', encodeURIComponent(fill.character ?? 'x'));
  if (p.startsWith('/v2/guild/:id')) p = p.replace(':id', fill.guild ?? 'x');
  if (p.startsWith('/v2/pvp/seasons/:id')) p = p.replace(':id', fill.season ?? 'x');
  if (p.startsWith('/v2/homestead/decorations/categories/:id')) p = p.replace(':id', fill.decoCat ?? 1);
  return p.replace(':board', 'ladder').replace(':region', 'na');
}

// Routes the spec omits but the API serves.
const extra = [
  '/v2/commerce/transactions/current/buys', '/v2/commerce/transactions/current/sells',
  '/v2/commerce/transactions/history/buys', '/v2/commerce/transactions/history/sells',
];
const routes = [
  ...spec.routes.filter((r) => r.active).map((r) => ({ path: r.path, auth: r.auth, lang: r.lang })),
  ...extra.map((path) => ({ path, auth: true, lang: false })),
];
const seen = new Set();
const summary = [];
for (const r of routes) {
  if (seen.has(r.path) || r.path === '/v2/createsubtoken') continue;
  seen.add(r.path);
  if (r.auth && !KEY) { summary.push(`skip (no key) ${r.path}`); continue; }
  const path = concrete(r.path);
  const index = await get(path, {}, r.auth);
  const sample = { route: r.path, auth: r.auth, lang: r.lang, status: index.status, index: index.body };
  const ids = Array.isArray(index.body) && index.body.length && ['number', 'string'].includes(typeof index.body[0]) ? index.body : null;
  if (ids) {
    sample.bulk = { idType: typeof ids[0], count: ids.length };
    const pick = [ids[0], ids[Math.floor(ids.length / 2)], ids.at(-1)];
    const many = await get(path, { ids: [...new Set(pick)].join(',') }, r.auth);
    sample.bulk.idsStatus = many.status;
    sample.items = many.body;
    if (ids.length <= 1000) {
      const all = await get(path, { ids: 'all' }, r.auth);
      sample.bulk.all = all.status === 200 || all.status === 206;
    }
    sample.index = ids.slice(0, 5);
  }
  if (r.path === '/v2/tokeninfo' && sample.index) sample.index.id = 'REDACTED';
  writeFileSync(join(OUT, r.path.replace(/^\/v2\//, '').replace(/[/:]/g, '_') + '.json'), JSON.stringify(sample, null, 2));
  summary.push(`${String(index.status).padEnd(3)} ${ids ? `bulk(${sample.bulk.idType},${sample.bulk.count}${sample.bulk.all ? ',all' : ''})` : 'single'.padEnd(6)} ${r.auth ? 'A' : ' '} ${r.path}`);
}
writeFileSync(join(OUT, '_summary.txt'), summary.join('\n') + '\n');
console.log(summary.join('\n'));
