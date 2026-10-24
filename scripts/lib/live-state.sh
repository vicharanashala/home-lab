#!/bin/bash
# Deciding whether the app the owner is actually using is running the code
# that is on disk.
#
# WHY THIS IS ITS OWN FILE: the rule is asked by a check that a person reads
# on a phone, and by a test that has to be able to make it wrong on purpose.
# A rule that lives inside a script cannot be shown to fail.
#
# THE BUG THIS EXISTS FOR
# On 2026-10-24 the bridge serving the owner's link was running code from
# 14:34 while the code on disk was from 19:18. The overwatch CLI fix was
# committed at 19:21 and every test passed — and the live app still answered
# every overwatch call with "[spawn error] spawn openclaw ENOENT", the very
# error the commit had fixed.
#
# WHY EVERY CHECK WAS GREEN: every check in this repo looks at the COMMIT.
# The quality gate exports the staged index and asks "does this commit
# type-check, pass its tests and contain no secrets?" The test suite asks
# "does this rule do what it says?" Not one of them asked the running app
# anything at all. The app the owner uses was on different code from the app
# in the repository, and that difference was invisible.
#
# THIS IS THE CHECK THAT WAS MISSING. It asks the running app two questions:
# is the bridge on the code on disk, and is the supervisor on the copy of
# watchdog.sh on disk. A green repository and a stale live app are the same
# state, and this is what tells them apart.
#
# WHY EVERY GUARD FAILS CLOSED, IN THE OPPOSITE DIRECTION
# A health check that says "all good" about an app that is broken is worse
# than no check at all: it stops people looking. So nothing here reports
# "current" or "healthy" unless it has been shown to be so. A value that
# cannot be read is "unknown", and unknown is never healthy.

# The libraries this file builds on. Sourced by absolute path so the rule
# works from any working directory — the check runs from the repo, from a
# launchd agent, and from a test's temporary directory.
LIVE_STATE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
. "$LIVE_STATE_LIB_DIR/bridge-stale.sh"
. "$LIVE_STATE_LIB_DIR/supervisor-reload.sh"

# live_port_listening <port>
#
# True when something is listening on <port>.
#
# WHY IT IS SEPARATE FROM THE STALENESS RULE: scripts/lib/bridge-stale.sh
# answers "is the bridge on the current code?", and a bridge that is not
# running at all answers that with "current" — because a start time that
# cannot be read is not evidence of anything. That is the right answer for
# the supervisor, which only calls it after it has checked the port is alive.
# It is the wrong answer for a health report, where a bridge that is DOWN
# must not be reported as up to date.
live_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

# live_bridge_state <port> <dir>
#
# What the running bridge is doing:
#
#   down         nothing is listening on the port
#   current      it is running the code that is on disk
#   stale        the code on disk is newer, and it parses
#   unparsable   the code on disk is newer, and it does not parse
#   unknown      the start time cannot be read
#
# WHY "down" IS ITS OWN WORD: an app that is not running is not an app that
# is up to date. Reporting it as "current" is how a dead bridge passes for a
# healthy one.
live_bridge_state() {
  local port="$1" dir="$2"
  if ! live_port_listening "$port"; then
    echo down
    return 0
  fi
  local state
  state="$(bridge_code_state "$port" "$dir")"
  case "$state" in
    current | stale | unparsable) echo "$state" ;;
    *) echo unknown ;;
  esac
}

# live_supervisor_state <script> <published-file>
#
# What the running supervisor is doing:
#
#   current      a supervisor is running the copy of watchdog.sh on disk
#   stale        a supervisor is running a DIFFERENT copy of watchdog.sh
#   unpublished  no supervisor has ever written its state down — every
#                running supervisor is older than the rule that writes it, so
#                not one of them will ever notice a later edit to watchdog.sh
#   orphaned     the supervisor that wrote the state down is gone, so whoever
#                is running now may be an older copy
#   unknown      the state could not be read
#
# WHY "unpublished" IS NOT "current": the supervisor publishes the checksum
# of the copy it is running, and the copy it is running is what decides
# whether it can notice that watchdog.sh has changed. A supervisor that
# predates that rule is running a loop that cannot re-read itself, so the
# app will silently keep serving old code for ever. That is the state this
# check exists to catch, and it is not the same as being up to date.
#
# WHY A CHECKSUM AND NOT A START TIME: `exec` — which is how the supervisor
# reloads itself — replaces the process image but keeps the process's start
# time. So a supervisor that has already reloaded looks exactly like one
# that never did, and a start time cannot tell them apart. The checksum of
# the copy that is running can.
#
# WHY THE PUBLISHER'S PID IS READ AS WELL: a checksum says WHICH copy was
# running when the state was written; it says nothing about whether that
# supervisor is still the one running. A state file that outlives its writer
# says "current" for ever while an older supervisor — one that cannot notice
# an edit to watchdog.sh — is the only one left alive. The pid is what tells
# a live publisher from a dead one, and a dead publisher means the state
# cannot vouch for anything.
live_supervisor_state() {
  local script="$1" published_file="$2" current published publisher
  current="$(supervisor_script_sum "$script")"
  case "$current" in
    '' | *[!0-9]*) echo unknown; return 0 ;;
  esac
  if [ ! -f "$published_file" ]; then
    echo unpublished
    return 0
  fi
  published="$(awk 'NR==1 {print $1}' "$published_file" 2>/dev/null)"
  publisher="$(awk 'NR==1 {print $2}' "$published_file" 2>/dev/null)"
  case "$published" in
    '' | *[!0-9]*) echo unknown; return 0 ;;
  esac
  # The checksum is compared FIRST, because it is the more specific answer: a
  # state that names a different copy is stale, whatever else it says.
  if [ "$published" != "$current" ]; then
    echo stale
    return 0
  fi
  case "$publisher" in
    '' | *[!0-9]*) echo unknown; return 0 ;;
  esac
  # The copy on disk is the copy that was published — but the supervisor that
  # published it may be gone, and the one running now may be an older copy
  # that cannot notice an edit to watchdog.sh. Say so.
  if supervisor_process_alive "$publisher"; then
    echo current
  else
    echo orphaned
  fi
}

# live_link_state <url>
#
# Whether the public link answers.
#
# WHY IT IS CHECKED AT ALL: the link is served by Tailscale Serve, which is
# a different thing from the bridge on 127.0.0.1. The bridge can be perfectly
# healthy while the link 502s, and the owner only ever sees the link.
#
# WHY IT IS A WORD AND NOT A BOOLEAN: a link that times out and a link that
# answers 500 are different problems and the report has to say which.
live_link_state() {
  local url="$1" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url/" 2>/dev/null)"
  case "$code" in
    200) echo reachable ;;
    000 | '') echo unreachable ;;
    *) echo "http-$code" ;;
  esac
}

# live_verdict <bridge-state> <supervisor-state> <link-state>
#
# The one word that says whether the app is healthy: "healthy", or
# "unhealthy — <what is wrong>".
#
# WHY IT ALWAYS RETURNS 0: this is a classifier, not a gate. Every other
# rule in this repo answers with a word and lets the caller decide what to do
# with it, and a rule that exits non-zero throws away its own answer to
# anything that captures its output. The check script turns the word into an
# exit code.
#
# WHY THE SUPERVISOR IS PART OF THE VERDICT: a bridge on the current code
# with a supervisor that cannot notice changes is healthy by accident. The
# next edit to watchdog.sh or to the bridge would leave the app on old code
# again, silently — which is the failure this whole check exists to end. So
# an app that cannot keep itself current is not reported as healthy.
#
# WHY "unknown" IS NOT HEALTHY: a state that could not be read is not
# evidence that anything is fine.
live_verdict() {
  local bridge="$1" supervisor="$2" link="$3"
  if [ "$bridge" != "current" ]; then
    echo "unhealthy — the bridge is $bridge"
    return 0
  fi
  if [ "$supervisor" != "current" ]; then
    echo "unhealthy — the supervisor is $supervisor"
    return 0
  fi
  if [ "$link" != "reachable" ]; then
    echo "unhealthy — the link is $link"
    return 0
  fi
  echo healthy
  return 0
}
