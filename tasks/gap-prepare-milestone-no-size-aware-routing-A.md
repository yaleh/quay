---
id: gap-prepare-milestone-no-size-aware-routing-A
title: "Size estimation + fast-lane routing: estimateTaskSize +
  PrepareRoutingDecision in prepare-milestone"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-prepare-milestone-no-size-aware-routing-A
    experiments/quay-perpetual-stream/charters/M239-gap-prepare-milestone-no-size-aware-routing-A.md
    milestones/M239/absorb-entry.md
  superseded: true
  superseded_at: 2026-08-12
---
**type:** execution

## Proposal

### Problem framing

`prepare-milestone.js` applies the same full Proposal+Plan pipeline to every task regardless of size or proof complexity. The current code path from Preflight content PASSED (line 644, `log('Preflight (content) PASSED — ${_taskId} may proceed to ProposalAuthors.')`) through `let _proposals = []` (line 655) into ProposalAuthors (line 666) dispatches N independent proposal-author agents (N=2 default, N=3 highRisk), runs Adjudicate, then enters the bounded-convergence ProposalReview loop (line 746-1302), PlanAuthor (line 1304-1347), PlanCheck (line 1384-1431), and Receipt (line 1439-1542). This is a uniform pipeline with zero size- or proof-complexity awareness — a task touching 100 lines of source code and requiring only local unit-test proof burns the same agent-turns as a multi-mechanism directive touching five packages with cross-generation proof obligations.

This is not hypothetical. The sizing proposal measured the cost: six complete-Touches tasks had an L0 estimate of 795-1320 (mean absolute percentage error 15.5%), while real dispatch evidence from M204-M207 showed 10 attempts consuming 202.9 minutes with zero "prepared" outcomes — 3.45 historical average Execute attempts of effort spent BEFORE any task entered Build. The DIR-126-D incident alone accumulated ~5h wall time / ~9.5M aggregate tokens / 11 attempts on a single task.

The root cause is structural: there is no code path in `prepare-milestone.js` that asks "how large is this task?" before dispatching the full machinery. The Preflight phase (lines 628-653) performs deterministic content checks (merged-Markdown-claims, stale AC/DoD refs, Touches mismatch, missing precedent) but makes zero routing decisions. Every task proceeds through ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor/PlanCheck regardless of its codeScale or proofScale. The workflow has no `estimateTaskSize`, no `routeTask`, no `PrepareRoutingDecision`, and no fast-lane concept.

The sizing proposal (`docs/proposals/quay-milestone-workflow-task-sizing-and-adaptive-execution.md`) established the two-dimensional sizing contract and workflow selection policy. This milestone is the FIRST production implementation step: introduce the estimator and routing decision into `prepare-milestone.js`'s existing Preflight phase as a strictly emission-only step (it changes no review behavior, no reviewer count, no dispatch count today — full-lane IS the current, unchanged path).

The proofScale dimension MUST genuinely gate fast-lane eligibility: a proof-heavy S task (real-workflow or cross-generation proof) is NOT fast-lane eligible, even though its codeScale is small. This closes the specific finding from the parent gap's split review: the prior draft did classify proofScale but never wired it into the routing decision's eligibility gate. No production code classifies proofScale today (it exists only in proposal/task prose), so this milestone must introduce the classifier AND make it gate routing.

Zero size-estimation or routing files currently exist in the repository — no files match `*size*`, `*routing*`, or `*estim*` under `experiments/quay-perpetual-stream/scripts/`, `plugin/scripts/`, or their test directories. The `task-schema.ts` module at `experiments/quay-perpetual-stream/scripts/task-schema.ts` exports `extractSection(heading)` (line 73) for depth-aware section extraction and `countBoxes(sectionBody)` (line 210) for counting GFM checklist boxes — these are the single-source parsing utilities the estimator will import, never reimplemented.

### Chosen mechanism

Introduce a new standalone TypeScript CLI script `prepare-milestone-size-estimate.ts` (placed in BOTH `experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/` as byte-identical mirrors, the same no-import/mirror discipline as `prepare-milestone.js` and `task-schema.ts`). Dispatch it from `prepare-milestone.js` via the EXISTING `agent()`-wraps-CLI pattern (the same mechanism `_preflightAgentCall` already uses at line 286 — no new dispatch mechanism class), at exactly one insertion point: after the Preflight content PASSED log (line 644) and before `let _proposals = []` (line 655). This placement is deliberate: by this point, the Preflight content verdict has confirmed the task is mechanically sound (Touches exist and match, AC/DoD sections are non-stale, no merged-Markdown-claims defect), so the estimator has valid input. The dispatch is fire-and-forget emission — its return value is logged and persisted, never branched on to change behavior.

#### Estimator script (`prepare-milestone-size-estimate.ts`)

The script runs under `node --experimental-strip-types` (same interpreter precedent as `prepare-admission-check.ts` and `task-schema.ts`). It imports `extractSection` and `countBoxes` from `./task-schema.ts` — single-source box/section parsing, never a second regex implementation. It exports these deterministic functions:

1. **`expandTouchSet(taskText, workspaceDir)`** — reads `## Touches` section, glob-expands each entry against the workspace via Node `fs` (`readdirSync`/`existsSync`), returns deterministic sorted file list. If `## Touches` is entirely missing OR any glob entry matches zero real files, returns `{ ok: false, code: 'scope-estimate-unavailable' }`. This fails closed per the sizing proposal's own finding: four AC-only estimates had 61.4% MAPE versus 15.5% MAPE for complete-Touches estimates. A scope-estimate-unavailable result routes full-lane.

2. **`classifyProofScale(taskText)`** — deterministic classification to `local | integration | real-workflow | cross-generation | unknown`:
   - Step 1: explicit frontmatter/body declaration `proofScale\s*[:=]\s*(local|integration|real-workflow|cross-generation)` wins (if value is a valid keyword).
   - Step 2: else keyword-derive from the concatenation of `## Definition of Done` + `## Human verification` + `## Acceptance Criteria`: exact match `cross-generation` maps to `cross-generation`; `real-workflow` or `real dispatch` or `real-object` maps to `real-workflow`; `integration` maps to `integration`; else `local`.
   - Step 3: if `## Definition of Done` is entirely absent (no section to derive from), returns `unknown`. `unknown` routes full-lane — fail-closed, never silently fast-laned.

3. **`estimateTaskSize(taskText, { workspaceDir, policy })`** — returns deterministic `{ codeScale, proofScale, sizeTier, logicalSurfacesCount, mechanismCount, inputValid, acCount, expandedTouchesCount }`:
   - `codeScale = 25 * acCount + 60 * expandedTouchesCount` — the sizing proposal's validated L0 estimator (15.5% MAPE on 6 complete-Touches tasks).
   - `sizeTier` = `S` when codeScale <= 500, `M` when 501-900, `L` when >= 901 (sizing proposal Table 4.1 reference bands, from `_ROUTING_POLICY`). The XS band (<=200) and XL band (>1400) from the proposal are intentionally NOT used for routing here — see Non-goals.
   - `logicalSurfacesCount` = number of distinct `(areaRoot, kind)` pairs over the expanded touch set, where `areaRoot` is the first path segment (`experiments`, `plugin`, `.claude`, `packages`) and `kind` is `test` if the path contains `/test/`, else `source`.
   - `mechanismCount` = number of distinct `areaRoot` values that contribute at least one `source` surface (a deterministic proxy: one coherent mechanism touches one coherent source area).
   - `acCount` = `countBoxes(extractSection(taskText, 'Acceptance Criteria')).total`
   - `expandedTouchesCount` = `expandTouchSet(...).files.length`
   - `inputValid: false` when inputs are unreliable (missing `## Touches`, unexpandable glob) → `scope-estimate-unavailable` → fail-closed full-lane.

4. **`_ROUTING_POLICY`** — the ONE versioned policy snapshot (single named thresholds location, never scattered inline literals):
   ```
   const _ROUTING_POLICY = {
     policyRegistryRef: 'DIR-124-D',
     policyVersion: 'provisional-m239',
     fastLaneCodeChurnCeiling: 800,
     fastLaneMaxLogicalSurfaces: 5,
     proofScaleFastLaneAllowlist: ['local', 'integration'],
     mTierFullLaneFloor: 501,
   };
   ```
   The ~800 fast-lane ceiling and M-tier 501-900 floor overlap is an ACKNOWLEDGED conflict resolved by DIR-124-D's future policy registry — this snapshot treats M-tier as full-lane by default (the `mTierFullLaneFloor: 501` means anything >= 501 is M or L, both of which route full-lane under this provisional policy). When DIR-124-D lands, the swap is a one-location replacement (read the registry instead of this snapshot). The decision's `thresholdsRef` field already names `policyRegistryRef: 'DIR-124-D'` + `policyVersion`, satisfying AC4.

5. **`routeTask(estimate, policy)`** — returns `fast-lane | full-lane`. `fast-lane` ONLY when ALL of:
   - `inputValid === true` (Touches section exists and all entries expand to real files)
   - `proofScale ∈ policy.proofScaleFastLaneAllowlist` (currently `['local', 'integration']`)
   - `codeScale <= policy.fastLaneCodeChurnCeiling` (currently 800)
   - `logicalSurfacesCount <= policy.fastLaneMaxLogicalSurfaces` (currently 5)
   - `mechanismCount === 1`
   - `sizeTier === 'S'`
   Everything else (M/L tier, unknown proofScale, scope-estimate-unavailable, mechanismCount > 1, >5 logical surfaces, any failed condition) routes `full-lane`. Full-lane IS today's path — zero behavioral change.

   **route-1**: The proofScale dimension genuinely gates routing — a task with codeScale 300 (S tier), single mechanism, <= 5 logical surfaces but `proofScale: real-workflow` is NOT fast-lane eligible because `real-workflow` is not in the allowlist. This is the specific gap the parent split review found.

   **route-2**: Unknown proofScale (including absent DoD section) routes `full-lane` — fail-closed, never silently fast-laned.

6. **`buildRoutingDecision(taskText, charterText, { workspaceDir })`** — returns a versioned `PrepareRoutingDecision`:
   ```
   {
     schemaVersion: 1,
     route: 'fast-lane' | 'full-lane',
     codeScale, proofScale, sizeTier,
     logicalSurfacesCount, mechanismCount, inputValid,
     thresholdsRef: { policyRegistryRef, policyVersion },
     materialInputHashes: {
       taskProposal: sha256(extractSection(taskText, 'Proposal')),
       taskTouches: sha256(extractSection(taskText, 'Touches')),
       charter: sha256(charterText),
     },
     runIdentityBinding: { declared: true, enforced: false, bindingTask: 'DIR-124-B' },
     decisionHash: sha256(<canonical JSON of decision excluding decisionHash>),
   }
   ```
   The `decisionHash` is a self-hash over the decision's material inputs AND the route decision fields (the hash includes `route`, `codeScale`, `proofScale`, `materialInputHashes` in the canonical JSON). A re-estimate with identical inputs but a different route (e.g., after a policy threshold change) produces a different `decisionHash`. `runIdentityBinding` declares (but does NOT enforce) that this decision will be bound into DIR-124-B's RunIdentity/StageReceipt when B lands — satisfying AC5.

   **hash-1**: The hash is computed over material input content (task Proposal, Touches, charter text) AND the route decision fields — not merely over inputs alone.

#### Workflow integration

In `prepare-milestone.js` (and `plugin/workflows/prepare-milestone.js`, byte-identical mirror), a new `_sizeEstimateAgentCall(flagsText, label)` helper is added beside the existing `_preflightAgentCall` (line 286), using the same `agent()`-wraps-CLI pattern with `phase: 'Preflight'` and `schema: { raw: string|null }`. The routing stage is inserted IMMEDIATELY AFTER line 644 (`log('Preflight (content) PASSED — ${_taskId} may proceed to ProposalAuthors.')`) and BEFORE `let _proposals = []` (line 655), dispatching `--estimate --task tasks/${_taskId}.md --charter ${_charterFile} --workspace . --out milestones/${_milestoneId}/routing-decision.json`, parsing the stdout JSON via the existing `_parseAgentJson` balanced-brace scanner, fail-closing to `{ route: 'full-lane', codeScale: null, proofScale: 'unknown', failure: 'routing-check-failed' }` on unparseable output, and logging the route/codeScale/proofScale/thresholdsRef.

**dispatch-1**: The routing dispatch uses the EXISTING `agent()`-wraps-CLI pattern (same shape as `_preflightAgentCall` at line 286). No new dispatch mechanism class is introduced.

**dispatch-2**: The routing dispatch is fire-and-forget emission — its return value is logged and the decision is persisted to `milestones/M<NN>/routing-decision.json` (a sidecar beside `preparation.json`), but the return value is NEVER branched on to change behavior in this milestone. Full-lane IS today's path; fast-lane changes nothing until child B consumes it.

**dispatch-3**: The routing dispatch is placed strictly BETWEEN Preflight content PASSED and the ProposalAuthors branch — after mechanical validation confirms the task has valid Touches, before any content agent is dispatched. The routing stage is reached by BOTH the cold path and the `resumeFromAdjudicatedProposal` branch — the Preflight content call at line 621 runs unconditionally before the branch at line 658, so every reachable singleton prepare path sees routing. Paths that return BEFORE `phase('Preflight')` (missing-required-args line 123, admission-check-failed, prepare-already-running line 314, epoch-cap-admission line 475, resume-decision-failed line 515, reuse-terminal line 536, split-decision-blocks-dispatch line 569) never reach routing and are out of scope.

**dispatch-4**: The estimator script is invoked via exactly one `_sizeEstimateAgentCall()` helper function (one definition, one call site), following the same `agent()`-wraps-CLI convention as `_preflightAgentCall`, `_admissionAgentCall`, and `_convergenceAgentCall`.

**mirror-1**: Both workflow mirrors (`.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js`) are byte-identical after the change — the existing diff-is-empty invariant is preserved.

**mirror-2**: Both estimator script mirrors (`experiments/.../prepare-milestone-size-estimate.ts` and `plugin/.../prepare-milestone-size-estimate.ts`) are byte-identical and are validated by the same `.test.mjs` file in both mirrors.

#### Routing decision sidecar

The decision is written atomically to `milestones/M<NN>/routing-decision.json` (temp-file-then-rename, mirroring the repo's `_atomicWriteJson` convention from `milestone-preparation-check.ts`). It is a derived artifact, not a second content source — the task's `## Proposal` and `docs/plans/*.md` remain authoritative. The file is committed alongside `preparation.json` by the Prepare workflow. If the milestone directory does not exist, the CLI creates parent directories as needed (matching `preparation.json`'s own convention).

### Concrete control and data flow

```
prepare-milestone.js Preflight phase (line 621-653)
  |
  v
[Preflight content checks via prepare-admission-check.ts --preflight]
  |
  v
line 644: "Preflight (content) PASSED"
  |
  v
[NEW: _sizeEstimateAgentCall --estimate]  <-- INSERT POINT
  |  dispatches: node --experimental-strip-types prepare-milestone-size-estimate.ts --estimate
  |  reads: tasks/<id>.md + charter file from disk
  |  computes: expandTouchSet → estimateTaskSize → classifyProofScale → routeTask → buildRoutingDecision
  |  writes: milestones/M<NN>/routing-decision.json (atomic temp+rename)
  |  prints: routing-decision JSON to stdout
  |  PARSE: _parseAgentJson(result.raw) → _routingDecision
  |  FAIL-CLOSED: unparseable → { route: 'full-lane', failure: 'routing-check-failed' }
  |  LOG: route, codeScale, proofScale, thresholdsRef
  v
line 655: let _proposals = []  <-- UNCHANGED, both branches continue
  |
  v
[ProposalAuthors / resume branches -- UNCHANGED, emission-only]
```

The estimator script's data flow is:

```
taskText = readFile(tasks/${taskId}.md)
charterText = readFile(${charterFile})
touchesSet = expandTouchSet(taskText, workspaceDir)   // glob-expand, sorted
if !touchesSet.ok → inputValid=false, route=full-lane
acCount = countBoxes(extractSection(taskText, 'Acceptance Criteria')).total
expandedTouchesCount = touchesSet.files.length
codeScale = 25 * acCount + 60 * expandedTouchesCount
proofScale = classifyProofScale(taskText)
logicalSurfacesCount = derive from touchesSet.files (distinct (areaRoot, kind) pairs)
mechanismCount = derive from touchesSet.files (distinct areaRoot with source kind)
sizeTier = S|M|L from codeScale bands
route = routeTask(estimate, _ROUTING_POLICY)
decision = buildRoutingDecision(taskText, charterText, { workspaceDir })
writeFile(milestones/M<NN>/routing-decision.json, JSON.stringify(decision, null, 2))
```

The routing decision is computed BEFORE any content agent dispatch but AFTER mechanical validation confirms valid input. If Preflight content REJECTS (blocking findings), no routing decision is emitted — the task never reaches the routing step. This is correct: a task with merged-Markdown-claims or stale AC/DoD refs has no routable scope to estimate.

### Key design decisions

1. **Emission-only, no behavior change.** This milestone emits the routing decision and persists it to a sidecar file. It changes NOTHING about reviewer count, dispatch count, review depth, or any other phase behavior. Full-lane IS today's path, byte-for-byte unchanged. This is deliberate: the routing decision must be proven correct (shadow-mode, calibrated) before it ever gates behavior — that is child C's scope.

2. **One versioned `_ROUTING_POLICY` snapshot, not scattered literals.** The threshold values live in exactly ONE named constant in the TypeScript source, referenced as `policyRegistryRef: 'DIR-124-D', policyVersion: 'provisional-m239'`. When DIR-124-D lands, the swap is a one-location replacement. No threshold value appears as an inline literal anywhere else.

3. **ProofScale genuinely gates routing.** A task with codeScale 300 (S tier) and `proofScale: real-workflow` does NOT route fast-lane, because `real-workflow` is not in the allowlist. This is the specific gap the parent split review found — the prior draft classified proofScale but never wired it into the eligibility gate. The RED/GREEN tests must include this negative case.

4. **Fail-closed on unknown/missing input.** Three independent failure modes each produce `route: 'full-lane'`: (a) unknown proofScale (no `## Definition of Done` section, `classifyProofScale` returns `unknown`), (b) unreliable codeScale inputs (missing `## Touches`, unexpandable glob → `inputValid: false` → `scope-estimate-unavailable`), and (c) unparseable routing-CLI stdout in the workflow (the fail-closed fallback block sets `route: 'full-lane'` and the prepare path continues unchanged — there is no `return` or lease-release in the routing block).

5. **M-tier default is full-lane under provisional policy.** The sizing proposal places M at 501-900, which overlaps the fast-lane ~800 ceiling. Under this provisional policy, M-tier is full-lane by default (`mTierFullLaneFloor: 501` means anything >= 501 is M or L, both full-lane). The ~800 vs M-501-900 conflict is acknowledged and deferred to DIR-124-D's policy registry to resolve.

6. **RunIdentity binding declared, never enforced.** The `PrepareRoutingDecision.runIdentityBinding` field declares `{ declared: true, enforced: false, bindingTask: 'DIR-124-B' }`. When DIR-124-B lands and canonical RunIdentity/StageReceipt contracts exist, the decision's `decisionHash` and `materialInputHashes` are re-homed into B's receipt envelope. Until then, they are emitted standalone. This satisfies AC5 without creating a dependency on an unlanded task.

7. **Single-source section parsing.** The estimator reuses `extractSection` and `countBoxes` from `task-schema.ts` — the same functions the Preflight content checker and Admission checker already use. No second regex implementation of Markdown section extraction or checkbox counting.

8. **Deterministic, no randomness, sorted expansion.** Every function is pure and deterministic. Glob expansion is sorted. Canonical JSON serialization is stable (sorted keys). The estimator produces the same output for the same input every time.

9. **Mirror convention preserved.** Both script mirrors (`experiments/...` and `plugin/...`) are byte-identical. Both workflow mirrors (`.claude/workflows/` and `plugin/workflows/`) are byte-identical after the change. Tests exist in both mirror locations. The `./task-schema.ts` import resolves in both directories because both mirrors live in directories each containing a `task-schema.ts` mirror.

10. **Vocabulary.** The estimator uses the task-mandated value-set `local | integration | real-workflow | cross-generation`. The sibling document's `unit | integration | ...` variant is backlog for DIR-124-D to canonicalize; this milestone uses the task's own vocabulary unmodified.

### Defaults and failure behavior

| Condition | codeScale | proofScale | Route | Rationale |
|---|---|---|---|---|
| S-local task (1 AC, 1 touch, DoD says "standard clauses") | ~85 | local | fast-lane | All gates pass |
| S-real-workflow task (1 AC, 1 touch, DoD says "real-workflow evidence") | ~85 | real-workflow | full-lane | proofScale not in allowlist |
| M-tier task (15 AC, 3 touches) | ~555 | local | full-lane | mTierFullLaneFloor=501, sizeTier='M' |
| >5 logical surfaces | varies | local | full-lane | logicalSurfacesCount > 5 |
| >1 mechanism (touches in 2+ distinct areaRoots) | varies | local | full-lane | mechanismCount > 1 |
| codeScale > 800 (L-tier) | >800 | local | full-lane | Exceeds fastLaneCodeChurnCeiling |
| Missing `## Touches` section | scope-estimate-unavailable | varies | full-lane | inputValid: false (61.4% MAPE without Touches) |
| Glob entry matches zero files | scope-estimate-unavailable | varies | full-lane | inputValid: false |
| Missing `## Definition of Done` | varies | unknown | full-lane | classifyProofScale → unknown |
| Unparseable routing-CLI stdout | N/A | N/A | full-lane | Workflow fallback block |
| Estimator CLI crashes | N/A | N/A | workflow continues | Logged as warning; routing is additive telemetry, never a correctness gate |

All full-lane outcomes execute today's unchanged pipeline — no behavioral regression.

**fail-1**: A crash or unparseable output from the estimator CLI logs a warning but does NOT block the workflow — the routing decision is emission-only telemetry. The workflow should NEVER return `needs-human` or `revision-needed` because the estimator failed.

**fail-2**: If the milestone directory (`milestones/M<NN>/`) does not exist, the estimator CLI creates parent directories as needed.

### Compatibility

**Backward compatibility**: The routing decision is additive. Tasks that today go through the full pipeline continue to go through the full pipeline. No existing behavior, reviewer count, dispatch count, or phase changes. The `prepare-milestone.js` return shape gains one optional field `routingDecision` (present only when the estimator ran successfully). All existing callers that destructure the return value are unaffected by the presence of an extra key.

**Forward compatibility**: When DIR-124-B lands, the `PrepareRoutingDecision` is re-homed into B's `RunIdentity`/`StageReceiptEnvelope` via a one-way compatibility adapter (B's own scope, not A's). When DIR-124-D lands, the `_ROUTING_POLICY` snapshot is replaced with a live registry read.

**Mirror compatibility**: The byte-identical mirror invariant is preserved. The existing diff-is-empty check between `.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js` must remain empty after the change.

**Test compatibility**: No existing test file is modified. The new test file `prepare-milestone-size-estimate.test.mjs` is additive and does not change the test surface of any existing file.

**Rollback**: `git revert` of the milestone's Land commit removes the routing-decision sidecar and the new code. No migration or cleanup script is needed.

### Risks

1. **The estimator has limited validation.** The L0 formula was validated on only 6 complete-Touches tasks (15.5% MAPE). No task in the sample exceeded 1400 canonical churn lines, so the L and XL bands are extrapolated. This is acceptable because the routing decision is emission-only — a mis-estimate wastes no work and changes no behavior in this milestone.

2. **ProofScale keyword derivation is heuristic, not measured.** The classifier reads task text for keywords, not actual proof requirements. A task whose author wrote "real-workflow" in the body but whose actual proof surface is local will be over-classified (routed full-lane) — safe but conservative. A task whose author omitted proof-surface-indicating words despite needing real-workflow proof will be under-classified (routed fast-lane) — this is the unsafe direction, mitigated by the emission-only design: fast-lane changes NOTHING in this milestone. Mitigation: the explicit declaration `proofScale: local` in frontmatter or body takes precedence and is the recommended authoring convention.

3. **Touch-glob expansion is workspace-relative.** The estimator's `expandTouchSet` glob-expands against the workspace directory — if the workspace checkout is dirty (uncommitted new files matching a wildcard), the logical surface count changes non-deterministically. Mitigation: the `decisionHash` binds to `materialInputHashes.taskTouches` (sha256 of the `## Touches` section text, not the expansion), so a later verification can detect that the task's declared touches match; the expansion itself is a deterministic function over a clean workspace at call time.

4. **The ~800 vs M-501-900 tier conflict is unresolved.** Under provisional policy, M-tier routes full-lane, but a task at codeScale 510 (just into M) and a task at codeScale 790 (still S but near the ceiling) are treated differently despite both being moderate-sized. A task with codeScale 750 and proofScale `local` — within the ~800 churn ceiling but classified M-tier by `mTierFullLaneFloor` — correctly routes full-lane through the `sizeTier !== 'S'` guard, never fast-lane. This is the safe (conservative) direction. DIR-124-D must resolve the conflict.

5. **Plugin mirror drift.** If only one mirror is edited during Build, the byte-identical invariant breaks. The Plan's Build phase must edit both mirrors in lockstep.

### Non-goals

1. **Changing reviewer count, dispatch count, or any phase behavior.** This is emission-only. Child B introduces the execution manifest; child C does calibration and rollout.

2. **Calibrating the estimator coefficients.** The coefficients (25, 60, 800, 5) come from the sizing proposal's provisional values. Calibration is child C's scope.

3. **Consuming `PrepareRoutingDecision` in `execute-milestone.js`.** Child B's scope.

4. **Implementing DIR-124-D's policy registry.** This milestone references the registry version; it does not implement the registry.

5. **Implementing DIR-124-B's RunIdentity/StageReceiptEnvelope.** This milestone declares the binding; it does not implement the envelope.

6. **XS band (<=200) distinct routing.** The sizing proposal defines an XS tier for tasks <= 200 codeScale (mechanical checks, one implementer, focused audit), but this milestone does not introduce XS-specific behavior. The S band covers 0-800 (effectively including XS tasks) under the provisional policy.

7. **XL band (>1400) split-by-default enforcement.** The sizing proposal recommends default split for XL tasks, but that is a policy decision for DIR-124-D, not this milestone.

8. **Writing the routing decision into the task's `## Proposal` or `## Plan`.** The decision is a sidecar artifact, not a task body update.

9. **Shadow-mode rollout.** Emitting the routing decision into a real running pipeline and comparing against manual classification is DIR-124-C/M241's scope, not this milestone.

10. **Normalizing the proofScale vocabulary.** The `unit | integration | ...` variant in sibling documents is backlog for DIR-124-D; this milestone uses the task-mandated value-set exclusively.

11. **Touching `milestone-preparation-check.ts`.** The receipt validation script is not in this task's `## Touches` — the `decisionHash` is self-hash over the decision's own fields, not cross-validated by the receipt checker in this milestone.

### Acceptance Criteria coverage

| AC | Sub | Coverage | Proof surface |
|---|---|---|---|
| AC1 | AC1.1 | `estimateTaskSize` deterministic estimator (purely arithmetic, no randomness; `expandTouchSet` sorted output); imports `extractSection` and `countBoxes` from `./task-schema.ts`, never reimplements section parsing or box counting | `prepare-milestone-size-estimate.ts` exported functions + imports |
| AC2 | AC2.1 | Routing stage inserted strictly between line 644 (`log('Preflight (content) PASSED — ${_taskId} may proceed to ProposalAuthors.')`) and `let _proposals = []` (line 655), structurally reached by both cold and resume paths | `.claude/workflows/prepare-milestone.js` line ordering |
| AC2 | AC2.2 | Exactly one `_sizeEstimateAgentCall()` helper function (one definition, one call site), using the same `agent()`-wraps-CLI pattern as `_preflightAgentCall`, `_admissionAgentCall`, and `_convergenceAgentCall` | `.claude/workflows/prepare-milestone.js` grep + code review |
| AC2 | AC2.3 | Routing is fire-and-forget emission — return value logged and persisted to `milestones/M<NN>/routing-decision.json`, never branched on to change behavior | `.claude/workflows/prepare-milestone.js` code review |
| AC2 | AC2.4 | Workflow parses CLI stdout via the existing `_parseAgentJson` balanced-brace scanner, not a new parsing mechanism; fail-closes to `{ route: 'full-lane', codeScale: null, proofScale: 'unknown', failure: 'routing-check-failed' }` on unparseable output | `.claude/workflows/prepare-milestone.js` routing block |
| AC2 | AC2.5 | Estimator crash or unparseable output logs a warning but never blocks the workflow; no `return` or lease-release in the routing block | `.claude/workflows/prepare-milestone.js` code review |
| AC2 | AC2.6 | Both workflow mirrors (`.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js`) byte-identical after the change | `diff` check |
| AC3 | AC3.1 | `routeTask` gates fast-lane on `proofScale ∈ proofScaleFastLaneAllowlist`; a task with codeScale 300 (S tier) and `proofScale: real-workflow` does NOT route fast-lane because `real-workflow` is not in the allowlist; RED test: S+real-workflow fixture → route `full-lane` | `prepare-milestone-size-estimate.ts` `routeTask` + test fixture |
| AC3 | AC3.2 | `sizeTier === 'S'` is a necessary condition for fast-lane; everything else (M/L tier, unknown proofScale, scope-estimate-unavailable, mechanismCount > 1, >5 logical surfaces) routes `full-lane` | `prepare-milestone-size-estimate.ts` `routeTask` |
| AC4 | AC4.1 | `buildRoutingDecision` returns a versioned `PrepareRoutingDecision` with `schemaVersion: 1`, `route`, `codeScale`, `proofScale`, `sizeTier`, `logicalSurfacesCount`, `mechanismCount`, `inputValid`, `thresholdsRef`, `materialInputHashes`, `runIdentityBinding`, and `decisionHash` | `prepare-milestone-size-estimate.ts` `buildRoutingDecision` |
| AC4 | AC4.2 | `decisionHash` is a self-hash computed over material inputs (task Proposal, Touches, charter) AND route decision fields (`route`, `codeScale`, `proofScale`, `materialInputHashes` in the canonical JSON), not merely over inputs alone | `prepare-milestone-size-estimate.ts` `buildRoutingDecision` |
| AC4 | AC4.3 | `_ROUTING_POLICY` is the single named thresholds location; no inline threshold literals (800, 5, 501) appear at any call site outside the `_ROUTING_POLICY` definition; RED test verifies `thresholdsRef.policyRegistryRef === "DIR-124-D"` | `prepare-milestone-size-estimate.ts` `_ROUTING_POLICY` + grep |
| AC5 | AC5.1 | `buildRoutingDecision` emits `runIdentityBinding: { declared: true, enforced: false, bindingTask: 'DIR-124-B' }`; no code in this milestone branches on `enforced`; upgrade path: when B lands, re-home `decisionHash` and `materialInputHashes` into B's `StageReceiptEnvelope` | `prepare-milestone-size-estimate.ts` `buildRoutingDecision` |
| AC6 | AC6.1 | Three independent failure modes each produce `route: 'full-lane'`: (a) unknown proofScale (no `## Definition of Done` section, `classifyProofScale` returns `unknown`), (b) scope-estimate-unavailable (missing `## Touches` or unexpandable glob → `inputValid: false`), (c) unparseable routing-CLI stdout in the workflow fallback block | `prepare-milestone-size-estimate.ts` `routeTask` + workflow routing block |
| AC6 | AC6.2 | A task with codeScale 750 and proofScale `local` — within the ~800 churn ceiling but classified M-tier by `mTierFullLaneFloor` — routes full-lane through the `sizeTier !== 'S'` guard, never fast-lane; RED test: M-tier task → route `full-lane` | `prepare-milestone-size-estimate.ts` `routeTask` + test fixture |
| AC6 | AC6.3 | `decisionHash` binds to `materialInputHashes.taskTouches` (sha256 of the `## Touches` section text, not the expansion), enabling later verification that the task's declared touches match | `prepare-milestone-size-estimate.ts` `buildRoutingDecision` |
| AC7 | AC7.1 | Two new test files: `experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs` and `plugin/test/prepare-milestone-size-estimate.test.mjs`, byte-identical; run via `scripts/test.sh`; RED cases: S+real-workflow → full-lane, unknown proofScale → full-lane, missing/unexpandable Touches → full-lane, M-tier → full-lane; GREEN cases: S+local → fast-lane, S+integration → fast-lane | Both test files |

### Alternatives considered and rejected

**Alternative A: Inline the estimator logic directly in `prepare-milestone.js` instead of a standalone CLI script.**

Rejected. The workflow sandbox has zero fs/import capability (confirmed real: M203's `await import('node:fs')` crash). The estimator MUST perform glob expansion against the real filesystem (`expandTouchSet`), which requires Node fs. A standalone CLI script dispatched via the existing `agent()`-wraps-CLI pattern is the only mechanism that can touch the filesystem. This is the same constraint every other file-touching operation in `prepare-milestone.js` already respects (`_preflightAgentCall`, `_convergenceAgentCall`, etc.). A standalone script also enables: (a) direct in-process import in tests (the test file imports `estimateTaskSize`/`classifyProofScale`/`routeTask`/`buildRoutingDecision` as module exports, without spawning a subprocess), (b) the CLI surface for real-object routing verification, and (c) the threshold single-sourcing guarantee (the `_ROUTING_POLICY` snapshot lives in exactly one file, not duplicated in the workflow `meta` block).

**Alternative B: Place the routing dispatch BEFORE the Preflight content check.**

Rejected. If Preflight content REJECTS (merged-Markdown-claims, stale AC/DoD), the task never reaches ProposalAuthors regardless of its size estimate. Running the estimator before the content check would waste a CLI dispatch (and a potentially expensive glob expansion) on tasks that will be mechanically rejected anyway. The current placement (after Preflight PASSED, before content agents) is the earliest structurally safe point.

**Alternative C: Make the routing decision a correctness gate (block the workflow on fast-lane/full-lane).**

Rejected for this milestone. The estimator has limited validation (n=6, 15.5% MAPE). Until child C completes calibration and shadow-mode rollout, the routing decision is advisory-only telemetry. Making it a gate before it is proven correct risks blocking small tasks that should proceed.

**Alternative D: Hardcode the threshold values as inline literals at each use site.**

Rejected. Scattered inline literals are the exact duplication this milestone exists to prevent. The `_ROUTING_POLICY` snapshot is a single named constant in the TypeScript source. When DIR-124-D lands, the swap is a one-location replacement. Per AC4, the decision references the policy registry version, not hardcoded thresholds. The task's `## Finding` records the ~800-vs-M-tier-501-900 conflict — resolving that conflict by hardcoding one side or the other in this milestone would be premature and would create an undocumented implicit decision that DIR-124-D then has to detect and reverse-engineer.

**Alternative E: Derive proofScale from mechanical analysis of imported modules rather than keyword classification.**

Rejected. Mechanical import-graph analysis (e.g., checking whether a test file imports `prepare-milestone.js`'s own symbols) would require parsing TypeScript/JavaScript ASTs, which is a large, fragile dependency for a provisional classifier. Keyword classification from task text is lightweight, deterministic, and fail-safe (unknown routes full-lane). A richer classifier is backlog for DIR-124-D.

**Alternative F: Separate `estimateTaskSize` and `routeTask` into two different scripts.**

Rejected. The estimator and router share the same input (task text, charter text, workspace directory) and the same expensive operation (glob-expanding `## Touches`). Splitting them would duplicate glob expansion. One script that does both is more efficient and has a simpler interface.

**Alternative G: Route based on codeScale alone (no proofScale dimension).**

Rejected. A proof-heavy S task (e.g., "add one-line config flag" whose DoD requires a cross-generation real-dispatch replay proof) would route fast-lane based solely on its tiny codeScale, losing the independent review that its proof burden warrants. The task's `## Finding` explicitly calls this out: "No production code classifies proofScale today … this milestone must introduce the classifier AND make it gate routing — without that, a proof-heavy S task could wrongly get a single fast-lane reviewer." The two-dimension routing (codeScale AND proofScale) is the chosen mechanism precisely to close this gap.

**Alternative H: Route during Admission rather than after Preflight content check.**

Rejected. The routing decision depends on the task's `## Touches` and `## Acceptance Criteria` sections — the Preflight content check (which verifies merged-Markdown-claims, stale-AC/DoD-refs, task-vs-charter-Touches-mismatch, and missing-precedent) must run FIRST, so the routing estimator sees content that has already passed structural validation. A task that fails Preflight content never reaches the routing stage (the Preflight blocking-findings return at line 648 precedes the routing insertion point), so the estimator is never asked to size an invalid task.

**Alternative I: Make routing a separate phase rather than a Preflight sub-step.**

Rejected. The routing decision takes one non-content CLI dispatch (the script runs purely mechanical computation, no LLM agent) and produces a sidecar file + log line — adding a whole new phase for a single CLI call would increase workflow metadata complexity without adding decision value. The current Preflight phase already has sub-steps (content check), and routing fits the same pattern: a fast mechanical gate inserted after the content check and before content-agent dispatch.

### Mechanism-claim wiring coverage (DIR-117)

Every claimed relationship below maps to a specific AC sub-item and has a falsifiable production-callsite check:

| Claim ID | Relationship claimed | AC | Verification at callsite |
|---|---|---|---|
| `route-1` | `routeTask` gates fast-lane on proofScale allowlist membership | AC3.1 | RED test: S+real-workflow task → route `full-lane`; grep `prepare-milestone-size-estimate.ts` for `proofScaleFastLaneAllowlist` used in `routeTask` |
| `route-2` | Unknown proofScale routes full-lane | AC6.1 | RED test: absent DoD → `route: full-lane`; grep for `unknown` case in `routeTask` |
| `dispatch-1` | Routing uses existing `agent()`-wraps-CLI pattern, no new mechanism | AC2.2 | grep `prepare-milestone.js` for `_sizeEstimateAgentCall` — must use same `agent()` shape as `_preflightAgentCall` |
| `dispatch-2` | Routing is fire-and-forget emission, never branched on | AC2.3 | grep `prepare-milestone.js` for all call sites of `_sizeEstimateAgentCall` — exactly one, and its return value is only logged, never used in a conditional |
| `dispatch-3` | Routing dispatch after Preflight PASSED, before ProposalAuthors branch; structurally reached by both cold and resume paths | AC2.1 | grep `prepare-milestone.js` for line ordering: `_sizeEstimateAgentCall` must appear between `Preflight (content) PASSED` log and `let _proposals = []`; the Preflight call at line 621 runs unconditionally before the branch at line 658 |
| `dispatch-4` | One helper function, one agent call | AC2.2 | grep `prepare-milestone.js` for `_sizeEstimateAgentCall` count: exactly one definition, exactly one call site |
| `mirror-1` | Both workflow mirrors byte-identical after change | AC2.6 | `diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` exits 0 |
| `mirror-2` | Both estimator script mirrors byte-identical | AC7.1 | `diff experiments/.../prepare-milestone-size-estimate.ts plugin/.../prepare-milestone-size-estimate.ts` exits 0 |
| `hash-1` | `decisionHash` computed over material inputs + route decision fields | AC4.2 | grep estimator source for `decisionHash` computation; verify it includes `route`, `codeScale`, `proofScale`, `materialInputHashes` in the canonical JSON |
| `fail-1` | Estimator crash never blocks the workflow | AC2.5 | Code review: `_sizeEstimateAgentCall` result is wrapped in try/catch or its truthiness is not gating; a null/unparseable result logs a warning and the workflow proceeds; no `return` or `_releaseLeaseAndRecord` in the routing block |
| `fail-2` | Estimator creates parent directories if missing | AC2 | RED test: run estimator with non-existent milestone dir, verify `routing-decision.json` is written successfully |
| `threshold-1` | `_ROUTING_POLICY` is single-source; `routeTask` reads thresholds from exactly one snapshot; `buildRoutingDecision` records `thresholdsRef` from that same object's identity fields | AC4.3 | grep for threshold literal values (800, 5, 501) — must appear ONLY in `_ROUTING_POLICY` definition; no inline literal thresholds at any callsite |
| `binding-1` | `runIdentityBinding.enforced` is `false`; no code in this milestone's Touches reads or branches on this field | AC5 | grep for `runIdentityBinding` or `_routingDecision` in modified `prepare-milestone.js` — only logged and persisted, never branched on |
| `parse-1` | Workflow parses CLI stdout via the existing `_parseAgentJson` balanced-brace scanner, not a new parsing mechanism | AC2.4 | grep `prepare-milestone.js` routing block for `_parseAgentJson`; must be the same function used by other agent calls |
| `import-1` | Estimator imports `extractSection` and `countBoxes` from `./task-schema.ts` — never reimplements section parsing or box counting | AC1.1 | grep `prepare-milestone-size-estimate.ts` for `extractSection`/`countBoxes` — must appear only as imports from `./task-schema.ts`, never as local function definitions |

**Additional note on ProofScale classification.** The `ProofScale` type is used across the quay task store: `tasks/DIR-125.md` is the source-of-truth for its first use in the methodology. The estimator references `proofScale` in task `extra` frontmatter (already in schema as a free-form key). If a task's frontmatter declares `proofScale: real-workflow`, the `classifyProofScale` function reads it directly. If not declared, the function derives it from keyword matching in the task body text. This two-tier approach (explicit declaration wins, keyword derivation is fallback) avoids the need for a schema migration while keeping the classification deterministic and auditable.

First child of the gap-size split (`split-multi-mechanism` finding, 2026-08-01). No dependencies within the split.

## Plan

Full checked milestone Plan: `docs/plans/M239-gap-prepare-milestone-no-size-aware-routing-a.md`
(M239, base `1f36910f`). Covers all 7 AC items across 8 ordered stages (RED estimator/routing
cases → RED real-workflow emission → estimator implementation → estimator mirror → workflow
wiring → workflow mirror → full GREEN → real-object routing evidence). Emission-only fast-lane
routing in `prepare-milestone.js`'s Preflight (after the Preflight content PASSED log, line
644); full-lane stays today's path; tier thresholds are referenced through a single versioned
`_ROUTING_POLICY` snapshot (`policyRegistryRef: 'DIR-124-D'`, provisional `policyVersion`),
never scattered inline literals.

## Finding

`prepare-milestone.js` applies the same full Proposal+Plan pipeline to every task. The
sizing proposal (Table 4.1) assigns codeScale 501-900 to M (full synthesis), overlapping
the fast-lane ~800 ceiling — the threshold conflict is real and must be resolved by
DIR-124-D's policy registry, not hardcoded here. No production code classifies proofScale
today (it exists only in proposal/task text), so this milestone must introduce the
classifier AND make it gate routing — without that, a proof-heavy S task could wrongly get
a single fast-lane reviewer.

## Requested action

1. `estimateTaskSize(task)` implementing the two-dimension estimator, returning
   `{codeScale, proofScale, tier: fast-lane|full-lane}`.
2. Route after the existing Preflight phase; emit a versioned `PrepareRoutingDecision`
   (route, codeScale, proofScale, thresholds-ref, material input hashes).
3. fast-lane eligibility REQUIRES `proofScale ∈ {local, integration}` — a proof-heavy S
   task is full-lane.
4. Bind the decision to DIR-124-B's RunIdentity when B lands; until then emit it standalone
   (declared, not enforced).
5. Defer the exact tier thresholds (including the ~800 vs M-tier-501-900 conflict) to
   DIR-124-D's policy registry; reference the registry version, don't hardcode.
6. RED/GREEN tests: S-local → fast-lane; S-real-workflow → full-lane (the proofScale
   negative); M → full-lane; unknown proofScale → fail-closed full-lane.

## Acceptance Criteria

- [ ] AC1: `estimateTaskSize` produces a deterministic `{codeScale, proofScale, tier}` for every
  reachable singleton prepare path (composite primary tasks route through the same
  workflow).
    - AC1.1: The estimator imports `extractSection` and `countBoxes` from `./task-schema.ts`
      — never reimplements section parsing or box counting.
- [ ] AC2: `prepare-milestone.js`'s Preflight phase routes each candidate as **fast-lane** or
  **full-lane** and emits a versioned `PrepareRoutingDecision` (mechanism wired into the
  real prepare path, not a standalone estimator).
    - AC2.1: The routing stage is inserted strictly between the Preflight content PASSED log
      (line 644, `log('Preflight (content) PASSED — ${_taskId} may proceed to
      ProposalAuthors.')`) and `let _proposals = []` (line 655), structurally reached by both
      cold and resume paths.
    - AC2.2: Exactly one `_sizeEstimateAgentCall()` helper function (one definition, one call
      site) invokes the estimator, using the same `agent()`-wraps-CLI pattern as
      `_preflightAgentCall`, `_admissionAgentCall`, and `_convergenceAgentCall`.
    - AC2.3: Routing is fire-and-forget emission — its return value is logged and persisted to
      `milestones/M<NN>/routing-decision.json`, but the return value is never branched on to
      change behavior in this milestone.
    - AC2.4: Workflow parses CLI stdout via the existing `_parseAgentJson` balanced-brace
      scanner, not a new parsing mechanism; fail-closes to `{ route: 'full-lane', codeScale:
      null, proofScale: 'unknown', failure: 'routing-check-failed' }` on unparseable output.
    - AC2.5: An estimator crash or unparseable output logs a warning but never blocks the
      workflow; no `return` or lease-release in the routing block.
    - AC2.6: Both workflow mirrors (`.claude/workflows/prepare-milestone.js` and
      `plugin/workflows/prepare-milestone.js`) are byte-identical after the change.
- [ ] AC3: A proof-heavy S task (real-workflow/cross-generation proof) is routed FULL-lane, not
  fast-lane (the proofScale dimension genuinely affects routing — RED/GREEN).
    - AC3.1: `routeTask` gates fast-lane on `proofScale ∈ proofScaleFastLaneAllowlist`; a task
      with codeScale 300 (S tier) and `proofScale: real-workflow` does NOT route fast-lane
      because `real-workflow` is not in the allowlist.
    - AC3.2: `sizeTier === 'S'` is a necessary condition for fast-lane; everything else (M/L
      tier, unknown proofScale, scope-estimate-unavailable, mechanismCount > 1, >5 logical
      surfaces) routes `full-lane`.
- [ ] AC4: The `PrepareRoutingDecision` is versioned + hash-bound and references the
  DIR-124-D policy registry version (not hardcoded thresholds).
    - AC4.1: `buildRoutingDecision` returns `{ schemaVersion: 1, route, codeScale, proofScale,
      sizeTier, logicalSurfacesCount, mechanismCount, inputValid, thresholdsRef,
      materialInputHashes, runIdentityBinding, decisionHash }`.
    - AC4.2: `decisionHash` is a self-hash computed over material inputs (task Proposal,
      Touches, charter) AND route decision fields (`route`, `codeScale`, `proofScale`,
      `materialInputHashes` in the canonical JSON), not merely over inputs alone.
    - AC4.3: `_ROUTING_POLICY` is the single named thresholds location; no inline threshold
      literals (800, 5, 501) appear at any call site outside the `_ROUTING_POLICY` definition.
- [ ] AC5: The DIR-124-B RunIdentity binding is declared and becomes enforced when B lands
  (documented upgrade path, not a current dependency).
- [ ] AC6: Unknown proofScale/codeScale fails closed to full-lane.
    - AC6.1: Three independent failure modes each produce `route: 'full-lane'`: (a) unknown
      proofScale (no `## Definition of Done` section, `classifyProofScale` returns `unknown`),
      (b) scope-estimate-unavailable (missing `## Touches` or unexpandable glob →
      `inputValid: false`), (c) unparseable routing-CLI stdout in the workflow fallback block.
    - AC6.2: A task with codeScale 750 and proofScale `local` — within the ~800 churn ceiling
      but classified M-tier by `mTierFullLaneFloor` — routes full-lane through the
      `sizeTier !== 'S'` guard, never fast-lane.
    - AC6.3: `decisionHash` binds to `materialInputHashes.taskTouches` (sha256 of the
      `## Touches` section text, not the expansion), enabling later verification that the task's
      declared touches match.
- [ ] AC7: Tests: `prepare-milestone-size-estimate.test.mjs` RED/GREEN.
    - AC7.1: Both estimator script mirrors (`experiments/.../prepare-milestone-size-estimate.ts`
      and `plugin/.../prepare-milestone-size-estimate.ts`) are byte-identical and validated by
      the same `.test.mjs` file in both mirror locations.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real S-local task routes fast-lane; a real S-proof-heavy task routes full-lane
  (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does a proof-heavy S task get full-lane (proofScale genuinely gates routing)?
2. Are the tier thresholds deferred to DIR-124-D, not hardcoded?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*size-estimat*`
- `plugin/scripts/*size-estimat*`
- `experiments/quay-perpetual-stream/test/*size-estimat*.test.mjs`
- `plugin/test/*size-estimat*.test.mjs`
- `tasks/gap-prepare-milestone-no-size-aware-routing-A.md`
- `milestones/M239/routing-decision.json`
- `docs/plans/M239-gap-prepare-milestone-no-size-aware-routing-a.md`

## Superseded (2026-08-12)

引用 ADR-022 已物理删除的机制（prepare-milestone.js 双镜像）：estimateTaskSize / PrepareRoutingDecision 均设计在经典 prepare-milestone Preflight pipeline 上，fast mode 无对应物。前提不存在，作废保留历史——不重开。
