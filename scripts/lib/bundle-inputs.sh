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

# The files inside the input trees that are NOT inputs to the bundle.
#
# WHY THIS LIST EXISTS: macOS writes a .DS_Store into every folder it shows in
# Finder, and rewrites that file whenever the window moves — with content that
# has nothing to do with the app. A file like that never goes into the bundle
# (vite does not read it), but it DOES live in src/ and public/, so the list of
# what the bundle was made from would hold its hash. The moment Finder
# touched it, the check would say the bundle was stale and the owner's link
# would be rebuilt over and over for nothing.
#
# That is the exact false alarm the content comparison was written to end: a
# file that changed while nothing about the app changed. It is not
# hypothetical — this checkout carries eight of them inside the input trees,
# and macOS rewrote one of them while this was being written.
#
# WHY IT IS A LIST AND NOT "EVERYTHING GIT IGNORES": public/whisper/vendor/
# is gitignored too, and those files ARE inputs to the bundle — the Whisper
# runtime is copied into it by scripts/setup-whisper-vendor.sh. Git's ignore
# list answers "what may be committed", not "what goes into the bundle", and
# the two are not the same question.
bundle_input_excludes() {
  cat <<'EOF'
.DS_Store
Thumbs.db
EOF
}

# The FILES an input path contributes, as paths relative to the checkout root.
#
# WHY THE DIRECTORY IS WALKED RATHER THAN LISTED: an input is a whole tree
# (src/), and a tree gains and loses files. A rule that watched one file would
# miss every other one, and one that watched a directory's own time would miss
# a file edited inside it.
bundle_input_files() {
  local root="$1" path file name
  # The excluded names are read ONCE, so that the walk below costs no process
  # per file — this runs on every check.
  local excludes=""
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    excludes="$excludes $name"
  done < <(bundle_input_excludes)
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -d "$root/$path" ]; then
      while IFS= read -r file; do
        [ -n "$file" ] || continue
        # WHY THE NAME IS COMPARED AND NOT THE PATH: the list holds names, so
        # "src/.DS_Store" and "public/.DS_Store" are caught by one name, and a
        # source file whose name merely CONTAINS an excluded name is not
        # caught by accident.
        case " $excludes " in
          *" ${file##*/} "*) continue ;;
        esac
        echo "$file"
      done < <( cd "$root" && find "$path" -type f 2>/dev/null )
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
    #
    # WHY THE SORT IS ASKED FOR IN THE C COLLATION: `sort` compares in the
    # shell's own locale unless it is told otherwise, and the locales do not
    # agree. "src/components/LogMealModal.tsx" comes BEFORE
    # "src/components/icons/AppIcons.tsx" under the C collation — 'L' is
    # 0x4C and 'i' is 0x69 — and AFTER it under en_US.UTF-8, which does not
    # put a capital before a small letter. The same file list, in a different
    # order, is a different list.
    #
    # WHY THAT MATTERS: the build writes this list and the check compares
    # against it, and they do not have to run in the same locale. A build run
    # from a shell that has LANG=en_US.UTF-8 — which is what a login shell on
    # this machine gives — writes the list in one order, and a check run from
    # a plain non-interactive shell, which has no LANG at all and collates in
    # C, reads it in another. The lists hold the same files with the same
    # hashes, and the comparison says they are different.
    #
    # And the answer it gives is "stale": the bundle is reported behind the
    # source when it is not, the verdict says unhealthy, and the owner's link
    # is rebuilt over and over for nothing — the exact false alarm the
    # content comparison was written to end, in a new place.
    #
    # WHY C: it is the one collation that is the same in every environment,
    # because it compares the bytes and knows nothing about language.
    files="$(bundle_input_files "$root" | LC_ALL=C sort)"
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

