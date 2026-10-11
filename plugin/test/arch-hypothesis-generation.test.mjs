// @test-group engine
// Fixture tests for the blind hypothesis-generation shadow stage
// (docs/analysis/arch-hypothesis-generation.mjs). Pure functions + injectable seams only — no git, no
// model, no repo, no network. Each AC case is its own `test`.
//
// The model seam is INJECTED everywhere (`runModel`); the fs seam is injected where the read ORDER is
// part of the contract. Nothing here calls a real launcher.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EXIT, CARRIER_FORMS, HARD_MAX_CLUSTERS, VERIFIER_VERDICTS,
  extractExports, extractCarriers, parseCatalog, buildInventory, renderEntry,
  contaminationScan, preregRefusal,
  neutralCwdRefusal, verifyCwdRefusal, parseJsonObject, parseHypotheses, runInvestigator,
  clusterHypotheses, verifierVerdict, runVerifier,
  mechanicalMatch, matchVerdict, scoreCases,
  score, matchRecords, verifyRecords, reviewRecords, emit,
  buildReport, hardenedArgv,
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
    prompt: "PROMPT", neutralDir: neutral, cwd: neutral, runs: 1,
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
  const run1 = write(path.join(dir, "run-1.json"), { run: 1, hyps: [] });
  const run2 = write(path.join(dir, "run-2.json"), { run: 2, hyps: [] });
  const labels = write(path.join(dir, "labels.json"), { cases: [] });
  const prereg = write(path.join(dir, "prereg.json"), { hashes: { inventory: "a".repeat(64) } });
  // the pre-registration must predate the runs
  fs.utimesSync(prereg, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

  const rec = recordingFs();
  const res = score({ runDir: dir, runCount: 2, labelsPath: labels, preregPath: prereg, expected: { inventory: "a".repeat(64) }, fs: rec.fs });
  assert.equal(res.ok, true);
  const li = rec.order.indexOf(labels);
  assert.ok(li >= 0, "labels were read");
  for (const f of [run1, run2]) assert.ok(rec.order.indexOf(f) < li && rec.order.indexOf(`${f}#stat`) < li, `run file ${path.basename(f)} must be touched before labels`);

  // NEGATIVE CONTROL: a missing run file refuses AND the labels file is never opened at all
  fs.rmSync(run2);
  const rec2 = recordingFs();
  const res2 = score({ runDir: dir, runCount: 2, labelsPath: labels, preregPath: prereg, expected: { inventory: "a".repeat(64) }, fs: rec2.fs });
  assert.equal(res2.ok, false);
  assert.equal(res2.code, EXIT.runsIncomplete);
  assert.equal(rec2.order.includes(labels), false, "labels must not be read when a run is missing");

  // and a failed pre-registration gate likewise reads no labels (runs restored first, so the gate — not
  // the run-completeness check — is what refuses)
  write(run2, { run: 2, hyps: [] });
  const rec3 = recordingFs();
  const res3 = score({ runDir: dir, runCount: 2, labelsPath: labels, preregPath: prereg, expected: { inventory: "b".repeat(64) }, fs: rec3.fs });
  assert.equal(res3.code, EXIT.prereg);
  assert.equal(rec3.order.includes(labels), false);
});

// ── AC1/Plan 5: every bound is fail-closed with its OWN exit code ────────────────────────────────────
test("bounds: max-runs, max-clusters and max-ms each refuse with a distinct exit code", async () => {
  const dir = tmp();
  const neutral = path.join(dir, "neutral"); fs.mkdirSync(neutral);
  let called = 0;
  const overRuns = await runInvestigator({
    prompt: "P", neutralDir: neutral, cwd: neutral, runs: 5, runModel: async () => { called++; return { stdout: "[]" }; },
    outDir: dir, writeFile: () => {}, budget: { maxRuns: 3 },
  });
  assert.equal(overRuns.ok, false);
  assert.equal(overRuns.code, EXIT.maxRuns);
  assert.equal(called, 0, "the bound is checked before the first call");

  const zeroMs = await runInvestigator({
    prompt: "P", neutralDir: neutral, cwd: neutral, runs: 2, runModel: async () => { called++; return { stdout: "[]" }; },
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
