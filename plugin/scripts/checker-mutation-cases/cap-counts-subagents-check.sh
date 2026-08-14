#!/usr/bin/env bash
# Mutation case for cap-counts-subagents-check (AC76 in-flight = CONCURRENT SUBAGENTS checker).
# Fixture: a temp repo whose plugin/scripts/slot-refill.ts carries BOTH canonical markers — the
# canonical comment names the measured object (被计量对象 = 并发 subagent) AND forbids the worktree
# proxy (禁 worktree 代理), AND carries the RETIRED (AC76 C24-2) annotation (判据5) → GREEN.
# Inject: REMOVE the canonical comment (the exact 判据1 defect — the canonical block no longer names
# the measured object) → the checker MUST go RED while 判据5 stays green. Restore → back to GREEN.
set -u
name="cap-counts-subagents-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"

write_slot_refill() { # <canonical-line...> — write slot-refill.ts with the given canonical lines
  cat > "${workdir}/plugin/scripts/slot-refill.ts" <<EOF
// slot-refill.ts — canonical comment
$1
$2
// RETIRED (AC76 C24-2) — MEASURED IN-FLIGHT DEFAULT telemetry fallback 在飞读法退役
export const ok = 1;
EOF
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/cap-counts-subagents-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: the canonical comment names 并发 subagent AND forbids the worktree proxy → 判据1
# green; the RETIRED marker keeps 判据5 green → aggregate exit 0.
write_slot_refill \
  '// 被计量对象 = 并发 subagent (the measured object is concurrent subagents)' \
  '// 禁 worktree 代理 (worktree count is not the measured object)'
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a canonical slot-refill.ts (checker always-red?)" >&2
  exit 4
fi

# INJECT: drop the canonical comment — the measured-object/forbid-worktree markers are gone (判据1
# defect). The RETIRED marker is kept, so 判据5 stays green and the RED comes from 判据1 alone.
write_slot_refill \
  '// slot-refill.ts — canonical comment REMOVED (defect)' \
  '// (no measured-object marker, no forbid-worktree marker)'
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — removed canonical measured-object marker did not redden the checker" >&2
  exit 3
fi

# RESTORE: put the canonical comment back → 判据1 green again.
write_slot_refill \
  '// 被计量对象 = 并发 subagent (the measured object is concurrent subagents)' \
  '// 禁 worktree 代理 (worktree count is not the measured object)'
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored canonical slot-refill.ts still reddens the checker" >&2
  exit 4
fi

exit 0
