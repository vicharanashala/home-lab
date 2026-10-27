/**
 * Tests that a failed overwatch call is not reported as a success.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `callOverwatch` answers "did it work" with one thing:
 *
 *   const ok = code === 0 && parsed && parsed.ok !== false;
 *
 * It asks the exit code AND the CLI's own verdict, because the CLI can leave
 * a failed call with an exit code of zero and say so in its answer:
 *
 *   {"ok": false, "error": {"type": "cli_error", "message": "..."}}
 *
 * The main route asked that question. Two other routes asked a different and
 * weaker one — `status.code === 0` — and so they disagreed with the route
 * beside them:
 *
 *   POST /api/overwatch        -> 502, the call failed
 *   POST /api/overwatch/chat   -> 200, ok: true   <-- the call failed
 *   POST /api/overwatch/image  -> 200, ok: true   <-- the call failed
 *
 * That is a false success in the exact place this repository exists to end:
 * the bridge told its caller the work was done when it was not. And in the
 * chat route it was worse than a wrong flag — the failure's own words were
 * filed in the chat history as what the agent said, beside an `ok: true`.
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a fake openclaw CLI that fails
 * the way the CLI is allowed to fail — the JSON on stdout, and an exit code
 * of zero — and asks the bridge what it tells its callers.
 *
 * It checks the other half too: a call that succeeds still succeeds, and
 * still comes through. A stricter test must not turn a working call into a
 * failing one.
 *
 * Run with:  node scripts/test-overwatch-ok-flag.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync, existsSync, realpathSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repo = join(import.meta.dirname, '..');
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

// ── the fake openclaw CLI ───────────────────────────────────────────────
//
// WHY THE FAILURE EXITS ZERO: this is the whole point. A CLI that fails
// loudly is easy to handle — the exit code says so. The failure this test
// is about is the one the exit code does NOT say: the CLI answers `ok: false`
// in its own JSON and still leaves 0 behind. The bridge has to believe the
// CLI's own verdict, not only the code.
//
// WHY THE MODE IS A FILE AND NOT AN ENV VAR: the bridge passes its own
// environment down to the CLI it spawns, so an env var would be fixed when
// the bridge starts and the test could not ask for both a failure and a
// success from the same bridge. A file is read at every call.
const CLI_MESSAGE = 'the agent could not be reached';
const FAKE_CLI = `#!/bin/sh
mode=$(cat "$HOME/fake-cli-mode" 2>/dev/null || echo fail)
if [ "$mode" = "ok" ]; then
  printf '%s\\n' '{"ok":true,"result":{"reply":"The overwatch agent is here."}}'
  exit 0
fi
printf '%s\\n' '{"ok":false,"error":{"type":"cli_error","message":"the agent could not be reached"}}'
exit 0
`;

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
// at a temporary directory so everything the bridge keeps lands there — and
// so the fake CLI is found where the bridge looks for the real one.
const work = mkdtempSync(join(tmpdir(), 'hh-overwatch-ok-'));
const home = join(work, 'home');
const cliDir = join(home, '.openclaw', 'bin');
mkdirSync(cliDir, { recursive: true });
copyFileSync(join(bridgeDir, 'index.mjs'), join(work, 'index.mjs'));
copyFileSync(join(bridgeDir, 'openclaw-cli.mjs'), join(work, 'openclaw-cli.mjs'));
writeFileSync(join(cliDir, 'openclaw'), FAKE_CLI);
chmodSync(join(cliDir, 'openclaw'), 0o755);
writeFileSync(join(home, 'fake-cli-mode'), 'fail');
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
        MINIMAX_ACCESS_TOKEN: 'stub-token',
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

const base = `http://127.0.0.1:${bridgePort}`;

async function mainBody() {
  const res = await fetch(`${base}/api/overwatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: 'what is in the fridge', context: {} }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function chatBody() {
  const res = await fetch(`${base}/api/overwatch/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'what is in the fridge' }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function imageBody() {
  const form = new FormData();
  form.append(
    'image',
    new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])], { type: 'image/jpeg' }),
    'onion.jpg',
  );
  form.append('question', 'what is this');
  const res = await fetch(`${base}/api/overwatch/image`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// WHY THE TEST IS WRAPPED: the bridge copy is started above, and the
// cleanup that stops it is below. Between the two there are fetches and
// assertions, and any of them can throw — and a throw is exactly when the
// test is least likely to be watched. A throw that skips the cleanup leaves
// a bridge copy running on a port of its own.
try {
  console.log('\na failed overwatch call is not reported as a success');
  if (!deps) {
    console.log('  SKIP the bridge is not installed here — its dependencies could not be found');
  } else if (!bridgeUp) {
    ok(false, 'the bridge copy starts', bridgeErr.slice(0, 300));
  } else {
    // ── the failure that leaves an exit code of zero ────────────────────
    const main = await mainBody();
    ok(main.status === 502, 'the main route refuses a failed call', `status ${main.status}`);

    const chatted = await chatBody();
    ok(
      chatted.body?.ok === false,
      'the chat route does not call a failed call a success',
      String(chatted.body?.ok),
    );
    ok(
      chatted.body?.reply === CLI_MESSAGE,
      'and it still says what the CLI said went wrong',
      String(chatted.body?.reply).slice(0, 120),
    );

    const imaged = await imageBody();
    ok(
      imaged.body?.ok === false,
      'the image route does not call a failed call a success',
      String(imaged.body?.ok),
    );

    // ── the success, so the stricter check cannot have broken anything ──
    writeFileSync(join(home, 'fake-cli-mode'), 'ok');

    const workedMain = await mainBody();
    ok(workedMain.status === 200, 'a call that worked still works', `status ${workedMain.status}`);
    ok(workedMain.body?.ok === true, 'and it is still reported as a success', String(workedMain.body?.ok));

    const workedChat = await chatBody();
    ok(workedChat.body?.ok === true, 'a chat that worked is still a success', String(workedChat.body?.ok));
    ok(
      workedChat.body?.reply === 'The overwatch agent is here.',
      'and the agent answer still comes through',
      String(workedChat.body?.reply).slice(0, 120),
    );

    const workedImage = await imageBody();
    ok(workedImage.body?.ok === true, 'an image that worked is still a success', String(workedImage.body?.ok));
  }
} finally {
  await stopBridge();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
