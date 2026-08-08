#!/usr/bin/env bash
# Mutation case for instrument-failure-check (gap-manager-instrument-failures-need-mechanical-
# detection-not-carefulness, AC3/AC5). The checker's two gate semantics:
#   (a) band — all five manager-instrument failure families must stay mechanically detectable in
#       the tick-doc surface (the ## Contract `detected_families ≥ 5`);
#   (b) shrink-only — each family's hit count must stay ≤ FAMILY_BASELINE[n]; a NEW failure-form
#       instance beyond the documented baseline red-lights.
# Fixture: a copy of the real 5-doc surface → GREEN. Inject: a NEW family-1 self-match command
# (`pgrep -f '<literal>'`) appended to a scanned doc → the checker MUST go RED (shrink-only).
# Restore: remove the injected line → back to GREEN. Also prove the band direction: deleting a
# documented family-3 row reddens (band), restoring it re-greens.
set -u
name="instrument-failure-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${checker_dir}/../.." && pwd)"

# The ## Contract scan surface (must match instrument-failure-check.ts DEFAULT_SURFACE).
surface="orchestration/manager-loop-tick.md
orchestration/orchestrator-loop-tick.md
plugin/loop/fast-mode-loop-tick.md
plugin/loop/manager-loop-tick.md
plugin/loop/orchestrator-loop-tick.md"

copy_surface() {
  local dest="$1"
  echo "${surface}" | while IFS= read -r rel; do
    [ -n "${rel}" ] || continue
    mkdir -p "$(dirname "${dest}/${rel}")"
    cp "${repo_root}/${rel}" "${dest}/${rel}"
  done
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/instrument-failure-check.ts" --gate --root "$1" >/dev/null 2>&1
}

# GREEN baseline: the real documented surface (a byte-identical copy) → exit 0.
copy_surface "${workdir}"
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on the real documented surface (checker always-red?)" >&2
  exit 4
fi

# INJECT (shrink-only): a NEW family-1 self-match command appended to a scanned doc → MUST go RED.
echo "" >> "${workdir}/orchestration/orchestrator-loop-tick.md"
echo "> pgrep -f 'quay.ts serve' 又一条自匹配" >> "${workdir}/orchestration/orchestrator-loop-tick.md"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected a new failure-form instance did not redden the checker" >&2
  exit 3
fi

# RESTORE (shrink-only): drop the injected line → back to GREEN.
sed -i "/pgrep -f 'quay.ts serve' 又一条自匹配/d" "${workdir}/orchestration/orchestrator-loop-tick.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored surface (injected line removed) still reddens the checker" >&2
  exit 4
fi

# INJECT (band): delete a documented family-3 row in BOTH manager docs → family 3 drops to 0 → MUST go RED.
for rel in orchestration/manager-loop-tick.md plugin/loop/manager-loop-tick.md; do
  # 管道后读 appears only in the §4 family-3 rows of these two docs — deleting that line is the band mutation.
  sed -i "/管道后读/d" "${workdir}/${rel}"
done
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — deleting the documented family-3 row (band violation) did not redden the checker" >&2
  exit 3
fi

# RESTORE (band): re-add the family-3 rows from the pristine copy → back to GREEN.
copy_surface "${workdir}"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored surface (family-3 rows re-added) still reddens the checker" >&2
  exit 4
fi

exit 0
