/**
 * Regression test: the store viewer's failure pages must not run code.
 *
 * THE BUG THIS EXISTS FOR
 * The store viewer has two failure pages — the one for a store that REFUSES
 * us and the one for a store that could not be REACHED — and both put the
 * store's name and the store's URL into the markup as it stands.
 *
 * The URL is not a fixed string. The route builds it from the request:
 *
 *     const { host, path, url: target } = storeViewerTarget(rest, query);
 *
 * so `target` carries the caller's own path and query, byte for byte. A
 * double quote in the query ended the href attribute, and everything after
 * it was parsed as markup:
 *
 *     <a href="https://www.jiomart.com/?a="><script>alert(1)</script>" ...>
 *
 * That script runs on the app's OWN origin — the one the permanent link
 * serves — and the bridge's own comments say why that matters: the shared
 * secret ships in the publicly served bundle, so script on this origin can
 * pull the token out of it and drive every /api route as the user. The
 * store-viewer route sits outside the token gate (only /api and /uploads
 * are behind it), so a crafted link is all it takes.
 *
 * WHAT IS TESTED HERE
 *   1. neither failure page emits a raw "<script" for a hostile name or URL;
 *   2. the ROUTE does not either — a test of the page functions alone would
 *      pass while the route kept serving the unescaped page;
 *   3. the "open the store" link still points at the store afterwards, so the
 *      fix did not quietly break the one thing that works.
 *
 * Run with:  node scripts/test-store-viewer-escaping.mjs
 */
import { createServer } from 'node:net';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const bridgeDir = join(repoRoot, 'bridge', 'shift ');
const bridgeFile = join(bridgeDir, 'index.mjs');
const viewerModule = join(bridgeDir, 'storeViewer.mjs');

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

/** A port nothing is listening on. */
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

/**
 * Make sure the bridge's own dependencies can be resolved.
 *
 * WHY THIS IS NEEDED: the bridge has its own node_modules, and that
 * directory is not tracked by git — so it is not in the export the quality
 * gate checks. The export's node_modules is a symlink to the real checkout's.
 */
function ensureBridgeDependencies() {
  const modules = join(bridgeDir, 'node_modules');
  if (existsSync(join(modules, 'express'))) return;

  const checkout = dirname(realpathSync(join(repoRoot, 'node_modules')));
  const real = join(checkout, 'bridge', 'shift ', 'node_modules');
  if (!existsSync(join(real, 'express'))) {
    throw new Error(`cannot find the bridge's dependencies at ${real}`);
  }
  symlinkSync(real, modules);
}

// The real fetch, kept before the stub below replaces it.
const realFetch = globalThis.fetch.bind(globalThis);

/**
 * The store's own site, without the network.
 *
 * Only the OUTBOUND call is replaced. The route is the bridge's own, so what
 * the test reads is what the browser would be told.
 */
globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  if (target.startsWith('https://www.jiomart.com/refused')) {
    return new Response('no', { status: 403, headers: { 'content-type': 'text/html' } });
  }
  // The store cannot be reached at all: the request never arrived.
  if (target.startsWith('https://www.jiomart.com/unreachable')) {
    throw new Error('getaddrinfo ENOTFOUND www.jiomart.com');
  }
  return new Response('<!doctype html><html><head><title>store</title></head><body>ok</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

/**
 * Send a request whose target is NOT url-encoded.
 *
 * WHY THIS IS NOT A NORMAL FETCH: fetch() percent-encodes the quote and the
 * angle brackets on the way out, so the server would never see the
 * characters that break the page. Node's http client puts the `path` option
 * into the request line verbatim, which is exactly what a hostile link
 * looks like on the wire.
 */
function rawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

ensureBridgeDependencies();

// ─── the two pages ──────────────────────────────────────────────────────
const { storeViewerBlockedPage, storeViewerUnreachablePage } = await import(viewerModule);

console.log('\nthe failure pages do not emit markup the caller wrote');

const hostile = '"><script>alert(1)</script>';
const hostileUrl = `https://www.jiomart.com/${hostile}`;

for (const [name, build] of [
  ['the refused page', storeViewerBlockedPage],
  ['the unreachable page', storeViewerUnreachablePage],
]) {
  const fromName = build(hostile, 'https://www.jiomart.com/');
  const fromUrl = build('Jio Mart', hostileUrl);

  ok(!/<script/i.test(fromName), `${name} does not turn a hostile store name into a script tag`);
  ok(!/<script/i.test(fromUrl), `${name} does not turn a hostile store URL into a script tag`);
  ok(!/"><script/i.test(fromUrl), `${name} does not let a quote break out of the href attribute`);
  ok(fromUrl.includes('&lt;script&gt;'), `${name} shows the caller's text as text, not as markup`);
  ok(/href="https:\/\/www\.jiomart\.com\//.test(fromUrl), `${name} still links to the store`);
}

// ─── the route ──────────────────────────────────────────────────────────
// WHY THE BRIDGE IS BOOTED: a test of the page functions alone would pass
// while the route kept serving the unescaped page. The route is the bridge's
// own, so what it answers is what the browser would be told.
const work = mkdtempSync(join(tmpdir(), 'hh-store-escaping-'));
const webRoot = join(work, 'dist');
mkdirSync(webRoot);
writeFileSync(
  join(webRoot, 'index.html'),
  '<!doctype html><html><head><title>HomeHub</title></head><body></body></html>',
);
process.env.WEB_DIST_DIR = webRoot;

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

console.log('\nthe route does not serve the caller\'s markup either');

for (const [label, path] of [
  ['the refused store', `/store-viewer/www.jiomart.com/refused?a=${hostile}`],
  ['the unreachable store', `/store-viewer/www.jiomart.com/unreachable?a=${hostile}`],
]) {
  const res = await rawRequest(port, path);
  ok(res.status === 200, `${label} is answered`, `status=${res.status}`);
  ok(!/<script/i.test(res.body), `${label} does not serve a script tag the caller wrote`);
  ok(!/"><script/i.test(res.body), `${label} does not let a quote break out of the href attribute`);
  ok(res.body.includes('&lt;script&gt;'), `${label} shows the caller's text as text, not as markup`);
  ok(
    /href="https:\/\/www\.jiomart\.com\/(refused|unreachable)\?a=/.test(res.body),
    `${label} still links to the store`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
