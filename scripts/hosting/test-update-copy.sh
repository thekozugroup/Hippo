#!/usr/bin/env bash
# End-to-end tests for scripts/hosting/update-copy.sh (npm run test:hosting).
#
# Builds real throwaway Git repositories in a temporary folder: an "original" project with main and
# stable branches, and copies of it made the way Vercel's button makes them (one unrelated commit,
# no .github), with their own workflow file, and as forks with shared history. Each scenario runs
# the updater against a bare "origin" for the copy, so pushes are real too.

set -uo pipefail
export LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
unset GITHUB_STEP_SUMMARY GITHUB_REPOSITORY GITHUB_ACTOR GITHUB_ACTOR_ID HIPPO_UPSTREAM HIPPO_CHANNEL \
  HIPPO_REPLACE HIPPO_DRY_RUN HIPPO_UPSTREAM_URL HIPPO_AUTHOR_NAME HIPPO_AUTHOR_EMAIL HIPPO_PUSH

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/update-copy.sh"
TEMPLATE="$HERE/hippo-update.yml"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/hippo-update-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ORIG="$WORK/original.git" # the original project, as fetched by copies

PASSED=0
FAILED=0
SCENARIO=""
scenario() { SCENARIO="$1"; printf '\n%s\n' "$1"; }
pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ -n "${OUT:-}" ] && printf '%s\n' "$OUT" | sed 's/^/       | /'; }
# check DESCRIPTION 'CONDITION': the condition is shell code, evaluated when the check runs.
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
contains() { printf '%s' "$1" | grep -qF -- "$2"; }

MAINTAINER=(GIT_AUTHOR_NAME="Hippo Maintainer" GIT_AUTHOR_EMAIL="maintainer@example.org" GIT_COMMITTER_NAME="Hippo Maintainer" GIT_COMMITTER_EMAIL="maintainer@example.org")
OWNER_NAME="Copy Owner"
OWNER_EMAIL="123+owner@users.noreply.github.com"
as_maintainer() { env "${MAINTAINER[@]}" "$@"; }
as_owner() { env GIT_AUTHOR_NAME="$OWNER_NAME" GIT_AUTHOR_EMAIL="$OWNER_EMAIL" GIT_COMMITTER_NAME="$OWNER_NAME" GIT_COMMITTER_EMAIL="$OWNER_EMAIL" "$@"; }

# ------------------------------------------------------------------------------------- the original

DEV="$WORK/original-dev"
git init -q -b main "$DEV"
mkdir -p "$DEV/src" "$DEV/docs" "$DEV/.github/workflows" "$DEV/scripts/hosting" "$DEV/public"
printf '{\n  "name": "hippo",\n  "version": "0.1.4",\n  "private": true\n}\n' > "$DEV/package.json"
printf 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\n' > "$DEV/src/app.txt"
printf 'one\ntwo\nthree\n' > "$DEV/src/rename-me.txt"
printf 'old doc\n' > "$DEV/docs/old.md"
printf 'name: CI\n' > "$DEV/.github/workflows/ci.yml"
cp "$SCRIPT" "$DEV/scripts/hosting/update-copy.sh"
cp "$TEMPLATE" "$DEV/scripts/hosting/hippo-update.yml"
git -C "$DEV" add -A
as_maintainer git -C "$DEV" commit -q -m "First version"
git init -q --bare -b main "$ORIG"
git -C "$DEV" remote add origin "$ORIG"
git -C "$DEV" push -q origin main main:stable
V1="$(git -C "$DEV" rev-parse HEAD)"

# The original's next changes: every kind of file change, a WIP commit and a .github change.
advance_original() {
  (
    cd "$DEV" || exit 1
    printf 'new file\n' > src/new.txt && git add src/new.txt && as_maintainer git commit -q -m "Add a new file"
    git rm -q docs/old.md && as_maintainer git commit -q -m "Remove the old doc"
    git mv src/rename-me.txt src/renamed.txt && as_maintainer git commit -q -m "Rename a file"
    head -c 3000 /dev/urandom > public/picture.bin && printf '\000\377\000' >> public/picture.bin && git add public/picture.bin && as_maintainer git commit -q -m "Add a picture"
    mkdir -p docs && printf 'spaces\n' > "docs/a file with spaces.md" && git add "docs/a file with spaces.md" && as_maintainer git commit -q -m "Add a file with spaces in its name"
    printf 'name: CI\non: push\n' > .github/workflows/ci.yml && printf 'name: New\n' > .github/workflows/new.yml && git add .github && as_maintainer git commit -q -m "Change the workflows"
    sed -i 's/line 2/line 2 from the original/' src/app.txt && as_maintainer git commit -q -am "WIP: try something"
    sed -i 's/"version": "0.1.4"/"version": "0.2.0"/' package.json && as_maintainer git commit -q -am "Set version 0.2.0"
    git push -q origin main main:stable
  )
}

# A copy made like Vercel's button: the original's files without .github, as one unrelated commit by
# the owner, committed by Vercel. $1 = name, $2 = original commit. Prints the working folder.
button_copy() {
  local name="$1" from="$2" dir="$WORK/$1"
  git init -q --bare -b main "$WORK/$name.git"
  git init -q -b main "$dir"
  git -C "$DEV" archive "$from" | tar -x -C "$dir"
  rm -rf "$dir/.github"
  git -C "$dir" add -A
  env GIT_AUTHOR_NAME="$OWNER_NAME" GIT_AUTHOR_EMAIL="$OWNER_EMAIL" GIT_COMMITTER_NAME="Vercel Commit" GIT_COMMITTER_EMAIL="280517648+vercel-commit@users.noreply.github.com" \
    git -C "$dir" commit -q -m "Initial commit"
  git -C "$dir" remote add origin "$WORK/$name.git"
  git -C "$dir" push -q -u origin main
  printf '%s\n' "$dir"
}

# A fork: shares the original's history (and its .github). $1 = name, $2 = original commit.
fork_copy() {
  local name="$1" from="$2" dir="$WORK/$1"
  git clone -q "$ORIG" "$dir"
  git -C "$dir" checkout -q -B main "$from"
  git init -q --bare -b main "$WORK/$name.git"
  git -C "$dir" remote set-url origin "$WORK/$name.git"
  git -C "$dir" push -q -u origin main
  printf '%s\n' "$dir"
}

install_workflow() {
  mkdir -p "$1/.github/workflows"
  cp "$TEMPLATE" "$1/.github/workflows/hippo-update.yml"
  git -C "$1" add .github && as_owner git -C "$1" commit -q -m "Turn on automatic updates" && git -C "$1" push -q origin main
}

# Runs the updater in copy $1 against the original's channel (default stable). Extra env as more args.
OUT=""
CODE=0
run_update() {
  local dir="$1" channel="${CHANNEL:-stable}"
  shift
  git -C "$dir" fetch -q --no-tags -- "$ORIG" "$channel"
  OUT="$(cd "$dir" && env HIPPO_UPSTREAM_URL="$ORIG" HIPPO_CHANNEL="$channel" HIPPO_UPSTREAM="$(git rev-parse FETCH_HEAD)" "$@" bash "$SCRIPT" 2>&1)"
  CODE=$?
}

head_of() { git -C "$1" rev-parse HEAD; }
stripped_tree() { git -C "$1" ls-tree "$2" | grep -v -P '\t\.(github|hippo)$' | git -C "$1" mktree; }
stripped_tree_orig() { git --git-dir="$ORIG" ls-tree "$1" | grep -v -P '\t\.(github|hippo)$' | git --git-dir="$ORIG" mktree; }
same_files_as_stable() { [ "$(stripped_tree "$1" HEAD)" = "$(stripped_tree_orig stable)" ]; }
no_github_in_last_commit() { [ -z "$(git -C "$1" diff --name-only HEAD~1 HEAD -- .github)" ]; }
clean_and_nothing_staged() { [ -z "$(git -C "$1" status --porcelain)" ] && git -C "$1" diff --cached --quiet; }
bare_main() { git --git-dir="$WORK/$1.git" rev-parse main; }

# ---------------------------------------------------------------------------------------- scenarios

scenario "Button-style copy, first run, nothing new"
A="$(button_copy copy-a "$V1")"
before="$(head_of "$A")"
run_update "$A"
check "exits 0" '[ "$CODE" -eq 0 ]'
check "says it is up to date" 'contains "$OUT" "Hippo is up to date (0.1.4)"'
check "makes no commit" '[ "$(head_of "$A")" = "$before" ]'

scenario "Copy with its own workflow file, first run, nothing new"
B="$(button_copy copy-b "$V1")"
install_workflow "$B"
before="$(head_of "$B")"
run_update "$B"
check "exits 0 and says up to date" '[ "$CODE" -eq 0 ] && contains "$OUT" "up to date"'
check "makes no commit" '[ "$(head_of "$B")" = "$before" ]'

scenario "Copies made before the original changes (customised and to be checked later)"
C="$(button_copy copy-c "$V1")" # edits that merge cleanly
sed -i 's/line 7/line 7 changed by the owner/' "$C/src/app.txt"
sed -i 's/two/two changed by the owner/' "$C/src/rename-me.txt"
git -C "$C" add -A && as_owner git -C "$C" commit -q -m "My own changes" && git -C "$C" push -q origin main
D="$(button_copy copy-d "$V1")" # an edit on the line the original also changes
install_workflow "$D"
sed -i 's/line 2/line 2 changed by the owner/' "$D/src/app.txt"
git -C "$D" add -A && as_owner git -C "$D" commit -q -m "Clashing change" && git -C "$D" push -q origin main
E="$(button_copy copy-e "$V1")" # for the dry run
F="$(button_copy copy-f "$V1")" # edited in its only commit: no version matches
sed -i 's/line 5/line 5 edited before the first commit/' "$F/src/app.txt"
git -C "$F" add -A && env GIT_AUTHOR_NAME="$OWNER_NAME" GIT_AUTHOR_EMAIL="$OWNER_EMAIL" GIT_COMMITTER_NAME="$OWNER_NAME" GIT_COMMITTER_EMAIL="$OWNER_EMAIL" git -C "$F" commit -q --amend -m "Initial commit" && git -C "$F" push -q -f origin main
G="$(button_copy copy-g "$V1")" # its branch moves while the updater runs
H="$(fork_copy fork-h "$V1")" # a fork with an edit and the workflow
install_workflow "$H"
sed -i 's/line 8/line 8 changed in the fork/' "$H/src/app.txt"
git -C "$H" add -A && as_owner git -C "$H" commit -q -m "Fork edit" && git -C "$H" push -q origin main
I="$(fork_copy fork-i "$V1")" # an untouched fork
J="$(button_copy copy-j "$V1")" # for the summary file and the template's own commands
install_workflow "$J"

advance_original
STABLE="$(git --git-dir="$ORIG" rev-parse stable)"
STABLE_SHORT="$(git --git-dir="$ORIG" rev-parse --short=7 stable)"

scenario "Button-style copy, original moved on: added, deleted, renamed, binary, spaces, .github"
root_author="$(git -C "$A" log --format='%an <%ae>' --max-parents=0 HEAD)"
before="$(head_of "$A")"
run_update "$A"
check "exits 0" '[ "$CODE" -eq 0 ]'
check "reports the versions and the commit" 'contains "$OUT" "Updated Hippo from 0.1.4 to 0.2.0 ($STABLE_SHORT)"'
check "makes exactly one commit" '[ "$(git -C "$A" rev-list --count "$before..HEAD")" -eq 1 ]'
check "files equal the original's stable (outside .github)" 'same_files_as_stable "$A"'
check "added file is there" '[ -f "$A/src/new.txt" ]'
check "deleted file is gone" '[ ! -e "$A/docs/old.md" ]'
check "renamed file moved" '[ -f "$A/src/renamed.txt" ] && [ ! -e "$A/src/rename-me.txt" ]'
check "binary file is byte for byte the original's" 'cmp -s "$A/public/picture.bin" <(git --git-dir="$ORIG" show stable:public/picture.bin)'
check "file name with spaces is there" '[ -f "$A/docs/a file with spaces.md" ]'
check "no .github was created" '[ ! -e "$A/.github" ]'
check "nothing under .github in the commit" 'no_github_in_last_commit "$A"'
check "author is the root commit's author" '[ "$(git -C "$A" log -1 --format='\''%an <%ae>'\'')" = "$root_author" ]'
check "committer is the root commit's author too, not Vercel or a bot" '[ "$(git -C "$A" log -1 --format='\''%cn <%ce>'\'')" = "$root_author" ]'
msg="$(git -C "$A" log -1 --format=%B)"
check "message names the version and short id" 'contains "$msg" "Update Hippo to 0.2.0 ($STABLE_SHORT)"'
check "message lists the original's changes" 'contains "$msg" "- Rename a file"'
check "message skips WIP commits" '! contains "$msg" "WIP"'
check "message skips changes only to .github" '! contains "$msg" "Change the workflows"'
check "marker records the commit and channel" 'contains "$(cat "$A/.hippo/upstream")" "commit $STABLE"'
check "pushed to the copy's main as a fast-forward" '[ "$(bare_main copy-a)" = "$(head_of "$A")" ]'
check "working folder clean, nothing staged" 'clean_and_nothing_staged "$A"'

scenario "Running again right after"
before="$(head_of "$A")"
run_update "$A"
check "exits 0 and says up to date" '[ "$CODE" -eq 0 ] && contains "$OUT" "up to date (0.2.0)"'
check "makes no commit" '[ "$(head_of "$A")" = "$before" ]'

scenario "Copy with its own workflow file keeps it; the original's .github change does not arrive"
install_workflow "$E"
run_update "$E" HIPPO_DRY_RUN=true
check "dry run exits 0 and says what would happen" '[ "$CODE" -eq 0 ] && contains "$OUT" "Dry run: Hippo would be updated from 0.1.4 to 0.2.0"'
check "dry run lists a renamed file as removed and added" 'contains "$OUT" "- added: src/renamed.txt"'
check "dry run commits nothing" '[ "$(git -C "$E" log -1 --format=%s)" = "Turn on automatic updates" ]'
check "dry run pushes nothing" '[ "$(bare_main copy-e)" = "$(head_of "$E")" ]'
wf_before="$(git -C "$E" rev-parse HEAD:.github)"
run_update "$E"
check "exits 0" '[ "$CODE" -eq 0 ]'
check ".github is exactly the copy's own" '[ "$(git -C "$E" rev-parse HEAD:.github)" = "$wf_before" ]'
check "the original's workflows did not arrive" '[ ! -e "$E/.github/workflows/ci.yml" ] && [ ! -e "$E/.github/workflows/new.yml" ]'
check "files equal the original's stable" 'same_files_as_stable "$E"'

scenario "Customised copy whose edits merge cleanly (one of them in a file the original renamed)"
before="$(head_of "$C")"
run_update "$C"
check "exits 0 and says it merged" '[ "$CODE" -eq 0 ] && contains "$OUT" "merged into your edits"'
check "the owner's edit is kept" 'grep -q "line 7 changed by the owner" "$C/src/app.txt"'
check "the original's change is there" 'grep -q "line 2 from the original" "$C/src/app.txt"'
check "the edit followed the rename" 'grep -q "two changed by the owner" "$C/src/renamed.txt" && [ ! -e "$C/src/rename-me.txt" ]'
check "version moved" 'grep -q '\''"version": "0.2.0"'\'' "$C/package.json"'
check "one commit, pushed" '[ "$(git -C "$C" rev-list --count "$before..HEAD")" -eq 1 ] && [ "$(bare_main copy-c)" = "$(head_of "$C")" ]'
check "nothing under .github in the commit" 'no_github_in_last_commit "$C"'

scenario "Customised copy whose edit clashes with the original"
before="$(head_of "$D")"
run_update "$D"
check "exits 2" '[ "$CODE" -eq 2 ]'
check "lists the clashing file" 'contains "$OUT" "- src/app.txt"'
check "explains both ways out" 'contains "$OUT" "Merge by hand" && contains "$OUT" "Replace my copy with the original"'
check "changes nothing locally" '[ "$(head_of "$D")" = "$before" ] && clean_and_nothing_staged "$D"'
check "pushes nothing" '[ "$(bare_main copy-d)" = "$before" ]'

scenario "Replace switch on the clashing copy"
run_update "$D" HIPPO_REPLACE=true
check "exits 0 and says it replaced" '[ "$CODE" -eq 0 ] && contains "$OUT" "replaced with the original"'
check "files equal the original's stable" 'same_files_as_stable "$D"'
check "the copy's .github is kept" '[ -f "$D/.github/workflows/hippo-update.yml" ]'
check "the commit says edits were discarded" 'contains "$(git -C "$D" log -1 --format=%B)" "local changes outside .github were discarded"'
run_update "$D"
check "a normal run afterwards is up to date" '[ "$CODE" -eq 0 ] && contains "$OUT" "up to date"'

scenario "Copy edited before anything could be recorded: no version matches"
before="$(head_of "$F")"
run_update "$F"
check "exits 4" '[ "$CODE" -eq 4 ]'
check "explains the two choices" 'contains "$OUT" "Keep your edits" && contains "$OUT" "Replace your copy with the original"'
check "changes nothing" '[ "$(head_of "$F")" = "$before" ] && clean_and_nothing_staged "$F"'
printf 'commit %s\n' "$V1" > "$WORK/marker" && mkdir -p "$F/.hippo" && cp "$WORK/marker" "$F/.hippo/upstream"
git -C "$F" add -A && as_owner git -C "$F" commit -q -m "Record where my copy started" && git -C "$F" push -q origin main
run_update "$F"
check "with a hand-written marker it merges" '[ "$CODE" -eq 0 ] && grep -q "line 5 edited before the first commit" "$F/src/app.txt" && grep -q "line 2 from the original" "$F/src/app.txt"'

scenario "The branch moves while the updater runs"
git -C "$G" fetch -q --no-tags -- "$ORIG" stable
other="$WORK/copy-g-other"
git clone -q "$WORK/copy-g.git" "$other"
printf 'x\n' > "$other/notes.txt" && git -C "$other" add notes.txt && as_owner git -C "$other" commit -q -m "Pushed elsewhere" && git -C "$other" push -q origin main
before="$(head_of "$G")"
run_update "$G"
check "exits 3 and asks to run again" '[ "$CODE" -eq 3 ] && contains "$OUT" "Run the workflow again"'
check "leaves the local branch as it was" '[ "$(head_of "$G")" = "$before" ] && clean_and_nothing_staged "$G"'
check "never force-pushed" '[ "$(bare_main copy-g)" = "$(git -C "$other" rev-parse HEAD)" ]'

scenario "Fork with shared history, an edit of its own and the workflow"
run_update "$H"
check "exits 0" '[ "$CODE" -eq 0 ]'
check "the fork's edit and the original's change are both there" 'grep -q "line 8 changed in the fork" "$H/src/app.txt" && grep -q "line 2 from the original" "$H/src/app.txt"'
check "the fork's .github is untouched (the original's change did not arrive)" '[ "$(git -C "$H" show HEAD:.github/workflows/ci.yml)" = "name: CI" ] && [ ! -e "$H/.github/workflows/new.yml" ]'
check "author is the fork owner, not the original's maintainer" '[ "$(git -C "$H" log -1 --format='\''%an <%ae>|%cn <%ce>'\'')" = "$OWNER_NAME <$OWNER_EMAIL>|$OWNER_NAME <$OWNER_EMAIL>" ]'
check "nothing under .github in the commit" 'no_github_in_last_commit "$H"'
run_update "$H"
check "second run is up to date" '[ "$CODE" -eq 0 ] && contains "$OUT" "up to date"'

scenario "Untouched fork with no commits of its own"
run_update "$I" GITHUB_ACTOR=someone GITHUB_ACTOR_ID=42
check "exits 0 and matches stable" '[ "$CODE" -eq 0 ] && same_files_as_stable "$I"'
check "falls back to the person running the workflow" '[ "$(git -C "$I" log -1 --format='\''%ae'\'')" = "42+someone@users.noreply.github.com" ]'

scenario "Later updates start from the recorded marker"
(cd "$DEV" && printf 'later\n' > src/later.txt && git add src/later.txt && as_maintainer git commit -q -m "A later change" && git push -q origin main main:stable)
before="$(head_of "$A")"
run_update "$A"
check "exits 0 and says where it started" '[ "$CODE" -eq 0 ] && contains "$OUT" "recorded in .hippo/upstream"'
check "only the later change arrives" '[ "$(git -C "$A" diff --name-only "$before" HEAD | sort | tr '\''\n'\'' '\'' '\'')" = ".hippo/upstream src/later.txt " ]'

scenario "Copy made from main before it reached stable"
(cd "$DEV" && printf 'unreleased\n' > src/unreleased.txt && git add src/unreleased.txt && as_maintainer git commit -q -m "Not yet stable" && git push -q origin main)
K="$(button_copy copy-k "$(git -C "$DEV" rev-parse main)")"
before="$(head_of "$K")"
run_update "$K"
check "exits 0: the copy is already ahead of stable" '[ "$CODE" -eq 0 ] && contains "$OUT" "up to date"'
check "makes no commit" '[ "$(head_of "$K")" = "$before" ]'

scenario "Following a version tag instead of stable"
as_maintainer git -C "$DEV" tag -a v0.1.4 -m "v0.1.4" "$V1" && git -C "$DEV" push -q origin v0.1.4
L="$(button_copy copy-l "$V1")"
CHANNEL=v0.1.4 run_update "$L"
check "a copy at that version is up to date" '[ "$CODE" -eq 0 ] && contains "$OUT" "up to date (0.1.4)"'
CHANNEL=v0.1.4 run_update "$A"
check "a newer copy does not go back on its own" '[ "$CODE" -eq 0 ] && contains "$OUT" "up to date (0.2.0)"'
CHANNEL=v0.1.4 run_update "$A" HIPPO_REPLACE=true
check "with replace it goes back to that version" '[ "$CODE" -eq 0 ] && grep -q '\''"version": "0.1.4"'\'' "$A/package.json"'

scenario "Summary for GitHub and the template's own commands"
summary_file="$WORK/summary.md"
: > "$summary_file"
template_run="$(awk '/^        run: \|/{on=1; next} on && /^          /{sub(/^          /, ""); print; next} on{exit}' "$TEMPLATE")"
check "the template has the run commands" 'contains "$template_run" "update-copy.sh"'
mkdir -p "$WORK/runner-temp"
OUT="$(cd "$J" && env HIPPO_UPSTREAM_URL="$ORIG" HIPPO_CHANNEL=stable HIPPO_REPLACE=false HIPPO_DRY_RUN=false RUNNER_TEMP="$WORK/runner-temp" GITHUB_STEP_SUMMARY="$summary_file" bash -e -c "$template_run" 2>&1)"
CODE=$?
check "the template's commands update the copy with the script from the original" '[ "$CODE" -eq 0 ] && same_files_as_stable "$J"'
check "the summary names the versions" 'grep -q "Updated Hippo from 0.1.4 to 0.2.0" "$summary_file"'
check "the summary counts the files" 'grep -qE "[0-9]+ files? changed" "$summary_file"'
OUT="$(cd "$J" && env HIPPO_UPSTREAM_URL="$ORIG" HIPPO_CHANNEL='--upload-pack=touch /tmp/x' RUNNER_TEMP="$WORK/runner-temp" bash -e -c "$template_run" 2>&1)"
CODE=$?
check "the template refuses a channel that is not a branch or tag name" '[ "$CODE" -ne 0 ] && contains "$OUT" "Not a branch or tag name"'

scenario "Refusals"
orig_clone="$WORK/original-clone"
git clone -q "$ORIG" "$orig_clone"
run_update "$orig_clone"
check "refuses in the original (by its address)" '[ "$CODE" -eq 1 ] && contains "$OUT" "This is the original Hippo project"'
OUT="$(cd "$B" && env -u HIPPO_UPSTREAM_URL GITHUB_REPOSITORY=thekozugroup/Hippo HIPPO_UPSTREAM="$(git -C "$B" rev-parse HEAD)" bash "$SCRIPT" 2>&1)"
CODE=$?
check "refuses in the original (by GITHUB_REPOSITORY)" '[ "$CODE" -eq 1 ] && contains "$OUT" "This is the original Hippo project"'
printf 'dirty\n' >> "$B/src/app.txt"
before="$(head_of "$B")"
run_update "$B"
check "refuses a dirty working folder" '[ "$CODE" -eq 1 ] && contains "$OUT" "not committed" && [ "$(head_of "$B")" = "$before" ]'
git -C "$B" checkout -q -- src/app.txt
OUT="$(cd "$B" && env HIPPO_UPSTREAM_URL="$ORIG" bash "$SCRIPT" 2>&1)"
CODE=$?
check "refuses without a fetched original" '[ "$CODE" -eq 1 ] && contains "$OUT" "Nothing to update from"'

scenario "Never stages or commits anything under .github"
for copy in "$A" "$C" "$D" "$E" "$F" "$H" "$I" "$J"; do
  bad="$(git -C "$copy" log --format=%H --grep='^Update Hippo' | while read -r c; do git -C "$copy" diff --name-only "$c~1" "$c" -- .github; done)"
  check "$(basename "$copy"): no update commit touches .github" '[ -z "$bad" ]'
done

scenario "The promote workflow only fast-forwards stable"
PROMOTE="$HERE/../../.github/workflows/promote.yml"
promote_run="$(awk '/^        run: \|/{on=1; next} on && /^          /{sub(/^          /, ""); print; next} on{exit}' "$PROMOTE")"
P="$WORK/promote"
git init -q --bare -b main "$P.git"
git clone -q "$P.git" "$P" 2> /dev/null
(cd "$P" && printf '{\n  "version": "1.0.0"\n}\n' > package.json && git add . && as_maintainer git commit -q -m one && printf '2\n' > two && git add two && as_maintainer git commit -q -m two && git push -q origin main)
p1="$(git -C "$P" rev-parse HEAD~1)"
p2="$(git -C "$P" rev-parse HEAD)"
promote() { git -C "$P" fetch -q origin; OUT="$(cd "$P" && SHA="$1" GITHUB_STEP_SUMMARY="$WORK/promote-summary" bash -c "$promote_run" 2>&1)"; CODE=$?; }
stable_at() { git --git-dir="$P.git" rev-parse --verify --quiet stable; }
promote "$p1"
check "creates stable at the commit that passed" '[ "$CODE" -eq 0 ] && [ "$(stable_at)" = "$p1" ]'
promote "$p2"
check "moves stable forward" '[ "$CODE" -eq 0 ] && [ "$(stable_at)" = "$p2" ]'
promote "$p1"
check "never moves it back (an older run finishing late)" '[ "$CODE" -eq 0 ] && [ "$(stable_at)" = "$p2" ] && contains "$OUT" "already contains"'
(cd "$P" && git checkout -q -b side "$p1" && printf 'x\n' > x && git add x && as_maintainer git commit -q -m side && git push -q origin side)
promote "$(git -C "$P" rev-parse side)"
check "refuses a commit that is not on main" '[ "$CODE" -ne 0 ] && [ "$(stable_at)" = "$p2" ]'
(cd "$P" && git checkout -q main && git reset -q --hard "$p1" && printf 'y\n' > y && git add y && as_maintainer git commit -q -m rewritten && git push -q -f origin main)
promote "$(git -C "$P" rev-parse main)"
check "refuses when stable is not an ancestor (main was rewritten), without forcing" '[ "$CODE" -ne 0 ] && contains "$OUT" "not an ancestor" && [ "$(stable_at)" = "$p2" ]'
promote 'abc; rm -rf /'
check "refuses a commit id that is not one" '[ "$CODE" -ne 0 ] && [ "$(stable_at)" = "$p2" ]'

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
