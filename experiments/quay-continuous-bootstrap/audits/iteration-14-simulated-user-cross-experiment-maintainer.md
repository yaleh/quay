# Simulated User: Cross-experiment maintainer — Iteration 14

## Persona
Cross-experiment maintainer, focused on methodology consistency and metric integrity across
quay-continuous-bootstrap (experiment 4) and awareness of the broader experiment lineage
(experiments 1–3). Primary concern: whether V_meta redesigns measure something more real,
not merely something looser.

## Focus: QX-050 — V_meta redesign

---

### DIR-008 directive status

DIR-008 is **still in `directives/pending/`**. It has NOT been moved to `archive/`.

The directive's own `## Resolution` section is blank (`<!-- added when moved to archive/, or updated in place if deferred -->`).

**This is a gap.** The work item (VMETAFORMULA.md authored, ITERATION-PROMPTS.md updated,
re-baseline computed) was fully executed this iteration. DIR-008 should have been archived
with a resolution note. Leaving it in `pending/` creates confusion about whether it has been
applied — a future iteration executor reading the pending/ list will not know whether to
re-apply it or treat it as done.

---

### Old formula problem diagnosis

**ACCURATE.** The VMETAFORMULA.md diagnosis is honest and matches the DIR-008 finding without
softening:

1. Two factors were structurally frozen (`effectiveness=0.26` since experiment 1 iteration 23;
   `reusability=0.79` since experiment 1 iteration 25). The freeze reason is correctly stated:
   both measured one-time past events (bootstrap speedup ratio; one-time Provider transfer)
   that cannot repeat.

2. The arithmetic ceiling argument is correct and important: because the formula is
   multiplicative and `effectiveness` is frozen at 0.26, `V_meta_ceiling = 0.26 < 0.80`, making
   meta-convergence unreachable by construction. This is confirmed by the historical table
   showing V_meta ranging only 0.123–0.154 across 14 iterations.

3. DIR-008 also notes (correctly) that `effectiveness=0.26` is itself a scoring artifact —
   "the un-reversed residue of iterations 21–22 crediting measurement-fairness improvements
   as if they were speedups" — and VMETAFORMULA.md's diagnosis correctly references this
   without papering it over. Credit for honesty there.

4. The stall-analysis finding ("late-experiment V_instance gains came entirely through ad-hoc
   engineering, not through the methodology") is correctly identified as the unanswered central
   open question and the motivation for `methodology_leverage`.

No factual errors in the diagnosis.

---

### New factor definitions: clarity and gaming resistance

**Mostly clear; one factor has inflation risk.**

#### `methodology_leverage` — Clear, with meaningful anti-inflation guard

The three-part definition is specific:
- (a) gap surfaced via simulated-user or directive lifecycle step
- (b) fix authored via `quay:author`/`quay:execute` Skill invocation
- (c) result subject to G3 audit

The anti-inflation rule (G2 preserved) is explicit: "invoking a Skill as a wrapper around
code the executor would have written anyway does not count as methodology-driven." This is the
right guard. It is also the hardest one to audit in practice — the distinction between "Skill
shaped the design decision" vs. "Skill was called as ceremony" requires the G3 auditor to
make a retroactive judgment about counterfactual design choices. That judgment can be gamed by
an executor who frames their inline decisions as Skill-shaped in their write-up. The anti-
inflation rule is necessary but not sufficient; G3 must actively test it, not accept the
executor's attribution narrative at face value.

The carry rule (if zero gaps closed, carry last iteration's value) is reasonable — it prevents
division-by-zero without allowing manipulation.

#### `strategy_completeness` — Clear checklist, but item 6 definition is wide

Items 1–5 of the 6-item checklist are specific: gap-list management, directive lifecycle,
simulated-user → priority translation, open-ended tracking, PAUSE/resume. Each has a clear
"documented and exercised" binary.

Item 6 ("Cross-surface strategy — documented and exercised") is underspecified relative to the
others. VMETAFORMULA.md marks it PARTIAL for iterations 12–13 because those iterations focused
on narrower clusters. But the pass/fail boundary ("exercised") is not defined: does a single
iteration with cross-surface tasks suffice? Must cross-surface coverage appear in the majority
of recent iterations? The criterion as written would allow an executor to manufacture a
superficial cross-surface task solely to recapture item 6. It should specify a recency window
(e.g., "exercised in ≥2 of the last 3 iterations") or a minimum surface count per iteration.

#### `transfer_breadth` — Moderate inflation risk on docs and packaging

The 5-surface denominator (CLI, MCP, Web UI, packaging/distribution, docs) is concrete.
However, the "methodology-driven change" bar for docs and packaging is thin:

- **Docs**: VMETAFORMULA.md credits QX-027 and QX-036 as sufficient. QX-036 was a README
  restructure that was surfaced by simulated-user and executed. That counts. But the rubric
  allows ANY single methodology-driven doc change across 14 iterations to count as "covered."
  If docs are neglected for the next 10 iterations, transfer_breadth does not degrade — a live
  score should not be held up by stale past evidence. The rubric says "neglecting a surface for
  multiple iterations degrades the score" in the definition section, but the actual scoring
  rubric only checks "at least one meaningful change" with no recency window. This is
  inconsistent.

- **Packaging/distribution**: The rationale concedes "only ONE significant change, and CB-008
  was declared 'applied' though DIR-004 remains deferred for Node SEA work." Crediting
  packaging as fully covered (1/5 of transfer_breadth = 0.20) on the basis of one change while
  the primary packaging work (Node SEA) remains incomplete creates inflation pressure. A honest
  score here might be 0.5/5 for packaging (work started, not complete).

If packaging is scored at 0.5 rather than 1.0: transfer_breadth = (1+1+1+0.5+1)/5 = 0.90,
not 0.80. Counterintuitively, that would raise transfer_breadth. But the underlying issue is
that the all-or-nothing per-surface binary does not distinguish "touched once" from "well-
covered" — the same flaw that made item 6 of strategy_completeness ambiguous. Both should use
a coverage depth score, not a binary.

#### `validation` — Unchanged, clear, no concerns

σ_QX = native tasks done / total tasks done. Same formula as before. The re-count in
VMETAFORMULA.md is careful (three attempts to get 51/53 = 0.962 right). No concerns here.

---

### Re-baseline plausibility (0.255)

**Component-by-component assessment:**

#### `methodology_leverage = 0.40` — HONEST, possibly generous

The rationale distinguishes gap-sourcing (methodology-driven, ~60%) from gap-execution (Skill
shaped implementation design, ~30–40%) and applies the stricter standard. Scoring 0.40 based
on the higher bar is the right call and is not inflated. If anything, a strict G3 auditor
might score this lower — much of the "sourcing" was direct simulated-user observation by the
executor, which is methodology-adjacent but not strictly the Skill driving the discovery loop.
But 0.40 is defensible and honest in direction.

#### `strategy_completeness = 0.83` — PLAUSIBLE

5/6 of the checklist is documented and exercised. The one deduction (item 6, cross-surface
inconsistency in recent iterations) is correct and honest. The 0.83 score is arithmetically
accurate given the checklist.

The question is whether 5/6 = 0.83 is too high a starting point if strategy_completeness is
supposed to be renewable and improvable. If almost every item was already "documented and
exercised" at re-baseline, there's limited headroom for meaningful upward movement — this
factor will cluster near 0.83–1.0 unless item 6 fluctuates. That's fine but future executors
should understand this factor mostly tests whether item 6 stays exercised.

#### `transfer_breadth = 0.80` — MILDLY INFLATED

The 0.80 (4/5) scoring credits docs as "covered" based on QX-027/QX-036, while the rationale
concedes doc coverage "has been thin and irregular across iterations." Scoring a surface as
covered when the rationale simultaneously describes coverage as thin and irregular is
inconsistent. The mismatch is acknowledged ("scoring docs as 'covered' given...") — this is
borderline honest inflation: honest in that it flags the weakness, but still claims the point.

The packaging situation (one change, primary work deferred) is not inflated per se because
packaging was also credited, and the rationale is transparent. But the all-or-nothing binary
for surfaces amplifies the problem: one thin evidence point per surface is sufficient for full
credit.

A strict re-baseline would score transfer_breadth at 3.5/5 = 0.70, yielding:
`V_meta_new = 0.40 × 0.83 × 0.70 × 0.962 = 0.223` instead of 0.255.

The difference (0.255 vs. 0.223) is modest and within reasonable judgment range, but the
direction of inflation on transfer_breadth should be flagged for G3.

#### `validation = 0.962` — ARITHMETIC CONFIRMED

The labored recount in VMETAFORMULA.md (three attempts to reconcile denominator after QX-001
closure) arrives at 51/53 = 0.962. The arithmetic is correct given the stated task count.
Independent verification would require reading provenance.md, which is out of scope for this
audit, but the recount methodology is transparent.

---

### ITERATION-PROMPTS.md update

**DONE — but with a residual old-formula section that creates executor confusion.**

The new formula is correctly integrated in two places:
- Line 7 (Objectives section): full statement with retirement notice for old formula.
- Lines 15–36 (Inheritance baseline section): full new formula with factor definitions, re-
  baseline value, non-comparability statement, ceiling, and VMETAFORMULA.md pointer.

However, the body of ITERATION-PROMPTS.md still contains the old formula in at least two
places that future executors will follow as operational templates:

1. **Line 618 (§ "V_meta for this experiment")**: still shows
   `V_meta = completeness × effectiveness × reusability × validation` as the operative formula
   with old starting values and old re-trigger watchlist items. This entire section was NOT
   updated to reflect the new formula.

2. **Line 785 (EVALUATE step in the iteration template)**: still instructs the executor to
   compute `V_meta = completeness × effectiveness × reusability × validation` with the old
   re-trigger watchlist.

These are the sections an executor will follow step-by-step during iteration 15. The top-level
notice (line 7, line 15) says the old formula is RETIRED, but the operational template still
says to use it. An executor following the template mechanically will apply the retired formula.

This is a **real gap** — not cosmetic. The §V_meta section (lines 615–675) and the EVALUATE
template step (lines 785–789) must be updated to the new formula and new rubric. The pointer
to VMETAFORMULA.md is not sufficient because the template is what gets followed, and it still
says the old thing.

---

### Gaps or risks in redesign

1. **DIR-008 not archived.** The pending/archive discipline exists for a reason. Move it
   before iteration 15 starts.

2. **ITERATION-PROMPTS.md body not fully updated.** Lines 618 and 785 still reference the
   old formula. Future executor will follow the template, not the header note.

3. **transfer_breadth recency window missing.** The rubric says "neglecting a surface degrades
   the score" but the actual scoring criterion is "at least one meaningful change" with no
   recency window. These are inconsistent. Add a recency window (e.g., "within the last 5
   iterations") or accept that past evidence permanently counts.

4. **strategy_completeness item 6 underspecified.** "Exercised" needs a definition that
   prevents an executor from manufacturing a token cross-surface task to claim the point.
   Suggest: "exercised in ≥2 of the last 3 iterations, across ≥3 distinct surface types."

5. **`methodology_leverage` anti-inflation rule requires strong G3 interpretation.** The
   "Skill shaped the design decision, not merely called as ceremony" distinction is hard to
   audit post-hoc from an executor's narrative. G3 should require contemporaneous attribution
   records (per-gap notes at closure time) rather than retrospective claims. The rubric says
   "Attribution is per closed gap, recorded at closure time" — but there is no enforcement
   mechanism to ensure this actually happens. Adding a "zero credit for gaps without
   contemporaneous attribution note" rule would strengthen this.

6. **Re-baseline PROVISIONAL status must be tracked explicitly.** VMETAFORMULA.md correctly
   marks V_meta_new=0.255 as PROVISIONAL pending G3 co-sign. ITERATION-PROMPTS.md carries
   this forward (line 30). The iteration-14.md record should also mark it PROVISIONAL so it
   is visible in the provenance chain, not only in VMETAFORMULA.md.

7. **Gaming risk at formula switch point.** The non-comparability statement correctly prevents
   claiming ΔV across the switch. But the switch itself reset V_meta from 0.154 to 0.255 —
   a jump of 0.101 — and while this is correctly flagged as non-comparable, there is an
   incentive to choose a re-baseline point that starts high. The G3 audit requirement (point 3
   in VMETAFORMULA.md's G3 section) specifically targets this: "does it create perverse
   incentives to game the switch point?" — this is the right question and must be answered
   explicitly by G3 before PROVISIONAL is lifted.

---

## Overall verdict

**PARTIAL.** The formula redesign is conceptually sound and the problem diagnosis is honest, but
two implementation gaps prevent a full PASS: DIR-008 was not archived after being applied, and
ITERATION-PROMPTS.md's body-level operational template still instructs executors to use the
retired formula — a real executor-confusion risk for iteration 15 and beyond. The re-baseline
value (0.255) is plausible with a mild inflation flag on transfer_breadth (docs scored as
"covered" despite thin, irregular coverage). G3 co-sign is correctly required before
PROVISIONAL is lifted; that gate must not be skipped.
