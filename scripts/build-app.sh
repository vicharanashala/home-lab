#!/bin/bash
# Build the app and swap it into place without ever leaving the live build
# broken.
#
# WHY THIS EXISTS
# `vite build` empties the output directory before it writes anything. So a
# build that is killed half way through — an agent's command timed out, a
# laptop went to sleep, the process was interrupted — leaves the app with no
# index.html. The bridge serves that directory, so every page then answers
# with a 500 and the permanent link is dead.
#
# It really happened: the app served 500 for over an hour, and nothing
# noticed. The bridge was listening the whole time, so the supervisor had
# nothing to fix, and the only clue was one line in the bridge log.
#
# THE FIX
# Build somewhere else and replace the live build only when the new one is
# complete. An interrupted or failed build then costs nothing at all: the
# old build stays live and the app keeps working.
#
# WHY THERE IS A LOCK
# `vite build` writes every chunk into ONE output directory, and this script
# points every build at the same staging directory. Two builds running at the
# same time therefore fight over it: the second one empties the staging
# directory while the first is still writing into it, and the first dies
# part-way through with
#   ENOENT: no such file or directory, open '.../dist.staging/assets/<chunk>.js'
# — or, if the emptying lands just after the chunks were written, the build
# "succeeds" and is then rejected below because index.html has vanished.
#
# That is not a hypothetical. Several agents work in this repo at once and
# each of them builds, so two builds genuinely do overlap — a debugging pass
# on 2026-10-23 lost a build to exactly this, and a sweep of six concurrent
# runs broke one of them.
#
# HOW THE LOCK WORKS
# It records who holds it, so a build that was killed — which cannot run its
# own cleanup — does not block every later build forever. The holder's
# command line is compared as well as its PID, so a recycled PID is not
# mistaken for a live build. The lock is taken atomically AND is only ever
# visible complete, so a second build can never take it from a build that is
# still starting up — scripts/lib/build-lock.sh has the details, and
# scripts/test-build-lock.mjs has the proof.
set -euo pipefail

ROOT="/Users/adhyathmika/homehub"
cd "$ROOT"

STAGING="$ROOT/dist.staging"
RETIRED="$ROOT/dist.retired"
LIVE="$ROOT/dist"

# The lock itself lives in scripts/lib/build-lock.sh, so that it can be
# tested without running a build — the same reason the quality gate's secret
# scan lives in scripts/lib/secret-scan.sh.
BUILD_LOCK_ROOT="$ROOT"
# shellcheck source=scripts/lib/build-lock.sh
. "$ROOT/scripts/lib/build-lock.sh"

build_lock_acquire

# Clean up after an earlier run, and recover from a swap that was cut short
# between the two renames below.
rm -rf "$STAGING"
if [ ! -d "$LIVE" ] && [ -d "$RETIRED" ]; then
  echo "dist/ was missing — restoring the previous build from dist.retired/"
  mv "$RETIRED" "$LIVE"
fi
rm -rf "$RETIRED"

# The live dist/ is left alone while the new build is written.
npx vite build --outDir "$STAGING"

if [ ! -f "$STAGING/index.html" ]; then
  echo "the build produced no index.html — the live build has been left alone" >&2
  rm -rf "$STAGING"
  exit 1
fi

# Both renames are metadata-only operations, so dist/ is missing for a
# fraction of a millisecond rather than for the length of a build.
if [ -d "$LIVE" ]; then
  mv "$LIVE" "$RETIRED"
fi
mv "$STAGING" "$LIVE"
rm -rf "$RETIRED"

echo "build swapped into $LIVE"
