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
#
# It exits non-zero when the app is not healthy, so it can be used by
# anything that wants to know.
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
set -uo pipefail

ROOT="/Users/adhyathmika/homehub"
export PATH="/Users/adhyathmika/local/node-v24.16.0-darwin-arm64/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

. "$ROOT/scripts/lib/live-state.sh"

BRIDGE_PORT="${HH_BRIDGE_PORT:-8789}"
BRIDGE_DIR="${HH_BRIDGE_DIR:-$ROOT/bridge/shift }"
SUPERVISOR_SCRIPT="${HH_SUPERVISOR_SCRIPT:-$ROOT/watchdog.sh}"
SUPERVISOR_STATE="${HH_SUPERVISOR_STATE:-/tmp/hh_supervisor.checksum}"
PUBLIC_URL="${HH_PUBLIC_URL:-https://narayana.tailac25b4.ts.net}"

bridge_state="$(live_bridge_state "$BRIDGE_PORT" "$BRIDGE_DIR")"
supervisor_state="$(live_supervisor_state "$SUPERVISOR_SCRIPT" "$SUPERVISOR_STATE")"
link_state="$(live_link_state "$PUBLIC_URL")"

say() { printf '%s\n' "$*"; }

say "── the live app"
say ""
say "   bridge      $bridge_state   (127.0.0.1:$BRIDGE_PORT)"
say "   supervisor  $supervisor_state   ($SUPERVISOR_SCRIPT)"
say "   link        $link_state   ($PUBLIC_URL)"
say ""

case "$bridge_state" in
  down) say "   the bridge is not listening — the supervisor will restart it" ;;
  stale) say "   the bridge is running OLDER code than the code on disk" ;;
  unparsable) say "   the bridge code on disk does not parse — the running bridge was left alone" ;;
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
esac

say ""
verdict="$(live_verdict "$bridge_state" "$supervisor_state" "$link_state")"
say "   $verdict"

case "$verdict" in
  healthy) exit 0 ;;
  *) exit 1 ;;
esac
