/**
 * Regression test: the store viewer's log line must not carry the caller's
 * query string, and the operator must be able to see both blank-frame
 * failures.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The store viewer fetches a grocery site's page on the owner's behalf. When
 * it cannot, it says so in the frame — and it writes a line to the bridge
 * log, because an operator looking at a blank frame has no other way to learn
 * that the request never arrived.
 *
 * That line carried the WHOLE address:
 *
 *     [store-viewer] could not reach
 *       https://www.jiomart.com/unreachable?token=<the shared secret>: ...
 *
 * The query string is the caller's, byte for byte, and the bridge already has
 * a rule about it — written into the request log below, in the comment that
 * explains why it logs `req.path` and not `req.originalUrl`:
 *
 *     "a client that puts the shared secret in `?token=` would have it
 *      written verbatim into /tmp/hh_bridge.log — a world-readable file."
 *
 * The store viewer's line put the secret back into that file, one route
 * further up, and the log is mode 0644 — every account on the machine can
 * read it. The secret in question spends the owner's paid API credits.
 *
 * WHAT IS TESTED HERE
 *   1. the bridge still writes a line when a store cannot be reached;
 *   2. that line never carries the caller's query string;
 *   3. it still says WHICH store and WHICH page did not load — a log line
 *      that says nothing is no better than no log line;
 *   4. the OTHER blank-frame failure — the store's edge refusing us — is
 *      logged too, and carries no query string either.
 *
 * WHY THE BRIDGE IS BOOTED: a test of the log line's text would pass while
 * the route kept logging the whole address. The route is the bridge's own,
 * so what it writes is what lands in the log.
 *
 * Run with:  node scripts/test-store-viewer-log.mjs
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
 *
 * WHY THE PATHS ARE MATCHED WITH "includes" AND NOT "endsWith": the test
 * asks for a store with a QUERY STRING on it — that is the whole point — so
 * the path never ends the address.
 */
globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  if (target.includes('/refused')) {
    return new Response('no', { status: 403, headers: { 'content-type': 'text/html' } });
  }
  // The store cannot be reached at all: the request never arrived.
  if (target.includes('/unreachable')) throw new Error('getaddrinfo ENOTFOUND www.jiomart.com');
  return new Response('<!doctype html><html><head><title>store</title></head><body>ok</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

ensureBridgeDependencies();

// ─── the bridge, booted ──────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'hh-store-log-'));
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

/**
 * Run a request with the bridge's own writing captured.
 *
 * WHY BOTH STREAMS ARE CAPTURED: the bridge writes its request log to stdout
 * and its failures to stderr, and the operator reads both — they land in the
 * same file. A secret that reaches either one has leaked.
 */
async function withCapturedLog(fn) {
  const captured = [];
  const realError = console.error;
  const realLog = console.log;
  console.error = (...args) => { captured.push(args.map((a) => String(a)).join(' ')); };
  console.log = (...args) => { captured.push(args.map((a) => String(a)).join(' ')); };
  try {
    await fn();
  } finally {
    console.error = realError;
    console.log = realLog;
  }
  return captured.join('\n');
}

// A value that stands for the shared secret. It is made up, and it is here
// only so the test can look for it.
const SECRET = 'hh-probe-shared-secret-value-4f2a91';

console.log('\nwhat the bridge writes when a store cannot be reached');

const unreachableLog = await withCapturedLog(() =>
  realFetch(`${base}/store-viewer/www.jiomart.com/unreachable?token=${SECRET}&next=1`),
);

ok(
  /store-viewer/.test(unreachableLog),
  'the bridge writes a line about the store it could not reach',
  unreachableLog.split('\n').filter((l) => l.includes('store-viewer'))[0] || '(nothing)',
);
ok(
  !unreachableLog.includes(SECRET),
  "the caller's query string never reaches the log",
  unreachableLog.includes(SECRET) ? 'the log carries the secret' : 'the secret is not in the log',
);
ok(
  /jiomart\.com\/unreachable/.test(unreachableLog),
  'the line still says which store and which page did not load',
);
ok(
  /could not reach/i.test(unreachableLog),
  'the line still says what went wrong',
);

console.log('\nwhat the bridge writes when the store refuses us');

const refusedLog = await withCapturedLog(() =>
  realFetch(`${base}/store-viewer/www.jiomart.com/refused?token=${SECRET}`),
);

ok(
  /store-viewer/.test(refusedLog),
  'the bridge writes a line about the store that refused it',
  refusedLog.split('\n').filter((l) => l.includes('store-viewer'))[0] || '(nothing)',
);
ok(
  !refusedLog.includes(SECRET),
  "the caller's query string never reaches the log",
  refusedLog.includes(SECRET) ? 'the log carries the secret' : 'the secret is not in the log',
);
ok(
  /jiomart\.com\/refused/.test(refusedLog),
  'the line still says which store and which page were refused',
);
ok(
  /403/.test(refusedLog),
  'the line still says what the store answered',
);

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
