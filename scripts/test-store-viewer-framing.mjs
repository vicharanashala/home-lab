/**
 * Regression test: the store viewer has to be frameable by the app.
 *
 * THE BUG THIS EXISTS FOR
 * The store viewer fetches a grocery site's page on the owner's behalf and
 * serves it from the app's own origin, so that the app — not the store —
 * decides who may frame it. That only works if the browser is ALLOWED to
 * frame it.
 *
 * The bridge sets "X-Frame-Options: DENY" on every response, which is right
 * for the app: the app must not be framed by anyone. The store viewer's
 * documents were served with that same header, so the browser refused the
 * frame — and the user saw the browser's own "refused to connect" page
 * where the store should have been.
 *
 * The store viewer's own policy already said "frame-ancestors 'self'", which
 * is the permission it needed. But a browser enforces "X-Frame-Options" AND
 * the CSP "frame-ancestors" directive, and the strictest of the two wins —
 * so the permission that was there did not count.
 *
 * It was invisible: every other check was green, the page was served with a
 * 200, and the store's real HTML came back. Only a browser could tell that
 * the frame would be refused, and the symptom says nothing about the cause.
 *
 * WHAT IS TESTED HERE
 * The three ways the route answers with a document — the store's page, the
 * "the store refused us" page and the "we could not reach the store" page —
 * and the rule that the app itself must STILL refuse to be framed. The last
 * one is what makes the fix safe: the fix must loosen the store viewer and
 * nothing else.
 *
 * Run with:  node scripts/test-store-viewer-framing.mjs
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
 * WHY THIS IS NEEDED AT ALL: the bridge has its own node_modules, and that
 * directory is not tracked by git — so it is not in the export the quality
 * gate checks. The export's node_modules is a symlink to the real
 * checkout's, so resolving that symlink finds the checkout the bridge's
 * dependencies really live in.
 *
 * WHY IT IS NOT A COPY: the bridge resolves its SPA directory relative to
 * its own file, and the test checks the app's own headers as well. A copy
 * in a temporary directory would answer those questions about a different
 * app.
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

/**
 * The store's own site, without the network.
 *
 * Only the OUTBOUND call is replaced. The route, the middleware and the
 * header logic are the bridge's own, so what the test reads is what the
 * browser would be told.
 */
const STORE_PAGE = '<!doctype html><html><head><title>store</title></head><body>ok</body></html>';
globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  if (target.endsWith('/refused')) {
    return new Response('no', { status: 403, headers: { 'content-type': 'text/html' } });
  }
  if (target.endsWith('/unreachable')) throw new Error('the store is unreachable');
  return new Response(STORE_PAGE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

ensureBridgeDependencies();

/**
 * A shell for the bridge to serve, so the app's own headers can be checked.
 *
 * WHY THE TEST SERVES ITS OWN SHELL: the bridge serves the built app from
 * a directory that is not tracked by git, so it is not in the export the
 * quality gate checks — and a request for a page that is not there comes
 * back as a 404 with a different policy, which would make the app's own
 * framing rules look untested when they were simply not reached.
 */
const work = mkdtempSync(join(tmpdir(), 'hh-store-viewer-'));
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
const frameable = (res) => {
  const xfo = (res.headers.get('x-frame-options') || '').toUpperCase();
  const csp = res.headers.get('content-security-policy') || '';
  return xfo === 'SAMEORIGIN' && /frame-ancestors\s+'self'/.test(csp);
};

console.log('\nthe store viewer is frameable by the app');
const storePage = await realFetch(`${base}/store-viewer/www.jiomart.com/`);
ok(storePage.status === 200, "the store's page is served", `status=${storePage.status}`);
ok(
  (storePage.headers.get('x-frame-options') || '').toUpperCase() === 'SAMEORIGIN',
  "the store's page says SAMEORIGIN",
  `x-frame-options=${storePage.headers.get('x-frame-options')}`,
);
ok(
  /frame-ancestors\s+'self'/.test(storePage.headers.get('content-security-policy') || ''),
  "the store's page allows the app to frame it",
);

console.log('\nthe pages that tell the user what happened are frameable too');
// WHY THIS MATTERS: these two are the page the user is left with when the
// store will not play. A frame the browser refuses shows the browser's own
// error instead — so the user is told nothing, and the one thing that does
// work (the button that opens the store) is never reached.
const refused = await realFetch(`${base}/store-viewer/www.jiomart.com/refused`);
ok(refused.status === 200, "the store's refusal is answered", `status=${refused.status}`);
ok(
  frameable(refused),
  "the refusal page is frameable",
  `x-frame-options=${refused.headers.get('x-frame-options')}`,
);

const unreachable = await realFetch(`${base}/store-viewer/www.jiomart.com/unreachable`);
ok(unreachable.status === 200, 'an unreachable store is answered', `status=${unreachable.status}`);
ok(
  frameable(unreachable),
  'the unreachable page is frameable',
  `x-frame-options=${unreachable.headers.get('x-frame-options')}`,
);

console.log('\nthe app itself still refuses to be framed by anyone');
const app = await realFetch(`${base}/`);
ok(
  app.headers.get('x-frame-options') === 'DENY',
  'the app page is still DENY',
  `x-frame-options=${app.headers.get('x-frame-options')}`,
);
ok(
  /frame-ancestors\s+'none'/.test(app.headers.get('content-security-policy') || ''),
  "the app's policy still says frame-ancestors 'none'",
);

console.log('\nthe proxy is still only for the stores on the list');
const notAllowed = await realFetch(`${base}/store-viewer/evil.example.com/`);
ok(notAllowed.status === 403, 'a host that is not on the list is refused', `status=${notAllowed.status}`);

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
