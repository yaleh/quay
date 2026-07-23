# Charter M126-productized-delivery-a-version-consistency — Productized delivery child A: version single-source + fail-closed drift gate

**Milestone id:** M126
**Task:** `tasks/exp5-M-PRODUCTIZED-DELIVERY-A.md`
**Surface:** development-class / capability-growth (chart-2 S2 Delivery-completeness, weight 30, cov=0.00)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`181696d`, DIR-066 land)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-061 (complete productized delivery) recorded a real 5-way version drift for the plugin across the
installed cache, `plugin/.claude-plugin/plugin.json`, both `marketplace.json` files, and
`plugin/vendor/quay/package.json` (5 different version strings observed live against archguard). This
directive was SPLIT (DIR-026 SPLIT-OR-COMMIT) into `exp5-M-PRODUCTIZED-DELIVERY-A/B/C/D`; this milestone
is child A — establish ONE version single-source and a fail-closed drift check. Child A has no upstream
dependency (child B depends on it; C/D are further downstream, human-steered).

**SELECT — first real exercise of the DIR-066 Round-1 deliverable governor** (see
`scripts/deliverable-governor.ts`, task DIR-066/DIR-066-A/DIR-066-B): incoming streak=2 (carried from
M125's `deliverable:no` DIR-062-A pick), floor=min(1,2/6)=0.333, sMax=4 → dSeats=1, nSeats=3 (seat count
capped by availability). Autonomous-selectable candidate pool this pass (human-steered already excluded;
DIR-062-C excluded — depends on not-yet-done DIR-062-B; `exp5-M-PRODUCTIZED-DELIVERY-B` excluded — depends
on not-yet-done -A; `exp5-M-CLI-UX`/`-DIRTASK`/`-DOCS` excluded — STALE per their own task text; epic
parents `exp5-M-CRYST`/`exp5-M-PRODUCTIZED-DELIVERY` excluded — not directly selectable):

```
candidates: exp5-M-PRODUCTIZED-DELIVERY-A(deliverable=yes,rank=1), exp5-M-CRYST-D2(deliverable=yes,rank=2),
            DIR-063-A(deliverable=no,rank=1)
composeShortlist({candidates, streak:2, sMax:4}) →
  floor=0.3333, nSeats=3, dSeats=1
  shortlist (S=2): [exp5-M-PRODUCTIZED-DELIVERY-A, DIR-063-A]
  starvation=false
```
Round 2 (VT Δv̂ + value-typed ledger + governance/infra hard floor, UNCHANGED by the governor) picked
`exp5-M-PRODUCTIZED-DELIVERY-A` from this shortlist: it is a direct chart-2 **S2** mover (currently
cov=0.00/30 — the single largest unscored surface in chart-2), DIR-004-distribution-urgent-adjacent, and
unblocks two dependent children (-B manifest, -C real release). `exp5-M-CRYST-D2` (also `deliverable:yes`,
lower rank) received a `## Not selected (M126)` note; `DIR-063-A` (the N-seat occupant) likewise. Winner
labeled `milestone:M-126`. This SELECT record is ALSO the real-landing evidence DIR-066-B's own DoD escrow
condition (a) requires ("a REAL milestone's SELECT used the governor").

## Scope

1. A version-consistency check script (`scripts/version-consistency-check.*` or similar, under
   `packages/` or a repo-root `scripts/` location — implementer's choice, but SINGLE-SOURCED) that
   enumerates EVERY version-bearing artifact: `packages/quay/package.json`,
   `packages/quay-native/package.json`, `packages/quay-github/package.json`,
   `packages/quay-backlog/package.json`, `plugin/.claude-plugin/plugin.json`,
   `plugin/.claude-plugin/marketplace.json`, root `.claude-plugin/marketplace.json`'s quay-plugin entry,
   `plugin/vendor/quay/package.json` (≥5 per DIR-061's recorded drift inventory — implementer pastes the
   full enumerated list per the task's own AC).
2. FAILs closed (non-zero exit) the moment ANY two entries disagree; PASSes (exit 0) only when every
   entry carries the identical version string.
3. RED demonstration: intentionally drift one entry, show non-zero exit; GREEN: unify, show exit 0 on
   the REAL tree (not a fixture copy).
4. Sibling `*.test.mjs` at ≥80% coverage; `loadbearing-test-gate.sh` PASS.

**Not in scope:** the delivery-manifest (child B), the real release run (child C, human-steered), the
foreign-workspace install proof (child D, human-steered). This child does NOT need to actually UNIFY the
real repo's current versions permanently as its final state beyond what's needed for the GREEN
demonstration — but per DIR-026 Reading A ("done ONLY when a real drift was actually CAUGHT and a real
unification actually PASSED on this repo's real tree"), the GREEN run must be against the real tree, and
the natural, expected outcome is that the real tree ends the milestone version-unified (leaving it
re-drifted after demonstrating GREEN would not satisfy the DoD's "real unification actually PASSED").

## Class routing

**Development-class** (new load-bearing script + tests; touches package.json/plugin manifest version
fields — real product/config surface, not driver files). Per OUTER-LOOP 5a, development-class milestones
run the `quay-task-to-plan` pipeline first UNLESS the design surface is small/fixed — this task's own
`## Plan` states "N/A — focused milestone... design surface... is small and fixed by DIR-061's recorded
drift inventory," matching the halt-free-child precedent (DIR-064-A, DIR-062-A) that dispatched directly
without the pipeline. Direct dispatch to `baime:iteration-executor`.

## Acceptance Criteria (from task)

- [ ] A version-consistency check script exists, enumerates EVERY version-bearing file (the ≥5 in
  DIR-061's drift inventory — list pasted), and reads each one's version.
- [ ] RED: with one manifest intentionally drifted, the check exits non-zero — pasted.
- [ ] GREEN: with all unified to one version, the check exits zero on the real tree — pasted.
- [ ] Sibling `*.test.mjs` ≥80% coverage; `loadbearing-test-gate.sh` PASS.
- [ ] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`
  stays green.

## Definition of Done

- [ ] RED+GREEN demonstrated on the real tree (not fixture-only).
- [ ] The check is a load-bearing script with a passing sibling test (≥80%).
- [ ] it0 DoD meta-enforcer passes all clauses.
- [ ] No driver file touched (`git show --stat` confined to `packages/`/`plugin/`/`scripts/` + tests).

## it0 systematic-explore checks (pre-dispatch)

- **(a) ceiling/floor arithmetic:** N/A — this candidate is task-canonical-sourced (DIR-028), not cited
  from `experiments/quay-continuous-bootstrap/gap-list.md`; `it0-ceiling-check.sh` targets that legacy
  file and does not apply to task-sourced milestone-candidates (same N/A basis as M116-M125's charters,
  none of which invoke it either).
- **(b) gate-hash/transclusion:** see GATE-HASH-REF below — freshly re-derived against current pinned
  source, PASS (not the stale-hash drift M116-M124 tracked as `exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`).
- **(c) dogfooding evidence-gate:** applied to the inner iteration's report once produced (ABSORB step).
- **(d) domain-misfit audit-channel:** the audit channel is direct and mechanical (RED/GREEN exit codes on
  a real script against a real tree) — no domain-misfit risk; a fresh-context auditor can independently
  re-run both the check and the test suite.
- **(e) plan-time line-budget gate:** this charter is well under the ~2000-line ceiling (single-file
  script + test, no phase/stage plan needed) — see line-budget check output below.

## GATE-HASH-REF

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93
