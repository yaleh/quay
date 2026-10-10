// @test-group engine
// Tests for the ownership ACTIVE INVESTIGATION loop (shadow only).
// No model, no network: the judge is a scripted function, the executor either a fake or run against stub deps.
// Covers: schema, budget, tool allow-list, provenance, no-write guard, reference/outcome leakage guard,
// deterministic gate, ArchGuard adapter, abstain-on-unreachable-evidence, quota/dedup, runtime seam.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BUDGET, EVIDENCE_KINDS, ARCHGUARD_QUERY_KINDS, newState, normalizeRepoPath,
  validateRequest, gateEvidenceRequest, validateStep,
} from "../../docs/analysis/ownership-active-contract.mjs";
import { createExecutor } from "../../docs/analysis/ownership-active-executor.mjs";
import { buildSliceInput, computeSliceDelta, renderDelta, resolveSliceDelta, versionAtLeast, MIN_ARCHGUARD_VERSION, SLICE_DELTA_SURFACE } from "../../docs/analysis/ownership-active-slice-adapter.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import {
  runActiveInvestigation, parseStep, quotaGate, resolveRuntime, appendCarrier, readCarrierHistory,
  buildStepPrompt, PROPOSER_ID, CARRIER_REL,
} from "../../docs/analysis/ownership-active-loop.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const ANALYSIS = path.join(REPO, "docs", "analysis");
const MODULES = ["ownership-active-contract.mjs", "ownership-active-executor.mjs", "ownership-active-slice-adapter.mjs", "ownership-active-loop.mjs"];

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "own-active-test-")); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────
const ARCHGUARD_FIXTURES = path.join(REPO, "plugin", "fixtures", "ownership-active-slice");   // vendored copies (sha256 recorded in the report)
const HEAD = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const GRAPH = {
  nodes: ["", "cli", "fan-in", "gate", "gate/config", "gate/factories"].map((id) => ({ id, name: id || "(root)", type: "internal" })),
  edges: [
    { from: "", to: "cli", importedNames: ["runDriver", "ALL_SERVICE_NAMES", "HOSTED_SERVICE_NAMES"] },
    { from: "cli", to: "", importedNames: ["loadConfig"] },
    { from: "cli", to: "fan-in", importedNames: ["probeInstruments"] },
    { from: "fan-in", to: "", importedNames: ["x"] },
    { from: "", to: "gate", importedNames: ["g"] }, { from: "gate", to: "", importedNames: ["abi"] },
  ],
};
const GOOD_SLICE = { scope_root: "packages/quay/src", subject: "", moves: [
  { file: "cli/driver.ts", from: "cli", to: "", symbols: ["runDriver"] },
  { file: "cli/driver-vocab.ts", from: "cli", to: "", symbols: ["ALL_SERVICE_NAMES", "HOSTED_SERVICE_NAMES"] },
] };
const proposal = (over = {}) => ({
  concern_kind: "package-cycle", concern: "A package dependency cycle ties the root to its cli layer through two imported primitives.",
  evidence_refs: ["ev-1"], candidate_interventions: [{ title: "move the two primitives to root", rationale: "root is the lower layer" }],
  scope: { in_scope: ["move driver-vocab and runDriver core"], non_goals: ["the gate cycle"] },
  negative_control: "re-add one root->cli import and the cycle must return to its before size",
  abandon_or_reconsider_condition: "if another member still points into cli after the cut",
  confidence: { level: "medium", basis: "both root->cli edges are enumerated in ev-1" },
  slice: GOOD_SLICE, ...over,
});

// A fake executor: counts tool calls, can return scripted evidence per request key.
function fakeExecutor(script = {}, commit = "c0ffee0000000000000000000000000000000000") {
  const calls = [];
  let n = 0;
  return {
    calls,
    commit: () => commit,
    execute(req) {
      calls.push(req);
      const key = req.kind === "archguard_query" ? `archguard:${req.query}` : req.kind;
      const r = script[key] || { status: "ok", text: `reading for ${key}` };
      const text = r.text ?? `GAP ${key}`;
      return { id: `ev-${++n}`, request: req, status: r.status || "ok", text, bytes: Buffer.byteLength(text), truncated: false, total_bytes: Buffer.byteLength(text), provenance: { tool: key, ref_commit: "c0ffee", ts: "2026-10-10T00:00:00Z", content_sha256: "x" }, ...(r.cycles ? { cycles: r.cycles } : {}), ...(r.gap ? { gap: r.gap } : {}) };
    },
  };
}
// A scripted judge: returns the queued steps in order (objects are JSON-stringified; strings pass through).
function scriptedJudge(steps) {
  const prompts = [];
  let i = 0;
  const fn = async (prompt) => { prompts.push(prompt); const s = steps[Math.min(i++, steps.length - 1)]; return { status: 0, stdout: typeof s === "string" ? s : JSON.stringify(s) }; };
  fn.prompts = prompts;
  return fn;
}
const req = (request, extra = {}) => ({ action: "request_evidence", hypothesis: "root and cli may be mutually dependent", sufficient: false, why: "need the cycle", request, ...extra });
const REQ_CYCLES = { kind: "archguard_query", query: "package_cycles" };
const sliceDeps = (over = {}) => ({
  sliceDelta: { available: true, cli: "/x/archguard/cli.js", version: "0.1.39", surface: SLICE_DELTA_SURFACE },
  git: (a) => (a[0] === "rev-parse" ? "tree123\n" : ""),
  analyzePackageGraph: () => ({ file: "/dev/null", json: { extensions: { tsAnalysis: { moduleGraph: GRAPH } } } }),
  ...over,
});

// ── 1. schema ──────────────────────────────────────────────────────────────────────────────────
test("schema: exactly three request kinds are admitted, each validated declaratively", () => {
  assert.deepEqual([...EVIDENCE_KINDS], ["read_file", "grep", "archguard_query"]);
  assert.ok(validateRequest({ kind: "read_file", path: "packages/quay/src/serve.ts", start_line: 40, end_line: 60 }).ok);
  assert.ok(validateRequest({ kind: "grep", pattern: "from ['\"]\\./cli/", paths: ["packages/quay/src"] }).ok);
  assert.ok(validateRequest({ kind: "archguard_query", query: "used_by", args: { name: "runDriver", depth: 2 } }).ok);
  for (const bad of [null, [], { kind: "bash", command: "ls" }, { kind: "write_file", path: "a" }, { kind: "archguard_query", query: "rm" }]) {
    assert.equal(validateRequest(bad).ok, false, JSON.stringify(bad));
  }
  assert.match(validateRequest({ kind: "bash" }).reasons[0], /^KIND_NOT_ALLOWED/);
});

test("schema: read ranges, regexes, scoped paths and query args are all bounded", () => {
  const b = DEFAULT_BUDGET;
  assert.match(validateRequest({ kind: "read_file", path: "a.ts", start_line: 1, end_line: b.max_read_lines + 1 }).reasons[0], /^RANGE_TOO_LARGE/);
  assert.equal(validateRequest({ kind: "read_file", path: "a.ts", start_line: 0 }).ok, false);
  assert.ok(validateRequest({ kind: "grep", pattern: "(", paths: ["a"] }).reasons.includes("PATTERN_NOT_A_REGEX"));
  assert.ok(validateRequest({ kind: "grep", pattern: "x", paths: [] }).reasons.includes("GREP_PATHS_REQUIRED_SCOPED"));
  assert.equal(validateRequest({ kind: "grep", pattern: "x", paths: ["."] }).ok, false, "a repo-wide '.' scope must be refused");
  assert.equal(validateRequest({ kind: "archguard_query", query: "dependencies", args: { name: "a b; rm -rf" } }).ok, false);
  assert.equal(validateRequest({ kind: "archguard_query", query: "dependencies", args: { name: "X", depth: 9 } }).ok, false);
});

// ── 2. leakage guard + path scope ──────────────────────────────────────────────────────────────
test("scope: paths cannot escape the root or reach reference/outcome/benchmark/runtime state", () => {
  for (const p of ["../etc/passwd", "/etc/passwd", "a/../../b", "plugin/fixtures/meta-driver-replay/GOAL-033/reference.json",
    "plugin/fixtures/meta-driver-replay/GOAL-033/outcome.json", "docs/analysis/ownership-two-stage-ab-results.json",
    "docs/analysis/dossier-evidence/GOAL-032-duplicates.txt", ".quay/ownership-shadow-proposals.jsonl", ".git/config", "node_modules/x/index.js", "deep/reference.json"]) {
    assert.equal(normalizeRepoPath(p).ok, false, p);
    assert.equal(validateRequest({ kind: "read_file", path: p, start_line: 1 }).ok, false, p);
  }
  assert.deepEqual(normalizeRepoPath("./packages//quay/src/./serve.ts"), { ok: true, path: "packages/quay/src/serve.ts" });
});

// ── 3. budgets, dedup, allow-list at the gate ─────────────────────────────────────────────────
test("budget: requests, bytes and duplicates are refused with distinct codes; state is not mutated", () => {
  const st = newState({ ...DEFAULT_BUDGET, max_evidence_requests: 2 });
  const r = { kind: "read_file", path: "a.ts", start_line: 1, end_line: 5 };
  assert.ok(gateEvidenceRequest(r, st).ok);
  st.requests_used = 2;
  assert.deepEqual(gateEvidenceRequest(r, st).reasons, ["BUDGET_EXHAUSTED:requests"]);
  st.requests_used = 0; st.bytes_used = DEFAULT_BUDGET.max_total_evidence_bytes;
  assert.deepEqual(gateEvidenceRequest(r, st).reasons, ["BUDGET_EXHAUSTED:bytes"]);
  st.bytes_used = 0;
  const g = gateEvidenceRequest(r, st);
  st.seen.push(JSON.stringify(g.normalized));
  assert.deepEqual(gateEvidenceRequest(r, st).reasons, ["DUPLICATE_REQUEST"]);
  assert.equal(st.rounds_used, 0);
});

// ── 4. step validation (what the model may and may not say) ───────────────────────────────────
test("step: propose requires sufficiency, resolvable readings, structured cut, and NO self-declared delta", () => {
  const st = newState();
  st.evidence.push({ id: "ev-1", status: "ok" }, { id: "ev-2", status: "capability_gap" });
  const base = { action: "propose_slice", hypothesis: "root and cli share two primitives", sufficient: true, proposal: proposal() };
  assert.ok(validateStep(base, st).ok, JSON.stringify(validateStep(base, st)));
  assert.ok(validateStep({ ...base, sufficient: false }, st).reasons.includes("PROPOSE_REQUIRES_SUFFICIENT"));
  assert.match(validateStep({ ...base, proposal: proposal({ evidence_refs: ["ev-9"] }) }, st).reasons.join(), /EVIDENCE_UNRESOLVED:ev-9/);
  assert.match(validateStep({ ...base, proposal: proposal({ evidence_refs: ["ev-2"] }) }, st).reasons.join(), /EVIDENCE_NOT_A_READING:ev-2/);
  assert.ok(validateStep({ ...base, proposal: proposal({ expected_mechanical_delta: "6 -> 4" }) }, st).reasons.includes("DELTA_MUST_BE_COMPUTED_NOT_DECLARED"));
  assert.ok(validateStep({ ...base, proposal: proposal({ slice: { ...GOOD_SLICE, moves: [{ file: "a", from: "x", to: "x", symbols: ["s"] }] } }) }, st).reasons.some((r) => r.startsWith("SLICE_MOVE_MALFORMED")));
  assert.ok(validateStep({ ...base, proposal: proposal({ slice: { ...GOOD_SLICE, scope_root: undefined } }) }, st).reasons.includes("SLICE_SCOPE_ROOT_MISSING"));
  assert.ok(validateStep({ ...base, proposal: proposal({ concern_kind: "duplicate", slice: undefined }) }, st).reasons.includes("DECLARED_MEASUREMENT_REQUIRED_FOR_NON_CYCLE_KIND"));
  assert.ok(validateStep({ action: "teleport", hypothesis: "x".repeat(20), sufficient: false }, st).reasons[0].startsWith("ACTION_NOT_IN_VOCAB"));
});

// ── 5. executor: provenance, pinned reads, capability gap, deny filter ────────────────────────
function stubDeps({ files = {}, grep = "", archguard = true } = {}) {
  const calls = { git: [], archguard: [] };
  return {
    calls,
    git: (a) => { calls.git.push(a); if (a[0] === "rev-parse") return "abc1234567890def\n"; if (a[0] === "show") { const k = a[1].split(":").slice(1).join(":"); if (!(k in files)) throw new Error("missing"); return files[k]; } return ""; },
    gitMaybe: (a) => {
      calls.git.push(a);
      if (a[0] === "cat-file") { const k = a[2].split(":").slice(1).join(":"); return k in files ? { out: "blob\n", code: 0 } : { out: "", code: 128 }; }
      if (a[0] === "grep") return { out: grep, code: grep ? 0 : 1 };
      if (a[0] === "diff") return { out: "", code: 0 };
      return { out: "", code: 0 };
    },
    archguardAvailable: () => archguard,
    archguardVersion: () => "0.1.38",
    ensureSnapshot: () => ({ workDir: "/tmp/x", scope: "s1", entities: 5, built_at: "2026-10-10T00:00:00Z" }),
    archguardQuery: (snap, flags) => {
      calls.archguard.push(flags);
      if (flags[0] === "--entity") return flags[1] === "runDriver" ? 'Entities matching "runDriver":\n\n  runDriver (function) @ cli/driver.ts:433\n\n  Total: 1\n' : `Entities matching "${flags[1]}":\n\n  (none)\n`;
      if (flags[0] === "--deps-of" || flags[0] === "--used-by") return `Dependencies of "${flags[1]}" (depth: 1):\n\n  (none)\n`;
      return "Found 1 directory-level dependency cycle(s):\n\n  Cycle 1 (size 2): a -> b\n";
    },
    analyzePackageGraph: (abs) => ({ file: "", json: { extensions: { tsAnalysis: { moduleGraph: { ...GRAPH, cycles: [{ modules: ["", "cli", "fan-in"], severity: "error" }] } } } } }),
  };
}
test("executor: read_file is pinned to the commit, line-sliced, and carries full provenance", () => {
  const deps = stubDeps({ files: { "src/a.ts": "l1\nl2\nl3\nl4\n" } });
  const ex = createExecutor({ root: "/r", deps, now: () => "2026-10-10T01:02:03Z" });
  const ev = ex.execute({ kind: "read_file", path: "src/a.ts", start_line: 2, end_line: 3 });
  assert.equal(ev.status, "ok");
  assert.match(ev.text, /^\s+2\| l2\n\s+3\| l3$/);
  assert.deepEqual({ tool: ev.provenance.tool, path: ev.provenance.path, range: ev.provenance.range, ref: ev.provenance.ref_commit, ts: ev.provenance.ts }, { tool: "read_file", path: "src/a.ts", range: [2, 3], ref: "abc1234567890def", ts: "2026-10-10T01:02:03Z" });
  assert.match(ev.provenance.content_sha256, /^[0-9a-f]{64}$/);
  assert.ok(deps.calls.git.some((a) => a[0] === "show" && a[1] === "abc1234567890def:src/a.ts"), "must read the git object, not the working tree");
  assert.equal(ex.execute({ kind: "read_file", path: "nope.ts", start_line: 1 }).reason, "PATH_NOT_IN_REF");
});

test("executor: grep rows are commit-pinned, capped, and rows from denied paths are dropped (counted)", () => {
  const rows = ["abc1234567890def:packages/a.ts:10:import x", "abc1234567890def:plugin/fixtures/meta-driver-replay/G/reference.json:3:SECRET", "abc1234567890def:docs/analysis/ownership-x.mjs:1:leak"].join("\n");
  const ex = createExecutor({ root: "/r", deps: stubDeps({ grep: rows }) });
  const ev = ex.execute({ kind: "grep", pattern: "import", fixed: false, paths: ["packages", "plugin", "docs"] });
  assert.equal(ev.status, "ok");
  assert.match(ev.text, /packages\/a\.ts:10:import x/);
  assert.doesNotMatch(ev.text, /SECRET|ownership-x/);
  assert.equal(ev.denied_rows_dropped, 2);
  assert.equal(ev.provenance.paths.join(), "packages,plugin,docs");
});

test("executor: an unreachable ArchGuard capability is an explicit capability_gap and NEVER reaches a tool", () => {
  const deps = stubDeps();
  const ex = createExecutor({ root: "/r", deps });
  for (const q of ["duplicates", "literal_dispersion"]) {
    const ev = ex.execute({ kind: "archguard_query", query: q, args: {} });
    assert.equal(ev.status, "capability_gap");
    assert.equal(ev.gap.capability, ARCHGUARD_QUERY_KINDS[q].gap.capability);
    assert.equal(ev.gap.available_via.cli, null, "the gap must name that no CLI surface exists");
    assert.match(ev.text, /No reading was produced/);
  }
  assert.equal(deps.calls.archguard.length, 0, "no ArchGuard process may be spawned for a declared gap");
  const none = createExecutor({ root: "/r", deps: stubDeps({ archguard: false }) }).execute({ kind: "archguard_query", query: "package_cycles", args: {} });
  assert.equal(none.status, "capability_gap");
});

test("executor: package_cycles is parsed into structured members and records snapshot provenance", () => {
  const ev = createExecutor({ root: "/r", deps: stubDeps() }).execute({ kind: "archguard_query", query: "package_cycles", args: {} });
  assert.equal(ev.status, "ok");
  assert.deepEqual(ev.cycles, [{ size: 2, members: ["a", "b"] }]);
  assert.deepEqual({ v: ev.provenance.archguard_version, scope: ev.provenance.snapshot_scope, matches: ev.provenance.snapshot_matches_ref }, { v: "0.1.38", scope: "s1", matches: true });
  assert.deepEqual(ev.provenance.flags, ["--cycles", "--output-scope", "package"]);
});

test("executor: dependencies/used_by on an unknown entity or a directory is an explicit ENTITY_NOT_FOUND, not an empty 'ok'", () => {
  const ex = createExecutor({ root: "/r", deps: stubDeps() });
  const dir = ex.execute({ kind: "archguard_query", query: "dependencies", args: { name: "packages/quay/src/gate", depth: 1 } });
  assert.equal(dir.status, "error");
  assert.equal(dir.reason, "ENTITY_NOT_FOUND");
  assert.match(dir.text, /package_edges/, "the refusal must point at the right directory-level query");
  assert.equal(ex.execute({ kind: "archguard_query", query: "used_by", args: { name: "NoSuchThing", depth: 1 } }).reason, "ENTITY_NOT_FOUND");
  // a REAL entity with no edges stays an ok reading
  const real = ex.execute({ kind: "archguard_query", query: "dependencies", args: { name: "runDriver", depth: 1 } });
  assert.equal(real.status, "ok");
});

test("executor: package_edges reads ArchGuard's module graph — edges carry the imported names, cycles are structured, provenance names the tree", () => {
  const ex = createExecutor({ root: "/r", deps: stubDeps() });
  const ev = ex.execute({ kind: "archguard_query", query: "package_edges", args: { scope_root: "packages/quay/src" } });
  assert.equal(ev.status, "ok");
  assert.match(ev.text, /"" \(root of scope_root\) -> cli .*names=\[runDriver, ALL_SERVICE_NAMES, HOSTED_SERVICE_NAMES\]/);
  assert.deepEqual(ev.cycles, [{ size: 3, members: ["", "cli", "fan-in"] }]);
  assert.equal(ev.provenance.scope_root, "packages/quay/src");
  assert.match(ev.provenance.graph_sha256, /^[0-9a-f]{64}$/);
  const f = ex.execute({ kind: "archguard_query", query: "package_edges", args: { scope_root: "packages/quay/src", from: "", to: "cli" } });
  assert.match(f.text, /1 internal edges \(filtered\)/);
  assert.equal(validateRequest({ kind: "archguard_query", query: "package_edges", args: {} }).ok, false, "scope_root is required");
  assert.equal(validateRequest({ kind: "archguard_query", query: "package_edges", args: { scope_root: "../x" } }).ok, false);
  assert.equal(validateRequest({ kind: "archguard_query", query: "package_edges", args: { scope_root: ".quay/deliver-worktree-1" } }).ok, false);
});

test("dialect: a regex JS accepts but git grep -E cannot run is refused at the gate with its own code", () => {
  for (const p of ["from ['\"](?:\\.\\./)+", "\\d+ files", "(?=x)y"]) {
    const r = validateRequest({ kind: "grep", pattern: p, paths: ["packages"] });
    assert.ok(r.reasons.includes("PATTERN_NOT_ERE"), `${p}: ${r.reasons}`);
  }
  assert.ok(validateRequest({ kind: "grep", pattern: "from ['\"]\\.\\./", paths: ["packages"] }).ok);
});

// ── 6. ArchGuard adapter ───────────────────────────────────────────────────────────────────────
test("adapter: restore edges are DERIVED from the graph; a cut that explains no edge is not-evaluated", () => {
  const ok = buildSliceInput({ graph: GRAPH, proposal: proposal(), provenance: {} });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.slice.negativeControl.restoreEdges, [{ from: "", to: "cli" }]);
  assert.deepEqual(ok.slice.mustNotChange.untouchedDirs, ["fan-in", "gate", "gate/config", "gate/factories"]);
  const none = buildSliceInput({ graph: GRAPH, proposal: proposal({ slice: { ...GOOD_SLICE, moves: [{ file: "cli/x.ts", from: "cli", to: "", symbols: ["notImportedByAnyone"] }] } }), provenance: {} });
  assert.equal(none.reason, "NO_EDGE_EXPLAINED_BY_MOVES");
  const badDir = buildSliceInput({ graph: GRAPH, proposal: proposal({ slice: { ...GOOD_SLICE, moves: [{ file: "z.ts", from: "nope", to: "", symbols: ["a"] }] } }), provenance: {} });
  assert.match(badDir.reason, /^MOVE_FROM_NOT_AN_INTERNAL_DIR/);
  assert.ok(badDir.valid_dirs.includes("cli"), "refusal must list the valid directories");
});

test("adapter: a REDIRECT cut (importer is neither source nor destination) is derived from the same coverage rule, and its importer is not 'untouched'", () => {
  const g = { nodes: GRAPH.nodes, edges: [...GRAPH.edges.filter((e) => !(e.from === "cli" && e.to === "fan-in")), { from: "cli", to: "fan-in", importedNames: ["probeInstruments", "InstrumentProbe"] }] };
  const r = buildSliceInput({ graph: g, proposal: proposal({ slice: { scope_root: "packages/quay/src", subject: "", moves: [{ file: "fan-in/ff-merge.ts", from: "fan-in", to: "", symbols: ["probeInstruments", "InstrumentProbe"] }] } }), provenance: {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.slice.negativeControl.restoreEdges, [{ from: "cli", to: "fan-in" }]);
  assert.ok(!r.slice.mustNotChange.untouchedDirs.includes("cli"), "an importer that loses the edge is not untouched");
  // PARTIAL cover of an edge's names is not pro-rated: the cut explains no edge
  const partial = buildSliceInput({ graph: g, proposal: proposal({ slice: { scope_root: "packages/quay/src", subject: "", moves: [{ file: "fan-in/ff-merge.ts", from: "fan-in", to: "", symbols: ["probeInstruments"] }] } }), provenance: {} });
  assert.equal(partial.reason, "NO_EDGE_EXPLAINED_BY_MOVES");
});

test("adapter: the REAL primitive computes a redirect cut (probe relocated out of fan-in) as 6 -> 5 with fan-in leaving and no guard violation", (t) => {
  if (!REAL_PRIMITIVE) return t.skip("primitive not present");
  const fixture = JSON.parse(fs.readFileSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"), "utf8"));
  const names = fixture.extensions.tsAnalysis.moduleGraph.edges.find((e) => e.from === "cli" && e.to === "fan-in").importedNames;
  const r = computeSliceDelta({ root: REPO, commit: HEAD, deps: { git: (a) => (a[0] === "rev-parse" ? "t\n" : ""), analyzePackageGraph: () => ({ file: "", json: fixture }) },
    proposal: proposal({ slice: { scope_root: "packages/quay/src", subject: "", moves: [{ file: "fan-in/ff-merge.ts", from: "fan-in", to: "", symbols: names }] } }) });
  assert.equal(r.status, "evaluated", JSON.stringify(r).slice(0, 300));
  assert.equal(r.delta.after.scc_size, 5);
  assert.deepEqual(r.delta.left, ["fan-in"]);
  assert.equal(r.negative_control.falsified, true);
  assert.deepEqual(r.guards.violations, []);
});

test("adapter: exit 1 with a clean must-not-change but an UNFALSIFIED control is reported as a computed no-op cut, with its reason", () => {
  const report = { status: "evaluated", current: { sccSize: 6, sccMembers: ["", "cli", "fan-in", "gate", "gate/config", "gate/factories"] },
    computedDelta: { sccAfter: ["", "cli", "fan-in", "gate", "gate/config", "gate/factories"], sccLeft: [], removedEdges: [{ from: "gate", to: "gate/factories", importedNames: ["makeGoalGate"], becomes: "intra-directory" }], addedEdges: [] },
    mustNotChange: { violations: [], forbiddenNewEdges: [] }, negativeControl: { restoreEdges: [{ from: "gate", to: "gate/factories" }], subjectSccMembersAfterRestore: [], subjectBackInScc: false, falsified: false },
    guards: { clean: false, violations: 0, negativeControlFalsified: false }, proposedCut: { assumptions: [] } };
  const g = { nodes: GRAPH.nodes, edges: [{ from: "gate", to: "gate/factories", importedNames: ["makeGoalGate"] }, ...GRAPH.edges] };
  const r = computeSliceDelta({ root: "/r", commit: "abc", deps: { sliceDelta: { available: true, cli: "/x/cli.js", version: "0.1.39", surface: SLICE_DELTA_SURFACE }, git: (a) => (a[0] === "rev-parse" ? "t\n" : ""),
      analyzePackageGraph: () => ({ file: "", json: { extensions: { tsAnalysis: { moduleGraph: g } } } }),
      runCli: (cli, argv) => { fs.writeFileSync(argv[argv.indexOf("--json") + 1], JSON.stringify(report)); return { status: 1, stdout: "", stderr: "" }; } },
    proposal: proposal({ slice: { scope_root: "packages/quay/src", subject: "gate", moves: [{ file: "gate/factories/goal.ts", from: "gate/factories", to: "gate", symbols: ["makeGoalGate"] }] } }) });
  assert.equal(r.status, "guard-violated");
  assert.match(r.reason, /^NEGATIVE_CONTROL_NOT_FALSIFIED/);
  assert.equal(r.guards.violations.length, 0);
  assert.match(renderDelta(r), /size 6 -> 6.*negative control falsified=false.*nothing for the control to restore/);
  assert.doesNotMatch(renderDelta(r), /none violated/);
});

test("adapter: a missing primitive is a capability gap, never an estimated delta", () => {
  const r = computeSliceDelta({ root: "/r", commit: "abc", proposal: proposal(), deps: { sliceDelta: { available: false, version: "0.1.38", reason: "ARCHGUARD_VERSION_TOO_OLD:0.1.38<0.1.39" } } });
  assert.equal(r.status, "unavailable");
  assert.equal(r.gap.capability, "archguard.slice_delta");
  assert.equal(r.delta, undefined);
  assert.equal(r.gap.surface.shipped_in_published_package, true, "the capability IS released; this host's install is what is missing/old");
  assert.equal(r.gap.installed_version, "0.1.38");
  assert.match(r.gap.reason, new RegExp(`>= ${MIN_ARCHGUARD_VERSION.replace(/\./g, "\\.")}`));
});

const INSTALLED = resolveSliceDelta();             // the released CLI, probed (version + subcommand)
const REAL_PRIMITIVE = INSTALLED.available && fs.existsSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"));
test("adapter: the REAL primitive on the GOAL-033 fork-point graph yields 6 -> 4 with a falsified control", (t) => {
  if (!REAL_PRIMITIVE) return t.skip("ArchGuard repo / slice-delta primitive not present on this host");
  const fixture = JSON.parse(fs.readFileSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"), "utf8"));
  const p = proposal({ slice: { scope_root: "packages/quay/src", subject: "", moves: [
    { file: "cli/driver.ts", from: "cli", to: "", symbols: ["runDriver", "runDriverAsync", "resolveDriverInvocation", "DriverRunResult"] },
    { file: "cli/driver-vocab.ts", from: "cli", to: "", symbols: ["ALL_SERVICE_NAMES", "HOSTED_SERVICE_NAMES", "KINDS", "VERBS"] } ] } });
  const r = computeSliceDelta({ root: REPO, commit: HEAD, proposal: p, deps: { git: (a) => (a[0] === "rev-parse" ? "t\n" : ""), analyzePackageGraph: () => ({ file: "", json: fixture }) } });
  assert.equal(r.status, "evaluated", JSON.stringify(r).slice(0, 400));
  assert.equal(r.delta.before.scc_size, 6);
  assert.equal(r.delta.after.scc_size, 4);
  assert.deepEqual([...r.delta.left].sort(), ["cli", "fan-in"]);
  assert.equal(r.negative_control.falsified, true);
  assert.equal(r.provenance.archguard_version, INSTALLED.version);
  assert.match(r.provenance.report_sha256, /^[0-9a-f]{64}$/);
  assert.match(renderDelta(r), /the cycle containing "" \(root\): size 6 -> 4/);
});

test("adapter: when the model tracks the dir that LEAVES, the headline reading uses a canonical surviving subject (no '6 -> 1' nonsense)", (t) => {
  if (!REAL_PRIMITIVE) return t.skip("primitive not present");
  const fixture = JSON.parse(fs.readFileSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"), "utf8"));
  const names = fixture.extensions.tsAnalysis.moduleGraph.edges.find((e) => e.from === "cli" && e.to === "fan-in").importedNames;
  const r = computeSliceDelta({ root: REPO, commit: HEAD, deps: { git: (a) => (a[0] === "rev-parse" ? "t\n" : ""), analyzePackageGraph: () => ({ file: "", json: fixture }) },
    proposal: proposal({ slice: { scope_root: "packages/quay/src", subject: "fan-in", moves: [{ file: "fan-in/ff-merge.ts", from: "fan-in", to: "", symbols: names }] } }) });
  assert.equal(r.status, "evaluated");
  assert.equal(r.subject.model_chosen, "fan-in");
  assert.equal(r.subject.tracked, "");
  assert.equal(r.delta.before.scc_size, 6);
  assert.equal(r.delta.after.scc_size, 5, "the surviving cycle, not the departing member's singleton");
  assert.deepEqual(r.delta.left, ["fan-in"]);
  assert.equal(r.model_subject_view.delta.after.scc_size, 1, "the model's own view is kept, labelled");
  assert.match(renderDelta(r), /size 6 -> 5/);
  assert.doesNotMatch(renderDelta(r).split("(Tracked")[0], /size 6 -> 1/);
});

test("adapter: a PARTIAL cut (one edge) is reported as no departure — the control is what makes that visible", (t) => {
  if (!REAL_PRIMITIVE) return t.skip("primitive not present");
  const fixture = JSON.parse(fs.readFileSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"), "utf8"));
  const p = proposal({ slice: { scope_root: "packages/quay/src", subject: "", moves: [{ file: "cli/driver-vocab.ts", from: "cli", to: "", symbols: ["ALL_SERVICE_NAMES", "HOSTED_SERVICE_NAMES", "KINDS", "VERBS"] }] } });
  const r = computeSliceDelta({ root: REPO, commit: HEAD, proposal: p, deps: { git: (a) => (a[0] === "rev-parse" ? "t\n" : ""), analyzePackageGraph: () => ({ file: "", json: fixture }) } });
  assert.ok(["evaluated", "not-evaluated"].includes(r.status));
  if (r.status === "evaluated") { assert.equal(r.delta.after.scc_size, 6); assert.deepEqual(r.delta.left, []); }
});

// ── 7. the loop ────────────────────────────────────────────────────────────────────────────────
const propose = (over) => ({ action: "propose_slice", hypothesis: "root and cli share two primitives", sufficient: true, why: "enumerated", proposal: proposal(over) });
const REAL_GRAPH_DEPS = () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"), "utf8"));
  return sliceDeps({ sliceDelta: undefined, analyzePackageGraph: () => ({ file: "", json: fixture }), git: (a) => (a[0] === "rev-parse" ? "t\n" : "") });
};

test("loop: request -> evidence -> propose; delta is COMPUTED, envelope is gate-clean and never executed", async (t) => {
  if (!REAL_PRIMITIVE) return t.skip("primitive not present");
  const ex = fakeExecutor({ "archguard:package_cycles": { status: "ok", text: "Cycle 1 (size 6): a -> b", cycles: [{ size: 6, members: ["", "cli"] }] } }, HEAD);
  const real = { moves: [
    { file: "cli/driver.ts", from: "cli", to: "", symbols: ["runDriver", "runDriverAsync", "resolveDriverInvocation", "DriverRunResult"] },
    { file: "cli/driver-vocab.ts", from: "cli", to: "", symbols: ["ALL_SERVICE_NAMES", "HOSTED_SERVICE_NAMES", "KINDS", "VERBS"] }] };
  const judge = scriptedJudge([req(REQ_CYCLES), propose({ slice: { scope_root: "packages/quay/src", subject: "", ...real } })]);
  const deps = { executor: ex, git: () => "", sliceDeps: REAL_GRAPH_DEPS() };
  const res = await runActiveInvestigation({ root: REPO, invokeJudge: judge, deps });
  assert.equal(res.terminal.kind, "propose_slice");
  assert.equal(res.action, "propose-goal");
  assert.equal(res.gate_ok, true, res.gate_reasons.join());
  assert.equal(res.executed, false);
  assert.equal(res.slice_delta.status, "evaluated");
  assert.match(res.envelope.expected_mechanical_delta, /computed, not estimated.*size 6 -> 4/);
  assert.match(res.envelope.negative_control, /Computed negative control.*falsified=true/);
  assert.equal(res.slice_delta.provenance.surface.surface, "archguard-cli");
  assert.equal(res.slice_delta.provenance.archguard_version, INSTALLED.version);
  assert.match(res.slice_delta.provenance.command, /^archguard slice-delta --arch/);
  assert.deepEqual(res.requested_kinds, ["archguard:package_cycles"]);
  assert.equal(res.usage.evidence_requests, 1);
  assert.equal(ex.calls.length, 1, "exactly one tool call");
});

test("loop: the model cannot get a delta past the gate by stating one — three invalid steps force an honest abstain", async () => {
  const ex = fakeExecutor();
  const judge = scriptedJudge([req(REQ_CYCLES), propose({ expected_mechanical_delta: "6 -> 1" })]);
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, deps: { executor: ex, git: () => "" } });
  assert.equal(res.terminal.kind, "not-evaluated");
  assert.equal(res.terminal.forced, true);
  assert.equal(res.terminal.forced_cause, "too-many-invalid-steps");
  assert.ok(res.steps.some((s) => s.outcome === "step-invalid" && s.reasons.includes("DELTA_MUST_BE_COMPUTED_NOT_DECLARED")));
  assert.equal(res.action, "not-evaluated", "the judge never produced a usable judgment — that is not an abstain");
  assert.equal(res.envelope, null);
  assert.equal(res.concern_key, null, "a not-evaluated run must not be able to enter dedup history");
  assert.equal(res.slice_delta, null, "no primitive call for an invalid proposal");
});

test("loop: budget exhaustion is a TERMINAL abstain with the cause named — never a guess", async () => {
  const ex = fakeExecutor();
  const n = { i: 0 };
  const judge = async (prompt) => ({ status: 0, stdout: JSON.stringify(req({ kind: "read_file", path: `f${n.i++}.ts`, start_line: 1, end_line: 5 })) });
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, budget: { ...DEFAULT_BUDGET, max_evidence_requests: 2, max_rounds: 8 }, deps: { executor: ex, git: () => "" } });
  assert.equal(res.terminal.kind, "abstain");
  assert.equal(res.terminal.forced, true);
  assert.match(res.terminal.forced_cause, /^not-enough-evidence:/);
  assert.equal(ex.calls.length, 2, "tool calls are capped at the budget");
  assert.equal(res.action, "abstain");
  assert.equal(res.gate_ok, true, "an honest abstain must pass the deterministic gate");
  assert.ok(res.steps.some((s) => s.outcome === "request-refused" && s.reasons.some((r) => r.startsWith("BUDGET_EXHAUSTED"))));
});

test("loop: rounds are bounded even when every request is refused", async () => {
  const judge = async () => ({ status: 0, stdout: JSON.stringify(req({ kind: "read_file", path: "../escape", start_line: 1 })) });
  const ex = fakeExecutor();
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, budget: { ...DEFAULT_BUDGET, max_rounds: 4 }, deps: { executor: ex, git: () => "" } });
  assert.ok(res.usage.rounds <= 4);
  assert.equal(ex.calls.length, 0, "a refused request never reaches the executor");
  assert.equal(res.terminal.kind, "abstain");
});

test("loop: unreachable evidence is exposed as a capability gap, charged to no tool budget, and ends in investigate/abstain", async () => {
  const gap = ARCHGUARD_QUERY_KINDS.duplicates.gap;
  const ex = fakeExecutor({ "archguard:duplicates": { status: "capability_gap", text: "CAPABILITY GAP: ...", gap } });
  const judge = scriptedJudge([
    req({ kind: "archguard_query", query: "duplicates", args: {} }),
    req({ kind: "archguard_query", query: "duplicates", args: {} }),          // repeated => refused, not re-run
    { action: "investigate_more", hypothesis: "two parsers may be duplicated across packages and plugin", sufficient: false, why: "cannot confirm", what_is_missing: "a duplicate-group reading, which the CLI surface does not provide" },
  ]);
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, deps: { executor: ex, git: () => "" } });
  assert.equal(res.terminal.kind, "investigate_more");
  assert.equal(res.terminal.forced, false, "it stopped on its own, not at a limit");
  assert.equal(res.action, "investigate");
  assert.equal(res.capability_gaps.length, 1);
  assert.equal(res.capability_gaps[0].capability, "archguard.duplicates");
  assert.equal(res.usage.evidence_requests, 0, "a gap is not a tool call");
  assert.equal(ex.calls.length, 1, "the repeated request was refused as DUPLICATE_REQUEST");
  assert.ok(res.steps.some((s) => s.reasons?.includes("DUPLICATE_REQUEST")));
  assert.equal(res.gate_ok, true);
  assert.ok(res.usage.rounds <= 4, "no wandering to a limit");
});

test("trigger: a recorded detector reading is a citable, provenance-carrying INPUT; it is not a tool call and never counted as a requested kind", async () => {
  const gap = ARCHGUARD_QUERY_KINDS.duplicates.gap;
  const ex = fakeExecutor({ "archguard:duplicates": { status: "capability_gap", text: "GAP", gap }, read_file: { status: "ok", text: "   71| export function parseFidelityVerdict" } });
  const trigger = { source: "archguard_detect_duplicates (MCP, recorded)", analysed_tree: "273ef15b1", text: "15. savable=20 parseFidelityVerdict / parseSemanticSufficiencyVerdict x2" };
  const judge = scriptedJudge([
    req({ kind: "read_file", path: "packages/quay/src/criterion-fidelity.ts", start_line: 71, end_line: 87 }),
    req({ kind: "archguard_query", query: "duplicates", args: {} }),
    { action: "investigate_more", hypothesis: "the flagged parser pair is structurally identical", sufficient: false, why: "cannot re-measure", what_is_missing: "a duplicate-group re-measurement after a convergence; the CLI surface has no duplicates query" },
  ]);
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, triggers: [trigger], deps: { executor: ex, git: () => "" } });
  assert.deepEqual(res.triggers.map((x) => x.source), [trigger.source]);
  assert.match(res.triggers[0].text_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(res.requested_kinds, ["read_file", "archguard:duplicates"], "a trigger is an input, not a request");
  assert.equal(res.terminal.kind, "investigate_more");
  assert.equal(res.terminal.forced, false);
  assert.equal(res.capability_gaps[0].capability, "archguard.duplicates");
  assert.ok(res.usage.rounds <= 4, "stopped on its own after exposing the gap — no wandering to a limit");
  assert.match(judge.prompts[0], /ev-t1/, "the trigger is shown to the judge with its citable id");
  assert.ok(res.evidence.length === 4 && res.evidence.some((e) => e.id === "ev-t1" && e.provenance.recorded === true));
});

test("loop: a gap reading cannot be cited as support for a proposal", async () => {
  const ex = fakeExecutor({ "archguard:duplicates": { status: "capability_gap", text: "GAP", gap: ARCHGUARD_QUERY_KINDS.duplicates.gap } });
  const judge = scriptedJudge([req({ kind: "archguard_query", query: "duplicates", args: {} }), propose({ concern_kind: "duplicate", slice: undefined, declared_measurement: "duplicate group count falls by one after convergence", evidence_refs: ["ev-1"] })]);
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, deps: { executor: ex, git: () => "" } });
  assert.ok(res.steps.some((s) => s.reasons?.some((r) => r.startsWith("EVIDENCE_NOT_A_READING"))));
  assert.notEqual(res.action, "propose-goal");
});

test("loop: reference/outcome and benchmark artefacts are refused at the gate and never executed", async () => {
  const ex = fakeExecutor();
  const attempts = ["plugin/fixtures/meta-driver-replay/GOAL-033/reference.json", "plugin/fixtures/meta-driver-replay/GOAL-033/outcome.json", "docs/analysis/ownership-rich-ab-results.json"];
  const judge = scriptedJudge([...attempts.map((p) => req({ kind: "read_file", path: p, start_line: 1, end_line: 20 })), { action: "abstain", hypothesis: "nothing readable", sufficient: false, why: "denied" }]);
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, deps: { executor: ex, git: () => "" } });
  assert.equal(ex.calls.length, 0);
  assert.equal(res.steps.filter((s) => s.outcome === "request-refused" && s.reasons.includes("PATH_DENIED")).length, 3);
  const prompt = judge.prompts.at(-1);
  assert.doesNotMatch(prompt, /"selected_slice"|reference_slice|merge_commit/, "no reference/outcome content in any prompt");
});

test("loop: unreadable judge output ends in an honest terminal, not a half-formed step", async () => {
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: scriptedJudge(["I think there might be a cycle", "still prose"]), deps: { executor: fakeExecutor(), git: () => "" } });
  assert.equal(res.terminal.forced_cause, "judge-output-unreadable");
  assert.equal(res.action, "not-evaluated");
  const down = await runActiveInvestigation({ root: "/r", invokeJudge: async () => ({ status: 127, stdout: "", error: null }), deps: { executor: fakeExecutor(), git: () => "" } });
  assert.equal(down.terminal.forced_cause, "judge-unavailable");
  assert.equal(down.state, "not-evaluated");
  assert.equal(down.gate_ok, null, "not evaluated is neither gate-clean nor gate-failed");
  // and it must not poison dedup: two unavailable runs in a row never produce DUPLICATE_CONCERN
  const again = await runActiveInvestigation({ root: "/r", invokeJudge: async () => ({ status: 127, stdout: "" }), deps: { executor: fakeExecutor(), git: () => "" }, existingConcernKeys: [] });
  assert.deepEqual(again.gate_reasons, ["NOT_EVALUATED:judge-unavailable"]);
});

test("loop: if the slice primitive is unavailable the proposal is DOWNGRADED to investigate (no estimated delta)", async () => {
  const ex = fakeExecutor({ "archguard:package_cycles": { status: "ok", text: "Cycle 1 (size 6): a -> b" } });
  const judge = scriptedJudge([req(REQ_CYCLES), propose()]);
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: judge, deps: { executor: ex, git: () => "", sliceDeps: { sliceDelta: { available: false, reason: "ARCHGUARD_CLI_NOT_INSTALLED" } } } });
  assert.equal(res.slice_delta.status, "unavailable");
  assert.equal(res.action, "investigate");
  assert.match(res.envelope.confidence.basis, /downgraded from propose-goal/);
  assert.match(res.envelope.expected_mechanical_delta, /^NOT COMPUTED: unavailable/);
  assert.equal(res.gate_ok, true);
});

test("proposal-time capability check: a duplicate/canonicalization proposal exposes every re-measurement gap even if the model never asked", async () => {
  for (const [kind, caps] of [["duplicate", ["archguard.duplicates"]], ["canonicalization", ["archguard.literal_dispersion", "archguard.duplicates"]]]) {
    const ex = fakeExecutor();
    const p = propose({ concern_kind: kind, slice: undefined, declared_measurement: "the flagged group disappears from a same-parameter re-run", evidence_refs: ["ev-1"] });
    const res = await runActiveInvestigation({ root: "/r", invokeJudge: scriptedJudge([req({ kind: "grep", pattern: "parse", paths: ["packages"] }), p]), deps: { executor: ex, git: () => "" } });
    assert.equal(res.action, "propose-goal");
    assert.equal(res.measurement_capability.reachable_on_production_surface, false);
    assert.deepEqual(res.measurement_capability.instruments.map((i) => i.needs).sort(), [...caps].sort());
    for (const cap of caps) assert.ok(res.capability_gaps.some((g) => g.capability === cap && g.exposed_by === "proposal-time measurement check"), cap);
    assert.match(res.envelope.expected_mechanical_delta, /RE-MEASUREMENT GAP/);
    assert.equal(ex.calls.filter((c) => c.kind === "archguard_query").length, 0, "the gap was exposed without any tool call");
  }
});

test("loop: a non-cycle proposal carries an UNVERIFIED declared measurement and cannot be high-confidence", async () => {
  const ex = fakeExecutor();
  const p = propose({ concern_kind: "canonicalization", slice: undefined, declared_measurement: "the raw literal count in goal-driver.ts falls from 6 to 1", confidence: { level: "high", basis: "five sites enumerated by grep" }, evidence_refs: ["ev-1"] });
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: scriptedJudge([req({ kind: "grep", pattern: "needs-human", paths: ["plugin/scripts"] }), p]), deps: { executor: ex, git: () => "" } });
  assert.equal(res.action, "propose-goal");
  assert.match(res.envelope.expected_mechanical_delta, /^UNVERIFIED declared measurement/);
  assert.equal(res.envelope.confidence.level, "medium");
});

test("gate: dedup and the 24h proposal quota are enforced downstream of the model", async () => {
  const ex = () => fakeExecutor({ "archguard:package_cycles": { status: "ok", text: "c" } });
  const mk = () => scriptedJudge([req(REQ_CYCLES), propose({ concern_kind: "canonicalization", slice: undefined, declared_measurement: "a before/after count reading", evidence_refs: ["ev-1"] })]);
  const first = await runActiveInvestigation({ root: "/r", invokeJudge: mk(), deps: { executor: ex(), git: () => "" } });
  assert.equal(first.gate_ok, true);
  const dup = await runActiveInvestigation({ root: "/r", invokeJudge: mk(), deps: { executor: ex(), git: () => "" }, existingConcernKeys: [first.concern_key] });
  assert.ok(dup.gate_reasons.some((r) => r.startsWith("DUPLICATE_CONCERN")));
  const now = Date.now();
  const hist = [1, 2, 3].map((i) => ({ proposer_id: PROPOSER_ID, action: "propose-goal", gate_ok: true, ts_iso: new Date(now - i * 3600_000).toISOString() }));
  assert.deepEqual(quotaGate(hist, { max_proposals: 3, window_ms: 24 * 3600_000 }, now), { ok: false, used: 3, max: 3 });
  assert.equal(quotaGate(hist, { max_proposals: 4, window_ms: 24 * 3600_000 }, now).ok, true);
  assert.equal(quotaGate([{ ...hist[0], ts_iso: new Date(now - 48 * 3600_000).toISOString() }], { max_proposals: 1, window_ms: 24 * 3600_000 }, now).ok, true, "old proposals leave the window");
  const q = await runActiveInvestigation({ root: "/r", invokeJudge: mk(), deps: { executor: ex(), git: () => "" }, history: hist });
  assert.ok(q.gate_reasons.some((r) => r.startsWith("QUOTA_EXHAUSTED")));
  assert.equal(q.gate_ok, false);
});

// ── 8. structure: no-write guard, judge has no tools, carrier is the only sink, runtime seam ──
test("no-write guard: the modules never import task/goal filing machinery and never name a forbidden action", () => {
  for (const f of MODULES) {
    const code = stripComments(fs.readFileSync(path.join(ANALYSIS, f), "utf8"));
    assert.doesNotMatch(code, /\bfileProposals\b|\bdriveItems\b|\bfileDecisions\b|task_write|quay-native|lifecycle_promote/, `${f}: reaches filing/lifecycle machinery`);
    assert.doesNotMatch(code, /["'`](create-task|activate-goal|write-status|file-task)["'`]/, `${f}: names a forbidden action as a value`);
  }
});

test("no-write guard: the only persistent write is the carrier append; temp files stay under os.tmpdir", () => {
  const writers = {};
  for (const f of MODULES) {
    const code = stripComments(fs.readFileSync(path.join(ANALYSIS, f), "utf8"));
    const hits = code.match(/\b(writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync)\b/g) || [];
    if (hits.length) writers[f] = [...new Set(hits)].sort();
  }
  assert.deepEqual(Object.keys(writers).sort(), ["ownership-active-executor.mjs", "ownership-active-loop.mjs", "ownership-active-slice-adapter.mjs"].filter((f) => writers[f]).sort());
  assert.ok(!("ownership-active-contract.mjs" in writers), "the contract is pure");
  const loop = stripComments(fs.readFileSync(path.join(ANALYSIS, "ownership-active-loop.mjs"), "utf8"));
  assert.equal((loop.match(/appendFileSync/g) || []).length, 1, "exactly one append site");
  assert.match(loop, /CARRIER_REL = "\.quay\/ownership-shadow-proposals\.jsonl"/);
  for (const f of ["ownership-active-executor.mjs", "ownership-active-slice-adapter.mjs"]) {
    const code = stripComments(fs.readFileSync(path.join(ANALYSIS, f), "utf8"));
    assert.match(code, /os\.tmpdir\(\)/, `${f} writes only into a temp dir`);
    assert.doesNotMatch(code, /writeFileSync\(\s*path\.join\(root/, `${f}: writes into the analysed tree`);
  }
});

test("judge has no tools: the live invocation disables them, slash commands and sessions", () => {
  const loop = fs.readFileSync(path.join(ANALYSIS, "ownership-active-loop.mjs"), "utf8");
  assert.match(loop, /"--tools", ""/);
  assert.match(loop, /"--disable-slash-commands"/);
  assert.match(loop, /"--no-session-persistence"/);
});

test("carrier: append-only to the fixed shadow carrier; the record round-trips and executed is false", async () => {
  const root = mkTmp();
  const res = await runActiveInvestigation({ root: "/r", invokeJudge: scriptedJudge([{ action: "abstain", hypothesis: "no ownership concern is established", sufficient: false, why: "nothing in the facts" }]), deps: { executor: fakeExecutor(), git: () => "" } });
  const file = appendCarrier(root, { ts_iso: "2026-10-10T00:00:00Z", ...res });
  assert.equal(file, path.join(root, CARRIER_REL));
  appendCarrier(root, { ts_iso: "2026-10-10T00:00:01Z", ...res });
  const hist = readCarrierHistory(file);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].executed, false);
  assert.equal(hist[0].proposer_id, PROPOSER_ID);
  assert.deepEqual(fs.readdirSync(root), [".quay"], "nothing but the carrier directory was created");
  assert.deepEqual(fs.readdirSync(path.join(root, ".quay")), ["ownership-shadow-proposals.jsonl"]);
});

test("runtime seam: the resolved launcher/model is recorded; escalation is a declared seam, off by default", () => {
  const fake = (role, prompt, root, o) => ["/usr/bin/claude-fjdac", "--settings", "s", "--model", "v4.1flash-anthropic", "-n", role, "-p"];
  const rt = resolveRuntime(fake, "meta-driver", "/r");
  assert.deepEqual({ role: rt.role, launcher: rt.launcher, model: rt.model, esc: rt.escalation.enabled }, { role: "meta-driver", launcher: "/usr/bin/claude-fjdac", model: "v4.1flash-anthropic", esc: false });
});

test("prompt: states the protocol, lists declared kinds without availability hints, and shows refusals back to the judge", () => {
  const st = newState(); st.rounds_used = 1;
  const p = buildStepPrompt({ facts: { repo_commit: "abc" }, state: st, refusals: [{ round: 1, reasons: ["PATH_DENIED"] }], mustTerminate: false });
  assert.match(p, /ONE evidence request per turn/);
  assert.match(p, /duplicates/);
  assert.doesNotMatch(p, /UNAVAILABLE|not implemented/i, "availability must be discovered, not pre-announced");
  assert.match(p, /GATE REFUSALS SO FAR[\s\S]*PATH_DENIED/);
  assert.match(buildStepPrompt({ facts: {}, state: st, refusals: [], mustTerminate: true }), /NO further evidence requests are possible/);
});

test("shared gate: a proposal that merely NAMES a file like ff-merge.ts is not a forbidden action; a real one still is", async () => {
  const { deterministicGate, emptyEnvelope } = await import("../../docs/analysis/ownership-shadow-proposer.mjs");
  const env = (over) => ({ ...emptyEnvelope("t"), concern: "ownership boundary: the fan-in dependency cycle", evidence_refs: ["ev-1"], expected_mechanical_delta: "cycle size falls by one", negative_control: "re-add the edge", abandon_or_reconsider_condition: "if another member imports it", ...over });
  const refs = new Set(["ev-1"]);
  const named = deterministicGate(env({ candidate_interventions: [{ title: "Relocate the probe API out of packages/quay/src/fan-in/ff-merge.ts", rationale: "see goal-merge.ts and write-status.ts helpers" }] }), { evidenceRefs: refs });
  assert.deepEqual(named.reasons.filter((r) => r.startsWith("FORBIDDEN_ACTION")), [], named.reasons.join());
  const real = deterministicGate(env({ candidate_interventions: [{ title: "merge the branch to develop now", rationale: "x" }] }), { evidenceRefs: refs });
  assert.ok(real.reasons.some((r) => r.startsWith("FORBIDDEN_ACTION:merge")));
  const created = deterministicGate(env({ candidate_interventions: [{ title: "create-task for the cut", rationale: "x" }] }), { evidenceRefs: refs });
  assert.ok(created.reasons.some((r) => r.startsWith("FORBIDDEN_ACTION:create-task")));
  // merging two MODULES is ordinary refactoring vocabulary (observed live) — only an instruction to merge a git/goal object is forbidden
  const modules = deterministicGate(env({ candidate_interventions: [{ title: "Merge gate/config/loader.ts into the factory layer it constructs", rationale: "then merge the two re-export shims into one file" }] }), { evidenceRefs: refs });
  assert.deepEqual(modules.reasons.filter((r) => r.startsWith("FORBIDDEN_ACTION")), [], modules.reasons.join());
  for (const bad of ["git merge goal/GOAL-040 now", "run quay goal merge", "merge this branch into develop"]) {
    const g = deterministicGate(env({ candidate_interventions: [{ title: bad, rationale: "x" }] }), { evidenceRefs: refs });
    assert.ok(g.reasons.some((r) => r.startsWith("FORBIDDEN_ACTION:merge")), bad);
  }
  const asAction = deterministicGate(env({ recommended_next_action: "merge" }), { evidenceRefs: refs });
  assert.ok(asAction.reasons.some((r) => r.startsWith("FORBIDDEN_ACTION")));
});

test("parseStep is fail-closed", () => {
  assert.equal(parseStep(""), null);
  assert.equal(parseStep("no json here"), null);
  assert.deepEqual(parseStep('```json\n{"action":"abstain"}\n```'), { action: "abstain" });
});

// ── published product surface only (ArchGuard >= 0.1.39) ────────────────────────────────────────
test("surface: no module may depend on the ArchGuard SOURCE repo or its experiment script (retired path)", () => {
  const banned = [["docs", "experiments"].join("/"), ["", "work", "archguard"].join("/"), ["ARCHGUARD", "SLICE", "DELTA"].join("_"), ["slice-delta", "mjs"].join("."), "runScript"];
  for (const f of MODULES) {
    const code = fs.readFileSync(path.join(ANALYSIS, f), "utf8");
    for (const b of banned) {
      // the adapter's own header documents the retirement in prose; code (comments stripped) must be clean
      assert.ok(!stripComments(code).includes(b), `${f}: still references the retired private surface "${b}"`);
    }
  }
  // fixtures are Quay-owned copies, not read from the ArchGuard repo
  assert.ok(fs.existsSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json")));
});

test("surface: versionAtLeast is numeric, and an unreadable version is NOT acceptable", () => {
  assert.equal(versionAtLeast("0.1.39"), true);
  assert.equal(versionAtLeast("0.1.40"), true);
  assert.equal(versionAtLeast("0.2.0"), true);
  assert.equal(versionAtLeast("0.1.38"), false);
  assert.equal(versionAtLeast("0.1.9"), false, "numeric, not lexical");
  assert.equal(versionAtLeast(null), false);
  assert.equal(versionAtLeast("garbage"), false);
});

test("surface: resolution probes the INSTALLED cli — missing, too old, and missing-subcommand are distinct gaps", () => {
  assert.equal(resolveSliceDelta({ cli: null }).reason, "ARCHGUARD_CLI_NOT_INSTALLED");
  assert.match(resolveSliceDelta({ cli: "/x", version: () => "0.1.38" }).reason, /^ARCHGUARD_VERSION_TOO_OLD:0\.1\.38</);
  assert.match(resolveSliceDelta({ cli: "/x", version: () => null }).reason, /^ARCHGUARD_VERSION_TOO_OLD:unreadable/);
  assert.equal(resolveSliceDelta({ cli: "/x", version: () => "0.1.39", probeSubcommand: () => ({ status: 1 }) }).reason, "SLICE_DELTA_SUBCOMMAND_MISSING");
  const ok = resolveSliceDelta({ cli: "/x", version: () => "0.1.39", probeSubcommand: () => ({ status: 0 }) });
  assert.deepEqual({ a: ok.available, v: ok.version }, { a: true, v: "0.1.39" });
});

test("surface: THIS host has the released surface installed (>= 0.1.39) and it reports its own version", (t) => {
  if (!INSTALLED.available) return t.skip(`released ArchGuard slice-delta not available here: ${INSTALLED.reason}`);
  assert.ok(versionAtLeast(INSTALLED.version));
  const v = execFileSync("node", [INSTALLED.cli, "--version"], { encoding: "utf8" }).trim();
  assert.equal(INSTALLED.version, v, "the version used is the one the CLI reports about itself, not a package.json read");
});

test("cross-repo: the INSTALLED CLI on the GOAL-033 fixture gives SCC 6 -> 4, cli and fan-in leave, negative control falsifiable", (t) => {
  if (!REAL_PRIMITIVE) return t.skip("released slice-delta not available on this host");
  const out = path.join(mkTmp(), "report.json");
  const r = spawnSync("node", [INSTALLED.cli, "slice-delta", "--arch", path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"), "--slice", path.join(ARCHGUARD_FIXTURES, "goal-033-slice.json"), "--root", REPO, "--json", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const rep = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(rep.status, "evaluated");
  assert.equal(rep.computedDelta.sccBefore.length, 6);
  assert.deepEqual(rep.computedDelta.sccAfter, ["", "gate", "gate/config", "gate/factories"]);
  assert.deepEqual([...rep.computedDelta.sccLeft].sort(), ["cli", "fan-in"]);
  assert.equal(rep.negativeControl.falsified, true);
  assert.equal(rep.negativeControl.subjectBackInScc, true);
  assert.equal(rep.guards.clean, true);
  assert.equal(rep.provenance.tool.archguardVersion, INSTALLED.version);
  assert.equal(rep.provenance.tool.command, "archguard slice-delta");
  // the human-written prediction (6 -> 5) is kept as a SEPARATE reading and reported as diverging
  assert.equal(rep.declaredPrediction.sccSize, 5);
  assert.equal(rep.predictionComparison.declaredVsComputed.relation, "diverges");
});

test("cross-repo through the ADAPTER: same fixture, structured cut from the slice file, provenance + hashes recorded", (t) => {
  if (!REAL_PRIMITIVE) return t.skip("released slice-delta not available on this host");
  const fixture = JSON.parse(fs.readFileSync(path.join(ARCHGUARD_FIXTURES, "goal-033-fork-point.arch.json"), "utf8"));
  const sl = JSON.parse(fs.readFileSync(path.join(ARCHGUARD_FIXTURES, "goal-033-slice.json"), "utf8"));
  const p = proposal({ slice: { scope_root: "packages/quay/src", subject: sl.subject, moves: sl.proposedCut.moves, consumers: sl.proposedCut.consumers, forbidden_new_edges: sl.mustNotChange.forbiddenNewEdges } });
  const r = computeSliceDelta({ root: REPO, commit: HEAD, proposal: p, deps: { git: (a) => (a[0] === "rev-parse" ? "t\n" : ""), analyzePackageGraph: () => ({ file: "", json: fixture }) } });
  assert.equal(r.status, "evaluated");
  assert.equal(r.delta.before.scc_size, 6);
  assert.equal(r.delta.after.scc_size, 4);
  assert.deepEqual([...r.delta.left].sort(), ["cli", "fan-in"]);
  assert.equal(r.negative_control.falsified, true);
  assert.equal(r.guards.clean, true);
  const pv = r.provenance;
  assert.equal(pv.archguard_version, INSTALLED.version);
  assert.equal(pv.tool_reported.archguardVersion, INSTALLED.version);
  assert.equal(pv.surface.surface, "archguard-cli");
  assert.match(pv.command, /^archguard slice-delta --arch /);
  for (const k of ["arch_sha256", "slice_sha256", "report_sha256", "graph_sha256"]) assert.match(pv[k], /^[0-9a-f]{64}$/, k);
  assert.equal(pv.exit_code, 0);
  assert.equal(pv.provenance_consistency.status, "match", JSON.stringify(pv.provenance_consistency));
});

test("gate: a graph that is not shown to come from the cited commit downgrades the proposal (PROVENANCE_MISMATCH)", async (t) => {
  if (!REAL_PRIMITIVE) return t.skip("released slice-delta not available on this host");
  const ex = fakeExecutor({ "archguard:package_cycles": { status: "ok", text: "c" } }, "1".repeat(40));   // a commit that is NOT the tree's HEAD
  const real = { moves: [{ file: "cli/driver.ts", from: "cli", to: "", symbols: ["runDriver", "runDriverAsync", "resolveDriverInvocation", "DriverRunResult"] }, { file: "cli/driver-vocab.ts", from: "cli", to: "", symbols: ["ALL_SERVICE_NAMES", "HOSTED_SERVICE_NAMES", "KINDS", "VERBS"] }] };
  const deps = { executor: ex, git: () => "", sliceDeps: REAL_GRAPH_DEPS() };
  const res = await runActiveInvestigation({ root: REPO, invokeJudge: scriptedJudge([req(REQ_CYCLES), propose({ slice: { scope_root: "packages/quay/src", subject: "", ...real } })]), deps });
  assert.equal(res.slice_delta.status, "evaluated");
  assert.equal(res.slice_delta.provenance.provenance_consistency.status, "mismatch");
  assert.equal(res.action, "investigate");
  assert.match(res.envelope.confidence.basis, /PROVENANCE_MISMATCH/);
});
