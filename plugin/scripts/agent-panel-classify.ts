// agent-panel-classify.ts — 面板行分类纯函数（迁自 inner-panel-stale-check.ts，step2 删②类会话卫生面）
// (tasks/gap-retire-inner-hygiene-delete-session-face, 2026-09-01)
//
// inner-panel-stale-check.ts 的 CLI 壳（`--pane`/`--target`/`--after`/tmux capture 读盘 + main）是
// ②类会话卫生面（喂 inner 自己 pane），零活代码消费者，已随 step2 删除。本文件保留其 1-191 行纯函数
// （无副作用，可 hermetic 测试），行为不变——迁移测试 `agent-panel-classify.test.mjs` 钉住。
//
// 原职责（已删的 CLI 壳所表达的面板观测机制，状态转换表达）：
//   1. bracket cross-reference: 一个 task id 不在遥测 inProgress（括号已关）但仍残留在面板上的行
//      ⇒ ENDED——标出，使其不再与 live 行视觉不可区分。
//   2. frozen-timer: 相隔 N 秒两次采样，计时未推进的行 ⇒ FROZEN——脚本做两次采样，无需人跨时间采样猜。
//
// Pure functions only — no side effects, no I/O. The ONE import is the kernel's pure
// `escapeRegExp` leaf (reached via the plugin shim `./regex-escape.ts`), so the module stays
// side-effect-free: its own copy of that body was one of the twelve byte-identical bodies extracted
// by gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.
import { escapeRegExp as escapeRe } from "./regex-escape.ts";

/** The panel's agent state verbs (the Contract measure's grep surface). */
export const STATE_VERBS = Object.freeze([
  "Committing", "Running", "Waiting", "Execute", "Checking", "Monitoring", "Verifying",
]);

const VERB_ALT = STATE_VERBS.join("|");
const AGENT_LINE_RE = new RegExp(`\\b(${VERB_ALT})\\b`);

/** Duration token scan — any `N[hms]` run in the line (handles "3h 5m 32s", "1h46m21s", "26m51s"). */
const DURATION_TOKEN_RE = /[0-9]+\s*[hms]/g;

/** Default frozen-timer threshold: a line whose timer did not advance across two samples. */
export const DEFAULT_FROZEN_THRESHOLD_SECS = 30;

// ── Pure parsing ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Parse a line's elapsed-timer into seconds. Returns null when the line carries no `N[hms]` token.
 * PURE.
 */
export function parseTimerSec(text) {
  const tokens = text.match(DURATION_TOKEN_RE);
  if (!tokens || tokens.length === 0) return null;
  let total = 0;
  for (const tok of tokens) {
    const n = parseInt(tok, 10);
    if (/h/.test(tok)) total += n * 3600;
    else if (/m/.test(tok)) total += n * 60;
    else if (/s/.test(tok)) total += n;
  }
  return total;
}

/** Strip `N[hms]` tokens from a line (line identity without the moving timer). PURE. */
export function stripTimer(text) {
  return text.replace(DURATION_TOKEN_RE, "").replace(/\s+/g, " ").trim();
}

/**
 * Extract agent lines from a pane text: lines that contain one of STATE_VERBS, annotated with the
 * line's timer in seconds. PURE.
 * @param {string} paneText
 * @returns {Array<{raw:string, verb:string, timerSec:number|null}>}
 */
export function extractAgentLines(paneText) {
  const out = [];
  for (const rawLine of paneText.split("\n")) {
    const m = rawLine.match(AGENT_LINE_RE);
    if (!m) continue;
    out.push({ raw: rawLine.trim(), verb: m[1], timerSec: parseTimerSec(rawLine) });
  }
  return out;
}

/** Escape a string for use in a RegExp literal. PURE. Re-exported from the kernel leaf so this
 *  module's public surface is unchanged. */
export { escapeRe };

/**
 * Match a line against a set of known task ids using a strict token boundary (the id is bounded by
 * non-[A-Za-z0-9._-] on both sides, so `gap` cannot match inside `gap-something`). Returns the
 * matching ids, longest first. PURE.
 */
export function matchTaskIds(raw, knownTaskIds) {
  const hits = [];
  for (const id of knownTaskIds ?? []) {
    const re = new RegExp(`(?<![A-Za-z0-9._-])${escapeRe(id)}(?![A-Za-z0-9._-])`);
    if (re.test(raw)) hits.push(id);
  }
  return hits.sort((a, b) => b.length - a.length);
}

/**
 * Classify agent lines against a telemetry report:
 *   state "live"   — task id resolves AND is in inProgress (bracket open).
 *   state "ended"  — task id resolves but is NOT in inProgress (bracket closed) yet the line is
 *                    still present — the defect shape, marked (AC1).
 *   state "unknown" — no known task id resolves (cannot bracket cross-ref; frozen detection still
 *                    applies).
 * PURE.
 * @param {Array<{raw:string, verb:string, timerSec:number|null}>} lines
 * @param {{inProgress: Array<{taskId:string}>, tasks?: Array<{taskId:string}>,
 *          orphaned?: Array<{taskId:string}>, reconciled?: Array<{taskId:string}>,
 *          unreliable?: Array<{taskId:string}>, reconcilable?: Array<{taskId:string}>}} report
 * @returns {Array<{raw:string, verb:string, timerSec:number|null, taskId:string|null, state:"live"|"ended"|"unknown"}>}
 */
export function classifyLines(lines, report) {
  const inProgressIds = new Set((report?.inProgress ?? []).map((t) => t.taskId));
  const knownTaskIds = collectKnownTaskIds(report);
  return lines.map((l) => {
    const ids = matchTaskIds(l.raw, knownTaskIds);
    if (ids.length === 0) return { ...l, taskId: null, state: "unknown" };
    const taskId = ids[0];
    return { ...l, taskId, state: inProgressIds.has(taskId) ? "live" : "ended" };
  });
}

/** Collect the union of task ids the report knows about (any lifecycle section). PURE. */
export function collectKnownTaskIds(report) {
  const seen = new Set();
  for (const key of ["inProgress", "tasks", "orphaned", "reconciled", "unreliable", "reconcilable"]) {
    for (const rec of report?.[key] ?? []) {
      if (rec?.taskId) seen.add(rec.taskId);
    }
  }
  return [...seen];
}

/**
 * Frozen-timer detection across two pane samples. A line in the FIRST sample is FROZEN when the
 * same line (same verb + same task id, or same timer-stripped text when no task id) is present in
 * the SECOND sample and its timer did not advance (`timerSec` unchanged). PURE.
 * @param {Array<{raw:string, verb:string, timerSec:number|null, taskId?:string|null}>} first
 * @param {Array<{raw:string, verb:string, timerSec:number|null}>} second
 * @returns {Array<{raw:string, verb:string, timerSec:number|null, taskId?:string|null}>}
 */
export function detectFrozen(first, second) {
  const frozen = [];
  for (const a of first) {
    if (a.timerSec == null) continue;
    const b = second.find(
      (bl) =>
        bl.verb === a.verb &&
        bl.timerSec != null &&
        (a.taskId ? bl.raw.includes(a.taskId) : stripTimer(bl.raw) === stripTimer(a.raw)) &&
        bl.timerSec === a.timerSec,
    );
    if (b) frozen.push(a);
  }
  return frozen;
}

/**
 * The full observer verdict over one or two pane samples + a telemetry report.
 *   ended  — bracket-closed lines still present (AC1/AC3 signal).
 *   frozen — timer-not-advancing lines (AC2 signal).
 *   stale  — ended ∪ frozen (deduped by raw line).
 *   live   — bracket-open lines (the honest "still running" set).
 * PURE.
 */
export function runStaleCheck(paneText, report, { afterPaneText = null } = {}) {
  const first = classifyLines(extractAgentLines(paneText), report);
  const ended = first.filter((l) => l.state === "ended");
  const live = first.filter((l) => l.state === "live");
  let frozen = [];
  if (afterPaneText) {
    frozen = detectFrozen(first, extractAgentLines(afterPaneText));
  }
  const staleSeen = new Set();
  const stale = [];
  for (const l of [...ended, ...frozen]) {
    if (!staleSeen.has(l.raw)) { staleSeen.add(l.raw); stale.push(l); }
  }
  return { first, ended, frozen, live, stale, verdict: stale.length > 0 ? "STALE" : "CLEAN" };
}
