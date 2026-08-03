#!/usr/bin/env bash
# Mutation case for version-consistency-check (fail-closed gate: every version-bearing
# artifact must carry the identical version). Fixture: a temp root with all 8 version
# artifacts pinned to 1.0.0.
# Inject: bump ONE artifact to 1.0.1 → drift → the checker MUST exit 1 (RED).
# Restore: pin it back to 1.0.0 → the checker MUST exit 0 (GREEN).
set -u
name="version-consistency-check"
workdir="${1:?usage: $name.sh <workdir>}"
scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/scripts"

mkdir -p "${workdir}/packages/quay" "${workdir}/packages/quay-native" \
  "${workdir}/packages/quay-github" "${workdir}/packages/quay-backlog" \
  "${workdir}/plugin/.claude-plugin" "${workdir}/plugin/vendor/quay" "${workdir}/.claude-plugin"

mkver() { printf '{\n  "name": "%s",\n  "version": "1.0.0"\n}\n' "$1" > "$2"; }
mkver "quay"        "${workdir}/packages/quay/package.json"
mkver "quay-native" "${workdir}/packages/quay-native/package.json"
mkver "quay-github" "${workdir}/packages/quay-github/package.json"
mkver "quay-backlog" "${workdir}/packages/quay-backlog/package.json"
mkver "quay"        "${workdir}/plugin/vendor/quay/package.json"
printf '{\n  "name": "quay",\n  "version": "1.0.0",\n  "main": "dist/entry.js"\n}\n' > "${workdir}/plugin/.claude-plugin/plugin.json"
printf '[{"name":"quay","version":"1.0.0","source":"github"}]\n' > "${workdir}/plugin/.claude-plugin/marketplace.json"
printf '[{"name":"quay","version":"1.0.0","source":"github"}]\n' > "${workdir}/.claude-plugin/marketplace.json"

checker_cmd() {
  node --experimental-strip-types "${scripts_dir}/version-consistency-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: all 8 artifacts at 1.0.0 → all-equal → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a consistent store (checker always-red?)" >&2
  exit 4
fi

# INJECT: bump packages/quay to 1.0.1 → drift → exit 1.
printf '{\n  "name": "quay",\n  "version": "1.0.1"\n}\n' > "${workdir}/packages/quay/package.json"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — version drift did not redden the checker" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0 → all-equal → exit 0.
mkver "quay" "${workdir}/packages/quay/package.json"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored consistency still reddens the checker" >&2
  exit 4
fi

exit 0
