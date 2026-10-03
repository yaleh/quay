#!/usr/bin/env bash
# Mutation case for target-identity-literal-check (GOAL-012 B 域, tasks/gap-ac226-…).
# The defect: a shipped kernel file regains an override-less bare identity literal — a per-project
# identity (branch name / test_command / tasks_dir) written as a bare quoted string with no override
# channel (no `?? env` / `?? getArgValue` / runtime derivation). The checker MUST go RED on each of
# the THREE identity kinds (GOAL-012 风险 4: 不止一种形态), GREEN on a clean file, and GREEN on
# legal protocol defaults (develop/integration/master/tasks — 逐项目不变, 负控制).
# Fixture: a hermetic temp root carrying plugin/scripts/fixture.ts — no git dependency.
# Phases:
#   baseline   clean fixture.ts → GREEN (0)
#   inject (branch)        `export const DOC_BRANCH = "author"` → RED (1)
#   restore   clean → GREEN (0)
#   inject (test-command)  `export const test_command = "npm test"` → RED (1)
#   restore   clean → GREEN (0)
#   inject (tasks-dir)     `export const tasks_dir = "my-tasks"` → RED (1)
#   restore   clean → GREEN (0)
#   inject (legal defaults) develop/integration/master/tasks 裸字面量 → GREEN (0) — 合法默认值不误报
#   restore   clean → GREEN (0)
#   inject (goal branch, live)     `GOAL_BRANCH = "goal/GOAL-901"` + GOAL-901 active+branch:true → GREEN (0)
#   inject (goal branch, retired)  same literal, GOAL-901 retired → RED (1)
#   remove goal store              same literal, no goals/ → exit 3 (NOT-EVALUATED, ⛔ never legal)
#   restore   clean → GREEN (0, final)
set -u
name="target-identity-literal-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cd "${workdir}"

# A minimal clean shipped-kernel fixture (no override-less identity literal).
write_clean() {
  cat > plugin/scripts/fixture.ts <<'EOF'
// 正确的身份派生形态：doc 分支经 resolveDocBranch 运行时派生，test_command/tasks_dir 读 config/env。
import { resolveDocBranch } from "./driver-filters.ts";
export function docBranch(root: string) {
  return resolveDocBranch(root) ?? null; // 读分支失败 ⇒ null，⛔ 不兜底裸字面量
}
EOF
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/target-identity-literal-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
}

# GREEN baseline: clean file → exit 0.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on a clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (branch): a bare no-override branch literal `DOC_BRANCH = "author"` → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
export const DOC_BRANCH = "author";
EOF
if checker_cmd; then
  echo 'STAYED-GREEN — `export const DOC_BRANCH = "author"` did not redden the checker (bare branch literal slips through)' >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the branch inject still reddens the checker" >&2
  exit 4
fi

# INJECT (test-command): a bare test_command literal → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
export const test_command = "npm test";
EOF
if checker_cmd; then
  echo 'STAYED-GREEN — `export const test_command = "npm test"` did not redden the checker (bare test_command literal slips through)' >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the test-command inject still reddens the checker" >&2
  exit 4
fi

# INJECT (tasks-dir): a bare tasks_dir literal (non-default dir) → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
export const tasks_dir = "my-tasks";
EOF
if checker_cmd; then
  echo 'STAYED-GREEN — `export const tasks_dir = "my-tasks"` did not redden the checker (bare tasks_dir literal slips through)' >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the tasks-dir inject still reddens the checker" >&2
  exit 4
fi

# INJECT (legal defaults): develop/integration/master/tasks 裸字面量 → STILL GREEN (逐项目不变, 负控制).
cat > plugin/scripts/fixture.ts <<'EOF'
export const DEV_BRANCH = "develop";
export const INTEGRATION_REF = "integration";
export const MASTER_REF = "master";
export const TASKS_DIR_DEFAULT = "tasks";
export const HEAD_REF = "HEAD";
EOF
if checker_cmd; then :; else
  echo "FALSE-RED — legal protocol defaults (develop/integration/master/tasks/HEAD) reddened the checker (负控制未生效)" >&2
  exit 4
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the legal-default inject still reddens the checker" >&2
  exit 4
fi

# ── goal-branch token rule (SPEC-goal-branch §4.8) ──────────────────────────────────────────────
# `goal/<GOAL-NNN>` is a DERIVED branch name: a literal spelling one is legal ONLY while the GOAL it
# names is a live branch-mode goal. The three phases below pin the whole rule:
#   (a) GOAL live (active + branch:true) → GREEN
#   (b) GOAL retired                    → RED   (its branch must be gone)
#   (c) no goal store at all            → exit 3 NOT-EVALUATED (⛔ never admitted as legal)
write_goal_literal() {
  cat > plugin/scripts/fixture.ts <<'EOF'
export const GOAL_BRANCH = "goal/GOAL-901";
EOF
}
write_goal_record() {
  mkdir -p goals
  cat > goals/GOAL-901-fixture.md <<EOF
---
id: GOAL-901
title: mutation fixture
status: $1
kind: goal
branch: true
origin: mutation case
---
body
EOF
}

write_goal_literal
write_goal_record active
if checker_cmd; then :; else
  echo 'FALSE-RED — a bare `goal/GOAL-901` literal with GOAL-901 recorded active+branch:true reddened the checker (the derived goal-branch identity must be LEGAL while the goal is live)' >&2
  exit 4
fi

write_goal_record retired
checker_cmd; rc=$?
if [ "$rc" -eq 0 ]; then
  echo 'STAYED-GREEN — a `goal/GOAL-901` literal with GOAL-901 RETIRED did not redden the checker (a literal naming a discarded branch slips through)' >&2
  exit 3
fi
if [ "$rc" -ne 1 ]; then
  echo "UNEXPECTED-RC — expected RED (1) for a retired-goal branch literal, got ${rc}" >&2
  exit 2
fi

rm -rf goals
checker_cmd; rc=$?
if [ "$rc" -ne 3 ]; then
  echo "WRONG-WITHHOLD — an unreadable goal store must withhold the verdict (exit 3), got ${rc}" >&2
  exit 2
fi

# RESTORE: clean again → GREEN (final).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the goal-branch injects still reddens the checker" >&2
  exit 4
fi

exit 0
