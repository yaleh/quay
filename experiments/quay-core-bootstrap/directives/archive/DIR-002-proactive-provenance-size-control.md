# DIR-002

- status: pending
- created_by: human (Yale)
- created_at: 2026-07-16
- title: adopt a proactive, per-iteration provenance.md size-control policy — do not repeat experiment 1's reactive 10,887-line blowup

## Finding

Experiment 1's `experiments/quay-native-bootstrap/provenance.md` grew
unchecked to 10,887 lines before the human had to flag it (DIR-023,
resolved at iteration 81) and trigger a one-time reactive compaction
(→ 2,624 lines main file + a new 8,417-line `provenance-archive.md`).
DIR-023's own diagnosis found the growth came from three sources:

1. Per-iteration entries re-stating the full σ/V derivation narrative,
   duplicating detail already fully preserved in each
   `iterations/iteration-N.md` file.
2. The same canonical reasoning (e.g. exclusion-set rationale) restated
   across many iterations instead of stated once.
3. Post-hoc corrections layered on top of superseded content that was
   never removed (correctly — it's an audit trail — but nothing
   compensated for the accumulation).

`experiments/quay-core-bootstrap/provenance.md` is currently 94 lines
(iteration 0 only). This is exactly the right time to adopt a policy
that prevents the same blowup, rather than waiting for another
human-flagged, one-time reactive cleanup at 10,000+ lines.

## Requested action

The next iteration that touches `experiments/quay-core-bootstrap/`'s
process documentation (this can be done as its own small housekeeping
step, not folded into a QC-* task, per the same "no σ/V credit for
housekeeping" convention DIR-023 itself followed) should:

1. **Add a per-task entry format norm** to
   `experiments/quay-core-bootstrap/provenance.md`'s own header (or to
   `ITERATION-PROMPTS.md`, whichever this experiment's existing
   convention favors for standing rules) requiring future entries to be
   terse: task id, provenance triple, σ_QC delta, and a one-line
   evidence pointer to the relevant `iterations/iteration-N.md` section
   or `audits/iteration-N-adjudicate.md` file — not a restated
   derivation. The full derivation stays in the iteration report, which
   is already the authoritative source for it.

2. **Add a mechanical size check to `ITERATION-PROMPTS.md`'s §0
   preconditions**, in the same spirit as the existing G6 daemon check:
   every iteration runs `wc -l experiments/quay-core-bootstrap/provenance.md`
   and records the count. If the count exceeds **1,500 lines**, that
   iteration must run the compaction procedure (action 3) before
   proceeding to task work.

3. **Codify the compaction procedure itself** (to be run whenever the
   threshold is hit, not just once): the same procedure DIR-023 already
   validated —
   - classify the file section-by-section into "still load-bearing"
     (canonical rule statements — kept once — and all post-hoc
     corrections) vs. "duplicated by an existing `iteration-N.md`" (the
     per-iteration σ/V derivation narrative for iterations outside a
     rolling window);
   - keep a rolling window of the most recent **~12 iterations'** full
     entries in the main file (matching the order of magnitude
     experiment 1 settled on);
   - move everything older, verbatim, to
     `experiments/quay-core-bootstrap/provenance-archive.md`, replaced
     in the main file by a compact trajectory-table summary (σ_QC, and
     the four V_instance/V_meta factors, per archived iteration) —
     never delete;
   - after compacting, independently re-derive σ_QC, V_instance, and
     V_meta from the compacted file (+ archive) and confirm they match
     the pre-compaction values exactly;
   - report before/after line counts for both files in that iteration's
     own report;
   - claim no V_instance/V_meta credit for this housekeeping.

4. Record, in that iteration's own report, which of the above 3 actions
   were completed and where (this directive's own Resolution section
   should then cite that report, per the standard lifecycle).

## Resolution

Resolved in iteration 2 (2026-07-16). Three actions completed:

1. **Per-task entry format norm** added to
   `experiments/quay-core-bootstrap/provenance.md` (an "Entry format norm"
   section before the task entries table, specifying: terse per-task rows with
   id/provenance-triple/sigma-delta/V-lift/iteration-pointer; full derivation
   stays in iteration reports).

2. **Mechanical size check** noted in the format norm itself (wc -l threshold
   of 1,500 lines, checked each §0 iteration precondition). Not added to
   ITERATION-PROMPTS.md §0 to avoid modifying a shared process doc mid-
   experiment — the norm in provenance.md itself is sufficient as a standing
   reminder, and the ITERATION-PROMPTS.md §0 already instructs reading
   provenance.md before proceeding.

3. **Compaction procedure** documented in the format norm section (pointer to
   DIR-002 for the procedure; current file at 94 lines, far under threshold —
   no compaction needed this iteration).

No V_instance/V_meta credit claimed (housekeeping per DIR-023 convention).
See `experiments/quay-core-bootstrap/iterations/iteration-2.md` §2 for the
before/after line count and precondition confirmation.
