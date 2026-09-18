#!/usr/bin/env node
// fan-in-runid-check.ts — gap-task-telemetry-6-percent-join: fan-in runId EXISTENCE + TRACEABILITY checker.
//
// The defect: task landing records (git fan-in merge commits) and telemetry records were only 6%
// joinable (manager 2026-08-12 021354: git 139 fan-in names vs telemetry 152 taskIds, intersection
// 9). The bridge: a fan-in commit subject carries the telemetry runId at a FIXED position —
// `merge: fan-in task/<id> (runId: fm-...)` — so the two record sets join on the runId. This
// checker makes the Contract measure mechanical:
//   measure   fanin_runid_present = `git log -1 --format=%s <最新 fan-in merge>` 的 stdout 是否含 `runId:`
//   band      fanin_runid_present = true（新 fan-in 提交带 runId）
//   invariant telemetry_traceable = 1（遥测 taskId → git 分支机械可回溯）
// i.e. it inspects the fan-in merge commit(s) and reports whether their subject carries a runId,
// and (with --taskId/--task) whether that runId resolves back to a telemetry record for the task.
//
// MODES:
//   default — scan the repo for the LATEST fan-in merge commit and assert its subject carries a
//             runId (Contract measure surface). --ref <ref> narrows the scan (default HEAD);
//             --all is used when neither --commit nor --ref is given (robust latest-overall).
//   --task <taskId>      — the latest fan-in merge for THAT specific task (our AC3 surface).
//   --commit <sha>       — check ONE commit's subject instead of scanning (deterministic surface).
//   --taskId <id>        — additionally verify TRACEABILITY: the fan-in commit's runId resolves to
//                          a .workflow-events/<runId>.jsonl that references taskId (invariant).
//   --run-id <r>         — additionally require the fan-in commit's runId to EQUAL this value.
//   --json               — machine-readable output (the ## Contract measure reads `fanin_runid_present`).
//
// Exit 0 = PASS; 1 = FAIL (no runId, or traceability broken); 2 = usage/env error.
//
// Pure read — never writes a file, never moves a ref.

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { extractRunIdFromCommitSubject, findFanInCommitSha } from "./fast-mode-telemetry.ts";

/** A subject that identifies a fan-in merge commit (the `merge: fan-in task/<id> …` family). */
export const FAN_IN_SUBJECT_RE = /fan-in/i;
/** A runId carried in the fan-in merge message: `(runId: fm-…)` — parsed by POSITION, not keyword. */
export const RUN_ID_POSITION_RE = /\(runId:\s*([^)\s]+)\)/;
/** runId is used verbatim as a `.workflow-events/<runId>.jsonl` path component. */
const RUN_ID_SAFE_RE = /^[A-Za-z0-9._-]+$/;

// ── Repo-root detection ──────────────────────────────────────────────────────────────────────────────

function resolveRoot(rootArg) {
  if (rootArg) return path.resolve(rootArg);
  return repoRoot(path.dirname(fileURLToPath(import.meta.url)));
}

// ── Fan-in commit discovery ──────────────────────────────────────────────────────────────────────────

/**
 * The latest fan-in merge commit overall (the Contract measure surface): the newest merge commit
 * whose subject mentions the fan-in convention. Searches ALL refs (robust even when HEAD is not the
 * integration branch). Returns the full commit sha, or null when none exists (no fan-in ever landed /
 * git unavailable).
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
 * One commit's subject (`git log -1 --format=%s <sha-or-ref>`), or null on any failure. Works with a
 * sha or a ref name (a sha is a valid rev).
 * @param {string} root
 * @param {string} shaOrRef
 * @returns {string|null}
 */
export function commitSubject(root, shaOrRef) {
  try {
    const out = execFileSync("git", ["-C", root, "log", "-1", "--format=%s", shaOrRef], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// ── Pure verdicts ─────────────────────────────────────────────────────────────────────────────────────

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
 * Judge ONE fan-in subject: does it carry a `runId:` (the measure fanin_runid_present)?
 * @param {string|null} subject
 * @returns {{present:boolean, runId:string|null}}
 */
export function checkFanInSubject(subject) {
  const runId = parseRunId(subject);
  return { present: runId != null, runId };
}

// ── Telemetry traceability (AC3 invariant telemetry_traceable=1) ─────────────────────────────────────

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

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

const usage = `fan-in-runid-check.ts — fan-in runId existence + traceability checker (gap-task-telemetry-6-percent-join)

Usage:
  node --experimental-strip-types fan-in-runid-check.ts [--root <dir>] [--task <taskId> | --taskId <id>] [--commit <sha>] [--ref <ref>] [--run-id <r>] [--json]

Checks whether the fan-in merge commit under inspection carries a telemetry runId at the fixed
position-parseable location — "merge: fan-in task/<id> (runId: fm-...)" — the bridge that makes
task landing records (git) and telemetry records joinable (the 6% join-rate defect).

  --root <dir>    repo root (default: auto-derived from this script's location)
  --task <id>     check the latest fan-in merge for THIS task (our AC3 surface)
  --taskId <id>   also verify telemetry_traceable=1: the runId resolves to a telemetry record for id
  --commit <sha>  check ONE commit's subject instead of scanning (deterministic test surface)
  --ref <ref>     ref to scan for the latest fan-in merge (default HEAD when --commit absent)
  --run-id <r>    also require the fan-in commit's runId to equal this expected value
  --json          machine-readable output
  --help          this help

Exit 0 = the inspected fan-in commit carries a runId (band fanin_runid_present=true);
exit 1 = it does not, or no fan-in commit was found (fail-closed — a missing fan-in is not a pass);
exit 2 = usage/env error.`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = resolveRoot(flagValue(args, "--root"));
  const ourTask = flagValue(args, "--task");
  const commitArg = flagValue(args, "--commit");
  const vhsTaskId = flagValue(args, "--taskId");
  const expectedRunId = flagValue(args, "--run-id");
  const ref = flagValue(args, "--ref") ?? "HEAD";
  const jsonOut = args.includes("--json");

  // ── OUR --task mode: the latest fan-in merge for that specific task (AC3 surface) ──
  if (ourTask != null) {
    const sha = findFanInCommitSha(root, ourTask);
    const subject = sha ? commitSubject(root, sha) : null;
    const result = checkRunIdPresence(sha, subject);
    if (jsonOut) {
      console.log(JSON.stringify({
        root, task: ourTask, fanInCommitSha: result.sha, subject,
        runIdPresent: result.runIdPresent, runId: result.runId, reason: result.reason,
      }, null, 2));
    } else {
      if (!result.sha) {
        console.log(`fan-in-runid-check: NO fan-in merge commit found under ${root} for task ${ourTask}`);
      } else {
        console.log(`fan-in-runid-check: fan-in commit ${result.sha}`);
        console.log(`  subject: ${subject ?? "(unreadable)"}`);
        console.log(`  runId present: ${result.runIdPresent ? "YES" : "NO"}${result.runId ? ` (${result.runId})` : ""}`);
      }
      console.log(`fan-in-runid-check: ${result.ok ? "OK — band fanin_runid_present=true" : `FAIL — ${result.reason}`}`);
    }
    return result.ok ? 0 : 1;
  }

  // ── VHS / default mode: scan or --commit; traceability + expected runId when asked ──
  let sha = null;
  let subject = null;
  if (commitArg) {
    sha = commitArg;
    subject = commitSubject(root, commitArg);
  } else if (ref && ref !== "ALL" && ref !== "--all") {
    const latest = latestFanInCommit(root, ref);
    if (latest) { sha = latest.sha; subject = latest.subject; }
  }
  if (!sha) {
    // fall back to the robust latest-overall (--all) when no --commit/--ref explicitly narrowed
    const latestSha = findLatestFanInCommit(root);
    if (latestSha) {
      sha = latestSha;
      subject = commitSubject(root, latestSha);
    }
  }

  if (!sha || subject == null) {
    const out = { fanin_runid_present: false, faninRunId: null, telemetry_traceable: false, commit: sha, subject: null, error: "no fan-in merge commit found" };
    if (jsonOut) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`fan-in-runid-check: measure fanin_runid_present=false`);
      console.log(`fan-in-runid-check: FAIL — no fan-in merge commit to verify; nothing moved`);
    }
    return 1;
  }

  const { present, runId } = checkFanInSubject(subject);
  let telemetryTraceable = false;
  const expectedMatches = expectedRunId == null ? true : runId === expectedRunId;

  if (present && runId) {
    if (telemetryHasRunId(root, runId)) {
      telemetryTraceable = vhsTaskId == null ? true : telemetryRunIdForTask(root, runId, vhsTaskId);
    }
  }

  const pass = present && expectedMatches && (vhsTaskId == null ? true : telemetryTraceable);

  if (jsonOut) {
    console.log(JSON.stringify({
      fanin_runid_present: present,
      faninRunId: runId,
      expectedRunIdMatches: expectedMatches,
      telemetry_traceable: telemetryTraceable,
      commit: sha,
      subject,
      // integration-side shape — also carried in default mode (runIdPresent / runId / reason / fanInCommitSha)
      fanInCommitSha: sha,
      runIdPresent: present,
      runId,
      reason: present ? "runId-present" : "fan-in-subject-missing-runId",
    }, null, 2));
  } else {
    console.log(`fan-in-runid-check: measure fanin_runid_present=${present}`);
    console.log(`fan-in-runid-check:   fan-in merge ${sha.slice(0, 12)} — ${subject}`);
    console.log(`fan-in-runid-check:   runId present: ${present ? "YES" : "NO"}${present && runId ? ` (${runId})` : ""}`);
    if (present) {
      console.log(`fan-in-runid-check:   runId ${runId}`);
      if (expectedRunId != null) {
        console.log(`fan-in-runid-check:   expected runId ${expectedRunId} matches: ${expectedMatches ? "YES" : "NO"}`);
      }
      if (vhsTaskId != null) {
        console.log(`fan-in-runid-check: measure telemetry_traceable=${telemetryTraceable}`);
        console.log(`fan-in-runid-check:   telemetry ${telemetryTraceable ? "traceable" : "NOT traceable"} — taskId ${vhsTaskId} → runId ${runId} ${telemetryTraceable ? "resolves" : "does NOT resolve"} to a telemetry record`);
      }
    } else {
      console.log(`fan-in-runid-check: FAIL — fan-in merge commit does NOT carry a runId: (the 6%-join fix requires every new fan-in commit to embed \`(runId: fm-...)\`)`);
    }
    console.log(`fan-in-runid-check: ${pass ? "OK — band fanin_runid_present=true" : `FAIL — ${present ? (expectedMatches ? "telemetry-not-traceable" : "run-id-mismatch") : "fan-in-subject-missing-runId"}`}`);
  }

  return pass ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-runid-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
