---
id: gap-planner-admission-widen-beyond-package-cycle
title: Planner 立案准入只认 package-cycle——把准入从单常量扩成 concern-kind 注册表，先承认
  「设计演进读数回归」（已机械化），主干无扩展点 / god-file 体量留作注册位（其探测器未落地）
status: todo
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

**事实一（根因，代码）**：`docs/analysis/ownership-active-limited-proposal.mjs:39` 写死
`CONCERN_KIND_IN_SCOPE = "package-cycle"`，理由（`:26` 注释）是「the only kind with a computable, falsifiable
delta」。`evaluateEntryBar` 的 `C1_concern_kind` 条件对任何非 package-cycle 的 `concern_kind` 返回
`CONDITION_1_NOT_MET`。这就是 DIR-133 F1 点名的「自动化 Planner 准入条件 1 写死为 package-cycle」。

**事实二（已机械化的信号只有一类，其余两类探测器未落地）**：
- `design-evolution-readings` 回归：**已机械化**——`gap-design-evolution-readings-emit-findings`（done）
  已让读数例程在相对回归/连续未评估时产出 finding，走 `routine-file-gate` 立案；载体
  `.quay/design-evolution-history.jsonl` 有双口径读数。
- 主干无扩展点：探测器未落地——`gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point`
  （ready）落地后才有一个可判定的「主干步骤注册」信号。
- god-file 体量：**无探测器，且事件定义未定**——一个「god file」是静态状态不是事件，直接设行数阈值
  违反硬规则 4 推论（成本结构未测前不设数值阈值）。

**事实三（为什么不能只把字符串从 1 个换成 4 个）**：§6(a) 的原始约束是「只有带可计算、可取假 delta
的种类才准入」。每一种新信号都必须自备三件：①机械探测器；②可计算、可取假的 delta（像 package-cycle
的 slice-delta 那样）；③负对照（把回归修掉，信号必须熄灭）。缺 ②③ 的信号只把字符串换宽，是「把散文
规则变长」，不是把驱动能力变强（ADR-004）。

**事实四（元机制层现状，2026-10-22 实测，本任务立项依据）**：discovery 层真实驱动了 11/26 个
portfolio finding 落地（semantic-dedup-scan 家族），但 Planner 层（ownership-active limited proposal）
至今只有 94 条 shadow proposal，**全部是对 GOAL-030/031/032 的历史回放**，0 条 live 设计立项。证明
「发现→立案」通了，但「设计质量→驱动设计演进」这一环是空的。这正是 DIR-133 F1 说的驱动能力不足。

## Plan

1. **准入注册表**：把 `CONCERN_KIND_IN_SCOPE` 从单常量改成
   `CONCERN_KIND_REGISTRY: { kind, detector, deltaComputable, negativeControl, occurrenceThreshold, mechanized }[]`；
   `C1` 条件改为「`concern_kind` 在注册表里且 `mechanized:true`」，未在表里 ⇒ 仍然
   `CONCERN_1_NOT_MET`，在表里但 `mechanized:false` ⇒ 新的独立态 `CONCERN_1_NOT_YET_MECHANIZED`（硬规则
   3b：与「不合格」同形是伪装）。
2. **先承认已机械化的那一个**：注册 `design-evolution-regression`，`mechanized:true`，detector =
   design-evolution-readings 的 finding 产出，delta = 同一 baseline 窗口的 `additionsShare`（或净口径，
   二选一并写死在条目里）回归，负对照 = 把回归窗口回滚/修复后信号熄灭，`occurrenceThreshold = 2`
   （DIR-133 裁定 1）。
3. **两个注册位，不虚报**：注册 `spine-without-extension-point`（detector → 指向
   `gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point`）与 `god-file-size`
   （detector → 待立，事件定义未定），两者 `mechanized:false`；准入条件对它们返回 NOT_YET_MECHANIZED，
   直到各自探测器落地并把「事件」与「可取假 delta」写进条目。
4. **god-file 事件定义不在本任务里拍板**：行数阈值是硬规则 4 推论的禁区，本任务只立注册位，事件定义
   留给探测器任务，且探测器任务必须先做「发生什么算一次」的定义与历史发生率读数，再谈阈值。
5. **测试**：对 registry 的每种态（in-scope / not-in-scope / not-yet-mechanized / kind-unreadable）写
   fixture，四态输出必须逐字段可分。
6. **不动 `ownership-active-replay.md` §6 的原文**：它是本实现引用的历史契约；扩准入是新的「amend
   2026-10-22」段落，不是改写原文。

## Acceptance Criteria

- [ ] AC1 注册表落地：`grep -n 'CONCERN_KIND_REGISTRY' docs/analysis/ownership-active-limited-proposal.mjs` ≥1 行，且该结构含 `detector / deltaComputable / negativeControl / occurrenceThreshold / mechanized` 五键；贴这行与结构定义。
- [ ] AC2 三种 `concern_kind` 各报各的态：fixture 分别喂 `package-cycle`（in-scope）、`design-evolution-regression`（in-scope，mechanized:true）、`spine-without-extension-point` 与 `god-file-size`（NOT_YET_MECHANIZED）、`other-boundary`（NOT_MET）、无 `concern_kind` 字段（UNDETERMINED），断言五个输出值两两不同；贴测试文件与断言。
- [ ] AC3 阈值读自注册表：`occurrenceThreshold` 字段在判定里被真实读取（不是写死的 2 字面量——`grep -n 'occurrenceThreshold' docs/analysis/ownership-active-limited-proposal.mjs` 的命中处是消费而非仅声明），且 package-cycle 与 design-evolution-regression 条目各写 2；贴命中行。
- [ ] AC4 负对照（设计回归信号可取假）：用 fixture 构造「同一 baseline 窗口 share 上升」与「修复后 share 回落」两个记录，断言 delta 判据前者命中、后者熄灭；贴 fixture 与两次断言输出。
- [ ] AC5 未机械化不伪装：`spine-without-extension-point` / `god-file-size` 在 `mechanized:false` 时，`evaluateEntryBar` 返回 `NOT_YET_MECHANIZED` 而非 `NOT_MET` 或 `ELIGIBLE`；贴断言。
- [ ] AC6 历史回放不受影响：跑既有 `ownership-active-limited-proposal.test.mjs` 与 `ownership-active-loop.test.mjs`，全绿；贴 `node --test` 输出尾部。
- [ ] AC7 文档指针：`docs/analysis/ownership-active-limited-proposal.mjs` 头部注释或 `ownership-active-replay.md` 加一段「amend 2026-10-22：准入从单常量扩成注册表」，并写明两个 NOT_YET_MECHANIZED 条目各自指向的探测器任务；贴该段原文。

## Definition of Done

- `evaluateEntryBar` 对新注册的 `design-evolution-regression` 能在一条**真实生产** finding 上判
  `ELIGIBLE`（不是只在 fixture 上），或如实记录「尚无一条生产 finding 通过（原因）」，不虚报。
- registry 的五键齐全，四态输出互斥；两个未机械化条目被机制挡住、报 NOT_YET_MECHANIZED 而不是悄悄放行。
- 不改写 `ownership-active-replay.md` §6 原文；扩充以 dated amend 段落呈现。

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs
- docs/analysis/ownership-active-replay.md
- plugin/test/ownership-active-limited-proposal.test.mjs
- tasks/gap-planner-admission-widen-beyond-package-cycle.md
