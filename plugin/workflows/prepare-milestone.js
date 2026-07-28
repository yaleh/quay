export const meta = {
  name: 'prepare-milestone',
  description: 'DIR-117: orchestrates the existing quay-task-to-plan pipeline (proposal authors -> adjudication/write-back -> grounded proposal review incl. mechanism-claim wiring coverage -> Plan author -> grounded Plan-check) as a real, resumable lifecycle stage between SELECT/charter-authoring and execute-milestone. Writes a verification RECEIPT (milestones/M<NN>/preparation.json) — never a second content source; the task ## Proposal and docs/plans/*.md stay authoritative. STATUS (M191): landed + unit-tested (milestone-preparation-check.ts), NOT yet operationally proven end-to-end on a real OUTER-LOOP cycle — that real-landing proof is DIR-117-B\'s own scope (DIR-026 SPLIT-OR-COMMIT, DIR-119-A/B/C precedent).',
  phases: [
    { title: 'ProposalAuthors', detail: 'N=2 (N=3 if highRisk) independent agents each draft a reconciled Proposal' },
    { title: 'Adjudicate', detail: 'One agent reconciles the N proposals into ONE Proposal, writes it back to the task' },
    { title: 'ProposalReview', detail: 'Independent (non-author) agent reviews the reconciled Proposal against the real repo, incl. mechanism-claim wiring coverage' },
    { title: 'PlanAuthor', detail: 'Authors docs/plans/M<NN>-<slug>.md mapping every AC to phases/stages' },
    { title: 'PlanCheck', detail: 'Up to 3 rounds; independent (non-author) agent grounds-checks the Plan; success only at F_i=0' },
    { title: 'Receipt', detail: 'Writes milestones/M<NN>/preparation.json (derived verification receipt only)' },
  ],
}

// DIR-114 (M175) / drain-directives.js precedent: normalize the `args` global once, up front.
const $a = (typeof args === 'string') ? JSON.parse(args) : args

const _taskId = $a.taskId
const _milestoneId = $a.milestoneId
const _charterFile = $a.charterFile
const _class = $a.class || 'development'
const _highRisk = $a.highRisk === true
const _taskFile = `tasks/${_taskId}.md`
const _receiptFile = `milestones/${_milestoneId}/preparation.json`

if (!_taskId || !_milestoneId || !_charterFile) {
  return { outcome: 'needs-human', reason: 'missing-required-args (taskId/milestoneId/charterFile)', phase: 'ProposalAuthors' }
}

// N=2 default / N=3 explicit-high-risk-only (DIR-117 Requested-action item 3 — standardizes the
// pre-existing drift where SKILL.md said N=3, its own prompt/design said N=2, and different
// records used incompatible convergence rules).
const _n = _highRisk ? 3 : 2

// ── Phase: ProposalAuthors ───────────────────────────────────────────────────────────
phase('ProposalAuthors')

// DIR-117 iteration-2 item 2: every phase captures its OWN real `$CLAUDE_CODE_SESSION_ID` (the
// same DIR-093 pattern `execute-milestone.js`'s Audit phase already uses for `auditSessionId`) so
// the Receipt phase can populate a receipt `provenance` block that milestone-preparation-check.ts
// mechanically verifies for DISTINCTNESS — never a caller-asserted "trust me, independent" claim.
const _sessionIdInstruction = 'BEFORE returning, run `echo $CLAUDE_CODE_SESSION_ID` to discover your REAL session id (set by the harness, cannot be forged) and include it as `sessionId` in your structured output.'

const _proposalPrompt = (authorIdx) => `Independent Proposal author ${authorIdx} of ${_n} for task ${_taskId} (class: ${_class}), milestone charter ${_charterFile}.

Read the CURRENT task (\`task_get ${_taskId}\`) and the charter file (${_charterFile}) — ground your Proposal in the actual current repository state, not in the existing task body's possibly-thin Proposal. Do NOT read the other author(s)' output — this must be an independently re-derived proposal, not a copy.

Draft a reconciled Proposal covering: problem framing (grounded in current code), chosen mechanism, concrete control/data flow, key design decisions, defaults and failure behavior, compatibility, risks, non-goals, AC coverage, and explicit alternatives considered and rejected.

Mechanism-claim wiring coverage (DIR-117): for every new call/dispatch/ownership/enforcement relationship you claim (e.g. "component X invokes Y"), note it explicitly so the review phase can check for a matching Acceptance Criteria item — do not just assert the relationship in prose without flagging it as a claim needing AC-level proof.

${_sessionIdInstruction}

Return {authorIdx: ${authorIdx}, proposalText: <the full Proposal markdown text, no ## heading>, sessionId: <your real session id>}.`

const _proposalResults = await parallel(
  Array.from({ length: _n }, (_, i) => () => agent(_proposalPrompt(i + 1), {
    label: `proposal-author-${i + 1}`, phase: 'ProposalAuthors',
    schema: { type: 'object', required: ['authorIdx', 'proposalText'], properties: { authorIdx: { type: 'number' }, proposalText: { type: 'string' }, sessionId: { type: 'string' } } },
  }))
)

const _proposals = _proposalResults.filter(Boolean)
if (_proposals.length < _n) {
  log(`ProposalAuthors phase: only ${_proposals.length}/${_n} authors returned a result.`)
  return { outcome: 'revision-needed', reason: 'proposal-author-incomplete', phase: 'ProposalAuthors' }
}

// ── Phase: Adjudicate ─────────────────────────────────────────────────────────────────
phase('Adjudicate')

const adjudicateResult = await agent(
  `Adjudicate ${_proposals.length} independent Proposal drafts for task ${_taskId} into ONE reconciled Proposal, then write it back.

Drafts:
${_proposals.map((p) => `--- Author ${p.authorIdx} ---\n${p.proposalText}`).join('\n\n')}

1. Reconcile into ONE Proposal that is at least as strong as the best individual draft — merge genuinely distinct insights, resolve contradictions by picking the more concrete/grounded option, and keep the required elements (problem framing, mechanism, control/data flow, key decisions, defaults/failure behavior, compatibility, risks, non-goals, AC coverage, alternatives considered and rejected).
2. WRITE the reconciled Proposal back to task ${_taskId}'s \`## Proposal\` section via \`task_write\` (replace the body's \`## Proposal\` section content; preserve every OTHER section of the body unchanged — read the full current body first, splice in the new Proposal text, then write the WHOLE body back).
3. ${_sessionIdInstruction}
4. Return {proposalText: <the final reconciled Proposal text>, ok: true, sessionId: <your real session id>}. If task_write fails, return {ok: false, error: <reason>}.`,
  { label: 'adjudicate', phase: 'Adjudicate',
    schema: { type: 'object', required: ['ok'], properties: { proposalText: { type: 'string' }, ok: { type: 'boolean' }, error: { type: 'string' }, sessionId: { type: 'string' } } } }
)

if (!adjudicateResult || adjudicateResult.ok !== true) {
  log(`Adjudicate phase FAILED: ${adjudicateResult?.error || '(agent returned nothing)'}`)
  return { outcome: 'revision-needed', reason: adjudicateResult?.error || 'adjudicate-failed', phase: 'Adjudicate' }
}

// ── Phase: ProposalReview (independent of the adjudicator — fresh context) ───────────
phase('ProposalReview')

const reviewResult = await agent(
  `INDEPENDENT review of task ${_taskId}'s just-reconciled \`## Proposal\` — you did NOT author it. Read the CURRENT task via \`task_get ${_taskId}\` (fresh, do not trust anything from a prior phase) against the real repository.

1. Verify the Proposal makes the implementation approach reviewable without re-designing it: problem framing grounded in current code, chosen mechanism, concrete control/data flow, key decisions, defaults/failure behavior, compatibility, risks, non-goals, AC coverage, explicit alternatives.
2. Mechanism-claim wiring coverage (DIR-117): run \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/task-schema-check.ts ${_taskFile}\` is NOT sufficient by itself for this — instead extract every new call/dispatch/ownership/enforcement relationship the Proposal claims and confirm the task's own \`## Acceptance Criteria\` has a matching, falsifiable item demanding real production-callsite or cross-generation reachability evidence for THAT relationship (not descriptive prose restating the claim). A claimed mechanism with no matching AC item is a nonzero-finding failure.
3. ${_sessionIdInstruction}
4. Return {findings: <integer count of unresolved issues, 0 if none>, findingsDetail: <list each finding with enough detail to fix it>, sessionId: <your real session id>}.`,
  { label: 'proposal-review', phase: 'ProposalReview',
    schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'number' }, findingsDetail: { type: 'string' }, sessionId: { type: 'string' } } } }
)

const _reviewFindings = reviewResult?.findings ?? 1
if (_reviewFindings !== 0) {
  log(`ProposalReview phase: ${_reviewFindings} unresolved finding(s) — ${reviewResult?.findingsDetail || ''}`)
  return { outcome: 'revision-needed', reason: 'proposal-review-nonzero-findings', phase: 'ProposalReview', findingsDetail: reviewResult?.findingsDetail }
}
log('ProposalReview phase PASSED — zero unresolved findings.')

// ── Phase: PlanAuthor ─────────────────────────────────────────────────────────────────
phase('PlanAuthor')

const _slug = _taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const _planFile = `docs/plans/${_milestoneId}-${_slug}.md`

const planAuthorResult = await agent(
  `Author the checked milestone Plan for task ${_taskId} (milestone ${_milestoneId}, charter ${_charterFile}) at ${_planFile}.

Read the task's current (just-adjudicated) \`## Proposal\` and \`## Acceptance Criteria\` via \`task_get ${_taskId}\`, and the charter file.

The Plan must: name the milestone/task/charter and base revision (current HEAD short-sha), declare the complete touch set, map EVERY task AC item to at least one ordered phase/stage, name real files and symbols, specify RED/implementation/GREEN (or equivalent mechanical checks) with expected exit behavior, classify each stage as code or prose, record line budgets and dependencies, and state guardrails/rollback/real-landing verification. Use the standardized stopping rule: at most 3 Plan-check rounds, success only at F_i=0.

MECHANICAL STAGE FORMAT (DIR-117 iteration-2 item 3 — milestone-preparation-check.ts's real, non-LLM structural check parses this EXACT shape; a Plan that omits it fails the Prepared gate even if the prose elsewhere is fine): for EACH stage, emit a block of the form

  ### Stage <N>: <title>
  - AC: <comma-separated 1-based indices into the task's own '## Acceptance Criteria' checklist that this stage covers>
  - Files: <comma-separated real file paths this stage touches>
  - Command: <the RED/implementation/GREEN mechanical check to run, e.g. a test/build command — "Check:" is an accepted synonym>

Every task AC item's index must appear in at least one stage's \`- AC:\` list, or the checked Plan will be rejected mechanically.

Write the file at ${_planFile}. Then update task ${_taskId}'s \`## Plan\` section (via \`task_write\`, splicing into the current body, preserving all other sections) to reference ${_planFile} (replacing any prior N/A/stale reference).

${_sessionIdInstruction}

Return {planFile: "${_planFile}", ok: true, sessionId: <your real session id>}. If either write fails, return {ok: false, error: <reason>}.`,
  { label: 'plan-author', phase: 'PlanAuthor',
    schema: { type: 'object', required: ['ok'], properties: { planFile: { type: 'string' }, ok: { type: 'boolean' }, error: { type: 'string' }, sessionId: { type: 'string' } } } }
)

if (!planAuthorResult || planAuthorResult.ok !== true) {
  log(`PlanAuthor phase FAILED: ${planAuthorResult?.error || '(agent returned nothing)'}`)
  return { outcome: 'revision-needed', reason: planAuthorResult?.error || 'plan-author-failed', phase: 'PlanAuthor' }
}

// ── Phase: PlanCheck (up to 3 rounds; F_i=0 required) ────────────────────────────────
phase('PlanCheck')

let _planCheckFindings = 1
let _planCheckRound = 0
const MAX_PLANCHECK_ROUNDS = 3
const _planCheckSessions = []

while (_planCheckRound < MAX_PLANCHECK_ROUNDS) {
  _planCheckRound += 1
  const checkResult = await agent(
    `INDEPENDENT grounded Plan check, round ${_planCheckRound}/${MAX_PLANCHECK_ROUNDS}, for ${_planFile} (task ${_taskId}) — you did NOT author this Plan.

Verify against the CURRENT repository: signatures, call sites, dependency order, commands, line budgets, stage classification (code vs prose), AC coverage (every task AC maps to >=1 stage), and touch-set completeness against the task/charter '## Touches' declaration.

${_sessionIdInstruction}

Return {findings: <integer count, 0 if none>, findingsDetail: <list each finding>, sessionId: <your real session id>}.`,
    { label: `plan-check-round-${_planCheckRound}`, phase: 'PlanCheck',
      schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'number' }, findingsDetail: { type: 'string' }, sessionId: { type: 'string' } } } }
  )
  _planCheckFindings = checkResult?.findings ?? 1
  if (checkResult?.sessionId) _planCheckSessions.push(checkResult.sessionId)
  if (_planCheckFindings === 0) {
    log(`PlanCheck round ${_planCheckRound} PASSED — F_i=0.`)
    break
  }
  log(`PlanCheck round ${_planCheckRound}: ${_planCheckFindings} finding(s) — ${checkResult?.findingsDetail || ''}`)
  if (_planCheckRound >= MAX_PLANCHECK_ROUNDS) break
  // Revise: re-invoke the Plan author with the findings before the next round.
  await agent(
    `Revise ${_planFile} (task ${_taskId}) to resolve these Plan-check findings, then re-write the file: ${checkResult?.findingsDetail || ''}`,
    { label: `plan-revise-round-${_planCheckRound}`, phase: 'PlanCheck',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } } } }
  )
}

if (_planCheckFindings !== 0) {
  log(`PlanCheck exhausted ${MAX_PLANCHECK_ROUNDS} rounds without reaching F_i=0.`)
  return { outcome: 'revision-needed', reason: 'plancheck-rounds-exceeded', phase: 'PlanCheck' }
}

// ── Phase: Receipt ────────────────────────────────────────────────────────────────────
phase('Receipt')

// DIR-117 iteration-2 item 2: thread the REAL, distinct session ids captured by each phase above
// into the receipt's --build command, so buildReceipt() records real provenance — never a
// caller-asserted "trust me, independent" value. `_planCheckSessions` already accumulates one
// entry per round (>=1 by construction, since the loop only exits after a real dispatch).
const _provenanceFlags = ` --proposal-author-sessions ${_proposals.map((p) => p.sessionId || 'unknown').join(',')} --adjudicator-session ${adjudicateResult.sessionId || 'unknown'} --review-session ${reviewResult.sessionId || 'unknown'} --plan-author-session ${planAuthorResult.sessionId || 'unknown'} --plancheck-sessions ${_planCheckSessions.join(',') || 'unknown'}`

const receiptResult = await agent(
  `Write the preparation receipt for task ${_taskId} / milestone ${_milestoneId}.

Run: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --build --task-id ${_taskId} --milestone-id ${_milestoneId} --task ${_taskFile} --charter ${_charterFile} --plan ${_planFile} --review-findings 0 --plancheck-rounds ${_planCheckRound} --plancheck-findings 0 --out ${_receiptFile}${_provenanceFlags}

(Add --sources <comma-separated list> naming every source file the Plan-check actually inspected, and --touches <comma-separated list> matching the checked Plan's declared touch set, if either is non-empty — read them from the Plan file at ${_planFile}.)

Then run: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --task ${_taskFile} --charter ${_charterFile} --receipt ${_receiptFile}

Return {ok: <second command exit === 0>, receiptFile: "${_receiptFile}", detail: <second command's printed line>}.`,
  { label: 'receipt', phase: 'Receipt',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, receiptFile: { type: 'string' }, detail: { type: 'string' } } } }
)

if (!receiptResult || receiptResult.ok !== true) {
  log(`Receipt phase FAILED self-check: ${receiptResult?.detail || '(agent returned nothing)'}`)
  return { outcome: 'revision-needed', reason: 'receipt-selfcheck-failed', phase: 'Receipt' }
}

log(`Prepared: ${_taskId} — receipt at ${_receiptFile}, Plan at ${_planFile}, ${_planCheckRound} Plan-check round(s), zero-finding review.`)

return {
  outcome: 'prepared',
  taskId: _taskId,
  milestoneId: _milestoneId,
  planFile: _planFile,
  receiptFile: _receiptFile,
  planCheckRounds: _planCheckRound,
}
