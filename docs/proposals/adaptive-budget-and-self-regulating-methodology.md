# 自适应预算与自举方法论

**日期:** 2026-08-01
**动机:** 自动化机制（prepare-milestone、split-recommended、ProposalReview）在消除人工摩擦的同时，也消除了人工的"够好了，交付吧"判断。工作量随自动化程度非线性增长——这需要同等级别的自动化约束机制来平衡。

---

## 1. 问题：自动化放大工作量

### 1.1 量化证据

DIR-124 是一个极端但真实的案例：

```
原始: 1 个任务, 168 行, 15 AC
      ↓ prepare-milestone → ProposalReview → split-multi-mechanism
      ↓ 拆分为 A/B/C/D/E/F (6 子任务)
      ↓ 其中 A 再次拆分 → A1..A5 (5 子任务)
      ↓ 其中 A1 再次拆分 → A1a, A1b (2 子任务)
      ↓ 其中 A3 再次拆分 → A3a, A3b (2 子任务)
      ↓ B 再次拆分 → B1..B4 (4 子任务)
      ↓ F 再次拆分 → F1..F6 (6 子任务)
结果: 20 个任务, ~6,150 行, ~205 AC
扩张比: 20x 任务数, 36x 行数, 14x AC 数
```

其中 **5/17 叶任务已完成**，预估全部完成需要 **~4-13 小时 wall-clock + ~3.4-8.5M tokens**。而这只是 DIR-124 一个原始指令。

### 1.2 为什么人工驱动时不明显

人工驱动的模式有天然的约束：

- **提案者说"够了"**：一个人写 proposal，觉得说清楚了就停。LLM 会持续发现新的 wiring claim、新的机制边界、新的 grounding fact。
- **审核者说"过了"**：一个人 review proposal，觉得可以了就 approve。LLM ProposalReview 永远能找到新的阻塞性发现。
- **管理者说"先交付"**：一个人看到三个任务排队，挑最重要的一个先做。自动化管线没有优先级概念——所有 ready 任务平等。

自动化消除了这些**饱和度判断**——它不知道什么时候"够了"。

### 1.3 空间展开和时间展开

两类不同的扩张：

**空间展开**（拆分树）：一个任务 → N 个子任务 → M 个孙子任务。每个节点都需要独立的 prepare-milestone + execute-milestone。DIR-124 是典型。

**时间展开**（重试循环）：同一个任务反复 prepare-milestone。DIR-099 被重试 8 次，每次都得到相同的 split 建议。epoch 上限被反复触及，每次都触发手工接管。

两种展开都会在没有约束的情况下无限增长。

---

## 2. 预算作为约束机制

### 2.1 为什么是预算

预算不是一个新概念。它在软件工程中有成熟的先例：

- **时间预算**：sprint（Scrum）、timebox（Pomodoro）
- **算力预算**：CI 分钟数（GitHub Actions）、API 调用限额
- **复杂度预算**：圈复杂度上限、文件行数上限

在 LLM 驱动的自动化开发中，预算的特殊价值在于：**它是同一种媒介（自动化规则）约束另一种自动化机制**。LLM 可以估算工作量、追踪消耗、在超预算时采取行动——这些都和产生工作的机制共享同一个执行层。

### 2.2 预算的三个维度

| 维度 | 指标 | 为什么需要 |
|---|---|---|
| **时间** | wall-clock 分钟（prepare + execute + audit + land） | 人的注意力和会话上下文窗口有限。一个超过 2 小时的任务难以在单会话中跟踪。 |
| **算力** | LLM tokens（输入 + 输出） | tokens = 金钱 + 延迟。DIR-126 的 5 个子任务各消耗 200-500K tokens——知道这个数字才能做出"拆还是不拆"的决策。 |
| **产出** | 代码行数 / 文件数 / AC 数 | 产出量本身不是目标，但产出量超过一定阈值意味着复杂度超出单 agent 的管理能力。 |

### 2.3 预算的生命周期

```
Proposal 阶段：估算预算
  ├── 时间估算：基于历史数据（同类型任务的中位数）
  ├── 算力估算：prepare rounds × avg tokens/round
  └── 产出估算：预计文件数 × 历史 avg LOC/file

Plan 阶段：细化预算
  ├── 每阶段（Build/Audit/Gate/Land）分配子预算
  └── 设定预警阈值（80% 黄灯，100% 红灯）

Execute 阶段：追踪消耗
  ├── prepare-milestone 每次 dispatch 记录 tokens + wall-clock
  ├── execute-milestone Build 记录代码变更量
  └── 更新 budget.json → 阶段完成时比较实际 vs 估算

Land 阶段：结算
  ├── 记录实际消耗
  └── 反馈到估算模型（校准下一次的估算准确率）
```

---

## 3. 预算的校准：自举

### 3.1 为什么需要自举

初始预算估算不可能准确——我们不知道一个"typical" DIR-124 子任务需要多少 tokens。但每完成一个任务，我们就多一个数据点。

**自举过程：**

```
第 1 个任务：估算 = 默认值（如 300K tokens, 45 min）
实际消耗 → 存入历史数据库
第 2 个任务：估算 = 历史同类型任务的中位数 ± 方差
实际消耗 → 更新历史数据库
...
第 N 个任务：估算 = 考虑更多特征（机制数、touches 文件数、AC 数、提案密度）的回归模型
```

### 3.2 从 DIR-126 可以提取的基准

DIR-126 的 5 个子任务是理想基准——它们都是单机制、都完成了、都没有触发不必要的拆分：

| 子任务 | AC | 行数 | 机制数 | 状态 | 作为基准 |
|---|---|---|---|---|---|
| A | 19 | 779 | 1 | done | 大型单机制任务的上限参考 (~800 行, ~20 AC) |
| B | 29 | 679 | 1 | done | 同上 |
| C | 32 | 824 | 1 | done | 同上 |
| D | 29 | 1063 | 1 | done | 特大单机制（~1000 行）, 仍可单 milestone |
| E | 28 | 948 | 1 | done | 同上 |

**基准推论：**
- 单机制任务的中位代码量：~800 行
- 单机制任务的 AC 数上限：~32（仍然可以单 milestone 完成）
- **因此 1 机制任务的默认预算应为：~800 行代码, ~30 AC, ~60 min wall-clock, ~500K tokens**

### 3.3 不同机制数的预算基准

| 机制数 | 预计代码量 | 预计 AC | 预计 wall-clock | 预计 tokens | 风险等级 |
|---|---|---|---|---|---|
| 1 | 50-1,000 行 | 3-30 | 15-60 min | 150K-500K | 低 |
| 2 | 200-1,500 行 | 8-40 | 30-90 min | 300K-800K | 中——应单 milestone，除非 sub-cluster |
| 3 | 400-2,000 行 | 15-50 | 45-150 min | 500K-1.2M | **应拆分**——每个子任务 1 机制 |
| 4+ | 800-3,000 行 | 20-60 | 60-200 min | 800K-2M | **必须拆分** |

这是初始基准——每个完成的任务都会更新它。

---

## 4. 预算的自动执行：约束而不是建议

### 4.1 硬约束 vs 软约束

| 类型 | 行为 | 适用场景 |
|---|---|---|
| **硬约束** | 超预算 → 立即停止，needs-human | prepare-milestone 的 delta round cap（已有），机制数 ≥ 3 的自动拆分 |
| **软约束** | 超预算 → 发出警告，记录偏差，继续执行 | 代码行数略超估算，wall-clock 略超估算 |
| **自适应约束** | 超预算 → 自动扩大预算（有上限） | epoch scope-change grant（刚实现的 bodyScopeHash），disposable bypass（一次性的 repairable cluster 绕行） |

### 4.2 一个具体的设计：TokenBudget

```typescript
interface TokenBudget {
  // 估算（Proposal 阶段设定）
  estimated: {
    prepareTokens: number;    // prepare-milestone 预计 tokens
    executeTokens: number;    // execute-milestone 预计 tokens
    totalTokens: number;      // 总计
    wallClockMinutes: number; // 预计 wall-clock
  };
  
  // 实际消耗（运行时更新）
  actual: {
    prepareTokensSpent: number;
    executeTokensSpent: number;
    roundsSpent: number;      // prepare-milestone delta rounds
    codeInsertions: number;   // git diff --stat insertions
    filesChanged: number;
  };
  
  // 约束
  constraints: {
    maxPrepareTokens: number;       // 硬约束：prepare 总 tokens 上限
    maxDeltaRounds: number;         // 硬约束：delta round 上限（已有）
    maxWallClockMinutes: number;    // 软约束：超时警告
    maxCodeInsertions: number;      // 软约束：代码量异常检测
    maxFilesChanged: number;        // 硬约束：touches 文件数 > 8 → split（已有）
  };
  
  // 状态
  status: 'within-budget' | 'warning' | 'exceeded' | 'force-stopped';
}
```

### 4.3 TokenBudget 的生命周期集成

**Proposal 阶段：**
- `extractMechanismClaims` 估算机制数 → 查询预算基准表 → 设定 `estimated`
- 如果机制数 ≥ 3 → 不进入 prepare，直接路由到 split-decision
- 记录估算到 task body（`## Budget: {estimated: ...}`）

**Plan 阶段：**
- PlanAuthor 看到预算 → 按阶段分配子预算
- PlanCheck 验证：预算是否合理？各阶段分配是否 <= 总计？

**Prepare 阶段：**
- 每次 `_recordGenerationCli` 记录 tokens 消耗
- `_checkBudget()` 在每次 delta round 之前检查：`actual.prepareTokensSpent + estimatedNextRound > constraints.maxPrepareTokens?`
- 超预算 → `stop-needs-human` with `reason: budget-exceeded`

**Execute 阶段：**
- Build 完成后比较实际代码变更 vs 估算
- 偏差 > 2x → 记录到 budget.json 供后续校准

**Land 阶段：**
- 最终结算：写入 `milestones/M<NN>/budget.json`
- 更新基准数据库：`budget-calibration.jsonl`

---

## 5. 更深层的问题：机制的自指性

### 5.1 元机制与对象机制

当前的问题结构：

```
对象机制（被管理的）：
  - prepare-milestone（准备任务）
  - execute-milestone（执行任务）
  - ProposalReview（审核提案）
  - split-recommended（建议拆分）

元机制（管理对象机制的）：
  - TokenBudget（约束资源消耗）
  - checkSplitRecommendation（判断是否应拆分）
  - epoch cap（限制重试次数）
  - bodyScopeHash grant（检测 scope 变化）
```

**关键观察：** 元机制本身也会膨胀。TokenBudget 可以约束 prepare-milestone——但谁来约束 TokenBudget 的复杂度？如果 TokenBudget 的估算模型需要 10 个特征、3 轮校准、历史数据库维护脚本……它自己就成了一个需要管理的东西。

### 5.2 自指性的解决方案：最小可行元机制

**原则 1：元机制必须比它管理的对象机制简单一个数量级。**

`checkSplitRecommendation`（42 行纯函数）管理 `prepare-milestone`（1,700 行工作流）。`epoch cap`（12 行计数器逻辑）管理 `ProposalReview` 的重试循环。这是一个健康的比例。

反过来，一个需要 500 行估算逻辑 + 100 行历史分析 + 50 行 CLI 接口的 TokenBudget 就不是——它和它要管理的 prepare-milestone 一样复杂。

**原则 2：元机制应退化而非膨胀。**

当估算不准确时，退化到默认值（如：机制数 1 → 500K tokens），而不是增加更多特征来提高准确率。每个特征都增加维护负担——准确率提升 10% 需要 100% 的复杂度增长，这不划算。

**原则 3：自指循环必须有终止条件。**

如果元机制 A 管理对象机制 B，而元机制 A' 管理元机制 A，那么 A' 必须极度简单（如一个固定的计数器），且 A'' 不应存在。三层已经太多了。

---

## 6. 具体建议：最小可行的自适应预算

### 6.1 Phase 0：利用已有机制（今天可做）

不需要新增任何代码。利用已有的：

| 已有机制 | 作为预算约束 | 当前行为 | 需要的调整 |
|---|---|---|---|
| `checkSplitRecommendation` (机制数 > 2) | **空间预算**：超过 2 个机制 → 拆分 | 已生效 | 修复 `extractMechanismClaims` 校准（覆盖率 ≠ 机制） |
| `nextAction` delta cap (max 2/3 rounds) | **时间预算**：最多 N 轮 delta review | 已生效 | 无 |
| epoch full-review cap (max 1) | **算力预算**：每 epoch 最多 1 次全量 review | 已生效 | 区分非关键阻塞的 force-commit vs 关键阻塞的重试 |
| `bodyScopeHash` grant | **自适应预算**：scope 变化时自动扩大 | 刚实现 | 在 CLAUDE.md 中记录使用策略 |
| `split-recursive-guard` (wbsLevel ≥ 2) | **深度预算**：最深拆分到第 2 层 | 刚实现 | 无 |
| touches > 8 → split | **表面预算**：触碰文件数上限 | 已生效 | 无 |

**这些加起来已经覆盖了空间、时间、算力三个维度。** 8 月 1 日的过度拆分问题，如果这些机制被正确使用（`split-subsystem-blocking-cluster` 走绕行，`extractMechanismClaims` 正确校准），大部分可以避免。

### 6.2 Phase 1：增加 token / wall-clock 记录（需要小量代码）

在 prepare-milestone 和 execute-milestone 的终端记录中增加：

```json
{
  "budget": {
    "prepareTokensSpent": 420000,
    "executeTokensSpent": null,
    "prepareWallClockMs": 2340000,
    "prepareRounds": 2,
    "codeInsertions": null
  }
}
```

这些数据**仅记录，不强制执行**。收集 20-30 个 milestone 的数据后，可以：

1. 计算每类任务的实际消耗分布（中位数、方差）
2. 识别异常消耗（超过 2σ 的任务）
3. 为 Phase 2 的预算强制执行提供校准依据

### 6.3 Phase 2：轻量 TokenBudget（数据驱动后）

在 Phase 1 数据的基础上，在 prepare-milestone 入口增加预算检查：

```
Proposal 阶段:
  mechanismCount = extractMechanismClaims(proposal)
  if mechanismCount <= 2:
    budget = lookupBaseline(mechanismCount, touchSetSize, class)
    task.extra.budget = budget

Prepare 阶段:
  _checkBudget() before each delta round:
    if actual.prepareTokensSpent > budget.maxPrepareTokens * 0.8: WARN
    if actual.prepareTokensSpent > budget.maxPrepareTokens: stop-needs-human (budget-exceeded)
    if actual.deltaRounds > 2 and actual.prepareTokensSpent > budget.maxPrepareTokens * 0.5:
      stop-needs-human (diminishing-returns)
```

关键设计决策：

1. **预算仅对 ≤2 机制的任务强制执行。** ≥3 机制的任务应拆分——不进入 prepare-milestone 就无需预算。
2. **预算从历史数据中查询，不是 LLM 估算。** 查表（"1 机制 + 6 touches + execution class → 中位数 350K tokens"）比 LLM 散文估算准确得多。
3. **超额是 needs-human，不是自动拆分。** 预算耗尽意味着此任务的资源消耗和产出不成比例——需要人判断是继续投入还是改变策略。

### 6.4 Phase 3：自举预算表（持续校准）

每次 milestone Land 后，将实际消耗写入：

```
milestones/prepare-telemetry/<taskId>/budget-<recordId>.json
```

一个离线脚本（`scripts/budget-calibrate.ts`）定期读取全部记录，更新基准表：

```typescript
// 伪代码
function calibrateBaselines(records) {
  const byMechanismCount = groupBy(records, r => r.mechanismCount);
  for (const [count, recs] of byMechanismCount) {
    const tokens = recs.map(r => r.prepareTokensSpent);
    baselines.set(count, {
      median: percentile(tokens, 0.5),
      p75: percentile(tokens, 0.75),
      p90: percentile(tokens, 0.90),
      count: recs.length,
      lastUpdated: Date.now(),
    });
  }
  return baselines;
}
```

基准表写入版本化文件（`ground-truth-registry.json` 的自然扩展），供 prepare-milestone 查询。

---

## 7. 自举的两个层次

### 7.1 第一层：数据自举

用已完成任务的实际消耗数据，校准未来任务的预算估算。这是 Phase 2 和 Phase 3 做的事情。DIR-126 的 5 个子任务已经提供了 5 个数据点。

### 7.2 第二层：机制自举（更深层）

元机制（预算、拆分判断、epoch 管理）本身也是 quay 任务——它们也应该受同一个预算约束。

例如：如果"修复 `extractMechanismClaims` 校准"被评估为 1 机制、预计 300 行代码、200K tokens，而实际消耗了 800K tokens——那么预算系统本身的估算也需要校准。

**这是一个自指循环（strange loop）：** 管理预算的机制，其自身的开发也受预算管理。

自指循环的危险在于无限递归——元元机制管理元机制，元元元机制管理元元机制……所以必须有**终止条件**：

- **元机制最多两层**：对象机制 → 元机制（预算） → 元元机制（固定规则，不可修改）
- **元元机制是纯数据**：基准表由一个确定性脚本从历史数据中计算，不经过 LLM。它没有"开发"过程——它只是运行。
- **如果元元机制不够用**：数据不足以校准估算 → 退化到默认值 → 记录退化事件 → 人工介入。

---

## 8. 与现有 exp6 proposal 的关系

exp6 proposal 的队列驱动模型天然支持预算约束：

- **队列调度器**可以在 dispatch 前检查预算可用性
- **资源模型**（llm/shell/git/worktree 槽位）本身就是一个算力预算系统
- **每任务独立状态机**允许任务在自己的资源边界内运行，不阻塞其他任务

建议在 exp6 的 §3.4（资源感知调度）中增加 `tokenBudget` 资源类型，在 §5.1（dispatch-router）中增加预算检查。预算数据来自 Phase 1 的记录累积。

---

## 9. 总结

| 层次 | 做什么 | 什么时候 | 复杂度 |
|---|---|---|---|
| **Phase 0** | 利用已有的 6 个机制（拆分阈值、delta cap、epoch cap、scope grant、递归守卫、touches 上限）作为预算约束 | 现在——已实现 | 0 行新代码 |
| **Phase 1** | 记录 token/wall-clock 消耗 | 下一个改 prepare/execute-milestone 的任务 | ~50 行 |
| **Phase 2** | 轻量 TokenBudget：≤2 机制任务强制预算上限 | 收集 20+ 数据点后 | ~200 行 |
| **Phase 3** | 自举基准表：从历史数据自动校准 | Phase 2 运行 50+ milestone 后 | ~150 行 |

**核心原则：**

1. **元机制比对象机制简单一个数量级。** 如果预算系统比 prepare-milestone 还复杂，它自己就成了问题。
2. **退化优于膨胀。** 数据不足时用默认值，不要为了 10% 的准确率提升加 100% 的复杂度。
3. **自指循环必须在第二层终止。** 预算系统的校准是纯数据驱动（确定性脚本），不是 LLM 驱动——不需要"管理预算系统的预算系统"。
4. **Phase 0 已经覆盖了 80% 的问题。** 8 月 1 日的过度拆分如果能正确使用已有的 6 个约束机制，大部分都可以避免——不需要新代码，只需要正确地使用已有机制。
