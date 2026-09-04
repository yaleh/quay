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

- [ ] AC1：用本仓库 8 个已落地退役任务做回归集（`session-liveness.sh` 是文档 §2.4 已给出完整算法
      与部分真值的主案例；另 7 个见文档 §2.4"其它 8 个已落地退役任务"一节，中位 ≈21 文件/9 目录），
      工具事前给出的 `DC` 与"改动集∪残留引用集"真值（按更正后的参照系现场核实，不是抄文档旧数字）
      的对称差 ≤ 20%，逐个任务贴出脚本输出与真值来源
- [ ] AC2（反向判据，文档已给）：对 `gate-script-lib.sh` 中被约 87 处 `source` 的共享库函数（真正
      封装良好的构件）跑该工具，剖面比 `R = |DC|/|CallGraph|` 不得 > 2；若报出则说明把叙述性引用
      当成了结构边，须提供该负例的真实脚本输出
- [ ] AC3：新增单测 `plugin/test/deletion-closure-check.test.mjs`，
      `node --experimental-strip-types plugin/test/deletion-closure-check.test.mjs` exit 0
- [ ] AC4：用当前仍未完成删除半边的活标本 `plugin/scripts/fan-in-ff-merge.sh`
      （见 [[gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live]]）跑一次该工具，输出的
      DC 清单须能直接喂给那个任务作为它的 Touches 候选清单——用一次真实交叉验证证明工具产出可操作，
      不是只能算历史案例

## DoD

AC1 的 8 个回归案例全部跑出真实输出并贴出对称差计算过程（不是宣称"≤20%"就算数）；AC4 的交叉验证
输出也贴出，且与 [[gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live]] 任务体里 AC1-AC3
实际列出的文件有可验证的重叠。脚本接入 capability-catalog 登记。

## Touches

- plugin/scripts/deletion-closure-check.ts（新增）
- plugin/test/deletion-closure-check.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- tasks/gap-archguard-p1-deletion-closure-checker.md
