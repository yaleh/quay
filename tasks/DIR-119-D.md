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

Close the execution-side gaps left by DIR-119-B and exposed by the DIR-119-C canary: make composite execution a literal, journal-visible production path; synthesize a checked manifest from the real SELECT candidate; keep Audit filesystem-read-only; give Reconcile sole composite write authority; and attribute member gate failures precisely. This is a high-risk control-plane change to both workflow mirrors and all vendored script mirrors, performed while the repository-root `.halt` is present and never concurrently with another milestone workflow. It is the first dispatch under the enforced-by-default Prepared receipt gate.

### Problem framing (re-verified against current tree, 2026-07-29)

`.claude/workflows/execute-milestone.js` and its `plugin/workflows/` mirror are 508 lines and byte-identical (`cmp` confirms). Both run exactly six phases (`phase('Verify')`, `phase('Prepared')`, `phase('Build')`, `phase('Audit')`, `phase('Gate')`, `phase('Land')`) — there is no `Reconcile` phase anywhere. At any composite width, Build dispatches exactly one `agent()` call and Audit dispatches exactly one `agent()` call; the only composite-aware content in either is an inline text block appended to that single prompt (Build line 246, Audit line 282-283 template literal) instructing the one agent to itself treat shared phases/shards as one owner and to defer some mutation to "the target architecture once DIR-119-C wires a real per-shard dispatcher" — an honest admission, still true, that the real dispatcher does not exist yet.

Import-graph check, run fresh this session: `composite-build.ts` and `composite-land.ts` have zero non-test importers anywhere in the tree. `composite-audit.ts` is referenced from exactly one production file, `composite-reconcile.ts` — and that reference (`import type { BundleAuditResult } from "./composite-audit.ts"`) is **type-only**, erased at compile/strip time, so there is zero runtime JS connection even between these two modules. `composite-reconcile.ts` is likewise referenced only by `composite-land.ts`'s `import type { ReconcileResult }`. So the four composite-execution modules are not merely uncalled by `execute-milestone.js` — at runtime they have no call relationship to each other either; the only real connective tissue anywhere is TypeScript's type checker. `grep` for the four module names inside `execute-milestone.js` returns three hits, all inside template-literal prompt strings told to an LLM agent (Build/Audit/Land prompt text) — naming a module in a prompt is not invoking it.

No manifest phase/shard synthesis exists in production. `composite-manifest-synthesis.ts` does not exist (`find` returns nothing). The only function anywhere producing a `CompositePhase[]` is `composite-contracts.ts`'s `makeValidCompositeFixture`/`makeSharedPhaseCompositeFixture`, explicitly test fixtures.

SELECT's real pipeline (`select-preflight.ts`'s already-wired candidate synthesis, chained through `coupling-graph.ts` → `candidate-synthesis.ts` → `portfolio-choice.ts`) is confirmed by reading its return type to produce only a flat candidate record (id/taskIds/score) — never a phase/shard structure. (Existing-state description, not a proposed mechanism; the actual grep-confirmable production function name and its non-phase-producing return shape were independently re-verified this session.)

Two things ARE genuinely, already wired today, and this proposal builds on them rather than redoing them. First, the existing composite-preflight check already validates a supplied manifest file against the composite contract checker when the composite flag is set (lines 70-89) — for a legacy/no-manifest call it is a documented vacuous pass, and the gap is specifically that nothing on the production side ever supplies a real manifest for that check to validate. Second, the existing composite-args normalizer already accepts the wide-dispatch shape (`{milestoneCandidate:{taskIds,...}, compositeManifestFile,...}`) and its own header comment states the hard invariant of never rejecting on task-array length — the wide-dispatch entrypoint shape is already load-bearing; what's missing is a real producer for the manifest-file argument and real consumers of manifest width once Verify has validated it.

Gate-phase failure attribution is confirmed broken for composite batches by direct inspection (lines 348-374): Gate already dispatches one real per-task check with a distinct per-member label (genuine, from DIR-119-B/M189) but its failure branch discards which of the N per-task results actually failed and always names only the primary task id, identically in both mirrors. (Existing-broken-state description; the exact source excerpt is quoted verbatim in this task's own `## Finding` section below rather than repeated here.) This did not trigger during M-DIR119-C-CANARY (all 7 gates passed), so the real run never exercised this branch, and the prior independent audit checked journal call-counts and AC-citation text but never traced the import graph above or forced this branch — the exact blind spot this milestone must close.

The workflow DSL itself is a hard constraint, not a design choice. It exposes only five globals (phase/agent/parallel/log/args) — no module-import, filesystem, or shell primitive, and no batch-pipelining helper (confirmed absent from every `.js` workflow in this repo).

Every "wire module X into the workflow" claim in this proposal necessarily bottoms out in the same one pattern: a labeled agent call invokes a deterministic, non-selftest JSON CLI wrapping module X's real exported function, and the workflow only branches on the structured JSON result. There is no other literal-wiring mechanism available, and this bounds what "real callsite" can mean for this task's own AC wording.

### Chosen mechanism

Add a composite-only execution branch, gated on effective width greater than one (`_isComposite && _taskIds.length > 1`), alongside the existing scalar/legacy branch, which remains completely untouched as the compatibility oracle. Canonical modules are added first under `experiments/quay-perpetual-stream/scripts/`, byte-copied to `plugin/scripts/`, and every pair is kept byte-identical (`sync-vendor.sh --check`, `cmp`, packaging tests) — same discipline for both `execute-milestone.js` mirrors.

1. **Manifest synthesis at the SELECT/dispatch boundary — new module `composite-manifest-synthesis.ts` (+ `plugin/` mirror + `composite-manifest-synthesis.test.mjs`).**

   A pure function `synthesizeManifest(candidate, taskFacts, couplingGraph, capacity) -> {manifest, context}` takes the exact real SELECT `MilestoneCandidate`, authoritative current task facts (Touches, AC counts), and the coupling graph, and returns a `{manifest, context}` pair.

   It reuses — never reimplements — `touches-orthogonality-check.ts`'s exported `parseTouches`/`expandGlobs`/`filesDisjoint`, and `coupling-graph.ts`'s exported `buildCouplingGraph`/`deriveInternalOrderEdges`/`hasProhibitingEdge` (this task's own prior Proposal text and one earlier draft called this export `isProhibiting`; the actually-exported symbol, confirmed by reading `coupling-graph.ts` line 164, is `hasProhibitingEdge` — a naming correction worth stating explicitly rather than silently carried forward).

   It builds an undirected overlap graph over declared `## Touches`, union-finds any pair not proven disjoint into one shared phase with one owner and a deterministic `integrationInvariant` string naming the members and overlap reason, and translates cross-component internal-order edges into `requires` (intra-component order becomes ordered instructions, never silently dropped). Unknown/missing/empty/overbroad/zero-match Touches are treated as overlapping everything — fail toward fusion, never toward optimistic parallelism.

   It emits one `task-ac` audit shard per task plus one `semantic-integration` shard per multi-task phase, sorts every collection (task ids, phase ids, shard ids, touches/resources unions) so output is deterministic and byte-identically re-runnable from the same inputs, and derives stable IDs only from sorted membership and fixed prefixes — never a timestamp, random value, filesystem enumeration order, or current commit hash.

   The CLI accepts candidate/charter/workspace/task-store paths and an output path, validates source hashes and charter membership, calls `checkCompositeContract()` (existing, unmodified `composite-contracts.ts` export) on its own output BEFORE writing, and writes via temp-file-plus-rename so any failure leaves no partial artifact.

   Defaults `maxPhases:32`, `maxAuditShards:64`, `maxParallelAgents:4`, `landPolicy:"atomic"` are explicit exported constants, serialized into `context`, overridable only through validated `CapacityLimits`; SELECT resource/line budgets are preserved when supplied and capacity violations are reported with their own reason code.

   **Correction (this milestone, confirmed by `find -iname 'select-preflight*'`): there is exactly ONE `select-preflight.js` file in this repo — `.claude/workflows/select-preflight.js` — with no `plugin/workflows/` mirror.** (`plugin/scripts/config-wiring-check.ts` line 139 hardcodes this same single path as the repo's intended one-file bespoke-driver design; earlier drafts of this Proposal wrongly asserted "both wrappers," which this correction supersedes.) That one file is updated to pass through the real `portfolio`/selected candidate (not a hand-shaped stub) so the synthesis CLI receives genuine SELECT output. `OUTER-LOOP.md`'s `execute()` step, when `taskIds.length > 1`, invokes the synthesis CLI between the real SELECT candidate and the `execute-milestone.js` dispatch and threads the result as `compositeManifestFile`. No hand-authored manifest satisfies the real proof required by this task's AC.

2. **Build becomes a real phase DAG.** Add non-selftest JSON CLI modes to `composite-build.ts`: `--plan-json` (wraps the existing, already-exported `planPhaseExecution`) and `--map-evidence-json` (wraps the existing, already-exported `mapEvidenceToTasks`). Planning gives each manifest phase a unique `build-phase-<id>` owner and chunks dependency-ready levels into batches capped at `maxParallelAgents` simultaneous dispatches — the cap bounds concurrent calls within a batch, never phase ownership or the `build-phase-*` label count. A labeled `build-plan` helper agent invokes the plan CLI; batches then run serially, and within each proven dependency-ready, proven-disjoint batch the workflow calls `parallel()` with exactly one labeled `build-phase-<id>` agent per phase in that batch, each prompt scoped only to that phase's task IDs, predecessors, invariant, allowed Touches, and evidence schema — phase workers never stage or commit. A final serial `build-integrate` helper validates the changed-file set is in-scope, integrates in deterministic topological order, runs integration tests, creates the ONE candidate-generation commit, and invokes `--map-evidence-json`. Because this repo runs milestones directly in a shared working tree with no per-phase worktree isolation on the default path (CLAUDE.md's own corrected note on `execute-milestone.js`'s Build phase), phase batches that could theoretically run independent git-writing agents must instead serialize at the one integration-commit step — a cap on `maxParallelAgents` bounds simultaneous *inspection/build* work, never simultaneous *commits*. Unknown dependencies, cycles, duplicate/missing evidence, out-of-scope files, unexpected commits mid-Build, or a generation mismatch fail closed before mutation.

3. **Audit becomes per-shard, mechanically-enforced read-only dispatch.** Remove every composite checklist/absorb/deviation/dashboard/lifecycle/status write instruction from the Audit agent prompt (composite mode only — legacy width-1 Audit is unchanged); that mutation moves entirely to Reconcile. Add non-selftest snapshot/guard and `--combine-json` CLI modes to `composite-audit.ts` (the guard mode wraps `git status --porcelain=v1 --untracked-files=all`; `--combine-json` wraps the existing, already-exported `combineShardVerdicts`). The workflow dispatches exactly one `audit-shard-<id>` agent per `manifest.auditShards[]` entry, each scoped only to that shard's declared task IDs/AC indexes/invariant/integrated generation. Each shard worker takes exact before/after snapshots around its own inspection window and returns the raw snapshots plus a typed verdict — it does not self-certify cleanliness. **The workflow itself — not the agent's self-report, and not `composite-audit.ts`'s existing `deepFreeze`/`structuredClone`-based `runReadOnlyAuditShard()`, which only binds in-process JS object mutation and cannot constrain a dispatched agent's real filesystem writes — diffs the two snapshots**; any non-empty delta, tracked or untracked, hard-fails that shard as `audit-shard-write-violation:<id>` regardless of what the agent claims. A distinct `audit-combine` helper agent invokes the real `combineShardVerdicts()` (not a workflow-side reimplementation) to produce the generation-bound `BundleAuditResult`. Snapshot transport remains within the platform's existing agent/tool trust boundary: this is mechanical adjudication of returned command output, not cryptographic proof an agent process cannot forge its own output, and that limitation is stated plainly rather than oversold.

4. **Typed Gate results feeding a literal Reconcile.** Gate closures change return shape, not check set: each task gate returns `{scope:"task", taskId, gate, ok, detail}` and each milestone-scoped gate returns `{scope:"milestone", gate, ok, detail}` — the existing `split-or-commit-${tid}` label stays present as observability metadata but is no longer the thing attribution parses; identity is a structural field. A new `attributeGateFailures(gates, taskIds)` export on `composite-reconcile.ts` partitions the full typed vector into `failedTaskIds`/`passingTaskIds` plus separately-reported milestone-scoped failures; `_primaryTaskId` gets no special treatment and is marked only if it is itself among `failedTaskIds`. A literal `Reconcile` phase is inserted into `meta.phases` between Gate and Land — strictly after Gate because the existing `reconcile()` contract requires the complete task-and-milestone gate vector as input. Add non-selftest `--reconcile-json` (wraps the existing, already-exported `reconcile()`, currently reachable only via `--selftest`) and `--attribute-gates-json` modes to `composite-reconcile.ts`. `reconcile()` checks the Build generation ID, complete shard verdicts, the full task+milestone gate vector, and exact membership, then returns either the complete success mutation plan or zero mutations plus a deterministic failure disposition. A single `reconcile-apply` agent is the ONLY writer in the composite path: on success it applies the returned complete set of AC/DoD ticks, status changes, absorb dispositions, deviation/write-back rows, and the consolidated audit artifact, using pre-image/rollback or equivalent all-or-nothing staging; on any generation/shard/gate/contract failure it applies zero mutations and returns only the deterministic recovery record.

5. **Land becomes a transaction validator, never a second policy engine.** Add a non-selftest `--land-json` mode to `composite-land.ts` invoking the existing, already-exported `buildLandTransaction()`. Before any mutation it requires `ok:true`, `counterDelta===1`, `dashboardEntryCount===1`, `taskCompletionCount===taskIds.length`, `landPolicy:"atomic"`, and exact set-equal membership against Reconcile's output; on any mismatch it produces `needs-human` with zero counter/dashboard/status writes. Land rechecks and commits the one already-decided transaction; it never re-derives verdicts. `legacySingletonLandShape()` (already exported, currently unused in production) becomes the machine-asserted width-1 golden-replay oracle.

6. **Legacy width-1 stays the existing, unmodified code path.** `_taskIds.length === 1` (whether via legacy `{taskId,...}` or a composite-shaped singleton) never touches synthesis, per-phase/per-shard fan-out, Reconcile, or the new Land CLI mode — this branch is additive, not a rewrite of the existing single-Build/single-Audit/no-Reconcile behavior.

### Control and data flow

- **SELECT → synthesis:** `SELECT` returns the real, unmodified `MilestoneCandidate`/portfolio.
  Only if `taskIds.length > 1`, `OUTER-LOOP.md`'s `execute()` step invokes
  `composite-manifest-synthesis.ts`'s CLI between the real candidate and dispatch, writes
  `{manifest, context}` to a path, and threads it as `compositeManifestFile` (unchanged call
  shape for width 1).

- **Verify:** the existing five it0 checks plus `composite-preflight.ts`, which now also enforces
  two new fail-closed reason codes ahead of Build — `revision-needed/composite-manifest-missing`
  for a wide call with no manifest file, and `revision-needed/composite-concurrent-unsupported`
  for composite-shaped args combined with `mode:"concurrent"` — before re-validating the supplied
  `{manifest,context}` and source hashes against `checkCompositeContract()`.

- **Prepared:** unchanged mechanism (`milestone-preparation-check.ts` against
  `preparationReceiptFile`), but this task's own expanded `## Touches` (both workflow mirrors, all
  eight `composite-*.ts` canonical+vendor files, both new synthesis files, the composite test
  files) must be genuinely declared so Prepared's `touches-expanded` trigger proves the
  declaration honest rather than firing spuriously.

- **Build:** `build-plan` runs serial dependency-ready batches of `parallel()` `build-phase-<id>`
  agents, then `build-integrate` performs the one commit and invokes `--map-evidence-json`.

- **Audit:** starts only from the clean, integrated Build state — one `audit-shard-<id>` agent per
  shard, workflow-side snapshot diff (never agent self-report), then `audit-combine` binds the
  bundle to the build generation.

- **Gate:** typed per-task/per-milestone results, no mutation.

- **Reconcile:** consumes the audit bundle and the complete gate vector, applies the one atomic
  mutation set via `reconcile-apply` or records the attributed failure with zero writes.

- **Land:** validates and commits the one already-decided transaction; performs no independent
  verdict derivation.

Real-run evidence requirement: a fresh `journal.jsonl`, filtered by label, must show exactly one
`build-phase-*` entry per manifest phase (count > 1 for the real proof run), exactly one
`audit-shard-*` entry per manifest shard, and helper labels (`build-plan`, `build-integrate`,
`audit-combine`, `reconcile-apply`) each exactly once, counted separately so they never pollute
the phase/shard exact-count checks. Journal ordering must be last `audit-shard-*` → Gate →
`reconcile-apply` → Land, with `git status` showing the working tree clean through every
Build/Audit call and the first canonical write-back diff appearing only at `reconcile-apply`.

### Key design decisions

- **Overlap fuses into one phase owner; uncertainty fuses, never parallelizes.** This is the same conservative direction `touches-orthogonality-check.ts` already takes for Prepared-gate purposes, reused rather than reinvented for synthesis; a valid candidate with precise disjoint Touches must produce more than one phase for the real proof run, or the multi-phase AC item is unproven.

- **Reconcile is strictly downstream of Gate**, because its existing contract requires the complete typed gate vector to decide attribution; Land is a transaction-commit validator only, never a second policy engine, so there is exactly one place that decides "did this land."

- **Gate identity is typed, never positional/label-parsed for control decisions.** Attribution reads structured `{taskId, ok}` records; the `split-or-commit-${tid}` label remains a practical correlation key at the journal-evidence layer (the DSL's `parallel()`/`agent()` primitives expose no richer typed return channel than what the agent itself returns), which is a residual reliance worth flagging rather than glossing over.

- **Read-only enforcement is mechanical, not agent self-report or in-process isolation.** `composite-audit.ts`'s `deepFreeze`/`structuredClone` machinery binds only in-process JS objects and cannot constrain a dispatched agent's filesystem writes — the actual enforcement is the workflow's own before/after `git status` diff, the only enforcement point that sees the agent's real filesystem effect, honestly scoped as bounded by the platform/agent trust model rather than a cryptographic guarantee.

- **The DSL exposes no import/filesystem/shell primitive**, only five globals — so "literal wiring" necessarily means a labeled agent running a deterministic JSON CLI, with the workflow deciding on structured results, never a direct TypeScript import into the workflow script. This bounds what "real callsite" can mean for this task's own AC wording.

- **No concurrent commits in the shared working tree.** Per this repo's own documented operating constraint (no worktree isolation on the default execute-milestone path), phase batches that could theoretically run in parallel git-writing agents must instead be capacity-bounded and serialized at the one integration commit; `maxParallelAgents` only bounds simultaneous inspection/build work, never simultaneous commits.

- **Legacy path is a hard boundary, not a fallthrough.** Keeping the existing single-Build/single-Audit/no-Reconcile path completely untouched at width 1 makes it a genuine compatibility oracle, asserted by a golden-replay test against `legacySingletonLandShape()`, not a prose claim of equivalence.

### Defaults and failure behavior

Defaults: `maxParallelAgents:4`, `maxPhases:32`, `maxAuditShards:64`, `landPolicy:"atomic"` — serialized into `context`, overridable only through validated options, never ad hoc. Synthesis fails closed (no partial output, via temp-file-plus-rename) on: stale source hashes, unreadable/mismatched task or charter input, invalid/overbroad/empty Touches, a detected prohibiting coupling edge or dependency cycle, missing/dangling phase or shard records, any `checkCompositeContract()` violation, or capacity overflow. Downstream, any null/crashed/malformed CLI result, unknown phase/shard reference, duplicate evidence, missing verdict, dependency-order violation, out-of-scope file touch, unexpected HEAD movement mid-Build, generation mismatch, a refuted audit shard, or an incomplete/non-atomic Land transaction fails closed with a stable reason code before any mutation. Build failure blocks Audit entirely. Any audit-shard delta refutes that shard and, transitively, the whole bundle. Any single task or milestone gate failure blocks atomic Land regardless of how many other members passed, and routes into Reconcile's failure-attribution path — the needs-human record must name the true failing member(s) and the would-have-passed subset, never `_primaryTaskId` by default. Reconcile failure yields zero success mutations. Land mismatch yields zero counter/dashboard/done-status writes.

### Compatibility

Legacy `{taskId,...}` calls and any effective-width-one composite candidate retain the exact current behavior — single Build agent, single mutating Audit agent, unchanged Gate/Land shape, no Reconcile invocation, no new failure surface — proved by a golden-replay test comparing the real transaction shape to `legacySingletonLandShape()`, not by prose assertion. Existing valid hand-authored manifests remain accepted by Verify (backward compatible with any prior fixture-driven exercise), but a genuinely wide dispatch through the real pipeline now requires a manifest produced by the new synthesis step — this task's AC explicitly requires exercising synthesis on a REAL SELECT-produced candidate, not a hand-authored one. `concurrent_execute()` stays independent width-1 singleton fan-in only; a composite manifest combined with `mode:"concurrent"` is rejected fail-closed by Verify before Build, never silently merged. No product-package (`packages/quay*`) or Provider ABI changes — this is entirely within `experiments/quay-perpetual-stream/` and the two `execute-milestone.js` mirrors. Canonical and `plugin/` mirrors of every touched file stay byte-identical, checked by `sync-vendor.sh --check`, direct `cmp`, and the existing packaging tests. `OUTER-LOOP.md`'s `execute()` shape and this task's own `## Touches` are expanded to cover the new synthesis callsite, both mirrors, sync tooling, and tests — Prepared is rerun against the expanded declaration before Build. The existing `CompositeManifest`/`CompositeContext` serialized shape from `composite-contracts.ts` is reused as-is unless a genuinely unavoidable field is required, in which case the contract version increments explicitly.

### Risks and mitigations

- **Control-plane regression on the one script every future milestone runs through**, edited in a shared working tree with no isolation: keep the repo-root halt sentinel present for the duration of Build/Land, never run this milestone concurrently with any other dispatch, keep the width-1 golden replay as a hard regression gate, run the full canonical test suite (not a subset) as part of this milestone's own Gate/DoD evidence with its pass/fail tally recorded, and run the restart-readiness check before removing the halt sentinel.

- **False confidence from prompt text or in-process clone/freeze** — the exact failure mode this task exists to fix. Mitigation: require literal non-selftest CLI invocations, raw import-graph plus journal-count evidence (not AC-citation prose), and RED/GREEN fixtures for both the hostile-write catch and the Gate-failure attribution fix — GREEN-only evidence does not discharge this risk.

- **Vague/missing Touches causing false parallel-safety** — mitigated by reusing the existing `parseTouches`/`filesDisjoint`/`hasProhibitingEdge` helpers rather than reimplementing them, and biasing unknown input toward fusion/serialization, never toward optimistic parallel dispatch; the real proof run must use a SELECT candidate whose actual declared Touches are precise enough to produce more than one phase.

- **Mirror drift** between the canonical workflow/script trees and their vendored `plugin/` counterparts — mitigated by the existing sync-check tooling and packaging tests as part of this milestone's own evidence, not a separate follow-up.

- **State-owner ambiguity** if Build/Audit prompts retain any residual write-instruction language — mitigated by explicitly stripping composite write instructions from Build/Audit prompts and making Reconcile's `reconcile-apply` agent the only one described anywhere in the workflow file as writing task/dashboard/absorb state.

- **Rollback failure mid-`reconcile-apply`** — mitigated by pre-image capture, transaction validation before any edit, all-or-nothing staging, and an inspectable `needs-human` state (never a partial success) if final checks or the commit fail.

- **Snapshot forgery / concurrent unrelated writers** — mitigated by retaining full raw `git status` command output in the audit artifact for post-hoc inspection and enforcing single-driver discipline (this repo's own rule against concurrent milestone dispatches); stated plainly as mechanical adjudication of command output within the existing agent/tool trust boundary, not a cryptographic attestation that an agent process cannot lie.

### Non-goals

No candidate-scoring/cadence/portfolio redesign (SELECT-side logic untouched beyond passthrough). No repeat of the width-7 canary — 2-3 real tasks is sufficient for the real regression proof. No partial Land under any circumstance. No composite use of `concurrent_execute`. No new workflow DSL primitives (import/filesystem/shell) — CLI/JSON boundaries only. No NLP-based inference of prohibiting edges. No worktree-per-phase as the primary architecture (defensive-only, if used at all — this repo does not currently isolate `execute-milestone.js`'s Build phase in a worktree, and introducing that here would be a much larger, orthogonal runtime change). No product-package or Provider ABI changes. No rework of the four existing milestone gates or the it0 checks themselves. No closure of DIR-118 (recorded as a Finding only). No promotion of DIR-119-C or its parent DIR-119 until the fresh independent audit this task requires re-confirms DIR-119-C's own AC #5/#10.

### Acceptance-criteria coverage

Each item below maps onto the task's own already-drafted AC checkboxes below (not restated verbatim here to avoid drift):

- The single "fails the whole directive if unmet" AC — real production-wiring grep/import-graph evidence for all five CLI surfaces (synthesis, Build-plan, Audit-snapshot/combine, Reconcile, Land) in both mirrors, excluding prose and `--selftest`-only/type-only reachability.

- Real journal Build-phase call count == manifest phase count (> 1 for the real proof run), respecting dependency batches.

- Real journal Audit-shard call count == manifest shard count, each shard scope-limited, with mechanical (not self-reported) read-only comparison.

- Literal Reconcile journal entry between the last Audit-shard call and Land; git-diff timing shows the tree clean through Build/Audit and dirty only from Reconcile.

- RED/GREEN evidence for the hostile-shard-write mechanical catch.

- RED/GREEN evidence for the Gate-failure attribution fix naming the true failing member(s), not `_primaryTaskId` by default.

- Manifest synthesis exercised on one real SELECT-produced `MilestoneCandidate`, not a hand-authored fixture, validated by the unchanged `composite-preflight.ts` contract check.

- Legacy width-1 golden-replay behavior identity, including no new Reconcile overhead or failure surface.

- Composite-plus-concurrent and manifest-missing wide calls both rejected fail-closed with their own stable reason codes before Build.

- Fresh independent audit explicitly briefed to trace import graphs (including the type-only-import nuance above) and exercise the Gate-failure branch (the prior audit's own documented blind spot), plus re-confirmation of DIR-119-C's AC #5/#10.

### Mechanism-claim wiring ledger

Each of the following is a new call/dispatch/ownership relationship this proposal asserts (or a claim about the current broken state being fixed); each needs its own grep/import-graph/journal-count AC-level proof, not prose:

- **W1 — SELECT ownership and synthesis callsite:** the single real `select-preflight.js` file (no `plugin/workflows/` mirror exists, per the correction above) passes through the real portfolio/candidate; `OUTER-LOOP.md`'s `execute()` step gains a grep-confirmable callsite that, for `taskIds.length > 1`, invokes `composite-manifest-synthesis.ts` between the real SELECT `MilestoneCandidate` and dispatch and threads `compositeManifestFile` into the existing dispatch args shape.

- **W2 — synthesis self-validates and fails closed:** `composite-manifest-synthesis.ts` calls `checkCompositeContract()` on its own output before its atomic (temp-file-plus-rename) write, reusing (not reinventing) `touches-orthogonality-check.ts`/`coupling-graph.ts` exports including the correctly-named `hasProhibitingEdge`; a composite-shape dispatch missing `compositeManifestFile` fails closed with `composite-manifest-missing`, and composite-plus-`mode:"concurrent"` fails closed with `composite-concurrent-unsupported`, both before Build — verified by RED fixtures for each reason code.

- **W3/W4 — Build dispatches one agent per manifest phase:** `execute-milestone.js` literally invokes `composite-build.ts`'s `plan` CLI, then dispatches one real `agent()` per phase via `parallel()` within dependency-ready, capacity-bounded batches, with the resulting `build-phase-<id>` label set exactly equal to the manifest's phase-ID set in the real journal; `build-integrate` performs the one commit and invokes `--map-evidence-json`.

- **W5/W6/W7 — Audit dispatches one agent per shard with mechanical enforcement:** `execute-milestone.js` literally dispatches one real `agent()` per shard; the workflow (not the agent, not in-process `deepFreeze`) performs the before/after `git status` diff and the fail-closed decision; `audit-combine` literally invokes `composite-audit.ts`'s real `combineShardVerdicts()`.

- **W8 — typed gate identity:** Gate's failure branch literally invokes an `attributeGateFailures()`-shaped function rather than continuing to hardcode `_primaryTaskId`; gate closures return structured `{scope, taskId, gate, ok, detail}` records.

- **W9/W10 — literal Reconcile, sole writer:** a literal `Reconcile` phase exists in `meta.phases` between Gate and Land and literally invokes `composite-reconcile.ts`'s real `reconcile()` through a non-`--selftest` CLI mode; `reconcile-apply` is the only agent in the entire workflow whose prompt instructs writing task AC/DoD ticks, status, dashboard rows, or absorb dispositions for a composite dispatch — that language is removed from Build/Audit prompts, not merely left unexercised.

- **W11 — atomic Land:** Land literally invokes `composite-land.ts`'s `buildLandTransaction()` and refuses to commit on any membership/count mismatch, in both mirrors.

- **W12 — legacy path is untouched:** the width-1 legacy path calls none of composite-build/audit/reconcile/land's new CLI modes and produces no `build-phase-*`/`audit-shard-*`/`reconcile-apply` journal entries — proved by golden-replay comparison against `legacySingletonLandShape()`, not by absence-of-mention.

- **W13 — mirrors are byte-identical:** all of W1-W12 hold identically in `plugin/workflows/execute-milestone.js` and `plugin/scripts/composite-*.ts`, verified by `cmp`/`sync-vendor.sh --check`, not merely asserted as "mirrored."

### Alternatives considered and rejected

1. **Leave Build/Audit as prompt-text references to the tested modules (status quo).** Rejected: this is the exact defect under repair — zero (or type-only) production importers for all four modules, `--selftest`-only reachability — and it is precisely what the prior DIR-119-C independent audit's own checklist missed.

2. **Add a direct TypeScript import or a new shell/filesystem primitive to the workflow DSL.** Rejected: the DSL deliberately exposes only `phase`/`agent`/`parallel`/`log`/`args`; expanding the runtime's primitive surface is out of this task's scope and would itself be a second high-risk control-plane change.

3. **Run manifest synthesis inside SELECT, Verify, or Build instead of as a discrete SELECT-to-dispatch step.** Rejected: synthesis needs the final `MilestoneCandidate` (so it cannot run inside SELECT) but must complete before Verify's contract enforcement and Build's phase dispatch (so it cannot run later); keeping it a separate step lets Verify treat the manifest as an input to validate rather than a side effect it must itself compute.

4. **One monolithic Build/Audit agent that internally "simulates" per-phase/per-shard structure and self-reports counts.** Rejected: one real `agent()` call is one journal entry regardless of what the agent claims to have done internally — this cannot produce independently-countable journal evidence and reintroduces exactly the self-report trust problem read-only enforcement is meant to remove.

5. **Worktree-per-phase as the primary architecture for parallel safety.** Rejected as primary (may remain a defensive option): this repo's documented operating model runs milestones directly in a shared working tree with no worktree isolation on the default path; relying on worktrees as the safety mechanism contradicts current practice and would need its own unproven infrastructure. Overlap-fusion plus serialized integration commits is the mechanism actually available today.

6. **Let phases with a shared owner cap run in parallel commits, or reuse the same agent label across phases to save call count.** Rejected: parallel commits in one shared checkout corrupt Git state (index/HEAD race); reused labels defeat the one-call-per-phase journal-count proof the AC requires.

7. **Trust `composite-audit.ts`'s existing `deepFreeze`/`structuredClone` in-process isolation as sufficient read-only enforcement.** Rejected: proven (by this task's own Finding, independently reproduced this session) to bind only JS object mutation, not filesystem writes by a dispatched agent — mechanical `git status` snapshot diffing is the only enforcement point with the right scope.

8. **Allow Audit to keep writing checklist/absorb/dashboard state, treating Reconcile as an additional writer rather than the sole one.** Rejected: multiple potential writers reopens exactly the state-owner-drift risk this task exists to close; Reconcile must be provably the only phase with write instructions.

9. **Route Reconcile before Gate, or keep direct primary-task-only attribution, or infer failed members from label string parsing/array position.** Rejected: Reconcile's own contract requires the complete gate vector as input; label/position-based attribution is the literal defect being fixed, and typed structured results eliminate it structurally.

10. **Allow partial Land (land the passing members, needs-human only the failing ones).** Rejected by the existing `landPolicy:"atomic"` invariant and by this task's own explicit non-goal; passing-member identity is recovery information for the human, not authorization to land part of a bundle.

11. **Keep the current wide-dispatch-with-no-manifest vacuous pass, or fold composite dispatch into `concurrent_execute`'s existing fan-in.** Rejected: both bypass the boundaries this task is meant to enforce; a wide call without a manifest and a composite-plus-concurrent call must both fail closed with stable, distinct reason codes before Build.

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
  `execute-milestone.js` dispatches one planner agent on `composite-build.ts plan`
  (also invoked as `--plan-json`) producing one `build-phase-*` owner per phase (equivalently
  labeled `build-phase-<id>`), then
  `await parallel(...)` of one labeled `agent()` per phase (label `build-phase-${phaseId}` ≡
  `build-phase-<id>`) scoped to that phase's `taskIds` and respecting `requires`, and a final
  `--map-evidence-json` call (`mapEvidenceToTasks`) folding each phase agent's
  `PhaseEvidence{phaseId, files, commits, tests}`; `build-phase-<id>` count == manifest phase count
  confirmed in the real journal, mechanical helpers excluded.
- [ ] **Audit dispatch is per-shard with mechanical read-only proof (W5/W6/W7):** verified from the
  real journal — `execute-milestone.js` dispatches one `audit-shard-*` owner (equivalently labeled
  `audit-shard-<id>`) per `auditShards[]` entry, enforces the read-only boundary via workflow-side
  `checkShardReadOnly`
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
- [ ] **SELECT-side passthrough is real, proven in the M196 journal (W1'):** verified — both
  `select-preflight.js` wrappers pass through the real synthesized `portfolio`/candidate (not a
  hand-shaped stub); `OUTER-LOOP.md`'s `execute()` step invokes synthesis exactly when
  `taskIds.length > 1` and threads the resulting `compositeManifestFile` into the real dispatch.
- [ ] **Phase planning respects the parallelism cap (W3''):** verified via unit test + real journal
  — `composite-build.ts`'s plan CLI gives each phase a unique `build-phase-<id>` owner and never
  exceeds `maxParallelAgents` simultaneous phase dispatches in one batch, confirmed by counting
  concurrent `build-phase-<id>` calls in the real journal against the configured cap.
- [ ] **Batch dispatch is real per-phase `parallel()` (W4''):** verified from the real journal —
  within one proved-independent batch the workflow calls `parallel()` with exactly one labeled
  `build-phase-<id>` agent per manifest phase in that batch; batches themselves run serially.
- [ ] **Audit combine callsite is real (W7''):** verified via import grep + real journal — after
  every `audit-shard-*` owner returns, the `audit-combine` helper agent invokes
  `composite-audit.ts`'s real `combineShardVerdicts()` function (not a re-derivation), binding the
  returned bundle to the integrated build generation.
- [ ] **Verify-phase fail-closed reason codes are real (W2''):** verified by RED fixture — a wide
  dispatch missing a manifest returns exactly `revision-needed/composite-manifest-missing`; a
  composite dispatch combined with `mode:"concurrent"` returns exactly
  `revision-needed/composite-concurrent-unsupported`; both checked before any `{manifest,context}`
  is accepted into Build.
- [ ] **Journal label taxonomy is exhaustive and exact (W-count'):** verified from the real journal
  — filtered counts show exactly one `build-phase-*` label per manifest phase and one
  `audit-shard-*` label per manifest shard; the mechanical helper labels `build-plan`,
  `build-integrate`, `audit-combine`, and `reconcile-apply` are each present exactly once per
  composite dispatch and are excluded from the phase/shard counts above.
- [ ] **Legacy Land-shape oracle is real, not narrative (W12'):** verified by golden-replay test —
  a legacy `{taskId,…}` dispatch's real Land transaction is byte-for-shape identical to
  `legacySingletonLandShape()`'s asserted output, confirmed by a real test comparison, not by
  prose claiming equivalence.
- [ ] **Shared-tree discipline is mechanically checked, not only documented (Risk-control'):**
  verified — the real M196 dispatch runs under a present root `.halt` sentinel and `scripts/test.sh`
  is run in full (not a subset) as part of this milestone's own Gate/DoD evidence, with its pass/
  fail tally pasted into the iteration report.
- [ ] **End-to-end production-wiring set is real on both mirrors (W-summary'):** verified via
  import grep on BOTH `.claude/workflows/`+`plugin/workflows/` and BOTH
  `experiments/quay-perpetual-stream/scripts/`+`plugin/scripts/` — the real dispatch's journal
  shows, in order, `{manifest,context}` synthesis → `build-phase-*` calls → `audit-shard-*` calls →
  `reconcile-apply` → Land, and the `reconcile-apply` agent's own returned mutation set is the one
  that names `failedTaskIds`/`passingTaskIds` on any gate failure fixture.
- [ ] **All five composite CLI entrypoints are real, non-selftest production callsites
  (W-CLI-set'):** verified via grep of literal command strings in both workflow mirrors —
  `composite-manifest-synthesis.ts` is invoked with `checkCompositeContract()` self-validation
  before write; `composite-build.ts`'s `plan` mode is invoked to produce the phase DAG; each
  `build-phase-<id>`/`audit-shard-<id>` agent is dispatched per the plan; `combineShardVerdicts()`
  is invoked by `audit-combine`; `composite-reconcile.ts`'s real `reconcile()` (paired with
  `attribute-gates`) is invoked by `reconcile-apply`; and `composite-land.ts`'s
  `buildLandTransaction()` is invoked by Land — none reachable only via `--selftest`.
- [ ] **Synthesis reuses the real coupling/touches exports, not a reimplementation
  (round-3 W2''):** verified via import grep — `composite-manifest-synthesis.ts` calls
  `touches-orthogonality-check.ts`'s exported `parseTouches`/`expandGlobs`/`filesDisjoint` and
  `coupling-graph.ts`'s exported `buildCouplingGraph`/`deriveInternalOrderEdges`/
  `hasProhibitingEdge` directly (no duplicate local reimplementation of any of the six).
- [ ] **Synthesis CLI self-validates against the real, unmodified contract checker
  (round-3 W2'''):** verified via import grep + RED fixture — the synthesis CLI's own contract
  check calls `composite-contracts.ts`'s existing, unmodified `checkCompositeContract()` export
  (not a local reimplementation) on its own output before any write.
- [ ] **Synthesis capacity defaults are real exported constants, not inline literals
  (round-3 W2''''):** verified via source read — `maxPhases:32`, `maxAuditShards:64`,
  `maxParallelAgents:4`, and `landPolicy:"atomic"` are exported `CapacityLimits` defaults
  serialized into the synthesized `context`, overridable only through validated options.
- [ ] **OUTER-LOOP's execute() callsite is grep-confirmable in the real doc
  (round-3 W1''):** verified via grep of `experiments/quay-perpetual-stream/OUTER-LOOP.md` —
  the `execute()` step's real text names the `taskIds.length > 1` condition, invokes the
  synthesis CLI, and threads `compositeManifestFile` into the real `execute-milestone.js`
  dispatch args.
- [ ] **Build planner respects the manifest phase-owner/cap distinction
  (round-3 W3''''):** verified via unit test — the plan CLI assigns each manifest phase a
  unique `build-phase-<id>`/`build-phase-*` owner, and `maxParallelAgents` bounds only
  simultaneous dispatches within one batch, never the owner/label count itself.
- [ ] **Build-plan helper dispatches per-phase `parallel()` calls, proven from the real journal
  (round-3 W4'''):** verified from the real journal — the `build-plan` helper's plan output
  drives `await parallel(...)` of exactly one labeled `build-phase-<id>` agent per phase within
  each dependency-ready batch.
- [ ] **Build-integrate performs the one commit and invokes evidence mapping
  (round-3 W3''''''):** verified via import grep + real journal — the serial `build-integrate`
  helper is the sole creator of the one candidate-generation commit and is the caller of
  `--map-evidence-json`, confirmed as a real production callsite (not `--selftest`-only).
- [ ] **Audit dispatches per-shard against the real manifest shard array
  (round-3 W5''''):** verified from the real journal — `execute-milestone.js` dispatches one
  `audit-shard-<id>` agent per real `manifest.auditShards[]` entry, count-equal in the real run.
- [ ] **Read-only enforcement is proven insufficient in-process, mechanical in the workflow
  (round-3 W6'''):** verified via RED/GREEN fixture — `composite-audit.ts`'s existing
  `deepFreeze`/`structuredClone`-based `runReadOnlyAuditShard()` is shown NOT to catch a
  dispatched agent's real filesystem write, while the workflow's own before/after `git status`
  diff catches it and produces `audit-shard-write-violation:<id>`.
- [ ] **Audit-combine invokes the real combiner producing a real bundle type
  (round-3 W7'''):** verified via import grep — the `audit-combine` helper's CLI call invokes
  `composite-audit.ts`'s real `combineShardVerdicts()`, and its output matches the
  `BundleAuditResult` shape that export already defines.
- [ ] **Verify-phase reason codes match the manifest-validating preflight check
  (round-3 W2'''''):** verified by RED fixture — `composite-preflight.ts`'s check emits exactly
  `revision-needed/composite-manifest-missing` and exactly
  `revision-needed/composite-concurrent-unsupported` (for `mode:"concurrent"`) before accepting
  any `{manifest,context}` into Build.
- [ ] **Prepared-gate Touches declaration is genuinely exercised by the real dispatch
  (round-3 Prepared'):** verified from the real M196 run — `milestone-preparation-check.ts`'s
  `touches-expanded` trigger, checked against the real `preparationReceiptFile`, does NOT fire on
  this task's own declared `## Touches` (which names every touched `composite-*.ts` file in both
  canonical and `plugin/` trees).
- [ ] **Journal helper-label taxonomy for Build is exact (round-3 W-labels'):** verified from the
  real journal — the labels `build-plan`, `build-phase-<id>` (one per phase), `build-integrate`,
  and `--map-evidence-json`'s invoking call are each individually identifiable and separately
  countable, with no label collision between phase owners and helpers.
- [ ] **Reconcile-apply's snapshot-diff-driven journal entry is real, not narrative
  (round-3 Reconcile-journal'):** verified from the real journal — one `audit-shard-*` call per
  shard is immediately followed by `reconcile-apply`, and the `git status` diff evidence pinned
  to that transition matches the Compatibility section's stated tree-clean-until-Reconcile
  invariant.
- [ ] **SELECT-side single-file passthrough is exercised for real (round-3 W1'''):** verified —
  the single real `select-preflight.js` file (confirmed no `plugin/workflows/` mirror exists)
  passes through the real synthesized portfolio/candidate in the real M196 dispatch; `OUTER-LOOP.md`'s
  `execute()` step invokes synthesis exactly when `taskIds.length > 1` and threads the resulting
  `compositeManifestFile` through to `composite-manifest-synthesis.ts`'s real `MilestoneCandidate`
  input.
- [ ] **Coupling/touches export names are the actually-exported symbols, grep-confirmable
  (round-3 W2 naming'):** verified via import grep — `composite-manifest-synthesis.ts` imports
  and calls the real exported `parseTouches`/`expandGlobs`/`filesDisjoint` from
  `touches-orthogonality-check.ts` and `buildCouplingGraph`/`deriveInternalOrderEdges`/
  `hasProhibitingEdge` from `coupling-graph.ts` — using the correct `hasProhibitingEdge` name
  (not the superseded `isProhibiting` name from an earlier draft).
- [ ] **`maxParallelAgents` bounds concurrent Build dispatches, not phase ownership
  (round-3 cap'):** verified via unit test — `execute-milestone.js`'s composite Build path never
  exceeds `maxParallelAgents` simultaneous `agent()` calls within one batch, while the
  `build-phase-<id>` owner count always equals the manifest's phase count regardless of the cap.
- [ ] **Preflight's two new reason codes are wired against the real manifest/contract checker
  (round-3 preflight-codes'):** verified by RED fixture — `composite-preflight.ts` returns
  `revision-needed/composite-manifest-missing` and
  `revision-needed/composite-concurrent-unsupported` (for `mode:"concurrent"`) as the literal
  reason strings, and only a `{manifest,context}` pair that passes `checkCompositeContract()` is
  accepted into Build.
- [ ] **Build-plan → per-phase `parallel()` → build-integrate → map-evidence is one real chain
  (round-3 build-chain'):** verified from the real journal — `build-plan`'s CLI output literally
  drives the `parallel()` dispatch of `build-phase-<id>` agents, and `build-integrate` is the
  caller of `--map-evidence-json`, all as one ordered real production chain (not independently
  asserted pieces).
- [ ] **Synthesis's fail-closed reason codes trace to composite-preflight's real check
  (round-3 synthesis-preflight-link'):** verified via import grep — `composite-manifest-synthesis.ts`
  calls `checkCompositeContract()` on its own output, reusing `touches-orthogonality-check.ts`/
  `coupling-graph.ts` exports including `hasProhibitingEdge`, and threads `compositeManifestFile`
  such that the same `composite-manifest-missing`/`composite-concurrent-unsupported`
  (`mode:"concurrent"`) reason codes `composite-preflight.ts` emits are the SAME literal strings
  (not independently redefined), confirmed by grepping both files for the constant.
- [ ] **Build phase dispatches its `plan` CLI call and per-phase agents as literal production
  code (round-3 build-plan-cli'):** verified via import grep + real journal —
  `execute-milestone.js` contains a literal command string invoking `composite-build.ts`'s
  `plan` mode, then dispatches one real `agent()` per phase via `parallel()` within
  dependency-ready, capacity-bounded batches, with the resulting `build-phase-<id>` label set
  exactly equal to the manifest's phase-ID set in the real journal; the same real journal shows
  `build-integrate` performing the one commit and invoking `--map-evidence-json`.
- [ ] **Audit's mechanical read-only diff and combine step are real production code
  (round-3 audit-diff-combine'):** verified via import grep — `execute-milestone.js` literally
  dispatches one real `agent()` per shard, and the workflow itself (not the agent, not in-process
  `deepFreeze`) performs the before/after `git status` diff comparison in workflow JS (not
  agent-reported) driving the fail-closed decision; `audit-combine` literally invokes
  `composite-audit.ts`'s real `combineShardVerdicts()`.
- [ ] **Gate's typed attribution function is real, not the old label-parsing branch
  (round-3 gate-typed'):** verified via source read + RED/GREEN fixture —
  `attributeGateFailures()` consumes a real `{scope, taskId, gate, ok, detail}` vector (not
  `_primaryTaskId` string/position parsing) and its needs-human output names the specific failing
  member(s).
- [ ] **Reconcile phase entry literally exists in `meta.phases` and invokes real `reconcile()`
  (round-3 reconcile-phase'):** verified via source read + real journal — `meta.phases` (both
  mirrors) contains a literal `Reconcile` entry between Gate and Land, and its agent invokes
  `composite-reconcile.ts`'s real `reconcile()` through a non-`--selftest` CLI mode dispatched by
  `reconcile-apply`.
- [ ] **Write-instruction language is structurally absent from Build/Audit prompts, not merely
  unexercised (round-3 write-instruction-removal'):** verified via static grep of both
  `execute-milestone.js` mirrors' composite Build/Audit prompt template literals — none contains
  checklist-tick, absorb-disposition, deviation-log, or dashboard-write instruction text; this is
  a structural source-text check independent of any single real run's clean `git status`, so a
  stale write instruction merely not triggered by one proof dispatch cannot pass this item.
- [ ] **Journal label taxonomy for Land matches the golden-replay oracle
  (round-3 land-labels'):** verified from the real journal — `build-phase-*`/`audit-shard-*`
  counts plus the single `reconcile-apply` entry, taken together, are the exact input shape
  `legacySingletonLandShape()`'s golden-replay comparison expects at width 1 (zero of these
  labels present) versus width > 1 (all present, counts matching the manifest).

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
