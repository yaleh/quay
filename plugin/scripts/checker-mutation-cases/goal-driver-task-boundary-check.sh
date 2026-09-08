#!/usr/bin/env bash
# Mutation case for goal-driver-task-boundary-check (DIR-131, tasks/gap-goal-driver-task-boundary-check).
# The defect: goal-driver.ts regains a task-write call surface — EITHER a task-mechanism verb
# (task_write / lifecycle_*) OR a write-family call targeting tasks/ — OR (DIR-131 AC6) a read of a
# fan-in / 落地率 carrier (the mis-attribution counter-example). The checker must go RED on a REAL
# call / carrier read at a CODE position, GREEN on the comment form (硬规则 2: 注释/字符串不算调用面)
# and GREEN on a clean file. Fixture: a hermetic temp root carrying plugin/scripts/goal-driver.ts;
# the checker resolves its target from --root, so no git dependency.
# Phases:
#   baseline   clean goal-driver.ts → GREEN (0)
#   inject (comment form)  append a `// task_write` comment → STILL GREEN (must not false-red)
#   restore    clean again → GREEN (0)
#   inject (verb)  append a real `task_write(...)` call → RED (1)
#   restore    clean again → GREEN (0)
#   inject (write-to-tasks)  append fs.writeFileSync(path.join(root,"tasks","x.md"),"") → RED (1)
#   restore    clean again → GREEN (0)
#   inject (fan-in comment)  append a `// fan-in 落地率…` comment → STILL GREEN (must not false-red)
#   restore    clean again → GREEN (0)
#   inject (fan-in carrier)  append `".quay/fan-in-step-trace.jsonl"` → RED (1)
#   restore    clean again → GREEN (0)
set -u
name="goal-driver-task-boundary-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cd "${workdir}"

# A minimal clean goal-driver.ts (read-only shape: a task read path, no write surface).
write_clean() {
  cat > plugin/scripts/goal-driver.ts <<'EOF'
import fs from "node:fs";
// 读 tasks/*.md → 每条 { id, status, goalAc }（只读路径，无写）。
export function readTaskFacts(root) {
  return fs.readdirSync(`${root}/tasks`).map((f) => ({ id: f.replace(/\.md$/, "") }));
}
EOF
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/goal-driver-task-boundary-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
}

# GREEN baseline: clean file → exit 0.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on a clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (comment form): a comment mentioning the verbs must NOT redden the checker (硬规则 2).
printf '\n// task_write 不许调用；lifecycle_promote 也不许\n' >> plugin/scripts/goal-driver.ts
if checker_cmd; then :; else
  echo "FALSE-RED — a comment mentioning task_write/lifecycle_promote reddened the checker (硬规则 2 位置判定被破坏)" >&2
  exit 4
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file still reddens the checker" >&2
  exit 4
fi

# INJECT (verb): a real task_write call → MUST go RED.
printf 'task_write({ id: "x", status: "ready" });\n' >> plugin/scripts/goal-driver.ts
if checker_cmd; then
  echo "STAYED-GREEN — a real task_write call did not redden the checker (task 写路径 slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the verb inject still reddens the checker" >&2
  exit 4
fi

# INJECT (write-to-tasks): fs.writeFileSync targeting tasks/ → MUST go RED.
printf 'fs.writeFileSync(path.join(root, "tasks", "x.md"), "");\n' >> plugin/scripts/goal-driver.ts
if checker_cmd; then
  echo "STAYED-GREEN — fs.writeFileSync targeting tasks/ did not redden the checker (task 写路径 slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the write inject still reddens the checker" >&2
  exit 4
fi

# INJECT (fan-in carrier, comment form): a comment mentioning fan-in must NOT redden (硬规则 2).
printf '\n// fan-in 落地率是 task 机制指标（DIR-131 Finding 反例），不是 goal 机制缺陷\n' >> plugin/scripts/goal-driver.ts
if checker_cmd; then :; else
  echo "FALSE-RED — a comment mentioning fan-in/落地率 reddened the checker (DIR-131 AC6 位置判定被破坏)" >&2
  exit 4
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the fan-in comment inject still reddens the checker" >&2
  exit 4
fi

# INJECT (fan-in carrier read): a string referencing .quay/fan-in-* → MUST go RED (AC6 归因反例机械化).
printf 'const carrier = ".quay/fan-in-step-trace.jsonl";\n' >> plugin/scripts/goal-driver.ts
if checker_cmd; then
  echo "STAYED-GREEN — a .quay/fan-in-* carrier read did not redden the checker (goal 侧读 task 落地指标 slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the fan-in carrier inject still reddens the checker" >&2
  exit 4
fi

exit 0
