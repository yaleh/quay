// @test-group engine
// Tests for ownership-active LIMITED PROPOSAL MODE (task gap-ownership-active-limited-proposal-mode) —
// phase C of the end-to-end architecture self-bootstrap: ONE independent call site that may turn ONE
// already-qualified carrier record into exactly ONE `draft` Goal (never activating it).
//
// No model, no network, no ArchGuard: the entry bar is pure, and the write is exercised against a REAL
// goal store in a temp dir (so AC4's read-back is a real store read, not a fixture echo).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGoalStore } from "../../packages/quay/src/goal-store.ts";
import {
  ENTRY_BAR_STREAK, CONDITIONS, APPROVAL_REQUIRED_LINE,
  evaluateEntryBar, deriveConcernKind, deltaEvidence, decisionMemoryStatus, isProductionRun,
  deltaFingerprint, groupByCandidate, nextGoalId, nextAcId, buildDraftGoal, proposeDraftGoal,
  createGoalStoreWrite,
} from "../../docs/analysis/ownership-active-limited-proposal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MODULE_REL = "docs/analysis/ownership-active-limited-proposal.mjs";

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "limited-proposal-test-")); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────
const goodDelta = () => ({
  status: "evaluated",
  delta: {
    before: { scc_size: 6, members: ["", "cli", "fan-in", "gate", "gate/config", "gate/factories"] },
    after: { scc_size: 4, members: ["", "gate", "gate/config", "gate/factories"] },
    left: ["cli", "fan-in"],
    removed_edges: [{ from: "cli", to: "fan-in", names: ["probeInstruments"] }],
    added_edges: [],
  },
  negative_control: { falsified: true, restore_edges: [{ from: "cli", to: "fan-in" }], members_after_restore: ["", "cli", "fan-in", "gate", "gate/config", "gate/factories"] },
  provenance: { provenance_consistency: { status: "match" } },
});

const rec = (over = {}) => ({
  run_id: "live:1", label: "live", commit: "abc1234567890def", ts_iso: "2026-10-11T00:00:00Z",
  concern_kind: "package-cycle",
  slice_delta: goodDelta(),
  decision_memory: { status: "not-known" },
  envelope: { evidence_refs: ["ev-1", "ev-2"], expected_mechanical_delta: "ArchGuard slice-delta (computed): cycle size 6 -> 4" },
  evidence: [{ id: "ev-1" }, { id: "ev-2" }],
  subject_files: ["packages/quay/src/cli/driver.ts", "packages/quay/src/cli/driver-vocab.ts"],
  ...over,
});

// ── AC1: the four entry-bar counterexamples each refuse with a CONDITION-SPECIFIC reason ───────────
test("AC1: kind ≠ package-cycle is refused, and the reason names the kind", () => {
  const v = evaluateEntryBar([rec({ concern_kind: "duplicate", slice_delta: null })]);
  assert.equal(v.eligible, false);
  assert.ok(v.reason.startsWith("CONDITION_1_NOT_MET"), v.reason);
  assert.match(v.reason, /concern_kind=duplicate/);
});

test("AC1: a delta the primitive did NOT compute is refused, and the reason names the primitive's status", () => {
  const sd = { ...goodDelta(), status: "not-evaluated", delta: null, reason: 'MOVE_TO_NOT_AN_INTERNAL_DIR:"gate/core"', negative_control: null };
  const v = evaluateEntryBar([rec({ slice_delta: sd })]);
  assert.equal(v.eligible, false);
  assert.ok(v.reason.startsWith("CONDITION_2_NOT_MET"), v.reason);
  assert.match(v.reason, /not computed/);
  assert.match(v.reason, /MOVE_TO_NOT_AN_INTERNAL_DIR/);
});

test("AC1: provenanceConsistency ≠ match is refused, and the reason names the observed status", () => {
  const sd = goodDelta();
  sd.provenance = { provenance_consistency: { status: "mismatch" } };
  const v = evaluateEntryBar([rec({ slice_delta: sd })]);
  assert.equal(v.eligible, false);
  assert.ok(v.reason.startsWith("CONDITION_2_NOT_MET"), v.reason);
  assert.match(v.reason, /provenanceConsistency=mismatch/);
});

test("AC1: a computed delta whose negative control did NOT falsify is refused (a different C2 reason)", () => {
  const sd = goodDelta();
  sd.negative_control = { falsified: false, restore_edges: [] };
  const v = evaluateEntryBar([rec({ slice_delta: sd })]);
  assert.equal(v.eligible, false);
  assert.ok(v.reason.startsWith("CONDITION_2_NOT_MET"), v.reason);
  assert.match(v.reason, /negative control is not falsified/);
});

test("AC1: a decision-memory hit (exempted OR known-not-yet-filed) is refused, and the reason names the entry", () => {
  for (const [status, id] of [["exempted", "dm-001-github-client-status-literals"], ["known-not-yet-filed", "dm-002-flipgoal-disposeold-statuslog"]]) {
    const v = evaluateEntryBar([rec({ decision_memory: { status, matched_entry: { id } } })]);
    assert.equal(v.eligible, false, status);
    assert.ok(v.reason.startsWith("CONDITION_3_NOT_MET"), v.reason);
    assert.match(v.reason, new RegExp(`decision_memory=${status}`));
    assert.match(v.reason, new RegExp(id));
  }
});

test("AC1: run-streak < 3 is refused, and the reason states the streak and the requirement", () => {
  const one = evaluateEntryBar([rec({ run_id: "live:1" })]);
  assert.equal(one.eligible, false);
  assert.ok(one.reason.startsWith("CONDITION_4_NOT_MET"), one.reason);
  assert.match(one.reason, new RegExp(`run_streak=1/${ENTRY_BAR_STREAK}`));

  // 3 qualifying runs with a REPLAY interleaved: the replay is not a production run — it is skipped, so the
  // two production runs still count as 2 consecutive (2 < 3), not 0 and not 3.
  const withReplay = evaluateEntryBar([rec({ run_id: "live:1" }), rec({ run_id: "replay:GOAL-033:B", label: "replay:GOAL-033:B" }), rec({ run_id: "live:3" })]);
  assert.equal(withReplay.eligible, false);
  assert.match(withReplay.reason, new RegExp(`run_streak=2/${ENTRY_BAR_STREAK}`));

  // 3 qualifying runs with DIFFERENT deltas ⇒ the trailing run does not match its predecessor's delta.
  const differing = evaluateEntryBar([rec({ run_id: "live:1" }), rec({ run_id: "live:2" }), rec({ run_id: "live:3", slice_delta: { ...goodDelta(), delta: { ...goodDelta().delta, after: { scc_size: 5, members: [""] } } } })]);
  assert.equal(differing.eligible, false);
  assert.match(differing.reason, new RegExp(`run_streak=1/${ENTRY_BAR_STREAK}`));
});

test("AC1: the four reasons are DISTINCT — no single generic refusal is reused", () => {
  const reasons = [
    evaluateEntryBar([rec({ concern_kind: "duplicate", slice_delta: null })]).reason,
    evaluateEntryBar([rec({ slice_delta: { ...goodDelta(), status: "not-evaluated", delta: null } })]).reason,
    evaluateEntryBar([rec({ decision_memory: { status: "exempted", matched_entry: { id: "dm-001" } } })]).reason,
    evaluateEntryBar([rec()]).reason,
  ];
  assert.equal(new Set(reasons).size, reasons.length, `reasons must not collapse: ${JSON.stringify(reasons)}`);
  for (const r of reasons) assert.match(r, /^CONDITION_[1-4]_/, r);
});

test("AC1: the four conditions passing together yields eligible:true with all four matched", () => {
  const v = evaluateEntryBar([rec({ run_id: "live:1" }), rec({ run_id: "live:2" }), rec({ run_id: "live:3" })]);
  assert.equal(v.eligible, true, v.reason);
  assert.equal(v.streak.length, 3);
  assert.deepEqual(v.matchedConditions, [CONDITIONS.KIND, CONDITIONS.DELTA, CONDITIONS.MEMORY, CONDITIONS.STREAK]);
});

test("AC1: an unreadable concern_kind is reported as UNDETERMINED — never silently treated as 'not package-cycle'", () => {
  const v = evaluateEntryBar([{ run_id: "live:x", label: "live", action: "abstain" }]);
  assert.equal(v.eligible, false);
  assert.ok(v.reason.startsWith("CONDITION_1_UNDETERMINED"), v.reason);
  assert.equal(evaluateEntryBar([]).reason.startsWith("CONDITION_1_NOT_MET"), true);
});

// ── reading helpers (structural, enumerable) ───────────────────────────────────────────────────
test("helpers: concern_kind is derived structurally; a non-cycle envelope names its own kind", () => {
  assert.equal(deriveConcernKind(rec()), "package-cycle");
  assert.equal(deriveConcernKind({ slice_delta: goodDelta() }), "package-cycle");
  assert.equal(deriveConcernKind({ envelope: { expected_mechanical_delta: "UNVERIFIED declared measurement (no ArchGuard primitive computes this for concern_kind=canonicalization): …" } }), "canonicalization");
  assert.equal(deriveConcernKind({ action: "abstain" }), null);
  assert.equal(deriveConcernKind(null), null);
});

test("helpers: delta evidence enumerates computed / control / provenance separately", () => {
  const ok = deltaEvidence(rec());
  assert.deepEqual([ok.present, ok.computed, ok.control_falsified, ok.provenance_match], [true, true, true, true]);
  assert.equal(deltaEvidence({}).present, false);
  assert.equal(deltaEvidence(rec({ slice_delta: { ...goodDelta(), status: "guard-violated" } })).computed, false);
});

test("helpers: production vs replay/holdout, and the delta fingerprint is content-addressed", () => {
  assert.equal(isProductionRun(rec()), true);
  assert.equal(isProductionRun(rec({ label: "replay:GOAL-033:B" })), false);
  assert.equal(isProductionRun(rec({ run_id: "holdoutB:GOAL-036@abc" })), false);
  assert.equal(deltaFingerprint(goodDelta().delta), deltaFingerprint({ ...goodDelta().delta }));
  assert.notEqual(deltaFingerprint(goodDelta().delta), deltaFingerprint({ ...goodDelta().delta, added_edges: [1] }));
});

test("groupByCandidate: identity is the structural file set, falling back to the loop's concern_key", () => {
  const a = rec({ run_id: "live:1" });
  const b = rec({ run_id: "live:2" });
  const c = rec({ run_id: "live:3", subject_files: ["packages/quay/src/other.ts"] });
  const groups = groupByCandidate([a, b, c]);
  assert.equal(groups.size, 2);
  const sizes = [...groups.values()].map((g) => g.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

// ── AC2: the goal number is COMPUTED from the given ids, never a hard-coded literal ──────────────
test("AC2: {GOAL-030..036} ⇒ GOAL-037; adding GOAL-037 ⇒ GOAL-038 (dynamic, not a literal)", () => {
  const ids = ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033", "GOAL-034", "GOAL-035", "GOAL-036"];
  assert.equal(nextGoalId(ids), "GOAL-037");
  assert.equal(nextGoalId([...ids, "GOAL-037"]), "GOAL-038");
  assert.equal(nextGoalId([{ id: "GOAL-100" }, "GOAL-099"]), "GOAL-101");
  assert.equal(nextGoalId([]), "GOAL-001");
  assert.equal(nextAcId(["AC-001", "AC-267"]), "AC-268");

  // and the SAME dynamic computation drives the write: the created id follows the supplied set.
  const seen = [];
  const write = (r) => { seen.push(r.id); return { ok: true, id: r.id }; };
  const r1 = proposeDraftGoal(rec(), ids, { write, existingAcIds: ["AC-001"] });
  assert.equal(r1.id, "GOAL-037");
  assert.deepEqual(seen, ["AC-002", "GOAL-037"], "AC is written BEFORE the GOAL (AC-217: a draft GOAL needs ≥1 AC)");
  const r2 = proposeDraftGoal(rec(), [...ids, "GOAL-037"], { write, existingAcIds: ["AC-001", "AC-002"] });
  assert.equal(r2.id, "GOAL-038");

  // no literal goal number is baked into the module
  const code = stripComments(fs.readFileSync(path.join(REPO, MODULE_REL), "utf8"));
  assert.doesNotMatch(code, /GOAL-0\d\d/, "the module must not hard-code a concrete goal id");
});

// ── AC3: structural red line — never activates anything ─────────────────────────────────────────
test("AC3: no status=active write and no lifecycle/promote surface anywhere in the module", () => {
  const code = fs.readFileSync(path.join(REPO, MODULE_REL), "utf8");
  assert.equal(code.match(/status\s*[:=]\s*["']active["']/g), null, "a `status: \"active\"` write is prescribed but never executed here");
  assert.equal(code.match(/lifecycle_promote/g), null);
  assert.equal(code.match(/status\s*[:=]\s*["'](ready|done)["']/g), null, "no task/goal progression status either");
  // the ONLY status literals the module can emit are `draft`
  const built = buildDraftGoal(rec(), { goalId: "GOAL-099", acId: "AC-099" });
  assert.equal(built.goal.fields.status, "draft");
  assert.equal(built.ac.fields.status, "draft");
});

test("AC3: the only write seam is injectable — with no seam the call reports failure, never a fabricated Goal", () => {
  const r = proposeDraftGoal(rec(), ["GOAL-036"], {});
  assert.equal(r.ok, false);
  assert.equal(r.id, null);
  assert.match(r.reason, /NO_WRITE_SEAM/);

  const rFail = proposeDraftGoal(rec(), ["GOAL-036"], { write: () => ({ ok: false, error: "store refused" }), existingAcIds: [] });
  assert.equal(rFail.ok, false);
  assert.match(rFail.reason, /AC_WRITE_FAILED:store refused/);
});

// ── AC4: a qualifying record produces exactly ONE `draft` Goal (real store write + read-back) ─────
test("AC4: proposeDraftGoal writes exactly one GOAL via the real goal store, read back as status=draft with the approval line and the evidence chain", () => {
  const root = mkTmp();
  const store = createGoalStore(path.join(root, "goals"), {});
  const write = createGoalStoreWrite(store);
  const r = proposeDraftGoal(rec(), ["GOAL-036"], { write, existingAcIds: ["AC-001"] });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.id, "GOAL-037");

  // READ BACK from the store (not from the returned payload)
  const goals = store.list().filter((g) => g.kind === "goal");
  assert.equal(goals.length, 1, "exactly ONE goal was created");
  assert.equal(goals[0].id, "GOAL-037");
  assert.equal(goals[0].status, "draft", "the created goal is a DRAFT — never active");
  const back = store.get("GOAL-037");
  assert.match(back.body, /须人工审批后才能从 draft 转 active/);
  assert.match(back.body, /自动投研机制/);
  assert.match(back.body, /ev-1/, "the evidence chain is referenced");
  assert.match(back.body, /ev-2/);
  assert.match(back.body, /ArchGuard slice-delta/);
  assert.match(back.body, /可逆性评估/);
  assert.ok(back.body.includes(APPROVAL_REQUIRED_LINE));

  // a draft GOAL must carry ≥1 AC (the store's own AC-217 invariant) — it does, and it is the exit condition
  const acs = store.list().filter((g) => g.kind === "criterion" && g.goal === "GOAL-037");
  assert.equal(acs.length, 1);
  assert.match(acs[0].criterion, /status: \*\(active\|superseded\)/);
});

// ── structure: the module stays inside the same sandbox as its siblings ─────────────────────────
test("sandbox: the module imports no filing machinery, writes no non-draft status, and does no task/goal lifecycle", () => {
  const code = stripComments(fs.readFileSync(path.join(REPO, MODULE_REL), "utf8"));
  assert.doesNotMatch(code, /\bfileProposals\b|\bdriveItems\b|\bfileDecisions\b|task_write/, "reaches filing machinery");
  assert.doesNotMatch(code, /lifecycle_(promote|complete|retreat|adjudicate)/);
  // the module's own persistence is only via the injected seam; it never opens a file for writing
  assert.doesNotMatch(code, /\b(writeFileSync|appendFileSync|unlinkSync|renameSync|copyFileSync)\b/);
});
