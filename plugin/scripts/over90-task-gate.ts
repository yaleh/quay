// over90-task-gate.ts — the over-90m task gate helpers (TASK_OVER_90M_MS / taskStatusAllowsOver90m /
// makeOver90ExecutorGone), migrated OUT of inner-blocked-signal.ts (tasks/gap-retire-inner-hygiene-
// migrate-helper, 2026-09-01).
//
// WHY THIS FILE: the inner layer's tmux session is RETIRED (AC148 / AC149), but these three helpers
// were the LIVE consumer surface of inner-blocked-signal.ts — supervisor-preempt-candidates.ts (the
// supervisor base layer's preemption criterion) imports them, and inner-blocked-signal.ts's own
// detectTaskOver90m (the --detect-stop face, retired separately in step2) still uses them. They are
// the ①类 live helpers moved to a non-inner name so step2 can delete the ②类 session face
// (--detect-stop / --pane / 落盘) without breaking the supervisor. Two transitive deps —
// readTaskStatus (the task-file `status` frontmatter read) and hasMergeRecord (the durable merge
// record probe) — are used ONLY by these helpers, so they moved too (a non-inner file must never
// import back into an inner-named file).
//
// Pure migration — behavior unchanged, only the home moved. The source task's AC1: consumer imports
// must point at THIS file, never back at inner-blocked-signal.ts.
//
// ⛔ RETIRED (AC0, 2026-10-13) — `taskStatusAllowsOver90m` only; the other two helpers are live code
// (gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire, finding_id
// `open-semantic-discovery@2026-10-13T01:10:43.215Z#2`).
//
// `taskStatusAllowsOver90m` used to compare the task file's `status` against the literal
// `"in-progress"` — a value NO writer stores as a task status (goal-driver.ts's `in-progress` is the
// unrelated `GapState` enum) and not a member of the single-source lifecycle vocabulary
// (`task-status.ts` TASK_STATUSES = todo|ready|done|needs-human|superseded). Its true-arm was
// therefore UNREACHABLE for every real task file: the gate could only fire through its absent-file
// fallback, so the over-90m preemption criterion that consumed it
// (`supervisor-preempt-candidates.ts`'s `.filter(... taskStatusAllowsOver90m ...)`) was permanently
// off for every task carrying a valid lifecycle word.
//
// AC0 settlement (Plan B — retire with justification): NO currently-running mechanism invokes the
// candidate check or `supervisor-preempt.sh` in production — no systemd unit or timer names preempt,
// `crontab -l` is empty, no orchestration / manager-tick step calls it, no recorded invocation exists
// in any session transcript, and the preemption ledger `.quay/supervisor-preempt-ledger.jsonl` is
// absent. It was reachable only through the `quay-deliver` grouped entry point, on demand. The
// capability catalog's "每轮" claim for both files was therefore FALSE and has been corrected to
// "按需" (plugin/scripts/capability-catalog-declarations.json).
//
// The literal is corrected rather than deleted: the gate's mid-flight set is now DERIVED from
// TASK_STATUSES (`MID_FLIGHT_TASK_STATUSES` — empty by construction), so an out-of-vocabulary word
// can never again masquerade as a working branch, and the gate revives automatically if the
// vocabulary ever gains a word meaning "executing". See the function's own doc-block below.
//
// This file was originally a pure migration; that is no longer true of `taskStatusAllowsOver90m`.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFrontmatter } from "./gate-script-base.ts";
import { isBranchMerged } from "./fast-mode-telemetry.ts";
import { TASK_STATUSES } from "./task-status.ts";

/**
 * Task budget in ms — 90 minutes, matching the tick file's 判断边界 table ("任务超 90 分钟").
 * A task in-progress longer than this is a mechanically-detectable stop-and-wait condition: the
 * tick MUST abort the subagent and wait for a ruling (no inner retry).
 */
export const TASK_OVER_90M_MS = 90 * 60 * 1000;

/**
 * Whether the task's work has a durable merge record in git history — a merge commit whose message
 * names `task/<taskId>` (e.g. `Merge branch 'task/<taskId>'`). This survives `git branch -d` after
 * fan-in, which `isBranchMerged` alone does NOT (that helper requires the branch ref to still exist).
 * Any git failure → false (never a positive "landed" signal from an unavailable source).
 * @param {string} root
 * @param {string} taskId
 * @returns {boolean}
 */
export function hasMergeRecord(root, taskId) {
  const branch = `task/${taskId}`;
  try {
    const out = execFileSync("git", ["-C", root, "log", "--all", "--format=%H", "--merges", "--grep", branch], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The over-90m executor probe (gap-telemetry-brackets-vs-subagents-no-slot-visibility, AC8).
 * CONSERVATIVE, fail-closed toward KEEP (fire over-90m): a bracket is closed as "work landed" ONLY
 * on positive evidence of a merge — either the live branch ref merged into HEAD (`isBranchMerged`)
 * or a durable merge record names the branch (`hasMergeRecord`, survives fan-in branch deletion).
 * This is deliberately NARROWER than --reconcile's `makeDefaultExecutorGone`: a crash leftover whose
 * worktree is gone but whose branch was never merged is still a legitimate over-90m candidate
 * (abort + needs-human), and `--reconcile` closes it separately. The false-positive class this
 * removes is the one the manager measured — a task whose work ALREADY landed (fan-in merged) but
 * whose `--task-end` was never written, so the stale bracket sat in inProgress and fired a fake
 * over-90m that froze inner for 44+48 minutes.
 * @param {string} root
 * @returns {(rec: {taskId: string}) => {gone: boolean, reason: string}}
 */
export function makeOver90ExecutorGone(root) {
  return (rec) => {
    if (isBranchMerged(root, rec.taskId)) return { gone: true, reason: "branch-merged" };
    if (hasMergeRecord(root, rec.taskId)) return { gone: true, reason: "merge-record" };
    return { gone: false, reason: "no-positive-done-evidence" };
  };
}

/**
 * Read the task file's `status` frontmatter field for a task id, under `<root>/tasks/<id>.md`.
 * A task file is `---` YAML frontmatter + markdown body; `status` is a scalar line
 * (e.g. `status: in-progress`). Returns null when the task file is absent or has no status.
 * @param {string} root
 * @param {string} taskId
 * @returns {string | null}
 */
export function readTaskStatus(root, taskId) {
  try {
    const fm = readFrontmatter(path.join(root, "tasks", `${taskId}.md`));
    return fm?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * The one lifecycle word that WOULD mean "executing". Named (rather than inlined) so the derivation
 * below reads as a vocabulary QUERY, and exported so the reachability fact is testable: this word is
 * deliberately NOT added to TASK_STATUSES, because doing so would need a writer that stores it — and
 * under worker-driver there is none (see MID_FLIGHT_TASK_STATUSES).
 */
export const MID_FLIGHT_STATUS_WORD = "in-progress";

/**
 * The task statuses that mean "a worker is EXECUTING this task right now", drawn from the single
 * source of the lifecycle vocabulary (`task-status.ts` TASK_STATUSES, lockstepped with
 * `packages/quay/src/abi.ts`).
 *
 * ⛔ EMPTY BY CONSTRUCTION — and that emptiness IS the finding
 * `open-semantic-discovery@2026-10-13T01:10:43.215Z#2` (independently re-verified, AC0 below).
 * TASK_STATUSES is `['todo','ready','done','needs-human','superseded']` — **no member denotes
 * "currently executing"**. The worker-driver architecture leaves a dispatched task at `ready` for
 * the ENTIRE duration of its worker session (it flips only at the end, to `done`/`needs-human`), so
 * the task-status field cannot distinguish "a worker is running this task" from "this task is idle".
 *
 * The previous implementation compared against the literal `"in-progress"` — a value no writer ever
 * stores as a task status (goal-driver.ts's `in-progress` is the unrelated `GapState` enum) and not a
 * member of the vocabulary, so its true-arm was **unreachable for every real task file**: the gate
 * could only ever fire through the absent-file fallback below, and the over-90m preemption path it
 * gated was permanently off for every task carrying a valid lifecycle word.
 *
 * DERIVED from TASK_STATUSES rather than written as a literal, so the two can never drift again: if
 * the vocabulary ever gains a word meaning "executing", this gate revives automatically — which is
 * what "internally correct if ever revived" requires (AC2/Plan B).
 */
export const MID_FLIGHT_TASK_STATUSES: ReadonlySet<string> = new Set(
  TASK_STATUSES.filter((s) => s === MID_FLIGHT_STATUS_WORD),
);

/**
 * The task-status gate for over-90m (gap-over-90m-false-signal-source-reads-telemetry-not-task-status).
 *
 * `detectTaskOver90m` reads TELEMETRY brackets (a `--task-start` without `--task-end`), never the
 * task's OWN status. A crash leaves the bracket permanently open, so a task whose executor is long
 * gone keeps showing in-progress and fires a FALSE over-90m — the manager measured three in one night
 * (48m/27m/this one, all phantom in-flight: dead process, 0-commit worktree, status=ready). The
 * bracket says WHEN it started; only the task's real status says WHETHER it is running.
 *
 * This gate is meant to let over-90m fire ONLY when the task file's status is genuinely mid-flight. A
 * task whose file says `ready` / `done` / `needs-human` is NOT mid-flight and must not trigger — that
 * is tonight's false-signal class (os-anchor: status=ready + stale timeout bracket). A MISSING task
 * file returns TRUE (fire): the bracket is then the only signal, and over-90m is the designed safety
 * net for a genuinely orphaned in-progress task (fail-closed toward KEEP/fire — AC2, "任务文件缺失时按
 * bracket 继续").
 *
 * ⛔ RETIRED (AC0, 2026-10-13 — gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-
 * status-fix-or-retire). The predicate is answered from MID_FLIGHT_TASK_STATUSES, which is EMPTY, so
 * no task file carrying a legal status can ever fire this gate: the ONLY surviving fire arm is the
 * absent-file fallback. That is not a regression to be repaired here — it is the honest state, and it
 * is why the whole over-90m preemption consumer chain (`supervisor-preempt-candidates.ts`, and
 * `inner-blocked-signal.ts`'s `--detect-stop` over-90m face) is marked retired in ITS own header.
 * AC0 established no currently-running mechanism invokes either: no systemd unit/timer, no crontab,
 * no orchestration/manger-tick doc step, no recorded session invocation, and no preemption ledger
 * (`.quay/supervisor-preempt-ledger.jsonl` is absent) — the capability catalog's "每轮" claim was
 * false and has been corrected to "按需".
 *
 * This makes NO behavioral promise about production firing (AC2/Plan B): if a future architecture
 * gives a legal status the meaning "executing", add that word to MID_FLIGHT_TASK_STATUSES's source
 * vocabulary and this gate revives with no other change.
 *
 * @param {string} root
 * @param {string} taskId
 * @returns {boolean} true ⇒ over-90m may fire (the status field is absent or carries no legal
 *   lifecycle word); false ⇒ a legal status answered, and no legal word means "executing".
 */
export function taskStatusAllowsOver90m(root, taskId) {
  const status = readTaskStatus(root, taskId);
  if (status === null) return true; // no task file ⇒ bracket is the only signal (fail-closed toward fire)
  return MID_FLIGHT_TASK_STATUSES.has(status);
}
