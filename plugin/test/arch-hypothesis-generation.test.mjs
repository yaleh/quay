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
  EXIT, CARRIER_FORMS, HARD_MAX_CLUSTERS, VERIFIER_VERDICTS,
  extractExports, extractCarriers, parseCatalog, buildInventory, renderEntry,
  contaminationScan, preregRefusal, runPromptDigest, runPromptRefusal,
  resolveExperimentId, repoRelComponent, repoRelSubjectKey,
  STRIPPED_DIRS, FROZEN_INVESTIGATOR_PROMPT, defaultInvestigatorPrompt, sha256,
  neutralCwdRefusal, verifyCwdRefusal, parseJsonObject, parseHypotheses, runInvestigator,
  clusterHypotheses, verifierVerdict, runVerifier,
  mechanicalMatch, matchVerdict, scoreCases,
  score, matchRecords, verifyRecords, reviewRecords, emit,
  buildReport, hardenedArgv, importDriverRuntime, modelFromArgv,
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
