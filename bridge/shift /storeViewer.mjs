/**
 * The in-app store viewer: the parts of it that can be tested.
 *
 * WHY IT EXISTS: the grocery sites all refuse to be framed. Amazon and
 * BigBasket both send "X-Frame-Options: SAMEORIGIN" and Jio Mart's edge
 * protection leaves a frame empty, so an iframe aimed straight at them
 * shows a blank rectangle.
 *
 * So the page is fetched by the bridge and served from the app's own
 * origin, where the app is allowed to frame it. What the user sees is the
 * real store, inside HomeHub.
 *
 * These are the pieces with the sharp edges — the address rewriting and the
 * script that keeps the store's own requests inside the viewer — so they
 * live here where they can be tested without a network.
 */

/**
 * Where the viewer is mounted.
 *
 * NOT under /api. Everything under /api is behind the shared secret, and an
 * iframe cannot put a header on its navigation. It also matters that the
 * store's own pages call "/api/..." on their own origin, and the app's /api
 * is a different thing entirely — the two must not meet.
 */
export const STORE_VIEWER_PREFIX = '/store-viewer';

/**
 * Only these hosts are served.
 *
 * A proxy that will fetch any address is an open proxy, and this one is
 * reachable by anything on the tailnet. The list is the allowlist, and a
 * host that is not on it is refused.
 */
export const STORE_VIEWER_HOSTS = new Set([
  'www.jiomart.com',
  'www.amazon.in',
  'www.bigbasket.com',
]);

/**
 * The headers a browser sends, which is what the grocery sites' edges look
 * for. Without them the same fetch that works in Chrome is refused with a
 * 403 by the edge in front of it.
 */
export const STORE_VIEWER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-IN,en;q=0.9',
  'upgrade-insecure-requests': '1',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
};

/**
 * The policy the proxied page is served under.
 *
 * It has to be permissive — the store's own scripts, styles, fonts and
 * images come from its domain and from a dozen CDNs — and it has to let the
 * app frame it, which the app's own policy does not.
 *
 * The app's page has "frame-ancestors 'none'", so without "frame-ancestors
 * 'self'" here the frame would be refused by the browser for the same
 * reason the store refused it.
 *
 * WHY THE SANDBOX DIRECTIVE, WHICH IS THE ONE THAT MATTERS
 *
 * The store's page is served from the APP'S OWN ORIGIN — that is the whole
 * trick of the viewer, because the store refuses to be framed and the app's
 * origin will frame anything. But "served from the app's origin" also means
 * the store's JavaScript runs WITH the app's origin, and the app's origin
 * holds the owner's grocery list (window.localStorage) and the shared secret
 * that spends the owner's paid API credits (the bundle it is fetched from
 * carries it).
 *
 * So without the sandbox directive, opening a grocery store inside HomeHub
 * handed the owner's list and their secret to every script the store serves —
 * its own and its advertisers'. Measured in Chrome against the running app:
 * a script inside the store's frame read the app's localStorage back out,
 * and the frame's origin was the app's origin.
 *
 * This is the same trap the bridge already closes for uploads, and it closes
 * it the same way: the uploads route serves images under "default-src
 * 'none'; sandbox" for exactly this reason ("active content on the app's own
 * origin ... would inherit the app's localStorage and its authenticated API
 * access"). The store viewer was the one place that served a THIRD PARTY's
 * active content at the app's origin without it.
 *
 * THE FLAGS, AND WHY EACH ONE IS HERE
 *
 *   allow-scripts                    the store's pages are JavaScript-driven;
 *                                    without it the frame is a dead page.
 *   allow-forms                      the store's search and sign-in forms
 *                                    POST through the viewer, and a sandboxed
 *                                    form cannot submit without this.
 *   allow-popups                     the store opens its own tabs.
 *   allow-popups-to-escape-sandbox   ...and that tab must not be sandboxed
 *                                    too, or a payment or sign-in flow that
 *                                    opens a window breaks. This is the
 *                                    "Open the store" button's own path.
 *   allow-downloads                  an invoice or a receipt.
 *
 * WHY THERE IS NO allow-same-origin: that one flag puts the app's origin
 * back and undoes the whole thing. Measured side by side in Chrome: with it,
 * the store's document read the app's localStorage exactly as before.
 *
 * WHY THE APP CAN STILL FRAME IT: the sandbox is applied to the document,
 * and "frame-ancestors 'self'" is matched against the URL's origin, so the
 * frame is still allowed — measured in Chrome, the framed page still runs.
 * The store's own requests keep working too: the viewer answers with
 * "access-control-allow-origin: *", which is what lets the store's scripts
 * and module scripts load, and its XHRs still return.
 */
export const STORE_VIEWER_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads",
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "frame-ancestors 'self'",
  "img-src * data: blob:",
  "style-src * 'unsafe-inline'",
  "script-src * 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "connect-src *",
  "font-src * data:",
  "media-src * blob:",
  "form-action *",
  "base-uri 'self'",
].join('; ');

/**
 * Escape a value for use in the failure pages' markup.
 *
 * WHY IT IS NEEDED: the store's URL is not a fixed string. The route builds
 * it from the request path and query —
 *
 *     const { host, path, url: target } = storeViewerTarget(rest, query);
 *
 * — so it carries whatever the caller typed, byte for byte. Interpolated
 * raw into `href="${url}"`, a quote in the query ended the attribute and the
 * rest of the query was parsed as markup: a <script> that runs on the app's
 * OWN origin, where the shared secret (it ships in the publicly served
 * bundle) and the owner's grocery list live. The store-viewer route sits
 * outside the token gate — only /api and /uploads are behind it — so a
 * crafted link is enough.
 *
 * WHY ESCAPING AND NOT VALIDATING: the URL is a real address the user may
 * want to open, quotes and angle brackets included. Escaping keeps it one:
 * the browser shows the caller's characters as text, and the link still
 * points where it did.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The page shown when the store's edge refuses to serve us.
 *
 * BigBasket's edge refuses every request that does not come from a real
 * browser (its TLS fingerprint says Node, so it says no). Rather than
 * showing an empty frame, the app is told plainly and given the one thing
 * that does work.
 */
export function storeViewerBlockedPage(storeName, url) {
  const name = escapeHtml(storeName);
  const link = escapeHtml(url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:#faf9f5;color:#2f3d33}
  .box{max-width:420px;margin:24px;padding:28px;border-radius:20px;background:#fff;
    border:1px solid #e6e4dc;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.06)}
  h1{font-size:19px;margin:0 0 10px}
  p{margin:0 0 20px;color:#5c6b60;font-size:14px}
  a{display:inline-block;background:#3f6b4d;color:#fff;text-decoration:none;
    padding:12px 22px;border-radius:12px;font-weight:600;font-size:14px}
</style></head>
<body><div class="box">
  <h1>${name} will not open inside HomeHub</h1>
  <p>${name}'s server only shows its pages to a real browser, so this one
  is opened in a new tab instead.</p>
  <a href="${link}" target="_blank" rel="noreferrer noopener">Open ${name}</a>
</div></body></html>`;
}

/**
 * The page shown when the store could not be reached at all.
 *
 * WHY THIS IS NOT THE SAME PAGE AS THE REFUSAL: the two failures mean
 * different things. A refusal means the store saw the request and said no.
 * Being unreachable means the request never arrived — a DNS failure, a TLS
 * error, or the route's 30-second timeout.
 *
 * WHY IT MATTERED: both answers used to be the refusal page, which told the
 * user that the store's server "only shows its pages to a real browser". For
 * a store that was simply down, that is a made-up diagnosis — nobody refused
 * anything. The user was told the wrong reason, and the bridge logged
 * nothing, so the operator could not tell the two apart either.
 */
export function storeViewerUnreachablePage(storeName, url) {
  const name = escapeHtml(storeName);
  const link = escapeHtml(url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:#faf9f5;color:#2f3d33}
  .box{max-width:420px;margin:24px;padding:28px;border-radius:20px;background:#fff;
    border:1px solid #e6e4dc;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.06)}
  h1{font-size:19px;margin:0 0 10px}
  p{margin:0 0 20px;color:#5c6b60;font-size:14px}
  a{display:inline-block;background:#3f6b4d;color:#fff;text-decoration:none;
    padding:12px 22px;border-radius:12px;font-weight:600;font-size:14px}
</style></head>
<body><div class="box">
  <h1>${name} could not be reached</h1>
  <p>HomeHub could not get a page from ${name} just now — the request
  never arrived. That is usually the store being down or the connection
  dropping. Try again in a moment, or open the store in a new tab.</p>
  <a href="${link}" target="_blank" rel="noreferrer noopener">Open ${name}</a>
</div></body></html>`;
}

/**
 * The script that keeps the store's OWN requests inside the viewer.
 *
 * Rewriting the HTML is not enough. The store builds some of its addresses
 * at runtime — the bundle asks for "/api/service/..." — and an address like
 * that starts at the root, so it ignores the <base> tag and would go to
 * the APP's /api instead of the store's. The page then renders the store's
 * own "we couldn't find the page".
 *
 * So fetch, XMLHttpRequest, link clicks and the router's history changes
 * are all pointed at the viewer instead. This is the whole of what makes
 * an in-app browser work.
 *
 * AND THE ADDRESSES THAT GO INTO AN ELEMENT, WHICH WERE MISSING: a store's
 * own page is built at runtime, and the addresses in it never pass through
 * the rewriter, because the rewriter runs once, on the markup. A bundler's
 * chunk loader is the clearest case, and the bridge's own request log shows
 * what it costs: fifty route chunks asked for at the APP's origin, every
 * one of them 404. The store's banner was on screen and nothing the owner
 * clicked did anything. See scripts/test-store-viewer-runtime-urls.mjs.
 */
export function storeViewerScript(prefix, host) {
  const origin = `https://${host}`;
  return `(function(){
  var PREFIX = ${JSON.stringify(prefix)};
  var ORIGIN = ${JSON.stringify(origin)};
  var HOST = ${JSON.stringify(host)};
  // WHERE THIS PAGE IS SERVED FROM. The store builds some of its addresses
  // out of window.location.origin — which, inside the viewer, is the APP's
  // origin, not the store's. Those addresses have to be caught too, and
  // comparing them against location.origin here catches every one of them
  // without the server having to know what the app is called.
  var HERE = window.location.origin;
  function fix(u) {
    if (typeof u !== 'string') return u;
    // ALREADY INSIDE THE VIEWER: leave it alone.
    //
    // WHY THIS IS HERE: the viewer's own path starts with a slash, so the
    // root-relative rule at the bottom would put the prefix on it a second
    // time. The same goes for the viewer's path written out in full, which
    // is what an element's "src" reads back as once the browser has
    // resolved it, and the store's own code does read elements back and
    // put the address somewhere else.
    if (u.indexOf(PREFIX) === 0) return u;
    if (u.indexOf(HERE) === 0 && u.slice(HERE.length).indexOf(PREFIX) === 0) return u;
    if (u.indexOf(ORIGIN) === 0) return PREFIX + u.slice(ORIGIN.length);
    if (u.indexOf(HERE) === 0) return PREFIX + u.slice(HERE.length);
    if (u.indexOf('//' + HOST) === 0) return PREFIX + u.slice(2 + HOST.length);
    if (u.charAt(0) === '/' && u.charAt(1) !== '/') return PREFIX + u;
    return u;
  }
  // THE ADDRESSES THAT GO INTO AN ELEMENT.
  //
  // WHY THIS EXISTS: the stores build their own pages at runtime, and the
  // addresses they build never pass through the rewriter, because the
  // rewriter runs once, on the markup, and these addresses are built
  // later, by the store's own JavaScript. A bundler's chunk loader is the
  // clearest case:
  //
  //     script.setAttribute('src', '/public/proddist/pages-CartPage.abc.js');
  //
  // That address starts at the root, so the browser ignores the <base> tag
  // and asks the APP's origin for it, where there is nothing. Seen in the
  // bridge's own request log, from the running app, with BigBasket open:
  //
  //     GET /public/proddist/pages-CartPage.abc.js   404
  //
  // The store's main bundle loaded, because it is in the markup and the
  // rewriter caught it, and the app booted, and then asked for every route
  // it has. Every one of them 404'd at the APP's origin, with the
  // viewer's prefix missing. The frame showed a store that could not be
  // used in it: the banner was there, and nothing the owner clicked did
  // anything.
  //
  // WHY BOTH ROUTES: a browser's url property is a view onto the
  // attribute, and a page can use either one. A bundler that asks for its
  // own chunks with setAttribute would not be caught by a patch on the
  // property alone, and vice versa.
  //
  // WHY EACH ONE IS GUARDED: this code runs inside the store's own page,
  // and a page is free to break a prototype, or to be running on a browser
  // that has no such element. None of that may take the routing below
  // down with it, because a store whose search and cart are dead is worse
  // than a store whose route chunks are.
  function patchUrlProperty(proto, prop) {
    try {
      if (!proto || !proto.prototype) return;
      var d = Object.getOwnPropertyDescriptor(proto.prototype, prop);
      if (!d || !d.set) return;
      Object.defineProperty(proto.prototype, prop, {
        get: d.get,
        set: function (v) { d.set.call(this, fix(v)); },
        configurable: d.configurable !== false,
        enumerable: d.enumerable
      });
    } catch (e) {}
  }
  function patchSetAttribute() {
    try {
      var oset = Element.prototype.setAttribute;
      if (!oset) return;
      Element.prototype.setAttribute = function (name, value) {
        if (name === 'src' || name === 'href' || name === 'data' || name === 'action') {
          value = fix(value);
        }
        return oset.call(this, name, value);
      };
    } catch (e) {}
  }
  patchUrlProperty(window.HTMLScriptElement, 'src');
  patchUrlProperty(window.HTMLLinkElement, 'href');
  patchUrlProperty(window.HTMLImageElement, 'src');
  patchUrlProperty(window.HTMLSourceElement, 'src');
  patchUrlProperty(window.HTMLMediaElement, 'src');
  patchUrlProperty(window.HTMLTrackElement, 'src');
  patchUrlProperty(window.HTMLEmbedElement, 'src');
  patchUrlProperty(window.HTMLObjectElement, 'data');
  patchUrlProperty(window.HTMLFormElement, 'action');
  patchSetAttribute();
  var of = window.fetch;
  if (of) {
    window.fetch = function (u, o) {
      if (u && typeof u === 'object' && u.url) {
        try { u = new Request(fix(u.url), u); } catch (e) {}
      }
      return of.call(this, fix(u), o);
    };
  }
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    var a = Array.prototype.slice.call(arguments);
    a[1] = fix(u);
    return oo.apply(this, a);
  };
  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    var fixed = fix(href);
    if (fixed !== href) { e.preventDefault(); location.href = fixed; }
  }, true);
  var ops = history.pushState, ors = history.replaceState;
  history.pushState = function (s, t, u) { return ops.call(this, s, t, fix(u)); };
  history.replaceState = function (s, t, u) { return ors.call(this, s, t, fix(u)); };
})();`;
}

/**
 * Rewrite a store's page so that every link stays inside the viewer.
 *
 * The address of the page the browser is showing is
 *   /store-viewer/<host>/<path>
 * so a link written as "/foo" has to become
 *   /store-viewer/<host>/foo
 * or the browser would ask this server for "/foo" and get nothing.
 *
 * The <base> tag does the same job for the links written as "foo" — the
 * ones relative to the page — and is what keeps them pointing at the store
 * instead of at this server.
 */
export function rewriteStorePage(html, host, dir, prefix) {
  const origin = `https://${host}`;

  // Root-relative addresses: "/foo" -> "<prefix>/foo".
  //
  // WHY THIS RUNS BEFORE THE ABSOLUTE ADDRESSES BELOW, AND NOT AFTER: the
  // absolute rule turns "https://<host>/foo" into "<prefix>/foo", and that
  // is itself a root-relative address. So if the absolute rule ran first,
  // this one would find the address the absolute rule had just written and
  // prefix it a second time:
  //
  //   https://<host>/deals  ->  /store-viewer/<host>/deals
  //                         ->  /store-viewer/<host>/store-viewer/<host>/deals
  //
  // and the proxy would then ask the store for a page called
  // "/store-viewer/<host>/deals", which is not a page the store has. The
  // link the user clicked would land on the store's own "sorry, we couldn't
  // find that page", with nothing to say the link was broken.
  let out = html.replace(
    /((?:href|src|action|data-src|data-href|poster)\s*=\s*["'])\/(?!\/)/gi,
    (m, lead) => `${lead}${prefix}/`,
  );

  // Root-relative addresses inside stylesheets: url(/foo).
  //
  // This one has the same ordering reason as the rule above it: a
  // stylesheet can name the store's own origin too, and the absolute rule
  // below turns that into a root-relative address as well.
  out = out.replace(/url\(\s*(["']?)\/(?!\/)/gi, (m, q) => `url(${q}${prefix}/`);

  // Absolute and protocol-relative addresses for this same store.
  out = out.split(origin).join(prefix);
  out = out.split(`//${host}`).join(prefix);

  // The script and the base, before the store's own code runs.
  //
  // WHY THE BASE HREF IS ESCAPED: `dir` is the caller's own path, taken from
  // the request byte for byte, and it goes into an HTML attribute. A double
  // quote in it ended the attribute, and the rest of the path was parsed as
  // markup:
  //
  //   <base href="/store-viewer/www.jiomart.com/a/"><script>alert(1)</script>/">
  //
  // The store viewer's own policy allows inline scripts ("script-src *
  // 'unsafe-inline'"), so that script runs — on the app's OWN origin, the one
  // the permanent link serves, where the shared secret and the owner's
  // grocery list live. The two failure pages were escaped for exactly this
  // reason; this is the same hole in the path that leads to the store's real
  // page, and it was the one the user actually looks at.
  //
  // WHY ESCAPING AND NOT VALIDATING: the path is a real address the caller
  // may want to open, quotes and angle brackets included. Escaping keeps it
  // one — the browser decodes the entities back to the caller's characters,
  // so the base still points where it did.
  const head =
    `<base href="${escapeHtml(prefix + (dir.endsWith('/') ? dir : dir + '/'))}">` +
    `<script>${storeViewerScript(prefix, host)}<\/script>`;
  out = out.replace(/<head([^>]*)>/i, (m, attrs) => `<head${attrs}>${head}`);

  return out;
}

/** The address the browser is showing, for a store's page. */
export function storeViewerPrefix(host) {
  return `${STORE_VIEWER_PREFIX}/${host}`;
}

/**
 * The store's own request, taken from the viewer's address.
 *
 * "/store-viewer/www.amazon.in/fresh?x=1" -> "https://www.amazon.in/fresh?x=1"
 */
export function storeViewerTarget(rest, query) {
  const slash = rest.indexOf('/');
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  const path = slash === -1 ? '/' : rest.slice(slash);
  return { host, path, url: `https://${host}${path}${query ? '?' + query : ''}` };
}
