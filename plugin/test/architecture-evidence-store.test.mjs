// @test-group engine
// Tests for the architecture EVIDENCE STORE (task gap-architecture-evidence-store-and-decision-memory, AC1).
// The contract under test: a record missing a required field is REFUSED with a distinct reason and NOTHING
// is written — "I could not write a valid record" must never be shaped like "I wrote one" (硬规则 3b).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EVIDENCE_STORE_REL, RECORD_KINDS, OUTCOME_VERDICTS, REQUIRED_FIELDS, storeFile,
  validateRecord, appendRecord, appendEvidenceRecord, appendHypothesisRecord,
  appendExperimentRecord, appendOutcomeRecord, appendRepairAttemptRecord, appendCounterexampleRecord, readRecords, recordId,
  evidenceRecordFromReading, buildRunRecords, persistRunRecords, confidence,
  subjectFilesOf, subjectKey, extractPathTokens,
} from "../../docs/analysis/architecture-evidence-store.mjs";

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "arch-store-test-")); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const lines = (root) => { const f = storeFile(root); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0; };

// One COMPLETE, valid record per kind — the baseline the missing-field variants are derived from.
const GOOD = {
  evidence: { tool: "read_file", ref: "abc1234567890def", ts: "2026-10-11T00:00:00Z", sha256: "a".repeat(64), confidence: confidence("high", "commit-pinned reading"), path: "packages/quay/src/serve/serve.ts", range: [1, 40] },
  hypothesis: { statement: "the gate core forms a package-level cycle with the root", source_evidence: ["ev-1"], ts: "2026-10-11T00:00:00Z" },
  experiment: { hypothesis_ref: "the gate core forms a cycle", method: "bounded shadow investigation", budget: { max_rounds: 8 }, ts: "2026-10-11T00:00:00Z" },
  outcome: { experiment_ref: "bounded shadow investigation", verdict: "abstained", ts: "2026-10-11T00:00:00Z" },
  repair_attempt: { tool: "ownership-active-proposal-repair", ref: "abc1234567890def", ts: "2026-10-11T00:00:00Z", sha256: "b".repeat(64), attempt_no: 1, bucket: "invalid_move", locked_commit: "abc1234567890def", locked_scope: "packages/quay/src", original_hypothesis: "a package-level cycle ties the gate core to the root", elapsed_ms: 42 },
  counterexample: { counterexample_of: "the gate core forms a package-level cycle with the root", source_evidence: ["ev-2"], ts: "2026-10-11T00:00:00Z" },
};
const APPEND = { evidence: appendEvidenceRecord, hypothesis: appendHypothesisRecord, experiment: appendExperimentRecord, outcome: appendOutcomeRecord, repair_attempt: appendRepairAttemptRecord, counterexample: appendCounterexampleRecord };

// ── 1. AC1: a missing required field is refused, with a distinct reason, and NOTHING is appended ──
test("AC1: each append function REFUSES a record missing a required field, and appends nothing", () => {
  const root = mkTmp();
  const missing = {
    evidence: "ref",            // named in the AC: an evidence record without its commit ref
    hypothesis: "source_evidence",
    experiment: "budget",
    outcome: "verdict",
    repair_attempt: "bucket",
    counterexample: "counterexample_of",
  };
  for (const kind of RECORD_KINDS) {
    const field = missing[kind];
    const rec = { ...GOOD[kind] };
    delete rec[field];
    const before = lines(root);
    const r = APPEND[kind](root, rec);
    assert.equal(r.ok, false, `${kind}: must be refused`);
    assert.equal(r.appended, false);
    assert.ok(r.reasons.some((x) => x === `SCHEMA_MISSING:${field}`), `${kind}: distinct reason for the missing field, got ${r.reasons.join(",")}`);
    assert.equal(lines(root), before, `${kind}: the carrier must not have grown`);
  }
  assert.equal(fs.existsSync(storeFile(root)), false, "no carrier file was created by refusals alone");
});

test("AC1: each append function ACCEPTS a complete record, and it reads back", () => {
  const root = mkTmp();
  for (const kind of RECORD_KINDS) {
    const r = APPEND[kind](root, GOOD[kind]);
    assert.equal(r.ok, true, `${kind}: ${r.reasons?.join(",")}`);
    assert.match(r.id, new RegExp(`^${kind}-`));
  }
  const { records, malformed_lines } = readRecords(storeFile(root));
  assert.equal(malformed_lines, 0);
  assert.equal(records.length, RECORD_KINDS.length);
  assert.deepEqual(records.map((r) => r.kind).sort(), [...RECORD_KINDS].sort());
  assert.equal(records.find((r) => r.kind === "evidence").tool, "read_file");
  assert.equal(storeFile(root), path.join(root, EVIDENCE_STORE_REL));
  assert.equal(EVIDENCE_STORE_REL, ".quay/architecture-evidence-store.jsonl");
});

test("the refusal vocabulary is enumerable — a missing field never collapses into a generic failure", () => {
  const root = mkTmp();
  // "absent" and "present but wrong type" are DIFFERENT causes and carry DIFFERENT codes.
  assert.deepEqual(appendEvidenceRecord(root, { ...GOOD.evidence, ref: undefined }).reasons, ["SCHEMA_MISSING:ref"]);
  assert.deepEqual(appendEvidenceRecord(root, { ...GOOD.evidence, tool: "" }).reasons, ["FIELD_INVALID:tool"]);
  assert.deepEqual(validateRecord("nope", GOOD.evidence).reasons, ["KIND_NOT_IN_VOCAB:nope"]);
  assert.deepEqual(validateRecord("evidence", null).reasons, ["RECORD_NOT_OBJECT"]);
  for (const kind of RECORD_KINDS) assert.ok(REQUIRED_FIELDS[kind].length >= 3, kind);
});

test("an evidence record must be LOCATED — (path+range) or (scope+flags), never neither", () => {
  const root = mkTmp();
  const base = { ...GOOD.evidence };
  delete base.path; delete base.range;
  assert.equal(appendEvidenceRecord(root, base).ok, false);
  assert.match(appendEvidenceRecord(root, base).reasons.join(), /EVIDENCE_LOCATION_MISSING/);
  assert.equal(appendEvidenceRecord(root, { ...base, scope: "packages/quay/src", flags: ["--cycles"] }).ok, true, "a scope+flags reading is a location");
  assert.equal(appendEvidenceRecord(root, { ...base, path: "a/b.ts", range: [1, 2], ...{} }).ok, true, "a file+range reading is a location");
});

test("field TYPES are checked, not just presence: an unpinned or unhashed reading is not evidence", () => {
  const root = mkTmp();
  const bad = [
    [{ ...GOOD.evidence, ref: "abc" }, /FIELD_INVALID:ref/],
    [{ ...GOOD.evidence, sha256: "deadbeef" }, /FIELD_INVALID:sha256/],
    [{ ...GOOD.evidence, confidence: "high" }, /FIELD_INVALID:confidence/],
    [{ ...GOOD.evidence, ts: "" }, /FIELD_INVALID:ts/],
  ];
  for (const [rec, re] of bad) { const r = appendEvidenceRecord(root, rec); assert.equal(r.ok, false); assert.match(r.reasons.join(","), re); }
  assert.equal(appendHypothesisRecord(root, { ...GOOD.hypothesis, source_evidence: [] }).ok, false, "an ungrounded hypothesis is refused");
  assert.match(appendHypothesisRecord(root, { ...GOOD.hypothesis, source_evidence: [] }).reasons.join(), /HYPOTHESIS_UNGROUNDED/);
  assert.equal(appendOutcomeRecord(root, { ...GOOD.outcome, verdict: "maybe" }).ok, false);
  assert.match(appendOutcomeRecord(root, { ...GOOD.outcome, verdict: "maybe" }).reasons.join(), /VERDICT_NOT_IN_VOCAB/);
  assert.equal(lines(root), 0, "every one of those was refused");
});

test("records are content-addressed: identical content ⇒ one id, a changed field ⇒ a different id", () => {
  assert.equal(recordId("evidence", GOOD.evidence), recordId("evidence", { ...GOOD.evidence }));
  assert.notEqual(recordId("evidence", GOOD.evidence), recordId("evidence", { ...GOOD.evidence, range: [1, 41] }));
});

test("readRecords counts unparseable lines instead of silently dropping them", () => {
  const root = mkTmp();
  appendHypothesisRecord(root, GOOD.hypothesis);
  fs.appendFileSync(storeFile(root), "{not json\n", "utf8");
  const { records, malformed_lines } = readRecords(storeFile(root));
  assert.equal(records.length, 1);
  assert.equal(malformed_lines, 1);
});

test("appendRecord refuses a kind that is not in the vocabulary", () => {
  assert.equal(appendRecord(mkTmp(), "goal", {}).ok, false);
  assert.match(appendRecord(mkTmp(), "goal", {}).reasons.join(), /KIND_NOT_IN_VOCAB/);
  // The five ownership-loop verdicts are UNCHANGED and still lead the list; the discovery-finding
  // verdicts are appended, so no pre-existing prefix of the vocabulary shifted.
  assert.deepEqual([...OUTCOME_VERDICTS].slice(0, 5), ["proposed", "abstained", "investigated", "not-evaluated", "exempted"]);
  assert.deepEqual([...OUTCOME_VERDICTS].slice(5), ["supported", "refuted", "undetermined"]);
});

// ── 3. discovery-finding verdicts, the counterexample kind, and the carrier-line location ──────────
// (task gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples). Before this, a
// consistency finding's verdict was REFUSED (VERDICT_NOT_IN_VOCAB), a counterexample could only be
// written as a `hypothesis` with an unchecked extension field, and a reading taken from a runtime
// carrier had nowhere to record WHICH line it came from.
test("AC-a: an outcome carrying the discovery verdict `refuted` is accepted (and reads back)", () => {
  const root = mkTmp();
  const r = appendOutcomeRecord(root, { ...GOOD.outcome, verdict: "refuted" });
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.match(r.id, /^outcome-/);
  const { records } = readRecords(storeFile(root));
  assert.equal(records.length, 1);
  assert.equal(records[0].verdict, "refuted");
  // All three discovery verdicts are accepted; they are the only additions.
  for (const v of ["supported", "refuted", "undetermined"]) {
    assert.equal(appendOutcomeRecord(root, { ...GOOD.outcome, verdict: v }).ok, true, v);
  }
});

test("AC-b: a domain-specific verdict `legit-difference` is STILL refused with VERDICT_NOT_IN_VOCAB", () => {
  const root = mkTmp();
  const r = appendOutcomeRecord(root, { ...GOOD.outcome, verdict: "legit-difference" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["VERDICT_NOT_IN_VOCAB:legit-difference"]);
  assert.equal(lines(root), 0, "a refused verdict writes nothing");
  // Same for the other domain word that motivated this task — the domain belongs in the hypothesis.
  assert.deepEqual(appendOutcomeRecord(root, { ...GOOD.outcome, verdict: "drift-hypothesis" }).reasons, ["VERDICT_NOT_IN_VOCAB:drift-hypothesis"]);
});

test("AC-c: a counterexample missing `counterexample_of` is refused with a reason distinct from SCHEMA_MISSING:source_evidence", () => {
  const root = mkTmp();
  const rec = { ...GOOD.counterexample };
  delete rec.counterexample_of;
  const r = appendCounterexampleRecord(root, rec);
  assert.equal(r.ok, false, "a counterexample that names no hypothesis is refused");
  assert.deepEqual(r.reasons, ["SCHEMA_MISSING:counterexample_of"]);
  assert.notEqual(r.reasons[0], "SCHEMA_MISSING:source_evidence");
  assert.equal(lines(root), 0, "nothing is appended on refusal");
  // An ungrounded counterexample is refused with its OWN code, never the hypothesis's code.
  assert.deepEqual(appendCounterexampleRecord(root, { ...GOOD.counterexample, source_evidence: [] }).reasons, ["COUNTEREXAMPLE_UNGROUNDED:source_evidence-must-cite-at-least-one-reading"]);
  assert.deepEqual(appendCounterexampleRecord(root, { ...GOOD.counterexample, counterexample_of: "" }).reasons, ["COUNTEREXAMPLE_UNREFUTED:counterexample_of-must-name-the-hypothesis-it-refutes"]);
  // A complete counterexample is accepted and is its OWN kind — distinguishable from the hypothesis it refutes.
  const ok = appendCounterexampleRecord(root, GOOD.counterexample);
  assert.equal(ok.ok, true, ok.reasons?.join(","));
  assert.equal(readRecords(storeFile(root)).records[0].kind, "counterexample");
});

test("AC-d: an evidence reading located by a carrier LINE is accepted; a non-hex line_sha256 is refused", () => {
  const root = mkTmp();
  const carrier = { ...GOOD.evidence };
  delete carrier.path; delete carrier.range;                     // no path+range…
  carrier.carrier = { path: ".quay/worker-outcome.jsonl", line: 42, line_sha256: "d".repeat(64) };
  carrier.ref = ".quay/worker-outcome.jsonl";                    // …so `ref` is the carrier path, not a commit sha
  assert.equal(validateRecord("evidence", carrier).ok, true, validateRecord("evidence", carrier).reasons?.join(","));
  assert.equal(appendEvidenceRecord(root, carrier).ok, true);
  // A non-hex line_sha256 is refused, with its OWN cause (a malformed supplied carrier, not a missing location).
  const bad = { ...carrier, carrier: { ...carrier.carrier, line_sha256: "not-hex" } };
  const r = appendEvidenceRecord(root, bad);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(","), /FIELD_INVALID:carrier/);
  // The bare (path+range / scope+flags) forms are untouched — the carrier is a THIRD form, not a replacement.
  assert.equal(validateRecord("evidence", GOOD.evidence).ok, true);
  assert.equal(validateRecord("evidence", { ...GOOD.evidence, path: undefined, range: undefined, scope: "repo", flags: ["--cycles"] }).ok, true);
  assert.equal(lines(root), 1, "only the one valid carrier record was appended");
});

// ── 2. run → four records ─────────────────────────────────────────────────────────────────────
const RUN = {
  ts_iso: "2026-10-11T01:00:00Z", label: "live", commit: "abc1234567890def", state: "evaluated",
  facts: { head_subject: "tasks: something" }, budget: { max_rounds: 8, max_evidence_requests: 6, max_total_evidence_bytes: 90000 },
  usage: { rounds: 3, evidence_requests: 2, evidence_bytes: 100 },
  steps: [{ round: 1, outcome: "evidence" }, { round: 2, outcome: "terminal", hypothesis: "the gate core and the root are mutually dependent" }],
  terminal: { kind: "abstain", forced: false, forced_cause: null },
  evidence: [
    { id: "ev-0", request: { kind: "initial_facts" }, status: "ok", text_sha256: "b".repeat(64), provenance: { tool: "git", ref_commit: "abc1234567890def", ts: "2026-10-11T01:00:00Z", command: "git log -1" } },
    { id: "ev-1", request: { kind: "read_file", path: "packages/quay/src/serve/serve.ts" }, status: "ok", text_sha256: "c".repeat(64), provenance: { tool: "read_file", ref_commit: "abc1234567890def", ts: "2026-10-11T01:00:01Z", content_sha256: "c".repeat(64), path: "packages/quay/src/serve/serve.ts", range: [1, 40] } },
  ],
  envelope: { concern: "some concern", concern_kind: "package-cycle", candidate_interventions: [], scope: { in_scope: ["packages/quay/src/serve/serve.ts"], non_goals: [] } },
  decision_memory: null,
};

test("buildRunRecords: one run projects onto all four kinds, and ev-0 (the initial git facts) is not re-recorded as a tool reading", () => {
  const b = buildRunRecords(RUN, { runId: "live:x:1" });
  assert.equal(b.evidence.length, 1);
  assert.equal(b.evidence[0].tool, "read_file");
  assert.deepEqual(b.evidence[0].range, [1, 40]);
  assert.equal(b.hypothesis.source_evidence.length, 1);
  assert.deepEqual(b.hypothesis.source_evidence, ["ev-1"]);
  assert.match(b.hypothesis.statement, /mutually dependent/, "the hypothesis actually tested is the judge's last stated one");
  assert.equal(b.experiment.hypothesis_ref, b.hypothesis.statement);
  assert.deepEqual(b.experiment.budget, RUN.budget);
  assert.equal(b.outcome.verdict, "abstained");
  assert.equal(b.outcome.run_id, "live:x:1");
});

test("buildRunRecords: the verdict follows the decision memory and the terminal, not a caller's claim", () => {
  const v = (over) => buildRunRecords({ ...RUN, ...over }, { runId: "r" }).outcome.verdict;
  assert.equal(v({ terminal: { kind: "propose_slice" } }), "proposed");
  assert.equal(v({ terminal: { kind: "investigate_more" } }), "investigated");
  assert.equal(v({ state: "not-evaluated" }), "not-evaluated");
  // A memory-exempted terminal is recorded as `exempted` even though the terminal is now an abstain.
  assert.equal(v({ decision_memory: { status: "exempted" }, terminal: { kind: "abstain" } }), "exempted");
  assert.equal(v({ decision_memory: { status: "known-not-yet-filed" }, terminal: { kind: "propose_slice" } }), "proposed");
});

test("subjectFilesOf is structural: complete repo paths only, from the declared locations and the proposal body", () => {
  assert.deepEqual(subjectFilesOf(RUN), ["packages/quay/src/serve/serve.ts"]);
  assert.deepEqual(subjectFilesOf({ envelope: { concern: "no path here at all", scope: { in_scope: [] } } }), []);
  assert.deepEqual(extractPathTokens("docs/analysis/x.mjs"), ["docs/analysis/x.mjs"]);
  assert.equal(subjectKey("package-cycle", ["b.ts", "a.ts"]), subjectKey("package-cycle", ["a.ts", "b.ts"]), "key is order-independent");
});

test("persistRunRecords writes the four records and reports each append's own result", () => {
  const root = mkTmp();
  const res = persistRunRecords(root, RUN, { runId: "holdoutB:GOAL-034" });
  assert.equal(res.hypothesis.ok, true);
  assert.equal(res.experiment.ok, true);
  assert.equal(res.outcome.ok, true);
  assert.equal(res.evidence.length, 1);
  assert.ok(res.evidence.every((x) => x.ok));
  assert.equal(lines(root), 4);
});

test("persistRunRecords reports a refusal instead of throwing or losing it", () => {
  const root = mkTmp();
  const broken = { ...RUN, evidence: [{ id: "ev-1", request: { kind: "read_file", path: "a.ts" }, status: "ok", text_sha256: null, provenance: { tool: "read_file", ref_commit: null, ts: null, path: "a.ts", range: [1, 2] } }] };
  const res = persistRunRecords(root, broken, { runId: "r" });
  assert.equal(res.evidence[0].ok, false);
  assert.equal(res.outcome.ok, true, "one bad reading must not take the outcome down with it");
  assert.equal(lines(root), 3);
});
