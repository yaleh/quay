---
id: gap-experiment-legacy-reclaim-and-touches-heuristic
title: "experiment legacy census & reclaim — 46 test files 70% unreferenced / 15
  impl-deleted (run every full suite, zero info); reclaim 4: git-lens
  L_D/L_G/L_S (ADR-006/007 quant impls, feed architecture probe) +
  derive-touches-heuristic (## Touches missing mechanical extraction); delete
  impl-deleted tests (criterion: test without impl = remove)"
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

**实验遗留普查与回收——46 测试文件 70% 无人引用、15 个被测实现已删（管理者 §8b 实测）**：

**规模**：experiments 测试 15940 行 + 脚本 26325 行；46 测试文件默认 glob 每轮全跑，32 无人引用(70%)、
15 连被测实现都已删除。脚本 103 实体文件（15 符号链接不算遗留），已回收进 plugin 的 40 个，真·仅存
experiments 的 63 个。

**值得回收的四个（人特别要求）**：
1. `git-lens-l-d-code-doc-ratio.ts`（125 行，L_D 代码:文档行增量比）
2. `git-lens-l-g-structural-drift.ts`（233 行，L_G 结构漂移）
3. `git-lens-l-s-behavior-variance.ts`（167 行，L_S 行为方差轻量变异探针）
   ——ADR-006/007 五透镜 L_D/L_G/L_S 的量化实现，与经典管线无关（各 1-2 处引用多在注释），补
   architecture-analysis 探针同类能力（gap-probe-mechanism-dead-15-days 的 AC3）
4. `derive-touches-heuristic.ts`（188 行，任务体缺 ## Touches 时机械抽取）——解决 ## Touches 声明不准
   痛点（并发派发与分支模型成本上界）。

**判据建议（防再堆积）**：测试文件若被测实现已不存在，应随实现一起删除——那 15 个文件仍在每轮
全套件里跑，无论绿红都不携带关于现行系统的信息。回答「优化省下的时间被什么吃掉了」。

### 选定机制

1. 回收四脚本进 plugin/scripts（git-lens L_D/L_G/L_S + derive-touches-heuristic），接入架构分析/派发
2. 删除 15 个被测实现已删的测试文件（每轮空跑无信息）
3. 判据机械化：被测实现不存在的测试文件 ⇒ 随实现删除（防再堆积）
4. 验证：回收脚本可用 + 15 文件移除后套件仍绿

## Acceptance Criteria

- [ ] AC1: 四脚本回收进 plugin/scripts（git-lens L_D/L_G/L_S + derive-touches-heuristic），实测可用
- [ ] AC2: git-lens 三脚本接入架构分析（补 probe-mechanism 的 AC3）
- [ ] AC3: derive-touches-heuristic 接入派发（## Touches 缺时机械抽取）
- [ ] AC4: 15 个被测实现已删的测试文件移除（每轮空跑无信息），套件仍绿
- [ ] AC5: 判据机械化——被测实现不存在的测试文件随实现删除（防再堆积）

## Touches

- experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts（回收）
- experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts（回收）
- experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts（回收）
- experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts（回收）
- plugin/scripts/（回收落点）
- 15 个被测实现已删的测试文件（删除）
- tasks/gap-probe-mechanism-dead-15-days-rewire-to-two-layer.md（AC2 交叉标注）

## Contract

measure   reclaimed_scripts = `ls plugin/scripts/git-lens-*.ts plugin/scripts/derive-touches-heuristic.ts 2>/dev/null | wc -l` stdout 数字段
band      reclaimed_scripts = 4（四脚本回收）
invoke    `ls experiments/quay-perpetual-stream/scripts/git-lens-*.ts experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts`
control   回收前（在 experiments）⇒ 0；回收后 ⇒ 4（AC1）
resume    四脚本回收与 15 文件删除分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
