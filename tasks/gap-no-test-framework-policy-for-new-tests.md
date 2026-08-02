---
id: gap-no-test-framework-policy-for-new-tests
title: "No policy says which test framework new tests use — 34 files drifted to
  a hand-rolled harness with nothing to stop the 35th"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

仓库里并存两种测试写法，**没有任何东西说过应该用哪种**：

| 写法 | 文件 | 断言 | 行数 |
|---|---|---|---|
| `node:test` | 126 (79%) | 6,114 (83%) | 38,711 |
| 手写 `assert()` + `failures` 计数器 | 34 (21%) | 1,235 (17%) | 12,204 |

后果已经实测到（`orchestration/test-shape-analysis.md`）：那 1,235 处断言**不在报告的测试数里**，
`--test-concurrency` **无法在文件内并行**它们，每文件耗时归因**到文件为止**。而它们恰好是最大的
四个文件：`prepare-milestone-convergence` 2,287 行、`serve` 1,800、`cli` 1,744、`mcp-server` 1,652。

**没有技术理由。** 核实过：手写文件若被 runner 之外的东西当普通脚本直接调用，那会是正当例外——
实测**一个都没有**。`grep` 命中的三处（`.github/workflows/ci.yml`、`release.yml`、
`loadbearing-test-gate.ts`）**全是注释里的文字提及，不是调用**。这 34 个文件是历史沉积。

**本任务不迁移存量。** 整体迁移已明确否决（`orchestration/test-shape-analysis.md`：没有实测的速度
收益、12,204 行机械改写有弱化断言的真实风险、会吃掉 12 小时窗口）。本任务只管**新写的测试**。

## Chosen mechanism

**一条政策 + 一个只能变短的豁免名单。** 散文规则会被转述掉（ADR-004），所以必须机械化。

1. **政策**：`scripts/test.sh` glob 覆盖的每个测试文件必须 `import` `node:test`。
2. **豁免名单**：当前 34 个文件显式列出，作为 legacy 例外。
3. **棘轮**：名单**只能变短**——检查在有文件被**加入**名单时失败。新文件既不用 `node:test`
   又不在名单里，立刻失败。
4. **顺带**：新文件必须带 `// @test-group <product|engine|governance>` 声明。机制已存在（缺省为
   `engine`），对新文件要求显式声明是零成本的。

这正是 ADR-019 决策 #1 已经确立的形态：**不静默排除，把例外写明并让它可见**（live-GitHub 测试
留在 glob 内自跳过，而不是被 glob 排除）。

### 棘轮是本任务真正的价值

存量迁移被否决了，但有了这个名单，**每个 legacy 文件会在有人为别的原因已经在改它时顺手转换**，
名单自然变短。**不需要一次 12,204 行的清扫，就能拿到迁移的收益。** 这是把一个已否决的大工程，
变成不花额外成本的增量进展。

### 明确说清它不买什么

**它不提速。** 统一框架不减少任何 CPU。它买的是：诚实的断言计数、逐测试归因、逐测试失败隔离、
一种写法。在当前满屏都是套件成本的语境里，这一点必须说明白，免得被当成提速手段排期。

## 不做：不设进程/模块比例的数值门槛

同一份分析发现另一个真实缺口：**没有政策说「每个入口保留几次真实端到端检查、其余走 import」**
（唯一的规则写在 `gap-tests-use-cli-where-module-import-suffices` 的任务体里，那是为一个任务写的）。

本任务**把这条规则写成文字**，但**不机械化任何数值阈值**——`gap-suite-cost-model-is-wrong-optimizations-buy-nothing`
的成本数据还没出来。在不知道成本结构时先设一个上限，本仓库刚犯过一次（AC9 的 416s，
见 `gap-test-suite-has-no-layer-grouping` 的成本约束段）。**不重犯。**

## Acceptance Criteria

- [ ] AC1: 政策写进 `scripts/test.sh` 头注释与 `CLAUDE.md` 的测试段：新测试用 `node:test`
- [ ] AC2: 豁免名单是一个**数据文件**（不是散在代码里的条件），当前 34 个文件逐个列出
- [ ] AC3: 检查断言 glob 内每个文件要么 `import node:test`，要么在名单里
- [ ] AC4: **名单只能变短** —— 有文件被加入名单时检查失败；用一个临时新文件真实演练这条
- [ ] AC5: 新文件必须带 `// @test-group` 声明；缺声明的**新**文件失败（存量缺省仍为 `engine`）
- [ ] AC6: 检查接进 `scripts/test.sh`，与其它 engine 组检查同样运行
- [ ] AC7: 「每个入口保留 ≥1 次真实端到端检查」写成文字规则，**不设数值阈值**，并注明阈值待
      `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 的数据
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] 名单当前长度记在任务体（34），作为棘轮的起点
- [ ] AC4 的真实演练有记录：加一个文件到名单 → 检查失败 → 移除 → 通过
- [ ] `scripts/test.sh` 绿
- [ ] 任务体明写：**本任务不迁移任何存量文件，也不提速**

## Touches

- scripts/test.sh
- plugin/scripts/test-framework-policy-check.ts
- plugin/test/test-framework-policy-check.test.mjs
- CLAUDE.md
