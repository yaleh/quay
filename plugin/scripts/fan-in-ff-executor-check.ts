#!/usr/bin/env node
// fan-in-ff-executor-check.ts — AC67 fan-in EXECUTOR checker + AC75 delta 断言面判定 (判据1-判据7 能取假).
// (tasks/gap-ac67-fan-in-executor-to-task-subagent, tasks/gap-ac75-fan-in-merge-not-rebase-delta-check,
//  SPEC-fan-in-ff-merge-lock-2026-08-14)
//
// AC62 landed the ff-only PROTOCOL (无锁段 + 持锁段 + merge lock) but NOT the executor position —
// the inner MAIN THREAD still ran every step of the fan-in (`fast-mode-tick-core.md` A6 subject was
// "Fan-in 已返回任务" and the 无锁段 reached into the worktree with `git -C <wt>`). AC67 moves the
// executor INTO the task subagent — the COMPLETE fan-in is FOUR items, all inside the subagent's own
// turn (人 2026-08-14 追加裁定): ① git merge develop ② 全量 suite ③ doc 检查 ④ flip done → ff-only
// merge; the subagent returns AFTER ff succeeds. This checker makes the 判据 mechanical:
//
//   判据1 — the A6 line's SUBJECT and FORM. The old subject "Fan-in 已返回任务" (the main thread
//           waits for the task to return, THEN fan-ins) and the `git -C <wt>` form (the main thread
//           reaching into a worktree from OUTSIDE) are the main-thread-executor signatures ⇒ RED.
//           The new subject (fan-in 回到任务 subagent) with NO `git -C <wt>` form ⇒ GREEN.
//           A missing/unparseable A6 line ⇒ NOT-EVALUATED (硬规则 3b: 无法评估 ≠ 合格).
//   判据2 — the fan-in RECORD's caller agent identity. fan-in-ff-merge.sh (AC62's script) now writes
//           an `agentId` field into BOTH its lock events and its retry record. 判据 = 该标识 ≠
//           inner 主会话: a record whose agentId is MISSING/null (the script called WITHOUT
//           --agent-id = the old main-thread caller) or EQUALS the main-session id ⇒ RED. An absent
//           record file is a VACUOUS pass (nothing to validate — same as AC62's retry-record).
//   判据3 — real-sample replay (D2, 不构造). The CURRENT A6 line and a real main-thread fan-in
//           command (both captured from the live repo/session, the "近 6 小时 4 次 merge" samples)
//           must each replay RED through 判据1/判据2's judges. The test fixture embeds those REAL
//           samples verbatim; this checker's pure judges are what they exercise.
//   判据4 — EXECUTOR TRANSCRIPT LOCATION (人 2026-08-14 追加裁定, reads the ACTUAL command lines).
//           The inner MAIN session <session-id>.jsonl must NO LONGER contain (a) a test.sh call
//           WITHOUT --for-task (the full suite), (b) a tasks/*.md status-flip commit, or (c) a merge
//           into develop — these three must appear ONLY in <session-id>/subagents/agent-*.jsonl.
//           RED when the main session carries any; GREEN when only the subagent transcripts carry
//           them; NOT-EVALUATED when neither side has any classified fan-in command.
//
// Each sub-check runs when its inputs are present; the aggregate verdict is RED if ANY sub-check is
// RED. `evaluated` is true iff at least one sub-check produced a hard verdict (per sub-check the
// NOT-EVALUATED state is reported distinctly, never folded into green).
//
// Exit codes: 0 = PASS (or NOT-EVALUATED — read `evaluated`), 1 = RED (a main-thread-executor form),
//             2 = usage/environment error.
//
// Run:
//   node --experimental-strip-types fan-in-ff-executor-check.ts
//       [--a6-file <fast-mode-tick-core.md>] [--a6-line <text>]
//       [--lock-events <file>] [--retry-record <file>] [--main-agent-id <id>]
//       [--command <text>] [--main-session <jsonl>] [--subagent-transcripts <a.jsonl,b.jsonl>]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveAssertionSurface } from "./precommit-guard.ts";

// ── Constants ─────────────────────────────────────────────────────────────────────────────────────────

/** The OLD A6 subject — the main thread waits for the task to return, THEN does the fan-in. The
 *  executor is the inner main session, not a task subagent. (Position: the A6 row's subject cell.) */
export const OLD_A6_SUBJECT_RE = /Fan-in 已返回任务/;
/** The main thread reaching INTO a task worktree from outside: a `git -C <wt> <subcommand>` COMMAND
 *  form. Position-aware (硬规则 2): only the COMMAND form (a subcommand follows the `<wt>` placeholder)
 *  is the old executor signature — a bare mention like "`git -C <wt>` 形态消失" (explaining the form
 *  is GONE, backtick directly after `<wt>`) must NOT flag. After AC67 the subagent is IN its own
 *  worktree (cwd = worktree) and just runs `git merge` — no `-C <wt>`. */
export const GIT_CT_WT_RE = /git\s+-C\s*<wt>\s+\S/;
/** A main-thread fan-in command: `git merge --no-ff task/<id>` (the pre-ff-only fan-in signature)
 *  OR `git -C <worktree> … merge` (operating on a non-current worktree from outside). */
export const MAIN_THREAD_MERGE_CMD_RE = /git\s+merge\s+--no-ff\s+task\//;
export const GIT_CT_MERGE_CMD_RE = /git\s+-C\s*\S+\s+.*\bmerge\b/;

/** A record whose agentId is the main-session marker (or missing) is the old main-thread form. The
 *  subagent sets its OWN agent id — a NON-null id different from the main session. */
export function isMainThreadAgentId(agentId, mainAgentId) {
  if (agentId == null || agentId === "") return true;      // script called without --agent-id
  if (mainAgentId != null && String(agentId) === String(mainAgentId)) return true;
  return false;
}

// ── Ruled-historical one-off 豁免 (tasks/gap-fan-in-ff-executor-check-ruled-historical-99f845d9) ──────
//
// manager 2026-08-23 裁定：99f845d9 的应急主线程 fan-in（outer 主会话为解红#4 直接落地
// gap-direct-to-develop-ruled-historical-99f845d9，fan-in-ff-merge.sh 未传 --agent-id）是 ruled one-off——
// 形态 = ruled 豁免 + 定案理由（先例 direct-to-develop-bypass-check.ts 的 RULED_HISTORICAL_COMMITS）。
//   · 入表 taskId 的 lock-events / retry-record 分类为 `ruledHistorical`（可见 + 可审计，非静默掩盖）
//     ——独立分类，非 main-thread-executor（两者在 checker 输出里可区分：reason 分别为
//     `ruled-historical-record` 与 `main-thread-executor-record`）。
//   · 豁免表【有界】：只覆盖这里列出的 ruled 任务；任一未入表任务的缺失/主会话 agentId 记录仍红
//     （能取假——豁免不能被静默扩展）。
export const RULED_HISTORICAL_TASKS: { taskId: string; reason: string }[] = [
  {
    taskId: "gap-direct-to-develop-ruled-historical-99f845d9",
    reason:
      "manager 授权的应急 fan-in——outer 主会话直接落地红#4 的止损动作，非常规主线程绕过 subagent；" +
      "该形态本轮后不应再发生（正确路径是让 worker-driver 正常派发 subagent fan-in）。" +
      "manager 2026-08-23 裁定 ruled one-off（先例 direct-to-develop-bypass-check.ts 的 RULED_HISTORICAL_COMMITS 99f845d9）。",
  },
];

/** 一条记录的 taskId 是否命中 ruled 豁免表（精确匹配——fan-in 记录的 taskId 是完整任务 id）。PURE。 */
export function findRuledHistoricalTaskEntry(taskId, table = RULED_HISTORICAL_TASKS) {
  if (!taskId) return undefined;
  return (table ?? []).find((e) => e && String(taskId) === e.taskId);
}

// ── Pure: 判据1 (A6 subject + form) ───────────────────────────────────────────────────────────────────

/**
 * Judge ONE A6 table row (the `| A6 | … | … |` line). PURE — the caller extracts the line from the
 * file (or a test injects it). RED when the old subject OR the `git -C <wt>` form is present (the
 * main-thread-executor signatures); GREEN when neither; NOT-EVALUATED when the line is missing or
 * not an A6 row (cannot judge — never conflated with green, 硬规则 3b).
 * @param {string|null|undefined} a6Line
 * @returns {{ok:boolean, evaluated:boolean, reason:string, oldSubject:boolean, gitCT:boolean}}
 */
export function judgeA6Line(a6Line) {
  if (a6Line == null || String(a6Line).trim() === "") {
    return { ok: true, evaluated: false, reason: "no-a6-line (NOT-EVALUATED)", oldSubject: false, gitCT: false };
  }
  const text = String(a6Line);
  const oldSubject = OLD_A6_SUBJECT_RE.test(text);
  const gitCT = GIT_CT_WT_RE.test(text);
  if (oldSubject || gitCT) {
    const why = [oldSubject ? "old-subject-Fan-in-已返回任务" : null, gitCT ? "git-C-wt-form" : null]
      .filter(Boolean).join("+");
    return { ok: false, evaluated: true, reason: `main-thread-executor-a6 (${why})`, oldSubject, gitCT };
  }
  return { ok: true, evaluated: true, reason: "subagent-executor-a6", oldSubject: false, gitCT: false };
}

/** Extract the A6 row from a fast-mode-tick-core.md file (a line whose first cell is `| A6 |`).
 *  Returns null when the file is missing or has no such row. @param {string} file */
export function extractA6Line(file) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (/^\| A6 \|/.test(line)) return line;
  }
  return null;
}

// ── Pure: 判据2 (agent identity in the fan-in records) ─────────────────────────────────────────────────

/**
 * Judge the caller agent identity in a set of fan-in records (lock events AND/OR retry records).
 * PURE — the caller resolves the records. A record is the OLD main-thread form when its agentId is
 * missing/null (the script called without --agent-id) OR equals the main-session id.
 * ⚠️ Ruled-historical 豁免：taskId 命中 `RULED_HISTORICAL_TASKS`（manager 裁定的应急主线程 fan-in
 * one-off）⇒ 该记录分类为 ruledHistorical（reason `ruled-historical-record`），非 main-thread-executor
 * ——两类在输出里可区分；豁免表有界，未入表任务仍红（能取假）。
 * @param {Array<Record<string, any>>} records — lock-event / retry-record lines
 * @param {string|null} mainAgentId — the inner MAIN session's agent id (null = only presence is judged)
 * @returns {{ok:boolean, evaluated:boolean, reason:string, violations:string[], ruledHistorical:string[]}}
 */
export function checkAgentId(records, mainAgentId) {
  const list = (records ?? []).filter(Boolean);
  if (list.length === 0) {
    return { ok: true, evaluated: false, reason: "no-fan-in-records (NOT-EVALUATED)", violations: [], ruledHistorical: [] };
  }
  const violations = [];
  const ruledHistorical = [];
  list.forEach((r, i) => {
    const id = r.agentId;
    const taskId = r.taskId ?? "?";
    if (isMainThreadAgentId(id, mainAgentId)) {
      const ruledEntry = findRuledHistoricalTaskEntry(r.taskId);
      if (ruledEntry) {
        ruledHistorical.push(`[${i}] ${taskId}: ruled one-off — ${ruledEntry.reason}`);
      } else {
        const shown = id == null || id === "" ? "missing/null" : `== main (${id})`;
        violations.push(`[${i}] ${taskId}: agentId ${shown} — the main-thread (or absent) executor form`);
      }
    }
  });
  if (violations.length > 0) {
    return { ok: false, evaluated: true, reason: "main-thread-executor-record", violations, ruledHistorical };
  }
  if (ruledHistorical.length > 0) {
    return { ok: true, evaluated: true, reason: "ruled-historical-record", violations: [], ruledHistorical };
  }
  return { ok: true, evaluated: true, reason: "subagent-executor-record", violations: [], ruledHistorical: [] };
}

// ── Pure: 判据3 (real main-thread fan-in command replay) ──────────────────────────────────────────────

/**
 * Judge ONE fan-in command string (a Bash line from a session transcript or the A6 body). PURE.
 * RED when it is a main-thread fan-in signature: `git merge --no-ff task/<id>` (the pre-ff-only
 * fan-in) OR `git -C <somewhere> … merge` (operating on a non-current worktree from outside). These
 * are the "近 6 小时 4 次" real samples — replaying any one must be RED (判据3, D2 不构造).
 * @param {string|null|undefined} cmd
 * @returns {{ok:boolean, evaluated:boolean, reason:string}}
 */
export function judgeFanInCommand(cmd) {
  if (cmd == null || String(cmd).trim() === "") {
    return { ok: true, evaluated: false, reason: "no-command (NOT-EVALUATED)" };
  }
  const text = String(cmd);
  if (MAIN_THREAD_MERGE_CMD_RE.test(text)) {
    return { ok: false, evaluated: true, reason: "main-thread-non-ff-fan-in-merge" };
  }
  if (GIT_CT_MERGE_CMD_RE.test(text)) {
    return { ok: false, evaluated: true, reason: "main-thread-git-C-merge-into-worktree" };
  }
  return { ok: true, evaluated: true, reason: "not-main-thread-fan-in" };
}

// ── Pure: 判据4 (executor transcript location) ────────────────────────────────────────────────────────

/** A test.sh invocation that is NOT the scoped form — the FULL suite / doc check. The scoped gate is
 *  `--for-task <id>` / `--scoped`; anything else (bare `scripts/test.sh`, `--static-checks-doc`) is
 *  the main-thread-era "run the whole suite in the main session" form (criterion (a)). */
const SCOPED_TEST_RE = /--for-task|--scoped\b/;
/** A git commit that flips a task's status — the `tasks: 翻 <id> done` convention. Criterion (b).
 *  Position: the flip is a COMMIT MESSAGE pattern (翻/…/done, flip/…/done, status→done), NOT any
 *  commit touching tasks/*.md (the main session legitimately edits task files without flipping). */
const STATUS_FLIP_COMMIT_RE = /git\s+commit/;
const STATUS_FLIP_MSG_RE = /翻\s*[^\s]+\s*done|flip.*done|status.*done/;
/** A merge into develop — `git merge` (ff or no-ff of a task branch / develop) OR the fan-in-ff-merge.sh
 *  ff command (criterion (c)). `(?!-)` excludes the read-only `git merge-base` / `git merge-tree`
 *  diagnostics (after "merge" comes "-", not a space+target). */
const DEVELOP_MERGE_RE = /git\s+merge(?!-)|fan-in-ff-merge\.sh/;

/**
 * Classify ONE Bash command line into the fan-in-executor categories (判据4): which of the three
 * main-thread actions it is. PURE. Returns the set of categories present.
 * @param {string} cmd
 * @returns {string[]} subset of ["full-suite-test-sh", "status-flip-commit", "develop-merge"]
 */
export function classifyBashCommand(cmd) {
  const text = String(cmd ?? "");
  const cats = [];
  if (/test\.sh/.test(text) && !SCOPED_TEST_RE.test(text)) cats.push("full-suite-test-sh");
  if (STATUS_FLIP_COMMIT_RE.test(text) && STATUS_FLIP_MSG_RE.test(text)) cats.push("status-flip-commit");
  if (DEVELOP_MERGE_RE.test(text)) cats.push("develop-merge");
  return cats;
}

/**
 * Judge 判据4 — where the fan-in actions EXECUTED. PURE: the caller resolves the command lists from
 * the main session jsonl and the subagent transcripts. RED when the MAIN session carries any of the
 * three main-thread actions (the executor is the main thread, not the subagent); GREEN when the main
 * session has NONE and the subagent transcripts carry at least one; NOT-EVALUATED when neither side
 * has any classified command (no fan-in activity observed — cannot judge).
 * @param {string[]} mainCommands — Bash commands from the inner main session jsonl
 * @param {string[]} subagentCommands — Bash commands from all subagent agent-*.jsonl transcripts
 * @returns {{ok:boolean, evaluated:boolean, reason:string, mainViolations:{cmd:string,cats:string[]}[]}}
 */
export function checkTranscriptLocation(mainCommands, subagentCommands) {
  const main = (mainCommands ?? []).filter((c) => String(c).trim());
  const sub = (subagentCommands ?? []).filter((c) => String(c).trim());
  const mainViolations = main
    .map((cmd) => ({ cmd, cats: classifyBashCommand(cmd) }))
    .filter((v) => v.cats.length > 0);
  const subCats = new Set();
  for (const cmd of sub) for (const c of classifyBashCommand(cmd)) subCats.add(c);

  if (mainViolations.length > 0) {
    return { ok: false, evaluated: true, reason: "main-session-executor", mainViolations };
  }
  if (subCats.size > 0) {
    return { ok: true, evaluated: true, reason: `subagent-executor (${[...subCats].join("+")})`, mainViolations: [] };
  }
  return { ok: true, evaluated: false, reason: "no-fan-in-activity (NOT-EVALUATED)", mainViolations: [] };
}

// ── AC75 判据1: 无锁段第 1 步 rebase→merge (rebase 检出) ──────────────────────────────────────────────

/** The OLD rebase form in A6 step ① — `git rebase $MERGE_TARGET` (or any `git rebase <target>`), the
 *  inner implementation's "11 次 rebase" signature. The merge form is `git merge $MERGE_TARGET`. */
export const A6_STEP1_REBASE_RE = /git\s+rebase\s+\$?[A-Za-z_]/;
/** A fan-in command that rebases (the old executor's `git rebase develop` / `git rebase $MERGE_TARGET`). */
export const REBASE_CMD_RE = /git\s+rebase\s+\$?[A-Za-z_]/;

/**
 * Judge ONE A6 row's step ① form: merge-not-rebase (AC75 判据1). PURE. RED when the A6 line contains
 * a `git rebase <target>` COMMAND (the inner "11 次 rebase" signature); GREEN when it contains
 * `git merge` and no rebase command; NOT-EVALUATED when the line is missing/empty (cannot judge).
 * @param {string|null|undefined} a6Line
 * @returns {{ok:boolean, evaluated:boolean, reason:string, rebase:boolean}}
 */
export function judgeA6MergeNotRebase(a6Line) {
  if (a6Line == null || String(a6Line).trim() === "") {
    return { ok: true, evaluated: false, reason: "no-a6-line (NOT-EVALUATED)", rebase: false };
  }
  const text = String(a6Line);
  const rebase = A6_STEP1_REBASE_RE.test(text);
  if (rebase) {
    return { ok: false, evaluated: true, reason: "a6-step1-rebase (must be merge, AC75)", rebase: true };
  }
  return { ok: true, evaluated: true, reason: "a6-step1-merge-not-rebase", rebase: false };
}

/**
 * Judge ONE Bash command line: fan-in must merge, never rebase (AC75 判据1 command replay). PURE.
 * RED when the command contains a `git rebase <target>` (the old rebase-fan-in form); GREEN otherwise.
 * @param {string|null|undefined} cmd
 * @returns {{ok:boolean, evaluated:boolean, reason:string}}
 */
export function judgeCommandMergeNotRebase(cmd) {
  if (cmd == null || String(cmd).trim() === "") {
    return { ok: true, evaluated: false, reason: "no-command (NOT-EVALUATED)" };
  }
  if (REBASE_CMD_RE.test(String(cmd))) {
    return { ok: false, evaluated: true, reason: "rebase-fan-in-command (must be merge, AC75)" };
  }
  return { ok: true, evaluated: true, reason: "merge-fan-in-command" };
}

// ── AC75 判据2: A6 无锁段第 2 步 delta 断言面判定 (fail-closed) ────────────────────────────────────────

/** The A6 line must carry the NEW step ② delta 断言面判定 — the merge-in delta is judged against the
 *  suite's assertion surface before deciding whether to re-run the full suite. */
export const A6_DELTA_STEP_RE = /delta\s*断言面判定|断言面判定|要不要重跑.*suite|delta.*断言面/;
/** fail-closed marker: 判不出 ⇒ 重跑 (判不出 must NOT share a value with 不需要, 硬规则 3b). */
export const A6_DELTA_FAIL_CLOSED_RE = /判不出.*重跑|fail-closed.*重跑|判不出.*重跑全量/;

/**
 * Judge that the A6 line carries the delta 断言面判定 step AND it is fail-closed (AC75 判据2). PURE.
 * GREEN when both the delta-step marker and the fail-closed marker are present; RED when the step is
 * missing OR present but not fail-closed; NOT-EVALUATED when the line is missing/empty.
 * @param {string|null|undefined} a6Line
 * @returns {{ok:boolean, evaluated:boolean, reason:string, hasStep:boolean, failClosed:boolean}}
 */
export function judgeA6DeltaStep(a6Line) {
  if (a6Line == null || String(a6Line).trim() === "") {
    return { ok: true, evaluated: false, reason: "no-a6-line (NOT-EVALUATED)", hasStep: false, failClosed: false };
  }
  const text = String(a6Line);
  const hasStep = A6_DELTA_STEP_RE.test(text);
  const failClosed = A6_DELTA_FAIL_CLOSED_RE.test(text);
  if (!hasStep) {
    return { ok: false, evaluated: true, reason: "a6-missing-delta-step-2 (AC75)", hasStep: false, failClosed };
  }
  if (!failClosed) {
    return { ok: false, evaluated: true, reason: "a6-delta-step-not-fail-closed (判不出=重跑, 硬规则 3b)", hasStep: true, failClosed: false };
  }
  return { ok: true, evaluated: true, reason: "a6-delta-step-fail-closed", hasStep: true, failClosed: true };
}

// ── AC75 判据3: delta 断言面判定 能取假 (pure delta judge) ─────────────────────────────────────────────

/**
 * Classify a delta (the files merged in from develop) against the suite's CODE assertion surface.
 * Reuses AC51's doc/code classification: the code surface is the assertion surface EXCLUDING task
 * bodies (tasks/**) and doc-class files — per SPEC §1c, a delta that lands entirely on the
 * doc/任务体/telemetry face does NOT force a full-suite re-run. Pure — the caller resolves the surface.
 * @param {string[]} deltaFiles — the changed files (rel paths) merged in from develop
 * @param {Set<string>|string[]} codeSurface — the code/test/script files (assertion surface minus tasks/**)
 * @returns {{rerun:boolean, evaluated:boolean, reason:string, codeHits:string[]}}
 */
export function classifyDeltaRerun(deltaFiles, codeSurface) {
  const files = (deltaFiles ?? []).filter((f) => typeof f === "string" && f.trim());
  if (files.length === 0) {
    return { rerun: true, evaluated: false, reason: "empty-delta (fail-closed: 判不出=重跑)", codeHits: [] };
  }
  const surface = codeSurface instanceof Set ? codeSurface : new Set(codeSurface ?? []);
  if (surface.size === 0) {
    return { rerun: true, evaluated: false, reason: "no-code-surface (fail-closed: 判不出=重跑)", codeHits: [] };
  }
  const codeHits = files.filter((f) => surface.has(f));
  if (codeHits.length > 0) {
    return { rerun: true, evaluated: true, reason: `delta-touches-code (${codeHits.join(", ")})`, codeHits };
  }
  return { rerun: false, evaluated: true, reason: "delta-pure-doc/task/telemetry", codeHits: [] };
}

/**
 * Judge a fan-in delta DECISION against the classification (AC75 判据3 能取假). PURE. The decision is
 * what the executor actually did after merging develop: "reran-full-suite" or "skipped-full-suite".
 *   RED  delta touches code but executor SKIPPED the full suite   (含代码却跳过 — 漏重验)
 *   RED  delta is pure-doc/task/telemetry but executor RERAN      (纯 doc 却重跑 — 浪费 ~390s)
 *   RED  cannot judge (empty delta / no surface) but executor SKIPPED  (fail-closed violation)
 *   GREEN otherwise (decision matches the classification).
 * @param {string[]} deltaFiles
 * @param {Set<string>|string[]} codeSurface
 * @param {"reran-full-suite"|"skipped-full-suite"|null|undefined} decision
 * @returns {{ok:boolean, evaluated:boolean, reason:string, rerun:boolean, canJudge:boolean}}
 */
export function judgeDeltaDecision(deltaFiles, codeSurface, decision) {
  const c = classifyDeltaRerun(deltaFiles, codeSurface);
  if (!c.evaluated) {
    // fail-closed: cannot judge ⇒ must rerun. Skipping when we cannot judge is the violation.
    if (decision === "skipped-full-suite") {
      return { ok: false, evaluated: true, reason: `cannot-judge-but-skipped (${c.reason})`, rerun: true, canJudge: false };
    }
    return { ok: true, evaluated: false, reason: c.reason, rerun: true, canJudge: false };
  }
  if (decision == null) {
    return { ok: true, evaluated: false, reason: "no-decision (NOT-EVALUATED)", rerun: c.rerun, canJudge: true };
  }
  if (c.rerun) {
    if (decision === "skipped-full-suite") {
      return { ok: false, evaluated: true, reason: `code-delta-but-skipped (${c.reason})`, rerun: true, canJudge: true };
    }
    return { ok: true, evaluated: true, reason: `code-delta-reran (${c.reason})`, rerun: true, canJudge: true };
  }
  if (decision === "reran-full-suite") {
    return { ok: false, evaluated: true, reason: `pure-doc-but-reran (${c.reason})`, rerun: false, canJudge: true };
  }
  return { ok: true, evaluated: true, reason: `pure-doc-skipped (${c.reason})`, rerun: false, canJudge: true };
}

/**
 * Resolve the CODE assertion surface for the delta judgment from a repo root: the AC51 assertion
 * surface MINUS task bodies (tasks/**) — SPEC §1c treats 任务体 as a non-rerun face. Returns [] when
 * the root has no resolvable surface (the caller's classifyDeltaRerun then fail-closes).
 * @param {string} root
 * @returns {string[]}
 */
export function resolveDeltaCodeSurface(root) {
  try {
    const s = resolveAssertionSurface(root);
    return s.files.filter((f) => !f.startsWith("tasks/") && !f.startsWith("plugin/loop/"));
  } catch {
    return [];
  }
}

// ── fs helpers ─────────────────────────────────────────────────────────────────────────────────────────

/** Extract every Bash `tool_use` command from a Claude Code session jsonl file (the message.content
 *  block structure). Returns null when the file is absent/unreadable; [] when present with no Bash. */
export function extractBashCommands(file) {
  if (!fs.existsSync(file)) return null;
  const cmds = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const content = d?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "tool_use" && block.name === "Bash") {
        const c = block.input?.command;
        if (typeof c === "string" && c.trim()) cmds.push(c);
      }
    }
  }
  return cmds;
}

function readJsonlLines(file) {
  if (!file || !fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { out.push({ __unparseable: true }); }
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `fan-in-ff-executor-check.ts — AC67 fan-in EXECUTOR checker + AC75 delta 断言面判定 (判据1-判据7 能取假)
  A6 subject/form (判据1), fan-in record agentId ≠ inner 主会话 (判据2), real-sample replay (判据3),
  executor transcript location (判据4) ⇒ red on the main-thread-executor form; AC75 adds 判据5-判据7:
  无锁段第 1 步 rebase→merge (判据5), A6 delta 断言面判定 fail-closed (判据6), delta decision 能取假 (判据7).
  (tasks/gap-ac67-fan-in-executor-to-task-subagent, tasks/gap-ac75-fan-in-merge-not-rebase-delta-check)

Usage:
  node --experimental-strip-types fan-in-ff-executor-check.ts
      [--root <dir>] [--a6-file <fast-mode-tick-core.md>] [--a6-line <text>]
      [--lock-events <file>] [--retry-record <file>] [--main-agent-id <id>]
      [--command <text>] [--main-session <jsonl>] [--subagent-transcripts <a.jsonl,b.jsonl>]
      [--delta-files <csv>] [--delta-decision <reran-full-suite|skipped-full-suite>]
      [--json] [--help]

  --root <dir>         repo root (default: cwd). Default lock-events/retry-record paths resolve
                       under its .quay/. Also resolves the delta code surface (AC51 assertion surface
                       minus tasks/**) for --delta-files.
  --a6-file <file>    判据1/5/6: extract the \`| A6 |\` row from a fast-mode-tick-core.md and judge it
  --a6-line <text>    判据1/5/6: judge a single A6 row line directly (test surface)
  --lock-events <file> 判据2: the fan-in-ff-merge.sh lock-event log (default <root>/.quay/...)
  --retry-record <file> 判据2: the ff retry-record log (default <root>/.quay/...)
  --main-agent-id <id>  判据2: the inner MAIN session's agent id — a record EQUAL to it is red
  --command <text>    判据3/5: judge a single fan-in command (real-sample replay surface; a rebase
                       command ⇒ RED under AC75 判据5)
  --main-session <file> 判据4: the inner MAIN session jsonl — (a) test.sh w/o --for-task / (b) tasks/*.md
                       status-flip commit / (c) develop merge here ⇒ RED (主线程执行者)
  --subagent-transcripts <csv>  判据4: the <session>/subagents/agent-*.jsonl transcripts — the three
                       actions appearing ONLY here (and NOT in --main-session) ⇒ GREEN
  --delta-files <csv>  判据7: the delta merged in from develop (rel paths, comma-separated). Classified
                       against the code surface (--root). Pair with --delta-decision to judge a decision.
  --delta-decision <reran-full-suite|skipped-full-suite>  判据7: what the executor actually did after
                       merging develop. RED on code-delta-but-skipped / pure-doc-but-reran /
                       cannot-judge-but-skipped (fail-closed).
  --json              machine-readable output { evaluated, ok, checks:[...], reason }
  --help              this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a main-thread-executor form (old A6 subject / \`git -C <wt>\` / missing-or-main agentId /
      main-session carries the full-suite/flip/merge actions) OR an AC75 delta violation (rebase /
      missing delta step / code-skip or doc-rerun)
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const a6File = getArgValue(args, "--a6-file");
  const a6Line = getArgValue(args, "--a6-line");
  const lockEventsFile = getArgValue(args, "--lock-events") ?? path.join(root, ".quay", "fan-in-merge-lock-events.jsonl");
  const retryRecordFile = getArgValue(args, "--retry-record") ?? path.join(root, ".quay", "fan-in-retries.jsonl");
  const mainAgentId = getArgValue(args, "--main-agent-id") ?? null;
  const command = getArgValue(args, "--command");
  const mainSessionFile = getArgValue(args, "--main-session");
  const subagentTranscripts = (getArgValue(args, "--subagent-transcripts") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const deltaFiles = (getArgValue(args, "--delta-files") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const deltaDecision = getArgValue(args, "--delta-decision") ?? null;
  const asJson = args.includes("--json");

  const checks = [];
  let anyEvaluated = false;
  let anyRed = false;

  // ── 判据1 — A6 subject/form ──────────────────────────────────────────────────────────────────────
  const lineToJudge = a6Line ?? (a6File ? extractA6Line(path.resolve(a6File)) : null);
  const v1 = judgeA6Line(lineToJudge);
  if (v1.evaluated) {
    anyEvaluated = true;
    if (!v1.ok) anyRed = true;
  }
  checks.push({ check: "a6-executor-position", ...v1, source: a6File ?? (a6Line != null ? "<a6-line>" : "<none>") });

  // ── AC75 判据5 — A6 step ① rebase→merge + command rebase 检出 ─────────────────────────────────────
  if (lineToJudge != null) {
    const v5a = judgeA6MergeNotRebase(lineToJudge);
    if (v5a.evaluated) {
      anyEvaluated = true;
      if (!v5a.ok) anyRed = true;
    }
    checks.push({ check: "a6-step1-merge-not-rebase", ...v5a, source: a6File ?? (a6Line != null ? "<a6-line>" : "<none>") });
  }
  if (command != null) {
    const v5b = judgeCommandMergeNotRebase(command);
    if (v5b.evaluated) {
      anyEvaluated = true;
      if (!v5b.ok) anyRed = true;
    }
    checks.push({ check: "command-merge-not-rebase", ...v5b, source: "<command>" });
  }

  // ── AC75 判据6 — A6 无锁段第 2 步 delta 断言面判定 (fail-closed) ────────────────────────────────────
  if (lineToJudge != null) {
    const v6 = judgeA6DeltaStep(lineToJudge);
    if (v6.evaluated) {
      anyEvaluated = true;
      if (!v6.ok) anyRed = true;
    }
    checks.push({ check: "a6-delta-assertion-step", ...v6, source: a6File ?? (a6Line != null ? "<a6-line>" : "<none>") });
  }

  // ── AC75 判据7 — delta decision 能取假 ────────────────────────────────────────────────────────────
  if (deltaFiles.length > 0 || deltaDecision != null) {
    const codeSurface = resolveDeltaCodeSurface(root);
    const v7 = judgeDeltaDecision(deltaFiles, codeSurface, deltaDecision);
    if (v7.evaluated) {
      anyEvaluated = true;
      if (!v7.ok) anyRed = true;
    }
    checks.push({
      check: "delta-assertion-decision",
      ...v7,
      source: `${deltaFiles.length} delta file(s)${deltaDecision != null ? `, decision=${deltaDecision}` : ""} (code-surface from ${root})`,
    });
  }

  // ── 判据2 — agentId in lock events + retry records ───────────────────────────────────────────────
  const eventRecords = readJsonlLines(lockEventsFile);
  const retryRecords = readJsonlLines(retryRecordFile);
  const v2events = checkAgentId(eventRecords, mainAgentId);
  const v2retry = checkAgentId(retryRecords, mainAgentId);
  for (const [label, v, file] of [
    ["lock-events", v2events, lockEventsFile],
    ["retry-record", v2retry, retryRecordFile],
  ]) {
    if (v.evaluated) {
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
    }
    checks.push({ check: `agent-id-${label}`, ...v, source: file });
  }

  // ── 判据3 — real main-thread fan-in command replay ───────────────────────────────────────────────
  if (command != null) {
    const v3 = judgeFanInCommand(command);
    if (v3.evaluated) {
      anyEvaluated = true;
      if (!v3.ok) anyRed = true;
    }
    checks.push({ check: "fan-in-command-replay", ...v3, source: "<command>" });
  }

  // ── 判据4 — executor transcript location (main session vs subagent transcripts) ──────────────────
  if (mainSessionFile != null || subagentTranscripts.length > 0) {
    const mainCmds = mainSessionFile != null ? extractBashCommands(path.resolve(mainSessionFile)) : [];
    const subCmds = subagentTranscripts
      .flatMap((f) => extractBashCommands(path.resolve(f)) ?? []);
    const v4 = checkTranscriptLocation(mainCmds, subCmds);
    if (v4.evaluated) {
      anyEvaluated = true;
      if (!v4.ok) anyRed = true;
    }
    checks.push({
      check: "executor-transcript-location",
      ...v4,
      source: `${mainSessionFile ?? "<none>"} vs ${subagentTranscripts.length} subagent transcript(s)`,
    });
  }

  const ok = !anyRed;
  const out = {
    ok,
    evaluated: anyEvaluated,
    reason: ok ? (anyEvaluated ? "executor-check-pass" : "nothing-to-judge (NOT-EVALUATED)") : "main-thread-executor-or-ac75-delta-violation",
    checks,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`fan-in-ff-executor-check: ${ok ? "OK" : "FAIL"} — ${out.reason}`);
    for (const c of out.checks) {
      console.log(`  [${c.check}] ${c.ok ? "ok" : "RED"}${c.evaluated ? "" : " (NOT-EVALUATED)"} — ${c.reason}`);
    }
  }
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-ff-executor-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
