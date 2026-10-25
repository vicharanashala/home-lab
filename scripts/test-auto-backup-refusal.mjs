/**
 * Tests that the AUTOMATIC snapshot says so when the browser will not store it.
 *
 * WHY THIS MATTERS
 * The rolling snapshot is the safety net the app promises: "Keep a rolling
 * local backup so a cleared browser never costs the lot" (App.tsx). It is taken
 * on a timer and every time the app is hidden — so it is the path that runs,
 * and the manual button in the backup panel is the rare one.
 *
 * WHAT WAS WRONG
 * commit c4fc7a0 taught `runBackup` to say what came of the attempt —
 * saved, nothing to save, not due, or the browser refused — and taught the
 * PANEL to say the true one. But the automatic path dropped the answer on the
 * floor:
 *
 *     export function installAutoBackup(): () => void {
 *       runBackup();
 *       const timer = setInterval(() => runBackup(), 30 * 60 * 1000);
 *       ...
 *
 * So on a browser that refuses the write, the household had a safety net that
 * did not exist, and nothing anywhere said so. The panel's fix made the RARE
 * path honest and left the COMMON one silent, which is the wrong way round.
 *
 * WHY THE USER IS TOLD ONLY ONCE WHILE THE REFUSAL LASTS: the backup runs
 * every 30 minutes and every time the app is hidden, so a refusal reported
 * every time would be the same toast over and over. It is reported when it is
 * NEW — and again only after a backup that worked — which is the rule the
 * storage banner already follows.
 *
 * WHAT IS TESTED HERE
 * That the automatic path reports a refusal at all, that it does NOT report
 * the ordinary outcomes (a backup that worked, a household with nothing in
 * it), that the toast it raises is the one the panel raises and that it is a
 * warning and not a success, and that the app installs the reporter at all —
 * a rule the app does not use proves nothing.
 *
 * Run with:  node scripts/test-auto-backup-refusal.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
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
/* A browser that holds the household's data                                     */
/* -------------------------------------------------------------------------- */

/** What the browser actually holds. */
const held = {};
/** Whether the next write is refused, the way a blocked or a full one is. */
let refuseWrites = false;

globalThis.window = {
  localStorage: {
    getItem: (k) => (k in held ? held[k] : null),
    setItem: (k, v) => {
      if (refuseWrites) {
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

/* -------------------------------------------------------------------------- */
/* A document, so the automatic backup can listen to it                         */
/* -------------------------------------------------------------------------- */

/**
 * WHY THE DOCUMENT IS FAKE AND NOT ABSENT: the automatic backup listens for
 * `visibilitychange` and writes when the app is hidden, which is how it runs
 * in practice. A test that could not hide the app would never reach that
 * path.
 */
const documentListeners = {};

globalThis.document = {
  visibilityState: 'visible',
  addEventListener: (type, fn) => {
    (documentListeners[type] ||= []).push(fn);
  },
  removeEventListener: (type, fn) => {
    documentListeners[type] = (documentListeners[type] || []).filter((f) => f !== fn);
  },
};

/** Hide the app, the way a user switching away does. */
function hideApp() {
  globalThis.document.visibilityState = 'hidden';
  for (const fn of documentListeners.visibilitychange || []) fn();
  globalThis.document.visibilityState = 'visible';
}

const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { STORAGE_KEY } = await import('../src/utils/appStorage.ts');
const backupModule = await import('../src/utils/backup.ts');

const { installAutoBackup, SNAPSHOT_NOT_SAVED_MESSAGE } = backupModule;

/**
 * The reporter the app installs, when it has one.
 *
 * WHY IT IS READ THIS WAY: the reporter is what turns a refused write into
 * something the user reads, and on the old code it did not exist. A test that
 * CALLED it would crash on the old code and take every other assertion in
 * this file with it — the same trap the supervisor test fell into and
 * 646bbd3 fixed for it. This reports the absence as a failure instead.
 */
const snapshotRefusalReporter =
  typeof backupModule.snapshotRefusalReporter === 'function'
    ? backupModule.snapshotRefusalReporter
    : null;

/** A household with a stocked fridge — so "nothing to save" would be a lie. */
const HOUSEHOLD = {
  grocery: [
    { id: 'g1', name: 'Onions', quantity: '2', category: 'veg', purchased: false, createdAt: 1 },
  ],
  stock: [{ id: 's1', name: 'Milk', quantity: '1', unit: 'l', createdAt: 1 }],
  mealLogs: [],
  recipes: [],
  settings: { theme: 'system' },
};

const snapshots = () => Object.keys(held).filter((k) => k.startsWith('homehub.snapshot.'));

/**
 * A browser that has never taken a snapshot.
 *
 * WHY THE "LAST RUN" MARKER IS CLEARED TOO: the automatic backup is not due
 * again for 12 hours after a snapshot, so a marker left behind by an earlier
 * section would make the next section's backup skip — and the section would
 * be testing the skip rather than what it means to test.
 */
function resetBrowser(withHousehold = true) {
  for (const k of snapshots()) delete held[k];
  delete held['homehub.lastRunAt'];
  if (withHousehold) {
    held[STORAGE_KEY] = JSON.stringify(HOUSEHOLD);
  } else {
    delete held[STORAGE_KEY];
  }
}

/**
 * Forget that the last automatic backup was refused.
 *
 * WHY IT IS DONE EXPLICITLY: the app remembers a refusal so that one it keeps
 * meeting is reported once. That memory outlives a section of this test, so a
 * section that expects a report has to start from a known state — and a
 * successful backup is what clears it.
 */
function clearRefusalMemory() {
  refuseWrites = false;
  resetBrowser();
  const stop = installAutoBackup(() => {});
  stop();
  resetBrowser();
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
/* The store, so the toast the user reads can be read                            */
/* -------------------------------------------------------------------------- */

/**
 * The store, built from the real module.
 *
 * WHY IT IS BUILT AND NOT IMPORTED: the store is a `.tsx`-adjacent module with
 * JSX-free but bundler-resolved imports, and the toast the app raises has to
 * be the ONE toast the app raises — two copies of the store would be two
 * different sets of toasts, and the test would read the wrong one.
 *
 * WHY THE SERVER SNAPSHOT IS PATCHED: the server renderer always reads the
 * frozen SSR snapshot, which never changes, so the toast the app raises would
 * go to a store this test cannot see. Point it at the live state, which is the
 * same patch scripts/test-backup-not-saved.mjs uses.
 */
const storeDir = await mkdtemp(path.join(tmpdir(), 'hh-auto-backup-store-'));
await symlink(path.join(REPO, 'node_modules'), path.join(storeDir, 'node_modules'));

const entry = path.join(storeDir, 'entry.ts');
await writeFile(
  entry,
  [
    `export { useStore } from ${JSON.stringify(path.join(REPO, 'src/store/useStore.ts'))};`,
    '',
  ].join('\n'),
);

const storeBundle = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom/server', 'lucide-react', 'clsx'],
});

const storeSource = storeBundle.outputFiles[0].text;
const patchedStore = storeSource.replace('return SERVER_SNAPSHOT;', 'return getState();');
if (patchedStore === storeSource) {
  console.error("harness: the store's server snapshot hook moved — this test needs updating");
  process.exit(1);
}
const storeFile = path.join(storeDir, 'store.mjs');
await writeFile(storeFile, patchedStore);
const { useStore } = await import(pathToFileURL(storeFile).href);

/** The store's toast, and the toasts it is holding, read from the live state. */
function storeNow() {
  let snap = null;
  function Capture() {
    snap = useStore();
    return null;
  }
  renderToString(createElement(Capture));
  return snap;
}

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

console.log('\nthe automatic snapshot says so when the browser refuses it');
{
  clearRefusalMemory();

  const reported = [];
  refuseWrites = true;
  const stop = installAutoBackup((outcome) => reported.push(outcome));

  check('a browser that refuses is reported', reported.length, 1);
  check(
    'and it is reported as a refusal, not as an empty household',
    reported.length ? reported[0].reason : 'nothing-reported',
    'storage-refused',
  );
  check('and no snapshot was written', snapshots().length, 0);

  // React's StrictMode mounts the app's effect twice in development, so the
  // automatic backup is installed twice. One refusal is still one refusal.
  const secondInstall = [];
  const stopSecond = installAutoBackup((outcome) => secondInstall.push(outcome));
  check('a second installation does not report it again', secondInstall.length, 0);
  stopSecond();

  // The automatic backup runs on a timer and every time the app is hidden.
  // A refusal that lasts must not turn into the same toast over and over.
  hideApp();
  check('a refusal that lasts is not reported again and again', reported.length, 1);

  // A backup that works clears the refusal, so the next one is news again.
  //
  // WHY THE "LAST RUN" MARKER IS CLEARED: a backup that worked stamps the
  // time it ran, and the automatic backup is not due again for 12 hours after
  // it — so it would not even attempt a write, and there would be nothing to
  // report. Clearing the marker stands in for those 12 hours passing.
  refuseWrites = false;
  hideApp();
  delete held['homehub.lastRunAt'];
  refuseWrites = true;
  hideApp();
  check('and it is reported again once a backup worked in between', reported.length, 2);

  stop();
}

/* -------------------------------------------------------------------------- */
/* The ordinary outcomes are not reported                                      */
/* -------------------------------------------------------------------------- */

console.log('\nand the ordinary outcomes are not reported');
{
  resetBrowser();
  refuseWrites = false;

  const reported = [];
  const stop = installAutoBackup((outcome) => reported.push(outcome));
  check('a browser that stores it is not reported', reported.length, 0);
  check('and the snapshot is really there', snapshots().length, 1);
  stop();

  // A household with nothing in it has nothing to save — that is not a
  // refusal and must not be dressed as one.
  resetBrowser(false);
  const emptyReported = [];
  const stopEmpty = installAutoBackup((outcome) => emptyReported.push(outcome));
  check('a household with nothing in it is not reported', emptyReported.length, 0);
  stopEmpty();

  resetBrowser();
}

/* -------------------------------------------------------------------------- */
/* What the user is told                                                       */
/* -------------------------------------------------------------------------- */

console.log('\nand the user is told the same thing the panel tells them');
{
  if (!snapshotRefusalReporter) {
    check('the app has a reporter for a refused snapshot', false, true);
    check('and it raises the panel\'s message', false, true);
    check('and it is a warning, not a success', false, true);
  } else {
    const said = [];
    const report = snapshotRefusalReporter((message, kind) => said.push({ message, kind }));

    report({ saved: false, reason: 'storage-refused' });
    check('a refused snapshot raises one message', said.length, 1);
    check('and it is the panel\'s message', said.length ? said[0].message : '', SNAPSHOT_NOT_SAVED_MESSAGE);
    check('and it is a warning, not a success', said.length ? said[0].kind : null, 'warning');

    said.length = 0;
    report({ saved: true, stamp: '2026-10-25 10:00' });
    report({ saved: false, reason: 'not-due' });
    report({ saved: false, reason: 'nothing-to-save' });
    check('and the ordinary outcomes raise nothing', said.length, 0);
  }
}

/* -------------------------------------------------------------------------- */
/* End to end — the app's own reporter, into the app's own store                */
/* -------------------------------------------------------------------------- */

console.log('\nand the app raises it in the store the user is looking at');
{
  if (!snapshotRefusalReporter) {
    check('a refused automatic snapshot reaches the user\'s toasts', false, true);
  } else {
    const { toast } = storeNow();
    clearRefusalMemory();

    refuseWrites = true;
    const stop = installAutoBackup(snapshotRefusalReporter(toast));
    const toasts = storeNow().toasts;

    const refusal = toasts.find((t) => t.message === SNAPSHOT_NOT_SAVED_MESSAGE);
    check('a refused automatic snapshot reaches the user\'s toasts', Boolean(refusal), true);
    check('and it is a warning, not a success', refusal ? refusal.kind : null, 'warning');
    check(
      'and it does NOT say there was nothing to save',
      toasts.some((t) => /nothing to save/i.test(t.message)),
      false,
    );
    stop();
    refuseWrites = false;
  }
}

/* -------------------------------------------------------------------------- */
/* The app installs it                                                          */
/* -------------------------------------------------------------------------- */

console.log('\nand the app installs the reporter at all');
{
  // WHY THE SOURCE IS READ: the reporter is a rule, and a rule the app does
  // not use proves nothing. The automatic backup is installed from an effect
  // in App.tsx, and an effect cannot be run by the server renderer this test
  // uses — so the wiring is checked against the source that carries it.
  const appSource = await readFile(path.join(REPO, 'src', 'App.tsx'), 'utf8');
  check(
    'the app installs the automatic backup with the refusal reporter',
    /installAutoBackup\(\s*snapshotRefusalReporter\(toast\)\s*\)/.test(appSource),
    true,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
