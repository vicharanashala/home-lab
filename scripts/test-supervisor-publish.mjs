/**
 * Regression test for the supervisor publishing which copy of itself is
 * running.
 *
 * THE BUG THIS EXISTS FOR
 * The supervisor writes its checksum down once, at start-up, so that anything
 * watching the app from outside can tell whether the supervisor is on the code
 * that is on disk. That file lives in /tmp, and /tmp is tidied. When the file
 * is gone, a supervisor that is running exactly the right code never writes it
 * again — so the live check says "unpublished" for ever:
 *
 *   npm run check:live
 *   ── the live app
 *      bridge      current   (127.0.0.1:8789)
 *      supervisor  unpublished   (/Users/adhyathmika/homehub/watchdog.sh)
 *
 * The app is blamed for a file it cannot see, and the one piece of evidence
 * that the supervisor is current is gone for good — because nothing ever
 * writes it again.
 *
 * WHY THE FIX IS IN THE LOOP AND NOT ONLY AT START-UP: the supervisor runs
 * once a round for ever, so writing the file once a round puts it back within
 * seconds of anything taking it away, and keeps its mtime fresh so that
 * nothing tidying /tmp has a reason to take it.
 *
 * WHY A SUPERVISOR THAT IS NOT ON THE COPY ON DISK MUST NOT OVERRULE ONE
 * THAT IS: launchd has left more than one copy of the supervisor running over
 * the years, and they do not all run the same copy of watchdog.sh. Two
 * supervisors writing different checksums would leave the file alternating
 * between them, and the check would alternate between "current" and "stale"
 * for no reason. A health check that sometimes says "all good" about an app
 * that is not is worse than no check at all.
 *
 * WHAT IS TESTED HERE
 * The rule itself, and — end to end, with a fake supervisor — that a running
 * supervisor puts its published state back after it is taken away. The
 * end-to-end test runs the same wiring the real supervisor uses, and runs it
 * AGAIN with the old write-once behaviour, so the test fails against the old
 * behaviour rather than merely describing it.
 *
 * Run with:  node scripts/test-supervisor-publish.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, 'lib', 'supervisor-reload.sh');
const liveLib = join(here, 'lib', 'live-state.sh');
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

/** Run a snippet and report the exit code, without throwing on a refusal. */
function shStatus(script) {
  const result = spawnSync('bash', ['-c', `source "${lib}"; ${script}`], {
    encoding: 'utf8',
  });
  return result.status;
}

/** What the outside world sees: the state of the supervisor. */
function outsideState(script, publishedFile) {
  return execFileSync(
    'bash',
    ['-c', `source "${liveLib}"; live_supervisor_state "${script}" "${publishedFile}"`],
    { encoding: 'utf8' },
  ).trim();
}

/** The checksum of a file, as the rule computes it. */
function sumOf(path) {
  return sh(`supervisor_script_sum "${path}"`).trim();
}

/* -------------------------------------------------------------------------- */

console.log('\nthe rule: the running copy writes its checksum where it can be read');
const work = mkdtempSync(join(tmpdir(), 'hh-publish-'));
const script = join(work, 'supervisor.sh');
const stateFile = join(work, 'published');
writeFileSync(script, '#!/bin/bash\necho hello\n');
const sum = sumOf(script);

sh(`supervisor_publish_state "${script}" "${sum}" "${stateFile}"`);
check(
  'the checksum of the running copy is written down',
  existsSync(stateFile) && readFileSync(stateFile, 'utf8').trim() === sum,
  `published=${existsSync(stateFile) ? readFileSync(stateFile, 'utf8').trim() : 'nothing'}`,
);

console.log('\nand the outside world can tell the supervisor is current');
check(
  'a supervisor that published its checksum reads as current',
  outsideState(script, stateFile) === 'current',
  `state=${outsideState(script, stateFile)}`,
);

console.log('\nand a supervisor that is on the copy on disk repairs what is wrong');
writeFileSync(stateFile, '999999\n');
sh(`supervisor_publish_state "${script}" "${sum}" "${stateFile}"`);
check(
  'a wrong published checksum is put right',
  readFileSync(stateFile, 'utf8').trim() === sum,
  `published=${readFileSync(stateFile, 'utf8').trim()}`,
);

console.log('\nbut one that is NOT on the copy on disk must not overrule it');
writeFileSync(stateFile, `${sum}\n`);
sh(`supervisor_publish_state "${script}" "12345" "${stateFile}"`);
check(
  'a stale supervisor does not overwrite what a current one published',
  readFileSync(stateFile, 'utf8').trim() === sum,
  `published=${readFileSync(stateFile, 'utf8').trim()}`,
);

console.log('\nthough it does speak when nothing else has said anything');
rmSync(stateFile, { force: true });
sh(`supervisor_publish_state "${script}" "12345" "${stateFile}"`);
check(
  'a stale supervisor writes when the file is missing',
  existsSync(stateFile) && readFileSync(stateFile, 'utf8').trim() === '12345',
);
check(
  'and the outside world can tell that it is not current',
  outsideState(script, stateFile) === 'stale',
  `state=${outsideState(script, stateFile)}`,
);

console.log('\nand every guard fails closed');
const missingState = join(work, 'published-missing');
const refused = shStatus(
  `supervisor_publish_state "${script}" "not-a-number" "${missingState}"`,
);
check('a checksum that is not a number is refused', refused !== 0, `exit=${refused}`);
check(
  'and nothing is published for it',
  !existsSync(missingState),
);
rmSync(work, { recursive: true, force: true });

/* ---- end to end: a fake supervisor whose published file is taken away ---- */

/**
 * A fake supervisor: the same wiring the real one uses.
 *
 * WHY IT IS A FAKE AND NOT THE REAL SCRIPT: the real supervisor starts
 * tailscale, the bridge and the voice daemon. What is under test here is the
 * publishing, not those.
 *
 * @param libPath    the rule library to source
 * @param stateFile  where the checksum is published
 * @param republish  whether the checksum is written again every round
 */
function supervisorSource(libPath, stateFile, republish) {
  return `#!/bin/bash
set -u
. "${libPath}"
SELF_PATH="$0"
SELF_LOADED_SUM="$(supervisor_script_sum "$SELF_PATH")"
SUPERVISOR_STATE="${stateFile}"
${
  republish
    ? 'supervisor_publish_state "$SELF_PATH" "$SELF_LOADED_SUM" "$SUPERVISOR_STATE" || true'
    : 'printf \'%s\\n\' "$SELF_LOADED_SUM" > "$SUPERVISOR_STATE" 2>/dev/null || true'
}
while true; do
  if [ "${republish}" = "true" ]; then
    supervisor_publish_state "$SELF_PATH" "$SELF_LOADED_SUM" "$SUPERVISOR_STATE" || true
  fi
  sleep 0.2
done
`;
}

/** Wait for the published file to come back, or give up. */
async function waitForFile(path, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(100);
  }
  return false;
}

/** Run one fake supervisor: start it, take its published file away, look again. */
async function runFakeSupervisor({ republish }) {
  const dir = mkdtempSync(join(tmpdir(), 'hh-publish-e2e-'));
  const stateFile = join(dir, 'published');
  const fake = join(dir, 'fake-supervisor.sh');
  writeFileSync(fake, supervisorSource(lib, stateFile, republish));

  const child = spawn('bash', [fake], { stdio: 'ignore' });
  let result;
  try {
    const published = await waitForFile(stateFile);
    const stateBefore = published ? outsideState(fake, stateFile) : 'nothing';

    // The published file is taken away — what /tmp tidying does.
    rmSync(stateFile, { force: true });
    const stateAfterRemoval = existsSync(stateFile)
      ? outsideState(fake, stateFile)
      : 'nothing';

    // And the supervisor is given a round to put it back.
    const cameBack = await waitForFile(stateFile);
    const stateAfter = cameBack ? outsideState(fake, stateFile) : 'nothing';
    result = { published, stateBefore, stateAfterRemoval, cameBack, stateAfter };
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
  return result;
}

console.log('\nend to end: a running supervisor puts its published state back');
const withRepublish = await runFakeSupervisor({ republish: true });
check('the fake supervisor published its checksum', withRepublish.published);
check(
  'and the outside world reads it as current',
  withRepublish.stateBefore === 'current',
  `state=${withRepublish.stateBefore}`,
);
check(
  'the state is gone the moment the file is taken away',
  withRepublish.stateAfterRemoval === 'nothing',
  `state=${withRepublish.stateAfterRemoval}`,
);
check(
  'and the supervisor puts it back by itself',
  withRepublish.cameBack,
  'the file was not written again',
);
check(
  'and the outside world reads it as current again',
  withRepublish.stateAfter === 'current',
  `state=${withRepublish.stateAfter}`,
);

console.log('\nthe same run WITHOUT the republish is what the live supervisor was doing');
const withoutRepublish = await runFakeSupervisor({ republish: false });
check('the fake supervisor published its checksum', withoutRepublish.published);
check(
  'but it never puts the file back — this is the bug',
  !withoutRepublish.cameBack,
  'the file stayed missing, so the check would say "unpublished" for ever',
);
check(
  'and the outside world is left with nothing to go on',
  withoutRepublish.stateAfter === 'nothing',
  `state=${withoutRepublish.stateAfter}`,
);

console.log('\nthe supervisor is wired to the rule');
const watchdogSource = readFileSync(watchdog, 'utf8');
check('watchdog.sh publishes the checksum of the copy that is running', watchdogSource.includes('supervisor_publish_state'));
check(
  'watchdog.sh publishes it again inside the loop',
  watchdogSource.indexOf('supervisor_publish_state') > watchdogSource.indexOf('while true'),
  'the publish has to happen every round, not only at start-up',
);
check(
  'watchdog.sh is still valid bash',
  execFileSync('bash', ['-n', watchdog], { encoding: 'utf8' }) === '',
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
