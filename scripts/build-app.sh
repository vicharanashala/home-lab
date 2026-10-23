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
set -euo pipefail

ROOT="/Users/adhyathmika/homehub"
cd "$ROOT"

STAGING="$ROOT/dist.staging"
RETIRED="$ROOT/dist.retired"
LIVE="$ROOT/dist"

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
