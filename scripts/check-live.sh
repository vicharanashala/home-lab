#!/bin/bash
# Ask the app that is actually running whether it is running the code on disk.
#
# WHY THIS EXISTS
# The repository can be green and the app can still be on old code. That
# happened on 2026-10-24: the overwatch CLI fix was committed and every test
# passed, while the bridge on the owner's link was still running code from
# five hours earlier and still answered with "[spawn error] spawn openclaw
# ENOENT" — the exact error the commit had fixed.
#
# Every check in this repo looks at the COMMIT. This is the one that looks
# at the RUNNING app.
#
# WHAT IT PRINTS
#   the bridge      is it running the code on disk?
#   the supervisor  is it running the copy of watchdog.sh on disk?
#   the link        does the public address answer?
#   the bundle      is the app the owner is served built from the source?
#
# It exits non-zero when the app is not healthy, so it can be used by
# anything that wants to know.
#
# WHY THE BUNDLE IS ONE OF THE FOUR: the bridge is the app's API, and the
# bundle is the app the owner actually looks at. Nothing rebuilds the
# bundle — not the supervisor, not the bridge — so a change to the source
# that never reached a build leaves the owner's link on the old interface
# while every other check stays green. That is the same false all-clear
# this check exists to end, on the half of the app nobody was watching.
#
# WHY THE OVERRIDES ARE ENV VARS AND NOT FLAGS: the rule has to be testable
# against a fixture — a fake bridge on a spare port — and a test cannot pass
# a flag through a script that is also run by hand. The defaults are the real
# app; the overrides only move what the check looks AT.
#
# USAGE
#   scripts/check-live.sh
#
#   HH_BRIDGE_PORT          port the bridge is on          (8789)
#   HH_BRIDGE_DIR           the bridge's directory
#   HH_SUPERVISOR_SCRIPT    the supervisor script          (watchdog.sh)
#   HH_SUPERVISOR_STATE     where the supervisor publishes its checksum
#   HH_PUBLIC_URL           the public address
#   HH_BUNDLE_ROOT          the checkout whose bundle is served
set -uo pipefail

# launchd and cron both start with a minimal PATH; node lives in a user-local
# directory, so without this every check below fails with "command not found".
export PATH="/Users/adhyathmika/local/node-v24.16.0-darwin-arm64/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# This script, and the library it uses, are found relative to THIS file rather
# than by an absolute path into the repository.
#
# WHY: the quality gate exports the staged index to a temporary directory and
# runs the tests there, so that a commit is checked on its own and not on
# whatever another agent happens to have in flight. A hard-coded path quietly
# undoes that — the exported check-live.sh would source the WORKING TREE's
# library, so the gate would test a mix of two different commits and fail for
# a change that was never made. That is not a theory: this exact mix failed
# the gate during a debugging pass, on a commit that did not touch the library
# at all.
#
# WHY THE ROOT IS DERIVED RATHER THAN HARDCODED: the defaults below — the
# bridge's directory and the supervisor's script — describe the app being
# checked, so an exported copy has to describe ITS OWN app, not the one in
# the working tree.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"

. "$SCRIPT_DIR/lib/live-state.sh"

BRIDGE_PORT="${HH_BRIDGE_PORT:-8789}"
BRIDGE_DIR="${HH_BRIDGE_DIR:-$ROOT/bridge/shift }"
SUPERVISOR_SCRIPT="${HH_SUPERVISOR_SCRIPT:-$ROOT/watchdog.sh}"
SUPERVISOR_STATE="${HH_SUPERVISOR_STATE:-/tmp/hh_supervisor.checksum}"
PUBLIC_URL="${HH_PUBLIC_URL:-https://narayana.tailac25b4.ts.net}"

# The checkout whose bundle the owner is served.
#
# WHY IT IS A SEPARATE VARIABLE: the bundle is built from a checkout and
# served out of it, and the check has to look at the SAME checkout the app
# was built from. A check run against a copy must say so rather than quietly
# reading the real app's bundle — the same reason the other paths here are
# overridable.
BUNDLE_ROOT="${HH_BUNDLE_ROOT:-$ROOT}"

# The launchd agent that runs the supervisor.
#
# WHY THE LABEL IS A VARIABLE AND NOT A CONSTANT BURIED IN THE TEXT: the label
# is a fact about ONE machine, and the recovery below has to name the agent
# that machine actually has. It is overridable for the same reason the rest of
# this check is — a test has to be able to point the check at a fixture.
SUPERVISOR_LABEL="${HH_SUPERVISOR_LABEL:-com.homehub.supervisor}"

bridge_state="$(live_bridge_state "$BRIDGE_PORT" "$BRIDGE_DIR")"
supervisor_state="$(live_supervisor_state "$SUPERVISOR_SCRIPT" "$SUPERVISOR_STATE")"
link_state="$(live_link_state "$PUBLIC_URL")"
bundle_state="$(live_bundle_state "$BUNDLE_ROOT")"

say() { printf '%s\n' "$*"; }

say "── the live app"
say ""
say "   bridge      $bridge_state   (127.0.0.1:$BRIDGE_PORT)"
say "   supervisor  $supervisor_state   ($SUPERVISOR_SCRIPT)"
say "   link        $link_state   ($PUBLIC_URL)"
say "   bundle      $bundle_state   ($BUNDLE_ROOT/dist vs $BUNDLE_ROOT/src)"
say ""

case "$bridge_state" in
  down) say "   the bridge is not listening — the supervisor will restart it" ;;
  stale) say "   the bridge is running OLDER code than the code on disk" ;;
  unparsable) say "   the bridge code on disk does not parse — the running bridge was left alone" ;;
  unknown)
    say "   the bridge's state could not be read — the code on disk, or the time"
    say "   the bridge started, is not something this check could see, so the app"
    say "   cannot be told apart from one that is running old code"
    ;;
esac

case "$supervisor_state" in
  unpublished)
    say "   no supervisor has published a checksum — every running supervisor is older"
    say "   than the rule that lets it notice edits to itself, so the app cannot"
    say "   keep itself current until one of them is restarted"
    ;;
  stale)
    say "   the supervisor is running a DIFFERENT copy of watchdog.sh from the one on disk"
    ;;
  orphaned)
    say "   the supervisor that published this state is gone — the one running now"
    say "   may be an older copy, so the app cannot be trusted to notice an edit"
    say "   to watchdog.sh"
    ;;
  unknown)
    say "   the supervisor's published state could not be read — the app cannot be"
    say "   told apart from one that is out of date"
    ;;
esac

case "$bundle_state" in
  stale)
    say "   the bundle the owner is served is OLDER than the source — the link is"
    say "   running an interface that is behind the code in the repository"
    ;;
  missing)
    say "   there is no bundle at all — the link has nothing to serve"
    ;;
  unknown)
    say "   the bundle's state could not be read — the app cannot be told apart"
    say "   from one that is running an old interface"
    ;;
esac

# How to put the supervisor back onto the copy of watchdog.sh on disk.
#
# WHY THIS IS HERE AND NOT ONLY IN A COMMIT MESSAGE: this check is what a
# person reads on a phone when the app is not keeping itself current, and
# "until one of them is restarted" without the command is a note to self.
#
# WHY IT IS A RESTART AND NOT A COPY: a bash script is read into memory when
# it starts, so the copy on disk cannot reach a supervisor that is already
# running. launchd brings the supervisor straight back on the copy that is on
# disk, and from then on the supervisor reloads itself whenever that copy
# changes — so this is a one-time recovery, not a recurring chore.
#
# WHY IT IS NOT RUN FROM HERE: the check only LOOKS at the app. Restarting a
# service is the caller's, and a health check that restarts the thing it is
# checking is a health check that cannot be trusted to say the app is broken.
case "$supervisor_state" in
  unpublished | stale | orphaned)
    say ""
    say "   to put the supervisor back on the code on disk:"
    say "     launchctl kickstart -k gui/\$(id -u)/$SUPERVISOR_LABEL"
    ;;
esac

# How to put the owner's link back onto the current code.
#
# WHY IT IS HERE AND NOT ONLY IN A COMMIT MESSAGE: the bundle is the half of
# the app the owner actually looks at, and NOTHING rebuilds it — the
# supervisor restarts the bridge, starts tailscale and the voice daemon, and
# never runs a build. So the command is the whole recovery, and it is the one
# part of it that cannot be worked out from the message.
#
# WHY IT IS NOT RUN FROM HERE: the check only LOOKS at the app. A health
# check that rebuilds the thing it is checking is a health check that cannot
# be trusted to say the app is broken.
case "$bundle_state" in
  stale | missing)
    say ""
    say "   to put the owner's link back onto the current code:"
    say "     npm run build"
    ;;
esac

say ""
verdict="$(live_verdict "$bridge_state" "$supervisor_state" "$link_state" "$bundle_state")"
say "   $verdict"

case "$verdict" in
  healthy) exit 0 ;;
  *) exit 1 ;;
esac
