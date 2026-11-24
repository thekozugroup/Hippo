#!/usr/bin/env bash
# Brings a copy of Hippo up to date with the original project.
#
# Runs inside a copy (made with the "Deploy with Vercel" button, or a fork), checked out on its
# default branch with full history, after the original's channel (normally its `stable` branch) has
# been fetched. The workflow template scripts/hosting/hippo-update.yml does exactly that and then runs
# this file as it is on the fetched channel, so improvements here reach every copy on their own.
# Contributor notes: scripts/hosting/README.md. Tests: scripts/hosting/test-update-copy.sh.
#
# Inputs (environment variables):
#   HIPPO_UPSTREAM      Required. The fetched tip of the channel: a commit id or a local ref.
#   HIPPO_CHANNEL       The channel's name, for messages and the marker. Default: stable.
#   HIPPO_UPSTREAM_URL  The original repository. Default: https://github.com/thekozugroup/Hippo.git
#   HIPPO_REPLACE       true: make the copy exactly the original (outside .github), discarding edits.
#   HIPPO_DRY_RUN       true: say what would change, commit and push nothing.
#   HIPPO_PUSH          false: commit locally but do not push (tests). Default: true.
#   HIPPO_SEARCH_LIMIT  How many commits of the original to search for the copy's version. Default: 1000.
#   HIPPO_AUTHOR_NAME / HIPPO_AUTHOR_EMAIL  Override the identity the update is committed as.
#
# Exit codes: 0 updated, up to date or dry run; 1 refused or failed; 2 your edits conflict with the
# original's changes (nothing changed); 3 the push was refused (run again); 4 the copy's starting
# version could not be found (nothing changed).
#
# It never writes anything under .github/ and never force-pushes.

set -euo pipefail
export LC_ALL=C GIT_TERMINAL_PROMPT=0

CHANNEL="${HIPPO_CHANNEL:-stable}"
UPSTREAM_URL="${HIPPO_UPSTREAM_URL:-https://github.com/thekozugroup/Hippo.git}"
LIMIT="${HIPPO_SEARCH_LIMIT:-1000}"
MARKER=".hippo/upstream"
MAX_SUBJECTS=15

# ---------------------------------------------------------------------------------------------- output

is_true() { case "${1:-}" in true | TRUE | True | 1 | yes) return 0 ;; *) return 1 ;; esac; }

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY" || true; fi
}

# finish CODE HEADLINE [DETAIL LINE...]: prints the result, writes it to the job summary, exits.
finish() {
  local code="$1" headline="$2"
  shift 2
  local out=1
  [ "$code" -ne 0 ] && out=2
  {
    printf '%s\n' "$headline"
    [ "$#" -gt 0 ] && printf '%s\n' "" "$@"
  } >&"$out"
  summary "## Update Hippo" "" "**$headline**"
  [ "$#" -gt 0 ] && summary "" "$@"
  summary ""
  exit "$code"
}

# -------------------------------------------------------------------------------------------- helpers

# Top-level entries of a tree, NUL-separated, without the parts the updater never compares or writes.
drop_reserved() {
  local entry
  while IFS= read -r -d '' entry; do
    case "${entry#*$'\t'}" in .github | .hippo) continue ;; esac
    printf '%s\0' "$entry"
  done
}
keep_reserved() {
  local entry
  while IFS= read -r -d '' entry; do
    case "${entry#*$'\t'}" in .github | .hippo) printf '%s\0' "$entry" ;; esac
  done
}

declare -A STRIPPED=()
# The tree without .github/ and .hippo/, as a tree id. Cached by tree id.
stripped() {
  local tree
  tree="$(git rev-parse "$1^{tree}")"
  if [ -z "${STRIPPED[$tree]:-}" ]; then
    STRIPPED[$tree]="$(git ls-tree -z "$tree" | drop_reserved | git mktree -z)"
  fi
  printf '%s\n' "${STRIPPED[$tree]}"
}

# The original's tree at $1 with this copy's own .github/ and .hippo/ in place of the original's.
as_copy() {
  { git ls-tree -z "$1^{tree}" | drop_reserved; git ls-tree -z HEAD | keep_reserved; } | git mktree -z
}

# A throwaway commit holding a tree, so merge-tree can use it.
commit_of() { git commit-tree "$1" -m "hippo-update scratch" < /dev/null; }

is_ancestor() { git merge-base --is-ancestor "$1" "$2" 2> /dev/null; }

# Lower case, no scheme, no user, no ".git", no trailing slash: compares repository addresses.
normalise_url() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's#^[a-z+]*://##' -e 's#^[^@/]*@##' -e 's#^github\.com:#github.com/#' -e 's#/*$##' -e 's#\.git$##'
}

version_at() {
  local v
  v="$(git show "$1:package.json" 2> /dev/null | sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n 1p)"
  v="$(printf '%s' "$v" | tr -cd '0-9A-Za-z.+-')"
  printf '%s\n' "${v:-unknown}"
}

# Looks for the newest commit in $2's history (bounded) whose files, ignoring .github/, equal $1.
find_by_tree() {
  local want="$1" ref="$2" commit tree
  while read -r commit tree; do
    [ "$(stripped "$tree")" = "$want" ] && { printf '%s\n' "$commit"; return 0; }
  done < <(git log --format='%H %T' --max-count="$LIMIT" "$ref" --)
  return 1
}

# The original's main branch, for copies made from a commit that has not reached the channel yet.
MAIN_REF=""
fetch_main() {
  [ -n "$MAIN_REF" ] && return 0
  if git fetch --quiet --no-tags -- "$UPSTREAM_URL" "+refs/heads/main:refs/hippo/main" 2> /dev/null; then
    MAIN_REF="refs/hippo/main"
    return 0
  fi
  return 1
}

# --------------------------------------------------------------------------------------------- checks

git rev-parse --git-dir > /dev/null 2>&1 || finish 1 "This is not a Git repository." "Run the updater inside your copy of Hippo."

git_version="$(git version | sed -n 's/^git version \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')"
read -r git_major git_minor <<< "${git_version:-0 0}"
if [ "$git_major" -lt 2 ] || { [ "$git_major" -eq 2 ] && [ "$git_minor" -lt 40 ]; }; then
  finish 1 "The updater needs Git 2.40 or newer." "This machine has $(git version)."
fi

[ -n "${HIPPO_UPSTREAM:-}" ] || finish 1 "Nothing to update from." "Set HIPPO_UPSTREAM to the fetched commit of the original project."
case "$CHANNEL" in
  '' | -* | *[!A-Za-z0-9._/-]* | *..*) finish 1 "The channel name is not valid." "Use a branch or tag name of the original project, such as stable or v0.1.5." ;;
esac
case "$LIMIT" in '' | *[!0-9]*) LIMIT=1000 ;; esac

TARGET="$(git rev-parse --verify --quiet "${HIPPO_UPSTREAM}^{commit}")" ||
  finish 1 "The original's $CHANNEL version was not fetched." "Fetch it first (see scripts/hosting/hippo-update.yml)."

BRANCH="$(git symbolic-ref --quiet --short HEAD)" || finish 1 "No branch is checked out." "Check out your copy's default branch (usually main) and run again."
HEAD_COMMIT="$(git rev-parse --verify --quiet HEAD)" || finish 1 "This repository has no commits yet."

# Never in the original project itself: it is the source of updates, not a copy.
upstream_id="$(normalise_url "$UPSTREAM_URL")"
if [ -n "${GITHUB_REPOSITORY:-}" ] && [ "$(normalise_url "github.com/$GITHUB_REPOSITORY")" = "$upstream_id" ]; then
  finish 1 "This is the original Hippo project, not a copy." "The updater only runs in copies of it."
fi
origin_url="$(git remote get-url origin 2> /dev/null || true)"
if [ -n "$origin_url" ] && [ "$(normalise_url "$origin_url")" = "$upstream_id" ]; then
  finish 1 "This is the original Hippo project, not a copy." "The updater only runs in copies of it."
fi

if [ -n "$(git status --porcelain)" ]; then
  finish 1 "The working folder has changes that are not committed." "Commit or remove them, then run again. Nothing was changed."
fi

REPLACE=false
DRY_RUN=false
is_true "${HIPPO_REPLACE:-}" && REPLACE=true
is_true "${HIPPO_DRY_RUN:-}" && DRY_RUN=true

FROM_VERSION="$(version_at HEAD)"
TO_VERSION="$(version_at "$TARGET")"
TARGET_SHORT="$(git rev-parse --short=7 "$TARGET")"
HEAD_STRIPPED="$(stripped HEAD)"

up_to_date() {
  finish 0 "Hippo is up to date ($FROM_VERSION)." "This copy already has everything in the original's $CHANNEL channel ($TARGET_SHORT)." "$@"
}

# ----------------------------------------------------------------------------------------------- base

BASE=""
BASE_HOW=""
if [ "$REPLACE" = false ]; then
  marked="$(git show "HEAD:$MARKER" 2> /dev/null | sed -n 's/^commit \([0-9a-f]\{40,64\}\)$/\1/p' | sed -n 1p || true)"
  if [ -n "$marked" ]; then
    if ! git cat-file -e "$marked^{commit}" 2> /dev/null; then fetch_main || true; fi
    if git cat-file -e "$marked^{commit}" 2> /dev/null; then
      BASE="$marked"
      BASE_HOW="recorded in $MARKER"
    fi
  fi
  if [ -z "$BASE" ] && BASE="$(find_by_tree "$HEAD_STRIPPED" "$TARGET")"; then
    BASE_HOW="matched in the $CHANNEL history"
  fi
  if [ -z "$BASE" ] && fetch_main && BASE="$(find_by_tree "$HEAD_STRIPPED" "$MAIN_REF")"; then
    BASE_HOW="matched in the main history"
  fi
  # A fork shares history with the original: where they last met is the starting point.
  if [ -z "$BASE" ] && BASE="$(git merge-base HEAD "$TARGET" 2> /dev/null)"; then
    BASE_HOW="shared history"
  fi
  if [ -z "$BASE" ]; then
    finish 4 "Hippo could not be updated automatically: this copy's files do not match any version of the original." \
      "Its files differ from each of the last $LIMIT versions on the original's $CHANNEL and main branches, so the updater cannot tell which changes are yours. This happens when files were edited by hand since the copy was made. Nothing was changed." \
      "" \
      "Choose one:" \
      "" \
      "1. Keep your edits. Find the version of Hippo your copy started from (a commit of https://github.com/thekozugroup/Hippo), then add a file named \`$MARKER\` to your copy containing one line: \`commit <that commit id>\`. The next run merges the newer changes into your edits." \
      "2. Replace your copy with the original. Open Actions, choose Update Hippo, then Run workflow, tick \"Replace my copy with the original\" and run it. Your changes to files outside .github are discarded."
  fi
  if [ "$BASE" = "$TARGET" ] || is_ancestor "$TARGET" "$BASE"; then
    up_to_date
  fi
fi

# --------------------------------------------------------------------------------------------- result

TARGET_TREE="$(as_copy "$TARGET")"
if [ "$REPLACE" = true ]; then
  MODE="replace"
  RESULT="$TARGET_TREE"
elif [ "$(stripped "$BASE")" = "$HEAD_STRIPPED" ]; then
  MODE="untouched"
  RESULT="$TARGET_TREE"
else
  MODE="merge"
  base_commit="$(commit_of "$(as_copy "$BASE")")"
  target_commit="$(commit_of "$TARGET_TREE")"
  set +e
  merge_out="$(git merge-tree --write-tree --name-only --no-messages -z --merge-base="$base_commit" HEAD "$target_commit" | tr '\0' '\n')"
  merge_status=$?
  set -e
  if [ "$merge_status" -eq 1 ]; then
    conflicts="$(printf '%s\n' "$merge_out" | sed -n '2,$p' | sed '/^$/d' | sort -u)"
    list="$(printf '%s\n' "$conflicts" | sed -n '1,40s/^/- /p')"
    count="$(printf '%s\n' "$conflicts" | grep -c . || true)"
    finish 2 "Hippo could not be updated automatically: $count of your changed files were also changed in the original." \
      "Nothing was changed. The files are:" \
      "" \
      "$list" \
      "" \
      "Choose one:" \
      "" \
      "1. Merge by hand on your computer. In a clone of your copy run:" \
      "   \`git fetch $UPSTREAM_URL $CHANNEL\`" \
      "   \`git diff --binary $BASE FETCH_HEAD -- . ':(exclude).github' ':(exclude).hippo' | git apply --3way\`" \
      "   Fix the files Git lists, write \`commit $TARGET\` as the only line of \`$MARKER\`, then commit and push." \
      "2. Replace your copy with the original. Open Actions, choose Update Hippo, then Run workflow, tick \"Replace my copy with the original\" and run it. Your changes to files outside .github are discarded."
  elif [ "$merge_status" -ne 0 ]; then
    finish 1 "The merge could not run (git merge-tree exit $merge_status)." "Nothing was changed."
  fi
  RESULT="$(printf '%s\n' "$merge_out" | sed -n 1p)"
fi

if [ "$(stripped "$RESULT")" = "$HEAD_STRIPPED" ]; then
  up_to_date "The original's changes since this copy's version touch only files the updater leaves alone (.github)."
fi

# The result plus the marker recording where this copy now stands.
marker_blob="$(printf '%s\n' \
  "# Written by Hippo's updater (scripts/hosting/update-copy.sh in the original project)." \
  "# The version of the original this copy was last updated to. Delete this file and the updater" \
  "# works it out again from the files." \
  "commit $TARGET" \
  "channel $CHANNEL" \
  "version $TO_VERSION" | git hash-object -w --stdin)"
tmp_index="$(mktemp)"
trap 'rm -f "$tmp_index"' EXIT
rm -f "$tmp_index"
GIT_INDEX_FILE="$tmp_index" git read-tree "$RESULT"
GIT_INDEX_FILE="$tmp_index" git update-index --add --cacheinfo "100644,$marker_blob,$MARKER"
NEW_TREE="$(GIT_INDEX_FILE="$tmp_index" git write-tree)"

# Belt and braces: .github/ must be exactly what the copy had.
if [ "$(git rev-parse --quiet --verify "HEAD:.github" || true)" != "$(git rev-parse --quiet --verify "$NEW_TREE:.github" || true)" ]; then
  finish 1 "Stopped: the update would have changed .github, which the updater never does." "Nothing was changed. Please report this."
fi

changes="$(git diff --name-status --no-renames "$HEAD_COMMIT" "$NEW_TREE" -- . ':(exclude).hippo')"
changed_count="$(printf '%s\n' "$changes" | grep -c . || true)"
change_list="$(printf '%s\n' "$changes" | sed -n '1,60p' | sed -e 's/^A\t/- added: /' -e 's/^D\t/- removed: /' -e 's/^M\t/- changed: /' -e 's/^T\t/- changed: /')"
[ "$changed_count" -gt 60 ] && change_list="$change_list"$'\n'"- and $((changed_count - 60)) more"

how="the original's changes were merged into your edits"
[ "$MODE" = "untouched" ] && how="this copy had no edits of its own, so it now matches the original"
[ "$MODE" = "replace" ] && how="replaced with the original, as asked; your own changes outside .github were discarded"

if [ "$DRY_RUN" = true ]; then
  finish 0 "Dry run: Hippo would be updated from $FROM_VERSION to $TO_VERSION ($TARGET_SHORT), changing $changed_count files." \
    "How: $how. Nothing was committed or pushed." "" "$change_list"
fi

# -------------------------------------------------------------------------------------------- commit

# The identity of whoever owns this copy: the author of its oldest commit that is not the original's
# (for a copy made with the button, its root commit). Vercel's free plan deploys commits to a private
# repository only when they are authored by the account owner, so never a bot.
if [ -n "${HIPPO_AUTHOR_NAME:-}" ] && [ -n "${HIPPO_AUTHOR_EMAIL:-}" ]; then
  AUTHOR_NAME="$HIPPO_AUTHOR_NAME"
  AUTHOR_EMAIL="$HIPPO_AUTHOR_EMAIL"
else
  exclude=("$TARGET")
  [ -n "$BASE" ] && exclude+=("$BASE")
  [ -n "$MAIN_REF" ] && exclude+=("$MAIN_REF")
  own="$(git rev-list --first-parent --reverse HEAD --not "${exclude[@]}" -- | sed -n 1p)"
  if [ -n "$own" ]; then
    AUTHOR_NAME="$(git log -1 --format=%an "$own")"
    AUTHOR_EMAIL="$(git log -1 --format=%ae "$own")"
  elif [ -n "${GITHUB_ACTOR:-}" ] && [ -n "${GITHUB_ACTOR_ID:-}" ]; then
    AUTHOR_NAME="$GITHUB_ACTOR"
    AUTHOR_EMAIL="$GITHUB_ACTOR_ID+$GITHUB_ACTOR@users.noreply.github.com"
  else
    finish 1 "Could not tell who owns this copy." "Set HIPPO_AUTHOR_NAME and HIPPO_AUTHOR_EMAIL. Nothing was changed."
  fi
fi

subjects=""
if [ -n "$BASE" ] && is_ancestor "$BASE" "$TARGET"; then
  subjects="$(git log --no-merges --format='%s' "$BASE..$TARGET" -- | grep -viE '(^|[^a-z])wip([^a-z]|$)' || true)"
fi
subject_count="$(printf '%s\n' "$subjects" | grep -c . || true)"
message="Update Hippo to $TO_VERSION ($TARGET_SHORT)"
if [ "$subject_count" -gt 0 ]; then
  message="$message"$'\n\n'"Changes in the original since $FROM_VERSION:"$'\n'"$(printf '%s\n' "$subjects" | sed -n "1,${MAX_SUBJECTS}s/^/- /p")"
  [ "$subject_count" -gt "$MAX_SUBJECTS" ] && message="$message"$'\n'"- and $((subject_count - MAX_SUBJECTS)) more"
fi
[ "$MODE" = "replace" ] && message="$message"$'\n\n'"Replaced with the original as asked: local changes outside .github were discarded."

NEW_COMMIT="$(GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git commit-tree "$NEW_TREE" -p "$HEAD_COMMIT" -F - <<< "$message")"
git reset --quiet --keep "$NEW_COMMIT"

if is_true "${HIPPO_PUSH:-true}"; then
  if ! git push --quiet origin "HEAD:refs/heads/$BRANCH"; then
    git reset --quiet --keep "$HEAD_COMMIT"
    finish 3 "The update was ready but could not be pushed." \
      "Most likely $BRANCH changed while the updater ran, or the branch is protected. Nothing was changed. Run the workflow again (Actions, Update Hippo, Run workflow)."
  fi
fi

finish 0 "Updated Hippo from $FROM_VERSION to $TO_VERSION ($TARGET_SHORT): $changed_count files changed." \
  "How: $how. Your host publishes the new version in a few minutes." "" "$change_list"
