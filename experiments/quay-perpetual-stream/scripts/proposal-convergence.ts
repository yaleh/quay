// proposal-convergence.ts — DIR-125: the bounded ProposalReview convergence engine.
//
// PROBLEM this closes: DIR-120/M192 exposed prepare-milestone.js's ProposalReview phase as an
// UNBOUNDED loop — a nonzero review immediately returned `revision-needed`, the CALLER restarted
// the whole workflow, and two new Proposal authors + a new adjudicator rewrote the complete
// Proposal before every single review. Ten real attempts (finding sequence 8→2→1→1→1→2→2→1→2→1)
// consumed ~3h15m active workflow time / ~1.13M output tokens without ever reaching PlanAuthor.
// PlanCheck already has a real bound (<=3 rounds, F_i=0 — see milestone-preparation-check.ts's
// `plancheck-rounds-exceeded`); ProposalReview had none. This module is the SAME kind of bound for
// ProposalReview: one full synthesis per generation, then focused delta rounds against a typed,
// disposition-tracked finding ledger, with a hard round cap and a soft wall-clock budget.
//
// This module is PURE (no agent/LLM dispatch, no file I/O) so it can be unit tested directly and
// consumed by milestone-preparation-check.ts (a real ESM import) for mechanical, receipt-side cap
// re-verification. prepare-milestone.js (both mirrors) is a self-contained workflow file with NO
// import statements (established convention — see its own PlanCheck loop's inline
// `MAX_PLANCHECK_ROUNDS` constant); it therefore embeds the SAME decision logic inline rather than
// importing this module at runtime. The values MUST match `capsFor()` below — this is asserted by
// experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs's
// "prepare-milestone.js inline caps match capsFor()" cross-check test.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDirectEntry, parseArgs } from "./gate-script-base.ts";
import { extractSection } from "./task-schema.ts";
import { PREFLIGHT_POLICY_VERSION, releaseLease } from "./prepare-admission-check.ts";

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ── capsFor — the ONE fail-closed policy surface (DIR-125 Requested-action item 3): callers may
// LOWER these values (see validateConvergenceCounters / prepare-milestone.js's `$a.maxDeltaRounds`
// clamp), never raise them. ──────────────────────────────────────────────────────────────────────
export function capsFor(highRisk) {
  const hr = highRisk === true;
  return {
    maxFullSynthesis: 1,
    maxDeltaRounds: hr ? 3 : 2,
    softBudgetMs: (hr ? 75 : 45) * 60 * 1000,
  };
}

export const DISPOSITIONS = ["plan", "split", "accepted-risk", "backlog", "duplicate", "superseded"];
export function isValidDisposition(d) {
  return DISPOSITIONS.includes(d);
}

const SEVERITIES = ["blocker", "major", "minor", "nit"];
export function normalizeSeverity(s) {
  const v = String(s ?? "").toLowerCase();
  return SEVERITIES.includes(v) ? v : "major";
}

function normalizeKey(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ── fingerprintFinding — stable identity ANCHORED on (subsystem, claimRef) when a claimRef is
// given, else (subsystem, normalized summary). DIR-125 AC: "stable IDs across wording-only
// revisions" — a finding's prose (summary/evidence) may be reworded round to round without its id
// changing, because the id never hashes summary text once a claimRef exists.
export function fingerprintFinding({ subsystem, claimRef, summary }) {
  const identity = claimRef
    ? `${normalizeKey(subsystem)}::claim::${normalizeKey(claimRef)}`
    : `${normalizeKey(subsystem)}::summary::${normalizeKey(summary)}`;
  return sha256(identity).slice(0, 12);
}

// ── upsertFindings — merge one round's raw findings into an existing ledger. Immutable: returns a
// NEW array, never mutates `ledger`. A raw finding lacking `blocking:true` is filed as non-blocking
// with an explicit disposition (defaults to "backlog" if the caller omitted/misspelled one — never
// silently discarded, per DIR-125 item 6).
export function upsertFindings(ledger, rawFindings, round) {
  const byId = new Map((ledger || []).map((f) => [f.id, { ...f }]));
  for (const raw of rawFindings || []) {
    const blocking = raw.blocking === true;
    const id = raw.id && byId.has(raw.id) ? raw.id : fingerprintFinding(raw);
    const existing = byId.get(id);
    const disposition = blocking ? "unresolved" : (isValidDisposition(raw.disposition) ? raw.disposition : "backlog");
    byId.set(id, {
      id,
      subsystem: raw.subsystem || existing?.subsystem || "unspecified",
      summary: raw.summary || existing?.summary || "",
      severity: normalizeSeverity(raw.severity ?? existing?.severity),
      blocking,
      everBlocking: blocking || existing?.everBlocking || false,
      disposition,
      evidence: raw.evidence || existing?.evidence || "",
      claimRef: raw.claimRef || existing?.claimRef || null,
      status: "open",
      firstSeenRound: existing?.firstSeenRound ?? round,
      lastSeenRound: round,
    });
  }
  return [...byId.values()];
}

// ── applyResolutions — a delta reviewer explicitly names which PRIOR blocking finding ids it
// verified are now fixed. Resolution flips blocking->false and status->resolved; a blocking
// finding's placeholder "unresolved" disposition becomes "backlog" (a resolved blocker is not
// automatically re-classified as anything more specific — the reviewer may still hand it an
// explicit disposition on a later round via upsertFindings). everBlocking is preserved (never
// reset) so blockingFindingYield can still count it.
export function applyResolutions(ledger, resolvedIds, round) {
  const idSet = new Set(resolvedIds || []);
  return (ledger || []).map((f) =>
    idSet.has(f.id)
      ? { ...f, status: "resolved", blocking: false, disposition: f.disposition === "unresolved" ? "backlog" : f.disposition, lastSeenRound: round }
      : f
  );
}

export function blockingOpen(ledger) {
  return (ledger || []).filter((f) => f.blocking && f.status === "open");
}

export function groupBlockingBySubsystem(ledger) {
  const out = {};
  for (const f of blockingOpen(ledger)) out[f.subsystem] = (out[f.subsystem] || 0) + 1;
  return out;
}

// ── checkSplitRecommendation — DIR-125 Requested-action item 7: recommend, never auto-perform.
// Three independent triggers: (a) >=3 independent blocking findings in one subsystem, (b) more
// than 2 independently landable mechanisms in the candidate, (c) checked touch set exceeds the
// configured small-milestone boundary (default 8 — a tunable policy default, not a repo-wide
// convention; callers may override via `smallMilestoneTouchBoundary`).
export function checkSplitRecommendation({ ledger, mechanismCount, touchSetSize, smallMilestoneTouchBoundary = 8 } = {}) {
  const bySubsystem = groupBlockingBySubsystem(ledger);
  for (const [subsystem, count] of Object.entries(bySubsystem)) {
    if (count >= 3) {
      return { recommend: true, code: "split-subsystem-blocking-cluster", reason: `subsystem "${subsystem}" has ${count} independent blocking findings (>= 3)` };
    }
  }
  if (Number.isFinite(mechanismCount) && mechanismCount > 2) {
    return { recommend: true, code: "split-multi-mechanism", reason: `candidate contains ${mechanismCount} independently landable mechanisms (> 2)` };
  }
  if (Number.isFinite(touchSetSize) && Number.isFinite(smallMilestoneTouchBoundary) && touchSetSize > smallMilestoneTouchBoundary) {
    return { recommend: true, code: "split-touch-set-too-large", reason: `checked touch set (${touchSetSize}) exceeds the small-milestone boundary (${smallMilestoneTouchBoundary})` };
  }
  return { recommend: false };
}

// ── budgetStatus — a deterministic, injectable-clock-friendly pure function: pass `nowMs` from
// whatever clock the caller controls (production: Date.now(); tests: a fake incrementing clock).
export function budgetStatus({ startedAtMs, nowMs, softBudgetMs }) {
  const elapsedMs = Math.max(0, (Number.isFinite(nowMs) ? nowMs : Date.now()) - startedAtMs);
  return { elapsedMs, exceeded: elapsedMs >= softBudgetMs };
}

// ── nextAction — the ONE decision function the bounded loop consults every round. Pure: never
// mutates its inputs, never dispatches anything itself.
export function nextAction({ fullSynthesisCount, deltaRound, ledger, caps, budgetExceeded, splitCheck }) {
  if ((fullSynthesisCount || 0) < 1) return { action: "dispatch-full-synthesis" };
  const openBlocking = blockingOpen(ledger).length;
  if (openBlocking === 0) return { action: "stop-prepared" };
  if (splitCheck?.recommend) return { action: "stop-split", reason: splitCheck.reason, code: splitCheck.code };
  if (budgetExceeded) return { action: "stop-needs-human", reason: "soft-budget-exceeded", code: "budget-exceeded" };
  if ((deltaRound || 0) >= caps.maxDeltaRounds) {
    return { action: "stop-needs-human", reason: `delta-review cap (${caps.maxDeltaRounds}) exhausted with ${openBlocking} blocking finding(s) still open`, code: "delta-cap-exhausted" };
  }
  return { action: "dispatch-delta-round" };
}

export function hashLedger(ledger) {
  return sha256(JSON.stringify(ledger ?? []));
}

// ── validateConvergenceCounters — the MECHANICAL, receipt-side re-check (never trusting the
// workflow's own internal counting): equivalent in strength to milestone-preparation-check.ts's
// pre-existing `plancheck-rounds-exceeded` (rounds > 3) hard rejection.
export function validateConvergenceCounters({ highRisk, fullSynthesisCount, deltaRounds }) {
  const caps = capsFor(!!highRisk);
  if ((fullSynthesisCount ?? 0) > caps.maxFullSynthesis) {
    return { ok: false, code: "convergence-full-synthesis-exceeded", message: `recorded fullSynthesisCount (${fullSynthesisCount}) exceeds the policy maximum (${caps.maxFullSynthesis}) for one generation` };
  }
  if ((deltaRounds ?? 0) > caps.maxDeltaRounds) {
    return { ok: false, code: "convergence-delta-rounds-exceeded", message: `recorded deltaRounds (${deltaRounds}) exceeds the ${highRisk ? "highRisk" : "ordinary"} policy maximum (${caps.maxDeltaRounds})` };
  }
  return { ok: true, code: "convergence-within-caps", message: "convergence counters within policy caps" };
}

// ── computeConvergenceMetrics — DIR-125 Requested-action item 10 / DoD instrumentation list.
// `proposalHashes` is an array of {round, hash} entries recorded once per full synthesis AND once
// per delta round's post-revision Proposal state.
export function computeConvergenceMetrics({ fullSynthesisCount, deltaRounds, ledger, proposalHashes, startedAtMs, endedAtMs, reachedPlanAuthor, terminalReason }) {
  const proposalReviewRounds = 1 + (deltaRounds || 0);
  const total = (ledger || []).length;
  const everBlockingCount = (ledger || []).filter((f) => f.everBlocking).length;
  const blockingFindingYield = total === 0 ? 0 : Number((everBlockingCount / total).toFixed(3));
  const distinctHashes = new Set((proposalHashes || []).map((h) => h.hash)).size;
  const attempts = Math.max(1, (fullSynthesisCount || 0) + (deltaRounds || 0));
  const proposalChurnRatio = Number((distinctHashes / attempts).toFixed(3));
  return {
    prepareWallTimeMs: Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) ? endedAtMs - startedAtMs : null,
    fullSynthesisCount: fullSynthesisCount || 0,
    proposalReviewRounds,
    blockingFindingYield,
    proposalChurnRatio,
    reachedPlanAuthor: !!reachedPlanAuthor,
    openBlockingCount: blockingOpen(ledger).length,
    terminalReason: terminalReason || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── decideResumeGeneration — DIR-126-C/M202: generation-aware resume. Third child of DIR-126's
// 5-way split. Replaces the caller-supplied, prose-documented-only `resumeFromAdjudicatedProposal`
// boolean with a fail-closed, hash/provenance-derived three-state decision (cold/resume/
// reuse-terminal). PURE — no fs, no agent dispatch. All hash computation and record I/O are the
// CALLER's responsibility (the CLI tail below, or prepare-milestone.js's own `--decide-resume`
// dispatch), exactly like every other input this module already consumes. See
// tasks/DIR-126-C.md's own '## Proposal' > 'Chosen mechanism' for the full design and evaluation
// order this function implements verbatim as a plain series of `if`s (no try/catch — exception-
// to-cold wrapping happens at the CLI layer, the only layer capable of throwing on malformed disk
// state). ═══════════════════════════════════════════════════════════════════════════════════════

// Deliberately finer-grained than prepare-milestone.js's own coarse `phase()` labels (which today
// reuse 'Preflight' for BOTH the content and plan-shape call sites) so the two `preflight-rejected`
// terminals — which have very different real re-derivation cost — are distinguishable.
export const PHASE_RANK = {
  PreflightContent: 0,
  ProposalAuthors: 1,
  Adjudicate: 2,
  ProposalReview: 3,
  PlanAuthor: 4,
  PreflightPlan: 5,
  PlanCheck: 6,
  Receipt: 7,
};

// A plain, manually-bumped literal matching PREFLIGHT_POLICY_VERSION's own established shape —
// combined with it (via sha256) for currentReviewPolicyHash. Bump whenever this module's own
// resume/reuse decision logic changes in a way that should invalidate every prior generation
// record.
export const RESUME_POLICY_VERSION = "resume-v1";

// Explicit allowlist of {terminalPhase, reason} PAIRS, not `reason` alone — the live workflow
// returns the IDENTICAL string 'preflight-rejected' from two genuinely different points in the
// pipeline (content, pre-Adjudicate; plan-shape, post-PlanAuthor) with very different real
// re-derivation cost. A PreflightPlan/preflight-rejected record is deliberately excluded: it
// depends on Plan-file content this mechanism's hashes never cover, and a real PlanAuthor agent
// has already run by the time it fires, so caching it under reuse-terminal would falsely claim
// savings a PreflightContent cache hit actually delivers.
export const CACHEABLE_TERMINALS = [
  { terminalPhase: "PreflightContent", reason: "preflight-rejected" },
  { terminalPhase: "ProposalReview", reason: "split-recommended" },
];

function _isCacheablePair(terminalPhase, reason) {
  return CACHEABLE_TERMINALS.some((p) => p.terminalPhase === terminalPhase && p.reason === reason);
}

// RESUMABLE_PHASES — the set of terminalPhase names ranked STRICTLY AFTER 'Adjudicate' (a strict
// `>`, not `>=`, threshold — deliberately excludes 'Adjudicate' itself). An `adjudicate-failed`
// terminal's `task_write` may never have completed, so its provenance for "what Proposal is
// currently on disk" is unverified: treating it as already-adjudicated would let `resume` skip
// re-authoring from a Proposal that was never actually written by that generation. The stricter
// threshold is the fail-closed reading and costs nothing on the common path (a real successful
// Adjudicate always advances the terminal phase past it).
export const RESUMABLE_PHASES = Object.keys(PHASE_RANK).filter((p) => PHASE_RANK[p] > PHASE_RANK.Adjudicate);

function _isResumablePhase(terminalPhase) {
  return RESUMABLE_PHASES.includes(terminalPhase);
}

// ── decideResumeGeneration — the ONE decision function the Admission phase's `--decide-resume`
// CLI mode consults, only when the caller omits `resumeFromAdjudicatedProposal` entirely (explicit
// true/false never reach here at all — see prepare-milestone.js's decision block). Evaluation
// order (verbatim from the task's own Proposal):
//   1. callerOverride === true  -> resume, caller-override-true
//   2. callerOverride === false -> cold, caller-override-false
//   (3. exceptions -> cold, decision-exception -- handled by the CLI wrapper, not here)
//   4. missing prior record -> cold, missing-prior-record
//   5. taskId mismatch -> cold, task-id-mismatch
//   6. charterHash mismatch -> cold, charter-hash-mismatch
//   7. taskContractHash mismatch -> cold, task-contract-hash-mismatch
//   8. reviewPolicyHash mismatch -> cold, review-policy-hash-mismatch
//   9. cacheable + allowlisted pair + unchanged proposalHash -> reuse-terminal
//   10. resumable phase + changed proposalHash -> resume, repaired-proposal-detected
//   11. else -> cold, no-eligible-reuse-or-resume-condition
export function decideResumeGeneration({
  priorGenerationRecord,
  currentTaskId,
  currentCharterHash,
  currentTaskContractHash,
  currentTaskProposalHash,
  currentReviewPolicyHash,
  callerOverride,
}) {
  if (callerOverride === true) {
    return { decision: "resume", reason: "caller-override-true" };
  }
  if (callerOverride === false) {
    return { decision: "cold", reason: "caller-override-false" };
  }
  const rec = priorGenerationRecord;
  if (!rec) {
    return { decision: "cold", reason: "missing-prior-record" };
  }
  if (rec.taskId !== currentTaskId) {
    return { decision: "cold", reason: "task-id-mismatch" };
  }
  if (rec.charterHash !== currentCharterHash) {
    return { decision: "cold", reason: "charter-hash-mismatch" };
  }
  if (rec.taskContractHash !== currentTaskContractHash) {
    return { decision: "cold", reason: "task-contract-hash-mismatch" };
  }
  if (rec.reviewPolicyHash !== currentReviewPolicyHash) {
    return { decision: "cold", reason: "review-policy-hash-mismatch" };
  }
  if (rec.cacheable === true && _isCacheablePair(rec.terminalPhase, rec.reason) && rec.proposalHash === currentTaskProposalHash) {
    return {
      decision: "reuse-terminal",
      reason: "unchanged-generation-terminal",
      priorGenerationId: rec.generationId,
      priorReason: rec.reason,
      priorOutcome: rec.outcome,
    };
  }
  if (_isResumablePhase(rec.terminalPhase) && rec.proposalHash !== currentTaskProposalHash) {
    return { decision: "resume", reason: "repaired-proposal-detected", priorGenerationId: rec.generationId };
  }
  return { decision: "cold", reason: "no-eligible-reuse-or-resume-condition" };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── CLI tail — `--decide-resume` / `--record-generation`, guarded by isDirectEntry (imported
// read-only from gate-script-base.ts — the SAME guard prepare-admission-check.ts's own CLI uses),
// so milestone-preparation-check.ts's existing `import { blockingOpen, validateConvergenceCounters,
// computeConvergenceMetrics } from "./proposal-convergence.ts"` stays a side-effect-free module
// load — no argv parsing, no `fs` call fires on import, only on direct invocation (WIRING-CLAIM
// R8). Hosted HERE (not on prepare-admission-check.ts) because that file is not in this task's own
// '## Touches' — see tasks/DIR-126-C.md's own Problem framing / Key design decisions for the full
// rationale (DIR-126-B's landed preflightTouchesMismatch check would mechanically flag a Plan that
// edits it). ═══════════════════════════════════════════════════════════════════════════════════

function _safeTaskIdSegment(taskId) {
  return String(taskId).replace(/[\\/]/g, "_");
}
function _leasePath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-leases", `${_safeTaskIdSegment(taskId)}.json`);
}
function _generationPath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-leases", `${_safeTaskIdSegment(taskId)}.generation.json`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── Telemetry (DIR-126-D/M203) — committed, per-attempt records at
// milestones/prepare-telemetry/<taskId>/<recordId>.json. Extends (never redesigns) DIR-126-A/B/C's
// landed lease/generation-identity machinery: this archive is purely additive, read by nothing
// upstream of it — `.generation.json`'s own shape/path/write-semantics (including no-write-on-
// reuse-terminal) stay byte-for-byte untouched. schemaVersion: 2 (superset of `.generation.json`'s
// own schemaVersion: 1 — no renames, no removals). ═══════════════════════════════════════════════

const TELEMETRY_ROOT_SEGS = ["milestones", "prepare-telemetry"];
export const TELEMETRY_SCHEMA_VERSION = 2;

// telemetryPath — Claim A.0: reuses _safeTaskIdSegment() VERBATIM (never reimplemented) for
// slash-stripping, then layers a post-hoc containment check on top, specific to this new
// PERMANENTLY GIT-COMMITTED tree (a stricter bar than .generation.json's gitignored/ephemeral
// sibling): a bare taskId of exactly ".." passes _safeTaskIdSegment completely unchanged (it only
// strips '/'/'\\') and would otherwise resolve ONE LEVEL ABOVE the intended
// milestones/prepare-telemetry/ tree. Any resolved candidate landing outside that root is
// redirected to a fixed `_unsafe-taskid` bucket instead. `taskId === null` (the three pre-lease
// sites' "taskId itself is the missing field" case) routes to a fixed `_missing-taskId` segment.
export function telemetryPath(workspace, taskId, recordId) {
  const seg = taskId === null || taskId === undefined ? "_missing-taskId" : _safeTaskIdSegment(taskId);
  const root = path.resolve(workspace, ...TELEMETRY_ROOT_SEGS);
  const candidate = path.join(workspace, ...TELEMETRY_ROOT_SEGS, seg, `${recordId}.json`);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === root || resolvedCandidate.startsWith(root + path.sep)) {
    return candidate;
  }
  return path.join(workspace, ...TELEMETRY_ROOT_SEGS, "_unsafe-taskid", `${recordId}.json`);
}

// computeAttemptId — same sha256(...).slice(0,12) idiom _computeGenerationId/fingerprintFinding
// already use, for the three pre-lease sites' attempt-scoped identity (they cannot derive a real
// generationId — no lease is ever held).
export function computeAttemptId(fields) {
  return sha256(JSON.stringify(fields ?? {})).slice(0, 12);
}

// buildTelemetryRecord — the frozen schemaVersion:2 record shape (task's own "Frozen record
// schema"). Fills every field explicitly, even when the caller omits it — an omitted-but-required
// field becomes an explicit `null`, never a dropped key (no-fabrication discipline: JSON.stringify
// never silently skips a present-but-undefined key here because every key below is materialized).
export function buildTelemetryRecord({
  recordId, attemptId, generationId,
  admission, workspace, taskId, milestoneId,
  class: klass, highRisk,
  hashes, decision,
  contentAgentDispatchCount, contentAgentMs,
  terminal, leaseRelease,
  sessionId, recordedAtMs, telemetryWriteOk,
} = {}) {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    recordId: recordId ?? null,
    attemptId: attemptId ?? null,
    generationId: generationId ?? null,
    admission: admission ?? null,
    workspace: workspace ?? null,
    taskId: taskId ?? null,
    milestoneId: milestoneId ?? null,
    class: klass ?? null,
    highRisk: highRisk === undefined ? null : highRisk,
    hashes: hashes ?? null,
    decision: decision ?? null,
    contentAgentDispatchCount: contentAgentDispatchCount === undefined ? null : contentAgentDispatchCount,
    contentAgentMs: contentAgentMs === undefined ? null : contentAgentMs,
    terminal: terminal ?? null,
    leaseRelease: leaseRelease ?? null,
    sessionId: sessionId ?? null,
    recordedAtMs: recordedAtMs ?? null,
    telemetryWriteOk: telemetryWriteOk === undefined ? true : telemetryWriteOk,
  };
}

const TELEMETRY_DECISION_KINDS = ["cold", "resume", "reuse-terminal", "not-evaluated"];

// validateTelemetryRecord — pure fail-closed validator. AC16's rule lives here: a `reuse-terminal`
// record MUST have a non-null generationId, a non-null decision.priorGenerationId, all four
// hashes.* non-null, and contentAgentDispatchCount===0 && contentAgentMs===0 — any violation is
// `{ok:false, code:"reuse-terminal-invalid"}`.
export function validateTelemetryRecord(record) {
  if (!record || typeof record !== "object") {
    return { ok: false, code: "telemetry-record-malformed", message: "telemetry record is not an object" };
  }
  if (record.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    return { ok: false, code: "telemetry-schema-version-mismatch", message: `expected schemaVersion ${TELEMETRY_SCHEMA_VERSION}, got ${record.schemaVersion}` };
  }
  const REQUIRED_TOP = [
    "recordId", "attemptId", "generationId", "admission", "workspace", "taskId", "milestoneId",
    "class", "highRisk", "hashes", "decision", "contentAgentDispatchCount", "contentAgentMs",
    "terminal", "leaseRelease", "sessionId", "recordedAtMs", "telemetryWriteOk",
  ];
  for (const k of REQUIRED_TOP) {
    if (!(k in record)) {
      return { ok: false, code: "telemetry-field-missing", message: `telemetry record is missing required field '${k}' (must be present — null/"unknown" is fine, omission is not)` };
    }
  }
  const kind = record.decision?.kind;
  if (!TELEMETRY_DECISION_KINDS.includes(kind)) {
    return { ok: false, code: "telemetry-decision-kind-invalid", message: `decision.kind must be one of ${TELEMETRY_DECISION_KINDS.join("|")}, got ${JSON.stringify(kind)}` };
  }
  if (kind === "reuse-terminal") {
    if (!record.generationId) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have a non-null generationId" };
    }
    if (!record.decision?.priorGenerationId) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have a non-null decision.priorGenerationId" };
    }
    const h = record.hashes;
    if (!h || !h.charter || !h.taskContract || !h.proposal || !h.reviewPolicy) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have all four hashes.* fields non-null" };
    }
    if (!(record.contentAgentDispatchCount === 0 && record.contentAgentMs === 0)) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have contentAgentDispatchCount === 0 && contentAgentMs === 0" };
    }
  }
  return { ok: true, code: "telemetry-record-ok", message: "telemetry record is well-formed" };
}

function _writeTelemetryRecord(workspace, taskId, recordId, record) {
  const p = telemetryPath(workspace, taskId, recordId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(record, null, 2));
  return p;
}

// Same sha256(identity).slice(0, 12) idiom fingerprintFinding already uses above — not a new ID
// convention.
function _computeGenerationId({ taskId, ownerExecutionId, fencingToken, acquiredAt }) {
  return sha256(`${taskId}::${ownerExecutionId}::${fencingToken}::${acquiredAt}`).slice(0, 12);
}

function _currentReviewPolicyHash() {
  return sha256(`${PREFLIGHT_POLICY_VERSION}::${RESUME_POLICY_VERSION}`);
}

// Reads tasks/<taskId>.md and the charter file fresh off disk, extracts '## Acceptance Criteria' /
// '## Definition of Done' / '## Touches' (via extractSection, imported read-only from
// task-schema.ts — reused, never reimplemented) for currentTaskContractHash and '## Proposal' for
// currentTaskProposalHash.
function _readCurrentHashes({ workspace, taskId, charterFile }) {
  const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
  const taskBody = fs.readFileSync(taskPath, "utf8");
  const charterBody = fs.readFileSync(path.resolve(workspace, charterFile), "utf8");
  const ac = extractSection(taskBody, "Acceptance Criteria") || "";
  const dod = extractSection(taskBody, "Definition of Done") || "";
  const touches = extractSection(taskBody, "Touches") || "";
  const proposal = extractSection(taskBody, "Proposal") || "";
  return {
    charterHash: sha256(charterBody),
    taskContractHash: sha256(`${ac}\n${dod}\n${touches}`),
    proposalHash: sha256(proposal),
    reviewPolicyHash: _currentReviewPolicyHash(),
  };
}

// --decide-resume: reads the just-acquired admission lease, derives generationId, reads the
// current task/charter fresh, reads the prior record (or null), calls the pure
// decideResumeGeneration, and — IFF the decision is reuse-terminal — ALSO releases the lease
// INSIDE this same invocation before returning (the R3 race-window fix: decision and release are
// one atomic CLI call, no window in which a second dispatch could observe
// prepare-already-running for a task about to vanish).
export function _decideResumeCli({ taskId, workspace, charterFile, callerOverride }) {
  try {
    const leaseRaw = fs.readFileSync(_leasePath(workspace, taskId), "utf8");
    const lease = JSON.parse(leaseRaw);
    const generationId = _computeGenerationId({
      taskId, ownerExecutionId: lease.ownerExecutionId, fencingToken: lease.fencingToken, acquiredAt: lease.acquiredAt,
    });
    const hashes = _readCurrentHashes({ workspace, taskId, charterFile });
    let priorGenerationRecord = null;
    const genPath = _generationPath(workspace, taskId);
    if (fs.existsSync(genPath)) {
      priorGenerationRecord = JSON.parse(fs.readFileSync(genPath, "utf8"));
    }
    const normalizedOverride = callerOverride === "true" || callerOverride === true
      ? true
      : callerOverride === "false" || callerOverride === false
        ? false
        : undefined;
    const decision = decideResumeGeneration({
      priorGenerationRecord,
      currentTaskId: taskId,
      currentCharterHash: hashes.charterHash,
      currentTaskContractHash: hashes.taskContractHash,
      currentTaskProposalHash: hashes.proposalHash,
      currentReviewPolicyHash: hashes.reviewPolicyHash,
      callerOverride: normalizedOverride,
    });
    let releaseResult;
    if (decision.decision === "reuse-terminal") {
      // A failure INSIDE the embedded release (e.g. the lease directory becomes unwritable) must
      // surface as a typed releaseResult.ok===false — never collapse the whole decision to
      // 'cold'/decision-exception, which would hide a real reuse-terminal-release-failed case
      // behind an indistinguishable generic failure code.
      try {
        releaseResult = releaseLease({ workspace, taskId, method: "normal", reason: "reuse-terminal", now: Date.now() });
      } catch (err) {
        releaseResult = { ok: false, error: err.message };
      }

      // DIR-126-D/M203 Claim A.2 — reuse-terminal's own isolated committed-telemetry write, in the
      // SAME call that already computes generationId and releases the lease inline. Runs in its
      // OWN try/catch, separate from BOTH the inline release try/catch above AND this function's
      // outer catch-all below (AC15): a write throw here must never surface as the outer
      // catch-all's swallowed-exception `{decision:'cold', reason:'decision-exception'}` shape,
      // which lacks `releaseResult` entirely and would bypass prepare-milestone.js's
      // stranded-lease guard. Validated BEFORE writing (AC16): a record that fails
      // validateTelemetryRecord is never written as reuse-terminal telemetry — the call instead
      // falls back to `decision:'cold'`/`reuse-terminal-schema-invalid'`, never a false
      // reuse-terminal pass. Does NOT touch `.generation.json` — DIR-126-C deliberately leaves it
      // unwritten on this branch, unchanged by this addition.
      let telemetryWriteOk = true;
      let schemaInvalid = false;
      try {
        const telRecord = buildTelemetryRecord({
          recordId: generationId,
          attemptId: generationId,
          generationId,
          admission: { key: lease.key ?? null, ownerExecutionId: lease.ownerExecutionId ?? null, fencingToken: lease.fencingToken ?? null, acquiredAt: lease.acquiredAt ?? null },
          workspace, taskId, milestoneId: null, class: null, highRisk: null,
          hashes: { charter: hashes.charterHash, taskContract: hashes.taskContractHash, proposal: hashes.proposalHash, reviewPolicy: hashes.reviewPolicyHash },
          decision: {
            kind: "reuse-terminal", reason: decision.reason,
            priorGenerationId: decision.priorGenerationId ?? null, priorReason: decision.priorReason ?? null,
            createsContentGeneration: false,
          },
          contentAgentDispatchCount: 0, contentAgentMs: 0,
          terminal: { outcome: decision.priorOutcome ?? null, reason: decision.priorReason ?? null, phase: null, cacheable: true },
          leaseRelease: releaseResult ? { attempted: true, ok: releaseResult.ok, reason: releaseResult.reason ?? null } : { attempted: false, ok: null, reason: null },
          sessionId: null, recordedAtMs: Date.now(),
        });
        const validation = validateTelemetryRecord(telRecord);
        if (!validation.ok) {
          schemaInvalid = true;
        } else {
          _writeTelemetryRecord(workspace, taskId, generationId, telRecord);
        }
      } catch {
        telemetryWriteOk = false;
      }
      if (schemaInvalid) {
        return { decision: "cold", reason: "reuse-terminal-schema-invalid", hashes, generationId, ...(releaseResult ? { releaseResult } : {}) };
      }
      return { ...decision, hashes, generationId, telemetryWriteOk, ...(releaseResult ? { releaseResult } : {}) };
    }
    return { ...decision, hashes, generationId, ...(releaseResult ? { releaseResult } : {}) };
  } catch (err) {
    // Evaluation-order step 3 (fail-closed on any exception — malformed disk state, missing lease,
    // missing task/charter file, unparseable prior record): the CLI wrapper is the one thing
    // capable of throwing; decideResumeGeneration itself stays a plain series of `if`s.
    return { decision: "cold", reason: "decision-exception", detail: err.message };
  }
}

// --record-generation: re-reads the task/charter FRESH (the Proposal may have been revised
// multiple times since --decide-resume ran, e.g. across ProposalReview delta rounds, so the
// record must reflect content AS OF THE ACTUAL TERMINAL, never a stale hash captured at entry),
// re-derives generationId the SAME way from the still-held lease, writes/overwrites
// .quay/prepare-leases/<taskId>.generation.json, and piggybacks releaseLease in the SAME
// invocation (replacing the bare `--release` call prepare-milestone.js makes today — per-terminal
// dispatch count unchanged).
// Shared by _recordGenerationCli and _writeGenerationTelemetryCli — derives generationId/hashes
// from the still-held lease and writes/overwrites .quay/prepare-leases/<taskId>.generation.json
// (DIR-126-C's byte-for-byte-untouched v1 shape). Deliberately does NOT touch the new committed
// telemetry file — callers add that write themselves, at whatever point in their own sequence
// (before or after release) their own Claim requires, isolated in their OWN try/catch.
function _writeLegacyGenerationRecord({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable }) {
  const leaseRaw = fs.readFileSync(_leasePath(workspace, taskId), "utf8");
  const lease = JSON.parse(leaseRaw);
  const generationId = _computeGenerationId({
    taskId, ownerExecutionId: lease.ownerExecutionId, fencingToken: lease.fencingToken, acquiredAt: lease.acquiredAt,
  });
  const hashes = _readCurrentHashes({ workspace, taskId, charterFile });
  const record = {
    schemaVersion: 1,
    taskId,
    generationId,
    charterHash: hashes.charterHash,
    taskContractHash: hashes.taskContractHash,
    proposalHash: hashes.proposalHash,
    reviewPolicyHash: hashes.reviewPolicyHash,
    terminalPhase,
    outcome,
    reason,
    cacheable: cacheable === "true" || cacheable === true,
    recordedAtMs: Date.now(),
  };
  fs.mkdirSync(path.dirname(_generationPath(workspace, taskId)), { recursive: true });
  fs.writeFileSync(_generationPath(workspace, taskId), JSON.stringify(record, null, 2));
  return { lease, generationId, hashes, record };
}

// Shared committed-telemetry-write body for Claims A.1/A.4 — its OWN try/catch, isolated from
// whatever release logic the caller performs around it, so a write throw here can never prevent or
// retroactively invalidate a release that already happened (or is about to happen).
// `decisionKind` ('cold'|'resume') threads through the workflow's OWN
// `_resumeFromAdjudicatedProposal`/`--decide-resume` verdict for THIS generation — per the frozen
// schema, `decision.kind` is `cold|resume|reuse-terminal` for admitted attempts (never the
// `not-evaluated` value reserved for the three pre-lease `--record-attempt` sites); defaults to
// `cold` when the caller omits it (the safe, conservative default — every real call site now
// threads this explicitly, see prepare-milestone.js's `_releaseLeaseAndRecord`/
// `_writeGenerationTelemetry`).
function _writeCommittedTelemetry({ taskId, workspace, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId, lease, hashes, generationId, releaseResult, decisionKind }) {
  let telemetryWriteOk = true;
  let telemetryFile = null;
  try {
    const kind = decisionKind === "resume" ? "resume" : "cold";
    const telRecord = buildTelemetryRecord({
      recordId: generationId, attemptId: generationId, generationId,
      admission: { key: lease.key ?? null, ownerExecutionId: lease.ownerExecutionId ?? null, fencingToken: lease.fencingToken ?? null, acquiredAt: lease.acquiredAt ?? null },
      workspace, taskId, milestoneId: milestoneId ?? null, class: klass ?? null,
      highRisk: highRisk === "true" || highRisk === true,
      hashes: { charter: hashes.charterHash, taskContract: hashes.taskContractHash, proposal: hashes.proposalHash, reviewPolicy: hashes.reviewPolicyHash },
      decision: { kind, reason: null, priorGenerationId: null, priorReason: null, createsContentGeneration: kind === "resume" },
      contentAgentDispatchCount: null, contentAgentMs: null,
      terminal: { outcome, reason, phase: terminalPhase, cacheable: cacheable === "true" || cacheable === true },
      leaseRelease: releaseResult ? { attempted: true, ok: releaseResult.ok, reason: releaseResult.reason ?? null } : { attempted: false, ok: null, reason: null },
      sessionId: sessionId ?? null, recordedAtMs: Date.now(),
    });
    telemetryFile = _writeTelemetryRecord(workspace, taskId, generationId, telRecord);
  } catch {
    telemetryWriteOk = false;
  }
  return { telemetryWriteOk, telemetryFile };
}

// DIR-126-D/M203 Claim A.1 — extends the existing 13-pre-Receipt-site write with a SEPARATE
// committed-telemetry write, ordered AFTER releaseLease(...) succeeds — UNCHANGED from before this
// child for the .generation.json write + release themselves (same order, same shared try block, so
// a .generation.json write failure still yields the pre-existing {ok:false} no-release-guarantee
// behavior byte-for-byte). The NEW telemetry write's own try/catch runs only once release has
// already been attempted, and is never the block releaseLease(...) runs inside, so a write throw
// there can never prevent or retroactively invalidate a release that already happened (AC13); it
// is surfaced via the returned `telemetryWriteOk` field, distinct from `ok` (which continues to
// reflect only whether this call completed without throwing — AC14).
export function _recordGenerationCli({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId, decisionKind }) {
  try {
    const { lease, generationId, hashes, record } = _writeLegacyGenerationRecord({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable });
    const releaseResult = releaseLease({ workspace, taskId, method: "normal", reason: reason || null, now: Date.now() });
    const { telemetryWriteOk, telemetryFile } = _writeCommittedTelemetry({
      taskId, workspace, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId,
      lease, hashes, generationId, releaseResult, decisionKind,
    });
    return { ok: true, record, releaseResult, telemetryWriteOk, telemetryFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// DIR-126-D/M203 Claim A.4 — Receipt-phase split, write half: extends --record-generation with a
// --no-release variant that writes .generation.json AND the new committed telemetry file but does
// NOT call releaseLease at all — backs prepare-milestone.js's restructured Receipt sequence (write
// first, then --build, then release), so a silent write failure is visible BEFORE the receipt-build
// agent call ever runs, never absorbed into a false 'prepared' certification.
export function _writeGenerationTelemetryCli({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId, decisionKind }) {
  try {
    const { lease, generationId, hashes, record } = _writeLegacyGenerationRecord({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable });
    const { telemetryWriteOk, telemetryFile } = _writeCommittedTelemetry({
      taskId, workspace, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId,
      lease, hashes, generationId, releaseResult: null, decisionKind,
    });
    return { ok: true, record, generationId, telemetryWriteOk, telemetryFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// DIR-126-D/M203 Claim A.4 — Receipt-phase split, release half: release ONLY, no write — a thin
// wrapper around the already-imported releaseLease, backing the restructured Receipt sequence's
// final step (and its telemetry-write-failure early-exit step).
export function _releaseLeaseOnlyCli({ taskId, workspace, reason }) {
  try {
    const releaseResult = releaseLease({ workspace, taskId, method: "normal", reason: reason || null, now: Date.now() });
    return { ok: true, releaseResult };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// DIR-126-D/M203 Claim A.3 — --record-attempt: the 3 pre-lease exit sites (missing-required-args,
// admission-check-failed, prepare-already-running) hold no Admission lease and cannot derive a
// real generationId (the contention/pre-lease `owner` shape structurally lacks `fencingToken` —
// point 6 of the task's own Problem framing), so this submode writes ONLY the new committed
// telemetry file (never touches .quay/prepare-leases/ at all), keyed by an attempt-scoped
// `computeAttemptId` hash of the fields the caller's own verdict already exposes.
// `taskId === null` (the missing-required-args case where taskId itself is the missing field)
// routes to telemetryPath's fixed `_missing-taskId` segment.
export function _recordAttemptCli({ taskId, workspace, site, detail }) {
  const effectiveTaskId = taskId ? taskId : null;
  let detailObj = {};
  if (detail) {
    try { detailObj = JSON.parse(detail); } catch { detailObj = { raw: detail }; }
  }
  const attemptId = computeAttemptId({ site, taskId: effectiveTaskId, detail: detailObj });
  const phase = site === "missing-required-args" ? "ProposalAuthors" : "Admission";
  const record = buildTelemetryRecord({
    recordId: attemptId, attemptId, generationId: null,
    admission: null, workspace, taskId: effectiveTaskId, milestoneId: null, class: null, highRisk: null,
    hashes: null,
    decision: { kind: "not-evaluated", reason: null, priorGenerationId: null, priorReason: null, createsContentGeneration: false },
    contentAgentDispatchCount: 0, contentAgentMs: 0,
    terminal: { outcome: "needs-human", reason: site, phase, cacheable: false },
    leaseRelease: { attempted: false, ok: null, reason: null },
    sessionId: null, recordedAtMs: Date.now(),
  });
  let telemetryWriteOk = true;
  let telemetryFile = null;
  try {
    telemetryFile = _writeTelemetryRecord(workspace, effectiveTaskId, attemptId, record);
  } catch {
    telemetryWriteOk = false;
  }
  return { ok: true, attemptId, record, telemetryWriteOk, telemetryFile };
}

async function _cliMain(argv) {
  const spec = {
    usage: "(--decide-resume|--record-generation [--no-release]|--release-only|--record-attempt) --taskId <id> --workspace <dir> [--charterFile <path>] [--callerOverride true|false] [--terminalPhase <phase>] [--outcome <o>] [--reason <r>] [--cacheable <bool>] [--milestoneId <id>] [--class <c>] [--highRisk <bool>] [--sessionId <id>] [--site <site>] [--detail <json>]",
    minArgs: 0,
    flags: {
      "decide-resume": { type: "boolean" },
      "record-generation": { type: "boolean" },
      "no-release": { type: "boolean" },
      "release-only": { type: "boolean" },
      "record-attempt": { type: "boolean" },
      taskId: { type: "string" },
      workspace: { type: "string" },
      charterFile: { type: "string" },
      callerOverride: { type: "string" },
      terminalPhase: { type: "string" },
      outcome: { type: "string" },
      reason: { type: "string" },
      cacheable: { type: "string" },
      milestoneId: { type: "string" },
      class: { type: "string" },
      highRisk: { type: "string" },
      sessionId: { type: "string" },
      site: { type: "string" },
      detail: { type: "string" },
      decisionKind: { type: "string" },
    },
  };
  const parsed = parseArgs(argv, spec);
  const taskId = parsed.flags.taskId;
  const workspace = parsed.flags.workspace;

  // DIR-126-D/M203 Claim A.3 — the one submode taskId is allowed to be absent for: the
  // missing-required-args site's whole point is that taskId itself may be the missing field.
  if (parsed.flags["record-attempt"]) {
    if (!workspace) {
      console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
      return 2;
    }
    const out = _recordAttemptCli({ taskId: taskId || null, workspace, site: parsed.flags.site, detail: parsed.flags.detail });
    console.log(JSON.stringify(out));
    return out.ok && out.telemetryWriteOk !== false ? 0 : 1;
  }

  if (!taskId || !workspace) {
    console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
    return 2;
  }
  if (parsed.flags["decide-resume"]) {
    const out = _decideResumeCli({ taskId, workspace, charterFile: parsed.flags.charterFile, callerOverride: parsed.flags.callerOverride });
    console.log(JSON.stringify(out));
    return 0;
  }
  if (parsed.flags["release-only"]) {
    const out = _releaseLeaseOnlyCli({ taskId, workspace, reason: parsed.flags.reason });
    console.log(JSON.stringify(out));
    return out.ok && out.releaseResult?.ok ? 0 : 1;
  }
  if (parsed.flags["record-generation"] && parsed.flags["no-release"]) {
    const out = _writeGenerationTelemetryCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      terminalPhase: parsed.flags.terminalPhase, outcome: parsed.flags.outcome,
      reason: parsed.flags.reason, cacheable: parsed.flags.cacheable,
      milestoneId: parsed.flags.milestoneId, class: parsed.flags.class, highRisk: parsed.flags.highRisk,
      sessionId: parsed.flags.sessionId, decisionKind: parsed.flags.decisionKind,
    });
    console.log(JSON.stringify(out));
    return out.ok && out.telemetryWriteOk !== false ? 0 : 1;
  }
  if (parsed.flags["record-generation"]) {
    const out = _recordGenerationCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      terminalPhase: parsed.flags.terminalPhase, outcome: parsed.flags.outcome,
      reason: parsed.flags.reason, cacheable: parsed.flags.cacheable,
      milestoneId: parsed.flags.milestoneId, class: parsed.flags.class, highRisk: parsed.flags.highRisk,
      sessionId: parsed.flags.sessionId, decisionKind: parsed.flags.decisionKind,
    });
    console.log(JSON.stringify(out));
    return out.ok && out.releaseResult?.ok ? 0 : 1;
  }
  console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
  return 2;
}

if (isDirectEntry(import.meta)) {
  _cliMain(process.argv).then((code) => process.exit(code));
}
