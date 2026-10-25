/**
 * Regression test for the quality gate's idea of which repository it is about.
 *
 * THE BUG THIS EXISTS FOR
 * The gate had its repository written down as an absolute path:
 *
 *     ROOT="/Users/adhyathmika/homehub"
 *
 * So the gate was always about THAT repository, whatever directory it was
 * run from. A gate run from a copy of the checkout did not check the copy —
 * it changed into the real repository, exported the real repository's index
 * and checked that. The copy was never checked at all.
 *
 * It is not a theory. A gate run from a copy of this checkout that carried a
 * deliberate type error in src/ passed, with "GATE PASSED" at the bottom and
 * the copy's error invisible: the gate had never looked at the copy.
 *
 * WHY THIS MATTERS ENOUGH TO HAVE A TEST
 * The gate is the one thing every agent's commit goes through, and its whole
 * job is to answer a question about a COMMIT. The debugging passes in this
 * repo verify a commit in a temporary copy of the checkout, and a gate that
 * quietly checks a different repository is a gate that says "green" about
 * code it never read. That is the same failure the live check exists to
 * catch: a green repository and a broken one at the same time.
 *
 * The other two scripts in this family already found their own root the same
 * way — scripts/check-live.sh and scripts/build-app.sh — and scripts/build-
 * app.sh carried a hard-coded path until a debugging pass built inside a
 * temporary copy and replaced the owner's live app with a build of the copy.
 *
 * WHAT THE TEST DOES
 * It makes a copy of the checkout with a deliberate type error in it and runs
 * the gate from that copy. The gate has to FAIL, and it has to name the
 * file the error is in — because an error in the copy that the gate cannot
 * see is the bug.
 *
 * WHY THE COPY IS BUILT FROM THE FILES BESIDE THE TEST AND NOT FROM GIT: the
 * quality gate exports the staged index to a temporary directory and runs the
 * tests THERE, and that directory is not a git repository. A test that needed
 * git to build its copy would fail inside the gate, so the copy is made out
 * of the files this test is sitting next to, and the copy is as small as the
 * gate allows: the gate's scripts, one broken source file, and the configs
 * the type check needs. A copy of the whole checkout would be a copy of the
 * dataset too, and the dataset is a hundred megabytes.
 *
 * WHY THE TESTS ARE SKIPPED: the gate's own test suite takes a minute, and
 * this test is about WHICH REPOSITORY the gate checks, not about what the
 * tests say. The type check is what proves the point.
 *
 * Run with:  node scripts/test-gate-root.mjs
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

/** The file the planted type error lives in. The gate has to name it. */
const PROBE = 'gate-root-probe.ts';

const work = join(tmpdir(), `hh-gate-root-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

try {
  console.log('\nthe gate does not carry a hard-coded repository path');
  {
    const source = readFileSync(gatePath, 'utf8');
    // The path to node is hard-coded on purpose — launchd and cron start with
    // a minimal PATH and node is not on it. What must not be hard-coded is
    // the REPOSITORY, which is a fact about the checkout the gate is about.
    const hardCoded = source.match(/^\s*ROOT="\/[^"]*"/m);
    ok(
      !hardCoded,
      'the gate finds its root from its own location',
      hardCoded ? `found: ${hardCoded[0].trim()}` : '',
    );
    ok(
      /BASH_SOURCE/.test(source),
      'the gate reads its own path to find that location',
    );
  }

  console.log('\na gate run from a copy of the checkout checks THAT copy');
  {
    const copy = join(work, 'copy');
    mkdirSync(join(copy, 'src', 'utils'), { recursive: true });

    // The gate under test, and the scripts it sources, as they are now.
    spawnSync('cp', ['-R', join(repoRoot, 'scripts'), join(copy, 'scripts')]);

    // The configs the gate's type check needs. The app's own tsconfig is
    // replaced by one that only covers the probe, so that the copy stays
    // small and the type check stays quick — this test is about WHICH tree
    // is checked, not about what the type rules are.
    copyFileSync(join(repoRoot, 'vite.config.ts'), join(copy, 'vite.config.ts'));
    copyFileSync(join(repoRoot, 'tsconfig.node.json'), join(copy, 'tsconfig.node.json'));
    writeFileSync(
      join(copy, 'tsconfig.json'),
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

    // node_modules is far too big to copy and is the same in both places.
    if (!existsSync(join(copy, 'node_modules'))) {
      symlinkSync(join(repoRoot, 'node_modules'), join(copy, 'node_modules'));
    }

    // The deliberate error. It is in the COPY, and the copy is the only place
    // it exists.
    writeFileSync(
      join(copy, 'src', 'utils', PROBE),
      '// Planted by scripts/test-gate-root.mjs: this file must never be committed.\n' +
        'export const gateRootProbe: number = "not a number";\n',
    );

    const run = spawnSync(
      'bash',
      [join(copy, 'scripts', 'quality-gate.sh')],
      {
        cwd: copy,
        encoding: 'utf8',
        timeout: 600_000,
        env: { ...process.env, HH_SKIP_TESTS: '1' },
      },
    );
    const out = `${run.stdout || ''}${run.stderr || ''}`;

    ok(run.status !== 0, 'the gate FAILS on the copy', `exit ${run.status}`);
    ok(
      out.includes(PROBE),
      'and it names the error it found in the copy',
      out.includes(PROBE) ? '' : "the copy's error was never reported",
    );
    ok(
      !out.includes('GATE PASSED'),
      'the gate does not report a pass while the copy is broken',
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
