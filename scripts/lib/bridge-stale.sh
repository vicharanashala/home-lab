#!/bin/bash
# Deciding when the running bridge is out of date, and putting it back on the
# code that is on disk.
#
# WHY THIS IS ITS OWN FILE: the supervisor is a loop that never returns, so a
# rule written inside it cannot be run from a test. "Is the bridge running
# code that is no longer on disk?" is a decision, and a decision that decides
# whether the app restarts belongs where it can be checked.
#
# THE BUG THIS EXISTS FOR
# The supervisor restarted the bridge only when the PORT stopped answering.
# That keeps the app alive, but it leaves the app running code that is no
# longer on disk: a bridge change was committed, its tests passed, and the
# commit said the feature was fixed — while the bridge serving the owner's
# link went on running the old code, because nothing ever asked the running
# bridge whether it was current.
#
# That is the quietest kind of broken: every check is green and the fix is
# not there. The overwatch CLI resolution is the example. It was committed at
# 19:21; the bridge serving the link had been running since 14:34; and every
# overwatch call still died with "spawn openclaw ENOENT" — the very error the
# commit had fixed, still happening on the live app.
#
# WHY EVERY GUARD FAILS CLOSED
# A restart that happens when it should not is worse than no restart at all:
# the app goes down, comes back, and goes down again. So every question here
# answers "stale" only when it is certain, and "not stale" whenever it is
# not.

# bridge_code_mtime <dir>
#
# The newest .mjs file in the bridge directory, as an epoch second.
#
# EVERY file counts, not only index.mjs: a module added beside it changes
# what the bridge does exactly as much as changing index.mjs does. The openclaw
# fix was mostly a new file, and a rule that watched only index.mjs would have
# missed it.
bridge_code_mtime() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  find "$dir" -type f -name '*.mjs' -exec stat -f %m {} + 2>/dev/null | sort -n | tail -1
}

# bridge_started_at <port>
#
# The epoch second the bridge listening on <port> started, or nothing when it
# is not running or its start time cannot be read.
#
# WHY THE START TIME AND NOT A MARKER FILE: the start time is the truth about
# what the running process is executing, and it needs nothing on disk to be
# correct — so there is no marker to be missing, stale, or written by a
# supervisor that died halfway through.
bridge_started_at() {
  local port="$1" pid lstart
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [ -n "$pid" ] || return 1
  lstart="$(ps -o lstart= -p "$pid" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$lstart" ] || return 1
  date -j -f "%a %b %e %T %Y" "$lstart" "+%s" 2>/dev/null
}

# bridge_is_stale <code_mtime> <started_at>
#
# True when the code on disk is NEWER than the bridge that is running it.
#
# STRICTLY NEWER, and never on a value that is not a number: a code file
# touched in the same second the bridge started is not evidence of anything,
# and treating it as stale would restart the bridge for no reason. A value
# that is missing — a `stat` that failed, a bridge that is not running —
# answers "not stale", because guessing wrong here restarts the app.
bridge_is_stale() {
  local code_mtime="$1" started="$2"
  case "$code_mtime" in '' | *[!0-9]*) return 1 ;; esac
  case "$started" in '' | *[!0-9]*) return 1 ;; esac
  [ "$code_mtime" -gt "$started" ]
}

# bridge_code_parses <dir>
#
# True when every .mjs in the bridge directory parses.
#
# WHY THE PARSE CHECK COMES FIRST: agents edit files in place, and a file
# that is half-written does not parse. Restarting the bridge onto a
# half-written file is an app that is DOWN — worse than an app that is merely
# out of date — so a file that does not parse is left alone and the running
# bridge keeps serving.
bridge_code_parses() {
  local dir="$1" f
  [ -d "$dir" ] || return 1
  for f in "$dir"/*.mjs; do
    [ -e "$f" ] || continue
    "${NODE_BIN:-node}" --check "$f" >/dev/null 2>&1 || return 1
  done
  return 0
}

# bridge_code_state <port> <dir>
#
# What the running bridge is doing, as far as the code on disk goes.
#
#   current     the running bridge is on the code that is on disk
#   stale       the code on disk is newer AND it parses — restart onto it
#   unparsable  the code on disk is newer AND it does not parse — leave alone
#   unknown     the bridge, or its start time, cannot be read — leave alone
#
# WHY IT IS A WORD AND NOT A BOOLEAN: "do not restart" has two very different
# reasons, and only one of them is a problem. "current" is the app working.
# "unparsable" is a file being written, or a bridge file with a mistake in
# it, and the app is running fine on the old code — but it must not be
# silent, or a broken bridge file looks exactly like a bridge that was never
# changed.
#
# WHY THE PARSE CHECK IS ONLY REACHED WHEN THE CODE IS NEWER: the check
# starts a node process, and the supervisor looks at this every twenty
# seconds. Asking "does this parse?" about a file that has not changed since
# the bridge started is work for nothing.
#
# WHY A STATE THAT CANNOT BE READ IS "unknown" AND NOT "current": "the code
# on disk is not newer than the bridge" is a claim that needs TWO numbers to
# make — the time of the code on disk and the time the bridge started. With
# one of them missing there is nothing to compare, and "current" would be a
# guess dressed up as a measurement.
#
# MEASURED ON THE LIVE MACHINE (2026-10-25)
# The bridge directory could not be read, so the code time was empty. The rule
# answered "current", the live check said "current", and the verdict said
# "healthy" — about an app that could have been running code from hours ago,
# with a bridge directory that had been renamed or moved out from under it.
# The rule's own contract lists "unknown" for exactly this case, and the
# contract was never implemented: the word appeared in the comment and
# nowhere else, so the guard that was written to catch it did nothing.
#
# The same false all-clear is the one the whole live check exists to end. A
# health check that says "all good" about an app it cannot vouch for stops
# people looking.
#
# WHY THE SUPERVISOR STILL LEAVES THE BRIDGE ALONE: "unknown" is not a reason
# to restart. A restart that happens when it should not is worse than no
# restart at all, so the supervisor does what it did before this change —
# nothing — and the REPORT is what changes. What the supervisor cannot tell
# is now said out loud instead of being passed off as "current".
bridge_code_state() {
  local port="$1" dir="$2" code_mtime started
  code_mtime="$(bridge_code_mtime "$dir")"
  started="$(bridge_started_at "$port")"
  case "$code_mtime" in '' | *[!0-9]*) echo unknown; return 0 ;; esac
  case "$started" in '' | *[!0-9]*) echo unknown; return 0 ;; esac
  if ! bridge_is_stale "$code_mtime" "$started"; then
    echo current
    return 0
  fi
  if bridge_code_parses "$dir"; then
    echo stale
  else
    echo unparsable
  fi
}

# bridge_take_restart_lock <lock-dir>
#
# Take the restart lock, or fail when another supervisor holds it.
#
# WHY A LOCK AT ALL: launchd has left more than one copy of the supervisor
# running over the years, and every copy runs this loop. Without the lock they
# would all notice the stale code in the same second and all of them would
# restart the bridge at once.
#
# WHY IT EXPIRES: a supervisor killed between taking the lock and giving it
# back would otherwise block every later restart for ever.
bridge_take_restart_lock() {
  local lock="$1" age
  if mkdir "$lock" 2>/dev/null; then
    return 0
  fi
  age=$(( $(date +%s) - $(stat -f %m "$lock" 2>/dev/null || echo 0) ))
  if [ "$age" -gt 120 ]; then
    rmdir "$lock" 2>/dev/null
    mkdir "$lock" 2>/dev/null && return 0
  fi
  return 1
}

# bridge_release_restart_lock <lock-dir>
bridge_release_restart_lock() {
  rmdir "$1" 2>/dev/null
  return 0
}

# bridge_restart <port> <dir> <node-bin> <log-file>
#
# Stop the bridge on <port> and start it again from <dir>.
#
# WHY IT WAITS FOR THE PORT TO FREE: a bridge still holding the port when
# the new one starts makes the new one die on EADDRINUSE, and then the app
# is down with nothing listening and nothing to say so.
bridge_restart() {
  local port="$1" dir="$2" node_bin="$3" log="$4"
  local pid waited=0
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null
    while [ "$waited" -lt 15 ] && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
      sleep 1
      waited=$((waited + 1))
    done
  fi
  # The subshell is EXECED rather than forked. `( cmd & )` forks a subshell and
  # bash keeps that subshell alive until the command finishes, so a restart
  # would leave a bash process behind holding the bridge — and that process's
  # command line is the same as the supervisor's, because it is the same
  # script. It is then indistinguishable from a second supervisor in `ps`.
  #
  # The subshell's own output is thrown away as well. A subshell still holding
  # the caller's stdout keeps that pipe open — so a caller that waits for the
  # output to end waits for the bridge to exit too.
  ( cd "$dir" && exec nohup "$node_bin" index.mjs > "$log" 2>&1 < /dev/null ) >/dev/null 2>&1 &
}
