---
id: gap-m-bucket-long-tail-lpt-scheduling
title: M bucket 测试长尾：最后 5% 文件吃掉总时长 27%+（最慢 5% 串行和占 55%）——scripts/test.sh 未按已知耗时
  LPT 排序，长测试排尾部等 lane
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**现象（manager 2026-08-24 报，人裁定立案；外层核实更极端）**：M bucket（223 个测试文件，16 lanes 并发）每轮总时长里，**最后 5% 的文件吃掉总时长 27%+**（实测 round 474/476/478 稳定复现，同一批 7-8 个长测试最后收尾）。

**外层核实（round 476, perFile 实测）**：223 文件，串行耗时和 = 3800s，墙钟 = 419s（16 lanes）。**最慢 12 个文件（5%）串行和 = 2108s = 全量的 55%**。最慢文件：`quay-init-loop-vendor.test.mjs`（240s）、`session-liveness.test.mjs`（221s）、`quay-init-loop.test.mjs`（218s）、`install-config-driven-e2e-runtime.test.mjs`（212s）、`install-config-driven-e2e-upgrade.test.mjs`（204s）等。round 478 例：95% 文件（212 个）272s 内完成，剩 11 个长文件又花 99s 收尾。

**根因**：`scripts/test.sh` 把文件列表传给 `node --test --test-concurrency=16` 时**未按已知耗时排序**（按 glob/文件系统发现顺序）。单文件 150-293s 的长测试若排在列表靠后，就要等前面短测试腾出 lane 才轮到——本可并行的时间被串行拖在尾部。

**修法**：经典多机 makespan 最小化的 **LPT（Longest Processing Time first）**——生成 M bucket 文件列表时把已知长测试排到最前，让它们立刻抢 lane 与大量短测试并行。**现成数据源已存在**：`.quay/verification-round.jsonl` 的 `perFile.durationMs` 即耗时基准，无需新造计时机制；按最近一轮（或滚动平均）降序排序。

## Plan

1. 在 `scripts/test.sh` 生成 M bucket 文件列表处，读 `.quay/verification-round.jsonl` 最近一轮（或滚动平均）的 `perFile.durationMs`，按降序排序后传给 `node --test`。无历史数据时回退到现行为（fail-open）。
2. 长尾窗口判据（AC1）落点：`perFile` 里「95% 文件完成时刻 → 100% 完成时刻」占墙钟比例。

## Acceptance Criteria

- [ ] AC1（能取假）：修复后连续 3 轮 M bucket，长尾窗口（95%→100% 完成时刻）占墙钟比例较修复前基线（round 474/476/478 平均 27%+）**显著下降**（目标 <15%）。（待外部）
- [x] AC2（负控制）：已知长测试文件在生成的 M bucket 文件列表里排在前 N（N = 已知长文件数）。

## Definition of Done

- [ ] AC1-2 全勾；scripts/test.sh 的 M bucket 排序落地到 develop；3 轮实测长尾下降。（待外部）

## Retires

- 无

## Touches

- scripts/test.sh（M bucket 文件列表 LPT 排序）
- plugin/scripts/suite-lpt-order.ts（新增 LPT 排序机件）
- plugin/test/suite-lpt-order.test.mjs（suite-lpt-order.ts 的测试）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts 计数 282→283，delivery-inventory-drift-gate 机械要求）
- tasks/gap-m-bucket-long-tail-lpt-scheduling.md（自身）