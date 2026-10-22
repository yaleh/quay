---
id: gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point
title: WorkerPool 扩展点只覆盖「结局处理」——GOAL-909 之后新增仍 93.8%
  落在中心文件，因为翻转前后的横切钩子（读数/暗轴）没有注册位；跨项目同形状：扩展点只盖叶子、不盖主干
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（读数，2026-10-22，HEAD `329087733`）**：`worker-post-909` 窗口（`024f9d7f2..HEAD`，基线是 AC-915 扩展点落地提交）里，中心文件（`worker-driver.ts` + `worker-fan-in.ts`）新增 **288** 行，非中心新增 **19** 行 ⇒ **93.8%**（只计新增口径；净口径 102.13%，见 `gap-design-evolution-share-caliber-net-vs-additions`）。登记预测时定的判读门槛是分母 ≥1000 行，当前 307 行，**未达门槛，不作判读**；这里只记录方向。

**事实二（这些增长是什么）**：窗口内触碰中心文件的两个提交是 `e53aa1d3d`（slice-readings 接线：派发抓基线、fan-in 抓终值）与 dark-axis 谓词接线（`d88ad2db8`、`80d75e886`）。它们都不是「worker 结局处理」的变体——而是**横切关注点**。

**事实三（为什么扩展点没接住）**：GOAL-909 的 `WorkerPool` 扩展点（AC-915）定义的是「新的**结局处理**单元可从外部注册」。读数与暗轴谓词挂在**翻转前/翻转后**这条主流程上，不属于结局处理，于是只能直接写进 `worker-fan-in.ts`。这正是 R1/R2 模型的那句限定：**扩展点只对它定义的那一类变体有效**，不是「有扩展点就不会再往中心写」。

**事实四（后果）**：每新增一个横切关注点（读数、暗轴、将来的审计、指标）都要再改一次中心文件，增长回流的结构性成因没有消除。

**事实五（跨项目同形状，claudecodeui 会话 2026-10-22 提供并复核）**：它的 driver 重构给读数开了 registry（叶子），但 `startHost` / `bind` / `submit` / `interrupt` 这些**编排主干步骤**没有注册位，所以 `methodCount` 停在 **86**、`outDegree` 停在 **187**。它自己的表述是「**扩展点只盖叶子、不盖主干**」，与本节事实三互证。两个代码库、两个不同系统、同一形状 ⇒ 按硬规则 12 发生率 ≥2，够格做成机制。

**事实六（判据要分层）**：叶子与主干需要不同的 Π——
- **叶子注册表**：新变体从外部注册即可生效（现有 AC-915 那类）；
- **主干步骤注册**：新增一个横切步骤**不修改中心文件**，且正臂断言钩子被调用**恰好 1 次**、负臂断言 **0 次**（计数断言，不是「函数存在」）。
只把主干步骤抽成几个可替换函数、顺序仍硬编码在中心，那只是 R1（提取），出度大概率还会升；要让「阶段顺序」本身成为可注册的数据（例如一个有序步骤表，中心只负责遍历），才算 R2。

## Plan

1. **盘点现有硬接线钩子**：列出 `worker-fan-in.ts` 与 `worker-driver.ts` 里位于翻转前后、目前以直接调用形式存在的横切步骤（至少包含 slice-readings 的 baseline/post 与 dark-axis 谓词），逐条给 `file:line` 与调用点。
2. **引入主干步骤注册**（不是叶子注册表）：新增一个叶子模块（例如 `plugin/scripts/worker-fan-in-hooks.ts`），导出 `registerFanInHook({ name, phase: "pre-flip" | "post-flip", run })` 与一个唯一的 runner；**阶段顺序本身作为注册数据**（有序步骤表），中心文件只遍历、不点名任何钩子。只做「抽成几个函数」不满足本条。
3. **迁移一个真实消费者**：把 slice-readings 的 post 读数改成注册式，证明迁移可行（不是只造一条没人用的 seam）。
4. **负对照**：未注册的探针钩子必须**不被调用**（计数 0）；已注册的必须被调用一次（计数 1）。两臂都要断言，且正臂断言的是**计数**而不是「函数存在」（`triggered=1`）。
5. **诚实记账**：本任务自身也会给中心文件加行（runner 调用与类型），在任务里用 `git diff --numstat` 如实贴出，不掩饰。
6. **不动 WorkerPool 的结局处理扩展点**：那是另一个变体轴，不合并。

## Acceptance Criteria

- [ ] AC1 钩子盘点：贴出翻转前后直接调用的横切步骤清单（≥2 条），每条含 `file:line`、当前调用方、所属阶段（pre-flip / post-flip）；并贴 `grep -n` 的原始命中行。
- [ ] AC2 外部注册可生效：新建一个测试文件，从 `worker-fan-in.ts` **之外**注册一个探针钩子，跑一次翻转流程后断言探针被调用**恰好 1 次**（计数断言，不是存在性断言）；贴测试名与断言。
- [ ] AC3 负对照：同一测试里不注册该探针，断言调用计数为 **0**；贴该断言与两次运行的输出。
- [ ] AC4 中心文件只有一个 runner 调用点：`grep -n 'runFanInHooks\|registerFanInHook' plugin/scripts/worker-fan-in.ts` 中 runner 调用出现 1 次、且不再有对 slice-readings 的直接调用；贴这两条 grep 结果。
- [ ] AC5 迁移真实消费者：slice-readings 的 post 读数经注册式钩子触发，贴注册处与一次真实运行的记录（`.quay/slice-readings/<task-id>.json` 中 `post` 阶段的 `evaluated:true`）。
- [ ] AC6 如实记账：`git diff --numstat <基线>..<本任务头> -- plugin/scripts/worker-fan-in.ts plugin/scripts/worker-driver.ts` 贴出中心文件的新增/删除行数，并在任务里写明「本任务自身为中心文件贡献了多少行」；不要求为 0。
- [ ] AC7 扩展点判据：本任务用的是「钩子注册」这一扩展点形态，用 `node --experimental-strip-types plugin/scripts/extension-point-criteria.ts --scaffold` 生成的骨架填四臂后，`extension-point-criteria-check.ts` 判 `satisfied`；贴两次输出（填前 `missing-arms`、填后 `satisfied`）。

## Definition of Done

- 至少一个真实横切关注点（slice-readings）从「中心文件直接调用」迁移为「外部注册 + runner 调用」，且有正负两臂的计数断言。
- 新增第二个探针钩子不需要修改 `worker-fan-in.ts`（由 AC2 的测试证明：注册发生在另一个文件）。
- 中心文件的行数变化如实记录，且不把「这次自己加的行」算成「扩展点失败」。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in-hooks.ts
- plugin/scripts/slice-readings.ts
- plugin/test/worker-fan-in-hooks.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point.md
