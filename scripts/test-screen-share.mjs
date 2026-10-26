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
 *
 * WHY A FAKE REACT INSTEAD OF A BROWSER: the rule is about what the page
 * holds on to, and what it holds on to is decided by the hook. A fake
 * dispatcher is enough to mount it, and the fake browser is enough to hold a
 * capture — so the rule can be checked without a browser at all.
 *
 * Run with:  node scripts/test-screen-share.mjs
 */
import React from 'react';
import { SCREEN_WATCH_CHANNEL } from '../src/utils/screenWatch.ts';

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
 */
function installBrowser(streams) {
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
          play: async () => {},
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
