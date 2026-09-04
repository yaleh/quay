---
id: gap-dispatch-value-has-no-consolidation-axis
title: 派发价值函数的三条功绩轴（strategic/blocking/suite-blocking）没有一条代表「减法/收敛」——删掉 119
  个重复实现的任务与新增 120 个文件同等计费，只能靠正文碰巧写了 SPEC 才拿得到权重
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/ready-pool-check.ts:1176`（定义注释在 `:599`）：

```
value = strategic*STRATEGIC_WEIGHT(4) + blocking*BLOCKING_WEIGHT(2)
      + suiteBlocking*SUITE_BLOCKING_WEIGHT(2) + costBenefit
costBenefit = min(1, 1/cost)        // cost = Touches 宽度（touchesScale）
```

三条功绩轴分别是：`strategic`（`STRATEGIC_REF_RE = /\b(?:SPEC|FINDING|SYNTHESIS)\b|REVIEW-cadence/`
对任务体正文做匹配，`:612/:1147`）、`blocking`（parent/children + `depends_on` 反向边）、
`suiteBlocking`（套件红窗）。

**缺的是第四条：没有任何一条轴代表「这个任务消灭了 N 个重复实现 / 删除了 M 行死代码」。**
一个收敛任务（例：把 120 个 checker 收敛成 1 个模板 + 120 个变体钩子，净删除 119 份手写实现）拿到的是：
strategic N（除非它正文里碰巧出现 SPEC/FINDING/SYNTHESIS）、blocking N、suite-blocking N、
costBenefit = 1/120 = **0.008**；而一个新增守卫的窄任务（3 个 Touches）拿 **0.333**。
**同为非战略任务时，减法工作的派发优先级比加法工作低 40 倍，而缺陷流在持续补充窄任务 ⇒ 宽的收敛
任务在队列里被结构性饿死。**

**现场实测（2026-09-04，本次立案时）**：
- 已 done 任务的 Touches 宽度：中位 **5**、p90 **10**、p99 **23**；触及 >50 文件的
  **2 / 1269 = 0.16%**；
- `plugin/scripts/*-check.{ts,sh}` 全历史新建 **185** 个、删除 **13** 个（**14:1**）；
- 当时池中候选（2 条）三轴全 N、value 全 = 1/cost。

**⚠️ 与既有 done 任务的关系（必须写清，避免被读成「旧修复失效了」）**：
`gap-value-priority-signal-degraded-to-1-over-cost`（done 2026-08-13）修的是**另一个缺陷**——当时三轴
在全体候选上**结构性恒 N**（`STRATEGIC_REF_RE` 正则过窄漏掉 `SPEC §11` 这种写法；blocking 轴不读
`depends_on` 反向边），导致 value 恒等于 1/cost。那次修复是有效的：轴现在**能**取 Y，且
`STRATEGIC_WEIGHT=4` 完全压过 `costBenefit ≤ 1`，所以逃生舱确实存在。**本任务不主张那次修复失败**，
而是：**轴的集合里没有一条对应"结构性收敛"这类功绩**，收敛任务只能靠"正文里碰巧提到 SPEC"来获得
权重——那是措辞，不是功绩。

**相邻观察（本任务不修，记录以便单独处置）**：`STRATEGIC_REF_RE` 是对正文散文做**裸关键词匹配**，
按本仓库自己的硬规则 2（按位置判定、不按关键词）这正是被禁止的形态——任何任务只要在正文里写一个
`SPEC` 就能拿到权重 4。这与本任务是**两个不同机制**（一个是"轴不可信"，一个是"缺一条轴"），不合并。

**修法方向**：新增一条 `consolidation` 轴，且其取值**必须来自可机械核验的声明，而不是正文措辞**——
候选做法：任务显式声明 `extra.consolidates: N`（N = 它收敛掉的重复实现数），并在落地后用真实 diff
（净删除的实现点数）反向核验；**不得**用"正文里出现『收敛/统一/重构』"这类关键词判定（否则重蹈
`STRATEGIC_REF_RE` 的覆辙）。权重大小**不得凭空设定**（硬规则 4：成本结构未知前不设数值阈值）——
须由 AC4 的实测排序对照来标定。

## AC

- [x] AC1（基线）：跑 `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --cap 5
      --top 40 --json`，贴出当前池的三轴取值分布与 value 序列；并构造/选取一个真实的宽收敛候选
      （如 checker 族收敛），记录它在改动前的 value 与排位
- [x] AC2：新增 `consolidation` 轴，取值来源是**可机械核验的声明**（如 `extra.consolidates: N`），
      在任务体里写明选择了哪个来源、以及为什么它**不能**仅靠正文措辞满足
- [x] AC3（负控制，防止重蹈 STRATEGIC_REF_RE 覆辙）：一个只在**正文里声称**自己在收敛、但没有那份
      机械声明的任务，**不得**获得该轴权重——贴出两个任务（一个有声明、一个只有措辞）的真实读数对照
- [x] AC4（标定，不是凭空设权重）：加轴后重跑 AC1 的同一命令，宽收敛候选的排位须高于同池的窄守卫
      新增任务；贴出改动前/后的 `--top N` 真实排序对照，并记录据此选定权重值的依据
- [x] AC5（不回归）：`plugin/test/ready-pool-check.test.mjs` 全绿，且
      `gap-value-priority-signal-degraded-to-1-over-cost` 留下的回归判据（value 不退化成纯 1/cost）
      仍然成立——贴出该用例的通过输出

## DoD

AC1/AC4 的改动前后 `--top N` 真实输出、AC3 的正负两个任务读数对照，全部贴进任务体；全量
`bash scripts/test.sh` 绿。不是"加了个字段"就算——必须证明：①有机械声明的收敛任务排位真的上来了，
②只有措辞没有声明的任务拿不到权重（否则这条轴会立刻变成第二个可被措辞刷分的 `STRATEGIC_REF_RE`）。

## Evidence

### AC1 基线（改动前，真实 store）

`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --cap 5 --top 40 --json`（旧代码）：

```
top_relevance（todo，2 条，三轴全 N、value = 1/cost）：
  gap-archguard-p1-deletion-closure-checker               value=0.25  strategic=N blocking=N suite=N cost=4
  gap-archguard-p4-guard-lineage-declaration-and-registry value=0.25  strategic=N blocking=N suite=N cost=4

ready_relevance（ready，6 条）：
  gap-dispatch-value-has-no-consolidation-axis            value=4.333 strategic=Y cost=3   ← 本任务正文出现 SPEC ⇒ 措辞拿到权重（正是点名现象）
  gap-skill-start-drivers-webserver                       value=4.333 strategic=Y cost=3
  gap-archguard-p2-identity-replication-checker           value=2.25  blocking=Y cost=4
  gap-archguard-p5-instrument-decay-standing-guard        value=2.25  blocking=Y cost=4
  gap-no-cross-task-defect-shape-aggregation              value=0.25  cost=4
  gap-mirror-pair-drift-policy-plugin-scripts-experiments value=0.167 cost=6
```

宽收敛候选（构造）：temp workspace 里 `gap-wide-consolidate`（`extra.consolidates: 119`，120 个 Touches）
在旧代码下 value = 1/120 = **0.008**，排在 3-touch 窄守卫（0.333）之后 —— 见 AC4 的改动前/后对照。

### AC2 实现（选了哪个来源、为什么不能靠正文措辞）

来源 = **`extra.consolidates: N`**（frontmatter 字段）。`readConsolidates(task)` 读 `parseTask` 的
`extra` 投影 —— 与 `readDependsOn` 走同一个 `parseFrontmatterCompletely`（yaml）单解析器，不引入第二条
解析路径。轴取**二进制** `consolidating = (N > 0)`：N 的绝对值只进输出报告（供落地后 diff 反向核验
净删除实现点数），**不乘进 value** —— 否则 value 无界、且可被 `consolidates: 99999` 刷分。

**为什么不能仅靠正文措辞**：正文措辞判定是裸关键词匹配（硬规则 2 禁止的形态）——任何任务在正文写一个
「收敛/统一/重构」就能拿权重，会立刻变成第二个 `STRATEGIC_REF_RE`。`extra.consolidates` 是结构化字段，
派发计算按字段名取值，与正文散文无关。

### AC3 负控制（同一 cost，一个有声明、一个只有措辞）

`computeRelevance` 对照（两者 cost 相同 = 1 touch）：

```
DECLARED    value 2 · strategic N · blocking N · suite-blocking N · consolidating Y(119) · cost 1 touch
PROSE-ONLY  value 1 · strategic N · blocking N · suite-blocking N · consolidating N      · cost 1 touch
```

只有 `extra.consolidates: 119` 声明的任务拿到轴权重（+1）；正文只写「we consolidate 119 duplicate checker
implementations」的任务拿不到。单元测试 `readConsolidates: … prose-only / absent / non-numeric read 0`
与 `computeRelevance: consolidation axis adds weight …; prose-only gets nothing` 钉死此对照。

### AC4 标定（改动前/后同池 `--top 5` 真实排序）

temp workspace，同池 2 条 todo：`gap-wide-consolidate`（`consolidates: 119`，120 touches）vs
`gap-narrow-guard`（3 touches）。`--top 5 --json`：

```
改动前（旧代码，无 consolidation 轴）：
  gap-narrow-guard     value=0.333  cost=3
  gap-wide-consolidate value=0.008  cost=120   ← 41× 落后，排最后

改动后（新代码，CONSOLIDATION_WEIGHT=1）：
  gap-wide-consolidate value=1.008  cost=120  consolidating=Y(119)   ← 反转到第一
  gap-narrow-guard     value=0.333  cost=3    consolidating=N
```

**权重值依据（不是凭空设定）**：`CONSOLIDATION_WEIGHT = 1`。
① 纯 cost 任务的 costBenefit 上界 = 1（最窄 1-touch = 1/1）；② 收敛任务再宽（costBenefit → 0）也要压过
最窄纯 cost 任务，须 `W + 0 > 1 ⇒ W ≥ 1`；③ W=1 是达成「consolidation 严格支配整条 cost 轴」的最小正整数
（W=0 是 no-op；0<W<1 的支配关系依赖具体窄守卫的 touches 数、换池即失效）；④ 并保持严格链
strategic(4) > blocking(2) > consolidation(1) > cost(≤1) —— 收敛只在非战略、非 blocking 类内重排，不挤占
「unblocks 下游」的优先级。AC4 实测：W=1 时宽收敛候选 1.008 > 窄守卫 0.333，与改动前 0.008 排最后形成反转。

### AC5 不回归

`bash scripts/test.sh plugin/test/ready-pool-check.test.mjs` → **138 pass / 0 fail**。含
`gap-value-priority-signal-degraded-to-1-over-cost` 的回归判据（value 不退化成纯 1/cost）：

```
✔ value-degradation AC1: strategic axis取数 bug — `SPEC §11`-style reference reads strategic Y
✔ value-degradation AC1: blocking axis取数 gap — a task others depends_on is blocking
✔ value-degradation AC2/AC3: a large-touches strategic task floats above a small plain task
✔ computeRelevance: strategic grep, blocking, cost scale, composite value (AC1/AC3)
```

（strategic 大任务 value = STRATEGIC_WEIGHT + 1/9 仍压过 plain 小任务 value = 1 —— 三轴仍能取 Y、未退化。）

## Touches

- plugin/scripts/ready-pool-check.ts（value 函数与新增轴）
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-dispatch-value-has-no-consolidation-axis.md
