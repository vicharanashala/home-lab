#!/bin/bash
# Scan a diff for values taken from real env files.
#
# WHY THIS IS ITS OWN FILE: the scan has to be testable on its own. The
# quality gate runs against the staged index of the real repository, so a
# bug in the scan cannot be shown by running the gate — it can only be
# shown by calling the scan directly with a known input.
#
# THE TRAP THIS FILE EXISTS TO AVOID
# The obvious way to write the scan is
#
#     if cat "$diff_file" | grep -qF -- "$value"; then
#
# and it fails open. `grep -q` stops reading at the first match, so the
# writer is killed with SIGPIPE — and because the gate runs under
# `set -o pipefail`, the pipeline's status becomes 141 (the writer's death)
# rather than grep's 0. The `if` then reads "not found" for a diff that
# plainly contains the secret, and the commit sails through.
#
# It only bites when the diff is bigger than the pipe buffer AND the
# secret is not at the very end — which is exactly the case that matters:
# a large commit is where a pasted key is most likely to be hiding.
#
# So the scan never pipes the diff into grep. grep reads the file itself,
# there is no writer to lose, and the answer is the same every time.

# leak_scan <diff-file> <env-file>...
#
# Prints one line per leaked key. Returns 1 when something leaked.
leak_scan() {
  local diff_file="$1"
  shift
  local leaked=0
  local env_file secret key value

  for env_file in "$@"; do
    [ -f "$env_file" ] || continue
    while IFS= read -r secret; do
      key="${secret%%=*}"
      value="${secret#*=}"
      # Skip blank, placeholder and too-short values — they cause false positives.
      case "$value" in
        ""|changeme*|your-*|example*|placeholder*) continue ;;
      esac
      [ "${#value}" -lt 8 ] && continue
      # grep reads the diff itself, so there is no writer for SIGPIPE to
      # take down and `pipefail` has nothing to misreport.
      if grep -qF -- "$value" "$diff_file"; then
        printf '     %s (value from %s)\n' "$key" "$env_file"
        leaked=1
      fi
    done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$env_file" 2>/dev/null)
  done

  return $leaked
}
