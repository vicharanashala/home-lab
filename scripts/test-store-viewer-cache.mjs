/**
 * The store viewer's cache has to give the memory back.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * The cache added in d824356 is a Map keyed by the store's whole address —
 * path and query string — and its time-to-live only decided whether an entry
 * may be SERVED. Nothing ever removed one. So every page the owner browsed
 * to stayed in the bridge's memory for as long as the bridge ran: a measured
 * 70 MB for forty one-megabyte pages, and 0 MB handed back after the entries
 * had gone stale. The bridge is the one process every screen of the app
 * depends on.
 *
 * The second defect is smaller and nastier: the answer to a POST — the
 * store's add to cart — was kept for an hour whenever it did not say it was
 * JSON. A cart that answers with no content type at all would be kept.
 *
 * WHY A FAKE STORE AND NOT THE REAL ONE
 * The test must not depend on a grocery site being up, on how big its page
 * happens to be today, or on how fast its server is. The store is stubbed
 * and the thing being checked is what this bridge does with it.
 *
 * Run with:  node scripts/test-store-viewer-cache.mjs
 */
import { createServer } from 'node:net';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createStoreViewerPageCache,
  STORE_VIEWER_PAGE_CACHE_MAX,
} from '../bridge/shift /storeViewer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const bridgeDir = join(repo, 'bridge', 'shift ');
const bridgeFile = join(bridgeDir, 'index.mjs');

let passed = 0;
let failed = 0;

function ok(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function ensureBridgeDependencies() {
  const modules = join(bridgeDir, 'node_modules');
  if (existsSync(join(modules, 'express'))) return;
  // WHY ONE dirname AND NOT TWO: the checkout's node_modules is
  // <checkout>/node_modules, so its parent is the checkout itself. Two
  // dirnames point at the checkout's PARENT, and the bridge's dependencies
  // are not up there.
  //
  // WHY THIS MATTERS WHEN THE TEST RUNS FROM AN EXPORT: the quality gate
  // exports the index to a temporary directory and links that directory's
  // node_modules to the real checkout's. The link resolves to the REAL
  // checkout, so this has to follow it — otherwise the test looks for the
  // bridge's dependencies one level above the repository, finds nothing,
  // and fails.
  const checkout = dirname(realpathSync(join(repo, 'node_modules')));
  const real = join(checkout, 'bridge', 'shift ', 'node_modules');
  if (!existsSync(join(real, 'express'))) {
    throw new Error(`cannot find the bridge's dependencies at ${real}`);
  }
  symlinkSync(real, modules);
}

const realFetch = globalThis.fetch.bind(globalThis);

const HOST = 'www.jiomart.com';
const PREFIX = `/store-viewer/${HOST}`;

const BIG_PAGE = [
  '<!doctype html><html><head><title>Store</title></head><body>',
  '<p>padding padding padding padding padding padding padding</p>'.repeat(4000),
  '</body></html>',
].join('\n');

let storeCalls = 0;

globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  storeCalls += 1;
  // The cart answers with no content type at all — a 204. That is the case
  // the content-type test misses and the method catches.
  if (target.includes('/cart')) {
    return new Response(null, { status: 204, headers: {} });
  }
  return new Response(BIG_PAGE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

console.log('\nthe cache gives the memory back');
{
  const cache = createStoreViewerPageCache({ max: 3 });
  cache.set('a', 'A', 1_000);
  cache.set('b', 'B', 1_000);
  cache.set('c', 'C', 1_000);
  ok(cache.size === 3, 'it holds what it was given', String(cache.size));

  cache.set('d', 'D', 1_000);
  ok(cache.size === 3, 'and it never holds more than it was allowed to', String(cache.size));
  ok(cache.get('a', 1_000) === undefined, 'the oldest page was the one that went');
  ok(cache.get('d', 1_000) === 'D', 'and the newest page is there');
}

console.log('\na page the person came back to is not the one that goes');
{
  const cache = createStoreViewerPageCache({ max: 2 });
  cache.set('a', 'A', 1_000);
  cache.set('b', 'B', 1_000);
  // The owner comes back to the first page, and then browses somewhere new.
  cache.set('a', 'A again', 1_000);
  cache.set('c', 'C', 1_000);
  ok(
    cache.get('a', 1_000) === 'A again',
    'the page they came back to is still there',
    String(cache.get('a', 1_000)),
  );
  ok(
    cache.get('b', 1_000) === undefined,
    'and the one nobody looked at again is the one that went',
  );
}

console.log('\nan entry that has gone stale is dropped, not merely not served');{
  const cache = createStoreViewerPageCache({ max: 8, ttlMs: 60_000 });
  cache.set('a', 'A', 1_000);
  ok(cache.size === 1, 'the page is held', String(cache.size));
  // 61 seconds later than the page was put in.
  ok(cache.get('a', 62_000) === undefined, 'a stale page is not served');
  ok(cache.size === 0, 'and it is GIVEN BACK, not kept for another minute', String(cache.size));
}

console.log('\nthe bridge forgets the pages it has already shown');
ensureBridgeDependencies();

const port = await freePort();
process.env.PORT = String(port);
await import(bridgeFile);

for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    await realFetch(`http://127.0.0.1:${port}/`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const base = `http://127.0.0.1:${port}`;

{
  // Browse to more pages than the cache is allowed to hold, all inside the
  // page's minute so that nothing is stale and the ONLY reason the first
  // page can be missing is that the cache gave it up to make room.
  const visits = STORE_VIEWER_PAGE_CACHE_MAX + 2;
  for (let i = 0; i < visits; i += 1) {
    const res = await realFetch(`${base}${PREFIX}/search?q=item${i}`);
    await res.text();
  }

  const beforeFirst = storeCalls;
  await realFetch(`${base}${PREFIX}/search?q=item0`).then((r) => r.text());
  ok(
    storeCalls > beforeFirst,
    'the oldest page is fetched from the store again, so it was let go',
    `${storeCalls - beforeFirst} extra call(s)`,
  );

  const beforeLast = storeCalls;
  await realFetch(`${base}${PREFIX}/search?q=item${visits - 1}`).then((r) => r.text());
  ok(
    storeCalls === beforeLast,
    'and the newest page is still there, which is the whole point of the cache',
    `${storeCalls - beforeLast} extra call(s)`,
  );
}

console.log('\nthe answer to the owner\'s order is never kept');
{
  const before = storeCalls;
  const res = await realFetch(`${base}${PREFIX}/cart`, { method: 'POST', body: '{"qty":2}' });
  await res.text();
  ok(storeCalls > before, 'the store was asked, so the cart really went through');
  const cache = res.headers.get('cache-control') || '';
  ok(
    !/max-age/.test(cache),
    'a cart that answers with no content type is not cached for an hour',
    cache || 'none',
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
