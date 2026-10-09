---
id: GOAL-032
title: verdict parser ownership
  收敛试点——parseFidelityVerdict/parseSemanticSufficiencyVerdict 收口进
  kernel（equivalent 调查结论，非 intentionally-divergent）
status: active
kind: goal
origin: 人 2026-10-09 裁定：对 criterion-fidelity.ts::parseFidelityVerdict 与
  goal-driver.ts::parseSemanticSufficiencyVerdict 做正式等价性调查，结论 equivalent 后创建并激活
  branch:true Goal，严格复用 GOAL-030/031 方法，范围只做这一对 parser 的 ownership 收敛，不碰其它
  verdict 类型/CLI 环/routine quota。调查过程与结论见 body「背景」。
activatedAt: 2026-10-09T01:55:04.388Z
branch: true
---
## 背景

**这是继 GOAL-030/031 之后第三个真实 goal branch 试点**，范围比前两个更小：只收敛**一对**被 ArchGuard `detect_duplicates` 命中的重复实现，验证"ownership-first"方法论对"文本→verdict 解析"这类跨层重复的适用性，不追求架构收益，不扩展到任何其它 verdict 类型。

**调查结论（本 goal 创建前已完成，非事后补充）**：

`packages/quay/src/criterion-fidelity.ts::parseFidelityVerdict`（`:71-87`）与 `plugin/scripts/goal-driver.ts::parseSemanticSufficiencyVerdict`（`:1142-1161`）是**结构相同且领域语义等价**（equivalent，非 intentionally-divergent）：

- 两者算法逐字相同：`exitCode!==0 ⇒ not-evaluated` → 裸 token 匹配 → 从末行向上扫描 `{"verdict":"..."}` JSON → 其余一律 `not-evaluated`。唯一差异是合法值的两个字符串字面量（`faithful`/`vacuous` vs `covered`/`insufficient`）。
- 非结构相似性推断：`criterion-fidelity.ts:27-28` 源码注释自述"reuses goal-driver.ts's parseSemanticSufficiencyVerdict fail-closed手法 **verbatim**"；`criterion-fidelity-historical-case.test.mjs:56` 测试文件自述"解析器 fail-closed（**复刻** parseSemanticSufficiencyVerdict 手法）"——两处独立文档均确认是蓄意复制，不是两个作者各自想出相同形状。
- 调用方编排（orchestration）真实不同且应该保持不同（ownership-first §1"编排可以继续留在原处"）：`criterionFidelityVerdict` 是同步、无缓存、经 `invokeJudge` seam 注入；`sampleSemanticSufficiency` 是异步、`runAsync`、2 次采样一致才入缓存、成因拆分（judge-unavailable/judge-unparseable/samples-disagree）。本 goal **不碰**这层编排差异。
- 解析算法本身是**领域无关**的："把判定器原始 stdout 解析成三态 verdict，读不懂就 fail-closed"不关心验证的是"fidelity"还是"sufficiency"——合法词表是**数据**，不是**逻辑**。

**目标不是删除重复本身，是把"文本→verdict 解析"这条职责迁移到正确所有权层**：新建 `packages/quay/src/kernel/verdict-parse.ts`（kernel——两层都能触达而不产生反向边，GOAL-030 已验证的放置原则），导出一个通用纯函数 `parseBinaryVerdict(stdout, exitCode, positive, negative)`；`parseFidelityVerdict`/`parseSemanticSufficiencyVerdict` 改为**薄包装**（调用 kernel 函数，保留各自原有函数名/签名/返回类型，零调用方改动）。

## 范围与非目标

范围：
- 仅 `packages/quay/src/criterion-fidelity.ts::parseFidelityVerdict` 与 `plugin/scripts/goal-driver.ts::parseSemanticSufficiencyVerdict` 这一对。
- 新建 `packages/quay/src/kernel/verdict-parse.ts`（纯函数，零依赖，天然满足 kernel"只 import kernel + 裸说明符"的约束）。

非目标（⛔ 有意排除）：
- ⛔ 不碰其它任何 verdict 类型（`GateVerdictKind`/`DimensionState`/`ScopedGateVerdict` 等 Quay 架构评审已发现的 27 文件分散字面量——那是独立、更大规模的缺口，不在本 goal 范围）。
- ⛔ 不碰 `packages/quay/src` 的目录环（core-root<->core-cli）。
- ⛔ 不碰正在自动运行的 routine quota 两个任务（`gap-routine-quota-canonical-config-and-policy-gate`已 done、`gap-routine-quota-consumer-convergence`已 ready，均不在本 goal 的 Touches 范围内，无文件重叠）。
- ⛔ 不改 `criterionFidelityVerdict`/`sampleSemanticSufficiency` 两个调用方的编排逻辑（同步/异步、缓存、2 次采样一致性）——只换它们内部调的解析函数的**实现**，不换**签名/返回类型/调用方式**。
- ⛔ 不重启任何生产 driver 进程（goal-driver.ts 是活跃 kind 的实现文件，但本次改动是纯函数重构、有完整回归测试，验证走分支 worktree，不要求重启生产进程才能验证正确性；是否需要重启让新代码在生产"生效"，留给人裁定，本 goal 不自行执行）。

## 判据形态

三态退出码（同 GOAL-030/031 惯例）：0 达成；1 未达成，同行带 `CAUSE=`；3 未评估（前提未落地、尚未并入）。

## 验证步骤

1. 激活前：ArchGuard 对 `develop` 当前 tip 的 before 基线——`detect_duplicates` 命中该组、`archguard_get_dependencies`/`get_package_metrics` 读 `criterion-fidelity.ts`/`goal-driver.ts` 当前各自的 canonical-definition 站点数（各 1，互不调用）。
2. 激活后核验：`goal/GOAL-032` 从 develop tip 懒创建；任务 worktree 从该分支开出；与仍在跑的 `gap-routine-quota-*` 两个任务互不干扰（不同分支/worktree，Touches 零重叠）。
3. 分支 tip 上：类型检查、既有回归测试（`criterion-fidelity-*.test.mjs` 三个文件 + `goal-sufficiency-semantic-covered.test.mjs` + consumer 测试）、`import-graph-check.ts`（kernel 边界不回退）。
4. 分支自举身份证明（规模对应本 goal 的实际风险——本次改动是纯函数重构，无新 driver/事件载体，不需要 GOAL-030 那种驱动进程沙盒级证明；取而代之核验**模块解析身份**：分支 worktree 内运行回归测试时，`import.meta.resolve`/`require.resolve` 解析到的 `verdict-parse.ts`/`criterion-fidelity.ts`/`goal-driver.ts` 的 realpath 落在该 worktree 内，不是主检出路径）。
5. Before/after 对比：同一 ArchGuard 构建对 fork point 与分支 tip（或合并提交两个父提交）各做一次单根分析，比较 §10 式指标（见下方 AC-348）。
6. 人工触发 merge：`quay goal merge GOAL-032 --reason ...`，worker-driver 机械 fan-in（`--no-ff`，全量 suite）。
7. 规定 merge shape：`develop` 的 first-parent 链上恰好一个合并提交，第二父提交是 `goal/GOAL-032` tip，分支内部提交不泄漏到 first-parent（同 AC-342 判据，本 goal 对应 AC-349）。
8. Post-merge 验证：核对两个旧函数在 develop 上确已是薄包装（不是叙述，是 grep 到的事实），两处调用方测试在主检出上仍绿。

## 停止扩大范围的信号

与 GOAL-030/031 同构：代码身份假阳性；生产污染；隔离失效；与仍在跑的 `gap-routine-quota-*` 任务产生任何依赖或干扰；需要往 `layers.yml` 加边（预期不需要——kernel 已是声明允许的落点）；目录环增加；基线漂移；人工干预持续增加。任一出现 ⇒ 不扩大范围，先修机制缺口，无法恢复则放弃分支并丢弃。

## 退出条件

`parseFidelityVerdict`/`parseSemanticSufficiencyVerdict` 的解析算法收敛为 `packages/quay/src/kernel/verdict-parse.ts` 的唯一实现，两处旧函数变为薄包装（调用方零改动）；ArchGuard before/after 证明 duplicate group 消失、canonical definition count 2→1、`plugin/scripts→packages/quay/src/kernel` 边新增（方向正确，与 GOAL-030 的 kernel 引入同构）；负对照证明两条调用链确实都真正改口（不是搬壳）；全部既有测试 + 新增测试绿；goal branch 以恰好一个合并提交进入 develop；并入后生产读数（两个薄包装函数的真实存在性）核验通过。对应 AC-347（结构与范围护栏 + 实现）、AC-348（ArchGuard before/after + 消费方收敛证据）、AC-349（并入形态 + 并入后核验）。