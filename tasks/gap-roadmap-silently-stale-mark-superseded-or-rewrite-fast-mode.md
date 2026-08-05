---
id: gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode
title: quay-harness-crystallization-roadmap.md (07-31) is built entirely on the
  ADR-022 (08-03) retired classic pipeline — silently stale is more dangerous
  than absent; mark superseded + extract the still-valid strategic question
status: todo
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

- [ ] AC1: 路线图头部标注 SUPERSEDED + 指向 ADR-022（含日期与一句话理由）
- [ ] AC2: 每个 Phase 段标注「引用机制 + fast-mode 状态」（退役的机制点名，不暧昧）
- [ ] AC3: 仍有效的战略问题显式提取并交叉引用 cross-project-portability 任务
- [ ] AC4: **grep 证明**——路线图不再有任何「无标注地指向已删除代码」的引用（每个删除机制引用都带
      retired/superseded 标注；实跑输出贴任务体）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`（若标注检查可测试化）

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC4 grep 输出贴任务体
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

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
