# Provenance (historical narratives extracted from inherited-core.md)

Each section below preserves historical narratives, worked examples, discovery stories,
validation passes, and iteration-by-iteration accounts that were previously embedded in
`inherited-core.md`. The operational constraints and formal declarations remain in
`inherited-core.md`. Every extracted block cites its original location.

---

## Domain-misfit audit-channel

*Original location: `inherited-core.md`, "Domain-misfit audit-channel — concrete decision procedure", lines 180-222*

### Validation against M01-dist's own finding (self-consistency check)

M01-dist's it0 (SS4.4d in its charter) named its audit channel abstractly: "a fresh shell (or CI job) with no local Node install, running the built executable directly." Applying the procedure above retroactively:

- **Step 1**: M01-dist's Done-when list already required CI (clauses 2/3) and local build verification (clause 4).
- **Step 2**: the local build+test-suite run (SS5.5 of iteration-0) is self-referential (same sandbox, same process that wrote the SEA build scripts). The Node-free container run (SS5.4) is NOT self-referential -- it is a `debian:stable-slim` Docker container that never had Node installed, a genuinely different environment than the dev sandbox that wrote the code.
- **Step 3**: an independent mechanism EXISTS (the Docker container) -- no ceiling, proceed to dispatch with that as the declared channel. This matches M01-dist's own it0d declaration exactly.
- **Step 4**: M01-dist's adaptation-log entry #1 (iteration-0 S9) independently arrived at exactly this same conclusion -- "the it0 domain-misfit audit-channel and the CI verification job should be the literal same mechanism" -- encoding the SAME Docker container pattern into the `sea-verify-node-free` CI job (S6) rather than inventing a second, different check for CI.

**Result: applying this procedure to M01-dist's own it0 produces the same audit-channel answer M01-dist actually used** -- confirming the procedure is a faithful concretization, not a redescription that would have given a different answer.

### CONSOLIDATED -- phi-confirmed pattern: the audit channel IS a CI job

The procedure's Steps 1-4 is the general decision procedure. The specific PATTERN it produced when first applied (M01-dist, chart-0) -- **"an independent, differently-provisioned CI job run is the audit channel"** -- was independently reused, unchanged, by M03-abi-eval's cross-provider differential conformance suite (18/18 scenarios, native vs. real `yaleh/quay` github provider), which served as its own audit channel by the exact same reasoning (Step 2: an externally-triggered CI run in a separately-provisioned environment) -- cross-platform (M01-dist) to cross-provider (M03-abi-eval), a genuinely different domain.

Per S4.2's phi fold-back definition, this crosses the 2-cross-domain-confirmation threshold as of M03-abi-eval (m3) and is now **CONFIRMED**. Tracked in `v-meta-ledger.md` (added M07-vmeta-gate). Any future milestone citing "the domain-misfit audit-channel is a CI job" pattern should treat it as an established, twice-confirmed convention, not a fresh proposal needing re-justification.

---

## Milestone size definition

*Original location: `inherited-core.md`, "Milestone size definition + verify-iteration size gauge", lines 261-356*

### Worked examples (self-consistency check)

These worked examples validated the sizing gauge against real milestones that DIR-004 had already independently judged. The gauge reproduces DIR-004's own verdicts, confirming it is a faithful concretization.

- **m1/M01-dist -- OVERSIZED.** Iteration-0 delivered the SEA builds. Iteration-1 was NOT pure re-verification: it pushed to a real remote and tag-pushed v0.3.0 to v0.3.4, fixing **4 distinct real CI failures** (Windows MSYS path resolution needing `cygpath -w`; `gh` absent in the bare container, switched to REST API; private-repo release assets needing the dedicated `/releases/assets/{id}` endpoint rather than `browser_download_url`) before reaching a green run. That is substantive NEW build work discovered and executed inside "iteration-1", not independent re-derivation of iteration-0's claims -- the CI-integration half of the milestone's own Done-when scope (clause 3) was still open at the start of iteration-1. Per the gauge: forced into new build work = oversized.

- **m2/M02-gates -- correctly sized.** Iteration-0 built and committed all 3 scripts plus the domain-misfit procedure, all 6 Done-when clauses met. Iteration-1 was a genuine independent re-verification pass: fresh re-run of all 3 scripts against fresh fixtures (zero drift found), independent confirmation iteration-0's commit was actually present, and an investigation of a real dogfood-gate FAIL against M01-dist's own report -- which iteration-1 determined was a CORRECT positive (real evidence existed but past the script's default 40-line window), not a script bug.

- **m4/M04-discover -- correctly sized.** Iteration-0's persona sweep found MD-001 (a real merge-drift measurement error). Iteration-1's independent re-verification pass RECOMPUTED the VT arithmetic from scratch and found the correction was real (VT chart-1 94.73/120, a genuine decrease from the pre-correction number) -- an independent re-derivation that could have contradicted iteration-0's finding but confirmed it instead. No new Done-when-scoped build work was required.

### Milestone ceiling expansion -- historical context (M18, DIR-012 item 2)

The size definition and gauge above (M06-sizing/DIR-004) answered HOW to judge whether a given scope fits ONE build+verify cost unit; they deliberately left open HOW LARGE a single coherent value step is allowed to be before it must be split. `docs/proposals/exp5-quay-task-proposal-plan-skill.md` S4 answered that open question.

**Source:** `docs/proposals/exp5-quay-task-proposal-plan-skill.md` S4 (cited, not duplicated -- the design doc's own worked reasoning, the meta-cc/quay `proposal-to-plan` review-loop evidence it cites, and the "clamp at both ends" pipeline context all live there).

---

## Value-typed SELECT ledger

*Original location: `inherited-core.md`, "Value-typed SELECT ledger + governance/infra hard floor", lines 439-517*

### Self-consistency check: retroactively applying the ledger to m1-m5

Applying the five value types to each of m1-m5's actual, already-settled outcome (per `dashboard.md`'s Log section, read-only):

| Milestone | VT Delta-v (settled) | Value type(s) applied | Matches DIR-004's own characterization? |
|---|---|---|---|
| m1/M01-dist | +6.0 | **capability-growth** (closed Packaging/Distribution cov gap 0.55 to 0.85) | Yes |
| m2/M-GATES | 0 | **risk/option** (mechanized 3 of 4 it0 checks, gate-hash/ceiling/dogfood scripts + domain-misfit procedure -- pre-empted wasted SELECTs on stale/unreachable candidates) | Yes -- DIR-004's own table reads verbatim: "m2 M-GATES | 0 | risk/option value (pre-empted 3 wasted SELECTs) | no -- scored 0". Correction (iteration-1): the prior draft labeled m2 governance-integrity; DIR-004's own archived text explicitly types m2 as risk/option. Fixed to match verbatim. |
| m3/M-ABI-EVAL | approx. 0 direct (chart transition/re-baseline) | **discovery** (Provider-ABI capability matrix + differential conformance suite surfaced 2 previously-unknown gaps, PR-ABI-001/002, via an independent audit channel) | Consistent -- DIR-004's table assigns m3 the discovery type, which this row reproduces. |
| m4/M04-discover | **-6.60** | **instrument-correction** (found+fixed MD-001, a standing VT measurement error carried since before m1 -- corrected an inflated chart-1 number) | Yes -- DIR-004 explicitly cites m4's -6.60 VT score alongside its "instrument-correction value" language. |
| m5/M-DIR-PROJECTION | 0 (no VT chart weight -- method-infra) | **governance-integrity + risk/option** (built the directive-projection anti-drift check, closing a SECOND repeat-instance of the DIR-002/DIR-006 files-canonical-without-enforcement gap) | Yes -- matches M06-sizing's OWN SELECT-time characterization. |

**Result: applying the ledger to m1-m5 reproduces DIR-004's own characterization.** No dashboard.md VT number is altered; it only ADDS a value-type label alongside the existing settled numbers.

### Two-class diversity policy -- historical note (M18, superseded 2026-07-19)

When M18 first wrote this policy, the `quay-task-to-plan` skill did not exist, so the policy was a forward-looking STATEMENT and M18 itself correctly did not use the pattern. That precondition is now met (DIR-014 items 2/3 wired the skill into DISPATCH and de-optionalized this policy); the "does not exist yet / future work" caveat no longer applies.

### Mechanism detail

The concrete pipeline shape a development-class milestone would run under the narrower pattern -- "clamp at both ends" (N independent proposal subagents + adjudication upstream, single implementation with a plan-check in the middle, the existing adversarial-audit gate unchanged downstream) -- is specified in `docs/proposals/exp5-quay-task-proposal-plan-skill.md` S6.

---

## Web UI verification requirement

*Original location: `inherited-core.md`, "Web UI verification requirement -- mechanized browser-tool evidence rule", lines 522-533 (historical context paragraph)*

### Discovery narrative (DIR-006)

DIR-006 found a live claim-vs-evidence mismatch: `charters/M04-discover.md` required "exercise list/detail/filter/search/action flows in a real browser (dual-viewport... holistic visual review)," and `milestones/M04-discover/iterations/iteration-0.md` narrated a "Live browser session... at both desktop (1280x900) and mobile (390x844, emulated touch) viewports" -- but the only literal pasted evidence anywhere in that report was two `curl` commands comparing `?search=` vs `?q=` query params. Zero `mcp__playwright__*`/`mcp__chrome-devtools__*` tool-call strings appear anywhere in exp5's 9 milestones (M01-M09), grepped directly. No mechanized gate caught this -- exp5's only Web UI HARD GATE (`G7`) is an HTTP-status `curl` check, unrelated to rendering/interaction verification, and iteration-1's independent-re-verification discipline did not catch this one either, because it also only re-read prose rather than re-deriving from a tool-call trace.

---

## Adversarial-audit role

*Original location: `inherited-core.md`, "Adversarial-audit role -- a NEW out-of-band step", lines 573-587 (discovery story) + lines 638-646 (comparison table)*

### Discovery narrative (DIR-007)

DIR-007 found that exp1's G3 out-of-band audit discipline (`.claude/skills/quay-native-methodology/reference/g3-audit-discipline.md`) -- a fresh-context subagent, dispatched by the orchestrator, NEVER by the session that did the work, explicitly CHARGED TO REFUTE the iteration's claims -- was carried into exp5 only as a citation. What exp5 actually built and mechanized instead -- the domain-misfit audit-channel and iteration-1's same-template independent re-run -- is real, effective, and has caught genuine bugs in 5 of 9 milestones (M02 gate-hash false-FAIL, M04 VT arithmetic slip, M05 CLI-flag typo, M06 self-exemption override, M07 ledger double-count). But it answers a different question than G3: "is this reproducible/stable," not "is this claim actually true and not inflated." G3's exp1 track record (3 separate V_meta overclaim attempts caught and reverted, iterations 29/59/61) was specifically about the SECOND question.

### Comparison: iteration-1 vs adversarial-audit

| | iteration-1 (existing) | adversarial-audit (NEW) |
|---|---|---|
| Dispatched by | the inner milestone's own charter/dispatcher | the OUTER loop, at ABSORB |
| Scope | re-derive/re-run the SAME kind of work fresh | actively try to REFUTE the claims already made |
| Question asked | "is this reproducible?" | "is this claim actually true and not inflated?" |
| Given the charter? | yes, full charter + fresh worktree | yes, PLUS the claims under audit -- explicitly asked to distrust them |
| When required | every milestone (2-iteration build+verify template) | only per the cadence rule |

### Session-id injection -- discovery and fix (DIR-034, M115)

The original procedure (step 5 in the first version) asked the dispatched subagent to determine or write its own "distinct session id" (e.g. by reading `CLAUDE_CODE_SESSION_ID` or any other env var from inside its own process). In the harness this project runs on, a subagent dispatched via the `Agent` tool inherits the PARENT session's env, so that value reads back identical to the orchestrator's own id, not a fresh one -- confirmed at M114/M115: the audit-independence gate correctly FAILed on this. The only reliable, harness-assigned, non-forgeable-by-the-subagent distinct identifier is the dispatch handle the orchestrator itself receives back at dispatch time (the `Agent` tool's own returned `agentId` / task id).

---

## Adversarial-audit cadence

*Original location: `inherited-core.md`, "Adversarial-audit cadence rule", lines 650-666 (full section; now superseded -- Clause 1 made UNCONDITIONAL)*

### Historical note

The original cadence rule applied the adversarial audit only to (a) VT-scoring (capability-growth-typed) milestones and (b) milestones where iteration-0 recommended skipping iteration-1. Methodology-infra/governance milestones with no VT weight were exempt by default. This was superseded on 2026-07-19 when Clause 1 was made UNCONDITIONAL -- every milestone now gets an acceptance audit, with the original cadence-rule conditions retained ONLY as escalation hints for how hard to push the refutation, never as a gate on whether the audit runs.

---

## sigma-inherited-floor trap

*Original location: `inherited-core.md`, "sigma-inherited-floor trap -- consolidated as operational content", lines 674-745 (historical narrative portions)*

### The m4 case study (VT0's own instance of this trap, already fired for real)

exp5's `VT0 = 82.25` was set at bootstrap directly from exp4's `gap-list.md` "Closed" claims (`OUTER-LOOP.md` step 2's origin scoring), with NO explicit reset-vs-carry-forward decision ever recorded at design time -- the carry-forward choice was made implicitly, by construction, not stated. This is structurally the CARRY FORWARD case, but without step 2's "stated confidence basis." The trap fired at m4/M04-discover: the live persona pass found exp4's "Closed" claims were systematically overstated (MD-001 merge-drift -- 12 gap-list entries reopened, CLI/Web UI/Docs surfaces all affected), producing exp5's first genuine VT DECREASE (101.33 to 94.73/120, Delta-v=-6.60, `dashboard.md`'s m4 VT curve log) -- discovered only after the fact by the exploit-channel discovery engine, not anticipated by a design-time check.

### Retroactive disposition of VT0

VT0's carry-forward is retroactively classified as CARRY FORWARD (not reset -- a reset was never practical after 9 milestones have already built on the chart-1 numbers), with its confidence basis now stated explicitly for the first time: exp4's gap-list "Closed" claims were trusted based on exp4's own iteration reports asserting closure, WITHOUT independent re-verification against `master` -- exactly the gap M04-discover's persona pass then found. Going forward, this experiment's own posture is: **any number carried forward from a DIFFERENT experiment or a prior chart is presumptively CARRY-FORWARD-WITH-LOW-CONFIDENCE until independently re-verified by this experiment's own live evidence** -- which is in fact what M04/M08/M09's re-scoring passes have already been doing in practice.

### Audit for other uncritically-inherited baselines

- **Chart-0 to chart-1 transition (m3):** `dashboard.md`'s m3 log carried the 5 original chart-0 surfaces (CLI/MCP/Web UI/Packaging/Docs) 1:1 into chart-1 "out of scope" (unchanged weights/cov), adding Provider-ABI as a genuinely new 6th surface scored fresh. **Disposition: CARRY FORWARD, low-risk** -- the 5 unchanged surfaces were not re-derived at the chart transition itself, but each has SINCE been independently re-scored with live evidence at least once (Web UI/CLI/Docs at m4, CLI/Docs/Packaging at m8, none skipped).
- **Provider-ABI's chart-1 origin cov (m3, 0.654):** this is NOT an inherited number -- M03-abi-eval built the capability matrix and differential conformance suite FROM SCRATCH this experiment.
- **`v-meta-ledger.md` / V_meta consolidation-lag health track starting value:** this track was CREATED by M07-vmeta-gate (m7) with a genuinely fresh starting state (0 rows past-threshold at creation), not inherited from exp4.
- **Milestone-counter / chart-counter origin (`milestone_counter: 0`, `chart: 0` at bootstrap):** these are explicit resets to 0 by `OUTER-LOOP.md`'s own First-run bootstrap step 3.
- **No other still-live inherited numeric baseline was found** by this audit (grep/read of `dashboard.md`'s Log section + `OUTER-LOOP.md`'s bootstrap steps against exp4's own closing artifacts).

---

## manda-dispatch discipline

*Original location: `inherited-core.md`, "manda-dispatch discipline -- correct narrow scope", lines 750-807*

### Discovery narrative (DIR-008)

DIR-008 found a companion, lower-severity drift: `docs/proposals/exp5-concurrent-background-agents-for-milestone-iteration.md` re-derived a manda-dispatch conclusion from scratch, live, with zero reference to the existing envelope document (`.claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md`) or DIR-020's precise scope -- and DIR-008's OWN first draft overstated the rule as a blanket ban, corrected only after live human review. This section exists so future milestones don't have to re-derive (or over-generalize) the rule a third time.

### Standing practice decision (DIR-008 item 4, minor/non-blocking)

**Adopted** -- before drafting a new cross-cutting proposal or charter section touching manda/G3/dispatch mechanics, do a quick grep of `inherited-core.md`'s own delta chain first plus a targeted grep of `experiments/quay-native-bootstrap/directives/archive/DIR-0{15,16,20,24}*` and `.claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md` before re-deriving the rule live. The consolidated section in `inherited-core.md` is the correct single place to check; no future milestone should need to re-open the archived DIR-0NN files directly unless the consolidated section itself is found insufficient (in which case, expand it, don't leave the gap for the next drafter to re-discover).

---

## Human-steered task definition

*Original location: `inherited-core.md`, "Human-steered task definition (DIR-062, 2026-07-23)", lines 809-844 (no separate historical narrative section; the 3-clause definition is the operational content and remains in inherited-core.md)*

*Note: This section had no separate historical narrative to extract. The full definition moved to inherited-core.md with a lambda-signature header. The original lines 809-844 were already predominantly operational.*

---

## Human-review cadence

*Original location: `inherited-core.md`, "Human-review cadence -- standing rule", lines 853-888 (retroactive tally table and summary statistics)*

### The real tally (all 11 `directives/archive/DIR-*.md`, read in full at M15's authoring)

| DIR | Arrival boundary (milestone-count gap) | Initiation mode | Finding kind |
|---|---|---|---|
| DIR-001 | pre-m3 dispatch (m2 to m3 boundary) | human, mid-conversation | structural blind-spot (VT surface set blind to Provider-ABI/GitHub) |
| DIR-002 | mid-m4 (during M04-discover; drained at the m4 to m5 boundary) | human, mid-conversation | drift detected (exp4's DIR-006 "files-canonical" resolution was a rationalized transition failure, not a settled decision) |
| DIR-003 | mid-m5 (during M05-dir-projection's own iteration-0) | **self-raised** (iteration-0, per M05's charter item 5's sanctioned live-dogfood requirement) | routing/dogfood demonstration artifact -- not a finding in the same sense as the other 10 |
| DIR-004 | m5 to m6 boundary | human, mid-conversation | drift detected (2-iteration sizing is a cost-proxy artifact) + routing decision (value-typed SELECT ledger) |
| DIR-005 | m6 to m7 boundary | human, mid-conversation | structural blind-spot (V_meta consolidation lag invisible to every existing health track) |
| DIR-006 | mid-m9 (arrived during M09-gh-write; drained in the m9 to m10 burst) | human, mid-conversation | drift detected (Web UI verification narrated as "real browser" but only `curl` evidence pasted) |
| DIR-007 | mid-m9 (same burst as DIR-006) | human, mid-conversation | structural blind-spot (G3 adversarial-audit role silently weakened into same-template re-run) |
| DIR-008 | mid-m9 (same burst as DIR-006/007) | human, mid-conversation | drift detected (sigma-inherited-floor trap never consolidated despite being pre-named at kickoff) |
| DIR-009 | m12 to m13 boundary (3-directive burst with DIR-010/011) | human, mid-conversation | scope split / routing decision (exp5's own non-directive work invisible in the task store) |
| DIR-010 | m12 to m13 boundary (same burst) | human, mid-conversation | drift detected (directive-projection cross-experiment task-id collision + boundary-only reconcile gap) |
| DIR-011 | m12 to m13 boundary (same burst) | human, mid-conversation | routing decision / scope split (Core CLI edit-surface relaxation + portable-metadata rule design) |

**Summary statistics:** 10 of 11 directives are human-initiated mid-conversation; exactly 1 (DIR-003) is self-raised by an inner iteration under an explicit charter sanction. Arrivals cluster in bursts at milestone boundaries: 5 single-directive arrivals and 2 three-directive bursts. The largest observed gap between human-directive bursts in this tally is 3 milestones (m6 to m7 to m9 to m10).

---

## Portable-metadata convention

*Original location: `inherited-core.md`, "Portable-metadata convention", lines 908-942*

### Provenance note

Source: `docs/proposals/exp5-cli-edit-parity.md` S3.2, produced by M14-cli-edit-parity (design-only) per DIR-011 item 3; inserted verbatim by M16-cli-edit-parity-impl (the implementing milestone the design doc's own S6 Done-when list required) as that milestone's Done-when clause 4. Already cross-referenced informally by M13's task-backlog-projection design (S11) before this section existed in named/citable form in `inherited-core.md`. The original worktree-local insertion note recorded that the edit was made inside M16's worktree and would be reconciled against the real shared file by the outer loop at ABSORB.

---

## Design-only milestone to mandatory -IMPL row rule

*Original location: `inherited-core.md`, "Design-only milestone to mandatory -IMPL row rule", lines 944-991*

### Discovery narrative (DIR-016)

**The problem this rule closes:** a design-only milestone completes, marks itself DONE, and defers its implementation to "a future SELECT" in prose -- but SELECT (`OUTER-LOOP.md` step 1) only considers non-DONE `backlog.md` candidate rows, so a deferral with no row is a deferral to never. Evidence: `M-CLI-EDIT-PARITY` (design, DONE m14) correctly got an `-IMPL` row (SELECTed and completed at m16); `M-TASK-BACKLOG-PROJECTION` (design, DONE m13) did NOT (DIR-015); `M-TASK-TO-PLAN-SKILL-DESIGN` (design, DONE m17) did NOT (its follow-up sat unqueued until DIR-014 was hand-filed). Whether a design milestone's implementation ever becomes reachable depended entirely on the ABSORB agent *remembering* to hand-author an `-IMPL` row -- an unenforced convention that silently failed 2 of 3 times.

Source: DIR-016 (filed together with DIR-015, its first concrete instance), resolved by M21-impl-row-enforcement. See `directives/archive/DIR-016-*.md`'s `## Resolution` section for the full evidence trail.

---

## Definition of Done

*Original location: `inherited-core.md`, "Definition of Done", lines 992-1411 (discovery and refinement narratives)*

### Genesis (DIR-017 Step 1, M25-dod-meta-enforcer)

DIR-017's Finding named a real risk: four ABSORB-time gates (adversarial-audit, V_meta consolidation-lag, line-budget, design-only-milestone impl-row) had each been added incrementally, by four different prior milestones (M10/DIR-007, M07/DIR-005, M18/DIR-012, M21/DIR-016), as separate conditional HARD BLOCKs scattered across `OUTER-LOOP.md` step 6 and this file -- with no single place naming ALL of them as one collective "Definition of Done" a milestone must clear, and no mechanism preventing a future charter from narrating its way around one of them. This section was created as that single collecting place.

### Clause 0 checklist-form mandate (DIR-020/M34, 2026-07-19)

AC/DoD are authored at the **proposal** stage and recorded in the milestone-candidate **task** body. They MAY be revised at the plan/charter stage, but the revision is made to the task's copy; they are NEVER forked into the charter. Checklist form (`- [ ]` / `- [x]`) is MANDATED going forward from DIR-020/M34; pre-existing prose-form tasks are NOT retroactively rewritten -- Clause 0 continues to accept prose-form AC/DoD unchanged.

### Clause 1: made UNCONDITIONAL (2026-07-19)

The original cadence-rule conditions -- (a) VT-scoring, (b) iteration-0 self-exemption attempt -- are retained ONLY as escalation hints for how hard to push the refutation, never as a gate on whether the audit runs. There is no longer a documented-no-op case for this clause.

### Clause 5 no-self-exemption: discovery (DIR-019, M30)

`it0-dod-check.ts` Clause 5's carve-out logic was dead code for Clauses 3/4 (line-budget/impl-row) -- a charter could write undeclared exemption language for those two clauses with no `WAIVER:` line and the enforcer would silently PASS. Found at the m29 to m30 boundary by DIR-019, a human-authored directive. Fixed at M30 (commit `5c4be91`), externally re-tested per DIR-019 item 3's own mandate.

### Clauses 6/7: discovery (DIR-017 Step 2, M32-dod-escrow-testfloor)

Added by M32 to close two Goodhart surfaces: escrow-Delta-v (design-only milestone's Delta-v is provisional until its `-IMPL` ships) and product-work test-floor (product-touching work carries real tests >=80%, actually run).

### Clauses 6/7 -- MECHANICALLY_UNCONDITIONAL_CLAUSES reconciliation (M32 two-iteration ABSORB, 2026-07-19)

M32 ran two independent iterations on separate branches; both delivered the same Clause 6/7 text and mechanization, but disagreed on whether `escrow-delta-v`/`test-floor` should be added to `it0-dod-check.ts`'s `MECHANICALLY_UNCONDITIONAL_CLAUSES` set. Iteration-0 added them; iteration-1 deliberately did not, arguing Clause 6/7 are documentation-discipline checks. Resolved in favor of iteration-0: a live reproduction showed that a fixture where Clause 6's trigger legitimately does NOT fire but the charter still contains undeclared self-exemption language produces a FALSE PASS with iteration-1's un-patched script, but correctly FAILs with iteration-0's. A permanent regression fixture (`fixtures/dod/self-exempt-escrow-stub.md`) pins the reproduction.

### Clause 7 negation-blind fix (M32 acceptance audit, post-merge, 2026-07-19)

The out-of-band acceptance-audit subagent constructed two live adversarial ABSORB-entry texts and confirmed both FALSE-PASSed Clause 7 pre-fix: *"We considered aiming for 80% test coverage but decided it wasn't necessary..."* and *"no 80% test coverage floor was met; tests exist only for the happy path."* Both mentioned the raw tokens the regex looked for, without the regex checking whether the SAME SENTENCE negates them. Fixed by adding a sentence-scoped negation window, pinned as permanent regression fixture `fixtures/dod/test-floor-negation-poison-stub.md` (`M91-fake-testfloor-negation`).

### Clause 8 -- task canonical-lifecycle-record gate (DIR-014 item 6, M40, 2026-07-19)

DIR-014 item 6 named a gap: Clause 0 verified a task carries acceptance criteria and a done-checklist, but nothing verified a task also carries the design record for HOW those criteria will be met -- the `## Proposal` and `## Plan`. Before M40, 0 of the 24 `exp5-M-*` milestone tasks carried a `## Proposal` section at all -- the requirement existed only as DoD prose ("should have a proposal"), which is not a gate. This subsection makes the task the single canonical lifecycle record (proposal embedded + plan referenced-or-N/A) and mechanically enforces it.

---

## Deviation-record schema

*Original location: `inherited-core.md`, "Deviation-record schema", lines 1487-1597 (backfilled worked examples and forward-update responsibility)*

### Backfilled worked examples (best-effort, NOT exhaustive)

**Limitation, stated explicitly per the charter's own scope note:** this backfill covers only the 5 deviations the charter names as worked examples (DEV-01 through DEV-05 at M36, later extended to DEV-09 through DEV-14 by subsequent milestones), re-verified directly against `dashboard.md`'s actual ABSORB-entry text, not a systematic sweep of all milestones' history. A future candidate could extend this backfill; this milestone does not claim completeness.

The full deviation table with all rows (DEV-01 through DEV-14) was previously in `inherited-core.md` lines 1555-1570. Each row records: id, title, origin-milestone, found-at, caught-by (machine vs human), status (found/fixed/verified-eliminated), and age (milestone-count span). See those lines in git history for the complete data.

### Forward-update responsibility

The Clause-1 per-milestone acceptance-audit subagent is the SOLE standing writer of this log going forward, for every row of either `caught-by` kind -- at the SAME dispatch point it already runs (`OUTER-LOOP.md` step 6, immediately after the checklist write-back sub-step) -- not a new, separately-scheduled process, and not a second actor. A `fixed`-status row's promotion to `verified-eliminated` is likewise the audit's job, checked at EVERY subsequent ABSORB it runs -- mirroring Clause 2's own "every ABSORB re-checks every ledger row" discipline.

### Location choice rationale

A deviation log was placed in `inherited-core.md` rather than a new sibling file because deviations are discovered and resolved almost entirely AT ABSORB boundaries (the same moment the DoD clauses are evaluated and the same moment `dashboard.md`'s Log already grows a new entry) -- it has the SAME update cadence as the DoD-clause record, not a distinct one. This keeps the "leakage metrics" work adjacent to the DoD clauses it measures.
# Skill extraction provenance

Extracted histories from `plugin/skills/execute/SKILL.md` and
`plugin/skills/author/SKILL.md` Gaps sections and honesty notes, per the
CURRENT-STATE refactoring principle: only gaps that remain open today stay
in the Skill Gaps section; resolved-gap discovery/verification narratives
move here.

## Skill extraction — execute

### Honesty note (iteration 1)

Originally lines 14-26 of execute/SKILL.md.

still **not yet used** to drive any task — per the fixed per-Skill
retirement order (protocol SS10.2), iteration 1's scope was authoring-side
only (`quay:author` — see QN-001/QN-003/QN-004/QN-005 in
`experiments/quay-native-bootstrap/provenance.md`). QN-006 (iteration 0's
one task-to-`done`) and any task driven to `done` since remain
seed-executed. This Skill's own authoring task (QN-004) was driven to
`ready` by `quay:author` in iteration 1 — that only means the *plan* to
retire this Skill's seed dependency now exists; the Skill itself remains
unexercised. Sigma for `quay:execute` remains 0 until a later iteration
actually dispatches it and records `execute_by: native`. Iteration 1 also
confirmed (via `quay:author`'s own exercise) that **this environment has no
subagent-dispatch primitive** — the same finding applies here, and is
reflected in the Method/Gaps.

### Honesty note (iteration 18, QN-029) — provider-parameterized

Originally lines 27-35 of execute/SKILL.md.

Same change, same rationale, as `quay:author`'s iteration-18 honesty note:
every Method step previously hardcoded `quay-native task <cmd>`; all such
invocations are replaced with Core's generic `quay task <cmd> --provider
<provider>` passthrough (default `native`, unchanged behavior — see
`experiments/quay-native-bootstrap/iterations/iteration-18.md` Phase 3 for
the byte-identical regression proof). This is what makes `quay-github`'s
`skill` capability declaration (same task) actually correct rather than
aspirational — see `quay:author`'s own honesty note for the full reasoning,
not repeated here.

### Resolved gap: epic/compound branch — iterative exercise (iterations 5-9)

The epic/compound branch (`executeEpic`) was exercised for the first time
in iteration 5 (QN-008/009/010/011) — one favorable-case data point (all
children's underlying implementation work already correct before their own
AC/DoD were written). Iteration 6 (QN-013, children QN-014/QN-015)
deliberately designed one child (QN-015, a compare-and-swap concurrency
primitive) to be genuinely hard and NOT pre-verified before authoring, so
that its own gate outcome would be honest rather than manufactured. The
**actual, unplanned result**: QN-015 genuinely passed its own gate on the
first implementation attempt (6/6 AC, confirmed red-before-fix via `git
stash`) — it did **not** land on `needs-human`. `executeEpic`'s
`needs-human` fallback branch therefore **remained unexercised in
practice** as of iteration 6, despite a deliberately-adversarial attempt —
see `experiments/quay-native-bootstrap/iterations/iteration-6.md` SS5/SS9 for
the honest account of why the attempt still counted as a genuine (not
rigged) test.

**Resolved in iteration 7 (QN-017):** the `needs-human` fallback branch has
now been genuinely exercised, via `executeLeaf`'s path (not `executeEpic` —
the leaf path shares the same `gate.ok === false -> NeedsHuman` outcome).
QN-017 was authored *deliberately unsatisfiable by construction*, not
merely "hard": its AC required this environment's `review-proposal` step
to have run in a genuinely separate, freshly-dispatched subagent — a real,
re-confirmed-absent environmental precondition (no subagent-dispatch
primitive has been found in 7 consecutive `ToolSearch` checks, iterations
1-7), not a subjective difficulty estimate. `quay-native task check
QN-017 --json` genuinely returned `{"ok": false, "acTotal": 2,
"acChecked": 0, "reason": "0/2 AC checkboxes checked"}` at the
`execute->done` gate, because AC item 1 could not honestly be checked
true. Per this Skill's own Method step 3 ("route to `needs-human` if a
genuine blocker... is found"), the task was flipped to status
`needs-human` — a real, valid status (`store.js`'s `VALID_STATUSES`),
producing `{"gate": "none", "ok": false, "reason": "soft stop; human
action required"}` on subsequent checks. This is the first genuine,
mechanically-produced (not narrated) exercise of this fallback path in
the experiment's 7-iteration history. See
`experiments/quay-native-bootstrap/iterations/iteration-7.md` SS5 for the full
account, including the honest correction that the initial attempt to
trigger this via the *authoring* gate did not work (the `author->ready`
gate only requires checkbox *presence*, not checked-state — a real, useful
finding about gate design surfaced by this attempt) and the actual trigger
point was the `execute->done` gate, as this Skill's own Method already
documents.

**Resolved in iteration 8 (QN-020/QN-021):** the question left open
("was `executeEpic`'s own branch adequately covered by the general
leaf-level proof, or does it need a dedicated task?") is now answered:
yes, it needed a dedicated task, and QN-020 (epic, one child QN-021) is
it. `executeEpic`'s `needs-human` outcome has two structurally distinct
triggers in the pseudocode: (1) a child cannot be driven to `done`, so
`driveEach` cannot complete (`ok` never reached for that child) — the case
this task exercises; and (2) all children reach `done`, but
`integrationAccept` (`runEpicLevelACAndDoD`) itself fails — a narrower,
still-**unexercised** sub-case this task does **not** resolve. QN-020's
child QN-021 was authored with the same structurally-unsatisfiable AC item
QN-017 used (no subagent-dispatch primitive found, 8th consecutive
`ToolSearch` confirmation across iterations 1-8); QN-021 was actually
driven — not narrated — and, because of QN-019's same-iteration
`author->ready` gate tightening, failed one gate earlier than QN-017 did
(`author->ready` itself, `1/2 AC checkboxes checked`, rather than
`execute->done`). Either way QN-021 cannot reach `done`, so `driveEach`
cannot complete; QN-020 was then actually flipped (`task edit QN-020
--status needs-human`), and `task check QN-020 --json` now genuinely
returns `{"gate":"none","ok":false,"reason":"soft stop; human action
required"}` — the first real, mechanically-produced exercise of
`executeEpic`'s own distinct `needs-human` branch (not `executeLeaf`'s,
which QN-017 already proved) in this experiment's 8-iteration history.
See `experiments/quay-native-bootstrap/iterations/iteration-8.md` SS5 for the
full account. The "integration acceptance itself fails after all children
complete" sub-case remains open for a future iteration.

**Resolved in iteration 9 (QN-022/QN-023):** the narrower sub-case left
open above is now exercised for real. Unlike QN-020/QN-021 (child cannot
reach `done`), QN-023 (the child) genuinely reached `done` — confirmed
via live `quay-native task check QN-023 --json` returning `{"gate":
"none", "ok": true, "reason": "terminal"}`. QN-022's own AC was authored
with 4 genuinely-satisfiable items at authoring time (so `author->ready`
passed for real, `ok: true`), and only after QN-022 genuinely reached
`ready` (and QN-023 was already `done`) was a 5th, honestly-unsatisfiable
AC item added — the same structural precondition as QN-017/QN-020/
QN-021 (no subagent-dispatch primitive found; 9th consecutive `ToolSearch`
confirmation across iterations 1-9), but applied at the epic-integration
sign-off level rather than a per-Skill-step level. `quay-native task check
QN-022 --json` at that point genuinely returned `{"gate": "execute->done",
"ok": false, "acTotal": 5, "acChecked": 4, "reason": "4/5 AC checkboxes
checked", "childrenStatus": [{"id": "QN-023", "status": "done"}]}` —
i.e. `acOk: false` while `childrenOk: true`, the one previously-untested
boolean combination in `store.js`'s `ok = acOk && childrenOk` compound
gate. QN-022 was then flipped to `needs-human`, producing the same
soft-stop shape as the other two triggers. A genuine sequencing pitfall
was caught and corrected mid-construction: an initial single-pass attempt
to write all 5 AC items at once (while QN-022 was still `status: todo`)
would have tripped the *wrong* gate (`author->ready`, not `execute->done`)
for the wrong reason, since QN-019's checked-state fix made both gates
inspect the same AC section — this was caught via a live `task check`
call showing the mistaken `author->ready` failure, and the construction
was redone in genuine temporal order before QN-022's status was ever
advanced. See `experiments/quay-native-bootstrap/iterations/iteration-9.md`
SS5 for the full account. All three structurally distinct `needs-human`
triggers named in `executeEpic`'s Spec/Gaps history are now genuinely,
mechanically exercised: (1) `executeLeaf`'s own gate failure (QN-017),
(2) a child that cannot reach `done` (QN-020/QN-021), (3) all children
done but the epic's own integration acceptance fails (QN-022/QN-023). No
further distinct branch in `executeEpic`'s own pseudocode is currently
known to remain unexercised; if one is identified later it should be named
explicitly rather than assumed covered.

### Resolved gap: compound-aware gate (iterations 6-7)

**Fixed in iteration 6 (QN-012):** `quay-native task check`'s mechanical
gate is now compound-aware — a `done` compound task's gate check
re-verifies that every child is itself `status: done` (returning `ok:
false` and naming the offending/missing child otherwise), and a `ready`
compound task's execute->done gate requires both AC-checkbox completion
AND all-children-done. Previously the gate unconditionally rubber-stamped
`ok: true, reason: "terminal"` for any `done` task regardless of role —
this meant `executeEpic`'s "integrationAccept -> done" guarantee was
enforced only by Skill-level process discipline, not by the gate itself.
It is now enforced at the gate level too (see `store.js`'s `check()` and
`childrenStatus()`), closing the gap iteration 5's independent audit
named (`experiments/quay-native-bootstrap/audits/
iteration-5-independent-adjudicate.md`, Claim 5). Primitive (leaf) task
gate behavior is unchanged (verified by dedicated regression tests,
`packages/quay-native/test/compound-gate.test.mjs`).

**Fixed in iteration 7 (QN-016):** the QN-012 fix above only checked one
level deep (`childrenStatus()` read `child.status` directly) — a `done`
child whose own grandchild had reverted would still be reported `"done"`,
so a 3-level epic could stay falsely `ok: true`. Found by iteration 6's
independent, out-of-band audit (`experiments/quay-native-bootstrap/audits/
iteration-6-independent-adjudicate.md`, Finding 1). `childrenStatus()` is
now recursive: a compound child is only reported `"done"` if its own
subtree is also fully done; otherwise it is reported as the distinct
status `"stale-done"` (nameable, not silently collapsed into `"done"`).
Cycle-safe (a cyclic children graph resolves to `"missing"`/`ok:false`
rather than crashing or hanging). See
`packages/quay-native/test/compound-gate-recursive.test.mjs`.

### Resolved gap: epic-level recursive orchestration (iteration 27)

**Resolved in iteration 27 (QN-037, gh-10/gh-8/gh-9):** iterations 25 and
26 both named the same residual gap — every prior compound/epic live
verification (native's QN-012/QN-016, GitHub's QN-035/DIR-006) exercised
only the **gate's own** compound-recursion logic (`checkGate()`/
`childrenStatus()`) via direct, manual `task check`/`task edit` commands
standing in for this Skill, never `executeEpic`'s own **recursive
orchestration** (`driveEach` over real children, followed by
`integrationAccept`) as an actual Skill-level drive. Iteration 27 closes
this: a fresh, real, two-child GitHub epic (issue #10, children #8/#9)
was authored via `quay:author`'s own Method against the epic itself
(decompose test genuinely satisfied — two independently mergeable
DESIGN.md doc-comment deliverables), then driven via this Skill's own
`executeEpic` pseudocode: `driveEach` recursively invoked `quay:author`
then this Skill's own `executeLeaf` path (`implement-phase` — a real
`packages/quay-github/DESIGN.md` diff per child; `self-audit-ac` — the
full regression suite re-run after each child; `gate-check`) against
each child in turn, in genuine temporal order (child A fully to `done`
before child B was even authored), followed by `integrationAccept` — a
live `quay task check gh-10 --provider github --json` re-run at the
epic level. The intermediate proof was captured live, not narrated:
with only child A done, the epic's own `execute->done` gate genuinely
returned `{"ok":false,"reason":"AC checkboxes complete, but not all
children are done: gh-9 (todo)","childrenStatus":[{"id":"gh-8",
"status":"done"},{"id":"gh-9","status":"todo"}]}`; once both children
reached `done`, the same gate call returned `{"ok":true,"reason":"all AC
checkboxes checked; eligible to move to done","childrenStatus":
[{"id":"gh-8","status":"done"},{"id":"gh-9","status":"done"}]}` — the
epic was then flipped to `done` for real. This is still the same
same-session degraded-fallback mode this experiment has used since
iteration 1 (no subagent-dispatch primitive found, reconfirmed via
`ToolSearch` this iteration) — what changed is that the *epic-level
recursive orchestration itself* (not just leaf-level gate mechanics) was
what was actually exercised and recorded. See
`experiments/quay-native-bootstrap/iterations/iteration-27.md` SS5 for the
full transcript.

### Partial closure: quay MCP server registration (iteration 28)

**Iteration 28 finding (partial closure, real gap remains): `quay mcp`'s
own stdio transport IS now registered as a real, mechanically-verified
project-scoped MCP server** (`.mcp.json`, added via `claude mcp add
--scope project quay -- node packages/quay/bin/quay.js mcp` — the actual
Claude Code CLI mechanism, not a bespoke script). `claude mcp get quay`/
`claude mcp list` both confirm the server is correctly configured and
spawns (health-checked), but report its approval status as **"Paused
Pending approval (run `claude` to approve)"** — MCP servers named in a
project's `.mcp.json` require per-project approval that is only
prompted/resolved at a **fresh session's own startup**, not mid-session.
This iteration additionally hand-drove the real MCP JSON-RPC protocol
directly over the server's stdio (bypassing the
Claude-session-registration boundary, as a diagnostic, not a substitute):
a genuine `initialize` handshake, `notifications/initialized`, and
`tools/list` all succeeded, returning the actual
`task_list`/`task_get`/`task_write`/`task_check` tool schemas from the
real running server process; a genuine `tools/call` for `task_list` with
`{"status":"done"}` also succeeded, returning real task data matching this
repo's own tasks (cross-checked in kind against `quay task list --status
done --json`'s own output). This is materially stronger evidence than any
prior iteration's manual-command-sequence proxy (it is the actual wire
protocol, not a CLI stand-in) — but it is **still not** what remains the
genuine residual gap: a real Claude Code session's own tool-use (its own
`ToolSearch`/tool-call mechanism, inside its own already-initialized MCP
client) discovering and invoking `quay`'s tools has never happened, and
cannot be self-verified from within an already-running session (confirmed
directly again this iteration: `ToolSearch` still surfaces zero
`quay`-related deferred tools in this session, since `.mcp.json` was added
after this session's own MCP client initialized). `.mcp.json` is now
committed to the repository specifically so that the **next fresh session**
started against this repo can check its own `ToolSearch` output as one of
its first actions (after approving the pending server) and genuinely close
this gap — see `experiments/quay-native-bootstrap/iterations/iteration-28.md`
SS5 for the full transcript and
`experiments/quay-native-bootstrap/iterations/iteration-27.md`'s own
problem #1 for the prior iteration's identical framing of what would
constitute real closure.

### Resolved gap: conditional manda-proxied Agent trials (experiment 2, iterations 4-7)

**Update (experiment 2, iteration 4) — conditional manda-proxied Agent
now demonstrated live:** same finding as `quay:author`'s iteration-4
update; applies equally to this Skill. `mcp__plugin_manda_manda__Agent`
was successfully called with `to="cord"`, `timeout=90`, returning
`{"output":"PONG"}` on first attempt (daemon live at `.manda/hub.addr`
port 46215; live broker confirmed). DIR-020 hard rule applies: caller
session must differ from broker session. The primitive is conditional
(daemon live + non-self broker required), not unconditional — the
completeness gap's specific wording ("reliable, unconditional native
fresh-context spawn") is not yet closed.

Three-tier reliability envelope confirmed (experiment 2, iterations 4-6):
- Trivial (PONG — single-word echo): SUCCESS 1/1, timeout=90s (iteration 4)
- Medium (single file read + structured JSON verdict): SUCCESS 1/1,
  timeout=150s (iteration 5)
- Complex (multi-file read + adversarial analysis + structured verdict):
  SUCCESS 1/1, timeout=150s (iteration 6)

All three tiers confirmed at their respective timeout windows. The
unconditional gap remains. See `quay:author`'s iteration-4/5/6 updates for
full primary-source trial records.

Timing-recording note (experiment 2, iteration 7 — effectiveness gap): The
V_meta effectiveness factor requires a scope-matched native-execution
timing comparison against stage-0 QN-006's baseline (author ~51s, execute
~2m59s — confirmed in `experiments/quay-native-bootstrap/timing/
iteration-0.log`). Future Skill-driven executions of a scope-matched task
(single source file, logic change, no network I/O) should record
wall-clock timing in the iteration report to enable this comparison. No
QC-* task has yet matched this shape (iterations 1-6 produced only
documentation and browser-test tasks). When one arises organically, timing
should be recorded explicitly — see
`experiments/quay-core-bootstrap/iterations/iteration-7.md` SS3 for the
full stall analysis.

### Resolved gap: negative/error-path test-coverage discipline (iteration 61)

**Fed back into the Method in iteration 61: the negative/error-path
test-coverage discipline.** Iterations 58, 59, and 60 each independently
found and closed a genuinely distinct instance of an untested failure
mode at an external boundary (Provider-subprocess-connection failure;
malformed/absent input shape; live mid-session upstream failure) — in
each case, by first grepping this repo's own test files and
`experiments/quay-native-bootstrap/provenance.md` to confirm the specific
instance was genuinely open, not merely re-running or lightly varying
prior coverage. This was real, repeated, independently-justified practice
across three consecutive iterations, but until this iteration it existed
only in `experiments/quay-native-bootstrap/provenance.md`'s own
per-iteration narration — the Method was silent on it, so a future
`implement-phase` pass had no standing instruction to consider this class
of gap for a *new* feature's own boundary-touching code, only a historical
record that three past *test-coverage-closure* tasks happened to find such
gaps. This is now written into step 1 as a standing sub-check (ask the
question for any boundary-touching Plan phase; do not manufacture a test
where no genuine gap exists, per G5). This closes a real,
previously-unaddressed gap in this Skill's own self-containedness (the
Method not reflecting real, established practice), not a cosmetic
rewording — see
`experiments/quay-native-bootstrap/iterations/iteration-61.md` for the full
reasoning distinguishing this from iteration 18's "documenting
newly-written capability" (which does not count) and iteration 29's
reverted `completeness` credit (revising `ITERATION-PROMPTS.md`, an
out-of-scope document, which also does not count).

### Skill status note (pre-refactoring)

This Skill itself remained entirely unexercised as of iteration 1 — its
own authoring task (QN-004) was driven to `ready`, but that was a plan for
retiring its seed dependency, not the retirement itself. `execute_by` was
`seed` for every task in `experiments/quay-native-bootstrap/provenance.md`
as of iteration 1. This status was later resolved: the Skill is now
`exercised` (sigma=0.40, last exercise iteration 27),
provider-parameterized (iteration 18/QN-029), and its epic branch,
all three `needs-human` trigger types, and recursive orchestration path
have all been genuinely, mechanically exercised.

## Skill extraction — author

### Honesty note (iteration 1 / sigma rising)

Originally lines 14-28 of author/SKILL.md.

This Skill was written in iteration 0 as a v0 port of the seed's
`authoring-convergence` (epicd) and was, at that point, entirely
unexercised. **Iteration 1 actually dispatched this Skill's method against
real tasks** (QN-001, QN-003, QN-005 — see
`experiments/quay-native-bootstrap/provenance.md`), authoring real
Proposal/Plan/AC/DoD content and passing each through the gate. A concrete
environment finding came out of that exercise: **this environment (the
tool-calling harness driving this session) has no subagent-dispatch
primitive** — an explicit `ToolSearch` check for a `Task`/`Agent`-equivalent
tool during iteration 1 found none. This means the fresh-context isolation
design SS5 calls for ("Layer-1 operation Skills... each in its own
subagent") could not be achieved for real in iteration 1; the four steps
below ran sequentially in one session, with a same-session review
checklist substituting for genuine reviewer independence. This is recorded
here, not hidden.

### Honesty note (iteration 18, QN-029) — provider-parameterized

Originally lines 29-47 of author/SKILL.md.

Every Method step previously hardcoded `quay-native task <cmd>`, invoking
`quay-native`'s own CLI directly. This was a real, undeclared limitation:
declaring quay-github's `skill` capability without fixing it would have
been a config-only, semantically-empty change (the composed action-button
payload would name this Skill, but invoking it against a GitHub-backed
task id would silently target the wrong Provider's data). QN-029 replaced
every such invocation with Core's own already-existing, provider-agnostic
CLI passthrough — `quay task <cmd> --provider <provider>` (`packages/quay/
bin/quay.js`'s `withProvider` helper, live since QN-024/QN-027) — so this
Skill now genuinely operates against whichever Provider it is told to
target. Default is `native` (unchanged from every prior iteration's
invocation); `quay task <cmd> --provider native --json` is confirmed
byte-identical to the pre-existing direct `quay-native task <cmd> --json`
invocation (see `experiments/quay-native-bootstrap/iterations/iteration-18.md`
Phase 3 for the verbatim regression proof) — no prior provenance record or
prior iteration's evidence is invalidated by this change. This is the
actual mechanism that makes `quay-github`'s own `status_skill_map`
declaration (this same task, Phase 4) honest rather than aspirational.

### Resolved gap: author->ready gate checked-state fix (iteration 8, QN-019)

**Fixed in iteration 8 (QN-019):** the `author->ready` gate (`store.js`'s
`check()` "todo" branch) previously tested the AC section only for
checkbox **presence**, not checked-**state** — a task could reach `ready`
with zero AC boxes actually checked, so long as at least one checkbox
line existed. This asymmetry with the `execute->done` gate (which already
required full-checked state) was found live by iteration 7's QN-017 (the
first genuine `needs-human` exercise): its author-gate unexpectedly passed
with 0/2 AC boxes checked, because the gate at that time only checked
presence. The gate now requires **all** AC checkboxes checked before
`author->ready` passes, with a distinct `"N/M AC checkboxes checked"`
reason string, matching `execute->done`'s existing reason format. See
`packages/quay-native/test/gate-checked-state.test.mjs` for dedicated
coverage, including the exact previously-passing/now-correctly-failing
case. **Note:** this closes the narrow "checked vs. merely present"
mechanical asymmetry only — the deeper "checkbox-count gameability" gap
(an author could check a box without independent verification the
underlying claim is true) remains open; the gate is still both contestant
and judge for this class of claim (G3).

### Resolved gap: decompose test exercised (iteration 27)

The decompose test (design SS4) was **stated** in step 3 but was not
exercised against a real >=2-deliverable case in iteration 1 — all three
tasks authored (QN-001, QN-003, QN-005) were single-leaf. This gap was
resolved in iteration 27 (QN-037, gh-10/gh-8/gh-9): a fresh, real,
two-child GitHub epic was authored via `quay:author`'s own Method against
the epic itself, with the decompose test genuinely satisfied (two
independently mergeable DESIGN.md doc-comment deliverables). See
`experiments/quay-native-bootstrap/iterations/iteration-27.md` SS5 and the
execute Skill's own resolved-gap record above for the full transcript.

### Sharpened finding: subagent-dispatch primitive (iteration 14)

**Update (iteration 14) — sharpened, not reversed: an async task-queue
dispatch primitive (`manda` `Dispatch`/`DispatchStatus`/`DispatchSettle`)
was confirmed live starting iteration 13 (DIR-004), but the genuine
synchronous fresh-context `Agent` spawn this Skill's `review-proposal`/
`review-plan` steps actually need for true independence was tested
directly in iteration 14 and did **not** complete (two independent
calls, both timed out after 30s waiting on the `agent.spawn`
capability — see `experiments/quay-native-bootstrap/directives/README.md`'s
iteration-14 update for the full account). The degraded, same-session
fallback documented above therefore remains this Skill's actual operating
mode as of iteration 14, not merely a historical iteration-1 finding that
might now be stale.

### Resolved gap: conditional manda-proxied Agent trials (experiment 2, iterations 4-7)

**Update (experiment 2, iteration 4) — conditional manda-proxied Agent
now demonstrated live, replacing the imprecise "no primitive" standing
note:** `mcp__plugin_manda_manda__Agent` was confirmed available as a
deferred tool in experiment 2's iteration 3 (ToolSearch). In iteration 4,
the manda daemon was confirmed reachable at the address in
`.manda/hub.addr` (port 46215 — not port 28912 as previously assumed; the
`/healthz` probe must target `.manda/hub.addr`'s actual address). A live
`manda monitor cord` broker was running (orchestrator session,
PID-confirmed via `ps aux`). A bounded trial call was issued:
`mcp__plugin_manda_manda__Agent(prompt="respond with the word PONG and
nothing else", to="cord", timeout=90)` — returned `{"output":"PONG"}` on
the first attempt, no timeout, no error. This is the first confirmed
successful synchronous Agent dispatch in the experiment's history.
**Constraints that remain:** (a) requires live daemon (`.manda/hub.addr`
reachable) AND a named broker/monitor armed on the target channel;
(b) DIR-020 hard rule — the calling session must differ from the session
that owns the broker; a self-deadlock results if the caller IS the broker.
**This is a conditional, not unconditional, primitive.** It does not close
the completeness gap (which requires a *reliable, unconditional* native
fresh-context spawn — the environmental gap's specific wording from
`v-meta-stall-analysis.md`). But it narrows the characterization from "no
primitive available" to "conditional manda-proxied Agent available when
daemon is live and a non-self broker is armed."

Three-tier reliability envelope confirmed (experiment 2, iterations 4-6):
- Trivial (PONG — single-word echo): SUCCESS 1/1, timeout=90s (iteration 4)
- Medium (single file read + structured JSON verdict): SUCCESS 1/1,
  timeout=150s (iteration 5)
- Complex (multi-file read + adversarial analysis + structured verdict):
  SUCCESS 1/1, timeout=150s (iteration 6)

All three tiers confirmed at their respective timeout windows. The
unconditional gap remains (daemon + non-self broker required). See
`experiments/quay-core-bootstrap/iterations/iteration-4.md` SS3,
`iteration-5.md` SS3a, `iteration-6.md` SS3a for full primary-source trial
records.

Timing-recording note (experiment 2, iteration 7 — effectiveness gap): The
V_meta effectiveness factor requires a scope-matched native-execution
timing comparison against stage-0 QN-006's baseline (author ~51s, execute
~2m59s — confirmed in `experiments/quay-native-bootstrap/timing/
iteration-0.log`). Future Skill-driven executions of a scope-matched task
(single source file, logic change, no network I/O) should record
wall-clock timing in the iteration report to enable this comparison. No
QC-* task has yet matched this shape (iterations 1-6 produced only
documentation and browser-test tasks). When one arises organically, timing
should be recorded explicitly — see
`experiments/quay-core-bootstrap/iterations/iteration-7.md` SS3 for the
full stall analysis.
# Skill extraction provenance

Extracted honesty notes (long prose paragraphs under "## Status (read first)") from
methodology skills, per the REFACTOR principle: honesty notes become YAML frontmatter
fields; iteration narratives move here.

## Skill extraction — methodology

### quay-native-methodology — Status extraction (iteration 88)

Originally the "## Status (read first)" section of
`.claude/skills/quay-native-methodology/SKILL.md`.

Source experiment `experiments/quay-native-bootstrap/` (protocol:
`docs/proposals/quay-bootstrap-experiment.md`) was **halted by its human owner at
iteration 88, NOT converged**. None of protocol SS7's 5 convergence criteria are met.
This extraction is a deliberate pre-stop deviation from normal post-convergence
extraction (see `docs/proposals/quay-core-bootstrap-experiment-v2.md` SS2.1), producing
an honest "what the methodology actually contained as of iteration 88" snapshot -- not
a polished retrospective, not a claim of success.

Final metrics (iteration 88, unchanged since -- see `reference/patterns.md` SSFinal State):

```
V_instance = 0.85 x 0.97 x 0.76 x 0.96 = 0.6016

V_meta     = 0.74 x 0.26 x 0.79 x 0.64 = 0.0973  (flat since iteration 66,
                                                    22+ consecutive iterations)

sigma_strict   = 62/73 = 0.8493
```

### quay-core-bootstrap-methodology — Status extraction (iteration 10)

Originally the "## Status (read first)" section of
`.claude/skills/quay-core-bootstrap-methodology/SKILL.md`.

Source experiment `experiments/quay-core-bootstrap/` (experiment 2 in this project's
BAIME history; protocol source cited in its own directives/provenance.md) **halted at
iteration 10 with practical convergence accepted -- NOT formally CONVERGED**.
Authoritative closing report: `experiments/quay-core-bootstrap/iterations/iteration-10.md`
SS11.

```
V_instance = core_abi_symmetry x web_ui_verification x action_delivery_mode x native_backlog_health
           = 1.0 x 1.0 x 1.0 x 1.0 = 1.0   (stable since iteration 3)

V_meta     = completeness x effectiveness x reusability x validation
           = 0.77 x 0.26 x 0.79 x 0.64 = 0.1012   (flat since iteration 6,
             5 consecutive iterations; mathematical ceiling = 0.26,
             criterion V_meta>=0.80 arithmetically unreachable)

sigma_QC       = 4/10 = 0.40   (own-experiment ledger; dominated by an
             inherited floor sigma_strict=0.8493 from experiment 1 -- see
             reference/sigma-inherited-floor-trap.md)
```

Formal convergence criteria met: 2 (all 4 Done-when clauses), 4 (G3 green,
vacuously), 5 (diminishing returns). NOT met: 1 (V_meta>=0.80, structurally
impossible), 3 (>=2 V_meta factors genuinely moved -- only 1 did). This is the same
HALT-not-CONVERGED shape as experiment 1, for structurally related reasons -- see
`reference/transfer-test-outcome.md`.

### quay-webui-bootstrap-methodology — Status extraction (iteration 5)

Originally the "## Status (read first)" section of
`.claude/skills/quay-webui-bootstrap-methodology/SKILL.md`.

Source experiment `experiments/quay-webui-bootstrap/` (experiment 3 in this project's
BAIME history) **halted at iteration 5 with practical convergence accepted -- NOT
formally CONVERGED**. Authoritative closing report:
`experiments/quay-webui-bootstrap/HALT-RECOMMENDATION.md` and
`experiments/quay-webui-bootstrap/iterations/iteration-5.md` SS11.

```
V_instance = ui_read_capability x visual_design_quality x verified_by_construction x backlog_health
           = 1.0 x 1.0 x 1.0 x 1.0 = 1.0   (reached at iteration 4)

V_meta     = completeness x effectiveness x reusability x validation
           = 0.77 x 0.26 x 0.79 x 0.778 = 0.123   (mathematical ceiling = 0.26;
             criterion V_meta>=0.80 arithmetically unreachable)

sigma_QW       = 7/9 = 0.778   (floor RESET to 0 at iteration 0 -- explicit design decision)
```

Criteria MET: 2 (all 4 Done-when clauses), 4 (G3 audit green), 5 (visual review
green), 6 (parallel-advancement stall guard). Criteria UNMET (structural): 1 (V_meta
ceiling blocks dual threshold), 3 (only 1 of >=2 required V_meta factors moved
numerically). Criterion 7 technically unmet by 1 iteration; underlying condition (no
productive work remaining) confirmed.

Inheritance chain: experiment 1 (quay-native-methodology) -> experiment 2
(quay-core-bootstrap-methodology) -> experiment 3 (this skill).
# Provenance — quay-perpetual-stream (Experiment 5)

Extracted iteration histories, gap-discovery narratives, and consolidation log from
executed documents (inherited-core.md, skills, OUTER-LOOP.md). Per DIR-080: formal
constraints live in the source documents; the narrative of HOW each constraint was
discovered, refined, and verified lives here.

## DoD clause discovery log

### Clause 0 (AC+DoD present)
- **Origin:** M25-dod-meta-enforcer / DIR-017 Step 1
- **Enforcement:** it0-dod-check.ts clause0
- **History:** checklist-form requirement added after M32-dod-escrow-testfloor

### Clause 1 (Adversarial audit)
- **Origin:** M10-audit-consolidation / DIR-007
- **Enforcement:** it0-dod-check.ts clause1
- **Key finding:** UNCONDITIONAL per milestone; no opt-out for "trivial" milestones

### Clause 2 (V_meta consolidation lag)
- **Origin:** M07-vmeta-gate
- **Enforcement:** vmeta-lag-check.ts, K=2 ALARM

### Clause 3 (Line budget)
- **Origin:** M06-sizing / DIR-012 item 2
- **Enforcement:** it0-ceiling-line-budget-check.sh

### Clause 4 (Design-only → -IMPL row)
- **Origin:** M21-impl-row-enforcement / DIR-016
- **Enforcement:** it0-impl-row-check.sh

### Clause 5 (No self-exemption)
- **Origin:** DIR-017 Step 1
- **Enforcement:** it0-dod-check.ts clause5 (discipline, not mechanically verifiable)

### Clause 6 (Escrow Δv)
- **Origin:** M32-dod-escrow-testfloor
- **Enforcement:** it0-dod-check.ts clause6

### Clause 7 (Product-work test floor)
- **Origin:** M32-dod-escrow-testfloor
- **Enforcement:** it0-dod-check.ts clause7

### Clause 8 (Task canonical-lifecycle-record)
- **Origin:** M24-task-backlog-projection-impl
- **Enforcement:** it0-dod-check.ts clause8

### Clause 9 (SPLIT-OR-COMMIT)
- **Origin:** DIR-026
- **Enforcement:** it0-split-or-commit-check.ts + quay gate --gate split-or-commit

### Clause 10 (Tree hygiene)
- **Origin:** M08-merge-recover
- **Enforcement:** tree-hygiene-check.sh

### Clause 11 (Worktree branch hygiene)
- **Origin:** DIR-044
- **Enforcement:** worktree-branch-hygiene-check.sh

### Clause 12 (Audit independence)
- **Origin:** M10-audit-consolidation / DIR-007
- **Enforcement:** audit-independence-check.sh

## Lesson recorded (DIR-013 / M19)
Concurrent human/loop edits to the same file — auto-resolved merge (989e0cd) took one
side's body wholesale, leaving dangling cross-references. Constraint: no blanket
--ours/--theirs merge; post-merge cross-reference sweep required.

## Skill extraction log
See individual skill directories under .claude/skills/ and plugin/skills/ for
current state. Historical iteration narratives (Gaps sections) moved here per DIR-080.

## Drain standing methodology (extracted from OUTER-LOOP.md, DIR-071 tightening 2026-07-25)

The DRAIN methodology was formerly inline in OUTER-LOOP.md step 0 and later a
standalone section. Per DIR-071, the `/drain-directives` workflow
(`.claude/workflows/drain-directives.js`) is now the single source — OUTER-LOOP.md
references it, never re-derives the steps (ADR-004).

**Disposition lifecycle:** Each pending directive (`label:directive`, `extra.dirStatus:
pending`) is dispositioned at the milestone boundary:
- milestone-candidate — add `label:milestone-candidate`, set `extra.dirStatus: applied`
- standing-rule amendment — `inherited-core.md` or `dashboard.md` control limits
- out-of-cycle action — VT chart transition, HALT

The disposition is recorded on the SAME task — set `extra.dirStatus` (`applied` /
`deferred` / `rejected`) and append a `## DRAIN disposition` section to the task body.
`/drain-directives` mechanizes the milestone-candidate path; human-steered or special
dispositions remain manual.

**Where async human steering enters:** at the boundary (step 0), never mid-milestone
(protocol §4.7). `/quay-directive` creates directive tasks directly (task-canonical,
DIR-028); there is no file-vs-task reconciliation to run.

**Master-direct (DIR-027):** The loop runs DIRECTLY on `master`. There is no driver
branch. Human commits land on `master`; the loop's own commit stream (charter authoring,
iteration worktree merges, ABSORB) also lands on `master`. DIR-027 retired DIR-018's
driver-branch isolation after it proved to relocate rather than prevent the race under
heavy human steering (see DIR-027 Finding).

**Human-steering hygiene (DIR-027 item 5):** When the loop is running, a human edit
should either pause the loop (`touch experiments/quay-perpetual-stream/.halt`, drained
at the next boundary) OR be made in a private worktree off `master` and folded in at a
clean window — never race the loop on `master`.

**No-silent-drop reconciliation-note requirement (DIR-013/DIR-018 item 3):** Any real
per-file conflict during a merge MUST be resolved by reading BOTH sides' actual content —
never a blanket `git checkout --ours`/`--theirs` wholesale. Record a short reconciliation
note (which file, what each side had, what was kept/merged and why) in the relevant log
entry.
