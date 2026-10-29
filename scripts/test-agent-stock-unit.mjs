/**
 * The House Bot writes the unit the household said.
 *
 * THE BUG
 *
 * The House Bot puts things on the SHELF from an action the model proposed,
 * and the unit on that action is free text — the bridge tells the model it
 * may write "pcs|kg|g|ml|L|packets|dozen". Both gates that carry the action
 * then held a list of their own, and a unit that was not on the list was
 * silently REWRITTEN to "pcs":
 *
 *     "bridge/shift /index.mjs"
 *       `const ACTION_UNITS = new Set(['pcs', 'kg', 'g', 'ml', 'l', 'packets', 'dozen']);`
 *
 *     "src/utils/agentActions.ts"
 *       `const UNITS = new Set<string>(['pcs', 'kg', 'g', 'ml', 'l', 'packets', 'dozen']);`
 *
 * so:
 *
 *     the model wrote   {"type":"add_stock","name":"Milk","quantity":2,"unit":"bottles"}
 *     the shelf held   "2 pcs Milk"
 *
 * while the model's own message — which the household reads VERBATIM — said
 * "Added 2 bottles of milk". Nothing on the screen said the unit had been
 * changed.
 *
 * WHY "BOTTLES" IS NOT AN EXOTIC WORD: the app's own stock form offers it.
 * The Add Stock form and the Edit Stock form both list "bunch" and
 * "bottles", and the camera recognizer writes "bunch" and "pack" onto a
 * row. So the app itself can put those units on a shelf, and the House Bot
 * could not.
 *
 * WHY IT IS THE SAME SHAPE AS THE QUANTITY: the quantity the model wrote
 * used to be thrown away and replaced with "1" — see
 * scripts/test-agent-quantity.mjs, and the fix in commit 343c78f. This is
 * the same defect one field over: a field the model wrote was replaced with
 * a guess, and the bot's own sentence was the only thing that disagreed.
 *
 * WHAT IS TESTED HERE
 *
 *   - the BRIDGE'S OWN VALIDATION, run from the shipped source, so the unit
 *     the model wrote is the unit the bridge carries;
 *   - the CLIENT'S OWN LAST GATE, driven through the real
 *     `applyAgentActions`, so the unit is the unit on the shelf;
 *   - the WHOLE CHAIN — the bridge's own answer handed to the client — and
 *     the shelf read back, because each gate alone would pass while the
 *     other one quietly rewrote the unit;
 *   - the app's OWN tables: every unit in `WRITABLE_UNITS` and every unit
 *     the stock form offers has to reach the shelf, so a unit added to the
 *     app turns this test red until both gates can read it.
 *
 * WHY THE BRIDGE'S RULE IS RUN FROM ITS SOURCE AND NOT IMPORTED: the bridge
 * is a server, and importing it would start it on the port the owner's link
 * is served from. The rule is a pure function with no side effects, so the
 * test reads the shipped file, takes the function out of it and runs THAT.
 *
 * Run with:  node scripts/test-agent-stock-unit.mjs
 */
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = path.join(REPO, 'bridge', 'shift ', 'index.mjs');
const ADD_FORM = path.join(REPO, 'src', 'components', 'AddStockModal.tsx');
const EDIT_FORM = path.join(REPO, 'src', 'components', 'EditStockModal.tsx');

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

/**
 * The bridge's own action validation, taken from the shipped file.
 *
 * WHY THE FUNCTION IS CUT OUT BY ITS BRACES AND NOT BY A LINE RANGE: the
 * bridge is one long file and its lines move. Braces are what the function
 * actually is, so they are what the test follows.
 *
 * WHY IT FAILS LOUDLY AND NOT QUIETLY: if the bridge is ever rearranged so
 * that this rule cannot be found, the test must say so. A test that quietly
 * stopped testing anything is the failure this whole file exists to end.
 *
 * @returns {(raw: unknown) => unknown} the bridge's validateAction
 */
function bridgeValidateAction() {
  const source = fs.readFileSync(BRIDGE, 'utf8');

  const constantsAt = source.indexOf('const ACTION_CATEGORIES');
  const fnAt = source.indexOf('function validateAction(raw)');
  if (constantsAt < 0 || fnAt < 0) {
    throw new Error(
      'could not find validateAction in bridge/shift /index.mjs — this test has to be told how the bridge is arranged now',
    );
  }

  // The rule and the two tables it reads are all that is needed, and they
  // sit next to each other in the file.
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', fnAt); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('could not find the end of validateAction');

  const slice = source.slice(constantsAt, end);
  try {
    return new Function(`${slice}\nreturn validateAction;`)();
  } catch (err) {
    throw new Error(
      `could not run the bridge's validateAction as it is written: ${err.message}`,
    );
  }
}

/**
 * The unit words the bridge's own gate accepts.
 *
 * WHY IT IS READ OUT OF THE SHIPPED FILE: the bridge cannot import the
 * app's TypeScript, so it keeps its own copy of the list, and this test is
 * what holds the two copies together.
 *
 * @returns {string[]} every unit the bridge's gate carries
 */
function bridgeActionUnits() {
  const source = fs.readFileSync(BRIDGE, 'utf8');
  const at = source.indexOf('const ACTION_UNITS = new Set([');
  if (at < 0) {
    throw new Error(
      'could not find ACTION_UNITS in bridge/shift /index.mjs — this test has to be told how the bridge is arranged now',
    );
  }
  const open = source.indexOf('[', at);
  const close = source.indexOf(']', open);
  if (open < 0 || close < 0) throw new Error('could not read the ACTION_UNITS list');
  return [...source.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * The unit words the app's own stock form offers the household.
 *
 * @param {string} file the form to read
 * @returns {string[]} every unit the form suggests
 */
function formUnits(file) {
  const source = fs.readFileSync(file, 'utf8');
  const m = /const COMMON_UNITS = \[([^\]]+)\]/.exec(source);
  if (!m) {
    throw new Error(
      `could not find COMMON_UNITS in ${path.basename(file)} — this test has to be told how the form is arranged now`,
    );
  }
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * The shelf the House Bot writes onto.
 *
 * WHY A FAKE STORE: what is under test is what the app WRITES, and the
 * writing is driven through the real `applyAgentActions`. The store only has
 * to be able to answer the calls.
 *
 * @returns {{ store: object, rows: object[] }} the fake store and the rows it was given
 */
function fakeShelf() {
  const rows = [];
  const store = {
    grocery: [],
    stock: [],
    addStock(input) {
      rows.push(input);
      return { id: 'stk_1', ...input };
    },
  };
  return { store, rows };
}

console.log('\nthe bridge carries the unit the model wrote');

const validateAction = bridgeValidateAction();

{
  const carried = (unit) =>
    validateAction({
      type: 'add_stock',
      name: 'Milk',
      quantity: 2,
      unit,
      category: 'dairy',
      location: 'fridge',
    })?.unit;

  ok(
    carried('bottles') === 'bottles',
    'a unit the app writes is the unit the bridge carries',
    String(carried('bottles')),
  );
  ok(
    carried('bunch') === 'bunch',
    'and so is the other one the app writes',
    String(carried('bunch')),
  );
  ok(
    carried('kg') === 'kg',
    'and the ones it always carried',
    String(carried('kg')),
  );
  ok(
    carried('flask') === 'pcs',
    'and a unit the app does not know is still refused',
    String(carried('flask')),
  );
}

console.log('\nand the shelf holds it too');

{
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );

  const { store, rows } = fakeShelf();
  applyAgentActions(
    [{ type: 'add_stock', name: 'Milk', quantity: 2, unit: 'bottles', category: 'dairy' }],
    store,
  );
  ok(
    rows[0]?.unit === 'bottles',
    "the last gate before the shelf does not turn a bottle into a piece",
    String(rows[0]?.unit),
  );
}

console.log('\nand the whole chain keeps the unit the household asked for');

{
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );

  const { store, rows } = fakeShelf();
  const fromTheModel = {
    type: 'add_stock',
    name: 'Milk',
    quantity: 2,
    unit: 'bottles',
    category: 'dairy',
    location: 'fridge',
  };
  const fromTheBridge = validateAction(fromTheModel);
  const outcome = applyAgentActions([fromTheBridge], store);

  ok(
    rows[0]?.unit === 'bottles',
    'the model wrote bottles, the bridge carried bottles, and the shelf holds bottles',
    String(rows[0]?.unit),
  );
  ok(
    outcome.summary.includes('bottles'),
    'and what the household is told says the same thing',
    outcome.summary,
  );
}

console.log('\nand every unit the app writes can reach the shelf');

{
  const { WRITABLE_UNITS } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'units.ts')).href
  );
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );

  const lostByTheBridge = WRITABLE_UNITS.filter(
    (u) =>
      validateAction({
        type: 'add_stock',
        name: 'Thing',
        quantity: 1,
        unit: u,
        category: 'other',
      })?.unit !== u.toLowerCase(),
  );
  ok(
    lostByTheBridge.length === 0,
    'the bridge carries every unit in the app\'s table',
    lostByTheBridge.join(', '),
  );

  const { store, rows } = fakeShelf();
  // WHY ONE ACTION AT A TIME: the client refuses a batch longer than twelve,
  // so a batch of every unit would be cut short and the words that never
  // reached the gate would look like words the gate dropped.
  for (const u of WRITABLE_UNITS) {
    applyAgentActions(
      [{ type: 'add_stock', name: 'Thing', quantity: 1, unit: u, category: 'other' }],
      store,
    );
  }
  const lostByTheClient = WRITABLE_UNITS.filter(
    (u, i) => rows[i]?.unit !== u.toLowerCase(),
  );
  ok(
    lostByTheClient.length === 0,
    'and the last gate before the shelf carries every one of them too',
    lostByTheClient.join(', '),
  );
}

console.log("\nand every unit the app's own stock form offers can reach the shelf");

{
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );

  const offered = [...new Set([...formUnits(ADD_FORM), ...formUnits(EDIT_FORM)])];
  const { store, rows } = fakeShelf();
  applyAgentActions(
    offered.map((u) => ({
      type: 'add_stock',
      name: 'Thing',
      quantity: 1,
      unit: u,
      category: 'other',
    })),
    store,
  );
  const lost = offered.filter((u, i) => rows[i]?.unit !== u.toLowerCase());
  ok(
    lost.length === 0,
    'the units the form offers the household are the units the House Bot can write',
    lost.join(', '),
  );
}

console.log('\nand the two gates carry the same words');

{
  const bridgeUnits = bridgeActionUnits();
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );

  const { store, rows } = fakeShelf();
  // One action at a time, for the same reason as above.
  for (const u of bridgeUnits) {
    applyAgentActions(
      [{ type: 'add_stock', name: 'Thing', quantity: 1, unit: u, category: 'other' }],
      store,
    );
  }
  const lost = bridgeUnits.filter((u, i) => rows[i]?.unit !== u.toLowerCase());
  ok(
    lost.length === 0,
    'a unit the bridge carries is a unit the client carries',
    lost.join(', '),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
