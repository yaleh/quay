// @test-group engine
// Tests for the DISCOVERY EXPERIENCE LEDGER (task gap-discovery-teaching-case-ledger-feedback-
// ingestion, AC a–h). The contract under test: ONE ledger fed by TWO sources — a manual adapter
// (`reported_by:"user"`, `source_ref` forced null) and an AUTOMATIC adapter that projects a real
// `architecture-evidence-store.jsonl` outcome record into a ledger entry with no hand-narration.
// A record that cannot be a valid Experience entry is REFUSED with a distinct reason code and
// NOTHING is appended; the automatic adapter REFUSES a record that is missing, ambiguous, or whose
// stored verdict contradicts the role the caller claims — it never fabricates the record it projects.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EXPERIENCE_LEDGER_REL, EXPERIENCE_KIND, EXPERIENCE_ROLES, REPORTED_BY_VOCAB, MIN_SUMMARY_CHARS,
  REQUIRED_EXPERIENCE_FIELDS, ROLE_VERDICT_COMPAT,
  ledgerFile, validateExperienceRecord, appendExperienceRecord, readExperienceLedger,
  ingestFeedback, ingestFromEvidenceStoreOutcome, experienceDenyList, scanExperienceLeak,
  experienceRecordId,
} from "../../docs/analysis/discovery-experience-ledger.mjs";
import { appendOutcomeRecord, storeFile, sha256 } from "../../docs/analysis/architecture-evidence-store.mjs";

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-experience-ledger-")); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const lines = (root) => { const f = ledgerFile(root); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0; };
const SUMMARY = "the deny-list must not be derivable from anything but the ledger's actual recorded contents";

/** A FIXTURE evidence store: one outcome record written through the REAL evidence-store writer. */
const writeFixtureStore = (root, recs) => {
  const out = recs.map((r) => appendOutcomeRecord(root, { ts: "2026-10-12T00:00:00Z", experiment: "E-FIX", ...r }));
  for (const o of out) assert.equal(o.ok, true, `fixture outcome refused: ${o.reasons?.join(",")}`);
  return out;
};
/** The sha256 of the Nth (1-based) line of a carrier — what the automatic adapter must derive. */
const lineSha = (file, n) => sha256(fs.readFileSync(file, "utf8").split("\n")[n - 1]);

// ── AC1(a): a well-formed manual case is accepted, with source_ref forced null ──────────────────

test("AC1(a): a well-formed manual (reported_by:\"user\") case is accepted with source_ref null", () => {
  const root = mkTmp();
  const r = ingestFeedback(root, {
    caseId: "TEACH-probe-meta-coupling",
    role: "missed-by-tooling",
    reportedBy: "user",
    evidenceRefs: ["gap-discovery-teaching-case-ledger-feedback-ingestion", { ref: "E-ARCH-PM-IDENTITY", sha256: sha256("E-ARCH-PM-IDENTITY") }],
    components: ["plugin/scripts/meta-driver.ts", "plugin/scripts/probe-routine.ts", "plugin/scripts/routine-file-gate.ts"],
    summary: SUMMARY,
  });
  assert.equal(r.ok, true, `expected acceptance, got ${r.reasons?.join(",")}`);
  assert.match(r.id, /^experience-[0-9a-f]{16}$/, "content-addressed id, same scheme as the evidence store");
  assert.equal(r.record.reported_by, "user");
  assert.equal(r.record.source_ref, null, "the manual path is not derived from any record");
  assert.equal(r.record.evidence[0].sha256, sha256("gap-discovery-teaching-case-ledger-feedback-ingestion"), "a string ref is content-addressed as sha256(ref)");
  assert.equal(lines(root), 1);
  const read = readExperienceLedger(root);
  assert.equal(read.ok, true);
  assert.equal(read.records.length, 1);
  assert.equal(read.records[0].kind, EXPERIENCE_KIND);
  assert.equal(ledgerFile(root), path.join(root, EXPERIENCE_LEDGER_REL));
  assert.equal(EXPERIENCE_LEDGER_REL, ".quay/discovery-experience-ledger.jsonl");
});

test("AC1(a): a refused manual case appends NOTHING and does not even create the carrier", () => {
  const root = mkTmp();
  const r = ingestFeedback(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: [], summary: SUMMARY });
  assert.equal(r.ok, false);
  assert.equal(r.appended, false);
  assert.equal(lines(root), 0);
  assert.equal(fs.existsSync(ledgerFile(root)), false, "no carrier file is created by refusals alone");
});

// ── AC1(b): zero evidence refs is refused with its OWN code ─────────────────────────────────────

test("AC1(b): a case with zero evidence refs is refused, with a code distinct from the absent-field one", () => {
  const root = mkTmp();
  for (const empty of [[], "not-an-array"]) {
    const r = ingestFeedback(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: empty, summary: SUMMARY });
    assert.equal(r.ok, false, `evidenceRefs=${JSON.stringify(empty)} must be refused`);
    assert.ok(r.reasons.some((x) => x.startsWith("EVIDENCE_UNGROUNDED:")), `distinct code, got ${r.reasons.join(",")}`);
  }
  const rec = { case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", reported_by: "user", source_ref: null, components: [], summary: SUMMARY };
  delete rec.evidence;
  assert.deepEqual(validateExperienceRecord(rec).reasons, ["SCHEMA_MISSING:evidence"], "absent is a DIFFERENT cause from present-but-empty");
  assert.equal(lines(root), 0);
});

// ── AC1(c): reported_by outside the two-value vocab is refused ──────────────────────────────────

test("AC1(c): reported_by outside the two-value vocab is refused, naming the value", () => {
  const root = mkTmp();
  for (const bad of ["operator", "", null, 1]) {
    const r = ingestFeedback(root, { caseId: "x", role: "found-and-fixed", reportedBy: bad, evidenceRefs: ["a"], summary: SUMMARY });
    assert.equal(r.ok, false, `reported_by=${JSON.stringify(bad)} must be refused`);
    assert.ok(r.reasons.some((x) => x.startsWith("REPORTED_BY_NOT_IN_VOCAB:")), r.reasons.join(","));
  }
  assert.deepEqual([...REPORTED_BY_VOCAB], ["user", "system"]);
  assert.equal(lines(root), 0);
});

// ── AC1(d): an insubstantial summary is refused ─────────────────────────────────────────────────

test("AC1(d): a summary under 40 non-whitespace chars is refused; whitespace does not count", () => {
  const root = mkTmp();
  const short = "too short to teach anything at all";
  assert.ok(short.replace(/\s+/g, "").length < MIN_SUMMARY_CHARS);
  const r = ingestFeedback(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: ["a"], summary: short });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("SUMMARY_INSUBSTANTIAL:")), r.reasons.join(","));
  // Padding with whitespace does not clear the gate — the measure is non-whitespace chars.
  const padded = `${"a b c ".repeat(20)}`.trim();
  assert.ok(padded.replace(/\s+/g, "").length >= MIN_SUMMARY_CHARS);
  assert.equal(ingestFeedback(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: ["a"], summary: "  ".repeat(80) }).ok, false, "whitespace alone is not substance");
  assert.equal(lines(root), 0);
});

// ── AC1(e): the AUTOMATIC adapter derives reported_by:"system" + source_ref ─────────────────────

test("AC1(e): ingestFromEvidenceStoreOutcome derives reported_by:\"system\", source_ref and a line-hash", () => {
  const root = mkTmp();
  const [written] = writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 5", verdict: "supported" }]);
  const r = ingestFromEvidenceStoreOutcome(root, {
    experiment: "E-FIX", experimentRef: "E-FIX cluster 5", role: "found-and-fixed", caseId: "EXP-fix-5",
    components: ["plugin/scripts/fixture-check.ts"], summary: SUMMARY,
  });
  assert.equal(r.ok, true, `expected acceptance, got ${r.reasons?.join(",")}`);
  assert.equal(r.record.reported_by, "system", "an auto-derived case is NEVER reported as user");
  assert.equal(r.record.source_ref, written.id, "source_ref points at the record it projects");
  assert.equal(r.record.evidence.length, 1);
  assert.equal(r.record.evidence[0].ref, written.id);
  assert.equal(r.record.evidence[0].sha256, lineSha(storeFile(root), 1), "the digest is of the record's OWN carrier line");
  assert.equal(r.record.ts, "2026-10-12T00:00:00Z", "ts is derived from the matched record");
  assert.equal(r.derived_from.verdict, "supported");
  assert.equal(r.derived_from.line, 1);
  // A substring ref resolves too (the task body names clusters as "E-DT-1-Hp cluster 11").
  const sub = ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "cluster 5", role: "found-and-fixed", caseId: "c2", summary: SUMMARY });
  assert.equal(sub.ok, true, sub.reasons?.join(","));
});

test("AC1(e): a named outcome record that does not exist is REFUSED, and nothing is appended", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 5", verdict: "supported" }]);
  const missing = ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "E-FIX cluster 99", role: "found-and-fixed", caseId: "c-missing", summary: SUMMARY });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.reasons, ["EVIDENCE_OUTCOME_NOT_FOUND:E-FIX#E-FIX cluster 99"]);
  // A store that is entirely absent is its OWN value, never "nothing matched, so it is fine".
  const bare = ingestFromEvidenceStoreOutcome(mkTmp(), { experiment: "E-FIX", experimentRef: "x", role: "found-and-fixed", caseId: "c-bare", summary: SUMMARY });
  assert.equal(bare.ok, false);
  assert.ok(bare.reasons.some((x) => x.startsWith("EVIDENCE_STORE_MISSING:")), bare.reasons.join(","));
  // The three LOOKUP args and the caller-chosen identity each have their own absent-arg code.
  assert.deepEqual(ingestFromEvidenceStoreOutcome(root, { experimentRef: "x", role: "found-and-fixed", caseId: "c", summary: SUMMARY }).reasons, ["INGEST_ARG_MISSING:experiment"]);
  assert.deepEqual(ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", role: "found-and-fixed", caseId: "c", summary: SUMMARY }).reasons, ["INGEST_ARG_MISSING:experimentRef"]);
  assert.deepEqual(ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "x", role: "found-and-fixed", summary: SUMMARY }).reasons, ["INGEST_ARG_MISSING:caseId"]);
  assert.equal(lines(root), 0);
});

test("AC1(e): an AMBIGUOUS ref is reported with its candidates, never resolved arbitrarily (枚举, not boolean)", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported" }, { experiment_ref: "E-FIX cluster 11", verdict: "supported" }]);
  const amb = ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "cluster 1", role: "found-and-fixed", caseId: "c-amb", summary: SUMMARY });
  assert.equal(amb.ok, false);
  assert.ok(amb.reasons.some((x) => x.startsWith("EVIDENCE_OUTCOME_AMBIGUOUS:")), amb.reasons.join(","));
  assert.equal(amb.matches.length, 2, "the candidates are named, so the caller can disambiguate");
  assert.equal(lines(root), 0);
});

// ── AC1(f): a role that contradicts the stored verdict is refused with a distinct code ──────────

test("AC1(f): a claimed role contradicting the record's stored verdict is refused with its own code", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "E-FIX ok", verdict: "supported" }, { experiment_ref: "E-FIX neg", verdict: "refuted" }]);
  const bad = ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "E-FIX ok", role: "confirmed-negative", caseId: "c-bad", summary: SUMMARY });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((x) => x.startsWith("ROLE_VERDICT_INCONSISTENT:")), bad.reasons.join(","));
  assert.ok(bad.reasons.some((x) => x.includes("stored-supported")), "the refusal names the verdict it actually found");
  // The compatible role on the same record is accepted — the refusal is caused by the ROLE, not the record.
  assert.equal(ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "E-FIX ok", role: "found-and-fixed", caseId: "c-ok", summary: SUMMARY }).ok, true);
  // And the mirror: a refuted record accepts confirmed-negative but NOT found-and-fixed.
  assert.equal(ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "E-FIX neg", role: "found-and-fixed", caseId: "c2", summary: SUMMARY }).ok, false);
  assert.equal(ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "E-FIX neg", role: "confirmed-negative", caseId: "c3", summary: SUMMARY }).ok, true);
  assert.equal(lines(root), 2, "only the two accepted entries were appended");
});

// ── AC1(g): the deny-list flags a fabricated line naming a registered component ─────────────────

test("AC1(g): experienceDenyList flags an inventory line naming a registered component, and not an unrelated one", () => {
  const root = mkTmp();
  ingestFeedback(root, { caseId: "TEACH-probe-meta-coupling", role: "missed-by-tooling", evidenceRefs: ["x"], components: ["plugin/scripts/probe-routine.ts", "plugin/scripts/meta-driver.ts"], summary: SUMMARY });
  ingestFeedback(root, { caseId: "TEACH-other", role: "found-and-fixed", evidenceRefs: ["y"], components: ["plugin/scripts/other-check.ts"], summary: SUMMARY });
  const dl = experienceDenyList(root);
  assert.equal(dl.ok, true);
  assert.equal(dl.evaluated, 2);
  assert.deepEqual(dl.components, ["plugin/scripts/meta-driver.ts", "plugin/scripts/other-check.ts", "plugin/scripts/probe-routine.ts"], "the union of every registered case's components");
  assert.deepEqual(dl.case_ids, ["TEACH-other", "TEACH-probe-meta-coupling"]);
  // A whole-token match: the basename is what an inventory names, and it is not a substring match.
  assert.equal(scanExperienceLeak(dl, "- plugin/scripts/probe-routine.ts — reads the routine file").flagged, true);
  assert.equal(scanExperienceLeak(dl, "probe-routine.ts").flagged, true);
  assert.equal(scanExperienceLeak(dl, "a line naming something/probe-routine.ts.bak").flagged, false, "not a bare substring");
  assert.equal(scanExperienceLeak(dl, "a line naming x-probe-routine.ts").flagged, false);
  assert.equal(scanExperienceLeak(dl, "- plugin/scripts/unrelated-thing.ts — nothing to do with any case").flagged, false);
  // …and the composed form the AC names IS the same scan (one matching implementation, not two).
  const composed = experienceDenyList(root, { scanText: "- plugin/scripts/probe-routine.ts" });
  assert.equal(composed.flagged, true);
  assert.equal(composed.matches[0].value, "plugin/scripts/probe-routine.ts");
  assert.equal(experienceDenyList(root, { scanText: "- plugin/scripts/unrelated-thing.ts" }).flagged, false);
});

test("the deny-list emits patterns only where a pattern can FIRE (summary text is data, not a pattern)", () => {
  const root = mkTmp();
  ingestFeedback(root, { caseId: "TEACH-x", role: "confirmed-negative", evidenceRefs: ["x"], components: ["plugin/scripts/touches-parser.ts"], summary: SUMMARY });
  const dl = experienceDenyList(root);
  assert.equal(dl.summaries.length, 1, "the summary is still returned as data");
  // Only component + case_id patterns exist: 1 component + 1 case_id. A whole-sentence summary regex
  // could never match an inventory line, so emitting one would be a pattern that cannot be false.
  assert.equal(dl.patterns.length, 2, `patterns = components + case_ids, got ${dl.patterns.length}`);
  assert.ok(dl.patterns.every((re) => !re.test(SUMMARY)), "no emitted pattern matches the raw summary");
});

// ── AC1(h): an empty / absent ledger does not crash ─────────────────────────────────────────────

test("AC1(h): experienceDenyList on an empty (and on an absent) ledger runs without crashing", () => {
  const root = mkTmp();
  const absent = experienceDenyList(root);
  assert.deepEqual({ ok: absent.ok, evaluated: absent.evaluated, components: absent.components, patterns: absent.patterns, malformed_lines: absent.malformed_lines },
    { ok: true, evaluated: 0, components: [], patterns: [], malformed_lines: 0 });
  assert.equal(absent.flagged, undefined, "no scanText ⇒ no verdict field is fabricated");
  fs.mkdirSync(path.dirname(ledgerFile(root)), { recursive: true });
  fs.writeFileSync(ledgerFile(root), "", "utf8");
  const empty = experienceDenyList(root, { scanText: "anything at all" });
  assert.equal(empty.ok, true);
  assert.equal(empty.flagged, false, "an empty deny-list flags nothing");
});

test("a PARTIALLY readable ledger is reported as not-ok, never read as a complete deny-list", () => {
  const root = mkTmp();
  ingestFeedback(root, { caseId: "TEACH-x", role: "confirmed-negative", evidenceRefs: ["x"], components: ["plugin/scripts/touches-parser.ts"], summary: SUMMARY });
  fs.appendFileSync(ledgerFile(root), "{not json\n", "utf8");
  const dl = experienceDenyList(root);
  assert.equal(dl.ok, false, "a deny-list that cannot read part of the ledger must not read as complete");
  assert.equal(dl.malformed_lines, 1);
  assert.deepEqual(dl.components, ["plugin/scripts/touches-parser.ts"], "the readable part is still returned");
});

// ── the record contract: enumerable refusals, the source_ref invariant, and the new role ────────

test("the refusal vocabulary is enumerable — every required field has its own absent-key code", () => {
  const root = mkTmp();
  const GOOD = { case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", reported_by: "user", source_ref: null, evidence: [{ ref: "a", sha256: sha256("a") }], components: [], summary: SUMMARY };
  assert.deepEqual(validateExperienceRecord(null).reasons, ["RECORD_NOT_OBJECT"]);
  for (const f of REQUIRED_EXPERIENCE_FIELDS) {
    const rec = { ...GOOD }; delete rec[f];
    assert.deepEqual(validateExperienceRecord(rec).reasons, [`SCHEMA_MISSING:${f}`], f);
  }
  assert.equal(validateExperienceRecord({ ...GOOD, role: "gone" }).reasons.join(), "ROLE_NOT_IN_VOCAB:gone");
  assert.equal(validateExperienceRecord({ ...GOOD, evidence: [{ ref: "a", sha256: "not-hex" }] }).reasons.join(), "FIELD_INVALID:evidence[0].sha256");
  assert.equal(validateExperienceRecord({ ...GOOD, components: ["ok", ""] }).reasons.join(), "FIELD_INVALID:components-needs-[non-empty-string]");
  assert.equal(lines(root), 0);
});

test("source_ref is a structural invariant in BOTH directions, each with its own code", () => {
  const root = mkTmp();
  const base = { case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", evidence: [{ ref: "a", sha256: sha256("a") }], components: [], summary: SUMMARY };
  assert.deepEqual(validateExperienceRecord({ ...base, reported_by: "system", source_ref: null }).reasons, ["SOURCE_REF_REQUIRED_FOR_SYSTEM:reported_by=system-must-name-the-evidence-store-record-it-was-derived-from"]);
  assert.deepEqual(validateExperienceRecord({ ...base, reported_by: "user", source_ref: "outcome-deadbeef" }).reasons, ["SOURCE_REF_MUST_BE_NULL_FOR_USER:reported_by=user-was-not-derived-from-any-record"]);
  assert.equal(validateExperienceRecord({ ...base, reported_by: "system", source_ref: "outcome-deadbeef" }).ok, true);
  assert.equal(lines(root), 0);
});

test("`recurred-after-fix` is IN the vocabulary and is accepted (a future recurrence is not blocked)", () => {
  const root = mkTmp();
  assert.ok(EXPERIENCE_ROLES.includes("recurred-after-fix"));
  assert.deepEqual([...EXPERIENCE_ROLES], ["missed-by-tooling", "found-and-fixed", "found-undetermined-then-confirmed", "confirmed-negative", "recurred-after-fix"]);
  const r = ingestFeedback(root, { caseId: "TEACH-recurrence", role: "recurred-after-fix", evidenceRefs: ["x"], summary: SUMMARY });
  assert.equal(r.ok, true, r.reasons?.join(","));
  // …and the automatic path accepts it against a `supported` record, since a recurrence is observed.
  writeFixtureStore(root, [{ experiment_ref: "E-FIX back", verdict: "supported" }]);
  assert.equal(ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "E-FIX back", role: "recurred-after-fix", caseId: "c-recur", summary: SUMMARY }).ok, true);
  assert.deepEqual([...ROLE_VERDICT_COMPAT["found-undetermined-then-confirmed"]], ["undetermined"]);
});

test("records are content-addressed: identical content ⇒ one id, a changed field ⇒ a different id", () => {
  const rec = { case_id: "x", ts: "t", role: "found-and-fixed", reported_by: "user", source_ref: null, evidence: [{ ref: "a", sha256: sha256("a") }], components: [], summary: SUMMARY };
  assert.equal(experienceRecordId(rec), experienceRecordId({ ...rec }));
  assert.notEqual(experienceRecordId(rec), experienceRecordId({ ...rec, case_id: "y" }));
});
