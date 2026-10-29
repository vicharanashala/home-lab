/**
 * Temporary working files and directories that take themselves away.
 *
 * WHY THIS EXISTS
 *
 * A test that builds a page for real needs somewhere to build it: a directory
 * that can resolve `react`, a stub of the store, a bundle written out. The
 * obvious place is the system's temporary directory, and `mkdtemp` gives every
 * run its own directory so two runs cannot collide.
 *
 * The obvious thing is then to forget the directory. Nineteen of the test
 * scripts did — they made a directory and never removed it, so every run of
 * the suite left one behind. On 2026-10-29 there were 8,418 of them on this
 * machine, holding 76 GB, and the data volume was at 98% with 12 GB free:
 *
 *     the "Expiring soon" card test   5 directories, 23 MB each
 *     the Alerts heading test         3 directories, 39 MB each
 *
 * They are not small because the directory is used — it is used to write a
 * bundle of the page, which is megabytes. So the suite was writing a quarter
 * of a gigabyte to the disk on every run, and the quality gate runs the suite
 * on every commit, for every agent.
 *
 * WHY THE REMOVAL HAPPENS WHEN THE PROCESS ENDS
 *
 * The directory has to outlive the code that reads from it — the bundle is
 * imported out of the directory, and a test that removed the directory too
 * early would break the very thing it is testing. Removing it when the
 * process ends is the one moment when nothing can still be reading it.
 *
 * WHY IT IS AN EXIT HANDLER AND NOT A `finally`: a `finally` has to be placed
 * around the code that uses the directory, and that is a different place in
 * every one of the nineteen scripts — easy to get wrong, and easy to leave
 * out when a script grows a new branch. The exit handler is registered where
 * the directory is made, so it cannot be forgotten, and it runs whether the
 * test finishes, fails, or throws on the way out.
 *
 * WHY `rmSync` AND NOT THE ASYNCHRONOUS `rm`: an exit handler must finish
 * before the process goes away, and an asynchronous removal would be cut off
 * half way through. `rmSync` is synchronous, so the directory is gone by the
 * time the process is.
 *
 * WHY THE REMOVAL NEVER FAILS THE TEST: a directory that cannot be removed is
 * a piece of litter, not a broken test. It is reported and the test's own
 * result stands — a test that passed has passed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The paths this process is going to remove when it ends.
 *
 * WHY IT IS A SET: the removal is registered by path, and registering the
 * same path twice would register the handler twice — the second removal would
 * find nothing there and report an error that never happened. The set makes
 * the registration idempotent.
 */
const removals = new Set();

/**
 * Arrange for a path to be removed when this process ends.
 *
 * @param {string} target the file or directory to remove
 * @returns {void}
 */
function removeWhenTheProcessEnds(target) {
  if (removals.has(target)) return;
  removals.add(target);
  process.on('exit', () => {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch (err) {
      // WHY THIS IS REPORTED AND NOT SWALLOWED: the directory is the size of
      // a bundle, and a run that leaves one behind is a run that fills the
      // disk. Saying so is the only way anyone finds out that the removal
      // stopped working.
      process.stderr.write(`  could not remove ${target}: ${err && err.message ? err.message : err}\n`);
    }
  });
}

/**
 * A temporary working directory that is removed when the process ends.
 *
 * WHY THE PREFIX IS THE CALLER'S: the prefix is what tells one leftover from
 * another on the disk, and it is the name the test already gives the
 * directory — "hh-dashboard-", "hh-stockrow-". See `removeWhenTheProcessEnds`
 * for why the directory outlives the code that made it.
 *
 * @param {string} prefix the name the directory is given in the temp directory
 * @returns {string} the path of the directory
 */
export const tmpWorkDir = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  removeWhenTheProcessEnds(dir);
  return dir;
};

/**
 * The path of a temporary file that is removed when the process ends.
 *
 * WHY THE FILE IS GIVEN A UNIQUE NAME: two runs of the same test at the same
 * time would write the same file, and one of them removing it while the
 * other was still reading it would turn a collision into a failure. The
 * suffix is what keeps the two apart — and it is the same suffix the tests
 * were writing by hand before this helper existed.
 *
 * WHY THE CALLER STILL WRITES THE FILE: this returns a path, not a file. The
 * caller writes the stub's contents, which is the part that differs from one
 * test to the next.
 *
 * @param {string} name the name the file is given, without a suffix
 * @returns {string} the path of the file
 */
export const tmpStubFile = (name) => {
  const unique = `${name.replace(/\.mjs$/, '')}-${Math.random().toString(36).slice(2)}.mjs`;
  const file = path.join(tmpdir(), unique);
  removeWhenTheProcessEnds(file);
  return file;
};
