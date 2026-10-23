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
# The lock is a directory, because `mkdir` is atomic: exactly one process can
# create it. It records who holds it, so a build that was killed — which
# cannot run its own cleanup — does not block every later build forever. The
# holder's command line is compared as well as its PID, so a recycled PID is
# not mistaken for a live build.
set -euo pipefail

ROOT="/Users/adhyathmika/homehub"
cd "$ROOT"

STAGING="$ROOT/dist.staging"
RETIRED="$ROOT/dist.retired"
LIVE="$ROOT/dist"

LOCK="$ROOT/.build.lock"
# How long to wait for another build before giving up. A build takes about
# half a minute, so this is long enough for any real build and short enough
# that a wedged one does not hang the queue forever.
LOCK_WAIT=300
# The attempt cap is a SPIN guard, not a second timeout: the stale-lock path
# `continue`s without sleeping, so a lock this script cannot remove would
# otherwise loop forever printing the same line.
#
# WHY IT IS DERIVED FROM LOCK_WAIT: each waiting attempt sleeps two seconds,
# so LOCK_WAIT needs LOCK_WAIT/2 iterations to elapse. A fixed cap of 20
# therefore cut the wait at about forty seconds and the documented
# five-minute wait never happened — a build that took longer than that
# lost the queue, which is the corruption this lock exists to prevent.
# Measured before this change: with a build holding the lock for 50s, the
# next one gave up after 41s with "could not take the build lock after 21
# attempts".
MAX_ATTEMPTS=$((LOCK_WAIT / 2 + 10))

# ── the build lock ────────────────────────────────────────────────────────

release_lock() {
  # WHY NOT `rmdir`: the lock directory is a working directory, and things
  # other than this script put files in it — macOS drops a .DS_Store in
  # anything visible in the Finder. A `rmdir` that fails leaves the lock
  # behind, and the next build then cannot create it, sees a lock with no
  # holder, breaks it, and fails to create it again: an endless loop.
  #
  # The path is checked first so that a malformed ROOT can never turn this
  # into a destructive command.
  case "$LOCK" in
    "$ROOT"/.build.lock) rm -rf "$LOCK" ;;
    *) echo "refusing to remove an unexpected lock path: $LOCK" >&2 ;;
  esac
}

# True when the lock's holder is gone, so the lock can be taken over.
#
# WHY THE COMMAND LINE IS CHECKED AS WELL AS THE PID
# A PID on its own is not enough. The OS hands the same PID to a different
# process once the original has gone, and a recycled PID would keep a dead
# build's lock alive forever. Comparing the command line the holder wrote
# down with the command line the PID has NOW tells the two apart.
lock_holder_is_gone() {
  local pid="$1" stored current
  stored="$(cat "$LOCK/cmd" 2>/dev/null || true)"
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  current="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [ -n "$current" ] || return 0
  [ "$current" = "$stored" ] && return 1
  return 0
}

acquire_lock() {
  local waited=0 holder attempts=0
  while true; do
    attempts=$((attempts + 1))
    # A bound on the attempts, so that a lock directory this script cannot
    # remove — a permissions problem, say — ends in an error rather than in
    # a script that spins forever printing the same line.
    if [ "$attempts" -gt "$MAX_ATTEMPTS" ]; then
      echo "could not take the build lock after $attempts attempts — giving up" >&2
      return 1
    fi
    if mkdir "$LOCK" 2>/dev/null; then
      echo $$ > "$LOCK/pid"
      ps -ww -p $$ -o command= > "$LOCK/cmd" 2>/dev/null || true
      trap release_lock EXIT
      return 0
    fi
    holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if lock_holder_is_gone "$holder"; then
      echo "breaking a stale build lock — its holder (pid ${holder:-unknown}) is gone" >&2
      release_lock
      continue
    fi
    if [ "$waited" -ge "$LOCK_WAIT" ]; then
      echo "another build has held the lock for ${LOCK_WAIT}s — giving up" >&2
      return 1
    fi
    if [ "$waited" -eq 0 ]; then
      echo "another build is running — waiting for it to finish"
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

acquire_lock

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
