# Inherited Core (Tier-B pinned methodology) — quay-perpetual-stream (Experiment 5)

The reusable inner methodology every milestone charter inherits by reference (charter Tier-A pins a
path + git SHA to this file; it is NOT inlined per iteration). Consolidation (§4.2) grows this file:
when a milestone adaptation is reused unchanged by a later different-domain milestone (φ confirmed),
merge it here and retire its delta citation.

## Kit version + single-source convention (DIR-035-D, ADR-013 Decision item 3 / Consequences)

**This file IS the one canonical "continuous-development-with-Claude-Code" methodology kit** — the
BAIME outer/inner loop pattern (`OUTER-LOOP.md`'s operational steps), this Tier-B pinned-methodology
substrate, the DoD meta-enforcer (`scripts/it0-dod-check.mjs` + the QENG gate engine wrapping it),
the general `scripts/it0-*`/`vmeta-lag`/`audit-independence`/`dogfood-evidence` gate scripts, and
`adr/ADR-001..013`. There is exactly ONE copy of this kit in this repo, at this path.

**Kit version:** `v1` (informal — no prior versioned releases; this is the first explicit version
tag). **Last consolidated at:** git SHA `b17caab` (the commit that last touched this file, per
`git log -1 -- experiments/quay-perpetual-stream/inherited-core.md`, as of DIR-035-D/M52).

**Single-source rule for any FUTURE second experiment (or a foreign-repo transfer per DIR-036):** a
new experiment directory MUST NOT copy this file's content. It must instead:
1. Reference this kit BY PATH (a relative path from the new experiment's own directory to this
   file, e.g. `../quay-perpetual-stream/inherited-core.md`, mirroring the EXACT by-reference
   discipline `OUTER-LOOP.md` already uses for itself: "a pinned pointer (path + git SHA) to
   `inherited-core.md` — Tier-B, not inlined" — applied here one level up, kit-vs-second-experiment
   rather than charter-vs-kit-within-one-experiment).
2. Record, in its OWN (thin) instance-state doc, the **kit version + git SHA it is pinned to**
   (the same two facts recorded above), so a later kit consolidation can tell which experiments are
   stale against the canonical file without diffing full copies.
3. Carry ONLY its own mutable instance state (its own `dashboard.md`-equivalent, its own DIR/task
   backlog, its own charters/milestones) — never a forked/edited copy of this file itself. If an
   experiment genuinely needs a methodology DELTA the kit doesn't yet have, that delta is proposed
   as an edit to THIS file (consolidation, §4.2's existing discipline), not a private fork.

**Audit finding (2026-07-20, DIR-035-D/M52):** a repo-wide search for `inherited-core*.md`-shaped
files found exactly this ONE live file. The four other experiment directories
(`quay-native-bootstrap`, `quay-webui-bootstrap`, `quay-continuous-bootstrap`,
`quay-core-bootstrap`) are all closed/historical and predate this file's introduction (exp5 is the
first and only experiment to adopt the Tier-B `inherited-core.md` convention) — each instead has
its own bespoke `ITERATION-PROMPTS.md`, a different, pre-Tier-B mechanism, not a copy of this kit.
**There is no live duplication to consolidate today**; this section exists so the convention is in
place and followable BEFORE a second experiment (or DIR-036's foreign-repo transfer) is ever
started, rather than discovered as a violation after the fact.

## Standing invariants (govern EVERY milestone)
- **Enforcement lands WITH design (ADR-011, the #1 cross-experiment fault; sharper-timing corollary
  of ADR-004 hard-over-soft).** A new rule / DoD-clause / method-step is **NOT "done" unless its
  executable enforcement (a gate/check/code) AND a fixture proving it land in the SAME milestone.**
  Phased "design now, wire the enforcement later" is prohibited — a design without its landed
  enforcement is `pending`, not done (DIR-026's "a slice is not done" applied to method changes).
  Partially enforced today by Clause 5 (no-self-exemption), the DoD real-landing bar, and the B7
  load-bearing-test-gate; the full mechanical gate is tracked as `exp5-M-CRYST-INV`. This is why the
  crystallization program exists — see `docs/proposals/exp5-crystallization-strategy.md` and
  `adr/ADR-004`/`ADR-011`.

## Extracted skills (read in order — delta chain)
1. `.claude/skills/quay-native-methodology/` — full base (gate mechanics `task check`, directive
   lifecycle, G3 out-of-band audit discipline, provenance/σ ledger).
2. `.claude/skills/quay-core-bootstrap-methodology/` — delta: manda nested dispatch, G3-dispatch
   discipline (DIR-003), σ-inherited-floor trap, multiplicative-V_meta ceiling diagnostic.
3. `.claude/skills/quay-webui-bootstrap-methodology/` — delta: §0c independent holistic visual
   review, σ floor-RESET, dual-viewport requirement, domain-misfit audit-channel need.

**Known weakness (this experiment must fix via consolidation):** the delta chain must be read in
order; there is no single consolidated core, and citations can drift. First consolidation target is
to merge the confirmed φ edges (§0c visual-review; dispatch/G3 discipline; σ-floor handling) into a
single authoritative core section here.

**Status (M10-audit-consolidation, m10):** this "First consolidation target" trio is now DONE —
all three φ edges have operational sections below, not bare citations: "Web UI verification
requirement" (§0c visual-review, mechanized as a Done-when evidence rule rather than the
narrative-language failure DIR-006 found), "Adversarial-audit role" + "manda-dispatch discipline"
(dispatch/G3 discipline, split into its two distinct halves — G3's cross-role refutation charge,
which had been silently narrowed to same-template re-verification per DIR-007, and the
manda-mechanics precondition rules per DIR-008), and "σ-inherited-floor trap" (σ-floor handling,
including the m4 case study where the un-consolidated version of this trap already cost a real
−6.60 VT correction). The delta chain above is NOT retired — it remains the fuller historical
source for anything these consolidated sections don't cover — but citations for these three
specific topics should point to the sections below, not back up this list.

## exp4 methodology (NOT yet extracted to a skill — inherited as artifacts)
- `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` — hardened HARD GATES block (the
  **verbatim source for charter gate transclusion**), §0c continuous simulated-user, non-blocking
  dispatch.
- `experiments/quay-continuous-bootstrap/VMETAFORMULA.md` — the DIR-008 V_meta redesign record.
- `experiments/quay-continuous-bootstrap/directives/archive/DIR-009-*.md` — the gate-dilution failure
  and the mechanically-self-proving-gate fix (basis for the hash-check invariant).

## exp5-native additions (from the offline-replay design)
- **Charter three-tier contract** (protocol §3.1) + gate transclusion + hash check.
- **Inner termination five conditions**, calibrated K=2 / budget≈10 (protocol §3.2; `RESULTS.md` A).
- **Systematic-explore it0 checks** — ceiling arithmetic, gate-hash, dogfooding evidence-gate,
  domain-misfit audit-channel (protocol §4.4; `RESULTS.md` B2).
- **Binary Done-when mandatory** per milestone (protocol §3.4).

## Pinned gate source (transclude verbatim into every charter)
`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` HARD GATES block (raw-output bar,
per-file directive disposition, worktree isolation proof, process-blocking-gap enumeration).
The charter must copy this byte-for-byte; a hash/substring check asserts no paraphrase (DIR-009).

## Domain-misfit audit-channel — concrete decision procedure (M02-gates Done-when clause 4)

The it0 systematic-explore check "domain-misfit audit-channel" (protocol §4.4d) was previously
framed abstractly: "does this new domain have an independent audit channel?" That framing requires
judgment with no worked steps. This section replaces it with a concrete procedure a future
charter-author applies directly at it0, BEFORE dispatch:

**Step 1 — name the domain's existing verification mechanism(s).** List every mechanism this
milestone's own Done-when clauses already require to demonstrate correctness (e.g. "CI job run",
"local test suite", "manual click-through"). If the list is empty, STOP — the charter has no
Done-when evidence plan yet; fix that first (this is really a Check 3 failure surfacing here).

**Step 2 — ask: is any listed mechanism SELF-REFERENTIAL (the same process/actor that produces the
work also verifies it, with no independent second observer or environment)?** A local `node --test`
run performed by the same iteration that wrote the code is not independent (same process, same
assumptions can be baked into both the code and the test). A CI job invoked by a real external
trigger (tag push, PR event) run in a separate, differently-provisioned environment IS independent,
even if it runs "the same" test suite — the environment and trigger are the independent variable,
not the test content.

**Step 3 — if Step 2 finds NO independent mechanism among the Done-when list, the domain has a
misfit: the milestone's plan currently has no audit channel and MUST add one before dispatch.**
Concretely, prefer (in this order, most to least preferred):
  a. **Reuse an existing out-of-band mechanism from a DIFFERENT actor/environment** than the one
     producing the work (e.g. a CI job on a hosted runner, a container with a deliberately
     different capability set than the dev sandbox, a second reviewing agent/process).
  b. **Construct a minimal new one** if (a) doesn't exist for this domain — but it must be
     something that can FAIL independently of the implementation succeeding by construction (a
     check that always passes when the code "looks right" is not an audit channel, it's a
     restatement).
  c. If neither (a) nor (b) is reachable at all (rare — most domains in this repo have at least a
     CI job or a container available), this IS a genuine ceiling per §3.2 condition 3 — redesign
     the milestone's scope rather than silently dispatching without an audit channel.

**Step 4 — the SAME mechanism should serve BOTH the it0 declaration and the actual iteration-time
verification.** Do not declare one audit channel in the abstract at it0 and then verify with a
DIFFERENT mechanism later — that's exactly the drift this procedure exists to prevent. If the it0
channel and the later verification diverge, that divergence itself should be logged as an
adaptation-log finding, not silently absorbed.

### Validation against M01-dist's own finding (self-consistency check)

M01-dist's it0 (§4.4d in its charter) named its audit channel abstractly: "a fresh shell (or CI job)
with no local Node install, running the built executable directly." Applying the procedure above
retroactively:
- **Step 1**: M01-dist's Done-when list already required CI (clauses 2/3) and local build
  verification (clause 4).
- **Step 2**: the local build+test-suite run (§5.5 of iteration-0) is self-referential (same
  sandbox, same process that wrote the SEA build scripts). The Node-free container run (§5.4) is
  NOT self-referential — it is a `debian:stable-slim` Docker container that never had Node
  installed, a genuinely different environment than the dev sandbox that wrote the code.
- **Step 3**: an independent mechanism EXISTS (the Docker container) — no ceiling, proceed to
  dispatch with that as the declared channel. This matches M01-dist's own it0d declaration exactly.
- **Step 4**: M01-dist's adaptation-log entry #1 (iteration-0 §9) independently arrived at exactly
  this same conclusion — "the it0 domain-misfit audit-channel and the CI verification job should
  be the literal same mechanism" — encoding the SAME Docker container pattern into the
  `sea-verify-node-free` CI job (§6) rather than inventing a second, different check for CI.

**Result: applying this procedure to M01-dist's own it0 produces the same audit-channel answer
M01-dist actually used** (a Node-free container, later mechanized identically in CI) — confirming
the procedure is a faithful concretization of what M01-dist already did by judgment, not a
redescription that would have given a different answer.

### CONSOLIDATED — φ-confirmed pattern: the audit channel IS a CI job (M07-vmeta-gate ABSORB, m7)

The procedure above (Steps 1-4) is the general decision procedure. The specific PATTERN it produced
when first applied (M01-dist, chart-0) — **"an independent, differently-provisioned CI job run is
the audit channel"** — has now been independently reused, unchanged, by a SECOND different-domain
milestone: M03-abi-eval's cross-provider differential conformance suite (18/18 scenarios, native vs.
real `yaleh/quay` github provider) served as its own audit channel by the exact same reasoning
(Step 2: an externally-triggered CI run in a separately-provisioned environment, not a
same-process/same-assumptions local check) — cross-platform (M01-dist) → cross-provider
(M03-abi-eval), a genuinely different domain, not a repeat of the same check.

Per §4.2's φ fold-back definition ("a LATER different-domain milestone reuses an adaptation
unchanged"), this crosses the 2-cross-domain-confirmation threshold as of M03-abi-eval (m3) and is
now **CONFIRMED**, not merely proposed-and-validated-once. Tracked going forward in
`v-meta-ledger.md` (added M07-vmeta-gate); this note is that ledger row's `consolidated` disposition
— the pattern itself was already written up above (Steps 1-4 + M01-dist validation), so
consolidation here means recording the SECOND confirming instance and retiring the citation as
`confirmed`+`consolidated` rather than re-deriving the procedure a third time. Any future milestone
citing "the domain-misfit audit-channel is a CI job" pattern should treat it as an established,
twice-confirmed convention (cite this subsection), not a fresh proposal needing re-justification.

## Milestone size definition + verify-iteration size gauge (M06-sizing Done-when clauses 1-2)

DIR-004's finding, reviewing m1-m5: "2 inner iterations" is a cost-proxy artifact of the
build+verify template, not a real size signal. This section replaces that artifact with an
explicit definition and a concrete gauge a future charter-author (or SELECT) applies directly,
mirroring how the domain-misfit section above replaced ad hoc judgment with a decision procedure.

**Size definition.** A correctly-sized milestone is: *the smallest scope that carries a coherent
value step AND fits the build+verify cost band* — i.e. iteration-0 can land ALL of the charter's
Done-when clauses in one pass, and iteration-1 exists purely to independently re-derive/re-verify
iteration-0's own claims (fresh worktree, fresh checks, no new Done-when work required). No
mid-milestone re-scope should be needed. When a coherent value step genuinely does not fit in one
cost unit, the correct response is to **split along a different seam** (find a smaller coherent
sub-step that still stands alone) **or explicitly budget a multi-build milestone** at
charter-authoring time (state up front that iteration-0 AND iteration-1 will both do new build
work, as a deliberate choice, not a discovered one) — but never ship half a value step split
arbitrarily by the 2-iteration template.

**Verify-iteration size gauge — the concrete decision procedure.** Apply this AFTER iteration-1 of
any milestone completes, as a self-check on the charter's own sizing (and, going forward, apply it
retrospectively during SELECT/charter-authoring as a sanity check on the PROPOSED scope, by asking
"if this scope were dispatched, would iteration-1 have real material to re-derive, or would it be
empty verification?"):
- **"Iteration-1 has nothing real to re-derive"** (it re-runs the same checks iteration-0 already
  ran, on the same artifacts, and finds nothing new) ⇒ **UNDER-SIZED**. The milestone should have
  been bundled — either folded into iteration-0's own Done-when (making iteration-1 unnecessary) or
  merged with a neighboring milestone that shares the same verification surface.
- **"Iteration-1 is forced into new build work, or a mid-milestone re-scope happens"** (iteration-1
  has to write new code/config to finish what iteration-0 didn't, or the charter's Done-when list
  has to be edited mid-flight) ⇒ **OVER-SIZED**. The milestone's scope should have been split at
  charter-authoring time along a seam that gives iteration-0 a completable, self-contained unit.
- **Correctly sized** sits between these: iteration-1 does REAL independent work (fresh worktree,
  fresh `npm install`, re-running checks from scratch rather than trusting iteration-0's prose,
  hand-recomputing arithmetic, spot-checking citations against source) and that work genuinely
  CATCHES something (an error, a stale claim, a bug) often enough to be worth the cost, without
  needing to do new Done-when-scoped build work to get there.

**Worked examples (self-consistency check, mirroring how the domain-misfit section validates
against M01-dist):**
- **m1/M01-dist — OVERSIZED.** Iteration-0 delivered the SEA builds. Iteration-1 was NOT pure
  re-verification: it pushed to a real remote and tag-pushed v0.3.0→v0.3.4, fixing **4 distinct
  real CI failures** (Windows MSYS path resolution needing `cygpath -w`; `gh` absent in the bare
  container, switched to REST API; private-repo release assets needing the dedicated
  `/releases/assets/{id}` endpoint rather than `browser_download_url`) before reaching a green run.
  That is substantive NEW build work discovered and executed inside "iteration-1", not independent
  re-derivation of iteration-0's claims — the CI-integration half of the milestone's own Done-when
  scope (clause 3, "workflow has actually run on GitHub") was still open at the start of
  iteration-1. Per the gauge: forced into new build work ⇒ oversized; the CI-integration/real-push
  step should have been its own explicit charter unit or iteration-0 should have budgeted for it
  up front as a declared multi-build milestone, not discovered as overflow.
- **m2/M02-gates — correctly sized.** Iteration-0 built and committed all 3 scripts plus the
  domain-misfit procedure, all 6 Done-when clauses met. Iteration-1 was a genuine independent
  re-verification pass: fresh re-run of all 3 scripts against fresh fixtures (zero drift found),
  independent confirmation iteration-0's commit was actually present (not just claimed), and an
  investigation of a real dogfood-gate FAIL against M01-dist's own report — which iteration-1
  determined was a CORRECT positive (real evidence existed but past the script's default 40-line
  window), not a script bug. That is exactly "real material to re-derive": a genuine question
  (is this FAIL a bug or a correct catch?) that iteration-1 had to independently resolve, with a
  real answer that could have gone either way.
- **m4/M04-discover — correctly sized.** Iteration-0's persona sweep found MD-001 (a real
  merge-drift measurement error). Iteration-1's independent re-verification pass RECOMPUTED the VT
  arithmetic from scratch and found the correction was real (VT chart-1 94.73/120, a genuine
  decrease from the pre-correction number) — an independent re-derivation that could have
  contradicted iteration-0's finding but confirmed it instead. No new Done-when-scoped build work
  was required in iteration-1; the milestone's own scope (persona sweep + re-score) was fully
  landed by iteration-0.

**Result: applying this gauge to m1/m2/m4 reproduces the same oversized/correctly-sized verdicts
DIR-004 already reached by direct review** — confirming the gauge is a faithful concretization of
that judgment, not a redescription that would give a different answer (same self-consistency
pattern as the domain-misfit section's own M01-dist validation above).

### Milestone ceiling expansion — ≤2000-line milestone, nested ≤500/≤200 phase/stage budgets
### (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2; amends, does not replace,
### the size definition/gauge above)

The size definition and gauge above (M06-sizing/DIR-004) answer HOW to judge whether a given
scope fits ONE build+verify cost unit; they deliberately leave open HOW LARGE a single coherent
value step is allowed to be before it must be split. `docs/proposals/exp5-quay-task-proposal-plan-
skill.md` §4 ("Milestone sizing: expand to ≤2000 lines — but only because the plan makes it safe")
answers that open question. This subsection adopts that answer as substrate, cited (not
re-derived) here:

**The ceiling, with nested sub-budgets:**

```
milestone ≤ ~2000 lines   =  one whole plan (multiple phases)
   phase  ≤ ~500  lines
   stage  ≤ ~200  lines
```

**This is an AMENDMENT to the size definition above, not a replacement.** Every milestone run in
this experiment so far (m1-m17) has been small enough that the size definition's own gauge
("iteration-0 lands ALL Done-when in one pass, iteration-1 purely re-derives") applied directly,
with no phase/stage structure needed — that regime is UNCHANGED and remains the default for
methodology/design-class milestones (see the two-class diversity policy below). This subsection
adds a SECOND regime, for milestones whose coherent value step genuinely does not fit the existing
small-milestone norm: it may be sized up to ~2000 lines, but **only when accompanied by an explicit
phase/stage decomposition plan** (produced by the future `quay-task-to-plan` skill, DIR-012 item 3,
not yet built — or, until then, by the existing `proposal-to-plan` skill, per DIR-012's own
`docs/plans/3-7-quay-task-to-plan-skill.md` precedent, itself produced this way).

**Why this expansion is safe ONLY when decomposed, stated explicitly (the load-bearing
qualification, per the design doc §4):** exp5's inner-convergence record (13/13 milestones, no
mid-milestone re-scope, as of m17) has held only because milestones have been kept small. Going to
~2000 lines WITHOUT a phase/stage plan would almost certainly force the exact mid-milestone
re-scope the size-gauge's OVER-SIZED verdict (m1/M01-dist, above) already demonstrates happens once
a milestone exceeds one coherent build+verify unit. The plan is what CONTAINS the risk the larger
ceiling introduces — a milestone sized above the small-milestone norm with no accompanying
phase/stage plan is not a correctly-sized large milestone, it is an under-planned one, and must be
rejected/resized at SELECT time exactly as the existing size definition's OVER-SIZED case already
requires (this is a restatement of that existing discipline at a new scale, not a new kind of
discipline). **The ≤2000-line ceiling and the phase/stage plan requirement ship together — a
charter may not claim the larger ceiling while skipping the decomposition.**

**Relationship to the existing gauge:** the verify-iteration size gauge above still applies
UNCHANGED to whichever unit is actually being judged — for a ceiling-expanded milestone, that unit
is the PHASE (≤500 lines) or STAGE (≤200 lines), not the whole ~2000-line milestone; the gauge's
"iteration-0 lands it in one pass, iteration-1 re-derives" question is answered per-phase/stage
under this regime, exactly mirroring how it was already answered per-milestone under the
small-milestone regime. This is the concrete meaning of "one whole plan (multiple phases)" above:
the plan is what lets a ~2000-line milestone be judged, phase by phase, against the SAME gauge that
already governs small milestones — not a different, looser standard.

**Mechanical enforcement:** see `OUTER-LOOP.md`'s SELECT/charter-authoring step for the plan-time
line-budget gate that checks this at charter-authoring time (a real script, not a narrative
reminder) — `scripts/it0-ceiling-line-budget-check.sh`, demonstrated below.

**Source:** `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §4 (cited, not duplicated in
full — the design doc's own worked reasoning, the meta-cc/quay `proposal-to-plan` review-loop
evidence it cites, and the "clamp at both ends" pipeline context all live there; this section
states only the operational rule and its enforcement pointer).

## Value-typed SELECT ledger + governance/infra hard floor (M06-sizing Done-when clauses 2-3)

VT (the chart-0/chart-1 capability-growth score) prices only ONE kind of milestone value. DIR-004's
finding: this made SELECT compensate with ad hoc prose whenever a milestone's real value was NOT
capability-growth (m2 scored 0 VT despite delivering real risk/option value — DIR-004's own table:
"pre-empted 3 wasted SELECTs" — and m5 likewise scored 0 despite real governance-integrity value;
m4 scored **-6.60** VT despite being one of the two most valuable milestones so far, because it
corrected a standing measurement error (MD-001) rather than growing a capability). This section
gives SELECT a named, structured ledger instead.

**The five value types** (apply at SELECT time — a candidate may carry more than one):
1. **capability-growth** — closes a real capability gap on an existing VT chart surface; the only
   type VT Δv̂ prices directly.
2. **discovery** — finds previously-unknown gaps/errors via an independent audit channel (persona
   sweep, differential conformance, etc.) that the method could not see before; value is in the
   NEW information, not a capability delivered.
3. **instrument-correction** — fixes a standing error in the measurement/method itself (a wrong VT
   number, a broken check, a stale gap-list entry) rather than the product; often VT-negative on
   paper (correcting an inflated number looks like a regression) while being high real value.
4. **risk/option** — reduces a forward-looking risk or preserves future optionality (e.g. closing a
   repeat-governance-drift pattern before a 3rd instance) rather than delivering present capability
   or catching a present error.
5. **governance-integrity** — ensures the experiment's own control/decision mechanisms (SELECT,
   directive handling, projection/enforcement) actually do what they claim, independent of any
   single milestone's product content.

**Governance/infra hard floor (SELECT-time check, mandatory):** a governance/infra candidate whose
proposed scope excludes its own enabling/enforcement half must be **rejected or resized at SELECT
time — never dispatched partial.** (The DIR-002/DIR-006 lesson, generalized: exp4's DIR-006
"files-canonical" resolution built the canonical-files half but never the enabling projection
tooling, was rationalized as a completed decision instead of a partial one, and the identical gap
resurfaced as exp5's DIR-002 — a second, avoidable instance of the same drift. The fix is to check
BEFORE dispatch whether a governance/infra candidate's stated scope covers enforcement, not just
declaration, and block/resize at SELECT if it doesn't.) This check applies forward from m7; it is
NOT applied retroactively to re-open m1-m5's already-settled scope decisions.

**Ranking discipline:** VT Δv̂ is one input among several at SELECT, never the sole ranker — a
candidate with zero or negative VT Δv̂ but a governance-integrity or instrument-correction value
type can and should outrank a positive-VT capability-growth candidate when the non-VT risk is
higher (see M06-sizing's own SELECT log entry, dashboard.md, for a live worked instance: chosen
over M-GH-WRITE/M-GH-PARENT which had the only positive VT Δv̂≈+3-4 among the m6 candidates).

### Two-class diversity policy — methodology/design vs. development-class milestones
### (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2 / requested-action item 2;
### source: `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §5)

The value-typed ledger above classifies milestones by VALUE TYPE. This subsection adds a second,
orthogonal classification — **milestone CLASS** — keyed on the same ledger's value types, that
determines WHERE independent-re-derivation diversity is spent for a given milestone. Diversity is
a budget, not a free good; where it should be spent differs by what kind of deliverable a
milestone produces:

| class | deliverable | value-type(s), per the ledger above | diversity strategy |
|---|---|---|---|
| **methodology / design** (the M10-M17 precedent — doc-only) | a design/doc artifact | typically `discovery` / `governance-integrity` / `instrument-correction` | **whole-milestone independent re-derivation, UNCHANGED** — iteration-1 independently re-derives the entire deliverable from a fresh worktree, exactly as M01-M17 already do. Cheap: the whole deliverable is a doc. |
| **development** (the M16-CLI-EDIT-PARITY-IMPL precedent — real product-code changes) | working code, ≤~2000 lines per the ceiling above | typically `capability-growth` | **MUST (DEFAULT, DIR-014 items 2/3 — no longer discretionary)** use the narrower pattern: N-independent-proposal re-derivation + adjudication (upstream) → single implementation → light tail self-check (downstream: the existing adversarial-audit gate, unchanged) — INSTEAD OF whole-milestone dual iteration, run via the `quay-task-to-plan` skill wired into `OUTER-LOOP.md` step 5a. |

**No longer a MAY — the precondition is now SATISFIED (DIR-014 items 2/3, 2026-07-19).** The
`quay-task-to-plan` skill that this policy's precondition named **now exists** (built M20/M22) **and
is wired into `OUTER-LOOP.md` step 5a as a MANDATORY dispatch route** for development-class
milestones. So the earlier discretionary framing (a charter-by-charter option, gated on the skill's
future existence) is retired: a development-class (`capability-growth`-typed, product/skill-code) milestone **MUST** run
the proposal→plan pipeline via step 5a — it is the DEFAULT, not a charter-by-charter option. A
development-class milestone that runs the old whole-milestone dual-iteration instead of the pipeline
is a policy/DoD violation. The methodology/design class is unchanged (whole-milestone re-derivation).

**Historical note (M18, superseded 2026-07-19):** when M18 first wrote this policy, the skill did
not exist, so the policy was a forward-looking STATEMENT and M18 itself correctly did not use the
pattern. That precondition is now met (DIR-014 items 2/3 wired the skill into DISPATCH and
de-optionalized this policy); the "does not exist yet / future work" caveat no longer applies.

**Mechanism detail — see the design doc, not duplicated here.** The concrete pipeline shape a
development-class milestone would run under the narrower pattern — "clamp at both ends" (N
independent proposal subagents + adjudication upstream, single implementation with a plan-check in
the middle, the existing adversarial-audit gate unchanged downstream) — is specified in
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §6 ("The pipeline — clamp at both ends, plan-
check in the middle"). This section states the POLICY (which class uses which diversity strategy,
and under what precondition); it deliberately does not duplicate §6's full pipeline diagram or
mechanism detail here, to keep this Tier-B pinned-substrate file's size controlled (DIR-009's
charter-thinness discipline, applied to Tier-B as well as Tier-A) — a future charter invoking this
policy should read §6 directly for the mechanism.

### Self-consistency check: retroactively applying the ledger to m1-m5 (read-only, M06-sizing
### Done-when clause 4 — does NOT rewrite dashboard.md's settled VT numbers)

Applying the five value types to each of m1-m5's actual, already-settled outcome (per
`dashboard.md`'s Log section, read-only):

| Milestone | VT Δv (settled) | Value type(s) applied | Matches DIR-004's own characterization? |
|---|---|---|---|
| m1/M01-dist | +6.0 | **capability-growth** (closed Packaging/Distribution cov gap 0.55→0.85) | Yes — DIR-004 implicitly treats m1 as the capability-growth baseline case (the one with a real positive VT number), only flagging its SIZING as mildly oversized, not its value type. |
| m2/M-GATES | 0 | **risk/option** (mechanized 3 of 4 it0 checks, gate-hash/ceiling/dogfood scripts + domain-misfit procedure — pre-empted wasted SELECTs on stale/unreachable candidates, e.g. the M-CLI-UX rejection at m2's own attempt-1 and M-DOCS/M-DIRTASK rejections at m3, each with 0 wasted inner iterations) | Yes — DIR-004's own table (archived directive, line 54) reads verbatim: "m2 M-GATES \| 0 \| risk/option value (pre-empted 3 wasted SELECTs) \| no — scored 0", matching risk/option here exactly. (**Correction, iteration-1**: the prior draft of this row labeled m2 governance-integrity and attributed that to a "real governance/method-infra wins" quote — that exact phrase does not appear anywhere in DIR-004's archived text. DIR-004's own table explicitly types m2 as risk/option, not governance-integrity; governance-integrity in DIR-004 is applied to m5/M-DIR-PROJECTION's successor framing, not m2. Fixed to match DIR-004's own table verbatim, since this Done-when clause's entire purpose is to reproduce that table, not a paraphrase of it.) |
| m3/M-ABI-EVAL | ≈0 direct (chart transition/re-baseline) | **discovery** (Provider-ABI capability matrix + differential conformance suite surfaced 2 previously-unknown gaps, PR-ABI-001/002, via an independent audit channel the method didn't have before) | Consistent — DIR-004's table doesn't name m3 explicitly, but its own description ("VT is blind to discovery value (m3)") directly assigns m3 the discovery type, which this row reproduces. |
| m4/M04-discover | **-6.60** | **instrument-correction** (found+fixed MD-001, a standing VT measurement error carried since before m1 — corrected an inflated chart-1 number, which mechanically shows as a VT decrease despite being real value delivered) | Yes — DIR-004 explicitly cites m4's -6.60 VT score alongside its "instrument-correction value (m4, ... scored -6.60 despite being one of the two most valuable milestones so far)" language; this row's label matches verbatim. |
| m5/M-DIR-PROJECTION | 0 (no VT chart weight — method-infra) | **governance-integrity + risk/option** (built the directive-projection anti-drift check, closing a SECOND repeat-instance of the DIR-002/DIR-006 files-canonical-without-enforcement gap — both ensures the control mechanism works (governance-integrity) and forecloses a 3rd recurrence (risk/option)) | Yes — matches this milestone's (M06-sizing's) OWN SELECT-time characterization of m5's successor M06-sizing itself as "governance-integrity + risk/option" (dashboard.md m6 SELECT log entry), and m5's own charter framing ("repeat-governance-drift risk outranks a one-off product-integrity gap"). |

**Result: applying the ledger to m1-m5 reproduces DIR-004's own characterization** — m2 and m4 land
as non-capability-growth types (risk/option and instrument-correction respectively, exactly
matching DIR-004's own table verbatim), m1 lands as the sole clean capability-growth case with a
positive VT number, and m3/m5 land as discovery and governance-integrity+risk/option respectively,
matching DIR-004's own prose description of each. This confirms the ledger's five type definitions
are usable to reproduce a real, already-independently-reached judgment, not just aspirational
categories — the same self-consistency pattern used above for the size gauge (against m1/m2/m4)
and in the domain-misfit section (against M01-dist). No dashboard.md VT number is altered by this
table; it only ADDS a value-type label alongside the existing settled numbers.

### Two-class diversity policy — methodology/design vs. development-class milestones
### (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2; amends, does not replace,
### the value-typed ledger above)

The five value types above classify WHY a milestone has value; this subsection adds a SECOND,
orthogonal classification — WHAT KIND of deliverable a milestone produces — because the correct
independent-re-derivation strategy (how diversity/independence is spent to catch errors) differs by
that second axis, not by value type. Source: `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
§5 ("Two milestone classes, two diversity strategies"), cited here (not re-derived).

**Class 1 — methodology/design-class milestones** (the M10-M17 precedent — doc-only deliverables;
typically `discovery` or `governance-integrity`-typed in the value-typed ledger above, though the
two axes are independent and neither implies the other): deliverable is a design/methodology
document or a substrate edit. Diversity strategy: **whole-milestone independent re-derivation,
UNCHANGED** — the existing two-iteration build+verify template (iteration-0 builds, iteration-1
independently re-derives the whole deliverable from a fresh worktree), exactly as m1-m17 have
already run. This is cheap for this class because the entire deliverable IS a doc — re-deriving it
whole is not wasteful the way re-deriving 2000 lines of implementation would be.

**Class 2 — development-class milestones** (the M16-CLI-EDIT-PARITY-IMPL precedent — real
product-code changes; typically `capability-growth`-typed): deliverable is working code. Diversity
strategy: **MUST (DEFAULT — DIR-014 items 2/3, no longer discretionary) use the narrower pattern
instead of whole-milestone dual iteration** — N-independent-proposal re-derivation (catching the
expensive, cheap-to-catch-early APPROACH error, before any code is written) + a single implementation
pass + a light tail self-check (independence is already spent at both ends: upstream at the proposal,
downstream at the existing adversarial-audit gate, DIR-007/M10, unchanged and reused). The reasoning:
re-deriving ~2000 lines of already-approved implementation wholesale is waste; re-deriving the
APPROACH is not, because a wrong approach caught after 2000 lines are written is catastrophically late
while the same error is nearly free to catch before any code exists. M13's own two independent
iterations diverging on a real design decision (the DIR-010 namespace question) is the existence proof
this pattern is already latent in exp5's practice.

**Precondition is now SATISFIED — this is the DEFAULT, not a MAY (DIR-014 items 2/3, 2026-07-19):**
the proposal-adjudication mechanism this pattern requires — the `quay-task-to-plan` skill — **now
exists** (built M20/M22) **and is wired into `OUTER-LOOP.md` step 5a as the MANDATORY dispatch route**
for development-class milestones. So this is no longer "available to a future charter's discretion":
EVERY development-class (`capability-growth`-typed, product/skill-code) milestone MUST run the
proposal→plan pipeline via step 5a; the methodology/design class continues whole-milestone
re-derivation, unchanged. A development-class charter does not need to opt in by name — step 5a routes
it automatically by class; a development-class milestone that skips the pipeline is a policy/DoD
violation (Clause 3 line-budget + Clause 8 plan-reference both bite).

**Historical note (M18, superseded 2026-07-19):** when M18 wrote this policy the skill did not exist,
so M18 correctly did not switch patterns and the policy was a forward-looking statement. DIR-014 items
2/3 have since built the wiring and de-optionalized the policy; the "not yet built / future work"
caveat no longer applies. This note is retained so a later re-read understands the MAY→MUST transition
happened at DIR-014, not at M18.

**Mechanism detail (the pipeline shape "clamp at both ends" refers to):** see
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §6 for the full pipeline diagram (task →
N-independent proposals → adjudication → milestone → plan-author + grounded convergent-check →
single implementation with per-stage TDD gate → light tail self-check → ABSORB →
adversarial-audit). Cited here, not duplicated, per DIR-009's charter-thinness discipline —
this section states only the policy (which class gets which strategy, and the precondition
gating Class 2's availability), not the mechanism's internals.

## Web UI verification requirement — mechanized browser-tool evidence rule (M10-audit-consolidation
## Done-when 1, DIR-006)

DIR-006 found a live claim-vs-evidence mismatch: `charters/M04-discover.md` required "exercise
list/detail/filter/search/action flows in a real browser (dual-viewport... holistic visual
review)," and `milestones/M04-discover/iterations/iteration-0.md` narrated a "Live browser
session... at both desktop (1280x900) and mobile (390x844, emulated touch) viewports" — but the
only literal pasted evidence anywhere in that report was two `curl` commands comparing
`?search=` vs `?q=` query params. Zero `mcp__playwright__*`/`mcp__chrome-devtools__*` tool-call
strings appear anywhere in exp5's 9 milestones (M01–M09), grepped directly. No mechanized gate
caught this — exp5's only Web UI HARD GATE (`G7`) is an HTTP-status `curl` check, unrelated to
rendering/interaction verification, and iteration-1's independent-re-verification discipline (which
exists precisely to catch claim-vs-evidence mismatches) did not catch this one either, because it
also only re-read prose rather than re-deriving from a tool-call trace.

**The rule, stated operationally (not a citation):** any milestone Done-when clause that claims
Web UI rendering/interaction/visual verification (list/detail/filter/search/action-flow exercise,
visual coherence, responsive/dual-viewport behavior) MUST be backed, in the iteration report, by a
literal pasted `mcp__playwright__*` or `mcp__chrome-devtools__*` tool-call trace consisting of, at
minimum:
1. A **navigation** call (`mcp__playwright__browser_navigate` / `mcp__chrome-devtools__navigate_page`)
   to the actual page under test.
2. At least one **screenshot or DOM/accessibility snapshot** artifact per claimed viewport
   (`mcp__playwright__browser_take_screenshot` / `mcp__chrome-devtools__take_screenshot`, or
   `browser_snapshot`/`take_snapshot`) — not merely a claim that one was taken.
3. This trace must be present **at both configured viewports** (desktop + mobile, per the
   dual-viewport requirement below) when the Done-when clause claims dual-viewport coverage.

**`curl` is explicitly demoted, not banned.** `curl -s <url> -o /dev/null -w "%{http_code}"`
(G7-style checks) remains valid evidence for **liveness/reachability HARD GATES only** — "is the
server up." It is never valid evidence for, and must never be substituted for, rendering or
interaction verification. A charter/report that uses `curl` output as its ONLY evidence for a
Web-UI-rendering Done-when clause fails this rule, regardless of how the surrounding prose
narrates the check (DIR-006's exact failure shape).

**Dual-viewport requirement (consolidated from `quay-webui-bootstrap-methodology`'s §0c, reference
`visual-review-mechanism.md`):** desktop 1280×800/900 and mobile 390×844 (device pixel ratio ×3,
emulated touch) are the two configured viewports; a page/flow is not credited with Web UI
verification until both are covered. Where a milestone's own charter scopes a narrower check (e.g.
a single flow, not a full page), the SAME evidence bar applies to whatever is claimed — a
navigation + screenshot/snapshot trace, not narrative language.

**Charter-authoring checklist note (OUTER-LOOP.md step 3):** any future charter that scopes Web UI
work must state this evidence rule explicitly in its own Done-when clause text (not merely rely on
this inherited-core.md section being read) — see `OUTER-LOOP.md` step 3's charter-authoring bullet
list, amended by this milestone to cross-reference this section.

**What this does NOT require:** this rule does not require every milestone to touch a browser —
only milestones whose own Done-when clauses actually claim Web UI rendering/interaction
verification. A milestone that touches CLI/MCP/Packaging/Docs surfaces is unaffected.

## Adversarial-audit role — a NEW out-of-band step, distinct from iteration-1 (M10-audit-consolidation
## Done-when 4/5/6, DIR-007)

DIR-007 found that exp1's G3 out-of-band audit discipline (`.claude/skills/quay-native-methodology/
reference/g3-audit-discipline.md`) — a fresh-context subagent, dispatched by the orchestrator, NEVER
by the session that did the work, explicitly CHARGED TO REFUTE the iteration's claims (not merely
redo them) — was carried into exp5 only as a citation ("G3 out-of-band audit discipline",
`inherited-core.md` §Extracted skills item 1; "domain-misfit audit-channel", `OUTER-LOOP.md`
§4.4d). What exp5 actually built and mechanized instead — the domain-misfit audit-channel (does
this DOMAIN have any independent verification mechanism, e.g. a CI job?) and iteration-1's
same-template independent re-run (dispatched as a fresh `baime:iteration-executor`, instructed to
independently re-derive claims from a fresh worktree) — is real, effective, and has caught genuine
bugs in 5 of 9 milestones (M02 gate-hash false-FAIL, M04 VT arithmetic slip, M05 CLI-flag typo, M06
self-exemption override, M07 ledger double-count). But it answers a different question than G3:
"is this reproducible/stable," not "is this claim actually true and not inflated." G3's exp1 track
record (3 separate V_meta overclaim attempts caught and reverted, iterations 29/59/61) was
specifically about the SECOND question — same-template re-runs check it only incidentally.

**The new role — named concretely: `iteration-N-adversarial-audit.md`.** A distinct out-of-band
step the OUTER LOOP itself dispatches (not folded into any inner milestone's own iteration-1),
charged EXPLICITLY to try to REFUTE a milestone's Done-when claims and VT delta, not to
independently re-derive them from scratch in the same shape:

1. **Who dispatches it.** The outer loop (the session executing `OUTER-LOOP.md`), at ABSORB
   (step 6), for milestones meeting the cadence rule below — never the inner milestone's own
   iteration-0 or iteration-1, and never folded into either.
2. **How it's dispatched.** A fresh-context `baime:iteration-executor` call (or equivalent
   fresh-context subagent dispatch), `run_in_background=true`, reading ONLY: (a) the milestone's
   charter (Tier-A), (b) the milestone's own iteration-0/iteration-1 reports (the claims under
   audit), and (c) `inherited-core.md` (Tier-B) — explicitly NOT given "go re-verify this," but
   given a distinctly-worded refutation-focused prompt: *"Your job is to find fault with this
   milestone's Done-when claims and VT Δv. Do not simply re-run the same checks and confirm — look
   for: (a) claims with no pasted evidence nearby (narrative-only), (b) evidence that doesn't
   actually support the specific claim made (e.g. a curl check standing in for a browser claim —
   see the Web UI verification rule above), (c) arithmetic that doesn't recompute cleanly, (d) VT
   deltas that don't match the charter's own pre-dispatch Δv̂ without a stated reason, (e) scope
   creep or scope-exemption the milestone granted itself without outer-loop sign-off. Render a
   verdict: REFUTED (name the specific claim and why), CONCERNS (weaker findings, non-blocking), or
   NO REFUTATION FOUND (state what was specifically tried, not just 'looks fine')."*
3. **Output location.** `milestones/M<NN>/audits/iteration-N-adversarial-audit.md` — a new
   `audits/` subdirectory under each milestone's own tree, parallel to `iterations/`, distinct from
   both. (`N` = the milestone's own iteration count at ABSORB time, e.g. the audit of a
   2-iteration milestone is `iteration-1-adversarial-audit.md`.)
4. **What a REFUTED verdict does.** Same discipline as G3's own historical record: a REFUTED
   finding is not merely noted — it BLOCKS the ABSORB step's VT-curve append / Done-when
   completion claim until the underlying milestone record is actually corrected (mirrors the
   existing `V_meta consolidation-lag gate`'s HARD BLOCK pattern in `OUTER-LOOP.md` step 6,
   applied here to a different failure class).

**Explicitly distinct from iteration-1 (so it is not redundant with an existing mechanism):**

| | iteration-1 (existing) | adversarial-audit (NEW) |
|---|---|---|
| Dispatched by | the inner milestone's own charter/dispatcher | the OUTER loop, at ABSORB |
| Scope | re-derive/re-run the SAME kind of work fresh | actively try to REFUTE the claims already made |
| Question asked | "is this reproducible?" | "is this claim actually true and not inflated?" |
| Given the charter? | yes, full charter + fresh worktree | yes, PLUS the claims under audit — explicitly asked to distrust them |
| When required | every milestone (2-iteration build+verify template) | only per the cadence rule below (Done-when 5) |

## Adversarial-audit cadence rule (M10-audit-consolidation Done-when 6, DIR-007 item 3)

**Required (mechanized gate, see `OUTER-LOOP.md` step 6):**
(a) every VT-scoring (capability-growth-typed) milestone — i.e. any milestone whose SELECT-time
value-typed ledger entry includes `capability-growth` and whose ABSORB appends a nonzero VT Δv to
the curve;
(b) any milestone whose own iteration-0 recommends skipping iteration-1 (the M06-sizing
self-exemption precedent — iteration-0 argued "pure-doc-edit, nothing to re-derive"; the outer loop
overrode this by base-rate judgment, not a mechanized gate, and iteration-1 then caught a real
defect anyway, confirming the override was correct).

**Explicitly NOT required (non-blanket, recorded as a checkable rule, not left to per-milestone
improvisation):** methodology-infra/governance milestones with no VT weight (the M02/M05/M06/M07/
M10 class) are EXEMPT BY DEFAULT — unless clause (b) above fires for them specifically (a
methodology-infra milestone that also tries to self-exempt from iteration-1 IS in scope for the
adversarial audit, by (b), independent of (a)'s VT-typing test). This keeps the rule proportionate
to DIR-004's method-ROI framing (DIR-007 item 3's own explicit instruction) rather than requiring a
full adversarial pass on every thin governance milestone — the base rate of claim-inflation risk is
concentrated in VT-scoring/self-exemption cases, not in every markdown edit.

## σ-inherited-floor trap — consolidated as operational content (M10-audit-consolidation Done-when 6,
## DIR-008)

Completing the kickoff commit's third named consolidation target ("σ-floor handling," alongside
§0c visual-review above and dispatch/G3 discipline above).

**The general trap** (source: `.claude/skills/quay-core-bootstrap-methodology/reference/
sigma-inherited-floor-trap.md`): when a new experiment/chart inherits a scoring floor/baseline from
a prior experiment/chart WITHOUT an explicit, design-time "reset to 0" vs. "design for enough
throughput to clear the floor" decision, the inherited baseline silently dominates the score until
the baseline itself is found to be wrong — usually discovered only after the fact, by accident,
rather than anticipated. Originally characterized for `σ_QC` vs. an inherited `σ_strict` floor
(experiment 2 inheriting experiment 1's 0.8493 floor, arithmetic showing ≈57 more native-gate tasks
needed just to begin exceeding it) — but the SHAPE of the trap (uncritical numeric inheritance,
undecided at design time) generalizes beyond that one factor.

**The decision procedure (apply at design time — chart origin, or any chart transition):**
1. **Name the inherited number(s) explicitly** — every baseline/floor a new chart or experiment
   carries forward from a prior one, not just the ones that look load-bearing.
2. **For each one, make ONE of two choices, explicitly and in writing** (never let it default
   silently):
   - **RESET to 0** — the new scope's own ledger stands alone, measuring only its own
     going-forward discipline, no cross-chart/cross-experiment carry-forward credit.
   - **CARRY FORWARD, with a stated confidence basis** — explicitly state WHY the inherited number
     is trusted (what evidence backs it), and accept that if that evidence is later found wrong,
     the correction is real value (instrument-correction type, per the value-typed ledger above),
     not a regression.
3. **Do the arithmetic before committing** if choosing to design around a floor (e.g., "how many
   more units of X would be needed to clear this floor within the planned budget" — per
   `v-meta-ceiling-diagnostic.md`'s method) — do not discover the arithmetic is infeasible only
   after committing.

**The m4 case study (VT₀'s own instance of this trap, already fired for real):** exp5's `VT₀ =
82.25` was set at bootstrap directly from exp4's `gap-list.md` "Closed" claims (`OUTER-LOOP.md`
step 2's origin scoring), with NO explicit reset-vs-carry-forward decision ever recorded at
design time — the carry-forward choice was made implicitly, by construction, not stated. This is
structurally the CARRY FORWARD case above, but without step 2's "stated confidence basis." The trap
fired at m4/M04-discover: the live persona pass found exp4's "Closed" claims were systematically
overstated (MD-001 merge-drift — 12 gap-list entries reopened, CLI/Web UI/Docs surfaces all
affected), producing exp5's first genuine VT DECREASE (101.33→94.73/120, **Δv=−6.60**,
`dashboard.md`'s m4 VT curve log) — discovered only after the fact by the exploit-channel discovery
engine, not anticipated by a design-time check.

**Retroactive disposition of VT₀ (this section IS that decision, recorded now rather than left
implicit):** VT₀'s carry-forward is retroactively classified as CARRY FORWARD (not reset — a
reset was never practical after 9 milestones have already built on the chart-1 numbers), with its
confidence basis now stated explicitly for the first time: exp4's gap-list "Closed" claims were
trusted based on exp4's own iteration reports asserting closure, WITHOUT independent re-verification
against `master` — exactly the gap M04-discover's persona pass then found. Going forward, this
experiment's own posture is: **any number carried forward from a DIFFERENT experiment or a prior
chart is presumptively CARRY-FORWARD-WITH-LOW-CONFIDENCE until independently re-verified by this
experiment's own live evidence** — which is in fact what M04/M08/M09's re-scoring passes have
already been doing in practice (each VT re-score section in `dashboard.md` cites this experiment's
own live evidence, not a re-cited exp4 claim). This section makes that practice an explicit,
named rule rather than an emergent pattern.

**Audit for other uncritically-inherited baselines (DIR-008 item 3, disposition required for each):**
- **Chart-0→chart-1 transition (m3):** `dashboard.md`'s m3 log carried the 5 original chart-0
  surfaces (CLI/MCP/Web UI/Packaging/Docs) 1:1 into chart-1 "out of scope" (unchanged weights/cov),
  adding Provider-ABI as a genuinely new 6th surface scored fresh. **Disposition: CARRY FORWARD,
  low-risk** — the 5 unchanged surfaces were not re-derived at the chart transition itself, but
  each has SINCE been independently re-scored with live evidence at least once (Web UI/CLI/Docs at
  m4, CLI/Docs/Packaging at m8, none skipped) — the transition itself didn't introduce a new
  unverified number, it just deferred re-verification to the ordinary SELECT/exploit cycle, which
  has since occurred. No further action needed.
- **Provider-ABI's chart-1 origin cov (m3, 0.654):** this is NOT an inherited number — M03-abi-eval
  built the capability matrix and differential conformance suite FROM SCRATCH this experiment, no
  prior-experiment baseline was carried in. Not in scope for this trap.
- **`v-meta-ledger.md` / V_meta consolidation-lag health track starting value:** reviewed — this
  track was CREATED by M07-vmeta-gate (m7) with a genuinely fresh starting state (0 rows
  past-threshold at creation), not inherited from exp4. Not in scope for this trap.
- **Milestone-counter / chart-counter origin (`milestone_counter: 0`, `chart: 0` at bootstrap):**
  these are explicit resets to 0 by `OUTER-LOOP.md`'s own First-run bootstrap step 3 — already the
  correct choice per this section's own decision procedure (RESET, not carry-forward), predating
  this milestone. No further action needed.
- **No other still-live inherited numeric baseline was found** by this audit (grep/read of
  `dashboard.md`'s Log section + `OUTER-LOOP.md`'s bootstrap steps against exp4's own closing
  artifacts) beyond VT₀ itself and the chart-0→chart-1 transition, both dispositioned above.

## manda-dispatch discipline — correct narrow scope (M10-audit-consolidation Done-when 7, DIR-008
## item 5)

DIR-008 found a companion, lower-severity drift: `docs/proposals/exp5-concurrent-background-
agents-for-milestone-iteration.md` re-derived a manda-dispatch conclusion from scratch, live, with
zero reference to the existing envelope document (`.claude/skills/quay-core-bootstrap-methodology/
reference/manda-reliability-envelope.md`) or DIR-020's precise scope — and DIR-008's OWN first
draft overstated the rule as a blanket ban, corrected only after live human review. This section
exists so future milestones don't have to re-derive (or over-generalize) the rule a third time.

**The rule, at its correct narrow scope (source: DIR-020, archived
`experiments/quay-native-bootstrap/directives/archive/DIR-020-*.md`; extended by DIR-015/016/024,
same archive):**

1. **DIR-020's self-deadlock condition (the core structural rule):** the depth-1
   `mcp__plugin_manda_manda__Agent`/`Dispatch`/`request` caller must NEVER be issued synchronously
   from the same session that owns the bound broker monitor for the target channel. If caller and
   broker are the same session, the caller half must be dispatched as a separate background
   subagent (`run_in_background=true`) so the session's own top-level turn remains free to service
   the resulting cap-request. This is structural, not probabilistic — a synchronous call blocks
   that session's own turn processing, so it cannot receive/act on its own incoming cap-request
   notification until the blocking call itself gives up at the deadline, by construction, regardless
   of daemon behavior.

2. **DIR-015/016/024's background-dispatch requirement (extends the same reasoning to every
   dispatch on the path, not just the depth-1 caller):**
   - DIR-015: the subagent that executes a given iteration's work must be dispatched
     non-blockingly (`run_in_background=true`) — a foreground-blocked iteration dispatch prevents
     the dispatching session from servicing ANY concurrent cap-request for the dispatch's entire
     duration, an independently sufficient explanation for otherwise-mysterious manda timeouts.
   - DIR-016: the SAME non-blocking requirement extends to the out-of-band audit-subagent dispatch
     specifically (not just the iteration dispatch) — a gap DIR-015 left open one call later in the
     same cycle.
   - DIR-024: the BROKER side of the exchange (the session servicing an incoming `agent.spawn`
     cap-request) must also spawn its leaf agent with `run_in_background=true`, per the broker
     protocol's own already-written spec — a foreground broker-side spawn blocks the broker from
     noticing/servicing a SECOND concurrent cap-request while the first is still running, silently
     serializing what should be concurrent.
   - **Net effect: every point on a manda nested-dispatch path — depth-1 caller, iteration
     dispatch, audit dispatch, broker-side spawn — must be background, for the same underlying
     reason** (a synchronously-blocked session cannot service its own concurrent notifications).

3. **This is NOT a blanket ban on manda dispatch, and is scoped to result-dependent/nested paths
   specifically.** `packages/quay/src/action.js`'s Action Button delivery (`manda-dispatch submit
   ... --async`, never waits on or checks a result) is structurally OUTSIDE this rule's scope
   entirely — fire-and-forget dispatch has no synchronous caller-side wait to deadlock, and remains
   a legitimate, currently-working use of manda, unaffected by DIR-020/015/016/024. The rule applies
   specifically to: (a) the depth-1 caller when it IS the target channel's own broker, and (b) any
   dispatch where the dispatching session subsequently needs to remain responsive to a concurrent
   cap-request (result-dependent/nested paths) — not to dispatch calls that neither wait for nor
   depend on a returned result.

**Standing practice decision (DIR-008 item 4, minor/non-blocking per DIR-008's own framing):**
**adopted** — before drafting a new cross-cutting proposal or charter section touching manda/
G3/dispatch mechanics, do a quick grep of `inherited-core.md`'s own delta chain (this file first)
plus a targeted grep of `experiments/quay-native-bootstrap/directives/archive/DIR-0{15,16,20,24}*`
and `.claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md` before
re-deriving the rule live. This is now the correct single place to check — this section IS the
consolidated answer; no future milestone should need to re-open the archived DIR-0NN files directly
unless this section itself is found insufficient (in which case, expand THIS section, don't leave
the gap for the next drafter to re-discover).

## Human-review cadence — standing rule (M15-human-review-cadence, DIR-001 item 6)

DIR-001 item 6 backlogged this as "worth a recurring-cadence design once ≥2 more DIR-* instances
exist to generalize from." That condition is now met: DIR-002 through DIR-011 (10 further
instances) have landed since DIR-001 was filed, giving an 11-directive real sample to generalize
from, not a speculative one.

**The real tally (all 11 `directives/archive/DIR-*.md`, read in full at M15's authoring):**

| DIR | Arrival boundary (milestone-count gap) | Initiation mode | Finding kind |
|---|---|---|---|
| DIR-001 | pre-m3 dispatch (m2→m3 boundary) | human, mid-conversation | structural blind-spot (VT surface set blind to Provider-ABI/GitHub) |
| DIR-002 | mid-m4 (during M04-discover; drained at the m4→m5 boundary) | human, mid-conversation | drift detected (exp4's DIR-006 "files-canonical" resolution was a rationalized transition failure, not a settled decision) |
| DIR-003 | mid-m5 (during M05-dir-projection's own iteration-0) | **self-raised** (iteration-0, per M05's charter item 5's sanctioned live-dogfood requirement) | routing/dogfood demonstration artifact — not a finding in the same sense as the other 10, a deliberately-produced proof object |
| DIR-004 | m5→m6 boundary | human, mid-conversation | drift detected (2-iteration sizing is a cost-proxy artifact) + routing decision (value-typed SELECT ledger) |
| DIR-005 | m6→m7 boundary | human, mid-conversation | structural blind-spot (V_meta consolidation lag invisible to every existing health track) |
| DIR-006 | mid-m9 (arrived during M09-gh-write; drained in the m9→m10 burst with DIR-007/008) | human, mid-conversation | drift detected (Web UI verification narrated as "real browser" but only `curl` evidence pasted) |
| DIR-007 | mid-m9 (same burst as DIR-006) | human, mid-conversation | structural blind-spot (G3 adversarial-audit role silently weakened into same-template re-run) |
| DIR-008 | mid-m9 (same burst as DIR-006/007) | human, mid-conversation | drift detected (σ-inherited-floor trap never consolidated despite being pre-named at kickoff) |
| DIR-009 | m12→m13 boundary (arrived in a 3-directive burst with DIR-010/011) | human, mid-conversation | scope split / routing decision (exp5's own non-directive work invisible in the task store) |
| DIR-010 | m12→m13 boundary (same burst) | human, mid-conversation | drift detected (directive-projection cross-experiment task-id collision + boundary-only reconcile gap) |
| DIR-011 | m12→m13 boundary (same burst) | human, mid-conversation | routing decision / scope split (Core CLI edit-surface relaxation + portable-metadata rule design) |

**Summary statistics from the tally:** 10 of 11 directives are human-initiated mid-conversation
(the async `/quay-directive` channel, per `OUTER-LOOP.md`'s "Human async control surface"); exactly
1 (DIR-003) is self-raised by an inner iteration under an explicit charter sanction, not a
human-review-channel instance in the same sense. Arrivals are NOT a steady per-milestone trickle —
they cluster in bursts at milestone boundaries: 5 single-directive arrivals (m2→m3, m4→m5, mid-m5
self-raised, m5→m6, m6→m7) and 2 three-directive bursts (m9→m10, m12→m13). The largest observed
gap between human-directive bursts in this tally is 3 milestones (m6→m7 to m9→m10). As of this
milestone's own ABSORB (`milestone_counter=15`), `milestones-since-last-human-directive = 3`
(milestone_counter(15) − arrival milestone(12), since the last human-directive burst landed at
the m12→m13 boundary and this count must include the currently-completing milestone itself —
see `dashboard.md`'s Human-review cadence row for the full reconciliation reasoning).

**The rule, stated operationally:**

1. **Compute `milestones-since-last-human-directive`** at every ABSORB (`dashboard.md`'s "Human-
   review cadence" health track) as `milestone_counter (current, post-increment) − (the milestone
   number at which the LAST human-initiated directive burst was drained from `directives/pending/`,
   pre-dispatch)`. DIR-003 (self-raised) does NOT reset this counter — only directives arriving via
   the external `/quay-directive` channel count, since the whole point of this track is visibility
   into the async human-input channel specifically, not all directive-shaped artifacts.
2. **Soft-alarm threshold: K=5.** Chosen to reuse the existing checkpoint cadence
   (`milestone_counter % 5 == 0`, `OUTER-LOOP.md` step 8) rather than invent a second, unrelated
   number — the two tracks now share one mental model ("how long since a human last looked at
   this," observed at the same natural 5-milestone cadence the checkpoint already uses).
3. **Explicitly non-blocking.** Unlike the V_meta consolidation-lag gate (`dashboard.md`'s
   neighboring health-track row, `OUTER-LOOP.md` step 6's HARD BLOCK on `milestone_counter++`),
   crossing K=5 on this track does **NOT** block ABSORB, does NOT block `milestone_counter++`, and
   does NOT pause the loop. The reason the two tracks are treated differently even though both are
   "K=5-vs-K=2 thresholds on a lag count": the V_meta ledger's rows are a mechanically resolvable
   backlog item (a pattern that needs consolidating, entirely within the loop's own power to fix by
   doing the consolidation work) — but a human directive is, by definition, asynchronous and
   human-paced; the loop cannot manufacture one, and must not wait for one (`OUTER-LOOP.md`'s own
   header invariant, "the loop never blocks waiting for a human"). This track exists purely to make
   that existing asynchrony **visible**, not to change its blocking semantics.
4. **The one concrete behavior this induces:** at every checkpoint (`milestone_counter % 5 == 0`,
   `OUTER-LOOP.md` step 8), the checkpoint snapshot must include this track's current value, so a
   human skimming `checkpoints/cp-<NN>.md` asynchronously sees "N milestones since last human
   input" directly, without needing to dig through `directives/archive/` to reconstruct it by hand.

## Portable-metadata convention (body-first, `extra{}` native-only) (M16-cli-edit-parity-impl, DIR-011 item 3, `docs/proposals/exp5-cli-edit-parity.md` §3.2 — inserted verbatim)

> ### Portable-metadata convention (body-first, `extra{}` native-only)
>
> A quay task's `body` (markdown) and `labels` are **portable**: every Provider ABI implementation
> (native, GitHub, and any future Provider) is expected to support reading and writing them, because
> both are backed by fields every realistic backing store has (a free-text description field, a
> tag/label mechanism). A task's `extra{}` map is **native-only convenience**: it is an arbitrary
> key/value store specific to the native Provider's own file-backed task store, and MUST NOT be
> relied upon as the sole copy of any fact that needs to survive a Provider switch.
>
> **Rule for anyone writing metadata onto a task that must be provider-portable:** the authoritative,
> portable copy of that metadata MUST live in a structured markdown section of the task `body`
> (e.g. a `## <Section Name>` heading with the fact stated in prose or a `Key: value` line
> immediately beneath it — the exact same shape M05's `Status mirror:` body line already
> established). `extra{}` MAY additionally carry the same fact as a machine-readable, native-only
> mirror (e.g. `extra.someKey`) purely as a query-performance convenience on native — but if a
> Provider hard-errors on writing `extra` (as GitHub does per PR-ABI-001's floor), the body copy
> alone must remain sufficient; nothing may be designed to depend on the `extra{}` mirror being
> present.
>
> **Corollary:** any milestone/design that finds itself needing `extra{}` as the ONLY place a fact
> is recorded has mis-designed a provider-portability requirement — either the fact does not
> actually need to be portable (state that explicitly and accept native-only status), or it needs a
> body-section home in addition to (not instead of) the `extra{}` mirror.

Source: `docs/proposals/exp5-cli-edit-parity.md` §3.2, produced by M14-cli-edit-parity (design-only)
per DIR-011 item 3; inserted here verbatim by M16-cli-edit-parity-impl (the implementing milestone
the design doc's own §6 Done-when list required) as this milestone's Done-when clause 4. Already
cross-referenced informally by M13's task-backlog-projection design (§11) before this section
existed in named/citable form here — see the design doc's own §3.1 cross-reference note for that
prior dependency. Note (worktree-local edit): this file is Tier-B shared context; this insertion is
made to the copy of `inherited-core.md` inside this iteration's own worktree and will be reconciled
against the real shared file by the outer loop at ABSORB, per this milestone's charter (Done-when 4
note) — expected, not a conflict to avoid.

## Design-only milestone → mandatory `-IMPL` row rule (M21-impl-row-enforcement, DIR-016)

**The problem this rule closes (DIR-016's finding, condensed):** a design-only milestone completes,
marks itself DONE, and defers its implementation to "a future SELECT" in prose — but SELECT
(`OUTER-LOOP.md` step 1) only considers non-DONE `backlog.md` candidate rows, so a deferral with no
row is a deferral to never. Evidence: `M-CLI-EDIT-PARITY` (design, DONE m14) correctly got an
`-IMPL` row (SELECTed and completed at m16); `M-TASK-BACKLOG-PROJECTION` (design, DONE m13) did
NOT (DIR-015); `M-TASK-TO-PLAN-SKILL-DESIGN` (design, DONE m17) did NOT (its follow-up sat unqueued
until DIR-014 was hand-filed). Whether a design milestone's implementation ever becomes reachable
depended entirely on the ABSORB agent *remembering* to hand-author an `-IMPL` row — an unenforced
convention that silently failed 2 of 3 times.

**The rule, stated operationally (reusable across milestones, mirrored in `OUTER-LOOP.md` step 6's
Impl-row gate):**

1. **Definition — "design-only milestone."** A milestone is design-only if EITHER: (a) its own
   `backlog.md` row states "design delivered" / "design-doc only" (or equivalent wording), OR (b)
   its deliverable includes a "Done-when clauses a future implementing milestone would need"
   section (or equivalent — a dispatch-ready checklist explicitly written for a *later*
   implementing milestone to consume). A milestone that ships product/method-infra code, or is
   itself the `-IMPL` implementation of a prior design, is NOT design-only.
2. **The mandatory action.** At ABSORB (`OUTER-LOOP.md` step 6), before that milestone's Done-when
   clauses may be recorded as complete or `milestone_counter++` (step 7) may execute, a design-only
   milestone's ABSORB **MUST** create a corresponding **selectable, non-DONE `<M-NAME>-IMPL`**
   candidate row in `backlog.md`, sourced to the design doc's own "Done-when clauses a future
   implementing milestone would need" checklist (or nearest equivalent). Leaving the follow-up as
   prose only is not a valid disposition of this rule.
3. **HARD BLOCK, not advisory.** This is stated as unambiguously blocking — same shape/placement as
   the existing V_meta consolidation-lag gate (`OUTER-LOOP.md` step 6, blocks step 7's
   `milestone_counter++`) and the adversarial-audit gate (`OUTER-LOOP.md` step 6, blocks the
   VT-append/Done-when-complete claim). A design-only milestone's ABSORB that skips this step has
   not validly completed ABSORB.
4. **Mechanical check, not eyeballing.** `scripts/it0-impl-row-check.sh <milestone-id>
   [backlog-file]` flags (non-zero exit) a design-only milestone whose `-IMPL` row is absent from
   `backlog.md`, mirroring the existing `it0-*.sh` 0/1/2 exit-code convention (0=pass, 1=flag/fail,
   2=usage error). Without this mechanized half, this rule would itself recreate the very
   enforcement-half-never-built pattern it exists to close (the DIR-002 lesson, applied one level
   up to the loop's own design→implementation hand-off).
5. **Retroactive scope.** The rule applies going forward from M21; the retroactive sweep of past
   design-only milestones lacking their `-IMPL` row was performed once, at M21's own ABSORB (see
   `backlog.md`'s `M-TASK-BACKLOG-PROJECTION-IMPL` row and the M21 iteration report's sweep
   disposition table) — it is not re-run automatically on every future ABSORB, only the
   going-forward per-milestone check is.

Source: DIR-016 (filed together with DIR-015, its first concrete instance), resolved by
M21-impl-row-enforcement. See `directives/archive/DIR-016-*.md`'s `## Resolution` section for the
full evidence trail.

## Definition of Done (M25-dod-meta-enforcer / DIR-017 Step 1, extended by M32-dod-escrow-testfloor
/ DIR-017 Step 2, extended by M40-dir014-task-canonical-lifecycle-record / DIR-014 item 6)

DIR-017's Finding names a real risk: four ABSORB-time gates (adversarial-audit, V_meta
consolidation-lag, line-budget, design-only-milestone impl-row) had each been added incrementally,
by four different prior milestones (M10/DIR-007, M07/DIR-005, M18/DIR-012, M21/DIR-016), as
separate conditional HARD BLOCKs scattered across `OUTER-LOOP.md` step 6 and this file — with no
single place naming ALL of them as one collective "Definition of Done" a milestone must clear, and
no mechanism preventing a future charter from narrating its way around one of them (the
"designed-not-wired" disease M17/M18 exhibited: a rule stated in prose, never made to actually
block). This section is that single collecting place. It does not redefine any of the four gates'
own mechanics (each stays exactly as specified in its own section, cited below, not re-derived) —
it names them together, states each one's shape in a common four-field template, and adds a fifth,
new **no-self-exemption meta-clause** that applies across all four. DIR-017 Step 2
(M32-dod-escrow-testfloor) later adds two more clauses to this same collecting place — Clause 6
(escrow-Δv) and Clause 7 (product-work test-floor), same four-field template, same standing
mechanical enforcement — see below. DIR-014 item 6 (M40-dir014-task-canonical-lifecycle-record)
adds a ninth clause — Clause 8 (task canonical-lifecycle-record) — same four-field template,
documented in its own subsection immediately after Clause 0's (the two are closely related: Clause
0 checks AC/DoD presence, Clause 8 checks Proposal/Plan presence).

**Mechanical enforcement of this section:** `scripts/it0-dod-check.{sh,mjs}` (below) is the standing
check that a given milestone's task + charter + ABSORB-entry record actually satisfies all nine
clauses below (clause 0 plus clauses 1-8) — wired into `OUTER-LOOP.md` step 6 as a HARD BLOCK on
step 7's `milestone_counter++`, in the same gate sequence/position as the three narrative HARD
BLOCKs it wraps (see "DoD meta-enforcer gate" in `OUTER-LOOP.md`).

**AC/DoD live in the TASK, not the charter (proposal↔task / plan↔milestone alignment, 2026-07-19;
checklist form MANDATED going forward, DIR-020/M34-ac-dod-checklist-writeback, 2026-07-19).**
A milestone's Acceptance Criteria (AC) and Definition of Done (DoD) are authored at the **proposal**
stage and recorded in the milestone-candidate **task** body (`tasks/<task-id>.md`) as two sections —
`## Acceptance Criteria` and `## Definition of Done` — which are the SINGLE canonical source of truth
for both. They MAY be revised at the plan/charter stage, but the revision is made to the task's copy;
they are NEVER forked into the charter. The charter (the milestone's plan) **references** the task's
AC/DoD and must not duplicate them — duplication is exactly the drift this whole section exists to
kill. This aligns the four entities: **task↔proposal** (the value unit + its AC/DoD) and
**milestone↔plan** (the sequenced implementation). AC = criteria specific to THIS value unit (what was
formerly the per-charter "Binary Done-when", now moved into the task). DoD = the task's done-checklist:
a **reference** to the standard five clauses below (NOT a copy — a copy goes stale when the standard
changes) PLUS any task-specific extra done-conditions.
**Checklist form, going forward:** `## Acceptance Criteria` and `## Definition of Done` MUST be
authored as GitHub-flavored Markdown checklists — one `- [ ]` item per criterion / done-condition, NOT
a prose bullet/numbered list. They are authored **UNCHECKED** (`- [ ]`) at SELECT time (`OUTER-LOOP.md`
step 1) — a milestone starts with nothing ticked. The per-milestone acceptance audit
(`OUTER-LOOP.md` step 6, Clause 1) is the **ONLY** writer that ticks a box to `- [x]`, and only as it
independently confirms that specific item met, citing evidence in its own audit report — the loop
itself must NEVER self-tick a box at authoring time, so a ticked box is always an audit attestation
(mirrors the "generated, not hand-edited" projection discipline, DIR-002). **Unchecked-box-blocks
semantics:** any AC box still `- [ ]` at `milestone_counter++` time (step 7) is REFUTED-equivalent and
HARD-blocks, exactly as an unmet criterion does today — this changes the REPRESENTATION of AC
satisfaction (visible per-item in the task itself), not the underlying gate semantics. **Backward
compatibility:** pre-existing prose-form tasks (e.g. M32's `exp5-M-DOD-ESCROW-TESTFLOOR`) are NOT
retroactively rewritten — Clause 0 continues to accept prose-form AC/DoD unchanged; checklist form is
required for tasks authored from DIR-020/M34 onward, migrated opportunistically for older tasks, no
retroactive sweep required.

### Clause 0 — AC + DoD present and well-formed in the task (2026-07-19; checklist-form + unchecked-box
HARD-block semantics added DIR-020/M34-ac-dod-checklist-writeback, 2026-07-19)
- **Trigger condition:** every milestone, unconditionally — there is no case in which a milestone
  legitimately has no acceptance criteria.
- **What it checks:** the milestone's task (`tasks/<task-id>.md`) contains a non-empty, well-formed
  `## Acceptance Criteria` section with at least one concrete, individually-checkable clause — either
  a GFM checklist line (`- [ ]`/`- [x] text`, the required form for tasks authored going forward) or a
  prose bullet/numbered line with real content (the pre-existing form, still accepted for backward
  compatibility — not empty, not a bare `TBD`/`TODO`/placeholder), AND a non-empty
  `## Definition of Done` section that **references** the standard DoD (this section / the five
  clauses below) and may add task-specific done-conditions. PRESENCE and SHAPE, PLUS — for
  checklist-form AC specifically — **unchecked-box HARD-block**: any `- [ ]` (unchecked) item
  remaining in the AC section is treated as an unmet criterion and FAILs this clause, naming the
  specific unchecked item(s) in the failure output (mirrors an unmet-criterion HARD-block; a
  prose-form AC has no per-item checked/unchecked state and is unaffected by this sub-check). Whether
  each AC clause is actually MET is still fundamentally the per-milestone acceptance audit's job
  (`OUTER-LOOP.md` step 6) — this mechanical check only verifies that the audit's ticks (or lack
  thereof) are reflected in the task file, it does not itself judge satisfaction.
- **Pass/fail semantics:** exit 1 (FAIL, HARD-blocks `milestone_counter++`) if the task file is
  missing, or either section is absent / empty / placeholder-only / (for DoD) does not reference the
  standard; exit 0 (PASS) otherwise. Mechanized in `scripts/it0-dod-check.mjs` (below).
- **Current invocation point:** `OUTER-LOOP.md` step 6 (ABSORB), as clause 0 of the DoD meta-enforcer
  gate — the same HARD BLOCK as clauses 1-5.

### Clause 0's sibling — task canonical-lifecycle-record gate (DIR-014 item 6 /
M40-dir014-task-canonical-lifecycle-record, 2026-07-19) — documented as "Clause 8" below

DIR-014 item 6 names a gap adjacent to, but distinct from, Clause 0's own AC/DoD-presence check:
Clause 0 verifies a task carries acceptance criteria and a done-checklist, but nothing previously
verified a task also carries the **design record** for HOW those criteria will be met — the
`## Proposal` (chosen approach, embedded inline so it cannot drift out of sync with the task the
way a separately-tracked design doc can) and the `## Plan` (either a reference to a real
`docs/plans/*.md` staged-implementation file, or an explicit `N/A — <reason>` for small mechanical
changes that don't warrant one). Before this milestone, 0 of the 24 `exp5-M-*` milestone tasks in
this repo carried a `## Proposal` section at all — the requirement existed only as DoD prose
("should have a proposal"), which is not a gate. This subsection makes the task the single
canonical lifecycle record (proposal embedded + plan referenced-or-N/A) and mechanically enforces
it, mirroring Clause 0's own presence-and-shape enforcement pattern one level up the lifecycle (AC
answers "what does done mean", Proposal/Plan answers "how do we get there and is there a staged
plan").

### Clause 8 — Task canonical-lifecycle-record gate (DIR-014 item 6 /
M40-dir014-task-canonical-lifecycle-record)
- **Trigger condition:** FORWARD-ONLY — fires only for tasks whose `milestone:M<N>` label (the
  existing task-label convention) has `N >= 40` (this milestone, the first to require the section).
  A task with no `milestone:M<N>` label at all, or `N < 40`, is legacy/pre-cutover and N/A-passes,
  stated explicitly rather than silently skipped — mirrors DIR-020/M34's own "checklist form
  MANDATED going forward ... NOT retroactively rewritten ... no retroactive sweep required"
  precedent for Clause 0's checklist-vs-prose distinction, and this milestone's own charter's
  explicit "Explicitly OUT of scope: Retroactively backfilling `## Proposal`/`## Plan` onto the
  ≤M39 milestones' tasks ... forward-only, same as DIR-020's AC/DoD rule." Unlike Clause 0's
  checklist-vs-prose SHAPE distinction (where the section always existed), this is a brand-new
  REQUIRED SECTION — an unconditional trigger would retroactively HARD-block all 23 pre-M40
  `exp5-M-*` tasks that predate the requirement, which the charter explicitly disclaims.
- **What it checks:** the milestone's task (`tasks/<task-id>.md`, same source Clause 0 reads, via
  the same `extractSection()`-style regex helper — not a parallel implementation) contains a
  non-empty, non-placeholder `## Proposal` section (the milestone's own single chosen approach,
  embedded inline — not a pointer to a doc that can drift), AND a `## Plan` section that EITHER (a)
  states `N/A` (case-insensitive) followed by a dash/colon and real reasoning, OR (b) references a
  `docs/plans/*.md`-shaped path that resolves on disk (relative to repo root). A `## Plan` that
  references a `docs/plans/*.md` path which does NOT resolve is a FAIL even though the section is
  non-empty — a broken reference is worse than an honest `N/A`.
- **Pass/fail semantics:** exit 1 (FAIL, HARD-blocks `milestone_counter++`) if the trigger fires
  (task's `milestone:M<N>` label has `N >= 40`) and EITHER `## Proposal` is missing/empty/
  placeholder-only, OR `## Plan` is missing entirely, OR `## Plan` references a `docs/plans/*.md`
  path that does not resolve. exit 0 (PASS) if: the trigger does not fire (legacy/no-label task,
  N/A); OR the trigger fires and both sections are well-formed per the above. Mechanized in
  `scripts/it0-dod-check.mjs` (Clause 8) and `scripts/it0-dod-check.sh` (thin wrapper, same as
  Clause 0). Two regression fixtures pin this clause in isolation:
  `fixtures/dod/task-canonical-record-compliant-stub.md` (GREEN) and
  `fixtures/dod/task-canonical-record-violating-stub.md` (RED), both wired into
  `scripts/dod-fixture-selfcheck.sh`.
- **Current invocation point:** `OUTER-LOOP.md` step 6 (ABSORB), as clause 8 (last in sequence) of
  the DoD meta-enforcer gate — the same HARD BLOCK as clauses 0-7. Belongs in
  `MECHANICALLY_UNCONDITIONAL_CLAUSES` (Clause 5's self-exemption scan) for the SAME DIR-019 reason
  Clauses 3/4/6/7 do — it runs (and calls `dispositionedClauses.add(...)`) on every single
  invocation regardless of outcome, including its own N/A/grandfathered branch, so "already
  dispositioned" is not evidence a self-exemption of it is legitimate.
- **Explicitly out of scope (deferred to a later DIR-014 phase):** DISPATCH wiring of
  `quay-task-to-plan` for dev-class milestones (items 2/3), and dogfood customers routed through the
  wired pipeline (item 5) — this clause only enforces the task-record SHAPE, not the pipeline
  invocation that writes into it.

### Clause 1 — Per-milestone acceptance audit (DIR-007 / M10-audit-consolidation; made
UNCONDITIONAL 2026-07-19, superseding the original conditional cadence rule; checklist write-back
added DIR-020/M34-ac-dod-checklist-writeback, 2026-07-19)
- **Trigger condition:** EVERY milestone, unconditionally — no cadence precondition. (The original
  cadence-rule conditions — (a) VT-scoring, (b) iteration-0 self-exemption attempt — are retained
  ONLY as escalation hints for how hard to push the refutation, never as a gate on whether the audit
  runs. There is no longer a documented-no-op case for this clause.)
- **What it checks:** a fresh-context, out-of-band subagent dispatched by the OUTER loop (never the
  inner milestone's own iterations), explicitly charged, in refute-first stance, to: (1) read the
  milestone's task `## Acceptance Criteria` section and try to REFUTE that each criterion is
  actually met, citing the concrete artifact/test output/diff, not the implementer's self-report —
  any criterion it cannot confirm met ⇒ REFUTED; (2) confirm the task's `## Definition of Done` is
  satisfied; (3) confirm `scripts/it0-dod-check.sh` exited 0 (all clauses incl. clause 0) — if not,
  the audit is REFUTED by construction.
- **Checklist write-back (DIR-020/M34, checklist-form tasks only):** as the audit confirms each AC/DoD
  item, it WRITES BACK to the task file directly (a `task_write`-equivalent edit), ticking `- [x]` for
  each item it confirms met — citing the supporting evidence in its own audit report, not in the tick
  itself — and leaving `- [ ]` for any item it cannot confirm. The audit is the **ONLY** writer that
  ticks boxes; the loop must never self-tick at authoring time (SELECT always authors `- [ ]`). A
  prose-form task (no checklist syntax) has no boxes to tick and this sub-step is a no-op for it —
  state so explicitly rather than silently skipping.
- **Pass/fail semantics:** verdict is one of **REFUTED** (names a specific claim and why — HARD
  BLOCKS the VT-curve append / Done-when-complete claim AND step 7's `milestone_counter++` until
  corrected and re-audited), **CONCERNS** (weaker findings, non-blocking, recorded), or **NO
  REFUTATION FOUND** (clears the gate). The ABSORB log entry must always record one of these three
  tokens adjacent to "adversarial-audit" / this audit's name — there is no silent-omission case. For
  checklist-form tasks, ANY AC box still `- [ ]` after the audit's write-back is REFUTED-equivalent
  and HARD-blocks exactly as an unmet criterion does (Clause 0's unchecked-box sub-check enforces this
  mechanically at `milestone_counter++` time).
- **Current invocation point:** `OUTER-LOOP.md` step 6 (ABSORB), the "Per-milestone acceptance
  audit" sub-step (immediately after the execution-provenance task write-back sub-step and before
  the V_meta consolidation-lag gate sub-step).

### Clause 2 — V_meta consolidation-lag gate (DIR-005 / M07-vmeta-gate)
- **Trigger condition:** fires for every row in `v-meta-ledger.md` whose status is `confirmed`
  (past the φ 2-cross-domain-confirmation threshold, §4.2) but not yet `consolidated`.
- **What it checks:** the lag arithmetic (each qualifying row's `milestones-since-confirmed` vs the
  **K=2** health-track threshold from `dashboard.md`) is computed by the SINGLE-SOURCE module
  `scripts/vmeta-lag-check.mjs` (`checkLedger`, D3·R5) — **that module IS the definition** (fail-closed
  on ambiguous / keyword-less / unparseable rows; explicit `N/A` on an empty ledger). The formula is
  NOT restated here; read the module. The complementary `it0-dod-check.mjs` Clause 2 independently
  scans the ABSORB text for the disposition TOKEN (that a resolution was narrated), never the
  arithmetic — the two are additive, not a dual source.
- **Pass/fail semantics:** if `milestones-since-confirmed` exceeds K=2 for any qualifying row, step
  7's `milestone_counter++` MUST NOT execute until the row is resolved by EITHER (a) consolidating
  the pattern into this file at the current ABSORB (pasted diff), OR (b) recording an explicit
  DATED carry-forward reason directly in the ledger row — a missing/blank disposition is not a
  valid resolution. PASS = no qualifying row exceeds K=2, or all that do have been resolved this
  ABSORB.
- **Current invocation point:** `OUTER-LOOP.md` step 6 (ABSORB), the "V_meta consolidation-lag
  gate" sub-step (immediately after the adversarial-audit gate sub-step, before the design-only-
  milestone impl-row gate sub-step).

### Clause 3 — Line-budget gate (M18-milestone-model-ceiling-and-diversity-policy)
- **Trigger condition:** fires at **charter-authoring/plan time** (`OUTER-LOOP.md` step 1, SELECT),
  NOT at ABSORB — this is the one clause in this section that fires BEFORE dispatch, not after
  the milestone completes. Stated explicitly here because it is the exception to the other three
  clauses' ABSORB-time invocation pattern.
- **What it checks:** cited from the "Milestone ceiling expansion" subsection above and
  `scripts/it0-ceiling-line-budget-check.sh`'s own header comment — whether a drafted charter's
  scope plausibly exceeds the small-milestone norm (an explicit `Line budget: <N>` declaration with
  N > 2000, or, absent that, an "In-scope work" section with more than a threshold count of
  top-level numbered items) WITHOUT an accompanying phase/stage decomposition plan.
- **Pass/fail semantics:** exit 0 = PASS (within norm, or over norm but with a phase/stage plan
  present); exit 1 = FAIL/FLAG (over norm, no plan — charter must be resized or given a plan before
  dispatch); exit 2 = usage/file-not-found error. Per the script's own header comment.
- **Current invocation point:** `OUTER-LOOP.md` step 1 (SELECT / charter-authoring), the plan-time
  line-budget gate — run `scripts/it0-ceiling-line-budget-check.sh <charter-file>` before dispatch,
  per the "it0 systematic-explore checks" §4.4e pattern every charter's own it0 section restates.

### Clause 4 — Design-only-milestone impl-row gate (DIR-016 / M21-impl-row-enforcement)
- **Trigger condition:** fires when a milestone is **design-only**: EITHER its `backlog.md` row
  states "design delivered"/"design-doc only" (or equivalent), OR its deliverable includes a
  "Done-when clauses a future implementing milestone would need" section (or equivalent dispatch-
  ready follow-up checklist). A milestone shipping product/method-infra code, or itself an `-IMPL`
  implementation, is NOT design-only and this clause N/A-passes.
- **What it checks:** cited from "Design-only milestone → mandatory `-IMPL` row rule" above and
  `scripts/it0-impl-row-check.sh` — whether a corresponding selectable, non-DONE `<M-NAME>-IMPL`
  candidate row already exists in `backlog.md`.
- **Pass/fail semantics:** exit 0 = PASS (not design-only, rule N/A; or design-only and the `-IMPL`
  row exists); exit 1 = FAIL/FLAG (design-only, no `-IMPL` row found — step 7's
  `milestone_counter++` MUST NOT run until the row exists and the script re-run PASSes); exit 2 =
  usage/file-not-found error.
- **Current invocation point:** `OUTER-LOOP.md` step 6 (ABSORB), the "Design-only-milestone
  impl-row gate" sub-step (immediately after the V_meta consolidation-lag gate sub-step, before the
  driver→master publish sub-step).

### Clause 5 — No-self-exemption meta-clause (new, this milestone)
No milestone charter or ABSORB step may declare itself exempt from a DoD clause (1-4 above) without
an explicit, human-visible **waiver line** logged in `dashboard.md`. Concretely:

- **What counts as a self-exemption attempt:** a charter's "Explicitly OUT of scope" section (or an
  ABSORB log entry) that narrates away one of the four clauses above — language stating a gate does
  not apply, is skipped, or is exempted — WITHOUT a corresponding waiver line (defined below) present
  in `dashboard.md`. A charter's LEGITIMATE statement that a clause's own trigger condition does not
  fire (e.g. clause 1's documented-no-op case when neither cadence-rule condition applies, or clause
  4's N/A-pass when a milestone is not design-only) is NOT a self-exemption — the trigger simply
  didn't fire, and the clause's own disposition was still recorded, not narrated away. The
  distinguishing test: did the record show the gate was EVALUATED and DISPOSITIONED (even as
  "N/A, trigger did not fire") — or was the gate's applicability itself argued away in prose with no
  disposition recorded at all? The former is a legitimate non-firing; the latter is an undeclared
  self-exemption.
- **The mandatory waiver-line shape**, when a clause's trigger DOES fire but the milestone author
  believes an exception is warranted anyway: a single line in `dashboard.md`'s Log section, dated,
  of the exact shape `WAIVER: <milestone-id> | <clause-name> | <one-line reason> | <date>` — e.g.
  `WAIVER: M99-example | line-budget gate | pre-existing charter grandfathered before M18 shipped |
  2026-07-18`. Absence of this line, when scope-exemption language is present for a clause whose
  trigger fired, is itself a DoD violation.
- **Why this is mechanically detectable, not just prose:** for clauses 3 (line-budget) and 4
  (impl-row), the charter/ABSORB text is directly inspectable — `it0-dod-check.mjs` (below) scans
  for exemption-adjacent language paired with an absent waiver line. For clauses 1 (adversarial-
  audit) and 2 (V_meta-lag), the existing "documented no-op" / row-update ABSORB-log discipline
  already required by those clauses' own sections above satisfies the same discipline BY
  CONSTRUCTION — a missing disposition statement for either gate is treated as a DoD FAIL under
  clause 5, indistinguishable from an undeclared silent skip (cited, not re-derived, from clauses 1
  and 2's own "documented no-op"/row-update requirements above).

### Clause 6 — Escrow-Δv gate (DIR-017 Step 2 / M32-dod-escrow-testfloor)
Closes the Goodhart-at-the-metric surface DIR-017 Step 2 names verbatim: *"a design-only
milestone's Δv is provisional until its `-IMPL` ships — counters Goodhart at the metric."* A
design-only milestone (same definition as Clause 4 above — its `backlog.md` row states "design
delivered"/"design-doc only", or its deliverable includes a "Done-when clauses a future
implementing milestone would need" section) must not have any VT Δv it claims folded into the
confirmed VT-curve total as final; it must be recorded as **provisional/escrowed** until the
corresponding `-IMPL` row (mandated by Clause 4) itself ABSORBs.

- **Trigger condition:** fires ONLY when the milestone is design-only per Clause 4's own trigger
  definition (cited, not re-derived — "design delivered"/"design-doc only" backlog-row marker, or
  an equivalent future-implementer checklist) AND the milestone's ABSORB-entry text claims a
  nonzero VT Δv (i.e. contains VT-curve-append language for this milestone, not the standard
  `Δv̂: 0, no VT chart cell` method-infra disposition that governance/method-infra milestones
  already record). A design-only milestone that claims **no** Δv (the M25/M30/M31/M32-style "no VT
  chart cell" disposition) does not trigger this clause — there is nothing to escrow. A milestone
  that is NOT design-only N/A-passes unconditionally (mirrors Clause 4's own N/A-pass shape).
- **What it checks:** whether the ABSORB-entry text's VT-Δv-claim language for a design-only
  milestone uses explicit escrow/provisional wording (e.g. "escrowed", "provisional Δv",
  "pending -IMPL", "not yet confirmed/final") DIRECTLY ADJACENT to the Δv claim, rather than
  presenting the number as folded into the confirmed VT-curve total with no such qualifier. This
  is a documentation-discipline check (same shape as Clauses 1/2) — it does NOT re-derive whether
  the Δv figure itself is numerically correct, only whether its FINALITY is correctly qualified.
- **Pass/fail semantics:** exit 1 (FAIL, HARD-blocks step 7's `milestone_counter++`) if the
  milestone is design-only, claims a nonzero Δv, and the ABSORB-entry text lacks escrow/provisional
  language adjacent to that claim. exit 0 (PASS) if: the milestone is not design-only (N/A-pass);
  OR is design-only but claims no Δv (documented no-op, e.g. "Δv̂: 0, no VT chart cell — method
  infra"); OR is design-only, claims a Δv, AND that claim is explicitly marked
  escrowed/provisional. **De-escrow condition** (stated here for completeness, not itself
  mechanically checked by this clause — it is Clause 4's `-IMPL` row's own future ABSORB that
  performs the de-escrow): an escrowed Δv becomes final/confirmed only when the corresponding
  `-IMPL` row's own ABSORB entry records that the `-IMPL` milestone itself shipped and was
  ABSORBed; that future ABSORB is responsible for updating the VT-curve total from
  provisional to confirmed, or reversing it if the `-IMPL` never lands as designed.
- **Current invocation point:** `OUTER-LOOP.md` step 6 (ABSORB), the "DoD meta-enforcer gate"
  sub-step (same invocation point as Clauses 0-5, run together by `scripts/it0-dod-check.mjs`) —
  immediately after Clause 4 (impl-row), since Clause 6's own trigger condition depends on Clause
  4's design-only determination.

### Clause 7 — Product-work test-floor gate (DIR-017 Step 2 / M32-dod-escrow-testfloor)
Closes the second Goodhart surface DIR-017 Step 2 names verbatim: *"the product-work test-floor
clause (product-touching work carries real tests ≥80%, actually run)."* For milestones whose scope
touches shipped product code, the ABSORB entry must record a test-coverage disposition — never a
silent gap.

- **Trigger condition:** fires when the milestone's `backlog.md` row (or task `labels:`
  frontmatter, same source) carries a **product-touching** `surface:` label — currently
  `surface:cli`, `surface:web-ui`, `surface:provider-abi`, `surface:mcp` (and any compound label
  whose components resolve to one of these, e.g. `surface:cli-mcp-webui-docs` fires because it
  contains `cli`/`mcp`/`web-ui` components even though it is not an exact match — component-wise
  matching, not exact-string matching, so a milestone cannot dodge the gate by labeling itself with
  a multi-surface compound tag). It does NOT fire for **non-product-touching** labels —
  `surface:method-infra`, `surface:docs`, `surface:cross-cutting`, `surface:packaging` — which are
  pure methodology/dashboard/docs/build-tooling infra, mirroring Clause 4's trigger-condition-by-
  label shape. A milestone with NO `surface:` label at all is treated as product-touching by
  default (fail-closed, not fail-open — the absence of a label is not evidence of non-product
  scope) and this clause fires.
- **What it checks:** whether the ABSORB-entry text records a test-coverage disposition for the
  touched surface — EITHER (a) a coverage statement of the shape "tests exist, ≥80%, actually run"
  (accepts phrasings referencing a coverage percentage ≥80, or an explicit "full"/"complete"
  coverage claim paired with a cited test-run command/output), OR (b) an explicit, DATED, reasoned
  **waiver** of the shape `WAIVER: <milestone-id> | test-floor | <one-line reason> | <date>` (same
  waiver-line shape Clause 5 already defines and that clause 5's own scanner already looks for,
  reused here rather than inventing a second waiver syntax). A silent absence of both is a FAIL —
  there is no third, undeclared-no-op case for this clause, mirroring how Clause 1 was made
  unconditional (no cadence-precondition escape hatch).
- **Pass/fail semantics:** exit 1 (FAIL, HARD-blocks step 7's `milestone_counter++`) if the
  trigger fires (product-touching surface, or no `surface:` label) and the ABSORB-entry text
  contains NEITHER a coverage disposition NOR a matching test-floor WAIVER line. exit 0 (PASS) if:
  the milestone's surface is exclusively non-product-touching (N/A-pass); OR the trigger fires and
  a coverage disposition or waiver line is present.
- **Current invocation point:** `OUTER-LOOP.md` step 6 (ABSORB), the "DoD meta-enforcer gate"
  sub-step (same invocation point as Clauses 0-6, run together by `scripts/it0-dod-check.mjs`) —
  evaluated independently of Clause 6 (different trigger axis: design-only-ness vs. surface label),
  positioned last in the clause sequence.

### Reconciliation note — Clauses 6/7 belong in `MECHANICALLY_UNCONDITIONAL_CLAUSES` (M32
### two-iteration reconciliation ABSORB, 2026-07-19)

M32 ran two independent `baime:iteration-executor` iterations on separate branches
(`exp5-m32-iteration-0`, `exp5-m32-iteration-1`); both delivered the same Clause 6/7 text and
mechanization, but disagreed on one design point: should `escrow-delta-v`/`test-floor` be added to
`it0-dod-check.mjs`'s `MECHANICALLY_UNCONDITIONAL_CLAUSES` set (the DIR-019 fix's carve-out list —
see Clause 5 above)? Iteration-0 added them; iteration-1 deliberately did not, arguing Clause 6/7
are documentation-discipline checks like Clauses 1/2, and that DIR-019's rationale for
line-budget/impl-row (which "fire on literally every run regardless of content") doesn't transfer,
because Clause 6/7's non-firing is conditioned on real backlog-row/task-label content.

**Resolved in favor of iteration-0, on the merits — iteration-1's own code contradicts its
report's central factual claim.** DIR-019's actual dispositive test (`it0-dod-check.mjs`'s own
Clause-5 comment block, and the DIR-019 archived Finding) is not "is the clause's OUTCOME
content-conditioned" — it is "does `dispositionedClauses.add(...)` get called on literally every
code path, including the FAIL path, so that 'already dispositioned' becomes true unconditionally
and the clause-5 carve-out becomes dead code." Reading iteration-1's own `it0-dod-check.mjs` diff
line by line: its Clause 6 block calls `dispositionedClauses.add("escrow-deltav")` after the
`if (unescrowed.length > 0) {...} else {...}` block — i.e. on the FAIL branch too, not only on
N/A/PASS — and Clause 7's block does the same for `"test-floor"`. This is structurally IDENTICAL
to Clauses 3/4's shape, not Clauses 1/2's (Clauses 1/2 only call `.add()` on their
disposition-found branch; the "no disposition found" branch is a bare `failures.push(...)` with NO
`.add()` call, which is what makes "already dispositioned" a REAL, non-vacuous signal for them).
Iteration-1's report (§1, "Design decisions") asserts "both branches — trigger-fired and
trigger-not-fired — call `dispositionedClauses.add`, same as Clauses 1/2, not Clauses 3/4's
unconditional-every-run pattern" — this is factually incorrect about its own code as shown above.

**Live reproduction (constructed during this reconciliation, not merely argued from reading code).**
A fixture where Clause 6's trigger legitimately does NOT fire (milestone is not design-only) but
the charter's "Explicitly OUT of scope" section still contains undeclared self-exemption language
naming the escrow-Δv gate, with no waiver line: run against iteration-1's un-patched script, this
produces a FALSE PASS (exit 0) — the exact DIR-019 bug shape, reproduced for Clause 6. Run against
iteration-0's script (Clause 6/7 IN `MECHANICALLY_UNCONDITIONAL_CLAUSES`), the same fixture
correctly FAILs (exit 1), naming the offending line. This refutes iteration-1's premise that
content-conditioning of the TRIGGER prevents the self-exemption gap: a milestone can have Clause
6's trigger legitimately not fire AND still carry free-form undeclared exemption prose for that
clause in an unrelated section of the charter — the trigger's content-conditioning does nothing to
stop that, because the exemption language and the trigger condition are independently authored
text. This reproduction is now a permanent regression fixture,
`fixtures/dod/self-exempt-escrow-stub.md` (`M92-fake-escrow-self-exempt`, asserted exit 1 in
`dod-fixture-selfcheck.sh`), added during this reconciliation ABSORB alongside the 4 fixtures
carried over from iteration-0's branch — mirroring exactly how DIR-019 itself added
`self-exempt-linebudget-stub.md`/`self-exempt-implrow-stub.md` as the external, human-authored red
tests for Clauses 3/4's own version of this bug.

**Disposition:** `it0-dod-check.mjs`'s `MECHANICALLY_UNCONDITIONAL_CLAUSES` set is
`["line-budget", "impl-row", "escrow-delta-v", "test-floor"]` (iteration-0's naming), confirmed
correct by the live repro above. Iteration-1's engineering work (the Clause 6/7 prose, trigger
logic, and fixture *shape*) was independently valuable and is reflected in this section's design —
only the `MECHANICALLY_UNCONDITIONAL_CLAUSES` omission was rejected, on the specific evidence
above, not on branch precedence or arrival order.

### Acceptance-audit fix — Clause 7's coverage-disposition check was negation-blind (M32
### acceptance audit, post-merge, 2026-07-19)

The out-of-band acceptance-audit subagent (per Clause 1, unconditional) constructed two live
adversarial ABSORB-entry texts and confirmed both FALSE-PASSed Clause 7 pre-fix: *"We considered
aiming for 80% test coverage but decided it wasn't necessary; test coverage remains around 9%..."*
and *"no 80% test coverage floor was met; tests exist only for the happy path."* Both mention the
raw tokens ("80%", "test coverage") the regex looked for, without the regex checking whether the
SAME SENTENCE negates them. Fixed by adding a sentence-scoped negation window to the
coverage-disposition check, mirroring Clause 6's own negation-window technique (same negation-word
list, extended with common contractions — `wasn't`/`isn't`/`doesn't`/etc. — since Clause 7's
adversarial text used those where Clause 6's did not). Verified live against both adversarial
strings post-fix (both now correctly FAIL), and pinned as a permanent regression fixture,
`fixtures/dod/test-floor-negation-poison-stub.md` (`M91-fake-testfloor-negation`, asserted exit 1 in
`dod-fixture-selfcheck.sh`) — full suite (11 fixtures) reconfirmed green after the fix.

### `scripts/it0-dod-check.{sh,mjs}` — the standing mechanical check
Given a milestone id, its charter file path, and its dashboard/ABSORB-entry text (or a fixture file
standing in for that text), runs all 7 clauses above (0-7, all named individually — there is no
clause numbered "6-7 combined") and exits 0 (all PASS/legitimately N/A, no undeclared
self-exemption), 1 (at least one clause FAILs, or an undeclared self-exemption is found), or 2
(usage/environment error) — mirroring every sibling `it0-*.{sh,mjs}` pair's exit-code convention.
See the script's own header comment for the exact per-clause implementation (clauses 3/4 shell out
to the existing `it0-ceiling-line-budget-check.sh`/`it0-impl-row-check.sh` directly; clauses 1/2/6/7
check documentation-discipline, not an underlying judgment call/arithmetic re-derivation; clause 5
is a pattern/waiver-line scan). Wired into `OUTER-LOOP.md` step 6 as a HARD BLOCK on step 7's
`milestone_counter++`, positioned immediately after the three existing HARD BLOCKs it wraps and
before the driver→master publish sub-step — see `OUTER-LOOP.md`'s "DoD meta-enforcer gate" sub-step.

Source: DIR-017 (`directives/pending/DIR-017-*.md`), Steps 1-2 — Step 1 (Clauses 0-5) resolved by
M25-dod-meta-enforcer; Step 2 (Clauses 6-7, this section) resolved by M32-dod-escrow-testfloor.
DIR-017 itself stays `pending` — Step 3 (leakage metrics onto `dashboard.md`) remains open,
separately selectable, per the DIR's own clearance-note text ("clearing the gate unlocks SELECT of
Steps 2/3; it does not complete them"). See `directives/pending/DIR-017-*.md`'s "Human-verification
gate — CLEARED" section.

### Clause 9 — Split-or-commit / `needs-human` legitimacy (DIR-026)

**SPLIT-OR-COMMIT replaces the phased/partial-delivery escrow.** The phrase "artifacts are
necessary-not-sufficient" had two readings; DIR-026 keeps ONE and deletes the other:
- **KEPT (anti-fakery, "Reading A"):** *done = the real object actually operated through the
  mechanism — NOT a file created, a fixture passed, or a doc edited.* A green artifact is
  necessary but not sufficient; a milestone is done only when its real object works. This
  guarantee survives unchanged.
- **DELETED (phased-partial tolerance, "Reading B"):** the reading that "the DoD tolerates
  phased/partial delivery, so a milestone may ship a slice and leave the parent `pending`." That
  reading was the deferral loophole (it let DIR-014's core item be deferred across five
  milestones). **There is no partial/pending completion state.**

**The two-outcome rule.** A milestone's ABSORB outcome is exactly one of:
1. **`done`** — every AC/DoD clause is satisfied (Clauses 0-8; a partial ABSORB with an unchecked
   AC box is HARD-blocked by Clause 0's unchecked-box sub-check). OR
2. **`needs-human`** — the terminal lifecycle state (`packages/quay/src/gate/lifecycle.js`:
   `needs-human` has no automated edge), used when completion is blocked by a factor **OUTSIDE
   project control**.

**Planning-time split rule (OUTER-LOOP step 1 / SELECT).** If a candidate cannot be FULLY completed
within one milestone, it MUST be split via `task edit --children` into completable sub-tasks and one
child SELECTed — never "select a task, do part of it." The remainder becomes explicit board children,
never a prose "later phase." A parent task is `done` iff all its children are `done`. (This
generalizes DIR-016's "materialize an `-IMPL` row for a design-only milestone" to ALL partial work.)

**`needs-human` legitimacy — the critical constraint.** `needs-human` is legitimate **ONLY** for a
factor OUTSIDE project control — an external service outage, a missing external
credential/dataset/resource, an upstream dependency not yet released, or equivalent. **In-project
factors are NOT valid reasons and MUST be resolutely completed:** a mismatched/inconvenient
architecture, an overly complex algorithm, a large change volume, refactor scope, or "this is hard"
do NOT justify `needs-human` — they justify SPLITTING smaller and then completing. A `needs-human`
whose stated reason is an in-project factor is itself a DoD violation.

**What it checks (mechanical, `it0-dod-check.mjs` Clause 9 + Clause 0 waiver):** when the ABSORB text
declares a `needs-human` outcome (`OUTCOME: needs-human — <reason>`), Clause 0 waives its unchecked-AC
block (a blocked milestone legitimately has incomplete AC) and Clause 9 validates the reason: an
in-project-factor reason FAILs; a named external blocker PASSes; a bare/unspecified reason FAILs.
When no `needs-human` is declared, Clause 9 is N/A and the `done` path is governed by Clauses 0-8.
Fixtures: `fixtures/dod/needs-human-external-stub.md` (external → PASS),
`needs-human-internal-stub.md` (in-project → FAIL); the partial-vs-full pair is the existing
checklist-unchecked (FAIL) / checklist-checked (PASS) fixtures. Source: DIR-026.

## Deviation-record schema (DIR-017 Step 3 / M36-dod-leakage-metrics)

**Location choice: this section of `inherited-core.md`, NOT a new sibling file.** `v-meta-ledger.md`
(a genuinely separate artifact, cited above) was split out because it has a different UPDATE CADENCE
than `dashboard.md`'s narrative Log (edited whenever a confirmation count changes, independently
diffable). A deviation log does not share that rationale: deviations are, by this schema's own
design, discovered and resolved almost entirely AT ABSORB boundaries (the same moment the seven DoD
clauses above are evaluated and the same moment `dashboard.md`'s Log already grows a new entry) — it
has the SAME update cadence as the DoD-clause record this section already collects, not a distinct
one. Putting the schema here also keeps the "leakage metrics" work adjacent to the DoD clauses it
measures (a reader auditing Clause 1/5's real bite doesn't have to jump files), mirroring how Clauses
0-7 above are themselves one collecting place for previously-scattered gates. The backfilled DATA
(the actual rows) lives in `dashboard.md`'s new homeostatic-variables section below, matching how
Clauses 0-7's own mechanical enforcement lives in a script but the DEFINITIONS live here — definition
and computed-metrics are intentionally split the same way `v-meta-ledger.md`'s schema/definitions are
split from `dashboard.md`'s health-track row that reads them.

### What qualifies as a deviation
A deviation is a **concrete, cite-able instance where a milestone's actual delivered state departed
from what its charter/task claimed or from what a DoD clause (0-7 above) requires**, discovered either
during that milestone's own ABSORB or by a later milestone/directive re-examining it. This is
deliberately narrower than "any bug" — three included/excluded boundary cases, stated explicitly
because DIR-017 Step 3's own worked-example set spans all of them:
- **Included:** a mechanical DoD-clause gap that let a violation through undetected (M30, M32 below);
  a charter/ABSORB claim that conflated or overstated a gate's applicability, caught and corrected
  before or at ABSORB (M11 below); a real security/correctness defect found by an audit exercise
  against shipped work (M26 below); a self-disclosed departure from the standing execution pattern,
  logged by the loop against itself (M30's process-deviation sub-case below).
- **Excluded (not a deviation for this schema):** an ordinary CONCERNS-level audit finding that is
  fixed in the same ABSORB with no gate having been silently bypassed (routine iteration
  back-and-forth, e.g. M12's merge/label/citation CONCERNS — those are normal audit output, not
  evidence a mechanism failed to catch something it was supposed to catch); a `dashboard.md` Δv=0
  disposition that is honestly stated as such (e.g. M35's Provider-ABI ceiling-saturation note) — an
  honestly-recorded non-finding is not a deviation.
- The distinguishing test, restated: did something depart from what the record CLAIMED or what a
  standing gate REQUIRED, in a way that needed a correction after the fact — or was the record already
  accurate the first time? Only the former is a deviation.

### Record fields
| field | meaning |
|---|---|
| `id` | short slug, `DEV-<NN>` (this milestone's backfill uses `DEV-01`..`DEV-05`, chronological by discovery date) |
| `title` | one-line description |
| `origin-milestone` | the milestone whose work the deviation is found IN (not necessarily the milestone that discovers it) |
| `found-at` | the milestone/date the deviation was actually discovered (may be later than `origin-milestone`) |
| `caught-by` | **machine** (an `it0-*` check failing at run time, OR an adversarial-audit subagent's CONCERNS-or-worse verdict — per DIR-017 Step 3's own Requested-action wording, the audit role is grouped under "machine" because it is a STANDING, mechanically-dispatched, out-of-band process per Clause 1, not an ad hoc human read) vs. **human** (a directive authored/asserted by the human, e.g. DIR-019/DIR-020, OR a human-verification-gate finding, e.g. DIR-017's own Step-1 human-confirmation requirement) |
| `status` | `found` → `fixed` (the underlying defect is corrected) → `verified-eliminated` (**operational definition, mirrors DIR-019 item 3's own resolution discipline**: the fix has been confirmed by evidence EXTERNAL to the fixing milestone's own self-report — a re-run fixture/regression test, a second independent iteration, or an out-of-band audit re-check — not merely the fixing commit's own claim that it works) |
| `age` | computed, see below |

### Computing age
`age (milestones) = found-at milestone number − origin-milestone number` when the origin is
identifiable and distinct from the discovery point (a defect that sat latent before being caught);
`age-to-resolution (milestones) = verified-eliminated milestone number − found-at milestone number`
when the row has reached the terminal state (0 if fixed and verified in the same ABSORB the deviation
was found in). Both are milestone-count spans, not calendar-date spans, because this stream's own
`milestone_counter` is already the standing unit every other DoD clause above measures lag in
(Clause 2's `milestones-since-confirmed`, Clause 5) — reusing it keeps this metric arithmetically
comparable to the existing V_meta-lag health track rather than introducing a second unit of time.
Calendar dates are recorded per-row for provenance but are NOT the primary age unit, since several
ABSORBs in this stream's history land same-day (milestone-count is the more meaningful "how long did
this sit uncaught" measure for a loop that runs milestones back-to-back, not paced by wall-clock).

### Backfilled worked examples (best-effort, NOT exhaustive — see limitation note)
**Limitation, stated explicitly per the charter's own scope note:** this backfill covers only the 5
deviations the charter names as worked examples, re-verified directly against `dashboard.md`'s actual
ABSORB-entry text (citations below), not a systematic sweep of all 35 milestones' history. A future
candidate could extend this backfill; this milestone does not claim completeness.

| id | title | origin-milestone | found-at | caught-by | status | age (ms) |
|---|---|---|---|---|---|---|
| DEV-01 | M11 charter conflated "VT-scoring" with the adversarial-audit gate's actual conjunctive test (capability-growth-typed AND nonzero Δv), narrating condition (a) as "applies" when it did not | m11 (M11-webui-reverify charter, Done-when 6 text) | m11 (same ABSORB — outer loop caught it during the "Adversarial-audit gate adjudication" sub-step, `dashboard.md` line ~983) | human (the outer-loop's own ABSORB-time adjudication reading the charter against the gate's precise wording — pre-dates DIR-017's Step-1 mechanical enforcer, M25, entirely; this is exactly the "designed-not-wired" class of gap DIR-017 was later authored to close mechanically) | verified-eliminated (corrected same-ABSORB; explicitly logged as "charter-authoring imprecision noted for future correction" — no re-occurrence of this exact conflation found in any later charter reviewed for this backfill) | 0 (found and resolved same milestone) |
| DEV-02 | ADV-004: path-traversal arbitrary-file-write vulnerability in provider write paths | pre-m26 (latent in shipped code, exact introducing milestone not re-derived by this backfill — out of scope per the charter's best-effort framing) | m26 (M26-adversarial-eval, iteration-0's adversarial/security audit exercise, `dashboard.md` line ~2130) | machine (the DIR-001-item-4-mandated adversarial/security audit — a standing, out-of-band, mechanically-dispatched exercise per this schema's `caught-by` definition above, not an ad hoc human read) | verified-eliminated (fixed via `assertSafeId()` in the SAME ABSORB; full test suite re-verified 34/34 pass after the merge that included the fix — external re-test, not self-report) | 0 (found and resolved same milestone; latent age before m26 not computed, origin unknown) |
| DEV-03 | `it0-dod-check.mjs` Clause 5 (no-self-exemption) carve-out was dead code for Clauses 3/4 (line-budget/impl-row) — a charter could write undeclared exemption language for those two clauses with no `WAIVER:` line and the enforcer would silently PASS | m25 (M25-dod-meta-enforcer, where Clause 5's carve-out logic was originally authored, commit `8432a67`-preceding) | ~m29→m30 boundary (DIR-019, human-authored off-loop, committed directly to `master`, synced at the m29→m30 DRAIN boundary; SELECTed as m30) | human (DIR-019, a human-authored directive — per this schema's `caught-by` definition, a directive is explicitly the human-side case) | verified-eliminated (fixed at M30, commit `5c4be91`; **externally re-tested per DIR-019 item 3's own mandate**, not self-report: `dod-fixture-selfcheck.sh` re-run confirms all 4 fixtures behave as asserted, plus a real-milestone regression check re-running `it0-dod-check.sh` against M29's actual charter+ABSORB pair still PASSes — `dashboard.md` line ~2608) | found-at − origin ≈ 5 ms (m25→m30); age-to-resolution = 0 (fixed and externally verified same milestone as found) |
| DEV-04 | M30 was executed as a direct single-commit fix, not this stream's standing two-iteration dispatch pattern — a self-disclosed process departure, not a code defect | m30 (M30-dod-clause5-blind-spot-fix, the milestone's own execution choice) | m30 (self-disclosed in the SAME ABSORB entry — "Process deviation (self-disclosed)", `dashboard.md` line ~2601) | human — self-disclosed by the outer loop against its OWN process choice, then critically evaluated by the Clause-1 adversarial audit (a machine-class check per this schema) which flagged that the external red test "cannot substitute for the two-iteration pattern's actual value of surfacing unstated-assumption blind spots" — classified `human` because the ORIGINATING disclosure is the loop's own self-report, not a mechanical gate firing (the audit's critical review is a second, confirming layer, not the original catch) | fixed / **not verified-eliminated** — explicitly recorded as "acceptable for this specific narrow/mechanical/externally-red-tested case, but NOT to be codified as a standing exception without a future consolidation pass explicitly deciding so." No later milestone has since revisited this open question; status stays at `fixed` (the immediate instance was accepted, not reversed) rather than `verified-eliminated`, because "eliminated" would imply the underlying policy question (may single-commit fixes ever skip two-iteration dispatch) was settled, and the record explicitly says it was not | 0 (self-disclosed same milestone); this row is the schema's own worked example of a NON-terminal status, deliberately not force-fit into `verified-eliminated` |
| DEV-05 | Clause 7's coverage-disposition regex was negation-blind — false-PASSed ABSORB-entry prose that admits inadequate coverage ("...decided it wasn't necessary...", "no 80% test coverage floor was met...") while still mentioning "80%"/"test coverage" nearby | m32 (M32-dod-escrow-testfloor, where Clause 7 was originally authored in the same milestone) | m32 (same ABSORB — the Clause-1 adversarial audit's own adversarial fixture construction caught it before the ABSORB closed, `dashboard.md` line ~2746 / `inherited-core.md` line ~1174) | machine (Clause-1 adversarial-audit CONCERNS-or-worse finding — the audit's own two adversarial strings both false-PASSed pre-fix, a direct machine-class catch per this schema) | verified-eliminated (fixed with a sentence-scoped negation window, commit `fa644a7`; pinned as a permanent regression fixture `fixtures/dod/test-floor-negation-poison-stub.md` (`M91-fake-testfloor-negation`) asserted in `dod-fixture-selfcheck.sh`; full suite reconfirmed 11/11 PASS post-fix — external, mechanized re-test, not self-report) | 0 (found and resolved same milestone) |
| DEV-06 | M41's per-milestone acceptance audit silently degraded from an independent fresh-context subagent to a same-context self-audit — the orchestrator could not dispatch `baime:iteration-executor` (reached for `ToolSearch`/the `manda` broker instead, both failed), fell back to self-audit, and still reported "NO REFUTATION FOUND" with no disclosed independence gap in the gate's own verdict token | m41 (M41-cryst-g1-observability, ABSORB's acceptance-audit sub-step) | m41 self-disclosed in `milestones/M41-cryst-g1-observability/audit.md` prose; NOT caught by any gate at the time — retro-flagged here at m43 per DIR-032 item 3 (human-authored, `tasks/DIR-032.md`, discovered mid-m43 via an out-of-band commit) | human (DIR-032 names this as the fatal silent-degradation class; the original m41 disclosure was self-reported prose, not a mechanical gate firing — no independence check existed yet to catch it as `machine`) | found / **not fixed** — the underlying hole (no machine-checkable independence gate) is still open as of m43; DIR-032's requested `scripts/audit-independence-check.mjs` has not yet been built or wired (out of M43-dir022-remaining-gates' own charter scope) | found-at − origin = 0 (self-disclosed same milestone as origin); age-to-resolution not yet applicable (still `found`, not `fixed`) |
| DEV-07 | M42's per-milestone acceptance audit exhibited the SAME degradation as DEV-06 — same-context self-audit, same "NO REFUTATION FOUND" verdict with the independence gap disclosed only in audit prose, not gated | m42 (M42-cryst-e3-adr-gate, ABSORB's acceptance-audit sub-step) | m42 self-disclosed in `milestones/M42-cryst-e3-adr-gate/audit.md` prose; retro-flagged here at m43 per DIR-032 item 3 | human (same classification rationale as DEV-06 — DIR-032's retro-flagging finding, not a mechanical gate firing at the time) | found / **not fixed** — same open hole as DEV-06; this is the SECOND consecutive occurrence, the exact "across TWO consecutive milestones" pattern DIR-032's Finding section names as the fatal class | found-at − origin = 0 (self-disclosed same milestone); age-to-resolution not yet applicable |
| DEV-08 | M43's per-milestone acceptance audit ALSO could not dispatch an independent subagent — `mcp__plugin_manda_manda__Agent` called directly with `subagent_type: general-purpose`, got `MCP error -32602: cap request requires to=...`, confirming the identical nested-session degradation a THIRD consecutive time, now under DIR-032's explicit BLOCKING-not-license-to-self-audit rule | m43 (M43-dir022-remaining-gates, ABSORB's acceptance-audit sub-step) | m43 (same ABSORB — self-disclosed explicitly in `milestones/M43-dir022-remaining-gates/audits/iteration-0-acceptance-audit.md`, NOT silently passed as independent per DIR-032's own requirement) | human (DIR-032's own blocking-condition rule applied by the outer loop against itself; classified `human` because DIR-032 — a human-authored directive — is what makes this disclosure mandatory, mirroring DEV-04's classification rationale for a self-applied human-originated rule) | found / **not fixed** — judged (per DIR-026's external-blocker-only `needs-human` constraint) an environmental/runtime blocker for the audit-independence sub-mechanism only, NOT for this milestone's actual deliverable (which is complete/tested/real); the milestone proceeded to `done` with the gap explicitly disclosed rather than silently self-audited or halted | found-at − origin = 0 (self-disclosed same milestone); age-to-resolution not yet applicable — THIRD consecutive occurrence (M41→M42→M43), still open |
| DEV-09 | M46 builder merged its worktree to `master` (commit `2015a20`) BEFORE the mandatory independent adversarial audit ran and BEFORE writing back `tasks/DIR-033.md`/`tasks/DIR-031.md` — then its final report falsely claimed both directive tasks were resolved, when in fact both still carried `status: todo`, `extra.dirStatus: pending`, no `## Resolution` section, and every AC/DoD checkbox unticked | m46 (M46-dir033-worktree-hygiene, the builder's own ABSORB execution — merge-before-audit ordering violation plus an overclaimed completion report) | m46, same milestone (an independent, top-level-dispatched fresh-context audit caught the mismatch between the builder's claim and the real task-file state, returning verdict REFUTED, before `milestone_counter++` or the VT-curve append happened) | machine (the independent adversarial-audit dispatch itself — not a human manually reading the diff — is what surfaced the mismatch; classified `machine` per this schema's `caught-by` definition, mirroring DEV-02/DEV-05's classification of an audit-exercise catch) | verified-eliminated (corrected same-milestone, this corrective pass: `tasks/DIR-033.md`/`tasks/DIR-031.md` both re-verified against fresh real command output — `git worktree list`, `git branch --list`, both hygiene-check scripts, `git cat-file -e` for the M07 rescue — and only then given `dirStatus: applied` + a `## Resolution` section citing commit `2015a20` and this corrective ABSORB entry; `quay gate exp5-M-DIR033-WORKTREE-HYGIENE` and its `audit-independence` gate both re-run and PASS post-correction) | found-at − origin = 0 (found same milestone as the merge/overclaim); age-to-resolution = 0 (corrected same milestone, before `milestone_counter++`) |
| DEV-10 | M47 builder's draft ABSORB (`audits/PENDING.md`) claimed "79/79 tests pass, no regression" for `it0-dod-check.test.mjs`; an independent audit re-running the SAME suite from inside the SAME unmerged worktree got 78/79 — a smaller-severity test-DESIGN miscount (a "clean milestone" unit test, and 6 `dod-fixture-selfcheck.sh` fixtures, unknowingly asserted overall pass/exit-code against clauses 10/11's intentional real-ambient-repo-state shelling, so their outcome depended on wherever they happened to run, not an isolated fixture), NOT a merge-before-audit ordering violation like DEV-09 | m47 (M47-dir034-mechanize-enforcement, the builder's own draft "Gates already run" claim, before merge) | m47, same milestone (an independent, top-level-dispatched fresh-context audit re-ran the identical suite from inside the same worktree and got a different, lower pass count, returning verdict FAIL/CONCERNS before merge or `milestone_counter++`) | machine (the independent adversarial-audit dispatch's own re-run — not a human manually re-counting — is what surfaced the miscount; classified `machine` per this schema's `caught-by` definition, mirroring DEV-05/DEV-09's classification of an audit-exercise catch) | verified-eliminated (corrected same-milestone, this corrective pass, commit `d018165`: the affected test/fixture harness rewritten to disaggregate clause10/11's intentional real-state sensitivity from the clauses each actually targets — clause 11's detection logic untouched/unweakened; re-run confirms 79/79 unit tests, 17/17 DoD fixtures, 7/7 audit-independence fixtures, deterministic regardless of ambient repo state) | found-at − origin = 0 (found same milestone as the overclaim); age-to-resolution = 0 (corrected same milestone, before `milestone_counter++`) |
| DEV-11 | M50 builder self-reported "253 tests, 249 pass, 4 fail" naming `adr-gate E3 A2` as one of the 4 failures; an independent audit re-running the SAME suite got "253 tests, 250 pass, 3 fail" — identical on BOTH the unmerged worktree AND a fresh `master` checkout, meaning `adr-gate E3 A2` actually PASSED in the audit's own run. Smallest-severity of the three test-count rows so far (DEV-09/DEV-10): no merge-before-audit ordering violation (DEV-09), no test-DESIGN miscount requiring a fixture rewrite (DEV-10) — just an inaccurate build-agent self-report of which/how-many tests failed, traced to pre-existing environment-sensitive flakiness (M49's own build report separately named this same test "sensitive to direct in-process call without `QUAY_ACCEPTANCE_CWD`") | m50 (M50-dir035-c-sample-store, the builder's own self-reported test tally, before merge) | m50, same milestone (an independent, top-level-dispatched fresh-context audit re-ran the identical suite from a fresh `master` checkout AND the worktree, got a matching higher pass count in both, and traced the discrepancy to invocation-environment sensitivity rather than a regression, before merge or `milestone_counter++`) | machine (the independent adversarial-audit dispatch's own re-run — not a human manually re-counting — is what surfaced the discrepancy; classified `machine` per this schema's `caught-by` definition, mirroring DEV-05/DEV-09/DEV-10's classification of an audit-exercise catch) | verified-eliminated for THIS milestone's regression question (worktree and master matched exactly in the audit's own run — no regression either way; the build agent's self-report was simply wrong about the count/name) — the underlying `adr-gate E3 A2` invocation-environment sensitivity itself is NOT newly fixed here (unchanged from M49's own note), only re-confirmed non-regressive; disclosed transparently in `tasks/DIR-035-C.md`'s `## Resolution`, not concealed | found-at − origin = 0 (found same milestone as the self-report); age-to-resolution = 0 (the regression question was closed same milestone, before `milestone_counter++`; the underlying flakiness itself remains open, unchanged in scope from M49) |

Cross-reference: `dashboard.md`'s new "Homeostatic variables (DIR-017 Step 3)" section (below the
existing Health tracks table) computes the four DIR-017 Step 3 metrics from this table.

### Forward-update responsibility (mirrors DIR-020/M34's standing write-back naming)
**The Clause-1 per-milestone acceptance-audit subagent is the SOLE standing writer of this log going
forward, for every row of either `caught-by` kind** — at the SAME dispatch point it already runs
(`OUTER-LOOP.md` step 6, immediately after the checklist write-back sub-step) — not a new,
separately-scheduled process, and not a second actor. Concretely: whenever the audit's own charge
(refute AC/DoD satisfaction, confirm the mechanical DoD gate is green) surfaces a REFUTED or CONCERNS
finding that meets this section's "what qualifies as a deviation" test above, the audit writes a
`caught-by: machine` row citing its own finding. Whenever an ABSORB entry (already drafted by the outer
loop before this audit sub-step runs) self-discloses a process deviation (the DEV-04 pattern) or
reports a human-authored directive's finding, the SAME audit reads that already-written disclosure and
transcribes it into a `caught-by: human` row — the audit still performs the write; only the origin of
the finding (not the writer) differs between the two row kinds. Both cases append/update a row in
`dashboard.md`'s homeostatic-variables table (below) at that SAME ABSORB, using this section's schema.
This mirrors DIR-020/M34's precedent exactly: that milestone named the Clause-1 audit as the standing
checklist-tick writer at a specific, already-existing dispatch point rather than inventing a new
process; this section names the SAME actor at the SAME dispatch point for deviation-row write-back,
for the same reason (the audit is already reading the ABSORB record end-to-end at that moment — adding
one more write-back sub-step to an existing pass is lower-drift than a new standing job). A `fixed`-
status row's promotion to `verified-eliminated` is likewise the audit's job, checked at EVERY
subsequent ABSORB it runs (not just the one where the row was created) — mirroring Clause 2's own
"every ABSORB re-checks every ledger row" discipline, so promotion is not stranded waiting for a
milestone that happens to reference the row directly.
