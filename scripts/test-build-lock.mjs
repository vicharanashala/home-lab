/**
 * Regression test for the build lock.
 *
 * THE BUG THIS EXISTS FOR
 * The lock was a plain directory, and the holder wrote its identity into that
 * directory AFTER creating it:
 *
 *     if mkdir "$LOCK" 2>/dev/null; then
 *       echo $$ > "$LOCK/pid"
 *       ps -ww -p $$ -o command= > "$LOCK/cmd"
 *
 * Between the mkdir and the `ps` — which forks, and takes tens of
 * milliseconds — the lock existed but had no command line in it. A second
 * build arriving in that window read the lock, saw that the holder's command
 * line did not match the (still empty) one it had been given, and concluded
 * the holder was gone:
 *
 *     [ "$current" = "$stored" ] && return 1
 *     return 0
 *
 * It then broke the lock and took it. Two builds ran at once, both emptying
 * and writing into the same staging directory — the exact corruption the
 * lock was written to prevent, and the thing that loses a build.
 *
 * The same thing happened in the much smaller window between the mkdir and
 * the pid being written: no pid at all means "no holder", so the lock was
 * taken from a build that was still starting up.
 *
 * THE FIX
 * The identity is written into a file of its own first, and the lock is
 * then a HARD LINK to that file. `link()` fails with EEXIST when the
 * destination is already there, so the lock is taken by exactly one build
 * and is only ever visible complete: there is no window in which a lock
 * exists without its holder.
 *
 * Run with:  node scripts/test-build-lock.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The lock library under test. It can be pointed somewhere else so that the
// ORIGINAL lock code can be driven through the same test.
const lib =
  process.env.HH_BUILD_LOCK_LIB || join(here, 'lib', 'build-lock.sh');

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

/**
 * Run the lock's acquire in its own bash process, against a temporary root.
 *
 * The wait is kept short on purpose: the lock's job is to WAIT, and a test
 * that waited the full five minutes to find out would not be run.
 *
 * stderr is captured as well as stdout: the lock reports what it is doing on
 * stderr, and a test that only read stdout would never see the message that
 * says the bug is happening.
 */
function acquire(root, { wait = 2, poll = 1 } = {}) {
  const script =
    `set -uo pipefail\n` +
    `BUILD_LOCK_ROOT=${JSON.stringify(root)}\n` +
    `BUILD_LOCK_WAIT=${wait}\n` +
    `BUILD_LOCK_POLL=${poll}\n` +
    `. ${JSON.stringify(lib)}\n` +
    `build_lock_acquire\n` +
    `rc=$?\n` +
    `echo "acquire exit=$rc"\n` +
    `exit $rc`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const found = out.match(/acquire exit=(\d+)/);
  return { out, code: found ? Number(found[1]) : (res.status ?? 1) };
}

/** A process that is alive for the length of the test. */
function liveHolder() {
  const proc = spawn('sleep', ['120'], { stdio: 'ignore' });
  return { proc, pid: proc.pid };
}

/** A pid that is guaranteed to be gone. */
function deadPid() {
  const proc = spawn('sleep', ['0.05'], { stdio: 'ignore' });
  proc.unref();
  return proc.pid;
}

const roots = [];
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'hh-build-lock-'));
  roots.push(root);
  return root;
}

console.log('\na live holder keeps its lock');
{
  const root = tempRoot();
  const holder = liveHolder();
  // The exact state the old lock was visible in: the lock exists, the pid is
  // in it, and the command line has not been written yet.
  mkdirSync(join(root, '.build.lock'));
  writeFileSync(join(root, '.build.lock', 'pid'), String(holder.pid));

  const { out, code } = acquire(root);
  ok(
    !out.includes('breaking a stale build lock'),
    'a lock whose holder is alive is NOT broken',
    out.trim().split('\n').filter(Boolean).join(' | '),
  );
  ok(out.includes('another build is running'), 'the second build waits for the first');
  ok(code !== 0, 'the second build gives up rather than stealing the lock', `exit ${code}`);
  ok(
    existsSync(join(root, '.build.lock', 'pid')) &&
      readFileSync(join(root, '.build.lock', 'pid'), 'utf8').trim() === String(holder.pid),
    'the live holder still holds the lock afterwards',
  );
  holder.proc.kill();
}

console.log('\na lock whose holder is dead is reclaimed');
{
  const root = tempRoot();
  // The same shape, but the holder is gone.
  mkdirSync(join(root, '.build.lock'));
  writeFileSync(join(root, '.build.lock', 'pid'), String(deadPid()));
  writeFileSync(join(root, '.build.lock', 'cmd'), 'sleep 0.05\n');

  const { out, code } = acquire(root);
  ok(out.includes('breaking a stale build lock'), 'the dead holder is detected');
  ok(code === 0, 'the lock is taken over', `exit ${code}`);
  ok(out.includes('acquire exit=0'), 'the acquire itself succeeded');
}

console.log('\nthe lock is complete the moment it becomes visible');
{
  const root = tempRoot();
  const script =
    `set -uo pipefail\n` +
    `BUILD_LOCK_ROOT=${JSON.stringify(root)}\n` +
    `BUILD_LOCK_WAIT=2\n` +
    `BUILD_LOCK_POLL=1\n` +
    `. ${JSON.stringify(lib)}\n` +
    `build_lock_acquire || exit 1\n` +
    `echo "regular-file=$([ -f "$BUILD_LOCK" ] && echo yes || echo no)"\n` +
    `echo "pid=$(sed -n 1p "$BUILD_LOCK" 2>/dev/null)"\n` +
    `echo "cmd=$(sed -n 2p "$BUILD_LOCK" 2>/dev/null)"`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ok(out.includes('regular-file=yes'), 'the lock is a plain file', out.trim());
  ok(/pid=\d+/.test(out), 'the holder\'s pid is readable in the lock');
  ok(/cmd=.+/.test(out), 'the holder\'s command line is readable in the lock');
}

console.log('\nthe lock is never visible without its holder');
{
  const root = tempRoot();
  // A watcher looks at the lock while builds come and go. Every single time
  // the lock exists it must ALREADY carry the pid and the command line: a
  // lock that can be seen before its holder is written is the bug, and it is
  // the whole reason the lock is a hard link rather than a directory.
  //
  // The builds run asynchronously on purpose: a synchronous child would
  // block the event loop, and the watcher would only ever look at the lock
  // between builds, when it is already gone.
  const lockPath = join(root, '.build.lock');
  const script =
    `set -uo pipefail\n` +
    `BUILD_LOCK_ROOT=${JSON.stringify(root)}\n` +
    `BUILD_LOCK_WAIT=2\n` +
    `BUILD_LOCK_POLL=1\n` +
    `. ${JSON.stringify(lib)}\n` +
    `build_lock_acquire || exit 1\n` +
    `sleep 0.3\n`;
  let bad = 0;
  let seen = 0;
  let watching = true;
  const watcher = setInterval(() => {
    if (!watching || !existsSync(lockPath)) return;
    seen += 1;
    let body = '';
    try {
      body = readFileSync(lockPath, 'utf8');
    } catch {
      bad += 1;
      return;
    }
    const lines = body.split('\n');
    if (!/^\d+$/.test(lines[0] || '') || !lines[1]) bad += 1;
  }, 1);

  await Promise.all(
    Array.from({ length: 4 }, () =>
      new Promise((resolve) => {
        const proc = spawn('bash', ['-c', script], { stdio: 'ignore' });
        proc.on('exit', resolve);
      }),
    ),
  );
  watching = false;
  clearInterval(watcher);

  ok(seen > 0, 'the watcher saw the lock at least once', `${seen} sightings`);
  ok(bad === 0, 'the lock always carried its pid AND its command line', `${bad} incomplete sightings`);
}

console.log('\ntwo builds: only one gets the lock');
{
  const root = tempRoot();
  // The holder waits for a release file rather than for a fixed number of
  // seconds, so the second build can never win the lock by the first one
  // simply finishing first.
  const releaseFile = join(root, 'release');
  const holderScript =
    `set -uo pipefail\n` +
    `BUILD_LOCK_ROOT=${JSON.stringify(root)}\n` +
    `BUILD_LOCK_WAIT=2\n` +
    `BUILD_LOCK_POLL=1\n` +
    `. ${JSON.stringify(lib)}\n` +
    `build_lock_acquire || exit 1\n` +
    `echo "held"\n` +
    `for _ in $(seq 1 100); do\n` +
    `  [ -f ${JSON.stringify(releaseFile)} ] && break\n` +
    `  sleep 0.2\n` +
    `done\n`;
  const holder = spawn('bash', ['-c', holderScript], { stdio: ['ignore', 'pipe', 'pipe'] });
  let held = false;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    holder.stdout.on('data', (d) => {
      if (String(d).includes('held')) {
        held = true;
        clearTimeout(timer);
        resolve();
      }
    });
    holder.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  ok(held, 'the first build took the lock');

  const { out, code } = acquire(root, { wait: 1, poll: 1 });
  ok(
    !out.includes('breaking a stale build lock'),
    'the second build does not break the first one\'s lock',
    out.trim().split('\n').filter(Boolean).join(' | '),
  );
  ok(code !== 0, 'the second build waits its turn and gives up', `exit ${code}`);
  ok(existsSync(join(root, '.build.lock')), 'the first build still holds the lock');

  writeFileSync(releaseFile, 'go\n');
  holder.kill();
}

console.log("\nthe lock's scratch files never reach the index");
{
  // The lock writes two files into the repository root: the lock itself, and
  // the holder's own copy of the identity behind it. Both are scratch — a
  // build that ends normally removes them, and one that is killed leaves them
  // behind until the next build reclaims the stale lock.
  //
  // A killed build is exactly what this lock exists for, and in the window
  // between that kill and the next build the documented commit flow
  // (`git add -A`) sweeps whatever is untracked into the commit. So the names
  // the lock actually writes have to be ignored BY NAME.
  //
  // They are read out of the library rather than written here, so that
  // renaming the identity file cannot leave this test checking a name that no
  // longer exists — the mistake it exists to catch.
  //
  // WHY A THROWAWAY REPOSITORY
  // `git check-ignore` only works inside a git repository, and the quality
  // gate does not run the tests in one: it exports the staged commit to a
  // temporary directory and runs the tests from THERE, which is not a git
  // repository at all. Asking git about a path in the real repository would
  // therefore fail inside the gate and pass outside it — the worst kind of
  // test. So the repository's own .gitignore is copied into a throwaway
  // repository, and git is asked about it there.
  const repoRoot = join(here, '..');
  const script =
    `set -uo pipefail\n` +
    `BUILD_LOCK_ROOT=${JSON.stringify(repoRoot)}\n` +
    `. ${JSON.stringify(lib)}\n` +
    `echo "lock=$BUILD_LOCK"\n` +
    `echo "info=$BUILD_LOCK_INFO"\n`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30_000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const lockPath = (out.match(/^lock=(.*)$/m) || [])[1] || '';
  const infoPath = (out.match(/^info=(.*)$/m) || [])[1] || '';

  ok(Boolean(lockPath), 'the lock path could be read from the library', out.trim().split('\n').filter(Boolean).join(' | '));
  ok(Boolean(infoPath), 'the identity path could be read from the library', out.trim().split('\n').filter(Boolean).join(' | '));

  const scratchRepo = mkdtempSync(join(tmpdir(), 'hh-ignore-'));
  roots.push(scratchRepo);
  const initRes = spawnSync('git', ['init', '-q'], { cwd: scratchRepo, encoding: 'utf8' });
  ok(initRes.status === 0, 'a throwaway git repository could be created', initRes.stderr || '');
  copyFileSync(join(repoRoot, '.gitignore'), join(scratchRepo, '.gitignore'));

  const ignored = (path) =>
    spawnSync('git', ['check-ignore', '-q', basename(path)], {
      cwd: scratchRepo,
      encoding: 'utf8',
    }).status === 0;

  ok(ignored(lockPath), 'the lock file is ignored by git', basename(lockPath));
  ok(ignored(infoPath), "the holder's identity file is ignored by git", basename(infoPath));
}

for (const root of roots) rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
