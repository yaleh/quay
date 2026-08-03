#!/usr/bin/env bash
# AC5 regression #10 — /live's acceptance only tested the data-missing direction.
#
# The day's real failure (twelve-instances-and-two-mappings.md #10): /live's degradation was
# perfect and its acceptance covered the "no data" direction (missing → 无数据), but the
# "activity exists but telemetry empty" direction was never covered — the state where the loop
# is demonstrably alive (recent commits / fresh tick log) yet has written nothing to
# `.workflow-events/`. `decideLiveState` (packages/quay/src/observation.ts) exists to tell
# `running-unwired` (alive but unwired) apart from `not-running` (dead); a broken discriminator
# that ignores activity would silently collapse both into one state.
#
# This case pins the previously-missing direction: a contract checker verifies that
# activity-present + telemetry-empty ⇒ `running-unwired`. Injecting a MUTATED discriminator that
# ignores activity must make the checker go RED; pointing back at the real discriminator GREEN.
set -u
name="regression-live-telemetry-empty-activity"
workdir="${1:?usage: $name.sh <workdir>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REAL_DISCRIMINATOR="${repo_root}/packages/quay/src/observation.ts"

# The checker: a node script that imports a discriminator module path (argv[2]) and asserts
# the activity-present-telemetry-empty direction ⇒ running-unwired. Exit 0 iff the discriminator
# answers correctly; exit 1 otherwise.
cat > "${workdir}/live-check.mjs" <<'EOF'
const modPath = process.argv[2];
const { decideLiveState } = await import(modPath);
const act = { recentCommits: 2, tickLogFresh: true, tickLogAgeMinutes: 5, anyRecentActivity: true };
const r = decideLiveState(act);
if (r.state !== "running-unwired") {
  console.error(`FAIL: activity present but telemetry empty → state=${r.state} (expected running-unwired)`);
  process.exit(1);
}
console.log(`OK: activity present but telemetry empty → state=${r.state}`);
EOF

# A MUTATED discriminator: ignores activity — the #10 hole (returns not-running regardless).
cat > "${workdir}/broken-discriminator.ts" <<'EOF'
export function decideLiveState(_activity) {
  return { state: "not-running", explanation: "MUTATED: activity signals ignored" };
}
EOF

checker() { node --experimental-strip-types "${workdir}/live-check.mjs" "$1" >/dev/null 2>&1; }

# GREEN: the REAL discriminator answers running-unwired for activity-present-telemetry-empty.
if checker "${REAL_DISCRIMINATOR}"; then :; else
  echo "baseline RED on the real discriminator (the direction was never covered?)" >&2
  exit 4
fi

# INJECT: the mutated discriminator (activity ignored) → the checker MUST red.
if checker "${workdir}/broken-discriminator.ts"; then
  echo "STAYED-GREEN — broken discriminator passed the contract check" >&2
  exit 3
fi

# RESTORE: back to the real discriminator → green.
if checker "${REAL_DISCRIMINATOR}"; then :; else
  echo "ALWAYS-RED — real discriminator still fails" >&2
  exit 4
fi

echo "activity-present-telemetry-empty ⇒ running-unwired is covered (#10 direction)."
exit 0
