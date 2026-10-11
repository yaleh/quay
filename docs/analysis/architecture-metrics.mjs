#!/usr/bin/env node
// ARCHITECTURE METRICS — quantify one investigation run: what did the evidence cost, how much of what it
// proposed was real, how local was it, and how many rounds did it need to recover.
//
// The live shadow loop produced NO quantitative reading at all — only prose envelopes. This module is the
// reading half; `architecture-evidence-store.mjs` records it.
//
// 硬规则 6 (缺值 = 未查, NOT 为假) — the whole point of the `not-evaluated` state:
//   a PRODUCTION run has no ground truth. There is no way to know whether a proposal was a false positive
//   or how local it was, because nothing has been landed and scored. So those three fields come back as
//   exactly `{state:"not-evaluated"}` — never 0, never a guess, never an omitted key. A 0 there would read
//   as "measured, and it was perfect", which is the most dangerous possible lie (硬规则 3b).
//
// ⛔ STRUCTURAL SANDBOX: pure arithmetic + path-set comparison. No I/O, no write, no filing machinery.

import { subjectFilesOf, extractPathTokens } from "./architecture-evidence-store.mjs";

/** `{state:"not-evaluated"}` is a shape, not an absence — callers can distinguish it from a real 0. */
export const NOT_EVALUATED = Object.freeze({ state: "not-evaluated" });
const ne = () => ({ ...NOT_EVALUATED });
const evaluated = (value, extra = {}) => ({ state: "evaluated", value, ...extra });

/** Budget/时间 cost of the evidence actually gathered — ALWAYS known (it is a count of what happened,
 *  not a claim about the world). Reads the run record's own `usage`; never re-derives it. */
export function evidenceCost(runRecord) {
  const u = runRecord?.usage || {};
  return { rounds: u.rounds ?? null, requests: u.evidence_requests ?? null, bytes: u.evidence_bytes ?? null };
}

/** Every repo file the run actually touched: what it read (evidence provenance) plus what it proposed. */
export function touchedFilesOf(runRecord) {
  const out = new Set();
  const add = (p) => { if (typeof p === "string" && p) out.add(p.replace(/^\.\//, "")); };
  // Only FILE locations count: a grep's scope is a directory, and "I grepped a directory containing the
  // goal's file" is not the same claim as "I laid hands on the file".
  for (const e of runRecord?.evidence || []) {
    if (e?.provenance?.path) add(e.provenance.path);
    const req = e?.request || {};
    if (req.kind === "read_file") add(req.path);
  }
  for (const f of subjectFilesOf(runRecord)) add(f);
  return [...out].sort();
}

const intersection = (a, b) => [...a].filter((x) => b.has(x));
const jaccard = (a, b) => { const u = new Set([...a, ...b]); return u.size ? intersection(a, new Set(b)).length / u.size : null; };

/** Coerce a ground-truth object into a comparable shape. `changed_files` = what the goal really changed. */
export function normalizeGroundTruth(gt) {
  const g = gt || {};
  const changed = new Set((g.changed_files || []).map((p) => String(p).replace(/^\.\//, "")));
  const slice = new Set((g.slice_files || g.changed_files || []).map((p) => String(p).replace(/^\.\//, "")));
  return { goal: g.goal ?? null, concern_kind: g.concern_kind ?? null, changed_files: changed, slice_files: slice };
}

/**
 * Compute the four readings for ONE run.
 * @param {object} runRecord  the value `runActiveInvestigation` returns (usage + evidence + steps + envelope)
 * @param {object|null} holdoutGroundTruth  `{goal, concern_kind, changed_files[], slice_files[]}` — present
 *   ONLY for a replay whose answer is already known. Absent ⇒ the three judgement readings are NOT EVALUATED.
 */
export function computeRunMetrics(runRecord, holdoutGroundTruth = null) {
  const cost = evidenceCost(runRecord);
  if (!holdoutGroundTruth) {
    return { evidenceCost: cost, falsePositiveRate: ne(), locality: ne(), recoveryRounds: ne() };
  }
  const gt = normalizeGroundTruth(holdoutGroundTruth);
  const proposed = subjectFilesOf(runRecord);
  const touched = touchedFilesOf(runRecord);

  // falsePositiveRate: did the ONE terminal proposal name a file the goal's accepted slice actually moved?
  // A run that proposed nothing cannot be a false positive (there is nothing to be wrong about).
  let fpr;
  if (!proposed.length) fpr = evaluated(0, { proposals: 0, reason: "no proposal was produced by this run" });
  else {
    const hit = intersection(proposed, gt.slice_files).length > 0;
    fpr = evaluated(hit ? 0 : 1, { proposals: 1, proposed_files: proposed, matched_slice_files: intersection(proposed, gt.slice_files) });
  }

  // locality: of everything the run laid hands on, how much of it sits inside the goal's real change set.
  const inGoal = intersection(touched, gt.changed_files);
  const locality = evaluated(touched.length ? inGoal.length / touched.length : 0, { touched: touched.length, in_goal: inGoal.length });

  // recoveryRounds: the first round at which anything the run touched intersected the goal's real change set.
  let recoveredAt = null;
  const seen = new Set();
  const byRound = [...(runRecord?.steps || [])].sort((a, b) => a.round - b.round);
  for (const s of byRound) {
    for (const p of roundPaths(s)) seen.add(p);
    if (!recoveredAt && [...seen].some((p) => gt.changed_files.has(p))) recoveredAt = s.round;
  }
  const rounds = runRecord?.usage?.rounds ?? byRound.length;
  if (recoveredAt === null && proposed.some((p) => gt.changed_files.has(p))) recoveredAt = rounds;
  const recoveryRounds = { state: "evaluated", rounds: recoveredAt ?? rounds, recovered: recoveredAt !== null };

  return { evidenceCost: cost, falsePositiveRate: fpr, locality, recoveryRounds };
}

/** The FILE paths ONE step's request names (used only for the per-round recovery scan). */
function roundPaths(step) {
  const req = step?.request || {};
  return (req.kind === "read_file" && req.path ? [req.path] : []).map((p) => String(p).replace(/^\.\//, ""));
}

/** Aggregate per-run metrics over a corpus (the Holdout A/B comparison table). */
export function aggregateMetrics(runs) {
  const rows = runs.map((r) => r.metrics || r);
  const val = (x) => (x && x.state === "evaluated" ? x.value : null);
  const nums = rows.map((m) => val(m.falsePositiveRate)).filter((x) => typeof x === "number");
  const locs = rows.map((m) => val(m.locality)).filter((x) => typeof x === "number");
  const cost = rows.map((m) => m.evidenceCost).filter(Boolean);
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return {
    runs: rows.length,
    evidenceCost: {
      rounds: cost.reduce((s, c) => s + (c.rounds || 0), 0),
      requests: cost.reduce((s, c) => s + (c.requests || 0), 0),
      bytes: cost.reduce((s, c) => s + (c.bytes || 0), 0),
    },
    falsePositiveRate: { state: nums.length ? "evaluated" : "not-evaluated", value: mean(nums), evaluated_runs: nums.length, false_positives: nums.reduce((s, x) => s + x, 0) },
    locality: { state: locs.length ? "evaluated" : "not-evaluated", value: mean(locs), evaluated_runs: locs.length },
    recoveryRounds: {
      state: rows.some((m) => m.recoveryRounds?.state === "evaluated") ? "evaluated" : "not-evaluated",
      recovered: rows.filter((m) => m.recoveryRounds?.recovered).length,
      rounds: rows.map((m) => m.recoveryRounds?.rounds).filter((x) => typeof x === "number").reduce((s, x) => s + x, 0),
    },
  };
}
