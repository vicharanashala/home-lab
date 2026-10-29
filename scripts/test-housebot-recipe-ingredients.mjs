/**
 * House Bot is told what is IN the recipes it is offered.
 *
 * THE BUG
 *
 * The bridge builds a RECIPES block for the model — the list the model is told
 * to "pick from this list, don't invent new ones" — and it wrote each recipe's
 * ingredients by reading three fields off each one:
 *
 *     `${i.quantity || ''}${i.unit ? i.unit : ''} ${i.name}`.trim()
 *
 * The app does not send those fields. HouseBot.tsx builds the catalogue it
 * sends and puts the ingredient NAMES in it:
 *
 *     ingredients: r.ingredients.map((i) => i.name)
 *
 * so every element of `r.ingredients` is a plain STRING — "Rice", "Urad dal".
 * A string has no `.quantity`, no `.unit` and no `.name`, so all three read
 * `undefined`, and the block came out as:
 *
 *     - [rcp_1] 🍳 Masala Dosa (breakfast, serves 2): undefined, undefined
 *
 * Every ingredient of every recipe. The model was handed a list of recipes
 * whose contents were the word "undefined", and was told to pick from it.
 *
 * WHY IT MATTERS: the RECIPES block is what House Bot grounds "what can I
 * cook with the milk that is about to go off?" on. The recipe names survive —
 * they are read from fields the app does send — but the ingredients do not, so
 * the one thing the block was for was the one thing it did not carry.
 *
 * WHY IT HAS BEEN WRONG SINCE THE FIRST COMMIT: the app has sent ingredient
 * names, not ingredient records, since the initial commit. The bridge has read
 * ingredient records since the initial commit. Nothing on either side ever
 * said so, because nothing checked what the block actually said.
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a fake model that keeps the
 * request it was sent, asks both chat routes the same question with the
 * recipe catalogue in the shape the app really sends it, and reads the
 * RECIPES block out of the system prompt the model actually received.
 *
 * It checks both routes, because there are two of them and each builds its own
 * copy of the context block.
 *
 * Run with:  node scripts/test-housebot-recipe-ingredients.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const bridgeDir = join(repo, 'bridge', 'shift ');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A port nothing is listening on. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// ── the catalogue the app would have sent ─────────────────────────────────
//
// THE SHAPE IS THE POINT: HouseBot.tsx sends `ingredients: string[]` — the
// NAMES, not the records. A test that sent ingredient records would pass
// against a bridge that is still broken, because the records are what the
// bridge wishes it were given.
const RECIPES = [
  {
    id: 'rcp_1',
    name: 'Masala Dosa',
    emoji: '🍳',
    mealType: 'breakfast',
    ingredients: ['Rice', 'Urad dal', 'Ghee'],
  },
  {
    id: 'rcp_2',
    name: 'Palak Paneer',
    emoji: '🥘',
    mealType: 'dinner',
    ingredients: ['Paneer', 'Spinach', 'Onion'],
  },
];

// A client that sends the WHOLE ingredient record — name, quantity and unit —
// gets the quantity as well, written by the app's own rule. The rule is the
// bridge's `formatQuantity`, which is the same rule the app uses: "2 kg", and
// "1 pc" for a quantity of one with a plural unit.
const RECIPES_WITH_RECORDS = [
  {
    id: 'rcp_3',
    name: 'Curd Rice',
    emoji: '🍚',
    mealType: 'lunch',
    ingredients: [
      { name: 'Rice', quantity: 200, unit: 'g' },
      { name: 'Curd', quantity: 1, unit: 'kgs' },
      { name: 'Salt', quantity: 1, unit: 'pinches' },
    ],
  },
];

// ── the fake model ───────────────────────────────────────────────────────
//
// It keeps every request it is sent, because the system prompt — and with it
// the context block — is only ever seen by the model.
const requests = [];

const model = createHttpServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* not json; nothing to keep */
    }
    if (parsed) requests.push(parsed);

    if (parsed?.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
      );
      res.end('data: {"type":"message_delta","usage":{"output_tokens":1}}\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { output_tokens: 1 },
        stop_reason: 'end_turn',
      }),
    );
  });
});

const modelPort = await freePort();
await new Promise((r) => model.listen(modelPort, '127.0.0.1', r));

/**
 * Where the bridge's own dependencies are installed.
 *
 * WHY THIS IS NOT JUST THE BRIDGE'S OWN FOLDER: the quality gate exports the
 * staged index to a temporary directory, and an export holds tracked files
 * only — the bridge's node_modules is not among them, so a copy of the
 * bridge started there cannot import express and the check silently stops
 * being a check.
 */
function bridgeDependencies() {
  const candidates = [join(bridgeDir, 'node_modules')];
  try {
    candidates.push(
      join(dirname(realpathSync(join(repo, 'node_modules'))), 'bridge', 'shift ', 'node_modules'),
    );
  } catch {
    /* no repository node_modules beside this copy */
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'express'))) return candidate;
  }
  return null;
}

// ── a copy of the bridge, on a spare port ───────────────────────────────
//
// A COPY, not the real one: the test must not talk to the bridge serving
// the owner's link, and must not write to the real data directory. HOME
// points at a temporary directory so everything the bridge keeps lands
// there.
const work = mkdtempSync(join(tmpdir(), 'hh-housebot-recipes-'));
const home = join(work, 'home');
mkdirSync(home, { recursive: true });
copyFileSync(join(bridgeDir, 'index.mjs'), join(work, 'index.mjs'));
copyFileSync(join(bridgeDir, 'openclaw-cli.mjs'), join(work, 'openclaw-cli.mjs'));

const deps = bridgeDependencies();
if (deps) symlinkSync(deps, join(work, 'node_modules'));

const bridgePort = await freePort();
const bridge = deps
  ? spawn(process.execPath, ['index.mjs'], {
      cwd: work,
      env: {
        ...process.env,
        HOME: home,
        PORT: String(bridgePort),
        BRIDGE_TOKEN: '',
        MINIMAX_CHAT_URL: `http://127.0.0.1:${modelPort}/v1/messages`,
        MINIMAX_API_URL: `http://127.0.0.1:${modelPort}/v1/messages`,
        MINIMAX_ACCESS_TOKEN: 'stub-token',
        BRAVE_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : null;
let bridgeErr = '';
bridge?.stderr.on('data', (d) => { bridgeErr += d.toString(); });

let bridgeUp = false;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${bridgePort}/healthz`);
    if (r.ok) { bridgeUp = true; break; }
  } catch { /* not up yet */ }
  await sleep(100);
}

/**
 * The system prompt of the last request the model was sent.
 *
 * @returns {string} the prompt
 */
function lastSystemPrompt() {
  for (let i = requests.length - 1; i >= 0; i--) {
    const messages = requests[i]?.messages;
    if (!Array.isArray(messages)) continue;
    const system = messages.find((m) => m?.role === 'system');
    if (typeof system?.content === 'string' && system.content.includes('RECIPES')) {
      return system.content;
    }
  }
  return '';
}

/**
 * One section of the context block.
 *
 * A section is a header line and the indented lines under it, so the RECIPES
 * block is read whole.
 *
 * @param {string} prompt the system prompt
 * @param {string} headerPrefix the header the section starts with
 * @returns {string} the section
 */
function section(prompt, headerPrefix) {
  const lines = prompt.split('\n');
  const start = lines.findIndex((l) => l.startsWith(headerPrefix));
  if (start === -1) return '';
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].startsWith('  - ')) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

// WHY THIS MESSAGE: the bridge runs a web search for anything that reads as a
// knowledge question, and the test has no web to search. A message that
// triggers nothing keeps the test to the one thing it is about.
const QUESTION = 'my kitchen stock and meals';

/**
 * Ask one route and read the RECIPES block out of what the model was sent.
 *
 * @param {string} path the route to ask
 * @param {object[]} recipes the catalogue to send, in the shape the app sends
 * @returns {Promise<string>} the RECIPES block
 */
async function recipesBlockFor(path, recipes) {
  const res = await fetch(`http://127.0.0.1:${bridgePort}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: QUESTION,
      history: [],
      context: { recipes },
    }),
  });
  await res.text();
  return section(lastSystemPrompt(), 'RECIPES');
}

/**
 * Stop the bridge copy, and wait until it really is gone.
 *
 * WHY IT WAITS FOR THE EXIT: `kill` only asks. A bridge that is still
 * winding down when the work directory is removed goes on running with a
 * directory that is no longer there, holding a port that nothing asked it to
 * hold.
 */
async function stopBridge() {
  if (!bridge) return;
  if (bridge.exitCode !== null || bridge.signalCode !== null) return;
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), sleep(2000).then(() => false)]);
  if (stopped) return;
  bridge.kill('SIGKILL');
  await Promise.race([exited, sleep(2000)]);
}

/**
 * The checks, run against one route's RECIPES block.
 *
 * @param {string} label which route is being checked
 * @param {string} block the RECIPES block that route sent the model
 */
function checkRecipes(label, block) {
  ok(block.length > 0, `${label}: the model is sent the recipes`, block.slice(0, 160));

  // The recipe itself is read from fields the app does send, so it was never
  // the broken part. It is checked so that a block which lost the recipe too
  // cannot pass by saying nothing.
  ok(block.includes('Masala Dosa'), `${label}: the recipe is named`, block.slice(0, 160));

  // The ingredients are the part that was broken.
  for (const name of ['Rice', 'Urad dal', 'Ghee']) {
    ok(
      block.includes(name),
      `${label}: the recipe's ingredient "${name}" is named`,
      block.slice(0, 200),
    );
  }

  ok(
    !block.includes('undefined'),
    `${label}: the block does not say "undefined" where an ingredient should be`,
    block.slice(0, 200),
  );
}

/**
 * The checks for a client that sends the whole ingredient record.
 *
 * WHY THE QUANTITY IS CHECKED HERE: the record carries a number and a unit,
 * and the bridge has its own copy of the app's rule for writing them. If the
 * rule were not used, the model would be told "200g Rice" where the app shows
 * "200 g Rice" — the same quantity in two spellings, which is the whole
 * reason `formatQuantity` exists.
 *
 * @param {string} label which route is being checked
 * @param {string} block the RECIPES block that route sent the model
 */
function checkRecipeRecords(label, block) {
  ok(block.includes('Rice'), `${label}: the ingredient's name is written`, block.slice(0, 200));
  ok(
    block.includes('200 g Rice'),
    `${label}: a quantity is written the way the app writes it`,
    block.slice(0, 200),
  );
  ok(
    block.includes('1 kg Curd'),
    `${label}: a quantity of one is written with a singular unit`,
    block.slice(0, 200),
  );
  ok(
    block.includes('1 pinch Salt'),
    `${label}: a plural unit is written singular when the quantity is one`,
    block.slice(0, 200),
  );
  ok(
    !block.includes('200g'),
    `${label}: the quantity is not run into the unit`,
    block.slice(0, 200),
  );
}

// WHY THE TEST IS WRAPPED: the bridge copy is started above, and the cleanup
// that stops it is below. Between the two there are fetches and assertions,
// and any of them can throw — and a throw is exactly when the test is least
// likely to be watched. A throw that skips the cleanup leaves a bridge copy
// running on a port of its own.
try {
  console.log('\nHouse Bot is told what is in the recipes it is offered');
  if (!deps) {
    console.log('  SKIP the bridge is not installed here — its dependencies could not be found');
  } else if (!bridgeUp) {
    console.log('  SKIP the bridge copy did not start');
    console.log(bridgeErr.slice(0, 600));
  } else {
    checkRecipes('the chat route', await recipesBlockFor('/api/housebot/chat', RECIPES));
    checkRecipes('the streaming route', await recipesBlockFor('/api/housebot/chat/stream', RECIPES));
    checkRecipeRecords(
      'the chat route, with ingredient records',
      await recipesBlockFor('/api/housebot/chat', RECIPES_WITH_RECORDS),
    );
    checkRecipeRecords(
      'the streaming route, with ingredient records',
      await recipesBlockFor('/api/housebot/chat/stream', RECIPES_WITH_RECORDS),
    );
  }
} catch (err) {
  failed += 1;
  console.log(`  FAIL the test threw — ${err && err.message ? err.message : err}`);
} finally {
  await stopBridge();
  model.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
