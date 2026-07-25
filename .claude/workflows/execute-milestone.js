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

// NOTE (M136 fix): DIR-079 per-check incremental caching (readFile+sha256) removed from
// this workflow script — the workflow JS runtime has no filesystem API. Until the runtime
// grows fs support or cache is passed via args, all 5 it0 checks run unconditionally.

const verify = await parallel([
  () => agent(
    `Run experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh --milestone M<NN> (extract milestone number from charter path ${args.charterFile}) against gap/directive IDs cited in the charter. Only extract IDs from the Scope and Done-when sections — skip the **Task:** header and parenthetical references like "(DIR-xxx)". With --milestone, CLOSED is acceptable (exit 0); only NOT-FOUND → exit 1. If no extractable scope IDs found, exit 0 vacuously. Return {ok, detail}.`,
    { label: 'ceiling-check', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }
  ),
  () => agent(
    `Run it0-gate-hash-check.sh --by-reference ${args.charterFile}. Non-zero exit = undeclared paraphrase of the HARD GATES block. Return {ok, detail}.`,
    { label: 'gate-hash', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }
  ),
  () => agent(
    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to the milestone's Done-when list. Return {ok: true, step3conclusion} — ok indicates the check completed (always true when the procedure was applied); step3conclusion records whether a misfit was found. This check is INFORMATIONAL, never blocking.`,
    { label: 'domain-misfit', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, step3conclusion: { type: 'string' } } } }
  ),
  () => agent(
    `Run it0-ceiling-line-budget-check.sh ${args.charterFile}. FLAG (exit 1) = scope exceeds ~2000-line ceiling with no phase/stage plan reference. Return {ok, detail}.`,
    { label: 'line-budget', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }
  ),
  () => agent(
    `Run experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh --milestone M<NN> (extract milestone number from charter path ${args.charterFile}, e.g. M139-it0-scoping.md → M139). With --milestone, scans only current milestone's iteration reports. Return {ok, detail}.`,
    { label: 'dogfood-evidence', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }
  ),
])

// A null return means the agent crashed — treat as failure (fail-closed).
const verifyFailed = verify.filter(Boolean).some(c => c === null || !c?.ok)
if (verifyFailed) {
  log('Verify phase FAILED — it0 checks did not all pass. Aborting milestone.')
  return { outcome: 'needs-human', reason: 'it0-checks-failed', phase: 'Verify' }
}
log(`Verify phase PASSED — all ${verify.filter(Boolean).length} it0 checks green.`)

// ── Phase: Build (step 5) ───────────────────────────────────────────────────────────
phase('Build')
const buildResult = await agent(
  `Execute the inner iteration for milestone task ${args.taskId}.

Charter file: ${args.charterFile}
Absorb entry path: ${args.absorbEntryFile}

BEFORE BUILD: ensure extra.acceptance is set on the task (task_write extra.acceptance to
"bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh ${args.taskId} ${args.charterFile} ${args.absorbEntryFile}").
The Gate phase's quay gate call depends on this field — fail-closed if absent.

CLASS-ROUTE per inherited-core.md's two-class diversity policy:
- DEVELOPMENT-class (capability-growth typed): run proposal→plan pipeline FIRST
  (invoke quay-task-to-plan skill), then implement with TDD ≥80% hard gate.
- METHODOLOGY/DESIGN-class (discovery/governance-integrity typed): whole-milestone
  independent dual-iteration (iteration-0 builds, iteration-1 re-derives from fresh worktree).

Per iteration: use baime:iteration-executor fed the charter (Tier-A) only. For
development-class, also feed the checked plan.

Dispatch the inner iteration as a harness-tracked background agent in an isolated git
worktree off master HEAD. Return the dispatch result — do NOT wait for completion.

TERMINATE on first of (§3.2): Done-when complete | ΔV<0.02 K=2 consecutive |
ceiling→redesign | past budget≈10 & nothing climbing | external HALT.

Return {taskId, outcome, iterationCount, mergeCommit, worktreePath, harnessTaskId}.`,
  { phase: 'Build', isolation: 'worktree',
    schema: { type: 'object', required: ['outcome'], properties: {
      taskId: { type: 'string' }, outcome: { type: 'string' },
      iterationCount: { type: 'number' }, mergeCommit: { type: 'string' },
      harnessTaskId: { type: 'string' },
    } } }
)

// If Build dispatched a background task (not yet complete), return building status.
// The caller (outer loop) handles poll/heartbeat/resume — NOT the Build agent.
// The harness-tracked background task completion notification is the PRIMARY wake.
// The fallbackMs below is a hang-detection BACKSTOP only, not a polling cadence (DIR-078).
if (buildResult?.outcome === 'dispatched' || buildResult?.harnessTaskId) {
  // Adaptive fallback by charter scope (DIR-078): small=300s, medium=600s, large=1200s.
  const scopeText = (buildResult?.scope || '').toLowerCase()
  const fallbackMs = /large|>200\s*lines|>5\s*files/i.test(scopeText) ? 1200000
    : /small|≤50\s*lines|[12]\s*files/i.test(scopeText) ? 300000
    : 600000
  log(`Build phase dispatched background task: ${buildResult.harnessTaskId} (fallback=${fallbackMs/1000}s)`)
  return { outcome: 'building', buildTaskId: buildResult.harnessTaskId, phase: 'Build', fallbackMs }
}

log(`Build phase complete: outcome=${buildResult?.outcome}`)

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
Return {verdict: 'NO REFUTATION FOUND'|'CONCERNS'|'REFUTED', detail, concernsDetail}.`,
  { phase: 'Audit',
    schema: { type: 'object', required: ['verdict'], properties: {
      verdict: { type: 'string' }, detail: { type: 'string' },
    } } }
)
log(`Audit phase complete: verdict=${auditResult?.verdict}`)

// ── Phase: Gate (step 6 all mechanical checks) ──────────────────────────────────────
phase('Gate')
const gates = await parallel([
  () => agent(`Run vmeta-lag-check.sh --counter <current pre-increment milestone_counter> ${args.absorbEntryFile}. Return {ok, detail}. Non-zero = ALARM → HARD BLOCK.`,
    { label: 'vmeta-lag', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run it0-impl-row-check.sh ${args.taskId}. Return {ok, detail}. Non-zero = required -IMPL row missing → HARD BLOCK.`,
    { label: 'impl-row', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run quay gate ${args.taskId} (DoD meta-enforcer). Return {ok, detail, gateOutput}. Non-zero = HARD BLOCK.`,
    { label: 'dod-meta', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' }, gateOutput: { type: 'string' } } } }),
  () => agent(`Run it0-dashboard-line-budget-check.sh. Return {ok, detail}. Non-zero = dashboard exceeds 1200-line cap → HARD BLOCK.`,
    { label: 'dash-budget', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run tree-hygiene-check.sh. Return {ok, detail}. Non-zero = un-gitignored scratch on master → HARD BLOCK.`,
    { label: 'tree', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run worktree-branch-hygiene-check.sh. Return {ok, detail}. Non-zero = orphaned milestone evidence → HARD BLOCK.`,
    { label: 'worktree', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
  () => agent(`Run audit-independence-check.sh against the audit artifact at milestones/M<NN>/audits/iteration-0-acceptance-audit.md and the dispatch-record at ${args.absorbEntryFile}. Return {ok, detail}. Non-zero = audit not independent → HARD BLOCK.`,
    { label: 'audit-indep', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } }),
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
  return { outcome: 'needs-human', reason: 'gate-failed', phase: 'Gate' }
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
  return { outcome: 'needs-human', reason: 'audit-refuted', phase: 'Land' }
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
    touchedFiles: concurrentResult?.touchedFiles, dashboardEntry: concurrentResult?.dashboardEntry }
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
return { outcome: 'done', taskId: args.taskId }