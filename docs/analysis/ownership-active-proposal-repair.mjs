#!/usr/bin/env node
// BOUNDED PROPOSAL-REPAIR — the missing middle layer between the active investigation loop and the
// ArchGuard Refactor Slice / Expected Delta primitive.
//
// Production reading (2026-10-11, `.quay/ownership-shadow-proposals.jsonl`): of the package-cycle
// proposals that reached `slice-delta`, every one of them was REFUSED — NO_EDGE_EXPLAINED_BY_MOVES,
// coverage-insufficient, MOVE_TO_NOT_AN_INTERNAL_DIR. The limited-proposal entry bar (the admission
// gate that would let a proposal become a goal) therefore could never be satisfied. This module does
// ONE thing: given such a rejection, run a STRICTLY BOUNDED feedback-and-revise retry loop, and if it
// cannot compute a delta that passes the primitive's negative control, abstain honestly.
//
// ⛔ STRUCTURAL RED LINES (asserted by plugin/test/ownership-active-proposal-repair.test.mjs):
//   * touches none of the safety gates — evaluateEntryBar / deterministicGate / quotaGate / the
//     run-streak count / the 3-consecutive-round admission / the human-approval mechanism;
//   * imports NOTHING that files a task, a goal, or a decision (no fileProposals/driveItems/fileDecisions/proposeDraftGoal);
//   * writes no source file, creates no directory that does not already exist;
//   * uses NO holdout (A/B) result as feedback or as a candidate-generation source;
//   * hardcodes NO answer — the legal directories and symbols are read from the SAME ArchGuard graph
//     data the original investigation round already held, never from a freshly invented list.
//
// FAIL-CLOSED (硬规则 3b): a rejection that cannot be parsed, or that is not one of the known cut-level
// classes, is `honest_abstain` — never silently shaped like "repairable". A judge revision naming a
// symbol absent from the graph is NOT "covered but missing"; it is an invalid revision.

import crypto from "node:crypto";
import { DEFAULT_BUDGET } from "./ownership-active-contract.mjs";
import { computeSliceDelta } from "./ownership-active-slice-adapter.mjs";
import { appendRepairAttemptRecord } from "./architecture-evidence-store.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isArr = (x) => Array.isArray(x);

export const REPAIR_VERSION = "ownership-active-proposal-repair/1";

/** The four terminal classes a `slice_delta` rejection can fall into (enumerated, never boolean). */
export const REJECTION_CLASSES = Object.freeze(["evidence_gap", "invalid_move", "tool_limitation", "honest_abstain"]);

/** The two classes a bounded repair session may legitimately attempt. */
export const REPAIRABLE_CLASSES = Object.freeze(["invalid_move", "evidence_gap"]);

/**
 * The four hard bounds. ALL are hardcoded and a caller may only LOWER them (硬规则 4 推论二:
 * "在本机等价于无限制"的字面值不是无限制 — so the wall-clock ceiling is a real 3×600s, tied to the
 * primitive's own per-call timeout, not a host-shaped literal that silently becomes a real limit elsewhere).
 */
export const REPAIR_LIMITS = Object.freeze({
  maxRounds: 3,                                                     // revise rounds, judge call for judge call
  maxJudgeCalls: 3,                                                 // exactly maxRounds — never more for repeated failure
  maxWallClockMs: 1_800_000,                                        // 3 x the primitive's 600_000ms per-call ceiling
  maxEvidenceBytesPerRound: DEFAULT_BUDGET.max_total_evidence_bytes, // reuse the loop's budget magnitude, do not widen
});

// ── rejection taxonomy (declared as DATA so the vocabulary is enumerable and testable) ──────────
/** Reasons the SLICE BUILDER emits for a malformed/incomplete CUT — structure feedback exists to fix it. */
export const INVALID_MOVE_PREFIXES = Object.freeze([
  "NO_EDGE_EXPLAINED_BY_MOVES",
  "MOVE_TO_NOT_AN_INTERNAL_DIR",
  "MOVE_FROM_NOT_AN_INTERNAL_DIR",
  "SUBJECT_NOT_AN_INTERNAL_DIR",
]);
/** ArchGuard's own coverage refusal names the uncovered symbols — the same class (the cut is incomplete). */
export const COVERAGE_INSUFFICIENT_MARKER = "切法覆盖不足";
/** Reasons the PRIMITIVE could not run at all — a capability boundary, not a fixable cut. */
export const TOOL_LIMITATION_PREFIXES = Object.freeze([
  "ARCHGUARD_CLI_NOT_INSTALLED", "ARCHGUARD_CLI_NOT_FOUND", "ARCHGUARD_VERSION_TOO_OLD",
  "SLICE_DELTA_SUBCOMMAND_MISSING", "SLICE_DELTA_UNAVAILABLE",
  "SCOPE_ROOT_INVALID", "SCOPE_ROOT_NOT_A_TREE_AT_REF", "PACKAGE_GRAPH_BUILD_FAILED",
  "NO_MODULE_GRAPH_IN_ARCHJSON", "NO_REPORT",
]);
/** Free-text markers of a capability gap reported by the ArchGuard surface itself. */
export const TOOL_LIMITATION_MARKERS = Object.freeze(["capability_gap", "NOT_EVALUATED_BY_TOOL"]);
/** "Missing a fact that could have been looked up" — declared but NOT observed in production (2026-10-11). */
export const EVIDENCE_GAP_PREFIXES = Object.freeze(["EVIDENCE_GAP", "INSUFFICIENT_EVIDENCE", "NEEDS_EVIDENCE"]);

/** Which classes have a real production sample. `evidence_gap` has none — recorded, not fabricated. */
export const PRODUCTION_OBSERVED_CLASSES = Object.freeze(["invalid_move", "tool_limitation"]);

/**
 * Classify ONE `slice_delta` reading. PURE, enumerative. Returns `{class, is_rejection, matched, ...}`.
 * `class === null` iff the reading is not a rejection at all (`evaluated` / `guard-violated`).
 * @param {object} sliceDelta the recorded `slice_delta` (or any `{status, reason, gap}` shape)
 */
export function classifyRejection(sliceDelta) {
  if (!isObj(sliceDelta) || typeof sliceDelta.status !== "string") {
    return { class: "honest_abstain", is_rejection: true, matched: "UNREADABLE_REJECTION", status: sliceDelta?.status ?? null, reason_text: null };
  }
  const status = sliceDelta.status;
  const reason = typeof sliceDelta.reason === "string" ? sliceDelta.reason : "";
  const base = { status, reason_text: reason || null, gap: sliceDelta.gap ?? null };
  if (status === "evaluated" || status === "guard-violated") return { class: null, is_rejection: false, matched: "NOT_A_REJECTION", ...base };

  // The primitive itself could not run, or declared a capability gap: a capability boundary, not a bad cut.
  if (status === "unavailable" || sliceDelta.gap) return { class: "tool_limitation", is_rejection: true, matched: "STATUS_UNAVAILABLE_OR_GAP", ...base };
  const starts = (list) => list.find((p) => reason.startsWith(p));
  const egp = starts(EVIDENCE_GAP_PREFIXES);
  if (egp) return { class: "evidence_gap", is_rejection: true, matched: `EVIDENCE_GAP:${egp}`, ...base };
  const imp = starts(INVALID_MOVE_PREFIXES);
  if (imp) return { class: "invalid_move", is_rejection: true, matched: `INVALID_MOVE:${imp}`, ...base };
  if (reason.includes(COVERAGE_INSUFFICIENT_MARKER)) return { class: "invalid_move", is_rejection: true, matched: "INVALID_MOVE:COVERAGE_INSUFFICIENT", ...base };
  const tlp = starts(TOOL_LIMITATION_PREFIXES);
  if (tlp) return { class: "tool_limitation", is_rejection: true, matched: `TOOL_LIMITATION:${tlp}`, ...base };
  const tlm = TOOL_LIMITATION_MARKERS.find((m) => reason.toLowerCase().includes(m.toLowerCase()));
  if (tlm) return { class: "tool_limitation", is_rejection: true, matched: `TOOL_LIMITATION_MARKER:${tlm}`, ...base };
  // Fail-closed default: a rejection we cannot parse is NOT "repairable".
  return { class: "honest_abstain", is_rejection: true, matched: "UNCLASSIFIED_REJECTION", ...base };
}

/** Convenience: is this reading a rejection the bounded repair may attempt? */
export const isRepairableRejection = (sliceDelta) => REPAIRABLE_CLASSES.includes(classifyRejection(sliceDelta).class);

// ── graph-derived structure facts (the SAME ArchGuard graph data, never a fresh find/grep) ──────
/** The internal directory nodes of an ArchGuard module graph, sorted. One node per directory id. */
export const internalNodeIds = (graph) =>
  [...new Set((graph?.nodes || []).filter((n) => n && n.type === "internal" && typeof n.id === "string").map((n) => n.id))].sort();

/** Every symbol the graph knows: the union of the edges' imported names. */
export function graphSymbols(graph) {
  const s = new Set();
  for (const e of graph?.edges || []) for (const n of e.importedNames || []) if (typeof n === "string") s.add(n);
  return s;
}

/**
 * Symbols a revision names that appear NOWHERE in the graph. An unknown symbol is NOT "in the graph but
 * uncovered" — the revision is invalid and must not be able to produce a computed delta.
 */
export function unknownSymbols(graph, moves) {
  const known = graphSymbols(graph);
  const out = new Set();
  for (const m of moves || []) for (const s of m?.symbols || []) if (!known.has(s)) out.add(s);
  return [...out].sort();
}

/**
 * Edges into a moved-from dir whose imported-name set is only PARTIALLY covered by the moved symbols
 * (some names move, some do not). Mirrors the primitive's own coverage rule over the SAME graph: a fully
 * uncovered edge is a different edge the cut does not touch; a partially covered one means the cut is
 * incomplete — the "missing consumer" trap. Derived here so a formally-computing delta cannot be read as
 * success when a real consumer is left dangling.
 */
export function coverageGaps(graph, moves) {
  const movedFrom = new Map();
  for (const m of moves || []) {
    if (!m || typeof m.from !== "string") continue;
    const set = movedFrom.get(m.from) || new Set();
    for (const s of m.symbols || []) set.add(s);
    movedFrom.set(m.from, set);
  }
  const gaps = [];
  for (const [from, syms] of movedFrom) {
    for (const e of graph?.edges || []) {
      if (e?.to !== from || e?.from === from) continue;
      const names = e.importedNames || [];
      if (!names.length) continue;
      const uncovered = names.filter((n) => !syms.has(n));
      if (uncovered.length && uncovered.length < names.length) gaps.push({ edge: `${e.from} -> ${e.to}`, uncovered, covered: names.filter((n) => syms.has(n)) });
    }
  }
  return gaps;
}

/**
 * The directory feedback the repair may feed the judge. Per the ArchGuard liaison's correction, the legal
 * directory list MUST come from the SAME graph data the original investigation round already held — it is
 * NOT recomputed with an independent find/grep (whose notion of "a directory that exists" can disagree
 * with ArchGuard's notion of "an internal node"). Returns the recorded list verbatim, or `null` when the
 * record carries none (in which case the repair must abstain, never go look it up itself).
 */
export function recordedLegalDirs(candidateRecord) {
  const v = candidateRecord?.slice_delta?.detail?.valid_dirs;
  if (!isArr(v) || v.length === 0 || !v.every((x) => typeof x === "string")) return null;
  return [...v];
}

// ── lock + budget guards ────────────────────────────────────────────────────────────────────────
export class RepairLockError extends Error {
  constructor(code, message) { super(message); this.name = "RepairLockError"; this.code = code; }
}

/** The identity a repair session is locked to: the commit it investigated and the root of its cut's scope. */
export function repairLockIdentity(candidateRecord) {
  const commit = candidateRecord?.commit ?? candidateRecord?.slice_delta?.provenance?.ref_commit ?? null;
  const scope = candidateRecord?.slice_delta?.provenance?.scope_root ?? candidateRecord?.proposed_slice?.scope_root ?? null;
  return { commit: typeof commit === "string" ? commit : null, scope_root: typeof scope === "string" ? scope : null };
}

/**
 * Resolve the lock, refusing (throwing) if a caller tries to change either value, and refusing if the
 * record cannot supply them. A repair session never silently runs against a different commit or scope.
 */
export function resolveRepairLock(candidateRecord, overrides = {}) {
  const id = repairLockIdentity(candidateRecord);
  if (!isStr(id.commit, 6)) throw new RepairLockError("LOCK_COMMIT_MISSING", "the record carries no ref_commit to lock");
  if (typeof id.scope_root !== "string") throw new RepairLockError("LOCK_SCOPE_MISSING", "the record carries no scope_root to lock");
  if (overrides.lockedCommit !== undefined && overrides.lockedCommit !== id.commit) throw new RepairLockError("LOCK_COMMIT_TAMPERED", `lockedCommit ${JSON.stringify(overrides.lockedCommit)} disagrees with the record's ${JSON.stringify(id.commit)}`);
  if (overrides.lockedScope !== undefined && overrides.lockedScope !== id.scope_root) throw new RepairLockError("LOCK_SCOPE_TAMPERED", `lockedScope ${JSON.stringify(overrides.lockedScope)} disagrees with the record's ${JSON.stringify(id.scope_root)}`);
  return { commit: id.commit, scope_root: id.scope_root };
}

/** Enforce the four hard bounds. A caller may LOWER them; raising any one is refused (throws). */
export function assertRepairBudget({ maxRounds = REPAIR_LIMITS.maxRounds, maxWallClockMs = REPAIR_LIMITS.maxWallClockMs, maxJudgeCalls = REPAIR_LIMITS.maxJudgeCalls } = {}) {
  const bad = [];
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > REPAIR_LIMITS.maxRounds) bad.push(`maxRounds=${maxRounds}`);
  if (!Number.isFinite(maxWallClockMs) || maxWallClockMs < 1 || maxWallClockMs > REPAIR_LIMITS.maxWallClockMs) bad.push(`maxWallClockMs=${maxWallClockMs}`);
  if (!Number.isInteger(maxJudgeCalls) || maxJudgeCalls < 1 || maxJudgeCalls > REPAIR_LIMITS.maxJudgeCalls) bad.push(`maxJudgeCalls=${maxJudgeCalls}`);
  if (bad.length) throw new RangeError(`REPAIR_BUDGET_OVER_LIMIT:${bad.join(",")} — hard caps are rounds<=${REPAIR_LIMITS.maxRounds}, wall<=${REPAIR_LIMITS.maxWallClockMs}ms, judgeCalls<=${REPAIR_LIMITS.maxJudgeCalls}; a caller may only lower them`);
  return { maxRounds, maxWallClockMs, maxJudgeCalls };
}

// ── the judge-facing feedback + prompt (facts only — no historical answer, no holdout) ──────────
/** Build the STRUCTURED facts fed to the tool-less repair judge. Pure; contains no "correct answer". */
export function buildRepairFeedback({ graph, legalDirs, sliceDelta, moves, hypothesis, concernKey, attemptNo = 1, scopeRoot = "", subject = "" }) {
  return {
    attempt_no: attemptNo,
    concern_key: concernKey ?? null,
    original_hypothesis: hypothesis ?? null,
    rejection: { status: sliceDelta?.status ?? null, reason: sliceDelta?.reason ?? null },
    locked: { scope_root: scopeRoot, subject },
    // Legal directories come from the ORIGINAL round's ArchGuard graph data — never a fresh find/grep.
    legal_dirs: Array.isArray(legalDirs) ? legalDirs : internalNodeIds(graph),
    uncovered_symbols: isArr(moves) ? coverageGaps(graph, moves) : [],
    known_symbols: [...graphSymbols(graph)].sort(),
  };
}

/** Render the feedback as a bounded prompt block. Capped at the per-round evidence budget (never widened). */
export function renderRepairPrompt({ feedback, maxBytes = REPAIR_LIMITS.maxEvidenceBytesPerRound }) {
  const body = `You are REPAIRING a refactor cut that ArchGuard's slice-delta primitive REFUSED. You have NO tools.
Only the cut's \`moves\` may change. \`scope_root\` and \`subject\` are LOCKED (below) — returning a different value is refused.
Every \`from\`/\`to\` MUST be one of \`legal_dirs\`. Every symbol MUST appear in \`known_symbols\` (a symbol the graph does not know is not a fix).
Repair the cut so it explains the refused edge(s); do not invent directories, do not name symbols the graph does not contain.

Return exactly ONE JSON object, no prose:
{
  "action": "revise" | "abstain",
  "moves": [ { "file": "<path rel. scope_root>", "from": "<dir rel. scope_root>", "to": "<dir rel. scope_root>", "symbols": ["<names that move>"] } ],
  "why": "<one sentence>"
}

## LOCKED
${JSON.stringify({ scope_root: feedback.locked.scope_root, subject: feedback.locked.subject })}

## STRUCTURAL FACTS (from the same ArchGuard graph the cut was judged against)
${JSON.stringify(feedback, null, 1)}`;
  // Cap by BYTES, not code units — the block contains multi-byte punctuation, so a char-count slice can overshoot.
  let text = body;
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = body.slice(0, maxBytes);
    while (Buffer.byteLength(text, "utf8") > maxBytes) text = text.slice(0, -1);
  }
  return { prompt: text, bytes: Buffer.byteLength(text, "utf8"), truncated: text.length < body.length };
}

/** Fail-closed parse of a repair revision. Unreadable => null (never a half-formed revision). */
export function parseRepairRevision(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  const cands = [];
  const fenced = [...stdout.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  cands.push(...fenced);
  const first = stdout.indexOf("{"), last = stdout.lastIndexOf("}");
  if (first >= 0 && last > first) cands.push(stdout.slice(first, last + 1));
  cands.push(stdout);
  for (const c of cands) {
    try {
      const o = JSON.parse(c.trim());
      if (!isObj(o) || typeof o.action !== "string") continue;
      if (o.action === "abstain") return { action: "abstain", why: String(o.why ?? "").slice(0, 400), moves: null };
      if (o.action !== "revise") continue;
      if (!isArr(o.moves) || o.moves.length === 0) continue;
      const moves = o.moves.filter((m) => isObj(m) && typeof m.file === "string" && typeof m.from === "string" && typeof m.to === "string" && isArr(m.symbols) && m.symbols.every((s) => typeof s === "string"));
      if (!moves.length) continue;
      return { action: "revise", moves, why: String(o.why ?? "").slice(0, 400), scope_root: typeof o.scope_root === "string" ? o.scope_root : undefined };
    } catch { /* next candidate */ }
  }
  return null;
}

/** The primitive's own success shape — computed, guards clean, control falsified, and the cycle actually shrank. */
export function isPositiveDelta(delta) {
  if (!isObj(delta) || delta.status !== "evaluated") return false;
  if ((delta.guards?.violations?.length ?? 0) !== 0) return false;
  if (delta.negative_control?.falsified !== true) return false;
  const before = delta.delta?.before?.scc_size, after = delta.delta?.after?.scc_size;
  return Number.isFinite(before) && Number.isFinite(after) && after < before;
}

/**
 * Bounded proposal-repair. Attempts at most `maxRounds` judge revisions against the SAME locked
 * commit+scope, re-running the primitive each time; if none produces a positive delta (and no missing
 * consumer / fabricated symbol was accepted), it abstains honestly.
 *
 * @param {object} o
 * @param {object} o.candidateRecord the carrier record whose `slice_delta` was refused (needs `commit`,
 *                                   `proposed_slice` with the refused `moves`, and `slice_delta`)
 * @param {string} o.root            tree the primitive is re-run against
 * @param {function} o.invokeJudge   async (prompt) => {stdout,status,error} — the SAME tool-less seam the loop uses
 * @param {object} [o.deps]          { graph, getGraph, computeDelta, sliceDeps, lockedCommit, lockedScope, evidenceStore, storeRoot, now }
 */
export async function attemptRepair({ candidateRecord, root, invokeJudge, maxRounds, maxWallClockMs, maxJudgeCalls, deps = {}, now, onRound = () => {} }) {
  const clock = now || deps.now || Date.now;
  const budget = assertRepairBudget({ maxRounds, maxWallClockMs, maxJudgeCalls });      // throws if raised above the caps
  const lock = resolveRepairLock(candidateRecord, { lockedCommit: deps.lockedCommit, lockedScope: deps.lockedScope });
  const first = classifyRejection(candidateRecord?.slice_delta);
  const proposed = candidateRecord?.proposed_slice || {};
  const hypothesis = candidateRecord?.hypothesis ?? candidateRecord?.envelope?.concern ?? null;
  const concernKey = candidateRecord?.concern_key ?? null;
  const t0 = clock();
  const attempts = [];

  const record = (a) => {
    const rec = {
      contract_version: REPAIR_VERSION, attempt_no: a.attempt_no, bucket: a.bucket,
      locked_commit: lock.commit, locked_scope: lock.scope_root, original_hypothesis: hypothesis ?? null,
      concern_key: concernKey, class: a.class ?? null, matched: a.matched ?? null, judge_called: !!a.judge_called,
      computed: a.computed ?? null, coverage_gaps: a.coverage_gaps ?? [], unknown_symbols: a.unknown_symbols ?? [],
      judge_why: a.judge_why ?? null, elapsed_ms: clock() - t0,
    };
    attempts.push(rec);
    if (deps.evidenceStore) appendRepairAttemptRecord(deps.storeRoot ?? root, storeRecord(rec));
    onRound(rec);
    return rec;
  };
  let lastClass = first.class;
  const result = (outcome, reason, extra = {}) => ({
    contract_version: REPAIR_VERSION, outcome, reason, class: extra.class !== undefined ? extra.class : lastClass,
    original_class: first.class, original_matched: first.matched, locked: lock,
    rounds: attempts.filter((a) => a.judge_called).length, judge_calls: attempts.filter((a) => a.judge_called).length,
    wall_clock_ms: clock() - t0, attempts, repaired_delta: extra.repaired_delta ?? null,
  });

  if (!first.is_rejection) return result("not-a-rejection", `not a rejection: status=${first.status}`);
  // tool_limitation / honest_abstain terminate immediately with ZERO judge calls (硬规则 3b: an unparsable
  // rejection is not "repairable", and a capability boundary cannot be fixed by revising the cut).
  if (!REPAIRABLE_CLASSES.includes(first.class)) {
    record({ attempt_no: 0, bucket: first.class, matched: first.matched, judge_called: false });
    return result("abstained", `terminal-by-classification:${first.class}`);
  }
  // The directory feedback must come from the ORIGINAL round's graph data. If the record carries none, the
  // module does NOT go compute its own (the liaison's correction) — it abstains as evidence-insufficient.
  const legalDirs = recordedLegalDirs(candidateRecord);
  if (!legalDirs) {
    record({ attempt_no: 0, bucket: "honest_abstain", matched: "NO_RECORDED_LEGAL_DIRS", judge_called: false });
    return result("abstained", "no recorded legal-dir list in the original evidence; refusing to recompute one independently");
  }
  const graph = deps.graph ?? (deps.getGraph ? deps.getGraph(lock.scope_root) : null);
  if (!graph) {
    record({ attempt_no: 0, bucket: "honest_abstain", matched: "NO_GRAPH_DATA", judge_called: false });
    return result("abstained", "no ArchGuard graph data available to check symbol coverage against");
  }
  const computeDelta = deps.computeDelta || (({ proposal }) => computeSliceDelta({ root, commit: lock.commit, proposal, deps: deps.sliceDeps || {}, now: () => new Date(clock()).toISOString() }));

  let current = candidateRecord.slice_delta, moves = proposed.moves || [];
  let round = 0;
  while (round < budget.maxRounds && attempts.filter((a) => a.judge_called).length < budget.maxJudgeCalls) {
    if (clock() - t0 > budget.maxWallClockMs) {
      record({ attempt_no: round, bucket: "honest_abstain", matched: "WALL_CLOCK_EXHAUSTED", judge_called: false, class: "honest_abstain" });
      return result("abstained", "wall-clock ceiling reached");
    }
    round++;
    const feedback = buildRepairFeedback({ graph, legalDirs, sliceDelta: current, moves, hypothesis, concernKey, attemptNo: round, scopeRoot: lock.scope_root, subject: proposed.subject ?? lock.scope_root });
    const rendered = renderRepairPrompt({ feedback });
    const r = await invokeJudge(rendered.prompt);
    if (!r || r.error || (typeof r.status === "number" && r.status !== 0)) {
      record({ attempt_no: round, bucket: "honest_abstain", matched: "JUDGE_UNAVAILABLE", judge_called: true, class: "honest_abstain" });
      return result("abstained", `judge unavailable: ${r?.error?.message || `exit ${r?.status}`}`);
    }
    const rev = parseRepairRevision(r.stdout);
    if (!rev) { record({ attempt_no: round, bucket: "honest_abstain", matched: "REVISION_UNPARSABLE", judge_called: true, class: "honest_abstain" }); return result("abstained", "repair revision was unreadable"); }
    if (rev.action === "abstain") { record({ attempt_no: round, bucket: "honest_abstain", matched: "JUDGE_ABSTAINED", judge_called: true, judge_why: rev.why, class: "honest_abstain" }); return result("abstained", `judge abstained: ${rev.why}`); }
    // LOCK: a revision that tries to move the scope is a tampering of the locked value — refused, not retried.
    if (rev.scope_root !== undefined && rev.scope_root !== lock.scope_root) throw new RepairLockError("LOCK_SCOPE_TAMPERED", `the repair revision tried to change the locked scope_root to ${JSON.stringify(rev.scope_root)}`);
    moves = rev.moves;
    // A symbol the graph does not know is NOT "in the graph but uncovered": the revision is invalid, the round
    // is consumed, and NO delta is computed for it (a formally-passing stub result must never be reached).
    const unknown = unknownSymbols(graph, moves);
    if (unknown.length) { record({ attempt_no: round, bucket: "unknown_symbol", matched: "UNKNOWN_SYMBOL", judge_called: true, unknown_symbols: unknown, computed: false }); continue; }
    const gaps = coverageGaps(graph, moves);
    // The revised cut is expressed as a proposal the adapter understands: only `moves` may differ, scope+subject stay locked.
    const proposal = { concern: candidateRecord.envelope?.concern ?? proposed.concern ?? "", slice: { scope_root: lock.scope_root, subject: proposed.subject ?? lock.scope_root, moves, ...(isArr(proposed.consumers) ? { consumers: proposed.consumers } : {}) } };
    const next = await computeDelta({ root, commit: lock.commit, proposal });
    const cls = classifyRejection(next);
    if (isPositiveDelta(next) && gaps.length === 0) {
      record({ attempt_no: round, bucket: "repaired", matched: "POSITIVE_DELTA", judge_called: true, judge_why: rev.why, computed: next.status, coverage_gaps: gaps });
      return result("repaired", "a delta that passes the primitive's negative control was computed", { class: null, repaired_delta: next });
    }
    // A positive delta with a missing consumer is NOT success — the round stays unsolved.
    const bucket = gaps.length ? "invalid_move" : (cls.class ?? "honest_abstain");
    record({ attempt_no: round, bucket, matched: gaps.length ? "MISSING_CONSUMER" : cls.matched, judge_called: true, computed: next.status ?? null, coverage_gaps: gaps, class: bucket });
    current = next; lastClass = cls.class ?? "honest_abstain";
    if (!REPAIRABLE_CLASSES.includes(bucket)) break;   // the re-classified rejection is not repairable
  }
  return result("abstained", `bounded budget exhausted without a positive delta (rounds=${round})`);
}

/** Build the store record for one attempt (the shape `appendRepairAttemptRecord` validates). */
function storeRecord(rec) {
  const body = JSON.stringify({ attempt_no: rec.attempt_no, bucket: rec.bucket, matched: rec.matched, computed: rec.computed, coverage_gaps: rec.coverage_gaps, unknown_symbols: rec.unknown_symbols });
  return {
    tool: "ownership-active-proposal-repair", ref: rec.locked_commit, ts: new Date().toISOString(), sha256: sha(body),
    attempt_no: rec.attempt_no, bucket: rec.bucket, locked_commit: rec.locked_commit, locked_scope: rec.locked_scope,
    original_hypothesis: rec.original_hypothesis ?? "none established", elapsed_ms: rec.elapsed_ms,
    matched: rec.matched, judge_called: rec.judge_called, class: rec.class,
  };
}
