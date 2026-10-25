/**
 * Regression test: the repository's source files must be plain text.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `bridge/shift /index.mjs` held a regex whose character class was written
 * with RAW control bytes instead of escape sequences:
 *
 *     v.replace(/[<NUL>-<US><DEL>]/g, '')
 *
 * The bytes and the escapes mean exactly the same thing to the regex, so the
 * code behaved correctly for as long as it was there. What it also did was
 * make the file BINARY to every text tool that reads it. ripgrep stops
 * searching a file the moment it finds a NUL byte and reports "binary file
 * matches" — which reads like a successful search:
 *
 *     before   a search for "app.get('/healthz'" in the bridge
 *              -> "No matches found"     (it is there, at line 4335)
 *
 * and the file stopped being searched from the NUL onwards — 1726 lines, 39%
 * of the bridge, including every route registered after that point and the
 * token handling around it. A search that returns "no matches" for a string
 * that IS in the file is a false all-clear: it says the code is not there
 * when it is, and it is not the kind of wrong that announces itself.
 *
 * WHY A TEST AND NOT A NOTE: the byte was committed with the file and nothing
 * in the repository said so. Every rule this codebase has learned the hard
 * way now has a test, and this is that rule: a source file that a text tool
 * cannot read is a source file nobody can search.
 *
 * WHAT THE RULE IS
 *
 * A file may contain a raw control byte ONLY if it is a real binary asset —
 * a PNG, a font, an audio file. Everything else is text, and text has no
 * business carrying a byte that makes a tool stop reading it.
 *
 * The binary types are an ALLOWLIST rather than a text-type list, so a file
 * in a format nobody has thought of yet is checked as text until it is
 * deliberately exempted. A new binary asset fails this test loudly, which is
 * the point: the decision to exempt it should be a decision.
 *
 * Run with:  node scripts/test-source-files-are-text.mjs
 */
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

/**
 * File types that are genuinely binary and are allowed to hold control bytes.
 *
 * WHY THE EXTENSION IS LOWERCASED: a macOS filesystem is case-insensitive and
 * a file can arrive as `.PNG`, so the check must not depend on how it is
 * spelled. `.DS_Store` is here for the same reason it exists: it is a binary
 * file Finder writes into every directory, and it has no extension at all.
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.icns',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac',
  '.mp4', '.mov', '.webm', '.mkv',
  '.pdf', '.zip', '.gz', '.br', '.bz2', '.xz', '.7z', '.wasm', '.bin',
  '.ds_store',
]);

/**
 * Directories that are never source: build output, dependencies, and the
 * places where secrets live.
 *
 * WHY `dist` IS MATCHED BY PREFIX: the build writes `dist.staging` and
 * `dist.retired` alongside `dist`, and a rule that skipped only one of the
 * three would go looking inside a build that is being rewritten.
 *
 * WHY `.env` IS SKIPPED: this test is about whether a file can be READ, not
 * about what is in it. Reading a secrets file to check its bytes gives the
 * test no new information and the file no less reason to be protected.
 */
const SKIPPED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'coverage', '.vite', 'plists', 'tunnel', '.mavis',
]);

/** Files that are build output or secrets, whatever they are called. */
function isSkippedFile(name) {
  if (name.endsWith('.tsbuildinfo')) return true;
  if (name === '.DS_Store') return true;
  // .env, .env.production, .env.local — but NOT .env.example, which is
  // committed on purpose and is exactly as readable as any other text file.
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return true;
  return false;
}

/** The extension used for the binary check, or '' when there is none. */
function binaryKindOf(name) {
  // A dotfile with no other dot in it (".gitignore", ".DS_Store") is its own
  // kind: splitting it on the dot would report ".ds_store" as an extension,
  // which is not what anyone means by an extension.
  if (name.startsWith('.') && !name.slice(1).includes('.')) return name.toLowerCase();
  return extname(name).toLowerCase();
}

/**
 * The raw control bytes in a buffer, with the offset of each.
 *
 * WHY THESE BYTES AND NOT OTHERS: a tab, a newline and a carriage return are
 * ordinary text. Everything else below 0x20 is a control byte, and 0x7f
 * (DEL) is one too — it is the byte a terminal prints as nothing at all,
 * which is what makes it the dangerous one.
 */
function controlBytesIn(buffer) {
  const found = [];
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20 || b === 0x7f) found.push({ offset: i, byte: b });
  }
  return found;
}

/** Every file under `dir`, as paths relative to it. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (entry.name.startsWith('dist')) continue;
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSkippedFile(entry.name)) continue;
    out.push(full);
  }
  return out;
}

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

console.log('the rule finds a control byte when there is one');
console.log('');

// A fixture, so the rule is proved against a file that HAS the problem. A
// test that only ever runs against clean files cannot show that it would
// have caught the dirty one.
{
  const dir = mkdtempSync(join(tmpdir(), 'hh-text-check-'));
  try {
    const dirty = join(dir, 'dirty.mjs');
    writeFileSync(dirty, Buffer.from('const a = 1;\nconst b = 2;\nconst c = "x' + String.fromCharCode(0) + '";\n'));
    const found = controlBytesIn(readFileSync(dirty));
    ok(found.length === 1, 'a file with a raw NUL is reported', `${found.length} byte(s) found`);
    ok(found.length === 1 && found[0].byte === 0, 'and the byte is identified as a NUL');

    const clean = join(dir, 'clean.mjs');
    writeFileSync(clean, 'const a = 1;\n\ttab and newline are fine\n');
    ok(controlBytesIn(readFileSync(clean)).length === 0, 'a file with tabs and newlines is not reported');

    const escapes = join(dir, 'escapes.mjs');
    writeFileSync(escapes, "const re = /[\\x00-\\x1f\\x7f]/g;\n");
    ok(controlBytesIn(readFileSync(escapes)).length === 0, 'a regex written with escapes is not reported');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('');
console.log('the repository is text');
console.log('');

const offenders = [];
let scanned = 0;

for (const file of walk(repoRoot)) {
  const kind = binaryKindOf(basename(file));
  if (BINARY_EXTENSIONS.has(kind)) continue;
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    continue;
  }
  scanned += 1;
  const found = controlBytesIn(buffer);
  if (found.length > 0) {
    const first = found[0];
    const line = buffer.subarray(0, first.offset).toString('utf8').split('\n').length;
    offenders.push({
      path: relative(repoRoot, file),
      count: found.length,
      line,
      byte: first.byte,
    });
  }
}

for (const o of offenders) {
  ok(
    false,
    `${o.path} is readable as text`,
    `${o.count} control byte(s), first at line ${o.line} (0x${o.byte.toString(16).padStart(2, '0')})`,
  );
}

ok(
  offenders.length === 0,
  'every source file can be searched from end to end',
  `${scanned} file(s) scanned, ${offenders.length} with a control byte`,
);

// The file that broke is worth naming, so that a regression points at the
// thing that regressed rather than at the rule.
const bridge = join(repoRoot, 'bridge', 'shift ', 'index.mjs');
if (statSync(bridge, { throwIfNoEntry: false })) {
  ok(
    controlBytesIn(readFileSync(bridge)).length === 0,
    'the bridge can be searched from end to end',
  );
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
