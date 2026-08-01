export const meta = {
  name: 'execute-milestone',
  description: 'Given a SELECTed milestone task, run the full execution pipeline: it0 checks → inner iteration build → adversarial audit → absorb gates → land. Replaces OUTER-LOOP.md steps 4–7 (DIR-067, 2026-07-24). Accepts both legacy {taskId,...} and DIR-119-B (M189) arbitrary-width {milestoneCandidate:{taskIds,...}, compositeManifestFile,...} argument shapes, normalized to one internal task array (never rejected on array length) — see composite-args.ts/composite-contracts.ts. Returns {outcome: "done"|"needs-human"|"building"} — "building" means a background task was dispatched; the caller polls and resumes.',
  phases: [
    { title: 'Verify', detail: 'Step 4 — run all 5 it0 systematic-explore checks + composite-preflight (DIR-119-B)' },
    { title: 'Prepared', detail: 'DIR-117-B/M195 — ENFORCED-BY-DEFAULT fail-closed Proposal/Plan preparation-receipt check before Build; a missing args.preparationReceiptFile returns {outcome:"revision-needed", reason:"preparation-receipt-missing", phase:"Prepared"} before Build (opt-in skip retired)' },
    { title: 'Build',  detail: 'Step 5 — class-route + dispatch inner iteration agent' },
    { title: 'Audit',  detail: 'Step 6 — adversarial fresh-context acceptance audit' },
    { title: 'Gate',   detail: 'Step 6 — all absorb-phase mechanical gate checks' },
    { title: 'Reconcile', detail: 'DIR-119-D4/M212 — literal Reconcile phase between Gate and Land: sole success-path composite state writer (reconcile-apply), dispatched only for composite dispatches' },
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

// ── DIR-123: opt-in per-milestone git-worktree isolation ─────────────────────────────
// `$a.isolationMode: 'worktree'` routes Build/Audit/Gate through a REAL per-milestone worktree
// (created before Build via milestone-worktree.ts, merged back + removed at Land, which is the SOLE
// phase touching the shared checkout) so two file-disjoint execute-milestone dispatches can run
// genuinely concurrently. ANY mode other than the literal 'worktree' (including omitted) is
// byte-for-behavior the pre-DIR-123 direct-on-shared-tree path — golden replay, proven by
// execute-milestone-worktree.test.mjs, never asserted. The path/branch derivation below is the
// documented INLINE MIRROR of milestone-worktree.ts's pure computeIsolationPlan/milestoneRootRel (the
// workflow DSL has no import capability — the SAME mirror pattern composite-args.ts uses above); the
// Build/Land agents invoke milestone-worktree.ts's CLI for the REAL git operations, and the
// execute-milestone-worktree test pins this inline mirror against the .ts single-source so it cannot
// silently drift. Same opt-in-then-prove posture as DIR-117's Prepared phase: this does NOT force a
// permanent default switch.
const _isolationPlan = (() => {
  const mode = $a.isolationMode
  if (mode == null || mode === '') return { isolated: false }
  if (mode !== 'worktree') return { isolated: false, error: `unknown-isolation-mode: ${mode}` }
  const num = Number((_milestone.match(/\d+/) || [])[0])
  if (!Number.isFinite(num)) return { isolated: false, error: 'worktree-needs-numeric-milestone' }
  const root = num >= 130 ? `milestones/M${num}` : `experiments/quay-perpetual-stream/milestones/M${num}`
  return { isolated: true, milestoneNum: num, worktreeRel: `${root}/worktrees/iteration-0`, branch: `milestone/M${num}/iteration-0` }
})()
const _useWorktree = _isolationPlan.isolated === true
// A REQUESTED-but-unusable isolation FAILS CLOSED rather than silently building on the shared checkout
// — this covers BOTH `isolationMode:'worktree'` with no derivable numeric milestone AND any unknown
// non-empty mode (a caller typo like 'worktre' must not silently drop isolation and reopen the
// concurrent-collision risk). Silently falling back would defeat the whole point and is exactly the
// "smart fallback standing in for a hard check" anti-pattern. Omitted/empty mode → legacy (golden
// replay). Same return shape as the arg-normalization failure above (caller-fixable, surfaced at Verify).
if ($a.isolationMode != null && $a.isolationMode !== '' && !_useWorktree) {
  log(`Worktree isolation requested (isolationMode=${JSON.stringify($a.isolationMode)}) but unusable — ${_isolationPlan.error}. Failing closed (never silently falling back to the shared checkout).`)
  return { outcome: 'needs-human', reason: _isolationPlan.error, phase: 'Verify' }
}
if (_useWorktree) {
  log(`Worktree isolation ENABLED (DIR-123): Build/Audit/Gate operate in ${_isolationPlan.worktreeRel} (branch ${_isolationPlan.branch}); Land is the sole phase that merges back into the shared checkout.`)
}

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
// DIR-123: under worktree isolation, create the REAL per-milestone worktree BEFORE building, so every
// edit/test/commit below happens on the worktree branch, not the shared checkout. milestone-worktree.ts
// performs the real `git worktree add` (fail-closed on a pre-existing path/branch — a same-milestone
// double-dispatch is a collision the caller must see, never a silent reuse). Legacy (no isolation):
// this whole block is skipped — byte-for-behavior unchanged (golden replay). This runs BEFORE the
// composite/width-1 branch below so it applies to either Build route under worktree isolation.
if (_useWorktree) {
  const wtCreate = await agent(
    `Create the REAL per-milestone git worktree for milestone ${_milestone} BEFORE building (DIR-123 worktree isolation). From the repository root, run the --add command and parse the single JSON line it prints:
  node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-worktree.ts --add --workspace . --milestone ${_milestone}
This performs a real \`git worktree add ${_isolationPlan.worktreeRel} -b ${_isolationPlan.branch}\`.

THEN handle the outcome (DIR-123 review Obstacle 3 — recover from a PRIOR CRASHED dispatch of this SAME
milestone, which would otherwise strand the worktree and fail-closed forever):
 - outcome:"added" → done; report it.
 - outcome:"error" with code "worktree-path-exists" or "branch-exists" → a prior attempt may have crashed
   AFTER creating the worktree but BEFORE Land removed it. Run the idempotent cleaner:
     node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-worktree.ts --clean-stale --workspace . --milestone ${_milestone}
   It removes a stranded worktree+branch ONLY when that branch has ZERO commits ahead of master (i.e. the
   crashed attempt never built anything real — unambiguous because the path/branch are milestone-scoped).
     • outcome:"cleaned" → RETRY the --add command ONCE and report THAT result.
     • outcome:"has-commits" → DO NOT clean (that branch holds REAL work). Report {ok:false} with this
       detail so the workflow fails closed to needs-human for human reconciliation — never discard real work.
     • outcome:"nothing-to-clean" → report {ok:false} (unexpected state; fail closed).
 - any other outcome:"error" → report {ok:false} with the detail.

Return {ok: <final outcome === "added">, worktreeAbs: <worktreeAbs field if added>, branch: <branch field>, detail: <the full final JSON line>}.`,
    { label: 'worktree-create', phase: 'Build',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, worktreeAbs: { type: 'string' }, branch: { type: 'string' }, detail: { type: 'string' } } } }
  )
  if (!wtCreate || wtCreate.ok !== true) {
    log(`Worktree creation FAILED — ${wtCreate?.detail || 'agent returned nothing'}. Cannot build in isolation; failing closed (never silently falling back to the shared checkout). A "has-commits" detail means a prior crashed attempt left REAL work on ${_isolationPlan.branch} — reconcile it by hand, never discard it.`)
    return { outcome: 'needs-human', reason: 'worktree-create-failed', phase: 'Build', verifyCacheUpdates }
  }
  log(`Worktree created: ${_isolationPlan.worktreeRel} (branch ${_isolationPlan.branch}, abs=${wtCreate.worktreeAbs}). Build/Audit/Gate operate there; Land merges back.`)
}
// DIR-123: threaded into the Build prompt ONLY under worktree isolation ('' otherwise → the legacy
// prompt is byte-identical). Tells the build executor to do ALL editing/testing/committing inside the
// worktree on its branch, never the primary checkout.
const _buildIsolationNote = _useWorktree
  ? `\n\nWORKTREE ISOLATION (DIR-123): you are building inside the per-milestone git worktree at \`${_isolationPlan.worktreeRel}\` (branch \`${_isolationPlan.branch}\`), NOT the shared primary checkout. Do ALL editing, testing, \`git add\`, and \`git commit\` below from that worktree path (e.g. \`cd ${_isolationPlan.worktreeRel}\` first) so every commit lands on branch \`${_isolationPlan.branch}\`. Do NOT edit or commit anything in the primary checkout — Land is the ONLY phase that merges this branch back. Evidence files (iteration report, etc.) are written into the WORKTREE's copy of MILESTONE_ROOT.`
  : ''
// DIR-119-D2 (M210): the new per-phase DAG dispatcher fires IFF `_isComposite && _taskIds.length > 1`
// (branches on WIDTH, not _isComposite alone — the composite-shaped singleton falls through to the
// width-1 path). The single-agent prompt below stays BYTE-IDENTICAL for the LEGACY width-1 path (DIR-123's
// `_buildIsolationNote` is '' when no isolationMode) AND serves that singleton; the composite path routes
// around it via _compositePhaseDagBuild() — additive, not a rewrite (AC9 / guardrail G2).
const buildResult = (_isComposite && _taskIds.length > 1)
  ? await _compositePhaseDagBuild()
  : await agent(
    `BUILD the inner iteration for milestone task ${_primaryTaskId}. DO THE ACTUAL WORK — you are the build executor, not a dispatcher.

Charter file: ${$a.charterFile}
Absorb entry path: ${$a.absorbEntryFile}${_buildIsolationNote}

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

  // ── Phase: Build-Evidence (M238/gap-build-evidence-manifest-missing) ─────────────────
  // Deterministic post-Build evidence collection: runs build-evidence-collector.ts as a
  // mechanical shell command wrapped in a formulaic agent helper (workflow DSL necessity),
  // producing build-evidence-manifest.json under MILESTONE_ROOT for Audit consumption.
  // SINGLETON and COMPOSITE paths both reach here — only the input evidence source differs
  // (--per-phase-evidence for composite, --iteration-report for width-1).
  phase('Build-Evidence')
  const _evidenceCollectorWtPrefix = _useWorktree
    ? `cd ${_isolationPlan.worktreeRel} && `
    : ''
  const _milestoneRootCmd = `source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root ${_milestone}`
  const evidenceManifestFile = `\$(${_milestoneRootCmd})/build-evidence-manifest.json`
  const collectorCmd = [
    `${_evidenceCollectorWtPrefix}node --experimental-strip-types experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts`,
    `--build-result '${JSON.stringify(buildResult)}'`,
    `--milestone-root $(${_milestoneRootCmd})`,
    `--workspace .`,
    `--milestone-id M${_milestone}`,
    `--task-ids '${JSON.stringify(_taskIds)}'`,
    `--composite ${_isComposite ? 'true' : 'false'}`,
    `--attempt 1`,
    `--session-id "$(echo $CLAUDE_CODE_SESSION_ID)"`,
    `--output ${evidenceManifestFile}`,
  ]
  if (_isComposite && $a.compositeManifestFile) {
    collectorCmd.push(`--per-phase-evidence /tmp/composite-build-evidence-${_milestone}-${_primaryTaskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
  }
  const collectorResult = await agent(
    `You are a MECHANICAL helper — run EXACTLY the command below and capture its stdout.
Run:
${collectorCmd.join(' \\\n  ')}
Then Read the output file ${evidenceManifestFile} and confirm it is valid JSON with a "schemaVersion" field.
Return {ok: <exit===0>, manifestPath: "${evidenceManifestFile}", manifest: <the parsed JSON>}.`,
    { label: 'build-evidence-collector', phase: 'Build-Evidence',
      schema: { type: 'object', required: ['ok', 'manifestPath'], properties: {
        ok: { type: 'boolean' }, manifestPath: { type: 'string' },
        manifest: { type: 'object', required: ['schemaVersion'], properties: {
          schemaVersion: { type: 'string' },
        } } } } }
  )
  if (!collectorResult?.ok) {
    log(`Build-Evidence phase FAILED — collector returned ok=false.`)
    return { outcome: 'needs-human', reason: 'build-evidence-collector-failed', phase: 'Build-Evidence', verifyCacheUpdates }
  }
  log(`Build evidence manifest written: ${collectorResult.manifestPath}`)

// COMPOSITE-AUDIT-SHARD-PROMPT-BEGIN
// DIR-119-D3 (M211): fenced per-shard read-only Audit prompt template. Contains ONLY: refute-first
// AC/DoD inspection scoped to the shard's declared task IDs / AC indexes / integrated generation;
// the composite-audit.ts --snapshot before/after + --guard command chain; the typed return schema
// {beforeSnapshot, afterSnapshot, shardResult}; and the DIR-093 session-id capture. Structurally
// NO checklist-tick, NO absorb-disposition append, NO deviation-log row, NO dashboard / milestone
// counter / lifecycle-status writes — those mutations move entirely to Reconcile (DIR-119-D4's
// scope; explicit Non-goal here). A structural static grep asserts zero write-instruction language
// between these markers in both mirrors (not merely one run's clean tree).
function _compositeAuditShardPrompt(shard, candidateId, generation) {
  return `ADVERSARIAL READ-ONLY AUDIT SHARD \`${shard.id}\` (kind: ${shard.kind || 'ac'}) for a composite milestone Audit. FRESH CONTEXT — you have NOT seen the build.

YOU ARE MECHANICALLY READ-ONLY: the workflow itself diffs a \`git status\` snapshot of your before/after window and HARD-FAILS this shard as audit-shard-write-violation:${shard.id} on ANY filesystem delta, tracked or untracked. Do NOT create, modify, or delete ANY file anywhere inside the repository; do NOT run \`git add\` / \`git commit\` / \`git checkout\` / \`git stash\` or any other mutating command. Read-only commands only (Read, grep, git log/diff/show, scripts/test.sh, node --test). Scratch snapshot files go to /tmp ONLY (outside the repo).

THIS SHARD'S SCOPE — inspect NOTHING outside it:
- Shard id: ${shard.id}
- Task IDs (yours ALONE): ${(shard.taskIds || []).join(', ') || '(none declared)'}
- Integrated generation under audit: candidate ${candidateId}${generation ? `, generation commit ${generation}` : ''}

CHARGE (refute-first stance): for EACH task ID above (yours ALONE), read its own task file (tasks/<id>.md) ## Acceptance Criteria and ## Definition of Done. For EACH criterion, try to REFUTE that it is actually met — cite the concrete artifact/test output/diff, NOT the implementer's self-report. Any AC you cannot confirm → verdict REFUTED with evidence detail; confirmed → PASS with evidence citation. Shard verdict: REFUTED if any AC verdict is REFUTED; CONCERNS if none REFUTED but concerns exist; else PASS. Do NOT reference or re-audit any OTHER shard's task IDs — a scope leak defeats the per-shard boundary.

SNAPSHOT PROTOCOL (exact order; ALL inspection work happens INSIDE the before/after window):
1. BEFORE: run EXACTLY \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-audit.ts --snapshot\` and capture its stdout JSON {snapshot: [...]} — the array is your beforeSnapshot.
2. Perform all read-only inspection work for this shard.
3. AFTER: run the same \`composite-audit.ts --snapshot\` command again — the array is your afterSnapshot.
4. Write both arrays to /tmp/audit-shard-${shard.id}-before.json and /tmp/audit-shard-${shard.id}-after.json, then run EXACTLY \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-audit.ts --guard --shard-id ${shard.id} --before /tmp/audit-shard-${shard.id}-before.json --after /tmp/audit-shard-${shard.id}-after.json\` and capture its stdout JSON as guardResult. This guard is a recorded double-check ONLY — the workflow's own diff of your returned raw snapshots is the enforcement point and runs regardless of what you report here.

SESSION-ID (DIR-093): run \`echo \$CLAUDE_CODE_SESSION_ID\` and return the discovered id as auditSessionId.

Return {beforeSnapshot: [...], afterSnapshot: [...], shardResult: {shardId: "${shard.id}", verdicts: [{taskId, acIndex, verdict: 'PASS'|'REFUTED'|'CONCERNS', detail}], shardVerdict: 'PASS'|'REFUTED'|'CONCERNS'}, guardResult: {ok, ...}, auditSessionId}.`
}
// COMPOSITE-AUDIT-SHARD-PROMPT-END

// ── Composite per-shard read-only Audit dispatcher (DIR-119-D3 / M211) ─────────────
// Replaces the single monolithic composite Audit agent (which both audited AND wrote
// checklist/absorb/deviation state — the mutations the target architecture assigns to Reconcile)
// with REAL per-shard dispatch: audit-manifest-read (one mechanical agent returns the manifest's
// auditShards[]; the DSL cannot read files itself) → SERIALIZED audit-shard-<id> loop (plain
// for..of, deliberately NOT parallel() — concurrent snapshot windows would cross-attribute writes;
// single-driver discipline per CLAUDE.md) → exactly ONE audit-combine agent (distinct label from
// audit-shard-*) invoking composite-audit.ts --combine-json, i.e. the REAL exported
// combineShardVerdicts — never a workflow-side reimplementation.
// READ-ONLY ENFORCEMENT IS MECHANICAL, NOT SELF-REPORT: _diffAuditSnapshotLines below (an inline
// mirror of composite-audit.ts's diffGitSnapshots/guardShardReadOnly — the same documented pattern
// as _normalizeExecuteArgsInline, because workflow DSL scripts have no import capability) runs IN
// THIS WORKFLOW JS over the returned raw snapshot strings. ANY non-empty delta, tracked or
// untracked, hard-fails the shard as audit-shard-write-violation:<id> regardless of what the agent
// or its own --guard run claims. Trust-boundary limitation stated plainly: mechanical adjudication
// of returned command output within the existing agent/tool boundary, NOT a cryptographic
// attestation that an agent process cannot forge its own output — both raw snapshot arrays are
// retained in the shard's journaled typed return as the auditability backstop.
function _diffAuditSnapshotLines(before, after) {
  const bCounts = new Map()
  const aCounts = new Map()
  for (const line of (Array.isArray(before) ? before : [])) bCounts.set(line, (bCounts.get(line) || 0) + 1)
  for (const line of (Array.isArray(after) ? after : [])) aCounts.set(line, (aCounts.get(line) || 0) + 1)
  const delta = []
  for (const key of [...new Set([...bCounts.keys(), ...aCounts.keys()])].sort()) {
    const n = aCounts.get(key) || 0
    const m = bCounts.get(key) || 0
    for (let i = 0; i < n - m; i++) delta.push('+ ' + key)
    for (let i = 0; i < m - n; i++) delta.push('- ' + key)
  }
  return delta
}

async function _compositePerShardAudit() {
  const manifestFile = $a.compositeManifestFile
  const candidateId = `M${_milestone}-${_primaryTaskId}`
  const generation = buildResult?.mergeCommit || ''

  // 1. audit-manifest-read (exactly one mechanical agent). Its journaled .result shape
  //    ({auditShards:[...]}) is disjoint from the shard and combine return shapes.
  const manifestRead = await agent(
    `You are the audit-manifest-read helper for a composite milestone Audit. Read the manifest file ${manifestFile} (a {manifest, context} envelope; audit shards live at .manifest.auditShards) and return that array verbatim — each entry {id, kind, taskIds}. Read-only: do NOT edit anything.`,
    { label: 'audit-manifest-read', phase: 'Audit',
      schema: { type: 'object', required: ['auditShards'], properties: {
        auditShards: { type: 'array', items: { type: 'object', required: ['id', 'taskIds'], properties: {
          id: { type: 'string' }, kind: { type: 'string' },
          taskIds: { type: 'array', items: { type: 'string' } },
        } } },
      } } }
  )
  const auditShards = (manifestRead && Array.isArray(manifestRead.auditShards)) ? manifestRead.auditShards : []
  if (auditShards.length === 0) {
    log('audit-manifest-read FAILED — no auditShards[] returned from the manifest; failing closed before any shard dispatch.')
    return { outcome: 'needs-human', reason: 'audit-manifest-read-failed', phase: 'Audit' }
  }
  log(`audit-manifest-read complete: ${auditShards.length} shard(s) [${auditShards.map((s) => s.id).join(', ')}]`)

  // 2. Serialized per-shard dispatch + 3. workflow-side mechanical diff (THE enforcement point).
  const shardResults = []
  let auditSessionId = null
  for (const shard of auditShards) {
    const shardReturn = await agent(
      _compositeAuditShardPrompt(shard, candidateId, generation),
      { label: `audit-shard-${shard.id}`, phase: 'Audit',
        schema: { type: 'object', required: ['beforeSnapshot', 'afterSnapshot', 'shardResult'], properties: {
          beforeSnapshot: { type: 'array', items: { type: 'string' } },
          afterSnapshot: { type: 'array', items: { type: 'string' } },
          shardResult: { type: 'object', required: ['shardId', 'verdicts', 'shardVerdict'], properties: {
            shardId: { type: 'string' },
            verdicts: { type: 'array', items: { type: 'object', required: ['taskId', 'acIndex', 'verdict', 'detail'], properties: {
              taskId: { type: 'string' }, acIndex: { type: 'number' },
              verdict: { type: 'string' }, detail: { type: 'string' },
            } } },
            shardVerdict: { type: 'string' },
          } },
          guardResult: { type: 'object' },
          auditSessionId: { type: 'string' },
        } } }
    )
    if (!shardReturn || !Array.isArray(shardReturn.beforeSnapshot) || !Array.isArray(shardReturn.afterSnapshot)) {
      log(`audit-shard-${shard.id} FAILED — no raw snapshot arrays returned; failing closed (missing snapshots are NEVER treated as clean).`)
      return { outcome: 'needs-human', reason: `audit-shard-snapshot-missing:${shard.id}`, phase: 'Audit' }
    }
    // THE ENFORCEMENT POINT: this workflow's own diff of the returned raw git-status snapshots —
    // not the agent's self-report, not its --guard run, not deepFreeze/structuredClone.
    const delta = _diffAuditSnapshotLines(shardReturn.beforeSnapshot, shardReturn.afterSnapshot)
    log(`audit-shard-${shard.id} workflow-side snapshot diff: ${delta.length === 0 ? 'CLEAN' : JSON.stringify(delta)} (agent guard self-report: ${JSON.stringify(shardReturn.guardResult || null)})`)
    if (delta.length > 0) {
      log(`audit-shard-${shard.id} WRITE VIOLATION — the workflow's own before/after git-status diff is non-empty: ${JSON.stringify(delta)}. Hard-failing regardless of the agent's claims.`)
      return { outcome: 'needs-human', reason: `audit-shard-write-violation:${shard.id}`, phase: 'Audit' }
    }
    if (!shardReturn.shardResult || shardReturn.shardResult.shardId !== shard.id) {
      log(`audit-shard-${shard.id} FAILED — shardResult missing or shardId mismatch (got ${shardReturn?.shardResult?.shardId}); failing closed.`)
      return { outcome: 'needs-human', reason: `audit-shard-result-mismatch:${shard.id}`, phase: 'Audit' }
    }
    if (!auditSessionId && shardReturn.auditSessionId) auditSessionId = shardReturn.auditSessionId
    shardResults.push(shardReturn.shardResult)
  }

  // 4. audit-combine (exactly once): invokes the REAL combineShardVerdicts via --combine-json.
  const shardResultsFile = `/tmp/composite-audit-shard-results-${_milestone}-${_primaryTaskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  const combineResult = await agent(
    `You are the audit-combine helper for a composite milestone Audit. Every audit-shard-<id> worker has completed and passed the workflow's mechanical read-only snapshot diff.
1. Write EXACTLY this AuditShardResult[] JSON to ${shardResultsFile} (a /tmp scratch file, OUTSIDE the repo — never write inside the repository):
${JSON.stringify(shardResults)}
2. Run EXACTLY this command and capture its stdout:
  node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-audit.ts --combine-json --in ${shardResultsFile} --candidate-id ${candidateId}${generation ? ` --generation-id ${generation}` : ''}
   Its stdout is the BundleAuditResult JSON ({candidateId, shardResults, bundleVerdict, generationId}) produced by composite-audit.ts's REAL exported combineShardVerdicts — do NOT recompute the verdict yourself.
3. Run \`echo \$CLAUDE_CODE_SESSION_ID\` and return the discovered id as auditSessionId.
Read-only otherwise: do NOT edit any repository file. Return {candidateId, shardResults, bundleVerdict, generationId, auditSessionId}.`,
    { label: 'audit-combine', phase: 'Audit',
      schema: { type: 'object', required: ['bundleVerdict'], properties: {
        candidateId: { type: 'string' },
        shardResults: { type: 'array' },
        bundleVerdict: { type: 'string' },
        generationId: { type: 'string' },
        auditSessionId: { type: 'string' },
      } } }
  )
  if (!combineResult || !combineResult.bundleVerdict) {
    log('audit-combine FAILED — no BundleAuditResult returned; failing closed.')
    return { outcome: 'needs-human', reason: 'audit-combine-failed', phase: 'Audit' }
  }
  if (!auditSessionId && combineResult.auditSessionId) auditSessionId = combineResult.auditSessionId
  // Map bundleVerdict onto the existing auditResult shape so ALL downstream plumbing (the verdict
  // branches, AUDIT_SESSION_ID pass-through, Gate/Land) is unchanged.
  const verdictMap = { REFUTED: 'REFUTED', CONCERNS: 'CONCERNS', PASS: 'NO REFUTATION FOUND' }
  const verdict = verdictMap[combineResult.bundleVerdict] || 'REFUTED'
  log(`audit-combine complete: bundleVerdict=${combineResult.bundleVerdict} -> verdict=${verdict} (candidate ${candidateId})`)
  // DIR-119-D4 (M212): thread the full BundleAuditResult through for the Reconcile phase — reconcile()
  // consumes the complete shard-verdict vector as input, not just the mapped verdict.
  return {
    verdict,
    detail: `composite per-shard audit: ${shardResults.length} shard(s), bundle ${combineResult.bundleVerdict}`,
    auditSessionId,
    bundleAudit: {
      candidateId: combineResult.candidateId || candidateId,
      shardResults: Array.isArray(combineResult.shardResults) ? combineResult.shardResults : shardResults,
      bundleVerdict: combineResult.bundleVerdict,
      generationId: combineResult.generationId,
    },
  }
}

// ── Phase: Audit (step 6 acceptance audit) ──────────────────────────────────────────
phase('Audit')

// DIR-123: threaded into the Audit prompt ONLY under worktree isolation ('' otherwise → byte-identical
// legacy). CRITICAL for correctness: the build being audited lives in the WORKTREE, not the primary
// checkout (Land has not merged yet) — an audit that read the primary checkout would see nothing and
// wrongly REFUTE. execute-milestone-worktree.test.mjs proves Audit reads the worktree path via a
// fixture where the worktree and primary checkout deliberately differ.
const _auditIsolationNote = _useWorktree
  ? `\n\nWORKTREE ISOLATION (DIR-123): the Build you are auditing happened inside the per-milestone worktree at \`${_isolationPlan.worktreeRel}\` (branch \`${_isolationPlan.branch}\`), NOT the primary checkout — Land has NOT merged it yet. READ the built artifacts, inspect diffs (\`git -C ${_isolationPlan.worktreeRel} diff\` / \`git -C ${_isolationPlan.worktreeRel} show\`), read files under \`${_isolationPlan.worktreeRel}/\`, and run the mechanical gate from THAT WORKTREE PATH. Auditing the primary checkout would see none of the build and wrongly REFUTE. Write your audit artifact into the WORKTREE's copy of MILESTONE_ROOT/audits/ and \`git add\` it there.
   COMMIT-THE-AUDIT-EVIDENCE (DIR-123 review C1 — REQUIRED under worktree isolation): Build committed BEFORE this audit existed, so NOTHING you write is on the branch yet; and Land's \`git worktree remove --force\` DISCARDS any staged-but-uncommitted worktree content, so a merely-\`git add\`-ed audit artifact would be LOST on every worktree-isolated Land. Therefore, AFTER you finish steps 1–5 below, from the worktree path COMMIT your evidence onto the branch:
     cd ${_isolationPlan.worktreeRel} && git add -A && git commit -m "audit: ${_primaryTaskId} acceptance audit + AC write-backs + disposition (DIR-123 worktree isolation)"
   (\`git add -A\` picks up the audit artifact, the task-file AC-checkbox write-backs, the absorb-entry disposition line, and any deviation-log row you wrote.) This commit is the ONLY thing that carries your evidence to the primary — via Land's merge (serial path) or the fan-in's merge (concurrent path, where the branch must already hold the committed evidence BEFORE the fan-in merges it). Do NOT skip it. If there is genuinely nothing to commit, that is fine — but the audit artifact + AC write-backs are always something, so in practice this commit always happens.`
  : ''// DIR-119-D3 (M211): a composite call WITH a manifest routes to the real per-shard read-only
// dispatcher (_compositePerShardAudit) — one mechanically-checked-read-only audit-shard-<id> agent
// per manifest shard, then exactly one audit-combine invoking composite-audit.ts's real
// combineShardVerdicts via --combine-json. The composite write instructions that used to be
// interpolated into the single-agent prompt below are STRIPPED entirely (those mutations move to
// Reconcile, DIR-119-D4). The width-1 / manifest-less path stays the untouched single agent — the
// removed interpolation was the empty string when _isComposite===false, so that path's prompt text
// is byte-for-byte identical (golden replay).
const auditResult = (_isComposite && $a.compositeManifestFile)
  ? await _compositePerShardAudit()
  : await agent(
  `ADVERSARIAL ACCEPTANCE AUDIT for milestone task ${_primaryTaskId}. FRESH CONTEXT — you have NOT seen the build.${_auditIsolationNote}

MANIFEST REFERENCE (M238/gap-build-evidence-manifest-missing): the Build evidence manifest is at <MILESTONE_ROOT>/build-evidence-manifest.json where MILESTONE_ROOT is resolved via the ONE authoritative path-prefix rule (run \`source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root ${_milestone}\`). CONSUME IT AS AN INDEX: changedFiles, testsRun, acEvidence[] with {taskId, acIndex, disposition, evidenceClass, actualArtifact}. Entries with "producer":"build-agent" are ATTRIBUTED CLAIMS, not verified facts — independently check the referenced raw artifacts. A manifest field named "PASS" has NO authority.

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
// DIR-119-D3 (M211): the composite per-shard dispatcher returns its own typed terminals
// (audit-manifest-read-failed / audit-shard-write-violation:<id> / audit-shard-snapshot-missing:<id>
// / audit-shard-result-mismatch:<id> / audit-combine-failed) — fail closed BEFORE Gate/Land. The
// legacy single-agent audit never returns an `outcome` field, so this fires only on the composite path.
if (auditResult?.outcome === 'needs-human') {
  log(`Audit phase FAILED (${auditResult.reason}) — composite per-shard audit hard-failed; cannot proceed to Gate.`)
  return { outcome: 'needs-human', reason: auditResult.reason, phase: 'Audit', verifyCacheUpdates }
}
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
// DIR-123: under worktree isolation, the build's task-file / working-tree changes live in the WORKTREE
// (Land has not merged), so gates that inspect the working tree / task store must run against the
// worktree path, not the pre-build primary checkout. Prefixed onto every gate prompt ONLY in worktree
// mode ('' otherwise → byte-identical legacy prompts). Repo-level ledger checks (vmeta-lag, dashboard
// line-budget) read the same shared ledgers either way; running them from the worktree cwd is harmless
// and keeps one uniform instruction.
const _gateWt = _useWorktree
  ? `WORKTREE ISOLATION (DIR-123): first \`cd ${_isolationPlan.worktreeRel}\` (the build worktree, branch ${_isolationPlan.branch}) and run this gate FROM THERE so it checks the BUILT state (the task-file / working-tree changes are in the worktree; Land has not merged the primary checkout yet). Then `
  : ''
// DIR-119-D4 (M212): TYPED Gate results. Gate closures change RETURN SHAPE, not check set.
// Task-scoped gates return {scope:"task", taskId, gate, ok, detail}; milestone-scoped gates return
// {scope:"milestone", gate, ok, detail}. Identity is a STRUCTURAL `taskId` field — never the
// `split-or-commit-${tid}` label, never positional order. For the LEGACY width-1 path the return
// shape and prompts stay byte-identical (golden replay): every typed interpolation below is ''
// when `_isComposite===false`, and the schemas fall back to the untyped {ok, detail} shape.
const _typedMilestoneGateReturn = _isComposite ? 'Return a TYPED milestone-scoped gate record {scope:"milestone", gate:<check-name>, ok:<bool>, detail:<why>}.' : 'Return {ok, detail}.'
const _typedTaskGateReturn = (tid) => _isComposite ? `Return a TYPED task-scoped gate record {scope:"task", taskId:"${tid}", gate:"split-or-commit", ok:<bool>, detail:<why>}.` : 'Return {ok, detail}.'
const _milestoneGateSchema = _isComposite
  ? { type: 'object', required: ['scope', 'gate', 'ok'], properties: { scope: { type: 'string' }, gate: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } } }
  : { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } }
const _taskGateSchema = _isComposite
  ? { type: 'object', required: ['scope', 'taskId', 'gate', 'ok'], properties: { scope: { type: 'string' }, taskId: { type: 'string' }, gate: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } } }
  : { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } }
// DIR-119-B (M189) Stage 2.5: the task-scoped split-or-commit gate runs for EVERY member task
// (not just the primary) — for a legacy single-task call (_taskIds.length===1) this is
// byte-for-behavior identical to the pre-existing single gate call (same label, same command).
const _splitOrCommitGates = _taskIds.map((tid) => () => agent(
  `${_gateWt}Run quay gate --gate split-or-commit ${tid}. ${_typedTaskGateReturn(tid)} Non-zero = SPLIT-OR-COMMIT violation (DIR-026: parent-done-iff-children, SELECT-split, child-link-symmetry, OR needs-human reason is in-project rather than external) → HARD BLOCK.`,
  { label: _isComposite ? `split-or-commit-${tid}` : 'split-or-commit', schema: _taskGateSchema },
))
const gates = await parallel([
  () => agent(`${_gateWt}Run vmeta-lag-check.sh --counter <extract current milestone_counter from experiments/quay-perpetual-stream/dashboard.md minus 1> experiments/quay-perpetual-stream/v-meta-ledger.md. This reads the V_meta ledger (NOT the absorb entry). ${_typedMilestoneGateReturn} Non-zero = ALARM → HARD BLOCK.`,
    { label: 'vmeta-lag', schema: _milestoneGateSchema }),
  () => agent(`${_gateWt}Run it0-dashboard-line-budget-check.sh. ${_typedMilestoneGateReturn} Non-zero = dashboard exceeds 1200-line cap → HARD BLOCK.`,
    { label: 'dash-budget', schema: _milestoneGateSchema }),
  () => agent(`${_gateWt}Run tree-hygiene-check.sh. ${_typedMilestoneGateReturn} Non-zero = un-gitignored scratch on master → HARD BLOCK.`,
    { label: 'tree', schema: _milestoneGateSchema }),
  () => agent(`${_gateWt}Run worktree-branch-hygiene-check.sh. ${_typedMilestoneGateReturn} Non-zero = orphaned milestone evidence → HARD BLOCK.`,
    { label: 'worktree', schema: _milestoneGateSchema }),
  ..._splitOrCommitGates,
  () => agent(
    `${_gateWt}Run node --experimental-strip-types experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts --manifest $(${_milestoneRootCmd})/build-evidence-manifest.json --workspace .
     ${_typedMilestoneGateReturn} Non-zero = manifest structurally incomplete or evidence-class incompatible -> HARD BLOCK before Audit.`,
    { label: 'build-evidence', schema: _milestoneGateSchema },
  ),
])

const gatesFailed = gates.filter(Boolean).some(g => !g.ok)
if (gatesFailed) {
  log('Gate phase FAILED — one or more mechanical gates did not pass. Marking needs-human.')
  if (_isComposite && $a.compositeManifestFile) {
    // DIR-119-D4 (M212): typed failure attribution — identify WHICH member task(s) actually failed
    // via composite-reconcile.ts's REAL exported attributeGateFailures (invoked through the
    // --attribute-gates-json CLI mode), never the old `_primaryTaskId` hardcode, never a workflow-side
    // re-derivation. The attribute-gates helper agent writes the typed vector to /tmp and runs the
    // command; its failedTaskIds feed the mark-needs-human agent below.
    const gateVectorFile = `/tmp/composite-gate-vector-${_milestone}-${_primaryTaskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
    const attribution = await agent(
      `You are the attribute-gates helper for a composite milestone Gate phase (DIR-119-D4).
1. Write EXACTLY this typed gate-vector JSON to ${gateVectorFile} (a /tmp scratch file, OUTSIDE the repo — never write inside the repository):
${JSON.stringify(gates.filter(Boolean))}
2. Run EXACTLY this command and capture its stdout:
  node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-reconcile.ts --attribute-gates-json --in ${gateVectorFile}
   Its stdout is the {failedTaskIds, passingTaskIds, milestoneFailures} JSON produced by composite-reconcile.ts's REAL exported attributeGateFailures — do NOT recompute attribution yourself.
Return {failedTaskIds: [...], passingTaskIds: [...], milestoneFailures: [...]}.`,
      { phase: 'Gate', label: 'attribute-gates',
        schema: { type: 'object', required: ['failedTaskIds'], properties: {
          failedTaskIds: { type: 'array', items: { type: 'string' } },
          passingTaskIds: { type: 'array', items: { type: 'string' } },
          milestoneFailures: { type: 'array' },
        } } }
    )
    const failedTaskIds = (attribution && Array.isArray(attribution.failedTaskIds)) ? attribution.failedTaskIds : []
    const failedTaskList = failedTaskIds.length > 0 ? failedTaskIds.join(', ') : '(unknown — attribution helper returned no failed ids)'
    const milestoneFailuresNote = (attribution && Array.isArray(attribution.milestoneFailures) && attribution.milestoneFailures.length > 0)
      ? ` Milestone-scoped gate failures (bundle-level, not attributable to a single member): ${JSON.stringify(attribution.milestoneFailures)}.`
      : ''
    await agent(
      `Mark task(s) ${failedTaskList} needs-human (DIR-119-D4: failing member task(s) identified via attributeGateFailures, NOT ${_primaryTaskId} by default). Record which gates failed and why in the ABSORB entry at ${$a.absorbEntryFile}.${milestoneFailuresNote} Gates: ${JSON.stringify(gates.filter(Boolean))}`,
      { label: 'mark-needs-human', phase: 'Land' }
    )
  } else {
    await agent(
      `Mark task ${_primaryTaskId} needs-human. Record which gates failed and why in the ABSORB entry at ${$a.absorbEntryFile}. Gates: ${JSON.stringify(gates.filter(Boolean))}`,
      { label: 'mark-needs-human', phase: 'Land' }
    )
  }
  return { outcome: 'needs-human', reason: 'gate-failed', phase: 'Gate', verifyCacheUpdates }
}
log(`Gate phase PASSED — all ${gates.filter(Boolean).length} mechanical gates green.`)

// ── Phase: Reconcile (DIR-119-D4 / M212) ─────────────────────────────────────────────
// Literal Reconcile phase between Gate and Land. For a COMPOSITE dispatch this is the ONLY phase
// permitted to write task AC/DoD ticks, status:done, dashboard rows, and absorb dispositions —
// reconcile-apply is the sole success-path writer; the Land agent below VALIDATES the post-image and
// commits (DIR-119-D5 owns Land's transaction wiring). Strictly downstream of Gate because
// reconcile() requires the complete typed task+milestone gate vector. Width-1 / manifest-less
// dispatches SKIP this phase entirely — the width-1 Land prompt keeps its writes byte-for-behavior
// identical (golden replay, execute-milestone-worktree.test.mjs).
const IS_CONCURRENT = $a.mode === 'concurrent'
if (_isComposite && $a.compositeManifestFile) {
  phase('Reconcile')
  const _reconcileWt = _useWorktree
    ? `WORKTREE ISOLATION (DIR-123): first \`cd ${_isolationPlan.worktreeRel}\` (the build worktree, branch ${_isolationPlan.branch}) and apply your writes THERE (task files / dashboard / absorb live in the worktree; Land has not merged the primary checkout yet). Then `
    : ''
  const _reconcileLandScopeNote = IS_CONCURRENT
    ? `\nCONCURRENT MODE (fan-in absorb): do NOT write dashboard.md or increment milestone_counter (those are deferred to the serial fan-in absorb step). Your sole-writer scope here is the task-level success-path state — AC/DoD ticks, status:done, absorb dispositions — plus the consolidated audit artifact.`
    : `\nSERIAL MODE: as the sole success-path writer, ALSO apply EXACTLY ONE dashboard.md ## Log absorb entry, EXACTLY ONE milestone_counter increment, and the dashboard view update (composite-land.ts's atomic-Land invariant).`
  const reconcileInputFile = `/tmp/composite-reconcile-input-${_milestone}-${_primaryTaskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  const reconcileInput = {
    bundleAudit: auditResult?.bundleAudit || { candidateId: `M${_milestone}-${_primaryTaskId}`, shardResults: [], bundleVerdict: 'REFUTED' },
    requiredGenerationId: buildResult?.mergeCommit || undefined,
    taskGates: gates.filter((g) => g && g.scope === 'task'),
    milestoneGates: gates.filter((g) => g && g.scope === 'milestone'),
    taskIds: _taskIds,
  }
  const reconcileApply = await agent(
    `You are reconcile-apply for the COMPOSITE milestone Reconcile phase (DIR-119-D4). ${_reconcileWt}You are the ONLY agent in this workflow whose prompt instructs success-path composite state writes — task AC/DoD ticks, status:done, dashboard rows, absorb dispositions, deviation/write-back rows — for a composite dispatch. The Land agent below only VALIDATES your post-image and commits (DIR-119-D5 owns Land's transaction wiring).
1. Write EXACTLY this ReconcileInput JSON to ${reconcileInputFile} (a /tmp scratch file, OUTSIDE the repo — never write inside the repository):
${JSON.stringify(reconcileInput)}
2. Run EXACTLY this command and capture its stdout:
  node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-reconcile.ts --reconcile-json --in ${reconcileInputFile}
   Its stdout is the ReconcileResult JSON from composite-reconcile.ts's REAL exported reconcile() — {ok, reason?, mutations:[{taskId, checkboxes:[ac-<n>...], absorbDisposition}], bundleDisposition?}. Do NOT recompute the mutation plan yourself. A nonzero exit code means ok:false (contract violation) — apply ZERO mutations.
3. APPLY ALL-OR-NOTHING (pre-image capture + rollback; never a partial success):
   - If result.ok === true: FIRST capture pre-images (read each member task's current AC/DoD checkbox state and lifecycle status), THEN apply the COMPLETE returned mutation set — for EACH {taskId, checkboxes, absorbDisposition}: tick EXACTLY the returned \`ac-<acIndex>\` checkboxes in tasks/<taskId>.md's ## Acceptance Criteria / ## Definition of Done sections, append the absorb-disposition line to ${$a.absorbEntryFile}, and task_write status:done with a per-task ## Execution record.${_reconcileLandScopeNote} Also write the consolidated audit artifact under MILESTONE_ROOT/audits/ (resolve MILESTONE_ROOT via \`source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root ${_milestone}\`). Any failure mid-apply: ROLL BACK every mutation to the captured pre-images and mark needs-human — never leave a partial success.
   - If result.ok === false: apply ZERO mutations. Return {applied:false, reason, result}.
Return {applied: <bool>, result: <the ReconcileResult JSON>}.`,
    { phase: 'Reconcile', label: 'reconcile-apply',
      schema: { type: 'object', required: ['applied', 'result'], properties: {
        applied: { type: 'boolean' },
        result: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, mutations: { type: 'array' }, bundleDisposition: { type: 'string' } } },
      } } }
  )
  log(`Reconcile phase complete: applied=${reconcileApply?.applied}, result.ok=${reconcileApply?.result?.ok}${reconcileApply?.result?.reason ? ` reason=${reconcileApply.result.reason}` : ''}`)
  if (!reconcileApply?.applied || !reconcileApply?.result?.ok) {
    log(`Reconcile contract violation (${reconcileApply?.result?.reason || 'reconcile-apply-did-not-apply'}) — zero mutations applied; cannot proceed to Land.`)
    return { outcome: 'needs-human', reason: reconcileApply?.result?.reason || 'reconcile-contract-violation', phase: 'Reconcile', verifyCacheUpdates }
  }
} else {
  log('Reconcile phase skipped (width-1 / manifest-less dispatch — success-path writes remain in Land per golden replay).')
}

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

// DIR-119-D4 (M212): atomic-Land note threaded into both Land prompts below. For a legacy
// single-task call (_isComposite===false) this is empty — behavior is byte-for-behavior unchanged
// (golden replay). For a genuine composite call it is a VALIDATION-ONLY note: the composite
// success-path writes (task lifecycle state, AC/DoD ticks, absorb dispositions, dashboard rows) were
// applied by `reconcile-apply` in the Reconcile phase (the SOLE success-path writer), so Land here
// validates the post-image and commits — never re-applying those writes. Task-completion count is
// recorded as metadata only.
const _compositeLandNote = _isComposite
  ? `\n\nCOMPOSITE LAND (DIR-119-D4/M212, ${_taskIds.length} member tasks: ${_taskIds.join(', ')}): the composite success-path writes (task lifecycle state, AC/DoD ticks, absorb dispositions, dashboard rows) were applied by \`reconcile-apply\` in the Reconcile phase. Here VALIDATE that post-image (read the tasks, inspect \`git diff\`) and commit only — do NOT re-apply any of those writes. Record task-completion count (${_taskIds.length}) as metadata.`
  : ''

// DIR-123: the SERIAL Land path's step-1 merge instruction, mode-aware. (The CONCURRENT path uses
// _concurrentLandStep below — under worktree isolation it defers the merge to the fan-in, which is the
// SOLE merge owner per OUTER-LOOP step g.) Fixes the stale step-1 worktree-merge-into-master text that
// described an action never real for the now-default no-worktree path.
//  - WORKTREE MODE: Land is the SOLE phase touching the shared checkout. Step 1 ACQUIRES the single-
//    flight Land lock and does the real merge + worktree-remove, but does NOT release the lock — the
//    lock is held for the ENTIRE Land phase (released only by _landLockReleaseStep after step 8), so the
//    CAPTURE commits, dashboard.md ## Log append, milestone_counter read-modify-write, and the
//    it0-backlog-regen.ts regeneration ALL happen under it (DIR-123 review Obstacle 1: a lock covering
//    only the merge left steps 3-5 racing → lost-update on milestone_counter/dashboard.md/backlog.md +
//    a git-index race on the CAPTURE commits). A real merge conflict is the DEFINED same-file-conflict
//    path (auto-aborted, marks needs-human, never blanket --ours/--theirs).
//  - NO-ISOLATION MODE (default): Build committed directly to master, so there is NO worktree to merge
//    — an explicit, accurate NO-OP (the legacy prompt's step-1 worktree-merge text was vestigial), and
//    NO lock is taken (this is the strictly-serial default path; mixed-mode concurrency is forbidden —
//    see the Obstacle-5 precondition documented in tasks/DIR-123.md / CLAUDE.md).
// The no-isolation branch is the ONE intentional legacy-path prompt-text change DIR-123 makes
// (Requested-action #4); it is behavior-preserving — execute-milestone-worktree.test.mjs's golden replay
// proves it is the only legacy delta (_landLockReleaseStep is '' in no-isolation mode).
const _landMergeStep = _useWorktree
  ? `1. MERGE — DIR-123 worktree isolation (Land is the SOLE phase that touches the shared checkout):
   a. ACQUIRE the single-flight Land lock — and HOLD IT for the ENTIRE Land phase (it is released only
      in the final RELEASE step after step 8, so EVERY shared-checkout mutation below — this merge, the
      CAPTURE commits, the dashboard.md ## Log append, the milestone_counter increment, and the
      backlog/dashboard regeneration — happens under the lock; a concurrent worktree Land blocks until
      this whole Land finishes): run
      \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-worktree.ts --land-lock-acquire --workspace .\`
      (this process inherits CLAUDE_CODE_SESSION_ID as the lock owner). If it prints
      outcome:"land-already-running", WAIT for the other Land to finish and retry — never merge concurrently.
   b. REAL merge of the worktree branch into the primary checkout (on master):
      \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-worktree.ts --merge --workspace . --milestone ${_milestone}\`
      (a real \`git merge --no-ff ${_isolationPlan.branch}\`). If it prints outcome:"conflict" with a
      "files" list, that is the DEFINED same-file-conflict path — the pre-dispatch touches-orthogonality
      check (concurrent-batch-scheduler.ts) should have prevented it; DO NOT blanket --ours/--theirs
      (DIR-013): RELEASE the Land lock, then mark needs-human citing the conflicting files for per-file
      human resolution (the merge was auto-aborted, leaving the shared checkout clean).
   c. REMOVE the worktree + delete the now-merged branch (real operations):
      \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-worktree.ts --remove --workspace . --milestone ${_milestone}\`
      (real \`git worktree remove\` + \`git branch -d\`; \`-d\` refuses an UNMERGED branch as a backstop).
      The Land lock STAYS HELD through steps 2-8 below; release it only in the final RELEASE step.`
  : `1. NO WORKTREE MERGE (no-isolation mode — the default): Build committed DIRECTLY to the shared
   checkout on master (DIR-027: the loop runs on master directly), so there is NO per-milestone
   iteration worktree to merge — this merge step is a NO-OP, and NO Land lock is taken (this is the
   strictly-serial default path). (Under \`isolationMode:'worktree'\` this step is instead a REAL merge
   of the per-milestone worktree branch via milestone-worktree.ts, under a Land lock held for the whole
   Land phase.) If the direct build left any conflict, resolve per-file: both sides read, reconciliation
   note recorded. Never a blanket --ours/--theirs (DIR-013).`

// DIR-123 (review Obstacle 1): the Land lock RELEASE, appended as the FINAL step of the SERIAL Land
// (after step 8) under worktree isolation — '' in no-isolation mode, so the legacy serial prompt stays
// byte-identical (golden replay). Releasing only here is what makes "Land is the sole serialized mutator"
// literally true: the lock's scoped region equals the FULL set of shared-checkout mutations.
const _landLockReleaseStep = _useWorktree
  ? `\n9. RELEASE the Land lock — ONLY now, after ALL shared-checkout mutations above (step 1 merge/remove,
   the CAPTURE commits, the dashboard.md ## Log append, the milestone_counter increment, the
   backlog/dashboard regeneration) are complete:
   \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-worktree.ts --land-lock-release --workspace .\`.
   Holding the lock across the whole Land phase is what serializes concurrent worktree Lands over EVERY
   shared-checkout write, not just the merge.`
  : ''

// DIR-123: the CAPTURE step's trailing worktree-prune clause, also mode-aware so no stale "git worktree
// remove" text describes an action that isn't real for its path (Requested-action #4 grep-cleanliness).
const _landCaptureTail = _useWorktree
  ? `\n   (The per-milestone worktree was already merged + removed in step 1 above — nothing further to prune here.)`
  : ` Then, ONLY if a non-primary iteration produced its OWN worktree evidence not on master, \`git worktree remove\` + \`git branch -d\` those now-merged branches — a NO-OP for the default single-iteration direct-to-master build, which creates no worktree.`

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
  // DIR-123 review Obstacle 2: worktree-mode + mode:'concurrent' must NOT contradict the fan-in's
  // "SOLE merge owner / ¬parallel merge" invariant (OUTER-LOOP.md concurrent_execute step g). So under
  // worktree isolation the per-workflow concurrent Land does NOT merge, does NOT remove the worktree,
  // does NOT CAPTURE-commit on the primary, and does NOT take the Land lock — it leaves the worktree
  // branch committed and returns buildBranch + worktreeRel. The fan-in (step g) is the single owner of
  // ALL shared-checkout mutations: for each survivor, UNDER the Land lock, it merges buildBranch
  // (--no-ff), CAPTUREs the evidence (git add + commit on the primary), removes the worktree + deletes
  // the branch, then releases the lock. This also moves CAPTURE's shared-checkout commit UNDER the lock
  // (fixing the concurrent-CAPTURE index race). The legacy no-isolation concurrent path below is
  // unchanged (the fan-in already owned its merges). DECISION documented in tasks/DIR-123.md.
  if (_useWorktree) {
    const concurrentResult = await agent(
      `LAND (concurrent + worktree-isolation mode) the milestone for task ${_primaryTaskId}. IN THIS MODE
   you are part of a multi-milestone worktree-isolated batch, and the FAN-IN (OUTER-LOOP.md
   concurrent_execute step g) is the SOLE merge owner — so YOU DO NOT MERGE AND DO NOT TOUCH THE SHARED
   CHECKOUT AT ALL. Your Build committed this milestone's work on branch \`${_isolationPlan.branch}\` in
   the worktree \`${_isolationPlan.worktreeRel}\`.

1. DO NOT \`git merge\`, DO NOT \`git worktree remove\`, DO NOT \`git add\`/\`git commit\` on the primary
   checkout, and DO NOT take the Land lock here. LEAVE the worktree and its branch exactly as they are —
   the fan-in (step g) will, UNDER the single-flight Land lock, run milestone-worktree.ts --merge
   (real \`git merge --no-ff ${_isolationPlan.branch}\`), CAPTURE this milestone's evidence (git add the
   audits/iterations/charter + commit on the primary), then --remove (worktree remove + branch -d), then
   release the lock. Doing any of that here would violate the SOLE-merge-owner invariant and race the
   fan-in / other survivors on the primary git index.
2. Do NOT update milestone_counter or dashboard.md (deferred to the serial fan-in absorb step).
${_isComposite ? `3. EXECUTION-PROVENANCE VALIDATION (DIR-119-D4): reconcile-apply set status:done and ticked AC/DoD for every member task in the Reconcile phase — VALIDATE those writes (read the member tasks) and do NOT re-write them. If a per-task ## Execution record is missing, append ONLY that provenance record WITHOUT re-setting status.` : `3. EXECUTION-PROVENANCE WRITE-BACK (M24): task_write to tasks/${_primaryTaskId}.md appending a
   ## Execution record section (milestone id, iteration count, realized Δv, build branch
   ${_isolationPlan.branch}, one-line outcome summary) and setting status: done. (This is a PER-TASK
   store write, serialized by quay-native's per-task lock — NOT part of the shared-checkout race — so it
   is safe to do here before the fan-in merges.)`}
4. COMPUTE touchedFiles (READ-ONLY, safe): run \`git diff --numstat master..${_isolationPlan.branch}\`
   from the repo root to get the files this build changed; collect column 3 into a flat array.
5. DRAFT a one-line dashboard entry for this milestone: "m<NN> · ${_primaryTaskId} · Δv=<realized> ·
   audit=${auditResult?.verdict || 'NO REFUTATION FOUND'} · merge=<pending fan-in> · → milestones/<NN>/"${_compositeLandNote}

Charter: ${$a.charterFile}
Build outcome: ${JSON.stringify(buildResult)}
Audit verdict: ${auditResult?.verdict}

Return {taskId: "${_primaryTaskId}", outcome: "done",
  buildBranch: "${_isolationPlan.branch}", worktreeRel: "${_isolationPlan.worktreeRel}",
  touchedFiles: ["relative/path/to/file1.ts", ...],
  dashboardEntry: "<markdown block for serial-fanin-absorb.ts>"}.`,
      { phase: 'Land',
        schema: { type: 'object', required: ['outcome', 'buildBranch', 'touchedFiles', 'dashboardEntry'], properties: {
          taskId: { type: 'string' }, outcome: { type: 'string' },
          buildBranch: { type: 'string' }, worktreeRel: { type: 'string' },
          touchedFiles: { type: 'array', items: { type: 'string' } },
          dashboardEntry: { type: 'string' },
        } } }
    )
    const postLandCheck = await postLandSplitOrCommitCheck()
    if (!postLandCheck?.ok) {
      log(`Land post-mutation split-or-commit check FAILED (concurrent+worktree, gap-split-or-commit-not-continuously-checked) — ${postLandCheck?.detail || 'no detail'}`)
      return { outcome: 'needs-human', reason: 'post-land-split-or-commit-violation', phase: 'Land', postLandSplitOrCommit: postLandCheck, verifyCacheUpdates }
    }
    log(`Land phase complete (concurrent + worktree) — milestone ${_primaryTaskId} deferred its merge to the fan-in (buildBranch=${_isolationPlan.branch}); touched ${(concurrentResult?.touchedFiles || []).length} files.`)
    return { outcome: 'done', taskId: _primaryTaskId, taskIds: _taskIds,
      buildBranch: _isolationPlan.branch, worktreeRel: _isolationPlan.worktreeRel,
      touchedFiles: concurrentResult?.touchedFiles, dashboardEntry: concurrentResult?.dashboardEntry, verifyCacheUpdates }
  }

  // ── Legacy concurrent path (no isolation): UNCHANGED — fan-in owns merges; per-workflow CAPTURE. ──
  const concurrentResult = await agent(
    `LAND (concurrent mode) the milestone for task ${_primaryTaskId}. IN CONCURRENT MODE:
   you are part of a multi-milestone batch — do NOT update milestone_counter or dashboard.md
   (those writes are deferred to the serial fan-in absorb step that follows).

${_landMergeStep}
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
   produced evidence not on master, cherry-pick JUST that evidence file.${_landCaptureTail}
${_isComposite ? `3. EXECUTION-PROVENANCE VALIDATION (DIR-119-D4): reconcile-apply set status:done and ticked AC/DoD for every member task in the Reconcile phase — VALIDATE those writes (read the member tasks) and do NOT re-write them. If a per-task ## Execution record is missing, append ONLY that provenance record WITHOUT re-setting status.` : `3. EXECUTION-PROVENANCE WRITE-BACK (M24): task_write to tasks/${_primaryTaskId}.md
   appending a ## Execution record section (milestone id, iteration count, realized Δv,
   merge commit SHA, one-line outcome summary) and setting status: done.`}
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

${_landMergeStep}
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
   produced evidence not on master, cherry-pick JUST that evidence file.${_landCaptureTail}
${_isComposite ? `3. VALIDATE the dashboard.md ## Log absorb entry applied by \`reconcile-apply\` in the Reconcile phase (DIR-119-D4) — read it and confirm it is present; do NOT write it again.` : `3. WRITE ABSORB log entry into dashboard.md's ## Log section (DIR-054 rolling-window
   format): m<NN> · <task-id> · Δv=<realized> · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`}
${_isComposite ? `4. VALIDATE the dashboard view + milestone_counter increment applied by \`reconcile-apply\` in the Reconcile phase (DIR-119-D4) — confirm exactly ONE increment landed; do NOT increment again.` : `4. UPDATE DASHBOARD (step 7): VT (sum weight·cov), slope (marginal Δv), ρ, charter-thickness,
   discovery-latency, calibration-error, V_meta consolidation lag, milestone_counter++
   (ONLY after all gates above cleared and master merge landed).`}
5. REGENERATE backlog.md/dashboard.md views via experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts.
6. RUN tree-hygiene-check.sh and worktree-branch-hygiene-check.sh one final time
   to confirm the close-out is clean. Paste results.
${_isComposite ? `7. EXECUTION-PROVENANCE VALIDATION (DIR-119-D4): reconcile-apply set status:done and ticked AC/DoD in the Reconcile phase — VALIDATE those writes (read the task) and do NOT re-write them. If the ## Execution record is missing, append ONLY that provenance record WITHOUT re-setting status.` : `7. EXECUTION-PROVENANCE WRITE-BACK (M24): task_write to tasks/${_primaryTaskId}.md
   appending a ## Execution record section (milestone id, iteration count, realized Δv,
   merge commit SHA, one-line outcome summary) and setting status: done.`}
8. PHI CONSOLIDATION CHECK: if a prior adaptation was REUSED UNCHANGED by THIS
   (different-domain) milestone, consolidate it into inherited-core.md and retire
   its citation (§4.2).${_compositeLandNote}${_landLockReleaseStep}

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
