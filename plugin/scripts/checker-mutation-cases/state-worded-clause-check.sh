#!/usr/bin/env bash
# Mutation case for state-worded-clause-check (gap-ac41-actionize-state-worded-clauses, AC4 — the
# result-state-clause checker). The checker's own ## Contract control:
# "一条可执行条款必须是「跑什么命令/产出什么可核物」，不写「确保/保证/自测绿」这类结果状态".
# Fixture: an actionized tick-doc fragment → GREEN.
# Inject: the 2026-08-10 incident shape — orchestrator A15 ④'s 自测绿 (result state, not an action) →
#         the checker MUST go RED.
# Restore: the actionized form (run scripts/test.sh in the worktree until verification-round.jsonl
#          carries scope=worktree + state=green) → back to GREEN.
set -u
name="state-worded-clause-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="${workdir}/tick-core-fragment.md"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/state-worded-clause-check.ts" --judge "$1" >/dev/null 2>&1
}

# GREEN baseline: the ACTIONIZED form — every executable clause names a command + a readable product.
printf 'integration 切 branch→修→在自带 worktree 里跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green` 记录→fan-in。\n' > "${fixture}"
if checker_cmd "${fixture}"; then :; else
  echo "baseline RED on the actionized form (checker always-red?)" >&2
  exit 4
fi

# INJECT the incident shape: 自测绿 — a result state ("green"), not an action. This is exactly the
# 2026-08-10 shape that made two suite-fix subagents behave oppositely (scope=main failure vs
# scope=worktree success). The checker MUST go RED.
printf 'integration 切 branch→修→自测绿→fan-in。\n' > "${fixture}"
if checker_cmd "${fixture}"; then
  echo "STAYED-GREEN — a 自测绿 result-state clause did not redden the checker" >&2
  exit 3
fi

# RESTORE: back to the actionized form → GREEN (the AC4 +1 → 0 direction).
printf 'integration 切 branch→修→在自带 worktree 里跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green` 记录→fan-in。\n' > "${fixture}"
if checker_cmd "${fixture}"; then :; else
  echo "ALWAYS-RED — restored (actionized) fragment still reddens the checker" >&2
  exit 4
fi

# 确保 variant — the same result-state class, must also go RED.
printf '套件启动前先确保 develop 已含全部批量合。\n' > "${fixture}"
if checker_cmd "${fixture}"; then
  echo "STAYED-GREEN — a 确保 result-state clause did not redden the checker" >&2
  exit 3
fi

exit 0
