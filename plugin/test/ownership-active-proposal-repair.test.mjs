// @test-group engine
// Tests for the BOUNDED PROPOSAL-REPAIR layer: rejection classification, the commit+scope lock, the
// four hard bounds, the directory-feedback contract, and the four negative controls (tool_limitation
// zero-retry, budget exhaustion, missing consumer, fabricated symbol).
//
// No model, no network: the judge is a scripted function; the primitive is the REAL `computeSliceDelta`
// adapter driven by fixture graphs and a scripted CLI report. The live blind replays (pre/post-merge)
// are recorded in docs/analysis/ownership-active-proposal-repair-replay.md, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  REJECTION_CLASSES, REPAIRABLE_CLASSES, REPAIR_LIMITS, classifyRejection, isRepairableRejection,
  internalNodeIds, graphSymbols, unknownSymbols, coverageGaps, recordedLegalDirs,
  repairLockIdentity, resolveRepairLock, RepairLockError, assertRepairBudget,
  buildRepairFeedback, renderRepairPrompt, parseRepairRevision, isPositiveDelta,
  attemptRepair, REPAIR_VERSION, PRODUCTION_OBSERVED_CLASSES,
  declaredExportNames, declaredExportsForMoves, defaultReadFileAtCommit, moveSourcePath,
} from "../../docs/analysis/ownership-active-proposal-repair.mjs";
import { computeSliceDelta, SLICE_DELTA_SURFACE } from "../../docs/analysis/ownership-active-slice-adapter.mjs";
import { runActiveInvestigation } from "../../docs/analysis/ownership-active-loop.mjs";
import { appendRepairAttemptRecord, readRecords, RECORD_KINDS } from "../../docs/analysis/architecture-evidence-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const ANALYSIS = path.join(REPO, "docs", "analysis");
const FIXTURES = path.join(REPO, "plugin", "fixtures", "ownership-active-slice");
const REPAIR_SRC = fs.readFileSync(path.join(ANALYSIS, "ownership-active-proposal-repair.mjs"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const fixtureGraph = (name) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.arch.json`), "utf8")).extensions.tsAnalysis.moduleGraph;
const invalidGraph = () => fixtureGraph("repair-invalid-move-fixture");
const missingConsumerGraph = () => fixtureGraph("repair-missing-consumer-fixture");
const unknownSymbolGraph = () => fixtureGraph("repair-unknown-symbol-fixture");

const COMMIT = "c0ffee0000000000000000000000000000000000";
const SCOPE = "packages/demo/src";

// ── the 11 REAL slice_delta refusals read from the production carrier (2026-10-11) ───────────────
const REAL_REJECTIONS = [
  { reason: "NO_EDGE_EXPLAINED_BY_MOVES", n: 5 },
  { reason: 'MOVE_TO_NOT_AN_INTERNAL_DIR:"model"', n: 1 },
  { reason: 'MOVE_TO_NOT_AN_INTERNAL_DIR:"gate/runtime"', n: 1 },
  { reason: 'MOVE_TO_NOT_AN_INTERNAL_DIR:"gate/core"', n: 1 },
  { reason: 'MOVE_TO_NOT_AN_INTERNAL_DIR:"gate/contract"', n: 1 },
  { reason: "切法覆盖不足：边 gate -> gate/config 的 importedNames=[shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS, resolveRunnerOptions, discoverWorkspaceRoot, loadWorkspaceGates, loadWorkspaceGateMetadata, readGatesConfig, GatesConfig] 中 [shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS, resolveRunnerOptions, GatesConfig] 未被任何 move 的 sy", n: 1 },
  { reason: "切法覆盖不足：边 cli -> gate/config 的 importedNames=[resolveWorkspaceRootOrThrow, resolveRunnerOptions] 中 [resolveRunnerOptions] 未被任何 move 的 symbols 覆盖 —— 目录粒度上无法判断这条边是否随搬迁消失，本原型不猜", n: 1 },
];

/** A carrier record shaped the way `attemptRepair` consumes it. */
const record = (over = {}) => ({
  contract_version: "ownership-active-investigation/1",
  commit: COMMIT,
  concern_key: "package-cycle|a/x.ts",
  hypothesis: "a and b are mutually dependent through core",
  proposed_slice: { scope_root: SCOPE, subject: "a", moves: [{ file: "a/lib.ts", from: "a", to: "nope", symbols: ["helper", "types"] }] },
  slice_delta: { status: "not-evaluated", reason: 'MOVE_TO_NOT_AN_INTERNAL_DIR:"nope"', detail: { valid_dirs: ["", "a", "b", "core"] }, provenance: { ref_commit: COMMIT, scope_root: SCOPE } },
  ...over,
});

const scriptedJudge = (steps) => {
  const prompts = [];
  let i = 0;
  const fn = async (prompt) => { prompts.push(prompt); const s = steps[Math.min(i++, steps.length - 1)]; return { status: 0, stdout: typeof s === "string" ? s : JSON.stringify(s) }; };
  fn.prompts = prompts;
  return fn;
};
const revise = (moves, extra = {}) => ({ action: "revise", moves, why: "revised", ...extra });

// The primitive's report for a cut that computes and whose control is falsifiable (3 -> 2).
const OK_REPORT = {
  status: "evaluated",
  current: { sccSize: 3, sccMembers: ["a", "b", "core"] },
  computedDelta: { sccAfter: ["b", "core"], sccLeft: ["a"], removedEdges: [{ from: "b", to: "a", importedNames: ["helper", "types"], becomes: "intra-directory" }], addedEdges: [] },
  mustNotChange: { violations: [], forbiddenNewEdges: [] },
  negativeControl: { restoreEdges: [{ from: "b", to: "a" }], subjectSccMembersAfterRestore: ["a", "b", "core"], subjectBackInScc: true, falsified: true },
  guards: { clean: true, violations: [] },
  proposedCut: { assumptions: [] },
};
/** Real `computeSliceDelta` over a fixture graph + a scripted CLI report (also a call counter). */
function fixtureComputeDelta(graph, report = OK_REPORT) {
  const fn = ({ commit, proposal }) => computeSliceDelta({ root: "/r", commit, proposal, deps: {
    sliceDelta: { available: true, cli: "/x/cli.js", version: "0.1.39", surface: SLICE_DELTA_SURFACE },
    git: (a) => (a[0] === "rev-parse" ? "tree123\n" : ""),
    analyzePackageGraph: () => ({ file: "", json: { extensions: { tsAnalysis: { moduleGraph: graph } } } }),
    // exit 0 = the primitive computed a delta with a falsified control and no guard violation (exit 1 is a guard-violated cut)
    runCli: (cli, argv) => { fs.writeFileSync(argv[argv.indexOf("--json") + 1], JSON.stringify(typeof report === "function" ? report(proposal) : report)); return { status: 0, stdout: "", stderr: "" }; },
  } });
  fn.calls = [];
  const wrapped = (o) => { fn.calls.push(o.proposal); return fn(o); };
  wrapped.calls = fn.calls;
  return wrapped;
}

// ── AC1: four-class enumeration, fail-closed ────────────────────────────────────────────────────
test("AC1: the four classes are declared, and every one of the 11 REAL production refusals classifies as invalid_move", () => {
  assert.deepEqual([...REJECTION_CLASSES].sort(), ["evidence_gap", "honest_abstain", "invalid_move", "tool_limitation"]);
  assert.deepEqual([...REPAIRABLE_CLASSES].sort(), ["evidence_gap", "invalid_move"]);
  let total = 0;
  for (const { reason, n } of REAL_REJECTIONS) {
    for (let i = 0; i < n; i++) { total++; assert.equal(classifyRejection({ status: "not-evaluated", reason }).class, "invalid_move", reason.slice(0, 40)); }
  }
  assert.equal(total, 11, "the carrier held 11 slice_delta refusals — record the real distribution, not a remembered one");
});

test("AC1: an UNPARSEABLE refusal is fail-closed to honest_abstain — never 'repairable'", () => {
  for (const bad of [{ status: "not-evaluated", reason: "SOMETHING_NOBODY_RECOGNISES" }, { status: "not-evaluated", reason: "" }, { status: "wat" }, {}, null]) {
    const c = classifyRejection(bad);
    assert.equal(c.class, "honest_abstain", JSON.stringify(bad));
    assert.equal(c.is_rejection, true);
    assert.equal(isRepairableRejection(bad), false);
  }
});

test("AC1: a simulated ArchGuard not-evaluated/capability_gap is tool_limitation, NOT a fixable invalid_move", () => {
  const sim = JSON.parse(fs.readFileSync(path.join(FIXTURES, "repair-tool-limitation-fixture.arch.json"), "utf8"))._fixture_rejection;
  const c = classifyRejection(sim);
  assert.equal(c.class, "tool_limitation", JSON.stringify(c));
  assert.equal(c.gap.capability, "archguard.slice_delta");
  // and the surface-level unavailable status is the same class
  assert.equal(classifyRejection({ status: "unavailable", reason: "ARCHGUARD_CLI_NOT_INSTALLED" }).class, "tool_limitation");
  assert.equal(classifyRejection({ status: "not-evaluated", reason: "SLICE_DELTA_SUBCOMMAND_MISSING" }).class, "tool_limitation");
});

test("AC1: evidence_gap is declared, structurally reachable, and honestly marked production-UNSEEN", () => {
  assert.equal(classifyRejection({ status: "not-evaluated", reason: "EVIDENCE_GAP: the consumer set was never read" }).class, "evidence_gap");
  assert.ok(!PRODUCTION_OBSERVED_CLASSES.includes("evidence_gap"), "no real sample exists — do not pretend otherwise");
  assert.ok(PRODUCTION_OBSERVED_CLASSES.includes("invalid_move"));
  assert.ok(PRODUCTION_OBSERVED_CLASSES.includes("tool_limitation"));
});

test("AC1: a computed/evaluated reading is NOT a rejection at all (distinct value, not a class)", () => {
  const c = classifyRejection({ status: "evaluated", delta: { before: { scc_size: 3 }, after: { scc_size: 2 } } });
  assert.equal(c.class, null);
  assert.equal(c.is_rejection, false);
  assert.equal(classifyRejection({ status: "guard-violated", reason: "MUST_NOT_CHANGE_VIOLATED" }).is_rejection, false);
});

// ── AC2: the commit+scope lock ──────────────────────────────────────────────────────────────────
test("AC2: the session is locked to the record's commit+scope; tampering either value throws", () => {
  assert.deepEqual(repairLockIdentity(record()), { commit: COMMIT, scope_root: SCOPE });
  assert.throws(() => resolveRepairLock(record(), { lockedCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }), (e) => e instanceof RepairLockError && e.code === "LOCK_COMMIT_TAMPERED");
  assert.throws(() => resolveRepairLock(record(), { lockedScope: "packages/other" }), (e) => e instanceof RepairLockError && e.code === "LOCK_SCOPE_TAMPERED");
  assert.throws(() => resolveRepairLock({ commit: null, slice_delta: { provenance: {} } }), (e) => e.code === "LOCK_COMMIT_MISSING");
  assert.throws(() => resolveRepairLock({ commit: COMMIT, slice_delta: { provenance: {} } }), (e) => e.code === "LOCK_SCOPE_MISSING");
  assert.deepEqual(resolveRepairLock(record(), { lockedCommit: COMMIT, lockedScope: SCOPE }), { commit: COMMIT, scope_root: SCOPE });
});

test("AC2: a repair revision that tries to change the locked scope throws (thrown, not retried)", async () => {
  const judge = scriptedJudge([revise([{ file: "a/lib.ts", from: "a", to: "b", symbols: ["helper", "types"] }], { scope_root: "packages/elsewhere" })]);
  await assert.rejects(
    attemptRepair({ candidateRecord: record(), root: "/r", invokeJudge: judge, deps: { graph: invalidGraph(), computeDelta: fixtureComputeDelta(invalidGraph()) } }),
    (e) => e instanceof RepairLockError && e.code === "LOCK_SCOPE_TAMPERED",
  );
});

// ── AC3: directory feedback comes from the recorded graph data, never a fresh find/grep ──────────
test("AC3: legal dirs are the RECORDED list verbatim; a non-node directory is never reported legal", () => {
  assert.deepEqual(internalNodeIds(invalidGraph()), ["", "a", "b", "core"]);
  // (i) a directory that exists on disk but is not an internal node of the SNAPSHOT is not legal
  assert.ok(!internalNodeIds(invalidGraph()).includes("scripts"));
  assert.ok(!internalNodeIds(invalidGraph()).includes("packages"));
  // no supplementation: whatever the record lists is what the judge is shown
  const trimmed = record({ slice_delta: { ...record().slice_delta, detail: { valid_dirs: ["a", "b"] } } });
  assert.deepEqual(recordedLegalDirs(trimmed), ["a", "b"]);
  // no recorded list => null (the module does NOT go compute one — it abstains)
  assert.equal(recordedLegalDirs(record({ slice_delta: { status: "not-evaluated", reason: "NO_EDGE_EXPLAINED_BY_MOVES" } })), null);
});

test("AC3: a flat directory is a SINGLE node — never expanded or synthesised into sub-paths", () => {
  const g = { nodes: [{ id: "", type: "internal" }, { id: "gate", type: "internal" }, { id: "gate/config", type: "internal" }], edges: [] };
  const dirs = internalNodeIds(g);
  assert.deepEqual(dirs, ["", "gate", "gate/config"]);
  assert.equal(dirs.filter((d) => d === "gate").length, 1, "a flat dir is one node");
  assert.ok(!dirs.includes("gate/config/loader"), "a sub-path of a node is not implied");
});

test("AC3: a record with NO recorded legal dirs abstains instead of recomputing a list of its own", async () => {
  const rec = record({ slice_delta: { status: "not-evaluated", reason: 'MOVE_TO_NOT_AN_INTERNAL_DIR:"nope"' } });
  const res = await attemptRepair({ candidateRecord: rec, root: "/r", invokeJudge: async () => { throw new Error("judge must not be called"); }, deps: { graph: invalidGraph() } });
  assert.equal(res.outcome, "abstained");
  assert.equal(res.judge_calls, 0);
  assert.equal(res.attempts.at(-1).matched, "NO_RECORDED_LEGAL_DIRS");
});

// ── AC4: negative control ① — tool_limitation makes ZERO judge calls, from both sources ──────────
test("AC4: a tool_limitation refusal (surface unavailable / capability_gap) makes ZERO judge calls", async () => {
  for (const slice_delta of [
    { status: "unavailable", reason: "ARCHGUARD_CLI_NOT_INSTALLED", gap: { capability: "archguard.slice_delta" } },
    JSON.parse(fs.readFileSync(path.join(FIXTURES, "repair-tool-limitation-fixture.arch.json"), "utf8"))._fixture_rejection,
  ]) {
    let called = 0;
    const res = await attemptRepair({ candidateRecord: record({ slice_delta }), root: "/r", invokeJudge: async () => { called++; return { status: 0, stdout: "{}" }; }, deps: { graph: invalidGraph() } });
    assert.equal(called, 0, "a capability boundary cannot be fixed by revising the cut");
    assert.equal(res.outcome, "abstained");
    assert.equal(res.class, "tool_limitation");
    assert.equal(res.judge_calls, 0);
    assert.equal(res.rounds, 0);
  }
});

// ── AC5: the four hard bounds ───────────────────────────────────────────────────────────────────
test("AC5: the four bounds are hardcoded and a caller may only lower them (raising throws)", () => {
  assert.equal(REPAIR_LIMITS.maxRounds, 3);
  assert.equal(REPAIR_LIMITS.maxJudgeCalls, 3);
  assert.equal(REPAIR_LIMITS.maxWallClockMs, 1_800_000);
  assert.equal(REPAIR_LIMITS.maxEvidenceBytesPerRound, 90_000, "reuses the loop's budget magnitude — not widened");
  assert.deepEqual(assertRepairBudget({ maxRounds: 2, maxWallClockMs: 1_000, maxJudgeCalls: 1 }), { maxRounds: 2, maxWallClockMs: 1_000, maxJudgeCalls: 1 });
  assert.throws(() => assertRepairBudget({ maxRounds: 4 }), /REPAIR_BUDGET_OVER_LIMIT/);
  assert.throws(() => assertRepairBudget({ maxWallClockMs: REPAIR_LIMITS.maxWallClockMs + 1 }), /REPAIR_BUDGET_OVER_LIMIT/);
  assert.throws(() => assertRepairBudget({ maxJudgeCalls: 9 }), /REPAIR_BUDGET_OVER_LIMIT/);
});

test("AC5: negative control ② — a judge that repeats the same bad move exhausts the rounds and abstains", async () => {
  const bad = revise([{ file: "a/lib.ts", from: "a", to: "nope", symbols: ["helper", "types"] }]);
  const judge = scriptedJudge([bad]);
  const res = await attemptRepair({ candidateRecord: record(), root: "/r", invokeJudge: judge, deps: { graph: invalidGraph(), computeDelta: fixtureComputeDelta(invalidGraph()) } });
  assert.equal(res.outcome, "abstained");
  assert.equal(res.repaired_delta, null, "no delta passing the negative control was produced");
  assert.equal(res.rounds, 3);
  assert.equal(judge.prompts.length, 3);
  assert.ok(res.attempts.filter((a) => a.judge_called).every((a) => a.bucket === "invalid_move"));
});

test("AC5: the total judge-call bound is its own dimension — never more calls for repeated failure", async () => {
  const bad = revise([{ file: "a/lib.ts", from: "a", to: "nope", symbols: ["helper", "types"] }]);
  const judge = scriptedJudge([bad]);
  const res = await attemptRepair({ candidateRecord: record(), root: "/r", invokeJudge: judge, maxJudgeCalls: 2, deps: { graph: invalidGraph(), computeDelta: fixtureComputeDelta(invalidGraph()) } });
  assert.equal(judge.prompts.length, 2, "the judge is called exactly maxJudgeCalls times");
  assert.equal(res.judge_calls, 2);
  assert.equal(res.outcome, "abstained");
});

test("AC5: the wall-clock bound is its own dimension — a slow session abstains mid-loop", async () => {
  let ms = 0;
  const now = () => ms;
  const judge = async () => { ms += 1_000_000; return { status: 0, stdout: JSON.stringify(revise([{ file: "a/lib.ts", from: "a", to: "nope", symbols: ["helper", "types"] }])) }; };
  const res = await attemptRepair({ candidateRecord: record(), root: "/r", invokeJudge: judge, maxWallClockMs: 500_000, now, deps: { graph: invalidGraph(), computeDelta: fixtureComputeDelta(invalidGraph()) } });
  assert.equal(res.outcome, "abstained");
  assert.match(res.reason, /wall-clock/);
  assert.ok(res.attempts.some((a) => a.matched === "WALL_CLOCK_EXHAUSTED"));
});

test("AC5: the per-round evidence budget is enforced by the prompt renderer, not widened", () => {
  const bigGraph = { nodes: [{ id: "d".repeat(200_000), type: "internal" }], edges: [] };
  const rendered = renderRepairPrompt({ feedback: buildRepairFeedback({ graph: bigGraph, legalDirs: bigGraph.nodes.map((n) => n.id), sliceDelta: { status: "not-evaluated", reason: "NO_EDGE_EXPLAINED_BY_MOVES" }, moves: [], hypothesis: "h", concernKey: "k" }) });
  assert.ok(rendered.bytes <= REPAIR_LIMITS.maxEvidenceBytesPerRound, `${rendered.bytes}`);
  assert.equal(rendered.truncated, true);
});

// ── AC6: negative control ③ — a missing consumer is not success ─────────────────────────────────
test("AC6: a cut that computes but leaves a partially-covered consumer is NOT counted as success", async () => {
  const graph = missingConsumerGraph();
  // the judge keeps returning the move that covers b->a fully but leaves c->a's `other` dangling
  const judge = scriptedJudge([revise([{ file: "a/lib.ts", from: "a", to: "b", symbols: ["helper", "types"] }])]);
  const delta = fixtureComputeDelta(graph);         // the primitive's own coverage rule is satisfied: it computes
  const res = await attemptRepair({ candidateRecord: record(), root: "/r", invokeJudge: judge, deps: { graph, computeDelta: delta } });
  assert.ok(delta.calls.length > 0, "the primitive WAS reached — the trap is 'formally computes'");
  assert.equal(res.outcome, "abstained");
  assert.equal(res.repaired_delta, null);
  assert.ok(res.attempts.some((a) => a.matched === "MISSING_CONSUMER"), JSON.stringify(res.attempts));
  assert.deepEqual(coverageGaps(graph, [{ from: "a", to: "b", symbols: ["helper", "types"] }]).map((g) => g.edge), ["c -> a"]);
});

// ── AC7: negative control ④ — a fabricated symbol must not produce a computed delta ─────────────
test("AC7: a revision naming a symbol the graph does not contain is invalid — no delta is computed for it", async () => {
  const graph = unknownSymbolGraph();
  assert.ok(!graphSymbols(graph).has("ghostSymbol"));
  assert.deepEqual(unknownSymbols(graph, [{ from: "a", to: "b", symbols: ["helper", "ghostSymbol"] }]), ["ghostSymbol"]);
  const judge = scriptedJudge([revise([{ file: "a/lib.ts", from: "a", to: "b", symbols: ["ghostSymbol"] }])]);
  const delta = fixtureComputeDelta(graph);      // would compute, but must never be reached for a fabricated symbol
  const res = await attemptRepair({ candidateRecord: record(), root: "/r", invokeJudge: judge, deps: { graph, computeDelta: delta } });
  assert.equal(delta.calls.length, 0, "'not in the graph' is not 'in the graph but uncovered' — the primitive is never called");
  assert.equal(res.outcome, "abstained");
  assert.equal(res.repaired_delta, null);
  assert.ok(res.attempts.some((a) => a.bucket === "unknown_symbol" && a.computed === false));
});

// ── AC8: anti-cheat — no hardcoded answer, no forbidden source ───────────────────────────────────
test("AC8: the module hardcodes no four-cycle answer and imports no goal/doc/holdout/gate machinery", () => {
  const code = stripComments(REPAIR_SRC);
  for (const lit of ["gate/config", "gate/runtime", "gate/contract", "ff-merge", "probeInstruments", "shQuote", "DEFAULT_ACCEPTANCE_TIMEOUT_MS", "quay-domain-model"]) {
    assert.ok(!code.includes(lit), `module source must not contain the answer literal ${lit}`);
  }
  for (const forbidden of ["fileProposals", "driveItems", "fileDecisions", "proposeDraftGoal", "evaluateEntryBar", "deterministicGate", "quotaGate", "runStreak"]) {
    assert.ok(!code.includes(forbidden), `module must not touch ${forbidden}`);
  }
  assert.doesNotMatch(code, /GOAL-0/);
  assert.doesNotMatch(code, /Holdout/i);
  assert.doesNotMatch(code, /child_process/);
  // no independent directory enumeration: the module never shells out or walks the tree
  assert.ok(!/\bfs\b/.test(code), "no fs — the module reads no file of its own");
});

test("AC8: the repair_attempt record type exists in the evidence store and validates fail-closed", () => {
  assert.ok(RECORD_KINDS.includes("repair_attempt"));
  const base = { tool: "ownership-active-proposal-repair", ref: COMMIT, ts: "2026-10-11T00:00:00Z", sha256: "a".repeat(64), attempt_no: 1, bucket: "invalid_move", locked_commit: COMMIT, locked_scope: SCOPE, original_hypothesis: "h", elapsed_ms: 5 };
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "repair-store-"));
  assert.equal(appendRepairAttemptRecord(dir, base).ok, true);
  assert.equal(appendRepairAttemptRecord(dir, { ...base, bucket: "" }).ok, false);
  assert.equal(appendRepairAttemptRecord(dir, { ...base, locked_scope: undefined }).ok, false);
  assert.equal(readRecords(path.join(dir, ".quay", "architecture-evidence-store.jsonl")).records.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── AC9: the reproducible blind success path ─────────────────────────────────────────────────────
test("AC9: a deterministic fixable invalid_move is repaired within 3 rounds (fixture, no real judge)", async () => {
  const graph = invalidGraph();
  const judge = scriptedJudge([
    revise([{ file: "a/lib.ts", from: "a", to: "b", symbols: ["helper", "types"] }], { why: "move the two names into b" }),
  ]);
  const res = await attemptRepair({ candidateRecord: record(), root: "/r", invokeJudge: judge, deps: { graph, computeDelta: fixtureComputeDelta(graph) } });
  assert.equal(res.outcome, "repaired", JSON.stringify(res.attempts));
  assert.equal(res.class, null);
  assert.ok(res.rounds <= 3);
  assert.ok(isPositiveDelta(res.repaired_delta));
  assert.equal(res.repaired_delta.delta.after.scc_size < res.repaired_delta.delta.before.scc_size, true);
  assert.equal(res.repaired_delta.negative_control.falsified, true);
  // the feedback the judge saw carried the recorded legal dirs (from the graph) and the graph's known symbols
  assert.match(judge.prompts[0], /legal_dirs/);
  assert.match(judge.prompts[0], /helper/);
});

// ── AC2/AC3 (gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal): PRODUCTION-SHAPE regression ──
// The pre-fix production reading (carrier `.quay/ownership-shadow-proposals.jsonl`, record 91, run_id
// `live:2026-10-11T09-28-34-622Z:1`): ArchGuard refused the real cut (`切法覆盖不足`, exit 2) and the adapter
// returned WITHOUT the legal-dir list, so the repair abstained at attempt 0 (NO_RECORDED_LEGAL_DIRS, judge
// called 0 times) — for the only rejection class that ever reaches the primitive. Nothing below injects a
// legal-dir list: the record is the one the FIXED adapter actually produces from the vendored graph.
// (A count of the detail-key token over this file must stay 3 — the three PRE-EXISTING hand-injection sites.
// This test adds none, and that is the point: a criterion only a fixture can satisfy is not a measurement.)
const LIVE_FIXTURE = path.join(FIXTURES, "live-ec00fcc00-coverage-gap.json");
const LIVE_FIXTURE_SHA256 = "68e93d1a516e581212dd6843e0297da39a8162863b0670b09897ad86a424f50c";
// The carrier's own `slice_delta.provenance.graph_sha256` — the cross-check that the vendored graph IS the graph
// the production run was judged against (not merely one rebuilt from the same commit).
const LIVE_GRAPH_SHA256 = "a3946f0828a93ecba114457e1c0586ee17718cc9efa3e910ae3a46829158c9a2";
const LIVE_COMMIT = "ec00fcc00da73c8f8e7f64a6d69bd734285a02b2";
const LIVE_TREE_SHA = "20898960d55309de503c474aec960ba2567f1dd8";
// Verbatim from the carrier (the recorded reason is clipped to 300 chars by the recorder — quoted as stored).
const LIVE_REASON = "切法覆盖不足：边  -> gate 的 importedNames=[listGates, appendGateEvent, queryGateEvents, runAcceptance, resolveAcceptanceTimeout, timeoutKnobHint, verdictFromAcceptance, runGate, resolveGateLogPath, runGateLogQuery, runComplete, runAdjudicate, runPromote, runRetreat, runCompleteOutOfBand] 中 [listGates, appen";
const LIVE_PROPOSED_SLICE = {
  scope_root: "packages/quay/src", subject: "gate/config",
  moves: [
    { file: "gate/types.ts", from: "gate", to: "kernel", symbols: ["GateFn", "GateVerdict", "GateDefinition", "GateVerdictKind"] },
    { file: "gate/acceptance-runner.ts", from: "gate", to: "kernel", symbols: ["runAcceptance", "verdictFromAcceptance", "resolveAcceptanceTimeout", "AcceptanceResult", "AcceptanceVerdict", "NotEvaluatedCause"] },
    { file: "gate/config/loader.ts", from: "gate/config", to: "gate", symbols: ["loadWorkspaceGates", "loadWorkspaceGateMetadata", "readGatesConfig", "discoverWorkspaceRoot", "resolveWorkspaceRootOrThrow", "GatesConfig"] },
  ],
  consumers: [
    { file: "gate/registry.ts", dir: "gate", imports: ["loadWorkspaceGates", "loadWorkspaceGateMetadata", "discoverWorkspaceRoot"] },
    { file: "gate/factories/index.ts", dir: "gate/factories", imports: ["GateFn"] },
    { file: "gate/factories/adr.ts", dir: "gate/factories", imports: ["runAcceptance", "GateFn"] },
    { file: "gate/factories/goal.ts", dir: "gate/factories", imports: ["runAcceptance", "verdictFromAcceptance", "GateFn"] },
  ],
  forbidden_new_edges: [{ from: "gate/config", to: "gate" }, { from: "kernel", to: "gate" }, { from: "kernel", to: "gate/factories" }],
};
const liveArchJson = () => JSON.parse(fs.readFileSync(LIVE_FIXTURE, "utf8"));
const liveGraph = () => liveArchJson().extensions.tsAnalysis.moduleGraph;
const LIVE_PROPOSAL = { concern: "the gate cycle", slice: LIVE_PROPOSED_SLICE };
/** The REAL adapter over the vendored graph, with a stub CLI reproducing the published 0.1.39 refusal. */
const liveComputeDelta = (report = { status: "not-evaluated", reason: LIVE_REASON }) => {
  const fn = ({ commit, proposal }) => computeSliceDelta({ root: "/r", commit, proposal, deps: {
    sliceDelta: { available: true, cli: "/x/cli.js", version: "0.1.39", surface: SLICE_DELTA_SURFACE },
    git: (a) => (a[0] === "rev-parse" ? `${LIVE_TREE_SHA}\n` : ""),
    analyzePackageGraph: () => ({ file: LIVE_FIXTURE, json: liveArchJson() }),
    runCli: (cli, argv) => { fs.writeFileSync(argv[argv.indexOf("--json") + 1], JSON.stringify(typeof report === "function" ? report(proposal) : report)); return { status: 2, stdout: "", stderr: "" }; },
  } });
  fn.calls = [];
  const wrapped = (o) => { fn.calls.push(o.proposal); return fn(o); };
  wrapped.calls = fn.calls;
  return wrapped;
};
/** A revision whose whole imported-name set is covered, so the cut is re-JUDGED by the primitive (and refused). */
const LIVE_REVISE = revise([{ file: "gate/registry.ts", from: "gate", to: "kernel", symbols: ["GateFn", "runAcceptance", "verdictFromAcceptance"] }], { why: "move the three names the cut explains into kernel" });

test("AC2: the ARCHGUARD-ORIGIN refusal now engages the repair — production record, production graph, nothing injected", async () => {
  // The fixture IS the production graph: file bytes are the committed ones, and the graph hash matches the
  // carrier's own recorded `graph_sha256` (so the replay cannot silently drift onto a different snapshot).
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(LIVE_FIXTURE)).digest("hex"), LIVE_FIXTURE_SHA256);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(liveGraph())).digest("hex"), LIVE_GRAPH_SHA256);
  assert.deepEqual(liveGraph().cycles.map((c) => c.modules), [["gate/config", "gate/factories", "gate", ""]]);

  // ① re-judge the REAL proposed_slice against the REAL graph — the stub CLI refuses exactly as 0.1.39 did.
  const refused = liveComputeDelta()({ commit: LIVE_COMMIT, proposal: LIVE_PROPOSAL });
  assert.equal(refused.status, "not-evaluated");
  assert.equal(refused.reason, LIVE_REASON);
  assert.equal(refused.stays_declared.length, 1, "the declared `stays` went out");
  assert.deepEqual(recordedLegalDirs({ slice_delta: refused }), ["", "cli", "fan-in", "gate", "gate/config", "gate/factories", "kernel", "ts-demo"]);

  const carrier = { contract_version: "ownership-active-investigation/1", commit: LIVE_COMMIT, concern_key: "package-cycle|gate/config", envelope: { concern: "the gate 4-package cycle" }, proposed_slice: LIVE_PROPOSED_SLICE, slice_delta: refused };

  // ② CONTROL (硬规则 4 推论四): re-creating the PRE-FIX branch — the SAME record with the list dropped —
  // abstains at attempt 0 with zero judge calls. If the fix did nothing, this is what the test above would see.
  const preFix = { ...carrier, slice_delta: { ...refused, detail: null } };
  assert.equal(recordedLegalDirs(preFix), null);
  const dead = await attemptRepair({ candidateRecord: preFix, root: "/r", invokeJudge: async () => { throw new Error("judge must not be called"); }, deps: { graph: liveGraph(), computeDelta: liveComputeDelta() } });
  assert.equal(dead.outcome, "abstained");
  assert.equal(dead.judge_calls, 0);
  assert.equal(dead.attempts.at(-1).matched, "NO_RECORDED_LEGAL_DIRS");

  // ③ THE FIX: the untouched record the fixed adapter produced → the repair ENGAGES. The primitive refuses every
  // revision, so the session ends by exhausting its bound (not by abstaining before it ever started).
  const judge = scriptedJudge([LIVE_REVISE]);
  const delta = liveComputeDelta();
  const res = await attemptRepair({ candidateRecord: carrier, root: "/r", invokeJudge: judge, deps: { graph: liveGraph(), computeDelta: delta } });
  assert.ok(!res.attempts.some((a) => a.matched === "NO_RECORDED_LEGAL_DIRS"), `abstained at attempt 0 despite a recorded list: ${JSON.stringify(res.attempts)}`);
  assert.equal(res.attempts[0].judge_called, true);
  assert.equal(res.attempts[0].attempt_no, 1);
  assert.equal(res.judge_calls, 3, "the bound is what ends it — every round reached the judge");
  assert.equal(delta.calls.length, 3, "and every round re-ran the primitive");
  // Every engaged round is a genuine re-judgement of a revised cut against the primitive (the same
  // `invalid_move` class as production). The graph-derived missing-consumer guard fires on the ` -> gate` edge
  // before the tool's own coverage text is reached, so `MISSING_CONSUMER` — not the raw tool reason — is the
  // recorded `matched`; the bucket is what the loop keys on, and it is `invalid_move` throughout.
  assert.ok(res.attempts.filter((a) => a.judge_called).every((a) => a.bucket === "invalid_move" && a.computed === "not-evaluated"), JSON.stringify(res.attempts));
  assert.equal(res.outcome, "abstained");
  assert.match(res.reason, /budget exhausted/);
  // the feedback the judge was shown carried the graph's OWN legal dirs — including the two the production cut
  // named as move destinations (`kernel`, `gate`), which is exactly what the pre-fix branch could never supply.
  const shown = JSON.parse(judge.prompts[0].slice(judge.prompts[0].indexOf("{", judge.prompts[0].indexOf("STRUCTURAL FACTS"))));
  assert.deepEqual(shown.legal_dirs, ["", "cli", "fan-in", "gate", "gate/config", "gate/factories", "kernel", "ts-demo"]);
  assert.equal(shown.locked.subject, "gate/config");
});

// ── gap-ownership-active-repair-unknown-symbol-guard-false-positive (2026-10-11) ─────────────────
// SYMBOL EXISTENCE IS A DIRECT QUANTITY (硬规则 4b). The guard used to ask "does a directory edge import
// it?" — a PROXY that reads `false` for every real export no OTHER directory imports yet, so 6/16 genuine
// symbols of the live candidate were recorded as FABRICATED and every repair round was voided. The
// criterion is now the union of the two quantities that can each be read directly: the graph edges'
// `importedNames` ∪ the DECLARED EXPORTS of the move's own file AT THE LOCKED COMMIT (`git show`, so an
// uncommitted working-tree edit is invisible). Nothing below injects a symbol list; the second source is
// the real repository at `ec00fcc00`, read by the module's own production default reader.
const liveReader = (spec) => defaultReadFileAtCommit(REPO, spec);
const liveSymbolOpts = { scopeRoot: "packages/quay/src", commit: LIVE_COMMIT, readFileAtCommit: liveReader };
const LIVE_MOVE_SYMBOLS = LIVE_PROPOSED_SLICE.moves.flatMap((m) => m.symbols);
const LIVE_FALSE_POSITIVES = ["AcceptanceResult", "AcceptanceVerdict", "GateDefinition", "GateVerdict", "GateVerdictKind", "NotEvaluatedCause"];

test("AC1: existence = graph edges ∪ the move's own file exports at the LOCKED commit — parsed, never guessed", () => {
  // (a) the export parser reads the declaration forms AND the multi-line export-list (re-export) form
  const typesAtCommit = liveReader(`${LIVE_COMMIT}:packages/quay/src/gate/types.ts`);
  const loaderAtCommit = liveReader(`${LIVE_COMMIT}:packages/quay/src/gate/config/loader.ts`);
  assert.equal(typeof typesAtCommit, "string", "the production default reader must read a committed blob");
  assert.equal(typeof loaderAtCommit, "string");
  for (const n of ["GateVerdict", "GateDefinition", "GateVerdictKind", "GateFn"]) assert.ok(declaredExportNames(typesAtCommit).has(n), n);
  assert.ok(declaredExportNames(loaderAtCommit).has("GatesConfig"), "the multi-line `export type { … }` re-export form counts");
  assert.ok(declaredExportNames("export const a = 1;\nexport async function b() {}\nexport { a as c, b };\nexport class D {}").has("c"));
  // (b) a name that occurs only in a COMMENT is not an export — judge the code, not the prose (硬规则 2)
  assert.ok(!declaredExportNames("// export type NotReal = 1;").has("NotReal"));
  assert.ok(!declaredExportNames("/* export const AlsoNotReal = 1; */").has("AlsoNotReal"));
  // (c) the file is read scope-root-relative and cannot escape the scope
  assert.equal(moveSourcePath("packages/quay/src", "gate/types.ts"), "packages/quay/src/gate/types.ts");
  for (const bad of ["../../etc/passwd", "/etc/passwd", ""]) assert.equal(moveSourcePath("packages/quay/src", bad), null, JSON.stringify(bad));
  // (d) an unreadable blob proves NOTHING — `null`, never "the file exports everything" (硬规则 3b)
  assert.equal(defaultReadFileAtCommit(REPO, `${LIVE_COMMIT}:packages/quay/src/gate/nope.ts`), null);
  assert.equal(defaultReadFileAtCommit("/nonexistent-root-for-ac1", `${LIVE_COMMIT}:packages/quay/src/gate/types.ts`), null);
  assert.deepEqual(unknownSymbols(liveGraph(), [{ file: "gate/nope.ts", from: "gate", to: "kernel", symbols: ["ghost"] }], liveSymbolOpts), ["ghost"]);
});

test("AC2: PRODUCTION SHAPE — the live candidate's 6 false positives disappear; all 16 symbols are accounted for", () => {
  assert.equal(LIVE_MOVE_SYMBOLS.length, 16, "the carrier's cut moved 16 symbols");
  // CONTROL (硬规则 4 推论四): with the SECOND source switched off, the SAME call reproduces the defect
  // exactly. If the fix did nothing, this is what the fixed call would have returned.
  assert.deepEqual(unknownSymbols(liveGraph(), LIVE_PROPOSED_SLICE.moves), LIVE_FALSE_POSITIVES);
  // THE FIX: every one of the 16 is accounted for — the 6 real exports of `gate/types.ts` /
  // `gate/acceptance-runner.ts` at `ec00fcc00` are proved by the file they are declared in.
  assert.deepEqual(unknownSymbols(liveGraph(), LIVE_PROPOSED_SLICE.moves, liveSymbolOpts), []);

  // …and the JUDGE is shown the same two-source notion of "known": the prompt must not tell the judge that
  // a real export "the graph does not know" is not a fix (that is the same mislabelling one layer up).
  const declaredUnion = [...declaredExportsForMoves(LIVE_PROPOSED_SLICE.moves, liveSymbolOpts).values()].flatMap((s) => [...s]);
  const fb = buildRepairFeedback({ graph: liveGraph(), legalDirs: ["gate"], sliceDelta: { status: "not-evaluated", reason: "NO_EDGE_EXPLAINED_BY_MOVES" }, moves: LIVE_PROPOSED_SLICE.moves, hypothesis: "h", concernKey: "k", declaredSymbols: declaredUnion });
  for (const n of LIVE_FALSE_POSITIVES) assert.ok(fb.known_symbols.includes(n), `the judge must not be told a real export is unknown: ${n}`);
});

test("AC3: NEGATIVE CONTROL — the guard still has teeth: a fabricated name and a near-miss spelling void the round", async () => {
  const fabricated = LIVE_PROPOSED_SLICE.moves.map((m, i) => (i === 2 ? { ...m, symbols: [...m.symbols, "fabricatedLoaderFn", "loadWorkspaceGatez"] } : m));
  assert.deepEqual(unknownSymbols(liveGraph(), fabricated, liveSymbolOpts), ["fabricatedLoaderFn", "loadWorkspaceGatez"], "exactly the two — no more, no fewer");
  const refused = liveComputeDelta()({ commit: LIVE_COMMIT, proposal: LIVE_PROPOSAL });
  const carrier = { contract_version: "ownership-active-investigation/1", commit: LIVE_COMMIT, concern_key: "package-cycle|gate/config", envelope: { concern: "the gate 4-package cycle" }, proposed_slice: LIVE_PROPOSED_SLICE, slice_delta: refused };
  const judge = scriptedJudge([{ action: "revise", moves: fabricated, why: "move everything into kernel" }]);
  const delta = liveComputeDelta();
  // root = REPO and NO injected reader: this drives the module's own production default (a commit-scoped git show).
  const res = await attemptRepair({ candidateRecord: carrier, root: REPO, invokeJudge: judge, deps: { graph: liveGraph(), computeDelta: delta } });
  assert.equal(delta.calls.length, 0, "an unaccounted symbol must never reach the primitive");
  assert.equal(res.outcome, "abstained");
  assert.equal(res.repaired_delta, null);
  assert.equal(res.judge_calls, 3);
  assert.ok(res.attempts.filter((a) => a.judge_called).every((a) => a.bucket === "unknown_symbol" && a.matched === "UNKNOWN_SYMBOL" && a.computed === false), JSON.stringify(res.attempts));
  assert.deepEqual(res.attempts.find((a) => a.judge_called).unknown_symbols, ["fabricatedLoaderFn", "loadWorkspaceGatez"]);
});

test("AC4: NEGATIVE CONTROL — an UNCOMMITTED working-tree export is not evidence; only the locked commit counts", () => {
  // ⛔ The mutation deliberately targets a DISPOSABLE repo under os.tmpdir, never a tracked file: `scripts/
  // test.sh`'s `checked-in-write-check` refuses any test that writes into the checked-in tree, and it is
  // right to — a test that mutates a tracked source file is a machine for flaking its neighbours. Restoring
  // is `rmSync` of the whole repo, which is strictly stronger than a cp backup (nothing to restore).
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "ac4-commit-scope-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" });
    const rel = "packages/demo/src/gate/types.ts";
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "export interface CommittedThing {}\n");
    git("init", "-q"); git("add", "-A"); git("commit", "-q", "-m", "seed");
    const commit = git("rev-parse", "HEAD").trim();
    const reader = (spec) => defaultReadFileAtCommit(dir, spec);   // the module's own production default
    assert.ok(declaredExportNames(reader(`${commit}:${rel}`)).has("CommittedThing"), "a committed export must be proved");

    // The UNCOMMITTED append: present in the working tree, absent from the commit.
    fs.appendFileSync(path.join(dir, rel), "export type UncommittedProbe = true;\n");
    // CONTROL (硬规则 4 推论四): the append really landed — the WORKING TREE text carries the export, so the
    // assertions below are not vacuous…
    assert.ok(declaredExportNames(fs.readFileSync(path.join(dir, rel), "utf8")).has("UncommittedProbe"), "the append did not land — the assertion below would be vacuous");
    // …the commit-scoped read does NOT see it…
    assert.ok(!declaredExportNames(reader(`${commit}:${rel}`)).has("UncommittedProbe"), "the reader must read the COMMIT, not the working tree");
    // …so the criterion proves the committed name and reports the uncommitted one unknown — the two are
    // distinguished by the ONE thing that differs between them: whether the locked commit exports them.
    const graph = { nodes: [{ id: "gate", type: "internal" }], edges: [] };
    const opts = { scopeRoot: "packages/demo/src", commit, readFileAtCommit: reader };
    assert.deepEqual(unknownSymbols(graph, [{ file: "gate/types.ts", from: "gate", to: "kernel", symbols: ["CommittedThing", "UncommittedProbe"] }], opts), ["UncommittedProbe"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC3: fail-closed — a graph that was never built stays listless, and the repair still abstains at attempt 0", async () => {
  for (const [name, reason, analyzePackageGraph] of [
    ["analyzePackageGraph throws", /^PACKAGE_GRAPH_BUILD_FAILED/, () => { throw new Error("archguard analyze failed"); }],
    ["analyzePackageGraph returns null", /^ARCHGUARD_CLI_NOT_FOUND$/, () => null],
    ["the ArchJSON carries no module graph", /^NO_MODULE_GRAPH_IN_ARCHJSON$/, () => ({ file: "", json: { extensions: {} } })],
  ]) {
    const r = computeSliceDelta({ root: "/r", commit: LIVE_COMMIT, proposal: LIVE_PROPOSAL, deps: {
      sliceDelta: { available: true, cli: "/x/cli.js", version: "0.1.39", surface: SLICE_DELTA_SURFACE },
      git: (a) => (a[0] === "rev-parse" ? `${LIVE_TREE_SHA}\n` : ""),
      analyzePackageGraph,
      runCli: () => { throw new Error("the primitive must not be reached"); },
    } });
    assert.match(r.reason, reason);
    // (a) the fix does NOT turn "there really is no graph" into "here is a list anyway" (硬规则 3b).
    assert.equal("detail" in r, false, `${name}: no list may be invented for a graph that was never built`);
    assert.equal(recordedLegalDirs({ slice_delta: r }), null, name);
    // (b) and the repair still does not start: zero judge calls, zero rounds. These three reasons classify as
    // `tool_limitation` (a capability boundary), so the session terminates by CLASSIFICATION at attempt 0 —
    // the same terminal outcome the pre-existing NO_RECORDED_LEGAL_DIRS test covers for a repairable class.
    let called = 0;
    const res = await attemptRepair({ candidateRecord: { contract_version: "ownership-active-investigation/1", commit: LIVE_COMMIT, concern_key: "package-cycle|gate/config", envelope: { concern: "the gate 4-package cycle" }, proposed_slice: LIVE_PROPOSED_SLICE, slice_delta: r }, root: "/r", invokeJudge: async () => { called++; return { status: 0, stdout: "{}" }; }, deps: { graph: liveGraph() } });
    assert.equal(called, 0, name);
    assert.equal(res.outcome, "abstained", name);
    assert.equal(res.judge_calls, 0, name);
    assert.equal(res.rounds, 0, name);
    assert.equal(res.class, "tool_limitation", name);
    assert.equal(res.attempts[0].bucket, "tool_limitation", name);
  }
});

// ── integration: the loop records the structured cut + the refusal detail (opt-in repair plumbing) ─
test("integration: the loop records proposed_slice + slice_delta.detail so a repair can lock the same scope", async () => {
  const ex = { commit: () => COMMIT, execute: () => { throw new Error("no evidence"); } };
  const judge = scriptedJudge([{
    action: "propose_slice", hypothesis: "a and b are mutually dependent through core", sufficient: true, why: "the cycle is visible",
    proposal: {
      concern_kind: "package-cycle", concern: "A dependency cycle ties a and b through core", evidence_refs: ["ev-0"],
      candidate_interventions: [{ title: "move the two names", rationale: "b is lower" }],
      scope: { in_scope: ["a/lib.ts"], non_goals: ["the gate packages"] },
      negative_control: "re-add the edge and the cycle must return", abandon_or_reconsider_condition: "another member still points into a",
      confidence: { level: "medium", basis: "the cycle is in the graph" },
      slice: { scope_root: SCOPE, subject: "a", moves: [{ file: "a/lib.ts", from: "a", to: "nope", symbols: ["helper", "types"] }] },
    },
  }]);
  const res = await runActiveInvestigation({
    root: "/r", invokeJudge: judge, label: "test",
    deps: { executor: ex, git: () => "", sliceDeps: {
      sliceDelta: { available: true, cli: "/x/cli.js", version: "0.1.39", surface: SLICE_DELTA_SURFACE },
      git: (a) => (a[0] === "rev-parse" ? "tree123\n" : ""),
      analyzePackageGraph: () => ({ file: "", json: { extensions: { tsAnalysis: { moduleGraph: invalidGraph() } } } }),
    } },
  });
  assert.deepEqual(res.proposed_slice.moves[0].to, "nope");
  assert.equal(res.slice_delta.status, "not-evaluated");
  assert.equal(res.slice_delta.reason, 'MOVE_TO_NOT_AN_INTERNAL_DIR:"nope"');
  assert.deepEqual(res.slice_delta.detail.valid_dirs, ["", "a", "b", "core"]);
  // ...and that record feeds the repair directly
  assert.equal(isRepairableRejection(res.slice_delta), true);
  assert.deepEqual(recordedLegalDirs({ slice_delta: res.slice_delta }), ["", "a", "b", "core"]);
  assert.equal(REPAIR_VERSION, "ownership-active-proposal-repair/1");
});

// ── parse + positive-delta helpers ───────────────────────────────────────────────────────────────
test("parseRepairRevision is fail-closed and accepts a fenced revision", () => {
  assert.equal(parseRepairRevision(""), null);
  assert.equal(parseRepairRevision("no json here"), null);
  assert.equal(parseRepairRevision('{"action":"revise"}'), null, "moves are required");
  assert.equal(parseRepairRevision('{"action":"nope","moves":[]}'), null);
  const ok = parseRepairRevision('Sure:\n```json\n{"action":"revise","moves":[{"file":"a/lib.ts","from":"a","to":"b","symbols":["helper"]}],"why":"x"}\n```');
  assert.equal(ok.action, "revise");
  assert.equal(ok.moves.length, 1);
  assert.equal(parseRepairRevision('{"action":"abstain","why":"cannot"}').action, "abstain");
});
