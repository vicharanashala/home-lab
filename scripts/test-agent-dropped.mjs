/**
 * The House Bot says when a change it was asked for did not happen.
 *
 * THE BUG
 *
 * The House Bot puts things on the shopping list and the shelf from actions
 * the model proposed, and the model writes its OWN confirmation into the reply
 * the household reads — the bubble says "Added eggs and milk to your fridge",
 * and that text is shown VERBATIM. So the household believes the milk was
 * added.
 *
 * Two gates stand between the model and the kitchen. The BRIDGE validates the
 * action before it crosses to the browser, and the CLIENT validates it again
 * before it reaches the store. The client's own refusals were counted and
 * said out loud:
 *
 *     "src/utils/agentActions.ts"
 *       "counted as skipped so the user still sees that something was dropped
 *        rather than silently losing part of the request"
 *
 * and "scripts/test-agent-outcome.mjs" holds that to it.
 *
 * But the BRIDGE's refusals were filtered out of the batch before the client
 * ever saw them:
 *
 *     "bridge/shift /index.mjs"
 *       `actions = list.slice(0, MAX_ACTIONS_PER_MESSAGE).map(validateAction).filter(Boolean);`
 *
 * So a change the bridge refused left NO trace at all — not in the client's
 * count, not in anything the household could see:
 *
 *     the model proposed   two actions — one the bridge refuses
 *     the bridge carried   one
 *     the household read   "Added eggs and milk to your fridge"
 *     the toast said       "House Bot · Eggs → grocery"
 *     the shelf held       eggs, and nothing said the milk was not there
 *
 * The toast was a SUCCESS and the bot's own sentence claimed both changes.
 *
 * WHY A REFUSED ACTION IS A DROPPED CHANGE AND NOT A NON-EVENT: the model
 * asked for it and the household was told it happened. It is the same fact
 * the client already reports — "House Bot couldn't apply 1 of 2 changes" —
 * one gate earlier.
 *
 * WHY THE BRIDGE STILL REFUSES: refusing an unsafe action is the bridge's
 * job — an LLM misparse must never be able to corrupt someone's kitchen.
 * The fix is not to pass the action on; it is to SAY that it was not passed
 * on.
 *
 * WHAT IS TESTED HERE
 *
 *   - the BRIDGE'S OWN SPLITTING, run from the shipped source, so what the
 *     bridge counts as dropped is what the bridge actually drops;
 *   - the CLIENT'S OWN ACCOUNTING, driven through the real
 *     `applyAgentActions`, so a change the bridge refused is counted;
 *   - the WHOLE CHAIN — the bridge's own answer handed to the client — and
 *     the wording the household is given, because each gate alone would pass
 *     while the other one quietly lost the change.
 *
 * WHY THE BRIDGE'S RULE IS RUN FROM ITS SOURCE AND NOT IMPORTED: the bridge
 * is a server, and importing it would start it on the port the owner's link
 * is served from. The rule is a pure function with no side effects, so the
 * test reads the shipped file, takes the function out of it and runs THAT —
 * the real code, not a copy of it, and not the bridge answering on the live
 * port.
 *
 * Run with:  node scripts/test-agent-dropped.mjs
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
 * The bridge's own splitting of a reply into text and actions.
 *
 * WHY THE FUNCTION IS CUT OUT BY ITS BRACES AND NOT BY A LINE RANGE: the
 * bridge is one long file and its lines move. Braces are what the function
 * actually is, so they are what the test follows.
 *
 * WHY IT FAILS LOUDLY AND NOT QUIETLY: if the bridge is ever rearranged so
 * that this rule cannot be found, the test must say so. A test that quietly
 * stopped testing anything is the failure this whole file exists to end.
 *
 * @returns {(reply: string) => { text: string; actions: unknown[]; dropped: number }}
 */
function bridgeSplitActions() {
  const source = fs.readFileSync(BRIDGE, 'utf8');

  const fenceAt = source.indexOf('const ACTION_FENCE');
  const fnAt = source.indexOf('function splitActions(reply)');
  if (fenceAt < 0 || fnAt < 0) {
    throw new Error(
      'could not find splitActions in bridge/shift /index.mjs — this test has to be told how the bridge is arranged now',
    );
  }

  // The rule and every table and helper it reads sit between the fence and
  // the end of the function, so the slice is the whole of it.
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
  if (end < 0) throw new Error('could not find the end of splitActions');

  const slice = source.slice(fenceAt, end);
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`${slice}\nreturn splitActions;`)();
  } catch (err) {
    throw new Error(
      `could not run the bridge's splitActions as it is written: ${err.message}`,
    );
  }
}

console.log('\nthe bridge says what it did not carry');

const splitActions = bridgeSplitActions();

{
  // The model wrote two actions. The bridge refuses the second one — a stock
  // row of ZERO is not a thing anybody can shop for.
  const reply = `Added eggs and milk to your fridge.

\`\`\`homehub-actions
[{"type":"add_grocery","name":"Eggs","quantity":3,"category":"other"},
 {"type":"add_stock","name":"Milk","quantity":0,"unit":"pcs","category":"dairy"}]
\`\`\``;

  const { actions, dropped } = splitActions(reply);

  ok(actions.length === 1, 'the bridge carries the action it accepted', String(actions.length));
  ok(
    dropped === 1,
    'and says how many it did not carry',
    String(dropped),
  );
}

{
  // Nothing was refused — the ordinary case must stay silent.
  const reply = `Added eggs.

\`\`\`homehub-actions
[{"type":"add_grocery","name":"Eggs","quantity":3,"category":"other"}]
\`\`\``;

  const { actions, dropped } = splitActions(reply);

  ok(actions.length === 1, 'the bridge carries the one action', String(actions.length));
  ok(dropped === 0, 'and nothing was dropped, so nothing is said', String(dropped));
}

{
  // A batch longer than the bridge's own cap: the ones past the cap are
  // dropped too, and the household was told about all of them.
  const many = Array.from(
    { length: 15 },
    (_, i) => `{"type":"add_grocery","name":"Item ${i}","quantity":1,"category":"other"}`,
  ).join(',');
  const reply = `Added a lot.\n\n\`\`\`homehub-actions\n[${many}]\n\`\`\``;

  const { actions, dropped } = splitActions(reply);

  ok(actions.length === 12, 'the bridge carries the twelve it allows', String(actions.length));
  ok(
    dropped === 3,
    'and says how many it did not carry',
    String(dropped),
  );
}

console.log('\nand the household is told what did not happen');

{
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );
  const { describeAgentOutcome } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentOutcome.ts')).href
  );

  /**
   * A kitchen, and what the House Bot did to it.
   *
   * WHY A FAKE STORE AND NOT THE REAL ONE: what is under test is what the
   * app SAYS about what happened, and the happening is driven through the
   * real `applyAgentActions`. The store only has to be able to answer the
   * calls.
   */
  const written = [];
  const store = {
    grocery: [],
    stock: [],
    addGrocery: (item) => {
      written.push(item);
      return { id: 'gro_1', ...item };
    },
  };

  const reply = `Added eggs and milk to your fridge.

\`\`\`homehub-actions
[{"type":"add_grocery","name":"Eggs","quantity":3,"category":"other"},
 {"type":"add_stock","name":"Milk","quantity":0,"unit":"pcs","category":"dairy"}]
\`\`\``;

  // The bridge's own answer, handed to the client exactly as the bridge
  // hands it over.
  const { actions, dropped } = splitActions(reply);
  const outcome = applyAgentActions(actions, store, dropped);

  ok(outcome.applied === 1, 'the action the bridge carried was applied', String(outcome.applied));
  ok(
    outcome.skipped === 1,
    'and the one it refused is counted as dropped',
    String(outcome.skipped),
  );

  const toasts = describeAgentOutcome(outcome);

  ok(toasts.length === 2, 'so the household is told about both', String(toasts.length));
  ok(toasts[0]?.kind === 'success', 'the first is the success', String(toasts[0]?.kind));
  ok(toasts[1]?.kind === 'warning', 'and the second is the warning', String(toasts[1]?.kind));
  ok(
    toasts[1]?.message === "House Bot couldn’t apply 1 of 2 changes",
    'and it names how many of the changes failed',
    String(toasts[1]?.message),
  );
}

console.log('\nand nothing is applied without the household hearing about it');

{
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );
  const { describeAgentOutcome } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentOutcome.ts')).href
  );

  // EVERY action was refused — the batch is empty by the time it reaches the
  // client. The household must still be told, and the page must still show
  // the warning.
  const store = { grocery: [], stock: [], addGrocery: () => ({ id: 'g' }) };

  const outcome = applyAgentActions([], store, 2);
  const toasts = describeAgentOutcome(outcome);

  ok(outcome.applied === 0, 'nothing was applied', String(outcome.applied));
  ok(outcome.skipped === 2, 'and both were dropped', String(outcome.skipped));
  ok(toasts.length === 1, 'so there is ONE toast', String(toasts.length));
  ok(toasts[0]?.kind === 'warning', 'and it is the warning', String(toasts[0]?.kind));
  ok(
    toasts[0]?.message === "House Bot couldn’t apply 2 of 2 changes",
    'and it names both of them',
    String(toasts[0]?.message),
  );
}

console.log('\nand the bridge and the page carry the count between them');

{
  // WHY THE SOURCE IS CHECKED AND NOT THE PAGE: the toast is raised inside
  // the streaming reply handler, which the server renderer does not run. The
  // same reasoning as scripts/test-agent-outcome.mjs.
  const bridgeSource = fs.readFileSync(BRIDGE, 'utf8');
  const pageSource = fs.readFileSync(path.join(REPO, 'src', 'pages', 'HouseBot.tsx'), 'utf8');

  // The "done" event is the LAST thing the bridge sends, so it is where the
  // count has to ride.
  const doneAt = bridgeSource.indexOf("type: 'done'");
  ok(doneAt > 0, 'the bridge sends a done event', String(doneAt > 0));

  // WHY THE BLOCK IS FOUND BY ITS BRACES AND NOT BY A CHARACTER COUNT: the
  // event carries a comment explaining WHY the count is on it, and a length
  // would have to be guessed to clear it.
  let blockEnd = -1;
  for (let i = doneAt; i < bridgeSource.length; i += 1) {
    if (bridgeSource[i] === '}') {
      blockEnd = i + 1;
      break;
    }
  }
  ok(
    blockEnd > 0 && bridgeSource.slice(doneAt, blockEnd).includes('dropped'),
    'and the count rides on it',
    true,
  );

  ok(
    pageSource.includes("payload.type === 'done'"),
    'the page reads the done event',
    true,
  );
  ok(
    /applyAgentActions\(\s*queuedActions,\s*store,\s*droppedByBridge\s*(,|\))/.test(pageSource),
    'and gives the count to the gate that counts',
    true,
  );
  ok(
    /queuedActions\.length\s*>\s*0\s*\|\|\s*droppedByBridge\s*>\s*0/.test(pageSource),
    'and asks about the batch even when nothing arrived',
    true,
  );
}

console.log('\nand the household is told when the model wrote something unreadable');

{
  // THE CASE THE COUNT ALONE CANNOT COVER
  //
  // The bridge counts what it did not carry as "proposed minus carried". That
  // works when the model's action block PARSES — the number it proposed can be
  // read out of it. But when the block does not parse, the number cannot be
  // read, and the bridge reported "dropped: 0" — which says "nothing was
  // lost" when something WAS lost:
  //
  //     the model wrote   "Added eggs and milk to your fridge."
  //                       ```homehub-actions
  //                       [{"type":"add_grocery","name":"Eggs",...},]
  //                       ```
  //     the bridge read   nothing — a trailing comma
  //     the household read "Added eggs and milk to your fridge."
  //     the shelf held    nothing
  //
  // And the page's gate is `queuedActions.length > 0 || droppedByBridge > 0`,
  // so an empty batch with a dropped count of zero opened nothing and said
  // nothing at all.
  //
  // WHY A TRAILING COMMA IS THE CASE TO WORRY ABOUT: the model writes this
  // JSON by hand, and a trailing comma is the ordinary slip. A truncated
  // reply does the same thing.
  const cases = [
    {
      label: 'a trailing comma',
      body: '[{"type":"add_grocery","name":"Eggs","quantity":3,"category":"other"},]',
    },
    {
      label: 'a reply cut short',
      body: '[{"type":"add_grocery","name":"Eggs","quantity":3,"category":"other"}',
    },
    {
      label: 'one action written where a list was expected',
      body: '{"type":"add_grocery","name":"Eggs","quantity":3,"category":"other"}',
    },
  ];

  // WHY THE LOG IS CAPTURED RATHER THAN LEFT TO PRINT: a parse failure that
  // is swallowed is a bug nobody is told about — and a model that keeps
  // writing broken JSON is a model the prompt has to change. So the bridge
  // says so, and this checks that it does.
  const logged = [];
  const realError = console.error;
  console.error = (...args) => {
    logged.push(args.map(String).join(' '));
  };

  try {
    for (const c of cases) {
      const reply = `Added eggs and milk to your fridge.\n\n\`\`\`homehub-actions\n${c.body}\n\`\`\``;
      const { actions, dropped, unreadable } = splitActions(reply);

      ok(actions.length === 0, `${c.label}: the bridge carries nothing it cannot read`, String(actions.length));
      ok(
        unreadable === true,
        `${c.label}: and says the block was unreadable`,
        String(unreadable),
      );
      ok(
        dropped === 0,
        `${c.label}: without inventing a number it cannot read`,
        String(dropped),
      );
    }
  } finally {
    console.error = realError;
  }

  ok(
    logged.length >= cases.length,
    'and every unreadable block is logged rather than swallowed',
    `${logged.length} logged`,
  );
  ok(
    logged.some((line) => line.includes('action block')),
    'and the log says what could not be read',
    logged[0] || '(nothing logged)',
  );
}

{
  // WHY THESE TWO ARE NOT "UNREADABLE": nothing was proposed in either, so
  // nothing was lost, and warning the household about a change that was never
  // asked for is noise.
  const emptyList = '```homehub-actions\n[]\n```';
  const noBlock = 'Added eggs to your fridge.';

  ok(
    splitActions(emptyList).unreadable === false,
    'an empty list is not unreadable — nothing was proposed',
    String(splitActions(emptyList).unreadable),
  );
  ok(
    splitActions(noBlock).unreadable === false,
    'a reply with no action block is not unreadable',
    String(splitActions(noBlock).unreadable),
  );
}

{
  // The client's own accounting, and the wording the household is given.
  const { applyAgentActions } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentActions.ts')).href
  );
  const { describeAgentOutcome } = await import(
    pathToFileURL(path.join(REPO, 'src', 'utils', 'agentOutcome.ts')).href
  );

  const store = { grocery: [], stock: [], addGrocery: () => ({ id: 'g' }) };

  // The bridge could not read the block, so nothing reached this browser.
  const outcome = applyAgentActions([], store, 0, true);
  const toasts = describeAgentOutcome(outcome);

  ok(outcome.applied === 0, 'nothing was applied', String(outcome.applied));
  ok(
    outcome.unreadable === true,
    'and the result carries the fact that the block was unreadable',
    String(outcome.unreadable),
  );
  ok(toasts.length === 1, 'so there is ONE toast', String(toasts.length));
  ok(toasts[0]?.kind === 'warning', 'and it is the warning', String(toasts[0]?.kind));
  ok(
    toasts[0]?.message === 'House Bot couldn’t apply a change it couldn’t read',
    'and it says what happened, without a number nobody can check',
    String(toasts[0]?.message),
  );
}

{
  // The page has to open the gate for an unreadable block, or the toast is
  // never raised — which is the silence this whole file exists to end.
  const pageSource = fs.readFileSync(path.join(REPO, 'src', 'pages', 'HouseBot.tsx'), 'utf8');

  ok(
    pageSource.includes("payload.type === 'done'"),
    'the page reads the done event',
    true,
  );
  ok(
    /unreadableByBridge/.test(pageSource),
    'and the page holds what the bridge said about the block',
    true,
  );
  ok(
    /queuedActions\.length\s*>\s*0\s*\|\|\s*droppedByBridge\s*>\s*0\s*\|\|\s*unreadableByBridge/.test(
      pageSource,
    ),
    'and asks about the batch even when the block could not be read',
    true,
  );
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
