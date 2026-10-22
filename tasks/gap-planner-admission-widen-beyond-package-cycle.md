---
id: gap-planner-admission-widen-beyond-package-cycle
title: Planner 立案准入只认 package-cycle——把准入从单常量扩成 concern-kind 注册表，先承认
  「设计演进读数回归」（已机械化），主干无扩展点 / god-file 体量留作注册位（其探测器未落地）
status: done
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

- [x] AC1 注册表落地：`grep -n 'CONCERN_KIND_REGISTRY' docs/analysis/ownership-active-limited-proposal.mjs` ≥1 行，且该结构含 `detector / deltaComputable / negativeControl / occurrenceThreshold / mechanized` 五键；贴这行与结构定义。
- [x] AC2 三种 `concern_kind` 各报各的态：fixture 分别喂 `package-cycle`（in-scope）、`design-evolution-regression`（in-scope，mechanized:true）、`spine-without-extension-point` 与 `god-file-size`（NOT_YET_MECHANIZED）、`other-boundary`（NOT_MET）、无 `concern_kind` 字段（UNDETERMINED），断言五个输出值两两不同；贴测试文件与断言。
- [x] AC3 阈值读自注册表：`occurrenceThreshold` 字段在判定里被真实读取（不是写死的 2 字面量——`grep -n 'occurrenceThreshold' docs/analysis/ownership-active-limited-proposal.mjs` 的命中处是消费而非仅声明），且 package-cycle 与 design-evolution-regression 条目各写 2；贴命中行。
- [x] AC4 负对照（设计回归信号可取假）：用 fixture 构造「同一 baseline 窗口 share 上升」与「修复后 share 回落」两个记录，断言 delta 判据前者命中、后者熄灭；贴 fixture 与两次断言输出。
- [x] AC5 未机械化不伪装：`spine-without-extension-point` / `god-file-size` 在 `mechanized:false` 时，`evaluateEntryBar` 返回 `NOT_YET_MECHANIZED` 而非 `NOT_MET` 或 `ELIGIBLE`；贴断言。
- [x] AC6 历史回放不受影响：跑既有 `ownership-active-limited-proposal.test.mjs` 与 `ownership-active-loop.test.mjs`，全绿；贴 `node --test` 输出尾部。
- [x] AC7 文档指针：`docs/analysis/ownership-active-limited-proposal.mjs` 头部注释或 `ownership-active-replay.md` 加一段「amend 2026-10-22：准入从单常量扩成注册表」，并写明两个 NOT_YET_MECHANIZED 条目各自指向的探测器任务；贴该段原文。

## Definition of Done

- [x] `evaluateEntryBar` 对新注册的 `design-evolution-regression` 能在一条**真实生产** finding 上判
  `ELIGIBLE`（不是只在 fixture 上），或如实记录「尚无一条生产 finding 通过（原因）」，不虚报。
- [x] registry 的五键齐全，四态输出互斥；两个未机械化条目被机制挡住、报 NOT_YET_MECHANIZED 而不是悄悄放行。
- [x] 不改写 `ownership-active-replay.md` §6 原文；扩充以 dated amend 段落呈现。

## Evidence（2026-10-22 worker 实跑）

worktree `/home/yale/work/quay-worktrees/gap-planner-admission-widen-beyond-package-cycle`，提交 `a97d29c13`。
实现 = `docs/analysis/ownership-active-limited-proposal.mjs`；判据 =
`plugin/test/ownership-active-limited-proposal.test.mjs`（32 条：25 条既有 + 7 条新增，全绿）；文档 =
`docs/analysis/ownership-active-replay.md` §8。

### AC1 — 注册表落地

`grep -n 'CONCERN_KIND_REGISTRY' docs/analysis/ownership-active-limited-proposal.mjs` 的声明行：

    331:export const CONCERN_KIND_REGISTRY = Object.freeze([

（消费点另见 `:383` `concernKindEntry`、`:394` `concernKindState`、`:449` 判定入口、`:463`/`:468` C1 两态、
`:478` 入口畸形、`:533` C4）。条目结构（四条 entry 同构，`:331-380`）：

    {
      kind: CONCERN_KIND_IN_SCOPE,
      detector: "ArchGuard slice-delta (installed CLI, computed) — ownership-active-loop.mjs computeSliceDelta + .quay/ownership-shadow-proposals.jsonl",
      deltaComputable: true,
      negativeControl: true,
      negativeControlDetail: "the slice's restore_edges make the primitive report falsified=true; …",
      occurrenceThreshold: 2,
      mechanized: true,
      deltaCaliber: "ArchGuard slice-delta: before/after SCC members + removed_edges",
      readDelta: deltaEvidence,
      fingerprintOf: (rec) => deltaFingerprint(rec?.slice_delta?.delta),
    }

断言：`AC1(registry): CONCERN_KIND_REGISTRY is exported, and every entry carries the five pinned keys` —
逐条检查五键存在、`detector` 是 >10 字符的串、三个布尔是真布尔、两条 mechanized =
`["design-evolution-regression", "package-cycle"]`、两条 `occurrenceThreshold === 2`。

### AC2 — 每种 kind 各报各的态（两两不同）

`concernKindState()` 的实跑输出（`state:kind` token，六条两两不同）：

    package-cycle                 => in-scope:package-cycle
    design-evolution-regression   => in-scope:design-evolution-regression
    spine-without-extension-point => not-yet-mechanized:spine-without-extension-point
    god-file-size                 => not-yet-mechanized:god-file-size
    other-boundary                => not-in-scope:other-boundary
    （无 concern_kind 字段）        => undetermined:unreadable

断言：`AC2(registry): the five fixture kinds report five PAIRWISE DISTINCT state tokens` —
`new Set(tokens).size === tokens.length`；四态取值互不相同；两个 in-scope kind 还按 `entry.detector` 区分；
并且把同一批 fixture 走**真实判定入口** `evaluateEntryBar`，五条 `reason` 也两两不同。

### AC3 — 阈值读自注册表

`occurrenceThreshold` 的消费行（不是声明）：

    338:    occurrenceThreshold: 2,                      ← package-cycle 条目
    350:    occurrenceThreshold: 2,                      ← design-evolution-regression 条目
    527:  const occurrenceThreshold = Number.isFinite(entry.occurrenceThreshold) ? entry.occurrenceThreshold : null;
    528:  const occurrenceShort = occurrenceThreshold !== null && occurrences < occurrenceThreshold;
    533:    if (occurrenceShort) failures.push(`occurrences=${occurrences}/${occurrenceThreshold} (CONCERN_KIND_REGISTRY occurrenceThreshold for concern_kind=${kind})`);

断言：`AC3(registry): the occurrence floor comes from the entry — raising it in the registry changes the verdict`
——**负对照**：同一组三条合格记录，把 registry 里 package-cycle 的 `occurrenceThreshold` 改成 4（只改这一个
字段），判定从 `eligible:true` 变为 `CONDITION_4_NOT_MET:occurrences=3/4`。若该字段只声明不消费，这一改不会
产生任何变化。另断言 `occurrences` 与 `run_streak` 是两个量：`[命中, 静默, 命中]` 得 occurrences=2 / streak=1。

### AC4 — 负对照（设计回归信号可取假）

fixture（同一 baseline 窗口的两个方向）：

    regression = { deltaCentral:  288, deltaNonCentral:  -6, deltaDenominator: 282 }   → evaluated:true, hit:true
    repaired   = { deltaCentral:  -40, deltaNonCentral: 120, deltaDenominator:  80 }   → evaluated:true, hit:false
    movedOnly  = { deltaCentral:   50, deltaNonCentral: -50, deltaDenominator:   0 }   → evaluated:true, hit:false

两次断言输出（`AC4(registry): the same predicate hits on a rising window and goes dark on a repaired one`）：

- 上升窗口：`evaluateEntryBar(deStreak())` ⇒ `eligible:true`（C2 `computed:true`）；
- 修复窗口：同一批记录把三个数字换成 repaired ⇒ `CONDITION_2_NOT_MET:the delta is not computed
  (not-a-regression-window: Δcentral=-40 Δdenominator=80 — the share did NOT rise … the signal is extinguished)`；
- 内建自检 `designEvolutionPredicateSelfCheck()` ⇒ `{ok:true, regression_hit:true, repaired_hit:false}`
  （判据「不会说不」时它自己报 `predicate-selfcheck-failed`，⛔ 不是「干净」）。

### AC5 — 未机械化不伪装

`AC5(registry): a registered-but-unlanded detector reports NOT_YET_MECHANIZED and admits nothing`：
`spine-without-extension-point` / `god-file-size` 各自 ⇒ `eligible:false` ∧ `reason` 以
`CONDITION_1_NOT_YET_MECHANIZED:` 开头 ∧ 不以 `CONDITION_1_NOT_MET` 开头（与 `other-boundary` 的前 40 字符
不同）∧ `matchedConditions:[]` ∧ `streak.length:0`（C1 在 C2 之前短路，delta/streak 根本不可达）。
另有两个**半翻转**断言：只把 `mechanized` 改成 true（不补 reader）⇒ `CONDITION_2_UNDETERMINED`（仪器故障是
它自己的态）；补齐 reader 才移动到 `CONDITION_2_NOT_MET` —— 永远不会直达 `ELIGIBLE`。

### AC6 — 历史回放不受影响

`node --experimental-strip-types --test plugin/test/ownership-active-limited-proposal.test.mjs` 尾部：

    ℹ tests 32   ℹ pass 32   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0

`node --experimental-strip-types --test plugin/test/ownership-active-loop.test.mjs` 尾部：

    ℹ tests 60   ℹ pass 60   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0

（第三个消费者 `plugin/test/ownership-semantic-review.test.mjs` 也跑过：37/37 pass。）

### AC7 — 文档指针

`docs/analysis/ownership-active-replay.md` 末尾新增 **§8 amend 2026-10-22 — 准入从单常量扩成 concern-kind
注册表**（§1–§7 原文一字未改，测试里用正则钉住 §6 标题与 §6(a) 原句仍在）。该段含 8.1 四态与五键表、8.2 两条
`NOT_YET_MECHANIZED` 登记位及其探测器任务、8.3 新 kind 的三件套（探测器 / 净口径 delta / 负对照）、8.4 与 §6(d)
的关系、8.5 落点。模块头部注释同步写了 `AMEND 2026-10-22` 并指向 §8。

### DoD — 真实生产 finding 的读数（如实记录，不虚报）

对**主检出**的真实生产载体做了一次只读读数（`/data/home/yale/work/quay/.quay/routine-findings.jsonl`）：

    {"total_lines":2975,"parsed":2975,"malformed":0,"evolution_regression_findings":0}
    history rounds with evolution verdict: {"stable":3}

结论：**尚无一条生产 finding 通过** —— 生产载体里 `dupKind="evolution-regression"` 的记录数为 **0**
（`design-evolution-readings` 的 finding 产出机制昨日才落地，`.quay/design-evolution-history.jsonl` 里
带 `evolution` 判定的 3 轮全是 `stable`，没有触发过 `share-up`）。因此本任务**不声称**在真实生产 finding 上
判过 `ELIGIBLE`；可判性由 fixture 路径证明（AC4），生产路径须等第一条真实回归 finding 落进载体后复验。
另：本模块的生产记录识别已经打通——`deriveConcernKind` 认 `dupKind` 机器 token，测试
`parity: the production findings record derives design-evolution-regression` 用**生产者自己的**
`evolutionFindingRecord()` 产出记录喂进判定，证明两端口径一致（不是本模块自己编的形状）。

## 暗轴读数（ADR-007）

该轴仍暗,理由:本任务只改准入判定表（一条 docs/analysis 脚本 + 其测试 + 一段文档），新增 0 条模块 import、未改变包依赖结构或重复抽象分布，L_D/L_G 读数对本改动无判别力，本任务未取这两个轴的测量。

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs
- docs/analysis/ownership-active-replay.md
- plugin/test/ownership-active-limited-proposal.test.mjs
- tasks/gap-planner-admission-widen-beyond-package-cycle.md
