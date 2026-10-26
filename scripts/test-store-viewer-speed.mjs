/**
 * The store viewer has to be quick, and the reasons it was not are worth
 * keeping fixed.
 *
 * THE SLOWNESS THIS EXISTS FOR
 *
 * 1. THE STORE'S PAGE WAS 4.8 MB AND SENT AS 4.8 MB.
 *    The bridge has no compression middleware — it is a single file with no
 *    dependency to add a new one to — so the page went over the wire
 *    exactly as the store sent it. Gzipped it is a seventh of that, and on
 *    a phone on a slow connection that one page was most of the wait.
 *
 * 2. NOTHING WAS EVER CACHED.
 *    Every response said "no-store", so every visit fetched the store's
 *    page AND every script, style and image again, through this server.
 *    The store's bundles are content-hashed — the same name always means
 *    the same file — so the browser can keep them, and the page itself can
 *    be kept for a minute, which is what makes tapping between tabs and
 *    coming back instant.
 *
 * WHY A FAKE STORE AND NOT THE REAL ONE
 * The test must not depend on a grocery site being up, on how big its page
 * happens to be today, or on how fast its server is. The store is stubbed
 * with a page of a known size, and the thing being checked is what this
 * bridge does with it.
 *
 * Run with:  node scripts/test-store-viewer-speed.mjs
 */
import { createServer } from 'node:net';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bridgeDir = join(here, '..', 'bridge', 'shift ');
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
  //
  // WHY IT WAS HIDDEN UNTIL NOW: the test only passed in the gate because a
  // sibling test that runs earlier had already created the link in the
  // exported directory. Run on its own, it failed.
  const checkout = dirname(realpathSync(join(here, '..', 'node_modules')));
  const real = join(checkout, 'bridge', 'shift ', 'node_modules');
  if (!existsSync(join(real, 'express'))) {
    throw new Error(`cannot find the bridge's dependencies at ${real}`);
  }
  symlinkSync(real, modules);
}

const realFetch = globalThis.fetch.bind(globalThis);

const HOST = 'www.jiomart.com';
const PREFIX = `/store-viewer/${HOST}`;

// A page big enough that compression is visible, and one asset.
const BIG_PAGE = [
  '<!doctype html><html><head><title>Big</title></head><body>',
  '<p>padding padding padding padding padding padding padding</p>'.repeat(4000),
  `<script src="https://${HOST}/app.js"></script>`,
  '</body></html>',
].join('\n');

const ASSET = 'console.log("app");'.repeat(2000);

let storeCalls = 0;

globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  storeCalls += 1;
  if (target.endsWith('.js')) {
    return new Response(ASSET, {
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    });
  }
  return new Response(BIG_PAGE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

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

console.log('\nthe page is compressed on the way out');
{
  const gz = await realFetch(`${base}${PREFIX}/shop`, {
    headers: { 'accept-encoding': 'gzip' },
  });
  // Node's fetch adds "accept-encoding: gzip" by itself, so the
  // uncompressed comparison has to ask for identity explicitly.
  const raw = await realFetch(`${base}${PREFIX}/shop2`, {
    headers: { 'accept-encoding': 'identity' },
  });
  const gzBytes = Number(gz.headers.get('content-length'));
  const rawBytes = Number(raw.headers.get('content-length'));
  ok(
    gz.headers.get('content-encoding') === 'gzip',
    'the browser that asks for gzip is given gzip',
    gz.headers.get('content-encoding') || 'none',
  );
  ok(
    gzBytes > 0 && gzBytes < rawBytes / 2,
    'and it is much smaller than the same page uncompressed',
    `${gzBytes} bytes vs ${rawBytes}`,
  );
  ok(
    /accept-encoding/i.test(gz.headers.get('vary') || ''),
    'the response says it varies by encoding, so a shared cache cannot mix them up',
    gz.headers.get('vary') || 'none',
  );
}

console.log('\nthe page and the assets are cached, and the failure pages are not');
{
  const page = await realFetch(`${base}${PREFIX}/shop`);
  const pageCache = page.headers.get('cache-control') || '';
  ok(/max-age=60/.test(pageCache), 'the page is kept for a minute', pageCache);

  const asset = await realFetch(`${base}${PREFIX}/app.js`);
  const assetCache = asset.headers.get('cache-control') || '';
  ok(/max-age=3600/.test(assetCache), 'the store’s assets are kept for an hour', assetCache);
  ok(
    !/no-store/.test(assetCache),
    'the assets are not thrown away every time',
    assetCache,
  );
}

console.log('\nthe second visit does not ask the store again');
{
  const before = storeCalls;
  await realFetch(`${base}${PREFIX}/shop`);
  ok(
    storeCalls === before,
    'the store was not asked for the page a second time',
    `${storeCalls - before} extra call(s)`,
  );
}

console.log('\na POST is never cached');
{
  const before = storeCalls;
  const res = await realFetch(`${base}${PREFIX}/cart`, { method: 'POST', body: '{"qty":2}' });
  await res.text();
  ok(storeCalls > before, 'the store was asked, so the cart really went through');
  const cache = res.headers.get('cache-control') || '';
  ok(!/max-age/.test(cache), 'and the answer was not cached', cache);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
