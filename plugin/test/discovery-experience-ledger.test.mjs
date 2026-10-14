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
import { execFileSync, spawn } from "node:child_process";

import {
  EXPERIENCE_LEDGER_REL, EXPERIENCE_KIND, EXPERIENCE_ROLES, REPORTED_BY_VOCAB, MIN_SUMMARY_CHARS,
  REQUIRED_EXPERIENCE_FIELDS, ROLE_VERDICT_COMPAT, VERDICT_ROLE, MAX_SUMMARY_CHARS,
  SHARED_CHECKOUT_UNRESOLVED, DUPLICATE_ID, CARRIER_NOT_TORN,
  WATERMARK_MISMATCH, SYSTEM_FIELD_NOT_CALLER_WRITABLE, SOURCE_NOT_IN_VOCAB, INGEST_WATERMARK_REL,
  ledgerFile, validateExperienceRecord, appendExperienceRecord, readExperienceLedger,
  ingestFeedback, ingestFromEvidenceStoreOutcome, experienceDenyList, scanExperienceLeak,
  experienceRecordId, resolveCarrierRoot, repairCarrier,
  ingestExperience, ingestNewOutcomes, deriveExperienceFields, deriveExperienceSummary,
  componentsFromSubjectKey, evaluationPinOf, readIngestWatermark, sharedStoreFile, ensureEvidenceStore,
  AUTHORED_BY_ACTORS, USER_PROVENANCE_KINDS, MIN_USER_QUOTE_CHARS, DERIVED_INGEST_AUTHOR,
  USER_PROVENANCE_MISSING, USER_SOURCE_FROM_WORKER, EXPERIENCE_CORRECTION_KIND, CORRECTABLE_FIELDS,
  CORRECTION_TARGET_NOT_FOUND, CORRECTION_FIELD_NOT_CORRECTABLE, MIN_CORRECTION_REASON_CHARS,
  INGEST_SKIPS_REL, INGEST_SKIP_KIND, SKIP_VERDICT_NOT_INGESTIBLE, SKIP_DUPLICATE_SOURCE_REF,
  SKIP_READ_FAILED, SKIP_MALFORMED, VERDICT_ROLE_MAPPING_VERSION, verdictRoleMappingVersion,
  skipDedupKey, ingestSkipId, ingestSkipsFile, readIngestSkips, appendIngestSkip,
  appendExperienceCorrection, readExperienceCorrections, applyExperienceCorrections, backfillIngestSkips,
  CLAIM_BEARING_KINDS, claimIndex, joinOutcomeToClaims,
  JOIN_LINKED, JOIN_NO_CLAIM_RECORD, JOIN_INDEX_UNAVAILABLE,
  // The evidence level (task gap-discovery-evidence-level-teaching-vs-independent).
  EVIDENCE_LEVELS, EVIDENCE_LEVEL_VALUES, UNLABELLED_EVIDENCE_LEVEL, INDEPENDENT_EVIDENCE_LEVEL,
  CASE_REUSE_EVIDENCE_LEVELS, SOURCE_CASE_REQUIRED, SOURCE_CASE_NOT_APPLICABLE_FOR_INDEPENDENT,
  evidenceLevelOf, isIndependentEvidenceLevel, allowsCaseReuse,
  // The ROUTINE-CARRIER source (task gap-open-discovery-findings-into-portfolio-experience).
  CARRIER_CLUSTER_KIND, clusterVerdict, clusterCaseId,
} from "../../docs/analysis/discovery-experience-ledger.mjs";

/** The writable "no claim" level, spelled once so the fixtures below cannot drift from the vocabulary. */
const UNLABELLED = UNLABELLED_EVIDENCE_LEVEL;
import { appendOutcomeRecord, appendHypothesisRecord, appendCounterexampleRecord, readRecords, storeFile, sha256 } from "../../docs/analysis/architecture-evidence-store.mjs";
// The CANONICAL shared-checkout resolver (`plugin/scripts/per-task-suite-record.ts`). The ledger module
// cannot import it (a `.ts` specifier needs type-stripping that plain `node` does not do for a
// `docs/analysis/*.mjs` consumer), so the equivalence is asserted HERE — an executable invariant
// instead of a promise that the two copies agree.
import { resolveSharedCheckout } from "../../plugin/scripts/per-task-suite-record.ts";

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

/** A REAL git repo (git dir under `os.tmpdir()`, never inside the repo root — a test that writes into
 *  the checked-in tree is judged by `checked-in-write-check`). The Discovery carriers resolve through
 *  `git rev-parse --git-common-dir`, so a bare directory is no longer a usable fixture root: an
 *  unresolvable shared checkout is REFUSED by design (AC2(b)). */
const plainTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-experience-ledger-")); tmpDirs.push(d); return d; };
const mkTmp = () => {
  const d = plainTmp();
  execFileSync("git", ["init", "-q", d], { stdio: "ignore" });
  return d;
};

/** A fixture whose MAIN checkout and linked WORKTREE are both real: what "writing from a task worktree"
 *  actually looks like. `git worktree add` is a CHILD process, so its writes into `<main>/.git/` are
 *  invisible to the in-tree write judge (and both live under `os.tmpdir()` anyway). */
const mkWorktreePair = () => {
  const main = mkTmp();
  const git = (...a) => execFileSync("git", ["-C", main, ...a], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  fs.writeFileSync(path.join(main, "seed.txt"), "seed\n");
  git("add", "-A"); git("commit", "-qm", "seed");
  const wt = path.join(plainTmp(), "wt");
  git("worktree", "add", "-q", "-b", "task/fixture", wt);
  return { main, worktree: wt };
};

const lines = (root) => { const f = ledgerFile(root); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0; };
const SUMMARY = "the deny-list must not be derivable from anything but the ledger's actual recorded contents";

/**
 * The two provenance fields EVERY new entry needs. ⛔ These are TEST constants, not adapter defaults:
 * the production adapters default NEITHER (`authoredBy` is in `REQUIRED_EXPERIENCE_FIELDS`, and
 * `user_provenance` is required whenever `reported_by` is `"user"`), because a default is precisely how
 * the 2026-10-12 defect happened — a worker's own finding ended up stored as a human report.
 */
const OPERATOR = Object.freeze({ actor: "operator-session", ref: "session-e6db01fa" });
const WORKER = Object.freeze({ actor: "task-worker", ref: "gap-fixture-worker" });
const QUOTE = "the user pointed out that probe and meta are coupled in a way no tool had surfaced";
const USER_PROV = Object.freeze({ kind: "conversation", ref: "session-e6db01fa", quote: QUOTE });

/** `ingestFeedback` with the two provenance fields filled in. It exists so the ~20 tests that are NOT
 *  about provenance stay readable; every one of them would otherwise be a refusal, which is the point
 *  of the fields. Tests that ARE about provenance call `ingestFeedback` directly. */
const ingestUser = (root, args) => ingestFeedback(root, { authoredBy: OPERATOR, userProvenance: USER_PROV, ...args });

/** `ingestFromEvidenceStoreOutcome` — the PINNED system adapter. It requires an author too: the pinned
 *  caller narrates the entry, so the pinned caller is the one that has to say who it is. */
const ingestPinned = (root, args) => ingestFromEvidenceStoreOutcome(root, { authoredBy: OPERATOR, ...args });

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
  const r = ingestUser(root, {
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
  const r = ingestUser(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: [], summary: SUMMARY });
  assert.equal(r.ok, false);
  assert.equal(r.appended, false);
  assert.equal(lines(root), 0);
  assert.equal(fs.existsSync(ledgerFile(root)), false, "no carrier file is created by refusals alone");
});

// ── AC1(b): zero evidence refs is refused with its OWN code ─────────────────────────────────────

test("AC1(b): a case with zero evidence refs is refused, with a code distinct from the absent-field one", () => {
  const root = mkTmp();
  for (const empty of [[], "not-an-array"]) {
    const r = ingestUser(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: empty, summary: SUMMARY });
    assert.equal(r.ok, false, `evidenceRefs=${JSON.stringify(empty)} must be refused`);
    assert.ok(r.reasons.some((x) => x.startsWith("EVIDENCE_UNGROUNDED:")), `distinct code, got ${r.reasons.join(",")}`);
  }
  const rec = { case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", reported_by: "user", authored_by: OPERATOR, user_provenance: USER_PROV, source_ref: null, components: [], summary: SUMMARY, evidence_level: UNLABELLED };
  delete rec.evidence;
  assert.deepEqual(validateExperienceRecord(rec).reasons, ["SCHEMA_MISSING:evidence"], "absent is a DIFFERENT cause from present-but-empty");
  assert.equal(lines(root), 0);
});

// ── AC1(c): reported_by outside the two-value vocab is refused ──────────────────────────────────

test("AC1(c): reported_by outside the two-value vocab is refused, naming the value", () => {
  const root = mkTmp();
  for (const bad of ["operator", "", null, 1]) {
    const r = ingestUser(root, { caseId: "x", role: "found-and-fixed", reportedBy: bad, evidenceRefs: ["a"], summary: SUMMARY });
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
  const r = ingestUser(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: ["a"], summary: short });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("SUMMARY_INSUBSTANTIAL:")), r.reasons.join(","));
  // Padding with whitespace does not clear the gate — the measure is non-whitespace chars.
  const padded = `${"a b c ".repeat(20)}`.trim();
  assert.ok(padded.replace(/\s+/g, "").length >= MIN_SUMMARY_CHARS);
  assert.equal(ingestUser(root, { caseId: "x", role: "found-and-fixed", evidenceRefs: ["a"], summary: "  ".repeat(80) }).ok, false, "whitespace alone is not substance");
  assert.equal(lines(root), 0);
});

// ── AC1(e): the AUTOMATIC adapter derives reported_by:"system" + source_ref ─────────────────────

test("AC1(e): ingestFromEvidenceStoreOutcome derives reported_by:\"system\", source_ref and a line-hash", () => {
  const root = mkTmp();
  const [written] = writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 5", verdict: "supported" }]);
  const r = ingestPinned(root, {
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
  const sub = ingestPinned(root, { experiment: "E-FIX", experimentRef: "cluster 5", role: "found-and-fixed", caseId: "c2", summary: SUMMARY });
  assert.equal(sub.ok, true, sub.reasons?.join(","));
});

test("AC1(e): a named outcome record that does not exist is REFUSED, and nothing is appended", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 5", verdict: "supported" }]);
  const missing = ingestPinned(root, { experiment: "E-FIX", experimentRef: "E-FIX cluster 99", role: "found-and-fixed", caseId: "c-missing", summary: SUMMARY });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.reasons, ["EVIDENCE_OUTCOME_NOT_FOUND:E-FIX#E-FIX cluster 99"]);
  // A store that is entirely absent is its OWN value, never "nothing matched, so it is fine".
  const bare = ingestPinned(mkTmp(), { experiment: "E-FIX", experimentRef: "x", role: "found-and-fixed", caseId: "c-bare", summary: SUMMARY });
  assert.equal(bare.ok, false);
  assert.ok(bare.reasons.some((x) => x.startsWith("EVIDENCE_STORE_MISSING:")), bare.reasons.join(","));
  // The three LOOKUP args and the caller-chosen identity each have their own absent-arg code.
  assert.deepEqual(ingestPinned(root, { experimentRef: "x", role: "found-and-fixed", caseId: "c", summary: SUMMARY }).reasons, ["INGEST_ARG_MISSING:experiment"]);
  assert.deepEqual(ingestPinned(root, { experiment: "E-FIX", role: "found-and-fixed", caseId: "c", summary: SUMMARY }).reasons, ["INGEST_ARG_MISSING:experimentRef"]);
  assert.deepEqual(ingestPinned(root, { experiment: "E-FIX", experimentRef: "x", role: "found-and-fixed", summary: SUMMARY }).reasons, ["INGEST_ARG_MISSING:caseId"]);
  assert.equal(lines(root), 0);
});

test("AC1(e): an AMBIGUOUS ref is reported with its candidates, never resolved arbitrarily (枚举, not boolean)", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported" }, { experiment_ref: "E-FIX cluster 11", verdict: "supported" }]);
  const amb = ingestPinned(root, { experiment: "E-FIX", experimentRef: "cluster 1", role: "found-and-fixed", caseId: "c-amb", summary: SUMMARY });
  assert.equal(amb.ok, false);
  assert.ok(amb.reasons.some((x) => x.startsWith("EVIDENCE_OUTCOME_AMBIGUOUS:")), amb.reasons.join(","));
  assert.equal(amb.matches.length, 2, "the candidates are named, so the caller can disambiguate");
  assert.equal(lines(root), 0);
});

// ── AC1(f): a role that contradicts the stored verdict is refused with a distinct code ──────────

test("AC1(f): a claimed role contradicting the record's stored verdict is refused with its own code", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "E-FIX ok", verdict: "supported" }, { experiment_ref: "E-FIX neg", verdict: "refuted" }]);
  const bad = ingestPinned(root, { experiment: "E-FIX", experimentRef: "E-FIX ok", role: "confirmed-negative", caseId: "c-bad", summary: SUMMARY });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((x) => x.startsWith("ROLE_VERDICT_INCONSISTENT:")), bad.reasons.join(","));
  assert.ok(bad.reasons.some((x) => x.includes("stored-supported")), "the refusal names the verdict it actually found");
  // The compatible role on the same record is accepted — the refusal is caused by the ROLE, not the record.
  assert.equal(ingestPinned(root, { experiment: "E-FIX", experimentRef: "E-FIX ok", role: "found-and-fixed", caseId: "c-ok", summary: SUMMARY }).ok, true);
  // And the mirror: a refuted record accepts confirmed-negative but NOT found-and-fixed.
  assert.equal(ingestPinned(root, { experiment: "E-FIX", experimentRef: "E-FIX neg", role: "found-and-fixed", caseId: "c2", summary: SUMMARY }).ok, false);
  assert.equal(ingestPinned(root, { experiment: "E-FIX", experimentRef: "E-FIX neg", role: "confirmed-negative", caseId: "c3", summary: SUMMARY }).ok, true);
  assert.equal(lines(root), 2, "only the two accepted entries were appended");
});

// ── AC1(g): the deny-list flags a fabricated line naming a registered component ─────────────────

test("AC1(g): experienceDenyList flags an inventory line naming a registered component, and not an unrelated one", () => {
  const root = mkTmp();
  ingestUser(root, { caseId: "TEACH-probe-meta-coupling", role: "missed-by-tooling", evidenceRefs: ["x"], components: ["plugin/scripts/probe-routine.ts", "plugin/scripts/meta-driver.ts"], summary: SUMMARY });
  ingestUser(root, { caseId: "TEACH-other", role: "found-and-fixed", evidenceRefs: ["y"], components: ["plugin/scripts/other-check.ts"], summary: SUMMARY });
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
  ingestUser(root, { caseId: "TEACH-x", role: "confirmed-negative", evidenceRefs: ["x"], components: ["plugin/scripts/touches-parser.ts"], summary: SUMMARY });
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
  ingestUser(root, { caseId: "TEACH-x", role: "confirmed-negative", evidenceRefs: ["x"], components: ["plugin/scripts/touches-parser.ts"], summary: SUMMARY });
  fs.appendFileSync(ledgerFile(root), "{not json\n", "utf8");
  const dl = experienceDenyList(root);
  assert.equal(dl.ok, false, "a deny-list that cannot read part of the ledger must not read as complete");
  assert.equal(dl.malformed_lines, 1);
  assert.deepEqual(dl.components, ["plugin/scripts/touches-parser.ts"], "the readable part is still returned");
});

// ── the record contract: enumerable refusals, the source_ref invariant, and the new role ────────

test("the refusal vocabulary is enumerable — every required field has its own absent-key code", () => {
  const root = mkTmp();
  const GOOD = { case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", reported_by: "user", authored_by: OPERATOR, user_provenance: USER_PROV, source_ref: null, evidence: [{ ref: "a", sha256: sha256("a") }], components: [], summary: SUMMARY, evidence_level: UNLABELLED };
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
  const base = { case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", authored_by: OPERATOR, evidence: [{ ref: "a", sha256: sha256("a") }], components: [], summary: SUMMARY, evidence_level: UNLABELLED };
  assert.deepEqual(validateExperienceRecord({ ...base, reported_by: "system", source_ref: null }).reasons, ["SOURCE_REF_REQUIRED_FOR_SYSTEM:reported_by=system-must-name-the-evidence-store-record-it-was-derived-from"]);
  assert.deepEqual(validateExperienceRecord({ ...base, reported_by: "user", user_provenance: USER_PROV, source_ref: "outcome-deadbeef" }).reasons, ["SOURCE_REF_MUST_BE_NULL_FOR_USER:reported_by=user-was-not-derived-from-any-record"]);
  assert.equal(validateExperienceRecord({ ...base, reported_by: "system", source_ref: "outcome-deadbeef" }).ok, true);
  assert.equal(lines(root), 0);
});

test("`recurred-after-fix` is IN the vocabulary and is accepted (a future recurrence is not blocked)", () => {
  const root = mkTmp();
  assert.ok(EXPERIENCE_ROLES.includes("recurred-after-fix"));
  assert.deepEqual([...EXPERIENCE_ROLES], ["missed-by-tooling", "found-and-fixed", "found-undetermined-then-confirmed", "confirmed-negative", "recurred-after-fix", "found-unresolved", "undetermined", "duplicate"]);
  const r = ingestUser(root, { caseId: "TEACH-recurrence", role: "recurred-after-fix", evidenceRefs: ["x"], summary: SUMMARY });
  assert.equal(r.ok, true, r.reasons?.join(","));
  // …and the automatic path accepts it against a `supported` record, since a recurrence is observed.
  writeFixtureStore(root, [{ experiment_ref: "E-FIX back", verdict: "supported" }]);
  assert.equal(ingestPinned(root, { experiment: "E-FIX", experimentRef: "E-FIX back", role: "recurred-after-fix", caseId: "c-recur", summary: SUMMARY }).ok, true);
  assert.deepEqual([...ROLE_VERDICT_COMPAT["found-undetermined-then-confirmed"]], ["undetermined"]);
});

test("records are content-addressed: identical content ⇒ one id, a changed field ⇒ a different id", () => {
  const rec = { case_id: "x", ts: "t", role: "found-and-fixed", reported_by: "user", source_ref: null, evidence: [{ ref: "a", sha256: sha256("a") }], components: [], summary: SUMMARY };
  assert.equal(experienceRecordId(rec), experienceRecordId({ ...rec }));
  assert.notEqual(experienceRecordId(rec), experienceRecordId({ ...rec, case_id: "y" }));
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// PERSISTENCE (task gap-discovery-carriers-ephemeral-in-worktree): the carriers resolve to the SHARED
// checkout, the append is atomic + idempotent, and a torn final line is repairable. Before this, every
// real run happened inside a task worktree and the whole Discovery runtime state died with it.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// `ts` is pinned: the id is content-addressed over the WHOLE record, so a defaulted "now" would make
// two nominally identical calls produce two different ids and the DUPLICATE_ID case untestable.
const AC_CASE = { caseId: "AC2-worktree-persistence", role: "found-and-fixed", evidenceRefs: ["gap-discovery-carriers-ephemeral-in-worktree"], components: ["docs/analysis/discovery-experience-ledger.mjs"], summary: SUMMARY, ts: "2026-10-12T00:00:00.000Z" };

test("AC2(a): a write from a linked git worktree lands in the fixture's MAIN checkout, not the worktree", () => {
  const { main, worktree } = mkWorktreePair();
  // The resolver agrees with the CANONICAL one (`per-task-suite-record.ts`) on the same fixture — the
  // duplicated git call is pinned to the canonical behaviour by an executable invariant.
  assert.equal(resolveCarrierRoot(worktree).root, resolveSharedCheckout(worktree));
  assert.equal(resolveCarrierRoot(main).root, resolveSharedCheckout(main));
  assert.notEqual(path.resolve(worktree), path.resolve(main), "the fixture really is two checkouts");

  const r = ingestUser(worktree, AC_CASE);
  assert.equal(r.ok, true, r.reasons?.join(","));
  const inMain = path.join(main, EXPERIENCE_LEDGER_REL);
  const inWorktree = path.join(worktree, EXPERIENCE_LEDGER_REL);
  assert.equal(r.file, inMain, "the write names the MAIN checkout's carrier");
  assert.equal(ledgerFile(worktree), inMain, "…and the path accessor resolves there too, from the worktree");
  assert.equal(fs.existsSync(inMain), true, "the carrier EXISTS under the main checkout");
  assert.equal(fs.existsSync(inWorktree), false, "…and does NOT exist under the worktree");
  assert.equal(readExperienceLedger(worktree).records.length, 1, "read back THROUGH the worktree root");
  assert.equal(readExperienceLedger(main).records.length, 1, "…and through the main root — one carrier, two views");
});

test("AC2(b): an unresolvable shared checkout is REFUSED — no carrier file is written anywhere", () => {
  const bare = plainTmp();                       // a plain directory: not a git repo at all
  assert.equal(resolveCarrierRoot(bare).ok, false);
  assert.match(resolveCarrierRoot(bare).reason, new RegExp(`^${SHARED_CHECKOUT_UNRESOLVED}:`));
  assert.equal(ledgerFile(bare), null, "an unresolvable root yields NO path (its own value, not a worktree path)");

  const r = ingestUser(bare, AC_CASE);
  assert.equal(r.ok, false);
  assert.equal(r.appended, false);
  assert.match(r.reasons[0], new RegExp(`^${SHARED_CHECKOUT_UNRESOLVED}:`), "the refusal names the resolver, not the record");
  assert.deepEqual(fs.readdirSync(bare), [], "NOTHING was created — not even the .quay/ directory");

  // Negative control on the same predicate: the SAME record against a git-repo root IS accepted, so
  // the refusal above is the resolver and not the record.
  assert.equal(ingestUser(mkTmp(), AC_CASE).ok, true);
});

test("AC2(c): re-appending the same record is DUPLICATE_ID and leaves the carrier byte-identical", () => {
  const root = mkTmp();
  const first = ingestUser(root, AC_CASE);
  assert.equal(first.ok, true, first.reasons?.join(","));
  const before = fs.readFileSync(ledgerFile(root), "utf8");
  assert.equal(before.split("\n").filter(Boolean).length, 1);

  const again = ingestUser(root, AC_CASE);
  assert.equal(again.ok, false);
  assert.equal(again.appended, false);
  assert.equal(again.duplicate, true, "'already there' is its OWN outcome, not a generic failure");
  assert.match(again.reasons[0], new RegExp(`^${DUPLICATE_ID}:${first.id}-`));
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), before, "the carrier is BYTE-IDENTICAL");
  assert.equal(again.id, first.id, "a content-addressed id is what makes the re-append detectable");

  // Negative control: a DIFFERENT record does append, so the skip is the id and not a blanket no.
  assert.equal(ingestUser(root, { ...AC_CASE, caseId: "AC2-worktree-persistence-2" }).ok, true);
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8").split("\n").filter(Boolean).length, 2);

  // …and the lock file is RELEASED (a lock left behind would wedge the carrier for every later run).
  assert.equal(fs.existsSync(`${ledgerFile(root)}.lock`), false);
});

test("AC2(d): a torn FINAL line reads as malformed_lines:1, and repairCarrier restores it with a backup", () => {
  const root = mkTmp();
  assert.equal(ingestUser(root, AC_CASE).ok, true);
  const good = fs.readFileSync(ledgerFile(root), "utf8");
  const tornFragment = '{"kind":"experience","id":"experience-torn0000000000","case_';   // a crash mid-append
  fs.appendFileSync(ledgerFile(root), tornFragment);

  const read = readExperienceLedger(root);
  assert.equal(read.malformed_lines, 1, "a torn carrier is never reported as clean OR as empty");
  assert.equal(read.ok, false);
  assert.equal(read.records.length, 1, "the whole lines are still returned");

  const fixed = repairCarrier(root, "discovery-experience-ledger", { now: Date.parse("2026-10-12T00:00:00Z") });
  assert.equal(fixed.ok, true, fixed.reasons?.join(","));
  assert.equal(fixed.repaired, true);
  assert.equal(fixed.removed_bytes, Buffer.byteLength(tornFragment), "it reports WHAT it removed (bytes)");
  assert.equal(fixed.removed_sample, tornFragment);
  assert.equal(fixed.malformed_before, 1);
  assert.equal(fixed.malformed_after, 0);
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), good, "the kept prefix is byte-identical to the pre-tear carrier");
  assert.ok(fixed.backup && fs.existsSync(fixed.backup), "the original is BACKED UP before anything is written");
  assert.equal(fs.readFileSync(fixed.backup, "utf8"), good + tornFragment, "the backup is the torn carrier, untouched");
  assert.equal(readExperienceLedger(root).malformed_lines, 0, "…and the carrier is parseable again");

  // IDEMPOTENT: a second repair on the now-clean carrier reports `repaired:false`, not a fake repair.
  const again = repairCarrier(root, "discovery-experience-ledger", { now: Date.parse("2026-10-12T00:00:00Z") });
  assert.equal(again.ok, true);
  assert.equal(again.repaired, false);
  assert.equal(again.backup, null);
});

test("AC2(d): repairCarrier refuses a MIDDLE-corruption carrier (truncation there would delete records)", () => {
  const root = mkTmp();
  assert.equal(ingestUser(root, AC_CASE).ok, true);
  const file = ledgerFile(root);
  const whole = fs.readFileSync(file, "utf8");
  // A torn fragment FOLLOWED by a good append: the unparseable line is no longer the FINAL one, so
  // "drop everything after the last good line" would silently delete the record below it.
  fs.writeFileSync(file, `${whole}{"kind":"experience","broken\n${whole}`);
  const before = fs.readFileSync(file, "utf8");

  const r = repairCarrier(root, "discovery-experience-ledger");
  assert.equal(r.ok, false);
  assert.equal(r.repaired, false);
  assert.match(r.reasons[0], new RegExp(`^${CARRIER_NOT_TORN}:`), "its OWN code — not the same shape as a clean carrier");
  assert.equal(fs.readFileSync(file, "utf8"), before, "the file is UNTOUCHED");
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes(".bak-")), [], "and no backup was made");

  // Its OWN value for "there is no such carrier": never the same shape as "repaired".
  const missing = repairCarrier(root, "discovery-method-registry");
  assert.equal(missing.ok, false);
  assert.match(missing.reasons[0], /^CARRIER_MISSING:/);
});

test("AC2(e): two concurrent appenders produce two WHOLE lines, never one interleaved line", async () => {
  const root = mkTmp();
  const file = ledgerFile(root);
  const moduleUrl = new URL("../../docs/analysis/discovery-experience-ledger.mjs", import.meta.url).href;
  // Each child appends ONE long record through the production append path. A ~4000-char payload is
  // long enough that two unsynchronised writers would interleave inside a line, and both children are
  // started in the same tick so they really contend for the lock.
  const child = (n) => `import { appendCarrierLine } from ${JSON.stringify(moduleUrl)};
const r = appendCarrierLine(${JSON.stringify(root)}, ".quay/discovery-experience-ledger.jsonl",
  { id: "experience-conc${n}", payload: "x".repeat(4000) + "|${n}|" }, { kind: "experience" });
if (!r.ok) { console.error(JSON.stringify(r.reasons)); process.exit(1); }`;
  const run = (n) => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", child(n)], { stdio: ["ignore", "ignore", "inherit"] });
    p.on("exit", (code) => resolve(code));
  });
  const codes = await Promise.all([run(1), run(2)]);
  assert.deepEqual(codes, [0, 0], "each appender succeeds — the lock SERIALISES, it does not fail a writer");

  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "exactly two lines");
  for (const l of lines) {
    assert.doesNotThrow(() => JSON.parse(l), `a WHOLE line, not an interleaved fragment: ${l.slice(0, 60)}…`);
    assert.equal(JSON.parse(l).payload.length, 4003, "…and each line carries its own complete payload");
  }
  assert.deepEqual(lines.map((l) => JSON.parse(l).id).sort(), ["experience-conc1", "experience-conc2"], "neither record overwrote the other");
  assert.equal(fs.existsSync(`${file}.lock`), false, "both locks were released");

  // Negative control on the SAME assertion: a deliberately interleaved carrier IS detected by the
  // per-line parse, so "two whole lines" above is a real reading rather than a predicate that cannot
  // fire.
  const half = '{"id":"experience-x","payload":"' + "y".repeat(50);
  fs.writeFileSync(path.join(root, "interleaved.jsonl"), `${half}\n${half}\n`);
  const bad = fs.readFileSync(path.join(root, "interleaved.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.equal(bad.length, 2);
  assert.throws(() => JSON.parse(bad[1]), "a half-written line does NOT parse — the predicate can go red");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AUTOMATIC INGESTION (task gap-discovery-experience-auto-ingest-from-evidence-store): ONE unified
// entry fed by two sources, and a batch ingester that DERIVES every field of a system Experience from
// the outcome record — no human picks the record and no human describes it.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** The `{rec, raw, line}` envelope a scanner produces, taken from the store the ingester reads. */
const outcomeEnvelope = (root, n = 1) => {
  const line = fs.readFileSync(storeFile(root), "utf8").split("\n")[n - 1];
  return { rec: JSON.parse(line), raw: line, line: n };
};
const rolesIn = (root) => readExperienceLedger(root).records.map((r) => r.role).sort();
const watermarkPath = (root) => path.join(root, INGEST_WATERMARK_REL);
const THREE = [
  { experiment_ref: "E-FIX cluster 1", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts,plugin/scripts/b.ts" },
  { experiment_ref: "E-FIX cluster 2", verdict: "refuted", subject_key: "hypgen:identity|plugin/scripts/c.ts" },
  { experiment_ref: "E-FIX cluster 3", verdict: "undetermined", subject_key: "hypgen:identity|plugin/scripts/d.ts" },
];

/** A REAL git repo with a `develop` branch carrying `tasks/<id>.md` at a given status — what the
 *  task-done half of the role derivation actually reads. */
const mkDevelopRepo = (taskId, status) => {
  const d = mkTmp();
  const git = (...a) => execFileSync("git", ["-C", d, ...a], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" },
  });
  fs.mkdirSync(path.join(d, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(d, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ${status}\n---\n\n## Proposal\nbody\n`);
  git("add", "-A");
  git("commit", "-qm", "seed");
  git("branch", "-M", "develop");
  return d;
};

// ── AC1(a): three outcomes ⇒ three Experiences, the watermark on the last line ───────────────────

test("INGEST(a): a store with 3 outcomes ⇒ 3 Experiences with derived roles, watermark at the last line", () => {
  const root = mkTmp();
  writeFixtureStore(root, THREE);
  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.store, path.join(root, ".quay", "architecture-evidence-store.jsonl"));
  assert.equal(r.scanned, 3);
  assert.equal(r.ingested, 3);
  assert.equal(r.duplicates, 0);
  assert.equal(r.skipped_not_ingestible, 0);
  assert.equal(r.remainder, 0);
  assert.equal(r.watermark.line, 3, "the watermark is at the LAST line");
  assert.equal(r.watermark.line_sha256, lineSha(storeFile(root), 3));
  assert.equal(lines(root), 3, "one Experience per outcome");
  // The roles are the VERDICT's, not a caller's — and `found-and-fixed` is NOT among them, because
  // no record names a task that develop says is done.
  assert.deepEqual(rolesIn(root), ["confirmed-negative", "found-unresolved", "undetermined"]);
  assert.equal(VERDICT_ROLE.supported, "found-unresolved");
  assert.equal(VERDICT_ROLE.refuted, "confirmed-negative");
  assert.equal(VERDICT_ROLE.undetermined, "undetermined");
  // The watermark is PERSISTED (atomically) under the shared checkout, and reads back identically.
  assert.equal(fs.existsSync(watermarkPath(root)), true);
  assert.deepEqual(readIngestWatermark(root).value, r.watermark);
  assert.deepEqual(JSON.parse(fs.readFileSync(watermarkPath(root), "utf8")), r.watermark, "and it holds exactly {line, line_sha256}");
});

// ── AC1(b): a second run ingests nothing ─────────────────────────────────────────────────────────

test("INGEST(b): a second run ingests 0 and leaves the carriers byte-identical", () => {
  const root = mkTmp();
  writeFixtureStore(root, THREE);
  const first = ingestNewOutcomes(root);
  const ledgerBefore = fs.readFileSync(ledgerFile(root), "utf8");
  const wmBefore = fs.readFileSync(watermarkPath(root), "utf8");

  const again = ingestNewOutcomes(root);
  assert.equal(again.ok, true, again.reasons?.join(","));
  assert.equal(again.scanned, 0, "nothing past the watermark was even looked at");
  assert.equal(again.ingested, 0);
  assert.equal(again.remainder, 0);
  assert.deepEqual(again.watermark, first.watermark, "the watermark did not move");
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), ledgerBefore);
  assert.equal(fs.readFileSync(watermarkPath(root), "utf8"), wmBefore);
});

// ── AC1(c): the quota, and the remainder it reports ──────────────────────────────────────────────

test("INGEST(c): maxPerRun:2 ⇒ 2 ingested with the remainder reported; the next run ingests the rest", () => {
  const root = mkTmp();
  writeFixtureStore(root, THREE);
  const first = ingestNewOutcomes(root, { maxPerRun: 2 });
  assert.equal(first.ok, true, first.reasons?.join(","));
  assert.equal(first.scanned, 2);
  assert.equal(first.ingested, 2);
  assert.equal(first.remainder, 1, "the quota REPORTS what it did not do, it does not hide it");
  assert.equal(first.watermark.line, 2);
  assert.equal(lines(root), 2);

  const second = ingestNewOutcomes(root, { maxPerRun: 2 });
  assert.equal(second.ok, true, second.reasons?.join(","));
  assert.equal(second.scanned, 1);
  assert.equal(second.ingested, 1, "…and the next run picks up exactly the remainder");
  assert.equal(second.remainder, 0);
  assert.equal(second.watermark.line, 3);
  assert.equal(lines(root), 3);

  // …and the third run is a no-op, so the quota converged rather than looping.
  const third = ingestNewOutcomes(root, { maxPerRun: 2 });
  assert.equal(third.ingested, 0);
  assert.equal(third.watermark.line, 3);
});

// ── AC1(d): the kill switch ──────────────────────────────────────────────────────────────────────

test("INGEST(d): enabled:false ⇒ zero reads and zero writes — the switch is answered before any I/O", () => {
  const root = mkTmp();
  writeFixtureStore(root, THREE);
  const storeBefore = fs.readFileSync(storeFile(root), "utf8");

  const off = ingestNewOutcomes(root, { enabled: false });
  assert.deepEqual(
    { ok: off.ok, enabled: off.enabled, store: off.store, scanned: off.scanned, ingested: off.ingested, watermark: off.watermark },
    { ok: true, enabled: false, store: null, scanned: 0, ingested: 0, watermark: null },
    "not even the store path is resolved — a kill switch that reads is not a kill switch",
  );
  assert.equal(fs.existsSync(ledgerFile(root)), false, "no ledger was created");
  assert.equal(fs.existsSync(watermarkPath(root)), false, "no watermark was written");
  assert.equal(fs.readFileSync(storeFile(root), "utf8"), storeBefore, "the store is byte-identical");
  assert.deepEqual(fs.readdirSync(path.join(root, ".quay")), ["architecture-evidence-store.jsonl"], "nothing else appeared under .quay/");

  // Negative control on the SAME predicate: enabled:true on the same root DOES write, so the zeros
  // above are the kill switch and not a fixture that could never produce a non-zero.
  const on = ingestNewOutcomes(root, { enabled: true });
  assert.equal(on.ingested, 3);
  assert.equal(fs.existsSync(watermarkPath(root)), true);
});

// ── AC1(e): the fail-closed watermark ────────────────────────────────────────────────────────────

test("INGEST(e): a rewritten store ⇒ WATERMARK_MISMATCH, and NOTHING is written", () => {
  const root = mkTmp();
  writeFixtureStore(root, THREE);
  const first = ingestNewOutcomes(root);
  assert.equal(first.ok, true);
  const ledgerBefore = fs.readFileSync(ledgerFile(root), "utf8");

  // (i) TRUNCATED: drop the first line, so every recorded line number now names a different line.
  const whole = fs.readFileSync(storeFile(root), "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(storeFile(root), whole.slice(1).join("\n") + "\n", "utf8");
  const truncated = ingestNewOutcomes(root);
  assert.equal(truncated.ok, false);
  assert.match(truncated.reasons[0], new RegExp(`^${WATERMARK_MISMATCH}:`), truncated.reasons.join(","));
  assert.equal(truncated.ingested, 0);
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), ledgerBefore, "the ledger is UNTOUCHED");
  assert.deepEqual(readIngestWatermark(root).value, first.watermark, "…and the watermark did not move");

  // (ii) REWRITTEN IN PLACE: same line count, different bytes on the watermarked line. The digest is
  // what catches this — a line NUMBER alone cannot (this is why the watermark carries both).
  const shifted = whole.slice(1).concat([JSON.stringify({ ...JSON.parse(whole[2]), verdict: "refuted" })]);
  fs.writeFileSync(storeFile(root), shifted.join("\n") + "\n", "utf8");
  const rewritten = ingestNewOutcomes(root);
  assert.equal(rewritten.ok, false);
  assert.match(rewritten.reasons[0], new RegExp(`^${WATERMARK_MISMATCH}:`), rewritten.reasons.join(","));
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), ledgerBefore, "still UNTOUCHED");

  // (iii) A CORRUPT watermark is its OWN refusal — never read as "no watermark", which would silently
  // restart the whole store at line 0 and re-derive everything as new.
  fs.writeFileSync(watermarkPath(root), "{not json\n", "utf8");
  const corrupt = ingestNewOutcomes(root);
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.reasons[0], /^WATERMARK_UNREADABLE:/, corrupt.reasons.join(","));
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), ledgerBefore);
});

// ── AC1(f): the derived fields, and the refusal of caller narration ──────────────────────────────

test("INGEST(f): summary/components equal the values DERIVED from the record; a caller-supplied summary is refused", () => {
  const root = mkTmp();
  writeFixtureStore(root, [THREE[0]]);
  const env = outcomeEnvelope(root, 1);

  const derived = deriveExperienceFields(env.rec, { line: 1 });
  assert.equal(derived.ok, true, derived.reasons?.join(","));
  assert.equal(derived.fields.role, "found-unresolved");
  assert.deepEqual(derived.fields.components, ["plugin/scripts/a.ts", "plugin/scripts/b.ts"]);
  assert.equal(derived.fields.summary, deriveExperienceSummary(env.rec));
  assert.equal(derived.fields.evaluation_pin, null, "no prerereg ⇒ null, which is its OWN value");
  // The summary is a PROJECTION of the record's own text — it does not state the answer, it states
  // what the record says. (The audit's defect was a hand-written summary that stated the answer.)
  assert.match(derived.fields.summary, /E-FIX cluster 1/);
  assert.match(derived.fields.summary, /"supported"/);
  assert.match(derived.fields.summary, /hypgen:invariant\|plugin\/scripts\/a\.ts/);
  assert.ok(derived.fields.summary.replace(/\s+/g, "").length >= MIN_SUMMARY_CHARS);
  assert.ok(derived.fields.summary.length <= MAX_SUMMARY_CHARS);
  assert.deepEqual(componentsFromSubjectKey("hypgen:invariant|a.ts, b.ts ,"), ["a.ts", "b.ts"], "whitespace is trimmed and an empty token is not a component");
  assert.deepEqual(componentsFromSubjectKey("unknown|x.ts"), ["x.ts"]);
  assert.deepEqual(componentsFromSubjectKey("no-separator-listed"), ["no-separator-listed"], "a key without the bar is one token list");
  assert.deepEqual(componentsFromSubjectKey(undefined), [], "an absent key is NO components, not a fabricated one");

  // The ingester stores EXACTLY the derived values — not a caller's copy of them.
  const r = ingestExperience(root, { source: "system", outcome: env });
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.derived, true, "acceptance says the fields were derived, not narrated");
  assert.equal(r.record.summary, derived.fields.summary);
  assert.deepEqual(r.record.components, derived.fields.components);
  assert.equal(r.record.evaluation_pin, null);
  assert.equal(r.record.reported_by, "system");

  // …and a caller-supplied summary is REFUSED, not silently ignored. This is the audit's defect
  // turned into a refusal.
  const bad = ingestExperience(root, { source: "system", outcome: env, summary: "hand-written narration that states the answer" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.reasons, [`${SYSTEM_FIELD_NOT_CALLER_WRITABLE}:summary-is-derived-from-the-record-when-source=system`]);
  for (const [field, value] of [["role", "found-and-fixed"], ["components", ["plugin/scripts/x.ts"]], ["caseId", "EXP-mine"]]) {
    const f = ingestExperience(root, { source: "system", outcome: env, [field]: value });
    assert.equal(f.ok, false, `${field} must be refused for source:"system"`);
    assert.match(f.reasons[0], new RegExp(`^${SYSTEM_FIELD_NOT_CALLER_WRITABLE}:${field}-`));
  }
  assert.equal(lines(root), 1, "every refusal appended nothing");
});

test("INGEST(f): the case_id of a derived entry is deterministic and chosen by nobody", () => {
  const root = mkTmp();
  const [w] = writeFixtureStore(root, [THREE[0]]);
  const r = ingestNewOutcomes(root);
  assert.equal(r.entries[0].case_id, `EXP-${w.id.replace(/^outcome-/, "")}`);
  // …and a DIFFERENT outcome lands under a DIFFERENT case_id (the id is not a constant).
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 9", verdict: "supported" }]);
  const second = ingestNewOutcomes(root);
  assert.equal(second.ingested, 1);
  assert.notEqual(second.entries[0].case_id, r.entries[0].case_id);
});

test("the pin: `evaluation_pin` is the prereg's `pin` when it resolves, and null (never a guess) otherwise", () => {
  const root = mkTmp();
  const pre = path.join(root, "prereg.json");
  fs.writeFileSync(pre, JSON.stringify({ experiment: "E-FIX", pin: "f".repeat(40) }), "utf8");
  assert.deepEqual(evaluationPinOf({ prereg: pre }), { pin: "f".repeat(40), prereg: pre, reason: null });
  assert.equal(evaluationPinOf({ prereg: pre }).pin, "f".repeat(40));
  // Each failure has its OWN reason, and every one of them yields `null` — the value
  // `validateGeneralization` refuses as a held-out (NO_EVALUATION_PIN), never a false pin.
  assert.deepEqual(evaluationPinOf({}), { pin: null, prereg: null, reason: "NO_PREREG_RECORDED" });
  assert.equal(evaluationPinOf({ prereg: path.join(root, "nope.json") }).reason.startsWith("PREREG_UNREADABLE:"), true);
  fs.writeFileSync(pre, "{not json", "utf8");
  assert.equal(evaluationPinOf({ prereg: pre }).reason, "PREREG_UNPARSEABLE");
  fs.writeFileSync(pre, JSON.stringify({ experiment: "E-FIX" }), "utf8");
  assert.equal(evaluationPinOf({ prereg: pre }).reason, "PREREG_HAS_NO_PIN");
  fs.writeFileSync(pre, JSON.stringify({ pin: 42 }), "utf8");
  assert.equal(evaluationPinOf({ prereg: pre }).pin, null, "a non-string pin is not a pin");
  // The pin reaches the RECORD end to end. (A SECOND root: rewriting the first root's store under a
  // live watermark is the WATERMARK_MISMATCH case, tested on its own.)
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 5", verdict: "supported", prereg: pre }]);
  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.entries[0].evaluation_pin, null, "`pin: 42` is not a pin");

  const pinned = mkTmp();
  const pre2 = path.join(pinned, "prereg.json");
  fs.writeFileSync(pre2, JSON.stringify({ pin: "a".repeat(40) }), "utf8");
  writeFixtureStore(pinned, [{ experiment_ref: "E-FIX cluster 6", verdict: "supported", prereg: pre2 }]);
  const r2 = ingestNewOutcomes(pinned);
  assert.equal(r2.ok, true, r2.reasons?.join(","));
  assert.equal(r2.entries[0].evaluation_pin, "a".repeat(40), "the resolved pin is carried onto the Experience");
  assert.equal(readExperienceLedger(pinned).records[0].evaluation_pin, "a".repeat(40), "…and it is ON DISK, not just in the return value");
});

// ── AC1(g): both sources through ONE entry, ONE carrier ──────────────────────────────────────────

test("INGEST(g): a user-sourced Experience goes through the same ingestExperience and lands in the same carrier", () => {
  const root = mkTmp();
  const r = ingestExperience(root, {
    source: "user", caseId: "TEACH-via-unified-entry", role: "missed-by-tooling",
    evidenceRefs: ["gap-discovery-experience-auto-ingest-from-evidence-store"],
    components: ["plugin/scripts/x.ts"], summary: SUMMARY,
    authoredBy: OPERATOR, userProvenance: USER_PROV,
  });
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.record.reported_by, "user");
  assert.equal(r.record.source_ref, null, "the manual half is not derived from any record");
  assert.equal(r.file, ledgerFile(root), "ONE carrier for both sources");
  // …and `ingestFeedback` is the SAME entry, not a parallel one: byte-identical records collapse to
  // one id (the content-addressed dedup), which can only happen if both paths build the same record.
  const viaAdapter = ingestUser(root, {
    caseId: "TEACH-via-unified-entry", role: "missed-by-tooling",
    evidenceRefs: ["gap-discovery-experience-auto-ingest-from-evidence-store"],
    components: ["plugin/scripts/x.ts"], summary: SUMMARY, ts: r.record.ts,
  });
  assert.equal(viaAdapter.ok, false);
  assert.equal(viaAdapter.duplicate, true, "the adapter built the identical record the unified entry did");
  assert.equal(viaAdapter.id, r.id);

  // A source outside the two-value vocabulary is REFUSED — never defaulted to one of them.
  const bad = ingestExperience(root, { source: "operator", caseId: "x", role: "missed-by-tooling", evidenceRefs: ["y"], summary: SUMMARY });
  assert.equal(bad.ok, false);
  assert.match(bad.reasons[0], new RegExp(`^${SOURCE_NOT_IN_VOCAB}:`));
  assert.deepEqual([...REPORTED_BY_VOCAB], ["user", "system"]);
  assert.equal(lines(root), 1);

  // Both halves are visible in ONE read of the ONE carrier.
  writeFixtureStore(root, [THREE[0]]);
  assert.equal(ingestNewOutcomes(root).ingested, 1);
  assert.deepEqual(readExperienceLedger(root).records.map((x) => x.reported_by).sort(), ["system", "user"]);
});

// ── the ingester's remaining controls ───────────────────────────────────────────────────────────

test("an ownership-loop verdict is SKIPPED and REPORTED — never coerced into a finding role", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "own-1", verdict: "abstained" }, { experiment_ref: "own-2", verdict: "supported" }]);
  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.scanned, 2);
  assert.equal(r.skipped_not_ingestible, 1);
  assert.equal(r.ingested, 1);
  assert.equal(r.watermark.line, 2, "a readable non-finding is passed — it is definitively not an outcome we lost");
  assert.deepEqual(rolesIn(root), ["found-unresolved"], "`abstained` did NOT become a finding");
  assert.deepEqual(deriveExperienceFields({ verdict: "abstained" }).reasons, ["VERDICT_NOT_INGESTIBLE:abstained-is-not-a-discovery-finding-verdict"]);
  // The vocabulary is data, so this is enumerable rather than a promise: every verdict that has no
  // role is one of the ownership loop's, and none of them can produce a finding.
  for (const v of ["proposed", "abstained", "investigated", "not-evaluated", "exempted"]) assert.equal(VERDICT_ROLE[v], undefined, v);
});

test("a malformed line is COUNTED, and the watermark does not advance past it", () => {
  const root = mkTmp();
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported" }]);
  fs.appendFileSync(storeFile(root), "{not json\n", "utf8");
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 2", verdict: "supported" }]);   // line 3, AFTER the bad line

  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.malformed_lines, 1);
  assert.equal(r.stopped_at_malformed_line, 2);
  assert.equal(r.ingested, 1, "only the line BEFORE the unparseable one was ingested");
  assert.equal(r.watermark.line, 1, "the watermark stops BEFORE the line it could not read");
  assert.equal(r.remainder, 1, "the outcome AFTER the bad line is reported as outstanding, not silently lost");
  assert.equal(lines(root), 1);
});

test("dedup by source_ref: losing the watermark does not duplicate the ledger", () => {
  const root = mkTmp();
  writeFixtureStore(root, THREE);
  assert.equal(ingestNewOutcomes(root).ingested, 3);
  const ledgerBefore = fs.readFileSync(ledgerFile(root), "utf8");
  fs.rmSync(watermarkPath(root));                     // the watermark is lost ⇒ the scan starts at line 0
  const again = ingestNewOutcomes(root);
  assert.equal(again.ok, true, again.reasons?.join(","));
  assert.equal(again.scanned, 3, "all three were re-examined…");
  assert.equal(again.ingested, 0);
  assert.equal(again.duplicates, 3, "…and all three were recognised as already ingested");
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), ledgerBefore, "the ledger is byte-identical");
});

test("the role elevation reads DEVELOP's task status, and only a `done` task makes a finding 'fixed'", () => {
  // (i) done ⇒ found-and-fixed (the finding is real AND a task that fixed it has landed)
  const done = mkDevelopRepo("gap-fixture-done", "done");
  writeFixtureStore(done, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts", task_id: "gap-fixture-done" }]);
  const r1 = ingestNewOutcomes(done);
  assert.equal(r1.ok, true, r1.reasons?.join(","));
  assert.equal(r1.entries[0].role, "found-and-fixed");

  // (ii) a task that exists but is NOT done ⇒ the role stays the verdict's own
  const todo = mkDevelopRepo("gap-fixture-todo", "todo");
  writeFixtureStore(todo, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts", task_id: "gap-fixture-todo" }]);
  assert.equal(ingestNewOutcomes(todo).entries[0].role, "found-unresolved");

  // (iii) a task id develop cannot resolve ⇒ NOT elevated. "I could not check" must never become
  // "it is fixed" — that is the direction that manufactures a false found-and-fixed.
  const absent = mkDevelopRepo("gap-fixture-other", "done");
  writeFixtureStore(absent, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts", task_id: "gap-fixture-does-not-exist" }]);
  assert.equal(ingestNewOutcomes(absent).entries[0].role, "found-unresolved");

  // (iv) a LATER outcome on the same subject_key turns a fixed finding into a recurrence
  const back = mkDevelopRepo("gap-fixture-done", "done");
  writeFixtureStore(back, [
    { experiment_ref: "E-FIX cluster 1", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts", task_id: "gap-fixture-done" },
    { experiment_ref: "E-FIX cluster 2", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts" },
  ]);
  const r4 = ingestNewOutcomes(back);
  assert.equal(r4.ok, true, r4.reasons?.join(","));
  assert.deepEqual(r4.entries.map((e) => e.role), ["recurred-after-fix", "found-unresolved"]);

  // (v) …and WITHOUT the task-done half there is no elevation at all (the negative control on the
  // same predicate: a later outcome alone is not a recurrence).
  const noTask = mkDevelopRepo("gap-fixture-unrelated", "done");
  writeFixtureStore(noTask, [
    { experiment_ref: "E-FIX cluster 1", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts" },
    { experiment_ref: "E-FIX cluster 2", verdict: "supported", subject_key: "hypgen:invariant|plugin/scripts/a.ts" },
  ]);
  assert.deepEqual(ingestNewOutcomes(noTask).entries.map((e) => e.role), ["found-unresolved", "found-unresolved"]);
});

test("the ingester reads the store at the SHARED checkout — a worktree root still sees the main store", () => {
  const { main, worktree } = mkWorktreePair();
  writeFixtureStore(main, [THREE[0]]);
  assert.equal(sharedStoreFile(worktree), path.join(main, ".quay", "architecture-evidence-store.jsonl"));
  const r = ingestNewOutcomes(worktree);
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.ingested, 1);
  assert.equal(r.store, path.join(main, ".quay", "architecture-evidence-store.jsonl"));
  assert.equal(fs.existsSync(ledgerFile(main)), true, "the Experience landed in the MAIN checkout");
  assert.equal(fs.existsSync(path.join(worktree, EXPERIENCE_LEDGER_REL)), false, "…and not in the worktree");
  assert.equal(fs.existsSync(watermarkPath(main)), true);
  assert.equal(fs.existsSync(path.join(worktree, INGEST_WATERMARK_REL)), false);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// PROVENANCE & THE PER-RECORD SKIP LEDGER (task gap-discovery-experience-ledger-provenance-and-skip-audit)
//
// A production acceptance check of this module's own carriers found (1) two entries stored as
// `reported_by:"user"` that a task WORKER wrote about its own finding, (2) 5 outcomes that never became
// Experiences leaving no per-record trace at all, and (3) no author on any entry. AC1(a)–(g) below are
// the mechanism; AC2/AC3 are the same thing read off the REAL carriers (see the task body).
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const AC1 = Object.freeze({
  caseId: "AC1-provenance", role: "missed-by-tooling", evidenceRefs: ["gap-fixture"],
  components: ["plugin/scripts/x.ts"], summary: SUMMARY, ts: "2026-10-12T00:00:00.000Z",
});

// ── AC1(a): a new Experience without `authored_by` is refused ────────────────────────────────────

test("AC1(a): an entry with no `authored_by` is refused, and NO adapter invents one", () => {
  const root = mkTmp();
  const r = ingestFeedback(root, { ...AC1, userProvenance: USER_PROV });   // ⛔ no authoredBy
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes("SCHEMA_MISSING:authored_by"), r.reasons.join(","));
  assert.equal(lines(root), 0, "a refusal appends nothing");
  assert.ok(REQUIRED_EXPERIENCE_FIELDS.includes("authored_by"), "…because it is a REQUIRED field, not a convention");
  assert.deepEqual([...AUTHORED_BY_ACTORS], ["ingester", "task-worker", "operator-session"]);

  // Every actor outside the vocabulary is refused, naming the value it actually saw.
  for (const actor of ["", null, "worker", "claude"]) {
    const bad = ingestFeedback(root, { ...AC1, authoredBy: { actor, ref: "x" }, userProvenance: USER_PROV });
    assert.equal(bad.ok, false, `actor=${JSON.stringify(actor)} must be refused`);
    assert.ok(bad.reasons.some((x) => x.startsWith("AUTHORED_BY_ACTOR_NOT_IN_VOCAB:")), bad.reasons.join(","));
  }
  // …and an actor with no ref is not an author either: "who" needs a name, not only a category.
  assert.equal(ingestFeedback(root, { ...AC1, authoredBy: { actor: "operator-session" }, userProvenance: USER_PROV }).reasons.join(), "FIELD_INVALID:authored_by.ref");

  // The PINNED system adapter requires one too, and its absence is its OWN arg code — never a default.
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported" }]);
  assert.deepEqual(
    ingestFromEvidenceStoreOutcome(root, { experiment: "E-FIX", experimentRef: "cluster 1", role: "found-and-fixed", caseId: "c", summary: SUMMARY }).reasons,
    ["INGEST_ARG_MISSING:authoredBy-{actor,ref}"],
  );
  // …while the DERIVED form refuses a caller's author rather than ignoring it: nobody narrates it, so
  // nobody is there to be its author.
  assert.deepEqual(
    ingestExperience(root, { source: "system", outcome: outcomeEnvelope(root, 1), authoredBy: OPERATOR }).reasons,
    [`${SYSTEM_FIELD_NOT_CALLER_WRITABLE}:authoredBy-is-derived-from-the-record-when-source=system`],
  );
  // The derived form still writes an author — the machine's own, chosen by nobody.
  const derived = ingestExperience(root, { source: "system", outcome: outcomeEnvelope(root, 1) });
  assert.equal(derived.ok, true, derived.reasons?.join(","));
  assert.deepEqual(derived.record.authored_by, DERIVED_INGEST_AUTHOR);
  assert.equal(lines(root), 1, "every refusal above appended nothing");
});

// ── AC1(b): `reported_by:"user"` without `user_provenance` ⇒ USER_PROVENANCE_MISSING ─────────────

test("AC1(b): a claim of human provenance that cannot quote the human is refused", () => {
  const root = mkTmp();
  const r = ingestFeedback(root, { ...AC1, authoredBy: OPERATOR });   // ⛔ no userProvenance
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, [`${USER_PROVENANCE_MISSING}:reported_by=user-needs-user_provenance-{kind,ref,quote}`]);
  assert.equal(lines(root), 0);

  // Present-but-thin is a DIFFERENT code from absent (硬规则 3b) — and the measure is non-whitespace
  // chars, the same one `summary` uses, so padding does not clear it.
  const thin = (quote) => ingestFeedback(root, { ...AC1, authoredBy: OPERATOR, userProvenance: { kind: "conversation", ref: "s", quote } });
  assert.ok(thin("too short").reasons.some((x) => x.startsWith("USER_PROVENANCE_QUOTE_INSUBSTANTIAL:")), thin("too short").reasons.join(","));
  assert.ok(thin(`${"a"}${" ".repeat(60)}`).reasons.some((x) => x.startsWith("USER_PROVENANCE_QUOTE_INSUBSTANTIAL:")), "padding with whitespace does not clear it — the measure is non-whitespace chars");
  // …and a quote that is ONLY whitespace is not a thin quote, it is not a string at all — a DIFFERENT
  // code, because "you gave me nothing" and "you gave me too little" are different failures.
  assert.equal(thin(" ".repeat(60)).reasons.join(), "FIELD_INVALID:user_provenance.quote");
  assert.ok(MIN_USER_QUOTE_CHARS >= 20, "the Plan's floor is >= 20 chars");
  assert.ok(thin(QUOTE).ok, "…and a real quote clears it");

  // The kind is a vocabulary, and an outside value names itself rather than defaulting.
  assert.deepEqual([...USER_PROVENANCE_KINDS], ["conversation", "task-body"]);
  const badKind = ingestFeedback(root, { ...AC1, authoredBy: OPERATOR, userProvenance: { kind: "guess", ref: "s", quote: QUOTE } });
  assert.ok(badKind.reasons.some((x) => x.startsWith("USER_PROVENANCE_KIND_NOT_IN_VOCAB:guess")), badKind.reasons.join(","));

  // The mirror: a DERIVED entry carrying a human quote would claim provenance it never had.
  const sys = {
    case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", reported_by: "system",
    authored_by: OPERATOR, source_ref: "outcome-x", evidence: [{ ref: "o", sha256: sha256("o") }],
    components: [], summary: SUMMARY, user_provenance: USER_PROV, evidence_level: UNLABELLED,
  };
  assert.deepEqual(validateExperienceRecord(sys).reasons, ["USER_PROVENANCE_NOT_APPLICABLE_FOR_SYSTEM:reported_by=system-was-not-derived-from-a-human-message"]);
  assert.equal(lines(root), 1, "only the one accepted manual entry was appended");
});

// ── AC1(c): a task worker can never store its own finding as `reported_by:"user"` ────────────────

test("AC1(c): `reported_by:\"user\"` with `authored_by.actor:\"task-worker\"` ⇒ USER_SOURCE_FROM_WORKER", () => {
  const root = mkTmp();
  // Every OTHER field is in order — a real quote, a real role, real evidence. The COMBINATION is the
  // 2026-10-12 defect, so the combination is what is refused.
  const r = ingestFeedback(root, { ...AC1, authoredBy: WORKER, userProvenance: USER_PROV });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith(`${USER_SOURCE_FROM_WORKER}:`)), r.reasons.join(","));
  assert.equal(lines(root), 0, "the worker's claim is refused, not stored");

  // …and the SAME worker recording the SAME finding as what it is — a SYSTEM finding, with itself
  // named as the author — is accepted. The rule forbids the mislabelling, not the worker.
  writeFixtureStore(root, [{ experiment_ref: "E-FIX cluster 1", verdict: "supported" }]);
  const asSystem = ingestFromEvidenceStoreOutcome(root, {
    experiment: "E-FIX", experimentRef: "cluster 1", role: "found-and-fixed", caseId: "EXP-worker-own",
    summary: SUMMARY, authoredBy: WORKER,
  });
  assert.equal(asSystem.ok, true, asSystem.reasons?.join(","));
  assert.equal(asSystem.record.reported_by, "system");
  assert.deepEqual(asSystem.record.authored_by, WORKER, "the worker is NAMED — the entry is not anonymous");
  assert.equal(readExperienceLedger(root).records.filter((e) => e.reported_by === "user").length, 0);
});

// ── AC1(d): corrections are append-only and change what READERS report ───────────────────────────

test("AC1(d): a correction restates an entry for readers while the original line stays byte-identical", () => {
  const root = mkTmp();
  const entry = ingestUser(root, { ...AC1, caseId: "EXP-corrected" });
  assert.equal(entry.ok, true, entry.reasons?.join(","));
  const originalLine = fs.readFileSync(ledgerFile(root), "utf8");
  assert.equal(readExperienceLedger(root).records[0].reported_by, "user");
  assert.equal(readExperienceLedger(root).records[0].authored_by.actor, "operator-session");

  const c = appendExperienceCorrection(root, {
    corrects: entry.id,
    patch: { reported_by: "system", authored_by: WORKER },
    reason: "a task worker wrote this about a defect it found; no human reported it",
    authoredBy: OPERATOR,
  });
  assert.equal(c.ok, true, c.reasons?.join(","));

  // The READER sees the corrected view…
  const read = readExperienceLedger(root);
  assert.deepEqual(read.corrected_ids, [entry.id]);
  assert.equal(read.records[0].reported_by, "system");
  assert.deepEqual(read.records[0].authored_by, WORKER);
  assert.equal(read.records.filter((x) => x.reported_by === "user").length, 0, "user-entry count after the correction");
  // …on the SAME entry (the id is unchanged — a correction restates, it does not mint a new record).
  assert.equal(read.records[0].id, entry.id);
  assert.equal(read.records[0].case_id, "EXP-corrected");

  // …and the ORIGINAL line is still on disk, byte for byte, as a PREFIX of the carrier.
  const after = fs.readFileSync(ledgerFile(root), "utf8");
  assert.equal(after.startsWith(originalLine), true, "the original line is a PREFIX — untouched, not rewritten");
  assert.equal(after.split("\n").filter(Boolean).length, 2, "one entry + one correction, and nothing else");
  assert.equal(JSON.parse(after.slice(originalLine.length)).kind, EXPERIENCE_CORRECTION_KIND);

  // The correction is not an entry: the ledger's own readers count ONE Experience, not two.
  assert.equal(experienceDenyList(root).evaluated, 1);
  assert.equal(readExperienceCorrections(root).records.length, 1);
  assert.deepEqual(readExperienceCorrections(root).orphan_targets, []);

  // IDEMPOTENT: re-running the same correction corrects nothing twice.
  const again = appendExperienceCorrection(root, {
    corrects: entry.id, patch: { reported_by: "system", authored_by: WORKER },
    reason: "a task worker wrote this about a defect it found; no human reported it", authoredBy: OPERATOR,
  });
  assert.equal(again.ok, false);
  assert.equal(again.duplicate, true);
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), after, "the carrier is unchanged by the re-run");
});

test("a correction that corrects nothing, or rewrites the finding itself, is REFUSED", () => {
  const root = mkTmp();
  const entry = ingestUser(root, AC_CASE);
  assert.equal(entry.ok, true, entry.reasons?.join(","));
  const GOODC = { corrects: entry.id, patch: { reported_by: "system" }, reason: "the author was mislabelled when this was written", authoredBy: OPERATOR };

  assert.ok(appendExperienceCorrection(root, { ...GOODC, corrects: "experience-doesnotexist" }).reasons[0].startsWith(`${CORRECTION_TARGET_NOT_FOUND}:`), "a correction pointing at nothing is not a silent no-op");
  assert.ok(appendExperienceCorrection(root, { ...GOODC, patch: { summary: "a rewritten finding" } }).reasons.some((x) => x.startsWith(`${CORRECTION_FIELD_NOT_CORRECTABLE}:summary`)), "…and it cannot rewrite what was found — only who reported it");
  assert.deepEqual(CORRECTABLE_FIELDS, ["reported_by", "authored_by"]);
  assert.ok(appendExperienceCorrection(root, { ...GOODC, patch: {} }).reasons.includes("INGEST_ARG_MISSING:patch"));
  assert.ok(appendExperienceCorrection(root, { ...GOODC, reason: "nope" }).reasons.some((x) => x.startsWith("CORRECTION_REASON_INSUBSTANTIAL:")), `floor is ${MIN_CORRECTION_REASON_CHARS} non-whitespace chars`);
  assert.ok(appendExperienceCorrection(root, { ...GOODC, authoredBy: undefined }).reasons.includes("INGEST_ARG_MISSING:authoredBy-{actor,ref}"));
  assert.equal(lines(root), 1, "no refusal appended anything");

  // Negative control on the SAME predicate: the well-formed correction DOES append, so the refusals
  // above are the rules firing and not a writer that could never succeed.
  assert.equal(appendExperienceCorrection(root, GOODC).ok, true);
  assert.equal(lines(root), 2);
  assert.equal(readExperienceLedger(root).records[0].reported_by, "system");
});

// ── AC1(e): a non-ingestible outcome leaves ONE deduped skip record ──────────────────────────────

test("AC1(e): a `proposed` outcome yields ONE skip record, and a second round adds none", () => {
  const root = mkTmp();
  const [w] = writeFixtureStore(root, [
    { experiment_ref: "E-FIX own-1", verdict: "proposed" },
    { experiment_ref: "E-FIX cluster 1", verdict: "supported" },
  ]);
  const first = ingestNewOutcomes(root);
  assert.equal(first.ok, true, first.reasons?.join(","));
  assert.equal(first.scanned, 2);
  assert.equal(first.ingested, 1);
  assert.equal(first.skipped_not_ingestible, 1);
  assert.equal(first.skips_recorded, 1, "ONE skip record for the ONE outcome that did not become an entry");
  assert.equal(first.watermark.line, 2, "a readable non-finding is still passed — it is definitively not an outcome we lost");

  const skips = readIngestSkips(root);
  assert.equal(skips.ok, true);
  assert.equal(skips.records.length, 1);
  assert.equal(skips.file, ingestSkipsFile(root));
  assert.equal(INGEST_SKIPS_REL, ".quay/discovery-ingest-skips.jsonl");
  assert.equal(skips.records[0].kind, INGEST_SKIP_KIND);
  assert.deepEqual(
    { store_line: skips.records[0].store_line, outcome_id: skips.records[0].outcome_id, verdict: skips.records[0].verdict, reason_code: skips.records[0].reason_code, mapping_version: skips.records[0].mapping_version },
    { store_line: 1, outcome_id: w.id, verdict: "proposed", reason_code: `${SKIP_VERDICT_NOT_INGESTIBLE}:proposed`, mapping_version: VERDICT_ROLE_MAPPING_VERSION },
    "every field the audit could not recover — which line, which outcome, which reason, under which mapping",
  );
  // The dedup key is the triple the Plan names, and the id is its content address (so a re-file is a
  // DUPLICATE_ID rather than a second line).
  assert.equal(skipDedupKey(skips.records[0]), `${w.id}|${SKIP_VERDICT_NOT_INGESTIBLE}:proposed|${VERDICT_ROLE_MAPPING_VERSION}`);
  assert.match(ingestSkipId(skips.records[0]), /^ingest-skip-[0-9a-f]{16}$/);

  // Round 2 is a no-op on the skip carrier — byte-identical, and it never even re-examines the line.
  const before = fs.readFileSync(ingestSkipsFile(root), "utf8");
  const second = ingestNewOutcomes(root);
  assert.equal(second.skips_recorded, 0);
  assert.equal(second.scanned, 0, "the watermark is past it");
  assert.equal(fs.readFileSync(ingestSkipsFile(root), "utf8"), before);

  // …and an explicit re-file of the same skip is DUPLICATE_ID, so "record it again" cannot grow the
  // carrier either (the dedup is the id AND the triple — two independent reasons it cannot double).
  const dupe = appendIngestSkip(root, { store_line: 1, outcome_id: w.id, verdict: "proposed", reason_code: `${SKIP_VERDICT_NOT_INGESTIBLE}:proposed` });
  assert.equal(dupe.ok, false);
  assert.equal(dupe.duplicate, true);
  assert.equal(fs.readFileSync(ingestSkipsFile(root), "utf8"), before);
});

// ── AC1(f): a READ_FAILED holds the watermark and is retried on the next round ───────────────────

test("AC1(f): a READ_FAILED holds the watermark, and the next round retries and ingests the line", () => {
  const root = mkTmp();
  writeFixtureStore(root, [
    { experiment_ref: "E-FIX cluster 1", verdict: "supported" },
    { experiment_ref: "E-FIX cluster 2", verdict: "supported" },
  ]);
  // The transient failure is INJECTED — the AC names it "simulated", and it is: on the production path
  // the store was read whole before the scan, so a per-line read cannot fail there. What is being
  // established is the RETRY CONTRACT, not a production reading (that is AC2/AC3 on the real carriers).
  const first = ingestNewOutcomes(root, { readLine: (n) => (n === 2 ? { ok: false, reason: "EAGAIN" } : { ok: true }) });
  assert.equal(first.ok, true, first.reasons?.join(","));
  assert.equal(first.read_failed, 1);
  assert.equal(first.stopped_at_read_failed_line, 2);
  assert.equal(first.ingested, 1, "line 1 was ingested");
  assert.equal(first.skipped_not_ingestible, 0, "…and line 2 was NOT reclassified as a non-finding");
  assert.equal(first.watermark.line, 1, "the watermark did NOT advance past the line it could not read");

  const skips = readIngestSkips(root);
  assert.equal(skips.records.length, 1);
  assert.equal(skips.records[0].store_line, 2);
  assert.equal(skips.records[0].outcome_id, null, "the line never parsed, so there is no id to name — that is its own value, not a fabricated one");
  assert.equal(skips.records[0].reason_code, SKIP_READ_FAILED);
  assert.equal(skipDedupKey(skips.records[0]), `line-2|${SKIP_READ_FAILED}|${VERDICT_ROLE_MAPPING_VERSION}`, "…and the dedup key falls back to the LINE, which is what is stable for a line that has no id");

  // Round 2: the read succeeds, the line is ingested, and the entry exists.
  const second = ingestNewOutcomes(root);
  assert.equal(second.ok, true, second.reasons?.join(","));
  assert.equal(second.read_failed, 0);
  assert.equal(second.ingested, 1);
  assert.equal(second.watermark.line, 2);
  assert.equal(readExperienceLedger(root).records.length, 2, "the outcome that was unreadable is now an Experience");
  assert.equal(fs.readFileSync(ingestSkipsFile(root), "utf8").split("\n").filter(Boolean).length, 1, "the READ_FAILED trace STAYS — it records a round, it is not a to-do list");
});

// ── AC1(g): a mapping_version bump re-opens the earlier VERDICT_NOT_INGESTIBLE skips ─────────────

test("AC1(g): bumping mapping_version re-evaluates the earlier VERDICT_NOT_INGESTIBLE skips", () => {
  const root = mkTmp();
  const [w] = writeFixtureStore(root, [{ experiment_ref: "E-FIX own-1", verdict: "proposed" }]);
  assert.equal(ingestNewOutcomes(root).skipped_not_ingestible, 1);
  assert.equal(readIngestSkips(root).records[0].reason_code, `${SKIP_VERDICT_NOT_INGESTIBLE}:proposed`);
  assert.equal(readIngestWatermark(root).value.line, 1, "normally the watermark is PAST the line, so nothing would ever look again");

  // (i) The same version does not re-open it: the skip is durable, not re-filed every round.
  const same = ingestNewOutcomes(root);
  assert.equal(same.scanned, 0, "the watermark still holds — no rewind without a version change");
  assert.equal(same.skips_recorded, 0);

  // (ii) The MAP changes so `proposed` HAS a role. The version is the map's own digest, so it moves
  //      with the map — nobody has to remember to bump it — and the scan re-opens the stale line.
  const widened = { ...VERDICT_ROLE, proposed: "found-unresolved" };
  const bumped = ingestNewOutcomes(root, { verdictRole: widened });
  assert.equal(bumped.mapping_version, verdictRoleMappingVersion(widened));
  assert.notEqual(bumped.mapping_version, VERDICT_ROLE_MAPPING_VERSION, "the version is the MAP's digest, not a literal");
  assert.equal(bumped.rewound_for_mapping, 1, "the scan re-opened exactly the one stale skip line");
  assert.equal(bumped.ingested, 1, "the previously-skipped outcome is now an ENTRY — that is what re-evaluation means");
  assert.equal(readExperienceLedger(root).records[0].source_ref, w.id);
  assert.equal(readIngestSkips(root).records.length, 1, "the OLD skip is NOT erased — it records what the old map did");
  assert.equal(readIngestSkips(root).records[0].mapping_version, VERDICT_ROLE_MAPPING_VERSION);

  // (iii) Negative control on the same predicate: an EXPLICIT version bump with the map UNCHANGED still
  //       re-opens the skip (the rule reads the version) and re-files it under the new version — so the
  //       rewind above is driven by the version, not by the record having become ingestible.
  const other = mkTmp();
  writeFixtureStore(other, [{ experiment_ref: "E-FIX own-1", verdict: "proposed" }]);
  assert.equal(ingestNewOutcomes(other).skipped_not_ingestible, 1);
  const forced = ingestNewOutcomes(other, { mappingVersion: "vr-forced-next" });
  assert.equal(forced.rewound_for_mapping, 1);
  assert.equal(forced.ingested, 0, "the map did not change, so the outcome is still not a finding");
  assert.equal(forced.skips_recorded, 1, "…and it is re-filed under the NEW version, so the change is visible");
  assert.deepEqual(readIngestSkips(other).records.map((s) => s.mapping_version).sort(), ["vr-forced-next", VERDICT_ROLE_MAPPING_VERSION].sort());
  assert.deepEqual(readExperienceLedger(other).records, [], "no entry was manufactured by the re-evaluation");
});

// ── the one-time reconciliation: ingested + skipped + unexplained == scanned ──────────────────────

test("backfill: the arithmetic holds, and a LOST finding is reported — never filed as a skip", () => {
  const root = mkTmp();
  const [, , c] = writeFixtureStore(root, [
    { experiment_ref: "E-FIX cluster 1", verdict: "supported" },
    { experiment_ref: "E-FIX own-1", verdict: "proposed" },
    { experiment_ref: "E-FIX cluster 2", verdict: "refuted" },
  ]);
  // Only ONE of the three outcomes has an entry — the state a real ledger is in after a partial run.
  assert.equal(ingestNewOutcomes(root, { maxPerRun: 1 }).ingested, 1);

  const bf = backfillIngestSkips(root);
  assert.equal(bf.ok, true, bf.reasons?.join(","));
  assert.equal(bf.scanned, 3);
  assert.equal(bf.ingested, 1);
  assert.equal(bf.skipped, 1);
  assert.deepEqual(bf.unexplained, [{ store_line: 3, outcome_id: c.id, verdict: "refuted" }],
    "an INGESTIBLE outcome with no entry is a finding we LOST — reported, never filed as a skip");
  assert.equal(bf.ingested + bf.skipped + bf.unexplained.length, bf.scanned, "…and the three terms are LISTS, so the arithmetic names every record");
  assert.deepEqual(bf.skipped_records.map((s) => ({ line: s.store_line, code: s.reason_code })), [{ line: 2, code: `${SKIP_VERDICT_NOT_INGESTIBLE}:proposed` }]);

  // Idempotent: a second backfill records nothing new, and still reconciles.
  const again = backfillIngestSkips(root);
  assert.equal(again.skips_recorded, 0);
  assert.equal(again.skips_already_present, 1);
  assert.equal(again.ingested + again.skipped + again.unexplained.length, again.scanned);
  assert.deepEqual(again.unexplained, bf.unexplained);
});

test("readExperienceLedger keeps corrections OUT of `records`, and reports a correction with no target", () => {
  const root = mkTmp();
  const entry = ingestUser(root, AC_CASE);
  assert.equal(entry.ok, true, entry.reasons?.join(","));
  // A correction aimed at an id that is not in the carrier: written straight through the append path so
  // the ORPHAN case is reachable (the writer itself refuses to create one).
  fs.appendFileSync(ledgerFile(root), JSON.stringify({ kind: EXPERIENCE_CORRECTION_KIND, id: "experience-correction-orphan", corrects: "experience-absent", patch: { reported_by: "system" } }) + "\n");
  const read = readExperienceLedger(root);
  assert.equal(read.ok, true);
  assert.equal(read.records.length, 1, "a correction is never counted as an Experience");
  assert.deepEqual(read.corrected_ids, [], "…and a correction with no target corrects nothing");
  assert.deepEqual(readExperienceCorrections(root).orphan_targets, ["experience-absent"], "it is REPORTED, not silently dropped (硬规则 5)");
  assert.equal(readExperienceLedger(root).records[0].reported_by, "user", "the entry is untouched by an orphan correction");
  assert.deepEqual([...applyExperienceCorrections([{ kind: EXPERIENCE_KIND, id: "a" }, { kind: EXPERIENCE_CORRECTION_KIND, corrects: "a", patch: { reported_by: "system" } }]).corrected], ["a"]);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE JOIN: an outcome → the claim records the store filed under the same `subject_key`
// (task gap-discovery-method-generalization-failures-diagnosis-and-retest, Plan item 2a)
//
// The measured defect: `deriveExperienceSummary` is a projection of the OUTCOME record alone, and an
// outcome carries no domain claim. Over the shipped store the derived summary carried 0.000 of its
// linked claim records' content tokens, a joined one carries 1.000, and the methods that round induced
// carried 0.034-0.111 — the reflection step was shown the pipeline's own bookkeeping and induced
// methods about the bookkeeping. These tests pin the join, and pin that it stays THREE-VALUED.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const SK_FIX = "hypgen:invariant|plugin/scripts/alpha.ts,plugin/scripts/beta.ts";
const HYP_STATEMENT = "the writer and the checker declare the same field set independently, so they drift apart silently";
const CE_STATEMENT = "alpha.ts:40 documents that the second declaration is deliberately separate, so the drift may be intended design";

/** A FIXTURE evidence store: one outcome plus the claim records the store files under its subject. */
const writeFixtureStoreWithClaim = (root, subjectKey, { withHypothesis = true, withCounterexample = true } = {}) => {
  const o = appendOutcomeRecord(root, { ts: "2026-10-12T00:00:00Z", experiment: "E-JOIN", experiment_ref: "E-JOIN cluster 1", verdict: "supported", subject_key: subjectKey });
  assert.equal(o.ok, true, `fixture outcome refused: ${o.reasons?.join(",")}`);
  if (withHypothesis) {
    const h = appendHypothesisRecord(root, { ts: "2026-10-12T00:00:00Z", statement: HYP_STATEMENT, source_evidence: ["plugin/scripts/alpha.ts:12"], subject_key: subjectKey, experiment: "E-JOIN" });
    assert.equal(h.ok, true, `fixture hypothesis refused: ${h.reasons?.join(",")}`);
  }
  if (withCounterexample) {
    const c = appendCounterexampleRecord(root, { ts: "2026-10-12T00:00:00Z", counterexample_of: HYP_STATEMENT, statement: CE_STATEMENT, source_evidence: ["plugin/scripts/beta.ts:44"], subject_key: subjectKey, experiment: "E-JOIN" });
    assert.equal(c.ok, true, `fixture counterexample refused: ${c.reasons?.join(",")}`);
  }
  return o;
};
const storeRecordsOf = (root) => readRecords(storeFile(root)).records;

test("JOIN(a): the derived Experience carries the linked claim records' OWN text, not just the bookkeeping", () => {
  const root = mkTmp();
  writeFixtureStoreWithClaim(root, SK_FIX);
  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.ingested, 1);
  const rec = readExperienceLedger(root).records[0];

  // The bookkeeping half is still there — a reader can still see which record this came from…
  assert.match(rec.summary, /E-JOIN cluster 1: verifier verdict "supported" on subject hypgen:invariant\|/);
  // …and the CLAIM is now carried, VERBATIM from the records that state it.
  assert.equal(rec.join_status, JOIN_LINKED);
  assert.ok(rec.domain_claim.includes(HYP_STATEMENT), "the linked hypothesis's own statement is carried");
  assert.ok(rec.domain_claim.includes(CE_STATEMENT), "…and so is the counterexample's");
  assert.ok(rec.domain_claim.startsWith(`${HYP_STATEMENT} `), "a counterexample is prefixed by the hypothesis it refutes, so a run that persisted ONLY counterexamples still hands over the claim");
  assert.deepEqual(rec.claim_refs.map((x) => x.slice(0, 10)).sort(), ["counterexa", "hypothesis"], "the refs name WHICH records the claim came from");
  assert.deepEqual(rec.claim_citations, ["plugin/scripts/alpha.ts:12", "plugin/scripts/beta.ts:44"], "the file:line citations both kinds carry, so a reviewer can re-read the evidence");

  // The summary projection carries the claim too (bounded by MAX_SUMMARY_CHARS, which is why the claim
  // is ALSO its own untruncated field).
  const projected = deriveExperienceSummary(
    { experiment_ref: "E-JOIN cluster 1", verdict: "supported", subject_key: SK_FIX },
    { join: joinOutcomeToClaims({ subject_key: SK_FIX }, claimIndex(storeRecordsOf(root))) },
  );
  assert.ok(projected.includes(HYP_STATEMENT), "the summary the reflection prompt shows carries the claim");
  assert.ok(projected.length <= MAX_SUMMARY_CHARS);
});

test("JOIN(b): the join is THREE-VALUED — no claim record, no index at all, and a real claim are different shapes", () => {
  const SK = "hypgen:invariant|plugin/scripts/alpha.ts";
  // (1) The store FILES NO CLAIM for this subject.
  const bare = mkTmp();
  appendOutcomeRecord(bare, { ts: "2026-10-12T00:00:00Z", experiment: "E-JOIN", experiment_ref: "E-JOIN cluster 9", verdict: "supported", subject_key: SK });
  assert.equal(ingestNewOutcomes(bare).ok, true);
  assert.equal(readExperienceLedger(bare).records[0].join_status, JOIN_NO_CLAIM_RECORD);
  assert.equal(readExperienceLedger(bare).records[0].domain_claim, null);

  // (2) The index could not be built AT ALL — its own value, never shaped like "no claim exists".
  const noIndex = deriveExperienceFields({ id: "outcome-x", verdict: "supported", subject_key: SK, experiment_ref: "E-JOIN cluster 9" }, { claimIndex: null });
  assert.equal(noIndex.fields.join_status, JOIN_INDEX_UNAVAILABLE);
  assert.equal(noIndex.fields.domain_claim, null);
  assert.notEqual(JOIN_INDEX_UNAVAILABLE, JOIN_NO_CLAIM_RECORD, "the two absences carry DIFFERENT values (硬规则 3b)");

  // (3) POSITIVE CONTROL on the same predicate: the same call that returned `null` twice above returns
  //     TEXT here, so the two `null`s are real and not a predicate that can never fire.
  const withClaim = mkTmp();
  writeFixtureStoreWithClaim(withClaim, SK);
  const direct = joinOutcomeToClaims({ subject_key: SK }, claimIndex(storeRecordsOf(withClaim)));
  assert.equal(direct.status, JOIN_LINKED);
  assert.ok(direct.domain_claim.length > 20);
});

test("JOIN(c): the production run REPORTS its join coverage — a reading, not a promise", () => {
  const root = mkTmp();
  writeFixtureStoreWithClaim(root, SK_FIX);
  appendOutcomeRecord(root, { ts: "2026-10-12T00:00:00Z", experiment: "E-JOIN", experiment_ref: "E-JOIN cluster 9", verdict: "supported", subject_key: "hypgen:identity|plugin/scripts/gamma.ts" });
  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true);
  assert.equal(r.ingested, 2);
  assert.deepEqual(r.claim_join, { linked: 1, no_linked_claim: 1, claim_records_indexed: 2 }, "one entry joined, one did not, and the index saw both claim records");
  assert.deepEqual(r.entries.map((e) => e.join_status), [JOIN_LINKED, JOIN_NO_CLAIM_RECORD], "per-entry, not just a total");
});

test("JOIN(d): the join keys on `subject_key` EXACTLY — a look-alike subject is not a link", () => {
  const root = mkTmp();
  writeFixtureStoreWithClaim(root, SK_FIX);
  // The same subject with ONE extra component: the defect re-filed under a different file set is a
  // different record, and crediting it would hand the reflection step a claim about other code.
  appendOutcomeRecord(root, { ts: "2026-10-12T00:00:00Z", experiment: "E-JOIN", experiment_ref: "E-JOIN cluster 2", verdict: "supported", subject_key: `${SK_FIX},plugin/scripts/gamma.ts` });
  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => e.join_status), [JOIN_LINKED, JOIN_NO_CLAIM_RECORD]);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE LEVEL on Experience records (task gap-discovery-evidence-level-teaching-vs-independent,
// Plan item 1). A new record must SAY what its evidence is worth; a record that predates the field —
// or a caller that declares nothing — is `unlabelled`, which is never `independent`. A `teaching` or
// `transfer` record may reuse a known case only by NAMING it.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("AC(level): a new Experience must carry a level from the vocabulary; an unknown value is its OWN refusal", () => {
  const root = mkTmp();
  // The vocabulary is DATA, and `unlabelled` is writable — it is the explicit "no claim" value, distinct
  // from the four declared levels (a missing label is an absent claim, not a weak positive).
  assert.deepEqual([...EVIDENCE_LEVELS], ["teaching", "transfer", "independent", "production-open"]);
  assert.equal(EVIDENCE_LEVEL_VALUES.includes(UNLABELLED_EVIDENCE_LEVEL), true);
  assert.equal(EVIDENCE_LEVELS.includes(UNLABELLED_EVIDENCE_LEVEL), false, "…and it is NOT one of the declared levels");

  const base = { case_id: "x", ts: "2026-10-12T00:00:00Z", role: "found-and-fixed", authored_by: OPERATOR, evidence: [{ ref: "a", sha256: sha256("a") }], components: [], summary: SUMMARY };
  assert.deepEqual(validateExperienceRecord({ ...base, reported_by: "user", user_provenance: USER_PROV, source_ref: null, evidence_level: "guessed" }).reasons,
    ["EVIDENCE_LEVEL_NOT_IN_VOCAB:guessed"], "a typo is refused, never silently downgraded to `unlabelled`");
  assert.equal(validateExperienceRecord({ ...base, reported_by: "user", user_provenance: USER_PROV, source_ref: null, evidence_level: "teaching", source_case_id: "TEACH-source-case" }).ok, true);
  // A `teaching`/`transfer` record that does not name the case it reused is refused on its own code.
  assert.deepEqual(validateExperienceRecord({ ...base, reported_by: "user", user_provenance: USER_PROV, source_ref: null, evidence_level: "transfer" }).reasons,
    [`${SOURCE_CASE_REQUIRED}:evidence_level=transfer-must-name-the-known-case-it-reuses-in-source_case_id`]);
  // …and the mirror: naming a reused case while claiming `independent` is a claim the level contradicts.
  assert.deepEqual(validateExperienceRecord({ ...base, reported_by: "user", user_provenance: USER_PROV, source_ref: null, evidence_level: "independent", source_case_id: "TEACH-source-case" }).reasons,
    [`${SOURCE_CASE_NOT_APPLICABLE_FOR_INDEPENDENT}:evidence_level=independent-was-not-derived-from-a-previously-used-case`]);
  assert.equal(lines(root), 0, "every one of these is a pure validation, nothing was written");
});

test("AC(level): the ledger WRITES a level on every new entry, and reads `unlabelled` for one that predates the field", () => {
  const root = mkTmp();
  // A declared level travels through the real ingestion path.
  const r = ingestUser(root, { caseId: "TEACH-x", role: "missed-by-tooling", evidenceRefs: ["ref-a"], summary: SUMMARY, evidenceLevel: "teaching", sourceCaseId: "EXP-known" });
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.record.evidence_level, "teaching");
  assert.equal(r.record.source_case_id, "EXP-known");
  // An undeclared one is written as the explicit `unlabelled`, never as an absent key.
  assert.equal(ingestUser(root, { caseId: "TEACH-y", role: "missed-by-tooling", evidenceRefs: ["ref-b"], summary: SUMMARY }).record.evidence_level, "unlabelled");

  // The READ path tolerates a line written BEFORE the field existed — that is what "legacy" means —
  // and it reads as `unlabelled`, the fail-closed direction.
  const legacyFile = ledgerFile(root);
  fs.appendFileSync(legacyFile, JSON.stringify({ kind: "experience", id: "experience-legacy00000000", case_id: "EXP-legacy", role: "found-and-fixed", reported_by: "system", authored_by: OPERATOR, source_ref: "outcome-legacy", evidence: [{ ref: "o", sha256: sha256("o") }], components: [], summary: SUMMARY }) + "\n", "utf8");
  const legacy = readExperienceLedger(root).records.find((x) => x.id === "experience-legacy00000000");
  assert.equal(evidenceLevelOf(legacy), UNLABELLED_EVIDENCE_LEVEL);
  assert.equal(isIndependentEvidenceLevel(legacy), false, "a record with no level is NEVER independent");
  assert.equal(allowsCaseReuse(legacy), false, "…and it is not exempt from the exclusion either");
  assert.equal(evidenceLevelOf({ evidence_level: "independent" }), "independent");
  assert.equal(evidenceLevelOf(null), "unlabelled", "an unreadable input reads as the WEAKEST level, never a pass");
});

// ── SOURCE 3: a ROUTINE CARRIER record (task gap-open-discovery-findings-into-portfolio-experience) ──
//
// The open-ended semantic discovery routine's confirmed clusters are `kind:"cluster"` lines on its own
// carrier, with a verdict vocabulary the evidence store does not have. These cases cover the third
// ingestion source: the verdict is DERIVED from the record (never taken from the caller), the role is
// CHECKED against it, the back-pointer AND the content digest are of the record's own line, and a record
// that carries no id is refused rather than given one.

/** One `kind:"cluster"` line as the routine writes it, with a caller-chosen verdict shape. */
const clusterRec = (over = {}) => ({
  kind: CARRIER_CLUSTER_KIND, routine: "open-semantic-discovery",
  ts: "2026-10-13T01:00:00.000Z", record_id: "open-semantic-discovery@2026-10-13T01:00:00.000Z#1",
  cluster: 1, claim: "two helpers own the same cache", components: ["plugin/scripts/x.ts"],
  verifier_verdict: "supported", refutation_verdict: "supported", confirmed: true,
  ...over,
});

/** Ingest ONE carrier record through the real entry point, with the caller's narration. Returns the
 *  result plus the line/envelope, so a case can assert the digest the adapter derived. */
function ingestCluster(root, rec, over = {}) {
  const raw = JSON.stringify(rec);
  return ingestExperience(root, {
    source: "discovery-carrier",
    record: { rec, raw, line: 1 },
    carrier: ".quay/open-semantic-discovery-findings.jsonl",
    role: "found-unresolved",
    caseId: clusterCaseId(rec.record_id),
    summary: "a confirmed cluster whose claim held and for which no fix is recorded yet",
    components: rec.components,
    authoredBy: { actor: "ingester", ref: "open-semantic-discovery" },
    evidenceLevel: "production-open",
    ...over,
  });
}

test("CARRIER(a): clusterVerdict derives the verdict from the record's OWN fields, fail-closed both ways", () => {
  assert.equal(clusterVerdict(clusterRec()), "supported");
  assert.equal(clusterVerdict(clusterRec({ confirmed: false })), "undetermined", "an unconfirmed cluster is NOT supported");
  assert.equal(clusterVerdict(clusterRec({ confirmed: false, refutation_verdict: "refuted" })), "refuted");
  assert.equal(clusterVerdict(clusterRec({ confirmed: false, verifier_verdict: "refuted", refutation_verdict: "not-run" })), "refuted", "the first verifier's refutation counts too");
  assert.equal(clusterVerdict(clusterRec({ confirmed: false, refutation_verdict: "undetermined" })), "undetermined");
  assert.equal(clusterVerdict(clusterRec({ confirmed: true, refutation_verdict: "refuted" })), "supported", "`confirmed` is the carrier's own settled answer");
  assert.equal(clusterVerdict(null), null, "not a record ⇒ no verdict, never «supported»");
  // ⛔ A caller's `verdict` key is NOT consulted: the routine never writes one, and honouring it would let
  // a record claim a confirmation its own evidence does not contain.
  assert.equal(clusterVerdict(clusterRec({ confirmed: false, refutation_verdict: "refuted", verdict: "supported" })), "refuted");
});

test("CARRIER(b): a confirmed cluster ingests with source_ref AND a digest of its own carrier LINE", () => {
  const root = mkTmp();
  const rec = clusterRec();
  const raw = JSON.stringify(rec);
  const r = ingestExperience(root, {
    source: "discovery-carrier", record: { rec, raw, line: 1 }, carrier: ".quay/open-semantic-discovery-findings.jsonl",
    role: "found-unresolved", caseId: clusterCaseId(rec.record_id),
    summary: "a confirmed cluster whose claim held and for which no fix is recorded yet",
    authoredBy: { actor: "ingester", ref: "open-semantic-discovery" }, evidenceLevel: "production-open",
  });
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.record.source_ref, rec.record_id, "the back-pointer IS the carrier record's own id");
  assert.equal(r.record.case_id, `EXP-${rec.record_id}`);
  assert.equal(r.record.reported_by, "system");
  assert.equal(r.record.evidence_level, "production-open");
  assert.equal(r.record.evidence[0].ref, rec.record_id);
  assert.equal(r.record.evidence[0].sha256, sha256(raw), "the evidence is content-addressed over the LINE");
  assert.deepEqual(r.record.components, rec.components, "the components are the record's own — never invented");
  assert.equal(r.derived_from.carrier, ".quay/open-semantic-discovery-findings.jsonl");
  assert.equal(r.derived_from.verdict, "supported");
  // The read-back carries the same three facts, so the chain is resolvable from the ledger alone.
  const back = readExperienceLedger(root).records.find((x) => x.source_ref === rec.record_id);
  assert.ok(back, "carrier record → Experience resolves on read-back");
  assert.equal(back.case_id, r.record.case_id);
});

test("CARRIER(c): a role the record's own verdict contradicts is REFUSED, with the derivation printed", () => {
  const root = mkTmp();
  const refuted = clusterRec({ confirmed: false, refutation_verdict: "refuted" });
  const bad = ingestCluster(root, refuted, { role: "found-unresolved" });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((x) => x.startsWith("ROLE_VERDICT_INCONSISTENT:")), JSON.stringify(bad.reasons));
  assert.match(bad.reasons[0], /derives-refuted/, "the refusal says WHICH verdict it derived, not just that it disagreed");
  assert.equal(lines(root), 0, "nothing was appended");
  // The matching role IS accepted — the refusal is about the contradiction, not about the arm being dead.
  const good = ingestCluster(root, refuted, { role: "confirmed-negative" });
  assert.equal(good.ok, true, good.reasons?.join(","));
  assert.equal(lines(root), 1);
});

test("CARRIER(d): a record with NO id is refused; a caller-declared `duplicate` role is accepted", () => {
  const root = mkTmp();
  const noId = clusterRec({ record_id: undefined });
  const bad = ingestCluster(root, noId);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.reasons, ["CARRIER_RECORD_ID_MISSING:the-record-carries-no-id-so-no-experience-can-point-back-at-it"]);
  assert.equal(lines(root), 0);
  // `duplicate` is IN the vocabulary and compatible with `supported`: the claim held, it was just not new.
  assert.ok(EXPERIENCE_ROLES.includes("duplicate"));
  assert.deepEqual([...ROLE_VERDICT_COMPAT.duplicate], ["supported"]);
  const dup = ingestCluster(root, clusterRec(), { role: "duplicate" });
  assert.equal(dup.ok, true, dup.reasons?.join(","));
  assert.equal(dup.record.role, "duplicate");
  // …and it is refused for a cluster whose claim did NOT hold, like every other role.
  const wrong = ingestCluster(root, clusterRec({ confirmed: false, refutation_verdict: "refuted" }), { role: "duplicate" });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.reasons.some((x) => x.startsWith("ROLE_VERDICT_INCONSISTENT:")));
});

test("CARRIER(e): every narration guard is its OWN refusal — nothing is defaulted", () => {
  const root = mkTmp();
  const missingRec = ingestExperience(root, { source: "discovery-carrier", role: "found-unresolved", caseId: "c", summary: SUMMARY, authoredBy: OPERATOR });
  assert.deepEqual(missingRec.reasons, ["INGEST_ARG_MISSING:record-{rec,raw,line}"]);
  assert.deepEqual(ingestCluster(root, clusterRec({ kind: "scan-round" })).reasons, [`CARRIER_RECORD_KIND_MISMATCH:scan-round-is-not-a-${CARRIER_CLUSTER_KIND}`]);
  const rec = clusterRec();
  const env = { rec, raw: JSON.stringify(rec), line: 1 };
  const base = { source: "discovery-carrier", record: env, carrier: ".q/x.jsonl", role: "found-unresolved", caseId: "c", summary: SUMMARY, authoredBy: OPERATOR };
  assert.deepEqual(ingestExperience(root, { ...base, record: { ...env, raw: 7 } }).reasons, ["INGEST_ARG_MISSING:record.raw"]);
  assert.deepEqual(ingestExperience(root, { ...base, record: { ...env, line: 0 } }).reasons, ["INGEST_ARG_MISSING:record.line"]);
  assert.deepEqual(ingestExperience(root, { ...base, carrier: "" }).reasons, ["INGEST_ARG_MISSING:carrier"]);
  assert.deepEqual(ingestExperience(root, { ...base, caseId: "" }).reasons, ["INGEST_ARG_MISSING:caseId"]);
  assert.deepEqual(ingestExperience(root, { ...base, authoredBy: undefined }).reasons, ["INGEST_ARG_MISSING:authoredBy-{actor,ref}"]);
  assert.ok(ingestExperience(root, { ...base, role: "no-such-role" }).reasons[0].startsWith("ROLE_NOT_IN_VOCAB:"));
  // An UNKNOWN source is still its own refusal, and it NAMES the full vocabulary — the third arm did not
  // silently widen the gate to «anything goes».
  assert.deepEqual(ingestExperience(root, { source: "discovery-carrier-x" }).reasons, [`${SOURCE_NOT_IN_VOCAB}:discovery-carrier-x-must-be-user-or-system-or-discovery-carrier`]);
  assert.equal(lines(root), 0, "not one of the refusals appended anything");
});

test("CARRIER(f): a short summary is REFUSED by the same floor as every other source (no padding path)", () => {
  const root = mkTmp();
  const bad = ingestCluster(root, clusterRec(), { summary: "too thin" });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons[0].startsWith("SUMMARY_INSUBSTANTIAL:"), bad.reasons[0]);
  assert.ok(MIN_SUMMARY_CHARS > "too thin".length, "…and the fixture really is under the floor");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE STORE'S OWN BOOTSTRAP (task gap-discovery-method-evidence-store-never-autonomously-populated)
//
// The defect: NOTHING RESIDENT writes `.quay/architecture-evidence-store.jsonl` (the only writers are
// the manual `--write-store` subcommands of `arch-hypothesis-generation.mjs` and the manual
// `ownership-active-loop.mjs`), so on a fresh host `discovery_method`'s ingest step refused EVERY round
// with `EVIDENCE_STORE_MISSING` — a gate whose only exit was a human typing a research command.
//
// ⛔ THE FOUR READINGS THESE TESTS SEPARATE, and why each needs its own (硬规则 3b): (1) the store was
// absent ⇒ it is CREATED EMPTY and the round proceeds with 0 to ingest; (2) the store was already there
// ⇒ same outcome, DIFFERENT reading (`store_bootstrapped:false`); (3) the store's existence was never
// established (a disabled round) ⇒ `null`, not `false`; (4) the store is THERE BUT UNREADABLE ⇒ still
// FAILS CLOSED with its own code. Collapsing any two of these is the failure this block exists to pin.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("BOOTSTRAP: an ABSENT store is created EMPTY and the round proceeds — 0 to ingest, never a refusal", () => {
  const root = mkTmp();
  const file = storeFile(root);
  assert.equal(fs.existsSync(file), false, "the fixture really starts with no store");

  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.store_bootstrapped, true, "…and the run SAYS it created the store");
  assert.equal(r.ingested, 0);
  assert.equal(r.scanned, 0, "there was nothing to scan — which is a reading, not a failure");
  assert.equal(r.remainder, 0);

  // ⛔ NOT A FABRICATION: the created carrier holds ZERO records. An empty JSONL carrier is a VALID
  // carrier with no records (every line vacuously satisfies the schema); a synthetic `evidence`/
  // `outcome` record asserting a reading nobody took would NOT be.
  assert.equal(fs.existsSync(file), true, "the store now exists");
  assert.equal(fs.readFileSync(file, "utf8"), "", "…and its bytes are none");
  assert.deepEqual(readRecords(file), { records: [], malformed_lines: 0 });
  assert.equal(lines(root), 0, "not one Experience was written either");

  // The SECOND run reads the same empty store and reports the OTHER reading: it did not create it.
  const again = ingestNewOutcomes(root);
  assert.equal(again.ok, true);
  assert.equal(again.store_bootstrapped, false, "«we made it exist» and «it was already empty» never merge");
  assert.equal(again.ingested, 0);
});

test("BOOTSTRAP: a run that never established the store's existence reports `null`, not `false`", () => {
  const root = mkTmp();
  const off = ingestNewOutcomes(root, { enabled: false });
  assert.equal(off.store_bootstrapped, null, "the kill switch means the store was never looked at");
  assert.equal(fs.existsSync(storeFile(root)), false, "…so a disabled round creates NOTHING");
});

test("BOOTSTRAP: `ensureEvidenceStore` is idempotent and names the run that created the file", () => {
  const root = mkTmp();
  const first = ensureEvidenceStore(root);
  assert.equal(first.ok, true);
  assert.equal(first.bootstrapped, true);
  assert.equal(first.store, storeFile(root));
  const second = ensureEvidenceStore(root);
  assert.equal(second.ok, true);
  assert.equal(second.bootstrapped, false);
  assert.equal(fs.readFileSync(first.store, "utf8"), "", "the second call did not touch the bytes");
});

test("BOOTSTRAP negative control: a store that is THERE BUT UNREADABLE still fails closed, distinctly", () => {
  const root = mkTmp();
  // A directory in the store's place: `existsSync` is true, so the bootstrap must NOT fire — "not there"
  // and "there but broken" are two different findings and stay distinguishable.
  fs.mkdirSync(storeFile(root), { recursive: true });
  const r = ingestNewOutcomes(root);
  assert.equal(r.ok, false, "an unreadable store is NOT a zero-work round");
  assert.equal(r.store_bootstrapped, null, "…and it is not reported as bootstrapped either");
  assert.ok(r.reasons.some((x) => x.startsWith("EVIDENCE_STORE_UNREADABLE:")), r.reasons.join(","));
  assert.equal(r.reasons.some((x) => x.startsWith("EVIDENCE_STORE_MISSING:")), false, "the absent-file code must NOT cover a present-but-broken store");
});

test("BOOTSTRAP: the bootstrap does not revive the NAMED-record lookup's absent-store refusal", () => {
  // The two callers differ in what «absent» MEANS to them, and the fix is deliberately narrow: a lookup
  // handed the NAME of a record cannot bootstrap its way to containing it (see `ensureEvidenceStore`).
  const root = mkTmp();
  const r = ingestPinned(root, { experiment: "E-FIX", experimentRef: "x", role: "found-and-fixed", caseId: "c", summary: SUMMARY });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("EVIDENCE_STORE_MISSING:")), r.reasons.join(","));
  assert.equal(fs.existsSync(storeFile(root)), false, "…and a failed lookup leaves no store behind");
});
