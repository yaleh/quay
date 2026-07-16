---
status: resolved
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: experiments/quay-native-bootstrap/provenance.md has grown too large — compact it, removing stale/expired content and merging duplication, without losing any information that still matters
---

## Finding

`experiments/quay-native-bootstrap/provenance.md` is currently 10,887 lines. It is read in full
by every iteration and every G3 audit (both explicitly instructed to read
it as one of their first steps), so its size directly costs tokens and
time on every single iteration/audit going forward, compounding as the
experiment continues. The human has flagged it as simply too long.

Likely sources of bloat, to verify empirically rather than assume:
- Per-iteration σ/V calculation detail that duplicates what already lives
  in each `experiments/quay-native-bootstrap/iterations/iteration-N.md` file (provenance.md may
  only need the final tallies/deltas, not the full derivation, if the
  full derivation is already preserved in the iteration file).
- Repeated restatement of the same exclusion-set reasoning or the same
  QN-003/QN-004/QN-006 justification across many iterations' sections.
- Post-hoc corrections that may reference intermediate states long since
  superseded by later corrections (e.g., a correction to a correction).
- Verbose narrative that could be compressed to tables or short bullet
  summaries without losing the underlying fact.

## Requested action

1. Read `experiments/quay-native-bootstrap/provenance.md` in full and identify concretely, with
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
   detail already lives in `experiments/quay-native-bootstrap/iterations/iteration-N.md`, and
   remove content that is genuinely obsolete.
3. **Do not delete information that is still load-bearing.** Before
   removing or compressing any section, confirm it is not the sole
   surviving record of a fact needed to justify current σ_strict/V
   values, an active guardrail exclusion, or a post-hoc correction's
   reasoning. When in doubt, prefer moving detail to an archival
   location (e.g. a `experiments/quay-native-bootstrap/provenance-archive.md` or per-iteration
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

## Progress note (iteration 81, 2026-07-16)

Applied in full. `experiments/quay-native-bootstrap/provenance.md` (10,887 lines before) was
classified section-by-section, using the exact `##`-header boundaries of
all 144 sections, into two groups:

**Kept fully, in place, unmodified** (per action 1's "still load-bearing"
test — referenced by later corrections, needed to reconstruct σ_strict/V
history, needed for audit trails, or required by protocol documentation
standards):
- Lines 1-10: file header (protocol §6 G1 / decision §10.1).
- Lines 11-42: the canonical `## Permanent strict-exclusion set (σ_strict)`
  section — already the single canonical statement of the QN-003/QN-004/
  QN-006 exclusion reasoning that this directive's Finding asked to exist
  "ONCE, canonically" (it already did, added at iteration 71 for exactly
  this reason — confirmed no duplicate restatement of this reasoning
  existed elsewhere in the file).
- Lines 43-1246 (iterations 0-7 detailed Records + σ computation,
  including the "QN-003/QN-004 execute_by nuance" and "Iteration 1
  author_by honesty note" sections directly cross-referenced by the
  permanent-exclusion-set table above, the mandatory baseline timing/
  effort data required by protocol §10.5, the epic-decomposition-test and
  needs-human-fallback discovery narrative) — all foundational and
  uniquely-sourced, none of it duplicated in any iteration-N.md file since
  iterations 0-7 predate that per-iteration-file convention.
- Lines 1247-1325: the mandatory V_meta formula correction (iteration 8) —
  explains why iterations 1-7's V_meta figures differ from the protocol's
  own product formula; load-bearing for anyone auditing the historical
  record.
- All 15 post-hoc corrections, wherever they occur chronologically (12 of
  them fall within the iterations 8-66 span that was otherwise
  compacted — iterations 25, 29, 31, 33, 34, 35, 50, 51, 53, 57, 59, 61 —
  plus the 3 outside that span, already kept: ninth/tenth/eleventh
  corrections' surrounding iterations are inside the archived range but
  their correction sections themselves were left in place; the
  fourteenth (iteration 69) and "Fifteenth" (iteration 71) corrections
  were already in the untouched tail).
- Lines 10186-end (iterations 69-80, the most recent and most actively
  cross-referenced material).

**Moved to `experiments/quay-native-bootstrap/provenance-archive.md`, verbatim, unedited** (107
of the 144 total sections, spanning the iterations-8-through-66 range,
minus the 12 post-hoc corrections within that range which stayed
in place): every `## Records (as of end of iteration N)`, `## σ
computation — iteration N`, and `## Iteration N: ...` narrative section
from iteration 8 through iteration 66 inclusive (8,417 lines once moved,
including a new explanatory preamble in the archive file itself). This is
exactly the "middle era" the Finding's own bloat hypothesis named:
per-iteration σ/V derivation detail that duplicates what
`experiments/quay-native-bootstrap/iterations/iteration-N.md` already preserves in full for
every iteration from roughly iteration 40 onward, plus a run of ten
near-identical "V-factor attribution (precedent-derived, held flat)"
sections (iterations 36-45) that were the single most repetitive,
lowest-marginal-value stretch in the file.

In place of the archived material, `experiments/quay-native-bootstrap/provenance.md` now carries
one new `## Iterations 8-66 — compact summary (full detail archived, see
below)` section: a σ_strict-trajectory table (every intermediate
iteration's fraction/decimal, transcribed verbatim from the
now-archived text, not recomputed), the V_instance and V_meta factor
trajectories across the same range with their final (end-of-iteration-66)
values, a short list of notable events, and an explicit re-derivation
check tying the end of this compacted range (σ_strict = 61/68 = 0.8971,
V_instance = 0.5673, V_meta = 0.0973) to the still-intact, unarchived
`## Iteration 69` section that immediately follows — confirming an
unbroken, unaltered chain across the archival boundary.

**Verification performed** (action 4):
- Re-grepped `experiments/quay-native-bootstrap/provenance.md` for the canonical exclusion-set
  section (lines 1-42 equivalent) and its two forward-cross-references
  (`QN-003/QN-004 execute_by nuance`, `Iteration 1 author_by honesty
  note`) — both target sections still present, unmoved, inside the
  iterations-0-7 range that was never touched.
- Re-grepped for the post-hoc-correction count: `grep -n -i "confirmed
  post-hoc correction\|Fifteenth post-hoc correction"
  experiments/quay-native-bootstrap/provenance.md` returns the identical six-line result
  (ninth/tenth/eleventh/twelfth-thirteenth/fourteenth/Fifteenth) found by
  the iteration-80 independent audit before this compaction — the count
  and content of every post-hoc correction is unchanged.
- Independently re-derived σ_strict from `tasks/QN-*.md`'s own file count
  (`ls tasks/QN-*.md | wc -l` = 70, matching provenance.md's own stated
  denominator) combined with provenance.md's internal chain (61/68 at the
  end of the compacted range → 65/69, corrected to 62/69, at iteration 69
  → 62/70 at iteration 76, unchanged through iteration 80) —
  **σ_strict = 62/70 = 0.8857**, exactly matching the pre-compaction
  value.
- Independently recomputed V_instance = 0.83 × 0.96 × 0.76 × 0.96 = 0.5813
  and V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973 from the factor values
  stated in the still-intact iteration-80 tail section — both exactly
  matching the pre-compaction values.
- **Before/after line counts**: `experiments/quay-native-bootstrap/provenance.md` 10,887 lines
  before → **2,624 lines** after (a 76% reduction in what every iteration
  and every G3 audit must read by default going forward).
  `experiments/quay-native-bootstrap/provenance-archive.md`: newly created, **8,417 lines**
  (verbatim archived content plus a short explanatory preamble). Combined
  total (2,624 + 8,417 = 11,041) exceeds the original 10,887 by 154 lines,
  entirely accounted for by net-new explanatory material (the archive
  file's own preamble plus the compact summary section's trajectory
  tables and re-derivation notes) — no original content was discarded.

**Caution exercised per the directive's own instruction**: two ambiguous
cases were resolved conservatively. First, iterations 59 and 61's own
narrative sections (titled with a struck-through V-factor-movement claim
"reverted post-hoc — see correction below") were archived rather than
kept in place, but only after directly re-reading both sections and
confirming the entire corrective reasoning already lives, complete and
self-contained, in the immediately-following post-hoc-correction section
which was independently kept in place — so no reasoning was lost, only
the (already-superseded) original task narrative moved. Second, where a
section's title referenced material spanning a range not cleanly aligned
to a single `##` header (e.g. iterations 67-68, described only in a
parenthetical note appended to iteration 66's own section), the entire
enclosing section — parenthetical note included — was treated as one unit
and archived together, to avoid splitting a cross-reference.

## Resolution
- **resolved_by:** iteration 81
- **outcome:** applied, all 5 requested actions.
- **evidence:** `experiments/quay-native-bootstrap/provenance.md` (2,624 lines, was 10,887),
  `experiments/quay-native-bootstrap/provenance-archive.md` (8,417 lines, new file), this
  directive's own Progress note above (line-range evidence, verification
  detail), `experiments/quay-native-bootstrap/iterations/iteration-81.md` §5/§6.

1. **Read in full and classified with line-range evidence** — done; see
   the Progress note above for the full stale-vs-load-bearing
   classification of every one of the file's 144 `##`-headed sections.
2. **Compacted: merged duplicated reasoning, collapsed verbose narrative
   into concise summaries, removed genuinely obsolete content** — done.
   The canonical exclusion-set statement (already singular, added
   iteration 71) was confirmed to have no duplicate restatement elsewhere
   requiring merging. The 107 non-post-hoc-correction sections from
   iterations 8-66 were collapsed into one compact summary section
   (trajectory tables + notable-events list) in the main file, with full
   original detail preserved in the new archive file. No content was
   deleted outright — see action 3.
3. **No load-bearing information deleted** — done. All 15 post-hoc
   corrections kept in their original position and exact wording. The
   canonical exclusion-set section and both sections it cross-references
   kept untouched. Iterations 0-7 (foundational/unique), the V_meta
   formula correction (mandatory), and iterations 69-80 (most recent,
   actively cross-referenced) all kept fully in place. Everything else
   moved to `experiments/quay-native-bootstrap/provenance-archive.md` verbatim, not deleted.
4. **Re-derivation verified, before/after line counts shown** — done; see
   the Progress note's "Verification performed" subsection above.
   σ_strict = 62/70 = 0.8857, V_instance = 0.5813, V_meta = 0.0973, all
   confirmed identical to the pre-compaction values. 10,887 → 2,624 lines
   (main file); 8,417 lines (new archive file).
5. **No V_instance/V_meta credit claimed** — confirmed; see
   `experiments/quay-native-bootstrap/iterations/iteration-81.md` §7-§8, both explicitly stating
   this directive's work is housekeeping and claims no factor movement.

No V_instance or V_meta factor movement is claimed for this directive's
resolution — this is housekeeping/meta/process work (compacting a
provenance ledger's representation), not new production or task-closing
work, consistent with this experiment's treatment of similar meta/process
work (e.g. iterations 65, 78, 79, 80).
