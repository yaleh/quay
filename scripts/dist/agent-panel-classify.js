import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/agent-panel-classify.ts
var STATE_VERBS = Object.freeze([
  "Committing",
  "Running",
  "Waiting",
  "Execute",
  "Checking",
  "Monitoring",
  "Verifying"
]);
var VERB_ALT = STATE_VERBS.join("|");
var AGENT_LINE_RE = new RegExp(`\\b(${VERB_ALT})\\b`);
var DURATION_TOKEN_RE = /[0-9]+\s*[hms]/g;
var DEFAULT_FROZEN_THRESHOLD_SECS = 30;
function parseTimerSec(text) {
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
function stripTimer(text) {
  return text.replace(DURATION_TOKEN_RE, "").replace(/\s+/g, " ").trim();
}
function extractAgentLines(paneText) {
  const out = [];
  for (const rawLine of paneText.split("\n")) {
    const m = rawLine.match(AGENT_LINE_RE);
    if (!m) continue;
    out.push({ raw: rawLine.trim(), verb: m[1], timerSec: parseTimerSec(rawLine) });
  }
  return out;
}
function matchTaskIds(raw, knownTaskIds) {
  const hits = [];
  for (const id of knownTaskIds ?? []) {
    const re = new RegExp(`(?<![A-Za-z0-9._-])${escapeRegExp(id)}(?![A-Za-z0-9._-])`);
    if (re.test(raw)) hits.push(id);
  }
  return hits.sort((a, b) => b.length - a.length);
}
function classifyLines(lines, report) {
  const inProgressIds = new Set((report?.inProgress ?? []).map((t) => t.taskId));
  const knownTaskIds = collectKnownTaskIds(report);
  return lines.map((l) => {
    const ids = matchTaskIds(l.raw, knownTaskIds);
    if (ids.length === 0) return { ...l, taskId: null, state: "unknown" };
    const taskId = ids[0];
    return { ...l, taskId, state: inProgressIds.has(taskId) ? "live" : "ended" };
  });
}
function collectKnownTaskIds(report) {
  const seen = /* @__PURE__ */ new Set();
  for (const key of ["inProgress", "tasks", "orphaned", "reconciled", "unreliable", "reconcilable"]) {
    for (const rec of report?.[key] ?? []) {
      if (rec?.taskId) seen.add(rec.taskId);
    }
  }
  return [...seen];
}
function detectFrozen(first, second) {
  const frozen = [];
  for (const a of first) {
    if (a.timerSec == null) continue;
    const b = second.find(
      (bl) => bl.verb === a.verb && bl.timerSec != null && (a.taskId ? bl.raw.includes(a.taskId) : stripTimer(bl.raw) === stripTimer(a.raw)) && bl.timerSec === a.timerSec
    );
    if (b) frozen.push(a);
  }
  return frozen;
}
function runStaleCheck(paneText, report, { afterPaneText = null } = {}) {
  const first = classifyLines(extractAgentLines(paneText), report);
  const ended = first.filter((l) => l.state === "ended");
  const live = first.filter((l) => l.state === "live");
  let frozen = [];
  if (afterPaneText) {
    frozen = detectFrozen(first, extractAgentLines(afterPaneText));
  }
  const staleSeen = /* @__PURE__ */ new Set();
  const stale = [];
  for (const l of [...ended, ...frozen]) {
    if (!staleSeen.has(l.raw)) {
      staleSeen.add(l.raw);
      stale.push(l);
    }
  }
  return { first, ended, frozen, live, stale, verdict: stale.length > 0 ? "STALE" : "CLEAN" };
}
export {
  DEFAULT_FROZEN_THRESHOLD_SECS,
  STATE_VERBS,
  classifyLines,
  collectKnownTaskIds,
  detectFrozen,
  escapeRegExp as escapeRe,
  extractAgentLines,
  matchTaskIds,
  parseTimerSec,
  runStaleCheck,
  stripTimer
};
