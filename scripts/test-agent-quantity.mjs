/**
 * The House Bot's grocery quantity is the number the household asked for.
 *
 * THE BUG
 *
 * The House Bot puts things on the shopping list from an action the model
 * proposed. The quantity on that action is FREE TEXT — the bridge tells the
 * model it may write "2 packets" — and the model writes a plain number just
 * as often as it writes a phrase:
 *
 *     {"type":"add_grocery","name":"Eggs","quantity":3}
 *
 * The bridge cleaned that field with a cleaner that only accepts strings:
 *
 *     "bridge/shift /index.mjs"
 *       `const quantity = cleanName(raw.quantity, 40) || '1';`
 *
 * A number is not a string, so it came out as nothing, and the fallback
 * wrote "1":
 *
 *     the model wrote   {"type":"add_grocery","name":"Eggs","quantity":3}
 *     the list carried  "Eggs · 1"
 *
 * while the model's own message — which the household reads VERBATIM, and
 * which said "Added 3 eggs to your shopping list" — said three. Nothing on
 * the screen said a number had been thrown away.
 *
 * The CLIENT had the same blind spot in the same field, one gate further
 * on:
 *
 *     "src/utils/agentActions.ts"
 *       `quantity: spellQuantity(clean(a.quantity, 40)) || '1',`
 *
 * so even if the bridge had let the number through, the last gate before
 * the shopping list would have thrown it away and written "1" instead.
 *
 * WHY IT IS A DIFFERENCE FROM add_stock: the other action with the same
 * field name reads its quantity with Number(), so a number survives there:
 *
 *     {"type":"add_stock","name":"Eggs","quantity":3}   ->   quantity 3
 *     {"type":"add_grocery","name":"Eggs","quantity":3} ->   quantity "1"
 *
 * Two actions, one field name, two treatments — and the one that guessed
 * quietly was the one the household shops from. The stock row is read back
 * and matched; the shopping line is what the household buys.
 *
 * WHY IT IS WORTH A TEST: the quantity the app writes for the household is
 * checked in scripts/test-grocery-quantity-spelling.mjs — and every action
 * it drives writes its quantity as a STRING. A number was never asked
 * about, so the blind spot was never looked for.
 *
 * WHAT IS TESTED HERE
 *
 *   - the BRIDGE'S OWN VALIDATION, run from the shipped source, so a number
 *     the model wrote is the number the bridge carries;
 *   - the CLIENT'S OWN LAST GATE, driven through the real `applyAgentActions`;
 *   - the WHOLE CHAIN — the bridge's answer handed to the client, and the
 *     shopping list read back — because each gate alone would pass while the
 *     other one quietly threw the number away.
 *
 * WHY THE BRIDGE'S VALIDATION IS RUN FROM ITS SOURCE AND NOT IMPORTED: the
 * bridge is a server. Importing it would start it, on the port the owner's
 * link is served from, inside a test. The function is a pure rule with no
 * side effects, so the test reads the shipped file, takes the function out
 * of it and runs THAT — the real code, not a copy of it, and not the bridge
 * answering on the live port.
 *
 * Run with:  node scripts/test-agent-quantity.mjs
 */
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = path.join(REPO, 'bridge', 'shift ', 'index.mjs');

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

console.log('\nthe bridge carries the quantity the model wrote');

const validateAction = bridgeValidateAction();

{
  const groceries = (quantity) =>
    validateAction({
      type: 'add_grocery',
      name: 'Eggs',
      quantity,
      category: 'other',
    });

  ok(
    groceries(3)?.quantity === '3',
    'a number the model wrote is the number the bridge carries',
    JSON.stringify(groceries(3)?.quantity),
  );
  ok(
    groceries(0.5)?.quantity === '0.5',
    'and a fraction of a number is not rounded away',
    JSON.stringify(groceries(0.5)?.quantity),
  );
  ok(
    groceries('2 packets')?.quantity === '2 packets',
    'free text is still carried as it was written',
    JSON.stringify(groceries('2 packets')?.quantity),
  );
  ok(
    groceries(undefined)?.quantity === '1',
    'and a quantity that is not there at all is still one',
    JSON.stringify(groceries(undefined)?.quantity),
  );
  ok(
    validateAction({ type: 'add_grocery', name: '', quantity: 3 }) === null,
    'a row with no name is still not an action',
  );
}

console.log('\nand the shopping list carries it too');

{
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src/utils/agentActions.ts')).href
  );

  /**
   * The quantities that reached the shopping list.
   *
   * WHY A FAKE STORE: what is under test is what the app WRITES, and the
   * writing is driven through the real `applyAgentActions`. The store only
   * has to be able to answer the calls.
   */
  const written = [];
  const store = {
    grocery: [],
    stock: [],
    addGrocery(input) {
      written.push(input.quantity);
      return { id: 'gro_1', ...input };
    },
  };

  applyAgentActions(
    [{ type: 'add_grocery', name: 'Eggs', quantity: 3, category: 'other' }],
    store,
  );
  ok(
    written[0] === '3',
    'the last gate before the list does not turn a number into one',
    JSON.stringify(written[0]),
  );

  written.length = 0;
  applyAgentActions(
    [{ type: 'add_grocery', name: 'Salt', quantity: 'a pinch of salt', category: 'other' }],
    store,
  );
  ok(
    written[0] === 'a pinch of salt',
    'and free text still reaches the list as it was written',
    JSON.stringify(written[0]),
  );
}

console.log('\nand the whole chain keeps the number the household asked for');

{
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src/utils/agentActions.ts')).href
  );

  const written = [];
  const store = {
    grocery: [],
    stock: [],
    addGrocery(input) {
      written.push(input.quantity);
      return { id: 'gro_1', ...input };
    },
  };

  // What the model wrote, the bridge's own answer, and then the client's.
  const fromTheModel = { type: 'add_grocery', name: 'Eggs', quantity: 3, category: 'other' };
  const fromTheBridge = validateAction(fromTheModel);
  applyAgentActions([fromTheBridge], store);

  ok(
    written[0] === '3',
    'the model wrote 3, the bridge carried 3, and the list carries 3',
    JSON.stringify(written[0]),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
