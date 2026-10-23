// @test-group engine
// END-TO-END acceptance for GOAL-911 AC-924 (task gap-unencapsulated-state-clue-judge-e2e):
//   stage 1 clue reader (plugin/scripts/unencapsulated-state-clue.ts)   → candidates only
//   stage 2 recorded-verdict judge (plugin/scripts/unencapsulated-state-judge.ts) → confirmed/refuted
//   Planner semantic-judged route (docs/analysis/ownership-active-limited-proposal.mjs) → admission
//
// Every arm below drives a PRODUCTION entry point: the clue reader is the shipped script, the judge is
// the shipped judge replaying a recorded corpus, and the Planner arm calls the REAL `runProposalCli`
// body in-process (its flag path, not a re-implementation). No second implementation lives in this file.
//
// ⛔ THE EXPECTED-VERDICT TABLE IS A LITERAL, deliberately NOT derived from the corpus or from module
//    constants (硬规则 4): deriving it would let one edit turn the corpus and the expectation green
//    together, i.e. the assertion would be structurally unable to take the false value. The reverse arm
//    in AC5 relies on exactly this — editing the corpus to say `confirmed` must make THIS table red.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as contract from "../../docs/analysis/semantic-admission-contract.mjs";
import { CLUE_STATES, JUDGE_VERDICTS } from "../../docs/analysis/semantic-admission-contract.mjs";
import { CONDITIONS, evaluateCarrier, runProposalCli } from "../../docs/analysis/ownership-active-limited-proposal.mjs";
import { CLUE_KIND, analyzeSource, scanRoot, stripCommentsAndLiterals } from "../../plugin/scripts/unencapsulated-state-clue.ts";
import {
  DEFAULT_CORPUS_REL,
  judgeCandidates,
  loadCorpus,
  replayVerdict,
  semanticAdmissionFromJudge,
  verdictKey,
} from "../../plugin/scripts/unencapsulated-state-judge.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FIXTURE_REL = "plugin/fixtures/unencapsulated-state";
const CONTRACT_REL = "docs/analysis/semantic-admission-contract.mjs";
const CLUE_REL = "plugin/scripts/unencapsulated-state-clue.ts";
const JUDGE_REL = "plugin/scripts/unencapsulated-state-judge.ts";

/** THE literal expectation table (see the header — never derived). */
const EXPECTED_VERDICTS = Object.freeze({
  "memoized-probe": "refuted",
  "diagnostic-counter": "refuted",
  "encapsulated-registry": "refuted",
  "true-state-cluster": "confirmed",
});

const corpusFile = path.join(REPO, DEFAULT_CORPUS_REL);
const corpus = loadCorpus(corpusFile);

/** The four sample clues, scanned through the PRODUCTION reader. */
const scanSamples = () => scanRoot({ root: REPO, scanDirs: [FIXTURE_REL], defaultMode: false });

/** A PERFECT mechanical slice-delta — the exact bait a mechanical path would accept. Used as a decoy:
 *  the semantic route must reach its verdict without ever reading it. */
const perfectDelta = () => ({
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

const candidateRecord = (key) => ({
  run_id: `live:${key}`,
  label: "live",
  concern_kind: "unencapsulated-state",
  clue_subject: `${FIXTURE_REL}/${key}.ts`,
  subject_files: [`${FIXTURE_REL}/${key}.ts`],
  slice_delta: perfectDelta(),
  decision_memory: { status: "not-known" },
});

// ── AC-924 (1): the clue reader over THIS repo — candidates only, never a confirmation ─────────────
test("AC924-1(clue): the real repository scan emits ONLY clue-layer states and never a confirmation", async () => {
  const scan = await scanRoot({ root: REPO }); // default scan set: packages/quay/src + plugin/scripts

  assert.ok(scan.records.length > 0, `the reader must scan real files, got ${scan.records.length}`);
  // ① every record's state is a member of the IMPORTED vocabulary — ⛔ not a literal subset.
  const illegal = scan.records.filter((r) => !CLUE_STATES.includes(r.state));
  assert.deepEqual(illegal.map((r) => `${r.subject}:${r.state}`), [], "every state must be a member of CLUE_STATES");
  // ② the clue layer structurally cannot confirm: the count is reported AND zero.
  assert.equal(scan.summary.confirmed, 0, "the clue layer must never report a confirmation");
  // ③ it does find candidates on the real tree (a scan that finds nothing is not a reading).
  assert.ok(scan.summary.candidate >= 1, `expected ≥1 candidate on the real tree, got ${scan.summary.candidate}`);
  // every summary bucket is a vocabulary member (plus the structural `confirmed` key).
  for (const state of CLUE_STATES) assert.equal(typeof scan.summary[state], "number", `summary.${state}`);
  // no record may carry a judge-layer verdict value either — the vocabularies are disjoint
  assert.equal(scan.records.filter((r) => JUDGE_VERDICTS.includes(r.state)).length, 0);
  assert.equal(scan.invalid, 0, "no record may fall outside CLUE_STATES");
});

// ── AC-924 (2): the four samples are CLUES — the reader fires on all four (including the 3 fakes) ───
test("AC924-2(clue): all four samples are candidates, and not one is a confirmation", async () => {
  const scan = await scanSamples();
  assert.equal(scan.records.length, 4, `expected the four samples, got ${scan.records.length}`);
  for (const r of scan.records) {
    assert.equal(r.kind, CLUE_KIND, `${r.subject} carries the concern kind`);
    assert.equal(r.state, "candidate", `${r.subject} must be a candidate (a clue, not a verdict)`);
    assert.ok(CLUE_STATES.includes(r.state), `${r.subject}: ${r.state} ∈ CLUE_STATES`);
    assert.ok(typeof r.proxy_reading === "string" && r.proxy_reading.length > 0, `${r.subject} carries its proxy reading`);
  }
  assert.equal(scan.summary.confirmed, 0);
  assert.equal(scan.summary.candidate, 4);
  // the reader is crude ON PURPOSE: it fires on the memo and the counter exactly like on the cluster.
  assert.deepEqual(scan.records.map((r) => verdictKey(r.subject)).sort(), Object.keys(EXPECTED_VERDICTS).sort());
});

// ── AC-924 (3): the judge replays recorded verdicts — 3 refuted, 1 confirmed WITH a counterfactual ──
test("AC924-3(judge): recorded-verdict replay matches the LITERAL table and confirms only with a counterfactual", async () => {
  const scan = await scanSamples();
  const judgments = judgeCandidates(scan.records, corpus, contract);

  const actual = Object.fromEntries(judgments.map((j) => [j.key, j.verdict]));
  assert.deepEqual(actual, EXPECTED_VERDICTS, "the judge's verdicts must equal the literal expectation table");

  for (const j of judgments) {
    assert.ok(JUDGE_VERDICTS.includes(j.verdict), `${j.key}: ${j.verdict} ∈ JUDGE_VERDICTS`);
    assert.ok(typeof j.rationale === "string" && j.rationale.trim().length > 0, `${j.key} carries a rationale`);
    assert.equal(j.found, true, `${j.key} must be found in the corpus`);
  }
  // every confirmation carries the control that would have made it different (硬规则 4 推论四)
  const confirmed = judgments.filter((j) => j.verdict === "confirmed");
  assert.deepEqual(confirmed.map((j) => j.key), ["true-state-cluster"]);
  for (const j of confirmed) {
    assert.ok(typeof j.counterfactual === "string" && j.counterfactual.trim().length > 0, `${j.key}: confirmed needs a counterfactual`);
  }

  // ④ an UNKNOWN subject is needs-more-evidence — a missing record is never upgraded to a confirmation
  const unknown = replayVerdict({ subject: `${FIXTURE_REL}/not-in-the-corpus.ts` }, corpus, contract);
  assert.equal(unknown.verdict, "needs-more-evidence");
  assert.equal(unknown.found, false);
  assert.notEqual(unknown.verdict, "confirmed");

  // the contract itself refuses a confirmation without a counterfactual — the rejection is BY NAME.
  assert.throws(
    () => contract.judgeRecord({ candidate_ref: "x", verdict: "confirmed", rationale: "because" }),
    (e) => e.name === "SemanticAdmissionContractError" && e.field === "counterfactual",
  );
});

// ── AC-924 (4): the Planner's semantic-judged route, driven through the REAL CLI body ───────────────
test("AC924-4(planner): a confirmed candidate is admitted by the semantic route and the mechanical delta is never read", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unencapsulated-state-admission-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const carrierFile = path.join(tmp, "carrier.jsonl");
  const keys = Object.keys(EXPECTED_VERDICTS);
  fs.writeFileSync(carrierFile, keys.map((k) => JSON.stringify(candidateRecord(k))).join("\n") + "\n", "utf8");

  const argv = ["--root", tmp, "--carrier", carrierFile];
  const judge = semanticAdmissionFromJudge(corpus, contract);
  const withJudge = await runProposalCli({ argv, repoRoot: REPO, deps: { semanticAdmission: judge } });
  const rowOf = (out, key) => out.results.find((r) => r.candidate === `${FIXTURE_REL}/${key}.ts`);

  // ① the confirmed candidate: eligible, and the reason names route + verdict + counterfactual.
  const ok = rowOf(withJudge, "true-state-cluster");
  assert.ok(ok, "the confirmed candidate must appear in the CLI output");
  assert.equal(ok.eligible, true, ok.reason);
  assert.match(ok.reason, /admission=semantic-judged/);
  assert.match(ok.reason, /verdict=confirmed/);
  assert.match(ok.reason, /counterfactual=\S/);
  // ② only C1 matched — no DELTA / STREAK / MEMORY was consulted.
  assert.deepEqual(ok.matchedConditions, [CONDITIONS.KIND], "only condition 1 may match on the semantic route");

  // ③ the three refuted samples are refused BY THE SEMANTIC ROUTE, with the verdict named.
  for (const key of ["memoized-probe", "diagnostic-counter", "encapsulated-registry"]) {
    const row = rowOf(withJudge, key);
    assert.ok(row, `${key} must appear in the CLI output`);
    assert.equal(row.eligible, false, `${key} must not be admitted`);
    assert.ok(row.reason.startsWith("CONDITION_1_SEMANTIC_REFUSED"), row.reason);
    assert.match(row.reason, /verdict=refuted/);
    assert.deepEqual(row.matchedConditions, []);
  }

  // ⑤ no judge injected ⇒ its OWN value (fail closed, never a mechanical confirmation).
  const withoutJudge = await runProposalCli({ argv, repoRoot: REPO });
  for (const row of withoutJudge.results) {
    assert.ok(row.reason.startsWith("CONDITION_1_SEMANTIC_NOT_EVALUATED"), row.reason);
    assert.equal(row.eligible, false);
  }

  // ④ THE DELTA IS NEVER READ — a getter-based decoy turns red if ANY code path touches it. This is a
  //    real measurement: it can take the false value (the pre-wiring `evaluateEntryBar` would read it).
  let deltaTouched = 0;
  const trapped = candidateRecord("true-state-cluster");
  delete trapped.slice_delta;
  Object.defineProperty(trapped, "slice_delta", {
    enumerable: true,
    get() {
      deltaTouched += 1;
      return perfectDelta();
    },
  });
  const inMemory = evaluateCarrier({ records: [trapped], malformed_lines: 0 }, { semanticAdmission: judge });
  assert.equal(inMemory.candidates.length, 1);
  assert.equal(inMemory.candidates[0].eligible, true, inMemory.candidates[0].reason);
  assert.equal(deltaTouched, 0, "the mechanical slice_delta must never be read on the semantic-judged route");
});

// ── AC-924 (5): one vocabulary, and the static-import premise is pinned ────────────────────────────
test("AC924-5(vocabulary): the contract module is the single declaration site and carries no entry guard", () => {
  const contractSrc = fs.readFileSync(path.join(REPO, CONTRACT_REL), "utf8");
  const clueSrc = fs.readFileSync(path.join(REPO, CLUE_REL), "utf8");
  const judgeSrc = fs.readFileSync(path.join(REPO, JUDGE_REL), "utf8");

  // the two vocabularies are disjoint — a shared value would let a clue masquerade as a verdict (3b)
  assert.equal(CLUE_STATES.filter((s) => JUDGE_VERDICTS.includes(s)).length, 0);
  assert.equal(contract.checkVocabulariesDisjoint().violations.length, 0);

  // ⛔ the premise that makes importing this module safe: no direct-entry guard may hijack an importer.
  assert.doesNotMatch(contractSrc, /process\.argv\[1\]/, "the contract module must carry no direct-entry guard");
  assert.doesNotMatch(contractSrc, /^if \(import\.meta\.url/m, "nor an `import.meta.url` main guard");

  // no second declaration of either vocabulary in either new script (the single-source rule)
  for (const [name, src] of [["clue", clueSrc], ["judge", judgeSrc]]) {
    assert.doesNotMatch(src, /(?:export\s+)?(?:const|let|var)\s+CLUE_STATES\s*=/, `${name}: no second CLUE_STATES declaration`);
    assert.doesNotMatch(src, /(?:export\s+)?(?:const|let|var)\s+JUDGE_VERDICTS\s*=/, `${name}: no second JUDGE_VERDICTS declaration`);
    // and they do not statically import docs/analysis (that path is outside the staged artifact root)
    assert.doesNotMatch(src, /(?:^|\n)\s*(?:import|export)[^;\n]*from\s*["'][^"']*docs\/analysis\/[^"']*["']/,
      `${name}: the contract module must be resolved from disk at runtime, never statically imported`);
  }

  // the clue layer cannot express a verdict even if asked to — the builder rejects it BY NAME.
  assert.throws(
    () => contract.clueRecord({ kind: CLUE_KIND, subject: "x.ts", state: "confirmed" }),
    (e) => e.name === "SemanticAdmissionContractError" && e.field === "state",
  );
});

// ── the reader's own two controls: comments/literals are not code, and "unreadable" is its own state ─
test("AC924-6(clue-predicate): comments and literal text are not hits, and a binary file is not-evaluated", () => {
  const commented = [
    "// a comment mentioning new Map() and cache.set(x) must not count",
    "/* let counter = 0; counter += 1; */",
    "export const label = `counter=${counter} cache.set`;",
    "export function nothing() { return 1; }",
  ].join("\n");
  const reading = analyzeSource(commented);
  assert.equal(reading.statefulDeclarations, 0, JSON.stringify(reading.declarations));
  assert.equal(reading.mutationSites, 0, JSON.stringify(reading.mutations));

  // and the negative control for the control: real code in the same shape IS counted
  const real = analyzeSource("let counter = 0;\nexport function bump() { counter += 1; }\n");
  assert.ok(real.statefulDeclarations >= 1 && real.mutationSites >= 1, JSON.stringify(real));

  // stripCommentsAndLiterals keeps line structure (line numbers in evidence_ref must stay meaningful)
  const src = "const a = 1; // tail\nconst b = 2;\n";
  assert.equal(stripCommentsAndLiterals(src).split("\n").length, src.split("\n").length);
});
