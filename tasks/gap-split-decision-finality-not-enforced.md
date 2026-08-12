---
id: gap-split-decision-finality-not-enforced
title: "Split decisions are not final: 15 redundant dispatches re-ran
  prepare-milestone on tasks already ruled SPLIT"
status: superseded
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
  superseded: true
  superseded_at: 2026-08-12
---

**type:** execution
> **SUPERSEDED / 作废（人 2026-08-12 00:4x 裁定，B 组）**：本任务引用 ADR-022 已物理删除的机制（prepare-milestone.js / execute-milestone.js 等），剩余 AC 要求针对已被删除的 pipeline 取证，**前提已不存在**——不是「完成」是「作废」。历史记录保留，不重开。引用已删机制：prepare-milestone.js。

**ADR-022 RE-TRIAGE NOTE (2026-08-04, gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files):**
status stays `ready` — this task is NOT an ADR-022 casualty. The split-decision recording flow it
targets (`--record-split-decision` / `decideSplitAdjudication` / `_recordSplitDecisionCli`) lives in
`proposal-convergence.ts`, which ADR-022 RETAINED and CLAUDE.md's split-decision routing policy
documents as the LIVE mechanism; it was never part of the deleted `prepare-milestone.js`. The core
mechanism (AC1-AC4) landed 2026-08-02: `splitScopeHash` is exported (`proposal-convergence.ts` L1174),
`_recordSplitDecisionCli` writes it (L1318), and `decideSplitAdjudication` compares it for SPLIT
records with legacy fallback to `scopeHash` (L1215-1218). Its `## Touches` all resolve except
`plugin/test/proposal-convergence.test.mjs`, a plugin-side test mirror that ADR-022's retirement
deleted — that entry is removed from `## Touches` below (the experiments-side
`proposal-convergence.test.mjs` is canonical and covers AC5-AC7). Real-run resolve evidence
(worktree branch, 2026-08-04):
```
$ node --no-warnings --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --resolve tasks/gap-split-decision-finality-not-enforced.md --root "$(pwd)"
  ok: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
  ok: plugin/scripts/proposal-convergence.ts
  ok: experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
  MISSING: plugin/test/proposal-convergence.test.mjs   ← entry removed below
RESOLVE tasks/gap-split-decision-finality-not-enforced.md: 1/4 non-(new) touches missing — resolves (dispatchable)
```
Remaining work for a dispatch: verify AC1-AC7 against the landed code and close.

**OUTER CORRECTION (2026-08-04, human ruling — supersedes the RE-TRIAGE note above):** status
moved to `needs-human`. The 2026-08-04 re-triage above checked only that this task's `## Touches`
*files* resolve (they do — `proposal-convergence.ts` was retained) but never checked whether
this task's actual TARGET — `decideSplitAdjudication`'s redundant-dispatch block, reached via
`prepare-milestone.js`'s `--decide-split` CLI invocation (confirmed the sole caller:
`milestones/M206/audits/iteration-0-acceptance-audit.md`'s AC7/AC-Admission audit traces the only
call site to that workflow file's Admission phase) — has any live caller left. It doesn't:

```
$ grep -rln "decideSplitAdjudication\|decide-split\b" --include="*.ts" --include="*.sh" --include="*.md" plugin/ .quay/
plugin/scripts/proposal-convergence.ts   # only the definition itself

$ grep -rln "proposal-convergence" plugin/scripts/*.ts plugin/loop/*.md plugin/skills/**/*.md
plugin/scripts/proposal-convergence.ts
plugin/skills/quay-task-to-plan/SKILL.md   # uses validateConvergenceCounters/capsFor only —
                                            # zero mention of checkSplitRecommendation,
                                            # decideSplitAdjudication, or --record-split-decision

$ grep -rn "prepare-decisions\|splitScopeHash\|decideSplitAdjudication" plugin/loop/*.md \
    plugin/scripts/it0-split-or-commit-check.ts plugin/scripts/touches-orthogonality-check.ts \
    plugin/scripts/concurrent-batch-scheduler.ts
(no output)
```

`.claude/workflows/prepare-milestone.js` — the ONLY thing that ever called
`decideSplitAdjudication()` to block redundant dispatch — was physically deleted by ADR-022
(`gap-retire-the-prepare-execute-pipeline-cluster`, 2026-08-03; confirmed `ls` returns "No such
file or directory"). `proposal-convergence.ts` surviving is necessary but not sufficient — the
FUNCTION exists, but nothing in the fast-mode-era codebase calls it. **The 15-redundant-dispatch
waste this task exists to prevent cannot recur today**, because nothing re-dispatches through
that dead path anymore. `checkSplitRecommendation` (the DIFFERENT, genuinely-live split
*classifier* CLAUDE.md's routing table documents) is unaffected by this ruling — this closure is
specific to `decideSplitAdjudication`/`_recordSplitDecisionCli`/`splitScopeHash`'s
redundant-dispatch-blocking mechanism, not the classifier.

**Human ruling (2026-08-04, relayed verbatim):** "它的判据针对已退役的 prepare-milestone split
流程，内层的识别是对的" — closing per the same convention used for the other 7 ADR-022 casualties
in [[gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files]]: `needs-human`,
not `done` (the mechanism isn't proven correct or incorrect, it's simply unreachable — a future
fast-mode redundant-dispatch guard, if ever needed, would be a NEW task deciding where to hook in,
not a resumption of this one).

## Proposal

`decideSplitAdjudication` (M206) already returns `content-dispatch-blocked` /
`outcome: needs-human` / `phase: Admission` when a SPLIT record's hashes match. Yet telemetry
shows the same task receiving `split-recommended` repeatedly:

| Task | split-recommended count |
|---|---|
| DIR-126-E | 5 |
| gap-wiring-coverage-check-whose-own-and-bold-marker-splitting | 4 |
| gap-prepare-milestone-split-decision-no-finality | 4 |
| gap-dir126d-deferred-phase-timing-recurrence-tracking | 3 |
| gap-prepare-milestone-epoch-scope-change-grants-full-review | 2 |
| DIR-124-F | 2 |
| DIR-124-A | 2 |

**15 redundant dispatches ≈ 3.5 hours of pure waste.**

### Root cause: SPLIT records are invalidated by prose edits

`_recordSplitDecisionCli` binds a SPLIT record to `scopeHash({taskBody, declaredTouches})`.
`scopeHash` hashes `{acBoxCount, touchesSorted}` — but `decideSplitAdjudication` requires ALL
THREE of `charterHash`, `scopeHash`, `reviewPolicyHash` to match. Adding a single AC checkbox
while responding to the split (the natural next action) changes `acBoxCount`, invalidates the
record, and the next dispatch re-runs the full pipeline and re-derives the same split.

**A SPLIT ruling is about STRUCTURE (how many independent mechanisms the scope contains), not
about the exact AC count.** Editing ACs in response to the ruling should not erase the ruling.

## Chosen mechanism

Two changes, both narrow:

1. **`splitScopeHash` — a structure-only hash for SPLIT records.** A new exported function
   hashing ONLY `touchesSorted` (the surface), not `acBoxCount`. SPLIT records bind to it;
   COMMIT records keep the existing `scopeHash` (a COMMIT ruling IS about the specific reviewed
   content, so an AC edit correctly invalidates it).

2. **Record `splitScopeHash` alongside `scopeHash`** in the decision record (additive field,
   `schemaVersion` stays 1 per the M207 additive-growth precedent). `decideSplitAdjudication`
   compares `splitScopeHash` for `decision === 'split'` and `scopeHash` for
   `decision === 'commit'`. Records written before this change have no `splitScopeHash` →
   fall back to the existing `scopeHash` comparison (conservative, no behavior change).

## Acceptance Criteria

- [ ] AC1: `splitScopeHash({declaredTouches})` exported; hashes touches only, not AC count
- [ ] AC2: `_recordSplitDecisionCli` writes `splitScopeHash` into the record (additive)
- [ ] AC3: `decideSplitAdjudication` uses `splitScopeHash` for SPLIT records when present
- [ ] AC4: `decideSplitAdjudication` still uses `scopeHash` for COMMIT records (unchanged)
- [ ] AC5: A SPLIT record survives an AC-checkbox edit (the 15-redundant-dispatch scenario)
- [ ] AC6: A SPLIT record IS invalidated by a Touches change (surface genuinely changed)
- [ ] AC7: Legacy records without `splitScopeHash` fall back to `scopeHash` — no behavior change
- [ ] AC8: both mirrors byte-identical

## Definition of Done

- [ ] `splitScopeHash` implemented + exported in both `proposal-convergence.ts` mirrors
- [ ] Record write path and adjudication read path both updated
- [ ] Tests cover AC1/AC3/AC4/AC5/AC6/AC7
- [ ] `scripts/test.sh` green

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
