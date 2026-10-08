---
id: AC-343
title: 结构与范围护栏：goal-driver.ts 5 处 needs-human 迁移到 task-status.ts，todo/ready/done
  与被排除的 goal-AC 行不变，不依赖 goal/GOAL-030 未并入产物
status: draft
kind: criterion
goal: GOAL-031
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  f="plugin/scripts/goal-driver.ts"

  [ -f "$f" ] || { echo "NOT-EVALUATED: $f not found" >&2; exit 3; }

  n=$(grep -c 'status === "needs-human"' "$f")

  [ "$n" -eq 1 ] || { echo "CAUSE=needs-human-count-wrong — grep count is $n,
  want exactly 1 (the untouched goal-AC-status line)" >&2; exit 1; }

  grep -qF '(r.status === "active" || r.status === "achieved" || r.status ===
  "needs-human"),' "$f" || { echo "CAUSE=excluded-line-changed — the goal-AC
  status line must stay byte-identical, it is out of this goal's scope" >&2;
  exit 1; }

  grep -qE "from [\"'].*task-status(\.ts)?[\"']" "$f" || { echo
  "CAUSE=no-canonical-import — $f does not import task-status.ts" >&2; exit 1; }

  todo_n=$(grep -c '=== "todo"' "$f"); [ "$todo_n" -eq 2 ] || { echo
  "CAUSE=todo-literal-count-changed — want 2, got $todo_n (todo/ready/done are
  out of scope for this goal)" >&2; exit 1; }

  ready_n=$(grep -c '=== "ready"' "$f"); [ "$ready_n" -eq 2 ] || { echo
  "CAUSE=ready-literal-count-changed — want 2, got $ready_n" >&2; exit 1; }

  done_n=$(grep -c '=== "done"' "$f"); [ "$done_n" -eq 0 ] || { echo
  "CAUSE=done-literal-count-changed — want 0, got $done_n" >&2; exit 1; }

  grep -qE "kernel/task-transition|branch-selfhost-probe" "$f" && { echo
  "CAUSE=goal030-dependency — $f references a goal/GOAL-030-only artifact" >&2;
  exit 1; }

  [ -e packages/quay/src/kernel/task-status.ts ] && { echo
  "CAUSE=second-kernel-source — a new kernel/task-status.ts would be a second
  canonical source" >&2; exit 1; }

  echo "PASS: goal-driver.ts's 5 real needs-human comparisons migrated to
  task-status.ts; todo/ready/done and the excluded goal-AC-status line
  unchanged; no GOAL-030 dependency; no new kernel source"
expect: exit 0 = 5 处迁移完成且无越界；exit 1 = CAUSE= 指明具体哪一条护栏被破坏；exit 3 = 文件缺失
origin: GOAL-031 范围护栏，见 goal body「范围与非目标」
---
