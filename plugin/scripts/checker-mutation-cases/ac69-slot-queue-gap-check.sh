#!/usr/bin/env bash
# Mutation case for ac69-slot-queue-gap-check (tasks/gap-ac69-suite-slot-full-should-queue-not-wait,
# AC1 + DoD; exit-code contract per tasks/gap-ac69-malformed-record-exits-3-and-passes-the-static-gate).
# Fixture: a temp workspace carrying docs/analysis/ac69-slot-release-vs-dispatch-gap.json with the
# required fields → GREEN. Inject: (1) DELETE the record — the「测量记录没落地」shape AC1/DoD requires
# the checker to go RED on → MUST go red; (2) DROP the conclusion field — a record that doesn't state
# 改法或维持 is NOT a valid AC69 measurement → MUST go red. Restore: put the record back → GREEN.
#
# ⛔ Each fault is judged through the PRODUCTION wrapper `run_checker` (checker-cost-lib.sh), NOT the
# raw checker exit code. run_checker maps exit 3 (NOT-EVALUATED) to a NON-FATAL result: it prints
# STATIC_CHECK_NOT_EVALUATED, returns 0, and the static gate stays green (a corrupted record would
# not block a landing). So "the raw checker exited non-zero" proves nothing — a checker that exits 3
# on a corrupt record passes that assertion while the production gate never goes red. This case
# previously made exactly that mistake (gap-ac69-malformed-record-exits-3-and-passes-the-static-gate).
# A fault counts as caught ONLY when run_checker returns non-zero (fail-closed RED, surfaced on
# stderr as `STATIC_CHECK_FAILED: <name> exit=<rc>`).
set -u
name="ac69-slot-queue-gap-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The production wrapper, with its cost ledger redirected into the throwaway workdir.
. "${checker_dir}/checker-cost-lib.sh"
CHECKER_COST_FILE="${workdir}/checker-cost.jsonl"
RUN_CHECKER_PARALLEL=0

mkdir -p "${workdir}/docs/analysis"
cd "${workdir}"

# Gate verdict for one injected state: return 0 iff the PRODUCTION gate went RED (a landing blocker),
# 1 iff it stayed GREEN (a pass, or the non-fatal exit-3 NOT-EVALUATED). The wrapper's own
# STATIC_CHECK_FAILED / STATIC_CHECK_NOT_EVALUATED machine line is echoed so the log shows WHY.
gate_red() {
  local _rc=0 _out
  _out="$(run_checker "${name}" node --no-warnings --experimental-strip-types \
    "${checker_dir}/ac69-slot-queue-gap-check.ts" --root "$1" 2>&1)" || _rc=$?
  printf '%s\n' "${_out}"
  [ "${_rc}" -ne 0 ]
}

complete_record() {
  cat > "${workdir}/docs/analysis/ac69-slot-release-vs-dispatch-gap.json" <<'EOF'
{
  "task": "gap-ac69-suite-slot-full-should-queue-not-wait",
  "measuredAt": "2026-08-14T00:00:00Z",
  "dataSource": ".quay/verification-round.jsonl",
  "method": "suite terminal-state write: end(N) = startedAt(N)+durationMs(N); gap = start(N+1)-end(N)",
  "stats": { "medianSeconds": 123.4 },
  "conclusion": "maintain",
  "conclusionReason": "median gap ~123s (~2 min), NOT a full tick period (1200-1800s); maintain the 2-slot model."
}
EOF
}

# GREEN baseline: complete record present → the gate stays green.
complete_record
if gate_red "${workdir}"; then
  echo "baseline RED on a complete measurement record (checker always-red?)" >&2
  exit 4
fi

# INJECT (1): DELETE the record — AC1/DoD「测量记录已落地」is now absent → the gate MUST go RED.
rm -f "${workdir}/docs/analysis/ac69-slot-release-vs-dispatch-gap.json"
if ! gate_red "${workdir}"; then
  echo "STAYED-GREEN: the production gate stayed green with the measurement record DELETED" >&2
  exit 3
fi

# INJECT (2): DROP the conclusion field — a record that doesn't state 改法或维持 is invalid → MUST go red.
complete_record
python3 - <<'PY'
import json
p = "docs/analysis/ac69-slot-release-vs-dispatch-gap.json"
d = json.load(open(p))
del d["conclusion"]
json.dump(d, open(p, "w"))
PY
if ! gate_red "${workdir}"; then
  echo "STAYED-GREEN: the production gate stayed green with the conclusion field DROPPED" >&2
  exit 3
fi

# RESTORE: put the complete record back → the gate stays green.
complete_record
if gate_red "${workdir}"; then
  echo "ALWAYS-RED: the production gate is still red after restoring the complete record" >&2
  exit 4
fi

exit 0
