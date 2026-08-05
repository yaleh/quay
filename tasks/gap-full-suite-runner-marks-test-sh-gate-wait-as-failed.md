---
id: gap-full-suite-runner-marks-test-sh-gate-wait-as-failed
title: "full-suite-runner marks scripts/test.sh's INTERNAL resource-gate WAIT
  as reason=failed (false RED / spurious stop-dispatch) instead of aborted:
  measured 17:46Z — runner's own gate said GO at start, test.sh's internal
  gate check seconds later saw PSI some avg10=45.15 (>40 limit) → test.sh
  fail-closed exit 1 (NEVER ran tests) → runner reason=failed; the reason
  axis (failed|aborted, runner line 34/74) exists but does NOT detect
  test.sh's 'resource gate says WAIT — not running' marker in the output;
  fix: detect the marker → reason=aborted (no correctness conclusion), so a
  run that produced ZERO tests never sets the stop-dispatch signal"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**full-suite-runner 把 test.sh 内部资源闸 WAIT 标成 reason=failed（假红/假 stop-dispatch）而非 aborted。**

**【实测（2026-08-05 17:46Z，红窗分诊产出）】**：
1. 外层起 full-suite-runner（state=running, laneCount=1）；runner 自己的闸检查 **GO**（17:46:26）；
2. runner 调 `scripts/test.sh`（canonical 全量），test.sh **内部**再查一次闸（几秒后）——PSI some
   **avg10=45.15**（>40 上限）→ test.sh fail-closed exit 1，**一行测试都没跑**；
3. runner 把 test.sh 的 exit 1 判为 `reason=failed` + state=red → **SUITE-RED + stop-dispatch 信号**。

**【判定】**：**假红**——该运行产生 ZERO 测试、ZERO 正确性结论，按 reason 轴语义（runner line 34：
`aborted = the run produced NO correctness conclusion`）应为 **reason=aborted**，不设 stop-dispatch。

**【根因】**：runner 有 reason 轴（failed|aborted，line 34/74），但**不检测 test.sh 输出里的
`resource gate says WAIT — not running` 标记**——把 gate-WAIT 的 exit 1 当真失败。

**【为什么重要】**：假 stop-dispatch 让 inner 停派发 + 暂缓 fan-in（红窗规则），代价是「一次资源抖动停掉
整个推进」。且这是 ABORT #4/#5 原因轴教训（aborted ≠ failed）的**再现**——runner 自己那侧修了，但
test.sh 内部的 gate-WAIT 路径没接入原因轴。

**【fix 方向】**：
1. runner 检测 test.sh 输出中的 `resource gate says WAIT` / `not running the full suite` 标记 →
   reason=aborted（不设 stop-dispatch）；
2. 或 test.sh 对 gate-WAIT 用**专门的退出码**（区别于真测试失败），runner 按码分类；
3. 真失败（有测试跑、有 not ok/✖）仍 reason=failed（不回归）。

### 选定机制

1. runner 解析 test.sh 输出：检测 gate-WAIT 标记 → reason=aborted
2. gate-WAIT 的 aborted 不设 stop-dispatch（state 可标 green-with-note 或 aborted，inner 不停止）
3. 负控制：真测试失败仍 reason=failed + stop-dispatch

## Acceptance Criteria

- [ ] AC1: test.sh 内部闸 WAIT（无测试运行）⇒ reason=aborted，**不设 stop-dispatch**（实测，同 17:46 场景）
- [ ] AC2: 真测试失败（有 not ok/✖）⇒ 仍 reason=failed + stop-dispatch（不回归）
- [ ] AC3: gate-WAIT 的 aborted 有 note/可读标记（外层分诊可辨「没跑」vs「跑了失败」）
- [ ] AC4: 与 gap-full-suite-runner-concurrency-default-and-gate（done）交叉标注——原因轴在该任务范围外的
      残余缺口

## Touches

- plugin/scripts/full-suite-runner.ts（WAIT 标记检测 + reason 分类）
- plugin/scripts/test.sh（若改专门退出码）
- plugin/test/full-suite-runner.test.mjs（WAIT-aborted 负控制）

## Contract

measure   wait_reason = `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check` 等构造 gate-WAIT 场景后 `cat .quay/full-suite-state.json | grep -c '"reason":"aborted"'`
band      wait_reason >= 1（gate-WAIT ⇒ aborted 非 failed）
invoke    `grep -n 'resource gate says WAIT\|reason.*aborted\|FAILURE_PATTERNS' plugin/scripts/full-suite-runner.ts`
control   真失败场景 reason=failed（AC2 不回归）
resume    标记检测与退出码分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T17:4xZ
changed: 红窗分诊产出——17:46Z 起全量 3 秒即红，日志证实 test.sh 内部闸 WAIT（avg10=45.15）fail-closed
未跑任何测试，runner 标 failed（假红）。外层已重置 state=green(reason=aborted) 撤回 stop-dispatch。
立案：runner 原因轴对 test.sh 内部 gate-WAIT 路径缺失。
