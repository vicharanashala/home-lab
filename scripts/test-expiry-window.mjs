/**
 * The expiry window is ONE setting, and every screen must read it the same way.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `settings.expiringSoonDays` is the number the Alerts screen uses to decide
 * what to flag ("How many days before expiry an item should be flagged"), and
 * the Dashboard and the Stock screen read the same setting. The bridge — the
 * thing that tells House Bot what is expiring — did not:
 *
 *   - the bridge counted a fixed three days, whatever the household had set;
 *   - and the app never even sent the setting to the bridge.
 *
 * So a household that widened the window to a week (the Alerts slider goes
 * from 1 to 14) saw "6 items expiring within 7 days" on the Alerts screen
 * while House Bot's EXPIRING SOON block quietly listed only the next three
 * days — and the same item read "expiring soon" on one screen and was missing
 * from the other.
 *
 * That is the exact failure the app's own `src/utils/expiryRecipes.ts` warns
 * about: "the two must agree, or the same item reads 'expires tomorrow' on
 * one screen and 'expires today' on another."
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a fake model that keeps the
 * request it was sent, and reads the EXPIRING SOON block out of the system
 * prompt the model actually received. Then it asks the question the app
 * itself would ask — `expiryBucket(expiryDate, window)` from the app's own
 * `src/utils/date.ts` — and demands the same answer.
 *
 * So the check is not "the bridge mentions a number". The check is: for every
 * window, the bridge and the screen agree.
 *
 * It checks both chat routes, because there are two of them and each builds
 * its own copy of the context block.
 *
 * Run with:  node scripts/test-expiry-window.mjs
 */
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync, existsSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const bridgeDir = join(repo, 'bridge', 'shift ');

// The app's own rule for "is this expiring soon". The bridge has to agree
// with this, so it is imported rather than restated.
const { expiryBucket } = await import('../src/utils/date.ts');

// The two app-side readers of the same rule.
const { recipesUsingExpiringStock } = await import('../src/utils/expiryRecipes.ts');
const { suggestMeals } = await import('../src/utils/mealSuggest.ts');

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

// ── days, on the local calendar, the way the app writes them ─────────────
//
// WHY LOCAL: src/utils/date.ts counts with `differenceInCalendarDays` and
// writes with `format(d, 'yyyy-MM-dd')`, both local. A fixture built on UTC
// days would be a day the app would never write.
const localDay = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dayMs = 86_400_000;

const IN_TWO_DAYS = localDay(new Date(Date.now() + 2 * dayMs));
const IN_FIVE_DAYS = localDay(new Date(Date.now() + 5 * dayMs));
const IN_SIXTY_DAYS = localDay(new Date(Date.now() + 60 * dayMs));
const EIGHT_DAYS_AGO = localDay(new Date(Date.now() - 8 * dayMs));

// Four items, so every window has something in it AND something out of it:
//
//   Curd  — 2 days  : inside a 3-day window and a 7-day window
//   Mango — 5 days  : inside a 7-day window, OUTSIDE a 3-day window
//   Rice  — 60 days : outside every window anyone can set
//   Milk  — 8 days ago : past its date, and the Alerts screen files it
//                         under "Expired", not under "expiring soon"
//
// WHY IT NEEDS BOTH KINDS: a fixture with only an inside item cannot tell
// "the bridge used the window I sent" from "the bridge used some other
// window that also happened to include it". Mango is the item that separates
// a 7-day window from a 3-day one, so it is the one the checks lean on.
const stock = [
  { id: 'stk_1', name: 'Curd', quantity: 2, unit: 'pcs', category: 'dairy', expiryDate: IN_TWO_DAYS },
  { id: 'stk_2', name: 'Mango', quantity: 3, unit: 'pcs', category: 'fruit', expiryDate: IN_FIVE_DAYS },
  { id: 'stk_3', name: 'Rice', quantity: 1, unit: 'kg', category: 'staples', expiryDate: IN_SIXTY_DAYS },
  { id: 'stk_4', name: 'Milk', quantity: 1, unit: 'pcs', category: 'dairy', expiryDate: EIGHT_DAYS_AGO },
];

// ── the fake model ───────────────────────────────────────────────────────
//
// It keeps every request it is sent, because the context block — and with it
// the EXPIRING SOON list — is only ever seen by the model.
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
const work = mkdtempSync(join(tmpdir(), 'hh-expiry-window-'));
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

/** The system prompt of the last request the model was sent. */
function lastSystemPrompt() {
  for (let i = requests.length - 1; i >= 0; i--) {
    const messages = requests[i]?.messages;
    if (!Array.isArray(messages)) continue;
    const system = messages.find((m) => m?.role === 'system');
    if (typeof system?.content === 'string' && system.content.includes('STOCK (')) {
      return system.content;
    }
  }
  return '';
}

/**
 * The EXPIRING SOON line of the context block.
 *
 * It is one line — a comma-separated list of the items — so it is read on
 * its own rather than as a section with indented lines under it.
 */
function expiringSoonLine(prompt) {
  return prompt.split('\n').find((l) => l.startsWith('EXPIRING SOON')) ?? '';
}

/**
 * Ask one route, with the settings the app would send.
 *
 * @param {string} route which chat route to ask
 * @param {object} settings the settings the app sends to the bridge
 * @returns {Promise<string>} the system prompt the model was sent
 */
async function ask(route, settings) {
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/chat${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'my kitchen stock and meals',
      history: [],
      context: { stock, grocery: [], recentMeals: [], settings },
    }),
  });
  await res.text();
  await sleep(250);
  return lastSystemPrompt();
}

/**
 * Stop the bridge copy.
 *
 * WHY THE TIME-OUTS: a bridge that will not die leaves the port held and the
 * next test cannot start. SIGTERM first, SIGKILL if it ignored that.
 */
async function stopBridge() {
  if (!bridge) return;
  const exited = new Promise((resolve) => bridge.once('exit', resolve));
  bridge.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), sleep(2000).then(() => false)]);
  if (stopped) return;
  bridge.kill('SIGKILL');
  await Promise.race([exited, sleep(2000)]);
}

// ── the checks ───────────────────────────────────────────────────────────

/**
 * The checks, run against one route's context block.
 *
 * @param {string} label which route is being checked
 * @param {string} prompt the system prompt that route sent the model
 */
function checkRoute(label, prompt) {
  const soon = expiringSoonLine(prompt);
  ok(soon.length > 0, `${label}: the model is sent an EXPIRING SOON line`, soon.slice(0, 160));

  // The window the household set, and the window the app's own rule would
  // use for that same item. These have to be the same window.
  const window = 7;
  const appSaysSoon = expiryBucket(IN_FIVE_DAYS, window) === 'soon';
  const bridgeListsMango = soon.includes('Mango');

  ok(
    appSaysSoon,
    `${label}: the app's own rule says the item is expiring soon at a ${window}-day window`,
    `expiryBucket(${IN_FIVE_DAYS}, ${window}) = ${expiryBucket(IN_FIVE_DAYS, window)}`,
  );
  ok(
    bridgeListsMango === appSaysSoon,
    `${label}: the bridge and the screen agree about the item in a ${window}-day window`,
    `bridge: ${bridgeListsMango ? 'lists' : 'does not list'} it; screen: ${appSaysSoon ? 'flags' : 'does not flag'} it`,
  );
  ok(
    soon.includes(IN_FIVE_DAYS),
    `${label}: the item in the window says when it expires`,
    soon.slice(0, 160),
  );
  ok(
    soon.includes('Curd'),
    `${label}: the item inside every window is named`,
    soon.slice(0, 160),
  );
  ok(
    !soon.includes('Rice'),
    `${label}: an item far outside the window is not called expiring soon`,
    soon.slice(0, 160),
  );

  // An item whose date has passed. The Alerts screen files those under
  // "Expired", never under "expiring soon" — so the block must not call an
  // item that went off eight days ago "expiring soon (within 7 days)".
  ok(
    expiryBucket(EIGHT_DAYS_AGO, window) === 'expired',
    `${label}: the app's own rule calls a past date expired, not expiring soon`,
    `expiryBucket(${EIGHT_DAYS_AGO}, ${window}) = ${expiryBucket(EIGHT_DAYS_AGO, window)}`,
  );
  ok(
    !soon.includes('Milk'),
    `${label}: an item that is already past its date is not called expiring soon`,
    soon.slice(0, 160),
  );

  // The block names its own window, so the model can say "within 7 days"
  // rather than implying the list is what is going off today.
  ok(
    soon.includes(`${window} day`),
    `${label}: the block says what window it is talking about`,
    soon.slice(0, 160),
  );
}

/**
 * The checks on the app side of the rule.
 *
 * WHY THESE ARE HERE AND NOT ONLY THE BRIDGE'S: the rule is read in three
 * places in the app itself — the Alerts screen, the Meal Plan's "rescues
 * what is about to go off" strip, and the suggestion ranking that boosts
 * those dishes — and they have to read the SAME window. The strip and the
 * suggestions sit on the same screen, so when they disagreed the owner saw
 * a dish offered as a way to use up food that was expiring, and the
 * suggestion next to it did not say so.
 *
 * @param {string} label which app surface is being checked
 */
function checkAppSide(label) {
  // One dish, and the one ingredient it uses, expiring in five days. At a
  // seven-day window that ingredient is about to go off; at a three-day
  // window it is not.
  const catalogue = [
    {
      id: 'rec_1',
      name: 'Mango Lassi',
      emoji: '🥭',
      mealType: 'dinner',
      baseServings: 2,
      ingredients: [{ name: 'Mango', quantity: 1, unit: 'pcs', category: 'fruits' }],
    },
  ];
  const appStock = [
    {
      id: 'stk_1',
      name: 'Mango',
      quantity: 3,
      unit: 'pcs',
      category: 'fruits',
      expiryDate: IN_FIVE_DAYS,
      lowStockThreshold: 1,
      createdAt: 0,
      updatedAt: 0,
    },
  ];

  const wide = recipesUsingExpiringStock(catalogue, appStock, 7, 6);
  const narrow = recipesUsingExpiringStock(catalogue, appStock, 3, 6);
  ok(
    wide.length === 1,
    `${label}: a 7-day window offers the dish that uses up food expiring in 5 days`,
    `${wide.length} dish(es)`,
  );
  ok(
    narrow.length === 0,
    `${label}: a 3-day window does not`,
    `${narrow.length} dish(es)`,
  );

  // The suggestion ranking reads the same rule, so the dish it offers as a
  // way to use up food has to be the same dish.
  const base = {
    slot: 'dinner',
    catalogue,
    stock: appStock,
    mealLogs: [],
    embeddings: null,
    mealPlan: undefined,
    diet: 'no-preference',
    allergies: [],
    limit: 3,
  };
  const wideSuggest = suggestMeals({ ...base, expiringSoonDays: 7 });
  const narrowSuggest = suggestMeals({ ...base, expiringSoonDays: 3 });
  ok(
    wideSuggest.some((s) => s.reason === 'expiring'),
    `${label}: a 7-day window makes the dish a suggestion that uses up food`,
    wideSuggest.map((s) => `${s.recipe.name}:${s.reason}`).join(', ').slice(0, 120),
  );
  ok(
    !narrowSuggest.some((s) => s.reason === 'expiring'),
    `${label}: a 3-day window does not`,
    narrowSuggest.map((s) => `${s.recipe.name}:${s.reason}`).join(', ').slice(0, 120),
  );

  // And the page has to hand the household's window to both of them.
  const mealPlanSource = readFileSync(join(repo, 'src/pages/MealPlan.tsx'), 'utf8');
  ok(
    /recipesUsingExpiringStock\(catalogue, stock, settings\.expiringSoonDays/.test(mealPlanSource),
    `${label}: the rescue strip is given the household's window`,
  );
  ok(
    /expiringSoonDays: settings\.expiringSoonDays/.test(mealPlanSource),
    `${label}: the suggestion ranking is given the household's window`,
  );
}

/**
 * The window a narrower setting gives.
 *
 * WHY THIS MATTERS: a bridge that always used three days would pass the
 * seven-day check above by accident if the fixtures were chosen badly. At a
 * three-day window the same item is NOT expiring soon, and the two answers
 * must differ.
 *
 * @param {string} label which route is being checked
 * @param {string} prompt the system prompt that route sent the model
 */
function checkNarrower(label, prompt) {
  const soon = expiringSoonLine(prompt);
  const appSaysSoon = expiryBucket(IN_FIVE_DAYS, 3) === 'soon';
  ok(
    !appSaysSoon,
    `${label}: the app's own rule does not flag the item at a 3-day window`,
    `expiryBucket(${IN_FIVE_DAYS}, 3) = ${expiryBucket(IN_FIVE_DAYS, 3)}`,
  );
  ok(
    !soon.includes('Mango'),
    `${label}: the bridge does not flag the item at a 3-day window either`,
    soon.slice(0, 160),
  );
  ok(
    soon.includes('Curd'),
    `${label}: the item inside every window is still flagged`,
    soon.slice(0, 160),
  );
  ok(
    soon.includes('3 day'),
    `${label}: the block names the narrower window`,
    soon.slice(0, 160),
  );
}

// ── run ──────────────────────────────────────────────────────────────────

try {
  if (!deps) {
    ok(false, 'the bridge copy starts', 'the bridge dependencies (express) could not be found');
  } else if (!bridgeUp) {
    ok(false, 'the bridge copy starts', bridgeErr.slice(0, 300));
  } else {
    // The setting the app sends. The frontend has to send it, or the bridge
    // has nothing to read — so that is checked first, on the source.
    const houseBotSource = readFileSync(join(repo, 'src/pages/HouseBot.tsx'), 'utf8');
    const contextSettings = houseBotSource.match(/settings:\s*\{[^}]*\}/s);
    ok(
      Boolean(contextSettings) && /expiringSoonDays/.test(contextSettings[0]),
      'the app sends the expiry window to the bridge',
      contextSettings ? contextSettings[0].replace(/\s+/g, ' ').slice(0, 160) : 'no settings block found',
    );

    checkAppSide('the Meal Plan screen');

    for (const route of ['', '/stream']) {
      const label = route ? 'the streaming route' : 'the chat route';

      const wide = await ask(route, {
        userName: 'Friend',
        dietaryPreference: 'none',
        allergies: [],
        expiringSoonDays: 7,
      });
      checkRoute(label, wide);

      const narrow = await ask(route, {
        userName: 'Friend',
        dietaryPreference: 'none',
        allergies: [],
        expiringSoonDays: 3,
      });
      checkNarrower(label, narrow);

      // An app that is older, or a client that sends nothing, must still get
      // the window the bridge has always used rather than an empty list.
      const missing = await ask(route, {
        userName: 'Friend',
        dietaryPreference: 'none',
        allergies: [],
      });
      const missingSoon = expiringSoonLine(missing);
      ok(
        missingSoon.includes('Curd') && !missingSoon.includes('Mango'),
        `${label}: a request with no window falls back to the default`,
        missingSoon.slice(0, 160),
      );

      // A nonsense window must not become a nonsense window.
      const nonsense = await ask(route, {
        userName: 'Friend',
        dietaryPreference: 'none',
        allergies: [],
        expiringSoonDays: 'not a number',
      });
      const nonsenseSoon = expiringSoonLine(nonsense);
      ok(
        nonsenseSoon.includes('Curd') && !nonsenseSoon.includes('Mango'),
        `${label}: a nonsense window falls back to the default`,
        nonsenseSoon.slice(0, 160),
      );

      // A window of zero, or a negative one, is not a window. It must not
      // become "everything expires" or "nothing expires".
      const zero = await ask(route, {
        userName: 'Friend',
        dietaryPreference: 'none',
        allergies: [],
        expiringSoonDays: 0,
      });
      const zeroSoon = expiringSoonLine(zero);
      ok(
        zeroSoon.includes('Curd') && !zeroSoon.includes('Mango'),
        `${label}: a zero window falls back to the default`,
        zeroSoon.slice(0, 160),
      );
    }
  }
} catch (err) {
  failed += 1;
  console.log(`  FAIL the run threw — ${err && err.message ? err.message : String(err)}`);
}

await stopBridge();
rmSync(work, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
