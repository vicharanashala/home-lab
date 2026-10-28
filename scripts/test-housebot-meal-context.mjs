/**
 * Tests that House Bot is told what the person actually ate, and when
 * their food expires.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The bridge builds the context it hands the model, and for the two things
 * that describe the kitchen it read field names the app never writes:
 *
 *   a meal log   { id, mealType, description, createdAt, recipeId?, ... }
 *   a stock item { id, name, quantity, unit, category, expiryDate?, ... }
 *
 * The context block read:
 *
 *   `  - ${m.date || m.createdAt}: ${m.title || (m.recipeIds ? ... : 'meal')}`
 *   `... ${s.expiresOn ? ` (exp ${s.expiresOn})` : ''} ...`
 *   stock.filter((s) => s.expiresOn && s.expiresOn <= addDays(today, 3))
 *
 * `date`, `title`, `recipeIds` and `expiresOn` are not fields of a meal log
 * or a stock item. Not one of them has ever been — a meal log has had
 * `description` and `createdAt` since the first commit, and a stock item has
 * had `expiryDate` since the first commit.
 *
 * So the RECENT MEALS block came out as:
 *
 *   - 1792497600000: meal
 *
 * A raw epoch timestamp and the word "meal". The dish was never sent, the
 * day was never sent, and the model was asked to ground its answers in what
 * the person had been eating while being told they had eaten "meal" — never
 * what, never when.
 *
 * And the EXPIRING SOON block was always empty, and no stock line ever
 * carried its expiry date, because `expiresOn` was never there to be read.
 * House Bot could not answer "what needs using up today?" — it had never
 * been told that anything in the kitchen had an expiry date at all.
 *
 * WHY IT MATTERS ENOUGH TO FIX: House Bot's whole promise is that it knows
 * the kitchen. "What did I eat last night?" has no answer without the meal
 * block, and "what should I cook tonight, not again this week?" is answered
 * wrong rather than not at all. "What has to be used up?" is the same.
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a fake model that keeps the
 * request it was sent, asks both chat routes the same question with one
 * meal log and two stock items in the app's real shapes, and reads the
 * blocks out of the system prompt the model actually received.
 *
 * It checks both routes, because there are two of them and each builds its
 * own copy of the context block.
 *
 * Run with:  node scripts/test-housebot-meal-context.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
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

// ── the records the app would have written ───────────────────────────────
//
// THE SHAPE IS THE POINT: these are the field names the store writes
// (useStore.ts — addMealLog, logMealFromRecipe, logMealFromRecipes) and
// the ones it reads back on import. A test that used different names would
// pass against a bridge that is still broken.
const DISH = 'Palak paneer with 2 rotis';
const MEAL_TYPE = 'dinner';
// Noon UTC, so the date is the same in UTC and in IST and the assertion
// does not depend on which one the bridge formats in.
const EATEN_AT = Date.UTC(2026, 9, 20, 12, 0, 0);
const EATEN_ON = '2026-10-20';

const mealLog = {
  id: 'meal_1',
  mealType: MEAL_TYPE,
  description: DISH,
  createdAt: EATEN_AT,
  recipeId: 'rcp_1',
  servings: 2,
};

// A meal eaten just after midnight, on the LOCAL calendar day.
//
// WHY THIS ONE IS HERE: the bridge dated a meal with toISOString(), which is
// UTC. A meal eaten at 2am in IST is 8:30pm the PREVIOUS day in UTC, so the
// bridge dated it a day early — the Dashboard showed the meal under today's
// meals while House Bot was told the meal was eaten the night before, and
// "what did I eat last night?" had no honest answer. The app dates
// everything on the local calendar day (src/utils/date.ts: toISODate and
// daysUntil), so the bridge has to count days the same way.
//
// WHY A DIFFERENT DAY FROM THE MEAL ABOVE: so that each assertion pins one
// meal, and neither can be satisfied by the other's line.
//
// The day is built from LOCAL parts, so it is 2am wherever the test runs.
const EARLY_MEAL_AT = new Date(2026, 9, 19, 2, 0, 0).getTime();
const EARLY_MEAL_ON = '2026-10-19';
// What the same instant is called in UTC. Where the machine's clock runs at
// or ahead of UTC this is the PREVIOUS day, and the block must not use it.
const EARLY_MEAL_UTC_ON = new Date(EARLY_MEAL_AT).toISOString().slice(0, 10);

const earlyMealLog = {
  id: 'meal_2',
  mealType: 'dinner',
  description: 'Dal and rice',
  createdAt: EARLY_MEAL_AT,
};

// The bridge decides what is "expiring soon" by comparing against its own
// today, so the dates here are relative to the day the test runs. The
// window is three days, so two days is inside it and sixty days is not.
//
// WHY LOCAL: the app writes an expiry date as a LOCAL calendar day —
// src/utils/date.ts `todayISO()` is `format(new Date(), 'yyyy-MM-dd')` — so
// the fixture has to be local days too. A UTC day here would be a day the
// app would never write, and the bridge would be comparing the screen's
// calendar against a different one.
const dayMs = 86_400_000;
const isoDay = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const SOON_ON = isoDay(Date.now() + 2 * dayMs);
const LATER_ON = isoDay(Date.now() + 60 * dayMs);

const stock = [
  { id: 'stk_1', name: 'Milk', quantity: 2, unit: 'pcs', category: 'dairy', expiryDate: SOON_ON },
  { id: 'stk_2', name: 'Rice', quantity: 1, unit: 'kg', category: 'staples', expiryDate: LATER_ON },
];

// ── the fake model ───────────────────────────────────────────────────────
//
// It keeps every request it is sent, because the system prompt — and with
// it the context block — is only ever seen by the model.
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
const work = mkdtempSync(join(tmpdir(), 'hh-housebot-meals-'));
const home = join(work, 'home');
mkdirSync(home, { recursive: true });
copyFileSync(join(bridgeDir, 'index.mjs'), join(work, 'index.mjs'));
copyFileSync(join(bridgeDir, 'openclaw-cli.mjs'), join(work, 'openclaw-cli.mjs'));

// A past conversation, dated the same way the early meal is: on the LOCAL
// calendar day. The bridge keeps these under HOME/.vision-overwatch, and
// HOME points at the temporary directory, so this file is the one the bridge
// copy will read.
//
// WHY IT IS HERE: the block dates past conversations too, and it dated them
// with toISOString() — UTC. A late-night chat with House Bot happened on the
// local day, and a block that dated the meals locally and the conversations
// in UTC would show the model two different calendars in one prompt.
const memoryDir = join(home, '.vision-overwatch');
mkdirSync(memoryDir, { recursive: true });
writeFileSync(
  join(memoryDir, 'housebot-memory.json'),
  JSON.stringify([{ ts: EARLY_MEAL_AT, summary: 'Asked about using up the milk' }]),
);

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

/** The system prompt of the last request the model was sent. */
function lastSystemPrompt() {
  for (let i = requests.length - 1; i >= 0; i--) {
    const messages = requests[i]?.messages;
    if (!Array.isArray(messages)) continue;
    const system = messages.find((m) => m?.role === 'system');
    if (typeof system?.content === 'string' && system.content.includes('RECENT MEALS')) {
      return system.content;
    }
  }
  return '';
}

/**
 * One section of the context block.
 *
 * A section is a header line and the indented lines under it, so the STOCK
 * block and the RECENT MEALS block are read whole, and a one-line section
 * such as EXPIRING SOON is read on its own.
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

/**
 * The lines of the PAST CONVERSATIONS block.
 *
 * WHY NOT `section`: that helper reads the indented lines that start with
 * "  - ", which is how the meal and stock blocks are written. The memory
 * block numbers its entries instead — "  [1] (2026-10-19): ..." — so it
 * needs its own reader.
 */
function memorySection(prompt) {
  const lines = prompt.split('\n');
  const start = lines.findIndex((l) => l.startsWith('PAST CONVERSATIONS'));
  if (start === -1) return '';
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].startsWith('  [')) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

const CONTEXT = { recentMeals: [mealLog, earlyMealLog], stock };

// WHY THIS MESSAGE: the bridge runs a web search for anything that reads as
// a knowledge question, and the test has no web to search. A message that
// triggers nothing keeps the test to the one thing it is about.
const QUESTION = 'my kitchen stock and meals';

/**
 * Ask one route, and report the local day on either side of the request.
 *
 * WHY THE DAY IS CAPTURED TWICE: the bridge names its own "today" in the
 * LIVE CONTEXT header, and it names it when the request arrives. If the
 * request straddles local midnight, the bridge's today and the test's today
 * are two different days and the comparison would fail for a reason that
 * has nothing to do with the code. Capturing the day on both sides lets the
 * check stand down when midnight passed under it.
 *
 * @returns {Promise<{dayBefore: string, dayAfter: string}>} the days
 */
async function askChat() {
  const dayBefore = isoDay(Date.now());
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: QUESTION, history: [], context: CONTEXT }),
  });
  await res.text();
  return { dayBefore, dayAfter: isoDay(Date.now()) };
}

async function askChatStream() {
  // The same day either side of the request as `askChat` — see the note there.
  const dayBefore = isoDay(Date.now());
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: QUESTION, history: [], context: CONTEXT }),
  });
  await res.text();
  return { dayBefore, dayAfter: isoDay(Date.now()) };
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
  const exited = new Promise((resolve) => bridge.once('exit', resolve));
  bridge.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), sleep(2000).then(() => false)]);
  if (stopped) return;
  bridge.kill('SIGKILL');
  await Promise.race([exited, sleep(2000)]);
}

/**
 * The checks, run against one route's context block.
 *
 * @param {string} label which route is being checked
 * @param {string} prompt the system prompt that route sent the model
 * @param {{dayBefore: string, dayAfter: string}} days the local day either
 *   side of the request, so a check can stand down if midnight passed under it
 */
function checkBlock(label, prompt, days) {
  const meals = section(prompt, 'RECENT MEALS');
  ok(meals.length > 0, `${label}: the model is sent the recent meals`, meals.slice(0, 120));
  ok(meals.includes(DISH), `${label}: the block names the dish that was eaten`, meals.slice(0, 160));
  ok(
    meals.includes(EATEN_ON),
    `${label}: the block says when it was eaten, as a date`,
    meals.slice(0, 160),
  );
  ok(
    !meals.includes(String(EATEN_AT)),
    `${label}: the block does not show a raw timestamp to the model`,
    meals.slice(0, 160),
  );
  ok(
    !/: meal\b/.test(meals),
    `${label}: the block does not call the dish "meal"`,
    meals.slice(0, 160),
  );

  // The meal eaten just after midnight. It is on a day of its own, so this
  // can only be satisfied by the right line, and it is the case the bridge's
  // UTC formatting got wrong.
  ok(
    meals.includes(EARLY_MEAL_ON),
    `${label}: a meal eaten just after midnight is dated on the day the app shows`,
    meals.slice(0, 200),
  );
  if (EARLY_MEAL_UTC_ON !== EARLY_MEAL_ON) {
    ok(
      !meals.includes(EARLY_MEAL_UTC_ON),
      `${label}: the meal is not dated on the UTC day the app never shows`,
      meals.slice(0, 200),
    );
  }

  const stockBlock = section(prompt, 'STOCK (');
  ok(
    stockBlock.includes(`(exp ${SOON_ON})`),
    `${label}: a stock line carries the day it expires`,
    stockBlock.slice(0, 200),
  );
  ok(
    stockBlock.includes(`(exp ${LATER_ON})`),
    `${label}: every stock line carries the day it expires`,
    stockBlock.slice(0, 200),
  );

  const soon = section(prompt, 'EXPIRING SOON');
  ok(soon.length > 0, `${label}: the model is sent what is expiring soon`, soon.slice(0, 160));
  ok(soon.includes('Milk'), `${label}: the item expiring soon is named`, soon.slice(0, 160));
  ok(
    soon.includes(SOON_ON),
    `${label}: the item expiring soon says when it expires`,
    soon.slice(0, 160),
  );
  ok(
    !soon.includes('Rice'),
    `${label}: an item expiring in sixty days is not called expiring soon`,
    soon.slice(0, 160),
  );

  // The block's own "today" is the day the app calls today — the same day
  // the expiry window above is counted on.
  //
  // WHY IT STANDS DOWN WHEN MIDNIGHT PASSED: the bridge named its today
  // when the request arrived and the test names its today after the answer
  // came back. If the two straddle local midnight they are a day apart for
  // a reason that has nothing to do with the code, so the check is skipped
  // rather than failed.
  if (days.dayBefore === days.dayAfter) {
    ok(
      prompt.includes(`LIVE CONTEXT (${days.dayBefore})`),
      `${label}: the block's own today is the day the app calls today`,
      prompt.split('\n').find((l) => l.includes('LIVE CONTEXT')) || '',
    );
  }

  // A past conversation is dated on the local day too, so the block shows
  // the model one calendar rather than two.
  const memory = memorySection(prompt);
  ok(memory.length > 0, `${label}: the model is sent the past conversations`, memory.slice(0, 160));
  ok(
    memory.includes(EARLY_MEAL_ON),
    `${label}: a past conversation is dated on the day it happened`,
    memory.slice(0, 160),
  );
  if (EARLY_MEAL_UTC_ON !== EARLY_MEAL_ON) {
    ok(
      !memory.includes(EARLY_MEAL_UTC_ON),
      `${label}: the conversation is not dated on the UTC day the app never shows`,
      memory.slice(0, 160),
    );
  }
}

// WHY THE TEST IS WRAPPED: the bridge copy is started above, and the
// cleanup that stops it is below. Between the two there are fetches and
// assertions, and any of them can throw — and a throw is exactly when the
// test is least likely to be watched. A throw that skips the cleanup
// leaves a bridge copy running on a port of its own.
try {
  console.log('\nHouse Bot is told what the person ate, and what is expiring');
  if (!deps) {
    console.log('  SKIP the bridge is not installed here — its dependencies could not be found');
  } else if (!bridgeUp) {
    ok(false, 'the bridge copy starts', bridgeErr.slice(0, 300));
  } else {
    const chatDays = await askChat();
    await sleep(200);
    checkBlock('the chat route', lastSystemPrompt(), chatDays);

    const streamDays = await askChatStream();
    await sleep(200);
    checkBlock('the streaming route', lastSystemPrompt(), streamDays);
  }
} catch (err) {
  failed += 1;
  console.log(`  FAIL the test threw — ${err?.message || err}`);
} finally {
  await stopBridge();
  model.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
