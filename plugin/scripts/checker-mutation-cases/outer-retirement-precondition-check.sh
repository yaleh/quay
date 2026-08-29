#!/usr/bin/env bash
# Mutation case for outer-retirement-precondition-check (tasks/gap-b0-retirement-precondition-checker-call-surface,
# SPEC §2.3b B0). Fixture: a temp workspace whose execution core references one `-check` checker carrying
# the RETIRED-WITH-RETIRING-LAYER marker (orphan-with-disposition) → GREEN. Inject: strip the marker —
# the exact "只被退役层引用的 checker 无显式退役" shape AC2 requires the checker to go RED on → MUST go
# RED. Restore: put the marker back → back to GREEN.
set -u
name="outer-retirement-precondition-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration" "${workdir}/plugin/scripts"
cd "${workdir}"

printf 'run: plugin/scripts/orphan-check.ts\n' > orchestration/orchestrator-tick-core.md

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/outer-retirement-precondition-check.ts" \
    --root "$1" >/dev/null 2>&1
}

# GREEN baseline: orphan-check.ts carries the RETIRED marker → disposed → exit 0.
cat > plugin/scripts/orphan-check.ts <<'EOF'
// RETIRED-WITH-RETIRING-LAYER (gap-b0): retires with the outer layer
// body
EOF
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a marker-disposed repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: strip the RETIRED marker — the checker is now an orphan WITHOUT a disposition → MUST go RED.
cat > plugin/scripts/orphan-check.ts <<'EOF'
// orphan checker — no marker, no external carrier, no registry
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — an orphan checker without the RETIRED marker did not redden the checker" >&2
  exit 3
fi

# RESTORE: put the marker back → back to GREEN.
cat > plugin/scripts/orphan-check.ts <<'EOF'
// RETIRED-WITH-RETIRING-LAYER (gap-b0): retires with the outer layer
// body
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored marker-disposed repo still reddens the checker" >&2
  exit 4
fi

exit 0
