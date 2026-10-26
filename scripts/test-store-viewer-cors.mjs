/**
 * Regression test: the sandboxed store page must still be able to POST.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * The store viewer serves a grocery site's page from the app's own origin, so
 * the site refuses to be framed and the app frames it instead. Commit
 * a8fd311 ("Keep the store's page off the app's origin") then put the served
 * page in a CSP sandbox without "allow-same-origin", so the store's scripts
 * can no longer read the owner's grocery list out of the app's localStorage.
 * That is the fix, and it is right.
 *
 * But the sandbox does one more thing, and this is the part that breaks the
 * store: a document without "allow-same-origin" has an OPAQUE origin. The
 * browser serialises that origin as the string "null" and sends
 * "Origin: null" on the document's requests.
 *
 * A request from an opaque document is CROSS-ORIGIN to the app, even when it
 * points at the app's own address. So the store's own API calls — the search,
 * the add-to-cart — are no longer same-origin requests, and the ones that
 * carry "content-type: application/json" or an "Authorization" header are no
 * longer simple requests. The browser sends a PREFLIGHT for them first.
 *
 * The bridge answers preflights in its CORS middleware, before any route
 * sees them, and that middleware refuses any origin that is not on its
 * allowlist:
 *
 *     if (!ALLOWED_ORIGINS.has(origin)) {
 *       if (req.method === 'OPTIONS') return res.status(403).end();
 *       return next();
 *     }
 *
 * "null" is not on the allowlist — it cannot be, because every sandboxed page
 * on the internet sends it. So the preflight is refused, the browser never
 * sends the POST, and the store's search and cart are dead. The page still
 * renders, because scripts and stylesheets are simple GETs and never get a
 * preflight at all — which is exactly what makes this hard to see.
 *
 * WHAT WAS MEASURED, AGAINST THE RUNNING APP
 *
 *     preflight, Origin: null, to the store viewer ....... 403 Forbidden
 *     preflight, Origin: null, to the app's own /api ....... 403 Forbidden
 *     preflight, the app's own origin, to the store viewer . 204 No Content
 *
 * The store's own bundle is not a guess: it sends "content-type:
 * application/json" (5 times), an "Authorization" header, and three
 * method:"POST" calls. Every one of those is a preflighted request.
 *
 * THE FIX, AND WHY IT IS NARROW
 *
 * The preflight is answered for "Origin: null" on the store viewer's path
 * ONLY. "null" is what any hostile sandboxed page on the internet sends, and
 * the allowlist exists precisely to keep those pages out of the app's API —
 * so the exemption cannot be general, and it cannot cover the app's own
 * routes. The store viewer's path is already restricted to three hosts
 * (STORE_VIEWER_HOSTS), and it is already outside the shared-secret gate, so
 * answering its preflight opens nothing that was not open to a simple GET
 * from the same document.
 *
 * Run with:  node scripts/test-store-viewer-cors.mjs
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 * WHY: the bridge has its own node_modules and that directory is not tracked
 * by git, so it is not in the export the quality gate checks. The export's
 * node_modules is a symlink to the real checkout's.
 */
function ensureBridgeDependencies() {
  const modules = join(bridgeDir, 'node_modules');
  if (existsSync(join(modules, 'express'))) return;

  const checkout = dirname(realpathSync(join(here, '..', 'node_modules')));
  const real = join(checkout, 'bridge', 'shift ', 'node_modules');
  if (!existsSync(join(real, 'express'))) {
    throw new Error(`cannot find the bridge's dependencies at ${real}`);
  }
  symlinkSync(real, modules);
}

// The real fetch, kept before the stub below replaces it.
const realFetch = globalThis.fetch.bind(globalThis);

/** The store's own site, without the network. */
const STORE_PAGE = '<!doctype html><html><head><title>store</title></head><body>ok</body></html>';
globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  return new Response(STORE_PAGE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

ensureBridgeDependencies();

/** A shell for the bridge to serve. */
const work = mkdtempSync(join(tmpdir(), 'hh-store-viewer-cors-'));
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

// Wait for the bridge to listen.
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    await realFetch(`http://127.0.0.1:${port}/`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const base = `http://127.0.0.1:${port}`;
const STORE_PATH = '/store-viewer/www.jiomart.com/api/service/search';

/**
 * The preflight a browser sends for a store API call from the sandboxed
 * page: a POST, with a JSON body type and the store's own Authorization
 * header, from a document whose origin is opaque.
 */
function preflight(path, origin, requestHeaders = 'content-type,authorization', method = 'POST') {
  return realFetch(`${base}${path}`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': requestHeaders,
    },
  });
}

console.log('\nthe sandboxed store page can still reach the store');
{
  const res = await preflight(STORE_PATH, 'null');
  ok(
    res.status !== 403,
    "the store's own POST is not refused before it is sent",
    `status=${res.status}`,
  );
  ok(
    (res.headers.get('access-control-allow-origin') || '') !== '',
    "the preflight says the answer may be read",
    `access-control-allow-origin=${res.headers.get('access-control-allow-origin')}`,
  );
  ok(
    (res.headers.get('access-control-allow-methods') || '').includes('POST'),
    'and that POST is one of the allowed methods',
    res.headers.get('access-control-allow-methods') || '',
  );
  ok(
    (res.headers.get('access-control-allow-headers') || '').includes('content-type'),
    'and that the JSON body type is one of the allowed headers',
    res.headers.get('access-control-allow-headers') || '',
  );
}

console.log('\nthe store\'s own headers are allowed through');
{
  // WHY THIS IS CHECKED: Jio Mart's bundle sets "X-XSRF-TOKEN" on its own
  // requests. A header the browser is not allowed to send is a request the
  // browser refuses outright, so a preflight that does not cover the store's
  // headers breaks the very calls this fix is about. The three stores do not
  // send the same headers, so the answer has to cover whatever the browser
  // says it is about to send.
  const res = await preflight(STORE_PATH, 'null', 'content-type,authorization,x-xsrf-token');
  const allowed = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
  ok(
    res.status !== 403,
    "the store's headers do not get the request refused",
    `status=${res.status}`,
  );
  ok(
    allowed.includes('x-xsrf-token'),
    "the store's own header is allowed",
    res.headers.get('access-control-allow-headers') || '',
  );
  ok(
    allowed.includes('authorization'),
    'and so is the store\'s authorization header',
    res.headers.get('access-control-allow-headers') || '',
  );
}

console.log('\nthe exemption does not open the app');
{
  const hostile = await preflight(STORE_PATH, 'https://evil.example');
  ok(
    hostile.status === 403,
    'a hostile page still cannot preflight the store viewer',
    `status=${hostile.status}`,
  );
  const appApi = await preflight('/api/health', 'null');
  ok(
    appApi.status === 403,
    "an opaque page still cannot preflight the app's own API",
    `status=${appApi.status}`,
  );
}

console.log("\nthe app's own origins are unaffected");
{
  const app = await preflight(STORE_PATH, 'http://127.0.0.1:8789');
  ok(
    app.status === 204,
    "the app's own origin still gets a preflight answered",
    `status=${app.status}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
