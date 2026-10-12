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

/** A spawn primitive that COUNTS its calls (the seam every argv/cwd claim is read from). */
function countingSpawn(delegate) {
  const calls = [];
  const fn = async (argv, opts) => {
    calls.push({ argv, opts });
    return delegate ? delegate(argv, opts) : { status: 0, stdout: STREAM, stderr: "", error: null };
  };
  fn.calls = calls;
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

/** Build the engine seam: the REAL pure functions + argv builder, STUBBED runners. */
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
    loadGatewayRates: () => ({ ok: true, rates: { model_group: FIXTURE_MODEL, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 } }),
    deriveCost: realPortfolio.deriveCost,
  };
  return { modules: { hyp, portfolio }, investigatorCalls, verifierCalls };
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
test("case (d) — a reservation precedes EACH of investigator, verifier and refuter", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // ONE hypothesis ⇒ exactly one cluster ⇒ the step order is the whole story, with no repetition to read
  // past.
  const engine = makeEngine({ hyps: [HYPS[0]] });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const steps = resumeSteps(ws);
  assert.deepEqual(steps, ["investigator", "verifier", "refuter", "value-assessment"], `one reservation per step, in order (got ${steps.join(",")})`);
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
test("case (i) — after a full round nothing under tasks/ or goals/ changed, and the source carries no authoring symbol", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const before = (d) => fs.readdirSync(path.join(ws, d)).sort().join(",");
  const t0 = before("tasks");
  const g0 = before("goals");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  const q0 = fs.existsSync(path.join(ws, ".quay", "discovery-portfolio.jsonl"));
  const engine = makeEngine();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(before("tasks"), t0, "tasks/ is untouched");
  assert.equal(before("goals"), g0, "goals/ is untouched");
  assert.equal(fs.existsSync(path.join(ws, ".quay", "discovery-portfolio.jsonl")), q0, "no Portfolio write");
  assert.equal(fs.existsSync(path.join(ws, ".quay", "discovery-experience-ledger.jsonl")), false, "no Experience write");

  // The STATIC control: judged BY POSITION on the real source text (硬规则 2) — the routine names none of
  // the filing/authoring symbols.
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  const FORBIDDEN = /selectFilings|fileRoutineTask|driveItems|task_write|goal_write|writeTask|writeGoal|lifecycle_promote|lifecycle_retreat|lifecycle_complete/;
  assert.doesNotMatch(src, FORBIDDEN, "open-semantic-discovery-routine.ts must import/call no filing or authoring symbol");
  // A non-zero control on the SAME predicate: it CAN fire, so the zero above is a real zero.
  assert.match(src, /appendCarrierRecords/, "the predicate finds a token that IS present in this file");
  const mutated = `${src}\nimport { writeTask } from "./nowhere.ts";\n`;
  assert.match(mutated, FORBIDDEN, "the mutation must turn the same predicate red — otherwise the control is vacuous");
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
  assert.equal(spawn2.calls.length, spawn1.calls.length, "…with the SAME number of calls: an unchanged pin suppresses nothing");
  assert.equal(rounds(ws).length, 2, "two scan-round lines");
  assert.equal(rounds(ws)[0].pin.rev, rounds(ws)[1].pin.rev);
});

test("case (k) — the round runs when arch-discovery reports ZERO new fingerprints (this routine never reads that carrier)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  fs.writeFileSync(path.join(ws, ".quay", "arch-discovery-findings.jsonl"),
    JSON.stringify({ kind: "scan-round", ts: new Date().toISOString(), new: 0, repeated: 7, gone: 0 }) + "\n", "utf8");
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine() }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", "0 new fingerprints from ANOTHER routine suppresses nothing here");
  assert.ok(spawn.calls.length >= 3);
  // ⛔ …and the reason is structural, not incidental: this module never even names that routine's carrier.
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  // Judged by POSITION on the source: a READ of that carrier would have to spell its filename as a string
  // literal; the bare words appear only in this file's own prose (which is not a read).
  assert.equal(src.includes('"arch-discovery-findings.jsonl"'), false, "the module never reads that routine's carrier");
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

// ── the two in-scratch-copy NEGATIVE CONTROLS ────────────────────────────────────────────────────────
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
