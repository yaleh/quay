#!/usr/bin/env node --experimental-strip-types
// select-preflight.ts — M153/DIR-072: encapsulate OUTER-LOOP SELECT preflight (steps 1-3) into a
// deterministic TypeScript script. Pure functions + thin CLI producing structured PreflightResult JSON.
//
// Operations (all mechanical, no LLM):
//   1. Check .halt sentinel
//   2. Scan pending directives (quay task list → filter extra.dirStatus: pending)
//   3. Cadence check (explore-exploit-cadence.ts --json)
//   4. Extract autonomous-selectable milestone-candidates
//   5. Schema check per candidate (task-schema.ts)
//   6. Touches check per candidate (## Touches section presence)
//   7. Output PreflightResult JSON
//
// Does NOT classify deliverable:yes|no — that is the ONE judgment step left to the workflow.
//
// Usage:
//   node --experimental-strip-types scripts/select-preflight.ts --json \
//     --workspace-root <path> --milestone-counter <n>
//   node --experimental-strip-types scripts/select-preflight.ts --selftest

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { checkTask } from "./task-schema.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface CandidateEntry {
  id: string;
  title: string;
  rank: number;
  labels: string[];
  extra: Record<string, any>;
  schemaPass: boolean;
  schemaDetail: string;
  hasTouches: boolean;
}

export interface CadenceResult {
  verdict: string;
  streak: number;
  threshold: number;
  lastExploreAt: number | null;
}

export interface PreflightResult {
  halt: boolean;
  haltReason: string;
  pendingDirectives: string[];
  cadence: CadenceResult | null;
  candidates: CandidateEntry[];
  milestoneCounter: number;
  workspaceRoot: string;
}

// ── checkHalt ─────────────────────────────────────────────────────────────────────────────────────
// Read .halt sentinel at workspace root. Returns {halt: true, reason} if the file exists and is
// non-empty, or {halt: false, reason: ""}.
export function checkHalt(workspaceRoot: string): { halt: boolean; reason: string } {
  const haltPath = path.join(workspaceRoot, ".halt");
  try {
    const content = fs.readFileSync(haltPath, "utf8").trim();
    if (content) return { halt: true, reason: content };
    return { halt: true, reason: ".halt sentinel present (empty)" };
  } catch {
    return { halt: false, reason: "" };
  }
}

// ── getPendingDirectives ──────────────────────────────────────────────────────────────────────────
// Given a task list JSON array (from quay task list --json), filter to pending directives.
// A pending directive has label:directive AND extra.dirStatus: "pending".
export function getPendingDirectives(tasks: any[]): string[] {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => {
      const labels: string[] = Array.isArray(t.labels) ? t.labels : [];
      return labels.some((l) => String(l).toLowerCase() === "directive");
    })
    .filter((t) => {
      const extra = t.extra || {};
      return extra.dirStatus === "pending";
    })
    .map((t) => t.id);
}

// ── getCandidates ─────────────────────────────────────────────────────────────────────────────────
// Given a task list JSON array, extract autonomous-selectable milestone-candidates.
// Filters: label:milestone-candidate, status:todo, NOT label:human-steered.
// Returns CandidateEntry array with schema/touches set to false (filled in later).
export function getCandidates(tasks: any[]): CandidateEntry[] {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => {
      const labels: string[] = Array.isArray(t.labels) ? t.labels : [];
      return labels.some((l) => String(l).toLowerCase() === "milestone-candidate");
    })
    .filter((t) => t.status === "todo")
    .filter((t) => {
      const labels: string[] = Array.isArray(t.labels) ? t.labels : [];
      return !labels.some((l) => String(l).toLowerCase() === "human-steered");
    })
    .map((t) => {
      const extra = t.extra || {};
      const labels: string[] = Array.isArray(t.labels) ? t.labels : [];
      // Rank: use extra.rank if present, else default to 999 (low priority)
      const rank = typeof extra.rank === "number" ? extra.rank : 999;
      return {
        id: t.id,
        title: t.title || "",
        rank,
        labels,
        extra,
        schemaPass: false,
        schemaDetail: "",
        hasTouches: false,
      };
    });
}

// ── checkCandidateSchema ──────────────────────────────────────────────────────────────────────────
// Run task-schema check on a candidate by reading its task file.
// Returns {schemaPass, schemaDetail}.
export function checkCandidateSchema(workspaceRoot: string, taskId: string): { schemaPass: boolean; schemaDetail: string } {
  const taskFile = path.join(workspaceRoot, "tasks", `${taskId}.md`);
  try {
    const text = fs.readFileSync(taskFile, "utf8");
    const report = checkTask(text);
    if (report.verdict === "PASS") {
      return { schemaPass: true, schemaDetail: `PASS (kind=${report.kind})` };
    }
    if (report.verdict === "N/A-legacy") {
      return { schemaPass: true, schemaDetail: "N/A-legacy (grandfathered)" };
    }
    const failures = (report.failures || []).map((f: any) => `${f.code}: ${f.message}`).join("; ");
    return { schemaPass: false, schemaDetail: `FAIL: ${failures}` };
  } catch {
    return { schemaPass: false, schemaDetail: "ERROR: cannot read task file" };
  }
}

// ── checkCandidateTouches ────────────────────────────────────────────────────────────────────────
// Check that a candidate task has a `## Touches` section in its body.
export function checkCandidateTouches(workspaceRoot: string, taskId: string): boolean {
  const taskFile = path.join(workspaceRoot, "tasks", `${taskId}.md`);
  try {
    const text = fs.readFileSync(taskFile, "utf8");
    return /^## Touches\s*$/m.test(text);
  } catch {
    return false;
  }
}

// ── getCadence ────────────────────────────────────────────────────────────────────────────────────
// Run explore-exploit-cadence.ts --json and parse its output.
// Returns CadenceResult or null if the script fails.
export function getCadence(workspaceRoot: string): CadenceResult | null {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const cadenceScript = path.join(scriptDir, "explore-exploit-cadence.ts");
  const dashboardPath = path.join(workspaceRoot, "experiments", "quay-perpetual-stream", "dashboard.md");
  try {
    const stdout = execFileSync(
      "node",
      ["--experimental-strip-types", cadenceScript, "--json", "--dashboard", dashboardPath],
      { encoding: "utf8", timeout: 30000, cwd: workspaceRoot },
    ).trim();
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// ── getTaskList ───────────────────────────────────────────────────────────────────────────────────
// Run quay task list --json and parse the output.
// Returns the task array or null on failure.
export function getTaskList(workspaceRoot: string): any[] | null {
  const quayCli = path.join(workspaceRoot, "packages", "quay", "bin", "quay.ts");
  try {
    const stdout = execFileSync(
      "node",
      ["--experimental-strip-types", quayCli, "task", "list", "--json"],
      { encoding: "utf8", timeout: 60000, maxBuffer: 50 * 1024 * 1024, cwd: workspaceRoot },
    ).trim();
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// ── buildPreflightResult ──────────────────────────────────────────────────────────────────────────
// Core function: assemble the complete PreflightResult.
export function buildPreflightResult(workspaceRoot: string, milestoneCounter: number): PreflightResult {
  // 1. Check .halt
  const haltCheck = checkHalt(workspaceRoot);

  // 2. Get task list from quay CLI
  const tasks = getTaskList(workspaceRoot);
  if (tasks === null) {
    return {
      halt: true,
      haltReason: "FAIL-CLOSED: could not read task store (quay task list --json failed)",
      pendingDirectives: [],
      cadence: null,
      candidates: [],
      milestoneCounter,
      workspaceRoot,
    };
  }

  // 3. Pending directives
  const pendingDirectives = getPendingDirectives(tasks);

  // 4. Cadence
  const cadence = getCadence(workspaceRoot);

  // 5. Extract candidates
  const candidates = getCandidates(tasks);

  // 6. Schema check per candidate
  for (const c of candidates) {
    const sc = checkCandidateSchema(workspaceRoot, c.id);
    c.schemaPass = sc.schemaPass;
    c.schemaDetail = sc.schemaDetail;
  }

  // 7. Touches check per candidate
  for (const c of candidates) {
    c.hasTouches = checkCandidateTouches(workspaceRoot, c.id);
  }

  return {
    halt: haltCheck.halt,
    haltReason: haltCheck.reason,
    pendingDirectives,
    cadence,
    candidates,
    milestoneCounter,
    workspaceRoot,
  };
}

// ── selftest ──────────────────────────────────────────────────────────────────────────────────────
export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  // ── checkHalt ──
  const tmpDir = fs.mkdtempSync("select-preflight-selftest-");
  try {
    // GREEN: no .halt → halt: false
    const r1 = checkHalt(tmpDir);
    check("no-halt-file", r1.halt === false, `halt=${r1.halt}`);

    // GREEN: .halt exists → halt: true
    fs.writeFileSync(path.join(tmpDir, ".halt"), "manual stop", "utf8");
    const r2 = checkHalt(tmpDir);
    check("halt-file-present", r2.halt === true && r2.reason === "manual stop", r2.reason);

    // GREEN: empty .halt → halt: true
    fs.unlinkSync(path.join(tmpDir, ".halt"));
    fs.writeFileSync(path.join(tmpDir, ".halt"), "", "utf8");
    const r3 = checkHalt(tmpDir);
    check("empty-halt-present", r3.halt === true, r3.reason);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // ── getPendingDirectives ──
  // GREEN: filters pending directives only
  const directiveTasks = [
    { id: "DIR-001", labels: ["directive"], extra: { dirStatus: "pending" } },
    { id: "DIR-002", labels: ["directive"], extra: { dirStatus: "applied" } },
    { id: "DIR-003", labels: ["directive"], extra: {} },
    { id: "NOT-A-DIR", labels: ["milestone-candidate"], extra: { dirStatus: "pending" } },
  ];
  const pd = getPendingDirectives(directiveTasks);
  check("pending-directives-filter", pd.length === 1 && pd[0] === "DIR-001", JSON.stringify(pd));

  // RED: empty input
  check("empty-directives", getPendingDirectives([]).length === 0, "empty");
  check("null-directives", getPendingDirectives(null as any).length === 0, "null");

  // ── getCandidates ──
  const candidateTasks = [
    { id: "DIR-089", title: "Test task", status: "todo", labels: ["milestone-candidate"], extra: { rank: 5 } },
    { id: "DIR-090", title: "Human steered", status: "todo", labels: ["milestone-candidate", "human-steered"], extra: {} },
    { id: "DIR-091", title: "Done candidate", status: "done", labels: ["milestone-candidate"], extra: {} },
    { id: "DIR-092", title: "No rank", status: "todo", labels: ["milestone-candidate"], extra: {} },
  ];
  const cands = getCandidates(candidateTasks);
  check("candidate-count", cands.length === 2, `got ${cands.length} (expected 2 — filtered human-steered + done)`);
  check("candidate-rank", cands[0].id === "DIR-089" && cands[0].rank === 5, `rank=${cands[0].rank}`);
  check("candidate-default-rank", cands[1].id === "DIR-092" && cands[1].rank === 999, `default rank=${cands[1].rank}`);
  check("candidates-not-human-steered", !cands.some((c) => c.id === "DIR-090"), "human-steered excluded");

  // ── checkCandidateTouches ──
  const tmpDir2 = fs.mkdtempSync("select-preflight-selftest-touches-");
  try {
    const tasksDir = path.join(tmpDir2, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "WITH-TOUCHES.md"), "## Proposal\nsome text\n\n## Touches\n\n- file1.ts\n", "utf8");
    fs.writeFileSync(path.join(tasksDir, "NO-TOUCHES.md"), "## Proposal\nsome text\n\n## Acceptance Criteria\n\n- [ ] item\n", "utf8");
    check("has-touches", checkCandidateTouches(tmpDir2, "WITH-TOUCHES") === true, "found ## Touches");
    check("no-touches", checkCandidateTouches(tmpDir2, "NO-TOUCHES") === false, "no ## Touches");
    check("missing-file", checkCandidateTouches(tmpDir2, "NONEXISTENT") === false, "missing → false");
  } finally {
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }

  // ── buildPreflightResult integration (without quay CLI) ──
  // We test component functions individually since integration needs a real workspace.

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("Usage: node --experimental-strip-types select-preflight.ts --json --workspace-root <path> --milestone-counter <n>");
  console.error("       node --experimental-strip-types select-preflight.ts --selftest");
  process.exit(2);
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--selftest")) {
    return selftest() ? 0 : 1;
  }

  let workspaceRoot = process.cwd();
  let milestoneCounter = 0;
  let jsonOut = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = path.resolve(args[++i]);
    } else if (args[i] === "--milestone-counter" && i + 1 < args.length) {
      milestoneCounter = parseInt(args[++i], 10);
      if (isNaN(milestoneCounter)) {
        console.error("ERROR: --milestone-counter must be an integer");
        return 2;
      }
    } else if (args[i] === "--json") {
      jsonOut = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      usage();
    } else {
      console.error(`ERROR: unknown argument: ${args[i]}`);
      usage();
    }
  }

  if (!jsonOut) usage();

  const result = buildPreflightResult(workspaceRoot, milestoneCounter);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

const isDirect = isDirectEntry(import.meta);
if (isDirect) {
  main(process.argv);
  // Don't process.exit — let the script finish naturally
}
