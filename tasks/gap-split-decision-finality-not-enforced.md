---
id: gap-split-decision-finality-not-enforced
title: "Split decisions are not final: 15 redundant dispatches re-ran
  prepare-milestone on tasks already ruled SPLIT"
status: ready
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
