---
id: gap-routine-architecture-analysis-god-package-serve-view
title: "architecture-analysis: fanIn 564 / fanOut 222 across 7 files / 118
  entities — highest fan-in hub in the core; every feature surface converges on
  one view module"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
fanIn 564 / fanOut 222 across 7 files / 118 entities — highest fan-in hub in the core; every feature surface converges on one view module

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793401956536` · ts `2026-10-30T23:12:36.536Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`handleDashboard`、`buildDashboardSnapshot`、`handleDashboardCards`
- 涉及文件：
- `packages/quay/src/serve/view/serve-dashboard.ts:1737`
- `packages/quay/src/serve/view/serve-dashboard.ts:1645`
- `packages/quay/src/serve/view/serve-dashboard.ts:1803`
- kind：`god-package`
- verdict：`CONFIRMED`

## Requested action
split view into per-domain render modules behind a thin router; move dashboard snapshot/card rendering out of one 1800+ line file

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T23:12:36.536Z

## Disposition

复核时间 2026-10-31，worktree `gap-routine-architecture-analysis-god-package-serve-view` @ develop `f978d3857`。

### 1. 读数复核：finding 逐字命中；fanIn=563 是真读数，但它是 leaf 包的结构恒等，不是缺陷轴

| 量 | finding | 本次实测 | 来源 |
|---|---|---|---|
| serve/view fanIn | 564 | 563 | `.archguard/metrics-history.jsonl` 最新 `serve/view` 行（scope `packages/quay/src`） |
| serve/view fanOut | 222 | 222 | 同上 |
| entityCount / cycleCount | 118 / — | 118 / 0 | 同上 |
| 观测符号 | handleDashboard / buildDashboardSnapshot / handleDashboardCards | 同 | `serve-dashboard.ts:1737 / 1645 / 1803` |

`serve/view` 是核心 scope（`packages/quay/src`）里 fanIn 最高（563，次高 `core`=222 / `observation.ts`=216）、
fanOut 也最高（222，次高 `observation.ts`=190）的包——finding 的「highest fan-in hub in the core」在**产品核心
scope** 内成立（plugin scope 有更高的 `gate-script-base.ts` fanIn=734，说明 fanIn 是 scope 相对的读数）。

但 fanIn 判的是「被多少实体 import」；`serve/view` 是前序任务
`gap-routine-architecture-analysis-god-package-serve-fanout-556`（status: done，2026-10-26）**刻意切出的展示层
叶子包**（i18n / lang / render / dashboard / binding / live-format / fan-in-cell）。叶子的职责就是被每个页面
handler（`serve/feat`、`serve/pages`）与 CLI（`cli/lanes.ts`）import——高 fanIn 是「共享展示原语确实被共享」的
证据（单一真相源想要的形态），不是集中度缺陷。前序任务的 AC 判的是 **fanOut < 300**（不是 fanIn），正是这个
原因。

### 2. 包的真正形态：三个 >1300 行的文件，不是「一个 1800+ 行文件」

finding 的三个符号都落在 `serve-dashboard.ts`，但 `serve/view` 的真实结构是三个大文件：

| 文件 | 行数 |
|---|---|
| `serve-i18n.ts` | 2780 |
| `serve-dashboard.ts` | 1863 |
| `serve-render.ts` | 1310 |

requested action 的「move dashboard snapshot/card rendering out of one 1800+ line file」是浅探针对三个符号
采样后的**局部结论**：只拆 `serve-dashboard.ts` 会留下 `serve-i18n.ts`（2780 行，更大的 god-module）与
`serve-render.ts`（1310 行）原地不动，且**不移动 fanIn 读数**（拆成同包 sibling 文件后，外部 import 仍指向同样
的导出实体，fanIn 仍 ≈563）。三个文件要一起拆才改变包的 god 形态。

### 3. 已有机制在管哪一部分、失败在哪一步

| 机制 | 管什么 | 失败在哪一步 |
|---|---|---|
| 前序任务 `serve-fanout-556` 的 AC | `serve/` fanOut < 300（拆 6 子包） | 已满足：`serve/view` fanOut=222 < 300（该任务记录 view=225）。**不管 fanIn**（leaf 包的 fanIn 不是缺陷轴），也不管子包内的 module 级 god-file |
| `directory-cycle.test.mjs`（AC-916） | 目录级 SCC=0（拆分子包不得造环） | 本轮实测目录环 0。**无 module 级 god-file 维度** |
| `import-graph-check.ts` | value/type SCC、层间越界、kernel/gate-layer 边界 | 本轮实测 valueSccs=0 / typeSccs=0 / reverseEdges=0 全绿。无 domain / god-module 维度 |
| `archguard-runner.ts` | 每轮记 maxInDegree / maxOutDegree | 只记录不判定（`:20`「留待数据积累」，未设阈） |

### 4. 处置结论

- 复核结论：finding 成立且未过期，但**本任务不修布局**——与同轮 sibling
  `gap-routine-architecture-analysis-god-package-plugin-scripts` 相同的承重约束：`serve-dashboard.ts`
  自带 **8 个源码级 pin 测试文件**（`readFileSync(SERVE_DASHBOARD_SRC)` grep 函数体 / 常量 / 负断言），拆一个
  文件就要同步重锚那一组测试；三个大文件要一起拆才改变包的 god 形态 ⇒ 这是一件**多任务程序**，不是一个单任务
  增量（同 sibling 对 `plugin/scripts` megascript 的结论）。
- 本 finding 的新价值 = 复发证据：`serve/view` 是前序 `serve-fanout-556` 拆分后的**残余 god-package**，且本轮
  三个符号采样恰好都落在 `serve-dashboard.ts`，把「package 级 fanIn 读数 + 文件级拆分」这个错配暴露为真实残余。
- 可执行下一个增量（本任务不执行，顺序不可交换）：`serve/view` 的**包级拆分**——把三个大文件的 per-domain
  renderer 各自下沉（i18n 字典与渲染分离；dashboard 的 card renderer 拆 per-domain 模块；render 的 page chrome
  拆片），并同步重锚各自的源码级 pin 测试。建议先拆 `serve-i18n.ts`（最大、纯字典+渲染、无 source-grep 测试、
  风险最低），再拆 `serve-dashboard.ts`（重锚 8 个测试），最后 `serve-render.ts`。
- 复发预期：本处置**不满足** `concept_recurs_after_merge=false`——在包级拆分落地前同一 subject 可能再被立案，
  由 routine-file-gate 的 rate 闸兜底（同 sibling 的 dedup-键漂移结论）。

### 5. 复核命令（可重跑）

```bash
node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
wc -l packages/quay/src/serve/view/serve-i18n.ts packages/quay/src/serve/view/serve-dashboard.ts packages/quay/src/serve/view/serve-render.ts
grep -h '"name":"serve/view"' .archguard/metrics-history.jsonl | tail -1
git -C /data/home/yale/work/quay log --oneline -1 -- tasks/gap-routine-architecture-analysis-god-package-serve-fanout-556.md
```

### 6. L_G 读数（ADR-007）

- L_G archguard: entityCount=118 fanIn=563 fanOut=222 cycleCount=0
- L_G import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-serve-view`（routine `architecture-analysis`，runId `architecture-analysis-1793401956536`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/view/serve-dashboard.ts`
- `tasks/gap-routine-architecture-analysis-god-package-serve-view.md`