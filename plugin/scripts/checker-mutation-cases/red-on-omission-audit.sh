#!/usr/bin/env bash
# Mutation case for red-on-omission-audit (gap-red-on-omission-audit-needs-mutation-case, AC2 —
# the checker was registered by e532d599 but had no mutation case, red-lighting the
# checker-mutation gate with uncovered: red-on-omission-audit).
#
# The checker's core claim (AC41 判据 3): every solidified behavior must be able to point at a
# reading that turns RED when the behavior is NOT done. It mechanically verifies each registry
# entry's redReading is DECLARED in tracked files (readUnder/fileExists — never self-asserted,
# hard rule 4); removing a red-reading declaration ⇒ uncov>0 ⇒ exit 1. So the natural mutation is
# to DELETE a declared red-reading and assert the checker goes RED — exactly the defect it exists
# to catch (a behavior whose red-reading declaration disappears silently).
#
# Fixture: a temp copy of the tracked files the registry verify surface reads (the 9 files from
# readUnder/fileExists in red-on-omission-audit.ts) → GREEN.
# Inject: replace the `ruling5_status` field declaration in the copied orchestrator-tick-core.md
# (the A15 ② self-report field) with XXXX_status — this is the exact AC3/AC4 mutation the
# checker's own test pins (red-on-omission-audit.test.mjs) — the a15_ruling5 + ruling5_status
# invariants break (uncov>0) → the checker MUST go RED.
# Restore: re-copy the pristine tick core → back to GREEN.
set -u
name="red-on-omission-audit"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${checker_dir}/../.." && pwd)"

# The tracked files the checker's registry verify reads (must ALL be present in the temp root,
# or readUnder returns "" / fileExists false and the checker reddens on baseline — that is the
# ALWAYS-RED signal, not a valid baseline).
copy_surface() {
  local dest="$1"
  local rel
  for rel in \
    orchestration/orchestrator-tick-core.md \
    plugin/scripts/semantic-observer-judge.ts \
    plugin/scripts/full-suite-runner.ts \
    .claude/workflows/execute-suite-fix.js \
    plugin/scripts/adr016-screen-use-check.ts \
    plugin/scripts/drive-contract-check.ts \
    plugin/scripts/resource-gate.sh \
    plugin/scripts/task-contract-check.ts \
    scripts/test.sh; do
    mkdir -p "$(dirname "${dest}/${rel}")"
    cp "${repo_root}/${rel}" "${dest}/${rel}"
  done
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/red-on-omission-audit.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: a byte-identical copy of the real tracked verify surface → exit 0.
copy_surface "${workdir}"
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on the real tracked surface (checker always-red?)" >&2
  exit 4
fi

# INJECT: remove the ruling5_status red-reading declaration (replace with XXXX_status, the same
# mutation the checker's own test pins) → a15_ruling5 + ruling5_status invariants break, uncov>0
# → the checker MUST go RED.
sed -i 's/ruling5_status/XXXX_status/g' "${workdir}/orchestration/orchestrator-tick-core.md"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — removing the ruling5_status red-reading declaration did not redden the checker" >&2
  exit 3
fi

# RESTORE: re-copy the pristine tick core → back to GREEN.
cp "${repo_root}/orchestration/orchestrator-tick-core.md" "${workdir}/orchestration/orchestrator-tick-core.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored surface (ruling5_status re-declared) still reddens the checker" >&2
  exit 4
fi

exit 0
