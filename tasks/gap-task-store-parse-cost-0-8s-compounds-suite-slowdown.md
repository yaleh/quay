---
id: gap-task-store-parse-cost-0-8s-compounds-suite-slowdown
title: 任务库解析 0.8s/次 CLI（1024 文件）——复利侵蚀套件耗时
status: ready
labels:
  - gap
  - defect
  - product
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 CPU 分析 + outer 复核 profile）**：

- 套件非 CPU-bound：16 核 CPU 平均 20.8%（34 采样，最高 27.4%，94% 样本 <25%），71 测试进程全 S（睡眠）——在等同步子进程往返。
- 1223 个同步派生点（spawnSync 767 + execFileSync 371 + execSync 85）× 每次 ~1s。
- **最大单点：每次 CLI 调用重新解析 1024 个任务文件 +0.8s**。outer 复核（`QUAY_NATIVE_TASKS_DIR` 隔离）：
  - 真实仓库（1024 文件）：1.07-1.19s
  - 空任务库 / 1 文件：0.29s
  - ⇒ **解析开销 ~0.8s = CLI 成本的 75%**。
- 任务库构成：**995 done (97%)** / 10 todo / 10 ready / 10 superseded / 6 needs-human。
- **复利**：近 7 天新增 355 文件（≈50/天）⇒ backlog 增长持续侵蚀。

**⚠️ 影响面更正（manager 2026-08-12 复核）**：0.8s 解析**只打 `task list`**（1.12s）；`task get` 0.18s 是定向读取不付税。套件内 `task list` 调用 47 文件/220 处，但 15 个用临时 workspace（空库不付税）、仅 5 个打真实库 ⇒ **套件内收益是几十秒量级，不是 200s+**。**本任务主要是【产品价值】+【防复利】**：真实用户 backlog 大了每次 `task list` 等 1s 是产品缺陷；backlog 以 50/天增长会变成套件问题。**套件侧的大头是「派生次数 × 进程启动地板」（~180-245s），由另一 task（gap-reduce-sync-spawn-floor-...）处理。**

**选定机制**：`packages/quay-native` 的任务库解析加**缓存/索引**（避免每次 CLI 调用全量重读 1024 文件）。**落地前先 profile 那 0.8s 的构成**（IO vs YAML 解析 vs 无缓存层）——manager 明确未验可行性，别跳过测量。

**验证锚**：(a) 解析后 CLI 调用显著变快（>50% 削减）；(b) 任务数据一致（无缓存陈旧）；(c) 全量套件绿 + 耗时下降；(d) `--for-task` scoped 门绿。

## Plan

1. Profile `task list` 的 0.8s：IO（读 1024 文件）+ YAML 解析（每文件）+ 聚合各占多少（node --cpu-prof 或分步计时）。
2. 按 profile 结果选机制：文件 mtime 缓存 / 索引文件 / 惰性解析（只解析当前需要的）。
3. 实现 + 单测（缓存命中/失效、数据一致）。
4. 回归：`--for-task` scoped + 全量套件（耗时对比）。

## AC

- [ ] AC1: CLI `task list` 真实仓库调用耗时下降 ≥50%（0.8s 解析削减）
- [ ] AC2: 任务数据与直接解析一致（缓存/索引无陈旧、无遗漏）
- [ ] AC3: 任务文件变更后缓存正确失效（新增/改/删文件反映到下次调用）
- [ ] AC4: 新测试覆盖 (a)(b)(c)；`--for-task` scoped 门绿
- [ ] AC5: 全量套件绿 + 总耗时下降（verification-round 对比）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] profile 结果 + 实现机制 + 前后耗时贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- tasks/gap-task-store-parse-cost-0-8s-compounds-suite-slowdown.md（自身，C8 self-touch）
