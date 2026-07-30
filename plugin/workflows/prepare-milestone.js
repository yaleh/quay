export const meta = {
  name: 'prepare-milestone',
  description: 'DIR-117: orchestrates the existing quay-task-to-plan pipeline (proposal authors -> adjudication/write-back -> BOUNDED grounded proposal review incl. mechanism-claim wiring coverage -> Plan author -> grounded Plan-check) as a real, resumable lifecycle stage between SELECT/charter-authoring and execute-milestone. Writes a verification RECEIPT (milestones/M<NN>/preparation.json) — never a second content source; the task ## Proposal and docs/plans/*.md stay authoritative. STATUS (M193/DIR-125): ProposalReview is now a bounded convergence loop (1 full synthesis + <=2 delta rounds ordinary / <=3 highRisk, 45m/75m soft budget, typed disposition-tracked finding ledger hash-bound into the receipt) — closes the DIR-120/M192 unbounded-restart defect (10 consecutive full-regeneration rounds, ~3h15m, ~1.13M output tokens, never reaching PlanAuthor). STATUS (M191/DIR-117): landed + unit-tested (milestone-preparation-check.ts), NOT yet operationally proven end-to-end on a real OUTER-LOOP cycle — that real-landing proof is DIR-117-B\'s own scope (DIR-026 SPLIT-OR-COMMIT, DIR-119-A/B/C precedent).',
  phases: [
    { title: 'Admission', detail: 'DIR-126-A/M200: single-flight admission — acquires an atomic filesystem lease for (workspace, taskId) via prepare-admission-check.ts before any ProposalAuthors agent is dispatched; a losing concurrent dispatch returns prepare-already-running here, spending zero agent turns' },
    { title: 'Preflight', detail: 'M201/DIR-126-B: deterministic mechanical rejection of five failure classes via prepare-admission-check.ts --preflight/--preflight-plan, dispatched BEFORE any content-generation/review agent — content checks gate ProposalAuthors, the Plan-shape check gates PlanCheck round 1; a blocking finding returns revision-needed/preflight-rejected, spending zero proposal-author/adjudicate/proposal-review/plan-check agent turns' },
    { title: 'ProposalAuthors', detail: 'N=2 (N=3 if highRisk) independent agents each draft a reconciled Proposal' },
    { title: 'Adjudicate', detail: 'One agent reconciles the N proposals into ONE Proposal, writes it back to the task' },
    { title: 'ProposalReview', detail: 'DIR-125 bounded convergence: ONE full independent review, then (only if blocking findings remain) up to 2 (3 highRisk) focused-revise + delta-review rounds against a typed finding ledger, gated by a 45m/75m soft budget and a subsystem/mechanism/touch-set split checkpoint' },
    { title: 'PlanAuthor', detail: 'Authors docs/plans/M<NN>-<slug>.md mapping every AC to phases/stages' },
    { title: 'PlanCheck', detail: 'Up to 3 rounds; independent (non-author) agent grounds-checks the Plan; success only at F_i=0' },
    { title: 'Receipt', detail: 'Writes milestones/M<NN>/preparation.json + proposal-ledger.json (derived verification receipt + finding ledger only)' },
  ],
}

// DIR-114 (M175) / drain-directives.js precedent: normalize the `args` global once, up front.
const $a = (typeof args === 'string') ? JSON.parse(args) : args

// gap-prepare-milestone-noisy-agent-raw-json-parse (M202/DIR-126-C, first real Workflow-dispatched
// exercise of the Preflight phase — Build's own DoD evidence used a mocked-agent harness that
// never reproduced this): an `agent()` dispatch instructed to "report stdout verbatim" can still
// include stderr noise it saw alongside stdout (confirmed real: a Node
// MODULE_TYPELESS_PACKAGE_JSON warning line prepended before the real JSON in one real dispatch's
// reported `raw`, even though the SAME CLI invocation's stdout was clean JSON) — a naive
// `JSON.parse(result.raw)` then throws and the workflow fails closed on a call that actually
// succeeded. Every `{raw: ...}`-shaped agent result in this file's every verdict is always a JSON
// OBJECT (never a top-level array) — this helper tries every `{` occurrence in order (not just the
// first) and returns the first balanced, valid-JSON object span, so noise containing its OWN
// bracket-shaped text (confirmed real: the Node warning's own
// "[MODULE_TYPELESS_PACKAGE_JSON]" text is itself a bracket pair that a naive first-bracket search
// would wrongly anchor on) cannot derail parsing of the real object that follows.
function _parseAgentJson(raw) {
  if (typeof raw !== 'string') return null
  for (let start = raw.indexOf('{'); start >= 0; start = raw.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try { return JSON.parse(raw.slice(start, i + 1)) } catch { break }
        }
      }
    }
  }
  return null
}

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

// M197 (gap-prepare-milestone-cross-generation-no-incremental-reuse): DIR-125's bounded-convergence
// guarantee only covers rounds WITHIN one generation — a FRESH dispatch after a prior generation
// ended needs-human/crashed always re-derived a brand-new Proposal from scratch via ProposalAuthors
// + Adjudicate, discarding any manual fix already applied to the on-disk Proposal (confirmed real
// recurrence: DIR-119-D/M196 hit the identical class of wiring-coverage defect on 3 consecutive
// fresh dispatches). `$a.resumeFromAdjudicatedProposal === true` is an explicit caller opt-in — set
// AFTER a human/agent has manually repaired the task's on-disk `## Proposal` following a prior
// generation's needs-human/crash — that skips ProposalAuthors/Adjudicate entirely and enters
// directly at ProposalReview using the task's CURRENT `## Proposal` as-is (the ProposalReview
// phase's own agents already `task_get` the task fresh, so no extra plumbing is needed to feed them
// the resumed text). When false/absent (the default), behavior is byte-for-byte unchanged from
// before this change.
let _resumeFromAdjudicatedProposal = $a.resumeFromAdjudicatedProposal === true

// DIR-117 iteration-2 item 2: every phase captures its OWN real `$CLAUDE_CODE_SESSION_ID` (the
// same DIR-093 pattern `execute-milestone.js`'s Audit phase already uses for `auditSessionId`) so
// the Receipt phase can populate a receipt `provenance` block that milestone-preparation-check.ts
// mechanically verifies for DISTINCTNESS — never a caller-asserted "trust me, independent" claim.
const _sessionIdInstruction = 'BEFORE returning, run `echo $CLAUDE_CODE_SESSION_ID` to discover your REAL session id (set by the harness, cannot be forged) and include it as `sessionId` in your structured output.'

// ── Phase: Admission — DIR-126-A/M200 single-flight admission ───────────────────────────────
// Runs UNCONDITIONALLY, first, strictly ahead of BOTH the resume branch's log-only
// phase('ProposalAuthors') AND the cold path's real phase('ProposalAuthors') below. A resumed
// dispatch still performs real task_writes downstream (ProposalReview's revision step) and is
// exactly as vulnerable to a racing second owner as the cold path — skipping Admission on the
// resume branch would reopen the exact cross-generation race M197's
// gap-prepare-milestone-cross-generation-no-incremental-reuse already fixed once. Acquires an
// atomic, filesystem-backed lease (prepare-admission-check.ts's --acquire, fs.writeFileSync 'wx')
// for (workspace, taskId) BEFORE any ProposalAuthors agent is dispatched — the concrete mechanism
// that prevents the ~54-duplicate-workflow-minute cost DIR-126's own Finding measured, since the
// expensive resource (LLM agent turns) is never spent by the losing dispatch.
phase('Admission')

const _admissionScript = 'experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts'

async function _admissionAgentCall(flagsText, label) {
  return agent(
    `Run exactly this shell command and report its stdout verbatim:
node --experimental-strip-types ${_admissionScript} ${flagsText}
Do not paraphrase or reformat the command's stdout — copy it exactly as printed. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    { label, phase: 'Admission', schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } } }
  )
}

// Renewal at every phase boundary (WIRING-CLAIM 3) — six distinct call sites across this file
// (Adjudicate entry, ProposalReview entry, each ProposalReview delta round, PlanAuthor entry, each
// PlanCheck round, Receipt entry). The workflow DSL has confirmed zero try/finally semantics, so
// this is dispatched explicitly at each boundary rather than inherited from exception unwinding.
async function _renewLease(stageLabel) {
  return _admissionAgentCall(`--renew --taskId ${_taskId} --workspace . --stage ${JSON.stringify(stageLabel)}`, `admission-renew-${stageLabel}`)
}

// M202/DIR-126-C: proposal-convergence.ts's new thin CLI tail — the SAME agent()-wraps-a-real-CLI
// shape every dispatch in this file already uses, just pointed at a different, in-Touches script
// (proposal-convergence.ts, never prepare-admission-check.ts — see the task's own Problem framing
// for why that boundary is load-bearing).
const _convergenceScript = 'experiments/quay-perpetual-stream/scripts/proposal-convergence.ts'

async function _convergenceAgentCall(flagsText, label) {
  return agent(
    `Run exactly this shell command and report its stdout verbatim:
node --experimental-strip-types ${_convergenceScript} ${flagsText}
Do not paraphrase or reformat the command's stdout — copy it exactly as printed. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    { label, phase: 'Preflight', schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } } }
  )
}

// M202/DIR-126-C: replaces the bare `_releaseLease` at every one of this file's 15 real
// post-Admission terminal-return sites. Dispatches proposal-convergence.ts's `--record-generation`
// (which piggybacks the SAME lease release `_releaseLease` used to make, per Chosen mechanism)
// under the SAME `admission-release-${stageLabel}` label `_releaseLease` used — label continuity
// keeps the out-of-Touches e2e mock's `/^admission-release-/` fail-closed dispatch chain matching
// unchanged, and the per-terminal dispatch count stays exactly 1 (fire-and-forget: callers await
// and never parse the result, exactly as today). `cacheable` is `true` ONLY for the two
// CACHEABLE_TERMINALS-allowlisted {terminalPhase, reason} pairs (PreflightContent/
// preflight-rejected, ProposalReview/split-recommended); `false` everywhere else.
async function _releaseLeaseAndRecord(stageLabel, { terminalPhase, outcome, reason, cacheable }) {
  return _convergenceAgentCall(
    `--record-generation --taskId ${_taskId} --workspace . --charterFile ${_charterFile} --terminalPhase ${terminalPhase} --outcome ${outcome} --reason ${JSON.stringify(reason)} --cacheable ${cacheable}`,
    `admission-release-${stageLabel}`
  )
}

// M201/DIR-126-B: sibling helper to _admissionAgentCall, dispatching the SAME
// agent()-wraps-a-real-CLI shape against prepare-admission-check.ts's new --preflight/
// --preflight-plan modes — not a new dispatch mechanism.
async function _preflightAgentCall(flagsText, label) {
  return agent(
    `Run exactly this shell command and report its stdout verbatim:
node --experimental-strip-types ${_admissionScript} ${flagsText}
Do not paraphrase or reformat the command's stdout — copy it exactly as printed. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    { label, phase: 'Preflight', schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } } }
  )
}

const _admissionResult = await _admissionAgentCall(`--acquire --taskId ${_taskId} --workspace . ${_highRisk ? '--highRisk' : ''}`.trim(), 'admission-acquire')

let _admissionVerdict = _admissionResult?.raw ? _parseAgentJson(_admissionResult.raw) : null

if (!_admissionVerdict || (_admissionVerdict.outcome !== 'acquired' && _admissionVerdict.outcome !== 'prepare-already-running')) {
  // AC2 fail-closed path: bad CLI invocation / unexpected exception / unparseable output — NEVER
  // silently falls through to ProposalAuthors as if admission had succeeded. Distinct reason code
  // (admission-check-failed) from an ordinary lease-contention verdict (prepare-already-running).
  log(`Admission phase FAILED — no parseable acquire/contention verdict (raw: ${_admissionResult?.raw ?? '(none)'}). Failing closed, never dispatching ProposalAuthors.`)
  return { outcome: 'needs-human', reason: 'admission-check-failed', phase: 'Admission', detail: _admissionResult?.raw ?? '(agent returned no output)' }
}

if (_admissionVerdict.outcome === 'prepare-already-running') {
  log(`Admission: prepare-already-running — an active lease is held by ${_admissionVerdict.owner?.ownerExecutionId} (stage=${_admissionVerdict.owner?.stage}, leaseUntil=${_admissionVerdict.owner?.leaseUntil}). Returning before any ProposalAuthors agent is dispatched — zero author agent turns spent.`)
  return { outcome: 'needs-human', reason: 'prepare-already-running', phase: 'Admission', owner: _admissionVerdict.owner }
}

log(`Admission: acquired lease for ${_taskId} (fencingToken=${_admissionVerdict.lease?.fencingToken}, reclaimed=${_admissionVerdict.reclaimed === true}).`)

// ── Resume decision — M202/DIR-126-C: generation-aware resume ───────────────────────────
// Runs ONLY when the caller OMITS $a.resumeFromAdjudicatedProposal entirely — an explicit true/
// false value (M197's own pre-existing opt-in/opt-out) makes ZERO --decide-resume dispatches at
// all (WIRING-CLAIM R2), keeping that path's observable dispatch count and returned outcome/
// reason/phase shapes byte-identical to pre-this-child behavior (AC6). Strictly BETWEEN Admission
// success and content phase('Preflight') — a reuse-terminal short-circuit below returns BEFORE
// phase('Preflight') is ever entered, so the mechanical content check is itself skipped on a cache
// hit (WIRING-CLAIM R4's sharpened form), and the return structurally precedes ProposalReview
// (phase('ProposalReview') below) and PlanAuthor/Receipt in file order — it cannot advance to
// either (AC5's structural half).
if ($a.resumeFromAdjudicatedProposal === undefined) {
  // gap-prepare-milestone-workflow-dynamic-import (M203/DIR-126-D): the workflow DSL has
  // confirmed zero fs/import capability (the same constraint every other file-touching operation
  // in this script already respects via the agent()-wraps-CLI dispatch pattern) — a prior draft's
  // local `existsSync(...)` pre-check via `await import('node:fs')` is not actually reachable at
  // runtime and fails the phase outright ("import() is not available in workflow scripts",
  // confirmed real via a live Workflow dispatch, M203/DIR-126-D's own first attempt). The intended
  // optimization (skip the --decide-resume dispatch entirely when no prior generation record could
  // possibly exist) is not achievable without an agent-dispatched file check, which would itself
  // cost the very dispatch the optimization exists to avoid — so it is dropped: --decide-resume is
  // now dispatched unconditionally whenever the flag is omitted, relying on
  // decideResumeGeneration's own evaluation step 4 (missing/null priorGenerationRecord -> cold) to
  // correctly and safely handle a never-before-seen task, at the cost of one extra real CLI
  // dispatch (not an agent-content dispatch) on that task's very first attempt.
  {
    const _decideResult = await _convergenceAgentCall(`--decide-resume --taskId ${_taskId} --workspace . --charterFile ${_charterFile}`, 'resume-decision')
    const _decideVerdict = _decideResult?.raw ? _parseAgentJson(_decideResult.raw) : null
    if (!_decideVerdict || typeof _decideVerdict.decision !== 'string') {
      log(`Resume-decision phase FAILED — no parseable verdict (raw: ${_decideResult?.raw ?? '(none)'}). Failing closed, never silently treated as cold or resume.`)
      return { outcome: 'needs-human', reason: 'resume-decision-failed', phase: 'Preflight' }
    }
    if (_decideVerdict.releaseResult && _decideVerdict.releaseResult.ok !== true) {
      log(`Resume-decision: '${_decideVerdict.decision}' selected but the embedded lease release FAILED (releaseResult: ${JSON.stringify(_decideVerdict.releaseResult)}) — never reporting a clean cache hit with a stranded owner.`)
      return { outcome: 'needs-human', reason: 'reuse-terminal-release-failed', phase: 'Preflight' }
    }
    if (_decideVerdict.decision === 'reuse-terminal') {
      // The SAME --decide-resume invocation above already released the lease (embedded, no
      // second dispatch — WIRING-CLAIM R3) and deliberately did NOT overwrite .generation.json
      // (WIRING-CLAIM R6) — this return precedes phase('Preflight') itself, so zero Preflight/
      // ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor/PlanCheck dispatches happen.
      log(`Resume-decision: reuse-terminal — unchanged generation terminal (priorGenerationId=${_decideVerdict.priorGenerationId}, priorReason=${_decideVerdict.priorReason}). Zero Preflight/ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor/PlanCheck dispatches; lease already released inline.`)
      return {
        outcome: _decideVerdict.priorOutcome ?? 'needs-human',
        reason: 'unchanged-generation-terminal',
        priorReason: _decideVerdict.priorReason,
        decision: 'reuse-terminal',
        priorGenerationId: _decideVerdict.priorGenerationId,
        phase: 'Preflight',
      }
    }
    // decision === 'resume' -> _resumeFromAdjudicatedProposal = true (same branch as explicit
    // true); decision === 'cold' -> false (same branch as explicit false).
    _resumeFromAdjudicatedProposal = _decideVerdict.decision === 'resume'
    log(`Resume-decision: ${_decideVerdict.decision} (${_decideVerdict.reason}).`)
  }
}

// ── Phase: Preflight (content) — M201/DIR-126-B ──────────────────────────────────────
// Deterministic mechanical rejection of the four content failure classes (merged Markdown claims,
// stale AC/DoD refs, task-vs-charter Touches mismatch, missing precedent) BEFORE any
// ProposalAuthors agent is dispatched. Runs UNCONDITIONALLY here, strictly before the
// resume-vs-cold branch below — both a resumed dispatch and a cold dispatch see the SAME
// already-available task/charter content at this point (same unconditional-placement precedent
// Admission itself already established), so both are equally protected.
phase('Preflight')

const _preflightContentResult = await _preflightAgentCall(`--preflight --taskId ${_taskId} --charterFile ${_charterFile} --workspace .`, 'preflight-content')
let _preflightContentVerdict = _preflightContentResult?.raw ? _parseAgentJson(_preflightContentResult.raw) : null

if (!_preflightContentVerdict || typeof _preflightContentVerdict.ok !== 'boolean') {
  // Fail-closed (AC: "Preflight CLI exits non-zero / unparseable JSON") — mirrors Admission's own
  // admission-check-failed branch, never silently treated as "no findings".
  log(`Preflight (content) phase FAILED — no parseable verdict (raw: ${_preflightContentResult?.raw ?? '(none)'}). Failing closed, never dispatching ProposalAuthors.`)
  await _releaseLeaseAndRecord('preflight-check-failed', { terminalPhase: 'PreflightContent', outcome: 'needs-human', reason: 'preflight-check-failed', cacheable: false })
  return { outcome: 'needs-human', reason: 'preflight-check-failed', phase: 'Preflight', detail: _preflightContentResult?.raw ?? '(agent returned no output)' }
}

const _preflightContentBlocking = (_preflightContentVerdict.findings || []).filter((f) => f.blocking === true)
if (_preflightContentBlocking.length > 0) {
  // WIRING-CLAIM 3: this `return` precedes every proposal-author-*/adjudicate/proposal-review/
  // plan-check-* agent() call in file order — zero of those dispatches happen on this path,
  // structurally, not merely asserted.
  log(`Preflight (content) REJECTED — ${_preflightContentBlocking.length} blocking finding(s): ${_preflightContentBlocking.map((f) => f.code).join(', ')}. Zero proposal-author-*/adjudicate/proposal-review/plan-check-* dispatches on this path.`)
  await _releaseLeaseAndRecord('preflight-rejected', { terminalPhase: 'PreflightContent', outcome: 'revision-needed', reason: 'preflight-rejected', cacheable: true })
  return { outcome: 'revision-needed', reason: 'preflight-rejected', phase: 'Preflight', findings: _preflightContentVerdict.findings }
}
for (const f of (_preflightContentVerdict.findings || [])) {
  log(`Preflight (content) non-blocking finding: ${f.code} — ${f.message} (disposition: ${f.disposition}). Logged only — never merged into the DIR-125 _ledger.`)
}
log(`Preflight (content) PASSED — ${_taskId} may proceed to ProposalAuthors.`)

let _proposals = []
let adjudicateResult = null

if (_resumeFromAdjudicatedProposal) {
  // ── Phases: ProposalAuthors / Adjudicate — SKIPPED under resume mode ────────────────
  phase('ProposalAuthors')
  log(`resumeFromAdjudicatedProposal=true — skipping ProposalAuthors (would have dispatched ${_n} independent author(s)). Trusting task ${_taskId}'s CURRENT on-disk '## Proposal' as already-adjudicated (and possibly manually repaired) from a prior generation.`)
  phase('Adjudicate')
  log('resumeFromAdjudicatedProposal=true — skipping Adjudicate. No task_write to \'## Proposal\' is performed; ProposalReview reads the task\'s CURRENT Proposal as-is, byte-identical to what was on disk before this dispatch.')
} else {
  // ── Phase: ProposalAuthors ───────────────────────────────────────────────────────────
  phase('ProposalAuthors')

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

  _proposals = _proposalResults.filter(Boolean)
  if (_proposals.length < _n) {
    log(`ProposalAuthors phase: only ${_proposals.length}/${_n} authors returned a result.`)
    await _releaseLeaseAndRecord('proposal-author-incomplete', { terminalPhase: 'ProposalAuthors', outcome: 'revision-needed', reason: 'proposal-author-incomplete', cacheable: false })
    return { outcome: 'revision-needed', reason: 'proposal-author-incomplete', phase: 'ProposalAuthors' }
  }

  // ── Phase: Adjudicate ─────────────────────────────────────────────────────────────────
  phase('Adjudicate')
  await _renewLease('Adjudicate')

  adjudicateResult = await agent(
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
    await _releaseLeaseAndRecord('adjudicate-failed', { terminalPhase: 'Adjudicate', outcome: 'revision-needed', reason: 'adjudicate-failed', cacheable: false })
    return { outcome: 'revision-needed', reason: adjudicateResult?.error || 'adjudicate-failed', phase: 'Adjudicate' }
  }
}

// ── Phase: ProposalReview — DIR-125 BOUNDED convergence loop ─────────────────────────
// Closes the DIR-120/M192 defect: a nonzero review used to immediately return
// 'revision-needed', the CALLER restarted the whole workflow, and two new authors + a new
// adjudicator rewrote the complete Proposal before every review (10 consecutive full-regeneration
// rounds, ~3h15m, ~1.13M output tokens, never reaching PlanAuthor). Now: exactly ONE full
// independent review per generation; only unresolved BLOCKING findings trigger further work, via a
// focused reviser + independent delta reviewer (never the original authors/adjudicator again).
//
// The caps/budget literals below MUST match proposal-convergence.ts's `capsFor()` — this file has
// no import statements (established convention: see MAX_PLANCHECK_ROUNDS below), so the numbers
// are inlined here and cross-checked by proposal-convergence.test.mjs's own dedicated test.
phase('ProposalReview')
await _renewLease('ProposalReview')

// FIX (2026-07-28, real-dispatch crash found post-DIR-125): workflow scripts cannot call
// Date.now()/new Date() — the sandbox throws (it would break resume). `$a.now` as a FUNCTION is a
// test-only hook: the unit-test harness constructs `args` as a real JS object, bypassing JSON
// serialization; a genuine Workflow() dispatch always JSON-serializes `args`, so `$a.now` can
// never be a function in production — the OLD `() => Date.now()` fallback therefore crashed on
// EVERY real dispatch (100% reproducible, confirmed live). Real time now comes ONLY from agents'
// own execution environment: each review agent runs a real `date +%s%3N` shell call and reports
// the result as a plain number (`nowMs`) in its structured output. `_latestKnownNowMs` is seeded
// by the round-0 full review agent below and advanced by each subsequent delta-review agent — a
// legitimate, monotonically-advancing proxy for elapsed time, since real wall-clock time genuinely
// passes between agent dispatches.
let _latestKnownNowMs = null
const _now = (typeof $a.now === 'function') ? $a.now : () => _latestKnownNowMs
let _startedAtMs = null

// DIR-125 Requested-action item 3: fail-closed maxima. A caller MAY lower `$a.maxDeltaRounds`,
// never raise it above the policy ceiling.
const _policyCaps = { maxFullSynthesis: 1, maxDeltaRounds: _highRisk ? 3 : 2, softBudgetMs: (_highRisk ? 75 : 45) * 60 * 1000 }
const _requestedMaxDelta = Number.isFinite($a.maxDeltaRounds) ? $a.maxDeltaRounds : undefined
const _maxDeltaRounds = (_requestedMaxDelta !== undefined && _requestedMaxDelta < _policyCaps.maxDeltaRounds) ? _requestedMaxDelta : _policyCaps.maxDeltaRounds

const _VALID_DISPOSITIONS = ['plan', 'split', 'accepted-risk', 'backlog', 'duplicate', 'superseded']

// djb2-ish stable, non-cryptographic fingerprint — identity is anchored on (subsystem, claimRef)
// so a finding's id survives wording-only revisions to its summary/evidence (DIR-125 AC: "stable
// IDs across wording-only revisions"). The real cryptographic hash-BINDING of the ledger's full
// CONTENTS happens separately, in milestone-preparation-check.ts's sha256-based --ledger flag.
function _fingerprint(subsystem, claimRef, summary) {
  const key = claimRef ? `${subsystem}::claim::${claimRef}` : `${subsystem}::summary::${summary}`
  const norm = String(key).trim().toLowerCase().replace(/\s+/g, ' ')
  let h = 5381
  for (let i = 0; i < norm.length; i++) h = ((h * 33) ^ norm.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

let _ledger = []
function _upsertFindings(rawFindings, round) {
  const byId = new Map(_ledger.map((f) => [f.id, { ...f }]))
  for (const raw of (rawFindings || [])) {
    const blocking = raw.blocking === true
    const id = (raw.id && byId.has(raw.id)) ? raw.id : _fingerprint(raw.subsystem || 'unspecified', raw.claimRef, raw.summary)
    const existing = byId.get(id)
    const disposition = blocking ? 'unresolved' : (_VALID_DISPOSITIONS.includes(raw.disposition) ? raw.disposition : 'backlog')
    byId.set(id, {
      id,
      subsystem: raw.subsystem || existing?.subsystem || 'unspecified',
      summary: raw.summary || existing?.summary || '',
      severity: raw.severity || existing?.severity || 'major',
      blocking,
      everBlocking: blocking || existing?.everBlocking || false,
      disposition,
      evidence: raw.evidence || existing?.evidence || '',
      claimRef: raw.claimRef || existing?.claimRef || null,
      status: 'open',
      firstSeenRound: existing?.firstSeenRound ?? round,
      lastSeenRound: round,
    })
  }
  _ledger = [...byId.values()]
}
function _applyResolutions(resolvedIds, round) {
  const idSet = new Set(resolvedIds || [])
  _ledger = _ledger.map((f) => (idSet.has(f.id) ? { ...f, status: 'resolved', blocking: false, disposition: (f.disposition === 'unresolved' ? 'backlog' : f.disposition), lastSeenRound: round } : f))
}
function _blockingOpen() { return _ledger.filter((f) => f.blocking && f.status === 'open') }
function _splitCheck(mechanismCount) {
  const bySubsystem = {}
  for (const f of _blockingOpen()) bySubsystem[f.subsystem] = (bySubsystem[f.subsystem] || 0) + 1
  for (const [subsystem, count] of Object.entries(bySubsystem)) {
    if (count >= 3) return { recommend: true, code: 'split-subsystem-blocking-cluster', reason: `subsystem "${subsystem}" has ${count} independent blocking findings (>= 3)` }
  }
  if (Number.isFinite(mechanismCount) && mechanismCount > 2) {
    return { recommend: true, code: 'split-multi-mechanism', reason: `candidate contains ${mechanismCount} independently landable mechanisms (> 2)` }
  }
  return { recommend: false }
}

const _findingSchema = {
  type: 'object',
  properties: {
    subsystem: { type: 'string' }, summary: { type: 'string' }, severity: { type: 'string' },
    blocking: { type: 'boolean' }, evidence: { type: 'string' }, claimRef: { type: 'string' },
    disposition: { type: 'string' },
  },
}

const _proposalHashes = []

// ── Round 0: ONE full grounded review of the just-adjudicated Proposal. ──────────────
const _fullReviewResult = await agent(
  `INDEPENDENT review of task ${_taskId}'s just-reconciled \`## Proposal\` — you did NOT author it. Read the CURRENT task via \`task_get ${_taskId}\` (fresh, do not trust anything from a prior phase) against the real repository.

1. Verify the Proposal makes the implementation approach reviewable without re-designing it: problem framing grounded in current code, chosen mechanism, concrete control/data flow, key decisions, defaults/failure behavior, compatibility, risks, non-goals, AC coverage, explicit alternatives.
2. Mechanism-claim wiring coverage (DIR-117): extract every new call/dispatch/ownership/enforcement relationship the Proposal claims and confirm the task's own \`## Acceptance Criteria\` has a matching, falsifiable item demanding real production-callsite or cross-generation reachability evidence for THAT relationship (not descriptive prose restating the claim).
3. DIR-125 typed findings — report EVERY finding as a typed object, never a bare count. A finding is BLOCKING (\`blocking:true\`) ONLY if it is one of: factual contradiction, unresolved safety/fail-closed behavior, missing production callsite/ownership enforcement, a new behavior with no falsifiable AC or accepted-risk decision, stale acceptance wiring, or a scope cluster requiring split. Every other valuable finding is non-blocking and MUST carry exactly one disposition: plan, split, accepted-risk, backlog, duplicate, or superseded — never silently drop a real finding.
4. ${_sessionIdInstruction}
5. BEFORE returning, run \`date +%s%3N\` (real epoch milliseconds) and include the result as \`nowMs\` (a number) — the orchestrating workflow script cannot read the clock itself.
6. Return {findings: [{subsystem, summary, severity: "blocker"|"major"|"minor"|"nit", blocking: <boolean>, evidence, claimRef, disposition}], mechanismCount: <integer count of independently landable mechanisms this Proposal contains>, proposalHash: <a short hash/fingerprint you compute over the reviewed Proposal text, any stable digest is fine>, nowMs: <the real epoch-ms number from step 5>, sessionId: <your real session id>}. Use findings: [] if there are none.`,
  { label: 'proposal-review', phase: 'ProposalReview',
    schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: _findingSchema }, mechanismCount: { type: 'number' }, proposalHash: { type: 'string' }, nowMs: { type: 'number' }, sessionId: { type: 'string' } } } }
)

const _reviewSessions = []
const _reviserSessions = []
if (_fullReviewResult?.sessionId) _reviewSessions.push(_fullReviewResult.sessionId)
if (_fullReviewResult?.proposalHash) _proposalHashes.push({ round: 0, hash: _fullReviewResult.proposalHash })
if (Number.isFinite(_fullReviewResult?.nowMs)) _latestKnownNowMs = _fullReviewResult.nowMs
_startedAtMs = _now()

// Backward compat (DIR-125 AC: "zero-finding first-review fixture remains backward-compatible"):
// a legacy reviewer/mock may still return a bare `findings: <number>` — 0 is a zero-finding pass;
// nonzero is filed as ONE untyped blocking finding so the SAME bounded loop still applies rather
// than silently trusting a shape this phase no longer natively emits.
let _rawFindings = _fullReviewResult?.findings
if (typeof _rawFindings === 'number') {
  _rawFindings = _rawFindings === 0 ? [] : [{ subsystem: 'unspecified', summary: _fullReviewResult?.findingsDetail || 'legacy-scalar-finding', severity: 'major', blocking: true }]
}
_upsertFindings(Array.isArray(_rawFindings) ? _rawFindings : [], 0)

// ── DIR-117-B/M195 (AC #4): MECHANICAL mechanism-claim wiring coverage ──────────────
// ProposalReview now calls wiring-coverage-check.ts's REAL checkWiringCoverage() function directly
// — NOT prompt-only LLM guidance (the exact "prompt-guidance mistaken for production wiring" defect
// M191's independent audit §3 found and DIR-122's corrected AC6 forbids). Workflow scripts cannot
// `import` (sandboxed/resumable), so we dispatch an agent to run the module's CLI — the SAME
// dispatch pattern the Receipt and Prepared phases already use for milestone-preparation-check.ts,
// no new mechanism class. The SCRIPT (not the LLM) then merges the returned BLOCKING findings into
// the typed ledger via the existing `_upsertFindings(..., 0)` path above, so this phase's
// open-blocking count increments by the function's REAL return value (`findings.length`), and the
// ledger is hash-bound into the receipt via the Receipt phase's `--ledger` flag. The LLM reviewer's
// prompt-level wiring step (review item 2) is RETAINED as a complementary heuristic — no longer the
// only check. A non-parseable verdict (agent crash / CLI exit 2) fails the phase CLOSED, mirroring
// the revise-failed `needs-human` path, rather than silently skipping coverage.
const _wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'
const _wiringVerdict = await agent(
  `Run exactly this command and return its parsed stdout JSON:
node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md
This is the DIR-117-B/M195 mechanism-claim wiring coverage check — it calls the real checkWiringCoverage() function on the task's '## Proposal' vs '## Acceptance Criteria' and prints a JSON verdict on stdout shaped {ok, code, message, claims, findings}. Return that JSON verbatim: {ok: <boolean>, code: <one of wiring-coverage-complete | wiring-coverage-none-claimed | wiring-coverage-uncovered>, findings: <the findings array EXACTLY as printed, each {subsystem, summary, severity, blocking, evidence, claimRef, disposition}>}. If the command exits non-zero or prints no parseable JSON, return {ok: false, code: "wiring-cli-failed", findings: []}.`,
  { label: 'wiring-coverage-check', phase: 'ProposalReview',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, code: { type: 'string' }, findings: { type: 'array', items: _findingSchema } } } }
)
const _wiringVerdictCodes = ['wiring-coverage-complete', 'wiring-coverage-none-claimed', 'wiring-coverage-uncovered']
if (!_wiringVerdict || !_wiringVerdictCodes.includes(_wiringVerdict.code)) {
  log(`ProposalReview wiring-coverage sub-step FAILED — no parseable verdict (${_wiringVerdict?.code || 'no-result'}); failing the phase closed rather than skipping coverage.`)
  await _releaseLeaseAndRecord('wiring-coverage-check-failed', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'wiring-coverage-check-failed', cacheable: false })
  return { outcome: 'needs-human', reason: 'wiring-coverage-check-failed', phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
_upsertFindings(Array.isArray(_wiringVerdict.findings) ? _wiringVerdict.findings : [], 0)
log(`ProposalReview wiring coverage: ${_wiringVerdict.code} — merged ${Array.isArray(_wiringVerdict.findings) ? _wiringVerdict.findings.length : 0} blocking wiring finding(s) from checkWiringCoverage()'s real return value.`)

const _mechanismCount = Number.isFinite(_fullReviewResult?.mechanismCount) ? _fullReviewResult.mechanismCount : undefined
let _deltaRound = 0
let _terminalReason = null
let _splitRecommendation = null

while (true) {
  const openBlocking = _blockingOpen()
  if (openBlocking.length === 0) { _terminalReason = 'zero-finding'; break }

  const split = _splitCheck(_mechanismCount)
  if (split.recommend) { _splitRecommendation = split; _terminalReason = 'split-recommended'; break }

  const _elapsedMs = _now() - _startedAtMs
  if (_elapsedMs >= _policyCaps.softBudgetMs) { _terminalReason = 'soft-budget-exceeded'; break }

  if (_deltaRound >= _maxDeltaRounds) { _terminalReason = 'delta-cap-exhausted'; break }

  _deltaRound += 1
  log(`ProposalReview: ${openBlocking.length} blocking finding(s) open — dispatching focused revision + delta review round ${_deltaRound}/${_maxDeltaRounds}.`)
  await _renewLease(`ProposalReview-delta-round-${_deltaRound}`)

  const _reviseResult = await agent(
    `Focused Proposal reviser for task ${_taskId}, delta round ${_deltaRound}/${_maxDeltaRounds}. Do NOT re-derive the Proposal from scratch and do NOT act as an independent author — resolve ONLY these recorded blocking findings against the CURRENT task ${_taskId} \`## Proposal\`, preserving every other section/sentence unchanged:

${openBlocking.map((f) => `- [${f.id}] (${f.subsystem}) ${f.summary}${f.evidence ? ` — evidence: ${f.evidence}` : ''}`).join('\n')}

1. Read the current Proposal via \`task_get ${_taskId}\`.
2. Edit ONLY what is needed to resolve the findings above; write the revised Proposal back via \`task_write\` (splice into \`## Proposal\`, preserve every other section).
3. ${_sessionIdInstruction}
4. Return {ok: true, proposalHash: <a short hash/fingerprint over the revised Proposal text>, sessionId: <your real session id>}. If task_write fails, return {ok: false, error: <reason>}. Do NOT self-report which findings are resolved — the INDEPENDENT delta reviewer (next step) makes that determination, not you.`,
    { label: `proposal-revise-round-${_deltaRound}`, phase: 'ProposalReview',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, proposalHash: { type: 'string' }, error: { type: 'string' }, sessionId: { type: 'string' } } } }
  )
  if (_reviseResult?.sessionId) _reviserSessions.push(_reviseResult.sessionId)
  if (_reviseResult?.proposalHash) _proposalHashes.push({ round: _deltaRound, hash: _reviseResult.proposalHash })
  if (!_reviseResult || _reviseResult.ok !== true) {
    log(`ProposalReview focused revision round ${_deltaRound} FAILED: ${_reviseResult?.error || '(agent returned nothing)'}`)
    await _releaseLeaseAndRecord('proposal-revise-failed', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'proposal-revise-failed', cacheable: false })
    return { outcome: 'needs-human', reason: _reviseResult?.error || 'proposal-revise-failed', phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
  }

  const _deltaReviewResult = await agent(
    `INDEPENDENT delta review, round ${_deltaRound}/${_maxDeltaRounds}, of task ${_taskId}'s just-revised \`## Proposal\` — you did NOT author or revise it. Read the CURRENT task via \`task_get ${_taskId}\`.

Previously recorded open blocking findings:
${openBlocking.map((f) => `- [${f.id}] (${f.subsystem}) ${f.summary}`).join('\n')}

1. For each finding id above, confirm whether it is now resolved.
2. Report ONLY currently-open findings (blocking or non-blocking) as the \`findings\` array — a finding you already reported before and consider unchanged should be reported again with the SAME subsystem/claimRef so it keeps its identity. Do NOT re-run a full independent Proposal re-derivation.
3. ${_sessionIdInstruction}
4. BEFORE returning, run \`date +%s%3N\` (real epoch milliseconds) and include the result as \`nowMs\` (a number) — the orchestrating workflow script cannot read the clock itself.
5. Return {resolvedIds: [<ids from the list above now resolved>], findings: [<any still-open findings, typed the same way as the full review>], nowMs: <the real epoch-ms number from step 4>, sessionId: <your real session id>}.`,
    { label: `proposal-delta-review-round-${_deltaRound}`, phase: 'ProposalReview',
      schema: { type: 'object', properties: { resolvedIds: { type: 'array', items: { type: 'string' } }, findings: { type: 'array', items: _findingSchema }, nowMs: { type: 'number' }, sessionId: { type: 'string' } } } }
  )
  if (_deltaReviewResult?.sessionId) _reviewSessions.push(_deltaReviewResult.sessionId)
  _applyResolutions(_deltaReviewResult?.resolvedIds, _deltaRound)
  _upsertFindings(_deltaReviewResult?.findings, _deltaRound)
  if (Number.isFinite(_deltaReviewResult?.nowMs)) _latestKnownNowMs = _deltaReviewResult.nowMs
}

if (_terminalReason === 'split-recommended') {
  log(`ProposalReview: split recommended — ${_splitRecommendation.reason}`)
  await _releaseLeaseAndRecord('split-recommended', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'split-recommended', cacheable: true })
  return { outcome: 'needs-human', reason: 'split-recommended', splitRecommendation: _splitRecommendation, phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
if (_terminalReason === 'soft-budget-exceeded') {
  log(`ProposalReview: soft budget (${_policyCaps.softBudgetMs / 60000}m) exceeded with ${_blockingOpen().length} blocking finding(s) still open.`)
  await _releaseLeaseAndRecord('soft-budget-exceeded', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'soft-budget-exceeded', cacheable: false })
  return { outcome: 'needs-human', reason: 'soft-budget-exceeded', phase: 'ProposalReview', ledger: _ledger, elapsedMs: _now() - _startedAtMs, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
if (_terminalReason === 'delta-cap-exhausted') {
  log(`ProposalReview: delta-review cap (${_maxDeltaRounds}) exhausted with ${_blockingOpen().length} blocking finding(s) still open.`)
  await _releaseLeaseAndRecord('delta-cap-exhausted', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'delta-cap-exhausted', cacheable: false })
  return { outcome: 'needs-human', reason: 'delta-cap-exhausted', phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
log(`ProposalReview PASSED — zero open blocking findings after 1 full synthesis + ${_deltaRound} delta round(s); ${_ledger.length} total finding(s) recorded.`)

// ── Phase: PlanAuthor ─────────────────────────────────────────────────────────────────
phase('PlanAuthor')
await _renewLease('PlanAuthor')

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
  await _releaseLeaseAndRecord('plan-author-failed', { terminalPhase: 'PlanAuthor', outcome: 'revision-needed', reason: 'plan-author-failed', cacheable: false })
  return { outcome: 'revision-needed', reason: planAuthorResult?.error || 'plan-author-failed', phase: 'PlanAuthor' }
}

// ── Phase: Preflight (plan-shape) — M201/DIR-126-B ───────────────────────────────────
// Gates PlanCheck round 1 — a logically distinct insertion point from the content checks above
// (the Plan file structurally cannot exist before PlanAuthor runs, so it cannot be preflighted at
// the same point), still logically part of the SAME 'Preflight' phase label (re-entered here, the
// same way PlanCheck itself is re-entered across rounds).
phase('Preflight')

const _preflightPlanResult = await _preflightAgentCall(`--preflight-plan --taskId ${_taskId} --workspace . --planFile ${_planFile}`, 'preflight-plan')
let _preflightPlanVerdict = _preflightPlanResult?.raw ? _parseAgentJson(_preflightPlanResult.raw) : null

if (!_preflightPlanVerdict || typeof _preflightPlanVerdict.ok !== 'boolean') {
  log(`Preflight (plan-shape) phase FAILED — no parseable verdict (raw: ${_preflightPlanResult?.raw ?? '(none)'}). Failing closed, never dispatching PlanCheck.`)
  await _releaseLeaseAndRecord('preflight-check-failed', { terminalPhase: 'PreflightPlan', outcome: 'needs-human', reason: 'preflight-check-failed', cacheable: false })
  return { outcome: 'needs-human', reason: 'preflight-check-failed', phase: 'Preflight', detail: _preflightPlanResult?.raw ?? '(agent returned no output)' }
}

const _preflightPlanBlocking = (_preflightPlanVerdict.findings || []).filter((f) => f.blocking === true)
if (_preflightPlanBlocking.length > 0) {
  // WIRING-CLAIM 4: this `return` precedes MAX_PLANCHECK_ROUNDS's loop entirely — zero
  // plan-check-round-* dispatches happen on this path, structurally.
  log(`Preflight (plan-shape) REJECTED — ${_preflightPlanBlocking.length} blocking finding(s): ${_preflightPlanBlocking.map((f) => f.code).join(', ')}. Zero plan-check-round-* dispatches on this path.`)
  // M202/DIR-126-C WIRING-CLAIM R5/R7: this is the PLAN-SHAPE preflight-rejected site — records
  // terminalPhase 'PreflightPlan' (NOT the coarse 'Preflight' both call sites otherwise share, and
  // NOT 'PreflightContent'), and cacheable:false — the SAME 'preflight-rejected' reason string as
  // the content-preflight site above is NOT allowlisted at this terminalPhase, deliberately: it
  // depends on Plan-file content this mechanism's hashes never cover, and a real PlanAuthor agent
  // has already run by the time it fires.
  await _releaseLeaseAndRecord('preflight-rejected', { terminalPhase: 'PreflightPlan', outcome: 'revision-needed', reason: 'preflight-rejected', cacheable: false })
  return { outcome: 'revision-needed', reason: 'preflight-rejected', phase: 'Preflight', findings: _preflightPlanVerdict.findings }
}
for (const f of (_preflightPlanVerdict.findings || [])) {
  log(`Preflight (plan-shape) non-blocking finding: ${f.code} — ${f.message} (disposition: ${f.disposition}). Logged only.`)
}
log(`Preflight (plan-shape) PASSED — ${_taskId} may proceed to PlanCheck.`)

// ── Phase: PlanCheck (up to 3 rounds; F_i=0 required) ────────────────────────────────
phase('PlanCheck')

let _planCheckFindings = 1
let _planCheckRound = 0
const MAX_PLANCHECK_ROUNDS = 3
const _planCheckSessions = []

while (_planCheckRound < MAX_PLANCHECK_ROUNDS) {
  _planCheckRound += 1
  await _renewLease(`PlanCheck-round-${_planCheckRound}`)
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
  await _releaseLeaseAndRecord('plancheck-rounds-exceeded', { terminalPhase: 'PlanCheck', outcome: 'revision-needed', reason: 'plancheck-rounds-exceeded', cacheable: false })
  return { outcome: 'revision-needed', reason: 'plancheck-rounds-exceeded', phase: 'PlanCheck' }
}

// ── Phase: Receipt ────────────────────────────────────────────────────────────────────
phase('Receipt')
await _renewLease('Receipt')

// DIR-117 iteration-2 item 2: thread the REAL, distinct session ids captured by each phase above
// into the receipt's --build command, so buildReceipt() records real provenance — never a
// caller-asserted "trust me, independent" value. `_planCheckSessions` already accumulates one
// entry per round (>=1 by construction, since the loop only exits after a real dispatch).
// M197: under resumeFromAdjudicatedProposal, `_proposals` is `[]` and `adjudicateResult` is `null`
// (those phases never ran) — record 'resumed-skipped' rather than 'unknown', which is reserved for
// a genuine failure-to-capture on a phase that DID run. checkProvenanceDistinctness() (DIR-117
// iteration-2 item 2 / gap-provenance-sessionid-not-independence-signal) does not require
// proposalAuthors/adjudicator presence — only reviewer/planAuthor/planCheckers — so this never
// blocks the Prepared gate.
const _provenanceFlags = ` --proposal-author-sessions ${_proposals.length ? _proposals.map((p) => p.sessionId || 'unknown').join(',') : 'resumed-skipped'} --adjudicator-session ${adjudicateResult ? (adjudicateResult.sessionId || 'unknown') : 'resumed-skipped'} --review-session ${_reviewSessions[0] || 'unknown'} --plan-author-session ${planAuthorResult.sessionId || 'unknown'} --plancheck-sessions ${_planCheckSessions.join(',') || 'unknown'}`

// DIR-125: the derived finding ledger + convergence metrics live BESIDE the receipt (never a
// second copy of the Proposal/Plan themselves — see the ledger entries above, which hold only
// subsystem/summary/severity/blocking/disposition/evidence/claimRef/status, not prose duplicates).
// The receipt's --ledger flag hash-binds this file's CURRENT content (sha256) so a later swap for
// a newer/different ledger — or pairing this receipt with a Proposal edited after the fact — fails
// the existing preparation check (ledger-stale / proposal-stale) rather than silently passing.
const _ledgerFile = `milestones/${_milestoneId}/proposal-ledger.json`
const _ledgerJson = JSON.stringify(_ledger, null, 2)
const _endedAtMs = _now()
// M197: fullSynthesisCount records whether ProposalAuthors+Adjudicate actually ran THIS dispatch —
// 0 under resumeFromAdjudicatedProposal (skipped), 1 on the cold/default path (unchanged). This is
// the value validateConvergenceCounters()'s existing `fullSynthesisCount > 1` fail-closed check
// re-verifies on the receipt side; 0 and 1 both pass, >1 still fails regardless of which path
// produced the receipt (no new exemption introduced — see proposal-convergence.ts).
const _fullSynthesisCount = _resumeFromAdjudicatedProposal ? 0 : 1
const _convergence = {
  highRisk: _highRisk,
  fullSynthesisCount: _fullSynthesisCount,
  deltaRounds: _deltaRound,
  proposalReviewRounds: 1 + _deltaRound,
  terminalReason: 'zero-finding',
  reachedPlanAuthor: true,
  startedAtMs: _startedAtMs,
  endedAtMs: _endedAtMs,
  proposalHashes: _proposalHashes,
}
const _convergenceJson = JSON.stringify(_convergence)

const receiptResult = await agent(
  `Write the preparation receipt + finding ledger for task ${_taskId} / milestone ${_milestoneId}.

1. Write the file ${_ledgerFile} with EXACTLY this content (create parent directories as needed):

\`\`\`json
${_ledgerJson}
\`\`\`

2. Run: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --build --task-id ${_taskId} --milestone-id ${_milestoneId} --task ${_taskFile} --charter ${_charterFile} --plan ${_planFile} --review-findings 0 --plancheck-rounds ${_planCheckRound} --plancheck-findings 0 --ledger ${_ledgerFile} --convergence-json '${_convergenceJson}' --out ${_receiptFile}${_provenanceFlags}

(Add --sources <comma-separated list> naming every source file the Plan-check actually inspected, and --touches <comma-separated list> matching the checked Plan's declared touch set, if either is non-empty — read them from the Plan file at ${_planFile}.)

3. Then run: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --task ${_taskFile} --charter ${_charterFile} --receipt ${_receiptFile}

Return {ok: <step-3 command exit === 0>, receiptFile: "${_receiptFile}", detail: <step-3 command's printed line>}.`,
  { label: 'receipt', phase: 'Receipt',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, receiptFile: { type: 'string' }, detail: { type: 'string' } } } }
)

if (!receiptResult || receiptResult.ok !== true) {
  log(`Receipt phase FAILED self-check: ${receiptResult?.detail || '(agent returned nothing)'}`)
  await _releaseLeaseAndRecord('receipt-selfcheck-failed', { terminalPhase: 'Receipt', outcome: 'revision-needed', reason: 'receipt-selfcheck-failed', cacheable: false })
  return { outcome: 'revision-needed', reason: 'receipt-selfcheck-failed', phase: 'Receipt' }
}

log(`Prepared: ${_taskId} — receipt at ${_receiptFile}, ledger at ${_ledgerFile}, Plan at ${_planFile}, ${_planCheckRound} Plan-check round(s), ${_fullSynthesisCount} full synthesis${_resumeFromAdjudicatedProposal ? ' (resumed — ProposalAuthors/Adjudicate skipped)' : ''} + ${_deltaRound} delta round(s), zero open blocking findings.`)

// Final release (WIRING-CLAIM 2, line-497-class success return): the single most safety-critical
// site — a verifier who stops at "11 named outcome sites" would never check this one, since it is
// the file's own final success return, additional to and not folded into the other 11.
await _releaseLeaseAndRecord('prepared', { terminalPhase: 'Receipt', outcome: 'prepared', reason: 'prepared', cacheable: false })

return {
  outcome: 'prepared',
  taskId: _taskId,
  milestoneId: _milestoneId,
  planFile: _planFile,
  receiptFile: _receiptFile,
  ledgerFile: _ledgerFile,
  planCheckRounds: _planCheckRound,
  fullSynthesisCount: _fullSynthesisCount,
  resumed: _resumeFromAdjudicatedProposal,
  deltaRounds: _deltaRound,
  ledger: _ledger,
  reviewSessions: _reviewSessions,
  reviserSessions: _reviserSessions,
}
