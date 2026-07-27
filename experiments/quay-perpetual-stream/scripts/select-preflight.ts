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
//   6b. Pre-charter orthogonality scan (DIR-113 item 3): pairwise checkTouchesPair over the
//       shortlist's TASK-LEVEL Touches (manual first, auto-derived fallback via
//       derive-touches-heuristic.ts) — BEFORE any charter-authoring fork is dispatched. Always
//       logged, either "orthogonal pair found" or "no orthogonal pair found in top-N" — never
//       silent (this is a scheduling-time HINT; anti-drift-touches-check.ts's PRE-MERGE gate is
//       the untouched authority, per DIR-113 item 5).
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
import { classify, type ClassifyResult } from "./human-steered-classify.ts";
import { loadRegistry, type Registry, DEFAULT_REGISTRY_PATH } from "./drivable-workspace-check.ts";
import { parseTouches, checkTouchesPair, expandGlobs } from "./touches-orthogonality-check.ts";
import { deriveTouches } from "./derive-touches-heuristic.ts";

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
  humanSteered: boolean;
  classifyDetail: string;
  // role/children (DIR-113-derived M181 fix): carried through from the raw task view-model so
  // buildPreflightResult can walk an epic's open children without a second task-store read.
  // Absent on fixtures/tests that construct CandidateEntry literals directly — treated as
  // "not an epic" (role !== "compound" or children.length === 0) when undefined.
  role?: string;
  children?: string[];
}

export interface CadenceResult {
  verdict: string;
  streak: number;
  threshold: number;
  lastExploreAt: number | null;
}

// DIR-113 item 3: one disjoint pair found by the pre-charter orthogonality scan.
export interface OrthogonalPair {
  a: string;
  b: string;
  reason: string;
}

// DIR-113 item 3: result of the pairwise pre-charter orthogonality scan over the shortlist.
export interface OrthogonalScanResult {
  checkedCount: number;
  pairs: OrthogonalPair[];
  // Human-readable log lines — ALWAYS non-empty (an explicit "no orthogonal pair found" line is
  // emitted when pairs.length === 0, never silence). Printed by the CLI before/alongside the JSON
  // payload so the record exists before any charter-authoring fork would be dispatched by a
  // caller consuming this script's output.
  log: string[];
}

export interface PreflightResult {
  halt: boolean;
  haltReason: string;
  pendingDirectives: string[];
  cadence: CadenceResult | null;
  candidates: CandidateEntry[];
  orthogonalScan: OrthogonalScanResult;
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
  } catch (e: unknown) {
    // DIR-120 item 7: "config read failure = fail CLOSED, no exceptions." ENOENT (no .halt file at
    // all) is the expected, common non-halted state — NOT a read failure — so it alone still
    // yields {halt:false}. Any OTHER failure (permission denied, path is a directory, I/O error,
    // etc.) is a genuine read failure and must fail CLOSED (halt:true), never silently fall through
    // to "not halted" — that fail-open shape is exactly what already caused a real, safety-relevant
    // miss (gap-halt-sentinel-path-mismatch).
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { halt: false, reason: "" };
    return {
      halt: true,
      reason: `FAIL-CLOSED: could not read .halt sentinel at ${haltPath}: ${(e as Error)?.message || String(e)}`,
    };
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
// Given a task list JSON array, extract milestone-candidates.
// Filters: label:milestone-candidate, status:todo.
// human-steered classification is deferred to buildPreflightResult via the classifier.
// Returns CandidateEntry array with schema/touches/humanSteered set to false (filled in later).
export function getCandidates(tasks: any[]): CandidateEntry[] {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => {
      const labels: string[] = Array.isArray(t.labels) ? t.labels : [];
      return labels.some((l) => String(l).toLowerCase() === "milestone-candidate");
    })
    .filter((t) => t.status === "todo")
    .map((t) => {
      const extra = t.extra || {};
      const labels: string[] = Array.isArray(t.labels) ? t.labels : [];
      // Rank: use extra.rank if present, else default to 999 (low priority)
      const rank = typeof extra.rank === "number" ? extra.rank : 999;
      const role = typeof t.role === "string" ? t.role : undefined;
      const children: string[] | undefined = Array.isArray(t.children) ? t.children : undefined;
      return {
        id: t.id,
        title: t.title || "",
        rank,
        labels,
        extra,
        schemaPass: false,
        schemaDetail: "",
        hasTouches: false,
        humanSteered: false,
        classifyDetail: "",
        role,
        children,
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

// ── extractTouchedFiles ──────────────────────────────────────────────────────────────────────────
// Parse the `## Touches` section from a task body and extract file paths.
// Lines look like: - `path/to/file.ts` (comment)
// Returns an array of file paths (backticks stripped, comments removed).
export function extractTouchedFiles(workspaceRoot: string, taskId: string): string[] {
  const taskFile = path.join(workspaceRoot, "tasks", `${taskId}.md`);
  try {
    const text = fs.readFileSync(taskFile, "utf8");
    const touchesMatch = text.match(/^## Touches\s*$\n+((?:[-*]\s.*\n?)+)/m);
    if (!touchesMatch) return [];
    const lines = touchesMatch[1].split("\n");
    const files: string[] = [];
    for (const line of lines) {
      // Match backtick-quoted paths: `some/path/file.ts`
      const fileMatch = line.match(/`([^`]+)`/);
      if (fileMatch) files.push(fileMatch[1].trim());
    }
    return files;
  } catch {
    return [];
  }
}

// ── getCandidateParsedTouches (DIR-113 item 3) ──────────────────────────────────────────────────
// Task-level Touches for the pre-charter orthogonality scan: a DECLARED `## Touches` section wins
// (manual, or a previously-backfilled auto-derived one — both render the same heading); absent
// that, fall back to an EPHEMERAL auto-derivation via derive-touches-heuristic.ts (never written
// back to the task file — a scheduling-time hint only). Absent both, conservative "none".
export interface CandidateTouches {
  hasSection: boolean;
  globs: string[];
  source: "declared" | "auto-derived" | "none";
}

export function getCandidateParsedTouches(workspaceRoot: string, taskId: string): CandidateTouches {
  const taskFile = path.join(workspaceRoot, "tasks", `${taskId}.md`);
  let text = "";
  try {
    text = fs.readFileSync(taskFile, "utf8");
  } catch {
    return { hasSection: false, globs: [], source: "none" };
  }
  const declared = parseTouches(text);
  if (declared.hasSection && declared.globs.length > 0) {
    return { hasSection: true, globs: declared.globs, source: "declared" };
  }
  try {
    const { globs } = deriveTouches(text, workspaceRoot);
    if (globs.length > 0) return { hasSection: true, globs, source: "auto-derived" };
  } catch {
    // Fall through to conservative "none" — an extraction error must never crash the scan.
  }
  return { hasSection: false, globs: [], source: "none" };
}

// ── scanOrthogonalPairs (DIR-113 item 3) ────────────────────────────────────────────────────────
// Pairwise checkTouchesPair (single-source, ADR-004, imported from touches-orthogonality-check.ts)
// over the top-N ranked candidates' task-level Touches — run BEFORE any charter-authoring fork is
// dispatched (this function's caller, select-preflight's CLI/buildPreflightResult, always runs
// ahead of charter authoring in the OUTER-LOOP pipeline). Always returns a non-empty `log`: either
// >=1 "ORTHOGONAL PAIR FOUND" line, or one explicit "NO ORTHOGONAL PAIR" line — never silent.
export function scanOrthogonalPairs(
  workspaceRoot: string,
  candidates: CandidateEntry[],
  opts?: { topN?: number },
): OrthogonalScanResult {
  const topN = opts?.topN ?? 5;
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank).slice(0, topN);
  const touchesById = new Map<string, CandidateTouches>();
  for (const c of sorted) touchesById.set(c.id, getCandidateParsedTouches(workspaceRoot, c.id));

  const expand = (globs: string[]) => expandGlobs(globs, workspaceRoot);
  const pairs: OrthogonalPair[] = [];
  const log: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const ta = touchesById.get(a.id)!;
      const tb = touchesById.get(b.id)!;
      const r = checkTouchesPair(
        { hasSection: ta.hasSection, globs: ta.globs },
        { hasSection: tb.hasSection, globs: tb.globs },
        expand,
      );
      if (r.disjoint) {
        pairs.push({ a: a.id, b: b.id, reason: r.reason });
        log.push(`ORTHOGONAL PAIR FOUND: ${a.id} (${ta.source}) ∥ ${b.id} (${tb.source}) — ${r.reason}`);
      }
    }
  }

  if (pairs.length === 0) {
    const detail = sorted.map((c) => `${c.id}:${touchesById.get(c.id)!.source}`).join(", ") || "no candidates";
    log.push(
      `NO ORTHOGONAL PAIR: checked ${sorted.length} candidate(s) in top-${topN} (${detail}) — no touches-disjoint pair found; batching deferred, candidates remain serial for this cycle`,
    );
  }

  return { checkedCount: sorted.length, pairs, log };
}

// ── classifyCandidate ────────────────────────────────────────────────────────────────────────────
// Run human-steered-classify on a candidate task using its Touches section and extra fields.
// Returns ClassifyResult with additional detail for reporting.
export function classifyCandidate(
  workspaceRoot: string,
  taskId: string,
  extra: Record<string, any>,
  registry: Registry,
): ClassifyResult & { detail: string } {
  const touchedFiles = extractTouchedFiles(workspaceRoot, taskId);
  const missionRedirection = extra?.missionRedirection === true;
  const drivenWorkspaces: string[] = Array.isArray(extra?.drivenWorkspaces)
    ? extra.drivenWorkspaces
    : [];

  const result = classify({ touchedFiles, missionRedirection, drivenWorkspaces, registry });

  // Build human-readable detail for audit trail
  const parts: string[] = [];
  if (result.clauses.driverFileEdit) {
    parts.push(`driver-file-edit: ${touchedFiles.filter((f) => /OUTER-LOOP|inherited-core|\.claude[/\\]skills[/\\]/.test(f.replace(/\//g, path.sep))).join(", ") || "yes"}`);
  }
  if (result.clauses.missionRedirection) parts.push("mission-redirection: true");
  if (result.clauses.unauthorizedWorkspace) {
    parts.push(`unauthorized-workspaces: ${result.unauthorizedWorkspaces.join(", ")}`);
  }
  const detail = parts.length > 0 ? parts.join("; ") : "autonomous-eligible (all clauses clear)";

  return { ...result, detail };
}

// ── hasHumanSteeredLabel (M181 fix, case 1) ─────────────────────────────────────────────────────
// A direct `label:human-steered` on the task is an ADDITIONAL, independent exclusion signal — it
// must never be overridden by whatever human-steered-classify.ts's heuristic classifier concludes
// (DIR-062-C's classifier deliberately never reads this label itself; select-preflight.ts is the
// consumer responsible for ORing it in). Case-insensitive, matching getCandidates' own convention.
export function hasHumanSteeredLabel(labels: string[] | undefined | null): boolean {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => String(l).toLowerCase() === "human-steered");
}

// ── computeHumanSteered (M181 fix) ──────────────────────────────────────────────────────────────
// Shared decision point used for BOTH top-level candidates and an epic's children: classifier
// result OR direct label — case 1's OR, applied uniformly wherever a task's human-steered
// disposition is needed.
export function computeHumanSteered(
  workspaceRoot: string,
  taskId: string,
  labels: string[],
  extra: Record<string, any>,
  registry: Registry,
): { humanSteered: boolean; detail: string } {
  const cr = classifyCandidate(workspaceRoot, taskId, extra, registry);
  const labelHumanSteered = hasHumanSteeredLabel(labels);
  const detail = labelHumanSteered ? `${cr.detail}; label:human-steered (direct)` : cr.detail;
  return { humanSteered: cr.humanSteered || labelHumanSteered, detail };
}

// ── isEpicBlockedByHumanSteeredChildren (M181 fix, case 2) ─────────────────────────────────────
// A compound/epic candidate (role:compound, non-empty children) has NO autonomous-executable path
// forward when ALL of its currently-open (non-done) children are human-steered (label OR
// classifier, via computeHumanSteered above). Vacuous case: an epic with zero open children (all
// children done, or no children left to check) is NOT blocked by this rule — nothing to test, so
// it falls through to whatever the epic's own classification already decided.
export function isEpicBlockedByHumanSteeredChildren(
  workspaceRoot: string,
  childIds: string[],
  tasksById: Map<string, any>,
  registry: Registry,
): boolean {
  const openChildren = childIds
    .map((id) => tasksById.get(id))
    .filter((t): t is any => t != null && t.status !== "done");
  if (openChildren.length === 0) return false;
  return openChildren.every((t) => {
    const labels: string[] = Array.isArray(t.labels) ? t.labels : [];
    const extra = t.extra || {};
    return computeHumanSteered(workspaceRoot, t.id, labels, extra, registry).humanSteered;
  });
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
// DIR-062-C: classifies each candidate via human-steered-classify.ts, filtering out human-steered ones.
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
      orthogonalScan: { checkedCount: 0, pairs: [], log: ["SKIPPED: could not read task store — no candidates to scan"] },
      milestoneCounter,
      workspaceRoot,
    };
  }

  // 3. Pending directives
  const pendingDirectives = getPendingDirectives(tasks);

  // 4. Cadence
  const cadence = getCadence(workspaceRoot);

  // 5. Extract candidates (all todo + milestone-candidate, no human-steered pre-filter)
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

  // 8. Classify human-steered per candidate (DIR-062-C classifier) OR'd with a direct
  // label:human-steered (M181 fix, case 1) — the label is an additional, never-overridden signal.
  let registry: Registry = { authorizedRoot: null, workspacePaths: [] };
  try {
    const registryPath = path.join(workspaceRoot, "experiments", "quay-perpetual-stream", "drivable-workspaces.yml");
    if (fs.existsSync(registryPath)) {
      registry = loadRegistry(registryPath);
    }
  } catch {
    // Fail-closed: empty registry means every driven workspace is unauthorized.
    // In practice, tasks lacking extra.drivenWorkspaces will still pass.
  }

  for (const c of candidates) {
    const hs = computeHumanSteered(workspaceRoot, c.id, c.labels, c.extra, registry);
    c.humanSteered = hs.humanSteered;
    c.classifyDetail = hs.detail;
  }

  // 8b. Epic-with-human-steered-only-child (M181 fix, case 2): a compound candidate whose every
  // currently-open child is human-steered has no autonomous-executable path forward — exclude it
  // too, even though the epic's OWN label/classifier came back clean.
  const tasksById = new Map<string, any>((tasks as any[]).map((t) => [t.id, t]));
  for (const c of candidates) {
    if (c.humanSteered) continue;
    if (c.role !== "compound") continue;
    const children = Array.isArray(c.children) ? c.children : [];
    if (children.length === 0) continue;
    if (isEpicBlockedByHumanSteeredChildren(workspaceRoot, children, tasksById, registry)) {
      c.humanSteered = true;
      c.classifyDetail = `${c.classifyDetail}; epic-blocked: all open children human-steered`;
    }
  }

  // Filter out human-steered candidates (they must not be selected autonomously)
  const autonomousCandidates = candidates.filter((c) => !c.humanSteered);

  // 9. Pre-charter orthogonality scan (DIR-113 item 3) — BEFORE any charter-authoring fork.
  const orthogonalScan = scanOrthogonalPairs(workspaceRoot, autonomousCandidates);

  return {
    halt: haltCheck.halt,
    haltReason: haltCheck.reason,
    pendingDirectives,
    cadence,
    candidates: autonomousCandidates,
    orthogonalScan,
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
  // DIR-062-C: getCandidates no longer pre-filters by label:human-steered.
  // Classification is done in buildPreflightResult via the classifier.
  const candidateTasks = [
    { id: "DIR-089", title: "Test task", status: "todo", labels: ["milestone-candidate"], extra: { rank: 5 } },
    { id: "DIR-090", title: "Human steered", status: "todo", labels: ["milestone-candidate", "human-steered"], extra: {} },
    { id: "DIR-091", title: "Done candidate", status: "done", labels: ["milestone-candidate"], extra: {} },
    { id: "DIR-092", title: "No rank", status: "todo", labels: ["milestone-candidate"], extra: {} },
  ];
  const cands = getCandidates(candidateTasks);
  check("candidate-count", cands.length === 3, `got ${cands.length} (expected 3 — only done filtered; human-steered now classified not label-filtered)`);
  check("candidate-rank", cands[0].id === "DIR-089" && cands[0].rank === 5, `rank=${cands[0].rank}`);
  check("candidate-default-rank", cands[1].id === "DIR-090" && cands[1].rank === 999, `default rank=${cands[1].rank}`);
  check("candidate-schema-defaults", cands[0].schemaPass === false && cands[0].hasTouches === false && cands[0].humanSteered === false, "defaults set");
  // DIR-062-C: human-steered label tasks ARE still returned (classifier runs later in buildPreflightResult)
  check("human-steered-still-returned", cands.some((c) => c.id === "DIR-090"), "human-steered label task still returned by getCandidates");

  // ── checkCandidateTouches ──
  const tmpDir2 = fs.mkdtempSync("select-preflight-selftest-touches-");
  try {
    const tasksDir = path.join(tmpDir2, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "WITH-TOUCHES.md"), "## Proposal\nsome text\n\n## Touches\n\n- `file1.ts` (comment)\n- `.claude/skills/some-skill/SKILL.md`\n", "utf8");
    fs.writeFileSync(path.join(tasksDir, "NO-TOUCHES.md"), "## Proposal\nsome text\n\n## Acceptance Criteria\n\n- [ ] item\n", "utf8");
    check("has-touches", checkCandidateTouches(tmpDir2, "WITH-TOUCHES") === true, "found ## Touches");
    check("no-touches", checkCandidateTouches(tmpDir2, "NO-TOUCHES") === false, "no ## Touches");
    check("missing-file", checkCandidateTouches(tmpDir2, "NONEXISTENT") === false, "missing → false");

    // ── extractTouchedFiles (DIR-062-C) ──
    const touchedFiles = extractTouchedFiles(tmpDir2, "WITH-TOUCHES");
    check("extract-touched-count", touchedFiles.length === 2, `got ${touchedFiles.length} files: ${JSON.stringify(touchedFiles)}`);
    check("extract-touched-path1", touchedFiles[0] === "file1.ts", `file1=${touchedFiles[0]}`);
    check("extract-touched-path2", touchedFiles[1] === ".claude/skills/some-skill/SKILL.md", `skill=${touchedFiles[1]}`);
    check("extract-empty-task", extractTouchedFiles(tmpDir2, "NO-TOUCHES").length === 0, "no Touches → empty");
    check("extract-nonexistent", extractTouchedFiles(tmpDir2, "NONEXISTENT").length === 0, "missing file → empty");
  } finally {
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }

  // ── classifyCandidate (DIR-062-C) ──
  // Test classifyCandidate through the classifier function with real file structures.
  const tmpDir3 = fs.mkdtempSync("select-preflight-selftest-classify-");
  try {
    const tasksDir2 = path.join(tmpDir3, "tasks");
    fs.mkdirSync(tasksDir2, { recursive: true });

    // Case 1: task touching OUTER-LOOP.md → humanSteered: true (driverFileEdit)
    fs.writeFileSync(path.join(tasksDir2, "DRIVER-EDIT.md"), "## Proposal\ntest\n\n## Touches\n\n- `experiments/quay-perpetual-stream/OUTER-LOOP.md`\n", "utf8");
    const r1 = classifyCandidate(tmpDir3, "DRIVER-EDIT", {}, { authorizedRoot: "/home/yale/work", workspacePaths: [] });
    check("classify-driver-edit", r1.humanSteered === true && r1.clauses.driverFileEdit === true, `driverFileEdit: ${r1.detail}`);

    // Case 2: task touching only packages/ → humanSteered: false
    fs.writeFileSync(path.join(tasksDir2, "NON-DRIVER.md"), "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/gate/engine.ts`\n- `packages/quay-native/src/provider.ts`\n", "utf8");
    const r2 = classifyCandidate(tmpDir3, "NON-DRIVER", {}, { authorizedRoot: "/home/yale/work", workspacePaths: [] });
    check("classify-non-driver", r2.humanSteered === false, `autonomous-eligible: ${r2.detail}`);

    // Case 3: task with missionRedirection extra → humanSteered: true
    const r3 = classifyCandidate(tmpDir3, "NON-DRIVER", { missionRedirection: true }, { authorizedRoot: "/home/yale/work", workspacePaths: [] });
    check("classify-mission-redirection", r3.humanSteered === true && r3.clauses.missionRedirection === true, `missionRedirection: ${r3.detail}`);

    // Case 4: task with unauthorized workspace → humanSteered: true
    const r4 = classifyCandidate(tmpDir3, "NON-DRIVER", { drivenWorkspaces: ["/opt/outside"] }, { authorizedRoot: "/home/yale/work", workspacePaths: [] });
    check("classify-unauthorized-workspace", r4.humanSteered === true && r4.clauses.unauthorizedWorkspace === true, `unauthorizedWorkspace: ${r4.detail}`);

    // Case 5: task with driven workspaces ALL covered → humanSteered: false
    const r5 = classifyCandidate(tmpDir3, "NON-DRIVER", { drivenWorkspaces: ["/home/yale/work/quay", "/home/yale/work/archguard"] }, { authorizedRoot: "/home/yale/work", workspacePaths: [] });
    check("classify-covered-workspaces", r5.humanSteered === false, `covered: ${r5.detail}`);

    // Case 6: task touching .claude/skills/ file → humanSteered: true (driverFileEdit)
    fs.writeFileSync(path.join(tasksDir2, "SKILL-EDIT.md"), "## Proposal\ntest\n\n## Touches\n\n- `.claude/skills/quay-directive/SKILL.md`\n", "utf8");
    const r6 = classifyCandidate(tmpDir3, "SKILL-EDIT", {}, { authorizedRoot: "/home/yale/work", workspacePaths: [] });
    check("classify-skill-edit", r6.humanSteered === true && r6.clauses.driverFileEdit === true, `skill-edit: ${r6.detail}`);
  } finally {
    fs.rmSync(tmpDir3, { recursive: true, force: true });
  }

  // ── M181 fix: computeHumanSteered / isEpicBlockedByHumanSteeredChildren (RED/GREEN pairs) ──
  const tmpDir5 = fs.mkdtempSync("select-preflight-selftest-m181-");
  try {
    const tasksDir4 = path.join(tmpDir5, "tasks");
    fs.mkdirSync(tasksDir4, { recursive: true });
    const registry: Registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };

    // ── Case 1 (direct label): a task carrying label:human-steered but touching only clean,
    // non-driver files → the classifier ALONE (pre-fix behavior) says false; computeHumanSteered
    // (post-fix) ORs in the label and says true.
    fs.writeFileSync(
      path.join(tasksDir4, "LABELED-HS.md"),
      "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/gate/engine.ts`\n",
      "utf8",
    );
    // RED: documents the pre-fix leak — classifyCandidate alone never sees the label.
    const redLabel = classifyCandidate(tmpDir5, "LABELED-HS", {}, registry);
    check(
      "m181-case1-RED-classifier-alone-misses-label",
      redLabel.humanSteered === false,
      `pre-fix leak reproduced: classifier-only verdict=${redLabel.humanSteered} (should be false, proving the label was ignored)`,
    );
    // GREEN: computeHumanSteered ORs the direct label in → true.
    const greenLabel = computeHumanSteered(tmpDir5, "LABELED-HS", ["human-steered"], {}, registry);
    check(
      "m181-case1-GREEN-computeHumanSteered-catches-label",
      greenLabel.humanSteered === true && /label:human-steered \(direct\)/.test(greenLabel.detail),
      `fixed verdict=${greenLabel.humanSteered}, detail=${greenLabel.detail}`,
    );

    // ── Case 2 (epic-with-human-steered-only-child): an epic with one done child and one open
    // child that carries label:human-steered (touching clean files, so the classifier alone would
    // say the CHILD is false too — this isolates the label-OR fix as the thing that closes case 2).
    fs.writeFileSync(
      path.join(tasksDir4, "CHILD-DONE.md"),
      "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/a.ts`\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tasksDir4, "CHILD-HS.md"),
      "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/b.ts`\n",
      "utf8",
    );
    const tasksById = new Map<string, any>([
      ["CHILD-DONE", { id: "CHILD-DONE", status: "done", labels: [], extra: {} }],
      ["CHILD-HS", { id: "CHILD-HS", status: "todo", labels: ["human-steered"], extra: {} }],
    ]);
    // RED: documents the pre-fix leak — the epic's OWN label/classifier is clean, so a check that
    // only looks at the epic itself (not its children) would say false (eligible), even though its
    // one open child is human-steered.
    const redEpic = computeHumanSteered(tmpDir5, "EPIC", [], {}, registry);
    check(
      "m181-case2-RED-epic-own-classification-misses-blocked-child",
      redEpic.humanSteered === false,
      `pre-fix leak reproduced: epic's own verdict=${redEpic.humanSteered} (should be false — the epic itself has no driver-file/label signal; only walking children reveals the block)`,
    );
    // GREEN: isEpicBlockedByHumanSteeredChildren walks the open children and finds them ALL
    // human-steered → epic correctly excluded.
    const greenEpic = isEpicBlockedByHumanSteeredChildren(tmpDir5, ["CHILD-DONE", "CHILD-HS"], tasksById, registry);
    check(
      "m181-case2-GREEN-epic-blocked-by-open-human-steered-child",
      greenEpic === true,
      `epicBlocked=${greenEpic} (expected true — CHILD-DONE is done/ignored, CHILD-HS is the sole open child and is human-steered)`,
    );

    // ── Regression (Done-when #5): a genuinely autonomous-eligible epic (no label, classifier
    // clean on every open child) is NOT blocked.
    const tasksByIdClean = new Map<string, any>([
      ["CHILD-DONE", { id: "CHILD-DONE", status: "done", labels: [], extra: {} }],
      ["CHILD-CLEAN", { id: "CHILD-HS", status: "todo", labels: [], extra: {} }],
    ]);
    fs.writeFileSync(
      path.join(tasksDir4, "CHILD-HS.md"),
      "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/b.ts`\n",
      "utf8",
    );
    const cleanEpicBlocked = isEpicBlockedByHumanSteeredChildren(tmpDir5, ["CHILD-DONE", "CHILD-HS"], tasksByIdClean, registry);
    check(
      "m181-regression-clean-epic-not-blocked",
      cleanEpicBlocked === false,
      `epicBlocked=${cleanEpicBlocked} (expected false — CHILD-HS here carries no label and touches only clean files)`,
    );

    // Vacuous case: an epic with zero currently-open children (all done) is NOT blocked by this
    // rule — nothing to test, falls through to the epic's own classification.
    const tasksByIdAllDone = new Map<string, any>([
      ["CHILD-DONE", { id: "CHILD-DONE", status: "done", labels: [], extra: {} }],
    ]);
    const allDoneBlocked = isEpicBlockedByHumanSteeredChildren(tmpDir5, ["CHILD-DONE"], tasksByIdAllDone, registry);
    check(
      "m181-vacuous-all-children-done-not-blocked",
      allDoneBlocked === false,
      `epicBlocked=${allDoneBlocked} (expected false — no open children to block on)`,
    );

    // hasHumanSteeredLabel: case-insensitive, absent/non-array-safe.
    check("m181-hasHumanSteeredLabel-true", hasHumanSteeredLabel(["Human-Steered"]) === true, "case-insensitive match");
    check("m181-hasHumanSteeredLabel-false", hasHumanSteeredLabel(["defect"]) === false, "no match");
    check("m181-hasHumanSteeredLabel-null-safe", hasHumanSteeredLabel(null) === false, "null-safe");
  } finally {
    fs.rmSync(tmpDir5, { recursive: true, force: true });
  }

  // ── getCandidateParsedTouches / scanOrthogonalPairs (DIR-113 item 3) ──
  const tmpDir4 = fs.mkdtempSync("select-preflight-selftest-orthoscan-");
  try {
    const tasksDir3 = path.join(tmpDir4, "tasks");
    fs.mkdirSync(tasksDir3, { recursive: true });

    // DECLARED Touches wins over auto-derivation.
    fs.writeFileSync(
      path.join(tasksDir3, "DECLARED.md"),
      "## Requested action\nUpdate `some/other/mentioned.ts`.\n\n## Touches\n\n- `packages/quay/src/a.ts`\n",
      "utf8",
    );
    const declared = getCandidateParsedTouches(tmpDir4, "DECLARED");
    check(
      "parsed-touches-declared-wins",
      declared.source === "declared" && declared.hasSection === true && declared.globs.includes("packages/quay/src/a.ts") && !declared.globs.includes("some/other/mentioned.ts"),
      JSON.stringify(declared),
    );

    // NO Touches section, but the body names a resolvable file in the SAME scratch tree (both the
    // task file and the target live under tmpDir4, matching how getCandidateParsedTouches always
    // resolves bare filenames against `workspaceRoot`) → auto-derived fallback fires.
    fs.mkdirSync(path.join(tmpDir4, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir4, "src", "widget.ts"), "x");
    fs.writeFileSync(
      path.join(tasksDir3, "NO-DECLARED.md"),
      "## Requested action\nUpdate `widget.ts`.\n",
      "utf8",
    );
    const autoDerived = getCandidateParsedTouches(tmpDir4, "NO-DECLARED");
    check(
      "parsed-touches-auto-derived-fallback",
      autoDerived.source === "auto-derived" && autoDerived.hasSection === true && autoDerived.globs.includes("src/widget.ts"),
      JSON.stringify(autoDerived),
    );

    // NO Touches, and nothing in the body resolves → conservative "none".
    fs.writeFileSync(path.join(tasksDir3, "NEITHER.md"), "## Requested action\nDo the thing (no file mentions).\n", "utf8");
    const neither = getCandidateParsedTouches(tmpDir4, "NEITHER");
    check("parsed-touches-none-when-nothing-resolves", neither.source === "none" && neither.hasSection === false, JSON.stringify(neither));

    // Missing task file → conservative "none", never throws.
    const missing = getCandidateParsedTouches(tmpDir4, "DOES-NOT-EXIST");
    check("parsed-touches-missing-file-is-none", missing.source === "none" && missing.globs.length === 0, JSON.stringify(missing));

    // ── scanOrthogonalPairs ──
    fs.writeFileSync(
      path.join(tasksDir3, "ORTHO-A.md"),
      "## Touches\n\n- `packages/quay/src/gate/a.ts`\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tasksDir3, "ORTHO-B.md"),
      "## Touches\n\n- `packages/quay-native/src/b.ts`\n",
      "utf8",
    );
    fs.mkdirSync(path.join(tmpDir4, "packages", "quay", "src", "gate"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir4, "packages", "quay-native", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir4, "packages", "quay", "src", "gate", "a.ts"), "x");
    fs.writeFileSync(path.join(tmpDir4, "packages", "quay-native", "src", "b.ts"), "x");

    const orthoCandidates: CandidateEntry[] = [
      { id: "ORTHO-A", title: "A", rank: 1, labels: [], extra: {}, schemaPass: true, schemaDetail: "", hasTouches: true, humanSteered: false, classifyDetail: "" },
      { id: "ORTHO-B", title: "B", rank: 2, labels: [], extra: {}, schemaPass: true, schemaDetail: "", hasTouches: true, humanSteered: false, classifyDetail: "" },
    ];
    const scanFound = scanOrthogonalPairs(tmpDir4, orthoCandidates);
    check(
      "scan-finds-orthogonal-pair",
      scanFound.pairs.length === 1 && scanFound.pairs[0].a === "ORTHO-A" && scanFound.pairs[0].b === "ORTHO-B",
      JSON.stringify(scanFound),
    );
    check("scan-log-non-empty-on-found", scanFound.log.length >= 1 && /ORTHOGONAL PAIR FOUND/.test(scanFound.log[0]), scanFound.log.join(" | "));

    // Overlapping candidates → NO orthogonal pair, but log is still non-empty and explicit.
    fs.writeFileSync(
      path.join(tasksDir3, "OVERLAP-A.md"),
      "## Touches\n\n- `packages/quay/src/gate/a.ts`\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tasksDir3, "OVERLAP-B.md"),
      "## Touches\n\n- `packages/quay/src/gate/a.ts`\n",
      "utf8",
    );
    const overlapCandidates: CandidateEntry[] = [
      { id: "OVERLAP-A", title: "A", rank: 1, labels: [], extra: {}, schemaPass: true, schemaDetail: "", hasTouches: true, humanSteered: false, classifyDetail: "" },
      { id: "OVERLAP-B", title: "B", rank: 2, labels: [], extra: {}, schemaPass: true, schemaDetail: "", hasTouches: true, humanSteered: false, classifyDetail: "" },
    ];
    const scanNone = scanOrthogonalPairs(tmpDir4, overlapCandidates);
    check("scan-no-pair-when-overlapping", scanNone.pairs.length === 0, JSON.stringify(scanNone));
    check("scan-log-explicit-on-none-found", scanNone.log.length >= 1 && /NO ORTHOGONAL PAIR/.test(scanNone.log[0]), scanNone.log.join(" | "));

    // Empty candidate list → still produces an explicit non-silent log line.
    const scanEmpty = scanOrthogonalPairs(tmpDir4, []);
    check("scan-log-explicit-on-empty-candidates", scanEmpty.log.length >= 1 && /NO ORTHOGONAL PAIR/.test(scanEmpty.log[0]), scanEmpty.log.join(" | "));
  } finally {
    fs.rmSync(tmpDir4, { recursive: true, force: true });
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
  // DIR-113 item 3: emit the pre-charter orthogonality scan's log to stderr EXPLICITLY, in
  // addition to it being part of the JSON payload below — this is the record that must exist
  // before any charter-authoring fork gets dispatched, so it must not depend on a caller
  // remembering to parse the JSON for it.
  for (const line of result.orthogonalScan.log) {
    console.error(`[select-preflight] ${line}`);
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

const isDirect = isDirectEntry(import.meta);
if (isDirect) {
  main(process.argv);
  // Don't process.exit — let the script finish naturally
}
