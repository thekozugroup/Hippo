# Automatic updates for copies of Hippo

People put their own copy of Hippo online with the "Deploy with Vercel" button (or a fork). This folder is how those copies stay up to date. The user-facing steps are in the main README, "Turn on automatic updates".

| File | What it is |
|---|---|
| `hippo-update.yml` | The workflow a copy's owner adds once, as `.github/workflows/hippo-update.yml`. A template here, never a workflow of this repository. |
| `update-copy.sh` | The updater. The template runs it as it is on the fetched channel, so changes here reach every copy without anyone editing their file. |
| `test-update-copy.sh` | End-to-end tests with real throwaway Git repositories (`npm run test:hosting`, also in CI). |
| `readme-link.mjs` | Writes the README's prefilled GitHub link from the template (`npm run hosting:link`). A unit test fails when they differ. |

## Facts this design rests on

- A copy made with the button is a new private repository with one commit, authored by the owner, sharing no history with this one, and without `.github/` (Vercel leaves it out). So nothing runs in a copy until its owner adds a workflow.
- A workflow's `GITHUB_TOKEN` cannot create or change files under `.github/workflows/`, and its pushes start no other workflow. The updater never writes under `.github/`. Vercel's Git integration still deploys the push; GitHub Pages copies have a `workflow_run` trigger in `deploy.yml` for it.
- Vercel's Hobby plan deploys a commit to a private repository only when the Hobby team's owner authored it (<https://vercel.com/docs/git#using-hobby-teams>). So update commits are authored and committed as the copy's owner, never as a bot.

## The channel

Copies follow the `stable` branch, not `main`. CI (`.github/workflows/ci.yml`) runs on every push, `main` included. When it passes for a push to `main`, `.github/workflows/promote.yml` fast-forwards `stable` to exactly that commit: never backwards, never forced, and it stops if `stable` is not an ancestor. A copy's owner can follow a tag instead (`HIPPO_CHANNEL: v0.1.5`).

Everything a copy runs comes from `stable`. Before merging a change to this folder, think about every copy that will run it the next morning: run `npm run test:hosting`, keep the script free of anything but Bash, Git (2.40 or newer) and coreutils, and keep it backwards compatible with the template already installed in copies (its inputs are the environment variables listed at the top of the script). Never change the template in a way that needs owners to edit their file; they will not.

## What the updater does

1. Refuses to run in the original repository, with uncommitted changes, or without the fetched channel.
2. Finds the base: the version of the original the copy was last in step with.
   - The marker file `.hippo/upstream` (`commit <id>`), written by every update.
   - Otherwise it walks back along the copy's own history (newest first, bounded) and takes the first commit whose files, ignoring `.github/` and `.hippo/`, equal a version in the channel's history, then in `main`'s (a copy made from a commit that had not reached `stable` yet).
   - Otherwise, for a fork, the merge base of the copy and the channel.
   - Otherwise it stops (exit 4) and explains the two ways out: write the starting commit into `.hippo/upstream`, or run with "Replace my copy with the original".
3. Base equals the channel's tip, or is newer: up to date, no commit.
4. Builds the new files without touching the working folder. Every tree used has the copy's own `.github/` and `.hippo/` put in place of the original's, so those never change.
   - Untouched copy (its files equal the base's): the new files are exactly the channel's tip. Deletions and renames follow.
   - Customised copy: a real three-way merge, `git merge-tree --write-tree --merge-base=<base>` of the copy and the tip, on throwaway commits. It works without shared history, detects renames and handles binary files. A clash changes nothing, exits 2, and lists the files with how to merge by hand or replace.
   - Replace switch: the channel's tip, discarding the copy's own changes outside `.github/`.
5. Adds `.hippo/upstream`, checks again that `.github/` is unchanged, and makes one commit: "Update Hippo to <version> (<short id>)" with the original's commit subjects since the base (at most 15, without WIP commits and commits that only touched `.github/`). Author and committer are the author of the copy's oldest commit that is not the original's (for a button copy, its root commit); `HIPPO_AUTHOR_NAME`/`HIPPO_AUTHOR_EMAIL` override it, and the person running the workflow is the last resort.
6. Pushes with a plain push. A refused push (the branch moved, or it is protected) restores the local branch and exits 3: run again.

Every outcome is printed and written to `$GITHUB_STEP_SUMMARY`. A failed run makes GitHub email the owner, so failure messages say what to do in plain words.

Exit codes: 0 updated, up to date or dry run; 1 refused; 2 clash; 3 push refused; 4 base not found.

## Running it by hand

In a clone of a copy:

```
git fetch https://github.com/thekozugroup/Hippo.git stable
git show FETCH_HEAD:scripts/hosting/update-copy.sh > ../update-copy.sh
HIPPO_UPSTREAM=FETCH_HEAD HIPPO_DRY_RUN=true bash ../update-copy.sh
```

## A fork that publishes its own copies

Change `UPSTREAM_REPO_URL` in `src/app/lib/hosting.ts`, the `HIPPO_UPSTREAM_URL` line of `hippo-update.yml` and the default in `update-copy.sh`, the repository checks (`github.repository == 'thekozugroup/Hippo'`) in `.github/workflows/`, then run `npm run hosting:link`.
