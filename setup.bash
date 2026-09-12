#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
for tool in bun podman; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
done
# No privileged fallback: missing resource controllers make jobs fail closed.
bun install --frozen-lockfile
podman --remote=false build -t localhost/codefort-sandbox:local -f Containerfile .
echo 'Set CODEFORT_API_KEY to a random secret of at least 32 characters, then run bun start.'
