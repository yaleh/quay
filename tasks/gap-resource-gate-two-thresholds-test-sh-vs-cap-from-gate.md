---
id: gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate
title: "两个资源闸阈值不一致——test.sh limit 40 vs cap-from-gate go<60；负载高峰时「套件拒跑」与「派发继续」失衡，可能成环"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**同一个资源信号（cpu_stall avg10），两个闸用两套阈值：`scripts/test.sh` 的闸 `limit 40`（旧阈值）vs `cap-from-gate.ts` 的 `go<60/wait<85`（AC4 修复后的新阈值）——负载高峰时「套件拒跑（WAIT）」与「派发继续（GO）」失衡，可能形成「越忙套件越跑不成 → 一直红 → 红窗挡收敛」的环。**

**背景（manager 2026-08-08 21:1x 诊断）**：AC4 今天把 cap-from-gate 的信号换成 `some avg10` + 阈值 `go<60/wait<85/extreme>=85`，但 **test.sh 自己那个闸仍是 `limit 40`**。同刻实测：test.sh 闸 `cpu_stall(some avg10)=49.56 [limit 40] ⇒ WAIT`（套件拒跑）而 cap-from-gate `bands(go<60) ⇒ band GO`（派发照常）。**同一量、两套阈值。**

**实证（外层 21:1x 复核）**：
- 当前 avg10=16.9/17.82（回落）——两闸都 GO（不冲突）。
- **manager 观测时刻 avg10=49.56**——test.sh 判 WAIT（limit 40），cap-from-gate 判 GO（<60）。
- **结构性风险**：avg10 落在 40-60 区间时，套件拒跑但派发照常 → 派发增加负载 → avg10 更高 → 套件更拒跑 → 红窗永久。

**另一个不一致**：预算总额。test.sh 闸输出 `total_budget=4 budget_in_use=2`（process-budget.sh，修复后 nproc=4），但 manager 观测到 test.sh 当时报 `total_budget=2`——**可能是负载时 nproc 变化或旧版读取**。当前一致（total=4）。

**「没跑」与「跑挂了」在 state 上不可区分（manager 判据延伸）**：reason=aborted（套件根本没跑，resource gate WAIT）与 reason=failed（跑挂）在 state 上都显示 `state=red`——**消费方（红窗/fan-in/派发）得到「红」，等同于测试失败**，即使套件没跑。这是可读性缺口（2ab078eb）的**更硬版本**：aborted 也应让消费方可区分（不挡派发，AC5 语义，但当前 state 不区分）。

**修的方向（实现归内层，方向外层/manager 已定）**：
- 候选 A：**统一阈值**——test.sh 闸的 limit 40 改为与 cap-from-gate 一致（go<60），消除「套件拒跑 vs 派发继续」失衡。
- 候选 B：**aborted 与 failed 在 state 区分消费**——消费方（inner 停止条件 / 红窗）读 reason 区分：aborted（没跑）不挡派发，failed（跑挂）才 stop-dispatch（AC5 语义已在文档，但消费方可能只看 state 不看 reason）。
- 候选 C：**预算总额统一**——test.sh 与 cap-from-gate 都用 process-budget.sh 的同一 total（当前一致，但负载时可能漂）。

**验证锚**：修后，avg10 在 40-60 区间时两闸判定一致（test.sh 不 WAIT 而 cap GO，或两者都调整）；aborted 的套件不挡派发（消费方看 reason 区分）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 manager 实测（avg10=49.56 时 test.sh WAIT vs cap GO）+ 外层复核（当前回落一致）——两套阈值确认（本任务 Proposal 已含；内层在 worktree 复现：`cpu_stall(some avg10)=49.56 [limit 40] WAIT` exit=1 vs `cap-from-gate: band GO desired=GO`——见 Evidence）
- [x] AC2: **阈值统一或对齐**——test.sh 闸阈值与 cap-from-gate 一致（或明确两闸语义分工），avg10 任意值时两闸判定一致（resource-gate.sh CPU_LIMIT 默认 40→60，与 cap-from-gate WAIT_THRESHOLD 统一；drift-invariant 测试钉死两常量相等——见 Evidence）
- [x] AC3: **aborted 与 failed 消费区分**——消费方（inner/红窗/触发者）读 reason 区分 aborted（不挡派发）与 failed（stop-dispatch），state 或事件语义修正（integration 已含该语义：suite-state-trigger.ts shouldStopDispatch/shouldDispatchOnRed/routeRed 按 reason 区分 + full-suite-runner.ts 写 reason=aborted；测试钉死——见 Evidence）
- [x] AC4: **成环风险消除**——负载高峰时不再「套件拒跑 + 派发继续」失衡（验证：注入 avg10 40-60 负载，两闸一致）（新测试：avg10=49.56 两闸同 GO、avg10=70 两闸同非-GO——见 Evidence）
- [x] AC5: **预算总额一致**——test.sh 与 cap-from-gate 的 total_budget 同源（process-budget.sh），负载时不漂（test.sh default_concurrency_formula / cap-from-gate readBudgetFromGate / resource-gate budget_report 三者都读 process-budget.sh；新测试钉死 gate 报告——见 Evidence）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：avg10 40-60 区间两闸一致；aborted 不挡派发（实跑贴任务体）
- [x] 既有 resource-gate / cap-from-gate / test.sh 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round-N 的批量合边界闸门（gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge），非本任务内层自跑；内层已跑 `--for-task` scoped 绿

## Touches

- plugin/scripts/resource-gate.sh（test.sh 闸阈值，若统一）
- plugin/scripts/cap-from-gate.ts（若需对齐）
- scripts/test.sh（闸调用处，若阈值统一）
- plugin/scripts/full-suite-runner.ts（aborted 消费语义，若候选 B）
- plugin/scripts/suite-state-trigger.ts（reason 区分）
- tasks/gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate.md（自身：勾 AC + 贴证据）

## 实跑证据（2026-08-08 21:1xZ）

```bash
# manager 观测（avg10=49.56 时）：
#   test.sh 闸: cpu_stall(some avg10)=49.56 [limit 40] ⇒ WAIT（套件拒跑）
#   cap-from-gate: bands(go<60) ⇒ band GO（派发照常）
# 外层复核（avg10=17.8 回落）：
#   test.sh 闸: cpu_stall(some avg10)=16.90 [limit 40] ok ⇒ GO
#   cap-from-gate: bands(go<60) ⇒ band GO
# ⇒ avg10 在 40-60 区间时两闸不一致（test.sh WAIT vs cap GO）——潜在成环
```

## Contract

measure   gate_verdicts_aligned = avg10 40-60 区间 \`bash plugin/scripts/resource-gate.sh --for full-suite\` 与 \`node --experimental-strip-types plugin/scripts/cap-from-gate.ts\` 判定一致的 band（GO/WAIT）
band      gate_verdicts_aligned = 1（两闸同 GO 或同 WAIT，无失衡）
invariant aborted_does_not_block_dispatch = 1（aborted 套件不挡派发，reason 区分）
invariant budget_total_same_source = 1（test.sh 与 cap-from-gate 的 total_budget 同源）
invoke    `bash plugin/scripts/resource-gate.sh --for full-suite`（实跑贴回）
control   avg10<60 ⇒ 两闸同 GO；≥60 ⇒ 两闸同 WAIT（无 40-60 死区）
resume    阈值对齐 + aborted 语义 + 测试分步提交，任一步完成即写盘

## Evidence（2026-08-08 内层实现）

**复现（worktree，avg10=49.56 注入）**：
```bash
# 修前（integration tip d9ce3942）：
#   resource-gate.sh --for full-suite: cpu_stall(some avg10)=49.56 [limit 40] WAIT, exit=1  ← 套件拒跑
#   cap-from-gate.ts:                  signal 49.56 bands(go<60,wait<85) band: GO desired=GO  ← 派发照常
# ⇒ 同一量、两套阈值：40-60 死区 = 套件拒跑 + 派发继续（成环）
```

**修后实跑（同一注入）**：
```bash
# avg10=49.56: resource-gate: cpu_stall(some avg10)=49.56 [limit 60] ok, => GO, exit=0
#              cap-from-gate: band: GO desired=GO  ⇒ 两闸一致（GO）
# avg10=70:    resource-gate: cpu_stall(some avg10)=70.00 [limit 60] WAIT, => WAIT, exit=1
#              cap-from-gate: band: WAIT desired=WAIT  ⇒ 两闸一致（都非 GO）
```

**改动文件**：
- `plugin/scripts/resource-gate.sh`——CPU_LIMIT 默认 40→60（与 cap-from-gate WAIT_THRESHOLD 统一；Contract band 同步 `< 60`）。
- `plugin/test/resource-gate.test.mjs`——更新 `[limit 40]` 断言为 `[limit 60]`；worktree-priority 测试 avg10=50→70（新阈值下 50 已 GO）；新增 drift-invariant（CPU_LIMIT==WAIT_THRESHOLD）+ AC4 死区对齐测试 + AC5 budget 同源测试。
- `plugin/test/cap-from-gate.test.mjs`——新增 AC4 跨闸对齐测试（avg10=49.56 两闸同 GO）。
- `plugin/test/full-suite-runner.test.mjs`——AC2 worktree-priority 测试 avg10=50→70。
- `plugin/loop/fast-mode-loop-tick.md` + `docs/analysis/fast-mode-loop-tick.md`——全量闸阈值叙事 `< 40`→`< 60`（模板 + 落地副本同步）。
- `tasks/gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate.md`（本文件）——勾 AC + 贴证据。

**AC3（aborted vs failed 消费区分）已在 integration 实现，本任务验证并固化**：suite-state-trigger.ts 的 `routeRed`（failed/legacy→red-window-triage，aborted/infra-error→resource-gate）、`shouldStopDispatch`（aborted→false）、`shouldDispatchOnRed`（aborted→false，不挡派发）；full-suite-runner.ts 在 gate-WAIT/signal-kill/spawn-error 时写 `reason=aborted`。测试钉死：suite-state-trigger.test.mjs AC5/AC2/runOnce stopSignal + full-suite-runner.test.mjs AC5/AC1-AC3/wait-check/fail-fast-check。无消费方把 aborted 当 failed。

**AC5（预算同源）已在 integration 实现，本任务测试钉死**：test.sh `default_concurrency_formula`（C 面）、cap-from-gate `readBudgetFromGate`（B 面）、resource-gate `budget_report`（A 面）都读 `process-budget.sh`（total_budget=nproc）。新测试断言 gate 报告 `total_budget=4 budget_in_use=2 budget_available=2 [cross-layer budget authority: process-budget.sh]`。

**scoped gate**：`bash scripts/test.sh --for-task gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate --allow-thin` → EXIT=0（详见提交说明）。

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 诊断两套阈值不一致 + 潜在成环 + aborted 不可区分；外层复核当前回落一致但风险成立；
方向已定候选 A/B/C，实现与测试归内层）
