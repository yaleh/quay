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

import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFrontmatter } from "./gate-script-base.ts";
import { isBranchMerged } from "./fast-mode-telemetry.ts";

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
 * The task-status gate for over-90m (gap-over-90m-false-signal-source-reads-telemetry-not-task-status).
 *
 * `detectTaskOver90m` reads TELEMETRY brackets (a `--task-start` without `--task-end`), never the
 * task's OWN status. A crash leaves the bracket permanently open, so a task whose executor is long
 * gone keeps showing in-progress and fires a FALSE over-90m — the manager measured three in one night
 * (48m/27m/this one, all phantom in-flight: dead process, 0-commit worktree, status=ready). The
 * bracket says WHEN it started; only the task's real status says WHETHER it is running.
 *
 * This gate lets over-90m fire ONLY when the task file's status is genuinely `in-progress`. A task
 * whose file says `ready` / `done` / `needs-human` (or any non-in-progress value) is NOT mid-flight
 * and must not trigger — that is tonight's false-signal class (os-anchor: status=ready + stale
 * timeout bracket). A MISSING task file returns TRUE (fire): the bracket is then the only signal, and
 * over-90m is the designed safety net for a genuinely orphaned in-progress task (fail-closed toward
 * KEEP/fire — AC2, "任务文件缺失时按 bracket 继续").
 *
 * @param {string} root
 * @param {string} taskId
 * @returns {boolean} true ⇒ over-90m may fire; false ⇒ the task's own status says it is not in-progress.
 */
export function taskStatusAllowsOver90m(root, taskId) {
  const status = readTaskStatus(root, taskId);
  if (status === null) return true; // no task file ⇒ bracket is the only signal (fail-closed toward fire)
  return status === "in-progress";
}
