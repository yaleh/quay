---
id: AC-362
title: 派发过滤可归因：worker-round 对每个被过滤的候选记录被哪个谓词、哪个在飞对手、重叠哪些文件、已等待多久；加上该记录后候选集合与顺序不变
status: achieved
kind: criterion
goal: GOAL-037
criterion: >-
  set -u

  T=plugin/test/touches-relax-filter-trace.test.mjs

  [ -f "$T" ] || { echo "CAUSE=filter-trace-test-absent — $T does not exist"
  >&2; exit 1; }

  out=$(mktemp) || { echo "CAUSE=mktemp-failed — cannot create a scratch file
  for the test output" >&2; exit 1; }

  timeout 55 node --experimental-strip-types --test "$T" > "$out" 2>&1; rc=$?

  [ "$rc" != 124 ] || { echo "CAUSE=filter-trace-test-too-slow — exceeded 55s"
  >&2; rm -f "$out"; exit 1; }

  [ "$rc" = 0 ] || { echo "CAUSE=filter-trace-test-red-rc$rc — $(tail -c 300
  "$out" | tr '\n' ' ')" >&2; rm -f "$out"; exit 1; }

  rm -f "$out"

  exit 0
expect: plugin/test/touches-relax-filter-trace.test.mjs 存在、在 55 秒内通过。读数（真实
  applyTaskFilters + 真实 round 记录装配，fixture 任务目录，不 mock 谓词）：(a) 被 touchesDisjoint
  挡住的候选，round.filter_trace 条目含 task、filter 名、blocker（在飞对手的任务
  id）、overlapFiles（重叠文件列表，不含任务自身文件）、waitedMinutes（取自
  .quay/task-status-events.jsonl 里 to:"ready" 的第一条；读不到时为 null，⛔ 不得写成 0）；(b) 被
  depsSatisfied / retryCapNotExhausted / notNeedsHuman 等其它谓词挡住的候选各有自己的 filter 名且
  blocker 为 null，不得被归到 touchesDisjoint；(c) 加上 filter_trace 之后，对同一输入
  applyTaskFilters 返回的候选集合与顺序与基线实现逐一相同（特征化）；(d) 取假形态：把 trace 的归因写死成恒
  touchesDisjoint 或恒空时，本测试必须变红；(e) pool-empty 的轮不写 trace 条目。⛔
  本条只增观测，不得改变任何派发决策。先后提示：本条与 AC-363、AC-364 是第一批，AC-365 起依赖它们。
origin: 用户 2026-10-16 在会话「ClaudeCodeUI 局部重构方案」中认可「等待超过阈值乐观派发」改动方案并指示按方案创建
  goal/AC 并激活。本条是方案第 0 步（只加观测）：worker-round 的 filtered-empty 轮（quay
  7010/49201≈14.2%、claudecodeui 4844/36578≈13.2% 的 stop
  轮）目前不记录每个候选被哪个谓词、被谁挡住，无法归因（grep 'touches-overlap' 在 worker-round.jsonl 零命中）。
activatedAt: 2026-10-16T15:33:49.394Z
statusLog:
  - at: 2026-10-16T15:33:49.394Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-16T16:35:34.516Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-16T15:33:49.394Z
---
