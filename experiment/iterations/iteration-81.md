# Iteration 81: apply DIR-023 — compact `experiment/provenance.md`, remove stale/duplicated narrative, verify no information lost

**Date**: 2026-07-16
**Driver**: dispatched background subagent (quay-bootstrap-experiment)
**Stage**: fixpoint (post-convergence-target housekeeping; no Stage transition this iteration)

## 1. Context from prior iteration

Iteration 80 applied DIR-022 (the actual hard/ambiguous manda self-deadlock
trial, `to="cord"`): success, `{"value":"iteration-80-cord-pong"}`, ~50.7s
round trip, no self-deadlock. σ_strict unchanged at 62/70 = 0.8857,
V_instance = 0.5813 (0.83×0.96×0.76×0.96), V_meta = 0.0973
(0.74×0.26×0.79×0.64) — all unchanged from iteration 79. DIR-022 was
archived with a Resolution section; DIR-021 (standing SOP) was left
pending with an appended Progress note. Iteration 80's own out-of-band
audit (`experiment/audits/iteration-80-independent-adjudicate.md`) found
**PASS, no concerns** — independently re-verified process topology,
timing, DIR-022's Resolution honesty, DIR-021's pure-append status,
σ_strict/V_instance/V_meta re-derivation, the post-hoc-correction count
(15), and the pending/ directory contents.

Since iteration 80, the human filed **two** new directives directly in
this live conversation: DIR-023 (compact `experiment/provenance.md` —
this iteration's primary task) and DIR-024 (broker-side `agent.spawn`
must actually use `run_in_background=true`, per `caps-broker.md`'s own
already-written spec — filed after this iteration's dispatch was created,
discovered at this iteration's own pending/ directory check).

## 2. Preconditions checked

- `experiment/directives/pending/` listed at the start of this iteration:
  contained `DIR-021-*.md` (standing, expected) and `DIR-023-*.md` (new,
  this iteration's primary task). `DIR-024-*.md` appeared in the same
  directory partway through this iteration's execution (added by the
  human directly in the live conversation, evidenced by the git log:
  commit `67dbd7f "Add DIR-024..."` sits after `9dc8570 "Add DIR-023..."`
  and before this iteration's own commit) — re-checked and read once
  noticed.
- This iteration's own scope is provenance-ledger housekeeping, not a
  manda-mechanism trial — the G6 manda-monitor/process-tree preconditions
  that gate DIR-021-style trials do not apply to this iteration's actual
  work, and no manda dispatch was performed or needed.
- Read, in order, before starting work: `docs/proposal/quay-bootstrap-
  experiment.md` (protocol), `experiment/provenance.md` (10,887 lines, in
  full, via section-by-section structural analysis), `experiment/
  ITERATION-PROMPTS.md`, `experiment/iterations/iteration-80.md`,
  `experiment/audits/iteration-80-independent-adjudicate.md`, `experiment/
  directives/pending/DIR-021-*.md` (context), `experiment/directives/
  pending/DIR-023-*.md` (primary task, in full), and `experiment/
  directives/archive/DIR-022-*.md` (as the established Resolution-section
  pattern to replicate).

## 3. Observe

`experiment/provenance.md` was 10,887 lines. It is read in full by every
iteration and every G3 audit, so its size is a direct, compounding token
and time cost. Structural analysis (via `grep -n "^## "` plus a Python
pass computing exact section boundaries) found **144** `##`-headed
sections. Classified them into two groups:

- **Foundational/mandatory/actively-cross-referenced** (lines 1-1325 and
  10186-end of the pre-compaction file): the file header, the canonical
  `## Permanent strict-exclusion set (σ_strict)` section (added iteration
  71 — already the single canonical statement DIR-023 itself asked to
  exist "ONCE, canonically"; confirmed no duplicate restatement of this
  reasoning existed anywhere else in the file), the detailed iterations
  0-7 Records/σ-computation (including the two sections the exclusion-set
  table cross-references by name: "QN-003/QN-004 execute_by nuance" and
  "Iteration 1 author_by honesty note"), the protocol-§10.5-mandated
  baseline timing/effort data, the mandatory V_meta formula correction
  (iteration 8), and iterations 69-80 (most recent, most actively
  cross-referenced, including the fourteenth and Fifteenth post-hoc
  corrections).
- **Repetitive "middle era" narrative** (iterations 8-66, 107 of the 144
  sections once the 12 post-hoc corrections chronologically inside this
  range are excluded): per-iteration Records/σ-computation/V-factor-
  attribution detail that duplicates what each iteration's own
  `experiment/iterations/iteration-N.md` file already preserves in full
  (a convention that predates most of this range) — most conspicuously a
  run of ten near-identical "V-factor attribution (precedent-derived,
  held flat)" sections for iterations 36-45.

All **15** post-hoc corrections were located and confirmed present
(matching the iteration-80 independent audit's own count exactly): the
ninth (iter 50/51 audits), tenth (iter 53), eleventh (iter 57),
twelfth/thirteenth (iter 59/61), fourteenth (iter 69 — the self-audit
guardrail violation and fabricated σ_strict figure), and "Fifteenth"
(iter 71). 12 of these 15 fall chronologically inside the "middle era"
range and were confirmed to be independently self-contained (each
correction's reasoning does not depend on the surrounding narrative that
was archived).

## 4. Strategy

Chose a conservative, surgical compaction over a wholesale rewrite:
1. Move the 107 non-post-hoc-correction "middle era" sections (iterations
   8-66), verbatim and unedited, to a new file,
   `experiment/provenance-archive.md`.
2. Replace them in `experiment/provenance.md` with one compact `##
   Iterations 8-66 — compact summary` section: a σ_strict-trajectory
   table (fractions/decimals transcribed verbatim from the archived text,
   not recomputed), the V_instance/V_meta factor trajectories across the
   same range with end-of-range values, a short notable-events list, and
   an explicit re-derivation check tying the end of the compacted range to
   the still-in-place `## Iteration 69` section that immediately follows.
3. Leave every post-hoc correction exactly in its original position and
   wording — none moved.
4. Prioritized archiving over deleting for every section where load-
   bearing status was not 100% certain (per the directive's own
   instruction and this iteration's dispatch emphasis on caution).

Two ambiguous cases were resolved conservatively rather than assumed
safe: (a) iterations 59 and 61's own task-narrative sections (titled with
a struck-through, later-reverted V-factor-movement claim) were archived
only after directly re-reading both and confirming their full corrective
reasoning already lives, complete and self-contained, in the immediately
following post-hoc-correction section, which was kept in place — no
reasoning was lost, only the (already-superseded) original narrative
moved; (b) the iterations-67-68 parenthetical note (appended inside
iteration 66's own section rather than given its own `##` header) was
archived as one unit together with iteration 66's section, to avoid
splitting a cross-reference across the archive boundary.

## 5. Execution

- Computed exact `(start_line, end_line, title)` triples for all 144
  sections via `grep -n "^## "` plus a Python pass.
- Identified the 16 candidate post-hoc-correction-titled sections by
  regex, cross-checked against the "confirmed post-hoc correction"
  ordinal-number search pattern used by the iteration-80 audit,
  confirming 15 distinct corrections total (two of the 16 candidate
  sections were "Iteration N" narrative sections whose *title*
  parenthetically mentions "reverted post-hoc" but are not themselves the
  correction section).
- Wrote `experiment/provenance-archive.md`: a short explanatory preamble
  (what this file is, why it exists, what is deliberately NOT here) plus
  the full verbatim text of all 107 non-post-hoc-correction sections from
  iterations 8-66, in original order.
- Rewrote `experiment/provenance.md`: kept lines 1-1325 (header through
  the V_meta formula correction) and lines 10186-end (iterations 69-80)
  completely untouched; inserted the new compact-summary section in
  place of the archived material; kept all 12 in-range post-hoc
  corrections in their original position, immediately following the
  compact summary, in original chronological order.
- Verified structural integrity post-edit: `grep -n "^## "` on the new
  file shows the expected sequence (iterations 0-7 detail → V_meta
  correction → compact summary → 12 post-hoc corrections in order →
  iterations 69-80 unchanged), with no headers lost or duplicated.
- Re-verified the canonical exclusion-set section (lines 1-42) is
  byte-for-byte unchanged and both sections it cross-references by name
  ("QN-003/QN-004 execute_by nuance", "Iteration 1 author_by honesty
  note") are still present, unmoved.
- Re-verified the post-hoc-correction count and ordinal sequence via
  `grep -n -i "confirmed post-hoc correction\|Fifteenth post-hoc
  correction" experiment/provenance.md`: identical six-line result
  (ninth/tenth/eleventh/twelfth-thirteenth/fourteenth/Fifteenth) to what
  the iteration-80 independent audit found before this compaction.
- Updated DIR-023's frontmatter to `status: resolved`, appended a
  Progress note (full classification, evidence, verification detail) and
  a `## Resolution` section (action-by-action confirmation of all 5
  requested actions, matching the DIR-022 Resolution-section pattern),
  then `git mv`'d it to `experiment/directives/archive/`.
- Re-checked `experiment/directives/pending/`: found DIR-021 (standing,
  expected) plus a newly-arrived DIR-024 (broker-side `agent.spawn`
  background-spawn fix), filed by the human after this iteration's
  dispatch was created. Read DIR-024 in full: its requested actions are
  scoped to "any session acting as a manda broker" and "the next
  appropriate iteration... or a directly-instructed live trial" — i.e.
  orchestrator/broker-session concerns (confirmed `caps-broker.md` itself
  lives outside this repository, at `/home/yale/work/manda/plugin/
  skills/manda-monitor/reference/caps-broker.md`). This iteration neither
  acted as a manda broker nor performed any manda dispatch, so DIR-024 is
  not actionable from within this dispatched subagent's own execution —
  left pending, unmodified, analogous to how DIR-021 is treated as a
  standing directive across iterations rather than applied by every
  iteration that merely reads it.
- No production code, test files, or Skill/capability definitions were
  touched. No task file (`tasks/QN-*.md`) was created or modified. Task
  count remains 70; no provenance triple changed.

## 6. Provenance update

No new task, no `{author_by, execute_by, gate_by}` triple changed. This
iteration is pure ledger/directive housekeeping — per DIR-023's own
action 5, no σ/V credit is claimed for it.

**Before/after line counts** (DIR-023 action 4's explicit requirement):
- `experiment/provenance.md`: **10,887 lines → 2,624 lines** (a 76%
  reduction).
- `experiment/provenance-archive.md`: **0 → 8,417 lines** (new file).
- Combined (2,624 + 8,417 = 11,041) exceeds the original 10,887 by 154
  lines, entirely accounted for by net-new explanatory material (the
  archive file's own preamble, plus the compact-summary section's
  trajectory tables and re-derivation notes) — no original content was
  discarded, only relocated or (for the newly-added explanatory framing)
  added.

**Re-derivation check** (DIR-023 action 4): independently re-derived
σ_strict from `tasks/QN-*.md`'s own file count (`ls tasks/QN-*.md | wc -l`
= 70, matching the compacted file's own stated denominator) combined with
the still-intact internal chain in `experiment/provenance.md` (61/68 =
0.8971 at the end of the compacted range → 65/69, corrected to 62/69, at
iteration 69 → 62/70 at iteration 76 → unchanged through iteration 80).
Recomputed V_instance = 0.83 × 0.96 × 0.76 × 0.96 = 0.5813 and V_meta =
0.74 × 0.26 × 0.79 × 0.64 = 0.0973 directly from the factor values stated
in the still-untouched iteration-80 tail section.

**Result: σ_strict = 62/70 = 0.8857, V_instance = 0.5813, V_meta =
0.0973 — all three values re-derive to exactly the same figures as
before compaction.** The compaction changed representation only, per
DIR-023's own requirement.

## 7. V_instance

`skeleton` = 0.83, `abi_symmetry` = 0.96, `gate_correctness` = 0.76,
`skill_convergence` = 0.96 — **all four factors unchanged**.

```
V_instance = 0.83 × 0.96 × 0.76 × 0.96 = 0.5813  (unchanged from iteration 80)
```

No V_instance credit is claimed for this iteration's work. This
iteration's entire scope was compacting the representation of the
provenance ledger — a meta/process/documentation-quality task, not
instance-layer feature work. No quay-native/quay-github/quay-web source
file was touched; no test was added or modified; no gate logic changed;
no Skill content was edited.

## 8. V_meta

`completeness` = 0.74, `effectiveness` = 0.26, `reusability` = 0.79,
`validation` = 0.64 — **all four factors unchanged**.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973  (unchanged from iteration 80)
```

No V_meta credit is claimed either. This iteration did not touch the
Method's own self-containedness (`completeness`), did not produce a
timing comparator (`effectiveness`), did not port anything across a
Provider boundary (`reusability`), and `validation` remains reserved for
the top-level orchestrator's independent out-of-band audit, per standing
practice. Explicitly, per DIR-023 action 5: this is housekeeping work,
consistent with this experiment's treatment of similar meta/process work
(iterations 65, 78, 79, 80 — none of which claimed V-factor movement for
process/protocol/tooling-verification work either).

## 9. Out-of-band audit

Not performed by this session. Per standing G3 discipline, the
independent out-of-band audit of this iteration's work is dispatched
separately by the top-level orchestrator, via a native `Agent`/Task tool
invocation, never self-performed by the executing iteration and never via
manda (retired per DIR-015 action 3). This iteration explicitly did not
dispatch its own G3 audit.

## 10. Convergence Check

Convergence criteria (protocol §7): dual threshold V_instance ≥ 0.80 AND
V_meta ≥ 0.80 (currently 0.5813 and 0.0973 — both far below threshold);
self-hosting fixpoint σ→1 (currently 0.8857, not 1); contract proven
(native+GitHub both run — partially true, but not sufficient alone);
out-of-band audit passed (iteration 80's audit passed; this iteration's
own audit is pending, to be dispatched by the orchestrator); diminishing
returns ΔV < 0.02 for 2+ iterations (true, but for the wrong reason —
sustained zero movement across an extended stretch, not genuine
saturation at a high value).

**Status**: NOT CONVERGED

This iteration performed no σ/V-earning work by design (DIR-023's own
action 5) and does not move the system closer to the dual-threshold
convergence criterion. Its value is orthogonal to convergence: reducing
the token/time cost of every future iteration and audit's mandatory
provenance-ledger read, which is itself an enabling condition for the
experiment's own continued sustainability, not a convergence-criterion
component itself.

## Problems identified for next iteration

1. **DIR-024 (broker-side `agent.spawn` must use `run_in_background=true`)
   remains pending and unactioned.** It requires the manda broker session
   (the top-level orchestrator, not a dispatched iteration subagent like
   this one) to confirm and, if necessary, fix its own `agent.spawn`
   servicing behavior against `caps-broker.md`'s own already-written spec,
   then attempt a bounded 2-3-concurrent-dispatch trial. This is squarely
   an orchestrator-level task, analogous to DIR-021 — future iterations
   should continue to treat it as standing context unless explicitly
   dispatched to act on it directly.
2. **The new compact-summary section's σ_strict trajectory table has
   some gaps** (a handful of intermediate iterations, e.g. 13-15, 18,
   33-43, list only a decimal with no exact fraction, because the
   original archived narrative itself only stated a decimal at those
   points). This is not a loss relative to the pre-compaction file (the
   same gaps existed in the original prose at those exact points), but a
   future iteration wanting the exact fraction for one of those specific
   iterations should consult that iteration's own
   `experiment/iterations/iteration-N.md` file, which independently
   records its own task table.
3. **`experiment/provenance-archive.md` is now a second file every G3
   audit *could* need to consult** for full historical detail on
   iterations 8-66, though not on every iteration/audit's mandatory-read
   critical path (the compact summary in the main file is sufficient for
   routine σ/V re-derivation). Audits investigating a specific "middle
   era" iteration's original reasoning in depth should know to check this
   file. Consider adding an explicit one-line pointer to
   `experiment/provenance-archive.md` in `ITERATION-PROMPTS.md`'s own
   preconditions/reading-order section in a future iteration, if audits
   find themselves needing it repeatedly and not discovering it
   naturally.
4. Standing from iteration 80 (unchanged): DIR-021's own standing
   guidance (fresh manda nested-subagent trial per iteration) was not
   re-applied this iteration, since this iteration's dispatched primary
   task (provenance-ledger compaction) did not naturally call for any
   manda dispatch — consistent with how iterations 65/78 (also
   process/protocol-focused) treated it.
