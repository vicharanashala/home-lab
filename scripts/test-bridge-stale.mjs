/**
 * Regression test for the supervisor's stale-bridge rule.
 *
 * THE BUG THIS EXISTS FOR
 * The supervisor restarted the bridge only when the PORT stopped answering.
 * That keeps the app alive, but it leaves the app running code that is no
 * longer on disk. A bridge change is committed, its tests pass, and the
 * commit says the feature is fixed — while the bridge serving the owner's
 * link goes on running the old code, because nothing ever asked the running
 * bridge whether it was current.
 *
 * That is the quietest kind of broken: every check is green and the fix is
 * not there.
 *
 * WHAT IT LOOKED LIKE ON THE LIVE APP
 * The overwatch CLI resolution was committed at 19:21 and fixed the bridge
 * spawning "openclaw" by a bare name. The bridge serving the link had been
 * running since 14:34, so the live app still answered every overwatch call
 * with "[spawn error] spawn openclaw ENOENT" — the exact error the commit
 * had fixed. The fix was real; it was simply not running.
 *
 * WHAT IS TESTED HERE
 * The rule itself, the parse guard that stops a half-written file from
 * taking the app down, and — on a spare port, with a fake bridge — that the
 * rule actually puts new code live and then settles instead of flapping.
 *
 * Run with:  node scripts/test-bridge-stale.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, 'lib', 'bridge-stale.sh');
const watchdog = join(here, '..', 'watchdog.sh');

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

function check(name, cond, detail = '') {
  ok(cond, name, detail);
}

/**
 * Run a snippet with the rule library sourced.
 *
 * The rule is bash, so it runs through bash — the same way the supervisor
 * runs it.
 */
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

/** Ask the rule what state the bridge is in. */
function bridgeState(port, dir) {
  try {
    return sh(`bridge_code_state ${port} "${dir}"`).trim();
  } catch (err) {
    return `error: ${err.message}`;
  }
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until something answers on the port, or give up. */
async function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync('bash', [
        '-c',
        `curl -s --max-time 2 http://127.0.0.1:${port}/ || true`,
      ], { encoding: 'utf8' });
      if (out.trim()) return out.trim();
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return '';
}

/** The fake bridge: serves the version baked into its source. */
function bridgeSource(port, version) {
  return `import http from 'node:http';
const PORT = ${port};
const VERSION = ${JSON.stringify(version)};
http.createServer((_req, res) => { res.end(VERSION); }).listen(PORT, '127.0.0.1');
`;
}

/* -------------------------------------------------------------------------- */

console.log('\nthe rule: newer code on disk means the running bridge is out of date');
check(
  'code newer than the bridge is stale',
  ruleYes('bridge_is_stale 200 100') === 'yes',
);
check(
  'code older than the bridge is not stale',
  ruleYes('bridge_is_stale 100 200') === 'no',
);
check(
  'code from the same second is not stale',
  ruleYes('bridge_is_stale 100 100') === 'no',
);

console.log('\nevery guard fails closed, because a wrong restart is worse than none');
check('a missing code time is not stale', ruleYes('bridge_is_stale "" 100') === 'no');
check('a missing start time is not stale', ruleYes('bridge_is_stale 200 ""') === 'no');
check('a non-numeric code time is not stale', ruleYes('bridge_is_stale "n/a" 100') === 'no');
check('a non-numeric start time is not stale', ruleYes('bridge_is_stale 200 "n/a"') === 'no');
check('both missing is not stale', ruleYes('bridge_is_stale "" ""') === 'no');

console.log('\nthe parse guard: a half-written file must not take the app down');
const parseDir = mkdtempSync(join(tmpdir(), 'hh-parse-'));
writeFileSync(join(parseDir, 'good.mjs'), 'export const ok = 1;\n');
check('a directory of valid files parses', ruleYes(`bridge_code_parses "${parseDir}"`) === 'yes');
writeFileSync(join(parseDir, 'broken.mjs'), 'export const ok = {{{\n');
check(
  'a directory with a broken file does not parse',
  ruleYes(`bridge_code_parses "${parseDir}"`) === 'no',
);
rmSync(parseDir, { recursive: true, force: true });

console.log('\nthe supervisor is wired to the rule');
const watchdogSource = execFileSync('bash', ['-c', `cat "${watchdog}"`], { encoding: 'utf8' });
check(
  'watchdog.sh sources the rule library',
  watchdogSource.includes('lib/bridge-stale.sh'),
);
check(
  'watchdog.sh asks the rule before restarting',
  watchdogSource.includes('bridge_code_state'),
);

/* ---- end to end, on a spare port, with a fake bridge ---- */

console.log('\nend to end: the rule puts new code live on a spare port');
const work = mkdtempSync(join(tmpdir(), 'hh-bridge-'));
const port = await freePort();
const deadPort = await freePort();
const log = join(work, 'bridge.log');
let started = null;

try {
  writeFileSync(join(work, 'index.mjs'), bridgeSource(port, 'v1'));
  started = spawn(process.execPath, ['index.mjs'], { cwd: work, stdio: 'ignore' });

  const first = await waitForPort(port);
  check('the fake bridge answers', first === 'v1', `served "${first}"`);

  const startedAt = sh(`bridge_started_at ${port}`).trim();
  check('the bridge start time can be read', /^\d+$/.test(startedAt), `started_at=${startedAt}`);

  const codeMtime = sh(`bridge_code_mtime "${work}"`).trim();
  check('the code time can be read', /^\d+$/.test(codeMtime), `code_mtime=${codeMtime}`);

  check(
    'a bridge running the current code is left alone',
    bridgeState(port, work) === 'current',
    `state=${bridgeState(port, work)}`,
  );

  // A state that cannot be read is NOT "current".
  //
  // WHY THIS MATTERS: the rule's own contract lists "unknown" for exactly
  // this case — the bridge, or its start time, cannot be read — and the live
  // check treats "unknown" as never healthy. A rule that answered "current"
  // about a bridge whose code on disk cannot be read hands the outside world
  // a false all-clear about an app it cannot vouch for, which is the one
  // thing the whole live check exists to prevent.
  check(
    'a bridge whose code on disk cannot be read is unknown, never current',
    bridgeState(port, join(work, 'missing-dir')) === 'unknown',
    `state=${bridgeState(port, join(work, 'missing-dir'))}`,
  );
  check(
    'a bridge whose start time cannot be read is unknown, never current',
    bridgeState(deadPort, work) === 'unknown',
    `state=${bridgeState(deadPort, work)}`,
  );

  // The file time has one-second resolution, so the new code is written in a
  // later second than the bridge started — otherwise "newer" would be a tie
  // and the rule would (correctly) say no.
  await sleep(1200);
  writeFileSync(join(work, 'index.mjs'), bridgeSource(port, 'v2'));

  check(
    'a bridge running older code is stale',
    bridgeState(port, work) === 'stale',
    `state=${bridgeState(port, work)}`,
  );

  const pidBefore = sh(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t | head -1`).trim();
  sh(`bridge_restart ${port} "${work}" "${process.execPath}" "${log}"`);
  const served = await waitForPort(port);
  const pidAfter = sh(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t | head -1`).trim();

  check('the new code is what answers now', served === 'v2', `served "${served}"`);
  check('the bridge really was replaced', pidBefore !== '' && pidAfter !== '' && pidBefore !== pidAfter, `${pidBefore} -> ${pidAfter}`);

  check(
    'and it settles: the fresh bridge is not stale any more',
    bridgeState(port, work) === 'current',
    `state=${bridgeState(port, work)}`,
  );

  // A file that does not parse is left alone: the app that is merely out of
  // date still works, and the app that is down does not.
  await sleep(1200);
  writeFileSync(join(work, 'index.mjs'), 'export const broken = {{{\n');
  check(
    'a broken change does not make the bridge stale',
    bridgeState(port, work) === 'unparsable',
    `state=${bridgeState(port, work)}`,
  );
  const stillUp = await waitForPort(port);
  check('and the running bridge is still serving', stillUp === 'v2', `served "${stillUp}"`);
} finally {
  if (started && !started.killed) started.kill('SIGKILL');
  try {
    const pid = sh(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t | head -1`).trim();
    if (pid) execFileSync('kill', ['-9', pid]);
  } catch {
    /* nothing to clean up */
  }
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
