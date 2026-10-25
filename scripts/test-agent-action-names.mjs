/**
 * Tests that the House Bot changes the row the user actually named.
 *
 * WHY THIS MATTERS
 * The House Bot is the page the owner works from. It applies the model's
 * proposals to the real kitchen — this module is the last gate before it —
 * and it reports what it did: "House Bot updated 1 item". So when it picks
 * the wrong row, the household's data is changed AND the user is told it
 * worked. Nothing in the app can undo that: the wrong row is now the right
 * quantity and the row that was asked about is untouched.
 *
 * WHAT WAS WRONG
 * The name lookup had three rules, and the third one asks whether the name
 * that was said CONTAINS the row's name:
 *
 *     items.find((i) => needle.includes(i.name.trim().toLowerCase()))
 *
 * An empty name is contained in every name there is — `'potatoes'.includes('')`
 * is true. So a row with no name answered to EVERY spoken word, and the
 * first such row won. A row with no name is not an exotic thing: the import
 * checks the shape of a backup file but never the names inside it, so a
 * backup carrying one nameless row puts one in the kitchen.
 *
 * The user said "set the potatoes to two kilos" in a kitchen with no
 * potatoes. The House Bot set the quantity on the nameless row, counted it
 * as applied, and answered " → 2kg". The onions the user did have were not
 * touched. "I bought the tomatoes" ticked a nameless row on the shopping
 * list as bought — and the tomatoes were never on it.
 *
 * The same rule threw on a row whose name was not a string at all. The
 * action's own catch turned that into a skipped action, so one malformed
 * row stopped a perfectly good match from being found.
 *
 * WHAT IS TESTED HERE
 * That a row without a usable name is not a candidate for anything, that it
 * does not shadow the row the user really did name, that a row with a
 * broken name does not break the search, and that the everyday matches —
 * exact, case-folded, and both directions of the contains rule — still work.
 *
 * Run with:  node scripts/test-agent-action-names.mjs
 */
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

register('./lib/ts-resolve.mjs', import.meta.url);

const { applyAgentActions } = await import('../src/utils/agentActions.ts');

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
/* A kitchen, and what the House Bot did to it                                  */
/* -------------------------------------------------------------------------- */

/**
 * A store that records what it was asked to do.
 *
 * WHY A FAKE STORE AND NOT THE REAL ONE: this module is a pure function of
 * the store it is handed, and what is under test is WHICH ROW it picks. The
 * real store is driven further down, where the question of how a nameless
 * row gets into the kitchen at all has to be answered.
 */
function kitchen(stock, grocery) {
  const calls = [];
  return {
    calls,
    stock,
    grocery,
    addStock: (item) => {
      calls.push(['addStock', item.name]);
      return { id: 'added', ...item };
    },
    addGrocery: (item) => {
      calls.push(['addGrocery', item.name]);
      return { id: 'added', ...item };
    },
    toggleGroceryPurchased: (id) => calls.push(['toggleGroceryPurchased', id]),
    updateStock: (id, patch) => calls.push(['updateStock', id, patch]),
  };
}

const row = (id, name, extra = {}) => ({
  id,
  name,
  quantity: 500,
  unit: 'g',
  category: 'vegetables',
  location: 'fridge',
  lowStockThreshold: 0,
  ...extra,
});

/* -------------------------------------------------------------------------- */
/* A row with no name                                                         */
/* -------------------------------------------------------------------------- */

console.log('\nand a row with no name is not a thing anybody can name');
{
  // The kitchen holds one nameless row and the onions. The user talks about
  // the potatoes, which are not there.
  const store = kitchen([row('blank', ''), row('onions', 'Onions')], []);

  const result = applyAgentActions(
    [{ type: 'set_stock_quantity', name: 'Potatoes', quantity: 2 }],
    store,
  );

  check('so nothing is applied', result.applied, 0);
  check('and it is counted as skipped', result.skipped, 1);
  check('and no row is touched', result.touchedStockIds, []);
  check('and nothing was written', store.calls, []);
  check('and the summary does not claim it worked', result.summary, '');
}

console.log('\nand a nameless row on the shopping list is not ticked as bought');
{
  const store = kitchen([], [{ id: 'gblank', name: '', purchased: false }]);

  const result = applyAgentActions([{ type: 'check_grocery', name: 'Tomatoes' }], store);

  check('so nothing is applied', result.applied, 0);
  check('and it is counted as skipped', result.skipped, 1);
  check('and no row is touched', result.touchedGroceryIds, []);
  check('and nothing was written', store.calls, []);
  check('and the summary does not claim it worked', result.summary, '');
}

console.log('\nand a nameless row does not shadow the row that was named');
{
  // The nameless row is FIRST, so it would win any search that allowed it.
  const store = kitchen([row('blank', ''), row('onions', 'Onions')], []);

  const result = applyAgentActions(
    [{ type: 'set_stock_quantity', name: 'Onions', quantity: 2 }],
    store,
  );

  check('the onions are the row that changes', result.touchedStockIds, ['onions']);
  check('and it is counted as applied', result.applied, 1);
  check(
    'and the onions are the ones that were written',
    store.calls,
    [['updateStock', 'onions', { quantity: 2 }]],
  );
}

console.log('\nand a row whose name is not a name does not break the search');
{
  // A backup file is only checked for shape, so a name that is not a string
  // can reach the kitchen. It used to throw on `.trim()`, and the action's
  // own catch turned that into a skipped action.
  const store = kitchen(
    [row('broken', null), row('onions', 'Onions')],
    [{ id: 'gbroken', name: null, purchased: false }, { id: 'gonions', name: 'Onions', purchased: false }],
  );

  const stock = applyAgentActions(
    [{ type: 'set_stock_quantity', name: 'Onions', quantity: 2 }],
    store,
  );
  check('the onions are still found', stock.touchedStockIds, ['onions']);
  check('and the action still applies', stock.applied, 1);

  const grocery = applyAgentActions([{ type: 'check_grocery', name: 'Onions' }], store);
  check('and the shopping list still answers', grocery.touchedGroceryIds, ['gonions']);
  check('and that action applies too', grocery.applied, 1);
}

/* -------------------------------------------------------------------------- */
/* The everyday matches                                                        */
/* -------------------------------------------------------------------------- */

console.log('\nand the everyday matches still work');
{
  // Each rule is tried on its own, because the rules are tried in order: a
  // row whose name IS the spoken name wins over a row that merely holds it,
  // and over a row the spoken name holds.
  const exact = kitchen([row('onions', 'Onions')], []);
  check(
    'the same name finds the same row',
    applyAgentActions([{ type: 'set_stock_quantity', name: 'Onions', quantity: 1 }], exact)
      .touchedStockIds,
    ['onions'],
  );
  check(
    'the case does not matter',
    applyAgentActions([{ type: 'set_stock_quantity', name: 'oNiOnS', quantity: 1 }], exact)
      .touchedStockIds,
    ['onions'],
  );

  const holds = kitchen([row('red', 'Red Onions')], []);
  check(
    'a name the row holds finds the row',
    applyAgentActions([{ type: 'set_stock_quantity', name: 'onion', quantity: 1 }], holds)
      .touchedStockIds,
    ['red'],
  );

  const held = kitchen([row('onion', 'Onion')], []);
  check(
    'a row whose name the spoken name holds still finds the row',
    applyAgentActions([{ type: 'set_stock_quantity', name: 'onions', quantity: 1 }], held)
      .touchedStockIds,
    ['onion'],
  );

  const none = kitchen([row('onions', 'Onions')], []);
  check(
    'and a name that is not there is skipped',
    applyAgentActions([{ type: 'set_stock_quantity', name: 'Potatoes', quantity: 1 }], none)
      .skipped,
    1,
  );
}

/* -------------------------------------------------------------------------- */
/* How such a row gets into the kitchen                                        */
/* -------------------------------------------------------------------------- */

console.log('\nand this is how a nameless row gets into the kitchen');
{
  // WHY THE IMPORT IS DRIVEN FOR REAL: the whole finding rests on a nameless
  // row being possible at all. If the import refused those files, the search
  // would never see one and the guard above would be defending against
  // nothing. The import checks the SHAPE of the file — that it says it is a
  // HomeHub backup, that its sections are there — and never the names inside.
  const held = {};
  globalThis.window = {
    localStorage: {
      getItem: (k) => (k in held ? held[k] : null),
      setItem: (k, v) => {
        held[k] = String(v);
      },
      removeItem: (k) => {
        delete held[k];
      },
    },
  };

  const { useStore, exportAppData } = await import('../src/store/useStore.ts');

  let snap = null;
  function Probe() {
    snap = useStore();
    return null;
  }
  const refresh = () => {
    renderToString(createElement(Probe));
    return snap;
  };
  // The hook's own snapshot is the frozen server one, so the household is
  // read the way the app reads it — out of the export.
  const household = () => JSON.parse(exportAppData()).data;

  const backup = JSON.stringify({
    app: 'homehub',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      grocery: [{ id: 'g1', name: 'Onions', quantity: '2 kg', category: 'vegetables', purchased: false, createdAt: 1 }],
      stock: [
        { id: 's1', name: 'Milk', quantity: 1, unit: 'l', category: 'dairy', location: 'fridge', lowStockThreshold: 0, createdAt: 1, updatedAt: 1 },
        { id: 's2', name: '', quantity: 3, unit: 'kg', category: 'grains', location: 'pantry', lowStockThreshold: 0, createdAt: 1, updatedAt: 1 },
      ],
      mealLogs: [],
      recipes: [],
      settings: { theme: 'system' },
    },
  });

  const imported = refresh().importAppData(backup);
  check('a backup with a nameless row is accepted', imported.ok, true);
  check('and the nameless row is in the fridge', household().stock.length, 2);
  check(
    'with nothing to call it by',
    household().stock.filter((s) => s.name.trim().length === 0).length,
    1,
  );

  // And with that row sitting in the real kitchen, the House Bot still will
  // not touch it.
  const result = applyAgentActions(
    [{ type: 'set_stock_quantity', name: 'Potatoes', quantity: 2 }],
    { ...refresh(), stock: household().stock, grocery: household().grocery },
  );
  check('the nameless row is left alone', result.touchedStockIds, []);
  check('and the user is told nothing was changed', result.applied, 0);
  check('and the nameless row still has its quantity', household().stock.find((s) => s.id === 's2').quantity, 3);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
