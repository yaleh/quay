#!/usr/bin/env bash
# Mutation case for judgment-consumer-check (gap-judgment-computed-not-wired-to-action — the class-
# level discipline "每个机械判据必须有消费它的动作" made mechanical). The checker's own ## Contract
# negative control: "a judgment declared `wired` whose consumer pattern is missing MUST go RED;
# restore the consumer → back to GREEN."
# Fixture: a temp workspace whose execution-core doc carries the consumer pattern.
# Inject:   the consumer pattern is REMOVED while the judgment stays declared `wired` — the exact
#           defect class (signal computed, no action wired) → the checker MUST go RED.
# Restore:  re-add the consumer pattern → back to GREEN.
set -u
name="judgment-consumer-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration"
doc="${workdir}/orchestration/orchestrator-tick-core.md"
entry='{"judgment":"test-deficit","verify":[{"file":"orchestration/orchestrator-tick-core.md","pattern":"deficit\\s*>\\s*0","expect":"present"}],"status":"wired"}'

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/judgment-consumer-check.ts" --root "$1" --judge-entry "${entry}" >/dev/null 2>&1
}

# GREEN baseline: the execution-core doc carries the consumer pattern (`deficit > 0` trigger) → exit 0.
printf 'B9 第三触发器：deficit > 0 ⇒ ready-pool-check --apply\n' > "${doc}"
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a wired consumer (checker always-red?)" >&2
  exit 4
fi

# INJECT the defect: a judgment STILL declared `wired` but its consumer pattern is GONE → MUST go RED.
printf 'B9 触发器已删——没有 deficit 触发器了\n' > "${doc}"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a wired-declared judgment whose consumer is missing did not redden the checker" >&2
  exit 3
fi

# RESTORE the consumer pattern → back to GREEN.
printf 'B9 第三触发器：deficit > 0 ⇒ ready-pool-check --apply（恢复）\n' > "${doc}"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored consumer (deficit > 0 present) still reddens the checker" >&2
  exit 4
fi

exit 0
