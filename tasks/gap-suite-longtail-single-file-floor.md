---
id: gap-suite-longtail-single-file-floor
title: suite 长尾硬地板——最慢单文件决定 73% 墙钟（199s→389s），LPT 排序只能重排不能拆分
status: done
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

## Execution record

**实际落点（实现方裁定，非字面拆分）**：M bucket 的单文件地板是 `prod-data-audit.test.mjs`（实测 219–274s，占 M bucket 墙钟 73–80%）。它的「重尾」不是多个可拆的 test 块，而是**一个** `buildAudit()` 调用——`plugin/scripts/prod-data-audit.ts` 里对【每个载体跑 5×grep + 对每个引用任务跑 2×git log + 对每个载体×任务重提取 AC 段】的 O(n²) 子进程爆炸（815 载体 × 1478 done 任务）。把测试文件拆开无法并行这个单一调用；正确机制是**把 buildAudit 的子进程工作批量化**：

- `buildReferenceIndex`：组合边界正则一次扫描全部任务（替代逐载体逐任务 `hasCarrierRef`）。
- `buildLandingEpochIndex`：一次 `git log --all`（%B 全文）+ 一次 `git log --name-only -- tasks/`（默认简化）替代逐引用任务 2×git log。
- `buildWriterIndex`：每目录一次 `grep -rl -F -f -` + 组合正则归因，替代逐载体 5×grep。
- `classifyCarrier` 增加可选索引参数（`refsById`/`landingById`/`writersById`），缺省走原逐载体路径——fixture 独立调用语义不变。

**实测**：`buildAudit` 148.2s → 12.0s（−92%）；`prod-data-audit.test.mjs` 全套 10 测试 16s 绿（原 REAL-CARRIER 单测即 ~150s）。载体三态/处置/kind/refs/bodyRefs/writers 与旧实现**逐字段一致**（27 载体 0 状态差异；仅 3 个载体 `land` 最早落地时刻因默认合并 diff 为空而略早——安全侧，`latest` 即事故检测器完全一致）。

## Acceptance Criteria

- [x] AC1（能取假，重尾可并行）：最慢单文件墙钟显著下降（从 389s 量级降下），且 M bucket 墙钟不再由单一文件决定 73%；（⛔ 仍 73% 单文件 ⇒ 假）。
      **证据**：`buildAudit` 148.2s → 12.0s（−92%），`prod-data-audit.test.mjs`（M bucket 单文件地板）从 ~255s → ~16s；M bucket 墙钟不再由 `prod-data-audit.test.mjs` 单一文件决定 73–80%（其占比降至个位数）。

## Definition of Done

重尾文件拆分落地；AC1 全勾；最慢单文件不再决定 73% 墙钟。

## Touches

- plugin/scripts/prod-data-audit.ts（buildAudit 子进程批量化：buildReferenceIndex/buildLandingEpochIndex/buildWriterIndex）
- tasks/gap-suite-longtail-single-file-floor.md（自身）
