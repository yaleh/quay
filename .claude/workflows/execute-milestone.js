export const meta = {
  name: 'execute-milestone',
  description: 'Given a SELECTed milestone task, run the full execution pipeline: it0 checks → inner iteration build → adversarial audit → absorb gates → land. Replaces OUTER-LOOP.md steps 4–7 (DIR-067, 2026-07-24). Returns {outcome: "done"|"needs-human"|"building"} — "building" means a background task was dispatched; the caller polls and resumes.',
  phases: [
    { title: 'Verify', detail: 'Step 4 — run all 5 it0 systematic-explore checks' },
    { title: 'Build',  detail: 'Step 5 — class-route + dispatch inner iteration agent' },
    { title: 'Audit',  detail: 'Step 6 — adversarial fresh-context acceptance audit' },
    { title: 'Gate',   detail: 'Step 6 — all absorb-phase mechanical gate checks' },
    { title: 'Land',   detail: 'Step 6 merge + step 7 dashboard update + counter++' },
  ],
}

// ── Phase: Verify (step 4) ──────────────────────────────────────────────────────────
phase('Verify')

// DIR-079 (M156): Per-check incremental caching.
// Input fingerprints are pre-computed by the caller (workflow runtime lacks readFile/sha256)
// and passed via args. Prior results are passed via args for cache comparison.
// The 4 mechanical checks are split into per-check agents so each can be independently
// cached. When a check's fingerprint matches a prior cached result, the agent is skipped.
// No fingerprints → fall back to full dispatch (conservative).
// Cache updates are returned in verifyCacheUpdates for the caller to persist across
// invocations.

const cacheFingerprints = args.cacheFingerprints || {}
const priorVerifyCache = args.priorVerifyCache || {}

// Extract milestone number for script invocations
const _milestone = (args.charterFile.match(/M(\d+)/) || [])[1] || '<extracted-from-charter>'

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

// Schema for mechanical check results
const MECH_SCHEMA = { type: 'object', required: ['check', 'ok'], properties: {
  check: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' }, source: { type: 'string' },
} }

// ── Dispatch only checks that need fresh execution ──
// Each mechanical check is a separate agent so caching can skip individual checks.
// Cache-hit entries are null and filtered out before parallel dispatch.
const _dispatchList = [
  !_cachedCeiling      ? () => agent(
    `FIRST extract gap-XXX-style IDs from the charter's ## Scope and ## Done-when sections (e.g. UQ-042). Skip IDs in the **Task:** header. Skip DIR-NNN IDs entirely — directives are TASK-CANONICAL (DIR-028: the single source of truth is tasks/DIR-NNN.md's own status/dirStatus field, already verified when the charter was authored), not tracked in experiments/quay-continuous-bootstrap/gap-list.md, so it0-ceiling-check.sh (which only greps that legacy gap-list) cannot resolve them and a DIR-NNN citation must never be passed to it. If NO gap-XXX IDs found (directive-only or gap-list-irrelevant charter): return {check:"ceiling-check",ok:true,detail:"vacuous — no gap-list IDs in charter Scope/Done-when (DIR-NNN citations, if any, are TASK-CANONICAL and out of this check's scope)",source:"script"}. If gap-XXX IDs found: run bash experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh --milestone ${_milestone} <id1> <id2> ... and return {check:"ceiling-check",ok:<exit===0>,detail:"<stdout last 2000 chars>",source:"script"}.`,
    { label: 'ceiling-check', schema: MECH_SCHEMA }
  ) : null,
  !_cachedGateHash      ? () => agent(
    `Run: bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference ${args.charterFile}. Non-zero=GATE-HASH-REF mismatch; zero=hash matches. Return {check:"gate-hash",ok:<exit===0>,detail:"<stdout>",source:"script"}.`,
    { label: 'gate-hash', schema: MECH_SCHEMA }
  ) : null,
  !_cachedLineBudget    ? () => agent(
    `Run: bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh ${args.charterFile}. Non-zero=exceeds line budget; zero=within budget. Return {check:"line-budget",ok:<exit===0>,detail:"<stdout>",source:"script"}.`,
    { label: 'line-budget', schema: MECH_SCHEMA }
  ) : null,
  !_cachedDogfood       ? () => agent(
    `Run: bash experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh --milestone ${_milestone} ${args.charterFile}. Non-zero=evidence-gap; zero=all claimed clauses have nearby fenced evidence. Return {check:"dogfood-evidence",ok:<exit===0>,detail:"<stdout>",source:"script"}.`,
    { label: 'dogfood-evidence', schema: MECH_SCHEMA }
  ) : null,
  !_cachedDomainMisfit  ? () => agent(
    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to the milestone's Done-when list. Return {ok: true, step3conclusion} — ok indicates the check completed (always true when the procedure was applied); step3conclusion records whether a misfit was found. This check is INFORMATIONAL, never blocking.`,
    { label: 'domain-misfit', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, step3conclusion: { type: 'string' } } } }
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

// Domain-misfit: transform raw agent result to unified shape (handles both cached and fresh)
function _unifyDm(raw) {
  if (!raw) return null
  if (raw.check) return raw  // Already in unified shape (from cache)
  return { check: 'domain-misfit', ok: raw.ok !== false, detail: raw.step3conclusion || '', source: 'agent' }
}
const _dmEntry = _unifyDm(_cachedDomainMisfit) || _unifyDm(_fresh['domain-misfit'])

const allVerifyResults = [_ceiling, _gateHash, _lineBgt, _dogfood, _dmEntry].filter(Boolean)

// ── Build cache updates for caller to persist across invocations ──
let verifyCacheUpdates = {}
for (const r of allVerifyResults) {
  const fp = cacheFingerprints[r.check]
  if (fp) verifyCacheUpdates[r.check] = { fingerprint: fp, result: r }
}

// A null/missing result for an uncached check means the agent crashed — treat as failure (fail-closed).
const scriptCount = [_ceiling, _gateHash, _lineBgt, _dogfood].filter(Boolean).length
const verifyFailed = allVerifyResults.length < 5 || allVerifyResults.some(c => !c.ok)
if (verifyFailed) {
  log(`Verify phase FAILED — ${allVerifyResults.filter(c => !c.ok).map(c => c.check).join(', ')} did not pass. Journal: ${JSON.stringify(allVerifyResults)}`)
  return { outcome: 'needs-human', reason: 'it0-checks-failed', phase: 'Verify', verifyJournal: allVerifyResults, verifyCacheUpdates }
}
log(`Verify phase PASSED — all ${allVerifyResults.length} it0 checks green (${scriptCount} script + ${_dmEntry ? 1 : 0} agent).`)

// ── Phase: Build (step 5) ───────────────────────────────────────────────────────────
phase('Build')
const buildResult = await agent(
    `BUILD the inner iteration for milestone task ${args.taskId}. DO THE ACTUAL WORK — you are the build executor, not a dispatcher.

Charter file: ${args.charterFile}
Absorb entry path: ${args.absorbEntryFile}

1. PRE-FLIGHT: ensure extra.acceptance is set on the task via task_write:
   extra.acceptance = "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh ${args.taskId} ${args.charterFile} ${args.absorbEntryFile}"

2. CLASS-ROUTE: This is a development-class task (capability-growth). Read the task body and charter, then implement each item in the Done-when list.

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

4. EVIDENCE: Write iteration report to milestones/M<NN>/iterations/iteration-0.md (extract milestone number from charter path).

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

  if (buildResult?.outcome === 'needs-human') {
    return { outcome: 'needs-human', reason: buildResult?.reason || 'build-failed', phase: 'Build', verifyCacheUpdates }
  }

// ── Phase: Audit (step 6 acceptance audit) ──────────────────────────────────────────
phase('Audit')
const auditResult = await agent(
  `ADVERSARIAL ACCEPTANCE AUDIT for milestone task ${args.taskId}. FRESH CONTEXT — you have NOT seen the build.

CHARGE (refute-first stance):
1. AC SATISFACTION: read the task file tasks/${args.taskId}.md's ## Acceptance Criteria.
   For EACH criterion, try to REFUTE that it is actually met — citing the concrete
   artifact/test output/diff, NOT the implementer's self-report. Any AC you cannot
   confirm → REFUTED.
1a. CHECKLIST WRITE-BACK (DIR-020): for each confirmed AC/DoD item, WRITE BACK to the
    task file ticking - [x] with evidence citation. Leave - [ ] for unconfirmed items.
2. DoD SATISFACTION: confirm the task's ## Definition of Done is satisfied.
3. MECHANICAL GATE: run experiments/quay-perpetual-stream/scripts/it0-dod-check.sh ${args.taskId} ${args.charterFile}
   ${args.absorbEntryFile}. Non-zero exit = REFUTED by construction.
4. DEVIATION-LOG WRITE-BACK (DIR-017 Step 3 / M36): if you find a REFUTED or CONCERNS,
   write a deviation row to dashboard.md's "Homeostatic variables (DIR-017 Step 3)" table:
   (i) caught-by: machine — your OWN finding this same pass; (ii) caught-by: human — an
   ABSORB entry disclosure the outer loop already drafted (the audit transcribes it, does
   not originate it). Each row must carry level / caught-by / caught-at / description /
   status (open) / age (0). This is the SAME audit agent performing the write-back — no
   separate writer, no split timing.

Output to milestones/M<NN>/audits/iteration-0-acceptance-audit.md.
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
const gates = await parallel([
  () => agent(`Run vmeta-lag-check.sh --counter <extract current milestone_counter from experiments/quay-perpetual-stream/dashboard.md minus 1> experiments/quay-perpetual-stream/v-meta-ledger.md. This reads the V_meta ledger (NOT the absorb entry). Return {ok, detail}. Non-zero = ALARM → HARD BLOCK.`,
    { label: 'vmeta-lag', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run it0-dashboard-line-budget-check.sh. Return {ok, detail}. Non-zero = dashboard exceeds 1200-line cap → HARD BLOCK.`,
    { label: 'dash-budget', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run tree-hygiene-check.sh. Return {ok, detail}. Non-zero = un-gitignored scratch on master → HARD BLOCK.`,
    { label: 'tree', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run worktree-branch-hygiene-check.sh. Return {ok, detail}. Non-zero = orphaned milestone evidence → HARD BLOCK.`,
    { label: 'worktree', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run quay gate --gate split-or-commit ${args.taskId}. Return {ok, detail}. Non-zero = SPLIT-OR-COMMIT violation (DIR-026: parent-done-iff-children, SELECT-split, child-link-symmetry, OR needs-human reason is in-project rather than external) → HARD BLOCK.`,
    { label: 'split-or-commit', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
])

const gatesFailed = gates.filter(Boolean).some(g => !g.ok)
if (gatesFailed) {
  log('Gate phase FAILED — one or more mechanical gates did not pass. Marking needs-human.')
  await agent(
    `Mark task ${args.taskId} needs-human. Record which gates failed and why in the ABSORB entry at ${args.absorbEntryFile}. Gates: ${JSON.stringify(gates.filter(Boolean))}`,
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
    `Mark task ${args.taskId} needs-human with reason: audit REFUTED — ${auditResult?.detail}. VERIFY the needs-human reason is EXTERNAL (outside project control: external service/resource/credential/dataset/upstream) — if it is an IN-PROJECT reason (architecture mismatch, complexity, scope, "too hard"), that is a SPLIT-OR-COMMIT violation (DIR-026/Clause 9). Record needs-human with the audited reason in the ABSORB entry.`,
    { label: 'mark-needs-human-refuted' }
  )
  return { outcome: 'needs-human', reason: 'audit-refuted', phase: 'Land', verifyCacheUpdates }
}

const IS_CONCURRENT = args.mode === 'concurrent'

// ── Concurrent path (DIR-075/M142): defers shared-state writes to fan-in ──────────
if (IS_CONCURRENT) {
  const concurrentResult = await agent(
    `LAND (concurrent mode) the milestone for task ${args.taskId}. IN CONCURRENT MODE:
   you are part of a multi-milestone batch — do NOT update milestone_counter or dashboard.md
   (those writes are deferred to the serial fan-in absorb step that follows).

1. MERGE the iteration worktree into master (DIR-027: loop runs on master directly).
   Any conflict → per-file resolution, both sides read, reconciliation note recorded.
   Never a blanket --ours/--theirs (DIR-013).
2. CAPTURE then PRUNE (DIR-033): if a non-primary iteration produced evidence not on
   master, cherry-pick JUST that evidence file. Then git worktree remove + git branch -d
   the now-merged branches.
3. EXECUTION-PROVENANCE WRITE-BACK (M24): task_write to tasks/${args.taskId}.md
   appending a ## Execution record section (milestone id, iteration count, realized Δv,
   merge commit SHA, one-line outcome summary) and setting status: done.
4. COMPUTE touchedFiles: run \`git diff --numstat <merge-base>..<build-branch>\` to get the
   actual files touched by this build. The merge-base is \`git merge-base origin/master HEAD\`
   or the commit recorded in the build result (${
     buildResult?.mergeCommit ? buildResult.mergeCommit : 'from Build phase'
   }). Collect the changed file paths (column 3 of numstat output) into a flat array.
5. DRAFT a one-line dashboard entry for this milestone: "m<NN> · ${args.taskId} · Δv=<realized> ·
   audit=${auditResult?.verdict || 'NO REFUTATION FOUND'} · merge=<SHORT sha> · → milestones/<NN>/"

Charter: ${args.charterFile}
Build outcome: ${JSON.stringify(buildResult)}
Audit verdict: ${auditResult?.verdict}

Return {taskId: "${args.taskId}", outcome: "done", mergeCommit: "<40-char SHA>",
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
  log(`Land phase complete (concurrent) — milestone ${args.taskId} done, touched ${(concurrentResult?.touchedFiles || []).length} files.`)
  return { outcome: 'done', taskId: args.taskId, mergeCommit: concurrentResult?.mergeCommit,
    touchedFiles: concurrentResult?.touchedFiles, dashboardEntry: concurrentResult?.dashboardEntry, verifyCacheUpdates }
}

// ── Serial path (default): existing behavior unchanged — inline counter++ and dashboard ─
await agent(
  `LAND the milestone for task ${args.taskId}.

1. MERGE the iteration worktree into master (DIR-027: loop runs on master directly).
   Any conflict → per-file resolution, both sides read, reconciliation note recorded.
   Never a blanket --ours/--theirs (DIR-013).
2. CAPTURE then PRUNE (DIR-033): if a non-primary iteration produced evidence not on
   master, cherry-pick JUST that evidence file. Then git worktree remove + git branch -d
   the now-merged branches.
3. WRITE ABSORB log entry into dashboard.md's ## Log section (DIR-054 rolling-window
   format): m<NN> · <task-id> · Δv=<realized> · audit=<verdict> · merge=<sha> · → milestones/M<NN>/
4. UPDATE DASHBOARD (step 7): VT (sum weight·cov), slope (marginal Δv), ρ, charter-thickness,
   discovery-latency, calibration-error, V_meta consolidation lag, milestone_counter++
   (ONLY after all gates above cleared and master merge landed).
5. REGENERATE backlog.md/dashboard.md views via experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts.
6. RUN tree-hygiene-check.sh and worktree-branch-hygiene-check.sh one final time
   to confirm the close-out is clean. Paste results.
7. EXECUTION-PROVENANCE WRITE-BACK (M24): task_write to tasks/${args.taskId}.md
   appending a ## Execution record section (milestone id, iteration count, realized Δv,
   merge commit SHA, one-line outcome summary) and setting status: done.
8. PHI CONSOLIDATION CHECK: if a prior adaptation was REUSED UNCHANGED by THIS
   (different-domain) milestone, consolidate it into inherited-core.md and retire
   its citation (§4.2).

Charter: ${args.charterFile}
Absorb entry: ${args.absorbEntryFile}
Build outcome: ${JSON.stringify(buildResult)}
Audit verdict: ${auditResult?.verdict}

Return {taskId, outcome: 'done', mergeCommit, milestoneCounter}.`,
  { phase: 'Land',
    schema: { type: 'object', required: ['outcome'], properties: {
      taskId: { type: 'string' }, outcome: { type: 'string' },
      mergeCommit: { type: 'string' }, milestoneCounter: { type: 'number' },
    } } }
)

log(`Land phase complete — milestone ${args.taskId} done.`)
return { outcome: 'done', taskId: args.taskId, verifyCacheUpdates }