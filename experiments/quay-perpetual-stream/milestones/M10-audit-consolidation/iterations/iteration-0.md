# M10-audit-consolidation — iteration-0

Worktree: `experiments/quay-perpetual-stream/milestones/M10-audit-consolidation/worktrees/iteration-0`
Branch: `exp5-m10-iteration-0`, base `d233f20` ("SELECT m10 = M-AUDIT-CONSOLIDATION: author charter
bundling DIR-006/007/008").

This is iteration-0 (the "build" pass) of a 2-iteration build+verify template — iteration-1 will
independently re-verify this work from a fresh worktree afterward. Anything left incomplete or
uncertain is flagged explicitly below rather than overclaimed.

## §1. Context read

Read, in order: `experiments/quay-perpetual-stream/charters/M10-audit-consolidation.md` (Tier-A,
full scope, 8 Done-when clauses); `inherited-core.md` (Tier-B, edited per Done-when 1/4/5/6/7);
`OUTER-LOOP.md` (edited per Done-when 5); the three pending directives DIR-006/007/008 in full;
`dashboard.md` (VT curve / m4 −6.60 correction, SELECT m10 log entry); the source methodology docs
consolidated as operational content — `.claude/skills/quay-core-bootstrap-methodology/reference/
sigma-inherited-floor-trap.md`, `.claude/skills/quay-webui-bootstrap-methodology/reference/
visual-review-mechanism.md`, `.claude/skills/quay-native-methodology/reference/
g3-audit-discipline.md`, `.claude/skills/quay-core-bootstrap-methodology/reference/
manda-reliability-envelope.md`; and, for the manda-dispatch scope, the four archived directives
`experiments/quay-native-bootstrap/directives/archive/DIR-020-*.md`, `DIR-015-*.md`, `DIR-016-*.md`,
`DIR-024-*.md`. For Done-when 3's systematic audit, additionally read every directive title/content
across exp1 (23 files), exp2 (3), exp3 (4), and exp4 (5) archives.

## §2. HARD GATES — raw output (pasted verbatim, not summarized)

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-continuous-bootstrap/directives/pending/
(empty — no output)
```
`experiments/quay-continuous-bootstrap/directives/pending/` exists but is empty (confirmed via
`ls -la`: only `.`/`..` entries). **Disposition: none required — zero pending directives in exp4's
queue to action.** (This is a distinct queue from exp5's own `experiments/quay-perpetual-stream/
directives/pending/`, which held exactly DIR-006/007/008 at dispatch time — the three directives
this milestone's charter exists to dispose of; see Gate 4 / §6 Done-when 8 for their disposition.)

### Gate 2 — manda hub reachability

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```
PASS.

### Gate 3 — localhost:4173 reachability (G7, liveness only — not a Web UI verification substitute per DIR-006)

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```
PASS. Per this milestone's own DIR-006 disposition, this `curl` check is liveness-only — it is
explicitly NOT used anywhere in this report as evidence of Web UI rendering/interaction (this
milestone did not touch or re-verify Web UI product code at all — its Done-when 2 only adds a
provisional-uncertainty *annotation* to an existing number, it does not re-verify it).

### Gate 4 — worktree creation

```
$ git worktree list | grep M10
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M10-audit-consolidation/worktrees/iteration-0  d233f20 [exp5-m10-iteration-0]
```
PASS — worktree exists on branch `exp5-m10-iteration-0`, base `d233f20` (current master HEAD at
dispatch time).

## §3. it0 systematic-explore checks (charter §4.4, run before first work)

### (a) Ceiling/floor arithmetic re-verification

N/A — this milestone is methodology-infra (governance-integrity + risk/option value types, no VT
weight), the same class as M02/M05/M06/M07. No cov ceiling/floor arithmetic is in scope; confirmed
by re-reading the charter's own "it0 systematic-explore checks" section, which states this
explicitly.

### (b) Gate-hash/transclusion

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M10-audit-consolidation.md
PASS: experiments/quay-perpetual-stream/charters/M10-audit-consolidation.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```
PASS — hash matches pinned source, no drift. Per DIR-009 (orchestrator must not dilute worktree
isolation or suppress gate text), the full literal HARD GATES block text (not just the hash
reference) was supplied to this dispatched iteration directly, and is pasted in full in §2 above.

### (c) Dogfooding evidence-gate

Every Done-when clause below (§6) is backed by pasted diffs / literal file content, not prose
summary — this is itself dogfooding the very evidence discipline this milestone's Done-when 1 and
Done-when 4 are establishing for Web UI claims and adversarial-audit claims respectively.

### (d) Domain-misfit audit-channel

Per `inherited-core.md`'s CONSOLIDATED `domain-audit-channel ≡ CI-job` pattern: this milestone is
pure methodology-infra (no product code touched — confirmed in §6 Done-when 8), so the CI-job
pattern does not apply as a build-time audit channel the way it does for product-code milestones
(M03/M08/M09). The applicable domain-misfit audit channel for THIS class of milestone (methodology-
infra / governance) is **iteration-1's own independent fresh-worktree diff re-read** — this is the
5th same-domain reuse of that channel (after M02/M05/M06/M07), each of which φ-confirmed it without
requiring further novel provisioning. No new audit-channel work was performed in iteration-0 itself;
iteration-1 is the audit channel for this milestone, by design (see charter's own it0 checks note).

## §4. Work completed

Four files edited (all `.md`, pure methodology-infra content — no product code touched, see §6
Done-when 8), plus three directives disposed and archived:

1. **`inherited-core.md`** — six edits: (a) updated "Known weakness" paragraph with a new
   "Status (M10-audit-consolidation, m10)" note; (b) new "Web UI verification requirement" section
   (Done-when 1, DIR-006); (c) new "Adversarial-audit role" section (Done-when 4/5/6, DIR-007);
   (d) new "Adversarial-audit cadence rule" section (Done-when 6, DIR-007 item 3); (e) new
   "σ-inherited-floor trap" section (Done-when 6, DIR-008); (f) new "manda-dispatch discipline"
   section (Done-when 7, DIR-008 item 5). Net +283 lines.
2. **`OUTER-LOOP.md`** — two edits: a bullet under step 3 (AUTHOR CHARTER) requiring future
   Web-UI-touching charters to state the new evidence rule explicitly (Done-when 1 cross-reference);
   a new HARD BLOCK sub-bullet under step 6 (ABSORB), inserted before the existing "V_meta
   consolidation-lag gate" bullet, implementing the adversarial-audit gate (Done-when 5). Net +23
   lines.
3. **`dashboard.md`** — one edit: the Chart-1 re-score table's Web UI row `new cov` cell annotated
   `⚠️PROVISIONALLY UNCERTAIN`, with an appended rationale paragraph (Done-when 2, first half). Net
   +1/-1 lines.
4. **`backlog.md`** — one edit: new "M10-audit-consolidation-sourced candidate" section with the
   `M-WEBUI-REVERIFY` candidate row (Done-when 2, second half). Net +6 lines.
5. **`directives/pending/DIR-006/007/008-*.md`** — `## Resolution` sections filled in for each,
   citing the specific Done-when clause(s) and diffs that dispose them; status headers updated from
   `pending` to `resolved (M10-audit-consolidation, iteration-0)`; all three `git mv`'d from
   `directives/pending/` to `directives/archive/`, matching the exp5 convention already established
   by DIR-001 through DIR-005 (Done-when 8).

## §5. Full diffs — Done-when 1, 4, 5, 6, 7 (inherited-core.md, OUTER-LOOP.md)

### inherited-core.md — diffstat

```
$ git diff --stat HEAD -- experiments/quay-perpetual-stream/inherited-core.md
 experiments/quay-perpetual-stream/inherited-core.md | 283 +++++++++++++++++++++
 1 file changed, 283 insertions(+)
```

### inherited-core.md — full diff

```diff
diff --git a/experiments/quay-perpetual-stream/inherited-core.md b/experiments/quay-perpetual-stream/inherited-core.md
index a9795b1..f3f3770 100644
--- a/experiments/quay-perpetual-stream/inherited-core.md
+++ b/experiments/quay-perpetual-stream/inherited-core.md
@@ -18,6 +18,18 @@ order; there is no single consolidated core, and citations can drift. First cons
 to merge the confirmed φ edges (§0c visual-review; dispatch/G3 discipline; σ-floor handling) into a
 single authoritative core section here.
 
+**Status (M10-audit-consolidation, m10):** this "First consolidation target" trio is now DONE —
+all three φ edges have operational sections below, not bare citations: "Web UI verification
+requirement" (§0c visual-review, mechanized as a Done-when evidence rule rather than the
+narrative-language failure DIR-006 found), "Adversarial-audit role" + "manda-dispatch discipline"
+(dispatch/G3 discipline, split into its two distinct halves — G3's cross-role refutation charge,
+which had been silently narrowed to same-template re-verification per DIR-007, and the
+manda-mechanics precondition rules per DIR-008), and "σ-inherited-floor trap" (σ-floor handling,
+including the m4 case study where the un-consolidated version of this trap already cost a real
+−6.60 VT correction). The delta chain above is NOT retired — it remains the fuller historical
+source for anything these consolidated sections don't cover — but citations for these three
+specific topics should point to the sections below, not back up this list.
+
 ## exp4 methodology (NOT yet extracted to a skill — inherited as artifacts)
 - `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` — hardened HARD GATES block (the
   **verbatim source for charter gate transclusion**), §0c continuous simulated-user, non-blocking
@@ -259,3 +271,274 @@ are usable to reproduce a real, already-independently-reached judgment, not just
 categories — the same self-consistency pattern used above for the size gauge (against m1/m2/m4)
 and in the domain-misfit section (against M01-dist). No dashboard.md VT number is altered by this
 table; it only ADDS a value-type label alongside the existing settled numbers.
+
+## Web UI verification requirement — mechanized browser-tool evidence rule (M10-audit-consolidation
+## Done-when 1, DIR-006)
+
+DIR-006 found a live claim-vs-evidence mismatch: `charters/M04-discover.md` required "exercise
+list/detail/filter/search/action flows in a real browser (dual-viewport... holistic visual
+review)," and `milestones/M04-discover/iterations/iteration-0.md` narrated a "Live browser
+session... at both desktop (1280x900) and mobile (390x844, emulated touch) viewports" — but the
+only literal pasted evidence anywhere in that report was two `curl` commands comparing
+`?search=` vs `?q=` query params. Zero `mcp__playwright__*`/`mcp__chrome-devtools__*` tool-call
+strings appear anywhere in exp5's 9 milestones (M01–M09), grepped directly. No mechanized gate
+caught this — exp5's only Web UI HARD GATE (`G7`) is an HTTP-status `curl` check, unrelated to
+rendering/interaction verification, and iteration-1's independent-re-verification discipline (which
+exists precisely to catch claim-vs-evidence mismatches) did not catch this one either, because it
+also only re-read prose rather than re-deriving from a tool-call trace.
+
+**The rule, stated operationally (not a citation):** any milestone Done-when clause that claims
+Web UI rendering/interaction/visual verification (list/detail/filter/search/action-flow exercise,
+visual coherence, responsive/dual-viewport behavior) MUST be backed, in the iteration report, by a
+literal pasted `mcp__playwright__*` or `mcp__chrome-devtools__*` tool-call trace consisting of, at
+minimum:
+1. A **navigation** call (`mcp__playwright__browser_navigate` / `mcp__chrome-devtools__navigate_page`)
+   to the actual page under test.
+2. At least one **screenshot or DOM/accessibility snapshot** artifact per claimed viewport
+   (`mcp__playwright__browser_take_screenshot` / `mcp__chrome-devtools__take_screenshot`, or
+   `browser_snapshot`/`take_snapshot`) — not merely a claim that one was taken.
+3. This trace must be present **at both configured viewports** (desktop + mobile, per the
+   dual-viewport requirement below) when the Done-when clause claims dual-viewport coverage.
+
+**`curl` is explicitly demoted, not banned.** `curl -s <url> -o /dev/null -w "%{http_code}"`
+(G7-style checks) remains valid evidence for **liveness/reachability HARD GATES only** — "is the
+server up." It is never valid evidence for, and must never be substituted for, rendering or
+interaction verification. A charter/report that uses `curl` output as its ONLY evidence for a
+Web-UI-rendering Done-when clause fails this rule, regardless of how the surrounding prose
+narrates the check (DIR-006's exact failure shape).
+
+**Dual-viewport requirement (consolidated from `quay-webui-bootstrap-methodology`'s §0c, reference
+`visual-review-mechanism.md`):** desktop 1280×800/900 and mobile 390×844 (device pixel ratio ×3,
+emulated touch) are the two configured viewports; a page/flow is not credited with Web UI
+verification until both are covered. Where a milestone's own charter scopes a narrower check (e.g.
+a single flow, not a full page), the SAME evidence bar applies to whatever is claimed — a
+navigation + screenshot/snapshot trace, not narrative language.
+
+**Charter-authoring checklist note (OUTER-LOOP.md step 3):** any future charter that scopes Web UI
+work must state this evidence rule explicitly in its own Done-when clause text (not merely rely on
+this inherited-core.md section being read) — see `OUTER-LOOP.md` step 3's charter-authoring bullet
+list, amended by this milestone to cross-reference this section.
+
+**What this does NOT require:** this rule does not require every milestone to touch a browser —
+only milestones whose own Done-when clauses actually claim Web UI rendering/interaction
+verification. A milestone that touches CLI/MCP/Packaging/Docs surfaces is unaffected.
+
+## Adversarial-audit role — a NEW out-of-band step, distinct from iteration-1 (M10-audit-consolidation
+## Done-when 4/5/6, DIR-007)
+
+DIR-007 found that exp1's G3 out-of-band audit discipline (`.claude/skills/quay-native-methodology/
+reference/g3-audit-discipline.md`) — a fresh-context subagent, dispatched by the orchestrator, NEVER
+by the session that did the work, explicitly CHARGED TO REFUTE the iteration's claims (not merely
+redo them) — was carried into exp5 only as a citation ("G3 out-of-band audit discipline",
+`inherited-core.md` §Extracted skills item 1; "domain-misfit audit-channel", `OUTER-LOOP.md`
+§4.4d). What exp5 actually built and mechanized instead — the domain-misfit audit-channel (does
+this DOMAIN have any independent verification mechanism, e.g. a CI job?) and iteration-1's
+same-template independent re-run (dispatched as a fresh `baime:iteration-executor`, instructed to
+independently re-derive claims from a fresh worktree) — is real, effective, and has caught genuine
+bugs in 5 of 9 milestones (M02 gate-hash false-FAIL, M04 VT arithmetic slip, M05 CLI-flag typo, M06
+self-exemption override, M07 ledger double-count). But it answers a different question than G3:
+"is this reproducible/stable," not "is this claim actually true and not inflated." G3's exp1 track
+record (3 separate V_meta overclaim attempts caught and reverted, iterations 29/59/61) was
+specifically about the SECOND question — same-template re-runs check it only incidentally.
+
+**The new role — named concretely: `iteration-N-adversarial-audit.md`.** A distinct out-of-band
+step the OUTER LOOP itself dispatches (not folded into any inner milestone's own iteration-1),
+charged EXPLICITLY to try to REFUTE a milestone's Done-when claims and VT delta, not to
+independently re-derive them from scratch in the same shape:
+
+1. **Who dispatches it.** The outer loop (the session executing `OUTER-LOOP.md`), at ABSORB
+   (step 6), for milestones meeting the cadence rule below — never the inner milestone's own
+   iteration-0 or iteration-1, and never folded into either.
+2. **How it's dispatched.** A fresh-context `baime:iteration-executor` call (or equivalent
+   fresh-context subagent dispatch), `run_in_background=true`, reading ONLY: (a) the milestone's
+   charter (Tier-A), (b) the milestone's own iteration-0/iteration-1 reports (the claims under
+   audit), and (c) `inherited-core.md` (Tier-B) — explicitly NOT given "go re-verify this," but
+   given a distinctly-worded refutation-focused prompt: *"Your job is to find fault with this
+   milestone's Done-when claims and VT Δv. Do not simply re-run the same checks and confirm — look
+   for: (a) claims with no pasted evidence nearby (narrative-only), (b) evidence that doesn't
+   actually support the specific claim made (e.g. a curl check standing in for a browser claim —
+   see the Web UI verification rule above), (c) arithmetic that doesn't recompute cleanly, (d) VT
+   deltas that don't match the charter's own pre-dispatch Δv̂ without a stated reason, (e) scope
+   creep or scope-exemption the milestone granted itself without outer-loop sign-off. Render a
+   verdict: REFUTED (name the specific claim and why), CONCERNS (weaker findings, non-blocking), or
+   NO REFUTATION FOUND (state what was specifically tried, not just 'looks fine')."*
+3. **Output location.** `milestones/M<NN>/audits/iteration-N-adversarial-audit.md` — a new
+   `audits/` subdirectory under each milestone's own tree, parallel to `iterations/`, distinct from
+   both. (`N` = the milestone's own iteration count at ABSORB time, e.g. the audit of a
+   2-iteration milestone is `iteration-1-adversarial-audit.md`.)
+4. **What a REFUTED verdict does.** Same discipline as G3's own historical record: a REFUTED
+   finding is not merely noted — it BLOCKS the ABSORB step's VT-curve append / Done-when
+   completion claim until the underlying milestone record is actually corrected (mirrors the
+   existing `V_meta consolidation-lag gate`'s HARD BLOCK pattern in `OUTER-LOOP.md` step 6,
+   applied here to a different failure class).
+
+**Explicitly distinct from iteration-1 (so it is not redundant with an existing mechanism):**
+
+| | iteration-1 (existing) | adversarial-audit (NEW) |
+|---|---|---|
+| Dispatched by | the inner milestone's own charter/dispatcher | the OUTER loop, at ABSORB |
+| Scope | re-derive/re-run the SAME kind of work fresh | actively try to REFUTE the claims already made |
+| Question asked | "is this reproducible?" | "is this claim actually true and not inflated?" |
+| Given the charter? | yes, full charter + fresh worktree | yes, PLUS the claims under audit — explicitly asked to distrust them |
+| When required | every milestone (2-iteration build+verify template) | only per the cadence rule below (Done-when 5) |
+
+## Adversarial-audit cadence rule (M10-audit-consolidation Done-when 6, DIR-007 item 3)
+
+**Required (mechanized gate, see `OUTER-LOOP.md` step 6):**
+(a) every VT-scoring (capability-growth-typed) milestone — i.e. any milestone whose SELECT-time
+value-typed ledger entry includes `capability-growth` and whose ABSORB appends a nonzero VT Δv to
+the curve;
+(b) any milestone whose own iteration-0 recommends skipping iteration-1 (the M06-sizing
+self-exemption precedent — iteration-0 argued "pure-doc-edit, nothing to re-derive"; the outer loop
+overrode this by base-rate judgment, not a mechanized gate, and iteration-1 then caught a real
+defect anyway, confirming the override was correct).
+
+**Explicitly NOT required (non-blanket, recorded as a checkable rule, not left to per-milestone
+improvisation):** methodology-infra/governance milestones with no VT weight (the M02/M05/M06/M07/
+M10 class) are EXEMPT BY DEFAULT — unless clause (b) above fires for them specifically (a
+methodology-infra milestone that also tries to self-exempt from iteration-1 IS in scope for the
+adversarial audit, by (b), independent of (a)'s VT-typing test). This keeps the rule proportionate
+to DIR-004's method-ROI framing (DIR-007 item 3's own explicit instruction) rather than requiring a
+full adversarial pass on every thin governance milestone — the base rate of claim-inflation risk is
+concentrated in VT-scoring/self-exemption cases, not in every markdown edit.
+
+## σ-inherited-floor trap — consolidated as operational content (M10-audit-consolidation Done-when 6,
+## DIR-008)
+
+Completing the kickoff commit's third named consolidation target ("σ-floor handling," alongside
+§0c visual-review above and dispatch/G3 discipline above).
+
+**The general trap** (source: `.claude/skills/quay-core-bootstrap-methodology/reference/
+sigma-inherited-floor-trap.md`): when a new experiment/chart inherits a scoring floor/baseline from
+a prior experiment/chart WITHOUT an explicit, design-time "reset to 0" vs. "design for enough
+throughput to clear the floor" decision, the inherited baseline silently dominates the score until
+the baseline itself is found to be wrong — usually discovered only after the fact, by accident,
+rather than anticipated. Originally characterized for `σ_QC` vs. an inherited `σ_strict` floor
+(experiment 2 inheriting experiment 1's 0.8493 floor, arithmetic showing ≈57 more native-gate tasks
+needed just to begin exceeding it) — but the SHAPE of the trap (uncritical numeric inheritance,
+undecided at design time) generalizes beyond that one factor.
+
+**The decision procedure (apply at design time — chart origin, or any chart transition):**
+1. **Name the inherited number(s) explicitly** — every baseline/floor a new chart or experiment
+   carries forward from a prior one, not just the ones that look load-bearing.
+2. **For each one, make ONE of two choices, explicitly and in writing** (never let it default
+   silently):
+   - **RESET to 0** — the new scope's own ledger stands alone, measuring only its own
+     going-forward discipline, no cross-chart/cross-experiment carry-forward credit.
+   - **CARRY FORWARD, with a stated confidence basis** — explicitly state WHY the inherited number
+     is trusted (what evidence backs it), and accept that if that evidence is later found wrong,
+     the correction is real value (instrument-correction type, per the value-typed ledger above),
+     not a regression.
+3. **Do the arithmetic before committing** if choosing to design around a floor (e.g., "how many
+   more units of X would be needed to clear this floor within the planned budget" — per
+   `v-meta-ceiling-diagnostic.md`'s method) — do not discover the arithmetic is infeasible only
+   after committing.
+
+**The m4 case study (VT₀'s own instance of this trap, already fired for real):** exp5's `VT₀ =
+82.25` was set at bootstrap directly from exp4's `gap-list.md` "Closed" claims (`OUTER-LOOP.md`
+step 2's origin scoring), with NO explicit reset-vs-carry-forward decision ever recorded at
+design time — the carry-forward choice was made implicitly, by construction, not stated. This is
+structurally the CARRY FORWARD case above, but without step 2's "stated confidence basis." The trap
+fired at m4/M04-discover: the live persona pass found exp4's "Closed" claims were systematically
+overstated (MD-001 merge-drift — 12 gap-list entries reopened, CLI/Web UI/Docs surfaces all
+affected), producing exp5's first genuine VT DECREASE (101.33→94.73/120, **Δv=−6.60**,
+`dashboard.md`'s m4 VT curve log) — discovered only after the fact by the exploit-channel discovery
+engine, not anticipated by a design-time check.
+
+**Retroactive disposition of VT₀ (this section IS that decision, recorded now rather than left
+implicit):** VT₀'s carry-forward is retroactively classified as CARRY FORWARD (not reset — a
+reset was never practical after 9 milestones have already built on the chart-1 numbers), with its
+confidence basis now stated explicitly for the first time: exp4's gap-list "Closed" claims were
+trusted based on exp4's own iteration reports asserting closure, WITHOUT independent re-verification
+against `master` — exactly the gap M04-discover's persona pass then found. Going forward, this
+experiment's own posture is: **any number carried forward from a DIFFERENT experiment or a prior
+chart is presumptively CARRY-FORWARD-WITH-LOW-CONFIDENCE until independently re-verified by this
+experiment's own live evidence** — which is in fact what M04/M08/M09's re-scoring passes have
+already been doing in practice (each VT re-score section in `dashboard.md` cites this experiment's
+own live evidence, not a re-cited exp4 claim). This section makes that practice an explicit,
+named rule rather than an emergent pattern.
+
+**Audit for other uncritically-inherited baselines (DIR-008 item 3, disposition required for each):**
+- **Chart-0→chart-1 transition (m3):** `dashboard.md`'s m3 log carried the 5 original chart-0
+  surfaces (CLI/MCP/Web UI/Packaging/Docs) 1:1 into chart-1 "out of scope" (unchanged weights/cov),
+  adding Provider-ABI as a genuinely new 6th surface scored fresh. **Disposition: CARRY FORWARD,
+  low-risk** — the 5 unchanged surfaces were not re-derived at the chart transition itself, but
+  each has SINCE been independently re-scored with live evidence at least once (Web UI/CLI/Docs at
+  m4, CLI/Docs/Packaging at m8, none skipped) — the transition itself didn't introduce a new
+  unverified number, it just deferred re-verification to the ordinary SELECT/exploit cycle, which
+  has since occurred. No further action needed.
+- **Provider-ABI's chart-1 origin cov (m3, 0.654):** this is NOT an inherited number — M03-abi-eval
+  built the capability matrix and differential conformance suite FROM SCRATCH this experiment, no
+  prior-experiment baseline was carried in. Not in scope for this trap.
+- **`v-meta-ledger.md` / V_meta consolidation-lag health track starting value:** reviewed — this
+  track was CREATED by M07-vmeta-gate (m7) with a genuinely fresh starting state (0 rows
+  past-threshold at creation), not inherited from exp4. Not in scope for this trap.
+- **Milestone-counter / chart-counter origin (`milestone_counter: 0`, `chart: 0` at bootstrap):**
+  these are explicit resets to 0 by `OUTER-LOOP.md`'s own First-run bootstrap step 3 — already the
+  correct choice per this section's own decision procedure (RESET, not carry-forward), predating
+  this milestone. No further action needed.
+- **No other still-live inherited numeric baseline was found** by this audit (grep/read of
+  `dashboard.md`'s Log section + `OUTER-LOOP.md`'s bootstrap steps against exp4's own closing
+  artifacts) beyond VT₀ itself and the chart-0→chart-1 transition, both dispositioned above.
+
+## manda-dispatch discipline — correct narrow scope (M10-audit-consolidation Done-when 7, DIR-008
+## item 5)
+
+DIR-008 found a companion, lower-severity drift: `docs/proposals/exp5-concurrent-background-
+agents-for-milestone-iteration.md` re-derived a manda-dispatch conclusion from scratch, live, with
+zero reference to the existing envelope document (`.claude/skills/quay-core-bootstrap-methodology/
+reference/manda-reliability-envelope.md`) or DIR-020's precise scope — and DIR-008's OWN first
+draft overstated the rule as a blanket ban, corrected only after live human review. This section
+exists so future milestones don't have to re-derive (or over-generalize) the rule a third time.
+
+**The rule, at its correct narrow scope (source: DIR-020, archived
+`experiments/quay-native-bootstrap/directives/archive/DIR-020-*.md`; extended by DIR-015/016/024,
+same archive):**
+
+1. **DIR-020's self-deadlock condition (the core structural rule):** the depth-1
+   `mcp__plugin_manda_manda__Agent`/`Dispatch`/`request` caller must NEVER be issued synchronously
+   from the same session that owns the bound broker monitor for the target channel. If caller and
+   broker are the same session, the caller half must be dispatched as a separate background
+   subagent (`run_in_background=true`) so the session's own top-level turn remains free to service
+   the resulting cap-request. This is structural, not probabilistic — a synchronous call blocks
+   that session's own turn processing, so it cannot receive/act on its own incoming cap-request
+   notification until the blocking call itself gives up at the deadline, by construction, regardless
+   of daemon behavior.
+
+2. **DIR-015/016/024's background-dispatch requirement (extends the same reasoning to every
+   dispatch on the path, not just the depth-1 caller):**
+   - DIR-015: the subagent that executes a given iteration's work must be dispatched
+     non-blockingly (`run_in_background=true`) — a foreground-blocked iteration dispatch prevents
+     the dispatching session from servicing ANY concurrent cap-request for the dispatch's entire
+     duration, an independently sufficient explanation for otherwise-mysterious manda timeouts.
+   - DIR-016: the SAME non-blocking requirement extends to the out-of-band audit-subagent dispatch
+     specifically (not just the iteration dispatch) — a gap DIR-015 left open one call later in the
+     same cycle.
+   - DIR-024: the BROKER side of the exchange (the session servicing an incoming `agent.spawn`
+     cap-request) must also spawn its leaf agent with `run_in_background=true`, per the broker
+     protocol's own already-written spec — a foreground broker-side spawn blocks the broker from
+     noticing/servicing a SECOND concurrent cap-request while the first is still running, silently
+     serializing what should be concurrent.
+   - **Net effect: every point on a manda nested-dispatch path — depth-1 caller, iteration
+     dispatch, audit dispatch, broker-side spawn — must be background, for the same underlying
+     reason** (a synchronously-blocked session cannot service its own concurrent notifications).
+
+3. **This is NOT a blanket ban on manda dispatch, and is scoped to result-dependent/nested paths
+   specifically.** `packages/quay/src/action.js`'s Action Button delivery (`manda-dispatch submit
+   ... --async`, never waits on or checks a result) is structurally OUTSIDE this rule's scope
+   entirely — fire-and-forget dispatch has no synchronous caller-side wait to deadlock, and remains
+   a legitimate, currently-working use of manda, unaffected by DIR-020/015/016/024. The rule applies
+   specifically to: (a) the depth-1 caller when it IS the target channel's own broker, and (b) any
+   dispatch where the dispatching session subsequently needs to remain responsive to a concurrent
+   cap-request (result-dependent/nested paths) — not to dispatch calls that neither wait for nor
+   depend on a returned result.
+
+**Standing practice decision (DIR-008 item 4, minor/non-blocking per DIR-008's own framing):**
+**adopted** — before drafting a new cross-cutting proposal or charter section touching manda/
+G3/dispatch mechanics, do a quick grep of `inherited-core.md`'s own delta chain (this file first)
+plus a targeted grep of `experiments/quay-native-bootstrap/directives/archive/DIR-0{15,16,20,24}*`
+and `.claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md` before
+re-deriving the rule live. This is now the correct single place to check — this section IS the
+consolidated answer; no future milestone should need to re-open the archived DIR-0NN files directly
+unless this section itself is found insufficient (in which case, expand THIS section, don't leave
+the gap for the next drafter to re-discover).
```

### OUTER-LOOP.md — full diff

```diff
diff --git a/experiments/quay-perpetual-stream/OUTER-LOOP.md b/experiments/quay-perpetual-stream/OUTER-LOOP.md
index 0cefb00..05d1cbd 100644
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -73,6 +73,11 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
      dispatched agent must never see only a hash reference with no literal text (this would
      reintroduce the exact gate-dilution risk DIR-009 defends against). The charter may shrink; the
      agent-facing prompt may not lose the literal text.
+   - **Web UI verification requirement (M10-audit-consolidation, DIR-006):** if this milestone's
+     scope includes ANY Done-when clause claiming Web UI rendering/interaction/visual verification,
+     the charter must state `inherited-core.md`'s "Web UI verification requirement" evidence rule
+     explicitly in that clause's own text — a `curl` status check is never sufficient evidence for
+     it (liveness/HARD-GATES only). See that section for the full mechanized rule.
    - the **in-scope gap subset only** (+ every OPEN blocking gap verbatim);
    - **binary Done-when clauses** (mandatory — §3.4; without them milestones drag, cf. exp1/exp4);
    - the **inner termination five conditions** (§3.2);
@@ -117,6 +122,24 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
    adaptations to the log; check φ — if a prior adaptation was just reused unchanged by THIS
    (different-domain) milestone, **CONSOLIDATE**: merge it into `inherited-core.md` and retire the
    citation (§4.2).
+   - **Adversarial-audit gate (DIR-007 / M10-audit-consolidation, HARD BLOCK on this milestone's VT-
+     curve append / Done-when-complete claim — distinct from, and in addition to, the inner
+     milestone's own iteration-1):** BEFORE this milestone's realized `Δv` is appended to the VT
+     curve or its Done-when clauses are recorded as complete, check whether this milestone meets
+     EITHER cadence-rule condition in `inherited-core.md`'s "Adversarial-audit cadence rule": (a) it
+     is VT-scoring (its SELECT-time value-typed ledger entry includes `capability-growth` and its
+     ABSORB would append a nonzero VT Δv), OR (b) its own iteration-0 recommended skipping
+     iteration-1 (a self-exemption attempt). **If either fires**, dispatch the adversarial-audit role
+     (`inherited-core.md`'s "Adversarial-audit role" section — a fresh-context `baime:iteration-
+     executor` call, `run_in_background=true`, dispatched by the OUTER loop itself, NEVER folded
+     into the inner milestone's own iteration-1) BEFORE this ABSORB step may complete. Output to
+     `milestones/M<NN>/audits/iteration-N-adversarial-audit.md`. A **REFUTED** verdict blocks the VT
+     append / Done-when-complete claim until the underlying record is corrected (same HARD BLOCK
+     shape as the V_meta consolidation-lag gate below); a **CONCERNS** verdict is recorded but
+     non-blocking; **NO REFUTATION FOUND** clears the gate. **If NEITHER condition fires** (the
+     default case — methodology-infra/governance milestones with no VT weight, per the explicit
+     non-blanket cadence rule), this gate is a documented no-op: state plainly in the ABSORB log
+     entry that neither condition applied and why, rather than silently omitting the check.
    - **V_meta consolidation-lag gate (DIR-005 / M07-vmeta-gate, HARD BLOCK on step 7's
      `milestone_counter++`):** before this milestone may be marked DONE / `milestone_counter`
      incremented in step 7 below, check every row in `v-meta-ledger.md`. For each row whose status is
```

### dashboard.md — full diff

```diff
diff --git a/experiments/quay-perpetual-stream/dashboard.md b/experiments/quay-perpetual-stream/dashboard.md
index 6531f72..2a002fe 100644
--- a/experiments/quay-perpetual-stream/dashboard.md
+++ b/experiments/quay-perpetual-stream/dashboard.md
@@ -91,7 +91,7 @@ PKG-003/004/005/006/007/008, DOC-006/007) and the M04-discover iteration-0 repor
 |---|---|---|---|
 | CLI | 0.95 | **0.80** | MD-001's merge-drift is CLI-surface-heaviest: `--version`/`-V` (UQ-047), `--page-size` in all 3 modes (CB-006/CB-022), and `--format json` alias (CB-021) are ALL live-confirmed absent/broken on master despite gap-list.md having asserted them closed since exp4 iterations 13-17. Core subcommands (`task list/view/edit/check`, `action list/run`, `serve`, `mcp`) all work correctly on both the `.tgz`/node path AND the SEA executable path (byte-identical `--help`, live-verified) — the drop is bounded to the 4 specific reopened capabilities, not a broad regression. 0.95→0.80 reflects 4 real capability losses on a ~20-capability-wide surface, not a catastrophic surface failure. |
 | MCP | 0.90 | **0.90** | Live stdio-client persona pass (real `@modelcontextprotocol/sdk` `Client`+`StdioClientTransport`, not test mocking) exercised `tools/list`, `task_list`, `task_get`, `task_write`, `task_check`, `resources/list` end-to-end — all 6 clean, no new gaps found. MCP surface is unaffected by MD-001 (the drifted commits were CLI/Web UI/docs-only; `mcp-server.js` was not among the files touched by the unmerged commits). Unchanged. |
-| Web UI | 0.95 | **0.92** | list/detail/filter/sort/label-nav/action-gate flows all verified live at desktop (1280x900) and mobile (390x844 emulated touch) viewports — core functionality intact and correctly gated (Advance blocks/errors with no AC checkboxes). Two new minor/low findings: UQ-049 (`?search=` URL param silently no-ops; real param is `q` — a real discoverability trap for anyone constructing URLs by the visible field's `name` attribute) and UQ-050 (mobile title-text CSS overflow, cosmetic, DOM/functionality intact). Small deduction (0.03) for these two, not zero, since UQ-049 is a genuine no-error-signal usability gap. |
+| Web UI | 0.95 | **0.92** ⚠️PROVISIONALLY UNCERTAIN | list/detail/filter/sort/label-nav/action-gate flows all verified live at desktop (1280x900) and mobile (390x844 emulated touch) viewports — core functionality intact and correctly gated (Advance blocks/errors with no AC checkboxes). Two new minor/low findings: UQ-049 (`?search=` URL param silently no-ops; real param is `q` — a real discoverability trap for anyone constructing URLs by the visible field's `name` attribute) and UQ-050 (mobile title-text CSS overflow, cosmetic, DOM/functionality intact). Small deduction (0.03) for these two, not zero, since UQ-049 is a genuine no-error-signal usability gap. **⚠️ PROVISIONALLY UNCERTAIN annotation added at M10-audit-consolidation (m10, 2026-07-18, DIR-006):** this row's "verified live" language and the 0.95→0.92 cov delta are backed, in `milestones/M04-discover/iterations/iteration-0.md:254-290`, only by two pasted `curl` commands (lines 271/274, comparing `?search=` vs `?q=`) — zero `mcp__playwright__*`/`mcp__chrome-devtools__*` tool-call traces exist anywhere in that report or in any of exp5's 9 milestones. Per `inherited-core.md`'s new "Web UI verification requirement" section, a `curl` check is not valid evidence for rendering/interaction verification. This 0.92 number is NOT retracted (UQ-049/UQ-050 remain independently plausible, and the underlying claim may well be correct) but must not be treated as authoritative browser-verified evidence until a real re-verification is performed. Actual re-verification is explicitly deferred (out of this milestone's scope, per DIR-006 item 3) — tracked as `M-WEBUI-REVERIFY` in `backlog.md`. |
 | Packaging / Distribution | 0.85 | **0.85** | SEA executable path (M-DIST's headline deliverable) verified working end-to-end this milestone: `--help`, `task list`, `mcp`, `serve` all function correctly on the SEA binary, byte-identical `--help` output vs the `.tgz`/node path. `package.json` metadata gaps (PKG-003/004/005/006/007/008: missing `files`/`license` fields, missing `packages/quay/{README,CHANGELOG,LICENSE}.md`) are real but were already true before this milestone (MD-001 reveals they were NEVER actually fixed, not that they regressed) — the packaging cov score has always implicitly excluded these (gap-list.md's own "Closed" claims for them were the miscalibration, not a change in the underlying artifact). Held flat rather than dropped, since the SEA-path capability this surface is primarily scored on is confirmed solid; the metadata gaps are better reflected as a Docs-adjacent finding (folded into Docs' drop below) since they're about published-artifact *documentation/metadata completeness*, which is this surface's thinner, historically-never-actually-0.85-justifying edge — flagged for a more rigorous re-derivation at the M-MERGE-RECOVER milestone rather than guessed further here. |
 | Docs | 0.70 | **0.55** | Two real, previously-invisible findings: DOC-006 (root README.md has ZERO mention of the SEA/single-file-executable distribution path — the charter's own explicitly-named candidate gap, and a major shipped capability with no user-facing docs at all) and DOC-007 (CHANGELOG.md is stuck at "v0.2.0", no v0.3.x/SEA entry despite `package.json` reporting 0.3.4, AND the v0.2.0 entry itself makes 3 false shipped-feature claims per MD-001). Combined with the DOC-001..005/PKG-004..008 reopenings (packages/quay/{README,CHANGELOG,LICENSE}.md all confirmed absent, `package.json` missing `files`/`license`), Docs is the surface most concretely damaged by this milestone's findings — a genuine, evidenced drop, not a soft impression. |
 | **VT chart-1 total (after m4)** | **101.33/120** | **94.73/120** | CLI 25×0.80=20.00 (was 23.75, −3.75); MCP 20×0.90=18.00 (unchanged); Web UI 20×0.92=18.40 (was 19.00, −0.60); Packaging 20×0.85=17.00 (unchanged); Docs 15×0.55=8.25 (was 10.50, −2.25); Provider-ABI 20×0.654=13.08 (unchanged, out of scope). Total = 20.00+18.00+18.40+17.00+8.25+13.08 = **94.73/120** (≈0.789 normalized, down from 0.844 at m3). |
```

### backlog.md — full diff

```diff
diff --git a/experiments/quay-perpetual-stream/backlog.md b/experiments/quay-perpetual-stream/backlog.md
index 18891af..c432647 100644
--- a/experiments/quay-perpetual-stream/backlog.md
+++ b/experiments/quay-perpetual-stream/backlog.md
@@ -53,6 +53,12 @@ at SELECT time once VT origin is scored.
 | M-MERGE-RECOVER | Recover ~12 exp4 iterations' worth of `packages/quay` code that gap-list.md/CHANGELOG.md claim shipped but were never actually merged to `master` (MD-001): `--version`/`-V`, `--page-size` (CLI+Web UI+JSON mode), `--format json` alias, `packages/quay/{README,CHANGELOG,LICENSE}.md`, `package.json` `files`/`license` fields — either by re-merging the original `experiment-4-iteration-{13,14,16,17,18,19}` branch tips (conflict risk against intervening M-DIST/M-ABI-EVAL master history, needs real review) or by re-implementing fresh against current master (safer, smaller diff, re-verify each against its original test additions). Also fold in DOC-006 (document the SEA/release artifacts M-DIST already shipped — currently completely undocumented in README.md) and DOC-007 (CHANGELOG v0.3.x entry, correct the v0.2.0 entry's false claims) as part of the same milestone's docs-closeout scope, since both require touching the same files. | CLI, Docs, Packaging | gap-list MD-001 (significant) + DOC-006/DOC-007 (minor) | explore | med-high (CLI cov likely 0.95→lower once merge-drift is priced in, recovers back toward ~0.90+; Docs cov 0.70→higher once SEA is documented and CHANGELOG corrected; Δv̂≈+4 to +6 est., precise number needs re-baseline at SELECT time once this milestone's charter is authored) | **DONE** (m8, 2026-07-18, merged to master `b168153`). Re-implemented fresh against current master (re-merge confirmed unsafe at charter-authoring time). Iteration-0: all 9 in-scope items built, Done-when 1-6 evidenced, Done-when 7 honestly left as genuine remaining scope. Iteration-1: independently re-verified 1-6 (fresh worktree/install/test run, zero discrepancies), closed the one open caveat (Docker `gh`-provisioning, now fully clean), independently re-derived VT arithmetic (iteration-0's math held up this time — first M08-class milestone where iteration-1 found no arithmetic error), applied Done-when 7's real file edits. **Realized Δv = +9.00** (94.73→103.73/120), above the Δv̂≈+7.6 estimate. `gap-list.md` MD-001 umbrella marked RESOLVED at ABSORB (12 sub-entries + DOC-001..007 all independently closed with live evidence). 8th milestone's base rate holds (iteration-1 re-verification remains never-skippable, even when — as here — it finds the prior math already correct). |
 | UQ-049 | Web UI `?search=` URL param silently no-ops (real param is `q`); mobile-viewport title-text CSS overflow (UQ-050). | Web UI | gap-list UQ-049 (minor) / UQ-050 (low) | exploit | low (~+0.5-1, cov nudge only) | Small, well-bounded — likely bundle into `M-MERGE-RECOVER`'s Web UI touch-surface or a future exploit-channel pass rather than a standalone milestone (too small alone per "raw polish gaps are NOT standalone milestones"). |
 
+## M10-audit-consolidation-sourced candidate (2026-07-18, DIR-006 item 2)
+
+| id | title | surface(s) | source | e/x | value type(s) | notes |
+|---|---|---|---|---|---|---|
+| M-WEBUI-REVERIFY | Re-verify M04-discover's Web UI findings (cov 0.92, UQ-049/UQ-050) with REAL browser tooling (`mcp__playwright__*`/`mcp__chrome-devtools__*`), per `inherited-core.md`'s new Web UI verification-requirement section — navigation + screenshot/DOM-snapshot trace at both configured viewports (desktop 1280×800/900, mobile 390×844), not the `curl`-only evidence M04-discover's own report actually pasted. | Web UI | DIR-006 item 2 (M10-audit-consolidation Done-when 2 — re-verification itself explicitly deferred, not performed this milestone) | exploit | discovery (re-verifying a provisionally-uncertain claim with a genuinely independent audit channel) + risk/option (closes the exact evidence gap DIR-006 found, before a THIRD instance of the same failure class recurs) | **Not yet charter-ready.** Backlogged at M10-audit-consolidation's own SELECT/ABSORB boundary (m10). Scope: re-run M04-discover's own claimed list/detail/filter/search/action-flow checks using real playwright/chrome-devtools tool calls, at both viewports, and either CONFIRM the existing 0.92 cov number (remove the ⚠️ annotation) or CORRECT it with new live evidence (instrument-correction value type if the number moves, per the value-typed ledger). Small-to-medium size — should fit a single build+verify cycle; a good SELECT candidate whenever a Web-UI-touching exploit slot is next open. |
+
 ## Backlog exhaustion finding (m3 SELECT, 2026-07-18)
 Every carried-by-reference candidate above except M-DIST/M-GATES (both DONE) is now confirmed STALE
 — the exp4-vintage backlog has no remaining milestone-sized product-value or methodology-infra scope.
```

## §6. Binary Done-when checklist — evidence (all 8 charter clauses)

### 1. `[x]` Add operational Web UI verification-requirement section to `inherited-core.md`

MET. See §5 `inherited-core.md` diff, new section "Web UI verification requirement — mechanized
browser-tool evidence rule (M10-audit-consolidation Done-when 1, DIR-006)". States the mechanized
rule (navigation call + screenshot/snapshot per claimed viewport, both viewports when dual-viewport
claimed, via `mcp__playwright__*`/`mcp__chrome-devtools__*`), not a citation — demotes `curl` to
liveness-only, restates the dual-viewport spec (1280×800/900 desktop, 390×844 mobile). This is
operational (a rule dispatched agents must follow and evidence against), not a thin pointer.

### 2. `[x]` Provisionally-uncertain annotation on M04-discover's Web UI cov + new `M-WEBUI-REVERIFY` backlog row

MET. See §5 `dashboard.md` diff (Web UI row `new cov` cell → `0.92 ⚠️PROVISIONALLY UNCERTAIN` +
rationale paragraph citing the exact curl-only evidence gap) and `backlog.md` diff (new
"M10-audit-consolidation-sourced candidate" section, `M-WEBUI-REVERIFY` row). The number is flagged,
not silently left unaudited, and not retracted (per the charter's own instruction not to
over-correct without a real re-verification, which is explicitly out of this milestone's scope).

### 3. `[x]` Systematic exp1-4 audit for other silently-dropped-enforcement requirements

MET — audit performed, finding recorded here as the required artifact (also cross-referenced in
DIR-006's Resolution section, requested action 3).

**Method:** read every directive title and content across exp1 (`experiments/
quay-native-bootstrap/directives/archive/`, 23 files — DIR-001/002/003/004/005/011/012/013/014/
017/019/020/022/023/024, spanning manda-mechanics + G3-dispatch topics), exp2 (3 files: DIR-001
manda-monitor-recheck, DIR-002 provenance-size-control, DIR-003 g3-audit-native-agent-not-manda),
exp3 (4 files: DIR-001 keep-web-service-live, DIR-002 g3-and-visual-review-independent-subagent,
DIR-003 desktop-mobile-layout-required, DIR-005 g3-dispatch-drift), exp4 (5 files: DIR-004
node-sea-bun, DIR-006 directives-as-tasks-cutover, DIR-007 remove-orientation-banner, DIR-008
v-meta-redesign, DIR-009 orchestrator-honor-hardened-gates).

**Finding: no NEW silently-dropped-enforcement instance found beyond DIR-006/007/008's own three
named topics (Web UI browser verification, G3 adversarial-audit role, σ-inherited-floor).** Every
other historically-established requirement found in the exp1-4 archives resolves to one of two
buckets:

- **Already covered by DIR-006/007/008's own scope** — e.g. exp3's DIR-003
  (`desktop-mobile-layout-required`) is the direct historical origin of the dual-viewport spec that
  DIR-006/Done-when 1 restates operationally; exp1/exp2/exp3's G3-dispatch directives (exp1
  DIR-020/DIR-024, exp2 DIR-003, exp3 DIR-002/DIR-005) are the direct historical origin of DIR-007's
  finding.
- **Already enforced elsewhere in exp5, independent of this milestone** — e.g. exp1's manda
  self-deadlock directives (DIR-020) and orchestrator-gate-honoring directives (exp4 DIR-009) are
  already live in exp5 via the pinned HARD GATES block, the governance/infra hard floor
  (value-typed SELECT ledger), and the gate-hash/transclusion mechanism (`it0-gate-hash-check.sh`) —
  these are structural, mechanized carry-forwards, not citation-only drift.

No fourth silently-dropped-enforcement instance was identified. This is recorded here as the
required "nothing further found" statement, per the charter's explicit instruction that Done-when 3
be satisfied either by new directives or a clear "nothing found" statement — this iteration chose
the latter, having found no qualifying new instance.

### 4. `[x]` Concretely-named, worked adversarial-audit-role step in `inherited-core.md` + `OUTER-LOOP.md`

MET. See §5 diffs. `inherited-core.md`'s "Adversarial-audit role" section is fully worked: names the
dispatcher (outer loop only, at ABSORB), the mechanism (fresh-context `baime:iteration-executor`,
`run_in_background=true`, given charter + iteration-0/1 reports + `inherited-core.md`, with a full
quoted refutation-focused prompt template distinctly worded from iteration-1's build-reverify
template), the output location (`milestones/M<NN>/audits/iteration-N-adversarial-audit.md`), the
REFUTED-blocks-ABSORB behavior, and an explicit comparison table (iteration-1 vs. adversarial-audit)
across dispatcher/scope/question/inputs/frequency — directly satisfying DIR-007's finding 5
requirement that the two not be conflated.

### 5. `[x]` Mechanized gate in `OUTER-LOOP.md` for adversarial-audit role, with explicit non-blanket cadence rule

MET. See §5 `OUTER-LOOP.md` diff — new HARD BLOCK sub-bullet under step 6 (ABSORB), placed
immediately before the existing "V_meta consolidation-lag gate" bullet (same HARD BLOCK
pattern/precedent, per DIR-005/M07). Checks cadence-rule conditions (a) VT-scoring or (b)
self-exemption-attempting; dispatches if either fires; REFUTED blocks / CONCERNS non-blocking / NO
REFUTATION FOUND clears; requires an explicit "neither condition applied" no-op statement when the
gate doesn't fire, rather than silent omission — satisfying the "not a blanket requirement" cadence
instruction from `inherited-core.md`'s companion "Adversarial-audit cadence rule" section.

### 6. `[x]` VT₀ reset-vs-carry-forward decision + σ-inherited-floor-trap consolidation + audit for other uncritically-inherited baselines

MET. See §5 `inherited-core.md` diff, new section "σ-inherited-floor trap — consolidated as
operational content". Contains: the general trap statement (sourced from
`sigma-inherited-floor-trap.md`); the 3-step decision procedure; the explicit VT₀ decision
(**CARRY-FORWARD-WITH-LOW-CONFIDENCE**, not RESET-to-0, with stated rationale — chart already built
on it, trap already fired once transparently at m4); the m4 case study (VT₀=82.25 from exp4's
gap-list "Closed" claims, no design-time decision recorded, trap fired at m4 with
101.33→94.73/120, Δv=−6.60, MD-001); and the audit of other baselines (chart-0→chart-1 transition:
disposed low-risk carry-forward, independently re-verified at m4/m8; Provider-ABI cov: not
inherited, N/A; v-meta-ledger health track: fresh at m7, N/A; `milestone_counter`/chart: correctly
RESET to 0 at bootstrap, N/A) — concluding no other uncritically-inherited baseline exists beyond
VT₀ and the already-disposed chart transition.

### 7. `[x]` Consolidate manda-dispatch discipline into `inherited-core.md` at correct narrow scope

MET. See §5 `inherited-core.md` diff, new section "manda-dispatch discipline — correct narrow
scope". States DIR-020's self-deadlock rule (depth-1 caller must never synchronously wait on its own
bound-broker channel), DIR-015/016/024's background-dispatch extensions (iteration dispatch, audit
dispatch, broker-side spawn), and explicitly notes fire-and-forget dispatch (Action Button's
`manda-dispatch submit --async`) is unaffected and structurally has no synchronous wait to
deadlock — correcting DIR-008's own initial overstatement of the rule as a blanket ban. Also adopts
the standing practice (grep `inherited-core.md` + the 4 archived DIR files + the reliability-envelope
doc before drafting new cross-cutting manda/G3/dispatch content) to reduce future re-derivation.

### 8. `[x]` No product code touched; DIR resolutions filled in; directives archived

**No product code touched — confirmed:**
```
$ git diff --name-status HEAD
M	experiments/quay-perpetual-stream/OUTER-LOOP.md
M	experiments/quay-perpetual-stream/backlog.md
M	experiments/quay-perpetual-stream/dashboard.md
R069	experiments/quay-perpetual-stream/directives/pending/DIR-006-webui-browser-verification-regression.md	experiments/quay-perpetual-stream/directives/archive/DIR-006-webui-browser-verification-regression.md
R069	experiments/quay-perpetual-stream/directives/pending/DIR-007-g3-adversarial-audit-role-dropped.md	experiments/quay-perpetual-stream/directives/archive/DIR-007-g3-adversarial-audit-role-dropped.md
R065	experiments/quay-perpetual-stream/directives/pending/DIR-008-sigma-inherited-floor-consolidation-and-citation-drift.md	experiments/quay-perpetual-stream/directives/archive/DIR-008-sigma-inherited-floor-consolidation-and-citation-drift.md
M	experiments/quay-perpetual-stream/inherited-core.md
```
All 7 changed/moved paths are `.md` files under `experiments/quay-perpetual-stream/` — zero files
under `packages/*` (product code) were touched. **Since no product/script code was edited, no test
suite run is required or applicable** (this milestone's charter's own Done-when 8 conditions the
full-test-suite-run requirement on "if touched" — it was not).

**DIR resolutions filled in:** DIR-006, DIR-007, DIR-008 each have a `## Resolution` section citing
the specific Done-when clause(s)/diffs above that dispose them (see each file's full Resolution
text, already quoted in §4 item 5 and visible in the archived files themselves at
`experiments/quay-perpetual-stream/directives/archive/DIR-00{6,7,8}-*.md`).

**Archive move confirmed:**
```
$ ls experiments/quay-perpetual-stream/directives/pending/ experiments/quay-perpetual-stream/directives/archive/
experiments/quay-perpetual-stream/directives/archive/:
DIR-001-evaluation-blind-spot-provider-abi-and-outcome-based-methods.md
DIR-002-directives-as-quay-tasks-restore-restrained-projection-design.md
DIR-003-m05-dir-projection-dogfoods-directive-task-projection.md
DIR-004-milestone-sizing-cost-band-and-value-typed-selection.md
DIR-005-v-meta-consolidation-lag-tracked-and-gated-at-absorb.md
DIR-006-webui-browser-verification-regression.md
DIR-007-g3-adversarial-audit-role-dropped.md
DIR-008-sigma-inherited-floor-consolidation-and-citation-drift.md

experiments/quay-perpetual-stream/directives/pending/:
(empty except .gitkeep)
```
Matches the exp5 established convention (DIR-001 through DIR-005 already in `archive/`).
`directives/pending/` is now empty (only `.gitkeep`), confirming this milestone fully drained the
queue it was chartered to dispose of.

## §7. Files changed (summary)

```
$ git diff --stat HEAD
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  23 ++
 experiments/quay-perpetual-stream/backlog.md       |   6 +
 experiments/quay-perpetual-stream/dashboard.md     |   2 +-
 .../DIR-006-webui-browser-verification-regression.md (renamed, +content)
 .../DIR-007-g3-adversarial-audit-role-dropped.md (renamed, +content)
 .../DIR-008-sigma-inherited-floor-consolidation-and-citation-drift.md (renamed, +content)
 .../quay-perpetual-stream/inherited-core.md        | 283 +++++++++++++++++++++
 7 files changed (4 modified, 3 renamed-with-content), 313+ insertions, 1 deletion (excluding
 Resolution-section additions to the 3 renamed DIR files, which are substantial but not captured
 by the plain --stat rename detection above — see §4/§6 for their full content).
```

## §8. End-of-iteration isolation proof

**Worktree** (`experiments/quay-perpetual-stream/milestones/M10-audit-consolidation/worktrees/iteration-0`):
```
$ git status --short
 M experiments/quay-perpetual-stream/OUTER-LOOP.md
 M experiments/quay-perpetual-stream/backlog.md
 M experiments/quay-perpetual-stream/dashboard.md
RM experiments/quay-perpetual-stream/directives/pending/DIR-006-webui-browser-verification-regression.md -> experiments/quay-perpetual-stream/directives/archive/DIR-006-webui-browser-verification-regression.md
RM experiments/quay-perpetual-stream/directives/pending/DIR-007-g3-adversarial-audit-role-dropped.md -> experiments/quay-perpetual-stream/directives/archive/DIR-007-g3-adversarial-audit-role-dropped.md
RM experiments/quay-perpetual-stream/directives/pending/DIR-008-sigma-inherited-floor-consolidation-and-citation-drift.md -> experiments/quay-perpetual-stream/directives/archive/DIR-008-sigma-inherited-floor-consolidation-and-citation-drift.md
 M experiments/quay-perpetual-stream/inherited-core.md
```
(4 modified + 3 renamed files, all in-scope per §4, no leftover temp files, no untracked stray
files, no product code.) This report itself
(`experiments/quay-perpetual-stream/milestones/M10-audit-consolidation/iterations/iteration-0.md`)
is a new untracked file at report-writing time, not yet reflected in the `git status` snapshot pasted
above (captured before this file was written) — it will be included in the commit alongside the
above changes.

**Shared repo root** (`/home/yale/work/quay`):
```
$ git status --short
?? docs/proposals/exp5-driver-deliverability-packaging.md
```
The shared root shows exactly one untracked file, and it is **not a leak from this iteration's
work** — `exp5-driver-deliverability-packaging.md` is unrelated pre-existing content (a proposal
doc, not touched or created by this milestone; distinct from DIR-008's finding-2 discussion of a
different, already-committed proposal file). Zero of this iteration's 7 changed/renamed files appear
in the shared root's `git status` — full worktree isolation confirmed.

## §9. Reflection — status and next-step for iteration-1

**All 8 Done-when clauses are MET** (§6), with pasted diffs/evidence for each, not prose summary.

**What is genuinely complete, not provisional:**
- Done-when 1, 2, 4, 5, 6, 7: all are direct content additions to `inherited-core.md`/
  `OUTER-LOOP.md`/`dashboard.md`/`backlog.md` — the diffs themselves ARE the deliverable, so there is
  no separate "live evidence of correctness" question the way there is for e.g. M09's live GitHub
  writes. The main open question for iteration-1 is fidelity/completeness re-review (did the content
  actually satisfy each Done-when clause's intent, or does a fresh reader find a gap), not
  re-deriving numeric/live evidence.
- Done-when 8: no product code touched is a structural fact (`git diff --name-status`), not an
  estimate — trivially re-verifiable by iteration-1.
- Directive archival (DIR-006/007/008 → `directives/archive/`) is a structural fact, also trivially
  re-verifiable.

**Provisional / needs iteration-1 re-verification (be honest, per this experiment's own base rate):**
- Done-when 3's audit conclusion ("nothing further found" beyond DIR-006/007/008's own topics) is
  the single most subjective judgment call in this iteration — it rests on this iteration's own
  read of 35 archived directives across exp1-4 and a judgment that each maps cleanly into one of two
  buckets (already covered by DIR-006/007/008, or already enforced elsewhere in exp5). Iteration-1
  should independently re-read the same archives and check whether it reaches the same "nothing
  found" conclusion, or surfaces a genuine fourth instance this iteration missed.
- Done-when 5's gate placement/wording in `OUTER-LOOP.md` has not been exercised end-to-end (no
  actual milestone has hit ABSORB since this gate was added) — iteration-1 should re-read the gate
  text for ambiguity/gaps a first-time reader (i.e., a future outer-loop invocation) might trip on,
  since this is the first real test of whether the wording is actually actionable, not just
  internally consistent to the author.
- The adversarial-audit role itself (Done-when 4/5) is entirely unexercised — no milestone has yet
  triggered the cadence-rule conditions since this gate was added (this very milestone, M10, is
  methodology-infra/governance-class with no VT weight, so per the cadence rule it does NOT trigger
  the gate on its own ABSORB — this should be stated explicitly as a documented no-op when this
  milestone reaches ABSORB, per the gate's own instruction). The design is worked and concrete, but
  "will it actually function as intended when first invoked" remains unverified until a real
  VT-scoring or self-exemption-attempting milestone triggers it.
- The VT₀ CARRY-FORWARD-WITH-LOW-CONFIDENCE decision (Done-when 6) is a considered judgment, not a
  provably-correct answer — a case could be made for RESET-to-0 instead (discarding the chart and
  rebuilding from a clean baseline). This iteration's rationale (chart already built on it, trap
  already fired transparently once) is recorded for iteration-1 or a future human reviewer to
  challenge if they disagree.

**Next-step recommendation for iteration-1:** independently re-verify from a FRESH worktree (branch
`exp5-m10-iteration-1`): (a) re-read all 8 Done-when clauses' new content in `inherited-core.md`/
`OUTER-LOOP.md`/`dashboard.md`/`backlog.md` for completeness/fidelity to the charter's intent, not
just presence; (b) independently re-perform the Done-when 3 exp1-4 archive audit and compare
conclusions; (c) re-verify the "no product code touched" claim and the directive-archive-move
structurally; (d) specifically stress-test the new `OUTER-LOOP.md` adversarial-audit gate's wording
for a first-time-reader ambiguity check; (e) re-derive the VT₀ carry-forward-vs-reset judgment
independently and either concur or flag disagreement for the outer loop's ABSORB-time decision.
