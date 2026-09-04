---
id: gap-no-test-framework-policy-for-new-tests
title: No policy says which test framework new tests use — 34 files drifted to a
  hand-rolled harness with nothing to stop the 35th
status: done
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

## 顺带确立：测试层次的选择原则（不是覆盖率）

同一份分析发现另一个真实缺口：**没有政策说什么该用单元测试、什么该走端到端**。本任务把它写成
文字规则。原则是**「在你愿意保持稳定的边界上测试」**，分三层：

| 被测对象 | 用什么 | 理由 |
|---|---|---|
| **用户依赖的契约**：CLI 命令、MCP 工具、Provider ABI、web 路由 | **必须** ≥1 次真实端到端检查 | B5-1 的理由在此成立——测 `dist/quay.js`（`npm pack` 发的就是它）比测只存在于本仓库的源码更接近真实契约 |
| **分支密集的纯函数**：`checkSplitRecommendation`、`planCheckNextAction`、`checkTouchesPair` 等 | 直接 `import` 单元测试 | 经 CLI 测这些既慢又不精确——一个失败的 CLI 断言只说「输出里没有 X」，不说哪个分支错了。**实测这五个函数已全部如此，不需要补** |
| **内部实现细节** | **不测** | 测了就是把重构成本预付掉：行为没变而测试红 |

**不设任何数值阈值**——`gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 的成本数据还没
出来。在不知道成本结构时先设上限，本仓库刚犯过一次（AC9 的 416s，见
`gap-test-suite-has-no-layer-grouping` 的成本约束段）。**不重犯。**

### 明确不做：不把覆盖率作为目标

三条理由：

1. **覆盖率从未被测过**。`scripts/test.sh --experimental-test-coverage` 可用、CLAUDE.md 有记载，
   但**没有 CI 任务，没有任何地方记着一个数**。给一个从未测量的量设目标，就是 416s 那个错误
2. **覆盖率可 game**。本仓库自己就带着 `gate-gameability.test.mjs`——它知道指标会被 game。
   覆盖率百分比会招来「执行了行但什么都不断言」的测试
3. **该做的地方已经做了**。五个分支密集的纯决策函数全部已有直接 import 的单元测试。
   2.1:1 的进程/模块比**不意味着决策逻辑没被单元测试**

**真正缺的不是覆盖率，是契约清单。** 实测：`core-three-way-symmetry`、`provider-abi-conformance`、
`cli-edit-parity-conformance`、`provider-env-symmetry` 四个测试已经在做**表面对称性/一致性**检查，
但**没有任何一处枚举全部 CLI 命令或全部 MCP 工具**（`grep` 零命中）。有了清单，
「每个契约 ≥1 次端到端检查」就是**可机械检查的完备性，且不可 game**——你不能靠多写测试提高它，
只能靠真的覆盖一个此前没覆盖的契约。**这比覆盖率百分比强得多**，但它是独立的一块工作，
不在本任务范围内。

## Acceptance Criteria

- [x] AC1: 政策写进 `scripts/test.sh` 头注释与 `CLAUDE.md` 的测试段：新测试用 `node:test`
- [x] AC2: 豁免名单是一个**数据文件**（不是散在代码里的条件），当前 34 个文件逐个列出
- [x] AC3: 检查断言 glob 内每个文件要么 `import node:test`，要么在名单里
- [x] AC4: **名单只能变短** —— 有文件被加入名单时检查失败；用一个临时新文件真实演练这条
- [x] AC5: 新文件必须带 `// @test-group` 声明；缺声明的**新**文件失败（存量缺省仍为 `engine`）
- [x] AC6: 检查接进 `scripts/test.sh`，与其它 engine 组检查同样运行
- [x] AC7: 三层选择原则（契约→端到端 / 分支密集纯函数→import 单元测试 / 内部细节→不测）写成文字规则，
      **不设数值阈值**，并注明阈值待 `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 的数据
- [x] AC7b: 明确记录**不以覆盖率为目标**及其三条理由；若将来要看覆盖率，它是参考不是目标
- [x] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [x] 名单当前长度记在任务体（34），作为棘轮的起点
- [x] AC4 的真实演练有记录：加一个文件到名单 → 检查失败 → 移除 → 通过
- [x] `scripts/test.sh` 绿（`scripts/test.sh --for-task gap-no-test-framework-policy-for-new-tests` 绿，
      静态检查 + 13 个策略测试全过）
- [x] 任务体明写：**本任务不迁移任何存量文件，也不提速**

## AC4 真实演练记录（2026-08-03，worktree `task/test-framework-policy`，数据文件已提交为基线）

棘轮是两层：git-HEAD 严格子集（数据文件的**已提交形态**是基线，工作树是当前）+ **持久计数上限**
（数据文件头 `# baseline-count: 34`，任何状态下都不能超过 34 项，含干净提交/新 clone）。演练如下：

1. 提交基线：`plugin/test-framework-policy-exemptions.txt` 含 34 项 → `git commit`（HEAD 即基线）。
2. 加文件到名单：新建临时手写 harness 文件 `packages/quay/test/zz-ac4-rehearsal.test.mjs`，
   并把该路径 `>>` 到名单（35 项）。
3. 检查失败：`test-framework-policy-check` 退出码 **1**，
   报 `AC4: packages/quay/test/zz-ac4-rehearsal.test.mjs was ADDED to the exemption list —
   the list can only get SHORTER`（棘轮生效；同一文件已在名单里，AC3 静默，只有 AC4 响）。
4. 移除：`grep -v` 删掉该行，`rm` 临时文件（恢复 34 项）。
5. 通过：再次运行退出码 **0**，`PASS ... 34 exemption(s)`。

同一场景还有一个**自动化**演练被固化成测试（`plugin/test/test-framework-policy-check.test.mjs`
的 "CLI AC4 rehearsal" 用例）：在 scratch fixture 里用 `--baseline-file`/`--baseline-files`
跑 CLI，加文件到名单 → exit 1（AC4）→ 移除 → exit 0。两者都证明：**名单只能变短，加入即失败**。

## 内部对抗审查（REFUTE，2026-08-03）

**Round 1**（独立审查 agent）——2 MAJOR + 3 MINOR + 2 NIT，全部处理：

- **MAJOR-1 AC3 检测被注释/字符串绕过**：`// TODO: migrate to import { test } from "node:test"`
  之类注释会让手写文件「通过」检测。**修复**：改为 code-position 状态机检测（`buildNonCodeMask`
  跳过注释与字符串），真实 `import`/`require` 只在 code 位置计数；注释提及不再算导入。
  附带修掉一个更隐蔽的问题：naive 的 `/*...*/` 正则会被注释里的 glob（如 `packages/*/test/*.test.mjs`）
  骗到、把后续真实 import 吞掉。
- **MAJOR-2 棘轮对「已提交」改动失效**：git-HEAD 子集在干净提交时看不见「同一 commit 里加了文件又
  加了名单」。**修复**：新增**持久计数上限**（C0，`# baseline-count: 34`）——任何状态下名单超过
  34 即失败；`git commit` 后在新 clone 里跑也会红。固化为 scratch-git 测试。
- **MINOR-3** `--group <name> <file...>` 分支没跑静态检查 → 补上 `run_static_checks`。
- **MINOR-4** git 不可用时静默降级为 bootstrap（fail-open）→ 改为 **fail-closed**（exit 2），
  除非给了 `--baseline-file/--baseline-files` 或数据文件确实不在 HEAD（真 bootstrap）。
- **NIT**：`experiments/.../workflow-baseline-metrics.test.mjs` 是真实重复文件非符号链接——记录，
  不在本任务改；glob 单层覆盖——政策语言已限定为 canonical glob。
- **Round 1 后**：21/21 测试绿（含全部回归用例），`--for-task` 全绿。

**Round 2**（同一审查 agent 复验）——REVISE (minor)，2 项，全部处理：

- **R2-1 AC3 仍可被 regex 字面量绕过**：`/import { test } from "node:test"/` 写成 regex 字面量可
  通过（`buildNonCodeMask` 不认 regex）。**修复**：给 mask 加 regex 字面量识别（标准 lexer 启发式：
  `/` 前是空白/`=`/`(`/`,`/`{`/`return` 类关键字→regex；前是操作数/`)`/`]`/`++`→除法），regex 内容
  整体标为非代码。同时修 `loader.import("node:test")`（方法调用）被误判为动态 import——`import`/
  `require` 关键字现在要求 statement-start（前一个 code 字符是空白/`;(){}[]`，`.` 排除）。
  固化为测试：regex 字面量、`return /re/`、除法不吞 import、方法调用不算。全 164 个文件检测一致
  （非豁免全检出、豁免全不检出）。
- **R2-2 CLAUDE.md「NEVER/永久」声明夸大**：ceiling 从 working-tree 文件自读，同一 commit 里把
  `# baseline-count: 34` 改成 40 可绕过。**修复**：软化措辞（ceiling 是 header 控制面，pre-commit
  由 git strict-subset 守护；同 commit 里改 header+加文件是可被 code review 看见的编辑）；
  并把 ceiling 本身改成 **shrink-only**（C0b：working-tree count > HEAD count 即失败，能抓
  pre-commit ceiling bump），固化测试。
- **Round 2 后**：22/22 selftest + 25/25 node:test 绿，`--for-task` 全绿。

## 交叉标注（2026-08-08，gap-test-isolation-backlog-44-violations-unmeasured AC3）

**本任务的棘轮机制现在是第二个消费者。** 本任务（`gap-no-test-framework-policy-for-new-tests`）建立
了「数据文件 + `# baseline-count` 提交后封顶 + git-HEAD 严格子集」的 shrink-only 棘轮形态；
`test-isolation-check`（`gap-test-isolation-contract-is-unwritten` 的检查器）复用了**同一形态**
——数据文件 `plugin/test-isolation-violations.txt`、同样的 C0a/C0b/C1/C2a/C2c 判定（`runIsolationChecks`
与 `test-framework-policy-check` 的棘轮逐条对应）、同样的 commit-surviving 计数上限。两个检查器共享
同一套「名单只能变短」的不变量，但各有独立的数据文件与 ceiling（policy=34 豁免项；isolation=51 历史峰值，
当前 44 条）。**同一棘轮机制的第二消费者**由此交叉标注成立（AC3）。

- scripts/test.sh
- plugin/scripts/test-framework-policy-check.ts
- plugin/test/test-framework-policy-check.test.mjs
- CLAUDE.md
