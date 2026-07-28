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
