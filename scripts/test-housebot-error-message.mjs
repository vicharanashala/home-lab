/**
 * Tests that a House Bot failure is reported to the person in a sentence.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The model API answers a failed call with a JSON envelope:
 *
 *   {"type":"error","error":{"type":"invalid_request_error",
 *    "message":"invalid param: decode base64 data url: illegal base64 data
 *    at input byte 1000 (2013)"},"request_id":"072f4c66dc415b3f97d0be28cc18618c"}
 *
 * Two things are in there. The message is what actually went wrong, and it
 * is written for a person. The envelope around it — the error type, the
 * request id — is the provider's paperwork: its vocabulary, and a handle
 * for its own support desk.
 *
 * The streaming route handed the WHOLE envelope to the browser, and the
 * browser puts it straight into the chat bubble, so House Bot said:
 *
 *   ⚠️ Network error: {"type":"error","error":{"type":"invalid_request_error",
 *   "message":"invalid param: decode base64 data url ... (2013)"},
 *   "request_id":"072f4c66dc415b3f97d0be28cc18618c"}
 *
 * And it logged NOTHING. The one place a failure can be diagnosed from —
 * the server's own log — was the one place the detail never reached. The
 * non-streaming route had it the other way round: the detail went to the
 * log AND to the browser, but as a JSON blob rather than a sentence.
 *
 * So the same failure was reported two different ways, and neither way was
 * a sentence.
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a fake model that fails the way
 * the model API fails, and asks both routes what the caller is told:
 *
 *   - the caller is told the model's own sentence;
 *   - the caller is NOT handed the provider's request id;
 *   - the whole provider body still reaches the server's log, so the
 *     failure can be diagnosed after the fact.
 *
 * Run with:  node scripts/test-housebot-error-message.mjs
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
// It fails the way the model API fails: a 400 carrying a JSON envelope
// with an error type, a message and a request id. The request id is the
// thing that must NOT reach the person.
const REQUEST_ID = '072f4c66dc415b3f97d0be28cc18618c';
const MODEL_MESSAGE = 'invalid param: decode base64 data url: illegal base64 data at input byte 1000 (2013)';
const UPSTREAM_BODY = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: MODEL_MESSAGE },
  request_id: REQUEST_ID,
});

const model = createHttpServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(UPSTREAM_BODY);
  });
});

const modelPort = await freePort();
await new Promise((r) => model.listen(modelPort, '127.0.0.1', r));

/**
 * Where the bridge's own dependencies are installed.
 *
 * WHY THIS IS NOT JUST THE BRIDGE'S OWN FOLDER: the quality gate exports
 * the staged index to a temporary directory, and an export holds tracked
 * files only — the bridge's node_modules is not among them, so a copy of
 * the bridge started there cannot import express and the check silently
 * stops being a check.
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
const work = mkdtempSync(join(tmpdir(), 'hh-housebot-error-'));
const home = join(work, 'home');
mkdirSync(home, { recursive: true });
copyFileSync(join(bridgeDir, 'index.mjs'), join(work, 'index.mjs'));
copyFileSync(join(bridgeDir, 'openclaw-cli.mjs'), join(work, 'openclaw-cli.mjs'));
const deps = bridgeDependencies();
if (deps) symlinkSync(deps, join(work, 'node_modules'));

// The bridge's stdout is where the upstream detail is logged. It is
// captured in memory so the test can ask whether the detail was kept.

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
let bridgeOutText = '';
bridge?.stdout.on('data', (d) => { bridgeOutText += d.toString(); });

let bridgeUp = false;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${bridgePort}/healthz`);
    if (r.ok) { bridgeUp = true; break; }
  } catch { /* not up yet */ }
  await sleep(100);
}

/** What the streaming route tells the caller when the model fails. */
async function streamErrorText() {
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'how much is this?',
      history: [],
      context: {},
      image: { mediaType: 'image/jpeg', data: 'QUJDRA==', kind: 'screen' },
    }),
  });
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const payload = JSON.parse(line.slice(5).trim());
      if (payload.type === 'error') return String(payload.error || '');
    } catch {
      /* not the event we are after */
    }
  }
  return '';
}

/** What the non-streaming route tells the caller when the model fails. */
async function chatErrorDetail() {
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'how much is this?', history: [], context: {} }),
  });
  const text = await res.text();
  try {
    return String(JSON.parse(text)?.detail || '');
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * Stop the bridge copy, and wait until it really is gone.
 *
 * WHY IT WAITS FOR THE EXIT: `kill` only asks. A bridge that is still
 * winding down when the work directory is removed goes on running with a
 * directory that is no longer there, holding a port that nothing asked it
 * to hold.
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

// WHY THE TEST IS WRAPPED: the bridge copy is started above, and the
// cleanup that stops it is below. Between the two there are fetches and
// assertions, and any of them can throw — and a throw is exactly when the
// test is least likely to be watched. A throw that skips the cleanup
// leaves a bridge copy running on a port of its own.
try {
  console.log('\na failed House Bot call is reported in a sentence');
  if (!deps) {
    console.log('  SKIP the bridge is not installed here — its dependencies could not be found');
  } else if (!bridgeUp) {
    ok(false, 'the bridge copy starts', bridgeErr.slice(0, 300));
  } else {
    const streamed = await streamErrorText();

    // WHY THE LOG IS ASKED ABOUT NOW, BEFORE THE OTHER ROUTE IS CALLED: the
    // streaming route's own failure is what has to be in the log. The other
    // route logs too, so asking afterwards would pass whether the streaming
    // route kept anything or not — which is the thing that was wrong.
    await sleep(200);
    const logAfterStream = bridgeOutText;
    ok(
      logAfterStream.includes('[upstream-error]'),
      'the streaming route writes the failure to the server log',
      logAfterStream.slice(-200),
    );
    ok(
      logAfterStream.includes(REQUEST_ID),
      'the log keeps the whole provider body, request id and all',
      logAfterStream.slice(-200),
    );

    const detailed = await chatErrorDetail();

    ok(streamed.length > 0, 'the streaming route says the call failed', streamed.slice(0, 120));
    ok(
      streamed.includes(MODEL_MESSAGE),
      'the streaming route tells the person what the model said',
      streamed.slice(0, 140),
    );
    ok(
      !streamed.includes(REQUEST_ID),
      'the streaming route does not hand the person the provider request id',
      streamed.slice(0, 140),
    );
    ok(
      !streamed.includes('"type":"error"'),
      'the streaming route does not hand the person the provider envelope',
      streamed.slice(0, 140),
    );

    ok(
      detailed.includes(MODEL_MESSAGE),
      'the other route tells the person the same sentence',
      detailed.slice(0, 140),
    );
    ok(
      !detailed.includes(REQUEST_ID),
      'the other route does not hand the person the provider request id either',
      detailed.slice(0, 140),
    );
    ok(
      !detailed.includes('"type":"error"'),
      'the other route does not hand the person the provider envelope either',
      detailed.slice(0, 140),
    );
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
