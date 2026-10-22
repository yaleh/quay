// @test-group engine
// Tests for ownership-active LIMITED PROPOSAL MODE (task gap-ownership-active-limited-proposal-mode) —
// phase C of the end-to-end architecture self-bootstrap: ONE independent call site that may turn ONE
// already-qualified carrier record into exactly ONE `draft` Goal (never activating it).
//
// No model, no network, no ArchGuard: the entry bar is pure, and the write is exercised against a REAL
// goal store in a temp dir (so AC4's read-back is a real store read, not a fixture echo).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGoalStore } from "../../packages/quay/src/core/goal-store.ts";
import {
  ENTRY_BAR_STREAK, CONDITIONS, APPROVAL_REQUIRED_LINE, MEMORY_NOT_EVALUATED,
  evaluateEntryBar, deriveConcernKind, deltaEvidence, decisionMemoryStatus, decisionMemoryReading,
  isProductionRun, deltaFingerprint, groupByCandidate, readCarrier, evaluateCarrier,
  nextGoalId, nextAcId, buildDraftGoal, proposeDraftGoal, createGoalStoreWrite,
  CONCERN_KIND_REGISTRY, CONCERN_KIND_STATES, CONCERN_KIND_IN_SCOPE, DESIGN_EVOLUTION_KIND,
  CONCERN_ADMISSIONS, registryAdmissionViolations,
  DESIGN_EVOLUTION_DUP_KIND, DESIGN_EVOLUTION_PREDICATE_SAMPLES,
  concernKindEntry, concernKindState, designEvolutionRegression,
  designEvolutionDeltaEvidence, designEvolutionFingerprint, designEvolutionPredicateSelfCheck,
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory (2026-10-11)
//   Condition 3 used to FAIL OPEN: `decisionMemoryStatus` returned the loop's `not-known` DEFAULT for a
//   record with no `decision_memory`, and ignored `architecture-decision-memory.mjs`'s `unreadable_input`
//   flag — so "the memory was never consulted" and "the memory could not read its input" both passed C3 as
//   "已查过、非已知豁免" (硬规则 6: 缺值 = 未查). Separately the CLI DROPPED unparseable carrier lines instead of
//   counting them, which can silently un-break a run-streak (condition 4's input, fail-open).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── AC1: `decision_memory` absent / unreadable ⇒ its OWN value, never the loop's `not-known` default ──
test("AC1(c3): decisionMemoryStatus distinguishes 'never consulted' from 'nothing matched'", () => {
  // ABSENT ≠ not-known — the memory was never consulted for this run.
  assert.equal(decisionMemoryStatus(rec({ decision_memory: undefined })), MEMORY_NOT_EVALUATED);
  assert.notEqual(decisionMemoryStatus(rec({ decision_memory: undefined })), "not-known");
  assert.equal(decisionMemoryReading(rec({ decision_memory: undefined })).cause, "absent");
  // A present `unreadable_input:true` is the SAME undetermined state, with its own cause — the memory's
  // own "I could not read my input" flag now crosses the call boundary (硬规则 4c).
  const unread = rec({ decision_memory: { status: "not-known", unreadable_input: true } });
  assert.equal(decisionMemoryStatus(unread), MEMORY_NOT_EVALUATED);
  assert.equal(decisionMemoryReading(unread).cause, "unreadable");
  // A READ verdict is copied verbatim — the memory's own enum is untouched.
  assert.equal(decisionMemoryStatus(rec({ decision_memory: { status: "not-known", unreadable_input: false } })), "not-known");
  assert.equal(decisionMemoryStatus(rec({ decision_memory: { status: "exempted" } })), "exempted");
  // A present object with no readable status is UNREAD, not "nothing matched".
  assert.equal(decisionMemoryReading(rec({ decision_memory: {} })).cause, "unreadable");
  assert.equal(decisionMemoryReading(rec({ decision_memory: "not-known" })).cause, "unreadable");
  assert.equal(decisionMemoryReading(rec({ decision_memory: null })).cause, "absent");
});

test("AC1(c3): an ABSENT decision memory fails C3 as UNDETERMINED, and the reason names the absence", () => {
  const v = evaluateEntryBar([rec({ decision_memory: undefined })]);
  assert.equal(v.eligible, false);
  assert.ok(v.reason.startsWith("CONDITION_3_UNDETERMINED"), v.reason);
  assert.match(v.reason, /decision_memory is ABSENT/);
  assert.match(v.reason, /缺席/);
  assert.doesNotMatch(v.reason, /^CONDITION_3_NOT_MET/, "absence is UNDETERMINED, not a positive 'exempted' finding");
});

test("AC1(c3): an UNREADABLE decision-memory input fails C3 as UNDETERMINED, and the reason says why", () => {
  const v = evaluateEntryBar([rec({ decision_memory: { status: "not-known", unreadable_input: true } })]);
  assert.equal(v.eligible, false);
  assert.ok(v.reason.startsWith("CONDITION_3_UNDETERMINED"), v.reason);
  assert.match(v.reason, /不可读/);
  assert.match(v.reason, /could not be READ/);
  assert.match(v.reason, /unreadable_input=true/);
});

// ── AC2: negative/positive control — C3 refuses the unread states but still admits a READ not-known ──
test("AC2(c3): an otherwise fully-qualifying record is refused at C3 when the memory is unread — with a positive control", () => {
  // NEGATIVE CONTROL 1: every other condition satisfied, ONLY `decision_memory` removed ⇒ refused at C3.
  const absent = (id) => rec({ run_id: id, decision_memory: undefined });
  const vAbsent = evaluateEntryBar([absent("live:1"), absent("live:2"), absent("live:3")]);
  assert.equal(vAbsent.eligible, false);
  assert.ok(vAbsent.reason.startsWith("CONDITION_3_UNDETERMINED"), vAbsent.reason);

  // NEGATIVE CONTROL 2: same record set with `unreadable_input:true` ⇒ refused the same way.
  const unread = (id) => rec({ run_id: id, decision_memory: { status: "not-known", unreadable_input: true } });
  const vUnread = evaluateEntryBar([unread("live:1"), unread("live:2"), unread("live:3")]);
  assert.equal(vUnread.eligible, false);
  assert.ok(vUnread.reason.startsWith("CONDITION_3_UNDETERMINED"), vUnread.reason);

  // POSITIVE CONTROL: a READ `not-known` clears C3 — so the refusals above are not a blanket rejection.
  // (The same 3 records become fully eligible, i.e. C4 passes too.)
  const read = (id) => rec({ run_id: id, decision_memory: { status: "not-known", unreadable_input: false } });
  const vOk = evaluateEntryBar([read("live:1"), read("live:2"), read("live:3")]);
  assert.equal(vOk.eligible, true, vOk.reason);
  assert.deepEqual(vOk.matchedConditions, [CONDITIONS.KIND, CONDITIONS.DELTA, CONDITIONS.MEMORY, CONDITIONS.STREAK]);
  // and with a single record, C3 having passed is visible as "C4 is the first failure".
  assert.ok(evaluateEntryBar([read("live:1")]).reason.startsWith("CONDITION_4_NOT_MET"));
});

// ── AC3: the carrier reader COUNTS malformed lines, and a malformed line fails EVERY candidate closed ──
test("AC3(c3): readCarrier counts unreadable lines instead of silently dropping them", () => {
  const dir = mkTmp();
  const f = path.join(dir, "carrier.jsonl");
  const good = [rec({ run_id: "live:1" }), rec({ run_id: "live:2" }), rec({ run_id: "live:3" })];
  fs.writeFileSync(f, [...good.map((r) => JSON.stringify(r)), "{not json", ""].join("\n"));
  const { records, malformed_lines, exists } = readCarrier(f);
  assert.equal(exists, true);
  assert.equal(records.length, 3, "the readable records are still returned");
  assert.equal(malformed_lines, 1, "the bad line is COUNTED, never dropped");
  // a missing file is not a malformed file
  assert.deepEqual(readCarrier(path.join(dir, "absent.jsonl")), { records: [], malformed_lines: 0, exists: false });
});

test("AC3(c3): a malformed carrier line fails EVERY candidate closed; --write therefore cannot fire", () => {
  const dir = mkTmp();
  const f = path.join(dir, "carrier.jsonl");
  const good = [rec({ run_id: "live:1" }), rec({ run_id: "live:2" }), rec({ run_id: "live:3" })];
  fs.writeFileSync(f, good.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const clean = evaluateCarrier(readCarrier(f));
  assert.equal(clean.malformed_lines, 0);
  assert.equal(clean.carrier_unreadable, false);
  assert.equal(clean.candidates.length, 1);
  assert.equal(clean.candidates[0].eligible, true, "control: the clean carrier's candidate IS eligible");

  // NEGATIVE CONTROL: append ONE non-JSON line — the SAME candidate must become ineligible.
  fs.appendFileSync(f, "{ this is not json\n");
  const dirty = evaluateCarrier(readCarrier(f));
  assert.equal(dirty.malformed_lines, 1);
  assert.equal(dirty.carrier_unreadable, true);
  assert.equal(dirty.candidates.length, 1);
  assert.equal(dirty.candidates[0].eligible, false, "a bad line anywhere makes the streak input untrustworthy");
  assert.ok(dirty.candidates[0].reason.startsWith("MALFORMED_CARRIER_LINES"), dirty.candidates[0].reason);
  assert.match(dirty.candidates[0].reason, /1 unreadable/);
  assert.equal(dirty.candidates[0].suppressed_by, "MALFORMED_CARRIER_LINES");
  // the raw slice rides along for the write path but is never serialised by evaluateCarrier itself
  assert.equal(dirty.candidates[0].groupRecords.length, 3);
});

test("AC3(c3): the CLI reports malformed_lines and writes NO Goal when the carrier has a bad line", () => {
  const dir = mkTmp();
  const f = path.join(dir, "carrier.jsonl");
  const goalDir = path.join(dir, "goals");
  fs.mkdirSync(goalDir, { recursive: true });
  const good = [rec({ run_id: "live:1" }), rec({ run_id: "live:2" }), rec({ run_id: "live:3" })];
  fs.writeFileSync(f, good.map((r) => JSON.stringify(r)).join("\n") + "\n{ broken\n");
  const r = spawnSync("node", ["--experimental-strip-types", path.join(REPO, MODULE_REL), "--carrier", f, "--root", dir, "--write"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.malformed_lines, 1);
  assert.equal(out.carrier_unreadable, true);
  assert.equal(out.results.every((x) => x.eligible === false), true);
  assert.equal(out.results.every((x) => x.reason.startsWith("MALFORMED_CARRIER_LINES")), true);
  assert.equal(out.results.every((x) => x.proposed === undefined), true, "no Goal is proposed");
  assert.equal(fs.readdirSync(goalDir).length, 0, "the store dir is empty — no Goal was written");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// gap-planner-admission-widen-beyond-package-cycle (2026-10-22, DIR-133 F1)
//   Condition 1 used to be the literal `concern_kind === "package-cycle"`, so the automated Planner
//   could only ever admit ONE concern. The instruments — not the concerns — were the limit: a SECOND
//   kind is now mechanized end to end (design-evolution-readings.ts produces the finding, the delta is
//   the share's net rise, and a repair drives it dark), while the two kinds DIR-133 names are
//   registered with `mechanized:false` and must be REPORTED AS SUCH rather than quietly admitted or
//   quietly refused as "not in scope" (硬规则 3b).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A production-shaped design-evolution finding (fields = `.quay/routine-findings.jsonl` records written
// by design-evolution-readings.ts::evolutionFindingRecord) plus the two fields the entry bar also reads.
const deRec = (over = {}) => ({
  run_id: "live:de:1", label: "live",
  dupKind: DESIGN_EVOLUTION_DUP_KIND,
  target: "worker-history",
  trigger: "share-up",
  readingTs: "2026-10-22T02:00:00Z",
  priorReadingTs: "2026-10-22T01:00:00Z",
  deltaCentral: 288, deltaNonCentral: -6, deltaDenominator: 282, sharePercent: 102.13,
  decision_memory: { status: "not-known" },
  subject_files: ["plugin/scripts/worker-driver.ts"],
  ...over,
});
const deStreak = (over = {}) => [deRec({ run_id: "live:1", priorReadingTs: "2026-10-22T00:00:00Z", ...over }), deRec({ run_id: "live:2", priorReadingTs: "2026-10-22T01:00:00Z", ...over }), deRec({ run_id: "live:3", priorReadingTs: "2026-10-22T02:00:00Z", ...over })];

// ── AC1: the registry exists, carries the five pinned keys on every entry, and is the C1 judge ───────
test("AC1(registry): CONCERN_KIND_REGISTRY is exported, and every entry carries the five pinned keys", () => {
  const code = stripComments(fs.readFileSync(path.join(REPO, MODULE_REL), "utf8"));
  assert.match(code, /export const CONCERN_KIND_REGISTRY/, "the registry is a top-level export");
  assert.ok(CONCERN_KIND_REGISTRY.length >= 4, `expected ≥4 entries, got ${CONCERN_KIND_REGISTRY.length}`);
  const five = ["detector", "deltaComputable", "negativeControl", "occurrenceThreshold", "mechanized"];
  for (const e of CONCERN_KIND_REGISTRY) {
    for (const k of five) assert.ok(k in e, `entry ${e.kind} is missing the pinned key ${k}`);
    assert.equal(typeof e.detector, "string", `${e.kind}.detector names a mechanism, not a boolean`);
    assert.ok(e.detector.trim().length > 10, `${e.kind}.detector must say WHERE the detector lives`);
    assert.equal(typeof e.mechanized, "boolean", `${e.kind}.mechanized must be a real boolean`);
    assert.equal(typeof e.deltaComputable, "boolean");
    assert.equal(typeof e.negativeControl, "boolean");
  }
  // the two mechanized kinds are exactly the two whose instruments are landed
  const mechanized = CONCERN_KIND_REGISTRY.filter((e) => e.mechanized).map((e) => e.kind).sort();
  assert.deepEqual(mechanized, ["design-evolution-regression", "package-cycle"]);
  // and both carry the DIR-133-ruling-1 occurrence threshold of 2
  for (const k of ["package-cycle", "design-evolution-regression"]) {
    assert.equal(concernKindEntry(k).occurrenceThreshold, 2, `${k}.occurrenceThreshold`);
  }
  // the two registered slates are NOT mechanized and say which detector they wait for
  assert.match(concernKindEntry("spine-without-extension-point").detector, /gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point/);
  assert.match(concernKindEntry("god-file-size").detector, /NOT LANDED/);
});

// ── AC2: each concern_kind reports ITS OWN state — the tokens are pairwise distinct ────────────────
test("AC2(registry): the five fixture kinds report five PAIRWISE DISTINCT state tokens (plus the unreadable one)", () => {
  const tokens = {
    "package-cycle": concernKindState("package-cycle"),
    "design-evolution-regression": concernKindState("design-evolution-regression"),
    "spine-without-extension-point": concernKindState("spine-without-extension-point"),
    "god-file-size": concernKindState("god-file-size"),
    "other-boundary": concernKindState("other-boundary"),
    "no concern_kind field": concernKindState(null),
  };
  const values = Object.values(tokens).map((t) => t.token);
  assert.equal(new Set(values).size, values.length, `tokens must not collapse: ${JSON.stringify(values)}`);

  // the states are what the task pins, and each kind keeps its OWN name inside the token
  assert.equal(tokens["package-cycle"].state, CONCERN_KIND_STATES.IN_SCOPE);
  assert.equal(tokens["design-evolution-regression"].state, CONCERN_KIND_STATES.IN_SCOPE);
  assert.equal(tokens["spine-without-extension-point"].state, CONCERN_KIND_STATES.NOT_YET_MECHANIZED);
  assert.equal(tokens["god-file-size"].state, CONCERN_KIND_STATES.NOT_YET_MECHANIZED);
  assert.equal(tokens["other-boundary"].state, CONCERN_KIND_STATES.NOT_MET);
  assert.equal(tokens["no concern_kind field"].state, CONCERN_KIND_STATES.UNDETERMINED);
  // the two IN_SCOPE kinds are still distinguishable by WHICH detector admits them
  assert.notEqual(tokens["package-cycle"].entry.detector, tokens["design-evolution-regression"].entry.detector);
  // and the four states themselves are distinct values
  assert.equal(new Set(Object.values(CONCERN_KIND_STATES)).size, 4);

  // the SAME reading through the real judgment: condition-1 reasons are pairwise distinct per kind
  const reasons = [
    evaluateEntryBar([rec({ run_id: "live:1" })]).reason,
    evaluateEntryBar([deRec()]).reason,
    evaluateEntryBar([rec({ concern_kind: "spine-without-extension-point", slice_delta: null })]).reason,
    evaluateEntryBar([rec({ concern_kind: "god-file-size", slice_delta: null })]).reason,
    evaluateEntryBar([rec({ concern_kind: "other-boundary", slice_delta: null })]).reason,
  ];
  assert.equal(new Set(reasons).size, reasons.length, `reasons must not collapse: ${JSON.stringify(reasons)}`);
  assert.match(reasons[2], /^CONDITION_1_NOT_YET_MECHANIZED:.*spine-without-extension-point/);
  assert.match(reasons[3], /^CONDITION_1_NOT_YET_MECHANIZED:.*god-file-size/);
  assert.match(reasons[4], /^CONDITION_1_NOT_MET:concern_kind=other-boundary/);
});

// ── AC3: `occurrenceThreshold` is READ by the judgment, not merely declared ────────────────────────
test("AC3(registry): the occurrence floor comes from the entry — raising it in the registry changes the verdict", () => {
  // CONTROL: three qualifying package-cycle runs clear the default floor (2) — the streak floor (3) is met.
  const three = [rec({ run_id: "live:1" }), rec({ run_id: "live:2" }), rec({ run_id: "live:3" })];
  assert.equal(evaluateEntryBar(three).eligible, true);
  assert.equal(evaluateEntryBar(three).streak.occurrence_threshold, 2);

  // NEGATIVE CONTROL: the SAME records, judged against a registry whose package-cycle floor is 4.
  // Only `occurrenceThreshold` differs ⇒ if the field were not read, this would still be eligible.
  const raised = CONCERN_KIND_REGISTRY.map((e) => (e.kind === CONCERN_KIND_IN_SCOPE ? { ...e, occurrenceThreshold: 4 } : e));
  const v = evaluateEntryBar(three, { registry: raised });
  assert.equal(v.eligible, false, "the raised floor must bite");
  assert.match(v.reason, /^CONDITION_4_NOT_MET:occurrences=3\/4/);
  assert.match(v.reason, /CONCERN_KIND_REGISTRY occurrenceThreshold/);
  assert.equal(v.streak.occurrences, 3);
  assert.equal(v.streak.occurrence_threshold, 4);

  // the floor is a DIFFERENT quantity from the streak: [hit, quiet, hit] has occurrences=2 but streak=1
  // (the middle run's window does not rise — e.g. the repair that landed between the two regressions)
  const quiet = () => { const sd = goodDelta(); sd.status = "evaluated"; return { slice_delta: { ...sd, delta: { ...sd.delta, after: { scc_size: 6, members: [""] } } } }; };
  const gappy = [rec({ run_id: "live:1" }), rec({ run_id: "live:2", ...quiet() }), rec({ run_id: "live:3" })];
  const g = evaluateEntryBar(gappy);
  assert.equal(g.streak.occurrences, 2, "the non-consecutive hits are counted");
  assert.equal(g.streak.length, 1, "the streak stops at the first non-qualifying production run");
  assert.match(g.reason, /run_streak=1\//);

  // and no literal 2 survives in the judgment: the number comes out of the entry
  const code = stripComments(fs.readFileSync(path.join(REPO, MODULE_REL), "utf8"));
  assert.match(code, /entry\.occurrenceThreshold/, "the judgment must read the registry field");
});

// ── AC4: the design-regression signal is FALSIFIABLE — a repair extinguishes it ─────────────────────
test("AC4(registry): the same predicate hits on a rising window and goes dark on a repaired one", () => {
  // the predicate itself, on the two windows AC4 asks for
  const rising = designEvolutionRegression({ deltaCentral: 288, deltaNonCentral: -6, deltaDenominator: 282, sharePercent: 102.13 });
  const repaired = designEvolutionRegression({ deltaCentral: -40, deltaNonCentral: 120, deltaDenominator: 80, sharePercent: 60 });
  assert.deepEqual([rising.evaluated, rising.hit], [true, true], "a rising share window is a regression");
  assert.deepEqual([repaired.evaluated, repaired.hit], [true, false], "the repaired window evaluates AND does not hit");
  // the declared boundary: growth that only MOVED lines into the central file is not a regression
  const movedOnly = designEvolutionRegression({ deltaCentral: 50, deltaNonCentral: -50, deltaDenominator: 0 });
  assert.deepEqual([movedOnly.evaluated, movedOnly.hit], [true, false], "Δdenominator<=0 must not hit");

  // the SAME two windows through the entry bar: the rising one clears C2, the repaired one is refused there
  const risingBar = evaluateEntryBar(deStreak());
  assert.equal(risingBar.eligible, true, risingBar.reason);
  assert.equal(risingBar.conditions.delta.computed, true);
  const repairedBar = evaluateEntryBar(deStreak({ deltaCentral: -40, deltaNonCentral: 120, deltaDenominator: 80, sharePercent: 60 }));
  assert.equal(repairedBar.eligible, false);
  assert.ok(repairedBar.reason.startsWith("CONDITION_2_NOT_MET"), repairedBar.reason);
  assert.match(repairedBar.reason, /not-a-regression-window/);
  assert.match(repairedBar.reason, /extinguished/);

  // the built-in control pair separates, and it is reported as its own value
  const self = designEvolutionPredicateSelfCheck();
  assert.equal(self.ok, true, self.reason);
  assert.deepEqual([self.regression_hit, self.repaired_hit], [true, false]);
  assert.equal(self.reason, null);
  assert.equal(DESIGN_EVOLUTION_PREDICATE_SAMPLES.regression.deltaCentral > 0, true);
  // Δcentral / Δdenominator are read RAW — a producer boolean would not be enough
  assert.equal(designEvolutionDeltaEvidence(deRec()).computed, true);
  assert.equal(designEvolutionDeltaEvidence(deRec({ deltaCentral: 0 })).computed, false);
});

// ── AC5: `mechanized:false` is its OWN state — never NOT_MET, never ELIGIBLE ───────────────────────
test("AC5(registry): a registered-but-unlanded detector reports NOT_YET_MECHANIZED and admits nothing", () => {
  for (const kind of ["spine-without-extension-point", "god-file-size"]) {
    const v = evaluateEntryBar([rec({ concern_kind: kind, slice_delta: null })]);
    assert.equal(v.eligible, false, `${kind} must not be admitted`);
    assert.ok(v.reason.startsWith("CONDITION_1_NOT_YET_MECHANIZED:"), v.reason);
    assert.doesNotMatch(v.reason, /^CONDITION_1_NOT_MET/, "not-yet-mechanized must not read as out-of-scope");
    assert.notEqual(v.reason.slice(0, 40), evaluateEntryBar([rec({ concern_kind: "other-boundary", slice_delta: null })]).reason.slice(0, 40));
    assert.match(v.reason, /mechanized=false/);
    assert.deepEqual(v.matchedConditions, [], "condition 1 never matched");
    // ⛔ no delta/streak judgment is reachable for it — C1 short-circuits before C2
    assert.equal(v.streak.length, 0);
  }
  // Flipping the entry is the ONLY thing that moves the refusal past C1 — the gate is the registry, not
  // prose. Half a flip (mechanized:true but no readers) is an INSTRUMENT failure, its own value:
  const halfFlip = CONCERN_KIND_REGISTRY.map((e) => (e.kind === "god-file-size" ? { ...e, mechanized: true } : e));
  const v2 = evaluateEntryBar([rec({ concern_kind: "god-file-size", slice_delta: null })], { registry: halfFlip });
  assert.ok(v2.reason.startsWith("CONDITION_2_UNDETERMINED"), v2.reason);
  assert.equal(v2.eligible, false);
  // A complete flip moves the refusal to C2 — never straight to ELIGIBLE.
  const fullFlip = CONCERN_KIND_REGISTRY.map((e) => (e.kind === "god-file-size"
    ? { ...e, mechanized: true, readDelta: () => ({ present: false, computed: false, control_falsified: false, provenance_match: false, provenance_status: null, detail: "stub" }), fingerprintOf: () => null }
    : e));
  const v3 = evaluateEntryBar([rec({ concern_kind: "god-file-size", slice_delta: null })], { registry: fullFlip });
  assert.ok(v3.reason.startsWith("CONDITION_2_NOT_MET"), v3.reason);
  assert.equal(v3.eligible, false);
});

// ── AC-921: every registered kind carries an `admission`, judged on the IMPORTED object ────────────
// The expected mapping is a LITERAL table here, deliberately NOT derived from CONCERN_ADMISSIONS or from
// the registry itself: deriving it would let one edit turn both sides green at once (硬规则 4 — a quantity
// that structurally cannot take the false value is not a measurement).
const EXPECTED_ADMISSION = Object.freeze({
  "package-cycle": "mechanical",
  "design-evolution-regression": "mechanical",
  "god-file-size": "semantic-judged",
  "unencapsulated-state": "semantic-judged",
  "spine-without-extension-point": "semantic-judged",
});
/** Which kinds DISAGREE with the declared table. Its own check, distinct from `registryAdmissionViolations`:
 *  a token can be perfectly LEGAL and still be the wrong one for its kind — legality only exists relative to
 *  the closed vocabulary, correctness only relative to this expectation. A validator that "caught" arm (a)
 *  would have to carry a second copy of this table inside the module, which is exactly the drift the task
 *  forbids; so the two questions stay separate and both are asserted. */
const admissionMismatches = (registry) =>
  Object.entries(EXPECTED_ADMISSION)
    .filter(([kind, want]) => registry.find((e) => e.kind === kind)?.admission !== want)
    .map(([kind]) => kind);

test("AC921-1(admission): all five registered kinds carry the declared admission, read off the imported object", () => {
  const got = Object.fromEntries(CONCERN_KIND_REGISTRY.map((e) => [e.kind, e.admission]));
  assert.deepEqual(got, EXPECTED_ADMISSION, "the imported registry's kind→admission map");
  assert.deepEqual(admissionMismatches(CONCERN_KIND_REGISTRY), []);
  assert.equal(CONCERN_KIND_REGISTRY.length, 5, "exactly the five declared kinds are registered");
  // the two ADMISSION tokens are a closed vocabulary — an unknown token is not a synonym for either
  assert.deepEqual(Object.values(CONCERN_ADMISSIONS).sort(), ["mechanical", "semantic-judged"]);
});

test("AC921-2(admission): the real registry has ZERO violations, and every violation is NAMED", () => {
  const real = registryAdmissionViolations();
  assert.equal(real.evaluated, true, "the real registry is readable");
  assert.equal(real.cause, null);
  assert.deepEqual(real.missing, []);
  assert.deepEqual(real.invalid, []);

  // NEGATIVE ARM (a): a synthetic registry whose one admission is FLIPPED to the other legal token.
  // Synthetic registries are in-memory objects on the import path, so this proves the judge reads the
  // OBJECT, not the source text (硬规则 2). The flipped token stays inside the legal vocabulary, so the
  // legality check reports no violation — the WRONGNESS is named by the declared-mapping comparison above.
  // Asserting both halves keeps the seam visible instead of pretending one check covers both questions.
  const flipped = CONCERN_KIND_REGISTRY.map((e) =>
    e.kind === "package-cycle" ? { ...e, admission: CONCERN_ADMISSIONS.SEMANTIC_JUDGED } : e);
  const a = registryAdmissionViolations(flipped);
  assert.equal(a.evaluated, true);
  assert.deepEqual(a.invalid, [], "a flipped token is still LEGAL — legality is not the question here");
  assert.deepEqual(a.missing, []);
  assert.deepEqual(admissionMismatches(flipped), ["package-cycle"], "and the WRONG kind is named here");

  // NEGATIVE ARM (b): an entry with the admission FIELD REMOVED — a missing field is its own list.
  const removed = CONCERN_KIND_REGISTRY.map((e) => {
    if (e.kind !== "god-file-size") return e;
    const { admission: _drop, ...rest } = e;
    return rest;
  });
  const b = registryAdmissionViolations(removed);
  assert.equal(b.evaluated, true);
  assert.deepEqual(b.missing, ["god-file-size"], "a deleted admission is reported as missing, not invalid");
  assert.deepEqual(b.invalid, []);
  assert.deepEqual(admissionMismatches(removed), ["god-file-size"]);

  // NEGATIVE ARM (c): an ILLEGAL token — neither of the two legal values.
  const illegal = CONCERN_KIND_REGISTRY.map((e) =>
    e.kind === "spine-without-extension-point" ? { ...e, admission: "maybe" } : e);
  const c = registryAdmissionViolations(illegal);
  assert.equal(c.evaluated, true);
  assert.deepEqual(c.invalid, ["spine-without-extension-point"]);
  assert.deepEqual(c.missing, []);
  assert.deepEqual(admissionMismatches(illegal), ["spine-without-extension-point"]);

  // INSTRUMENT FAILURE is its OWN shape: an unreadable registry must NOT look like "zero violations"
  // (硬规则 3b) — `evaluated:false` plus a non-null cause.
  // ⛔ `undefined` is excluded on purpose: it triggers the default parameter (the real registry).
  for (const unreadable of [null, "not-an-array", {}, []]) {
    const r = registryAdmissionViolations(unreadable);
    assert.equal(r.evaluated, false, `unreadable input ${JSON.stringify(unreadable)} must not be evaluated`);
    assert.equal(typeof r.cause, "string");
    assert.ok(r.cause.length > 0);
    assert.notDeepEqual(r, { evaluated: true, missing: [], invalid: [], cause: null });
  }
});

// ── the SECOND kind is really the one the production producer emits ───────────────────────────────
test("parity: the production findings record derives design-evolution-regression (the dupKind token matches the producer)", async () => {
  const { evolutionFindingRecord } = await import("../../plugin/scripts/design-evolution-readings.ts");
  const produced = evolutionFindingRecord({
    key: "evolution:worker-history:share-up", target: "worker-history", trigger: "share-up",
    readingTs: "2026-10-22T02:00:00Z", priorReadingTs: "2026-10-22T01:00:00Z",
    deltaCentral: 288, deltaNonCentral: -6, deltaDenominator: 282, sharePercent: 102.13,
    darkRounds: null, rationale: "r", suggestedAction: "a", files: ["plugin/scripts/worker-driver.ts"],
  }, "2026-10-22T02:00:00Z");
  // the local constant is the producer's wire token, not an invented one
  assert.equal(produced.dupKind, DESIGN_EVOLUTION_DUP_KIND);
  assert.equal(deriveConcernKind(produced), DESIGN_EVOLUTION_KIND);
  // a production record with no decision_memory is UNDETERMINED at C3 (never "not-known")
  const v = evaluateEntryBar([{ ...produced, run_id: "prod:1" }]);
  assert.ok(v.reason.startsWith("CONDITION_3_UNDETERMINED"), v.reason);
  // with the memory consulted, the same record clears C1+C2 and fails only the occurrence floor
  const v2 = evaluateEntryBar([{ ...produced, run_id: "prod:1", decision_memory: { status: "not-known" } }]);
  assert.ok(v2.reason.startsWith("CONDITION_4_NOT_MET"), v2.reason);
  assert.match(v2.reason, /occurrences=1\/2/);
});

// ── AC7: the amendment is WRITTEN DOWN, and it names both unlanded detectors' tasks ────────────────
test("AC7(doc): ownership-active-replay.md carries a dated amendment naming both NOT_YET_MECHANIZED tasks, and §6 is untouched", () => {
  const doc = fs.readFileSync(path.join(REPO, "docs/analysis/ownership-active-replay.md"), "utf8");
  assert.match(doc, /amend 2026-10-22/);
  assert.match(doc, /CONCERN_KIND_REGISTRY/);
  assert.match(doc, /NOT_YET_MECHANIZED/);
  assert.match(doc, /gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point/);
  assert.match(doc, /god-file-size/);
  // §6's original text is a historical contract: the amendment is a NEW section, not a rewrite
  assert.match(doc, /^## 6\. Still missing \/ readiness for a limited proposal mode$/m);
  assert.match(doc, /\(a\) restrict limited proposals to `concern_kind=package-cycle` with a/, "§6(a) original wording still present");
  // and the module header points at it
  const code = fs.readFileSync(path.join(REPO, MODULE_REL), "utf8");
  assert.match(code, /AMEND 2026-10-22/);
  assert.match(code, /ownership-active-replay\.md` §8/);
});
