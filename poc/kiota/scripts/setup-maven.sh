#!/usr/bin/env bash
set -euo pipefail
destination="${RUNNER_TEMP:-.cache/kiota-tools}/kiota-maven"
mkdir -p "$destination"
archive="$destination/apache-maven-3.9.9-bin.tar.gz"
curl --fail --silent --show-error --location \
  https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.9/apache-maven-3.9.9-bin.tar.gz \
  --output "$archive"
expected="a555254d6b53d267965a3404ecb14e53c3827c09c3b94b5678835887ab404556bfaf78dcfe03ba76fa2508649dca8531c74bca4d5846513522404d48e8c4ac8b"
actual="$(shasum -a 512 "$archive" | cut -d ' ' -f 1)"
if [[ "$actual" != "$expected" ]]; then
  echo "Maven 3.9.9 distribution checksum mismatch" >&2
  exit 1
fi
tar -xzf "$archive" -C "$destination"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$destination/apache-maven-3.9.9/bin" >> "$GITHUB_PATH"
fi
"$destination/apache-maven-3.9.9/bin/mvn" --version
