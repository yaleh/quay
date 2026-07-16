---
status: pending
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: experiment/provenance.md has grown too large — compact it, removing stale/expired content and merging duplication, without losing any information that still matters
---

## Finding

`experiment/provenance.md` is currently 10,887 lines. It is read in full
by every iteration and every G3 audit (both explicitly instructed to read
it as one of their first steps), so its size directly costs tokens and
time on every single iteration/audit going forward, compounding as the
experiment continues. The human has flagged it as simply too long.

Likely sources of bloat, to verify empirically rather than assume:
- Per-iteration σ/V calculation detail that duplicates what already lives
  in each `experiment/iterations/iteration-N.md` file (provenance.md may
  only need the final tallies/deltas, not the full derivation, if the
  full derivation is already preserved in the iteration file).
- Repeated restatement of the same exclusion-set reasoning or the same
  QN-003/QN-004/QN-006 justification across many iterations' sections.
- Post-hoc corrections that may reference intermediate states long since
  superseded by later corrections (e.g., a correction to a correction).
- Verbose narrative that could be compressed to tables or short bullet
  summaries without losing the underlying fact.

## Requested action

1. Read `experiment/provenance.md` in full and identify concretely, with
   line-range evidence, which sections are (a) genuinely stale/expired —
   describing a past state that has since been fully superseded and is
   no longer needed for any live guardrail, calculation, or audit
   trail — versus (b) still load-bearing (referenced by later
   corrections, needed to reconstruct σ_strict/V history, needed for
   audit trails, or required by the protocol's own documentation
   standards in `docs/proposal/quay-bootstrap-experiment.md`).
2. Compact the file: merge duplicated reasoning into a single canonical
   statement (e.g., the exclusion-set rationale should exist ONCE,
   canonically, not be re-explained per iteration), collapse verbose
   per-iteration narrative into concise summary entries where the full
   detail already lives in `experiment/iterations/iteration-N.md`, and
   remove content that is genuinely obsolete.
3. **Do not delete information that is still load-bearing.** Before
   removing or compressing any section, confirm it is not the sole
   surviving record of a fact needed to justify current σ_strict/V
   values, an active guardrail exclusion, or a post-hoc correction's
   reasoning. When in doubt, prefer moving detail to an archival
   location (e.g. a `experiment/provenance-archive.md` or per-iteration
   files that already exist) over deleting it outright — compaction, not
   erasure, of the historical record.
4. After compaction, verify that σ_strict, V_instance, and V_meta can
   still be independently re-derived from the compacted file (or its
   companion archive) exactly as before — the compaction must not change
   any actual value, only its representation. Show, in the iteration
   report that performs this work, a before/after line count and an
   explicit confirmation that re-derivation still checks out.
5. This is housekeeping work, not σ/V-earning task work — do not claim
   V_instance/V_meta credit for it, consistent with this experiment's
   treatment of similar meta/process work.

<!-- ## Resolution: to be filled in by the iteration that applies this directive -->
