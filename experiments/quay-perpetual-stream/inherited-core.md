# Inherited Core (Tier-B pinned methodology) -- quay-perpetual-stream (Experiment 5)

The reusable inner methodology every milestone charter inherits by reference (charter Tier-A pins a
path + git SHA to this file; it is NOT inlined per iteration). Consolidation (S4.2) grows this file:
when a milestone adaptation is reused unchanged by a later different-domain milestone (phi confirmed),
merge it here and retire its delta citation.

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

## Kit version + single-source convention (DIR-035-D, ADR-013 Decision item 3)

**This file IS the one canonical "continuous-development-with-Claude-Code" methodology kit.**
Kit version: `v1`. Last consolidated at git SHA `b17caab` (DIR-035-D/M52 audit: zero live duplication).

**Single-source rule:** a new experiment MUST NOT copy this file's content. It must:
1. Reference this kit BY PATH (`../quay-perpetual-stream/inherited-core.md`).
2. Record the **kit version + git SHA it is pinned to** in its own instance-state doc.
3. Carry ONLY its own mutable instance state -- never a forked/edited copy of this file.

## Standing invariants (govern EVERY milestone)

**Enforcement lands WITH design (ADR-011).** A new rule / DoD-clause / method-step is NOT "done"
unless its executable enforcement (a gate/check/code) AND a fixture proving it land in the SAME
milestone. Phased "design now, wire the enforcement later" is prohibited. Partially enforced today by
Clause 5 (no-self-exemption), the DoD real-landing bar, and the B7 load-bearing-test-gate.

## Extracted skills (delta chain -- read in order)

1. `.claude/skills/quay-native-methodology/` -- gate mechanics, directive lifecycle, G3 audit, provenance/sigma ledger.
2. `.claude/skills/quay-core-bootstrap-methodology/` -- delta: manda dispatch, G3-dispatch, sigma-inherited-floor trap, V_meta ceiling.
3. `.claude/skills/quay-webui-bootstrap-methodology/` -- delta: S0c visual review, sigma floor-RESET, dual-viewport, domain-misfit.

All three phi edges are now operational sections below (M10, m10). Delta chain is NOT retired.

## exp4 artifacts (inherited) + exp5-native additions + pinned gate source

- `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` -- HARD GATES block (verbatim charter transclusion source); S0c continuous simulated-user; non-blocking dispatch.
- `experiments/quay-continuous-bootstrap/VMETAFORMULA.md` -- DIR-008 V_meta redesign.
- `experiments/quay-continuous-bootstrap/directives/archive/DIR-009-*.md` -- gate-dilution failure + mechanically-self-proving-gate fix.
- Charter three-tier contract (S3.1) + gate transclusion + hash check. Inner termination five conditions (S3.2). Systematic-explore it0 checks (S4.4). Binary Done-when (S3.4).
- Pinned gate source: charter must copy ITERATION-PROMPTS.md HARD GATES block byte-for-byte; hash check asserts no paraphrase (DIR-009).

---

## domainMisfit :: DoneWhen[] x Mechanism[] -> {ok, ceilingTrigger}

Decision procedure applied at it0, BEFORE dispatch.

**Step 1 -- Name the domain's existing verification mechanism(s).** List every mechanism this
milestone's own Done-when clauses already require to demonstrate correctness. If empty, STOP -- fix
the Done-when evidence plan first.

**Step 2 -- Self-referential check.** Is any listed mechanism SELF-REFERENTIAL (the same
process/actor that produces the work also verifies it, with no independent second observer or
environment)? A local `node --test` run by the same iteration that wrote the code is NOT independent.
A CI job invoked by a real external trigger (tag push, PR event) in a separately-provisioned
environment IS independent, even if it runs "the same" test suite.

**Step 3 -- If no independent mechanism exists, the domain has a misfit and MUST add one, preferring:**
  a. **Reuse** an existing out-of-band mechanism from a DIFFERENT actor/environment.
  b. **Construct** a minimal new one that can FAIL independently.
  c. If neither is reachable, this IS a genuine ceiling (S3.2 condition 3) -- redesign scope.

**Step 4 -- Same mechanism serves BOTH it0 declaration AND iteration-time verification.** Divergence
must be logged as an adaptation-log finding.

`exec:` `OUTER-LOOP.md` S4.4d systematic-explore it0 checks (domain-misfit audit-channel).

---

## milestoneSize :: Charter -> {UNDER_SIZED, CORRECTLY_SIZED, OVER_SIZED}

**Size definition.** A correctly-sized milestone is: *the smallest scope that carries a coherent value
step AND fits the build+verify cost band* -- i.e. iteration-0 can land ALL of the charter's
Done-when clauses in one pass, and iteration-1 exists purely to independently re-derive/re-verify
iteration-0's own claims (fresh worktree, fresh checks, no new Done-when work required).

**Verify-iteration size gauge** (apply AFTER iteration-1, or prospectively at SELECT/charter-authoring
as a sanity check):

```
UNDER_SIZED:  Iteration-1 has nothing real to re-derive (re-runs same checks on same artifacts,
              finds nothing new).
              -> Should have been bundled or merged with a neighboring milestone.

OVER_SIZED:   Iteration-1 is forced into new build work, or mid-milestone re-scope happens.
              -> Should have been split at charter-authoring time along a completable seam.

CORRECTLY_SIZED: Iteration-1 does REAL independent work (fresh checkout, re-running checks from
              scratch, hand-recomputing arithmetic, spot-checking citations) and genuinely
              CATCHES something often enough to be worth the cost.
```

**Milestone ceiling expansion (M18, DIR-012 item 2 -- amends, does not replace, the above):**

```
milestone <= ~2000 lines   =  one whole plan (multiple phases)
   phase  <= ~500  lines
   stage  <= ~200  lines
```

The <=2000-line ceiling and the phase/stage plan requirement ship together -- a charter may not claim
the larger ceiling while skipping the decomposition. The verify-iteration size gauge above still
applies UNCHANGED, but per-phase/stage rather than per-milestone under this regime. The ceiling
expansion is safe ONLY when decomposed: the plan is what CONTAINS the risk.

`exec:` `scripts/it0-ceiling-line-budget-check.sh` (OUTER-LOOP step 1, plan-time gate).
Source: `docs/proposals/exp5-quay-task-proposal-plan-skill.md` S4.

---

## valueType :: Candidate -> {capabilityGrowth, discovery, instrumentCorrection, riskOption, governanceIntegrity}

VT (capability-growth score) prices only ONE kind of milestone value. Five types:

1. **capabilityGrowth** -- closes a real capability gap on an existing VT chart surface; the only type VT Delta-v_hat prices directly.
2. **discovery** -- finds previously-unknown gaps/errors via an independent audit channel; value is in NEW information.
3. **instrumentCorrection** -- fixes a standing error in the measurement/method itself; often VT-negative on paper while being high real value.
4. **riskOption** -- reduces a forward-looking risk or preserves future optionality without delivering present capability.
5. **governanceIntegrity** -- ensures the experiment's own control/decision mechanisms actually do what they claim, independent of any single milestone's product content.

**Governance/infra hard floor (SELECT-time check, mandatory):** a governance/infra candidate whose
proposed scope excludes its own enabling/enforcement half must be **rejected or resized at SELECT
time -- never dispatched partial.** (The DIR-002/DIR-006 lesson, generalized.)

**Ranking discipline:** VT Delta-v_hat is one input among several at SELECT, never the sole ranker.
A candidate with zero or negative VT Delta-v_hat but a governance-integrity or instrument-correction
value type can and should outrank a positive-VT capability-growth candidate when the non-VT risk is higher.

`exec:` composeShortlist (deliverable-governor.ts); value-typed ranking rules encoded in SELECT logic.

---

## classRoute :: Task -> development | methodology (DIR-014 two-class diversity policy)

Source: `docs/proposals/exp5-quay-task-proposal-plan-skill.md` S5.

| class | deliverable | diversity strategy |
|---|---|---|
| **methodology/design** | a design/doc artifact | **whole-milestone independent re-derivation, UNCHANGED** -- iteration-1 independently re-derives from a fresh worktree. |
| **development** | working code, <=~2000 lines | **MUST (DEFAULT, DIR-014 items 2/3 -- no longer discretionary)** run the proposal->plan pipeline: N-independent proposals + adjudication upstream -> single implementation -> light tail self-check (existing adversarial-audit gate downstream). |

`exec:` `OUTER-LOOP.md` step 5a (mandatory dispatch route for development-class milestones via
`quay-task-to-plan` skill). A development-class milestone that runs old whole-milestone dual-iteration
instead of the pipeline is a policy/DoD violation.

---

## webUiEvidence :: DoneWhenClause x IterationReport -> {PASS, FAIL}

Any Done-when clause claiming Web UI rendering/interaction/visual verification MUST be backed by literal `mcp__playwright__*` or `mcp__chrome-devtools__*` tool-call trace:

1. A **navigation** call to the actual page under test.
2. At least one **screenshot or DOM/accessibility snapshot** artifact per claimed viewport.
3. This trace must be present at **both configured viewports** (desktop + mobile) when dual-viewport coverage is claimed.

**`curl` is demoted, not banned.** `curl -s <url> -o /dev/null -w "%{http_code}"` remains valid for
**liveness/reachability HARD GATES only** -- never for rendering or interaction verification.

**Dual-viewport requirement:** desktop 1280x800/900 and mobile 390x844 (DPR x3, emulated touch). A
page/flow is not credited until both are covered.

`exec:` Scripted grep for `mcp__playwright__browser_*` / `mcp__chrome-devtools__*` tool-call strings
in iteration reports. Charter-authoring checklist: `OUTER-LOOP.md` step 3 requires this evidence rule
in the charter's own Done-when clause text.

---

## adversarialAudit :: Milestone x AuditAgent -> {REFUTED, CONCERNS, NO_REFUTATION_FOUND}

Out-of-band step the OUTER LOOP dispatches at ABSORB (step 6), charged to REFUTE a milestone's
Done-when claims and VT delta. UNCONDITIONAL per milestone (original cadence-rule conditions retained
only as escalation hints, not gate on whether audit runs).

**Dispatch procedure:**

1. **Who:** The outer loop (the session executing `OUTER-LOOP.md`), at ABSORB (step 6) -- never the inner milestone's own iterations.
2. **How:** A fresh-context generic `Explore`/`general-purpose` subagent, `run_in_background=true`, reading ONLY: (a) the milestone's charter (Tier-A), (b) iteration-0/iteration-1 reports (claims under audit), (c) this file (Tier-B) -- with a refutation-focused prompt:
   *"Find fault with this milestone's Done-when claims and VT Delta-v: (a) claims with no pasted evidence, (b) evidence that doesn't support the claim, (c) arithmetic that doesn't recompute, (d) VT deltas mismatched without stated reason, (e) scope creep or self-exemption without outer-loop sign-off. Verdict: REFUTED (name the claim), CONCERNS, or NO REFUTATION FOUND."*
3. **Output:** `milestones/M<NN>/audits/iteration-N-adversarial-audit.md` (`N` = milestone's own iteration count at ABSORB time).
4. **REFUTED blocks:** ABSORB VT-curve append / Done-when completion claim until the milestone record is corrected.
5. **Session-id injection:** The orchestrator records the returned dispatch `agentId` / task id in the dispatch-record file AND writes `Audit session id: <that id>` near the top of the audit artifact. `audit-independence-check.ts` parses this line and corroborates against the dispatch-record file (Clause 12).

`exec:` `OUTER-LOOP.md` step 6 (adversarial-audit gate); `scripts/audit-independence-check.ts` (Clause 12).

---

## sigmaFloor :: Baseline[] x Decision[] -> {RESET, CARRY_FORWARD}

Apply at design time (chart origin, or any chart transition):

1. **Name the inherited number(s) explicitly** -- every baseline/floor a new chart or experiment carries forward.
2. **For each, choose ONE, explicitly:**
   - **RESET to 0** -- the new scope's own ledger stands alone.
   - **CARRY FORWARD, with a stated confidence basis** -- state WHY the inherited number is trusted; if later found wrong, the correction is instrument-correction value, not a regression.
3. **Do the arithmetic before committing** -- do not discover infeasibility only after committing.

**Posture going forward:** any number carried forward from a DIFFERENT experiment or a prior chart is
presumptively CARRY-FORWARD-WITH-LOW-CONFIDENCE until independently re-verified by this experiment's
own live evidence.

`exec:` Design-time check (not a runtime script; M04/M08/M09 re-scoring passes provide de facto
re-verification). The VT audit in `dashboard.md`'s Log section records the disposition.

---

## mandaDispatch :: Context x CallType -> {BLOCKING, SAFE}

Source: DIR-020; extended by DIR-015/016/024.

1. **DIR-020 self-deadlock (structural rule):** the depth-1 `mcp__plugin_manda_manda__Agent`/`Dispatch` caller must NEVER be issued synchronously from the same session that owns the bound broker monitor for the target channel. A synchronous call blocks that session's own turn processing by construction.
2. **DIR-015/016/024 background-dispatch requirement:** EVERY point on a manda nested-dispatch path -- depth-1 caller, iteration dispatch, audit dispatch, broker-side spawn -- must be background (`run_in_background=true`). A synchronously-blocked session cannot service its own concurrent notifications.
3. **NOT a blanket ban.** Fire-and-forget dispatch (`manda-dispatch submit ... --async`, never waits on a result) is structurally OUTSIDE this rule's scope entirely and remains legitimate. The rule applies specifically to result-dependent/nested paths.

`exec:` Structural invariant (no runtime check); standing practice decision: grep this section before
re-deriving manda/G3/dispatch rules in a new charter or proposal.

---

## humanSteered :: Task -> Bool  (DIR-062, 2026-07-23)

A task is `human-steered` -- excluded from autonomous SELECT -- iff ANY of three clauses fires:

1. **Driver-self-rewrite (file-based).** Touches a DRIVER FILE: `OUTER-LOOP.md`,
   `inherited-core.md` (anywhere under `experiments/quay-perpetual-stream/`, matched by basename),
   or any file under `.claude/skills/`. A milestone editing the loop's own driver must be authored
   under `.halt` + golden-replay + independent adversarial audit (DIR-027 human-steering hygiene).

2. **Mission-redirection (declared).** Carries `extra.missionRedirection: true` -- a human judgment
   that this milestone changes the experiment's direction (redefines VT surfaces, opens a new chart,
   retires a standing hypothesis, or redirects value-typed ledger priorities).

3. **Unauthorized cross-workspace drive (registry-checked).** Drives a workspace NOT covered by
   `drivable-workspaces.yml` (`drivable-workspace-check.ts` -- fail-closed gate).

`label:human-steered` is a manual override/escape hatch (backstop, not primary mechanism).

`exec:` `scripts/human-steered-classify.ts` (DIR-062-A, M125) -- SINGLE executable source:
`classify({touchedFiles, missionRedirection, drivenWorkspaces, registry})` returns
`{humanSteered, clauses: {driverFileEdit, missionRedirection, unauthorizedWorkspace}, unauthorizedWorkspaces}`.
The script IS the definition when prose and script disagree (ADR-004: hard over soft).

---

## humanReviewCadence :: State -> {OK, ALARM(K=5)}

Standing rule (DIR-001 item 6, designed M15 from 11-directive sample):

1. **Compute `milestones-since-last-human-directive`** at every ABSORB as
   `milestone_counter(current, post-increment) - (milestone number at which the LAST human-initiated
   directive burst was drained from the async `/quay-directive` channel, pre-dispatch)`.
   DIR-003 (self-raised) does NOT reset this counter.

2. **Soft-alarm threshold: K=5.** Reuses the existing checkpoint cadence
   (`milestone_counter % 5 == 0`, `OUTER-LOOP.md` step 8).

3. **Explicitly non-blocking.** Crossing K=5 does NOT block ABSORB or `milestone_counter++` --
   a human directive is asynchronous and human-paced; the loop cannot manufacture one and must not
   wait for one (`OUTER-LOOP.md` header invariant).

4. **Checkpoint visibility:** at every checkpoint (`milestone_counter % 5 == 0`), the snapshot must
   include this track's current value.

`exec:` `OUTER-LOOP.md` step 8 (checkpoint snapshot includes this track); `dashboard.md` "Human-review
cadence" health track.

---

## portableMetadata :: Fact -> {bodyPrimary, extraMirror}

Source: `docs/proposals/exp5-cli-edit-parity.md` S3.2.

A quay task's `body` (markdown) and `labels` are **portable** across all Provider ABI implementations.
A task's `extra{}` map is **native-only convenience** -- it MUST NOT be relied upon as the sole copy
of any fact that needs to survive a Provider switch.

**Rule:** the authoritative, portable copy of provider-portable metadata MUST live in a structured
markdown section of the task `body`. `extra{}` MAY additionally carry the same fact as a
machine-readable, native-only mirror -- but if a Provider hard-errors on writing `extra`, the body
copy alone must remain sufficient.

**Corollary:** a design that needs `extra{}` as the ONLY place a fact is recorded has mis-designed a
provider-portability requirement.

`exec:` Design-time convention (no runtime check); enforced by code review / adversarial audit
inspection of task body vs extra{} for portability-required facts.

---

## designOnlyImplRow :: Milestone -> {IMPL_ROW_REQUIRED, N/A}

Source: DIR-016, resolved by M21-impl-row-enforcement.

**Definition -- "design-only milestone":** A milestone is design-only if EITHER: (a) its `backlog.md`
row states "design delivered"/"design-doc only" (or equivalent), OR (b) its deliverable includes a
"Done-when clauses a future implementing milestone would need" section.

**Mandatory action:** At ABSORB (`OUTER-LOOP.md` step 6), before Done-when clauses recorded as
complete or `milestone_counter++`, a design-only milestone's ABSORB **MUST** create a corresponding
selectable, non-DONE `<M-NAME>-IMPL` candidate row in `backlog.md`.

**HARD BLOCK, not advisory.** Same shape/placement as existing V_meta consolidation-lag gate and
adversarial-audit gate. Applies going forward from M21; retroactive sweep performed once at M21's
own ABSORB, not re-run automatically.

`exec:` `scripts/it0-impl-row-check.sh <milestone-id> [backlog-file]` -- exit 0=PASS, 1=FLAG/FAIL, 2=usage error.

---

## Definition of Done (M25-dod-meta-enforcer, extended M32/M40/M44/M47)

`exec:` `scripts/it0-dod-check.ts` (SINGLE executable source -- all 13 clauses), wired into
`OUTER-LOOP.md` step 6 as HARD BLOCK on step 7's `milestone_counter++`. Fixture-pinned by
`scripts/dod-fixture-selfcheck.sh`. QENG gate engine wraps it; the script IS the definition.

**AC/DoD live in the TASK, not the charter** (DIR-020/M34, 2026-07-19). AC and DoD are authored in
the milestone-candidate **task** body (`tasks/<task-id>.md`) as `## Acceptance Criteria` and
`## Definition of Done` -- the SINGLE canonical source. They are NEVER forked into the charter.
Checklist form (`- [ ]` / `- [x]`) MANDATED going forward; pre-existing prose-form tasks NOT
retroactively rewritten.

### Clause 0 -- AC + DoD present and well-formed in the task
`clause0 :: Task -> {PASS, FAIL}` UNCONDITIONAL. Task body has non-empty `## Acceptance Criteria` with >=1 concrete checkable item AND `## Definition of Done` referencing standard DoD. Checklist-form: NO unchecked boxes remain (each `- [ ]` is REFUTED-equivalent). FAIL: exit 1, HARD-blocks `milestone_counter++`.

### Clause 1 -- Per-milestone acceptance audit
`clause1 :: Task x AuditReport -> {PASS(cleared), FAIL(REFUTED)}` UNCONDITIONAL (original cadence conditions retained ONLY as escalation hints). Fresh-context out-of-band subagent confirms each AC item met (citing concrete artifact, not self-report), DoD satisfied, `it0-dod-check.sh` exited 0. Checklist write-back: audit ticks `- [x]` for confirmed items. FAIL: REFUTED -- names specific claim and why, HARD-blocks until corrected and re-audited.

### Clause 2 -- V_meta consolidation-lag gate
`clause2 :: LedgerState -> {PASS, FAIL}` Fires for every row in `v-meta-ledger.md` where `status=confirmed` AND NOT `consolidated`. `vmeta-lag-check.ts` computes `milestones-since-confirmed` vs K=2 threshold (that module IS the definition -- fail-closed). FAIL: any qualifying row exceeds K=2 without resolution.

### Clause 3 -- Line-budget gate
`clause3 :: Charter -> {PASS, FAIL}` Trigger: charter-authoring/plan time (OUTER-LOOP step 1, SELECT -- NOT at ABSORB). Charter scope within small-milestone norm OR over norm WITH phase/stage plan. FAIL: exit 1 (over norm, no plan). `exec:` `scripts/it0-ceiling-line-budget-check.sh`.

### Clause 4 -- Design-only-milestone impl-row gate
`clause4 :: Milestone -> {PASS, FAIL, N/A}` Trigger: milestone is design-only (per designOnlyImplRow above). Corresponding `-IMPL` candidate row exists in `backlog.md`. `exec:` `scripts/it0-impl-row-check.sh`.

### Clause 5 -- No-self-exemption meta-clause
`clause5 :: Charter x ABSORBEntry -> {PASS, FAIL}` UNCONDITIONAL (in `MECHANICALLY_UNCONDITIONAL_CLAUSES`). No charter/ABSORB self-exempts from a DoD clause without a WAIVER line (`WAIVER: <milestone-id> | <clause-name> | <reason> | <date>`) in `dashboard.md` Log. Distinguishing test: was the gate EVALUATED and DISPOSITIONED (legitimate non-firing) or was its applicability argued away in prose (undeclared self-exemption)?

### Clause 6 -- Escrow-Delta-v gate
`clause6 :: Milestone x ABSORBEntry -> {PASS, FAIL, N/A}` Trigger: milestone is design-only AND ABSORB claims nonzero VT Delta-v. Delta-v claim uses explicit escrow/provisional wording adjacent to the claim. FAIL: design-only, claims Delta-v, no qualifier. De-escrow: `-IMPL` row's future ABSORB.

### Clause 7 -- Product-work test-floor gate
`clause7 :: Milestone x ABSORBEntry -> {PASS, FAIL, N/A}` Trigger: `surface:` label is product-touching (cli, web-ui, provider-abi, mcp) OR no `surface:` label (fail-closed). ABSORB entry records coverage disposition: (a) coverage >=80%/"full"/"complete" with cited test-run, OR (b) WAIVER line (same shape as Clause 5). FAIL: trigger fires AND neither present.

### Clause 8 -- Task canonical-lifecycle-record gate
`clause8 :: Task -> {PASS, FAIL, N/A}` Trigger: FORWARD-ONLY -- `milestone:M<N>` label with N >= 40. Task has `## Proposal` (non-empty, non-placeholder, inline) AND `## Plan` (EITHER "N/A -- <reason>" OR resolvable `docs/plans/*.md` path). FAIL: trigger fires AND missing/empty/broken. Fixtures: `dod-fixture-selfcheck.sh`.

### Clause 9 -- Split-or-commit / needs-human legitimacy
`clause9 :: ABSORBEntry -> {PASS, FAIL, N/A}` If `OUTCOME: needs-human`, reason must be external (service outage, missing credential, upstream not released). In-project factors (architecture, complexity, "this is hard") FAIL. If `OUTCOME: done`, Clause 0 governs. Fixtures: `needs-human-external-stub.md`, `needs-human-internal-stub.md`.

### Clause 10 -- Tree-hygiene gate
`clause10 :: WorktreeState -> {PASS, FAIL}` UNCONDITIONAL. Working tree clean -- no scratch/temp/untracked artifacts. `exec:` `scripts/tree-hygiene-check.sh`.

### Clause 11 -- Worktree/branch-hygiene gate
`clause11 :: WorktreeState -> {PASS, FAIL}` UNCONDITIONAL. No orphaned milestone worktrees or stale branches after ABSORB. `exec:` `scripts/worktree-branch-hygiene-check.sh`.

### Clause 12 -- Audit-independence gate
`clause12 :: ABSORBEntry -> {PASS, FAIL, N/A}` Conditional. ABSORB entry carries `## Audit-independence check` section with artifact path + orchestrator id, verified by `audit-independence-check.ts`. N/A: section absent -> documented no-op. `exec:` `scripts/audit-independence-check.ts`.

`MECHANICALLY_UNCONDITIONAL_CLAUSES` = `["line-budget", "impl-row", "escrow-delta-v", "test-floor"]` (Clause 5's `dispositionedClauses.add()` called on every code path incl. FAIL -- the DIR-019 fix). All 13 clauses run via `scripts/it0-dod-check.ts` (exits 0/1/2), wired as HARD BLOCK on step 7's `milestone_counter++`, fixture-pinned by `dod-fixture-selfcheck.sh`.

---

## DeviationRecord :: Schema (DIR-017 Step 3 / M36-dod-leakage-metrics)

**What qualifies:** a concrete, cite-able instance where a milestone's actual delivered state departed
from what its charter/task claimed or from what a DoD clause requires. Excluded: ordinary CONCERNS-level
audit findings fixed in the same ABSORB; honestly-recorded non-findings.

**Record fields:**

```
type DeviationRecord = {
  id:              "DEV-<NN>"                     // short slug, chronological by discovery date
  title:           string                         // one-line description
  originMilestone: string                         // milestone whose work the deviation is found IN
  foundAt:         string                         // milestone/date actually discovered
  caughtBy:        "machine" | "human"            // machine = it0-* check or adversarial-audit verdict;
                                                  // human = directive authored/asserted by human
  status:          "found" | "fixed" | "verified-eliminated"
                                                  // verified-eliminated = fix confirmed by evidence
                                                  // EXTERNAL to the fixing milestone's own self-report
  age:             number                         // age in milestone-count spans (not calendar dates)
}
```

**Forward-update responsibility:** the Clause-1 per-milestone acceptance-audit subagent is the SOLE
standing writer of this log, at the SAME dispatch point it already runs (step 6, after checklist
write-back). Promotion from `fixed` to `verified-eliminated` checked at EVERY subsequent ABSORB.

`exec:` Clause 1 audit subagent write-back; data in `dashboard.md` homeostatic-variables section;
definitions in this section. Cross-reference: `v-meta-ledger.md` (separate artifact, different update
cadence -- deviation-log has same cadence as DoD-clause evaluation, not a distinct one).
