#!/bin/bash
# Is the model key still good?
#
# WHY THIS IS ITS OWN FILE: the supervisor is a loop that never returns, so a
# rule written inside it cannot be run from a test. "Can the app still talk
# to its model?" is a decision, and a decision that decides what the
# supervisor says belongs where it can be checked.
#
# THE FAILURE THIS EXISTS FOR
# The MiniMax key stopped working — the provider answered 401 "auth failed" —
# and House Bot went mute while the app, the bridge, the supervisor and the
# owner's own data were all perfectly healthy. The header still said "online"
# in green, because it was a string in the code and not a question asked of
# anything.
#
# Nothing here can fix a rejected key. What it can do is say so out loud, in
# the log the owner reads, instead of leaving it to be noticed.
#
# THE TOKEN NEVER APPEARS IN THE OUTPUT. This function prints one of three
# words. The token is read from the env file, put in a request header, and
# dropped.

# model_key_state <env_file>
#
# Prints exactly one of:
#   ok       the provider accepted the key
#   broken   the provider rejected it
#   unknown  there is no key, no URL, or the provider did not answer
#
# "unknown" is a real answer and not a failure: a network hiccup is not the
# same as a rejected key, and the two must not be confused.
model_key_state() {
  local env_file="$1"
  [ -f "$env_file" ] || { echo unknown; return 0; }

  local url token
  url="$(sed -n 's/^MINIMAX_API_URL=//p' "$env_file" | head -1 | tr -d '\r')"
  token="$(sed -n 's/^MINIMAX_ACCESS_TOKEN=//p' "$env_file" | head -1 | tr -d '\r')"
  [ -n "$url" ] || { echo unknown; return 0; }
  [ -n "$token" ] || { echo unknown; return 0; }

  # One token of output. The body is held in a variable and never printed.
  local body
  body="$(curl -s -m 20 -X POST "$url" \
    -H 'Content-Type: application/json' \
    -H 'anthropic-version: 2023-06-01' \
    -H "Authorization: Bearer $token" \
    -d '{"model":"MiniMax-M3","max_tokens":1,"messages":[{"role":"user","content":"."}]}' \
    2>/dev/null || true)"

  [ -n "$body" ] || { echo unknown; return 0; }

  # The provider's words for a rejected key, in the shapes it uses them:
  # the agent endpoint says {"code":401,"message":"auth failed"} and the
  # older one says {"base_resp":{"status_code":1004,"status_msg":"login fail"}}.
  case "$body" in
    *401*|*'auth failed'*|*'login fail'*) echo broken ;;
    *) echo ok ;;
  esac
}
