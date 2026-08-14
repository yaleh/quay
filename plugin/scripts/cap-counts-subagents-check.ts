#!/usr/bin/env node
// cap-counts-subagents-check.ts — AC76 in-flight = CONCURRENT SUBAGENTS checker (判据1-判据4 +
// 09:1xZ 推广判据 + /live 误报真样本回放).
// (tasks/gap-ac76-cap-counts-subagents-not-worktrees, 人 2026-08-14 07:3xZ/09:1xZ 裁定)
//
// THE DEFECT: cap=5's measured object is CONCURRENT SUBAGENTS (「cap=5 就是为了保护 subagent——
// inner 不能并发无限多 subagent」), yet a full day of in-flight readings used `git worktree list |
// grep -c` — a proxy that is wrong in BOTH directions (07:2xZ worktree 4 · subagent 2 ⇒ 高估 2;
// 07:4xZ worktree 1 · subagent 2 ⇒ 低估 1). 09:1xZ generalized the ruling: 在飞不应当靠任务记录/遥测
// 括号,而应当查 inner 任务 subagent; 任务状态只走 tasks/*.md status.
//
// This checker makes the criteria mechanical:
//   判据1 — the canonical source (slot-refill.ts:15-16) names 被计量对象 = 并发 subagent AND
//           explicitly forbids worktree proxy. RED when either marker is missing (a comment that
//           merely discusses subagents is NOT a hit — position: the canonical comment block).
//   判据2 — the third-party read: count <session>/subagents/agent-*.jsonl files WRITTEN within the
//           last N minutes (AC67 判据2 已证可用 — agentId = subagent transcript). This is the DIRECT
//           in-flight read: it does not depend on the session's own maintained set, its heartbeat,
//           telemetry brackets, or worktrees.
//   判据3 — 能取假, 真样本 D2: worktree-count vs subagent-count mismatch must replay RED. The two
//           real samples (07:2xZ wt=4/sub=2, 07:4xZ wt=1/sub=2) each replay RED — the judge must
//           catch the proxy error (判据3 真样本回放红).
//   判据4 — report-with-method: a report line presenting a worktree count AS THE in-flight count
//           without a subagent label ⇒ RED (报数带计法: 在飞 subagent=M; worktree 另标).
//   判据5 — 09:1xZ 推广: the C24 in-flight derivations (C24-1 fast-mode-telemetry.ts realInFlight/
//           reconcile 家族, C24-2 slot-refill.ts in_flight_count 入参, C24-3 inner-wakeup-heartbeat-
//           check.ts 在飞输入) carry the `RETIRED (AC76 C24-N …)` explicit annotation (AC48 判据2
//           做法, 不删除). RED when a C24 file is missing the annotation.
//   判据6 — 能取假, /live 真样本: a live claim that a DONE task is running must replay RED — the
//           2026-08-14 09:1xZ 实测 (AC66/AC72/AC73 three done tasks misreported as running by
//           telemetry; done 与 ready 在遥测里不可区分). judgeLiveVsTaskStatus is the pure judge.
//
// Each sub-check runs when its inputs are present; the aggregate verdict is RED if ANY sub-check is
// RED. `evaluated` is true iff at least one sub-check produced a hard verdict (per sub-check the
// NOT-EVALUATED state is reported distinctly, never folded into green — 硬规则 3b).
//
// Exit codes: 0 = PASS (or NOT-EVALUATED — read `evaluated`), 1 = RED, 2 = usage/environment error.
//
// Run:
//   node --experimental-strip-types cap-counts-subagents-check.ts
//       [--root <repo>] [--slot-refill <file>] [--fast-mode-telemetry <file>]
//       [--heartbeat-check <file>]
//       [--session-dir <dir>] [--minutes <N>] [--worktree-count <N>] [--subagent-count <N>]
//       [--report-line <text>] [--live-running <id1,id2>] [--task-status-dir <dir>]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

// ── 判据1 markers (position: the slot-refill.ts canonical comment block) ──────────────────────────────
/** The canonical comment names the measured object: 被计量对象 = 并发 subagent (the task's exact
 *  wording) OR the English "THE MEASURED OBJECT … CONCURRENT SUBAGENTS" / "CURRENTLY-RUNNING subagent
 *  set" form. A bare mention of "subagent" elsewhere is NOT a hit (硬规则 2 — position-aware). */
export const MEASURED_OBJECT_RE = /被计量对象\s*[=＝]\s*并发\s*subagent|THE MEASURED OBJECT[^]*?CONCURRENT SUBAGENTS|被计量对象[^]*?subagent/i;
/** The canonical comment explicitly forbids the worktree proxy: 禁 worktree 代理 / "FORBIDDEN proxy"
 *  with worktree / "WORKTREE COUNT IS NOT THE MEASURED OBJECT". */
export const FORBID_WORKTREE_RE = /禁 worktree 代理|WORKTREE COUNT IS NOT THE MEASURED OBJECT|worktree[^]*?FORBIDDEN proxy/i;

/**
 * Judge 判据1 — the canonical slot-refill.ts comment names the measured object (并发 subagent) AND
 * forbids the worktree proxy. PURE. RED when either marker is missing; GREEN when both present;
 * NOT-EVALUATED when the source is absent/empty (cannot judge — never conflated with green).
 * @param {string|null|undefined} slotRefillSource — the slot-refill.ts file text
 * @returns {{ok:boolean, evaluated:boolean, reason:string, namesMeasured:boolean, forbidsWorktree:boolean}}
 */
export function judgeSlotRefillCanonical(slotRefillSource) {
  if (slotRefillSource == null || String(slotRefillSource).trim() === "") {
    return { ok: true, evaluated: false, reason: "no-slot-refill-source (NOT-EVALUATED)", namesMeasured: false, forbidsWorktree: false };
  }
  const text = String(slotRefillSource);
  const namesMeasured = MEASURED_OBJECT_RE.test(text);
  const forbidsWorktree = FORBID_WORKTREE_RE.test(text);
  if (!namesMeasured || !forbidsWorktree) {
    return {
      ok: false, evaluated: true,
      reason: `canonical-missing (namesMeasured=${namesMeasured}, forbidsWorktree=${forbidsWorktree})`,
      namesMeasured, forbidsWorktree,
    };
  }
  return { ok: true, evaluated: true, reason: "canonical-names-subagents-and-forbids-worktree-proxy", namesMeasured, forbidsWorktree };
}

// ── 判据2 (third-party read): <session>/subagents/agent-*.jsonl written in the last N minutes ─────────
/** Agent-transcript basename pattern: `agent-<id>.jsonl`. (The `.meta.json` sidecars are excluded —
 *  they are written by the harness around the transcript, not subagent turns.) */
export const AGENT_TRANSCRIPT_RE = /^agent-.+\.jsonl$/;

/**
 * Count the active inner-task subagent transcripts under a Claude Code session directory — the
 * 判据2 third-party read. A subagent is "in flight" when its transcript file was WRITTEN within the
 * last `minutes` minutes (AC67 判据2 已证可用 — agentId = subagent transcript). This does NOT depend
 * on the session's own maintained set, its heartbeat, telemetry brackets, or worktrees — it is the
 * DIRECT in-flight read (09:1xZ 推广).
 * @param {string} sessionDir — the Claude Code session directory (<session>, e.g. ~/.claude/projects/<proj>/<id>/)
 * @param {number} [minutes] — recency window (default 5)
 * @returns {{count:number, files:string[], dirPresent:boolean, minutes:number}}
 */
export function countActiveSubagentTranscripts(sessionDir, minutes = 5) {
  const subDir = path.join(String(sessionDir), "subagents");
  if (!fs.existsSync(subDir)) {
    return { count: 0, files: [], dirPresent: false, minutes };
  }
  const cutoff = Date.now() - minutes * 60_000;
  const files = fs.readdirSync(subDir)
    .filter((f) => AGENT_TRANSCRIPT_RE.test(f))
    .filter((f) => {
      try { return fs.statSync(path.join(subDir, f)).mtimeMs >= cutoff; }
      catch { return false; }
    })
    .sort();
  return { count: files.length, files, dirPresent: true, minutes };
}

// ── 判据3 (能取假, 真样本 D2): worktree count vs subagent count ──────────────────────────────────────
/**
 * Judge one (worktreeCount, subagentCount) pair. PURE. RED when they DIFFER — a worktree-proxy
 * reading would be wrong in that direction; GREEN when they agree (no mismatch this sample);
 * NOT-EVALUATED when either count is absent (cannot judge).
 * The two REAL samples must replay RED: 07:2xZ (worktree=4, subagent=2 ⇒ 高估 2) and 07:4xZ
 * (worktree=1, subagent=2 ⇒ 低估 1).
 * @param {number|null|undefined} worktreeCount
 * @param {number|null|undefined} subagentCount
 * @returns {{ok:boolean, evaluated:boolean, reason:string, worktreeCount:number|null, subagentCount:number|null}}
 */
export function judgeWorktreeVsSubagent(worktreeCount, subagentCount) {
  if (worktreeCount == null || subagentCount == null) {
    return { ok: true, evaluated: false, reason: "missing-count (NOT-EVALUATED)", worktreeCount: worktreeCount ?? null, subagentCount: subagentCount ?? null };
  }
  const wt = Number(worktreeCount);
  const sa = Number(subagentCount);
  if (wt !== sa) {
    return {
      ok: false, evaluated: true,
      reason: `worktree-proxy-mismatch (worktree=${wt} ≠ subagents=${sa})`,
      worktreeCount: wt, subagentCount: sa,
    };
  }
  return { ok: true, evaluated: true, reason: `worktree-equals-subagents (both ${wt})`, worktreeCount: wt, subagentCount: sa };
}

// ── 判据4 (报数带计法): report-with-method line judge ────────────────────────────────────────────────
/** A report line that presents an in-flight count via worktree WITHOUT a subagent label is the
 *  unlabeled-proxy form: `在飞=worktree 4` / `in_flight=4 (worktree)` / `slots 4 worktree` with no
 *  subagent label anywhere in the same line. */
export const WORKTREE_AS_INFLIGHT_RE = /(?:在飞|in[._-]?flight|slots?)\s*[=:＝:]?\s*(?:worktree|wt)\s*\d|worktree\s*\d+[^]*?(?:在飞|in[._-]?flight)/i;

/**
 * Judge ONE report line for the 判据4 discipline: 报数带计法 — when a count is reported as THE
 * in-flight count, it must carry the subagent method label; a worktree count (if given) must be
 * labeled as ANOTHER quantity. PURE.
 *   RED     the line presents a worktree count as the in-flight count WITHOUT a subagent label
 *   GREEN   the line carries a subagent method label (在飞 subagent=M / in_flight_subagents) — a
 *           line that ALSO gives a worktree count is fine because both are labeled
 *   NOT-EVALUATED  the line has no in-flight count report (no subagent label AND not a worktree-
 *           presented-as-in-flight form) — cannot judge
 * The two REAL samples (07:2xZ / 07:4xZ) carry BOTH labels, so they are GREEN here (the problem was
 * which number got USED — 判据3's job — not how it was labeled).
 * @param {string|null|undefined} line
 * @returns {{ok:boolean, evaluated:boolean, reason:string, hasSubagentLabel:boolean, hasWorktree:boolean}}
 */
export function judgeReportLine(line) {
  if (line == null || String(line).trim() === "") {
    return { ok: true, evaluated: false, reason: "no-report-line (NOT-EVALUATED)", hasSubagentLabel: false, hasWorktree: false };
  }
  const text = String(line);
  const hasSubagentLabel = /subagent|在飞 subagent|in_flight_subagents|in[._-]?flight[^]*?subagent/i.test(text);
  const hasWorktree = /worktree|wt\b/i.test(text);
  if (hasWorktree && !hasSubagentLabel && WORKTREE_AS_INFLIGHT_RE.test(text)) {
    return { ok: false, evaluated: true, reason: "worktree-presented-as-in-flight-without-subagent-label", hasSubagentLabel, hasWorktree };
  }
  if (hasSubagentLabel) {
    return { ok: true, evaluated: true, reason: "report-carries-subagent-method-label", hasSubagentLabel, hasWorktree };
  }
  return { ok: true, evaluated: false, reason: "no-in-flight-count-report (NOT-EVALUATED)", hasSubagentLabel, hasWorktree };
}

// ── 判据5 (09:1xZ 推广): C24 in-flight derivations retired to explicit annotation ─────────────────────
/** The C24 in-flight-derivation code files and their required `RETIRED (AC76 C24-N …)` annotation
 *  markers. Only the plugin/scripts code files are mechanically enforced here; the orchestration
 *  items (C24-6 manager A3, orchestrator A18 / fast-mode A12) are C17 OUTER-owned — the task body
 *  Evidence carries the suggestions, not this checker (a checker must not fail on an outer-owned file
 *  it cannot fix). */
export const C24_RETIREMENT = [
  { key: "fast-mode-telemetry", file: "plugin/scripts/fast-mode-telemetry.ts", marker: /RETIRED \(AC76 C24-1/ },
  { key: "slot-refill", file: "plugin/scripts/slot-refill.ts", marker: /RETIRED \(AC76 C24-2/ },
  { key: "inner-wakeup-heartbeat-check", file: "plugin/scripts/inner-wakeup-heartbeat-check.ts", marker: /RETIRED \(AC76 C24-3/ },
];

/**
 * Judge 判据5 — every C24 code file carries its `RETIRED (AC76 C24-N …)` explicit annotation (AC48
 * 判据2 做法: annotate, don't delete). PURE over the resolved file texts. RED when a C24 file exists
 * but lacks the annotation; GREEN when all present files carry it; NOT-EVALUATED when no C24 file is
 * present.
 * @param {Array<{key:string, file:string, text:string|null}>} files — [{key, file, text}] resolved
 *   by the caller (null text = file absent)
 * @returns {{ok:boolean, evaluated:boolean, reason:string, violations:string[]}}
 */
export function judgeC24Retirement(files) {
  const list = (files ?? []).filter(Boolean);
  const present = list.filter((f) => f.text != null);
  if (present.length === 0) {
    return { ok: true, evaluated: false, reason: "no-c24-file (NOT-EVALUATED)", violations: [] };
  }
  const violations = [];
  for (const f of present) {
    const cfg = C24_RETIREMENT.find((c) => c.key === f.key);
    if (cfg && !cfg.marker.test(String(f.text))) {
      violations.push(`${f.key}: missing RETIRED (AC76 ${cfg.marker.source.replace(/RETIRED \\\(AC76 /, "").replace(/\\/, "")} annotation in ${f.file}`);
    }
  }
  if (violations.length > 0) {
    return { ok: false, evaluated: true, reason: "c24-retirement-annotation-missing", violations };
  }
  return { ok: true, evaluated: true, reason: `c24-in-flight-derivations-retired (${present.length}/${C24_RETIREMENT.length} annotated)`, violations: [] };
}

// ── 判据6 (能取假, /live 真样本): a done task claimed running must replay RED ──────────────────────────
/** The 2026-08-14 09:1xZ real sample: telemetry /live claimed AC66/AC72/AC73 running while all three
 *  were done (done 与 ready 在遥测里不可区分). These are the fixture ids the test replays. */
export const LIVE_MISREPORT_FIXTURE = [
  "gap-ac66-ac-driven-behavior-change-verifiable",
  "gap-ac72-cert-mechanism-retire",
  "gap-ac73-catalog-rhythm-consumer-check",
];

/**
 * Judge 判据6 — a live/telemetry claim that a task is running must be consistent with the task
 * store's status. PURE. RED when any claimed-running task has taskStatus done (or needs-human, or is
 * absent — a task that is not even in the store cannot be running); GREEN when every claimed-running
 * task has a live status (todo/ready); NOT-EVALUATED when no live claims are given.
 * @param {string[]} liveRunningIds — task ids a live/observation surface claims are running
 * @param {Record<string,string>} taskStatusById — the task store's status per id (from tasks/*.md)
 * @returns {{ok:boolean, evaluated:boolean, reason:string, misreported:string[]}}
 */
export function judgeLiveVsTaskStatus(liveRunningIds, taskStatusById) {
  const ids = (liveRunningIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (ids.length === 0) {
    return { ok: true, evaluated: false, reason: "no-live-running-claims (NOT-EVALUATED)", misreported: [] };
  }
  const statuses = taskStatusById ?? {};
  const misreported = ids.filter((id) => {
    const st = statuses[id];
    return st == null || st === "done" || st === "needs-human";
  });
  if (misreported.length > 0) {
    return { ok: false, evaluated: true, reason: `live-misreports-done-as-running (${misreported.join(",")})`, misreported };
  }
  return { ok: true, evaluated: true, reason: `live-claims-match-non-done-statuses (${ids.length})`, misreported: [] };
}

/** Read the task store's status per id from `<root>/tasks/*.md` frontmatter. Pure fs read. */
export function readTaskStatuses(tasksDir) {
  const out = {};
  if (!tasksDir || !fs.existsSync(tasksDir)) return out;
  for (const f of fs.readdirSync(tasksDir)) {
    if (!f.endsWith(".md")) continue;
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const m = raw.match(/^status:\s*(\S+)/m);
    out[id] = m ? m[1] : null;
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `cap-counts-subagents-check.ts — AC76 in-flight = CONCURRENT SUBAGENTS checker
  (tasks/gap-ac76-cap-counts-subagents-not-worktrees, 人 2026-08-14 07:3xZ/09:1xZ 裁定)

判据1 (canonical)  slot-refill.ts names 被计量对象=并发 subagent + forbids worktree proxy
判据2 (3rd-party)  <session>/subagents/agent-*.jsonl written in the last N minutes = in-flight subagents
判据3 (replay)      worktree-count vs subagent-count mismatch ⇒ RED (07:2xZ wt=4/sub=2, 07:4xZ wt=1/sub=2)
判据4 (method)      a worktree count presented as the in-flight count WITHOUT a subagent label ⇒ RED
判据5 (09:1xZ)      C24-1/2/3 in-flight derivations carry the RETIRED (AC76 C24-N …) annotation
判据6 (replay)      a live claim that a DONE task is running ⇒ RED (AC66/AC72/AC73 fixture)

Usage:
  node --experimental-strip-types cap-counts-subagents-check.ts
      [--root <repo>] [--slot-refill <file>] [--fast-mode-telemetry <file>]
      [--heartbeat-check <file>]
      [--session-dir <dir>] [--minutes <N>] [--worktree-count <N>] [--subagent-count <N>]
      [--report-line <text>] [--live-running <id1,id2>] [--task-status-dir <dir>]
      [--json] [--help]

  --root <repo>             repo root (default: cwd). Resolves the default slot-refill /
                            fast-mode-telemetry / heartbeat-check / task-status-dir paths.
  --slot-refill <file>      判据1: the slot-refill.ts source to judge (default <root>/plugin/scripts/slot-refill.ts)
  --fast-mode-telemetry <file>  判据5: C24-1 file (default <root>/plugin/scripts/fast-mode-telemetry.ts)
  --heartbeat-check <file>  判据5: C24-3 file (default <root>/plugin/scripts/inner-wakeup-heartbeat-check.ts)
  --session-dir <dir>       判据2: Claude Code session directory; counts agent-*.jsonl written in
                            the last --minutes minutes.
  --minutes <N>             判据2 recency window in minutes (default 5).
  --worktree-count <N>      判据3: worktree count (real sample replay: pass 4 or 1).
  --subagent-count <N>      判据3: subagent count (real sample replay: pass 2).
  --report-line <text>      判据4: judge a single report line (报数带计法).
  --live-running <csv>      判据6: task ids a live/observation surface claims are running; judged
                            against <root>/tasks/*.md statuses (or --task-status-dir).
  --task-status-dir <dir>   判据6: alternate tasks dir for statuses (default <root>/tasks).
  --json                    machine-readable output { ok, evaluated, checks, reason }
  --help                    this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a worktree/telemetry-bracket in-flight proxy form (判据1/3/4/6) or a missing C24
     retirement annotation (判据5)
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const slotRefillFile = getArgValue(args, "--slot-refill") ?? path.join(root, "plugin", "scripts", "slot-refill.ts");
  const fmTelemetryFile = getArgValue(args, "--fast-mode-telemetry") ?? path.join(root, "plugin", "scripts", "fast-mode-telemetry.ts");
  const heartbeatFile = getArgValue(args, "--heartbeat-check") ?? path.join(root, "plugin", "scripts", "inner-wakeup-heartbeat-check.ts");
  const sessionDir = getArgValue(args, "--session-dir");
  const minutes = Number(getArgValue(args, "--minutes") ?? 5);
  const worktreeCount = getArgValue(args, "--worktree-count") != null ? Number(getArgValue(args, "--worktree-count")) : null;
  const subagentCount = getArgValue(args, "--subagent-count") != null ? Number(getArgValue(args, "--subagent-count")) : null;
  const reportLine = getArgValue(args, "--report-line");
  const liveRunning = (getArgValue(args, "--live-running") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const taskStatusDir = getArgValue(args, "--task-status-dir") ?? path.join(root, "tasks");
  const asJson = args.includes("--json");

  const checks = [];
  let anyEvaluated = false;
  let anyRed = false;
  const push = (check, verdict) => {
    if (verdict.evaluated) {
      anyEvaluated = true;
      if (!verdict.ok) anyRed = true;
    }
    checks.push({ check, ...verdict });
  };

  // ── 判据1 — canonical slot-refill.ts comment ──────────────────────────────────────────────────────
  let slotRefillSource = null;
  if (fs.existsSync(slotRefillFile)) slotRefillSource = fs.readFileSync(slotRefillFile, "utf8");
  push("judge1-slot-refill-canonical", judgeSlotRefillCanonical(slotRefillSource));

  // ── 判据2 — third-party subagent-transcript read ──────────────────────────────────────────────────
  if (sessionDir != null) {
    const v2 = countActiveSubagentTranscripts(sessionDir, minutes);
    push("judge2-active-subagent-transcripts", {
      ok: v2.dirPresent,
      evaluated: v2.dirPresent,
      reason: v2.dirPresent
        ? `in-flight-subagents=${v2.count} (${v2.files.length ? v2.files.join(",") : "none"} written in last ${v2.minutes} min)`
        : "no-subagents-dir (NOT-EVALUATED)",
      count: v2.count, minutes: v2.minutes, dirPresent: v2.dirPresent,
    });
  }

  // ── 判据3 — worktree vs subagent mismatch (real-sample replay) ────────────────────────────────────
  if (worktreeCount != null || subagentCount != null) {
    push("judge3-worktree-vs-subagent", judgeWorktreeVsSubagent(worktreeCount, subagentCount));
  }

  // ── 判据4 — report-with-method line judge ────────────────────────────────────────────────────────
  if (reportLine != null) {
    push("judge4-report-with-method", judgeReportLine(reportLine));
  }

  // ── 判据5 — C24 in-flight derivations retired (09:1xZ 推广) ───────────────────────────────────────
  const c24Files = [
    { key: "fast-mode-telemetry", file: fmTelemetryFile, text: fs.existsSync(fmTelemetryFile) ? fs.readFileSync(fmTelemetryFile, "utf8") : null },
    { key: "slot-refill", file: slotRefillFile, text: slotRefillSource },
    { key: "inner-wakeup-heartbeat-check", file: heartbeatFile, text: fs.existsSync(heartbeatFile) ? fs.readFileSync(heartbeatFile, "utf8") : null },
  ];
  push("judge5-c24-retirement", judgeC24Retirement(c24Files));

  // ── 判据6 — /live done-misreported-as-running replay ─────────────────────────────────────────────
  if (liveRunning.length > 0) {
    const statuses = readTaskStatuses(taskStatusDir);
    push("judge6-live-vs-task-status", judgeLiveVsTaskStatus(liveRunning, statuses));
  }

  const ok = !anyRed;
  const out = {
    ok,
    evaluated: anyEvaluated,
    reason: ok ? (anyEvaluated ? "cap-counts-subagents-pass" : "nothing-to-judge (NOT-EVALUATED)") : "worktree-or-telemetry-in-flight-proxy (in-flight must be read from inner task subagents)",
    checks,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`cap-counts-subagents-check: ${ok ? "OK" : "FAIL"} — ${out.reason}`);
    for (const c of out.checks) {
      console.log(`  [${c.check}] ${c.ok ? "ok" : "RED"}${c.evaluated ? "" : " (NOT-EVALUATED)"} — ${c.reason}`);
    }
  }
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "cap-counts-subagents-check")) {
  process.exitCode = main(process.argv);
}
