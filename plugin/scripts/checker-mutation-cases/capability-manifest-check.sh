#!/usr/bin/env bash
# Mutation case for capability-manifest-check (bidirectional capability↔delivery-manifest enumeration).
# Fixture: the REAL delivery-manifest.json against the real repo source (GREEN baseline).
# Inject: remove one driver-kind entry (goal — the AC-202 unregistered-capability direction) AND add
#   a nonexistent driver-kind (stale-registration direction) → the checker MUST exit 1 (RED).
# Restore: put back the real manifest → the checker MUST exit 0 (GREEN).
# The checker reads source (driver-runtime.ts via import, quay.ts + packages/*/src/mcp-server.ts via
# --root) from the repo and ONLY the manifest via --manifest, so injecting a mutated manifest copy is
# sufficient — no source copy needed.
set -u
name="capability-manifest-check"
workdir="${1:?usage: $name.sh <workdir>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

mkdir -p "${workdir}"
cp "${repo_root}/delivery-manifest.json" "${workdir}/delivery-manifest.json"

checker_cmd() {
  ( node --no-warnings --experimental-strip-types \
      "${repo_root}/plugin/scripts/capability-manifest-check.ts" \
      --root "${repo_root}" --manifest "$1" >/dev/null 2>&1 )
}

# GREEN baseline: real manifest → exit 0.
if checker_cmd "${workdir}/delivery-manifest.json"; then :; else
  echo "baseline RED on the real manifest (checker always-red?)" >&2
  exit 4
fi

# INJECT: remove the "goal" driver-kind (unregistered) + add a "nonexistent" driver-kind (stale).
python3 - "${workdir}" <<'PY'
import json, sys
p = sys.argv[1] + "/delivery-manifest.json"
d = json.load(open(p))
d["capabilities"] = [c for c in d["capabilities"] if not (c.get("kind") == "driver-kind" and c.get("name") == "goal")]
d["capabilities"].append({"name": "nonexistent", "kind": "driver-kind", "sourceRef": "x"})
json.dump(d, open(p, "w"), indent=2)
PY
if checker_cmd "${workdir}/delivery-manifest.json"; then
  echo "STAYED-GREEN — unregistered+stale capability did not redden the checker" >&2
  exit 3
fi

# RESTORE: put back the real manifest → exit 0.
cp "${repo_root}/delivery-manifest.json" "${workdir}/delivery-manifest.json"
if checker_cmd "${workdir}/delivery-manifest.json"; then :; else
  echo "ALWAYS-RED — restored manifest still reddens the checker" >&2
  exit 4
fi

exit 0
