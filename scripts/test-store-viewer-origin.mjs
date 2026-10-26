/**
 * Regression test: the store's page must not run with the app's origin.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The store viewer fetches a grocery site's page and serves it from the
 * app's own origin — that is the whole trick, because the store refuses to
 * be framed and the app's origin will frame anything.
 *
 * But "served from the app's own origin" also means the store's JavaScript
 * runs WITH the app's origin. And the app's origin holds:
 *
 *   - the owner's grocery list, stock, meal log and settings, in
 *     window.localStorage;
 *   - the shared secret that spends the owner's paid API credits, in the
 *     bundle the page is fetched from.
 *
 * So opening a grocery store inside HomeHub handed the owner's list and
 * their secret to every script the store serves — its own, and its
 * advertisers'. The store's document was not "a page in a frame"; it was a
 * page on the app's own origin, with the app's own powers.
 *
 * MEASURED IN CHROME AGAINST THE RUNNING APP, BEFORE THE FIX
 *
 *   frame's origin ................ http://127.0.0.1:8789  (the app's)
 *   script inside the frame read
 *     the app's localStorage ..... "written-by-the-app-page"
 *   the app's own localStorage keys, listed from inside the frame:
 *     csa.cajun..., csa-ctoken-..., csm-bf, csm-hit, _PATC_CONFIG, ...
 *     (the first four are the STORE's own keys — amazon's scripts had
 *      already written them into the app's storage)
 *   the bundle's secret, readable from that origin .. yes
 *
 * AFTER THE FIX, THE SAME PROBE
 *
 *   script inside the frame read
 *     the app's localStorage ..... SecurityError
 *   the frame still renders ..... yes
 *   the store's own scripts ..... still load, and its XHRs still return
 *
 * WHY A HEADER TEST AND NOT A BROWSER TEST
 *
 * The mechanism is the "sandbox" directive in the viewer's policy, and a
 * browser is the only thing that can prove the effect — the tests in this
 * repo are node-only, and a browser would not be installed everywhere.
 * So this test pins the mechanism, and pins the two ways it could be
 * undone:
 *
 *   - the directive has to be THERE;
 *   - it must not carry "allow-same-origin", which restores the app's
 *     origin and undoes it (measured side by side in Chrome);
 *   - it has to carry "allow-scripts", or the store's page is a dead
 *     page and the fix is worse than the bug;
 *   - the answers still have to carry "access-control-allow-origin: *",
 *     because a sandboxed document is a cross-origin document and the
 *     store's scripts and module scripts need to be allowed to load.
 *
 * Run with:  node scripts/test-store-viewer-origin.mjs
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
 * rules look untested when they were simply not reached.
 */
const work = mkdtempSync(join(tmpdir(), 'hh-store-viewer-origin-'));
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

/** The sandbox directive's own flags, out of the policy. */
function sandboxFlags(csp) {
  const m = (csp || '').match(/(?:^|;)\s*sandbox\s+([^;]*)/i);
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : null;
}

console.log('\nthe store viewer is served in a sandbox of its own');
const storePage = await realFetch(`${base}/store-viewer/www.jiomart.com/`);
ok(storePage.status === 200, "the store's page is served", `status=${storePage.status}`);

const csp = storePage.headers.get('content-security-policy') || '';
const flags = sandboxFlags(csp);
ok(flags !== null, "the store's page is sandboxed", csp ? 'sandbox directive found' : 'no sandbox directive');
ok(
  flags !== null && !flags.includes('allow-same-origin'),
  "the sandbox does not give the store the app's origin back",
  flags ? flags.join(' ') : 'no sandbox directive',
);
ok(
  flags !== null && flags.includes('allow-scripts'),
  "the sandbox still lets the store's own scripts run",
  flags ? flags.join(' ') : 'no sandbox directive',
);
ok(
  flags !== null && flags.includes('allow-forms'),
  'the sandbox still lets the store\'s forms submit',
  flags ? flags.join(' ') : 'no sandbox directive',
);
ok(
  flags !== null && flags.includes('allow-popups'),
  'the sandbox still lets the store open its own tabs',
  flags ? flags.join(' ') : 'no sandbox directive',
);

console.log("\nthe store's own requests are still allowed through");
// WHY THIS MATTERS: a sandboxed document is a cross-origin document, so the
// store's scripts and module scripts need the permission to load and its
// XHRs need to be readable. Without this the store's page loads but is dead.
ok(
  (storePage.headers.get('access-control-allow-origin') || '') === '*',
  "the store's page is readable by its own scripts",
  `access-control-allow-origin=${storePage.headers.get('access-control-allow-origin')}`,
);

const asset = await realFetch(`${base}/store-viewer/www.jiomart.com/app.js`);
ok(
  (asset.headers.get('access-control-allow-origin') || '') === '*',
  "the store's scripts are readable by the page that asked for them",
  `access-control-allow-origin=${asset.headers.get('access-control-allow-origin')}`,
);

console.log('\nthe app itself is not sandboxed');
// WHY THIS MATTERS: the sandbox is the viewer's, not the app's. The app is
// the owner's own page — sandboxing it would break the whole application.
const app = await realFetch(`${base}/`);
const appCsp = app.headers.get('content-security-policy') || '';
ok(
  sandboxFlags(appCsp) === null,
  "the app's page keeps its own origin",
  appCsp ? 'no sandbox directive' : 'no policy',
);

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
