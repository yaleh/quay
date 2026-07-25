# Inherited Core (Tier-B pinned methodology) -- quay-perpetual-stream (Experiment 5)

Reusable inner methodology every milestone charter inherits by reference. Charter Tier-A pins a
path + git SHA to this file; NOT inlined per iteration. Consolidation (S4.2) grows this file:
cross-domain-confirmed adaptations merged here; delta citations retired at phi-confirmed reuse.

## Spec (CRYST-D3 S9, 2026-07-24)

```
HumanSteered :: Task -> Bool                               -- 3-clause classifier (DIR-062)
  = driverFileEdit OR missionRedirection OR unauthorizedWorkspace
  exec: human-steered-classify.ts (DIR-062-A); label:human-steered = override

Deliverable :: Task -> yes|no                               -- (bing) classification (DIR-066)
  = YES iff output consumed OUTSIDE loop; ambiguous -> NO
  exec: composeShortlist :: Candidate[] x streak -> Shortlist (deliverable-governor.ts)

Select :: Board -> Task                                     -- OUTER-LOOP step 1
  exclude HumanSteered; D-quota (DIR-066); >=1 explore/5 (explore-exploit-cadence.ts)
  value-typed ledger ranking (capability-growth > governance-integrity > instrument-correction > ...)
  SPLIT-OR-COMMIT (DIR-026): completable-in-one -> select; else split first
  schema stamp: extra.schema:"v1" + Proposal + Plan + AC + DoD (task-schema-check.sh)

DoD :: Task x Charter x Evidence -> {PASS, FAIL}            -- 13 clauses (0-12)
  Clause 0: AC+DoD present, checklist-form, boxes unchecked at SELECT -> ticked ONLY by Audit
  Clause 1: adversarial acceptance audit (REFUTE-first, UNCONDITIONAL per milestone)
  Clause 2: V_meta consolidation-lag (vmeta-lag-check.ts, K=2 ALARM)
  Clause 3: line-budget <=2000 (it0-ceiling-line-budget-check.sh)
  Clause 4: design-only -> mandatory -IMPL row (it0-impl-row-check.sh)
  Clause 5: no-self-exemption
  Clause 6: escrow-Delta-v; Clause 7: product-work test-floor
  Clause 8: task canonical-lifecycle-record
  Clause 9: SPLIT-OR-COMMIT / needs-human legitimacy (external only)
  Clause 10: tree-hygiene; Clause 11: worktree-branch-hygiene; Clause 12: audit-independence
  MECHANICAL: it0-dod-check.ts + quay gate (QENG engine) -- the SINGLE executable source

Class-Route :: Task -> development | methodology            -- DIR-014 two-class policy
  development-class -> proposal->plan pipeline (quay-task-to-plan) before build
  methodology-class -> dual-iteration (iteration-0 builds, iteration-1 re-derives)

Terminate :: Milestone[] -> {CONTINUE, TERMINATION-DUE}     -- S3.2
  Done-when-complete OR Delta-V<0.02 K=2 (termination-delta-v-check.ts)
    OR ceiling->redesign OR budget~10 AND NOT climbing OR external-HALT
```

## Kit version + single-source convention :: KitIdentity

```
kitCanonical :: = this file                          -- DIR-035-D, ADR-013 Decision item 3
kitVersion   :: = "v1"
kitSha       :: = "b17caab"                          -- DIR-035-D/M52: zero live duplication

singleSource :: Experiment -> Bool
singleSource(e) = reference(e, this, BY_PATH)        -- "../quay-perpetual-stream/inherited-core.md"
                ∧ record(e.instanceStateDoc, kitVersion, kitSha)
                ∧ ¬fork(this) ∧ ¬editCopy(this)
-- new experiment MUST: (1) reference this kit BY PATH, (2) record version+pinned SHA
-- in its instance-state doc, (3) carry only its own mutable instance state
```

## Standing invariants :: Gate -> Bool

```
enforcementWithDesign :: Rule -> Bool                 -- ADR-011
enforcementWithDesign(r) = land(gate(r) ∨ check(r), SAME_MILESTONE(r))
                         ∧ fixtureProves(r) ∧ ¬phased(r)
exec: Clause 5 (no-self-exemption), DoD real-landing bar, B7 load-bearing-test-gate
```

## Extracted skills :: [SkillPath]

```
skills :: [SkillPath] = [
  ".claude/skills/quay-native-methodology/"           -- gate mechanics, directive lifecycle, G3 audit
  ".claude/skills/quay-core-bootstrap-methodology/"   -- delta: manda dispatch, sigma-floor trap, V_meta ceiling
  ".claude/skills/quay-webui-bootstrap-methodology/"  -- delta: S0c visual review, sigma floor-RESET, dual-viewport
]
-- All three phi edges now operational sections below (M10). For any topic, cite sections below, not skills.
```

## exp4 artifacts (inherited) + pinned gate source :: InheritedAssets

Pinned gate source (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` HARD GATES block):
charter MUST copy this byte-for-byte; hash check asserts no paraphrase (DIR-009). Gate transclusion
+ hash check per invariant 3 -- the hash IS the enforcement; the byte-for-byte copy is invariant
across all charters.

```
inheritedAssets :: [Asset] = [
  "experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md"   -- HARD GATES block (verbatim transclusion source)
  "experiments/quay-continuous-bootstrap/VMETAFORMULA.md"        -- DIR-008 V_meta redesign
  "experiments/quay-continuous-bootstrap/directives/archive/DIR-009-*.md"
]
```

---

## domainMisfit :: Mechanism[] x DoneWhen[] -> Result

```
data Result = ok(carry: Mechanism) | ceilingTrigger

domainMisfit(mechanisms, doneWhen) =
  let existing = enumerate(doneWhen.verificationMechanisms) in
  if existing = ∅ then error("fix Done-when evidence plan first")
  else let independent = filter(¬selfReferential, existing) in
    if independent ≠ ∅ then ok(head(independent))
    else match constructIndependent(mechanisms) with
      | Some(m') -> ok(m') | None -> ceilingTrigger

selfReferential :: Mechanism -> Bool
selfReferential(m) = sameProcess(m.producer, m.verifier)
                   ∧ ¬secondObserver(m) ∧ ¬separateEnvironment(m)
-- local node --test by same iteration -> selfReferential; CI triggered externally -> ¬selfReferential

constructIndependent(ms) = reuseExisting(ms, differentActorOrEnv) <|> buildMinimalIndependent(ms)
-- prefer: (a) reuse out-of-band from DIFFERENT actor/env; (b) construct minimal new one that can FAIL independently
```

Same mechanism serves BOTH it0 declaration AND iteration-time verification. Divergence -> adaptation-log finding.
`exec:` `OUTER-LOOP.md` S4.4d systematic-explore it0 checks (domain-misfit audit-channel).

---

## milestoneSize :: Charter -> SizeVerdict

```
data SizeVerdict = UNDER_SIZED | CORRECTLY_SIZED | OVER_SIZED

-- CORRECTLY_SIZED: smallest scope carrying coherent value step AND fitting build+verify cost.
-- iteration-0 lands ALL Done-when in one pass; iteration-1 purely re-derives/re-verifies.

milestoneSize(c) = case applyGauge(c.iteration1) of
  | NoRealWork          -> UNDER_SIZED     -- re-runs same checks on same artifacts, nothing new
  | NewBuildForced      -> OVER_SIZED      -- forced into new build work or mid-milestone re-scope
  | IndependentRederive -> CORRECTLY_SIZED -- real independent re-derivation, catches things

applyGauge(i1) = freshCheckout(i1) ∧ rerunFromScratch(i1) ∧ handRecompute(i1) ∧ spotCheckCitations(i1)
```

Ceiling expansion (M18, DIR-012 item 2 -- amends, does not replace):
```
ceiling(s) = s.milestone.lines ≤ 2000 ∧ s.phase.lines ≤ 500 ∧ s.stage.lines ≤ 200 ∧ s.hasPhasePlan
-- ceiling safe ONLY when decomposed; ceiling and phase/stage plan ship TOGETHER
-- verify-iteration size gauge applies per-phase/stage under ceiling regime
```

`exec:` `scripts/it0-ceiling-line-budget-check.sh` (OUTER-LOOP step 1 plan-time gate).

---

## valueType :: Candidate -> ValueType

```
data ValueType = capabilityGrowth | discovery | instrumentCorrection | riskOption | governanceIntegrity

valueType(c) = match c.primaryCharacteristic with
  | ClosesRealCapabilityGap(existingVTChart)  -> capabilityGrowth    -- only type VT Delta-v_hat prices directly
  | FindsUnknownGap(viaIndependentAudit)       -> discovery           -- value is NEW information
  | FixesStandingMeasurementError              -> instrumentCorrection -- often VT-negative, high real value
  | ReducesForwardRisk ∨ PreservesOptionality  -> riskOption          -- preserves future optionality
  | EnsuresControlMechanismIntegrity           -> governanceIntegrity -- ensures control mechanisms actually work

governanceHardFloor(c) = if c.valueType ∈ {governanceIntegrity, instrumentCorrection}
                           ∧ ¬completeScope(c) then REJECT_OR_RESIZE   -- never dispatch partial
                         else ACCEPT                                   -- (DIR-002/DIR-006 lesson)

rankCandidates(cs) = sortBy(cs, priority ∘ valueType)
  where priority(governanceIntegrity)=5; priority(instrumentCorrection)=4
        priority(capabilityGrowth)=3; priority(discovery)=2; priority(riskOption)=1
-- VT Delta-v_hat is ONE input among several; never the sole ranker
```

`exec:` `composeShortlist` (deliverable-governor.ts); value-typed ranking in SELECT logic.

---

## classRoute :: Task -> Class

```
data Class = development | methodology           -- DIR-014 two-class diversity policy

classRoute(t) = match t.deliverableType with
  | WorkingCode   -> development  | DocArtifact -> methodology

developmentDispatch(t) = proposalPlanPipeline(t)  -- proposal->plan (quay-task-to-plan) BEFORE build
                                                  -- MUST: N-independent proposals + adjudication upstream
                                                  -- -> single implementation -> light tail self-check
                                                  -- NOT optional per DIR-014 items 2/3

methodologyDispatch(t) = dualIteration(t)         -- iteration-0 builds, iteration-1 re-derives
                                                  -- whole-milestone independent re-derivation, UNCHANGED
```

`exec:` `OUTER-LOOP.md` step 5a (mandatory dispatch for development-class via quay-task-to-plan).
A development-class milestone running old dual-iteration instead -> policy/DoD violation.

---

## webUiEvidence :: EvidenceClaim x IterationReport -> Verdict

```
data Verdict = PASS | FAIL

webUiEvidence(claim, report) = ∀vp ∈ claim.viewports:
  hasNavigationCall(report, claim.pageUrl, vp)                       -- (1) navigation to page
  ∧ hasArtifact(report, vp, screenshot ∨ snapshot)                   -- (2) screenshot/snapshot per vp
  ∧ toolFamily ∈ {mcp__playwright__browser_*, mcp__chrome-devtools__*}  -- literal tool-call trace

dualViewport = [{w:1280,h:800,type:desktop}, {w:390,h:844,dpr:3,touch:true,type:mobile}]
-- page/flow NOT credited until BOTH viewports covered

curlValidity(e) = match e with
  | HttpStatusCheck -> VALID      -- liveness/reachability HARD GATES only
  | RenderingClaim  -> INVALID    -- never for rendering/interaction verification
```

`exec:` Scripted grep for `mcp__playwright__browser_*` / `mcp__chrome-devtools__*` in iteration reports.
`OUTER-LOOP.md` step 3 requires this evidence rule in charter Done-when clause text.

---

## adversarialAudit :: Milestone x AuditAgent -> AuditVerdict

```
data AuditVerdict = REFUTED(claim: ClaimId) | CONCERNS | NO_REFUTATION_FOUND

adversarialAudit(m, agent) =                            -- UNCONDITIONAL per milestone
  let ctx = {m.charter, m.iteration[0..1].reports, this} in
  let verdict = dispatch(agent, ctx, refutePrompt, background) in
  record(verdict, "milestones/M{m.id}/audits/iteration-{n}-adversarial-audit.md")

refutePrompt :: = "Find fault with this milestone's Done-when claims and VT Delta-v:
  (a) claims with no pasted evidence, (b) evidence not supporting claim,
  (c) arithmetic not recomputing, (d) VT deltas mismatched without stated reason,
  (e) scope creep or self-exemption without outer-loop sign-off.
  Verdict: REFUTED (name claim), CONCERNS, or NO REFUTATION FOUND."

-- Who: OUTER LOOP (ABSORB step 6), never inner iterations
-- How: fresh-context generic subagent, run_in_background=true, reading ONLY charter+reports+this file
-- REFUTED blocks: VT-curve append / Done-when completion until corrected

sessionIdInject(d) = orchestratorRecords(d.agentId)
                   ∧ writeArtifactTop("Audit session id: {d.agentId}")
-- orchestrator asserts session id NOT subagent self-report (DIR-034/M115 fix)
-- audit-independence-check.ts parses this; corroborates against dispatch-record (Clause 12)
```

`exec:` `OUTER-LOOP.md` step 6 (adversarial-audit gate); `scripts/audit-independence-check.ts` (Clause 12).

---

## sigmaFloor :: Baseline[] -> Disposition

```
data Disposition = RESET | CARRY_FORWARD(confidence: Confidence)

sigmaFloor(bs) = ∀b ∈ bs: {nameExplicitly(b); precompute(b); match choose(b) with
  | RESET         -> RESET                                -- new scope's ledger stands alone
  | CARRY_FORWARD -> CARRY_FORWARD(confidenceBasis(b))}    -- state WHY trusted; if wrong -> instrument-correction
-- Design-time check (chart origin/transition). Do arithmetic before committing.

carryForwardPosture(n) = if n.origin.experiment ≠ this.experiment ∨ n.origin.chart ≠ this.chart
  then LOW_CONFIDENCE else n.statedConfidence
-- presumptively LOW until independently re-verified by this experiment's own live evidence
```

`exec:` Design-time check (not runtime script). `dashboard.md` Log records disposition.

---

## mandaDispatch :: Context x CallType -> Safety

```
data Safety = BLOCKING | SAFE

mandaDispatch(ctx, call) =
  -- (1) DIR-020 self-deadlock: synchronous call MUST NOT share session with broker monitor owner
  ¬sameSession(ctx.caller, ctx.brokerMonitorOwner)

  ∧ -- (2) DIR-015/016/024 background-dispatch: every point on nested-dispatch path -> background
  ∀p ∈ call.nestedDispatchPath: p.mode = background

  ∧ -- (3) Scope: synchronous, result-dependent/nested paths ONLY.
  --     Fire-and-forget (manda-dispatch submit ... --async) is OUTSIDE scope entirely.
  isSynchronousNested(call)
```

`exec:` Structural invariant (no runtime check). Grep this section before re-deriving
manda/G3/dispatch rules in a new charter or proposal.

---

## humanSteered :: Task -> Bool

```
-- DIR-062, 2026-07-23. Excluded from autonomous SELECT iff ANY clause fires.

humanSteered(t) = driverFileEdit(t) ∨ missionRedirection(t) ∨ unauthorizedWorkspace(t)

driverFileEdit(t) = ∃f ∈ t.touchedFiles: basename(f) ∈ {"OUTER-LOOP.md", "inherited-core.md"}
                  ∨ isUnder(f, ".claude/skills/")
-- must be authored under .halt + golden-replay + independent adversarial audit (DIR-027)

missionRedirection(t) = t.extra.missionRedirection = true
-- human judgment: redefines VT surfaces, opens new chart, retires standing hypothesis,
-- or redirects value-typed ledger priorities

unauthorizedWorkspace(t) = ∃w ∈ t.drivenWorkspaces:
  ¬isCovered(w, drivableWorkspacesYml)            -- drivable-workspace-check.ts (fail-closed)

-- label:human-steered = manual override/escape hatch (backstop, not primary)
```

`exec:` `scripts/human-steered-classify.ts` (DIR-062-A, M125) -- SINGLE executable source:
```
classify({touchedFiles, missionRedirection, drivenWorkspaces, registry}) =
  { humanSteered, clauses: {driverFileEdit, missionRedirection, unauthorizedWorkspace},
    unauthorizedWorkspaces }
```
The script IS the definition when prose and script disagree (ADR-004: hard over soft).

---

## humanReviewCadence :: State -> CadenceVerdict

```
data CadenceVerdict = OK | ALARM(gap: int, threshold: int)

humanReviewCadence(s) =
  let gap = s.milestoneCounter - s.lastHumanDirectiveMilestone in  -- DIR-003 does NOT reset
  if gap ≥ 5 then ALARM(gap, 5) else OK                            -- K=5 soft-alarm
-- NON-BLOCKING: does NOT block ABSORB or milestone_counter++; human directive is async

checkpointVisibility(s) = if s.milestoneCounter % 5 = 0 then include(s.cadence, snapshot) else skip
```

`exec:` `OUTER-LOOP.md` step 8 (checkpoint snapshot); `dashboard.md` Human-review cadence health track.

---

## portableMetadata :: Fact -> LocationRule

```
data LocationRule = BODY_PRIMARY | EXTRA_MIRROR
-- body (markdown) and labels are PORTABLE across all Provider ABI; extra{} is native-only convenience

portableMetadata(f) = {authoritative: f.body.structuredMarkdownSection,   -- MUST live in body
                       mirror: f.extra if writable(f.extra) else null}    -- MAY mirror in extra{}

portabilityConstraint(f) = ¬soleSource(f, extraOnly)   -- extra{} MUST NOT be sole copy
-- If Provider hard-errors on writing extra{}, body copy alone must remain sufficient.
```

`exec:` Design-time convention (no runtime check); adversarial audit inspects body vs extra{}.

---

## designOnlyImplRow :: Milestone -> ImplVerdict

```
data ImplVerdict = IMPL_ROW_REQUIRED | N_A

designOnlyMilestone(m) = m.deliverableType = "design"                      -- (a) explicit
                       ∨ hasSection(m.task, /future implementing milestone/) -- (b) deferred impl

designOnlyImplRow(m) = if designOnlyMilestone(m) then
    let rowId = "{m.name}-IMPL" in
    if exists(rowId, backlog) ∧ status(rowId) ≠ DONE then IMPL_ROW_REQUIRED
    else if ¬exists(rowId, backlog) then error("HARD BLOCK: no -IMPL row in backlog")
    else IMPL_ROW_REQUIRED
  else N_A
-- HARD BLOCK, not advisory. Applied at ABSORB (step 6), before milestone_counter++.
-- Same placement as V_meta consolidation-lag and adversarial-audit gates.
```

`exec:` `scripts/it0-impl-row-check.sh <milestone-id> [backlog-file]` (exit 0=PASS, 1=FAIL, 2=error).

---

## Definition of DoD :: DoD

```
-- SINGLE executable source: scripts/it0-dod-check.ts (all 13 clauses).
-- Wired into OUTER-LOOP.md step 6 as HARD BLOCK on step 7's milestone_counter++.
-- Fixture-pinned: scripts/dod-fixture-selfcheck.sh. QENG gate engine wraps it.
-- AC/DoD live in the TASK, not the charter (DIR-020/M34). Checklist form (- [ ] / - [x]) MANDATED.

MECHANICALLY_UNCONDITIONAL_CLAUSES = ["line-budget","impl-row","escrow-delta-v","test-floor"]

clause0 :: Task -> {PASS, FAIL}
clause0(t) = hasSection(t.body, "## Acceptance Criteria", nonEmpty)
           ∧ hasSection(t.body, "## Definition of Done", nonEmpty)
           ∧ count(t.body.acChecklist, unchecked) = 0                    -- no - [ ] remains; UNCONDITIONAL

clause1 :: Task x AuditReport -> {PASS, FAIL}                            -- UNCONDITIONAL
clause1(t, report) = confirmedAllAC(t, report)                           -- each AC: concrete artifact cited
                   ∧ satisfiedDoD(t, report) ∧ report.scriptExit = 0     -- it0-dod-check.sh exited 0
                   ∧ auditTickedChecklist(t, report)                     -- - [x] written
-- FAIL: REFUTED -- names specific claim, HARD-blocks until corrected and re-audited

clause2 :: LedgerState -> {PASS, FAIL}
clause2(state) = ∀r ∈ state.rows where r.status = confirmed ∧ ¬r.consolidated:
  r.milestonesSinceConfirmed ≤ 2                                         -- K=2; vmeta-lag-check.ts IS definition

clause3 :: Charter -> {PASS, FAIL}                                       -- Trigger: SELECT, NOT ABSORB
clause3(c) = c.scope.lines ≤ smallMilestoneNorm
           ∨ (c.scope.lines > smallMilestoneNorm ∧ c.hasPhaseStagePlan)
exec: scripts/it0-ceiling-line-budget-check.sh

clause4 :: Milestone -> {PASS, FAIL, N_A}
clause4(m) = if designOnlyMilestone(m) then (if implRowExists(m, backlog) then PASS else FAIL) else N_A
exec: scripts/it0-impl-row-check.sh

clause5 :: Charter x ABSORBEntry -> {PASS, FAIL}                         -- UNCONDITIONAL
clause5(c, entry) = ∀gate ∈ allDoDGates:
  wasEvaluatedDispositioned(gate, entry)                                 -- gate EVALUATED, outcome recorded
  ∨ hasWaiver(entry, gate, "WAIVER: <ms> | <clause> | <reason> | <date>")
-- distinguishing test: gate dispositioned (legitimate non-firing) vs applicability argued away in prose -> FAIL

clause6 :: Milestone x ABSORBEntry -> {PASS, FAIL, N_A}
clause6(m, entry) = if designOnlyMilestone(m) ∧ entry.claimedDeltaV ≠ 0
  then (if hasEscrowQualifier(entry.deltaVClaim) then PASS else FAIL)    -- explicit escrow wording required
  else N_A                                                               -- de-escrow: -IMPL row's future ABSORB

clause7 :: Milestone x ABSORBEntry -> {PASS, FAIL, N_A}
clause7(m, entry) = if m.surfaceLabel ∈ productTouching ∨ m.surfaceLabel = null  -- null -> fail-closed
  then ( hasCoverageEvidence(entry, ≥80pct, citedTestRun)                -- (a)
       ∨ hasWaiver(entry, "test-floor") )                                -- (b)
  else N_A                                                               -- sentence-scoped negation (M32 fix)

clause8 :: Task -> {PASS, FAIL, N_A}                                     -- FORWARD-ONLY: N >= 40
clause8(t) = if hasMilestoneLabel(t, N) ∧ N ≥ 40
  then hasProposal(t, nonEmpty, ¬placeholder, INLINE)
       ∧ hasPlan(t, resolvablePath ∨ "N/A -- <reason>")                  -- ## Proposal + ## Plan
  else N_A
exec: fixtures in dod-fixture-selfcheck.sh

clause9 :: ABSORBEntry -> {PASS, FAIL, N_A}
clause9(entry) = match entry.outcome with
  | NEEDS_HUMAN -> isExternal(entry.reason)                              -- external only (outage,credential,upstream)
                                                                         -- in-project factors (architecture,complexity) -> FAIL
  | DONE        -> clause0 governs
  | _           -> N_A
exec: fixtures/{needs-human-external-stub, needs-human-internal-stub}.md

clause10 :: WorktreeState -> {PASS, FAIL}                                -- UNCONDITIONAL
clause10(state) = cleanWorkingTree(state) ∧ ¬hasUntrackedArtifacts(state)
exec: scripts/tree-hygiene-check.sh

clause11 :: WorktreeState -> {PASS, FAIL}                                -- UNCONDITIONAL
clause11(state) = ¬hasOrphanWorktrees(state) ∧ ¬hasStaleBranches(state)
exec: scripts/worktree-branch-hygiene-check.sh

clause12 :: ABSORBEntry -> {PASS, FAIL, N_A}
clause12(entry) = if hasSection(entry, "## Audit-independence check")
  then verified(entry.artifactPath, entry.orchestratorId, audit-independence-check.ts)
  else N_A                                                               -- section absent -> documented no-op
```

---

## DeviationRecord :: type DeviationRecord

```
data DeviationRecord = {
  id              :: String           -- "DEV-{NN}", chronological by discovery date
  title           :: String           -- one-line description
  originMilestone :: MilestoneId      -- milestone where deviation is found IN
  foundAt         :: MilestoneId      -- milestone/date actually discovered
  caughtBy        :: "machine" | "human"
    -- machine = it0-* check or adversarial-audit verdict
    -- human   = directive authored/asserted by human
  status          :: "found" | "fixed" | "verified-eliminated"
    -- verified-eliminated = fix confirmed by EXTERNAL evidence
  age             :: Int              -- milestone-count spans (not calendar dates)
}

-- Qualifying: concrete, cite-able instance where delivered state departed from charter/task
-- claims or DoD clause requirement. Excluded: CONCERNS-level findings fixed in same ABSORB.

forwardUpdate(records, agent) = -- Clause-1 audit subagent is SOLE standing writer
                                -- Dispatch: OUTER-LOOP.md step 6, after checklist write-back

statusPromotion(r) = if r.status = fixed ∧ externalEvidence(r.id)
  then r{status = verified-eliminated} else r
-- Promotion checked at EVERY subsequent ABSORB.
```

`exec:` Clause 1 audit subagent write-back; data in `dashboard.md` homeostatic-variables section.
Same update cadence as DoD-clause evaluation -- NOT a distinct cadence.

---

## Provenance

Historical narratives (discovery stories, worked examples, validation passes, iteration accounts,
directive-finding histories, full DoD clause evolution record) live in
`experiments/quay-perpetual-stream/provenance.md`. This file carries only formal constraints and
operational declarations. For the discovery and refinement history of any constraint herein, see
the corresponding section in provenance.md.
