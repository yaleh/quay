# Iteration 85: whole-experiment convergence reassessment — rigorous
# engagement with protocol §7 (all three readings) and the "Practical
# Convergence" pattern, given 8 flat iterations, organic backlog
# exhaustion, and the freshly-formalized V_meta ceiling; independent
# judgment reached: recommend declaring Practical Convergence, surfaced
# for orchestrator/human sign-off, NOT unilaterally executed

**Date**: 2026-07-16
**Driver**: dispatched background subagent (quay-bootstrap-experiment) —
this iteration's actual "work product" is analytical/documentary
(a convergence reassessment), not a new production increment
**Stage**: fixpoint (post-organic-exhaustion; no Stage transition; no new
task authored)

---

## Executive summary (read this first)

This iteration was explicitly tasked with a genuine, rigorous **whole-
experiment convergence reassessment**, not another routine gap search.
Having re-read protocol §7 in full, the entire historical practical-
convergence precedent (iterations 12, 14-17, 83's audit), iteration 84's
report and its independently-PASSed audit, and `provenance.md`'s
standing-fact and permanent-exclusion sections, this iteration reaches
its **own independent judgment**: **the honest, evidence-backed
recommendation is (a) — the experiment should now formally recognize
Practical Convergence and begin the transition to wind-down/results
documentation.** This is **not self-declared as final** in this
iteration — per this experiment's own established practice (iteration
16/17's fork), it is written here as a clear recommendation requiring
explicit orchestrator/human sign-off before the loop is actually
retired. No ITERATION-PROMPTS.md machinery is deleted, no SOP is
stopped, and this iteration performs zero unilateral wind-down actions
beyond writing this recommendation down.

**Evidence supporting this conclusion, engaged against all three
protocol §7 readings, not just the default "not converged, keep going":**

1. **Strict dual threshold (V_instance≥0.80 AND V_meta≥0.80)**: clearly
   NOT met — V_instance=0.5813, V_meta=0.0973. Not close.
2. **Meta-Focused Convergence (V_meta≥0.80, V_instance≥0.55)**: also NOT
   met — V_instance (0.5813) clears its own bar, but V_meta (0.0973) is
   nowhere near 0.80; the same architectural/organic-exhaustion reasons
   that block strict convergence block this alternative too.
3. **Practical Convergence** (combined quality exceeds the raw metrics;
   justified partial-criteria satisfaction): this iteration's own
   independent judgment, argued in full in §5 below, is that this
   criterion is **now genuinely satisfied** — not merely "close" or
   "arguable," but supported by a stronger evidentiary base than
   existed even at iteration 84: **all eight V-factors (four V_instance,
   four V_meta) are independently confirmed flat and freshly re-checked
   across 8 consecutive iterations (78-85 inclusive of this one)**; the
   backlog is **not merely low but structurally exhausted** (66 done /
   4 permanently-adversarial fixtures, one a child of another); and —
   the genuinely new finding this iteration adds beyond iteration 84 —
   **`gate_correctness` (V_instance's own lowest factor, 0.76) has itself
   been independently checked-and-explicitly-rejected in no fewer than
   10 separate recent iterations (60, 61, 62, 63, 64, 66, 76, 80, 82,
   83, 84) for the identical structural reason (a generic mechanical
   gate cannot fully close checkbox-count-gameability by design — this
   is itself G3's own point, stated explicitly by iteration 20)**. This
   means V_instance's remaining gap is in the same class of
   "architecturally-ceilinged, not merely under-searched" state that
   `provenance.md`'s iteration-84 standing-fact note already formalized
   for V_meta's three factors — the entire dual-V picture, not just
   V_meta's three factors, now has a documented, evidence-backed
   plateau. Iteration 84's own "problems for next iteration" section
   flagged `gate_correctness` as "not specifically re-examined recently"
   — this iteration corrects that: it *has* been examined recently and
   repeatedly, just not previously assembled into one place. This is a
   genuinely new synthesis this iteration adds, not a restatement.

**On DIR-025 action 3d** (identify what would need to change in the
provenance/state model to support concurrent full iterations): judged
ripe and attempted as design-only work this iteration (§6 below) — a
genuinely new angle, not yet attempted by any prior iteration, and one
that does not require backlog work to pursue.

---

## 1. Context from prior iteration

Iteration 84 applied iteration 83's audit's recommendation: formally
documented `provenance.md`'s new "Standing fact: V_meta practical-
convergence ceiling" section (5 falsifiable re-trigger conditions),
archived resolved DIR-024, and directly verified DIR-025 3c remains not
actionable (no suitable independent backlog). σ_strict = 62/70 = 0.8857,
V_instance = 0.5813, V_meta = 0.0973 — unchanged for 7 consecutive
iterations (78-84 inclusive). Iteration 84's own independent G3 audit
(`experiment/audits/iteration-84-independent-adjudicate.md`, commit
`ce566f0`) returned **PASS**, independently re-verifying every concrete
claim (σ/V arithmetic, backlog-exhaustion, regression suite, git diff
scope, DIR-024 archival correctness) and reaching its own independent
judgment that path (i) was the correct call. The audit's one forward-
looking note: watch that re-trigger condition 5 (12-iteration re-search
window) is actually honored around iteration ~96, not silently
deferred.

This iteration's own explicit mandate (per its dispatch prompt): not
another routine gap search, but a genuine, rigorous **whole-experiment**
convergence reassessment — engaging all three protocol §7 readings
(strict, Meta-Focused, Practical Convergence) on their own terms, and
forming an independent judgment rather than deferring to iteration 84's
or its audit's framing.

## 2. Preconditions checked

```
[x] docs/proposal/quay-bootstrap-experiment.md read in full, fresh, this
    iteration (§1-§10, all sections, not a cached summary) — confirmed
    §7's actual text is the five-criterion conjunctive list; confirmed
    the document does NOT itself contain a named "Meta-Focused
    Convergence" or "Practical Convergence" alternative-criteria table —
    those are historically-established interpretive patterns from prior
    iterations' own reasoning (first named at iteration 16-17), not
    frozen protocol text. This iteration treats them as such: real,
    load-bearing precedent, but not literal §7 sub-clauses.
[x] experiment/ITERATION-PROMPTS.md read in full, fresh (§0-§0b
    precondition/dispatch/manda guidance, the iteration report template,
    the §Fixpoint section, the Common Mistakes list).
[x] experiment/iterations/iteration-84.md read in full, fresh.
[x] experiment/audits/iteration-84-independent-adjudicate.md read in
    full, fresh, including its (b)/(c)/(d) judgment sections and its
    one forward-looking observation about condition 5's 12-iteration
    window.
[x] experiment/provenance.md read: the "Permanent strict-exclusion set"
    section, the "Standing fact: V_meta practical-convergence ceiling"
    section (both in full), and the iterations 78-84 compact-summary
    entries.
[x] experiment/iterations/iteration-16.md and iteration-17.md read in
    full — the historical origin of the "practical convergence" pattern
    and how the fork (deliberately-author vs. formally-declare) was
    handled: surfaced as an explicit, named orchestrator/human judgment
    call, NOT resolved unilaterally by the iteration that found it.
    This iteration follows that exact precedent structurally (§7 below).
[x] experiment/directives/pending/ listed: DIR-021 (standing SOP,
    fresh manda-trial-when-relevant), DIR-025 (standing SOP, manda
    nested-subagent concurrent-work). Both read in full, fresh.
```

G6 manda-monitor precondition: not mechanically re-verified via the full
`ps`-based procedure this iteration — no manda dispatch was organically
needed for this iteration's actual work (an analytical reassessment plus
DIR-025 3d design-only investigation, neither of which requires a
subagent-borrowed capability). Consistent with how iterations 65/78/81/
82/83/84 (also process/investigation-focused iterations) treated this
precondition.

## 3. Observe — re-verifying the evidentiary floor directly, not by citation alone

Before reasoning about convergence, this iteration re-ran the checks
itself rather than trusting iteration 84's report or its audit's
numbers on faith:

```
$ ls tasks/QN-*.md | wc -l                                     -> 70
$ grep -h "^status:" tasks/QN-*.md | sort | uniq -c             -> 66 done, 3 needs-human, 1 todo
$ grep -l "^status: todo\|^status: needs-human" tasks/QN-*.md
tasks/QN-017.md  tasks/QN-020.md  tasks/QN-021.md  tasks/QN-022.md
$ for pkg in packages/{quay-native,quay,quay-github}; do
    for f in $pkg/test/*.mjs; do node "$f" >/dev/null 2>&1; echo "$? $f"; done
  done                                                          -> 29/29 real tests exit 0
                                                                    (2 subprocess-worker helpers exit 1, as always)
$ node packages/quay-native/test/abi-symmetry.mjs               -> ALL FOUR SURFACES SYMMETRIC
$ python3 -c "print(62/70)"                                     -> 0.8857142857142857
$ python3 -c "print(0.83*0.96*0.76*0.96)"                       -> 0.58134528
$ python3 -c "print(0.74*0.26*0.79*0.64)"                       -> 0.09727744
```

All figures reproduce exactly. Re-read all four non-`done` task files
(QN-017/020/021/022) directly: all four confirmed `deliberately-
adversarial` by their own frontmatter/prose, QN-021 confirmed
`parent: QN-020` (not independent), exactly as iterations 83/84 and
84's own audit found.

**This iteration's own new evidence-gathering** (beyond re-confirming
84's figures): a `gate_correctness`-focused sweep across the iteration
history, specifically checking whether the factor iteration 84 flagged
as "not specifically re-examined recently" has, in fact, been searched:

```
$ grep -n "gate_correctness" experiment/iterations/iteration-{60,61,62,63,64,66,76,80,82,83,84}.md \
  | grep -i "explicit\|reject\|ceiling\|unchanged\|no.*touched"
```

Result: `gate_correctness` was explicitly considered and explicitly
rejected (zero `checkGate()`/`store.js` gate-logic diff; the work in
question belonged to a different code path) in iterations 60, 61, 62,
63, 64, 66, 76, 80, 82, 83, and 84 — **11 separate iterations**, not
zero. Iteration 20 itself (the iteration that last genuinely moved this
factor, +0.01, from 0.75 to 0.76) explicitly documented the reason
further movement is structurally hard: *"`gate_correctness`'s honest
architectural ceiling (a generic mechanical gate can never fully close
the checkbox-count-gameability gap, by design — that is G3's whole
point)"* — i.e., the ceiling is not an oversight or a search gap, it is
the intended consequence of the experiment's own G3 guardrail (the gate
must not be trusted to self-certify; an independent human/adjudicate
check is required precisely because a mechanical gate has bounded
correctness by design).

**Conclusion of this observation**: iteration 84's "Problems for next
iteration" note describing `gate_correctness` as V_instance's "genuinely
still-open" gap was not quite accurate — it has, in fact, been searched
and found closed repeatedly, just never assembled into a single
standing-fact statement the way V_meta's three factors were in
iteration 84's own new provenance section. This iteration treats that
observation as the missing piece needed to complete the whole-picture
convergence assessment, not merely a V_meta-scoped one.

## 4. Strategy

Given §3's evidence, this iteration's actual work has two parts, neither
of which is a routine gap search:

1. **The mandated convergence reassessment itself** — engage all three
   §7 readings rigorously (§5 below), reach an independent judgment, and
   write it into this report's gap-analysis/conclusion sections per the
   explicit instruction to surface rather than unilaterally execute a
   convergence declaration.
2. **DIR-025 action 3d** (identify what would need to change in the
   provenance/state model to support concurrent full iterations) —
   judged, per this iteration's own reading of DIR-025's text and 3c's
   continued non-actionability, to be ripe for design-only work this
   iteration: a genuinely new angle (design analysis, not backlog
   execution), explicitly authorized by 3d's own text ("concretely
   identify... what would need to change about the provenance/state
   model"), and not requiring the blocked-on-backlog precondition that
   3c has.

No new `tasks/QN-*.md` file is authored. No production code is touched.
This is consistent with — not a repeat of — iterations 78-84's pattern
of honest zero-V-movement analytical/process iterations, but this
iteration's actual analytical content (the whole-experiment convergence
synthesis, and the 3d design work) is new, not a re-derivation of
84's own conclusions.

## 5. Execution — the convergence reassessment, engaged rigorously

### 5.1 Strict dual threshold (protocol §7 criterion 1, literal reading)

`V_instance ≥ 0.80 AND V_meta ≥ 0.80.` V_instance = 0.5813, V_meta =
0.0973. **NOT met, by a wide margin on the V_meta side** (0.0973 is
roughly 12% of the 0.80 target) and a real but smaller margin on the
V_instance side (0.5813 is ~73% of the target). This reading is clearly,
unambiguously not satisfied — no serious argument otherwise exists, and
this iteration does not attempt one.

### 5.2 "Meta-Focused Convergence" alternative (V_meta≥0.80, V_instance≥0.55)

This alternative — named in this iteration's own dispatch instructions
— asks whether the experiment could converge on a *meta-layer-led*
reading: is the *methodology* itself proven (V_meta high), with the
instance artifact merely "good enough" (V_instance ≥ 0.55, a lower bar
than the strict 0.80)? V_instance (0.5813) does clear the 0.55 bar. But
V_meta (0.0973) is even further from 0.80 than under the strict reading
— **this alternative does not help**, for exactly the reason the
strict reading fails: V_meta's shortfall is not a borderline miss, it
is an order-of-magnitude gap, and no honest re-reading of the criteria
closes an order-of-magnitude gap. **NOT met, same underlying cause as
5.1.**

### 5.3 Practical Convergence — the substantive question this iteration
was asked to engage seriously

This is where this iteration's actual judgment work lies. Practical
Convergence is not a literal §7 clause — it is an established
interpretive pattern this experiment's own history has used before
(iterations 12/14-17, and again at iteration 83's audit/iteration 84),
for situations where organic, non-manufactured growth has demonstrably
plateaued **below** formal targets, and continuing to iterate would not
produce genuinely new information. The question is not "are the metrics
high" (they are not) — it is "has this experiment's own capacity to
generate genuine further evidence, without manufacturing busywork,
been exhausted."

**The case FOR Practical Convergence now, stronger than at any prior
iteration this pattern was raised:**

- **Duration and independence of the flat signal.** V_instance and
  V_meta have now been *identically* flat for **8 consecutive
  iterations (78-85)**, each independently re-verified (fresh test runs,
  fresh backlog checks, fresh ABI-symmetry checks) rather than merely
  carried forward by citation. This is a materially longer, more
  independently-corroborated plateau than existed at iteration 16-17
  (3 flat iterations) or even iteration 83 (6 differently-motivated
  search passes for V_meta specifically). No single-iteration anomaly
  or narrow-search artifact explains this pattern; it spans 8
  iterations' worth of genuinely distinct search angles (organic sweep,
  rubric re-derivation, code-level verification, standing-fact
  formalization, and now this iteration's own gate_correctness synthesis
  and 3d design work).
- **Backlog exhaustion is structural, not merely low.** 66/70 tasks
  `done`; the remaining 4 are not merely hard or low-priority — they are
  *deliberately constructed to be unsatisfiable by design*, exist
  specifically to exercise `needs-human` gate paths, and one (QN-021) is
  literally a child of another (QN-020), meaning there are not even
  4 mutually-independent remaining items, let alone new development
  surface. This was independently re-confirmed by this iteration's own
  direct file reads (§3), not inherited from iteration 84's framing.
- **V_meta's three stalled factors now have a formally-documented
  ceiling with concrete re-trigger conditions** (provenance.md, added
  iteration 84, itself independently PASS-audited). This iteration adds
  the missing complementary piece: **V_instance's own lowest, least-
  moved factor (`gate_correctness`, flat at 0.76 since iteration 20 —
  65 iterations) has an equally well-documented, equally structural
  ceiling** — explicitly named by iteration 20 itself as a direct
  consequence of this experiment's own G3 guardrail (a mechanical gate
  cannot fully self-certify by design), and independently re-confirmed
  closed in 11 separate subsequent iterations. **This means the plateau
  is not confined to V_meta — it now covers the dominant share of both
  layers' remaining gap to threshold**, which is new information this
  iteration contributes, not a restatement of iteration 84's V_meta-only
  finding.
- **The remaining V_instance factors are not obviously more open.**
  `skeleton` (0.83) and `abi_symmetry` (0.96) and `skill_convergence`
  (0.96) have likewise been repeatedly checked-and-held-flat across
  iterations 78-85 with explicit per-iteration "no source touched"
  verification; none has an identified, concrete, non-manufactured next
  increment either — the backlog exhaustion in §3 applies to all of
  V_instance's factors simultaneously, not selectively to
  `gate_correctness`.
- **What would move V_instance/V_meta further is, at this point,
  concretely nameable — and every nameable path requires either (a) a
  new capability this harness does not currently provide (a native
  fresh-context subagent-dispatch primitive — re-confirmed absent via
  `ToolSearch` in essentially every recent iteration including this
  one, see §6), or (b) manufacturing new backlog/GitHub-write scope
  purely to produce a data point, which this experiment's own G5
  guardrail explicitly prohibits, and which 6+ prior iterations have
  already explicitly considered and declined for the identical reason.**
  This is the honest, load-bearing distinction between "diminishing
  returns because the search hasn't been creative enough" and
  "diminishing returns because the actually-remaining paths require
  either external infrastructure change or an explicitly-prohibited
  metric-manufacturing move." This iteration's own search (§3, §6)
  confirms the latter, not the former.

**The case AGAINST declaring Practical Convergence yet, engaged
honestly (this iteration does not wave these away):**

- V_meta = 0.0973 remains, in absolute terms, extremely low relative to
  self-hosting's actual goal (quay-native building quay-native, seed
  fully withdrawn) — "practical convergence" at 12% of target is a much
  weaker claim than the term usually implies (a system *near* its
  target that further iteration only marginally improves). This
  iteration does not want to understate that the self-hosting story
  this experiment set out to prove is, honestly, far from demonstrated
  at scale — most of `effectiveness`/`reusability`/`completeness`'s
  *ceiling itself* (not just their current score) is bounded by this
  particular experiment's modest backlog size (70 tasks) and this
  particular environment's tooling gap (no native subagent-dispatch
  primitive), not by any inherent limit of the methodology being
  tested. A different, larger workload or a fixed environment could
  plausibly unlock real further movement without any methodology
  change — this is the same argument iteration 17 made and it still
  applies.
- Declaring "converged" (even qualified as "practical," even requiring
  sign-off) risks being read, by anyone skimming only the executive
  summary, as endorsing a self-hosting proof that has not actually
  happened. This iteration is careful (see §10, §Conclusion) to state
  explicitly, repeatedly, that this is **not** a §7 CONVERGED verdict —
  §7's own five criteria remain unambiguously unmet, and this report's
  own Convergence Check below says NOT CONVERGED without qualification,
  exactly as every prior iteration since 0 has.
- A genuinely new external event — a real production need to drive
  GitHub-backed tasks through the Skill loop, a fix to the fresh-context
  subagent-dispatch gap, or a deliberate human decision to expand scope
  — could still change the picture; Practical Convergence, properly
  understood (per iteration 16/17's own framing), is a statement about
  *this experiment's organically-available growth path being exhausted
  right now*, not a permanent, unconditional ceiling. The standing-fact
  note's own re-trigger conditions (provenance.md) already encode this;
  this iteration's recommendation below explicitly inherits, rather
  than supersedes, that mechanism.

**This iteration's own judgment, reached independently (not by
deference to iteration 84's or its audit's framing):** the case FOR is,
on the concrete evidence assembled here, now stronger than the case
AGAINST, for a specific, narrow reason that was not fully assembled
before this iteration: **the plateau is no longer V_meta-only. It now
spans both layers' dominant remaining gaps, each independently
documented with a structural (not merely under-searched) cause, each
independently corroborated across 8-65 iterations depending on the
factor, and each with concretely-nameable unlock conditions that this
experiment's own structure cannot produce without external change.**
That is the textbook shape of "organic growth genuinely exhausted below
formal target," which is exactly the condition the Practical
Convergence pattern exists to name. This iteration's recommendation is
therefore **(a)**: begin the formal Practical Convergence
recognition/wind-down process — **but, per this iteration's explicit
instruction and this experiment's own iteration-16/17 precedent, this
recommendation is surfaced for orchestrator/human sign-off, not
executed unilaterally by this iteration.** See §7/§Conclusion.

## 6. DIR-025 action 3d — design-only investigation (genuinely new angle, not backlog-blocked)

DIR-025's action 3d text: *"Treat 'concurrent execution of multiple full
iterations'... as a separate, harder goal requiring its own follow-up
directive... this directive authorizes exploring toward it but does not
itself attempt to redesign the sequential state/provenance model needed
to support truly concurrent iterations. Concretely identify, in
whichever iteration first attempts step (c), what would need to change
about the provenance/state model to support (d)..."*

3d's own text conditions it on "whichever iteration first attempts step
(c)" — but 3c remains genuinely not actionable (§3, re-confirmed this
iteration: no suitable independent backlog). This iteration judges 3d's
*design-identification* half is nonetheless attemptable now, as pure
analysis against the existing provenance/state model, without needing
3c's backlog precondition — the instruction from this iteration's own
dispatch explicitly invites this ("could be a legitimate, genuinely new
angle of real work if you judge it fits"). This iteration so judges,
and treats it as **design-only**, not a claim that 3c itself has been
attempted.

**What would need to change in the provenance/state model to support
concurrent full iterations (M_{n-1}→M_n, s_{n-1}→s_n per iteration),
identified directly from re-reading `provenance.md`'s and
`ITERATION-PROMPTS.md`'s actual mechanics:**

1. **σ/provenance-record write serialization.** Currently, `provenance.md`
   is a single flat file, appended to by exactly one iteration at a
   time, and σ is computed by grepping it in full. Two genuinely
   concurrent iterations each appending their own task's
   `{author_by,execute_by,gate_by}` triple would race on the same file
   — the file has no per-record locking or merge discipline (unlike
   `packages/quay-native/src/store.js`'s own file-locking design for
   task-file writes, which this experiment's own artifact already
   solves for the *product* but has never needed for its *own*
   process). **Concrete change needed**: either (a) per-iteration
   provenance fragments (`experiment/provenance/iteration-N-fragment.md`)
   merged by a single serializing step at the end of each concurrent
   batch, mirroring how `packages/quay-native`'s own CAS-based
   concurrent-writer test (`concurrent-writer.mjs`, referenced in the
   regression suite this iteration re-ran, §3) already solves an
   analogous problem for task files — or (b) a lock-then-append
   discipline analogous to `store.js`'s own file-locking mechanism,
   applied to `provenance.md` itself.
2. **σ/V computed against a moving baseline mid-batch.** The current
   model computes σ_strict and V_instance/V_meta once, at the *end* of
   a single iteration, against the state that iteration itself just
   produced. If N iterations run concurrently, each would need to
   decide: does its own σ/V calculation see the *other* concurrent
   iterations' in-flight changes, or only the state as of the batch's
   start? **Concrete change needed**: an explicit "batch baseline"
   convention — freeze `s_{n-1}` for the whole concurrent batch, have
   each concurrent iteration compute its own *marginal* provenance diff
   against that single frozen baseline (not against each other's
   in-flight work), and reconcile into one `s_n` only after all
   batch members complete — this is structurally the same pattern
   DIR-025 3c already specifies for reconciling concurrent *task* work
   within one iteration, extended one level up to concurrent
   *iterations*.
3. **Task-file conflict domain.** Two concurrent iterations authoring/
   executing genuinely independent `tasks/QN-*.md` files do not
   conflict at the file level (quay-native's own file-locking already
   protects concurrent writes to a *single* task file, per
   `store.js`'s design). But two concurrent iterations both wanting to
   touch `experiment/ITERATION-PROMPTS.md`, `experiment/provenance.md`,
   or the same Skill file (e.g. both discovering an identical
   `SKILL.md` gap) would conflict — the current model has no defined
   "iteration-level lock domain" analogous to task-file locking.
   **Concrete change needed**: an explicit rule that concurrent
   iterations may only be batched together if their *anticipated* touch-
   sets (task files, Skill files, shared docs) are disjoint, checked
   *before* dispatch, not discovered as a merge conflict after the fact
   — directly analogous to DIR-025 3c's own precondition ("2-3
   independent, non-conflicting quay tasks") but applied to the
   iteration's full touch-set, not just its target task.
4. **Report numbering and ordering.** `experiment/iterations/iteration-N.md`
   is currently strictly sequential and monotonic — iteration N's report
   always documents "context from iteration N-1." Concurrent iterations
   would need either (a) a documented "batch" concept (iteration 86a/
   86b/86c, reconciled into a single 87 that documents the merge), or
   (b) accept that concurrent iterations forfeit strict sequential
   numbering and instead carry explicit "concurrent with iteration
   86-X" cross-references. This is a naming/documentation-convention
   change, not a mechanism change, but it would need to be decided
   before any concurrent-iteration attempt, or reviewers of the
   iteration history would lose the ability to reconstruct a single
   linear s_0→s_n trajectory — itself a documented protocol expectation
   (§4.2's fixpoint framing assumes v_n→v_{n+1} is a single, orderable
   step).
5. **G3 audit dispatch fan-out.** The audit (per DIR-016, this
   experiment's own permanent rule) is dispatched by the orchestrator's
   own native Agent tool, one audit per iteration, never self-performed.
   N concurrent iterations would need N concurrent (or N sequential,
   post-batch) audit dispatches — this is likely the *least* disruptive
   change of the five, since the orchestrator's own native tools can
   already fan out multiple Agent calls in one turn (as this
   experiment's own history, e.g. DIR-025's 3b concurrency trial,
   already demonstrates for manda `Agent` calls) — but it does mean the
   audit's own "context from prior iteration" framing (currently
   assuming one linear predecessor) would need updating to "context
   from the batch's frozen baseline," mirroring point 2 above.

**This is design-only identification, explicitly not an attempt at 3c
or 3d's actual execution** — no concurrent-iteration trial was run this
iteration, and none is claimed. This satisfies 3d's own conditional
text as far as it can be satisfied absent 3c, and gives "whichever
iteration first attempts step (c)" concrete design input to work from,
per 3d's own stated purpose ("so the follow-up directive has real,
evidence-based design input rather than speculation").

`ToolSearch("subagent dispatch spawn delegate concurrent")` re-run this
iteration: still no native fresh-context subagent-dispatch primitive —
re-trigger condition 4 (provenance.md standing-fact note) not met.

## 7. Provenance update

No new task, no `{author_by, execute_by, gate_by}` triple changed this
iteration. σ_strict is unchanged.

```
σ_strict = 62 / 70 = 0.8857  (unchanged from iteration 84)
```

## 8. V_instance

`skeleton` = 0.83, `abi_symmetry` = 0.96, `gate_correctness` = 0.76,
`skill_convergence` = 0.96 — all four factors re-checked directly this
iteration (full regression suite re-run, ABI symmetry re-run, no gate
logic touched, no Skill content touched, no production file modified —
`git status --short` confirms only documentation-layer files touched).

```
V_instance = 0.83 × 0.96 × 0.76 × 0.96 = 0.5813  (unchanged)
```

No credit claimed: this iteration's actual work (a convergence
reassessment and a design-only DIR-025 3d note) produced zero
production diff, no new schema-symmetry proof, no gate-logic change, no
newly-exercised Skill-orchestration branch.

## 9. V_meta

`completeness` = 0.74, `effectiveness` = 0.26, `reusability` = 0.79,
`validation` = 0.64 — **all four factors held flat**, 9th consecutive
iteration (77 was the last movement; 78-85 flat). Re-trigger conditions
1-4 (provenance.md's standing-fact note) checked directly this
iteration: condition 1 (scope-matched new task) not met (§3); condition
4 (native subagent-dispatch primitive) not met (§6, fresh `ToolSearch`);
conditions 2/3 not organically raised. Condition 5 (12 iterations with
none of 1-4 triggering) is at iteration count 1 of 12 since the note was
added at iteration 84 — not yet due.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973  (unchanged)
```

This iteration's actual, distinct contribution to the *system* (not to
any V-factor score) is: (a) the whole-experiment convergence synthesis
in §5, which assembles a genuinely new cross-layer observation
(`gate_correctness`'s own documented ceiling, previously scattered
across 11 separate iterations' reasoning, now assembled into one place
alongside V_meta's already-formalized ceiling) that iteration 84 itself
did not have; (b) DIR-025 3d's design-only identification (§6), a
genuinely new, not-previously-attempted angle. Neither is a production,
gate, ABI, or Skill-content change, so — consistent with the precedent
this file has applied since iteration 25/28/36/82/84 — neither is
credited as V-factor movement. Writing an analysis down is not the same
as the analysis's *subject* (the methodology) having demonstrably
changed.

## 10. Out-of-band audit

Not performed by this session. Per standing G3 discipline, the
independent out-of-band audit of this iteration's work is dispatched
separately by the top-level orchestrator, via a native `Agent`/Task tool
invocation, never self-performed by the executing iteration and never
via manda (retired per DIR-015 action 3). This iteration explicitly did
not dispatch its own G3 audit.

## 11. Convergence Check

- [ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80) — **NO**.
      V_instance = 0.5813, V_meta = 0.0973, both far below 0.80 (§5.1).
- [ ] 2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate) — **NO**. σ_strict = 0.8857, not 1; no new increment was
      built this iteration to test zero-seed reproduction.
- [ ] 3. Contract proven (native + GitHub both run) — **partially true**
      (both run, per extensive prior evidence) but not sufficient alone
      per protocol §7's "all hold" requirement.
- [ ] 4. Out-of-band audit passed — iteration 84's audit passed (PASS);
      this iteration's own audit is pending, to be dispatched separately
      by the top-level orchestrator.
- [x] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations) — **YES**,
      now 8 consecutive flat iterations (78-85), both layers, all eight
      factors independently re-verified each time.

**Status**: **NOT CONVERGED** per protocol §7's literal criteria — this
is unambiguous and this iteration does not qualify it. **Separately**,
this iteration's own independent judgment (§5.3) is that the informal
**Practical Convergence** pattern this experiment has used before
(iterations 16-17, 83's audit, 84) is now genuinely, evidence-backed
satisfied — **recommended, not declared**, and requiring explicit
orchestrator/human sign-off before any wind-down action is taken. See
Conclusion below.

## Problems identified for next iteration / Conclusion — the explicit
## recommendation and what it does and does not authorize

**This iteration's recommendation, stated plainly and only once, to
avoid diluting it with hedging:** the orchestrator/human should now
explicitly decide, as a distinct act separate from any single
iteration's routine work — mirroring exactly how iteration 16's fork
was handled (surfaced, not resolved, by the iteration that found it) —
between:

**(A) Formally declare Practical Convergence.** Recognize that this
experiment's organically-available growth path is genuinely exhausted
at V_instance=0.5813 / V_meta=0.0973 / σ_strict=0.8857, given: 8
consecutive independently-reverified flat iterations across all eight
V-factors; a structurally (not merely low) exhausted 70-task backlog;
and now, as of this iteration, a documented architectural ceiling
covering **both** V_meta's three long-stalled factors (provenance.md,
iteration 84) **and** V_instance's own lowest factor (`gate_correctness`,
this iteration's synthesis). If chosen, this should trigger a
**results-analysis / wind-down phase** — NOT deletion of
`ITERATION-PROMPTS.md`, NOT archival of the standing SOPs (DIR-021,
DIR-025), and NOT a claim that protocol §7 was met. It would mean:
write a comprehensive final synthesis (system output, reusability
validation, history comparison per the experiment's own termination
clause), while leaving the loop machinery intact in case a re-trigger
condition (provenance.md's 5 V_meta conditions, or a `gate_correctness`-
equivalent one this iteration's own reasoning implies should be added
alongside them) fires later.

**(B) Continue iterating**, on the honest grounds that a genuine,
identifiable path to move V_instance and/or V_meta still exists. This
iteration's own search (§3, §5, §6) did not find one that avoids either
(i) requiring an external infrastructure change (a native subagent-
dispatch primitive) this experiment cannot produce internally, or (ii)
manufacturing new scope purely to generate a data point, which G5
already prohibits. If the orchestrator/human judges otherwise — e.g.,
believes a real, non-manufactured new workload (a genuine new backlog
item, a real GitHub-Provider write need) is imminent or should be
deliberately introduced — that is (B), and should be executed as a
deliberate, acknowledged increment (mirroring iteration 17's precedent
for V_meta specifically), not as another routine "look for gaps" pass.

**(C) Some other honest characterization** — e.g., partial wind-down
(begin results documentation while formally leaving the loop open,
rather than a binary converged/not-converged framing) — is also a
legitimate outcome this iteration does not foreclose; it is named here
because the dispatch instructions explicitly invited it, and this
iteration's own view is that (A) is the best-supported single answer,
but (C) is a defensible fallback if the orchestrator/human weighs the
"AGAINST" case in §5.3 (self-hosting proof at scale genuinely not
demonstrated) more heavily than this iteration does.

**This iteration does not choose between (A)/(B)/(C)** — consistent
with the explicit instruction governing this iteration, and with this
experiment's own iteration-16/17 precedent for handling exactly this
class of decision. What this iteration does commit to, honestly:
running an 86th iteration in the identical "re-verify the same 8-flat-
iteration plateau, find nothing new" pattern, without either this
recommendation being acted on or a genuinely new external trigger
occurring, would not be adding new information — this report's own
synthesis (assembling the `gate_correctness` ceiling alongside V_meta's
already-documented one) is likely close to the last genuinely new
whole-experiment-level observation available from *this* backlog and
*this* environment without one of (A)/(B)'s preconditions changing.

**Standing items carried forward, unmodified by this recommendation:**

- DIR-021 remains `pending` (standing SOP) — not triggered this
  iteration, no manda dispatch organically needed.
- DIR-025 remains `pending` (standing SOP) — action 3d given design-only
  treatment this iteration (§6); 3c remains not actionable (no suitable
  independent backlog, re-confirmed §3).
- `provenance.md`'s V_meta standing-fact note's re-trigger conditions
  remain in force, unmodified; this iteration adds no new score but
  does recommend (for whichever iteration next touches that section)
  that a sixth, `gate_correctness`-specific re-trigger condition be
  considered for addition, mirroring the existing five, given this
  iteration's finding that its ceiling is equally structural.
- No `tasks/QN-*.md` file created or modified. No production code
  touched. `git status --short` confirms only
  `experiment/iterations/iteration-85.md` and `experiment/provenance.md`
  changed by this iteration's own edits.

## Artifacts

- This report: `experiment/iterations/iteration-85.md`
- `experiment/provenance.md` — new "Iteration 85" compact-summary
  section appended (this commit); σ_strict/V_instance/V_meta all
  unchanged (62/70=0.8857, 0.5813, 0.0973).
- No production or test source files touched.
- No new/modified task files.
- No directive files modified (DIR-021/DIR-025 both re-read, neither
  triggered nor altered).
