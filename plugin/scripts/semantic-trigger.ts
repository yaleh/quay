// semantic-trigger.ts — the AC3 trigger functions for the semantic observer judge
// (semanticTriggerHeuristic / freeTextHash / evaluateTrigger), migrated OUT of inner-wakeup-heartbeat-
// check.ts (tasks/gap-retire-inner-hygiene-migrate-helper, 2026-09-01).
//
// WHY THIS FILE: the inner layer's tmux session is RETIRED (AC148/AC149), but these three PURE
// trigger functions were the LIVE consumer surface of inner-wakeup-heartbeat-check.ts — semantic-
// observer-judge.ts imports them to decide WHEN the semantic judge should run (not every round, for
// cost: fire when the free text changed, or when it carries the harness's OWN spawn-limit error
// string). They are the ①类 live helpers moved to a non-inner name so step2 can delete the ②类
// wakeup-heartbeat CLI face without breaking the judge. Two transitive deps — SPAWN_LIMIT_SIGNAL and
// spawnLimitDetected — are used ONLY by this cluster, so they moved too.
//
// Pure migration — behavior unchanged, only the home moved. The source task's AC1: consumer imports
// must point at THIS file, never back at inner-wakeup-heartbeat-check.ts.

import { createHash } from "node:crypto";

// ── AC3 trigger wiring (tasks/gap-semantic-observer-judge-stopped-awaiting) ────────────────────────
//
// The semantic judge must NOT run every round (cost). Trigger when the free text changed (hash) OR when
// the FREE TEXT carries the harness's OWN spawn-limit error string `Subagent spawn limit reached`
// (AC77 判据1, gap-ac77-spawn-limit-detect-harness-error-only — CLAUDE.md:21 detection method verbatim:
// "目标会话 transcript 里搜 `Subagent spawn limit reached`"). The old heuristic read a self-maintained
// agentDispatches/agentLimit count — RETIRED (AC77 判据2) → orchestration/archive/AC58-retired-clauses.md#R29.
// These three are the PURE trigger functions; the judge CLI imports them.

/** The harness's OWN subagent spawn-limit error string (CLAUDE.md:21 identification verbatim). The
 *  session's CUMULATIVE spawn budget (harness-managed, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`) is
 *  exhausted ⇒ harness silently degrades to main-thread serial. Detecting THIS string — not a
 *  self-maintained count — is the AC77 判据1 criterion (hard rule 4b: the judged party's own counter
 *  stops updating exactly when the failure it counts occurs, so it is indistinguishable from "normal"). */
export const SPAWN_LIMIT_SIGNAL = "Subagent spawn limit reached";

/** True when the free text (heartbeat reason + tick report transcript) carries the harness spawn-limit
 *  error string. PURE. Case-insensitive — the harness writes "Subagent spawn limit reached", a
 *  lowercase transcript grep should still match. */
export function spawnLimitDetected(freeText) {
  return String(freeText ?? "").toLowerCase().includes(SPAWN_LIMIT_SIGNAL.toLowerCase());
}

/** AC3 heuristic (AC77 判据1): fires when the free text carries the harness spawn-limit error string.
 *  PURE. Accepts the free-text string, or a heartbeat object (its `reason` is read) for call-site
 *  compatibility. The old count-based criterion is RETIRED (AC77 判据2) → R29 — a permanently-false
 *  criterion (heartbeat agentLimit came back undefined) is indistinguishable from "everything normal"
 *  (硬规则 4). 判据3 (只报不动): this is a REPORT trigger only — it never /clears, never lowers cap,
 *  never restarts; the post-trip action is the human's (人 2026-08-14 07:4xZ). */
export function semanticTriggerHeuristic(heartbeatOrText) {
  const text = typeof heartbeatOrText === "string"
    ? heartbeatOrText
    : (heartbeatOrText && typeof heartbeatOrText === "object" ? heartbeatOrText.reason : "") ?? "";
  return spawnLimitDetected(text);
}

/** Free-text content hash (sha256, first 16 hex). PURE. */
export function freeTextHash(freeText) {
  return createHash("sha256").update(String(freeText ?? "")).digest("hex").slice(0, 16);
}

/**
 * Evaluate the AC3 trigger. PURE.
 * @param {object|null} heartbeat parsed heartbeat (display-only since AC77 — the heuristic judges the
 *   free text, not a self-counted budget; kept for call-site compatibility)
 * @param {string} freeText combined free text (reason + tick report)
 * @param {string|null|undefined} prevHash previous free-text hash (null = no baseline ⇒ hashChanged=false)
 * @returns {{fired:boolean, heuristic:boolean, hashChanged:boolean, hash:string}}
 */
export function evaluateTrigger(heartbeat, freeText, prevHash) {
  const hash = freeTextHash(freeText);
  const heuristic = semanticTriggerHeuristic(freeText);
  const hashChanged = prevHash != null && hash !== prevHash;
  return { fired: heuristic || hashChanged, heuristic, hashChanged, hash };
}
