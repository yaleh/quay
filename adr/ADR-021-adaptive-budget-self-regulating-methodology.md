---
id: ADR-021
title: "Adaptive budget and self-regulating methodology: automation-amplified work
  must be constrained by mechanized budgets no more complex than the mechanisms
  they govern"
status: proposed
date: 2026-08-02
tags:
  - process
  - methodology
  - architecture
applies-to:
  - "experiments/quay-perpetual-stream/OUTER-LOOP.md"
  - ".claude/workflows/prepare-milestone.js"
  - ".claude/workflows/execute-milestone.js"
  - "experiments/quay-perpetual-stream/scripts/proposal-convergence.ts"
  - "CLAUDE.md"
enforcement: |
  Phase 0 — existing mechanical gates only (no new code):
    - checkSplitRecommendation mechanismCount > 2 → split (proposal-convergence.ts:234)
    - nextAction delta cap max 2/3 rounds (proposal-convergence.ts:263)
    - epoch full-review cap max 1 per (taskId, charterHash, reviewPolicyHash)
    - bodyScopeHash scope-change grant for epoch full-review cap
    - split-recursive-guard wbsLevel >= 2 + multi-mechanism → needs-human
    - touches > 8 files → split (proposal-convergence.ts:238)
  Phase 1+ — gated on real calibration data (see Implementation section).
---

## Context

Automation mechanisms (prepare-milestone, ProposalReview, split-recommended) remove
human friction — but also remove the human saturation judgment that says "this is good
enough, ship it." An LLM ProposalReview can always find more wiring claims, more
mechanism boundaries, and more grounding facts. Without a countervailing constraint
mechanism of the same order, work expands nonlinearly.

**Quantified evidence (2026-08-01):**

DIR-124 expanded from 1 root task (168 lines, 15 AC) into a 3-level split tree of 20
tasks (~6,150 lines, ~205 AC): a 20× task-count, 36× line-count, 14× AC-count expansion
from a single original directive. Of the 9 split decisions made that day, only 2 (22%)
were correct by mechanism-count analysis — 4 (44%) were for tasks with ≤2 independently
landable mechanisms that should not have triggered split at all. The remaining 3 were
directionally correct but over-split (6 sub-tasks where 3 would have sufficed).

**Root cause:** the split-decision mechanism's `extractMechanismClaims` over-counted
coverage items (N phase boundaries each counted as N mechanisms rather than 1 mechanism
with N call sites), and the orchestrator's auto-approve policy applied to all split codes
indiscriminately instead of routing `split-subsystem-blocking-cluster` through the
built-in repairable bypass.

The five operational principles that emerged from managing this under load (2026-08-01
orchestrator session, 12:29 UTC) — criticality-before-cap, diagnose-before-reset,
force-commit-as-valid-tool, stop-at-reset-count-not-attempt-count, and cross-task-
fingerprints-as-systemic-signal — are exactly the kind of constraint rules that need to
be mechanized, not left as session-context prose.

## Decision

Adopt a **self-regulating methodology** governed by four principles:

### Principle 1: Meta-mechanisms must be an order of magnitude simpler than the mechanisms they govern

A 42-line `checkSplitRecommendation` governing a 1,700-line `prepare-milestone.js` is a
healthy ratio. A 500-line budget estimator governing the same workflow is not — it would
add maintenance burden disproportionate to its benefit. When calibration is insufficient,
**degrade to defaults** rather than adding features to improve accuracy. A 10% accuracy
gain that costs 100% complexity growth is a net loss.

### Principle 2: Phase 0 — the constraints that already exist — must be used correctly before building anything new

Six mechanical constraints already cover the three dimensions of work expansion:

| Existing constraint | Dimension | Mechanism |
|---|---|---|
| mechanismCount > 2 → split | **Space** — prevent over-broad single tasks | `checkSplitRecommendation` code `split-multi-mechanism` |
| delta round cap (max 2/3) | **Time** — prevent infinite retry loops | `nextAction` in `proposal-convergence.ts:263` |
| epoch full-review cap (max 1) | **Compute** — prevent repeated full reviews of unchanged scope | `checkEpochCaps` in `proposal-convergence.ts` |
| bodyScopeHash scope-change grant | **Adaptive** — automatically grant budget when scope genuinely changes | `checkEpochCaps` scope-change path |
| split-recursive-guard (wbsLevel ≥ 2 + multi-mechanism) | **Depth** — prevent infinite split recursion | `checkSplitRecommendation` code `split-recursive-guard` |
| touches > 8 → split | **Surface** — prevent over-broad file-touch sets | `checkSplitRecommendation` code `split-touch-set-too-large` |

The 2026-08-01 over-split rate was 67% (6/9 unnecessary). If these six constraints had
been correctly applied — routing `split-subsystem-blocking-cluster` through the repairable
bypass rather than auto-splitting, calibrating `extractMechanismClaims` to count
mechanisms not coverage items — the over-split rate would approach 0%. **Phase 0 is both
the current state and the validation gate:** evidence that correct usage of existing
constraints solves the problem must precede building Phase 1.

### Principle 3: Any new budget mechanism must be data-calibrated, not LLM-estimated

When Phase 1 budget enforcement is justified:

1. **Record actual consumption** per milestone (tokens, wall-clock, code insertions) as
   a non-blocking side effect of existing telemetry dispatch.
2. **Calibrate baselines from real data** — a deterministic script that computes
   percentile distributions from historical records, never an LLM agent.
3. **Enforce budgets by table lookup** — query the baseline for the task's mechanism
   count and touch-set size, apply the p75 token value as a soft cap and p90 as a hard
   cap.
4. **On breach: needs-human, never auto-split.** Budget exhaustion means the resource/
   outcome ratio has departed from historical norms — human judgment is required.

The budget baseline table is the **termination of the meta-recursion**: it is pure data,
computed deterministically from telemetry, requiring zero LLM involvement. There is no
"budget system for the budget system" — the baseline table is the bottom layer.

### Principle 4: The orchestrator's split-routing policy must differentiate by code

As documented in CLAUDE.md (2026-08-01), the orchestrator MUST NOT auto-approve all
split recommendations uniformly:

| Split code | Orchestrator action | Rationale |
|---|---|---|
| `split-multi-mechanism` | Auto-record split + create children | Not repairable — >2 independently landable mechanisms |
| `split-touch-set-too-large` | Auto-record split + narrow touches | Not repairable — surface too broad |
| `split-subsystem-blocking-cluster` | **Consume repairable bypass first**, split only on bypass failure | Repairable — one focused delta revision may close ALL findings |
| `split-recursive-guard` | Route to needs-human — do NOT auto-split | Level-2+ leaf still multi-mechanism — upstream decomposition defect |

Additionally, after recording a split decision, the orchestrator MUST verify the split is
enacted (child task `.md` files exist on disk, `children:` frontmatter is populated, each
child has `status: todo` + `parent:` backlink). An incomplete split leaves the task in an
un-actionable limbo state.

## Consequences

- **Positive:** The six Phase 0 constraints, correctly applied, eliminate the over-split
  pattern observed on 2026-08-01 without requiring new code. The split-routing policy
  prevents the orchestrator from skipping the repairable bypass. The depth guard
  (`split-recursive-guard`) prevents infinite split recursion. Force-commit with a
  durable reason record provides a valid escape for non-critical blockers.

- **Negative:** The methodology now carries an explicit obligation to use its own
  constraints correctly — misuse (e.g., auto-approving all splits) is a process
  violation, not a mechanism defect. The orchestrator role requires awareness of the
  four-code routing table. The `extractMechanismClaims` calibration issue (coverage
  items counted as mechanisms) is documented but not yet fixed — it remains a known
  source of false `split-multi-mechanism` signals.

- **Self-referential constraint:** This ADR itself describes a meta-mechanism (budget and
  self-regulation). Per Principle 1, it must remain simpler than the mechanisms it
  governs. Its enforcement is Phase 0 only — adding a new mechanical gate to enforce
  budget compliance would violate the principle unless real calibration data first
  proves Phase 0 insufficient.

## Implementation

### Phase 0 (current — no new code)

The six mechanical constraints listed in Principle 2 are already implemented and active.
The orchestrator's split-routing policy is documented in CLAUDE.md (2026-08-01). The
`split-recursive-guard` code (`wbsLevel` guard in `checkSplitRecommendation`) and the
`bodyScopeHash` scope-change grant are implemented and tested. **Phase 0 is complete.**

The remaining Phase 0 action item is **calibration, not construction**: fix
`extractMechanismClaims` to merge coverage-pattern claims (same mechanism repeated at N
call sites → count as 1 mechanism, not N). This is a calibration adjustment to an
existing function, not a new mechanism.

### Phase 1 (gated — requires ≥20 real milestone budget records)

When enough telemetry data exists to compute meaningful baselines:

1. Extend telemetry records with `prepareTokensSpent`, `executeTokensSpent`,
   `prepareWallClockMs`, `codeInsertions`, `codeDeletions`, `filesChanged` —
   non-blocking additive fields (M207 precedent: `TELEMETRY_SCHEMA_VERSION` stays at 2).
2. Add `scripts/budget-calibrate.ts`: a deterministic, non-LLM script that reads
   `milestones/prepare-telemetry/` records, groups by mechanism count and class, and
   emits a versioned baseline JSON file (`scripts/budget-baselines.json`).
3. In `prepare-milestone.js` Admission phase: when mechanism count ≤ 2 and baseline data
   exists for that category, query the baseline and set `task.extra.budget` with the p75
   value as soft cap and p90 as hard cap.
4. In the ProposalReview convergence loop: check `_checkBudget()` before each delta
   round. Soft cap exceeded → WARN. Hard cap exceeded → `stop-needs-human` with
   `reason: budget-exceeded`.

**Gating criterion:** Phase 1 code is NOT written until (a) ≥20 real milestone budget
records exist, (b) the p75/p90 values are stable (consecutive 5-milestone sliding windows
differ by <20%), and (c) at least one real case of budget-exceeded-without-Phase 0-escaping
has been observed.

### Phase 2 (gated — requires ≥50 real milestone budget records)

When baselines are stable and Phase 1 has caught ≥3 real budget-exceeded cases:

1. Add budget estimation to ProposalAuthors prompts (inject baseline data for the task's
   mechanism count).
2. Add budget-vs-actual comparison to Land-phase dashboard entries.
3. Consider auto-escalation policies (e.g., high-risk tasks get p90 baseline by default).

### Non-implementation: what this ADR deliberately does NOT build

- **No LLM-based budget estimation.** Lookup from a deterministic baseline table, never
  an agent guessing token counts from proposal prose.
- **No automatic budget reallocation.** Budget exhaustion → needs-human. No automatic
  cross-task budget transfer, no priority-based budget bump.
- **No meta-budget system.** The baseline table is pure data. There is no "budget for
  the budget calibrator."
- **No Phase 1 code until Phase 0 is proven insufficient.** The calibration data must
  demonstrate that the six existing constraints, correctly applied, still leave a
  meaningful budget problem. Building Phase 1 before this evidence exists violates
  Principle 1.

## References

- [[ADR-014]] (split-or-commit — the parent-done-iff-children rule that the split
  completion verification extends)
- [[ADR-020]] (ground-truth registry — the budget baseline table follows the same
  versioned, hash-bound, non-LLM-deterministic-data pattern)
- `docs/analysis/split-correctness-review.md` (2026-08-01 — per-task mechanism-count
  analysis of the 9 split decisions)
- `docs/analysis/task-granularity-code-evidence.md` (2026-08-01 — 64-commit fast-flow
  empirical evidence on natural task granularity)
- `docs/analysis/split-decision-mechanism-review.md` (2026-08-01 — code-level review of
  `checkSplitRecommendation` and the orchestrator's auto-approve policy)
- `docs/proposals/adaptive-budget-and-self-regulating-methodology.md` (2026-08-01 —
  full proposal text including the Phase 0/1/2/3 roadmap and the meta-recursion
  termination argument)
- `CLAUDE.md` Split-decision routing policy section (2026-08-01)
