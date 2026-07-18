# Inherited Core (Tier-B pinned methodology) — quay-perpetual-stream (Experiment 5)

The reusable inner methodology every milestone charter inherits by reference (charter Tier-A pins a
path + git SHA to this file; it is NOT inlined per iteration). Consolidation (§4.2) grows this file:
when a milestone adaptation is reused unchanged by a later different-domain milestone (φ confirmed),
merge it here and retire its delta citation.

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

## Value-typed SELECT ledger + governance/infra hard floor (M06-sizing Done-when clauses 2-3)

VT (the chart-0/chart-1 capability-growth score) prices only ONE kind of milestone value. DIR-004's
finding: this made SELECT compensate with ad hoc prose whenever a milestone's real value was NOT
capability-growth (m2 and m5 both scored 0 VT despite being real governance/method-infra wins; m4
scored **-6.60** VT despite being one of the two most valuable milestones so far, because it
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

### Self-consistency check: retroactively applying the ledger to m1-m5 (read-only, M06-sizing
### Done-when clause 4 — does NOT rewrite dashboard.md's settled VT numbers)

Applying the five value types to each of m1-m5's actual, already-settled outcome (per
`dashboard.md`'s Log section, read-only):

| Milestone | VT Δv (settled) | Value type(s) applied | Matches DIR-004's own characterization? |
|---|---|---|---|
| m1/M01-dist | +6.0 | **capability-growth** (closed Packaging/Distribution cov gap 0.55→0.85) | Yes — DIR-004 implicitly treats m1 as the capability-growth baseline case (the one with a real positive VT number), only flagging its SIZING as mildly oversized, not its value type. |
| m2/M-GATES | 0 | **governance-integrity** (mechanized 3 of 4 it0 checks, gate-hash/ceiling/dogfood scripts + domain-misfit procedure — these are the experiment's own control mechanisms, not product capability) | Yes — DIR-004 explicitly cites "m2 ... scored 0 VT despite being real governance/method-infra wins", i.e. non-capability-growth, matching governance-integrity here. |
| m3/M-ABI-EVAL | ≈0 direct (chart transition/re-baseline) | **discovery** (Provider-ABI capability matrix + differential conformance suite surfaced 2 previously-unknown gaps, PR-ABI-001/002, via an independent audit channel the method didn't have before) | Consistent — DIR-004's table doesn't name m3 explicitly, but its own description ("VT is blind to discovery value (m3)") directly assigns m3 the discovery type, which this row reproduces. |
| m4/M04-discover | **-6.60** | **instrument-correction** (found+fixed MD-001, a standing VT measurement error carried since before m1 — corrected an inflated chart-1 number, which mechanically shows as a VT decrease despite being real value delivered) | Yes — DIR-004 explicitly cites m4's -6.60 VT score alongside its "instrument-correction value (m4, ... scored -6.60 despite being one of the two most valuable milestones so far)" language; this row's label matches verbatim. |
| m5/M-DIR-PROJECTION | 0 (no VT chart weight — method-infra) | **governance-integrity + risk/option** (built the directive-projection anti-drift check, closing a SECOND repeat-instance of the DIR-002/DIR-006 files-canonical-without-enforcement gap — both ensures the control mechanism works (governance-integrity) and forecloses a 3rd recurrence (risk/option)) | Yes — matches this milestone's (M06-sizing's) OWN SELECT-time characterization of m5's successor M06-sizing itself as "governance-integrity + risk/option" (dashboard.md m6 SELECT log entry), and m5's own charter framing ("repeat-governance-drift risk outranks a one-off product-integrity gap"). |

**Result: applying the ledger to m1-m5 reproduces DIR-004's own characterization** — m2 and m4 land
as non-capability-growth types (governance-integrity and instrument-correction respectively,
exactly DIR-004's own language), m1 lands as the sole clean capability-growth case with a positive
VT number, and m3/m5 land as discovery and governance-integrity+risk/option respectively, matching
DIR-004's own prose description of each. This confirms the ledger's five type definitions are
usable to reproduce a real, already-independently-reached judgment, not just aspirational
categories — the same self-consistency pattern used above for the size gauge (against m1/m2/m4)
and in the domain-misfit section (against M01-dist). No dashboard.md VT number is altered by this
table; it only ADDS a value-type label alongside the existing settled numbers.
