# Split 正确性审查：按机制数逻辑逐一复查

**日期:** 2026-08-01
**审查范围:** 8月1日以来 9 个触发 split-recommended 的任务
**审查方法:** 逐任务阅读 ## Proposal，识别可独立交付的机制，对照实际拆分结果

---

## 审查结果总表

| 任务 | 实际机制数 | 是否正确拆分？ | 问题 |
|---|---|---|---|
| DIR-124-A | **5** | ✅ 正确 | 5 个独立架构维度，拆成 5 子任务合理 |
| DIR-124-A1 | **2** | ❌ 过度拆分 | 只有 schema + instrumentation 两个机制，不应触发 split |
| DIR-124-A3 | **2** | ⚠️ 边界 | 2 机制恰好等于阈值，拆与不拆均可，实际拆了也能完成 |
| DIR-124-B | **4** | ✅ 正确 | RunIdentity / journal / cache / receipt 四个独立机制 |
| DIR-124-F | **~3** | ❌ 过度拆分 | 6 子任务，每个仅 ~80 行/7-9 AC——应拆成 3 个 |
| DIR-124-A4 | **1** | ❌ 不应拆分 | 单一脚本，16 个发现是同机制的实现细节 |
| DIR-124-A1b | **1** | ❌ 不应拆分 | 单一机制（8 阶段插桩），14 claims 是覆盖率计数 |
| gap-build-evidence | **2**（余下） | ❌ 不应拆分 | 机制 1 已 commit，余下 2 个可单 milestone 完成 |
| gap-epoch-scope-change | **1** | ❌ 不应拆分 | 单一机制 bodyScopeHash，拆分原因是 wiring-coverage |

**结论：9 个拆分中，只有 3 个是正确的（DIR-124-A, DIR-124-B, DIR-124-F 方向对但粒度太细）。5 个不应拆分，1 个边界。**

---

## 逐任务分析

### ✅ DIR-124-A：正确的 5 路拆分

**提案自述的 5 个机制：**

1. **A1 — stage-event schema + 发射**：定义规范事件形状 + 在 8 个阶段边界发射事件。无依赖。
2. **A2 — golden replay 语料库**：8 个命名 case + 已知缺陷形状。依赖 A1 的事件流。
3. **A3 — 不变量所有权清单**：单一权威所有者 + 重复/删除列表。无依赖。
4. **A4 — 元数据一致性检查**：meta.phases 声明 vs 可执行体。无依赖。
5. **A5 — 基线指标**：机械/内容拆分，显式未知量。依赖 A1 的事件流。

**评估：** 5 个机制各自独立可交付。A3 和 A4 无需等待 A1。A2 和 A5 共享 A1 依赖但互相不依赖。拆分正确，子任务数量合理。

---

### ❌ DIR-124-A1：只应拆成 2 个（实际拆了）

> A1 触发了 split，被拆成 A1a (schema 模块) + A1b (管线集成)。

**提案的实际机制：**

1. **Schema 定义**（A1a）：定义 `workflow-event-schema.mjs`，导出类型、验证函数、`--emit-event` CLI。**1 个机制。**
2. **阶段插桩**（A1b）：在 8 个边界调用 `_emitStageEvent`。**1 个机制——8 个调用点是同一模式的覆盖率，不是 8 个独立机制。**

**为什么触发了 split：** `extractMechanismClaims` 将 16 个 AC 项目对应的声明（"E1 插桩"、"E2 插桩"……"mirror 一致性"）计为 ≥3 个独立机制。实际上只有 2 个：schema + instrumentation。

**正确做法：** A1 应作为 1 个 milestone 完成（2 个机制，≤2 阈值，不触发 `split-multi-mechanism`）。2 个机制恰好是"复合任务"——可以单 milestone，如果 ProposalReview 发现聚集性缺陷就走绕行。

**实际拆分的结果：** A1a 完成了（1 机制，正确）。A1b 又触发了第二次 split，陷入 limbo——这正是我们刚实现的 `split-recursive-guard` 要防止的模式。

---

### ⚠️ DIR-124-A3：边界案例

> 拆成 A3a (清单 + 执行) + A3b (DoD 集成)。

**提案的实际机制：**

1. **不变量所有权清单 + 执行脚本**：一个结构化 markdown 文件 + 一个验证脚本（`workflow-invariant-ownership.mjs`）。清单和执行是同一个机制的不可分割的两半——没有执行脚本的清单毫无用处。**1 个机制。**
2. **DoD 门禁集成**：在 `it0-dod-check.ts` 新增一个 clause，shell out 到执行脚本。**1 个机制。**

**判断：** 2 个机制，恰好等于阈值 `> 2` 的边界。不应触发 `split-multi-mechanism`（需要 >2，不是 ≥2）。触发原因可能是 `extractMechanismClaims` 将清单格式、执行规则（单一所有者规则、所有者存在规则）、DoD 集成计为 3 个——但前两个是同一机制的内部细节。

**拆分结果不算差：** A3a（清单+执行，10 AC，375 行）✅ 完成。A3b（DoD 集成，6 AC，203 行）✅ 完成。两个都足够原子化。

**建议：** 此类 2 机制的任务，阈值不触发 split，应作为复合任务单 milestone 完成。如果 ProposalReview 发现 ≥3 个阻塞性发现，走 `split-subsystem-blocking-cluster` 绕行。

---

### ✅ DIR-124-B：正确的 4 路拆分

**提案自述的 4 个机制：**

1. **RunIdentity 铸造 + 规范标识符派生**：单一 `RunIdentity` 工厂——`runId` 来自 session ID + per-dispatch nonce。
2. **阶段日志存储 + hash 绑定收据信封**：版本化合同模块（`FindingEnvelope`/`StageEvent`/`StageReceiptEnvelope`），原子写入。
3. **Verify 缓存查找替换 + 持久化**：存储驱动的 Verify 缓存 + `resumePlan` 计算。
4. **收据信封接线**：将所有现有证据工件绑定到新收据合同。

**评估：** 4 个独立机制，每个可独立设计、实现、测试。拆分正确。子任务规模合理（77-215 行，7-11 AC）。

---

### ❌ DIR-124-F：方向对但粒度太细（6 个子任务，每个 ~80 行）

**提案的核心机制：** "构建一个版本化、hash 绑定的 GroundTruthRegistry"。

**实际可独立交付的机制（重新分析）：**

1. **Registry 数据 + CLI**（`ground-truth-registry.json` + `.ts`）：注入、验证、版本管理、hash。这是核心。F1（模板卫生）、F3（touches 覆盖）、F4（分类协调）、F5（种子完整性）都是同一个 Registry 机制的不同方面——它们不能独立交付，因为都需要 Registry 先存在。
2. **PlanCheck 类型化发现**（F2）：修改 PlanCheck 的输出 schema，使其产生类型化的 `grounded-fact-gap` 发现。这是独立的——它修改 PlanCheck，而非 Registry。
3. **学习循环**（F6）：`--promote` 路径，将 PlanCheck 发现提升为 Registry 事实。依赖 F2 的类型化发现和 Registry CLI。

**实际机制数 ≈ 3。** 拆成 6 个子任务（每个 73-85 行，7-9 AC）太细了——它们是实现步骤，不是架构决策。

**正确的拆法：**
- F-core（Registry 数据 + CLI + 种子 + 验证）：~300 行，8-10 AC
- F-plancheck（PlanCheck 类型化发现）：~150 行，7-8 AC
- F-learn（学习循环 + 接线）：~200 行，8-9 AC

---

### ❌ DIR-124-A4：不应拆分（1 个机制）

**提案的实际内容：** 一个单一脚本 `workflow-metadata-conformance.mjs`，对 4 个 workflow 文件执行 9 种检查（phase 集合、return 值、agent 计数、node 调用约定、worktree 提及、cache/resume 提及、gate 计数、mirror 字节同一性、重入 phase 文档）。

9 种检查 = **1 个机制**（工作流元数据一致性检查器）的 9 个方面。类似于一个 linter 有 9 条规则——你不会把每条规则拆成独立 milestone。

**拆分原因：** ProposalReview 发现 16 个同一子系统（wiring-coverage）的不同根因阻塞性发现。这是 `split-subsystem-blocking-cluster`——repairable=true，应先走绕行（一轮聚焦修改），只有绕行失败才拆分。

**正确做法：** 消耗绕行——一轮聚焦修改修复 16 个发现（它们都在同一子系统，根因相同：AC 覆盖不足）。如果绕行后仍有阻塞性发现，再考虑拆分。

---

### ❌ DIR-124-A1b：不应拆分（1 个机制）

**提案的实际内容：** 在 `execute-milestone.js` 和 `prepare-milestone.js` 的 8 个阶段边界插入 `_emitStageEvent` 调用。

8 个边界 = **1 个机制**（阶段事件发射 instrumentation）的 8 个调用点。14 个 wiring claims 是覆盖率——每个边界的 start/end 事件各计一个 claim。不是 14 个独立机制。

**拆分原因：** `extractMechanismClaims` 将每个边界的插桩计为独立机制。

**这就是我们刚实现的 `split-recursive-guard` 的典型案例：** 一个已是第 2 层（WBS level 2）的叶子任务，再次触发 `split-multi-mechanism`——但真正的"14 个机制"只是 8 个调用点。不应拆分。

---

### ❌ gap-build-evidence-manifest-missing：不应拆分（余下 2 个机制）

**提案列出的 3 个机制：**
1. 清单输出路径修复 → **已 commit**（`2b1d67c2`）
2. 每阶段证据消费
3. Git 失败 fail-soft

机制 1 已完成。余下 2 个机制，≤2 阈值。不应触发 `split-multi-mechanism`。

拆分从未完成（3 个子任务声明了但没有创建 `.md` 文件）——这本身就是信号：任务不够大到需要拆分。

---

### ❌ gap-prepare-milestone-epoch-scope-change-grants-full-review：不应拆分（1 个机制）

**提案的实际内容：** 单一机制 `bodyScopeHash`——在 epoch record 中存储 proposal 正文的 hash，用于检测 scope 变化并自动授予 fresh full-review 额度。

提案中的 A-J 步骤（schema 扩展、checkEpochCaps 逻辑、_recordEpochDispatchCli 计数器重置、_epochStatusCli hash 计算、_checkEpochCapsInline 镜像、workflow 状态线程……）全部是同一机制的**实现细节**，不是独立机制。

**拆分原因：** ProposalReview 发现 wiring-coverage 缺口——AC 覆盖不足。这是 `split-subsystem-blocking-cluster`，repairable=true。

**正确做法：** 添加缺失的 AC 复选框，消耗绕行。这恰好是"对 execute-milestone 是否关键"（原则 P1）判定的正面案例——epoch 上限修复直接影响 prepare-milestone 管线，是关键修复。应优先修复而非拆分。

---

## 过度拆分的根因

### 根因 1：`extractMechanismClaims` 将覆盖率条目计为独立机制

DIR-124-A1b 的"14 个机制"实际上是 8 个阶段的插桩（同一机制在不同位置的实例化）+ mirror 一致性（实现细节，不是机制）。

DIR-124-A4 的"16 个发现"是同一 linter 对不同检查点的输出——它们共享同一个子系统（wiring-coverage），同一个根因（AC 覆盖不足），同一个修复方式（添加 AC 复选框）。

**修复方向：** `extractMechanismClaims` 应该识别"同一模式重复 N 次" → 计 1 个机制。识别方法：如果多个 claim 的 wording 只有数字/标签不同（"E1 插桩"、"E2 插桩"……），合并为 1。

### 根因 2：ProposalReview 的发现被当成机制计数

DIR-124-A4 的情况——ProposalReview 发现了 16 个同一子系统的阻塞性发现。`checkSplitRecommendation` 正确地将其分类为 `split-subsystem-blocking-cluster`（repairable=true），但编排器跳过了绕行，直接写了拆分决策。

这不是拆分逻辑的缺陷——它是编排器自动批准策略的缺陷。`split-subsystem-blocking-cluster` 不应自动拆分。

### 根因 3：AC 覆盖缺口被当成机制缺失

gap-prepare-milestone-epoch-scope-change 的 Proposal 只有 1 个清晰机制，但 AC 复选框未覆盖所有 claim → ProposalReview 标记为 wiring-coverage 缺口 → split 建议。正确的反应是补充 AC，而非拆分任务。

---

## 综合结论

| 类别 | 数量 | 任务 |
|---|---|---|
| 正确拆分（机制数 ≥3，拆分粒度合理） | 2 | DIR-124-A (5→5，正确), DIR-124-B (4→4，正确) |
| 方向对但过细（机制数 ≥3，但子任务太碎） | 1 | DIR-124-F (~3→6，应 3→3) |
| 不应拆分（机制数 ≤2，被过度提取） | 3 | DIR-124-A1 (2), DIR-124-A1b (1), gap-build-evidence (2) |
| 不应拆分（1 机制，subsystem-cluster 应走绕行） | 2 | DIR-124-A4, gap-epoch-scope-change |
| 边界（2 机制，拆与不拆均可） | 1 | DIR-124-A3 |

**如果 `extractMechanismClaims` 校准正确，且编排器对 `split-subsystem-blocking-cluster` 走绕行：**

- 只有 3 个任务会触发 split（DIR-124-A, DIR-124-B, DIR-124-F）
- DIR-124-F 会拆成 3 个子任务而非 6 个
- 其余 6 个任务会作为原子或复合任务完成
- **减少 60% 的拆分决策，消除 100% 的 limbo 任务**
