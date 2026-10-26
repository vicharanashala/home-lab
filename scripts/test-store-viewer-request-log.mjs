/**
 * Regression test: the store viewer's requests must reach the request log.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The bridge writes one line per request — method, path, status, duration —
 * and that log is the operator's only record of what the app did. Every route
 * family appears in it: "/", "/house-bot", "/api/...".
 *
 * The store viewer does not, and it is not a choice. Express runs middleware
 * in the order it was registered, and the store viewer's route was added
 * ABOVE the request-log middleware:
 *
 *     line 575   app.all(`${STORE_VIEWER_PREFIX}/*`, ...)   <- the route
 *     line 779   app.use((req, res, next) => { ...log... }) <- the logger
 *
 * The route answers the request itself and never calls next(), so the logger
 * — which sits BELOW it — is never reached. The whole store-viewer family
 * vanished from the log the day the route was added.
 *
 * WHAT IT COSTS THE OPERATOR
 *
 *   - A store that refuses us, or cannot be reached, leaves a line — but only
 *     because two branches log by hand.
 *   - A store that loads and then MISBEHAVES leaves nothing at all. The
 *     operator cannot tell whether the request was made, what it answered,
 *     or how long it took. The commit that fixed the store's runtime
 *     addresses had to infer the problem from 404s at the APP's origin,
 *     because the viewer's own requests were invisible.
 *   - A request for a host that is not on the allowlist is refused with 403
 *     and leaves NO trace whatsoever.
 *
 * WHY THE BRIDGE IS BOOTED: the question is not "does a log line exist in
 * some function" but "does a request to the running bridge produce one". The
 * order of the registrations is the bug, so the route has to run.
 *
 * WHY THE BRIDGE IS BOOTED WITH A STUBBED OUTBOUND FETCH: the store is not
 * on the internet as far as the test is concerned, and the bridge must not
 * spend the owner's bandwidth on a grocery site to prove a logging rule.
 *
 * Run with:  node scripts/test-store-viewer-request-log.mjs
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
 * the test reads is what the operator would read.
 */
globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  return new Response('<!doctype html><html><head><title>store</title></head><body>ok</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

ensureBridgeDependencies();

// ─── the bridge, booted ──────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'hh-store-reqlog-'));
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
 * Run a request with the bridge's own request log captured.
 *
 * WHY ONLY stdout IS CAPTURED: the request log is written with console.log
 * and the failures with console.error. This test is about the request log,
 * so stderr is left alone — the two branches it checks are covered by
 * scripts/test-store-viewer-log.mjs.
 */
async function withRequestLog(fn) {
  const captured = [];
  const realLog = console.log;
  console.log = (...args) => { captured.push(args.map((a) => String(a)).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = realLog;
  }
  return captured.join('\n');
}

/** The lines in a captured log that are request-log lines. */
function requestLines(log) {
  return log
    .split('\n')
    .filter((l) => /^\[\d{4}-\d{2}-\d{2}T/.test(l));
}

console.log('\nwhat the bridge logs when the owner opens a store');

{
  const log = await withRequestLog(() =>
    realFetch(`${base}/store-viewer/www.jiomart.com/`),
  );
  const lines = requestLines(log);

  ok(
    lines.some((l) => l.includes('/store-viewer/www.jiomart.com/')),
    "the store viewer's request reaches the request log",
    lines[0] || '(the log has no request line at all)',
  );
  ok(
    lines.some((l) => /\bGET\b/.test(l) && /\b200\b/.test(l)),
    'the line says the method and the status',
    lines[0] || '(nothing)',
  );
  ok(
    lines.length === 1,
    'the request is logged exactly once',
    `${lines.length} line(s)`,
  );
}

console.log('\nwhat the bridge logs when a host is not on the allowlist');

{
  const log = await withRequestLog(() =>
    realFetch(`${base}/store-viewer/evil.example.com/x`),
  );
  const lines = requestLines(log);

  ok(
    lines.some((l) => l.includes('/store-viewer/evil.example.com/x')),
    'the refusal is in the request log too',
    lines[0] || '(the log has no request line at all)',
  );
  ok(
    lines.some((l) => /\b403\b/.test(l)),
    'the line says the request was refused',
    lines[0] || '(nothing)',
  );
}

console.log("\nwhat the bridge logs when the caller's query carries a secret");

{
  const SECRET = 'hh-probe-secret-9c31d7';
  const log = await withRequestLog(() =>
    realFetch(`${base}/store-viewer/www.jiomart.com/search?token=${SECRET}`),
  );

  ok(
    !log.includes(SECRET),
    "the caller's query string never reaches the log",
    log.includes(SECRET) ? 'the log carries the secret' : 'the secret is not in the log',
  );
}

console.log('\nthe other routes are still logged exactly once');

{
  const log = await withRequestLog(() => realFetch(`${base}/`));
  const lines = requestLines(log);

  ok(
    lines.length === 1,
    "the app's own page is logged once, as before",
    `${lines.length} line(s): ${lines[0] || '(nothing)'}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
