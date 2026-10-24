#!/bin/bash
# HomeHub launcher — double-click this.
#
# Why it exists: HomeHub only runs while three things run — Tailscale, the app
# bridge, and the local voice daemon. On this Mac they do not survive sleep or
# a reboot, so the link quietly stops working and there is nothing on screen
# that says why. Double-clicking this brings all three back and opens the app.
#
# Set HH_NO_OPEN=1 to start everything without opening a browser.

set -u
ROOT="/Users/adhyathmika/homehub"
URL="https://narayana.tailac25b4.ts.net"
BRIDGE_PORT=8789
VOICE_PORT=8790

say() { printf '%s\n' "$*"; }

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# ── 1. Tailscale: without it the hostname does not resolve at all ────────
if pgrep -x tailscaled >/dev/null 2>&1 && tailscale status 2>/dev/null | grep -q "no current Tailscale IPs"; then
  say "Starting Tailscale…"
  tailscale up >/dev/null 2>&1
  sleep 4
fi

# ── 2. App bridge: serves the site and proxies every API call ────────────
if listening "$BRIDGE_PORT"; then
  say "App server: already running"
else
  say "Starting the app server…"
  # `exec` and not a plain background job: a forked subshell would stay alive
  # holding the bridge, with the same command line as the supervisor, and the
  # process list would then show a supervisor that is not one.
  ( cd "$ROOT/bridge/shift " 2>/dev/null && exec nohup node index.mjs > /tmp/hh_bridge.log 2>&1 < /dev/null ) >/dev/null 2>&1 &
  sleep 5
fi

# ── 3. Voice daemon: Kokoro holds an 80M model in memory, so it stays
#       resident rather than paying ~9s to load on every reply ─────────────
if curl -s -m 3 "http://127.0.0.1:$VOICE_PORT/health" >/dev/null 2>&1; then
  say "Voice: already running"
elif [ -x "$HOME/tools/python/bin/python3.12" ] && [ -f "$HOME/tools/tts/speak_server.py" ]; then
  say "Starting the voice engine (takes ~10s to load its model)…"
  nohup "$HOME/tools/python/bin/python3.12" "$HOME/tools/tts/speak_server.py" "$VOICE_PORT" \
    > /tmp/tts_daemon.log 2>&1 < /dev/null &
else
  say "Voice engine not installed — House Bot will fall back to the browser voice."
fi

# ── 4. Confirm, then open ────────────────────────────────────────────────
sleep 3
if curl -s -o /dev/null -m 12 "$URL"; then
  say ""
  say "HomeHub is up:  $URL"
  [ "${HH_NO_OPEN:-0}" = "1" ] || open "$URL"
else
  say ""
  say "HomeHub is NOT reachable yet."
  say "If this Mac just woke up, give it a few seconds and run this again."
  say "Details: /tmp/hh_bridge.log"
fi

say ""
say "Press any key to close this window."
read -n 1 -s