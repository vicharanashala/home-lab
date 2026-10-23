#!/bin/bash
# One build at a time in this repository.
#
# WHY THIS IS ITS OWN FILE
# The lock is shell, and shell in the middle of a build script cannot be
# exercised without running a build. The secret scan has the same shape of
# problem and the same answer — scripts/lib/secret-scan.sh with
# scripts/test-secret-scan.mjs — so the logic lives here and the build script
# sources it.
#
# WHY THERE IS A LOCK AT ALL
# `vite build` empties its output directory before it writes anything, and
# every build in this repository points at the same staging directory. Two
# builds at once therefore fight over it: the second empties the staging
# directory while the first is still writing into it, and the first dies part
# way through with
#   ENOENT: no such file or directory, open '.../dist.staging/assets/<chunk>.js'
# — or, if the emptying lands just after the chunks were written, the build
# "succeeds" and is then rejected because index.html has vanished.
#
# That is not hypothetical: several agents work in this repo at once and each
# of them builds, so two builds genuinely do overlap.
#
# WHY THE LOCK IS A FILE, AND NOT A DIRECTORY
# The lock has to be taken atomically, AND it has to be readable as a whole.
#
# The obvious way to take a lock is `mkdir`, which is atomic: exactly one
# process can create the directory. But the holder then has to write its
# identity INTO that directory, and a reader that arrives in between sees a
# lock with no holder in it. That reader used to conclude the lock had been
# abandoned and take it — from a build that was still starting up.
#
# The window was the `ps` call that writes the holder's command line: it
# forks, and it takes tens of milliseconds. A second build arriving in that
# window read the lock, saw that the holder's command line did not match the
# empty one it had been given, and broke the lock. Two builds then ran at
# once, which is the corruption this lock exists to prevent.
#
# So the identity is written into a file of its own FIRST, and the lock is
# then a HARD LINK to that file. `link()` fails with EEXIST when the
# destination is already there, so exactly one build can take the lock, and
# the lock is never visible without its holder: the content is already
# written before the link exists. There is no window at all.
#
# A file and not a symlink, on purpose: `ln -s` does not fail when the
# destination is a directory — it puts the link INSIDE it and reports
# success — and removing a symlink to a directory is not something every
# `rm` on this machine can do quickly. A plain file is the one shape that
# every tool here handles the same way.
#
# The holder's command line is compared as well as its pid, so a pid the OS
# has handed to some other process is not mistaken for a live build.

# The repository the lock belongs to. A test points this at a temporary
# directory so that it never touches the real lock.
BUILD_LOCK_ROOT="${BUILD_LOCK_ROOT:-/Users/adhyathmika/homehub}"
# The lock itself, and the holder's own copy of the identity behind it.
BUILD_LOCK="$BUILD_LOCK_ROOT/.build.lock"
BUILD_LOCK_INFO="$BUILD_LOCK_ROOT/.build.lock.info.$$"
# The holder's identity, read out of the lock. Set by build_lock_identity.
BUILD_LOCK_PID=""
BUILD_LOCK_CMD=""

# How long to wait for another build before giving up. A build takes about
# half a minute, so this is long enough for any real build and short enough
# that a wedged one does not hang the queue forever.
BUILD_LOCK_WAIT="${BUILD_LOCK_WAIT:-300}"
# How often to look again to see whether the lock has come free.
BUILD_LOCK_POLL="${BUILD_LOCK_POLL:-2}"
[ "$BUILD_LOCK_POLL" -gt 0 ] 2>/dev/null || BUILD_LOCK_POLL=2
# The attempt cap is a SPIN guard, not a second timeout: the stale-lock path
# `continue`s without sleeping, so a lock this script cannot remove would
# otherwise loop forever printing the same line.
#
# WHY IT IS DERIVED FROM THE WAIT: each waiting attempt sleeps for
# BUILD_LOCK_POLL seconds, so the wait needs WAIT/POLL iterations to elapse.
# A fixed cap cut the wait short of what it promised — with a build holding
# the lock for 50s, the next one gave up after 41s — and a build that took
# longer than that lost the queue, which is the corruption this lock exists
# to prevent.
BUILD_LOCK_MAX_ATTEMPTS=$((BUILD_LOCK_WAIT / BUILD_LOCK_POLL + 10))

# The holder's pid and command line, from whichever shape the lock has.
#
# The lock is a file with the pid on the first line and the command line on
# the second. A lock left behind by the older directory-based lock holds the
# same two things in two files instead, and has to be read as well as
# judged — otherwise the directory would look like a lock with no holder in
# it, and the build that owns it would have its lock taken away.
#
# Sets BUILD_LOCK_PID and BUILD_LOCK_CMD rather than printing them: the two
# are separated by a newline, and a command line may hold anything.
build_lock_identity() {
  if [ -d "$BUILD_LOCK" ] && [ ! -L "$BUILD_LOCK" ]; then
    BUILD_LOCK_PID="$(cat "$BUILD_LOCK/pid" 2>/dev/null || true)"
    BUILD_LOCK_CMD="$(cat "$BUILD_LOCK/cmd" 2>/dev/null || true)"
  else
    BUILD_LOCK_PID="$(sed -n '1p' "$BUILD_LOCK" 2>/dev/null || true)"
    BUILD_LOCK_CMD="$(sed -n '2p' "$BUILD_LOCK" 2>/dev/null || true)"
  fi
}

# Remove the lock, and the holder's copy of the identity behind it.
#
# WHY THE PATH IS CHECKED FIRST: a malformed root must never turn this into
# a destructive command.
build_lock_drop() {
  local pid
  # The holder's identity is read BEFORE the lock goes, so that the holder's
  # own copy of it can be cleaned up as well.
  build_lock_identity
  pid="$BUILD_LOCK_PID"
  case "$BUILD_LOCK" in
    "$BUILD_LOCK_ROOT"/.build.lock)
      if [ -d "$BUILD_LOCK" ] && [ ! -L "$BUILD_LOCK" ]; then
        # The older directory-based lock.
        rm -rf "$BUILD_LOCK"
      else
        rm -f "$BUILD_LOCK"
      fi
      ;;
    *) echo "refusing to remove an unexpected lock path: $BUILD_LOCK" >&2 ;;
  esac
  # The holder's own copy of the identity, if it left one behind.
  case "$pid" in
    ''|*[!0-9]*) ;;
    *) rm -f "$BUILD_LOCK_ROOT/.build.lock.info.$pid" ;;
  esac
}

# Release the lock THIS build holds.
#
# WHY IT CHECKS FIRST: if the lock has been taken over by another build the
# pid in it is not ours, and removing it would pull the ground from under
# that build.
build_lock_release() {
  build_lock_identity
  if [ "$BUILD_LOCK_PID" = "$$" ]; then
    rm -f "$BUILD_LOCK"
  fi
  rm -f "$BUILD_LOCK_INFO"
}

# True when the lock's holder is gone, so the lock can be taken over.
build_lock_holder_is_gone() {
  local current
  build_lock_identity
  [ -n "$BUILD_LOCK_PID" ] || return 0
  kill -0 "$BUILD_LOCK_PID" 2>/dev/null || return 0
  current="$(ps -ww -p "$BUILD_LOCK_PID" -o command= 2>/dev/null || true)"
  [ -n "$current" ] || return 0
  # No command line yet: the holder is still setting itself up.
  [ -n "$BUILD_LOCK_CMD" ] || return 1
  # The same command line: the holder is still the build that took the lock.
  [ "$current" = "$BUILD_LOCK_CMD" ] && return 1
  # A different command line: the pid has been recycled by the OS.
  return 0
}

# Take the build lock, waiting for another build to finish if there is one.
build_lock_acquire() {
  local waited=0 holder attempts=0
  while true; do
    attempts=$((attempts + 1))
    # A bound on the attempts, so that a lock this script cannot remove — a
    # permissions problem, say — ends in an error rather than in a script
    # that spins forever printing the same line.
    if [ "$attempts" -gt "$BUILD_LOCK_MAX_ATTEMPTS" ]; then
      echo "could not take the build lock after $attempts attempts — giving up" >&2
      return 1
    fi

    # Write the identity first, in a file of its own. The lock is only
    # created once the identity is complete, so a reader never sees a lock
    # without its holder.
    printf '%s\n%s\n' "$$" "$(ps -ww -p $$ -o command= 2>/dev/null || true)" > "$BUILD_LOCK_INFO"

    if [ -d "$BUILD_LOCK" ] && [ ! -L "$BUILD_LOCK" ]; then
      # A lock left behind by the older directory-based lock. `ln` would put
      # the new file INSIDE that directory and report success, so the
      # directory has to be dealt with before the lock can be taken.
      rm -f "$BUILD_LOCK_INFO"
    else
      # `ln` is a hard link, and link() fails with EEXIST when the
      # destination is already there. So the lock is taken by exactly one
      # build, and it is never visible without its holder.
      if ln "$BUILD_LOCK_INFO" "$BUILD_LOCK" 2>/dev/null; then
        trap build_lock_release EXIT
        return 0
      fi
      rm -f "$BUILD_LOCK_INFO"
    fi

    build_lock_identity
    holder="$BUILD_LOCK_PID"
    if build_lock_holder_is_gone; then
      echo "breaking a stale build lock — its holder (pid ${holder:-unknown}) is gone" >&2
      build_lock_drop
      continue
    fi
    if [ "$waited" -ge "$BUILD_LOCK_WAIT" ]; then
      echo "another build has held the lock for ${BUILD_LOCK_WAIT}s — giving up" >&2
      return 1
    fi
    if [ "$waited" -eq 0 ]; then
      echo "another build is running — waiting for it to finish"
    fi
    sleep "$BUILD_LOCK_POLL"
    waited=$((waited + BUILD_LOCK_POLL))
  done
}
