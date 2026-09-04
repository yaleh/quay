---
id: DIR-124-A
title: Establish milestone-workflow observability, invariant ownership, and
  golden replay before control-plane refactoring
status: done
labels:
  - directive
  - human-steered
parent: DIR-124
children:
  - DIR-124-A1
  - DIR-124-A2
  - DIR-124-A3
  - DIR-124-A4
  - DIR-124-A5
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124 一并关闭）**

原标题：Establish milestone-workflow observability, invariant ownership, and golden replay before
control-plane refactoring。Proposal 明确是「the C0 layer from
`docs/proposals/quay-milestone-workflow-git-crystallization.md`」，目标是为 DIR-124-B/C/D/E 的
control-plane 重构打前站——**目标本身（`.claude/workflows/execute-milestone.js` 的重构）已被
ADR-022（2026-08-03 accepted）物理删除**，前站工作失去意义。

实测：`grep -c "execute-milestone\.js\|prepare-milestone\.js\|composite-"` 本任务体命中 34 处。

意见：见父任务 `DIR-124` 关闭说明。若需要恢复此类可观测性/golden-replay 基线能力，应针对当前
fast-mode 架构重新提案。

全文见 git 历史（`git log -p -- tasks/DIR-124-A.md`）。

## Proposal

Create a behavior-preserving measurement and replay boundary across the installed milestone-workflow pair before DIR-124-B/C/D/E touch the control plane. This is the C0 layer from `docs/proposals/quay-milestone-workflow-git-crystallization.md`: emit structured stage events from both workflow files, build a classified golden-replay corpus, inventory every load-bearing invariant with a single authoritative owner, add a metadata-vs-executable-driver conformance check, and emit mechanical baseline metrics -- all without introducing stage scheduling, new lifecycle policy, or a second journal format.

**Temporal anchor (2026-08-01):** DIR-123 is already done (commit `059b5b16`) and its worktree isolation is live in the installed workflow (`isolationMode: 'worktree'` opt-in, real `milestone-worktree.ts` CLI, per-milestone worktrees under `milestones/M<NN>/worktrees/iteration-0`). The before-state boundary is anchored before the later DIR-124 children (B/C/D/E) touch the workflow's control plane -- not before DIR-123.

**Split provenance (2026-08-01, DIR-026 SPLIT-OR-COMMIT):** a real `prepare-milestone.js` `ProposalReview` returned `needs-human`/`split-recommended`, code `split-multi-mechanism` ("candidate contains 5 independently landable mechanisms (> 2)"), `repairable: false`. Parent completion is exactly the completion of the children, in order:

1. [[DIR-124-A1]] -- stage-event schema + emission instrumentation at the 8 boundaries. No dependencies.
2. [[DIR-124-A2]] -- golden replay corpus: 8 named cases + the two known-defect shapes. Depends on A1's schema/stream.
3. [[DIR-124-A3]] -- invariant-ownership manifest with single-authoritative-owner enforcement and a duplicate/deletion list. No dependencies.
4. [[DIR-124-A4]] -- workflow-metadata vs executable-driver conformance check. No dependencies.
5. [[DIR-124-A5]] -- baseline metrics emission (mechanical/content split, explicit unknowns). Depends on A1's event stream.

**Ordering rationale:**

1. **A1 (stage-event schema + emission)** lands first -- it defines the canonical event shape that A2 and A5 consume. No other child depends on A1's output, so A3 and A4 can proceed in any order relative to A1's execution.
2. **A2 (golden replay corpus)** and **A5 (baseline metrics)** both consume a stable event stream and therefore depend on A1 landing first.
3. **A3 (invariant-ownership manifest)** and **A4 (metadata-conformance check)** have no dependencies and can proceed in any order relative to A1.
4. Parent is `done` iff all five children are `done` -- enforced by `it0-split-or-commit-check.ts .` (PARENT-DONE-IFF-CHILDREN).

This parent is not independently SELECTable -- each child carries its own full Proposal/Plan/AC/DoD and is dispatched (prepared + executed) on its own.

### Problem framing

#### Current state (grounded in the real repository, 2026-08-01)

- `.claude/workflows/execute-milestone.js` is ~1204 lines (mirrored byte-identically at `plugin/workflows/execute-milestone.js`, confirmed by `diff` on current `master`), with 8 `phase()` call sites at lines 66 (Verify), 234 (Prepared), 389 (Build), 673 (Audit), 769 (Gate), 866 (Reconcile), and 908 (Land). The Reconcile `phase()` fires conditionally (only for composite dispatches with `compositeManifestFile`). The workflow owns argument normalization, task/class policy routing, Verify caching (`cacheFingerprints`/`priorVerifyCache`), Prepared receipt validation, Build class-routing (single-agent or `_compositePhaseDagBuild()` for composite width>1), Audit (single adversarial agent or `_compositePerShardAudit()` for composite), Gate (`parallel([])` mechanical checks with typed task/milestone return shapes), Reconcile (composite-only, sole success-path composite state writer via `composite-reconcile.ts`), and Land (serial/concurrent/worktree paths, post-mutation split-or-commit check).

- `.claude/workflows/prepare-milestone.js` is ~1547 lines (mirrored byte-identically at `plugin/workflows/prepare-milestone.js`), with 8 `phase()` call sites at lines 164 (Admission), 619 (Preflight), 651/657 (ProposalAuthors), 653/695 (Adjudicate), 737 (ProposalReview), 1293 (PlanAuthor), 1342/1373 (Preflight/PlanCheck), and 1428 (Receipt). Admission uses an atomic filesystem lease via `prepare-admission-check.ts --acquire` (writeFileSync 'wx'), renewed at 6 subsequent phase boundaries. The workflow owns proposal generation (N=2/3 independent agents), adjudication, bounded convergence review (DIR-125: 1 full review + up to 2/3 delta rounds, 45m/75m soft budget), plan authoring, plan checking (up to 3 rounds, F_i=0 required), receipt writing (`preparation.json` + `proposal-ledger.json` + `mechanism-inventory.json`), cross-generation delta continuation (M207), split-or-commit decision adjudication (M206), and epoch-scope management. Already carries a phase-timing mechanism (`_phaseTimings` array, `_recordPhaseBoundary()` accumulating closed spans from lease-renewal `nowMs` values, flushed to `proposal-convergence.ts --record-generation` at each terminal) -- but this is prepare-only, agent-mediated (clock values from lease CLI calls, not JS-emitted), and tied to the single-flight lease mechanism, not a general stage-event schema.

- `OUTER-LOOP.md` is ~378 lines describing the SELECT cycle (drain, select, hypothesize, charter, batch_assemble, execute, dispatch, checkpoint, routines) with 16 invariants (I1-I16), 9 startup contracts (C1-C9), halt conditions, and concurrent dispatch fan-in mechanics.

- The composite typed modules (`experiments/quay-perpetual-stream/scripts/composite-args.ts`, `composite-build.ts`, `composite-audit.ts`, `composite-reconcile.ts`, `composite-land.ts`, `composite-contracts.ts`, `composite-manifest-synthesis.ts`, `composite-preflight.ts`) total ~2490 lines of typed contracts. The workflow invokes `composite-preflight.ts` as a CLI check and `composite-reconcile.ts` as the deterministic mutation engine, but references the other modules mainly through agent prompt instructions rather than direct invocation -- this is the "shadow architecture" (crystallization doc section 3.5): a typed contract layer that exists beside the prompt monolith but is not the execution mechanism.

- `experiments/quay-perpetual-stream/scripts/milestone-worktree.ts` (~384 lines) is the single-source worktree isolation primitive with `--add`/`--merge`/`--remove`/`--land-lock-acquire`/`--land-lock-release`/`--clean-stale` CLI modes.

- `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` (~1183 lines) is the DoD meta-enforcer with 13 clauses, invoked as a mechanical gate check at Land. This is the natural wiring target for new mechanical enforcement checks (A3's owner enforcement, A4's conformance check).

- `docs/proposals/quay-milestone-workflow-git-crystallization.md` (568 lines, status: proposal) defines the C0-C6 crystallization sequence and 10 baseline metrics: change-propagation radius, context working set, shared-writer count, duplicate-rule count, prompt-to-code ratio, receipt reuse rate, replay variance, failure attribution precision, full-suite executions per candidate, Land-fence hold/queue time.

- `.quay/gate-events.jsonl` exists as an append-only immutable gate-event log consumed by `quay gate-log`. No workflow-level stage event log exists anywhere in the repository (confirmed by grep for `workflow-event-schema`, `recordStageEvent`, and `stage-event` -- zero results outside DIR-124 tasks/plans).

- **Existing telemetry/event precedent:** `proposal-convergence.ts` writes committed telemetry to `milestones/prepare-telemetry/` (git-committed JSON) and ephemeral lease state to `.quay/prepare-leases/<taskId>.generation.json` (gitignored). Gate events are appended to `.quay/gate-events.jsonl` (gitignored, per-workspace). The Land lock lives at `.quay/land-locks/shared-checkout.lock`. M207's `_phaseTimings` in `prepare-milestone.js` accumulates timing spans but only carries them to `proposal-convergence.ts`'s `--record-generation` terminal dispatch.

#### Five structural defects

**D1: No canonical stage-event schema.** The workflow DSL has `phase()` markers and `meta.phases[]` metadata, but emits no structured event record across either workflow. Agents self-report status and timing through unstructured structured-output fields; the workflow itself emits no structured stage log. M207's `_phaseTimings` in `prepare-milestone.js` accumulates timing spans but is prepare-only, agent-mediated (clock values from lease CLI calls, not JS-emitted wall-clock readings), and tied to a specific lease mechanism, not a general stage-event contract. No recorded queue/start/end timestamps, agent-call label, execution cwd/worktree, command/test identity, observed writes, base/candidate commit identity, or outcome exists for either workflow. Without a schema, every downstream consumer (replay, metrics, conformance) must invent its own format.

**D2: No before-state replay boundary.** Recent workflow repairs (M185-M189 regression sequence, M192 null-Build continuation, M195 stale Prepared) relied on prose histories and manually reconstructed Claude Code timelines. Without a replay corpus, DIR-124-B (stage scheduling + policy registry), DIR-124-C (pipeline reorder), DIR-124-D (kernel extraction), and DIR-124-E (resource-aware scheduling) cannot distinguish a deliberate behavior change from an accidental capability regression. A pre-existing replay precedent exists in `golden-replay-dir044.ts` (DIR-044's terminal proof), confirming the pattern is implementable -- but it covers only the concurrent scheduler's orthogonality check, not the full workflow lifecycle. Naive golden snapshots would freeze known defects as normative: M192's null-Build-result advancing to Audit/Land and the stale M195 Prepared control paying Verify cost before receipt rejection must be labeled as defects, not normalized into the compatibility contract.

**D3: No invariant-ownership inventory.** The live `execute-milestone.js` simultaneously owns argument compatibility, task policy routing, Verify caching, preparation gating, Build method dispatch, Audit write policy, Gate dispatch, Git/worktree semantics, lifecycle mutation, dashboard/backlog updates, and serial/concurrent Land variants -- at least 10 independent architectural dimensions in one file. `prepare-milestone.js` similarly owns admission, preflight, proposal generation, adjudication, review, plan authoring, plan checking, and receipt writing. Small changes have repeatedly deformed unrelated behavior (evidenced by the M185-M189 regression sequence). There is no inventory of which invariant each piece owns and which other occurrences are duplicates to remove.

**D4: Stale metadata/driver claims go undetected.** The crystallization document (`docs/proposals/quay-milestone-workflow-git-crystallization.md`) documents five confirmed instances of drift between declared and executed geometries (section 3.2, lines 131-147): (a) `execute-milestone.js`'s `meta.description` describes a possible `building` result and background dispatch, while Build now executes synchronously; (b) OUTER-LOOP describes an isolated Build worktree although the workflow reverted from it; (c) OUTER-LOOP describes seven in-workflow absorb gates, while several were removed or relocated; (d) `meta.phases[2]` detail string ("class-route + dispatch inner iteration agent") predates the composite phase-DAG dispatch fork; (e) `meta.phases[5]` (Gate) detail references "7 absorb gates" whereas the actual `parallel([])` array now carries fewer entries. No mechanical check compares workflow metadata to the executable driver contract. Prose drift is an active control-plane defect because agents execute these descriptions.

**D5: No mechanical baseline metrics.** The crystallization document defines 10 metrics (section 8, lines 483-497). These are today reconstructed from prose reports and Claude Code timelines, not measured mechanically. No classification exists separating mechanical-runner work (Verify script dispatches, Gate agent dispatches, Reconcile CLI invocations, Land merge/commit) from content-agent work (ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, Build implementation). Missing data is silently approximated rather than reported as explicit unknowns.

These five defects are structural, not cosmetic: a local edit in `execute-milestone.js` can deform policy, state, Git visibility, evidence provenance, and concurrency at once because no mechanical boundary tells you which effects changed.

### Chosen mechanism

A **five-child ordered split** (DIR-124-A1 through A5), each independently preparable and executable, with the parent completing iff all children are done. This split is the direct output of the `prepare-milestone.js` ProposalReview's `split-multi-mechanism` finding (5 independently landable mechanisms, `repairable: false`). Each child carries its own full Proposal/Plan/AC/DoD. The parent is NOT independently SELECTable.

#### M1: Stage-event schema + emission instrumentation (DIR-124-A1)

A new `experiments/quay-perpetual-stream/scripts/workflow-event-schema.ts` (mirrored at `plugin/scripts/workflow-event-schema.ts`) is the single canonical home of the stage-event schema v1 -- not embedded in an emission script. It exports a versioned schema and a `recordStageEvent({...})` helper called by the workflow JS itself at wrapped `phase()` / dispatch-helper boundaries -- NOT by agents via structured-output calls. This helper is observational-only: no return-value coupling to stage dispatch, no scheduling decision, no write-authority change.

**Schema shape (v1):** each event records: `schemaVersion` ("1"), `runId`, `candidateId`, `taskId`, `stage` (one of 8 boundary names), `attempt`, `timing: {queuedAtMs, startedAtMs, endedAtMs}`, `agentLabel`, `executionCwd`, `worktreePath` (populated under `isolationMode:'worktree'`; null otherwise), `commandIdentity`, `baseCommit`, `candidateCommit`, `outcome` (done | needs-human | skipped | error), `waitReason` (admission-contention | cache-hit | prepared-blocked | null), `resourceClaim` (lease-fencingToken under admission; null otherwise), `observedWrites`, `isolationMode` (worktree | null), and `dispatchMode` (serial | concurrent | null for prepare stages).

**8 instrumented boundaries:** events are emitted at:

1. E1 -- Prepare admission: in `prepare-milestone.js`, after `prepare-admission-check.ts --acquire` succeeds (after the `_admissionVerdict.outcome === 'acquired'` branch, before any ProposalAuthors agent dispatch)
2. E2 -- Verify phase entry: in `execute-milestone.js`, `phase('Verify')` at line 66
3. E3 -- Prepared phase entry: in `execute-milestone.js`, `phase('Prepared')` at line 234
4. E4 -- Build phase entry: in `execute-milestone.js`, `phase('Build')` at line 389
5. E5 -- Audit phase entry: in `execute-milestone.js`, `phase('Audit')` at line 673
6. E6 -- Gate phase entry: in `execute-milestone.js`, `phase('Gate')` at line 769
7. E7 -- Reconcile phase entry: in `execute-milestone.js`, `phase('Reconcile')` at line 866 (conditional on composite + manifest)
8. E8 -- Land phase entry: in `execute-milestone.js`, `phase('Land')` at line 908

Each boundary emits TWO events: a `start` event at phase entry (with `queuedAtMs` and `startedAtMs`) and an `end` event at phase exit (with `endedAtMs`, `outcome`, `observedWrites`, and `candidateCommit` where available). E1 (prepare admission) additionally records the fencing token as `resourceClaim`.

**Event log storage:** per-run event log at `experiments/quay-perpetual-stream/.workflow-events/<runId>.jsonl` (gitignored -- workflow events are local observability, not committed artifacts; the identical pattern as `.quay/gate-events.jsonl`). This is intentionally separate from the git-committed `milestones/prepare-telemetry/` tree -- workflow events are local observability artifacts, not committed provenance records.

**Schema versioning:** The schema module exports `SCHEMA_VERSION = 1`. DIR-124-B may extend it (add fields, later versions) without preserving accidental diagnostic fields from v1. DIR-124-B's plan (M236, already drafted) references consuming A1's event shape with a `migrateDir124AEvent(event)` adapter that maps v1 fields into canonical `StageEvent` envelopes -- the v1 version marker makes this migration explicit and testable.

**Emission mechanism:** The workflow DSL has no `import` capability (the documented constraint at `execute-milestone.js` lines 23-25). The `recordStageEvent` helper is invoked via `node --experimental-strip-types <script> --emit-event '<json>'` dispatched through the workflow's existing `agent()` primitive, following the exact same pattern used for `composite-preflight.ts` (line ~503-505), `milestone-worktree.ts` (line ~398-399), `composite-reconcile.ts` (line ~886), and `prepare-admission-check.ts` (line ~171). Each workflow file gains an inline snippet (following the established `_normalizeExecuteArgsInline` pattern at lines 29-46 and the `_isolationPlan` inline mirror at lines 96-100) that shells out to the schema module's `--emit-event` CLI mode. The per-event agent dispatch is fire-and-forget: the result is never parsed, branched on, or fed into any scheduling decision. This is the same fire-and-forget pattern `_convergenceAgentCall` already uses for `--record-attempt` (M203/DIR-126-D): "telemetry is additive, its own result is never inspected/branched on, and the caller's existing return value/shape is byte-identical either way."

**Emission helper shape:** The `recordStageEvent` function is a thin wrapper that:
1. Serializes the event object against the v1 schema (structural validation, fail-soft)
2. Appends one JSON line to `<repoRoot>/experiments/quay-perpetual-stream/.workflow-events/<runId>.jsonl`
3. On any failure (bad JSON, missing directory, disk full): logs to stderr and continues -- never throws, never blocks the phase, never changes dispatch outcome
4. Returns `void` -- no caller branches on its return value

**Interaction with existing telemetry:** The A1 event stream is a NEW observability layer, not a replacement for or extension of the existing `_phaseTimings` / `proposal-convergence.ts` telemetry mechanism. The existing mechanism serves a different purpose (committed prepare-generation telemetry for cross-generation resume decisions, tied to the single-flight lease), writes to a different path (`milestones/prepare-telemetry/`, git-committed), and has a different schema. The two systems coexist without coupling: `recordStageEvent` is called at workflow-DSL level; `_recordPhaseBoundary` / `--record-generation` are called at the prepare-specific lease-renewal/terminal level. No unification, no migration, no dual-write.

**Mirror parity:** both `experiments/scripts/` and `plugin/scripts/` workflow mirrors of the schema module are byte-identical. Both mirror pairs of the workflow files themselves (`.claude/workflows/execute-milestone.js` / `plugin/workflows/execute-milestone.js` and `prepare-milestone.js` mirrors) are already byte-identical (confirmed by `diff` on the current `master` checkout). The existing inline-mirror pattern (documented at `execute-milestone.js` line 90: "the SAME mirror pattern composite-args.ts uses above") is extended to cover the `recordStageEvent` call sites, and the existing mirror-parity test pattern enforces this at Land.

**Pre-instrumentation baseline:** a baseline run's phase sequence/agent counts/outcome is captured BEFORE the workflow files are edited, so the instrumentation-delta claim is provable against a recorded before-state -- not reconstructed prose. This is the same "capture before editing" pattern used in `proposal-convergence.ts`'s checkpoint mechanism (M207).

**WIRING-CLAIM (A1-EMIT-1):** `recordStageEvent` in `workflow-event-schema.ts` is the single emission point for all stage events.
**WIRING-CLAIM (A1-EMIT-2):** Events are emitted at all 8 boundaries by workflow JS code at `phase()` call sites and the post-`--acquire` admission site, not by agent structured-output calls.
**WIRING-CLAIM (A1-EMIT-3):** Prepare admission (prepare-milestone.js, post-`--acquire` success) is one of the 8 instrumented boundaries, and it fires BEFORE any content agent is dispatched -- proving the workflow-JS-emitted design is necessary.
**WIRING-CLAIM (A1-MIRROR):** Both mirror pairs are instrumented byte-identically; mirror-parity check passes at Land.
**WIRING-CLAIM (A1-VERSION):** The schema is explicitly versioned; DIR-124-B may extend it without preserving accidental diagnostic fields.
**WIRING-CLAIM (A1-PRE-BASELINE):** A pre-instrumentation baseline run is captured BEFORE workflow edits; golden replay proves instrumentation changes no stage order, agent count, outcome, shared-state mutation, or scheduling decision.
**WIRING-CLAIM (A1-CLI-MODE):** The schema module exposes a `--emit-event` CLI mode invoked by workflow agent calls, following the same `node --experimental-strip-types <script> <flags>` pattern used by `composite-preflight.ts` and `composite-reconcile.ts` invocations already present in the workflow.

#### M2: Golden replay corpus (DIR-124-A2)

Replay fixtures under `experiments/quay-perpetual-stream/fixtures/workflow-replay/` cover 8 named cases:

1. Legacy singleton success (width-1, no isolation, serial Land)
2. Verify failure (mechanical check fails)
3. Prepared failure (missing/stale preparation receipt)
4. Audit REFUTED (adversarial audit finds a blocking issue)
5. Gate failure (one of the parallel mechanical gates fails)
6. Composite success (multi-task composite, worktree isolation, serial Land)
7. Concurrent partial survivor (concurrent mode, worktree isolation, deferred-to-fan-in Land)
8. Cache/resume behavior (Verify cache hit, prepared receipt reuse)

Plus the two measured known-defect shapes:
9. M192 null-Build continuation (nil/empty Build result advancing to Audit/Land)
10. M195 stale-Prepared-after-Verify (Verify cost paid before prepared-receipt rejection)

Each assertion carries a 3-label public classification:
- **normative** -- must pass; a failure blocks Land
- **compatibility-only** -- logged as a diagnostic warning on failure, not a hard block
- **known-defect observation** -- must reproduce exactly; labeled `known-defect`, never asserted as normative

A finer internal 4-category taxonomy (normative / compatibility-only / observed-but-undesired / explicitly open defect) is retained in fixture metadata so a defect is never silently normalized into a normative invariant.

The replay runner (`experiments/quay-perpetual-stream/scripts/workflow-replay.ts`, mirrored at `plugin/scripts/workflow-replay.ts`) replays each case against the A1 event stream mechanically -- not via prose description. RED/GREEN negative controls exist for both known-defect shapes (must reproduce exactly, labeled `known-defect`, never asserted as normative) and for a deliberately-tampered normative assertion (must fail replay).

**WIRING-CLAIM (A2-CONSUME):** The replay runner consumes the A1 event stream from `experiments/quay-perpetual-stream/.workflow-events/<runId>.jsonl` -- A2 depends on A1's schema being stable.
**WIRING-CLAIM (A2-EIGHT):** All 8 named success/failure/composite/concurrent/cache cases are covered by at least one fixture each.
**WIRING-CLAIM (A2-CLASSIFY):** Each assertion is labeled normative, compatibility-only, or known-defect observation at the assertion level.
**WIRING-CLAIM (A2-DEFECTS):** The two known-defect shapes (M192 null-Build continuation, M195 stale-Prepared-after-Verify) are explicitly labeled `known-defect` and never normalized into a normative invariant.
**WIRING-CLAIM (A2-NEG-CTRL):** RED/GREEN negative controls exist for both defect shapes (defect asserted as normative must fail) and for a deliberately-tampered normative assertion (tampered assertion must fail).

#### M3: Invariant-ownership manifest (DIR-124-A3)

`experiments/quay-perpetual-stream/invariant-ownership.md` (mirrored at `plugin/invariant-ownership.md`) is the single source of truth: every load-bearing workflow invariant names exactly ONE intended executable owner. Every other occurrence is classified as a generated view, compatibility adapter, or duplicate to remove. The manifest covers at minimum the 10+ architectural dimensions `execute-milestone.js` simultaneously owns (argument normalization, task/class policy routing, Verify cache ownership, preparation gating, Build method dispatch, Audit write policy, Gate dispatch, Git/worktree semantics, lifecycle mutation, dashboard/backlog updates, serial/concurrent Land behavior) plus `prepare-milestone.js`'s dimensions (admission, preflight, proposal generation, adjudication, review, plan authoring, plan checking, receipt writing).

`experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.ts` (mirrored at `plugin/scripts/workflow-invariant-ownership.ts`) parses the manifest and the workflow/OUTER-LOOP/composite files, and fails if any invariant has two entries marked `authoritative`. This enforcement is wired into `it0-dod-check.ts` as a new clause (following the established pattern of clauses 10-12 which shell out to existing scripts directly) -- not as a standalone document. The duplicate/deletion list is consumed by downstream crystallization (DIR-124-B/C/D).

**WIRING-CLAIM (A3-MANIFEST):** `invariant-ownership.md` is the single source of truth for invariant-to-owner assignments, covering both workflow files and OUTER-LOOP.md.
**WIRING-CLAIM (A3-ENFORCE):** `workflow-invariant-ownership.ts` rejects two authoritative owners for the same invariant rule (non-zero exit).
**WIRING-CLAIM (A3-DOD-WIRE):** Enforcement is wired into `it0-dod-check.ts`'s DoD gate as a new clause that shells out to `workflow-invariant-ownership.ts`, following the established pattern of clauses 10-12.
**WIRING-CLAIM (A3-DELETION-LIST):** The duplicate/deletion list is consumed by DIR-124-B/C/D downstream refactoring.

#### M4: Workflow-metadata vs executable-driver conformance (DIR-124-A4)

`experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.ts` (mirrored at `plugin/scripts/workflow-metadata-conformance.ts`) extracts the workflow DSL's metadata surface and compares each claim against the executable driver contract:

**Metadata surface extracted:**
- `meta.phases[]` objects (title + detail strings) at the top of both workflow files (lines 2-16 in `prepare-milestone.js`, lines 2-9 in `execute-milestone.js`)
- Phase-description comment blocks (the `// -- Phase: X --` comment lines preceding each `phase()` call)
- Inline documentation claims (e.g. "DIR-123: under worktree isolation..." comments)
- The `meta.description` string in `execute-milestone.js`

**Driver contract checked:**
- Actual `phase('Name')` call locations (lines 66, 234, 389, 673, 769, 857, 908 in execute-milestone.js; line 164 and equivalents in prepare-milestone.js)
- Worktree invocation lines: `milestone-worktree.ts --add`/`--merge`/`--remove`/`--land-lock-acquire`/`--land-lock-release` via agent-dispatched shell commands
- Gate-count wiring: the `parallel([])` array entries in the Gate phase
- Cache/resume flags: `cacheFingerprints`, `priorVerifyCache`
- `node --experimental-strip-types` callsites for composite module invocations

A claim with no matching real callsite/line in the driver produces a hard failure (non-zero exit). A claim present in the driver but absent from metadata produces an informational warning (metadata lags behind reality -- the safe direction). A deliberately-stale RED fixture (e.g., a `building` claim in `meta.description` or `meta.phases[]` `detail` string describing a retired background dispatch path, or a comment block citing a `milestone-worktree.ts` invocation line that moved) fails; the corrected claim passes. The checker runs as part of the DoD gate, wired into `it0-dod-check.ts` as a new clause.

**WIRING-CLAIM (A4-CHECKER):** The conformance checker compares workflow DSL metadata claims (`meta.phases[]` detail strings, `meta.description`, key comment blocks) against the executable driver contract (real `phase()` call sites, worktree invocation lines, gate-count wiring, cache/resume flag references, composite module callsites).
**WIRING-CLAIM (A4-RED-GREEN):** A deliberately-stale claim fixture fails; the corrected claim fixture passes (falsifiable).
**WIRING-CLAIM (A4-DOD-WIRE):** The checker runs as part of the DoD gate via a new `it0-dod-check.ts` clause.
**WIRING-CLAIM (A4-STALE-SAFE):** A claim absent from metadata but present in the driver is a PASS (informational), not a failure -- reality is authoritative.

#### M5: Baseline metrics emission (DIR-124-A5)

`experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts` (mirrored at `plugin/scripts/workflow-baseline-metrics.ts`) consumes the A1 event stream across available real samples and emits the RA5/RA9 metric set mechanically -- never estimated from prose reports.

The **mechanical/content-agent split** is a first-class classification on each metric:

- **Mechanical-runner work:** Verify script dispatches, Gate agent dispatches, Reconcile CLI invocations, Land merge/commit operations
- **Content-agent work:** ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, Build implementation, Audit reasoning

Each of the 10 crystallization-document metrics is mapped to a mechanical computation:

| Metric | Source from event stream |
|---|---|
| change-propagation radius | `observedWrites` across events; unique files/directories touched |
| context working set | files read by agents per stage (from `commandIdentity` + `agentLabel` cross-referenced against repo file list) |
| shared-writer count | stages emitting `observedWrites` that overlap (dashboard.md, tasks/*.md, milestone_counter) |
| duplicate-rule count | from A3's manifest: rules with >1 occurrence (authoritative + duplicates) |
| prompt-to-code ratio | fraction of `commandIdentity` entries that are shell-outs to real scripts vs. agent-only NL instructions |
| receipt reuse rate | Prepared phase events where `outcome` is `skipped` due to cache-hit / valid receipt |
| replay variance | difference between A2 replay cases' expected outcomes and actual event-stream outcomes |
| failure-attribution precision | fraction of `needs-human` outcomes where `stage` + `waitReason` + `commandIdentity` are all non-null |
| full-suite executions per candidate | count of `commandIdentity` entries matching `scripts/test.sh` per candidate |
| Land-fence hold/queue time | `timing.queuedAtMs` to `timing.startedAtMs` delta for Land-stage events (measures lock wait) |

Metrics are tagged with `metricClass: "mechanical-runner" | "content-agent"` and aggregated per-class. Missing fields are reported as explicit `unknown` (or `null` where JSON null is appropriate), never as zeros or guesses. The baseline records the before-state only -- it does not infer delivered value or change pass/fail policy.

**WIRING-CLAIM (A5-CONSUME):** Baseline metrics are emitted mechanically from the A1 event stream at `experiments/quay-perpetual-stream/.workflow-events/*.jsonl` -- A5 depends on A1.
**WIRING-CLAIM (A5-SPLIT):** Mechanical-runner work is separated from content-agent work as a first-class `metricClass` tag on every metric.
**WIRING-CLAIM (A5-UNKNOWNS):** Missing fields are reported as explicit `unknown` string values, never as zeros or guesses.
**WIRING-CLAIM (A5-NO-INFERENCE):** The baseline does not infer delivered value or change pass/fail policy; it records the before-state only.

### Concrete control and data flow

```
                    ┌──────────────────────────────────────────┐
                    │  scripts/workflow-event-schema.ts         │
                    │  (canonical schema v1 +                   │
                    │   recordStageEvent helper +               │
                    │   --emit-event CLI mode)                  │
                    │  Mirror: plugin/scripts/                  │
                    └──────┬───────────────────────────────────┘
                           │ invoked via node --experimental-strip-types
                           │ --emit-event by agent-dispatched CLI calls
              ┌────────────┴────────────┐
              ▼                         ▼
   prepare-milestone.js       execute-milestone.js
   ┌───────────────────┐      ┌─────────────────────────┐
   │ Admission ───E1──►│      │ Verify ───────────E2───►│
   │ Preflight         │      │ Prepared ────────E3────►│
   │ ProposalAuthors   │      │ Build ───────────E4────►│
   │ Adjudicate        │      │ Audit ───────────E5────►│
   │ ProposalReview    │      │ Gate ────────────E6────►│
   │ PlanAuthor        │      │ Reconcile ───────E7────►│
   │ PlanCheck         │      │ Land ────────────E8────►│
   │ Receipt           │      └─────────────────────────┘
   └───────────────────┘                  │
                            ┌─────────────┴──────────────┐
                            ▼                            ▼
              .workflow-events/<runId>.jsonl    (gitignored,
                                                experiments/ dir)
                            │
             ┌──────────────┼──────────────────┐
             ▼              ▼                  ▼
        A2 replay       A5 metrics          A3/A4 checks
        corpus          baseline            (consume source
        (fixtures/      report              files directly
         workflow-      (mechanical/        for ownership/
         replay/)       content split)      conformance)
```

E1: `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/workflow-event-schema.ts --emit-event '{...}'` called in `prepare-milestone.js` via an agent-dispatched CLI invocation after `--acquire` succeeds. E2-E8: called in `execute-milestone.js` at each `phase()` marker via agent-dispatched CLI invocations.

A2's replay runner reads the A1 event stream per fixture, replays it, and asserts per-case verdicts. A5's metrics script reads the A1 event stream across available real samples and emits the mechanical/content split metric set. A3's enforcement script reads the manifest + workflow/OUTER-LOOP sources directly (does not depend on events). A4's conformance script reads the workflow DSL metadata surface and compares against the real driver lines.

The per-event agent dispatch follows the established pattern from the workflow's existing composite module invocations: an `agent({label: 'emit-event-<boundary>', ...})` call that runs `node --experimental-strip-types workflow-event-schema.ts --emit-event '<json>'` and is fire-and-forget (the result is never parsed or branched on). The `recordStageEvent` TypeScript function is the single canonical implementation; the workflow gains only the thin dispatch wrapper.

### Key design decisions

**DD1: Workflow-JS-emitted, not agent-emitted.** Events are emitted by the workflow DSL's own JavaScript at wrapped `phase()` / dispatch-helper boundaries via agent-dispatched CLI invocations. Agent structured-output emission couples content agents to the observability contract and cannot guarantee emission at every boundary -- the workflow itself owns the dispatch lifecycle; agents only see their own prompt. Prepare admission fires before any content agent is dispatched and would have no agent to emit through. This is the split review's blocking architectural finding. The M207 `_phaseTimings` pattern in prepare-milestone.js already established a limited form of this approach.

**DD2: Single canonical schema module, not embedded.** The schema lives in `experiments/quay-perpetual-stream/scripts/workflow-event-schema.ts` -- a first-class module that both workflow mirrors invoke via `node --experimental-strip-types --emit-event`. The split review's `no-schema-home` finding explicitly forbids embedding the schema in an emission script. DIR-124-B may extend this same schema (v2) without duplicating it or creating a parallel format.

**DD3: Per-assertion classification, not naive snapshots.** Naive golden snapshots would freeze known defects (M192 null-Build continuation, stale M195 Prepared) as desired behavior. Each replay assertion carries a 3-label public classification (normative / compatibility-only / known-defect observation), with the finer 4-category internal taxonomy retained in fixture metadata. The two known-defect shapes are explicitly `known-defect` at the assertion level -- never normalized into a normative invariant.

**DD4: Mechanical enforcement, not prose.** Both the invariant-ownership manifest (A3) and metadata-conformance check (A4) fail mechanically on violation -- two authoritative owners, or a stale metadata claim not matching a real driver callsite, produce a hard failure (non-zero exit). Prose-only manifests get paraphrased away (ADR-004). Both are wired into `it0-dod-check.ts`'s existing DoD gate clause framework -- not standalone documents with no enforcement linkage.

**DD5: Versioned schema, forward-migratable.** The event schema is explicitly versioned (v1). DIR-124-B may extend it without preserving accidental diagnostic fields. No second journal format is introduced by any child. DIR-124-B's plan (M236, already drafted) references consuming A1's event shape with a `migrateDir124AEvent(event)` adapter that maps v1 fields into canonical `StageEvent` envelopes -- the v1 version marker makes this migration explicit and testable at the M236 boundary.

**DD6: Ordered dependency, parallel non-dependents.** A1 lands first (schema + emission), unblocking A2 and A5. A3 and A4 have no dependencies and can proceed in any order relative to A1's execution. The parent's AC6 parent/child lifecycle gate ensures no promotion before all children are done.

**DD7: Both mirror pairs instrumented byte-identically.** The `plugin/workflows/` mirrors of `execute-milestone.js` and `prepare-milestone.js` are already byte-identical to their `.claude/workflows/` counterparts (confirmed by `diff` on the current `master` checkout). A1 instruments both pairs identically; the existing inline-mirror test pattern (which already pins `_normalizeExecuteArgsInline` and `_isolationPlan` against their .ts single-sources) is extended to cover the `recordStageEvent` dispatch sites. The `plugin/scripts/` mirror of `workflow-event-schema.ts` is byte-identical to the `experiments/` copy.

**DD8: Pre-instrumentation baseline required.** A1's delivery includes capturing a baseline run's phase sequence, agent counts, and outcome BEFORE the workflow files are edited, so the instrumentation-delta claim is provable against a recorded before-state, not reconstructed prose. This is the same "capture before editing" pattern used in `proposal-convergence.ts`'s checkpoint mechanism (M207).

**DD9: Thin dispatch wrapper, not a full import.** The workflow DSL has no `import` capability (the documented constraint at `execute-milestone.js` lines 23-25: "workflow DSL scripts have no `import` capability -- only phase/agent/parallel/log/args globals"). The schema module is invoked via `node --experimental-strip-types` CLI calls dispatched through the workflow's existing `agent()` primitive, following the exact same pattern used for `composite-preflight.ts` (line ~503-505), `milestone-worktree.ts` (line ~398-399), `composite-reconcile.ts` (line ~886), and `prepare-admission-check.ts` (line ~171) -- this is the established, documented, tested mechanism for workflow-to-TypeScript invocation.

**DD10: Emission is fire-and-forget.** The `recordStageEvent` agent dispatch is never awaited for its return value, and its result is never parsed, branched on, or fed into any scheduling decision. This is the same fire-and-forget pattern `_convergenceAgentCall` already uses for `--record-attempt` (M203/DIR-126-D: "telemetry is additive, its own result is never inspected/branched on, and the caller's existing return value/shape is byte-identical either way"). A failed emission (agent crash, parse error, disk full) is silently dropped -- the event log is a best-effort observability channel, not a gate.

### Defaults and failure behavior

**A1 (stage-event schema + emission):** `recordStageEvent` is observational-only. A JSON-serialization or schema-validation failure logs to `console.error` (stderr) but never blocks the phase or changes the dispatch outcome. The event log is a best-effort observability channel: if the `.workflow-events/` directory cannot be created (permissions, disk full), emission is silently dropped -- a missing event log entry is a diagnostic gap, not a workflow failure. No return-value coupling to phase dispatch. The pre-instrumentation baseline proves zero behavior delta: same phase order, same agent count, same outcome, same shared-state mutations, same scheduling decisions.

**A2 (golden replay corpus):** A `normative` assertion that fails replay -> the runner exits non-zero (hard failure). A `compatibility-only` assertion that fails -> logged as a diagnostic warning (non-zero exit but with a distinct exit code so CI can distinguish), not a hard failure. A `known-defect` assertion that no longer reproduces -> the defect has been incidentally fixed; the assertion fixture is updated to reflect the fix (the runner reports "defect resolved" rather than failing). A deliberately-tampered normative assertion -> the runner exits non-zero (GREEN negative control, proving the runner actually checks).

**A3 (invariant-ownership manifest):** Two `authoritative` owners for the same invariant -> enforcement exits non-zero, DoD gate fails, milestone cannot Land. A missing owner (invariant present in the workflow but with no `authoritative` entry in the manifest) -> informational warning on stdout, exit zero (not a hard failure). The manifest catalogs what it knows; absence means "not yet inventoried." Making missing entries a hard failure would make the initial manifest unscopable. A duplicate/deletion-list entry referencing a non-existent invariant -> informational warning, not a hard failure (the deletion target may have already been removed).

**A4 (metadata-conformance):** A metadata claim with no matching real callsite/line in the driver -> FAIL (non-zero exit, blocks DoD gate). This is the primary enforcement path. A claim present in the executable driver but absent from metadata -> informational warning (metadata lags behind reality, which is the safe direction -- reality is what runs). An unparseable metadata format -> FAIL (the checker must be able to parse the surface it claims to check; if the DSL format changes, the checker must be updated). RED/GREEN negative-control fixtures pin these behaviors.

**A5 (baseline metrics):** A metric with insufficient evidence -> reported as `unknown` (or `null` where JSON null is appropriate), never as zero or guessed. A metrics run with zero real event samples -> the script reports `{samples: 0, status: "no-data"}` and exits zero (an honest empty baseline is valid output). The baseline does not infer delivered value or change pass/fail policy.

**Cross-child defaults:** No child introduces a new lifecycle status, changes pass/fail policy, or introduces a second journal format. Each child's failure mode is confined to its own scope. A1's event stream existing without A2's replay corpus is safe -- the event stream is usable on its own. A3's manifest existing without A4's conformance check is safe -- each is an independent check.

### Compatibility

All five children are **behavior-preserving** with respect to the installed workflow (DIR-123's worktree isolation live at commit 059b5b16):

- **A1** instruments observationally only -- no phase order, agent-count, outcome, shared-state mutation, or scheduling decision changes. The pre-instrumentation baseline (captured before workflow edits, proven by golden replay) provides mechanical proof of this claim. The fire-and-forget dispatch pattern matches the existing `_convergenceAgentCall` telemetry pattern (M203, M207) -- additive, never read back.
- **A2** captures current behavior including known defects -- it does not change which code paths execute. The 3-label classification taxonomy ensures defects are labeled, not normalized.
- **A3** inventories existing invariants -- it does not reassign ownership or delete duplicates. The enforcement script is additive (fails on violation, passes on compliance).
- **A4** checks existing metadata claims against the executable driver -- it does not change the metadata or the driver.
- **A5** measures existing runs -- it does not change what the workflow does.

The overall before-state boundary is the installed workflow with DIR-123's worktree isolation live at commit 059b5b16. The later DIR-124 children (B/C/D/E) will be the ones that touch the workflow's control plane; this proposal's measurement boundary is anchored before those changes.

DIR-124-B's plan (M236) already references consuming A1's event shape with `migrateDir124AEvent(event)`: "consumes a DIR-124-A stage-event shaped to the PINNED field set ... mapping field-for-field into a `StageEvent` with its hashes/provenance preserved" -- so the v1 schema is the explicit migration source for the downstream journal format.

### AC coverage

Each of the parent's 6 Acceptance Criteria maps to a specific child:

| Parent AC | Child | Mechanism |
|---|---|---|
| AC1: canonical stage-event schema exercised by real workflow execution, recording all named fields | A1 | `workflow-event-schema.ts` (both mirrors) + `recordStageEvent` at all 8 boundaries, versioned v1, start+end events per boundary |
| AC2: replay fixtures covering 8 named cases + 2 defect shapes, each assertion labeled normative/compatibility-only/known-defect | A2 | `fixtures/workflow-replay/*` + `workflow-replay.ts` with per-assertion public 3-label classification, internal 4-category taxonomy |
| AC3: invariant-ownership manifest rejects two authoritative owners and lists every duplicate scheduled for deletion | A3 | `invariant-ownership.md` (both mirrors) + `workflow-invariant-ownership.ts` enforcement, wired into `it0-dod-check.ts` |
| AC4: deliberately stale workflow metadata/driver claim fails conformance; corrected claim passes | A4 | `workflow-metadata-conformance.ts` (both mirrors) with RED/GREEN negative controls, wired into `it0-dod-check.ts` |
| AC5: baseline measurements emitted mechanically, separate mechanical/content agent calls, report stage wall/queue time, agent-minutes, tokens, finding novelty/recurrence, artifact-class output with explicit unknowns | A5 | `workflow-baseline-metrics.ts` (both mirrors) consuming A1 event stream, 10 metrics from crystallization doc section 8, mechanical/content split |
| AC6: parent/child lifecycle consistency gate passes | All | Parent `done` iff all 5 children `done`; `it0-split-or-commit-check.ts` PARENT-DONE-IFF-CHILDREN enforcement |

Each child also independently satisfies the parent's non-goal: no post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease introduction.

### Risks

**R1: Instrumentation perturbs behavior.** The act of adding `recordStageEvent` calls at phase boundaries could change the workflow's control flow (e.g., a timing-sensitive race, a `try/catch` scope change). Mitigation: A1's pre-instrumentation baseline -- a real run captured before workflow edits, with golden replay proving zero delta in stage order, agent count, outcome, shared-state mutation, or scheduling. The `agent()`-dispatched CLI call is fire-and-forget with an agent label prefix (`emit-event-<boundary>`) that is never referenced by any scheduling or routing logic.

**R2: Instrumentation drift across dual mirrors.** The `experiments/` and `plugin/` workflow/script mirrors must be instrumented byte-identically. A future edit to one mirror that adds a `--emit-event` dispatch the other misses would silently produce incomplete event streams. Mitigation: the existing inline-mirror test pattern (which already pins `_normalizeExecuteArgsInline` and `_isolationPlan` against their canonical `.ts` single-sources) is extended to cover the `recordStageEvent` dispatch sites. Both mirror pairs are already byte-identical today (confirmed by `diff` on the current `master` checkout).

**R3: Known defects become normative through replay.** A naive snapshot would freeze M192 and M195 as desired behavior. Mitigation: A2's per-assertion 3-label classification taxonomy -- known defects labeled `known-defect`, never normalized into a normative invariant. RED/GREEN negative controls enforce this mechanically: a defect shape asserted as normative fails replay.

**R4: Schema becomes a second journal format.** The crystallization document explicitly warns against adding a second representation (section 3.5: "they add a second representation rather than compressing the first"). Mitigation: A1's explicit versioning (v1); DIR-124-B extends it via the `migrateDir124AEvent` adapter rather than forking it. A5's metrics consume the same event stream rather than introducing a parallel format. DIR-124-B's plan (M236) already codifies this migration contract.

**R5: Event log disk growth.** Accumulated per-run `.jsonl` files under `.workflow-events/` could grow unboundedly. Mitigation: the directory is gitignored (never committed); `cleanup_temp_files` (meta-cc MCP) already cleans stale files, and the event log directory is included in its scope. A single run's events are small (~8 events x ~500 bytes = ~4 KB per run).

**R6: Replay corpus staleness.** As the workflow evolves (DIR-124-B/C/D/E landing), the A2 replay fixtures may no longer match the installed workflow shape. This is expected and desired: the corpus is explicitly a before-state snapshot. Post-DIR-124-E, a new replay corpus must be captured; the A2 fixtures serve as the comparison baseline, not a permanent compatibility contract.

**R7: A3's invariant-ownership manifest becomes stale prose.** Mitigation: mechanical enforcement -- two authoritative owners for the same invariant fails the DoD gate (non-zero exit). The manifest is a checked file gated by `it0-dod-check.ts`; it cannot be skipped or hand-waved.

**R8: A4's conformance check produces false positives when the DSL metadata surface format changes.** Mitigation: RED/GREEN controls -- a deliberately stale claim must fail, and the corrected claim must pass. If the DSL metadata format drifts in a way the checker cannot parse, the RED fixture catches it (the stale claim that should fail no longer fails).

**R9: A5's baseline is thin because too few real samples exist at Land time.** Only a handful of real milestone runs may exist when A5 lands. Mitigation: explicit unknowns -- the baseline does not estimate or fabricate. A thin baseline is an honest baseline; DIR-124-E's resource-aware scheduling design will know which metrics are real and which are not.

**R10: Cross-cutting scope.** The five children collectively touch 25+ files across 4 directories. A partial Land (e.g., A1 lands, A2 fails audit) leaves the repo with the event stream but no replay corpus. Mitigation: each child is independently complete and safe in isolation -- A1's event stream is usable on its own; A2's fixtures don't gate the workflow; A3/A4 are standalone checks. Parent is only `done` when all five children are `done`.

### Non-goals

Explicitly excluded from this parent's scope:

1. **Stage scheduling or pipeline reordering** (DIR-124-C's scope).
2. **New lifecycle policy or gate addition** (DIR-124-B's scope).
3. **A second journal format** (DIR-124-B must extend A1's v1 schema via migration adapter, not create a parallel one).
4. **Kernel extraction or control-plane refactoring** (DIR-124-D's scope).
5. **Resource-aware scheduling or lease management** (DIR-124-E's scope).
6. **Post-Land Wiring Audit introduction** (DIR-118's scope; this parent is strictly C0 measurement, not enforcement).
7. **Worktree redesign** (DIR-123's mechanism is reused as-is; no changes to `milestone-worktree.ts`).
8. **Inferring delivered value or changing pass/fail policy from baseline metrics** (A5 records the before-state only).
9. **Making worktree isolation the default** (that is a later, separately-earned decision per DIR-123's opt-in-then-prove posture).
10. **Full AST validation of the workflow DSL** (targeted metadata-vs-driver conformance is sufficient for C0; full grammar validation belongs in DIR-124-B or C).
11. **Unifying the A1 event stream with gate-events.jsonl or prepare-telemetry** (these are separate systems with different purposes, schemas, storage paths, and commit policies).

### Alternatives considered and rejected

**Alt1: Single monolithic deliverable (pre-split).** The original DIR-124-A proposal was one unified task. The `prepare-milestone.js` ProposalReview returned `needs-human`/`split-recommended`, code `split-multi-mechanism` -- 5 independently landable mechanisms (>2), `repairable: false`. Splitting into 5 ordered children is the correct outcome per DIR-026 SPLIT-OR-COMMIT.

**Alt2: Agent structured-output emission for stage events.** Would couple content agents to the observability contract. Cannot guarantee emission at every boundary -- agents crash, return unparseable output, or skip the structured-output field entirely. Prepare admission fires before any content agent is dispatched and would have no agent to emit through. Rejected: workflow JS owns the dispatch lifecycle and is the only place emission-by-construction can be guaranteed.

**Alt3: Embedding the event schema inside an emission script.** The split review's `no-schema-home` finding explicitly forbids this: DIR-124-B must extend the same schema without copying it from an emission-only file. Rejected: a first-class module at `experiments/quay-perpetual-stream/scripts/workflow-event-schema.ts` is the single canonical home. DIR-124-B's plan (M236) already treats A1's schema as an importable migration source -- embedding it in an emission script would force M236 to copy-paste the schema, reproducing the exact fragmentation this proposal prevents.

**Alt4: Naive golden snapshot (full state capture without classification).** Would freeze known defects (M192 null-Build continuation, stale M195 Prepared) as desired behavior. Rejected: per-assertion 3-label classification with RED/GREEN negative controls is required to separate intentional compatibility from known defects.

**Alt5: Prose manifest only (no mechanical enforcement).** Prose gets paraphrased away (ADR-004). Rejected: mechanical enforcement that fails on two authoritative owners is the executable invariant. The `it0-dod-check.ts` wiring ensures the manifest is checked at every Land.

**Alt6: Manual prose review of workflow comments for metadata drift.** No mechanical failure when a claim drifts -- the five confirmed stale claims in the crystallization document demonstrate that humans do not reliably detect drift. Rejected: the metadata-vs-driver conformance check produces a hard failure on mismatch.

**Alt7: Prose estimation from reports for baseline metrics.** The split review's baseline-ordering finding requires a mechanical before-state. Prose reconstruction from reports is the current (broken) state. Rejected: A5 emits metrics mechanically from the A1 event stream.

**Alt8: Merging A1 and A5 (schema + metrics in one child).** A5 is a distinct deliverable consuming the A1 stream; keeping them separate preserves independent landability -- the split review's core finding is that each mechanism is independently landable. Rejected: A1 and A5 remain separate children.

**Alt9: Parallel child dispatch (executing all five children concurrently).** Rejected because A2 and A5 depend on A1's event stream. A3 and A4 have no dependencies and could theoretically run in parallel with A1, but the ordered-child split form (parent completion = completion of ordered children) is the established mechanism -- each child is independently dispatched with its own real proof and independent audit.

**Alt10: Full AST validation of the workflow DSL for metadata conformance.** Rejected as over-scoped for C0. The targeted surface is metadata claims vs. executable driver contract -- `phase()` call locations, worktree invocation lines, gate-count wiring, cache/resume flags, and `node --experimental-strip-types` callsites. Full AST validation of the DSL grammar belongs in DIR-124-B or C, once the measurement boundary is established.

**Alt11: Importing the schema module into the workflow (adding `import` support to the DSL).** The workflow DSL has no `import` capability (documented constraint at `execute-milestone.js` lines 23-25). The established `node --experimental-strip-types <script> <flags>` CLI dispatch pattern is the existing, tested, documented mechanism for workflow-to-TypeScript invocation. Introducing a novel import mechanism would be a larger scope change than the observability boundary itself.

**Alt12: Using the A1 event stream as a gating mechanism.** Rejected: the event stream is observational-only. A missing or malformed event must never block a phase or change dispatch outcome. The gate engine (`quay gate`) already has its own immutable GateEvent append mechanism at `.quay/gate-events.jsonl`; this proposal does not introduce a competing gate journal.

## Touches
- tasks/DIR-124-A.md（自身文件）
