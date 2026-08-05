---
id: gap-needs-human-black-hole-human-dependency-unmeasurable
title: "needs-human is the LITERAL human-dependency count (AC10 asks can the mechanism evolve without a human — this is that measure) and it is currently a BLACK HOLE: the 15 needs-human tasks are an indistinguishable mix of (a) truly-dead ADR-022-retired (gap-plancheck-*, correctly parked with RE-TRIAGE annotations) and (b) ALIVE current-mechanism tasks stuck waiting for a decision nobody knows is still awaited — DIR-109 canonical test runner (CLAUDE.md current, 7d untouched), DIR-100 gate-loader diagnostics + DIR-103 acceptance-runner dry-run (gate engine alive, 3d untouched); needs-human can ENTER but not EXIT: no expiration, no re-review, nothing reports it, so we can't even measure how much the mechanism depends on a human; generator question: needs-human quantifies 'this task needs a human decision' but for HOW LONG? no limit; is the mechanism still alive? not checked — missing TIME axis + SURVIVAL axis; fix: needs-human > N days untouched ⇒ forced re-review; task referencing ADR-retired mechanism ⇒ auto-superseded (reuse strategic-doc-staleness-check.ts's path-existence, same ruler on tasks/needs-human)"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者生成器第三轮（2026-08-05）——**落在 needs-human 上**。这条【直接就是「没有人就不能演进」的
度量】，而它现在是个**黑洞**。

**两次自更正先记**：
① 先用提交信息 grep 估池子趋势，得出「在流失」；用任务板真值一测方向是反的——**ready 9 小时前 2 →
现在 29，池子在涨，外层的晋级机制在正常工作**。**提交信息 grep 不是趋势仪器**，这条估错记下；
② 随后假设「needs-human 的 15 条全是 ADR-022 退休机制遗留」，逐条核实后**也是错的**。

**【真发现】任务板真值**：todo 86 / ready 29 / done 605 / **needs-human 15**。那 15 条里至少三类混在
一起：
- **(a) 确已死**——gap-plancheck-* 等，任务体已有 ADR-022 RE-TRIAGE 标注，**正确停放**；
- **(b) 活的、且是现行机制**——DIR-109「canonical test runner (scripts/test.sh)」是 CLAUDE.md 现行入口、
  最后修改 07-29（7 天前）；DIR-100「Gate loader diagnostics」+ DIR-103「Acceptance runner dry-run」都是
  **闸门引擎**的活，最后修改 08-02（3 天前）。这三条不是死任务，是**卡在等一个没人知道还在等的决定**，
  各躺 3-7 天。

**⇒ needs-human 进得去、出不来**：没有过期、没有复检、没有任何东西把它报出来，**死的和活的混在一起
无法区分**。

**【为什么这条比其它几条重要】** AC10 问「这套机制能不能在人不在场时演进」，而 needs-human 就是
**字面上的人依赖计数**。现在这个计数：**不可信**（死活混杂）、**无时限**（永不过期）、**无人看**（3-7
天无人碰）。⇒ **我们连「机制到底有多依赖人」这个数都测不准**。

**生成器问句**：needs-human 量化的是什么范围？答「这个任务需要人决定」——但**多久**？无期。
**机制还在不在**？不检查。**缺的是时间轴 + 存活轴。**

**最小可行判据**：
- **时间轴**：needs-human 任务超过 N 天未被碰 ⇒ **强制复检**；
- **存活轴**：任务体引用的机制若已被 ADR 退休 ⇒ **自动标 superseded**（此检查已有雏形——
  `strategic-doc-staleness-check.ts` 的路径存在性判据，只是没有作用在 `tasks/needs-human` 上——**同一把
  尺子换个对象**）。

**AC10 记账**：按 pre-friction 计，3 → 4——发现时无失败无告警，needs-human=15 静静躺着，没有任何东西
在疼。

### 选定机制（外层裁定：立案）

**needs-human 从黑洞变可测**（人依赖计数可读）：

1. **时间轴**：needs-human > N 天未碰 ⇒ 强制复检（把「卡在没人知道还在等的决定」报出来）；
2. **存活轴**：`strategic-doc-staleness-check.ts` 的路径存在性判据**作用到 tasks/needs-human**——引用
   已退休机制的任务自动标 superseded（同尺子换对象），把「正确停放的死任务」与「活的卡住任务」分开；
3. **人依赖计数可信**：needs-human 的 (a)/(b) 可分 → AC10 的「依赖人多少」有真值。

## Acceptance Criteria

- [ ] AC1: **时间轴**——needs-human 任务超过 N 天未被碰 ⇒ 强制复检（N 可配，默认如 7 天）；把「卡在
      没人知道还在等的决定」报出来
- [ ] AC2: **存活轴**——`strategic-doc-staleness-check.ts` 路径存在性判据作用到 tasks/needs-human：
      引用已退休机制的任务自动标 superseded（同尺子换对象）
- [ ] AC3: **(a)/(b) 可分**——正确停放的死任务 vs 活的卡住任务从此区分（DIR-109/100/103 这类被报出来）
- [ ] AC4: **人依赖计数可信**——needs-human 死活可分 → AC10 的依赖度量有真值（实跑输出贴任务体）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC4 实跑输出贴任务体
- [ ] needs-human 从黑洞变可测（时间轴强制复检 + 存活轴自动 superseded）；人依赖计数可信
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/（needs-human 复检 + 存活轴检查，复用 strategic-doc-staleness-check 判据）
- plugin/test/（AC1/AC2 fixture）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC10 记账引用）

## Contract

measure   needs_human_stale = 超过 N 天未碰的 needs-human 条数
band      needs_human_stale 可解析（复检清单输出；死/活分开）
invariant same_ruler_on_needs_human = 1（存活轴复用 strategic-doc-staleness-check 路径存在性判据）
invoke    `node --experimental-strip-types <needs-human 复检+存活轴检查>`
control   构造 DIR-109 类活卡任务（引现行机制）⇒ 报出需复检；gap-plancheck-* 类死任务（引退休机制）⇒
          自动 superseded（AC3 两向）
resume    时间轴复检与存活轴分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:4xZ
changed: 外层受管理者生成器第三轮裁定立案（needs-human 黑洞）。四处收紧：
(1) **人依赖计数字面度量**——AC10 问「无人能否演进」，needs-human 就是那个计数，现在不可信/无时限/
    无人看；
(2) **时间轴 + 存活轴**——>N 天强制复检；引用退休机制自动 superseded（strategic-doc-staleness-check
    路径存在性同尺子换对象）；
(3) **(a)/(b) 可分**——正确停放的死任务 vs 活的卡住任务（DIR-109/100/103 是活机制卡等决定，非死）；
(4) **AC10 3→4**——pre-friction（needs-human=15 静静躺着，无东西在疼）。
status: todo——人依赖度量修复；排 ROUND 3 收尾后，高优先。
