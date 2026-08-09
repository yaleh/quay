---
id: gap-recursive-guard-only-covers-multi-mechanism
title: split-recursive-guard only fires for split-multi-mechanism — a depth-2+
  leaf triggering any other split code still auto-splits
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

**ADR-022 RE-TRIAGE (2026-08-04, gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files):**
status `ready` → `needs-human`. The CORE mechanism of this task LANDED and is unit-tested: the
`wbsLevel >= 2` recursive guard was HOISTED above all three split triggers in the retained
`checkSplitRecommendation` (`proposal-convergence.ts` L226-234, 2026-08-02) and is exercised by
`proposal-convergence.test.mjs` (AC1-AC6 pass, e.g. "WBS level >= 2 ... returns split-recursive-guard,
not split-multi-mechanism"). What remains — AC7 "`_splitCheck()` in `prepare-milestone.js` matches" —
targets the classic `prepare-milestone.js` `_splitCheck()` that ADR-022 retired and physically
deleted at `gap-retire-the-prepare-execute-pipeline-cluster` (2026-08-03). The split-decision
routing policy in CLAUDE.md is retained and documents `split-recursive-guard` as a live routing
code, but no fast-mode orchestrator code calls `checkSplitRecommendation` (grep confirms zero
non-test callers outside `proposal-convergence.ts`). Real-run resolve evidence (worktree branch,
2026-08-04):
```
$ node --no-warnings --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --resolve tasks/gap-recursive-guard-only-covers-multi-mechanism.md --root "$(pwd)"
  ok: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
  ok: plugin/scripts/proposal-convergence.ts
  ok: experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
  MISSING: plugin/test/proposal-convergence.test.mjs
  MISSING: .claude/workflows/prepare-milestone.js
  MISSING: plugin/workflows/prepare-milestone.js
RESOLVE tasks/gap-recursive-guard-only-covers-multi-mechanism.md: 3/6 non-(new) touches missing — resolves (dispatchable)
```
(The resolve check does not flag this body — proposal-convergence.ts is majority-present — but the
two missing `prepare-milestone.js` entries are the ONLY remaining AC's wiring target, which is
deleted. Disposition is by Proposal/AC re-scope, not by the majority-missing threshold.)

**OUTER RULING (2026-08-04, judgment delegated by the human):** **Stay `needs-human` AS WRITTEN.
Do not reopen this narrow body — but the zero-caller fact this task's own re-triage note already
surfaced is a real, bigger, separate gap; filed as its own task
[[gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode]] rather than
folded into this one.**

This task's own AC7 assumes `checkSplitRecommendation` is being called somewhere in fast-mode's
dispatch path and just has a narrow bug (guard only covers one split code). That assumption is
false: **nothing calls it at all**, in either fast-mode or anywhere else — confirmed independently
tonight (`grep -rn "checkSplitRecommendation" --include="*.ts" --include="*.md" .` outside
`proposal-convergence.ts` itself, its own tests, and prose docs: zero production call sites).
ADR-022 explicitly preserved this function "because fast-mode reuses it"
(`adr/ADR-022-...md:83`, "仍被快速模式复用的判定函数"), and `CLAUDE.md`'s split-decision routing
table (line ~159) documents its codes as current active policy — but the actual wiring from any
real dispatch/task-authoring path was apparently never done. **Fixing this task's narrow
recursion-depth bug would be fixing a bug in a function nobody calls** — premature until the
prerequisite wiring gap is addressed. That prerequisite is the more consequential, more general
finding, so it gets its own task rather than expanding this one's scope.

`checkSplitRecommendation`'s `wbsLevel >= 2` guard (landed 2026-08-02) fires ONLY inside the
`split-multi-mechanism` branch. A depth-2+ leaf that triggers `split-subsystem-blocking-cluster`
or `split-touch-set-too-large` still returns those codes, and the orchestrator auto-splits.

**Evidence (telemetry, 232 dispatches):** splits at depth 2 occurred for 8 distinct tasks
(DIR-124-F4/F3/B2/A4/A3/A1, DIR-119-D5/D3) and at depth 3 for 2 (DIR-124-A1b, DIR-124-F3b).
The guard caught 2 of these; the rest predate it or took a non-multi-mechanism path.

**Rationale:** a task that has already survived two rounds of decomposition and STILL triggers any
split signal has an upstream structural defect. The trigger code tells you *which* symptom fired;
it does not change the conclusion that further auto-splitting compounds the problem.

## Chosen mechanism

Hoist the `wbsLevel >= 2` check ABOVE the three trigger branches in `checkSplitRecommendation`.
When depth >= 2 and ANY trigger would fire, return `split-recursive-guard` with the original
trigger's reason text preserved as context.

Ordering matters: the guard must evaluate the triggers first (to know one WOULD fire and to
capture its reason), then override the code. A bare `if (wbsLevel >= 2) return guard` at the top
would fire on every deep task even when no split is warranted.

## Acceptance Criteria

- [x] AC1: depth >= 2 + subsystem-blocking-cluster → `split-recursive-guard` (not cluster)
- [x] AC2: depth >= 2 + touch-set-too-large → `split-recursive-guard`
- [x] AC3: depth >= 2 + multi-mechanism → `split-recursive-guard` (existing behavior preserved)
- [x] AC4: depth >= 2 + NO trigger fires → `recommend: false` (guard does not fire spuriously)
- [x] AC5: depth 0/1 + any trigger → original code unchanged (no regression)
- [x] AC6: guard result carries `repairable: false` and the originating trigger's reason text
- [x] AC7: both mirrors byte-identical; `_splitCheck()` in prepare-milestone.js matches

## Definition of Done

- [ ] `checkSplitRecommendation` in both `proposal-convergence.ts` mirrors implements the hoisted guard
- [ ] `_splitCheck()` in both `prepare-milestone.js` mirrors matches
- [ ] Tests cover AC1-AC5; existing `checkSplitRecommendation` tests still pass
- [ ] `scripts/test.sh` green

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：AC7's carrier prepare-milestone.js physically deleted under ADR-022; guard hoist itself landed (proposal-convergence.ts L226-234, AC1-AC6 tests pass); zero-caller wiring gap tracked separately in gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.）**
全文见 git 历史（`git log -p -- tasks/gap-recursive-guard-only-covers-multi-mechanism.md`）。

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/proposal-convergence.test.mjs
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
