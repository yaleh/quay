# M178 — Pre-screen task-level `## Touches` orthogonality before charter-authoring (DIR-113)

**Task:** DIR-113 · **Counter:** 178 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~1.1 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral — efficiency, not correctness; not urgent per the
directive's own priority ranking). The concurrent-batch-scheduler's `checkTouchesPair` orthogonality
check is a near-zero-cost pure function, but it currently only runs AFTER charter-authoring (an
expensive LLM/fork call) writes each candidate's `## Touches` — the cheap check runs after the
expensive one. Real case (M173, 2026-07-26): SELECT preflight shortlisted 3 candidates, spent 5m2s
authoring 3 charters, only THEN discovered DIR-110 depends on DIR-109's own not-yet-existing
`scripts/test.sh` — narrowing to 1-wide after paying for 3. `.quay/loop.yml`'s `concurrency: 4` has
been live since M167/DIR-107 but never actually produced a ≥2-wide batch through M173 (7 milestones
of dead capacity).

## Scope
Per DIR-113's Requested action (all 5 items, full scope — this is the largest of the 5
human-steered milestones this session):
1. New heuristic extraction script `experiments/quay-perpetual-stream/scripts/
   derive-touches-heuristic.ts`: when a milestone-candidate task body lacks `## Touches`, regex-scan
   `## Requested action`/`## Acceptance Criteria` for file-path-shaped tokens and generate an
   "auto-derived, unverified" `## Touches` section.
2. A soft (warn, non-blocking) check in the milestone-candidate schema check
   (`task-schema-check.ts`/`.sh`) flagging a milestone-candidate with neither a manual nor
   auto-derived `## Touches`.
3. `select-preflight.ts`'s shortlist-assembly step gains a pre-charter orthogonality pass: run the
   existing `checkTouchesPair` pairwise over the shortlist's task-level Touches (manual first,
   auto-derived fallback) BEFORE dispatching any charter-authoring fork. Result (orthogonal pair
   found, or none found in top-N) must be explicitly logged either way — never silent.
4. Backfill real (human/LLM-reviewed, not raw auto-derived) `## Touches` on the 11 current
   autonomous-eligible candidates: DIR-099/100/101/103/104/105/109/110/111/112,
   exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN — reusing the format DIR-070-F/DIR-073 already
   established.
5. `anti-drift-touches-check.ts` (the PRE-MERGE authoritative gate) is untouched — task-level
   Touches is a scheduling-time hint, never a substitute for that gate.

**Out of scope:** any change to `anti-drift-touches-check.ts` itself, to the concurrent-batch
architecture (DIR-106/107), or to `checkTouchesPair`'s own logic.

## Touches
- experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts (new)
- experiments/quay-perpetual-stream/scripts/derive-touches-heuristic-selfcheck.sh (new, sibling
  test, following this directory's existing `<name>-selfcheck.sh` convention)
- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/scripts/task-schema-check.ts
- experiments/quay-perpetual-stream/scripts/task-schema-check.sh
- tasks/DIR-099.md
- tasks/DIR-100.md
- tasks/DIR-101.md
- tasks/DIR-103.md
- tasks/DIR-104.md
- tasks/DIR-105.md
- tasks/DIR-109.md
- tasks/DIR-110.md
- tasks/DIR-111.md
- tasks/DIR-112.md
- tasks/exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN.md

## Done-when
1. `derive-touches-heuristic.ts` exists with a sibling selfcheck achieving ≥80% coverage of its own
   logic; fed DIR-109's pre-charter task body, its extraction is a superset of (or equal to) the
   Touches list DIR-109's own charter actually landed with.
2. `select-preflight.ts`'s shortlist assembly logs an explicit "orthogonal pair found" record
   BEFORE any charter-authoring fork is dispatched, demonstrated on a shortlist with ≥2
   non-overlapping-Touches candidates (real or golden-replay).
3. All 11 named candidates carry real `## Touches` (`grep -l '^## Touches' tasks/DIR-{099,100,101,
   103,104,105,109,110,111,112}.md tasks/exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN.md | wc -l` →
   11), each reviewed against its own Requested action, not raw auto-derived output.
4. A golden-replay of M173's actual SELECT (DIR-070/DIR-109/DIR-110 candidate set) using the
   backfilled Touches reproduces the same real 1-wide outcome — proves this only moves the
   judgment earlier, doesn't silently change scheduling results.
5. `anti-drift-touches-check.ts`'s existing test suite passes unmodified — the authoritative gate is
   untouched by this change.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
