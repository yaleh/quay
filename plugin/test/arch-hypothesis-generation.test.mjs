// @test-group engine
// Fixture tests for the blind hypothesis-generation shadow stage
// (docs/analysis/arch-hypothesis-generation.mjs). Pure functions + injectable seams only — no git, no
// model, no network; the ONE on-disk read is the frozen-prompt pin, which is an artifact-level assertion
// the pre-registration contract needs and cannot be reduced to a fixture. Each AC case is its own `test`.
//
// The model seam is INJECTED everywhere (`runModel`); the fs seam is injected where the read ORDER is
// part of the contract. Nothing here calls a real launcher.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EXIT, CARRIER_FORMS, HARD_MAX_CLUSTERS, VERIFIER_VERDICTS, INVENTORY_FORMS,
  extractExports, extractCarriers, parseCatalog, buildInventory, renderEntry,
  importClauseNames, importedNames, buildProvenance, renderProvenanceEntry,
  contaminationScan, contaminationText, CONTAMINATION_EXCLUDED_FIELDS,
  preregRefusal, runPromptDigest, runPromptRefusal,
  resolveExperimentId, repoRelComponent, repoRelSubjectKey,
  expectedFromArtifacts, armScopedKey, ARM_ID_RE,
  STRIPPED_DIRS, FROZEN_INVESTIGATOR_PROMPT, defaultInvestigatorPrompt, sha256,
  SCOPE_FORBIDDEN_DIRS, PIN_FORBIDDEN_DIRS,
  FROZEN_VERIFIER_PROMPT, FROZEN_VERIFIER_PROMPT_SHA256, defaultVerifierPrompt,
  EVIDENCE_PACK_VERIFIER_PROMPT, evidencePackVerifierPrompt, VERIFIER_STRATEGIES,
  DEFAULT_EVIDENCE_MAX_LINES, UNINSTRUMENTED, citedSymbols, isDefinitionLine,
  MODEL_UNVERIFIED, modelCallFields, callText, modelPreregRefusal, applyModel,
  definitionLinesFor, importLinesFor, buildEvidencePack, parseVerifierStream,
  neutralCwdRefusal, verifyCwdRefusal, parseJsonObject, parseHypotheses, runInvestigator,
  clusterHypotheses, verifierVerdict, runVerifier,
  sharedImplementation, mechanicalEvidenceLines, mechanicalSummaryField, provenanceIndex,
  mechanicalMatch, matchVerdict, scoreCases,
  score, matchRecords, verifyRecords, reviewRecords, emit,
  buildReport, hardenedArgv, importDriverRuntime, modelFromArgv,
  FINGERPRINT_ARMS, FINGERPRINT_CONCEPT_KIND, DEFAULT_MIN_STATEMENTS, DEFAULT_MIN_TOKENS, fingerprintKey,
  resolveArchguardRoot, loadArchguardInstrument, resolveArchguardTypescript, callshapeTokens,
  fingerprintGroups, fingerprintInputs, fingerprintDigest, fingerprintClaim, fingerprintRecords,
  fingerprintRunRecord, runKind, fingerprintArmAt, fingerprintPreregRefusal, loadRunsGated, cli,
} from "../../docs/analysis/arch-hypothesis-generation.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hypgen-test-"));
const write = (p, o) => { fs.writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o)); return p; };

// ── AC1(a): a non-empty cwd makes the investigator refuse ────────────────────────────────────────────
test("AC1(a): investigator refuses when cwd is not the empty neutral dir — and never calls the model", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  let called = 0;
  const res = await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: os.tmpdir(), runs: 3,
    runModel: async () => { called++; return { stdout: "[]", status: 0 }; },
    outDir: dir, writeFile: () => { throw new Error("must not write"); }, budget: { maxRuns: 3 },
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, EXIT.cwdNotNeutral);
  assert.equal(called, 0, "no model call may happen before the isolation check");
  assert.ok(neutralCwdRefusal("/somewhere/else", neutral));
  assert.equal(neutralCwdRefusal(neutral, neutral), null);
  // same three-valued shape for the verifier's stripped-pin guard
  assert.ok(verifyCwdRefusal(dir, neutral));
});

// ── AC1(b): a missing or mismatched pre-registration hash makes scoring refuse ───────────────────────
test("AC1(b): scoring refuses on a missing pre-registration file and on a mismatched hash", () => {
  const missing = preregRefusal({ prereg: null, expected: { inventory: "a".repeat(64) } });
  assert.equal(missing.code, EXIT.prereg);
  assert.deepEqual(missing.reasons, ["PREREG_MISSING"]);

  const mismatch = preregRefusal({
    prereg: { hashes: { inventory: "b".repeat(64) } }, expected: { inventory: "a".repeat(64) },
    preregMtimeMs: 1, runMtimesMs: [2],
  });
  assert.equal(mismatch.code, EXIT.prereg);
  assert.ok(mismatch.reasons.includes("PREREG_HASH_MISMATCH:inventory"));

  const absent = preregRefusal({ prereg: { hashes: {} }, expected: { inventory: "a".repeat(64) }, preregMtimeMs: 1, runMtimesMs: [2] });
  assert.ok(absent.reasons.includes("PREREG_HASH_ABSENT:inventory"));

  // a matching hash but a pre-registration NEWER than a run is still refused
  const late = preregRefusal({ prereg: { hashes: { inventory: "a".repeat(64) } }, expected: { inventory: "a".repeat(64) }, preregMtimeMs: 5, runMtimesMs: [4] });
  assert.ok(late.reasons.includes("PREREG_NOT_OLDER_THAN_RUNS"));

  assert.equal(preregRefusal({ prereg: { hashes: { inventory: "a".repeat(64) } }, expected: { inventory: "a".repeat(64) }, preregMtimeMs: 1, runMtimesMs: [2, 3] }), null);
});

// ── AC1(c): the contamination scan refuses when an entry names both sides of a sealed pair ───────────
test("AC1(c): contamination scan refuses an entry naming BOTH sides of a sealed pair", () => {
  const pairs = [{ id: "PAIR1", groups: [["alpha.ts", "beta.ts"], ["gamma.ts"]] }];
  // an entry that is a member of group 0 AND mentions group 1 ⇒ contaminated
  const dirty = [{ c: "alpha.ts", q: "runs alongside gamma.ts", exports: [], carriers: [] }];
  const d = contaminationScan(dirty, pairs);
  assert.equal(d.ok, false);
  assert.deepEqual(d.cross, [{ entry: "alpha.ts", pair: "PAIR1", groups: [0, 1] }]);

  // a THIRD entry mentioning a member of each group ⇒ contaminated; a lone member is not
  const third = contaminationScan([{ c: "delta.ts", q: "alpha.ts and gamma.ts", exports: [], carriers: [] }], pairs);
  assert.equal(third.ok, false);
  const clean = contaminationScan([{ c: "alpha.ts", q: "nothing else here", exports: [], carriers: [] }], pairs);
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.cross, []);
});

// ── AC1(d): unparseable investigator output is a FAILED RUN, not zero hypotheses ─────────────────────
test("AC1(d): an unparseable investigator output is recorded as a failed run (n_hyps null), never as 0", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  const written = [];
  const res = await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 1, model: "test-model",
    runModel: async () => ({ stdout: "I could not answer.\nno array here", status: 0 }),
    outDir: dir, writeFile: (f, t) => written.push({ f, t }), budget: { maxRuns: 3 },
  });
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1, "the failed run is still a recorded run");
  assert.equal(res.records[0].n_hyps, null, "must NOT read as zero hypotheses");
  assert.equal(res.records[0].hyps, null);
  assert.ok(res.records[0].parse_error, "the parse failure is named");
  assert.equal(written.length, 1, "the run file is written so 'all runs exist' can be checked later");
  assert.equal(parseHypotheses("[]").hyps.length, 0, "a genuine empty array IS zero hypotheses");
  assert.equal(parseHypotheses("[]").parse_error, null);
});

// ── AC1(e): a verifier that hits its turn limit maps to undetermined, never refuted ──────────────────
test("AC1(e): turn-limit and unparseable verifier outputs map to undetermined, never refuted", async () => {
  assert.equal(verifierVerdict({ stdout: "Error: Reached max turns (8)", status: 1 }).verdict, "undetermined");
  assert.equal(verifierVerdict({ stdout: "Error: Reached max turns (8)", status: 1 }).reason, "TURN_LIMIT");
  assert.equal(verifierVerdict({ stdout: "some prose, no json", status: 0 }).verdict, "undetermined");
  assert.notEqual(verifierVerdict({ stdout: "some prose, no json", status: 0 }).verdict, "refuted");
  assert.equal(verifierVerdict({ stdout: JSON.stringify({ verdict: "refuted" }), status: 0 }).verdict, "refuted");
  assert.equal(verifierVerdict({ stdout: JSON.stringify({ verdict: "nonsense" }), status: 0 }).verdict, "undetermined");

  // through the whole verifier: a turn-limit call is `undetermined` in the emitted evidence row
  const dir = tmp();
  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts"], concept_kind: "policy", claim: "c", confidence: "high" }] }]);
  const res = await runVerifier({
    clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}",
    runModel: async () => ({ stdout: "Error: Reached max turns (8)", stderr: "", status: 1 }), maxClusters: HARD_MAX_CLUSTERS,
  });
  assert.equal(res.results[0].verdict, "undetermined");
  assert.equal(res.results[0].verdict_reason, "TURN_LIMIT");
  // and the emitted store record carries that same verdict (never a refuted row)
  const recs = verifyRecords({ verify: res });
  assert.equal(recs[0].rec.verdict, "undetermined");
});

// ── AC1(f): a labels file is never read before all runs exist; assert on the file-read ORDER ─────────
function recordingFs() {
  const order = [];
  return {
    order,
    fs: {
      readFileSync: (p, e) => { order.push(p); return fs.readFileSync(p, e); },
      existsSync: (p) => fs.existsSync(p),
      statSync: (p) => { order.push(`${p}#stat`); return fs.statSync(p); },
      writeFileSync: (p, t, e) => fs.writeFileSync(p, t, e),
    },
  };
}

test("AC1(f): labels are read only AFTER every declared run file exists (assert on read order)", () => {
  const dir = tmp();
  const PROMPT = "PROMPT-BYTES", INVENTORY = "INVENTORY-BYTES";
  const digest = runPromptDigest(PROMPT, INVENTORY);
  const run1 = write(path.join(dir, "run-1.json"), { run: 1, hyps: [], prompt_sha256: digest });
  const run2 = write(path.join(dir, "run-2.json"), { run: 2, hyps: [], prompt_sha256: digest });
  const labelsText = JSON.stringify({ cases: [] });
  const labels = write(path.join(dir, "labels.json"), labelsText);
  const prereg = write(path.join(dir, "prereg.json"), { hashes: { inventory: "a".repeat(64), labels: sha256(labelsText) } });
  // the pre-registration must predate the runs
  fs.utimesSync(prereg, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

  const rec = recordingFs();
  const res = score({ runDir: dir, runCount: 2, labelsPath: labels, preregPath: prereg, expected: { inventory: "a".repeat(64) }, promptBytes: PROMPT, inventoryBytes: INVENTORY, fs: rec.fs });
  assert.equal(res.ok, true);
  const li = rec.order.indexOf(labels);
  assert.ok(li >= 0, "labels were read");
  for (const f of [run1, run2]) assert.ok(rec.order.indexOf(f) < li && rec.order.indexOf(`${f}#stat`) < li, `run file ${path.basename(f)} must be touched before labels`);

  // NEGATIVE CONTROL: a missing run file refuses AND the labels file is never opened at all
  fs.rmSync(run2);
  const rec2 = recordingFs();
  const res2 = score({ runDir: dir, runCount: 2, labelsPath: labels, preregPath: prereg, expected: { inventory: "a".repeat(64) }, promptBytes: PROMPT, inventoryBytes: INVENTORY, fs: rec2.fs });
  assert.equal(res2.ok, false);
  assert.equal(res2.code, EXIT.runsIncomplete);
  assert.equal(rec2.order.includes(labels), false, "labels must not be read when a run is missing");

  // and a failed pre-registration gate likewise reads no labels (runs restored first, so the gate — not
  // the run-completeness check — is what refuses)
  write(run2, { run: 2, hyps: [], prompt_sha256: digest });
  const rec3 = recordingFs();
  const res3 = score({ runDir: dir, runCount: 2, labelsPath: labels, preregPath: prereg, expected: { inventory: "b".repeat(64) }, promptBytes: PROMPT, inventoryBytes: INVENTORY, fs: rec3.fs });
  assert.equal(res3.code, EXIT.prereg);
  assert.equal(rec3.order.includes(labels), false);
});

// ── AC1/Plan 5: every bound is fail-closed with its OWN exit code ────────────────────────────────────
test("bounds: max-runs, max-clusters and max-ms each refuse with a distinct exit code", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  let called = 0;
  const overRuns = await runInvestigator({
    prompt: "P", neutralDir: neutral, cwd: neutral, runs: 5, model: "test-model", runModel: async () => { called++; return { stdout: "[]" }; },
    outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  });
  assert.equal(overRuns.ok, false);
  assert.equal(overRuns.code, EXIT.maxRuns);
  assert.equal(called, 0, "the bound is checked before the first call");

  const zeroMs = await runInvestigator({
    prompt: "P", neutralDir: neutral, cwd: neutral, runs: 2, model: "test-model", runModel: async () => { called++; return { stdout: "[]" }; },
    outDir: dir, writeFile: () => {}, budget: { maxMs: 0 },
  });
  assert.equal(zeroMs.code, EXIT.maxMs);
  assert.equal(called, 0);

  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts"], concept_kind: "policy", claim: "c", confidence: "high" }] }]);
  const overCap = await runVerifier({ clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}", runModel: async () => ({ stdout: "{}" }), maxClusters: HARD_MAX_CLUSTERS + 1 });
  assert.equal(overCap.ok, false);
  assert.equal(overCap.code, EXIT.maxClusters);
  const noCall = await runVerifier({ clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}", runModel: async () => { called++; return { stdout: "{}" }; }, maxMs: 0 });
  assert.equal(noCall.code, EXIT.maxMs);
  assert.equal(new Set([EXIT.maxRuns, EXIT.maxClusters, EXIT.maxMs]).size, 3, "the three bounds never share a code");
});

// ── inventory: neutral, deterministic, and blind to imports/call edges ───────────────────────────────
test("inventory: exports/carriers are deduped, capped and identical for every component", () => {
  const src = [
    "export const a = 1;",
    "export async function b() {}",
    "export type T = 1;",
    "export const a = 2;",                       // duplicate name collapses
    'import x from "./b.ts";',                   // ⛔ no import edges are inventoried
    'const p = ".quay/one.jsonl"; const q = ".quay/one.jsonl";',
    'const r = path.join(".quay", "two.json");',
  ].join("\n");
  assert.deepEqual(extractExports(src, 15), ["a", "b", "T"]);
  assert.deepEqual(extractCarriers(src, { forms: "literal", maxCarriers: 6 }), [".quay/one.jsonl"]);
  assert.deepEqual(extractCarriers(src, { forms: "literal+join", maxCarriers: 6 }), [".quay/one.jsonl", ".quay/two.json"]);
  assert.deepEqual(extractCarriers(src, { forms: "literal+join", maxCarriers: 1 }), [".quay/one.jsonl"]);
  assert.equal(CARRIER_FORMS.includes("literal+join"), true);

  const catalog = "header line\n  a.ts    answers a thing\n                      continued here\n  b.ts    answers b\n";
  assert.deepEqual(parseCatalog(catalog), { "a.ts": "answers a thing continued here", "b.ts": "answers b" });
  assert.equal(renderEntry({ c: "a.ts", q: "Q", exports: [], carriers: [] }), "- a.ts | Q: Q | exports: - | carriers: -");

  const mk = (args) => buildInventory({ files: ["b.ts", "a.ts"], readSource: (f) => (f === "a.ts" ? src : ""), catalog, ...args });
  const one = mk({ maxExports: 15, maxCarriers: 6, carrierForms: "literal" });
  const two = mk({ maxExports: 15, maxCarriers: 6, carrierForms: "literal" });
  assert.equal(one.text, two.text, "identical inputs ⇒ byte-identical inventory");
  assert.equal(one.sha256, two.sha256);
  assert.equal(one.entries[0].c, "a.ts", "entries are alphabetical regardless of the ls order");
  assert.equal(one.entries[1].q, "answers b");
  const uncatalogued = buildInventory({ files: ["z.ts"], readSource: () => "", catalog, maxExports: 15 });
  assert.equal(uncatalogued.entries[0].q, "(no catalog entry)", "a component with no catalog line is marked, never dropped");
  assert.ok(one.text.endsWith("\n"), "the hashed bytes include the trailing newline");
});

// ── scoring: mechanical match + per-case reading ─────────────────────────────────────────────────────
test("match: a hypothesis hit needs one component on each side AND an admissible concept kind", () => {
  const labels = { cases: [
    { id: "POS", role: "positive", a: ["a.ts"], b: ["b.ts"], kinds: ["invariant"] },
    { id: "NEG", role: "negative", a: ["c.ts"], b: ["d.ts"], kinds: ["identity"] },
    { id: "HOLD", role: "holdout-regression", a: ["e.ts"], b: ["f.ts"], kinds: ["policy", "ownership"] },
  ] };
  const runs = [{ run: 1, hyps: [
    { id: "H1", components: ["a.ts", "b.ts"], concept_kind: "invariant", claim: "x", confidence: "high" },
    { id: "H2", components: ["c.ts", "d.ts"], concept_kind: "identity", claim: "y", counterexample_requirement: "the divergence is deliberate and documented", confidence: "low" },
    { id: "H3", components: ["e.ts", "f.ts"], concept_kind: "policy", claim: "z", confidence: "medium" },
    { id: "H4", components: ["a.ts", "b.ts"], concept_kind: "policy", claim: "wrong kind", confidence: "low" },
  ] }];
  const m = mechanicalMatch({ runs, labels });
  assert.deepEqual(m.map((x) => `${x.case}:${x.hid}`), ["POS:H1", "NEG:H2", "HOLD:H3"]);
  assert.equal(matchVerdict(m[1], "negative"), "supported", "a negative is only satisfied by carrying the counterexample");
  assert.equal(matchVerdict({ ...m[1], counter: "" }, "negative"), "refuted");
  const s = scoreCases({ labels, matches: m });
  assert.deepEqual(s.recall_positive, { hit: 1, total: 1 });
  assert.deepEqual(s.holdout, [{ id: "HOLD", hits: 1 }]);
  assert.deepEqual(s.negative_false_positive, { hit: 0, total: 1 });
});

// ── clustering: deterministic de-duplication across runs ─────────────────────────────────────────────
test("clustering: same kind + overlapping components merge; order is confidence then run", () => {
  const runs = [
    { run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts"], concept_kind: "ownership", claim: "c1", confidence: "medium" }] },
    { run: 2, hyps: [{ id: "H1", components: ["b.ts", "a.ts"], concept_kind: "ownership", claim: "c2", confidence: "high" }] },
    { run: 3, hyps: [{ id: "H1", components: ["a.ts", "b.ts"], concept_kind: "invariant", claim: "c3", confidence: "high" }] },
  ];
  const cs = clusterHypotheses(runs);
  assert.equal(cs.length, 2, "different concept_kind does not merge (the confidence/run order puts run 2 first)");
  assert.deepEqual(cs[0].members, ["r2:H1", "r1:H1"]);
  assert.deepEqual(cs[1].members, ["r3:H1"]);
});

// ── records: every emitted record passes the PRODUCTION validator ─────────────────────────────────────
test("records: match/verify/review records validate against the production evidence store", () => {
  const dir = tmp();
  const labels = { cases: [{ id: "NEG", role: "negative", a: ["c.ts"], b: ["d.ts"], kinds: ["identity"] }] };
  const matches = [{ case: "NEG", run: 1, hid: "H2", kind: "identity", comps: ["c.ts", "d.ts"], claim: "dup key", counter: "deliberate and documented", confidence: "low" }];
  const r1 = matchRecords({ matches, labels, runDir: dir });
  const verify = { results: [{ cluster: 1, kind: "policy", comps: ["a.ts", "b.ts"], claim: "c", verdict: "undetermined", verdict_reason: "TURN_LIMIT", intentional: null, wall_ms: 10, members: ["r1:H1"] }] };
  const r2 = verifyRecords({ verify });
  const r3 = reviewRecords({ reviews: [{ case: "NEG", run: 1, hid: "H2", comps: ["c.ts"], wall_ms: 5, review: { same_concept: false, partial: true } }] });
  const all = [...r1, ...r2, ...r3];
  assert.ok(all.length >= 3);
  const out = path.join(dir, "records.jsonl");
  const tally = emit(all, { out });
  assert.equal(tally.refused, 0, `every record must validate: ${JSON.stringify(tally.reasons)}`);
  assert.equal(tally.accepted, all.length);
  const lines = fs.readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, all.length);
  assert.ok(lines.every((r) => r.experiment === "E-HYPGEN-1"), "records carry the store experiment id");
  assert.equal(lines.find((r) => r.kind === "outcome" && r.case_id === "NEG").verdict, "supported");

  // the production store is written ONLY when asked, and only through the store's own appendRecord
  const storeRoot = tmp();
  assert.equal(fs.existsSync(path.join(storeRoot, ".quay", "architecture-evidence-store.jsonl")), false);
  const withStore = emit(all, { out: null, writeStore: true, root: storeRoot });
  assert.equal(withStore.stored, all.length);
  assert.deepEqual(withStore.storeRefused, []);
  assert.equal(fs.readFileSync(path.join(storeRoot, ".quay", "architecture-evidence-store.jsonl"), "utf8").trim().split("\n").length, all.length);
});

// ── launcher argv hardening + the module's blindness to holdout text ─────────────────────────────────
test("hardening: the launcher argv pins tools off, no session, strict MCP (and --max-turns when bounded)", () => {
  const fake = (role, prompt, root, opts) => ["claude", "-n", role, "-p"];
  const argv = hardenedArgv(fake, "PROMPT", "/repo", { maxTurns: 8 });
  assert.ok(argv.includes("--tools") && argv[argv.indexOf("--tools") + 1] === "");
  assert.ok(argv.includes("--disable-slash-commands") && argv.includes("--no-session-persistence") && argv.includes("--strict-mcp-config"));
  assert.ok(argv.includes("--max-turns") && argv[argv.indexOf("--max-turns") + 1] === "8");
  assert.equal(argv[argv.length - 1], "-p", "the trailing -p (prompt via stdin) stays last");
  const unbounded = hardenedArgv(fake, "P", "/repo");
  assert.equal(unbounded.includes("--max-turns"), false);
});

// ── report: pure aggregation, no model call ─────────────────────────────────────────────────────────
test("report: aggregates recorded artifacts into markdown with both arms labelled", () => {
  const md = buildReport({
    armA: {
      runs: [{ hyps: [{}], n_hyps: 1, wall_ms: 60_000 }],
      verify: { clusters_total: 2, verified: 2, beyond_cap: 0, results: [
        { verdict: "supported", intentional: true, wall_ms: 1000, counterexample: "x", evidence: [{ file: "f.ts", line: 1 }], claim: "c", cluster: 1, kind: "policy", comps: ["a.ts"] },
        { verdict: "refuted", intentional: false, wall_ms: 1000 },
      ] },
      matches: [{ case: "POS", run: 1, hid: "H1", kind: "invariant", comps: ["a.ts", "b.ts"], claim: "c", counter: "yes deliberate" }],
      score: { recall_positive: { hit: 1, total: 1 }, holdout: [], negative_false_positive: { hit: 0, total: 1 } },
      reviews: [{ case: "POS", review: { same_concept: true, partial: false } }],
    },
    armB: null,
  });
  assert.match(md, /## Arm A \(pre-registered\)/);
  assert.match(md, /precision: 1\/2 = 0\.50/);
  assert.match(md, /recall \(positives\): 1\/1/);
  assert.match(md, /Pre-registration/);
  assert.equal(VERIFIER_VERDICTS.includes("undetermined"), true);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides — AC2(a)…(f)
// The gate must be read FROM THE PREREG, never from what the caller asserts on the command line.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** A scoreable fixture: a prereg that predates every run, whose declared hashes ARE the artifact bytes. */
function preregFixture({ dir, runs, prompt = "PROMPT-BYTES", inventory = "INVENTORY-BYTES", labelsText = JSON.stringify({ cases: [] }), mutate = null }) {
  const labels = write(path.join(dir, "labels.json"), labelsText);
  runs.forEach((r, i) => write(path.join(dir, `run-${i + 1}.json`), r));
  const hashes = { "prompt-investigator": sha256(prompt), inventory: sha256(inventory), labels: sha256(labelsText) };
  const prereg = write(path.join(dir, "prereg.json"), mutate ? mutate({ hashes: { ...hashes } }) : { hashes });
  fs.utimesSync(prereg, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  return { labels, prereg, prompt, inventory, expected: { "prompt-investigator": sha256(prompt), inventory: sha256(inventory) } };
}
const scoreFixture = (dir, f, runCount) =>
  score({ runDir: dir, runCount, labelsPath: f.labels, preregPath: f.prereg, expected: f.expected, promptBytes: f.prompt, inventoryBytes: f.inventory });
const run = (prompt, inventory) => ({ run: 1, hyps: [], prompt_sha256: runPromptDigest(prompt, inventory) });

// ── AC2(a): the RUN's recorded prompt digest is checked against the prereg'd artifacts ───────────────
test("AC2(a): a run recorded with a different prompt digest refuses — with NO CLI hash flag given", () => {
  const dir = tmp();
  const P = "PROMPT-BYTES", I = "INVENTORY-BYTES";
  // the run recorded the digest of a DIFFERENT prompt: no `--prompt-sha` is passed anywhere, so only the
  // prereg + the supplied artifact bytes can catch this.
  const bad = preregFixture({ dir, runs: [{ run: 1, hyps: [], prompt_sha256: runPromptDigest("A DIFFERENT PROMPT", I) }] });
  const refused = scoreFixture(dir, bad, 1);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, EXIT.prereg);
  assert.ok(refused.reasons.some((r) => r.includes("PREREG_HASH_MISMATCH:run-prompt")), refused.reasons.join(","));

  // CONTROL: the same fixture with the digest re-derived from the prereg'd artifacts scores. Without this
  // the refusal above could be caused by the fixture rather than by the digest (硬规则 4 推论四).
  const dir2 = tmp();
  const good = preregFixture({ dir: dir2, runs: [run(P, I)] });
  const scored = scoreFixture(dir2, good, 1);
  assert.equal(scored.ok, true, scored.reasons?.join(","));

  // and a run that recorded no digest at all is its OWN cause, never a pass
  const dir3 = tmp();
  const absent = preregFixture({ dir: dir3, runs: [{ run: 1, hyps: [] }] });
  const r3 = scoreFixture(dir3, absent, 1);
  assert.equal(r3.code, EXIT.prereg);
  assert.deepEqual(r3.reasons, ["RUN_PROMPT_HASH_ABSENT:1"]);

  // byte-less: with no prompt/inventory bytes to compare against, the gate refuses rather than passing
  assert.deepEqual(runPromptRefusal({ runs: [run(P, I)] }), { code: EXIT.prereg, reasons: ["RUN_PROMPT_UNVERIFIABLE:prompt-or-inventory-bytes-not-supplied"] });
});

// ── AC2(b): a labels file changed after the pre-registration ─────────────────────────────────────────
test("AC2(b): a labels file changed AFTER the prereg makes scoring refuse", () => {
  const dir = tmp();
  const P = "PROMPT-BYTES", I = "INVENTORY-BYTES";
  const f = preregFixture({ dir, runs: [run(P, I)], labelsText: JSON.stringify({ cases: [{ id: "POS", role: "positive" }] }) });
  assert.equal(scoreFixture(dir, f, 1).ok, true, "the unchanged labels score");
  // the labels are edited AFTER the pre-registration — the exact escape the acceptance run found
  write(f.labels, JSON.stringify({ cases: [{ id: "POS", role: "positive" }, { id: "EXTRA", role: "positive" }] }));
  const refused = scoreFixture(dir, f, 1);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, EXIT.prereg);
  assert.deepEqual(refused.reasons, ["PREREG_HASH_MISMATCH:labels"]);
  // a prereg that never declared a labels hash is not a licence to skip the check
  const dir2 = tmp();
  const undeclared = preregFixture({ dir: dir2, runs: [run(P, I)], mutate: ({ hashes }) => { delete hashes.labels; return { hashes }; } });
  assert.deepEqual(scoreFixture(dir2, undeclared, 1).reasons, ["PREREG_HASH_ABSENT:labels"]);
});

// ── AC2(c): an import failure reports the underlying error code ──────────────────────────────────────
test("AC2(c): a failed driver-runtime import surfaces the underlying error code, not 'unavailable'", async () => {
  const missing = new Error("Cannot find package 'yaml' imported from /wt/plugin/scripts/driver-runtime.ts");
  missing.code = "ERR_MODULE_NOT_FOUND";
  const failed = await importDriverRuntime(async () => { throw missing; });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /DRIVER_RUNTIME_IMPORT_FAILED/);
  assert.match(failed.reason, /ERR_MODULE_NOT_FOUND/);
  assert.match(failed.reason, /yaml/);
  // a codeless throw still says so, rather than reporting a policy-shaped refusal
  assert.match((await importDriverRuntime(async () => { throw new Error("boom"); })).reason, /NO_CODE:boom/);
  // an importable module that lacks the export is a DIFFERENT cause from an unimportable one
  assert.equal((await importDriverRuntime(async () => ({}))).reason, "DRIVER_RUNTIME_MISSING_EXPORT:launchArgv");
  assert.equal((await importDriverRuntime(async () => ({ launchArgv: () => [] }))).reason, "DRIVER_RUNTIME_MISSING_EXPORT:runAsync");
  assert.equal((await importDriverRuntime(async () => ({ launchArgv: () => [], runAsync: async () => ({}) }))).ok, true);
});

// ── AC2(d): the verifier refuses a pin-dir that still carries the methodology layer ──────────────────
test("AC2(d): verify refuses when --pin-dir contains tasks/ (and every other stripped dir)", async () => {
  const dir = tmp();
  assert.equal(verifyCwdRefusal(dir, dir), null, "a tree with none of the four is accepted");
  fs.mkdirSync(path.join(dir, "tasks"));
  assert.equal(verifyCwdRefusal(dir, dir), "PIN_NOT_STRIPPED:tasks");
  fs.mkdirSync(path.join(dir, "docs"));
  assert.equal(verifyCwdRefusal(dir, dir), "PIN_NOT_STRIPPED:tasks,docs", "every present dir is named (硬规则 3)");
  fs.rmSync(path.join(dir, "tasks"), { recursive: true }); fs.rmSync(path.join(dir, "docs"), { recursive: true });
  assert.equal(verifyCwdRefusal(dir, dir), null);
  assert.deepEqual([...STRIPPED_DIRS], ["tasks", "goals", "docs", "orchestration"]);
  // and the refusal happens THROUGH runVerifier, before any model call
  fs.mkdirSync(path.join(dir, "tasks"));
  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts"], concept_kind: "policy", claim: "c", confidence: "high" }] }]);
  let called = 0;
  const res = await runVerifier({ clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}", runModel: async () => { called++; return { stdout: "{}" }; } });
  assert.equal(res.ok, false);
  assert.equal(res.code, EXIT.cwdNotNeutral);
  assert.deepEqual(res.reasons, ["PIN_NOT_STRIPPED:tasks"]);
  assert.equal(called, 0, "no model call may happen before the stripped-tree check");
});

// ── AC2(e): the experiment id comes from the PREREG; subject keys are repo-relative ──────────────────
test("AC2(e): records carry the prereg's experiment id and repo-relative subject keys", () => {
  const prereg = { acceptance_run: "E-HYPGEN-ACCEPT-1" };
  assert.equal(resolveExperimentId({ prereg }), "E-HYPGEN-ACCEPT-1", "an acceptance run is not round 1");
  assert.equal(resolveExperimentId({ flag: "E-OVERRIDE", prereg }), "E-OVERRIDE");
  assert.equal(resolveExperimentId({ prereg: { experiment: "E-FIELD", acceptance_run: "E-LATER" } }), "E-FIELD");
  assert.equal(resolveExperimentId({}), null, "the tool invents no id");
  assert.equal(repoRelComponent("task-status.ts"), "plugin/scripts/task-status.ts");
  assert.equal(repoRelComponent("plugin/scripts/task-status.ts"), "plugin/scripts/task-status.ts", "idempotent: round 1 and round 2 agree");
  assert.equal(repoRelComponent("./plugin/scripts/x.ts"), "plugin/scripts/x.ts");
  assert.equal(repoRelSubjectKey("invariant", ["b.ts", "a.ts"]), "hypgen:invariant|plugin/scripts/a.ts,plugin/scripts/b.ts");

  const dir = tmp();
  const experiment = resolveExperimentId({ prereg });
  const labels = { cases: [{ id: "NEG", role: "negative", a: ["c.ts"], b: ["d.ts"], kinds: ["identity"] }] };
  const matches = [{ case: "NEG", run: 1, hid: "H2", kind: "identity", comps: ["c.ts", "d.ts"], claim: "dup key", counter: "deliberate and documented", confidence: "low" }];
  const recs = [
    ...matchRecords({ matches, labels, runDir: dir, experiment }),
    ...verifyRecords({ verify: { results: [{ cluster: 1, kind: "invariant", comps: ["task-status.ts", "worker-driver.ts"], claim: "c", verdict: "supported", verdict_reason: null, intentional: null, wall_ms: 1, members: ["r1:H1"] }] }, experiment }),
    ...reviewRecords({ reviews: [{ case: "NEG", run: 1, hid: "H2", comps: ["c.ts"], wall_ms: 1, review: { same_concept: false, partial: true } }], runDir: dir, experiment }),
  ];
  assert.ok(recs.every(({ rec }) => rec.experiment === "E-HYPGEN-ACCEPT-1"));
  const refs = recs.map(({ rec }) => rec.experiment_ref).filter(Boolean);
  assert.ok(refs.length >= 3, "every outcome record names its experiment");
  assert.ok(refs.every((r) => r.startsWith("E-HYPGEN-ACCEPT-1 ")), refs.join(","));
  const keys = recs.map(({ rec }) => rec.subject_key).filter(Boolean);
  assert.ok(keys.length >= 3, "every emitted record carries a subject key");
  assert.ok(keys.every((k) => k.includes("plugin/scripts/")), `every component is repo-relative: ${keys.join(" / ")}`);
  assert.ok(keys.some((k) => k.includes("plugin/scripts/c.ts,plugin/scripts/d.ts")));
  assert.ok(keys.some((k) => k.includes("plugin/scripts/task-status.ts,plugin/scripts/worker-driver.ts")));
  // both rounds' spellings land on one key — the join the acceptance run could not make
  assert.equal(repoRelSubjectKey("invariant", ["task-status.ts"]), repoRelSubjectKey("invariant", ["plugin/scripts/task-status.ts"]));
  const tally = emit(recs, { out: path.join(dir, "records.jsonl") });
  assert.equal(tally.refused, 0, JSON.stringify(tally.reasons));
});

// ── AC2(f): each run file records a non-null model ───────────────────────────────────────────────────
test("AC2(f): each run file records a non-null model; an unresolved model is a refusal, not a null", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  const written = [];
  const res = await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 2, model: "v4.1flash-anthropic",
    promptFile: "arch-hypothesis-generation-prompts/investigator-round1-frozen.txt",
    promptFileSha256: sha256("PROMPT"), inventorySha256: sha256("INVENTORY"),
    runModel: async () => ({ stdout: "[]", status: 0 }), outDir: dir, writeFile: (f, t) => written.push(t), budget: { maxRuns: 3 },
  });
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 2);
  assert.ok(res.records.every((r) => r.model === "v4.1flash-anthropic"));
  const files = written.map((t) => JSON.parse(t));
  assert.equal(files.length, 2, "every run is written to its own file");
  assert.ok(files.every((f) => typeof f.model === "string" && f.model.length > 0), "a recorded null model is a lie about the run");
  assert.ok(files.every((f) => f.prompt_file === "arch-hypothesis-generation-prompts/investigator-round1-frozen.txt"), "the run names the prompt file it used");
  assert.ok(files.every((f) => f.prompt_file_sha256 === sha256("PROMPT") && f.inventory_sha256 === sha256("INVENTORY")));

  const noModel = await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 1,
    runModel: async () => ({ stdout: "[]" }), outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  });
  assert.equal(noModel.ok, false);
  assert.deepEqual(noModel.reasons, ["MODEL_UNRESOLVED"]);

  // the model is read from the argv the launcher built, so it is the RESOLVED one rather than a claim
  const fake = () => ["claude", "--model", "v4.1flash-anthropic", "-n", "quay-meta-driver", "-p"];
  assert.equal(modelFromArgv(hardenedArgv(fake, "P", "/repo")), "v4.1flash-anthropic");
  assert.equal(modelFromArgv(["claude", "-n", "x", "-p"]), null);
});

// ── the DEFAULT investigator prompt is the FROZEN round-1 one ────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication — AC (a)…(d)
// The provenance inventory form + the mechanical pre-verification layer.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** A fixture whose edges are unambiguous: `beta` imports the symbol, `gamma` RE-EXPORTS it, `delta`
 *  re-exports the whole module. Every one of the three is an import edge. */
const PROV_FIXTURE = {
  sources: {
    "alpha.ts": 'export const A = 1;\nexport function shared() {}\nconst c = ".quay/alpha.jsonl";\n',
    "beta.ts": 'import { shared } from "./alpha.ts";\nexport const B = 2;\n',
    "gamma.ts": 'export { shared } from "./alpha.ts";\nexport const G = 3;\n',
    "delta.ts": 'export * from "./alpha.ts";\nexport const D = 4;\n',
  },
  catalog: "header\n  alpha.ts  answers alpha\n  beta.ts   answers beta\n  gamma.ts  answers gamma\n  delta.ts  answers delta\n",
};
const PROV_FILES = Object.keys(PROV_FIXTURE.sources);
const buildProv = (form) => buildInventory({
  files: PROV_FILES, readSource: (f) => PROV_FIXTURE.sources[f], catalog: PROV_FIXTURE.catalog,
  maxExports: 15, maxCarriers: 6, carrierForms: "literal", form,
});

// ── AC(a): the DEFAULT form's bytes are frozen — the opt-in form must not perturb them ───────────────
test("AC(a): the default (neutral) inventory form's sha256 is unchanged, and provenance is opt-in", () => {
  const dflt = buildProv();                                     // no `form` ⇒ the round-1 form
  // FROZEN: computed from the module BEFORE the provenance form existed. A non-md5 regression pin —
  // if this moves, the round-1 reproduction at pin `e3163e519` has been perturbed.
  assert.equal(dflt.sha256, "3a475a3011ed253054024decb02f618d3726269f774e58608a7c199f26a8677e");
  assert.equal(dflt.form, "neutral");
  assert.equal(dflt.text.includes("imports:"), false, "the neutral form carries NO structural fields");
  assert.equal(dflt.text.includes("imported_by:"), false);
  assert.equal(buildProv("neutral").sha256, dflt.sha256, "naming the default form changes nothing");
  // and the opt-in form IS a different artifact (a different experiment, hence a different prompt/prereg)
  assert.notEqual(buildProv("provenance").sha256, dflt.sha256);
  assert.deepEqual([...INVENTORY_FORMS], ["neutral", "provenance"]);
  assert.throws(() => buildProv("provenence"), /--inventory-form must be one of/);
});

// ── AC(b): the provenance form lists imports/imported_by for EVERY component, including re-exports ───
test("AC(b): the provenance form lists `imports` and `imported_by` for every component, incl. re-exports", () => {
  const prov = buildProv("provenance");
  for (const e of prov.entries) {
    assert.ok(Array.isArray(e.imports), `${e.c} carries an imports array`);
    assert.ok(Array.isArray(e.imported_by), `${e.c} carries an imported_by array`);
  }
  const at = (c) => prov.entries.find((e) => e.c === c);
  // a plain import
  assert.deepEqual(at("beta.ts").imports, [{ module: "plugin/scripts/alpha.ts", names: ["shared"], line: 1 }]);
  // a RE-EXPORT of a name is an import edge like any other
  assert.deepEqual(at("gamma.ts").imports, [{ module: "plugin/scripts/alpha.ts", names: ["shared"], line: 1 }]);
  // `export * from "…"` re-exports the whole module
  assert.deepEqual(at("delta.ts").imports, [{ module: "plugin/scripts/alpha.ts", names: ["*"], line: 1 }]);
  // the fan-in is the reverse of those edges, repo-relative and sorted
  assert.deepEqual(at("alpha.ts").imports, []);
  assert.deepEqual(at("alpha.ts").imported_by, ["plugin/scripts/beta.ts", "plugin/scripts/delta.ts", "plugin/scripts/gamma.ts"]);
  assert.deepEqual(at("beta.ts").imported_by, []);
  // the rendered line carries both fields for every component (the model sees the same fields as the code)
  const renderedLines = prov.text.trimEnd().split("\n");
  assert.equal(renderedLines.length, 4);
  assert.ok(renderedLines.every((l) => l.includes(" | imports: ") && l.includes(" | imported_by: ")));
  assert.match(renderedLines.find((l) => l.startsWith("- alpha.ts")), /imported_by: plugin\/scripts\/beta\.ts, plugin\/scripts\/delta\.ts, plugin\/scripts\/gamma\.ts$/);
  // the clause reader itself: aliases bind the DEFINING name, `*` is a namespace, default is named
  assert.deepEqual(importClauseNames("{ a, b as c }"), ["a", "b"]);
  assert.deepEqual(importClauseNames("* as ns"), ["*"]);
  assert.deepEqual(importClauseNames("*"), ["*"]);
  assert.deepEqual(importClauseNames("D, { a }"), ["default", "a"]);
  assert.deepEqual(importClauseNames(""), []);
  // and names are read from the statement the parser located (a multi-line brace form included)
  const multi = 'import {\n  one,\n  two as three\n} from "./x.ts";\n';
  assert.deepEqual(importedNames(multi, 1, "./x.ts"), ["one", "two"]);
  // a side-effect import contributes an edge but no names
  assert.deepEqual(importedNames('import "./x.ts";\n', 1, "./x.ts"), []);
  // out-of-scope specifiers (bare packages, data files) are NOT edges
  const b = buildProvenance({ files: ["a.ts"], readSource: () => 'import fs from "node:fs";\nimport j from "./d.json";\n', });
  assert.deepEqual(b.importsOf.get("a.ts"), []);
});

// ── AC(c): the contamination scan ignores STRUCTURAL edges, still refuses a free-text cross-mention ──
test("AC(c): contamination ignores structural edges but still refuses a free-text cross-mention", () => {
  const pairs = [{ id: "PAIR", groups: [["alpha.ts"], ["beta.ts"]] }];
  // an entry whose STRUCTURAL fields (the provenance edges) name both sides is NOT contaminated
  const structural = [{
    c: "alpha.ts", q: "nothing to see", exports: [], carriers: [],
    imports: [{ module: "plugin/scripts/beta.ts", names: ["x"], line: 1 }],
    imported_by: ["plugin/scripts/beta.ts"], sha256: "0".repeat(64),
  }];
  assert.equal(contaminationScan(structural, pairs).ok, true, "edges are neutral repository facts");
  assert.equal(contaminationText(structural[0]).includes("beta.ts"), false, "the edges are out of the scanned text");
  assert.deepEqual([...CONTAMINATION_EXCLUDED_FIELDS], ["imports", "imported_by", "sha256"]);
  // CONTROL: the same entry with the mention in FREE TEXT still refuses — the guard was not weakened
  const freeText = [{ ...structural[0], q: "see beta.ts for the other half" }];
  const refused = contaminationScan(freeText, pairs);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.cross, [{ entry: "alpha.ts", pair: "PAIR", groups: [0, 1] }]);
  // and the neutral-form behaviour the round-1 run relied on is byte-identical
  const neutral = [{ c: "alpha.ts", q: "runs alongside beta.ts", exports: ["beta.ts"], carriers: [] }];
  assert.equal(contaminationText(neutral[0]), JSON.stringify(neutral[0]), "no field of a neutral entry is dropped");
  assert.equal(contaminationScan(neutral, pairs).ok, false);
});

// ── AC(d): the mechanical finding is EVIDENCE, and never decides a cluster ───────────────────────────
// (gap-hypgen-mechanical-shared-implementation-layer-false-refutes)
test("AC(d): the shared-import finding is reported as evidence and decides nothing", async () => {
  const shared = [
    { c: "a.ts", imports: [], imported_by: ["plugin/scripts/b.ts", "plugin/scripts/c.ts"], sha256: "a".repeat(64) },
    { c: "b.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["shared"], line: 3 }], imported_by: [], sha256: "b".repeat(64) },
    { c: "c.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["shared"], line: 5 }], imported_by: [], sha256: "c".repeat(64) },
  ];
  const hit = sharedImplementation({ components: ["a.ts", "b.ts", "c.ts"], provenance: shared });
  assert.equal(hit.definer, "plugin/scripts/a.ts");
  assert.deepEqual(hit.symbol, ["shared"], "the name every importer takes from the definer");
  assert.deepEqual(hit.importers, ["plugin/scripts/b.ts", "plugin/scripts/c.ts"]);
  assert.deepEqual(hit.non_importers, [], "every known component here is the definer or an importer");
  assert.deepEqual(hit.unknown_components, []);
  assert.equal(hit.evidence.length, 2);
  for (const e of hit.evidence) {
    assert.match(e.file, /^plugin\/scripts\/[bc]\.ts$/, "evidence names the importing FILE (repo-relative)");
    assert.ok(e.line > 0 && e.sha256, "…with a line and the file's sha256");
    assert.equal(e.imports, "plugin/scripts/a.ts");
  }
  // ⛔ NO verdict is produced anywhere by this layer: the finding is the whole output.
  assert.equal(Object.prototype.hasOwnProperty.call(hit, "verdict"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(hit, "verdict_reason"), false);

  // The finding NAMES the components that do not import the definer, and keeps NOT-INVENTORIED apart:
  // a component the inventory does not cover was never observed, so "does not import" is not a reading
  // this layer may make of it (硬规则 6).
  const withOutsider = [
    ...shared,
    { c: "d.ts", imports: [{ module: "plugin/scripts/z.ts", names: ["q"], line: 1 }], imported_by: [], sha256: "d".repeat(64) },
  ];
  const f2 = sharedImplementation({ components: ["a.ts", "b.ts", "c.ts", "d.ts", "ghost.ts"], provenance: withOutsider });
  assert.deepEqual(f2.importers, ["plugin/scripts/b.ts", "plugin/scripts/c.ts"]);
  assert.deepEqual(f2.non_importers, ["plugin/scripts/d.ts"], "known, and takes no edge to the definer");
  assert.deepEqual(f2.unknown_components, ["plugin/scripts/ghost.ts"], "absent from the inventory ⇒ NOT a non-importer");
  const lines = mechanicalEvidenceLines({ components: ["a.ts", "b.ts", "c.ts", "d.ts", "ghost.ts"], provenance: withOutsider });
  assert.ok(lines.some((l) => l.includes("NOT-importing plugin/scripts/d.ts")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("NOT-INVENTORIED plugin/scripts/ghost.ts")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("import plugin/scripts/b.ts:3 -> plugin/scripts/a.ts")), lines.join("\n"));

  // NEGATIVE: three components that each DEFINE the symbol import nothing — no finding at all
  const indie = ["x.ts", "y.ts", "z.ts"].map((c) => ({ c, imports: [], imported_by: [], sha256: "d".repeat(64) }));
  assert.equal(sharedImplementation({ components: ["x.ts", "y.ts", "z.ts"], provenance: indie }), null);
  assert.deepEqual(mechanicalEvidenceLines({ components: ["x.ts", "y.ts", "z.ts"], provenance: indie }), []);
  // …and a finding needs a STAR: two distinct targets means several implementations
  const twoTargets = [
    { c: "p.ts", imports: [], imported_by: ["plugin/scripts/q.ts", "plugin/scripts/r.ts"], sha256: "e".repeat(64) },
    { c: "q.ts", imports: [{ module: "plugin/scripts/p.ts", names: ["s"], line: 1 }], imported_by: ["plugin/scripts/r.ts"], sha256: "f".repeat(64) },
    { c: "r.ts", imports: [{ module: "plugin/scripts/p.ts", names: ["s"], line: 1 }, { module: "plugin/scripts/q.ts", names: ["t"], line: 2 }], imported_by: [], sha256: "0".repeat(64) },
  ];
  assert.equal(sharedImplementation({ components: ["p.ts", "q.ts", "r.ts"], provenance: twoTargets }), null);
  // ⛔ "could not evaluate" is NOT a finding: no provenance, or fewer than two known components
  assert.equal(sharedImplementation({ components: ["a.ts", "b.ts"], provenance: null }), null);
  assert.equal(sharedImplementation({ components: ["ghost.ts"], provenance: shared }), null);
  assert.equal(sharedImplementation({}), null);

  // THROUGH runVerifier: the cluster STILL gets its model call, its verdict is the MODEL's, and the
  // finding rides along as `mechanical_evidence`.
  const dir = tmp();
  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts", "c.ts"], concept_kind: "policy", claim: "three independent impls", confidence: "high" }] }]);
  let called = 0;
  const rv = await runVerifier({
    clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}", provenance: shared,
    runModel: async () => { called++; return { stdout: JSON.stringify({ verdict: "supported" }), status: 0 }; },
  });
  assert.equal(rv.ok, true);
  assert.equal(called, 1, "⛔ a shared-import finding must NOT save the model call");
  assert.equal(rv.mechanical_evidence, 1, "…it is COUNTED as evidence, and named as such");
  assert.equal(Object.prototype.hasOwnProperty.call(rv, "mechanical_refuted"), false, "the refutation count is gone");
  assert.equal(rv.results[0].verdict, "supported", "the verdict is the MODEL's");
  assert.equal(rv.results[0].verdict_reason, null);
  assert.equal(rv.results[0].mechanical, false);
  assert.equal(rv.results[0].mechanical_evidence.definer, "plugin/scripts/a.ts");
  assert.deepEqual(rv.results[0].mechanical_evidence.importers, ["plugin/scripts/b.ts", "plugin/scripts/c.ts"]);
  // …and the store record is the model's verdict, with no `shared-implementation` reason anywhere
  const emitted = verifyRecords({ verify: rv });
  assert.equal(emitted[0].rec.verdict, "supported");
  assert.equal(emitted[0].rec.verdict_reason, null);
  const tally = emit(emitted, { out: path.join(dir, "records.jsonl") });
  assert.equal(tally.refused, 0, JSON.stringify(tally.reasons));
  // CONTROL: with NO provenance the same cluster goes to the model too — and carries no evidence key
  let called2 = 0;
  const rv2 = await runVerifier({
    clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}",
    runModel: async () => { called2++; return { stdout: JSON.stringify({ verdict: "supported" }), status: 0 }; },
  });
  assert.equal(called2, 1);
  assert.equal(rv2.results[0].verdict, "supported");
  assert.equal(rv2.mechanical_evidence, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(rv2.results[0], "mechanical_evidence"), false);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-hypgen-mechanical-shared-implementation-layer-false-refutes — AC (a)…(c)
// The mechanical shared-import layer attaches EVIDENCE, never a verdict: it fired as `refuted`/
// `shared-implementation` on 6 clusters in `E-DT-1`, every one of them carrying named components that do
// NOT import the definer — including Hf c15, a CONFIRMED real defect.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

// ── AC(a): converging edges PLUS a named non-importer ⇒ evidence, and the pack names the non-importer ─
test("AC(a): a star with a named non-importer yields no verdict, and its pack lists the non-importer", async () => {
  // b.ts and c.ts import the definer; d.ts is NAMED by the hypothesis and imports something else. This is
  // the Hf-c15 SHAPE: `checker-mechanical-spine-check.ts` holds the conflicting contract and imports
  // nothing from `checker-io.ts`, so an import-edge verdict never looked at it.
  const prov = [
    { c: "a.ts", imports: [], imported_by: ["plugin/scripts/b.ts", "plugin/scripts/c.ts", "plugin/scripts/d.ts"], sha256: "a".repeat(64) },
    { c: "b.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["shared"], line: 3 }], imported_by: [], sha256: "b".repeat(64) },
    { c: "c.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["shared"], line: 5 }], imported_by: [], sha256: "c".repeat(64) },
    { c: "d.ts", imports: [{ module: "plugin/scripts/elsewhere.ts", names: ["exit"], line: 2 }], imported_by: [], sha256: "d".repeat(64) },
  ];
  const components = ["a.ts", "b.ts", "c.ts", "d.ts"];
  const f = sharedImplementation({ components, provenance: prov });
  assert.equal(f.definer, "plugin/scripts/a.ts");
  assert.deepEqual(f.importers, ["plugin/scripts/b.ts", "plugin/scripts/c.ts"]);
  assert.deepEqual(f.non_importers, ["plugin/scripts/d.ts"]);
  const pack = buildEvidencePack({ components, claim: "the exit-code contract diverges", sources: {}, provenance: prov, hits: [] });
  assert.ok(pack.text.includes("NOT-importing plugin/scripts/d.ts"), pack.text);
  assert.ok(pack.text.includes("NOT a verdict"), pack.text);

  // THROUGH runVerifier: no mechanical verdict — the MODEL decides, and the row carries the finding.
  const dir = tmp();
  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components, concept_kind: "invariant", claim: "the exit-code contract diverges", confidence: "high" }] }]);
  let called = 0;
  const rv = await runVerifier({
    clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}", provenance: prov, strategy: "evidence-pack", evidence: { provenance: prov },
    runModel: async () => { called++; return { stdout: JSON.stringify({ verdict: "supported" }), status: 0 }; },
  });
  assert.equal(called, 1, "the finding must not decide the cluster");
  assert.equal(rv.mechanical_evidence, 1);
  assert.equal(rv.results[0].verdict, "supported");
  assert.equal(rv.results[0].verdict_reason, null);
  assert.equal(rv.results[0].mechanical, false);
  assert.deepEqual(rv.results[0].mechanical_evidence.non_importers, ["plugin/scripts/d.ts"]);
  assert.ok(rv.results[0].pack.lines.some((l) => l.includes("NOT-importing plugin/scripts/d.ts")), rv.results[0].pack.lines.join("\n"));
});

// ── AC(b): every component imports the definer ⇒ still no verdict, and the import lines ride along ────
test("AC(b): a perfect star yields no verdict and still carries its import lines as evidence", async () => {
  const prov = [
    { c: "a.ts", imports: [], imported_by: ["plugin/scripts/b.ts", "plugin/scripts/c.ts"], sha256: "a".repeat(64) },
    { c: "b.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["shared"], line: 3 }], imported_by: [], sha256: "b".repeat(64) },
    { c: "c.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["shared"], line: 5 }], imported_by: [], sha256: "c".repeat(64) },
  ];
  const components = ["a.ts", "b.ts", "c.ts"];
  const f = sharedImplementation({ components, provenance: prov });
  assert.deepEqual(f.non_importers, [], "every named component is the definer or an importer");
  const lines = mechanicalEvidenceLines({ components, provenance: prov });
  assert.equal(lines.length, 3, "the summary line + one line per import edge");
  assert.ok(lines.some((l) => l.includes("import plugin/scripts/b.ts:3 -> plugin/scripts/a.ts")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("import plugin/scripts/c.ts:5 -> plugin/scripts/a.ts")), lines.join("\n"));
  // ⛔ a PERFECT star is exactly the case that was wrongly refuted: it must still go to the model. The
  // `E-HYPGEN-AB-1` arm A c15 counterexample (the inert `routine_quota.window_ms`) is of this shape —
  // importing the constant is not consuming the configured value.
  const dir = tmp();
  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components, concept_kind: "invariant", claim: "window_ms is inert", confidence: "high" }] }]);
  let called = 0;
  const rv = await runVerifier({
    clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}", provenance: prov,
    runModel: async () => { called++; return { stdout: JSON.stringify({ verdict: "refuted" }), status: 0 }; },
  });
  assert.equal(called, 1);
  assert.equal(rv.results[0].verdict, "refuted", "the verdict is the model's, and may well be refuted");
  assert.equal(rv.results[0].verdict_reason, null, "⛔ never `shared-implementation`");
  assert.equal(rv.results[0].mechanical_evidence.definer, "plugin/scripts/a.ts");
});

// ── AC(c): without `--provenance`, the output is byte-identical to the pre-change rendering ───────────
test("AC(c): a provenance-free run is byte-identical to the pre-change output", async () => {
  // (i) THE PACK. sha256 FROZEN from the module AS IT WAS before this change
  // (`git show HEAD:docs/analysis/arch-hypothesis-generation.mjs`): the mechanical section is APPENDED
  // only when a finding exists, so a pack assembled without a provenance sidecar does not move.
  const sources = { "alpha.ts": "export const window_ms = 1000;\n", "beta.ts": "export const window_ms = 2000;\n" };
  const noProv = buildEvidencePack({ components: ["alpha.ts", "beta.ts"], claim: "the window_ms quota", sources, hits: [] });
  assert.equal(sha256(noProv.text), "5bef83a6668a00d6fcdd5c3d63761e4f202fe81c5247a0ce15f39a3bf0aab980");
  assert.equal(noProv.text.includes("MECH"), false, "no mechanical line without a provenance sidecar");
  assert.deepEqual(noProv.sections.mechanical, []);
  assert.equal(Object.prototype.hasOwnProperty.call(noProv.counts, "mechanical"), false, "no new counts key");
  assert.ok(noProv.text.includes("sections: definitions=2 imports=0 hits=0\n"), "the sections line is unchanged");
  // …and the SAME pack WITH a sidecar DOES carry the finding (the control that the gate is real)
  const withProv = buildEvidencePack({
    components: ["alpha.ts", "beta.ts"], claim: "the window_ms quota", sources, hits: [],
    provenance: [
      { c: "alpha.ts", imports: [], imported_by: ["plugin/scripts/beta.ts"], sha256: "a".repeat(64) },
      { c: "beta.ts", imports: [{ module: "plugin/scripts/alpha.ts", names: ["x"], line: 1 }], imported_by: [], sha256: "b".repeat(64) },
    ],
  });
  assert.notEqual(sha256(withProv.text), sha256(noProv.text));

  // (ii) THE ROW. The key set is FROZEN from the pre-change module; `mechanical_evidence` is a NEW key
  // present only when a finding exists, so a provenance-free row is unchanged key-for-key.
  const PRE_CHANGE_ROW_KEYS = ["cluster", "members", "kind", "comps", "claim", "wall_ms", "out_bytes",
    "exit", "strategy", "verdict", "verdict_reason", "verdict_cause", "mechanical", "instrumented",
    "instrumentation", "turns", "turns_used", "cli_num_turns", "requested_model", "actual_model",
    "model_mismatch", "usage", "cost_usd", "intentional", "evidence", "counterexample", "pack", "summary"];
  const dir = tmp();
  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts"], concept_kind: "policy", claim: "c", confidence: "high" }] }]);
  const rv = await runVerifier({
    clusters, pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}",
    runModel: async () => ({ stdout: JSON.stringify({ verdict: "supported" }), status: 0 }),
  });
  assert.deepEqual(Object.keys(rv.results[0]), PRE_CHANGE_ROW_KEYS);
  assert.equal(Object.prototype.hasOwnProperty.call(rv, "mechanical_refuted"), false, "the run-level refutation count is gone");
  assert.equal(Object.prototype.hasOwnProperty.call(rv, "decided_without_model"), false);

  // (iii) THE ARTIFACT'S RUN-LEVEL FIELD. Without a sidecar the pre-change NAME and value are kept, so
  // `verify.json` is byte-identical; with one it is named for what it counts.
  assert.deepEqual(mechanicalSummaryField({ provenance: null, mechanical_evidence: 0 }), { mechanical_refuted: 0 });
  assert.deepEqual(mechanicalSummaryField({ provenance: [{ c: "a.ts" }], mechanical_evidence: 3 }), { mechanical_evidence: 3 });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-hypgen-verifier-budget-exhaustion-is-unobservable-and-unscoped — AC (a)…(d)
// Turn-budget OBSERVABILITY, scope enforcement, and the opt-in evidence pack.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

const oneCluster = () => clusterHypotheses([{ run: 1, hyps: [
  { id: "H1", components: ["a.ts", "b.ts"], concept_kind: "policy", claim: "c", confidence: "high" },
] }]);
const sse = (events) => events.map((e) => JSON.stringify(e)).join("\n");
const toolUse = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id, content) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
const streamResult = (o) => ({ type: "result", ...o });

// ── AC(a): the pinned tree may not carry .quay/ (or any other out-of-scope top-level dir) ────────────
test("AC(a): a pin dir containing .quay/ (or any scope dir) is refused, and no model call happens", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".quay"));
  assert.equal(verifyCwdRefusal(dir, dir), "PIN_NOT_STRIPPED:.quay");
  for (const d of ["archive", "milestones", "measurements"]) fs.mkdirSync(path.join(dir, d));
  assert.equal(verifyCwdRefusal(dir, dir), "PIN_NOT_STRIPPED:.quay,archive,milestones,measurements", "every present dir is named (硬规则 3)");
  assert.deepEqual([...SCOPE_FORBIDDEN_DIRS], [".quay", "archive", "milestones", "measurements"]);
  // ⛔ the dependency task's strippedness list is COMPLEMENTED, not rewritten
  assert.deepEqual([...STRIPPED_DIRS], ["tasks", "goals", "docs", "orchestration"]);
  assert.deepEqual([...PIN_FORBIDDEN_DIRS], ["tasks", "goals", "docs", "orchestration", ".quay", "archive", "milestones", "measurements"]);
  // and it refuses THROUGH runVerifier, before any model call
  let called = 0;
  const res = await runVerifier({
    clusters: oneCluster(), pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}",
    runModel: async () => { called++; return { stdout: "{}", status: 0 }; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, EXIT.cwdNotNeutral);
  assert.deepEqual(res.reasons, ["PIN_NOT_STRIPPED:.quay,archive,milestones,measurements"]);
  assert.equal(called, 0, "no model call may happen before the scope check");
});

// ── AC(b): an exhausted verifier leaves a PER-TURN record and is undetermined/turn-budget ────────────
test("AC(b): an exhausted verifier leaves a per-turn record, cause turn-budget, and is never refuted", async () => {
  const dir = tmp();
  // The stream the CLI actually emits: the result event carries the STRUCTURAL subtype, and (in
  // stream-json mode) no "Reached max turns" text exists ANYWHERE — so the cause must not be read by
  // keyword. Two tool calls with their result payload sizes are what the acceptance run never recorded.
  const stdout = sse([
    toolUse("t1", "Grep", { pattern: "window_ms", path: "/pin", output_mode: "content" }),
    toolResult("t1", "x".repeat(4096)),
    toolUse("t2", "Read", { file_path: "/pin/plugin/scripts/a.ts" }),
    toolResult("t2", "y".repeat(512)),
    streamResult({ subtype: "error_max_turns", is_error: true, num_turns: 2 }),
  ]);
  assert.equal(stdout.includes("max turns"), false, "the fixture proves keyword matching cannot be the cause");
  const res = await runVerifier({
    clusters: oneCluster(), pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}",
    runModel: async () => ({ stdout, stderr: "", status: 1 }),
  });
  const row = res.results[0];
  assert.equal(row.verdict, "undetermined");
  assert.notEqual(row.verdict, "refuted");
  assert.equal(row.verdict_cause, "turn-budget");
  assert.equal(row.instrumented, true);
  assert.equal(row.instrumentation, "stream-json");
  assert.deepEqual(row.turns.map((t) => t.tool), ["Grep", "Read"]);
  assert.deepEqual(row.turns.map((t) => t.result_bytes), [4096, 512], "the per-turn record carries the result byte size");
  assert.ok(row.turns[0].args_head.includes("window_ms"), "the argument head names what was searched");
  assert.equal(row.turns_used, 2);
  assert.equal(row.cli_num_turns, 2);
  // the emitted store row carries the observability the acceptance run lacked
  const rec = verifyRecords({ verify: res })[0].rec;
  assert.equal(rec.verdict, "undetermined");
  assert.equal(rec.verifier_instrumentation, "stream-json");
  assert.equal(rec.verifier_turns_used, 2);

  // ⛔ a call with NO parseable stream is "not evaluated", never "zero turns" (硬规则 3b)
  const plain = await runVerifier({
    clusters: oneCluster(), pinDir: dir, cwd: dir, promptTemplate: "{{HYP}}",
    runModel: async () => ({ stdout: "Error: Reached max turns (8)", stderr: "", status: 1 }),
  });
  assert.equal(plain.results[0].verdict, "undetermined");
  assert.equal(plain.results[0].verdict_cause, "turn-budget");
  assert.equal(plain.results[0].instrumentation, UNINSTRUMENTED);
  assert.equal(plain.results[0].turns, null);
  assert.equal(plain.results[0].turns_used, null);
  // and a stream that parsed but spent NO tool call is zero turns — a different reading from the above
  const zero = parseVerifierStream(sse([streamResult({ subtype: "success", num_turns: 1, result: "{\"verdict\":\"refuted\"}" })]));
  assert.equal(zero.ok, true);
  assert.deepEqual(zero.turns, []);
  assert.equal(zero.finalText, '{"verdict":"refuted"}');
});

// ── AC(c): the evidence pack names the definition lines and the import lines, and respects the cap ───
test("AC(c): the evidence pack names definition lines and import lines, and respects the line cap", () => {
  const sources = {
    "alpha.ts": "export const window_ms = 1000;\nexport function shared() {}\n",
    "beta.ts": 'import { shared } from "./alpha.ts";\nexport const window_ms = 2000;\n',
  };
  const provenance = [
    { c: "alpha.ts", imports: [], imported_by: ["plugin/scripts/beta.ts"], sha256: "a".repeat(64) },
    { c: "beta.ts", imports: [{ module: "plugin/scripts/alpha.ts", names: ["shared"], line: 1 }], imported_by: [], sha256: "b".repeat(64) },
  ];
  const claim = "the routine quota window_ms is declared separately in alpha.ts and beta.ts";
  assert.deepEqual(citedSymbols(claim), ["window_ms"], "only the code-shaped token is a cited symbol");
  assert.equal(isDefinitionLine("export const window_ms = 1000;", "window_ms"), true);
  assert.equal(isDefinitionLine("  // window_ms is parsed here", "window_ms"), false, "a mention is not a definition (硬规则 2)");

  const pack = buildEvidencePack({ components: ["alpha.ts", "beta.ts"], claim, sources, provenance, hits: [] });
  const defs = pack.sections.definitions;
  assert.deepEqual(defs.map((d) => `${d.component}:${d.line}`), ["plugin/scripts/alpha.ts:1", "plugin/scripts/beta.ts:2"]);
  assert.ok(defs.every((d) => d.symbol === "window_ms"));
  assert.ok(pack.text.includes("DEF plugin/scripts/alpha.ts:1"), pack.text);
  assert.ok(pack.text.includes("DEF plugin/scripts/beta.ts:2"));
  const imps = pack.sections.imports;
  assert.equal(imps.length, 1);
  assert.equal(imps[0].from, "plugin/scripts/beta.ts");
  assert.equal(imps[0].to, "plugin/scripts/alpha.ts");
  assert.ok(pack.text.includes("IMP plugin/scripts/beta.ts:1 -> plugin/scripts/alpha.ts"), pack.text);
  assert.equal(pack.capped, false);
  assert.equal(DEFAULT_EVIDENCE_MAX_LINES, 40);

  // THE LINE CAP: more evidence than the cap ⇒ the rendered lines never exceed it, and `capped` says so
  const many = buildEvidencePack({
    components: ["alpha.ts", "beta.ts"], claim, sources, provenance,
    hits: Array.from({ length: 20 }, (_, i) => ({ file: "plugin/scripts/alpha.ts", line: i + 1, text: `hit ${i}` })), maxLines: 5,
  });
  assert.ok(many.lines.length <= 5, `cap respected: ${many.lines.length} > 5`);
  assert.equal(many.capped, true);
  assert.ok(many.counts.total > many.lines.length);
  // ROUND-ROBIN: a cap can never starve a whole evidence class of its first line
  assert.ok(many.lines.some((l) => l.startsWith("- DEF ")));
  assert.ok(many.lines.some((l) => l.startsWith("- IMP ")));
  assert.ok(many.lines.some((l) => l.startsWith("- HIT ")));
  // PURE: identical inputs ⇒ byte-identical pack (the pack is assembled before the model call, not by it)
  const mk = () => buildEvidencePack({ components: ["alpha.ts", "beta.ts"], claim, sources, provenance, hits: [] });
  assert.equal(mk().text, mk().text);
  // ⛔ a component with no source is SKIPPED, never treated as an empty file (硬规则 6)
  assert.deepEqual(definitionLinesFor({ symbols: ["window_ms"], components: ["ghost.ts"], sources }).length, 0);
  assert.deepEqual(importLinesFor({ components: ["alpha.ts", "beta.ts"], provenance })[0].names, ["shared"]);
});

// ── AC(d): the default verifier prompt is byte-identical; the pack prompt is a separate opt-in file ──
test("AC(d): the default verifier prompt is byte-identical to the frozen value and carries no pack slot", () => {
  const p = defaultVerifierPrompt();
  assert.equal(path.basename(p), FROZEN_VERIFIER_PROMPT);
  assert.equal(sha256(fs.readFileSync(p, "utf8")), FROZEN_VERIFIER_PROMPT_SHA256);
  assert.equal(FROZEN_VERIFIER_PROMPT_SHA256, "dba2e67157aac12ccb769fe10bfa75fb91cfe8955cf9eca66b71301f01981f2d");
  assert.equal(fs.readFileSync(p, "utf8").includes("{{PACK}}"), false, "the frozen prompt has no pack placeholder");
  const pack = evidencePackVerifierPrompt();
  assert.equal(path.basename(pack), EVIDENCE_PACK_VERIFIER_PROMPT);
  const packText = fs.readFileSync(pack, "utf8");
  assert.notEqual(sha256(packText), FROZEN_VERIFIER_PROMPT_SHA256, "the pack strategy is a DIFFERENT prompt file");
  assert.ok(packText.includes("{{PACK}}") && packText.includes("{{HYP}}"));
  assert.deepEqual([...VERIFIER_STRATEGIES], ["default", "evidence-pack"]);
});

// ── Plan 5: no regression case is named in the module or in any prompt ───────────────────────────────
test("Plan 5: neither the module nor the verifier prompts name a regression case label", () => {
  const analysisDir = new URL("../../docs/analysis/", import.meta.url);
  const modSrc = fs.readFileSync(new URL("arch-hypothesis-generation.mjs", analysisDir), "utf8");
  const promptFiles = ["verifier.txt", "verifier-evidence-pack.txt", "investigator.txt", "investigator-round1-frozen.txt", "reviewer.txt"];
  const texts = [["arch-hypothesis-generation.mjs", modSrc], ...promptFiles.map((f) => [f, fs.readFileSync(new URL(`arch-hypothesis-generation-prompts/${f}`, analysisDir), "utf8")])];
  for (const [name, text] of texts) {
    // An acceptance cluster is addressed by POSITION (`--only-cluster N`), never by its label. The labels
    // themselves are NOT reproduced here either — this file is not the place a skipped case could hide.
    assert.equal(/\bc13\b/i.test(text), false, `${name} must not name a regression case`);
  }
});

test("prompt: the tool's default investigator prompt is the frozen round-1 file, byte for byte", () => {
  const p = defaultInvestigatorPrompt();
  assert.equal(path.basename(p), FROZEN_INVESTIGATOR_PROMPT);
  const frozen = fs.readFileSync(p, "utf8");
  assert.equal(sha256(frozen), "19be897494996db41e05cc3862cfbb53361d0e5f10a82e41f91e99a2e0ad16ea");
  // the reworded text survives as a NAMED VARIANT — and is provably not what the default resolves to
  const variant = fs.readFileSync(path.join(path.dirname(p), "investigator.txt"), "utf8");
  assert.notEqual(sha256(variant), sha256(frozen), "the variant must not be the default's bytes");
  assert.match(variant, /VARIANT, NOT THE DEFAULT/);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored — AC(a)…(e)
// ONE pre-registration must cover BOTH arms of a pre-registered A/B experiment. With `--arm X` the gate
// reads the arm-scoped keys `prompt-investigator-X` / `inventory-X`; an arm key the prereg does not carry
// refuses as PREREG_HASH_ABSENT — never a fallback to the unscoped key, which would score the WRONG arm's
// bytes as pre-registered (硬规则 3b: "could not evaluate" must not be shaped like a pass).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

const PROMPT_A = "PROMPT-A-BYTES", INV_A = "INVENTORY-A-BYTES";
const PROMPT_B = "PROMPT-B-BYTES", INV_B = "INVENTORY-B-BYTES";

/** A two-arm prereg fixture, in the shape the real `E-HYPGEN-AB-1` prereg has: the unscoped keys name arm
 *  A, and each arm carries its own `-A` / `-B` keys. `armKeys:false` drops the `-B` pair (case (b)). */
function armFixture({ dir, runs, armKeys = true }) {
  const labelsText = JSON.stringify({ cases: [] });
  const labels = write(path.join(dir, "labels.json"), labelsText);
  runs.forEach((r, i) => write(path.join(dir, `run-${i + 1}.json`), r));
  const hashes = {
    "prompt-investigator": sha256(PROMPT_A), inventory: sha256(INV_A),
    "prompt-investigator-A": sha256(PROMPT_A), "inventory-A": sha256(INV_A),
    labels: sha256(labelsText),
  };
  if (armKeys) { hashes["prompt-investigator-B"] = sha256(PROMPT_B); hashes["inventory-B"] = sha256(INV_B); }
  const prereg = write(path.join(dir, "prereg.json"), { hashes });
  fs.utimesSync(prereg, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  return { labels, prereg };
}
const armRun = (prompt, inventory, extra = {}) => ({ run: 1, hyps: [], prompt_sha256: runPromptDigest(prompt, inventory), ...extra });
/** Score the fixture for one arm exactly as the CLI does: `expected` is derived from the bytes + the arm. */
const scoreArm = (dir, f, runCount, arm, bytes = { promptBytes: PROMPT_B, inventoryBytes: INV_B }) =>
  score({
    runDir: dir, runCount, labelsPath: f.labels, preregPath: f.prereg, arm,
    expected: expectedFromArtifacts({ ...bytes, arm }), promptBytes: bytes.promptBytes, inventoryBytes: bytes.inventoryBytes,
  });

// ── AC(a): --arm B with matching -B keys passes ──────────────────────────────────────────────────────
test("AC-arm(a): --arm B scores when the prereg records the matching -B keys", () => {
  const dir = tmp();
  const f = armFixture({ dir, runs: [armRun(PROMPT_B, INV_B)] });
  const ok = scoreArm(dir, f, 1, "B");
  assert.equal(ok.ok, true, ok.reasons?.join(","));
  // CONTROL (硬规则 4 推论四): the SAME fixture + SAME bytes under --arm A refuse, so the pass above is
  // caused by the arm SELECTION and not by the fixture being scoreable in general.
  const wrong = scoreArm(dir, f, 1, "A");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, EXIT.prereg);
  assert.deepEqual(wrong.reasons, ["PREREG_HASH_MISMATCH:prompt-investigator-A", "PREREG_HASH_MISMATCH:inventory-A"]);
});

// ── AC(b): an absent arm key is its OWN refusal, never a fallback ────────────────────────────────────
test("AC-arm(b): --arm B with no -B key refuses as ABSENT and never falls back to the unscoped keys", () => {
  const dir = tmp();
  const f = armFixture({ dir, runs: [armRun(PROMPT_B, INV_B)], armKeys: false });
  const refused = scoreArm(dir, f, 1, "B");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, EXIT.prereg);
  assert.deepEqual(refused.reasons, ["PREREG_HASH_ABSENT:prompt-investigator-B", "PREREG_HASH_ABSENT:inventory-B"]);
  // The unscoped keys ARE present in this prereg (they name arm A), so a fallback could only have produced
  // a MISMATCH — their absence from the reasons is the direct evidence that no fallback happened.
  assert.equal(refused.reasons.some((r) => r.includes("MISMATCH")), false, refused.reasons.join(","));
});

// ── AC(c): a run whose recorded B-prompt identity does not match the B bytes is refused ──────────────
test("AC-arm(c): --arm B refuses a run whose recorded prompt identity is not the B one", () => {
  // (i) the run recorded the digest of a DIFFERENT prompt than the B bytes supplied
  const dir = tmp();
  const bad = scoreArm(dir, armFixture({ dir, runs: [armRun("A DIFFERENT PROMPT", INV_B)] }), 1, "B");
  assert.equal(bad.code, EXIT.prereg);
  assert.deepEqual(bad.reasons, ["PREREG_HASH_MISMATCH:run-prompt:1"]);

  // (ii) the digest matches but the run names a DIFFERENT prompt FILE hash. The binding must read the
  // arm-scoped key (`prompt-investigator-B`), so arm A's file hash is a mismatch, not an accepted value.
  const dir2 = tmp();
  const bad2 = scoreArm(dir2, armFixture({ dir: dir2, runs: [armRun(PROMPT_B, INV_B, { prompt_file_sha256: sha256(PROMPT_A) })] }), 1, "B");
  assert.equal(bad2.code, EXIT.prereg);
  assert.deepEqual(bad2.reasons, ["PREREG_HASH_MISMATCH:run-prompt-file:1"]);

  // CONTROL: the same run naming its OWN arm's prompt-file hash scores.
  const dir3 = tmp();
  const ok3 = scoreArm(dir3, armFixture({ dir: dir3, runs: [armRun(PROMPT_B, INV_B, { prompt_file_sha256: sha256(PROMPT_B) })] }), 1, "B");
  assert.equal(ok3.ok, true, ok3.reasons?.join(","));
});

// ── AC(d): without --arm, the single-arm behaviour is byte-identical ─────────────────────────────────
test("AC-arm(d): without --arm the round-1 single-arm keys are unchanged", () => {
  // the expectation SHAPE is the round-1 one: exactly two unscoped keys, no arm suffix
  assert.deepEqual(Object.keys(expectedFromArtifacts({ promptBytes: "P", inventoryBytes: "I" })), ["prompt-investigator", "inventory"]);
  assert.deepEqual(
    expectedFromArtifacts({ promptBytes: "P", inventoryBytes: "I", arm: null }),
    expectedFromArtifacts({ promptBytes: "P", inventoryBytes: "I" }),
  );
  assert.deepEqual(
    expectedFromArtifacts({ promptBytes: "P", inventoryBytes: "I", arm: "B" }),
    { "prompt-investigator-B": sha256("P"), "inventory-B": sha256("I") },
  );
  // an EXISTING single-arm fixture (the AC2 helpers, unscoped keys only) still scores with no --arm …
  const dir = tmp();
  const single = preregFixture({ dir, runs: [run("PROMPT-BYTES", "INVENTORY-BYTES")] });
  assert.equal(scoreFixture(dir, single, 1).ok, true, "the unscoped fixture is unaffected");
  assert.deepEqual(single.expected, { "prompt-investigator": sha256("PROMPT-BYTES"), inventory: sha256("INVENTORY-BYTES") });
  // … and the SAME single-arm prereg under --arm B is ABSENT — i.e. `--arm` really switches the key set.
  const refused = score({
    runDir: dir, runCount: 1, labelsPath: single.labels, preregPath: single.prereg, arm: "B",
    expected: expectedFromArtifacts({ promptBytes: single.prompt, inventoryBytes: single.inventory, arm: "B" }),
    promptBytes: single.prompt, inventoryBytes: single.inventory,
  });
  assert.deepEqual(refused.reasons, ["PREREG_HASH_ABSENT:prompt-investigator-B", "PREREG_HASH_ABSENT:inventory-B"]);
});

// ── AC(e): the --arm id vocabulary — a rejected id can never become a key suffix ─────────────────────
test("AC-arm(e): the --arm id vocabulary admits only [A-Za-z0-9]+", () => {
  for (const ok of ["A", "B", "AB1", "arm2"]) assert.equal(ARM_ID_RE.test(ok), true, ok);
  for (const bad of ["", "A-B", "A B", "A/B", "../A", "A.B", "A_B"]) assert.equal(ARM_ID_RE.test(bad), false, bad);
  assert.equal(armScopedKey("inventory", "B"), "inventory-B");
  assert.equal(armScopedKey("inventory", null), "inventory");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-hypgen-model-identity-and-token-cost-are-not-measured — AC (a)…(f)
// The investigator must be runnable on a CHOSEN model (a per-call override, never global config), and
// every model call must record the model the gateway ACTUALLY served (not the requested proxy) and its
// token cost / usage — read structurally from the stream, never by keyword.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** A `system`/`init` stream event: the ONE place the ACTUAL served model is reported. */
const initEvent = (model) => ({ type: "system", subtype: "init", model });

// ── AC(a): --model puts X into the argv and changes NOTHING else (shared by investigate/verify/review) ─
test("AC-model(a): --model overrides only the model in the hardened argv, for every verb", () => {
  const fake = () => ["claude", "--model", "v4.1flash-anthropic", "-n", "quay-meta-driver", "-p"];
  const base = hardenedArgv(fake, "PROMPT", "/repo");
  assert.equal(modelFromArgv(base), "v4.1flash-anthropic");
  const withX = hardenedArgv(fake, "PROMPT", "/repo", { model: "X" });
  assert.equal(modelFromArgv(withX), "X");
  // nothing else changes: same length, every token but the --model VALUE is identical
  assert.equal(withX.length, base.length);
  const expected = base.slice(); expected[expected.indexOf("--model") + 1] = "X";
  assert.deepEqual(withX, expected, "the override touches ONLY the --model value");
  // no override ⇒ byte-identical to the pre-override argv
  assert.deepEqual(hardenedArgv(fake, "PROMPT", "/repo", { model: null }), base);
  // the launcher resolving NO --model still gains the pair, and it never lands after the prompt flag
  const noModel = () => ["claude", "-n", "role", "-p"];
  const inserted = hardenedArgv(noModel, "P", "/r", { model: "X" });
  assert.equal(modelFromArgv(inserted), "X");
  assert.equal(inserted[inserted.length - 1], "-p", "the trailing prompt flag stays last");
  // the same override composes with the stream-json instrumentation every call now uses
  const streamed = hardenedArgv(fake, "P", "/r", { model: "X", outputFormat: "stream-json" });
  assert.equal(streamed[streamed.indexOf("--output-format") + 1], "stream-json");
  assert.ok(streamed.includes("--verbose"));
  assert.deepEqual(applyModel(["c", "--model", "a", "-p"], "b"), ["c", "--model", "b", "-p"]);
});

// ── AC(b): the init event's model records actual_model; requested≠actual is a recorded mismatch ──────
test("AC-model(b): the init event's model is recorded as actual_model, and a mismatch is recorded", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  const runWith = async (stdout, model) => (await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 1, model,
    runModel: async () => ({ stdout, status: 0 }), outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  })).records[0];

  const mismatch = await runWith(sse([initEvent("Y"), streamResult({ result: "[]" })]), "X");
  assert.equal(mismatch.requested_model, "X");
  assert.equal(mismatch.actual_model, "Y");
  assert.equal(mismatch.model_mismatch, true, "requested ≠ actual must be recorded, never silently passed");

  // CONTROL: the SAME stream with a request that AGREES is not flagged — the flag tracks the comparison
  const agree = await runWith(sse([initEvent("Y"), streamResult({ result: "[]" })]), "Y");
  assert.equal(agree.actual_model, "Y");
  assert.equal(agree.model_mismatch, false);
});

// ── AC(c): a stream with no init model ⇒ not-evaluated:model-unverified (never the requested proxy) ──
test("AC-model(c): a stream without an init model records not-evaluated:model-unverified", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  const run = async (stdout) => (await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 1, model: "requested-x",
    runModel: async () => ({ stdout, status: 0 }), outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  })).records[0];

  // a parsed stream that simply carries no init model: the actual identity is unmeasured
  const noInit = await run(sse([streamResult({ result: "[]" })]));
  assert.equal(noInit.actual_model, MODEL_UNVERIFIED);
  assert.equal(noInit.actual_model, "not-evaluated:model-unverified");
  assert.notEqual(noInit.actual_model, "requested-x", "the requested model is a PROXY, never copied into the actual one");
  assert.equal(noInit.model_mismatch, false, "no actual reading ⇒ no mismatch claim");
  assert.equal(noInit.usage, null);
  // non-stream stdout (the pre-instrumentation path) is the SAME not-evaluated value
  assert.equal((await run("[]")).actual_model, MODEL_UNVERIFIED);
});

// ── AC(d): the result event's usage and total_cost_usd are recorded ──────────────────────────────────
test("AC-model(d): the result event's token usage and total_cost_usd are recorded on the call", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  const usage = { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33 };
  const withUsage = sse([initEvent("Y"), streamResult({ result: "[]", usage, total_cost_usd: 0.0123 })]);
  const one = (await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 1, model: "Y",
    runModel: async () => ({ stdout: withUsage, status: 0 }), outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  })).records[0];
  assert.deepEqual(one.usage, usage, "the usage numbers from the result event are recorded verbatim");
  assert.equal(one.cost_usd, 0.0123);
  // a call whose result event carries no usage keeps null — never a fabricated zero object (硬规则 3b)
  const bare = (await runInvestigator({
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 1, model: "Y",
    runModel: async () => ({ stdout: sse([initEvent("Y"), streamResult({ result: "[]" })]), status: 0 }), outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  })).records[0];
  assert.equal(bare.usage, null);
  assert.equal(bare.cost_usd, null);

  // the SAME fields reach a verify row (the shared modelCallFields seam)
  const pin = tmp();
  const clusters = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts"], concept_kind: "policy", claim: "c", confidence: "high" }] }]);
  const rv = await runVerifier({
    clusters, pinDir: pin, cwd: pin, promptTemplate: "{{HYP}}", model: "Y",
    runModel: async () => ({ stdout: sse([initEvent("Y"), streamResult({ result: JSON.stringify({ verdict: "supported" }), usage, total_cost_usd: 0.02 })]), stderr: "", status: 0 }),
  });
  assert.equal(rv.results[0].requested_model, "Y");
  assert.equal(rv.results[0].actual_model, "Y");
  assert.deepEqual(rv.results[0].usage, usage);
  assert.equal(rv.results[0].cost_usd, 0.02);
  // ⛔ RETIRED: the `not-applicable:no-model-call` row (a mechanically refuted cluster). A cluster
  // carrying a shared-import finding IS a model row now, so it goes through the SAME `modelCallFields`
  // seam — there is no second row shape (gap-hypgen-mechanical-shared-implementation-layer-false-refutes).
  const prov = [
    { c: "a.ts", imports: [], imported_by: ["plugin/scripts/b.ts", "plugin/scripts/c.ts"], sha256: "a".repeat(64) },
    { c: "b.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["s"], line: 1 }], imported_by: [], sha256: "b".repeat(64) },
    { c: "c.ts", imports: [{ module: "plugin/scripts/a.ts", names: ["s"], line: 1 }], imported_by: [], sha256: "c".repeat(64) },
  ];
  const cl3 = clusterHypotheses([{ run: 1, hyps: [{ id: "H1", components: ["a.ts", "b.ts", "c.ts"], concept_kind: "policy", claim: "c", confidence: "high" }] }]);
  const rm = await runVerifier({
    clusters: cl3, pinDir: pin, cwd: pin, promptTemplate: "{{HYP}}", provenance: prov, model: "Y",
    runModel: async () => ({ stdout: sse([initEvent("Y"), streamResult({ result: JSON.stringify({ verdict: "refuted" }) })]), status: 0 }),
  });
  assert.equal(rm.results[0].actual_model, "Y", "the finding did not suppress the call, so the model IS recorded");
  assert.equal(rm.results[0].mechanical_evidence.definer, "plugin/scripts/a.ts");
});

// ── AC(e): the stream's result text parses to the SAME hypotheses as the same text as plain stdout ───
test("AC-model(e): hypotheses from the stream's result text equal those from the same plain stdout", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  const hypsText = '[{"id":"H1","components":["a.ts","b.ts"],"concept_kind":"policy","claim":"c","confidence":"high"}]';
  const parseOne = async (stdout) => (await runInvestigator({
    prompt: "P", neutralDir: neutral, cwd: neutral, runs: 1, model: "Y",
    runModel: async () => ({ stdout, status: 0 }), outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  })).records[0];
  const plain = await parseOne(hypsText);
  const streamed = await parseOne(sse([initEvent("Y"), streamResult({ result: hypsText })]));
  assert.deepEqual(streamed.hyps, plain.hyps, "stream-json must not change what was parsed");
  assert.equal(streamed.n_hyps, 1);
  assert.equal(callText(sse([initEvent("Y"), streamResult({ result: hypsText })])), hypsText, "the result text is what is parsed");
});

// ── AC(f): a prereg `models` map contradicting the run's requested model makes scoring refuse ────────
test("AC-model(f): a prereg models map that contradicts the run's requested model refuses scoring", () => {
  const P = "PROMPT-BYTES", I = "INVENTORY-BYTES";
  const runsWithModel = (model) => [{ run: 1, hyps: [], prompt_sha256: runPromptDigest(P, I), requested_model: model }];
  // (i) the map's value differs from the run's requested model ⇒ refusal
  const dir = tmp();
  const bad = preregFixture({ dir, runs: runsWithModel("v4.1flash-anthropic"), mutate: ({ hashes }) => ({ hashes, models: { model: "v4pro-anthropic" } }) });
  const refused = scoreFixture(dir, bad, 1);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, EXIT.prereg);
  assert.ok(refused.reasons.some((r) => r.startsWith("PREREG_MODEL_MISMATCH")), refused.reasons.join(","));
  // CONTROL: the SAME fixture with a MATCHING value scores — the refusal was the mismatch, not the fixture
  const dir2 = tmp();
  const good = preregFixture({ dir: dir2, runs: runsWithModel("v4.1flash-anthropic"), mutate: ({ hashes }) => ({ hashes, models: { model: "v4.1flash-anthropic" } }) });
  assert.equal(scoreFixture(dir2, good, 1).ok, true);
  // no `models` key ⇒ the prereg expresses no opinion ⇒ scoring unchanged (back-compat)
  const dir3 = tmp();
  assert.equal(scoreFixture(dir3, preregFixture({ dir: dir3, runs: runsWithModel("anything") }), 1).ok, true);
  // a declared map that does NOT cover the arm is fail-closed, never a silent pass
  const dir4 = tmp();
  const armGap = preregFixture({ dir: dir4, runs: runsWithModel("x"), mutate: ({ hashes }) => ({ hashes, models: { "model-B": "x" } }) });
  const r4 = scoreFixture(dir4, armGap, 1);
  assert.equal(r4.code, EXIT.prereg);
  assert.deepEqual(r4.reasons, ["PREREG_MODEL_ABSENT:model"]);
  // the pure helper reports the same values, including a run that recorded no requested model
  assert.equal(modelPreregRefusal({ prereg: { models: { model: "a" } }, runs: [{ run: 1, requested_model: "a" }] }), null);
  assert.deepEqual(modelPreregRefusal({ prereg: { models: { model: "a" } }, runs: [{ run: 1, requested_model: "b" }] }).reasons, ["PREREG_MODEL_MISMATCH:1:b!=a"]);
  assert.deepEqual(modelPreregRefusal({ prereg: { models: { model: "a" } }, runs: [{ run: 1 }] }).reasons, ["RUN_MODEL_ABSENT:1"]);
});

// ══ THE FINGERPRINT SOURCE (gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall) ═══════
// A cluster that comes from a MECHANISM, not from a model: `fingerprint` runs either ArchGuard's own
// duplicate grouping (`exact`) or a call-structure signature built with the compiler the ArchGuard package
// ships (`callshape`), and writes the result as a run file whose `source_digest` stands in for
// `prompt_sha256`. `verify` / `match` / `review` then bind it to `hashes["fingerprint-<arm>"]`.
//
// AC(a)-(c) drive the REAL instrument, so they need a real ArchGuard root; when the host carries none they
// SKIP with the reason printed rather than passing vacuously. AC(d) and AC(e) are hermetic and always run
// (AC(d) is in fact STRONGER on a host that does carry ArchGuard: the explicit-root refusal is asserted
// while the plugin default is present and would have been a valid fallback).

const ARCHGUARD_ROOT = resolveArchguardRoot(null);
const NO_ARCHGUARD = ARCHGUARD_ROOT ? null : "no ArchGuard root on this host (--archguard-root / ARCHGUARD_ROOT / the plugin npm-cache)";

/** A stripped pinned tree carrying `plugin/scripts/*.ts` — the shape `fingerprint` walks. */
function pinTree(files) {
  const pin = path.join(tmp(), "pin");
  fs.mkdirSync(path.join(pin, "plugin", "scripts"), { recursive: true });
  for (const [name, text] of Object.entries(files)) write(path.join(pin, "plugin", "scripts", name), text);
  return pin;
}
/** Run the CLI with its stdout/stderr captured, so a test can assert on the report without polluting TAP. */
async function captureCli(argv) {
  const logs = [], errs = [];
  const ol = console.log, oe = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => errs.push(a.join(" "));
  try { return { code: await cli(argv), logs, errs }; } finally { console.log = ol; console.error = oe; }
}
// Two byte-identical bodies (the body IS the whole function text, so the `exact` arm groups them).
const DUP_BODY = `export function tally(values: number[]) {
  let sum = 0;
  for (const v of values) {
    if (v > 0) { sum = sum + v; }
  }
  return sum;
}
`;

// ── AC(a): two byte-identical bodies in two files ⇒ ONE group holding BOTH files ──────────────────────
test("AC-fp(a): the `exact` arm groups a byte-identical pair, and the verb writes it as a run file", async (t) => {
  if (NO_ARCHGUARD) return t.skip(NO_ARCHGUARD);
  const pin = pinTree({ "a.ts": DUP_BODY, "b.ts": DUP_BODY });
  const res = await fingerprintGroups({ pinDir: pin, arm: "exact", archguardRoot: ARCHGUARD_ROOT, minStatements: 2, minTokens: 20 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.groups.length, 1, "exactly the byte-identical pair groups");
  assert.deepEqual(res.groups[0].members.map((m) => m.file), ["plugin/scripts/a.ts", "plugin/scripts/b.ts"]);
  // the group record names the NEW function's line range, so the claim the records carry is checkable
  assert.equal(res.groups[0].members[0].startLine, 1);
  assert.equal(res.groups[0].members[0].endLine, 7);

  // and the VERB writes it: one run file, marked as a fingerprint run, carrying a digest not a prompt hash
  const runs = path.join(tmp(), "runs");
  const { code, logs } = await captureCli(["fingerprint", "--pin-dir", pin, "--arm", "exact", "--archguard-root", ARCHGUARD_ROOT, "--min-statements", "2", "--min-tokens", "20", "--runs", runs, "--json"]);
  assert.equal(code, 0, logs.join("\n"));
  const rec = JSON.parse(fs.readFileSync(path.join(runs, "run-1.json"), "utf8"));
  assert.equal(rec.fingerprint_source, "exact");
  assert.equal(rec.prompt_sha256, undefined, "a fingerprint run never records a prompt hash");
  assert.match(rec.source_digest, /^[0-9a-f]{64}$/);
  assert.equal(rec.hyps.length, 1);
  assert.deepEqual(rec.hyps[0].components, ["plugin/scripts/a.ts", "plugin/scripts/b.ts"]);
  assert.equal(rec.hyps[0].concept_kind, FINGERPRINT_CONCEPT_KIND);
  // the grouping is deterministic, so the recorded digest is re-derivable from the run file alone
  assert.equal(fingerprintDigest({ inputs: rec.inputs, groups: rec.groups_raw }), rec.source_digest);
});

// ── AC(b): the same NAME with different bodies is NOT a group (with a known-good pair as the control) ─
test("AC-fp(b): two functions with the same name but different bodies are never grouped", async (t) => {
  if (NO_ARCHGUARD) return t.skip(NO_ARCHGUARD);
  const pin = pinTree({
    "same1.ts": `export function same(values: number[]) {
  let sum = 0;
  for (const v of values) { sum = sum + v; }
  return sum;
}
`,
    "same2.ts": `export function same(values: number[]) {
  if (values.length === 0) { throw new Error("empty input"); }
  return values.reduce((acc, v) => acc * v, 1);
}
`,
    // CONTROL: a genuinely identical pair in the SAME fixture — a zero-group reading here would be caused
    // by the fixture or the instrument, not by the property under test (硬规则 2: the predicate is dry-run
    // against a sample known to be true).
    "dup1.ts": DUP_BODY,
    "dup2.ts": DUP_BODY,
  });
  const res = await fingerprintGroups({ pinDir: pin, arm: "exact", archguardRoot: ARCHGUARD_ROOT, minStatements: 2, minTokens: 20 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.groups.length, 1, "only the identical control pair groups");
  const files = res.groups[0].members.map((m) => m.file);
  assert.deepEqual(files, ["plugin/scripts/dup1.ts", "plugin/scripts/dup2.ts"]);
  assert.equal(files.includes("plugin/scripts/same1.ts"), false);
  assert.equal(files.includes("plugin/scripts/same2.ts"), false);
});

// ── AC(c): the `callshape` arm groups bodies that differ only in local names and literals ─────────────
test("AC-fp(c): `callshape` groups bodies differing only in local names/literals, and not different calls", async (t) => {
  if (NO_ARCHGUARD) return t.skip(NO_ARCHGUARD);
  const pin = pinTree({
    "one.ts": `export function alpha(seed: number) {
  let total = seed;
  for (const step of [1, 2, 3]) { total = total + step; }
  return total;
}
`,
    // same calls, same control flow; every local name and every literal differs
    "two.ts": `export function omega(input: number) {
  let acc = input;
  for (const part of [7, 8, 9]) { acc = acc + part; }
  return acc;
}
`,
    // NEGATIVE: same shape but a DIFFERENT control flow — a fingerprint that ignored this would be reading
    // nothing but "two functions of similar size"
    "three.ts": `export function gamma(seed: number) {
  let total = seed;
  while (total > 0) { total = total - 1; }
  return total;
}
`,
  });
  const res = await fingerprintGroups({ pinDir: pin, arm: "callshape", archguardRoot: ARCHGUARD_ROOT, minStatements: 2, minTokens: 4 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.ts_version, "the callshape arm records the compiler identity it actually used");
  assert.equal(res.groups.length, 1, JSON.stringify(res.groups));
  assert.deepEqual(res.groups[0].members.map((m) => m.file), ["plugin/scripts/one.ts", "plugin/scripts/two.ts"]);
  // the pure tokenizer is the mechanism, asserted directly: identical tokens for the renamed pair
  const tsr = await resolveArchguardTypescript(ARCHGUARD_ROOT);
  assert.equal(tsr.ok, true, tsr.reason);
  const toks = (src) => {
    const sf = tsr.ts.createSourceFile("x.ts", src, tsr.ts.ScriptTarget.Latest, true);
    return callshapeTokens(tsr.ts, sf.statements.find((s) => tsr.ts.isFunctionDeclaration(s))).tokens;
  };
  const one = toks(fs.readFileSync(path.join(pin, "plugin", "scripts", "one.ts"), "utf8"));
  const two = toks(fs.readFileSync(path.join(pin, "plugin", "scripts", "two.ts"), "utf8"));
  const three = toks(fs.readFileSync(path.join(pin, "plugin", "scripts", "three.ts"), "utf8"));
  assert.deepEqual(one, two, "renamed locals/literals leave the signature unchanged");
  assert.notDeepEqual(one, three, "a different control flow changes the signature");
});

// ── AC(d): an unresolvable root is NOT-EVALUATED — its own value, never zero groups ───────────────────
test("AC-fp(d): an unresolvable ArchGuard root or compiler gives not-evaluated, never zero groups", async () => {
  const pin = pinTree({ "a.ts": DUP_BODY, "b.ts": DUP_BODY });
  // ⛔ An EXPLICIT root is authoritative — no silent fall back to the plugin default (which is PRESENT on
  // any host where AC(a)-(c) ran at all, so a fallback would have measured a build nobody named).
  assert.equal(resolveArchguardRoot("/definitely/not/an/archguard/root"), "");
  assert.equal(resolveArchguardRoot("/definitely/not/an/archguard/root"), "", "and it stays unresolved");

  const res = await fingerprintGroups({ pinDir: pin, arm: "exact", archguardRoot: "" });
  assert.equal(res.ok, false);
  assert.equal(res.not_evaluated, true);
  assert.equal(res.code, EXIT.fingerprintNotEvaluated);
  assert.equal(res.reason, "ARCHGUARD_ROOT_UNRESOLVED");
  assert.equal("groups" in res, false, "a not-evaluated result carries NO group list — not an empty one");

  // an arm outside the vocabulary is refused before anything is loaded
  assert.equal((await fingerprintGroups({ pinDir: pin, arm: "guesswork", archguardRoot: ARCHGUARD_ROOT || "/x" })).reason, "FINGERPRINT_ARM_NOT_IN_VOCAB:guesswork");

  // the `callshape` arm's OWN dependency, three distinct causes — each its own reason
  const noResolve = await resolveArchguardTypescript("/some/root", { createRequire: () => ({ resolve: () => { throw Object.assign(new Error("Cannot find module 'typescript'"), { code: "ERR_MODULE_NOT_FOUND" }); } }) });
  assert.equal(noResolve.ok, false);
  assert.match(noResolve.reason, /^TS_RESOLVE_FAILED:ERR_MODULE_NOT_FOUND/);
  const noImport = await resolveArchguardTypescript("/some/root", { createRequire: () => ({ resolve: () => "/some/root/typescript.js" }), importModule: async () => { throw Object.assign(new Error("boom"), { code: "ERR_MODULE_NOT_FOUND" }); } });
  assert.match(noImport.reason, /^TS_IMPORT_FAILED:ERR_MODULE_NOT_FOUND/);
  const noApi = await resolveArchguardTypescript("/some/root", { createRequire: () => ({ resolve: () => "/some/root/typescript.js" }), importModule: async () => ({ version: "0.0.0" }) });
  assert.equal(noApi.reason, "TS_NO_AST_API:/some/root/typescript.js");
  // and through the whole verb: the loader succeeds, the compiler does not
  const noTs = await fingerprintGroups({
    pinDir: pin, arm: "callshape", archguardRoot: "/some/root",
    importModule: async (u) => (String(u).includes("typescript")
      ? (() => { throw Object.assign(new Error("Cannot find module 'typescript'"), { code: "ERR_MODULE_NOT_FOUND" }); })()
      : { detectDuplicates: async () => ({ groups: [], manifest: {} }), collectSourceFiles: () => [] }),
  });
  assert.equal(noTs.ok, false);
  assert.equal(noTs.not_evaluated, true);
  assert.match(noTs.reason, /^TS_RESOLVE_FAILED|^TS_IMPORT_FAILED/);
  assert.equal("groups" in noTs, false);

  // the CLI: exit code 11 AND no carrier at all — a zero-group run file would be indistinguishable from
  // "the instrument ran and found nothing"
  const runs = path.join(tmp(), "runs");
  const { code, errs } = await captureCli(["fingerprint", "--pin-dir", pin, "--arm", "exact", "--archguard-root", "/definitely/not/an/archguard/root", "--runs", runs]);
  assert.equal(code, EXIT.fingerprintNotEvaluated);
  assert.ok(errs.some((l) => l.includes("NOT_EVALUATED:ARCHGUARD_ROOT_UNRESOLVED")), errs.join("\n"));
  assert.equal(fs.existsSync(runs), false, "a not-evaluated run writes no carrier directory at all");
});

// ── AC(e): a fingerprint run is bound to hashes["fingerprint-<arm>"], with NO fallback ────────────────
const fingerprintFixture = ({ dir, arm = "exact", digest = "a".repeat(64), declared = undefined, hyps = [] }) => {
  write(path.join(dir, "run-1.json"), { run: 1, fingerprint_source: arm, source_digest: digest, n_hyps: hyps.length, hyps });
  const labelsText = JSON.stringify({ cases: [] });
  const labels = write(path.join(dir, "labels.json"), labelsText);
  const hashes = declared === undefined ? { [fingerprintKey(arm)]: digest } : { ...declared };
  hashes.labels = sha256(labelsText);
  const prereg = write(path.join(dir, "prereg.json"), { hashes });
  fs.utimesSync(prereg, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  return { labels, prereg, digest };
};
const scoreFingerprint = (dir, f, arm) =>
  score({ runDir: dir, runCount: 1, labelsPath: f.labels, preregPath: f.prereg, expected: {}, promptBytes: null, inventoryBytes: null, arm });

test("AC-fp(e): a fingerprint run is scored only against hashes[\"fingerprint-<arm>\"] — never the prompt keys", () => {
  // CONTROL: a prereg that declares the run's own digest scores, with no prompt/inventory bytes anywhere
  const dir = tmp();
  const good = fingerprintFixture({ dir, hyps: [{ id: "FP1", components: ["plugin/scripts/a.ts", "plugin/scripts/b.ts"], concept_kind: "identity", claim: "c" }] });
  const scored = scoreFingerprint(dir, good, "exact");
  assert.equal(scored.ok, true, scored.reasons?.join(","));
  assert.equal(scored.kind, "fingerprint");

  // the declared digest differs from the run's ⇒ refused, and the reason names the ARM's key
  const dir2 = tmp();
  const bad = fingerprintFixture({ dir: dir2, digest: "b".repeat(64), declared: { "fingerprint-exact": "c".repeat(64) } });
  const refused = scoreFingerprint(dir2, bad, "exact");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, EXIT.prereg);
  assert.ok(refused.reasons.some((r) => r.startsWith("PREREG_HASH_MISMATCH:fingerprint-exact")), refused.reasons.join(","));

  // ⛔ NO FALLBACK: a prereg carrying the (entirely plausible) prompt-investigator + inventory keys instead
  // is its OWN refusal — the fingerprint gate never reads the prompt keys, and cannot be satisfied by them
  const dir3 = tmp();
  const wrongKeys = fingerprintFixture({ dir: dir3, declared: { "prompt-investigator": "d".repeat(64), inventory: "e".repeat(64) } });
  const absent = scoreFingerprint(dir3, wrongKeys, "exact");
  assert.equal(absent.code, EXIT.prereg);
  assert.deepEqual(absent.reasons, ["PREREG_HASH_ABSENT:fingerprint-exact"]);

  // no `--arm` at all ⇒ its own refusal, never an unscoped key
  const dir4 = tmp();
  const unarmed = fingerprintFixture({ dir: dir4 });
  const noArm = scoreFingerprint(dir4, unarmed, null);
  assert.equal(noArm.code, EXIT.prereg);
  assert.deepEqual(noArm.reasons, ["FINGERPRINT_ARM_REQUIRED"]);

  // an arm naming the OTHER instrument does not judge this run
  const dir5 = tmp();
  const otherArm = fingerprintFixture({ dir: dir5, declared: { "fingerprint-callshape": "a".repeat(64) } });
  const crossed = scoreFingerprint(dir5, otherArm, "callshape");
  assert.equal(crossed.code, EXIT.prereg);
  assert.deepEqual(crossed.reasons, ["RUN_FINGERPRINT_ARM_MISMATCH:1:exact!=callshape"]);

  // a run that declares no digest at all is its own cause, never a pass
  const dir6 = tmp();
  const noDigestFixture = fingerprintFixture({ dir: dir6, declared: { "fingerprint-exact": "a".repeat(64) } });
  write(path.join(dir6, "run-1.json"), { run: 1, fingerprint_source: "exact", hyps: [] });   // strip the digest
  const noDigest = scoreFingerprint(dir6, noDigestFixture, "exact");
  assert.equal(noDigest.code, EXIT.prereg);
  assert.deepEqual(noDigest.reasons, ["PREREG_HASH_MISMATCH:fingerprint-exact"]);

  // the KIND is read from the run file, and a run carrying BOTH markers is its own refusal rather than
  // being resolved by precedence (硬规则 3b: a tie must not be broken in favour of a passing gate)
  assert.equal(fingerprintKey("exact"), "fingerprint-exact");
  assert.equal(runKind({ fingerprint_source: "exact", source_digest: "a" }), "fingerprint");
  assert.equal(runKind({ prompt_sha256: "a" }), "prompt");
  assert.equal(runKind({ fingerprint_source: "exact", prompt_sha256: "a" }), "ambiguous");
  const dir7 = tmp();
  const both = fingerprintFixture({ dir: dir7 });
  const rec7 = JSON.parse(fs.readFileSync(path.join(dir7, "run-1.json"), "utf8"));
  write(path.join(dir7, "run-1.json"), { ...rec7, prompt_sha256: "f".repeat(64) });
  const mixed = scoreFingerprint(dir7, both, "exact");
  assert.equal(mixed.code, EXIT.prereg);
  assert.deepEqual(mixed.reasons, ["RUN_KIND_AMBIGUOUS:carries-both-fingerprint_source-and-prompt_sha256"]);
});

// ── AC(e) through the CLI: `match` needs no prompt and no inventory for a fingerprint run ─────────────
test("AC-fp(e-cli): `match --arm <id>` scores a fingerprint run with no --inventory and no prompt file", async () => {
  const dir = tmp();
  const f = fingerprintFixture({ dir, hyps: [{ id: "FP1", components: ["plugin/scripts/a.ts", "plugin/scripts/b.ts"], concept_kind: "identity", claim: "c", confidence: "medium" }] });
  const out = tmp();
  // (i) the matching prereg scores, WITHOUT --inventory (which `readRunInputs` would otherwise demand)
  const okRun = await captureCli(["match", "--runs", dir, "--labels", f.labels, "--prereg", f.prereg, "--arm", "exact", "--out-dir", out]);
  assert.equal(okRun.code, 0, okRun.errs.join("\n"));
  // (ii) and a digest the prereg does not declare refuses, from the CLI, with the same cause
  const dir2 = tmp();
  const bad = fingerprintFixture({ dir: dir2, declared: { "fingerprint-exact": "c".repeat(64) } });
  const refused = await captureCli(["match", "--runs", dir2, "--labels", bad.labels, "--prereg", bad.prereg, "--arm", "exact", "--out-dir", tmp()]);
  assert.equal(refused.code, EXIT.prereg);
  assert.ok(refused.errs.some((l) => l.includes("PREREG_HASH_MISMATCH:fingerprint-exact")), refused.errs.join("\n"));
  // (iii) NEGATIVE CONTROL: with NO run file at all the CLI never enters the fingerprint path — it makes
  // the ordinary usage refusal (no --inventory), so (ii)'s PREREG_HASH_MISMATCH came from the run's own
  // digest rather than from a path that would have refused anything.
  const empty = tmp();
  const missing = await captureCli(["match", "--runs", empty, "--labels", f.labels, "--prereg", f.prereg, "--arm", "exact", "--out-dir", tmp()]);
  assert.equal(missing.code, EXIT.usage);
  assert.ok(missing.errs.some((l) => l.includes("INVENTORY_REQUIRED")), missing.errs.join("\n"));
});
