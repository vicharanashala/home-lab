#!/bin/bash
# "Is my MiniMax key still good?" — the one-line answer.
#
# Run it any time you wonder why House Bot is not answering:
#
#   ./scripts/check-minimax-key.sh
#
# It never prints the key. It prints one word and one sentence about what to
# do about it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/model-key.sh"

ENV_FILE="$ROOT/bridge/shift /.env"

state="$(model_key_state "$ENV_FILE")"

case "$state" in
  ok)
    echo "MiniMax key: OK — House Bot can answer."
    ;;
  broken)
    echo "MiniMax key: REJECTED by MiniMax."
    echo ""
    echo "House Bot cannot answer until this is fixed. It is not the app:"
    echo "the bridge, the supervisor and your kitchen are all fine."
    echo ""
    echo "  1. Get a current key from MiniMax."
    echo "  2. Replace MINIMAX_ACCESS_TOKEN in:"
    echo "       $ENV_FILE"
    echo "  3. Restart the bridge:"
    echo "       lsof -tiTCP:8789 | xargs kill   # the supervisor brings it back"
    echo ""
    echo "Then run this script again."
    ;;
  *)
    echo "MiniMax key: cannot tell (no key configured, or the provider did not answer)."
    echo "Check MINIMAX_ACCESS_TOKEN and MINIMAX_API_URL in:"
    echo "  $ENV_FILE"
    ;;
esac
