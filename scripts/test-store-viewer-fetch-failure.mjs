/**
 * A store that times out a connection must not cost the owner the page.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * The store's own page asks for every route chunk at once — fifty-odd
 * requests, all at the same moment, while the page is already on screen.
 * The store's edge times out some of those connections. Measured against
 * the running app: four of fifty-eight requests came back ETIMEDOUT while
 * the other fifty-four were fine, and the store was up the whole time.
 *
 * What the bridge did with one of those timeouts was the wrong thing:
 *
 *   1. It answered with its "could not be reached" PAGE — an HTML
 *      document, with a 200 — in answer to a request for a JavaScript
 *      chunk. The browser took HTML for a script, could not parse it, and
 *      the store's route was dead with nothing on the screen to show for
 *      it: the banner was there and nothing the owner clicked did
 *      anything.
 *
 *   2. It recorded the request in the request log as a 200. So the log
 *      the operator reads said everything was fine, for a request that
 *      had failed. The only trace was a hand-written line on stderr.
 *
 *   3. It did not ask again. The timeout was one connection in a burst,
 *      not the store being down, and the second attempt gets a fresh
 *      connection and succeeds.
 *
 * WHY A FAKE STORE AND NOT THE REAL ONE
 * The store is stubbed and the thing being checked is what this bridge
 * does with a connection that fails. A test that depended on a grocery
 * site's edge timing out at the right moment would be a test nobody runs.
 *
 * Run with:  node scripts/test-store-viewer-fetch-failure.mjs
 */
import { createServer } from 'node:net';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const ORIGIN = `https://${HOST}`;

const CHUNK = 'console.log("the route chunk");';
const PAGE = '<!doctype html><html><head><title>Store</title></head><body><p>store</p></body></html>';

/** How many times the store was asked for each path. */
const attempts = new Map();

/** The error the store's edge raises when it times a connection out. */
function timedOut() {
  return Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
}

globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  const path = target.slice(ORIGIN.length);
  const count = (attempts.get(path) || 0) + 1;
  attempts.set(path, count);

  // THE EDGE TIMING ONE CONNECTION OUT: the first attempt is lost, and the
  // second one gets a fresh connection and works. This is what the store
  // did to four of fifty-eight chunk requests in the running app.
  if (path === '/chunk-timeout-once.js' && count === 1) throw timedOut();

  // A connection that never comes back.
  if (path === '/chunk-never.js') throw timedOut();

  // The store's edge refusing — a rate limit under the same burst.
  if (path === '/chunk-refused.js') {
    return new Response('slow down', {
      status: 429,
      headers: { 'content-type': 'text/plain' },
    });
  }

  // A page the owner is reading, which the store never answers.
  if (path === '/page-never') throw timedOut();

  if (path.endsWith('.js')) {
    return new Response(CHUNK, {
      status: 200,
      headers: { 'content-type': 'application/javascript' },
    });
  }
  return new Response(PAGE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

/**
 * Run a request with the bridge's own request log captured.
 *
 * WHY ONLY stdout IS CAPTURED: the request log is written with console.log
 * and the failures with console.error. This test is about what the request
 * log SAYS about a request that failed, so stdout is what is needed.
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
  return log.split('\n').filter((l) => /^\[\d{4}-\d{2}-\d{2}T/.test(l));
}

console.log('\nthe bridge starts');
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

console.log('\na chunk whose connection timed out is asked for again');
{
  attempts.clear();
  const res = await realFetch(`${base}${PREFIX}/chunk-timeout-once.js`, {
    headers: { 'sec-fetch-dest': 'script' },
  });
  const body = await res.text();
  ok(
    attempts.get('/chunk-timeout-once.js') === 2,
    'the store is asked a second time, because one connection in a burst is not the store being down',
    `${attempts.get('/chunk-timeout-once.js')} attempt(s)`,
  );
  ok(res.status === 200, 'and the chunk is served', `status ${res.status}`);
  ok(
    body === CHUNK,
    'and it is the chunk itself, not the bridge\'s page',
    body.slice(0, 60).replace(/\s+/g, ' '),
  );
}

console.log('\na chunk that cannot be fetched at all is a failure, not a page');
{
  attempts.clear();
  const res = await realFetch(`${base}${PREFIX}/chunk-never.js`, {
    headers: { 'sec-fetch-dest': 'script' },
  });
  const body = await res.text();
  ok(
    res.status !== 200,
    'the answer is not a success',
    `status ${res.status}`,
  );
  ok(
    !/could not be reached/i.test(body),
    'and it is not the bridge\'s page in place of a script',
    body.slice(0, 60).replace(/\s+/g, ' '),
  );
  ok(
    attempts.get('/chunk-never.js') === 2,
    'and the store was asked again before the bridge gave up',
    `${attempts.get('/chunk-never.js')} attempt(s)`,
  );
  ok(
    res.headers.get('access-control-allow-origin') === '*',
    "and the store's own code is allowed to read the failure",
    res.headers.get('access-control-allow-origin') || 'none',
  );
}

console.log('\na chunk the store refuses is a failure, not a page');
{
  attempts.clear();
  const res = await realFetch(`${base}${PREFIX}/chunk-refused.js`, {
    headers: { 'sec-fetch-dest': 'script' },
  });
  const body = await res.text();
  ok(res.status !== 200, 'the answer is not a success', `status ${res.status}`);
  ok(
    !/will not open inside HomeHub/i.test(body),
    'and it is not the bridge\'s page in place of a script',
    body.slice(0, 60).replace(/\s+/g, ' '),
  );
}

console.log('\na request that failed is logged as a failure');
{
  attempts.clear();
  const log = await withRequestLog(() =>
    realFetch(`${base}${PREFIX}/chunk-never.js`, {
      headers: { 'sec-fetch-dest': 'script' },
    }),
  );
  const lines = requestLines(log);
  const line = lines[lines.length - 1] || '(the log has no request line at all)';
  ok(
    !/\b200\b/.test(line),
    'the request log does not say the request succeeded',
    line,
  );
  ok(
    /\b[45]\d\d\b/.test(line),
    'it says what actually happened',
    line,
  );
}

console.log('\nthe page the owner is reading still shows them the friendly page');
{
  attempts.clear();
  const res = await realFetch(`${base}${PREFIX}/page-never`, {
    headers: { 'sec-fetch-dest': 'iframe' },
  });
  const body = await res.text();
  ok(res.status === 200, 'the frame is answered with a page', `status ${res.status}`);
  ok(
    /could not be reached/i.test(body),
    'and the page is the one that says the store could not be reached',
    body.slice(0, 60).replace(/\s+/g, ' '),
  );
}

console.log('\na request that says nothing about what it is still gets the friendly page');
{
  attempts.clear();
  const res = await realFetch(`${base}${PREFIX}/page-never`);
  const body = await res.text();
  ok(res.status === 200, 'the frame is answered with a page', `status ${res.status}`);
  ok(
    /could not be reached/i.test(body),
    'and the page is the one that says the store could not be reached',
    body.slice(0, 60).replace(/\s+/g, ' '),
  );
}

console.log('\nthe owner\'s order is never asked for twice');
{
  attempts.clear();
  await realFetch(`${base}${PREFIX}/cart`, { method: 'POST', body: '{"qty":2}' })
    .then((r) => r.text())
    .catch(() => '');
  ok(
    attempts.get('/cart') === 1,
    'a POST is asked once, because asking twice would add the item twice',
    `${attempts.get('/cart')} attempt(s)`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
