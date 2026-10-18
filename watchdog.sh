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

NODE_BIN="/Users/adhyathmika/local/node-v24.16.0-darwin-arm64/bin/node"
TTS_PY="$HOME/tools/python/bin/python3.12"
TTS_SERVER="$HOME/tools/tts/speak_server.py"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Each starter is written out in full, with no "$@" forwarding. An earlier
# version passed the log path positionally and read the wrong argument, so the
# redirect landed on index.mjs and truncated the bridge to zero bytes. Literal
# calls remove the whole class of mistake, and every redirect below targets
# /tmp — never a path inside the project.
start_bridge() {
  ( cd "$BRIDGE_DIR" && nohup "$NODE_BIN" index.mjs \
      > /tmp/hh_bridge.log 2>&1 < /dev/null & )
}

# A second instance on 8777, the port Whisper Pad uses.
#
# WHY: a browser's microphone grant is stored PER ORIGIN, and the port is part
# of the origin. The user has already granted the microphone to
# http://localhost:8777 for Whisper Pad, so serving HomeHub there too means the
# mic works immediately in HomeHub with no padlock fiddling and no new prompt.
# 8789 stays as it is because that is what Tailscale Serve proxies to.
start_bridge_voice() {
  ( cd "$BRIDGE_DIR" && PORT=8777 nohup "$NODE_BIN" index.mjs \
      > /tmp/hh_bridge_8777.log 2>&1 < /dev/null & )
}

start_voice() {
  ( cd "$HOME" && nohup "$TTS_PY" "$TTS_SERVER" "$VOICE_PORT" \
      > /tmp/tts_daemon.log 2>&1 < /dev/null & )
}

log "supervisor started (root=$ROOT)"

while true; do
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
  fi

  # ── Voice-capable origin ─────────────────────────────────────────────────
  # Same app on 8777 so the microphone grant Whisper Pad already has applies
  # here too. Skipped if that port is taken, which is fine — it just means
  # Whisper Pad is running.
  if ! listening "8777"; then
    log "starting the 8777 voice origin"
    start_bridge_voice
    sleep 4
    if listening "8777"; then log "8777 up"; else log "8777 failed (port may be in use)"; fi
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