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

### Problem framing

The current system has contracts but not callers. `execute-milestone.js` has Verify → Prepared → Build → Audit → Gate → Land, one unlabeled Build agent and one Audit agent at every composite width, and no Reconcile phase. The composite modules are selftest-only (or only type-imported): `composite-build.ts` does not plan live phases or map live evidence; `composite-audit.ts` only deep-clones/freezes in-process objects, which cannot constrain a filesystem-writing agent; `composite-reconcile.ts` is not invoked; and `composite-land.ts` does not enforce the live transaction. Audit currently writes checklist ticks, absorb/disposition and deviation state. Gate labels identify member tasks, but its failure branch discards identity and marks only `_primaryTaskId` needs-human. The real SELECT pipeline emits a flat `MilestoneCandidate`; phase and shard arrays have only been fixture- or hand-authored, so the prior canary did not prove SELECT-to-manifest wiring. The independent audit that found this gap checked journals and atomicity but did not trace production call graphs or exercise a failing member gate.

The workflow DSL exposes `phase`, `agent`, `parallel`, `log`, and `args`, but no module import, file read, or shell primitive. Literal wiring therefore means a labeled workflow agent invoking a deterministic JSON CLI, with the workflow owning sequencing/fan-out and deciding only on structured results. The repository executes directly in a shared working tree: even disjoint Touches do not make concurrent Git index, HEAD, generated-file, or broad-tool effects safe. A phase meter must therefore not be achieved by concurrent commits or by reusing one owner for several phases.

### Chosen mechanism

Implement a composite-only branch for effective width greater than one. Preserve the legacy scalar and singleton branch as the compatibility oracle. Add canonical modules first, byte-copy them to `plugin/`, and keep every pair byte-identical with `sync-vendor.sh --check`, direct `cmp`, and packaging tests.

1. **Synthesis at the SELECT boundary.** Add `composite-manifest-synthesis.ts` and its mirror. Its pure API accepts the exact SELECT `MilestoneCandidate`, authoritative current task facts, and coupling graph and returns `{manifest, context}`. Its CLI accepts candidate/charter/workspace/task-store inputs and an output path, validates source hashes and charter membership, calls `checkCompositeContract()` before writing, and writes by temporary file plus rename. It must fail closed without leaving a partial artifact. Update both `select-preflight.js` wrappers to pass through the real `portfolio`/selected candidate; `OUTER-LOOP.md` invokes synthesis for `taskIds.length > 1` between SELECT and execute dispatch and passes `compositeManifestFile`. No hand-authored manifest satisfies the real proof.

   Fact extraction is canonical and shared rather than duplicated: actual Acceptance Criteria checkbox counts, `parseTouches`, `expandGlobs`, `filesDisjoint`/the existing Touches orthogonality checks, `buildCouplingGraph`, `deriveInternalOrderEdges`, and `isProhibiting` are reused. Unknown, missing, empty, overbroad, or zero-match Touches overlap everything, never create optimistic parallelism. Sort task IDs and all serialized collections. Stable IDs derive only from sorted membership and fixed prefixes; no timestamp, random value, filesystem enumeration order, or current commit enters the manifest. Emit sorted unions of Touches/resources, `landPolicy:"atomic"`, one `task-ac` shard per task, and one `semantic-integration` shard for each multi-task phase. Strengthen contract validation for duplicate/dangling phases, dependencies, shards, membership, and empty records as needed. Use explicit exported defaults (`maxPhases:32`, `maxAuditShards:64`, `maxParallelAgents:4`), preserve SELECT resource/line budgets when supplied, and report capacity violations specifically.

   Build an undirected overlap graph. Union-find every pair not proved Touches-disjoint into one shared implementation phase with one owner and a deterministic integration invariant naming members and overlap reason. Translate cross-component internal-order edges into `requires`; retain intra-component order as ordered instructions. Do not silently weaken prohibiting edges or cycles. A valid candidate with precise disjoint Touches must produce more than one phase for the real proof; uncertainty may safely collapse to one.

2. **Build as a real phase DAG.** Add non-selftest JSON `plan`, `verify-batch`/phase-evidence validation, and `map-evidence` modes to `composite-build.ts`. Planning gives each phase a unique `build-phase-<id>` owner and chunks dependency-ready levels into bounded sub-batches; `maxParallelAgents` limits simultaneous calls, never phase ownership or call count. Unknown dependencies, cycles, duplicate/missing evidence, out-of-scope files, unexpected commits, or integrated-generation mismatch fail closed.

   A labeled `build-plan` helper invokes the plan CLI. Batches run serially; within a proved-independent, proved-disjoint batch the workflow calls `parallel()` with exactly one labeled `build-phase-<id>` agent per manifest phase. Prompts contain only that phase's task IDs, predecessors, invariant, allowed Touches, and evidence schema. Workers do not stage or commit. A serial `build-integrate`/finalize helper validates changed files, integrates in deterministic topological order, runs integration tests, creates the one candidate-generation commit, and invokes evidence mapping. If runtime isolation cannot be supplied, serialize rather than parallelize; never commit concurrently in the shared checkout. Helpers use distinct labels and cannot satisfy the phase-owner count.

3. **Audit as per-shard read-only dispatch.** Remove all composite checklist, absorb, deviation, artifact, staging, dashboard, lifecycle, and status instructions from Audit. Dispatch exactly one `audit-shard-<id>` agent for each manifest shard, with fixed shard identity and only its declared task IDs, AC indexes, invariant, and integrated generation. Each worker obtains exact before/after `git status --porcelain=v1 --untracked-files=all` snapshots around its inspection and returns raw snapshots plus typed verdicts. Add production snapshot/guard and combine modes to `composite-audit.ts`; export the pure exact comparison used by the workflow. The workflow, not auditor prose, converts any delta (including a planted untracked or tracked write) into `REFUTED` with `audit-shard-write-violation:<id>`. A distinct `audit-combine` helper invokes `combineShardVerdicts()` and binds the bundle to the integrated generation ID. Snapshot transport remains within the platform trust boundary: this is mechanical adjudication of command output, not cryptographic proof that an agent cannot forge output. Audit writes no tracked state or artifact.

4. **Typed Gate results and literal Reconcile.** Change task gate closures to return `{scope:"task", taskId, gate, ok, detail}` and milestone gates to return `{scope:"milestone", gate, ok, detail}`; labels remain observability metadata, never the identity source. Gate must collect the complete vector and route failures onward rather than marking `_primaryTaskId` directly. Insert literal `Reconcile` after Gate and before Land because the existing reconcile contract requires complete task and milestone gate evidence.

   Add non-selftest `reconcile` and `attribute-gates` commands to `composite-reconcile.ts`. Reconcile checks generation, complete shard verdicts, all task gates, all milestone gates, and exact membership, then returns either the complete success mutation plan or zero success mutations plus a deterministic failure disposition. Attribution names exact `failedTaskIds`, `passingTaskIds`, failed gate details, and separately reports milestone-scoped failures; `_primaryTaskId` is not special. On any gate/audit/generation/contract failure the bundle remains atomic and no member is completed. A task-scoped failure may record needs-human for the actual failed members only; a milestone-scoped failure records the whole bundle and all blocked members without false member attribution.

   A single `reconcile-apply` agent is the only composite writer. On success it applies the returned complete set of AC/DoD ticks, lifecycle/status changes, absorb dispositions, deviation/write-back rows, and consolidated audit artifact. It uses pre-images/rollback or equivalent all-or-nothing staging and performs final checks. On failure it writes only the deterministic recovery record permitted by policy and never partial success state.

5. **Atomic Land transaction.** Add production `land`/`plan` mode to `composite-land.ts` invoking `buildLandTransaction()`. Before any mutation, require `ok:true`, `counterDelta===1`, `dashboardEntryCount===1`, `taskCompletionCount===taskIds.length`, atomic policy, and set-equal membership. Land rechecks the exact pending transaction, integrates/captures it, increments the counter once, writes one dashboard row with completion count, and commits once; it does not recompute verdicts or independently derive task/absorb/dashboard state. A mismatch yields `needs-human` with zero counter, dashboard, or done-status writes.

### Control and data flow

1. SELECT returns the real portfolio/candidate; the caller invokes synthesis only for a multi-member candidate and threads the unchanged candidate, manifest path, charter, and mandatory preparation receipt into `execute-milestone.js`.
2. Verify rejects wide calls without a manifest as `revision-needed/composite-manifest-missing`, rejects composite plus `mode:"concurrent"` as `revision-needed/composite-concurrent-unsupported`, and validates the generated `{manifest,context}` and source hashes before Build. The width-one vacuous/legacy path remains allowed.
3. Prepared remains mandatory and proves Proposal/Plan freshness plus expanded Touches, including every new caller, mirror, test, sync, and workflow path declared by this task.
4. Build plan → serial dependency batches → per-phase labeled workers → serial integration/generation commit → evidence verification and mapping. Audit starts only from clean integrated Build state.
5. Audit shard workers return fixed-scope verdicts and raw snapshots; workflow comparison adjudicates read-only; combine produces generation-bound bundle audit. Gate emits typed task/milestone vectors without mutation.
6. Reconcile consumes the bundle and complete gate vectors, attributes failures, and either returns/applies the complete mutation set or a zero-success failure record. Land validates and captures the one atomic transaction.

Real-run evidence must include literal command callsites and matching journal entries in both installed mirrors. Filtered journal counts must show exactly one `build-phase-*` call per phase and one `audit-shard-*` call per shard; helper labels (`build-plan`, `build-integrate`, `audit-combine`, evidence mapper, `reconcile-apply`) are reported separately. Journal ordering must be last shard → Gate → Reconcile → Land, with the tree clean through Build/Audit and first canonical write-back in Reconcile.

### Key design decisions

- **Conservative fusion:** overlap-connected Touches components have one owner; disjoint components may batch in parallel only when dependencies and write sets are proven safe. A cap chunks batches, never collapses owners. Shared-working-tree phase workers never commit concurrently; worktree isolation is not assumed or a substitute for grouping, and serial execution is the safe fallback.
- **Reconcile follows Gate:** its existing contract needs task and milestone gates. It is the sole composite state writer; Land is a transaction validator/commit owner, not a second policy engine.
- **Typed identity:** gate results carry task identity structurally; do not parse labels or positional result order. Passing-member disclosure is recovery information, never authorization for partial atomic Land.
- **Read-only means zero tracked/untracked delta:** no audit artifact or “allowed” write exception. Deep-freeze remains an in-process unit test, not filesystem enforcement. Transported snapshots are honestly bounded by the agent/tool trust model.
- **CLI boundaries are explicit:** JSON stdin/files, JSON stdout, stable reason codes, non-selftest modes, deterministic artifacts, and atomic writes. Comments/prompts naming a module do not count as wiring.
- **Legacy boundary is hard:** width-one avoids synthesis, per-phase/per-shard fan-out, Reconcile, and composite Land CLI and is tested by a journal golden replay, not only a singleton helper.

### Defaults and failure behavior

Defaults are `maxParallelAgents:4`, `maxPhases:32`, `maxAuditShards:64`, `landPolicy:"atomic"`; all are serialized in context and overrideable only through validated options. Synthesis refuses stale source hashes, unreadable or mismatched task/charter inputs, invalid Touches, prohibiting edges, cycles, missing/dangling phase or shard records, contract violations, and capacity overflow. It leaves no partial output.

Any null/crash/malformed CLI result, unknown phase/shard, duplicate evidence, missing phase/member verdict, dependency violation, out-of-scope file, unexpected HEAD change, generation mismatch, failed audit verdict, or incomplete transaction fails closed before mutation with a stable reason code. Build failure prevents Audit. Audit delta refutes the affected shard and bundle. Any task or milestone gate failure blocks atomic Land; records failed and passing subsets, with milestone failures bundle-scoped. Reconcile failure yields zero success mutations. Land mismatch yields zero counter/dashboard/done writes.

### Compatibility

Legacy `{taskId,…}` and effective width-one candidates retain the current single Build, single mutating Audit, Gate, and Land behavior, with no Reconcile call or new composite failure surface; `legacySingletonLandShape()` and a real journal replay are the oracle. Existing valid hand-authored manifests remain accepted, but genuine wide dispatch now requires a synthesized manifest. `concurrent_execute()` remains independent singleton fan-in; wide composite plus concurrent mode is rejected. No product package or Provider ABI changes. Canonical/plugin workflow and script mirrors remain byte-identical, with sync and packaging checks. The `OUTER-LOOP.md` execute shape and this task's `## Touches` are expanded to cover SELECT passthrough, synthesis, both mirrors, sync tooling, and tests, then Prepared is rerun. Existing composite contract version remains unless a breaking serialized field is unavoidable.

### Risks and mitigations

- **Control-plane regression/shared tree:** retain root `.halt`, never overlap milestone execution, use width-one golden replay, bounded/fail-closed batches, one integration commit, focused tests, full `scripts/test.sh`, and restart-readiness check before unhalting.
- **False safety from prompts or clone/freeze:** require literal non-selftest CLI calls, raw journal/import-graph audit, exact snapshots, hostile-write RED/GREEN fixtures, and explicitly do not claim cryptographic attestation.
- **Unsafe or vague Touches:** reuse canonical parsers and Prepared expansion; uncertainty fuses/serializes rather than opens concurrency. The real proof must use a SELECT candidate whose declarations yield multiple phases.
- **State-owner drift:** remove composite write instructions from Build/Audit/Land, make Reconcile's complete mutation plan sole authority, and audit git-diff timing.
- **Mirror drift and helper-count confusion:** vendor sync, `cmp`, packaging test, stable semantic labels, and explicit journal inclusion/exclusion rules.
- **Rollback failure:** capture pre-images, validate transaction before edits, stage as one unit, and leave an inspectable needs-human state if final checks or commit fail.
- **Snapshot forgery or unrelated writers:** retain full raw command output, enforce single-driver discipline, independently inspect generation and working-tree history, and state the residual trust limitation.

### Non-goals

No candidate scoring/cadence/portfolio redesign; no width-seven canary repetition; no partial Land; no composite use of `concurrent_execute`; no new workflow import/filesystem primitives; no NLP inference of prohibiting edges; no worktree-per-phase as primary architecture; no product package changes; no rework of the four milestone gates or it0 checks; no closure of DIR-118, though this incident remains a Finding; and no promotion of DIR-119-C/DIR-119 until the fresh audit re-confirms their named ACs.

### Acceptance-criteria coverage

- **Production wiring:** synthesis, Build plan/evidence, Audit snapshot/combine, Reconcile/attribution, and Land transaction each have non-selftest CLI modes and literal callsites on the operational chain in both mirrors; import/call-graph audit excludes prose and selftests.
- **Real synthesis:** exact SELECT-produced candidate yields deterministic `{manifest,context}` with multiple phases where Touches permit, passes unchanged preflight, source-hash checks, and byte-identity rerun; invalid/hostile inputs produce no output.
- **Build:** real journal `build-phase-*` set equals manifest phases, count exceeds one for the proof, dependency batches are ordered, scope/evidence are phase-specific, and only integration creates the Build commit.
- **Audit:** journal `audit-shard-*` set equals shards, scopes are set-equal, raw snapshots are retained, clean RED/GREEN comparison catches a planted write, and combine binds to generation.
- **Reconcile ownership/order:** Audit and Build remain clean, typed gates flow through Gate, journal order is last shard → Gate → `reconcile-apply` → Land, and only Reconcile creates canonical task/dashboard/absorb/audit diff.
- **Attribution:** a two-member non-primary failing task fixture yields exact `failedTaskIds` and `passingTaskIds`, milestone failure is bundle-scoped, and no atomic Land transaction exists on failure.
- **Atomic Land:** valid transaction reports one counter, one dashboard row, and N completions; incomplete membership or any failure reports zero success writes.
- **Legacy and mirrors:** width-one golden journal matches prior shape with no new helpers/phases; canonical/plugin files are byte-identical and packaging/sync checks pass.
- **Independent audit:** a fresh auditor traces all five production chains, checks raw journal counts and git-diff timing, exercises both RED/GREEN fixtures and Gate failure, and explicitly re-evaluates DIR-119-C AC #5/#10 before promotion.

### Mechanism-claim wiring ledger

Each claimed relationship requires AC-level proof, not prose or an import that is type-only:

- **W1 SELECT ownership/synthesis:** SELECT wrapper returns the real portfolio; OUTER-LOOP invokes synthesis between candidate and dispatch; output is passed to Verify.

- **W2 synthesis enforcement:** shared fact extraction reuses Touches/coupling helpers and calls `checkCompositeContract()` before atomic write.

- **W3/W4 Build:** labeled planner invokes `composite-build.ts plan`; one `build-phase-*` owner per phase executes in dependency/capacity batches; integration invokes evidence verification/map.

- **W5/W6/W7 Audit:** one fixed-scope `audit-shard-*` owner per shard returns guard snapshots; workflow comparison refutes deltas; combiner invokes `combineShardVerdicts()`.

- **W8 Gate identity:** typed task/milestone gate envelopes preserve identity and complete vectors reach Reconcile.

- **W9/W10 Reconcile:** literal Reconcile follows Gate, invokes real `reconcile()` and `attribute-gates`, and is sole composite control-state writer.

- **W11 Land:** Reconcile/ Land invokes `buildLandTransaction()` and validates complete atomic membership before one commit/counter/dashboard transaction.

- **W12 compatibility:** width-one bypasses every new composite planner, shard, Reconcile, and Land transaction call; golden journal proves it.

- **W13 mirrors/evidence:** canonical and plugin paths are byte-identical; fresh independent audit checks both installed paths and re-verifies DIR-119-C AC #5/#10.

### Alternatives considered and rejected

1. Prompt-only references to tested modules: rejected because they are the existing defect and cannot satisfy production call-graph or journal evidence.
2. Direct TypeScript imports or new workflow shell/filesystem primitives: rejected because the DSL does not provide them and changing the runtime is out of scope; use established JSON CLI agent boundaries.
3. Synthesis inside SELECT, Verify, or Build: rejected because execution planning must be downstream of selection but upstream of Verify/Build contract enforcement.
4. One composite Build/Audit agent or hidden orchestrator: rejected because it falsifies per-phase/per-shard ownership and countable journal evidence.
5. One phase per task despite overlap, or worktree-per-phase as the primary fix: rejected because overlapping writers still conflict; fuse overlap, serialize uncertainty, and keep worktrees defensive only.
6. Reuse owner names under a cap or let phases commit in parallel: rejected because it violates one-call-per-phase or corrupts shared Git state; chunk bounded batches and use one serial integration commit.
7. Separate pre/post snapshot agents or trust `deepFreeze`/self-reported clean flags: rejected because they inflate shard counts or protect only in-memory objects; one shard transports exact snapshots and workflow adjudicates.
8. Allow Audit artifact/checklist writes: rejected because read-only becomes unprovable; Reconcile owns all composite write-back.
9. Reconcile before Gate, direct primary attribution, or label/position inference: rejected because reconcile requires gate vectors and identity must be typed; actual failed members and passing subset are recorded.
10. Partial Land or always-on singleton Reconcile: rejected by atomic policy and compatibility; passing IDs are recovery evidence, and width-one remains the existing path.
11. Keep wide no-manifest vacuous pass or combine composite with concurrent fan-in: rejected because both bypass required boundaries; fail closed with stable reason codes.

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
