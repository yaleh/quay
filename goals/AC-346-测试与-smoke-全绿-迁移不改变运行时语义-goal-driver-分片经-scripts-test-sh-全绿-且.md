---
id: AC-346
title: 测试与 smoke 全绿 + 迁移不改变运行时语义：goal-driver 分片经 scripts/test.sh 全绿，且
  TASK_STATUS.NEEDS_HUMAN 与原字面量取值恒等
status: active
kind: criterion
goal: GOAL-031
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  files="plugin/test/goal-driver-s01.test.mjs plugin/test/goal-driver-s06.test.mjs plugin/test/goal-driver-s08.test.mjs plugin/test/goal-driver-s12.test.mjs"
  for f in $files; do [ -f "$f" ] || { echo "CAUSE=test-file-absent — $f (the slice's tests must exist before this AC can be read)" >&2; exit 1; }; done
  log=$(mktemp /tmp/goal031-tests.XXXXXX); trap 'rm -f "$log"' EXIT
  scripts/test.sh $files >"$log" 2>&1; rc=$?
  tests=$(grep -oE '^ℹ tests [0-9]+' "$log" | tail -1 | awk '{print $3}')
  fail=$(grep -oE '^ℹ fail [0-9]+' "$log" | tail -1 | awk '{print $3}')
  [ -n "${tests:-}" ] || { echo "NOT-EVALUATED: scripts/test.sh printed no test summary (exit $rc): $(tail -2 "$log" | tr '\n' ' ')" >&2; exit 3; }
  [ "$rc" -eq 0 ] && [ "${fail:-1}" -eq 0 ] && [ "$tests" -ge 4 ] || { echo "CAUSE=tests-red — scripts/test.sh exit $rc, tests $tests, fail ${fail:-?}: $(grep -E '^not ok|✖' "$log" | head -3 | tr '\n' ' ')" >&2; exit 1; }
  val=$(node --experimental-strip-types -e '(async()=>{const m=await import("./plugin/scripts/task-status.ts");process.stdout.write(String(m.TASK_STATUS.NEEDS_HUMAN))})().catch(()=>{})' 2>/dev/null)
  [ "$val" = "needs-human" ] || { echo "CAUSE=canonical-value-drift — TASK_STATUS.NEEDS_HUMAN=\"${val:-<unreadable>}\", want \"needs-human\": the substitution would no longer be value-identical to the literal it replaced" >&2; exit 1; }
  echo "PASS: scripts/test.sh on 4 goal-driver shards: $tests tests, 0 fail; TASK_STATUS.NEEDS_HUMAN === \"needs-human\" (runtime semantics unchanged)"
expect: exit 0 = 4 个 goal-driver 分片全绿且 TASK_STATUS.NEEDS_HUMAN 取值恒等；exit 1 =
  CAUSE= 指明哪一项；exit 3 = scripts/test.sh 未产出汇总
origin: 人 2026-10-08 采纳
  gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics 提案：补退出条件「suite/smoke
  全绿」「不改变状态机允许边/运行时语义」的对位（同 GOAL-030 AC-338）
activatedAt: 2026-10-08T14:55:00.248Z
phase: pre-merge
---
