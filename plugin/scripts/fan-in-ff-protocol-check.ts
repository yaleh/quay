#!/usr/bin/env node
// fan-in-ff-protocol-check.ts — AC62 protocol checker (判据2 能取假 / 判据3 失败路径).
// (tasks/gap-ac62-fan-in-ff-merge-lock-protocol, SPEC-fan-in-ff-merge-lock-2026-08-14)
//
// The fan-in protocol: 无锁段自测 (merge develop + full suite + doc check) + 持锁段 (`git merge
// --ff-only` under a merge lock that wraps ONLY the ff). This checker makes the protocol's
// can-be-false criteria mechanical:
//
//   判据2a — a NON-ff fan-in merge on develop ⇒ RED. After the protocol, a correct fan-in is a
//           fast-forward: develop advances to the task tip and NO fan-in merge commit is created.
//           A merge commit whose subject matches the fan-in convention (`merge: fan-in task/<id> …`
//           or git's own `Merge branch 'task/<id>'`) is a protocol violation. Historical fan-ins
//           (pre-protocol) are all such commits, so a `--baseline <ref>` is REQUIRED for a hard
//           verdict: only fan-in merge commits in `<baseline>..<develop>` are scanned. WITHOUT a
//           baseline the checker cannot tell a new violation from history ⇒ NOT-EVALUATED
//           (evaluated:false, exit 0 — 硬规则 3b: 无法评估 ≠ 合格, never conflated with green).
//   判据2b — a SUITE CALL INSIDE the locked section ⇒ RED. The merge lock is held for milliseconds
//           around the ff only; if any lock-hold interval (from .quay/fan-in-merge-lock-events.jsonl,
//           written by fan-in-ff-merge.sh) overlaps the suite-run interval (from
//           .quay/full-suite-state.json), the lock covered something it must not (AC4). A missing
//           lock-events file (no fan-in ever held the lock) is a VACUOUS pass; a MALFORMED lock log
//           (an unpaired acquire) is NOT-EVALUATED (cannot build the hold intervals).
//   判据3 — a retry record that lacks any of {taskId, attempt:int≥1, developHead:40-hex, ts} ⇒ RED.
//           The retry record is the anti-livelock data (§7) — a malformed record is unusable for
//           the "同一任务 ff 失败 ≥3 次" trigger. An absent/empty retry file is a PASS (no failures
//           recorded — nothing to validate).
//   判据4 — (gap-fan-in-workflow-lock-and-S1, AC4 修订) the fan-in WORKFLOW lock must COVER the suite
//           ⇒ RED when a same-task suite run falls OUTSIDE its workflow-lock hold. This is the NEW
//           whole-workflow lock (`fan-in-workflow.lock`, events in .quay/fan-in-workflow-lock-
//           events.jsonl, written by fan-in-ff-merge.sh --acquire/--release-workflow-lock), DISTINCT
//           from the ms-scale merge lock of 判据2b/判据1. The OLD AC4「两把锁覆盖范围不得交叉」stays
//           true for the MERGE lock (判据2b); the workflow lock is EXPECTED to overlap/cover the suite.
//           A suite with no taskId, or no workflow-lock hold, is NOT-EVALUATED (硬规则 3b).
//
// Each sub-check runs when its inputs are present; the aggregate verdict is RED if ANY sub-check is
// RED. `evaluated` is true iff at least one sub-check produced a hard verdict (per sub-check the
// NOT-EVALUATED state is reported distinctly, never folded into green).
//
// Exit codes: 0 = PASS (or NOT-EVALUATED — read `evaluated`), 1 = RED (a protocol violation),
//             2 = usage/environment error.
//
// Run:
//   node --experimental-strip-types fan-in-ff-protocol-check.ts [--root <dir>] [--develop <ref>]
//       [--baseline <ref>] [--lock-events <file>] [--suite-state <file>] [--retry-record <file>]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Constants ─────────────────────────────────────────────────────────────────────────────────────────

/** A fan-in merge commit subject: the convention `merge: fan-in task/<id> …` OR git's own auto
 *  subject for a task-branch merge `Merge branch 'task/<id>'`. A merge commit (2+ parents) whose
 *  subject matches this on develop after the protocol baseline is a NON-ff fan-in violation.
 *
 *  ⚠️ 2026-08-14 gap-ac78 fix: the bare `fan-in` alternative was TOO BROAD — it matched the LEGITIMATE
 *  step-1 `git merge develop` commit subject `Merge branch 'develop' into task/<id>` whenever the task
 *  id contains "fan-in" (e.g. task/gap-ac78-fan-in-workflow-a6-check), reddening the gate on the
 *  protocol's OWN designed flow (SPEC §3: step 1 produces a merge commit that ff carries onto develop).
 *  Tightened to the two actual fan-in conventions: the `merge: fan-in ` prefix (the explicit non-ff
 *  fan-in subject) and git's `Merge branch 'task/<id>'` (a --no-ff merge of a task branch). */
export const FAN_IN_MERGE_SUBJECT_RE = /\bmerge: fan-in |Merge (remote-tracking )?branch 'task\//i;

/** A valid retry-record entry: taskId (string), attempt (int ≥ 1), developHead (40-hex), ts (ISO
 *  `YYYY-MM-DDTHH:MM:SSZ`). Missing/extra fields are allowed but these four must be well-formed. */
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HEX40_RE = /^[0-9a-f]{40}$/;

// ── Pure: 判据2a (non-ff fan-in on develop) ───────────────────────────────────────────────────────────

/**
 * Decide 判据2a from a list of merge-commit subjects on `<baseline>..<develop>`. PURE: the caller
 * resolves the git log; tests inject deterministic subjects.
 * @param {string[]} mergeSubjects — subjects of every MERGE commit in <baseline>..<develop>
 * @returns {{ok:boolean, violations:string[], evaluated:boolean, reason:string}}
 */
export function checkNonFfFanIn(mergeSubjects) {
  const violations = (mergeSubjects ?? []).filter((s) => FAN_IN_MERGE_SUBJECT_RE.test(String(s ?? "")));
  if (violations.length > 0) {
    return { ok: false, violations, evaluated: true, reason: "non-ff-fan-in-merge-on-develop" };
  }
  return { ok: true, violations: [], evaluated: true, reason: "no-non-ff-fan-in-merge" };
}

// ── Pure: 判据2b (suite call inside the locked section) ───────────────────────────────────────────────

/**
 * Build lock-hold intervals from the lock-events log lines. Each line: `{event:"acquire"|"release",
 * epoch:number, ...}`. A hold interval is the pair (acquireEpoch, next releaseEpoch) for the same
 * taskId/pid. Returns `{ intervals, malformed }` — malformed=true when a log cannot be paired
 * (a release without a preceding acquire, an acquire with no following release, an unparseable line).
 * PURE.
 * @param {Array<Record<string, any>>} events
 */
export function buildLockHoldIntervals(events) {
  const intervals = [];
  const open = new Map(); // key `${taskId}|${pid}` → acquire epoch
  let malformed = false;
  for (const e of events) {
    if (!e || (e.event !== "acquire" && e.event !== "release")) { malformed = true; continue; }
    if (typeof e.epoch !== "number" || Number.isNaN(e.epoch)) { malformed = true; continue; }
    const key = `${e.taskId ?? "?"}|${e.pid ?? "?"}`;
    if (e.event === "acquire") {
      if (open.has(key)) { malformed = true; continue; } // double acquire without release
      open.set(key, e.epoch);
    } else { // release
      const start = open.get(key);
      if (start == null) { malformed = true; continue; } // release without acquire
      // Carry taskId on the interval so 判据2b can scope the overlap to the SAME task's lock
      // (gap-fan-in-ff-protocol-check-cross-task-false-positive): a concurrent other-task ff merge
      // falling inside this task's suite window is a legitimate cross-task overlap, not a violation.
      intervals.push({ start, end: e.epoch, key, taskId: e.taskId });
      open.delete(key);
    }
  }
  if (open.size > 0) malformed = true; // unclosed acquires
  return { intervals, malformed };
}

/**
 * Decide 判据2b: does any lock-hold interval overlap the suite-run interval `[suiteStart, suiteEnd]`?
 * Scoped by taskId when the suite run carries one (cross-task overlap is a legitimate concurrency,
 * not a suite-call-inside-the-lock violation). PURE.
 * @param {{start:number,end:number,taskId?:string}[]} holdIntervals
 * @param {{start:number,end:number,taskId?:string|null}|null} suiteRun — null when the suite state has no run to compare
 * @returns {{ok:boolean, overlaps:{start:number,end:number,taskId?:string}[], evaluated:boolean, reason:string}}
 */
export function checkSuiteInLock(holdIntervals, suiteRun) {
  if (suiteRun == null) {
    // No suite-run interval to compare against — the overlap property cannot be evaluated.
    return { ok: true, overlaps: [], evaluated: false, reason: "no-suite-run-interval" };
  }
  // 判据2b scoping (gap-fan-in-ff-protocol-check-cross-task-false-positive): the protocol violation
  // is a SUITE call inside the SAME task's locked section (SPEC §4 — the merge lock covers the ff,
  // the suite covers the 无锁段 self-test; the two locks are "对象不相干"). In a concurrent multi-
  // worktree fan-in, task A's suite (tens of minutes) and task B's millisecond ff merge legitimately
  // overlap in wall-clock time — that is NOT a violation, and flagging it is a cross-task false
  // positive. So when the suite run carries a taskId, only a lock-hold for that SAME task is a
  // violation. When the suite run lacks a taskId (legacy state), fall back to the unscoped temporal
  // overlap (backward-compatible).
  const suiteTaskId = suiteRun.taskId;
  const overlaps = holdIntervals.filter((h) => {
    const temporalOverlap = h.start <= suiteRun.end && h.end >= suiteRun.start;
    if (!temporalOverlap) return false;
    if (suiteTaskId != null) return h.taskId === suiteTaskId;
    return true; // legacy suite state: cannot scope by task
  });
  if (overlaps.length > 0) {
    return { ok: false, overlaps, evaluated: true, reason: "suite-call-inside-merge-lock" };
  }
  return { ok: true, overlaps: [], evaluated: true, reason: "no-suite-lock-overlap" };
}

// ── Pure: 判据4 (gap-fan-in-workflow-lock-and-S1 — the WORKFLOW lock must COVER the suite) ───────────
// AC4 修订 (SPEC-fan-in-ff-merge-lock-2026-08-14 → SPEC-fan-in-workflow-lock-and-S1-2026-08-26 §3
// 约束 2): the OLD AC4「两把锁覆盖范围不得交叉」(the ms-scale merge lock must never overlap a suite run)
// stays TRUE for the MERGE lock (判据2b above) — but a NEW, separate fan-in WORKFLOW lock
// (`fan-in-workflow.lock`, events in `.quay/fan-in-workflow-lock-events.jsonl`) is now EXPECTED to cover
// the whole workflow INCLUDING the suite. 判据4 is that new lock's can-be-false invariant: for a task that
// holds the workflow lock AND ran a suite, the suite run must be CONTAINED within the workflow-lock hold
// (a suite that ran OUTSIDE its workflow lock means the lock failed to protect the merge → ff-race returns).

/**
 * Decide 判据4: does the workflow-lock hold interval CONTAIN (cover) the suite-run interval for the SAME
 * task? Scoped by taskId — a suite run with no taskId, or no workflow-lock hold for that task, cannot be
 * judged (NOT-EVALUATED, never conflated with green). PURE.
 * @param {{start:number,end:number,taskId?:string}[]} workflowHoldIntervals — from buildLockHoldIntervals on the workflow-lock events
 * @param {{start:number,end:number,taskId?:string|null}|null} suiteRun — the suite-run interval (may carry a taskId)
 * @returns {{ok:boolean, evaluated:boolean, reason:string}}
 */
export function checkSuiteCoveredByWorkflowLock(workflowHoldIntervals, suiteRun) {
  const holds = (workflowHoldIntervals ?? []).filter(Boolean);
  if (suiteRun == null) {
    return { ok: true, evaluated: false, reason: "no-suite-run-interval" };
  }
  if (holds.length === 0) {
    return { ok: true, evaluated: false, reason: "no-workflow-lock-holds" };
  }
  if (suiteRun.taskId == null) {
    // A legacy suite state without a taskId cannot be scoped to a workflow lock — the containment
    // property is unevaluable (硬规则 3b: 无法评估 ≠ 合格, reported distinctly, never folded green).
    return { ok: true, evaluated: false, reason: "suite-run-lacks-task-id (NOT-EVALUATED)" };
  }
  const covers = holds.some((h) => h.taskId === suiteRun.taskId && h.start <= suiteRun.start && h.end >= suiteRun.end);
  if (!covers) {
    return { ok: false, evaluated: true, reason: "suite-run-outside-workflow-lock" };
  }
  return { ok: true, evaluated: true, reason: "suite-covered-by-workflow-lock" };
}

// ── Pure: 判据1 (lock-hold covers ONLY the ff — AC66 给 AC62 判据1 配的产物) ─────────────────────────

/**
 * Decide 判据1 (AC62 "持锁期间唯一动作=ff"): every lock-hold interval must be SHORT — `git merge
 * --ff-only` moves a ref and takes milliseconds, so a hold that is not millisecond-scale means the
 * lock covered something OTHER than the ff (a suite, an edit, a wait). The merge lock's whole point
 * (SPEC §2) is millisecond-scale hold so stale-lock recovery is almost never reached; a long hold
 * violates the protocol's own premise. PURE. NOT-EVALUATED when there are no hold intervals.
 * @param {{start:number,end:number}[]} holdIntervals — from buildLockHoldIntervals
 * @param {number} maxSeconds — the hold-length bound (default 60: ff-only is ms; >60s = not-ff)
 * @returns {{ok:boolean, violations:{start:number,end:number,key?:string}[], evaluated:boolean, reason:string}}
 */
export function checkLockHoldDuration(intervals, maxSeconds) {
  const list = (intervals ?? []).filter(Boolean);
  if (list.length === 0) {
    return { ok: true, violations: [], evaluated: false, reason: "no-lock-hold-intervals" };
  }
  const violations = list.filter((h) => h.end - h.start > maxSeconds);
  if (violations.length > 0) {
    return { ok: false, violations, evaluated: true, reason: "lock-hold-covers-non-ff-action" };
  }
  return { ok: true, violations: [], evaluated: true, reason: "all-lock-holds-ms-scale" };
}

// ── Pure: 判据3 (retry-record shape) ──────────────────────────────────────────────────────────────────

/**
 * Validate the shape of every retry-record entry. A record must carry taskId (non-empty string),
 * attempt (int ≥ 1), developHead (40-hex), ts (ISO `…Z`). PURE.
 * @param {Record<string, any>[]} records
 * @returns {{ok:boolean, bad:string[], evaluated:boolean, reason:string}}
 */
export function checkRetryRecordShape(records) {
  const bad = [];
  (records ?? []).forEach((r, i) => {
    if (!r || typeof r !== "object") { bad.push(`[${i}] not-an-object`); return; }
    if (typeof r.taskId !== "string" || !r.taskId) bad.push(`[${i}] missing/invalid taskId`);
    if (!Number.isInteger(r.attempt) || r.attempt < 1) bad.push(`[${i}] attempt must be an int ≥ 1 (got ${r.attempt})`);
    if (typeof r.developHead !== "string" || !HEX40_RE.test(r.developHead)) bad.push(`[${i}] developHead must be 40-hex (got ${r.developHead})`);
    if (typeof r.ts !== "string" || !ISO_TS_RE.test(r.ts)) bad.push(`[${i}] ts must be ISO …Z (got ${r.ts})`);
  });
  if (bad.length > 0) {
    return { ok: false, bad, evaluated: true, reason: "malformed-retry-record" };
  }
  return { ok: true, bad: [], evaluated: true, reason: "retry-record-shape-ok" };
}

// ── git / fs helpers (the impure boundary — tests can inject pure verdicts directly) ──────────────────

export function gitLogMergeSubjects(root, baseline, develop) {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", `${baseline}..${develop}`, "--merges", "--format=%s"],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return null; // ref unresolved or git unavailable
  }
}

function readJsonlLines(file) {
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { out.push({ __unparseable: true }); }
  }
  return out;
}

/** Parse the suite-run interval from a full-suite-state file: `{state, startedAt, finishedAt}`.
 *  Returns `{start, end, taskId}` in epoch seconds (finishedAt is epoch; startedAt is ISO or epoch),
 *  or null when there is no completed run to compare. `taskId` is the suite run's owning task (null
 *  when the state file does not carry one) — 判据2b scopes the suite-in-lock overlap to it
 *  (gap-fan-in-ff-protocol-check-cross-task-false-positive). A suite that is `running` right now has
 *  no end yet — the lock must never be held during it, so end = now. */
export function suiteRunInterval(root, suiteStateFile) {
  if (!fs.existsSync(suiteStateFile)) return null;
  let d;
  try { d = JSON.parse(fs.readFileSync(suiteStateFile, "utf8")); } catch { return null; }
  if (d == null || typeof d !== "object") return null;
  const started = d.startedAt ?? d.started;
  let start = null;
  if (typeof started === "number") start = started;
  else if (typeof started === "string") {
    const t = Date.parse(started.replace("Z", "+00:00"));
    if (!Number.isNaN(t)) start = t / 1000;
  }
  if (start == null) return null;
  let end = null;
  if (typeof d.finishedAt === "number") end = d.finishedAt;
  else if (typeof d.finishedAt === "string") {
    const t = Date.parse(d.finishedAt.replace("Z", "+00:00"));
    if (!Number.isNaN(t)) end = t / 1000;
  }
  if (end == null) end = Math.floor(Date.now() / 1000); // still running (or finishedAt missing)
  if (end < start) end = start;
  const taskId = typeof d.taskId === "string" && d.taskId ? d.taskId : null;
  return { start, end, taskId };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `fan-in-ff-protocol-check.ts — AC62 protocol checker (判据2 能取假 / 判据3 失败路径)
  non-ff fan-in merge on develop ⇒ red; suite call inside the locked section ⇒ red;
  malformed ff-retry record ⇒ red (tasks/gap-ac62-fan-in-ff-merge-lock-protocol)

Usage:
  node --experimental-strip-types fan-in-ff-protocol-check.ts [--root <dir>] [--develop <ref>]
      [--baseline <ref>] [--lock-events <file>] [--suite-state <file>] [--retry-record <file>]
      [--json] [--help]

  --root <dir>          repo root (default: cwd). Default artifact paths resolve under its .quay/.
  --develop <ref>       the merge-target ref to scan for non-ff fan-ins (default: develop)
  --baseline <ref>      判据2a: only fan-in merges NEWER than this commit are violations. WITHOUT a
                        baseline the checker is NOT-EVALUATED (cannot tell new from history).
  --lock-events <file>  判据2b: the fan-in-ff-merge.sh lock-event log (default <root>/.quay/fan-in-
                        merge-lock-events.jsonl)
  --workflow-lock-events <file>  判据4: the whole-workflow fan-in lock-event log (default
                        <root>/.quay/fan-in-workflow-lock-events.jsonl)
  --suite-state <file>  判据2b: the suite-state file (default <root>/.quay/full-suite-state.json)
  --retry-record <file> 判据3: the ff retry-record log (default <root>/.quay/fan-in-retries.jsonl)
  --max-hold-seconds <n> 判据1 (AC62 唯一动作=ff): a lock-hold interval LONGER than this many seconds
                        ⇒ RED (ff-only is milliseconds; >60s means the lock covered something else).
                        Default 60. Pass --max-hold-seconds 0 to judge any non-zero hold as red.
  --json                machine-readable output { evaluated, ok, checks:[...], reason }
  --help                this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a protocol violation (non-ff fan-in / suite-in-lock / non-ff lock-hold / malformed retry record)
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const develop = getArgValue(args, "--develop") ?? "develop";
  const baseline = getArgValue(args, "--baseline");
  const lockEventsFile = path.resolve(getArgValue(args, "--lock-events") ?? path.join(root, ".quay", "fan-in-merge-lock-events.jsonl"));
  const workflowLockEventsFile = path.resolve(getArgValue(args, "--workflow-lock-events") ?? path.join(root, ".quay", "fan-in-workflow-lock-events.jsonl"));
  const suiteStateFile = path.resolve(getArgValue(args, "--suite-state") ?? path.join(root, ".quay", "full-suite-state.json"));
  const retryRecordFile = path.resolve(getArgValue(args, "--retry-record") ?? path.join(root, ".quay", "fan-in-retries.jsonl"));
  const rawMaxHold = getArgValue(args, "--max-hold-seconds");
  const maxHoldSeconds = rawMaxHold != null ? Number(rawMaxHold) : 60;
  if (rawMaxHold != null && (!Number.isFinite(maxHoldSeconds) || maxHoldSeconds < 0)) {
    process.stderr.write(`fan-in-ff-protocol-check: --max-hold-seconds must be a non-negative number (got '${rawMaxHold}')\n`);
    return 2;
  }
  const asJson = args.includes("--json");

  const checks = [];
  let anyEvaluated = false;
  let anyRed = false;

  // ── 判据2a — non-ff fan-in on develop (requires a baseline) ──────────────────────────────────────
  if (baseline != null) {
    const subjects = gitLogMergeSubjects(root, baseline, develop);
    if (subjects == null) {
      checks.push({ check: "non-ff-fan-in", evaluated: false, ok: true, reason: "baseline-or-develop-unresolvable" });
    } else {
      const v = checkNonFfFanIn(subjects);
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
      checks.push({ check: "non-ff-fan-in", evaluated: v.evaluated, ok: v.ok, violations: v.violations, reason: v.reason });
    }
  } else {
    checks.push({ check: "non-ff-fan-in", evaluated: false, ok: true, reason: "no-baseline (NOT-EVALUATED)" });
  }

  // ── 判据2b — suite call inside the locked section ─────────────────────────────────────────────────
  const events = readJsonlLines(lockEventsFile);
  if (events == null) {
    // No lock-events file: the lock was never held in this repo — vacuous pass, but not a hard verdict.
    checks.push({ check: "suite-in-lock", evaluated: false, ok: true, reason: "no-lock-events-file" });
  } else {
    const unparseable = events.some((e) => e && e.__unparseable);
    if (unparseable) {
      checks.push({ check: "suite-in-lock", evaluated: false, ok: true, reason: "malformed-lock-events (NOT-EVALUATED)" });
    } else {
      const { intervals, malformed } = buildLockHoldIntervals(events);
      if (malformed) {
        checks.push({ check: "suite-in-lock", evaluated: false, ok: true, reason: "unpaired-lock-events (NOT-EVALUATED)" });
        checks.push({ check: "lock-hold-only-ff", evaluated: false, ok: true, reason: "unpaired-lock-events (NOT-EVALUATED)" });
      } else {
        const suiteRun = suiteRunInterval(root, suiteStateFile);
        const v = checkSuiteInLock(intervals, suiteRun);
        if (v.evaluated) anyEvaluated = true;
        if (!v.ok) anyRed = true;
        checks.push({ check: "suite-in-lock", evaluated: v.evaluated, ok: v.ok, overlaps: v.overlaps, reason: v.reason });
        // 判据1 (AC66 给 AC62 判据1 配的产物): 持锁期间唯一动作=ff ⇒ every hold must be SHORT
        // (ff-only is milliseconds; a longer hold means the lock covered something other than the ff).
        const v1 = checkLockHoldDuration(intervals, maxHoldSeconds);
        if (v1.evaluated) anyEvaluated = true;
        if (!v1.ok) anyRed = true;
        checks.push({ check: "lock-hold-only-ff", evaluated: v1.evaluated, ok: v1.ok, violations: v1.violations, reason: v1.reason });
      }
    }
  }

  // ── 判据4 (gap-fan-in-workflow-lock-and-S1, AC4 修订) — workflow lock must COVER the suite ────────
  const wfEvents = readJsonlLines(workflowLockEventsFile);
  if (wfEvents == null) {
    checks.push({ check: "workflow-lock-covers-suite", evaluated: false, ok: true, reason: "no-workflow-lock-events-file" });
  } else {
    const unparseableWf = wfEvents.some((e) => e && e.__unparseable);
    if (unparseableWf) {
      checks.push({ check: "workflow-lock-covers-suite", evaluated: false, ok: true, reason: "malformed-workflow-lock-events (NOT-EVALUATED)" });
    } else {
      const { intervals: wfIntervals, malformed: wfMalformed } = buildLockHoldIntervals(wfEvents);
      if (wfMalformed) {
        checks.push({ check: "workflow-lock-covers-suite", evaluated: false, ok: true, reason: "unpaired-workflow-lock-events (NOT-EVALUATED)" });
      } else {
        const suiteRun = suiteRunInterval(root, suiteStateFile);
        const v4 = checkSuiteCoveredByWorkflowLock(wfIntervals, suiteRun);
        if (v4.evaluated) anyEvaluated = true;
        if (!v4.ok) anyRed = true;
        checks.push({ check: "workflow-lock-covers-suite", evaluated: v4.evaluated, ok: v4.ok, reason: v4.reason });
      }
    }
  }

  // ── 判据3 — retry-record shape ────────────────────────────────────────────────────────────────────
  const records = readJsonlLines(retryRecordFile);
  if (records == null) {
    checks.push({ check: "retry-record-shape", evaluated: true, ok: true, reason: "no-retry-record-file (nothing to validate)" });
  } else {
    const unparseable = records.some((r) => r && r.__unparseable);
    if (unparseable) {
      checks.push({ check: "retry-record-shape", evaluated: true, ok: false, reason: "unparseable-retry-record-line" });
      anyRed = true;
    } else {
      const v = checkRetryRecordShape(records);
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
      checks.push({ check: "retry-record-shape", evaluated: v.evaluated, ok: v.ok, bad: v.bad, reason: v.reason });
    }
  }

  const result = {
    evaluated: anyEvaluated,
    ok: !anyRed,
    reason: anyRed ? "protocol-violation" : anyEvaluated ? "pass" : "not-evaluated",
    checks,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    console.log(`fan-in-ff-protocol-check: evaluated=${result.evaluated} ok=${result.ok} (${result.reason})`);
    for (const c of checks) {
      const tag = c.evaluated ? (c.ok ? "OK" : "RED") : "NOT-EVALUATED";
      console.log(`  ${tag} ${c.check} — ${c.reason}${c.violations?.length ? ` (${c.violations.length} fan-in merge commit(s))` : ""}${c.bad?.length ? ` (${c.bad.length} malformed)` : ""}`);
    }
  }
  return anyRed ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "fan-in-ff-protocol-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
