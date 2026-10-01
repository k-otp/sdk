#!/usr/bin/env bash
set -euo pipefail

# Publish @k-otp/sdk to npm with GitHub OIDC Trusted Publishing (no
# long-lived npm token).
#
# Why pack with Bun? The workspace uses `workspace:*` and `catalog:` ranges;
# `bun pm pack` rewrites them to real versions inside the tarball, which is
# then published with `npm publish <tarball>` so npm can authenticate via OIDC.
#
# Usage:
#   ./scripts/publish-oidc.sh --check   # prints should_publish=true|false and
#                                       # needs_finalize=true|false
#   ./scripts/publish-oidc.sh           # publishes unpublished versions, then
#                                       # (re)creates missing tags + Release
#
# should_publish: some package version is not on npm yet (a new release).
# needs_finalize: the version is on npm but the release tag vX.Y.Z or the
#   GitHub Release is missing (an
#   earlier run failed after publishing). Kept separate so a recovery never
#   blocks the Sampo release-PR step: when the tag / Release lookups keep
#   failing, --check warns and reports needs_finalize=false instead of failing.
#
# PUBLISH_OIDC_RETRY_DELAY (seconds, default 2) scales the backoff between
# the 3 attempts of a git / gh lookup (tests set it to 0).
#
# Requirements (publish mode): GitHub Actions job with `id-token: write`,
# @k-otp/sdk configured for Trusted Publishing from this repo + workflow
# (see docs/releasing.md), Node >= 22.14 and npm >= 11.5.1.
#
# Version 0.0.0 is the "never released" placeholder and is never published.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="${RUNNER_TEMP:-/tmp}/k-otp-sdk-npm-pack"
mkdir -p "$TMP_DIR"

MODE="publish"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
  shift
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

# The single published package (@k-otp/sdk). Kept as a list for the loops
# below; any other publishable package under packages/ is an error.
PACKAGE_DIRS=(
  "packages/sdk"
)

pkg_field() {
  node -p "require(process.argv[1]).$2" "${ROOT_DIR}/$1/package.json"
}

# Every publishable packages/* package must be listed above.
for manifest in "${ROOT_DIR}"/packages/*/package.json; do
  dir="packages/$(basename "$(dirname "$manifest")")"
  [[ "$(pkg_field "$dir" private)" == "true" ]] && continue
  listed="false"
  for known in "${PACKAGE_DIRS[@]}"; do
    [[ "$known" == "$dir" ]] && listed="true"
  done
  if [[ "$listed" != "true" ]]; then
    echo "${dir} is publishable but missing from PACKAGE_DIRS" >&2
    exit 1
  fi
done

# Return codes: 0 = version exists, 1 = missing (or package not created yet),
# 2 = network/parse error.
registry_has_version() {
  local name="$1" version="$2"
  local encoded="${name//@/%40}"
  encoded="${encoded//\//%2F}"
  local resp http json
  # No --retry-all-errors: 404 is the expected "not published yet" answer.
  if ! resp="$(curl -sSL --connect-timeout 10 --max-time 30 --retry 3 \
    -w '\n%{http_code}' "https://registry.npmjs.org/${encoded}" 2>/dev/null)"; then
    return 2
  fi
  http="$(printf '%s' "$resp" | tail -n 1)"
  json="$(printf '%s' "$resp" | sed '$d')"
  case "$http" in
    200) ;;
    404) return 1 ;;
    *) return 2 ;;
  esac
  printf '%s' "$json" | node -e '
    let data;
    try { data = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch { process.exit(2); }
    process.exit(Object.hasOwn(data.versions ?? {}, process.argv[1]) ? 0 : 1);
  ' "$version"
}

# Prints the gitHead npm recorded for name@version (empty when unknown).
registry_git_head() {
  local name="$1" version="$2"
  local encoded="${name//@/%40}"
  encoded="${encoded//\//%2F}"
  curl -sSL --connect-timeout 10 --max-time 30 --retry 3 \
    "https://registry.npmjs.org/${encoded}/${version}" 2>/dev/null |
    node -e '
      let data = {};
      try { data = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch {}
      process.stdout.write(typeof data.gitHead === "string" ? data.gitHead : "");
    ' || true
}

# Runs "$@" up to 3 times while it returns 2 (error), with a linear backoff.
# Any other status (an answer) is returned at once.
with_retry() {
  local attempt rc
  for attempt in 1 2 3; do
    rc=0
    "$@" || rc="$?"
    [[ "$rc" -ne 2 ]] && return "$rc"
    if [[ "$attempt" -lt 3 ]]; then
      sleep "$((attempt * ${PUBLISH_OIDC_RETRY_DELAY:-2}))"
    fi
  done
  return 2
}

# Return codes: 0 = tag exists on origin, 1 = missing, 2 = error.
remote_tag_exists() {
  local rc=0
  git -C "$ROOT_DIR" ls-remote --exit-code --tags origin "refs/tags/$1" >/dev/null || rc="$?"
  case "$rc" in
    0) return 0 ;;
    2) return 1 ;; # --exit-code: no matching ref
    *)
      echo "git ls-remote failed (exit ${rc}) while looking up $1" >&2
      return 2
      ;;
  esac
}

# Return codes: 0 = GitHub Release exists, 1 = missing, 2 = error,
# 3 = cannot tell (gh CLI or token unavailable).
github_release_exists() {
  if ! command -v gh >/dev/null 2>&1 || [[ -z "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    return 3
  fi
  # Decide on the HTTP status (first line of --include output), not on the
  # wording of gh's error messages. gh exits non-zero for a 404 as well.
  local out status
  out="$(cd "$ROOT_DIR" && GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}" \
    gh api --include "repos/{owner}/{repo}/releases/tags/$1" 2>/dev/null)" || true
  status="$(printf '%s\n' "$out" | head -n 1 | awk '{print $2}')"
  case "$status" in
    200) return 0 ;;
    404) return 1 ;;
  esac
  echo "GitHub Release lookup for $1 failed (HTTP ${status:-none})" >&2
  return 2
}

# Decides whether an already-published release still needs finalizing: sets
# NEEDS_FINALIZE=true when any of RELEASE_TAGS is missing on origin or the
# GitHub Release is missing. A lookup that keeps failing is "unknown": warn
# and leave NEEDS_FINALIZE=false (a later run retries), never fail --check.
detect_finalize() {
  NEEDS_FINALIZE="false"
  local tag rc
  for tag in "${RELEASE_TAGS[@]}"; do
    rc=0
    with_retry remote_tag_exists "$tag" || rc="$?"
    if [[ "$rc" -eq 1 ]]; then
      echo "${tag} is published but not tagged; finishing the release."
      NEEDS_FINALIZE="true"
      return 0
    elif [[ "$rc" -ne 0 ]]; then
      echo "::warning::Could not look up tag ${tag}; not finalizing this run."
      return 0
    fi
  done
  rc=0
  with_retry github_release_exists "v${RELEASE_VERSION}" || rc="$?"
  case "$rc" in
    0) ;;
    1)
      echo "v${RELEASE_VERSION} is tagged but has no GitHub Release; finishing the release."
      NEEDS_FINALIZE="true"
      ;;
    3) echo "gh CLI or token unavailable; not checking the GitHub Release." >&2 ;;
    *) echo "::warning::Could not look up the v${RELEASE_VERSION} GitHub Release; not finalizing this run." ;;
  esac
}

RELEASE_VERSION="$(pkg_field "${PACKAGE_DIRS[0]}" version)"

# One release tag: vX.Y.Z.
RELEASE_TAGS=("v${RELEASE_VERSION}")

emit() {
  echo "$1"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "$1" >>"$GITHUB_OUTPUT"
  fi
}

if [[ "$RELEASE_VERSION" == "0.0.0" ]]; then
  echo "Version 0.0.0 is the unreleased placeholder; nothing to publish."
  if [[ "$MODE" == "check" ]]; then
    emit "should_publish=false"
    emit "needs_finalize=false"
  fi
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  SHOULD_PUBLISH="false"
  for dir in "${PACKAGE_DIRS[@]}"; do
    NAME="$(pkg_field "$dir" name)"
    set +e
    registry_has_version "$NAME" "$RELEASE_VERSION"
    rc="$?"
    set -e
    if [[ "$rc" -eq 1 ]]; then
      SHOULD_PUBLISH="true"
      break
    elif [[ "$rc" -eq 2 ]]; then
      echo "Registry check failed for ${NAME}@${RELEASE_VERSION}" >&2
      exit 2
    fi
  done
  # Everything is on npm but a release tag or the GitHub Release is missing
  # (e.g. a previous run failed after publishing): finish the release.
  NEEDS_FINALIZE="false"
  if [[ "$SHOULD_PUBLISH" == "false" ]]; then
    detect_finalize
  fi
  emit "should_publish=${SHOULD_PUBLISH}"
  emit "needs_finalize=${NEEDS_FINALIZE}"
  exit 0
fi

TO_PUBLISH=()
for dir in "${PACKAGE_DIRS[@]}"; do
  NAME="$(pkg_field "$dir" name)"
  set +e
  registry_has_version "$NAME" "$RELEASE_VERSION"
  rc="$?"
  set -e
  if [[ "$rc" -eq 0 ]]; then
    echo "Already published: ${NAME}@${RELEASE_VERSION}"
  elif [[ "$rc" -eq 2 ]]; then
    echo "Registry check failed for ${NAME}@${RELEASE_VERSION}" >&2
    exit 2
  else
    TO_PUBLISH+=("$dir")
  fi
done

if [[ ${#TO_PUBLISH[@]} -gt 0 ]]; then
  echo "Building and validating packages..."
  # smoke:dist loads the built ESM/CJS/IIFE output with Node before publishing.
  (cd "$ROOT_DIR" && bun run build && bun run check:pack && bun run smoke:dist)
fi

for dir in ${TO_PUBLISH[@]+"${TO_PUBLISH[@]}"}; do
  NAME="$(pkg_field "$dir" name)"
  TARBALL="$(cd "${ROOT_DIR}/${dir}" && bun pm pack --destination "$TMP_DIR" --ignore-scripts --quiet | tail -n 1)"
  if [[ ! -f "$TARBALL" ]]; then
    echo "Expected tarball not found: $TARBALL" >&2
    exit 1
  fi
  echo "Publishing ${NAME}@${RELEASE_VERSION}"
  npm publish "$TARBALL" --access public
  rm -f "$TARBALL"
done

# Tags and the GitHub Release are (re)created whenever missing, also when an
# earlier run published the packages but failed before this point.
TAGS_TO_CREATE=()
for TAG in "${RELEASE_TAGS[@]}"; do
  git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || TAGS_TO_CREATE+=("$TAG")
done

# Only resolved when a tag must be created (not e.g. when only the GitHub
# Release is missing). Tags point at the commit that shipped the version:
# HEAD when this run published, else (recovery) npm's recorded gitHead, else
# the last commit that set this version in a package manifest. Never blindly
# the current HEAD, which may already contain later, unreleased work.
if [[ ${#TAGS_TO_CREATE[@]} -gt 0 ]]; then
  if [[ ${#TO_PUBLISH[@]} -gt 0 ]]; then
    RELEASE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  else
    RELEASE_COMMIT="$(registry_git_head "$(pkg_field "${PACKAGE_DIRS[0]}" name)" "$RELEASE_VERSION")"
    if [[ -z "$RELEASE_COMMIT" ]] || ! git -C "$ROOT_DIR" cat-file -e "${RELEASE_COMMIT}^{commit}" 2>/dev/null; then
      RELEASE_COMMIT="$(git -C "$ROOT_DIR" log -1 --format=%H \
        -S"\"version\": \"${RELEASE_VERSION}\"" -- ':(glob)packages/*/package.json')"
    fi
    if [[ -z "$RELEASE_COMMIT" ]]; then
      echo "Cannot find the commit that shipped ${RELEASE_VERSION}; tag it manually." >&2
      exit 1
    fi
  fi
  echo "Release commit for v${RELEASE_VERSION}: ${RELEASE_COMMIT}"
  for TAG in "${TAGS_TO_CREATE[@]}"; do
    git -C "$ROOT_DIR" tag "$TAG" "$RELEASE_COMMIT"
  done
fi
# Push only this release's tags (never every local tag); tags that already
# exist on origin are a no-op.
git -C "$ROOT_DIR" push origin "${RELEASE_TAGS[@]/#/refs/tags/}"

rc=0
with_retry github_release_exists "v${RELEASE_VERSION}" || rc="$?"
case "$rc" in
  0) echo "GitHub Release v${RELEASE_VERSION} already exists." ;;
  1)
    (cd "$ROOT_DIR" && GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}" \
      gh release create "v${RELEASE_VERSION}" --generate-notes)
    ;;
  3) echo "gh CLI or token unavailable; skipping GitHub Release creation." >&2 ;;
  *)
    echo "Could not look up the v${RELEASE_VERSION} GitHub Release; create it manually." >&2
    exit 1
    ;;
esac
