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

// M203/DIR-126-D Claim A.3: proposal-convergence.ts's new --record-attempt CLI submode, dispatched
// at the 3 pre-lease exit sites (missing-required-args, admission-check-failed,
// prepare-already-running) — none of which holds an Admission lease or can derive a real
// generationId. Defined here, BEFORE _taskId's own missing-required-args check, so that check can
// dispatch it too — the ONE new call this file gains before any lease exists. Fire-and-forget:
// telemetry is additive, its own result is never inspected/branched on, and the caller's existing
// return value/shape is byte-identical either way.
const _convergenceScript = 'experiments/quay-perpetual-stream/scripts/proposal-convergence.ts'

// M207 — per-phase-boundary timing accumulation + finding-code construction (purely additive
// telemetry, never a gate). `_phaseTimings` accumulates one closed {phase, round, startedAtMs,
// endedAtMs} span per SUCCESSFUL renewal boundary; `_lastBoundaryMs` is seeded from the parsed
// `--acquire` verdict's self-reported `nowMs` and advanced by each renewal's — the sandbox NEVER
// computes a timestamp itself (AC19's regression class f6db2a8/7357a91: zero Date.now()/new Date()/
// import() sites in this file; every value below is read out of already-parsed subprocess JSON).
// The trailing still-open span is closed RECEIVER-side (proposal-convergence.ts fills its
// `endedAtMs: null` with its own `recordedAtMs`), never here.
let _phaseTimings = []
let _lastBoundaryMs = null
// M207 — TDZ-safe finding-code construction. `let _ledger = []` is declared far below (in the
// ProposalReview section), textually AFTER four pre-ledger terminal exits that already call
// `_releaseLeaseAndRecord` — optional chaining does NOT bypass the temporal dead zone
// (`_ledger?.map(...)` still evaluates the binding and throws ReferenceError there), so this
// boolean short-circuit guard is the minimal correct form: `false` until `let _ledger = []` has
// actually executed, at which point it flips true and the ledger's own finding ids join the codes.
let _ledgerLive = false
function _findingCodesFor(reason) {
  return [reason, ...(_ledgerLive ? _ledger.map((f) => f.id) : [])]
}
// M207 — the `--phaseTimings` payload every record-writing terminal dispatch carries: the closed
// spans plus ONE trailing open `{..., endedAtMs: null}` entry the receiver closes with its own
// `recordedAtMs`. `round` is the constant 0 here (not `_deltaRound`/`_planCheckRound`): a terminal
// dispatch can fire BEFORE those `let` declarations execute (the same TDZ hazard `_ledgerLive`
// guards) — a formatted terminal label is presentation, and 0 is the honest round-agnostic value.
function _phaseTimingsForTerminal(stageLabel) {
  return [..._phaseTimings, { phase: stageLabel, round: 0, startedAtMs: _lastBoundaryMs, endedAtMs: null }]
}

async function _recordAttemptAgentCall(site, detailObj) {
  // _taskId may be genuinely absent (the missing-required-args site's whole point) — omit the
  // --taskId flag entirely rather than pass an empty value, so the shell command the agent
  // constructs never has an ambiguous/empty flag argument.
  const _taskIdFlag = _taskId ? `--taskId ${JSON.stringify(_taskId)} ` : ''
  // M207: the 3 pre-lease sites carry `--phaseTimings []` (by construction — missing-required-args
  // precedes --acquire entirely; the other two have zero completed spans) and `--findingCodes`
  // seeded from the site name alone (the `_ledgerLive` guard yields exactly `[site]` here). Both
  // flags ride the dispatch that already exists — no new dispatch, double-JSON.stringify idiom
  // matching --detail above.
  return agent(
    `Run exactly this shell command and report its stdout verbatim:
node --no-warnings --experimental-strip-types ${_convergenceScript} --record-attempt ${_taskIdFlag}--workspace . --site ${JSON.stringify(site)} --detail ${JSON.stringify(JSON.stringify(detailObj || {}))} --phaseTimings ${JSON.stringify(JSON.stringify([]))} --findingCodes ${JSON.stringify(JSON.stringify(_findingCodesFor(site)))}
Do not paraphrase or reformat the command's stdout — copy it exactly as printed. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    { label: `record-attempt-${site}`, phase: 'Admission', schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } } }
  )
}

if (!_taskId || !_milestoneId || !_charterFile) {
  await _recordAttemptAgentCall('missing-required-args', { taskId: _taskId || null, milestoneId: _milestoneId || null, charterFile: _charterFile || null })
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
node --no-warnings --experimental-strip-types ${_admissionScript} ${flagsText}
Do not paraphrase or reformat the command's stdout — copy it exactly as printed. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    { label, phase: 'Admission', schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } } }
  )
}

// Renewal at every phase boundary (WIRING-CLAIM 3) — six distinct call sites across this file
// (Adjudicate entry, ProposalReview entry, each ProposalReview delta round, PlanAuthor entry, each
// PlanCheck round, Receipt entry). The workflow DSL has confirmed zero try/finally semantics, so
// this is dispatched explicitly at each boundary rather than inherited from exception unwinding.
// M207: `round` is a second, caller-owned parameter — the integer the caller ALREADY holds in
// scope (`_deltaRound`, `_planCheckRound`, or 0 for the non-round sites), never regex-parsed from
// the formatted `stageLabel` (a label is presentation, not a structured-data source). All 6 call
// sites pass it explicitly and feed the response to `_recordPhaseBoundary` below.
async function _renewLease(stageLabel, round) {
  return _admissionAgentCall(`--renew --taskId ${_taskId} --workspace . --stage ${JSON.stringify(stageLabel)}`, `admission-renew-${stageLabel}`)
}

// M207: FIRST code ever to read anything out of a renewal response (100% discarded before this
// child). Parses via the existing `_parseAgentJson` balanced-brace scanner (never naive
// JSON.parse — agent stdout carries non-JSON noise, gap-prepare-milestone-noisy-agent-raw-json-
// parse) and pushes a span onto `_phaseTimings` ONLY under the rule `v.ok === true &&
// Number.isFinite(v.nowMs)` — matching renewLease's real `{ok: true, lease}` success shape (NOT
// an invented `outcome:'renewed'` literal, and NOT nowMs-presence alone: error verdicts also
// carry nowMs by design). A failed (ok:false, e.g. lease-missing) or unparseable/noisy renewal
// pushes NOTHING and leaves `_lastBoundaryMs` unchanged — fail-soft (telemetry is additive,
// never blocks the real gate); the next successful boundary yields a wider, correctly bounded
// span. `startedAtMs` is `_lastBoundaryMs` — seeded from the parsed --acquire verdict's `nowMs`
// (below) and advanced by each successful boundary — never a workflow-local clock read.
function _recordPhaseBoundary(stageLabel, round, r) {
  const v = r?.raw ? _parseAgentJson(r.raw) : null
  if (v && v.ok === true && Number.isFinite(v.nowMs)) {
    _phaseTimings.push({ phase: stageLabel, round, startedAtMs: _lastBoundaryMs, endedAtMs: v.nowMs })
    _lastBoundaryMs = v.nowMs
  }
}

// M202/DIR-126-C: proposal-convergence.ts's new thin CLI tail — the SAME agent()-wraps-a-real-CLI
// shape every dispatch in this file already uses, just pointed at a different, in-Touches script
// (proposal-convergence.ts, never prepare-admission-check.ts — see the task's own Problem framing
// for why that boundary is load-bearing). `_convergenceScript` itself is defined earlier (before
// _taskId's own missing-required-args check, M203/DIR-126-D) so _recordAttemptAgentCall can also
// use it.
async function _convergenceAgentCall(flagsText, label) {
  return agent(
    `Run exactly this shell command and report its stdout verbatim:
node --no-warnings --experimental-strip-types ${_convergenceScript} ${flagsText}
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
  // M203/DIR-126-D: `--decisionKind` threads this GENERATION's own cold/resume verdict
  // (`_resumeFromAdjudicatedProposal`, set by the resume-decision block above) into the committed
  // telemetry record's `decision.kind` — per the frozen schema, `cold|resume` for admitted
  // attempts, never the `not-evaluated` value reserved for the three pre-lease sites.
  // M207: `--phaseTimings` (closed spans + one trailing open entry the receiver closes with its
  // own recordedAtMs) and `--findingCodes` (terminal reason + ledger finding ids via the TDZ-safe
  // `_findingCodesFor` guard) ride THIS already-existing dispatch — no new dispatch, double-
  // JSON.stringify idiom matching _recordAttemptAgentCall's --detail.
  const _result = await _convergenceAgentCall(
    `--record-generation --taskId ${_taskId} --workspace . --charterFile ${_charterFile} --terminalPhase ${terminalPhase} --outcome ${outcome} --reason ${JSON.stringify(reason)} --cacheable ${cacheable} --milestoneId ${_milestoneId} --class ${_class} --highRisk ${_highRisk} --decisionKind ${_resumeFromAdjudicatedProposal ? 'resume' : 'cold'} --phaseTimings ${JSON.stringify(JSON.stringify(_phaseTimingsForTerminal(stageLabel)))} --findingCodes ${JSON.stringify(JSON.stringify(_findingCodesFor(reason)))}`,
    `admission-release-${stageLabel}`
  )
  // gap-prepare-milestone-task-epoch-budget-reset: EVERY post-Admission terminal ALSO persists this
  // generation's real accumulated epoch deltas — the SAME "one choke-point function every terminal
  // already calls" pattern this helper itself already established for --record-generation, never a
  // new per-terminal call site. Fire-and-forget (result unused), matching the existing convention.
  await _recordEpochDispatch(stageLabel, terminalPhase, reason)
  return _result
}

// M203/DIR-126-D Claim A.4 — Receipt-phase split, backing the restructured write-first/build/
// release sequence: _writeGenerationTelemetry dispatches --record-generation --no-release (writes
// .generation.json AND the new committed telemetry file, no release); _releaseLease dispatches
// --release-only (release only, no write). Both reuse _convergenceAgentCall's SAME
// agent()-wraps-a-real-CLI shape — no new dispatch mechanism. _releaseLease keeps the SAME
// `admission-release-${stageLabel}` label _releaseLeaseAndRecord already uses (label continuity
// with the out-of-Touches e2e mock's `/^admission-release-/` fail-closed dispatch chain).
async function _writeGenerationTelemetry(stageLabel, { terminalPhase, outcome, reason, cacheable }) {
  // M207: the Receipt success path carries BOTH new flags too (uniformly with
  // `_releaseLeaseAndRecord` above); `_releaseLease`'s --release-only dispatch below gains
  // nothing — it writes no telemetry.
  const _result = await _convergenceAgentCall(
    `--record-generation --no-release --taskId ${_taskId} --workspace . --charterFile ${_charterFile} --terminalPhase ${terminalPhase} --outcome ${outcome} --reason ${JSON.stringify(reason)} --cacheable ${cacheable} --milestoneId ${_milestoneId} --class ${_class} --highRisk ${_highRisk} --decisionKind ${_resumeFromAdjudicatedProposal ? 'resume' : 'cold'} --phaseTimings ${JSON.stringify(JSON.stringify(_phaseTimingsForTerminal(stageLabel)))} --findingCodes ${JSON.stringify(JSON.stringify(_findingCodesFor(reason)))}`,
    `write-telemetry-${stageLabel}`
  )
  // gap-prepare-milestone-task-epoch-budget-reset: the Receipt-phase success path also persists
  // epoch deltas here (the SAME choke point _releaseLeaseAndRecord uses for every other terminal) —
  // Receipt never calls _releaseLeaseAndRecord itself (M203/DIR-126-D's own write-first/build/
  // release split), so this is the one place its own epoch accounting happens.
  await _recordEpochDispatch(stageLabel, terminalPhase, reason)
  return _result
}

async function _releaseLease(stageLabel, { reason }) {
  return _convergenceAgentCall(
    `--release-only --taskId ${_taskId} --workspace . --reason ${JSON.stringify(reason)}`,
    `admission-release-${stageLabel}`
  )
}

// M201/DIR-126-B: sibling helper to _admissionAgentCall, dispatching the SAME
// agent()-wraps-a-real-CLI shape against prepare-admission-check.ts's new --preflight/
// --preflight-plan modes — not a new dispatch mechanism.
async function _preflightAgentCall(flagsText, label) {
  return agent(
    `Run exactly this shell command and report its stdout verbatim:
node --no-warnings --experimental-strip-types ${_admissionScript} ${flagsText}
Do not paraphrase or reformat the command's stdout — copy it exactly as printed. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    { label, phase: 'Preflight', schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } } }
  )
}

const _admissionResult = await _admissionAgentCall(`--acquire --taskId ${_taskId} --workspace . ${_highRisk ? '--highRisk' : ''}`.trim(), 'admission-acquire')

let _admissionVerdict = _admissionResult?.raw ? _parseAgentJson(_admissionResult.raw) : null

// Normalize: the CLI returns {outcome:"acquired",lease:{...}} but an LLM agent may fabricate
// {acquired:true,lease:{...}} instead of running the real command (observed: wf_8041eac4-435).
if (_admissionVerdict?.acquired === true && !_admissionVerdict.outcome) {
  _admissionVerdict = { outcome: 'acquired', lease: _admissionVerdict.lease, reclaimed: _admissionVerdict.reclaimed || false }
}

if (!_admissionVerdict || (_admissionVerdict.outcome !== 'acquired' && _admissionVerdict.outcome !== 'prepare-already-running')) {
  // AC2 fail-closed path: bad CLI invocation / unexpected exception / unparseable output — NEVER
  // silently falls through to ProposalAuthors as if admission had succeeded. Distinct reason code
  // (admission-check-failed) from an ordinary lease-contention verdict (prepare-already-running).
  log(`Admission phase FAILED — no parseable acquire/contention verdict (raw: ${_admissionResult?.raw ?? '(none)'}). Failing closed, never dispatching ProposalAuthors.`)
  await _recordAttemptAgentCall('admission-check-failed', { detail: _admissionResult?.raw ?? null })
  return { outcome: 'needs-human', reason: 'admission-check-failed', phase: 'Admission', detail: _admissionResult?.raw ?? '(agent returned no output)' }
}

if (_admissionVerdict.outcome === 'prepare-already-running') {
  log(`Admission: prepare-already-running — an active lease is held by ${_admissionVerdict.owner?.ownerExecutionId} (stage=${_admissionVerdict.owner?.stage}, leaseUntil=${_admissionVerdict.owner?.leaseUntil}). Returning before any ProposalAuthors agent is dispatched — zero author agent turns spent.`)
  await _recordAttemptAgentCall('prepare-already-running', { owner: _admissionVerdict.owner ?? null })
  return { outcome: 'needs-human', reason: 'prepare-already-running', phase: 'Admission', owner: _admissionVerdict.owner }
}

log(`Admission: acquired lease for ${_taskId} (fencingToken=${_admissionVerdict.lease?.fencingToken}, reclaimed=${_admissionVerdict.reclaimed === true}).`)

// M207: seed `_lastBoundaryMs` EXCLUSIVELY from the already-parsed --acquire verdict's self-
// reported `nowMs` (the subprocess computes the clock; the sandbox only reads a cached number —
// never a workflow-local clock read). Only on `outcome === 'acquired'` — the prepare-already-
// running path returned above before any span exists. No `_phaseTimings` entry is pushed here:
// acquire is the FIRST boundary, with no prior boundary to pair against. An older-subprocess
// verdict lacking `nowMs` leaves `_lastBoundaryMs` null — the first successful renewal then
// pushes a span with `startedAtMs: null`, an honest "epoch unknown", not a crash.
if (_admissionVerdict.outcome === 'acquired' && Number.isFinite(_admissionVerdict.nowMs)) _lastBoundaryMs = _admissionVerdict.nowMs

// ── gap-prepare-milestone-task-epoch-budget-reset: epoch-cumulative circuit breaker ───────────
// DIR-125 bounds convergence WITHIN one generation; DIR-126-C's resume and this file's own
// cross-generation checkpoint mechanism carry PROPOSAL-REVIEW state forward across generations, but
// neither bounds the number of GENERATIONS a task can burn — the real DIR-126-D incident
// accumulated ~5h wall time / ~9.5M aggregate tokens / 11 attempts, each individually within its own
// local DIR-125 policy. Loaded ONCE per generation, immediately after Admission succeeds (the
// earliest point a held lease exists, so a breach detected here can still release it via the SAME
// _releaseLeaseAndRecord/_releaseLease mechanism every other terminal already uses) and strictly
// BEFORE resume-decision/split-decision/Preflight/any content-agent dispatch. `_epochThisGen*` are
// LOCAL, in-memory deltas accrued as THIS generation's own real content-agent dispatches happen —
// checked cheaply (pure arithmetic, zero extra CLI round trips) before every one of them via
// `_checkEpochCapsInline`, then persisted ONCE at this generation's own terminal by
// `_releaseLeaseAndRecord`/`_writeGenerationTelemetry` (extended below to also call
// `_recordEpochDispatch`) — the SAME "one choke-point function every terminal already calls" pattern
// M202/DIR-126-C established for `--record-generation`, never a new per-terminal dispatch site.
const _epochGenStartMs = Number.isFinite(_admissionVerdict.nowMs) ? _admissionVerdict.nowMs : null
let _epochThisGenDispatches = 0
let _epochThisGenFullReviews = 0
let _epochThisGenDeltaRounds = 0
let _epochBase = { attempts: 0, fullReviews: 0, deltaRounds: 0, contentAgentDispatches: 0, observableAgentMs: 0, terminalFingerprints: {}, tokensObserved: null }
let _epochPolicy = { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2, maxOverrideCount: 3, maxNewEpochResetCount: 3 }
let _epochOverrides = []
// gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 3): loaded the SAME way
// `_epochOverrides` already is, below — consumed by `_epochEscapeValveActions()` so a breach
// report never lists `NEW-EPOCH` once `maxNewEpochResetCount` is ALREADY exhausted.
let _epochResets = []

const _epochStatusResult = await _convergenceAgentCall(`--epoch-status --taskId ${_taskId} --workspace . --charterFile ${_charterFile} --highRisk ${_highRisk} --compute-body-scope-hash true`, 'epoch-status')
const _epochStatusVerdict = _epochStatusResult?.raw ? _parseAgentJson(_epochStatusResult.raw) : null
// M233: the current task body's ## Proposal hash computed once at Admission — used for the full-
// review cap gate and passed through to _recordEpochDispatch for persistence in the epoch record.
// Must be defined BEFORE any early-return paths that call _releaseLeaseAndRecord/_recordEpochDispatch.
const _currentBodyScopeHash = _epochStatusVerdict?.bodyScopeHash ?? null
// M233/epoch-status-parse-fallback (2026-08-01): the agent sometimes omits `ok:true` from
// raw CLI stdout even though the CLI always returns it (observed 3+ times in 8e4b1f78).
// Tolerate a missing `ok` when `code === 'epoch-status-ok'` — a recognised success code
// with a parseable counters block is sufficient evidence the epoch was read correctly.
// Fail closed ONLY when neither signal is present (malformed/corrupt output, no-epoch-record
// returning unexpected shape, or a parser-miss on the real JSON body).
const _epochStatusHasValidCode = _epochStatusVerdict && (_epochStatusVerdict.code === 'epoch-status-ok' || _epochStatusVerdict.code === 'no-epoch-record' || _epochStatusVerdict.code === 'epoch-identity-mismatch')
if (!_epochStatusVerdict || (_epochStatusVerdict.ok !== true && !_epochStatusHasValidCode)) {
  log(`Epoch-status phase FAILED — no parseable verdict (raw: ${_epochStatusResult?.raw ?? '(none)'}). Failing closed, never dispatching a content agent without a real epoch-budget read.`)
  await _releaseLease('Admission', { reason: 'epoch-status-failed' })
  return { outcome: 'needs-human', reason: 'epoch-status-failed', phase: 'Admission' }
}
if (_epochStatusVerdict.code === 'epoch-identity-mismatch') {
  // A real charter/review-policy change since the last generation — the ONLY thing that can make
  // (charterHash, reviewPolicyHash) drift, since the epoch key deliberately excludes Proposal/AC/
  // Touches content. Never silently continued under a stale record NOR silently reset to zero —
  // requires an explicit human-invoked --new-epoch call first.
  log(`Epoch-status: identity mismatch — an epoch record exists for ${_taskId} but its (charterHash, reviewPolicyHash) no longer matches current state. A new epoch requires an explicit --new-epoch scope-reset decision; never silently continuing under a stale OR a fresh-zero epoch.`)
  await _releaseLeaseAndRecord('epoch-identity-mismatch', { terminalPhase: 'Admission', outcome: 'needs-human', reason: 'epoch-identity-mismatch', cacheable: false })
  return { outcome: 'needs-human', reason: 'epoch-identity-mismatch', phase: 'Admission', allowedActions: ['NEW-EPOCH'], epoch: _epochStatusVerdict }
}
_epochBase = _epochStatusVerdict.counters || _epochBase
_epochBase.bodyScopeHash = _epochStatusVerdict.recordBodyScopeHash ?? null
_epochPolicy = _epochStatusVerdict.policy || _epochPolicy
_epochOverrides = Array.isArray(_epochStatusVerdict.overrides) ? _epochStatusVerdict.overrides : []
_epochResets = Array.isArray(_epochStatusVerdict.resets) ? _epochStatusVerdict.resets : []

// _epochElapsedMsSoFar — reuses `_lastBoundaryMs` (M207's own real-`nowMs`-derived phase-boundary
// clock, seeded from the Admission --acquire verdict and advanced at every successful --renew
// dispatch) as the epoch's own "observable agent time" proxy — never a new/fabricated clock. This
// covers every phase this file dispatches content agents in (Adjudicate/ProposalReview/PlanAuthor/
// PlanCheck renew at their own entry; ProposalAuthors runs before the first renewal, at elapsed 0).
function _epochElapsedMsSoFar() {
  if (_epochGenStartMs === null || !Number.isFinite(_lastBoundaryMs)) return 0
  return Math.max(0, _lastBoundaryMs - _epochGenStartMs)
}

// _checkEpochCapsInline — the no-import workflow-local mirror of proposal-convergence.ts's
// exported `checkEpochCaps()` (the file has no import statements by established convention — see
// capsFor()'s own inline mirror above). MUST match that function's logic exactly; cross-checked by
// experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs's own dedicated test, the
// SAME precedent as the existing "prepare-milestone.js mirrors inline the SAME caps as capsFor()"
// check. `checkFullReviewCap` is passed `true` ONLY at the one call site immediately before
// dispatching a NEW full-review agent — every other content-agent dispatch never attempts a second
// full review this generation, so gating them on that cap would incorrectly block ordinary delta/
// author/plan work whenever an epoch has already used its one full review.
function _checkEpochCapsInline(checkFullReviewCap, currentBodyScopeHash) {
  const c = {
    fullReviews: (_epochBase.fullReviews || 0) + _epochThisGenFullReviews,
    observableAgentMs: (_epochBase.observableAgentMs || 0) + _epochElapsedMsSoFar(),
    terminalFingerprints: _epochBase.terminalFingerprints || {},
  }
  const p = _epochPolicy || {}
  const capMinutes = _highRisk ? (Number.isFinite(p.highRiskCapMinutes) ? p.highRiskCapMinutes : 150) : (Number.isFinite(p.ordinaryCapMinutes) ? p.ordinaryCapMinutes : 90)
  const overrideMinutes = (_epochOverrides || []).reduce((sum, o) => sum + (Number.isFinite(o?.additionalBudget) ? o.additionalBudget : 0), 0)
  const effectiveCapMs = (capMinutes + overrideMinutes) * 60 * 1000
  const maxFullReviews = Number.isFinite(p.maxFullReviewsPerEpoch) ? p.maxFullReviewsPerEpoch : 1
  const maxRepeatedFingerprint = Number.isFinite(p.maxRepeatedFingerprint) ? p.maxRepeatedFingerprint : 2
  const fpEntry = Object.entries(c.terminalFingerprints).find(([, count]) => Number.isFinite(count) && count >= maxRepeatedFingerprint)
  if (fpEntry) return { breached: true, breachedCap: 'repeated-terminal-fingerprint', code: 'epoch-fingerprint-cap-exceeded', message: `terminal fingerprint ${fpEntry[0]} has recurred ${fpEntry[1]} time(s), meeting the epoch cap of ${maxRepeatedFingerprint}` }
  if (checkFullReviewCap && c.fullReviews >= maxFullReviews) {
    // M233 scope-change grant: if the stored bodyScopeHash differs from current, grant fresh review
    if (_epochBase.bodyScopeHash != null && currentBodyScopeHash != null && _epochBase.bodyScopeHash !== currentBodyScopeHash) return { breached: false, scopeChanged: true }
    return { breached: true, breachedCap: 'full-review-cap-exceeded', code: 'epoch-full-review-cap-exceeded', message: `cumulative full-review count (${c.fullReviews}) meets/exceeds the epoch cap of ${maxFullReviews} for this unchanged scope epoch` }
  }
  if (c.observableAgentMs >= effectiveCapMs) return { breached: true, breachedCap: 'time-cap-exceeded', code: 'epoch-time-cap-exceeded', message: `cumulative observable agent time (${c.observableAgentMs}ms) meets/exceeds the epoch cap (${effectiveCapMs}ms${overrideMinutes ? `, includes ${overrideMinutes}m override` : ''})` }
  return { breached: false }
}

// _recordEpochDispatch — dispatched from EVERY terminal choke-point (_releaseLeaseAndRecord /
// _writeGenerationTelemetry, both extended below) to persist this generation's real accumulated
// deltas onto the epoch record. `tokensObserved` is deliberately omitted here (never a fabricated
// value) — this workflow has no mechanism to observe real per-generation token usage; the CLI
// itself leaves any prior observed value on file untouched when the flag is absent.
async function _recordEpochDispatch(stageLabel, terminalPhase, reason) {
  return _convergenceAgentCall(
    `--record-epoch-dispatch --taskId ${_taskId} --workspace . --charterFile ${_charterFile} --highRisk ${_highRisk} --dispatchDelta ${_epochThisGenDispatches} --fullReviewDelta ${_epochThisGenFullReviews} --deltaRoundDelta ${_epochThisGenDeltaRounds} --elapsedMsDelta ${_epochElapsedMsSoFar()} --attemptIncrement 1 --terminalPhase ${terminalPhase} --reason ${JSON.stringify(reason)} --bodyScopeHash ${_currentBodyScopeHash}`,
    `epoch-dispatch-${stageLabel}`
  )
}

// _epochEscapeValveActions — gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 3,
// explicit decision): "no further resets/overrides, ever, once a hard ceiling is hit — converge to
// COMMIT/SPLIT" IS the intended terminal design (the whole point of a hard ceiling is that it's not
// negotiable; a genuine "human-authorized override of the human-authorized override" escape valve
// would risk re-creating the exact infinite-regress problem this circuit breaker exists to
// prevent — see the task's own recorded reasoning). What this function fixes is narrower:
// `_epochBreachExit` previously listed `NEW-EPOCH`/`OVERRIDE` in `allowedActions`
// UNCONDITIONALLY, even once `maxNewEpochResetCount`/`maxOverrideCount` was ALREADY exhausted —
// at that point both are mechanically-guaranteed dead ends (`_newEpochCli`/`_overrideBudgetCli`
// fail-closed on their own ceiling check, confirmed by this same task's `new-epoch-reset-count-
// cap-exceeded`/`override-count-cap-exceeded` regression coverage), so listing them implied an
// escalation path that doesn't actually exist in code. Computed from the SAME `_epochResets`/
// `_epochOverrides`/`_epochPolicy` state already loaded once at Admission (`_epochStatusCli`) —
// never a second read; COMMIT/SPLIT are ALWAYS listed (never mechanically gated — the genuine,
// always-available terminal paths).
function _epochEscapeValveActions() {
  const p = _epochPolicy || {}
  const maxOverrideCount = Number.isFinite(p.maxOverrideCount) ? p.maxOverrideCount : 3
  const maxNewEpochResetCount = Number.isFinite(p.maxNewEpochResetCount) ? p.maxNewEpochResetCount : 3
  const actions = ['COMMIT', 'SPLIT']
  if ((_epochResets || []).length < maxNewEpochResetCount) actions.push('NEW-EPOCH')
  if ((_epochOverrides || []).length < maxOverrideCount) actions.push('OVERRIDE')
  return actions
}

// _epochBreachExit — the ONE exit path every cap-check call site below uses on a breach: releases
// the held lease + persists final counters via the EXISTING `_releaseLeaseAndRecord` choke point
// (never a new/second release path), then returns needs-human with `allowedActions` computed by
// `_epochEscapeValveActions()` above — COMMIT/SPLIT reuse M206/M4's EXISTING `--record-split-
// decision` verbs verbatim (never a parallel commit/split concept); NEW-EPOCH/OVERRIDE map onto
// this child's own `--new-epoch`/`--override-budget` CLI modes, listed ONLY while their own hard
// ceiling still has headroom. Dispatches NOTHING further — this function is always called INSTEAD
// of the content-agent call it would have gated, never alongside it.
async function _epochBreachExit(terminalPhase, stageLabel, capResult) {
  log(`Epoch budget breach at ${terminalPhase} — ${capResult.code}: ${capResult.message}. Releasing the lease and returning needs-human; zero further content-agent dispatch this generation.`)
  await _releaseLeaseAndRecord(stageLabel, { terminalPhase, outcome: 'needs-human', reason: capResult.code, cacheable: false })
  return {
    outcome: 'needs-human',
    reason: capResult.code,
    phase: terminalPhase,
    epochCapBreach: capResult,
    allowedActions: _epochEscapeValveActions(),
    ...(_ledgerLive ? { ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions } : {}),
  }
}

// First check of the generation — before resume-decision/split-decision/Preflight/ANY content
// agent. Catches: (a) a repeated-terminal-fingerprint already recorded by prior generations, or
// (b) an epoch whose cumulative time/full-review budget was ALREADY exhausted before this
// generation even started (e.g. a crash mid-generation left counters persisted but the process
// never reached its own terminal). `checkFullReviewCap:false` here — whether THIS generation will
// even attempt a full review is decided later, at its own specific dispatch site.
{
  const _epochCap = _checkEpochCapsInline(false)
  if (_epochCap.breached) return await _epochBreachExit('Admission', 'epoch-cap-admission', _epochCap)
}

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

// ── M206/M4: --decide-split — hash-bound COMMIT/SPLIT decision adjudication. ──────────
// Dispatched UNCONDITIONALLY, after the resume-decision block closes and BEFORE phase('Preflight').
let _splitCheckDisabled = false
// On BOTH the default and explicit-resume paths: a SPLIT decision blocks ALL content-agent dispatch
// until the split or an explicit scope reset. A COMMIT decision skips split adjudication
// (_splitCheckDisabled = true) this generation. Runs as ONE additional non-content CLI dispatch.
{
  const _splitVerdictResult = await _convergenceAgentCall(`--decide-split --taskId ${_taskId} --workspace . --charterFile ${_charterFile}`, 'split-decision')
  const _splitVerdictRaw = _splitVerdictResult?.raw
  const _splitVerdictString = typeof _splitVerdictRaw === 'string' ? _splitVerdictRaw : JSON.stringify(_splitVerdictRaw)
  let _splitVerdict = null
  try { _splitVerdict = JSON.parse(_splitVerdictString) } catch { _splitVerdict = null }
  if (!_splitVerdict || typeof _splitVerdict.ok !== 'boolean') {
    log(`Split-decision phase FAILED — no parseable verdict (raw: ${_splitVerdictRaw ?? '(none)'}). Failing closed.`)
    return { outcome: 'needs-human', reason: 'split-decision-failed', phase: 'Admission' }
  }
  if (_splitVerdict.verdict === 'content-dispatch-blocked') {
    log(`Split-decision: content-dispatch-blocked — a SPLIT decision is on file for unchanged scope hashes. Zero content-agent dispatches this generation.`)
    return { outcome: 'needs-human', reason: 'split-decision-blocks-dispatch', phase: 'Admission' }
  }
  if (_splitVerdict.verdict === 'skip-split-adjudication') {
    _splitCheckDisabled = true
    log(`Split-decision: skip-split-adjudication — COMMIT decision on file, _splitCheck will be skipped this generation.`)
  }
}

// ── gap-prepare-milestone-cross-generation-review-state-reset: cross-generation ProposalReview
// checkpoint resolution ──────────────────────────────────────────────────────────────────────
// DIR-125 bounds ProposalReview WITHIN one generation; DIR-126-C's resume above only skips
// ProposalAuthors/Adjudicate — ProposalReview itself always restarted from an empty ledger and a
// fresh full review, which is why a real incident (DIR-126-D) burned nine full ProposalReview
// generations after small, targeted task edits. Only attempted when `_resumeFromAdjudicatedProposal`
// is true (set either by an explicit caller override, or by the resume-decision block above
// returning 'resume') — cross-generation delta continuation only makes sense once ProposalAuthors/
// Adjudicate are ALREADY being skipped and the task's CURRENT on-disk Proposal is being trusted
// as-is; it is never attempted on a cold dispatch. ONE additional non-content CLI dispatch
// (proposal-convergence.ts --resolve-checkpoint) — read-only, never writes anything. ANY mismatch,
// corruption, missing checkpoint, or unparseable verdict falls back to `_useCrossGenDelta = false`
// (the existing cold/full-review ProposalReview path, byte-for-byte unchanged below) — never
// silently treated as a valid delta base (Requested-action item 2).
let _useCrossGenDelta = false
let _crossGenLedger = null
let _crossGenCounters = null
let _crossGenMechanismInventoryHash = null
let _crossGenMechanismInventoryCount = null
let _crossGenNoveltyScan = null
let _crossGenClassification = null
let _crossGenLastFullReviewSession = null
let _crossGenReviewedProposalText = null

if (_resumeFromAdjudicatedProposal) {
  const _checkpointResult = await _convergenceAgentCall(`--resolve-checkpoint --taskId ${_taskId} --workspace . --charterFile ${_charterFile}`, 'resolve-checkpoint')
  const _checkpointVerdict = _checkpointResult?.raw ? _parseAgentJson(_checkpointResult.raw) : null
  if (_checkpointVerdict && _checkpointVerdict.usable === true && ['wording-only', 'known-finding-repair'].includes(_checkpointVerdict.classification)) {
    _useCrossGenDelta = true
    _crossGenLedger = Array.isArray(_checkpointVerdict.ledger) ? _checkpointVerdict.ledger : []
    _crossGenCounters = _checkpointVerdict.counters && Number.isFinite(_checkpointVerdict.counters.deltaRounds) ? _checkpointVerdict.counters : { fullReviews: 0, deltaRounds: 0 }
    _crossGenMechanismInventoryHash = _checkpointVerdict.mechanismInventoryHash ?? null
    _crossGenMechanismInventoryCount = Number.isFinite(_checkpointVerdict.mechanismInventoryCount) ? _checkpointVerdict.mechanismInventoryCount : null
    _crossGenNoveltyScan = _checkpointVerdict.noveltyScan ?? null
    _crossGenClassification = _checkpointVerdict.classification
    _crossGenLastFullReviewSession = _checkpointVerdict.lastFullReviewSession ?? null
    _crossGenReviewedProposalText = typeof _checkpointVerdict.reviewedProposalText === 'string' ? _checkpointVerdict.reviewedProposalText : ''
    log(`Checkpoint: valid cross-generation delta base (classification=${_checkpointVerdict.classification}, code=${_checkpointVerdict.classificationCode}). Carrying ${_crossGenLedger.length} ledger entrie(s) forward (epoch counters so far: fullReviews=${_crossGenCounters.fullReviews}, deltaRounds=${_crossGenCounters.deltaRounds}); ProposalReview will skip its full-review agent this generation but ALWAYS dispatches exactly one real independent cross-generation delta reviewer (never zero) to verify the diff itself, regardless of the mechanical classification or whether the carried ledger is already clean.`)
  } else {
    log(`Checkpoint: ${_checkpointVerdict ? `not usable as a cross-generation delta base (usable=${_checkpointVerdict.usable}, code=${_checkpointVerdict.code}${_checkpointVerdict.classification ? `, classification=${_checkpointVerdict.classification}` : ''})` : 'no parseable verdict'} — proceeding with the ordinary full ProposalReview path.`)
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

  // gap-prepare-milestone-task-epoch-budget-reset: check BEFORE dispatching — a breach here means
  // ZERO author agents are dispatched this generation.
  {
    const _epochCap = _checkEpochCapsInline(false)
    if (_epochCap.breached) return await _epochBreachExit('ProposalAuthors', 'epoch-cap-proposal-authors', _epochCap)
  }

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

  _epochThisGenDispatches += _n // real dispatches attempted, regardless of how many returned

  _proposals = _proposalResults.filter(Boolean)
  if (_proposals.length < _n) {
    log(`ProposalAuthors phase: only ${_proposals.length}/${_n} authors returned a result.`)
    await _releaseLeaseAndRecord('proposal-author-incomplete', { terminalPhase: 'ProposalAuthors', outcome: 'revision-needed', reason: 'proposal-author-incomplete', cacheable: false })
    return { outcome: 'revision-needed', reason: 'proposal-author-incomplete', phase: 'ProposalAuthors' }
  }

  // ── Phase: Adjudicate ─────────────────────────────────────────────────────────────────
  phase('Adjudicate')
  _recordPhaseBoundary('Adjudicate', 0, await _renewLease('Adjudicate', 0))

  // gap-prepare-milestone-task-epoch-budget-reset: check BEFORE dispatching the adjudicator.
  {
    const _epochCap = _checkEpochCapsInline(false)
    if (_epochCap.breached) return await _epochBreachExit('Adjudicate', 'epoch-cap-adjudicate', _epochCap)
  }

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
  _epochThisGenDispatches += 1

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
_recordPhaseBoundary('ProposalReview', 0, await _renewLease('ProposalReview', 0))

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
// M207: from this point on `_findingCodesFor` may read `_ledger` (the TDZ guard above flips here —
// see its comment for why `_ledger?.map(...)` would be wrong).
_ledgerLive = true
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
      rootCauseKey: raw.rootCauseKey || existing?.rootCauseKey || null,
      repairable: raw.repairable === true ? true : (existing?.repairable === true ? true : false),
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
function _sha256(text) {
  // Inline sha256 via the CLI — same agent()-wraps-CLI pattern this file already uses for every
  // other file-touching operation. The pure module (proposal-convergence.ts) imports crypto directly;
  // the workflow mirror inlines it via this function.
  let h = 0
  for (let i = 0; i < text.length; i++) { h = ((h << 5) - h + text.charCodeAt(i)) | 0 }
  return (h >>> 0).toString(16).padStart(8, '0')
}
// SHA-256 is not available in the sandbox — use a CLI dispatch for hashing.
async function _computeSha256(text) {
  const result = await _convergenceAgentCall(`echo ${JSON.stringify(JSON.stringify(text))} | sha256sum | cut -d' ' -f1`, 'compute-sha256')
  const raw = result?.raw
  return typeof raw === 'string' ? raw.trim() : '00000000'
}

// ── M206/M1 inline twins: _deriveMechanismInventory, _hashMechanismInventory ───────────
// These three functions mirror proposal-convergence.ts's exported deriveMechanismInventory/
// hashMechanismInventory/groupBlockingByRootCause exactly — the workflow DSL has no import
// capability, so they are inlined here per the established no-import convention.
function _deriveMechanismInventory(mechanisms) {
  if (!Array.isArray(mechanisms)) {
    return { ok: false, code: 'mechanism-inventory-missing', message: 'reviewer returned no mechanisms field — typed inventory required' }
  }
  const seenIds = new Set()
  const seenSurfaces = new Set()
  const ids = new Set()
  for (const m of mechanisms) {
    if (!m || typeof m !== 'object' || !m.id || !m.proofSurface) {
      return { ok: false, code: 'mechanism-inventory-invalid', message: 'every mechanism entry must carry at least {id, proofSurface}' }
    }
    if (seenIds.has(m.id)) {
      return { ok: false, code: 'mechanism-inventory-invalid', message: `duplicate mechanism id: ${JSON.stringify(m.id)}` }
    }
    seenIds.add(m.id)
    ids.add(m.id)
    if (seenSurfaces.has(m.proofSurface)) {
      return { ok: false, code: 'mechanism-inventory-invalid', message: `duplicate proofSurface: ${JSON.stringify(m.proofSurface)} — anti-laundering` }
    }
    seenSurfaces.add(m.proofSurface)
  }
  for (const m of mechanisms) {
    if (Array.isArray(m.dependsOn)) {
      for (const dep of m.dependsOn) {
        if (!ids.has(dep)) {
          return { ok: false, code: 'mechanism-inventory-invalid', message: `dangling dependsOn: ${m.id} -> ${dep}` }
        }
      }
    }
  }
  const count = mechanisms.filter((m) => m.independentlyShippable === true).length
  const inventoryHash = _hashMechanismInventory(mechanisms)
  return { ok: true, count, inventoryHash, mechanismCount: count }
}

function _hashMechanismInventory(mechanisms) {
  const idToSurface = {}
  for (const m of (mechanisms || [])) idToSurface[m.id] = m.proofSurface
  const projected = (mechanisms || []).map((m) => ({
    proofSurface: m.proofSurface,
    independentlyShippable: m.independentlyShippable === true,
    dependsOn: (m.dependsOn || []).map((depId) => idToSurface[depId] || depId).sort(),
  }))
  projected.sort((a, b) => String(a.proofSurface).localeCompare(String(b.proofSurface)))
  // Use a stable fingerprint of the canonical projection.
  const json = JSON.stringify(projected)
  let h = 5381
  for (let i = 0; i < json.length; i++) h = ((h * 33) ^ json.charCodeAt(i)) >>> 0
  return 'mi-' + (h >>> 0).toString(16).padStart(8, '0')
}

function _groupBlockingByRootCause() {
  const out = {}
  for (const f of _blockingOpen()) {
    const key = f.rootCauseKey || f.id
    if (!out[f.subsystem]) out[f.subsystem] = new Set()
    out[f.subsystem].add(key)
  }
  return out
}

function _splitCheck() {
  // M206/M2: rootCauseKey-based clustering supersedes per-finding counting.
  const bySubsystem = _groupBlockingByRootCause()
  let repairable = true
  for (const [subsystem, keys] of Object.entries(bySubsystem)) {
    if (keys.size >= 3) {
      const subFindings = _blockingOpen().filter((f) => f.subsystem === subsystem)
      const allRepairable = subFindings.every((f) => f.repairable === true)
      repairable = allRepairable
      return { recommend: true, code: 'split-subsystem-blocking-cluster', reason: `subsystem "${subsystem}" has ${keys.size} distinct-root-cause independent blocking findings (>= 3)`, repairable }
    }
  }
  // M206/M1: prefer inventory-derived count over legacy scalar.
  let effectiveCount
  if (_mechanismInventory && _mechanismInventory.ok) {
    effectiveCount = _mechanismInventory.count
  } else if (Number.isFinite(_mechanismCount)) {
    effectiveCount = _mechanismCount
  }
  if (Number.isFinite(effectiveCount) && effectiveCount > 2) {
    return { recommend: true, code: 'split-multi-mechanism', reason: `candidate contains ${effectiveCount} independently landable mechanisms (> 2)`, repairable: false }
  }
  return { recommend: false }
}

const _findingSchema = {
  type: 'object',
  properties: {
    subsystem: { type: 'string' }, summary: { type: 'string' }, severity: { type: 'string' },
    blocking: { type: 'boolean' }, evidence: { type: 'string' }, claimRef: { type: 'string' },
    disposition: { type: 'string' },
    rootCauseKey: { type: 'string' }, repairable: { type: 'boolean' },
  },
}

const _proposalHashes = []
const _reviewSessions = []
const _reviserSessions = []
let _fullReviewResult = null
let _fullReviewNowMs = null
let _mechanismInventory = null
let _mechanismInventorySource = 'typed'
let _rawMechanisms = null
let _mechanismCount = undefined
let _deltaRound = 0
let _terminalReason = null
let _splitRecommendation = null
let _splitBypassUsed = false  // M206/M3: one-shot repairable-cluster bypass

// gap-prepare-milestone-cross-generation-review-state-reset: epoch-cumulative delta-round offset
// carried forward from the checkpoint (0 on a cold/full-review generation, or when no valid
// checkpoint was resolved) — the while(true) loop below enforces the round cap against
// (_deltaRoundOffset + _deltaRound), never just this generation's own local _deltaRound, so the
// bound is real across the WHOLE scope epoch (Requested-action item 5), not merely reset to zero
// by every fresh generation.
const _deltaRoundOffset = _useCrossGenDelta && Number.isFinite(_crossGenCounters?.deltaRounds) ? _crossGenCounters.deltaRounds : 0

// _writeReviewCheckpoint — dispatched at EVERY ProposalReview terminal below (success included),
// never only the happy path (Requested-action item 1). Mirrors the Receipt phase's own established
// "agent writes a scratch file with EXACT content, then runs a CLI over it" pattern (the workflow
// DSL has no fs of its own) — writes a scratch checkpoint-input file, then dispatches
// proposal-convergence.ts --write-checkpoint, which re-reads task/charter/Proposal FRESH, folds in
// epoch-cumulative counters, and atomically persists the checkpoint. Best-effort/non-fatal: a write
// failure here never changes the terminal's own outcome — it only means the NEXT attempt falls back
// to a full review (the safe default), since no valid checkpoint would exist.
async function _writeReviewCheckpoint(stageLabel, { terminalReason, terminalOutcome }) {
  const _fullReviewsThisGen = _useCrossGenDelta ? 0 : 1
  const _deltaRoundsThisGen = _deltaRound
  const _lastFullReviewSessionId = _useCrossGenDelta ? (_crossGenLastFullReviewSession?.sessionId ?? null) : (_reviewSessions[0] ?? null)
  const _lastFullReviewTimestamp = _useCrossGenDelta ? (_crossGenLastFullReviewSession?.timestamp ?? null) : (_fullReviewNowMs ?? null)
  const _checkpointInput = {
    ledger: _ledger,
    mechanismInventoryHash: (_mechanismInventory && _mechanismInventory.ok) ? _mechanismInventory.inventoryHash : null,
    mechanismInventoryCount: (_mechanismInventory && _mechanismInventory.ok) ? _mechanismInventory.count : null,
    fullReviewsThisGen: _fullReviewsThisGen,
    deltaRoundsThisGen: _deltaRoundsThisGen,
    lastFullReviewSessionId: _lastFullReviewSessionId,
    lastFullReviewTimestamp: _lastFullReviewTimestamp,
  }
  const _checkpointInputJson = JSON.stringify(_checkpointInput, null, 2)
  const _checkpointInputFile = `.quay/prepare-checkpoints/_input-${_taskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  const _writeResult = await agent(
    `Write the file ${_checkpointInputFile} with EXACTLY this content (create parent directories as needed):

\`\`\`json
${_checkpointInputJson}
\`\`\`

Then run exactly this shell command and report its stdout verbatim:
node --no-warnings --experimental-strip-types ${_convergenceScript} --write-checkpoint --taskId ${_taskId} --workspace . --charterFile ${_charterFile} --checkpointInputFile ${_checkpointInputFile} --outcome ${terminalOutcome} --reason ${JSON.stringify(terminalReason)}
Do not paraphrase or reformat the command's stdout — copy it exactly as printed. Return {raw: <the exact stdout text, or null if the command produced no output at all>}.`,
    { label: `write-review-checkpoint-${stageLabel}`, phase: 'ProposalReview', schema: { type: 'object', properties: { raw: { type: ['string', 'null'] } } } }
  )
  const _verdict = _writeResult?.raw ? _parseAgentJson(_writeResult.raw) : null
  if (!_verdict || _verdict.ok !== true) {
    log(`ProposalReview: checkpoint write FAILED at terminal '${terminalReason}' (verdict: ${JSON.stringify(_verdict)}) — non-fatal, this terminal's own outcome is unaffected; the NEXT attempt simply falls back to a full review (the fail-closed default) since no valid checkpoint would exist.`)
  }
  return _verdict
}

if (!_useCrossGenDelta) {
  // gap-prepare-milestone-task-epoch-budget-reset: check BEFORE dispatching a NEW full review —
  // the ONE call site that gates on the epoch's full-review cap (checkFullReviewCap:true). Every
  // other content-agent dispatch in this file never attempts a second full review, so it never
  // passes `true` here.
  {
    const _epochCap = _checkEpochCapsInline(true, _currentBodyScopeHash)
    if (_epochCap.breached) return await _epochBreachExit('ProposalReview', 'epoch-cap-full-review', _epochCap)
    // M233: scopeChanged:true means the bodyScopeHash changed since the last full review —
    // grant a fresh full-review allowance WITHOUT consuming a --new-epoch reset. The full-review
    // agent is dispatched normally below; _epochBreachExit is NOT called.
  }
  // ── Round 0: ONE full grounded review of the just-adjudicated Proposal. ──────────────
  _fullReviewResult = await agent(
    `INDEPENDENT review of task ${_taskId}'s just-reconciled \`## Proposal\` — you did NOT author it. Read the CURRENT task via \`task_get ${_taskId}\` (fresh, do not trust anything from a prior phase) against the real repository.

1. Verify the Proposal makes the implementation approach reviewable without re-designing it: problem framing grounded in current code, chosen mechanism, concrete control/data flow, key decisions, defaults/failure behavior, compatibility, risks, non-goals, AC coverage, explicit alternatives.
2. Mechanism-claim wiring coverage (DIR-117): extract every new call/dispatch/ownership/enforcement relationship the Proposal claims and confirm the task's own \`## Acceptance Criteria\` has a matching, falsifiable item demanding real production-callsite or cross-generation reachability evidence for THAT relationship (not descriptive prose restating the claim).
3. DIR-125 typed findings — report EVERY finding as a typed object, never a bare count. A finding is BLOCKING (\`blocking:true\`) ONLY if it is one of: factual contradiction, unresolved safety/fail-closed behavior, missing production callsite/ownership enforcement, a new behavior with no falsifiable AC or accepted-risk decision, stale acceptance wiring, or a scope cluster requiring split. Every other valuable finding is non-blocking and MUST carry exactly one disposition: plan, split, accepted-risk, backlog, duplicate, or superseded — never silently drop a real finding. For M206 root-cause-aware clustering, you MAY include optional \`rootCauseKey\` (a stable string identifying a shared root cause across findings — three findings sharing one rootCauseKey count as ONE cluster member toward the split threshold) and \`repairable\` (true only if this particular finding is mechanically/wiring-format repairable without changing the charter's scope).
4. Typed mechanism inventory — identify EVERY independently-landable mechanism the Proposal contains. Group call-site variants required to satisfy one atomic behavior contract into ONE mechanism entry unless a strict subset can ship independently with a complete safety contract and independent user value. For EACH mechanism, fill: {id, owner, proofSurface, dependsOn: [id...], independentlyShippable: boolean, rationale}. proofSurface must be a real file path or unambiguous symbol — never a free-text label; two entries MUST NOT share the same proofSurface. The count is mechanically derived from qualifying \`independentlyShippable:true\` entries — you report typed entries, never a bare integer.
5. ${_sessionIdInstruction}
6. BEFORE returning, run \`date +%s%3N\` (real epoch milliseconds) and include the result as \`nowMs\` (a number) — the orchestrating workflow script cannot read the clock itself.
7. Return {findings: [{subsystem, summary, severity: "blocker"|"major"|"minor"|"nit", blocking: <boolean>, evidence, claimRef, disposition, rootCauseKey, repairable}], mechanisms: [{id, owner, proofSurface, dependsOn: [id...], independentlyShippable: <boolean>, rationale}], proposalHash: <a short hash/fingerprint you compute over the reviewed Proposal text, any stable digest is fine>, nowMs: <the real epoch-ms number from step 6>, sessionId: <your real session id>}. Use findings: [] and mechanisms: [] if there are none.`,
    { label: 'proposal-review', phase: 'ProposalReview',
      schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: _findingSchema }, mechanisms: { type: 'array' }, proposalHash: { type: 'string' }, nowMs: { type: 'number' }, sessionId: { type: 'string' } } } }
  )
  _epochThisGenDispatches += 1
  _epochThisGenFullReviews += 1

  if (_fullReviewResult?.sessionId) _reviewSessions.push(_fullReviewResult.sessionId)
  if (_fullReviewResult?.proposalHash) _proposalHashes.push({ round: 0, hash: _fullReviewResult.proposalHash })
  if (Number.isFinite(_fullReviewResult?.nowMs)) { _latestKnownNowMs = _fullReviewResult.nowMs; _fullReviewNowMs = _fullReviewResult.nowMs }

  // Backward compat (DIR-125 AC: "zero-finding first-review fixture remains backward-compatible"):
  // a legacy reviewer/mock may still return a bare `findings: <number>` — 0 is a zero-finding pass;
  // nonzero is filed as ONE untyped blocking finding so the SAME bounded loop still applies rather
  // than silently trusting a shape this phase no longer natively emits.
  let _rawFindings = _fullReviewResult?.findings
  if (typeof _rawFindings === 'number') {
    _rawFindings = _rawFindings === 0 ? [] : [{ subsystem: 'unspecified', summary: _fullReviewResult?.findingsDetail || 'legacy-scalar-finding', severity: 'major', blocking: true }]
  }
  _upsertFindings(Array.isArray(_rawFindings) ? _rawFindings : [], 0)
} else {
  // gap-prepare-milestone-cross-generation-review-state-reset: a validated checkpoint classified
  // the intervening diff as wording-only/known-finding-repair — carry the prior ledger forward
  // verbatim instead of starting from an empty ledger and dispatching a fresh full reviewer.
  _ledger = _crossGenLedger
  log(`ProposalReview: cross-generation delta continuation (checkpoint classification=${_crossGenClassification}) — skipping the full-review agent this generation; carried ${_ledger.length} ledger entrie(s) forward (epoch delta rounds used so far: ${_deltaRoundOffset}/${_maxDeltaRounds}).`)
  // Round 2 (post-REFUTATION): the original AC #6 "novelty-scan safety net" here (a synthetic
  // BLOCKING finding filed whenever `_crossGenNoveltyScan?.hasNovelClaim === true`, meant to force
  // at least one delta reviewer dispatch on an otherwise-clean carried ledger) was REMOVED — an
  // independent review found it structurally unreachable in production: classifyProposalDiff
  // unconditionally routes ANY diff with `addedClaims.length > 0` to the `new-claim` classification
  // (excluded from cross-gen delta continuation entirely) before this code ever runs, so
  // `hasNovelClaim` is already guaranteed false whenever `_useCrossGenDelta` is true. Keeping dead
  // code shaped like a safety mechanism that can never fire is worse than removing it (false
  // confidence). The real fix is the while(true) loop below now ALWAYS dispatching at least one
  // cross-gen delta reviewer regardless of ledger content — see its own header comment — which
  // subsumes what this block was trying to guarantee, unconditionally rather than only on a novel-
  // claim hit. The novel-claims list is still passed to that reviewer's prompt for its own judgment.
}
_startedAtMs = _now()

// ── DIR-117-B/M195 (AC #4) + Requested-action item 4 ("rerun the real deterministic ... wiring
// checks"): the mechanical wiring-coverage-check ALWAYS reruns — cold generation or cross-gen delta
// continuation alike, never skipped. It calls wiring-coverage-check.ts's REAL checkWiringCoverage()
// function directly — NOT prompt-only LLM guidance (the exact "prompt-guidance mistaken for
// production wiring" defect M191's independent audit §3 found and DIR-122's corrected AC6 forbids).
// Workflow scripts cannot `import` (sandboxed/resumable), so we dispatch an agent to run the
// module's CLI — the SAME dispatch pattern the Receipt and Prepared phases already use for
// milestone-preparation-check.ts, no new mechanism class. The SCRIPT (not the LLM) then merges the
// returned BLOCKING findings into the typed ledger via the existing `_upsertFindings(..., 0)` path,
// so this phase's open-blocking count increments by the function's REAL return value
// (`findings.length`), and the ledger is hash-bound into the receipt via the Receipt phase's
// `--ledger` flag. A non-parseable verdict (agent crash / CLI exit 2) fails the phase CLOSED,
// mirroring the revise-failed `needs-human` path, rather than silently skipping coverage.
// gap-prepare-milestone-task-epoch-budget-reset (round 2, post-REFUTATION): this dispatch site was
// found ungated by an independent review — every OTHER real content-agent dispatch in this file
// checks the epoch cap immediately before dispatching, but this one didn't, leaving one small
// window (worst-case exposure on the resumeFromAdjudicatedProposal + cross-gen-delta fast path,
// where no cap check runs at all between Admission and this dispatch) where a real agent call could
// fire after the epoch's cumulative budget was already exhausted. Closed the same way as every
// other site: check first, exit closed on breach, dispatch nothing.
{
  const _epochCap = _checkEpochCapsInline(false)
  if (_epochCap.breached) return await _epochBreachExit('ProposalReview', 'epoch-cap-wiring-coverage', _epochCap)
}
const _wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'
const _wiringVerdict = await agent(
  `Run exactly this command and return its parsed stdout JSON:
node --no-warnings --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md
This is the DIR-117-B/M195 mechanism-claim wiring coverage check — it calls the real checkWiringCoverage() function on the task's '## Proposal' vs '## Acceptance Criteria' and prints a JSON verdict on stdout shaped {ok, code, message, claims, findings}. Return that JSON verbatim: {ok: <boolean>, code: <one of wiring-coverage-complete | wiring-coverage-none-claimed | wiring-coverage-uncovered>, findings: <the findings array EXACTLY as printed, each {subsystem, summary, severity, blocking, evidence, claimRef, disposition}>}. If the command exits non-zero or prints no parseable JSON, return {ok: false, code: "wiring-cli-failed", findings: []}.`,
  { label: 'wiring-coverage-check', phase: 'ProposalReview',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, code: { type: 'string' }, findings: { type: 'array', items: _findingSchema } } } }
)
_epochThisGenDispatches += 1
const _wiringVerdictCodes = ['wiring-coverage-complete', 'wiring-coverage-none-claimed', 'wiring-coverage-uncovered']
if (!_wiringVerdict || !_wiringVerdictCodes.includes(_wiringVerdict.code)) {
  log(`ProposalReview wiring-coverage sub-step FAILED — no parseable verdict (${_wiringVerdict?.code || 'no-result'}); failing the phase closed rather than skipping coverage.`)
  await _writeReviewCheckpoint('wiring-coverage-check-failed', { terminalReason: 'wiring-coverage-check-failed', terminalOutcome: 'needs-human' })
  await _releaseLeaseAndRecord('wiring-coverage-check-failed', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'wiring-coverage-check-failed', cacheable: false })
  return { outcome: 'needs-human', reason: 'wiring-coverage-check-failed', phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
_upsertFindings(Array.isArray(_wiringVerdict.findings) ? _wiringVerdict.findings : [], 0)
log(`ProposalReview wiring coverage: ${_wiringVerdict.code} — merged ${Array.isArray(_wiringVerdict.findings) ? _wiringVerdict.findings.length : 0} blocking wiring finding(s) from checkWiringCoverage()'s real return value.`)

if (!_useCrossGenDelta) {
  _mechanismCount = Number.isFinite(_fullReviewResult?.mechanismCount) ? _fullReviewResult.mechanismCount : undefined
  // M206/M1: typed mechanism inventory — derive count + hash mechanically, never trust a bare integer.
  // The ONE-generation legacy fallback: a reviewer returning mechanismCount without mechanisms is
  // accepted as a synthetic single-entry inventory flagged mechanismInventorySource:'legacy-scalar'.
  _rawMechanisms = _fullReviewResult?.mechanisms
  if (Array.isArray(_rawMechanisms) && _rawMechanisms.length > 0) {
    _mechanismInventory = _deriveMechanismInventory(_rawMechanisms)
    _mechanismInventorySource = 'typed'
    if (!_mechanismInventory.ok) {
      log(`ProposalReview: mechanism inventory failed — ${_mechanismInventory.code}: ${_mechanismInventory.message}`)
      await _writeReviewCheckpoint('mechanism-inventory-invalid', { terminalReason: _mechanismInventory.code, terminalOutcome: 'needs-human' })
      await _releaseLeaseAndRecord('mechanism-inventory-invalid', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: _mechanismInventory.code, cacheable: false })
      return { outcome: 'needs-human', reason: _mechanismInventory.code, phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
    }
  } else if (!Array.isArray(_rawMechanisms) && Number.isFinite(_mechanismCount)) {
    // ONE-generation legacy scalar fallback — flagged, never silent.
    _mechanismInventory = { ok: true, count: _mechanismCount > 2 ? _mechanismCount : 0, inventoryHash: 'legacy-scalar-' + String(_mechanismCount), mechanismCount: _mechanismCount }
    _mechanismInventorySource = 'legacy-scalar'
  } else if (!Array.isArray(_rawMechanisms)) {
    // No mechanisms field at all — fail closed.
    log(`ProposalReview: no mechanisms field returned — mechanism-inventory-missing`)
    await _writeReviewCheckpoint('mechanism-inventory-missing', { terminalReason: 'mechanism-inventory-missing', terminalOutcome: 'needs-human' })
    await _releaseLeaseAndRecord('mechanism-inventory-missing', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'mechanism-inventory-missing', cacheable: false })
    return { outcome: 'needs-human', reason: 'mechanism-inventory-missing', phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
  }
} else {
  // Carried forward from the checkpoint — no fresh reviewer dispatch this generation, so there is
  // nothing new to derive; `null` (never a fabricated inventory) when the checkpoint itself never
  // captured one (e.g. its own generation used the legacy-scalar fallback with count<=2, which
  // stores no real inventoryHash).
  _mechanismInventory = (_crossGenMechanismInventoryHash != null || _crossGenMechanismInventoryCount != null)
    ? { ok: true, count: _crossGenMechanismInventoryCount ?? 0, inventoryHash: _crossGenMechanismInventoryHash, mechanismCount: _crossGenMechanismInventoryCount ?? 0 }
    : null
  _mechanismInventorySource = 'carried-forward'
  log(`ProposalReview: mechanism inventory carried forward from checkpoint (hash=${_crossGenMechanismInventoryHash ?? '(none)'}, count=${_crossGenMechanismInventoryCount ?? '(none)'}).`)
}

// gap-prepare-milestone-cross-generation-review-state-reset (round 2, post-REFUTATION): a validated
// checkpoint's mechanical classification (wording-only/known-finding-repair) is advisory input to a
// REAL independent reviewer, never a substitute for dispatching one. An independent review found a
// real exploit: classifyProposalDiff's claim identity is keyed only on the sorted set of backtick
// identifiers, so a Proposal edit that WEAKENS or fully REMOVES an existing safety-relevant claim
// (same identifiers, changed/deleted semantics) can classify wording-only/known-finding-repair; when
// the carried checkpoint ledger already has zero open blocking findings (the common, intended
// steady state this whole feature targets), the loop below used to terminate 'zero-finding' on its
// very first check, BEFORE dispatching any reviewer at all — letting the unsafe edit reach
// 'prepared' with ZERO review agents ever reading it. Fixed structurally, not by trying to perfect
// the classifier further (two prior attempts at a similar problem in this same session, the
// preflightMergedMarkdownClaims ASCII-dash/code-span fixes, both needed 3 rounds before a
// perfect-classifier approach was abandoned for a "never fully suppress" bound): cross-generation
// delta continuation now ALWAYS dispatches at least one real delta reviewer before the loop may ever
// terminate 'zero-finding', regardless of the carried ledger's own content.
let _crossGenFirstRoundPending = _useCrossGenDelta

while (true) {
  const openBlocking = _blockingOpen()
  if (openBlocking.length === 0 && !_crossGenFirstRoundPending) { _terminalReason = 'zero-finding'; break }

  // M206/M4: splitCheckDisabled — skip _splitCheck entirely this generation.
  if (!_splitCheckDisabled) {
    const split = _splitCheck()
    if (split.recommend) {
      // M206/M3: one bounded focused revision before a repairable cluster becomes terminal.
      if (split.repairable === true && !_splitBypassUsed && _deltaRound === 0) {
        _splitBypassUsed = true
        log(`ProposalReview: repairable cluster detected (${split.code}) — consuming one-shot bypass, dispatching focused revision + delta review.`)
      } else {
        _splitRecommendation = split; _terminalReason = 'split-recommended'; break
      }
    }
  }

  const _elapsedMs = _now() - _startedAtMs
  if (_elapsedMs >= _policyCaps.softBudgetMs) { _terminalReason = 'soft-budget-exceeded'; break }

  if ((_deltaRoundOffset + _deltaRound) >= _maxDeltaRounds) { _terminalReason = 'delta-cap-exhausted'; break }

  _deltaRound += 1
  // gap-prepare-milestone-cross-generation-review-state-reset: the FIRST round of a cross-gen
  // delta-continuation generation dispatches exactly ONE delta reviewer (verification only — the
  // Proposal on disk was ALREADY edited by a human/prior agent outside this loop) instead of the
  // ordinary revise-then-independently-verify PAIR. Any FURTHER round in the SAME generation (rare
  // — only if that one delta reviewer still leaves blocking findings open) falls back to the
  // ordinary two-agent shape, since round 2+ has no pre-existing "already edited" Proposal to verify
  // against.
  const _isCrossGenFirstRound = _useCrossGenDelta && _deltaRound === 1
  if (_isCrossGenFirstRound) _crossGenFirstRoundPending = false
  log(`ProposalReview: ${openBlocking.length} blocking finding(s) open — dispatching ${_isCrossGenFirstRound ? 'ONE cross-generation delta reviewer (no separate reviser, mandatory even with zero open findings — see the loop\'s own header comment)' : 'focused revision + delta review'}, round ${_deltaRound}/${_maxDeltaRounds} (epoch delta rounds used so far: ${_deltaRoundOffset}).`)
  _recordPhaseBoundary(`ProposalReview-delta-round-${_deltaRound}`, _deltaRound, await _renewLease(`ProposalReview-delta-round-${_deltaRound}`, _deltaRound))

  // gap-prepare-milestone-task-epoch-budget-reset: check ONCE per delta-round iteration (covering
  // both the revise + delta-review dispatch below, the SAME per-iteration granularity this loop's
  // own DIR-125 caps just above already use) — a breach here still persists the review checkpoint
  // FIRST (this generation's ledger progress must survive into the needs-human terminal, the same
  // "every ProposalReview terminal writes the checkpoint" discipline every other exit here follows),
  // then releases the lease via the shared _epochBreachExit path. Dispatches NOTHING further.
  {
    const _epochCap = _checkEpochCapsInline(false)
    if (_epochCap.breached) {
      await _writeReviewCheckpoint('epoch-cap-delta-round', { terminalReason: _epochCap.code, terminalOutcome: 'needs-human' })
      return await _epochBreachExit('ProposalReview', 'epoch-cap-delta-round', _epochCap)
    }
  }

  if (!_isCrossGenFirstRound) {
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
    _epochThisGenDispatches += 1
    if (_reviseResult?.sessionId) _reviserSessions.push(_reviseResult.sessionId)
    if (_reviseResult?.proposalHash) _proposalHashes.push({ round: _deltaRound, hash: _reviseResult.proposalHash })
    if (!_reviseResult || _reviseResult.ok !== true) {
      log(`ProposalReview focused revision round ${_deltaRound} FAILED: ${_reviseResult?.error || '(agent returned nothing)'}`)
      await _writeReviewCheckpoint('proposal-revise-failed', { terminalReason: _reviseResult?.error || 'proposal-revise-failed', terminalOutcome: 'needs-human' })
      await _releaseLeaseAndRecord('proposal-revise-failed', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'proposal-revise-failed', cacheable: false })
      return { outcome: 'needs-human', reason: _reviseResult?.error || 'proposal-revise-failed', phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
    }
  }

  const _deltaReviewPrompt = _isCrossGenFirstRound
    ? `Cross-generation DELTA reviewer for task ${_taskId} — a prior generation already completed the ONE full independent review this scope epoch allows (checkpoint diff classification: ${_crossGenClassification}). Do NOT re-derive or re-review the whole Proposal from scratch, and do NOT act as a reviser — the Proposal you are about to read has ALREADY been edited since that review (by a human or a prior agent, outside this dispatch).

Read the CURRENT task via \`task_get ${_taskId}\`.

IMPORTANT: the checkpoint's mechanical diff classification above (\`${_crossGenClassification}\`) is ADVISORY input only — it is a fast heuristic keyed mainly on backtick-quoted identifier sets, NOT a substitute for your own independent judgment. It can be WRONG in a specific, known way: an edit that keeps the same identifiers but WEAKENS, adds an exception/loophole to, or contradicts an existing safety/wiring claim's behavior, or that DELETES an existing claim entirely, can still classify as \`${_crossGenClassification}\` even though it is a real regression. Do not defer to it — verify the substance yourself.

The Proposal text as it stood at the checkpoint's last full review (the "BEFORE"):
\`\`\`
${_crossGenReviewedProposalText || '(empty — the checkpoint recorded no prior text)'}
\`\`\`

Mechanically-detected novel claims from the cross-generation diff scan (verify each yourself — do not just trust the scan; if genuinely novel AND wiring-shaped, report it as a NEW blocking finding requiring Acceptance-Criteria coverage):
${JSON.stringify((_crossGenNoveltyScan?.novelClaims || []).map((c) => c.sentence))}

Previously recorded open blocking findings (verify status against the CURRENT Proposal):
${openBlocking.length > 0 ? openBlocking.map((f) => `- [${f.id}] (${f.subsystem}) ${f.summary}`).join('\n') : '(none — the carried checkpoint ledger is currently clean; this does NOT mean the edit is automatically safe, see step 2 below)'}

1. For each finding id above, confirm whether it is now resolved by the edit already on disk.
2. Compare the BEFORE text above against the CURRENT task's \`## Proposal\` sentence by sentence. For every claim present in BOTH (even ones the mechanical classifier considered unchanged because the identifiers match): confirm its behavior, guarantee, or condition was NOT weakened, exception-carved, or contradicted. For every claim present in BEFORE but ABSENT from CURRENT: confirm its removal is explicitly and specifically justified — by an already-resolved/dispositioned ledger finding whose own recorded identity is genuinely ABOUT that removal (not merely a finding that happens to mention the same file/function names for an unrelated reason), or by a clearly-stated reason in the current Proposal text itself. If you find a weakened, contradicted, or unjustified-removed claim, report it as a NEW blocking finding ({subsystem, summary, severity:"blocker", blocking:true, evidence: <quote the BEFORE and AFTER text>, claimRef, disposition:"unresolved"}) — this is exactly the class of regression the mechanical classifier alone cannot see, which is why you are dispatched even when the carried ledger already looks clean.
3. For each novel claim listed above (if any), verify whether it is genuinely a NEW wiring/mechanism claim requiring Acceptance-Criteria coverage — if so, report it as a new BLOCKING finding ({subsystem, summary, severity:"blocker", blocking:true, evidence, claimRef, disposition:"unresolved"}).
4. Report ONLY currently-open findings (blocking or non-blocking) as the \`findings\` array — a finding you already know about and consider unchanged should be reported again with the SAME subsystem/claimRef so it keeps its identity. Do NOT re-run a full independent Proposal re-derivation; your job is verifying THIS diff, not re-authoring the Proposal.
5. ${_sessionIdInstruction}
6. BEFORE returning, run \`date +%s%3N\` (real epoch milliseconds) and include the result as \`nowMs\` (a number) — the orchestrating workflow script cannot read the clock itself.
7. Return {resolvedIds: [<ids from the list above now resolved>], findings: [<any still-open findings, typed the same way as the full review, including any weakened/contradicted/unjustified-removed claim found in step 2>], proposalHash: <a short hash/fingerprint you compute over the CURRENT Proposal text>, nowMs: <the real epoch-ms number from step 6>, sessionId: <your real session id>}.`
    : `INDEPENDENT delta review, round ${_deltaRound}/${_maxDeltaRounds}, of task ${_taskId}'s just-revised \`## Proposal\` — you did NOT author or revise it. Read the CURRENT task via \`task_get ${_taskId}\`.

Previously recorded open blocking findings:
${openBlocking.map((f) => `- [${f.id}] (${f.subsystem}) ${f.summary}`).join('\n')}

1. For each finding id above, confirm whether it is now resolved.
2. Report ONLY currently-open findings (blocking or non-blocking) as the \`findings\` array — a finding you already reported before and consider unchanged should be reported again with the SAME subsystem/claimRef so it keeps its identity. Do NOT re-run a full independent Proposal re-derivation.
3. ${_sessionIdInstruction}
4. BEFORE returning, run \`date +%s%3N\` (real epoch milliseconds) and include the result as \`nowMs\` (a number) — the orchestrating workflow script cannot read the clock itself.
5. Return {resolvedIds: [<ids from the list above now resolved>], findings: [<any still-open findings, typed the same way as the full review>], nowMs: <the real epoch-ms number from step 4>, sessionId: <your real session id>}.`
  const _deltaReviewLabel = _isCrossGenFirstRound ? 'proposal-crossgen-delta-review' : `proposal-delta-review-round-${_deltaRound}`
  const _deltaReviewResult = await agent(_deltaReviewPrompt,
    { label: _deltaReviewLabel, phase: 'ProposalReview',
      schema: { type: 'object', properties: { resolvedIds: { type: 'array', items: { type: 'string' } }, findings: { type: 'array', items: _findingSchema }, proposalHash: { type: 'string' }, nowMs: { type: 'number' }, sessionId: { type: 'string' } } } }
  )
  _epochThisGenDispatches += 1
  _epochThisGenDeltaRounds += 1
  if (_deltaReviewResult?.sessionId) _reviewSessions.push(_deltaReviewResult.sessionId)
  if (_isCrossGenFirstRound && _deltaReviewResult?.proposalHash) _proposalHashes.push({ round: _deltaRound, hash: _deltaReviewResult.proposalHash })
  _applyResolutions(_deltaReviewResult?.resolvedIds, _deltaRound)
  _upsertFindings(_deltaReviewResult?.findings, _deltaRound)
  if (Number.isFinite(_deltaReviewResult?.nowMs)) _latestKnownNowMs = _deltaReviewResult.nowMs
}

if (_terminalReason === 'split-recommended') {
  log(`ProposalReview: split recommended — ${_splitRecommendation.reason}`)
  await _writeReviewCheckpoint('split-recommended', { terminalReason: 'split-recommended', terminalOutcome: 'needs-human' })
  await _releaseLeaseAndRecord('split-recommended', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'split-recommended', cacheable: true })
  return { outcome: 'needs-human', reason: 'split-recommended', splitRecommendation: _splitRecommendation, phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
if (_terminalReason === 'soft-budget-exceeded') {
  log(`ProposalReview: soft budget (${_policyCaps.softBudgetMs / 60000}m) exceeded with ${_blockingOpen().length} blocking finding(s) still open.`)
  await _writeReviewCheckpoint('soft-budget-exceeded', { terminalReason: 'soft-budget-exceeded', terminalOutcome: 'needs-human' })
  await _releaseLeaseAndRecord('soft-budget-exceeded', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'soft-budget-exceeded', cacheable: false })
  return { outcome: 'needs-human', reason: 'soft-budget-exceeded', phase: 'ProposalReview', ledger: _ledger, elapsedMs: _now() - _startedAtMs, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
if (_terminalReason === 'delta-cap-exhausted') {
  log(`ProposalReview: delta-review cap (${_maxDeltaRounds}) exhausted with ${_blockingOpen().length} blocking finding(s) still open.`)
  await _writeReviewCheckpoint('delta-cap-exhausted', { terminalReason: 'delta-cap-exhausted', terminalOutcome: 'needs-human' })
  await _releaseLeaseAndRecord('delta-cap-exhausted', { terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'delta-cap-exhausted', cacheable: false })
  return { outcome: 'needs-human', reason: 'delta-cap-exhausted', phase: 'ProposalReview', ledger: _ledger, reviewSessions: _reviewSessions, reviserSessions: _reviserSessions }
}
log(`ProposalReview PASSED — zero open blocking findings after ${_useCrossGenDelta ? '0 full synthesis (cross-generation delta continuation)' : '1 full synthesis'} + ${_deltaRound} delta round(s) this generation (epoch delta rounds used so far: ${_deltaRoundOffset}); ${_ledger.length} total finding(s) recorded.`)
await _writeReviewCheckpoint('proposal-review-passed', { terminalReason: 'zero-finding', terminalOutcome: 'prepared-pending' })

// ── Phase: PlanAuthor ─────────────────────────────────────────────────────────────────
phase('PlanAuthor')
_recordPhaseBoundary('PlanAuthor', 0, await _renewLease('PlanAuthor', 0))

const _slug = _taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const _planFile = `docs/plans/${_milestoneId}-${_slug}.md`

// gap-prepare-milestone-task-epoch-budget-reset: check BEFORE dispatching PlanAuthor.
{
  const _epochCap = _checkEpochCapsInline(false)
  if (_epochCap.breached) return await _epochBreachExit('PlanAuthor', 'epoch-cap-plan-author', _epochCap)
}

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
_epochThisGenDispatches += 1

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
  _recordPhaseBoundary(`PlanCheck-round-${_planCheckRound}`, _planCheckRound, await _renewLease(`PlanCheck-round-${_planCheckRound}`, _planCheckRound))

  // gap-prepare-milestone-task-epoch-budget-reset: check ONCE per PlanCheck-round iteration
  // (covering both the check dispatch AND its conditional revise dispatch below) — a breach
  // stops before either.
  {
    const _epochCap = _checkEpochCapsInline(false)
    if (_epochCap.breached) return await _epochBreachExit('PlanCheck', 'epoch-cap-plancheck-round', _epochCap)
  }

  const checkResult = await agent(
    `INDEPENDENT grounded Plan check, round ${_planCheckRound}/${MAX_PLANCHECK_ROUNDS}, for ${_planFile} (task ${_taskId}) — you did NOT author this Plan.

Verify against the CURRENT repository: signatures, call sites, dependency order, commands, line budgets, stage classification (code vs prose), AC coverage (every task AC maps to >=1 stage), and touch-set completeness against the task/charter '## Touches' declaration.

${_sessionIdInstruction}

Return {findings: <integer count, 0 if none>, findingsDetail: <list each finding>, sessionId: <your real session id>}.`,
    { label: `plan-check-round-${_planCheckRound}`, phase: 'PlanCheck',
      schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'number' }, findingsDetail: { type: 'string' }, sessionId: { type: 'string' } } } }
  )
  _epochThisGenDispatches += 1
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
  _epochThisGenDispatches += 1
}

if (_planCheckFindings !== 0) {
  log(`PlanCheck exhausted ${MAX_PLANCHECK_ROUNDS} rounds without reaching F_i=0.`)
  await _releaseLeaseAndRecord('plancheck-rounds-exceeded', { terminalPhase: 'PlanCheck', outcome: 'revision-needed', reason: 'plancheck-rounds-exceeded', cacheable: false })
  return { outcome: 'revision-needed', reason: 'plancheck-rounds-exceeded', phase: 'PlanCheck' }
}

// ── Phase: Receipt ────────────────────────────────────────────────────────────────────
phase('Receipt')
_recordPhaseBoundary('Receipt', 0, await _renewLease('Receipt', 0))

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
// M206/X1: mechanism-inventory.json written beside proposal-ledger.json, same convention.
const _inventoryFile = `milestones/${_milestoneId}/mechanism-inventory.json`
const _inventoryJson = JSON.stringify({ mechanisms: _rawMechanisms || [], inventory: _mechanismInventory || {}, source: _mechanismInventorySource }, null, 2)
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

// M203/DIR-126-D Claim A.4 — Receipt-phase split, dispatch count 2 -> 3 (scoped to Receipt only;
// the 13 pre-Receipt sites and reuse-terminal stay at exactly 1, unchanged): write the generation
// telemetry record FIRST, before the receipt-build agent ever runs — closes a real gap where
// today's flow lets the receipt-build agent call run (and even the receipt file get written) before
// any generation-identity record exists, so a silent generation-record write failure would be
// invisible, absorbed into a false 'prepared' certification. A write failure here returns
// needs-human/telemetry-write-failed and releases the lease WITHOUT ever dispatching --build.
const _writeTelResult = await _writeGenerationTelemetry('Receipt', { terminalPhase: 'Receipt', outcome: 'prepared', reason: 'prepared', cacheable: false })
const _writeTelVerdict = _writeTelResult?.raw ? _parseAgentJson(_writeTelResult.raw) : null

if (!_writeTelVerdict || _writeTelVerdict.ok !== true || _writeTelVerdict.telemetryWriteOk === false) {
  log(`Receipt phase: generation-telemetry write FAILED (verdict: ${JSON.stringify(_writeTelVerdict)}) — releasing the lease, never dispatching --build off an unwritten telemetry record.`)
  await _releaseLease('Receipt', { reason: 'telemetry-write-failed' })
  return { outcome: 'needs-human', reason: 'telemetry-write-failed', phase: 'Receipt' }
}
const _telemetryFile = _writeTelVerdict.telemetryFile
log(`Receipt phase: generation-telemetry written to ${_telemetryFile} — proceeding to --build --telemetry against a file that already exists on disk.`)

const receiptResult = await agent(
  `Write the preparation receipt + finding ledger + mechanism inventory for task ${_taskId} / milestone ${_milestoneId}.

1. Write the file ${_ledgerFile} with EXACTLY this content (create parent directories as needed):

\`\`\`json
${_ledgerJson}
\`\`\`

2. Write the file ${_inventoryFile} with EXACTLY this content (create parent directories as needed):

\`\`\`json
${_inventoryJson}
\`\`\`

3. Run: node --no-warnings --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --build --task-id ${_taskId} --milestone-id ${_milestoneId} --task ${_taskFile} --charter ${_charterFile} --plan ${_planFile} --review-findings 0 --plancheck-rounds ${_planCheckRound} --plancheck-findings 0 --ledger ${_ledgerFile} --telemetry ${_telemetryFile} --mechanism-inventory ${_inventoryFile} --convergence-json '${_convergenceJson}' --out ${_receiptFile}${_provenanceFlags}

(Add --sources <comma-separated list> naming every source file the Plan-check actually inspected, and --touches <comma-separated list> matching the checked Plan's declared touch set, if either is non-empty — read them from the Plan file at ${_planFile}.)

4. Then run: node --no-warnings --experimental-strip-types experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts --task ${_taskFile} --charter ${_charterFile} --receipt ${_receiptFile}

Return {ok: <step-4 command exit === 0>, receiptFile: "${_receiptFile}", detail: <step-4 command's printed line>}.`,
  { label: 'receipt', phase: 'Receipt',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, receiptFile: { type: 'string' }, detail: { type: 'string' } } } }
)

if (!receiptResult || receiptResult.ok !== true) {
  log(`Receipt phase FAILED self-check: ${receiptResult?.detail || '(agent returned nothing)'}`)
  await _releaseLease('Receipt', { reason: 'receipt-selfcheck-failed' })
  return { outcome: 'revision-needed', reason: 'receipt-selfcheck-failed', phase: 'Receipt' }
}

log(`Prepared: ${_taskId} — receipt at ${_receiptFile}, ledger at ${_ledgerFile}, telemetry at ${_telemetryFile}, Plan at ${_planFile}, ${_planCheckRound} Plan-check round(s), ${_fullSynthesisCount} full synthesis${_resumeFromAdjudicatedProposal ? ' (resumed — ProposalAuthors/Adjudicate skipped)' : ''} + ${_deltaRound} delta round(s), zero open blocking findings.`)

// Final release (WIRING-CLAIM 2, line-497-class success return): the single most safety-critical
// site — a verifier who stops at "11 named outcome sites" would never check this one, since it is
// the file's own final success return, additional to and not folded into the other 11. Release
// ONLY (no write — the generation-telemetry write already happened above, before --build ran).
await _releaseLease('Receipt', { reason: 'prepared' })

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
