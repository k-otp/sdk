#!/usr/bin/env bash
set -euo pipefail

# Keep only the workspace version bumps in the Sampo release branch's bun.lock.
#
# Sampo refreshes bun.lock with `bun update --lockfile-only --no-save`, which
# also moves every dependency, and the lockfile's copy of the catalog, to the
# newest versions while package.json keeps its ranges. The frozen install of
# CI and of the publish job then rejects the lockfile ("the catalog in
# package.json changed since bun.lock was saved"; 1.1.0 failed this way), and
# the release would ship dependency updates nobody reviewed.
#
# This rebuilds the release branch's lockfile from the base branch's with
# `bun install --lockfile-only`, which records only the new workspace
# versions, checks it with a frozen install, and pushes it as a commit on top
# of Sampo's. `--lockfile-only` installs nothing, so no dependency code runs.
# The work happens in a temporary worktree, so the caller's checkout (the
# release job's main, used by the publish steps after it) is left untouched.
#
# Usage:
#   ./scripts/release-lockfile.sh [release-branch] [base-branch]
#     defaults: sampo/release, main; remote: $RELEASE_LOCKFILE_REMOTE or origin
#
# Exits 0 without changes when the release branch does not exist or its
# lockfile already records only the version bumps.

RELEASE_BRANCH="${1:-sampo/release}"
BASE_BRANCH="${2:-main}"
REMOTE="${RELEASE_LOCKFILE_REMOTE:-origin}"

if ! git ls-remote --exit-code --heads "$REMOTE" "$RELEASE_BRANCH" >/dev/null; then
  echo "No ${RELEASE_BRANCH} branch on ${REMOTE}; nothing to fix."
  exit 0
fi

git fetch --no-tags "$REMOTE" \
  "+refs/heads/${BASE_BRANCH}:refs/remotes/${REMOTE}/${BASE_BRANCH}" \
  "+refs/heads/${RELEASE_BRANCH}:refs/remotes/${REMOTE}/${RELEASE_BRANCH}"

REPO_DIR="$PWD"
WORKTREE="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-lockfile.XXXXXX")"
cleanup() {
  cd "$REPO_DIR"
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
  git worktree prune
}
trap cleanup EXIT

git worktree add --quiet --detach "$WORKTREE" "${REMOTE}/${RELEASE_BRANCH}"
cd "$WORKTREE"

git checkout "${REMOTE}/${BASE_BRANCH}" -- bun.lock
bun install --lockfile-only
# The same check as the frozen installs of CI and the publish job.
bun install --frozen-lockfile --lockfile-only

# Against HEAD, not the index, which now holds the base branch's lockfile.
if git diff --quiet HEAD -- bun.lock; then
  echo "bun.lock on ${RELEASE_BRANCH} already records only the version bumps."
  exit 0
fi

BOT_NAME="github-actions[bot]"
BOT_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
GIT_AUTHOR_NAME="$BOT_NAME" GIT_AUTHOR_EMAIL="$BOT_EMAIL" \
  GIT_COMMITTER_NAME="$BOT_NAME" GIT_COMMITTER_EMAIL="$BOT_EMAIL" \
  git commit --quiet -m "chore(release): keep only the version bumps in bun.lock" -- bun.lock
git push "$REMOTE" "HEAD:refs/heads/${RELEASE_BRANCH}"
echo "Pushed the rebuilt bun.lock to ${RELEASE_BRANCH}."
