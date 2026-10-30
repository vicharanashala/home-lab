/**
 * Tests for the screen share's own lifecycle.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The browser's share belongs to the page that asked for it, and a page can
 * only hold one at a time. The hook did not say so. Starting a second share
 * simply overwrote the references to the first one, so:
 *
 *   - the first capture kept running. The browser kept filming that tab and
 *     kept its own "you are sharing" indicator on, for a share the page had
 *     already forgotten about — and the Stop button, which only knew about
 *     the share it had been told about, could not stop it.
 *   - the first frame timer kept running, so two timers posted two frames
 *     every two seconds.
 *
 * And the browser's own "Stop sharing" button was wired to every capture the
 * page had ever made. Ending a capture that had already been replaced stopped
 * the share that had replaced it — a share the person never touched.
 *
 * WHAT THE TEST DOES
 *
 * It drives the hook itself, not a copy of it, through a small React
 * dispatcher and a fake browser, and asks the questions the browser asks:
 *
 *   - does a second share give the first one back?
 *   - is only one frame timer running?
 *   - does a capture that has been replaced stop the share that replaced it?
 *   - does the page tell the other tabs when the share is over?
 *   - does a capture granted after the page has gone away get given back?
 *   - does a capture the browser granted get given back when the share fails?
 *   - does the store stay shut when the attempt has been abandoned?
 *
 * WHY A FAKE REACT INSTEAD OF A BROWSER: the rule is about what the page
 * holds on to, and what it holds on to is decided by the hook. A fake
 * dispatcher is enough to mount it, and the fake browser is enough to hold a
 * capture — so the rule can be checked without a browser at all.
 *
 * Run with:  node scripts/test-screen-share.mjs
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREEN_WATCH_CHANNEL, reduceWatch } from '../src/utils/screenWatch.ts';

/**
 * The repository, found from this file rather than written down.
 *
 * WHY: the page that calls the hook is read from here, and a path written
 * down is a path that is right until the checkout moves.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/* ── a React that is only just React ──────────────────────────────────────
 *
 * React's hooks all read the dispatcher that is current at the moment they
 * are called. Setting it to one of our own is what makes a hook runnable
 * outside a component tree.
 */

const dispatcherSlot =
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;

function sameDeps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((value, i) => Object.is(value, b[i]));
}

/**
 * Mount a hook and let it be driven the way a component drives one.
 *
 * The parts that matter and that React gets right: a state setter re-renders
 * with the new value, a callback keeps its identity while its dependencies
 * hold, and an effect's cleanup runs before the effect runs again and when
 * the page goes away.
 */
function mountHook(render) {
  const slots = [];
  const cleanups = new Map();
  let cursor = 0;
  let scheduled = [];
  let mounted = null;

  const dispatcher = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { state: typeof initial === 'function' ? initial() : initial };
      }
      const slot = slots[index];
      const setState = (next) => {
        const resolved = typeof next === 'function' ? next(slot.state) : next;
        // The same value back means nothing changed, and React does not
        // re-render for that. The hook relies on it.
        if (Object.is(resolved, slot.state)) return;
        slot.state = resolved;
        paint();
      };
      return [slot.state, setState];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        slots[index] = { deps, fn };
      }
      return slots[index].fn;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && sameDeps(previous.deps, deps)) return;
      slots[index] = { deps };
      scheduled.push({ index, fn });
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && sameDeps(previous.deps, deps)) return previous.value;
      const value = fn();
      slots[index] = { deps, value };
      return value;
    },
    useContext() {
      return null;
    },
  };

  function paint() {
    cursor = 0;
    scheduled = [];
    dispatcherSlot.current = dispatcher;
    try {
      mounted = render();
    } finally {
      dispatcherSlot.current = null;
    }
    const effects = scheduled;
    scheduled = [];
    for (const effect of effects) {
      const previousCleanup = cleanups.get(effect.index);
      if (previousCleanup) {
        previousCleanup();
        cleanups.delete(effect.index);
      }
      const cleanup = effect.fn();
      if (typeof cleanup === 'function') cleanups.set(effect.index, cleanup);
    }
  }

  paint();

  return {
    get value() {
      return mounted;
    },
    unmount() {
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
    },
  };
}

/* ── a browser that is only just a browser ──────────────────────────────── */

/** A channel that talks to the other channels of the same name. */
class FakeChannel {
  static all = new Set();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    this.sent = [];
    /** What the other tabs said to this one. */
    this.received = [];
    FakeChannel.all.add(this);
  }

  postMessage(message) {
    if (this.closed) return;
    this.sent.push(message);
    for (const other of FakeChannel.all) {
      if (other === this || other.closed || other.name !== this.name) continue;
      other.received.push(message);
      if (other.onmessage) other.onmessage({ data: message });
    }
  }

  close() {
    this.closed = true;
    FakeChannel.all.delete(this);
  }
}

/** The frame timers the page has running. */
const timers = new Map();
let nextTimerId = 1;

/** A capture, and the record of whether it is still filming. */
function makeStream() {
  const endedListeners = [];
  const track = {
    stopped: false,
    addEventListener(type, fn) {
      if (type === 'ended') endedListeners.push(fn);
    },
    stop() {
      track.stopped = true;
    },
    /** What the browser does when the person presses "Stop sharing". */
    end() {
      endedListeners.forEach((fn) => fn());
    },
  };
  return {
    track,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
}

/**
 * Install the browser the hook is going to meet.
 *
 * The captures it hands back are collected in `streams`, so a test can ask
 * what is still running.
 *
 * WHY THE VIDEO CAN BE HELD BACK: a real video does not start playing the
 * instant it is told to, and the page can go away while it is still
 * starting. `gate` holds the answer to "has the video started?" until the
 * test gives it, so a test can put the page's life and the video's start on
 * opposite sides of each other.
 */
function installBrowser(streams, gate) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      setInterval(fn) {
        const id = nextTimerId++;
        timers.set(id, fn);
        return id;
      },
      clearInterval(id) {
        timers.delete(id);
      },
    },
  });

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      createElement(tag) {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage() {} }),
            toDataURL: () => 'data:image/jpeg;base64,QUJDRA==',
          };
        }
        return {
          srcObject: null,
          muted: false,
          playsInline: false,
          videoWidth: 1200,
          videoHeight: 800,
          play: () => (gate ? gate.promise : Promise.resolve()),
        };
      },
    },
  });

  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: FakeChannel,
  });

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        async getDisplayMedia() {
          const stream = makeStream();
          streams.push(stream);
          return stream;
        },
      },
    },
  });
}

function reset() {
  FakeChannel.all.clear();
  timers.clear();
}

/**
 * Let the hook get as far as it can.
 *
 * The browser's answer comes back as a promise, so the hook is waiting on one
 * when the test's next line runs. A turn of the event loop lets it arrive.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const { useScreenSharer } = await import('../src/hooks/useScreenWatch.ts');

console.log('\na second share gives the first one back');
{
  reset();
  const streams = [];
  installBrowser(streams);
  const harness = mountHook(() => useScreenSharer());

  await harness.value.start('Amazon Fresh', () => {});
  ok(streams.length === 1, 'the first share was asked for');
  ok(streams[0].track.stopped === false, 'and it is running');

  await harness.value.start('Big Bazaar', () => {});
  ok(streams.length === 2, 'a second share was asked for');
  ok(streams[0].track.stopped === true, 'THE FIRST CAPTURE WAS GIVEN BACK');
  ok(timers.size === 1, 'only one frame timer is running', `timers: ${timers.size}`);
  ok(harness.value.state.watching === true, 'the share is running');
  ok(harness.value.state.label === 'Big Bazaar', 'and it is the store that was picked');

  harness.unmount();
}

console.log('\na capture that has been replaced does not stop the share that replaced it');
{
  reset();
  const streams = [];
  installBrowser(streams);
  const harness = mountHook(() => useScreenSharer());

  await harness.value.start('Amazon Fresh', () => {});
  await harness.value.start('Big Bazaar', () => {});

  // The browser ends the capture of the share that was replaced.
  streams[0].track.end();
  ok(streams[1].track.stopped === false, 'the share that is running is still running');
  ok(harness.value.state.watching === true, 'and the page still says it is sharing');

  // The capture that IS running is the one that ends the share.
  streams[1].track.end();
  ok(streams[1].track.stopped === true, 'the browser ending the live capture stops it');
  ok(harness.value.state.watching === false, 'and the page says the share is over');

  harness.unmount();
}

console.log('\na refused second share does not orphan the first one');
{
  reset();
  const streams = [];
  installBrowser(streams);
  // The picker refuses the SECOND request, which is what happens when the
  // person opens the store and then declines to share it.
  let calls = 0;
  navigator.mediaDevices.getDisplayMedia = async () => {
    calls += 1;
    if (calls === 2) {
      const err = new Error('the person said no');
      err.name = 'NotAllowedError';
      throw err;
    }
    const stream = makeStream();
    streams.push(stream);
    return stream;
  };

  const watcher = new FakeChannel(SCREEN_WATCH_CHANNEL);
  const harness = mountHook(() => useScreenSharer());

  await harness.value.start('Amazon Fresh', () => {});
  ok(harness.value.state.watching === true, 'the first share is running');

  await harness.value.start('Big Bazaar', () => {});

  // The capture must survive the refusal — the hook only gives a share back
  // when a NEW one has been granted.
  ok(
    streams.length === 1 && streams[0].track.stopped === false,
    'the first capture is still running',
  );

  // But the PAGE has to know about it. If the page says the share is over,
  // the "Sharing the X tab" panel — which holds the only Stop button in the
  // app — disappears, and the page prints "Screen sharing was not allowed"
  // while the browser is still filming.
  ok(
    harness.value.state.watching === true,
    'THE PAGE STILL SAYS IT IS SHARING',
    `watching: ${harness.value.state.watching}`,
  );
  ok(
    harness.value.state.label === 'Amazon Fresh',
    'and it is still the store it is actually sharing',
    `label: ${harness.value.state.label}`,
  );
  ok(timers.size === 1, 'the frame timer is still running', `timers: ${timers.size}`);
  ok(
    watcher.received.some((m) => m.kind === 'status' && m.watching === true),
    'the other tabs are still told a share is live',
  );

  harness.unmount();
}

console.log('\nthe other tabs are told when the share is over');
{
  reset();
  const streams = [];
  installBrowser(streams);
  const watcher = new FakeChannel(SCREEN_WATCH_CHANNEL);
  const harness = mountHook(() => useScreenSharer());

  await harness.value.start('Amazon Fresh', () => {});
  ok(
    watcher.received.some((m) => m.kind === 'status' && m.watching === true),
    'the other tabs are told the share has started',
  );

  harness.unmount();
  ok(
    watcher.received.some((m) => m.kind === 'status' && m.watching === false),
    'and told when the page goes away',
  );
  ok(streams[0].track.stopped === true, 'and the capture is given back');
}

console.log('\nthe page goes away while the picker is open');
{
  reset();
  const streams = [];
  installBrowser(streams);

  // The picker is a question the app cannot rush, so the answer can arrive
  // after the page has moved on. Hold the answer until the page is gone.
  let answer;
  navigator.mediaDevices.getDisplayMedia = () =>
    new Promise((resolve) => {
      answer = resolve;
    });

  const harness = mountHook(() => useScreenSharer());
  const starting = harness.value.start('Amazon Fresh', () => {});

  // The page goes away — the person navigated, or the tab was replaced.
  harness.unmount();

  // And now the person answers the picker.
  const granted = makeStream();
  streams.push(granted);
  answer(granted);
  await starting;

  // A capture the browser has granted is filming until something stops its
  // track. The page that would have let the person stop it is gone, so the
  // capture has to be given back here — otherwise the browser keeps filming
  // and keeps its own "you are sharing" indicator on, for a share nobody is
  // watching and nothing in the app can stop.
  ok(granted.track.stopped === true, 'THE GRANTED CAPTURE IS GIVEN BACK');
  ok(timers.size === 0, 'and no frame timer is left running', `timers: ${timers.size}`);
}

console.log('\nthe person stops the share while the picker is open');
{
  reset();
  const streams = [];
  installBrowser(streams);

  let answer;
  navigator.mediaDevices.getDisplayMedia = () =>
    new Promise((resolve) => {
      answer = resolve;
    });

  const harness = mountHook(() => useScreenSharer());
  const starting = harness.value.start('Amazon Fresh', () => {});

  // The person presses Stop before the picker is answered. Stop means stop:
  // a picker they are still looking at is a question the page has answered.
  harness.value.stop();

  const granted = makeStream();
  streams.push(granted);
  answer(granted);
  await starting;

  ok(granted.track.stopped === true, 'the late capture is given back');
  ok(
    harness.value.state.watching === false,
    'and the page does not start sharing',
    `watching: ${harness.value.state.watching}`,
  );
  ok(timers.size === 0, 'and no frame timer is left running', `timers: ${timers.size}`);
}

console.log('\nthe page goes away while the video is still starting');
{
  reset();
  const streams = [];
  // The video does not start the instant it is told to.
  let startVideo;
  const gate = {
    promise: new Promise((resolve) => {
      startVideo = resolve;
    }),
  };
  installBrowser(streams, gate);

  const watcher = new FakeChannel(SCREEN_WATCH_CHANNEL);
  const harness = mountHook(() => useScreenSharer());

  const starting = harness.value.start('Amazon Fresh', () => {});
  await settle();

  // The page goes away — the person navigated, or the tab was replaced.
  const before = watcher.received.length;
  harness.unmount();

  // And now the video starts playing — for a page that is no longer there.
  startVideo();
  await starting;

  // Only what arrived AFTER the page went away matters. The share may well
  // have been announced before that; it must not be announced again after.
  const after = watcher.received.slice(before);
  ok(
    !after.some((m) => m.kind === 'status' && m.watching === true),
    'THE OTHER TABS ARE NOT TOLD A SHARE IS LIVE',
    after.length ? `they were told: ${JSON.stringify(after)}` : '',
  );
  ok(
    timers.size === 0,
    'and no frame timer is left running',
    `timers: ${timers.size}`,
  );
  ok(
    streams.every((s) => s.track.stopped),
    'and the capture is given back',
  );
}

console.log('\nthe person stops the share while the video is still starting');
{
  reset();
  const streams = [];
  let startVideo;
  const gate = {
    promise: new Promise((resolve) => {
      startVideo = resolve;
    }),
  };
  installBrowser(streams, gate);

  const watcher = new FakeChannel(SCREEN_WATCH_CHANNEL);
  const harness = mountHook(() => useScreenSharer());

  const starting = harness.value.start('Amazon Fresh', () => {});
  await settle();

  // Stop means stop — and the person must not be told the share is running
  // afterwards, because the capture it would be running on is already gone.
  const before = watcher.received.length;
  harness.value.stop();

  startVideo();
  await starting;

  const after = watcher.received.slice(before);
  ok(
    !after.some((m) => m.kind === 'status' && m.watching === true),
    'THE OTHER TABS ARE NOT TOLD A SHARE IS LIVE',
    after.length ? `they were told: ${JSON.stringify(after)}` : '',
  );
  ok(
    harness.value.state.watching === false,
    'and the page does not start sharing',
    `watching: ${harness.value.state.watching}`,
  );
  ok(
    timers.size === 0,
    'and no frame timer is left running',
    `timers: ${timers.size}`,
  );
}

console.log('\na share that moves to another store does not keep the old picture');
{
  reset();
  const streams = [];
  installBrowser(streams);
  const watcher = new FakeChannel(SCREEN_WATCH_CHANNEL);
  const harness = mountHook(() => useScreenSharer());

  // What the other tab knows. This is the rule the other tab folds the
  // sharer's messages with — the same one House Bot uses.
  let watch = { watching: false, label: null, frame: null, lastSeenAt: null };
  const deliver = (m) => {
    watch = reduceWatch(watch, m, Date.now());
  };

  await harness.value.start('Amazon Fresh', () => {});
  // The frame timer fires once, so the other tab holds a picture of the first
  // store — which is what it would answer a question with.
  for (const fn of [...timers.values()]) fn();
  for (const m of watcher.received) deliver(m);
  ok(watch.label === 'Amazon Fresh', 'the first store is being watched');
  const amazonFrame = watch.frame;
  ok(amazonFrame !== null, 'and the other tab holds its picture');

  // The person now shares a different store. The sharer names it at once,
  // and the first picture of the new store only comes with the next tick of
  // the frame timer — so for a moment the other tab knows the new name and
  // still holds the old picture.
  watcher.received.length = 0;
  await harness.value.start('Big Bazaar', () => {});
  for (const m of watcher.received) deliver(m);

  ok(watch.label === 'Big Bazaar', 'the new store is named');
  ok(
    watch.frame === null,
    "THE OLD STORE'S PICTURE IS NOT STILL THERE",
    watch.frame ? `still held: ${watch.frame.data}` : '',
  );
  ok(
    watch.frame !== amazonFrame,
    "and what is held is not the first store's picture",
  );

  // The next tick brings the new store's picture, and that is what is used.
  for (const fn of [...timers.values()]) fn();
  for (const m of watcher.received) deliver(m);
  ok(watch.frame !== null, 'the new store\'s picture arrives');
  ok(watch.frame !== amazonFrame, 'and it is not the first store\'s picture');

  harness.unmount();
}

console.log("\ntwo tabs sharing at once do not show one store under the other's name");
{
  reset();
  const streams = [];
  installBrowser(streams);
  // The watcher is a plain fold of what the other tabs said — the same rule
  // House Bot uses.
  const watcher = new FakeChannel(SCREEN_WATCH_CHANNEL);
  let watch = { watching: false, label: null, frame: null, lastSeenAt: null };
  const deliver = (m) => {
    watch = reduceWatch(watch, m, Date.now());
  };

  // Two tabs of this app share at the same time: the stores page opened
  // twice, one tab sharing Amazon Fresh and the other Big Bazaar. Each tab
  // holds its own share, and each picture says which store it is of.
  const amazon = mountHook(() => useScreenSharer());
  const bazaar = mountHook(() => useScreenSharer());

  await amazon.value.start('Amazon Fresh', () => {});
  await bazaar.value.start('Big Bazaar', () => {});
  for (const m of watcher.received.splice(0)) deliver(m);
  ok(watch.label === 'Big Bazaar', 'the watcher is watching the second store');

  // Now the FIRST tab's picture arrives — a picture of Amazon Fresh, while
  // the watcher is watching Big Bazaar. The two tabs' pictures cross on the
  // channel, because they are both on the same one.
  const ids = [...timers.keys()];
  timers.get(ids[0])();
  for (const m of watcher.received.splice(0)) deliver(m);
  ok(
    watch.frame === null,
    "THE OTHER TAB'S PICTURE IS NOT TAKEN",
    watch.frame ? `still held: ${watch.frame.data}` : '',
  );
  ok(
    watch.label === 'Big Bazaar',
    'and the store being watched is still named',
    String(watch.label),
  );

  // The second tab's own picture arrives, and that is the one used.
  timers.get(ids[1])();
  for (const m of watcher.received.splice(0)) deliver(m);
  ok(watch.frame !== null, 'the store being watched has its picture');

  amazon.unmount();
  bazaar.unmount();
}

console.log('\na capture the browser granted is given back when the share cannot start');
{
  reset();
  const streams = [];
  installBrowser(streams);
  // A browser with no BroadcastChannel: the share cannot announce itself, and
  // it fails AFTER the browser has granted the capture.
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  const harness = mountHook(() => useScreenSharer());

  const started = await harness.value.start('Amazon Fresh', () => {});
  ok(started === false, 'the share did not start');
  ok(streams.length === 1, 'but the browser had granted a capture');
  ok(
    streams[0].track.stopped === true,
    'AND THE CAPTURE IS GIVEN BACK — it is not left filming',
    `track.stopped = ${streams[0].track.stopped}`,
  );
  ok(
    harness.value.state.watching === false,
    'and the page is not saying it is sharing',
    `watching = ${harness.value.state.watching}`,
  );
  ok(
    timers.size === 0,
    'and no frame timer is left running',
    `timers: ${timers.size}`,
  );

  harness.unmount();
}

console.log('\na share that fails after the capture is registered is taken down');
{
  reset();
  const streams = [];
  installBrowser(streams);
  const watcher = new FakeChannel(SCREEN_WATCH_CHANNEL);
  // A browser whose timers cannot be started. The share fails after the
  // capture has been granted AND registered, which is the point where the
  // page is holding a capture it has to give back.
  const working = globalThis.window;
  globalThis.window = {
    ...working,
    setInterval() {
      throw new Error('the page cannot run a timer');
    },
  };
  const harness = mountHook(() => useScreenSharer());

  const started = await harness.value.start('Amazon Fresh', () => {});
  ok(started === false, 'the share did not start');
  ok(
    streams[0].track.stopped === true,
    'and the capture it had registered is given back',
    `track.stopped = ${streams[0].track.stopped}`,
  );
  ok(
    harness.value.state.watching === false,
    'and the page is not saying it is sharing',
    `watching = ${harness.value.state.watching}`,
  );

  // What the other tab makes of it. The same rule House Bot uses.
  let watch = { watching: false, label: null, frame: null, lastSeenAt: null };
  for (const m of watcher.received) watch = reduceWatch(watch, m, Date.now());
  ok(
    watch.watching === false,
    'AND THE OTHER TAB IS NOT TOLD A SHARE IS RUNNING',
    `watching = ${watch.watching}`,
  );

  harness.unmount();
  globalThis.window = working;
}

console.log('\nthe share asks the browser the question the browser answers');
{
  reset();
  const streams = [];
  installBrowser(streams);

  // WHAT THE BROWSER ACTUALLY READS
  //
  // The Screen Capture spec puts `selfBrowserSurface` on the options object
  // ITSELF, beside `video` and `audio` — MDN's own example reads
  //
  //   getDisplayMedia({ video: { displaySurface: "browser" },
  //                     selfBrowserSurface: "include", ... })
  //
  // Inside the video constraints it is an unknown constraint, and an unknown
  // constraint is one the browser ignores. So a hint buried in `video` is a
  // hint the browser never reads, and the app is left believing it asked for
  // something it did not ask for.
  //
  // This fake browser reads the options the way the browser does: the
  // surface out of the video constraints, the self-browser hint off the top
  // of the options object.
  //
  // AND THE ONE THAT KEEPS THE WHOLE SCREEN OUT OF THE PICKER
  //
  // `displaySurface` says which kind of surface the app wants, and Chrome uses
  // it to put that kind in front of the person. It does NOT take the other
  // kinds away — MDN is explicit: it "has no effect on what the user can
  // choose to share". The whole screen stays in the picker, one click away,
  // and the whole screen is what holds the person's bank and their messages.
  //
  // `monitorTypeSurfaces: "exclude"` is the option that takes the screens
  // out of the picker altogether (Chrome 119 and later; older browsers and
  // Safari ignore it, which is why it is safe to send). It goes at the TOP
  // LEVEL of the options, for the same reason `selfBrowserSurface` does.
  let asked = null;
  navigator.mediaDevices.getDisplayMedia = async (options) => {
    asked = options;
    const stream = makeStream();
    streams.push(stream);
    return stream;
  };

  const harness = mountHook(() => useScreenSharer());
  await harness.value.start('Amazon Fresh', () => {});

  const surface = asked?.video?.displaySurface;
  const selfBrowserSurface = asked?.selfBrowserSurface;
  const buriedInVideo = asked?.video?.selfBrowserSurface;
  const monitorTypeSurfaces = asked?.monitorTypeSurfaces;
  const monitorBuriedInVideo = asked?.video?.monitorTypeSurfaces;

  ok(
    surface === 'window',
    'the picker is told a WINDOW is what the app wants, so Chrome asks about the window',
    `displaySurface: ${String(surface)}`,
  );
  ok(
    selfBrowserSurface === 'include',
    'THE BROWSER IS TOLD THE CURRENT TAB MAY BE PICKED',
    `selfBrowserSurface: ${String(selfBrowserSurface)}`,
  );
  ok(
    buriedInVideo === undefined,
    'and the hint is not buried in the video constraints, where the browser never looks',
    `video.selfBrowserSurface: ${String(buriedInVideo)}`,
  );
  ok(
    monitorTypeSurfaces === 'exclude',
    'WHOLE SCREENS ARE NOT OFFERED AT ALL',
    `monitorTypeSurfaces: ${String(monitorTypeSurfaces)}`,
  );
  ok(
    monitorBuriedInVideo === undefined,
    'and that hint is not buried in the video constraints either',
    `video.monitorTypeSurfaces: ${String(monitorBuriedInVideo)}`,
  );

  harness.unmount();
}


console.log('\nthe store is opened AFTER the browser is asked, not before');
{
  // WHY THE ORDER MATTERS: Chrome only puts the capture picker up for a
  // page that is in front. Opening the store's tab first took the focus and
  // hid this page, so the request went out and nothing came back — the
  // picker never appeared and the app waited for an answer that was never
  // going to arrive. The person saw nothing happen at all.
  reset();
  const streams = [];
  installBrowser(streams);

  const order = [];
  navigator.mediaDevices.getDisplayMedia = async () => {
    order.push('asked');
    const stream = makeStream();
    streams.push(stream);
    return stream;
  };

  const harness = mountHook(() => useScreenSharer());
  await harness.value.start('Amazon Fresh', () => {
    order.push('opened');
  });

  ok(
    order[0] === 'asked',
    'the browser is asked while the page is still in front',
    order.join(' then '),
  );
  ok(
    order.includes('opened'),
    'and the store opens',
    order.join(' then '),
  );
  // THE STORE MUST OPEN INSIDE THE CLICK. Chrome's popup blocker refuses a
  // window.open() that is no longer tied to one, and the address bar said
  // "Pop-up blocked" while the page said nothing at all.
  // The store must NOT open in the same instant as the request: that hides
  // the page and Chrome refuses the share. It must open a moment later, while
  // the click is still recent enough for the popup blocker to allow it.
  ok(
    order.indexOf('opened') === 1,
    'the store opens after the request, not in the same instant',
    order.join(' then '),
  );
}

console.log('\nand the caller describes the order the app actually runs in');
{
  // WHY THIS TEST EXISTS
  //
  // The order was reversed in 10a1645 ("Ask Chrome for the window while this
  // page is still in front") and the test above pins it. But the page that
  // CALLS the hook kept the comment that described the order before the
  // reversal:
  //
  //     "The tab is opened FIRST, because the browser's picker lists the
  //      windows that can be shared and the person has to be able to pick
  //      the one the store just opened in."
  //
  // That is not only out of date — it is the reason the reversal was needed,
  // stated as the reason the old order was right. A reader of that page would
  // conclude the store's tab has to exist before the picker, and would put the
  // broken order back.
  //
  // WHY IT IS THE SAME SHAPE AS THE OTHER HALVES: this is the mistake
  // scripts/test-bridge-screen-window-wording.mjs was written for — one half
  // of a feature is fixed and the other half is left behind, and nothing goes
  // red. The hook half was fixed and pinned; the caller's half was not, and
  // the comment is what was left behind.
  //
  // WHY THE ORDER IS TAKEN FROM THE RUN AND NOT WRITTEN DOWN HERE: the check
  // is that the comment agrees with the code, so the code has to be the thing
  // being compared against. Write the order into the test and the two could
  // drift apart the same way the comment did.
  reset();
  const streams = [];
  installBrowser(streams);

  const order = [];
  navigator.mediaDevices.getDisplayMedia = async () => {
    order.push('asked');
    const stream = makeStream();
    streams.push(stream);
    return stream;
  };

  const harness = mountHook(() => useScreenSharer());
  await harness.value.start('Amazon Fresh', () => {
    order.push('opened');
  });
  harness.unmount();

  const askedFirst = order.indexOf('asked') < order.indexOf('opened');
  ok(askedFirst, 'the browser really is asked first', order.join(' then '));

  // The comment on the caller, which is what a reader of that page sees.
  const caller = fs.readFileSync(
    path.join(REPO, 'src', 'pages', 'DigitalStores.tsx'),
    'utf8',
  );
  const fnAt = caller.indexOf('const openAndWatch');
  ok(fnAt > 0, 'the caller that opens the store is where it is expected to be');

  // WHY THE COMMENT IS FOUND BY ITS BRACES: the file is a page and its lines
  // move. The comment that belongs to this function is the one above it.
  const commentStart = caller.lastIndexOf('/**', fnAt);
  const commentEnd = caller.indexOf('*/', commentStart);
  const comment = commentStart < 0 || commentEnd < 0 ? '' : caller.slice(commentStart, commentEnd);

  const claimsOpenedFirst = /opened\s+FIRST|tab\s+is\s+opened\s+first|opens?\s+the\s+(tab|store)\s+first/i.test(
    comment,
  );
  ok(
    !(askedFirst && claimsOpenedFirst),
    'the caller does not claim the store is opened first',
    claimsOpenedFirst
      ? 'the comment says the tab is opened FIRST; the code asks the browser first'
      : '',
  );
  ok(
    !(askedFirst && !/\bafter\b/i.test(comment)),
    'and it says the store opens after the browser has answered',
    'the comment never says "after"',
  );
}

console.log('\nand the hook describes the order the hook itself runs in');
{
  // WHY THIS EXISTS
  //
  // The block above pins the ORDER in code and checks the CALLER's comment
  // against it. The HOOK's own docstring was left out of that, and it still
  // described the order the hook used to run in:
  //
  //     "the store opens once the browser has answered"
  //
  // That is not only out of date — it is the order Chrome blocked as a
  // pop-up, stated as the order the code runs in. A reader of the hook would
  // conclude the tab opens with a dead gesture, and would put the broken
  // order back.
  //
  // WHY THE HOOK IS THE PLACE THAT MATTERS MOST: the timer that opens the
  // store lives here, and every screen's share goes through here, so its
  // docstring is what the next agent reads before touching the ordering.
  //
  // WHY THE ORDER IS TAKEN FROM THE CODE AND NOT WRITTEN DOWN HERE: the check
  // is that the comment agrees with the code, so the code has to be the thing
  // being compared against. Write the order into the test and the two could
  // drift apart the same way the comment did.
  const hook = fs.readFileSync(
    path.join(REPO, 'src', 'hooks', 'useScreenWatch.ts'),
    'utf8',
  );
  const fnAt = hook.indexOf('const start = useCallback(');
  ok(fnAt > 0, 'the hook that starts the share is where it is expected to be');

  const commentStart = hook.lastIndexOf('/**', fnAt);
  const commentEnd = hook.indexOf('*/', commentStart);
  const comment = commentStart < 0 || commentEnd < 0 ? '' : hook.slice(commentStart, commentEnd);

  // The store is opened on a TIMER after the ask, so the person's click is
  // still alive when the tab opens.
  const body = hook.slice(fnAt, fnAt + 12000);
  const opensOnATimer = /setTimeout\(openTheStore,\s*\d+\)/.test(body);

  const claimsAfterTheAnswer =
    /opens?\s+(once|after)\s+the\s+browser\s+(has\s+)?answered/i.test(comment);

  ok(
    opensOnATimer,
    'the code opens the store on a timer after the ask',
    opensOnATimer ? '' : 'the hook has no setTimeout(openTheStore, …)',
  );
  ok(
    !claimsAfterTheAnswer,
    'the hook does not claim the store opens after the browser has answered',
    claimsAfterTheAnswer
      ? 'the docstring says the store opens once the browser has answered; the code opens it a moment after the ask'
      : '',
  );
  ok(
    /after\s+the\s+ask|a\s+moment\s+later/i.test(comment),
    'and it says the store opens after the ask',
    /after\s+the\s+ask|a\s+moment\s+later/i.test(comment)
      ? ''
      : 'the docstring never says the store opens after the ask',
  );
}

console.log('\nthe store opens even when the browser refuses the share');
{
  reset();
  const streams = [];
  installBrowser(streams);

  const order = [];
  navigator.mediaDevices.getDisplayMedia = async () => {
    order.push('asked');
    const err = new Error('Permission denied');
    err.name = 'NotAllowedError';
    throw err;
  };

  const harness = mountHook(() => useScreenSharer());
  await harness.value.start('Amazon Fresh', () => {
    order.push('opened');
  });

  ok(
    order.includes('opened'),
    'the person asked for a STORE, so the store opens',
    order.join(' then '),
  );
  ok(
    order.filter((o) => o === 'opened').length === 1,
    'and it opens exactly once',
    order.join(' then '),
  );
}

console.log('\nthe store opens even when the browser throws before it answers');
{
  // WHY THIS TEST EXISTS
  //
  // The block above covers the browser REFUSING the share: getDisplayMedia
  // returns a promise and the promise is rejected. There is another way for
  // the ask to fail, and it never becomes a rejected promise — the browser
  // throws WHILE the request is being made:
  //
  //     navigator.mediaDevices.getDisplayMedia(...)   ->   throws
  //
  // The throw happens before there is a promise to reject, so it never
  // reaches the catch around `await request`. It goes straight to the catch
  // around the whole attempt — and that catch is the one that REPORTS the
  // failure to the household:
  //
  //     the person pressed   a store
  //     the browser          threw
  //     the store's tab      did not open
  //     the screen said      "Screen sharing was not allowed.
  //                           The store opened in a new tab."
  //
  // The last line is the defect. The store's tab did NOT open, and the
  // screen said it did — because the screen says "The store opened in a new
  // tab." whenever it was not told the tab was blocked, and it is only told
  // that by the opening callback, which never ran.
  //
  // WHY IT MATTERS THAT THE PERSON ASKED FOR A STORE: the share failing is
  // not the end of the thing the person pressed. They pressed a store, and
  // the store is what they get — whether the browser granted the screen or
  // not. Every other failure path opens the store for exactly that reason.
  reset();
  const streams = [];
  installBrowser(streams);

  const order = [];
  navigator.mediaDevices.getDisplayMedia = () => {
    order.push('asked');
    const err = new Error('the browser would not ask');
    err.name = 'NotAllowedError';
    throw err;
  };

  const harness = mountHook(() => useScreenSharer());
  await harness.value.start('Amazon Fresh', () => {
    order.push('opened');
  });

  ok(
    order.includes('opened'),
    'the person asked for a STORE, so the store opens',
    order.join(' then '),
  );
  ok(
    order.filter((o) => o === 'opened').length === 1,
    'and it opens exactly once',
    order.join(' then '),
  );
  ok(
    typeof harness.value.state.error === 'string' && harness.value.state.error.length > 0,
    'and the failure is still reported',
    `error: ${harness.value.state.error}`,
  );
}

console.log('\nthe store stays shut when the attempt has been abandoned');
{
  // WHY THIS TEST EXISTS
  //
  // The store is opened from several places — a short timer after the
  // browser is asked, the browser's refusal, and the browser's answer — and
  // every one of them asks whether the attempt is still alive first. And the
  // attempt can die between the question and the answer: the person presses
  // Stop, or the page goes away. The store opened anyway:
  //
  //     the person presses Stop, then dismisses Chrome's picker
  //       ->  a store opens in a tab, after the person said stop
  //
  // Every OTHER side effect of that answer already asks whether the attempt
  // is still alive — the capture is given back, no frame timer is left
  // running, the other tabs are not told a share is live (see "the person
  // stops the share while the picker is open" above). The store was the one
  // side effect that did not ask, and the hook's own rule says what should
  // happen when it does:
  //
  //     "a store opening in a tab after the person has gone is worse than
  //      a store that did not open"
  //
  // — and the hook now asks, on every path that opens the store, whether the
  // attempt is still alive. A timer still running after the page has gone
  // away cannot open anything, because the attempt it belonged to is gone.
  // The person is left with a tab they did not ask for, and nothing on screen
  // says it is there. They can always ask for the store again.

  console.log('\n  and the person presses Stop, then dismisses the picker');
  {
    reset();
    const streams = [];
    installBrowser(streams);

    let refuse;
    navigator.mediaDevices.getDisplayMedia = () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      });

    const harness = mountHook(() => useScreenSharer());
    const order = [];
    const starting = harness.value.start('Amazon Fresh', () => {
      order.push('opened');
    });

    // The person presses Stop while Chrome's picker is still up.
    harness.value.stop();

    // And then dismisses Chrome's picker.
    const err = new Error('the person said no');
    err.name = 'NotAllowedError';
    refuse(err);
    await starting;

    // The store opens a moment after the request, and the person pressing
    // Stop retires the attempt — so no tab opens at all. The person said
    // stop; a store opening anyway is a tab they did not ask for.
    ok(
      order.length === 0,
      'THE STORE DOES NOT OPEN AFTER STOP',
      order.join(' then '),
    );
  }

  console.log('\n  and the page goes away, then the picker is refused');
  {
    reset();
    const streams = [];
    installBrowser(streams);

    let refuse;
    navigator.mediaDevices.getDisplayMedia = () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      });

    const harness = mountHook(() => useScreenSharer());
    const order = [];
    const starting = harness.value.start('Amazon Fresh', () => {
      order.push('opened');
    });

    // The page goes away — the person navigated, or the tab was replaced.
    harness.unmount();

    const err = new Error('the person said no');
    err.name = 'NotAllowedError';
    refuse(err);
    await starting;

    ok(
      order.length === 0,
      'THE STORE DOES NOT OPEN AFTER THE PAGE WENT AWAY',
      order.join(' then '),
    );
  }

  console.log('\n  and the capture is granted after Stop');
  {
    reset();
    const streams = [];
    installBrowser(streams);

    let answer;
    navigator.mediaDevices.getDisplayMedia = () =>
      new Promise((resolve) => {
        answer = resolve;
      });

    const harness = mountHook(() => useScreenSharer());
    const order = [];
    const starting = harness.value.start('Amazon Fresh', () => {
      order.push('opened');
    });

    harness.value.stop();

    const granted = makeStream();
    streams.push(granted);
    answer(granted);
    await starting;

    ok(
      order.length === 0,
      'THE STORE DOES NOT OPEN WHEN THE CAPTURE IS GRANTED AFTER STOP',
      order.join(' then '),
    );
    ok(
      granted.track.stopped === true,
      'and the late capture is still given back',
      `track.stopped = ${granted.track.stopped}`,
    );
  }
}

console.log('\nthe store opens inside the click, so no long timer is left waiting');
{
  // WHY THIS IS CHECKED SEPARATELY: the store's tab is opened on a SHORT
  // timer after the browser is asked — 350ms — because that is the only
  // window in which Chrome's popup blocker will allow it. The timer belongs
  // to the attempt, and Stop retires the attempt, so the timer has to go
  // with it: otherwise a timer is left running on a page whose person has
  // said stop.
  //
  // WHY THE CHECK IS ABOUT THE TIMER'S LENGTH AND NOT ITS EXISTENCE: the
  // store's tab IS opened on a timer, and that is the order the code runs
  // in. What must not come back is the FOUR-SECOND timer this used to have
  // — the one that fired only when the browser never answered. By then the
  // person's click is long dead, and the tab it opened was a pop-up Chrome
  // blocked. So the check is that no timer of four seconds or more is
  // waiting.
  //
  // WHY THE TIMERS ARE COUNTED RATHER THAN WAITED FOR: a test that waits
  // four seconds to learn what a counter can say in a millisecond makes
  // every commit slower for every agent.
  reset();
  const streams = [];
  installBrowser(streams);

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pending = new Map();
  globalThis.setTimeout = (fn, ms) => {
    const id = realSetTimeout(fn, ms);
    pending.set(id, ms);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    pending.delete(id);
    realClearTimeout(id);
  };

  try {
    let answer;
    navigator.mediaDevices.getDisplayMedia = () =>
      new Promise((resolve) => {
        answer = resolve;
      });

    const harness = mountHook(() => useScreenSharer());
    const starting = harness.value.start('Amazon Fresh', () => {});

    // WHY THE THRESHOLD IS FOUR SECONDS: the timer this used to have was
    // four seconds long, and the tab it opened was a pop-up Chrome blocked.
    // A timer that long means the person's click is gone before the tab
    // opens — so the check is that no timer of that length is waiting.
    const fallbacks = () => [...pending.values()].filter((ms) => ms >= 4000);
    ok(
      fallbacks().length === 0,
      'no timer long enough to outlive the click is waiting to open the store',
      `${fallbacks().length}`,
    );

    harness.value.stop();

    const err = new Error('the person said no');
    err.name = 'NotAllowedError';
    answer(err);
    await starting;
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
