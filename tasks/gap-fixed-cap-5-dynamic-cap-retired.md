---
id: gap-fixed-cap-5-dynamic-cap-retired
title: 动态 cap 作废改固定 5（人裁定）——effective_cap 是被包装成数字的布尔量且算错了（process-budget 报
  in_use=5 实 1 个 MainThread）；cap-from-gate/slot-refill 固定 5，process-budget 降级观测
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**动态 cap 机制作废（人 2026-08-09 裁定）：`effective_cap` 与 `slot-refill --cap` 默认值改为固定 5。动态 cap 是「被包装成数字的布尔量，且那个布尔量还算错了」——它除了表示 suite 测试在跑，没有其它价值。停止使用它，固定 cap=5 也比它好。`cap-from-gate.sh` / `process-budget.sh` 降级为纯观测，不得参与任何裁决（派发、slot-refill、floor 计算一律用固定 5）。**

### 实证（manager 2026-08-09 实测 + outer 复核）

- **cap 历史分布**：`4(40) / 1(36) / 5(25) / 2(21) / 3(5)`——`cap=1` 每 3~4 轮出现一次，且只随「suite 跑不跑」切换。⇒ 被包装成数字的布尔量。
- **计数错误**：`process-budget.sh` 报 `total_budget=4 in_use=5 available=0 verdict=WAIT`，但同时刻 `ps` 数 node MainThread 只有 1~2 个——**WAIT 裁决建立在错误计数上**。
- **人裁定**：停止使用动态 cap，固定 cap=5。

**为什么重要**：动态 cap 让槽位/池位判据随负载波动（我今晚三条矛盾指导的根源）；且其底层计数错误（in_use 报 5 实 1）让 WAIT 裁决不可信。固定 cap=5 消除波动，池位判据稳定（pool 28/floor 20/deficit 0）。

**修的方向（实现归内层）**：
- 候选 A：`cap-from-gate.sh` 的 `effective_cap` 改为固定 5（保留脚本输出作观测）。
- 候选 B：`slot-refill.sh` 的 `--cap` 默认值改为 5（不传时用 5）。
- 候选 C：`process-budget.sh` 的 `in_use` 计数修（报 5 实 1——找计数 bug）。

**验证锚**：修后，(a) `effective_cap` 恒 5（不随 suite 跑不跑变）；(b) `slot-refill --cap` 默认 5；(c) `process-budget in_use` 与实际进程数一致。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（cap 分布 4/1/5/2/3 + cap=1 只随 suite 切换 + process-budget 报 5 实 1）（本任务 Proposal 已含；内层补：cap-from-gate 实跑 + ps 对照复现）
- [x] AC2: **effective_cap 固定 5**——`cap-from-gate.sh` 恒输出 5（不随 suite 跑不跑变）
- [x] AC3: **slot-refill 默认 5**——`--cap` 不传时用 5（floor=20）
- [x] AC4: **process-budget 计数修正**——`in_use` 与实际 node MainThread 进程数一致（不再报 5 实 1）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 cap/slot-refill/process-budget 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：effective_cap 恒 5；slot-refill 默认 5；process-budget in_use 与实际一致（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/cap-from-gate.ts（候选 A：effective_cap 固定 5）
- plugin/scripts/slot-refill.ts（候选 B：--cap 默认 5）
- plugin/scripts/process-budget.sh（候选 C：in_use 计数修——报 5 实 1）
- plugin/test/（新增：effective_cap 恒 5；slot-refill 默认 5；process-budget 计数）
- tasks/gap-fixed-cap-5-dynamic-cap-retired.md（自身：勾 AC + 贴证据）

## Contract

measure   effective_cap_stability = `bash plugin/scripts/cap-from-gate.sh` 的 effective_cap 值（suite 跑/不跑各测一次）
band      effective_cap_stability = 两次都 = 5（不随 suite 切换）
invariant slot_refill_default_5 = 1（--cap 不传 ⇒ floor=20）
invariant budget_count_accurate = 1（in_use 与实际 node MainThread 一致）
invoke    `bash plugin/scripts/cap-from-gate.sh` + `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts`（贴回）
control   suite 跑/不跑 effective_cap 都 5；slot-refill 默认 5；in_use 准确
resume    cap 固定 + slot-refill 默认 + 计数修分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（人裁定：动态 cap 作废改固定 5——cap 是被包装成数字的布尔量且算错了（报 5 实 1）；cap-from-gate/slot-refill 固定 5，process-budget 降级观测+计数修。实现归内层）

## Evidence（内层实现 2026-08-09）

### 根因

1. **动态 cap 是「被包装成数字的布尔量」且算错了**。`cap-from-gate.ts` 的 `effective_cap = min(band_cap, max(1, available))`：band 由 cpu `some avg10` 滞回得出（历史分布 4/1/5/2/3，cap=1 每 3~4 轮出现一次、只随「suite 跑不跑」切换），且 budget 面把 `process-budget.sh` 的 `in_use` 当 throttle-able 测试进程数——但 `in_use` 曾把 infra（mcp/serve/monitor）算成测试进程（报 5 实 1），WAIT 裁决建立在错误计数上。
2. **修前复现（内层实跑）**：worktree 上 `bash plugin/scripts/cap-from-gate.sh` 输出 `effective_cap=2`（GO 带 × available=2 ⇒ min(5,2)=2）——cap 随负载/预算波动；`slot-refill.ts` 不传 `--cap` 时默认 `cap=3, floor=12`。
3. **ps 对照（AC1）**：同刻 `ps -e -o comm= | awk '$2=="node-MainThread"'` = 23 个 node-MainThread，其中**真正的 `node --test` 测试进程只有 2 个**（其余 21 个为 MCP/serve/monitor infra）——修后 `process-budget.sh` 报 `in_use=2`，与实测一致（不再是 5，也不再是 23）。

### 修复

- **AC2 — `cap-from-gate.ts`**：`effective_cap = FIXED_EFFECTIVE_CAP (5)`，常量，不随 cpu 压力/预算/suite 状态变化。band 滞回 + budget 读取**保留为纯观测**（stdout 仍打 `signal/band/budget` 行，供人看负载），但不参与任何裁决。`DEFAULT_BANDS`/`readBandsFromConfig`/`capForBand`/`applyHysteresis` 保留为观测逻辑（导出 + 单测）。
- **AC3 — `slot-refill.ts`**：新增 `FIXED_DISPATCH_CAP = 5`，`analyzeSlotRefill` 与 CLI `main()` 的 `--cap` 默认值 3 → 5；floor = 5 × 4 = 20。显式传 `--cap` 仍可覆盖（手工/测试用）。
- **AC4 — `process-budget.sh`**：枚举改 `ps -e -o pid= -o comm=` + awk 精确匹配 `node-MainThread`（替代 `pgrep -x`；本机两法同结果，ps 形在无 pgrep 的容器也确定；**绝不 `ps | grep node`**——grep node 会数进 npm/node-*，且本机 grep 是 ugrep 函数、`grep -v grep` 静默失效会把自己数进去）。`is_test_cmdline` 白名单不变（只数 throttle-able 测试进程）。

### 验证（Contract measure/band/invariant）

- **[A] suite 跑（live，主 checkout 全量套件在跑，in_use=2）**：
  ```
  signal: cpu_stall(some avg10)=76.76  bands(go<60, wait<85, extreme>=85)
  band: GO  desired=WAIT  consecutive=1/2  switched=no
  budget: total=4  in_use=4  available=0
  effective_cap=5
  ```
  预算饱和（available=0）也不降 cap——`effective_cap_stability = 5`。
- **[B] suite 不跑（seam：RESOURCE_GATE_TEST_NODE_PROCS=0）**：`effective_cap=5`（band GO，budget available=4）。**两态都 = 5**（Contract band 满足）。
- **[C] slot-refill 默认（不传 --cap）**：`cap=5 floor=20 floor_mult=4 slots_free=5 pool=11`——`slot_refill_default_5` 满足（floor=20）。
- **[D] process-budget 计数**：live `in_use=2 available=2 verdict=GO`；ps/pgrep 数 node-MainThread = 23，其中仅 2 个测试进程 ⇒ `budget_count_accurate = 1`（报 2，不报 5、不报 23）。
- **[E] 测试**：`cap-from-gate.test.mjs` 19/19 pass（含新增 FIXED-CAP 全态恒 5）；`slot-refill.test.mjs` 18/18 pass（含新增默认 5/floor 20）；`resource-gate.test.mjs` 33/33 pass（含新增「1 测试 worker 混 infra ⇒ in_use=1 非 5」回归）。
- **[F] scoped 门**：`bash scripts/test.sh --for-task gap-fixed-cap-5-dynamic-cap-retired --allow-thin` —— exit 0（fail 0 / cancelled 0 / contract-check 无违规）。

### 说明（给外层）

- `plugin/loop/fast-mode-loop-tick.md`（不在本任务 Touches）仍描述自适应 cap 机制与 `${effective_cap:-3}` 兜底；因 `cap-from-gate.sh` 现恒出 5，兜底永不触发，机制语义已改为「观测 + 固定 5」。如需彻底清文案，建议后续 doc-touch 任务跟进。
- 本任务未改 `ready-pool-check.ts` 的 `CONCURRENCY_CAP_DEFAULT`（不在 Touches；其独立 CLI 默认仍 3/floor 12）。slot-refill 路径（tick 实际用的）已固定 5/floor 20。若外层裁定 ready-pool 独立默认也要 5，另立 doc-touch。
