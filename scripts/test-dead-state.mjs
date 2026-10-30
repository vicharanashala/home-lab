/**
 * A state variable the app can never change is a state variable the app does
 * not have.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `src/pages/HouseBot.tsx` kept a catalogue of recipe matches that could
 * never hold anything:
 *
 *     const [csvHits, setCsvHits] = useState<CsvHit[]>([]);
 *     ...
 *     setCsvHits([]);          // when a new turn starts
 *     ...
 *     setCsvHits([]);          // when the chat is cleared
 *
 * Both calls pass the SAME value the state was created with, so `csvHits` was
 * `[]` for the whole life of the page. The card it was read by never ran:
 *
 *     {csvHits.map((h) => (
 *       <IndianRecipeCard matches={h.matches} ... />
 *     ))}
 *
 * The commit that removed the catalogue DOWNLOAD — "Stop the House Bot page
 * downloading a catalogue it never reads" — left the state, the card and the
 * type behind. The download was gone and the thing that read it was still
 * there, still rendered from a list that could never have an entry in it.
 *
 * WHY IT WAS NOT CAUGHT
 *
 * The dead-code ratchet reports unused VARIABLES and unused IMPORTS. Every
 * one of these was used:
 *
 *     csvHits          read in the map and in a dependency array
 *     setCsvHits       called, twice
 *     CsvHit           used as the state's type
 *     IndianRecipeCard used in the map
 *
 * So the compiler was quiet, the ratchet was quiet, and the tests were quiet,
 * and the page carried a branch that could not run. The sibling check —
 * `scripts/test-loaded-but-unused.mjs` — watches the other direction, for a
 * value the app LOADS and throws away. This one watches for a value the app
 * SETS and can never change.
 *
 * THE RULE
 *
 * A `useState` whose setter is only ever called with the value it was created
 * with can never hold anything else. So:
 *
 *     const [x, setX] = useState<T>(init);
 *     setX(init);               // every single time
 *
 * means `x` is `init` for ever, and anything that reads it is reading a
 * constant.
 *
 * WHY IT IS PARSED AND NOT MATCHED WITH A PATTERN
 *
 * This check has to tell three things apart, and a pattern cannot:
 *
 *   - a setter that is CALLED:        setHits([])
 *   - a setter that is HANDED OVER:   <Child onHits={setHits} />
 *   - a setter that only appears in a COMMENT
 *
 * The comment case is not a rarity in this repo — the code explains itself at
 * length, and the very sentence that documents this bug names the setter. And
 * an apostrophe in a line of JSX text — `House Bot's window` — is not the
 * start of a string, so a scanner that believes every quote opens one will
 * read half the file as a string and miss the real answer.
 *
 * So the file is handed to the TypeScript compiler and the question is asked
 * of the tree it builds. A comment is not a reference, and a setter that is
 * passed to a child is not a call.
 *
 * WHY IT ONLY REPORTS WHAT IT CAN PROVE
 *
 * A state is left alone when the setter is handed to someone else, or is
 * written from somewhere this scan cannot see. A check that reports what it
 * cannot prove is a check people turn off.
 *
 * Run with:  node scripts/test-dead-state.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

/** Two pieces of code are the same when they are the same characters. */
const same = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** The text of a node, with the spacing normalised. */
const textOf = (node, file) => (node ? node.getText(file).replace(/\s+/g, ' ').trim() : null);

/**
 * Every `useState` in a source file, and what can be said about it.
 *
 * @param source the file's text
 * @param fileName the file's name, for the compiler's diagnostics
 * @returns one entry per `useState` declaration
 */
function statesIn(source, fileName) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const states = [];

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'useState'
    ) {
      const elements = node.name.elements;
      const nameEl = elements[0];
      const setterEl = elements[1];
      // WHY THE NAMES ARE CHECKED BEFORE THEY ARE READ: a binding element can
      // be OMITTED — `const [, second] = ...` — and an omitted element has no
      // name at all. So the name is asked for before it is used.
      if (
        nameEl &&
        setterEl &&
        !ts.isOmittedExpression(nameEl) &&
        !ts.isOmittedExpression(setterEl) &&
        ts.isIdentifier(nameEl.name) &&
        ts.isIdentifier(setterEl.name)
      ) {
        const init = node.initializer.arguments[0] ?? null;
        states.push({
          name: nameEl.name.text,
          setter: setterEl.name.text,
          init: textOf(init, file),
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  // EVERY reference to each setter, and what each one is.
  for (const state of states) {
    const calls = [];
    let handedOver = false;

    const scan = (node) => {
      if (ts.isIdentifier(node) && node.text === state.setter) {
        const parent = node.parent;
        if (!parent) {
          // The root of the file has no parent, and an identifier is never
          // the root. So this cannot happen — and if it did, the identifier
          // would not be a use of anything.
        } else if (ts.isBindingElement(parent) && parent.name === node) {
          // The declaration of the state or its setter — not a use of it.
        } else if (ts.isCallExpression(parent) && parent.expression === node) {
          calls.push(textOf(parent.arguments[0], file));
        } else {
          handedOver = true;
        }
      }
      ts.forEachChild(node, scan);
    };
    scan(file);

    state.calls = calls;
    state.handedOver = handedOver;
  }

  return states;
}

/**
 * The states in a file that can never hold anything but their initial value.
 *
 * @returns one entry per dead state: the variable and where it is
 */
function deadStates(source, fileName) {
  const states = statesIn(source, fileName);
  // Two states in one file with the same setter name would share their call
  // sites, and the answer could not be attributed to one of them. So nothing
  // is claimed about either.
  const setterCounts = new Map();
  for (const state of states) setterCounts.set(state.setter, (setterCounts.get(state.setter) ?? 0) + 1);

  return states
    .filter((state) => {
      if (state.handedOver) return false;
      if ((setterCounts.get(state.setter) ?? 0) > 1) return false;
      if (state.calls.length === 0) return false;
      if (state.init === null) return false;
      return state.calls.every((arg) => same(arg, state.init));
    })
    .map((state) => ({ name: state.name, line: state.line }));
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

console.log('the rule finds a state that can never change when there is one');
console.log('');

{
  // A file with the problem: the state is created empty and is only ever
  // emptied again.
  const DIRTY = `
import { useState } from 'react';
export function Page() {
  const [hits, setHits] = useState<string[]>([]);
  setHits([]);
  return <div>{hits.length}</div>;
}
`;
  const dirty = deadStates(DIRTY, 'Dirty.tsx');
  ok(dirty.length === 1, 'a state that can never change is found', `${dirty.length} found`);
  ok(dirty[0]?.name === 'hits', 'and the variable is named', dirty[0]?.name ?? '(none)');

  // The same file with the state actually changed: nothing to report.
  const CLEAN = `
import { useState } from 'react';
export function Page() {
  const [hits, setHits] = useState<string[]>([]);
  setHits(['one']);
  return <div>{hits.length}</div>;
}
`;
  ok(
    deadStates(CLEAN, 'Clean.tsx').length === 0,
    'a state that does change is not reported',
    `${deadStates(CLEAN, 'Clean.tsx').length} found`,
  );

  // A setter that is handed to someone else is written from somewhere this
  // scan cannot see, so nothing is claimed about it.
  const PASSED_ON = `
import { useState } from 'react';
export function Page() {
  const [hits, setHits] = useState<string[]>([]);
  return <Child onHits={setHits} />;
}
`;
  ok(
    deadStates(PASSED_ON, 'PassedOn.tsx').length === 0,
    'a setter that is passed around is not reported',
    `${deadStates(PASSED_ON, 'PassedOn.tsx').length} found`,
  );

  // A setter that is never called at all: the state may be written from
  // somewhere this scan cannot see, so nothing is claimed about it.
  const NEVER_CALLED = `
import { useState } from 'react';
export function Page() {
  const [hits, setHits] = useState<string[]>([]);
  return <div>{hits.length}</div>;
}
`;
  ok(
    deadStates(NEVER_CALLED, 'NeverCalled.tsx').length === 0,
    'a setter that is never called is not reported',
    `${deadStates(NEVER_CALLED, 'NeverCalled.tsx').length} found`,
  );

  // A setter that is only ever given a DIFFERENT value: alive.
  const DIFFERS = `
import { useState } from 'react';
export function Page() {
  const [open, setOpen] = useState(false);
  setOpen(false);
  setOpen(true);
  return <div>{String(open)}</div>;
}
`;
  ok(
    deadStates(DIFFERS, 'Differs.tsx').length === 0,
    'a state that is given a different value is not reported',
    `${deadStates(DIFFERS, 'Differs.tsx').length} found`,
  );

  // A comment that names the setter must not look like the setter being
  // handed to someone else — and must not hide it either.
  const COMMENTED = `
import { useState } from 'react';
export function Page() {
  // setHits is only ever emptied, so hits is always empty.
  const [hits, setHits] = useState<string[]>([]);
  setHits([]);
  return <div>{hits.length}</div>;
}
`;
  ok(
    deadStates(COMMENTED, 'Commented.tsx').length === 1,
    'a setter named in a comment does not hide the state',
    `${deadStates(COMMENTED, 'Commented.tsx').length} found`,
  );

  // An apostrophe in JSX text is not the start of a string.
  const APOSTROPHE = `
import { useState } from 'react';
export function Page() {
  const [hits, setHits] = useState<string[]>([]);
  setHits([]);
  return <div>House Bot's window</div>;
}
`;
  ok(
    deadStates(APOSTROPHE, 'Apostrophe.tsx').length === 1,
    'an apostrophe in JSX text does not hide the state',
    `${deadStates(APOSTROPHE, 'Apostrophe.tsx').length} found`,
  );

  // A URL in a string holds a `//`.
  const URL = `
import { useState } from 'react';
const SOURCE = 'https://example.com/recipes';
export function Page() {
  const [hits, setHits] = useState<string[]>([]);
  setHits([]);
  return <div>{hits.length}{SOURCE}</div>;
}
`;
  ok(
    deadStates(URL, 'Url.tsx').length === 1,
    'a URL in a string does not hide the state',
    `${deadStates(URL, 'Url.tsx').length} found`,
  );

  // The setter written through an updater function is a real write.
  const UPDATER = `
import { useState } from 'react';
export function Page() {
  const [hits, setHits] = useState<string[]>([]);
  setHits((prev) => prev);
  return <div>{hits.length}</div>;
}
`;
  ok(
    deadStates(UPDATER, 'Updater.tsx').length === 0,
    'a setter given an updater function is not reported',
    `${deadStates(UPDATER, 'Updater.tsx').length} found`,
  );
}

console.log('');
console.log('no page keeps a state it can never change');
console.log('');

const files = walk(srcRoot).sort();
let scanned = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  scanned += 1;
  for (const dead of deadStates(source, file)) {
    ok(
      false,
      `${relative(repoRoot, file)} keeps "${dead.name}", which can never hold anything`,
      `line ${dead.line}`,
    );
  }
}

ok(
  failed === 0,
  'every state in src/ can hold something',
  `${scanned} file(s) scanned`,
);

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
