// @test-group engine
// Unit tests for select-preflight.ts — DIR-072/M153.
//
// SPLIT BY gap-split-three-phase-floor-files (2026-08-12): the pre-split file was the engine/main
// phase's floor (~72s, dominated by the CLI subprocess tests that run the REAL preflight against
// the repo root). The pure unit tests stay HERE; the CLI subprocess tests moved to
// select-preflight-cli.test.mjs so the two files run in parallel and the floor drops below the
// next tier. Test BODIES are byte-identical to the pre-split file; only their file placement
// changed.
//
// Run: node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
//      node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/select-preflight.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import {
  checkHalt,
  getPendingDirectives,
  getCandidates,
  checkCandidateTouches,
  selftest,
  hasHumanSteeredLabel,
  computeHumanSteered,
  isEpicBlockedByHumanSteeredChildren,
  classifyCandidate,
  scanOrthogonalPairs,
  GETTASKLIST_TIMEOUT_MS_FLOOR,
} from "../scripts/select-preflight.ts";
import { walkFiles, expandGlobs } from "../scripts/touches-orthogonality-check.ts";
import { buildCouplingGraph } from "../scripts/coupling-graph.ts";

// ── checkHalt ─────────────────────────────────────────────────────────────────────────────────────
test("checkHalt: no .halt file → {halt: false}", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-");
  try {
    const r = checkHalt(tmpDir);
    assert.equal(r.halt, false);
    assert.equal(r.reason, "");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkHalt: .halt exists with content → {halt: true, reason}", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-");
  try {
    fs.writeFileSync(path.join(tmpDir, ".halt"), "manual stop", "utf8");
    const r = checkHalt(tmpDir);
    assert.equal(r.halt, true);
    assert.equal(r.reason, "manual stop");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkHalt: empty .halt → {halt: true} with sentinel message", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-");
  try {
    fs.writeFileSync(path.join(tmpDir, ".halt"), "", "utf8");
    const r = checkHalt(tmpDir);
    assert.equal(r.halt, true);
    assert.ok(r.reason.includes(".halt"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Regression guard (gap-halt-sentinel-path-mismatch, M187): a .halt placed ONLY at the
// experiments/quay-perpetual-stream/ path (the wrong, formerly-documented location) must NOT
// satisfy the check — checkHalt() is workspaceRoot-relative, not experiments-scoped. This is the
// exact confusion that led restart-readiness-check.sh and CLAUDE.md to disagree with the real,
// live convention; this test pins the correct (repo-root) behavior so it cannot silently regress.
test("checkHalt: .halt at experiments/quay-perpetual-stream/ path only → {halt: false} (wrong-path regression guard)", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-");
  try {
    const wrongDir = path.join(tmpDir, "experiments", "quay-perpetual-stream");
    fs.mkdirSync(wrongDir, { recursive: true });
    fs.writeFileSync(path.join(wrongDir, ".halt"), "manual stop", "utf8");
    // No .halt at the workspace root (tmpDir) itself.
    const r = checkHalt(tmpDir);
    assert.equal(r.halt, false, `expected halt:false with .halt only at the experiments-scoped path, got reason=${r.reason}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── getPendingDirectives ──────────────────────────────────────────────────────────────────────────
test("getPendingDirectives: filters to label:directive + extra.dirStatus:pending", () => {
  const tasks = [
    { id: "DIR-001", labels: ["directive"], extra: { dirStatus: "pending" } },
    { id: "DIR-002", labels: ["directive"], extra: { dirStatus: "applied" } },
    { id: "DIR-003", labels: ["directive"], extra: {} },
    { id: "NOT-DIR", labels: ["milestone-candidate"], extra: { dirStatus: "pending" } },
    { id: "DIR-005", labels: ["directive", "milestone-candidate"], extra: { dirStatus: "pending" } },
  ];
  const r = getPendingDirectives(tasks);
  assert.deepEqual(r, ["DIR-001", "DIR-005"]);
});

test("getPendingDirectives: empty array → []", () => {
  assert.deepEqual(getPendingDirectives([]), []);
});

test("getPendingDirectives: null → []", () => {
  assert.deepEqual(getPendingDirectives(null), []);
});

test("getPendingDirectives: no pending directives → []", () => {
  const tasks = [
    { id: "DIR-001", labels: ["directive"], extra: { dirStatus: "applied" } },
  ];
  assert.deepEqual(getPendingDirectives(tasks), []);
});

test("getPendingDirectives: directive without extra → skipped", () => {
  const tasks = [
    { id: "DIR-001", labels: ["directive"] },
  ];
  assert.deepEqual(getPendingDirectives(tasks), []);
});

// ── getTaskList (gap-select-preflight-getTaskList-timeout-too-short) ────────────────────────────────
// Regression guard: Build measured real `quay task list --json` wall time at 66-78s against the
// current (475+ task) store (DIR-119-D1/M198 Build phase) — a hardcoded 60000ms execFileSync
// timeout starves that call intermittently. GETTASKLIST_TIMEOUT_MS_FLOOR must stay at/above a
// documented floor that gives real headroom over the measured 66-78s baseline, not just enough to
// pass once.
test("getTaskList: GETTASKLIST_TIMEOUT_MS_FLOOR is at or above the documented 78s measured-wall-time floor with real headroom", () => {
  const MEASURED_WORST_CASE_MS = 78000;
  assert.ok(
    GETTASKLIST_TIMEOUT_MS_FLOOR > MEASURED_WORST_CASE_MS,
    `GETTASKLIST_TIMEOUT_MS_FLOOR (${GETTASKLIST_TIMEOUT_MS_FLOOR}) must exceed the measured ` +
      `worst-case wall time (${MEASURED_WORST_CASE_MS}ms) — regressing it back toward/below the ` +
      `measured range reintroduces the intermittent FAIL-CLOSED halt this test guards against.`,
  );
  // Not just "greater than" — require real headroom, not a razor-thin margin.
  assert.ok(
    GETTASKLIST_TIMEOUT_MS_FLOOR >= 100000,
    `GETTASKLIST_TIMEOUT_MS_FLOOR (${GETTASKLIST_TIMEOUT_MS_FLOOR}) must be at least 100000ms — ` +
      `a value only marginally above 78000ms would not give "real headroom" as required by the ` +
      `task's Acceptance Criteria.`,
  );
});

// ── getCandidates ─────────────────────────────────────────────────────────────────────────────────
test("getCandidates: filters todo milestone-candidates, does NOT pre-filter human-steered (classifier handles it later, DIR-062-C)", () => {
  const tasks = [
    { id: "DIR-089", title: "Test 1", status: "todo", labels: ["milestone-candidate"], extra: { rank: 5 } },
    { id: "DIR-090", title: "HS", status: "todo", labels: ["milestone-candidate", "human-steered"], extra: {} },
    { id: "DIR-091", title: "Done", status: "done", labels: ["milestone-candidate"], extra: {} },
    { id: "DIR-092", title: "No rank", status: "todo", labels: ["milestone-candidate"], extra: {} },
    { id: "NOT-CAND", title: "Not", status: "todo", labels: ["directive"], extra: {} },
  ];
  const r = getCandidates(tasks);
  // DIR-062-C: getCandidates no longer pre-filters by label:human-steered — classifier handles it
  assert.equal(r.length, 3);
  assert.equal(r[0].id, "DIR-089");
  assert.equal(r[0].rank, 5);
  assert.equal(r[1].id, "DIR-090"); // human-steered still returned by getCandidates
  assert.equal(r[2].id, "DIR-092");
  assert.equal(r[2].rank, 999); // default rank
  assert.equal(r[0].schemaPass, false); // not yet filled
  assert.equal(r[0].hasTouches, false);
});

test("getCandidates: empty array → []", () => {
  assert.deepEqual(getCandidates([]), []);
});

test("getCandidates: null → []", () => {
  assert.deepEqual(getCandidates(null), []);
});

test("getCandidates: human-steered label still returned (classifier gate is post-filter, DIR-062-C)", () => {
  const tasks = [
    { id: "DIR-HS", title: "HS", status: "todo", labels: ["milestone-candidate", "Human-Steered"], extra: {} },
  ];
  // DIR-062-C: getCandidates no longer filters on label:human-steered — the classifier handles it
  const r = getCandidates(tasks);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "DIR-HS");
});

// ── checkCandidateTouches ─────────────────────────────────────────────────────────────────────────
test("checkCandidateTouches: ## Touches present → true", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-");
  try {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "T1.md"), "## Proposal\n\n## Touches\n\n- file.ts\n", "utf8");
    assert.equal(checkCandidateTouches(tmpDir, "T1"), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkCandidateTouches: no ## Touches → false", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-");
  try {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "T1.md"), "## Proposal\n\n## Acceptance Criteria\n", "utf8");
    assert.equal(checkCandidateTouches(tmpDir, "T1"), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkCandidateTouches: missing file → false", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-");
  try {
    assert.equal(checkCandidateTouches(tmpDir, "NONEXISTENT"), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── selftest() ────────────────────────────────────────────────────────────────────────────────────
test("selftest(): all embedded fixture cases pass", () => {
  assert.equal(selftest(), true);
});

// ── hasHumanSteeredLabel (M181 fix, case 1) ──────────────────────────────────────────────────────
test("hasHumanSteeredLabel: case-insensitive match", () => {
  assert.equal(hasHumanSteeredLabel(["Human-Steered"]), true);
  assert.equal(hasHumanSteeredLabel(["human-steered"]), true);
});

test("hasHumanSteeredLabel: no match → false", () => {
  assert.equal(hasHumanSteeredLabel(["defect"]), false);
});

test("hasHumanSteeredLabel: null/undefined/non-array → false", () => {
  assert.equal(hasHumanSteeredLabel(null), false);
  assert.equal(hasHumanSteeredLabel(undefined), false);
  assert.equal(hasHumanSteeredLabel("not-an-array"), false);
});

// ── computeHumanSteered / isEpicBlockedByHumanSteeredChildren — M181 RED/GREEN fixture pairs ──────
// M181: a direct label:human-steered on a task must be an ADDITIONAL, never-overridden exclusion
// signal — DIR-062-C's classifier alone never reads the label (by design), so select-preflight.ts
// must OR it in itself. These fixtures reproduce the pre-fix leak (RED) and the fixed behavior
// (GREEN) side by side.
test("M181 case 1 (direct label) RED: classifier alone ignores label:human-steered → false", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-m181-");
  try {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(tasksDir, "LABELED-HS.md"),
      "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/gate/engine.ts`\n",
      "utf8",
    );
    const registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };
    // The raw classifier (pre-fix consumption path) never sees the label — reproduces the leak.
    const r = classifyCandidate(tmpDir, "LABELED-HS", {}, registry);
    assert.equal(r.humanSteered, false, "classifier-only verdict must reproduce the pre-fix leak (false)");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("M181 case 1 (direct label) GREEN: computeHumanSteered ORs in the label → true", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-m181-");
  try {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(tasksDir, "LABELED-HS.md"),
      "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/gate/engine.ts`\n",
      "utf8",
    );
    const registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };
    const r = computeHumanSteered(tmpDir, "LABELED-HS", ["human-steered"], {}, registry);
    assert.equal(r.humanSteered, true, "direct label must be OR'd in regardless of classifier verdict");
    assert.match(r.detail, /label:human-steered \(direct\)/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("M181 case 2 (epic-with-human-steered-only-child) RED: epic's own classification misses a blocked child", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-m181-");
  try {
    const registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };
    // The epic itself carries no label and touches nothing — its own classification is clean,
    // reproducing the pre-fix leak where only the epic's own labels/classifier were consulted.
    const r = computeHumanSteered(tmpDir, "EPIC", [], {}, registry);
    assert.equal(r.humanSteered, false, "epic's own verdict alone must not see the blocked child");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("M181 case 2 (epic-with-human-steered-only-child) GREEN: isEpicBlockedByHumanSteeredChildren excludes it", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-m181-");
  try {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "CHILD-DONE.md"), "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/a.ts`\n", "utf8");
    fs.writeFileSync(path.join(tasksDir, "CHILD-HS.md"), "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/b.ts`\n", "utf8");
    const registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };
    const tasksById = new Map([
      ["CHILD-DONE", { id: "CHILD-DONE", status: "done", labels: [], extra: {} }],
      ["CHILD-HS", { id: "CHILD-HS", status: "todo", labels: ["human-steered"], extra: {} }],
    ]);
    const blocked = isEpicBlockedByHumanSteeredChildren(tmpDir, ["CHILD-DONE", "CHILD-HS"], tasksById, registry);
    assert.equal(blocked, true, "epic must be excluded: its sole open child is human-steered");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("M181 regression: a genuinely autonomous-eligible epic (no label, classifier clean) is not blocked", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-m181-");
  try {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "CHILD-DONE.md"), "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/a.ts`\n", "utf8");
    fs.writeFileSync(path.join(tasksDir, "CHILD-CLEAN.md"), "## Proposal\ntest\n\n## Touches\n\n- `packages/quay/src/b.ts`\n", "utf8");
    const registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };
    const tasksById = new Map([
      ["CHILD-DONE", { id: "CHILD-DONE", status: "done", labels: [], extra: {} }],
      ["CHILD-CLEAN", { id: "CHILD-CLEAN", status: "todo", labels: [], extra: {} }],
    ]);
    const blocked = isEpicBlockedByHumanSteeredChildren(tmpDir, ["CHILD-DONE", "CHILD-CLEAN"], tasksById, registry);
    assert.equal(blocked, false, "no label, no driver-file touch on the open child → not blocked");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("M181 vacuous case: epic with zero currently-open children (all done) is not blocked", () => {
  const tmpDir = fs.mkdtempSync("select-preflight-test-m181-");
  try {
    const registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };
    const tasksById = new Map([["CHILD-DONE", { id: "CHILD-DONE", status: "done", labels: [], extra: {} }]]);
    const blocked = isEpicBlockedByHumanSteeredChildren(tmpDir, ["CHILD-DONE"], tasksById, registry);
    assert.equal(blocked, false, "nothing open to block on");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── walk-once expansion (gap-select-preflight-json-real-store-too-slow) ───────────────────────────
// The perf fix makes scanOrthogonalPairs walk the workspace tree AT MOST ONCE per invocation and
// share one precomputed file list across the orthogonality scan AND the portfolio's coupling-graph
// expansion (previously ~29 full-tree walks per preflight run against the real store). These tests
// lock the CORRECTNESS of the walk-once path: every optional `files`/`preflightFiles` shortcut must
// produce byte-identical results to the plain per-call walk path. (The wall-clock win is profiled
// separately against the real store — see the task body; these are behavior locks, not timing locks.)

test("scanOrthogonalPairs: walk-once (preflightFiles) path is behavior-identical to per-call walk", () => {
  const tmp = fs.mkdtempSync("select-preflight-walkonce-");
  try {
    const tasksDir = path.join(tmp, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tmp, "packages", "quay", "src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "packages", "quay-native", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "packages", "quay", "src", "a.ts"), "x");
    fs.writeFileSync(path.join(tmp, "packages", "quay-native", "src", "b.ts"), "x");
    fs.writeFileSync(path.join(tasksDir, "ORTHO-A.md"), "## Touches\n\n- `packages/quay/src/a.ts`\n");
    fs.writeFileSync(path.join(tasksDir, "ORTHO-B.md"), "## Touches\n\n- `packages/quay-native/src/b.ts`\n");
    const candidates = [
      { id: "ORTHO-A", title: "A", rank: 1, labels: [], extra: {}, schemaPass: true, schemaDetail: "", hasTouches: true, humanSteered: false, classifyDetail: "" },
      { id: "ORTHO-B", title: "B", rank: 2, labels: [], extra: {}, schemaPass: true, schemaDetail: "", hasTouches: true, humanSteered: false, classifyDetail: "" },
    ];
    const files = walkFiles(tmp);
    const withFiles = scanOrthogonalPairs(tmp, candidates, undefined, files);
    const without = scanOrthogonalPairs(tmp, candidates);
    assert.deepEqual(withFiles.pairs, without.pairs, "pairs must be identical");
    assert.equal(withFiles.checkedCount, without.checkedCount, "checkedCount must be identical");
    assert.deepEqual(withFiles.log, without.log, "log must be identical");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("expandGlobs: a precomputed walkFiles list yields the same expansion as a fresh walk", () => {
  const tmp = fs.mkdtempSync("select-preflight-expandglobs-");
  try {
    fs.mkdirSync(path.join(tmp, "src", "deep"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "a.ts"), "x");
    fs.writeFileSync(path.join(tmp, "src", "deep", "b.ts"), "x");
    fs.writeFileSync(path.join(tmp, "src", "c.js"), "x");
    const files = walkFiles(tmp);
    const fresh = expandGlobs(["src/**/*.ts"], tmp);
    const shared = expandGlobs(["src/**/*.ts"], tmp, files);
    assert.deepEqual([...shared].sort(), [...fresh].sort(), "expanded sets must be identical");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("coupling-graph: shared precomputed files yield identical shared-implementation edges", () => {
  const tmp = fs.mkdtempSync("select-preflight-coupling-files-");
  try {
    fs.mkdirSync(path.join(tmp, "shared"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "other"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "shared", "file.ts"), "x");
    fs.writeFileSync(path.join(tmp, "other", "file.ts"), "x");
    const mk = (id, touches) => ({
      version: 1, id, status: "todo", labels: [], valueType: "capabilityGrowth",
      eligible: true, estimatedValue: 5, deliverySurface: [], touches, semanticResources: [],
      dependsOn: [], verificationBoundary: "scripts/test.sh", acCount: 1, lineEstimate: 50, sourceHash: "h",
    });
    const tasks = [mk("A", ["shared/file.ts"]), mk("B", ["shared/file.ts"]), mk("C", ["other/file.ts"])];
    const files = walkFiles(tmp);
    const withFiles = buildCouplingGraph({ tasks, workspaceRoot: tmp, files });
    const without = buildCouplingGraph({ tasks, workspaceRoot: tmp });
    assert.deepEqual(withFiles.edges, without.edges, "coupling edges must be identical");
    assert.deepEqual([...withFiles.byTask.keys()].sort(), [...without.byTask.keys()].sort(), "adjacency keys identical");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The two tests below are the REAL regression locks for the walk-once fix: they FAIL on the pre-fix
// code (which re-walked the tree ~2×C(topN,2) times in scanOrthogonalPairs and once per task in
// buildCouplingGraph) and PASS on the fixed code. They assert on the NUMBER of fs.readdirSync calls
// (walkFiles is the only reader of the tree), not on wall-clock, so they are deterministic. The
// `fs` import here is the same Node module singleton the walked modules use, so patching its
// `readdirSync` intercepts the walks.
test("scanOrthogonalPairs: walk-count regression — at most ONE tree walk per invocation", () => {
  const tmp = fs.mkdtempSync("select-preflight-walkcount-scan-");
  try {
    const N_DIRS = 8;
    for (let i = 0; i < N_DIRS; i++) {
      fs.mkdirSync(path.join(tmp, `d${i}`), { recursive: true });
      fs.writeFileSync(path.join(tmp, `d${i}`, "f.ts"), "x");
    }
    const tasksDir = path.join(tmp, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    // 5 top-N candidates, each declared + precise + pairwise-disjoint → all 10 pairs expand BOTH
    // sides, so pre-fix code issues ~20 expandGlobs calls, each a full walkFiles.
    const candidates = [];
    for (let i = 0; i < 5; i++) {
      const id = `C${i}`;
      fs.writeFileSync(path.join(tasksDir, `${id}.md`), `## Touches\n\n- \`d${i}/f.ts\`\n`);
      candidates.push({ id, title: id, rank: i, labels: [], extra: {}, schemaPass: true, schemaDetail: "", hasTouches: true, humanSteered: false, classifyDetail: "" });
    }
    const realReaddirSync = fs.readdirSync;
    let readdirCalls = 0;
    fs.readdirSync = (...a) => { readdirCalls++; return realReaddirSync(...a); };
    try {
      const result = scanOrthogonalPairs(tmp, candidates);
      assert.equal(result.pairs.length, 10, "fixture must produce all 10 disjoint pairs");
    } finally {
      fs.readdirSync = realReaddirSync;
    }
    // ONE walkFiles over the fixture reads: root + N_DIRS + tasks dir = N_DIRS + 2 directories.
    const oneWalk = N_DIRS + 2;
    assert.ok(
      readdirCalls <= oneWalk,
      `walk-once violated: ${readdirCalls} readdirSync calls (one walk = ${oneWalk}; pre-fix code did ~20 walks)`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("coupling-graph: walk-count regression — shared files list does ZERO additional tree walks", () => {
  const tmp = fs.mkdtempSync("select-preflight-walkcount-coupling-");
  try {
    const N = 9;
    for (let i = 0; i < N; i++) {
      fs.mkdirSync(path.join(tmp, `d${i}`), { recursive: true });
      fs.writeFileSync(path.join(tmp, `d${i}`, "f.ts"), "x");
    }
    const mk = (id, touches) => ({
      version: 1, id, status: "todo", labels: [], valueType: "capabilityGrowth",
      eligible: true, estimatedValue: 5, deliverySurface: [], touches, semanticResources: [],
      dependsOn: [], verificationBoundary: "scripts/test.sh", acCount: 1, lineEstimate: 50, sourceHash: "h",
    });
    const tasks = Array.from({ length: N }, (_, i) => mk(`T${i}`, [`d${i}/f.ts`]));
    const files = walkFiles(tmp); // the ONE shared walk, taken before the assertion
    const realReaddirSync = fs.readdirSync;
    let readdirCalls = 0;
    fs.readdirSync = (...a) => { readdirCalls++; return realReaddirSync(...a); };
    try {
      buildCouplingGraph({ tasks, workspaceRoot: tmp, files });
    } finally {
      fs.readdirSync = realReaddirSync;
    }
    assert.equal(
      readdirCalls,
      0,
      `shared-files coupling-graph must not re-walk the tree: ${readdirCalls} readdirSync calls (pre-fix code did ${N} walks)`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
