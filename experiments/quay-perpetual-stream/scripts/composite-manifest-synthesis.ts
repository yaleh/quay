// composite-manifest-synthesis.ts — M198/DIR-119-D1: real manifest phase/shard synthesis at the
// SELECT/dispatch boundary. First child of DIR-119-D's 5-way split. Converts a SELECT-produced
// flat `MilestoneCandidate` into a `CompositeManifest{phases[], auditShards[]}` — the missing
// input every other DIR-119-D child (Build/Audit/Reconcile/Land wiring) depends on.
//
// REUSES (never reimplements):
//   - `parseTouches`/`expandGlobs`/`filesDisjoint` from touches-orthogonality-check.ts
//   - `buildCouplingGraph`/`deriveInternalOrderEdges`/`hasProhibitingEdge` from coupling-graph.ts
//   - `checkCompositeContract` from composite-contracts.ts (self-validation before write)
//
// Core pure function `synthesizeManifest(candidate, taskFacts, couplingGraph, capacity?)` performs
// NO I/O and takes NO workspaceRoot — the CLI layer (which DOES have a workspaceRoot) is
// responsible for reading real task files, parsing/expanding their `## Touches` sections into
// already-expanded concrete file-path arrays, and building the coupling graph before calling this
// function. This keeps the fusion decision itself deterministic and testable without a real
// filesystem.
//
// Fusion algorithm (fail-toward-fusion, never fail-toward-parallelism): an undirected union-find
// over each candidate member task's (already-expanded) Touches file-set. Any pair NOT PROVEN
// disjoint — including missing/empty Touches, or a `shared-implementation`/`shared-semantic-
// resource` coupling-graph edge — is fused into one shared `CompositePhase`. A `hasProhibitingEdge`
// pair between two candidate member tasks is checked FIRST, before any union-find step: it aborts
// synthesis entirely (a prohibiting edge must never be masked by putting its two tasks in one
// phase, and must never be silently dropped by the fusion algorithm either).
//
// Shard emission: one `task-ac` shard per member task, one `semantic-integration` shard per
// multi-task phase. All collections are `.sort()`ed before emission; ids are derived only from
// sorted membership + fixed string prefixes (never Date.now()/Math.random()/directory-walk order)
// so two runs against identical inputs produce byte-identical JSON.
//
// CLI wrapper: accepts --candidate-json/--charter/--workspace-root/--task-store-dir/--out (plus
// --explicit-edges-json/--max-phases/--max-audit-shards for tests and future callers that need to
// declare non-derivable prohibiting-kind coupling edges or override capacity), matching
// milestone-preparation-check.ts's separate-named-flags convention (NOT composite-preflight.ts's
// single --args-json blob — the opposite style; confirmed by direct source read). It loads real
// task facts from the task store, validates the candidate's task ids against the charter's
// declared scope (folded into the same `checkCompositeContract` self-validation step, not a
// separate ad hoc check — `membership-mismatch-charter` already covers this), then writes via
// temp-file-plus-rename (`fs.writeFileSync(tmp)` + `fs.renameSync(tmp, out)`) so a crash mid-write
// never leaves a partial/corrupt manifest for `composite-preflight.ts` to later read as
// valid-looking JSON. On any failure (prohibiting edge, contract violation, missing task facts,
// bad JSON) it exits non-zero and writes NOTHING.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { parseTouches, expandGlobs, filesDisjoint } from "./touches-orthogonality-check.ts";
import { buildCouplingGraph, deriveInternalOrderEdges, hasProhibitingEdge, type CouplingGraph } from "./coupling-graph.ts";
import { checkCompositeContract, type CompositeManifest, type CompositeContext, type CompositePhase, type CompositeAuditShard, type CapacityLimits } from "./composite-contracts.ts";
import type { TaskCandidate, MilestoneCandidate, CouplingEdge } from "./candidate-contracts.ts";
// Direct-entry check inlined (matches composite-contracts.ts/coupling-graph.ts/composite-args.ts's
// own convention) rather than importing gate-script-base.ts's isDirectEntry — this module's own
// `## Touches` does not include gate-script-base.ts or its plugin/scripts/ mirror, and this file
// IS run through the real `plugin/test/*.test.mjs` -> `scripts/test.sh` CI path (unlike
// composite-preflight.ts's own untested plugin/scripts/ copy), so it must not introduce an
// unmirrored cross-file import dependency.

// ── Capacity defaults (AC5/AC16 — real named exported constant, never an inline literal) ──────────
// `maxParallelAgents`/`landPolicy` are NOT part of composite-contracts.ts's `CapacityLimits`
// interface (confirmed by direct source read — it declares only `maxPhases`/`maxAuditShards` plus
// two optional line-estimate fields). They ride along here as advisory metadata a later
// Build-phase child (DIR-119-D2) can import directly from this module — never smuggled into the
// shared contract type, which is outside this child's declared touch set.
export const DEFAULT_SYNTHESIS_CAPACITY = {
  maxPhases: 32,
  maxAuditShards: 64,
  maxParallelAgents: 4,
  landPolicy: "atomic" as const,
};

// ── ProhibitingEdgeError ────────────────────────────────────────────────────────────────────────
// Thrown by synthesizeManifest() BEFORE any union-find step when a `hasProhibitingEdge` pair exists
// between two candidate member tasks. A real SELECT-produced candidate can never structurally
// contain such a pair (candidate-synthesis.ts already prunes prohibiting-pair unions before a
// MilestoneCandidate is constructed, at both of its call sites) — this is honest defense-in-depth
// coverage of this module's own contract, exercised at the unit/CLI level via a hand-supplied
// coupling graph, not via a real SELECT-produced candidate.
export class ProhibitingEdgeError extends Error {
  code = "prohibiting-edge-conflict" as const;
  pair: [string, string];
  kind: string;
  constructor(a: string, b: string, kind: string) {
    super(`prohibiting-edge-conflict: ${a}<->${b} (${kind}) — cannot fuse into one candidate`);
    this.name = "ProhibitingEdgeError";
    this.pair = [a, b];
    this.kind = kind;
  }
}

export interface SynthesizeManifestResult {
  manifest: CompositeManifest;
  context: CompositeContext;
}

// ── synthesizeManifest ─────────────────────────────────────────────────────────────────────────
// Pure: given a candidate + real task facts (Touches already expanded to concrete file paths by
// the CLI layer — see module header) + a pre-built coupling graph, returns a deterministic
// {manifest, context} pair. `context.charterTaskIds` defaults to `candidate.taskIds` here (a
// direct unit-level caller has no charter); the CLI overwrites it with the real charter's declared
// scope before running `checkCompositeContract`.
export function synthesizeManifest(
  candidate: Pick<MilestoneCandidate, "candidateId" | "taskIds">,
  taskFacts: TaskCandidate[],
  couplingGraph: CouplingGraph,
  capacity?: Partial<CapacityLimits>,
): SynthesizeManifestResult {
  const taskIds = [...new Set(candidate.taskIds)].sort();
  const factsById = new Map(taskFacts.map((f) => [f.id, f]));

  // 1. Prohibiting-edge check FIRST — before any union-find step (Fusion algorithm / AC17).
  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const edge = hasProhibitingEdge(couplingGraph, taskIds[i], taskIds[j]);
      if (edge) throw new ProhibitingEdgeError(taskIds[i], taskIds[j], edge.kind);
    }
  }

  // 2. Union-find fusion over Touches overlap + coupling-graph supporting edges (fail-toward-fusion).
  const parent = new Map(taskIds.map((id) => [id, id]));
  const fusionReasons = new Map<string, string[]>(); // root -> reasons this component was fused
  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // path compression
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a: string, b: string, reason: string): void {
    const ra = find(a);
    const rb = find(b);
    const target = ra < rb ? ra : rb; // deterministic winner, independent of call order
    const other = ra < rb ? rb : ra;
    if (ra !== rb) parent.set(other, target);
    const key = find(a);
    const reasons = fusionReasons.get(key) ?? [];
    reasons.push(reason);
    fusionReasons.set(key, reasons);
  }

  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const a = taskIds[i];
      const b = taskIds[j];
      const factsA = factsById.get(a);
      const factsB = factsById.get(b);
      if (!factsA || !factsB || factsA.touches.length === 0 || factsB.touches.length === 0) {
        union(a, b, `missing/empty Touches on ${!factsA || factsA.touches.length === 0 ? a : b} — fail toward fusion`);
        continue;
      }
      const { disjoint, overlaps } = filesDisjoint(new Set(factsA.touches), new Set(factsB.touches));
      if (!disjoint) {
        union(a, b, `overlapping Touches: ${overlaps.slice(0, 3).join(", ")}${overlaps.length > 3 ? ", …" : ""}`);
        continue;
      }
      const graphEdge = couplingGraph.edges.find(
        (e) =>
          (e.kind === "shared-implementation" || e.kind === "shared-semantic-resource") &&
          ((e.a === a && e.b === b) || (e.a === b && e.b === a)),
      );
      if (graphEdge) {
        union(a, b, `coupling-graph ${graphEdge.kind}: ${graphEdge.evidence}`);
      }
    }
  }

  // 3. Group into components (deterministic sorted phase membership).
  const componentsByRoot = new Map<string, string[]>();
  for (const id of taskIds) {
    const root = find(id);
    const members = componentsByRoot.get(root) ?? [];
    members.push(id);
    componentsByRoot.set(root, members);
  }

  // 4. Internal-order edges among candidate members (direct reuse, AC12) — cross-phase ordering
  // becomes a `requires` edge; same-phase ordering is preserved as an integration-invariant note
  // rather than silently dropped (there is no separate phase to point `requires` at once two
  // ordered tasks are already fused together).
  const memberFacts = taskIds.map((id) => factsById.get(id)).filter((f): f is TaskCandidate => !!f);
  const orderEdges = deriveInternalOrderEdges(memberFacts);

  const phaseIdFor = new Map<string, string>(); // taskId -> phase id
  const sortedComponents = [...componentsByRoot.values()].map((members) => [...members].sort());
  for (const members of sortedComponents) {
    const phaseId = members.length === 1 ? `phase-${members[0]}` : `phase-${members.join("+")}`;
    for (const id of members) phaseIdFor.set(id, phaseId);
  }

  const requiresByPhase = new Map<string, Set<string>>();
  const orderNotesByPhase = new Map<string, string[]>();
  for (const e of orderEdges) {
    const phaseA = phaseIdFor.get(e.a);
    const phaseB = phaseIdFor.get(e.b);
    if (!phaseA || !phaseB) continue; // outside this candidate's membership
    if (phaseA === phaseB) {
      const notes = orderNotesByPhase.get(phaseA) ?? [];
      notes.push(`${e.a} before ${e.b} (internal-order, same phase — order preserved via this note, not a separate requires edge)`);
      orderNotesByPhase.set(phaseA, notes);
      continue;
    }
    const reqs = requiresByPhase.get(phaseB) ?? new Set<string>();
    reqs.add(phaseA);
    requiresByPhase.set(phaseB, reqs);
  }

  // 5. Build phases + audit shards.
  const phases: CompositePhase[] = [];
  const auditShards: CompositeAuditShard[] = [];
  for (const members of sortedComponents) {
    const phaseId = members.length === 1 ? `phase-${members[0]}` : `phase-${members.join("+")}`;
    const taskShardIds = members.map((id) => `shard-${id}-ac`);
    for (const id of members) {
      auditShards.push({ id: `shard-${id}-ac`, kind: "task-ac", taskIds: [id] });
    }
    const requires = [...(requiresByPhase.get(phaseId) ?? new Set<string>())].sort();
    if (members.length > 1) {
      const integrationShardId = `shard-${members.join("+")}-integration`;
      auditShards.push({ id: integrationShardId, kind: "semantic-integration", taskIds: members });
      const root = find(members[0]);
      const reasons = (fusionReasons.get(root) ?? []).join("; ");
      const orderNotes = orderNotesByPhase.get(phaseId);
      const invariantParts = [`fused members: ${members.join(", ")}`, `reason(s): ${reasons || "undecidable — treated as overlapping"}`];
      if (orderNotes && orderNotes.length > 0) invariantParts.push(...orderNotes);
      phases.push({
        id: phaseId,
        taskIds: members,
        requires,
        auditShardIds: [...taskShardIds, integrationShardId].sort(),
        integrationInvariant: invariantParts.join(" | "),
      });
    } else {
      phases.push({
        id: phaseId,
        taskIds: members,
        requires,
        auditShardIds: taskShardIds.sort(),
      });
    }
  }
  phases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  auditShards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 6. Union touches / semantic resources, sorted + deduped.
  const touches = [...new Set(taskIds.flatMap((id) => factsById.get(id)?.touches ?? []))].sort();
  const semanticResources = [...new Set(taskIds.flatMap((id) => factsById.get(id)?.semanticResources ?? []))].sort();

  const manifest: CompositeManifest = {
    version: 1,
    candidateId: candidate.candidateId,
    taskIds,
    phases,
    auditShards,
    touches,
    semanticResources,
    landPolicy: "atomic",
  };

  const capacityLimits: CapacityLimits = {
    maxPhases: capacity?.maxPhases ?? DEFAULT_SYNTHESIS_CAPACITY.maxPhases,
    maxAuditShards: capacity?.maxAuditShards ?? DEFAULT_SYNTHESIS_CAPACITY.maxAuditShards,
    ...(capacity?.taskLineEstimates ? { taskLineEstimates: capacity.taskLineEstimates } : {}),
    ...(capacity?.maxTotalLines != null ? { maxTotalLines: capacity.maxTotalLines } : {}),
  };

  const forbiddenEdges = couplingGraph.edges
    .filter((e) => taskIds.includes(e.a) && taskIds.includes(e.b))
    .map((e) => ({ a: e.a, b: e.b, kind: e.kind }));

  const context: CompositeContext = {
    candidateTaskIds: taskIds,
    charterTaskIds: taskIds, // default; CLI layer overwrites with the real charter's declared scope
    taskAcCounts: Object.fromEntries(taskIds.map((id) => [id, factsById.get(id)?.acCount ?? 0])),
    taskTouches: Object.fromEntries(taskIds.map((id) => [id, factsById.get(id)?.touches ?? []])),
    taskSemanticResources: Object.fromEntries(taskIds.map((id) => [id, factsById.get(id)?.semanticResources ?? []])),
    forbiddenEdges,
    capacity: capacityLimits,
  };

  return { manifest, context };
}

// ── extractCharterTaskIds ──────────────────────────────────────────────────────────────────────
// Extracts the task id(s) a charter file declares as its scope. Real charters today (M198's own
// included) carry a `**Task:** <id> · **Class:** ... · **Value type:** ...` line naming exactly one
// task; a future multi-task composite charter could instead list ids under `## Scope`. Both shapes
// are recognized. Conservative: returns [] (never guesses) when neither shape is present.
export function extractCharterTaskIds(charterText: string): string[] {
  const taskLineMatch = charterText.match(/\*\*Task:\*\*\s*(.+)/);
  if (taskLineMatch) {
    const rest = taskLineMatch[1].split("·")[0]; // stop at the next " · **Class:** ..." field
    const ids = rest
      .split(/,| and /i)
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z][A-Za-z0-9._-]*$/.test(s));
    if (ids.length > 0) return [...new Set(ids)].sort();
  }
  // Fallback: a `## Scope` section listing task ids as its own bullets, e.g. "- DIR-119-D2: ...".
  const scopeMatch = charterText.match(/^##\s+Scope\s*\n([\s\S]*?)(?:\n##\s|\n$|$)/m);
  if (scopeMatch) {
    const ids: string[] = [];
    for (const line of scopeMatch[1].split("\n")) {
      const bullet = line.match(/^\s*[-*]\s+`?([A-Za-z][A-Za-z0-9._-]*)`?\s*[:—-]/);
      if (bullet) ids.push(bullet[1]);
    }
    if (ids.length > 0) return [...new Set(ids)].sort();
  }
  return [];
}

// ── loadTaskFacts (CLI layer — I/O lives here, not in synthesizeManifest) ────────────────────────
// Reads each candidate member task's real markdown file, parses+expands its `## Touches` section
// (direct reuse of parseTouches/expandGlobs), and derives a minimal TaskCandidate fact record.
// Ambiguous Touches (no section, empty, unparseable-to-zero-matches, or any overbroad glob) are
// normalized to an EMPTY touches array — synthesizeManifest's fusion step treats empty touches as
// "fail toward fusion", collapsing all four ambiguous cases into one honest signal.
export interface LoadTaskFactsResult {
  facts: TaskCandidate[];
  missing: string[];
}

export function loadTaskFacts(taskIds: string[], taskStoreDir: string, workspaceRoot: string): LoadTaskFactsResult {
  const facts: TaskCandidate[] = [];
  const missing: string[] = [];
  for (const id of taskIds) {
    const filePath = path.join(taskStoreDir, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      missing.push(id);
      continue;
    }
    const text = fs.readFileSync(filePath, "utf8");
    const parsed = parseTouches(text);
    let ambiguous = !parsed.hasSection || parsed.globs.length === 0;
    if (!ambiguous) {
      for (const g of parsed.globs) {
        if (isOverbroad(g)) {
          ambiguous = true;
          break;
        }
      }
    }
    let touches: string[] = [];
    if (!ambiguous) {
      const expanded = expandGlobs(parsed.globs, workspaceRoot);
      if (expanded.size === 0) {
        ambiguous = true; // matched nothing — likely a typo, fail toward fusion
      } else {
        touches = [...expanded].sort();
      }
    }
    const acCount = countAcceptanceCriteria(text);
    const sourceHash = sha1(text).slice(0, 12);
    facts.push({
      version: 1,
      id,
      status: "todo",
      labels: [],
      valueType: "capabilityGrowth",
      eligible: true,
      estimatedValue: 1,
      deliverySurface: [],
      touches,
      semanticResources: [],
      dependsOn: [],
      verificationBoundary: "scripts/test.sh",
      acCount,
      lineEstimate: 50,
      sourceHash,
    });
  }
  return { facts, missing };
}

function isOverbroad(glob: string): boolean {
  const g = glob.replace(/\\/g, "/");
  if (g === "" || g === "**" || g === "*" || g === "**/*" || g === "./**" || g === "**/**") return true;
  let concrete = 0;
  for (const seg of g.split("/")) {
    if (/[*?]/.test(seg)) return concrete < 2;
    concrete++;
  }
  return false;
}

// Line-scan (mirrors parseTouches's own heading/section-tracking style, touches-orthogonality-
// check.ts) rather than a single greedy/non-greedy regex spanning the whole section — a bare `$`
// alternative under the `/m` flag matches at the END OF EVERY LINE, not just the section's end,
// which silently truncated a multi-item Acceptance Criteria section after its first bullet.
function countAcceptanceCriteria(text: string): number {
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let count = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      inSection = /^acceptance criteria\b/i.test(heading[1].trim());
      continue;
    }
    if (!inSection) continue;
    if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) count++;
  }
  return count;
}

function sha1(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────

interface CliFlags {
  candidateJson?: string;
  charter?: string;
  workspaceRoot: string;
  taskStoreDir: string;
  out?: string;
  explicitEdgesJson?: string;
  maxPhases?: number;
  maxAuditShards?: number;
}

function parseCliFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { workspaceRoot: ".", taskStoreDir: "tasks" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--candidate-json") flags.candidateJson = argv[++i];
    else if (a === "--charter") flags.charter = argv[++i];
    else if (a === "--workspace-root") flags.workspaceRoot = argv[++i];
    else if (a === "--task-store-dir") flags.taskStoreDir = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--explicit-edges-json") flags.explicitEdgesJson = argv[++i];
    else if (a === "--max-phases") flags.maxPhases = Number(argv[++i]);
    else if (a === "--max-audit-shards") flags.maxAuditShards = Number(argv[++i]);
  }
  return flags;
}

function usage(): void {
  console.error(
    "Usage: composite-manifest-synthesis.ts --candidate-json '<json>' --charter <charter.md> " +
      "--workspace-root <dir> [--task-store-dir <dir>] --out <path> [--explicit-edges-json '<json>'] " +
      "[--max-phases N] [--max-audit-shards N]",
  );
}

export function main(argv: string[]): number {
  const flags = parseCliFlags(argv.slice(2));
  if (!flags.candidateJson || !flags.charter || !flags.out) {
    usage();
    return 2;
  }

  let candidate: Pick<MilestoneCandidate, "candidateId" | "taskIds">;
  try {
    candidate = JSON.parse(flags.candidateJson);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, code: "invalid-candidate-json", message: (e as Error).message }));
    return 1;
  }
  if (!Array.isArray(candidate.taskIds) || candidate.taskIds.length === 0) {
    console.log(JSON.stringify({ ok: false, code: "empty-task-array", message: "candidate.taskIds must be a non-empty array" }));
    return 1;
  }

  if (!fs.existsSync(flags.charter)) {
    console.log(JSON.stringify({ ok: false, code: "charter-not-found", message: flags.charter }));
    return 1;
  }
  const charterText = fs.readFileSync(flags.charter, "utf8");
  const charterTaskIds = extractCharterTaskIds(charterText);

  const workspaceRoot = path.resolve(flags.workspaceRoot);
  const taskStoreDir = path.isAbsolute(flags.taskStoreDir) ? flags.taskStoreDir : path.join(workspaceRoot, flags.taskStoreDir);
  const { facts, missing } = loadTaskFacts(candidate.taskIds, taskStoreDir, workspaceRoot);
  if (missing.length > 0) {
    console.log(JSON.stringify({ ok: false, code: "task-facts-missing", taskIds: missing }));
    return 1;
  }

  let explicitEdges: CouplingEdge[] = [];
  if (flags.explicitEdgesJson) {
    try {
      explicitEdges = JSON.parse(flags.explicitEdgesJson);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, code: "invalid-explicit-edges-json", message: (e as Error).message }));
      return 1;
    }
  }
  const couplingGraph = buildCouplingGraph({ tasks: facts, explicitEdges });

  const capacityOverride: Partial<CapacityLimits> = {};
  if (flags.maxPhases != null && !Number.isNaN(flags.maxPhases)) capacityOverride.maxPhases = flags.maxPhases;
  if (flags.maxAuditShards != null && !Number.isNaN(flags.maxAuditShards)) capacityOverride.maxAuditShards = flags.maxAuditShards;

  let result: SynthesizeManifestResult;
  try {
    result = synthesizeManifest(candidate, facts, couplingGraph, capacityOverride);
  } catch (e) {
    if (e instanceof ProhibitingEdgeError) {
      console.log(JSON.stringify({ ok: false, code: e.code, pair: e.pair, kind: e.kind, message: e.message }));
      return 1;
    }
    throw e;
  }

  // Validate the candidate's task ids against the charter's declared scope by folding it into the
  // SAME self-validation step checkCompositeContract already performs (membership-mismatch-charter)
  // — not a separate ad hoc check.
  result.context.charterTaskIds = charterTaskIds.length > 0 ? charterTaskIds : result.context.candidateTaskIds;

  const contractResult = checkCompositeContract(result.manifest, result.context);
  if (!contractResult.ok) {
    console.log(JSON.stringify({ ok: false, code: "contract-violation", violations: contractResult.violations }));
    return 1;
  }

  const payload = JSON.stringify({ manifest: result.manifest, context: result.context }, null, 2);
  const tmp = `${flags.out}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, flags.out);

  console.log(
    JSON.stringify({
      ok: true,
      out: flags.out,
      candidateId: result.manifest.candidateId,
      taskIds: result.manifest.taskIds,
      phaseCount: result.manifest.phases.length,
      auditShardCount: result.manifest.auditShards.length,
    }),
  );
  return 0;
}

const isDirect = process.argv[1] != null && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  process.exitCode = main(process.argv);
}
