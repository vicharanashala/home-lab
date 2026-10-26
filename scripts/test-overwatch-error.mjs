/**
 * Tests that a failed overwatch call is reported in the CLI's own words.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The openclaw CLI says what went wrong in JSON, on its stdout:
 *
 *   {"ok": false, "error": {"type": "cli_error", "message":
 *    "Unknown agent id \"overwatch\". Use \"openclaw agents list\" to see
 *    configured agents."}}
 *
 * One line, and it is the whole diagnosis — the agent the bridge asked for
 * is not configured on this machine, and there is a command that lists the
 * ones that are.
 *
 * The bridge threw that answer away. `callOverwatch` kept the parsed JSON
 * only when the exit code was zero, so on every failure `parsed` was null —
 * and the place that was written to report the CLI's message could therefore
 * never fire:
 *
 *   message: (status.parsed && status.parsed.error && status.parsed.error.message) || status.stderr
 *
 * The chain was dead code. What the caller got instead was `status.stderr`,
 * which is the CLI's own noise:
 *
 *   [openclaw] The CLI command failed.
 *   [openclaw] Reason: Unknown agent id "overwatch". ...
 *   [openclaw] Debug: set OPENCLAW_DEBUG=1 to include the stack trace.
 *   [openclaw] Try: openclaw doctor
 *   [openclaw] Help: openclaw --help
 *
 * Six lines of a command's failure, where one line said what was wrong. And
 * the health route was worse: it reported `providerError: null` — "nothing
 * wrong with the provider" — at exactly the moment the provider had said in
 * plain words that it could not find the agent.
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a FAKE openclaw CLI — one that
 * fails the way the real one does, with the JSON on stdout and the noise on
 * stderr — and asks the bridge what it tells its callers:
 *
 *   - the health route names the CLI's message instead of saying nothing;
 *   - the failure route's message IS the CLI's message, not the stderr blob;
 *   - the chat route files the CLI's message, not the stderr blob;
 *   - and the CLI's stderr is still reported, because a failure the CLI did
 *     not describe in JSON has nothing else to go on.
 *
 * And it checks the other half: a call that SUCCEEDS still succeeds. Keeping
 * the parsed answer on a failure must not turn a failure into a reply.
 *
 * Run with:  node scripts/test-overwatch-error.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync, existsSync, realpathSync, writeFileSync, chmodSync } from 'node:fs';
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

// ── the fake openclaw CLI ───────────────────────────────────────────────
//
// It fails the way the real CLI fails: the JSON answer on stdout, the noise
// on stderr, and the exit code not zero.
//
// WHY THE MODE IS A FILE AND NOT AN ENV VAR: the bridge passes its own
// environment down to the CLI it spawns, so an env var would be fixed when
// the bridge starts and the test could not ask for both a failure and a
// success from the same bridge. A file is read at every call.
const CLI_MESSAGE =
  'Unknown agent id "overwatch". Use "openclaw agents list" to see configured agents.';
const CLI_NOISE = '[openclaw] The CLI command failed.';

const FAKE_CLI = `#!/bin/sh
mode=$(cat "$HOME/fake-cli-mode" 2>/dev/null || echo fail)
if [ "$mode" = "ok" ]; then
  printf '%s\\n' '{"ok":true,"result":{"reply":"The overwatch agent is here."}}'
  exit 0
fi
printf '%s\\n' '{"ok":false,"error":{"type":"cli_error","message":"Unknown agent id \\"overwatch\\". Use \\"openclaw agents list\\" to see configured agents."}}'
printf '%s\\n' '[openclaw] The CLI command failed.' >&2
printf '%s\\n' '[openclaw] Reason: Unknown agent id "overwatch". Use "openclaw agents list" to see configured agents.' >&2
printf '%s\\n' '[openclaw] Debug: set OPENCLAW_DEBUG=1 to include the stack trace.' >&2
printf '%s\\n' '[openclaw] Try: openclaw doctor' >&2
printf '%s\\n' '[openclaw] Help: openclaw --help' >&2
exit 1
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
const work = mkdtempSync(join(tmpdir(), 'hh-overwatch-error-'));
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

async function statusBody() {
  const res = await fetch(`${base}/api/overwatch/status`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function overwatchBody() {
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

// WHY THE TEST IS WRAPPED: the bridge copy is started above, and the
// cleanup that stops it is below. Between the two there are fetches and
// assertions, and any of them can throw — and a throw is exactly when the
// test is least likely to be watched. A throw that skips the cleanup leaves
// a bridge copy running on a port of its own.
try {
  console.log('\nthe bridge says what the CLI said went wrong');
  if (!deps) {
    console.log('  SKIP the bridge is not installed here — its dependencies could not be found');
  } else if (!bridgeUp) {
    ok(false, 'the bridge copy starts', bridgeErr.slice(0, 300));
  } else {
    // ── the failure ────────────────────────────────────────────────────
    const health = await statusBody();
    ok(
      health.body?.providerError === CLI_MESSAGE,
      'the health route names the error the CLI gave',
      String(health.body?.providerError),
    );
    ok(
      health.body?.code === 1,
      'and the exit code is reported as it is',
      String(health.body?.code),
    );
    ok(
      health.body?.reachable === true,
      'the CLI is still reachable — it ran, and it said no',
      `reachable ${health.body?.reachable}`,
    );
    ok(
      typeof health.body?.stderrTail === 'string' && health.body.stderrTail.includes('[openclaw]'),
      'and the CLI is still reported stderr, for the failures it does not describe in JSON',
      String(health.body?.stderrTail).slice(0, 80),
    );

    const failed = await overwatchBody();
    ok(failed.status === 502, 'a failed call is still a failure', `status ${failed.status}`);
    ok(
      failed.body?.message === CLI_MESSAGE,
      'and the message is the CLI one, not the CLI noise',
      String(failed.body?.message).slice(0, 120),
    );
    ok(
      !String(failed.body?.message).includes(CLI_NOISE),
      'the CLI is not given a wall of its own noise',
    );

    const chatted = await chatBody();
    ok(
      chatted.body?.reply === CLI_MESSAGE,
      'the chat files the CLI message, not the CLI noise',
      String(chatted.body?.reply).slice(0, 120),
    );
    ok(
      chatted.body?.ok === false,
      'and a failed call is not filed as a success',
      String(chatted.body?.ok),
    );

    // ── the success, so the fix cannot have broken the working path ────
    writeFileSync(join(home, 'fake-cli-mode'), 'ok');

    const healthy = await statusBody();
    ok(
      healthy.body?.providerError === null,
      'a call that worked reports no provider error',
      String(healthy.body?.providerError),
    );
    ok(healthy.body?.code === 0, 'and its exit code is zero', String(healthy.body?.code));

    const worked = await overwatchBody();
    ok(worked.status === 200, 'a call that worked still works', `status ${worked.status}`);
    ok(worked.body?.ok === true, 'and it is still reported as a success', String(worked.body?.ok));
    ok(
      worked.body?.raw?.result?.reply === 'The overwatch agent is here.',
      'and the agent answer still comes through',
      String(worked.body?.raw?.result?.reply),
    );
  }
} finally {
  await stopBridge();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
