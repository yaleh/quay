---
id: gap-suite-longtail-single-file-floor
title: suite 长尾硬地板——最慢单文件决定 73% 墙钟（199s→389s），LPT 排序只能重排不能拆分
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

M bucket 的墙钟被**长尾单文件**决定（独立于 lane 预算失效的争抢问题，是硬地板）：

**实测（manager 直接量）**：
```
最慢单文件 / 总墙钟：0.57 → 0.77
最慢单文件本身：     199s → 389s
⇒ M bucket 现在 73% 墙钟由一个文件决定
```

LPT 排序已在跑（`scripts/test.sh:1430`），但它**只能重排、不能拆分**——16 条 lane 对一个 200s 的单文件毫无办法。即使 lane 预算争抢完全消除（gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock 那条），地板就是最慢那个文件。

**⛔ 与既有任务区分**：已立案/在飞的 `gap-suite-lpt-lookback-not-bucket-filtered` 管的是 LPT 历史查询不按桶过滤，**不解决地板问题**——别当成同一件事。

**⊢ 顺序**：本条的杠杆在 lane 预算修复**之后**——做完 lane 预算后，前 9 个文件（各 200-390s）就是新天花板。

## Plan

1. 拆分重尾文件（前 9 个，各 200-390s）——把单个大测试文件拆成多个可并行的文件（或 test 分组），让 16 lanes 能对它们起作用。方向留实现方，⛔ 不代拍。

## Acceptance Criteria

- [ ] AC1（能取假，重尾可并行）：最慢单文件墙钟显著下降（从 389s 量级降下），且 M bucket 墙钟不再由单一文件决定 73%；（⛔ 仍 73% 单文件 ⇒ 假）。

## Definition of Done

重尾文件拆分落地；AC1 全勾；最慢单文件不再决定 73% 墙钟。

## Touches

- plugin/test/（重尾文件拆分 + 并行化）
- tasks/gap-suite-longtail-single-file-floor.md（自身）
