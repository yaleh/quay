---
id: gap-adaptive-concurrency-cap-tied-to-resource-gate
title: "concurrency cap fixed 3 → adaptive (human: raise throughput; manager:
  don't swap fixed number for fixed number — laneCount=8 lesson); cap =
  f(resource-gate): GO=5/WAIT=2/extreme-WAIT=1, wire into fast-mode-loop-tick
  step 4 + ready-pool floor=cap×4; components exist (gate verified + scheduler),
  missing the junction"
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

**并发上限从固定值改自适应——cap 跟资源门联动（人请求提高吞吐 + 管理者形态建议 + 外层裁定）**：

**背景**：人请求提高 quay/archguard 开发吞吐率（含提高 inner 并发 subagent 数）。实测资源「不算重」
（PSI 37.96 GO），但 nproc=4 是硬容量。

**为什么不改固定值**：laneCount 硬编码 8 在 4 核机器 PSI 94 + 三次 ABORT（ABORT #1/3/4）。把并发上限
从 3 改成任何新固定数字，都是同一模式换数字重演。**资源门今晚已验证正确**（resource-gate.sh PSI 判据，
读整机不区分项目——SPEC-isolation 论据），concurrent-batch-scheduler 已有 disjointness 排序。缺的是
**把两者接起来**，纳入 fast-mode-loop-tick.md 步骤 4 的并发判据。

**裁定（外层）**：采纳自适应。档位：GO=5 / WAIT=2 / 极端 WAIT=1（管理者建议，认可）。nproc=4，
GO 时 5 个 subagent 利用空闲；WAIT 时回落不加重负担；极端 WAIT 只 1 个。现在就做（排队错过资源空窗）。

**注意**：archguard 各自决定（vitest 打包态更重 vs quay node:test），不要求同步同数字。

### 选定机制

1. 并发上限 = f(resource-gate)：GO（exit 0）⇒ cap 5；WAIT（exit 1）⇒ cap 2；极端 WAIT（PSI ≥ 阈值）⇒ cap 1
2. 接线进 fast-mode-loop-tick.md 步骤 4 并发判据（替代固定 cap=3）
3. ready-pool floor 联动：cap×4（GO 时 floor 20，WAIT 时 floor 8）
4. 验证：资源空时派发 ≥3（吞吐提高）；archguard 高负载时 quay 自动回落（不加重）

## Acceptance Criteria

- [ ] AC1: 并发上限读 resource-gate——GO ⇒ 5 / WAIT ⇒ 2 / 极端 WAIT ⇒ 1（实测各档位生效）
- [ ] AC2: 资源空时派发 ≥3（吞吐较 cap=3 提高，实测）
- [ ] AC3: 其它项目（archguard）高负载 ⇒ quay 自动回落 WAIT 档（不加重，实测）
- [ ] AC4: fast-mode-loop-tick.md 步骤 4 并发判据更新（替代固定 cap=3），floor 联动
- [ ] AC5: 与 resource-gate + concurrent-batch-scheduler + SPEC-isolation 交叉标注

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 资源空时实测派发 ≥3（吞吐提高，实跑输出贴任务体）
- [ ] archguard 高负载时实测 quay 自动回落 WAIT 档（实跑输出贴任务体）
- [ ] fast-mode-loop-tick.md 步骤 4 已更新（自适应并发判据，替代固定 cap=3）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/fast-mode-loop-tick.md（步骤 4 并发判据自适应）
- plugin/scripts/ready-pool-check.ts（floor 联动 cap）
- plugin/scripts/（或新 helper：cap-from-gate）
- plugin/test/（对应测试）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（AC5 交叉标注）

## Contract

measure   effective_cap = `bash <cap-from-gate-helper> 2>&1 | grep -o '[0-9]'` stdout 数字段（资源门各态下）
band      effective_cap = 5/2/1（GO/WAIT/极端 WAIT 三档）
invariant cap_follows_gate = 1（并发上限只由资源门状态决定，无独立固定值）
invoke    `bash plugin/scripts/resource-gate.sh --for full-suite`
control   资源空 ⇒ cap 5（AC2 吞吐提高）；archguard 高负载 ⇒ cap 2（AC3 回落）
resume    档位实现与 tick 文档接线分步提交，任一步完成即写盘