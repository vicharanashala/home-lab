/**
 * Regression test: a value the app LOADS must be a value the app USES.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `src/pages/HouseBot.tsx` loaded the whole recipe catalogue and then threw
 * it away:
 *
 *     const [csvRecipes, setCsvRecipes] = useState<CsvRecipe[] | null>(null);
 *     useEffect(() => {
 *       void import('../data/csvRecipes.json').then((mod) => {
 *         if (!cancelled) setCsvRecipes((mod.default || mod) as unknown as CsvRecipe[]);
 *       });
 *     }, []);
 *     ...
 *     void csvRecipes; // suppress unused warning
 *
 * `csvRecipes` was read by exactly one thing, and that thing was a statement
 * whose whole purpose was to stop the compiler asking about it. The value
 * could never reach anything — not the chat, not the cards, not a request.
 *
 * But the LOAD is real, and it is paid on every visit:
 *
 *     the page mounts        -> import('../data/csvRecipes.json')
 *     the browser fetches    -> csvRecipes-<hash>.js
 *     the bridge serves it   -> 5,414,808 bytes, uncompressed
 *
 * 5.16 MiB down the wire for a value that is then discarded, on the page the
 * owner works from. The bundle that carries it was 856 kB gzipped, so the
 * bytes on the wire were six times what they had to be.
 *
 * WHY NOTHING ELSE CAUGHT IT
 *
 * The TypeScript compiler does not report a value that is read by a `void`
 * statement — that is the whole point of the statement. The dead-code ratchet
 * reports unused VARIABLES and unused IMPORTS, and `csvRecipes` was a used
 * variable. So the one check that should have caught a value the app loads
 * and throws away was looking in the one direction that cannot see it.
 *
 * WHAT THE RULE IS
 *
 * `void` has two uses in this codebase and they are not the same thing:
 *
 *     void somePromise();   a call, whose result is thrown away on purpose
 *     void someValue;       a VALUE, thrown away
 *
 * The first is a correct way to say "I am not waiting for this". The second is
 * a value the app has decided not to use. When the value was LOADED — and
 * especially when what was loaded is a multi-megabyte data file — the load is
 * paid in full and gives nothing back.
 *
 * So the rule is: a value that the app loads must be used for something, and
 * a statement that exists only to mark a value as "used" is not a use.
 *
 * Run with:  node scripts/test-loaded-but-unused.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const srcRoot = join(repoRoot, 'src');

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
 * The values a file THROWS AWAY.
 *
 * WHY THE BARE FORM ONLY: `void somePromise();` is a call whose result is
 * discarded on purpose, and it is correct and common. `void someValue;` is a
 * statement whose only job is to tell the compiler that an identifier is
 * "used" so that it will not report it. The second form is a discarded VALUE,
 * and it is the one this test is about.
 *
 * WHY THE `;` IS REQUIRED: it is what tells the two apart. `void drain();`
 * has a `(` where the value form has a `;`, so a call never matches.
 */
function discardedValues(source) {
  const found = [];
  for (const m of source.matchAll(/\bvoid\s+([A-Za-z_$][\w$]*)\s*;/g)) {
    found.push({ name: m[1], index: m.index });
  }
  return found;
}

/**
 * Where the statement that starts at `from` ends, by bracket depth.
 *
 * WHY NOT A LINE COUNT: the statement that carries an import is a call with a
 * callback inside it, and it spans several lines. Counting lines would read
 * the wrong amount of the file.
 */
function statementEnd(source, from) {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (c === ';' && depth === 0) return i;
  }
  return source.length;
}

/**
 * Every dynamic import in a file, with the statement it starts.
 *
 * WHY THE STATEMENT AND NOT JUST THE SPECIFIER: what matters is not that
 * something was imported but that the imported value went somewhere. The
 * statement is where it went.
 */
function dynamicImports(source) {
  const found = [];
  for (const m of source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const end = statementEnd(source, m.index);
    found.push({ spec: m[2], statement: source.slice(m.index, end + 1) });
  }
  return found;
}

/**
 * The setter that gives a state variable its value.
 *
 * WHY A STATE VARIABLE SPECIFICALLY: a discarded CONSTANT costs nothing, and a
 * discarded function costs nothing. The expensive thing is a value that was
 * fetched — and the app fetches into state.
 *
 * @returns the setter's name, or null when the name is not state
 */
function setterFor(source, name) {
  const re = new RegExp(
    `\\bconst\\s*\\[\\s*${name}\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*useState`,
  );
  const m = source.match(re);
  return m ? m[1] : null;
}

/**
 * The loads in a file that the file throws away.
 *
 * @returns one entry per discarded load: the variable and what it loaded
 */
function discardedLoads(source) {
  const problems = [];
  const imports = dynamicImports(source);
  for (const { name } of discardedValues(source)) {
    const setter = setterFor(source, name);
    if (!setter) continue;
    for (const imp of imports) {
      if (imp.statement.includes(`${setter}(`)) {
        problems.push({ name, spec: imp.spec });
        break;
      }
    }
  }
  return problems;
}

/**
 * Every source file under `src/`, as paths relative to the repository root.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!['.ts', '.tsx'].includes(extname(entry.name))) continue;
    out.push(full);
  }
  return out;
}

/**
 * How big the thing that was loaded is, in bytes on disk.
 *
 * WHY IT IS THE SIZE ON DISK AND NOT THE SIZE ON THE WIRE: the wire size
 * depends on how the server compresses, and that is a different question. The
 * size on disk is what the app asked for, and it is the floor.
 */
function bytesOf(file, spec) {
  const abs = resolve(dirname(file), spec);
  try {
    return statSync(abs).size;
  } catch {
    return null;
  }
}

console.log('the rule finds a discarded load when there is one');
console.log('');

{
  // A file with the problem: a catalogue is loaded into state, and the state
  // is marked as used so the compiler will not ask about it.
  const DIRTY = `
import { useState, useEffect } from 'react';
export function Page() {
  const [big, setBig] = useState<unknown[] | null>(null);
  useEffect(() => {
    void import('../data/csvRecipes.json').then((mod) => {
      if (!cancelled) setBig((mod.default || mod) as unknown[]);
    });
  }, []);
  void big; // suppress unused warning
  return null;
}
`;
  const dirty = discardedLoads(DIRTY);
  ok(dirty.length === 1, 'a loaded value that is discarded is found', `${dirty.length} found`);
  ok(dirty[0]?.name === 'big', 'and the variable is named', dirty[0]?.name ?? '(none)');
  ok(
    dirty[0]?.spec === '../data/csvRecipes.json',
    'and the thing it loaded is named',
    dirty[0]?.spec ?? '(none)',
  );

  // The same file with the value actually used: nothing to report.
  const CLEAN = `
import { useState, useEffect } from 'react';
export function Page() {
  const [big, setBig] = useState<unknown[] | null>(null);
  useEffect(() => {
    void import('../data/csvRecipes.json').then((mod) => {
      if (!cancelled) setBig((mod.default || mod) as unknown[]);
    });
  }, []);
  return <div>{big ? big.length : 0}</div>;
}
`;
  ok(
    discardedLoads(CLEAN).length === 0,
    'a loaded value that IS used is not reported',
    `${discardedLoads(CLEAN).length} found`,
  );

  // A discarded PROMISE is not a discarded value. `void fetch('/x');` is a
  // correct way to say "I am not waiting for this", and it must not be
  // mistaken for the thing this test is about.
  const PROMISE = `
export function go() {
  void fetch('/x');
  void ctx.close?.();
}
`;
  ok(
    discardedValues(PROMISE).length === 0,
    'a discarded promise is not a discarded value',
    `${discardedValues(PROMISE).length} found`,
  );
}

console.log('');
console.log('no page loads something it throws away');
console.log('');

const files = walk(srcRoot).sort();
let scanned = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  scanned += 1;
  for (const problem of discardedLoads(source)) {
    const bytes = bytesOf(file, problem.spec);
    const line = source.slice(0, source.indexOf(`void ${problem.name};`)).split('\n').length;
    ok(
      false,
      `${relative(repoRoot, file)} does not load ${problem.spec} and throw it away`,
      `line ${line}, "${problem.name}"` +
        (bytes === null ? '' : `, ${bytes.toLocaleString()} bytes of data`),
    );
  }
}

ok(
  failed === 0,
  'every loaded value in src/ is used for something',
  `${scanned} file(s) scanned`,
);

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
