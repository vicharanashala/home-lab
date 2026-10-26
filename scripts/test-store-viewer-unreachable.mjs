/**
 * Regression test: an unreachable store and a store that refuses us are two
 * different failures, and the user must be told which one happened.
 *
 * THE BUG THIS EXISTS FOR
 * The store viewer fetches a grocery site's page on the owner's behalf. Two
 * things can go wrong, and they mean different things:
 *
 *   - the store's edge REFUSES us (403/429/5xx) — the site saw the request
 *     and said no;
 *   - the store could not be REACHED at all — a DNS failure, a TLS error, or
 *     the 30-second timeout in the route.
 *
 * Both answered with the same page, and that page says the store's server
 * "only shows its pages to a real browser". For an unreachable store that is
 * a made-up diagnosis: nobody refused anything, the request never arrived.
 * The user is told the wrong reason, and the bridge logged nothing at all,
 * so the operator had no way to tell the two apart either.
 *
 * The route's own comment promised three document answers — the store's page,
 * "the store refused us" and "we could not reach the store" — and the third
 * one did not exist.
 *
 * WHAT IS TESTED HERE
 *   1. the two pages say different things;
 *   2. the unreachable page says the store could not be reached, and does NOT
 *      claim the store refused a real browser;
 *   3. the unreachable page still offers the one thing that does work — the
 *      button that opens the store properly — because that is what the user
 *      is left with;
 *   4. the ROUTE really serves the unreachable page when the fetch throws.
 *
 * Point 4 is the one that matters: a test of the page function alone would
 * pass while the route kept serving the wrong one.
 *
 * Run with:  node scripts/test-store-viewer-unreachable.mjs
 */
import { createServer } from 'node:net';
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
  if (target.endsWith('/refused')) {
    return new Response('no', { status: 403, headers: { 'content-type': 'text/html' } });
  }
  // The store cannot be reached at all: the request never arrived.
  if (target.endsWith('/unreachable')) throw new Error('getaddrinfo ENOTFOUND www.jiomart.com');
  return new Response('<!doctype html><html><head><title>store</title></head><body>ok</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

/** The words a user would actually read on the page. */
function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

ensureBridgeDependencies();

// ─── the two pages ──────────────────────────────────────────────────────
const {
  storeViewerBlockedPage,
  storeViewerUnreachablePage,
} = await import(viewerModule);

console.log('\nthe two failures are told to the user differently');
ok(
  typeof storeViewerUnreachablePage === 'function',
  'there is a page for a store that could not be reached',
);
const refusedHtml = storeViewerBlockedPage('Jio Mart', 'https://www.jiomart.com/');
const unreachableHtml = storeViewerUnreachablePage('Jio Mart', 'https://www.jiomart.com/');
ok(
  refusedHtml !== unreachableHtml,
  'the refused page and the unreachable page are not the same page',
);
ok(
  !/only shows its pages to a real browser/i.test(visibleText(unreachableHtml)),
  'the unreachable page does not claim the store refused a real browser',
);
ok(
  /could not|couldn't|not respond|unreachable|did not answer|no answer/i.test(
    visibleText(unreachableHtml),
  ),
  'the unreachable page says the store could not be reached',
);
ok(
  /href="https:\/\/www\.jiomart\.com/i.test(unreachableHtml),
  'the unreachable page still offers the working "Open the store" link',
);

// ─── the route ──────────────────────────────────────────────────────────
// WHY THE BRIDGE IS BOOTED: a test of the page function alone would pass
// while the route kept serving the other one. The route is the bridge's
// own, so what it answers is what the browser would be told.
const work = mkdtempSync(join(tmpdir(), 'hh-store-unreachable-'));
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

const base = `http://127.0.0.1:${port}`;

console.log('\nthe route tells the user which failure happened');
const refused = await realFetch(`${base}/store-viewer/www.jiomart.com/refused`);
const unreachable = await realFetch(`${base}/store-viewer/www.jiomart.com/unreachable`);
const refusedBody = await refused.text();
const unreachableBody = await unreachable.text();

ok(refused.status === 200, "the store's refusal is answered", `status=${refused.status}`);
ok(unreachable.status === 200, 'an unreachable store is answered', `status=${unreachable.status}`);
ok(refusedBody !== unreachableBody, 'the route answers the two failures differently');
ok(
  !/only shows its pages to a real browser/i.test(visibleText(unreachableBody)),
  "the route does not blame a real-browser check for a store that was never reached",
);
ok(
  /could not|couldn't|not respond|unreachable|did not answer|no answer/i.test(
    visibleText(unreachableBody),
  ),
  'the route says the store could not be reached',
);
ok(
  /href="https:\/\/www\.jiomart\.com/i.test(unreachableBody),
  'the route still offers the working "Open the store" link',
);

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
