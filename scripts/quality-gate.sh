#!/bin/bash
# HomeHub quality gate — the mechanical floor every agent's code must clear.
#
# WHY THIS EXISTS
# AGENTS.md asks agents to write careful code, but a written rule only binds the
# agent that happens to read it. A hook runs on every commit, from every agent,
# with no memory of who is asking and no desire to be polite about it. This is
# the enforcement point for "proper code".
#
# WHAT IT CHECKS
#   1. Type check      — src/ and the vite config, both strict
#   2. Dead code       — a RATCHET, see the note below
#   3. Tests           — every scripts/test-*.mjs
#   4. Secrets         — real .env values must never reach a commit
#   5. Suppressions    — no new @ts-ignore / eslint-disable
#   6. New `any`       — no new escape hatches from the type system
#   7. Junk files      — no dist/, node_modules/, logs, tsbuildinfo
#
# WHY IT CHECKS THE INDEX, NOT THE WORKING TREE
# Several agents work in this repo at once. `tsc` sees the working tree, so a
# tree check would fail other people's in-flight work and make the gate look
# broken at random. This script exports the staged index to a temp directory
# and checks THAT, so it answers one precise question: "does the commit I am
# about to make typecheck, pass its tests and contain no secrets?" — regardless
# of what anyone else has going on.
#
# THE RATCHET
# Turning on noUnusedLocals/noUnusedParameters today reports 55 pre-existing
# errors across the repo. Blanking that out in one sweep is not this script's
# job and would block every agent on day one. Instead the known set is recorded
# in scripts/quality-baseline.txt and the gate fails only when the set GROWS.
# Fixing one is always allowed and shrinks the baseline.
#
# ESCAPE HATCHES (use sparingly, explain why in the commit message)
#   HH_ALLOW_ANY=1           permit new `any` in this commit
#   HH_ALLOW_SUPPRESSIONS=1  permit new ts-ignore/eslint-disable
#   HH_SKIP_TESTS=1          skip the test suite
#
# USAGE
#   scripts/quality-gate.sh                  check the staged index
#   scripts/quality-gate.sh --update-baseline  rewrite the dead-code baseline
#
set -uo pipefail

# The repository this copy of the gate belongs to, found from the script's
# own place rather than written down as an absolute path.
#
# WHY: the gate answers one question — "does the commit I am about to make
# type-check, pass its tests and contain no secrets?" — and it answers it
# about a REPOSITORY. With the path written down, a gate run from a COPY of
# the checkout checked the wrong one: it changed into the real repository,
# exported the real repository's index and checked THAT, so the copy was
# never checked at all.
#
# It is not a theory. A gate run from a copy of this checkout that carried a
# deliberate type error passed — the copy's error was invisible, because the
# gate had never looked at the copy.
#
# WHY THE OTHER SCRIPTS DO IT THIS WAY: scripts/check-live.sh and
# scripts/build-app.sh found their own root the same way, for the same
# reason. scripts/build-app.sh carried a hard-coded path until a debugging
# pass built inside a temporary copy and replaced the owner's live app with
# a build of the copy — the swap is atomic, so every check stayed green and
# nothing said the app had been replaced under the owner.
#
# WHY IT IS SAFE FOR THE ORDINARY GATE: the pre-commit hook resolves the
# repository with `git rev-parse --show-toplevel` and runs
# "$ROOT/scripts/quality-gate.sh", so the script sits in the repository it
# is about and the two roots are the same directory — exactly as before.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"

# WHY THIS CHECKS INSTEAD OF TRUSTING THE RESOLUTION: `cd ""` SUCCEEDS in
# bash and changes nothing, so an empty ROOT would leave the gate in whatever
# directory it happened to be started in — which is the very bug this change
# exists to remove, wearing a different hat. A gate that cannot say which
# repository it is about has to stop, not guess.
if [ -z "$ROOT" ] || [ ! -d "$ROOT/scripts" ]; then
  echo "quality gate: cannot find the repository root from $0 — refusing to check the wrong one" >&2
  exit 1
fi

BASELINE="$ROOT/scripts/quality-baseline.txt"

# launchd and cron both start with a minimal PATH; node lives in a user-local
# directory, so without this every check below fails with "command not found".
export PATH="/Users/adhyathmika/local/node-v24.16.0-darwin-arm64/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$ROOT" || exit 1

UPDATE_BASELINE=0
[ "${1:-}" = "--update-baseline" ] && UPDATE_BASELINE=1

FAILED=0
WARNED=0

say()  { printf '%s\n' "$*"; }
step() { printf '\n── %s\n' "$*"; }
bad()  { printf '   ✗ %s\n' "$*"; FAILED=1; }
warn() { printf '   ! %s\n' "$*"; WARNED=1; }

# A fingerprint of the index as it stands right now.
#
# WHY THE GATE FINGERPRINTS THE INDEX AT ALL: the gate exports the index ONCE
# and checks that export. The checks take a minute or two, and in that window
# another agent can change the index — `git stash` is the one that bites,
# because it takes a staged change out of the index and puts it back on the
# worktree. The commit is then made from the index as it stands at the END,
# not from the one that was checked, so the gate can say "GATE PASSED" about
# code it never tested.
#
# It is not a theory. On 2026-10-25 commit 195e14b landed carrying a test that
# was RED against the code shipped beside it: the fix had been staged, the gate
# checked the fix and the test together and passed, and a `git stash` from
# another agent took the fix out of the index in the middle. The commit held
# the proof and not the thing it proved.
#
# WHY `git ls-files -s` AND NOT `git write-tree`: write-tree writes tree
# objects into the repository as a side effect of asking. ls-files only reads,
# and it reports every entry with its stage and its blob hash, so two indexes
# with the same fingerprint hold exactly the same thing.
#
# WHY IT REPORTS FAILURE RATHER THAN HASHING NOTHING: `shasum` is happy to
# hash an empty stream, so a git that failed would produce a fingerprint that
# looks like a real one — the hash of nothing. An index that could not be
# read is not an index that held still, and the two must not look alike.
index_fingerprint() {
  local entries
  entries="$(git ls-files -s 2>/dev/null)" || return 1
  printf '%s' "$entries" | shasum | cut -d' ' -f1
}

# Lines the commit adds, minus the diff header lines. Used by every
# "did this commit introduce something bad" check.
#
# This is awk rather than grep for a reason that cost a day once: on macOS,
# `grep -v '^\+\+\+'` treats \+ as the GNU "one or more" operator, so the
# pattern is invalid and grep EXITS WITH AN ERROR while passing nothing
# through. Every diff-based check then saw an empty input and reported success
# — a gate that fails open. awk has no such ambiguity, and the sanity check
# below makes the whole thing fail closed if the extraction ever breaks again.
DIFF_CACHED="$(git diff --cached --unified=0 --no-color)"

# Added lines, tagged with the file they came from. The tag matters: the code
# checks below apply to APPLICATION SOURCE only. Without it the gate flags
# itself — this file contains the literal text "@ts-ignore" and "as any"
# because it searches for them, so committing the gate tripped its own check.
# Tooling, docs and config are not application code and are not held to the
# rules about types and suppressions.
ADDED_WITH_PATH="$(printf '%s\n' "$DIFF_CACHED" \
  | awk '/^\+\+\+ b\// { path = substr($0, 7); next }
         /^\+/ && !/^\+\+\+/ { print path "\t" substr($0, 2) }')"

SOURCE_RE='^(src|bridge|server)/'

# Every added line, all files.
added_lines() { printf '%s\n' "$ADDED_WITH_PATH" | cut -f2-; }

# Every added line, application source only.
source_lines() { printf '%s\n' "$ADDED_WITH_PATH" | grep -E "$SOURCE_RE" | cut -f2-; }

# ─────────────────────────────────────────────────────────────────────────────
# Export the staged index so we check the commit, not the mess around it.
# ─────────────────────────────────────────────────────────────────────────────

# The index, as it stands BEFORE the export.
#
# WHY IT IS TAKEN BEFORE THE EXPORT AND NOT AFTER: the export is what gets
# checked, so the fingerprint has to describe the index as it was when the
# export was taken. Taken after, an index that changed between the two would
# describe the NEW index while the export held the OLD one, and the check at
# the end would pass about code it never read — the same false all-clear this
# fingerprint exists to end.
INDEX_FINGERPRINT_BEFORE="$(index_fingerprint)"

WORK="$(mktemp -d /tmp/hh-gate.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

if git checkout-index --all --prefix="$WORK/" 2>/dev/null && [ -d "$WORK" ]; then
  ln -s "$ROOT/node_modules" "$WORK/node_modules" 2>/dev/null
  CHECK_DIR="$WORK"
  say "checking staged index (exported to $WORK)"
else
  # Falling back to the working tree is worse but far better than not checking.
  CHECK_DIR="$ROOT"
  say "WARNING: could not export the staged index; checking the working tree instead"
fi

cd "$CHECK_DIR" || exit 1

# Fail closed: the number of extracted added lines must match the number of
# '+' lines in the diff exactly, minus the file headers. If the extraction is
# ever wrong, every diff check below would be a false green, so treat a
# mismatch as a hard failure rather than carrying on silently.
HEADER_COUNT="$(printf '%s\n' "$DIFF_CACHED" | grep -cE '^\+\+\+ ' || true)"
PLUS_COUNT="$(printf '%s\n' "$DIFF_CACHED" | grep -cE '^\+' || true)"
ADDED_COUNT="$(printf '%s\n' "$ADDED_WITH_PATH" | grep -c . || true)"
EXPECTED_ADDED=$((PLUS_COUNT - HEADER_COUNT))

if [ "$EXPECTED_ADDED" -ne "$ADDED_COUNT" ]; then
  bad "could not read the staged diff ($EXPECTED_ADDED added lines expected, $ADDED_COUNT extracted)"
  say "     the diff checks are disabled until this is fixed"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. Type check
# ─────────────────────────────────────────────────────────────────────────────
step "type check"

# One pass, two answers: the strict type errors AND the dead-code list.
# Running tsc twice cost another 15 seconds on every commit for no reason —
# the dead-code errors are simply the TS6133/TS6196 subset of the same run.
TS_OUT="$(npx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1)"
TS_ERRORS="$(printf '%s\n' "$TS_OUT" | grep -E 'error TS' | grep -vE 'error TS(6133|6196)')"
DEAD_NOW="$(printf '%s\n' "$TS_OUT" | grep -E 'error TS(6133|6196)' \
  | sed -E 's/^([^(]+)\([0-9]+,[0-9]+\): error (TS[0-9]+): /\1 \2 /' \
  | sort -u)"

if [ -z "$TS_ERRORS" ]; then
  say "   ✓ src/ type-checks clean"
else
  bad "src/ has type errors:"
  printf '%s\n' "$TS_ERRORS" | head -20 | sed 's/^/     /'
fi

NODE_OUT="$(npx tsc -p tsconfig.node.json --noEmit 2>&1)"
if [ $? -eq 0 ]; then
  say "   ✓ vite.config.ts type-checks clean"
else
  bad "vite.config.ts has type errors:"
  printf '%s\n' "$NODE_OUT" | grep -E 'error TS' | head -10 | sed 's/^/     /'
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Dead-code ratchet
# ─────────────────────────────────────────────────────────────────────────────
step "dead code (ratchet)"

if [ "$UPDATE_BASELINE" -eq 1 ]; then
  printf '%s\n' "$DEAD_NOW" > "$BASELINE"
  say "   ✓ baseline rewritten ($(printf '%s\n' "$DEAD_NOW" | grep -c . ) known issues)"
elif [ ! -f "$BASELINE" ]; then
  printf '%s\n' "$DEAD_NOW" > "$BASELINE"
  say "   ✓ baseline created ($(printf '%s\n' "$DEAD_NOW" | grep -c . ) known issues)"
else
  NEW_DEAD="$(comm -23 <(printf '%s\n' "$DEAD_NOW") <(sort -u "$BASELINE"))"
  FIXED_DEAD="$(comm -13 <(printf '%s\n' "$DEAD_NOW") <(sort -u "$BASELINE"))"

  if [ -n "$NEW_DEAD" ]; then
    bad "this commit adds dead code (unused variable/import):"
    printf '%s\n' "$NEW_DEAD" | sed 's/^/     /'
    say "     remove it, or delete the unused binding"
  else
    say "   ✓ no new dead code"
  fi

  if [ -n "$FIXED_DEAD" ]; then
    say "   ✓ you removed $(printf '%s\n' "$FIXED_DEAD" | grep -c . ) known issue(s)"
    say "     run 'npm run check:baseline' to shrink the baseline"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Tests
# ─────────────────────────────────────────────────────────────────────────────
step "tests"

if [ "${HH_SKIP_TESTS:-0}" = "1" ]; then
  warn "tests skipped via HH_SKIP_TESTS=1"
else
  TEST_COUNT=0
  for t in scripts/test-*.mjs; do
    [ -e "$t" ] || continue
    TEST_COUNT=$((TEST_COUNT + 1))
    T_OUT="$(node "$t" 2>&1)"
    if [ $? -eq 0 ]; then
      say "   ✓ $(basename "$t")"
    else
      bad "$(basename "$t") failed:"
      printf '%s\n' "$T_OUT" | tail -15 | sed 's/^/     /'
    fi
  done
  [ "$TEST_COUNT" -eq 0 ] && say "   · no test scripts found"
fi

cd "$ROOT" || exit 1

# ─────────────────────────────────────────────────────────────────────────────
# 4. Secrets
# ─────────────────────────────────────────────────────────────────────────────
step "secrets"

TRACKED_ENV="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$')"
if [ -n "$TRACKED_ENV" ]; then
  bad "these real env files are tracked by git:"
  printf '%s\n' "$TRACKED_ENV" | sed 's/^/     /'
fi

DIFF_BLOB="$(git diff --cached --no-color)"
LEAKED=""
# The scan itself lives in scripts/lib/secret-scan.sh so that it can be
# tested on its own — the gate runs against the real repository's index, so
# a bug in the scan cannot be shown by running the gate. It is sourced from
# the exported index when it is there, because everything else in this gate
# is checked against the staged commit rather than the working tree.
if [ -f "$CHECK_DIR/scripts/lib/secret-scan.sh" ]; then
  . "$CHECK_DIR/scripts/lib/secret-scan.sh"
else
  . "$ROOT/scripts/lib/secret-scan.sh"
fi

# The scan reads the diff from a file rather than from a pipe. Piping it
# into `grep -q` fails open: grep stops at the first match, the writer dies
# of SIGPIPE, and under `set -o pipefail` the pipeline reports "not found"
# for a diff that plainly contains the secret. See scripts/lib/secret-scan.sh.
DIFF_FILE="$WORK/gate-diff.txt"
printf '%s' "$DIFF_BLOB" > "$DIFF_FILE"

# HH_ENV_FILES lets the scan be tested against a synthetic secret instead of
# the real one. The default is the real env files.
ENV_FILES="${HH_ENV_FILES:-.env .env.production}"
LEAKED="$(leak_scan "$DIFF_FILE" $ENV_FILES)"

if [ -n "$LEAKED" ]; then
  bad "this commit contains secret values from .env:"
  printf '%s\n' "$LEAKED"
else
  say "   ✓ no .env values in this commit"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. New suppressions
# ─────────────────────────────────────────────────────────────────────────────
step "suppressions"

if [ "${HH_ALLOW_SUPPRESSIONS:-0}" = "1" ]; then
  warn "suppression check skipped via HH_ALLOW_SUPPRESSIONS=1"
else
  SUPPRESSIONS="$(source_lines | grep -E '@ts-ignore|@ts-expect-error|eslint-disable' | head -10)"
  if [ -n "$SUPPRESSIONS" ]; then
    bad "this commit adds a type/lint suppression:"
    printf '%s\n' "$SUPPRESSIONS" | sed 's/^/     /'
    say "     fix the underlying type error instead"
  else
    say "   ✓ no new suppressions"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. New `any`
# ─────────────────────────────────────────────────────────────────────────────
step "type escape hatches"

if [ "${HH_ALLOW_ANY:-0}" = "1" ]; then
  warn "any check skipped via HH_ALLOW_ANY=1"
else
  ANY_ADDED="$(source_lines | grep -E ':[[:space:]]*any([^A-Za-z0-9_]|$)|as[[:space:]]+any([^A-Za-z0-9_]|$)|<any>|any\[\]' | head -10)"
  if [ -n "$ANY_ADDED" ]; then
    bad "this commit adds \`any\`:"
    printf '%s\n' "$ANY_ADDED" | sed 's/^/     /'
    say "     use a real type, or narrow the value with a guard"
  else
    say "   ✓ no new \`any\`"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. Junk files
# ─────────────────────────────────────────────────────────────────────────────
step "junk files"

JUNK="$(git diff --cached --name-only --diff-filter=A \
  | grep -E '(^|/)(dist|dist\.[^/]*|node_modules)/|\.tsbuildinfo$|\.log$|(^|/)\.env($|\.)' | head -10)"
if [ -n "$JUNK" ]; then
  bad "this commit adds files that should never be tracked:"
  printf '%s\n' "$JUNK" | sed 's/^/     /'
else
  say "   ✓ no build output or env files added"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. Leftover debug logging (advisory only)
# ─────────────────────────────────────────────────────────────────────────────
step "debug logging (advisory)"

NOISY="$(source_lines | grep -E 'console[.](log|debug)[(]' | head -5)"
if [ -n "$NOISY" ]; then
  warn "this commit adds console logging:"
  printf '%s\n' "$NOISY" | sed 's/^/     /'
  say "     remove it, or route it through the bridge's logger"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. The index must not have moved while the gate was checking it
# ─────────────────────────────────────────────────────────────────────────────
step "the index"

# WHY THIS IS CHECKED LAST: it is the one check that can invalidate every
# check above it. If the index moved while they ran, they were answers about
# code that is no longer the code about to be committed — so the commit is
# refused rather than made on the strength of them.
#
# WHY IT FAILS THE COMMIT RATHER THAN WARNING: a warning here would be a
# false all-clear with a footnote. The gate's whole promise is that the
# commit it passes is the commit it checked.
INDEX_FINGERPRINT_AFTER="$(index_fingerprint)"

if [ -z "$INDEX_FINGERPRINT_BEFORE" ] || [ -z "$INDEX_FINGERPRINT_AFTER" ]; then
  # Not a git repository, or an index git will not describe. There is nothing
  # to compare, and refusing every commit would be worse than not checking.
  say "   · the index could not be fingerprinted — nothing to compare"
elif [ "$INDEX_FINGERPRINT_BEFORE" = "$INDEX_FINGERPRINT_AFTER" ]; then
  say "   ✓ the index did not change while this commit was being checked"
else
  bad "the index changed while this commit was being checked"
  say "     another agent changed the index during the check — the commit would"
  say "     hold different code from the one that was just tested."
  say "     stage your work again and commit again."
fi

# ─────────────────────────────────────────────────────────────────────────────
step "result"

if [ "$FAILED" -eq 1 ]; then
  say "   GATE FAILED — do not commit until these are fixed"
  exit 1
fi

if [ "$WARNED" -eq 1 ]; then
  say "   GATE PASSED with warnings"
else
  say "   GATE PASSED"
fi
exit 0
