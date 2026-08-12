// fan-in-runid-check.ts — gap-task-telemetry-6-percent-join: fan-in runId EXISTENCE checker.
//
// The defect: task landing records (git fan-in merge commits) and telemetry records were only 6%
// joinable (manager 2026-08-12 021354: git 139 fan-in names vs telemetry 152 taskIds, intersection
// 9). The bridge: a fan-in commit subject carries the telemetry runId at a FIXED position —
// `merge: fan-in task/<id> (runId: fm-...)` — so the two record sets join on the runId. This
// checker makes the Contract measure mechanical:
//   measure   fanin_runid_present = `git log -1 --format=%s <最新 fan-in merge>` 的 stdout 是否含 `runId:`
//   band      fanin_runid_present = true（新 fan-in 提交带 runId）
// i.e. it inspects the fan-in merge commit(s) and reports whether their subject carries a runId.
//
// Usage:
//   node --experimental-strip-types fan-in-runid-check.ts [--root <dir>] [--task <taskId>] [--json]
// Exit 0 = the inspected fan-in commit carries a runId (band satisfied); 1 = it does not, or no
// fan-in commit was found (fail-closed — a missing fan-in is not a "present" pass).
//
// Default (no --task): the LATEST fan-in merge commit overall (the Contract measure surface).
// --task <taskId>: the latest fan-in merge for that specific task (AC3 traceability surface).
//
// Pure read — never writes a file, never moves a ref.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { extractRunIdFromCommitSubject, findFanInCommitSha, findRepoRoot } from "./fast-mode-telemetry.ts";

// ── Repo-root detection ──────────────────────────────────────────────────────────────────────────────

function resolveRoot(rootArg) {
  if (rootArg) return path.resolve(rootArg);
  return findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
}

// ── Fan-in commit discovery ──────────────────────────────────────────────────────────────────────────

/**
 * The latest fan-in merge commit overall (the Contract measure surface): the newest merge commit
 * whose subject mentions the fan-in convention. Returns the full commit sha, or null when none
 * exists (no fan-in ever landed / git unavailable).
 * @param {string} root
 * @returns {string|null}
 */
export function findLatestFanInCommit(root) {
  try {
    const out = execFileSync("git", ["-C", root, "log", "--all", "--merges", "--format=%H", "-1", "--grep", "fan-in"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim();
    return line || null;
  } catch {
    return null;
  }
}

/**
 * The subject of one commit (`git log -1 --format=%s <sha>`), or null on any failure.
 * @param {string} root
 * @param {string} sha
 * @returns {string|null}
 */
export function commitSubject(root, sha) {
  try {
    const out = execFileSync("git", ["-C", root, "log", "-1", "--format=%s", sha], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check whether the fan-in commit under inspection carries a runId. PURE: all observable facts are
 * resolved by the caller (sha + subject), so tests inject deterministic facts.
 * @param {string|null} sha — the fan-in commit sha under inspection (null = none found)
 * @param {string|null} subject — the commit subject (null when sha is null / unreadable)
 * @returns {{ok:boolean, runIdPresent:boolean, runId:string|null, reason:string, sha:string|null}}
 *   ok = exit-0 condition: a fan-in commit EXISTS and its subject carries a runId.
 */
export function checkRunIdPresence(sha, subject) {
  if (!sha) {
    return { ok: false, runIdPresent: false, runId: null, reason: "no-fan-in-commit", sha: null };
  }
  const runId = extractRunIdFromCommitSubject(subject);
  if (!runId) {
    return { ok: false, runIdPresent: false, runId: null, reason: "fan-in-subject-missing-runId", sha };
  }
  return { ok: true, runIdPresent: true, runId, reason: "runId-present", sha };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const usage = `fan-in-runid-check.ts — fan-in runId existence checker (gap-task-telemetry-6-percent-join)

Usage:
  node --experimental-strip-types fan-in-runid-check.ts [--root <dir>] [--task <taskId>] [--json]

Checks whether the fan-in merge commit under inspection carries a telemetry runId at the fixed
position-parseable location — "merge: fan-in task/<id> (runId: fm-...)" — the bridge that makes
task landing records (git) and telemetry records joinable (the 6% join-rate defect).

  --root <dir>    repo root (default: auto-derived from this script's location)
  --task <id>     check the latest fan-in merge for THIS task instead of the latest overall
  --json          machine-readable output
  --help          this help

Exit 0 = the inspected fan-in commit carries a runId (band fanin_runid_present=true);
exit 1 = it does not, or no fan-in commit was found (fail-closed — a missing fan-in is not a pass).`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return 0;
  }
  const root = resolveRoot(getArgValue(args, "--root"));
  const taskId = getArgValue(args, "--task");

  const sha = taskId ? findFanInCommitSha(root, taskId) : findLatestFanInCommit(root);
  const subject = sha ? commitSubject(root, sha) : null;
  const result = checkRunIdPresence(sha, subject);

  const out = {
    root,
    task: taskId ?? null,
    fanInCommitSha: result.sha,
    subject,
    runIdPresent: result.runIdPresent,
    runId: result.runId,
    reason: result.reason,
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    if (!result.sha) {
      console.log(`fan-in-runid-check: NO fan-in merge commit found under ${root}${taskId ? ` for task ${taskId}` : ""}`);
    } else {
      console.log(`fan-in-runid-check: fan-in commit ${result.sha}`);
      console.log(`  subject: ${subject ?? "(unreadable)"}`);
      console.log(`  runId present: ${result.runIdPresent ? "YES" : "NO"}${result.runId ? ` (${result.runId})` : ""}`);
    }
    console.log(`fan-in-runid-check: ${result.ok ? "OK — band fanin_runid_present=true" : `FAIL — ${result.reason}`}`);
  }
  return result.ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-runid-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
