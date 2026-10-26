/**
 * Regression test: every link in a proxied store page must still point at
 * the store, and the store's own POST calls must reach the store.
 *
 * THE BUG THIS EXISTS FOR
 * The store viewer rewrites the store's page so that its links stay inside
 * the viewer. Two things went wrong in that rewrite.
 *
 * 1. THE PREFIX WAS APPLIED TWICE.
 *    The rewriter first turned "https://www.jiomart.com/deals" into
 *    "/store-viewer/www.jiomart.com/deals" — a root-relative path. It then
 *    ran the root-relative rule over the result, and that rule matched the
 *    path it had just written, so the prefix landed on it a second time:
 *    "/store-viewer/www.jiomart.com/store-viewer/www.jiomart.com/deals".
 *    The proxy then asked the store for a page called
 *    "/store-viewer/www.jiomart.com/deals" — which does not exist. On the
 *    live Amazon Fresh page this hit the sign-in link, the storefront link
 *    and a footer link.
 *
 * 2. THE STORE'S OWN POST CALLS WERE NOT ROUTED.
 *    The route was registered for GET only, so the store's add-to-cart and
 *    other POST calls came back as "Cannot POST /store-viewer/..." — a 404
 *    from Express. The page looked fine and the cart silently did nothing.
 *
 * WHY IT NEEDS A TEST AND NOT A LOOK
 * Every other check looks at the commit. The rewrite is a function of the
 * page the store happens to send, so the only way to know the links still
 * point at the store is to read the served page and resolve every URL in
 * it the way a browser would.
 *
 * WHAT IS TESTED HERE
 * The rule the rewrite has to keep: a link in the served page must resolve
 * to the SAME path on the store that the store's own page would have
 * resolved it to. The base tag has no doubled slash. A POST to the viewer
 * reaches the store with its method and its body.
 *
 * Run with:  node scripts/test-store-viewer-links.mjs
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
 * WHY: the bridge has its own node_modules, and that directory is not
 * tracked by git — so it is not in the export the quality gate checks. The
 * export's node_modules is a symlink to the real checkout's, so resolving
 * that symlink finds the checkout the bridge's dependencies really live in.
 *
 * WHY IT IS NOT A COPY: the bridge resolves its SPA directory relative to
 * its own file. A copy in a temporary directory would answer these
 * questions about a different app.
 */
function ensureBridgeDependencies() {
  const modules = join(bridgeDir, 'node_modules');
  if (existsSync(join(modules, 'express'))) return;

  const checkout = dirname(dirname(realpathSync(join(here, '..', 'node_modules'))));
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
 * The page carries one of each kind of address a grocery site writes: an
 * absolute address on the store's own origin, a root-relative one, a
 * relative one, an image and a form.
 */
const HOST = 'www.jiomart.com';
const PREFIX = `/store-viewer/${HOST}`;
const STORE_PATH = '/shop';
const STORE_PAGE = [
  '<!doctype html><html><head>',
  `<link rel="canonical" href="https://${HOST}/shop">`,
  '</head><body>',
  `<a href="https://${HOST}/deals">Deals</a>`,
  `<a href="/shop/aisle">Aisle</a>`,
  '<a href="offers">Offers</a>',
  `<img src="https://${HOST}/logo.png">`,
  '<form action="/shop/checkout"><input name="q"></form>',
  '</body></html>',
].join('\n');

/** What the viewer asked the store for. */
const upstreamCalls = [];

globalThis.fetch = async (url, opts) => {
  const target = typeof url === 'string' ? url : String(url?.url ?? '');
  if (!target.startsWith('https://')) return realFetch(url, opts);
  upstreamCalls.push({
    url: target,
    method: (opts?.method || 'GET').toUpperCase(),
    body: opts?.body,
  });
  return new Response(STORE_PAGE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

ensureBridgeDependencies();

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

console.log('\nthe links in the served page still point at the store');
const served = await realFetch(`${base}${PREFIX}${STORE_PATH}`);
const html = await served.text();

ok(served.status === 200, "the store's page is served", `status=${served.status}`);

const baseHref = html.match(/<base href="([^"]*)"/)?.[1];
ok(Boolean(baseHref), 'the base tag is present');
ok(
  !/\/\//.test(baseHref || ''),
  'the base tag has no doubled slash',
  `-> ${baseHref}`,
);

/**
 * Where a URL in the served page points on the store.
 *
 * The viewer shows "/store-viewer/<host>/<path>", so the path the store
 * gets is what is left after the prefix. A URL that carries the prefix
 * twice comes back with the prefix still in it — which is the bug.
 */
function upstreamPath(url) {
  if (!url?.startsWith(PREFIX)) return url;
  return url.slice(PREFIX.length);
}

/**
 * Where the store's own page would have sent that link.
 *
 * This is the rule the rewrite has to keep: a link the user clicks inside
 * the viewer must land on the same page it would have landed on at the
 * store. A relative link is resolved by the browser against the base tag,
 * and the base tag has to reproduce the store's own resolution.
 */
function storePath(url) {
  return new URL(url, `https://${HOST}${STORE_PATH}`).pathname;
}

const links = {
  'the canonical link': html.match(/<link rel="canonical" href="([^"]+)"/)?.[1],
  'the absolute link': html.match(/<a href="([^"]+)">Deals<\/a>/)?.[1],
  'the root-relative link': html.match(/<a href="([^"]+)">Aisle<\/a>/)?.[1],
  'the relative link': html.match(/<a href="([^"]+)">Offers<\/a>/)?.[1],
  'the image': html.match(/<img src="([^"]+)">/)?.[1],
  'the form action': html.match(/<form action="([^"]+)"/)?.[1],
};

// What each link is on the store, before the rewrite touched it.
const onTheStore = {
  'the canonical link': '/shop',
  'the absolute link': '/deals',
  'the root-relative link': '/shop/aisle',
  'the relative link': '/offers',
  'the image': '/logo.png',
  'the form action': '/shop/checkout',
};

for (const [label, url] of Object.entries(links)) {
  ok(Boolean(url), `${label} is present`);
  if (!url) continue;
  ok(
    !url.startsWith(PREFIX + PREFIX),
    `${label} is not prefixed twice`,
    `-> ${url}`,
  );

  // A relative link is left alone for the base tag to resolve, so it is
  // compared the way a browser would resolve it, not as it stands.
  const resolved = url.startsWith('/')
    ? upstreamPath(url)
    : upstreamPath(new URL(url, `http://x${baseHref}`).pathname);

  ok(
    resolved === onTheStore[label],
    `${label} lands on the page the store's own link lands on`,
    `-> ${resolved} (store: ${onTheStore[label]})`,
  );
}

console.log("\nthe store's own POST calls reach the store");
const posted = await realFetch(`${base}${PREFIX}/shop/cart`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ qty: 2 }),
});
ok(posted.status === 200, 'a POST to the viewer is answered', `status=${posted.status}`);

const cartCall = upstreamCalls.find((c) => c.url.includes('/shop/cart'));
ok(Boolean(cartCall), 'the store was asked for the cart');
if (cartCall) {
  ok(cartCall.method === 'POST', 'the store was asked with POST', `-> ${cartCall.method}`);
  // The body has to travel as the bytes the browser sent. A parser that
  // turned it into an object would have the store receive "[object Object]"
  // instead of the order.
  const sentBody = Buffer.isBuffer(cartCall.body)
    ? cartCall.body.toString('utf8')
    : String(cartCall.body ?? '');
  ok(
    sentBody.includes('"qty":2'),
    'the store was given the body the browser sent',
    `-> ${sentBody.slice(0, 60)}`,
  );
  ok(
    sentBody !== '[object Object]',
    "the store was not given the text '[object Object]'",
    `-> ${sentBody.slice(0, 60)}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
