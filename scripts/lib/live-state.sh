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
#
# WHY THIS SIDE WATCHES THE SAME SET THE SUPERVISOR WATCHES: the supervisor
# watches the script AND the rule libraries it loads, and publishes one
# number for the whole set. If the two sides worked the set out for
# themselves they would compare different numbers, and one side would say
# "current" while the other said "stale" about the same app — which is the
# failure this whole check exists to prevent.
live_supervisor_state() {
  local script="$1" published_file="$2" current published publisher
  current="$(supervisor_watched_sum "$script")"
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

# live_bundle_state <root>
#
# What the BUNDLE the owner is served is doing:
#
#   current      the bundle was built after the last change to the source
#   stale        the source is newer than the bundle
#   missing      there is no bundle at all
#   unknown      the source cannot be read, so nothing can be compared
#
# WHY THE BUNDLE IS ASKED ABOUT AND NOT ONLY THE BRIDGE: the bridge is the
# app's API. The bundle is the app the owner actually LOOKS AT — the pages,
# the scripts, the whole interface — and the bridge serves it as static files
# out of dist/.
#
# WHY NOTHING REBUILDS IT: the supervisor restarts the bridge when the
# bridge's own code changes, and it starts tailscale and the voice daemon.
# It never runs a build. So the bundle stays exactly as it was left, and the
# only thing that puts a change in front of the owner is an agent running
# `npm run build`.
#
# That is the 2026-10-24 incident on the other half of the app. The bridge
# ran code from 14:34 while the code on disk was from 19:18, and every check
# stayed green. A change to src/ that never reached a build does the same
# thing to the interface, and nothing was able to see it: this check asks the
# BRIDGE whether it is on the code on disk, and said nothing about the half
# of the app the owner is actually looking at.
#
# WHY THE BUILD IS MARKED BY dist/index.html AND NOT BY THE ASSETS: vite
# writes the assets first and index.html last, so index.html is the last
# thing written and the one file whose time says when the build finished. An
# asset that was written earlier is not evidence of anything.
#
# WHY THE INPUTS ARE THE WHOLE OF src/ AND public/ AND NOT JUST THE FILES
# THAT WERE CHANGED: a rule that watched one file would miss every other
# one, and a rule that watched only TypeScript would miss the stylesheet,
# the icon and the manifest — all of which the owner sees.
#
# WHY THE CONFIG FILES ARE INPUTS TOO: a changed tailwind config produces
# different CSS, and a changed vite config produces a different bundle. Both
# are invisible to the owner's eye until the bundle that uses them is built.
#
# WHY THE DEPENDENCIES AND THE ENV FILES ARE INPUTS TOO: they are the two
# inputs the list was missing, and both of them change the bundle without
# changing a line of src/.
#
# A dependency version IS in the JavaScript. `npm install` that bumps a
# library produces a different bundle from the same source, and a rule that
# watched only src/ and the configs called that "current" while the owner was
# served the old one.
#
# And vite INLINES the VITE_* values into the bundle — the bridge token sits
# in dist/assets/*.js in plaintext, because the frontend has to send it. So a
# rotated token in .env.production is a bundle that has to be rebuilt, and a
# bundle that was not rebuilt leaves every API call from the owner's phone
# answering 401 while the check says healthy. That is the worst shape of the
# failure this rule exists to catch: the app is broken for the owner and the
# check is green.
#
# WHY ONLY THE TIMES ARE READ AND NEVER THE CONTENT: these files hold the
# secrets. The rule compares mtimes and nothing else, so no token ever
# reaches a log, a diff or a report.
#
# WHY "missing" IS NOT "current": a checkout with no bundle serves the
# owner nothing at all, and the link answers 500. That is not an app that is
# up to date.
#
# WHY "unknown" IS NEVER "current": the comparison needs two numbers — the
# time the source was last changed and the time the bundle was built. With
# the source missing there is nothing to compare, and "current" would be a
# guess dressed up as a measurement.
live_bundle_state() {
  local root="$1"
  local build="$root/dist/index.html"

  # The source has to be there for the comparison to mean anything.
  [ -d "$root/src" ] || { echo unknown; return 0; }

  if [ ! -f "$build" ]; then
    echo missing
    return 0
  fi

  local build_mtime
  build_mtime="$(stat -f %m "$build" 2>/dev/null)"
  case "$build_mtime" in
    '' | *[!0-9]*) echo unknown; return 0 ;;
  esac

  # The newest of everything that goes into the bundle.
  local newest=0 path mtime
  for path in \
    "$root/src" \
    "$root/public" \
    "$root/index.html" \
    "$root/vite.config.ts" \
    "$root/tailwind.config.js" \
    "$root/postcss.config.js" \
    "$root/package.json" \
    "$root/package-lock.json" \
    "$root/.env" \
    "$root/.env.local" \
    "$root/.env.production" \
    "$root/.env.production.local"; do
    [ -e "$path" ] || continue
    mtime="$(bundle_newest_mtime "$path")"
    case "$mtime" in
      '' | *[!0-9]*) echo unknown; return 0 ;;
    esac
    [ "$mtime" -gt "$newest" ] && newest="$mtime"
  done

  # Nothing to compare against — the source exists but holds no file whose
  # time could be read.
  [ "$newest" -gt 0 ] || { echo unknown; return 0; }

  if [ "$newest" -gt "$build_mtime" ]; then
    echo stale
    return 0
  fi
  echo current
  return 0
}

# bundle_newest_mtime <path>
#
# The newest mtime under a path — a file's own time, or the newest time of
# any file under a directory.
#
# WHY THE DIRECTORY IS WALKED RATHER THAN THE DIRECTORY'S OWN TIME: a
# directory's mtime changes when an entry is added or removed, not when a
# file inside it is edited. A rule that read the directory would keep saying
# the bundle is current while a source file was being changed under it.
bundle_newest_mtime() {
  local path="$1"
  if [ -d "$path" ]; then
    find "$path" -type f -exec stat -f %m {} + 2>/dev/null | sort -n | tail -1
  else
    stat -f %m "$path" 2>/dev/null
  fi
}

# live_verdict <bridge-state> <supervisor-state> <link-state> <bundle-state>
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
#
# WHY BOTH ARE NAMED WHEN BOTH ARE WRONG: the bridge is put back onto the
# code on disk BY THE SUPERVISOR, so a bridge on old code and a supervisor
# that cannot notice changes are one problem and not two. The verdict named
# only the bridge, and the owner read it and waited for the supervisor to put
# the bridge back — which is what the supervisor does.
#
# The supervisor running at the time could do neither half of the job: it was
# older than the rule that puts the bridge back onto the code on disk, and
# older than the rule that lets it notice an edit to watchdog.sh. The report
# said exactly what it would have said about a healthy supervisor, so the one
# thing that made the app unrecoverable was the thing the report left out.
#
# MEASURED ON THE LIVE MACHINE (2026-10-25)
#   live_verdict stale unpublished reachable current ->  "unhealthy — the bridge is stale and the supervisor is unpublished"
#   live_verdict stale current    reachable current ->  "unhealthy — the bridge is stale"
#
# Two different apps, one report. The verdict now names both when both are
# wrong, so the line an owner reads on a phone cannot be the same line for an
# app that can recover and an app that cannot.
# WHY EVERY PROBLEM IS NAMED, NOT JUST THE FIRST: the report is read on a
# phone by somebody who has to decide what to do about it, and a verdict that
# names one problem out of two reads exactly like a verdict about an app with
# one problem. So the problems are collected and named together.
#
# WHY THE BUNDLE IS ONE OF THEM: the bundle is the half of the app the owner
# actually looks at, and nothing rebuilds it on its own. A verdict that said
# "healthy" while the owner's link was serving an interface hours behind the
# repository would be the false all-clear this whole check exists to end.
#
# WHY A MISSING ARGUMENT IS NOT "CURRENT": the verdict fails closed. A caller
# that forgets to ask about the bundle gets "the bundle is " in the report,
# which is not healthy — the same way an unreadable state is not healthy.
live_verdict() {
  local bridge="$1" supervisor="$2" link="$3" bundle="$4"
  local problems="" sep=""
  if [ "$bridge" != "current" ]; then
    problems="the bridge is $bridge"
    sep=" and "
  fi
  if [ "$supervisor" != "current" ]; then
    problems="${problems}${sep}the supervisor is $supervisor"
    sep=" and "
  fi
  if [ "$link" != "reachable" ]; then
    problems="${problems}${sep}the link is $link"
    sep=" and "
  fi
  if [ "$bundle" != "current" ]; then
    problems="${problems}${sep}the bundle is $bundle"
    sep=" and "
  fi
  if [ -n "$problems" ]; then
    echo "unhealthy — $problems"
    return 0
  fi
  echo healthy
  return 0
}
