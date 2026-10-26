/**
 * Regression test: the URLs a store builds AT RUNTIME must reach the store.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The store viewer rewrites the store's page so that everything on it points
 * back at the store. The rewriter handles the markup — <a href>, <img src>,
 * <script src>, <form action> and the url() inside a stylesheet — and the
 * page is given a <base> tag for the addresses written relative to the page.
 *
 * But every one of these stores builds its own page at runtime, and the
 * addresses it builds are NOT in the markup the rewriter saw:
 *
 *     var s = document.createElement('script');
 *     s.src = '/public/proddist/pages-CartPage.6379919340c7d2439552.js';
 *
 * That address starts at the root, so the browser ignores the <base> tag and
 * sends it to the APP's origin — where there is nothing. Seen in the
 * bridge's own request log, from the running app, with BigBasket open:
 *
 *     GET /public/proddist/pages-CartPage.6379919340c7d2439552.js  404
 *     GET /public/proddist/pages-CheckoutPage.14101b5488c7f525aa54.js  404
 *     ... (fifty of them, every route the store has)
 *
 * The store's main bundle loaded — it is in the markup, so the rewriter
 * caught it — and the app booted, and then asked for every route it has.
 * All of them 404'd, at the APP's origin, with the viewer's prefix missing.
 *
 * NOTHING LOOKED BROKEN: the store's banner was there, the layout was
 * right, and the store's own navigation did nothing at all — the cart, the
 * checkout and the product pages were the chunks that never arrived. The
 * frame was showing a store that could not be used in it.
 *
 * WHY THE INJECTED SCRIPT IS THE PLACE TO FIX IT: the addresses the store
 * builds never pass through the rewriter, because the rewriter runs once,
 * on the markup, and these addresses are built later, by the store's own
 * JavaScript. The only thing that sees them is the script the viewer
 * injects, and it already points the store's own requests at the viewer —
 * fetch, XMLHttpRequest, link clicks and the history. This test is about
 * the one kind it was missing: the addresses that go into an element.
 *
 * WHY A FAKE DOM AND NOT A BROWSER: the tests in this repo are node-only.
 * The script the viewer injects is ordinary JavaScript, so it can be run
 * against a DOM that is only as big as the script touches — which is
 * exactly what the browser would do with it.
 *
 * WHAT IS TESTED HERE
 *   - a root-relative address put into a script, a link, an image or a
 *     source is routed into the viewer;
 *   - the same address put in with setAttribute is routed too, because that
 *     is how a bundler's chunk loader asks for its own chunks;
 *   - an address that already points into the viewer is left alone, so the
 *     prefix never lands on it twice;
 *   - an address on someone else's host is left alone;
 *   - fetch, XMLHttpRequest and the history still work — the new routing
 *     cannot take the old routing down with it.
 *
 * Run with:  node scripts/test-store-viewer-runtime-urls.mjs
 */
import vm from 'node:vm';

import { storeViewerScript } from '../bridge/shift /storeViewer.mjs';

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

const HOST = 'www.jiomart.com';
const PREFIX = `/store-viewer/${HOST}`;
const APP_ORIGIN = 'https://narayana.tailac25b4.ts.net';

/**
 * A DOM big enough for the injected script, and no bigger.
 *
 * WHY THE ELEMENTS CARRY THEIR ADDRESS THROUGH setAttribute: that is how a
 * browser works — the property is a view onto the attribute — and it is
 * how the test can see what the page asked for. An element that only had
 * a property would hide the difference between the two routes the fix has
 * to cover.
 */
class FakeElement {
  constructor() {
    this.__attrs = {};
  }

  setAttribute(name, value) {
    this.__attrs[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.__attrs, name)
      ? this.__attrs[name]
      : null;
  }
}

/** Give a class the url-carrying property a browser's element has. */
function urlProperty(protoClass, prop) {
  Object.defineProperty(protoClass.prototype, prop, {
    get() {
      return this.getAttribute(prop) ?? '';
    },
    set(value) {
      this.setAttribute(prop, value);
    },
    configurable: true,
    enumerable: true,
  });
}

class FakeScriptElement extends FakeElement {}
class FakeLinkElement extends FakeElement {}
class FakeImageElement extends FakeElement {}
class FakeSourceElement extends FakeElement {}
class FakeMediaElement extends FakeElement {}
class FakeTrackElement extends FakeElement {}
class FakeEmbedElement extends FakeElement {}
class FakeObjectElement extends FakeElement {}
class FakeFormElement extends FakeElement {}

urlProperty(FakeScriptElement, 'src');
urlProperty(FakeLinkElement, 'href');
urlProperty(FakeImageElement, 'src');
urlProperty(FakeSourceElement, 'src');
urlProperty(FakeMediaElement, 'src');
urlProperty(FakeTrackElement, 'src');
urlProperty(FakeEmbedElement, 'src');
urlProperty(FakeObjectElement, 'data');
urlProperty(FakeFormElement, 'action');

/**
 * Run the injected script and hand back what it did.
 *
 * WHY A NEW CONTEXT EVERY TIME: the script patches prototypes and globals.
 * Two runs in one context would let the second run's patches sit on top of
 * the first run's, and a test could pass for the wrong reason.
 */
function runInjectedScript({ appOrigin = APP_ORIGIN, breakOne = false } = {}) {
  const seen = { fetched: null, xhr: null, pushed: null, replaced: null, clickHandler: null };

  class FakeXhr {
    open(method, url) {
      seen.xhr = { method, url };
    }
  }

  const elementClasses = {
    HTMLScriptElement: FakeScriptElement,
    HTMLLinkElement: FakeLinkElement,
    HTMLImageElement: FakeImageElement,
    HTMLSourceElement: FakeSourceElement,
    HTMLMediaElement: FakeMediaElement,
    HTMLTrackElement: FakeTrackElement,
    HTMLEmbedElement: FakeEmbedElement,
    HTMLObjectElement: FakeObjectElement,
    HTMLFormElement: FakeFormElement,
  };

  const sandbox = {
    console,
    Element: FakeElement,
    XMLHttpRequest: FakeXhr,
    document: {
      addEventListener(type, handler) {
        if (type === 'click') seen.clickHandler = handler;
      },
    },
    location: { origin: appOrigin, href: '' },
    history: {
      pushState(state, title, url) {
        seen.pushed = url;
      },
      replaceState(state, title, url) {
        seen.replaced = url;
      },
    },
    Request: class {
      constructor(url) {
        this.url = url;
      }
    },
    ...elementClasses,
  };

  sandbox.window = {
    location: { origin: appOrigin },
    fetch(url) {
      seen.fetched = typeof url === 'string' ? url : url?.url;
      return Promise.resolve({ ok: true });
    },
    ...elementClasses,
  };

  // WHY ONE CLASS IS BROKEN ON PURPOSE: the new routing must not be able to
  // take the old routing down with it. A browser that has no such element
  // — or a page that breaks one of the prototypes — must still get the
  // fetch, XHR and history routing the viewer depends on.
  if (breakOne) sandbox.window.HTMLImageElement = undefined;

  vm.runInNewContext(storeViewerScript(PREFIX, HOST), sandbox);

  return { sandbox, seen };
}

console.log('\nthe addresses a store builds at runtime reach the store');

{
  const { sandbox } = runInjectedScript();

  const script = new sandbox.HTMLScriptElement();
  script.src = '/public/proddist/pages-CartPage.6379919340c7d2439552.js';
  ok(
    script.getAttribute('src') === `${PREFIX}/public/proddist/pages-CartPage.6379919340c7d2439552.js`,
    "a script's address is routed into the viewer",
    `-> ${script.getAttribute('src')}`,
  );

  const image = new sandbox.HTMLImageElement();
  image.src = '/images/product/original/abc.jpg';
  ok(
    image.getAttribute('src') === `${PREFIX}/images/product/original/abc.jpg`,
    "an image's address is routed into the viewer",
    `-> ${image.getAttribute('src')}`,
  );

  const link = new sandbox.HTMLLinkElement();
  link.href = '/public/proddist/app.css';
  ok(
    link.getAttribute('href') === `${PREFIX}/public/proddist/app.css`,
    "a stylesheet's address is routed into the viewer",
    `-> ${link.getAttribute('href')}`,
  );

  const form = new sandbox.HTMLFormElement();
  form.action = '/checkout';
  ok(
    form.getAttribute('action') === `${PREFIX}/checkout`,
    "a form's address is routed into the viewer",
    `-> ${form.getAttribute('action')}`,
  );
}

console.log("\nsetAttribute is routed too, because that is how a bundler asks");
{
  const { sandbox } = runInjectedScript();

  const script = new sandbox.HTMLScriptElement();
  script.setAttribute('src', '/public/proddist/pages-CartPage.6379919340c7d2439552.js');
  ok(
    script.getAttribute('src') === `${PREFIX}/public/proddist/pages-CartPage.6379919340c7d2439552.js`,
    "a chunk asked for with setAttribute is routed into the viewer",
    `-> ${script.getAttribute('src')}`,
  );
}

console.log('\nthe prefix never lands twice');
{
  const { sandbox } = runInjectedScript();

  const script = new sandbox.HTMLScriptElement();
  script.src = `${PREFIX}/already/there.js`;
  ok(
    script.getAttribute('src') === `${PREFIX}/already/there.js`,
    'an address already inside the viewer is left alone',
    `-> ${script.getAttribute('src')}`,
  );

  const absolute = new sandbox.HTMLScriptElement();
  absolute.src = `${APP_ORIGIN}${PREFIX}/already/there.js`;
  ok(
    absolute.getAttribute('src') === `${APP_ORIGIN}${PREFIX}/already/there.js`,
    'the same address written out in full is left alone',
    `-> ${absolute.getAttribute('src')}`,
  );
}

console.log("\nsomeone else's host is left alone");
{
  const { sandbox } = runInjectedScript();

  const script = new sandbox.HTMLScriptElement();
  script.src = 'https://cdn.example.com/lib.js';
  ok(
    script.getAttribute('src') === 'https://cdn.example.com/lib.js',
    'an address on another host is untouched',
    `-> ${script.getAttribute('src')}`,
  );
}

console.log('\na link inside the store keeps pointing at the store');
{
  const { sandbox, seen } = runInjectedScript();

  // The rewriter already pointed this link at the viewer, because it is in
  // the store's own markup. Clicking it must not put the prefix on it a
  // second time: the frame would then ask the store for a page called
  // "/store-viewer/www.jiomart.com/shop/aisle", which is not a page the
  // store has, and the owner would land on the store's own "we couldn't
  // find that page".
  const rewritten = { getAttribute: () => `${PREFIX}/shop/aisle` };
  seen.clickHandler({
    target: { closest: () => rewritten },
    preventDefault() {},
  });
  ok(
    !String(sandbox.location.href).includes(PREFIX + PREFIX),
    'a link the rewriter already pointed at the viewer is not prefixed twice',
    `-> ${sandbox.location.href || '(the browser follows the link itself)'}`,
  );

  // A link the store built at runtime, with the store's own address.
  const runtime = { getAttribute: () => '/shop/aisle' };
  seen.clickHandler({
    target: { closest: () => runtime },
    preventDefault() {},
  });
  ok(
    sandbox.location.href === `${PREFIX}/shop/aisle`,
    'a link the store built at runtime goes to the viewer',
    `-> ${sandbox.location.href}`,
  );
}

console.log("\nthe routing that was already there still works");
{
  const { sandbox, seen } = runInjectedScript();

  await sandbox.window.fetch('/api/service/cart');
  ok(seen.fetched === `${PREFIX}/api/service/cart`, 'fetch is routed', `-> ${seen.fetched}`);

  new sandbox.XMLHttpRequest().open('GET', '/api/service/search');
  ok(seen.xhr?.url === `${PREFIX}/api/service/search`, 'XMLHttpRequest is routed', `-> ${seen.xhr?.url}`);

  sandbox.history.pushState({}, '', '/search?q=milk');
  ok(seen.pushed === `${PREFIX}/search?q=milk`, 'the history is routed', `-> ${seen.pushed}`);
}

console.log('\nthe new routing cannot take the old routing down');
{
  const { sandbox, seen } = runInjectedScript({ breakOne: true });

  await sandbox.window.fetch('/api/service/cart');
  ok(
    seen.fetched === `${PREFIX}/api/service/cart`,
    'fetch is still routed when one of the element classes is missing',
    `-> ${seen.fetched}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
