#!/usr/bin/env node
// fan-in-runid-check.ts — gap-task-telemetry-6-percent-join: mechanical checker that a fan-in merge
// commit carries a `runId:` so the telemetry taskId → git branch join is traceable.
//
// THE 6%-JOIN DEFECT (manager 2026-08-12 021354 实测): task-landing records (git `merge: fan-in
// task/<id>` commits) and telemetry records (`.workflow-events/<runId>.jsonl`) were almost disjoint
// (139 git task names vs 152 telemetry taskIds, join 9 = 6%). No mechanical path from a telemetry
// taskId to its git branch, and no mechanical path from a landed task to how long it ran.
//
// THE FIX THIS CHECKER VERIFIES: the fan-in merge commit message carries the runId the inner's
// `--task-start` generated — `merge: fan-in task/<id> (runId: fm-...)` — so:
//   telemetry taskId → runId (the bracket) → the fan-in commit (subject `(runId: <r>)`) → git branch
// and conversely a fan-in commit's runId → the telemetry record (`.workflow-events/<runId>.jsonl`).
//
// Contract (task body):
//   measure   fanin_runid_present = `git log -1 --format=%s <最新 fan-in merge>` 的 stdout 是否含 `runId:`
//   band      fanin_runid_present = true（新 fan-in 提交带 runId）
//   invariant telemetry_traceable = 1（遥测 taskId → git 分支机械可回溯）
//   invoke    `git log --oneline -3 | grep -E 'fan-in.*runId'`
//   control   fan-in 带 runId；回溯可达；既有不回归
//
// MODES:
//   default — scan `--ref` (default HEAD) for the LATEST fan-in merge commit (subject matching
//             `/fan-in/i`) and assert its subject contains `runId:`. Exit 0 iff present.
//   --commit <sha> — check ONE commit's subject instead of scanning (deterministic test surface).
//   --taskId <id> — additionally verify TRACEABILITY: the fan-in commit's runId resolves to a
//             telemetry event file that references taskId (the invariant telemetry_traceable = 1).
//   --run-id <r> — additionally require the fan-in commit's runId to EQUAL this expected value.
//   --json    — machine-readable output (the ## Contract measure reads `fanin_runid_present`).
//
// Exit codes: 0 = PASS; 1 = FAIL (fan-in commit without runId, or traceability broken);
//             2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { findRepoRoot } from "./fast-mode-telemetry.ts";

/** A subject that identifies a fan-in merge commit (the `merge: fan-in task/<id> …` family). */
export const FAN_IN_SUBJECT_RE = /fan-in/i;
/** A runId carried in the fan-in merge message: `(runId: fm-…)` — parsed by POSITION, not keyword. */
export const RUN_ID_POSITION_RE = /\(runId:\s*([^)\s]+)\)/;
/** runId is used verbatim as a `.workflow-events/<runId>.jsonl` path component. */
const RUN_ID_SAFE_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Extract the runId from a fan-in commit subject (`merge: fan-in task/<id> (runId: fm-…)`), or null.
 * Position-based: the `(runId: <r>)` segment — a bare mention of "runId" elsewhere in the subject is
 * not a carried id (hard rule: 按位置判定, not by keyword).
 * @param {string|null|undefined} subject
 * @returns {string|null}
 */
export function parseRunId(subject) {
  const m = RUN_ID_POSITION_RE.exec(subject ?? "");
  return m ? m[1] : null;
}

/**
 * Resolve the LATEST fan-in merge commit on `ref`: the most recent commit whose subject matches
 * `/fan-in/i`. Returns `{ sha, subject }` or null when none exists (no git / no fan-in commit).
 * @param {string} root
 * @param {string} [ref]
 * @returns {{sha:string, subject:string}|null}
 */
export function latestFanInCommit(root, ref = "HEAD") {
  try {
    // `--grep=fan-in` pre-filters so the output is only fan-in commits (the real repo's full log
    // exceeds execFileSync's 1MB default maxBuffer — ENOBUFS without the grep AND a raised buffer).
    const out = execFileSync("git", ["-C", root, "log", ref, "-i", "--format=%H%x00%s", "--grep=fan-in"], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.trimEnd().split("\n")) {
      if (!line) continue;
      const idx = line.indexOf("\0");
      const sha = idx === -1 ? line : line.slice(0, idx);
      const subject = idx === -1 ? "" : line.slice(idx + 1);
      if (FAN_IN_SUBJECT_RE.test(subject)) return { sha, subject };
    }
  } catch (_) { /* no git / ref absent — fail-soft to null */ }
  return null;
}

/**
 * One commit's subject. Returns null when the commit does not resolve.
 * @param {string} root
 * @param {string} ref
 * @returns {string|null}
 */
export function commitSubject(root, ref) {
  try {
    const out = execFileSync("git", ["-C", root, "log", "-1", ref, "--format=%s"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch (_) {
    return null;
  }
}

/**
 * Whether the telemetry store has an event file for a runId (the runId → telemetry direction of the
 * traceability link). Fail-soft: any fs failure → false.
 * @param {string} root
 * @param {string|null} runId
 * @returns {boolean}
 */
export function telemetryHasRunId(root, runId) {
  if (!runId || !RUN_ID_SAFE_RE.test(runId)) return false;
  try {
    return fs.existsSync(path.join(root, ".workflow-events", `${runId}.jsonl`));
  } catch (_) {
    return false;
  }
}

/**
 * Whether the telemetry event file for a runId references the given taskId (the taskId → runId →
 * git direction of the traceability link). Reads the runId's `.workflow-events/<runId>.jsonl` and
 * checks any event's taskId. Fail-soft: unreadable/missing → false.
 * @param {string} root
 * @param {string|null} runId
 * @param {string} taskId
 * @returns {boolean}
 */
export function telemetryRunIdForTask(root, runId, taskId) {
  if (!runId || !RUN_ID_SAFE_RE.test(runId) || !taskId) return false;
  try {
    const p = path.join(root, ".workflow-events", `${runId}.jsonl`);
    if (!fs.existsSync(p)) return false;
    const lines = fs.readFileSync(p, "utf8").split("\n");
    return lines.some((l) => {
      if (!l.trim()) return false;
      try {
        const e = JSON.parse(l);
        return e && String(e.taskId) === String(taskId);
      } catch {
        return false;
      }
    });
  } catch (_) {
    return false;
  }
}

/**
 * Judge ONE fan-in subject: does it carry a `runId:` (the measure fanin_runid_present)?
 * @param {string|null} subject
 * @returns {{present:boolean, runId:string|null}}
 */
export function checkFanInSubject(subject) {
  const runId = parseRunId(subject);
  return { present: runId != null, runId };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

function usage() {
  process.stderr.write(`fan-in-runid-check.ts — fan-in merge commits must carry a runId (gap-task-telemetry-6-percent-join)

Usage:
  node --experimental-strip-types fan-in-runid-check.ts [--root <dir>] [--ref <ref>] [--commit <sha>]
                                    [--taskId <id>] [--run-id <r>] [--json]

  default   scan --ref (default HEAD) for the latest fan-in merge commit; exit 0 iff its subject
            contains \`runId:\` (the Contract measure fanin_runid_present).
  --commit <sha>   check ONE commit's subject instead of scanning (deterministic test surface).
  --taskId <id>    also verify telemetry_traceable=1: the fan-in commit's runId resolves to a
                   .workflow-events/<runId>.jsonl that references the taskId.
  --run-id <r>     also require the fan-in commit's runId to equal this expected value.
  --json           machine-readable output ({ fanin_runid_present, faninRunId, telemetry_traceable,
                   commit, subject }).
Exit: 0 = PASS; 1 = FAIL; 2 = usage/env error.
`);
}

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 2;
  }
  const get = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const root = get("--root") ?? findRepoRoot();
  const ref = get("--ref") ?? "HEAD";
  const commitArg = get("--commit");
  const taskId = get("--taskId");
  const expectedRunId = get("--run-id");
  const jsonOut = args.includes("--json");

  // Resolve the target fan-in commit: explicit --commit, else the latest fan-in merge on the ref.
  let sha = null;
  let subject = null;
  if (commitArg) {
    sha = commitArg;
    subject = commitSubject(root, commitArg);
  } else {
    const latest = latestFanInCommit(root, ref);
    if (latest) {
      sha = latest.sha;
      subject = latest.subject;
    }
  }

  if (!sha || subject == null) {
    if (jsonOut) {
      console.log(JSON.stringify({ fanin_runid_present: false, faninRunId: null, telemetry_traceable: false, commit: sha, subject: null, error: "no fan-in merge commit found" }, null, 2));
    } else {
      console.log(`fan-in-runid-check: measure fanin_runid_present=unknown (no fan-in merge commit found on ${ref}${commitArg ? ` at ${commitArg}` : ""})`);
      console.log(`fan-in-runid-check: FAIL — no fan-in merge commit to verify; nothing moved`);
    }
    return 1;
  }

  const { present, runId } = checkFanInSubject(subject);
  let telemetryTraceable = false;
  let expectedMatches = expectedRunId == null ? true : runId === expectedRunId;

  if (present && runId) {
    // The runId → telemetry direction of the traceability link: the runId's event file must exist.
    if (telemetryHasRunId(root, runId)) {
      // The taskId → runId direction: the runId's events must reference the taskId (when given).
      telemetryTraceable = taskId == null ? true : telemetryRunIdForTask(root, runId, taskId);
    }
  }

  const pass = present && expectedMatches && (taskId == null ? present : telemetryTraceable);

  if (jsonOut) {
    console.log(JSON.stringify({
      fanin_runid_present: present,
      faninRunId: runId,
      expectedRunIdMatches: expectedMatches,
      telemetry_traceable: telemetryTraceable,
      commit: sha,
      subject,
    }, null, 2));
  } else {
    console.log(`fan-in-runid-check: measure fanin_runid_present=${present}`);
    console.log(`fan-in-runid-check:   fan-in merge ${sha.slice(0, 12)} — ${subject}`);
    if (present) {
      console.log(`fan-in-runid-check:   runId ${runId}`);
      if (expectedRunId != null) {
        console.log(`fan-in-runid-check:   expected runId ${expectedRunId} matches: ${expectedMatches ? "YES" : "NO"}`);
      }
      if (taskId != null) {
        console.log(`fan-in-runid-check: measure telemetry_traceable=${telemetryTraceable}`);
        console.log(`fan-in-runid-check:   telemetry ${telemetryTraceable ? "traceable" : "NOT traceable"} — taskId ${taskId} → runId ${runId} ${telemetryTraceable ? "resolves" : "does NOT resolve"} to a telemetry record`);
      }
    } else {
      console.log(`fan-in-runid-check: FAIL — fan-in merge commit does NOT carry a runId: (the 6%-join fix requires every new fan-in commit to embed \`(runId: fm-...)\`)`);
    }
  }

  return pass ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-runid-check")) {
  process.exit(main(process.argv));
}
