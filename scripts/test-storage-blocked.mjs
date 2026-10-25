/**
 * Tests that the end-of-day reminder survives a browser that refuses storage.
 *
 * WHY THIS MATTERS
 * The reminder keeps its settings in localStorage, and it reads and writes
 * that storage on the app's STARTUP path — `scheduleEndOfDayReminder` runs
 * when the app mounts and every five minutes after that — and on the
 * Settings page, which reads the reminder while it renders.
 *
 * A browser that refuses storage does not merely refuse to save. Safari with
 * cookies blocked throws a SecurityError when the app READS
 * `window.localStorage`, so reading the storage throws as surely as writing
 * it does, and even `typeof localStorage === 'undefined'` throws there —
 * that check cannot tell "there is no storage" from "the browser will not
 * answer".
 *
 * WHAT WAS WRONG
 * Every read and write went to the bare `localStorage` global with no guard,
 * so on such a browser all five entry points threw a SecurityError. The
 * throw on the startup path is not a missing reminder, it is a crash: there
 * is no error boundary above the one that wraps the pages, so the user got a
 * blank screen instead of an app that runs and tells them their browser
 * keeps nothing.
 *
 * WHAT IS TESTED HERE
 * That a blocked storage, a storage that reads but refuses to write, and a
 * storage that works all leave the reminder usable — the first two by
 * degrading to "no reminder", the last by behaving exactly as before.
 *
 * Run with:  node scripts/test-storage-blocked.mjs
 */
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(REPO, 'node_modules'))) {
  console.error('node_modules is missing — run npm install first');
  process.exit(1);
}

const {
  getReminderEnabled,
  getReminderHour,
  setReminderEnabled,
  setReminderHour,
  scheduleEndOfDayReminder,
} = await import('../src/utils/endOfDayReminder.ts');

let passed = 0;
let failed = 0;

function check(label, got, expected) {
  const have = JSON.stringify(got);
  const want = JSON.stringify(expected);
  if (have === want) {
    passed += 1;
    console.log(`  ok   ${label} -> ${have}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label} -> ${have}, expected ${want}`);
  }
}

/**
 * A storage that works, built on a Map.
 *
 * WHY IT IS BUILT HERE AND NOT BORROWED FROM A TEST: the reminder reads the
 * bare `localStorage` global, so the test has to put something there that
 * behaves like the browser's, and a shared fake would be a place where two
 * tests quietly disagree about what "storage" means.
 */
function workingStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

/**
 * Put a storage in front of the app, the way a browser would.
 *
 * @param behaviour 'works' | 'blocked' | 'refuses-writes'
 *
 * WHY 'blocked' THROWS ON ACCESS RATHER THAN ON USE: that is the whole
 * point of the case. Safari does not hand out a storage object it is going
 * to refuse — touching the property throws — so a guard that catches an
 * error from `setItem` alone would still let the crash through on the read.
 */
function installStorage(behaviour) {
  if (behaviour === 'works') {
    const storage = workingStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
    return;
  }

  if (behaviour === 'blocked') {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: The operation is insecure.');
      },
      configurable: true,
    });
    return;
  }

  // A storage that reads fine and refuses every write — a spent quota.
  const storage = workingStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => storage.getItem(k),
      removeItem: (k) => storage.removeItem(k),
      setItem: () => {
        throw new Error('QuotaExceededError: The quota has been exceeded.');
      },
    },
    configurable: true,
    writable: true,
  });
}

/**
 * Run a call and say whether it threw.
 *
 * WHY THE ERROR IS CAUGHT HERE RATHER THAN LET OUT: the test's question is
 * "does the app survive this browser", and an uncaught error would take the
 * test process down with it and prove nothing about the app.
 */
function survives(fn) {
  try {
    return { threw: false, value: fn() };
  } catch (err) {
    return { threw: true, message: err instanceof Error ? err.message : String(err) };
  }
}

// The reminder runs in a browser, so the browser globals have to be there.
// Node has no `window`, and the module reads `typeof window` before it
// reads the storage.
globalThis.window = globalThis;

console.log('a browser that refuses to store anything');
{
  installStorage('blocked');

  const reads = survives(() => getReminderEnabled());
  check('reading whether the reminder is on does not throw', reads.threw, false);
  check('and the answer is no', reads.threw ? reads.message : reads.value, false);

  const hour = survives(() => getReminderHour());
  check('reading the hour does not throw', hour.threw, false);
  check('and the answer is the default', hour.threw ? hour.message : hour.value, 21);

  const on = survives(() => setReminderEnabled(true));
  check('turning the reminder on does not throw', on.threw, false);

  const setHour = survives(() => setReminderHour(7));
  check('setting the hour does not throw', setHour.threw, false);

  // The one that matters most: this runs when the app mounts.
  const scheduled = survives(() => scheduleEndOfDayReminder());
  check('scheduling the reminder does not throw', scheduled.threw, false);
}

console.log('\na browser whose storage is full');
{
  installStorage('refuses-writes');

  const on = survives(() => setReminderEnabled(true));
  check('turning the reminder on does not throw', on.threw, false);

  const setHour = survives(() => setReminderHour(7));
  check('setting the hour does not throw', setHour.threw, false);

  const scheduled = survives(() => scheduleEndOfDayReminder());
  check('scheduling the reminder does not throw', scheduled.threw, false);

  const read = survives(() => getReminderEnabled());
  check('and the reminder still reads back', read.threw ? read.message : read.value, false);
}

console.log('\nand a browser that stores normally');
{
  installStorage('works');

  setReminderEnabled(true);
  check('the reminder is on', getReminderEnabled(), true);

  setReminderHour(6);
  check('the hour is what was set', getReminderHour(), 6);

  setReminderEnabled(false);
  check('and it can be turned off', getReminderEnabled(), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
