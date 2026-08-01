# M239 Plan — size estimation + fast-lane routing (estimateTaskSize + PrepareRoutingDecision in prepare-milestone)

- **Milestone:** M239
- **Task:** `gap-prepare-milestone-no-size-aware-routing-A`
- **Charter:** `experiments/quay-perpetual-stream/charters/M239-gap-prepare-milestone-no-size-aware-routing-A.md`
- **Base revision:** `65f414c4` (master HEAD short-sha at plan authoring, 2026-08-01)
- **Class:** development · **Value type:** capabilityGrowth · **type:** execution

## Purpose

`prepare-milestone.js` runs the same full Proposal+Plan pipeline for every task with no
size/proof-size awareness. This milestone introduces a deterministic size-estimation +
fast-lane-routing step into the Preflight phase: `estimateTaskSize(task)` computes a
two-dimension estimate `{codeScale, proofScale}`, routes each candidate **fast-lane** or
**full-lane**, and emits a versioned + hash-bound `PrepareRoutingDecision` — while being
strictly **emission-only** (it changes no review behavior, no reviewer count, no dispatch
count; full-lane IS today's path, unchanged). The proofScale dimension genuinely gates
fast-lane eligibility (a proof-heavy S task routes full-lane), the tier thresholds are
referenced through a single versioned policy snapshot that DEFERS to DIR-124-D's policy
registry (never scattered inline literals), and the DIR-124-B RunIdentity binding is
declared but enforced only when DIR-124-B lands.

First child of the gap-size split (M234, `split-multi-mechanism`, 2026-08-01). A has no
inbound dependencies; B (`M240-gap-prepare-milestone-no-size-aware-routing-B`) consumes A's
fast-lane routing (execution manifest) and C (`M241-gap-prepare-milestone-no-size-aware-
routing-C`) does calibration + shadow-mode rollout — the A→B→C chain is the outbound side,
so the parent "No dependencies within the split" wording is true only of A's inbound deps
(ledger finding `e129f9fd`, noted here as scoping).

## Touch set (complete)

Committed files created/edited by this milestone's Build phase — every path matches the
task's own `## Touches` globs exactly (the Prepared-gate `touches-expanded` check therefore
passes; nothing expands beyond the declaration):

1. `experiments/quay-perpetual-stream/scripts/prepare-milestone-size-estimate.ts` (new —
   matches `experiments/quay-perpetual-stream/scripts/*size-estimat*`)
2. `plugin/scripts/prepare-milestone-size-estimate.ts` (new — mirror of #1, byte-identical)
3. `.claude/workflows/prepare-milestone.js` (routing stage after Preflight content PASSED,
   line 644)
4. `plugin/workflows/prepare-milestone.js` (mirror of #3 — byte-identical)
5. `experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs` (new —
   matches `experiments/quay-perpetual-stream/test/*size-estimat*.test.mjs`)
6. `plugin/test/prepare-milestone-size-estimate.test.mjs` (new — matches
   `plugin/test/*size-estimat*.test.mjs`)

Deliberately NOT listed as Build touches (prepared-artifact / runtime convention, matching
how `preparation.json`/`proposal-ledger.json`/`mechanism-inventory.json` are written by the
prepare workflow and committed without being `## Touches` entries):

- `docs/plans/M239-gap-prepare-milestone-no-size-aware-routing-a.md` — this Plan, the
  prepared artifact authored in the Prepare phase, not a Build-phase touch.
- `milestones/M239/routing-decision.json` — the runtime routing-decision sidecar written by
  the estimator CLI beside `preparation.json` (the same `milestones/M<NN>/` convention the
  Receipt phase already uses, `prepare-milestone.js` line 1452).

## Design (grounded in real symbols)

### New script: `prepare-milestone-size-estimate.ts` (both mirrors)

Runs under `node --experimental-strip-types` (the same interpreter precedent as
`prepare-admission-check.ts` / `task-schema.ts`). Reuses `extractSection`/`countBoxes`
imported from the sibling `./task-schema.ts` (single-source box/section parsing — never a
second regex implementation). M203 constraint honored: the workflow has no fs/import
capability, so all estimation/routing file work lives HERE in the standalone script,
dispatched from the workflow via the `agent()`-wraps-CLI pattern (same as
`_preflightAgentCall`, `prepare-milestone.js` line 286).

Exported symbols and rules (all deterministic — no randomness, sorted expansion):

- **`expandTouchSet(taskText, workspace)`** — reads `## Touches`, glob-expands each entry
  against the workspace via `fs` + deterministic sorted output. If `## Touches` is missing,
  or ANY entry is a glob that matches zero real files (a line that is not a plain existing
  path), returns `{ ok: false }` → the estimate is `scope-estimate-unavailable` (sizing
  proposal §3.2/§9.2; ledger finding `6f5f90ca`).
- **`estimateTaskSize(taskText, { workspace, policy })`** → deterministic
  `{ codeScale, proofScale, sizeTier, logicalSurfacesCount, mechanismCount, inputValid }`:
  - `codeScale = 25 * AC_count + 60 * expandedLogicalTouchesCount` where `AC_count` =
    `countBoxes(extractSection(taskText, "Acceptance Criteria")).total` and
    `expandedLogicalTouchesCount` = `expandTouchSet(...).files.length`.
  - `sizeTier` = `S` `[0,500]` / `M` `[501,900]` / `L` `[901,∞)` (sizing proposal Table 4.1
    reference bands, from `_ROUTING_POLICY`).
  - `logicalSurfacesCount` = number of distinct `(areaRoot, kind)` logical surfaces over the
    expanded touch set, where `areaRoot` = first path segment (`experiments` / `plugin` /
    `.claude` / `packages`) and `kind` = `test` if the path contains `/test/`, else `source`.
  - `mechanismCount` = number of distinct `areaRoot` values that contribute a `source`
    surface (a deterministic "one mechanism" proxy: one coherent mechanism touches one
    coherent source area; this task's set spans `.claude`, `plugin`, `experiments` → one
    `source` mechanism for the estimator + its two mirrors).
- **`classifyProofScale(taskText)`** → `local | integration | real-workflow |
  cross-generation | unknown`, deterministic:
  1. Explicit declaration `proofScale\s*[:=]\s*(local|integration|real-workflow|cross-
     generation)` in frontmatter/body → that value.
  2. Else keyword-derive from the concatenation of `## Definition of Done` + `## Human
     verification` + `## Acceptance Criteria`: `cross-generation` → `cross-generation`;
     else `real-workflow`/`real dispatch`/`real-object` → `real-workflow`; else
     `integration` → `integration`; else `local`.
  3. If `## Definition of Done` is entirely absent → `unknown` (nothing to derive a proof
     surface from) → **fail-closed full-lane**.
  This is the vocabulary the task mandates (`local | integration | real-workflow |
  cross-generation`); the sibling doc's `unit | integration | ...` variant (quay-execute-
  milestone-build-efficiency.md:30) is backlog for DIR-124-D to canonicalize (ledger finding
  `cb6fa965`, accepted as noted — A uses the task's own value-set).
- **`_ROUTING_POLICY`** — the ONE versioned policy snapshot (single named thresholds
  location; never scattered inline literals; resolves ledger finding `6c5062df`):
  ```js
  const _ROUTING_POLICY = {
    policyRegistryRef: 'DIR-124-D',          // eventual owner of these thresholds (status: todo)
    policyVersion: 'provisional-m239',       // placeholder until DIR-124-D lands
    fastLaneCodeChurnCeiling: 800,           // provisional — deferred to DIR-124-D
    fastLaneMaxLogicalSurfaces: 5,           // provisional
    proofScaleFastLaneAllowlist: ['local', 'integration'],
    mTierFullLaneFloor: 501,                 // M band 501-900 → full-lane until DIR-124-D
                                             //   resolves the ~800-vs-M overlap
  };
  ```
  When DIR-124-D lands, the swap is a one-location replacement (read the registry) — the
  decision's `thresholdsRef` already names `policyRegistryRef: 'DIR-124-D'` +
  `policyVersion`, satisfying AC4's "references the registry version, not hardcoded
  thresholds" under the accepted-risk disposition.
- **`routeTask(estimate, policy)`** → `fast-lane | full-lane`. `fast-lane` ONLY when
  `inputValid && proofScale ∈ allowlist && codeScale <= fastLaneCodeChurnCeiling &&
  logicalSurfacesCount <= fastLaneMaxLogicalSurfaces && mechanismCount === 1 &&
  sizeTier === 'S'`; everything else (including M/L tier, unknown proofScale,
  `scope-estimate-unavailable`) → `full-lane`. Full-lane IS today's path.
- **`buildRoutingDecision(taskText, charterText, { workspace, policy })`** →
  `PrepareRoutingDecision`:
  ```js
  {
    schemaVersion: 1,
    route: 'fast-lane' | 'full-lane',
    codeScale, proofScale, sizeTier,
    logicalSurfacesCount, mechanismCount, inputValid,
    thresholdsRef: { policyRegistryRef: 'DIR-124-D', policyVersion: 'provisional-m239' },
    materialInputHashes: {
      taskProposal: sha256(extractSection(taskText, 'Proposal')),
      taskTouches:  sha256(extractSection(taskText, 'Touches')),
      charter:      sha256(charterText),
    },
    runIdentityBinding: { declared: true, enforced: false, bindingTask: 'DIR-124-B' },
    decisionHash: sha256(_canonicalJSON({ ...decision minus decisionHash })),
  }
  ```
  The `decisionHash` is the self-hash over the decision's material inputs (AC4's hash-bound
  within A's scope — the milestone cannot touch `milestone-preparation-check.ts`, which is
  not in A's `## Touches`). `runIdentityBinding` declares (never enforces) the DIR-124-B
  RunIdentity/StageReceipt binding (AC5): when B lands, the decision is re-homed into B's
  receipt; until then it is emitted standalone.
- **CLI**: `node --experimental-strip-types
  experiments/quay-perpetual-stream/scripts/prepare-milestone-size-estimate.ts --estimate
  --task tasks/<id>.md --charter <charter> --workspace . --out
  milestones/M<NN>/routing-decision.json`. Reads the task + charter, computes the decision,
  writes the sidecar atomically (`fs.mkdirSync(dirname(out), { recursive: true })` +
  write-temp-then-rename, mirroring the repo's `_atomicWriteJson` convention), and prints the
  decision JSON to stdout.

### Workflow wiring: `prepare-milestone.js` (both mirrors)

- New **`_sizeEstimateAgentCall(flagsText, label)`** beside `_preflightAgentCall` (line 286):
  same `agent()`-wraps-CLI shape, `schema: { raw: string|null }`, `phase: 'Preflight'`.
- Routing stage inserted IMMEDIATELY AFTER the `Preflight (content) PASSED` log (line 644),
  BEFORE `let _proposals = []` (line 646):
  ```js
  const _routingResult = await _sizeEstimateAgentCall(
    `--estimate --task tasks/${_taskId}.md --charter ${_charterFile} --workspace . --out milestones/${_milestoneId}/routing-decision.json`,
    'size-routing')
  let _routingDecision = _routingResult?.raw ? _parseAgentJson(_routingResult.raw) : null
  if (!_routingDecision || typeof _routingDecision.route !== 'string') {
    log(`M239 routing FAILED — no parseable decision (raw: ${_routingResult?.raw ?? '(none)'}). Failing closed to full-lane; prepare continues on today's path.`)
    _routingDecision = { route: 'full-lane', codeScale: null, proofScale: 'unknown', failure: 'routing-check-failed' }
  }
  log(`M239 routing: route=${_routingDecision.route} codeScale=${_routingDecision.codeScale} proofScale=${_routingDecision.proofScale} thresholdsRef=${_routingDecision.thresholdsRef?.policyRegistryRef}@${_routingDecision.thresholdsRef?.policyVersion}`)
  ```
  This site is reached by BOTH the cold and `resumeFromAdjudicatedProposal` branches (the
  preflight-content call at line 621 runs unconditionally before line 649), so it is the
  honest meaning of AC1's "every reachable singleton prepare path": every code path that
  reaches the routing call site after Preflight content passes. Paths that return BEFORE
  `phase('Preflight')` (missing-required-args line 123, admission-check-failed,
  prepare-already-running, epoch-cap-admission line 475, resume-decision-failed line 515,
  reuse-terminal line 526, split-decision-blocks-dispatch) never reach routing and are out
  of scope — stated explicitly to resolve ledger finding `3c34d381`. The "composite primary
  tasks route through the same workflow" parenthetical is grounded in execute-milestone.js's
  real composite dispatcher (`_isComposite`/`_taskIds`/`_primaryTaskId`, line 52-60): every
  composite member is prepared through this SAME per-task `prepare-milestone.js` workflow —
  prepare-milestone.js itself has no composite/singleton/primary branching.
- Routing is **emission-only**: the route value is logged and the sidecar written, but NO
  ProposalReview/PlanCheck dispatch count, no reviewer count, and no prompt text changes
  (explicit non-goal; resolves ledger finding `cf73d129`). A routing failure never blocks
  prepare — it fails closed to full-lane, which is byte-for-byte today's path.

## Stopping rule

Standardized DIR-117 stopping rule: at most **3** Plan-check rounds; success only at
**F_i = 0** (zero material findings). A nonzero-but-unchanged finding count is still a
failure. Round 3 with F_i > 0 escalates to human/architect review rather than a 4th round.

---

## Phase A — RED (tests first, TDD)

### Stage 1: RED — estimator + routing cases in the experiments test file
- AC: 1, 3, 4, 6, 7
- Files: experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs
- Command: scripts/test.sh --test-name-pattern="estimateTaskSize|proofScale|fast-lane|routing decision|fail-closed|scope-estimate-unavailable" experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs
- Type: [code]
- Budget: ~170 lines added
- Depends on: (none — standalone RED)
- Expected exit behavior: the NEW tests fail (RED, nonzero exit) because
  `prepare-milestone-size-estimate.ts` does not exist yet; the pre-existing suite must still
  pass (no collateral breakage). New tests (driving the estimator script directly, via
  in-process import of `estimateTaskSize`/`classifyProofScale`/`routeTask`/
  `buildRoutingDecision`):
  - `S-local fixture (1 AC, 1 touch → codeScale 85, proof local, 1 surface, mechanism 1) → route fast-lane` (AC1/AC3 — RED)
  - `S-real-workflow fixture (1 AC, 1 touch, DoD says "real-workflow evidence") → proofScale real-workflow → route FULL-lane` (AC3 — RED, the proofScale negative)
  - `M fixture (15 AC, 3 touches → codeScale 555, within the ~800 churn ceiling, sizeTier M) → route full-lane via mTierFullLaneFloor` (AC3 — RED, the deferred overlap negative)
  - `unknown proofScale (task with NO ## Definition of Done section) → fail-closed full-lane` (AC6 — RED)
  - `missing ## Touches OR an unexpandable touch glob → inputValid false → scope-estimate-unavailable → full-lane` (AC6 — RED, unreliable-INPUTS fail-closed beyond AC6's unknown-VALUES wording)
  - `decision is versioned: decisionHash present, thresholdsRef.policyRegistryRef === "DIR-124-D", policyVersion non-empty, runIdentityBinding {declared:true, enforced:false}` (AC4/AC5 — RED)
  - `deterministic: the same task text produces byte-identical decisionHash across two calls` (AC1 — RED)

### Stage 2: RED — real-workflow routing emission in the plugin test file
- AC: 2, 5
- Files: plugin/test/prepare-milestone-size-estimate.test.mjs
- Command: scripts/test.sh --test-name-pattern="routing emission|routing decision|mirror identical" plugin/test/prepare-milestone-size-estimate.test.mjs
- Type: [code]
- Budget: ~90 lines added
- Depends on: (none — parallel to Stage 1)
- Expected exit behavior: the NEW tests fail (RED) because the workflow mirrors do not yet
  emit a routing decision. These tests drive the REAL `.claude/workflows/prepare-milestone.js`
  and `plugin/workflows/prepare-milestone.js` through the existing fixture harness (which
  stubs only the agent HTTP channel) — the routing stage runs for real. New tests (one per
  `MIRRORS` entry):
  - `[mirror] Preflight emits a versioned PrepareRoutingDecision and logs route=... for a task whose --estimate CLI returns a valid decision` (AC2 — RED)
  - `[mirror] routing CLI failure (no parseable stdout) fails closed to route=full-lane and the prepare path CONTINUES unchanged (full-lane = today's path; emission-only)` (AC2 — RED)
  - `[mirror] the emitted decision carries runIdentityBinding {declared:true, enforced:false, bindingTask:"DIR-124-B"}` (AC5 — RED)

## Phase B — implementation (estimator script, both mirrors edited together)

### Stage 3: implement the estimator + routing CLI (experiments script)
- AC: 1, 3, 4, 6, 7
- Files: experiments/quay-perpetual-stream/scripts/prepare-milestone-size-estimate.ts
- Command: scripts/test.sh --test-name-pattern="estimateTaskSize|proofScale|fast-lane|routing decision|fail-closed|scope-estimate-unavailable" experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs
- Type: [code]
- Budget: ~260 lines (new script)
- Depends on: Stage 1
- Expected exit behavior: the Stage-1 RED tests turn GREEN. Implements
  `expandTouchSet`/`estimateTaskSize`/`classifyProofScale`/`routeTask`/
  `buildRoutingDecision` + `_ROUTING_POLICY` + the `--estimate` CLI (sidecar write + stdout
  JSON). All arithmetic per the Design section; imports `extractSection`/`countBoxes` from
  `./task-schema.ts` (never reimplemented).

### Stage 4: mirror the estimator to the plugin scripts dir (byte-identical)
- AC: 4
- Files: plugin/scripts/prepare-milestone-size-estimate.ts
- Command: diff experiments/quay-perpetual-stream/scripts/prepare-milestone-size-estimate.ts plugin/scripts/prepare-milestone-size-estimate.ts
- Type: [code]
- Budget: ~0 lines net (byte-identical copy; the `./task-schema.ts` import resolves in both
  dirs — the mirror exists)
- Depends on: Stage 3
- Expected exit behavior: the `diff` between the two estimator mirrors is EMPTY (exit 0). The
  plugin script is a byte-identical copy (same no-import/same-path-import mirror discipline
  as `prepare-milestone.js`). The plugin test file from Stage 2 drives this mirror.

## Phase C — workflow mirrors

### Stage 5: wire the routing stage into `.claude/workflows/prepare-milestone.js`
- AC: 2, 5
- Files: .claude/workflows/prepare-milestone.js
- Command: scripts/test.sh --test-name-pattern="routing emission|routing decision|mirror identical" plugin/test/prepare-milestone-size-estimate.test.mjs experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs
- Type: [code]
- Budget: ~30 lines
- Depends on: Stage 3
- Expected exit behavior: the Stage-2 plugin-test RED tests turn GREEN. Adds
  `_sizeEstimateAgentCall` (beside `_preflightAgentCall`, line 286) and the routing block
  after the `Preflight (content) PASSED` log (line 644) exactly as specified in the Design
  section: dispatch `--estimate` (writing `milestones/${_milestoneId}/routing-decision.json`),
  parse the decision, fail-closed to full-lane on unparseable output, log
  route/codeScale/proofScale/thresholdsRef. NO change to ProposalReview/PlanCheck dispatch
  counts, reviewer counts, or prompts (emission-only non-goal). The workflow-edit acceptance
  is the mechanical discipline this repo uses for no-import script mirrors (a mirror
  cross-check test + `diff`), NOT a coverage percentage — `prepare-milestone.js` is not
  coverage-instrumented by `scripts/test.sh`.

### Stage 6: apply the identical edit to `plugin/workflows/prepare-milestone.js`
- AC: 2
- Files: plugin/workflows/prepare-milestone.js
- Command: diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js
- Type: [code]
- Budget: ~0 lines net (byte-identical copy of the Stage-5 edit)
- Depends on: Stage 5
- Expected exit behavior: the `diff` of the two workflow mirrors is EMPTY (exit 0). The
  `[mirror]` plugin-test cases and the existing source-regex mirror cross-check turn GREEN.

## Phase D — GREEN verification

### Stage 7: full GREEN — both test files, coverage, mirror diffs, full suite
- AC: 7
- Files: experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs, plugin/test/prepare-milestone-size-estimate.test.mjs
- Command: scripts/test.sh --experimental-test-coverage experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs plugin/test/prepare-milestone-size-estimate.test.mjs
- Type: [code]
- Budget: ~10 lines (test corrections if any)
- Depends on: Stages 1-6
- Expected exit behavior: both test files run fully GREEN. Coverage gate:
  `experiments/quay-perpetual-stream/scripts/prepare-milestone-size-estimate.ts` (the
  coverage-instrumented [code] surface) must hold >=80% line coverage, including the
  `expandTouchSet` fail-closed, `classifyProofScale` unknown branch, `routeTask` M-tier /
  surfaces / mechanism branches, and `buildRoutingDecision` decisionHash paths. Then the full
  safe suite `scripts/test.sh` (no args) exits 0. Both mirror diffs (Stage 3/4 pair, Stage
  5/6 pair) remain empty — re-verified here.

## Phase E — real-landing verification

### Stage 8: real-object routing evidence + dispatch before/after + fresh audit
- AC: 1, 3, 6
- Files: experiments/quay-perpetual-stream/scripts/prepare-milestone-size-estimate.ts, tasks/gap-prepare-milestone-no-size-aware-routing-A.md, milestones/M239/routing-decision.json
- Command: Check: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/prepare-milestone-size-estimate.ts --estimate --task tasks/gap-prepare-milestone-no-size-aware-routing-A.md --charter experiments/quay-perpetual-stream/charters/M239-gap-prepare-milestone-no-size-aware-routing-A.md --workspace . --out milestones/M239/routing-decision.json
- Type: [prose]
- Budget: 0 code lines (verification + evidence recording)
- Depends on: Stages 4, 7
- Expected exit behavior: real-object discipline — real objects operated through the
  mechanism, evidence recorded, not asserted:
  1. Run the real CLI against the real A task + charter; the sidecar
     `milestones/M239/routing-decision.json` is written and the printed decision sampled:
     `schemaVersion`, `route`, `codeScale`, `proofScale`, `sizeTier`,
     `thresholdsRef.policyRegistryRef === 'DIR-124-D'` + non-empty `policyVersion`,
     `materialInputHashes`, and a present `decisionHash` (AC1/AC4).
  2. RED/GREEN controls against the REAL estimator: a synthetic S-real-workflow task (DoD
     says "real-workflow evidence") routes `full-lane` (AC3), a synthetic S-local task routes
     `fast-lane`, an M-tier fixture routes `full-lane`, and a task with no `## Definition of
     Done` routes `full-lane` (AC6). Record each raw verdict.
  3. A real prepare-milestone dispatch of this task class runs through the pipeline emitting
     the routing decision WITHOUT changing review behavior — the Stage-2 plugin tests already
     drive the real workflow; post-Land, a real dispatch's `routing-decision.json` +
     workflow log line are captured (DoD item 2 — real dispatch evidence).
  4. Fresh independent audit of the landed milestone (DoD item 3) finds no refutation.

## Guardrails / rollback / real-landing verification

- **Guardrails**
  - **Emission-only (ledger finding `cf73d129`):** the route value NEVER changes
    ProposalReview/PlanCheck dispatch counts, reviewer counts, or prompt text. Full-lane is
    byte-for-byte today's path. This is an explicit non-goal, not an omission.
  - **Fail-closed (AC6 + `6f5f90ca`):** unknown proofScale (no DoD section), unknown/unreliable
    codeScale inputs (missing `## Touches`, unexpandable glob), and an unparseable routing-CLI
    stdout each route full-lane. A routing failure NEVER blocks prepare.
  - **Determinism (AC1):** no randomness, no wall-clock inputs to the estimate or the hash;
    sorted expansion; identical task text → identical `decisionHash`.
  - **Thresholds single-sourced (`6c5062df`):** all fast-lane numbers live in the one
    `_ROUTING_POLICY` snapshot with `policyRegistryRef: 'DIR-124-D'` + provisional
    `policyVersion`; the DIR-124-D migration is a one-location swap, never a hunt for inline
    literals.
  - **Mirrors byte-identical:** two `diff` gates (estimator pair Stage 3/4, workflow pair
    Stage 5/6) + the existing source-regex mirror cross-check.
  - **Vocabulary (`cb6fa965`):** A uses the task-mandated `local | integration |
    real-workflow | cross-generation` value-set; canonicalizing the sibling doc's `unit`
    variant is backlog for DIR-124-D, not this milestone.
  - **Split ordering (`e129f9fd`):** B and C depend on A (not vice versa); A is not blocked by
    anything within the split.
- **Rollback**
  - The change is additive: a new standalone script (both mirrors), a new routing stage in the
    two workflow mirrors, two new test files. Rollback = `git revert` of the milestone's Land
    commit; `milestones/M239/routing-decision.json` is a runtime sidecar removed with the
    revert. No existing prepare behavior is altered (full-lane path untouched).
- **Real-landing verification**
  - `scripts/test.sh` (full suite) exits 0 post-Land; both mirror diffs empty; coverage >=80%
    on `prepare-milestone-size-estimate.ts`.
  - A real prepare-milestone dispatch emits `routing-decision.json` with the correct
    route/proofScale for a real task (DoD item 2 — the Stage-8 recorded evidence).
  - Fresh independent audit finds no refutation (DoD item 3).
