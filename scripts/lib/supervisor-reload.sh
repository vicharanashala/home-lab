#!/bin/bash
# Deciding when the running supervisor should reload itself onto the copy of
# the script that is on disk.
#
# WHY IT IS ITS OWN FILE: the supervisor is a loop that never returns, so a
# rule written inside it cannot be run from a test. "Is the supervisor running
# the copy of the script that is on disk?" is a decision, and a decision that
# decides whether the supervisor keeps supervising belongs where it can be
# checked.
#
# THE BUG THIS EXISTS FOR
# A bash script is read into memory when it starts. The supervisor is a
# `while true` loop, so the whole loop is parsed ONCE, at start-up, and the
# process keeps running that copy for ever. Editing watchdog.sh on disk
# therefore does NOTHING to the supervisor that is already running it.
#
# That is the defect the bridge had, one level up. The bridge was restarted
# only when its PORT stopped answering, so a committed bridge change stayed
# off the live app until the bridge happened to die for some other reason.
# The rule that fixed the bridge (scripts/lib/bridge-stale.sh) was committed
# TO watchdog.sh — and it could not run, for exactly this reason: every
# supervisor alive at the time had started before the rule was written, and
# none of them will ever read it.
#
# MEASURED ON THE LIVE MACHINE
# The supervisors were started at 11:21 and 14:34; the rule was committed at
# 20:15. The bridge serving the owner's link was still running code from
# 14:34, so the live app answered every overwatch call with
# "[spawn error] spawn openclaw ENOENT" — the exact error the rule was
# written to clear, still happening on the link the owner works from.
#
# WHY EVERY GUARD FAILS CLOSED
# A reload that happens when it should not is worse than no reload at all: the
# supervisor is the thing that keeps the app alive, and a supervisor that
# reloads onto a broken copy stops supervising. So every question here
# answers "stay on the copy that is running" whenever it is not certain.

# supervisor_script_sum <path>
#
# The checksum of the file's contents.
#
# WHY A CHECKSUM AND NOT A TIMESTAMP: a timestamp has one-second resolution,
# so an edit that lands in the same second as the last one is invisible. What
# this rule is about is the CONTENT of the file, and a checksum of the content
# is exact.
#
# @param script the file to checksum
supervisor_script_sum() {
  local script="$1"
  [ -f "$script" ] || return 1
  cksum "$script" 2>/dev/null | awk '{print $1}'
}

# supervisor_reload_needed <loaded_sum> <current_sum>
#
# True when the copy on disk is NOT the copy that is running.
#
# NEVER ON A VALUE THAT IS NOT A NUMBER: a checksum that could not be read is
# not evidence of a change, and reloading on a guess would replace a working
# supervisor with an unknown one.
supervisor_reload_needed() {
  local loaded="$1" current="$2"
  case "$loaded" in '' | *[!0-9]*) return 1 ;; esac
  case "$current" in '' | *[!0-9]*) return 1 ;; esac
  [ "$loaded" != "$current" ]
}

# supervisor_script_parses <path>
#
# True when the file parses as bash.
#
# WHY THE PARSE CHECK COMES FIRST: agents edit files in place, and a file that
# is half-written does not parse. Reloading onto a half-written file is a
# supervisor that stops supervising — the app keeps running for a while and
# then nothing brings it back — which is worse than a supervisor that is
# merely out of date. A file that does not parse is left alone and the copy
# that is running keeps supervising.
#
# @param script the file to check
supervisor_script_parses() {
  local script="$1"
  [ -f "$script" ] || return 1
  bash -n "$script" >/dev/null 2>&1
}

# supervisor_self_state <script> <loaded_sum>
#
# What the running supervisor is doing, as far as the script on disk goes.
#
#   current      the running copy IS the copy on disk
#   reload       the copy on disk is different AND it parses — run it
#   unparsable   the copy on disk is different AND it does not parse — stay
#   unknown      the file cannot be read or checksummed — stay
#
# WHY IT IS A WORD AND NOT A BOOLEAN: "do not reload" has two very different
# reasons, and only one of them is a problem. "current" is the supervisor
# working. "unparsable" is a file being written, or a script with a mistake in
# it, and the supervisor is supervising fine on the old copy — but it must not
# be silent, or a broken watchdog.sh looks exactly like one that was never
# changed.
#
# @param script     the supervisor script on disk
# @param loaded_sum the checksum of the copy that is running
supervisor_self_state() {
  local script="$1" loaded="$2" current
  current="$(supervisor_script_sum "$script")"
  if [ -z "$current" ]; then
    echo unknown
    return 0
  fi
  if ! supervisor_reload_needed "$loaded" "$current"; then
    echo current
    return 0
  fi
  if supervisor_script_parses "$script"; then
    echo reload
  else
    echo unparsable
  fi
}

# supervisor_log <message>
#
# The default logger, used when the caller does not pass one of its own.
#
# WHY IT WRITES TO THE SAME FILE: the supervisor's log is where an owner
# looks to see what the supervisor did, and a reload is exactly the kind of
# thing that has to be in there.
supervisor_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "${LOG:-/tmp/hh_supervisor.log}"
}

# supervisor_reload_if_changed <script> <loaded_sum> [logger]
#
# Reload the supervisor onto the copy of the script on disk, when that copy is
# different and parses. Returns when there is nothing to do.
#
# WHY IT EXECs RATHER THAN RE-SOURCES: a re-source runs the new copy inside
# the old process, so the old loop keeps its state — the old INTERVAL, the
# old paths, whatever else the old copy had already decided. An exec replaces
# the process outright, so the new copy runs from its first line with nothing
# of the old one left. The PID is unchanged, so launchd still owns the same
# process and KeepAlive still means what it says.
#
# WHY THE LOGGER IS A PARAMETER: the supervisor has its own `log`, and the
# message has to land in the supervisor's log. The default is here so the
# rule can be run from a test without one.
#
# @param script     the supervisor script on disk
# @param loaded_sum the checksum of the copy that is running
# @param logger     the name of the function that writes a log line
supervisor_reload_if_changed() {
  local script="$1" loaded="$2" logger="${3:-supervisor_log}" state
  state="$(supervisor_self_state "$script" "$loaded")"
  case "$state" in
    reload)
      "$logger" "watchdog.sh on disk has changed — reloading this supervisor onto it"
      exec /bin/bash "$script"
      ;;
    unparsable)
      "$logger" "watchdog.sh on disk does not parse — staying on the copy that is running"
      ;;
  esac
  return 0
}
