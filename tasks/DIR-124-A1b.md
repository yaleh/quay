---
id: DIR-124-A1b
title: Stage-event emission instrumentation at 8 workflow boundaries
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-124-A1
children: []
extra:
  schema: v1
---
**type:** execution

**Reclassified (2026-08-02, ADR-021 review):** the 14 WIRING-CLAIMs in the original proposal were
coverage entries (one start + one end event per boundary × 8 boundaries + mirror parity), NOT 14
independent mechanisms. This task is **1 mechanism** (stage-event emission instrumentation) that
calls the A1a schema module at 16 call sites. The split decision at
`milestones/prepare-decisions/DIR-124-A1b.json` is SUPERSEDED — A1b was already a level-2 leaf
when it re-triggered `split-multi-mechanism`. Per ADR-021 Principle 4 (`split-recursive-guard`),
auto-splitting deeper compounds the defect. The fix: execute as a single milestone with the AC
checkboxes below covering all 8 boundaries + mirror parity + fire-and-forget semantics.

## Proposal

Split from DIR-124-A1. Instrument `execute-milestone.js` and `prepare-milestone.js` to emit structured stage events using the A1a schema module at all 8 cross-workflow boundaries.

### Problem framing (grounded in current repository state, 2026-08-01)

The two milestone-workflow files (`execute-milestone.js` at 1257 lines, `prepare-milestone.js` at 1565 lines) drive the full milestone lifecycle from SELECT through Land. Between them they cross 8 phase boundaries (`phase('Verify')` at line 66, `phase('Prepared')` at line 234, `phase('Build')` at line 389, `phase('Audit')` at line 719, `phase('Gate')` at line 817, `phase('Reconcile')` at line 919, `phase('Land')` at line 961 in `execute-milestone.js`; `phase('Admission')` at line 164 in `prepare-milestone.js`). Byte-identical mirrors exist at `plugin/workflows/` (confirmed by `diff` exit 0 at HEAD, commit `923f563e`).

Yet neither file emits any structured event record at these boundaries. The workflow DSL's `meta.phases[]` metadata block is declaration-only -- it describes phases to the runtime harness but produces no runtime event trail. The runner's own `log()` calls are unstructured diagnostic strings. Confirmed by grep (exit 1, zero hits for `recordStageEvent`, `_emitStageEvent`, `workflow-event-schema`, or `stage-event` across `.claude/workflows/` and `plugin/workflows/`). The `.workflow-events/` directory does not exist.

Existing telemetry is partial and purpose-specific, none covering the cross-workflow boundary set:

- **M207 `_phaseTimings`** in `prepare-milestone.js` (lines 84-206) accumulates per-boundary timing spans via `_recordPhaseBoundary()`, but it is prepare-workflow-only, agent-mediated (clock values from lease-renewal CLI responses, not JS-emitted `Date.now()`), tied to the single-flight lease renewal mechanism, and carries only a partial field set (phase name, round, startedAtMs, endedAtMs). It does not cover `execute-milestone.js` at all.

- **`proposal-convergence.ts`** writes committed telemetry to `milestones/prepare-telemetry/` (git-committed JSON). Its schema serves cross-generation resume decisions, not stage lifecycle observability. Its schema, storage path, and commit policy are different.

- **Gate events** at `.quay/gate-events.jsonl` (gitignored) serve the gate engine's immutable append-only log -- a different purpose, different schema, different storage path.

- **`_convergenceAgentCall()`** in `prepare-milestone.js` (lines 214-221) and its `--record-attempt` / `--record-generation` CLI modes write convergence-specific telemetry -- again a different purpose, and the function exists only in `prepare-milestone.js`, not in `execute-milestone.js`.

Without per-boundary structured event emission, every downstream consumer (A2's golden replay corpus, A5's baseline metrics, DIR-124-B's stage scheduler, DIR-124-C's pipeline reorder, DIR-124-E's resource-aware scheduling) must invent its own format, parse unstructured `log()` output, or reconstruct timelines from prose.

The specific difficulty that makes this urgent is the **Prepare admission boundary (E1)**: `prepare-milestone.js` runs `prepare-admission-check.ts --acquire` (line 164 ff.) to obtain an atomic filesystem lease via `writeFileSync 'wx'` BEFORE any content agent is dispatched (ProposalAuthors at line 673, Adjudicate at line 711). This means: (a) the admission boundary HAS no agent to emit through, so an agent-emitted design would miss it; (b) the admission boundary is the natural place to record the fencing token and `queuedAtMs -> startedAtMs` timing before any LLM-turn cost is spent.

### Chosen mechanism

Add a single inline helper function `_emitStageEvent(eventObj)` in BOTH workflow files that dispatches a fire-and-forget `agent()` call invoking A1a's `workflow-event-schema.mjs --emit-event '<json>'` via `node --no-warnings --experimental-strip-types`. This follows the EXACT pattern established by `_convergenceAgentCall()` in `prepare-milestone.js` (lines 214-221) and the CLI dispatch calls for `composite-preflight.ts` (line ~503), `milestone-worktree.ts` (line ~398), `composite-reconcile.ts` (line ~939), and `prepare-admission-check.ts` (line ~171) in `execute-milestone.js`. Each `_emitStageEvent` call is inserted at the `phase()` call site and at the corresponding terminal return/continuation site for each of the 8 boundaries.

Both workflow files gain a byte-identical inline `_emitStageEvent(eventObj)` function -- following the `_normalizeExecuteArgsInline` / `_isolationPlan` inline mirror pattern (lines 29-46, 96-104 in `execute-milestone.js`). This function constructs the `node --no-warnings --experimental-strip-types <schemaModulePath> --emit-event '<json>'` CLI invocation, wraps it in an `agent()` call with label `emit-event-<stage>-<kind>` and a `{raw: ['string','null']}` schema, and is invoked as a fire-and-forget call (result never parsed, never branched on, never fed into any scheduling or gating decision). It is the sole definition point for the event-dispatch contract within each file; no other function emits stage events.

### The 8 instrumented boundaries

| # | Boundary | Workflow file | Phase line | Start event site | End event site(s) | Notes |
|---|----------|---------------|------------|-------------------|--------------------|-------|
| E1 | Admission | prepare-milestone.js | 164 | After `log('Admission: acquired lease...')` at line 320, BEFORE epoch-status dispatch at line 358 and ProposalAuthors at line 673 | At the `return {outcome:'needs-human',...}` sites for `admission-check-failed` (line 311) and `prepare-already-running` (line 317), and at the epoch-status-failed return (line 374) -- plus a SUCCESS end event immediately after the start event, BEFORE `_epochStatusResult` dispatch at line 358 | Records fencing token as `resourceClaim`, admission contention as `waitReason`; fires BEFORE any content agent is dispatched (architectural necessity -- an agent-emitted design would have no agent yet) |
| E2 | Verify | execute-milestone.js | 66 | Immediately after `phase('Verify')` at line 66 | At `log('Verify phase PASSED...')` at line 221 for success; at each `return {outcome:'needs-human',...}` site within the Verify block (argument normalization failure at line 49, worktree-isolation failure at line 114, per-check failures around lines 140-219) for failure ends | Covers the 5 it0 checks + composite-preflight + argument normalization + worktree isolation gating |
| E3 | Prepared | execute-milestone.js | 234 | Immediately after `phase('Prepared')` at line 234 | At `return {outcome:'revision-needed',...}` at line 237 for missing receipt; at `return {outcome:'revision-needed',...}` at line 260 for failed check; at success continuation after the Prepared block (before `build-plan` dispatch at ~line 270) | Records `preparationReceiptFile` presence/absence |
| E4 | Build | execute-milestone.js | 389 | Immediately after `phase('Build')` at line 389, AFTER the worktree-creation block (lines 396-425 for `_useWorktree`) and BEFORE the width-1 / composite dispatch branch | At `return {outcome:'needs-human',...}` for worktree-create-failed (line 422), build-agent-no-result (line 492), build-evidence-failed (~line 710); at success continuation after Build-Evidence sub-phase completes (~line 714) | Records `worktreePath` (when `_useWorktree`), `isolationMode`, `candidateCommit` (from `buildResult.mergeCommit`), `observedWrites`. Build-Evidence sub-phase at line 501 is NOT a separate event boundary -- it is an internal sub-step of Build |
| E5 | Audit | execute-milestone.js | 719 | Immediately after `phase('Audit')` at line 719 | At `return {outcome:'needs-human',...}` at line 802 for composite per-shard audit failure; at `log('Audit phase complete:...')` at line 804 for success | Records `commandIdentity` from the audit dispatch |
| E6 | Gate | execute-milestone.js | 817 | Immediately after `phase('Gate')` at line 817 | At `return {outcome:'needs-human',...}` at line 905 for gate failure; at `log('Gate phase PASSED...')` at line 907 for success | Records gate count and which gates failed (via `_splitOrCommitGates` and `gates` arrays) |
| E7 | Reconcile | execute-milestone.js | 919 | Immediately after `phase('Reconcile')` at line 919 (inside the `if (_isComposite && $a.compositeManifestFile)` block) | At `return {outcome:'needs-human',...}` at line 954 for reconcile failure; at success fall-through after the Reconcile block closes at ~line 958 | Conditional on `_isComposite && $a.compositeManifestFile`; when skipped, the else-branch at line 957 emits start+end with `outcome:'skipped'` (preserving event-log completeness) |
| E8 | Land | execute-milestone.js | 961 | Immediately after `phase('Land')` at line 961 | At `return {outcome:'needs-human',...}` for audit-refuted (line 973), land-step failures (merge/commit/CAPTURE/dashboard -- around lines 985-1255), or post-land-split-or-commit violation (line 1252); at `return {outcome:'done',...}` at line 1257 for success | Records `candidateCommit` from Land's merge commit, `observedWrites` from CAPTURE step. Under `_useWorktree`: records Land lock acquisition timing |

### Inline helper function shape

Both workflow files gain an identical `_emitStageEvent` function following the `_convergenceAgentCall` pattern:

```js
async function _emitStageEvent(eventObj) {
  const json = JSON.stringify(eventObj);
  const schemaPath = 'experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs';
  // Fire-and-forget -- result is never parsed or branched on.
  await agent(
    `Run exactly this shell command and report its stdout verbatim:
node --no-warnings --experimental-strip-types ${schemaPath} --emit-event '${json.replace(/'/g, "'\\''")}'
Do not paraphrase or reformat the command's stdout. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    {
      label: `emit-event-${eventObj.stage}-${eventObj.eventKind}`,
      phase: eventObj.stage,
      schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } },
    }
  );
  // No return-value inspection. No branching. No coupling to dispatch outcome.
}
```

The workflow DSL has no `import` capability (documented constraint at `execute-milestone.js` lines 23-25). The schema module is invoked via `node --no-warnings --experimental-strip-types` CLI calls dispatched through the workflow's existing `agent()` primitive, following the SAME pattern used by `_convergenceAgentCall()`, the `_admissionAgentCall()` wrappers, and the `milestone-worktree.ts` / `composite-reconcile.ts` / `prepare-admission-check.ts` invocations -- all existing, tested, documented mechanisms for workflow-to-TypeScript invocation.

The label prefix `emit-event-<stage>-<kind>` is a naming convention that is never referenced by any scheduling, routing, or gating logic -- it exists only for diagnostic visibility in the workflow journal.

### Event object fields constructed at each boundary

Each `_emitStageEvent` call site constructs an event object with the fields A1a's schema defines. A1b does NOT define the schema -- it constructs event objects that conform to A1a's `StageEvent` type. The A1a v1 shape includes 19 required fields: `schemaVersion, runId, candidateId, taskId, stage, attempt, timing, agentLabel, executionCwd, worktreePath, commandIdentity, baseCommit, candidateCommit, outcome, waitReason, resourceClaim, observedWrites, isolationMode, dispatchMode`. `timing` carries `{queuedAtMs, startedAtMs, endedAtMs}` with `endedAtMs` null on start events.

Key field derivations:

- `runId`: extracted from `$a.charterFile` via the existing `_milestone` regex at line 81 of `execute-milestone.js` (producing `M<NN>` for execute stages) and from `_milestoneId` in `prepare-milestone.js` (producing `prepare-M<NN>` for the Admission stage). Fallback: `M${_milestone}-${_primaryTaskId}-${Date.now()}` (via a NEW `_runId` variable computed once per file, not re-derived per event).
- `stage`: the phase name string exactly matching the `phase()` argument.
- `stageIndex`: a file-scoped counter incremented per `start` event.
- `eventKind`: `"start"` or `"end"`.
- `attempt`: the current attempt ordinal -- `0` for execute stages (the execute workflow runs once); in prepare it is computed from `_epochStatusVerdict`'s `epochBase.attempts` field.
- `timing.queuedAtMs`: populated from `$a.queuedAtMs` if present, null otherwise.
- `timing.startedAtMs`: `Date.now()` captured at the `_emitStageEvent` call site. This is the workflow's own clock, not a subprocess-computed value -- it captures when the workflow actually decided to emit, not when the subprocess parsed the argument.
- `timing.endedAtMs`: null for `start` events; `Date.now()` at the end-event call site for `end` events.
- `agentLabel`: `"workflow-runner"` for E1 (since no agent exists yet); the `label` field of the phase's primary agent dispatch for E2-E8 (e.g. `"build-plan"`, `"build-integrate"`, audit agent, gate parallel labels, `"reconcile-apply"`, Land agent).
- `executionCwd`: `process.cwd()` at the workflow level (i.e., the repository root -- both workflow files execute from the repo root).
- `worktreePath`: from `_isolationPlan.worktreeRel` when `_useWorktree === true` (line 103); null otherwise.
- `commandIdentity`: the primary `node --experimental-strip-types` command invoked for the phase, or the agent prompt label if the phase is purely agent-mediated (e.g., `"build-plan"`, `"reconcile-apply"`, Land agent prompt identifier).
- `baseCommit`: at E2 start (Verify), computed once and reused -- captured from the build plan checkpoint or from `$a.baseCommit` if provided by the caller.
- `candidateCommit`: populated at Build end (from `buildResult.mergeCommit`) and Land end (from Land's merge commit); null elsewhere.
- `outcome`: null for `start` events; `"done"` / `"needs-human"` / `"skipped"` / `"error"` for `end` events, derived from the phase's own return value.
- `waitReason`: `"admission-contention"` for E1 when `_admissionVerdict.reclaimed === true`; null elsewhere.
- `resourceClaim`: `_admissionVerdict.lease?.fencingToken` for E1 (line 320); null elsewhere.
- `observedWrites`: file paths from `git diff --name-only` post-stage vs pre-stage -- populated at Build end and Land end; empty array elsewhere.
- `isolationMode`: `"worktree"` when `_useWorktree === true`; null otherwise.
- `dispatchMode`: `"concurrent"` when `IS_CONCURRENT === true` (line 917); `"serial"` otherwise; null for E1.
- `observedDurationMs`: `eventObj.timing.endedAtMs - eventObj.timing.startedAtMs` (computed at the end-event call site); null for start events.
- `errorDetail`: the error message string on `outcome: "error"` or `outcome: "needs-human"`; null on success.

All field values are derived from in-scope variables already present at the `_emitStageEvent` call site -- NO new agent dispatches, file reads, or git commands are introduced to compute event fields beyond what the phase already does.

### Event emission control flow

```
workflow-event-schema.mjs (A1a's schema module)
   |
   |  invoked via: node --no-warnings --experimental-strip-types
   |  experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs
   |  --emit-event '<json>'
   |
   |  +------------------+              +------------------+
   |  | prepare-         |              | execute-         |
   |  | milestone.js     |              | milestone.js     |
   |  |                  |              |                  |
   |  | _emitStageEvent-->              | _emitStageEvent-->
   |  |                  |              |                  |
   |  | E1 Admission     |              | E2 Verify        |
   |  |  (line 164)      |              |  (line 66)       |
   |  |  start @320      |              | E3 Prepared      |
   |  |  end @terminal   |              |  (line 234)      |
   |  |  returns          |              | E4 Build         |
   |  |                  |              |  (line 389)      |
   |  |                  |              | E5 Audit         |
   |  |                  |              |  (line 719)      |
   |  |                  |              | E6 Gate          |
   |  |                  |              |  (line 817)      |
   |  |                  |              | E7 Reconcile     |
   |  |                  |              |  (line 919)      |
   |  +------------------+              | E8 Land          |
   |                                    |  (line 961)      |
   |                                    +------------------+
   |
   v
  experiments/quay-perpetual-stream/.workflow-events/
    <runId>.jsonl        (gitignored, append-only, one JSON line per event)
```

### runId derivation

A `const _runId` variable is computed ONCE at the top of each workflow file:

- In `execute-milestone.js`: `_runId = 'M' + _milestone` (the `_milestone` is already extracted from `$a.charterFile` by the regex at line 81).
- In `prepare-milestone.js`: `_runId = 'prepare-' + _milestoneId` (where `_milestoneId` is from `$a.milestoneId` at line 60, e.g. `M249`).

This keeps event log files per-milestone-scoped: `.workflow-events/M<NN>.jsonl` for execute runs and `.workflow-events/prepare-M<NN>.jsonl` for prepare runs. Separate files prevent interleaving between prepare and execute event streams.

### Event log storage

Per-run event log at `experiments/quay-perpetual-stream/.workflow-events/<runId>.jsonl`. A1a's `--emit-event` CLI mode on `workflow-event-schema.mjs` handles path resolution (finding the repo root via `QUAY_WORKSPACE_ROOT` env var or CWD walking), directory creation, and JSON-line append. The `.workflow-events/` directory is gitignored (added to `.gitignore` alongside `.quay/gate-events.jsonl` at line 26). This is intentionally separate from the git-committed `milestones/prepare-telemetry/` tree: workflow events are local observability artifacts, not committed provenance records.

### Key design decisions

**DD1: Workflow-JS-emitted, not agent-emitted.** The workflow DSL's `phase()` call sites and terminal return sites are the only places where every boundary is guaranteed to fire. Agent structured-output emission couples content agents to the observability contract and cannot guarantee emission: agents crash, return unparseable output, or skip the field entirely. The E1 (Prepare admission) boundary fires BEFORE any content agent is dispatched -- by construction, the workflow JS is the only emitter that can reach it (line 164 acquires the lease; ProposalAuthors dispatch at line 673 is the first content agent). This is the split review's blocking architectural finding.

**DD2: A1a schema module consumed via agent-dispatched CLI, not imported.** The workflow DSL has no `import` capability (lines 23-25 of `execute-milestone.js`). A1b invokes A1a's `workflow-event-schema.mjs` through the SAME `node --no-warnings --experimental-strip-types` CLI dispatch pattern used by `_convergenceAgentCall()` and 5+ other modules in the installed workflows. Introducing an import mechanism would be a larger scope change than the observability boundary itself. A1b constructs valid event objects and passes them as JSON; A1a's module handles validation, path resolution, and append.

**DD3: Fire-and-forget, never a gate.** `_emitStageEvent` is observational-only with zero return-value coupling to stage dispatch, scheduling, or outcome. A failed emission (agent crash, JSON parse error, schema validation fail, disk full) is silently dropped. The event log is a best-effort observability channel, not a gate. The workflow's existing `_convergenceAgentCall` `--record-attempt` dispatch (M203) is the precedent: telemetry is additive, its return value is never parsed or branched on. A crashed agent that never reaches phase exit leaves the start event unmatched -- exactly the observability signal a crash produces.

**DD4: Start+end event pairs per boundary.** Each boundary emits two events: a `start` event (with `eventKind:'start'`, `timing.queuedAtMs` and `timing.startedAtMs`) at phase entry, and an `end` event (with `eventKind:'end'`, `endedAtMs`, `outcome`, `observedWrites`, `candidateCommit` where available) at phase exit. The start/end pair captures `queuedAtMs -> startedAtMs` timing (admission-contention or Land-lock wait time) as a separate metric from the phase's actual execution time. A single exit-only event would fold these together, losing the queue delay signal that DIR-124-E's resource-aware scheduling needs.

**DD5: Per-boundary, not per-dispatch-helper.** A1b instruments at each `phase()` call site and the corresponding terminal return/continuation sites. It does NOT instrument every `agent()` call within a phase -- that would produce a combinatorially large event stream and couple instrumentation to dispatch count (which varies per composite width, per cache-fingerprint hit, and per iteration round). Per-boundary instrumentation is simpler, more auditable, and covers every boundary by construction rather than by convention.

**DD6: Byte-identical dual mirrors.** Both `.claude/workflows/` and `plugin/workflows/` copies of the workflow files receive identical `_emitStageEvent` instrumentation. The existing mirror-diff check (`diff` exit 0 at Land) is extended to cover the `_emitStageEvent` dispatch wrapper and call-site parity -- following the same pattern the `_normalizeExecuteArgsInline` / `_isolationPlan` inline mirrors already use (pinned by `execute-milestone-worktree.test.mjs`). Neither workflow file changes behavior -- both gain only additive `agent()` calls at the exact same positions.

**DD7: Pre-instrumentation baseline.** A real baseline run's phase sequence, agent count, and outcome is captured BEFORE the workflow files are edited. Golden replay proves instrumentation changes no stage order, agent count, outcome, shared-state mutation, or scheduling decision. This is the same "capture before editing" pattern used in `proposal-convergence.ts`'s M207 checkpoint mechanism.

**DD8: A1b does NOT define the schema.** A1a owns the canonical `workflow-event-schema.mjs` module. A1b constructs event objects conforming to A1a's `StageEvent` type and passes them to A1a's `--emit-event` CLI. A1b never duplicates, embeds, or re-exports any schema definition -- the schema module remains the single canonical home (A1a's scope). If A1a's field set evolves (e.g., DIR-124-B adds a `migrateDir124AEvent` adapter), A1b's call sites are updated to match (the AC "Both workflow mirrors byte-identical after instrumentation" ensures this).

**DD9: No interaction with existing telemetry.** A1b's event stream does not replace, extend, or couple with `_phaseTimings` / `proposal-convergence.ts` / `gate-events.jsonl`. Each system serves a different purpose, writes to a different path, and has a different schema. `_emitStageEvent` is called at workflow-DSL level; `_recordPhaseBoundary` is called at prepare-specific lease-renewal boundaries. No unification, no migration, no dual-write.

**DD10: Build-Evidence sub-phase is NOT a separate boundary.** The `phase('Build-Evidence')` call at line 501 of `execute-milestone.js` fires inside the Build phase, after `phase('Build')` at line 389 and before the Build end event. It is an internal sub-step of Build (a deterministic post-Build evidence collection), not a cross-workflow boundary. It is NOT instrumented as a separate event boundary -- it is covered by Build's start/end pair. The A1a schema's `VALID_STAGES` may include `'Build-Evidence'` for forward-compat; A1b does not narrow it, but emits no events for it.

**DD11: Single `_emitStageEvent` helper per workflow file.** Each workflow file gains one inline helper function (following `_normalizeExecuteArgsInline` for naming, `_convergenceAgentCall` for the `agent()`-wraps-a-CLI shape). Call sites reference this helper, not raw `agent()` calls -- a single definition point for the dispatch contract (label, phase, schema, shell-escaping).

### Defaults and failure behavior

**Normal path:** Each `phase()` call site fires a `start` event, and each terminal return/continuation site fires an `end` event, producing a complete event pair per phase per run. For E7 (Reconcile) when the dispatch is width-1 or lacks a manifest, the else-branch at line 957 emits start+end with `outcome:'skipped'` -- the event stream honestly reflects that no Reconcile work was performed while preserving event-log completeness.

**Emission failures:** `_emitStageEvent` wraps the agent dispatch but does not parse the result. The `workflow-event-schema.mjs --emit-event` CLI (A1a's scope) is fail-soft: JSON serialization failure, schema validation failure, missing `.workflow-events/` directory, disk full, permissions error -- all produce `console.error` to stderr but never throw, never exit non-zero. The per-event `agent()` call is fire-and-forget: a crashed `agent()` call is silently consumed (caught by the workflow DSL's own error handling for non-primary agent calls). The event log is a best-effort observability channel.

**Agent dispatch failure:** The `agent()` call inside `_emitStageEvent` may throw if the workflow DSL's error handling is invoked. Since the event dispatch is NOT the phase's primary agent call (it is a separate, additional `agent()` call before/after the phase's real work), a failed event dispatch never blocks the phase -- the phase's real agent call (Build, Audit, Gate, Land) is a separate dispatch on a separate code path.

**Missing runId:** If `_milestone` cannot be extracted (regex returns no match), the fallback `_runId` includes `M${_milestone}-${_primaryTaskId}-${Date.now()}` in execute and `prepare-${_milestoneId}-${Date.now()}` in prepare. The log filename is predictable and unique.

**Start event without end event:** If a phase crashes mid-execution (the workflow DSL or agent throws before reaching the end-event call site), the start event remains unmatched in the log. This is intentional -- an unmatched start event IS the observability signal of a mid-phase crash. No cleanup/finalizer is added.

**Worktree path:** `worktreePath` is populated from `_isolationPlan.worktreeRel` (line 103) when `_useWorktree === true`; null otherwise. `isolationMode` is `'worktree'` or null. No new derivation -- the existing `_isolationPlan` inline mirror already computes these values.

**Schema version mismatch:** If A1a's schema module evolves to v2 while A1b's call sites still pass v1-shaped objects, A1a's `validateEvent` pass fails and the event is dropped (stderr warning). This is safe: DIR-124-B will introduce v2 as an additive version in the same module, and A1b's AC item requiring byte-identical mirror updates ensures the dispatch-site JSON shapes track the schema.

No phase scheduling decision, lifecycle transition, gate pass/fail verdict, or dispatch routing reads or branches on any event-emission agent's return value or the event log's content.

### Compatibility

A1b is **strictly behavior-preserving** with respect to the installed workflows at HEAD (`923f563e`):

- **Phase order:** unchanged. Every `phase()` call and `return` site remains at the exact same line and the exact same control flow. Event-emission `agent()` dispatches are inserted IMMEDIATELY AFTER each `phase()` call and BEFORE any phase-specific logic, and IMMEDIATELY BEFORE each terminal `return` site.
- **Agent count:** the event-emission agents are ADDITIONAL dispatches (not replacements), so the raw agent count increases by exactly 2 per instrumented boundary in the common path (one start, one end). The pre-instrumentation baseline captures the before-state count; golden replay proves the delta is exactly the event-emission agents and nothing else.
- **Outcome:** unchanged. Every `return {outcome:...}` site produces the same value. No phase's outcome decision reads or branches on event-emission results.
- **Shared-state mutations:** unchanged. `_emitStageEvent` dispatches A1a's module, which writes only to the gitignored `.workflow-events/` directory -- it does not touch `tasks/`, `dashboard.md`, `milestone_counter`, `.quay/`, or the working tree. `git diff` before vs after an instrumented run shows zero delta outside `.workflow-events/`.
- **Scheduling decisions:** unchanged. No cache-fingerprint, verify-cache, prepared-receipt, build-plan, composite-manifest, or gate-vector decision reads event-emission output.
- **Concurrency:** unchanged. The event-emission agents follow the same dispatch model as the existing `_convergenceAgentCall` telemetry dispatches -- additive, never awaited-for-decision. The Land lock boundary is not affected.
- **Legacy single-task path:** byte-for-behavior unchanged. The `_emitStageEvent` helper is called unconditionally at each boundary, same as in the composite path.
- **Mirror parity:** preserved. Both `.claude/workflows/` and `plugin/workflows/` mirrors receive identical `_emitStageEvent` instrumentation; mirror-diff `diff` exits 0 at Land.

### Risks

**R1: Instrumentation perturbs behavior.** Adding 16 agent-dispatched CLI calls at phase boundaries could change timing or throughput. Mitigation: the pre-instrumentation baseline + golden replay proves zero delta in stage order, agent count, outcome, shared-state mutation, or scheduling. Each dispatch is fire-and-forget with an `emit-event-<boundary>` label that no routing or scheduling logic references.

**R2: Mirror drift.** A future edit to one workflow mirror that adds/modifies a `_emitStageEvent` dispatch without updating the other would produce incomplete event streams. Mitigation: the existing inline-mirror test pattern is extended to cover `_emitStageEvent` dispatch sites; the mirror-diff gate check already in the Gate phase's parallel array catches byte-level divergence at Land.

**R3: A1a schema module not yet available at instrumentation time.** A1b's `_emitStageEvent` helpers reference A1a's `workflow-event-schema.mjs` path. If A1a has not yet landed, A1b's test fixtures mock the schema module path. Mitigation: the test file uses a temporary, self-contained schema module stub under the same path pattern; the real A1a module is the integration target. The two children are independently landable but A1b's real-workflow proof requires A1a.

**R4: `Date.now()` capture at call site vs. actual event persistence time.** The `timing.startedAtMs`/`endedAtMs` values are captured at the workflow JS call site, but the actual JSON-line append happens later (after the `agent()` dispatch round-trips). For start events that fire immediately before a long-running phase agent, this is accurate. For end events, the `endedAtMs` captures the moment the workflow reached the terminal site -- which IS the honest phase-end time.

**R5: Event log disk growth.** Per-run JSONL files accumulate under `.workflow-events/`. Mitigation: gitignored (never committed); a single run is small (~16 events x ~600 bytes = ~10KB). The `cleanup_temp_files` MCP tool handles stale files.

**R6: `runId` collision.** Two concurrent runs of the same milestone could produce the same derived `runId`. Mitigation: the `M<NN>` / `prepare-M<NN>` pattern per-works them; the outer loop's dispatch framework provides a unique runId; the derived fallback includes `Date.now()` with millisecond precision. Concurrent dispatches are already serialized at the Land lock boundary for execute and at the Admission lease boundary for prepare.

**R7: Pre-instrumentation baseline capture is missed or incomplete.** If the workflow files are edited before the baseline run is captured, the zero-delta claim becomes unprovable. Mitigation: the baseline capture is an explicit, ordered step in the implementation sequence -- it must be completed BEFORE any workflow file edit, and its output is checked into the milestone directory as deliverable evidence.

### Non-goals

Explicitly excluded from A1b's scope:

1. Designing or implementing the A1a schema module (`workflow-event-schema.mjs`) -- A1a's scope.
2. Schema versioning or forward-migration design -- A1a's scope (the `SCHEMA_VERSION` export, `validateEvent`, `StageEvent` type, `--emit-event` CLI).
3. Schema validation logic -- A1a's scope (A1b passes event objects; A1a validates them).
4. Event log path resolution or directory creation -- A1a's scope (the `--emit-event` CLI mode handles repo-root resolution, `.workflow-events/` creation, and JSON-line append).
5. Instrumenting the remaining `prepare-milestone.js` phases (Preflight, ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, PlanCheck, Receipt) or the `Build-Evidence` sub-phase at line 501 -- A1b's scope is the 8 cross-workflow boundaries only. Internal prepare sub-phases are content-agent-mediated and their instrumentation belongs to a later child or to M207's existing `_phaseTimings` mechanism.
6. Stage scheduling or pipeline reordering (DIR-124-C's scope).
7. New lifecycle policy or gate addition (DIR-124-B's scope).
8. A second journal format (DIR-124-B must extend v1 via migration adapter).
9. Kernel extraction or control-plane refactoring (DIR-124-D's scope).
10. Resource-aware scheduling or lease management (DIR-124-E's scope).
11. Post-Land Wiring Audit introduction (DIR-118's scope).
12. Worktree redesign (DIR-123's mechanism is reused as-is; no changes to `milestone-worktree.ts`).
13. Inferring delivered value or changing pass/fail policy from event data (A5's scope).
14. Making worktree isolation the default (DIR-123's opt-in-then-prove posture).
15. Unifying with gate-events.jsonl or prepare-telemetry -- separate systems, separate purposes.
16. Adding `import` support to the workflow DSL -- the established `node --experimental-strip-types` CLI pattern is sufficient and proven.
17. Full replay corpus or baseline metrics (A2 and A5 are separate children; A1b provides the emission feeding their streams).
18. Instrumenting Build-Evidence as a separate boundary -- it is an internal sub-step of Build, not a cross-workflow boundary.

### AC coverage

| AC | Mechanism | Evidence |
|----|-----------|----------|
| All 8 stage boundaries emit events with valid schema | `_emitStageEvent` calls at each `phase()` site + terminal return sites, constructing event objects with all fields A1a's schema requires; A1a's `--emit-event` CLI validates and appends | Real event log file at `.workflow-events/<runId>.jsonl` post-instrumented run; grep for `_emitStageEvent` at the 8 boundary lines |
| Event log written to `.workflow-events/<runId>.jsonl` (gitignored) | A1a's `--emit-event` CLI handles path resolution and directory creation; `.gitignore` entry added | `.workflow-events/` directory exists after instrumented run; `git status` shows it as untracked; `.gitignore` contains `**/.workflow-events/` |
| Emission failure never blocks the workflow | `_emitStageEvent` is fire-and-forget -- result never parsed, never branched on; A1a's CLI never throws on failure | Test proves a missing directory/bad JSON/permission error does not change workflow outcome; grep confirms zero `if (_emitStageEvent` or `_emitStageEvent` result inspection sites |
| Both workflow mirrors byte-identical after instrumentation | Identical `_emitStageEvent` helper and call sites in both `.claude/workflows/` and `plugin/workflows/` copies | `diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` exit 0; same for prepare-milestone.js |
| Tests RED/GREEN proving emission at each boundary | Test module creates temp workspace with instrumented workflow stubs, dispatches a mock run through each boundary, asserts event count and field presence per boundary | Test file with per-boundary RED (pre-instrumentation: zero events) / GREEN (post-instrumentation: 16 events -- 2 per boundary) |
| No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease | A1b adds NO new gate clauses, NO new lifecycle statuses, NO changes to milestone-worktree.ts, NO scheduling decisions. Touches list confirms | grep for new clauses in it0-dod-check.ts, new statuses, worktree changes; `git diff --stat` at Land |

### Mechanism-claim wiring coverage (DIR-117)

Each new call/dispatch/ownership/enforcement relationship claimed below requires a matching AC item in the review phase to verify:

**WIRING-CLAIM (A1b-EMIT-HELPER):** `_emitStageEvent(eventObj)` is a single inline helper function added to each of the 4 workflow mirrors. It is the sole definition point for the event-dispatch contract within each file. No other function in either workflow file emits stage events.

**WIRING-CLAIM (A1b-BOUNDARIES):** `_emitStageEvent` is called at exactly 16 call sites across the 8 boundaries (one start + one end per boundary): E1 (2 calls in prepare-milestone.js at the post-acquire site and each terminal return), E2-E8 (14 calls in execute-milestone.js at the 7 phase-call sites and their terminal return/continuation sites). No other call site invokes `_emitStageEvent`.

**WIRING-CLAIM (A1b-FIRE-AND-FORGET):** No return value from any `_emitStageEvent` call is read, parsed, assigned to a variable (beyond `await`), or branched on. No phase dispatch, lifecycle transition, gate verdict, or scheduling decision reads event-emission output. The result is awaited only for ordering (the phase's real work must not race the event-emission dispatch), but the resolved value is discarded.

**WIRING-CLAIM (A1b-SCHEMA-CONSUMPTION):** The `workflow-event-schema.mjs` module is consumed ONLY via its `--emit-event '<json>'` CLI mode, dispatched through `agent()`. The workflow files embed ZERO schema definitions, field names, validation logic, or file-writing logic. The module is the single canonical home of the schema.

**WIRING-CLAIM (A1b-MIRROR-PARITY):** All 4 workflow mirrors receive byte-identical `_emitStageEvent` helper definitions and byte-identical call sites. Mirror parity is verifiable by `diff` at Land.

**WIRING-CLAIM (A1b-NO-BUILD-EVIDENCE):** Build-Evidence (`phase('Build-Evidence')` at execute-milestone.js line 501) is NOT instrumented -- no `_emitStageEvent` call appears between line 389 and line 719 other than at the Build-phase boundaries (E4 start at 389, E4 end at the build-completion return sites). This is verifiable by grep within the line range.

**WIRING-CLAIM (A1b-EVENT-LOG-PATH):** The event log is written to `<repoRoot>/experiments/quay-perpetual-stream/.workflow-events/<runId>.jsonl` by the schema module's `--emit-event` CLI. The path is gitignored. No other code writes to this directory.

**WIRING-CLAIM (A1b-RUNID-DERIVATION):** `runId` is `M<NN>` for execute stages (extracted from `$a.charterFile` via the existing `_milestone` regex at execute-milestone.js line 81) and `prepare-M<NN>` for prepare's Admission stage (extracted from `$a.milestoneId`). The exact same regex and extraction logic are used at every call site -- no second derivation path exists.

**WIRING-CLAIM (A1b-START-END-PAIRS):** Every boundary produces exactly one start event (eventKind: 'start', endedAtMs: null, outcome: null) and exactly one end event (eventKind: 'end', endedAtMs populated, outcome populated). The start event fires at phase entry (immediately after the `phase()` call or post-acquire confirmation); the end event fires at the phase's terminal return/continuation site. No boundary produces zero events or more than one pair.

**WIRING-CLAIM (A1b-AGENT-LABEL-CONVENTION):** Event-emission agent dispatches use the label convention `emit-event-<stage>-<eventKind>` (e.g., `emit-event-Verify-start`, `emit-event-Land-end`). This label is a naming convention for diagnostic visibility only -- NO routing, scheduling, caching, or gating logic references it. This is verifiable by grep for the label prefix in any scheduler/gate/cache code.

**WIRING-CLAIM (A1b-NO-TELEMETRY-INTERACTION):** `_emitStageEvent` does NOT call, extend, read from, or write to `_phaseTimings`, `_recordPhaseBoundary`, `_renewLease`, `_releaseLeaseAndRecord`, `_convergenceAgentCall`, or any gate-event-store path. The event stream and existing telemetry systems are completely disjoint in both code and data. This is verifiable by cross-reference grep: no function that touches `_phaseTimings` or `_convergenceScript` also touches `_emitStageEvent` or `workflow-event-schema`.

**WIRING-CLAIM (A1b-NO-COUPLING):** No phase scheduling decision, lifecycle transition, gate pass/fail verdict, or dispatch routing reads or branches on any event-emission agent's return value or the event log's content.

**WIRING-CLAIM (A1b-E1-ARCHITECTURAL):** E1 fires AFTER the `--acquire` verdict confirms `outcome === 'acquired'` (line 320) and BEFORE any content agent is dispatched -- this is the ARCHITECTURAL reason emission must be workflow-JS-based, not agent-based: at this point no content agent exists yet (ProposalAuthors at line 673, Adjudicate at line 711).

**WIRING-CLAIM (A1b-FIELD-DERIVATION):** All field values are derived from in-scope variables already present at the `_emitStageEvent` call site -- NO new agent dispatches, file reads, or git commands are introduced to compute event fields beyond what the phase already does. `timing.startedAtMs`/`endedAtMs` use `Date.now()` at the call site; `observedWrites` at Build/Land end events use `git diff --name-only` between the pre-phase and post-phase working tree state.

### Alternatives considered and rejected

[See original task body for alternatives analysis — unchanged by this reclassification.]

## Acceptance Criteria

- [x] **AC1:** `_emitStageEvent(eventObj)` helper function exists in all 4 workflow mirrors (byte-identical) — A1b-EMIT-HELPER
- [x] **AC2:** `_emitStageEvent` called at exactly 16 call sites (one start + one end per boundary × 8 boundaries) — A1b-BOUNDARIES
- [x] **AC3:** No return value from any `_emitStageEvent` call is read, parsed, or branched on — A1b-FIRE-AND-FORGET, A1b-NO-COUPLING
- [x] **AC4:** Schema consumed ONLY via `--emit-event '<json>'` CLI — zero schema definitions embedded in workflow files — A1b-SCHEMA-CONSUMPTION
- [x] **AC5:** Mirror parity verifiable by `diff` at Land — A1b-MIRROR-PARITY
- [x] **AC6:** E1 fires AFTER admission `--acquire` success and BEFORE any content agent dispatch — A1b-E1-ARCHITECTURAL
- [x] **AC7:** Every boundary produces exactly one start + one end event pair — A1b-START-END-PAIRS
- [x] **AC8:** Event log written to gitignored `.workflow-events/<runId>.jsonl` — A1b-EVENT-LOG-PATH
- [x] **AC9:** `runId` derived from existing `$a.charterFile`/`$a.milestoneId` — no second derivation path — A1b-RUNID-DERIVATION
- [x] **AC10:** Zero interaction with existing telemetry systems (`_phaseTimings`, `_convergenceScript`, gate-event-store) — A1b-NO-TELEMETRY-INTERACTION

## Definition of Done

Standard `inherited-core.md` DoD clauses apply. Per DIR-026 Reading A, source code and fixtures alone are necessary but insufficient.

- [ ] Tests pass: all 4 mirrors instrumented, byte-identical `_emitStageEvent`, correct boundary coverage, fire-and-forget semantics verified
- [ ] `diff` confirms byte-identical mirrors at Land
- [ ] Independent wiring audit confirms zero coupling to scheduling/gating/telemetry

## Touches

- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs
- plugin/scripts/workflow-event-schema.mjs

**Alt1: Agent structured-output emission.** Would require content agents to include a `stageEvent` field in their structured-output schema. Rejected for three reasons: (a) the Prepare admission boundary (E1) fires before any content agent exists -- no agent to emit through, so E1 would be unrepresentable; (b) agents can crash, return unparseable JSON, or skip the field entirely -- emission-by-construction is impossible to guarantee; (c) it couples all content agents to the observability contract, requiring every agent prompt template across both workflows to be updated and maintained. The split review's blocking finding explicitly identifies this as architecturally wrong.

**Alt2: Per-boundary raw `agent()` calls (no `_emitStageEvent` helper).** Each call site would inline the full JSON-stringify + shell-escape + agent-dispatch boilerplate. Rejected: a single helper function is the established pattern (`_normalizeExecuteArgsInline`, `_convergenceAgentCall`); inlining 16 copies of the same dispatch shape invites drift, complicates mirror-parity checking, and makes the single-definition-point contract untestable.

**Alt3: Instrumenting all prepare-milestone.js phases (not just Admission).** The other prepare phases (Preflight, ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, PlanCheck, Receipt) involve multi-round content-agent dispatch with N independent agents, delta continuation, and cross-generation resume. Their internal timing is already partially covered by M207's `_phaseTimings`. Rejected: scope is the 8 cross-workflow boundaries. Internal prepare sub-phases belong to a later child.

**Alt4: Embedding event-object construction logic in a shared helper file (not inline).** Extracting `_emitStageEvent` into a separate `.js` file and having both workflows reference it. Rejected: the workflow DSL has no `import` capability -- each workflow file must be self-contained. The inline pattern is already established by `_normalizeExecuteArgsInline` and `_isolationPlan` in `execute-milestone.js` and `_parseAgentJson` / `_convergenceAgentCall` / `_admissionAgentCall` / etc. in `prepare-milestone.js`.

**Alt5: Merging A1a and A1b into one child (schema + emission in a single deliverable).** Rejected per the split review's core finding: A1a and A1b are independently landable mechanisms. A1a provides the schema as an importable module; A1b consumes it at the 8 boundary call sites. Coupling them would break independent landability and make each harder to audit. The parent DIR-124-A1's ordered-child split form encodes this boundary explicitly.

**Alt6: Single-boundary event (no start/end pair).** Emit only one event per phase at exit. Rejected: the start/end pair captures `queuedAtMs -> startedAtMs` timing (the admission-contention or Land-lock wait time) as a separate metric from the phase's actual execution time. A single exit-only event folds these together, losing the queue delay signal that DIR-124-E's resource-aware scheduling needs.

**Alt7: Instrumenting Build-Evidence as a separate boundary.** Adding a 9th event pair for `phase('Build-Evidence')` at line 501. Rejected: Build-Evidence is an internal sub-step of Build -- a deterministic post-Build evidence collection that fires inside the Build phase. It is not a cross-workflow boundary. Instrumenting it separately would double-count Build and split a single logical phase's event stream. The A1a schema may include `Build-Evidence` in `VALID_STAGES` for forward-compat only.

**Alt8: Computing timing values via subprocess CLI (like M207).** Having the schema module's `--emit-event` CLI call `Date.now()` internally rather than receiving it from the workflow JS. Rejected: the M207 `_phaseTimings` pattern uses subprocess-computed clocks because it runs on lease-renewal boundaries where the renewal subprocess IS the clock authority. For stage events, the workflow JS's `Date.now()` at the call site is the honest event time -- a subprocess round-trip adds variable latency.

**Alt9: Adding the `.workflow-events/` path to committed storage.** Committing `.workflow-events/` would pollute the commit history with transient diagnostic data. Rejected: gitignored, following `.quay/gate-events.jsonl`'s pattern. Committed provenance belongs in `milestones/prepare-telemetry/` (a separate system).

**Alt10: Using the event stream as a gating mechanism.** Making a missing or malformed event block the phase or change dispatch outcome. Rejected: the event stream is observational-only. The gate engine already has its own immutable GateEvent append mechanism. Introducing a competing gate journal is explicitly the parent non-goal. Fire-and-forget is the correct semantics.

**Alt11: Deriving runId from agent output or session metadata.** Could parse the `runId` from the outer loop's dispatch metadata or an agent's structured output. Rejected: `_milestone` from `$a.charterFile` is already reliably extracted at execute-milestone.js line 81 and is the source of truth for milestone identity. A separate derivation path introduces identity-drift risk.