// Tests for the `stays` (partial-migration) complement emitted by the ownership-active slice adapter.
//
// Two REAL candidates from the production carrier `.quay/ownership-shadow-proposals.jsonl` are replayed here
// (records 75 and 76 of 2026-10-10; their recorded `downgrades` strings are quoted below). Both refused with
// `切法覆盖不足` because an edge into a moved-from directory imported a name the cut did not move. The adapter
// now computes that complement from the SAME edges and declares it as `proposedCut.stays` — ArchGuard's
// documented partial-migration vocabulary (a declaration, never a fallback: an undeclared name stays
// `not-evaluated`).
//
// The adapter side is always exercised. The assertions that need a CLI implementing `stays` are gated: the
// published `@yalehwang/archguard@0.1.39` artifact predates the clause, so on a host carrying only that
// release they SKIP with an explicit reason rather than passing vacuously (they are never silently green).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildSliceInput, computeSliceDelta, resolveSliceDelta } from "../../docs/analysis/ownership-active-slice-adapter.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(REPO, "plugin", "fixtures", "ownership-active-slice");

// The locked reading. `packages/quay/src` at commit b1e844f (carrier record 75) and at dd7ddf5 (record 76) is
// the SAME git tree — 00467d64403217aadacda527b8d7a1b898d312e5, the `tree_sha` the carrier itself recorded.
// The fixture is `archguard analyze` output over `git archive <commit> packages/quay/src`, so the replay
// cannot drift with the working tree (the whole point of locking the ref).
const LOCKED = { commit_75: "b1e844ff0bee89500c4d704d17dd2c9d0fb91819", commit_76: "dd7ddf53d43420d4367c92065cb1b661418805da", tree_sha: "00467d64403217aadacda527b8d7a1b898d312e5", scope_root: "packages/quay/src" };
const ARCH_FIXTURE = path.join(FIXTURES, "locked-tree-00467d64.arch.json");
const ARCH_SHA256 = "6b03a0055b981acd8784dd51917b114fd7e92d5a475db748b066353f6b1afdc1";
const archJson = () => JSON.parse(fs.readFileSync(ARCH_FIXTURE, "utf8"));
const lockedGraph = () => archJson().extensions.tsAnalysis.moduleGraph;

// The carrier stores only the refusal text, not the `moves`. These moves are reconstructed so the recorded
// uncovered sets reproduce EXACTLY — the test below proves that by matching the tool's refusal against the
// carrier's own string, verbatim. (Record 75's text is complete; record 76's is truncated mid-word in the
// carrier, so only its prefix is compared.)
const RECORDED_75 = "切法覆盖不足：边 cli -> gate/config 的 importedNames=[resolveWorkspaceRootOrThrow, resolveRunnerOptions] 中 [resolveRunnerOptions] 未被任何 move 的 symbols 覆盖";
const RECORDED_76 = "切法覆盖不足：边 gate -> gate/config 的 importedNames=[shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS, resolveRunnerOptions, discoverWorkspaceRoot, loadWorkspaceGates, loadWorkspaceGateMetadata, readGatesConfig, GatesConfig] 中 [shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS, resolveRunnerOptions, GatesConfig] 未被任何 move 的 sy";
const LOADER_FILE = "gate/config/loader.ts";
const MOVE_75 = [{ file: LOADER_FILE, from: "gate/config", to: "", symbols: ["resolveGateDiagnosticsSink", "emitDiagnostic", "discoverWorkspaceRoot", "resolveWorkspaceRootOrThrow", "readGatesConfig", "loadWorkspaceGateMetadata", "loadWorkspaceGates", "resolveAcceptanceTimeoutMs"] }];
const MOVE_76 = [{ file: LOADER_FILE, from: "gate/config", to: "", symbols: ["discoverWorkspaceRoot", "loadWorkspaceGates", "loadWorkspaceGateMetadata", "readGatesConfig", "resolveAcceptanceTimeoutMs", "resolveGateDiagnosticsSink", "emitDiagnostic"] }];
const EXPECTED_STAYS = ["CoverageFloorEntry", "DEFAULT_ACCEPTANCE_TIMEOUT_MS", "FixedEntry", "GateConfig", "GatesConfig", "It0Entry", "RedGreenEntry", "RunnerOptions", "TestPassEntry", "resolveRunnerOptions", "shQuote"];

const proposalFor = (moves) => ({ concern: "gate/config rides the cycle through its loader file", slice: { scope_root: LOCKED.scope_root, subject: "", moves, consumers: [] } });
// `computeSliceDelta` reads `root` only for provenance git calls when `deps.analyzePackageGraph` is injected —
// the graph comes from the fixture, which IS the locked tree.
const replayDeps = () => ({ analyzePackageGraph: () => ({ file: ARCH_FIXTURE, json: archJson() }), git: (a) => (a[0] === "rev-parse" ? `${LOCKED.tree_sha}\n` : "") });
const runCandidate = (moves, commit, deps = {}) => computeSliceDelta({ root: REPO, commit, proposal: proposalFor(moves), deps: { ...replayDeps(), ...deps } });

// ── the adapter's complement (no CLI needed) ────────────────────────────────────────────────────
test("stays: the complement of a partially-covered edge is declared, aggregated per destination dir, and never invented", () => {
  const graph = lockedGraph();
  for (const [moves, target] of [[MOVE_75, "cli -> gate/config"], [MOVE_76, "gate -> gate/config"]]) {
    const b = buildSliceInput({ graph, proposal: proposalFor(moves), provenance: {} });
    assert.equal(b.ok, true, JSON.stringify(b));
    assert.equal(b.stays_skipped, null);
    assert.deepEqual(b.stays, [{ dir: "gate/config", symbols: EXPECTED_STAYS }]);
    assert.deepEqual(b.slice.proposedCut.stays, b.stays, "the declaration must travel in the request");
    // AC6 — every declared name occurs in some REAL edge's importedNames (no invented symbol)
    const onEdges = new Set(graph.edges.flatMap((e) => e.importedNames));
    for (const s of b.stays.flatMap((x) => x.symbols)) assert.ok(onEdges.has(s), `invented symbol ${s}`);
    // AC7 — the staying set and the moved set are disjoint
    const moved = new Set(moves.flatMap((m) => m.symbols));
    for (const s of b.stays.flatMap((x) => x.symbols)) assert.ok(!moved.has(s), `both moved and staying: ${s}`);
    assert.ok(b.partial_edges.some((e) => `${e.from} -> ${e.to}` === target), `the target edge is a partial edge: ${target}`);
  }
});

test("stays: a fully-covered cut is unchanged — no `stays` key, no extra behaviour (regression)", () => {
  const graph = { nodes: ["", "cli"].map((id) => ({ id, type: "internal" })), edges: [{ from: "", to: "cli", importedNames: ["runDriver"] }] };
  const b = buildSliceInput({ graph, proposal: proposalFor([{ file: "cli/driver.ts", from: "cli", to: "", symbols: ["runDriver"] }]), provenance: {} });
  assert.equal(b.ok, true);
  assert.deepEqual(b.stays, []);
  assert.equal(b.slice.proposedCut.stays, undefined, "no declaration when nothing is partial");
});

test("AC5: one name uncovered into TWO different dirs is NOT emitted as two conflicting declarations — the cut stays under-covered", () => {
  const graph = {
    nodes: ["", "a", "b", "c"].map((id) => ({ id, type: "internal" })),
    edges: [
      { from: "b", to: "a", importedNames: ["m1"] },              // fully moved -> the negative-control edge
      { from: "z", to: "b", importedNames: ["m1", "shared"] },    // partial: `shared` has no move, stays in b
      { from: "z", to: "c", importedNames: ["m1", "shared"] },    // partial: `shared` would have to stay in c too
    ],
  };
  const b = buildSliceInput({ graph, proposal: proposalFor([{ file: "x.ts", from: "a", to: "", symbols: ["m1"] }]), provenance: {} });
  assert.equal(b.ok, true);
  assert.deepEqual(b.stays, [], "a name cannot be declared staying in two dirs (ArchGuard: 目的地冲突) — we refuse to emit it");
  assert.match(b.stays_skipped, /^CROSS_DIR_CONFLICT:/);
  assert.ok(b.stays_skipped.includes("shared"), b.stays_skipped);
  assert.equal(b.slice.proposedCut.stays, undefined, "no conflicting declaration reaches the request");
});

// ── the real primitive (gated on a CLI that implements `stays`) ─────────────────────────────────
const INSTALLED = resolveSliceDelta();
let probe;
const PROBE = () => (probe ??= INSTALLED.available ? runCandidate(MOVE_75, LOCKED.commit_75) : null);
// A CLI that predates the `stays` clause ignores the declaration and still refuses for the same coverage
// shortfall — the adapter flags that (`stays_ignored_by_tool`) instead of letting it look like a fix.
const STAYS_CAPABLE = () => { const p = PROBE(); return !!(p && p.status !== "not-evaluated" && p.stays_ignored_by_tool !== true); };
const SKIP_REASON = () => !INSTALLED.available ? `no usable ArchGuard slice-delta on this host (${INSTALLED.reason})`
  : `the installed ArchGuard ${INSTALLED.version} does not implement proposedCut.stays — it ignores the declaration and refuses with the same 切法覆盖不足 (stays_ignored_by_tool=${PROBE() && PROBE().stays_ignored_by_tool}); the real-candidate readings need a build carrying the stays clause`;

test("AC1: the REAL candidate ① (`cli -> gate/config`, uncovered resolveRunnerOptions) computes at the locked ref", (t) => {
  if (!STAYS_CAPABLE()) return t.skip(SKIP_REASON());
  const r = runCandidate(MOVE_75, LOCKED.commit_75);
  assert.notEqual(r.status, "not-evaluated", JSON.stringify(r).slice(0, 400));
  assert.equal(r.provenance.ref_commit, LOCKED.commit_75);
  assert.ok(!r.delta.removed_edges.some((e) => e.from === "cli" && e.to === "gate/config"), "a surviving edge is not removed");
  const a = r.accounting.find((x) => x.edge === "cli -> gate/config");
  assert.deepEqual({ survives: a.survives, staying: a.staying, unaccounted: a.unaccounted }, { survives: true, staying: ["resolveRunnerOptions"], unaccounted: [] });
  // The surviving edge keeps its imports; the moved name retargets to the destination dir. (`cli -> ""`
  // already exists in the graph, so the primitive's addedEdges — which exclude existing edges — stays empty;
  // the retarget is visible on the affected-consumer entry instead.)
  const c = r.affected_consumers.find((x) => x.edge === "cli -> gate/config");
  assert.deepEqual({ becomes: c.becomes, moved_from_dir: c.moved_from_dir, moved_to_dir: c.moved_to_dir }, { becomes: "survives", moved_from_dir: "gate/config", moved_to_dir: "" });
});

test("AC2: the REAL candidate ② (`gate -> gate/config`, 4 uncovered names) computes at the locked ref", (t) => {
  if (!STAYS_CAPABLE()) return t.skip(SKIP_REASON());
  const r = runCandidate(MOVE_76, LOCKED.commit_76);
  assert.notEqual(r.status, "not-evaluated", JSON.stringify(r).slice(0, 400));
  assert.equal(r.provenance.ref_commit, LOCKED.commit_76);
  assert.ok(!r.delta.removed_edges.some((e) => e.from === "gate" && e.to === "gate/config"));
  const a = r.accounting.find((x) => x.edge === "gate -> gate/config");
  assert.equal(a.survives, true);
  assert.equal(a.strength, null, "a directory-level graph carries no symbol localization — the surviving edge's strength is not fitted");
  assert.deepEqual(a.unaccounted, []);
  for (const n of ["shQuote", "DEFAULT_ACCEPTANCE_TIMEOUT_MS", "resolveRunnerOptions", "GatesConfig"]) assert.ok(a.staying.includes(n), `${n} must stay`);
});

test("AC3: negative control — dropping ONE declared name from the module's own output leaves the cut refused (the AC1/AC2 assertions are not vacuous)", (t) => {
  if (!STAYS_CAPABLE()) return t.skip(SKIP_REASON());
  // Mutate the module's OWN emitted slice (not a fixture): rewrite the slice file the adapter wrote, deleting
  // one declared symbol, then let the real CLI see it.
  const runCli = (cli, argv) => {
    const sp = argv[argv.indexOf("--slice") + 1];
    const slice = JSON.parse(fs.readFileSync(sp, "utf8"));
    for (const s of slice.proposedCut.stays) s.symbols = s.symbols.filter((x) => x !== "resolveRunnerOptions");
    fs.writeFileSync(sp, JSON.stringify(slice));
    return spawnSync("node", [cli, ...argv], { encoding: "utf8", timeout: 120_000 });
  };
  const r = runCandidate(MOVE_75, LOCKED.commit_75, { runCli });
  assert.equal(r.status, "not-evaluated", "a declaration missing a real name must NOT compute");
  assert.match(r.reason, /覆盖不足|uncovered/);
});

test("AC4: coverage is matched by symbol NAME globally, not by edge — assert the target edge's OWN accounting entry", (t) => {
  if (!STAYS_CAPABLE()) return t.skip(SKIP_REASON());
  // `resolveRunnerOptions` is imported by several separate edges into gate/config, yet the declaration names it
  // once. Asserting on the target edge's own entry (not on the report-wide status) is what stops a same-named
  // import on another edge from being read as this edge's result.
  const r = runCandidate(MOVE_76, LOCKED.commit_76);
  const perEdge = new Map(r.accounting.map((a) => [a.edge, a]));
  const target = perEdge.get("gate -> gate/config");
  const sibling = perEdge.get("gate/factories -> gate/config");
  assert.ok(target && sibling, `both edges are reconciled: ${[...perEdge.keys()].join(", ")}`);
  assert.deepEqual(target.staying, ["shQuote", "DEFAULT_ACCEPTANCE_TIMEOUT_MS", "resolveRunnerOptions", "GatesConfig"]);
  assert.ok(sibling.staying.length > target.staying.length, "the sibling edge carries more names: the entries are genuinely per-edge, not one global verdict");
  assert.ok(r.accounting.every((a) => a.unaccounted.length === 0));
});

test("stays: a CLI that ignores the clause is REPORTED, not silently mistaken for a fix (rule 3b)", (t) => {
  if (!INSTALLED.available) return t.skip(`no usable ArchGuard slice-delta on this host (${INSTALLED.reason})`);
  const p = PROBE();
  if (STAYS_CAPABLE()) { assert.notEqual(p.stays_ignored_by_tool, true); return; }
  // The released 0.1.39 path: the declaration went out and the tool refused anyway — say so, and cross-check
  // that the reconstruction reproduces the carrier's own recorded refusal on the locked graph.
  assert.equal(p.status, "not-evaluated");
  assert.equal(p.stays_ignored_by_tool, true);
  assert.equal(p.stays_declared.length, 1);
  assert.ok(p.reason.startsWith(RECORDED_75), `tool refusal must reproduce carrier record 75:\n  got  ${p.reason}\n  want ${RECORDED_75}`);
  const p76 = runCandidate(MOVE_76, LOCKED.commit_76);
  assert.ok(p76.reason.startsWith(RECORDED_76), `tool refusal must reproduce carrier record 76:\n  got  ${p76.reason}\n  want ${RECORDED_76}`);
});

test("fixture: the vendored locked-tree graph is byte-stable", () => {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(ARCH_FIXTURE)).digest("hex");
  assert.equal(sha, ARCH_SHA256, "the locked-tree fixture changed — re-verify the replay report");
  const g = lockedGraph();
  assert.deepEqual(g.cycles.map((c) => c.modules ?? c), [["gate/factories", "gate/config", "gate", ""]]);
});
