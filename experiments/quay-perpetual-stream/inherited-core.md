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

## Human-review cadence (M15-human-review-cadence, DIR-001 item 6)

Generalizes DIR-001 item 6's original finding ("periodic human-led capability review as a standing
explore milestone... since offline data shows every structural discovery came from human insight...
never from the simulated-user") into a citable standing rule, using the real 11-directive sample
that now exists (DIR-001 through DIR-011, all archived under `directives/archive/`) instead of the
speculative "once ≥2 more DIR-* instances exist" placeholder DIR-001 itself shipped with.

**Evidence — real tally of all 11 directives** (arrival boundary / initiation mode / finding kind;
full per-directive detail in `milestones/M15-human-review-cadence/iterations/iteration-0.md`):

| DIR | arrival boundary | initiation mode | finding kind |
|---|---|---|---|
| 001 | pre-m3 SELECT | human, mid-conversation | structural blind-spot (VT value function) |
| 002 | pre-m5 SELECT | human, mid-conversation | drift/rollback-failure (exp4 carry-forward regression) |
| 003 | during m5 | self-raised (iteration-0, charter-sanctioned dogfood) | dogfood confirmation finding |
| 004 | pre-m6 SELECT | human, mid-conversation | scope/process gap (sizing + value-typing) |
| 005 | m6→m7 boundary | human, mid-conversation | structural blind-spot (V_meta absorption) |
| 006 | mid-m9 (live arrival) | human, mid-conversation | drift detected (Web UI verification regression) |
| 007 | mid-m9, same burst as 006 | human, mid-conversation | routing/process gap (adversarial-audit role dropped) |
| 008 | mid-m9, same burst as 006/007 | human, mid-conversation | drift detected (σ-floor consolidation debt) |
| 009 | m12→m13 boundary (burst) | human, routed design-doc-only | scope split (task-board self-hosting design) |
| 010 | m12→m13 boundary, same burst as 009 | human, routed design-doc-only | drift detected (projection mechanism gaps) |
| 011 | m12→m13 boundary, same burst as 009/010 | human, routed design-doc-only | scope split (CLI edit surface parity) |

**10 of 11 (all but DIR-003) are human-initiated**, confirming DIR-001's original claim held up
under the larger sample, not just the single founding instance. Arrivals cluster in **bursts at
milestone boundaries** (DIR-006/007/008 together mid-m9; DIR-009/010/011 together at the m12→m13
boundary) rather than one-per-milestone steadily — the cadence track below measures elapsed
milestones since the last arrival, not a per-milestone rate, precisely because of this bursty
pattern.

**The rule:**
1. **Track `milestones-since-last-human-directive`** as a `dashboard.md` health track (see
   "Human-review cadence" row, same table as `V_meta consolidation lag`), recomputed at each ABSORB
   from the same `directives/pending/`/`directives/archive/` drain evidence step 0 of the outer loop
   already produces — no separate instrumentation.
2. **Soft-alarm threshold K=5** — reusing the existing checkpoint cadence (`milestone_counter % 5
   == 0`) so both tracks share one mental model: if 5 or more milestones have elapsed since the last
   human-initiated directive, that is worth a human noticing (real capability review may be overdue),
   surfaced passively rather than demanded.
3. **Explicitly NON-BLOCKING.** Unlike the V_meta consolidation-lag gate (DIR-005/M07-vmeta-gate),
   which IS a HARD BLOCK on `milestone_counter++` when its own K=2 threshold is exceeded and
   unresolved, this track carries no blocking language anywhere and must never gate advancement.
   Directives are asynchronous and human-paced by nature (`OUTER-LOOP.md`'s own standing invariant:
   "the loop never blocks waiting for a human," §4.7) — a long gap since the last directive may
   simply mean nothing needed correcting, not that review is owed. The one concrete behavior this
   rule induces in the outer loop is visibility, not gating: at each checkpoint
   (`milestone_counter % 5 == 0`), the `checkpoints/cp-<NN>.md` snapshot must include this track's
   current value, so a human skimming checkpoints asynchronously sees "N milestones since last human
   input" without digging through `directives/archive/` by hand.
