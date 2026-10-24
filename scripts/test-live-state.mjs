/**
 * Tests for the check that asks the RUNNING app what it is running.
 *
 * THE BUG THIS EXISTS FOR
 * On 2026-10-24 the bridge serving the owner's link was running code from
 * 14:34 while the code on disk was from 19:18. The overwatch CLI fix was
 * committed at 19:21, every test passed, and the live app still answered
 * every overwatch call with "[spawn error] spawn openclaw ENOENT" — the very
 * error the commit had fixed.
 *
 * WHY IT WAS INVISIBLE: every check in this repo looks at the COMMIT. The
 * quality gate exports the staged index and asks whether the commit
 * type-checks, passes its tests and holds no secrets. The test suite asks
 * whether a rule does what it says. Nothing asked the running app anything,
 * so a green repository and a stale live app looked exactly the same.
 *
 * WHAT IS TESTED HERE
 * The rules themselves — the bridge's state, the supervisor's state, the
 * link, and the verdict that turns them into one word — and the check script
 * end to end against a fake bridge on a spare port, so that "the live app is
 * on the current code" and "the live app is on old code" are different
 * answers that this test can show both ways.
 *
 * Run with:  node scripts/test-live-state.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, 'lib', 'live-state.sh');
const checker = join(here, 'check-live.sh');
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
 * The rule is bash, so it runs through bash — the same way the check script
 * runs it.
 */
function sh(script, env = {}) {
  return execFileSync('bash', ['-c', `source "${lib}"; ${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

/** Ask the rule what state the supervisor is in. */
function supervisorState(script, publishedFile) {
  try {
    return sh(`live_supervisor_state "${script}" "${publishedFile}"`);
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/** Ask the rule what state the bridge is in. */
function bridgeState(port, dir) {
  try {
    return sh(`live_bridge_state ${port} "${dir}"`);
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/**
 * The checksum of the code the supervisor runs, the way the rule computes it.
 *
 * WHY IT IS NOT A PLAIN CHECKSUM OF ONE FILE: the rule watches the script
 * AND the rule libraries it loads, and the check compares the published
 * number with the number for the whole set. A plain checksum of the script
 * alone would never match what the supervisor publishes.
 *
 * @param path the supervisor script on disk
 */
function checksumOf(path) {
  return sh(`supervisor_watched_sum "${path}"`);
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

/** The fake bridge: serves the version baked into its source. */
function bridgeSource(port, version) {
  return `import http from 'node:http';
const PORT = ${port};
const VERSION = ${JSON.stringify(version)};
http.createServer((_req, res) => { res.end(VERSION); }).listen(PORT, '127.0.0.1');
`;
}

/* -------------------------------------------------------------------------- */

console.log('\nthe supervisor: is the copy that is running the copy on disk?');
const work = mkdtempSync(join(tmpdir(), 'hh-live-'));
const supervisorScript = join(work, 'watchdog.sh');
const publishedFile = join(work, 'published.checksum');
writeFileSync(supervisorScript, '#!/bin/bash\necho supervisor\n');

// The published state carries the checksum AND the pid of the supervisor that
// wrote it, because a checksum alone cannot say whether the supervisor that
// wrote it is still the one running.
writeFileSync(publishedFile, `${checksumOf(supervisorScript)} ${process.pid}\n`);
check(
  'a supervisor running the copy on disk is current',
  supervisorState(supervisorScript, publishedFile) === 'current',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

writeFileSync(publishedFile, '999999999\n');
check(
  'a supervisor running a different copy is stale',
  supervisorState(supervisorScript, publishedFile) === 'stale',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

rmSync(publishedFile, { force: true });
check(
  'a supervisor that never published a checksum is unpublished',
  supervisorState(supervisorScript, publishedFile) === 'unpublished',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

writeFileSync(publishedFile, 'not-a-checksum\n');
check(
  'a checksum that cannot be read is unknown, never current',
  supervisorState(supervisorScript, publishedFile) === 'unknown',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

writeFileSync(publishedFile, `${checksumOf(supervisorScript)}\n`);
check(
  'a state with no publisher in it is unknown, never current',
  supervisorState(supervisorScript, publishedFile) === 'unknown',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

check(
  'a script that cannot be read is unknown, never current',
  supervisorState(join(work, 'missing.sh'), publishedFile) === 'unknown',
  `state=${supervisorState(join(work, 'missing.sh'), publishedFile)}`,
);

// The publisher is gone. The state still says the copy on disk — but the
// supervisor that wrote it has died, and the one running now may be an older
// copy that cannot notice an edit to watchdog.sh at all.
const deadPublisher = spawnSync('bash', ['-c', 'exit 0']);
writeFileSync(publishedFile, `${checksumOf(supervisorScript)} ${deadPublisher.pid}\n`);
check(
  'a state whose publisher is gone is orphaned, never current',
  supervisorState(supervisorScript, publishedFile) === 'orphaned',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

console.log('\nthe bridge: is it up, and is it on the code on disk?');
const bridgeDir = join(work, 'bridge');
mkdirSync(bridgeDir, { recursive: true });
const port = await freePort();
const deadPort = await freePort();
let started = null;

try {
  writeFileSync(join(bridgeDir, 'index.mjs'), bridgeSource(port, 'v1'));
  started = spawn(process.execPath, ['index.mjs'], { cwd: bridgeDir, stdio: 'ignore' });

  // Wait for the fake bridge to answer before asking anything about it.
  let up = false;
  for (let i = 0; i < 30; i += 1) {
    await sleep(200);
    try {
      const out = execFileSync('bash', ['-c', `curl -s --max-time 2 http://127.0.0.1:${port}/ || true`], {
        encoding: 'utf8',
      });
      if (out.trim()) {
        up = true;
        break;
      }
    } catch {
      /* not up yet */
    }
  }
  check('the fake bridge answers', up);

  check(
    'a bridge running the code on disk is current',
    bridgeState(port, bridgeDir) === 'current',
    `state=${bridgeState(port, bridgeDir)}`,
  );

  check(
    'a bridge that is not running is down, never current',
    bridgeState(deadPort, bridgeDir) === 'down',
    `state=${bridgeState(deadPort, bridgeDir)}`,
  );

  console.log('\nthe verdict: nothing unknown is ever healthy');
  const verdict = (b, s, l) => sh(`live_verdict ${b} ${s} ${l}`);
  check('everything current is healthy', verdict('current', 'current', 'reachable') === 'healthy');
  check(
    'a stale bridge is not healthy',
    verdict('stale', 'current', 'reachable').startsWith('unhealthy'),
  );
  check(
    'a down bridge is not healthy',
    verdict('down', 'current', 'reachable').startsWith('unhealthy'),
  );
  check(
    'a supervisor that cannot notice changes is not healthy',
    verdict('current', 'unpublished', 'reachable').startsWith('unhealthy'),
  );
  check(
    'a supervisor whose publisher is gone is not healthy',
    verdict('current', 'orphaned', 'reachable').startsWith('unhealthy'),
  );
  check(
    'an unreadable state is not healthy',
    verdict('current', 'unknown', 'reachable').startsWith('unhealthy'),
  );
  check(
    'an unreachable link is not healthy',
    verdict('current', 'current', 'unreachable').startsWith('unhealthy'),
  );

  console.log('\nthe check script, end to end, against the fake bridge');
  const fakeSupervisor = join(work, 'live-watchdog.sh');
  writeFileSync(fakeSupervisor, '#!/bin/bash\necho supervisor\n');
  const fakePublished = join(work, 'live-published.checksum');
  writeFileSync(fakePublished, `${checksumOf(fakeSupervisor)} ${process.pid}\n`);

  const runCheck = () => {
    try {
      const out = execFileSync('bash', [checker], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HH_BRIDGE_PORT: String(port),
          HH_BRIDGE_DIR: bridgeDir,
          HH_SUPERVISOR_SCRIPT: fakeSupervisor,
          HH_SUPERVISOR_STATE: fakePublished,
          HH_PUBLIC_URL: `http://127.0.0.1:${port}`,
        },
      });
      return { code: 0, out };
    } catch (err) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  const current = runCheck();
  check(
    'a live app on the current code passes the check',
    current.code === 0 && current.out.includes('healthy'),
    `exit=${current.code}`,
  );

  // The file time has one-second resolution, so the new code is written in a
  // later second than the bridge started — otherwise "newer" would be a tie
  // and the rule would (correctly) say no.
  await sleep(1200);
  writeFileSync(join(bridgeDir, 'index.mjs'), bridgeSource(port, 'v2'));

  check(
    'and the rule sees that the code on disk has moved on',
    bridgeState(port, bridgeDir) === 'stale',
    `state=${bridgeState(port, bridgeDir)}`,
  );

  const stale = runCheck();
  check(
    'the same check fails once the code on disk moves on',
    stale.code === 1 && stale.out.includes('the bridge is running OLDER code'),
    `exit=${stale.code}`,
  );
} finally {
  if (started && !started.killed) started.kill('SIGKILL');
  rmSync(work, { recursive: true, force: true });
}

console.log('\nthe supervisor publishes the checksum of the code that is running');
const watchdogSource = execFileSync('bash', ['-c', `cat "${watchdog}"`], { encoding: 'utf8' });
check(
  'watchdog.sh writes its checksum down',
  /SUPERVISOR_STATE/.test(watchdogSource) && /supervisor_watched_sum/.test(watchdogSource),
  'the checksum has to cover the rule libraries the supervisor loads, not the script alone',
);
check(
  'the check script reads the file the supervisor writes',
  execFileSync('bash', ['-c', `cat "${checker}"`], { encoding: 'utf8' }).includes('hh_supervisor.checksum'),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
