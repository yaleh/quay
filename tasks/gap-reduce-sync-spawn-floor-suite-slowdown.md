---
id: gap-reduce-sync-spawn-floor-suite-slowdown
title: 套件耗时大头 = 派生次数 × 进程启动地板（~180-245s）——减少/降低单次派生
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 CPU 分析 + 复核）**：

- 套件非 CPU-bound（16 核 CPU 平均 20.8%，71 测试进程全 S 睡眠）。
- **1223 个同步派生点**（spawnSync 767 + execFileSync 371 + execSync 85）。
- 每次 CLI 派生的**地板成本**（空库 task list / --version）≈ **0.15-0.20s**。
- ⇒ **套件耗时大头 = 派生次数 × 进程启动地板 ≈ 180-245s**（上界估计；1223 里有多少是 quay CLI vs git/bash/其它未拆）。

**与任务库解析（0.8s task list）分离**：任务库那条只打少数文件，是产品价值；这条是套件侧的大头。

**⚠️ 模型更正（manager 2026-08-12 第三轮实测）**：`strace -f -e trace=execve` 显示**每次派生墙钟非常数**（0.17-0.36s，斜率 3× 差异——mcp-server 起真 MCP server 单次贵一倍多）。「次数 × 固定地板 = 180-245s」**站不住**（静态调用点的执行次数未知）。**派生"贵贱"差异极大**。

**选定机制**（B 节判断依据）：**先按「文件级 execve 次数 × 单次成本」排序**（先削最贵的，可能比削数量最多的更划算；mcp-server 79×0.358s=28s），逐个审视派生——**是否真需要进程隔离**？不需要的改成：
- 进程内调用（同 node 进程直接调函数，不 spawn 子进程）；
- 或异步并行（多个派生并发，让等待重叠——非 CPU-bound，16 核闲置 12 核）；
- 或减少派生次数（合并多次 CLI 调用为一次）。

**验证锚（按实测不静态推）**：(a) 改造前后各跑一轮带 `execve` 计数的套件，比对 (execve 总数, 各相墙钟) 两个量——**不写"减 X% ⇒ 省 Y 秒"**（斜率非常数）；(b) 测试结果不变（无回归）；(c) 全量套件耗时下降；(d) `--for-task` scoped 门绿。

## Plan

1. 列 1223 个同步派生点（按测试文件聚合成最密集的 8 个）。
2. 逐个判：真需要进程隔离吗？分类（改进程内 / 改异步 / 减少次数 / 保留）。
3. 从最密集的文件开始改 + 单测（结果不变）。
4. 回归：`--for-task` scoped + 全量套件（耗时对比）。

## AC

- [ ] AC1: 派生最密集的测试文件派生次数或地板显著下降（>30%）
- [ ] AC2: 改动后测试结果不变（无回归——同一断言通过）
- [ ] AC3: 全量套件总耗时下降（verification-round 对比；目标向 600s 收敛）
- [ ] AC4: 新测试/现有测试覆盖改动；`--for-task` scoped 门绿
- [ ] AC5: 进程隔离保留给真需要的（真外部命令/真 CLI 交互）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 派生点清单 + 分类 + 改后耗时贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/bin/quay.ts（CLI 派生点）
- plugin/scripts/measure-suite-reporter.mjs（execve 计数）
- tasks/gap-reduce-sync-spawn-floor-suite-slowdown.md（自身）
