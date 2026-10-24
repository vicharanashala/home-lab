/**
 * Regression test for the services the supervisor starts.
 *
 * THE BUG THIS EXISTS FOR
 * The supervisor starts the bridge and the voice daemon with
 *
 *   ( cd "$DIR" && nohup "$NODE" index.mjs > "$LOG" 2>&1 < /dev/null & )
 *
 * The `&` inside the parentheses forks a SUB-SHELL to run the command, and
 * bash keeps that sub-shell alive until the command finishes. The sub-shell's
 * command line is the supervisor's own command line — it is the same script,
 * running the same file — so in `ps` it is indistinguishable from a second
 * supervisor.
 *
 * MEASURED ON THE LIVE MACHINE
 * `ps` showed three `bash watchdog.sh` processes and there was exactly ONE
 * supervisor. The other two were the bridge's and the voice daemon's
 * sub-shells, each holding its service as a child:
 *
 *   9331  -> child `sleep 20`                  the supervisor, in its loop
 *   9546  -> child speak_server.py 8790        the voice daemon's sub-shell
 *   41146 -> child node index.mjs              the bridge's sub-shell
 *
 * That is not a cosmetic difference. A debugger reading the process list
 * concludes that three supervisors are running, samples one of them, and
 * draws its conclusions about a process that is not the supervisor at all —
 * which is exactly what happened with PID 41146 here.
 *
 * THE FIX
 * `exec` replaces the sub-shell with the service itself, so nothing is left
 * behind. The service's parent is then the supervisor, and the process list
 * says what it means.
 *
 * WHAT IS TESTED HERE
 * That each starter leaves NO bash process behind holding the service — the
 * service's parent must be the shell that started it — and that the service
 * still writes to its log. The same measurement is then made against the OLD
 * construct, so the test fails on the old behaviour rather than merely
 * describing it.
 *
 * Run with:  node scripts/test-supervisor-starters.mjs
 *
 *   HH_WATCHDOG_PATH   the supervisor script to read   (watchdog.sh)
 *   HH_BRIDGE_LIB_PATH the bridge rule library to read (scripts/lib/bridge-stale.sh)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const watchdog = process.env.HH_WATCHDOG_PATH || join(here, '..', 'watchdog.sh');
const bridgeLib = process.env.HH_BRIDGE_LIB_PATH || join(here, 'lib', 'bridge-stale.sh');

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/**
 * Pull one shell function out of a script.
 *
 * WHY IT IS EXTRACTED RATHER THAN SOURCED: watchdog.sh is a loop that never
 * returns, and it starts tailscale, the bridge and the voice daemon. What is
 * under test is the starter itself, so the function is taken out and run on
 * its own with a stub in place of the service.
 *
 * @param source the text of the script
 * @param name   the name of the function, without the parentheses
 * @returns the function's text, braces included
 */
function extractFunction(source, name) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (start === -1) throw new Error(`${name}() not found`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === '}');
  if (end === -1) throw new Error(`${name}() has no closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

/**
 * A stub that stands in for the service.
 *
 * It writes down its own pid, so the test can ask the system who its parent
 * is, and it prints a line, so the test can ask whether the log still gets
 * what the service wrote.
 */
function writeStub(dir) {
  const stub = join(dir, 'stub-service');
  writeFileSync(
    stub,
    [
      '#!/bin/bash',
      'echo "$$" > "$STUB_PID_FILE"',
      'echo "stub service running with: $*"',
      'sleep 20',
      '',
    ].join('\n'),
  );
  chmodSync(stub, 0o755);
  return stub;
}

/**
 * Run a starter and report what the process tree looks like afterwards.
 *
 * @param fn       the starter function's text
 * @param setup    the variable assignments the starter needs
 * @param dir      the sandbox directory
 * @returns the stub's pid, its parent, the shell that started it, and the log
 */
function runStarter(fn, setup, dir) {
  const stub = writeStub(dir);
  const pidFile = join(dir, 'stub.pid');
  const log = join(dir, 'service.log');
  const harness = join(dir, 'harness.sh');

  // The service's log path is pointed at the sandbox before anything runs.
  //
  // WHY: the starters used to hard-code /tmp/hh_bridge.log and
  // /tmp/tts_daemon.log, and a test that writes to those is writing to the
  // log of the service that is running on this machine right now — which
  // truncates it. The test has to be able to run against the old code, so
  // the path is rewritten in the function's own text rather than trusted to
  // be a variable.
  const safeFn = fn.replace(/\/tmp\/[A-Za-z0-9_.-]*\.log/g, () => `"${log}"`);

  writeFileSync(
    harness,
    [
      '#!/bin/bash',
      'set -u',
      safeFn,
      setup,
      'BRIDGE_LOG="' + log + '"',
      'VOICE_LOG="' + log + '"',
      'start_service',
      'for _ in 1 2 3 4 5 6 7 8 9 10; do',
      '  [ -s "$STUB_PID_FILE" ] && break',
      '  sleep 0.2',
      'done',
      'STUB_PID="$(cat "$STUB_PID_FILE" 2>/dev/null || true)"',
      'if [ -z "$STUB_PID" ]; then echo "NO_STUB"; exit 1; fi',
      'echo "STUB_PID=$STUB_PID"',
      'echo "STUB_PPID=$(ps -o ppid= -p "$STUB_PID" 2>/dev/null | tr -d " ")"',
      'echo "STARTER_PID=$$"',
      'kill "$STUB_PID" 2>/dev/null',
      'exit 0',
      '',
    ].join('\n'),
  );

  const out = execFileSync('bash', [harness], {
    encoding: 'utf8',
    env: { ...process.env, STUB_PID_FILE: pidFile },
  });

  const read = (key) => {
    const line = out.split('\n').find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : '';
  };

  return {
    stubPid: read('STUB_PID'),
    stubPpid: read('STUB_PPID'),
    starterPid: read('STARTER_PID'),
    log: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

/* -------------------------------------------------------------------------- */

console.log('\nthe bridge starter leaves no bash behind holding the bridge');
{
  const dir = mkdtempSync(join(tmpdir(), 'hh-starters-'));
  const fn = extractFunction(readFileSync(watchdog, 'utf8'), 'start_bridge');
  const setup = [
    `BRIDGE_DIR="${dir}"`,
    `NODE_BIN="${join(dir, 'stub-service')}"`,
    'start_service() { start_bridge; }',
  ].join('\n');
  const result = runStarter(fn, setup, dir);

  check('the service started', result.stubPid !== '', `pid=${result.stubPid || 'none'}`);
  check(
    'nothing is left between the supervisor and the bridge',
    result.stubPpid !== '' && result.stubPpid === result.starterPid,
    `the bridge's parent is ${result.stubPpid || 'unknown'}, the starter was ${result.starterPid || 'unknown'}`,
  );
  check(
    'and the bridge still writes to its log',
    result.log.includes('stub service running with: index.mjs'),
    `log=${JSON.stringify(result.log.trim())}`,
  );
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nand the voice starter leaves no bash behind holding the voice daemon');
{
  const dir = mkdtempSync(join(tmpdir(), 'hh-starters-'));
  const fn = extractFunction(readFileSync(watchdog, 'utf8'), 'start_voice');
  const setup = [
    `TTS_PY="${join(dir, 'stub-service')}"`,
    `TTS_SERVER="${join(dir, 'speak_server.py')}"`,
    'VOICE_PORT=8790',
    'start_service() { start_voice; }',
  ].join('\n');
  const result = runStarter(fn, setup, dir);

  check('the service started', result.stubPid !== '', `pid=${result.stubPid || 'none'}`);
  check(
    'nothing is left between the supervisor and the voice daemon',
    result.stubPpid !== '' && result.stubPpid === result.starterPid,
    `the voice daemon's parent is ${result.stubPpid || 'unknown'}, the starter was ${result.starterPid || 'unknown'}`,
  );
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nand a restart of the bridge leaves no bash behind either');
{
  const dir = mkdtempSync(join(tmpdir(), 'hh-starters-'));
  const fn = extractFunction(readFileSync(bridgeLib, 'utf8'), 'bridge_restart');
  const setup = [
    `BRIDGE_DIR="${dir}"`,
    `NODE_BIN="${join(dir, 'stub-service')}"`,
    'start_service() { bridge_restart 18973 "$BRIDGE_DIR" "$NODE_BIN" "$BRIDGE_LOG"; }',
  ].join('\n');
  const result = runStarter(fn, setup, dir);

  check('the service started', result.stubPid !== '', `pid=${result.stubPid || 'none'}`);
  check(
    'nothing is left between the supervisor and the restarted bridge',
    result.stubPpid !== '' && result.stubPpid === result.starterPid,
    `the bridge's parent is ${result.stubPpid || 'unknown'}, the restart was ${result.starterPid || 'unknown'}`,
  );
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nthe OLD construct is what the live supervisor was running');
{
  const dir = mkdtempSync(join(tmpdir(), 'hh-starters-'));
  const oldFn = [
    'start_service() {',
    '  ( cd "$BRIDGE_DIR" && nohup "$NODE_BIN" index.mjs \\',
    '      > "$BRIDGE_LOG" 2>&1 < /dev/null & )',
    '}',
  ].join('\n');
  const setup = [
    `BRIDGE_DIR="${dir}"`,
    `NODE_BIN="${join(dir, 'stub-service')}"`,
  ].join('\n');
  const result = runStarter(oldFn, setup, dir);

  check('the service started', result.stubPid !== '', `pid=${result.stubPid || 'none'}`);
  check(
    'and it DID leave a bash behind — this is the bug the fix removes',
    result.stubPpid !== '' && result.stubPpid !== result.starterPid,
    `the service's parent is ${result.stubPpid || 'unknown'}, the starter was ${result.starterPid || 'unknown'}`,
  );
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nand the scripts are still valid bash');
check('watchdog.sh parses', execFileSync('bash', ['-n', watchdog], { encoding: 'utf8' }) === '');
check(
  'the bridge rule library parses',
  execFileSync('bash', ['-n', bridgeLib], { encoding: 'utf8' }) === '',
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
