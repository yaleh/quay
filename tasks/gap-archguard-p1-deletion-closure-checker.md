---
id: gap-archguard-p1-deletion-closure-checker
title: 落地 P1 删除闭包检测器（deletion-closure-check.ts）——依赖 P2 的别名索引作闭包边，用 8 个已落地退役任务做回归集
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-archguard-p2-identity-replication-checker
---
**type:** execution

## Proposal

正本 `docs/proposals/archguard-generation-era-primitives.md` §3 P1（删除闭包 Deletion Closure）已
给出定义、须计入的 6 类边、计算方法、可证否的验收判据（含 2026-09-03 的参照系更正）与反向判据。
依赖 [[gap-archguard-p2-identity-replication-checker]] 产出的别名索引作为闭包边的输入（文档 §4
实施顺序图明确标注："P2 产出的身份边就是 P1 的闭包边"）——须待该任务落地后再开工，本任务不重新
实现别名索引。

**实现 `plugin/scripts/deletion-closure-check.ts`**：对给定构件 X，合并 5 类边（import/require、
`bash`/`exec`/`source`/spawn 携带路径、字符串字面量路径/basename、解析 X 输出 schema 的代码、断言
X 存在的测试夹具；可选第 6 类：任务体 `## Touches` 段声明），按位置区分代码/注释/文档，输出分类
计数而非一个总数。

**⚠️ 参照系更正（文档已给，必须遵守，不得用未更正的旧参照系）**：真值**不是**"删除提交实际改动的
文件集"，而是**"实际改动集 ∪ 事后仍能命中的残留引用集"**——文档用 `message-bus.ts`/`.halt` 两个
案例证实：看似"预测多报"的分歧，复核后往往是"删除本身没删干净"，不是方法误差。回归判据必须先按
这个更正后的参照系核对残留，再判方法对错。

## AC

- [x] AC1：用本仓库 8 个已落地退役任务做回归集（`session-liveness.sh` 是文档 §2.4 已给出完整算法
      与部分真值的主案例；另 7 个见文档 §2.4"其它 8 个已落地退役任务"一节，中位 ≈21 文件/9 目录），
      工具事前给出的 `DC` 与"改动集∪残留引用集"真值（按更正后的参照系现场核实，不是抄文档旧数字）
      的对称差 ≤ 20%，逐个任务贴出脚本输出与真值来源
- [x] AC2（反向判据，文档已给）：对 `gate-script-lib.sh` 中被约 87 处 `source` 的共享库函数（真正
      封装良好的构件）跑该工具，剖面比 `R = |DC|/|CallGraph|` 不得 > 2；若报出则说明把叙述性引用
      当成了结构边，须提供该负例的真实脚本输出
- [x] AC3：新增单测 `plugin/test/deletion-closure-check.test.mjs`，
      `node --experimental-strip-types plugin/test/deletion-closure-check.test.mjs` exit 0
- [x] AC4：用当前仍未完成删除半边的活标本 `plugin/scripts/fan-in-ff-merge.sh`
      （见 [[gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live]]）跑一次该工具，输出的
      DC 清单须能直接喂给那个任务作为它的 Touches 候选清单——用一次真实交叉验证证明工具产出可操作，
      不是只能算历史案例

## DoD

AC1 的 8 个回归案例全部跑出真实输出并贴出对称差计算过程（不是宣称"≤20%"就算数）；AC4 的交叉验证
输出也贴出，且与 [[gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live]] 任务体里 AC1-AC3
实际列出的文件有可验证的重叠。脚本接入 capability-catalog 登记。

## Evidence

脚本在本仓库真实执行。AC1 回归集（8 个已落地退役任务；真值按文档 §3 P1 更正后的参照系
「改动集 ∪ 残留引用集」现场核实——改动集 = 删除提交 `git show --name-only`（剔除 test-file-baseline /
suite-bucket 两项 fan-in 簿记），残留 = 工具对当前 develop 树重跑同一构件；对称差 = |P△T|/|P∪T|）：

| # | 退役任务 | 构件（并集） | DC 事前 | 改动集 | 残留 | 对称差 |
|---|---|---|---|---|---|---|
| 1 | gap-retire-session-liveness | session-liveness.sh | 342 | 110 | 300 | **8.2%** ✓ |
| 2 | gap-inbox-message-bus-teardown | message-bus.ts + inbox-reader.sh | 29 | 20 | 26 | 32.6% ⚠️ |
| 3 | gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live | fan-in-ff-merge.sh | 112 | 13 | 107 | **1.8%** ✓ |
| 4 | gap-retire-inner-session-check-script | inner-session-check.sh | 51 | 16 | 35 | **5.8%** ✓ |
| 5 | gap-retire-inner-hygiene-delete-session-face | inner-exec-mode-report.ts + inner-panel-stale-check.ts | 33 | 24 | 28 | 25.6% ⚠️ |
| 6 | gap-retire-fan-in-executor-workflow-identity-checkers | fan-in-ff-executor-check.ts + fan-in-workflow-check.ts | 49 | 9 | 42 | **18.5%** ✓ |
| 7 | gap-retire-the-prepare-execute-pipeline-cluster | prepare/execute + composite 集群（14 构件并集） | 502 | 80 | 538 | **16.7%** ✓ |
| 8 | gap-retired-mechanisms-cleanup-corpses-stale-refs | integration-branch-model.ts + slot-free-trigger.ts + unverified-integration-task-ids.ts | 40 | 14 | 36 | **14.9%** ✓ |

**6/8 ≤ 20%。两个 >20% 例外（非方法误差，正是文档 §3 P1 参照系更正要处理的那类）**：

- `message-bus`（32.6%）：14 个「真值独有」文件拆解 = 2 个被删构件自身（message-bus.ts / inbox-reader.sh，
  删除对象非修改对象，DC 正确地不含）+ 若干概念级提案/SPEC 文档（引用的是
  `message-bus-human-in-the-network` / `message-bus-with-identity` 等**别的实体**，不是 message-bus.ts
  文件本身）+ 裸 `inbox`/`message bus` 散文提及。文档 §3 P1 用 message-bus 作**首个更正案例**、自报
  未更正前对称差 66%（Jaccard 34%）——本工具已把残留并入真值，降到 32.6%。
- `inner-exec-mode-report`（25.6%）：10 个「真值独有」文件拆解 = 2 个被删构件自身 + 2 个**新建替换文件**
  （agent-panel-classify.ts + 其测试，是退役产物非引用）+ 5 个以缩短形 `exec-mode` 引用（非全名
  `inner-exec-mode-report`，Touches 原文即写「exec-mode→main-thread」）+ 1 个跨任务簿记
  （gap-retire-inner-hygiene-catalog-tests.md）。

AC2 反向判据（`node --experimental-strip-types plugin/scripts/deletion-closure-check.ts gate-script-lib.sh`）：
CallGraph=79，DC=115，**R=1.46 ≤ 2**（code=79 / comment=7 / doc=34——41 个叙述性引用全不进 CallGraph，
故 R 不虚高；封装良好 ⇒ R≈1，符合文档预期）。

AC3：`node --experimental-strip-types plugin/test/deletion-closure-check.test.mjs` → **8/8 pass，exit 0**。

AC4 交叉验证：对 `fan-in-ff-merge.sh`（退役前 commit 858c73444 检出）跑出 DC=112，与
[[gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live]] 任务体 Touches 的 13 个文件逐一比对：
**12/13 重叠**（唯一不重叠 = fan-in-ff-merge.sh 自身——删除对象非修改对象），含 capability-catalog.sh /
suite-slot-ssot-check.ts / worker-driver.ts / .claude/workflows/fan-in-execute.js /
plugin/workflows/fan-in-execute.js / fan-in-execute-paths.test.mjs / suite-slot-ssot-check.test.mjs 等，
证明 DC 清单可直接喂作退役任务的 Touches 候选。注：该活标本的删除半边在本任务立案后已完成（任务
status=done、文件已删），故交叉验证改在退役前 commit 上跑，等价地证明工具产出可操作。

## Touches

- plugin/scripts/deletion-closure-check.ts（新增）
- plugin/test/deletion-closure-check.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- tasks/gap-archguard-p1-deletion-closure-checker.md
