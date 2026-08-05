#!/usr/bin/env bash
# Mutation case for strategic-doc-staleness-check (gap-establish-daily-review-cadence-mechanism,
# AC2/AC3/AC8 — the generic strategic-doc staleness checker).
# Fixture: a temp workspace whose docs/proposals holds only a CLEAN strategic doc → GREEN.
# Inject: a NEW strategic doc that references a deleted classic-pipeline script
#   (execute-milestone.js, ADR-022-deleted) WITHOUT annotation → the checker MUST go RED.
# Restore: remove the injected doc → back to GREEN.
set -u
name="strategic-doc-staleness-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/docs/proposals" "${workdir}/orchestration"
cat > "${workdir}/docs/proposals/clean.md" <<'EOF'
# Clean strategic doc

A forward-looking doc that references only the current two-layer fast mode.
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/strategic-doc-staleness-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: clean doc, no stale refs → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean strategic doc (checker always-red?)" >&2
  exit 4
fi

# INJECT: a NEW stale strategic doc referencing a deleted classic-pipeline script, unannotated →
# NOT in the KNOWN_STALE baseline → MUST go RED.
cat > "${workdir}/docs/proposals/stale.md" <<'EOF'
# Stale proposal

Phase 2 will deploy the prepare-milestone.js + execute-milestone.js pipeline.
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected stale strategic doc did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the stale doc → back to green.
rm -f "${workdir}/docs/proposals/stale.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored clean tree still reddens the checker" >&2
  exit 4
fi

exit 0
