---
id: exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE
title: it0-gate-hash-check.sh --by-reference FAILs on every recent charter
  (M111-M116) — GATE-HASH-REF convention has drifted from the script's actual
  pinned source
status: todo
labels:
  - defect
  - governance-integrity
parent: null
children: []
extra:
  schema: v1
---
## Proposal

`scripts/it0-gate-hash-check.sh --by-reference <charter>` computes its hash from a FIXED pinned
source (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131, currently
sha256 `5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93`). Every charter since M111
instead cites `GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1` — a
value first recorded at M110's commit message ("it0-dod-check.ts self-hosting confirmed... New
GATE-HASH-REF: 22c64fc...") that does NOT derive from the script's own `PINNED_SOURCE`. Running
`it0-gate-hash-check.sh --by-reference` against M111/M112/M113/M114/M115/M116's charters all FAIL
with a hash mismatch — confirmed live at M116's ABSORB (this task's origin). This means the
by-reference gate-hash check has been silently non-functional (or silently not run) for at least 6
consecutive milestones; invariant 3 (gate text transcluded/hash-checked, never paraphrased) has had
no real mechanical backstop for the by-reference form since M110, only the copy-forward convention
of citing the same string.

## Plan
N/A — small milestone: either (a) fix `PINNED_SOURCE`/derive logic in `it0-gate-hash-check.sh` to
match what `22c64fc...` actually hashes (find and document its real source), or (b) if `22c64fc...`
was always a different concept (e.g. it0-dod-check.ts's own self-hash, unrelated to invariant 3's
HARD-GATES-transclusion check), rename/re-scope the charter convention so it doesn't collide with
`it0-gate-hash-check.sh`'s vocabulary, and make charters cite the ACTUAL hash that script expects
(re-run `it0-gate-hash-check.sh` in its hash-print mode against the true current HARD GATES block).

## Acceptance Criteria
- [ ] Root cause identified: what does `22c64fc...` actually hash, and is it the same concept as `it0-gate-hash-check.sh`'s HARD-GATES transclusion check or a different one.
- [ ] `it0-gate-hash-check.sh --by-reference <charter>` PASSes against a real, current charter using the corrected convention.
- [ ] `OUTER-LOOP.md` step 3 / step 4b's by-reference instructions updated if the convention changes.

## Definition of Done
Standard inherited-core DoD clauses.
