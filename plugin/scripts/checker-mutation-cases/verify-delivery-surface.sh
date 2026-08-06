#!/usr/bin/env bash
# Mutation case for verify-delivery-surface (gap-complete-delivery-surface-spec-and-l1-verification;
# wired as a gate by gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check AC3).
# Fixture: a temp workspace carrying every deliverable of the six-category L1 manifest (the SPEC doc
# is absent, so spec_is_live is n/a and cannot fail).
# Inject: remove ONE deliverable (plugin/scripts/quay-launch.sh, category 3 launch-config) → the
# checker MUST exit 1 (RED — a missing deliverable breaks the "all 6 categories covered" band).
# Restore: recreate the deliverable → the checker MUST exit 0 (GREEN).
set -u
name="verify-delivery-surface"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── build the six-category deliverable tree (mirrors MANIFEST in verify-delivery-surface.ts) ────────
mkdir -p "${workdir}/plugin/scripts" "${workdir}/plugin/loop" "${workdir}/plugin/skills/session-topology" \
  "${workdir}/plugin/skills/cold-start" "${workdir}/.claude"
# cat 1 mechanism-and-runtime
: > "${workdir}/plugin/scripts/quay-init.sh"
: > "${workdir}/plugin/scripts/sync-vendor.sh"
: > "${workdir}/plugin/scripts/verify-installed-executables.sh"
# cat 2 loop-docs
: > "${workdir}/plugin/loop/fast-mode-loop-tick.md"
: > "${workdir}/plugin/loop/orchestrator-loop-tick.md"
# cat 3 launch-config
: > "${workdir}/.claude/launch.settings.json"
: > "${workdir}/plugin/scripts/quay-launch.sh"
# cat 4 session-topology
: > "${workdir}/plugin/scripts/quay-topology.sh"
: > "${workdir}/plugin/scripts/topology-check.sh"
: > "${workdir}/plugin/skills/session-topology/SKILL.md"
# cat 5 periodic-anchor — deliverables intentionally empty (vacuous, always covered)
# cat 6 observation-and-verification
: > "${workdir}/plugin/scripts/verify-delivery-surface.ts"
: > "${workdir}/plugin/skills/cold-start/SKILL.md"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/verify-delivery-surface.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: all 6 categories covered → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a complete delivery surface (checker always-red?)" >&2
  exit 4
fi

# INJECT: remove a category-3 deliverable → category 3 uncovered → 5/6 → RED.
rm -f "${workdir}/plugin/scripts/quay-launch.sh"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a missing deliverable did not redden the checker" >&2
  exit 3
fi

# RESTORE: recreate the deliverable → 6/6 → GREEN.
: > "${workdir}/plugin/scripts/quay-launch.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored deliverable still reddens the checker" >&2
  exit 4
fi

exit 0
