/**
 * Tests that the backup panel says so when the browser will not store the snapshot.
 *
 * WHY THIS MATTERS
 * The snapshot is a second copy of the household's data, written under its
 * own key. The user asks for it with one tap, and the tap answers with a
 * toast — so that toast is the only account of whether the copy exists.
 *
 * WHAT WAS WRONG
 * The write and the answer came apart. `runBackup` returned null for BOTH
 * "there was nothing worth saving" and "the browser refused the write", and
 * the panel turned that null into one message:
 *
 *     toast(
 *       stamp ? 'Snapshot saved' : 'Nothing to save yet — add some stock first',
 *       stamp ? 'success' : 'info',
 *     );
 *
 * So on a browser whose storage was full or blocked, a household with a
 * full fridge and a stocked grocery list was told it had nothing to save —
 * a statement about the user's own data that was false, and about the one
 * thing the user cannot check for themselves: whether there is a second copy
 * of their data at all.
 *
 * The app's own storage banner does not cover this. The banner is about the
 * app's state failing to be written, under `homehub.v1`. The snapshot is a
 * COPY of that state, written under its own key, and it can fail on its own:
 * a quota that fits the household but not a second copy of it leaves the app
 * perfectly happy and the snapshot missing.
 *
 * WHAT IS TESTED HERE
 * That the rule says what came of the attempt — saved, nothing to save, or
 * the browser refused — and that the PANEL says the true one. The panel is
 * the part the user reads, so a test that only proved the rule would prove a
 * rule the app does not use.
 *
 * Run with:  node scripts/test-backup-not-saved.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
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

/**
 * The browser, as the app sees it.
 *
 * WHY THE ACCESS TO `localStorage` IS NOT ITSELF THROWN: a browser with
 * storage blocked throws when the app READS `window.localStorage`, not only
 * when it writes. The getter that throws is exercised by
 * scripts/test-storage-blocked.mjs; here the storage answers and simply
 * refuses the writes the test asks it to refuse.
 */
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

const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { STORAGE_KEY } = await import('../src/utils/appStorage.ts');
const { runBackup, SNAPSHOT_NOT_SAVED_MESSAGE } = await import('../src/utils/backup.ts');

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
 * The outcome of a snapshot attempt, read without assuming its shape.
 *
 * WHY IT IS NOT ASSUMED: the rule used to answer with a bare stamp or null,
 * so a test that read `.saved` off it CRASHED on the old answer instead of
 * reporting the failure — and a crash takes the rest of the file down with
 * it, so the panel assertions below never ran. That is the same trap the
 * supervisor test fell into and commit 646bbd3 fixed for it. This reads the
 * old answer as what it was — a stamp, or nothing at all — so the failures
 * are REPORTED rather than thrown.
 *
 * @param raw what the rule answered
 * @returns the outcome, in the shape the panel understands
 */
function outcomeOf(raw) {
  if (raw && typeof raw === 'object' && 'saved' in raw) return raw;
  // The old answer: a bare stamp, or null for every kind of failure.
  const stamp = typeof raw === 'string' ? raw : '';
  return { saved: Boolean(stamp), stamp, reason: stamp ? '' : 'unknown' };
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
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

console.log('\nthe rule says what came of the snapshot');
{
  held[STORAGE_KEY] = JSON.stringify(HOUSEHOLD);
  for (const k of snapshots()) delete held[k];

  const saved = outcomeOf(runBackup(true));
  check('a browser that stores it says it saved it', saved.saved, true);
  check('and it names the stamp', saved.saved ? typeof saved.stamp : '', 'string');
  check('and the snapshot is really there', snapshots().length, 1);

  refuseWrites = true;
  const refused = outcomeOf(runBackup(true));
  check('a browser that refuses says it did not', refused.saved, false);
  check(
    'and it says the browser was the reason, not an empty household',
    refused.saved ? '' : refused.reason,
    'storage-refused',
  );
  refuseWrites = false;

  delete held[STORAGE_KEY];
  const empty = outcomeOf(runBackup(true));
  check('a household with nothing in it says there is nothing to save', empty.saved ? '' : empty.reason, 'nothing-to-save');

  held[STORAGE_KEY] = JSON.stringify(HOUSEHOLD);
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The backup panel, built from the real component.
 *
 * WHY IT IS BUILT AND NOT IMPORTED: the panel is a `.tsx`, and node cannot
 * load one. It is bundled with esbuild, rendered, and read.
 *
 * WHY THE STORE IS INSIDE THE BUNDLE AND THE BACKUP MODULE IS OUTSIDE: the
 * store's server snapshot is frozen and empty, so the toast the panel raises
 * cannot be read from it — the snapshot is pointed at the live state
 * instead. The backup module stays outside so the panel and the test share
 * the one instance the test drives, and so the browser that refuses is the
 * browser the panel writes to.
 *
 * WHY THE ENTRY IS A FILE OF ITS OWN: the test needs the store as well as
 * the panel, and it has to be the SAME store the panel uses — the panel
 * reaches it by a relative path and the entry by an absolute one, and
 * esbuild would otherwise keep two of them and the toast would go to a store
 * nobody is reading.
 */
const panelDir = await mkdtemp(path.join(tmpdir(), 'hh-backup-panel-'));
await symlink(path.join(REPO, 'node_modules'), path.join(panelDir, 'node_modules'));

const entry = path.join(panelDir, 'entry.ts');
await writeFile(
  entry,
  [
    `export { BackupPanel } from ${JSON.stringify(path.join(REPO, 'src/components/BackupPanel.tsx'))};`,
    `export { useStore } from ${JSON.stringify(path.join(REPO, 'src/store/useStore.ts'))};`,
    '',
  ].join('\n'),
);

const panelBundle = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom/server', 'lucide-react', 'clsx'],
  plugins: [
    {
      name: 'one-store-one-backup-module',
      setup(b) {
        // The store goes inside this bundle, and the panel and the entry
        // must get the same one.
        b.onResolve({ filter: /^\.\.\/store\/useStore$/ }, () => ({
          path: path.join(REPO, 'src/store/useStore.ts'),
        }));
        // The backup module stays outside, so the panel and the test share
        // the one instance the test drives — the browser that refuses.
        b.onResolve({ filter: /^\.\.\/utils\/backup$/ }, () => ({
          path: pathToFileURL(path.join(REPO, 'src/utils/backup.ts')).href,
          external: true,
        }));
      },
    },
  ],
});

// The server renderer always reads the frozen SSR snapshot, which is built
// from seedState() once and never changes — so the panel would raise its
// toast into a store the test cannot see. Point it at the live state.
const source = panelBundle.outputFiles[0].text;
const patched = source.replace('return SERVER_SNAPSHOT;', 'return getState();');
if (patched === source) {
  console.error("harness: the store's server snapshot hook moved — this test needs updating");
  process.exit(1);
}
const panelFile = path.join(panelDir, 'panel.mjs');
await writeFile(panelFile, patched);
const { BackupPanel, useStore } = await import(pathToFileURL(panelFile).href);

/** Every element in the tree that has a click handler. */
function clickables(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) clickables(child, out);
    return out;
  }
  if (node.props?.onClick) out.push(node);
  clickables(node.props?.children, out);
  return out;
}

/** The visible text of a tree of elements. */
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

console.log('\nand the panel says the true one');
{
  held[STORAGE_KEY] = JSON.stringify(HOUSEHOLD);
  for (const k of snapshots()) delete held[k];

  let tree = null;
  function Capture() {
    tree = BackupPanel();
    return null;
  }
  renderToString(createElement(Capture));

  const button = clickables(tree).find(
    (el) => textOf(el.props.children).trim() === 'Save a snapshot now',
  );
  if (!button) {
    check('the panel offers a snapshot to take', false, true);
  } else {
    check('the panel offers a snapshot to take', true, true);

    // The tap, on a browser that refuses the write.
    refuseWrites = true;
    button.props.onClick();
    refuseWrites = false;

    let toasts = [];
    function CaptureToasts() {
      toasts = useStore().toasts;
      return null;
    }
    renderToString(createElement(CaptureToasts));

    const refusal = toasts.find((t) => t.message === SNAPSHOT_NOT_SAVED_MESSAGE);
    check('a refused snapshot says it was not saved', Boolean(refusal), true);
    check('and it is a warning, not a success', refusal ? refusal.kind : null, 'warning');
    check(
      'and it does NOT say there was nothing to save',
      toasts.some((t) => /nothing to save/i.test(t.message)),
      false,
    );
    check('and no snapshot was written', snapshots().length, 0);

    // The same tap on a browser that stores it still says it saved.
    toasts = [];
    button.props.onClick();
    renderToString(createElement(CaptureToasts));
    check(
      'a snapshot the browser kept says it was saved',
      toasts.some((t) => t.message === 'Snapshot saved' && t.kind === 'success'),
      true,
    );
    check('and the snapshot is there', snapshots().length, 1);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
