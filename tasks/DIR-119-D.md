---
id: DIR-119-D
title: Literally wire phase-DAG Build, read-only audit shards, and deterministic
  Reconcile into execute-milestone.js; add real manifest phase/shard synthesis;
  fix Gate-failure task attribution
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: DIR-119
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

Close, as literal callable production code, the execution-side gaps that DIR-119-B deliberately
left as tested-but-uninvoked contract modules and that DIR-119-C's real canary run neither delivered
nor (in its independent audit) checked for: (1) phase-DAG Build / read-only audit shards / a
deterministic Reconcile owner of all state mutation, (2) manifest phase/shard synthesis from a flat
SELECT-produced `MilestoneCandidate`, and (3) per-member Gate-failure attribution. This milestone
edits the active execution-chain control plane (both `execute-milestone.js` mirrors, byte-identical
today) under human-steered halt discipline, and is the first dispatch under the M195/DIR-117-B
enforced-by-default Prepared gate (it carries a real `prepare-milestone.js` receipt).

### Problem framing (verified against current code, 2026-07-28)

All evidence below was re-derived this session against live HEAD, not copied from the task body:

- **The four execution modules are an uncalled island.** Import-graph grep (excluding `test/`):
  `composite-build.ts` — zero importers anywhere; `composite-audit.ts` — imported only by
  `composite-reconcile.ts:11` (a *type-only* import); `composite-reconcile.ts` — imported only by
  `composite-land.ts:10` (type-only); `composite-land.ts` — zero importers. Every reference inside
  `.claude/workflows/execute-milestone.js` is *prose inside agent prompts*: Build's "2a. COMPOSITE
  BUILD … MAY serialize all phases through you as the one Build lead" (~line 246), Audit's
  "composite-audit.ts's stricter shard-level read-only boundary is the target architecture pending
  a real per-shard dispatcher" (~line 282), Land's `_compositeLandNote`
  (~lines 400–402); `composite-reconcile.ts` is not referenced at all and is reachable only through
  a `--selftest` guard. The single genuinely-wired composite callsite is Verify's
  `composite-preflight.ts` shell-out (~lines 132–135).

- **Build is one monolithic agent regardless of manifest width** — a single unlabeled `agent()` call
  (~line 229). `meta.phases` (~lines 4–11) is Verify/Prepared/Build/Audit/Gate/Land: **there is no
  Reconcile phase**.

- **Audit is one agent that writes.** The Audit prompt instructs checklist write-back (step 1a,
  ~line 289), absorb-disposition append (step 2a, ~line 292), and deviation-log write-back (step 4,
  ~line 309) — the exact mutations the architecture assigns to Reconcile. `composite-audit.ts`'s
  `runReadOnlyAuditShard` deep-freeze boundary is never on any production path, and in any case
  binds in-process JS mutation only, not a dispatched agent's filesystem.

- **Gate failure attribution is primary-task-only.** ~Lines 367–375:
  `gatesFailed = gates.filter(Boolean).some(g => !g.ok)` → `Mark task ${_primaryTaskId} needs-human`.
  The per-member gates already carry identifying labels — `split-or-commit-${tid}` (~lines 351–353)
  — but the failure branch discards that information; no passing-subset record exists.
  M-DIR119-C-CANARY's 7 gates all passed, so this branch has never executed in production.

- **No production manifest synthesis exists.** The only `CompositePhase[]` producers are
  `makeValidCompositeFixture`/`makeSharedPhaseCompositeFixture` (`composite-contracts.ts:208`…),
  commented test-fixture-only. SELECT's real pipeline (`select-preflight.ts`
  `synthesizeCandidatePortfolio()` → `coupling-graph.ts` → `candidate-synthesis.ts` →
  `portfolio-choice.ts`) emits a flat `MilestoneCandidate{candidateId, taskIds, score, sourceHashes}`
  (`candidate-contracts.ts:111–136`) — no phases/shards. No composite-manifest artifact is committed
  anywhere in the repo; M-DIR119-C-CANARY's manifest was a hand-authored ephemeral `/tmp` file.

This directive exists because the independent wiring audit dispatched for DIR-119-C's Stage 3.4
(session `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`) verified journal call-counts, commit atomicity, and
AC-citation evidence, but did NOT trace production import graphs or exercise the Gate-phase failure
branch — those two defects were found afterward by direct code reading. This is itself evidence for
DIR-118's premise; DIR-118, if executed, should treat this originating incident as an additional
Finding item.

### The hard constraint that shapes the mechanism

Workflow DSL scripts have NO `import` capability — only `phase`/`agent`/`parallel`/`log`/`args`
globals (stated at `execute-milestone.js` ~lines 21–24 and `composite-preflight.ts`'s header, lines
1–5); there are no `readFile`/bash globals either. "Literal wiring of X into execute-milestone.js"
therefore cannot mean an ES-import edge or a workflow that reads the manifest file itself; the ONLY
viable production invocation edge is the established `composite-preflight.ts` pattern — a canonical
TS module with a JSON-in/JSON-out/exit-code CLI (built on `gate-script-base.ts`'s
`parseArgs`/`isDirectEntry`/JSON-emit conventions), run by a labeled agent, with the DSL owning all
fan-out, sequencing, and mechanical comparison. Every wiring
change below is that pattern, and every workflow-to-module claim is provable as (a) a literal
command string in the workflow source and (b) a labeled journal entry in a real dispatch.

### Chosen mechanism

Five increments, each canonical-first in `experiments/quay-perpetual-stream/scripts/` then
byte-copied to the `plugin/` mirror (existing mirror discipline; `plugin-packaging.test.mjs` already
asserts mirror sync, and an AC-level `diff` equality check is added). All new workflow paths are
conditional on `_isComposite && $a.compositeManifestFile` so the legacy width-1 path is byte-for-byte
untouched (golden replay, matching the composite-preflight vacuous-pass precedent).

1. **New canonical module `composite-manifest-synthesis.ts`** — a pure, deterministic
   `synthesizeManifest(candidate, taskFacts, couplingGraph) → {manifest, context}` producer with a
   CLI (`--candidate-json <f> --tasks-dir tasks/ --out <f>`), reusing existing single-sources
   (reused, not reinvented): `touches-orthogonality-check.ts`'s exported
   `parseTouches`/`expandGlobs`/`filesDisjoint` (lines 63/152/162) for per-task touch sets and
   overlap; `coupling-graph.ts`'s `deriveInternalOrderEdges`/`buildCouplingGraph` (lines 100/142)
   plus `candidate-contracts.ts`'s `isProhibiting` for `requires` edges and forbidden-edge context;
   and task-file `## Acceptance Criteria` parsing for `taskAcCounts`. `context` (taskAcCounts,
   taskTouches via `parseTouches`, forbiddenEdges from prohibiting coupling edges, documented
   capacity defaults) is emitted in the SAME file, so the existing `composite-preflight.ts` check
   consumes `{manifest, context}` unchanged (defense in depth: the Verify-phase check re-validates
   what synthesis produced). The CLI runs `checkCompositeContract` on its own output BEFORE writing
   and exits non-zero on any violation — **synthesis can never emit a contract-breaking manifest
   (fail-closed)**; sorted inputs and no timestamps/random ids in the manifest body make the output
   byte-deterministic (same inputs ⇒ identical bytes).

2. **Build becomes phase-DAG dispatch** via a new non-selftest CLI mode on `composite-build.ts`
   (`--plan-json`) that runs `planPhaseExecution(manifest.phases, {mode:"parallel",
   maxParallelAgents: <cap>})` and prints `{batches, owners, agentCount}` JSON. The workflow
   dispatches one planner agent for that CLI, then loops over the batches: `await parallel(...)` of
   one labeled `agent()` per phase within a batch (label `build-phase-${phaseId}`, prompt scoped to
   that phase's `taskIds` + manifest excerpt + evidence contract), batches run serially — which is
   exactly what "respect `requires` edges" means mechanically. A final `--map-evidence-json` CLI
   call (`mapEvidenceToTasks`) folds each phase agent's `PhaseEvidence{phaseId, files, commits,
   tests}` into the iteration report.

3. **Audit becomes per-shard dispatch with a mechanical read-only check.** One labeled `agent()` per
   `auditShards[]` entry (label `audit-shard-${shardId}`), each prompt scoped to that shard's
   `taskIds` ONLY and stripped of ALL write-back instructions (ticks/dispositions/deviation rows
   move to Reconcile). Each shard agent runs `git status --short` before and after its work and
   returns `{before, verdicts: AuditShardResult, after}`; the before/after comparison is performed
   in workflow JS via a trivial inline copy of a new exported pure `checkShardReadOnly(before,
   after)` from `composite-audit.ts` — the *verdict* (shard REFUTED on non-empty diff) is computed
   by the workflow, not self-reported by the agent, matching this workflow's existing trust model
   (agents transport script output; the decision is mechanical). Keeping the snapshots inside the
   shard agent's single call (rather than separate pre/post snapshot agents) is deliberate: it keeps
   the Audit-phase labeled dispatch count EXACTLY equal to `auditShards.length`, which AC#3 greps.
   Shard results are combined by one `--combine-json` CLI call on `composite-audit.ts` invoking
   `combineShardVerdicts`, producing the `BundleAuditResult`.

4. **A literal `Reconcile` phase** inserted into `meta.phases` after Gate and before Land (see
   decision 5) — the only phase whose agents write task AC/DoD ticks, lifecycle status, dashboard
   log row, absorb dispositions, and the consolidated audit artifact (written from the returned
   verdict JSON). Its agent runs a new non-selftest CLI mode on `composite-reconcile.ts`
   (`--reconcile-json`) invoking the real `reconcile()`, then a second CLI on `composite-land.ts`
   (`--land-json`) invoking `buildLandTransaction`; the apply-agent performs exactly the mutations
   the CLI output lists, and Land's composite prompt is stripped to merge/counter/execute-record.

5. **Gate-failure attribution fix.** New exported pure `attributeGateFailures(gates, taskIds)` in
   `composite-reconcile.ts`: partition failures into `failedTaskIds` (parsed from the
   `split-or-commit-${tid}` labels the gates already carry) vs milestone-scoped failures; the
   needs-human agent marks *each failed member* needs-human with its own gate detail (`_primaryTaskId`
   included only if it is among them), and the record lists the `passingTaskIds` ("would otherwise
   have passed"). Land policy stays `atomic` — no partial Land; the fix is attribution fidelity and
   recoverability, not semantics.

### Control/data flow (composite path)

- **SELECT → synthesis:** SELECT produces a `MilestoneCandidate`; OUTER-LOOP.md's `execute()` step
  shells out when `taskIds.length > 1` to the **synthesis CLI** (caller-side, between SELECT output
  and dispatch), writing `/tmp/m<NN>-manifest.json` (`{manifest, context}`).

- **Dispatch:** the caller threads `compositeManifestFile` (OUTER-LOOP `execute()` shape,
  updated).

- **Verify:** `composite-preflight.ts`, unchanged code path — now validating a machine-synthesized
  manifest instead of a hand-authored one.

- **Prepared:** unchanged; its `touches-expanded` trigger per `milestone-preparation-check.ts`
  mechanically enforces `## Touches` declaration accuracy.

- **Build:** plan CLI → per-batch `parallel()` of `build-phase-<id>` agents, each reporting
  `PhaseEvidence`; `--map-evidence-json` folds evidence into the iteration report.

- **Audit:** per-shard agents (inline git snapshots + verdict JSON) → workflow-side
  `checkShardReadOnly` comparison → combine CLI → `BundleAuditResult{generationId = build HEAD
  short-sha}`.

- **Gate:** unchanged per-member `split-or-commit-<tid>` + 4 milestone gates, results carrying
  labels.

- **Reconcile:** `--reconcile-json` with `{bundleAudit, requiredGenerationId,
  taskGates (from split-or-commit results), milestoneGates (from the 4), taskIds}` → on `ok`,
  apply-agent writes the listed mutations.

- **Land:** `--land-json` asserts `counterDelta:1 / dashboardEntryCount:1 / taskCompletionCount:N`
  (the atomicity meter, now machine-checked rather than prompt-asserted), agent merges + bumps
  counter exactly once.

Failure anywhere before Land → needs-human carrying the reconcile/land `reason`, zero state writes
applied.

### Key design decisions

1. **Grouping rule (deterministic, documented, conservative).** Sort member `taskIds`; union-find-
   fuse tasks whose *expanded* touch sets are not provably disjoint (missing/over-broad Touches →
   overlap-with-everything, per `touches-orthogonality-check.ts`'s fail-closed semantics) — each
   connected component becomes one `CompositePhase` (multi-task components carry a derived
   `integrationInvariant`, required by `checkCompositeContract` rule 3); cross-component
   `internal-order` coupling edges become `requires`. Prohibiting-kind coupling edges internal to
   the membership (per `isProhibiting`) REFUSE synthesis fail-closed — that bundle should not have
   been SELECTed. Audit shards: one `task-ac` shard per task, plus one `semantic-integration` shard
   per multi-task phase; `touches`/`semanticResources` = sorted unions; `landPolicy:"atomic"`.
   Consequence worth stating plainly: poorly-declared Touches collapse to ONE phase (still
   contract-valid; Build dispatch count 1 == phase count 1), so a genuinely multi-phase journal
   proof requires well-declared Touches — the real proof dispatch's tasks must have them. This
   fusion rule was chosen over "one phase per task plus a shared phase on overlap" because fusing
   overlapping tasks into one phase with exactly one owner is strictly stronger than dispatching
   overlapping phases that would then conflict in the shared working tree and at merge.

2. **Parallelism safety is grouping-first; worktree isolation is a defensive path only.** Because
   grouping already fuses overlapping tasks, distinct phases are disjoint *by construction*; the
   plan CLI additionally re-checks via the reused `expandGlobs`/`filesDisjoint` and demotes any
   same-batch pair it cannot prove disjoint into successive batches (fail-closed to serialize) —
   serialize is the guaranteed fallback since the DSL gives no evidence of an `isolation` option.
   Where the DSL does honor `isolation:'worktree'`, planner-flagged intersecting phases dispatch
   with it (the task's requested defensive path); the rare inter-phase intersection case is absorbed
   either way. Default `maxParallelAgents` cap is modest (4) for this first real wiring; journal
   Build-dispatch count equals manifest phase count regardless of cap. This does NOT change the
   standing CLAUDE.md rule forbidding concurrent milestone-workflow execution against this repo
   (shared working tree).

3. **Journal-countable labels resolve the mechanical-agent overhead question.** The journal-count
   ACs grep DISPATCH labels: `build-phase-<id>`, `audit-shard-<id>`, `reconcile`, plus
   `split-or-commit-<tid>` (existing) — these are the exact strings AC#2/#3/#4 count, declared
   stable in-module. Mechanical helper agents (planner `build-plan`, combiner `audit-combine`,
   evidence-mapper) carry distinct labels and are excluded by those greps — this is why per-shard
   snapshots are returned inline by the shard agent rather than dispatched as separate pre/post
   snapshot agents (which would triple the Audit-phase call count and break AC#3's
   `count == auditShards.length`). Verify-phase caching does not touch Build/Audit/Reconcile (no
   cache there), so counts are stable.

4. **Composite-without-manifest fails closed.** New default: `_isComposite && !compositeManifestFile`
   → `{outcome:"revision-needed", reason:"composite-manifest-missing", phase:"Verify"}` — mirroring
   the DIR-117-B Prepared flip (a receipt-less composite dispatch is a caller bug; executable
   invariant over prose). The preflight's vacuous-pass-without-manifest behavior is retained only
   for legacy width-1 calls (golden replay). The loop simply never dispatches width>1 without
   synthesizing first (OUTER-LOOP.md gains that one step).

5. **Reconcile sits after Gate, not immediately after Audit.** `reconcile()`'s own contract
   (`composite-reconcile.ts` checks 4–5, lines 77–87) consumes `taskGates` and `milestoneGates` and
   fails closed without them — placing Reconcile before Gate would force feeding it fabricated gate
   results. Order Audit → Gate → Reconcile → Land still satisfies "between the last Audit-shard call
   and Land" (AC#4). Reconcile is guard-skipped at width 1.

6. **Generation identity.** `generationId` = build commit short-sha, threaded into
   `combineShardVerdicts` and checked by `reconcile()`'s existing check 1 — stale/forged audit
   receipts fail closed.

7. **Synthesis callsite is caller-side (OUTER-LOOP `execute()`), not inside SELECT and not inside
   Build.** Placing it in the workflow's Build phase would make the Verify-phase contract check
   (which must validate the manifest BEFORE Build) impossible, and the DSL cannot read task files
   directly; placing it inside `select-preflight.ts` would conflate candidate selection with
   execution planning. Caller-side synthesis between SELECT output and dispatch matches the task's
   requested callsite and lets the loop/human review the manifest pre-dispatch.

### Defaults and failure behavior (fail-closed throughout)

- Width-1 legacy / `{taskId,...}` golden replay: **byte-for-behavior unchanged** — single Build
  agent, single Audit agent *with* its existing write-back steps, no Reconcile dispatch (phase body
  short-circuits with one log line; no new agent calls, no new failure surface), Gate failure branch
  reduces to `failedTaskIds=[_primaryTaskId]` (identical to today), and `legacySingletonLandShape()`
  is machine-asserted at width 1 as the golden-replay comparison target.

- Composite-shape call missing `compositeManifestFile` → Verify fails closed
  (`composite-manifest-missing`).

- Any composite-CLI agent returning null/crash → phase hard-fail (existing Verify convention).

- Manifest-synthesis contract violation → non-zero exit, no file written, caller must not dispatch;
  if surfaced inside the workflow, `{outcome:"revision-needed",
  reason:"manifest-synthesis-failed:<code>"}` (caller-fixable, matching the Prepared phase's
  reason-code precedent).

- Read-only violation (non-empty porcelain diff) → that shard REFUTED → bundle REFUTED →
  `needs-human, audit-shard-write-violation:<shardId>` → reconcile `ok:false` → working tree
  untouched by Audit (mechanically evidenced).

- Reconcile `ok:false` (any of its 5 reasons) → `needs-human, reconcile-failed:<reason>`; zero
  mutations applied.

- `buildLandTransaction` `ok:false` → no counter increment, no dashboard entry, no task marks.

- Gate failure → `needs-human, gate-failed:<failed-task-ids>`, naming the specific failing member(s)
  and recording the passing subset; whole bundle still does not land (atomic).

### Compatibility

Legacy `{taskId,...}` golden replay preserved on every branch (inline normalization, vacuous
preflight at width 1, single-call Build/Audit, legacy Land shape). The M-DIR119-C-CANARY dispatch
shape (`compositeManifestFile` in `/tmp`) remains valid. `concurrent_execute` dispatches
per-candidate width-1 singletons and is untouched; composite-AND-concurrent is rejected fail-closed
(`revision-needed, composite-concurrent-unsupported`) — fan-in ABSORB's deferred shared-state writes
conflict with Reconcile-owned writes; this combination is a non-goal. Both mirror pairs
(`.claude/workflows/` + `plugin/workflows/`, `experiments/.../scripts/` + `plugin/scripts/`) stay
byte-identical (AC-checked `diff`; `plugin-packaging.test.mjs` mirror assertion). The OUTER-LOOP.md
`execute()` shape gains `compositeManifestFile` passthrough, and the Plan must re-declare
`## Touches` to include the new synthesis module, its mirror, its test file, and the SELECT-side
callsite file; the Prepared gate's `touches-expanded` trigger mechanically enforces declaration
accuracy. No ABI/product-package (`packages/`) surface is touched.

### Risks

(a) The DSL no-import constraint forces inline workflow copies of small pure logic (precedent:
`_normalizeExecuteArgsInline`, `_compositeLandNote`) — mitigated by keeping inline copies trivial
(`checkShardReadOnly` is a string-equality check) and canonical modules authoritative, re-verified
by composite-preflight.

(b) Per-phase Build agents each need enough context — prompts carry the
phase's `taskIds`, the manifest excerpt, and the evidence-mapping contract; shared phases have
exactly one owner by construction.

(c) Touches-collapse-to-one-phase masks width (decision 1) —
mitigated by requiring the real proof dispatch's tasks to have disjoint, precise Touches (Prepared
gate enforces declaration), and by RED/GREEN synthesis fixtures showing both the collapsed and the
multi-phase shapes.

(d) Mirror drift — byte-copy + `diff` AC + `plugin-packaging.test.mjs`.

(e) This
edits the control plane through which every future milestone runs — mitigated by width-1 golden
replay, conditioning all new paths on the composite shape, root-level `.halt` +
`restart-readiness-check.sh` discipline per CLAUDE.md/DIR-027, and never overlapping this
milestone's Land with any other live milestone (shared working tree).

(f) Shard agents could in principle
lie about their returned git snapshots — mitigated because the snapshot prompt is a single
schema-constrained bash command under journal replay, the RED fixture plants a write through the
filesystem (visible to any honest snapshot), and the fresh independent audit re-derives state from
journal replay.

(g) Porcelain diff could false-positive on unrelated concurrent writers — mitigated
by the existing single-driver rule and by recording the full delta in the failure evidence.

### Non-goals

Repeating width-7 (2–3 real tasks suffice); changing SELECT-side candidate synthesis/scoring
(`candidate-synthesis.ts`/`portfolio-choice.ts` — the DIR-119-A surface); partial/non-atomic Land of
the passing subset (violates `landPolicy:"atomic"`, contract-enforced by `checkCompositeContract`
rule 8 — the fix is attribution, not atomicity); composite dispatch under `concurrent_execute`;
reworking the 4 milestone gates or it0 checks; product-package (`packages/`) changes; adding
`import`/`readFile` capability to the workflow DSL (harness-internal); git-worktree-per-phase as a
PRIMARY isolation mechanism (grouping + fail-closed serialize deliver the safety property now;
worktree remains a defensive path only); NLP-level mechanism-claim detection; executing DIR-118
(though this incident is handed to it as a Finding).

### AC coverage

- **AC#1 (import-graph, the self-declared gate):** increments 1–5 each add a non-selftest CLI +
  literal invocation line in both mirrors; proven by grep/import-graph in the fresh audit
  (Requested-action 9) — the check finds invocation edges, not prose.
- **AC#2/#3 (Build dispatch count == phase count; Audit dispatch count == shard count, scoped):**
  decisions 2–3; per-phase/per-shard dispatch loops make the labeled counts structurally equal to
  phase/shard counts; shard scope proven by the prompt's `taskIds` + the porcelain check.
- **AC#4 (Reconcile entry between last Audit and Land; clean tree through Audit, dirty only at
  Reconcile):** increment 4 + decision 5 + per-shard git snapshots + journal ordering.
- **AC#5/#6 (RED/GREEN for hostile-shard-write catch; failing-member attribution):**
  `checkShardReadOnly` workflow-side comparison (hostile planted write caught vs clean shard passes,
  both states shown); `attributeGateFailures` + synthetic ≥2-task fixture proving the needs-human
  record names the failing member, not `_primaryTaskId`.
- **AC#7 (synthesis on a REAL SELECT-produced candidate, satisfying composite-preflight):**
  increment 1 + the real dispatch uses the synthesized manifest, not a hand-authored one.
- **AC#8 (legacy width-1 identical):** Compatibility/Defaults sections; golden-replay assertions
  incl. `legacySingletonLandShape()`; Reconcile guard-skipped at width 1.
- **AC#9/#10 (fresh audit briefed on import graphs + Gate-failure branch; DIR-119-C AC#5/#10
  re-confirmed):** DoD items, using the M195 independent-wiring-audit posture as template.

### Mechanism-claim wiring coverage (DIR-117) — each claim flagged for AC-level proof

Every sentence below asserts a new call/dispatch/ownership/enforcement relationship between
backtick-named components, paired with the AC that must prove it with evidence:

- **W1**: the caller (OUTER-LOOP `execute()`) invokes `composite-manifest-synthesis.ts` between
  SELECT output and dispatch → AC#7 (real SELECT-produced candidate exercises it; callsite is
  grep-confirmable) + AC#1.

- **W2**: `composite-manifest-synthesis.ts` invokes `checkCompositeContract` as self-validation and
  reuses `touches-orthogonality-check.ts` (`parseTouches`/`expandGlobs`/`filesDisjoint`) +
  `coupling-graph.ts` exports → AC#7 (output satisfies composite-preflight's contract check) +
  unit tests.

- **W3**: `execute-milestone.js`'s Build phase dispatches an agent that invokes `composite-build.ts`
  (`--plan-json` / `--map-evidence-json`) → AC#1 (real production callsite).

- **W4**: `execute-milestone.js` dispatches one Build agent per manifest phase via `parallel(...)`
  within batches / serial across batches → AC#2 (journal `build-phase-<id>` count == phase count).

- **W5**: `execute-milestone.js`'s Audit phase dispatches one agent per `auditShards[]` entry →
  AC#3 (`audit-shard-<id>` count == shard count, per-shard scope in prompts).

- **W6**: `execute-milestone.js` enforces the shard read-only boundary via mechanical
  `checkShardReadOnly` comparison of agent-returned `git status --short` snapshots in DSL code,
  hard-failing on non-empty diff → AC#5 (RED/GREEN hostile-write catch).

- **W7**: `execute-milestone.js` dispatches an agent that invokes `composite-audit.ts`'s
  `--combine-json` (`combineShardVerdicts`) → AC#1.

- **W8**: the Gate failure branch routes attribution from per-task gate labels via
  `attributeGateFailures` into the needs-human record naming the specific failing member(s) →
  AC#6 (RED/GREEN failing-member fixture).

- **W9**: `execute-milestone.js` owns a literal Reconcile phase between Audit and Land that is the
  ONLY phase permitted to write task/dashboard/absorb state → AC#4 (journal entry + git-diff
  timing: tree clean through Audit, dirty only at Reconcile).

- **W10**: the Reconcile phase dispatches an agent that invokes `composite-reconcile.ts`'s real
  `reconcile()` (not `--selftest`) → AC#1 + AC#4.

- **W11**: the composite Land path invokes `composite-land.ts`'s `buildLandTransaction`
  (`--land-json`) and remains atomic, the transaction meter machine-checked → AC#1 + DoD
  atomic-Land evidence.

- **W12**: width-1 dispatch routes through NO new phase (Reconcile guard-skipped; Build/Audit single
  calls retained) → AC#8 (behavior-identical golden replay).

- **W13**: the `plugin/` mirrors are byte-synced from canonical → AC#1's import-graph check runs
  against BOTH mirrors + `diff` equality; and the fresh independent wiring audit traces production
  import graphs for all four modules + the synthesis step AND exercises the Gate-failure branch →
  AC#9 + AC#10 (DIR-119-C AC#5/#10 re-confirmation before DIR-119-C/DIR-119 promotion).

### Alternatives considered and rejected

1. **`import`-based wiring** — impossible: the DSL exposes no `import` (`composite-preflight.ts`
   header, lines 1–5); CLI shell-out is the only literal-wiring mechanism this control plane
   supports (working precedent: composite-preflight). Rejected by construction; adding DSL import
   capability is harness-internal and out of scope.

2. **Sharper agent-prompt guidance referencing the tested modules (the status quo)** — this IS the
   defect; DIR-119-B's own DoD admits guidance is not invocation, and it is unverifiable by
   import-graph. Rejected.

3. **One TS orchestrator the workflow calls once per phase-group** — collapses back to a monolith
   (journal would show one Build/one Audit call, violating AC#2/#3) and re-centralizes write
   authority in the agent. Rejected.

4. **`planPhaseExecution` default `mode:"serialize"` for the composite path** — yields
   `agentCount:1` at any width, directly falsifying AC#2; serialize remains the module default for
   other callers, but the workflow passes `parallel`.

5. **Synthesis inside Verify or inside Build** — violates "production callsite between SELECT
   output and dispatch", would re-order the preflight's manifest check after dispatch began, and
   makes the pre-Build contract check impossible; rejected.

6. **Separate pre/post snapshot agents around each shard** — triples the Audit-phase journal call
   count, breaking AC#3's `count == auditShards.length`; agent-returned snapshots + workflow-side
   mechanical comparison keeps the count exact while keeping the *decision* mechanical.

7. **Enforce audit read-only via `composite-audit.ts`'s `deepFreeze`/`structuredClone` alone** —
   binds in-process JS mutation only; a dispatched agent writes through the filesystem, which only
   the git-porcelain comparison can catch. The in-process isolation remains the unit-level proof
   surface.

8. **Allow-listed artifact writes for audit shards** — weakens "read-only = zero diff" to
   "read-only except..."; moving artifact authorship to Reconcile keeps the boundary absolute and
   mechanically checkable.

9. **Reconcile before Gate** — `reconcile()` fails closed on missing/unpassed gate inputs
   (checks 4–5); would require fabricating gate results; rejected.

10. **Always-on Reconcile at width 1** — adds an agent call and failure surface to the legacy path,
    breaking AC#8; short-circuit/guard-skip when width 1 instead.

11. **Partial Land of the passing subset on member-gate failure** — contradicts
    `landPolicy:"atomic"` (contract-enforced) and the task's explicit statement;
    attribution-plus-record of passing members gives the human the same recovery information without
    breaking the invariant.

12. **Git-worktree-per-phase as the primary Build isolation** — grouping-fusion absorbs overlap
    (strictly stronger than isolating phases that would conflict at merge) and the DSL gives no
    evidence of an isolation option; serialize-on-unprovable-overlap with worktree as a defensive
    path delivers the safety property now.

13. **Keep composite-preflight's vacuous-pass for composite-shape calls missing a manifest** —
    silently dispatches a receipt-less composite; fail-closed `composite-manifest-missing` is the
    executable-invariant fix (decision 4).

## Plan

Depends on DIR-119-A, DIR-119-B, and DIR-119-C. Continues the operational-wiring stage
(Phase 3 / Stage 3.4's own carve-out) of
`docs/plans/adaptive-composite-milestone-select-and-execution.md`, closing what that plan's Phase 2
(DIR-119-B) explicitly deferred and Phase 3 (DIR-119-C) did not itself deliver. This child edits the
active execution/audit/Land control plane (`execute-milestone.js`, the `composite-*.ts` modules) and
is human-steered under halt. The resolving milestone must: (1) build the real manifest phase/shard
synthesis step, (2) wire phase-DAG Build + read-only audit shards + a literal Reconcile phase into
`execute-milestone.js`, (3) fix the Gate-phase failure-attribution defect, (4) exercise all of the
above on one real, fresh composite dispatch with RED/GREEN fixture evidence, then (5) obtain a fresh
independent wiring audit explicitly briefed to trace production import graphs and exercise the
Gate-failure branch — the two checks the prior DIR-119-C audit did not perform.

## Finding

Real, code-level evidence gathered 2026-07-27/28 in the session that ran and audited
M-DIR119-C-CANARY:

1. **No manifest phase/shard synthesis.** `grep -n "phases" experiments/quay-perpetual-stream/
   scripts/composite-contracts.ts` shows the only `CompositePhase[]`-producing function is
   `makeValidCompositeFixture(n)`, commented "Used to prove width alone never fails the checker" —
   a test fixture. `select-preflight.ts`'s real, wired `synthesizeCandidatePortfolio()` (via
   `coupling-graph.ts` → `candidate-synthesis.ts` → `portfolio-choice.ts`) produces
   `MilestoneCandidate{candidateId, taskIds, score}` — a flat array, never a phase/shard structure.
2. **The composite execution modules are a self-contained, uncalled island.** Import-graph check:
   `composite-build.ts` — zero importers anywhere. `composite-audit.ts` — imported only by
   `composite-reconcile.ts`. `composite-reconcile.ts` — imported only by `composite-land.ts`.
   `composite-land.ts` — zero importers anywhere. None of the four is imported by
   `execute-milestone.js` or any other production entrypoint. This matches DIR-119-B's own AC/DoD
   text ("tested contract modules referenced by agent-prompt guidance rather than literally invoked
   by the live workflow") and OUTER-LOOP.md's own honest disclosure (line ~106: "conservatively
   single-lead-oriented for THIS first implementation... not self-certified here").
3. **Gate-phase failure attribution is wrong for composite batches.** `.claude/workflows/
   execute-milestone.js`'s Gate phase: `const gatesFailed = gates.filter(Boolean).some(g => !g.ok);
   if (gatesFailed) { await agent(\`Mark task ${_primaryTaskId} needs-human...\`) }`. Regardless of
   which of N member tasks' own `split-or-commit-${tid}` gate actually failed, only
   `_primaryTaskId` is marked `needs-human`; there is no per-task failure identification and no
   partial-Land path for the tasks whose gates passed. This did not trigger during
   M-DIR119-C-CANARY (all 7 gates passed) so the real run never exercised this branch.

## Requested action

1. Add a real, production (not test-fixture-only) manifest-synthesis step that converts a
   SELECT-produced `MilestoneCandidate.taskIds` into a `CompositeManifest{phases[], auditShards[]}` —
   grouping rule must be deterministic and documented (e.g., derived from declared `## Touches`
   disjointness/coupling, not ad hoc human judgment), with a real production callsite between SELECT
   output and `execute-milestone` dispatch.
2. Change `execute-milestone.js`'s composite Build path to literally dispatch one agent per
   manifest `phases[]` entry (respecting `requires` edges): use `parallel()` across phases with no
   dependency relationship, `pipeline()`/serial dispatch across dependent phases, and
   `isolation:'worktree'` only for phases whose `## Touches` overlap (reuse
   `touches-orthogonality-check.ts`, do not reinvent).
3. Change the Audit phase to literally dispatch one agent per declared `auditShardIds` entry,
   each scoped only to that shard's `taskIds`. Wrap every shard dispatch with a mechanical
   `git status --short` snapshot before/after; a non-empty diff hard-fails that shard as a
   read-only-contract violation — do not rely on agent self-discipline.
4. Add a literal `Reconcile` phase to `meta.phases`, placed between Audit and Land, that is the
   ONLY phase permitted to write task AC/DoD ticks, status, dashboard rows, and absorb dispositions;
   wire it to actually invoke `composite-reconcile.ts`'s `reconcile()` (currently reachable only via
   `--selftest`) rather than referencing it as prose guidance.
5. Fix Gate-phase failure handling: when a per-task `split-or-commit-${tid}` gate fails, identify
   and record the SPECIFIC failing task(s) in the needs-human record (not `_primaryTaskId` by
   default). Given `landPolicy:"atomic"`, a single member failure still blocks the whole bundle from
   landing — but the needs-human record must name the true failing task(s), and the record must show
   which members would otherwise have passed.
6. Real regression proof: dispatch one fresh, real composite (2-3 real tasks is sufficient, width 7
   need not be repeated) through the newly wired mechanism. From its real `journal.jsonl`, confirm:
   Build-phase agent-call count equals the manifest's phase count (not 1 for a multi-phase manifest);
   Audit-phase agent-call count equals the shard count, each git-clean before/after; an explicit
   `Reconcile`-phase entry exists between Audit and Land and is the phase whose completion coincides
   with the working tree becoming dirty; Land remains atomic.
7. RED/GREEN fixture evidence (not GREEN-only) for: (a) a hostile audit-shard write being caught by
   the mechanical git-clean check, and (b) a synthetic ≥2-task composite where one member's gate
   fails, proving the needs-human record names that member specifically, not `_primaryTaskId`.
8. Legacy single-task dispatch must remain behavior-identical: width-1 calls should not gain
   unnecessary Reconcile-phase overhead or new failure surface versus the pre-existing path.
9. A fresh independent wiring audit explicitly instructed to (a) trace production import graphs for
   all four composite-*.ts modules and the new manifest-synthesis step, and (b) exercise the
   Gate-phase failure branch — not only read journal call-counts and AC-citation text. This closes
   the meta-gap this directive's own Proposal names.
10. Once (1)-(9) land with real evidence, re-verify DIR-119-C's own AC #5 (phase-DAG Build/read-only
    shards/deterministic Reconcile "using the installed new workflow") and AC #10 (audit immutability,
    reconciler ownership) against the fix; only then may DIR-119-C and DIR-119 be promoted.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance referencing a tested
  module:** for each of `composite-build.ts`, `composite-audit.ts`, `composite-reconcile.ts`,
  `composite-land.ts`, and the new manifest phase/shard synthesis step, a grep/import-graph check
  shows a REAL production callsite from `execute-milestone.js` (both `.claude/workflows/` and
  `plugin/workflows/` mirrors) or its direct call chain — not zero importers, not
  `--selftest`-only reachability. This item alone, if unmet, fails the whole directive regardless of
  how many other items pass.
- [ ] A real composite milestone dispatch's `journal.jsonl` shows Build-phase agent-call count ==
  the manifest's phase count (> 1 for a genuinely multi-phase manifest) — not one monolithic call
  covering all tasks.
- [ ] Same journal shows Audit-phase agent-call count == the manifest's `auditShards[]` count, each
  agent's scope provably limited to that shard's `taskIds` only.
- [ ] A literal `Reconcile` phase entry appears in the journal between the last Audit-shard call and
  Land; git-diff timing evidence shows the working tree stays clean through every Audit-shard call
  and only Reconcile introduces the write-back diff.
- [ ] RED/GREEN evidence for the mechanical git-clean audit-shard check (a hostile shard write is
  caught; a compliant shard passes) — both states shown, not GREEN-only.
- [ ] RED/GREEN evidence for the Gate-failure attribution fix — a synthetic ≥2-task composite with
  one deliberately-failing member's gate produces a needs-human record naming that specific member,
  not `_primaryTaskId` by default.
- [ ] The manifest phase/shard synthesis step is exercised on a REAL SELECT-produced
  `MilestoneCandidate` (not a hand-authored manifest) at least once, with the resulting
  `phases[]`/`auditShards[]` shown to satisfy `composite-preflight.ts`'s existing contract check.
- [ ] Legacy single-task (`{taskId,...}`) dispatch remains behavior-identical: Build/Audit still one
  agent call each; Reconcile phase adds no new failure surface or unnecessary overhead at width 1.
- [ ] A fresh independent wiring audit — explicitly briefed to trace import graphs and exercise the
  Gate-failure branch, not only read journal counts — finds no refutation.
- [ ] DIR-119-C's own AC #5 and #10 are re-confirmed true against this fix by that audit.
- [ ] **Caller-side synthesis is really wired (W1):** verified via grep + the M196 real run's journal
  — OUTER-LOOP.md's `execute()` step gains a grep-confirmable callsite that, when
  `taskIds.length > 1`, invokes `composite-manifest-synthesis.ts` between a real SELECT-produced
  `MilestoneCandidate` and dispatch, writes `/tmp/m<NN>-manifest.json` (`{manifest, context}`), and
  threads `compositeManifestFile` into the dispatch; the resulting manifest is validated by the
  unchanged `composite-preflight.ts` Verify check; the `execute()` shape's `compositeManifestFile`
  passthrough and the task's `## Touches` re-declaration are confirmed real by the Prepared gate's
  `touches-expanded` trigger (`milestone-preparation-check.ts`) NOT firing on the declared set.
- [ ] **Synthesis self-validates fail-closed (W2):** verified via import grep + RED/GREEN unit
  tests — `composite-manifest-synthesis.ts` runs `checkCompositeContract` on its own output BEFORE
  writing and exits non-zero on any violation, reusing (not reinventing)
  `touches-orthogonality-check.ts`'s exported `parseTouches`/`expandGlobs`/`filesDisjoint` and
  `coupling-graph.ts` exports; a composite-shape dispatch missing `compositeManifestFile` fails
  closed with `composite-manifest-missing` before Build (RED fixture confirms; width-1 retains the
  vacuous pass).
- [ ] **Build dispatch is per-phase, proven from the real journal (W3/W4):** verified —
  `execute-milestone.js` dispatches one planner agent on `composite-build.ts`'s `--plan-json`, then
  `await parallel(...)` of one labeled `agent()` per phase (label `build-phase-${phaseId}` ≡
  `build-phase-<id>`) scoped to that phase's `taskIds` and respecting `requires`, and a final
  `--map-evidence-json` call (`mapEvidenceToTasks`) folding each phase agent's
  `PhaseEvidence{phaseId, files, commits, tests}`; `build-phase-<id>` count == manifest phase count
  confirmed in the real journal, mechanical helpers excluded.
- [ ] **Audit dispatch is per-shard with mechanical read-only proof (W5/W6/W7):** verified from the
  real journal — `execute-milestone.js` dispatches one `agent()` per `auditShards[]` entry (label
  `audit-shard-<id>`), enforces the read-only boundary via workflow-side `checkShardReadOnly`
  comparison of agent-returned `git status --short` snapshots (NOT agent self-report, and NOT
  `composite-audit.ts`'s in-process `deepFreeze`/`structuredClone` alone — those bind JS mutation
  only, proven insufficient for a dispatched agent's filesystem), and combines shard results via
  one `--combine-json` call on `composite-audit.ts` (`combineShardVerdicts`) producing the
  `BundleAuditResult`; `audit-shard-<id>` count == `auditShards.length` (i.e.
  `count == auditShards.length`) confirmed, helper labels `build-plan`/`audit-combine` excluded by
  the grep.
- [ ] **Reconcile/Land/attribution callsites are real production edges (W8/W10/W11):** verified via
  import grep + real journal — the Reconcile phase runs `composite-reconcile.ts`'s real
  `reconcile()` through a new non-`--selftest` CLI mode (`--reconcile-json`) consuming `taskGates`
  + `milestoneGates`; a second CLI on `composite-land.ts` (`--land-json`) runs
  `buildLandTransaction`; gate failures route through `attributeGateFailures(gates, taskIds)`
  producing `failedTaskIds` parsed from the `split-or-commit-${tid}` labels (`_primaryTaskId`
  marked only if among them) and recording `passingTaskIds`; all callsites confirmed in BOTH
  mirrors, and the synthetic ≥2-task RED fixture's needs-human record names the specific failing
  member.
- [ ] **Width-1 golden replay invariants (W12):** verified RED/GREEN — a width-1 `{taskId,...}`
  dispatch is byte-for-behavior unchanged: single Build/Audit agent, Gate failure reduces to
  `failedTaskIds=[_primaryTaskId]` exactly as today, and `legacySingletonLandShape()` is
  machine-asserted as the golden-replay comparison target at width 1.
- [ ] **Composite-AND-concurrent rejected fail-closed:** verified by fixture — `concurrent_execute`
  remains width-1 singletons only; any composite+concurrent dispatch returns
  `revision-needed, composite-concurrent-unsupported` before Build.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/execute-milestone.js`, the driver execution-chain script).
- [ ] A real, non-fixture composite dispatch exercises the full new wiring end to end with journal
  evidence, not asserted.
- [ ] RED/GREEN evidence exists for both the audit-shard read-only check and the Gate-failure
  attribution fix.
- [ ] A fresh independent wiring audit — briefed on this directive's own Proposal (the prior audit's
  blind spot) — finds zero unresolved findings, with explicit confirmation of production import-graph
  wiring for all four `composite-*.ts` modules plus the new manifest-synthesis step.
- [ ] DIR-119-C's AC #5/#10 and DIR-119's parent AC #2/#3 are re-verified true as a consequence, and
  DIR-119's parent/child lifecycle gate passes only after this child is done.

## Human verification when exp5 marks this DIR done

1. Do `composite-build.ts`, `composite-audit.ts`, `composite-reconcile.ts`, and `composite-land.ts`
   each have a real, non-test, non-selftest production caller now?
2. Does a real composite dispatch's journal show N Build calls and M Audit calls matching the
   manifest, not one monolithic call each?
3. Does a literal Reconcile phase exist and is it the only place that writes task/dashboard/absorb
   state?
4. Was the Gate-failure attribution fix demonstrated with a real failing-member fixture, not just
   read as code?
5. Did the independent audit for this directive explicitly check import graphs and the failure
   branch, rather than repeating the same checklist that missed these defects the first time?

## Touches

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/composite-build.ts`
- `experiments/quay-perpetual-stream/scripts/composite-audit.ts`
- `experiments/quay-perpetual-stream/scripts/composite-reconcile.ts`
- `experiments/quay-perpetual-stream/scripts/composite-land.ts`
- `experiments/quay-perpetual-stream/scripts/composite-contracts.ts`
- `experiments/quay-perpetual-stream/scripts/composite-preflight.ts`
- `experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts`
- `experiments/quay-perpetual-stream/test/composite-manifest-synthesis.test.mjs`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `plugin/scripts/composite-build.ts`
- `plugin/scripts/composite-audit.ts`
- `plugin/scripts/composite-reconcile.ts`
- `plugin/scripts/composite-land.ts`
- `plugin/scripts/composite-contracts.ts`
- `plugin/scripts/composite-preflight.ts`
- `plugin/scripts/composite-manifest-synthesis.ts`
- `experiments/quay-perpetual-stream/test/composite-*.test.mjs`
- `plugin/test/composite-*.test.mjs`
