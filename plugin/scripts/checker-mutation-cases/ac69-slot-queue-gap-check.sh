#!/usr/bin/env bash
# Mutation case for ac69-slot-queue-gap-check (tasks/gap-ac69-suite-slot-full-should-queue-not-wait,
# AC1 + DoD). Fixture: a temp workspace carrying docs/analysis/ac69-slot-release-vs-dispatch-gap.json
# with the required fields → GREEN. Inject: (1) DELETE the record — the「测量记录没落地」shape AC1/DoD
# requires the checker to go RED on → MUST go non-zero; (2) DROP the conclusion field — a record that
# doesn't state 改法或维持 is NOT a valid AC69 measurement → MUST go non-zero. Restore: put the record
# back complete → GREEN.
set -u
name="ac69-slot-queue-gap-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/docs/analysis"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/ac69-slot-queue-gap-check.ts" --root "$1" >/dev/null 2>&1
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

# GREEN baseline: complete record present → exit 0.
complete_record
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a complete measurement record (checker always-red?)" >&2
  exit 4
fi

# INJECT (1): DELETE the record — AC1/DoD「测量记录已落地」is now absent → MUST go non-zero.
rm -f "${workdir}/docs/analysis/ac69-slot-release-vs-dispatch-gap.json"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN: checker exited 0 with the measurement record DELETED" >&2
  exit 3
fi

# INJECT (2): DROP the conclusion field — a record that doesn't state 改法或维持 is invalid → MUST go non-zero.
complete_record
python3 - <<'PY'
import json
p = "docs/analysis/ac69-slot-release-vs-dispatch-gap.json"
d = json.load(open(p))
del d["conclusion"]
json.dump(d, open(p, "w"))
PY
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN: checker exited 0 with the conclusion field DROPPED" >&2
  exit 3
fi

# RESTORE: put the complete record back → GREEN.
complete_record
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED: checker still non-zero after restoring the complete record" >&2
  exit 4
fi

exit 0
