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
//   判据5 — 09:1xZ 推广: EVERY C24 in-flight derivation (AC76 判据5 list C24-1..7) has an explicit
//           landing — a `RETIRED (AC76 C24-N …)` annotation on a plugin/scripts code file (C24-1/2/3,
//           AC48 判据2 做法), an explicit 已并入 disposition into an already-mechanized mechanism
//           (C24-4→判据6, C24-5→C24-1 标注, C24-7→C24-6), or an explicit 外层独占 C17 disposition
//           (C24-6). RED when an annotation file is missing its marker (judgeC24Retirement) OR when
//           the table is missing a landing for any C24 number (judgeC24Coverage) — 退役而不可查 =
//           记录上像退役、行为上没退役 (AC66 族).
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

// ── path→content 判定形状 (tasks/gap-b5-input-shape-path-to-content) ─────────────────────────────
// 判定逻辑 = 对【字符串/内容】的纯函数（judgeSlotRefillCanonical / judgeWorktreeVsSubagent /
// judgeReportLine / judgeC24Retirement / judgeC24Coverage / judgeLiveVsTaskStatus）,
// I/O（countActiveSubagentTranscripts / readTaskStatuses 读目录）留在薄 main() CLI 壳。
// 纯函数测试零 spawn 零 mkdtemp 直调（plugin/test/cap-counts-subagents-check.test.mjs）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~57 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { TASK_STATUS } from "./task-status.ts";

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

// ── 判据5 (09:1xZ 推广): EVERY C24 in-flight derivation has an explicit landing ────────────────────────
/** The complete C24 in-flight-derivation list (AC76 判据5 C24-1..6 + manager-phase-goal ⑦ C24-7).
 *  Every entry MUST have a landing — one of three dispositions:
 *    "annotation"   — a `RETIRED (AC76 C24-N …)` explicit annotation on the named plugin/scripts code
 *                     file (AC48 判据2 做法: annotate, don't delete). Mechanically enforced by
 *                     judgeC24Retirement (marker present in the file).
 *    "merged"       — explicitly 已并入 an already-mechanized mechanism; `mergedInto` names the
 *                     landing. No separate file annotation is required.
 *    "outer-owned"  — an orchestration/ item owned by another layer (C17 — the checker must not fail
 *                     on a file it cannot fix); `landing` names the owner's 落点. The disposition is
 *                     recorded so the item is NOT 退役而不可查.
 *  A retired C24 item with NO landing (missing from this table, or an empty disposition/mergedInto/
 *  landing) is RED via judgeC24Coverage — 退役而不可查 = 记录上像退役、行为上没退役 (AC66 族). */
export const C24_EXPECTED = [1, 2, 3, 4, 5, 6, 7];

export const C24_RETIREMENT = [
  // ── C24-1/2/3 — plugin/scripts code files: RETIRED annotation mechanically enforced ──────────────
  { key: "fast-mode-telemetry", n: 1, file: "plugin/scripts/fast-mode-telemetry.ts", marker: /RETIRED \(AC76 C24-1/, disposition: "annotation",
    landing: "plugin/scripts/fast-mode-telemetry.ts:1081 `RETIRED (AC76 C24-1 …)` 显式标注（在飞维度退役；A1a 事件 schema、--task-start/--task-end 派发留痕、throughput/blocked-wait/reconcile-cleanup 保留）" },
  { key: "slot-refill", n: 2, file: "plugin/scripts/slot-refill.ts", marker: /RETIRED \(AC76 C24-2/, disposition: "annotation",
    landing: "plugin/scripts/slot-refill.ts:27 RETIRED (AC76 C24-2) 显式标注（MEASURED IN-FLIGHT DEFAULT telemetry fallback 在飞读法退役；显式 --in-flight 路径不变）" },
  { key: "inner-wakeup-heartbeat-check", n: 3, file: "plugin/scripts/inner-wakeup-heartbeat-check.ts", marker: /RETIRED \(AC76 C24-3/, disposition: "annotation",
    landing: "plugin/scripts/inner-wakeup-heartbeat-check.ts:85 RETIRED (AC76 C24-3) 显式标注（heartbeat 在飞输入退役；AC53 end-invariant 判据不变）" },
  // ── C24-4/5 — 已并入 already-mechanized mechanisms (显式并入, 不适用独立文件标注) ────────────────
  { key: "live-observation", n: 4, disposition: "merged",
    mergedInto: "本检查器 判据6 judgeLiveVsTaskStatus（/live 把 done 误报在跑 ⇒ RED，2026-08-14 AC66/AC72/AC73 真样本）+ C24-1 对 /live producer（fast-mode-telemetry.ts）的在飞维度标注",
    landing: "本检查器 判据6（/live done-误报在跑 捕获）+ C24-1 producer 标注" },
  { key: "task-start-bracket", n: 5, disposition: "merged",
    mergedInto: "C24-1 fast-mode-telemetry.ts RETIRED (AC76 C24-1) 注释——A16/A16b --task-start 括号的【在飞】用途随 producer 在飞维度一并退役（--task-start/--task-end 派发留痕用途保留）",
    landing: "plugin/scripts/fast-mode-telemetry.ts:1088-1090 RETIRED (AC76 C24-1) 显式覆盖" },
  // ── C24-6 — 外层独占 orchestration item (checker 不机械强制 outer-owned 文件) ───────────────────
  { key: "manager-a3", n: 6, disposition: "outer-owned",
    landing: "orchestration/manager-tick-core.md A3（在飞一律读 inner 会话 subagents/agent-*.jsonl 近 N 分钟写入数；worktree 计数另标）——C17 外层独占，只给建议不落盘" },
  // ── C24-7 — 并入 C24-6 (cap 维度与在飞维度合并为同一个读法, manager-phase-goal ⑦) ─────────────
  { key: "cap-inflight-merge", n: 7, disposition: "merged",
    mergedInto: "C24-6 manager A3（orchestration/manager-phase-goal.md AC76 ⑦：cap 维度 ①② 与在飞维度 ③ 合并为同一个读法，落点随 C24-6 外层独占）",
    landing: "并入 C24-6（manager A3 外层落点）" },
];

/**
 * Judge 判据5 (annotation half) — every C24 `annotation`-disposition code file carries its
 * `RETIRED (AC76 C24-N …)` explicit annotation (AC48 判据2 做法: annotate, don't delete). PURE over
 * the resolved file texts. RED when an annotation entry's file exists but lacks the marker; GREEN when
 * all present annotation files carry it; NOT-EVALUATED when no annotation file is present. The merged/
 * outer-owned entries' landings are enforced by judgeC24Coverage, not here.
 * @param {Array<{key:string, file:string, text:string|null}>} files — [{key, file, text}] resolved
 *   by the caller (null text = file absent)
 * @returns {{ok:boolean, evaluated:boolean, reason:string, violations:string[]}}
 */
export function judgeC24Retirement(files) {
  const annotationCfgs = C24_RETIREMENT.filter((c) => c.disposition === "annotation");
  const list = (files ?? []).filter(Boolean);
  const present = list.filter((f) => f.text != null);
  if (present.length === 0) {
    return { ok: true, evaluated: false, reason: "no-c24-file (NOT-EVALUATED)", violations: [] };
  }
  const violations = [];
  for (const f of present) {
    const cfg = annotationCfgs.find((c) => c.key === f.key);
    if (cfg && !cfg.marker.test(String(f.text))) {
      violations.push(`${f.key}: missing RETIRED (AC76 ${cfg.marker.source.replace(/RETIRED \\\(AC76 /, "").replace(/\\/, "")} annotation in ${cfg.file}`);
    }
  }
  if (violations.length > 0) {
    return { ok: false, evaluated: true, reason: "c24-retirement-annotation-missing", violations };
  }
  return { ok: true, evaluated: true, reason: `c24-in-flight-derivations-retired (${present.length}/${annotationCfgs.length} annotated)`, violations: [] };
}

/**
 * Judge 判据5 (coverage half / 判据2 能取假) — EVERY C24 in-flight derivation (C24-1..7) has an
 * explicit landing: present in the table with a valid disposition ("annotation" with file+marker,
 * "merged" with mergedInto, "outer-owned" with landing). PURE over the table. RED when any expected
 * C24 number is missing or its landing is empty — 退役而不可查 = 记录上像退役、行为上没退役 (AC66 族).
 * 能取假: the PRE-FIX table (only C24-1/2/3, no 4/5/7) replays RED (缺落点); the fixed table GREEN.
 * @param {Array<{n:number, disposition:string, file?:string, marker?:RegExp, mergedInto?:string, landing?:string}>} table
 * @returns {{ok:boolean, evaluated:boolean, reason:string, missing:string[]}}
 */
export function judgeC24Coverage(table) {
  const list = (table ?? []).filter(Boolean);
  const byN = new Map(list.map((c) => [Number(c.n), c]));
  const missing = [];
  for (const n of C24_EXPECTED) {
    const entry = byN.get(n);
    if (!entry) {
      missing.push(`C24-${n}: no landing entry`);
      continue;
    }
    const d = entry.disposition;
    if (d === "annotation") {
      if (!entry.file || !entry.marker) missing.push(`C24-${n}: annotation disposition without file/marker`);
      if (!String(entry.landing ?? "").trim()) missing.push(`C24-${n}: annotation landing note empty`);
    } else if (d === "merged") {
      if (!String(entry.mergedInto ?? "").trim()) missing.push(`C24-${n}: merged disposition without mergedInto`);
      if (!String(entry.landing ?? "").trim()) missing.push(`C24-${n}: merged landing note empty`);
    } else if (d === "outer-owned") {
      if (!String(entry.landing ?? "").trim()) missing.push(`C24-${n}: outer-owned disposition without landing`);
    } else {
      missing.push(`C24-${n}: unknown disposition ${JSON.stringify(d)}`);
    }
  }
  if (missing.length > 0) {
    return { ok: false, evaluated: true, reason: `c24-landing-coverage-missing (${missing.length}): ${missing.join("; ")}`, missing };
  }
  return { ok: true, evaluated: true, reason: `c24-landing-coverage-complete (${C24_EXPECTED.length}/${C24_EXPECTED.length})`, missing: [] };
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
    return st == null || st === TASK_STATUS.DONE || st === TASK_STATUS.NEEDS_HUMAN;
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

const usage = `cap-counts-subagents-check.ts — AC76 in-flight = CONCURRENT SUBAGENTS checker
  (tasks/gap-ac76-cap-counts-subagents-not-worktrees, 人 2026-08-14 07:3xZ/09:1xZ 裁定)

判据1 (canonical)  slot-refill.ts names 被计量对象=并发 subagent + forbids worktree proxy
判据2 (3rd-party)  <session>/subagents/agent-*.jsonl written in the last N minutes = in-flight subagents
判据3 (replay)      worktree-count vs subagent-count mismatch ⇒ RED (07:2xZ wt=4/sub=2, 07:4xZ wt=1/sub=2)
判据4 (method)      a worktree count presented as the in-flight count WITHOUT a subagent label ⇒ RED
判据5 (09:1xZ)      EVERY C24 in-flight derivation (C24-1..7) has a landing: C24-1/2/3 RETIRED
                    (AC76 C24-N …) annotation enforced on the real files; C24-4/5/7 explicit 已并入
                    disposition; C24-6 外层独占 — a missing landing replays RED (judgeC24Coverage)
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
     retirement annotation / landing (判据5)
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const slotRefillFile = flagValue(args, "--slot-refill") ?? path.join(root, "plugin", "scripts", "slot-refill.ts");
  const fmTelemetryFile = flagValue(args, "--fast-mode-telemetry") ?? path.join(root, "plugin", "scripts", "fast-mode-telemetry.ts");
  const heartbeatFile = flagValue(args, "--heartbeat-check") ?? path.join(root, "plugin", "scripts", "inner-wakeup-heartbeat-check.ts");
  const sessionDir = flagValue(args, "--session-dir");
  const minutes = Number(flagValue(args, "--minutes") ?? 5);
  const worktreeCount = flagValue(args, "--worktree-count") != null ? Number(flagValue(args, "--worktree-count")) : null;
  const subagentCount = flagValue(args, "--subagent-count") != null ? Number(flagValue(args, "--subagent-count")) : null;
  const reportLine = flagValue(args, "--report-line");
  const liveRunning = (flagValue(args, "--live-running") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const taskStatusDir = flagValue(args, "--task-status-dir") ?? path.join(root, "tasks");
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
  push("judge5-c24-landing-coverage", judgeC24Coverage(C24_RETIREMENT));

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
