/**
 * Regression test: the store's query string must arrive whole.
 *
 * THE DEFECT
 *
 * The store viewer rebuilds the store's own address from the request it
 * received, and it took the query string to be everything between the first
 * "?" and the second one:
 *
 *     const query = req.url.includes('?') ? String(req.url.split('?')[1] || '') : '';
 *
 * A query string is allowed to contain a "?" — it is an ordinary character
 * once the first one has been read as the separator — so a store address with
 * a nested query in it lost everything after the second "?", silently:
 *
 *     requested  /store-viewer/www.jiomart.com/search?k=milk?x=1
 *     sent on    https://www.jiomart.com/search?k=milk
 *
 *     requested  /store-viewer/www.jiomart.com/s?redirect=https://a.example/?next=1
 *     sent on    https://www.jiomart.com/s?redirect=https://a.example/
 *
 * The second one is the shape that matters: a redirect parameter carries a
 * whole address in it, and that address very often carries its own query.
 *
 * WHAT IT LOOKS LIKE TO THE USER
 *
 * Nothing says so. The store opens, the page renders, and the store is simply
 * looking at a different address than the one the owner asked for — a search
 * that drops its last parameter, a product link that loses its way. There is
 * no error, because nothing failed: the bridge sent a valid request for a
 * valid address, just not the address that was asked for.
 *
 * THE FIX
 *
 * Take everything after the FIRST "?" — the separator — rather than the piece
 * between the first and the second:
 *
 *     const qIdx = req.url.indexOf('?');
 *     const query = qIdx === -1 ? '' : req.url.slice(qIdx + 1);
 *
 * WHY THE FIRST "?" AND NOT THE LAST: everything after the first "?" is the
 * query, including any "?" inside it. And an encoded "?" (%3F) is not a
 * separator at all, so it is left alone — the raw request line carries it
 * encoded, and the split is on the literal character.
 *
 * THE PROOF
 *
 * The test boots the REAL bridge on a spare port with the only outbound call
 * replaced, so the address the viewer sends to the store is observed rather
 * than guessed.
 *
 *     against the original code   3 passed, 2 failed
 *          FAIL a query string with a "?" in it arrives whole
 *          FAIL a redirect parameter keeps the address it carries
 *     against the fixed code      5 passed, 0 failed
 *
 * Run with:  node scripts/test-store-viewer-query.mjs
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
 * by git, so it is not in the export the quality gate checks.
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

/** Every address the viewer has asked the store for. */
const asked = [];

/** The store's own site, without the network. */
globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  asked.push(target);
  return new Response(
    '<!doctype html><html><head><title>store</title></head><body>ok</body></html>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
};

ensureBridgeDependencies();

/** A shell for the bridge to serve. */
const work = mkdtempSync(join(tmpdir(), 'hh-store-viewer-query-'));
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

/** Ask the viewer for a path, and return the address it sent to the store. */
async function askStore(path) {
  asked.length = 0;
  await realFetch(`${base}${path}`);
  return asked[0] ?? '';
}

console.log('\nthe query string arrives whole');
{
  const sent = await askStore('/store-viewer/www.jiomart.com/search?k=milk?x=1');
  ok(
    sent === 'https://www.jiomart.com/search?k=milk?x=1',
    'a query string with a "?" in it arrives whole',
    sent,
  );
}

console.log('\na redirect parameter keeps the address it carries');
{
  const sent = await askStore(
    '/store-viewer/www.jiomart.com/s?redirect=https://a.example/?next=1',
  );
  ok(
    sent === 'https://www.jiomart.com/s?redirect=https://a.example/?next=1',
    'the nested query survives',
    sent,
  );
}

console.log('\nthe ordinary cases are untouched');
{
  const plain = await askStore('/store-viewer/www.jiomart.com/search?k=milk');
  ok(plain === 'https://www.jiomart.com/search?k=milk', 'a plain query still works', plain);

  const none = await askStore('/store-viewer/www.jiomart.com/search');
  ok(none === 'https://www.jiomart.com/search', 'no query is still no query', none);

  const encoded = await askStore('/store-viewer/www.jiomart.com/s?k=a%3Fb');
  ok(
    encoded === 'https://www.jiomart.com/s?k=a%3Fb',
    'an encoded "?" is not a separator',
    encoded,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
