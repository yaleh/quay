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
//   (m) the ANSWER RESERVE and the failure legibility of a killed call (task
//       gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output):
//         AC1(a) an `error_max_turns` stream ⇒ the call record carries the subtype and the round reports
//                `not-evaluated:error_max_turns`, NOT "0 hypotheses" (+ the negative control)
//         AC1(b) a zero-token exit-1 with stderr ⇒ the stderr TAIL is recorded and its truncation is a
//                recorded reading, not a silent slice
//         AC1(c) the answer reserve turns a cut-off run into parsed hypotheses — a stub that answers ONLY
//                when told to stop exploring
//       plus the report-only / budget / kill-switch invariants the AC5 reading rests on
//   AC1…AC3 of task gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated:
//         AC1 an ATTRIBUTABLE refutation: `error_max_turns` ⇒ `budget-truncated` + exactly one counted
//             retry reservation; no counter-evidence ⇒ `no-counter-evidence`; a 0-token exit ⇒
//             `call-failed`; a verdict that is not a determinate «survived» is NEVER `confirmed`
//         AC2 the cluster↔call join: two clusters with different refuter calls each carry their OWN
//             call's `num_turns`/subtype/tool counts (both with an in-scratch-copy negative control)
//         AC3 the retry budget: a MEASURED default, optional, and required to be strictly larger
// Plus: the two in-scratch-copy NEGATIVE CONTROLS the task names ((g) and (k)), the AC1(d)/AC2 negative
// controls, and the off-by-default / routine-table wiring contracts.
//
// Run: scripts/test.sh plugin/test/open-semantic-discovery-routine.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
// The same YAML reader the routine parses `.quay/config.yml` with, so an AC3 assertion about a config
// SECTION is made against the real parse rather than against a hand-built object.
import YAML from "yaml";

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
  REFUTER_STARTING_POINTS_MAX,
  DEFAULT_REFUTATION_RETRY_MAX_TURNS,
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
  REFUTATION_UNDETERMINED_CAUSES,
  refutationPromptFor,
  refutationReading,
  refuterStartingPoints,
  refutationUndeterminedCause,
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
  REGISTRY_MODULE_FILE,
  ANALYSIS_DIR_REL,
  selectMethodsForRound,
  methodDirective,
  methodLabel,
  methodLabelsOf,
  methodGuidanceBlock,
  openShadowDiscoveryRecordId,
  METHOD_ARM_PRODUCTION,
  METHOD_ARM_SHADOW,
  DEFAULT_GAIN_EVERY_ROUNDS,
  PAIRED_ARM_BASELINE,
  PAIRED_ARM_GUIDED,
  PAIRED_ARMS,
  GAIN_RECORD_KIND,
  GAIN_SUMMARY_KIND,
  PRODUCTION_OPEN_EVIDENCE_LEVEL,
  PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD,
  PREREG_REL,
  sha256Of,
  pairedArmBudget,
  pairedBudgetRefusal,
  pairedArmCounts,
  armNoveltyRows,
  gainOf,
  pairedPreregKeys,
  pairedPreregRefusal,
  buildGainRecord,
  gainRollup,
  eligibleRoundsOf,
  pairedRoundDecision,
  openBaselineDiscoveryRecordId,
  callsOfArm,
  // ── the per-cluster attribution join, the resident-round DoD, and the call-failure split ───────────
  CLUSTER_BLOCKING_STEPS,
  HEALTHY_BLOCKING_CAUSES,
  RESIDENT_HEALTH_WINDOW_ROUNDS,
  clusterAttribution,
  roundAttribution,
  residentRoundHealth,
  callFailureSplit,
  buildDiscoveryReport,
  renderDiscoveryReport,
  // ── the ANSWER RESERVE + failure legibility (case (m)) ────────────────────────────────────────────
  ANSWER_RESERVE_PROMPT_TURNS,
  ANSWER_RESERVE_TOOLS,
  STDERR_TAIL_MAX,
  STDOUT_HEAD_MAX,
  STDOUT_TAIL_MAX,
  CALL_CAPTURE_DIR_REL,
  RETRY_BACKOFF_MS,
  RETRYABLE_CALL_FAILURES,
  // ── the anchor-handoff correlation (task gap-osd-stream-without-result-recurs-…) ───────────────────
  HANDOFF_ADJACENCY_WINDOW_MS,
  HOST_LOADAVG_PATH,
  handoffBlock,
  readHostLoad,
  boundedTail,
  boundedHead,
  callFailureClass,
  writeCallCapture,
  callNotEvaluatedToken,
  firstNotEvaluatedToken,
  turnReserveDirective,
  buildAnswerReservePrompt,
  // ── the OPTIONAL task-status context (task gap-open-discovery-consumes-task-status-events-…) ───────
  DEFAULT_TASK_LOG_CONTEXT_LIMIT,
  FOCUS_CITATION_MAX,
  asTaskLogCursor,
  taskLogDedupKey,
  priorTaskLogContext,
  readTaskLogContext,
  taskLogContextDirective,
  citeOfferedEvents,
  // ── the stable identity + the real source evidence (gap-discovery-findings-lack-stable-identity-and-
  //    source-evidence-and-double-ingest-into-experience) ─────────────────────────────────────────────
  isPriorProductionCluster,
  foldConceptOccurrences,
  citationsFromCallStream,
  verifyCitation,
  verifyCitations,
} from "../scripts/open-semantic-discovery-routine.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "../scripts/probe-routine.ts";
// The anchor's OWN published start, read through the SAME reader the routine consumes — a re-implementation
// of `.quay/anchor.json` parsing here would let the fixture agree with itself instead of with the carrier.
import { readAnchorStart } from "../scripts/driver-runtime.ts";
// The CARRIER the context is read from is written by the KERNEL's own writer and read by the SURFACE's own
// reader — the fixture never hand-writes a carrier line and never parses the file, because either would
// make this test agree with itself instead of with the contract the routine actually consumes.
import { appendTaskStatusEvent } from "../../packages/quay/src/kernel/task-transition.ts";
import { readTaskLog, MAX_TASK_LOG_LIMIT } from "../../packages/quay/src/cli/task-log.ts";
import { qualityGateRoutines } from "../scripts/quality-gate-driver.ts";
import { INVOKED_BY_MANUAL, INVOKED_BY_RESIDENT } from "../scripts/discovery-method-routine.ts";
import { appendLedgerRecords } from "../scripts/discovery-method-routine.ts";
// The engine is imported for REAL here so the argv the routine builds is the argv the engine builds:
// `hardenedArgv` is the production argv constructor, and the stubs only replace the RUNNERS.
import * as realHyp from "../../docs/analysis/arch-hypothesis-generation.mjs";
import * as realPortfolio from "../../docs/analysis/discovery-portfolio.mjs";
import * as realLedger from "../../docs/analysis/discovery-experience-ledger.mjs";
import * as realRegistry from "../../docs/analysis/discovery-method-registry.mjs";
// The store's OWN validator, imported for REAL: the claim under test is «the records this round projects
// into the evidence store are accepted by the PRODUCTION validator», and a locally re-stated schema would
// agree with itself instead of with the store (硬规则 5b).
import { validateRecord, EVIDENCE_STORE_REL, appendOutcomeRecord } from "../../docs/analysis/architecture-evidence-store.mjs";
// The PROMOTION PATH itself, imported for REAL: AC (e) is a claim about what THAT module decides, and a
// re-implementation of its level rule here would agree with itself rather than with production.
import { validateGeneralization, promotionStatusForLevel, PROMOTION_REPORT_ONLY_STATUS } from "../../docs/analysis/discovery-reflection.mjs";

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
  // Keys the declared set does not carry (the OPTIONAL extras, e.g. `gain_every_rounds`) are emitted
  // after it — an override map that silently dropped them would make a case test the DEFAULT while
  // reading as though it had declared something.
  for (const [k, v] of Object.entries(overrides)) {
    if (SECTION_KEYS.some(([declared]) => declared === k)) continue;
    if (v === null) continue;
    lines.push(`    ${k}: ${v}`);
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
/** Is this call the REFUTER's? Recognised by the template's OWN first line. ⛔ NOT by identity with
 *  `REFUTATION_PROMPT_TEMPLATE`: since this task the refuter's template carries a STARTING-POINTS block
 *  appended when the first verifier cited any line, so the string handed to the model is the frozen
 *  template PLUS that block. Matching the first line keeps the stub pinned to what the refuter IS rather
 *  than to one of the two shapes its prompt can take. */
const REFUTATION_FIRST_LINE = REFUTATION_PROMPT_TEMPLATE.split("\n")[0];
const isRefuterPrompt = (o) => String(o?.promptTemplate ?? "").startsWith(REFUTATION_FIRST_LINE);
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
      // ⛔ The stub FORCES the verdict (that is what `verdictFor` is for), but the row's COARSE CAUSE and
      // its `checked` list are read off the stream the call really returned, through the REAL parser — so
      // a fixture that distinguishes «it answered, unreadably» from «it read and found nothing» is reading
      // the same facts the engine reads rather than a second vocabulary invented here.
      const stdout = String(r?.stdout ?? "");
      const m = realHyp.verifierVerdict({ stdout, status: r?.status ?? 0, stream: realHyp.parseVerifierStream(stdout) });
      const j = realHyp.parseJsonObject(realHyp.callText(stdout));
      results.push({
        cluster: ci, members: clusters[ci - 1].members, verdict: verdictFor(ci, o), verdict_cause: m.cause ?? null,
        evidence: [`${rep.comps[0]}:1 — fixture evidence`], turns_used: 2, cost_usd: 0.02,
        actual_model: FIXTURE_MODEL, counterexample: "fixture counterexample", intentional: "fixture impact",
        summary: "fixture summary", stdout: r?.stdout ?? "",
        // Present only when the answer named positions — the same conditional-key discipline the engine uses.
        ...(Array.isArray(j?.checked) ? { checked: j.checked } : {}),
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
    streamDiagnostics: realHyp.streamDiagnostics,
    toolUseSummary: realHyp.toolUseSummary,
    callText: realHyp.callText,
    defaultVerifierPrompt: realHyp.defaultVerifierPrompt,
    defaultInvestigatorPrompt: realHyp.defaultInvestigatorPrompt,
    // The engine's OWN pre-registration gate, consumed by the paired instrument rather than re-derived
    // (硬规则 5b) — so the stub engine must carry it exactly as the real module does.
    preregRefusal: realHyp.preregRefusal,
    TOOL: realHyp.TOOL,
    // ⛔ The engine's PRODUCTION validator + store writer, likewise carried whole: the routine projects
    // its own clusters into the evidence store through this seam, and a stand-in would make the test
    // agree with itself about what the store accepts.
    emit: realHyp.emit,
    runInvestigator: investigatorStub(hyps, investigatorCalls),
    runVerifier: verifierStub(verifierCalls, verdictFor),
  };
  const portfolio = {
    ...realPortfolio,
    loadGatewayRates: () => ({ ok: true, rates: { model_group: FIXTURE_MODEL, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 } }),
  };
  return { modules: { hyp, portfolio, ledger: realLedger, registry: realRegistry }, investigatorCalls, verifierCalls };
}

/** The method-guidance fixtures need an investigator whose HYPOTHESES depend on WHICH ARM is asking, and
 *  the arm is identifiable structurally: the shadow pass is handed its own runs directory. Nothing here
 *  inspects the prompt to decide the arm (a prompt-reading stub would make the test agree with itself). */
function armAwareInvestigator({ productionHyps = HYPS, shadowHyps = [] } = {}) {
  const sink = [];
  const fn = async (o) => {
    const hyps = String(o.outDir).split(path.sep).pop() === "shadow" ? shadowHyps : productionHyps;
    const records = [];
    for (let i = 0; i < o.runs; i++) {
      const r = await o.runModel(o.prompt, i);
      sink.push({ arm: String(o.outDir).split(path.sep).pop() === "shadow" ? "shadow" : "production", cwd: o.cwd, pinDir: o.pinDir, tools: o.tools, maxTurns: o.maxTurns, prompt: o.prompt });
      records.push({ run: i + 1, hyps, stdout: r?.stdout ?? "", exit: r?.status ?? null });
    }
    return { ok: true, records, parsed: records.length, total: o.runs };
  };
  fn.calls = sink;
  return fn;
}

/** The PAIRED round's arms need an investigator whose hypotheses depend on WHICH ARM is asking, and the
 *  arm is identifiable structurally: each arm is handed its own runs directory (the baseline arm's ends
 *  in its own segment). Nothing here reads the prompt to decide the arm — a prompt-reading stub would
 *  make the comparison agree with itself. */
function pairedAwareInvestigator({ guidedHyps = HYPS, baselineHyps = HYPS } = {}) {
  const sink = [];
  const fn = async (o) => {
    const segment = String(o.outDir).split(path.sep).pop();
    const isBaseline = segment === PAIRED_ARM_BASELINE;
    const hyps = isBaseline ? baselineHyps : guidedHyps;
    const records = [];
    for (let i = 0; i < o.runs; i++) {
      const r = await o.runModel(o.prompt, i);
      sink.push({ arm: isBaseline ? PAIRED_ARM_BASELINE : PAIRED_ARM_GUIDED, cwd: o.cwd, prompt: o.prompt });
      records.push({ run: i + 1, hyps, stdout: r?.stdout ?? "", exit: r?.status ?? null });
    }
    return { ok: true, records, parsed: records.length, total: o.runs };
  };
  fn.calls = sink;
  return fn;
}

/** The engine seam for the paired-round cases: the real engine + real ledgers + real registry, with the
 *  paired-aware investigator. Everything else is `makeEngine`'s. */
function makePairedEngine(opts = {}) {
  const engine = makeEngine({ verdictFor: opts.verdictFor ?? alwaysSupported });
  const investigator = pairedAwareInvestigator(opts);
  engine.modules.hyp.runInvestigator = investigator;
  engine.investigator = investigator;
  return engine;
}

/** The engine seam for the METHOD cases: the real engine + real ledgers + real registry, with the
 *  arm-aware investigator. Everything else is `makeEngine`'s. */
function makeMethodEngine(opts = {}) {
  const engine = makeEngine({ hyps: opts.productionHyps ?? HYPS, verdictFor: opts.verdictFor ?? alwaysSupported });
  const investigator = armAwareInvestigator(opts);
  engine.modules.hyp.runInvestigator = investigator;
  engine.investigator = investigator;
  return engine;
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
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
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
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
  assert.match(fact.reason, /disabled/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
});

test("case (a) — halted ⇒ not-evaluated and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), halted: true, spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
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
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
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
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
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
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
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
  const engine = makeEngine({ verdictFor: (ci, o) => (isRefuterPrompt(o) ? "refuted" : "supported") });
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
  const engine = makeEngine({ verdictFor: (ci, o) => (isRefuterPrompt(o) ? "undetermined" : "supported") });
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
  const engine = makeEngine({ hyps: [HYPS[0]], verdictFor: (ci, o) => (isRefuterPrompt(o) ? "refuted" : "supported") });
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
    verdictFor: (ci, o) => (isRefuterPrompt(o) ? "refuted" : (ci === 1 ? "supported" : "undetermined")),
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

// ── the EVIDENCE STORE projection: this routine is the ONE resident producer that store has ──────────
// ⛔ THE DEFECT THIS PINS (gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-
//    nothing-forever): `discovery_method`'s batch ingester reads `.quay/architecture-evidence-store.jsonl`
//    and NO resident routine ever wrote it, so its `ingested 0` was permanent — a store that can never
//    hold a record, reading exactly like an ordinary round with nothing new.
test("EVIDENCE STORE — a round with verdict-bearing clusters APPENDS their real outcomes, validator-accepted", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const storeFile = path.join(ws, EVIDENCE_STORE_REL);
  // The state this task is about, and the negative control for the whole test: BEFORE the round there is
  // no store at all, and before this change a full round would have left it that way.
  assert.equal(fs.existsSync(storeFile), false, "the fixture starts with NO evidence store");

  const engine = makeEngine();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), invokedBy: INVOKED_BY_MANUAL, spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(fact.state, "verified", fact.reason);

  // (1) THE ROUND'S OWN READING of what it projected, on the carrier.
  const write = carrierLines(ws).find((l) => l.kind === "evidence-store-write");
  assert.ok(write, "the round records its projection on the carrier");
  const clusterRecs = productionClusters(ws);
  assert.ok(clusterRecs.length > 0, "the fixture really produced production clusters");
  assert.equal(write.attempted, clusterRecs.length * 2, "one hypothesis + one outcome per verdict-bearing cluster");
  assert.equal(write.hypotheses, clusterRecs.length);
  assert.equal(write.outcomes, clusterRecs.length);
  assert.equal(write.refused, 0, `every projected record passed the PRODUCTION validator: ${JSON.stringify(write.refused_reasons)}`);
  assert.equal(write.stored, write.attempted, "…and every accepted record really reached the store");
  assert.deepEqual(write.store_refused, []);
  assert.equal(write.error, null);
  // The Fact carries the SAME tally the carrier line does, field for field (the carrier line adds only
  // its own envelope), so «what the round reported» and «what it recorded» cannot drift.
  for (const k of ["attempted", "hypotheses", "outcomes", "accepted", "refused", "stored", "error"]) {
    assert.deepEqual(fact.value.evidence_store[k], write[k], `the Fact's evidence_store.${k} equals the carrier line's`);
  }

  // (2) THE STORE ITSELF — re-read from disk and re-validated with the production validator, so the claim
  // is about the bytes that really landed rather than about what the round said it did.
  const store = fs.readFileSync(storeFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(store.length >= clusterRecs.length * 2, `the store holds the projected records (got ${store.length})`);
  for (const rec of store) {
    assert.equal(rec.kind === "hypothesis" || rec.kind === "outcome", true, `only the two projected kinds are written (got ${rec.kind})`);
    const v = validateRecord(rec.kind, rec);
    assert.equal(v.ok, true, `store record refused on read-back: ${JSON.stringify(v.reasons)}`);
  }
  const outcomes = store.filter((r) => r.kind === "outcome");
  const ids = new Set(clusterRecs.map((c) => c.record_id));
  for (const o of outcomes) {
    assert.equal(ids.has(o.experiment_ref), true, "every outcome names a cluster record that is REALLY on the carrier");
    assert.equal(["supported", "refuted", "undetermined"].includes(o.verdict), true, `…and carries a derived discovery verdict (got ${o.verdict})`);
    assert.match(String(o.subject_key), /^[^|]+\|/, "…with the subject key the batch ingester reads components out of");
  }
  // The verdicts are the CLUSTERS' own — read off the same carrier records, not a second derivation.
  const verdicts = new Map(clusterRecs.map((c) => [c.record_id, realLedger.clusterVerdict(c)]));
  for (const o of outcomes) assert.equal(o.verdict, verdicts.get(o.experiment_ref), `the outcome's verdict is ${o.experiment_ref}'s own`);
  // A SHADOW arm's clusters are measurements and must never reach the store (they reach neither ledger).
  const shadowIds = new Set(carrierLines(ws).filter((l) => l.kind === "cluster" && l.shadow === true).map((l) => l.record_id));
  for (const rec of store) assert.equal(shadowIds.has(rec.case_id), false, "no shadow cluster was projected");
});

test("EVIDENCE STORE — the projection is what makes the next discovery_method round ingest (end to end)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), invokedBy: INVOKED_BY_MANUAL, spawnFn: countingSpawn(), pinFn: pinStub() });

  // ⛔ THE DOUBLE COUNT, SEEN FROM THE INGESTER'S SIDE (gap-discovery-findings-lack-stable-identity-and-
  //    source-evidence-and-double-ingest-into-experience, Plan item 3). Every one of these store outcomes
  //    was projected from a cluster this SAME round already filed into the Experience ledger DIRECTLY, so
  //    ingesting them again would put TWO entries for ONE cluster in the ledger and reflection would count
  //    it twice. MEASURED before the fix: the same fixture produced one entry per path (2 per cluster) —
  //    `ingested >= 1` here WAS that second entry. After the fix the ingester still READS the store (it is
  //    not starved — `scanned` is the same reading it always was) and names the skip by its own code.
  const ingest = realLedger.ingestNewOutcomes(ws, { enabled: true });
  assert.equal(ingest.ok, true, `the ingester refused: ${JSON.stringify(ingest.reasons)}`);
  const projected = carrierLines(ws).filter((l) => l.kind === "cluster" && l.shadow !== true).length;
  assert.ok(projected >= 1, "the round projected at least one cluster into the store");
  assert.equal(ingest.scanned, projected, "the ingester READ every projected outcome (the capability is not starved)");
  assert.equal(ingest.ingested, 0, `no outcome became a SECOND Experience for a cluster this round already ingested (got ${ingest.ingested})`);
  assert.equal(ingest.concept_duplicates, projected, `…and each skip is NAMED as the second-path duplicate (got ${ingest.concept_duplicates})`);
  assert.equal(ingest.store_state, realLedger.STORE_STATE_SCANNED_NONE, "…with the state that says records were read and none was new");
  const experiences = experienceRecords(ws);
  assert.equal(experiences.length, projected, "ONE Experience per cluster — not two");
  for (const e of experiences) {
    assert.equal(e.reported_by, "system", "the automatic source, not a human narration");
    assert.ok(String(e.summary ?? "").trim().length >= 40, `each entry carries a real summary (got ${JSON.stringify(e.summary)})`);
    assert.equal(typeof e.concept_key, "string", "…and the stable identity the dedup keys on");
  }

  // THE NEGATIVE CONTROL (硬规则 4 推论三): the dedup must not be a blanket "never ingest a store outcome".
  // An outcome this ledger has never seen — a DIFFERENT round, a subject nothing has ingested — still
  // becomes an Experience, so the reading above is a skip that can take a false value rather than a
  // capability that has been switched off.
  appendOutcomeRecord(ws, {
    ts: "2000-01-01T00:00:00.000Z", experiment: realLedger.CLUSTER_OUTCOME_EXPERIMENT,
    experiment_ref: `${OPEN_DISCOVERY_REF_PREFIX}2000-01-01T00:00:00.000Z#7`,
    verdict: "supported", subject_key: "fixture-concept|plugin/scripts/never-seen.ts",
    concept_key: "fixture-concept|plugin/scripts/never-seen.ts",
    case_id: "fixture-never-seen",
  });
  const ingest2 = realLedger.ingestNewOutcomes(ws, { enabled: true });
  assert.equal(ingest2.ingested, 1, `a genuinely new outcome STILL becomes an Experience (got ${ingest2.ingested})`);
  assert.equal(ingest2.concept_duplicates, 0, "…and nothing was skipped as a second-path duplicate");
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

// ── METHODS AS OPTIONAL GUIDANCE (task gap-open-discovery-method-guidance-active-shadow) ─────────────
//
// Coverage map for this task's Acceptance Criteria:
//   (a) 0 active                    ⇒ baseline round runs
//   (b) an active method            ⇒ guided production round, ids recorded
//   (c) a draft/trial method        ⇒ shadow arm only, records `shadow:true`, nothing reaches Portfolio
//   (d) retired / quarantined / contaminated ⇒ never selected, even as the only record
//   (e) guidance text naming a seed component ⇒ excluded with reason
//   (f) shadow calls reserve against the SAME 24h ledger
//   (g) a guided round's outcome is ingested as an Experience naming the method id and version

const METHOD_REGISTRY_REL_T = ".quay/discovery-method-registry.jsonl";
const CONTAMINATED_VERDICTS_REL_T = ".quay/discovery-contaminated-verdicts.jsonl";

/** A method record shaped like the registry's own contract. Only the fields the SELECTION reads matter
 *  here — selection never re-validates a record (that is the write path's job), so a fixture can be
 *  written straight to the carrier. */
function methodRec(over = {}) {
  return {
    kind: "method",
    method_id: "fixture-method",
    version: 1,
    ts: "2026-10-12T00:00:00.000Z",
    provenance_evidence: ["experience-fixture"],
    applicability: { domain_signals: ["fixture domain signal"], preconditions: ["a fixture precondition holds"] },
    operation: { steps: ["read the fixture source", "compare the two declarations"], tools: [] },
    expected_invariant: "the fixture invariant holds at every call site",
    falsification: "a call site violates the fixture invariant",
    cost_budget: { max_candidates: 1, max_model_calls: 0, max_wall_ms: 1000 },
    status: "draft",
    retirement_reason: null,
    supersedes: null,
    ...over,
  };
}
function writeMethodRegistry(ws, recs) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, METHOD_REGISTRY_REL_T), recs.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}
/** A hand-written Experience line — enough for the ledger's own deny-list reader (the selection scans
 *  against the UNION of every registered case's components/case_ids). */
function writeExperienceLine(ws, { case_id = "EXP-fixture", components = [], summary = "a fixture experience summary long enough to clear the ledger's own floor" } = {}) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.appendFileSync(path.join(ws, realLedger.EXPERIENCE_LEDGER_REL),
    JSON.stringify({ kind: "experience", id: `experience-${case_id}`, case_id, ts: "2026-10-12T00:00:00.000Z", role: "found-unresolved", reported_by: "system", authored_by: { actor: "ingester", ref: "fixture" }, source_ref: "fixture-record", evidence: [{ ref: "fixture-record", sha256: "a".repeat(64) }], components, summary, evaluation_pin: null, evidence_level: "production-open", source_case_id: null }) + "\n",
    "utf8");
}
function writeContaminatedVerdict(ws, { verdict_id = "verdict-fixture", reason = "VERDICT_CONTAMINATED:fixture reason" } = {}) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.appendFileSync(path.join(ws, CONTAMINATED_VERDICTS_REL_T),
    JSON.stringify({ kind: "contaminated_verdict", verdict_id, reason, collisions: [], authored_by: "fixture", ts: "2026-10-12T00:00:00.000Z" }) + "\n", "utf8");
}
const GUIDANCE_CLAUSE = "OPTIONAL GUIDANCE";
const shadowClusters = (ws) => carrierLines(ws).filter((l) => l.kind === "cluster" && l.shadow === true);
const productionClusters = (ws) => carrierLines(ws).filter((l) => l.kind === "cluster" && l.shadow !== true);

test("AC (a) — with 0 active methods the round runs BASELINE (unguided) and still spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeMethodEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified", `the round RAN (reason: ${fact.reason})`);
  assert.ok(spawn.calls.length > 0, "a baseline round still spawns model calls — 'no method' is never 'no round'");
  const round = rounds(ws)[0];
  assert.equal(round.methods.mode, "baseline");
  assert.equal(round.methods.ok, true, "the registry WAS readable — baseline-by-empty, not baseline-by-failure");
  assert.equal(round.methods.evaluated, 0);
  assert.deepEqual(round.methods.included, []);
  assert.deepEqual(round.methods.excluded, []);
  assert.match(round.methods.baseline_reason, /no-method-recorded/);
  assert.equal(round.methods.shadow.ran, false);
  const inv = engine.investigator.calls[0];
  assert.equal(inv.arm, "production");
  assert.ok(!inv.prompt.includes(GUIDANCE_CLAUSE), "no guidance block is appended when nothing was selected");
  assert.equal(round.investigator.guided_by.length, 0);
  assert.equal(productionClusters(ws)[0].method_guidance, null, "a baseline cluster names no method");
  console.log(`    AC (a): mode=${round.methods.mode} evaluated=0 reason="${round.methods.baseline_reason}"`);
});

test("AC (a) — a registry whose ONLY records are excluded also runs baseline (and says how many were excluded)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  writeMethodRegistry(ws, [methodRec({ method_id: "fixture-retired", status: "retired", retirement_reason: "superseded by a cheaper instrument" })]);
  const engine = makeMethodEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const round = rounds(ws)[0];
  assert.equal(round.methods.mode, "baseline");
  assert.equal(round.methods.evaluated, 1);
  assert.deepEqual(round.methods.included, []);
  assert.equal(round.methods.excluded.length, 1);
  assert.match(round.methods.baseline_reason, /no-eligible-method/);
  assert.ok(!engine.investigator.calls[0].prompt.includes(GUIDANCE_CLAUSE));
});

test("AC (b) — an ACTIVE method GUIDES the production round; ids recorded on the record and in the prompt", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  writeMethodRegistry(ws, [methodRec({ method_id: "fixture-active", status: "active" })]);
  const engine = makeMethodEngine();
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const round = rounds(ws)[0];
  assert.equal(round.methods.mode, "guided");
  assert.equal(round.methods.baseline_reason, null, "a guided round has no baseline reason");
  assert.deepEqual(round.methods.included.map((m) => [m.method_id, m.version, m.status, m.arm]),
    [["fixture-active", 1, "active", METHOD_ARM_PRODUCTION]]);
  assert.ok(round.methods.included[0].guidance_chars > 0, "the size of the guidance handed over is recorded");
  // The protocol: the guidance block is in the prompt, and the engine's frozen instruction is unmodified.
  const inv = engine.investigator.calls.find((c) => c.arm === "production");
  assert.ok(inv.prompt.includes(GUIDANCE_CLAUSE), "the guidance block is prepended to the investigator prompt");
  assert.ok(inv.prompt.includes("read the fixture source"), "…and carries the method's own step text");
  assert.ok(inv.prompt.includes(methodLabel({ method_id: "fixture-active", version: 1 })), "…under the id@vN label");
  assert.ok(inv.prompt.includes("You are an architecture investigator"), "the frozen instruction is still there");
  // The carrier records the guidance per cluster, and the round records the outcome per method.
  const cluster = productionClusters(ws)[0];
  assert.equal(cluster.method_guidance.arm, METHOD_ARM_PRODUCTION);
  assert.deepEqual(cluster.method_guidance.methods, [{ method_id: "fixture-active", version: 1 }]);
  assert.deepEqual(round.methods.outcome.map((o) => o.method_id), ["fixture-active"]);
  assert.equal(round.methods.outcome[0].arm, METHOD_ARM_PRODUCTION);
  assert.equal(round.methods.outcome[0].clusters, 2);
  assert.equal(round.methods.outcome[0].confirmed, 2);
  assert.equal(round.methods.outcome[0].nothing_found, false);
  console.log(`    AC (b): mode=${round.methods.mode} included=${JSON.stringify(round.methods.included.map((m) => methodLabel(m)))}`);
});

test("AC (c) — a DRAFT or TRIAL method guides the SHADOW arm only: records carry shadow:true, nothing reaches Portfolio", async () => {
  // Both non-production statuses, because the AC names both and they must behave identically.
  for (const status of ["draft", "trial"]) {
    const ws = makeWorkspace();
    writeConfig(ws, cfgYaml());
    writeMethodRegistry(ws, [methodRec({ method_id: "fixture-nonproduction", status })]);
    // The production arm answers with NO hypotheses, so anything that reaches the ledgers would have to
    // have come from the shadow arm — which is exactly the claim under test.
    const engine = makeMethodEngine({ productionHyps: [], shadowHyps: HYPS });
    const spawn = countingSpawn();
    const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
    assert.equal(fact.state, "verified");
    const round = rounds(ws)[0];
    // The PRODUCTION arm is unguided: a draft/trial never steers production.
    assert.equal(round.methods.mode, "baseline");
    assert.deepEqual(round.methods.included.map((m) => [m.arm, m.status]), [[METHOD_ARM_SHADOW, status]]);
    const productionInv = engine.investigator.calls.find((c) => c.arm === "production");
    assert.ok(!productionInv.prompt.includes(GUIDANCE_CLAUSE), `the ${status} method's text is NOT in the production prompt`);
    // The SHADOW arm ran, guided, on the same pin, and its records say so.
    assert.equal(round.methods.shadow.shadow, true);
    assert.equal(round.methods.shadow.ran, true);
    assert.deepEqual(round.methods.shadow.methods.map((m) => methodLabel(m)), ["fixture-nonproduction@v1"]);
    assert.equal(round.methods.shadow.calls, 1, "the shadow arm's own call count is recorded");
    const shadowInv = engine.investigator.calls.find((c) => c.arm === "shadow");
    assert.ok(shadowInv.prompt.includes(GUIDANCE_CLAUSE), `the ${status} method's text IS in the shadow prompt`);
    assert.ok(shadowInv.prompt.includes("read the fixture source"));
    assert.equal(shadowInv.cwd, engine.investigator.calls.find((c) => c.arm === "production").cwd, "the shadow arm explores the SAME pin");
    const shadow = shadowClusters(ws);
    assert.equal(shadow.length, 2, "the shadow arm's hypothesis clusters are ON the carrier");
    for (const rec of shadow) {
      assert.equal(rec.shadow, true, "every shadow record is marked shadow:true");
      assert.match(rec.record_id, /#shadow#/);
      assert.equal(rec.confirmed, false, "no verdict is invented for a never-verified shadow hypothesis");
      assert.equal(rec.verifier_verdict, null);
      assert.equal(rec.refutation_verdict, "not-run");
      assert.equal(rec.method_guidance.arm, METHOD_ARM_SHADOW);
    }
    // ⛔ Nothing reaches Portfolio (and nothing reaches the Experience ledger either — the shadow arm is
    // not ingested at all): the production arm found nothing and the shadow arm is structurally excluded.
    assert.deepEqual(portfolioRecords(ws), []);
    assert.deepEqual(experienceRecords(ws), []);
    assert.equal(round.ingestion.checked, 0);
    assert.deepEqual(fact.value.ingestion.writes, [], "the ingestion wrote nothing — the shadow arm is not ingested at all");
    assert.ok(!JSON.stringify(portfolioRecords(ws)).includes("#shadow#"));
    assert.ok(!JSON.stringify(experienceRecords(ws)).includes("#shadow#"), "nor does any Experience point at a shadow record");
    console.log(`    AC (c) [${status}]: mode=${round.methods.mode} shadow.ran=${round.methods.shadow.ran} shadow clusters=${shadow.length} portfolio rows=0`);
  }
});

test("AC (d) — retired / quarantined / contaminated methods are NEVER selected, even as the only record", async () => {
  // (i) RETIRED.
  {
    const ws = makeWorkspace();
    writeConfig(ws, cfgYaml());
    writeMethodRegistry(ws, [methodRec({ method_id: "only-retired", status: "retired", retirement_reason: "cost more than it found" })]);
    const sel = selectMethodsForRound(ws, makeMethodEngine().modules);
    assert.equal(sel.mode, "baseline");
    assert.deepEqual(sel.included, []);
    assert.deepEqual(sel.excluded[0].reasons.filter((r) => r.startsWith("RETIRED")).length, 1);
  }
  // (ii) a DRAFT SUCCESSOR OF A QUARANTINED VERSION — the status is selectable, the lineage is not.
  {
    const ws = makeWorkspace();
    writeConfig(ws, cfgYaml());
    writeMethodRegistry(ws, [
      methodRec({ method_id: "quarantined-ancestor", version: 1, status: "retired", retirement_reason: "QUARANTINE 2026-10-12 (operator): promoted on contaminated holdout evidence" }),
      methodRec({ method_id: "quarantined-ancestor", version: 2, status: "draft", supersedes: "quarantined-ancestor", retirement_reason: null }),
    ]);
    const sel = selectMethodsForRound(ws, makeMethodEngine().modules);
    assert.equal(sel.mode, "baseline");
    assert.deepEqual(sel.included, [], "a draft that supersedes a quarantined version is NOT shadow-eligible");
    const reasons = sel.excluded[0].reasons;
    assert.ok(reasons.some((r) => r.startsWith("QUARANTINED_LINEAGE")), `the quarantine is named (got ${JSON.stringify(reasons)})`);
    assert.equal(sel.excluded[0].status, "draft", "…and it was the selectable STATUS that the lineage overrode");
  }
  // (iii) CONTAMINATED — an `active` method whose promoting verdict is on the contaminated ledger.
  {
    const ws = makeWorkspace();
    writeConfig(ws, cfgYaml());
    writeMethodRegistry(ws, [methodRec({
      method_id: "only-contaminated", status: "active",
      generalization_evidence: { verdict_ref: "verdict-fixture", held_out_case_id: "CASE-x" },
    })]);
    writeContaminatedVerdict(ws, { verdict_id: "verdict-fixture" });
    const sel = selectMethodsForRound(ws, makeMethodEngine().modules);
    assert.equal(sel.mode, "baseline");
    assert.deepEqual(sel.included, [], "a contaminated `active` method never guides production");
    assert.ok(sel.excluded[0].reasons.some((r) => r.startsWith("CONTAMINATED_PROMOTION")), JSON.stringify(sel.excluded[0].reasons));
  }
  // (iv) the same three, in a ROUND: never selected ⇒ nothing is appended under their names, and the
  //      round still runs baseline.
  {
    const ws = makeWorkspace();
    writeConfig(ws, cfgYaml());
    writeMethodRegistry(ws, [methodRec({ method_id: "only-retired", status: "retired", retirement_reason: "QUARANTINE 2026-10-12 (operator): unsound evidence" })]);
    const engine = makeMethodEngine();
    const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: countingSpawn(), pinFn: pinStub() });
    assert.equal(fact.state, "verified", "the round RUNS even when the only method is unselectable");
    const round = rounds(ws)[0];
    assert.equal(round.methods.mode, "baseline");
    assert.equal(round.methods.shadow.ran, false);
    assert.deepEqual(shadowClusters(ws), [], "no shadow arm was run for it");
    assert.equal(productionClusters(ws)[0].method_guidance, null);
  }
  console.log("    AC (d): retired, quarantined-lineage and contaminated methods each excluded as the only record; the round still ran baseline");
});

test("AC (e) — a guidance text naming a Registered seed component (or case id) ⇒ excluded, with the value named", async () => {
  // The method does NOT cite the Experience that names `secret-fixture.ts` — so the registry's own
  // seed rule (which scans a record against its OWN provenance) never sees it. The guidance scan uses
  // the ledger's UNION deny-list, which is exactly the hole this closes.
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  writeExperienceLine(ws, { case_id: "EXP-secret", components: ["plugin/scripts/secret-fixture.ts"] });
  writeMethodRegistry(ws, [
    methodRec({ method_id: "leaky", status: "active", operation: { steps: ["open secret-fixture.ts and read the parser"], tools: [] } }),
    methodRec({ method_id: "clean", status: "active" }),
  ]);
  const sel = selectMethodsForRound(ws, makeMethodEngine().modules);
  const leaky = sel.excluded.find((m) => m.method_id === "leaky");
  assert.ok(leaky, `the leaky method is excluded (included: ${JSON.stringify(sel.included.map((m) => m.method_id))})`);
  const leak = leaky.reasons.find((r) => r.startsWith("GUIDANCE_TEXT_NAMES_SEED"));
  assert.ok(leak, `the refusal is the seed-leak code (got ${JSON.stringify(leaky.reasons)})`);
  assert.ok(leak.includes("secret-fixture.ts"), `the refusal NAMES the leaking value (got ${leak})`);
  // The clean method beside it is unaffected: this is a per-record judgment, not a kill switch.
  assert.deepEqual(sel.included.map((m) => m.method_id), ["clean"]);
  assert.equal(sel.mode, "guided");
  // And the leaky text really would have leaked: the deny-list flags it directly, so the exclusion is a
  // reading rather than a guess.
  const denied = realLedger.experienceDenyList(ws);
  assert.equal(realLedger.scanExperienceLeak(denied, realRegistry.methodGuidanceText(methodRec({ method_id: "leaky", status: "active", operation: { steps: ["open secret-fixture.ts and read the parser"], tools: [] } }))).flagged, true);
  console.log(`    AC (e): excluded ${leaky.method_id} ⇒ ${leak}`);
});

test("AC (f) — the shadow arm's calls reserve against the SAME 24h ledger as every other step", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  writeMethodRegistry(ws, [methodRec({ method_id: "fixture-draft", status: "draft" })]);
  const engine = makeMethodEngine({ productionHyps: [], shadowHyps: HYPS });
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const steps = resumeSteps(ws);
  assert.deepEqual(steps, ["investigator", "shadow-investigator"], `the shadow call is a RESERVATION in the round's own ledger (got ${steps.join(",")})`);
  assert.equal(spawn.calls.length, steps.length, "one spawn per reservation — including the shadow arm's");
  const reserve = ledgerReserves(ws).find((r) => r.step === "shadow-investigator");
  assert.equal(reserve.tools, INVESTIGATOR_TOOLS);
  assert.equal(Number(reserve.max_turns) >= 1, true, "the shadow subprocess is bounded like every other one");
  // ONE ledger: the same file the round already reports, and the round's own call count includes it.
  const round = rounds(ws)[0];
  assert.equal(round.reservations.ledger, BUDGET_LEDGER_REL);
  assert.equal(round.model_calls, steps.length, "the shadow call is counted in the round's own totals");
  assert.equal(round.calls.map((c) => c.step).includes("shadow-investigator"), true);
  console.log(`    AC (f): reservations in ${round.reservations.ledger} = ${steps.join(",")}`);
});

test("AC (g) — a guided round's outcome is ingested as an Experience naming the method id and version", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  writeMethodRegistry(ws, [methodRec({ method_id: "fixture-active", version: 1, status: "active" })]);
  const engine = makeMethodEngine();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const label = "fixture-active@v1";
  const experiences = experienceRecords(ws);
  assert.ok(experiences.length > 0, "the guided round's confirmed clusters became Experiences");
  for (const e of experiences) {
    assert.ok(String(e.summary).includes(`guided by method ${label}`), `the Experience names the method (${e.summary})`);
    assert.equal(e.source_ref.includes("#shadow#"), false, "…and it is a PRODUCTION record");
  }
  // The Portfolio row carries the same name in the field the coverage map reads.
  const rows = portfolioRecords(ws);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.method_ref, label);
  // The round's own per-method outcome block closes the loop: the carrier line carries the OUTCOME
  // counts (novel/duplicate/refuted/nothing-found) as appended, and the post-ingestion Experience and
  // Portfolio counts ride the Fact — the same asymmetry `ingestion.writes` has, and for the same reason
  // (the carrier line is written before the writes happen, and appending must stay append-only).
  const round = rounds(ws)[0];
  assert.equal(round.methods.outcome[0].nothing_found, false);
  assert.equal(round.methods.outcome[0].novel, 2);
  assert.equal(fact.value.methods.outcome[0].experiences, experiences.length);
  assert.equal(fact.value.methods.outcome[0].portfolio_rows, rows.length);
  console.log(`    AC (g): ${experiences.length} Experience(s) and ${rows.length} Portfolio row(s) name ${label}`);
});

test("AC — REAL registry reading: selection against the PRODUCTION registry, with reasons", async () => {
  // ⛔ This reads the LIVE registry, so the assertions are INVARIANTS that hold whatever the registry
  // currently contains (a pin on "0 active" would red the suite the day a method is promoted) — and it
  // PRINTS the full reading, which is the AC's evidence.
  const mods = await loadOpenDiscoveryModules(REPO_ROOT);
  const sel = selectMethodsForRound(REPO_ROOT, mods);
  assert.equal(sel.ok, true, "the production registry is readable");
  for (const m of sel.production) assert.equal(m.status, "active", "only an ACTIVE method may guide production");
  for (const m of sel.included) assert.ok(m.status === "active" || m.status === "draft" || m.status === "trial", `selectable status (got ${m.status})`);
  for (const m of sel.excluded) {
    const q = mods.registry.quarantinedLineageOf(mods.registry.readMethodRegistry(REPO_ROOT).latest.find((r) => r.method_id === m.method_id) ?? {}, mods.registry.readMethodRegistry(REPO_ROOT, { history: true }).history ?? []);
    if (q.quarantined) {
      assert.ok(m.reasons.some((r) => r.startsWith("QUARANTINED_LINEAGE") || r.startsWith("RETIRED")),
        `a quarantined method is excluded with a refusal that shows it: ${m.method_id} ⇒ ${JSON.stringify(m.reasons)}`);
    }
  }
  const lines = [
    `    AC real-registry: ok=${sel.ok} mode=${sel.mode} evaluated=${sel.evaluated}`,
    `      baseline_reason: ${sel.baseline_reason ?? "<guided>"}`,
    `      registry: ${JSON.stringify(sel.registry)}`,
    ...sel.included.map((m) => `      INCLUDED ${methodLabel(m)} [${m.arm}] guidance_chars=${m.guidance_chars}`),
    ...sel.excluded.map((m) => `      EXCLUDED ${m.method_id}@v${m.version ?? "?"} (${m.status}) ⇒ ${m.reasons.join("; ")}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  assert.equal(sel.evaluated, sel.included.length + sel.excluded.length, "every latest version is classified");
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
  // The Core read surface the routine imports (`../../packages/quay/src/cli/task-log.ts`) is a REAL
  // relative import from the mutated file, so the scratch root needs `packages/` reachable too. Its own
  // imports then resolve against the symlink's realpath, so nothing deeper has to be mirrored.
  fs.symlinkSync(path.join(REPO_ROOT, "packages"), path.join(dir, "packages"));
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
    .replace("      const confirmed = row.verdict === \"supported\" && refutationRead.verdict === \"supported\" && refutationRead.undetermined_cause === null;",
      "      const confirmed = row.verdict === \"supported\";")
    .replace("      if (row.verdict === \"supported\") {", "      if (false) {"));
  const mutant = await import(pathToFileURL(mutantPath).href);
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // The SAME fixture that makes (g) green on the real module: verifier supports, refuter refutes.
  const engine = makeEngine({ verdictFor: (ci, o) => (isRefuterPrompt(o) ? "refuted" : "supported") });
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
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
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

test("NEGATIVE CONTROL (d) — ignore the quarantine walk in a scratch copy ⇒ the (d) claim goes RED", async () => {
  // The mutation is EXACTLY "selection ignores the quarantine list": the lineage walk still runs (its
  // call site is untouched) but its answer is a constant, so a draft that supersedes a QUARANTINEd
  // version looks selectable. Nothing else changes.
  const MUT_ANCHOR = "      const q = modules.registry.quarantinedLineageOf(rec, history);";
  const mutantPath = scratchModule((src) => {
    assert.ok(src.includes(MUT_ANCHOR), "the quarantine-walk anchor is present");
    return src.replace(MUT_ANCHOR, "      const q = { quarantined: false, versions: [], reasons: [] }; // MUTATION: the quarantine list is ignored");
  });
  const mutant = await import(pathToFileURL(mutantPath).href);
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  writeMethodRegistry(ws, [
    methodRec({ method_id: "quarantined-ancestor", version: 1, status: "retired", retirement_reason: "QUARANTINE 2026-10-12 (operator): promoted on contaminated holdout evidence" }),
    methodRec({ method_id: "quarantined-ancestor", version: 2, status: "draft", supersedes: "quarantined-ancestor", retirement_reason: null }),
  ]);
  const modules = makeMethodEngine().modules;
  // On the REAL module the successor is excluded and never selected (the AC (d) claim).
  const real = selectMethodsForRound(ws, modules);
  assert.deepEqual(real.included, [], "the real module refuses it");
  // The mutant selects it: the (d) claim is FALSIFIED, so the control is live.
  const mutated = mutant.selectMethodsForRound(ws, modules);
  assert.deepEqual(mutated.included.map((m) => [m.method_id, m.arm]), [["quarantined-ancestor", METHOD_ARM_SHADOW]],
    "⇒ the (d) claim («a quarantined lineage is NEVER selected») is FALSIFIED — the control is live");
  // The only difference is where the successor lands: excluded on the real module, selected on the mutant.
  assert.deepEqual(real.excluded.map((m) => m.method_id), ["quarantined-ancestor"]);
  assert.deepEqual(mutated.excluded, [], "the mutant excludes nothing — the successor moved into `included`");
  process.stdout.write(`    NEGATIVE CONTROL (d): mutant SELECTED ${mutated.included.map((m) => methodLabel(m)).join(",")} for the shadow arm (claim was «never selected, even as the only record»); the real module excluded it via ${real.excluded[0].reasons.join("; ")}\n`);
});

// ── THE PAIRED BASELINE-VS-GUIDED GAIN ROUND (task gap-open-discovery-periodic-baseline-vs-guided-gain)
//
// Coverage map for this task's Acceptance Criteria:
//   (a) arms with DIFFERENT budgets                        ⇒ refused
//   (b) a pre-registration written AFTER the first call    ⇒ refused
//   (c) a NEGATIVE gain is recorded as negative
//   (d) duplicates and refuted findings never count as net-new, in EITHER arm
//   (e) a paired-round record cannot be read as `independent` by the PROMOTION PATH
//   (f) no eligible method                                 ⇒ `not-evaluated:no-eligible-method`
// plus the round-level wiring (both arms really run, the baseline arm files nothing) and the
// in-scratch-copy NEGATIVE CONTROL the task names for (e).

const gainRecords = (ws) => carrierLines(ws).filter((l) => l.kind === GAIN_RECORD_KIND);
const gainSummaries = (ws) => carrierLines(ws).filter((l) => l.kind === GAIN_SUMMARY_KIND);
const baselineClusters = (ws) => carrierLines(ws).filter((l) => l.kind === "cluster" && l.paired_arm === PAIRED_ARM_BASELINE);
const preregFile = (ws) => path.join(ws, PREREG_REL);

/** A REAL (empty) git directory — a valid STRIPPED pin for the promotion-path cases, which read a pin
 *  rather than materialising one. */
function mkGitTmp() {
  const d = tmpDir("paired-pin-");
  spawnSync("git", ["init", "-q"], { cwd: d, encoding: "utf8", env: GIT_ENV });
  return d;
}

/** The promotion path's OWN fixtures: a draft candidate and a held-out case whose role demands
 *  `refuted`. Shaped like the ones `discovery-reflection.test.mjs` uses, so the reading is comparable. */
const promotionCandidate = (over = {}) => ({
  kind: "method", method_id: "paired-fixture-method", version: 1,
  provenance_evidence: ["experience-inbatch000000"],
  applicability: { domain_signals: ["fixture domain signal"], preconditions: ["a fixture precondition holds"] },
  operation: { steps: ["read the fixture source"], tools: [] },
  expected_invariant: "the fixture invariant holds at every call site",
  falsification: "a call site violates the fixture invariant",
  cost_budget: { max_candidates: 1, max_model_calls: 0, max_wall_ms: 1000 },
  status: "draft", retirement_reason: null, supersedes: null,
  ...over,
});
const promotionHeldOut = (over = {}) => ({
  kind: "experience", id: "experience-heldout0000000", case_id: "EXP-heldout",
  ts: "2026-10-12T00:00:00.000Z", role: "confirmed-negative", reported_by: "system",
  source_ref: "outcome-heldout00000000", evidence: [{ ref: "outcome-heldout00000000", sha256: "0".repeat(64) }],
  components: ["plugin/scripts/heldout.ts"],
  summary: "a held-out fixture case whose summary clears the ledger's own floor comfortably",
  evaluation_pin: "1".repeat(40),
  ...over,
});
const promotionModel = (obj, counter = null) => async () => {
  if (counter) counter.calls++;
  return { stdout: typeof obj === "string" ? obj : JSON.stringify(obj), status: 0 };
};
const CORRECT_REFUTATION = { invariant_holds: false, verdict: "refuted", reasoning: "the claim does not hold" };

/** A SCRATCH copy of the PROMOTION PATH whose relative imports still resolve (siblings symlinked, the
 *  module itself a real mutated file). Used only by the (e) negative control. */
function scratchReflectionModule(mutate) {
  const dir = tmpDir("reflection-mutant-");
  const analysis = path.join(dir, "docs", "analysis");
  fs.mkdirSync(analysis, { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"));
  for (const f of fs.readdirSync(path.join(REPO_ROOT, "docs", "analysis"))) {
    if (f === "discovery-reflection.mjs") continue;
    fs.symlinkSync(path.join(REPO_ROOT, "docs", "analysis", f), path.join(analysis, f));
  }
  const src = fs.readFileSync(path.join(REPO_ROOT, "docs", "analysis", "discovery-reflection.mjs"), "utf8");
  const out = mutate(src);
  assert.notEqual(out, src, "the mutation control must actually change the source");
  const p = path.join(analysis, "discovery-reflection.mjs");
  fs.writeFileSync(p, out, "utf8");
  return p;
}

/** The DECLARED section as a raw object, so a case can add a key the YAML fixture does not emit. */
const rawSection = (over = {}) => {
  const out = { enabled: true };
  for (const [k, v] of SECTION_KEYS) {
    if (k === "enabled") continue;
    out[k] = v === "true" ? true : (v === "false" ? false : (/^-?\d+$/.test(v) ? Number(v) : v));
  }
  return { ...out, ...over };
};

test("AC (gain-config) — `gain_every_rounds` is OPTIONAL (absent ⇒ the stated default), and an integer >= 1 when declared", () => {
  const absent = parseOpenSemanticDiscoverySection(rawSection());
  assert.equal(absent.error, null);
  assert.equal(absent.config.gainEveryRounds, DEFAULT_GAIN_EVERY_ROUNDS,
    "a section written before the paired instrument existed still parses to the stated cadence");
  assert.equal(DEFAULT_GAIN_EVERY_ROUNDS, 6, "the stated default is six eligible rounds");
  const declared = parseOpenSemanticDiscoverySection(rawSection({ gain_every_rounds: 3 }));
  assert.equal(declared.error, null);
  assert.equal(declared.config.gainEveryRounds, 3);
  const viaYaml = makeWorkspace();
  writeConfig(viaYaml, cfgYaml({ gain_every_rounds: "3" }));
  assert.equal(readOpenSemanticDiscoveryConfig(viaYaml).config.gainEveryRounds, 3, "…and the key is read off `.quay/config.yml`");
  // ⛔ `0` is REFUSED: an omitted key and a `0` would otherwise mean the same thing while only one of
  // them is STATED, so "the instrument was switched off" could not be told from "nobody declared it".
  const zero = parseOpenSemanticDiscoverySection(rawSection({ gain_every_rounds: 0 }));
  assert.equal(zero.config, null);
  assert.match(zero.error, /gain_every_rounds/);
  const bogus = parseOpenSemanticDiscoverySection(rawSection({ gain_every_rounds: 1.5 }));
  assert.equal(bogus.config, null, "a non-integer cadence is a config error, not a rounding");
  process.stdout.write(`    AC (gain-config): absent ⇒ ${String(absent.config.gainEveryRounds)}; declared 3 ⇒ ${String(declared.config.gainEveryRounds)}; 0 ⇒ ${String(zero.error)}\n`);
});

test("AC (a) — arms with DIFFERENT budgets are refused, naming every field that differs", () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const cfg = readOpenSemanticDiscoveryConfig(ws).config;
  const same = pairedArmBudget(cfg);
  assert.equal(pairedBudgetRefusal(same, pairedArmBudget(cfg)), null, "one config read twice ⇒ one envelope");
  const other = { ...same, max_clusters_verified: same.max_clusters_verified + 1 };
  const refusal = pairedBudgetRefusal(same, other);
  assert.ok(refusal, "a differing envelope must be REFUSED — the comparison would not be controlled");
  assert.equal(refusal.code, "PAIRED_ARM_BUDGETS_DIFFER");
  assert.deepEqual(refusal.reasons, [`PAIRED_ARM_BUDGETS_DIFFER:max_clusters_verified:${same.max_clusters_verified}!=${other.max_clusters_verified}`]);
  // …and a DIFFERENT turns bound is caught too, not just the cluster cap.
  const turns = pairedBudgetRefusal(same, { ...same, verifier_max_turns: same.verifier_max_turns + 4 });
  assert.ok(turns.reasons.some((r) => r.startsWith("PAIRED_ARM_BUDGETS_DIFFER:verifier_max_turns")));
  process.stdout.write(`    AC (a): ${JSON.stringify(refusal.reasons)}\n`);
});

test("AC (b) — a pre-registration written AFTER the first call is refused; older-than ⇒ clean", () => {
  const keys = pairedPreregKeys({ baselinePrompt: "b", guidedPrompt: "g", inventory: "i", budget: "u" });
  const prereg = { hashes: keys };
  const callAt = 1_000_000;
  // (i) the pre-registration PRECEDES the call: clean.
  assert.equal(pairedPreregRefusal({
    prereg, preregMtimeMs: callAt - 5_000, expected: keys, armCallMtimesMs: [callAt],
    preregRefusalFn: realHyp.preregRefusal,
  }), null);
  // (ii) it was written AFTER the first call: refused, with the engine's own reason.
  const late = pairedPreregRefusal({
    prereg, preregMtimeMs: callAt + 1, expected: keys, armCallMtimesMs: [callAt],
    preregRefusalFn: realHyp.preregRefusal,
  });
  assert.ok(late, "a pre-registration newer than the call it scores is a post-hoc rationalisation");
  assert.ok(late.reasons.includes("PREREG_NOT_OLDER_THAN_RUNS"), `⇒ ${JSON.stringify(late.reasons)}`);
  // …and the SAME mtime is refused too: "not older" is not "older".
  const equal = pairedPreregRefusal({
    prereg, preregMtimeMs: callAt, expected: keys, armCallMtimesMs: [callAt],
    preregRefusalFn: realHyp.preregRefusal,
  });
  assert.ok(equal.reasons.includes("PREREG_NOT_OLDER_THAN_RUNS"));
  // A hash that does not match the arm's actual prompt is its own refusal (the engine's vocabulary).
  const mismatched = pairedPreregRefusal({
    prereg: { hashes: { ...keys, [`${PAIRED_ARM_GUIDED}-prompt`]: "not-the-guided-prompt" } },
    preregMtimeMs: callAt - 1, expected: keys, armCallMtimesMs: [callAt],
    preregRefusalFn: realHyp.preregRefusal,
  });
  assert.ok(mismatched.reasons.includes(`PREREG_HASH_MISMATCH:${PAIRED_ARM_GUIDED}-prompt`));
  // ⛔ 硬规则 3b: with NO call time there is nothing to be older than, so the answer is its OWN refusal
  // rather than a pass — an unverifiable pre-registration must not read as a verified one.
  const unverifiable = pairedPreregRefusal({ prereg, preregMtimeMs: callAt - 1, expected: keys, armCallMtimesMs: [], preregRefusalFn: realHyp.preregRefusal });
  assert.equal(unverifiable.code, "PAIRED_PREREG_UNVERIFIABLE");
  process.stdout.write(`    AC (b): late-reprereg ⇒ ${JSON.stringify(late.reasons)}; no-call-time ⇒ ${unverifiable.code}\n`);
});

test("AC (c) — a NEGATIVE gain is recorded as negative (for the round's metrics AND its USD)", () => {
  const counts = (arm, over = {}) => ({
    arm, confirmed_net_new: 0, duplicates: 0, refuted: 0, undetermined: 0, confirmed_total: 0,
    nothing_found: true, model_calls: 0, usd: 0, ...over,
  });
  const baseline = counts(PAIRED_ARM_BASELINE, { confirmed_net_new: 3, confirmed_total: 3, nothing_found: false, usd: 0.4, model_calls: 6 });
  const guided = counts(PAIRED_ARM_GUIDED, { confirmed_net_new: 1, confirmed_total: 1, nothing_found: false, duplicates: 2, refuted: 1, usd: 0.9, model_calls: 9 });
  const gain = gainOf(baseline, guided);
  assert.equal(gain.net_new, -2, "guidance found FEWER net-new findings ⇒ a real −2, never clamped to 0");
  assert.equal(gain.duplicates, 2);
  assert.equal(gain.refuted, 1);
  assert.ok(gain.usd > 0, "…and the USD gain is signed the same way (guidance cost more here)");
  // The record carries the signed value, not a magnitude: a reader must be able to see the SIGN.
  const rec = buildGainRecord({
    roundTs: "2026-10-12T00:00:00.000Z", invokedBy: INVOKED_BY_RESIDENT, pinRev: "0".repeat(40),
    inventorySha: "a".repeat(64),
    prereg: { path: ".quay/x.json", mtime_ms: 1, keys: ["inventory"], refusal: null },
    budget: { investigator_runs: 1, max_clusters_verified: 3, investigator_max_turns: 12, verifier_max_turns: 8, refutation_max_turns: 6 },
    budgetLedgerRel: ".quay/ledger.jsonl", baseline, guided, guidedBy: ["m@v1"], ordinal: 6, everyRounds: 6,
  });
  assert.equal(rec.gain.net_new, -2);
  assert.equal(rec.arms[PAIRED_ARM_BASELINE].confirmed_net_new, 3);
  assert.equal(rec.arms[PAIRED_ARM_GUIDED].confirmed_net_new, 1);
  // ⛔ …and the ROLLING SUMMARY lists the raw series rather than a smoothed score.
  const later = buildGainRecord({
    roundTs: "2026-10-12T06:00:00.000Z", invokedBy: INVOKED_BY_RESIDENT, pinRev: "0".repeat(40),
    inventorySha: null, prereg: { path: null, mtime_ms: null, keys: [], refusal: null },
    budget: { investigator_runs: 1, max_clusters_verified: 3, investigator_max_turns: 12, verifier_max_turns: 8, refutation_max_turns: 6 },
    budgetLedgerRel: ".quay/ledger.jsonl", baseline: counts(PAIRED_ARM_BASELINE, { confirmed_net_new: 1, confirmed_total: 1, nothing_found: false }),
    guided: counts(PAIRED_ARM_GUIDED, { confirmed_net_new: 4, confirmed_total: 4, nothing_found: false }), guidedBy: [], ordinal: 12, everyRounds: 6,
  });
  const rollup = gainRollup([{ kind: "scan-round", paired: { not_evaluated: PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD } }, rec, later]);
  assert.deepEqual(rollup.series.net_new, [-2, 3], "every round's own value, in order — not a blended number");
  assert.equal(rollup.totals.net_new, 1);
  assert.equal(rollup.negative_rounds.net_new, 1, "the negative round is COUNTED, not smoothed away");
  assert.deepEqual(rollup.not_evaluated, { [PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD]: 1 }, "the unmeasured round is its own count, never a 0");
  assert.match(String(rollup.smoothing), /no single blended score/);
  process.stdout.write(`    AC (c): gain=${JSON.stringify(rec.gain)}; rollup.series.net_new=${JSON.stringify(rollup.series.net_new)} totals=${JSON.stringify(rollup.totals)}\n`);
});

test("AC (d) — duplicates and refuted findings never count as net-new, in EITHER arm", () => {
  const cluster = (i, over = {}) => ({ cluster: i, confirmed: true, ...over });
  const clusters = [
    cluster(1),                                                             // confirmed, novel ⇒ net-new
    cluster(2),                                                             // confirmed, judge says duplicate
    cluster(3, { verifier_verdict: "refuted", confirmed: false }),          // refuted by the FIRST verifier
    cluster(4, { refutation_verdict: "refuted", confirmed: false }),        // refuted by the REFUTER
    cluster(5, { verifier_verdict: "undetermined", confirmed: false }),     // neither confirmed nor refuted
    cluster(6),                                                             // confirmed, UNJUDGED by the novelty call
    cluster(7, { refutation_verdict: "refuted", confirmed: false }),        // refuted AND disposition "novel"
  ];
  const novelty = [
    { cluster: 1, disposition: "novel" },
    { cluster: 2, disposition: "duplicate" },
    { cluster: 3, disposition: "novel" },          // a refuted cluster can never be counted, whatever it says
    { cluster: 6, disposition: "unjudged" },
    { cluster: 7, disposition: "novel" },          // …and neither can one the refuter refused
  ];
  for (const arm of PAIRED_ARMS) {
    const counts = pairedArmCounts({ arm, clusters, novelty, calls: [{ cost_charged_usd: 0.25 }] });
    assert.equal(counts.confirmed_net_new, 1,
      `arm ${arm}: ONLY the confirmed-and-novel cluster is net-new (got ${counts.confirmed_net_new})`);
    assert.equal(counts.refuted, 3, "both verifier verdicts are compared, and a refuted cluster is never confirmed");
    assert.equal(counts.duplicates, 1);
    assert.equal(counts.undetermined, 1, "«neither confirmed nor refuted» is its own count, not folded into refuted");
    assert.equal(counts.usd, 0.25);
  }
  // The NEGATIVE CONTROL on the same predicate: a cluster marked confirmed AND refuted is still not
  // net-new, because the net-new rule requires the novelty disposition `novel` (not merely `confirmed`).
  const poisoned = pairedArmCounts({ arm: PAIRED_ARM_BASELINE, clusters: [cluster(1, { refutation_verdict: "refuted" })], novelty: [{ cluster: 1, disposition: "novel" }], calls: [] });
  assert.equal(poisoned.confirmed_net_new, 0, "a refuted cluster recorded as confirmed is STILL not net-new");
  assert.equal(poisoned.refuted, 1);
  process.stdout.write(`    AC (d): per-arm net-new=${pairedArmCounts({ arm: PAIRED_ARM_GUIDED, clusters, novelty, calls: [] }).confirmed_net_new} from ${clusters.length} clusters (1 novel, 1 duplicate, 3 refuted, 1 undetermined, 1 unjudged)\n`);
});

test("AC (f) — no eligible method ⇒ `not-evaluated:no-eligible-method`, NEVER a zero gain", async () => {
  // (i) PURE: the decision itself.
  const none = pairedRoundDecision({ eligibleRounds: 5, gainEveryRounds: 6, eligibleMethods: 0 });
  assert.equal(none.due, false);
  assert.equal(none.reason, PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD);
  assert.equal(none.ordinal, 6, "where the cadence stands is still reported");
  // (ii) …and the M-th round WITH an eligible method IS due (the non-zero control on the same predicate).
  const due = pairedRoundDecision({ eligibleRounds: 5, gainEveryRounds: 6, eligibleMethods: 1 });
  assert.equal(due.due, true);
  assert.equal(due.ordinal, 6);
  assert.equal(pairedRoundDecision({ eligibleRounds: 0, gainEveryRounds: 6, eligibleMethods: 1 }).due, false);

  // (iii) ROUND-LEVEL: a round with no eligible method records the token and writes NO gain record.
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ gain_every_rounds: "1" }));   // due on the very first eligible round
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeMethodEngine() }), spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(fact.state, "verified");
  const round = rounds(ws)[0];
  assert.equal(round.methods.mode, "baseline");
  assert.equal(round.paired.due, false);
  assert.equal(round.paired.not_evaluated, PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD);
  assert.equal(round.paired.gain, null);
  assert.equal(gainRecords(ws).length, 0, "no eligible method ⇒ no gain record at all (NOT a gain of 0)");
  assert.equal(eligibleRoundsOf(carrierLines(ws)), 0, "a baseline round is not an ELIGIBLE round");
  assert.match(fact.reason, /not-evaluated:no-eligible-method/);
  process.stdout.write(`    AC (f): round.paired=${JSON.stringify({ due: round.paired.due, ordinal: round.paired.ordinal, not_evaluated: round.paired.not_evaluated })} gain_records=${gainRecords(ws).length}\n`);
});

test("WIRING — a due paired round runs BOTH arms on one pin and files only the guided one", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ gain_every_rounds: "1" }));
  writeMethodRegistry(ws, [methodRec({ method_id: "fixture-active", status: "active" })]);
  // The arms answer DIFFERENTLY, identified structurally by their runs directory: the unguided arm
  // finds TWO clusters, the guided arm only ONE. Nothing here inspects a prompt to decide the arm.
  const engine = makePairedEngine({ guidedHyps: [HYPS[0]], baselineHyps: HYPS });
  const spawn = countingSpawn();
  const pin = pinStub();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pin });
  assert.equal(fact.state, "verified");
  const round = rounds(ws)[0];
  assert.equal(round.paired.due, true);
  assert.equal(round.paired.ordinal, 1);
  assert.equal(round.paired.not_evaluated, null, "a measured pair carries no not-evaluated token");

  // BOTH arms ran, on the SAME pin, with the SAME model and the SAME budget envelope.
  assert.deepEqual(engine.investigator.calls.map((c) => c.arm), [PAIRED_ARM_GUIDED, PAIRED_ARM_BASELINE]);
  for (const c of engine.investigator.calls) assert.equal(c.cwd, pin.pins[0], "both arms are rooted at the ONE pin");
  assert.deepEqual(round.paired.budget, pairedArmBudget(readOpenSemanticDiscoveryConfig(ws).config));
  const steps = resumeSteps(ws);
  assert.ok(steps.includes("baseline-investigator"), "the unguided arm's investigator reserved under its OWN step name");
  assert.ok(steps.includes("baseline-verifier") && steps.includes("baseline-refuter") && steps.includes("baseline-novelty-check"),
    `the whole pipeline runs per arm (steps: ${JSON.stringify(steps)})`);

  // The arms' records are distinguishable, and the baseline arm's id can never resolve as production's.
  const base = baselineClusters(ws);
  assert.equal(base.length, 2, "the baseline arm's clusters ride the carrier (so a reviewer can read them)");
  for (const c of base) {
    assert.equal(c.paired, true);
    assert.ok(String(c.record_id).includes("#baseline#"), `a baseline record carries its own id segment (${c.record_id})`);
    assert.equal(openBaselineDiscoveryRecordId("T", 1), `${OPEN_DISCOVERY_REF_PREFIX}T#baseline#1`);
  }
  // The GUIDED arm's clusters (production, not baseline): `productionClusters` above is the
  // method-guidance helper and would also catch the baseline arm's, which are marked the same way.
  const guidedClusters = carrierLines(ws).filter((l) => l.kind === "cluster" && l.shadow !== true && l.paired_arm !== PAIRED_ARM_BASELINE);
  assert.deepEqual(guidedClusters.map((c) => c.paired_arm), [PAIRED_ARM_GUIDED]);
  assert.deepEqual(guidedClusters.map((c) => c.method_guidance.methods), [[{ method_id: "fixture-active", version: 1 }]],
    "the guided arm's clusters carry their method attribution");
  for (const c of baselineClusters(ws)) assert.equal(c.method_guidance, null, "…and the BASELINE arm's carry none");

  // ⛔ NOTHING the BASELINE arm found reaches the ledgers — an instrument measures, it does not file.
  assert.equal(baselineClusters(ws).length, 2);
  assert.equal(portfolioRecords(ws).length, 1, "one Portfolio row — the GUIDED arm's one confirmed cluster");
  assert.equal(experienceRecords(ws).length, 1);
  for (const row of portfolioRecords(ws)) assert.ok(!String(row.origin_ref).includes("#baseline#"), "no Portfolio row resolves a baseline record");

  // The gain record: both arms' counts, the signed gain, and the level that forbids reading it as proof.
  const gains = gainRecords(ws);
  assert.equal(gains.length, 1);
  const g = gains[0];
  assert.equal(g.evidence_level, PRODUCTION_OPEN_EVIDENCE_LEVEL);
  assert.equal(g.counts_as_independent_evidence, false);
  assert.equal(g.promotion.licenses, "nothing");
  assert.equal(g.arms[PAIRED_ARM_BASELINE].confirmed_net_new, 2);
  assert.equal(g.arms[PAIRED_ARM_GUIDED].confirmed_net_new, 1);
  assert.equal(g.gain.net_new, -1, "guidance found FEWER net-new findings here ⇒ a recorded −1");
  assert.deepEqual(g.guided_by, ["fixture-active@v1"]);
  assert.equal(g.budget.shared_by_arms, true);
  assert.match(String(g.budget.ledger), /open-semantic-discovery-model-budget\.jsonl$/, "both arms reserve from the ONE 24h ledger");
  // The pre-registration EXISTS, precedes the calls, and names the two arms' prompt digests.
  assert.ok(fs.existsSync(preregFile(ws)), "the pre-registration is on disk");
  const prereg = JSON.parse(fs.readFileSync(preregFile(ws), "utf8"));
  assert.deepEqual(prereg.arms, [...PAIRED_ARMS]);
  assert.deepEqual(Object.keys(prereg.hashes).sort(), [`${PAIRED_ARM_BASELINE}-prompt`, `${PAIRED_ARM_GUIDED}-prompt`, "budget", "inventory"].sort());
  assert.notEqual(prereg.hashes[`${PAIRED_ARM_BASELINE}-prompt`], prereg.hashes[`${PAIRED_ARM_GUIDED}-prompt`],
    "the two arms' prompts really differ (the guidance block is the difference)");
  assert.equal(g.prereg.refusal, null);
  // …and it PROVABLY precedes the pair's first call — the property the mtime rule exists to check, read
  // off the reservation ledger rather than off the round's own report of itself.
  const firstReserve = ledgerReserves(ws).find((l) => l.step === "investigator");
  assert.ok(firstReserve, "the guided arm's first call was reserved");
  assert.ok(Date.parse(firstReserve.ts) > fs.statSync(preregFile(ws)).mtimeMs,
    `the pre-registration (${fs.statSync(preregFile(ws)).mtimeMs}) must be OLDER than the first call (${firstReserve.ts})`);
  // The rolling summary is appended beside it, as a series rather than a score.
  const summaries = gainSummaries(ws);
  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0].series.net_new, [-1]);
  assert.deepEqual(summaries[0].totals.net_new, -1);
  assert.equal(summaries[0].paired_rounds, 1);
  // …and the round's OWN fact says which arm produced what, without inventing a gain.
  assert.match(fact.reason, /PAIRED round 1: baseline 2 net-new/);
  process.stdout.write(`    wiring: ${fact.reason.slice(fact.reason.indexOf("PAIRED round"))}\n`);
});

test("AC (e) — a paired-round record is NOT independent evidence: the promotion path caps it at trial", async () => {
  // The record's OWN declared level, and the promotion path's OWN predicate over it.
  const grant = { evidence_level: PRODUCTION_OPEN_EVIDENCE_LEVEL, counts_as_independent_evidence: false };
  assert.equal(grant.evidence_level, "production-open");
  assert.equal(promotionStatusForLevel(grant.evidence_level), PROMOTION_REPORT_ONLY_STATUS);
  assert.notEqual(promotionStatusForLevel(grant.evidence_level), "active");
  // The non-zero control on the SAME predicate: an `independent` verdict DOES reach `active`.
  assert.equal(promotionStatusForLevel("independent"), "active");

  // …and END-TO-END through the REAL promotion path: a CORRECT prediction at this level promotes the
  // candidate to a report-only state, which `activeMethods()` never hands to a consumer.
  const vg = await validateGeneralization({
    candidate: promotionCandidate(), heldOutCase: promotionHeldOut(),
    model: promotionModel(CORRECT_REFUTATION), budget: {}, pinDir: mkGitTmp(),
    evidenceLevel: PRODUCTION_OPEN_EVIDENCE_LEVEL,
  });
  assert.equal(vg.ok, true);
  assert.equal(vg.correct, true, "the prediction was right — this is NOT a failed reading");
  assert.equal(vg.promoted, true);
  assert.equal(vg.promoted_to, PROMOTION_REPORT_ONLY_STATUS);
  assert.notEqual(vg.candidate_after.status, "active", "⇒ a paired-round record can NEVER license `active`");
  assert.equal(vg.candidate_after.status, PROMOTION_REPORT_ONLY_STATUS);
  process.stdout.write(`    AC (e): production-open ⇒ promoted_to=${vg.promoted_to} (candidate_after.status=${vg.candidate_after.status}); independent ⇒ ${promotionStatusForLevel("independent")}\n`);
});

test("NEGATIVE CONTROL (e) — let the promotion path accept `production-open` in a scratch copy ⇒ (e) goes RED", async () => {
  const ANCHOR = "  return isIndependentEvidenceLevel(level) ? \"active\" : PROMOTION_REPORT_ONLY_STATUS;";
  const mutantPath = scratchReflectionModule((src) => {
    assert.ok(src.includes(ANCHOR), "the level-cap anchor is present in the promotion path");
    return src.replace(ANCHOR, "  return \"active\"; // MUTATION: the level cap is dropped — ANY level now licenses active");
  });
  const mutant = await import(pathToFileURL(mutantPath).href);
  // The mutation is EXACTLY "the level cap is dropped": nothing else about the promotion path changes.
  assert.notEqual(mutant.promotionStatusForLevel(PRODUCTION_OPEN_EVIDENCE_LEVEL), PROMOTION_REPORT_ONLY_STATUS,
    "⇒ the (e) claim («production-open caps at trial») is FALSIFIED — the control is live");
  assert.equal(mutant.promotionStatusForLevel(PRODUCTION_OPEN_EVIDENCE_LEVEL), "active");
  const vg = await mutant.validateGeneralization({
    candidate: promotionCandidate(), heldOutCase: promotionHeldOut(),
    model: promotionModel(CORRECT_REFUTATION), budget: {}, pinDir: mkGitTmp(),
    evidenceLevel: PRODUCTION_OPEN_EVIDENCE_LEVEL,
  });
  assert.equal(vg.candidate_after.status, "active",
    "⇒ with the cap dropped, a production-open gain record WOULD promote to `active` — the (e) claim is FALSIFIED");
  process.stdout.write(`    NEGATIVE CONTROL (e): mutant promoted a ${PRODUCTION_OPEN_EVIDENCE_LEVEL} verdict to status=${vg.candidate_after.status} (claim was «never active»)\n`);
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

// ── (m) THE ANSWER RESERVE + failure legibility ──────────────────────────────────────────────────────
// Task gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output. Production
// ran the routine twice and got `exit 1`, `turns: 13` under `--max-turns 12`, `0 hypotheses` both times —
// and the call record kept neither the stream's structural `subtype` nor any stderr, so "the model was
// killed before it could answer" and "the model explored and found nothing" were the SAME record.
//
// The fixtures below are the production shape: `result.subtype:"error_max_turns"`, `is_error:true`,
// `num_turns = cap + 1`, an EMPTY `result` text, and the assistant's own narration on the turns that did
// run (which is what the reserve call is handed back).
const maxTurnsStream = (narration) => [
  JSON.stringify({ type: "system", subtype: "init", model: FIXTURE_MODEL }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: narration }] } }),
  JSON.stringify({
    type: "result", subtype: "error_max_turns", num_turns: 13, is_error: true, result: "",
    usage: { input_tokens: 184654, output_tokens: 7435 }, total_cost_usd: 0.435,
  }),
].join("\n") + "\n";
const NARRATION = "I have read plugin/scripts/quality-gate-driver.ts and had not yet written the block.";
const MAX_TURNS_STREAM = maxTurnsStream(NARRATION);

/** Is this argv the ANSWER RESERVE's tool-less call? Read by POSITION off the argv the routine really
 *  builds (`--tools` <value>), never by scraping the prompt — a prompt-reading stub would make the test
 *  agree with itself. A tool-less call is the ONE structural thing that distinguishes the rescue from the
 *  exploration, and it is the thing production's launcher would see too. */
const toolsOf = (argv) => {
  const i = argv.indexOf("--tools");
  return i >= 0 ? String(argv[i + 1]) : null;
};
const isToolLess = (argv) => toolsOf(argv) === "";

/** The stub delegate these cases run against. ONLY the EXPLORATION call is cut off at the turn cap; the
 *  TOOL-LESS reserve call answers either with hypotheses (`hypsOnReport`) or with the same cutoff — which
 *  is what makes (a) and (c) two readings of ONE mechanism rather than two fixtures. The investigator's
 *  envelope (`Read,Grep,Glob`) is the one thing that separates it from the verifier's (`Read,Grep`), so
 *  the cutoff is keyed on THAT rather than on call order — a stub that keyed on order would agree with
 *  the routine's sequencing instead of with what was actually asked. */
function answerReserveDelegate({ hypsOnReport = HYPS } = {}) {
  return (argv, opts) => {
    if (isToolLess(argv)) {
      if (hypsOnReport === null) return { status: 1, stdout: MAX_TURNS_STREAM, stderr: "Reached maximum number of turns (1)\n", error: null };
      return { status: 0, stdout: streamText(`${FOCUS_MARKER} fixture focus\n${JSON.stringify(hypsOnReport)}`), stderr: "", error: null };
    }
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    if (toolsOf(argv) === INVESTIGATOR_TOOLS) return { status: 1, stdout: MAX_TURNS_STREAM, stderr: "Reached maximum number of turns (12)\n", error: null };
    return { status: 0, stdout: STREAM, stderr: "", error: null };
  };
}

/** An investigator stub whose runs carry what the MODEL really returned: it parses the call it made
 *  (`parseHypotheses(callText(stdout))`) instead of being handed a fixed list. The answer reserve's whole
 *  mechanism is "a call cut off at the cap gets one more call whose stream is the ANSWER", so a stub that
 *  always reported `hyps` would make that mechanism untestable — and one that did not write the run file
 *  would hide the second half of it (the engine's record must reflect the rescue, not the cutoff). */
function streamReadingInvestigator() {
  const sink = [];
  const fn = async (o) => {
    const records = [];
    for (let i = 0; i < o.runs; i++) {
      const r = await o.runModel(o.prompt, i);
      const stdout = String(r?.stdout ?? "");
      const { hyps, parse_error } = realHyp.parseHypotheses(realHyp.callText(stdout));
      sink.push({ tools: o.tools, maxTurns: o.maxTurns, prompt: o.prompt });
      const rec = { run: i + 1, hyps, parse_error, stdout, exit: r?.status ?? null, n_hyps: hyps ? hyps.length : null };
      // The engine writes each run's own file; the stub does the same, because the run file is what the
      // test reads to prove the RESCUE's answer (not the cutoff's zero) is what the run recorded.
      o.writeFile(path.join(o.outDir, `run-${i + 1}.json`), JSON.stringify(rec, null, 1));
      records.push(rec);
    }
    return { ok: true, records, parsed: records.filter((r) => r.hyps).length, total: o.runs };
  };
  fn.calls = sink;
  return fn;
}

/** A workspace + engine wired for the (m) cases, with the pin kept under the test's OWN tmp root so a run
 *  cannot litter the shared one. Returns the seams the assertions read. */
function answerReserveFixture({ delegate }) {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine();
  engine.modules.hyp.runInvestigator = streamReadingInvestigator();
  const spawn = countingSpawn(delegate);
  const pin = pinStub();
  // ⛔ `retryBackoffMs: 0` + a no-op sleep: since this task a result-less call is RETRIED once (Plan item
  // 3), and no suite may wait on wall clock. The retry POLICY is exercised directly in the AC2 cases.
  return { ws, engine, spawn, pin, opts: { ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pin, pinTmpRoot: tmpDir("osd-reserve-pinroot-"), retryBackoffMs: 0, sleepFn: async () => {} } };
}
const pinRunFile = (pin, name = "run-1.json") =>
  JSON.parse(fs.readFileSync(path.join(pin.pins[0], ".open-semantic-discovery-runs", name), "utf8"));

test("case (m) AC1(a) — an error_max_turns stream ⇒ the call record carries the subtype and the round reports not-evaluated:error_max_turns, NOT \"0 hypotheses\"", async () => {
  // BOTH the exploration and its rescue are cut off: the production shape, where a rescue is not owed.
  const { ws, spawn, opts } = answerReserveFixture({ delegate: answerReserveDelegate({ hypsOnReport: null }) });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  const round = rounds(ws)[0];

  const call = round.calls.find((c) => c.step === "investigator");
  assert.ok(call, "the investigator call is on the round record");
  assert.equal(call.exit, 1);
  assert.equal(call.subtype, "error_max_turns", "the call record carries the stream's STRUCTURAL subtype");
  assert.equal(call.is_error, true);
  assert.equal(call.num_turns, 13, "…and the stream's own num_turns, alongside the realized turn count");
  assert.equal(call.stream_ok, true, "the stream DID parse — this is not an uninstrumented call");
  assert.equal(call.turns, 13, "the realized turns are the stream's, not the cap's");
  assert.equal(call.tokens.input, 184654, "a cut-off call still reports what it spent");
  assert.equal(call.not_evaluated, "not-evaluated:error_max_turns");
  assert.equal(call.stderr_tail, "Reached maximum number of turns (12)\n", "the launcher's own cause rides the record");
  assert.equal(round.investigator.not_evaluated, "not-evaluated:error_max_turns");
  assert.equal(round.investigator.answer_reserve.attempted, 1, "the reserve was TRIED");
  assert.equal(round.investigator.answer_reserve.rescued, 0, "…and did not succeed");
  assert.deepEqual(round.investigator.answer_reserve.not_evaluated, ["not-evaluated:error_max_turns"]);
  assert.equal(round.clusters.total, 0);

  // ⛔ THE ASSERTION THE TASK EXISTS FOR: the two states are different sentences now.
  assert.equal(fact.state, "not-evaluated", `a round whose calls never answered is NOT a verified round (got ${fact.state}: ${fact.reason})`);
  assert.match(fact.reason, /not-evaluated:error_max_turns/, "the Fact NAMES the cause");
  assert.doesNotMatch(fact.reason, /cluster\(s\) from 1 run\(s\)/, "…and never reports it as an exploration that found nothing");
});

test("case (m) AC1(a) NEGATIVE CONTROL — remove the subtype capture and the SAME predicate stops naming the cause", () => {
  const withSubtype = { exit: 1, spawn_error: null, subtype: "error_max_turns", stream_ok: true };
  assert.equal(callNotEvaluatedToken(withSubtype), "not-evaluated:error_max_turns", "the predicate CAN name the cause");
  // ⛔ THE MUTATION: the very record the round builds, with the subtype capture removed. The same function
  // the round calls must stop producing the token — that is what makes the assertion above a reading of
  // the capture rather than of the exit code alone (硬规则 4 推论四: a control that would differ, run).
  const mutated = { ...withSubtype, subtype: null };
  assert.equal(callNotEvaluatedToken(mutated), "not-evaluated:uninstrumented-exit-1");
  assert.notEqual(callNotEvaluatedToken(mutated), "not-evaluated:error_max_turns", "without the capture, (a) is red");
  // …and the round really does build the record WITH the capture — otherwise the mutation would be of a
  // value the routine never produces, and the control would prove nothing.
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  assert.match(src, /subtype: stream\.ok \? \(stream\.subtype \?\? null\) : null/, "the call record carries the stream's subtype");
  // The other half of the predicate, so the zero above is not the artifact of a function that always fires.
  // ⛔ `has_result:true` is part of "a call that RAN": since this task, exit 0 is no longer SUFFICIENT —
  // the record the round builds carries the stream's own `result` reading, and a call that ran emitted one.
  assert.equal(callNotEvaluatedToken({ ...withSubtype, exit: 0, has_result: true }), null, "a call that RAN is not not-evaluated");
  assert.equal(firstNotEvaluatedToken([{ exit: 0, has_result: true }, withSubtype]), "not-evaluated:error_max_turns", "the FIRST failure is the cause");
  assert.equal(firstNotEvaluatedToken([{ exit: 0, has_result: true }, { exit: 0, has_result: true }]), null, "no failure ⇒ no token");
});

test("case (m) AC1(b) — a zero-token exit-1 with stderr ⇒ the stderr tail is recorded", async () => {
  const STDERR = "Error: launch failed: authentication_error (the gateway refused the request)\n";
  // NO stream at all: the round-1 shape (tokens 0, turns null, exit 1), whose cause production kept
  // nowhere. Anything the launcher printed is the only evidence there is.
  const delegate = (argv, opts) => {
    if (isToolLess(argv)) return { status: 1, stdout: "", stderr: STDERR, error: null };
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    return { status: 1, stdout: "", stderr: STDERR, error: null };
  };
  const { ws, opts } = answerReserveFixture({ delegate });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  const call = rounds(ws)[0].calls.find((c) => c.step === "investigator");

  assert.equal(call.exit, 1);
  assert.equal(call.stream_ok, false, "no stream parsed — NOT the same reading as a stream that said nothing");
  assert.equal(call.subtype, null, "'not read' keeps its own value and is never defaulted to a success");
  assert.equal(call.turns, null);
  assert.deepEqual(call.tokens, { input: 0, output: 0 });
  assert.equal(call.not_evaluated, "not-evaluated:uninstrumented-exit-1");
  assert.equal(call.stderr_tail, STDERR, "the launcher's own cause is ON the record");
  assert.equal(call.stderr_chars, STDERR.length);
  assert.equal(call.stderr_tail_truncated, false);
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
  assert.match(fact.reason, /not-evaluated:uninstrumented-exit-1/);

  // The tail is a TAIL, and its truncation is a RECORDED reading rather than a silent slice (硬规则 3b):
  // without `truncated`, a bounded tail and a complete one would look the same.
  const long = boundedTail(`${"x".repeat(STDERR_TAIL_MAX)}TAIL`, STDERR_TAIL_MAX);
  assert.equal(long.tail.length, STDERR_TAIL_MAX);
  assert.equal(long.tail.endsWith("TAIL"), true, "the TAIL is what is kept — that is where a cause is");
  assert.equal(long.truncated, true);
  assert.equal(long.chars, STDERR_TAIL_MAX + 4);
  const short = boundedTail("done\n", STDERR_TAIL_MAX);
  assert.deepEqual(short, { tail: "done\n", truncated: false, chars: 5 });
  assert.deepEqual(boundedTail(undefined, 10), { tail: "", truncated: false, chars: 0 }, "a missing stream is empty, not a crash");
});

test("case (m) AC1(c) — the answer reserve produces parsed hypotheses from a stub that answers ONLY when told to stop exploring", async () => {
  const { ws, spawn, pin, opts } = answerReserveFixture({ delegate: answerReserveDelegate({ hypsOnReport: HYPS }) });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  const round = rounds(ws)[0];

  // The stub answers on the TOOL-LESS call and on nothing else — the exploration call it was handed is a
  // cutoff stream, so every hypothesis in this round came from the rescue.
  const reserveCalls = spawn.calls.filter((c) => isToolLess(c.argv));
  assert.equal(reserveCalls.length, 1, "exactly ONE tool-less rescue call");
  const argvOf = (c, flag) => c.argv[c.argv.indexOf(flag) + 1];
  assert.equal(argvOf(reserveCalls[0], "--max-turns"), "1", "the rescue is ONE turn");
  assert.equal(argvOf(reserveCalls[0], "--tools"), ANSWER_RESERVE_TOOLS);
  // ⛔ The rescue carries the run's OWN narration back — read from the field the call record kept, so the
  // two halves (capture and handback) are one mechanism rather than two that happen to agree.
  assert.match(reserveCalls[0].opts.stdinData, /YOUR TURN BUDGET IS EXHAUSTED/);
  assert.match(reserveCalls[0].opts.stdinData, /EXPLORATION NOTES/, "the notes the rescue reports FROM are in the prompt");
  assert.ok(reserveCalls[0].opts.stdinData.includes(NARRATION), "…and they are the run's OWN words");
  assert.equal(reserveCalls[0].opts.cwd, pin.pins[0], "the rescue is rooted at the SAME pin");

  assert.equal(round.investigator.answer_reserve.attempted, 1);
  assert.equal(round.investigator.answer_reserve.rescued, 1);
  assert.deepEqual(round.investigator.answer_reserve.steps, ["investigator-report"]);
  assert.equal(round.answer_reserve.attempted, 1, "the round's own reserve reading agrees with the arm's");
  assert.equal(round.answer_reserve.rescued, 1);
  assert.equal(round.investigator.runs_with_hypotheses, 1, "the RESCUED run counts as a run with hypotheses");
  assert.equal(round.clusters.total, HYPS.length, "…and its hypotheses are clustered like any others");
  assert.equal(round.confirmed.count > 0, true, "a rescued hypothesis is verified and refuted like any other");
  assert.equal(fact.state, "verified");
  // ⛔ The rescue SUCCEEDED, so the round is not "not-evaluated" — but the exploration call WAS cut off,
  // and the Fact still says so rather than quietly folding a rescued run into a clean one. Both readings
  // are on the same sentence, which is the whole point: the counts are over the calls that answered.
  assert.match(fact.reason, /1 of \d+ call\(s\) were NOT EVALUATED \(not-evaluated:error_max_turns\)/);
  assert.doesNotMatch(fact.reason, /produced NO parsed hypothesis cluster/);

  // The rescue is a RESERVATION on the SAME ledger, under its OWN step name: a call that was spent must be
  // explicable from the ledger alone, and every spawn must be one reservation.
  assert.equal(resumeSteps(ws).includes("investigator-report"), true, "the rescue reserved under its own step name");
  assert.equal(resumeSteps(ws).length, spawn.calls.length, "one reservation per spawn, the rescue included");
  assert.equal(round.calls.find((c) => c.step === "investigator-report").exit, 0);
  // The run's OWN file carries the rescue's answer, because the rescue's stream is what `runModel`
  // returned and therefore what the engine parsed: a run file still claiming zero would be the round's
  // own record contradicting its clusters.
  const runFile = pinRunFile(pin);
  assert.equal(runFile.hyps.length, HYPS.length, "the pinned run file carries the RESCUED hypotheses");
  assert.equal(runFile.n_hyps, HYPS.length);
  assert.equal(runFile.exit, 0, "…and the exit of the call whose answer was read, not the cutoff's");
});

test("case (m) 硬规则 5b — the SAME reserve covers every single-answer STEP, not just the investigator", async () => {
  // ⛔ WHY THIS TEST EXISTS. The task's own AC2 production round measured the defect one step downstream:
  // 3 of its 6 calls were `error_max_turns` — TWO VERIFIERS and the REFUTER — so `confirmed.count` was 0
  // on a round that had just produced 12 evidenced hypotheses, and 2 of 3 clusters carried
  // `verifier_cause:"turn-budget"`. Fixing the investigator alone would have been fixing the instance, not
  // the class. Here EVERY `Read,Grep` step (verifier, refuter, value-assessment) is cut off at its own cap.
  // ⛔ THE REFUTER'S SECOND CHANCE IS NOT THE TOOL-LESS RESERVE (task gap-open-discovery-refutation-chain-
  // undetermined-is-unattributable-and-budget-truncated, Plan item 2): a refuter truncated at `--max-turns
  // 6` gets ONE FRESH-CONTEXT retry at the MEASURED larger budget (26). The delegate below keys on that
  // budget, exactly as a launcher would see it, so the fixture exercises the real argv rather than a
  // counter the test keeps.
  const SUPPORTED = JSON.stringify({
    verdict: "supported", intentional_difference_found: "fixture impact",
    evidence: [{ file: "plugin/scripts/a.ts", line: 1, quote: "export const a = 1;" }],
    counterexample: "fixture counterexample", summary: "fixture summary",
  });
  const maxTurnsOf = (argv) => {
    const i = argv.indexOf("--max-turns");
    return i >= 0 ? Number(argv[i + 1]) : null;
  };
  const delegate = (argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    if (isToolLess(argv)) return { status: 0, stdout: streamText(SUPPORTED), stderr: "", error: null };
    if (toolsOf(argv) === INVESTIGATOR_TOOLS) return { status: 0, stdout: streamText(`${FOCUS_MARKER} f\n${JSON.stringify(HYPS)}`), stderr: "", error: null };
    // The RETRY's larger budget is the one call that finishes — the whole point of granting it.
    if (maxTurnsOf(argv) === DEFAULT_REFUTATION_RETRY_MAX_TURNS) return { status: 0, stdout: streamText(SUPPORTED), stderr: "", error: null };
    return { status: 1, stdout: MAX_TURNS_STREAM, stderr: "Reached maximum number of turns (8)\n", error: null };
  };
  const { ws, spawn, opts } = answerReserveFixture({ delegate });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  const round = rounds(ws)[0];

  // The investigator answered (no reserve for it); every OTHER judgment step did not.
  assert.equal(round.investigator.answer_reserve.attempted, 0, "the investigator was NOT cut off");
  assert.equal(round.clusters.total, HYPS.length);
  const steps = round.answer_reserve.steps;
  assert.ok(steps.includes("verifier-report"), `a cut-off VERIFIER is rescued (steps: ${steps.join(",")})`);
  assert.ok(steps.includes("value-assessment-report"), "…and a cut-off value assessment");
  // ⛔ The refuter is NOT on the reserve's step list: its second chance is a `refuter` call, not a
  // `refuter-report` one. An entry here would mean the tool-less reserve had been used for a step whose
  // whole value is an independent READING.
  assert.equal(steps.includes("refuter-report"), false, "the refuter's second chance is NOT a tool-less reserve");
  const refuterCalls = round.calls.filter((c) => c.step === "refuter");
  assert.equal(refuterCalls.length, HYPS.length * 2, "TWO refuter calls per supported cluster: the truncated attempt and its ONE retry");
  assert.equal(refuterCalls.filter((c) => c.budget_retry === true).length, HYPS.length, "exactly ONE retry per truncated refuter");
  assert.deepEqual(
    refuterCalls.filter((c) => c.budget_retry === true).map((c) => c.max_turns),
    HYPS.map(() => DEFAULT_REFUTATION_RETRY_MAX_TURNS),
    "…and the retry really went out with the LARGER budget (read off the argv the call was spawned with)",
  );
  assert.equal(round.answer_reserve.attempted, round.answer_reserve.rescued, "every tool-less rescue answered");
  // The verdicts ARE the second chances' verdicts: without them these rows would all be
  // `undetermined`/`turn-budget` and `confirmed` would be 0 — the production reading this closes.
  assert.equal(round.confirmed.count, HYPS.length, "both clusters survive verifier + refuter, THROUGH their second chances");
  const cluster = carrierLines(ws).find((l) => l.kind === "cluster" && l.cluster === 1);
  assert.equal(cluster.verifier_verdict, "supported");
  assert.equal(cluster.refutation_verdict, "supported");
  assert.equal(cluster.evidence_lines.length > 0, true, "the rescue's evidence lines reach the record");
  // The cut-off calls are STILL on the round, still naming their own failure: a second chance is an
  // addition, never a laundering (硬规则 3b).
  assert.equal(round.calls.filter((c) => c.not_evaluated === "not-evaluated:error_max_turns").length, round.answer_reserve.attempted + HYPS.length);
  // ⛔ ONE ENTRY PER CALL. `reportIfCutOff` returns the SAME record when it did not fire, so an
  // unconditional push would list a call that was made once as two — a count that lies. Measured on the
  // ARM list (`investigator.calls`), which is where that mistake showed up in a live round.
  const armCalls = round.investigator.calls;
  assert.equal(new Set(armCalls).size, armCalls.length, "no call is listed twice on the arm");
  assert.equal(armCalls.filter((c) => c.step === "investigator").length, 1, "exactly ONE investigation call");
  assert.equal(armCalls.length, new Set(armCalls.map((c) => c.step)).size, "one investigator call ⇒ one entry");
  assert.match(fact.reason, /call\(s\) were NOT EVALUATED/);
  // Every second chance is its OWN reservation on the same ledger, under its own step name.
  for (const s of ["verifier-report", "value-assessment-report", "refuter"]) {
    assert.equal(resumeSteps(ws).includes(s), true, `${s} reserved on the same ledger`);
  }
  // ⛔ THE RETRY IS COUNTED AND CAPPED LIKE ANY OTHER CALL: two refuter reservations per supported cluster,
  // and the ledger line of the retry NAMES the larger budget it was granted.
  const refuterReserves = ledgerReserves(ws).filter((l) => String(l.step).endsWith("refuter"));
  assert.equal(refuterReserves.length, HYPS.length * 2, "the retry is a REAL reservation, not a free second call");
  assert.equal(refuterReserves.filter((l) => l.max_turns === DEFAULT_REFUTATION_RETRY_MAX_TURNS).length, HYPS.length, "exactly ONE retry reservation per truncated refuter — counted, and capped by the same 24h ledger");
  assert.equal(resumeSteps(ws).length, spawn.calls.length, "one reservation per spawn, the second chances included");
});

test("case (m) — the turn-reserve directive is in BOTH arms' prompts (the paired instrument's only difference stays the guidance block)", async () => {
  const { ws, spawn, opts } = answerReserveFixture({ delegate: () => ({ status: 0, stdout: STREAM, stderr: "", error: null }) });
  opts.config = { ...opts.config, investigatorMaxTurns: 12 };
  await runOpenSemanticDiscovery(ws, opts);
  const explorationPrompts = spawn.calls.filter((c) => !isToolLess(c.argv)).map((c) => String(c.opts.stdinData));
  assert.ok(explorationPrompts.length > 0);
  for (const p of explorationPrompts) {
    assert.match(p, /TURN BUDGET — READ THIS BEFORE YOU START/);
    assert.match(p, /capped at 12 assistant turns/);
    assert.match(p, new RegExp(`STOP calling tools by turn ${12 - ANSWER_RESERVE_PROMPT_TURNS}`));
    assert.match(p, /reports ZERO hypotheses/);
  }
  // The directive is PURE over the cap: a different cap moves the stated stop-by turn with it, and a
  // one-turn cap can never reserve more turns than the call has (硬规则 4 推论二: no literal that only
  // holds on one host/cap).
  assert.match(turnReserveDirective(40), /STOP calling tools by turn 38/);
  assert.match(turnReserveDirective(3), /Reserve the last 2 turn\(s\)/);
  assert.match(turnReserveDirective(1), /Reserve the last 1 turn\(s\)/, "a 1-turn call reserves its own turn, never 2");
  assert.match(turnReserveDirective(1), /STOP calling tools by turn 1/);
  assert.match(buildAnswerReservePrompt("SCHEMA HERE", "NOTES HERE"), /SCHEMA HERE\n\n/);
  assert.match(buildAnswerReservePrompt("SCHEMA HERE", "NOTES HERE"), /NOTES HERE\n--- END OF NOTES ---/, "the notes are LAST, where recency is strongest");
});

test("case (m) — the rescue's answer is parsed by the ENGINE's own parser, so there is only ONE hypothesis rule in play", () => {
  // ⛔ A FIRST DRAFT OF THIS FIX re-implemented the engine's `parseHypotheses` rule locally (the routine
  // cannot reach it through its narrow engine interface). The unified design removed the need: `runModel`
  // hands the RESCUE's stream back to the engine, and the engine parses its own answer. So the property
  // worth pinning is the ABSENCE of a second parser, not the agreement of two.
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  assert.doesNotMatch(src, /parseHypothesisArray|indexOf\("\["\)/, "the routine carries no second hypothesis parser");
  assert.match(src, /hyp\.parseVerifierStream|hyp\.callText/, "…it reads the engine's stream/text helpers instead");
  // …and the engine's own rule is the one rule: the text below parses to the full array, and text without
  // an array is NULL (never an empty list — "did not parse" ≠ "parsed nothing", 硬规则 3b).
  const text = `prose\n${JSON.stringify(HYPS)}\ntrailing\n`;
  assert.deepEqual(realHyp.parseHypotheses(realHyp.callText(text)).hyps, HYPS);
  assert.equal(realHyp.parseHypotheses(realHyp.callText("no array here")).hyps, null);
  assert.equal(realHyp.parseHypotheses(realHyp.callText("")).hyps, null);
});

test("case (m) AC5 — the reserve changes NEITHER the kill switch, NOR the report-only surface, NOR the per-step envelope the paired arms are compared on", async () => {
  // (i) The kill switch still short-circuits BEFORE any seam: with `enabled:false` there is not even a
  // spawn, so the reserve cannot be reached.
  const offWs = makeWorkspace();
  writeConfig(offWs, cfgYaml({ enabled: "false" }));
  const offSpawn = countingSpawn(answerReserveDelegate({ hypsOnReport: HYPS }));
  const offFact = await runOpenSemanticDiscovery(offWs, { ...runOpts(offWs, { engine: makeEngine() }), spawnFn: offSpawn, pinFn: pinStub() });
  assert.equal(offFact.state, "not-evaluated");
  assert.equal(offSpawn.calls.length, 0, "kill switch: ZERO spawns, the reserve included");

  // (ii) A run that was rescued still writes NOTHING to tasks/ or goals/ — the routine stays report-only.
  const { ws, opts } = answerReserveFixture({ delegate: answerReserveDelegate({ hypsOnReport: HYPS }) });
  const before = ["tasks", "goals"].map((d) => fs.readdirSync(path.join(ws, d)).sort().join(","));
  await runOpenSemanticDiscovery(ws, opts);
  const after = ["tasks", "goals"].map((d) => fs.readdirSync(path.join(ws, d)).sort().join(","));
  assert.deepEqual(after, before, "the routine still writes no task and no goal");

  // (iii) The paired ENVELOPE the two arms are compared on is untouched: the reserve is a call INSIDE an
  // arm, not a knob on it — raising `investigator_max_turns` is the only thing that moves this reading.
  // ⛔ The literal below was 12 when the reserve task wrote this. It is now 29 because a LATER task
  // (gap-osd-resident-round-never-autonomously-confirms-fix-attribution-and-call-failed-retry, Plan item 1)
  // re-derived the constant from a fresh 23-sample corpus — the reserve still moves NOTHING here, which is
  // what this assertion is about; the invariant it pins is «the envelope equals the MODULE CONSTANT»,
  // asserted on the next line, not «the constant equals 12».
  const envelope = pairedArmBudget(readOpenSemanticDiscoveryConfig(ws).config);
  assert.deepEqual(envelope, {
    investigator_runs: 1,
    max_clusters_verified: 3,
    investigator_max_turns: DEFAULT_INVESTIGATOR_MAX_TURNS,
    verifier_max_turns: 8,
    refutation_max_turns: 6,
  });
  assert.equal(envelope.investigator_max_turns, 29, "the re-derived p100 of the investigator-family tool-reading calls, NOT the reserve's doing");
  assert.equal(envelope.investigator_max_turns, DEFAULT_INVESTIGATOR_MAX_TURNS);
  assert.equal(Object.values(envelope).includes("investigator-report"), false, "the rescue is not a budget knob");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// THE OPTIONAL TASK-STATUS CONTEXT
// (tasks/gap-open-discovery-consumes-task-status-events-optional-context)
//
// Under SEMANTIC FIRST, MECHANIZE LATER the routine fetches "what changed since my last round" through
// the SUPPORTED read surface (`readTaskLog` — the same reader `quay task log` publishes) and hands it to
// the model as OPTIONAL context. The claims under test are exactly the task's: (a) 0 events ⇒ the round
// still runs; (b) more events than `n` ⇒ capped, remainder picked up next round; (c) a crash before the
// append ⇒ the same events are re-offered, deduped by `eventId`; (d) `rebase`/`complete:false` reach the
// prompt VERBATIM; (e) no code path skips or schedules a round on the events. Plus the (a) negative
// control the task names, and the config knob.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** Append REAL transitions through the KERNEL's own writer, so the fixture is a carrier the read surface
 *  really pages — a hand-written line would make this test agree with itself. Each call gets its own task
 *  id and its own `at`: the eventId is derived from `(taskId, from, to, commit, at, writer)`, so two events
 *  sharing all of those would be ONE event and the paging assertions below would be vacuous. */
function seedTransitions(ws, specs) {
  const base = Date.parse("2026-10-13T00:00:00.000Z");
  specs.forEach((s, i) => {
    const at = s.at ?? new Date(base + i * 60_000).toISOString();
    const res = appendTaskStatusEvent(ws, {
      taskId: s.taskId,
      from: s.from ?? "todo",
      to: s.to ?? "ready",
      kind: s.kind ?? null,
      actor: { kind: "promotion-driver", id: "osd-task-log.test" },
      at,
      recordedAt: at,
      ...(s.commit !== undefined ? { evidence: { commit: s.commit } } : {}),
    });
    assert.equal(res.ok, true, `the fixture transition must append (got ${JSON.stringify(res)})`);
  });
}

/** The bytes of the INVESTIGATOR prompt, found by its tool envelope (the one thing that separates it from
 *  the verifier's / the novelty check's), never by call order or by scraping the prompt. */
function investigatorPrompt(spawn) {
  const i = spawn.calls.findIndex((c) => toolsOf(c.argv) === INVESTIGATOR_TOOLS);
  assert.ok(i >= 0, "the round made an investigator call");
  return String(spawn.calls[i].opts.stdinData ?? "");
}

/** The task ids the prompt OFFERED, read by POSITION off the directive's own line format
 *  (`  - <task-id> <from>→<to> …`) — the reading the model would make, not a copy of a record field. */
function offeredTaskIdsInPrompt(prompt) {
  return String(prompt).split("\n").filter((l) => l.startsWith("  - ")).map((l) => l.slice(4).split(" ")[0]);
}

/** Run one full round against `ws` with fresh seams, so a test can compare rounds without sharing state. */
async function runRound(ws, extra = {}) {
  const spawn = countingSpawn();
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: extra.engine ?? makeEngine() }), ...extra, spawnFn: spawn, pinFn: pinStub() });
  return { spawn, fact };
}

// ── AC (a) ───────────────────────────────────────────────────────────────────────────────────────────
test("AC (a) — 0 events ⇒ the round runs normally, with the feed reported as read-and-empty", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // A PRESENT but EMPTY carrier: "0 events", not an absent file (which is its own, different reading).
  fs.writeFileSync(path.join(ws, ".quay", "task-status-events.jsonl"), "", "utf8");
  const { spawn, fact } = await runRound(ws);
  assert.equal(fact.state, "verified", `0 events still RUNS the round (${fact.reason})`);
  assert.ok(spawn.calls.length > 0, "…and it spawns: 'no events' is never 'no round'");
  const rec = rounds(ws)[0];
  assert.equal(rec.task_log.read.ok, true, "an EMPTY carrier was read — not an unreadable one");
  assert.equal(rec.task_log.offered_count, 0);
  assert.deepEqual(rec.task_log.offered, []);
  assert.equal(rec.task_log.cursor_after, null, "no event ⇒ no cursor to remember");
  const prompt = investigatorPrompt(spawn);
  assert.match(prompt, /TASK-STATUS CHANGES — context you MAY consider/);
  assert.match(prompt, /No task-status transition is new since your last round\./);
  assert.match(prompt, /never gates or triggers this round/, "the directive says, in the model's terms, that it decides nothing");
  console.log(`    AC (a): 0 events ⇒ state=${fact.state}, ${spawn.calls.length} spawn(s), offered=0`);
});

// ── AC (b) ───────────────────────────────────────────────────────────────────────────────────────────
test("AC (b) — more events than the limit ⇒ capped, and the remainder is picked up next round", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml({ task_log_context_limit: "3" }));
  seedTransitions(ws, Array.from({ length: 7 }, (_, i) => ({ taskId: `T-${i}` })));
  const r1 = await runRound(ws);
  assert.equal(r1.fact.state, "verified", r1.fact.reason);
  const round1 = rounds(ws)[0];
  assert.equal(round1.task_log.limit, 3, "the configured limit really reached the read");
  assert.equal(round1.task_log.offered_count, 3, "the page is CAPPED at the configured limit");
  assert.equal(round1.task_log.truncated, true);
  assert.deepEqual(round1.task_log.offered.map((e) => e.task_id), ["T-0", "T-1", "T-2"]);
  assert.deepEqual(offeredTaskIdsInPrompt(investigatorPrompt(r1.spawn)), ["T-0", "T-1", "T-2"], "…and the PROMPT carries exactly those");

  const r2 = await runRound(ws, { force: true });
  const round2 = rounds(ws)[1];
  // The cursor is read INCLUSIVE of the event it names, so T-2 comes back — and is DEDUPED by eventId,
  // which is what makes the remainder start exactly where the last round stopped.
  assert.equal(round2.task_log.deduped_by_event_id, 1, "the boundary event was re-delivered and deduped");
  assert.deepEqual(round2.task_log.offered.map((e) => e.task_id), ["T-3", "T-4"], "the remainder is picked up; one slot pays the at-least-once boundary");

  const r3 = await runRound(ws, { force: true });
  const round3 = rounds(ws)[2];
  assert.deepEqual(round3.task_log.offered.map((e) => e.task_id), ["T-5", "T-6"]);

  // At-least-once + dedupe by eventId ⇒ every event offered EXACTLY once across the three rounds.
  const all = [round1, round2, round3].flatMap((r) => r.task_log.offered);
  assert.deepEqual(all.map((e) => e.task_id), ["T-0", "T-1", "T-2", "T-3", "T-4", "T-5", "T-6"]);
  assert.equal(new Set(all.map((e) => e.event_id)).size, 7, "seven DISTINCT eventIds were offered — none lost, none doubled");
  console.log(`    AC (b): limit=3 over 7 events ⇒ rounds offered 3+2+2, union = all 7, 0 lost`);
});

// ── AC (c) ───────────────────────────────────────────────────────────────────────────────────────────
test("AC (c) — a crash before the append ⇒ the next round re-offers the SAME events (at-least-once)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  seedTransitions(ws, [{ taskId: "T-0" }, { taskId: "T-1" }, { taskId: "T-2" }]);
  // The ids the read surface delivers for the whole window — computed INDEPENDENTLY, so "the same events"
  // below is a comparison against the contract rather than against the round's own record.
  const expectedIds = readTaskLog(ws, { limit: DEFAULT_TASK_LOG_CONTEXT_LIMIT }).document.transitions.map((t) => t.eventId);
  assert.equal(expectedIds.length, 3);
  // Round 1 dies at the model seam, BEFORE the round's append: the ledger keeps the reservation, the
  // carrier keeps NOTHING — which is exactly the crash the cursor discipline has to survive.
  const crashSpawn = countingSpawn(() => { throw new Error("fixture: the round died before the append"); });
  const crashed = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine() }), spawnFn: crashSpawn, pinFn: pinStub() });
  assert.equal(crashed.state, "failed", `the crash is the round's own failed (${crashed.reason})`);
  assert.equal(fs.existsSync(carrierPath(ws)), false, "NOTHING was appended ⇒ NO cursor was stored");
  const crashedOffered = offeredTaskIdsInPrompt(investigatorPrompt(crashSpawn));
  assert.deepEqual(crashedOffered, ["T-0", "T-1", "T-2"], "the crashing round DID offer the events");

  // Round 2: with no stored cursor it reads the SAME window and re-offers the SAME events, id for id.
  const r2 = await runRound(ws, { force: true });
  const round2 = rounds(ws)[0];
  assert.deepEqual(round2.task_log.offered.map((e) => e.task_id), ["T-0", "T-1", "T-2"], "the crash cost nothing — the events come back");
  assert.deepEqual(round2.task_log.offered.map((e) => e.event_id), expectedIds, "…the SAME eventIds the surface delivers, in the same order");
  assert.deepEqual(offeredTaskIdsInPrompt(investigatorPrompt(r2.spawn)), ["T-0", "T-1", "T-2"]);

  // Round 3: NOW a cursor exists, so the boundary event returns and is dropped BY ITS eventId.
  const r3 = await runRound(ws, { force: true });
  const round3 = rounds(ws)[1];
  assert.equal(round3.task_log.offered_count, 0, "nothing new ⇒ nothing offered");
  assert.equal(round3.task_log.deduped_by_event_id, 1, "…by the eventId of the boundary event the cursor named");
  assert.match(investigatorPrompt(r3.spawn), /No task-status transition is new since your last round\./);
  console.log(`    AC (c): crashed round offered 3; next round re-offered the SAME 3; round 3 deduped the boundary by eventId`);
});

// ── AC (d) ───────────────────────────────────────────────────────────────────────────────────────────
test("AC (d) — `complete:false` reaches the prompt VERBATIM (the surface's own reason text)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  seedTransitions(ws, [{ taskId: "T-0", commit: "0123456789abcdef0123456789abcdef01234567" }]);
  const reading = readTaskLog(ws, { limit: DEFAULT_TASK_LOG_CONTEXT_LIMIT });
  assert.equal(reading.ok, true);
  assert.equal(reading.document.complete, false, "the fixture really is an INCOMPLETE page");
  assert.ok(reading.document.coverage.reasons.length > 0);
  const { spawn } = await runRound(ws);
  const prompt = investigatorPrompt(spawn);
  for (const reason of reading.document.coverage.reasons) {
    assert.ok(prompt.includes(reason), `the coverage reason must reach the prompt VERBATIM: ${reason}`);
  }
  assert.match(prompt, /this list may be incomplete:/);
  assert.equal(rounds(ws)[0].task_log.complete, false);
  assert.ok(rounds(ws)[0].task_log.incomplete_reasons.length > 0);
  console.log(`    AC (d): ${reading.document.coverage.reasons.length} coverage reason(s) reached the prompt verbatim`);
});

test("AC (d) — `rebase:true` reaches the prompt VERBATIM (a cursor the carrier cannot honour)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  seedTransitions(ws, [{ taskId: "T-0" }]);
  // Seed the PREVIOUS round's line with a cursor whose carrierEpoch the carrier cannot honour, which is
  // the one thing a consumer must never be able to mistake for "nothing happened".
  const staleCursor = { v: 1, carrierEpoch: "an-epoch-that-no-longer-exists", seq: 0 };
  // (`model_calls:0` because the budget reader must be able to read a carrier line that falls in the
  // trailing 24h window — a stale-but-well-formed previous round, not a half-written one.)
  fs.appendFileSync(carrierPath(ws), `${JSON.stringify({
    kind: "scan-round", routine: OPEN_SEMANTIC_DISCOVERY_NAME, invoked_by: INVOKED_BY_RESIDENT,
    ts: new Date().toISOString(), model_calls: 0,
    task_log: { cursor_after: staleCursor, offered: [] },
  })}\n`, "utf8");
  const reading = readTaskLog(ws, { since: JSON.stringify(staleCursor), limit: DEFAULT_TASK_LOG_CONTEXT_LIMIT });
  assert.equal(reading.ok, true);
  assert.equal(reading.document.rebase, true, "the seeded cursor really is un-honourable");
  const reason = reading.document.rebaseReason;
  assert.ok(typeof reason === "string" && reason.length > 0);

  // `force`: the seeded line is a RESIDENT scan-round stamped NOW, so the interval would (correctly) make
  // this round not-due — the subject under test is the prompt, not the scheduler.
  const { spawn } = await runRound(ws, { force: true });
  const prompt = investigatorPrompt(spawn);
  assert.ok(prompt.includes(reason), `the rebase reason must reach the prompt VERBATIM:\n${reason}`);
  assert.match(prompt, /this list may be incomplete:/);
  const rec = rounds(ws).at(-1);
  assert.equal(rec.task_log.rebase, true);
  assert.equal(rec.task_log.rebase_reason, reason);
  console.log(`    AC (d): rebase reason reached the prompt verbatim (${reason.length} chars)`);
});

// ── AC (e) ───────────────────────────────────────────────────────────────────────────────────────────
test("AC (e) — no code path skips or schedules a round on the events (static control + its live mutation)", () => {
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  // (1) ONE call to the read surface, and it goes through the function that owns the whole mechanic.
  assert.equal(src.split("readTaskLog(").length - 1, 1, "exactly ONE read of the transition carrier");
  const ownerFn = src.indexOf("export function readTaskLogContext(");
  const callSite = src.indexOf("const taskLogContext = readTaskLogContext(");
  assert.ok(ownerFn > 0, "the reader-owner function is present");
  assert.ok(callSite > ownerFn, "the round CALLS it rather than inlining a second reader");
  // (2) The owner touches no Fact, no schedule and no spawn — it is mechanics, and it returns no verdict.
  const ownerBody = src.slice(ownerFn, src.indexOf("export function taskLogContextDirective("));
  for (const forbidden of ["return fact(", "isDue", "halted", "spawn"]) {
    assert.equal(ownerBody.includes(forbidden), false, `readTaskLogContext must not reference ${forbidden}`);
  }
  // (3) Nowhere is a Fact returned on the strength of the fetched events.
  const GATE_ON_EVENTS = /if\s*\([^\n]*taskLog[^\n]*\)[^\n]*return fact\(/;
  assert.doesNotMatch(src, GATE_ON_EVENTS, "no `if (<the context> …) return fact(` path exists anywhere in the module");
  // ⛔ POSITIVE CONTROL ON THE SAME PREDICATE: the mutation the negative control injects DOES match it,
  // so the zero above is a measurement rather than a regex that cannot fire (硬规则 2).
  assert.match(
    '  if (taskLogContext.offered_count === 0) return fact("not-evaluated", {}, "no events");',
    GATE_ON_EVENTS,
    "the predicate CAN fire — the injected gate turns the same predicate red",
  );
  // (4) The carrier is not read directly: the paging/cursor/coverage contract lives in ONE place.
  assert.doesNotMatch(src, /task-status-events\.jsonl/, "the routine never names the raw carrier file");
});

test("AC (e) — the events change NEITHER whether the round runs NOR its model-call envelope", async () => {
  const empty = makeWorkspace();
  writeConfig(empty, cfgYaml());
  fs.writeFileSync(path.join(empty, ".quay", "task-status-events.jsonl"), "", "utf8");
  const many = makeWorkspace();
  writeConfig(many, cfgYaml());
  seedTransitions(many, Array.from({ length: 12 }, (_, i) => ({ taskId: `T-${i}` })));
  const a = await runRound(empty);
  const b = await runRound(many);
  assert.equal(a.fact.state, "verified", a.fact.reason);
  assert.equal(b.fact.state, "verified", b.fact.reason);
  assert.equal(b.fact.value.model_calls, a.fact.value.model_calls, "many events ⇒ still ONE bounded round, same call count");
  assert.equal(b.spawn.calls.length, a.spawn.calls.length, "…and the same number of spawned subprocesses");
  assert.deepEqual(b.fact.value.answer_reserve, a.fact.value.answer_reserve);
  assert.equal(rounds(many)[0].task_log.offered_count, 12, "the events WERE fetched (the envelope is unchanged, not the fetch skipped)");
});

// ── the config knob ──────────────────────────────────────────────────────────────────────────────────
test("config — `task_log_context_limit` is OPTIONAL (absent ⇒ 50) and bounded by the read surface's page maximum", () => {
  const absent = parseOpenSemanticDiscoverySection(rawSection());
  assert.equal(absent.error, null);
  assert.equal(absent.config.taskLogContextLimit, DEFAULT_TASK_LOG_CONTEXT_LIMIT, "a section written before the context existed still parses");
  assert.equal(DEFAULT_TASK_LOG_CONTEXT_LIMIT, 50, "the task states the default as 50");
  const declared = parseOpenSemanticDiscoverySection(rawSection({ task_log_context_limit: 7 }));
  assert.equal(declared.error, null);
  assert.equal(declared.config.taskLogContextLimit, 7);
  const viaYaml = makeWorkspace();
  writeConfig(viaYaml, cfgYaml({ task_log_context_limit: "7" }));
  assert.equal(readOpenSemanticDiscoveryConfig(viaYaml).config.taskLogContextLimit, 7, "…and it is read off `.quay/config.yml`");
  assert.equal(parseOpenSemanticDiscoverySection(rawSection({ task_log_context_limit: MAX_TASK_LOG_LIMIT })).config.taskLogContextLimit, MAX_TASK_LOG_LIMIT);
  for (const bad of [0, -1, MAX_TASK_LOG_LIMIT + 1, "3", 1.5]) {
    const r = parseOpenSemanticDiscoverySection(rawSection({ task_log_context_limit: bad }));
    assert.equal(r.config, null, `'${bad}' must be REFUSED`);
    assert.match(r.error, /task_log_context_limit/, `the refusal NAMES the key (got ${r.error})`);
  }
});

// ── the mechanics, unit-level ────────────────────────────────────────────────────────────────────────
test("priorTaskLogContext / asTaskLogCursor — an UNREADABLE stored cursor is its own state, never 'no cursor' (硬规则 3b)", () => {
  assert.deepEqual(asTaskLogCursor({ v: 1, carrierEpoch: "e", seq: 4 }), { v: 1, carrierEpoch: "e", seq: 4 });
  for (const bad of [null, 1, [], { v: 2, carrierEpoch: "e", seq: 0 }, { v: 1, carrierEpoch: "", seq: 0 }, { v: 1, carrierEpoch: "e", seq: -1 }, { v: 1, carrierEpoch: "e", seq: 1.5 }]) {
    assert.equal(asTaskLogCursor(bad), null, `${JSON.stringify(bad)} is not a cursor`);
  }
  const withBlock = (b) => [{ kind: "scan-round", task_log: b }];
  assert.deepEqual(
    priorTaskLogContext([{ kind: "scan-round", task_log: { cursor_after: null, offered: [] } }]),
    { cursor: null, cursorUnreadable: false, offeredKeys: [] },
    "an ABSENT cursor is not an unreadable one",
  );
  const bad = priorTaskLogContext(withBlock({ cursor_after: { v: 9, seq: 0 }, offered: [] }));
  assert.equal(bad.cursor, null);
  assert.equal(bad.cursorUnreadable, true, "a PRESENT-but-unreadable cursor is REPORTED, never folded into 'there was none'");
  const carried = priorTaskLogContext(withBlock({ cursor_after: { v: 1, carrierEpoch: "e", seq: 9 }, offered: [{ key: "eventId:x" }, { key: "order:9" }, { nope: 1 }] }));
  assert.deepEqual(carried, { cursor: { v: 1, carrierEpoch: "e", seq: 9 }, cursorUnreadable: false, offeredKeys: ["eventId:x", "order:9"] });
  // The LATEST scan-round carrying a block wins; rounds from before the feature contribute nothing.
  const hist = [{ kind: "scan-round" }, { kind: "scan-round", task_log: { cursor_after: { v: 1, carrierEpoch: "old", seq: 1 }, offered: [] } }, { kind: "cluster" }, { kind: "scan-round", task_log: { cursor_after: { v: 1, carrierEpoch: "new", seq: 5 }, offered: [] } }];
  assert.equal(priorTaskLogContext(hist).cursor.carrierEpoch, "new");
});

test("taskLogDedupKey / citeOfferedEvents / taskLogContextDirective — pure, and 'nothing to cite' is null, not false", () => {
  assert.equal(taskLogDedupKey({ eventId: "e1", order: 3 }), "eventId:e1");
  assert.equal(taskLogDedupKey({ eventId: null, order: 3 }), "order:3", "a v0 record has no eventId and one is NEVER fabricated");

  const offered = [
    { key: "eventId:e0", event_id: "e0", order: 0, task_id: "gap-alpha", from: "todo", to: "ready", at: "2026-10-13T00:00:00.000Z", commit: null, inferred: false, source: "task-status-events" },
    { key: "eventId:e1", event_id: "e1", order: 1, task_id: "gap-beta", from: "ready", to: "done", at: "2026-10-13T00:01:00.000Z", commit: "abc", inferred: false, source: "task-status-events" },
  ];
  // Vacuous questions are NOT EVALUATED, never `false` (硬规则 3b).
  assert.equal(citeOfferedEvents("gap-alpha looks interesting", []).evaluated, false);
  assert.equal(citeOfferedEvents("gap-alpha looks interesting", []).cited, null);
  assert.equal(citeOfferedEvents(null, offered).evaluated, false);
  assert.equal(citeOfferedEvents("   ", offered).evaluated, false);
  // A stated focus with no offered id in it is a REAL reading (evaluated, not cited).
  assert.deepEqual(citeOfferedEvents("FOCUS: the pin helper", offered), { evaluated: true, cited: false, matched: [], basis: citeOfferedEvents("x", offered).basis });
  const cited = citeOfferedEvents("FOCUS: gap-beta reset after a failed landing made me look at the fan-in", offered);
  assert.equal(cited.evaluated, true);
  assert.equal(cited.cited, true);
  assert.deepEqual(cited.matched, ["gap-beta"]);
  assert.match(cited.basis, /never that the event caused the focus/, "the reading says what it is NOT");
  assert.ok(FOCUS_CITATION_MAX >= 1);

  // The directive: 0 events, an unreadable feed, and a rebase each say their own thing.
  const blank = {
    read: { ok: true, reason: null }, limit: 50, cursor_before: null, cursor_before_unreadable: false,
    cursor_after: null, rebase: false, rebase_reason: null, complete: true, incomplete_reasons: [],
    offered: [], offered_count: 0, deduped_by_event_id: 0, truncated: false,
  };
  assert.match(taskLogContextDirective(blank), /No task-status transition is new since your last round\./);
  assert.doesNotMatch(taskLogContextDirective(blank), /may be incomplete/, "a COMPLETE, empty page needs no caveat");
  assert.match(taskLogContextDirective({ ...blank, read: { ok: false, reason: "the carrier is unreadable" } }), /could not be read: the carrier is unreadable/);
  const incomplete = taskLogContextDirective({ ...blank, complete: false, incomplete_reasons: ["the page was truncated by --limit 3: 4 more transition(s) matched."] });
  assert.match(incomplete, /this list may be incomplete:/);
  assert.ok(incomplete.includes("the page was truncated by --limit 3: 4 more transition(s) matched."), "the surface's own sentence is carried VERBATIM");
  assert.match(taskLogContextDirective({ ...blank, rebase: true, rebase_reason: "cursor carrierEpoch \"x\" does not match" }), /cursor carrierEpoch "x" does not match/);
});

// ── NEGATIVE CONTROL (a) — the one the task names ────────────────────────────────────────────────────
test("NEGATIVE CONTROL (a) — make the round SKIP when there are 0 events in a scratch copy ⇒ (a) goes RED", async () => {
  const mutantPath = scratchModule((src) => {
    const anchor = "  const taskLogContextText = taskLogContextDirective(taskLogContext);";
    assert.ok(src.includes(anchor), "the mutation anchor is present");
    return src.replace(
      anchor,
      `${anchor}\n  // MUTATION: let the fetched context GATE the round.\n  if (taskLogContext.offered_count === 0) return fact("not-evaluated", { ...base, enabled: true }, "no task-status events — nothing spawned");`,
    );
  });
  const mutant = await import(pathToFileURL(mutantPath).href);
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  fs.writeFileSync(path.join(ws, ".quay", "task-status-events.jsonl"), "", "utf8");
  const spawn = countingSpawn();
  const fact = await mutant.runOpenSemanticDiscovery(ws, {
    config: readOpenSemanticDiscoveryConfig(ws).config,
    configPresent: true, configError: null, halted: false, invokedBy: INVOKED_BY_RESIDENT,
    modules: makeEngine().modules, launchArgvFn: fakeLaunchArgv, spawnFn: spawn, pinFn: pinStub(),
  });
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
  assert.match(fact.reason, /no task-status events/);
  assert.equal(spawn.calls.length, 0, "⇒ the mutant SUPPRESSED the semantic round: the (a) claim «0 events ⇒ the round runs» is FALSIFIED — the control is live");
  process.stdout.write("    NEGATIVE CONTROL (a): mutant spawned 0 calls with 0 events (claim was «the round still runs»)\n");
});

// ══ (n) ATTRIBUTABLE MODEL-CALL DIAGNOSTICS, ENUMERATED FAILURE, ONE COUNTED RETRY ═══════════════════
// Task gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token. Production
// recorded model calls that spent MINUTES of wall, emitted NO `result` event and reported 0 tokens, and
// the round wrote them with `not_evaluated:null` — the same bytes as an ordinary success (硬规则 3b). The
// cause could not be named because the record kept no reading of the stream itself. The cases below pin:
//   ① the per-call diagnostics (wall, exit+signal, stdout lines/bytes, event counts by `type`, has_result);
//   ② the ENUMERATED `call_failure` class, derived from those bytes and never collapsed into success;
//   ③ ONE counted retry for the three retryable classes, through a FRESH reservation on the same ledger.

/** The diagnostic object the routine feeds `callFailureClass`, built from the ENGINE's own reader — so the
 *  unit cases exercise the same recipe the round uses rather than a test-local re-implementation. */
const classInputOf = (stdout, { timedOut = false } = {}) => {
  const d = realHyp.streamDiagnostics(stdout);
  return {
    timed_out: timedOut, stdout_bytes: d.bytes, json_lines: d.json_lines,
    truncated_json: d.truncated_json, api_error_event: d.api_error_event, has_result: d.has_result,
  };
};

const INIT_EVENT = JSON.stringify({ type: "system", subtype: "init", model: FIXTURE_MODEL });
const ASSISTANT_EVENT = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "still exploring" }] } });
/** The production shape: the stream opened, the process exited 0, and NO `result` event was ever emitted. */
const NO_RESULT_STREAM = [INIT_EVENT, ASSISTANT_EVENT].join("\n") + "\n";
/** An API-transport refusal carried IN the stream: a `result` event with `is_error:true`. */
const API_ERROR_STREAM = [INIT_EVENT, JSON.stringify({
  type: "result", subtype: "error_during_execution", num_turns: 1, is_error: true,
  result: "", usage: { input_tokens: 0, output_tokens: 0 },
})].join("\n") + "\n";
/** ⛔ The MEASURED gateway-refusal shape (AC5 probe, 2026-10-13): an id the gateway does not serve comes
 *  back as `exit 1` with subtype `success`, `is_error:true` and ZERO usage. The subtype is NOT a cause
 *  here, which is exactly why the token must key on the transport-error reading instead. */
const API_400_STREAM = [INIT_EVENT, JSON.stringify({
  type: "result", subtype: "success", num_turns: 1, is_error: true,
  result: "API Error: 400 anthropic_messages: Invalid model name passed in model=x.",
  usage: { input_tokens: 0, output_tokens: 0 },
})].join("\n") + "\n";

test("(n) AC1 — streamDiagnostics reads the STREAM structurally: bytes, lines, events by type, has_result, truncation", () => {
  const ok = realHyp.streamDiagnostics(STREAM);
  assert.equal(ok.json_lines, 2, "the fixture stream carries two JSON events");
  assert.deepEqual(ok.events_by_type, { system: 1, result: 1 });
  assert.equal(ok.has_result, true);
  assert.equal(ok.truncated_json, false);
  assert.equal(ok.api_error_event, false);
  assert.equal(ok.bytes, Buffer.byteLength(STREAM, "utf8"));

  const noResult = realHyp.streamDiagnostics(NO_RESULT_STREAM);
  assert.equal(noResult.has_result, false, "no `result` event was emitted");
  assert.equal(noResult.json_lines, 2, "…but the stream DID parse — 'no stream' and 'stream without result' differ");
  assert.equal(noResult.truncated_json, false);

  const empty = realHyp.streamDiagnostics("");
  assert.equal(empty.bytes, 0);
  assert.equal(empty.lines, 0);
  assert.equal(empty.has_result, false);
  assert.equal(empty.events_by_type !== null && typeof empty.events_by_type === "object", true);

  // ⛔ Non-JSON stdout is NOT a truncated stream: the pre-`stream-json` path and the unit fixtures hand
  // this reader plain text, and calling that a cut stream would make two very different producers the same.
  const plain = realHyp.streamDiagnostics("just a sentence\n");
  assert.equal(plain.non_json_lines, 1);
  assert.equal(plain.unparsed_json_lines, 0);
  assert.equal(plain.truncated_json, false);

  // …and a stream that really was CUT mid-write is its own reading.
  const cut = realHyp.streamDiagnostics(STREAM + '{"type":"assis');
  assert.equal(cut.truncated_json, true, "the LAST line did not parse ⇒ the writer was interrupted");
  assert.equal(cut.unparsed_json_lines, 1);
  // …while an unparseable line in the MIDDLE is not "truncated" — the producer wrote something else.
  const mid = realHyp.streamDiagnostics('{"broken\n' + STREAM);
  assert.equal(mid.unparsed_json_lines, 1);
  assert.equal(mid.truncated_json, false);
});

test("(n) AC1 — one fixture per call_failure class, classified from the captured BYTES (not from the exit code)", () => {
  const cases = [
    ["no-stdout", "", {}],
    ["stream-without-result", NO_RESULT_STREAM, {}],
    ["truncated-json", STREAM + '{"type":"assis', {}],
    ["api-error-event", API_ERROR_STREAM, {}],
    ["api-error-event", API_400_STREAM, {}],
    ["killed-by-timeout", "half a stream", { timedOut: true }],
    ["unclassified", "not a stream at all\n", {}],
  ];
  for (const [expected, stdout, extra] of cases) {
    assert.equal(callFailureClass(classInputOf(stdout, extra)), expected, `${expected} (input ${JSON.stringify(classInputOf(stdout, extra))})`);
  }
  // A call that emitted a `result` and did not error has NO class — it is described by its own subtype.
  assert.equal(callFailureClass(classInputOf(STREAM)), null, "a clean stream is not a failure");
  // ⛔ …and the turn-cap kill has no class EITHER (it carries a `result`), yet it is certainly not a
  // success: the class table answers «why did this call produce no result», not «did this call answer».
  assert.equal(callFailureClass(classInputOf(MAX_TURNS_STREAM)), null);
  assert.equal(callNotEvaluatedToken({ exit: 1, subtype: "error_max_turns", has_result: true, spawn_error: null }), "not-evaluated:error_max_turns");
  // The retry policy is stated as data, so it cannot drift from what the round reads.
  assert.deepEqual([...RETRYABLE_CALL_FAILURES].sort(), ["api-error-event", "no-stdout", "stream-without-result"]);
  assert.equal(RETRYABLE_CALL_FAILURES.includes("killed-by-timeout"), false, "a timeout is NOT retried (Plan item 3)");
  assert.equal(RETRYABLE_CALL_FAILURES.includes("truncated-json"), false, "a cut stream is NOT retried (Plan item 3)");
});

test("(n) AC1 — exit 0 with NO result event ⇒ not-evaluated:no-result-event, NEVER null (the production defect)", () => {
  const productionShape = { exit: 0, spawn_error: null, subtype: null, has_result: false, is_error: null };
  assert.equal(callNotEvaluatedToken(productionShape), "not-evaluated:no-result-event");
  assert.notEqual(callNotEvaluatedToken(productionShape), null, "⛔ the production shape must NOT read as a success");
  // A call that exited 0 AND emitted a result is the ONE shape that reads as «it ran».
  assert.equal(callNotEvaluatedToken({ ...productionShape, has_result: true }), null);
  // A `result` that says the run ERRORED is not a success just because the process exited 0.
  assert.equal(
    callNotEvaluatedToken({ exit: 0, spawn_error: null, subtype: "error_during_execution", has_result: true, is_error: true }),
    "not-evaluated:error_during_execution",
  );
  // ⛔ The MEASURED gateway-refusal shape (AC5 probe): subtype `success` is NOT a cause — the transport
  // error is, and without the capture the exit code carries it. `not-evaluated:success` is unproducible.
  assert.equal(
    callNotEvaluatedToken({ exit: 1, spawn_error: null, subtype: "success", has_result: true, is_error: true, api_error_event: true }),
    "not-evaluated:api-error-event",
  );
  assert.equal(
    callNotEvaluatedToken({ exit: 1, spawn_error: null, subtype: "success", has_result: true, is_error: true }),
    "not-evaluated:uninstrumented-exit-1",
    "…and with the capture missing, `success` is never minted as a cause",
  );
  assert.notEqual(callNotEvaluatedToken({ exit: 1, spawn_error: null, subtype: "success", has_result: true }), "not-evaluated:success");
  // ⛔ An UNCAPTURED `has_result` is «not queried», not «ran» (硬规则 6) — the same direction as the fix.
  assert.equal(callNotEvaluatedToken({ exit: 0, spawn_error: null, subtype: null }), "not-evaluated:no-result-event");
  // A timeout names ITSELF, before the generic spawn-error reading, because the retry policy keys on it.
  assert.equal(callNotEvaluatedToken({ exit: null, spawn_error: "spawn timeout after 1000ms (SIGKILL)", timed_out: true }), "not-evaluated:killed-by-timeout");
  assert.equal(callNotEvaluatedToken({ exit: null, spawn_error: "boom", timed_out: false }), "not-evaluated:spawn-error");
});

test("(n) AC1 NEGATIVE CONTROL — restore the pre-fix rule (exit 0 ⇒ success) and the production shape goes RED", () => {
  const productionShape = { exit: 0, spawn_error: null, subtype: null, has_result: false, is_error: null };
  assert.equal(callNotEvaluatedToken(productionShape), "not-evaluated:no-result-event", "the CURRENT rule names it");
  // ⛔ THE MUTATION: the exact pre-fix body of the predicate (`exit === 0 ⇒ null`).
  const preFix = (rec) => (rec.exit === 0 ? null : `not-evaluated:uninstrumented-exit-${rec.exit}`);
  assert.equal(preFix(productionShape), null, "the pre-fix rule reads minutes-of-wall, zero-token, result-less calls as SUCCESS — this IS the defect");
  assert.notEqual(preFix(productionShape), callNotEvaluatedToken(productionShape), "…so the fixture is RED under the mutation");
  // The classifier half: drop the API-error capture and the SAME bytes read as a CLEAN call.
  assert.equal(callFailureClass(classInputOf(API_ERROR_STREAM)), "api-error-event", "the capture names it");
  const dropped = { ...classInputOf(API_ERROR_STREAM), api_error_event: false };
  assert.equal(callFailureClass(dropped), null, "without the error capture the very same stream reads as a success");
  assert.notEqual(callFailureClass(dropped), callFailureClass(classInputOf(API_ERROR_STREAM)), "⇒ the (n) class claim is live, not an echo");
  // …and the round really DOES feed the capture into the classifier — otherwise the mutation is of a value
  // the routine never produces, and the control proves nothing (硬规则 4 推论四).
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  assert.match(src, /api_error_event: diag\.api_error_event/, "the class is read from the captured bytes");
  assert.match(src, /has_result: hasResult,/, "the record carries whether a result event was emitted");
  assert.match(src, /rec\.call_failure = callFailureClass\(/, "the round derives the class from those bytes");
  assert.equal(CALL_CAPTURE_DIR_REL, path.join(".quay", "open-semantic-discovery-call-captures"));
  assert.ok(STDOUT_HEAD_MAX > 0 && STDOUT_TAIL_MAX > 0 && RETRY_BACKOFF_MS > 0, "the bounds and the backoff are declared, not incidental");
});

test("(n) AC1 — a result-less exit-0 call is recorded as no-result-event WITH its bounded capture on the round", async () => {
  const STDERR = "connectors notice\n[claude-code:unrecognized_model] {\"model\":\"v4.1flash-anthropic\"}\n";
  const delegate = (argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    return { status: 0, stdout: NO_RESULT_STREAM, stderr: STDERR, error: null };
  };
  const { ws, opts } = answerReserveFixture({ delegate });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  const round = rounds(ws)[0];
  const call = round.calls.find((c) => c.step === "investigator" && c.retry_of === undefined);

  assert.equal(call.exit, 0, "the process exited ZERO — and that is exactly why this was invisible before");
  assert.equal(call.has_result, false, "the stream carried no `result` event");
  assert.equal(call.stream_ok, true, "…yet it parsed: «no stream» and «stream without result» are DIFFERENT readings");
  assert.equal(call.not_evaluated, "not-evaluated:no-result-event");
  assert.equal(call.call_failure, "stream-without-result");
  assert.equal(call.signal, null);
  assert.equal(typeof call.wall_ms, "number");
  assert.ok(call.wall_ms >= 0);
  assert.equal(typeof call.stdout_lines, "number");
  assert.equal(call.stdout_events_by_type.system, 1, "the init event is counted by its own `type`");
  assert.equal(call.stdout_events_by_type.assistant, 1);
  assert.equal(call.stdout_events_by_type.result, undefined, "…and the ABSENT result shows as an absent key, not a zero");
  assert.equal(typeof call.reservation_id, "string");
  assert.equal(call.round_id, round.round_id, "the record is attributable to its round");

  // The bounded head/tail really landed in a side file under `.quay/`, with the launcher's own stderr.
  assert.equal(typeof call.stdout_capture?.path, "string", `a capture path is on the record (got ${JSON.stringify(call.stdout_capture)})`);
  assert.ok(call.stdout_capture.path.startsWith(CALL_CAPTURE_DIR_REL), "the capture lives under .quay/");
  const captured = fs.readFileSync(path.join(ws, call.stdout_capture.path), "utf8");
  assert.ok(captured.includes("# stdout head"), "the capture carries the head");
  assert.ok(captured.includes("# stdout tail"), "…and the tail");
  assert.ok(captured.includes("unrecognized_model"), "…and the launcher's stderr tail, byte for byte");
  assert.equal(call.stdout_capture.stdout_bytes, Buffer.byteLength(NO_RESULT_STREAM, "utf8"));
  assert.equal(call.stdout_capture.stdout_head_truncated, false, "the fixture is short of the bound");

  // ⛔ THE ASSERTION THE TASK EXISTS FOR: the Fact NAMES the cause instead of reporting a clean round.
  assert.equal(fact.state, "not-evaluated", `got ${fact.state}: ${fact.reason}`);
  assert.match(fact.reason, /not-evaluated:no-result-event/);
  assert.doesNotMatch(fact.reason, /CONFIRMED/);
});

test("(n) AC1 — the capture is BOUNDED and says so: a huge stream is truncated, and the record says which end", () => {
  const root = tmpDir("osd-capture-selftest-");
  // A stream whose MIDDLE is identifiable: if the capture really keeps head+tail, the middle is gone.
  const head = `HEADMARK-${"h".repeat(STDOUT_HEAD_MAX)}`;
  const middle = `MIDDLEMARK-${"m".repeat(5000)}`;
  const tail = `${"t".repeat(STDOUT_TAIL_MAX)}TAILMARK-`;
  const huge = head + middle + tail;
  const cap = writeCallCapture(root, path.join(root, CALL_CAPTURE_DIR_REL, "selftest.txt"), { stdout: huge, stderr: "e".repeat(STDERR_TAIL_MAX + 5) });
  assert.equal(cap.stdout_head_truncated, true);
  assert.equal(cap.stdout_tail_truncated, true);
  assert.equal(cap.stderr_tail_truncated, true);
  assert.equal(cap.stdout_bytes, Buffer.byteLength(huge, "utf8"), "the RECORD carries the TRUE size, not the kept size");
  const onDisk = fs.readFileSync(path.join(root, cap.path), "utf8");
  assert.ok(onDisk.includes("HEADMARK-"), "the HEAD is kept");
  assert.ok(onDisk.includes("TAILMARK-"), "…and the TAIL is kept");
  assert.equal(onDisk.includes("MIDDLEMARK-"), false, "…and the middle is DROPPED — the capture is bounded, not a transcript");
  assert.equal(boundedHead("short", 100).truncated, false);
  assert.equal(boundedHead("abcdef", 3).head, "abc", "the head is a HEAD");
  assert.equal(boundedTail("abcdef", 3).tail, "def", "the tail is a TAIL");
});

test("(n) AC2 — a retryable call is retried EXACTLY ONCE, and the retry has its OWN reservation id in the ledger", async () => {
  const good = streamText(`${FOCUS_MARKER} fixture focus\n${JSON.stringify(HYPS)}`);
  let n = 0;
  const delegate = (argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    n++;
    // The FIRST non-novelty call leaves nothing (the production shape); every later call answers.
    return n === 1
      ? { status: 0, stdout: "", stderr: "gateway returned an empty body\n", error: null }
      : { status: 0, stdout: good, stderr: "", error: null };
  };
  const { ws, opts } = answerReserveFixture({ delegate });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  const round = rounds(ws)[0];
  const inv = round.calls.filter((c) => c.step === "investigator");

  assert.equal(inv.length, 2, "exactly two records: the LOST call and its ONE retry");
  assert.equal(inv[0].call_failure, "no-stdout");
  assert.equal(inv[0].not_evaluated, "not-evaluated:no-result-event");
  assert.equal(inv[0].retry_of, undefined, "the first call is not itself a retry");
  assert.equal(inv[1].retry_of, inv[0].reservation_id, "the retry NAMES the call it repeats");
  assert.equal(inv[1].retry_cause, "no-stdout", "…and WHY it was retried");
  assert.notEqual(inv[1].reservation_id, inv[0].reservation_id, "a FRESH reservation — never a reuse of the lost one");
  assert.equal(inv[1].not_evaluated, null, "the retry answered");
  assert.equal(fact.state, "verified", `the retry's answer is what the round read (got ${fact.state}: ${fact.reason})`);

  // ⛔ AC2/AC4: the ledger carries BOTH reservations, each with its OWN id, and the round's `model_calls`
  // is exactly the count of reservations attributed to this round by `round_id`.
  const reserves = ledgerReserves(ws).filter((l) => l.round === round.round_id);
  assert.equal(reserves.length, round.model_calls, `ledger reservations (${reserves.length}) must equal model_calls (${round.model_calls})`);
  assert.deepEqual(reserves.map((l) => l.id).sort(), round.calls.map((c) => c.reservation_id).sort(), "every record's reservation_id resolves in the ledger");
  // AC4: the per-call charged USD sums to the round's cost_usd — the arithmetic the verifier repeats.
  const sum = round.calls.reduce((a, c) => a + Number(c.cost_charged_usd ?? 0), 0);
  assert.equal(Math.round(sum * 1e6) / 1e6, round.cost_usd, "sum(cost_charged_usd) == round.cost_usd");
});

test("(n) AC2 — NO retry when the ledger refuses: the round's ceiling is not spent twice on one lost call", async () => {
  let n = 0;
  const delegate = (argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    n++;
    return { status: 0, stdout: "", stderr: "empty\n", error: null };
  };
  const ws = makeWorkspace();
  // A cap of ONE: the first (any) call is granted; the retry's reservation is REFUSED.
  writeConfig(ws, cfgYaml({ max_model_calls_per_24h: 1 }));
  const engine = makeEngine();
  engine.modules.hyp.runInvestigator = streamReadingInvestigator();
  const spawn = countingSpawn(delegate);
  const fact = await runOpenSemanticDiscovery(ws, {
    ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub(),
    pinTmpRoot: tmpDir("osd-retry-refuse-"), retryBackoffMs: 0, sleepFn: async () => {},
  });

  assert.equal(n, 1, "exactly ONE spawn: the refusal stopped the retry BEFORE a second subprocess");
  const reserves = ledgerReserves(ws);
  assert.equal(reserves.length, 1, "and exactly ONE reservation was granted — the retry left no ledger line");
  const round = rounds(ws)[0];
  assert.equal(round.model_calls, 1);
  assert.equal(round.calls.length, 1, "only the lost call is on the round: no phantom retry record");
  assert.equal(round.calls[0].call_failure, "no-stdout", "…and the lost call is still CLASSIFIED, not hidden by the refusal");
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /budget-24h/);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated — AC1…AC3
//
// WHAT THE THREE READINGS ARE. Before this task every refutation the routine ever recorded said
// `undetermined`, and the record could not tell apart (i) a refuter KILLED at its turn cap, (ii) one that
// read the code and found no counter-evidence, and (iii) a call that never answered. The fixture below
// makes each of the three happen on its own, so `refutation_undetermined_cause` is a READING of what the
// call did rather than a label pasted on the word `undetermined`.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** The refuter's answer, as the model would write it: a verdict plus the positions it checked. */
const REFUTER_ANSWER = (verdict, extra = {}) => JSON.stringify({
  verdict, intentional_difference_found: verdict === "refuted" ? "fixture counterexample" : null,
  evidence: [{ file: "plugin/scripts/a.ts", line: 1, quote: "export const a = 1;" }],
  counterexample: "what would have to be true", checked: ["plugin/scripts/a.ts:1", "plugin/scripts/b.ts:9"],
  summary: "fixture summary", ...extra,
});

/** Is THIS launcher call the refuter's? The three `Read,Grep` judgment steps share one tool envelope, so
 *  the argv cannot tell them apart — the PROMPT is the discriminator, and it is the routine's OWN decision
 *  read at the launcher rather than a counter the test keeps (which would agree with the routine's call
 *  ORDER instead of with what was actually asked). */
const isRefuterCall = (opts) => String(opts?.stdinData ?? "").startsWith(REFUTATION_FIRST_LINE);

/** A `stream-json` stream with `reads` REAL tool-use turns — the direct evidence that the call READ the
 *  tree — and a `result` event carrying the CLI's own `num_turns`/subtype/usage. */
const refuterStream = ({ numTurns, reads = 0, text = REFUTER_ANSWER("supported"), subtype = "success", isError = false }) => [
  JSON.stringify({ type: "system", subtype: "init", model: FIXTURE_MODEL }),
  ...Array.from({ length: reads }, (_, i) => JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: `t${i}`, name: i % 2 === 0 ? "Read" : "Grep", input: { file_path: `plugin/scripts/f${i}.ts`, pattern: "fixture" } }] },
  })),
  JSON.stringify({
    type: "result", subtype, num_turns: numTurns, is_error: isError, result: text,
    usage: { input_tokens: 1000, output_tokens: 100 }, total_cost_usd: 0.03,
  }),
].join("\n") + "\n";

/** The REFUTER KILLED AT ITS TURN CAP — the production shape: `num_turns` up to the cap, a `result` event
 *  whose `subtype` is `error_max_turns`, exit 1, and a partial (empty) answer. */
const truncatedRefuterStream = (numTurns, reads) => refuterStream({ numTurns, reads, subtype: "error_max_turns", isError: true, text: "" });

/** A round with the fixture's clusters, in which EVERY step answers except the REFUTER, whose calls are
 *  produced one-by-one by `refuterStreams(n)` (n = 0-based refuter call index). Everything else about the
 *  round is held fixed, so the only thing that varies between the AC1 cases is what the refuter returned. */
function refuterChainFixture({ hyps = [HYPS[0]], refuterVerdict = "supported", refuterStreams }) {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ hyps, verdictFor: (ci, o) => (isRefuterPrompt(o) ? refuterVerdict : "supported") });
  engine.modules.hyp.runInvestigator = streamReadingInvestigator();
  let n = 0;
  const delegate = (argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    if (toolsOf(argv) === INVESTIGATOR_TOOLS) return { status: 0, stdout: streamText(`${FOCUS_MARKER} f\n${JSON.stringify(hyps)}`), stderr: "", error: null };
    if (isRefuterCall(opts)) {
      // A case may hand back a bare stream (the common shape) or an explicit `{status, stdout}` — a
      // turn-cap kill and a transport failure need their own exit code, so the fixture takes either.
      const s = refuterStreams(n++);
      return typeof s === "string"
        ? { status: 0, stdout: s, stderr: "", error: null }
        : { status: s.status ?? 0, stdout: s.stdout, stderr: s.stderr ?? "", error: null };
    }
    // The remaining steps' VERDICTS are the stub's; this only supplies a stream that PARSED, i.e. a call
    // that really ran (an unparsed stream would be `not-evaluated` and change what is under test).
    return { status: 0, stdout: streamText(REFUTER_ANSWER("supported")), stderr: "", error: null };
  };
  const spawn = countingSpawn(delegate);
  const opts = {
    ...runOpts(ws, { engine }), spawnFn: spawn, pinFn: pinStub(),
    pinTmpRoot: tmpDir("osd-refuter-pinroot-"), retryBackoffMs: 0, sleepFn: async () => {},
  };
  return { ws, engine, spawn, opts };
}
const clusterOf = (ws, i = 1) => carrierLines(ws).find((l) => l.kind === "cluster" && l.cluster === i);

test("AC1(a) — a refuter stream ending `error_max_turns` ⇒ `budget-truncated`, and EXACTLY ONE retry reservation on the ledger", async () => {
  // BOTH the refuter and its retry are cut off — the production shape, where the larger budget still is
  // not enough. The cause must stay `budget-truncated` (the retry is not a way to launder the first).
  const { ws, opts } = refuterChainFixture({ refuterVerdict: "undetermined", refuterStreams: () => ({ status: 1, stdout: truncatedRefuterStream(7, 6) }) });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  const cluster = clusterOf(ws);

  assert.equal(cluster.refutation_verdict, "undetermined");
  assert.equal(cluster.refutation_undetermined_cause, "budget-truncated", "a call killed at the turn cap NAMES the budget as its cause");
  assert.deepEqual(cluster.refutation_call.calls.map((c) => c.role), ["first", "retry"], "the truncated attempt AND its one retry are both on the record");
  assert.deepEqual(cluster.refutation_call.calls.map((c) => c.subtype), ["error_max_turns", "error_max_turns"]);
  assert.equal(cluster.refutation_call.calls[0].num_turns, 7, "the CLI's own turn unit, off the CALL");
  assert.equal(cluster.refutation_call.retried, true);
  assert.equal(cluster.confirmed, false, "a truncated refutation confirms NOTHING");

  // ⛔ THE COUNTED RETRY: `reservingStep`'s transport retry does NOT fire here (a turn-cap kill carries a
  // `result` event, so it is not a retryable transport class), so the ledger is the budget retry alone.
  const refuterReserves = ledgerReserves(ws).filter((l) => String(l.step).endsWith("refuter"));
  assert.equal(refuterReserves.length, 2, "exactly TWO refuter reservations: the attempt and its ONE retry");
  assert.equal(refuterReserves.filter((l) => l.max_turns === DEFAULT_REFUTATION_RETRY_MAX_TURNS).length, 1, "exactly ONE retry reservation — and it NAMES the larger budget it was granted");
  assert.equal(refuterReserves.filter((l) => l.max_turns === 6).length, 1, "the first attempt keeps the measured-unchanged step budget");
  assert.equal(rounds(ws)[0].model_calls, rounds(ws)[0].calls.length, "every spawn is one reservation, the retry included");
  assert.equal(fact.state, "verified", `the round still completes (got ${fact.state}: ${fact.reason})`);
});

test("AC1(b) — a refuter that READ the tree and names no counterexample ⇒ `no-counter-evidence` (and NOT a confirmation)", async () => {
  // The call ANSWERED (`exit 0`, a `result` event, 5 tool turns); the model's own verdict is `undetermined`
  // — «the code does not settle it». That is a statement about the REPOSITORY, so it gets its own cause.
  const { ws, opts } = refuterChainFixture({
    refuterVerdict: "undetermined",
    refuterStreams: (n) => (n === 0
      ? refuterStream({ numTurns: 12, reads: 5, text: REFUTER_ANSWER("undetermined") })
      : refuterStream({ numTurns: 2, reads: 0, text: REFUTER_ANSWER("supported") })),
  });
  await runOpenSemanticDiscovery(ws, opts);
  const cluster = clusterOf(ws);

  assert.equal(cluster.refutation_undetermined_cause, "no-counter-evidence");
  assert.equal(cluster.refutation_turns, 12, "the CLI unit, off the answering call");
  assert.equal(cluster.refutation_subtype, "success", "the call RAN — this is not a failure");
  assert.equal(cluster.refutation_call.tool_use.by_tool.Read + cluster.refutation_call.tool_use.by_tool.Grep, 5, "the reading is ATTRIBUTABLE: the refuter opened files");
  assert.deepEqual(cluster.refutation_checked, ["plugin/scripts/a.ts:1", "plugin/scripts/b.ts:9"], "a «found nothing» verdict carries the positions it checked");
  assert.equal(cluster.refutation_call.retried, false, "nothing was truncated ⇒ no retry reservation was spent");
  assert.equal(cluster.confirmed, false, "⛔ «we could not refute it» is still NOT «it is true»");
});

test("AC1(c) — a 0-token exit with no result ⇒ `call-failed`, which is NOT the budget's fault", async () => {
  // The MEASURED production shape: the refuter spent its wall clock and left no result event, so its usage
  // is unreadable (0 tokens) — an INFRASTRUCTURE fact. A retry with more turns would reproduce it, which is
  // why the budget retry keys on `error_max_turns` ALONE: no second refuter call may be spent here.
  const { ws, opts } = refuterChainFixture({
    refuterVerdict: "undetermined",
    refuterStreams: () => ({ status: 1, stdout: "the gateway returned no result\n", stderr: "" }),
  });
  await runOpenSemanticDiscovery(ws, opts);
  const cluster = clusterOf(ws);

  assert.equal(cluster.refutation_undetermined_cause, "call-failed");
  assert.equal(cluster.refutation_call.calls.length, 1, "no retry: more turns would not have helped a call that never answered");
  assert.equal(ledgerReserves(ws).filter((l) => String(l.step).endsWith("refuter")).length, 1);
  assert.equal(cluster.refutation_call.calls[0].not_evaluated, "not-evaluated:uninstrumented-exit-1");
  assert.equal(cluster.refutation_call.tool_use, null, "a call whose stream did not parse reports NO tool-use reading — never a zero-count one (硬规则 3b)");
  assert.equal(cluster.confirmed, false);
});

test("AC1(d) — `confirmed` is TRUE only for a DETERMINATE «survived», never for an undetermined one", async () => {
  // The positive arm: the refuter answered with a determinate `supported` (survived), read the tree, and
  // cited evidence — the ONE shape that may reach `confirmed`.
  const survived = refuterChainFixture({
    refuterVerdict: "supported",
    refuterStreams: () => refuterStream({ numTurns: 11, reads: 4, text: REFUTER_ANSWER("supported") }),
  });
  await runOpenSemanticDiscovery(survived.ws, survived.opts);
  const ok = clusterOf(survived.ws);
  assert.equal(ok.refutation_verdict, "supported");
  assert.equal(ok.refutation_undetermined_cause, null, "a determinate verdict has NO undetermined cause");
  assert.equal(ok.confirmed, true, "supported verifier + determinate survived + cited evidence ⇒ confirmed");

  // The three UNDETERMINED arms: each names its own cause, and NONE of them is confirmed.
  const arms = [
    ["budget-truncated", "undetermined", () => ({ status: 1, stdout: truncatedRefuterStream(7, 6) })],
    ["no-counter-evidence", "undetermined", () => refuterStream({ numTurns: 12, reads: 5, text: REFUTER_ANSWER("undetermined") })],
    ["call-failed", "undetermined", () => ({ status: 1, stdout: "no result\n", stderr: "" })],
    ["unparseable", "undetermined", () => refuterStream({ numTurns: 9, reads: 3, text: "I looked and I am not sure." })],
  ];
  for (const [cause, verdict, stream] of arms) {
    const f = refuterChainFixture({ refuterVerdict: verdict, refuterStreams: stream });
    await runOpenSemanticDiscovery(f.ws, f.opts);
    const c = clusterOf(f.ws);
    assert.equal(c.refutation_undetermined_cause, cause, `${cause}: the cause is named`);
    assert.equal(c.confirmed, false, `${cause}: NOT a confirmation`);
    assert.equal(rounds(f.ws)[0].confirmed.count, 0, `${cause}: the round reports 0 confirmed`);
  }
});

test("AC1(d) NEGATIVE CONTROL — let `undetermined` count as survived ⇒ the (d) claims go RED", async () => {
  // ⛔ THE MUTATION IS EXACTLY «undetermined counts as survived»: `confirmed` becomes «the verifier
  // supported it and the refuter did not refute it», which is the conflation this task exists to end.
  const mutantPath = scratchModule((src) => src.replace(
    "      const confirmed = row.verdict === \"supported\" && refutationRead.verdict === \"supported\" && refutationRead.undetermined_cause === null;",
    "      const confirmed = row.verdict === \"supported\" && refutationRead.verdict !== \"refuted\"; // MUTATION: undetermined counts as survived",
  ));
  const mutant = await import(pathToFileURL(mutantPath).href);
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ hyps: [HYPS[0]], verdictFor: (ci, o) => (isRefuterPrompt(o) ? "undetermined" : "supported") });
  engine.modules.hyp.runInvestigator = streamReadingInvestigator();
  const spawn = countingSpawn((argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    if (toolsOf(argv) === INVESTIGATOR_TOOLS) return { status: 0, stdout: streamText(`${FOCUS_MARKER} f\n${JSON.stringify([HYPS[0]])}`), stderr: "", error: null };
    if (isRefuterCall(opts)) return { status: 1, stdout: truncatedRefuterStream(7, 6), stderr: "", error: null };
    return { status: 0, stdout: streamText(REFUTER_ANSWER("supported")), stderr: "", error: null };
  });
  const fact = await mutant.runOpenSemanticDiscovery(ws, {
    config: readOpenSemanticDiscoveryConfig(ws).config, configPresent: true, configError: null, halted: false,
    invokedBy: INVOKED_BY_RESIDENT, modules: engine.modules, launchArgvFn: fakeLaunchArgv,
    spawnFn: spawn, pinFn: pinStub(), pinTmpRoot: tmpDir("osd-ac1d-mutant-"), retryBackoffMs: 0, sleepFn: async () => {},
  });
  assert.equal(fact.state, "verified");
  const rec = carrierLines(ws).find((l) => l.kind === "cluster");
  assert.equal(rec.refutation_undetermined_cause, "budget-truncated", "the mutant still NAMES the cause the real module names");
  assert.equal(rec.confirmed, true, "⇒ the (d) claim («NOT confirmed») is FALSIFIED — the control is live");
  process.stdout.write(`    NEGATIVE CONTROL AC1(d): mutant reports confirmed=true for a BUDGET-TRUNCATED refutation (claim was «confirmed only for a determinate survived»)\n`);
});

test("AC2 — each cluster's refutation fields come from ITS OWN call, off the CLI's own turn unit", async () => {
  // Two clusters, two DIFFERENT refuter calls: cluster 1's answers with 11 CLI turns; cluster 2's is
  // truncated at 7 and answered by its retry at 19. Under the old join both rows read the ENGINE ROW's
  // `turns_used` (the parser's TOOL-CALL count, and — when a rescue fired — the tool-less rescue's row),
  // so a cluster's `refutation_turns` was neither its own call's nor in the cap's unit.
  const { ws, opts } = refuterChainFixture({
    hyps: HYPS,
    refuterVerdict: "supported",
    refuterStreams: (n) => (n === 1
      ? { status: 1, stdout: truncatedRefuterStream(7, 5) }
      : refuterStream({ numTurns: n === 0 ? 11 : 19, reads: n === 0 ? 4 : 6, text: REFUTER_ANSWER("supported") })),
  });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  assert.equal(fact.state, "verified");

  const c1 = clusterOf(ws, 1);
  const c2 = clusterOf(ws, 2);
  assert.equal(c1.refutation_turns, 11, "cluster 1's OWN call");
  assert.equal(c1.refutation_subtype, "success");
  assert.deepEqual(c1.refutation_call.calls.map((c) => c.role), ["first"], "cluster 1 was not truncated");
  assert.equal(c2.refutation_turns, 19, "cluster 2's OWN ANSWERING call — the retry, not the truncated attempt");
  assert.equal(c2.refutation_subtype, "success");
  assert.deepEqual(c2.refutation_call.calls.map((c) => [c.role, c.num_turns, c.subtype]), [
    ["first", 7, "error_max_turns"],
    ["retry", 19, "success"],
  ], "cluster 2 carries BOTH of its calls, each with its own CLI turns and subtype");
  assert.notEqual(c1.refutation_turns, c2.refutation_turns, "the two clusters' readings DIFFER — so the fixture can tell a join from a constant");
  // The calling cluster's tool counts are its OWN call's, which is what makes the verdict attributable.
  assert.deepEqual(c1.refutation_call.tool_use.by_tool, { Read: 2, Grep: 2 });
  assert.deepEqual(c2.refutation_call.tool_use.by_tool, { Read: 3, Grep: 3 });
  assert.equal(c1.refutation_call.tool_use.total, 4, "cluster 1's OWN reads");
  assert.equal(c2.refutation_call.tool_use.total, 6, "cluster 2's retry's OWN reads");
  // Each cluster's refutation is addressable to its own reservations.
  const ids = new Set(rounds(ws)[0].calls.map((c) => c.reservation_id));
  for (const id of [...c1.refutation_call.reservation_ids, ...c2.refutation_call.reservation_ids]) {
    assert.ok(ids.has(id), `reservation ${id} resolves on the round`);
  }
  assert.equal(new Set([...c1.refutation_call.reservation_ids, ...c2.refutation_call.reservation_ids]).size, 3, "three refuter reservations across the two clusters");
});

test("AC2 NEGATIVE CONTROL — restore the OLD join (the engine row's units) ⇒ the AC2 claims go RED", async () => {
  // ⛔ THE MUTATION IS THE OLD JOIN, VERBATIM: `refutation_turns`/`cost_usd` read off the engine ROW and
  // `subtype` not read at all. Same fixture, same round — only the source of the three fields changes.
  const mutantPath = scratchModule((src) => src.replace(
    "        entry.refutation_turns = refutationRead.turns;\n        entry.refutation_cost_usd = refutationRead.cost_usd;\n        entry.refutation_subtype = refutationRead.subtype;",
    "        entry.refutation_turns = (refutation?.turns_used) ?? null; // MUTATION: the old join\n        entry.refutation_cost_usd = refutation?.cost_usd ?? null;\n        entry.refutation_subtype = null; // MUTATION: the old join read no subtype",
  ));
  const mutant = await import(pathToFileURL(mutantPath).href);
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ hyps: HYPS, verdictFor: (ci, o) => (isRefuterPrompt(o) ? "supported" : "supported") });
  engine.modules.hyp.runInvestigator = streamReadingInvestigator();
  let n = 0;
  const plan = [
    refuterStream({ numTurns: 11, reads: 4, text: REFUTER_ANSWER("supported") }),
    truncatedRefuterStream(7, 5),
    refuterStream({ numTurns: 19, reads: 6, text: REFUTER_ANSWER("supported") }),
  ];
  const spawn = countingSpawn((argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    if (toolsOf(argv) === INVESTIGATOR_TOOLS) return { status: 0, stdout: streamText(`${FOCUS_MARKER} f\n${JSON.stringify(HYPS)}`), stderr: "", error: null };
    if (isRefuterCall(opts)) return { status: 0, stdout: plan[n++], stderr: "", error: null };
    return { status: 0, stdout: streamText(REFUTER_ANSWER("supported")), stderr: "", error: null };
  });
  const fact = await mutant.runOpenSemanticDiscovery(ws, {
    config: readOpenSemanticDiscoveryConfig(ws).config, configPresent: true, configError: null, halted: false,
    invokedBy: INVOKED_BY_RESIDENT, modules: engine.modules, launchArgvFn: fakeLaunchArgv,
    spawnFn: spawn, pinFn: pinStub(), pinTmpRoot: tmpDir("osd-ac2-mutant-"), retryBackoffMs: 0, sleepFn: async () => {},
  });
  assert.equal(fact.state, "verified");
  const c1 = carrierLines(ws).find((l) => l.kind === "cluster" && l.cluster === 1);
  const c2 = carrierLines(ws).find((l) => l.kind === "cluster" && l.cluster === 2);
  // The stub's rows carry a CONSTANT `turns_used: 2` for every cluster, so the old join reports the same
  // number twice — it cannot tell the two clusters' calls apart, which is exactly the defect.
  assert.equal(c1.refutation_turns, 2, "the mutant reads the ENGINE ROW's tool-call count, not the call's CLI turns");
  assert.equal(c2.refutation_turns, 2, "…and the same constant for the second cluster");
  assert.equal(c2.refutation_subtype, null, "…and the mutant has no subtype to read at all");
  assert.notEqual(c1.refutation_turns, 11, "⇒ the AC2 claim («cluster 1's own call») is FALSIFIED — the control is live");
  assert.notEqual(c2.refutation_turns, 19, "⇒ the AC2 claim («cluster 2's OWN answering call») is FALSIFIED");
  process.stdout.write(`    NEGATIVE CONTROL AC2: old join reports refutation_turns=${c1.refutation_turns}/${c2.refutation_turns} for calls of 11 and 19 CLI turns (claim was «each cluster's own call»)\n`);
});

test("AC3 — the retry budget is a MEASURED default, OPTIONAL, and REQUIRED to be strictly larger than the step's", () => {
  const base = cfgYaml();
  const absent = parseOpenSemanticDiscoverySection(YAML.parse(base).loop.open_semantic_discovery);
  assert.equal(absent.error, null);
  assert.equal(absent.config.refutationMaxTurns, 6, "the step's OWN budget is UNCHANGED: 1 answered refuter sample < the 10 AC3 requires");
  assert.equal(absent.config.refutationRetryMaxTurns, DEFAULT_REFUTATION_RETRY_MAX_TURNS, "absent ⇒ the measured p100 of the answered tool-reading calls");

  // The default FOLLOWS a raised first budget rather than silently becoming a no-op retry. ⛔ The first
  // budget below must stay ABOVE `DEFAULT_REFUTATION_RETRY_MAX_TURNS` for this to exercise the FOLLOW
  // branch at all — it was 40 against a default of 26, and is 50 against the re-derived 44.
  const raised = parseOpenSemanticDiscoverySection(YAML.parse(cfgYaml({ refutation_max_turns: 50 })).loop.open_semantic_discovery);
  assert.equal(raised.error, null);
  assert.equal(raised.config.refutationRetryMaxTurns, 51, "a first budget above the measured p100 still leaves the retry LARGER");

  // A DECLARED retry budget must be larger, or the config is refused: «ONE retry with a larger budget» is
  // an invariant of the section, not a property of its default.
  const smaller = parseOpenSemanticDiscoverySection(YAML.parse(cfgYaml({ refutation_retry_max_turns: 6 })).loop.open_semantic_discovery);
  assert.equal(smaller.config, null);
  assert.match(smaller.error, /refutation_retry_max_turns.*must be > 'refutation_max_turns'/);
  const declared = parseOpenSemanticDiscoverySection(YAML.parse(cfgYaml({ refutation_retry_max_turns: 33 })).loop.open_semantic_discovery);
  assert.equal(declared.error, null);
  assert.equal(declared.config.refutationRetryMaxTurns, 33, "a declared retry budget is used verbatim");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// THE PER-CLUSTER ATTRIBUTION JOIN + THE RESIDENT-ROUND DoD + THE call-failed SPLIT
// (tasks/gap-osd-resident-round-never-autonomously-confirms-fix-attribution-and-call-failed-retry,
//  Plan items 2-4)
//
// Plan item 3's defect: a round's `confirmed:0` had no per-cluster explanation — for a cluster the
// VERIFIER never supported, the refuter's `not-run` is a CONSEQUENCE, and nothing on the record named the
// verifier's own failure as the thing that blocked the cluster. Plan item 4's: the DoD had to be a
// reportable RATE, not a per-round boolean. Plan item 2's: the `call-failed` class had to be classified
// further, with the retry decision resting on a measured retry-then-succeeds rate.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

test("attribution AC3 — the join names WHICH step blocked a cluster, and THAT step's own cause", () => {
  const none = { determinate: true, blocking_step: "none", blocking_cause: null };
  // The verifier did not support the cluster ⇒ blocked AT THE VERIFIER, with the verifier row's own cause.
  // ⛔ The refuter's `not-run` is deliberately NOT the answer here, even though it is what the record's
  // refutation fields say: a consequence must not be reported as the cause.
  assert.deepEqual(
    clusterAttribution({ verifierVerdict: "undetermined", verifierCause: "exit-1", refutationVerdict: "not-run", refutationUndeterminedCause: null }),
    { determinate: false, blocking_step: "verifier", blocking_cause: "exit-1" },
  );
  assert.deepEqual(
    clusterAttribution({ verifierVerdict: "undetermined", verifierCause: "turn-budget", refutationVerdict: "not-run", refutationUndeterminedCause: null }),
    { determinate: false, blocking_step: "verifier", blocking_cause: "turn-budget" },
    "a turn-cap kill and an infrastructure kill are DIFFERENT causes, on the record",
  );
  // supported + survived ⇒ the only confirmation shape.
  assert.deepEqual(clusterAttribution({ verifierVerdict: "supported", verifierCause: null, refutationVerdict: "supported", refutationUndeterminedCause: null }), none);
  // supported + REFUTED ⇒ determinate (a real negative finding), and still not a confirmation.
  assert.deepEqual(clusterAttribution({ verifierVerdict: "supported", verifierCause: null, refutationVerdict: "refuted", refutationUndeterminedCause: null }), none);
  // supported + the refuter was KILLED at its cap ⇒ blocked at the refuter, and NOT determinate.
  assert.deepEqual(
    clusterAttribution({ verifierVerdict: "supported", verifierCause: null, refutationVerdict: "undetermined", refutationUndeterminedCause: "budget-truncated" }),
    { determinate: false, blocking_step: "refuter", blocking_cause: "budget-truncated" },
  );
  // supported + the refuter READ the code and it did not settle the claim ⇒ a statement about the
  // REPOSITORY, so the cluster was judged. Still never confirmed — this function cannot raise `confirmed`.
  assert.deepEqual(
    clusterAttribution({ verifierVerdict: "supported", verifierCause: null, refutationVerdict: "undetermined", refutationUndeterminedCause: "no-counter-evidence" }),
    none,
  );
  // ⛔ FAIL-CLOSED, NOT DEFAULTED. A `supported` verifier with NO refutation verdict at all, and a row
  // with no verdict, are both UNEXPLAINED states: each gets its own `unattributed` reading rather than a
  // plausible-looking step (硬规则 3b).
  assert.deepEqual(
    clusterAttribution({ verifierVerdict: "supported", verifierCause: null, refutationVerdict: null, refutationUndeterminedCause: null }),
    { determinate: false, blocking_step: "refuter", blocking_cause: "unattributed" },
  );
  assert.deepEqual(
    clusterAttribution({ verifierVerdict: null, verifierCause: null, refutationVerdict: "not-run", refutationUndeterminedCause: null }),
    { determinate: false, blocking_step: "verifier", blocking_cause: "unattributed" },
  );
  // The vocabulary is closed — every returned step is a declared member.
  for (const v of ["supported", "refuted", "undetermined", null]) {
    for (const r of ["supported", "refuted", "undetermined", "not-run", null]) {
      const a = clusterAttribution({ verifierVerdict: v, verifierCause: "exit-1", refutationVerdict: r, refutationUndeterminedCause: "call-failed" });
      assert.ok(CLUSTER_BLOCKING_STEPS.includes(a.blocking_step), `${v}/${r} ⇒ a declared step`);
      assert.equal(a.blocking_step === "none", a.blocking_cause === null, `${v}/${r} ⇒ cause is null exactly when the step is`);
    }
  }
});

test("attribution AC3 NEGATIVE CONTROL — count a BUDGET-TRUNCATED refutation as determinate ⇒ the join flips", () => {
  // The mutation is the one the governing constraint forbids: «we could not judge» read as «we judged».
  const mutant = { determinate: true, blocking_step: "none", blocking_cause: null };
  const real = clusterAttribution({ verifierVerdict: "supported", verifierCause: null, refutationVerdict: "undetermined", refutationUndeterminedCause: "budget-truncated" });
  assert.deepEqual(real, { determinate: false, blocking_step: "refuter", blocking_cause: "budget-truncated" });
  assert.notDeepEqual(real, mutant, "the mutant reading is FALSIFIED — the control is live");
  process.stdout.write("    NEGATIVE CONTROL attribution AC3: treating a budget-truncated refutation as determinate would have flipped the join\n");
});

test("attribution AC3 (wiring) — a REAL round's cluster AND its scan-round line carry the join", async () => {
  // The refuter is truncated TWICE (the production shape): the cluster is blocked at the REFUTER, with the
  // budget as its named cause — and the round-level block must agree with the cluster's own block.
  const { ws, opts } = refuterChainFixture({ refuterVerdict: "undetermined", refuterStreams: () => ({ status: 1, stdout: truncatedRefuterStream(7, 6) }) });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  assert.equal(fact.state, "verified");

  const cluster = clusterOf(ws);
  assert.deepEqual(cluster.attribution, { determinate: false, blocking_step: "refuter", blocking_cause: "budget-truncated" });

  const round = rounds(ws)[0];
  assert.ok(round.attribution, "the scan-round line carries the per-round view");
  assert.deepEqual(round.attribution, {
    verified: 1, confirmed: 0, determinate: 0, determinate_rate: 0,
    blocked: { verifier: 0, refuter: 1 }, causes: { "refuter:budget-truncated": 1 },
    healthy: false,
    basis: "0/1 verified clusters judged; 1 lost to a non-naming cause, 0 carrying no attribution block at all",
  }, "the round block is a VIEW of the cluster's own block, not a second derivation");
  assert.equal(round.attribution.healthy, false, "a cluster lost to the mechanism's OWN budget is exactly the unhealthy shape the DoD names");
});

test("attribution AC3 (wiring) — a cluster the VERIFIER could not settle is blocked at the VERIFIER, not the refuter", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const engine = makeEngine({ hyps: [HYPS[0]], verdictFor: (ci, o) => (isRefuterPrompt(o) ? "supported" : "undetermined") });
  engine.modules.hyp.runInvestigator = streamReadingInvestigator();
  const delegate = (argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    if (toolsOf(argv) === INVESTIGATOR_TOOLS) return { status: 0, stdout: streamText(`${FOCUS_MARKER} f\n${JSON.stringify([HYPS[0]])}`), stderr: "", error: null };
    // The verifier dies with NO result event: the engine's own reader names that `exit-1`.
    if (toolsOf(argv) === VERIFIER_TOOLS) return { status: 1, stdout: '{"type":"assistant","message":{"content":[{"type":"text","text":"cut off"}]}}\n', stderr: "" };
    return { status: 0, stdout: streamText(REFUTER_ANSWER("supported")), stderr: "", error: null };
  };
  const fact = await runOpenSemanticDiscovery(ws, {
    ...runOpts(ws, { engine }), spawnFn: countingSpawn(delegate), pinFn: pinStub(),
    pinTmpRoot: tmpDir("osd-attr-verifier-"), retryBackoffMs: 0, sleepFn: async () => {},
  });
  assert.equal(fact.state, "verified");

  const cluster = clusterOf(ws);
  assert.equal(cluster.verifier_verdict, "undetermined");
  assert.equal(cluster.refutation_verdict, "not-run", "the refuter was never called — that is the CONSEQUENCE the old record reported as if it were the cause");
  assert.deepEqual(cluster.attribution, { determinate: false, blocking_step: "verifier", blocking_cause: cluster.verifier_cause });
  assert.equal(cluster.attribution.blocking_step, "verifier", "NOT `refuter` — the step that actually blocked it");
  assert.equal(rounds(ws)[0].attribution.blocked.verifier, 1);
  assert.equal(rounds(ws)[0].attribution.causes[`verifier:${cluster.verifier_cause}`], 1);
});

test("attribution AC4 — the rolling DoD is a RATE, and a window holding NO attribution block rates NOTHING", async () => {
  // A round carrying the block: blocked at the refuter by the mechanism's own budget.
  const { ws, opts } = refuterChainFixture({ refuterVerdict: "undetermined", refuterStreams: () => ({ status: 1, stdout: truncatedRefuterStream(7, 6) }) });
  await runOpenSemanticDiscovery(ws, opts);
  const real = carrierLines(ws);

  const h = residentRoundHealth(real);
  assert.equal(h.rounds, 1);
  assert.equal(h.attributed_rounds, 1);
  assert.equal(h.verified, 1);
  assert.equal(h.determinate, 0);
  assert.equal(h.determinate_rate, 0);
  assert.equal(h.unhealthy_rounds, 1);
  assert.equal(h.healthy, false);

  // ⛔ THE 硬规则 3b CASE THIS READING EXISTS FOR: the same carrier with the attribution block STRIPPED —
  // i.e. exactly what a pre-change round looks like — must rate `null`, NEVER `healthy:true`. «Nothing was
  // read» and «everything was read and was fine» must not share an output.
  const stripped = real.map((l) => (l.kind === "scan-round" ? { ...l, attribution: undefined } : l));
  const h2 = residentRoundHealth(stripped);
  assert.equal(h2.attributed_rounds, 0);
  assert.equal(h2.healthy, null, "an unattributed window has NO verdict — it does not have a good one");
  assert.equal(h2.determinate_rate, null);
  assert.match(h2.basis, /nothing was rated \(NOT «all healthy»\)/);

  // ⛔ RESIDENT ONLY: a MANUAL round is not production. Its (unhealthy) outcome must not enter the rate.
  const manual = real.map((l) => (l.kind === "scan-round" ? { ...l, invoked_by: "manual" } : l));
  const h3 = residentRoundHealth(manual);
  assert.equal(h3.rounds, 0, "a manual round is not a resident round");
  assert.equal(h3.healthy, null);
  assert.match(h3.basis, /no resident-driver round on the carrier — nothing to rate \(NOT «all healthy»\)/);
  assert.equal(RESIDENT_HEALTH_WINDOW_ROUNDS, 5, "the stated window, reported alongside every rate");
});

test("attribution AC2 — the call-failure split reports the retry-then-succeeds rate SEPARATELY from first attempts", async () => {
  // One real round whose refuter is truncated and then answered by its ONE budget retry. The retry is the
  // SAME attempt made again, so it must NOT be double-counted among the first attempts whose failure rate
  // is being read — that is the whole measurement Plan item 2 rests on.
  const { ws, opts } = refuterChainFixture({
    refuterVerdict: "supported",
    refuterStreams: (n) => (n === 0 ? { status: 1, stdout: truncatedRefuterStream(7, 6) } : refuterStream({ numTurns: 19, reads: 6, text: REFUTER_ANSWER("supported") })),
  });
  const fact = await runOpenSemanticDiscovery(ws, opts);
  assert.equal(fact.state, "verified");

  const split = callFailureSplit(carrierLines(ws));
  const refuterRows = split.rows.filter((r) => r.step === "refuter");
  assert.equal(refuterRows.length, 1);
  assert.equal(refuterRows[0].calls, 1, "FIRST attempts only: the retry is not a second first attempt");
  assert.equal(refuterRows[0].failed, 1);
  assert.deepEqual(refuterRows[0].causes, { "not-evaluated:error_max_turns": 1 });
  assert.equal(split.retries.attempts, 1);
  assert.equal(split.retries.answered, 1);
  assert.equal(split.retries.answered_rate, 1, "a BUDGET retry answered — the one class the corpus shows the retry cures");
  assert.deepEqual(split.retries.by_cause["budget-truncated"], { attempts: 1, answered: 1 });
  // Every other step of the same round ran cleanly, so their rates are 0 and their cause maps empty.
  for (const row of split.rows.filter((r) => r.step !== "refuter")) {
    assert.equal(row.failed, 0, `${row.step} answered`);
    assert.deepEqual(row.causes, {});
  }
});

test("attribution — buildDiscoveryReport joins each round to ITS OWN clusters, and marks a pre-change line `derived`", async () => {
  const { ws, opts } = refuterChainFixture({ refuterVerdict: "undetermined", refuterStreams: () => ({ status: 1, stdout: truncatedRefuterStream(7, 6) }) });
  await runOpenSemanticDiscovery(ws, opts);
  const lines = carrierLines(ws);
  const report = buildDiscoveryReport(lines, { window: 5 });

  assert.equal(report.rounds.length, 1);
  assert.equal(report.rounds[0].clusters.length, 1, "the round's OWN cluster line, joined by record_id");
  assert.equal(report.rounds[0].clusters[0].blocking_step, "refuter");
  assert.equal(report.rounds[0].clusters[0].blocking_cause, "budget-truncated");
  assert.equal(report.rounds[0].clusters[0].determinate, false);
  assert.equal(report.rounds[0].clusters[0].provenance, "stored", "the ROUND wrote this block");

  // ⛔ A cluster line written BEFORE this change carries no attribution block. The report still joins it —
  // from the line's OWN verdict fields — but it must say the reading was DERIVED, never present it as the
  // round's own conclusion (硬规则 3b): a derivation is not a measurement of itself.
  const old = lines.map((l) => (l.kind === "cluster" ? { ...l, attribution: undefined } : l));
  const reportOld = buildDiscoveryReport(old, { window: 5 });
  assert.equal(reportOld.rounds[0].clusters[0].blocking_step, "refuter");
  assert.equal(reportOld.rounds[0].clusters[0].blocking_cause, "budget-truncated", "the SAME join, from the fields the old line already carried");
  assert.equal(reportOld.rounds[0].clusters[0].provenance, "derived");
  // ⛔ THE ROUND-LEVEL BLOCK IS THE ROUND'S OWN CLAIM. It is read off the scan-round line and NEVER
  // synthesised from the clusters: an old scan-round line (no block) stays `null`, even though every one
  // of its clusters is still joinable — a derivation must not be back-filled into the round's own claim.
  const oldRound = old.map((l) => (l.kind === "scan-round" ? { ...l, attribution: undefined } : l));
  assert.equal(buildDiscoveryReport(oldRound, { window: 5 }).rounds[0].attribution, null);
  assert.notEqual(reportOld.rounds[0].clusters[0].provenance, "stored", "the cluster join still happened, at its own provenance");
  // A line carrying NO verdict fields at all derives its own «unattributed» rather than a plausible step.
  const empty = lines.map((l) => (l.kind === "cluster" ? { ...l, attribution: undefined, verifier_verdict: null, verifier_cause: null, refutation_verdict: null, refutation_undetermined_cause: null } : l));
  assert.deepEqual(
    buildDiscoveryReport(empty, { window: 5 }).rounds[0].clusters[0],
    { cluster: 1, claim: report.rounds[0].clusters[0].claim, blocking_step: "verifier", blocking_cause: "unattributed", determinate: false, provenance: "derived" },
  );

  // The TEXT surface is the same values, not a second computation.
  const text = renderDiscoveryReport(report);
  assert.match(text, /blocked_by=refuter:budget-truncated/);
  // The round's refuter was truncated TWICE, so its ONE budget retry is on the ledger and ALSO failed:
  // the retry population must show one attempt, zero answered — and it must not be folded into the
  // first-attempt row above.
  assert.match(text, /RETRIES: attempts=1 answered=0 answered_rate=0\.000 \{"budget-truncated":\{"attempts":1,"answered":0\}\}/);
  // ⛔ And the report SPAWNS NOTHING and writes NOTHING: it is a pure read of the carrier.
  assert.equal(fs.readFileSync(carrierPath(ws), "utf8"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "the carrier is untouched byte for byte");

  // CONTROL: the two surfaces agree on the numbers they share.
  const jsonHealth = buildDiscoveryReport(lines, { window: 5 }).health;
  assert.equal(jsonHealth.determinate_rate, report.health.determinate_rate);
  assert.match(text, new RegExp(`healthy=${String(jsonHealth.healthy)}`));
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal
//
// The ANCHOR-HANDOFF CORRELATION, recorded per call so a recurrence is self-diagnosing instead of needing
// a fresh manual capture-file read (Plan item 1). The counterfactual that decided the retry policy is in
// the task's `## Evidence`; what is asserted HERE is the part the ACs make mechanical:
//   ① a round whose anchor start is RECENT is labelled adjacent (the positive control);
//   ② NEGATIVE CONTROL — a round whose anchor start is OLD is NOT (a field that could only ever read
//      `true` is not a measurement, 硬规则 4);
//   ③ NEGATIVE CONTROL — an UNREADABLE anchor start says so, and is NOT shaped like «no handoff nearby»
//      (硬规则 3b: the silent-read-as-steady-state failure is the whole reason this field exists);
//   ④ NEGATIVE CONTROL — a handoff-ADJACENT round with a retryable first failure still makes EXACTLY ONE
//      retry, i.e. the correlation widened NO policy (the decision the measured counterfactual produced).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** Write the anchor's own published read surface into the fixture, in the shape `driver-anchor.writeState`
 *  publishes. ⛔ The fixture writes the CARRIER; the reading under test goes through the production reader
 *  (`readAnchorStart`), so the two cannot agree with each other by construction. */
function writeAnchorState(ws, body) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "anchor.json"), JSON.stringify(body) + "\n", "utf8");
}

// ── the reader itself: three states, none of which is «steady state» ─────────────────────────────────
test("readAnchorStart — a RECENT start reads evaluated, an OLD one reads evaluated, and the three unreadable shapes are NAMED (硬规则 3b)", () => {
  const ws = makeWorkspace();
  const stateFile = path.join(ws, ".quay", "anchor.json");

  // ⛔ NOTHING WRITTEN YET is `missing` — its own value, never «no handoff» (that is a different claim).
  assert.deepEqual(readAnchorStart(ws), { evaluated: false, reason: "missing" });

  writeAnchorState(ws, { pid: 4242, startedAt: "2026-10-13T14:17:09.198Z" });
  const r = readAnchorStart(ws);
  assert.equal(r.evaluated, true);
  assert.equal(r.pid, 4242);
  assert.equal(r.started_at_ms, Date.parse("2026-10-13T14:17:09.198Z"), "the reading is the anchor's OWN published instant");

  // A file that is there but is not JSON — «someone wrote it badly», ⛔ not «it is not there».
  fs.writeFileSync(stateFile, "{not json\n", "utf8");
  assert.deepEqual(readAnchorStart(ws), { evaluated: false, reason: "malformed" });

  // JSON, but no usable `startedAt` (an older surface / a hand-written one) ⇒ its OWN reason.
  fs.writeFileSync(stateFile, JSON.stringify({ pid: 1 }) + "\n", "utf8");
  assert.deepEqual(readAnchorStart(ws), { evaluated: false, reason: "no-started-at" });
  fs.writeFileSync(stateFile, JSON.stringify({ pid: 1, startedAt: "not-a-date" }) + "\n", "utf8");
  assert.deepEqual(readAnchorStart(ws), { evaluated: false, reason: "no-started-at" }, "an unparseable date is not the epoch");
});

test("handoffBlock — an OLD anchor start is NOT adjacent (negative control), a RECENT one is, and a FUTURE one is not adjacent either", () => {
  const T = Date.parse("2026-10-13T14:20:00.000Z");
  const old = handoffBlock({ evaluated: true, started_at_ms: T - 4 * 3600_000, pid: 7 }, T);
  assert.equal(old.adjacent, false, "four hours after the anchor started is steady state");
  assert.equal(old.age_ms, 4 * 3600_000, "…and the RAW age is carried, so a reader can re-derive any window");
  assert.equal(old.anchor_pid, 7);

  const fresh = handoffBlock({ evaluated: true, started_at_ms: T - 23_000, pid: 7 }, T);
  assert.equal(fresh.adjacent, true, "23 seconds after the anchor start is the tail of a handoff");
  assert.equal(fresh.age_ms, 23_000);
  assert.equal(fresh.anchor_started_at, "2026-10-13T14:19:37.000Z");

  // The boundary is INCLUSIVE and the window is ONE constant — the same one the round record names.
  assert.equal(handoffBlock({ evaluated: true, started_at_ms: T - HANDOFF_ADJACENCY_WINDOW_MS, pid: 7 }, T).adjacent, true);
  assert.equal(handoffBlock({ evaluated: true, started_at_ms: T - HANDOFF_ADJACENCY_WINDOW_MS - 1, pid: 7 }, T).adjacent, false);
  assert.equal(handoffBlock({ evaluated: true, started_at_ms: T - 1000, pid: 7 }, T, 0).adjacent, false, "the window is a POLICY argument, not a baked-in number");

  // ⛔ A start in the FUTURE (clock skew / a hand-written surface) is NOT «the anchor just started»: the
  // signed age says so, and folding it to 0 would make it indistinguishable from the claim under test.
  const future = handoffBlock({ evaluated: true, started_at_ms: T + 60_000, pid: 7 }, T);
  assert.equal(future.age_ms, -60_000);
  assert.equal(future.adjacent, false);

  // An unreadable start keeps its REASON — it is never reported as a location in time.
  assert.deepEqual(handoffBlock({ evaluated: false, reason: "missing" }, T), { evaluated: false, reason: "missing" });
});

test("readHostLoad — the load rides the record, and an UNREADABLE loadavg is `ok:false` with its errno, never a 0", () => {
  const dir = tmpDir("osd-loadavg-");
  const file = path.join(dir, "loadavg");
  // The REAL shape of /proc/loadavg: three averages, then runnable/total, then the last pid.
  fs.writeFileSync(file, "2.50 1.00 0.75 3/1234 5678\n", "utf8");
  const r = readHostLoad({ loadavgPath: file, cpuCount: 5 });
  assert.deepEqual(r, { ok: true, load1: 2.5, cpus: 5, load_per_cpu: 0.5 });

  // ⛔ NEGATIVE CONTROL: a loadavg that cannot be read is NOT «the host was idle». A 0 here would read as
  // evidence FOR the handoff hypothesis, which is exactly the confusion this instrument exists to prevent.
  const missing = readHostLoad({ loadavgPath: path.join(dir, "nope"), cpuCount: 5 });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /ENOENT/, "the errno is named");
  assert.notEqual(missing.load1, 0, "…and no load value is invented");

  // A file that exists but carries no parseable first field is its OWN failure, not 0 and not NaN.
  fs.writeFileSync(file, "not-a-number 1 1\n", "utf8");
  assert.deepEqual(readHostLoad({ loadavgPath: file, cpuCount: 5 }), { ok: false, reason: "loadavg-unparseable:not-a-number" });

  // And on THIS host the real reading is a genuine number (the positive control on the same predicate).
  const real = readHostLoad();
  assert.equal(HOST_LOADAVG_PATH, "/proc/loadavg");
  assert.equal(real.ok, true, `the host's own loadavg must be readable (got ${JSON.stringify(real)})`);
  assert.equal(Number.isFinite(real.load1), true);
  assert.equal(real.cpus > 0, true);
});

// ── the round records it: positive, and the two negative controls ────────────────────────────────────
test("(o) AC2 — a round close behind an anchor start records `adjacent:true` on the ROUND and on EVERY call, with the raw age", async () => {
  const { ws, opts } = answerReserveFixture({ delegate: () => ({ status: 0, stdout: STREAM, stderr: "", error: null }) });
  const T = Date.now();
  // 23 seconds behind the anchor's published start — the production shape of the round this task is about.
  writeAnchorState(ws, { pid: 675243, startedAt: new Date(T - 23_000).toISOString() });
  const fact = await runOpenSemanticDiscovery(ws, { ...opts, now: () => T });

  assert.equal(fact.state, "verified", `the round still runs normally (got ${fact.state}: ${fact.reason})`);
  const round = rounds(ws)[0];
  assert.equal(round.handoff.evaluated, true);
  assert.equal(round.handoff.adjacent, true, "the ROUND line says it ran in the tail of a handoff");
  assert.equal(round.handoff.anchor_pid, 675243, "…and names WHICH anchor, so the claim is checkable");
  assert.equal(round.handoff.age_ms, 23_000);
  assert.equal(round.handoff.anchor_started_at, new Date(T - 23_000).toISOString());

  assert.equal(round.calls.length > 0, true, "the round made real calls");
  for (const c of round.calls) {
    assert.equal(c.handoff.evaluated, true, "every call carries the same reading");
    assert.equal(c.handoff.adjacent, true);
    // ⛔ The per-CALL instant, not the round's: a call that starts later is farther from the handoff, and
    // the record must say by how much rather than repeat the round's own age.
    assert.equal(c.handoff.age_ms >= 23_000, true, `call age ${c.handoff.age_ms} is measured at ITS OWN start`);
    assert.equal(c.host_load.ok, true, `the load reading rides the call (got ${JSON.stringify(c.host_load)})`);
    assert.equal(Number.isFinite(c.host_load.load1), true);
  }
});

test("(o) AC2 NEGATIVE CONTROL — an OLD anchor start does NOT trigger the new behaviour, and the correlation is what differs (not the round)", async () => {
  const delegate = () => ({ status: 0, stdout: STREAM, stderr: "", error: null });
  const T = Date.now();

  // ⛔ THE IDENTICAL ROUND, differing ONLY in when the anchor started. That is the control: if the flag
  // were a constant (or keyed on anything else about the round) the two would read the same.
  const freshFx = answerReserveFixture({ delegate });
  writeAnchorState(freshFx.ws, { pid: 11, startedAt: new Date(T - 60_000).toISOString() });
  await runOpenSemanticDiscovery(freshFx.ws, { ...freshFx.opts, now: () => T });
  const staleFx = answerReserveFixture({ delegate });
  writeAnchorState(staleFx.ws, { pid: 11, startedAt: new Date(T - 6 * 3600_000).toISOString() });
  await runOpenSemanticDiscovery(staleFx.ws, { ...staleFx.opts, now: () => T });

  const fresh = rounds(freshFx.ws)[0];
  const stale = rounds(staleFx.ws)[0];
  assert.equal(fresh.handoff.adjacent, true, "one minute behind an anchor start is inside the window");
  assert.equal(stale.handoff.adjacent, false, "six hours behind is NOT — the flag takes BOTH values");
  assert.equal(stale.handoff.evaluated, true, "…and it is a REAL reading, not an unreadable one");
  assert.equal(stale.handoff.age_ms, 6 * 3600_000);
  assert.equal(stale.calls.every((c) => c.handoff.adjacent === false), true, "no call is labelled adjacent");
  assert.equal(fresh.calls.every((c) => c.handoff.adjacent === true), true);
  // Both rounds did the same work — the flag did not change what ran.
  assert.equal(stale.calls.length, fresh.calls.length, "the correlation describes the round, it does not steer it");
});

test("(o) AC2 NEGATIVE CONTROL — NO readable anchor start is `evaluated:false` with its reason, ⛔ never `adjacent:false`", async () => {
  const { ws, opts } = answerReserveFixture({ delegate: () => ({ status: 0, stdout: STREAM, stderr: "", error: null }) });
  // The workspace has NO `.quay/anchor.json` at all: a routine driven outside an anchor, or an anchor that
  // has not published yet. «Could not read» must not be shaped like «read, and no handoff nearby».
  const fact = await runOpenSemanticDiscovery(ws, opts);
  assert.equal(fact.state, "verified");
  const round = rounds(ws)[0];
  assert.deepEqual(round.handoff, { evaluated: false, reason: "missing" });
  assert.equal("adjacent" in round.handoff, false, "an unreadable reading carries NO adjacency claim at all");
  for (const c of round.calls) assert.deepEqual(c.handoff, { evaluated: false, reason: "missing" });

  // A malformed surface is its OWN reason — still not «no handoff».
  const fx2 = answerReserveFixture({ delegate: () => ({ status: 0, stdout: STREAM, stderr: "", error: null }) });
  fs.writeFileSync(path.join(fx2.ws, ".quay", "anchor.json"), "{torn\n", "utf8");
  await runOpenSemanticDiscovery(fx2.ws, fx2.opts);
  assert.deepEqual(rounds(fx2.ws)[0].handoff, { evaluated: false, reason: "malformed" });
});

test("(o) AC2 NEGATIVE CONTROL — a handoff-ADJACENT round with a retryable failure still makes EXACTLY ONE retry (no policy was widened)", async () => {
  const good = streamText(`${FOCUS_MARKER} fixture focus\n${JSON.stringify(HYPS)}`);
  let n = 0;
  const delegate = (argv, opts) => {
    if (isNoveltyPrompt(opts)) return { status: 0, stdout: NOVELTY_STREAM, stderr: "", error: null };
    n++;
    // The production shape: the FIRST non-novelty call's stream is cut off with no `result` event at all.
    return n === 1
      ? { status: 0, stdout: "", stderr: "gateway returned an empty body\n", error: null }
      : { status: 0, stdout: good, stderr: "", error: null };
  };
  const { ws, opts } = answerReserveFixture({ delegate });
  const T = Date.now();
  writeAnchorState(ws, { pid: 99, startedAt: new Date(T - 5_000).toISOString() });
  await runOpenSemanticDiscovery(ws, { ...opts, now: () => T });

  const round = rounds(ws)[0];
  assert.equal(round.handoff.adjacent, true, "the round IS handoff-adjacent — so this control is not vacuous");
  const inv = round.calls.filter((c) => c.step === "investigator");
  assert.equal(inv.length, 2, "the lost call and ONE retry — ⛔ not two, which is what a naive «escalate on the correlation» would have produced");
  assert.equal(inv[1].retry_cause, "no-stdout");
  assert.equal(inv.filter((c) => c.retry_of !== undefined).length, 1, "exactly ONE record is a retry");
  // The retryable set itself is untouched: this task added a DIAGNOSIS, not a class.
  assert.deepEqual([...RETRYABLE_CALL_FAILURES], ["no-stdout", "stream-without-result", "api-error-event"]);
});

// ── THE STABLE IDENTITY ACROSS ROUNDS (Plan item 1) ──────────────────────────────────────────────────
//
// ⛔ MEASURED 2026-10-14: the 212 cluster records on this repo's own carrier carried 212 distinct
//    `record_id`s (identity was PER ROUND), so the same concept rediscovered next round was a NEW finding.
//    `record_id` stays the per-round OCCURRENCE id; the concept key is the stable identity, and the carrier
//    is its own fold — every earlier cluster record already carries the subject the key is derived from.
test("AC(stable identity) — one concept in TWO rounds gets ONE key, with the occurrences LINKED", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  const first = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine({ hyps: [HYPS[0]] }) }), spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(first.state, "verified", String(first.reason ?? ""));
  const later = Date.now() + 600_000;
  // ⛔ A DIFFERENT CLAIM about the SAME subject: if the claim were byte-identical the round's own
  // MECHANICAL exception would dedup it, and the linkage under test would be that exception's doing
  // rather than the concept key's.
  const restated = [{ ...HYPS[0], claim: `${HYPS[0].claim} — restated in the second round` }];
  const second = await runOpenSemanticDiscovery(ws, { ...runOpts(ws, { engine: makeEngine({ hyps: restated }) }), force: true, now: () => later, spawnFn: countingSpawn(), pinFn: pinStub() });
  assert.equal(second.state, "verified", String(second.reason ?? ""));

  const clusters = carrierLines(ws).filter((l) => l.kind === "cluster" && l.shadow !== true);
  assert.equal(clusters.length, 2, "two rounds, two cluster records");
  const [a, b] = clusters;
  assert.equal(typeof a.concept_key, "string", "the first occurrence carries a stable identity");
  assert.equal(b.concept_key, a.concept_key, "the SAME concept in the next round gets the SAME key");
  assert.equal(a.concept_occurrences, 1);
  assert.equal(b.concept_occurrences, 2, "…and the second occurrence KNOWS it is the second");
  assert.deepEqual(b.concept_linked_record_ids, [a.record_id], "…naming the earlier occurrence it is linked to");
  assert.notEqual(a.record_id, b.record_id, "…while the per-round OCCURRENCE ids stay what they were");
  // The identity reaches the OTHER two carriers, so a reader can group by concept rather than by round.
  const rows = portfolioRecords(ws);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].concept_key, a.concept_key);
  assert.equal(rows[1].concept_key, a.concept_key);
  for (const e of experienceRecords(ws)) assert.equal(e.concept_key, a.concept_key, "the Experience carries it too");
  process.stdout.write(`    AC2 reading: round1 ${a.record_id} concept_key=${a.concept_key} occurrences=${a.concept_occurrences}; round2 ${b.record_id} concept_key=${b.concept_key} occurrences=${b.concept_occurrences} linked=${JSON.stringify(b.concept_linked_record_ids)}\n`);
});

// ── REAL SOURCE EVIDENCE (Plan item 2) ───────────────────────────────────────────────────────────────
//
// ⛔ MEASURED 2026-10-14: 0 of 212 cluster records carried any evidence field, and the one evidence-shaped
//    field that DID exist (`evidence_lines`) is the MODEL'S OWN PROSE. A citation must come from what the
//    call's tools actually READ, and must be re-checked against the pin before it is persisted.
const TOOL_USE = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const TOOL_RESULT = (id, text) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } });
/** A REAL call capture: the numbered lines `Read` hands back for `plugin/scripts/a.ts` (line 1 really says
 *  `export const a = 1;` in the pin), plus a FABRICATED pair naming a line the file does not have. */
const CITATION_RESULT_TEXT = `${FOCUS_MARKER} fixture focus on the carrier helpers\n[]`;
const citationStream = () => [
  JSON.stringify({ type: "system", subtype: "init", model: FIXTURE_MODEL }),
  JSON.stringify(TOOL_USE("t1", "Read", { file_path: "plugin/scripts/a.ts" })),
  JSON.stringify(TOOL_RESULT("t1", "     1→export const a = 1;\n     2→export const b = 2;\n")),
  JSON.stringify(TOOL_USE("t2", "Read", { file_path: "plugin/scripts/a.ts" })),
  JSON.stringify(TOOL_RESULT("t2", "    99→this line is not in the file at the pin\n")),
  JSON.stringify({
    type: "result", subtype: "success", num_turns: 4, is_error: false, result: CITATION_RESULT_TEXT,
    usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.02,
  }),
].join("\n") + "\n";
const citationDelegate = (_argv, opts) => ({
  status: 0, stdout: isNoveltyPrompt(opts) ? NOVELTY_STREAM : citationStream(), stderr: "", error: null,
});

test("AC(citations) — a cluster's citations are what its OWN calls READ, re-checked at the pin; a fabricated one is DROPPED and counted", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, cfgYaml());
  // ⛔ The cited file is COMMITTED on develop, and the round's pin is a REAL checkout of that commit — so
  // `file:line@commit` is a claim `git show <commit>:<file>` can settle. A fixture pin that the commit did
  // not contain would make the recorded commit decorative, which is the shape this AC exists to refuse.
  fs.mkdirSync(path.join(ws, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(ws, "plugin", "scripts", "a.ts"), "export const a = 1;\nexport const b = 2;\n", "utf8");
  // ⛔ `env: GIT_ENV` on the COMMIT is LOAD-BEARING, not decoration: `ws` is a freshly `git init`-ed fixture
  // repo (no repo-level `user.name`), so on a host with no GLOBAL git config git refuses with
  // `Author identity unknown` and this case dies before the round even runs. Measured on CI run 38700638546
  // and reproduced here under `HOME=<empty tmp> GIT_CONFIG_GLOBAL=/dev/null`.
  // The identity goes in the CHILD ENV — ⛔ never into the fixture repo's own config (`git config user.name`
  // inside `ws` would make the case pass for a reason the runner does not have: a fixture agreeing with
  // itself). GIT_ENV sets the four `GIT_{AUTHOR,COMMITTER}_{NAME,EMAIL}` vars AFTER spreading `process.env`,
  // so it also beats the «present but EMPTY» trap (git treats an empty ident var as a value, not as unset).
  // Same defect family as task gap-commit-routine-write-no-git-identity-fallback, which fixed the PRODUCTION
  // commit path. The other three `execFileSync` sites below are READS (add/rev-parse/show) that never needed
  // an identity; they carry it only so this file has no bare-git idiom left to copy — after this change all
  // 15 git call sites here (11 `spawnSync` + 4 `execFileSync`) pass `GIT_ENV` (硬规则 5b: the cluster, not
  // just the reported instance).
  execFileSync("git", ["-C", ws, "add", "-A"], { encoding: "utf8", env: GIT_ENV });
  execFileSync("git", ["-C", ws, "commit", "-q", "-m", "pin content: the file the round will cite"], { encoding: "utf8", env: GIT_ENV });
  const pinFn = (o) => materializeStrippedPin({ ...o, forbiddenDirs: realHyp.PIN_FORBIDDEN_DIRS, stripCheck: (d) => realHyp.verifyCwdRefusal(d, d) });
  const spawn = countingSpawn(citationDelegate);
  const fact = await runOpenSemanticDiscovery(ws, { ...runOpts(ws), spawnFn: spawn, pinFn });
  assert.equal(fact.state, "verified", String(fact.reason ?? ""));
  const rev = execFileSync("git", ["-C", ws, "rev-parse", "develop"], { encoding: "utf8", env: GIT_ENV }).trim();

  const clusters = carrierLines(ws).filter((l) => l.kind === "cluster" && l.shadow !== true);
  assert.ok(clusters.length >= 1, "the round wrote cluster records");
  for (const c of clusters) {
    assert.ok(Array.isArray(c.citations) && c.citations.length >= 1, `the cluster carries a REAL citation (got ${JSON.stringify(c.citations)})`);
    const cite = c.citations[0];
    assert.equal(cite.file, "plugin/scripts/a.ts");
    assert.equal(cite.line, 1);
    assert.equal(cite.quote, "export const a = 1;", "the quote is the LINE's own text, taken from the tool result");
    assert.equal(cite.commit, rev, "…pinned to the commit the round read");
    // THE MECHANICAL CHECK, run INDEPENDENTLY of the round: `git show <commit>:<file>`, line N, really
    // carries the quoted text. This is the check the AC names; nothing here reads the round's own state.
    const atCommit = execFileSync("git", ["-C", ws, "show", `${cite.commit}:${cite.file}`], { encoding: "utf8", env: GIT_ENV }).split("\n")[cite.line - 1];
    assert.ok(atCommit.includes(cite.quote), `the cited line really carries the quote AT THE RECORDED COMMIT (got ${JSON.stringify(atCommit)})`);
    // …and the FABRICATED pair (line 99, which the pin does not have) is dropped and COUNTED, never repaired.
    assert.equal(c.citations.some((x) => x.line === 99), false, "the fabricated citation was NOT persisted");
    assert.ok(c.evidence_unverifiable >= 1, `…and it was counted (got ${c.evidence_unverifiable})`);
    process.stdout.write(`    AC3 reading: ${c.record_id} citations=${JSON.stringify(c.citations)} evidence_unverifiable=${c.evidence_unverifiable} evidence_lines(model prose, NOT citations)=${JSON.stringify(c.evidence_lines)}\n`);
    process.stdout.write(`    AC3 mechanical check: git show ${cite.commit}:${cite.file} | line ${cite.line} = ${JSON.stringify(atCommit)}\n`);
    // ⛔ The model's own prose claim is kept SEPARATELY and is NOT the citation list.
    assert.notDeepEqual(c.evidence_lines, c.citations);
  }
});

test("citationsFromCallStream — only a Read RESULT yields a citation; an unpaired or non-Read call yields none", () => {
  const withTool = (events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  // An unpaired tool_use (no result) is NOT a reading — nothing was returned to quote.
  assert.deepEqual(citationsFromCallStream(withTool([TOOL_USE("x", "Read", { file_path: "a.ts" })]).trim()), []);
  // A Grep result is deliberately NOT mined: its output is a match line, not a numbered line, and a second
  // citation parse for it would be a second vocabulary (硬规则 5b).
  const grep = withTool([TOOL_USE("g", "Grep", { pattern: "x", path: "a.ts" }), TOOL_RESULT("g", "a.ts:1:export const a = 1;\n")]);
  assert.deepEqual(citationsFromCallStream(grep), []);
  // A blank line is not a citation: every file produces them, and they would pad the count with nothing.
  const blank = withTool([TOOL_USE("b", "Read", { file_path: "a.ts" }), TOOL_RESULT("b", "     1→\n")]);
  assert.deepEqual(citationsFromCallStream(blank), []);
  // The positive control: a real capture DOES yield the position and the text.
  const real = withTool([TOOL_USE("r", "Read", { file_path: "a.ts" }), TOOL_RESULT("r", "     7→const x = 1;\n")]);
  assert.deepEqual(citationsFromCallStream(real), [{ file: "a.ts", line: 7, quote: "const x = 1;" }]);
});

test("verifyCitation — every failure is its OWN code, and a path escaping the pin is refused outright", () => {
  const dir = tmpDir("osd-cite-");
  fs.mkdirSync(path.join(dir, "plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "a.ts"), "alpha\nbeta\n", "utf8");
  assert.equal(verifyCitation(dir, { file: "plugin/a.ts", line: 2, quote: "beta" }).ok, true);
  assert.equal(verifyCitation(dir, { file: "plugin/a.ts", line: 9, quote: "beta" }).reason.startsWith("CITATION_LINE_ABSENT:"), true);
  assert.equal(verifyCitation(dir, { file: "plugin/a.ts", line: 1, quote: "gamma" }).reason.startsWith("CITATION_TEXT_NOT_AT_LINE:"), true);
  assert.equal(verifyCitation(dir, { file: "plugin/absent.ts", line: 1, quote: "x" }).reason.startsWith("CITATION_FILE_ABSENT:"), true);
  assert.equal(verifyCitation(dir, { file: "../outside.ts", line: 1, quote: "x" }).reason.startsWith("CITATION_PATH_UNSAFE:"), true);
  assert.equal(verifyCitation(dir, { file: "/etc/passwd", line: 1, quote: "x" }).reason.startsWith("CITATION_PATH_UNSAFE:"), true);
  // The aggregation: verified ones survive, failures are COUNTED, and the carry bound is NOT a failure.
  const agg = verifyCitations(dir, "deadbeef", [
    { file: "plugin/a.ts", line: 1, quote: "alpha" },
    { file: "plugin/a.ts", line: 1, quote: "alpha" },   // the same citation twice is ONE citation
    { file: "plugin/a.ts", line: 3, quote: "nope" },
  ]);
  assert.equal(agg.citations.length, 1);
  assert.equal(agg.citations[0].commit, "deadbeef");
  assert.equal(agg.unverifiable, 1);
  assert.equal(agg.truncated, 0);
});
