/**
 * The household's quantity, written to the model the way the app writes it.
 *
 * THE BUG
 *
 * Every screen that shows how much of something the household has writes it
 * with `formatQuantity` (src/utils/date.ts) — the Stock row beside the
 * quantity buttons, the Alerts list, the grocery line seeded from a stock
 * row. The rule is: a blank unit is no unit, a unit of one is written
 * singular, and the number and the unit are separated by a space.
 *
 * The BRIDGE did not. It handed the model the quantity by joining two fields
 * of the record with nothing between them:
 *
 *     "bridge/shift /index.mjs"
 *       `  - ${item.name}: ${item.quantity}${item.unit || ''}...`
 *
 * so the model was told:
 *
 *     the Stock row on screen   "1 bottle"
 *     the model's STOCK block   "  - Milk: 1bottles (exp ...)"
 *
 * The quantity of one with a plural unit, run together, and the app's own
 * singularisation missing. The same line turned a unit of nothing but spaces
 * into a run of trailing spaces, and a unit of "pcs" into "2pcs".
 *
 * WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE: this string is what the MODEL
 * reads. Every other line the model sees was written by a rule the app also
 * uses, so the model can be trusted to say back what the screen says. This
 * one was written by a second, looser rule, and the model repeats what it is
 * given — so the household could be told it had "1 bottles of milk" by the
 * bot while the app showed "1 bottle".
 *
 * WHY IT IS WORTH A TEST AND NOT A TYPO FIX: this repo has been here before.
 * Commit 45fe46b fixed the app's stock-row toast and tested only the app.
 * The bridge was left behind, and nothing went red. The rule is that the
 * bridge is one of the places a quantity is written, so it is one of the
 * places the rule has to hold.
 *
 * WHAT IS TESTED HERE
 *
 * It runs a real copy of the bridge against a fake model that captures the
 * request, sends the context the app sends, and asks what the bridge told
 * the model:
 *
 *   - the STOCK block writes the quantity with the APP'S OWN rule — the test
 *     asks `formatQuantity` and demands the bridge say that, so a restated
 *     rule cannot make the test agree with itself;
 *   - a unit of one is written singular, and the number and the unit are
 *     separated by a space;
 *   - a unit that is nothing but spaces leaves no hole;
 *   - BOTH chat routes say the same thing, because they build the context
 *     block separately and have drifted before.
 *
 * Run with:  node scripts/test-bridge-stock-quantity.mjs
 */
import { register } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const bridgeDir = join(repo, 'bridge', 'shift ');

// THE APP'S OWN RULE, not a copy of it.
//
// WHY THE APP'S RULE AND NOT A RESTATED ONE: the point of this test is that
// the bridge and the app write the same quantity. A rule written out again
// inside the test would only prove that the restatement agrees with itself —
// the two would drift the moment the app's rule changed.
const { formatQuantity } = await import(
  pathToFileURL(join(repo, 'src/utils/date.ts')).href
);

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

// ── the fake model ───────────────────────────────────────────────────────
//
// It answers in the Anthropic SSE shape the bridge reads, and it keeps every
// request body so the test can ask what the bridge actually sent.
const captured = [];
const model = createHttpServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      captured.push(JSON.parse(body));
    } catch {
      captured.push({ parseError: body.slice(0, 200) });
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"stub"}}\n\n');
    res.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n');
    res.end();
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

/**
 * The kitchen the test talks about.
 *
 * WHY IT IS BUILT BEFORE THE BRIDGE IS STARTED: the block that starts the
 * bridge also catches whatever throws, and a constant that is still in its
 * temporal dead zone when that block runs is a ReferenceError of its own.
 *
 * WHY THESE ITEMS: one of quantity ONE with a plural unit (the case that
 * produced "1bottles"), one of quantity two with a unit that ends in "s"
 * (the case that produced "2pcs"), one whose unit is nothing but spaces (a
 * hole where a word should be), one with no unit at all, and one whose unit
 * is an "-es" plural (the case that produced "1dashes" instead of "1 dash").
 *
 * Every one of them is inside the window, so every one of them is in the
 * STOCK block.
 */
const STOCK = [
  { id: 'a', name: 'Milk', quantity: 1, unit: 'bottles', expiryDate: localDay(1), category: 'dairy' },
  { id: 'b', name: 'Eggs', quantity: 2, unit: 'pcs', expiryDate: localDay(1), category: 'other' },
  { id: 'c', name: 'Water', quantity: 1, unit: '   ', expiryDate: localDay(1), category: 'other' },
  { id: 'd', name: 'Salt', quantity: 1, unit: '', expiryDate: localDay(1), category: 'other' },
  { id: 'e', name: 'Curd', quantity: 1, unit: 'dashes', expiryDate: localDay(1), category: 'dairy' },
];

/**
 * Every route the bridge answers on, and the one that builds its own copy of
 * the context block.
 *
 * WHY BOTH: the two routes build the context block separately — the same
 * block, written out twice — and they have drifted before. A fix that only
 * touched one of them would leave the other answering with the old wording.
 */
const ROUTES = ['chat', 'chat/stream'];

// ── a copy of the bridge, on a spare port ────────────────────────────────
//
// A COPY, not the real one: the test must not talk to the bridge serving the
// owner's link, and must not write to the real data directory. HOME points
// at a temporary directory so everything the bridge keeps lands there.
const work = mkdtempSync(join(tmpdir(), 'hh-bridge-stock-qty-'));
const home = join(work, 'home');
mkdirSync(home, { recursive: true });
copyFileSync(join(bridgeDir, 'index.mjs'), join(work, 'index.mjs'));
copyFileSync(join(bridgeDir, 'openclaw-cli.mjs'), join(work, 'openclaw-cli.mjs'));
const deps = bridgeDependencies();
if (deps) symlinkSync(deps, join(work, 'node_modules'));

// The bridge copy, and the port it is on.
//
// WHY THEY ARE DECLARED HERE AND NOT WHERE THEY ARE USED: the block below
// catches whatever throws — including a throw in the middle of starting the
// bridge — and the cleanup that stops a bridge that DID start has to be
// reachable from there.
let bridge = null;
let bridgeErr = '';
let bridgePort = null;

/**
 * Stop the bridge copy, and wait until it really is gone.
 *
 * WHY IT WAITS FOR THE EXIT: `kill` only asks. A bridge that is still winding
 * down when the work directory is removed goes on running with a directory
 * that is no longer there, holding a port that nothing asked it to hold.
 *
 * WHY IT ESCALATES: the bridge is a server with sockets open, and a server
 * that is asked to stop politely can decline. SIGKILL is what it gets when
 * SIGTERM did not do it.
 *
 * @returns {Promise<void>} resolves when the bridge is gone
 */
async function stopBridge() {
  if (!bridge) return;
  if (bridge.exitCode !== null || bridge.signalCode !== null) return;
  const exited = new Promise((resolve) => bridge.once('exit', resolve));
  bridge.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), sleep(2000).then(() => false)]);
  if (stopped) return;
  bridge.kill('SIGKILL');
  await Promise.race([exited, sleep(2000)]);
}

let bridgeUp = false;

/**
 * Today, as the bridge writes it.
 *
 * WHY THE TEST COMPUTES IT ITSELF AND NOT BY IMPORTING THE BRIDGE: the bridge
 * is a running server, not a library. The bridge's `localDay` is local time,
 * so the test uses local time too.
 */
function localDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Send a message to one of the chat routes and return the system prompt the
 * bridge built for the model.
 *
 * @param {string} route 'chat' or 'chat/stream'
 * @returns {Promise<string>} the system message
 */
async function systemPromptFor(route) {
  const before = captured.length;
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'what have I got?',
      history: [],
      context: {
        stock: STOCK,
        grocery: [],
        recentMeals: [],
        settings: { expiringSoonDays: 3 },
        recipes: [],
      },
    }),
  });
  await res.text();
  if (captured.length === before) return '';
  const req = captured[captured.length - 1];
  return (req.messages || []).find((m) => m.role === 'system')?.content || '';
}

/**
 * The quantity the bridge wrote for one item, read back out of a STOCK line.
 *
 * WHY IT IS READ OUT OF THE LINE AND NOT ASKED FOR: the bridge writes the
 * line as
 *
 *     "  - <name>: <quantity> (exp <day>) [<category>]"
 *
 * so the quantity is the text between the name and the expiry. Reading it
 * back out of the line the model actually received is what makes this a test
 * of the bridge and not of a helper.
 *
 * @param {string} sys the system message
 * @param {string} name the item's name
 * @returns {string} the quantity, or '' when the item is not in the block
 */
function quantityIn(sys, name) {
  const line = sys.split('\n').find((l) => l.startsWith(`  - ${name}:`));
  if (!line) return '';
  const after = line.slice(`  - ${name}:`.length);
  const stop = after.indexOf(' (exp');
  return stop === -1 ? after.trim() : after.slice(0, stop);
}

/**
 * Everything the test does with the bridge copy.
 *
 * WHY IT IS A FUNCTION AND NOT THE TOP LEVEL OF THE MODULE: the bridge copy
 * is started before this is called, and the cleanup that stops it has to run
 * whatever happens in here. A function can be wrapped in a try/finally; the
 * top level of a module cannot.
 *
 * @returns {Promise<void>} resolves when the checks are done
 */
async function runChecks() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${bridgePort}/healthz`);
      if (r.ok) { bridgeUp = true; break; }
    } catch { /* not up yet */ }
    await sleep(100);
  }

  if (!bridgeUp) {
    console.error('the bridge did not start');
    if (bridgeErr) console.error(bridgeErr.slice(0, 800));
    failed += 1;
    return;
  }

  for (const route of ROUTES) {
    const sys = await systemPromptFor(route);
    console.log(`\nthe ${route} route tells the model the quantity the app's way`);

    for (const item of STOCK) {
      const expected = formatQuantity(item.quantity, item.unit);
      // THE RAW TEXT, not the trimmed text: the quantity the bridge wrote is
      // what sits between the name and the expiry, and a unit of nothing but
      // spaces leaves the padding in that gap. Trimming it away here would
      // hide the very hole the test is looking for.
      const raw = quantityIn(sys, item.name);
      ok(
        raw.trim() === expected,
        `the model is told "${expected}" for ${item.name}`,
        raw.trim() === expected ? raw.trim() : `the model was told "${raw.trim()}"`,
      );
      // THE HOLE ITSELF, named. A unit that is not there must not leave a run
      // of spaces where it would have been.
      ok(
        !/\s{2,}/.test(raw),
        `${item.name} has no run of spaces where a unit would be`,
        /\s{2,}/.test(raw) ? `the model was told "${raw}"` : '',
      );
      // THE NUMBER AND THE UNIT ARE SEPARATED. A quantity of one with a plural
      // unit ran together — "1bottles" — and the model repeats what it is
      // given.
      if (item.unit.trim()) {
        ok(
          !raw.includes(`${item.quantity}${item.unit}`),
          `${item.name} does not run the number into the unit`,
          raw.includes(`${item.quantity}${item.unit}`)
            ? `the model was told "${raw.trim()}"`
            : '',
        );
      }
    }
  }
}

// WHY THE TEST IS WRAPPED: the bridge copy is started INSIDE this block, and
// the cleanup that stops it is in the `finally`. Between the two there are
// fetches and assertions, and any of them can throw — and a throw is exactly
// when the test is least likely to be watched. A throw that skips the
// cleanup leaves a bridge copy running on a port of its own, with a work
// directory that was removed from under it.
try {
  bridgePort = await freePort();
  bridge = deps
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
          // The bridge looks up recipes on the web for some questions. The test
          // asks about the kitchen, and must not wait on a search engine.
          BRAVE_API_KEY: '',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    : null;
  bridge?.stderr.on('data', (d) => { bridgeErr += d.toString(); });

  await runChecks();
} catch (err) {
  failed += 1;
  console.log(`  FAIL the test threw — ${err && err.message ? err.message : err}`);
} finally {
  // WHY THE BRIDGE IS STOPPED AND NOT JUST KILLED: `kill` only asks, and a
  // bridge that is still winding down holds its port for a moment longer —
  // and a bridge that was never stopped holds it for ever.
  await stopBridge();
  rmSync(work, { recursive: true, force: true });
  model.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(bridgeUp ? (failed === 0 ? 0 : 1) : 2);
