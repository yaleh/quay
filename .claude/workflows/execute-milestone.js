export const meta = {
  name: 'execute-milestone',
  description: 'Given a SELECTed milestone task, run the full execution pipeline: it0 checks → inner iteration build → adversarial audit → absorb gates → land. Replaces OUTER-LOOP.md steps 4–7 (DIR-067, 2026-07-24). Accepts both legacy {taskId,...} and DIR-119-B (M189) arbitrary-width {milestoneCandidate:{taskIds,...}, compositeManifestFile,...} argument shapes, normalized to one internal task array (never rejected on array length) — see composite-args.ts/composite-contracts.ts. Returns {outcome: "done"|"needs-human"|"building"} — "building" means a background task was dispatched; the caller polls and resumes.',
  phases: [
    { title: 'Verify', detail: 'Step 4 — run all 5 it0 systematic-explore checks + composite-preflight (DIR-119-B)' },
    { title: 'Prepared', detail: 'DIR-117-B/M195 — ENFORCED-BY-DEFAULT fail-closed Proposal/Plan preparation-receipt check before Build; a missing args.preparationReceiptFile returns {outcome:"revision-needed", reason:"preparation-receipt-missing", phase:"Prepared"} before Build (opt-in skip retired)' },
    { title: 'Build',  detail: 'Step 5 — class-route + dispatch inner iteration agent' },
    { title: 'Audit',  detail: 'Step 6 — adversarial fresh-context acceptance audit' },
    { title: 'Gate',   detail: 'Step 6 — all absorb-phase mechanical gate checks' },
    { title: 'Land',   detail: 'Step 6 merge + step 7 dashboard update + counter++' },
  ],
}

// DIR-114 (M175): Workflow tool sometimes delivers the `args` global as a JSON-encoded
// string rather than the parsed object its contract promises "verbatim" — normalize once,
// up front, and read everything through `$a` below (no bare `args` field access past this point).
const $a = (typeof args === 'string') ? JSON.parse(args) : args

// DIR-119-B (M189) Stage 2.1: accept BOTH the legacy `{taskId, charterFile, absorbEntryFile}`
// shape AND the new `{milestoneCandidate:{taskIds,...}, compositeManifestFile,...}` shape,
// normalized to one non-empty internal task array. This inline mirror exists because workflow
// DSL scripts have no `import` capability (only phase/agent/parallel/log/args globals) — the
// CANONICAL, unit-tested logic lives in composite-args.ts; the Verify-phase 'composite-preflight'
// check below re-runs that SAME canonical logic server-side as the authoritative check. This
// inline copy exists only to compute `_taskIds`/`_primaryTaskId` for prompt interpolation and to
// fail fast before any agent dispatch. NEVER reject on array length — 1, 3, 5, 10, or wider are
// all equally valid (Done-when clause 1).
function _normalizeExecuteArgsInline(raw) {
  const hasLegacy = typeof raw.taskId === 'string' && raw.taskId.length > 0
  const hasNew = raw.milestoneCandidate != null && typeof raw.milestoneCandidate === 'object'
  if (!hasLegacy && !hasNew) return { error: 'missing-task-identity' }
  if (hasLegacy && hasNew) {
    const candIds = Array.isArray(raw.milestoneCandidate.taskIds) ? raw.milestoneCandidate.taskIds : []
    const agrees = candIds.length === 1 && candIds[0] === raw.taskId
    if (!agrees) return { error: 'conflicting-legacy-and-new-args' }
  }
  if (hasNew) {
    const taskIds = raw.milestoneCandidate.taskIds
    if (!Array.isArray(taskIds) || taskIds.length === 0) return { error: 'empty-task-array' }
    for (const id of taskIds) if (typeof id !== 'string' || id.length === 0) return { error: 'invalid-task-id' }
    if (new Set(taskIds).size !== taskIds.length) return { error: 'duplicate-task-id' }
    return { taskIds, isComposite: true }
  }
  return { taskIds: [raw.taskId], isComposite: false }
}
const _normResult = _normalizeExecuteArgsInline($a)
if (_normResult.error) {
  return { outcome: 'needs-human', reason: `arg-normalization-failed: ${_normResult.error}`, phase: 'Verify' }
}
const _taskIds = _normResult.taskIds
const _isComposite = _normResult.isComposite
// `_primaryTaskId` is IDENTICAL to the legacy `$a.taskId` for every pre-existing single-task
// call (golden replay preserved); for a genuine composite call it is the first member — the
// rest of this first implementation's Build/Audit/Gate/Land prompts stay conservatively
// single-lead-oriented per the milestone's own scope note ("first implementation MAY serialize
// all phases through one Build lead"), while the composite-preflight check + composite-*.ts
// modules already carry the arbitrary-width CONTRACT. Real multi-task operational proof is
// DIR-119-C's job, not self-certified here.
const _primaryTaskId = _taskIds[0]
if (_isComposite) {
  log(`Composite call: ${_taskIds.length} member tasks [${_taskIds.join(', ')}] — this first implementation drives Build/Audit/Gate/Land through the primary task ${_primaryTaskId}; full membership is threaded through for evidence/Land marking.`)
}

// ── Phase: Verify (step 4) ──────────────────────────────────────────────────────────
phase('Verify')

// DIR-079 (M156): Per-check incremental caching.
// Input fingerprints are pre-computed by the caller (workflow runtime lacks readFile/sha256)
// and passed via the args global. Prior results are passed the same way for cache comparison.
// The 4 mechanical checks are split into per-check agents so each can be independently
// cached. When a check's fingerprint matches a prior cached result, the agent is skipped.
// No fingerprints → fall back to full dispatch (conservative).
// Cache updates are returned in verifyCacheUpdates for the caller to persist across
// invocations.

const cacheFingerprints = $a.cacheFingerprints || {}
const priorVerifyCache = $a.priorVerifyCache || {}

// Extract milestone number for script invocations
const _milestone = ($a.charterFile.match(/M(\d+)/) || [])[1] || '<extracted-from-charter>'

// ── Per-check cache lookup ──
function _cached(label) {
  const fp = cacheFingerprints[label]
  if (!fp) return null
  const prior = priorVerifyCache[label]
  if (!prior || prior.fingerprint !== fp) return null
  log(`Verify cache HIT: ${label} (prior=${prior.result.ok ? 'PASS' : 'FAIL'})`)
  return prior.result
}

const _cachedCeiling      = _cached('ceiling-check')
const _cachedGateHash      = _cached('gate-hash')
const _cachedLineBudget    = _cached('line-budget')
const _cachedDogfood       = _cached('dogfood-evidence')
const _cachedDomainMisfit  = _cached('domain-misfit')
const _cachedComposite     = _cached('composite-preflight')

// DIR-119-B (M189): JSON-encode $a once for the composite-preflight check's --args-json,
// shell-escaped for single-quote embedding.
const _argsJsonEscaped = JSON.stringify($a).replace(/'/g, `'\\''`)

// Schema for mechanical check results
const MECH_SCHEMA = { type: 'object', required: ['check', 'ok'], properties: {
  check: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' }, source: { type: 'string' },
} }

// ── Dispatch only checks that need fresh execution ──
// Each mechanical check is a separate agent so caching can skip individual checks.
// Cache-hit entries are null and filtered out before parallel dispatch.
const _dispatchList = [
  !_cachedCeiling      ? () => agent(
    `FIRST extract gap-XXX-style IDs from the charter's ## Scope and ## Done-when sections (e.g. UQ-042). Skip IDs in the **Task:** header. Skip DIR-NNN IDs entirely — directives are TASK-CANONICAL (DIR-028: the single source of truth is tasks/DIR-NNN.md's own status/dirStatus field, already verified when the charter was authored), not tracked in experiments/quay-continuous-bootstrap/gap-list.md, so it0-ceiling-check.sh (which only greps that legacy gap-list) cannot resolve them and a DIR-NNN citation must never be passed to it. Likewise skip any extracted ID for which a real task file exists at tasks/<id>.md — task-canonical gap-<slug> tasks (e.g. gap-config-wiring-check-symlink-noop) are the SAME TASK-CANONICAL class as DIR-NNN (their own status field is authoritative, they are not legacy gap-list.md rows, and it0-ceiling-check.sh structurally cannot resolve them either); check with a real \`test -f tasks/<id>.md\` before passing any ID to the script. If NO IDs remain after both skips (directive-only, task-canonical-gap-only, or gap-list-irrelevant charter): return {check:"ceiling-check",ok:true,detail:"vacuous — no legacy gap-list IDs in charter Scope/Done-when (DIR-NNN and task-canonical gap-<slug> citations, if any, are TASK-CANONICAL and out of this check's scope)",source:"script"}. If legacy gap-list IDs remain after both skips: run bash experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh --milestone ${_milestone} <id1> <id2> ... and return {check:"ceiling-check",ok:<exit===0>,detail:"<stdout last 2000 chars>",source:"script"}.`,
    { label: 'ceiling-check', schema: MECH_SCHEMA }
  ) : null,
  !_cachedGateHash      ? () => agent(
    `Run: bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference ${$a.charterFile}. Non-zero=GATE-HASH-REF mismatch; zero=hash matches. Return {check:"gate-hash",ok:<exit===0>,detail:"<stdout>",source:"script"}.`,
    { label: 'gate-hash', schema: MECH_SCHEMA }
  ) : null,
  !_cachedLineBudget    ? () => agent(
    `Run: bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh ${$a.charterFile}. Non-zero=exceeds line budget; zero=within budget. Return {check:"line-budget",ok:<exit===0>,detail:"<stdout>",source:"script"}.`,
    { label: 'line-budget', schema: MECH_SCHEMA }
  ) : null,
  !_cachedDogfood       ? () => agent(
    `Run: bash experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh --milestone ${_milestone} ${$a.charterFile}. Non-zero=evidence-gap; zero=all claimed clauses have nearby fenced evidence. Return {check:"dogfood-evidence",ok:<exit===0>,detail:"<stdout>",source:"script"}.`,
    { label: 'dogfood-evidence', schema: MECH_SCHEMA }
  ) : null,
  !_cachedDomainMisfit  ? () => agent(
    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task ${_primaryTaskId}'s Done-when list (charter: ${$a.charterFile}). Return {ok: true, step3conclusion} — ok indicates the check completed (always true when the procedure was applied); step3conclusion records whether a misfit was found. This check is INFORMATIONAL, never blocking.`,
    { label: 'domain-misfit', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, step3conclusion: { type: 'string' } } } }
  ) : null,
  !_cachedComposite     ? () => agent(
    `Run: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-preflight.ts --args-json '${_argsJsonEscaped}'. This is DIR-119-B's (M189) Stage 2.1/2.2 mechanical check: it re-validates argument normalization (legacy {taskId,...} OR new {milestoneCandidate:{taskIds,...}, compositeManifestFile,...} — NEVER rejected on task-array length) and, ONLY when a compositeManifestFile is present, the composite contract (membership/AC-phase-audit coverage/acyclic phase DAG/union touches+semantic-resources/forbidden-temporal-edge exclusion/capacity/atomic Land). A legacy single-task call or a new-shape call with no manifest file is a VACUOUS PASS (golden replay for the pre-existing path is unaffected). Non-zero exit = normalization or contract failure — paste the JSON stdout. Return {check:"composite-preflight",ok:<exit===0>,detail:"<stdout>",source:"script"}.`,
    { label: 'composite-preflight', schema: MECH_SCHEMA }
  ) : null,
].filter(Boolean)

// ── Dispatch fresh agents in parallel (skip if all cached) ──
const _freshResults = _dispatchList.length > 0 ? await parallel(_dispatchList) : []

// Index fresh results by label
const _fresh = {}
for (const r of _freshResults) {
  if (!r) continue
  if (r.check) {
    _fresh[r.check] = r           // mechanical checks include 'check' field
  } else {
    _fresh['domain-misfit'] = r   // domain-misfit returns {ok, step3conclusion}
  }
}

// ── Unify result from any source (cached or fresh) ──
const _ceiling   = _cachedCeiling   || _fresh['ceiling-check']
const _gateHash  = _cachedGateHash  || _fresh['gate-hash']
const _lineBgt   = _cachedLineBudget|| _fresh['line-budget']
const _dogfood   = _cachedDogfood   || _fresh['dogfood-evidence']
const _composite = _cachedComposite || _fresh['composite-preflight']

// Domain-misfit: transform raw agent result to unified shape (handles both cached and fresh)
function _unifyDm(raw) {
  if (!raw) return null
  if (raw.check) return raw  // Already in unified shape (from cache)
  return { check: 'domain-misfit', ok: raw.ok !== false, detail: raw.step3conclusion || '', source: 'agent' }
}
const _dmEntry = _unifyDm(_cachedDomainMisfit) || _unifyDm(_fresh['domain-misfit'])

const allVerifyResults = [_ceiling, _gateHash, _lineBgt, _dogfood, _dmEntry, _composite].filter(Boolean)

// ── Build cache updates for caller to persist across invocations ──
let verifyCacheUpdates = {}
for (const r of allVerifyResults) {
  const fp = cacheFingerprints[r.check]
  if (fp) verifyCacheUpdates[r.check] = { fingerprint: fp, result: r }
}

// A null/missing result for an uncached check means the agent crashed — treat as failure (fail-closed).
const scriptCount = [_ceiling, _gateHash, _lineBgt, _dogfood, _composite].filter(Boolean).length
const verifyFailed = allVerifyResults.length < 6 || allVerifyResults.some(c => !c.ok)
if (verifyFailed) {
  log(`Verify phase FAILED — ${allVerifyResults.filter(c => !c.ok).map(c => c.check).join(', ')} did not pass. Journal: ${JSON.stringify(allVerifyResults)}`)
  return { outcome: 'needs-human', reason: 'it0-checks-failed', phase: 'Verify', verifyJournal: allVerifyResults, verifyCacheUpdates }
}
log(`Verify phase PASSED — all ${allVerifyResults.length} it0 checks green (${scriptCount} script + ${_dmEntry ? 1 : 0} agent).`)

// ── Phase: Prepared (DIR-117/M191; ENFORCED-BY-DEFAULT since DIR-117-B/M195) ─────────
// Fail-closed pre-Build gate on the Proposal→Plan preparation receipt (milestone-preparation-
// check.ts). ENFORCED: every dispatch must supply `$a.preparationReceiptFile`. A MISSING receipt
// fails closed before Build with `{outcome:"revision-needed", reason:"preparation-receipt-missing",
// phase:"Prepared"}` — the same return shape a stale/failed receipt produces, with a distinct
// reason code (a caller-fixable shape error, NOT a human-decision terminal; `needs-human` is
// reserved for split/budget exhaustion). The pre-DIR-117-B opt-in skip (else-branch logging
// "Prepared phase SKIPPED") is RETIRED — proven on M195's own real run (milestones/M195/
// preparation.json + docs/plans/M195-dir-117-b.md) and its post-flip negative control
// (milestones/M195/negative-control/). OUTER-LOOP's `prepare(c)` step produces a receipt for every
// legitimate dispatch; a receipt-less dispatch is now always a caller bug, never a supported shape.
phase('Prepared')
if (!$a.preparationReceiptFile) {
  log(`Prepared phase FAILED — preparation-receipt-missing: no preparationReceiptFile supplied (enforced-by-default since DIR-117-B/M195; the pre-DIR-117-B opt-in skip is retired).`)
  return { outcome: 'revision-needed', reason: 'preparation-receipt-missing', phase: 'Prepared', verifyCacheUpdates }
}
// DIR-117 iteration-2 item 5 / AC8's own 5th named condition ("a Plan whose touch set exceeds
// the declaration"): OPTIONAL `$a.declaredTouches` (an array of paths) makes the `touches-
// expanded` trigger reachable through a DIRECT execute-milestone invocation, not only via the
// batch scheduler's own re-assembly loop. Omitted (every pre-existing dispatch) → the exact
// original single-line prompt, byte-for-behavior unchanged (golden replay).
const _hasDeclaredTouches = Array.isArray($a.declaredTouches) && $a.declaredTouches.length > 0
const _declaredTouchesPath = `/tmp/prepared-declared-touches-${_milestone}-${_primaryTaskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`
const preparedPrompt = _hasDeclaredTouches
  ? `First write the task/charter's currently-declared '## Touches' set (one path per line, exactly as declared) to ${_declaredTouchesPath}:
${$a.declaredTouches.join('\n')}

Then run: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --task tasks/${_primaryTaskId}.md --charter ${$a.charterFile} --receipt ${$a.preparationReceiptFile} --declared-touches ${_declaredTouchesPath}
Return {ok: <exit code === 0>, code: <the PASS:/FAIL: code printed>, detail: <the full line printed>}.`
  : `Run: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --task tasks/${_primaryTaskId}.md --charter ${$a.charterFile} --receipt ${$a.preparationReceiptFile}
Return {ok: <exit code === 0>, code: <the PASS:/FAIL: code printed>, detail: <the full line printed>}.`
const preparedResult = await agent(
  preparedPrompt,
  { label: 'preparation-check', phase: 'Prepared',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, code: { type: 'string' }, detail: { type: 'string' } } } }
)
if (!preparedResult || preparedResult.ok !== true) {
  log(`Prepared phase FAILED — ${preparedResult?.code || 'no-result'}: ${preparedResult?.detail || '(agent returned nothing)'}`)
  return { outcome: 'revision-needed', reason: preparedResult?.code || 'preparation-check-failed', phase: 'Prepared', verifyCacheUpdates }
}
log(`Prepared phase PASSED — ${preparedResult.code}: ${preparedResult.detail}`)

// ── Composite per-phase DAG dispatcher (DIR-119-D2 / M210) ───────────────────────────
// Replaces the single monolithic composite Build agent with a REAL phase-DAG dispatch:
//   build-plan  → one helper agent runs composite-build.ts --plan-json (a PURE WRAP of the exported
//                 planPhaseExecution) against the DIR-119-D1-synthesized manifest and returns the
//                 PhaseExecutionPlan ({batches, owners, agentCount}) plus per-phase scoping descriptors;
//   build-phase-<id> → per batch, parallel() over exactly ONE labeled agent per phase, each prompt
//                 scoped ONLY to that phase's task IDs / predecessor phases / invariant / allowed
//                 Touches / evidence schema (AC4). Batches run SERIALLY — batch i+1's parallel() is
//                 invoked ONLY after every batch-i dispatch returns (AC3 requires-edge observance:
//                 PhaseExecutionPlan.batches' "batch i+1 only starts once batch i's phases finish");
//   build-integrate → one serial helper integrates in topological order, runs integration tests,
//                 creates the ONE candidate-generation commit (SOLE commit-creator — AC8), then runs
//                 composite-build.ts --map-evidence-json to map evidence back to tasks AND phases.
// maxParallelAgents bounds the planner's concurrent OWNER count (unit-tested, AC7), never the
// per-phase dispatch-label count — that always equals the phase count. Phase workers NEVER stage or
// commit. Fail-closed mid-batch: any non-done phase worker => needs-human immediately, no further
// batches, build-integrate does NOT run, no commit is created (partial changes left in place for
// Audit/Reconcile DIR-119-D3/D4 — NOT rolled back by this child; accepted-risk, see task Proposal).
async function _compositePhaseDagBuild() {
  const manifestFile = $a.compositeManifestFile
  const maxParallelAgents = $a.maxParallelAgents || 4
  if (!manifestFile) {
    return { outcome: 'needs-human', reason: 'composite-manifest-file-missing' }
  }

  // 1. build-plan (exactly once — AC5): run the --plan-json CLI (AC6 literal command) and read the
  //    manifest's per-phase descriptors so each build-phase prompt can be scoped to its own phase.
  const planResult = await agent(
    `You are the build-plan helper for a composite milestone Build (${_taskIds.length} member tasks: ${_taskIds.join(', ')}).
Run EXACTLY this command and capture its stdout:
  node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-build.ts --plan-json --phases ${manifestFile} --mode parallel --max-parallel-agents ${maxParallelAgents}
The stdout is a PhaseExecutionPlan JSON ({batches, owners, agentCount}) — a pure wrap of composite-build.ts's exported planPhaseExecution over the manifest's phases (batch i+1 only starts once batch i's phases finish).
Then Read the manifest file ${manifestFile} (a {manifest, context} envelope; phases live at .manifest.phases) and, for EACH phase, capture: id, taskIds, requires (predecessor phase ids), integrationInvariant (if present), and allowed Touches (the union of .context.taskTouches[t] for each t in the phase's taskIds; fall back to .manifest.touches if taskTouches is absent).
Return {plan: <the parsed PhaseExecutionPlan JSON>, phases: [{id, taskIds, requires, integrationInvariant, touches}]}.`,
    { label: 'build-plan', phase: 'Build',
      schema: { type: 'object', required: ['plan', 'phases'], properties: {
        plan: { type: 'object', required: ['batches'], properties: {
          batches: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          owners: { type: 'object' }, agentCount: { type: 'number' },
        } },
        phases: { type: 'array', items: { type: 'object', required: ['id', 'taskIds'], properties: {
          id: { type: 'string' }, taskIds: { type: 'array', items: { type: 'string' } },
          requires: { type: 'array', items: { type: 'string' } },
          integrationInvariant: { type: 'string' },
          touches: { type: 'array', items: { type: 'string' } },
        } } },
      } } }
  )
  if (!planResult || !planResult.plan || !Array.isArray(planResult.plan.batches)) {
    log('build-plan FAILED — no PhaseExecutionPlan returned; failing closed before any phase dispatch.')
    return { outcome: 'needs-human', reason: 'build-plan-failed' }
  }
  const phaseById = {}
  for (const p of (planResult.phases || [])) phaseById[p.id] = p
  const planPhases = planResult.plan.batches.flat()
  log(`build-plan complete: ${planResult.plan.batches.length} batch(es), ${planPhases.length} phase(s) [${planPhases.join(', ')}], planner agentCount=${planResult.plan.agentCount} (cap ${maxParallelAgents})`)

  // 2. Per-batch SERIAL dispatch (AC3 requires-edge observance). batch i+1 awaits batch i fully.
  for (let i = 0; i < planResult.plan.batches.length; i++) {
    const batch = planResult.plan.batches[i]
    log(`Dispatching Build batch ${i}: [${batch.join(', ')}]`)
    const batchResults = await parallel(batch.map((phaseId) => () => {
      const ph = phaseById[phaseId] || { id: phaseId, taskIds: [], requires: [], touches: [] }
      const prompt = `BUILD phase \`${phaseId}\` of a composite milestone (member tasks: ${_taskIds.join(', ')}). DO THE ACTUAL WORK — for THIS PHASE ONLY.

Charter file: ${$a.charterFile}

THIS PHASE'S SCOPE — touch NOTHING outside it (per-phase scoping, AC4):
- Phase id: ${phaseId}
- Task IDs (yours ALONE): ${(ph.taskIds || []).join(', ') || '(none declared)'}
- Predecessor phases (already completed; their output is in the working tree): ${(ph.requires || []).join(', ') || '(none)'}
${ph.integrationInvariant ? `- Integration invariant this shared phase upholds: ${ph.integrationInvariant}\n` : ''}- Allowed Touches (the ONLY paths you may edit): ${(ph.touches || []).join(', ') || '(see each task\'s ## Touches)'}

Implement the AC / Done-when items for task IDs ${(ph.taskIds || []).join(', ')} ONLY. Do NOT reference, re-implement, or edit any OTHER phase's task IDs or any Touches outside the allowed set above — that leak would defeat the proven-disjoint parallel-batch safety.
Do NOT run \`git add\` or \`git commit\` — phase workers NEVER stage or commit; the single candidate-generation commit is created later by build-integrate.

Evidence schema (report back per composite-build.ts's mapEvidenceToTasks shape): {phaseId, files, commits, tests}.
Return {phaseId: "${phaseId}", outcome: "done"|"needs-human", reason, files: ["..."], tests: ["..."]}.`
      return agent(prompt, { label: `build-phase-${phaseId}`, phase: 'Build',
        schema: { type: 'object', required: ['phaseId', 'outcome'], properties: {
          phaseId: { type: 'string' }, outcome: { type: 'string' }, reason: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          tests: { type: 'array', items: { type: 'string' } },
        } } })
    }))
    const returned = (batchResults || []).filter(Boolean)
    const failed = returned.find((r) => r.outcome !== 'done')
    if (failed || returned.length < batch.length) {
      const which = failed ? (failed.phaseId || failed.reason || 'unknown') : `batch-${i}-worker-crashed`
      log(`Build batch ${i} FAILED (${which}) — failing closed: no further batches, build-integrate will NOT run, NO commit created.`)
      return { outcome: 'needs-human', reason: `build-phase-failed:${which}` }
    }
    log(`Build batch ${i} complete: ${batch.length} phase(s) done.`)
  }

  // 3. build-integrate (exactly once — AC5): SOLE commit-creator (AC8) and the --map-evidence-json caller.
  const evidenceFile = `/tmp/composite-build-evidence-${_milestone}-${_primaryTaskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  const integrateResult = await agent(
    `You are the build-integrate helper for a composite milestone Build (${_taskIds.length} member tasks: ${_taskIds.join(', ')}). Every per-phase build-phase-<id> worker has completed and left its changes UNCOMMITTED in the shared working tree.

1. Integrate the per-phase changes in deterministic topological phase order and resolve any overlap.
2. Run the canonical integration suite: scripts/test.sh — confirm NO NEW failures (the 2 pre-existing plugin-packaging failures flagging tree-hygiene-check.sh are outside this milestone's touch set).
3. Create EXACTLY ONE candidate-generation commit covering all phase changes plus this milestone's iteration report (write it to <MILESTONE_ROOT>/iterations/iteration-0.md; resolve MILESTONE_ROOT via \`source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root ${_milestone}\`). You are the SOLE commit-creator — phase workers never committed.
4. Collect the phase evidence into a bare PhaseEvidence[] JSON file at ${evidenceFile} (each entry {phaseId, files, commits, tests}), then run EXACTLY:
  node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-build.ts --map-evidence-json --phases ${manifestFile} --evidence ${evidenceFile}
   Its stdout is TaskEvidenceReport[] JSON mapping files/commits/tests back to BOTH tasks and phases — fold it into the iteration report.

Charter: ${$a.charterFile}
Return {outcome: "done"|"needs-human", reason, mergeCommit: "<short-sha>", evidenceReport: "<the --map-evidence-json stdout, verbatim>"}.`,
    { label: 'build-integrate', phase: 'Build',
      schema: { type: 'object', required: ['outcome'], properties: {
        outcome: { type: 'string' }, reason: { type: 'string' },
        mergeCommit: { type: 'string' }, evidenceReport: { type: 'string' },
      } } }
  )
  if (!integrateResult || integrateResult.outcome !== 'done') {
    log(`build-integrate FAILED — ${integrateResult?.reason || 'no result'}; no candidate-generation commit created.`)
    return { outcome: 'needs-human', reason: integrateResult?.reason || 'build-integrate-failed' }
  }
  log(`build-integrate complete: mergeCommit=${integrateResult.mergeCommit}`)
  return { outcome: 'done', taskId: _primaryTaskId, iterationCount: 1, mergeCommit: integrateResult.mergeCommit }
}

// ── Phase: Build (step 5) ───────────────────────────────────────────────────────────
phase('Build')
// DIR-119-D2 (M210): the new per-phase DAG dispatcher fires IFF `_isComposite && _taskIds.length > 1`
// (branches on WIDTH, not _isComposite alone — the composite-shaped singleton falls through to the
// width-1 path). The single-agent prompt below stays BYTE-IDENTICAL and serves the width-1 path AND
// that singleton; the composite path routes around it via _compositePhaseDagBuild() — additive, not a
// rewrite (AC9 / guardrail G2).
const buildResult = (_isComposite && _taskIds.length > 1)
  ? await _compositePhaseDagBuild()
  : await agent(
    `BUILD the inner iteration for milestone task ${_primaryTaskId}. DO THE ACTUAL WORK — you are the build executor, not a dispatcher.

Charter file: ${$a.charterFile}
Absorb entry path: ${$a.absorbEntryFile}

1. PRE-FLIGHT: ensure extra.acceptance is set on the task via task_write:
   extra.acceptance = "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh ${_primaryTaskId} ${$a.charterFile} ${$a.absorbEntryFile}"

1a. BACKLOG-ROW SURFACE TAG (gap-absorb-entry-clause-disposition-sequencing / M180, it0-dod-check.ts
    clause7): read \`${$a.absorbEntryFile}\`'s \`## Backlog row\` pipe-delimited line. If it has NO
    \`surface:<label>\` token at all, add one now, chosen accurately from this milestone's real
    \`## Touches\` list: \`method-infra\`/\`docs\`/\`cross-cutting\`/\`packaging\` for a non-product-
    touching milestone, or \`cli\`/\`web-ui\`/\`provider-abi\`/\`mcp\` for a milestone that touches
    \`packages/quay*\` product code. Never fabricate — pick the label(s) that actually match the
    Touches list. If the row already carries an accurate \`surface:\` token, leave it as-is.

2. CLASS-ROUTE: This is a development-class task (capability-growth). Read the task body and charter, then implement each item in the Done-when list.${_isComposite ? `\n\n2a. COMPOSITE BUILD (DIR-119-B/M189, ${_taskIds.length} member tasks: ${_taskIds.join(', ')}): consume the checked phase DAG (composite-contracts.ts) rather than treating this as ${_taskIds.length} independent single-task builds — a shared/overlapping phase has exactly ONE owner (composite-build.ts's planPhaseExecution), and the first implementation MAY serialize all phases through you as the one Build lead if parallel dispatch is unavailable. Whatever you do, map files/commits/tests/evidence back to BOTH tasks AND phases in the iteration report (composite-build.ts's mapEvidenceToTasks shape) — task count must never be reported as 1:1 with agent count.` : ''}

3. IMPLEMENT: Make the actual code changes needed to satisfy all AC and Done-when clauses. For each:
   - Edit/create files as needed
   - Run tests to verify
   - Record what was done

   TIMEOUT DISCIPLINE (DIR-090): when using the Bash tool to run long-running commands:
   npm install, npm test, npm ci, node --test, npx, git clone, git fetch
   — you MUST pass timeout: 300000 (5 minutes) or higher. The Bash tool's default
   is 120s which is insufficient. If a test suite or install takes longer than 5m,
   raise the timeout further. Never run these commands with the Bash tool's implicit
   default timeout.

4. EVIDENCE: Write iteration report to <MILESTONE_ROOT>/iterations/iteration-0.md, where
   MILESTONE_ROOT is resolved via the ONE authoritative path-prefix rule
   (gap-build-phase-iteration-evidence-path-not-single-sourced — the SAME single-sourced resolver
   Audit/Land already use, never re-derived by hand): run \`source
   experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root
   ${_milestone}\` to get MILESTONE_ROOT.

5. COMMIT all changes with a descriptive message.

Return {taskId, outcome: "done", iterationCount, mergeCommit: "<short-sha>"} on success, or {outcome: "needs-human", reason} on failure.`,
    { phase: 'Build',
      schema: { type: 'object', required: ['outcome'], properties: {
        taskId: { type: 'string' }, outcome: { type: 'string' },
        iterationCount: { type: 'number' }, mergeCommit: { type: 'string' },
      } } }
  )

  // Build agent does the work directly — no background dispatch.
  log(`Build phase complete: outcome=${buildResult?.outcome}`)

  if (buildResult?.outcome !== 'done') {
    const reason = buildResult?.reason || (buildResult ? 'build-outcome-not-done' : 'build-agent-no-result')
    return { outcome: 'needs-human', reason, phase: 'Build', verifyCacheUpdates }
  }

// ── Phase: Audit (step 6 acceptance audit) ──────────────────────────────────────────
phase('Audit')
const auditResult = await agent(
  `ADVERSARIAL ACCEPTANCE AUDIT for milestone task ${_primaryTaskId}. FRESH CONTEXT — you have NOT seen the build.${_isComposite ? ` COMPOSITE CALL (DIR-119-B/M189): ${_taskIds.length} member tasks [${_taskIds.join(', ')}] — apply the same refute-first AC/DoD audit to EVERY member task's own file, not just ${_primaryTaskId} (step 1/1a below applies per-task). Beyond the per-task AC/DoD checklist write-back this shared audit agent already performs (unchanged, legacy behavior), it must never write absorb dispositions, dashboard entries, the milestone counter, or any lifecycle STATUS field for any member task — that mutation is Land's job below (composite-audit.ts's stricter shard-level read-only boundary is the target architecture once DIR-119-C wires a real per-shard dispatcher).` : ''}

CHARGE (refute-first stance):
1. AC SATISFACTION: read the task file tasks/${_primaryTaskId}.md's ## Acceptance Criteria.
   For EACH criterion, try to REFUTE that it is actually met — citing the concrete
   artifact/test output/diff, NOT the implementer's self-report. Any AC you cannot
   confirm → REFUTED.
1a. CHECKLIST WRITE-BACK (DIR-020): for each confirmed AC/DoD item, WRITE BACK to the
    task file ticking - [x] with evidence citation. Leave - [ ] for unconfirmed items.
2. DoD SATISFACTION: confirm the task's ## Definition of Done is satisfied.
2a. DISPOSITION APPEND (gap-absorb-entry-clause-disposition-sequencing / M180): BEFORE running the
    mechanical gate in step 3, append the following REAL (never fabricated) disposition lines to
    \`${$a.absorbEntryFile}\` — e.g. via \`cat >> ${$a.absorbEntryFile} <<'EOF' ... EOF\` — so
    clause1/clause2 of the mechanical gate find them already written instead of failing on "NO
    disposition statement found":
    (i) a line containing the phrase \`adversarial-audit disposition: <VERDICT>\` where <VERDICT> is
        the verdict you just determined from step 1 (NO REFUTATION FOUND / CONCERNS / REFUTED) —
        write it only AFTER you have actually reached that verdict, never before.
    (ii) run the SAME command the later Gate phase runs — \`bash
        experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter <current
        milestone_counter from experiments/quay-perpetual-stream/dashboard.md minus 1>
        experiments/quay-perpetual-stream/v-meta-ledger.md\` (read-only, cheap, safe to duplicate)
        — then append a line containing \`V_meta consolidation-lag: <verbatim reason/verdict text
        from that command's own output>\`. Copy the script's actual reason text; do not paraphrase
        or invent a "clear" result if the script did not say so.
3. MECHANICAL GATE: run experiments/quay-perpetual-stream/scripts/it0-dod-check.sh ${_primaryTaskId} ${$a.charterFile}
   ${$a.absorbEntryFile}. Non-zero exit = REFUTED by construction.
4. DEVIATION-LOG WRITE-BACK (DIR-017 Step 3 / M36): if you find a REFUTED or CONCERNS,
   write a deviation row to dashboard.md's "Homeostatic variables (DIR-017 Step 3)" table:
   (i) caught-by: machine — your OWN finding this same pass; (ii) caught-by: human — an
   ABSORB entry disclosure the outer loop already drafted (the audit transcribes it, does
   not originate it). Each row must carry level / caught-by / caught-at / description /
   status (open) / age (0). This is the SAME audit agent performing the write-back — no
   separate writer, no split timing.

Output to <MILESTONE_ROOT>/audits/iteration-0-acceptance-audit.md, where MILESTONE_ROOT is
resolved via the ONE authoritative path-prefix rule (gap-absorb-charter-audit-not-committed / M176,
root cause 3 — single-sourced, ADR-004): run \`source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root ${_milestone}\`
to get MILESTONE_ROOT. Never re-derive the milestones/ vs experiments/.../milestones/ boundary by
hand — that function is the only place the ">= 130" rule is allowed to live.
	4a. STAGE THE AUDIT FILE (DIR-M176): immediately after writing it, \`git add\` this audit file —
	    it must never be left untracked for Land to discover (that is exactly the gap M176 closes;
	    Land's own CAPTURE step is a mechanical backstop, not a substitute for staging it here).
	5. SESSION-ID (DIR-093): BEFORE writing the audit artifact, run \`echo \$CLAUDE_CODE_SESSION_ID\` to discover your REAL session ID (this is set by the harness and cannot be forged). Write \`**Audit session id:** <that-id>\` as the FIRST content line of the audit artifact (after the title). Return the discovered session ID as \`auditSessionId\` in your structured output.

	Return {verdict: 'NO REFUTATION FOUND'|'CONCERNS'|'REFUTED', detail, concernsDetail, auditSessionId}.`,
  { phase: 'Audit',
    schema: { type: 'object', required: ['verdict', 'auditSessionId'], properties: {
      verdict: { type: 'string' }, detail: { type: 'string' },
      auditSessionId: { type: 'string' },
    } } }
)
log(`Audit phase complete: verdict=${auditResult?.verdict}, sessionId=${auditResult?.auditSessionId}`)

// ── Session-ID pass-through (DIR-093 fix v2): pass audit session ID directly ─────────
// to Gate agents rather than relying on file write-back (which breaks because workflow
// agents don't share a writable /tmp/ with the outer loop).
const AUDIT_SESSION_ID = auditResult?.auditSessionId || null
if (AUDIT_SESSION_ID) {
  log(`Audit session ID captured for Gate phase: ${AUDIT_SESSION_ID}`)
} else {
  log('INFO: no auditSessionId returned from Audit phase — session-id not captured (audit-indep gate removed from Workflow per DIR-097, runs at fan-in ABSORB).')
}

// ── Phase: Gate (step 6 all mechanical checks) ──────────────────────────────────────
phase('Gate')
// DIR-119-B (M189) Stage 2.5: the task-scoped split-or-commit gate runs for EVERY member task
// (not just the primary) — for a legacy single-task call (_taskIds.length===1) this is
// byte-for-behavior identical to the pre-existing single gate call (same label, same command).
const _splitOrCommitGates = _taskIds.map((tid) => () => agent(
  `Run quay gate --gate split-or-commit ${tid}. Return {ok, detail}. Non-zero = SPLIT-OR-COMMIT violation (DIR-026: parent-done-iff-children, SELECT-split, child-link-symmetry, OR needs-human reason is in-project rather than external) → HARD BLOCK.`,
  { label: _isComposite ? `split-or-commit-${tid}` : 'split-or-commit', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } },
))
const gates = await parallel([
  () => agent(`Run vmeta-lag-check.sh --counter <extract current milestone_counter from experiments/quay-perpetual-stream/dashboard.md minus 1> experiments/quay-perpetual-stream/v-meta-ledger.md. This reads the V_meta ledger (NOT the absorb entry). Return {ok, detail}. Non-zero = ALARM → HARD BLOCK.`,
    { label: 'vmeta-lag', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run it0-dashboard-line-budget-check.sh. Return {ok, detail}. Non-zero = dashboard exceeds 1200-line cap → HARD BLOCK.`,
    { label: 'dash-budget', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run tree-hygiene-check.sh. Return {ok, detail}. Non-zero = un-gitignored scratch on master → HARD BLOCK.`,
    { label: 'tree', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run worktree-branch-hygiene-check.sh. Return {ok, detail}. Non-zero = orphaned milestone evidence → HARD BLOCK.`,
    { label: 'worktree', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  ..._splitOrCommitGates,
])

const gatesFailed = gates.filter(Boolean).some(g => !g.ok)
if (gatesFailed) {
  log('Gate phase FAILED — one or more mechanical gates did not pass. Marking needs-human.')
  await agent(
    `Mark task ${_primaryTaskId} needs-human. Record which gates failed and why in the ABSORB entry at ${$a.absorbEntryFile}. Gates: ${JSON.stringify(gates.filter(Boolean))}`,
    { label: 'mark-needs-human', phase: 'Land' }
  )
  return { outcome: 'needs-human', reason: 'gate-failed', phase: 'Gate', verifyCacheUpdates }
}
log(`Gate phase PASSED — all ${gates.filter(Boolean).length} mechanical gates green.`)

// ── Phase: Land (step 6 merge + step 7 dashboard) ────────────────────────────────────
phase('Land')
// CONCERNS verdict: recorded, non-blocking. Log it and proceed.
if (auditResult?.verdict === 'CONCERNS') {
  log(`Audit CONCERNS (non-blocking): ${auditResult?.concernsDetail || auditResult?.detail || 'see audit artifact'}`)
}

if (auditResult?.verdict === 'REFUTED') {
  log('Audit REFUTED — cannot land. Marking needs-human.')
  await agent(
    `Mark task ${_primaryTaskId} needs-human with reason: audit REFUTED — ${auditResult?.detail}. VERIFY the needs-human reason is EXTERNAL (outside project control: external service/resource/credential/dataset/upstream) — if it is an IN-PROJECT reason (architecture mismatch, complexity, scope, "too hard"), that is a SPLIT-OR-COMMIT violation (DIR-026/Clause 9). Record needs-human with the audited reason in the ABSORB entry.`,
    { label: 'mark-needs-human-refuted' }
  )
  return { outcome: 'needs-human', reason: 'audit-refuted', phase: 'Land', verifyCacheUpdates }
}

// DIR-119-B (M189) Stage 2.6: atomic-Land note threaded into both Land prompts below. For a
// legacy single-task call (_isComposite===false) this is empty — behavior is byte-for-behavior
// unchanged (golden replay). For a genuine composite call, instruct the agent to apply
// composite-land.ts's invariant: mark EVERY member task consistently, but still exactly ONE
// milestone_counter increment and ONE dashboard entry regardless of task count (never one
// increment/entry per task) — task-completion count is recorded separately from the counter.
const _compositeLandNote = _isComposite
  ? `\n\nCOMPOSITE LAND (DIR-119-B/M189, ${_taskIds.length} member tasks: ${_taskIds.join(', ')}): mark ALL of [${_taskIds.join(', ')}] status:done with their own Execution record write-back — NOT just ${_primaryTaskId}. Regardless of member count, this Land step still performs EXACTLY ONE milestone_counter increment and writes EXACTLY ONE dashboard log entry (composite-land.ts's atomic-Land invariant) — record task-completion count (${_taskIds.length}) separately in that one entry, never as N separate entries or N separate counter bumps.`
  : ''

const IS_CONCURRENT = $a.mode === 'concurrent'

// ── Post-Land split-or-commit check (gap-split-or-commit-not-continuously-checked) ──────────
// Runs the WHOLE-TASK-STORE scan (it0-split-or-commit-check.ts, DIR-026) AFTER Land's own
// lifecycle write-back (status: done etc.) has been applied and BEFORE this workflow may report
// outcome: 'done' — Land observes the state it just mutated, rather than relying only on the
// pre-mutation Gate-phase check above (which necessarily ran against the PRE-Land state and
// cannot see a violation Land's own write introduces — e.g. a parent marked done while an
// already-existing child stays open, the exact M192/M194 shape this gap was found from). NOT the
// single-task `quay gate --gate split-or-commit <id>` CLI form used in the Gate phase — the
// whole-store form, which is what actually catches a cross-task violation. A failure here returns
// a typed non-success terminal ({outcome:'needs-human'}); when DIR-124-B stage receipts land,
// this result belongs in the Land stage receipt — until then, the command identity/outcome/reason
// are recorded via log() below and in the returned journal field, both part of this workflow's
// deterministic output.
async function postLandSplitOrCommitCheck() {
  return agent(
    `Run the WHOLE-TASK-STORE split-or-commit scan to verify Land's own lifecycle write-back
(status/parent/children mutations for task ${$a.taskId}) did not introduce a PARENT-DONE-IFF-CHILDREN,
SELECT-SPLIT, or CHILD-LINK-SYMMETRY violation (DIR-026). Run exactly:
  bash plugin/scripts/it0-split-or-commit-check.sh .
from the repository root — the WHOLE-STORE form (bare "." workspace-root, scans every tasks/*.md),
NOT "quay gate --gate split-or-commit ${$a.taskId}" (which only checks one task and was already run,
against the PRE-Land state, earlier in this same workflow's Gate phase). Return
{ok: <exit code === 0>, detail: "<full stdout, or last 4000 chars if longer>"}.`,
    { phase: 'Land', label: 'post-land-split-or-commit',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }
  )
}

// ── Concurrent path (DIR-075/M142): defers shared-state writes to fan-in ──────────
if (IS_CONCURRENT) {
  const concurrentResult = await agent(
    `LAND (concurrent mode) the milestone for task ${_primaryTaskId}. IN CONCURRENT MODE:
   you are part of a multi-milestone batch — do NOT update milestone_counter or dashboard.md
   (those writes are deferred to the serial fan-in absorb step that follows).

1. MERGE the iteration worktree into master (DIR-027: loop runs on master directly).
   Any conflict → per-file resolution, both sides read, reconciliation note recorded.
   Never a blanket --ours/--theirs (DIR-013).
2. CAPTURE, mechanical + unconditional (gap-absorb-charter-audit-not-committed / M176 —
   NOT prose-conditional "if a non-primary iteration produced evidence"): resolve MILESTONE_ROOT
   via \`source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh &&
   gate_resolve_milestone_root ${_milestone}\` (the SAME single-sourced rule the Audit phase and
   it0-dogfood-evidence-gate.sh use — never re-derive the milestones/ path boundary by hand), THEN
   \`git add\` every currently-untracked file under \`$MILESTONE_ROOT/audits/\` and
   \`$MILESTONE_ROOT/iterations/\` regardless of which iteration/phase produced it. ALSO
   \`git add ${$a.charterFile}\` if it is still untracked (defense-in-depth: OUTER-LOOP.md's charter
   step should already have staged it at authoring time — this is the backstop, not the primary
   mechanism). Together this milestone's own charter+audit+iteration evidence lands in THIS commit
   series — no manual sweep needed afterward. THEN PRUNE (DIR-033): if a non-primary iteration ALSO
   produced evidence not on master, cherry-pick JUST that evidence file. Then git worktree remove +
   git branch -d the now-merged branches.
3. EXECUTION-PROVENANCE WRITE-BACK (M24): task_write to tasks/${_primaryTaskId}.md
   appending a ## Execution record section (milestone id, iteration count, realized Δv,
   merge commit SHA, one-line outcome summary) and setting status: done.
4. COMPUTE touchedFiles: run \`git diff --numstat <merge-base>..<build-branch>\` to get the
   actual files touched by this build. The merge-base is \`git merge-base origin/master HEAD\`
   or the commit recorded in the build result (${
     buildResult?.mergeCommit ? buildResult.mergeCommit : 'from Build phase'
   }). Collect the changed file paths (column 3 of numstat output) into a flat array.
5. DRAFT a one-line dashboard entry for this milestone: "m<NN> · ${_primaryTaskId} · Δv=<realized> ·
   audit=${auditResult?.verdict || 'NO REFUTATION FOUND'} · merge=<SHORT sha> · → milestones/<NN>/"${_compositeLandNote}

Charter: ${$a.charterFile}
Build outcome: ${JSON.stringify(buildResult)}
Audit verdict: ${auditResult?.verdict}

Return {taskId: "${_primaryTaskId}", outcome: "done", mergeCommit: "<40-char SHA>",
  touchedFiles: ["relative/path/to/file1.ts", ...],
  dashboardEntry: "<markdown block for serial-fanin-absorb.ts>"}.`,
    { phase: 'Land',
      schema: { type: 'object', required: ['outcome', 'mergeCommit', 'touchedFiles', 'dashboardEntry'], properties: {
        taskId: { type: 'string' }, outcome: { type: 'string' },
        mergeCommit: { type: 'string' },
        touchedFiles: { type: 'array', items: { type: 'string' } },
        dashboardEntry: { type: 'string' },
      } } }
  )
  const postLandCheck = await postLandSplitOrCommitCheck()
  if (!postLandCheck?.ok) {
    log(`Land post-mutation split-or-commit check FAILED (concurrent, gap-split-or-commit-not-continuously-checked) — ${postLandCheck?.detail || 'no detail'}`)
    return { outcome: 'needs-human', reason: 'post-land-split-or-commit-violation', phase: 'Land', postLandSplitOrCommit: postLandCheck, verifyCacheUpdates }
  }
  log(`Land post-mutation split-or-commit check PASSED (concurrent) — whole task store re-scanned after lifecycle writes, no violations.`)

  log(`Land phase complete (concurrent) — milestone ${_primaryTaskId} done, touched ${(concurrentResult?.touchedFiles || []).length} files.`)
  return { outcome: 'done', taskId: _primaryTaskId, taskIds: _taskIds, mergeCommit: concurrentResult?.mergeCommit,
    touchedFiles: concurrentResult?.touchedFiles, dashboardEntry: concurrentResult?.dashboardEntry, verifyCacheUpdates }
}

// ── Serial path (default): existing behavior unchanged — inline counter++ and dashboard ─
await agent(
  `LAND the milestone for task ${_primaryTaskId}.

1. MERGE the iteration worktree into master (DIR-027: loop runs on master directly).
   Any conflict → per-file resolution, both sides read, reconciliation note recorded.
   Never a blanket --ours/--theirs (DIR-013).
2. CAPTURE, mechanical + unconditional (gap-absorb-charter-audit-not-committed / M176 —
   NOT prose-conditional "if a non-primary iteration produced evidence"): resolve MILESTONE_ROOT
   via \`source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh &&
   gate_resolve_milestone_root ${_milestone}\` (the SAME single-sourced rule the Audit phase and
   it0-dogfood-evidence-gate.sh use — never re-derive the milestones/ path boundary by hand), THEN
   \`git add\` every currently-untracked file under \`$MILESTONE_ROOT/audits/\` and
   \`$MILESTONE_ROOT/iterations/\` regardless of which iteration/phase produced it. ALSO
   \`git add ${$a.charterFile}\` if it is still untracked (defense-in-depth: OUTER-LOOP.md's charter
   step should already have staged it at authoring time — this is the backstop, not the primary
   mechanism). Together this milestone's own charter+audit+iteration evidence lands in THIS commit
   series — no manual sweep needed afterward. THEN PRUNE (DIR-033): if a non-primary iteration ALSO
   produced evidence not on master, cherry-pick JUST that evidence file. Then git worktree remove +
   git branch -d the now-merged branches.
3. WRITE ABSORB log entry into dashboard.md's ## Log section (DIR-054 rolling-window
   format): m<NN> · <task-id> · Δv=<realized> · audit=<verdict> · merge=<sha> · → milestones/M<NN>/
4. UPDATE DASHBOARD (step 7): VT (sum weight·cov), slope (marginal Δv), ρ, charter-thickness,
   discovery-latency, calibration-error, V_meta consolidation lag, milestone_counter++
   (ONLY after all gates above cleared and master merge landed).
5. REGENERATE backlog.md/dashboard.md views via experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts.
6. RUN tree-hygiene-check.sh and worktree-branch-hygiene-check.sh one final time
   to confirm the close-out is clean. Paste results.
7. EXECUTION-PROVENANCE WRITE-BACK (M24): task_write to tasks/${_primaryTaskId}.md
   appending a ## Execution record section (milestone id, iteration count, realized Δv,
   merge commit SHA, one-line outcome summary) and setting status: done.
8. PHI CONSOLIDATION CHECK: if a prior adaptation was REUSED UNCHANGED by THIS
   (different-domain) milestone, consolidate it into inherited-core.md and retire
   its citation (§4.2).${_compositeLandNote}

Charter: ${$a.charterFile}
Absorb entry: ${$a.absorbEntryFile}
Build outcome: ${JSON.stringify(buildResult)}
Audit verdict: ${auditResult?.verdict}

Return {taskId, outcome: 'done', mergeCommit, milestoneCounter}.`,
  { phase: 'Land',
    schema: { type: 'object', required: ['outcome'], properties: {
      taskId: { type: 'string' }, outcome: { type: 'string' },
      mergeCommit: { type: 'string' }, milestoneCounter: { type: 'number' },
    } } }
)

const postLandCheck = await postLandSplitOrCommitCheck()
if (!postLandCheck?.ok) {
  log(`Land post-mutation split-or-commit check FAILED (gap-split-or-commit-not-continuously-checked) — ${postLandCheck?.detail || 'no detail'}`)
  return { outcome: 'needs-human', reason: 'post-land-split-or-commit-violation', phase: 'Land', postLandSplitOrCommit: postLandCheck, verifyCacheUpdates }
}
log(`Land post-mutation split-or-commit check PASSED — whole task store re-scanned after lifecycle writes, no violations.`)

log(`Land phase complete — milestone ${_primaryTaskId} done.`)
return { outcome: 'done', taskId: _primaryTaskId, taskIds: _taskIds, verifyCacheUpdates }
