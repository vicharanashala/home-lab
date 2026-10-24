#!/bin/bash
# HomeHub supervisor — keeps the app alive, for good.
#
# WHY THIS IS A LOOP NOW (it used to be a one-shot script):
# The services kept dying silently. The bridge log simply stopped mid-request
# with no crash trace, which is a clean external kill, not a crash. Nothing
# restarted them, so the link went dead until someone noticed. A one-shot
# watchdog cannot fix that; only something that keeps watching can.
#
# WHY IT LIVES IN ~/homehub AND NOT ~/Desktop:
# macOS treats ~/Desktop as privacy-protected. A launchd agent cannot read or
# execute anything inside it, so every watchdog installed there failed
# silently with "Operation not permitted" — which is why the app could never
# be supervised while it lived on the Desktop.
#
# CLOUDFLARED IS GONE ON PURPOSE:
# The quick tunnel handed out a new random hostname on every restart and lost
# the saved link repeatedly. Tailscale Serve owns the hostname now and restores
# it on boot without help from this script.

set -u
ROOT="/Users/adhyathmika/homehub"

# launchd starts agents with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
# Node lives in a user-local directory, so without this the supervisor runs
# happily and fails to start the bridge every single time — which looks
# exactly like "the app refuses to stay up".
export PATH="/Users/adhyathmika/local/node-v24.16.0-darwin-arm64/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

BRIDGE_DIR="$ROOT/bridge/shift "
BRIDGE_PORT=8789
VOICE_PORT=8790
URL="https://narayana.tailac25b4.ts.net"
LOG="/tmp/hh_supervisor.log"
INTERVAL=20

# Where the services this supervisor starts write their logs.
#
# WHY THESE ARE VARIABLES AND NOT JUST PATHS IN THE STARTERS: the bridge's
# log is the one an owner reads when the app misbehaves, so the path cannot be
# scattered — and a test has to be able to point the starters somewhere that
# is not the live log of the service that is running right now.
BRIDGE_LOG="/tmp/hh_bridge.log"
VOICE_LOG="/tmp/tts_daemon.log"

# Where this supervisor writes down the checksum of the copy of watchdog.sh
# that is running. See the write below for why anything outside needs to know.
SUPERVISOR_STATE="/tmp/hh_supervisor.checksum"

NODE_BIN="/Users/adhyathmika/local/node-v24.16.0-darwin-arm64/bin/node"
TTS_PY="$HOME/tools/python/bin/python3.12"
TTS_SERVER="$HOME/tools/tts/speak_server.py"

# The rule that decides whether the bridge is running the code on disk. It
# lives in its own file because this script is a loop that never returns, and
# a rule that decides whether the app restarts has to be able to be tested.
# See scripts/lib/bridge-stale.sh for why it is there at all.
. "$ROOT/scripts/lib/bridge-stale.sh"

# The rule that decides whether THIS supervisor is running the copy of this
# script that is on disk. Same reason it is its own file: this script is a
# loop that never returns, so a rule written inside it cannot be tested.
# See scripts/lib/supervisor-reload.sh for why it is there at all.
. "$ROOT/scripts/lib/supervisor-reload.sh"

# Only one supervisor may restart the bridge at a time. launchd has left more
# than one copy of this script running over the years, and every copy runs
# this loop.
RESTART_LOCK="/tmp/hh_bridge_restart.lock"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# This script, as an absolute path, and the checksum of the code that is
# running.
#
# WHY THE PATH IS MADE ABSOLUTE: the reload below replaces this process with
# a fresh copy of the script, and `exec` needs a path that does not depend on
# where the process happens to be standing.
#
# WHY THE CHECKSUM IS RECORDED: a bash script is read into memory when it
# starts, and this one is a `while true` loop, so the whole loop is parsed
# ONCE and this process keeps running that copy for ever. Editing watchdog.sh
# on disk does nothing to the supervisor that is already running it — which is
# how the stale-bridge rule above sat in this file, committed and tested, and
# was never executed by any of the supervisors alive at the time.
#
# WHY THE CHECKSUM COVERS THE RULE LIBRARIES AND NOT ONLY THIS FILE: the
# rules this supervisor applies live in scripts/lib/ and are SOURCED from
# there. A checksum of this file alone cannot see an edit to a rule, so the
# supervisor would go on applying the old rule for ever — the same defect as
# the one above, one level down. The rule library works out the whole set and
# checksums all of it; see supervisor_watched_sum.
SELF_PATH="$0"
case "$SELF_PATH" in
  /*) ;;
  *) SELF_PATH="$PWD/$SELF_PATH" ;;
esac
SELF_LOADED_SUM="$(supervisor_watched_sum "$SELF_PATH")"

# Write down the checksum of the copy that is running, so that anything
# watching the app from OUTSIDE can tell whether the supervisor is on the
# current code.
#
# WHY THIS IS WRITTEN OUT AT ALL: a process's start time cannot answer that
# question. `exec` — which is how the supervisor reloads itself — replaces
# the process image but keeps the start time, so a supervisor that has
# already reloaded looks exactly like one that never did. The checksum of the
# copy that is running is the only thing that tells the two apart, and
# nothing outside this process can work it out.
#
# WHY IT IS THE WHOLE STORY WHEN IT IS MISSING: the file is written by the
# copy of watchdog.sh that knows to write it. A supervisor older than this
# line never writes it, and that is not a cosmetic difference: an older
# supervisor is running a loop that cannot re-read itself, so the app it
# looks after goes on serving old code for ever, silently. The check that
# reads this file says exactly that, instead of guessing.
#
# WHY THE WRITE CANNOT FAIL THE SUPERVISOR: a supervisor that stops
# supervising because it could not write a checksum is a worse app than one
# that is merely out of date. So the write is best-effort, and the cost of it
# failing is that the check says "unknown" — which it treats as not healthy.
#
# WHY IT IS DONE AGAIN IN THE LOOP BELOW: this file is written once, at
# start-up, and anything that tidies /tmp takes it away — after which the
# check says "unpublished" for ever, even though this supervisor is running
# the right code. The rule lives in the library so it can be tested, and the
# loop below calls it once a round so the file comes back on its own.
supervisor_publish_state "$SELF_PATH" "$SELF_LOADED_SUM" "$SUPERVISOR_STATE" || true

# Each starter is written out in full, with no "$@" forwarding. An earlier
# version passed the log path positionally and read the wrong argument, so the
# redirect landed on index.mjs and truncated the bridge to zero bytes. Literal
# calls remove the whole class of mistake, and every redirect below targets
# /tmp — never a path inside the project.
#
# WHY THE STARTERS EXEC INSTEAD OF FORKING: `( cmd & )` forks a subshell to
# run the command, and bash keeps that subshell alive until the command
# finishes. The subshell's command line is the supervisor's own command line
# — it is the same script, running the same file — so it is indistinguishable
# from a second supervisor in `ps`.
#
# MEASURED ON THE LIVE MACHINE: there were three `bash watchdog.sh` processes
# and exactly ONE supervisor. The other two were the bridge's and the voice
# daemon's subshells, each holding its service as a child. A debugger that
# reads the process list then draws its conclusions about the wrong process —
# which is exactly what happened here: PID 41146 was sampled as if it were
# the supervisor, and it is not; it is the bridge's subshell.
#
# `exec` replaces the subshell with the service itself, so nothing is left
# behind: the service's parent is the supervisor, and the process list says
# what it means.
start_bridge() {
  ( cd "$BRIDGE_DIR" && exec nohup "$NODE_BIN" index.mjs \
      > "$BRIDGE_LOG" 2>&1 < /dev/null ) >/dev/null 2>&1 &
}

start_voice() {
  ( cd "$HOME" && exec nohup "$TTS_PY" "$TTS_SERVER" "$VOICE_PORT" \
      > "$VOICE_LOG" 2>&1 < /dev/null ) >/dev/null 2>&1 &
}

log "supervisor started (root=$ROOT)"

# WHY THIS IS SAID OUT LOUD: a supervisor that cannot checksum its own file
# can never tell that it is out of date, so it would sit on its copy for ever
# and the rule above would look like it had been installed and did nothing.
# That has to be visible in the log, not something to find out later.
if [ -z "$SELF_LOADED_SUM" ]; then
  log "could not checksum $SELF_PATH — this supervisor will not notice later edits to itself"
fi

while true; do
  # ── This script ───────────────────────────────────────────────────────────
  # Is this supervisor running the copy of watchdog.sh that is on disk?
  #
  # WHY THIS IS HERE: a bash script is read into memory when it starts, so the
  # supervisors running today kept the watchdog.sh they started with — the one
  # from before the stale-bridge rule was committed. That rule was correct,
  # tested, and INERT: the bridge went on serving code from hours earlier
  # while every check stayed green, which is the quietest kind of broken.
  #
  # So the supervisor has to be able to pick up its own file, the same way the
  # bridge rule makes the bridge pick up its own file.
  #
  # WHY IT IS EXEC AND NOT A RE-SOURCE: an exec replaces this process
  # outright, so the new copy runs from its first line with none of the old
  # one left. The PID is unchanged, so launchd still owns the same process.
  supervisor_reload_if_changed "$SELF_PATH" "$SELF_LOADED_SUM" log

  # ── Say which copy of this script is running ──────────────────────────────
  # The check that reads the app from outside can only tell whether this
  # supervisor is on the current code by reading the checksum this supervisor
  # writes down.
  #
  # WHY IT IS REPEATED EVERY ROUND: the file is written once at start-up, and
  # it lives in /tmp — so anything that tidies /tmp takes it away, and from
  # then on the check says "unpublished" for ever and blames the app for a
  # file the supervisor is perfectly able to write again. Writing it once a
  # round puts it back within seconds, and keeps its mtime fresh so that
  # nothing tidying /tmp has a reason to take it.
  supervisor_publish_state "$SELF_PATH" "$SELF_LOADED_SUM" "$SUPERVISOR_STATE" || true

  # ── Tailscale ────────────────────────────────────────────────────────────
  # Without it the hostname does not resolve at all, so every request 502s
  # even though the app server is perfectly healthy.
  if ! tailscale status >/dev/null 2>&1 || \
     tailscale status 2>/dev/null | grep -q "no current Tailscale IPs"; then
    log "tailscale down — starting"
    tailscale up >/dev/null 2>&1
  fi

  # ── App bridge ───────────────────────────────────────────────────────────
  if ! listening "$BRIDGE_PORT"; then
    log "bridge down — restarting"
    start_bridge
    sleep 5
    if listening "$BRIDGE_PORT"; then log "bridge back up"; else log "bridge FAILED"; fi
  else
    # The bridge is ALIVE. Is it running the code that is on disk?
    #
    # WHY THIS IS HERE: the bridge was restarted only when the port died, so
    # a committed change to the bridge never reached the app until the
    # bridge happened to crash for some other reason. Every check was green
    # and the fix was not running — the quietest kind of broken. The
    # overwatch CLI resolution is the example: committed at 19:21, and the
    # bridge serving the link had been running since 14:34, so every
    # overwatch call still died with the very error the commit had fixed.
    #
    # WHY THE STATES ARE SEPARATE: "the code on disk does not parse" and
    # "the bridge is up to date" both mean do not restart, but only one of
    # them is a problem worth saying out loud. A file being written right now
    # does not parse, and restarting the bridge onto it would take the app
    # down — so the running bridge is left alone, and it is said so.
    state="$(bridge_code_state "$BRIDGE_PORT" "$BRIDGE_DIR")"
    case "$state" in
      stale)
        if bridge_take_restart_lock "$RESTART_LOCK"; then
          log "bridge is running older code — restarting it onto the code on disk"
          bridge_restart "$BRIDGE_PORT" "$BRIDGE_DIR" "$NODE_BIN" "$BRIDGE_LOG"
          sleep 5
          if listening "$BRIDGE_PORT"; then
            log "bridge back up on the current code"
          else
            log "bridge FAILED to come back on the current code"
          fi
          bridge_release_restart_lock "$RESTART_LOCK"
        else
          log "another supervisor is restarting the bridge — leaving it to them"
        fi
        ;;
      unparsable)
        log "bridge code on disk does not parse — leaving the running bridge alone"
        ;;
      unknown)
        log "the bridge's state could not be read — leaving the running bridge alone"
        ;;
    esac
  fi

  # ── Voice daemon ─────────────────────────────────────────────────────────
  # Kokoro holds an 80M-parameter model resident; loading it costs ~9s, so it
  # runs as a long-lived daemon rather than per request.
  if ! curl -s -m 3 "http://127.0.0.1:$VOICE_PORT/health" >/dev/null 2>&1; then
    if [ -x "$TTS_PY" ] && [ -f "$TTS_SERVER" ]; then
      log "voice daemon down — starting (model load ~10s)"
      start_voice
    fi
  fi

  sleep "$INTERVAL"
done
