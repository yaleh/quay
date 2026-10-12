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
  componentsFromSubjectKey, evaluationPinOf, readIngestWatermark, sharedStoreFile,
} from "../../docs/analysis/discovery-experience-ledger.mjs";
import { appendOutcomeRecord, storeFile, sha256 } from "../../docs/analysis/architecture-evidence-store.mjs";
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
  assert.deepEqual([...EXPERIENCE_ROLES], ["missed-by-tooling", "found-and-fixed", "found-undetermined-then-confirmed", "confirmed-negative", "recurred-after-fix", "found-unresolved", "undetermined"]);
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

  const r = ingestFeedback(worktree, AC_CASE);
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

  const r = ingestFeedback(bare, AC_CASE);
  assert.equal(r.ok, false);
  assert.equal(r.appended, false);
  assert.match(r.reasons[0], new RegExp(`^${SHARED_CHECKOUT_UNRESOLVED}:`), "the refusal names the resolver, not the record");
  assert.deepEqual(fs.readdirSync(bare), [], "NOTHING was created — not even the .quay/ directory");

  // Negative control on the same predicate: the SAME record against a git-repo root IS accepted, so
  // the refusal above is the resolver and not the record.
  assert.equal(ingestFeedback(mkTmp(), AC_CASE).ok, true);
});

test("AC2(c): re-appending the same record is DUPLICATE_ID and leaves the carrier byte-identical", () => {
  const root = mkTmp();
  const first = ingestFeedback(root, AC_CASE);
  assert.equal(first.ok, true, first.reasons?.join(","));
  const before = fs.readFileSync(ledgerFile(root), "utf8");
  assert.equal(before.split("\n").filter(Boolean).length, 1);

  const again = ingestFeedback(root, AC_CASE);
  assert.equal(again.ok, false);
  assert.equal(again.appended, false);
  assert.equal(again.duplicate, true, "'already there' is its OWN outcome, not a generic failure");
  assert.match(again.reasons[0], new RegExp(`^${DUPLICATE_ID}:${first.id}-`));
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8"), before, "the carrier is BYTE-IDENTICAL");
  assert.equal(again.id, first.id, "a content-addressed id is what makes the re-append detectable");

  // Negative control: a DIFFERENT record does append, so the skip is the id and not a blanket no.
  assert.equal(ingestFeedback(root, { ...AC_CASE, caseId: "AC2-worktree-persistence-2" }).ok, true);
  assert.equal(fs.readFileSync(ledgerFile(root), "utf8").split("\n").filter(Boolean).length, 2);

  // …and the lock file is RELEASED (a lock left behind would wedge the carrier for every later run).
  assert.equal(fs.existsSync(`${ledgerFile(root)}.lock`), false);
});

test("AC2(d): a torn FINAL line reads as malformed_lines:1, and repairCarrier restores it with a backup", () => {
  const root = mkTmp();
  assert.equal(ingestFeedback(root, AC_CASE).ok, true);
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
  assert.equal(ingestFeedback(root, AC_CASE).ok, true);
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

test("AC1(a): a store with 3 outcomes ⇒ 3 Experiences with derived roles, watermark at the last line", () => {
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

test("AC1(b): a second run ingests 0 and leaves the carriers byte-identical", () => {
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

test("AC1(c): maxPerRun:2 ⇒ 2 ingested with the remainder reported; the next run ingests the rest", () => {
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

test("AC1(d): enabled:false ⇒ zero reads and zero writes — the switch is answered before any I/O", () => {
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

test("AC1(e): a rewritten store ⇒ WATERMARK_MISMATCH, and NOTHING is written", () => {
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

test("AC1(f): summary/components equal the values DERIVED from the record; a caller-supplied summary is refused", () => {
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

test("AC1(f): the case_id of a derived entry is deterministic and chosen by nobody", () => {
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

test("AC1(g): a user-sourced Experience goes through the same ingestExperience and lands in the same carrier", () => {
  const root = mkTmp();
  const r = ingestExperience(root, {
    source: "user", caseId: "TEACH-via-unified-entry", role: "missed-by-tooling",
    evidenceRefs: ["gap-discovery-experience-auto-ingest-from-evidence-store"],
    components: ["plugin/scripts/x.ts"], summary: SUMMARY,
  });
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(r.record.reported_by, "user");
  assert.equal(r.record.source_ref, null, "the manual half is not derived from any record");
  assert.equal(r.file, ledgerFile(root), "ONE carrier for both sources");
  // …and `ingestFeedback` is the SAME entry, not a parallel one: byte-identical records collapse to
  // one id (the content-addressed dedup), which can only happen if both paths build the same record.
  const viaAdapter = ingestFeedback(root, {
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
