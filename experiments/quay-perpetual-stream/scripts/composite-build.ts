// composite-build.ts — M189/DIR-119-B Stage 2.3: Build phase execution over a checked phase DAG.
//
// Consumes a `CompositePhase[]` (already validated by composite-contracts.ts) and produces an
// execution plan: shared/overlapping phases get exactly ONE owner, independent phases MAY be
// grouped for parallel dispatch within a resource budget, and task count never determines agent
// count (a "serialize" plan collapses to agentCount===1 regardless of width; a "parallel" plan
// caps agent count independently of task count). Also maps Build evidence (files/commits/tests)
// back to BOTH tasks and phases for the iteration report (Stage 2.3's own requirement).
//
// Per the milestone's own scope note: "First implementation MAY serialize all phases through one
// Build lead if parallel dispatch is unavailable — the CONTRACT must still be arbitrary-width/
// phase-based even if the first implementation is conservative." `mode: "serialize"` is the
// default for exactly that reason; `mode: "parallel"` is offered so the CONTRACT already supports
// fan-out once a caller is ready to use it.

import fs from "node:fs";
import type { CompositePhase } from "./composite-contracts.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface PhaseExecutionPlan {
  /** Phase ids grouped into ordered batches — batch i+1 only starts once batch i's phases finish. */
  batches: string[][];
  /** Single owner per phase id — shared phases still resolve to exactly one owner. */
  owners: Record<string, string>;
  /** Distinct owners across the whole plan. Independent of `phases.length`/task count. */
  agentCount: number;
}

export interface PlanOpts {
  mode?: "serialize" | "parallel";
  /** Only meaningful in "parallel" mode: caps distinct concurrent owners regardless of phase/task count. */
  maxParallelAgents?: number;
}

// ── planPhaseExecution ─────────────────────────────────────────────────────────────────────────────

export function planPhaseExecution(phases: CompositePhase[], opts: PlanOpts = {}): PhaseExecutionPlan {
  const mode = opts.mode ?? "serialize";
  const order = topoOrder(phases);

  if (mode === "serialize") {
    // One Build lead handles every phase, in dependency order — agentCount is always 1,
    // regardless of how many phases/tasks are in the DAG (the conservative first-implementation path).
    const owners: Record<string, string> = {};
    for (const id of order) owners[id] = "build-lead-0";
    return { batches: order.map((id) => [id]), owners, agentCount: 1 };
  }

  // Parallel: group phases into dependency-depth batches. Phases in the same batch have no
  // unmet dependency on each other and MAY dispatch concurrently, capped by maxParallelAgents.
  const byId = new Map(phases.map((p) => [p.id, p]));
  const depthOf = new Map<string, number>();
  for (const id of order) {
    const p = byId.get(id)!;
    const d = p.requires.length > 0 ? Math.max(...p.requires.map((r) => depthOf.get(r) ?? 0)) + 1 : 0;
    depthOf.set(id, d);
  }
  const maxDepth = order.length > 0 ? Math.max(...order.map((id) => depthOf.get(id) ?? 0)) : -1;
  const batches: string[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    batches.push(order.filter((id) => depthOf.get(id) === d));
  }

  const maxAgents = opts.maxParallelAgents ?? Infinity;
  const owners: Record<string, string> = {};
  let cursor = 0;
  for (const batch of batches) {
    for (const phaseId of batch) {
      const ownerIndex = maxAgents === Infinity ? cursor : cursor % maxAgents;
      owners[phaseId] = `build-agent-${ownerIndex}`;
      cursor++;
    }
  }
  const agentCount = new Set(Object.values(owners)).size;
  return { batches, owners, agentCount };
}

// ── topoOrder (Kahn's algorithm; assumes acyclic — composite-contracts.ts checks that upstream) ─────

function topoOrder(phases: CompositePhase[]): string[] {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const indegree = new Map<string, number>();
  for (const p of phases) indegree.set(p.id, 0);
  for (const p of phases) {
    for (const dep of p.requires) {
      if (!byId.has(dep)) continue; // dangling — not this module's concern
      indegree.set(p.id, (indegree.get(p.id) ?? 0) + 1);
    }
  }
  const queue: string[] = phases.filter((p) => (indegree.get(p.id) ?? 0) === 0).map((p) => p.id);
  const dependents = new Map<string, string[]>();
  for (const p of phases) {
    for (const dep of p.requires) {
      if (!byId.has(dep)) continue;
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(p.id);
    }
  }
  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const dep of dependents.get(id) ?? []) {
      indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      if (indegree.get(dep) === 0) queue.push(dep);
    }
  }
  // If a cycle exists, `out` will be shorter than `phases` — append remaining in declaration
  // order so callers still get a deterministic (if not dependency-correct) full list.
  if (out.length < phases.length) {
    const seen = new Set(out);
    for (const p of phases) if (!seen.has(p.id)) out.push(p.id);
  }
  return out;
}

// ── Evidence mapping (Stage 2.3: iteration report maps files/commits/tests/evidence back to tasks
// AND phases) ──────────────────────────────────────────────────────────────────────────────────────

export interface PhaseEvidence {
  phaseId: string;
  files: string[];
  commits: string[];
  tests: string[];
}

export interface TaskEvidenceReport {
  taskId: string;
  files: string[];
  commits: string[];
  tests: string[];
  phaseIds: string[];
}

export function mapEvidenceToTasks(phases: CompositePhase[], evidence: PhaseEvidence[]): TaskEvidenceReport[] {
  const byTask = new Map<string, TaskEvidenceReport>();
  const evidenceByPhase = new Map(evidence.map((e) => [e.phaseId, e]));
  for (const p of phases) {
    const ev = evidenceByPhase.get(p.id);
    if (!ev) continue;
    for (const taskId of p.taskIds) {
      if (!byTask.has(taskId)) byTask.set(taskId, { taskId, files: [], commits: [], tests: [], phaseIds: [] });
      const rec = byTask.get(taskId)!;
      rec.files.push(...ev.files);
      rec.commits.push(...ev.commits);
      rec.tests.push(...ev.tests);
      rec.phaseIds.push(p.id);
    }
  }
  for (const rec of byTask.values()) {
    rec.files = [...new Set(rec.files)];
    rec.commits = [...new Set(rec.commits)];
    rec.tests = [...new Set(rec.tests)];
  }
  return [...byTask.values()];
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────────

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

  const mkPhases = (n: number): CompositePhase[] =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, taskIds: [`T-${i}`], requires: [], auditShardIds: [] }));

  // Serialize mode: agentCount is always 1 regardless of width (1, 3, 5, 10).
  for (const n of [1, 3, 5, 10]) {
    const plan = planPhaseExecution(mkPhases(n), { mode: "serialize" });
    check(`serialize-agentcount-1-at-width-${n}`, plan.agentCount === 1, `agentCount=${plan.agentCount}`);
    check(`serialize-batches-cover-all-phases-width-${n}`, plan.batches.flat().length === n, `${plan.batches.flat().length} vs ${n}`);
  }

  // Shared phase: ONE phase covers 5 tasks — even in parallel mode, that phase gets exactly ONE owner
  // (never one owner per task), so task count does not map 1:1 to agent count.
  {
    const sharedPhase: CompositePhase = { id: "shared", taskIds: ["T-0", "T-1", "T-2", "T-3", "T-4"], requires: [], auditShardIds: [] };
    const plan = planPhaseExecution([sharedPhase], { mode: "parallel" });
    check("shared-phase-single-owner", plan.agentCount === 1, `agentCount=${plan.agentCount}`);
  }

  // Parallel mode with independent phases: agentCount is capped by maxParallelAgents, NOT
  // determined by phase/task count — 5 independent phases with a cap of 2 yields agentCount<=2.
  {
    const plan = planPhaseExecution(mkPhases(5), { mode: "parallel", maxParallelAgents: 2 });
    check("parallel-agentcount-capped-below-task-count", plan.agentCount <= 2, `agentCount=${plan.agentCount}`);
    check("parallel-batches-cover-all-phases", plan.batches.flat().length === 5, `${plan.batches.flat().length}`);
  }

  // Dependency ordering respected: phase B requires phase A → A's batch precedes B's batch.
  {
    const phases: CompositePhase[] = [
      { id: "A", taskIds: ["T-0"], requires: [], auditShardIds: [] },
      { id: "B", taskIds: ["T-1"], requires: ["A"], auditShardIds: [] },
    ];
    const plan = planPhaseExecution(phases, { mode: "parallel" });
    const batchOf = (id: string) => plan.batches.findIndex((b) => b.includes(id));
    check("dependency-order-respected", batchOf("A") < batchOf("B"), `A@${batchOf("A")} B@${batchOf("B")}`);
  }

  // Evidence mapping: one phase covering 3 tasks distributes its evidence to all 3 tasks.
  {
    const phases: CompositePhase[] = [{ id: "shared", taskIds: ["T-0", "T-1", "T-2"], requires: [], auditShardIds: [] }];
    const evidence: PhaseEvidence[] = [{ phaseId: "shared", files: ["a.ts"], commits: ["abc123"], tests: ["a.test.mjs"] }];
    const reports = mapEvidenceToTasks(phases, evidence);
    check("evidence-fans-out-to-all-tasks-in-shared-phase", reports.length === 3 && reports.every((r) => r.files.includes("a.ts")), JSON.stringify(reports));
  }

  // Evidence mapping: dedupe across two phases touching the same task.
  {
    const phases: CompositePhase[] = [
      { id: "p0", taskIds: ["T-0"], requires: [], auditShardIds: [] },
      { id: "p1", taskIds: ["T-0"], requires: ["p0"], auditShardIds: [] },
    ];
    const evidence: PhaseEvidence[] = [
      { phaseId: "p0", files: ["a.ts"], commits: ["c1"], tests: [] },
      { phaseId: "p1", files: ["a.ts", "b.ts"], commits: ["c2"], tests: [] },
    ];
    const reports = mapEvidenceToTasks(phases, evidence);
    check("evidence-dedupes-across-phases", reports.length === 1 && reports[0].files.length === 2 && reports[0].phaseIds.length === 2, JSON.stringify(reports));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

// ── Non-selftest JSON CLI modes (M210/DIR-119-D2) ────────────────────────────────────────────────
// PURE WRAPS over the already-exported planPhaseExecution / mapEvidenceToTasks: the ONLY input
// handling is CLI-layer shape normalization — a bare CompositePhase[] is used as-is; the
// {manifest, context} envelope composite-manifest-synthesis.ts writes is unwrapped to
// .manifest.phases (the shape execute-milestone.js's production callsites pass via --phases); any
// other shape exits 1. The planner functions still receive exactly the CompositePhase[] they always
// have — planPhaseExecution/mapEvidenceToTasks/topoOrder/selftest receive ZERO edits (guardrail G7).

function cliFail(message: string): never {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function argvFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** Read a CompositePhase[] from `file`, normalizing the two accepted on-disk shapes. */
function readPhases(file: string | undefined): CompositePhase[] {
  if (!file) cliFail("missing required --phases <file>");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return cliFail(`could not read --phases file ${file}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return cliFail(`--phases file ${file} is not valid JSON: ${(e as Error).message}`);
  }
  if (Array.isArray(parsed)) return parsed as CompositePhase[];
  const phases = (parsed as { manifest?: { phases?: unknown } })?.manifest?.phases;
  if (Array.isArray(phases)) return phases as CompositePhase[];
  return cliFail("--phases file must be a bare CompositePhase[] array or a {manifest, context} envelope with a .manifest.phases array");
}

if (process.argv[1] != null && process.argv[1].endsWith("composite-build.ts")) {
  if (process.argv.includes("--selftest")) {
    process.exitCode = selftest() ? 0 : 1;
  } else if (process.argv.includes("--plan-json")) {
    const phases = readPhases(argvFlag("--phases"));
    const mode = argvFlag("--mode") === "parallel" ? "parallel" : "serialize";
    const maxRaw = argvFlag("--max-parallel-agents");
    const opts: PlanOpts = { mode };
    if (maxRaw != null) opts.maxParallelAgents = Number(maxRaw);
    console.log(JSON.stringify(planPhaseExecution(phases, opts), null, 2));
    process.exitCode = 0;
  } else if (process.argv.includes("--map-evidence-json")) {
    const phases = readPhases(argvFlag("--phases"));
    const evidenceFile = argvFlag("--evidence");
    if (!evidenceFile) cliFail("missing required --evidence <file>");
    let evidence: PhaseEvidence[];
    try {
      evidence = JSON.parse(fs.readFileSync(evidenceFile!, "utf8"));
    } catch (e) {
      evidence = cliFail(`--evidence file ${evidenceFile} missing or not valid JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(evidence)) cliFail("--evidence file must be a bare PhaseEvidence[] array");
    console.log(JSON.stringify(mapEvidenceToTasks(phases, evidence), null, 2));
    process.exitCode = 0;
  }
}
