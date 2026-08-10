---
id: gap-a15-ruling5-counter-missing
title: A15 裁定5（连续 3 轮 A15 心跳缺失 ⇒ .halt；再 3 轮 ⇒ /clear）没有计数器——执行核 80 行每轮必读仍连续 9 轮未执行，capability-catalog 对该规则 0 命中；照 closure-lag-check.sh 造计数器
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**A15 裁定5 的「连续 3 轮 A15 心跳缺失」没有任何机械计数器——规则写在 git 跟踪的执行核（`orchestrator-tick-core.md` A15，80 行，每轮必读），仍然连续 9 轮未执行。`capability-catalog.sh | grep -ci suite-health` = 0：没有任何脚本在数那个「连续 3 轮」。这是 C17 至今最强的实例：规则可见到不能再可见，缺的纯粹是产物。**

### 实证（manager 2026-08-10 点检 + outer 复核）

- **裁定5 原文**（orchestrator-tick-core.md A15 ⑤，2026-08-10 已存在）：「**连续 3 轮 A15 心跳缺失（Agent 无新 ts）⇒ `.halt`；再 3 轮 ⇒ `/clear`**」。
- **判据实测大幅超出**：outer tick-log 里 `07:15` 之后有 ≥9 条 tick 行（07:16/07:22/07:29/07:32/07:35/07:43/07:46/07:49/07:57…）；outer 会话 `Agent` 最后一次 **07:15:44**（b3-arbitration），之后零新 ts。**3 轮门槛约 07:29 越过，6 轮门槛约 07:43 越过，两个都没发生。**
- **A15 ② 同时失效**：要求「每 tick 写 `.quay/suite-health-last-run.json`」，该文件 mtime **06:38:03**，点检时已 1h44m 未更新。
- **无计数器**：`capability-catalog.sh | grep -ci suite-health` = **0**。规则形态上「守」与「不守」在记录上不可区分——除非看 transcript 里 Agent tool_use 的时间戳（meta-cc 能查，但没有脚本数它）。
- **对照先例**：`closure-lag-check.sh` 会自报 overdue（2026-08-09 07:44 那轮正是被它自己喊出来才处置的）——A15 裁定5 需要的就是同形态的计数器。

**为什么重要**：A15 ⑤ 是「架构在执行/未执行」的最外层保障（未绿退出⇒`.halt`、心跳断⇒`.halt`、再断⇒`/clear`）。它的判据不机械化，outer 就能在没有任何记录差异的情况下把「没起执行体」拖 9 轮。**这正是 manager 所说的「不是可见性问题——它可见到不能再可见。缺的纯粹是产物」。**

### 选定机制方向（实现归 inner，判定归 outer）

1. **计数器脚本**：`plugin/scripts/a15-ruling5-counter.ts`（或 .sh）——读 outer 会话 transcript 里最后一次 `Agent` tool_use 的 timestamp，算「距现在多少轮 tick」（tick 行数），`>= 3` 报「A15 心跳缺失 3 轮 ⇒ 应 .halt」、`>= 6` 报「再 3 轮 ⇒ 应 /clear」。形态照 `closure-lag-check.sh`（自报 overdue，exit 非 0 即信号）。
2. **capability-catalog 声明**：新脚本在 `capability-catalog.sh` 声明（manager 点检用 `grep -ci suite-health` 验证，声明后应 >0）。
3. **tick 接线**：`orchestrator-tick-core.md` A15 ⑤ 注明「每 tick 跑 a15-ruling5-counter 读数」；A15 ②「每 tick 写 `.quay/suite-health-last-run.json`」保持（本任务同时补上当前那次写入）。
4. **轮次定义**：一轮 = 一条 outer tick-log 行（manager 点检按 tick 行数 ≥9；若裁定为 suite 轮次或时钟小时，任何数法当前都已越 3 轮门槛——实现时以「tick 行数」为准并写进脚本注释，避免数法漂移）。

**验证锚**：修后 (a) `capability-catalog.sh | grep -ci suite-health` > 0；(b) 计数器对当前状态报「≥3 轮缺失」（或处置后的新基线）；(c) 连续 3 轮无 Agent 派发时，外层 tick 能读到「A15 心跳缺失」信号。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录裁定5 连续 9 轮未执行的实证（tick 行数 / Agent last ts 07:15:44 / suite-health-last-run.json 1h44m 未更新 / catalog 0 命中）（本任务 Proposal 已含）
- [ ] AC2: **计数器脚本**——`a15-ruling5-counter` 读 transcript 最后一次 Agent tool_use ts，算距现在 tick 行数，>=3/>=6 分别报「应 .halt」/「应 /clear」
- [ ] AC3: **capability-catalog 声明**——`grep -ci suite-health` > 0（manager 点检手法可验证）
- [ ] AC4: **tick 接线**——`orchestrator-tick-core.md` A15 ⑤ 注明每 tick 跑计数器；A15 ② 每 tick 写 suite-health-last-run.json 保持
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：计数器对真实 transcript 报 tick 行数；catalog 命中 >0；外层 tick 读它判缺失（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/a15-ruling5-counter.ts（新计数器：读 transcript 末次 Agent tool_use ts + tick-log 行数，>=3/>=6 分档报）
- plugin/test/a15-ruling5-counter.test.mjs（AC2 测试：伪造 transcript/tick-log 注入，断言 0/3/6 分档）
- plugin/scripts/capability-catalog.sh（AC3：新脚本声明 + suite-health 计数）
- orchestration/orchestrator-tick-core.md（AC4：A15 ⑤ 注明每 tick 跑计数器；A15 ② 保持每 tick 写）
- tasks/gap-a15-ruling5-counter-missing.md（自身：勾 AC + 贴证据）

## Contract

measure   a15_ruling5_ticks_since_agent = `node --no-warnings --experimental-strip-types plugin/scripts/a15-ruling5-counter.ts --json` 的 stdout 中 ticks_since_agent 数字
band      a15_ruling5_ticks_since_agent = < 3（健康；>=3 报「应 .halt」，>=6 报「应 /clear」）
invariant a15_counter_catalog_declared = 1（`capability-catalog.sh | grep -ci suite-health` > 0）
invariant a15_counter_wired_every_tick = 1（A15 ⑤ 每 tick 跑计数器）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/a15-ruling5-counter.ts --json`（贴 ticks_since_agent 数字）
control   <3 轮健康静默；>=3 报应 .halt；>=6 报应 /clear
resume    计数器脚本 / catalog 声明 / tick 接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 点检——A15 裁定5（连续 3 轮心跳缺失⇒.halt，再 3 轮⇒/clear）连续 9 轮未执行，catalog 0 命中、suite-health-last-run.json 1h44m 未更新；C17 最强实例（规则在 80 行执行核每轮必读仍不执行）。立案：照 closure-lag-check.sh 造计数器。实现归 inner，判定归 outer

## 交叉标注 (gap-ac41-red-on-omission-artifact, 2026-08-10)

本任务（计数器）是 AC41③（red-on-omission）判据 1/2 的产物——但**计数器本身也必须能指出「不做时
哪个读数会变红」**，否则又是一个靠自觉跑的机制（Proposal 反面）。执行体 = `red-on-omission-audit`
检查器（`tasks/gap-ac41-red-on-omission-artifact`）：registry 把 `a15_ruling5`（含计数器形态的
`ruling5_status` 自报字段）列为 invariant，逐条机械核对「行为→变红读数」。
