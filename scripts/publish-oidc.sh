#!/usr/bin/env bash
set -euo pipefail

# Publish the lockstep @k-otp/sdk-* packages to npm with GitHub OIDC
# Trusted Publishing (no long-lived npm token).
#
# Why pack with Bun? The workspace uses `workspace:*` and `catalog:` ranges;
# `bun pm pack` rewrites them to real versions inside the tarball, which is
# then published with `npm publish <tarball>` so npm can authenticate via OIDC.
#
# Usage:
#   ./scripts/publish-oidc.sh --check   # prints should_publish=true|false
#   ./scripts/publish-oidc.sh           # publishes unpublished versions
#
# Requirements (publish mode): GitHub Actions job with `id-token: write`,
# every package configured for Trusted Publishing from this repo + workflow
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

# Publish order matters: dependencies first.
PACKAGE_DIRS=(
  "packages/sdk-core"
  "packages/sdk-server"
  "packages/sdk-react"
  "packages/sdk-vue"
  "packages/sdk-svelte"
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
  if ! resp="$(curl -sSL --connect-timeout 10 --max-time 30 --retry 3 --retry-all-errors \
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

# Validate lockstep versions up front.
RELEASE_VERSION=""
for dir in "${PACKAGE_DIRS[@]}"; do
  VERSION="$(pkg_field "$dir" version)"
  if [[ -z "$RELEASE_VERSION" ]]; then
    RELEASE_VERSION="$VERSION"
  elif [[ "$RELEASE_VERSION" != "$VERSION" ]]; then
    echo "Expected lockstep versions, found ${RELEASE_VERSION} and ${VERSION} (${dir})" >&2
    exit 1
  fi
done

emit() {
  echo "$1"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "$1" >>"$GITHUB_OUTPUT"
  fi
}

if [[ "$RELEASE_VERSION" == "0.0.0" ]]; then
  echo "Version 0.0.0 is the unreleased placeholder; nothing to publish."
  [[ "$MODE" == "check" ]] && emit "should_publish=false"
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
  # Everything is on npm but the release tag is missing (e.g. a previous run
  # failed after publishing): run publish mode again to finish the release.
  if [[ "$SHOULD_PUBLISH" == "false" ]] &&
    ! git -C "$ROOT_DIR" ls-remote --exit-code --tags origin "refs/tags/v${RELEASE_VERSION}" >/dev/null 2>&1; then
    echo "v${RELEASE_VERSION} is published but not tagged; finishing the release."
    SHOULD_PUBLISH="true"
  fi
  emit "should_publish=${SHOULD_PUBLISH}"
  exit 0
fi

echo "Building and validating packages..."
# smoke:dist loads the built ESM/CJS/IIFE output with Node before publishing.
(cd "$ROOT_DIR" && bun run build && bun run check:pack && bun run smoke:dist)

for dir in "${PACKAGE_DIRS[@]}"; do
  NAME="$(pkg_field "$dir" name)"
  set +e
  registry_has_version "$NAME" "$RELEASE_VERSION"
  rc="$?"
  set -e
  if [[ "$rc" -eq 0 ]]; then
    echo "Already published: ${NAME}@${RELEASE_VERSION}"
    continue
  elif [[ "$rc" -eq 2 ]]; then
    echo "Registry check failed for ${NAME}@${RELEASE_VERSION}" >&2
    exit 2
  fi

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
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
RELEASE_TAGS=("v${RELEASE_VERSION}")
for dir in "${PACKAGE_DIRS[@]}"; do
  RELEASE_TAGS+=("$(pkg_field "$dir" name)-v${RELEASE_VERSION}")
done
for TAG in "${RELEASE_TAGS[@]}"; do
  git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || git tag "$TAG"
done
# Push only this release's tags (never every local tag).
git push origin "${RELEASE_TAGS[@]/#/refs/tags/}"

if command -v gh >/dev/null 2>&1 && [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  export GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  gh release view "v${RELEASE_VERSION}" >/dev/null 2>&1 ||
    gh release create "v${RELEASE_VERSION}" --generate-notes
else
  echo "gh CLI or token unavailable; skipping GitHub Release creation." >&2
fi
