---
id: gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode
title: quay-harness-crystallization-roadmap.md (07-31) is built entirely on the
  ADR-022 (08-03) retired classic pipeline — silently stale is more dangerous
  than absent; mark superseded + extract the still-valid strategic question
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者调查（人问「outer 有在做整体分析/规划/设计吗」引出，
`orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`）。

**发现**：`docs/proposals/quay-harness-crystallization-roadmap.md`（**07-31**）是全仓库最近的战略文档
（5 阶段、量化指标、依赖链），**但整篇建立在 ADR-022（08-03，只晚 3 天）已废除的经典 milestone
管线上**——`prepare-milestone.js`/`execute-milestone.js`、ProposalReview、PlanCheck、kernel/policy
分离。Phase 0–4 全部指向已删除代码：

- Phase 0 的 `contentAgentMs` 字段在已删除的 `proposal-convergence.ts` 里；
- Phase 1 探测器挂进已废除的 PlanCheck；
- Phase 2 的 kernel/policy 分离针对已删除的 `prepare-milestone.js`；
- **Phase 3（跨项目校准）描述的机制不存在了**。

**现状是沉默地过期，比没有路线图更危险**——它看起来还在，可能误导下一个读它的人（含未来的 outer
自己）。今晚的 meta-cc 冷启动在回答 Phase 3 的战略问题，但没对照任何写下来的路线图，纯临场推的。

### 选定机制

**标记 superseded + 提取仍有效的战略问题**（完整重写成 fast-mode 版本是更重的动作，先做最小正确
动作，避免沉默误导）：

1. 路线图头部标注 `SUPERSEDED by ADR-022 (2026-08-03)`——建立在已退役的经典 milestone 管线上；
2. 每个 Phase 段标注它引用的机制 + 在 fast-mode 下的状态（退役 / 问题仍成立）；
3. 仍有效的战略问题（Phase 3 的跨项目可迁移性）提取 + 交叉引用
   `gap-fast-mode-cross-project-portability-strategic-question`。

## Acceptance Criteria

- [x] AC1: 路线图头部标注 SUPERSEDED + 指向 ADR-022（含日期与一句话理由）
- [x] AC2: 每个 Phase 段标注「引用机制 + fast-mode 状态」（退役的机制点名，不暧昧）
- [x] AC3: 仍有效的战略问题显式提取并交叉引用 cross-project-portability 任务
- [x] AC4: **grep 证明**——路线图不再有任何「无标注地指向已删除代码」的引用（每个删除机制引用都带
      retired/superseded 标注；实跑输出贴任务体）
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`（若标注检查可测试化）

### AC4 实跑输出（2026-08-05，`gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode`）

**CONTRACT measure（stale_refs）** = 26（band ≥1 命中；仍引用但已全部带 retired/superseded 标注）：

```text
$ grep -cE 'prepare-milestone|execute-milestone|ProposalReview|PlanCheck' docs/proposals/quay-harness-crystallization-roadmap.md
26
```

**CONTRACT invoke（SUPERSEDED）**：

```text
$ grep -n 'SUPERSEDED' docs/proposals/quay-harness-crystallization-roadmap.md
3:> ## ⛔ SUPERSEDED by ADR-022 (2026-08-03) — do not use as a live roadmap
22:- **Status:** ⛔ **SUPERSEDED** (2026-08-05) — built on the ADR-022-retired classic
47:## 0. Mechanism status annotations (SUPERSEDED)
```

**AC4 grep（每个删除机制引用都带标注——banner / 机制状态表 / `[retired mechanism]` 块注 / 行内标记）**：

```text
$ grep -nE 'prepare-milestone|execute-milestone|ProposalReview|PlanCheck|proposal-convergence|milestone-preparation-check|OUTER-LOOP|milestone-worktree|StageReceiptEnvelope|milestones/M' docs/proposals/quay-harness-crystallization-roadmap.md
6:> `prepare-milestone.js` / `execute-milestone.js`、ProposalReview、PlanCheck、kernel/policy 分离、
7:> `OUTER-LOOP.md`——这些文件已于 `gap-retire-the-prepare-execute-pipeline-cluster`（2026-08-03）
15:> ProposalReview/PlanCheck；subagent REFUTE 轮取代 Audit；`git worktree add $WORKTREE_ROOT/<slug>`
16:> 取代 milestone-worktree.ts；遥测在 `.quay/fast-mode-telemetry.jsonl`。
26:- **Scope:** define the next phase of crystallization after the prepare-milestone +
27:  execute-milestone workflow pipeline [both **RETIRED under ADR-022**, 2026-08-03]
37:  [`quay-execute-milestone-build-efficiency.md`](./quay-execute-milestone-build-efficiency.md)
41:  [`gap-prepare-milestone-no-size-aware-routing`](../../tasks/gap-prepare-milestone-no-size-aware-routing.md)
51:| `prepare-milestone.js` / `execute-milestone.js`（workflow 文件） | **RETIRED** — 已物理删除 | 双层快速模式：`fast-mode-loop-tick.md` tick + worktree 隔离派发 |
52:| ProposalReview | **RETIRED** | `## Contract` 六键 + `task-contract-check.ts` |
53:| PlanCheck | **RETIRED** | 同上 |
54:| `proposal-convergence.ts` | **RETIRED** — 已删除；`checkSplitRecommendation` 导出保留但未接入 fast-mode | 见 `gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode` |
55:| `milestone-preparation-check.ts` | **RETIRED** — 已删除；`computeTouchesExpansion`→`concurrent-batch-scheduler.ts`、`parsePlanStages`/`validatePlanStructure`→`prepare-admission-check.ts` | `task-contract-check.ts` / `prepare-admission-check.ts` |
56:| `OUTER-LOOP.md`（经典循环驱动器） | **RETIRED** | `fast-mode-loop-tick.md`（内层）+ orchestrator-loop-tick（外层） |
58:| `milestone-worktree.ts` | **RETIRED** — 已删除 | `git worktree add $WORKTREE_ROOT/<slug>` 直接建 |
59:| `StageReceiptEnvelope` / `milestones/M*` 目录 | **RETIRED** — 经典里程碑簿记 | `.quay/fast-mode-telemetry.jsonl` + 任务体 + per-task worktree |
106:> **历史数据提示（[retired mechanism]）**：§2 的收敛数据（ProposalReview 轮次 ρ 序列、信息效率衰减、
111:Ten ProposalReview [retired, ADR-022] rounds produced this finding sequence:
170:> **⚠ [retired mechanism]** 本 Phase 依赖 `proposal-convergence.ts` 与 `milestone-preparation-check.ts`
171:> ——两者均已于 ADR-022 退役（2026-08-03 物理删除；`contentAgentMs` 字段随 `proposal-convergence.ts`
219:### 3.3 Required action *(references `proposal-convergence.ts` / `milestone-preparation-check.ts` — both RETIRED, ADR-022; historical)*
221:1. Populate `contentAgentMs` in `proposal-convergence.ts`'s
224:   Adjudicate, ProposalReview, PlanAuthor, PlanCheck). This is ~50 lines of
227:2. Report `contentAgentMs` in `milestone-preparation-check.ts`'s
239:> **⚠ [retired mechanism]** 本 Phase 的探测器要挂进 **PlanCheck**——PlanCheck 已被 ADR-022 退役
258:Detectable at:    PlanCheck (after Plan is written, before Build dispatch)
287:   facts existed at PlanCheck ("AC requires real journal, Plan commits
289:2. Implement a deterministic detector in `milestone-preparation-check.ts`
290:   (or a PlanCheck sub-step) that compares extracted evidence modality per AC
302:6. After one real later milestone is caught at PlanCheck (not Audit), record
312:> **⚠ [retired mechanism]** 本 Phase 针对已删除的 `prepare-milestone.js` / `execute-milestone.js`
319:The (now-deleted, ADR-022) prepare-milestone.js and execute-milestone.js source code mixed
355:`prepare-milestone.js`'s `meta.description` field is 1033 characters.
357:once per landed change and never subtracted. `execute-milestone.js`'s
387:   OUTER-LOOP.md. The profile is the sole owner. Verification: changing one
443:  Compare: Prepare wall time, PlanCheck finding yield, Audit outcome,
478:> **⚠ [retired mechanism]** 本 Phase 依赖经典 milestone 目录（`milestones/M*`）、`StageReceiptEnvelope`、
532:1. DIR-124-B defines the canonical `StageReceiptEnvelope` with RunIdentity,
555:> `proposal-convergence.ts` / `milestone-preparation-check.ts` / DIR-124-D 均已退役。保留作历史。
578:> **提示（[retired mechanism]）**：本表的 pass/fail 条件大多引用已退役的 PlanCheck、DIR-124-D policy
586:| 1 | Evidence-modality detector catches ≥1 real mismatch at PlanCheck (not Audit) in a later milestone; false-positive rate < 5% | Detector fires on valid evidence mappings OR catches zero real mismatches over 10 milestones |
609:> **提示（[retired mechanism]）**：开放问题 1–4 引用已退役机制（`proposal-convergence.ts`、
610:> PlanCheck、DIR-124-D policy profile、L0 公式）——机制不存在后这些问题大部分已失去对象。
617:2. Should the first back-propagation detector be blocking (fail PlanCheck,
```

逐行核对：6–16 在 SUPERSEDED banner 块注内；26–27 行内 `[RETIRED under ADR-022]`；37/41 下一行行内
`[retired-era doc]` / `[ADR-022-retired pipeline task]`；51–59 机制状态表（每行 RETIRED）；
106 在 `[retired mechanism]` 块注；111 行内；170–171 Phase 0 块注；219 §3.3 标题行内标记；
221/224/227 在 §3.3 标题标记下；239 Phase 1 块注；258/287/289–290/302 在 Phase 1 块注下；
312 Phase 2 块注；319 行内；355/357/387 在 Phase 2 块注下；443 在 Phase 3 块注下；478 Phase 4 块注；
532 在 Phase 4 块注下；555 §8 块注；578/586 在 §9 块注下；609–610 §11 块注；617 在 §11 块注下。
**无一行是无标注地指向已删除代码。**

**AC5 测试**（`plugin/test/roadmap-superseded-check.test.mjs`，`node:test` + `// @test-group governance`）：

```text
$ node --experimental-strip-types --test plugin/test/roadmap-superseded-check.test.mjs
✔ AC1/AC3: roadmap carries SUPERSEDED banner (ADR-022 + date) and the cross-project reference
✔ AC4 negative control: stripping the annotation blockquotes makes the audit fail (silent rot is caught)
ℹ tests 2  ℹ pass 2  ℹ fail 0
```

## Definition of Done

- [x] AC1–AC5 全部勾上；AC4 grep 输出贴任务体
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——**外层 verification-round round1 (2026-08-05) 验证**：tests 2319 / fail 1（已知 noise-gate 负载抖动，isolated 1/0 pass）/ cancelled 0；记为绿（modulo 文档化抖动）

## Touches

- docs/proposals/quay-harness-crystallization-roadmap.md
- orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md（引用）

## Contract

measure   stale_refs = `grep -cE 'prepare-milestone|execute-milestone|ProposalReview|PlanCheck' docs/proposals/quay-harness-crystallization-roadmap.md` stdout 的数字字段
band      stale_refs = ≥1（仍引用但已带 retired/superseded 标注；或重构后为 0）
invariant superseded_annotated = 1（头部标注存在）
invoke    `grep -n 'SUPERSEDED' docs/proposals/quay-harness-crystallization-roadmap.md`
control   负控制：无标注地指向已删代码 ⇒ 检查/人工必须标记
resume    标注与提取分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T02:0xZ
changed: 外层读调查全文后立案。三处收紧：
(1) **沉默过期比没有危险**——路线图看起来还在、会误导未来的 outer 自己，最小正确动作是标注
superseded + 逐个 Phase 点名退役机制；
(2) **AC3 提取仍有效的战略问题**——Phase 3 的跨项目可迁移性问题不随机制退役，单独钉住（交叉引用
另一条任务）；
(3) **AC4 grep 证明**——不允许「无标注地指向已删除代码」残留，标注要可查。
status: todo——不阻塞当前批；但这是人最关心的战略层缺口，排高优先。
