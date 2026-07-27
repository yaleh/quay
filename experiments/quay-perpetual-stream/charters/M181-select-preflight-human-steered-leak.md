# M181 — select-preflight shortlist leaks human-steered-excluded candidates (exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK)

**Task:** exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK · **Counter:** 181 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~1.0 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). Live-reproduced 2026-07-27 via a real
`select-preflight.ts` dry-run: `DIR-057`/`DIR-113`/`DIR-114`/`DIR-115`/`DIR-116` (all carrying
`label: human-steered` directly) all report `humanSteered: false` in the candidate list. Root
cause found by reading `select-preflight.ts` (line ~417-418): the autonomous filter is
`candidates.filter((c) => !c.humanSteered)` where `c.humanSteered` comes ONLY from
`human-steered-classify.ts`'s `classify()` — a heuristic that checks touched-driver-files/
mission-redirection/unauthorized-workspace, and (per its own DIR-062-C design comment,
"classifier replaces label:human-steered filter") **deliberately never reads the task's own
`label:human-steered` field at all**. A human's direct label-based exclusion currently does
NOTHING to protect a candidate from autonomous SELECT — contradicting the `quay-directive` skill's
own stated intent ("the label is the safety net"). This is a live, currently-exploitable risk: if
`.halt` were lifted right now, autonomous SELECT could pick DIR-113/DIR-114/DIR-115, each of which
explicitly requires human-steered discipline in its own DoD.

## Scope
Per the task's own Requested action, plus the sharper root cause found above (both are needed —
the task's literal ask covers case 2 below; the classifier-vs-label gap covers case 1, which is
the more urgent, currently-live risk):
1. **Direct-label case (the live risk)**: `select-preflight.ts`'s candidate-building step
   (`buildPreflightResult`, around line 399-418) ORs the classifier result with the task's own
   `labels.includes("human-steered")` when setting `c.humanSteered` — a direct label is an
   additional, independent exclusion signal, never overridden by what the heuristic classifier
   concludes. Does NOT touch `human-steered-classify.ts`'s own `classify()` function or its
   DIR-062-C 3-clause design — this is purely an OR at the point `select-preflight.ts` consumes
   the classifier's result.
2. **Epic-with-human-steered-only-child case**: when building candidates from a compound/epic task
   (`role: compound`, non-empty `children`), if ALL of its currently-open (non-done) children carry
   `humanSteered: true` (label OR classifier, per case 1 above), the epic itself is excluded from
   the autonomous shortlist — it has no autonomous-executable path forward.
3. Fixtures matching the task's own AC: (a) a directly-labeled human-steered task in the raw
   candidate pool → NOT in the autonomous shortlist; (b) an epic with all children done except one
   human-steered child → NOT in the autonomous shortlist.
4. Existing `select-preflight.test.mjs`/selftest suite stays green.

**Out of scope:** any change to `human-steered-classify.ts`'s own 3-clause classify() logic or its
DIR-062-C design rationale — this milestone treats the label as an ADDITIONAL signal, not a
replacement for the classifier.

## Touches
- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/scripts/select-preflight.test.mjs (or equivalent sibling test)

## Done-when
1. A real `select-preflight.ts --json` run against the CURRENT task store no longer surfaces
   DIR-057, DIR-070, DIR-113, DIR-114, DIR-115, or DIR-116 with `humanSteered: false` — all show
   `humanSteered: true` and are excluded from the autonomous shortlist.
2. RED/GREEN fixture pair for the direct-label case (before this fix: a labeled task incorrectly
   shows `humanSteered: false`; after: correctly `true`) — both states shown, not just GREEN.
3. RED/GREEN fixture pair for the epic-with-human-steered-only-child case.
4. Existing select-preflight test suite passes unmodified in count/intent (only the fixtures this
   milestone adds are new).
5. No regression: a genuinely autonomous-eligible candidate (no human-steered label, classifier
   also says false) still appears in the shortlist as before.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
