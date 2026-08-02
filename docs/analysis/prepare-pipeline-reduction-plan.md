# Prepare 管线收缩方案：量化分析、清理与任务调整

**日期:** 2026-08-02
**依据:** 232 条 prepare-telemetry 记录 + ADR-021 四项原则 + 7/31 快速模式对照

---

## 1. 量化：成本集中在哪里

### 1.1 内容阶段（LLM）成本分解

| 阶段 | 累计耗时 | 调用次数 | 性质 |
|---|---|---|---|
| Adjudicate | 398.9 min | 75 | 内容生成——产出唯一提案 |
| **ProposalReview（含 delta）** | **1056.6 min** | 267 | **审查散文** |
| PlanAuthor | 635.2 min | 98 | 内容生成——产出计划 |
| **PlanCheck（3 轮）** | **1383.5 min** | 166 | **审查散文** |
| Receipt | 92.9 min | 26 | 机械写入 |

- Proposal 侧（Adjudicate + ProposalReview）：**24.3 小时**
- Plan 侧（PlanAuthor + PlanCheck）：**33.6 小时**
- **两个审查阶段合计：40.7 小时 = 全部 prepare 时间的 55%**

### 1.2 审查 vs 生成的比值

| | 生成 | 审查 | 审查/生成 |
|---|---|---|---|
| Proposal 侧 | 398.9 min | 1056.6 min | **2.6×** |
| Plan 侧 | 635.2 min | 1383.5 min | **2.2×** |

**每写 1 分钟内容，花 2.2–2.6 分钟审查它。** 而审查对象是散文——缺陷无界，所以审查收敛不了：PlanCheck 93% 用满 3 轮、79% 以 rounds-exceeded 失败。

### 1.3 对照：7 月 31 日快速模式

13 次内联对抗审查，**全部收敛**，产出 landing commit。差别只有一个：审查对象是**已写好的代码 + 真实测试结果**，判据有界（测试要么过要么不过）。

### 1.4 可回收上限

若把 ProposalReview 和 PlanCheck 的散文审查换成机械检查 + 后置对抗审查：

```
73.5 h  当前总耗时
-40.7 h  ProposalReview + PlanCheck
─────────
 32.8 h  收缩后（Adjudicate + PlanAuthor + Receipt + 机械检查）
```

**可回收 55%。** 这是上限，不是承诺——机械检查本身有成本，且部分审查价值会转移到 Build 后而非消失。

---

## 2. 收缩方案：prepare 只做三项机械确认

### 2.1 目标形态

prepare 的职责收缩为三项**机械可检**的确认，全部已有实现或接近实现：

| 确认项 | 机械实现 | 现状 |
|---|---|---|
| **机制数合理**（≤2 才进管线，>2 拆分） | `extractMechanismClaims` + `checkSplitRecommendation` | ✅ 已有，但**校准有缺陷**（覆盖率条目被计为机制）→ `gap-extract-mechanism-claims-calibration` |
| **AC 可执行** | `validatePlanStructure`（每个 AC 索引映射到 stage，每个 stage 有可运行 Command） | ✅ 已有，`preflightInvalidPlanCommand` 消费 |
| **Touches 完整** | `preflightTouchesMismatch` | ✅ 已有 |

三项都已存在。**不需要新建机制，只需要把它们提前、把散文审查取消。**

### 2.2 阶段变化

| 阶段 | 现状 | 收缩后 |
|---|---|---|
| ProposalAuthors | N=2/3 独立起草 | **N=1**（多样性价值在散文层不成立——Adjudicate 无论如何要合成一份） |
| Adjudicate | 合成 1 份 | 保留（若 N=1 则退化为直接写入） |
| **ProposalReview** | 1 full + ≤2/3 delta，审查散文 | **删除**，替换为机制数机械检查 |
| PlanAuthor | 撰写计划 | 保留（约束已注入，见 `_planShapeContract`） |
| **PlanCheck** | ≤3 轮 grounded 审查 | **删除**，替换为 `validatePlanStructure` + `preflightTouchesMismatch`（两者已在 PreflightPlan 中运行） |
| Receipt | 写收据 | 保留（可追溯性——ADR-021 明确要保留的部分） |

### 2.3 对抗审查移到 Build 之后

被删除的审查价值不消失，而是转移：

- **现在**：审查"提案说的机制是否都有 AC 覆盖" → 散文对散文，无界
- **之后**：审查"代码是否实现了 AC，测试是否真的验证了它" → 代码 + 测试输出，有界

execute-milestone 已有 Audit 阶段做这件事。7/31 的 13 次内联审查证明这个模式收敛。

### 2.4 分阶段落地（遵循 ADR-021 Phase 0 优先）

| 阶段 | 动作 | 依据 |
|---|---|---|
| **A（已完成）** | blocking-only 判据 + 收益递减退出 + 约束注入 + 递归守卫 + 拆分终局性 | commit `4f8495a7` |
| **B（下一步）** | 修 `extractMechanismClaims` 校准——它将成为三项确认之一，必须准确 | `gap-extract-mechanism-claims-calibration` |
| **C** | ProposalAuthors N=2→1；观测 Adjudicate 质量是否下降 | 可逆，先量后改 |
| **D** | PlanCheck 轮数 3→1（保留 1 轮做真实性抽查，而非收敛循环） | 需 B 的类型化发现先落地 |
| **E** | 若 B–D 后 prepared 率仍 <30%，再考虑删除 ProposalReview | 数据驱动，不预先承诺 |

**先量后改**：A 已落地但**尚无一次真实 dispatch 验证**。B–E 应在观测到 A 的真实效果后再推进。

---

## 3. 未提交文件的清理

### 3.1 现状

| 类别 | 数量 | 性质 | 处置 |
|---|---|---|---|
| `milestones/prepare-telemetry/**` | 64 未跟踪 | DIR-126-D 规定的**已提交遥测**——正是本次分析的数据源 | **提交** |
| `.quay/prepare-epochs/**` | 13 改 + 30 新 | epoch 记录，`.quay/` 下但**已跟踪**（38 个在版本控制中） | **提交** |
| `milestones/prepare-decisions/**` | 4 改 + 11 新 | M206 规定的拆分决策记录 | **提交** |
| `docs/plans/**` | 8 改 + 5 新 | PlanAuthor 产出的计划文档 | **提交** |
| `milestones/M2*/` | 若干 | preparation.json / absorb-entry / ledger | **提交** |
| `tmp/mechanical-failures-analysis-8e4b1f78.md` | 1 | 另一会话的临时分析 | **删除**（临时文件不入库） |
| `.halt` | 1 | 循环暂停哨兵 | **保留不提交**（运行时状态，非源码） |

### 3.2 关键判断

**这些不是垃圾，是本次分析的证据基础。** 232 条 telemetry 记录支撑了全部量化结论；epoch 和 decision 记录是 ADR-021 Phase 1「数据校准」的原始输入。丢弃它们等于丢弃预算基准表的样本。

`.halt` 需要单独确认：它存在意味着循环处于暂停态。提交前应确认是否要保持暂停。

### 3.3 建议命令

```bash
rm -rf tmp/                                    # 临时分析文件
git add milestones/ docs/plans/ .quay/prepare-epochs/
git commit -m "chore: commit prepare-pipeline artifacts (telemetry, epochs, decisions, plans)"
# .halt 保持未跟踪 — 运行时哨兵
```

---

## 4. 待执行任务的调整

### 4.1 ✅ 应立即标记 done（代码已落地，状态未更新）

grep 验证代码确实存在：

| 任务 | 落地标志 | 落地于 |
|---|---|---|
| `gap-recursive-guard-only-covers-multi-mechanism` | `_rawSplitTriggers` (2 文件) | `4f8495a7` |
| `gap-split-decision-finality-not-enforced` | `splitScopeHash` | `4f8495a7` |
| `gap-plancheck-blocking-only-convergence` | `planCheckNextAction` (3 文件) | `4f8495a7` |
| `gap-plancheck-no-diminishing-returns-exit` | `plancheck-diminishing-returns` | `4f8495a7` |
| `gap-planauthor-shape-rules-not-injected` | `_planShapeContract` (2 文件) | `4f8495a7` |
| `gap-prepare-milestone-epoch-scope-change-grants-full-review` | `bodyScopeHash` (26 refs) | M233 |
| `gap-prepare-milestone-no-worktree-isolation` | `prepare-merge` | M252 |

**7 个任务的代码已落地但 status 仍是 todo。** 这本身是一个流程缺口——直接执行（不走 execute-milestone）时没有机制更新任务状态。

⚠️ 前 5 项的 AC 中含「real dispatch 验证」类条款，严格说应为 `ready`（代码完成、待真实验证）而非 `done`。建议标 `ready` 并在首次真实 dispatch 后转 `done`。

### 4.2 ⏸️ 应暂停（被收缩方案降级或前提改变）

| 任务 | 原目标 | 为何暂停 |
|---|---|---|
| `gap-prepare-milestone-no-size-aware-routing-B` | 大小感知路由的清单机制 | 若 prepare 收缩为三项机械检查，**管线对所有任务都变廉价**，按大小分流的收益大幅下降。应等 A–D 落地后重新评估 |
| `gap-prepare-milestone-no-size-aware-routing-C` | 影子模式标定 + 自动启用 | 同上，且依赖 B |
| `DIR-124-F-core` | GroundTruthRegistry（事实注入 PlanAuthor/PlanCheck） | PlanCheck 若被删除，注入价值减半；PlanAuthor 侧价值仍在但已被 `_planShapeContract` 部分覆盖。应缩小范围重新表述 |
| `DIR-124-F-learn` | 学习循环（发现提升为注册表事实） | 依赖 F-core 和 F-plancheck，两者前提都在变 |

**暂停 = 保留任务，标注 `blocked-by: prepare-pipeline-reduction`，不进入调度**，而非取消——若 E 阶段决定保留 ProposalReview，它们的价值恢复。

### 4.3 ⬆️ 应提升优先级

| 任务 | 为何 |
|---|---|
| `gap-extract-mechanism-claims-calibration` | 机制数是收缩后**仅存的三项确认之一**，它的校准缺陷（覆盖率计为机制）会直接导致误拆。从"修复假阳性"升级为"核心机制正确性" |
| `DIR-124-F-plancheck` | 类型化 blocking 发现是 blocking-only 判据发挥全部效力的前提（当前走标量回退路径） |

### 4.4 ▶️ 不受影响，继续

`DIR-099-*`、`DIR-100-*`、`DIR-103-C`、`DIR-119-*`、`DIR-121`、`DIR-118`、`DIR-124-A*/B*` —— 这些是**产品/执行侧**任务，不依赖 prepare 管线形态。

### 4.5 调整汇总

```
标记 ready（代码已落地，待真实验证）：7
  gap-recursive-guard-only-covers-multi-mechanism
  gap-split-decision-finality-not-enforced
  gap-plancheck-blocking-only-convergence
  gap-plancheck-no-diminishing-returns-exit
  gap-planauthor-shape-rules-not-injected
  gap-prepare-milestone-epoch-scope-change-grants-full-review
  gap-prepare-milestone-no-worktree-isolation

暂停（blocked-by: prepare-pipeline-reduction）：4
  gap-prepare-milestone-no-size-aware-routing-B
  gap-prepare-milestone-no-size-aware-routing-C
  DIR-124-F-core
  DIR-124-F-learn

提升优先级：2
  gap-extract-mechanism-claims-calibration
  DIR-124-F-plancheck

不变：其余 ~20 个产品/执行侧任务
```

---

## 5. 与 ADR-021 的一致性检查

| ADR-021 原则 | 本方案 |
|---|---|
| 元机制比对象机制简单一个数量级 | 三项机械检查（各 <100 行）替代 1,700 行工作流中的两个审查循环 ✅ |
| Phase 0 优先——先正确使用已有约束 | 三项确认**全部已实现**，方案是重新排布而非新建 ✅ |
| 数据校准而非 LLM 估算 | 全部结论基于 232 条真实 telemetry ✅ |
| 编排器按代码区分路由 | 已落地（`4f8495a7` 的递归守卫 + 拆分终局性）✅ |

**最大的自洽性风险**：本方案自身可能变成又一个「在数据不足时构建机制」的案例。缓解——阶段 B–E 每一步都要求先观测 A 的真实 dispatch 效果，不预先承诺删除 ProposalReview。
