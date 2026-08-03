#!/usr/bin/env bash
# Mutation case for delivery-manifest-check (well-formedness + release.yml artifact-set gate).
# Fixture: a temp cwd holding the REAL delivery-manifest.json and release.yml (green).
# Inject: corrupt the manifest's $schema field → the checker MUST exit 1 (RED).
# Restore: put back the real manifest → the checker MUST exit 0 (GREEN).
# Note: the checker reads from process.cwd(), so each phase runs in a subshell cd'd to workdir.
set -u
name="delivery-manifest-check"
workdir="${1:?usage: $name.sh <workdir>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

mkdir -p "${workdir}/.github/workflows"
cp "${repo_root}/delivery-manifest.json" "${workdir}/delivery-manifest.json"
cp "${repo_root}/.github/workflows/release.yml" "${workdir}/.github/workflows/release.yml"

checker_cmd() {
  ( cd "$1" && node --experimental-strip-types "${repo_root}/scripts/delivery-manifest-check.ts" >/dev/null 2>&1 )
}

# GREEN baseline: real manifest against real release.yml → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on the real manifest (checker always-red?)" >&2
  exit 4
fi

# INJECT: corrupt the manifest $schema → structure invalid → exit 1.
python3 - "$workdir" <<'PY'
import json, sys
p = sys.argv[1] + "/delivery-manifest.json"
d = json.load(open(p))
d["$schema"] = "delivery-manifest-v0-WRONG"
json.dump(d, open(p, "w"), indent=2)
PY
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — corrupted manifest did not redden the checker" >&2
  exit 3
fi

# RESTORE: put back the real manifest → exit 0.
cp "${repo_root}/delivery-manifest.json" "${workdir}/delivery-manifest.json"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored manifest still reddens the checker" >&2
  exit 4
fi

exit 0
