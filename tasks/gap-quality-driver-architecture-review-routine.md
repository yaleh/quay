---
id: gap-quality-driver-architecture-review-routine
title: quality driver 新增第三例程：架构复核（B15 混合形态——P1/P2/P4 机械聚类 → LLM judge → JS
  聚合，产出读数非任务终态）
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`docs/proposals/archguard-generation-era-primitives.md` §3 定义了五个直接量测度（P1 Deletion
Closure / P2 Identity Replication / P3 Artifact Liveness / P4 Guard Lineage / P5 Instrument
Decay）。实测（本轮会话，2026-09-05）：其中 P1/P2/P4/P5 已各自有独立检测器落地
（`deletion-closure-check.ts` / `identity-replication-check.ts` / `guard-lineage-check.ts` /
`instrument-decay-check.ts`），但**除 P5 外全部零周期调用**：

```
grep -rl "deletion-closure-check"    → 只被 guard-lineage-check.ts / capability-catalog.sh 引用（互相/注册，非调度）
grep -rl "identity-replication-check" → 同上（guard-lineage-check.ts / deletion-closure-check.ts / capability-catalog.sh）
grep -rl "guard-lineage-check"        → 只被 capability-catalog.sh 引用
grep -rl "instrument-decay-check"     → 唯一例外：plugin/scripts/runner-static-gate.ts:704
                                          （--no-block，挂在 scripts/test.sh 每次跑的静态检查层，纯观测）
```

⇒ P1/P2/P4 三个检测器建成之后**从未被任何 cadence/driver/suite 触发过一次**，只作为彼此的
library 依赖存在。P3（Artifact Liveness）连脚本都不存在。这正是本轮会话讨论"该不该新建一个
driver 来推进架构改进"时定位到的缺口——**不缺传感器，缺的是把传感器接上一个会转的轮子**。

**已在本次会话讨论中确定、不再复议的方向**：
- 不新建 driver kind。`quality`（`driver-runtime.ts` 的 `DriverKind` 之一）已是 Layer 0 +
  Layer 1b routine 契约的例程型 driver，其自述判据（`quality-gate-driver.ts` 头注释）"单元是
  【例程】不是【任务】，产出是【读数】不是【任务终态】"与架构复核的形状精确匹配。
- 复用 B15（`pool-quality-judge`，ADR-033）已验证过的"机械触发 → schema'd LLM judge → JS 算术
  聚合"模式——不重新发明一套语义判断机制。

本任务：给 `quality-gate-driver.ts` 加第三条 `RoutineSpec`：架构复核。

## Plan

1. **机械聚类（复用既有脚本，不重新实现三个检测器本身）**：新写一个纯函数，读取
   `identity-replication-check.ts` / `deletion-closure-check.ts` / `guard-lineage-check.ts`
   三者现有的 `--json` 输出，聚合成统一的"候选簇"结构（每簇：涉及文件集 + 来源 primitive
   + 原始计数）。P3（Artifact Liveness）无现成脚本 ⇒ 本任务不实现它，只在聚合结构里留一个
   来源占位注释（P1/P2/P4 三个已有来源，P3 尚缺）——**不为凑够"五个 P"而现造一个空转实现**。
2. **触发条件**：镜像 B15 已验证的机械触发形态（pool-quality-judge 的 pool>25 / >48h /
   每 10 轮三态触发），具体阈值从三个检测器的历史读数量级推导，不凭空写字面量（硬规则 4
   推论：成本结构未知前不设数值阈值；硬规则 12：新前置需给发生率）。
3. **语义判断**：每簇一个 schema agent（复用 `pool-quality-judge.ts` 已有的 spawn/profile
   机制，不重新发明一套 spawn 逻辑），判"这簇值得抽象/合并"还是"巧合式相似、维持现状"，
   schema 输出含 `verdict` + `reasoning` + `suggestedAction`（结构化，非自由文本）。
4. **JS 聚合 + 落盘**：写入新载体 `.quay/architecture-review-round.jsonl`（每轮一条，含逐簇
   `{clusterId, primitive, files, verdict, reasoning, judgedAt, round}` ≥5 键；判词为空不写
   空记录），三态可区分（未触发 / judge 解析失败 / 判过有结果）——同
   `gap-pool-quality-verdicts-never-persisted` 已验证过的三态模式。
5. `.gitignore` 补该文件（同 quality-driver 其余运行时态文件的先例）。
6. **明确排除**（本任务边界，不做也不预设结论）：不 auto-file 任务、不改任何任务 status——
   谁来把"建议"转成任务是另一条任务的范围。

## Acceptance Criteria

- [x] AC1（机械聚类可复现）：给定三个检测器的固定 `--json` 输出样本，聚合函数产出确定的簇
  列表——单测覆盖，非人工目测。
- [x] AC2（语义判断非伪装机械，同 `gap-ac144` AC2 先例）：每簇的 `verdict` 来自一次真实
  `claude -p` schema agent 调用（grep 到 spawn 调用与 schema 定义）；⛔ 若 `verdict` 由纯
  JS if/else 规则产生而非 LLM 判断 ⇒ 假。
- [x] AC3（三态可区分，硬规则 3b）：`.quay/architecture-review-round.jsonl` 的记录里
  "未触发 / judge 解析失败 / 判过有结果"三者取值不同，不与"合格"同形。
- [x] AC4（边界硬约束）：实现后 `grep` 确认该路径零 `status:` 写入、零 `task_write` 调用——
  本任务只产出读数，不 auto-file、不改任务终态。
- [ ] AC5（真实生产载体，硬规则 4 推论三，判据读生产不读测试）：实现落地**之后**，quality driver 在**主检出**（非任务 worktree 内的一次性验证）实际跑出 ≥1 条含真实簇判词的记录，`judgedAt` 晚于本任务实现落地时刻——贴出该记录的实际内容，不是"应该会产生"的推断。**⛔ 生产载体未产出前不勾本条（硬规则 4 推论三，同 gap-ac144 AC3 先例）**（待外部）
- [x] AC6（负控制）：关闭本例程的调度开关后重跑一轮，载体不增长；重新开启后增长——两次
  读数都贴出。
- [ ] AC7（既有不回归）：`--for-task` scoped 门 + 全量 suite 绿（fan-in 驱动跑，未产出前不勾）；`quality-gate-driver.ts` 既有两条 RoutineSpec（B15/B17）行为不变，既有单测已实测 23/23 绿（待外部）

## Definition of Done

`quality-gate-driver.ts` 新增的第三条 RoutineSpec 在**主检出的真实 quality driver 进程**里跑
出至少一条含真实候选簇 + 真实 LLM 判词的 `.quay/architecture-review-round.jsonl` 记录
（`judgedAt` 晚于本任务落地时刻，非 fixture、非注入、非任务 worktree 内的一次性验证）；
AC1-AC7 全勾；scoped 门 + 全量 suite 绿；改动经 fan-in 落到 develop 并可 `git show develop:`
核验。**本任务不做**：auto-file 任务、改变任何任务 status、实现 P3、设计"谁消费该读数并转成
任务"的流程——这些各自是独立的后续任务，本任务不预设结论。

## Touches

- plugin/scripts/quality-gate-driver.ts（新增第三条 RoutineSpec：架构复核例程）
- plugin/scripts/architecture-review-cluster.ts（新增：机械聚类纯函数，聚合 P1/P2/P4 三个检测器的 `--json` 输出）
- plugin/test/architecture-review-cluster.test.mjs（新增：聚类纯函数单测）
- plugin/test/quality-gate-driver.test.mjs（新增：第三条 RoutineSpec 的载体写入 + 三态 + AC6 负控制断言）
- .gitignore（architecture-review-round.jsonl 运行时态 gitignore）
- plugin/scripts/capability-catalog.sh（新脚本 architecture-review-cluster.ts 注册进对应表）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts= 计数 +1，同 `gap-ac144` 先例）
- tasks/gap-quality-driver-architecture-review-routine.md（自身）
