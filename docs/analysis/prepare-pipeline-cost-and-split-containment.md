# Prepare 管线成本与拆分遏制分析

**日期:** 2026-08-02
**数据源:** `milestones/prepare-telemetry/` 232 条真实 dispatch 记录 + Jul 31/Aug 1 会话历史 + git history

---

## 0. 总账：管线有效率 16.4%

| 指标 | 值 |
|---|---|
| prepare-milestone 总 dispatch | **232** |
| 到达 `prepared` 的 | **16** |
| **成功率** | **6.9%** |
| 总 wall-clock | **73.5 小时** |
| 产出 prepared 的时间 | 12.1 小时 |
| **有效率** | **16.4%** |

即：**每产出 1 份可用的 preparation receipt，管线消耗约 4.6 小时，其中 3.8 小时被丢弃。**

### 终端原因分布（按浪费的 wall-clock 排序）

| 终端原因 | 次数 | 总耗时 | 均耗时 | 性质 |
|---|---|---|---|---|
| `plancheck-rounds-exceeded` | 44 | **31.6h** | 43.1min | ❌ 全部浪费 |
| `preflight-rejected` | 40 | **13.8h** | 20.7min | ❌ 全部浪费 |
| `prepared` | 13 | 12.1h | 55.6min | ✅ 有效 |
| `split-recommended` | 24 | 5.6h | 13.9min | ⚠️ 67% 错误（见 §2） |
| `epoch-full-review-cap-exceeded` | 34 | 4.5h | 7.9min | ❌ 浪费 |
| `mechanism-inventory-invalid` | 22 | 4.2h | 11.6min | ❌ 浪费 |

**单一最大浪费：`plancheck-rounds-exceeded` 占全部 prepare 时间的 43%。**

---

## 1. Proposal/Plan 阶段耗时的三个根因

### 1.1 PlanCheck 几乎从不提前收敛

| 轮次 | 进入次数 |
|---|---|
| PlanCheck-round-1 | 57 |
| PlanCheck-round-2 | 56 |
| PlanCheck-round-3 | 53 |

**93% 的任务用满 3 轮，79% 最终以 `rounds-exceeded` 失败。**

三轮累计 **23.1 小时**（round-1: 5.96h, round-2: 9.21h, round-3: 7.89h）——占全部 prepare 时间的 **31%**。

**根因：收敛判据是 `F_i = 0`（零发现），而非"零阻塞性发现"。** 一个 grounded PlanCheck 总能找到非阻塞的改进建议（措辞、交叉引用、可选的额外测试），所以 `F_i = 0` 实际上不可达。轮次上限成了唯一的终止条件，而上限终止 = 失败。

对比 ProposalReview：它已经用 `blockingOpen(ledger).length === 0` 作为判据（`nextAction` 第 256 行），所以 ProposalReview 的 delta round 只跑了 78 次（vs full review 180 次）——它能提前停。**PlanCheck 没有继承这个设计。**

### 1.2 机械检查跑在昂贵的 LLM 工作之后

终端阶段分布：

| 阶段 | 终端数 |
|---|---|
| ProposalReview | 100 |
| **PreflightPlan** | **46** |
| PlanCheck | 45 |
| Admission | 22 |
| Receipt | 16 |
| PreflightContent | 3 |

`PreflightPlan` 是**纯机械的 plan 形状检查**（`parsePlanStages`/`validatePlanStructure`，非 LLM）。它有 46 次终端——但它跑在 `PlanAuthor` **之后**。

PlanAuthor 累计 **10.6 小时**（98 次调用，均 6.5 min）。其中约一半的产出被随后的机械形状检查拒绝。

**这是顺序倒置：昂贵的 LLM 撰写 → 廉价的机械检查拒绝。** 应该是：廉价的机械约束前置注入 → LLM 一次撰写成功。

对比 `PreflightContent`（内容预检，gating ProposalAuthors）：只有 3 次终端——因为它**确实**跑在内容 agent 之前，起到了 fail-fast 的作用。同样的机制，位置不同，效果差 15 倍。

### 1.3 没有"收益递减"的提前退出

当前 PlanCheck 的终止条件只有两个：`F_i = 0`（不可达）或轮次用尽。没有机制检测"这一轮和上一轮的阻塞性发现数相同 → 修改无效 → 停止"。

ProposalReview 有一个类似的缺口，已由 `checkMechanismStability`（M206）部分覆盖（检测跨轮次机制清单不稳定），但 PlanCheck 完全没有。

---

## 2. 拆分遏制：递归与重复

### 2.1 重复的 split-recommended：15 次多余 dispatch

同一任务被反复告知"应拆分"：

| 任务 | split-recommended 次数 |
|---|---|
| DIR-126-E | **5** |
| gap-wiring-coverage-check-whose-own-and-bold-marker-splitting | 4 |
| gap-prepare-milestone-split-decision-no-finality | 4 |
| gap-dir126d-deferred-phase-timing-recurrence-tracking | 3 |
| gap-prepare-milestone-epoch-scope-change-grants-full-review | 2 |
| DIR-124-F | 2 |
| DIR-124-A | 2 |

**15 次多余的 dispatch。** 每次约 14 分钟 → 约 **3.5 小时纯浪费**。

**根因：拆分决策的终局性没有被强制执行。** `decideSplitAdjudication`（M206）已经实现了正确的逻辑——一条匹配当前 hash 的 SPLIT 记录返回 `content-dispatch-blocked`，`outcome: needs-human`，`phase: Admission`。但这 15 次重复说明：要么决策记录未被写入（编排器只是重新 dispatch），要么 hash 不匹配导致记录被判定失效。

DIR-126-E 连续 5 次得到相同建议，是"机制存在但未被消费"的典型。

### 2.2 递归拆分的深度分布

`split-recommended` / `split-recursive-guard` 按 WBS 深度：

| 深度 | 任务 |
|---|---|
| 0（根） | gap-wiring-coverage(4), gap-split-decision-finality(4), gap-dir126d(3), gap-epoch-scope(2), gap-touches-orthogonality, gap-size-aware-routing |
| 1 | DIR-126-E(5), DIR-124-F(2), DIR-124-A(2), DIR-124-B |
| 2 | DIR-124-F4, F3, B2, A4, A3, A1, DIR-119-D5, **DIR-119-D3(guard)** |
| 3 | DIR-124-A1b, **DIR-124-F3b(guard)** |

**深度 2 有 8 个任务触发拆分建议，深度 3 有 2 个。** 递归是真实的、系统性的，不是偶发。

新落地的 `split-recursive-guard` 已经拦截了 2 次（DIR-124-F3b @ depth 3, DIR-119-D3 @ depth 2）——机制有效，但它只守 `split-multi-mechanism`，不守 `split-subsystem-blocking-cluster`。

### 2.3 拆分树的总量没有预算

DIR-124：1 个根指令 → 20 个任务（16 叶 + 4 复合父）。没有任何机制在第 5 个、第 10 个子任务时说"停"。

---

## 3. Jul 31 快速模式做对了什么

Jul 31：67 commits，+21.5K 行，**零 prepare-milestone dispatch**（该日的 prepare 记录全部来自 Aug 1 的补跑）。

其执行结构：

| 要素 | Jul 31 快速模式 | Aug 1 管线模式 |
|---|---|---|
| 需求表达 | 直接在会话中描述 | ProposalAuthors ×2/3 + Adjudicate |
| 设计审查 | **内联对抗审查 13 次**（"Round 2: close CONCERNS", "Round 3: fix SECOND REFUTATION"） | ProposalReview（180 次 full + 87 次 delta） |
| 计划 | 无独立 plan 文档 | PlanAuthor（98 次）+ PlanCheck（166 轮） |
| 隔离 | **6 个 worktree-agent 后台子代理** | prepare 无隔离（Aug 1 才加） |
| 收敛判据 | 人判断"审查通过了" | `F_i = 0`（不可达） |

**关键差异：Jul 31 的审查是"发现问题→立即修→再审"的短循环，且审查对象是已经写好的代码；Aug 1 的审查对象是提案文本，在代码存在之前。**

审查提案文本的问题：提案是散文，散文的"缺陷"是无界的——总能再精确一点、再补一条交叉引用。审查代码的问题是有界的——测试要么过要么不过。

Jul 31 的 13 次内联审查轮次全部收敛（都产出了 landing commit）。Aug 1 的 166 次 PlanCheck 轮次有 79% 未收敛。

---

## 4. 建议：约束 proposal/plan 耗时

### 4.1 PlanCheck 改用"零阻塞性发现"判据 ⭐ 最高优先级

将 PlanCheck 的收敛判据从 `findings === 0` 改为 `blockingFindings === 0`，与 ProposalReview 的 `nextAction` 保持一致。

- **前置依赖：** `DIR-124-F-plancheck`（PlanCheck 类型化发现）——必须先有 `blocking` 字段才能按它判定
- **预期收益：** 93% 用满 3 轮 → 预计降至 30-40%；`plancheck-rounds-exceeded`（31.6h）大幅下降

### 4.2 机械形状检查前置到 PlanAuthor 之前 ⭐ 高优先级

当前：`PlanAuthor`（6.5min）→ `PreflightPlan` 机械拒绝（46 次）。
改为二选一：

**方案 A（注入）：** 把 `validatePlanStructure` 的规则文本注入 PlanAuthor 的 prompt——这正是 `DIR-124-F-core`（GroundTruthRegistry）的设计目标。规则包括：`### Stage N` / `- AC:` / `- Files:` / `- Command:` 的确切格式，所有 AC 索引必须被映射。

**方案 B（骨架先行）：** PlanAuthor 先产出仅含 stage 标题 + AC 映射的骨架（~30 秒），跑 `validatePlanStructure`，通过后再撰写完整内容。

推荐 **A**，因为它复用已经规划的机制，且不增加 dispatch 次数。

### 4.3 收益递减提前退出

在 PlanCheck 每轮结束时比较：若 `blocking(round N) >= blocking(round N-1)`，停止并返回 needs-human，理由 `diminishing-returns`。不要跑满上限。

同样适用于 ProposalReview 的 delta round。

### 4.4 阶段级时间预算（ADR-021 Phase 1）

记录已有（`phaseTimings` 由 M207 落地）。加软上限：

| 阶段 | 建议软上限 | 依据（当前均值） |
|---|---|---|
| ProposalAuthors + Adjudicate | 15 min | 5.3 min/次 × 2-3 |
| ProposalReview（含 delta） | 20 min | full 2.5 + delta 6.7×2 |
| PlanAuthor | 10 min | 6.5 min |
| PlanCheck（全部轮次） | 20 min | 当前 23.1h/57 = 24 min |
| **总计** | **65 min** | 当前 prepared 均值 55.6 min |

超软上限 → WARN + 记录；超硬上限（1.5×）→ needs-human。

---

## 5. 建议：遏制递归拆分

### 5.1 强制拆分决策的终局性 ⭐ 最高优先级

`decideSplitAdjudication` 已实现 `content-dispatch-blocked`，但 15 次重复 dispatch 说明它没有被消费。需要：

1. **验证 Admission 阶段确实调用了 `--decide-split`** 且在 `content-dispatch-blocked` 时立即返回，零 agent turn
2. **若因 hash 不匹配导致记录失效**：SPLIT 记录不应因 body 的微小编辑而失效——SPLIT 是关于**结构**的判定，不是关于**文本**的。建议 SPLIT 记录只绑定 `charterHash` + `touchesSorted`，不绑定 proposal 正文 hash
3. **编排器侧**：dispatch 前检查 `milestones/prepare-decisions/<taskId>.json`，存在 SPLIT 记录且子任务未创建 → 不 dispatch，先补子任务

### 5.2 递归守卫扩展到所有拆分代码

当前 `split-recursive-guard` 只在 `split-multi-mechanism` 路径触发。深度 ≥ 2 的叶任务触发 **任何** 拆分建议都应转 needs-human：

```
if (wbsLevel >= 2 && splitCheck.recommend) {
  return { code: 'split-recursive-guard', repairable: false }
}
```

理由：深度 2+ 的任务已经过两轮分解，仍需拆分说明上游分解有结构性问题——无论触发的是机制数、触碰面还是发现聚集。

### 5.3 拆分树叶数预算

对每个根指令设定叶任务上限（建议 8），在 `checkSplitRecommendation` 中检查：

```
leafCount = countLeaves(rootDirective)
if (leafCount >= MAX_LEAVES_PER_ROOT) {
  return { code: 'split-budget-exhausted', repairable: false }  // → needs-human
}
```

DIR-124 若有此约束，会在第 8 个叶任务时停下，强制在更高层重新设计分解，而不是滑到 20 个。

### 5.4 修复 extractMechanismClaims 校准（已有任务）

`gap-extract-mechanism-claims-calibration` 已创建。这是 4 次错误 `split-multi-mechanism` 的根因——覆盖率条目被计为独立机制。

---

## 6. 优先级排序

| # | 措施 | 预期收益 | 依赖 | 工作量 |
|---|---|---|---|---|
| 1 | PlanCheck 改用零阻塞判据 | 减少 ~20h 浪费 | DIR-124-F-plancheck | 小 |
| 2 | 强制拆分决策终局性 | 减少 3.5h + 消除 limbo | 无 | 小 |
| 3 | 机械形状规则注入 PlanAuthor | 减少 ~7h（PreflightPlan 拒绝） | DIR-124-F-core | 中 |
| 4 | 递归守卫扩展到所有拆分代码 | 阻止深度 3+ 拆分 | 无 | 极小 |
| 5 | 收益递减提前退出 | 减少 ~5h | 1 | 小 |
| 6 | 修复 extractMechanismClaims | 消除 4 次假阳性拆分 | 无 | 中 |
| 7 | 拆分树叶数预算 | 阻止 DIR-124 类膨胀 | 无 | 小 |
| 8 | 阶段级时间预算 | 可观测性 + 兜底 | ADR-021 Phase 1 | 中 |

措施 1+2+4 合计工作量小、无依赖或依赖已规划，预计可回收 **~24 小时**（当前 73.5h 的 33%）。

---

## 7. 与 Jul 31 快速模式的和解

快速模式的优势不在"跳过审查"，而在**审查对象是代码而非散文**。管线模式的价值在于可追溯的 receipt 和可重放的决策记录。

两者不必二选一。建议的融合方向：

- **保留** prepare 管线的 receipt/ledger/决策记录（可追溯性）
- **压缩** proposal/plan 的审查深度——proposal 只需说清"改什么、为什么、如何验证"，不必穷尽 wiring claim
- **把对抗审查移到 Build 之后**（Jul 31 的做法）——审查真实代码 + 真实测试结果，判据有界
- **prepare 的职责收缩为**：确认任务范围合理（机制数）、AC 可执行、Touches 完整——这三项都是机械可检的

这个方向与 ADR-021 的原则一致：元机制应比对象机制简单。当前 prepare 管线（1,700 行工作流 + 166 轮 PlanCheck）比它要准备的多数任务本身还复杂。
