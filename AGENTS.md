# Agent instructions

## The permanent link

**https://narayana.tailac25b4.ts.net** is the permanent address for this
app. The owner's own words: *"this will be our permanent link."*

- Served by Tailscale Serve (tailnet only) → `http://127.0.0.1:8789`, where
  the bridge runs the API and serves the built SPA from `dist/`.
- The House Bot lives at **https://narayana.tailac25b4.ts.net/house-bot** —
  that is the page the owner works from.
- `http://localhost:8789` and `http://127.0.0.1:8789` also work, but they
  are **different origins**: each keeps its own localStorage, so each holds
  its own grocery list. The ts.net address is the one with the real data.
- The hostname is stable as long as the machine is on the tailnet. Nothing
  about the link depends on a public URL or a tunnel.

## Commit after every change

**After finishing any change to this app — a feature, a bug fix, a UI tweak,
a config change, anything — commit it immediately. Do not wait to be asked.**

Then tell the user in plain terms: *code has been committed ✅*

### Why

This is a standing preference from the project owner. Commits are cheap and
local (no login required), while pushing to GitHub needs authentication the
agent cannot do on its own. Waiting to be asked to commit means work sits
uncommitted and gets lost or forgotten.

### How

```bash
cd /Users/adhyathmika/homehub
git add -A
git commit -m "<clear description of what changed and why>"
```

- Write a real commit message — what changed and why, not "updates".
- **Never commit secrets.** `.gitignore` covers `.env*`, `tunnel/`, `plists/`,
  `dist/`, `node_modules/`. Before committing, confirm only `.env.example`
  files are tracked among env files.
- If unrelated files are staged by accident, unstage them rather than
  sweeping them into the commit.
- Commits only. Never push unless the user explicitly asks — pushing requires
  `gh auth login`, which the agent cannot perform.

### Verify before committing

The user values correctness over speed and has been burned by claims that
were not checked. For a UI or behavioural change:

1. `npx tsc --noEmit` — must be clean
2. `npm run build` — must succeed
3. Drive the real app in headless Chrome and confirm the change works

A static type-check is not evidence the feature works. State what was
actually verified versus what was assumed.

## The quality gate — how code gets checked

`scripts/quality-gate.sh` runs on **every commit**, for **every agent**, via
`.githooks/pre-commit` (tracked in git — the repo is configured with
`git config core.hooksPath .githooks`).

It checks the **staged commit, not the working tree**. That matters here:
several agents work in this repo at once, and a tree-wide check would fail
other people's half-finished work and make the gate look broken at random.
The gate answers one precise question — *does the commit I am about to make
type-check, pass its tests and contain no secrets?*

The gate blocks a commit when:

- `src/` or `vite.config.ts` has a type error
- the commit adds dead code (an unused variable or import)
- a test in `scripts/test-*.mjs` fails
- a value from `.env` or `.env.production` appears in the diff
- the commit adds `@ts-ignore`, `@ts-expect-error` or `eslint-disable`
- the commit adds `any`
- the commit adds `dist/`, `node_modules/`, logs or tsbuildinfo

Dead code is a **ratchet**: 55 unused-variable errors already exist in the
repo. They are recorded in `scripts/quality-baseline.txt`, and the gate fails
only when that set *grows*. Removing one is always allowed. After removing
some, run `npm run check:baseline` to shrink the baseline.

Escape hatches — used sparingly, and explained in the commit message:
`HH_ALLOW_ANY=1`, `HH_ALLOW_SUPPRESSIONS=1`, `HH_SKIP_TESTS=1`.

### What "proper code" means here

The gate is the floor, not the ceiling. The bar for code in this repo:

- **Explain why, not what.** A comment earns its place by naming the
  constraint, the trap, or the reason the obvious version was wrong.
  `// increment counter` is noise. The existing modules are the reference:
  `src/utils/spokenRecipeMatch.ts` explains the catalogue's noise and the
  scoring tiers; `src/utils/fasting.ts` explains why rules match on names
  rather than categories.
- **No silent failure.** If an operation can fail, the user must be able to
  tell. A toast that says "logged ✓" when nothing was written is a bug, not
  a style issue.
- **Prove the bug existed.** When fixing a bug, write or run a check that
  fails before the fix and passes after it. A fix with no reproduction is a
  guess. "All checks pass on the fixed code, 5 fail on the original" is the
  standard to copy.
- **Name things after what they are.** `byId`, `core`, `nearMiss` — a reader
  should not have to open the file to know what a variable holds.
- **Match the house style.** Strict TypeScript, no `any`, no unchecked
  casts, single quotes, 2-space indent, trailing commas in multiline
  literals.
- **Leave the code cleaner than you found it.** If you touch a file, do not
  leave new dead code in it. The ratchet will hold you to that.
- **Never widen your scope.** Fix the defect you were given. If you notice
  something else, report it — do not quietly expand the diff.

## Working in parallel

Several agents work in this repo at once.

- **Claim your files.** Name the exact files you will edit in your task
  brief before you start. Do not edit a file another agent has claimed.
- **Never edit another agent's file** to fix something you noticed on the
  way past. Report it instead.
- **One writer per file.** If two agents must touch a file, one writes and
  the other waits.
- **Do not revert or rewrite someone else's in-flight work**, even if it
  looks wrong. Say so in your report and leave the file alone.

## The 24/7 debugger

A dedicated agent, `homehub-debugger`, runs on a schedule and keeps the app
honest between turns. It is not a substitute for thinking — it is the thing
that catches what falls through the cracks.

On each pass it:

- type-checks, builds and runs the test suite
- checks that the bridge and the ts.net link actually respond
- reviews the diff since the last pass for swallowed errors, false success
  messages, secrets, dead code and regressions
- fixes what it can *prove* is broken, and commits the fix under the rule
  above
- reports plainly anything it could not fix, and what it did not check

What it will not do:

- rewrite an agent's work-in-progress — a file changed in the last few
  minutes is assumed to be in flight and is left alone
- commit code it has not actually verified
- claim something works when it only established that it compiles
- commit a failing test as a way to make a failure disappear
