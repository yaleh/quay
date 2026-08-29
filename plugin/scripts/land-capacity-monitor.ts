// land-capacity-monitor.ts — AC149-2 land 速率产能监测 (gap-ac149-session-retirement-no-dual-source-no-throughput-collapse).
//
// Criterion (manager-phase-goal.md ### AC149, verbatim):
//   AC149-2（产能不塌，⛔ 这是真判据不是仪式）: 停会话后连续 ≥24h，任务持续 land（develop 上有新的
//   fan-in 合并提交），且速率不低于停机前同长度窗口的 X%（X 落笔方定，⛔ manager 不设未测量过的阈值
//   —— 硬规则④推论一）。取假：停机后 land 速率归零或断崖 ⇒ 假，回滚。
//
// Mechanism:
//   This is a MEASUREMENT tool, not a threshold gate. It reads `git log` on develop and reports the
//   land rate (fan-in merge commits per hour) for a pre-stop window and a post-stop window, plus the
//   ratio. The only mechanical "能取假" signal is 归零 (collapse): post-stop rate is ZERO while the
//   pre-stop rate was non-zero — that is a hard rollback signal, not a threshold. A "断崖" (cliff,
//   a large but non-zero drop) is REPORTED as a ratio for a human to judge — a numeric X% is
//   deliberately NOT hardcoded (硬规则④推论一: never set a numeric threshold before measuring the
//   cost structure; the pre-stop distribution is the baseline, not a constant).
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/land-capacity-monitor.ts --root <repo>
//     [--before <YYYY-MM-DDTHH:MM:SS>] [--window-hours 24] [--json]
//   --before        the stop boundary (default: now); pre = before-w .. before, post = before .. before+w
//                   (same-length windows — AC149-2 「同长度窗口」; post truncates at now if < w elapsed ⇒ probe)
//   --window-hours  hours per window (default 24; a window shorter than 24h is a probe, not a verdict)

import { execFileSync } from "node:child_process";

export interface Commit {
  hash: string;
  subject: string;
  date: string; // ISO
}

export interface WindowReport {
  commits: number;
  hours: number;
  ratePerHour: number;
}

export interface MonitorResult {
  pre: WindowReport;
  post: WindowReport;
  ratio: number | null;      // post / pre; null when pre === 0 (nothing to compare against)
  collapse: boolean;          // post rate is zero while pre rate was non-zero — the hard 归零 signal
}

// ── git log: commits on <ref> (default develop) within [since, until) ─────────────────────────────
export function listCommits(root: string, since: string, until: string, ref = "develop"): Commit[] {
  const args = ["-C", root, "log", ref, "--since", since, "--until", until, "--pretty=format:%H%x1f%s%x1f%aI"];
  let out = "";
  try {
    out = execFileSync("git", args, { encoding: "utf8" });
  } catch {
    // A missing ref (e.g. develop not checked out) yields no commits, not a crash.
    out = "";
  }
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [hash, subject, date] = l.split("\x1f");
      return { hash, subject, date };
    });
}

export function ratePerHour(commits: number, hours: number): number {
  if (hours <= 0) return 0;
  return commits / hours;
}

export function buildReport(commits: Commit[], hours: number): WindowReport {
  return { commits: commits.length, hours, ratePerHour: ratePerHour(commits.length, hours) };
}

// ── compare: the only hard signal is 归零 (collapse); a non-zero drop is a ratio, not a verdict ───
export function compareWindows(pre: WindowReport, post: WindowReport): MonitorResult {
  const ratio = pre.ratePerHour > 0 ? post.ratePerHour / pre.ratePerHour : null;
  const collapse = pre.ratePerHour > 0 && post.ratePerHour === 0;
  return { pre, post, ratio, collapse };
}

export function runMonitor(root: string, before: string, windowHours: number): MonitorResult {
  // Same-length windows on both sides of the stop boundary (AC149-2 「同长度窗口」):
  // pre = [before - w, before] and post = [before, before + w]. When less than w has elapsed since
  // the stop, git log --until <future> naturally truncates post to [before, now] (the probe case).
  const beforeMs = new Date(before).getTime();
  const sincePre = new Date(beforeMs - windowHours * 3600_000).toISOString();
  const untilPre = before;
  const sincePost = before;
  const untilPost = new Date(beforeMs + windowHours * 3600_000).toISOString();
  const pre = buildReport(listCommits(root, sincePre, untilPre), windowHours);
  const post = buildReport(listCommits(root, sincePost, untilPost), windowHours);
  return compareWindows(pre, post);
}

function parseArgs(argv: string[]): { root: string; before: string; windowHours: number; json: boolean } {
  let root = process.cwd();
  let before = new Date(Date.now()).toISOString();
  let windowHours = 24;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) { root = argv[i + 1]; i++; }
    else if (argv[i] === "--before" && argv[i + 1]) { before = argv[i + 1]; i++; }
    else if (argv[i] === "--window-hours" && argv[i + 1]) { windowHours = Number(argv[i + 1]); i++; }
    else if (argv[i] === "--json") { json = true; }
  }
  return { root, before, windowHours, json };
}

function main() {
  const { root, before, windowHours, json } = parseArgs(process.argv.slice(2));
  const result = runMonitor(root, before, windowHours);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`land-capacity-monitor: pre=${result.pre.commits} commit(s) / ${result.pre.hours}h (${result.pre.ratePerHour.toFixed(3)}/h) · post=${result.post.commits} commit(s) / ${result.post.hours}h (${result.post.ratePerHour.toFixed(3)}/h) · ratio=${result.ratio === null ? "n/a (pre=0)" : result.ratio.toFixed(2)}`);
  }
  // 归零 (collapse) is the one hard mechanical signal, exit-non-zero in BOTH modes; a non-zero drop
  // is a ratio to judge, not an exit-code verdict (硬规则④推论一).
  if (result.collapse) {
    console.error("land-capacity-monitor: COLLAPSE — post-stop land rate is ZERO while pre-stop was non-zero (AC149-2 归零 ⇒ 回滚)");
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
