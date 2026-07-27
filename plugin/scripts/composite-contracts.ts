// composite-contracts.ts — M189/DIR-119-B Stage 2.2: mechanical composite contract + phase DAG
// checker (plan doc §Phase 2 / Stage 2.2). Proves, for a `CompositeManifest`:
//   - task membership matches the candidate/charter/Plan;
//   - every task's AC maps to >=1 phase AND >=1 audit shard;
//   - every shared phase (taskIds.length > 1) maps to a declared integration invariant;
//   - phase dependencies are acyclic;
//   - union touches/semantic resources are complete;
//   - no forbidden (prohibiting) temporal coupling edge is internalized within the membership;
//   - phase/audit-shard/line capacity is valid;
//   - the Land policy is atomic.
//
// Pure, fixture-driven, NO I/O — mirrors candidate-contracts.ts's style. `checkCompositeContract`
// is the ONE place this shape gets validated; callers (the execute-milestone workflow's Verify
// phase, via a thin CLI wrapper) import from here rather than re-deriving the rules.

import { isProhibiting, type CouplingKind } from "./candidate-contracts.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface CompositePhase {
  id: string;
  /** Tasks whose work this phase covers. length > 1 = a shared/overlapping phase. */
  taskIds: string[];
  /** Phase ids that must complete before this phase may start. */
  requires: string[];
  /** Audit shard ids that cover this phase. */
  auditShardIds: string[];
  /** REQUIRED when taskIds.length > 1 — the integration invariant this shared phase upholds. */
  integrationInvariant?: string;
}

export interface CompositeAuditShard {
  id: string;
  kind: "task-ac" | "semantic-integration" | "wiring-system";
  /** Tasks this shard produces verdicts for — one shard MAY cover several homogeneous tasks. */
  taskIds: string[];
}

export interface CompositeManifest {
  version: 1;
  candidateId: string;
  taskIds: string[];
  phases: CompositePhase[];
  auditShards: CompositeAuditShard[];
  touches: string[];
  semanticResources: string[];
  landPolicy: "atomic";
}

export interface CapacityLimits {
  maxPhases: number;
  maxAuditShards: number;
  /** Optional: per-task line estimate + aggregate cap. Omit either to skip the line-budget check. */
  taskLineEstimates?: Record<string, number>;
  maxTotalLines?: number;
}

export interface CompositeContext {
  /** MilestoneCandidate.taskIds — must set-equal manifest.taskIds. */
  candidateTaskIds: string[];
  /** Task ids the charter's Scope/Done-when actually names — must set-equal manifest.taskIds. */
  charterTaskIds: string[];
  /** AC count per task; a task with acCount > 0 must be covered by >=1 phase and >=1 audit shard. */
  taskAcCounts: Record<string, number>;
  taskTouches: Record<string, string[]>;
  taskSemanticResources: Record<string, string[]>;
  /** Coupling edges to check for prohibited-kind internalization within the manifest's membership. */
  forbiddenEdges: Array<{ a: string; b: string; kind: CouplingKind }>;
  capacity: CapacityLimits;
}

export interface CompositeContractResult {
  ok: boolean;
  violations: string[];
}

// ── checkCompositeContract ─────────────────────────────────────────────────────────────────────────

export function checkCompositeContract(manifest: CompositeManifest, ctx: CompositeContext): CompositeContractResult {
  const violations: string[] = [];

  // 1. Membership matches candidate AND charter.
  const manifestSet = new Set(manifest.taskIds);
  if (!setsEqual(manifestSet, new Set(ctx.candidateTaskIds))) {
    violations.push(`membership-mismatch-candidate: manifest=${sorted(manifestSet)} candidate=${sorted(ctx.candidateTaskIds)}`);
  }
  if (!setsEqual(manifestSet, new Set(ctx.charterTaskIds))) {
    violations.push(`membership-mismatch-charter: manifest=${sorted(manifestSet)} charter=${sorted(ctx.charterTaskIds)}`);
  }

  // 2. Every task's AC maps to >=1 phase and >=1 audit shard.
  for (const taskId of manifest.taskIds) {
    const acCount = ctx.taskAcCounts[taskId] ?? 0;
    if (acCount <= 0) continue; // nothing to cover
    const coveringPhases = manifest.phases.filter((p) => p.taskIds.includes(taskId));
    if (coveringPhases.length === 0) violations.push(`no-phase-covers-task-ac: ${taskId}`);
    const coveringShards = manifest.auditShards.filter((s) => s.taskIds.includes(taskId));
    if (coveringShards.length === 0) violations.push(`no-audit-shard-covers-task-ac: ${taskId}`);
  }

  // 3. Shared/overlapping phases declare an integration invariant.
  for (const p of manifest.phases) {
    if (p.taskIds.length > 1 && !p.integrationInvariant) {
      violations.push(`shared-phase-missing-integration-invariant: ${p.id}`);
    }
  }

  // 4. Phase dependencies are acyclic.
  const cycleAt = findPhaseCycle(manifest.phases);
  if (cycleAt) violations.push(`phase-dependency-cycle: ${cycleAt}`);

  // 5. Union touches / semantic resources are complete (manifest declares >= the real union).
  const unionTouches = unionOf(manifest.taskIds, ctx.taskTouches);
  for (const g of unionTouches) {
    if (!manifest.touches.includes(g)) violations.push(`touches-incomplete: missing ${g}`);
  }
  const unionResources = unionOf(manifest.taskIds, ctx.taskSemanticResources);
  for (const r of unionResources) {
    if (!manifest.semanticResources.includes(r)) violations.push(`semantic-resources-incomplete: missing ${r}`);
  }

  // 6. No forbidden (prohibiting) temporal coupling edge internalized within this membership.
  for (const e of ctx.forbiddenEdges) {
    if (manifestSet.has(e.a) && manifestSet.has(e.b) && isProhibiting(e.kind)) {
      violations.push(`forbidden-temporal-edge-internalized: ${e.a}<->${e.b} (${e.kind})`);
    }
  }

  // 7. Capacity valid.
  if (manifest.phases.length > ctx.capacity.maxPhases) {
    violations.push(`phase-count-over-capacity: ${manifest.phases.length} > ${ctx.capacity.maxPhases}`);
  }
  if (manifest.auditShards.length > ctx.capacity.maxAuditShards) {
    violations.push(`audit-shard-count-over-capacity: ${manifest.auditShards.length} > ${ctx.capacity.maxAuditShards}`);
  }
  if (ctx.capacity.maxTotalLines != null && ctx.capacity.taskLineEstimates) {
    const total = manifest.taskIds.reduce((sum, t) => sum + (ctx.capacity.taskLineEstimates![t] ?? 0), 0);
    if (total > ctx.capacity.maxTotalLines) {
      violations.push(`total-line-estimate-over-capacity: ${total} > ${ctx.capacity.maxTotalLines}`);
    }
  }

  // 8. Land is atomic.
  if (manifest.landPolicy !== "atomic") {
    violations.push(`land-policy-not-atomic: ${String(manifest.landPolicy)}`);
  }

  return { ok: violations.length === 0, violations };
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function sorted(xs: Iterable<string>): string {
  return JSON.stringify([...xs].sort());
}

function unionOf(taskIds: string[], byTask: Record<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const t of taskIds) for (const v of byTask[t] ?? []) out.add(v);
  return out;
}

function findPhaseCycle(phases: CompositePhase[]): string | null {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const p of phases) color.set(p.id, WHITE);
  let cycleNode: string | null = null;

  function visit(id: string): boolean {
    color.set(id, GRAY);
    const p = byId.get(id);
    for (const dep of p?.requires ?? []) {
      if (!byId.has(dep)) continue; // dangling dependency — not this checker's concern
      const c = color.get(dep);
      if (c === GRAY) {
        cycleNode = dep;
        return true;
      }
      if (c === WHITE && visit(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const p of phases) {
    if (color.get(p.id) === WHITE) {
      if (visit(p.id)) return cycleNode;
    }
  }
  return null;
}

// ── fixtures (Done-when clause 2: valid 1/3/5/10-task arrays + fail-closed negative fixtures) ────────

const GENEROUS_CAPACITY: CapacityLimits = { maxPhases: 100, maxAuditShards: 100 };

/** Build a trivially-valid manifest+context for `n` tasks — one phase and one audit shard per task,
 *  no sharing, no coupling edges, capacity generous. Used to prove width alone never fails the checker. */
export function makeValidCompositeFixture(n: number): { manifest: CompositeManifest; ctx: CompositeContext } {
  const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
  const phases: CompositePhase[] = taskIds.map((t) => ({
    id: `phase-${t}`,
    taskIds: [t],
    requires: [],
    auditShardIds: [`shard-${t}`],
  }));
  const auditShards: CompositeAuditShard[] = taskIds.map((t) => ({
    id: `shard-${t}`,
    kind: "task-ac",
    taskIds: [t],
  }));
  const touches = taskIds.map((t) => `packages/quay/src/${t}.ts`);
  const manifest: CompositeManifest = {
    version: 1,
    candidateId: `composite-${n}`,
    taskIds,
    phases,
    auditShards,
    touches,
    semanticResources: [],
    landPolicy: "atomic",
  };
  const ctx: CompositeContext = {
    candidateTaskIds: taskIds,
    charterTaskIds: taskIds,
    taskAcCounts: Object.fromEntries(taskIds.map((t) => [t, 2])),
    taskTouches: Object.fromEntries(taskIds.map((t, i) => [t, [touches[i]]])),
    taskSemanticResources: Object.fromEntries(taskIds.map((t) => [t, []])),
    forbiddenEdges: [],
    capacity: GENEROUS_CAPACITY,
  };
  return { manifest, ctx };
}

/** A valid fixture with ONE shared phase covering all n tasks (proves the shared-phase +
 *  integration-invariant path, distinct from the fully-independent-phases fixture above). */
export function makeSharedPhaseCompositeFixture(n: number): { manifest: CompositeManifest; ctx: CompositeContext } {
  const { manifest, ctx } = makeValidCompositeFixture(n);
  const sharedPhase: CompositePhase = {
    id: "phase-shared-integration",
    taskIds: [...manifest.taskIds],
    requires: manifest.phases.map((p) => p.id),
    auditShardIds: ["shard-integration"],
    integrationInvariant: "all member tasks land in one consistent candidate branch",
  };
  const integrationShard: CompositeAuditShard = {
    id: "shard-integration",
    kind: "semantic-integration",
    taskIds: [...manifest.taskIds],
  };
  return {
    manifest: { ...manifest, phases: [...manifest.phases, sharedPhase], auditShards: [...manifest.auditShards, integrationShard] },
    ctx,
  };
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

  // Valid fixtures at widths 1, 3, 5, 10 all pass.
  for (const n of [1, 3, 5, 10]) {
    const { manifest, ctx } = makeValidCompositeFixture(n);
    const result = checkCompositeContract(manifest, ctx);
    check(`valid-fixture-width-${n}-passes`, result.ok, JSON.stringify(result.violations));
  }

  // Shared-phase fixture (integration invariant present) passes at width 3.
  {
    const { manifest, ctx } = makeSharedPhaseCompositeFixture(3);
    const result = checkCompositeContract(manifest, ctx);
    check("shared-phase-fixture-passes", result.ok, JSON.stringify(result.violations));
  }

  // Shared-phase fixture WITHOUT integration invariant fails closed.
  {
    const { manifest, ctx } = makeSharedPhaseCompositeFixture(3);
    const broken = { ...manifest, phases: manifest.phases.map((p) => (p.taskIds.length > 1 ? { ...p, integrationInvariant: undefined } : p)) };
    const result = checkCompositeContract(broken, ctx);
    check(
      "missing-integration-invariant-fails-closed",
      !result.ok && result.violations.some((v) => v.startsWith("shared-phase-missing-integration-invariant")),
      JSON.stringify(result.violations),
    );
  }

  // Membership mismatch (candidate has an extra task not in the manifest) fails closed.
  {
    const { manifest, ctx } = makeValidCompositeFixture(3);
    const badCtx = { ...ctx, candidateTaskIds: [...ctx.candidateTaskIds, "T-EXTRA"] };
    const result = checkCompositeContract(manifest, badCtx);
    check(
      "membership-mismatch-fails-closed",
      !result.ok && result.violations.some((v) => v.startsWith("membership-mismatch-candidate")),
      JSON.stringify(result.violations),
    );
  }

  // Uncovered AC (a task with acCount>0 but no phase covers it) fails closed.
  {
    const { manifest, ctx } = makeValidCompositeFixture(3);
    const broken = { ...manifest, phases: manifest.phases.filter((p) => !p.taskIds.includes("T-1")) };
    const result = checkCompositeContract(broken, ctx);
    check(
      "uncovered-ac-fails-closed",
      !result.ok && result.violations.includes("no-phase-covers-task-ac: T-1"),
      JSON.stringify(result.violations),
    );
  }

  // Cyclic phase dependency fails closed.
  {
    const { manifest, ctx } = makeValidCompositeFixture(3);
    const cyclic = {
      ...manifest,
      phases: manifest.phases.map((p, i) => (i === 0 ? { ...p, requires: [manifest.phases[1].id] } : i === 1 ? { ...p, requires: [manifest.phases[0].id] } : p)),
    };
    const result = checkCompositeContract(cyclic, ctx);
    check("phase-cycle-fails-closed", !result.ok && result.violations.some((v) => v.startsWith("phase-dependency-cycle")), JSON.stringify(result.violations));
  }

  // Forbidden temporal edge (next-generation) internalized within membership fails closed.
  {
    const { manifest, ctx } = makeValidCompositeFixture(3);
    const badCtx = { ...ctx, forbiddenEdges: [{ a: "T-0", b: "T-1", kind: "next-generation" as CouplingKind }] };
    const result = checkCompositeContract(manifest, badCtx);
    check(
      "forbidden-temporal-edge-fails-closed",
      !result.ok && result.violations.some((v) => v.startsWith("forbidden-temporal-edge-internalized")),
      JSON.stringify(result.violations),
    );
  }

  // A merely-SUPPORTING edge (not prohibiting) among members does NOT fail the check.
  {
    const { manifest, ctx } = makeValidCompositeFixture(3);
    const okCtx = { ...ctx, forbiddenEdges: [{ a: "T-0", b: "T-1", kind: "shared-implementation" as CouplingKind }] };
    const result = checkCompositeContract(manifest, okCtx);
    check("supporting-edge-does-not-fail", result.ok, JSON.stringify(result.violations));
  }

  // Over-capacity (phase count) fails closed.
  {
    const { manifest, ctx } = makeValidCompositeFixture(5);
    const tightCtx = { ...ctx, capacity: { ...ctx.capacity, maxPhases: 2 } };
    const result = checkCompositeContract(manifest, tightCtx);
    check("phase-over-capacity-fails-closed", !result.ok && result.violations.some((v) => v.startsWith("phase-count-over-capacity")), JSON.stringify(result.violations));
  }

  // Over-capacity (total line budget) fails closed.
  {
    const { manifest, ctx } = makeValidCompositeFixture(5);
    const lineCtx = {
      ...ctx,
      capacity: { ...ctx.capacity, taskLineEstimates: Object.fromEntries(manifest.taskIds.map((t) => [t, 500])), maxTotalLines: 1000 },
    };
    const result = checkCompositeContract(manifest, lineCtx);
    check("line-budget-over-capacity-fails-closed", !result.ok && result.violations.some((v) => v.startsWith("total-line-estimate-over-capacity")), JSON.stringify(result.violations));
  }

  // Non-atomic Land policy fails closed.
  {
    const { manifest, ctx } = makeValidCompositeFixture(1);
    const partial = { ...manifest, landPolicy: "partial" as unknown as "atomic" };
    const result = checkCompositeContract(partial, ctx);
    check("non-atomic-land-policy-fails-closed", !result.ok && result.violations.some((v) => v.startsWith("land-policy-not-atomic")), JSON.stringify(result.violations));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (process.argv[1] != null && process.argv[1].endsWith("composite-contracts.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
