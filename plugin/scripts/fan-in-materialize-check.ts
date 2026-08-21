#!/usr/bin/env node
// fan-in-materialize-check.ts — gap-workflow-scriptpath-materialize-falls-back-main
//
// Detects the workflow scriptPath MATERIALIZATION fallback (M176 family): when a bootstrap-HIT fan-in
// is dispatched with `scriptPath: <worktree>/.claude/workflows/fan-in-execute.js` (the A6 rule for a
// task that modified the fan-in orchestration pipeline itself), the Claude Code SDK sometimes silently
// materializes the MAIN checkout version of the script instead of the worktree version. The task's own
// modification to the pipeline is then NOT exercised by its own fan-in — bootstrap self-verification
// silently fails.
//
// This checker reads the PRODUCTION CARRIER — the materialized workflow records
// `~/.claude/projects/<slug>/<session>/workflows/wf_*.json` (written by the SDK at dispatch time with
// BOTH the passed `scriptPath` AND the materialized `script` content) — NOT a fixture. For every
// fan-in-execute dispatch whose `scriptPath` points into a task worktree (bootstrap-HIT shape), it
// verifies the materialized `script` matches the WORKTREE version. Fail-closed (RED) on fallback;
// NOT-EVALUATED when the evidence cannot decide (hard rule 3b — "cannot judge" is its own state,
// never conflated with green).
//
// ⚠️ Reconstructability limit (empirically established 2026-08-21 from the 63-record production
// corpus): the worktree's WORKING-TREE state at dispatch (including uncommitted changes) is NOT
// reconstructable after the worktree is removed. The decisive check is therefore the DIRECT
// comparison against the worktree file ON DISK (in-flight / just-fan-in'd tasks — the finding's two
// observed cases were caught this way). For GONE worktrees the checker uses the git-reconstructed
// states (see below) and is CONSERVATIVE — an intermediate/partial match is NOT-EVALUATED, never RED.
//
// Verdict per in-scope record (scriptPath basename == fan-in-execute.js AND scriptPath is a WORKTREE
// path, i.e. outside the main checkout root):
//
//   worktree file EXISTS on disk — DECISIVE:
//     materialized script == worktree file  ⇒ GREEN  (worktree-version-materialized — correct)
//     materialized script != worktree file  ⇒ RED    (fallback: main/stale version materialized)
//
//   worktree file GONE (cleaned up after a completed fan-in) — git-reconstructed states
//     (base = the fan-in fork point; fanIn = the worktree HEAD at fan-in end, first-parent = the
//     worktree HEAD at dispatch):
//     materialized == worktree@fanIn            ⇒ GREEN (final worktree state — the task's committed
//                                                    change, if any, is present)
//     materialized == worktree@dispatch-HEAD    ⇒ GREEN (dispatch-time worktree state)
//     materialized == base AND the task's OWN non-merge commits (first-parent, --no-merges) touched
//       the workflow file ⇒ RED (fallback: the materialized script equals the PRE-task version while
//       the task had committed a change to this file — the task's fix was NOT verified)
//     materialized == base AND no such task commits ⇒ GREEN (base is the correct worktree state —
//       the task did not modify this file)
//     else ⇒ NOT-EVALUATED (intermediate/partial worktree state — the worktree evolved between
//       dispatch and fan-in end via bootstrap-sync/merge-develop; cannot pin without the lost
//       working tree)
//
// Exit codes: 0 = PASS or NOT-EVALUATED (read `evaluated`), 1 = RED (a materialization fallback was
//             detected for an in-scope dispatch), 2 = usage/environment.
//
// Run:
//   node --experimental-strip-types plugin/scripts/fan-in-materialize-check.ts
//       [--root <dir>] [--project-dir <dir>] [--tasks-dir <dir>]
//       [--workflow-file <rel>] [--workflow-events-dir <dir>] [--mainline-content <file>]
//       [--mainline-ref <ref>] [--json] [--help]
//
// Wiring: scripts/test.sh run_static_checks (--root main_root, like fan-in-workflow-check — the
// materialized wf_*.json records + .workflow-events + task Touches live on the MAIN checkout, absent
// from a one-shot verify worktree; pointing --root at the main checkout makes the worktree round read
// the SAME data).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { extractSection } from "./task-schema.ts";
import { parseTouchEntriesWithTags } from "./touches-parser.ts";
import { matchesObject, FAN_IN_ORCHESTRATION_FILES } from "./select-static-checks-for-touches.ts";

/** The workflow basename this checker audits — the fan-in pipeline's own workflow file. */
export const WORKFLOW_BASENAME = "fan-in-execute.js";

/** The default relative path of the workflow file inside a repo/worktree. */
export const DEFAULT_WORKFLOW_REL = `.claude/workflows/${WORKFLOW_BASENAME}`;

/** The workflow-file's parent marker in a worktree scriptPath. */
export const WORKFLOW_MARKER = `/.claude/workflows/${WORKFLOW_BASENAME}`;

// ── Pure: materialized-record model ─────────────────────────────────────────────────────────────────

export interface MaterializedWorkflowRecord {
  /** The wf_*.json file this record came from (absolute path). */
  sourceFile: string;
  /** SDK-assigned workflow run id (e.g. "wf_38a6fab6-447"). */
  runId: string;
  /** Dispatch timestamp (ISO 8601, from the record's `timestamp` field). */
  timestamp?: string;
  /** The scriptPath the dispatcher PASSED to Workflow(). */
  scriptPath: string;
  /** The script content the SDK actually MATERIALIZED. */
  script: string;
  /** The fan-in task id (from args.task). */
  taskId?: string;
  /** The fan-in runId (from args.runId) — links to .workflow-events/<runId>.jsonl. */
  fanInRunId?: string;
}

/** PURE: is `p` under `base` (path-segment-safe)? */
export function isUnder(base: string, p: string): boolean {
  const rel = path.relative(base, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** PURE: the worktree root for a worktree scriptPath — everything before the `/.claude/workflows/`
 *  marker. Returns null when the path shape is unexpected. */
export function worktreeRootOf(scriptPath: string): string | null {
  const idx = scriptPath.indexOf(WORKFLOW_MARKER);
  if (idx === -1) return null;
  return scriptPath.slice(0, idx);
}

/** Parse one wf_*.json file into a record, or null if it is not an in-scope fan-in-execute
 *  materialization (wrong workflow / unparseable / missing script / non-worktree scriptPath). */
export function parseMaterializedRecord(file: string, root: string): MaterializedWorkflowRecord | null {
  let d: any;
  try {
    d = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const scriptPath = String(d.scriptPath ?? "");
  if (path.basename(scriptPath) !== WORKFLOW_BASENAME) return null;
  // In-scope = a WORKTREE scriptPath: NOT under the main checkout root. A main-checkout scriptPath is
  // the correct non-bootstrap form (out of scope — nothing to verify).
  const resolvedRoot = path.resolve(root);
  if (isUnder(resolvedRoot, path.resolve(scriptPath))) return null;
  const script = d.script;
  if (typeof script !== "string" || script.length === 0) return null;
  const args = d.args && typeof d.args === "object" ? d.args : {};
  return {
    sourceFile: file,
    runId: String(d.runId ?? path.basename(file, ".json")),
    timestamp: typeof d.timestamp === "string" ? d.timestamp : undefined,
    scriptPath,
    script,
    taskId: typeof args.task === "string" ? args.task : undefined,
    fanInRunId: typeof args.runId === "string" ? args.runId : undefined,
  };
}

// ── Pure: git-reconstructed worktree states (for GONE worktrees) ────────────────────────────────────

export interface WorktreeReconstruction {
  /** The fan-in fork point (develop at worktree creation) — .workflow-events start.baseCommit. */
  baseSha?: string;
  /** The worktree HEAD at fan-in end — .workflow-events end.fanInCommitSha. */
  fanInSha?: string;
  /** base commit's workflow-file content. */
  baseContent?: string;
  /** fanIn commit's workflow-file content. */
  fanInContent?: string;
  /** dispatch-HEAD (first parent of fanInSha) workflow-file content, when resolvable. */
  dispatchHeadContent?: string;
  /** True when the task's OWN non-merge commits (first-parent, --no-merges base..fanIn) touched the
   *  workflow file — the bootstrap self-verification signal for THIS file. */
  taskTouchedWorkflow?: boolean;
}

/** Read the fan-in's base + fanIn SHAs from `.workflow-events/<runId>.jsonl` (A16 telemetry,
 *  third-party written at dispatch/fan-in time). */
export function readWorkflowEvents(workflowEventsDir: string, runId: string | undefined): { baseSha?: string; fanInSha?: string } | null {
  if (!runId) return null;
  const file = path.join(workflowEventsDir, runId + ".jsonl");
  if (!fs.existsSync(file)) return null;
  let baseSha: string | undefined;
  let fanInSha: string | undefined;
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let d: any;
      try { d = JSON.parse(line); } catch { continue; }
      if (d?.eventKind === "start" && typeof d.baseCommit === "string") baseSha = d.baseCommit;
      if (d?.eventKind === "end") {
        fanInSha = typeof d.fanInCommitSha === "string" ? d.fanInCommitSha : (typeof d.candidateCommit === "string" ? d.candidateCommit : undefined);
      }
    }
  } catch {
    return null;
  }
  return { baseSha, fanInSha };
}

/** Reconstruct the worktree states for a gone worktree from git. Returns null when unresolvable. */
export function reconstructWorktree(
  root: string,
  relFile: string,
  baseSha: string | undefined,
  fanInSha: string | undefined,
  ref = "HEAD"
): WorktreeReconstruction | null {
  if (!baseSha || !fanInSha) return null;
  const show = (sha: string): string | null => {
    try {
      return execFileSync("git", ["-C", root, "show", `${sha}:${relFile}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  const baseContent = show(baseSha);
  const fanInContent = show(fanInSha);
  if (baseContent == null || fanInContent == null) return null;
  // dispatch-HEAD = the FIRST parent of the fanIn merge commit (the worktree HEAD before step-1 merge).
  let dispatchHeadContent: string | undefined;
  try {
    const parents = execFileSync("git", ["-C", root, "show", "--format=%P", "-s", fanInSha], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/);
    if (parents.length > 0 && parents[0]) dispatchHeadContent = show(parents[0]) ?? undefined;
  } catch { /* leave undefined */ }
  // Task's OWN non-merge commits (first-parent, --no-merges base..fanIn) that touched the workflow
  // file — isolates the task's change from develop changes pulled in via merge-develop (a merge
  // commit's first-parent diff includes the second parent's changes, so --no-merges is REQUIRED).
  let taskTouchedWorkflow = false;
  try {
    const out = execFileSync(
      "git", ["-C", root, "log", "--first-parent", "--no-merges", "--format=%H", `${baseSha}..${fanInSha}`, "--", relFile],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    taskTouchedWorkflow = out.trim().length > 0;
  } catch { /* leave false */ }
  return { baseSha, fanInSha, baseContent, fanInContent, dispatchHeadContent, taskTouchedWorkflow };
}

// ── Pure: verdict ───────────────────────────────────────────────────────────────────────────────────

export type VerdictKind =
  | "green-worktree-version-materialized"
  | "green-worktree-final"
  | "green-worktree-dispatch-head"
  | "green-base-not-task-touched"
  | "red-worktree-exists-mismatch"
  | "red-materialized-equals-base-task-touched"
  | "not-evaluated";

export interface Verdict {
  kind: VerdictKind;
  reason: string;
  evaluated: boolean;
  ok: boolean;
  worktreeFile?: string;
  baseSha?: string;
}

/**
 * PURE: judge ONE materialized record.
 * @param record   the materialized workflow record.
 * @param worktreeFile absolute path to the worktree's fan-in-execute.js (may not exist).
 * @param recon    git-reconstructed worktree states (for gone worktrees), or null when unresolvable.
 */
export function judgeRecord(
  record: MaterializedWorkflowRecord,
  worktreeFile: string,
  recon: WorktreeReconstruction | null
): Verdict {
  // Case 1 — the worktree file is still on disk: byte-exact comparison is decisive.
  if (fs.existsSync(worktreeFile)) {
    let wtContent: string;
    try {
      wtContent = fs.readFileSync(worktreeFile, "utf8");
    } catch {
      return { kind: "not-evaluated", reason: `worktree file unreadable: ${worktreeFile}`, evaluated: false, ok: true, worktreeFile };
    }
    if (record.script === wtContent) {
      return { kind: "green-worktree-version-materialized", reason: "materialized script == worktree fan-in-execute.js (worktree version materialized)", evaluated: true, ok: true, worktreeFile };
    }
    return { kind: "red-worktree-exists-mismatch", reason: "materialized script != worktree fan-in-execute.js (fallback: main/stale version materialized)", evaluated: true, ok: false, worktreeFile };
  }

  // Case 2 — the worktree is gone (fan-in completed and cleaned up). Use git-reconstructed states.
  if (!recon || recon.baseContent == null || recon.fanInContent == null) {
    return { kind: "not-evaluated", reason: "worktree gone and git reconstruction unresolvable — cannot judge", evaluated: false, ok: true, worktreeFile };
  }
  // 2a. The final worktree state (fanInCommitSha) — the task's committed change, if any, is present.
  if (record.script === recon.fanInContent) {
    return { kind: "green-worktree-final", reason: `materialized script == worktree@fanIn ${recon.fanInSha?.slice(0, 10) ?? "?"} (final worktree state)`, evaluated: true, ok: true, worktreeFile };
  }
  // 2b. The dispatch-time worktree state (first parent of fanIn) — a legitimate worktree state.
  if (recon.dispatchHeadContent != null && record.script === recon.dispatchHeadContent) {
    return { kind: "green-worktree-dispatch-head", reason: "materialized script == worktree@dispatch-HEAD (dispatch-time worktree state)", evaluated: true, ok: true, worktreeFile };
  }
  // 2c. The PRE-task base version. This is the fallback signature — but ONLY when the task's OWN
  // commits modified the workflow file (otherwise base IS the correct worktree state).
  if (record.script === recon.baseContent) {
    if (recon.taskTouchedWorkflow) {
      return { kind: "red-materialized-equals-base-task-touched", reason: `materialized script == base ${recon.baseSha?.slice(0, 10) ?? "?"} (PRE-task version) while the task's own commits touched the workflow file — fallback: the task's fix was NOT verified`, evaluated: true, ok: false, worktreeFile, baseSha: recon.baseSha };
    }
    return { kind: "green-base-not-task-touched", reason: "materialized script == base and the task did NOT modify the workflow file (base is the correct worktree state)", evaluated: true, ok: true, worktreeFile };
  }
  // 2d. Intermediate/partial state — the worktree evolved between dispatch and fan-in end; the
  // materialized script is consistent with SOME worktree state but not pin-able. NOT-EVALUATED.
  return { kind: "not-evaluated", reason: "materialized script matches neither a known worktree state nor the base — intermediate/partial worktree evolution, cannot pin without the lost working tree", evaluated: false, ok: true, worktreeFile };
}

// ── fs / helpers ────────────────────────────────────────────────────────────────────────────────────

/** The Claude project dir slug for a repo root (the path with every `/` replaced by `-`). */
export function projectSlug(root: string): string {
  return path.resolve(root).split(path.sep).join("-");
}

export function defaultProjectDir(root: string): string {
  return path.join(os.homedir(), ".claude", "projects", projectSlug(root));
}

/** Recursively find every `<session>/workflows/wf_*.json` under a project dir. */
export function findMaterializedWorkflowFiles(projectDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith(".json") && entry.name.startsWith("wf_")) out.push(full);
    }
  };
  walk(projectDir);
  return out.sort();
}

/**
 * PURE: does the task body's `## Touches` list any fan-in orchestration file? Uses the SAME single
 * source (FAN_IN_ORCHESTRATION_FILES / matchesObject) as `--bootstrap-orchestration`.
 * @returns true/false when determinable, null when the task file or Touches section is absent.
 */
export function taskIsBootstrapHit(tasksDir: string, taskId: string | undefined): boolean | null {
  if (!taskId) return null;
  const taskFile = path.join(tasksDir, `${taskId}.md`);
  if (!fs.existsSync(taskFile)) return null;
  let text: string;
  try {
    text = fs.readFileSync(taskFile, "utf8");
  } catch {
    return null;
  }
  const sec = extractSection(text, "Touches");
  if (!sec) return null;
  const paths = parseTouchEntriesWithTags(sec).map((e) => e.path).filter(Boolean);
  return paths.some((p) => FAN_IN_ORCHESTRATION_FILES.some((o) => matchesObject(o, p)));
}

// ── Aggregate ───────────────────────────────────────────────────────────────────────────────────────

export interface CheckResult {
  ok: boolean;
  evaluated: boolean;
  reason: string;
  checks: any[];
}

/** Aggregate per-record verdicts into the checker result. Any RED ⇒ not ok; all NOT-EVALUATED ⇒
 *  evaluated=false (never conflated with green). */
export function aggregate(verdicts: { record: MaterializedWorkflowRecord; verdict: Verdict }[]): CheckResult {
  const checks = verdicts.map(({ record, verdict }) => ({
    runId: record.runId,
    taskId: record.taskId ?? null,
    scriptPath: record.scriptPath,
    timestamp: record.timestamp ?? null,
    verdict: verdict.kind,
    ok: verdict.ok,
    evaluated: verdict.evaluated,
    reason: verdict.reason,
    worktreeFile: verdict.worktreeFile ?? null,
    baseSha: verdict.baseSha ?? null,
  }));
  if (checks.length === 0) {
    return { ok: true, evaluated: false, reason: "no-worktree-scriptpath-fan-in-materializations (NOT-EVALUATED)", checks };
  }
  const reds = checks.filter((c) => !c.ok && c.evaluated);
  const anyEvaluated = checks.some((c) => c.evaluated);
  if (reds.length > 0) {
    return { ok: false, evaluated: anyEvaluated, reason: `fan-in-materialize-fallback (${reds.length} of ${checks.length} in-scope dispatches)`, checks };
  }
  if (!anyEvaluated) {
    return { ok: true, evaluated: false, reason: "in-scope-records-not-judgeable (NOT-EVALUATED)", checks };
  }
  return { ok: true, evaluated: true, reason: "all-worktree-scriptpath-fan-ins-materialized-worktree-version", checks };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `fan-in-materialize-check.ts — gap-workflow-scriptpath-materialize-falls-back-main
  Detects the workflow scriptPath MATERIALIZATION fallback (M176 family): a bootstrap-HIT fan-in
  dispatched with scriptPath=<worktree>/.claude/workflows/fan-in-execute.js but MATERIALIZED from the
  MAIN checkout — the task's own fix to the fan-in pipeline is then NOT verified by its own fan-in.
  Reads the PRODUCTION CARRIER (the SDK-written ~/.claude/projects/<slug>/<session>/workflows/wf_*.json
  records, which carry BOTH the passed scriptPath AND the materialized script content). Fail-closed:
  any in-scope record whose materialized script != the worktree version is RED; NOT-EVALUATED when the
  evidence cannot decide (硬规则 3b — "cannot judge" is never conflated with green).

Usage:
  node --experimental-strip-types fan-in-materialize-check.ts
      [--root <dir>] [--project-dir <dir>] [--tasks-dir <dir>]
      [--workflow-file <rel>] [--workflow-events-dir <dir>]
      [--mainline-ref <ref>] [--json] [--help]

  --root <dir>             main checkout root (default: cwd). Derives the default project dir slug and
                           the git mainline for the "worktree gone" reconstruction.
  --project-dir <dir>      Claude project dir to scan for wf_*.json (default ~/.claude/projects/<slug>).
  --tasks-dir <dir>        task store root for Touches-based bootstrap-HIT confirmation
                           (default <root>/tasks).
  --workflow-file <rel>    workflow file rel path (default .claude/workflows/fan-in-execute.js).
  --workflow-events-dir <dir>  A16 telemetry dir for the fan-in base/fanIn SHAs
                           (default <root>/.workflow-events). Per fan-in runId: start.baseCommit +
                           end.fanInCommitSha give the worktree states for gone-worktree reconstruction.
  --mainline-ref <ref>     git ref for the reconstruction (default HEAD).
  --json                   machine-readable output { ok, evaluated, reason, checks }.
  --help                   this help.

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — an in-scope worktree-scriptPath fan-in materialized a non-worktree version (fallback)
  2  usage / environment error`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const projectDir = getArgValue(args, "--project-dir") ?? defaultProjectDir(root);
  const tasksDir = getArgValue(args, "--tasks-dir") ?? path.join(root, "tasks");
  const workflowRel = getArgValue(args, "--workflow-file") ?? DEFAULT_WORKFLOW_REL;
  const workflowEventsDir = getArgValue(args, "--workflow-events-dir") ?? path.join(root, ".workflow-events");
  const mainlineRef = getArgValue(args, "--mainline-ref") ?? "HEAD";
  const asJson = args.includes("--json");

  const files = findMaterializedWorkflowFiles(projectDir);
  const verdicts: { record: MaterializedWorkflowRecord; verdict: Verdict }[] = [];

  for (const file of files) {
    const record = parseMaterializedRecord(file, root);
    if (!record) continue;
    const worktreeRoot = worktreeRootOf(record.scriptPath);
    if (!worktreeRoot) {
      verdicts.push({ record, verdict: { kind: "not-evaluated", reason: "unexpected scriptPath shape (no worktree root)", evaluated: false, ok: true } });
      continue;
    }
    const worktreeFile = path.join(worktreeRoot, workflowRel);
    // Reconstruct the gone-worktree states from A16 telemetry + git (only used when the worktree is gone).
    const events = readWorkflowEvents(workflowEventsDir, record.fanInRunId);
    const recon = events ? reconstructWorktree(root, workflowRel, events.baseSha, events.fanInSha, mainlineRef) : null;
    verdicts.push({ record, verdict: judgeRecord(record, worktreeFile, recon) });
  }

  const out = aggregate(verdicts);
  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`fan-in-materialize-check: ${out.ok ? "OK" : "FAIL"} — ${out.reason}`);
    for (const c of out.checks) {
      console.log(`  [${c.verdict}] ${c.ok ? "ok" : "RED"}${c.evaluated ? "" : " (NOT-EVALUATED)"} — ${c.reason}`);
      console.log(`    runId=${c.runId} task=${c.taskId ?? "?"} scriptPath=${c.scriptPath}`);
    }
  }
  return out.ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-materialize-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
