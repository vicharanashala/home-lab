/**
 * Tests that two tabs of the app agree about the shopping list.
 *
 * WHY TWO TABS ARE THE NORMAL CASE NOW
 *
 * The Digital stores page holds the screen share and shows the shopping list
 * beside it. House Bot is opened in a tab of its own — that is the only way
 * to ask the bot about the screen without ending the share — so the two tabs
 * of the same app are open at the same time, side by side, and the person
 * moves between them.
 *
 * The app's state is one localStorage key. Every tab keeps its own copy of
 * it in memory and writes the WHOLE copy back when the person changes
 * something. A tab that has not heard what another tab wrote therefore
 * writes a stale copy over the top.
 *
 * WHAT WENT WRONG
 *
 *   tab A (the stores page)   list: Bread, Eggs
 *   tab B (House Bot)         list: Bread, Eggs
 *
 *   House Bot offers "milk" and the person adds it:
 *
 *   tab B                     list: Milk, Bread, Eggs      (written)
 *   tab A                     list: Bread, Eggs            (not told)
 *
 *   The person goes back to the stores page and ticks Bread off:
 *
 *   tab A writes its own list: Bread (ticked), Eggs
 *
 *   Milk is gone. It was added two seconds earlier, by the app, and it was
 *   never on the screen the person was looking at when it disappeared —
 *   the list the stores page showed did not have it in the first place.
 *
 * So the item was not deleted by anything the person did. It was deleted by
 * a tab writing a copy of the household's list that was already out of date.
 *
 * WHAT IS TESTED HERE
 *
 * That a tab which did not write is told what another tab wrote, and that
 * the list it then writes is the list the person can see.
 *
 * Run with:  node scripts/test-store-two-tabs.mjs
 */
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

register('./lib/ts-resolve.mjs', import.meta.url);

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

/* -------------------------------------------------------------------------- */
/* A browser with two tabs on it                                              */
/* -------------------------------------------------------------------------- */

/** What the browser actually holds. The two tabs share it, as tabs do. */
const backing = {};

/** The tabs listening for writes. Each entry belongs to one tab. */
const storageListeners = new Set();

/** How many writes the browser has been asked to do. */
let writes = 0;

/**
 * Make the window one tab sees.
 *
 * WHY EACH TAB HAS ITS OWN WINDOW AND ITS OWN VIEW OF THE STORAGE: the
 * storage is shared, but the browser does not tell a tab about its OWN
 * writes — it tells the OTHER tabs. A window that shares the storage with
 * its neighbour but not the events is the shape of the thing being tested.
 *
 * @param owner which tab this window belongs to
 */
function makeWindow(owner) {
  return {
    localStorage: {
      getItem: (k) => (k in backing ? backing[k] : null),
      setItem: (k, v) => {
        writes += 1;
        const oldValue = k in backing ? backing[k] : null;
        backing[k] = String(v);
        // The browser tells every tab of the origin EXCEPT the one that
        // wrote. That is the whole reason a tab can trust what it hears.
        for (const entry of [...storageListeners]) {
          if (entry.owner === owner) continue;
          entry.fn({ key: k, oldValue, newValue: String(v) });
        }
      },
      removeItem: (k) => {
        delete backing[k];
      },
    },
    addEventListener: (type, fn) => {
      if (type === 'storage') storageListeners.add({ owner, fn });
    },
    removeEventListener: (type, fn) => {
      for (const entry of [...storageListeners]) {
        if (entry.owner === owner && entry.fn === fn) storageListeners.delete(entry);
      }
    },
  };
}

const windowA = makeWindow('a');
const windowB = makeWindow('b');

/* -------------------------------------------------------------------------- */
/* Just enough React to mount the store's hook                                */
/* -------------------------------------------------------------------------- */

import React from 'react';

const dispatcherSlot =
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;

function mountHook(render) {
  const slots = [];
  let cursor = 0;
  let mounted = null;

  const dispatcher = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { state: typeof initial === 'function' ? initial() : initial };
      }
      const slot = slots[index];
      return [
        slot.state,
        (next) => {
          const resolved = typeof next === 'function' ? next(slot.state) : next;
          if (Object.is(resolved, slot.state)) return;
          slot.state = resolved;
          paint();
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(fn) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { fn };
      return slots[index].fn;
    },
    useEffect() {
      /* not needed here */
    },
    useMemo(fn) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: fn() };
      return slots[index].value;
    },
    /**
     * The store's hook reads its state through this. The real one re-reads
     * the snapshot whenever the store changes, and so does this.
     */
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { unsubscribe: subscribe(() => paint()) };
      }
      return getSnapshot();
    },
    useContext() {
      return null;
    },
  };

  function paint() {
    cursor = 0;
    dispatcherSlot.current = dispatcher;
    try {
      mounted = render();
    } finally {
      dispatcherSlot.current = null;
    }
  }
  paint();
  return {
    get value() {
      return mounted;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Two tabs, two copies of the store                                           */
/* -------------------------------------------------------------------------- */

// The same module, imported twice. Each import is its own copy of the app's
// state — which is exactly what a second tab of the app is.
const storeUrl = pathToFileURL(path.join(REPO, 'src/store/useStore.ts')).href;

globalThis.window = windowA;
const tabA = await import(storeUrl + '?tab=a');
globalThis.window = windowB;
const tabB = await import(storeUrl + '?tab=b');

const a = mountHook(() => tabA.useStore());
const b = mountHook(() => tabB.useStore());

/** Run something as the tab that owns the given window. */
function as(window, fn) {
  globalThis.window = window;
  try {
    return fn();
  } finally {
    globalThis.window = windowA;
  }
}

const storedNames = () =>
  JSON.parse(backing['homehub.v1'] ?? '{"grocery":[]}').grocery.map((g) => g.name);

console.log('\nthe shopping list agrees between two tabs');
{
  // The stores page, with the list beside the store.
  as(windowA, () => {
    a.value.addGrocery({ name: 'Bread', quantity: '1', category: 'bakery' });
    a.value.addGrocery({ name: 'Eggs', quantity: '6', category: 'dairy' });
  });
  ok(storedNames().includes('Bread'), 'the stores page has Bread on the list');

  // House Bot, in a tab of its own, adds a third thing.
  as(windowB, () => {
    b.value.addGrocery({ name: 'Milk', quantity: '1', category: 'dairy' });
  });
  ok(storedNames().includes('Milk'), 'House Bot added Milk to the list');

  // THE TAB THAT DID NOT WRITE IS TOLD.
  ok(
    a.value.grocery.some((g) => g.name === 'Milk'),
    'THE STORES PAGE IS TOLD ABOUT THE MILK',
    `its list: ${a.value.grocery.map((g) => g.name).join(', ')}`,
  );

  // The person goes back to the stores page and ticks Bread off.
  const bread = a.value.grocery.find((g) => g.name === 'Bread');
  as(windowA, () => a.value.toggleGroceryPurchased(bread.id));

  ok(
    storedNames().includes('Milk'),
    'AND THE MILK IS STILL THERE AFTERWARDS',
    `the list is now: ${storedNames().join(', ')}`,
  );
}

console.log('\nthe tabs do not write to each other for ever');
{
  const before = writes;
  as(windowA, () => a.value.addGrocery({ name: 'Butter', quantity: '1', category: 'dairy' }));
  ok(
    writes - before <= 2,
    'one change is one write, not a conversation between the tabs',
    `${writes - before} writes for one change`,
  );
}

console.log('\na change in one tab reaches the other');
{
  as(windowB, () => b.value.addGrocery({ name: 'Cheese', quantity: '1', category: 'dairy' }));
  ok(
    a.value.grocery.some((g) => g.name === 'Cheese'),
    'THE STORES PAGE IS TOLD WHAT HOUSE BOT ADDED',
    `its list: ${a.value.grocery.map((g) => g.name).join(', ')}`,
  );
}

console.log('\nonly the household\'s own key is the household');
{
  // The app writes other keys in this origin — the snapshot backups, the food
  // trainer's examples, the end-of-day reminder's flags. A write to one of
  // those is not a change to the household.
  as(windowB, () => {
    windowB.localStorage.setItem(
      'homehub.snapshot.2026-10-27',
      JSON.stringify({
        grocery: [{ id: 'x', name: 'WRONG HOUSEHOLD', quantity: '1', category: 'dairy', purchased: false, createdAt: 0 }],
        stock: [],
        settings: {},
      }),
    );
  });
  ok(
    !a.value.grocery.some((g) => g.name === 'WRONG HOUSEHOLD'),
    'A BACKUP UNDER ANOTHER KEY IS NOT TAKEN FOR THE HOUSEHOLD',
    `its list: ${a.value.grocery.map((g) => g.name).join(', ')}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
