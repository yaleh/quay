---
id: DIR-124-C
title: Extract a deterministic milestone control-plane kernel and narrow Stage
  Adapter ABI from the prompt workflow
status: done
labels:
  - directive
  - human-steered
parent: DIR-124
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124 一并关闭）**

原标题：Extract a deterministic milestone control-plane kernel and narrow Stage Adapter ABI from
the prompt workflow。Problem framing 原文开篇即引用「The installed execution driver
`.claude/workflows/execute-milestone.js` is 1257 lines」——**该文件已被 ADR-022（2026-08-03
accepted）物理删除**，kernel 抽取的对象不复存在。

实测：本任务体对 `execute-milestone.js`/`composite-` 等关键词命中 48 处，是本批中依赖最深的一份。

意见：见父任务 `DIR-124` 关闭说明。

全文见 git 历史（`git log -p -- tasks/DIR-124-C.md`）。

## Proposal

### Problem framing (grounded in the current repository, 2026-08-01)

The installed execution driver `.claude/workflows/execute-milestone.js` is 1257 lines and byte-identical to its plugin mirror `plugin/workflows/execute-milestone.js` (verified by `diff` this session). It dispatches seven `phase()`-bounded stages in literal file order — Verify (L66), Prepared (L234), Build (L389), Build-Evidence (L501), Audit (L719), Gate (L817), Reconcile (L919, composite-only), Land (L961) — and the legal transition between them exists only as prompt prose, `return {outcome:...}` branches, and `if/else` on agent returns. The workflow DSL has no `import` capability (documented at `execute-milestone.js` ~L28; only `phase`/`agent`/`parallel`/`log`/`args` globals), so every canonical TypeScript module is reached by dispatching a content agent whose prompt says "run this command and paste the stdout JSON." That is exactly the generic content-agent dispatch DIR-124-A5's baseline metrics count as non-mechanical, and it means deterministic checks (it0 ceiling/gate-hash/line-budget/dogfood, composite-preflight) travel through judgment-agent prompts today.

Three structural problems drive this milestone.

**P1 — The state machine is prompt-coupled, not executable.** Transitions (Verify→Prepared→Build→Build-Evidence→Audit→Gate→Reconcile→Land, plus the failure routes to `needs-human`/`revision-needed`) exist only as the workflow's imperative control flow. There is no transition table a test can invoke, no declared effect contract per stage, and no mechanical rejection of an adapter that exceeds its authority. "Effect authority" (Build writes only its candidate worktree; Audit/Gate read-only; Reconcile sole success-path proposer; Land sole fenced applier) is enforced today by prompt discipline plus workflow-side `git status` diffs and the deep-frozen snapshots in `composite-audit.ts` — partly by prose, not by one kernel check. The write-authority boundary also contradicts the requested target: today's Reconcile `reconcile-apply` agent is the physical writer of task AC/DoD ticks, `status:done`, dashboard rows, and absorb dispositions (L919–954), whereas DIR-124's parent AC and crystallization §5.4 require "deterministic Reconcile proposes a mutation transaction; fenced Land is the sole applier to integration/task/ABSORB/dashboard/backlog/counter state."

**P2 — The typed layer is a shadow architecture.** The DIR-119-D typed modules (`composite-args.ts`, `composite-contracts.ts`, `composite-build.ts`, `composite-audit.ts`, `composite-reconcile.ts`, `composite-land.ts`, `composite-preflight.ts`, `composite-manifest-synthesis.ts`), the DIR-123 `milestone-worktree.ts` service, and the M238 `build-evidence-*.ts` family sit beside the workflow but are reached mostly through agent-prompt instructions, not a direct call path. DIR-124-A's Finding names exactly this: "checked composite modules remained outside the live production call graph." The `_normalizeExecuteArgsInline` mirror (L29–46) is the canonical example — canonical logic unit-tested in `composite-args.ts`, re-implemented inline because the workflow DSL has no `import`; the same pattern exists for the isolation-plan mirror (L96–100) over `milestone-worktree.ts`'s `computeIsolationPlan`.

**P3 — The front-of-Execute ordering pays Verify cost before the receipt gate.** `phase('Verify')` runs the it0 systematic-explore checks and `composite-preflight` at L66, and only `phase('Prepared')` at L234 rejects a stale/missing `preparationReceiptFile`. DIR-124-A2's M195 fixture classifies this as `compatibility-only`: correct-by-design, but ~6 Verify agent calls are spent before a fail-closed receipt rejection. DIR-124-C's requested reorder (Prepared receipt/hash validation → deterministic Verify → semantic Verify) must be proven against golden replay so the eventual rejection is unchanged and only the cost timing moves. The M192 null-Build-continuation defect (a nominal `done` with missing required fields advancing) is a second live prompt-discipline-only failure shape this milestone closes mechanically.

The workflow DSL cannot `import` canonical TypeScript. The established pattern — used by `composite-preflight.ts`, `milestone-worktree.ts`, `prepare-admission-check.ts`, `build-evidence-collector.ts`, `wiring-coverage-check.ts`, and `workflow-event-schema.mjs` — is canonical logic in `scripts/*.ts` (both mirrors) invoked as CLI subprocesses (`node --experimental-strip-types <script> <mode> --input <json>`), with inline snippets kept only where prompt interpolation needs a value. Any control-plane extraction MUST follow that constraint, or it will be dead code. This is **not a new mechanism class**: the kernel/adapter transport is the same fixed CLI + typed-stdout transport already proven by those modules. The difference is that the agent prompt for mechanical stages collapses to "run this kernel mode and return its typed stdout verbatim," removing judgment-agent mediation (AC4).

Prerequisite state: DIR-124-B (M236, `docs/plans/M236-dir-124-b.md`) is planned but NOT landed — `run-identity.ts`, `stage-receipt.ts`, `workflow-journal.ts`, `workflow-resume.ts` do not exist on disk (verified `ls`). DIR-124-A2's golden-replay corpus (`fixtures/workflow-replay/`) is NOT on disk either; A1a (`workflow-event-schema.mjs`, M248) and A3a (`workflow-invariant-ownership.mjs`, M250) have landed. DIR-124-C's Plan therefore carries an explicit dependency gate: receipt-consuming stages land after DIR-124-B, and the replay proof constructs/consumes fixtures consistent with the landed A1 event schema.

### Chosen mechanism

Extract a **deterministic control-plane kernel** (`experiments/quay-perpetual-stream/scripts/workflow-kernel.ts`, byte-identical mirror at `plugin/scripts/workflow-kernel.ts`) plus a **Stage Adapter ABI** (`stage-adapter.ts`, mirrored), and convert both workflow copies of `execute-milestone.js` into thin compatibility entry shims. The kernel is a **pure transition function plus a thin CLI driver**, following the exact `golden-replay-dir044.ts` / `composite-preflight.ts` shape: pure exported functions unit-tested directly, a `main()` behind direct-entry detection for the CLI the shim shells out to, and `--selftest`. No new journal format, no new receipt format, no new worktree implementation — those are DIR-124-B and DIR-123's single sources, consumed by reference.

**Kernel surface (pure):**

- `transition(state: KernelState, receipt: StageReceiptEnvelope): TransitionResult` — the transition table. `KernelState` carries the current stage, RunIdentity, validated prior receipts, the declared effect set, worktree/cwd. `TransitionResult` is a next `StageSpec` or a terminal (`done`, `needs-human`, `revision-needed`, `halted`, `retry`) with a typed reason.
- `validateEffects(declared: EffectDecl, observed: ObservedWrites, authority: EffectAuthority): EffectViolation[]` — the mechanical effect check: observed writes must be a subset of the stage's declared writeSet, and the stage's declared writeSet must be a subset of the stage's authority.
- `validateReceiptBound(receipt, runIdentity, inputs): BoundCheck` — a DIR-124-B receipt is valid only if its base/candidate commits, workflow source hash, runtime generation, and material input hashes bind to the current run.

**Transition table (Requested action 1).** Stages: `Prepared`, `Verified`, `Built`, `BuildEvidence`, `Audited`, `Gated`, `ReadyToLand`, `Reconciled`/`Landed`, plus the non-success transitions `revision-needed`, `needs-human`, `halted`, `retry`, and `recovery`. The table is data, not imperative control flow; each row maps a validated receipt + state to the next stage, and an adapter result can never select its own successor. Singleton and composite share the table:

- `entry → Prepared` (after minimal arg normalization)
- `Prepared → Verified` (receipt valid); `Prepared → revision-needed` (receipt missing/stale/hash-invalid — zero Verify agents)
- `Verified → Built` (deterministic pass then semantic pass); `Verified → needs-human` (deterministic fail); `Verified → revision-needed` (semantic finding)
- `Built → Audited` (build done + evidence manifest valid); `Built → needs-human` (build fail / evidence-gate block)
- `Audited → Gated` (PASS/CONCERNS); `Audited → needs-human` (REFUTED)
- `Gated → ReadyToLand` (all gates pass); `Gated → needs-human` (gate fail)
- `ReadyToLand → Reconciled` (composite: reconcile proposes transaction); `ReadyToLand → Landed` (singleton direct)
- `Reconciled → Landed`; `Landed → done`
- `any → needs-human` (terminal failure); `any → revision-needed` (non-success stage); `any → halted` (external `.halt` sentinel); `any → retry` (explicit DIR-124-B resume from validated prior receipts, attempt++); `any → recovery` (invalid/torn stage state; `milestone-worktree.ts --clean-stale` for stranded worktrees)

**ACCEPTED-RISK (halt semantics):** The `any → halted` transition adds a NEW mid-execution halt semantic — today the repo-root `.halt` is read ONLY at SELECT preflight (`select-preflight.ts checkHalt`), never mid-run in `execute-milestone.js`. This is a deliberate design extension: the kernel halts at the next stage boundary, preserving recoverable receipts for DIR-124-B resume. It carries NO dedicated AC (AC1-AC13 do not test halt behavior) and NO DoD item — recorded here as an explicit accepted-risk decision per DIR-125. The kernel halting on `.halt` at a stage boundary is additive (the workflow's current behavior is unchanged — `.halt` only pauses SELECT, and the kernel's mid-run halt is a new opt-in surface for future drivers); verification is deferred to the real-object Land proof in DoD.

`recovery` is entered on resume when the earliest invalid stage is computed from the DIR-124-B journal and only validated prior receipts are reused.

**Stage Adapter ABI (Requested action 2).**

```ts
interface StageInput {
  runIdentity: RunIdentity
  stage: StageName
  cwd: string
  worktreePath: string | null
  policyRef: string          // opaque pointer to DIR-124-D's future policy registry — never inlined policy
  priorReceipts: StageReceiptEnvelope[]
  grantedResources: ResourceClaim[]
  readSet: string[]; writeSet: string[]; semanticResources: string[]
}
interface StageAdapter { run(input: StageInput): StageReceiptEnvelope }
```

One ABI; each stage is implemented as `stage-adapter-<stage>.ts` (Prepare, Verify, Build, Audit, Gate, Reconcile, Land). An adapter receives explicit paths/identities/commits/policy/resource grants (never ambient prompt assumptions — Requested action 4), runs in the supplied worktree or read-only snapshot, emits an immutable `StageReceiptEnvelope` (DIR-124-B's contract, hash-bound), cannot update primary-checkout lifecycle/governance state, and cannot choose the next transition.

**Shims.** `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js` become compatibility entry shims: normalize `$a` (JSON-string or object, DIR-114), build a minimal RunIdentity, invoke the kernel CLI (`node --experimental-strip-types <abs>/workflow-kernel.ts --run '<args-json>'`), and return the kernel's result verbatim. The shim retains only (a) the kernel-invocation plumbing, (b) the DSL-only content-agent dispatch for irreducible judgment (Build implementation, adversarial Audit, domain-misfit), and (c) the stable `{outcome: done|needs-human|revision-needed|building, reason, phase, verifyCacheUpdates}` return shape callers already consume. All canonical argument/state/effect implementation lives in the kernel/adapters, reachable through it (Requested action 6).

### Concrete control/data flow

Front of Execute (the AC3 reorder):

1. **Shim normalize** — `$a` JSON-normalize only; delegate arg identity to the kernel, which calls `composite-args.ts` `normalizeExecuteArgs` (the canonical single-source; the `_normalizeExecuteArgsInline` mirror is eliminated).
2. **Kernel RunIdentity construction** — runId derived from `$CLAUDE_CODE_SESSION_ID` plus a per-dispatch nonce (DIR-093/DIR-124-B precedent), bound to base/candidate commit, workflow source hash, runtime generation, task/charter/Plan material input hashes (from DIR-124-B).
3. **Prepared adapter (first)** — validates the `milestones/M<NN>/preparation.json` receipt written by `prepare-milestone.js`: presence, schema/version marker, and the `hashes.{proposal,charter,plan,sources,ledger,mechanismInventory}` integrity. Stale/missing/hash-invalid → `{outcome:'revision-needed', reason:'preparation-receipt-missing'|'preparation-receipt-stale'}` with **zero Verify agent dispatch**. This is the reorder: the receipt gate moves ahead of Verify.
4. **Deterministic Verify adapter** — runs the mechanical checks (`composite-preflight.ts`, `build-evidence-gate.ts`, the it0 script checks incl. ceiling/gate-hash/line-budget/dogfood, worktree-service checks) at direct kernel/adapter callsites with structured output — no generic content-agent dispatch (Requested action 10). Results recorded as `deterministic` class.
5. **Semantic Verify adapter** — content-agent verification for semantic/domain checks, recorded as a separately-visible `semantic` class. The two classes are recorded separately in the journal/receipts (the DIR-124-A5 mechanical/content split basis).
6. **Build adapter** — wraps `composite-build.ts` `planPhaseExecution`/`mapEvidenceToTasks` for phase-DAG planning, runs in the candidate worktree via `milestone-worktree.ts` (opt-in `isolationMode:'worktree'`), singleton path preserved, and returns the canonical `BuildEvidenceManifest` produced by `build-evidence-collector.ts`, hash-bound (`sha256File`/`manifestRefForReceipt()`) into the DIR-124-B Build receipt as a reference index (Requested action 12). The Build receipt references the manifest path+hash; it never copies authoritative task/Proposal content.
7. **Build-Evidence / Audit adapters** — Audit wraps `composite-audit.ts` `runReadOnlyAuditShard`/`combineShardVerdicts` over deep-frozen snapshots, reads the `BuildEvidenceManifest` only as an evidence index, and independently verifies the referenced raw artifacts (audit independence). The audit receipt is immutable.
8. **Gate adapter** — the mechanical gate array (it0 gates incl. `it0-dod-check.ts`, the build-evidence gate) at direct callsites; read-only; immutable check receipts.
9. **Reconcile adapter** — wraps `composite-reconcile.ts` `reconcile()`; deterministic for identical validated receipts; the sole success-path **proposer** of authoritative mutations; returns a mutation transaction, never applying it.
10. **Land adapter** — wraps `composite-land.ts` `buildLandTransaction` (atomic, idempotent accounting) plus `milestone-worktree.ts` `--land-lock-acquire/--land-lock-release`/`--merge`/`--remove`/`--clean-stale`; the sole fenced applier to integration/task/ABSORB/dashboard/backlog/counter state. Duplicate-Land is rejected by journal receipt presence + the land lock.

Each stage appends its `StageReceiptEnvelope` to the DIR-124-B journal (`milestones/M<NN>/stage-journal.jsonl`, receipts under `milestones/M<NN>/receipts/`); the kernel validates the next transition against the validated receipts before any dispatch. Every stage boundary calls the kernel's `--advance`/`--accept` mode: the kernel validates the incoming receipt (schema + hash), checks the adapter's declared writeSet against its authority, and returns the only legal successor. Adapters return receipts; the kernel returns transitions.

### Key design decisions

1. **Kernel owns transitions; adapters never select successors.** The transition table is the single authority on what comes next. An adapter result containing a "next stage" field is schema-rejected. This is the load-bearing anti-drift boundary: "adapter may not select its successor transition" becomes a mechanical rejection, not a prose instruction. Because the DSL is the only agent-dispatch transport for content judgment, the shim stays as transport; every *decision* moves to the kernel.
2. **Effect enforcement is mechanical, three layers.** (a) Declared `readSet`/`writeSet`/`semanticResources`/`resourceClaims` are checked against the stage's authority in `validateEffects`; (b) write-capable stages (Build, Land) record a staged-writes ledger (git status/diff + artifact hash snapshot) that must be a subset of declared writes; (c) read-only stages (Audit, Gate) keep the deep-frozen snapshot boundary and a before/after git-status diff that hard-fails on any non-empty delta. The pure `validateEffects` is testable with no git; the shim invokes the kernel's `--enforce-effects` mode around each adapter dispatch.
3. **One production implementation; adapters are thin wrappers.** `composite-*.ts`, `milestone-worktree.ts`, `build-evidence-*.ts` are invoked through adapters, never duplicated or merely named in prompts. The shim's only inline logic is irreducible stage-judgment prose and prompt interpolation. This directly closes DIR-124-A's shadow-architecture defect (P2).
4. **Prepared-before-Verify reorder.** After minimal arg/charter normalization, the front of Execute is: Prepared receipt/hash validation → deterministic Verify → semantic Verify. Proven against the A2 M195 `compatibility-only` replay fixture: the eventual `revision-needed` rejection is unchanged; only the cost timing moves (zero Verify agents spent on stale/missing receipts).
5. **Deterministic vs semantic separation.** Mechanical checks get direct kernel/adapter callsites with structured output and are recorded separately from semantic content-agent judgment. No generic content-agent dispatch for deterministic checks (Requested action 10).
6. **Positive-success transitions only.** Null, undefined, unknown, schema-invalid, or missing-required-field results cannot select a successor — they fail closed to bounded `retry` or `needs-human`. This mechanically forecloses the M192 null-Build-continuation defect class that previously required human audit to catch (AC5).
7. **BuildEvidenceManifest is owned by the Build adapter and bound by hash.** `build-evidence-manifest.ts` `validateManifestShape` + `sha256File`/`manifestRefForReceipt()` are invoked at the Build adapter boundary; the manifest hash is bound into the DIR-124-B Build receipt; Audit consumes it only as an evidence index and independently checks raw artifacts.
8. **DIR-124-D policy isolation.** The kernel receives resolved policy as explicit `StageInput.policyRef` inputs. It never embeds task routing, gate lists, test profiles, or resource budgets as kernel branches — those remain visibly isolated for DIR-124-D (per the task's final AC), and the kernel does not reimplement them.
9. **Compatibility shims preserve the caller contract.** The `{outcome: done|needs-human|revision-needed|building, reason, phase, ...}` vocabulary and the `verifyCacheUpdates` surface are preserved at the shim boundary so OUTER-LOOP.md and the DIR-119 concurrent fan-in observe no change. `verifyCacheUpdates` persistence moves into the DIR-124-B store — which keys the cache on exact check input + base/candidate state + workflow-source hash + runtime generation and is consulted before the kernel adapter re-executes — closing the open cache loop, but the shim still returns the same fields.
10. **`prepare-milestone.js` touch is minimal and receipt-boundary-only.** The task's Touches list includes `.claude/workflows/prepare-milestone.js` and its mirror. The only justified edits are (a) the Receipt phase emitting a stable `receiptType`/`schemaVersion` marker + the hash surface the kernel's Prepared adapter validates (in the DIR-124-B envelope), and (b) any field needed for the kernel to distinguish a DIR-117-B preparation receipt from other JSON. prepare-milestone's own phases (ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor/PlanCheck) are NOT kernelized in this milestone (explicit non-goal; DIR-124-B's Stage 6 already owns the Prepare-telemetry one-way migration).

### Defaults and failure behavior

- **Isolation default**: `isolationMode` omitted/unknown → legacy direct-on-shared-tree (byte-for-behavior, golden-replay preserved, same posture as DIR-123). `'worktree'` + numeric milestone → real `milestone-worktree.ts` isolation. Requested-but-underspecified (`'worktree'` with no numeric milestone) → fail closed.
- **Receipt validation default**: fail-closed, front-loaded. Missing/stale/hash-invalid preparation receipt → `revision-needed` before any Verify agent. Stage receipts failing `validateReceiptBound` (wrong base/candidate/workflow hash/runtime generation, tampered receipt, missing artifact, moved candidate commit) → `recovery`/`retry`, never silent reuse.
- **Effect enforcement default**: fail-closed. Adapter write beyond declared writeSet → `needs-human` with a typed violation code. Read-only stage with any non-empty git-status delta → hard fail regardless of agent self-report. Wrong worktree/cwd (identity/worktreePath mismatch vs. granted resource) → fail closed before the adapter runs (AC10).
- **Success-transition default**: only schema-valid accepted success selects a successor; all failure shapes (`null`, `undefined`, `unknown`, schema-invalid, missing required fields, nominal `done` missing required fields) fail closed before downstream dispatch.
- **Duplicate Land**: idempotent by construction — a Land transaction for an already-landed identity (Land receipt present in journal) is rejected; `composite-land.ts` `buildLandTransaction` already returns `ok:false` on atomic-accounting mismatch; the `milestone-worktree.ts` land lock serializes shared-checkout application.
- **Partial/torn stage** (start event but no valid receipt) → `recovery`, never silent continuation; `milestone-worktree.ts --clean-stale` for stranded worktrees.
- **Halt**: repo-root `.halt` sentinel → kernel halts at the next stage boundary, preserving recoverable completed receipts (crystallization §7.11).
- **Recovery/resume**: via DIR-124-B explicit resume — earliest invalid stage from the journal, only validated prior receipts reused, attempt incremented, reason recorded.
- **Replay**: legacy singleton and real composite golden replay preserve intentional behavior and outcomes (the A2 corpus + `fixtures/worktree/golden-legacy-prompts.json`).

### Compatibility

- Legacy `{taskId, charterFile, absorbEntryFile}` and DIR-119-B `{milestoneCandidate:{taskIds,...}, compositeManifestFile}` both route through the kernel's call to `composite-args.ts` `normalizeExecuteArgs` — never rejected on `taskIds.length`; the inline `_normalizeExecuteArgsInline` mirror is deleted.
- Shim return vocabulary preserved (`done`/`needs-human`/`revision-needed`/`building`), including the composite `buildBranch`/`touchedFiles` surfaces the concurrent fan-in and `OUTER-LOOP.md` step-g read.
- Callers unchanged: OUTER-LOOP dispatch, run-routines, diagnose-verify-failure, and the M239 prepare-milestone pipeline all see the same `{outcome, reason, phase, verifyCacheUpdates}` shape from the shim.
- Mirror parity preserved: both workflow mirrors byte-identical, both kernel/adapter mirrors byte-identical, `sync-vendor.sh` extended to the new families; the existing mirror-parity test pattern enforces it at Land; the `scripts/test.sh` glob picks up the new `*.test.mjs` files.
- `prepare-milestone.js` receipt format preserved and versioned, not re-authored; the kernel's Prepared adapter consumes the existing `hashes` surface.
- DIR-124-B's receipts/journal remain the sole cross-stage contract; this milestone adds no parallel format.
- **Re-baseline note (owned delta, flagged to DIR-124-A)**: the A2 corpus is not on disk; this milestone constructs its RED/GREEN fixtures consistent with the landed `workflow-event-schema.mjs` v1 schema + `golden-legacy-prompts.json`, and the A2 corpus's two known-defect fixtures (M192 null-Build continuation, M195 stale-Prepared-after-Verify) are *deliberately corrected* — M192 becomes a fail-closed negative control, M195 becomes a reject-before-any-Verify assertion — and the composite replay's reconcile-writer assertion is re-baselined to "Reconcile proposes, fenced Land applies." Outcome equivalence is preserved; the corpus classification for these three assertions changes from known-defect to new-normative. The delta note is explicit so the A-owner's corpus can be reconciled at parent close-out.

### Risks

1. **DIR-124-B not landed** — the kernel's `StageReceiptEnvelope`/journal/cache-resume depends on M236. If B slips, C must not re-implement receipts (single-source violation). Mitigation: the Plan gates receipt-consuming stages on B landing; the kernel consumes B's contracts by reference only.
2. **DIR-124-A2 golden-replay corpus not landed** — AC9/AC11 reference "DIR-124-A golden replay", but `fixtures/workflow-replay/` is absent on disk. Mitigation: the Plan either depends on A2 landing or constructs the M195 compatibility fixture from the landed `workflow-event-schema.mjs` v1 schema + `golden-legacy-prompts.json`, ships its own RED/GREEN fixtures asserting the three new behaviors, and the milestone's own replay proof is a real-object Land proof, not a self-certified fixture.
3. **Behavior-preserving cutover risk** — a kernel bug changes every future milestone's execution. Mitigation: golden replay + the shim boundary being a pure "kernel result passthrough" that is itself testable; DIR-124-A's invariant-ownership manifest (`workflow-invariant-ownership.mjs`, M250) names the kernel/adapters as owners so drift is enforced.
4. **Real composite execution is not yet proven on master** — DIR-119-C/D operational proof is pending; adapter-wrapping composite modules may surface latent call-graph defects. Mitigation: Land proof uses a real composite dispatch; any defect surfaces as `needs-human`, never silent fallback.
5. **Effect-detection blind spots / false positives** — git-status-diff write detection can miss ignored/untracked/submodule writes, while `/tmp` scratch and `.workflow-events` telemetry could false-positive. Mitigation: three-layer enforcement (declared-set check + staged-writes ledger + read-only snapshot), declared scratch/telemetry paths excluded from `writeSet` (`composite-audit.ts` guard already handles this shape), and negative controls that attempt an undetected write class.
6. **Content-agent dispatch staying in the shim looks like "not through the kernel."** Mitigation: the adapter declares the semantic prompt scope + outputSchema; the shim's dispatch is a thin transport; AC4/AC7 call-graph evidence proves the judgment is bounded by the adapter contract, not free-form.
7. **Verify-cache semantics change** as deterministic checks move into the kernel. Mitigation: DIR-124-B cache store keys on exact check input + base/candidate state + workflow-source hash + runtime generation; cache lookup runs before the kernel adapter re-executes.
8. **prepare-milestone.js scope creep** — converting prepare's phases to a kernel consumer would balloon the milestone. Mitigation: explicit non-goal; only the receipt-boundary edits are in scope.
9. **DSL no-import constraint** — if the kernel logic is not reachable via CLI from the shim, it becomes shadow architecture again. Mitigation: every kernel entry has a real CLI invocation path from both shims, verified by the wiring-audit AC.
10. **Kernel drift from shim** (second state machine). Mitigation: shim contains no transition logic (AC12); golden replay + DoD4 independent wiring audit trace the full call graph shim→kernel→adapters→DIR-119→worktree→Reconcile→Land.
11. **A2-corpus re-baselining is owned by DIR-124-A, not C** — coordination risk. Mitigation: this milestone ships its own RED/GREEN fixtures asserting the three new behaviors; the delta note is explicit so the A-owner's corpus can be reconciled at parent close-out.

### Non-goals

- No DIR-124-D policy registry: task routing, gate lists, test profiles, resource budgets stay out of the kernel (only `policyRef` pass-through).
- No DIR-124-E resource-aware cross-stage pipelining: the kernel drives stages serially in this milestone; parallel dispatch remains `composite-build.ts`'s existing contract capability, not a new scheduler.
- No DIR-118 post-Land Wiring Audit or `done`-promotion policy.
- No DIR-124-F GroundTruthRegistry runtime-contract work.
- No new journal/receipt format — DIR-124-B's is the sole authoritative contract.
- No kernelization of `prepare-milestone.js`'s own phases (proposal authors/adjudicate/review/plan); only its Receipt boundary emits the DIR-124-B preparation envelope.
- No removal of the DSL-only content-agent dispatch for irreducible judgment; only the *control* around it becomes executable.
- No second composite implementation — DIR-119-D modules are the implementation; adapters invoke them.
- No deletion of `OUTER-LOOP.md` or task-prose policy copies beyond what the kernel mechanically supersedes (that is DIR-124-D's scope).

### AC coverage

The Proposal satisfies the task's Acceptance Criteria as follows:

- **AC1 (one production kernel owns every transition, real call path from both mirrors):** `workflow-kernel.ts` owns the transition table; both shims invoke it via CLI. Coverage: AC1.
- **AC2 (every stage through the same typed adapter ABI emitting a DIR-124-B receipt):** all stages run `run(StageInput) -> StageReceiptEnvelope` through the shared `stage-adapter.ts` ABI; receipts written to the B journal. Coverage: AC2.
- **AC3 (stale/missing/hash-invalid preparation receipt returns before deterministic/semantic Verify; valid replays retain verdicts after Prepared moves):** Prepared adapter first; deterministic Verify second; semantic Verify third; the M195 fixture proves the reorder (zero Verify on stale receipt; valid verdicts unchanged). Coverage: AC3 + DoD golden replay.
- **AC4 (deterministic checks have direct kernel/adapter callsites, no generic content-agent dispatch; semantic checks separate):** decision 5 + deterministic/semantic class separation in receipts. Coverage: AC4.
- **AC5 (every content-agent transition requires schema-valid accepted success; null/undefined/unknown/nominal-done-missing-fields fail closed):** decision 6 + positive-success-transition enforcement (M192 becomes a fail-closed negative control). Coverage: AC5.
- **AC6 (Build emits validated hash-bound BuildEvidenceManifest; Audit consumes it only as evidence index + independently checks raw):** decision 7. Coverage: AC6.
- **AC7 (production call-graph evidence shows DIR-119-D composite modules and DIR-123 worktree service invoked through adapters, not duplicated):** decision 3; DoD wiring-audit AC. Coverage: AC7.
- **AC8 (Audit/Gate mutation attempts and Build writes outside the candidate worktree fail mechanically):** three-layer effect enforcement. Coverage: AC8 + DoD negative controls.
- **AC9 (Reconcile deterministic for identical validated receipts; Land idempotent + fenced against duplicate shared-state application):** Reconcile/Land adapters + journal-receipt presence + land lock; the writer moves from `reconcile-apply` to fenced Land (mutation SET identical, outcome-preserving). **The mutation-SET authoring authority moves from `reconcile-apply` (execute-milestone.js L935-953, today the physical writer of AC/DoD ticks, status:done, dashboard rows, absorb dispositions) to fenced Land's `composite-land.ts` — the FALSIFIABLE evidence is a callsite diff showing `reconcile-apply` no longer writes shared state (grep for `task_write`/`status:done`/`dashboard` writes inside the Reconcile adapter returns zero) and a real-object Land proof where Reconcile's proposed mutation SET and Land's applied state match byte-for-byte.** Coverage: AC9.
- **AC10 (invalid transition, wrong worktree/cwd, duplicate Land, partial-stage fixtures fail closed):** `transition()` illegal-edge rejection + cwd/worktree binding + duplicate-Land detection + torn-stage recovery. Coverage: AC10.
- **AC11 (legacy singleton and real composite golden replay preserve intentional behavior):** decision 9 + real-object Land proof. Coverage: AC11 + DoD.
- **AC12 (shim contains no canonical implementation duplicated from kernel; prose limited to irreducible judgment):** decision 3 + `_normalizeExecuteArgsInline` deletion. Coverage: AC12.
- **AC13 (routing/gate/test/resource budgets visibly isolated for DIR-124-D):** decision 8 + `policyRef` pointer only. Coverage: AC13.

### Mechanism-claim → AC coverage (DIR-117 wiring)

Every wiring claim below is flagged for the ProposalReview phase to confirm a matching AC bullet (identifiers in backticks + an evidence keyword must co-occur in that bullet).

- `workflow-kernel.ts` invoked by BOTH `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js` shims at every stage boundary via the fixed CLI transport → AC1 + AC12.
- `workflow-kernel.ts` owns the transition table and rejects invalid transitions → AC1 + AC10.
- `workflow-kernel.ts` owns the `StageSpec` registry (readSet/writeSet/semanticResources/resourceClaims/outputSchema) → AC2 + AC8 + AC13.
- Each `stage-adapter-<stage>.ts` implements `run(StageInput): StageReceipt` and never returns a successor → AC2 + AC10.
- Kernel validates every content-stage result against the stage `outputSchema`; null/undefined/unknown/schema-invalid/missing-required-field fail closed before the next dispatch → AC5.
- Prepared adapter validates the DIR-124-B preparation receipt + hash BEFORE any Verify dispatch; stale/missing/hash-invalid returns with zero Verify agents → AC3.
- Deterministic Verify checks (it0 ceiling/gate-hash/line-budget/dogfood/composite-preflight/build-evidence-gate) run inside the kernel adapter with structured output, no judgment agent → AC4.
- Semantic Verify (domain-misfit) remains a visibly separate content-agent dispatch, recorded as a separate class → AC4.
- Build adapter invokes `composite-build.ts` (`planPhaseExecution`, `mapEvidenceToTasks`) and writes only to the candidate worktree; singleton path preserved → AC7 + AC8.
- Build adapter invokes `build-evidence-collector.ts` / `build-evidence-manifest.ts` (`validateManifestShape`, `sha256File`/`manifestRefForReceipt()`) and binds the manifest hash into the DIR-124-B Build receipt → AC6.
- Audit adapter invokes `composite-audit.ts` (`runReadOnlyAuditShard`, `combineShardVerdicts`, snapshot guard) and reads the build-evidence manifest only as an evidence index, independently checking raw artifacts → AC6 + AC7 + AC8.
- Gate adapter runs the mechanical gate array (incl. `build-evidence-gate.ts`) as read-only checks emitting only immutable receipts → AC7 + AC8.
- Reconcile adapter invokes `composite-reconcile.ts reconcile()` to produce a deterministic mutation transaction and does NOT apply shared-state mutations itself → AC9.
- Land adapter invokes `composite-land.ts` `buildLandTransaction` + `milestone-worktree.ts` (`land-lock-acquire/release`, merge, remove, `clean-stale`) and is the SOLE fenced applier to integration/task/ABSORB/dashboard/backlog/counter state → AC9 + AC7 + AC8.
- Kernel rejects duplicate Land for the same run (idempotency + fence) → AC9 + AC10.
- Kernel validates DIR-124-B `StageReceiptEnvelope` via `stage-receipt.ts` / journal via `workflow-journal.ts` → AC2 + AC3 + AC10.
- Kernel Prepared adapter validates `preparation.json` (written by `prepare-milestone.js`) → AC3.
- Both workflow mirrors shim-invoke `workflow-kernel.ts` CLI → AC1.
- Kernel `validateEffects` enforces declared writeSet/authority over adapter writes → AC8 + AC10 (negative controls).
- Kernel rejects a stage/adapter that attempts an illegal transition → AC10 (invalid-transition fixtures).
- Policy values (routing, gate lists, test profiles, resource budgets) are NOT reimplemented in the kernel/adapters; `policyRef` is a pointer for DIR-124-D → AC13.
- Legacy singleton and DIR-119 composite golden replays run against the kernel-installed path; M192/M195 and reconcile-writer assertions re-baselined to corrected normative behavior → AC11.

### Alternatives considered and rejected

- **File splitting without authority reduction (crystallization §9).** Moving prompt blocks into per-stage files preserves the same hidden effects and duplicated knowledge; rejected because the missing boundary is an executable kernel that owns transitions and rejects out-of-authority effects — not more files.
- **Pure prompt refactor (multiple files, no executable kernel).** Rejected by the task's own Finding: preserves the implicit geometry; no transition table, no mechanical effect enforcement, adapters cannot be checked.
- **Adding another prose specification layer.** A second document describing the stages would reproduce the additive-prose paradox (more descriptions to reconcile without a harder executable boundary); rejected.
- **Replacing the workflow files entirely with a Node driver (no shim).** Rejected: the DSL is the ONLY agent-dispatch transport for content judgment (Build implementation, adversarial Audit). A pure Node driver cannot dispatch Claude content agents; the shim must remain as the transport. This constraint is non-negotiable and shapes the whole design.
- **Adapter per micro-step (one adapter per gate/check).** Rejected: over-fragmentation; the transition table is per-stage; per-check granularity belongs inside the Gate stage's internal array, not the kernel stage graph.
- **OS-level sandbox (containers/seccomp) for effect enforcement.** Rejected: over-engineered for the threat model; git-snapshot + writeSet validation + worktree confinement is sufficient and partially exists (`composite-audit.ts` guard).
- **Locking the whole workflow as a serial critical section.** Suppresses concurrency and hides undeclared effects; rejected in favor of worktrees + immutable receipts + a short fenced Land as the primary safety model.
- **Keeping both the typed composite modules and the prompt-only descriptions indefinitely.** The two sources of truth drift (DIR-124-A's shadow architecture §3.5); rejected — this milestone makes the typed modules the execution mechanism through adapters and deletes the inline mirrors.
- **Kernelizing `prepare-milestone.js` in the same milestone.** The Prepare path's phases are judgment-heavy and DIR-124-B's Stage 6 already owns the Prepare-telemetry migration; pulling them into the kernel would balloon the milestone and mix policy with mechanics; rejected — only the receipt boundary is touched.
- **Implementing a second receipt/journal format in the kernel.** Would violate single-source-of-truth (DIR-028/ADR-004) and duplicate DIR-124-B; rejected — the kernel consumes B's contracts by reference only.
- **Reusing in-band `verifyCacheUpdates`/`cacheFingerprints` instead of the DIR-124-B store.** Rejected: DIR-124-B owns cache persistence; the kernel consumes it.
- **Keeping `reconcile-apply` as the writer (no authority change).** Rejected: Requested action 5 and crystallization §5.4 explicitly require Reconcile-to-propose / fenced-Land-to-apply; preserving the old writer would fail the write-authority ACs.
- **Splitting the front-of-Execute reorder into a separate milestone.** Rejected: the reorder is only safe under an executable transition kernel that can prove zero-Verify-on-stale-receipt; doing it in the monolith would recreate the M195-class regression.
- **Embedding DIR-124-D policy in the kernel.** Would silently reimplement routing/gate/test/resource policy inside execution mechanics, exactly what the task's final AC forbids; rejected — the kernel receives resolved policy as `policyRef` inputs.

## Touches
- tasks/DIR-124-C.md（自身文件）
