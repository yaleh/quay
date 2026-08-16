#!/usr/bin/env node
// ac66-a22-agent-id-check.ts — AC66 判据2 A22 样板: tick-log A22 读数行必须带 agent 标识.
// (tasks/gap-ac66-ac-driven-behavior-change-verifiable)
//
// AC66 (AC/任务驱动的行为变更必须可检查确认): an AC/task-driven behavior change must answer
// "is it in effect?" INDEPENDENTLY of "the text changed". The A22 template (orchestrator-tick-core.md
// A22: "每 tick 起后台 subagent 跑 ready-pool-check --apply … 不在主线程跑") — the artifact is the
// tick-log READING LINE carrying the AGENT ID of the subagent that ran ready-pool-check. A reading
// line WITHOUT an agent id means the ready-pool-check ran on the MAIN thread (or the outer cannot
// show it did not) — that is exactly the pre-fix absence sample: the 10 `--apply` invocations that
// were all main-thread Bash (Agent=0) while the core's text said "subagent".
//
// 判据:
//   判据2 — the LATEST A22 reading line in the outer tick-log must carry an agent identifier
//           (`agentId …` / a parenthesized ≥8-hex id adjacent to agent/subagent). A line that reports
//           the ready-pool reading (pool/floor/deficit/promotions, or the 心跳/读数/晋 action) without
//           an agent id ⇒ RED. FORWARD-ONLY (AC66 判据1: 前向不追溯): only the LATEST reading line is
//           judged — historical pre-fix lines are never retroactively red (judge the CURRENT state of
//           the behavior, not its history).
//   判据3 — real-sample replay (D2, 不构造): the REAL pre-fix reading lines (embedded verbatim in
//           plugin/test/ac66-a22-agent-id-check.test.mjs) must each replay RED; the real COMPLIANT
//           lines must replay GREEN.
//           NOT-EVALUATED when the log has no A22 reading line (cannot judge — 硬规则 3b).
//
// A line is an "A22 reading line" when "A22" appears as a TOPIC token (line start / after a bullet
// marker / after whitespace — NOT mid-CJK-word like "已跑A22") AND the line carries a ready-pool
// result token (心跳/读数/晋/无晋/pool/floor/deficit/promotions/POOL). The five-inequality evidence
// bullets ("②pool<floor→晋级补池 … 已跑A22 promotions=[] …") mention A22 as an aside, not as a topic,
// so they are excluded — they are B13 evidence, not A22 reading lines.
//
// Exit codes: 0 = PASS (or NOT-EVALUATED — read `evaluated`), 1 = RED (latest A22 reading line lacks
//             an agent id), 2 = usage/environment error.
//
// Run:
//   node --experimental-strip-types ac66-a22-agent-id-check.ts [--root <dir>] [--log <file>]
//       [--line <text>] [--json] [--help]
//
//   --root <dir>   repo root (default: cwd). Default tick-log path resolves under its orchestration/.
//   --log <file>   the outer tick-log to judge (default <root>/orchestration/tick-log.md)
//   --line <text>  judge a single line / small log body directly (test surface — real-sample replay)
//   --json         machine-readable output { evaluated, ok, checks:[...], reason }
//   --help         this help

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Constants ─────────────────────────────────────────────────────────────────────────────────────────

/** "A22" as a TOPIC token: at line start, after a bullet marker (`-`/`*`/`>`), or after whitespace.
 *  Excludes mid-CJK-word mentions (`已跑A22`, `A22` inside a run-on sentence). `\b` after A22 keeps
 *  the match at the literal "A22" (the boundary between a digit and a space/CJK is a JS \b). */
export const A22_TOPIC_RE = /(?:^|[\s>*-])\**A22\b/;
/** A ready-pool RESULT token — TIGHTENED (gap-ac66-a22-checker-loose-pattern): a line is a genuine
 *  A22 READING only when A22 is followed (within 40 chars) by a READING VERB (读数/心跳已跑/心跳/晋/无晋),
 *  AND the line is neither (a) the outer's A-SECTION reading (`**A 读数**：A1…A22 补晋…`, which reports
 *  the A22 row in the general A1-A23 enumeration WITHOUT the subagent's id — it is the summary, not the
 *  subagent reading) nor (b) a status note discussing the mechanism (`A22 第 N 次同形…` / `A22_READING_RE…` /
 *  `A22 违规修复…`). The previous pattern matched "any line with A22 + any of 心跳/读数/晋/pool/promotions…",
 *  so outer status notes (which necessarily mention A22 + mechanism words) and the A-section summaries
 *  became the "latest A22 reading line" without an agent id and red every full-suite fan-in
 *  (occurrence 3, structural). */
export const A22_READING_RE = /A22[^。；：\n]{0,60}(?:读数|心跳已跑|心跳|晋|无晋)/;
/** The outer's A-SECTION reading marker (`**A 读数**：A1 mounted…`) — the general A1-A23 enumeration,
 *  NOT the A22-specific subagent reading. Its A22 row ("A22 补晋"/"A22 无 promotion") carries no agent
 *  id and must not count as the A22 reading line (the subagent-specific `A22 读数（subagent…）` line does). */
export const A22_SECTION_MARKER_RE = /\*\*A 读数\*\*：/;
/** Status-note markers that mention A22 while DISCUSSING the mechanism (not reporting a reading):
 *  the recurring `A22 第 N 次同形…` fix notes, the checker's own name `A22_READING_RE`, and `A22 违规修复…`. */
export const A22_DISCUSSION_RE = /A22\s*(?:第\s*\d+\s*次同形|违规修复|_READING_RE)/;
/** An agent identifier: `agentId …` (with an 8+ hex/uuid value) OR a parenthesized 8+ hex id within
 *  24 chars of "agent"/"subagent". The 24-char proximity is what excludes a trailing COMMIT SHA
 *  (e.g. `A22 后台 subagent 心跳：… 晋 AC73 todo→ready（416cd1d2 已提交）` — the commit SHA sits
 *  ~48 chars after "subagent", too far to be the subagent's id). */
export const AGENT_ID_RE =
  /agentId\s*[=: ]\s*[0-9a-fA-F][0-9a-fA-F-]{7,}|(?:agent|subagent)[^（()\n]{0,24}[（(]\s*[0-9a-fA-F][0-9a-fA-F-]{7,}/;

// ── Pure: line classification ────────────────────────────────────────────────────────────────────────

/** Is `line` an A22 READING line — A22 as a topic token AND a ready-pool result token, excluding
 *  the A-section summary and status notes? PURE. */
export function isA22ReadingLine(line) {
  const t = String(line ?? "");
  if (!A22_TOPIC_RE.test(t)) return false;
  // A-section summaries and mechanism-discussion status notes are NOT A22 reading lines.
  if (A22_SECTION_MARKER_RE.test(t)) return false;
  if (A22_DISCUSSION_RE.test(t)) return false;
  return A22_READING_RE.test(t);
}

/** Does `line` carry an agent identifier (agentId=… / a parenthesized id near agent/subagent)? PURE. */
export function hasAgentId(line) {
  return AGENT_ID_RE.test(String(line ?? ""));
}

/** Extract every A22 reading line from a tick-log body (one line per entry). PURE. */
export function extractA22ReadingLines(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(isA22ReadingLine);
}

// ── Pure: 判据2 (latest A22 reading line must carry an agent id) ─────────────────────────────────────

/**
 * Judge the LATEST A22 reading line (the current state of the A22 behavior — forward-only, AC66 判据1).
 * RED when it lacks an agent id; GREEN when it carries one; NOT-EVALUATED when no A22 reading line
 * exists (cannot judge — 硬规则 3b, never conflated with green).
 * @param {string[]} lines — A22 reading lines, in log order (the LAST is the latest)
 * @returns {{ok:boolean, evaluated:boolean, reason:string, violations:string[]}}
 */
export function judgeLatestA22Line(lines) {
  const list = (lines ?? []).filter(Boolean);
  if (list.length === 0) {
    return { ok: true, evaluated: false, reason: "no-a22-reading-line (NOT-EVALUATED)", violations: [] };
  }
  const violations = list.filter((l) => !hasAgentId(l));
  const last = list[list.length - 1];
  if (violations.length === list.length) {
    // EVERY reading line lacks an agent id — the behavior has never been (or is no longer) in effect.
    return {
      ok: false,
      evaluated: true,
      reason: "all-a22-reading-lines-lack-agent-id",
      violations,
    };
  }
  if (!hasAgentId(last)) {
    return {
      ok: false,
      evaluated: true,
      reason: "latest-a22-reading-lacks-agent-id",
      violations: [last],
    };
  }
  return { ok: true, evaluated: true, reason: "latest-a22-reading-carries-agent-id", violations: [] };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `ac66-a22-agent-id-check.ts — AC66 判据2 A22 样板: tick-log A22 读数行必须带 agent 标识
  The latest A22 reading line in the outer tick-log must carry the agent id of the subagent that ran
  ready-pool-check — a line without one ⇒ RED (real-sample replay, AC66 判据3).
  (tasks/gap-ac66-ac-driven-behavior-change-verifiable)

Usage:
  node --experimental-strip-types ac66-a22-agent-id-check.ts [--root <dir>] [--log <file>]
      [--line <text>] [--json] [--help]

  --root <dir>   repo root (default: cwd). Default tick-log path resolves under its orchestration/.
  --log <file>   the outer tick-log to judge (default <root>/orchestration/tick-log.md)
  --line <text>  judge a single line / small log body directly (test surface — real-sample replay)
  --json         machine-readable output { evaluated, ok, checks:[...], reason }
  --help         this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — the latest A22 reading line lacks an agent id (the A22 behavior is not in effect)
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const logFile = getArgValue(args, "--log");
  const line = getArgValue(args, "--line");
  const asJson = args.includes("--json");

  let lines;
  let source;
  if (line != null) {
    lines = extractA22ReadingLines(line);
    source = "<line>";
  } else {
    const resolvedLog = logFile != null ? path.resolve(logFile) : path.join(root, "orchestration", "tick-log.md");
    if (!fs.existsSync(resolvedLog)) {
      const out = {
        ok: true,
        evaluated: false,
        reason: "no-tick-log (NOT-EVALUATED)",
        checks: [{ check: "a22-latest-reading-agent-id", ok: true, evaluated: false, reason: "no-tick-log (NOT-EVALUATED)", source: resolvedLog }],
      };
      if (asJson) console.log(JSON.stringify(out, null, 2));
      else console.log(`ac66-a22-agent-id-check: NOT-EVALUATED — no tick-log at ${resolvedLog}`);
      return 0;
    }
    lines = extractA22ReadingLines(fs.readFileSync(resolvedLog, "utf8"));
    source = resolvedLog;
  }

  const v = judgeLatestA22Line(lines);
  const out = {
    ok: v.ok,
    evaluated: v.evaluated,
    reason: v.reason,
    a22ReadingLineCount: lines.length,
    checks: [{ check: "a22-latest-reading-agent-id", ok: v.ok, evaluated: v.evaluated, reason: v.reason, violations: v.violations, source }],
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`ac66-a22-agent-id-check: ${v.ok ? "OK" : "FAIL"} — ${v.reason} (${lines.length} A22 reading line(s), ${v.violations.length} without agent id)`);
    for (const c of out.checks) {
      const tag = c.evaluated ? (c.ok ? "OK" : "RED") : "NOT-EVALUATED";
      console.log(`  ${tag} ${c.check} — ${c.reason}`);
    }
  }
  return v.ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "ac66-a22-agent-id-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
