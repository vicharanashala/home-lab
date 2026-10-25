/**
 * Regression test: the gate must not pass a commit whose index moved while
 * the gate was checking it.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The gate exports the staged index to a temporary directory and checks THAT:
 * the type check, the dead-code ratchet and the tests all run against the
 * export. The commit, though, is made from the index as it stands at the END
 * of the check — and the check takes a minute or two.
 *
 * In that window another agent can change the index. `git stash` is the one
 * that bites, because it takes a staged change OUT of the index and puts it
 * back on the worktree. The gate goes on checking the export, passes, and
 * the commit is then made from an index that no longer holds what was
 * checked.
 *
 * It is not a theory. On 2026-10-25 commit 195e14b landed carrying a test
 * that was RED against the code shipped beside it:
 *
 *     195e14b  Do not let a nameless row answer for the row the user named
 *               scripts/test-agent-action-names.mjs | 307 +++++++++++++++++++
 *
 * The fix in src/utils/agentActions.ts was staged, the gate checked the fix
 * and the test together and passed, and a `git stash` from another agent took
 * the fix out of the index in the middle. The commit held the proof and not
 * the thing it proved. The agent that made it noticed and shipped the fix in
 * 0f2e74b four minutes later — but the gate said "GATE PASSED" both times,
 * because the gate cannot tell that the index it checked is not the index it
 * is about to pass.
 *
 * WHY THIS IS WORTH A TEST: the gate is the one thing every agent's commit
 * goes through, and its whole job is to answer a question about a COMMIT.
 * A gate that passes a commit it did not check is a false all-clear about
 * the one thing nobody re-reads afterwards.
 *
 * WHAT THE TEST DOES
 *
 * It builds a small repository of its own — a fake repo, with a fake source
 * file and a fake package.json — and runs the gate against it twice:
 *
 *   1. The real gate, with the index moved while it checks. The gate has to
 *      FAIL and has to say WHY: the index changed.
 *
 *   2. The same gate with the comparison neutralised — one line changed, so
 *      the check can never fire. It has to PASS, and it has to pass on the
 *      SAME repository with the SAME index move.
 *
 * The second run is what makes the first one mean anything. Without it, a
 * gate that failed for any other reason — a type error, a missing file, a
 * broken fixture — would look like the fix working. With it, the only
 * difference between a failing run and a passing run is the check itself,
 * so the check is what caught the index move.
 *
 * WHY THE FAKE REPO AND NOT THE REAL ONE: the real repository has other
 * agents committing in it, and the whole point is to move the index while
 * the gate runs. A test that moved the index of the real repository would
 * disturb their work. The fake repo is built from the files beside this
 * test, and it is as small as the gate allows.
 *
 * WHY THE MOVE IS PLANTED IN secret-scan.sh: the gate SOURCES that file
 * while it is checking — the secret scan is one of its steps. Sourcing it is
 * a seam the gate already has, so the index moves after the export and
 * before the verdict, which is exactly the window that matters. No timing,
 * no sleeping, no racing.
 *
 * WHY THE TESTS ARE SKIPPED IN THE GATE RUNS: this test is about WHICH
 * COMMIT the gate passes, not about what the test suite says. The type
 * check is enough to make the run long enough to matter, and skipping the
 * suite keeps this test quick.
 *
 * Run with:  node scripts/test-gate-index-moved.mjs
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const gatePath = join(here, 'quality-gate.sh');

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
 * The line that reads the index a second time, at the end of the check.
 *
 * WHY THE TEST KNOWS THIS LINE: the control run below has to neutralise the
 * check without neutrinking anything else, and one line is the smallest
 * thing that can be neutralised. If the gate's shape changes and the line
 * is gone, the test says so plainly rather than passing quietly — a test
 * that stops testing because the code moved is worse than no test.
 */
const FINGERPRINT_LINE = 'INDEX_FINGERPRINT_AFTER="$(index_fingerprint)"';

/**
 * The gate with the index check neutralised.
 *
 * WHY THIS IS THE CONTROL AND NOT THE ORIGINAL GATE: the point is to show
 * that the index check is what makes the difference. Replacing the second
 * reading with the first makes the two always equal, so the check can never
 * fire and every other part of the gate behaves exactly as it does in the
 * run that must fail.
 */
function neutralisedGate(source) {
  return source.replace(
    FINGERPRINT_LINE,
    'INDEX_FINGERPRINT_AFTER="$INDEX_FINGERPRINT_BEFORE"',
  );
}

/**
 * The environment the fake repository's git commands run in.
 *
 * WHY EVERY GIT_* VARIABLE IS REMOVED: git sets GIT_INDEX_FILE to a
 * temporary index when a commit is made with a pathspec, and every git
 * command a child process runs INHERITS it. A test that ran its git
 * commands without clearing it would be reading — and writing — THE REAL
 * REPOSITORY'S INDEX. The planted mutation would delete an entry from the
 * index of the very commit that was running the test, and the gate that
 * commit was running would refuse it.
 *
 * That is not a theory. The first version of this test did exactly that, and
 * it stopped the commit that was running it: the gate reported that the index
 * had changed while it was being checked, and the index really had — the
 * test had changed it.
 *
 * WHY THE WHOLE SET AND NOT JUST GIT_INDEX_FILE: GIT_DIR and
 * GIT_OBJECT_DIRECTORY would point git at the real repository as well, and a
 * test that builds a repository of its own must not be able to reach the
 * owner's.
 */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

/**
 * A repository small enough for the gate to check quickly.
 *
 * WHY IT HAS A package.json: npx only resolves a project's local
 * typescript when the directory it runs in IS a project. Without one, the
 * gate's own type check silently runs the placeholder `tsc` package from the
 * registry instead of the real compiler — and a type check that checks
 * nothing is a green light of the worst kind.
 *
 * WHY IT NEEDS A node_modules: the gate symlinks ITS OWN root's node_modules
 * into the export it checks, so this repository needs one that points at the
 * real one.
 */
function buildFakeRepo(work) {
  const fake = join(work, 'fake');
  mkdirSync(join(fake, 'src'), { recursive: true });

  // The gate under test, and the scripts it sources, as they are now.
  cpSync(join(repoRoot, 'scripts'), join(fake, 'scripts'), { recursive: true });
  cpSync(join(repoRoot, 'vite.config.ts'), join(fake, 'vite.config.ts'));
  cpSync(join(repoRoot, 'tsconfig.node.json'), join(fake, 'tsconfig.node.json'));

  writeFileSync(
    join(fake, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          skipLibCheck: true,
          strict: true,
          noEmit: true,
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(join(fake, 'src', 'index.ts'), 'export const probe: number = 1;\n');
  writeFileSync(
    join(fake, 'package.json'),
    JSON.stringify(
      {
        name: 'hh-gate-fake',
        private: true,
        version: '0.0.0',
        devDependencies: { typescript: '^5.0.0' },
      },
      null,
      2,
    ) + '\n',
  );

  // The move. The gate sources this file during the check, so the index
  // changes after the export and before the verdict.
  const scanPath = join(fake, 'scripts', 'lib', 'secret-scan.sh');
  writeFileSync(
    scanPath,
    readFileSync(scanPath, 'utf8') +
      '\n# --- planted by scripts/test-gate-index-moved.mjs ---\n' +
      'git update-index --force-remove src/index.ts\n',
  );

  if (!existsSync(join(fake, 'node_modules'))) {
    symlinkSync(join(repoRoot, 'node_modules'), join(fake, 'node_modules'));
  }
  writeFileSync(join(fake, '.gitignore'), 'node_modules\n');

  const git = (args) =>
    spawnSync('git', args, { cwd: fake, encoding: 'utf8', env: cleanEnv() });
  git(['init', '-q', '.']);
  git(['config', 'user.email', 'gate-test@example.com']);
  git(['config', 'user.name', 'gate test']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fake repo']);

  return fake;
}

/** The index, hashed. Two of these being equal means the index held still. */
function fingerprint(dir) {
  const run = spawnSync('git', ['ls-files', '-s'], {
    cwd: dir,
    encoding: 'utf8',
    env: cleanEnv(),
  });
  return spawnSync('shasum', { input: run.stdout || '', encoding: 'utf8' })
    .stdout.split(' ')[0];
}

/** Run a gate against the fake repo and report what it said. */
function runGate(fake, gateFile) {
  const run = spawnSync('bash', [gateFile], {
    cwd: fake,
    encoding: 'utf8',
    timeout: 600_000,
    env: cleanEnv({ HH_SKIP_TESTS: '1' }),
  });
  return {
    status: run.status,
    out: `${run.stdout || ''}${run.stderr || ''}`,
  };
}

const work = join(tmpdir(), `hh-gate-index-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

try {
  // The index of the repository this test is running inside, if there is
  // one. When the gate runs this test, git has pointed GIT_INDEX_FILE at the
  // index of the commit being made — and a test that wrote to it would change
  // the commit that was running it. That is not hypothetical: the first
  // version of this test did it, and the gate refused the commit with "the
  // index changed while this commit was being checked" — which was true, and
  // was the test's doing.
  //
  // WHY IT MAY NOT BE READABLE: the gate runs the test suite from the export
  // it made, and that export is not a git repository. There is no outer
  // repository to read the index from there, and saying so is honest — a
  // comparison between two empty strings would look like a pass and prove
  // nothing.
  const outerIndexFile = process.env.GIT_INDEX_FILE || '';
  let outerEntriesBefore = null;
  let outerWhy = 'GIT_INDEX_FILE is not set';
  if (outerIndexFile) {
    const read = spawnSync('git', ['ls-files', '-s'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, GIT_INDEX_FILE: outerIndexFile },
    });
    if (read.status === 0) {
      outerEntriesBefore = read.stdout;
      outerWhy = 'the index was read';
    } else {
      outerWhy = 'the calling directory is not a git repository — nothing to protect';
    }
  }

  console.log('\nthe gate refuses a commit whose index moved while it checked');
  {
    const fake = buildFakeRepo(work);
    const source = readFileSync(gatePath, 'utf8');

    ok(
      source.includes(FINGERPRINT_LINE),
      'the gate reads the index a second time at the end of the check',
      source.includes(FINGERPRINT_LINE) ? '' : 'the gate no longer has the index check in the shape this test knows',
    );

    const before = fingerprint(fake);
    const run = runGate(fake, join(fake, 'scripts', 'quality-gate.sh'));
    const after = fingerprint(fake);

    ok(before !== after, 'and the index really did move during the run', `${before.slice(0, 12)} -> ${after.slice(0, 12)}`);
    ok(run.status !== 0, 'the gate FAILS', `exit ${run.status}`);
    ok(
      run.out.includes('the index changed while this commit was being checked'),
      'and it says the index changed',
    );
    ok(!run.out.includes('GATE PASSED'), 'the gate does not report a pass');
  }

  console.log('\nthe index check is what makes the difference');
  {
    // The SAME repository, with the SAME index move, and the check
    // neutralised. If this run passes, the first run failed because of the
    // check and not because of anything else in the fixture.
    const fake = buildFakeRepo(join(work, 'control'));
    const source = readFileSync(gatePath, 'utf8');
    const control = join(fake, 'scripts', 'quality-gate.sh');
    writeFileSync(control, neutralisedGate(source));

    const before = fingerprint(fake);
    const run = runGate(fake, control);
    const after = fingerprint(fake);

    ok(before !== after, 'the index moved here too', `${before.slice(0, 12)} -> ${after.slice(0, 12)}`);
    ok(run.status === 0, 'the gate PASSES with the check neutralised', `exit ${run.status}`);
    ok(run.out.includes('GATE PASSED'), 'and it says so');
  }

  console.log('\nthe test does not touch the index of the repository it runs in');
  {
    if (outerEntriesBefore === null) {
      ok(true, 'there is no index to protect', outerWhy);
    } else if (outerEntriesBefore === '') {
      // The index is genuinely empty, so there is nothing in it to damage.
      ok(true, 'the calling index is empty — nothing to protect', outerWhy);
    } else {
      const outerEntriesAfter = spawnSync('git', ['ls-files', '-s'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, GIT_INDEX_FILE: outerIndexFile },
      }).stdout;
      ok(
        outerEntriesBefore === outerEntriesAfter,
        'the calling repository\'s index is exactly as it was',
        outerEntriesBefore === outerEntriesAfter
          ? ''
          : 'the test wrote to the index of the commit that was running it',
      );
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
