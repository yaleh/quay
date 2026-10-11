#!/usr/bin/env node
// ARCHITECTURE DECISION MEMORY — "this exact item was already judged; do not judge it again".
//
// The live shadow run re-proposed canonicalising `packages/quay-github/src/github-client.ts` status
// literals — an item an earlier goal had EXPLICITLY exempted (docs/analysis/ownership-active-replay.md §3).
// Nothing in the loop remembered that. This module is that memory: a small, source-cited seed list plus a
// pure matcher the loop consults BEFORE it turns a terminal into a proposal.
//
// ⛔ STRUCTURAL SANDBOX: no filing machinery import, no task/goal/AC, no write surface — this module only
// CLASSIFIES. The only sink in this capability is the evidence store's jsonl (a different module).
//
// 硬规则 2 (按位置/结构判定, not by keyword): a candidate matches an entry iff
//     (a) the entry's `concern_kinds` contains the candidate's `concern_kind`, AND
//     (b) one of the entry's registered FILE PATHS is, byte-for-byte, one of the candidate's extracted
//         file locations,
//  — i.e. both sides must be a real repo path in the same position, not a word that happens to occur in
//  some prose. A phrase like "we should converge status literals" matches nothing; naming that exact file does.
//
// 硬规则 3 (枚举,不布尔): `isKnownExemption` returns a STATUS ENUM (`exempted` / `known-not-yet-filed` /
// `not-known`) plus the entry that matched — never a bare boolean, so "no entry matched" can never be
// confused with "the matcher could not read its input".

/** Two hits are NOT the same thing and must never collapse into one value:
 *   exempted            — a decision was taken and recorded: this item is deliberately NOT to be changed.
 *   known-not-yet-filed — a real, recorded defect that no one has filed a task for yet. It may still be
 *                         proposed, but it must be flagged as "already known" rather than rediscovered. */
export const DECISION_STATUS = Object.freeze(["exempted", "known-not-yet-filed", "not-known"]);

/**
 * The seed corpus. Every entry carries its SOURCE (a task/goal id + a quotable one-line reason) — an entry
 * with no source is not a memory, it is an opinion.
 */
export const SEED_DECISIONS = Object.freeze([
  Object.freeze({
    id: "dm-001-github-client-status-literals",
    type: "exempted",
    concern_kinds: Object.freeze(["canonicalization"]),
    files: Object.freeze(["packages/quay-github/src/github-client.ts"]),
    reason: "The `status: *` tag literals in this file are explicitly exempted: an independent provider package may not statically import `packages/quay/src/abi.ts`, and the literal shapes are pinned by needle tests (QN-072/073). The illegality is already handled fail-closed by checkGate's `gate:\"unknown\"` fallback, which reports `unrecognized status <value>`.",
    source: "tasks/gap-abi-status-lifecycle-vocab-scattered-no-named-type.md (AC2 exemption record) + goals/GOAL-031-needs-human-状态词汇-canonicalization-试点-goal-driver-ts-5-处裸字面量收.md (why_not_others). Re-proposed by the shadow loop: docs/analysis/ownership-active-replay.md §3.",
  }),
  Object.freeze({
    id: "dm-002-flipgoal-disposeold-statuslog",
    type: "known-not-yet-filed",
    concern_kinds: Object.freeze(["other-boundary"]),
    files: Object.freeze(["packages/quay/src/goal-store.ts"]),
    symbols: Object.freeze(["flipGoal", "disposeOld"]),
    reason: "Real, recorded DEFECT with no task filed: goal-store.ts's `flipGoal` path for `disposeOld.to === \"achieved\"` never appends a statusLog entry, while the same semantic transition through `write()`'s `statusChanged` path always does — one 'dispose after achieved' action, two different audit guarantees. Filed for the human's ruling, deliberately not bundled with the (purely additive) transition-table work.",
    source: "goals/GOAL-036-workerpool-在飞排除集合-inflight-retryexhausted-收敛到单一纯函数计算点-同一轮内两次.md §相关但本轮不落地 (③Goal transition contract).",
  }),
  Object.freeze({
    id: "dm-003-status-vocab-false-positives",
    type: "exempted",
    concern_kinds: Object.freeze(["canonicalization"]),
    files: Object.freeze([
      "packages/quay/src/observation.ts",
      "plugin/scripts/workflow-baseline-metrics.ts",
      "plugin/scripts/workflow-replay.ts",
    ]),
    reason: "Recorded as a false positive of the `needs-human` literal-dispersion reading: these files use a DIFFERENT status vocabulary, so converging them onto the task-status source would be wrong. Explicitly excluded from the slice ('异词表假阳性,不该变').",
    source: "goals/GOAL-031-needs-human-状态词汇-canonicalization-试点-goal-driver-ts-5-处裸字面量收.md (why_not_others: 不碰 observation.ts / workflow-baseline-metrics.ts / workflow-replay.ts).",
  }),
]);

/** Normalise a repo-relative path for comparison; a non-path returns null (never a near-match). */
export function normalizeDecisionPath(p) {
  if (typeof p !== "string") return null;
  const s = p.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  return s && /^[A-Za-z0-9._@/-]+$/.test(s) ? s : null;
}

/**
 * The file locations a candidate proposal actually names. STRUCTURAL only: it reads the candidate's
 * declared file locations (an explicit `files` list, a `scope.in_scope` entry, a slice move) and extracts
 * complete repo-path tokens out of the proposal's own subject strings with `extractPathTokens`. Free prose
 * that merely talks about a concept contributes nothing.
 */
export function candidateFiles(candidate) {
  const out = new Set();
  const addNorm = (p) => { const n = normalizeDecisionPath(p); if (n) out.add(n); };
  const addText = (t) => { if (typeof t === "string") for (const p of extractPathTokens(t)) addNorm(p); };
  if (Array.isArray(candidate?.files)) candidate.files.forEach(addNorm);
  for (const f of candidate?.scope?.in_scope || []) addText(f);
  for (const c of candidate?.candidate_interventions || []) addText(c?.title);
  for (const mv of candidate?.slice?.moves || []) addText(typeof mv === "string" ? mv : mv?.file);
  addText(candidate?.concern);
  addText(candidate?.declared_measurement);
  return [...out].sort();
}

// Same structural token shape as the evidence store's extractor (duplicated on purpose: this module must
// not import the store, or the two capabilities would form a cycle the moment the store wants to consult
// the memory back).
const PATH_TOKEN_RE = /(?:^|[\s`"'(\[{])((?:packages|plugin|scripts|docs|tasks|goals|experiments)\/[A-Za-z0-9._@/-]+\.[A-Za-z0-9]+)/g;
export function extractPathTokens(text) {
  const out = [];
  for (const m of String(text || "").matchAll(PATH_TOKEN_RE)) out.push(m[1].replace(/^\.\//, ""));
  return out;
}

/** Every entry whose (concern_kind, file) both match. Enumerable — callers can report HOW MANY and WHICH. */
export function matchingEntries(candidate, seed = SEED_DECISIONS) {
  const kind = candidate?.concern_kind;
  const files = new Set(candidateFiles(candidate));
  return seed.filter((e) => {
    if (kind !== undefined && kind !== null && !e.concern_kinds.includes(kind)) return false;
    return e.files.some((f) => files.has(normalizeDecisionPath(f)));
  });
}

/**
 * The decision-memory verdict for one candidate proposal.
 * @returns {{status:"exempted"|"known-not-yet-filed"|"not-known", matched_entry:object|null, matched_files:string[], candidates_considered:number}}
 *   `status` is an ENUM with its own "nothing matched" value; there is no boolean collapse.
 */
export function isKnownExemption(candidate, seed = SEED_DECISIONS) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    // 硬规则 3b: unreadable input must NOT be shaped like "nothing matched" — it is its own state.
    return { status: "not-known", matched_entry: null, matched_files: [], candidates_considered: 0, unreadable_input: true };
  }
  const hits = matchingEntries(candidate, seed);
  if (!hits.length) return { status: "not-known", matched_entry: null, matched_files: [], candidates_considered: 0, unreadable_input: false };
  // `exempted` dominates `known-not-yet-filed`: a hard "do not change this" must not be softened by a
  // weaker "somebody noticed a defect here".
  hits.sort((a, b) => (a.type === "exempted" ? 0 : 1) - (b.type === "exempted" ? 0 : 1));
  const files = new Set(candidateFiles(candidate));
  return {
    status: hits[0].type,
    matched_entry: hits[0],
    matched_files: hits[0].files.filter((f) => files.has(normalizeDecisionPath(f))),
    candidates_considered: hits.length,
    unreadable_input: false,
  };
}

/** The decision-memory candidate for a terminal proposal step (what the loop feeds in). */
export function candidateFromProposal(proposal) {
  return {
    concern_kind: proposal?.concern_kind,
    concern: proposal?.concern,
    declared_measurement: proposal?.declared_measurement,
    scope: proposal?.scope,
    candidate_interventions: proposal?.candidate_interventions,
    slice: proposal?.slice,
  };
}
