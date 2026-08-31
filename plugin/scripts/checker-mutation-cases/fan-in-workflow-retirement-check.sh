#!/usr/bin/env bash
# Mutation case for fan-in-workflow-retirement-check (tasks/gap-fan-in-workflow-retirement-guard,
# 人裁定迁移序 L3). The defect: a retired fan-in-execute.js workflow "resurrects" — EITHER (AC1/AC3)
# a non-wk-prod-prefixed acquire appears in the production fan-in lock-events carrier
# (.quay/fan-in-lock-events.jsonl), OR (AC2) a surviving executable reference to `fan-in-execute`
# remains after the dual copies are deleted. The checker must go RED on either, GREEN on neither.
# Fixture: a hermetic NON-git root with `--since-epoch 0` (window = all acquires; the windowing /
# deriveL1Epoch fallback is unit-tested separately, so the mutation case carries no git dependency).
# Phases:
#   baseline   no dual copies, no references, lock-events = wk-prod- + mfi- acquires only → GREEN (0)
#   inject (AC1/AC3)  add a non-wk-prod acquire (fm-*) → RED (1)
#   restore    back to mechanical-only → GREEN (0)
#   inject (AC2)  add a surviving executable reference → RED (1)
#   restore    remove the reference → GREEN (0)
set -u
name="fan-in-workflow-retirement-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/.quay"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/fan-in-workflow-retirement-check.ts" \
    --root "${workdir}" --since-epoch 0 >/dev/null 2>&1
}

# lock-events: only mechanical acquires (wk-prod- driver 轮次 + mfi- per-suite 机械身份) → AC1/AC3 绿.
write_lock_events_green() {
  cat > .quay/fan-in-lock-events.jsonl <<'EOF'
{"event":"acquire","ts":"2026-08-31T00:00:00Z","epoch":100,"taskId":"t1","pid":1,"runId":"wk-prod-1788056585","agentId":null}
{"event":"acquire","ts":"2026-08-31T01:00:00Z","epoch":200,"taskId":"t2","pid":2,"runId":"mfi-t2-1788158532259-manual3","agentId":null}
EOF
}

# lock-events: a non-wk-prod acquire (fm-* = old workflow 复活) → AC1/AC3 红.
write_lock_events_red() {
  cat > .quay/fan-in-lock-events.jsonl <<'EOF'
{"event":"acquire","ts":"2026-08-31T00:00:00Z","epoch":100,"taskId":"t1","pid":1,"runId":"wk-prod-1788056585","agentId":null}
{"event":"acquire","ts":"2026-08-31T01:00:00Z","epoch":200,"taskId":"t2","pid":2,"runId":"fm-t2-1","agentId":null}
EOF
}

# GREEN baseline: mechanical-only lock-events, no dual copies, no references → exit 0.
write_lock_events_green
if checker_cmd; then :; else
  echo "baseline RED on a green fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (AC1/AC3): non-wk-prod acquire (fm-*) → the checker MUST go RED.
write_lock_events_red
if checker_cmd; then
  echo "STAYED-GREEN — a non-wk-prod acquire did not redden the checker (旧 workflow 复活 slips through)" >&2
  exit 3
fi

# RESTORE: mechanical-only again → back to GREEN.
write_lock_events_green
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored mechanical-only lock-events still reddens the checker" >&2
  exit 4
fi

# INJECT (AC2): dual copies absent but a surviving executable reference remains → MUST go RED.
mkdir -p plugin/scripts
printf '#!/usr/bin/env bash\nrun fan-in-execute.js "$@"\n' > plugin/scripts/quay-init.sh
if checker_cmd; then
  echo "STAYED-GREEN — a surviving fan-in-execute reference did not redden the checker (旧 workflow 复活 path remains)" >&2
  exit 3
fi

# RESTORE: remove the reference → back to GREEN.
rm -f plugin/scripts/quay-init.sh
if checker_cmd; then :; else
  echo "ALWAYS-RED — removing the surviving reference still reddens the checker" >&2
  exit 4
fi

exit 0
