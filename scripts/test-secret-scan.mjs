/**
 * Regression test for the quality gate's secret scanner.
 *
 * THE BUG THIS EXISTS FOR
 * The scan used to be written as
 *
 *     if printf '%s' "$DIFF_BLOB" | grep -qF -- "$value"; then
 *
 * and it failed open. `grep -q` stops reading at the first match, so the
 * writer is killed with SIGPIPE. The gate runs under `set -o pipefail`, so
 * the pipeline's status became 141 (the writer's death) instead of grep's
 * 0, the `if` read "not found", and a diff containing the secret was
 * reported as clean.
 *
 * It only bites when the diff is bigger than the pipe buffer AND the
 * secret is not at the very end — which is exactly the case that matters:
 * a large commit is where a pasted key is most likely to be hiding.
 *
 * Run with:  node scripts/test-secret-scan.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, 'lib', 'secret-scan.sh');

const SECRET = 'SYNTHETIC_SECRET_VALUE_abcdef123456';

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
 * Run the scan and report what it found.
 *
 * The scan is bash, so it runs through bash. `set -o pipefail` is set
 * here exactly as the gate sets it — the bug only exists under pipefail,
 * and a test that dropped it would pass against the broken scan.
 */
function scan(diffBody, envBody) {
  const dir = mkdtempSync(join(tmpdir(), 'hh-secret-scan-'));
  try {
    const diffFile = join(dir, 'diff.txt');
    const envFile = join(dir, 'test.env');
    writeFileSync(diffFile, diffBody);
    writeFileSync(envFile, envBody);
    const script =
      `set -uo pipefail\nsource ${JSON.stringify(lib)}\n` +
      `leak_scan ${JSON.stringify(diffFile)} ${JSON.stringify(envFile)}`;
    let out = '';
    let code = 0;
    try {
      out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
    } catch (err) {
      // A non-zero exit is the normal "something leaked" answer.
      out = err.stdout || '';
      code = err.status;
    }
    return { out, code };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Filler big enough to overrun the pipe buffer (64 KB on macOS). */
const FILLER = 'diff --git a/src/file.ts b/src/file.ts\n+some line of code\n'.repeat(
  4000,
);

console.log('\na secret in the middle of a large diff');
{
  const body = FILLER + `+const token = "${SECRET}";\n` + FILLER;
  const { out, code } = scan(body, `LEAKPROBE=${SECRET}\n`);
  ok(code === 1, 'the scan reports a leak', `exit ${code}`);
  ok(out.includes('LEAKPROBE'), 'the leaked key is named', out.trim() || '(no output)');
}

console.log('\na secret at the very end of a large diff');
{
  const body = FILLER + `+const token = "${SECRET}";\n`;
  const { out, code } = scan(body, `LEAKPROBE=${SECRET}\n`);
  ok(code === 1, 'the scan reports a leak', `exit ${code}`);
  ok(out.includes('LEAKPROBE'), 'the leaked key is named', out.trim() || '(no output)');
}

console.log('\na secret at the very start of a large diff');
{
  const body = `+const token = "${SECRET}";\n` + FILLER;
  const { out, code } = scan(body, `LEAKPROBE=${SECRET}\n`);
  ok(code === 1, 'the scan reports a leak', `exit ${code}`);
  ok(out.includes('LEAKPROBE'), 'the leaked key is named', out.trim() || '(no output)');
}

console.log('\na diff with no secret');
{
  const { out, code } = scan(FILLER, `LEAKPROBE=${SECRET}\n`);
  ok(code === 0, 'the scan reports nothing', `exit ${code}`);
  ok(out.trim() === '', 'nothing is printed', out.trim() || '(empty)');
}

console.log('\nplaceholder and short values are not secrets');
{
  const body = `+const a = "changeme-me";\n+const b = "short";\n`;
  const { code } = scan(body, 'A=changeme-me\nB=short\n');
  ok(code === 0, 'placeholders and short values are ignored', `exit ${code}`);
}

console.log('\nseveral env files');
{
  const body = FILLER + `+const token = "${SECRET}";\n` + FILLER;
  const dir = mkdtempSync(join(tmpdir(), 'hh-secret-scan-'));
  try {
    const diffFile = join(dir, 'diff.txt');
    const envA = join(dir, 'a.env');
    const envB = join(dir, 'b.env');
    writeFileSync(diffFile, body);
    writeFileSync(envA, 'UNRELATED=some_other_value_xyz\n');
    writeFileSync(envB, `LEAKPROBE=${SECRET}\n`);
    const script =
      `set -uo pipefail\nsource ${JSON.stringify(lib)}\n` +
      `leak_scan ${JSON.stringify(diffFile)} ${JSON.stringify(envA)} ${JSON.stringify(envB)}`;
    let code = 0;
    let out = '';
    try {
      out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
    } catch (err) {
      out = err.stdout || '';
      code = err.status;
    }
    ok(code === 1, 'the scan reports a leak', `exit ${code}`);
    ok(out.includes('LEAKPROBE'), 'the leaked key is named', out.trim() || '(no output)');
    ok(!out.includes('UNRELATED'), 'the unrelated key is not named');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
