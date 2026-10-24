/**
 * Regression test for the supervisor's self-reload rule.
 *
 * THE BUG THIS EXISTS FOR
 * A bash script is read into memory when it starts, and the supervisor is a
 * `while true` loop, so the whole loop is parsed ONCE, at start-up, and the
 * process keeps running that copy for ever. Editing watchdog.sh on disk
 * therefore does NOTHING to the supervisor that is already running it.
 *
 * That is the defect the bridge had, one level up. The bridge was restarted
 * only when its PORT stopped answering, so a committed bridge change stayed
 * off the live app until the bridge happened to die for some other reason.
 * The rule that fixed the bridge (scripts/lib/bridge-stale.sh) was committed
 * TO watchdog.sh — and it could not run, for exactly this reason: every
 * supervisor alive at the time had started before the rule was written, and
 * none of them will ever read it.
 *
 * WHAT IT LOOKED LIKE ON THE LIVE APP
 * The supervisors were started at 11:21 and 14:34; the stale-bridge rule was
 * committed at 20:15. The bridge serving the owner's link was still running
 * code from 14:34, so the live app answered every overwatch call with
 * "[spawn error] spawn openclaw ENOENT" — the exact error the rule was
 * written to clear. The rule was real; it was simply not running.
 *
 * WHAT IS TESTED HERE
 * The rule itself, the parse guard that stops a half-written script from
 * taking the supervisor down, and — end to end, with a fake supervisor — that
 * a running supervisor DOES pick up a later edit to its own file, and that it
 * does NOT pick up an edit that does not parse.
 *
 * The end-to-end test runs the same wiring the real supervisor uses, and
 * runs it AGAIN without the reload, so the test fails against the old
 * behaviour rather than merely describing it.
 *
 * Run with:  node scripts/test-supervisor-reload.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, 'lib', 'supervisor-reload.sh');
const watchdog = join(here, '..', 'watchdog.sh');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a snippet with the rule library sourced. */
function sh(script, env = {}) {
  return execFileSync('bash', ['-c', `source "${lib}"; ${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/** Run the rule and report what it answered: 'yes', 'no', or an error. */
function ruleYes(script, env = {}) {
  try {
    return sh(`if ${script}; then echo yes; else echo no; fi`, env).trim();
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/** What the rule says about the supervisor script on disk. */
function selfState(script, loadedSum) {
  try {
    return sh(`supervisor_self_state "${script}" "${loadedSum}"`).trim();
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/** The checksum of a file, as the rule computes it. */
function sumOf(path) {
  return sh(`supervisor_script_sum "${path}"`).trim();
}

/* -------------------------------------------------------------------------- */

console.log('\nthe rule: a file on disk that is not the copy running needs a reload');
check(
  'a different copy on disk needs a reload',
  ruleYes('supervisor_reload_needed 111 222') === 'yes',
);
check(
  'the same copy on disk needs no reload',
  ruleYes('supervisor_reload_needed 111 111') === 'no',
);

console.log('\nevery guard fails closed, because a wrong reload is worse than none');
check('a missing checksum is not a change', ruleYes('supervisor_reload_needed "" 222') === 'no');
check('a missing current checksum is not a change', ruleYes('supervisor_reload_needed 111 ""') === 'no');
check('a non-numeric checksum is not a change', ruleYes('supervisor_reload_needed "n/a" 222') === 'no');
check('both missing is not a change', ruleYes('supervisor_reload_needed "" ""') === 'no');

console.log('\nthe parse guard: a half-written script must not take the supervisor down');
const parseDir = mkdtempSync(join(tmpdir(), 'hh-selfparse-'));
const goodScript = join(parseDir, 'good.sh');
const brokenScript = join(parseDir, 'broken.sh');
writeFileSync(goodScript, 'echo hello\n');
writeFileSync(brokenScript, 'if [ ; then\n');
check('a valid script parses', ruleYes(`supervisor_script_parses "${goodScript}"`) === 'yes');
check('a broken script does not parse', ruleYes(`supervisor_script_parses "${brokenScript}"`) === 'no');
check('a missing script does not parse', ruleYes(`supervisor_script_parses "${parseDir}/nope.sh"`) === 'no');
check(
  'the checksum of a missing file cannot be read',
  ruleYes(`supervisor_script_sum "${parseDir}/nope.sh"`) === 'no',
);

console.log('\nthe states the supervisor can be in');
const sameSum = sumOf(goodScript);
check('an unchanged script is current', selfState(goodScript, sameSum) === 'current', `state=${selfState(goodScript, sameSum)}`);
writeFileSync(goodScript, 'echo hello again\n');
check('a changed, parsable script is a reload', selfState(goodScript, sameSum) === 'reload', `state=${selfState(goodScript, sameSum)}`);
check(
  'a changed, broken script is not a reload',
  selfState(brokenScript, sameSum) === 'unparsable',
  `state=${selfState(brokenScript, sameSum)}`,
);
check(
  'a script that cannot be read is unknown',
  selfState(`${parseDir}/nope.sh`, sameSum) === 'unknown',
  `state=${selfState(`${parseDir}/nope.sh`, sameSum)}`,
);
rmSync(parseDir, { recursive: true, force: true });

console.log('\nthe supervisor is wired to the rule');
const watchdogSource = readFileSync(watchdog, 'utf8');
check('watchdog.sh sources the rule library', watchdogSource.includes('lib/supervisor-reload.sh'));
check('watchdog.sh asks the rule before every round', watchdogSource.includes('supervisor_reload_if_changed'));
check('watchdog.sh records the checksum of the copy that is running', watchdogSource.includes('SELF_LOADED_SUM'));
check(
  'watchdog.sh is still valid bash',
  execFileSync('bash', ['-n', watchdog], { encoding: 'utf8' }) === '',
);

/* ---- end to end: a fake supervisor that edits its own file ---- */

/**
 * A fake supervisor: the same wiring the real one uses, with a marker that
 * says which version of the file it is running.
 *
 * @param version  the marker the running copy writes
 * @param reload   whether the copy re-reads its own file
 */
function supervisorSource(libPath, logFile, version, reload) {
  return `#!/bin/bash
set -u
. "${libPath}"
SELF_PATH="$0"
SELF_LOADED_SUM="$(supervisor_script_sum "$SELF_PATH")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "${logFile}"; }
echo "RUNNING ${version} pid=$$" >> "${logFile}"
while true; do
${reload ? '  supervisor_reload_if_changed "$SELF_PATH" "$SELF_LOADED_SUM" log' : '  :'}
  sleep 0.2
done
`;
}

/** Wait for a line to appear in the log, or give up. */
async function waitForLine(path, needle, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path) && readFileSync(path, 'utf8').includes(needle)) return true;
    await sleep(100);
  }
  return false;
}

/** True when a process with this PID is still running. */
function isAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

/** Run one fake supervisor through: start it, edit it, watch what it does. */
async function runFakeSupervisor({ reload }) {
  const work = mkdtempSync(join(tmpdir(), 'hh-selfreload-'));
  const logFile = join(work, 'supervisor.log');
  const script = join(work, 'fake-supervisor.sh');
  writeFileSync(script, supervisorSource(lib, logFile, 'VERSION-ONE', reload));

  const child = spawn('bash', [script], { stdio: 'ignore' });
  let result;
  try {
    const started = await waitForLine(logFile, 'RUNNING VERSION-ONE');
    // The file on disk is edited while the supervisor is running it.
    writeFileSync(script, supervisorSource(lib, logFile, 'VERSION-TWO', reload));
    const pickedUp = await waitForLine(logFile, 'RUNNING VERSION-TWO');

    // A file that does not parse must NOT be loaded: the supervisor keeps
    // running the copy it has, and says so. Only the part of the log written
    // AFTER the broken edit is looked at — the log keeps what came before.
    const logBeforeBroken = readFileSync(logFile, 'utf8').length;
    writeFileSync(script, 'if [ ; then\n');
    await sleep(1500);
    const logAfterBroken = readFileSync(logFile, 'utf8').slice(logBeforeBroken);
    const stayedOnOld = !logAfterBroken.includes('RUNNING');
    const saidWhy = logAfterBroken.includes('does not parse');

    // And a good file after a bad one is still picked up.
    writeFileSync(script, supervisorSource(lib, logFile, 'VERSION-THREE', reload));
    const recovered = await waitForLine(logFile, 'RUNNING VERSION-THREE');

    const log = readFileSync(logFile, 'utf8');
    result = { started, pickedUp, stayedOnOld, saidWhy, recovered, log };
  } finally {
    child.kill('SIGKILL');
    rmSync(work, { recursive: true, force: true });
  }
  return result;
}

console.log('\nend to end: a running supervisor picks up a later edit to its own file');
const withReload = await runFakeSupervisor({ reload: true });
check('the fake supervisor started', withReload.started);
check(
  'it picks up the edit to its own file',
  withReload.pickedUp,
  withReload.pickedUp ? '' : `log was:\n${withReload.log}`,
);
check('it says that it reloaded', withReload.log.includes('reloading this supervisor'));

console.log('\nthe reload replaces the process in place, and launchd keeps owning it');
// The PID has to be the SAME one: launchd's KeepAlive is bound to the process
// it started, so a reload that changed the PID would be a process launchd
// does not know about.
const pidBefore = (withReload.log.match(/RUNNING VERSION-ONE pid=(\d+)/) || [])[1];
const pidAfter = (withReload.log.match(/RUNNING VERSION-TWO pid=(\d+)/) || [])[1];
check(
  'the same PID is kept across the reload',
  !!pidBefore && !!pidAfter && pidBefore === pidAfter,
  `${pidBefore} -> ${pidAfter}`,
);
check(
  'and that process is still the one running',
  !!pidAfter && isAlive(pidAfter),
  pidAfter ? `pid ${pidAfter}` : 'no pid',
);

console.log('\nand a file that does not parse is left alone');
check('the broken edit was not loaded', withReload.stayedOnOld);
check('and the supervisor said why', withReload.saidWhy);

console.log('\nand a good file after a broken one is still picked up');
check('the supervisor recovered', withReload.recovered);

console.log('\nthe same run WITHOUT the rule is what the live supervisor was doing');
const withoutReload = await runFakeSupervisor({ reload: false });
check('the fake supervisor started', withoutReload.started);
check(
  'and it never picks up the edit — this is the bug',
  !withoutReload.pickedUp,
  'without the reload the edit is invisible to the running copy',
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
