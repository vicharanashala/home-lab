#!/bin/bash
# The files that go into the bundle, and the list the build leaves behind so
# the live check can tell a bundle that is behind the source from one that was
# built from exactly this source and merely touched since.
#
# WHY THIS IS ITS OWN FILE: the build and the check have to agree on what goes
# into the bundle. Two lists that drift apart would mean the check watches
# files the build never used, or ignores files it did — and either way it
# answers a question nobody asked.
#
# WHY THE ENV FILES ARE NOT IN THE LIST: they hold the bridge token, and the
# bundle is served to the owner's phone. Their contents are never hashed and
# never written down anywhere the bridge can serve, so the check judges them by
# their TIME, exactly as it did before.
#
# WHY THE TIMES ALONE ARE NOT ENOUGH
# The rule used to compare times and nothing else, which made it wrong in BOTH
# directions:
#
#   a file written again with the SAME content — an agent reverting an
#   experiment, a formatter rewriting a file it did not change — looked
#   exactly like a file that was edited, so the bundle was reported stale for
#   ever and the owner's link was rebuilt over and over for nothing;
#
#   and a file whose content DID change but whose time was put back — a copy
#   that keeps its times, a tool that restores them — looked untouched, so a
#   bundle that really was behind the source was reported current. That one
#   is the worse of the two: the owner is served an old interface and the
#   check says healthy.
#
# So the build leaves behind a list of what it read, and the check compares
# the CONTENT against that list. The times still decide the env files, whose
# contents must never be read.

# The paths whose contents go into the bundle, relative to the checkout root.
bundle_input_paths() {
  cat <<'EOF'
src
public
index.html
vite.config.ts
tailwind.config.js
postcss.config.js
package.json
package-lock.json
EOF
}

# The env files, which reach the bundle only through their VITE_* values.
bundle_env_paths() {
  cat <<'EOF'
.env
.env.local
.env.production
.env.production.local
EOF
}

# The FILES an input path contributes, as paths relative to the checkout root.
#
# WHY THE DIRECTORY IS WALKED RATHER THAN LISTED: an input is a whole tree
# (src/), and a tree gains and loses files. A rule that watched one file would
# miss every other one, and one that watched a directory's own time would miss
# a file edited inside it.
bundle_input_files() {
  local root="$1" path
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -d "$root/$path" ]; then
      ( cd "$root" && find "$path" -type f 2>/dev/null )
    elif [ -f "$root/$path" ]; then
      echo "$path"
    fi
  done < <(bundle_input_paths)
}

# The manifest: one line per file that goes into the bundle, in the form
#
#     <64-character sha256> <two spaces> <path relative to the checkout root>
#
# WHY THE PATH IS NOT QUOTED OR ESCAPED: the hash is a fixed width, so the
# path is everything after it, and it can hold spaces without any escaping.
# The manifest is only ever compared — never shown, never logged, never
# served (it is a dotfile, and the bridge's static mount ignores dotfiles).
#
# WHY TWO SPACES: that is the shape `shasum` prints, so the list the build
# writes and the list the check computes are the same shape by construction
# rather than by two formats happening to agree.
bundle_manifest_lines() {
  local root="$1"
  (
    cd "$root" || exit 1
    local files
    files="$(bundle_input_files "$root" | sort)"
    [ -n "$files" ] || exit 0
    # WHY ONE PROCESS FOR ALL THE FILES: a rule that runs a hash per file
    # spawns a process per file, and this runs on every check.
    printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 shasum -a 256 2>/dev/null
  )
}

# How many files go into the bundle.
#
# WHY THE COUNT IS ASKED FOR SEPARATELY: a file that cannot be hashed is
# simply ABSENT from the hash list — `shasum` prints nothing for it. Two
# lists that both lack the file would then match, and the check would call a
# bundle current on the strength of a file neither of them could read. The
# count says whether one is missing.
bundle_input_count() {
  local root="$1"
  bundle_input_files "$root" | grep -c ''
}

