/**
 * Regression test: the supervisor must notice an edit to the RULE LIBRARIES
 * it runs, not only an edit to watchdog.sh.
 *
 * THE BUG THIS EXISTS FOR
 * The supervisor watched ONE file for changes: watchdog.sh. But watchdog.sh
 * does not hold the rules — it SOURCES them:
 *
 *   . "$ROOT/scripts/lib/bridge-stale.sh"        # the bridge's staleness rule
 *   . "$ROOT/scripts/lib/supervisor-reload.sh"    # the supervisor's own rule
 *
 * So "the copy of watchdog.sh on disk" was not the code the supervisor was
 * running. Editing a rule library changed the rule the supervisor applies,
 * and every supervisor alive at the time went on applying the old one, for
 * ever — the same defect as the one before it, one level down. Commit
 * 9591251 ("Let the supervisor pick up edits to itself") ended that one by
 * making the supervisor watch its own file.
 *
 * MEASURED ON THE LIVE MACHINE (2026-10-25)
 * A copy of the supervisor's wiring was run with a rule library beside it.
 * The library was edited. The supervisor kept printing the OLD rule:
 *
 *   RUNNING rule=ONE
 *   RUNNING rule=ONE      <-- after the edit to the library
 *
 * The old rule computed the checksum of watchdog.sh alone, so a change to
 * the library did not change the checksum, so there was nothing to notice.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS: the rules in scripts/lib/ are where the
 * decisions live — whether the bridge is on the code on disk, whether the
 * supervisor is on the code on disk. A rule that cannot be changed while the
 * app is running is a rule that can only be changed by restarting the app,
 * which is the thing the supervisor exists to avoid.
 *
 * WHAT IS TESTED HERE
 *  - the rule watches the whole set it runs, and the set is the script plus
 *    the rule libraries beside it;
 *  - editing a rule library changes the checksum of the code that is running,
 *    and the supervisor says "reload";
 *  - a rule library that does not parse stops the reload, exactly as a
 *    half-written watchdog.sh does;
 *  - the check OUTSIDE the supervisor watches the same set, so the two sides
 *    cannot disagree about what "current" means;
 *  - the list of watched libraries cannot drift away from the files
 *    watchdog.sh actually loads;
 *  - and end to end, with a fake supervisor: editing a rule library reaches
 *    the running supervisor. The same run is done again with the reload
 *    switched off, so the test fails against the old behaviour rather than
 *    merely describing it.
 *
 * Run with:  node scripts/test-supervisor-watched-set.mjs
 *
 *   HH_SUPERVISOR_RULE_LIB  the rule library to copy into the fixture
 *                           (scripts/lib/supervisor-reload.sh)
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const ruleLib = process.env.HH_SUPERVISOR_RULE_LIB || join(repoRoot, 'scripts', 'lib', 'supervisor-reload.sh');
const liveLib = join(repoRoot, 'scripts', 'lib', 'live-state.sh');
const watchdog = join(repoRoot, 'watchdog.sh');

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

/**
 * Build a tree that looks like the repository: a supervisor script at the top
 * and the rule libraries under scripts/lib/.
 *
 * WHY A COPY AND NOT THE REPOSITORY ITSELF: the test edits the rule library
 * to make the rule notice a change. The repository's own library must not be
 * edited by a test — another agent may be working in it, and a test that
 * rewrites a file another agent is editing is a test that breaks their work.
 *
 * @param dir   the directory to build the tree in
 * @param value the value the stub rule library publishes
 * @returns the paths of the tree
 */
function buildTree(dir, value) {
  const libDir = join(dir, 'scripts', 'lib');
  mkdirSync(libDir, { recursive: true });
  copyFileSync(ruleLib, join(libDir, 'supervisor-reload.sh'));
  writeFileSync(
    join(libDir, 'bridge-stale.sh'),
    `#!/bin/bash\n# A stand-in for the bridge's rule library.\nRULE_VALUE="${value}"\n`,
  );
  return { script: join(dir, 'watchdog.sh'), libDir };
}

/**
 * Run a snippet with the rule library of the fixture sourced.
 *
 * WHY A SNIPPET THAT FAILS IS AN ANSWER AND NOT A CRASH: the rule this test
 * is about does not exist yet in the old rule library, and a test that dies
 * with a stack trace says nothing about which check failed. Every call here
 * turns a refusal into an answer the checks can report.
 */
function sh(fixtureLib, script) {
  try {
    return execFileSync('bash', ['-c', `source "${fixtureLib}"; ${script}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const said = `${err.stderr ?? ''}`.trim();
    return `error: ${said.split('\n')[0] || err.message}`;
  }
}

/** What the rule says about the supervisor on disk. */
function selfState(fixtureLib, script, loadedSum) {
  return sh(fixtureLib, `supervisor_self_state "${script}" "${loadedSum}"`);
}

/** The checksum of the code the supervisor runs, as the rule computes it. */
function watchedSum(fixtureLib, script) {
  return sh(fixtureLib, `supervisor_watched_sum "${script}"`);
}

/* -------------------------------------------------------------------------- */

console.log('\nthe set the supervisor watches: the script AND the rules it loads');

const work = mkdtempSync(join(tmpdir(), 'hh-watched-'));
const tree = buildTree(work, 'ONE');
const fixtureLib = join(tree.libDir, 'supervisor-reload.sh');

writeFileSync(
  tree.script,
  '#!/bin/bash\n. "' + join(tree.libDir, 'bridge-stale.sh') + '"\n. "' + fixtureLib + '"\necho supervisor\n',
);

const watchedFiles = sh(fixtureLib, `supervisor_watched_files "${tree.script}"`);
const watchedList = watchedFiles.split('\n').filter(Boolean);
check(
  'the supervisor watches its own script',
  watchedList.some((f) => f.endsWith('watchdog.sh')),
  watchedList.join(', '),
);
check(
  'and the rule library it loads',
  watchedList.some((f) => f.endsWith('scripts/lib/bridge-stale.sh')),
  watchedList.join(', '),
);
check(
  'and the rule library that decides whether it reloads',
  watchedList.some((f) => f.endsWith('scripts/lib/supervisor-reload.sh')),
  watchedList.join(', '),
);

console.log('\nan edit to a rule library changes the code that is running');
const sumBefore = watchedSum(fixtureLib, tree.script);
writeFileSync(
  join(tree.libDir, 'bridge-stale.sh'),
  '#!/bin/bash\n# A stand-in for the bridge\'s rule library.\nRULE_VALUE="TWO"\n',
);
const sumAfter = watchedSum(fixtureLib, tree.script);
check(
  'the checksum of the running code changes when a rule library changes',
  sumBefore !== sumAfter,
  `${sumBefore} -> ${sumAfter}`,
);

console.log('\nso the supervisor says it has to reload');
check(
  'an edited rule library is a reload',
  selfState(fixtureLib, tree.script, sumBefore) === 'reload',
  `state=${selfState(fixtureLib, tree.script, sumBefore)}`,
);
check(
  'and an untouched tree is not',
  selfState(fixtureLib, tree.script, sumAfter) === 'current',
  `state=${selfState(fixtureLib, tree.script, sumAfter)}`,
);

console.log('\nand every guard still fails closed');
writeFileSync(join(tree.libDir, 'bridge-stale.sh'), 'if [ ; then\n');
check(
  'a rule library that does not parse stops the reload',
  selfState(fixtureLib, tree.script, sumBefore) === 'unparsable',
  `state=${selfState(fixtureLib, tree.script, sumBefore)}`,
);
writeFileSync(
  join(tree.libDir, 'bridge-stale.sh'),
  '#!/bin/bash\n# A stand-in for the bridge\'s rule library.\nRULE_VALUE="TWO"\n',
);
// The rule library that is MISSING is the stub, not the one the rule is run
// from: the point is that a tree which cannot load all of its rules cannot be
// said to be the code that is running.
rmSync(join(tree.libDir, 'bridge-stale.sh'), { force: true });
check(
  'a rule library that is not there is unknown, never current',
  selfState(fixtureLib, tree.script, sumBefore) === 'unknown',
  `state=${selfState(fixtureLib, tree.script, sumBefore)}`,
);
writeFileSync(
  join(tree.libDir, 'bridge-stale.sh'),
  '#!/bin/bash\n# A stand-in for the bridge\'s rule library.\nRULE_VALUE="TWO"\n',
);

console.log('\nand the check outside the supervisor watches the same set');
// The outside check reads the published checksum and compares it with the
// code on disk. Both sides have to watch the SAME set, or one side says
// "current" while the other says "stale" about the same app.
const outsideState = (script, published) =>
  execFileSync(
    'bash',
    ['-c', `source "${liveLib}"; live_supervisor_state "${script}" "${published}"`],
    { encoding: 'utf8' },
  ).trim();

const publishedFile = join(work, 'published.checksum');
// The published state is the checksum of the code that is running — the whole
// set, the same number the supervisor publishes — and the pid of the
// supervisor that published it, so that a state file that outlives its writer
// cannot call a supervisor current. This test's own pid is alive for as long
// as the test is.
writeFileSync(publishedFile, `${sumAfter} ${process.pid}\n`);
check(
  'a supervisor running the code on disk is current',
  outsideState(tree.script, publishedFile) === 'current',
  `state=${outsideState(tree.script, publishedFile)}`,
);
writeFileSync(
  join(tree.libDir, 'bridge-stale.sh'),
  '#!/bin/bash\n# A stand-in for the bridge\'s rule library.\nRULE_VALUE="THREE"\n',
);
check(
  'and an edited rule library makes it stale',
  outsideState(tree.script, publishedFile) === 'stale',
  `state=${outsideState(tree.script, publishedFile)}`,
);

console.log('\nthe list of watched libraries cannot drift from what watchdog.sh loads');
const ruleList = execFileSync(
  'bash',
  ['-c', `source "${ruleLib}"; printf '%s\\n' "\${SUPERVISOR_RULE_LIBS[@]}"`],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .sort();
const sourced = readFileSync(watchdog, 'utf8')
  .split('\n')
  .map((line) => line.match(/^\s*\.\s+"?\$\{?ROOT\}?\/([^"]+)"?\s*$/))
  .filter(Boolean)
  .map((m) => m[1])
  .sort();
check(
  'the rule library lists every file watchdog.sh loads',
  sourced.every((f) => ruleList.includes(f)),
  `watchdog.sh loads ${sourced.join(', ')}; the rule watches ${ruleList.join(', ')}`,
);
check(
  'and watchdog.sh loads nothing the rule does not watch',
  ruleList.every((f) => sourced.includes(f)),
  `watchdog.sh loads ${sourced.join(', ')}; the rule watches ${ruleList.join(', ')}`,
);

/* ---- end to end: a running supervisor and an edit to a rule library ---- */

/**
 * A fake supervisor: the same wiring the real one uses, with a marker that
 * says which version of the rule it is running.
 *
 * WHY THE FALLBACK FOR supervisor_watched_sum: the same fake has to run
 * against the OLD rule library, where the function does not exist yet. The
 * fallback is the old behaviour — the checksum of the script alone — so the
 * test can show the difference rather than merely describe it.
 *
 * @param dir       the tree the supervisor runs in
 * @param logFile   where the supervisor writes what it is doing
 * @param reload    whether the copy re-reads its own code
 */
function supervisorSource(dir, logFile, reload) {
  const libDir = join(dir, 'scripts', 'lib');
  return `#!/bin/bash
set -u
. "${join(libDir, 'bridge-stale.sh')}"
. "${join(libDir, 'supervisor-reload.sh')}"
SELF_PATH="$0"
if command -v supervisor_watched_sum >/dev/null 2>&1; then
  SELF_LOADED_SUM="$(supervisor_watched_sum "$SELF_PATH")"
else
  SELF_LOADED_SUM="$(supervisor_script_sum "$SELF_PATH")"
fi
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "${logFile}"; }
echo "RUNNING rule=$RULE_VALUE pid=$$" >> "${logFile}"
while true; do
${reload ? '  supervisor_reload_if_changed "$SELF_PATH" "$SELF_LOADED_SUM" log' : '  :'}
  echo "TICK rule=$RULE_VALUE" >> "${logFile}"
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

/** Run one fake supervisor: start it, edit a rule library, watch what it does. */
async function runFakeSupervisor({ reload }) {
  const dir = mkdtempSync(join(tmpdir(), 'hh-watched-e2e-'));
  const logFile = join(dir, 'supervisor.log');
  const tree = buildTree(dir, 'ONE');
  const script = join(dir, 'watchdog.sh');
  writeFileSync(script, supervisorSource(dir, logFile, reload));

  const child = spawn('bash', [script], { stdio: 'ignore' });
  let result;
  try {
    const started = await waitForLine(logFile, 'RUNNING rule=ONE');
    // The rule library is edited while the supervisor is running it.
    writeFileSync(
      join(tree.libDir, 'bridge-stale.sh'),
      '#!/bin/bash\n# A stand-in for the bridge\'s rule library.\nRULE_VALUE="TWO"\n',
    );
    const pickedUp = await waitForLine(logFile, 'RUNNING rule=TWO');
    const log = readFileSync(logFile, 'utf8');
    result = { started, pickedUp, log };
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
  return result;
}

console.log('\nend to end: an edit to a rule library reaches the running supervisor');
const withReload = await runFakeSupervisor({ reload: true });
check('the fake supervisor started', withReload.started);
check(
  'it picks up the edit to the rule library',
  withReload.pickedUp,
  withReload.pickedUp ? '' : `log was:\n${withReload.log}`,
);
check(
  'and it says that it reloaded',
  withReload.log.includes('reloading this supervisor'),
  withReload.log.includes('reloading this supervisor') ? '' : withReload.log,
);

console.log('\nthe same run WITHOUT the rule is what the live supervisor was doing');
const withoutReload = await runFakeSupervisor({ reload: false });
check('the fake supervisor started', withoutReload.started);
check(
  'and it never picks up the edit — this is the bug',
  !withoutReload.pickedUp,
  'without watching the rule library the edit is invisible to the running copy',
);

rmSync(work, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
