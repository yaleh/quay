---
id: gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode
title: ADR-022 preserved checkSplitRecommendation explicitly because fast-mode
  reuses it, and CLAUDE.md documents its routing table as current policy — but
  zero fast-mode code actually calls it
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Found while ruling on whether `gap-recursive-guard-only-covers-multi-mechanism` (and the two
sibling `gap-plancheck-*` tasks) should reopen against fast-mode's own mechanisms
(2026-08-04, outer session, human-delegated architecture judgment).

`adr/ADR-022-retire-the-classic-milestone-loop-two-layer-is-the-sole-mode.md`'s "明确不在退役范围
内" section explicitly preserves `checkSplitRecommendation` (alongside `planCheckNextAction` /
`checkTouchesPair`) with the stated reason: **"仍被快速模式复用的判定函数"** ("still reused by
fast mode"). `CLAUDE.md`'s "Split-decision routing policy (DIR-124-A1b)" section documents
`checkSplitRecommendation`'s codes (`split-multi-mechanism`, `split-touch-set-too-large`,
`split-subsystem-blocking-cluster`, `split-recursive-guard`) as a live routing table the
orchestrator "MUST route by," in present tense, not marked retired.

**Real-run evidence — it is not actually called anywhere:**

```
$ grep -rn "checkSplitRecommendation" --include="*.ts" --include="*.md" . | grep -v node_modules | grep -v "/test/" | grep -v "^tasks/"
CLAUDE.md:80        (mentioned in prose, "branch-dense pure functions" list)
CLAUDE.md:159       (the routing-table paragraph itself)
CLAUDE.md:176       (calibration note)
experiments/.../proposal-convergence.ts:133,217,239,276   (the definition itself + internal refs)
plugin/scripts/proposal-convergence.ts:217,239,276        (mirror, same)
adr/ADR-022-...md:83   (the preservation justification)
docs/analysis/*.md, docs/proposals/*.md, adr/ADR-021-...md   (design docs, prose only)
milestones/M199, M206, M193   (historical audit/iteration records, not live code)
```

Zero hits in any script that runs as part of `fast-mode-loop-tick.md`'s tick steps, any skill
(`plugin/skills/*/SKILL.md`), or `plugin/scripts/task-contract-check.ts` /
`concurrent-batch-scheduler.ts` / `it0-split-or-commit-check.ts` (the actual live dispatch-
eligibility chain). The function is exported, correctly implemented, and unit-tested in isolation
— but nothing in the real fast-mode dispatch or task-authoring path ever calls it.

**Consequence**: `CLAUDE.md`'s split-decision routing table currently describes a decision
procedure that a human (or an agent following the doc) is expected to run BY HAND when authoring
a task — there is no mechanical enforcement that a `> 2`-mechanism task actually gets flagged
`split-multi-mechanism` before being authored/dispatched. This is doc/code drift of the same
family this repo has repeatedly flagged tonight (a mechanism is "preserved" but nothing exercises
it — indistinguishable from dead code from the dispatch path's point of view, same shape as
`gap-checkers-have-never-been-shown-to-fail`).

## Chosen mechanism

**Two candidates, not mutually exclusive — a human should choose (or defer both if there's no
current evidence of harm from the gap, matching this session's `gap-plancheck-*` rulings):**

1. **Wire it in**: call `checkSplitRecommendation` at task-authoring time (e.g. `quay:author`'s
   todo→ready gate, or `task-contract-check.ts`) so the routing table in CLAUDE.md becomes
   mechanically enforced, not a manual-reading-required policy doc.
2. **Mark the routing table aspirational**: if wiring it in isn't currently worth the cost, update
   CLAUDE.md's split-decision routing policy section to say so explicitly, rather than reading as
   live enforced policy when it isn't — this repo's own recurring lesson is that undocumented gaps
   between "described as current" and "actually wired" cause real confusion (this very task exists
   because three OTHER tasks assumed the wiring existed).

**Not doing**: not deciding which of the two here — that's the human call this task exists to
route to; not bundling this with `gap-recursive-guard-only-covers-multi-mechanism`'s narrow
recursion-depth bug fix (fixing a bug in an uncalled function is out of order until this is
resolved).

### Ruling (AC1 — 2026-08-06, fast-mode executor): **mark-aspirational (candidate 2), NOT wire-in**

Decision recorded, not left implicit. The routing table is retained as **reference/manual
policy** — the intended procedure for a human/agent authoring or triaging a task BY HAND — and
CLAUDE.md is edited to say so (AC3). It is NOT mechanically enforced by any fast-mode code path.

Rationale (evidence-based, not deferral-by-default):

1. **The classifier's data inputs do not exist in the fast-mode task-authoring path.**
   `checkSplitRecommendation` consumes a typed mechanism inventory (a review agent's
   `mechanisms` array via `deriveMechanismInventory`) and a blocking-findings `ledger`. Fast mode
   replaced ProposalReview/PlanCheck with `task-contract-check.ts` + subagent REFUTE rounds — no
   fast-mode task body carries either a typed `mechanisms` inventory or a review ledger, so the
   `split-multi-mechanism` and `split-subsystem-blocking-cluster` triggers have no honest data
   source to read.
2. **The only mechanical count source is calibrated UNRELIABLE.** `countMechanisms()` /
   `extractMechanismClaims` (`wiring-coverage-check.ts`) was measured at 3/5 correct split
   decisions — "NOT reliable enough to wire into the split path (A4 would falsely split)" —
   `gap-extract-mechanism-claims-calibration` (status done, re-scoped 2026-08-02). Wiring a
   60%-accurate counter into a split gate would manufacture false `split-multi-mechanism`
   signals. The mechanism count is today LLM-agent-reported (classic loop only).
3. **ADR-021 principle**: "不要在证据不足时把策略机械化" — the tick doc's judgment-boundary
   section (unmechanized) explicitly keeps this class of split judgment human-made until enough
   real cases accumulate.
4. **Fast mode already mechanically enforces the scope guards the touch-set trigger was meant to
   provide**: touch orthogonality (`checkTouchesPair` via `concurrent-batch-scheduler.ts` /
   `ready-pool-check.ts`), compound decomposition (`it0-split-or-commit-check.ts`), and touch
   resolvability (`touches-orthogonality-check.ts --resolve`).
5. **Session precedent (2026-08-04)**: sibling `gap-plancheck-*` tasks were ruled `needs-human`
   when their wiring target (`prepare-milestone.js`) was retired — same shape as this one; no
   current evidence of harm beyond the doc drift itself.
6. **ADR-022's preservation note is factually stale for 2 of its 3 named functions**: grep
   shows `checkSplitRecommendation` AND `planCheckNextAction` both have zero non-test callers in
   fast mode; only `checkTouchesPair` is genuinely wired.

**Forward path (not abandoned):** the wire-in is deferred to `countMechanisms()` calibration
(tracked in `gap-extract-mechanism-claims-calibration`'s re-scope note). When mechanism-count
extraction is reliable, wire `checkSplitRecommendation` into `task-contract-check.ts`
(report-only) or the todo→ready promotion path.

**Grep evidence (the same exit criterion that found the gap, re-run 2026-08-06 on master@
7cf74600):**
```
$ grep -rn "checkSplitRecommendation" --include="*.ts" --include="*.mjs" plugin/ experiments/quay-perpetual-stream/ | grep -v "/test/"
plugin/scripts/proposal-convergence.ts:217  (definition + internal refs only)
experiments/quay-perpetual-stream/scripts/proposal-convergence.ts:217  (mirror, same)
```
Zero hits in any fast-mode tick/skill/checker file (`task-contract-check.ts`,
`concurrent-batch-scheduler.ts`, `ready-pool-check.ts`, `it0-split-or-commit-check.ts`,
`touches-orthogonality-check.ts`, `plugin/loop/fast-mode-loop-tick.md`, `plugin/skills/author/SKILL.md`).

## Acceptance Criteria

- [x] AC1: **RULING LANDED — mark-aspirational (candidate 2), NOT wire-in.** Full decision +
      evidence in "Chosen mechanism → Ruling (AC1)" above (2026-08-06).
- [x] AC2: **n/a — wire-in NOT chosen** (AC1 ruling is mark-aspirational). Grep evidence of the
      zero-caller state pasted in the Ruling block above (the same exit criterion that found the
      gap); the antecedent of this conditional AC is false, so there is nothing to wire.
- [x] AC3: **LANDED — `CLAUDE.md`'s split-decision routing policy section edited** to state the
      table is NOT mechanically enforced, with a pointer to this task (see the STATUS note added
      at `CLAUDE.md` §"Split-decision routing policy", 2026-08-06).
- [x] AC4: **RE-EVALUATED — `gap-recursive-guard-only-covers-multi-mechanism` stays `needs-human`.**
      Since AC1 chose aspirational, the AC4 outcome is "stays needs-human", which matches that
      task's current `status: needs-human` (verified 2026-08-06) — no status write needed. Its
      remaining AC7 target (`prepare-milestone.js` `_splitCheck()`) is retired under ADR-022, and
      its core mechanism (the hoisted `wbsLevel >= 2` guard in the retained
      `checkSplitRecommendation`) is already landed + unit-tested.

## Definition of Done

- [x] AC1-AC3 evidence pasted into this task body — verified present 2026-08-07 (worktree
      `task/gap-checksplitrecommendation-...`, branch HEAD b781b9a6): (AC1) the full ruling
      (decision + rationale + forward path) sits in "Chosen mechanism → Ruling (AC1)"; (AC2)
      the zero-caller grep evidence is pasted in the Ruling block and re-verified live —
      `grep -rn "checkSplitRecommendation" plugin/ experiments/quay-perpetual-stream/` returns
      only the definition + internal refs in `proposal-convergence.ts` (both mirrors), zero
      callers in any fast-mode tick/skill/checker file; (AC3) `CLAUDE.md` §"Split-decision
      routing policy (DIR-124-A1b)" carries the STATUS: reference/manual policy — NOT
      mechanically enforced (2026-08-06) blockquote with a pointer to this task (verified in
      worktree CLAUDE.md). Contract measure: `task-contract-check.ts --strict-subset` on this
      task reports "no violations" (exit 0). Scoped tier: `scripts/test.sh --for-task
      gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode
      --allow-thin` → 42 pass / 0 fail / 1 subset-skip (task-contract-check strict-subset
      clean). Retained-function unit tests: `proposal-convergence.test.mjs` → all
      `checkSplitRecommendation` cases pass (split-multi-mechanism, split-touch-set-too-large,
      split-subsystem-blocking-cluster, split-recursive-guard, WBS-level guard).
- [x] `gap-recursive-guard-only-covers-multi-mechanism`'s status updated per AC4's outcome —
      AC4's outcome is "stays `needs-human`", and that task's live status is already
      `status: needs-human` (verified 2026-08-07, `tasks/gap-recursive-guard-only-covers-
      multi-mechanism.md` line 5), so per AC4 no status write was needed and none was made
      (that task is out of this task's Touches; not modified).

## Touches

- tasks/gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.md
- CLAUDE.md
- plugin/scripts/task-contract-check.ts (if wire-in chosen)
- plugin/skills/author/SKILL.md or equivalent todo→ready gate (if wire-in chosen)

## Dispatch review

reviewer: none
at: 2026-08-04T10:5xZ
changed: 无（外层建任务，裁定 gap-recursive-guard 时发现的更基础缺口；未经正式闸口审查）

## 从 CLAUDE.md 搬入（2026-08-10，manager）

CLAUDE.md 曾用 38 行（占该文件 13%）复制本任务的路由表与阈值裁定。按「必经路径只放指针」原则搬回此处，
CLAUDE.md 只留指针。**以下两段是 CLAUDE.md 独有、此前不在本任务体里的内容，原样保存：**

**路由表（`checkSplitRecommendation` 返回 `splitRecommendation.code` 时的处置）**

| Code | Action | Rationale |
|---|---|---|
| `split-multi-mechanism` | 自动记录 split + 建子任务 | 不可修——范围需改章程。>2 个可独立落地的机制 |
| `split-touch-set-too-large` | 自动记录 split + 收窄 touches | 不可修——面太宽（>8 文件） |
| `split-subsystem-blocking-cluster` | **先消费 repairable bypass** | 可修——一次聚焦的 delta 修订可能关掉全部 findings；bypass 是每代一次性（`splitBypassAvailable` 在 `deltaRound === 0` 消费） |
| `split-recursive-guard` | **路由到 needs-human，不自动拆** | 二级叶子仍多机制 ⇒ 真缺陷在上游分解太浅；自动再拆只会加重 |

**记录 split 决定后必须验证已被落实**：①父任务 `children:` frontmatter 已填；②每个子任务
`tasks/<childId>.md` 在盘上存在；③每个子任务 `status: todo` + `parent:` 反链；④M 号已分配（开发类）。
**决定了但没建子任务 = 不完整**，任务处于 limbo（`status: todo`、无从执行）。

**阈值裁定（CLAUDE.md 独有，此前不在本任务体）**：`checkSplitRecommendation` 里的 **`> 2` 机制阈值
校准正确——不要调整它**。DIR-126 的五个子任务（各 1 机制，全部完成）与 DIR-124-B/F 的拆分（4/6 机制，
分解正确）共同确认了该阈值。把覆盖项数成机制数，是 `extractMechanismClaims` 的校准问题，**不是阈值缺陷**。
