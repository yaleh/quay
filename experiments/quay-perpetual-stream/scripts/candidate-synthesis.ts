// candidate-synthesis.ts — M188/DIR-119-A Stage 1.3: bounded seed/beam expansion over the coupling
// graph. Produces singleton candidates for EVERY eligible task (compatibility invariant #1) plus
// composite MilestoneCandidate shapes synthesized from ranked seeds.
//
// Deliberately NOT power-set enumeration: for a seed, the search only ever ADDS tasks reachable by a
// supporting coupling edge from an already-included member (never tries arbitrary subsets), so cost is
// linear-ish in edge count, not exponential in task count. There is NO code path anywhere in this
// module that checks or caps `taskIds.length` — a homogeneous 10+ task reconciliation group is exactly
// as representable as a 2-task one (Stage 1.1 fixture d).
//
// `candidate_horizon` (how many DISTINCT shapes we keep per seed) is a synthesis-time knob completely
// independent of execution concurrency (`.quay/loop.yml`'s `concurrency` field) — this module never
// imports or reads that file; portfolio-choice.ts is the ONLY place concurrency enters the pipeline,
// and only as a PORTFOLIO SIZE budget, not a synthesis-time shape limit.

import type { TaskCandidate, MilestoneCandidate, CouplingKind } from "./candidate-contracts.ts";
import { CONTRACT_VERSION, makeSingletonCandidate } from "./candidate-contracts.ts";
import { buildCouplingGraph, hasProhibitingEdge, supportingNeighbors, type CouplingGraph, type BuildCouplingGraphInput } from "./coupling-graph.ts";
import { createSelftest } from "./gate-script-base.ts";

// ── tunable constants (deterministic, no randomness — reproducible replay) ──────────────────────────
export const COORDINATION_COST_PER_EXTRA_TASK = 1;
export const ATOMIC_FAILURE_RATE_PER_EXTRA_TASK = 0.02;
export const SHARED_EDGE_SAVING_FACTOR = 0.5;

export interface SynthesisOptions {
  /** How many distinct composite shapes to retain PER SEED (not a taskIds.length cap — see header).
   * Independent of `.quay/loop.yml` concurrency; defaults to 3 so "multiple comparable shapes" (Stage
   * 1.1 fixture b) has room to surface without unbounded shape explosion. */
  candidateHorizon?: number;
}

const DEFAULT_CANDIDATE_HORIZON = 3;

// ── computeMarginalValue ──────────────────────────────────────────────────────────────────────────
// Value contributed by adding `addition` to a candidate that already contains `existing` — its own
// estimated value, plus a fixed-cost saving for every supporting edge it carries to an existing
// member (bundling avoids the serialize/re-context cost the coupling already implies), minus one
// coordination-cost increment for growing the bundle by one task.
export function computeMarginalValue(existing: TaskCandidate[], addition: TaskCandidate, graph: CouplingGraph): number {
  let saving = 0;
  const edges = graph.byTask.get(addition.id) || [];
  for (const e of edges) {
    const other = e.a === addition.id ? e.b : e.a;
    const otherTask = existing.find((t) => t.id === other);
    if (!otherTask) continue;
    if (e.kind === "shared-implementation" || e.kind === "shared-semantic-resource") {
      saving += SHARED_EDGE_SAVING_FACTOR * Math.min(otherTask.estimatedValue, addition.estimatedValue);
    }
  }
  return addition.estimatedValue + saving - COORDINATION_COST_PER_EXTRA_TASK;
}

// ── computeRequiredClosure ────────────────────────────────────────────────────────────────────────
// Transitive closure of internal-order predecessors of `startId` not already in `existingSet`.
// Returns null when: a required predecessor is ineligible, or a cycle is detected (a predecessor
// chain loops back on itself while still being resolved) — either way the caller must reject the
// whole addition, never partially apply it.
export function computeRequiredClosure(
  existingSet: ReadonlySet<string>,
  startId: string,
  tasksById: Map<string, TaskCandidate>,
  graph: CouplingGraph,
): Set<string> | null {
  const toAdd = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [startId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (existingSet.has(id) || toAdd.has(id)) continue;
    if (visiting.has(id)) return null; // cycle
    visiting.add(id);
    const t = tasksById.get(id);
    if (!t || !t.eligible) return null;
    toAdd.add(id);
    const edges = graph.byTask.get(id) || [];
    for (const e of edges) {
      if (e.kind !== "internal-order") continue;
      if (e.requiresOrder === "a-before-b" && e.b === id && !existingSet.has(e.a) && !toAdd.has(e.a)) {
        stack.push(e.a);
      }
    }
  }
  return toAdd;
}

function anyProhibitingPairIn(ids: Iterable<string>, graph: CouplingGraph): boolean {
  const list = [...ids];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (hasProhibitingEdge(graph, list[i], list[j])) return true;
    }
  }
  return false;
}

// ── hasInternalOrderCycle ─────────────────────────────────────────────────────────────────────────
// True if the internal-order edges induced on `ids` contain a cycle (e.g. A requires B before A, AND
// B requires A before B). computeRequiredClosure alone does not catch every cycle shape — a seed task
// is admitted into the working set WITHOUT validating its own predecessors first, so a cycle that
// only becomes visible once a later addition's requirement points back at the seed is invisible to
// that per-addition walk. This is the single authoritative cycle check candidate-synthesis.ts runs
// against the FULL candidate union before committing any addition — never partially applied.
export function hasInternalOrderCycle(ids: Iterable<string>, graph: CouplingGraph): boolean {
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>();
  for (const id of idSet) adj.set(id, []);
  for (const e of graph.edges) {
    if (e.kind !== "internal-order" || e.requiresOrder !== "a-before-b") continue;
    if (!idSet.has(e.a) || !idSet.has(e.b)) continue;
    adj.get(e.a)!.push(e.b);
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of idSet) color.set(id, WHITE);
  function dfs(u: string): boolean {
    color.set(u, GRAY);
    for (const v of adj.get(u) || []) {
      if (color.get(v) === GRAY) return true;
      if (color.get(v) === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  }
  for (const id of idSet) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}

// ── expandFromSeed ────────────────────────────────────────────────────────────────────────────────
// Bounded beam expansion from one seed. Returns 1-2 shapes (deduped): the "maximal" shape (every
// supporting-reachable, non-prohibited, positive-marginal-value addition, closed over required
// dependencies) and, when the maximal shape grew past a pair, a smaller "best-pair" alternative
// shape — giving multiple COMPARABLE shapes per seed (Stage 1.1 fixture b) rather than one forced
// bundle, without enumerating the power set.
export function expandFromSeed(
  seedId: string,
  tasksById: Map<string, TaskCandidate>,
  graph: CouplingGraph,
): Set<string>[] {
  const seedTask = tasksById.get(seedId);
  if (!seedTask || !seedTask.eligible) return [];

  const candidateSet = new Set<string>([seedId]);
  let changed = true;
  while (changed) {
    changed = false;
    const frontier = new Set<string>();
    for (const memberId of candidateSet) {
      for (const n of supportingNeighbors(graph, memberId)) {
        if (!candidateSet.has(n)) frontier.add(n);
      }
    }
    for (const n of [...frontier].sort()) {
      if (candidateSet.has(n)) continue; // may have been absorbed by a prior closure this pass
      const closure = computeRequiredClosure(candidateSet, n, tasksById, graph);
      if (closure === null) continue; // ineligible dependency or cycle — prune
      const union = new Set([...candidateSet, ...closure]);
      if (anyProhibitingPairIn(union, graph)) continue; // temporal-proof/next-gen/etc — prune
      if (hasInternalOrderCycle(union, graph)) continue; // circular required-dependency — prune
      const existingTasks = [...candidateSet].map((id) => tasksById.get(id)!);
      const additionTasks = [...closure].map((id) => tasksById.get(id)!);
      let marginal = 0;
      const runningExisting = [...existingTasks];
      for (const t of additionTasks) {
        marginal += computeMarginalValue(runningExisting, t, graph);
        runningExisting.push(t);
      }
      if (marginal <= 0) continue; // negative marginal contribution — prune
      for (const id of union) candidateSet.add(id);
      changed = true;
    }
  }

  const shapes: Set<string>[] = [new Set(candidateSet)];

  if (candidateSet.size > 2) {
    const direct = supportingNeighbors(graph, seedId).filter((n) => tasksById.get(n)?.eligible);
    let best: { id: string; closure: Set<string>; value: number } | null = null;
    for (const n of direct.sort()) {
      const closure = computeRequiredClosure(new Set([seedId]), n, tasksById, graph);
      if (closure === null) continue;
      const union = new Set([seedId, ...closure]);
      if (anyProhibitingPairIn(union, graph)) continue;
      if (hasInternalOrderCycle(union, graph)) continue;
      const value = computeMarginalValue([seedTask], tasksById.get(n)!, graph);
      if (value > 0 && (best === null || value > best.value)) best = { id: n, closure, value };
    }
    if (best) shapes.push(new Set([seedId, ...best.closure]));
  }

  const seenKeys = new Set<string>();
  const dedup: Set<string>[] = [];
  for (const s of shapes) {
    const key = [...s].sort().join(",");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    dedup.push(s);
  }
  return dedup;
}

// ── longestChainLineEstimate ──────────────────────────────────────────────────────────────────────
// Longest-path DAG walk over internal-order edges restricted to `taskIds`, summing lineEstimate along
// the chain; tasks with no internal-order edge within the set are independent/parallel branches, so
// their lineEstimate contributes only via max(), never serial-summed with an unrelated branch.
export function longestChainLineEstimate(
  taskIds: string[],
  graph: CouplingGraph,
  tasksById: Map<string, TaskCandidate>,
): number {
  const orderEdges = graph.edges.filter(
    (e) => e.kind === "internal-order" && taskIds.includes(e.a) && taskIds.includes(e.b),
  );
  const predecessors = new Map<string, string[]>();
  for (const id of taskIds) predecessors.set(id, []);
  for (const e of orderEdges) predecessors.get(e.b)!.push(e.a);

  const memo = new Map<string, number>();
  function longestEndingAt(id: string, visiting: Set<string>): number {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return tasksById.get(id)?.lineEstimate ?? 0; // cycle guard, defensive only
    visiting.add(id);
    const preds = predecessors.get(id) || [];
    const self = tasksById.get(id)?.lineEstimate ?? 0;
    let best = self;
    for (const p of preds) best = Math.max(best, longestEndingAt(p, visiting) + self);
    visiting.delete(id);
    memo.set(id, best);
    return best;
  }
  let out = 0;
  for (const id of taskIds) out = Math.max(out, longestEndingAt(id, new Set()));
  return out;
}

// ── scoreCandidate ────────────────────────────────────────────────────────────────────────────────
export function scoreCandidate(
  taskIds: string[],
  tasksById: Map<string, TaskCandidate>,
  graph: CouplingGraph,
  candidateIdPrefix = "composite",
): MilestoneCandidate {
  const sortedIds = [...taskIds].sort();
  const tasks = sortedIds.map((id) => tasksById.get(id)!);
  const unionValue = tasks.reduce((s, t) => s + t.estimatedValue, 0);
  let fixedCostSaving = 0;
  for (let i = 0; i < sortedIds.length; i++) {
    for (let j = i + 1; j < sortedIds.length; j++) {
      const edges = graph.byTask.get(sortedIds[i]) || [];
      for (const e of edges) {
        const other = e.a === sortedIds[i] ? e.b : e.a;
        if (other !== sortedIds[j]) continue;
        if (e.kind === "shared-implementation" || e.kind === "shared-semantic-resource") {
          fixedCostSaving += SHARED_EDGE_SAVING_FACTOR * Math.min(tasks[i].estimatedValue, tasks[j].estimatedValue);
        }
      }
    }
  }
  const criticalPath = longestChainLineEstimate(sortedIds, graph, tasksById);
  const resourceUse = tasks.reduce((s, t) => s + t.lineEstimate, 0);
  const n = sortedIds.length;
  const coordinationCost = n > 1 ? (n - 1) * COORDINATION_COST_PER_EXTRA_TASK : 0;
  const atomicFailureCost = n > 1 ? unionValue * ATOMIC_FAILURE_RATE_PER_EXTRA_TASK * (n - 1) : 0;
  const score = unionValue + fixedCostSaving - coordinationCost - atomicFailureCost;
  const sourceHashes: Record<string, string> = {};
  for (const t of tasks) sourceHashes[t.id] = t.sourceHash;
  return {
    version: CONTRACT_VERSION,
    candidateId: n === 1 ? `singleton:${sortedIds[0]}` : `${candidateIdPrefix}:${sortedIds.join("+")}`,
    taskIds: sortedIds,
    deliveryHypothesis:
      n === 1 ? `single-task delivery of ${sortedIds[0]}` : `composite delivery of ${sortedIds.join(", ")}`,
    unionValue,
    fixedCostSaving,
    criticalPath,
    coordinationCost,
    resourceUse,
    atomicFailureCost,
    score,
    sourceHashes,
  };
}

// ── synthesizeCandidates ──────────────────────────────────────────────────────────────────────────
// Main entry point. `seedOrder` is the ranked task-ID order to seed expansion from (defaults to
// `tasks` array order). Retains EVERY eligible singleton (compatibility invariant #1) plus up to
// `candidateHorizon` distinct composite shapes per seed.
export function synthesizeCandidates(
  tasks: TaskCandidate[],
  graphInput: Omit<BuildCouplingGraphInput, "tasks">,
  opts: SynthesisOptions = {},
): MilestoneCandidate[] {
  const graph = buildCouplingGraph({ tasks, ...graphInput });
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const horizon = opts.candidateHorizon ?? DEFAULT_CANDIDATE_HORIZON;

  const out: MilestoneCandidate[] = [];
  const seenShapeKeys = new Set<string>();

  // Every eligible task gets its singleton — unconditionally, regardless of what composites it also
  // participates in (compatibility invariant #1; singletons are ALWAYS retained as alternatives).
  for (const t of tasks) {
    if (!t.eligible) continue;
    const singleton = makeSingletonCandidate(t);
    out.push(singleton);
    seenShapeKeys.add(singleton.taskIds.join(","));
  }

  for (const seedId of tasks.map((t) => t.id)) {
    const seedTask = tasksById.get(seedId);
    if (!seedTask || !seedTask.eligible) continue;
    const shapes = expandFromSeed(seedId, tasksById, graph).slice(0, horizon);
    for (const shape of shapes) {
      if (shape.size < 2) continue; // singleton already emitted above
      const key = [...shape].sort().join(",");
      if (seenShapeKeys.has(key)) continue;
      seenShapeKeys.add(key);
      out.push(scoreCandidate([...shape], tasksById, graph));
    }
  }

  return out;
}

// ── selftest ──────────────────────────────────────────────────────────────────────────────────────
export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;

  const mk = (id: string, touches: string[], value = 5, deps: string[] = []): TaskCandidate => ({
    version: 1,
    id,
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue: value,
    deliverySurface: [],
    touches,
    semanticResources: [],
    dependsOn: deps,
    verificationBoundary: "scripts/test.sh",
    acCount: 1,
    lineEstimate: 50,
    sourceHash: `h-${id}`,
  });

  // Every eligible singleton retained.
  const tasksSingletons = [mk("A", ["a.ts"]), mk("B", ["b.ts"]), mk("C", ["c.ts"])];
  const candsSingletons = synthesizeCandidates(tasksSingletons, {});
  check(
    "every-eligible-singleton-retained",
    ["A", "B", "C"].every((id) => candsSingletons.some((c) => c.taskIds.length === 1 && c.taskIds[0] === id)),
    JSON.stringify(candsSingletons.map((c) => c.taskIds)),
  );

  // Ineligible task gets no singleton and cannot be pulled into a composite.
  const tasksIneligible = [mk("D", ["d.ts"]), { ...mk("E", ["d.ts"]), eligible: false }];
  const candsIneligible = synthesizeCandidates(tasksIneligible, {});
  check(
    "ineligible-task-has-no-singleton",
    !candsIneligible.some((c) => c.taskIds.includes("E") && c.taskIds.length === 1),
    JSON.stringify(candsIneligible.map((c) => c.taskIds)),
  );
  check(
    "ineligible-task-never-joins-composite",
    !candsIneligible.some((c) => c.taskIds.length > 1 && c.taskIds.includes("E")),
    JSON.stringify(candsIneligible.map((c) => c.taskIds)),
  );

  // Two strongly-coupled tasks (shared touches) synthesize into a composite.
  const tasksCoupled = [mk("F", ["shared.ts"], 10), mk("G", ["shared.ts"], 10)];
  const candsCoupled = synthesizeCandidates(tasksCoupled, {});
  check(
    "coupled-pair-produces-composite",
    candsCoupled.some((c) => c.taskIds.length === 2 && c.taskIds.includes("F") && c.taskIds.includes("G")),
    JSON.stringify(candsCoupled.map((c) => c.taskIds)),
  );

  // A prohibiting (next-generation) edge keeps two coupled tasks OUT of any shared composite even
  // though they share touches.
  const tasksProhibited = [mk("H", ["shared2.ts"], 10), mk("I", ["shared2.ts"], 10)];
  const candsProhibited = synthesizeCandidates(tasksProhibited, {
    explicitEdges: [{ a: "H", b: "I", kind: "next-generation", evidence: "fixture" }],
  });
  check(
    "prohibited-pair-never-bundled",
    !candsProhibited.some((c) => c.taskIds.length > 1 && c.taskIds.includes("H") && c.taskIds.includes("I")),
    JSON.stringify(candsProhibited.map((c) => c.taskIds)),
  );
  check(
    "prohibited-pair-both-still-have-singletons",
    candsProhibited.some((c) => c.taskIds.length === 1 && c.taskIds[0] === "H") &&
      candsProhibited.some((c) => c.taskIds.length === 1 && c.taskIds[0] === "I"),
    JSON.stringify(candsProhibited.map((c) => c.taskIds)),
  );

  // A disconnected task (no coupling edge to anything) never joins a composite, no matter how
  // valuable — it can only ever appear as its own singleton.
  const tasksDisconnected = [mk("J", ["shared3.ts"], 10), mk("K", ["shared3.ts"], 10), mk("L", ["unrelated.ts"], 999)];
  const candsDisconnected = synthesizeCandidates(tasksDisconnected, {});
  check(
    "disconnected-high-value-task-never-joins-composite",
    !candsDisconnected.some((c) => c.taskIds.length > 1 && c.taskIds.includes("L")),
    JSON.stringify(candsDisconnected.map((c) => c.taskIds)),
  );

  // A 10-task homogeneous chain of shared-implementation coupling synthesizes ONE 10-task composite —
  // no cardinality cap.
  const tenTasks = Array.from({ length: 10 }, (_, i) => mk(`T${i}`, [`shared-file-${Math.floor(i / 2)}.ts`], 5));
  // Chain them all together via one common file so the whole set is mutually reachable.
  const tenTasksChained = tenTasks.map((t) => ({ ...t, touches: ["common-reconcile-file.ts"] }));
  const candsTen = synthesizeCandidates(tenTasksChained, {});
  const tenComposite = candsTen.find((c) => c.taskIds.length === 10);
  check("ten-task-composite-not-rejected-for-cardinality", !!tenComposite, JSON.stringify(candsTen.map((c) => c.taskIds.length)));

  // Internal-order required-dependency closure: adding a task pulls in its hard dependency too.
  const tasksOrdered = [mk("M", ["m.ts"], 5), mk("N", ["m.ts"], 5, ["M"])];
  const candsOrdered = synthesizeCandidates(tasksOrdered, {});
  const orderedComposite = candsOrdered.find((c) => c.taskIds.length === 2);
  check(
    "required-dependency-closure-pulls-in-predecessor",
    !!orderedComposite && orderedComposite.taskIds.includes("M") && orderedComposite.taskIds.includes("N"),
    JSON.stringify(candsOrdered.map((c) => c.taskIds)),
  );

  // Cyclic required-dependency is pruned, never infinite-loops, never produces the pair.
  const tasksCyclic = [mk("O", ["o.ts"], 5, ["P"]), mk("P", ["o.ts"], 5, ["O"])];
  const candsCyclic = synthesizeCandidates(tasksCyclic, {});
  check(
    "cyclic-required-dependency-pruned",
    !candsCyclic.some((c) => c.taskIds.length > 1),
    JSON.stringify(candsCyclic.map((c) => c.taskIds)),
  );

  // No taskIds.length cap anywhere: scoreCandidate handles an arbitrary-size input directly.
  const bigIds = Array.from({ length: 25 }, (_, i) => `Z${i}`);
  const bigTasksById = new Map(bigIds.map((id) => [id, mk(id, [`${id}.ts`], 1)]));
  const bigGraph = buildCouplingGraph({ tasks: [...bigTasksById.values()] });
  const bigScored = scoreCandidate(bigIds, bigTasksById, bigGraph);
  check("scoreCandidate-handles-25-tasks-no-cap", bigScored.taskIds.length === 25, `len=${bigScored.taskIds.length}`);

  // Singleton score invariant: composite-path scoring of a length-1 set matches makeSingletonCandidate.
  const soloTask = mk("SOLO", ["solo.ts"], 42);
  const soloGraph = buildCouplingGraph({ tasks: [soloTask] });
  const soloScored = scoreCandidate(["SOLO"], new Map([["SOLO", soloTask]]), soloGraph);
  check("singleton-score-consistency", soloScored.score === soloTask.estimatedValue, `score=${soloScored.score}`);
  return st.report();
}

if (process.argv[1] != null && process.argv[1].endsWith("candidate-synthesis.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
