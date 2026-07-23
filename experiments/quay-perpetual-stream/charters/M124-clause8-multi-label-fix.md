# Charter M124-clause8-multi-label-fix — clause8 multi-label first-match-wins fix

**Milestone id:** M124
**Task:** `tasks/exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH.md`
**Surface:** development-class / governance-integrity, instrument-correction
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`f2c08a7`, M123's ABSORB commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Found by the M119 adversarial audit: `it0-dod-check.ts`'s clause8 label scan (`taskText.match(/milestone:M-?(\d+)/i)`,
no `/g` flag) returns only the FIRST `milestone:M<N>` match in file order. 3 real, `status: done`
tasks (`exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`, `exp5-M-GATE-MCP-PARITY-GAP`) each
carry an early low-numbered discovery label (`milestone:M37-discover-post-qeng`, added before the
task was actually scoped) plus a real, later, higher-numbered landing label (`M51`/`M53`/`M56`) — the
first-match-wins scan resolves to 37, below the `CLAUSE8_CUTOVER_MILESTONE_NUM = 40` cutover, so
clause8 incorrectly N/A-passes all 3 tasks despite their real landing milestone being well past it.
Deferred at M121/M122/M123's SELECT (each picked a higher-priority candidate) — clearing it now.

## Scope

Change the label scan to consider ALL `milestone:M<N>` matches (via `matchAll` with the `/g` flag) and
take the MAXIMUM matched number — a task only ever gains higher-numbered labels over time as it's
re-selected/re-scoped, never a lower one after landing, so the max is the real/final landing label.

Verify: the 3 named real tasks now show `taskMilestoneNum` = 56/51/53 respectively (clause8 genuinely
applying, not N/A); `dod-fixture-selfcheck.sh` stays 17/17 golden-diff unchanged; 3 new fixture tests
added (low-then-high order, high-then-low order, all-below-cutover) to `it0-dod-check.test.mjs`.

**Not in scope:** any change to clause8's cutover logic itself (the `N >= 40` threshold, what it
checks once applying) — only the label-matching/selection logic.

## Class routing

**Development-class** (a small, mechanical source fix to a method-infra script, established
golden-diff fixture verify pattern). No `quay-task-to-plan` pipeline required — mirrors the
M99/M116/M119/M121/M122's sizing precedent for small bounded defect fixes.

## Acceptance Criteria (from task)

- [ ] Clause8's label scan considers all `milestone:M<N>` labels present in a task's text, not just the first.
- [ ] `exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`, `exp5-M-GATE-MCP-PARITY-GAP` each show clause8 genuinely APPLYING (not N/A) when re-run — pasted output for all 3.
- [ ] `dod-fixture-selfcheck.sh` still passes (golden-diff evidence); a new fixture pair (multi-label task, low-then-high vs high-then-low label order) added to cover this case going forward.
- [ ] No other clause's verdict changes as a side effect.

## Definition of Done

- [ ] All 4 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116-M123 —
`exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)
