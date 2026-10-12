// @test-group engine
// open-semantic-discovery-routine.test.mjs — the contract for
// plugin/scripts/open-semantic-discovery-routine.ts, the REPORT-ONLY routine that wires OPEN-ENDED
// SEMANTIC architecture discovery (docs/analysis/arch-hypothesis-generation.mjs) into the quality-gate
// driver's routine track (task gap-open-semantic-discovery-routine-track).
//
// Coverage map (task Acceptance Criteria):
//   (a) disabled / halted                     ⇒ zero spawns
//   (b) malformed or MISSING key              ⇒ failed, zero spawns
//   (c) sub-360m interval without interval_until (or without either 24h cap) ⇒ config error
//   (d) a reservation precedes EACH of investigator, verifier and refuter; a call refused at the cap
//                                             ⇒ stop and report
//   (e) USD cap reached                       ⇒ not-evaluated:budget-usd-24h
//   (f) every spawned argv carries --max-turns (a tool-less step ⇒ 1)
//   (g) verifier supports + refuter refutes   ⇒ NOT confirmed
//   (h) a manual round does not advance last-run
//   (i) no write to tasks/, Goals, Portfolio or Experience — static control on the module's imports
//   (j) the investigator argv carries Read,Grep,Glob + --max-turns, and its cwd IS the pin
//   (k) the round runs when the pin is unchanged, when arch-discovery reports 0 new fingerprints, and
//       when the inventory is empty or missing — none of these suppresses the semantic round
//   (l) no problem-class pattern table or regex used to select/reject hypotheses (static control naming
//       what it scans for); the dedup ASSISTANCE is allowed and named
// Plus: the two in-scratch-copy NEGATIVE CONTROLS the task names ((g) and (k)), and the
// off-by-default / routine-table wiring contracts.
//
// Run: scripts/test.sh plugin/test/open-semantic-discovery-routine.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  OPEN_SEMANTIC_DISCOVERY_NAME,
  CARRIER_REL,
  BUDGET_LEDGER_REL,
  BUDGET_LOCK_REL,
  MIN_INTERVAL_MINUTES,
  DEFAULT_INTERVAL_MINUTES,
  INVESTIGATOR_TOOLS,
  VERIFIER_TOOLS,
  REFUTER_TOOLS,
  VALUE_TOOLS,
  NOVELTY_TOOLS,
  NOVELTY_PROMPT_TEMPLATE,
  NOVELTY_VERDICTS,
  NOVELTY_DISPOSITIONS,
  OPEN_DISCOVERY_REF_PREFIX,
  ROUTINE_FINDINGS_CARRIER_REL,
  ARCH_DISCOVERY_CARRIER_REL,
  openDiscoveryRecordId,
  buildNoveltyPrompt,
  parseNoveltyVerdict,
  findMechanicalRepeat,
  retrieveNoveltyCandidates,
  ingestRoundClusters,
  experienceRoleFor,
  experienceSummaryFor,
  taskIdFromPath,
  componentsFromSubjectKey,
  BLIND_INVESTIGATOR_MAX_TURNS,
  DEFAULT_INVESTIGATOR_MAX_TURNS,
  PER_CALL_USD_CEILING,
  FOCUS_MARKER,
  REFUTATION_PROMPT_TEMPLATE,
  VALUE_PROMPT_TEMPLATE,
  focusDirective,
  focusFromText,
  priorFocuses,
  parseOpenSemanticDiscoverySection,
  readOpenSemanticDiscoveryConfig,
  usdBudgetUsage,
  stepArgv,
  materializeStrippedPin,
  runOpenSemanticDiscovery,
  buildOpenSemanticDiscoveryRoutine,
  openSemanticDiscoveryRoutineFromConfig,
  resolveEngineModule,
  loadOpenDiscoveryModules,
  HYPOTHESIS_MODULE_FILE,
  LEDGER_MODULE_FILE,
  ANALYSIS_DIR_REL,
} from "../scripts/open-semantic-discovery-routine.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "../scripts/probe-routine.ts";
import { qualityGateRoutines } from "../scripts/quality-gate-driver.ts";
import { INVOKED_BY_MANUAL, INVOKED_BY_RESIDENT } from "../scripts/discovery-method-routine.ts";
import { appendLedgerRecords } from "../scripts/discovery-method-routine.ts";
// The engine is imported for REAL here so the argv the routine builds is the argv the engine builds:
// `hardenedArgv` is the production argv constructor, and the stubs only replace the RUNNERS.
import * as realHyp from "../../docs/analysis/arch-hypothesis-generation.mjs";
import * as realPortfolio from "../../docs/analysis/discovery-portfolio.mjs";
import * as realLedger from "../../docs/analysis/discovery-experience-ledger.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const ROUTINE_SRC = path.join(REPO_ROOT, "plugin", "scripts", "open-semantic-discovery-routine.ts");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

// ── fixture plumbing ─────────────────────────────────────────────────────────────────────────────────
const _tmpDirs = [];
after(() => {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(d);
  return d;
}

function makeWorkspace() {
  const ws = tmpDir("osd-routine-ws-");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  spawnSync("git", ["-C", ws, "init", "-q"], { encoding: "utf8", env: GIT_ENV });
  fs.writeFileSync(path.join(ws, "README.md"), "fixture\n", "utf8");
  spawnSync("git", ["-C", ws, "add", "-A"], { encoding: "utf8", env: GIT_ENV });
  spawnSync("git", ["-C", ws, "commit", "-qm", "fixture"], { encoding: "utf8", env: GIT_ENV });
  // The production default pins `develop` (the authoritative baseline); the fixture carries it so the
  // round is exercised through its REAL default rather than through a test-only override.
  spawnSync("git", ["-C", ws, "branch", "-M", "develop"], { encoding: "utf8", env: GIT_ENV });
  return ws;
}

const SECTION_KEYS = [
  ["enabled", "true"],
  ["interval", "interval:60m"],
  ["interval_until", "2026-10-20T00:00:00Z"],
  ["investigator_runs", "1"],
  ["max_clusters_verified", "3"],
  ["verifier_max_turns", "8"],
  ["refutation_max_turns", "6"],
  ["max_wall_ms", "1200000"],
  ["max_model_calls_per_24h", "120"],
  ["max_usd_per_24h", "30"],
];

/** The declared section, with any key OMITTED (pass `null`) or overridden. */
function cfgYaml(overrides = {}) {
  const lines = ["loop:", "  open_semantic_discovery:"];
  for (const [k, v] of SECTION_KEYS) {
    const val = Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : v;
    if (val === null) continue;
    lines.push(`    ${k}: ${val}`);
  }
  return lines.join("\n") + "\n";
}
function writeConfig(ws, body) {
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), body, "utf8");
}

const carrierPath = (ws) => path.join(ws, CARRIER_REL);
const ledgerPath = (ws) => path.join(ws, BUDGET_LEDGER_REL);
const lastRunPath = (ws) => path.join(ws, ROUTINE_LAST_RUN_REL);
const carrierLines = (ws) => (fs.existsSync(carrierPath(ws))
  ? fs.readFileSync(carrierPath(ws), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : []);
const rounds = (ws) => carrierLines(ws).filter((l) => l.kind === "scan-round");
const ledgerLines = (ws) => (fs.existsSync(ledgerPath(ws))
  ? fs.readFileSync(ledgerPath(ws), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : []);
const ledgerReserves = (ws) => ledgerLines(ws).filter((l) => l.kind === "reserve");
const resumeSteps = (ws) => ledgerReserves(ws).map((l) => l.step);

// ── the two ledgers the post-round ingestion writes ──────────────────────────────────────────────────
const portfolioRecords = (ws) => realPortfolio.readPortfolio(ws).records;
const experienceRecords = (ws) => realLedger.readExperienceLedger(ws).records;

/** Seed the Portfolio with ONE already-known finding whose component set AND claim match the fixture
 *  cluster, through the REAL ingest path. `origin_ref` resolves against a `.quay/routine-findings.jsonl`
 *  record written into the fixture, so the seed is a resolvable chain rather than a hand-written row. */
function seedKnownFinding(ws, { findingId = "F-seed", runId = "seed-run", findingKey = "seed-finding", claim, components } = {}) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.appendFileSync(path.join(ws, ROUTINE_FINDINGS_CARRIER_REL),
    JSON.stringify({ ts: new Date().toISOString(), kind: "finding", runId, findingId: findingKey, files: components }) + "\n", "utf8");
  const res = realPortfolio.ingestFinding(ws, {
    finding_id: findingId, origin: "autonomous-routine", origin_ref: `${runId}#${findingKey}`,
    evidence_level: "production-open", method_ref: null, claim,
    components, outcome: "supported", fix_task: null, human_rating: null, domain: null, domain_reason: null,
  });
  assert.equal(res.ok, true, `the seed finding must ingest (got ${JSON.stringify(res.reasons)})`);
  return findingId;
}

/** The component set + claim the fixture cluster ends up carrying, read from a REAL round rather than
 *  guessed — the ingestion's duplicate rule is only meaningful against the values the engine produced. */
async function clusterIdentityOf(ws, engine, spawn) {
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  const rec = carrierLines(ws).find((l) => l.kind === "cluster");
  assert.ok(rec, "the probe round wrote a cluster record");
  return { claim: rec.claim, components: rec.components, record_id: rec.record_id };
}

// ── the model stream fixture ─────────────────────────────────────────────────────────────────────────
// A stream the engine's own `parseVerifierStream` reads: an init event carrying the served model, and a
// result event carrying num_turns / usage / total_cost_usd / the final text.
const FIXTURE_MODEL = "fixture-model";
const streamText = (resultText) => [
  JSON.stringify({ type: "system", subtype: "init", model: FIXTURE_MODEL }),
  JSON.stringify({
    type: "result", subtype: "success", num_turns: 2, is_error: false, result: resultText,
    usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.02,
  }),
].join("\n") + "\n";
const STREAM = streamText(`${FOCUS_MARKER} fixture focus on the carrier helpers\n[]`);

/** The NOVELTY call's own answer. The default delegate answers it, so the ordinary round fixtures exercise
 *  the ingestion's happy path; a test that wants another verdict passes its own delegate. The prompt is
 *  recognised by the template's OWN first line rather than a copy of it, so the two cannot drift. */
const NOVELTY_FIRST_LINE = NOVELTY_PROMPT_TEMPLATE.split("\n")[0];
const noveltyStream = (verdict) => streamText(JSON.stringify({
  verdict, duplicate_of: null,
  reasoning: `fixture reasoning for a ${verdict} verdict`,
  summary: `fixture novelty summary for a ${verdict} verdict`,
}));
const NOVELTY_STREAM = noveltyStream("novel");
const isNoveltyPrompt = (opts) => String(opts?.stdinData ?? "").includes(NOVELTY_FIRST_LINE);
const defaultDelegate = (_argv, opts) => ({
  status: 0, stdout: isNoveltyPrompt(opts) ? NOVELTY_STREAM : STREAM, stderr: "", error: null,
});

/** A spawn primitive that COUNTS its calls (the seam every argv/cwd claim is read from). */
function countingSpawn(delegate) {
  const calls = [];
  const fn = async (argv, opts) => {
    calls.push({ argv, opts });
    return delegate ? delegate(argv, opts) : defaultDelegate(argv, opts);
  };
  fn.calls = calls;
  fn.noveltyCalls = () => calls.filter((c) => isNoveltyPrompt(c.opts));
  return fn;
}

/** The base launcher argv builder. The REAL `hardenedArgv` composes on top of it, so the argv the routine
 *  builds is the production one modulo the launcher binary itself. */
const fakeLaunchArgv = (role, prompt, root, opts) => ["claude", "-n", role, "-p"];

// ── hypotheses + the two runner stubs ────────────────────────────────────────────────────────────────
const HYPS = [
  { id: "h1", components: ["a.ts"], concept_kind: "duplication", claim: "a.ts duplicates b.ts", why_suspected: "x", evidence_needed: "y", counterexample_requirement: "z", confidence: "high" },
  { id: "h2", components: ["c.ts"], concept_kind: "dead-code", claim: "c.ts is unreachable", why_suspected: "x", evidence_needed: "y", counterexample_requirement: "z", confidence: "medium" },
];

function investigatorStub(hyps, sink) {
  const fn = async (o) => {
    const records = [];
    for (let i = 0; i < o.runs; i++) {
      const r = await o.runModel(o.prompt, i);
      sink.push({ cwd: o.cwd, pinDir: o.pinDir, tools: o.tools, maxTurns: o.maxTurns, prompt: o.prompt });
      records.push({ run: i + 1, hyps, stdout: r?.stdout ?? "", exit: r?.status ?? null });
    }
    return { ok: true, records, parsed: records.length, total: o.runs };
  };
  fn.calls = sink;
  return fn;
}

function verifierStub(sink, verdictFor) {
  const fn = async (o) => {
    const clusters = o.clusters;
    const idxs = o.onlyCluster != null ? [o.onlyCluster] : clusters.slice(0, o.maxClusters).map((_, i) => i + 1);
    const results = [];
    for (const ci of idxs) {
      const rep = clusters[ci - 1].rep;
      const prompt = String(o.promptTemplate).replace("{{HYP}}", JSON.stringify({ claim: rep.claim, components: rep.components }));
      const r = await o.runModel(prompt, { cluster: ci });
      sink.push({ cluster: ci, template: o.promptTemplate, prompt });
      results.push({
        cluster: ci, members: clusters[ci - 1].members, verdict: verdictFor(ci, o),
        evidence: [`${rep.comps[0]}:1 — fixture evidence`], turns_used: 2, cost_usd: 0.02,
        actual_model: FIXTURE_MODEL, counterexample: "fixture counterexample", intentional: "fixture impact",
        summary: "fixture summary", stdout: r?.stdout ?? "",
      });
    }
    return { ok: true, clusters_total: clusters.length, verified: idxs.length, beyond_cap: 0, results };
  };
  fn.calls = sink;
  return fn;
}

const alwaysSupported = () => "supported";

/** Build the engine seam: the REAL pure functions + argv builder, STUBBED runners. The portfolio and the
 *  experience ledger are the REAL modules (spread whole, with only the gateway fetch replaced) — the
 *  post-round ingestion is the thing under test, and a hand-written stand-in for it would be testing the
 *  stand-in. */
function makeEngine({ hyps = HYPS, verdictFor = alwaysSupported } = {}) {
  const investigatorCalls = [];
  const verifierCalls = [];
  const hyp = {
    PIN_FORBIDDEN_DIRS: realHyp.PIN_FORBIDDEN_DIRS,
    HARD_MAX_CLUSTERS: realHyp.HARD_MAX_CLUSTERS,
    DEFAULT_EVIDENCE_MAX_LINES: realHyp.DEFAULT_EVIDENCE_MAX_LINES,
    hardenedArgv: realHyp.hardenedArgv,
    verifyCwdRefusal: realHyp.verifyCwdRefusal,
    clusterHypotheses: realHyp.clusterHypotheses,
    buildInventory: realHyp.buildInventory,
    parseJsonObject: realHyp.parseJsonObject,
    parseVerifierStream: realHyp.parseVerifierStream,
    callText: realHyp.callText,
    defaultVerifierPrompt: realHyp.defaultVerifierPrompt,
    defaultInvestigatorPrompt: realHyp.defaultInvestigatorPrompt,
    TOOL: realHyp.TOOL,
    runInvestigator: investigatorStub(hyps, investigatorCalls),
    runVerifier: verifierStub(verifierCalls, verdictFor),
  };
  const portfolio = {
    ...realPortfolio,
    loadGatewayRates: () => ({ ok: true, rates: { model_group: FIXTURE_MODEL, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 } }),
  };
  return { modules: { hyp, portfolio, ledger: realLedger }, investigatorCalls, verifierCalls };
}

/** A pin seam that makes a directory carrying (or NOT carrying) the inventory scope. `pins` records every
 *  dir it handed out so a test can assert the spawn cwd IS the pin. */
function pinStub({ withScope = true } = {}) {
  const pins = [];
  const fn = ({ dir }) => {
    fs.mkdirSync(dir, { recursive: true });
    if (withScope) {
      const s = path.join(dir, "plugin", "scripts");
      fs.mkdirSync(s, { recursive: true });
      fs.writeFileSync(path.join(s, "a.ts"), "export const a = 1;\n", "utf8");
    }
    pins.push(dir);
    return { ok: true, dir };
  };
  fn.pins = pins;
  return fn;
}

function runOpts(ws, extra = {}) {
  const read = extra.configRead ?? readOpenSemanticDiscoveryConfig(ws);
  const engine = extra.engine ?? makeEngine();
  return {
    config: read.config,
    configPresent: read.present,
    configError: read.error,
    halted: false,
    invokedBy: INVOKED_BY_RESIDENT,
    modules: engine.modules,
    launchArgvFn: fakeLaunchArgv,
    ...extra,
    engine,
  };
}

// ── (a) disabled / halted ────────────────────────────────────────────────────────────────────────────
test("case (a) — section absent ⇒ not-evaluated:disabled and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  board: native\n");
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /disabled/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
  assert.equal(engine.investigatorCalls.length, 0, "ZERO investigator calls");
  assert.equal(fs.existsSync(carrierPath(ws)), false, "nothing written to the carrier");
});

test("case (a) — enabled:false ⇒ not-evaluated:disabled and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ enabled: "false" }));
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /disabled/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
});

test("case (a) — halted ⇒ not-evaluated and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), halted: true, spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /halted/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
  assert.equal(fs.existsSync(ledgerPath(ws)), false, "ZERO reservations");
});

// ── (b) malformed / missing key ──────────────────────────────────────────────────────────────────────
test("case (b) — a MALFORMED key ⇒ failed, zero spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ max_clusters_verified: "three" }));
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "failed");
  assert.match(fact.reason, /config invalid/);
  assert.match(fact.reason, /max_clusters_verified/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
});

test("case (b) — a MISSING key ⇒ failed, zero spawns (every declared key is required)", async () => {
  for (const key of ["investigator_runs", "max_clusters_verified", "verifier_max_turns", "refutation_max_turns", "max_wall_ms", "max_model_calls_per_24h", "max_usd_per_24h"]) {
    const ws = makeWorkspace();
    writeConfig(ws, cfgYaml({ [key]: null }));
    const engine = makeEngine();
    const spawn = countingSpawn();
    const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
    assert.equal(fact.state, "failed", `dropping '${key}' must be a config error`);
    assert.match(fact.reason, new RegExp(key), `the refusal names '${key}'`);
    assert.equal(spawn.calls.length, 0, `ZERO spawns without '${key}'`);
  }
});

// ── (c) the temporary-cadence rule ───────────────────────────────────────────────────────────────────
test("case (c) — sub-360m interval WITHOUT interval_until ⇒ config error; sub-360m without EITHER 24h cap ⇒ config error", () => {
  const base = () => ({
    enabled: true, interval: "interval:60m", interval_until: "2026-10-20T00:00:00Z",
    investigator_runs: 1, max_clusters_verified: 3, verifier_max_turns: 8, refutation_max_turns: 6,
    max_wall_ms: 1_200_000, max_model_calls_per_24h: 120, max_usd_per_24h: 30,
  });
  assert.equal(parseOpenSemanticDiscoverySection(base()).error, null, "the full declaration parses");
  const noUntil = base(); delete noUntil.interval_until;
  assert.match(parseOpenSemanticDiscoverySection(noUntil).error, /interval_until/);
  const noCallCap = base(); delete noCallCap.max_model_calls_per_24h;
  assert.match(parseOpenSemanticDiscoverySection(noCallCap).error, /max_model_calls_per_24h/);
  const noUsdCap = base(); delete noUsdCap.max_usd_per_24h;
  assert.match(parseOpenSemanticDiscoverySection(noUsdCap).error, /max_usd_per_24h/);
  // The floor is PER-ROUTINE and this one is 60m: a shorter cadence is refused, not rounded.
  assert.match(parseOpenSemanticDiscoverySection({ ...base(), interval: "interval:30m" }).error, new RegExp(`${MIN_INTERVAL_MINUTES}m floor`));
  // A 360m interval needs no expiry — the permanent cadence is not temporary.
  const permanent = parseOpenSemanticDiscoverySection({ ...base(), interval: `interval:${DEFAULT_INTERVAL_MINUTES}m`, interval_until: null });
  assert.equal(permanent.error, null, "360m is the permanent cadence and needs no interval_until");
  assert.equal(permanent.config.intervalUntil, null);
});

// ── (d) reservation before EVERY step ────────────────────────────────────────────────────────────────
test("case (d) — a reservation precedes EACH of investigator, verifier, refuter, value-assessor and novelty check", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // ONE hypothesis ⇒ exactly one cluster ⇒ the step order is the whole story, with no repetition to read
  // past.
  const engine = makeEngine({ hyps: [HYPS[0]] });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const steps = resumeSteps(ws);
  assert.deepEqual(steps, ["investigator", "verifier", "refuter", "value-assessment", "novelty-check"], `one reservation per step, in order (got ${steps.join(",")})`);
  assert.equal(spawn.calls.length, resumeSteps(ws).length, "one spawn per reservation — the reservation is BEFORE the spawn");
  // Every reservation's own record names its tools and its turn bound (the counting semantics travel).
  for (const r of ledgerReserves(ws)) {
    assert.equal(typeof r.max_turns, "number", "every reservation records its --max-turns");
    assert.equal(typeof r.tools, "string", "every reservation records its tool envelope");
  }
});

test("case (d) — a call REFUSED at the cap stops the round and reports it", async () => {
  const ws = makeWorkspace();
  // cap 2: the investigator (1) and the FIRST verifier (2) are granted; the SECOND verifier is refused.
  writeConfig(ws, cfgYaml({ max_model_calls_per_24h: "2" }));
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /budget-24h/);
  assert.deepEqual(resumeSteps(ws), ["investigator", "verifier"], "exactly the granted calls were reserved");
  assert.equal(spawn.calls.length, 2, "the refused call was NOT spawned");
  assert.equal(rounds(ws).length, 1, "the round persisted what it did");
  assert.equal(rounds(ws)[0].reservations.mid_round_refusal.cap, 2);
  assert.equal(fs.existsSync(lastRunPath(ws)), false, "a round cut short by the ceiling must NOT consume the interval");
});

test("case (d) — a round that is refused BEFORE any call does not even reserve", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ max_model_calls_per_24h: "0" }));
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /budget-24h/);
  assert.equal(spawn.calls.length, 0);
  assert.equal(fs.existsSync(ledgerPath(ws)), false, "ZERO reservations");
});

// ── (e) the USD ceiling ──────────────────────────────────────────────────────────────────────────────
test("case (e) — the USD cap ⇒ not-evaluated:budget-usd-24h and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ max_usd_per_24h: "30" }));
  // The trailing 24h already realized $40: one granted reservation plus its realized price.
  const nowIso = new Date().toISOString();
  appendLedgerRecords(ledgerPath(ws), [
    { kind: "reserve", id: "seed-1", ts: nowIso, pid: 1, step: "verifier", tools: VERIFIER_TOOLS, max_turns: 8 },
    { kind: "cost", id: "seed-1", ts: nowIso, pid: 1, step: "verifier", cost_usd: 40, cost_source: "gateway-rates" },
  ]);
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /budget-usd-24h/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
  assert.equal(fact.value.budget_usd_24h.used, 40);
  assert.equal(fact.value.budget_usd_24h.priced, 1);
});

test("count-budget declines BEFORE the USD budget when BOTH are at their ceiling (the order is stated, not incidental)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ max_usd_per_24h: "1", max_model_calls_per_24h: "0" }));
  const spawn = countingSpawn();
  const engine = makeEngine();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.match(fact.reason, /budget-24h/);
  assert.doesNotMatch(fact.reason, /budget-usd-24h/);
});

test("usdBudgetUsage — an UNKNOWN price counts as the per-call ceiling, NEVER 0 (with its non-zero control)", () => {
  const now = Date.parse("2026-10-13T00:00:00Z");
  const recs = [
    // (i) a granted reservation with a realized price ⇒ the price is used.
    { kind: "reserve", id: "a", ts: new Date(now - 1000).toISOString() },
    { kind: "cost", id: "a", ts: new Date(now - 500).toISOString(), cost_usd: 0.25, cost_source: "gateway-rates" },
    // (ii) a granted reservation whose price was UNREADABLE ⇒ the ceiling.
    { kind: "reserve", id: "b", ts: new Date(now - 900).toISOString() },
    { kind: "cost", id: "b", ts: new Date(now - 400).toISOString(), cost_usd: null, cost_source: "per-call-ceiling" },
    // (iii) a reservation with NO cost line at all (killed mid-flight) ⇒ STILL spent, at the ceiling.
    { kind: "reserve", id: "c", ts: new Date(now - 800).toISOString() },
    // (iv) a reservation OUTSIDE the trailing window ⇒ not this budget's business.
    { kind: "reserve", id: "old", ts: new Date(now - 25 * 3600 * 1000).toISOString() },
    { kind: "cost", id: "old", ts: new Date(now).toISOString(), cost_usd: 99, cost_source: "gateway-rates" },
  ];
  const u = usdBudgetUsage({ ledgerRecords: recs, nowMs: now, windowMs: 24 * 3600 * 1000, perCallCeiling: PER_CALL_USD_CEILING });
  assert.equal(u.reservations, 3, "the out-of-window reservation is excluded");
  assert.equal(u.priced, 1);
  assert.equal(u.estimated, 2, "the unreadable and the missing price are BOTH estimated");
  assert.equal(u.usd, Math.round((0.25 + 2 * PER_CALL_USD_CEILING) * 1e6) / 1e6);
  assert.notEqual(u.usd, 0.25, "…so the reading is NOT the priced subset alone");
});

// ── (f) every spawned argv carries --max-turns ───────────────────────────────────────────────────────
test("case (f) — every spawned argv carries --max-turns, and a TOOL-LESS step is ONE turn", async () => {
  // The blind arm is not this routine's production default, but the invariant is about the ARGV BUILDER:
  // with no tools there is nothing to iterate on, so the bound is 1 and it is still STATED.
  const built = stepArgv(realHyp.hardenedArgv.bind(null, fakeLaunchArgv), "P", "/repo", { tools: "", maxTurns: 99, model: null });
  assert.equal(built.maxTurns, BLIND_INVESTIGATOR_MAX_TURNS);
  assert.ok(built.argv.includes("--max-turns"));
  assert.equal(built.argv[built.argv.indexOf("--max-turns") + 1], "1", "a tool-less step is exactly ONE turn");
  assert.equal(built.argv[built.argv.indexOf("--tools") + 1], "");

  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  const spawn = countingSpawn();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.ok(spawn.calls.length >= 3, "the round really spawned");
  for (const c of spawn.calls) {
    assert.ok(c.argv.includes("--max-turns"), `every spawned argv carries --max-turns (got ${c.argv.join(" ")})`);
    const n = Number(c.argv[c.argv.indexOf("--max-turns") + 1]);
    assert.ok(Number.isInteger(n) && n >= 1, `--max-turns is a positive integer (got ${c.argv[c.argv.indexOf("--max-turns") + 1]})`);
  }
});

// ── (g) refutation decides confirmation ──────────────────────────────────────────────────────────────
test("case (g) — a cluster the verifier SUPPORTS and the refuter REFUTES is NOT confirmed", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ verdictFor: (ci, o) => (o.promptTemplate === REFUTATION_PROMPT_TEMPLATE ? "refuted" : "supported") });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const clusterRecs = carrierLines(ws).filter((l) => l.kind === "cluster");
  assert.ok(clusterRecs.length > 0, "per-cluster records were appended");
  assert.equal(clusterRecs[0].verifier_verdict, "supported", "the first verifier supported it");
  assert.equal(clusterRecs[0].refutation_verdict, "refuted", "the refuter refuted it");
  assert.equal(clusterRecs[0].confirmed, false, "…so it is NOT confirmed");
  assert.equal(rounds(ws)[0].confirmed.count, 0, "and the round reports 0 confirmed");
  assert.equal(clusterRecs[0].model_value_assessment, undefined, "an unconfirmed cluster gets no value assessment");
});

test("case (g) — the positive control: supported + survived ⇒ confirmed, with a value assessment", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ verdictFor: alwaysSupported });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const clusterRecs = carrierLines(ws).filter((l) => l.kind === "cluster");
  assert.equal(clusterRecs[0].confirmed, true, "supported + survived ⇒ confirmed");
  assert.equal(clusterRecs[0].model_value_assessment.assessed_by, "model", "the value assessment is the MODEL's, never a human rating");
  assert.equal(clusterRecs[0].model_value_assessment.impact, "fixture impact");
  assert.equal(clusterRecs[0].model_value_assessment.fix_outline, "fixture counterexample");
  assert.equal(rounds(ws)[0].confirmed.count, clusterRecs.length);
});

test("case (g) — an UNDETERMINED refutation is NOT a confirmation (fail-closed)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ verdictFor: (ci, o) => (o.promptTemplate === REFUTATION_PROMPT_TEMPLATE ? "undetermined" : "supported") });
  const spawn = countingSpawn();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  const clusterRecs = carrierLines(ws).filter((l) => l.kind === "cluster");
  assert.equal(clusterRecs[0].confirmed, false, "«we could not refute it» is not «it is true»");
});

// ── (h) the manual/resident split ────────────────────────────────────────────────────────────────────
test("case (h) — a MANUAL round leaves routine-last-run.json BYTE-IDENTICAL, a RESIDENT one advances it", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // (i) MANUAL: it really runs, and the durable map is not even created.
  const manualEngine = makeEngine();
  const fact = await runOpenSemanticDiscovery(ws, {
    ...runOpts(ws, { engine: manualEngine }), invokedBy: INVOKED_BY_MANUAL, spawnFn: countingSpawn(), pinFn: pinStub(),
  });
  assert.equal(fact.state, "verified", "the manual round really ran (so the file claim below is not vacuous)");
  assert.equal(fact.value.invoked_by, "manual");
  assert.equal(fs.existsSync(lastRunPath(ws)), false, "a manual round never creates/advances the production last-run");
  // (ii) RESIDENT: same inputs, and now the entry exists AND carries the writer's stamp.
  const residentEngine = makeEngine();
  const fact2 = await runOpenSemanticDiscovery(ws, {
    ...runOpts(ws, { engine: residentEngine }), invokedBy: INVOKED_BY_RESIDENT, force: true, spawnFn: countingSpawn(), pinFn: pinStub(),
  });
  assert.equal(fact2.state, "verified");
  const map = readLastRunMap(lastRunPath(ws));
  assert.equal(typeof map[OPEN_SEMANTIC_DISCOVERY_NAME], "number", "the resident round advanced the production entry");
  assert.equal(map[`${OPEN_SEMANTIC_DISCOVERY_NAME}@invoked_by`], "resident-driver", "…in the SAME write as its own identity stamp");
});

test("case (h) — the carrier line names its caller, so a production round is distinguishable on the record", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine() }), invokedBy: INVOKED_BY_MANUAL, spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(rounds(ws)[0].invoked_by, "manual");
});

// ── (i) report-only, structurally ────────────────────────────────────────────────────────────────────
test("case (i) — after a full round nothing under tasks/ or goals/ changed, and the source carries no authoring symbol and no rating verb", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const before = (d) => fs.readdirSync(path.join(ws, d)).sort().join(",");
  const t0 = before("tasks");
  const g0 = before("goals");
  const engine = makeEngine();
  const spawn = countingSpawn();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(before("tasks"), t0, "tasks/ is untouched — the routine files nothing");
  assert.equal(before("goals"), g0, "goals/ is untouched — the routine writes no Goal");
  // ⛔ THE INGESTION IS EXPECTED NOW (this task added it): the TWO ledgers ARE written, and saying so here
  // is what keeps "nothing was written" from silently covering for "the ingestion did not run".
  const confirmedClusters = carrierLines(ws).filter((l) => l.kind === "cluster" && l.confirmed === true);
  assert.ok(confirmedClusters.length > 0, "the fixture really produced confirmed clusters");
  assert.equal(portfolioRecords(ws).length, confirmedClusters.length, "every confirmed, novel cluster produced ONE Portfolio row");
  assert.equal(experienceRecords(ws).length, confirmedClusters.length, "…and ONE Experience");

  // The STATIC control: judged BY POSITION on the real source text (硬规则 2) — the routine names none of
  // the filing/authoring symbols, and none of the portfolio module's HUMAN-ONLY rating verb.
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  const FORBIDDEN = /selectFilings|fileRoutineTask|driveItems|task_write|goal_write|writeTask|writeGoal|lifecycle_promote|lifecycle_retreat|lifecycle_complete|rateFinding/;
  assert.doesNotMatch(src, FORBIDDEN, "open-semantic-discovery-routine.ts must name no filing/authoring symbol and no rating verb");
  // A non-zero control on the SAME predicate: it CAN fire, so the zero above is a real zero.
  assert.match(src, /appendCarrierRecords/, "the predicate finds a token that IS present in this file");
  for (const injected of ["writeTask", "rateFinding"]) {
    const mutated = `${src}\nimport { ${injected} } from "./nowhere.ts";\n`;
    assert.match(mutated, FORBIDDEN, `the mutation with ${injected} must turn the same predicate red`);
  }
  // …and the interface the routine holds the portfolio module to does not even DECLARE the rating verb, so
  // the absence is a compile-time fact rather than a comment (named here without spelling the symbol).
  assert.doesNotMatch(src, /^\s{2}rate[A-Z]\w*:/m, "the PortfolioModule interface carries no rating member");
});

test("case (i) — the engine is resolved at runtime: NO static out-of-artifact import (with mutation control)", () => {
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  const STATIC_ENGINE_IMPORT = /(?:^|\n)\s*(?:import|export)[^;\n]*from\s*["'][^"']*docs\/analysis\/[^"']*["']/;
  assert.doesNotMatch(src, STATIC_ENGINE_IMPORT, "no static import may reach docs/analysis from this shipped file");
  const mutated = `${src}\nimport { x } from "../../docs/analysis/arch-hypothesis-generation.mjs";\n`;
  assert.match(mutated, STATIC_ENGINE_IMPORT, "the mutation must turn the same predicate red");
  assert.match(src, /await import\(\/\* @vite-ignore \*\/ pathToFileURL\(/, "the loader must import a RESOLVED path, so the bundler cannot see a specifier to inline");
});

// ── (j) the investigator reads real source, rooted at the pin ────────────────────────────────────────
test("case (j) — the investigator argv carries Read,Grep,Glob + --max-turns, and its cwd IS the pin", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  const spawn = countingSpawn();
  const pin = pinStub();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pin });
  const pinDir = pin.pins[0];
  assert.ok(typeof pinDir === "string" && pinDir.length > 0, "a pin was materialised");
  const inv = engine.investigatorCalls[0];
  assert.equal(inv.cwd, pinDir, "the investigator's cwd IS the stripped pin");
  assert.equal(inv.pinDir, pinDir, "…and it is declared as the pin, not as a neutral dir");
  assert.equal(inv.tools, INVESTIGATOR_TOOLS);
  assert.equal(inv.tools, "Read,Grep,Glob", "the investigator may read source and search it");
  assert.equal(inv.maxTurns, DEFAULT_INVESTIGATOR_MAX_TURNS);
  const first = spawn.calls[0];
  assert.equal(first.opts.cwd, pinDir, "the SPAWNED subprocess is rooted at the pin (not the driver's cwd)");
  assert.equal(first.argv[first.argv.indexOf("--tools") + 1], "Read,Grep,Glob");
  assert.equal(first.argv[first.argv.indexOf("--max-turns") + 1], String(DEFAULT_INVESTIGATOR_MAX_TURNS));
  assert.ok(first.argv.includes("--output-format") && first.argv[first.argv.indexOf("--output-format") + 1] === "stream-json", "the stream is what makes the per-call reading possible");
  // The verifier/refuter are the bounded READ,GREP envelope — a DIFFERENT one from the investigator's.
  const verifierSpawn = spawn.calls[1];
  assert.equal(verifierSpawn.argv[verifierSpawn.argv.indexOf("--tools") + 1], VERIFIER_TOOLS);
  assert.equal(verifierSpawn.opts.cwd, pinDir);
});

test("case (j) — the model states its OWN focus, and it is persisted and handed back to the next round", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(rounds(ws)[0].focus.chosen, "fixture focus on the carrier helpers", "the focus the MODEL stated is on the record");
  // The prompt is the ROUND'S COMPOSITION: the routine's own directive (which asks for the focus) prepended
  // to the engine's frozen instruction — the frozen file itself is never edited.
  assert.match(engine.investigatorCalls[0].prompt, new RegExp(FOCUS_MARKER.replace(":", "\\:")), "the directive asking for a stated focus is in the prompt");
  assert.match(engine.investigatorCalls[0].prompt, /Use Read\/Grep\/Glob to read real source/, "…together with the source-reading instruction");
  assert.match(engine.investigatorCalls[0].prompt, /You are an architecture investigator/, "…and the engine's own frozen instruction, unmodified");
  // Round 2 reads round 1's focus back and offers it as history — the CHOICE stays the model's.
  const engine2 = makeEngine();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: engine2 }), force: true, spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.deepEqual(rounds(ws)[1].focus.prior_focuses, ["fixture focus on the carrier helpers"]);
  assert.match(engine2.investigatorCalls[0].prompt, /chooses to go ELSEWHERE|choose to go ELSEWHERE/, "the history is offered, never imposed");
});

test("focusFromText / priorFocuses — the protocol marker is read by POSITION, and an unstated focus stays null", () => {
  assert.equal(focusFromText(`noise\n${FOCUS_MARKER} the real focus\nmore`), "the real focus");
  assert.equal(focusFromText(`a\n${FOCUS_MARKER} first\nb\n${FOCUS_MARKER} second`), "second", "the LATEST statement wins");
  assert.equal(focusFromText("no marker here"), null, "an unstated focus is null, never an invented string");
  assert.equal(focusFromText(`${FOCUS_MARKER}   `), null, "a marker with nothing after it is not a focus");
  const recs = [
    { kind: "scan-round", focus: { chosen: "one" } },
    { kind: "cluster" },
    { kind: "scan-round", focus: { chosen: "two" } },
    { kind: "scan-round", focus: { chosen: null } },
  ];
  assert.deepEqual(priorFocuses(recs), ["one", "two"], "chronological, and a null focus contributes nothing");
});

// ── (k) nothing mechanical suppresses the semantic round ─────────────────────────────────────────────
test("case (k) — the round runs when the PIN IS UNCHANGED since the last round", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const rev = () => spawnSync("git", ["-C", ws, "rev-parse", "HEAD"], { encoding: "utf8", env: GIT_ENV }).stdout.trim();
  const fixedRev = rev();
  const spawn1 = countingSpawn();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine() }), revFn: () => fixedRev, spawnFn: spawn1, pinFn: pinStub() });
  const spawn2 = countingSpawn();
  const fact2 = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine() }), revFn: () => fixedRev, force: true, spawnFn: spawn2, pinFn: pinStub() });
  assert.equal(spawn1.calls.length > 0, true, "round 1 ran");
  assert.equal(fact2.state, "verified", "round 2 ran too");
  // ⛔ The comparison is over the SEMANTIC steps. Round 2 also carries one FEWER call than round 1, and
  // the difference is NOT the pin: round 2's cluster is a byte-identical repeat of round 1's own record, so
  // its novelty call is skipped by the declared mechanical-dedup exception. Asserting the totals would
  // have made this case red for a reason that has nothing to do with what it tests.
  const semanticCalls = (s) => s.calls.filter((c) => !isNoveltyPrompt(c.opts)).length;
  assert.equal(semanticCalls(spawn2), semanticCalls(spawn1), "…with the SAME number of SEMANTIC calls: an unchanged pin suppresses nothing");
  assert.equal(spawn1.noveltyCalls().length, 2, "round 1 checked both clusters for novelty");
  assert.equal(spawn2.noveltyCalls().length, 0, "…while round 2's identical clusters were deduped mechanically, not by the pin");
  assert.equal(rounds(ws).length, 2, "two scan-round lines");
  assert.equal(rounds(ws)[0].pin.rev, rounds(ws)[1].pin.rev);
});

test("case (k) — arch-discovery's carrier is READ for novelty RETRIEVAL ONLY and gates nothing", async () => {
  // The claim is narrower than it used to be, and it is stated as what it now is: the post-round novelty
  // retrieval does look in that carrier, and its `new: 0` reading STILL suppresses no round.
  const withCarrier = makeWorkspace();
  writeConfig(withCarrier, cfgYaml());
  fs.writeFileSync(path.join(withCarrier, ".quay", "arch-discovery-findings.jsonl"),
    JSON.stringify({ kind: "scan-round", ts: new Date().toISOString(), new: 0, repeated: 7, gone: 0 }) + "\n", "utf8");
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(withCarrier, { ...runOpts(withCarrier, { engine: makeEngine() }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", "0 new fingerprints from ANOTHER routine suppresses nothing here");
  assert.ok(spawn.calls.length >= 4, "the semantic round really ran");
  const retrieval = rounds(withCarrier)[0].ingestion.outcomes[0].retrieval;
  assert.equal(retrieval.totals.arch_discovery, 1, "…and the carrier WAS read — for retrieval, not as a gate");
  assert.deepEqual(retrieval.errors, [], "no retrieval source failed");
  // The other half of the same claim, and the one that makes "read" falsifiable: with the carrier ABSENT
  // the round STILL runs, and the retrieval reports the absence by NAME rather than as zero matches.
  const withoutCarrier = makeWorkspace();
  writeConfig(withoutCarrier, cfgYaml());
  const spawn2 = countingSpawn();
  const fact2 = await runOpenSemanticDiscovery(withoutCarrier, { ...runOpts(withoutCarrier, { engine: makeEngine() }), spawnFn: spawn2, pinFn: pinStub() });
  assert.equal(fact2.state, "verified", "an absent carrier suppresses nothing either");
  const retrieval2 = rounds(withoutCarrier)[0].ingestion.outcomes[0].retrieval;
  assert.equal(retrieval2.totals.arch_discovery, 0);
  assert.ok(retrieval2.absent.includes(ARCH_DISCOVERY_CARRIER_REL), `the absence is NAMED, never counted as 0 matches (got ${JSON.stringify(retrieval2.absent)})`);
  assert.deepEqual(retrieval2.errors, [], "…and an absent carrier is a real zero, not a failure to look");
});

test("case (k) — the round runs when the INVENTORY is missing (recorded as such, never as a gate)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine() }), spawnFn: spawn, pinFn: pinStub({ withScope: false }) });
  assert.equal(fact.state, "verified", "an unbuildable inventory suppresses nothing");
  assert.ok(spawn.calls.length >= 3, "the semantic round really ran");
  const line = rounds(ws)[0];
  assert.equal(line.inventory.ok, false, "…and the carrier says the inventory was unavailable");
  assert.match(String(line.inventory.unavailable), /INVENTORY_UNAVAILABLE/);
});

test("case (k) — the round runs when the inventory is EMPTY (0 entries in scope)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const pin = ({ dir }) => { fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true }); return { ok: true, dir }; };
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine() }), spawnFn: countingSpawn(), pinFn: pin });
  assert.equal(fact.state, "verified");
  assert.equal(rounds(ws)[0].inventory.entries, 0);
  assert.equal(rounds(ws)[0].inventory.unavailable, "NO_FILES_IN_SCOPE");
});

// ── (l) no problem-class pattern table ───────────────────────────────────────────────────────────────
test("case (l) — the module selects/rejects hypotheses by NO pattern table and NO regular expression", () => {
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  // WHAT THIS SCANS FOR (stated, per the AC): any construct that a pattern table or a classifier would
  // have to be BUILT from — a constructed RegExp, or the match/test/exec trio a table of patterns is
  // consumed by. Comment/string positions are included on purpose: naming such a thing is enough of a
  // smell that a maintainer must come here and say why.
  const PATTERN_MACHINERY = /new\s+RegExp|\.match\(|\.test\(|\.exec\(/;
  assert.doesNotMatch(src, PATTERN_MACHINERY, "open-semantic-discovery-routine.ts must carry no pattern machinery");
  // ⛔ NON-ZERO CONTROL ON THE SAME PREDICATE, against a REAL sample known to contain such machinery: the
  // engine it loads. Without this, the zero above proves only that the regex compiles (硬规则 2).
  const engineSrc = fs.readFileSync(path.join(REPO_ROOT, "docs", "analysis", HYPOTHESIS_MODULE_FILE), "utf8");
  assert.match(engineSrc, PATTERN_MACHINERY, "the predicate CAN fire — the engine file it loads matches it");
  // The ONE pattern-shaped thing in this file is a PROTOCOL MARKER, and it is named as such; it selects and
  // rejects nothing.
  assert.match(src, /FOCUS_MARKER/, "the only marker in the file is the focus protocol tag");
  // Dedup ASSISTANCE is allowed, and is the engine's own clustering — not a second, local filter.
  assert.match(src, /clusterHypotheses/, "dedup assistance is the engine's clusterHypotheses, named");
  assert.match(src, /dedup ASSISTANCE ONLY/, "…and the source says what its role is");
  // The mutation control: injecting a pattern table turns the SAME predicate red.
  const mutated = `${src}\nconst PROBLEM_CLASSES = [/duplicat/i];\nif (PROBLEM_CLASSES[0].test(claim)) reject();\n`;
  assert.match(mutated, PATTERN_MACHINERY, "the mutation must turn the same predicate red");
});

// ── the pin ──────────────────────────────────────────────────────────────────────────────────────────
test("materializeStrippedPin — really archives the rev and really STRIPS the forbidden directories", () => {
  const ws = makeWorkspace();
  // The fixture repo carries two forbidden directories and one directory that must survive.
  fs.mkdirSync(path.join(ws, "docs"), { recursive: true });
  fs.writeFileSync(path.join(ws, "docs", "note.md"), "methodology notes\n", "utf8");
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(ws, "tasks", "t.md"), "a task\n", "utf8");
  fs.mkdirSync(path.join(ws, "packages"), { recursive: true });
  fs.writeFileSync(path.join(ws, "packages", "p.js"), "export const p = 1;\n", "utf8");
  spawnSync("git", ["-C", ws, "add", "-A"], { encoding: "utf8", env: GIT_ENV });
  spawnSync("git", ["-C", ws, "commit", "-qm", "content"], { encoding: "utf8", env: GIT_ENV });
  const rev = spawnSync("git", ["-C", ws, "rev-parse", "HEAD"], { encoding: "utf8", env: GIT_ENV }).stdout.trim();
  const dir = path.join(tmpDir("osd-pin-"), "tree");
  const r = materializeStrippedPin({
    root: ws, rev, dir,
    forbiddenDirs: realHyp.PIN_FORBIDDEN_DIRS,
    stripCheck: (d) => realHyp.verifyCwdRefusal(d, d),
  });
  assert.equal(r.ok, true, `the pin materialised (${r.reason ?? ""})`);
  assert.equal(fs.existsSync(path.join(dir, "docs")), false, "docs/ is STRIPPED");
  assert.equal(fs.existsSync(path.join(dir, "tasks")), false, "tasks/ is STRIPPED");
  assert.equal(fs.existsSync(path.join(dir, "packages", "p.js")), true, "the CODE survives the strip");
  // ⛔ The strip is CHECKED, not asserted: hand the materialiser a forbidden list that does NOT name
  // `docs`, and the tree it produces still carries it ⇒ the check refuses and NAMES it. Without this the
  // assertion above would only prove that `rmSync` was called.
  const dirty = path.join(tmpDir("osd-pin-dirty-"), "tree");
  const refused = materializeStrippedPin({ root: ws, rev, dir: dirty, forbiddenDirs: ["goals"], stripCheck: (d) => realHyp.verifyCwdRefusal(d, d) });
  assert.equal(refused.ok, false, `an unstripped tree must be REFUSED (got ${JSON.stringify(refused)})`);
  assert.match(refused.reason, /PIN_NOT_STRIPPED/);
  assert.match(refused.reason, /docs/, "the refusal NAMES the directory that is still there");
});

// ── engine resolution ────────────────────────────────────────────────────────────────────────────────
test("resolveEngineModule / loadOpenDiscoveryModules — resolved from DISK, and an unresolvable one is NAMED", async () => {
  const r = resolveEngineModule(REPO_ROOT, HYPOTHESIS_MODULE_FILE);
  assert.equal(r.path, path.join(REPO_ROOT, ANALYSIS_DIR_REL, HYPOTHESIS_MODULE_FILE));
  const missing = resolveEngineModule(tmpDir("osd-nomods-"), "nope.mjs");
  assert.equal(missing.path, null);
  assert.equal(missing.tried.length, 2, "the refusal can name BOTH candidates it tried");
  const mods = await loadOpenDiscoveryModules(REPO_ROOT);
  assert.equal(typeof mods.hyp.runInvestigator, "function");
  assert.equal(typeof mods.portfolio.deriveCost, "function");
  // ⛔ Candidate 1 is the SCRIPT'S OWN repo — that is what lets a worktree whose workspace root has no
  // engine still run. A bare temp root therefore still RESOLVES (to the script's own copy), and the
  // reverse (a workspace-vendored copy) is candidate 2. Both are exercised; neither is a silent zero.
  const fromElsewhere = await loadOpenDiscoveryModules(tmpDir("osd-nomods2-"));
  assert.equal(fromElsewhere.hyp.TOOL, "arch-hypothesis-generation");
});

// ── the routine table ────────────────────────────────────────────────────────────────────────────────
test("RoutineSpec — buildOpenSemanticDiscoveryRoutine wires config + ctx.halted, and is resident BY CONSTRUCTION", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  const read = readOpenSemanticDiscoveryConfig(ws);
  const spec = buildOpenSemanticDiscoveryRoutine(ws, read, { modules: engine.modules, launchArgvFn: fakeLaunchArgv, spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(spec.name, OPEN_SEMANTIC_DISCOVERY_NAME);
  assert.deepEqual(spec.schedule, { kind: "interval", minutes: 60 });
  const facts = await spec.run({ halted: true });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].state, "not-evaluated");
  assert.match(facts[0].reason, /halted/);
  assert.equal(facts[0].value.invoked_by, "resident-driver", "the routine table's rounds ARE production's");
});

test("openSemanticDiscoveryRoutineFromConfig — off by default; a declared section is always OBSERVABLE", () => {
  const absentWs = makeWorkspace();
  writeConfig(absentWs, "loop:\n  board: native\n");
  const absent = openSemanticDiscoveryRoutineFromConfig(absentWs);
  assert.equal(absent.routine, null, "no section ⇒ the host's routine set is unchanged");
  assert.equal(absent.present, false);
  assert.equal(absent.error, null);

  const disabledWs = makeWorkspace();
  writeConfig(disabledWs, cfgYaml({ enabled: "false" }));
  const disabled = openSemanticDiscoveryRoutineFromConfig(disabledWs);
  assert.notEqual(disabled.routine, null, "declared-but-disabled is still assembled (it must be observable)");
  assert.equal(disabled.enabled, false);

  const enabledWs = makeWorkspace();
  writeConfig(enabledWs, cfgYaml());
  const enabled = openSemanticDiscoveryRoutineFromConfig(enabledWs);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.intervalMinutes, 60);
  assert.equal(enabled.maxModelCallsPer24h, 120);
  assert.equal(enabled.maxUsdPer24h, 30);
  assert.equal(enabled.investigatorRuns, 1);
  assert.equal(enabled.maxClustersVerified, 3);
  assert.equal(enabled.verifierMaxTurns, 8);
  assert.equal(enabled.refutationMaxTurns, 6);
});

test("qualityGateRoutines — the open-semantic-discovery routine joins the table ONLY when it is passed in", () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const base = {
    root: ws, now: () => Date.now(), halted: () => false,
  };
  const without = qualityGateRoutines(ws, { ...base });
  const spec = buildOpenSemanticDiscoveryRoutine(ws, readOpenSemanticDiscoveryConfig(ws), {});
  const withIt = qualityGateRoutines(ws, { ...base, openSemanticDiscoveryRoutine: spec });
  assert.equal(withIt.length, without.length + 1);
  assert.equal(withIt.map((r) => r.name).includes(OPEN_SEMANTIC_DISCOVERY_NAME), true);
  assert.equal(without.map((r) => r.name).includes(OPEN_SEMANTIC_DISCOVERY_NAME), false, "off by default");
});

// ── the REAL engine end-to-end (only the subprocess spawn is stubbed) ────────────────────────────────
test("INTEGRATION — the REAL runInvestigator + runVerifier accept this routine's arguments, pin gate and all", async () => {
  // The unit cases above replace the RUNNERS with stubs; this one replaces only the SPAWN, so the real
  // `runInvestigator` (pinned cwd policy), the real `clusterHypotheses`, and the real `runVerifier`
  // (frozen prompt template, `{{HYP}}` substitution, stream parsing) all execute for real. It is the case
  // that would catch "the routine passes the engine an options object it does not accept".
  const HYP_JSON = JSON.stringify([{
    id: "H1", components: ["a.ts", "b.ts"], concept_kind: "duplication", claim: "a.ts and b.ts duplicate one rule",
    why_suspected: "both name the same concept", evidence_needed: ["read both"], counterexample_requirement: "they differ intentionally",
    confidence: "high",
  }]);
  const VERDICT_JSON = JSON.stringify({ verdict: "supported", intentional_difference_found: "they drift", evidence: ["a.ts:1 — x"], counterexample: "none", summary: "drift" });
  const spawn = countingSpawn((argv) => {
    const prompt = argv.includes("--tools") && argv[argv.indexOf("--tools") + 1] === INVESTIGATOR_TOOLS;
    return { status: 0, stdout: streamText(prompt ? `${FOCUS_MARKER} real-engine smoke focus\n${HYP_JSON}` : VERDICT_JSON), stderr: "", error: null };
  });
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const mods = await loadOpenDiscoveryModules(REPO_ROOT);
  const pin = pinStub();
  const fact = await runOpenSemanticDiscovery(ws, {
    config: readOpenSemanticDiscoveryConfig(ws).config, configPresent: true, configError: null, halted: false,
    invokedBy: INVOKED_BY_RESIDENT, modules: mods, launchArgvFn: fakeLaunchArgv, spawnFn: spawn, pinFn: pin,
  });
  assert.equal(fact.state, "verified", fact.reason);
  const line = rounds(ws)[0];
  assert.equal(line.investigator.runs_with_hypotheses, 1, "the REAL parser read the hypothesis array out of the stream");
  assert.equal(line.clusters.total, 1, "the REAL clusterHypotheses clustered it");
  assert.equal(line.focus.chosen, "real-engine smoke focus", "the REAL call text carried the stated focus");
  const rec = carrierLines(ws).find((l) => l.kind === "cluster");
  assert.equal(rec.verifier_verdict, "supported", "the REAL verifierVerdict parsed the stream's verdict");
  assert.equal(rec.confirmed, true);
  assert.equal(rec.refutation_verdict, "supported");
  // Every spawn really was rooted at the pin and really carried the per-step tool envelope.
  assert.deepEqual([...new Set(spawn.calls.map((c) => c.opts.cwd))], [pin.pins[0]]);
  assert.equal(spawn.calls[0].argv[spawn.calls[0].argv.indexOf("--tools") + 1], INVESTIGATOR_TOOLS);
  assert.equal(spawn.calls[1].argv[spawn.calls[1].argv.indexOf("--tools") + 1], VERIFIER_TOOLS);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// THE POST-ROUND INGESTION (task gap-open-discovery-findings-into-portfolio-experience)
//   (a) a confirmed cluster duplicating an existing Portfolio finding ⇒ duplicate_of set, not net-new
//   (b) a novel cluster ⇒ Experience + Portfolio, production-open, a RESOLVABLE origin_ref
//   (c) a cluster the refuter refuted ⇒ never ingested as supported
//   (d) the same cluster in two rounds ⇒ ONE Portfolio record
//   (f) no mechanical candidate ⇒ the semantic novelty call STILL happens, and is not auto-labelled novel
//   (g) refuted and undetermined clusters ⇒ Experiences with their reasoning, never Portfolio-supported
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/** A spawn delegate that answers the NOVELTY call with a chosen verdict and answers everything else with
 *  the ordinary fixture stream. */
function noveltyDelegate({ verdict, duplicateOf = null }) {
  return (argv, opts) => {
    if (!isNoveltyPrompt(opts)) return defaultDelegate(argv, opts);
    return {
      status: 0, stderr: "", error: null,
      stdout: streamText(JSON.stringify({
        verdict, duplicate_of: duplicateOf,
        reasoning: `fixture reasoning: the novelty check returned ${verdict}`,
        summary: `fixture novelty summary: ${verdict}`,
      })),
    };
  };
}

/** The cluster identity (claim + components) ONE hypothesis really produces — read off a REAL round in a
 *  throwaway workspace rather than predicted, so the seed the duplicate rule is judged against is the
 *  engine's own output. */
async function clusterIdentity(hyps = [HYPS[0]]) {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  return clusterIdentityOf(ws, makeEngine({ hyps }), countingSpawn());
}

/** Put ONE task on `develop` in the fixture, carrying a `## Touches` list — the shape the novelty
 *  retrieval's task arm reads (`taskTouchesOnBranch`, via `git show <branch>:tasks/<id>.md`). */
function addTaskOnDevelop(ws, id, { touches = [] } = {}) {
  const body = `---\nid: ${id}\ntitle: "fixture task ${id}"\nstatus: done\n---\n## Touches\n${touches.map((t) => `- ${t}`).join("\n")}\n`;
  fs.writeFileSync(path.join(ws, "tasks", `${id}.md`), body, "utf8");
  spawnSync("git", ["-C", ws, "add", "-A"], { encoding: "utf8", env: GIT_ENV });
  spawnSync("git", ["-C", ws, "commit", "-qm", `fixture task ${id}`, "--no-verify"], { encoding: "utf8", env: GIT_ENV });
  return id;
}

/** Scenario (a)/(d)-shared: a confirmed cluster that DUPLICATES a Portfolio finding already recorded.
 *  Returns the observable the case asserts on, so the negative control can run the SAME scenario against
 *  a mutated module and show the claim goes red. */
async function scenarioDuplicateAgainstExistingPortfolio(runFn) {
  const id = await clusterIdentity();
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const seeded = seedKnownFinding(ws, { claim: id.claim, components: id.components });
  const beforeRows = portfolioRecords(ws);
  const engine = makeEngine({ hyps: [HYPS[0]] });
  const spawn = countingSpawn(noveltyDelegate({ verdict: "duplicate", duplicateOf: seeded }));
  const fact = await runFn(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  const rows = portfolioRecords(ws);
  return {
    ws, fact, seeded, rows, before: realPortfolio.valueMetrics(beforeRows), after: realPortfolio.valueMetrics(rows),
    ours: rows.filter((r) => r.finding_id !== seeded),
    cluster: carrierLines(ws).find((l) => l.kind === "cluster"),
    outcome: rounds(ws)[0].ingestion.outcomes[0],
    spawn,
  };
}

/** Scenario (d)-shared: the SAME cluster observed by two rounds. Round 2 runs at a LATER instant — rounds
 *  really are minutes apart, and `record_id` is keyed on the round's own `ts`, so a same-millisecond
 *  second round would be an artefact of the test rather than of the mechanism. */
async function scenarioSameClusterTwoRounds(runFn) {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const spawn1 = countingSpawn();
  await runFn(ws, { ...runOpts(ws, { engine: makeEngine({ hyps: [HYPS[0]] }) }), spawnFn: spawn1, pinFn: pinStub() });
  const later = Date.now() + 600_000;
  const spawn2 = countingSpawn();
  await runFn(ws, { ...runOpts(ws, { engine: makeEngine({ hyps: [HYPS[0]] }) }), force: true, now: () => later, spawnFn: spawn2, pinFn: pinStub() });
  const clusters = carrierLines(ws).filter((l) => l.kind === "cluster");
  return {
    ws, rows: portfolioRecords(ws), experiences: experienceRecords(ws),
    roundsSeen: rounds(ws), spawn2, clusters,
    second: rounds(ws)[1].ingestion.outcomes[0],
  };
}

// ── (a) a duplicate of an existing Portfolio finding ─────────────────────────────────────────────────
test("ingestion (a) — a confirmed cluster that duplicates an existing Portfolio finding is NOT net-new", async () => {
  const s = await scenarioDuplicateAgainstExistingPortfolio(runOpenSemanticDiscovery);
  assert.equal(s.fact.state, "verified", s.fact.reason);
  assert.equal(s.ours.length, 1, "the round wrote exactly one NEW Portfolio row");
  assert.equal(s.ours[0].duplicate_of, s.seeded, "…and it names the finding it duplicates");
  assert.equal(s.ours[0].outcome, "supported", "the claim HELD — what is denied is newness, not truth");
  const z = s.after.zero_or_negative;
  assert.ok(z.duplicates.includes(s.ours[0].finding_id), "the row is counted as a DUPLICATE");
  assert.equal(z.supported_but_not_landed.includes(s.ours[0].finding_id), false, "…and NOT as a fresh supported finding");
  // ⛔ WHAT THE SEMANTIC CHECK UNIQUELY CONTRIBUTES HERE, stated because it is the part a reader would
  // otherwise over-credit: `ingestFinding` has its OWN duplicate rule over the Portfolio, so for THIS
  // shape (a duplicate of a Portfolio row) the `duplicate_of` above survives even with the novelty check
  // disabled. What does NOT survive is the verdict the carrier records and the role the Experience takes:
  assert.equal(s.outcome.disposition, "duplicate", "the round RECORDS the semantic verdict it acted on");
  assert.equal(s.outcome.reasoning, "fixture reasoning: the novelty check returned duplicate");
  assert.equal(experienceRecords(s.ws)[0].role, "duplicate", "…and the Experience carries the matching role");
  // ⛔ `net_new_value` does not move. It is stated WITH its reason: `net_new_value` also requires a LANDED
  // fix, which neither the seed nor a fresh routine row has — so the DISCRIMINATOR here is `duplicate_of`
  // (above), not the count. The count is asserted anyway because the AC names it.
  assert.equal(s.after.net_new_value.total, s.before.net_new_value.total, "net_new_value did not grow");
  assert.equal(s.after.net_new_value.total, 0, "(the fixture lands no fix, so nothing is net-new VALUE either way)");
  assert.equal(s.after.context.supported, s.before.context.supported + 1, "…while the SUPPORTED count DID grow: the exclusion is the duplicate rule, not the count");
  // The negative control on the same predicate: forcing `duplicate_of` to null moves the row OUT of
  // `duplicates` — so the membership above is a real reading, not a tautology.
  const forced = realPortfolio.valueMetrics(s.rows.map((r) => (r.finding_id === s.ours[0].finding_id ? { ...r, duplicate_of: null } : r)));
  assert.equal(forced.zero_or_negative.duplicates.includes(s.ours[0].finding_id), false, "the predicate CAN say «not a duplicate»");
});

test("ingestion (a2) — a duplicate ONLY the semantic check can see (a task Touches overlap) is caught, and its target RESOLVES", async () => {
  // The Portfolio's mechanical rule cannot see this one: the known record is a TASK on develop, not a
  // Portfolio row. Plan 1 names exactly this retrieval ("task bodies and Touches on develop"), so the
  // finding is only deduplicated because the model was shown the task and named it.
  const id = await clusterIdentity();
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const taskId = addTaskOnDevelop(ws, "gap-fixture-known-thing", { touches: id.components });
  const engine = makeEngine({ hyps: [HYPS[0]] });
  const spawn = countingSpawn(noveltyDelegate({ verdict: "duplicate", duplicateOf: taskId }));
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", fact.reason);
  const outcome = rounds(ws)[0].ingestion.outcomes[0];
  // The retrieval really offered the task, and marked it usable as a `duplicate_of` target.
  const prompt = String(spawn.noveltyCalls()[0].opts.stdinData);
  assert.match(prompt, new RegExp(taskId), "the task Touches hit is IN the candidate list the model saw");
  assert.match(prompt, /"basis": "touches-overlap"/);
  assert.equal(outcome.disposition, "duplicate");
  assert.equal(outcome.duplicate_of, taskId);
  const rows = portfolioRecords(ws);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].duplicate_of, taskId, "the Portfolio row's duplicate_of names the TASK — and it resolved, or ingest would have refused");
  assert.equal(rows[0].duplicate_of, taskId, "…");
  assert.equal(experienceRecords(ws)[0].role, "duplicate");
});

// ── (b) a novel cluster ──────────────────────────────────────────────────────────────────────────────
test("ingestion (b) — a novel cluster ⇒ an Experience AND a Portfolio row, production-open, origin_ref resolvable", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ hyps: [HYPS[0]] });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", fact.reason);

  const cluster = carrierLines(ws).find((l) => l.kind === "cluster");
  assert.equal(cluster.confirmed, true);
  const rows = portfolioRecords(ws);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.origin, "autonomous-routine");
  assert.equal(row.evidence_level, "production-open");
  assert.equal(row.outcome, "supported");
  assert.equal(row.fix_task, null, "the routine files no fix — that stays the operator's decision");
  assert.equal(row.human_rating, null, "and it emits no human rating");
  assert.equal(row.duplicate_of, null);
  assert.equal(row.origin_ref, cluster.record_id, "the row is keyed on the CARRIER RECORD's own id");
  assert.equal(row.origin_carrier, CARRIER_REL);
  // ⛔ THE RESOLVABILITY CLAIM, checked through the portfolio module's OWN resolver — this is also the
  // anti-drift check for the ref prefix the two modules each declare: if they disagreed, this goes red.
  const resolved = realPortfolio.resolveOriginRef(ws, { origin: "autonomous-routine", origin_ref: cluster.record_id });
  assert.equal(resolved.ok, true, `origin_ref must RESOLVE (got ${resolved.reason})`);
  assert.equal(resolved.carrier, CARRIER_REL);
  assert.deepEqual(resolved.components, realPortfolio.normalizeComponents(cluster.components));

  const exps = experienceRecords(ws);
  assert.equal(exps.length, 1);
  const exp = exps[0];
  assert.equal(exp.reported_by, "system");
  assert.equal(exp.role, "found-unresolved", "a supported claim with no fix recorded");
  assert.equal(exp.evidence_level, "production-open");
  assert.equal(exp.source_ref, cluster.record_id, "carrier record → Experience, by the record's own id");
  assert.equal(exp.case_id, `EXP-${cluster.record_id}`);
  assert.equal(exp.authored_by.actor, "ingester");
  assert.equal(exp.authored_by.ref, OPEN_SEMANTIC_DISCOVERY_NAME, "the ingesting process names ITSELF");
  // …and the evidence digest is of the carrier LINE's bytes, so the projection can be re-checked. The line
  // is located by PARSING (the scan-round line also mentions the id — in its own ingestion block — so a
  // substring search would hash the wrong bytes and the check would be vacuous).
  const rawLine = fs.readFileSync(carrierPath(ws), "utf8").split("\n")
    .find((l) => { try { return JSON.parse(l).record_id === cluster.record_id; } catch { return false; } });
  assert.ok(rawLine, "the cluster's own line is on the carrier");
  assert.equal(exp.evidence[0].ref, cluster.record_id);
  assert.equal(exp.evidence[0].sha256, createHash("sha256").update(rawLine).digest("hex"), "the evidence is content-addressed over the line that is really on disk");
  // The chain resolves BOTH ways: Portfolio → carrier (above) and carrier → Portfolio/Experience (here).
  assert.equal(exp.source_ref, row.origin_ref, "Experience and Portfolio address the SAME carrier record");
  const ing = carrierLines(ws).find((l) => l.kind === "ingestion");
  assert.equal(ing.writes[0].experience.written, true);
  assert.equal(ing.writes[0].portfolio.written, true);
});

// ── (c) a refuted cluster is never ingested as supported ─────────────────────────────────────────────
test("ingestion (c) — a cluster refuted by the routine's refuter is NEVER ingested as supported", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ hyps: [HYPS[0]], verdictFor: (ci, o) => (o.promptTemplate === REFUTATION_PROMPT_TEMPLATE ? "refuted" : "supported") });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", fact.reason);
  const cluster = carrierLines(ws).find((l) => l.kind === "cluster");
  assert.equal(cluster.confirmed, false, "the refuter did its job");
  assert.equal(portfolioRecords(ws).length, 0, "NOTHING reached the Portfolio — there is no supported row to write");
  assert.equal(spawn.noveltyCalls().length, 0, "…and an unconfirmed cluster is never novelty-checked (no call to spend)");
  const exps = experienceRecords(ws);
  assert.equal(exps.length, 1, "the FAILURE is learning material too");
  assert.equal(exps[0].role, "confirmed-negative", "its own role — the negative IS the finding");
  assert.match(exps[0].summary, /fixture counterexample/, "…with the refuter's own reasoning on it");
  const ing = carrierLines(ws).find((l) => l.kind === "ingestion");
  assert.equal(ing.writes[0].disposition, "not-confirmed");
  assert.match(String(ing.writes[0].portfolio.skipped), /verdict:refuted-is-never-a-Portfolio-supported-row/);
});

// ── (d) the same cluster in two rounds ───────────────────────────────────────────────────────────────
test("ingestion (d) — the same cluster seen in two rounds ⇒ ONE Portfolio record, not two", async () => {
  const s = await scenarioSameClusterTwoRounds(runOpenSemanticDiscovery);
  assert.equal(s.clusters.length, 2, "the carrier really holds two cluster records");
  assert.equal(s.rows.length, 1, "…but only ONE Portfolio record: the repeat wrote nothing");
  assert.equal(s.experiences.length, 1, "…and only one Experience, for the same reason");
  assert.equal(s.second.disposition, "mechanical-duplicate");
  assert.equal(s.second.retrieval.mechanical_duplicate_of, s.clusters[0].record_id, "…naming the EARLIER round's own record");
  assert.equal(s.spawn2.noveltyCalls().length, 0, "the mechanical exception spends no model call — that is what makes it mechanical");
});

// ── (f) no mechanical candidate ──────────────────────────────────────────────────────────────────────
test("ingestion (f) — NO mechanical candidate still gets the semantic novelty call, and is NOT auto-labelled novel", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // A component nothing in this workspace mentions: no Portfolio, no routine findings, no task Touches.
  const orphan = [{ ...HYPS[0], components: ["nowhere/zzz-unheard-of.ts"], claim: "nowhere/zzz-unheard-of.ts carries an unreachable branch" }];
  const engine = makeEngine({ hyps: orphan });
  const spawn = countingSpawn(noveltyDelegate({ verdict: "restatement" }));
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", fact.reason);
  const outcome = rounds(ws)[0].ingestion.outcomes[0];
  assert.equal(outcome.retrieved, 0, "the mechanical retrieval really found no candidate");
  assert.equal(spawn.noveltyCalls().length, 1, "…and the model was STILL asked — «no mechanical match» is not a verdict");
  // What the model was shown: the wider context is present, and the empty candidate list is explicitly NOT
  // a verdict. Both assertions are on the REAL prompt the subprocess received.
  const prompt = String(spawn.noveltyCalls()[0].opts.stdinData);
  assert.match(prompt, /none retrieved — this does NOT mean the finding is new/, "the empty candidate list is labelled as inconclusive");
  assert.match(prompt, /WIDER CONTEXT/, "…and the wider context is supplied");
  assert.equal(outcome.disposition, "restatement", "the label is the MODEL's, not an automatic «novel»");
  assert.equal(portfolioRecords(ws).length, 0, "so nothing counts as new");
  assert.equal(experienceRecords(ws).length, 1, "…while the observation itself is still recorded as an Experience");
  assert.equal(experienceRecords(ws)[0].role, "duplicate");
});

// ── (g) failures are learning material ───────────────────────────────────────────────────────────────
test("ingestion (g) — refuted AND undetermined clusters are ingested as Experiences with their reasoning, never Portfolio-supported", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({
    hyps: HYPS,
    verdictFor: (ci, o) => (o.promptTemplate === REFUTATION_PROMPT_TEMPLATE ? "refuted" : (ci === 1 ? "supported" : "undetermined")),
  });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", fact.reason);
  assert.equal(rounds(ws)[0].confirmed.count, 0, "neither cluster is confirmed");
  assert.equal(portfolioRecords(ws).length, 0, "NOTHING reaches the Portfolio: no cluster was supported-and-new");
  const exps = experienceRecords(ws);
  assert.equal(exps.length, 2, "both are learning material, each with its own role");
  const byRole = Object.fromEntries(exps.map((e) => [e.role, e]));
  assert.deepEqual(Object.keys(byRole).sort(), ["confirmed-negative", "undetermined"]);
  for (const e of exps) {
    assert.equal(e.reported_by, "system");
    assert.equal(e.evidence_level, "production-open");
    assert.ok(e.summary.trim().length >= 40, `the reasoning travels with the entry (got ${JSON.stringify(e.summary)})`);
  }
  assert.match(byRole["confirmed-negative"].summary, /fixture counterexample/, "the refuter's counterexample is ON the entry");
  assert.match(byRole["undetermined"].summary, /fixture evidence/, "an undetermined cluster carries the evidence it could not settle");
  // The carrier says what happened to each, so the disposition is not inferable only from other files.
  const ing = carrierLines(ws).find((l) => l.kind === "ingestion");
  assert.deepEqual(ing.writes.map((w) => w.verdict).sort(), ["refuted", "undetermined"]);
  for (const w of ing.writes) assert.match(String(w.portfolio.skipped), /is-never-a-Portfolio-supported-row/);
});

// ── the ingestion's pure pieces ──────────────────────────────────────────────────────────────────────
test("ingestion — the record id the routine mints is UNIQUE per round+cluster and resolvable by prefix", () => {
  const a = openDiscoveryRecordId("2026-10-13T00:00:00.000Z", 1);
  const b = openDiscoveryRecordId("2026-10-13T00:00:00.000Z", 2);
  const c = openDiscoveryRecordId("2026-10-13T00:01:00.000Z", 1);
  assert.equal(new Set([a, b, c]).size, 3, "no two (round, cluster) pairs share an id");
  assert.ok(a.startsWith(OPEN_DISCOVERY_REF_PREFIX));
});

test("ingestion — parseNoveltyVerdict: only the declared vocabulary is accepted, and unreadable stays null", () => {
  assert.equal(parseNoveltyVerdict(null), null);
  assert.equal(parseNoveltyVerdict({ verdict: "supported" }), null, "the VERIFIER's vocabulary is not the novelty vocabulary");
  assert.equal(parseNoveltyVerdict({ verdict: "" }), null);
  const novel = parseNoveltyVerdict({ verdict: "novel", duplicate_of: null, reasoning: "r", summary: "s" });
  assert.equal(novel.verdict, "novel");
  assert.equal(novel.duplicate_of, null);
  const dup = parseNoveltyVerdict({ verdict: "duplicate", duplicate_of: "F01" });
  assert.equal(dup.duplicate_of, "F01");
  assert.equal(dup.reasoning, null, "an absent field stays null — never an invented string");
  // A non-zero control: every declared verdict really is accepted.
  for (const v of NOVELTY_VERDICTS) assert.equal(parseNoveltyVerdict({ verdict: v }).verdict, v);
  assert.deepEqual([...NOVELTY_VERDICTS], ["novel", "duplicate", "restatement"]);
});

test("ingestion — experienceRoleFor: the role follows the cluster's OWN verdict, and the one mechanical case writes nothing", () => {
  assert.equal(experienceRoleFor({}, "novel", "supported"), "found-unresolved");
  assert.equal(experienceRoleFor({}, "unjudged", "supported"), "found-unresolved", "unjudged decides NEWNESS, not whether the claim held");
  assert.equal(experienceRoleFor({}, "duplicate", "supported"), "duplicate");
  assert.equal(experienceRoleFor({}, "restatement", "supported"), "duplicate");
  assert.equal(experienceRoleFor({}, "novel", "refuted"), "confirmed-negative", "the verdict wins over the disposition");
  assert.equal(experienceRoleFor({}, "novel", "undetermined"), "undetermined");
  assert.equal(experienceRoleFor({}, "mechanical-duplicate", "supported"), null, "the one mechanical case writes NO Experience");
  assert.equal(experienceRoleFor({}, "novel", null), null, "a record whose verdict cannot be derived gets no role");
});

test("ingestion — findMechanicalRepeat keys on BOTH the component set and the claim, and never on its own id", () => {
  const portfolio = realPortfolio;
  const prior = [{ record_id: "r1", claim: "A claim about the thing", components: ["a.ts", "b.ts"] }];
  const same = findMechanicalRepeat(prior, { components: ["b.ts", "a.ts"], claim: "a  claim about the thing", recordId: "r2", portfolio });
  assert.equal(same.record_id, "r1", "order and whitespace/case do not make it a different finding");
  assert.equal(findMechanicalRepeat(prior, { components: ["a.ts", "b.ts"], claim: "A DIFFERENT claim", recordId: "r2", portfolio }), null, "the claim must match too");
  assert.equal(findMechanicalRepeat(prior, { components: ["a.ts"], claim: "A claim about the thing", recordId: "r2", portfolio }), null, "so must the component SET");
  assert.equal(findMechanicalRepeat(prior, { components: ["a.ts", "b.ts"], claim: "A claim about the thing", recordId: "r1", portfolio }), null, "a record never dedups against itself");
  assert.equal(findMechanicalRepeat([], { components: ["a.ts"], claim: "x", recordId: "r2", portfolio }), null);
});

test("ingestion — taskIdFromPath / componentsFromSubjectKey are POSITION reads, and their refusals are their own value", () => {
  assert.equal(taskIdFromPath("develop:tasks/gap-foo.md"), "gap-foo");
  assert.equal(taskIdFromPath("tasks/gap-foo.md"), "gap-foo");
  // The `-n` shape (`<rev>:<path>:<line>:<text>`) — the title arm's own input. A parser that only took the
  // `-l` shape would return null for EVERY title line, which reads exactly like "no task has a title".
  assert.equal(taskIdFromPath('develop:tasks/gap-foo.md:3:title: "hello"'), "gap-foo");
  assert.equal(taskIdFromPath("develop:docs/notes.md"), null);
  assert.equal(taskIdFromPath("develop:tasks/sub/gap-foo.md"), null, "a nested path is not a task id");
  assert.equal(taskIdFromPath(""), null);
  assert.deepEqual(componentsFromSubjectKey("enum-surface:driver-kind|plugin/scripts/start-drivers.ts#122"), ["plugin/scripts/start-drivers.ts"]);
  assert.deepEqual(componentsFromSubjectKey("suite-red-sig#4b117de2"), ["suite-red-sig"]);
  assert.deepEqual(componentsFromSubjectKey("a:x|p.ts#1|q.ts#2"), ["p.ts", "q.ts"]);
  assert.deepEqual(componentsFromSubjectKey(""), []);
});

test("ingestion — buildNoveltyPrompt states the bound and never presents an empty candidate list as a verdict", () => {
  const empty = buildNoveltyPrompt({ claim: "c", components: ["a.ts"], evidence: [], candidates: [], broad: [], broadTruncated: false });
  assert.match(empty, /none retrieved — this does NOT mean the finding is new/);
  assert.doesNotMatch(empty, /\{\{/, "no placeholder is left unsubstituted");
  const full = buildNoveltyPrompt({
    claim: "c", components: ["a.ts"], evidence: ["a.ts:1 — x"],
    candidates: [{ carrier: "x", ref: "F01", claim: "c", components: ["a.ts"], basis: "same-component-set", duplicate_target: true }],
    broad: [{ carrier: "y", ref: "T1", claim: "t", components: [], basis: "task-title", duplicate_target: false }],
    broadTruncated: true,
  });
  assert.match(full, /"ref": "F01"/);
  assert.match(full, /TRUNCATED at the declared bound/, "a bounded context SAYS it is bounded");
  assert.doesNotMatch(full, /\{\{/);
});

test("ingestion — the novelty check's tool envelope is the read-only one, and its step is on the reservation ledger", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const spawn = countingSpawn();
  const pin = pinStub();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine({ hyps: [HYPS[0]] }) }), spawnFn: spawn, pinFn: pin });
  assert.equal(NOVELTY_TOOLS, "Read,Grep");
  const call = spawn.noveltyCalls()[0];
  assert.equal(call.argv[call.argv.indexOf("--tools") + 1], NOVELTY_TOOLS);
  assert.equal(call.opts.cwd, pin.pins[0], "…rooted at the same stripped pin the round's other calls use");
  assert.ok(call.argv.includes("--max-turns"), "and bounded explicitly, like every other subprocess");
  const reserve = ledgerReserves(ws).find((r) => r.step === "novelty-check");
  assert.ok(reserve, "the novelty call RESERVED before it spawned");
  assert.equal(reserve.tools, NOVELTY_TOOLS);
  assert.equal(Number(reserve.max_turns) >= 1, true);
});

// ── the in-scratch-copy NEGATIVE CONTROLS ────────────────────────────────────────────────────────────
/** Build a SCRATCH copy of the routine whose relative imports still resolve: the sibling scripts and the
 *  analysis directory are SYMLINKED in, and only the module under test is a real (mutated) file. */
function scratchModule(mutate) {
  const dir = tmpDir("osd-mutant-");
  const scripts = path.join(dir, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "docs", "analysis"), path.join(dir, "docs", "analysis"));
  // A bare specifier (`yaml`) resolves by walking UP from the importing file, so the scratch root needs
  // the workspace's own dependency tree reachable — a symlink, so nothing is copied.
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"));
  for (const f of fs.readdirSync(path.join(REPO_ROOT, "plugin", "scripts"))) {
    if (f === "open-semantic-discovery-routine.ts") continue;
    fs.symlinkSync(path.join(REPO_ROOT, "plugin", "scripts", f), path.join(scripts, f));
  }
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  const out = mutate(src);
  assert.notEqual(out, src, "the mutation control must actually change the source");
  const p = path.join(scripts, "open-semantic-discovery-routine.ts");
  fs.writeFileSync(p, out, "utf8");
  return p;
}

test("NEGATIVE CONTROL (g) — remove the refutation step in a scratch copy ⇒ the (g) claim goes RED", async () => {
  const mutantPath = scratchModule((src) => src
    .replace("const confirmed = row.verdict === \"supported\" && refutation?.verdict === \"supported\";",
      "const confirmed = row.verdict === \"supported\";")
    .replace("      if (row.verdict === \"supported\") {", "      if (false) {"));
  const mutant = await import(pathToFileURL(mutantPath).href);
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // The SAME fixture that makes (g) green on the real module: verifier supports, refuter refutes.
  const engine = makeEngine({ verdictFor: (ci, o) => (o.promptTemplate === REFUTATION_PROMPT_TEMPLATE ? "refuted" : "supported") });
  const fact = await mutant.runOpenSemanticDiscovery(ws, {
    config: readOpenSemanticDiscoveryConfig(ws).config,
    configPresent: true, configError: null, halted: false, invokedBy: INVOKED_BY_RESIDENT,
    modules: engine.modules, launchArgvFn: fakeLaunchArgv, spawnFn: countingSpawn(), pinFn: pinStub(),
  });
  assert.equal(fact.state, "verified");
  const rec = fs.readFileSync(carrierPath(ws), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.kind === "cluster")[0];
  assert.equal(rec.refutation_verdict, "not-run", "the mutant never ran a refuter");
  assert.equal(rec.confirmed, true, "⇒ the (g) claim («NOT confirmed») is FALSIFIED — the control is live");
  process.stdout.write(`    NEGATIVE CONTROL (g): mutant reports confirmed=true for a supported+refuted cluster (claim was «NOT confirmed»)\n`);
});

test("NEGATIVE CONTROL (k) — gate the round on «arch-discovery reported new fingerprints» ⇒ the (k) claim goes RED", async () => {
  const GATE = [
    "  // MUTATION: gate the round on ANOTHER routine's mechanical reading.",
    "  {",
    "    const _ac = path.join(root, \".quay\", \"arch-discovery-findings.jsonl\");",
    "    if (fs.existsSync(_ac)) {",
    "      const _rounds = fs.readFileSync(_ac, \"utf8\").split(\"\\n\").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.kind === \"scan-round\");",
    "      const _last = _rounds[_rounds.length - 1];",
    "      if (!_last || Number(_last.new ?? 0) === 0) return fact(\"not-evaluated\", { ...base, enabled: true }, \"arch-discovery reported no new fingerprints — nothing spawned\");",
    "    }",
    "  }",
    "",
  ].join("\n");
  const mutantPath = scratchModule((src) => {
    const anchor = "  // ④ the engine modules, resolved from DISK";
    assert.ok(src.includes(anchor), "the mutation anchor is present");
    return src.replace(anchor, `${GATE}${anchor}`);
  });
  const mutant = await import(pathToFileURL(mutantPath).href);
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  fs.writeFileSync(path.join(ws, ".quay", "arch-discovery-findings.jsonl"),
    JSON.stringify({ kind: "scan-round", ts: new Date().toISOString(), new: 0, repeated: 7, gone: 0 }) + "\n", "utf8");
  const spawn = countingSpawn();
  const fact = await mutant.runOpenSemanticDiscovery(ws, {
    config: readOpenSemanticDiscoveryConfig(ws).config,
    configPresent: true, configError: null, halted: false, invokedBy: INVOKED_BY_RESIDENT,
    modules: makeEngine().modules, launchArgvFn: fakeLaunchArgv, spawnFn: spawn, pinFn: pinStub(),
  });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /arch-discovery reported no new fingerprints/);
  assert.equal(spawn.calls.length, 0, "⇒ the mutant SUPPRESSED the semantic round: the (k) claim is FALSIFIED — the control is live");
  process.stdout.write(`    NEGATIVE CONTROL (k): mutant spawned 0 calls when arch-discovery reported 0 new fingerprints (claim was «the round still runs»)\n`);
});

test("NEGATIVE CONTROL (ingestion) — disable the novelty check in a scratch copy ⇒ the (a) and (d) claims go RED", async () => {
  // The mutation is EXACTLY "the novelty check is disabled": the one mechanical dedup is neutered and every
  // confirmed cluster is treated as new, which is what a novelty check that always answers `novel` is. It
  // changes nothing else — the retrieval, the writes and the ledgers all still run.
  const MUT_REPEAT = "const repeat = findMechanicalRepeat(priorClusterRecords, { components: comps, claim, recordId, portfolio: modules.portfolio });";
  const MUT_DISPOSITION = [
    "      if (parsed === null) disposition = \"unjudged\";",
    "      else if (parsed.verdict === \"novel\") disposition = \"novel\";",
    "      else if (parsed.verdict === \"duplicate\") {",
    "        const target = retrieval.candidates.find((x) => x.ref === parsed.duplicate_of && x.duplicate_target);",
    "        if (target) { disposition = \"duplicate\"; duplicateOf = target.ref; }",
    "        else disposition = \"restatement\";",
    "      } else disposition = \"restatement\";",
  ].join("\n");
  const mutantPath = scratchModule((src) => {
    assert.ok(src.includes(MUT_REPEAT), "the mechanical-dedup anchor is present");
    assert.ok(src.includes(MUT_DISPOSITION), "the disposition anchor is present");
    return src
      .replace(MUT_REPEAT, "const repeat = null; // MUTATION: the one mechanical dedup is disabled")
      .replace(MUT_DISPOSITION, "      disposition = \"novel\"; // MUTATION: the novelty check is disabled — everything confirmed counts as new");
  });
  const mutant = await import(pathToFileURL(mutantPath).href);

  // (a): against the SAME fixture that makes the real module green. ⛔ The assertion chosen is the one the
  // mutation really falsifies: for a duplicate OF A PORTFOLIO ROW, `ingestFinding`'s own duplicate rule
  // sets `duplicate_of` even with the novelty check disabled (a second line of defence, not a substitute),
  // so the claim that goes red is the one about what the SEMANTIC check decided and how the Experience is
  // roled. `disposition` and the role are asserted on the real module in case (a) above.
  const a = await scenarioDuplicateAgainstExistingPortfolio(mutant.runOpenSemanticDiscovery);
  assert.equal(a.ours.length, 1, "the mutant still writes a row…");
  assert.equal(a.outcome.disposition, "novel", "…calling a known duplicate NOVEL");
  assert.notEqual(a.outcome.disposition, "duplicate", "⇒ the (a) claim («disposition is duplicate») is FALSIFIED — the control is live");
  assert.equal(experienceRecords(a.ws)[0].role, "found-unresolved", "…and the Experience is roled as a fresh unresolved finding");
  assert.notEqual(experienceRecords(a.ws)[0].role, "duplicate", "⇒ the (a) role claim is FALSIFIED too");

  // (a2): the shape where the SEMANTIC check is the ONLY thing that can catch it — here `duplicate_of`
  // itself goes red, which is the literal AC (a) claim.
  const id = await clusterIdentity();
  const a2ws = makeWorkspace();
  writeConfig(a2ws, cfgYaml());
  const taskId = addTaskOnDevelop(a2ws, "gap-fixture-known-thing", { touches: id.components });
  const a2spawn = countingSpawn(noveltyDelegate({ verdict: "duplicate", duplicateOf: taskId }));
  await mutant.runOpenSemanticDiscovery(a2ws, { ...runOpts(a2ws, { engine: makeEngine({ hyps: [HYPS[0]] }) }), spawnFn: a2spawn, pinFn: pinStub() });
  const a2rows = portfolioRecords(a2ws);
  assert.equal(a2rows.length, 1);
  assert.equal(a2rows[0].duplicate_of, null, "⇒ the (a2) claim («duplicate_of set») is FALSIFIED — nothing catches the task-Touches duplicate once the verdict is forced to novel");

  // (d): likewise.
  const d = await scenarioSameClusterTwoRounds(mutant.runOpenSemanticDiscovery);
  assert.equal(d.rows.length, 2, "⇒ the (d) claim («ONE Portfolio record, not two») is FALSIFIED — the control is live");

  process.stdout.write(`    NEGATIVE CONTROL (ingestion): mutant called a Portfolio duplicate disposition=${a.outcome.disposition} (role ${experienceRecords(a.ws)[0].role}), left duplicate_of=${String(a2rows[0].duplicate_of)} for the task-Touches duplicate, and wrote ${d.rows.length} Portfolio rows for one cluster seen twice (claims were «duplicate», «duplicate_of set» and «one row»)\n`);
});

// ── misc contracts ───────────────────────────────────────────────────────────────────────────────────
test("config — the section is read from the workspace's own `.quay/config.yml`, and an absent file is not an error", () => {
  const ws = tmpDir("osd-noconfig-");
  const read = readOpenSemanticDiscoveryConfig(ws);
  assert.equal(read.present, false);
  assert.equal(read.error, null, "no config file ⇒ off by default, not a failure");
  const ws2 = makeWorkspace();
  writeConfig(ws2, "loop:\n  open_semantic_discovery:\n    enabled: true\n    interval: interval:60m\n    interval_until: 2026-10-20T00:00:00Z\n");
  const read2 = readOpenSemanticDiscoveryConfig(ws2);
  assert.equal(read2.present, true);
  assert.match(read2.error, /investigator_runs/, "a declared-but-incomplete section is a NAMED config error");
});

test("focusDirective — carries the history and keeps the CHOICE with the model", () => {
  const none = focusDirective([]);
  assert.match(none, /No exploration focus has been recorded/);
  assert.match(none, new RegExp(FOCUS_MARKER.replace(":", "\\:")));
  const some = focusDirective(["alpha", "beta"]);
  assert.match(some, /alpha/);
  assert.match(some, /beta/);
  assert.match(some, /ELSEWHERE/, "going elsewhere is offered, not required");
});
