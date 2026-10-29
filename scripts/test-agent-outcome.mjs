/**
 * Tests that the House Bot tells the household when part of what it was asked
 * to do did not happen.
 *
 * WHY THIS MATTERS
 * The House Bot applies the model's proposals to the real kitchen, and the
 * model writes its OWN confirmation into the reply the household reads — the
 * bubble says "Added milk and set the yeast to 3", and that text is shown
 * verbatim. So the household believes the yeast was set to 3.
 *
 * When the shelf held no yeast, the action was dropped — `applyAgentActions`
 * counts it as skipped, and its own comment says why: "counted as skipped so
 * the user still sees that something was dropped rather than silently losing
 * part of the request."
 *
 * WHAT WAS WRONG
 * The page warned only when NOTHING was applied:
 *
 *     if (outcome.skipped > 0 && outcome.applied === 0) {
 *       toast('House Bot couldn’t apply that change', 'warning');
 *     }
 *
 * So a batch of one success and one failure produced ONE toast — the success
 * one — and the failure was never mentioned:
 *
 *     the household saw   "House Bot · Milk → grocery"
 *     the household read  "Added milk and set the yeast to 3"
 *
 * Nothing on the screen contradicted the bot. The yeast was not touched.
 *
 * WHY THE SAYING IS TESTED AS A RULE AND NOT AS A RENDERED PAGE: the wording
 * used to be inline in HouseBot.tsx, where no test could reach it. It now
 * lives in `describeAgentOutcome`, which is a plain function of the result —
 * so the rule itself is checked here, and the page is checked in its SOURCE,
 * the same reasoning as scripts/test-quantity-spelling.mjs for a writer that
 * the server renderer does not run.
 *
 * WHAT IS TESTED HERE
 * That a batch where one change worked and one did not tells the household
 * about BOTH, that the count of what failed is named rather than hidden, and
 * that the everyday cases — everything applied, nothing applied — still say
 * what they said before.
 *
 * Run with:  node scripts/test-agent-outcome.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { applyAgentActions } = await import('../src/utils/agentActions.ts');
const { describeAgentOutcome } = await import('../src/utils/agentOutcome.ts');

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
 * A kitchen, and what the House Bot did to it.
 *
 * WHY A FAKE STORE AND NOT THE REAL ONE: what is under test is what the app
 * SAYS about what happened, and the happening is driven through the real
 * `applyAgentActions`. The store only has to be able to answer the calls.
 */
function kitchen(stock, grocery) {
  return {
    stock,
    grocery,
    addStock: (item) => ({ id: 'added', ...item }),
    addGrocery: (item) => ({ id: 'added', ...item }),
    toggleGroceryPurchased: () => {},
    // WHY THE WRITE IS APPLIED AND NOT IGNORED: a test that cannot see what
    // the shelf now holds cannot tell whether the app said what it wrote.
    // The number in the toast is the household's proof of what is on the
    // shelf, so the two have to be read off the same row.
    updateStock: (id, patch) => {
      const r = stock.find((s) => s.id === id);
      if (r) Object.assign(r, patch);
    },
  };
}

const row = (id, name) => ({
  id,
  name,
  quantity: 500,
  unit: 'g',
  category: 'vegetables',
  location: 'fridge',
  lowStockThreshold: 0,
});

/* -------------------------------------------------------------------------- */
/* One change worked and one did not                                          */
/* -------------------------------------------------------------------------- */

console.log('\nand a change that was dropped is said out loud');

{
  // The shelf holds milk. There is no yeast, so the second action cannot be
  // applied — but the first one can.
  const store = kitchen([row('s1', 'Milk')], []);

  const outcome = applyAgentActions(
    [
      { type: 'add_grocery', name: 'Milk', quantity: '1 pc', category: 'dairy' },
      { type: 'set_stock_quantity', name: 'Yeast', quantity: 3 },
    ],
    store,
  );

  check('one change was applied', outcome.applied, 1);
  check('and one was dropped', outcome.skipped, 1);

  const toasts = describeAgentOutcome(outcome);

  check('the household is told what worked', toasts[0]?.kind, 'success');
  check(
    'and what worked is named',
    toasts[0]?.message,
    'House Bot · Milk → grocery',
  );
  check(
    'AND the household is told what did not',
    toasts.length,
    2,
  );
  check('the failure is a warning', toasts[1]?.kind, 'warning');
  check(
    'and it names how many of the changes failed',
    toasts[1]?.message,
    'House Bot couldn’t apply 1 of 2 changes',
  );
}

/* -------------------------------------------------------------------------- */
/* Everything worked — the ordinary case, unchanged                             */
/* -------------------------------------------------------------------------- */

console.log('\nand a batch where everything worked still says so, and nothing else');

{
  const store = kitchen([row('s1', 'Milk')], []);

  const outcome = applyAgentActions(
    [
      { type: 'add_grocery', name: 'Milk', quantity: '1 pc', category: 'dairy' },
      { type: 'add_grocery', name: 'Eggs', quantity: '1 pc', category: 'other' },
    ],
    store,
  );

  const toasts = describeAgentOutcome(outcome);

  check('nothing was dropped', outcome.skipped, 0);
  check('so there is ONE toast', toasts.length, 1);
  check('and it is the success', toasts[0]?.kind, 'success');
  check(
    'and it names both changes',
    toasts[0]?.message,
    'House Bot · Milk → grocery · Eggs → grocery',
  );
}

/* -------------------------------------------------------------------------- */
/* Nothing worked                                                              */
/* -------------------------------------------------------------------------- */

console.log('\nand a batch where nothing worked says so, and does not claim success');

{
  const store = kitchen([], []);

  const outcome = applyAgentActions(
    [{ type: 'set_stock_quantity', name: 'Yeast', quantity: 3 }],
    store,
  );

  const toasts = describeAgentOutcome(outcome);

  check('nothing was applied', outcome.applied, 0);
  check('and it was dropped', outcome.skipped, 1);
  check('so there is ONE toast', toasts.length, 1);
  check('and it is the warning', toasts[0]?.kind, 'warning');
  check(
    'and it is the wording the app has always used for a lone change',
    toasts[0]?.message,
    'House Bot couldn’t apply that change',
  );
}

/* -------------------------------------------------------------------------- */
/* The number the toast names is the number that was written                    */
/* -------------------------------------------------------------------------- */

console.log('\nand the number it names is the number that was written');

{
  // The model's number is above the ceiling the last gate keeps to, so the
  // gate writes the ceiling — and the toast has to name the number that was
  // written, because the toast is the household's only proof of what the
  // shelf now holds.
  //
  // The gate read the number as the model wrote it, the gate wrote a
  // different one, and the sentence named the one that was NOT written:
  //
  //     the model wrote   {"type":"set_stock_quantity","name":"Milk","quantity":50000}
  //     the shelf held   10000
  //     the toast said    "Milk → 50000 g"
  //
  // The number the household shops from is the number on the shelf, and the
  // sentence above it is the one they read.
  const shelf = [row('s1', 'Milk')];
  const store = kitchen(shelf, []);

  const outcome = applyAgentActions(
    [{ type: 'set_stock_quantity', name: 'Milk', quantity: 50000 }],
    store,
  );

  check('the shelf holds the number the gate wrote', shelf[0].quantity, 10000);
  check(
    'and the summary names that same number',
    outcome.summary,
    'Milk → 10000 g',
  );

  const toasts = describeAgentOutcome(outcome);
  check(
    'and so does the toast the household reads',
    toasts[0]?.message,
    'House Bot · Milk → 10000 g',
  );
}

/* -------------------------------------------------------------------------- */
/* The page shows what the rule says                                            */
/* -------------------------------------------------------------------------- */

console.log('\nand the page shows what the rule says');

// WHY THE SOURCE IS CHECKED AND NOT THE PAGE: the toast is raised inside the
// streaming reply handler, which the server renderer does not run. The same
// reasoning as scripts/test-quantity-spelling.mjs.

const houseBotSource = readFileSync(path.join(REPO, 'src/pages/HouseBot.tsx'), 'utf8');

check(
  'the page shows the outcome through the rule',
  houseBotSource.includes('describeAgentOutcome(outcome)'),
  true,
);
check(
  'and does not hide the dropped count behind a success',
  /outcome\.skipped\s*>\s*0\s*&&\s*outcome\.applied\s*===\s*0/.test(houseBotSource),
  false,
);
check(
  'and does not build the wording itself any more',
  houseBotSource.includes('House Bot couldn’t apply that change'),
  false,
);

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
