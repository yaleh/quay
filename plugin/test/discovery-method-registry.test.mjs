// @test-group engine
// Tests for the DISCOVERY METHOD REGISTRY (task gap-discovery-method-registry-and-versioned-contract,
// AC1 a–h). The contract under test: a record that cannot be a valid, *next* version of a method is
// REFUSED with a distinct reason and NOTHING is written — "I could not write a valid record" must
// never be shaped like "I wrote one", and "I could not read the tool catalog" must never be shaped
// like "every tool is fine" (硬规则 3b).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  METHOD_REGISTRY_REL, METHOD_KIND, METHOD_STATUSES, REQUIRED_METHOD_FIELDS, MIN_APPLICABILITY_CHARS,
  DEDUP_THRESHOLD, EVIDENCE_STORE_PRIMITIVES, CATALOG_DECLARATIONS_REL,
  registryFile, loadToolCatalog, defaultToolNames, validateMethodRecord,
  readMethodRegistry, appendMethodRecord, dedupMethods, methodRecordId,
} from "../../docs/analysis/discovery-method-registry.mjs";

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-method-registry-")); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const lines = (root) => { const f = registryFile(root); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0; };

/** A FIXTURE capability-catalog listing — the tests never depend on the real repo's 373 entries. */
const CATALOG = Object.freeze(["import-graph-check.ts", "code-span-strip.ts", "archguard-runner.ts", "readRecords"]);

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

// ── AC1(a): a well-formed draft method is accepted and appended ─────────────────────────────────

test("AC1(a): a well-formed draft method is accepted, appended, and reads back", () => {
  const root = mkTmp();
  const r = appendMethodRecord(root, GOOD, { toolCatalog: CATALOG });
  assert.equal(r.ok, true, `expected acceptance, got ${r.reasons?.join(",")}`);
  assert.match(r.id, /^method-[0-9a-f]{16}$/, "content-addressed id, same scheme as the evidence store");
  assert.equal(r.appended, undefined, "an ACCEPTED write does not carry the refusal marker");
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
  assert.equal(validateMethodRecord(rec, { toolCatalog: [...CATALOG, "no-such-tool.ts"] }).ok, true);
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
  assert.deepEqual(validateMethodRecord({ ...GOOD, applicability: { applies: true } }, { toolCatalog: CATALOG }).reasons,
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
    assert.deepEqual(validateMethodRecord(rec, { toolCatalog: CATALOG }).reasons, [`SCHEMA_MISSING:${f}`], f);
  }
  assert.equal(validateMethodRecord({ ...GOOD, status: "gone" }, { toolCatalog: CATALOG }).reasons.join(), "STATUS_NOT_IN_VOCAB:gone");
  // version must be a positive integer AND the next one: `0` is a type/range fault, `3` is a skip.
  assert.deepEqual(validateMethodRecord({ ...GOOD, version: 0 }, { toolCatalog: CATALOG }).reasons, ["FIELD_INVALID:version"]);
  assert.equal(validateMethodRecord({ ...GOOD, version: 3 }, { toolCatalog: CATALOG }).reasons.join(), "VERSION_NOT_MONOTONIC:shared-contract-divergence-expects-1-got-3");
  assert.deepEqual([...METHOD_STATUSES], ["draft", "active", "retired"]);
  // cost_budget is three integers, never a prose budget.
  for (const bad of [{ max_candidates: 4, max_model_calls: 0 }, { max_candidates: -1, max_model_calls: 0, max_wall_ms: 1 }, "cheap"]) {
    assert.match(validateMethodRecord({ ...GOOD, cost_budget: bad }, { toolCatalog: CATALOG }).reasons.join(), /COST_BUDGET_INVALID/);
  }
  assert.equal(lines(root), 0);
});

test("records are content-addressed: identical content ⇒ one id, a changed field ⇒ a different id", () => {
  assert.equal(methodRecordId(GOOD), methodRecordId({ ...GOOD }));
  assert.notEqual(methodRecordId(GOOD), methodRecordId({ ...GOOD, version: 2 }));
});
