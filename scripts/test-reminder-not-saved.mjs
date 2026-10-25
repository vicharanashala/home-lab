/**
 * Tests that the end-of-day reminder says so when the browser will not store it.
 *
 * WHY THIS MATTERS
 * The reminder is a preference, and a preference the browser refuses to store
 * is a preference that is not there. The Settings screen used to write it and
 * then report success without ever asking whether the write happened:
 *
 *     setReminderEnabled(true);
 *     setReminderEnabledLocal(true);
 *     toast(`Daily reminder set for ${reminderHour}:00`, 'success');
 *
 * The write was swallowed inside the reminder module, so on a browser that
 * refuses to store anything the user was told three things that were false:
 *
 *     the toast said the reminder was set
 *     the switch showed "Daily reminder ON"
 *     the reminder was not scheduled — the module schedules from what the
 *       STORAGE says, and the storage never got the value
 *
 * and after a reload the switch was off again, with nothing said at any point.
 *
 * This is the same class of defect the app's own storage banner was built for
 * (see `appStorage`): a change the app shows and then forgets. The banner
 * covers the app's own state; the reminder preference lives outside that
 * state, so it has to answer for itself.
 *
 * WHAT IS TESTED HERE
 * That the reminder module tells the caller whether the browser kept the
 * preference, that a refused write leaves the stored preference untouched, and
 * that the message the user reads says the change was not saved.
 *
 * Run with:  node scripts/test-reminder-not-saved.mjs
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
  REMINDER_NOT_SAVED_MESSAGE,
  REMINDER_NOT_TURNED_OFF_MESSAGE,
  REMINDER_HOUR_NOT_SAVED_MESSAGE,
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
 * What the browser holds.
 *
 * WHY IT IS ONE MAP FOR EVERY BEHAVIOUR: the behaviour is the browser's
 * ANSWER to a write, not the browser's MEMORY. A storage that starts working
 * again has to find the values that were there before it started refusing
 * them, or the test would be checking a browser that quietly forgot
 * everything — which is a different defect, and would hide this one.
 */
const held = new Map();

/**
 * Put a storage in front of the app, the way a browser would.
 *
 * @param behaviour 'works' | 'blocked' | 'refuses-writes'
 */
function installStorage(behaviour) {
  if (behaviour === 'works') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => (held.has(k) ? held.get(k) : null),
        setItem: (k, v) => void held.set(k, String(v)),
        removeItem: (k) => void held.delete(k),
      },
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
  //
  // WHY REMOVAL IS REFUSED TOO: turning the reminder OFF is a write as much
  // as turning it on, and a browser that refuses writes refuses both. If the
  // fake removed the key anyway, the test would be checking a browser that
  // gives up on new values but still lets the old ones go — which is not a
  // browser, and would hide the lie the test is here to catch.
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (held.has(k) ? held.get(k) : null),
      removeItem: () => {
        throw new Error('QuotaExceededError: The quota has been exceeded.');
      },
      setItem: () => {
        throw new Error('QuotaExceededError: The quota has been exceeded.');
      },
    },
    configurable: true,
    writable: true,
  });
}

// The reminder runs in a browser, so the browser globals have to be there.
globalThis.window = globalThis;

console.log('a browser that stores normally');
{
  installStorage('works');

  check('turning the reminder on says it was kept', setReminderEnabled(true), true);
  check('and the reminder is on', getReminderEnabled(), true);

  check('setting the hour says it was kept', setReminderHour(6), true);
  check('and the hour is what was set', getReminderHour(), 6);

  check('turning the reminder off says it was kept', setReminderEnabled(false), true);
  check('and the reminder is off', getReminderEnabled(), false);
}

console.log('\nand a browser whose storage is full');
{
  installStorage('refuses-writes');

  check('turning the reminder on says it was NOT kept', setReminderEnabled(true), false);
  check('and the reminder is not on', getReminderEnabled(), false);

  check('setting the hour says it was NOT kept', setReminderHour(6), false);
  check('and the hour is the one that was already there', getReminderHour(), 6);

  // Turning it OFF is the other direction of the same lie: a refused write
  // leaves the reminder ON in storage while the screen says it is off.
  installStorage('works');
  setReminderEnabled(true);
  setReminderHour(9);
  installStorage('refuses-writes');
  check('turning the reminder off says it was NOT kept', setReminderEnabled(false), false);
  check('and the reminder is still on, because nothing was removed', getReminderEnabled(), true);
  check('and the hour is untouched', getReminderHour(), 9);
}

console.log('\nand a browser that refuses storage altogether');
{
  installStorage('blocked');

  check('turning the reminder on says it was NOT kept', setReminderEnabled(true), false);
  check('setting the hour says it was NOT kept', setReminderHour(6), false);
}

console.log('\nand what the user is told');
{
  check('the reminder message says it was not saved', /not saved/i.test(REMINDER_NOT_SAVED_MESSAGE ?? ''), true);
  check('and that the browser refused it', /browser refused/i.test(REMINDER_NOT_SAVED_MESSAGE ?? ''), true);
  check('and that the reminder is still off', /still off/i.test(REMINDER_NOT_SAVED_MESSAGE ?? ''), true);

  check('the turned-off message says it was not turned off', /not turned off/i.test(REMINDER_NOT_TURNED_OFF_MESSAGE ?? ''), true);
  check('and that the reminder is still on', /still on/i.test(REMINDER_NOT_TURNED_OFF_MESSAGE ?? ''), true);

  check('the hour message says it was not saved', /not saved/i.test(REMINDER_HOUR_NOT_SAVED_MESSAGE ?? ''), true);
  check('and that the old time is still in use', /old time/i.test(REMINDER_HOUR_NOT_SAVED_MESSAGE ?? ''), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
