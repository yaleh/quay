// coupling-graph.ts — M188/DIR-119-A Stage 1.2: build the task coupling graph (plan doc §3.2) from
// TaskCandidate facts. REUSES existing `## Touches` parsing/expansion/orthogonality logic from
// touches-orthogonality-check.ts (parseTouches/expandGlobs/matchGlob) rather than forking it — the
// charter's explicit Stage-1.2 requirement.
//
// Derives edges that ARE mechanically inferable from facts already on hand:
//   - "shared-implementation": two tasks' expanded Touches file-sets intersect (they would conflict if
//     run concurrently in separate worktrees anyway — touches-orthogonality-check.ts already proves
//     this the OTHER direction, i.e. disjoint ⇒ safe to run apart; overlap here is read as a POSITIVE
//     coupling signal: bundling saves the serialization/coordination cost the overlap already forces).
//   - "shared-semantic-resource": non-touches resource identifiers (dashboard sections, ledger keys,
//     etc.) declared in TaskCandidate.semanticResources intersect.
//   - "internal-order": TaskCandidate.dependsOn declares a hard ordering between two tasks in the set.
//
// Does NOT attempt to derive the five PROHIBITING kinds (proof-after-land, next-generation,
// result-dependent, learning-feedback, conflicts) from prose — that would require NLP-grade semantic
// reading of task bodies, out of Stage 1.2's scope. Those are accepted as `explicitEdges` — pre-
// extracted facts a caller (or, in a real deployment, a later heuristic/human annotation step) already
// knows and is declaring. This module's own logic for those kinds is: merge, don't invent, don't drop.

import { expandGlobs, filesDisjoint } from "./touches-orthogonality-check.ts";
import type { TaskCandidate, CouplingEdge, CouplingKind } from "./candidate-contracts.ts";
import { isProhibiting } from "./candidate-contracts.ts";
import { createSelftest } from "./gate-script-base.ts";

export interface BuildCouplingGraphInput {
  tasks: TaskCandidate[];
  /** Pre-extracted facts this module cannot derive on its own (temporal/proof/conflict edges, or an
   * explicit same-deliverable declaration). Never overridden by derived edges of a different kind for
   * the same pair — see mergeEdges below. */
  explicitEdges?: CouplingEdge[];
  /** Root to expand Touches globs against. When omitted, `touches` entries are treated as already
   * being concrete file paths (useful for fixtures that hand-author exact paths). */
  workspaceRoot?: string;
  /** Pre-computed walkFiles(workspaceRoot) list for walk-once callers
   * (gap-select-preflight-json-real-store-too-slow): when the same tree is expanded for every task's
   * Touches in one process, sharing a file list avoids re-walking the whole tree per task. Must be
   * consistent with `workspaceRoot` and the tree AT CALL TIME — callers that mutate the tree must
   * not pass a stale list. When omitted, each task's Touches are expanded against the tree on demand
   * (unchanged behavior). */
  files?: string[];
}

export interface CouplingGraph {
  nodes: string[];
  edges: CouplingEdge[];
  /** Adjacency: taskId -> edges touching it (both directions), for O(1) neighbor lookup. */
  byTask: Map<string, CouplingEdge[]>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

function expandTouches(touches: string[], workspaceRoot?: string, files?: string[]): Set<string> {
  if (!workspaceRoot) return new Set(touches);
  return expandGlobs(touches, workspaceRoot, files);
}

// ── deriveSharedImplementationEdges ────────────────────────────────────────────────────────────────
export function deriveSharedImplementationEdges(tasks: TaskCandidate[], workspaceRoot?: string, files?: string[]): CouplingEdge[] {
  const out: CouplingEdge[] = [];
  const expanded = new Map<string, Set<string>>();
  for (const t of tasks) expanded.set(t.id, expandTouches(t.touches, workspaceRoot, files));
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      const setA = expanded.get(a.id)!;
      const setB = expanded.get(b.id)!;
      if (setA.size === 0 || setB.size === 0) continue;
      const { disjoint, overlaps } = filesDisjoint(setA, setB);
      if (!disjoint) {
        out.push({
          a: a.id,
          b: b.id,
          kind: "shared-implementation",
          evidence: `overlapping Touches: ${overlaps.slice(0, 5).join(", ")}${overlaps.length > 5 ? ", …" : ""}`,
        });
      }
    }
  }
  return out;
}

// ── deriveSharedSemanticResourceEdges ─────────────────────────────────────────────────────────────
export function deriveSharedSemanticResourceEdges(tasks: TaskCandidate[]): CouplingEdge[] {
  const out: CouplingEdge[] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      const shared = a.semanticResources.filter((r) => b.semanticResources.includes(r));
      if (shared.length > 0) {
        out.push({
          a: a.id,
          b: b.id,
          kind: "shared-semantic-resource",
          evidence: `shared semantic resources: ${shared.join(", ")}`,
        });
      }
    }
  }
  return out;
}

// ── deriveInternalOrderEdges ──────────────────────────────────────────────────────────────────────
export function deriveInternalOrderEdges(tasks: TaskCandidate[]): CouplingEdge[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: CouplingEdge[] = [];
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) continue; // dependency outside this fact set — not representable as an edge here
      out.push({
        a: dep,
        b: t.id,
        kind: "internal-order",
        evidence: `${t.id} declares a hard dependency on ${dep}`,
        requiresOrder: "a-before-b",
      });
    }
  }
  return out;
}

// ── mergeEdges ─────────────────────────────────────────────────────────────────────────────────────
// Multiple edges may exist between the same pair (e.g. shared-implementation AND internal-order).
// Distinct kinds for the same pair are ALL kept (a pair can be both "shares files" and "must be
// ordered") — merging only dedupes byte-identical (a,b,kind) triples so re-deriving from the same
// facts twice is idempotent. The dedup key is DIRECTION-SENSITIVE (literal a,b order, not the
// unordered pairKey): internal-order's {a:P,b:O} ("P before O") and {a:O,b:P} ("O before P") are two
// DIFFERENT edges — together they encode a genuine ordering cycle that candidate-synthesis.ts's
// hasInternalOrderCycle must be able to see. Using the unordered pairKey here would silently collapse
// those two opposite-direction edges into one, hiding the cycle.
export function mergeEdges(edgeLists: CouplingEdge[][]): CouplingEdge[] {
  const seen = new Set<string>();
  const out: CouplingEdge[] = [];
  for (const list of edgeLists) {
    for (const e of list) {
      const key = e.a + "|||" + e.b + "|||" + e.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

// ── buildCouplingGraph ─────────────────────────────────────────────────────────────────────────────
export function buildCouplingGraph(input: BuildCouplingGraphInput): CouplingGraph {
  const { tasks, explicitEdges = [], workspaceRoot, files } = input;
  const derived = mergeEdges([
    deriveSharedImplementationEdges(tasks, workspaceRoot, files),
    deriveSharedSemanticResourceEdges(tasks),
    deriveInternalOrderEdges(tasks),
    explicitEdges,
  ]);
  const byTask = new Map<string, CouplingEdge[]>();
  for (const t of tasks) byTask.set(t.id, []);
  for (const e of derived) {
    if (!byTask.has(e.a)) byTask.set(e.a, []);
    if (!byTask.has(e.b)) byTask.set(e.b, []);
    byTask.get(e.a)!.push(e);
    byTask.get(e.b)!.push(e);
  }
  return { nodes: tasks.map((t) => t.id), edges: derived, byTask };
}

// ── hasProhibitingEdge ─────────────────────────────────────────────────────────────────────────────
// True if ANY edge between a and b is a prohibiting kind — the graph is used, never a re-implemented
// lookup, so candidate-synthesis.ts calls this rather than scanning `edges` itself.
export function hasProhibitingEdge(graph: CouplingGraph, a: string, b: string): CouplingEdge | undefined {
  const edgesA = graph.byTask.get(a) || [];
  return edgesA.find((e) => isProhibiting(e.kind) && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
}

// ── supportingNeighbors ────────────────────────────────────────────────────────────────────────────
// Neighbors of `taskId` reachable via a SUPPORTING edge that is not simultaneously prohibited by
// another edge between the same pair (a pair can carry both a supporting AND a prohibiting edge —
// e.g. shared files AND a next-generation proof edge — prohibition always wins).
export function supportingNeighbors(graph: CouplingGraph, taskId: string): string[] {
  const edges = graph.byTask.get(taskId) || [];
  const out = new Set<string>();
  const prohibited = new Set<string>();
  for (const e of edges) {
    const other = e.a === taskId ? e.b : e.a;
    if (isProhibiting(e.kind)) prohibited.add(other);
  }
  for (const e of edges) {
    const other = e.a === taskId ? e.b : e.a;
    if (!isProhibiting(e.kind) && !prohibited.has(other)) out.add(other);
  }
  return [...out];
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────────
export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;

  const mk = (id: string, touches: string[], deps: string[] = [], sem: string[] = []): TaskCandidate => ({
    version: 1,
    id,
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue: 5,
    deliverySurface: [],
    touches,
    semanticResources: sem,
    dependsOn: deps,
    verificationBoundary: "scripts/test.sh",
    acCount: 1,
    lineEstimate: 50,
    sourceHash: "h",
  });

  // shared-implementation: two tasks with exact overlapping touch paths (no workspaceRoot expansion).
  const tasks1 = [mk("A", ["shared/file.ts"]), mk("B", ["shared/file.ts"]), mk("C", ["other/file.ts"])];
  const g1 = buildCouplingGraph({ tasks: tasks1 });
  check(
    "shared-implementation-detected",
    g1.edges.some((e) => e.kind === "shared-implementation" && pairKey(e.a, e.b) === pairKey("A", "B")),
    JSON.stringify(g1.edges),
  );
  check(
    "no-edge-for-unrelated-touches",
    !g1.edges.some((e) => pairKey(e.a, e.b) === pairKey("A", "C") || pairKey(e.a, e.b) === pairKey("B", "C")),
    "C shares nothing with A/B",
  );

  // shared-semantic-resource
  const tasks2 = [mk("D", ["d.ts"], [], ["dashboard-section-x"]), mk("E", ["e.ts"], [], ["dashboard-section-x"])];
  const g2 = buildCouplingGraph({ tasks: tasks2 });
  check(
    "shared-semantic-resource-detected",
    g2.edges.some((e) => e.kind === "shared-semantic-resource"),
    JSON.stringify(g2.edges),
  );

  // internal-order
  const tasks3 = [mk("F", ["f.ts"]), mk("G", ["g.ts"], ["F"])];
  const g3 = buildCouplingGraph({ tasks: tasks3 });
  const orderEdge = g3.edges.find((e) => e.kind === "internal-order");
  check("internal-order-detected", !!orderEdge && orderEdge.a === "F" && orderEdge.b === "G", JSON.stringify(orderEdge));

  // explicit prohibiting edge always wins over a derived supporting edge for the same pair.
  const tasks4 = [mk("H", ["shared.ts"]), mk("I", ["shared.ts"])];
  const g4 = buildCouplingGraph({
    tasks: tasks4,
    explicitEdges: [{ a: "H", b: "I", kind: "next-generation", evidence: "fixture-declared" }],
  });
  check(
    "explicit-prohibiting-edge-preserved-alongside-derived",
    g4.edges.some((e) => e.kind === "next-generation") && g4.edges.some((e) => e.kind === "shared-implementation"),
    JSON.stringify(g4.edges),
  );
  const prohibit = hasProhibitingEdge(g4, "H", "I");
  check("hasProhibitingEdge-finds-it", !!prohibit && prohibit.kind === "next-generation", JSON.stringify(prohibit));
  const neighbors = supportingNeighbors(g4, "H");
  check("supportingNeighbors-excludes-prohibited-pair", !neighbors.includes("I"), `neighbors=${JSON.stringify(neighbors)}`);

  // supportingNeighbors on a clean supporting-only pair DOES include the neighbor.
  const neighborsClean = supportingNeighbors(g1, "A");
  check("supportingNeighbors-includes-clean-supporting-neighbor", neighborsClean.includes("B"), JSON.stringify(neighborsClean));

  // mergeEdges idempotent dedupe.
  const merged = mergeEdges([g1.edges, g1.edges]);
  check("mergeEdges-idempotent", merged.length === g1.edges.length, `${merged.length} vs ${g1.edges.length}`);

  // dependsOn pointing outside the fact set is silently dropped (not representable), never throws.
  const tasks5 = [mk("J", ["j.ts"], ["OUTSIDE-TASK"])];
  const g5 = buildCouplingGraph({ tasks: tasks5 });
  check("dependency-outside-fact-set-dropped-not-thrown", g5.edges.length === 0, JSON.stringify(g5.edges));
  return st.report();
}

if (process.argv[1] != null && process.argv[1].endsWith("coupling-graph.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
