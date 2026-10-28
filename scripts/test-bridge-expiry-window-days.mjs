/**
 * The expiry window, written the same way for House Bot as it is for the app.
 *
 * THE BUG
 *
 * The household's expiry window is a number of days, and the household can set
 * it to ONE day — the slider on the Alerts screen and the slider on the
 * Settings screen both start at 1, and "1" is the first notch on both.
 *
 * The app got that right. `formatDays` in src/utils/date.ts writes the number
 * and the word that goes with it, and every screen that shows the window calls
 * it, so the narrowest window the app offers is read as "1 day" on the Meal
 * Plan, on the Alerts screen, on the Dashboard and in Settings.
 *
 * The BRIDGE did not. The context block it hands the model writes the window
 * in its own words:
 *
 *     "bridge/shift /index.mjs"
 *       `EXPIRING SOON (within ${soonWindow} days): ...`
 *
 * and that line appears TWICE — once in /api/housebot/chat and once in
 * /api/housebot/chat/stream — because each route builds its own copy of the
 * context block.
 *
 * So a household that narrowed its window to a single day was told, in the
 * same kitchen:
 *
 *     the Alerts screen    "Within 1 day (2)"
 *     House Bot            "EXPIRING SOON (within 1 days): Milk, Spinach"
 *
 * The same number, written two ways, about one kitchen — and the wrong one is
 * the one the MODEL reads, so it is the one that comes back as the answer.
 *
 * WHY IT IS WORTH A RULE AND NOT A TYPO FIX: this repo has already been here
 * twice with the same shape of bug. Commit 7b0b0e4 ("Say '1 day', not '1
 * days', wherever the expiry window is written") fixed the app and tested
 * only the app — and `scripts/test-expiry-window-days.mjs` renders the four
 * screens, none of which is this one. And
 * `scripts/test-bridge-screen-window-wording.mjs` exists because the bridge
 * said "a browser tab" after the app had started asking for a window: the
 * commit that fixed the app half tested only the app half, so nothing went
 * red when the bridge half was left behind.
 *
 * The rule is the same both times: the bridge is one of the places the window
 * is written, so it is one of the places the rule has to hold.
 *
 * WHAT IS TESTED HERE
 *
 * It runs a real copy of the bridge against a fake model that captures the
 * request, sends the context the app sends, and asks what the bridge told
 * the model:
 *
 *   - a one-day window reads "within 1 day", never "within 1 days";
 *   - a three-day window still reads "within 3 days" — the plural is not
 *     simply gone;
 *   - BOTH chat routes say the same thing, because they build the context
 *     block separately and have drifted before.
 *
 * Run with:  node scripts/test-bridge-expiry-window-days.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
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

// ── a copy of the bridge, on a spare port ────────────────────────────────
//
// A COPY, not the real one: the test must not talk to the bridge serving the
// owner's link, and must not write to the real data directory. HOME points
// at a temporary directory so everything the bridge keeps lands there.
const work = mkdtempSync(join(tmpdir(), 'hh-bridge-expiry-days-'));
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
        // The bridge looks up recipes on the web for some questions. The test
        // asks about the kitchen, and must not wait on a search engine.
        BRAVE_API_KEY: '',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
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
 * The kitchen the test talks about.
 *
 * WHY THESE THREE ITEMS: one inside a one-day window (tomorrow), one inside
 * a three-day window but not a one-day window (the day after tomorrow), and
 * one whose date has already passed — which the bridge must NOT call
 * "expiring soon", because that is the other half of the same rule.
 */
function stockFor() {
  return [
    { id: 'a', name: 'Milk', quantity: 1, unit: 'l', expiryDate: localDay(1), category: 'dairy' },
    { id: 'b', name: 'Spinach', quantity: 1, unit: 'bunch', expiryDate: localDay(2), category: 'veg' },
    { id: 'c', name: 'Old Yoghurt', quantity: 1, unit: '', expiryDate: localDay(-2), category: 'dairy' },
  ];
}

/**
 * Send a message to one of the chat routes and return the system prompt the
 * bridge built for the model.
 *
 * @param {string} route 'chat' or 'chat/stream'
 * @param {number} windowDays the household's expiry window
 * @returns {Promise<string>} the system message
 */
async function systemPromptFor(route, windowDays) {
  const before = captured.length;
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'what is going off?',
      history: [],
      context: {
        stock: stockFor(),
        grocery: [],
        recentMeals: [],
        settings: { expiringSoonDays: windowDays },
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
 * The EXPIRING SOON line out of a system prompt.
 *
 * @param {string} sys the system message
 * @returns {string} the line, or '' when there is none
 */
function expiringSoonLine(sys) {
  const line = sys.split('\n').find((l) => l.startsWith('EXPIRING SOON'));
  return line || '';
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

console.log('\nthe bridge writes the expiry window the same way the app does');

if (!bridgeUp) {
  console.log(`  FAIL the bridge copy did not start${bridgeErr ? ' — ' + bridgeErr.trim().split('\n').slice(-2).join(' ') : ''}`);
  failed += 1;
} else {
  for (const route of ['chat', 'chat/stream']) {
    const one = await systemPromptFor(route, 1);
    const line = expiringSoonLine(one);

    ok(line !== '', `the ${route} route writes the EXPIRING SOON line`, line || '(no line)');
    ok(
      !/\b1 days\b/.test(one),
      `the ${route} route does not say "1 days"`,
      line,
    );
    ok(
      /\bwithin 1 day\b/.test(one),
      `the ${route} route says "within 1 day"`,
      line,
    );

    const three = await systemPromptFor(route, 3);
    const threeLine = expiringSoonLine(three);
    ok(
      /\bwithin 3 days\b/.test(three),
      `the ${route} route still says "within 3 days"`,
      threeLine,
    );
  }

  // The expired item must not be in the list, whichever window is chosen —
  // the wording fix must not disturb what the list holds.
  const three = await systemPromptFor('chat/stream', 3);
  const line = expiringSoonLine(three);
  ok(
    !line.includes('Old Yoghurt'),
    'the food that has already gone off is not called "expiring soon"',
    line,
  );
  ok(
    line.includes('Milk') && line.includes('Spinach'),
    'the food inside the window is listed',
    line,
  );
}

await stopBridge();
await new Promise((r) => model.close(r));
rmSync(work, { recursive: true, force: true });

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} ok, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
