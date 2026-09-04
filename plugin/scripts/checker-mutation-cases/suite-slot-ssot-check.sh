#!/usr/bin/env bash
# Mutation case for suite-slot-ssot-check (gap-suite-concurrency-ff-gate-and-slot-ssot, AC4 行为层不变量).
# Fixture: a minimal workspace where every consumer reads the canonical and NO hardcoded slot-path form
# exists → GREEN. Inject: reintroduce the OLD test.sh hardcoded form (FULL_SUITE_LOCK_0="${...}.0" —
# the exact 结构性编码 shape concurrency-literal-check cannot see) → the checker MUST go RED. Restore:
# remove it → back to GREEN.
set -u
name="suite-slot-ssot-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/scripts"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/suite-slot-ssot-check.ts" --gate --root "$1" >/dev/null 2>&1
}

# A GREEN fixture: the four consumers all read the canonical (I1/I3 pass), no hardcoded slot literal
# (I2 passes), and the bash canonical matches the TS canonical under the default env (I4 passes).
write_green() {
  cat > plugin/scripts/suite-slot-lib.sh <<'EOF'
suite_slot_count() { echo "${QUAY_MAX_CONCURRENT_SUITES:-1}"; }
suite_slot_paths() {
  local base="$1" count i
  count="$(suite_slot_count)"
  i=0
  while [ "$i" -lt "$count" ]; do printf '%s\n' "${base}.${i}"; i=$((i + 1)); done
}
EOF
  cat > scripts/test.sh <<'EOF'
source "${repo_root}/plugin/scripts/suite-slot-lib.sh"
EOF
  cat > plugin/scripts/full-suite-runner.ts <<'EOF'
import { suiteLockSlotPaths } from "./suite-lock-slots.ts";
export const x = 1;
EOF
  cat > plugin/scripts/worktree-process-reaper.ts <<'EOF'
import { suiteLockSlotPaths } from "./suite-lock-slots.ts";
export const y = 2;
EOF
  # The ff gate carries NO global suite lock reference (I1 — reads only the task capture).
  mkdir -p packages/quay/src/fan-in
  cat > packages/quay/src/fan-in/ff-merge.ts <<'EOF'
// reads /tmp/fan-in-suite-${task}.env (the task's own suite certificate)
EOF
}

# GREEN baseline → exit 0.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a green fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: the OLD test.sh hardcoded slot form (FULL_SUITE_LOCK_0 — the structural encoding the literal
# scanner can't see) → I2 MUST go RED.
cat >> scripts/test.sh <<'EOF'
FULL_SUITE_LOCK_0="${FULL_SUITE_LOCK_FILE}.0"
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a hardcoded slot-path form did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the injected line → back to GREEN.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored green fixture still reddens the checker" >&2
  exit 4
fi

exit 0
