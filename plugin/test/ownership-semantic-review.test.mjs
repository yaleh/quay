// @test-group engine
// Tests for the ownership SEMANTIC REVIEW (task gap-ownership-semantic-review-of-proposed-slice) — an
// INDEPENDENT domain-ownership review layer over a proposed slice, ADVISORY only (no admission change).
//
// The evidence/facts layers are exercised against REAL commits in this repository (all four are ancestors
// of develop, so the readings are reproducible wherever the suite runs) and against an injectable `git`
// seam where the point is a synthetic position (a comment block that mentions a filename, a denial).
// The judge is always a scripted seam: the suite never reaches a model.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REVIEW_VERSION, RECOMMENDATIONS, NOT_EVALUATED, BOUNDARY_AGREEMENT, STRUCTURAL_KEY_TOKENS,
  IO_MODULES, assembleOwnershipEvidence, ownershipFacts, reviewOwnership, buildReviewPrompt,
  parseReview, synthesizeOverallRecommendation, findStructuralKeyLeaks, assertBundleClean, auditHoldoutLeakage,
  compareBoundaries, declarationBlock, exportedNames, statementNames, admitPath, clipToBytes,
} from "../../docs/analysis/ownership-semantic-review.mjs";
import { loadCases, scoreCase, summarize, runEval, LABEL_SOURCES } from "../../docs/analysis/ownership-semantic-review-eval.mjs";
import { validateRequest, DENY_PATH_PATTERNS } from "../../docs/analysis/ownership-active-contract.mjs";
import {
  evaluateCarrier, evaluateEntryBar, readCarrier, reviewCandidate, renderReviewSection,
  buildDraftGoal, runProposalCli,
} from "../../docs/analysis/ownership-active-limited-proposal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MODULE_REL = "docs/analysis/ownership-semantic-review.mjs";

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-review-test-")); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// the four pinned trees, all ancestors of develop
const C_GOAL034 = "162f8c380ed1dd9267167cc791ef8727fd13269d";     // GOAL-034 fork point (src tree 00467d64)
const C_GOAL033 = "1ac06fd85094a58d4954640811a787873f8ad2a1";     // GOAL-033 fork point
const C_ADD3E7 = "add3e73184ffaba9049141702347bf2191eb39a3";      // the stores->kernel isolated run
const C_EC00FC = "ec00fcc00da73c8f8e7f64a6d69bd734285a02b2";       // production carrier line 91 (record 91)

// the two cuts the task names as positive/negative controls
const P1_MOVES = [
  { file: "gate/config/utils.ts", from: "gate/config", to: "kernel", symbols: ["shQuote", "DEFAULT_ACCEPTANCE_TIMEOUT_MS", "resolveAcceptanceTimeoutMs", "resolveRunnerOptions"] },
  { file: "gate/config/types.ts", from: "gate/config", to: "kernel", symbols: ["GateConfig", "RunnerOptions"] },
];
const N1_MOVES = [
  { file: "gate/config/loader.ts", from: "gate/config", to: "kernel", symbols: ["discoverWorkspaceRoot", "resolveWorkspaceRootOrThrow", "readGatesConfig", "loadWorkspaceGateMetadata", "loadWorkspaceGates"] },
];

const assemble = (commit, moves, extra = {}) =>
  assembleOwnershipEvidence({ root: REPO, commit, scopeRoot: "packages/quay/src", slice: { subject: "t", moves }, ...extra });

/** A scripted judge: cites `refs` for every move with `recommendation`, returns the raw stdout string. */
const scriptedJudge = (refs, recommendation = "review", confidence = "medium") => async () => ({
  status: 0,
  stdout: JSON.stringify({
    moves: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      move_index: i, responsibility_hypothesis: "a grounded hypothesis about the target ownership",
      evidence_refs: refs, counter_evidence_refs: [], confidence, recommendation,
    })),
    overall: { responsibility_hypothesis: "x", evidence_refs: refs, counter_evidence_refs: [], confidence },
  }),
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC1 — evidence assembly: commit-locked, scope-limited, deny-list, redaction, block-position charters,
//       id/kind/locator/sha256 per reading, an enforced byte cap with RECORDED truncation, and a bundle
//       that cannot carry a structural (scc/cycle/delta) field under any name.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** A canned `git` seam: `{ "path": "text" }` served at one commit, with `ls-tree`/`show`/`grep` shapes. */
function fakeGit(files, commit = "f".repeat(40)) {
  return (args) => {
    if (args[0] === "ls-tree") return Object.keys(files).filter((p) => p.startsWith("packages/quay/src/")).join("\n") + "\n";
    if (args[0] === "show") {
      const p = args[1].slice(commit.length + 1);
      if (!(p in files)) { const e = new Error("not found"); e.status = 128; throw e; }
      return files[p];
    }
    if (args[0] === "grep") return "";                    // no caller rows
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

test("AC1: a TARGET-directory header comment that merely MENTIONS a filename produces no dependency evidence", () => {
  const files = {
    "packages/quay/src/kernel/alpha.ts": [
      "// Charter: the kernel holds pure primitives.",
      "// NOTE: this file is the home of things like beta.ts and gamma.ts once they move here.",
      'import { x } from "./beta.ts";',
      "export function alpha() { return x; }",
    ].join("\n"),
    "packages/quay/src/kernel/beta.ts": "export const x = 1;\n",
  };
  const bundle = assembleOwnershipEvidence({
    root: REPO, commit: "f".repeat(40), scopeRoot: "packages/quay/src",
    slice: { subject: "t", moves: [{ file: "kernel/beta.ts", from: "gate", to: "kernel", symbols: ["x"] }] },
    deps: { git: fakeGit(files) },
  });
  const charter = bundle.evidence.filter((e) => e.kind === "target_charter");
  assert.equal(charter.length, 1);
  assert.match(charter[0].text, /beta\.ts and gamma\.ts/, "the comment text IS carried as charter evidence");
  assert.equal(charter[0].dependency_evidence, false, "and it is explicitly NOT dependency evidence");

  // The block-position rule: charter extraction is by comment-block START/END, and only the HEADER. The
  // `import` line is code, so it is a dependency reading — but it lives in dir_imports, never in charter.
  const dirImports = bundle.evidence.filter((e) => e.kind === "dir_imports" && e.dir_id === "kernel");
  assert.equal(dirImports.length, 1);

  // and nothing in the FACTS turns the mention into an edge: beta.ts is the moving file, not a dependency
  const facts = ownershipFacts(bundle, null);
  assert.deepEqual(facts.moves[0].transferred_dependencies, []);
  assert.ok(!facts.moves[0].transferred_dependencies.some((t) => String(t.resolved_path).includes("gamma")), "a mention is not an edge");
});

test("AC1: every reading carries id / kind / locator / sha256, and the sha256 is of the text actually carried", () => {
  const bundle = assemble(C_GOAL034, P1_MOVES);
  assert.ok(bundle.evidence.length > 10);
  for (const e of bundle.evidence) {
    assert.match(e.id, /^ev-\d+$/, "id");
    assert.ok(typeof e.kind === "string" && e.kind.length > 0, "kind");
    assert.ok(typeof e.locator === "string" && e.locator.length > 0, `locator for ${e.id}`);
    assert.match(e.sha256, /^[0-9a-f]{64}$/, `sha256 for ${e.id}`);
    assert.equal(e.sha256, sha256(e.text) ?? e.sha256, "the hash names the carried text");
  }
  // the readings are COMMIT-LOCKED: a later tree's content must not appear (utils.ts does not exist at HEAD)
  const decl = bundle.evidence.find((e) => e.kind === "symbol_declaration" && e.symbol === "shQuote");
  assert.equal(decl.found, true);
  assert.match(decl.path, /^packages\/quay\/src\/gate\/config\/utils\.ts$/);
  assert.equal(bundle.commit, C_GOAL034);
});

test("AC1: the sha256/commit-lock is real — a symbol that does not exist at the pinned commit is `found:false`, not a near-miss", async () => {
  const bundle = assemble(C_GOAL034, [{ file: "gate/config/utils.ts", from: "gate/config", to: "kernel", symbols: ["noSuchSymbolHere"] }]);
  const decl = bundle.evidence.find((e) => e.kind === "symbol_declaration");
  assert.equal(decl.found, false);
  assert.equal(decl.range, null);
  assert.match(decl.text, /no declaration of noSuchSymbolHere/);
});

test("AC1: a denied path is RECORDED as a denial, and its text never enters any reading", () => {
  const bundle = assembleOwnershipEvidence({
    root: REPO, commit: C_GOAL034, scopeRoot: "",
    slice: { subject: "t", moves: [{ file: "docs/analysis/ownership-active-loop.mjs", from: "docs/analysis", to: "gate", symbols: ["cli"] }] },
  });
  assert.ok(bundle.denied.some((d) => d.path === "docs/analysis/ownership-active-loop.mjs" && d.reason === "PATH_DENIED"), JSON.stringify(bundle.denied));
  assert.equal(admitPath("docs/analysis/ownership-active-loop.mjs").ok, false);
  // the CONTENT of the denied file never appears (naming the path in a locator is not reading it)
  for (const e of bundle.evidence) assert.ok(!/runActiveInvestigation/.test(e.text), `denied CONTENT leaked into ${e.id}`);
  assert.equal(bundle.evidence.some((e) => e.kind === "source_imports" && (e.imports ?? []).length), false, "nothing was read out of the denied file");
});

test("AC1: the byte cap is enforced and every truncation is RECORDED (never a silent clip)", () => {
  const budget = { max_total_evidence_bytes: 4_000, max_result_bytes: 9_000, max_read_lines: 160, max_grep_hits: 5 };
  const bundle = assemble(C_GOAL034, P1_MOVES, { budget });
  assert.ok(bundle.truncations.length > 0, "a 4 kB cap over this slice must truncate something");
  assert.ok(bundle.bytes <= budget.max_total_evidence_bytes, `${bundle.bytes} <= ${budget.max_total_evidence_bytes}`);
  for (const t of bundle.truncations) {
    assert.ok(t.dropped_bytes > 0, "a truncation that dropped nothing is not a truncation");
    assert.ok(t.evidence_id.startsWith("ev-"));
    const ev = bundle.evidence.find((e) => e.id === t.evidence_id);
    assert.equal(ev.truncated, true);
  }
  assert.equal(bundle.budget.used_bytes, bundle.bytes);
});

test("AC1: the bundle carries NO scc/cycle/delta key — and the predicate that guarantees it turns red on an injected one", () => {
  const bundle = assemble(C_GOAL034, P1_MOVES);
  assert.deepEqual(findStructuralKeyLeaks(bundle), [], "the assembled bundle is clean");

  // NEGATIVE CONTROL: inject exactly the field the prohibition names.
  const injected = JSON.parse(JSON.stringify(bundle));
  injected.sccLeft = ["gate/config"];
  const leaks = findStructuralKeyLeaks(injected);
  assert.ok(leaks.length > 0, "an injected sccLeft MUST be found");
  assert.ok(leaks.some((l) => l.key === "sccLeft"));
  // and the gate the ASSEMBLER runs is the same one the test calls: feed it a bundle that carries one
  assert.throws(() => assertBundleClean({ ...injected }), /BUNDLE_CARRIES_STRUCTURAL_FIELD/);
  assert.equal(assertBundleClean(bundle), true);
  // every token the prohibition names is actually covered by the predicate
  for (const k of ["sccLeft", "scc_size", "cycle", "cycles", "delta", "slice_delta", "expected_mechanical_delta"]) {
    assert.ok(findStructuralKeyLeaks({ [k]: 1 }).length > 0, `${k} must be caught`);
  }
});

test("AC1: all judge-facing text is redacted — a real file whose header names GOAL-034 yields no decision reference", async () => {
  const bundle = assemble(C_ADD3E7, [{ file: "kernel/gate-run-options.ts", from: "kernel", to: "gate/config", symbols: ["shQuote"] }]);
  const typesCharter = bundle.evidence.find((e) => e.kind === "target_charter" && e.text.includes("gate/config/types.ts"));
  assert.ok(typesCharter, "types.ts is in the target dir and contributes its header");
  assert.ok(typesCharter.redacted_blocks > 0, "the header block naming GOAL-034 was redacted");
  assert.ok(!/GOAL-034/.test(typesCharter.text), "the reference is gone");
  for (const e of bundle.evidence) assert.ok(!/GOAL-\d/.test(e.text), `un-redacted decision reference in ${e.id}`);
});

test("AC1: helpers are position-based, not keyword-based", () => {
  const src = [
    "// export function fake() {} — a comment line is not a declaration",
    "export function real(x: number): number {",
    "  return x;",
    "}",
    "export type T = string;",
  ].join("\n");
  assert.deepEqual(exportedNames(src).sort(), ["T", "real"]);
  assert.equal(declarationBlock(src.split("\n"), "fake"), null, "a comment line is not a declaration");
  assert.equal(declarationBlock(src.split("\n"), "real").start, 2);
  // statement names: a brace form lists its names, a star form is deliberately UNEXPANDABLE
  assert.deepEqual(statementNames('import { a, type B, c as d } from "./x.ts";').sort(), ["B", "a", "d"]);
  assert.deepEqual(statementNames('export * from "./x.ts";'), ["*"]);
  assert.deepEqual(statementNames('import def from "./x.ts";'), ["def"]);
  assert.deepEqual(statementNames('import type { X } from "./x.ts";'), ["X"]);
  // clipToBytes reports the drop instead of hiding it
  const c = clipToBytes("abcdefghij", 4);
  assert.equal(c.truncated, true);
  assert.ok(c.dropped_bytes > 0);
  assert.equal(clipToBytes("ab", 4).truncated, false);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC2 — the mechanical facts on REAL commits: the positive case is clean, the two negative cases are not.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("AC2: P1 (GOAL-034's landed cut) — dest_boundary_violation false, nothing transfers", () => {
  const facts = ownershipFacts(assemble(C_GOAL034, P1_MOVES), null);
  for (const m of facts.moves) {
    assert.equal(m.dest_boundary_violation, false, `move ${m.move_index}`);
    assert.deepEqual(m.transferred_dependencies, [], `move ${m.move_index} transfers nothing`);
    assert.deepEqual(m.io_pull.pulled, [], "utils.ts/types.ts do no I/O");
    assert.equal(m.dest_boundary.observed_out_size, 0, "kernel reaches outside itself nowhere");
  }
});

test("AC2: N1 (GOAL-034's REJECTED wide move) — dest_boundary_violation true AND io_pull non-empty", () => {
  const facts = ownershipFacts(assemble(C_GOAL034, N1_MOVES), null);
  const m = facts.moves[0];
  assert.equal(m.dest_boundary_violation, true);
  assert.equal(m.dest_boundary.observed_out_size, 0, "kernel's observed boundary is empty");
  assert.ok(m.io_pull.pulled.length > 0, "the io_pull reading is non-empty: loader.ts imports I/O modules");
  assert.ok(m.io_pull.pulled.some((x) => x.spec === "node:fs"));
  assert.ok(m.io_pull.pulled.some((x) => x.spec === "node:fs" || x.spec === "yaml"));
  assert.ok(m.transferred_dependencies.length >= 2, JSON.stringify(m.transferred_dependencies.map((t) => t.spec)));
  assert.ok(m.counter_evidence_ids.length > 0, "the adverse reading names the evidence that shows it");
});

test("AC2: the stores->kernel cut (isolated run live:…T11-03-06) is a boundary violation at its own commit", () => {
  const moves = [
    { file: "goal-store.ts", from: "", to: "kernel", symbols: ["createGoalStore"] },
    { file: "abi.ts", from: "", to: "kernel", symbols: ["Task", "TaskStatus", "TASK_STATUS", "TASK_STATUSES"] },
  ];
  const facts = ownershipFacts(assemble(C_ADD3E7, moves), null);
  const goalStore = facts.moves[0];
  assert.equal(goalStore.dest_boundary_violation, true, "kernel reaches nothing outside itself, and goal-store.ts does");
  assert.ok(goalStore.transferred_dependencies.some((t) => t.resolved_dir !== null && t.resolved_dir !== "kernel"));
});

test("AC2: record 91 move 3 (loader.ts -> gate) transfers a dependency onto src/config.ts (core-root)", () => {
  const moves = [{ file: "gate/config/loader.ts", from: "gate/config", to: "gate", symbols: ["loadWorkspaceGates", "loadWorkspaceGateMetadata", "readGatesConfig", "discoverWorkspaceRoot", "resolveWorkspaceRootOrThrow", "GatesConfig"] }];
  const facts = ownershipFacts(assemble(C_EC00FC, moves), null);
  const m = facts.moves[0];
  const coreRoot = m.transferred_dependencies.filter((t) => t.resolved_dir === "");
  assert.ok(coreRoot.length > 0, JSON.stringify(m.transferred_dependencies.map((t) => `${t.spec}->${t.resolved_dir}`)));
  assert.ok(coreRoot.some((t) => /(^|\/)config\.ts$/.test(String(t.resolved_path))), "the edge points at src/config.ts");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC2b — the two boundary sources are COMPARED and NAMED; a missing edge can never be reported as `agree`.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const add3e7Graph = () => JSON.parse(fs.readFileSync(path.join(REPO, "plugin/fixtures/ownership-semantic-eval/arch-add3e7318-packages-quay-src.json"), "utf8")).extensions.tsAnalysis.moduleGraph;

test("AC2b: at add3e7318 the graph and the source parse AGREE on gate/config — including the kernel re-exports", () => {
  const bundle = assembleOwnershipEvidence({
    root: REPO, commit: C_ADD3E7, scopeRoot: "packages/quay/src",
    slice: { subject: "t", moves: [{ file: "gate/config/loader.ts", from: "gate/config", to: "gate", symbols: ["loadWorkspaceGates"] }] },
  });
  const facts = ownershipFacts(bundle, add3e7Graph());
  const b = facts.boundaries["gate/config"];
  assert.equal(b.agreement, "agree", JSON.stringify(b));
  assert.deepEqual(b.graph_missing_edges, []);
  assert.deepEqual(b.parse_missing_edges, []);
  // the two `export … from "../../kernel/gate-run-options.ts"` re-exports are visible on BOTH sides
  assert.ok(b.graph_out.some((e) => e.to === "kernel"), "the graph carries gate/config -> kernel");
  assert.ok(b.parse_out.some((e) => e.to === "kernel"), "the parse carries it too");
  const kernelEdge = b.graph_out.find((e) => e.to === "kernel");
  for (const n of ["GateConfig", "RunnerOptions", "shQuote", "resolveRunnerOptions"]) assert.ok(kernelEdge.names.includes(n), `${n} named on the graph edge`);
  assert.equal(b.boundary_source, "archguard_module_graph", "the graph is the PRIMARY source when it is readable");
  assert.ok(BOUNDARY_AGREEMENT.includes(b.agreement));
});

test("AC2b: a graph MISSING the re-export edges is reported as graph_missing_edges and names them — never as agree", () => {
  const bundle = assembleOwnershipEvidence({
    root: REPO, commit: C_ADD3E7, scopeRoot: "packages/quay/src",
    slice: { subject: "t", moves: [{ file: "gate/config/loader.ts", from: "gate/config", to: "gate", symbols: ["loadWorkspaceGates"] }] },
  });
  const g = add3e7Graph();
  g.edges = g.edges.filter((e) => !(e.from === "gate/config" && e.to === "kernel"));   // drop the re-export edge
  const facts = ownershipFacts(bundle, g);
  const b = facts.boundaries["gate/config"];
  assert.equal(b.agreement, "graph_missing_edges", "a missing edge MUST NOT be reported as agree");
  assert.deepEqual(b.graph_missing_edges, ["kernel"], "and the difference is NAMED");
  assert.deepEqual(b.parse_missing_edges, []);
});

test("AC2b negative control: removing a PARSED edge flips the status to parse_missing_edges", () => {
  const bundle = assembleOwnershipEvidence({
    root: REPO, commit: C_ADD3E7, scopeRoot: "packages/quay/src",
    slice: { subject: "t", moves: [{ file: "gate/config/loader.ts", from: "gate/config", to: "gate", symbols: ["loadWorkspaceGates"] }] },
  });
  const ev = bundle.evidence.find((e) => e.kind === "dir_imports" && e.dir_id === "gate/config");
  ev.imports = ev.imports.filter((im) => im.resolved_dir !== "kernel");               // drop the parse-side edge
  const facts = ownershipFacts(bundle, add3e7Graph());
  const b = facts.boundaries["gate/config"];
  assert.equal(b.agreement, "parse_missing_edges", "the deletion is visible, with its own value");
  assert.deepEqual(b.parse_missing_edges, ["kernel"]);
  assert.deepEqual(b.graph_missing_edges, []);
});

test("AC2b: the comparison has no 'agree' path when a source is unreadable, and says WHICH", () => {
  assert.equal(compareBoundaries(null, null).agreement, NOT_EVALUATED);
  assert.equal(compareBoundaries(null, [{ to: "x" }]).agreement, NOT_EVALUATED);
  assert.equal(compareBoundaries([{ to: "x" }], null).agreement, NOT_EVALUATED);
  assert.equal(compareBoundaries([{ to: "x" }], [{ to: "x" }]).agreement, "agree");
  assert.equal(compareBoundaries([], [{ to: "x" }]).agreement, "graph_missing_edges");
  assert.equal(compareBoundaries([{ to: "x" }], []).agreement, "parse_missing_edges");
  assert.equal(compareBoundaries([{ to: "x" }], [{ to: "y" }]).agreement, "both_differ");
  // a directory the graph does not know is NOT "read and found empty": the parse side still reads honestly
  const bundle = assembleOwnershipEvidence({
    root: REPO, commit: C_ADD3E7, scopeRoot: "packages/quay/src",
    slice: { subject: "t", moves: [{ file: "gate/types.ts", from: "gate", to: "nowhere-at-all", symbols: ["GateFn"] }] },
  });
  const facts = ownershipFacts(bundle, add3e7Graph());
  const b = facts.boundaries["nowhere-at-all"];
  assert.equal(b.agreement, NOT_EVALUATED, "a graph that does not know the node cannot report `agree`");
  assert.equal(b.graph_out, null);
  assert.equal(b.boundary_source, "source_parse", "the parse side WAS read, and the reading says which side it is");
  // The parse observed a directory with no files at all ⇒ an empty boundary, and a move that would give it
  // an outward edge IS a violation. That is a reading, not a missing value.
  assert.equal(facts.moves[0].dest_boundary_violation, true);

  // But a boundary NO source could read is `null`, never `false` (硬规则 3b): delete the parse evidence too.
  const stripped = assembleOwnershipEvidence({
    root: REPO, commit: C_ADD3E7, scopeRoot: "packages/quay/src",
    slice: { subject: "t", moves: [{ file: "gate/types.ts", from: "gate", to: "nowhere-at-all", symbols: ["GateFn"] }] },
  });
  stripped.evidence = stripped.evidence.filter((e) => !(e.kind === "dir_imports" && e.dir_id === "nowhere-at-all"));
  const f2 = ownershipFacts(stripped, add3e7Graph());
  assert.equal(f2.boundaries["nowhere-at-all"].graph_out, null);
  assert.equal(f2.moves[0].dest_boundary_violation, null, "an unobservable boundary is null, NOT false");
  assert.equal(f2.moves[0].dest_boundary.observed_out_size, null);
});

test("AC2b: io_pull is the CONJUNCTION it says it is — a real pull into an I/O-free directory", () => {
  const files = {
    "packages/quay/src/kernel/pure.ts": "export const pure = 1;\n",
    "packages/quay/src/gate/config/reader.ts": 'import fs from "node:fs";\nexport function readIt() { return fs; }\n',
  };
  const git = (args) => {
    if (args[0] === "ls-tree") return Object.keys(files).join("\n") + "\n";
    if (args[0] === "show") { const p = args[1].split(":").slice(1).join(":"); if (!(p in files)) { const e = new Error("x"); e.status = 128; throw e; } return files[p]; }
    return "";
  };
  const bundle = assembleOwnershipEvidence({
    root: REPO, commit: "f".repeat(40), scopeRoot: "packages/quay/src",
    slice: { subject: "t", moves: [{ file: "gate/config/reader.ts", from: "gate/config", to: "kernel", symbols: ["readIt"] }] },
    deps: { git },
  });
  const m = ownershipFacts(bundle, null).moves[0];
  assert.equal(m.io_pull.dest_has_io, false, "kernel here is I/O-free");
  assert.equal(m.io_pull.is_pull, true, "so importing node:fs into it IS a pull");
  assert.deepEqual(m.io_pull.pulled.map((x) => x.spec), ["node:fs"]);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC3 — the judge contract.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("AC3: the review path takes no label — structurally (source) and behaviourally (identical output)", async () => {
  const code = stripComments(fs.readFileSync(path.join(REPO, MODULE_REL), "utf8"));
  for (const fn of ["assembleOwnershipEvidence", "ownershipFacts", "reviewOwnership", "buildReviewPrompt"]) {
    const m = new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(([\\s\\S]*?)\\)\\s*\\{`).exec(code);
    assert.ok(m, `${fn} must be exported with a readable signature`);
    assert.doesNotMatch(m[1], /\blabel[s]?\b/, `${fn} must not take a label`);
  }
  // behavioural half: passing a label in changes NOTHING
  const withLabel = assemble(C_GOAL034, P1_MOVES, { label: "approve", labels: ["approve"] });
  const without = assemble(C_GOAL034, P1_MOVES);
  assert.equal(JSON.stringify(withLabel), JSON.stringify(without));
  const bundle = without;
  const f = ownershipFacts(bundle, null);
  const a = await reviewOwnership({ bundle, facts: f, invokeJudge: scriptedJudge([bundle.evidence[0].id]), label: "approve" });
  const b = await reviewOwnership({ bundle, facts: f, invokeJudge: scriptedJudge([bundle.evidence[0].id]) });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("AC3: a fabricated evidence id makes that MOVE not-evaluated (UNGROUNDED_CITATION) — never a silent pass", async () => {
  const bundle = assemble(C_GOAL034, P1_MOVES);
  const facts = ownershipFacts(bundle, null);
  const good = bundle.evidence[0].id, bad = "ev-9999";
  const judge = async () => ({
    status: 0,
    stdout: JSON.stringify({
      moves: [
        { move_index: 0, responsibility_hypothesis: "h", evidence_refs: [good], counter_evidence_refs: [], confidence: "high", recommendation: "review" },
        { move_index: 1, responsibility_hypothesis: "h", evidence_refs: [bad], counter_evidence_refs: [], confidence: "high", recommendation: "review" },
      ],
      overall: {},
    }),
  });
  const r = await reviewOwnership({ bundle, facts, invokeJudge: judge });
  assert.equal(r.state, "evaluated");
  assert.equal(r.moves[0].recommendation, "review");
  assert.equal(r.moves[1].recommendation, NOT_EVALUATED);
  assert.equal(r.moves[1].cause, "UNGROUNDED_CITATION");
  assert.deepEqual(r.moves[1].ungrounded_refs, [bad]);
  assert.equal(r.overall.recommendation, "abstain", "an unusable move blocks a review-level `review`");
  assert.deepEqual(r.overall.not_evaluated_moves, [1]);
  // a move the judge simply did not answer is its OWN cause, not a citation failure
  const r2 = await reviewOwnership({ bundle, facts, invokeJudge: async () => ({ status: 0, stdout: JSON.stringify({ moves: [] }) }) });
  assert.equal(r2.moves[0].cause, "MOVE_NOT_JUDGED");
});

test("AC3: an unparseable reply is NOT-EVALUATED and is distinguishable from abstain", async () => {
  const bundle = assemble(C_GOAL034, P1_MOVES);
  const facts = ownershipFacts(bundle, null);
  const r = await reviewOwnership({ bundle, facts, invokeJudge: async () => ({ status: 0, stdout: "I would rather not." }) });
  assert.equal(r.state, NOT_EVALUATED);
  assert.equal(r.cause, "JUDGE_OUTPUT_UNREADABLE");
  assert.notEqual(r.state, "abstain");
  assert.equal(r.moves.length, 0);
  assert.equal(parseReview("I would rather not."), null);
  assert.equal(parseReview(""), null);
  assert.deepEqual(parseReview('```json\n{"moves":[]}\n```'), { moves: [] });
  assert.deepEqual(parseReview('prose first {"moves":[]} trailing'), { moves: [] });

  // judge unavailable / no seam: two more distinct not-evaluated causes
  const e1 = await reviewOwnership({ bundle, facts, invokeJudge: async () => ({ status: 127, stdout: "" }) });
  assert.equal(e1.cause, "JUDGE_UNAVAILABLE");
  const e2 = await reviewOwnership({ bundle, facts });
  assert.equal(e2.cause, "NO_JUDGE_SEAM");
  assert.equal(e2.judge_calls, 0);
  // …and a REAL abstain from the judge stays `evaluated`
  const r2 = await reviewOwnership({ bundle, facts, invokeJudge: scriptedJudge([bundle.evidence[0].id], "abstain") });
  assert.equal(r2.state, "evaluated");
  assert.equal(r2.overall.recommendation, "abstain");
});

test("AC3: the overall synthesis is deterministic, branch by branch", () => {
  const v = (recommendation) => ({ recommendation });
  assert.equal(synthesizeOverallRecommendation([v("review"), v("review")]), "review");
  assert.equal(synthesizeOverallRecommendation([v("review"), v("reject")]), "reject", "any reject wins");
  assert.equal(synthesizeOverallRecommendation([v("reject"), v("abstain")]), "reject");
  assert.equal(synthesizeOverallRecommendation([v("review"), v("abstain")]), "abstain");
  assert.equal(synthesizeOverallRecommendation([v("review"), v(NOT_EVALUATED)]), "abstain", "not-evaluated is not a review");
  assert.equal(synthesizeOverallRecommendation([]), "abstain");
  assert.equal(synthesizeOverallRecommendation([v("reject"), v(NOT_EVALUATED)]), "reject");
});

test("AC3: a `review` over a mechanical boundary violation that does NOT answer it is downgraded to abstain", async () => {
  const bundle = assemble(C_GOAL034, N1_MOVES);
  const facts = ownershipFacts(bundle, null);
  const m = facts.moves[0];
  assert.equal(m.dest_boundary_violation, true);
  const violationId = m.violation_evidence_ids[0];
  assert.ok(violationId, "the violation is citable");

  // (a) ignores the violation ⇒ abstain
  const ignored = await reviewOwnership({ bundle, facts, invokeJudge: scriptedJudge([bundle.evidence[0].id], "review") });
  assert.equal(ignored.moves[0].recommendation, "abstain");
  assert.equal(ignored.moves[0].cause, "BOUNDARY_VIOLATION_NOT_ADDRESSED");
  assert.equal(ignored.moves[0].downgraded_from, "review");
  assert.equal(ignored.overall.recommendation, "abstain");

  // (b) POSITIVE CONTROL: answering the violation with a citation keeps the verdict
  const answered = await reviewOwnership({ bundle, facts, invokeJudge: async () => ({
    status: 0,
    stdout: JSON.stringify({
      moves: [{ move_index: 0, responsibility_hypothesis: "h", evidence_refs: [bundle.evidence[0].id], counter_evidence_refs: [violationId], confidence: "low", recommendation: "review" }],
      overall: {},
    }),
  }) });
  assert.equal(answered.moves[0].recommendation, "review");
  assert.equal(answered.moves[0].cause, null);

  // (c) and a `reject` is never touched by the rule (it already answers the adverse reading)
  const rejected = await reviewOwnership({ bundle, facts, invokeJudge: scriptedJudge([bundle.evidence[0].id], "reject") });
  assert.equal(rejected.moves[0].recommendation, "reject");
  assert.equal(rejected.overall.recommendation, "reject");

  // (d) the rule only fires on a violation — a clean move is not downgraded
  const clean = ownershipFacts(assemble(C_GOAL034, P1_MOVES), null);
  assert.equal(clean.moves[0].dest_boundary_violation, false);
});

test("AC3: confidence and recommendation vocabularies are enforced, with their own causes", async () => {
  const bundle = assemble(C_GOAL034, P1_MOVES);
  const facts = ownershipFacts(bundle, null);
  const mk = (over) => async () => ({ status: 0, stdout: JSON.stringify({ moves: [{ move_index: 0, responsibility_hypothesis: "h", evidence_refs: [bundle.evidence[0].id], counter_evidence_refs: [], confidence: "medium", recommendation: "review", ...over }] }) });
  assert.equal((await reviewOwnership({ bundle, facts, invokeJudge: mk({ recommendation: "approve" }) })).moves[0].cause, "RECOMMENDATION_NOT_IN_VOCAB:approve");
  assert.equal((await reviewOwnership({ bundle, facts, invokeJudge: mk({ confidence: "certain" }) })).moves[0].cause, "CONFIDENCE_NOT_IN_VOCAB:certain");
  assert.equal((await reviewOwnership({ bundle, facts, invokeJudge: mk({ responsibility_hypothesis: "" }) })).moves[0].cause, "HYPOTHESIS_MISSING");
  assert.deepEqual(RECOMMENDATIONS, ["review", "reject", "abstain"]);
});

test("AC3: the prompt carries the bundle and the facts and nothing else; its sha is recorded", async () => {
  const bundle = assemble(C_GOAL034, P1_MOVES);
  const facts = ownershipFacts(bundle, null);
  const prompt = buildReviewPrompt({ bundle, facts });
  assert.match(prompt, /NO tools/);
  assert.ok(prompt.includes(JSON.stringify(bundle)));
  assert.ok(prompt.includes(JSON.stringify(facts)));
  const r = await reviewOwnership({ bundle, facts, invokeJudge: scriptedJudge([bundle.evidence[0].id]) });
  assert.match(r.prompt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.prompt_sha256, sha256(prompt));
  assert.equal(r.judge_calls, 1);
});

test("AC3: the review module reaches no writer, no lifecycle and no filing surface", () => {
  const code = stripComments(fs.readFileSync(path.join(REPO, MODULE_REL), "utf8"));
  assert.doesNotMatch(code, /\b(writeFileSync|appendFileSync|unlinkSync|renameSync|copyFileSync|mkdirSync)\b/);
  assert.doesNotMatch(code, /lifecycle_(promote|complete|retreat|adjudicate)/);
  assert.doesNotMatch(code, /\bcreateGoalStore\b|\bgoal_store\b|task_write/);
  assert.doesNotMatch(code, /status\s*[:=]\s*["'](active|ready|done)["']/);
  // it must not read a GOAL body or the layers draft either (the DoD's explicit prohibitions)
  assert.doesNotMatch(code.replace(/^\s*\/\/.*$/gm, ""), /goals\//);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC4 — the isolated evaluation set: labels reach the scorer only, and the directory is deny-listed.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const CASES_REL = "plugin/fixtures/ownership-semantic-eval/cases.json";

test("AC4: cases.json carries human positives, a human negative, and derived/unlabeled production candidates", () => {
  const loaded = loadCases(path.join(REPO, CASES_REL));
  assert.equal(loaded.ok, true, loaded.reason);
  const by = (s) => loaded.cases.filter((c) => c.label_source === s);
  assert.ok(by("human-approved").length >= 2, "P1 and P2");
  assert.ok(by("human-rejected").length >= 1, "N1");
  assert.ok(by("derived").length >= 1, "the production loader->gate runs");
  assert.ok(by("unlabeled").length >= 1, "the stores->kernel cut nobody has ruled on");
  for (const s of LABEL_SOURCES) assert.ok(LABEL_SOURCES.includes(s));
  // the human labelled cases are exactly the ones the task names, at the commits it names
  const ids = Object.fromEntries(loaded.cases.map((c) => [c.id, c]));
  assert.equal(ids["P1-goal-034-utils-to-kernel"].commit, C_GOAL034);
  assert.equal(ids["P2-goal-033-cli-to-root"].commit, C_GOAL033);
  assert.equal(ids["N1-goal-034-rejected-wide-move"].commit, C_GOAL034);
  assert.ok(ids["P2-goal-033-cli-to-root"].moves.some((m) => m.file === "cli/driver.ts" && m.to === ""));
  // every case points at a readable graph fixture or at none at all — never at a graph from another tree
  for (const c of loaded.cases) if (c.graph_fixture) assert.ok(fs.existsSync(path.join(REPO, c.graph_fixture)), c.graph_fixture);
});

test("AC4: loadCases refuses a malformed set instead of silently skipping rows", () => {
  const dir = mkTmp();
  const write = (o) => { const f = path.join(dir, "c.json"); fs.writeFileSync(f, JSON.stringify(o)); return f; };
  const base = { id: "x", commit: "c", scope_root: "s", moves: [{ file: "a.ts", from: "", to: "k", symbols: ["a"] }], label: "approve", label_source: "human-approved" };
  assert.equal(loadCases(write({ cases: [base] })).ok, true);
  assert.match(loadCases(write({ nope: 1 })).reason, /CASES_MISSING/);
  assert.match(loadCases(write({ cases: [{ ...base, label_source: "vibes" }] })).reason, /LABEL_SOURCE_UNKNOWN/);
  assert.match(loadCases(write({ cases: [{ ...base, label_source: "unlabeled", label: "approve" }] })).reason, /UNLABELED_CASE_CARRIES_A_LABEL/);
  assert.match(loadCases(write({ cases: [{ ...base, label: "maybe" }] })).reason, /LABEL_UNKNOWN/);
  assert.match(loadCases(write({ cases: [{ ...base, moves: [] }] })).reason, /CASE_MALFORMED/);
});

test("AC4: the scorer separates label sources and never counts abstain/not-evaluated as correct", () => {
  const pos = { label: "approve", label_source: "human-approved" };
  const neg = { label: "reject", label_source: "human-rejected" };
  const ev = (rec) => ({ state: "evaluated", overall: { recommendation: rec } });
  assert.equal(scoreCase({ ...pos, review: ev("review") }).outcome, "correct");
  assert.equal(scoreCase({ ...pos, review: ev("reject") }).outcome, "false-positive");
  assert.equal(scoreCase({ ...neg, review: ev("review") }).outcome, "false-negative");
  assert.equal(scoreCase({ ...neg, review: ev("reject") }).outcome, "correct");
  const abstain = scoreCase({ ...pos, review: ev("abstain") });
  assert.equal(abstain.outcome, "abstain");
  assert.equal(abstain.counts_toward_confusion, true, "listed in the human bucket…");
  const unparsed = scoreCase({ ...pos, review: { state: NOT_EVALUATED } });
  assert.equal(unparsed.outcome, "not-evaluated");
  const derived = scoreCase({ label: "reject", label_source: "derived", review: ev("review") });
  assert.equal(derived.outcome, "false-negative");
  assert.equal(derived.counts_toward_confusion, false, "…but a derived label never enters the confusion readings");
  const unlabeled = scoreCase({ label: null, label_source: "unlabeled", review: ev("review") });
  assert.equal(unlabeled.outcome, "unscored");
  assert.equal(unlabeled.counts_toward_confusion, false);

  const s = summarize([
    { label: "approve", label_source: "human-approved", outcome: "correct", counts_toward_confusion: true },
    { label: "approve", label_source: "human-approved", outcome: "abstain", counts_toward_confusion: true },
    { label: "reject", label_source: "human-rejected", outcome: "correct", counts_toward_confusion: true },
  ]);
  assert.deepEqual([s.human_labeled.n, s.human_labeled.correct, s.human_labeled.abstain], [3, 2, 1]);
  assert.equal(s.rates_reported, false, "n=3 carries no rate");
  assert.equal(s.by_label_source["human-approved"], 2);
});

test("AC4: the evaluation set is deny-listed for the investigator — read_file on it is PATH_DENIED", () => {
  assert.ok(DENY_PATH_PATTERNS.some((re) => re.test(CASES_REL)), "the directory is in the shared deny-list");
  assert.ok(DENY_PATH_PATTERNS.some((re) => re.test("plugin/fixtures/ownership-semantic-eval/arch-any.json")));
  const v = validateRequest({ kind: "read_file", path: CASES_REL, start_line: 1, end_line: 20 });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.includes("PATH_DENIED"), JSON.stringify(v.reasons));
  // POSITIVE CONTROL: a neighbouring fixture directory that is NOT deny-listed still passes
  assert.equal(validateRequest({ kind: "read_file", path: "plugin/fixtures/ownership-active-slice/goal-033-slice.json", start_line: 1, end_line: 5 }).ok, true);
});

test("AC4: runEval exercises the real pipeline with a scripted judge and reports per-case readings", async () => {
  const loaded = loadCases(path.join(REPO, CASES_REL));
  const cases = loaded.cases.filter((c) => c.id === "P1-goal-034-utils-to-kernel" || c.id === "N1-goal-034-rejected-wide-move");
  const res = await runEval({
    cases, root: REPO,
    invokeJudge: async (prompt) => {
      // Cite EVERY evidence id the prompt exposes: grounded by construction, and it ANSWERS the adverse
      // readings, so the boundary-violation downgrade rule is not what decides this outcome.
      const ids = [...new Set([...prompt.matchAll(/"id":\s*"(ev-\d+)"/g)].map((m) => m[1]))];
      const body = { moves: [], overall: { responsibility_hypothesis: "x", evidence_refs: [], counter_evidence_refs: [], confidence: "medium" } };
      for (const mi of [0, 1, 2, 3, 4, 5, 6, 7]) body.moves.push({ move_index: mi, responsibility_hypothesis: "h", evidence_refs: ids, counter_evidence_refs: ids, confidence: "medium", recommendation: "review" });
      return { status: 0, stdout: JSON.stringify(body) };
    },
    graphFor: (c) => (c.graph_fixture ? JSON.parse(fs.readFileSync(path.join(REPO, c.graph_fixture), "utf8")).extensions.tsAnalysis.moduleGraph : null),
  });
  assert.equal(res.rows.length, 2);
  for (const r of res.rows) {
    assert.equal(r.state, "evaluated");
    assert.match(r.prompt_sha256, /^[0-9a-f]{64}$/);
    assert.equal(r.judge_calls, 1);
    assert.ok(r.bundle_bytes > 0);
    assert.ok(r.elapsed_ms >= 0);
    assert.ok(r.mechanical_facts.length === r.n_moves);
    assert.ok(r.moves.length === r.n_moves);
  }
  const p1 = res.rows.find((r) => r.id === "P1-goal-034-utils-to-kernel");
  assert.equal(p1.outcome, "correct");
  const n1 = res.rows.find((r) => r.id === "N1-goal-034-rejected-wide-move");
  assert.equal(n1.mechanical_facts[0].dest_boundary_violation, true);
  assert.equal(n1.outcome, "false-negative", "an unanswering judge over the rejected move is a FALSE NEGATIVE, and is reported as one");
  assert.equal(res.summary.human_labeled.false_negatives, 1);
  assert.equal(res.summary.human_labeled.n, 2);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC6 — the leakage audit over the text actually sent, with a positive control that must fire.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("AC6: every actually-sent bundle is clean of the holdout vocabulary; the audit fires on an un-redacted one", () => {
  const cases = loadCases(path.join(REPO, CASES_REL));
  for (const c of cases.cases) {
    const bundle = assembleOwnershipEvidence({ root: REPO, commit: c.commit, scopeRoot: c.scope_root, slice: { subject: c.subject ?? "case", moves: c.moves } });
    const audit = auditHoldoutLeakage(bundle);
    assert.equal(audit.ok, true, `${c.id} leaked: ${JSON.stringify(audit.hits)}`);
  }

  // POSITIVE CONTROL: the SAME assembly with the redactor turned OFF (an identity seam) must报警 — this is
  // what proves the audit is a reading and not a constant `ok:true`.
  const identity = (t) => ({ text: t, redacted_blocks: 0 });
  const raw = assembleOwnershipEvidence({
    root: REPO, commit: C_ADD3E7, scopeRoot: "packages/quay/src",
    slice: { subject: "control", moves: [{ file: "kernel/gate-run-options.ts", from: "kernel", to: "gate/config", symbols: ["shQuote"] }] },
    deps: { redact: identity },
  });
  const rawAudit = auditHoldoutLeakage(raw);
  assert.equal(rawAudit.ok, false, "an un-redacted bundle MUST be flagged");
  assert.ok(rawAudit.hits.some((h) => h.term === "GOAL-034"));
  assert.ok(rawAudit.hits.some((h) => h.term === "not config-loading"));
  // and the SAME slice through the real redactor is clean — the difference is the redaction, nothing else
  const redacted = assembleOwnershipEvidence({
    root: REPO, commit: C_ADD3E7, scopeRoot: "packages/quay/src",
    slice: { subject: "control", moves: [{ file: "kernel/gate-run-options.ts", from: "kernel", to: "gate/config", symbols: ["shQuote"] }] },
  });
  assert.equal(auditHoldoutLeakage(redacted).ok, true);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC7 — the advisory integration changes NO admission judgement, and the draft body carries the review.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const goodDelta = () => ({
  status: "evaluated",
  delta: { before: { scc_size: 6, members: ["", "gate"] }, after: { scc_size: 5, members: ["", "gate"] }, left: ["cli"], removed_edges: [], added_edges: [] },
  negative_control: { falsified: true, restore_edges: [] },
  provenance: { provenance_consistency: { status: "match" } },
});

const rec = (over = {}) => ({
  run_id: "live:1", label: "live", commit: C_GOAL034, ts_iso: "2026-10-11T00:00:00Z",
  concern_kind: "package-cycle", slice_delta: goodDelta(), decision_memory: { status: "not-known" },
  proposed_slice: { scope_root: "packages/quay/src", subject: "gate/config", moves: P1_MOVES },
  envelope: { evidence_refs: ["ev-1"] }, evidence: [{ id: "ev-1" }],
  subject_files: ["packages/quay/src/gate/config/utils.ts"],
  ...over,
});

function eligibleCarrier(file) {
  fs.writeFileSync(file, [rec({ run_id: "live:1" }), rec({ run_id: "live:2" }), rec({ run_id: "live:3" })].map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const groundedJudge = async (prompt) => {
  const id = /"id":\s*"(ev-\d+)"/.exec(prompt)?.[1] ?? "ev-1";
  return scriptedJudge([id], "review")();
};

test("AC7: `--review` on vs off leaves every candidate's eligible / reason / streak byte-identical", async () => {
  const dir = mkTmp();
  const carrier = path.join(dir, "carrier.jsonl");
  eligibleCarrier(carrier);
  const off = await runProposalCli({ argv: ["--carrier", carrier, "--root", dir], repoRoot: REPO });
  const on = await runProposalCli({ argv: ["--carrier", carrier, "--root", dir, "--repo", REPO, "--review"], repoRoot: REPO, deps: { invokeJudge: groundedJudge } });
  assert.equal(off.results.length, on.results.length);
  assert.equal(off.results.length, 1);
  for (let i = 0; i < off.results.length; i++) {
    assert.equal(on.results[i].eligible, off.results[i].eligible);
    assert.equal(on.results[i].reason, off.results[i].reason, "the refusal/eligibility REASON must not move");
    assert.equal(JSON.stringify(on.results[i].streak), JSON.stringify(off.results[i].streak));
    assert.equal(JSON.stringify(on.results[i].matchedConditions), JSON.stringify(off.results[i].matchedConditions));
  }
  assert.equal(off.results[0].eligible, true, "the control carrier IS eligible");
  assert.equal(off.results[0].review, undefined, "no --review ⇒ no review field, and no model was spawned");
  assert.equal(on.results[0].review.state, "evaluated");
  assert.equal(on.results[0].review.overall.recommendation, "review");
  assert.equal(on.results[0].review.leakage.ok, true);
  assert.ok(on.results[0].review.moves.length === P1_MOVES.length);
  assert.ok(on.results[0].review.moves[0].evidence_refs.length > 0);
});

test("AC7: without --write no Goal is written; with --write + --review the draft body carries the review", async () => {
  const dir = mkTmp();
  const carrier = path.join(dir, "carrier.jsonl");
  eligibleCarrier(carrier);
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });

  const dry = await runProposalCli({ argv: ["--carrier", carrier, "--root", dir, "--repo", REPO, "--review"], repoRoot: REPO, deps: { invokeJudge: groundedJudge } });
  assert.equal(dry.results[0].proposed, undefined);
  assert.equal(fs.readdirSync(path.join(dir, "goals")).length, 0, "no Goal written without --write");

  const written = await runProposalCli({ argv: ["--carrier", carrier, "--root", dir, "--repo", REPO, "--review", "--write"], repoRoot: REPO, deps: { invokeJudge: groundedJudge } });
  assert.equal(written.results[0].proposed.ok, true, written.results[0].proposed.reason);
  const files = fs.readdirSync(path.join(dir, "goals")).filter((f) => f.endsWith(".md"));
  const goalFile = files.map((f) => fs.readFileSync(path.join(dir, "goals", f), "utf8")).find((t) => /^id: GOAL-/m.test(t));
  assert.ok(goalFile, "a GOAL was written");
  assert.match(goalFile, /领域归属审查/, "the review section is present");
  assert.match(goalFile, /整体建议：\*\*review\*\*/);
  assert.match(goalFile, /advisory/, "and it says what it is");
  assert.match(goalFile, /ev-\d+/, "the evidence citations ride along");
  assert.match(goalFile, /status: draft/, "⛔ still a DRAFT — the review authorises nothing");
});

test("AC7: a candidate with no computed delta is NOT reviewed, and says so instead of faking a verdict", async () => {
  const dir = mkTmp();
  const carrier = path.join(dir, "carrier.jsonl");
  const noDelta = rec({ slice_delta: { status: "not-evaluated", delta: null, reason: "MOVE_TO_NOT_AN_INTERNAL_DIR" }, proposed_slice: null });
  fs.writeFileSync(carrier, JSON.stringify(noDelta) + "\n");
  const out = await runProposalCli({ argv: ["--carrier", carrier, "--root", dir, "--repo", REPO, "--review"], repoRoot: REPO, deps: { invokeJudge: groundedJudge } });
  assert.equal(out.results[0].review.state, NOT_EVALUATED);
  assert.equal(out.results[0].review.cause, "NO_COMPUTED_DELTA_WITH_SLICE");
  assert.equal(out.results[0].eligible, false, "unchanged by the review path");
});

test("AC7: reviewCandidate / renderReviewSection are the advisory surface, and a missing seam reports failure", async () => {
  const pick = await reviewCandidate([rec()], { root: REPO });
  assert.equal(pick.state, NOT_EVALUATED);
  assert.equal(pick.cause, "NO_JUDGE_SEAM");
  const r = await reviewCandidate([rec({ run_id: "live:1" }), rec({ run_id: "live:3" })], { root: REPO, invokeJudge: groundedJudge });
  assert.equal(r.state, "evaluated");
  assert.equal(r.commit, C_GOAL034);
  assert.equal(r.run_id, "live:3", "the LATEST qualifying run is the one reviewed");
  const lines = renderReviewSection(r).join("\n");
  assert.match(lines, /整体建议：\*\*review\*\*/);
  assert.match(lines, /judge prompt sha256：[0-9a-f]{64}/);
  const ne = renderReviewSection({ state: NOT_EVALUATED, cause: "X", reason: "y" });
  assert.match(ne.join("\n"), /未评估（X）/);
  // the review can never alter the built record's status
  const built = buildDraftGoal(rec(), { goalId: "GOAL-099", acId: "AC-099", review: r });
  assert.equal(built.goal.fields.status, "draft");
  assert.equal(built.ac.fields.status, "draft");
  assert.match(built.goal.fields.body, /领域归属审查/);
  assert.doesNotMatch(buildDraftGoal(rec(), { goalId: "GOAL-099", acId: "AC-099" }).goal.fields.body, /领域归属审查/, "no review ⇒ no review section");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// structure — the layer is advisory and self-contained.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("structure: the review module never reads docs/layers.yml, a GOAL body, or the held-out answer set", () => {
  const code = stripComments(fs.readFileSync(path.join(REPO, MODULE_REL), "utf8"));
  assert.doesNotMatch(code, /layers\.yml/);
  assert.doesNotMatch(code, /goals\/GOAL/);
  assert.doesNotMatch(code, /ownership-semantic-eval/, "the review module must not reach its own answer set");
  assert.equal(REVIEW_VERSION, "ownership-semantic-review/1");
  assert.ok(IO_MODULES.includes("node:fs") && IO_MODULES.includes("yaml"));
  assert.ok(STRUCTURAL_KEY_TOKENS.includes("scc"));
});
