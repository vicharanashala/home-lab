/**
 * Tests that a restore is only made when it can be undone.
 *
 * WHY THIS MATTERS
 * The backup panel's own promise is in its first line of comment: "Restore
 * backs up what it is about to overwrite first, so choosing the wrong snapshot
 * is itself reversible rather than a one-way mistake." That promise is kept by
 * ONE line — the pre-restore copy — and the line threw its answer away.
 *
 * WHAT WAS WRONG
 * `restoreBackup` took the pre-restore safety copy and ignored what came of
 * it:
 *
 *     try {
 *       runBackup(true, stamp);
 *       ls.setItem(STATE_KEY, snapshot);
 *       return { ok: true, message: `Restored from ${stamp}` };
 *     } catch {
 *       return { ok: false, message: 'Could not write the restored data — storage may be full.' };
 *     }
 *
 * `runBackup` does not throw when the browser refuses the write — it catches
 * that itself and answers `{ saved: false, reason: 'storage-refused' }`. So
 * the refusal never reached the `catch`, the restore went ahead, and the app
 * said it had restored.
 *
 * WHAT THAT LOOKS LIKE TO THE USER
 * A browser whose quota fits the household but not a second copy of it — which
 * is the ordinary case for a snapshot, because the snapshot is a COPY of the
 * state. The restore overwrites the household, the safety copy was refused, and
 * the only copy of that household is gone:
 *
 *     before   the household holds Onions; the user restores a snapshot
 *              restoreBackup -> { ok: true, message: 'Restored from ...' }
 *              the household now holds Turmeric
 *              the snapshot holding Onions was never written
 *              -> the Onions household cannot be recovered, and nothing said so
 *
 * The panel then reloads the app, so the household the user is looking at is
 * the overwritten one, and the message says it worked.
 *
 * THE FIX
 * The answer the safety copy gives is read, and a browser that refused it stops
 * the restore. The household on the screen is then still the household the user
 * has, and the message says so.
 *
 * WHY ONLY A REFUSAL STOPS THE RESTORE: "nothing to save" means the browser
 * never held a household worth copying, so there is nothing good at risk — and
 * restoring over a household the browser never stored is exactly what a user
 * reaches for a restore to do. Blocking that would make the app refuse to
 * recover the case it is most needed for.
 *
 * WHAT IS TESTED HERE
 * That a restore the browser can make safe stays reversible, that a restore it
 * cannot make safe does not happen and does not claim to have happened, and
 * that the panel raises the rule's message rather than a success.
 *
 * Run with:  node scripts/test-restore-safety-copy.mjs
 */
import { register } from 'node:module';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(REPO, 'node_modules'))) {
  console.error('node_modules is missing — run npm install first');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* A browser with a quota                                                      */
/* -------------------------------------------------------------------------- */

/** What the browser actually holds. */
const held = {};
/** How many bytes the browser will hold. Infinity until a test sets it. */
let budget = Infinity;

/** The bytes the browser is using right now. */
const used = () => Object.values(held).reduce((n, v) => n + String(v).length, 0);

/**
 * The browser, as the app sees it.
 *
 * WHY IT IS A BYTE BUDGET AND NOT A SWITCH: the case that matters is a browser
 * whose quota fits the household but not a SECOND COPY of it — the snapshot is
 * a copy of the state, so that is the ordinary way a quota runs out. A switch
 * that refused every write would not reach the bug, because the restore's own
 * write would fail too and the app would say so.
 *
 * WHY IT COUNTS ONLY THE VALUES: the real quota counts keys as well, but the
 * difference is a few bytes per key and does not change which write fails
 * first — the safety copy, which is a whole extra household.
 */
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in held ? held[k] : null),
    setItem: (k, v) => {
      const already = k in held ? String(held[k]).length : 0;
      if (used() - already + String(v).length > budget) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      held[k] = v;
    },
    removeItem: (k) => { delete held[k]; },
    key: (i) => Object.keys(held)[i] ?? null,
    get length() { return Object.keys(held).length; },
  },
};

const { STORAGE_KEY } = await import('../src/utils/appStorage.ts');
const backupModule = await import('../src/utils/backup.ts');
const { restoreBackup } = backupModule;

/**
 * The message the rule uses when it refuses the restore.
 *
 * WHY IT IS READ OFF THE MODULE AND NOT IMPORTED BY NAME: the message did not
 * exist before the fix, and a named import of a missing export throws while
 * the module is loading — which would take every assertion in this file with
 * it before a single one could be reported. Reading it defensively reports the
 * absence as a failure instead. This is the same trap the supervisor test fell
 * into and 646bbd3 fixed for it.
 */
const RESTORE_MESSAGE =
  typeof backupModule.RESTORE_WITHOUT_SAFETY_COPY_MESSAGE === 'string'
    ? backupModule.RESTORE_WITHOUT_SAFETY_COPY_MESSAGE
    : null;

/** The household as it is NOW — the one a restore would overwrite. */
const HOUSEHOLD = {
  grocery: [
    { id: 'g1', name: 'Onions', quantity: '2', category: 'veg', purchased: false, createdAt: 1 },
  ],
  stock: [{ id: 's1', name: 'Milk', quantity: '1', unit: 'l', createdAt: 1 }],
  mealLogs: [],
  recipes: [],
  settings: { theme: 'system' },
};

/** The household inside the snapshot the user restores. */
const RESTORED = {
  grocery: [
    { id: 'g9', name: 'Turmeric', quantity: '1', category: 'veg', purchased: false, createdAt: 9 },
  ],
  stock: [{ id: 's2', name: 'Rice', quantity: '2', unit: 'kg', createdAt: 9 }],
  mealLogs: [],
  recipes: [],
  settings: { theme: 'system' },
};

const SNAPSHOT_STAMP = '2026-10-20 09:00';
const SNAPSHOT_KEY = `homehub.snapshot.${SNAPSHOT_STAMP}`;

const snapshots = () => Object.keys(held).filter((k) => k.startsWith('homehub.snapshot.'));

/** The name on the household's first grocery item — what the user can see. */
const liveGroceryName = () =>
  held[STORAGE_KEY] ? JSON.parse(held[STORAGE_KEY]).grocery[0].name : null;

/**
 * A browser holding the household and the snapshot, with a quota that has room
 * for everything EXCEPT a second copy of the household.
 *
 * WHY THE BUDGET IS COMPUTED RATHER THAN PICKED: the snapshot the user is
 * restoring and the household on the screen are both already stored, so the
 * quota has to cover them — and then stop one byte short of the copy the
 * restore wants to make.
 */
function fullQuotaBrowser() {
  for (const k of Object.keys(held)) delete held[k];
  held[STORAGE_KEY] = JSON.stringify(HOUSEHOLD);
  held[SNAPSHOT_KEY] = JSON.stringify(RESTORED);
  budget = used() + JSON.stringify(HOUSEHOLD).length - 1;
}

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

/* -------------------------------------------------------------------------- */
/* A restore that can be undone                                                */
/* -------------------------------------------------------------------------- */

console.log('\na restore the browser can make safe is still made');
{
  for (const k of Object.keys(held)) delete held[k];
  budget = Infinity;
  held[STORAGE_KEY] = JSON.stringify(HOUSEHOLD);
  held[SNAPSHOT_KEY] = JSON.stringify(RESTORED);

  const r = restoreBackup(SNAPSHOT_STAMP);

  check('and it says it restored', r.ok, true);
  check('and it names the snapshot', r.message, `Restored from ${SNAPSHOT_STAMP}`);
  check('and the household is the one that was restored', liveGroceryName(), 'Turmeric');

  const recoverable = snapshots().some((k) => held[k] === JSON.stringify(HOUSEHOLD));
  check('and the household it overwrote can be recovered', recoverable, true);
}

/* -------------------------------------------------------------------------- */
/* A restore that cannot be undone                                             */
/* -------------------------------------------------------------------------- */

console.log('\nbut a restore the browser cannot make safe is not made');
{
  fullQuotaBrowser();

  const r = restoreBackup(SNAPSHOT_STAMP);

  check('and it does not claim it restored', r.ok, false);
  check('and the household on the screen is still the household', liveGroceryName(), 'Onions');
  check(
    'and it says the browser was the reason',
    r.message === RESTORE_MESSAGE,
    true,
  );
  check(
    'and it says the data is still here',
    /still here/i.test(r.message),
    true,
  );
  check(
    'and it does NOT claim a restore happened',
    /restored from/i.test(r.message),
    false,
  );
}

/* -------------------------------------------------------------------------- */
/* The case the fix must not block                                             */
/* -------------------------------------------------------------------------- */

console.log('\nand restoring over a household the browser never stored still works');
{
  for (const k of Object.keys(held)) delete held[k];
  held[SNAPSHOT_KEY] = JSON.stringify(RESTORED);
  // Room for the household the restore writes, and nothing more.
  budget = used() + JSON.stringify(RESTORED).length;

  const r = restoreBackup(SNAPSHOT_STAMP);

  check('and it says it restored', r.ok, true);
  check('and the household is the one that was restored', liveGroceryName(), 'Turmeric');
}

/* -------------------------------------------------------------------------- */
/* The panel says the rule's message                                           */
/* -------------------------------------------------------------------------- */

console.log('\nand the panel says the rule\'s message');
{
  // WHY THE SOURCE IS READ: the panel's restore button is only rendered once
  // it has loaded the backup list, and that list is loaded in an effect — which
  // the server renderer this test uses does not run. The wiring is therefore
  // checked against the source that carries it, the same way
  // scripts/test-auto-backup-refusal.mjs checks the app's install of the
  // automatic backup.
  const panelSource = await readFile(path.join(REPO, 'src', 'components', 'BackupPanel.tsx'), 'utf8');
  check(
    'a restore that did not happen raises the rule\'s message',
    /toast\(\s*r\.message\s*,\s*'warning'\s*\)/.test(panelSource),
    true,
  );
  check(
    'and the panel does not announce a restore it did not make',
    /toast\(\s*`?Restored/.test(panelSource),
    false,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
