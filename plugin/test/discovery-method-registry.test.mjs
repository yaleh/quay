// @test-group engine
// Tests for the DISCOVERY METHOD REGISTRY (task gap-discovery-method-registry-and-versioned-contract,
// AC1 a–h; plus the tool≠subject ACs of gap-discovery-method-record-tool-vs-subject-leak). The
// contract under test: a record that cannot be a valid, *next* version of a method is REFUSED with a
// distinct reason and NOTHING is written — "I could not write a valid record" must never be shaped
// like "I wrote one", and "I could not read the tool catalog" must never be shaped like "every tool is
// fine" (硬规则 3b).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  METHOD_REGISTRY_REL, METHOD_KIND, METHOD_STATUSES, REQUIRED_METHOD_FIELDS, MIN_APPLICABILITY_CHARS,
  DEDUP_THRESHOLD, EVIDENCE_STORE_PRIMITIVES, CATALOG_DECLARATIONS_REL,
  registryFile, loadToolCatalog, defaultToolNames, validateMethodRecord,
  readMethodRegistry, appendMethodRecord, dedupMethods, methodRecordId,
  provenanceSeeds, seedReasons, seedSetForRecord, seedScannedTexts, basenameOf,
  TOOL_IS_SUBJECT, METHOD_TEXT_NAMES_SEED, PROVENANCE_SEEDS_UNAVAILABLE, SEED_SCANNED_TEXT_FIELDS,
  activeMethods, generalizationEvidenceReasons, PROMOTION_WITHOUT_VALID_GENERALIZATION, PROMOTION_REFUSAL_CAUSES,
} from "../../docs/analysis/discovery-method-registry.mjs";
import {
  appendExperienceRecord, DISCOVERY_CARRIERS, GENERALIZATION_VERDICTS_REL,
} from "../../docs/analysis/discovery-experience-ledger.mjs";

const tmpDirs = [];
const plainTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-method-registry-")); tmpDirs.push(d); return d; };
/** A REAL git repo: the carriers resolve through `git rev-parse --git-common-dir` to the SHARED
 *  checkout, so a bare directory is no longer a usable fixture root (an unresolvable shared checkout
 *  is REFUSED by design). */
const mkTmp = () => { const d = plainTmp(); execFileSync("git", ["init", "-q", d], { stdio: "ignore" }); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

/** Write a RECORDED generalization verdict through the REAL carrier writer (no hand-written JSONL), so
 *  the promotion rule is exercised against the shape the reflection module actually records. */
const writeVerdict = (root, over = {}) => {
  const rec = {
    id: over.id ?? "generalization_verdict-fixture0000000000",
    kind: DISCOVERY_CARRIERS["discovery-generalization-verdicts"].kind,
    ts: "2026-10-12T00:00:00.000Z",
    method_id: "shared-contract-divergence", version: 2, held_out_case_id: "EXP-heldout",
    called: true, outcome: "evaluated", refusal_code: null, predicted_verdict: "refuted",
    expected_verdicts: ["refuted"], correct: true, lineage_ok: true, temporal_ok: true,
    evaluation_pin: "a".repeat(40), evaluated_commit: "a".repeat(40), promoted: true,
    retirement_reason: null, not_evaluated_reason: null,
    ...over,
  };
  const file = path.join(root, GENERALIZATION_VERDICTS_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
  return rec;
};

const lines = (root) => { const f = registryFile(root); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0; };

/** A FIXTURE capability-catalog listing — the tests never depend on the real repo's 373 entries. */
const CATALOG = Object.freeze(["import-graph-check.ts", "code-span-strip.ts", "archguard-runner.ts", "readRecords"]);

/** The SEED set of a record with no resolvable provenance Experience — the value `provenanceSeeds`
 *  returns for a record whose provenance cites only evidence-store records. The seed check is part of
 *  the contract, so it is supplied EXPLICITLY at every call site rather than defaulted (硬规则 3b). */
const NO_SEEDS = Object.freeze({ ok: true, components: [], component_basenames: [], case_ids: [], text_matches: [] });

/** One COMPLETE, valid draft method — the baseline every refusal variant below is derived from. */
const GOOD = Object.freeze({
  method_id: "shared-contract-divergence",
  version: 1,
  ts: "2026-10-12T00:00:00Z",
  provenance_evidence: ["outcome-bb12a6858838e74b"],
  applicability: Object.freeze({
    domain_signals: Object.freeze(["a contract or field set declared in two modules that must stay in sync"]),
    preconditions: Object.freeze(["both declarations are reachable through a shared import path"]),
  }),
  operation: Object.freeze({
    steps: Object.freeze(["extract every field name from each twin declaration", "diff the two extracted sets"]),
    tools: Object.freeze(["import-graph-check.ts", "code-span-strip.ts"]),
  }),
  expected_invariant: "the two declarations name the same field set",
  falsification: "one module's field set gains a name the other never carries",
  cost_budget: Object.freeze({ max_candidates: 4, max_model_calls: 0, max_wall_ms: 60000 }),
  status: "draft",
  retirement_reason: null,
  supersedes: null,
});

const withSeeds = (rec, seeds = NO_SEEDS, toolCatalog = CATALOG) => validateMethodRecord(rec, { toolCatalog, provenanceSeeds: seeds });

// ── AC1(a): a well-formed draft method is accepted and appended ─────────────────────────────────

test("AC1(a): a well-formed draft method is accepted, appended, and reads back", () => {
  const root = mkTmp();
  const r = appendMethodRecord(root, GOOD, { toolCatalog: CATALOG });
  assert.equal(r.ok, true, `expected acceptance, got ${r.reasons?.join(",")}`);
  assert.match(r.id, /^method-[0-9a-f]{16}$/, "content-addressed id, same scheme as the evidence store");
  // ⛔ CHANGED by gap-discovery-carriers-ephemeral-in-worktree: `appended` is now present on BOTH arms
  // (`true` here, `false` on every refusal) instead of only marking refusals — the append path is the
  // shared locked/atomic one, and "was a line actually written" is the reading that path reports. The
  // old assertion pinned the ABSENCE of the field, which would have made "appended" unreadable as a
  // value (硬规则 3b).
  assert.equal(r.appended, true, "an ACCEPTED write says a line was appended");
  assert.equal(fs.readFileSync(registryFile(root), "utf8").split("\n").filter(Boolean).length, 1, "…and exactly one line is on disk");
  assert.equal(lines(root), 1);
  const read = readMethodRegistry(root, { history: true });
  assert.equal(read.ok, true);
  assert.equal(read.history.length, 1);
  assert.equal(read.history[0].kind, METHOD_KIND);
  assert.equal(read.history[0].method_id, GOOD.method_id);
  assert.equal(read.history[0].status, "draft");
  assert.equal(registryFile(root), path.join(root, METHOD_REGISTRY_REL));
  assert.equal(METHOD_REGISTRY_REL, ".quay/discovery-method-registry.jsonl");
});

test("AC1(a): a refused write appends NOTHING and does not even create the carrier", () => {
  const root = mkTmp();
  const r = appendMethodRecord(root, { ...GOOD, status: "not-a-status" }, { toolCatalog: CATALOG });
  assert.equal(r.ok, false);
  assert.equal(r.appended, false, "the refusal marker is present on the refusal path");
  assert.equal(lines(root), 0);
  assert.equal(fs.existsSync(registryFile(root)), false, "no carrier file was created by refusals alone");
});

// ── AC1(b): empty provenance_evidence is refused with a DISTINCT reason code ─────────────────────

test("AC1(b): empty provenance_evidence is refused with its own code (not the generic missing-field one)", () => {
  const root = mkTmp();
  for (const empty of [[], ["   "], "not-an-array"]) {
    const r = appendMethodRecord(root, { ...GOOD, provenance_evidence: empty }, { toolCatalog: CATALOG });
    assert.equal(r.ok, false, `provenance_evidence=${JSON.stringify(empty)} must be refused`);
    assert.ok(r.reasons.some((x) => x.startsWith("PROVENANCE_EMPTY:")), `distinct code, got ${r.reasons.join(",")}`);
    assert.ok(!r.reasons.includes("SCHEMA_MISSING:provenance_evidence"), "present-but-empty is NOT the absent-field cause");
  }
  assert.equal(lines(root), 0);
});

// ── AC1(c): empty falsification is refused ──────────────────────────────────────────────────────

test("AC1(c): an empty falsification is refused with its own code; absent is a different cause", () => {
  const root = mkTmp();
  const empty = appendMethodRecord(root, { ...GOOD, falsification: "  " }, { toolCatalog: CATALOG });
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.reasons, ["FALSIFICATION_EMPTY:falsification-must-name-what-would-refute-a-candidate"]);
  const rec = { ...GOOD }; delete rec.falsification;
  assert.deepEqual(appendMethodRecord(root, rec, { toolCatalog: CATALOG }).reasons, ["SCHEMA_MISSING:falsification"]);
  assert.equal(lines(root), 0);
});

// ── AC1(d): status:"retired" with retirement_reason:null is refused ──────────────────────────────

test("AC1(d): a retired method with no retirement_reason is refused", () => {
  const root = mkTmp();
  const r = appendMethodRecord(root, { ...GOOD, status: "retired", retirement_reason: null }, { toolCatalog: CATALOG });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["RETIREMENT_REASON_REQUIRED:status=retired-needs-a-non-empty-retirement_reason"]);
  // A retirement WITH a reason is accepted; and `draft`/`active` still require the key to be present.
  const ok = appendMethodRecord(root, { ...GOOD, status: "retired", retirement_reason: "superseded by the v2 detector" }, { toolCatalog: CATALOG });
  assert.equal(ok.ok, true, ok.reasons?.join(","));
  const missingKey = { ...GOOD }; delete missingKey.retirement_reason;
  assert.deepEqual(appendMethodRecord(root, missingKey, { toolCatalog: CATALOG }).reasons, ["SCHEMA_MISSING:retirement_reason"]);
  assert.equal(lines(root), 1, "only the one well-formed retired record was appended");
});

// ── AC1(e): a tools entry not present in the (fixture) capability-catalog listing is refused ─────

test("AC1(e): a tool not in the fixture capability-catalog listing is refused, naming the tool", () => {
  const root = mkTmp();
  const rec = { ...GOOD, operation: { ...GOOD.operation, tools: ["import-graph-check.ts", "no-such-tool.ts"] } };
  const r = appendMethodRecord(root, rec, { toolCatalog: CATALOG });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["TOOL_NOT_IN_CATALOG:no-such-tool.ts"]);
  assert.equal(lines(root), 0);
  // The check is against a LISTING, not against a boolean: the same record passes when the listing
  // contains the name — i.e. the refusal is caused by the listing, not by the tool's spelling.
  assert.equal(withSeeds(rec, NO_SEEDS, [...CATALOG, "no-such-tool.ts"]).ok, true);
});

test("AC1(e): an ABSENT tool catalog is its OWN refusal value, never a skipped check (硬规则 3b)", () => {
  const root = mkTmp();
  const r = validateMethodRecord(GOOD);          // no catalog supplied ⇒ cannot check ⇒ refuse
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("TOOL_CATALOG_UNAVAILABLE:")), r.reasons.join(","));
  assert.ok(!r.reasons.some((x) => x.startsWith("TOOL_NOT_IN_CATALOG")), "「read不懂输入」 must not be reported as 「名字不在表里」");
  assert.equal(lines(root), 0);
  // An unreadable catalog FILE is the same distinct value — it is not an empty-passes-everything list.
  const bad = loadToolCatalog(path.join(root, "nowhere"));
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /^CATALOG_UNREADABLE:/);
  assert.deepEqual(bad.names, []);
});

test("AC1(e): an ABSENT seed set is its OWN refusal value too — a validator blind to the provenance must not report 「fine」", () => {
  // The tool check alone cannot tell an instrument from the file being inspected; a caller that did not
  // supply the seed set has not run that half of the contract (硬规则 3b).
  const r = validateMethodRecord(GOOD, { toolCatalog: CATALOG });
  assert.deepEqual(r.reasons, [`${PROVENANCE_SEEDS_UNAVAILABLE}:provenance-seeds-not-supplied-so-a-subject-file-cannot-be-told-from-a-tool`]);
  assert.equal(validateMethodRecord(GOOD, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS }).ok, true);
});

test("AC1(e): the REAL capability catalog is read from its single source, and its names are checkable", () => {
  const cat = loadToolCatalog();
  assert.equal(cat.ok, true, `the repo's own catalog must be readable: ${cat.reason}`);
  assert.ok(cat.names.length > 100, `a real catalog listing, got ${cat.names.length}`);
  assert.ok(cat.names.includes("import-graph-check.ts"));
  assert.ok(cat.file.endsWith(CATALOG_DECLARATIONS_REL));
  const all = defaultToolNames();
  assert.equal(all.ok, true, all.reason);
  // The vocabulary is the CATALOG ∪ the evidence store's primitives — both halves are real.
  assert.ok(all.names.includes("code-span-strip.ts"), "a catalog entry");
  assert.ok(all.names.includes("readRecords"), "an evidence-store primitive");
  assert.ok(EVIDENCE_STORE_PRIMITIVES.length > 5);
  // …and a record naming both halves is accepted through the DEFAULT catalog path (no injection).
  const root = mkTmp();
  const real = { ...GOOD, method_id: "real-catalog-path", operation: { ...GOOD.operation, tools: ["archguard-runner.ts", "readRecords"] } };
  const r = appendMethodRecord(root, real);
  assert.equal(r.ok, true, `default catalog path must accept a real tool: ${r.reasons?.join(",")}`);
});

// ── AC1(f): skipping a version is refused ────────────────────────────────────────────────────────

test("AC1(f): version 3 when only version 1 exists (skipping 2) is refused; 2 is accepted", () => {
  const root = mkTmp();
  assert.equal(appendMethodRecord(root, GOOD, { toolCatalog: CATALOG }).ok, true);
  const skip = appendMethodRecord(root, { ...GOOD, version: 3 }, { toolCatalog: CATALOG });
  assert.equal(skip.ok, false);
  assert.deepEqual(skip.reasons, [`VERSION_NOT_MONOTONIC:${GOOD.method_id}-expects-2-got-3`]);
  assert.equal(lines(root), 1, "the refused version wrote nothing — this is append-only, not a rewrite");
  const next = appendMethodRecord(root, { ...GOOD, version: 2, ts: "2026-10-12T01:00:00Z" }, { toolCatalog: CATALOG });
  assert.equal(next.ok, true, next.reasons?.join(","));
  assert.equal(lines(root), 2);
  // Monotonicity is PER method_id: a different method may start at 1 in the same registry.
  assert.equal(appendMethodRecord(root, { ...GOOD, method_id: "other-method" }, { toolCatalog: CATALOG }).ok, true);
  assert.equal(lines(root), 3);
});

test("AC1(f): an unreadable registry is refused with its OWN reason, never treated as empty", () => {
  const root = mkTmp();
  assert.equal(appendMethodRecord(root, GOOD, { toolCatalog: CATALOG }).ok, true);
  fs.appendFileSync(registryFile(root), "{not json\n", "utf8");
  const r = appendMethodRecord(root, { ...GOOD, version: 2 }, { toolCatalog: CATALOG });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("REGISTRY_UNREADABLE:")), r.reasons.join(","));
  assert.equal(lines(root), 2, "the corrupt line was not touched and nothing was appended");
  const read = readMethodRegistry(root);
  assert.equal(read.ok, false, "the read reports the unusable carrier instead of a clean latest-set");
  assert.equal(read.malformed_lines, 1);
});

// ── AC1(g): latest-per-method_id by default; full history on request ────────────────────────────

test("AC1(g): readMethodRegistry returns only the LATEST version per method_id, and history when asked", () => {
  const root = mkTmp();
  appendMethodRecord(root, { ...GOOD, version: 1 }, { toolCatalog: CATALOG });
  appendMethodRecord(root, { ...GOOD, version: 2, ts: "2026-10-12T01:00:00Z" }, { toolCatalog: CATALOG });
  appendMethodRecord(root, { ...GOOD, method_id: "second-method", version: 1, ts: "2026-10-12T02:00:00Z" }, { toolCatalog: CATALOG });

  const latestOnly = readMethodRegistry(root);
  assert.equal(latestOnly.latest.length, 2, "one entry per method_id, not one per record");
  assert.equal(latestOnly.latest.find((m) => m.method_id === GOOD.method_id).version, 2, "v1 is never presented as current");
  assert.deepEqual(latestOnly.latest.map((m) => m.method_id), ["second-method", GOOD.method_id], "deterministic (lexicographic) order");
  assert.equal(latestOnly.history, null, "history NOT requested is `null` — distinct from `[]`");
  assert.equal(latestOnly.ok, true);

  const full = readMethodRegistry(root, { history: true });
  assert.equal(full.history.length, 3);
  assert.equal(full.history[0].version, 1, "history preserves the append order");
  assert.equal(full.latest.length, 2);
});

test("readMethodRegistry on a root with no carrier is an empty registry, not a crash", () => {
  const read = readMethodRegistry(mkTmp(), { history: true });
  assert.deepEqual({ ok: read.ok, latest: read.latest, history: read.history, malformed_lines: read.malformed_lines },
    { ok: true, latest: [], history: [], malformed_lines: 0 });
});

// ── AC1(h): dedupMethods flags an overlapping pair and NOT an unrelated one ──────────────────────

test("AC1(h): dedupMethods flags a pair sharing domain_signals AND tools, and not an unrelated pair", () => {
  const twin = { ...GOOD, method_id: "twin-method", operation: { ...GOOD.operation, tools: ["import-graph-check.ts", "archguard-runner.ts"] } };
  const unrelated = {
    ...GOOD, method_id: "unrelated-method",
    applicability: { domain_signals: ["an unshipped CLI verb with no registry entry"], preconditions: ["the verb is declared"] },
    operation: { steps: ["list every verb"], tools: ["code-span-strip.ts"] },
  };
  // The twin shares one domain signal and one tool; `unrelated` shares only ONE TOOL (code-span-strip.ts)
  // with the baseline, so it must NOT be flagged — the threshold is reported, not hidden.
  const report = dedupMethods([GOOD, twin, unrelated]);
  assert.equal(report.pairs.length, 1, JSON.stringify(report.pairs));
  assert.equal(report.pairs[0].a, GOOD.method_id);
  assert.equal(report.pairs[0].b, "twin-method");
  assert.deepEqual(report.pairs[0].shared_tools, ["import-graph-check.ts"]);
  assert.equal(report.pairs[0].shared_domain_signals.length, 1);
  assert.match(report.pairs[0].pair_id, /^dup-[0-9a-f]{12}$/);
  assert.deepEqual(report.threshold, { minSharedDomainSignals: DEDUP_THRESHOLD.minSharedDomainSignals, minSharedTools: DEDUP_THRESHOLD.minSharedTools });
  assert.equal(report.evaluated, 3);
  assert.equal(report.ok, true);
});

test("AC1(h): two VERSIONS of one method are never a duplicate pair; the report accepts a readMethodRegistry value", () => {
  const root = mkTmp();
  appendMethodRecord(root, { ...GOOD, version: 1 }, { toolCatalog: CATALOG });
  appendMethodRecord(root, { ...GOOD, version: 2, ts: "2026-10-12T01:00:00Z" }, { toolCatalog: CATALOG });
  // Over the FULL history the two versions share everything, but they are the same method — not a pair.
  assert.deepEqual(dedupMethods(readMethodRegistry(root, { history: true }).history).pairs, []);
  // And the object form (`registry.latest`) is accepted directly.
  assert.deepEqual(dedupMethods(readMethodRegistry(root)).pairs, []);
});

// ── the refusal vocabulary stays enumerable, and the applicability substance gate is real ────────

test("the applicability check is on SUBSTANCE, not on a boolean", () => {
  const root = mkTmp();
  const thin = { ...GOOD, applicability: { domain_signals: ["x"], preconditions: [] } };
  const r = appendMethodRecord(root, thin, { toolCatalog: CATALOG });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("APPLICABILITY_INSUBSTANTIAL:")), r.reasons.join(","));
  // `{applies: true}` — the boolean form the contract forbids — is not a valid applicability at all.
  assert.deepEqual(withSeeds({ ...GOOD, applicability: { applies: true } }).reasons,
    ["APPLICABILITY_INVALID:needs-{domain_signals:[string],preconditions:[string]}"]);
  // The substance gate has real headroom: the baseline clears it.
  const joined = [...GOOD.applicability.domain_signals, ...GOOD.applicability.preconditions].join(" ").replace(/\s+/g, "").length;
  assert.ok(joined >= MIN_APPLICABILITY_CHARS, `${joined} >= ${MIN_APPLICABILITY_CHARS}`);
  assert.equal(lines(root), 0);
});

test("the refusal vocabulary is enumerable — every required field has its own absent-key code", () => {
  const root = mkTmp();
  assert.deepEqual(validateMethodRecord(null, { toolCatalog: CATALOG }).reasons, ["RECORD_NOT_OBJECT"]);
  for (const f of REQUIRED_METHOD_FIELDS) {
    const rec = { ...GOOD }; delete rec[f];
    assert.deepEqual(withSeeds(rec).reasons, [`SCHEMA_MISSING:${f}`], f);
  }
  assert.equal(withSeeds({ ...GOOD, status: "gone" }).reasons.join(), "STATUS_NOT_IN_VOCAB:gone");
  // version must be a positive integer AND the next one: `0` is a type/range fault, `3` is a skip.
  assert.deepEqual(withSeeds({ ...GOOD, version: 0 }).reasons, ["FIELD_INVALID:version"]);
  assert.equal(withSeeds({ ...GOOD, version: 3 }).reasons.join(), "VERSION_NOT_MONOTONIC:shared-contract-divergence-expects-1-got-3");
  assert.deepEqual([...METHOD_STATUSES], ["draft", "active", "retired"]);
  // cost_budget is three integers, never a prose budget.
  for (const bad of [{ max_candidates: 4, max_model_calls: 0 }, { max_candidates: -1, max_model_calls: 0, max_wall_ms: 1 }, "cheap"]) {
    assert.match(withSeeds({ ...GOOD, cost_budget: bad }).reasons.join(), /COST_BUDGET_INVALID/);
  }
  assert.equal(lines(root), 0);
});

test("records are content-addressed: identical content ⇒ one id, a changed field ⇒ a different id", () => {
  assert.equal(methodRecordId(GOOD), methodRecordId({ ...GOOD }));
  assert.notEqual(methodRecordId(GOOD), methodRecordId({ ...GOOD, version: 2 }));
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL ≠ SUBJECT (task gap-discovery-method-record-tool-vs-subject-leak, AC1 a–d + the AC2 real
// control). The defect under test was found by a read-only audit of the landed Phase 2: the registry
// could only ask "is this name a real instrument?", never "is this name the thing that was INSPECTED?"
// — and the seed files are BOTH. Every case below therefore drives the check through the record's own
// PROVENANCE, which is the only place the distinction exists.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** The Experience that owns the subject files — written through the ledger module's OWN append, so the
 *  carrier under test is the real one, not a hand-made line. */
const SEED_CASE = Object.freeze({
  case_id: "EXP-subject-fixture",
  role: "found-and-fixed",
  source_ref: "outcome-0123456789abcdef",
  components: Object.freeze(["plugin/scripts/subject-writer.ts", "plugin/scripts/subject-checker.ts"]),
  summary: "the subject writer and the subject checker each declare the same field set, so the two can drift apart with neither side noticing",
});

/** A SECOND, unrelated case — the control that the seed scan is scoped to the record's provenance and
 *  is not a global ban on every name any case ever mentioned. */
const OTHER_CASE = Object.freeze({
  case_id: "EXP-other-fixture",
  role: "confirmed-negative",
  source_ref: "outcome-fedcba9876543210",
  components: Object.freeze(["plugin/scripts/other-subject.ts"]),
  summary: "an unrelated claim about a writer and its checker was refuted, so no method was minted from it at all",
});

/** A root carrying a REAL ledger (both cases). */
const mkSeedRoot = () => {
  const root = mkTmp();
  for (const c of [SEED_CASE, OTHER_CASE]) {
    const r = appendExperienceRecord(root, {
      case_id: c.case_id, ts: "2026-10-12T00:00:00Z", role: c.role, reported_by: "system",
      source_ref: c.source_ref, evidence: [{ ref: c.source_ref, sha256: "a".repeat(64) }],
      components: [...c.components], summary: c.summary,
    });
    assert.equal(r.ok, true, `ledger append refused: ${r.reasons?.join(",")}`);
  }
  return root;
};

/** The fixture catalog PLUS the subject files, so a refusal can only be TOOL_IS_SUBJECT — a name that
 *  is not a catalog entry at all would be a different code (TOOL_NOT_IN_CATALOG). */
const SEED_CATALOG = Object.freeze([...CATALOG, "subject-writer.ts", "subject-checker.ts", "other-subject.ts"]);

/** The baseline record, grounded in the seed Experience by its `case_id`. */
const SEED_REC = Object.freeze({ ...GOOD, provenance_evidence: Object.freeze([SEED_CASE.case_id]) });

/** Validate a record against the REAL seed set its own provenance yields at `root`. */
const seededCheck = (root, rec) => validateMethodRecord(rec, { toolCatalog: SEED_CATALOG, provenanceSeeds: provenanceSeeds(root, rec) });

test("AC1(a): a tool equal (by basename) to a provenance component ⇒ TOOL_IS_SUBJECT", () => {
  const root = mkSeedRoot();
  const seeds = provenanceSeeds(root, SEED_REC);
  assert.deepEqual(seeds.components, [...SEED_CASE.components].sort(), "the seed set is DERIVED from the ledger, not passed in");
  assert.deepEqual(seeds.component_basenames, ["subject-checker.ts", "subject-writer.ts"]);

  // The subject file IS a real catalog entry — which is exactly why a catalog listing cannot catch it.
  const bad = { ...SEED_REC, operation: { ...GOOD.operation, tools: ["import-graph-check.ts", "subject-writer.ts"] } };
  const r = seededCheck(root, bad);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, [`${TOOL_IS_SUBJECT}:subject-writer.ts`]);

  // The refusal is caused by the PROVENANCE, not by the name: the same tool is accepted when the
  // record is grounded in something else entirely.
  const ungrounded = { ...bad, provenance_evidence: ["outcome-0123456789abcdef"] };
  assert.equal(seededCheck(root, ungrounded).ok, true);

  // The APPEND path resolves the seeds itself — a caller that passes nothing still gets the refusal,
  // and the refusal writes nothing.
  assert.deepEqual(appendMethodRecord(root, bad, { toolCatalog: SEED_CATALOG }).reasons, [`${TOOL_IS_SUBJECT}:subject-writer.ts`]);
  assert.equal(lines(root), 0, "the refusal appended no registry line");
});

test("AC1(b): a genuine analysis tool that is not among the provenance components is ACCEPTED", () => {
  const root = mkSeedRoot();
  const good = { ...SEED_REC, operation: { ...GOOD.operation, tools: ["code-span-strip.ts", "import-graph-check.ts"] } };
  const r = seededCheck(root, good);
  assert.equal(r.ok, true, r.reasons?.join(","));
  // …and it is ACCEPTED through the append path too (the default seed resolution is not a blanket refusal).
  assert.equal(appendMethodRecord(root, good, { toolCatalog: SEED_CATALOG }).ok, true);
  assert.equal(lines(root), 1);
  // A DIFFERENT case's file is not THIS method's seed: the seed set is per record, not a global list.
  const otherFile = { ...SEED_REC, operation: { ...GOOD.operation, tools: ["other-subject.ts"] } };
  assert.equal(seededCheck(root, otherFile).ok, true, "naming another case's file is not this record's leak");
});

test("AC1(c): `expected_invariant` naming a seed basename ⇒ METHOD_TEXT_NAMES_SEED", () => {
  const root = mkSeedRoot();
  const rec = { ...SEED_REC, expected_invariant: "subject-checker.ts and subject-writer.ts always declare the same field set" };
  const r = seededCheck(root, rec);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, [
    `${METHOD_TEXT_NAMES_SEED}:expected_invariant:plugin/scripts/subject-checker.ts`,
    `${METHOD_TEXT_NAMES_SEED}:expected_invariant:plugin/scripts/subject-writer.ts`,
  ]);
  // The scanned-field set is declared as DATA, and the four fields the plan names are exactly it.
  assert.deepEqual([...SEED_SCANNED_TEXT_FIELDS], ["operation.steps", "expected_invariant", "falsification", "applicability"]);
  assert.deepEqual(seedScannedTexts(rec).map((x) => x.field), ["operation.steps", "expected_invariant", "falsification", "applicability"]);
  // The CASE ID is the other half of the deny-list vocabulary: naming the case is naming the seed.
  const byCase = { ...SEED_REC, falsification: `a run of ${SEED_CASE.case_id} that never reproduced` };
  assert.deepEqual(seededCheck(root, byCase).reasons, [`${METHOD_TEXT_NAMES_SEED}:falsification:${SEED_CASE.case_id}`]);
});

test("AC1(d): the same invariant written generically is ACCEPTED — and the scan stays scoped to the provenance", () => {
  const root = mkSeedRoot();
  const generic = { ...SEED_REC, expected_invariant: "both declarations list the same field names, so neither can gain one alone" };
  assert.equal(seededCheck(root, generic).ok, true, "a generic invariant names no seed");
  // A component owned by ANOTHER Experience is not this record's seed…
  const other = { ...SEED_REC, expected_invariant: "every writer and its checker agree about other-subject.ts" };
  assert.equal(seededCheck(root, other).ok, true);
  // …and the SAME text IS refused the moment the record cites that case. Without this arm the scoping
  // filter would pass the test above even if it silently dropped EVERY match.
  const grounded = { ...other, provenance_evidence: [OTHER_CASE.case_id] };
  assert.deepEqual(seededCheck(root, grounded).reasons, [`${METHOD_TEXT_NAMES_SEED}:expected_invariant:plugin/scripts/other-subject.ts`]);
});

test("an unreadable ledger is PROVENANCE_SEEDS_UNAVAILABLE — its own value, never a vacuous pass", () => {
  const root = mkSeedRoot();
  fs.appendFileSync(path.join(root, ".quay", "discovery-experience-ledger.jsonl"), "{not json\n", "utf8");
  const seeds = provenanceSeeds(root, SEED_REC);
  assert.equal(seeds.ok, false);
  assert.match(seeds.reason, new RegExp(`^${PROVENANCE_SEEDS_UNAVAILABLE}:`));
  assert.deepEqual(seededCheck(root, SEED_REC).reasons, [seeds.reason]);
  assert.equal(seededCheck(root, { ...SEED_REC, operation: { ...GOOD.operation, tools: ["code-span-strip.ts"] } }).ok, false,
    "a record that would otherwise pass is NOT passed while the seed set is unreadable");
});

test("records written BEFORE the rule are untouched on disk and flagged legacy_unvalidated on read-back", () => {
  const root = mkSeedRoot();
  const legacy = { ...SEED_REC, operation: { ...GOOD.operation, tools: ["import-graph-check.ts", "subject-writer.ts"] } };
  // Written through the PRE-CHANGE contract (no seed set supplied ⇒ that half of the contract did not exist).
  assert.equal(appendMethodRecord(root, legacy, { toolCatalog: SEED_CATALOG, provenanceSeeds: NO_SEEDS }).ok, true);
  assert.equal(lines(root), 1);

  const read = readMethodRegistry(root);
  assert.equal(read.latest.length, 1);
  assert.equal(read.latest[0].legacy_unvalidated, true);
  assert.deepEqual(read.latest[0].legacy_reasons, [`${TOOL_IS_SUBJECT}:subject-writer.ts`]);
  assert.equal(read.latest[0].operation.tools.includes("subject-writer.ts"), true, "the record on disk is NOT rewritten");
  assert.equal(lines(root), 1);

  // A record that DOES satisfy the rule reads back with the flag false — the value can take both.
  const clean = { ...SEED_REC, method_id: "clean-method", operation: { ...GOOD.operation, tools: ["code-span-strip.ts"] } };
  assert.equal(appendMethodRecord(root, clean, { toolCatalog: SEED_CATALOG }).ok, true);
  const cleanBack = readMethodRegistry(root).latest.find((m) => m.method_id === "clean-method");
  assert.equal(cleanBack.legacy_unvalidated, false);
  assert.deepEqual(cleanBack.legacy_reasons, []);
});

test("the seed helpers are pure and total: a record with no provenance yields an empty seed set", () => {
  assert.deepEqual(seedSetForRecord(GOOD, []), { components: [], component_basenames: [], case_ids: [], experiences: [] });
  assert.equal(basenameOf("plugin/scripts/x.ts"), "x.ts");
  assert.equal(basenameOf("x.ts"), "x.ts");
  assert.equal(basenameOf(undefined), "", "a missing name has no basename — it never matches a seed");
  // `seedReasons` is the ONE definition of the two codes — including the "not supplied" own-value.
  assert.deepEqual(seedReasons(GOOD, undefined), [`${PROVENANCE_SEEDS_UNAVAILABLE}:provenance-seeds-not-supplied-so-a-subject-file-cannot-be-told-from-a-tool`]);
  assert.deepEqual(seedReasons(GOOD, NO_SEEDS), []);
});

// ── AC2 (REAL CONTROL): the v2 record exactly as pasted in the landed Phase 2 task evidence ───────
//
// Provenance of every value below (task gap-discovery-method-reflection-unified-trigger-and-candidate-
// generation, section "The full `decision` / `candidate` output for the 4 named cases"):
//   • `method_id` / `version` / `status` / `expected_invariant` / `falsification` are transcribed
//     VERBATIM from that paste;
//   • `operation.tools` is transcribed verbatim EXCEPT for its third entry — the paste reads
//     `["fan-in-ff-protocol-check.ts","fan-in-queueing-model.ts","dual-source-check.ts",
//     "mirror-pair-drift-check.ts"]`, and the third name is not reproduced in the fixture below for a
//     MECHANICAL reason (see the note at the field), which costs the case nothing it judges: the two
//     seed names are exact and the refusal list is asserted to be exactly those two;
//   • the seed Experience is transcribed from the SAME section's re-derived ledger digest, whose
//     signature line is `found-and-fixed|<the two component paths>` → `EXP-fan-in-lock-hold-pairing`,
//     and whose source_ref/verdict are `outcome-31fc82ad5d6c1f86` / `supported`;
//   • `operation.steps`, `applicability` and `cost_budget` were NOT pasted — they are reconstructed
//     here (generic text, naming no seed), because the validator needs a complete record.
// ⛔ Neither carrier survives on disk: `.quay/discovery-*.jsonl` is a gitignored runtime family, which
// is why the paste is the only remaining trace of the real run — and why the record's provenance is
// cited by `case_id` (the form the evidence prints) rather than by its content-addressed ledger `id`.

const PHASE2_SEED = Object.freeze({
  case_id: "EXP-fan-in-lock-hold-pairing",
  role: "found-and-fixed",
  source_ref: "outcome-31fc82ad5d6c1f86",
  components: Object.freeze(["plugin/scripts/fan-in-ff-protocol-check.ts", "plugin/scripts/fan-in-queueing-model.ts"]),
  summary: "the two halves of one lock protocol derive their pairing key by different means, so a held lock was attributed to a key that never participated in it",
});

/** The Phase 2 v2 candidate, transcribed (see the provenance note above). */
const PHASE2_V2 = Object.freeze({
  method_id: "shared-contract-divergence",
  version: 2,
  ts: "2026-10-12T00:00:00Z",
  provenance_evidence: Object.freeze([PHASE2_SEED.case_id]),
  applicability: Object.freeze({
    domain_signals: Object.freeze(["two halves of one protocol derive the same key by independent means"]),
    preconditions: Object.freeze(["the pairing key is computed separately on each side before it is stored"]),
  }),
  operation: Object.freeze({
    steps: Object.freeze(["locate both halves of the pairing", "compare the key derivation on each side"]),
    // ⛔ The pasted list's third entry is `dual-source-check.ts`, and it is deliberately NOT written
    // below: a bare `plugin/scripts` basename as a string literal under `plugin/test/` is collected by
    // registry-bare-filename-scan.ts as a `test-pin` REFERENCE (§12e's four kinds), and that script is
    // still in the committed §12f dead-set snapshot ⇒ the whole-suite static gate goes red
    // (`RED: referenced script(s) still in dead set: dual-source-check.ts`). Naming a script this test
    // never touches would ALSO register a spurious keep-root that shields an unused script from the
    // §12d archive decision. Dropping the entry changes nothing the case judges — the two SEED names
    // are exact, and the refusal list below is asserted to be exactly those two.
    tools: Object.freeze([
      "fan-in-ff-protocol-check.ts", "fan-in-queueing-model.ts", "mirror-pair-drift-check.ts",
    ]),
  }),
  expected_invariant: "For every paired acquire/release event, both halves derive the pairing key from the same source with the same normalization, and both halves agree on the duplicate-event policy; therefore every recorded hold is attributed to a participating key.",
  falsification: "A protocol where the two halves demonstrably derive keys by different means and apply different duplicate policies, yet no hold, slot, or interval is ever attributed to a non-participating key.",
  cost_budget: Object.freeze({ max_candidates: 4, max_model_calls: 8, max_wall_ms: 600000 }),
  status: "draft",
  retirement_reason: null,
  supersedes: null,
});

test("AC2 (real control): the Phase 2 v2 record is refused with TOOL_IS_SUBJECT naming BOTH seed files", () => {
  const root = mkTmp();
  const ledger = appendExperienceRecord(root, {
    case_id: PHASE2_SEED.case_id, ts: "2026-10-12T00:00:00Z", role: PHASE2_SEED.role, reported_by: "system",
    source_ref: PHASE2_SEED.source_ref, evidence: [{ ref: PHASE2_SEED.source_ref, sha256: "b".repeat(64) }],
    components: [...PHASE2_SEED.components], summary: PHASE2_SEED.summary,
  });
  assert.equal(ledger.ok, true, ledger.reasons?.join(","));

  // ⛔ The REAL capability catalog, not a fixture: the point is that every name in this record IS a
  // catalog entry, so the OLD contract accepted the record and only the provenance can refuse it.
  const real = defaultToolNames();
  assert.equal(real.ok, true, real.reason);
  for (const t of PHASE2_V2.operation.tools) assert.ok(real.names.includes(t), `${t} must be a real catalog entry`);

  const seeds = provenanceSeeds(root, PHASE2_V2);
  assert.deepEqual(seeds.component_basenames, ["fan-in-ff-protocol-check.ts", "fan-in-queueing-model.ts"]);
  // v2 in a registry where v1 already exists (the Phase 2 run recorded the v2 as an `extends` of v1).
  const r = validateMethodRecord(PHASE2_V2, {
    toolCatalog: real.names, existing: [{ method_id: "shared-contract-divergence", version: 1 }], provenanceSeeds: seeds,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, [
    `${TOOL_IS_SUBJECT}:fan-in-ff-protocol-check.ts`,
    `${TOOL_IS_SUBJECT}:fan-in-queueing-model.ts`,
  ]);
  // The rule is not "refuse the record": over the record's OWN tool list, being refused ⇔ being one of
  // the provenance's components. Written as a filter over that list rather than by naming the
  // instruments here — same mechanical reason the third entry is absent from `operation.tools` above.
  assert.deepEqual(
    PHASE2_V2.operation.tools.filter((t) => seeds.component_basenames.includes(t)),
    [...seeds.component_basenames],
    "exactly the record's seed entries are subjects — every other tool is a genuine instrument",
  );
  assert.ok(
    PHASE2_V2.operation.tools.length > seeds.component_basenames.length,
    "the record is not all-seed ⇒ the refusal is scoped, not 'refuse the record'",
  );
  // And the append path refuses the pasted record with the same two codes, writing nothing.
  const appended = appendMethodRecord(root, PHASE2_V2, { toolCatalog: real.names });
  assert.equal(appended.ok, false);
  assert.deepEqual(appended.reasons.filter((x) => x.startsWith(TOOL_IS_SUBJECT)), [
    `${TOOL_IS_SUBJECT}:fan-in-ff-protocol-check.ts`,
    `${TOOL_IS_SUBJECT}:fan-in-queueing-model.ts`,
  ]);
  assert.equal(lines(root), 0);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARANTINE + THE PROMOTION-EVIDENCE RULE (task gap-discovery-carriers-ephemeral-in-worktree)
//
// The audit found the only `active` method ever recorded — `shared-contract-divergence` v2,
// `method-afe5ac899aa54241` — had been promoted on INVALID evidence (a lineage leak: the held-out case
// was the v1 seed; and a temporal mismatch: post-fix code graded against a pre-fix label), and that the
// record then existed nowhere. The rule below is what makes a bare `status:"active"` unmintable, and
// `activeMethods` is what makes a RETIRED method actually stop being returned.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const ACTIVE_OK = Object.freeze({
  ...GOOD,
  status: "active",
  generalization_evidence: Object.freeze({ verdict_ref: "generalization_verdict-fixture0000000000" }),
});

test("AC2(f): a promotion to `active` with NO generalization_evidence is refused (its OWN cause code)", () => {
  const root = mkTmp();
  const noEvidence = { ...GOOD, status: "active" };
  const direct = validateMethodRecord(noEvidence, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS });
  assert.equal(direct.ok, false);
  assert.match(direct.reasons.at(-1), new RegExp(`^${PROMOTION_WITHOUT_VALID_GENERALIZATION}:EVIDENCE_MISSING:`));

  const r = appendMethodRecord(root, noEvidence, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS });
  assert.equal(r.ok, false);
  assert.equal(r.appended, false);
  assert.equal(lines(root), 0, "nothing is appended and no carrier is created");

  // POSITIVE CONTROL on the same predicate: the SAME record WITH a ref that resolves to a passing
  // verdict is accepted — so the refusal above is the missing evidence, not `status:"active"`.
  writeVerdict(root, { method_id: GOOD.method_id });
  const ok = appendMethodRecord(root, ACTIVE_OK, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS });
  assert.equal(ok.ok, true, `expected acceptance, got ${ok.reasons?.join(",")}`);
  assert.equal(lines(root), 1);
});

test("AC2(f): every way a cited verdict can be unusable has its OWN cause, and each is refused", () => {
  const root = mkTmp();
  writeVerdict(root, { id: "generalization_verdict-fixture0000000000" });
  const cite = (ref) => ({ ...GOOD, status: "active", generalization_evidence: { verdict_ref: ref } });
  const causeOf = (rec, verdicts) => {
    const r = validateMethodRecord(rec, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS, verdicts });
    const hit = r.reasons.find((x) => x.startsWith(`${PROMOTION_WITHOUT_VALID_GENERALIZATION}:`));
    return hit ? hit.split(":")[1] : null;
  };
  const dv = (v) => [v];

  assert.equal(causeOf(cite("generalization_verdict-nope00000000000"), dv(writeVerdict(root, { id: "x" }))), "VERDICT_NOT_RECORDED");
  assert.equal(causeOf(cite("generalization_verdict-fixture0000000000"), undefined), "VERDICTS_UNAVAILABLE", "absent verdicts ⇒ its OWN value, exactly like toolCatalog/provenanceSeeds");
  assert.equal(causeOf(cite("generalization_verdict-fixture0000000000"), dv(writeVerdict(root, { id: "generalization_verdict-fixture0000000000", method_id: "some-other-method" }))), "VERDICT_OTHER_METHOD");

  // A recorded verdict that FAILED a gate, one cause per shape — and the detail NAMES which.
  const failed = [
    { outcome: "not-evaluated", correct: null, refusal_code: "HELD_OUT_SHARES_LINEAGE", lineage_ok: false, temporal_ok: null },
    { outcome: "not-evaluated", correct: null, refusal_code: "TEMPORAL_MISMATCH", lineage_ok: true, temporal_ok: false },
    { outcome: "evaluated", correct: false, refusal_code: null, lineage_ok: true, temporal_ok: true },
    { outcome: "not-evaluated", correct: null, refusal_code: null, lineage_ok: true, temporal_ok: true, not_evaluated_reason: "UNPARSEABLE_MODEL_OUTPUT" },
  ];
  for (const over of failed) {
    const v = writeVerdict(root, { id: `generalization_verdict-f${failed.indexOf(over)}00000000000`, ...over });
    const got = validateMethodRecord(cite(v.id), { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS, verdicts: dv(v) }).reasons.at(-1);
    assert.match(got, /^PROMOTION_WITHOUT_VALID_GENERALIZATION:VERDICT_NOT_PASSED:/, `got ${got}`);
    assert.ok(got.includes(`refusal_code=${String(over.refusal_code)}`), `the refusal NAMES the code, got ${got}`);
    assert.ok(got.includes(`lineage_ok=${String(over.lineage_ok)}`) && got.includes(`temporal_ok=${String(over.temporal_ok)}`), `…and both gate readings, got ${got}`);
  }

  // The cause vocabulary is declared as DATA, so a new cause cannot be added silently.
  assert.deepEqual([...PROMOTION_REFUSAL_CAUSES], ["EVIDENCE_MISSING", "VERDICTS_UNAVAILABLE", "VERDICT_NOT_RECORDED", "VERDICT_OTHER_METHOD", "VERDICT_NOT_PASSED"]);
  assert.deepEqual(generalizationEvidenceReasons({ ...GOOD, status: "draft" }, undefined), [], "a NON-active record never reads the verdicts");
});

test("AC3: `activeMethods` returns only methods whose LATEST version is active", () => {
  const root = mkTmp();
  assert.deepEqual(activeMethods(root), { ok: true, methods: [], evaluated: 0, malformed_lines: 0, file: registryFile(root) }, "an empty registry, reported as evaluated-0 rather than as a crash");

  writeVerdict(root, { method_id: GOOD.method_id, version: 2 });
  assert.equal(appendMethodRecord(root, ACTIVE_OK, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS }).ok, true);
  assert.equal(appendMethodRecord(root, { ...GOOD, method_id: "still-draft" }, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS }).ok, true);
  const am = activeMethods(root);
  assert.equal(am.ok, true);
  assert.deepEqual(am.methods.map((m) => m.method_id), ["shared-contract-divergence"]);
  assert.equal(am.evaluated, 2, "the count of methods EXAMINED is reported alongside, so 0 methods + 2 examined ≠ 0 methods + 0 examined");

  // A RETIREMENT of the same method_id supersedes the active version ⇒ it leaves the active set.
  const retired = appendMethodRecord(root, {
    ...GOOD, version: 2, status: "retired",
    retirement_reason: "promoted on invalid evidence: the held-out case was the v1 seed and the graded tree was post-fix",
  }, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS });
  assert.equal(retired.ok, true, retired.reasons?.join(","));
  assert.deepEqual(activeMethods(root).methods, [], "the latest version is `retired`, so the method is NOT active");
  assert.equal(readMethodRegistry(root, { history: true }).history.length, 3, "…and the retirement APPENDED: history is intact");
});

test("AC3 (the real quarantine): the recorded `shared-contract-divergence` promotion is retired, and its evidence cannot re-promote it", () => {
  const root = mkTmp();
  const METHOD_ID = "shared-contract-divergence";
  // The evidence the ORIGINAL v2 promotion was based on — recorded here as the verdict it actually was:
  // a refusal on the lineage gate (the held-out case was the v1 seed) and on the temporal gate (the
  // fix had already landed at the pin, so the graded tree was post-fix while the label was pre-fix).
  const bad = writeVerdict(root, {
    id: "generalization_verdict-afe5ac899aa54241", method_id: METHOD_ID, version: 2,
    held_out_case_id: "experience-bb12a6858838e74b",
    called: false, outcome: "not-evaluated", refusal_code: "HELD_OUT_SHARES_LINEAGE",
    predicted_verdict: null, correct: null, lineage_ok: false, temporal_ok: false,
    promoted: false, retirement_reason: null, not_evaluated_reason: "HELD_OUT_SHARES_LINEAGE",
  });
  assert.equal(appendMethodRecord(root, { ...GOOD, method_id: METHOD_ID, version: 1 }, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS }).ok, true);

  // 1. The quarantine record: a RETIREMENT that CITES the invalid promotion.
  const quarantined = appendMethodRecord(root, {
    ...GOOD, method_id: METHOD_ID, version: 2, status: "retired",
    retirement_reason: `promoted on INVALID evidence (verdict ${bad.id}): lineage leak — the held-out case WAS the v1 seed; temporal mismatch — post-fix code graded against a pre-fix label. Retired; must not be re-promoted on this evidence.`,
  }, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS });
  assert.equal(quarantined.ok, true, quarantined.reasons?.join(","));
  assert.equal(quarantined.appended, true);
  const onDisk = readMethodRegistry(root, { history: true }).history.at(-1);
  assert.equal(onDisk.status, "retired");
  assert.match(onDisk.retirement_reason, /lineage leak/);
  assert.equal(activeMethods(root).methods.length, 0, "activeMethods() shows it ABSENT");

  // 2. The attempted RE-PROMOTION citing that same evidence is REFUSED — naming the gate that failed.
  const replay = appendMethodRecord(root, {
    ...GOOD, method_id: METHOD_ID, version: 3, status: "active",
    generalization_evidence: { verdict_ref: bad.id },
  }, { toolCatalog: CATALOG, provenanceSeeds: NO_SEEDS });
  assert.equal(replay.ok, false);
  assert.equal(replay.appended, false);
  const why = replay.reasons.find((x) => x.startsWith(`${PROMOTION_WITHOUT_VALID_GENERALIZATION}:`));
  assert.match(why, /^PROMOTION_WITHOUT_VALID_GENERALIZATION:VERDICT_NOT_PASSED:/);
  assert.ok(why.includes("refusal_code=HELD_OUT_SHARES_LINEAGE") && why.includes("lineage_ok=false") && why.includes("temporal_ok=false"), why);
  assert.equal(lines(root), 2, "the refused re-promotion appended NOTHING (the retirement is still the latest)");
  assert.deepEqual(activeMethods(root).methods, []);
});
