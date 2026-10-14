// @test-group engine
// discovery-method-routine.test.mjs — the contract for plugin/scripts/discovery-method-routine.ts, the
// MINIMAL REPORT-ONLY routine that wires the Discovery Method loop into the quality-gate driver's
// routine track (task gap-discovery-method-routine-report-only).
//
// Coverage map (task AC1):
//   (1) section absent              ⇒ not-evaluated:disabled, zero spawns
//   (2) enabled:false               ⇒ same
//   (3) halted                      ⇒ not-evaluated:halted, zero spawns
//   (4) malformed / interval < 360m ⇒ failed, zero spawns
//   (5) a budget breach             ⇒ failed, carrier byte-identical, last-run NOT advanced
//   (6) an ingest refusal           ⇒ failed with the step's OWN reason code (WATERMARK_MISMATCH)
//   (7) two rounds, identical inputs⇒ round 2 ingests 0 and makes 0 model calls
//   (8) after a full round          ⇒ nothing under tasks/ or goals/ changed, AND the routine source
//                                     carries none of the authoring symbols (static control + the
//                                     mutation that turns the SAME predicate red)
//
// Coverage map (task gap-discovery-method-routine-manual-run-advances-production-last-run) — WHO invoked
// the round, and therefore whether the PRODUCTION window may be advanced:
//   (a) a manual round              ⇒ `.quay/routine-last-run.json` stays BYTE-IDENTICAL
//   (b) a resident-driver round     ⇒ advances ONLY the `discovery-method` key; the other keys untouched
//   (c) manual then resident, same window ⇒ the resident round is STILL DUE (it reads the last PRODUCTION
//                                     time, not the manual one)
//   (d) the carrier line's `invoked_by` ⇒ "manual" vs "resident-driver", on the record itself
//   (e) a manual round in-window is a no-op; `--force` runs one and STILL does not advance last-run
//   (f) the `--once` CLI is manual by construction (the acceptance-run path that caused the defect)
//
// Coverage map (task gap-discovery-method-routine-interval-60m-temporary) — the TEMPORARY faster cadence
// and the due basis it needs:
//   (a) `interval:60m` + a future `interval_until` ⇒ accepted, due after 60m
//   (b) `interval:60m` WITHOUT `interval_until`     ⇒ config error, zero spawns
//       (+ `max_model_calls_per_24h` required on the same arm)
//   (c) after `interval_until` passes               ⇒ 360m applies and the Fact says so
//   (d) a legacy UNSTAMPED last-run entry is ignored for due-computation; a resident-stamped one is honoured
//   (e) a manual round between two resident rounds does not shift the resident due time
//   (f) `max_model_calls_per_24h` reached           ⇒ not-evaluated:budget-24h, zero spawns
//   (g) `arch-discovery` and other routine intervals are unaffected (fixture with both routines)
//
// Run: scripts/test.sh plugin/test/discovery-method-routine.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DISCOVERY_METHOD_NAME,
  CARRIER_REL,
  MIN_INTERVAL_MINUTES,
  DEFAULT_INTERVAL_MINUTES,
  BUDGET_24H_MS,
  invokedByStampKey,
  latestResidentRoundTs,
  modelCallsInWindow,
  LEDGER_MODULE_FILE,
  SCRIPT_REPO_ROOT,
  INVOKED_BY_RESIDENT,
  INVOKED_BY_MANUAL,
  parseDiscoveryMethodSection,
  readDiscoveryMethodConfig,
  readCarrierRounds,
  readHeldOutCases,
  resolveEngineModule,
  loadDiscoveryModules,
  runDiscoveryMethod,
  buildDiscoveryMethodRoutine,
  discoveryMethodRoutineFromConfig,
  // ── the 24h reservation ledger (task gap-discovery-method-24h-budget-hard-reservation) ──
  BUDGET_LEDGER_REL,
  BUDGET_LOCK_REL,
  BUDGET_REFUSAL_CODE,
  // ⛔ The token the round's own Fact carries when its `ingested 0` means «nothing has ever written this
  // store» — imported from the module that mints it, never re-spelled here (硬规则 5b).
  EVIDENCE_STORE_NO_PRODUCER,
  BUDGET_LOCK_STALE_MS,
  REFLECTION_TOOLS,
  REFLECTION_MAX_TURNS,
  DEFAULT_REFLECTION_TOOLS,
  DEFAULT_REFLECTION_MAX_TURNS,
  VERIFIER_TOOLS,
  DEFAULT_VERIFIER_MAX_TURNS,
  inTrailing24hWindow,
  ledgerReservationsInWindow,
  budgetUsage,
  readLedgerRecords,
  appendLedgerRecords,
  acquireBudgetLock,
  pidAlive,
  openModelBudget,
  reservingModel,
  seamParamsFor,
} from "../scripts/discovery-method-routine.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "../scripts/probe-routine.ts";
// (g) 的正本对照：另一条例程**自己的** floor / 默认值，⛔ 不是从 discovery-method 借来的常量。
import {
  MIN_INTERVAL_MINUTES as ARCH_MIN_INTERVAL_MINUTES,
  parseArchDiscoverySection,
  readArchDiscoveryConfig,
} from "../scripts/arch-discovery-routine.ts";
import { appendOutcomeRecord } from "../../docs/analysis/architecture-evidence-store.mjs";
// ⛔ Imported (not re-implemented) for the two argv assertions: the pin-carrier (`reflectionLaunchArgv`)
// and the prompt it belongs with live in the reflection module, and the BASELINE argv the fallback arm is
// compared against is built by the PRE-CHANGE helper itself (`hardenedArgv`) — a hand-written literal
// could drift with the thing it is supposed to pin.
import { reflectionLaunchArgv, buildReflectionPrompt } from "../../docs/analysis/discovery-reflection.mjs";
import { hardenedArgv } from "../../docs/analysis/arch-hypothesis-generation.mjs";
// The driver's own assembly line (the string the reload prints) — asserted from ITS function rather than
// a copy, so "what the driver reports" is the thing under test.
import { formatDiscoveryMethodAssembly } from "../scripts/quality-gate-driver.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const ROUTINE_SRC = path.join(REPO_ROOT, "plugin", "scripts", "discovery-method-routine.ts");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
// Every temp dir goes through tmpDir() and is removed by the module-level after() hook (the
// carrier-array pattern required by tmp-leak-pairing-check / test-isolation-check R6).
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

/** A temp workspace: `.quay/` + empty `tasks/`/`goals/`, git-initialised — the Discovery carriers
 *  resolve through `git rev-parse --git-common-dir`, so a bare directory is not a usable fixture root
 *  (an unresolvable shared checkout is REFUSED by the ledger's own resolver). */
function makeWorkspace() {
  const ws = tmpDir("dm-routine-ws-");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  spawnSync("git", ["-C", ws, "init", "-q"], { encoding: "utf8", env: GIT_ENV });
  return ws;
}

function writeConfig(ws, body) {
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), body, "utf8");
}

const ENABLED_YAML = `loop:\n  discovery_method:\n    enabled: true\n    interval: interval:360m\n    max_experiences: 8\n    max_model_calls: 6\n    max_wall_ms: 900000\n`;

/** A FIXTURE evidence store: outcome records written through the REAL evidence-store writer, so the
 *  ingester reads records it could meet in production rather than a hand-shaped stand-in. */
function writeFixtureStore(root, recs) {
  const out = recs.map((r) => appendOutcomeRecord(root, { ts: "2026-10-12T00:00:00Z", experiment: "E-FIX", ...r }));
  for (const o of out) assert.equal(o.ok, true, `fixture outcome refused: ${o.reasons?.join(",")}`);
}

/** Two ingestible outcomes (a `supported` and a `refuted` one) — a real, non-empty batch. */
const FIXTURE_OUTCOMES = [
  { experiment_ref: "E-FIX cluster 1", verdict: "supported", subject_key: "concern|plugin/scripts/alpha.ts,plugin/scripts/beta.ts" },
  { experiment_ref: "E-FIX cluster 2", verdict: "refuted", subject_key: "concern|plugin/scripts/gamma.ts" },
];

/** A reflection-round stub that COUNTS its calls (the seam the round is measured through). */
function reflectStub({ decisions = [{ signature: "sig-1", ok: true, decision: "no-method", candidate: null, model_call: { usage: null, cost_usd: null } }] } = {}) {
  const calls = [];
  const fn = async (root, opts) => {
    calls.push(opts);
    const modelCalls = decisions.filter((d) => d.model_call).length;
    return {
      ok: true,
      decisions,
      model_calls: modelCalls,
      skipped_budget: 0,
      wall_ms: 1,
      selection: { units_evaluated: decisions.length, batch_size: decisions.length, skipped_prior: 0, skipped_cap: 0, merged_within_batch: 0 },
    };
  };
  fn.calls = calls;
  return fn;
}

/** A counting no-op used wherever "ZERO spawns" is the claim. */
function countingIngest(result = { ok: true, ingested: 0, scanned: 0, duplicates: 0, advanced_to: 0 }) {
  const calls = [];
  const fn = (root, opts) => { calls.push(opts); return result; };
  fn.calls = calls;
  return fn;
}

/** Build the run options from a workspace's real config read.
 *  ⛔ `invokedBy` defaults to `resident-driver` HERE (the cases above were written before the manual /
 *  resident split and assert facts only a RESIDENT round can produce — last-run advancing, and NOT
 *  advancing on a failure). A case that is about the manual path says `invokedBy: "manual"` explicitly,
 *  so neither kind is ever tested by accident. */
function runOpts(ws, extra = {}) {
  const read = extra.configRead ?? readDiscoveryMethodConfig(ws);
  return {
    config: read.config,
    configPresent: read.present,
    configError: read.error,
    halted: false,
    invokedBy: INVOKED_BY_RESIDENT,
    ...extra,
  };
}

const carrierPath = (ws) => path.join(ws, CARRIER_REL);
const lastRunPath = (ws) => path.join(ws, ROUTINE_LAST_RUN_REL);
const carrierLines = (ws) => {
  const raw = fs.existsSync(carrierPath(ws)) ? fs.readFileSync(carrierPath(ws), "utf8") : "";
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const rounds = (ws) => carrierLines(ws).filter((l) => l.kind === "scan-round");

// ── (1)/(2)/(4) config: parse + the disabled/malformed gates (pure + through the round) ─────────────
test("case (1)/(2)/(4) — parseDiscoveryMethodSection: disabled section, malformed section, interval floor", () => {
  assert.equal(parseDiscoveryMethodSection({ enabled: false }).config.enabled, false, "enabled:false ⇒ a disabled config");
  assert.equal(parseDiscoveryMethodSection({ enabled: false }).error, null, "a disabled section is valid (the kill switch)");
  assert.match(parseDiscoveryMethodSection({}).error, /needs a boolean 'enabled'/, "a present section with no 'enabled' is malformed");
  assert.match(parseDiscoveryMethodSection({ enabled: "yes" }).error, /needs a boolean 'enabled'/, "a non-boolean 'enabled' is malformed");
  assert.match(parseDiscoveryMethodSection({ enabled: true }).error, /needs an 'interval' string/, "enabled ⇒ interval is required");
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "every(5)" }).error, /must be interval:<N>m/, "a non-interval trigger is refused");
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "interval:5m" }).error, new RegExp(`below the ${MIN_INTERVAL_MINUTES}m floor`), "an interval under the floor is refused");
  const ok = parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m" });
  assert.equal(ok.error, null);
  assert.equal(ok.config.trigger.minutes, DEFAULT_INTERVAL_MINUTES, "the permanent default is accepted as-is");
  assert.equal(MIN_INTERVAL_MINUTES, 60, "THIS routine's floor is 60m — a cadence the other routines' floors do not govern");
  assert.equal(DEFAULT_INTERVAL_MINUTES, 360, "…and the PERMANENT default stays 360m: the floor moved, not the default");
  assert.equal(ok.config.maxExperiences, 8, "absent bounds take their documented default");
  // ⛔ `0` is a legitimate bound for the two quotas (a purely mechanical round / ingest nothing), and
  // the refusal is on integrality + non-negativity — not on a made-up positive floor.
  assert.equal(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", max_model_calls: 0 }).config.maxModelCalls, 0);
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", max_model_calls: -1 }).error, /must be an integer >= 0/);
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", max_wall_ms: 0 }).error, /must be an integer >= 1/);
});

test("case (1) — section absent ⇒ not-evaluated:disabled and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  board: native\n");
  const ingest = countingIngest();
  const reflect = reflectStub();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest, reflectFn: reflect }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /disabled/);
  assert.equal(fact.value.enabled, false);
  assert.equal(ingest.calls.length, 0, "ZERO ingest");
  assert.equal(reflect.calls.length, 0, "ZERO reflection (hence zero model calls)");
  assert.equal(fs.existsSync(carrierPath(ws)), false, "nothing written to the carrier");
});

test("case (2) — enabled:false ⇒ not-evaluated:disabled and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  discovery_method:\n    enabled: false\n");
  const ingest = countingIngest();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /disabled/);
  assert.equal(ingest.calls.length, 0, "ZERO spawns");
});

test("case (4) — malformed section / interval < 360m ⇒ failed and ZERO spawns", async () => {
  for (const yaml of [
    "loop:\n  discovery_method:\n    enabled: yes-please\n",
    `loop:\n  discovery_method:\n    enabled: true\n    interval: interval:${MIN_INTERVAL_MINUTES - 1}m\n`,
  ]) {
    const ws = makeWorkspace();
    writeConfig(ws, yaml);
    const ingest = countingIngest();
    const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest }));
    assert.equal(fact.state, "failed", `expected failed for config: ${JSON.stringify(yaml)}`);
    assert.equal(ingest.calls.length, 0, "ZERO spawns on a bad config");
    assert.equal(fs.existsSync(carrierPath(ws)), false, "a failed round writes nothing");
  }
});

// ── (3) halt ────────────────────────────────────────────────────────────────────────────────────────
test("case (3) — halted ⇒ not-evaluated:halted and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const ingest = countingIngest();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest, halted: true }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /halted/);
  assert.equal(ingest.calls.length, 0, "ZERO spawns");
});

// ── the durable due gate ────────────────────────────────────────────────────────────────────────────
test("the durable due gate — not due inside the interval ⇒ ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeProductionLastRun(ws, Date.now()); // resident-stamped "just ran"
  const ingest = countingIngest();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not due/);
  assert.equal(fact.value.due.source, "last-run-stamped", "the Fact enumerates WHICH reading produced the window");
  assert.equal(ingest.calls.length, 0, "ZERO spawns");
});

// ── WHO INVOKED THE ROUND: manual vs resident-driver (AC1 (a)-(d)) ───────────────────────────────────
// The defect these cases pin: a `--once` acceptance run against the PRODUCTION root wrote
// `.quay/routine-last-run.json`, so the resident driver reported «ran 36m ago» and skipped its round.
// Invariant under test: the durable due gate's READ is shared by both kinds of round, its ADVANCE is the
// resident round's alone.
//
// The fixture map for (a)/(b) is written with the SAME serializer `writeLastRun` uses (JSON.stringify
// with a 1-space indent), so a formatting-only rewrite is a diff too — "byte-identical" below is meant
// literally, not "semantically equal".
const OTHER_ROUTINE_KEYS = { "self-validation": 1786552318938, "arch-discovery": 1791778563897 };
/** A production map whose `discovery-method` entry is a day old (⇒ the round IS due) plus two other
 *  routines' entries that must survive every write untouched.
 *  ⛔ The entry is written WITH the resident stamp, because that is now what "production last ran" means:
 *  an unstamped entry grants no window at all (see the (d) cases and the round's due basis). */
function writeProductionLastRun(ws, discoveryMethodTs) {
  fs.writeFileSync(
    lastRunPath(ws),
    JSON.stringify({ [DISCOVERY_METHOD_NAME]: discoveryMethodTs, [invokedByStampKey(DISCOVERY_METHOD_NAME)]: INVOKED_BY_RESIDENT, ...OTHER_ROUTINE_KEYS }, null, 1),
    "utf8",
  );
}
/** The declared-temporary YAML: 60m plus the expiry and the 24h ceiling the parse REQUIRES with it. */
const temporaryYaml = (untilIso, cap = 24) =>
  `loop:\n  discovery_method:\n    enabled: true\n    interval: interval:60m\n    interval_until: ${untilIso}\n    max_model_calls_per_24h: ${cap}\n    max_experiences: 8\n    max_model_calls: 6\n    max_wall_ms: 900000\n`;

/** A carrier `scan-round` line as the routine itself writes one — used to seed PRODUCTION history. */
function scanRoundLine({ ts, invokedBy, modelCalls = 0 }) {
  return { kind: "scan-round", routine: DISCOVERY_METHOD_NAME, ...(invokedBy ? { invoked_by: invokedBy } : {}), ts, model_calls: modelCalls };
}
function writeCarrier(ws, lines) {
  fs.mkdirSync(path.dirname(carrierPath(ws)), { recursive: true });
  fs.writeFileSync(carrierPath(ws), lines.map((l) => JSON.stringify(l) + "\n").join(""), "utf8");
}
const OLD_PRODUCTION_TS = Date.parse("2026-10-11T00:00:00Z");
const ROUND_AT = Date.parse("2026-10-12T00:00:00Z"); // 24h after OLD_PRODUCTION_TS ⇒ due

test("case (a) — a MANUAL round leaves routine-last-run.json BYTE-IDENTICAL (and really ran)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  writeProductionLastRun(ws, OLD_PRODUCTION_TS);
  const before = fs.readFileSync(lastRunPath(ws), "utf8");

  const fact = await runDiscoveryMethod(ws, runOpts(ws, { invokedBy: INVOKED_BY_MANUAL, reflectFn: reflectStub(), now: () => ROUND_AT }));

  // ⛔ NON-VACUITY: the manual round must have RUN (it ingested the fixture batch and appended its line).
  // A "not due ⇒ nothing happened" no-op would also leave the file byte-identical, and would prove
  // nothing — so the assertions that it ran come FIRST.
  assert.equal(fact.state, "verified", "the manual round ran (the entry is a day old ⇒ due)");
  assert.equal(rounds(ws).length, 1, "…and appended its own scan-round line");
  assert.equal(fact.value.invoked_by, INVOKED_BY_MANUAL, "the Fact carries who invoked the round");
  assert.equal(rounds(ws)[0].invoked_by, INVOKED_BY_MANUAL, "…and so does the carrier line");

  assert.equal(fs.readFileSync(lastRunPath(ws), "utf8"), before, "a MANUAL round must not touch the production last-run map at all");
  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], OLD_PRODUCTION_TS, "the discovery-method entry still holds the PRODUCTION time");
});

test("case (b) — a RESIDENT-DRIVER round advances only the discovery-method key; the others are untouched", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  writeProductionLastRun(ws, OLD_PRODUCTION_TS);

  const fact = await runDiscoveryMethod(ws, runOpts(ws, { reflectFn: reflectStub(), now: () => ROUND_AT }));

  assert.equal(fact.state, "verified");
  assert.equal(fact.value.invoked_by, INVOKED_BY_RESIDENT);
  assert.equal(rounds(ws)[0].invoked_by, INVOKED_BY_RESIDENT);
  const after = readLastRunMap(lastRunPath(ws));
  assert.equal(after[DISCOVERY_METHOD_NAME], ROUND_AT, "the resident round advanced ITS OWN key to the round's clock (it was due)");
  // ⛔ The advance carries its own ATTRIBUTION in the same write: without it, this fresh entry and the
  // unstamped legacy one this task found in production would be the same record (硬规则 3b).
  assert.equal(after[invokedByStampKey(DISCOVERY_METHOD_NAME)], INVOKED_BY_RESIDENT, "the resident round stamps WHO wrote the entry");
  assert.deepEqual(
    Object.fromEntries(Object.entries(after).filter(([k]) => k !== DISCOVERY_METHOD_NAME && k !== invokedByStampKey(DISCOVERY_METHOD_NAME))),
    OTHER_ROUTINE_KEYS,
    "every OTHER routine's entry is unchanged",
  );
  // …and unchanged as TEXT, not merely as parsed values: the merge write must not reformat or reorder them.
  const text = fs.readFileSync(lastRunPath(ws), "utf8");
  for (const [k, v] of Object.entries(OTHER_ROUTINE_KEYS)) {
    assert.ok(text.includes(`"${k}": ${v}`), `${k} must survive the merge write verbatim`);
  }
});

test("case (c) — manual then resident INSIDE the same interval: the resident round is still DUE", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  // NO production entry at all: "never ran ⇒ due" is the fixture's lever for the manual round.
  const ingest = countingIngest();
  const clock = { t: ROUND_AT };

  const manual = await runDiscoveryMethod(ws, runOpts(ws, { invokedBy: INVOKED_BY_MANUAL, ingestFn: ingest, now: () => clock.t }));
  assert.equal(manual.state, "verified", "the manual round ran (never ran in production ⇒ due)");
  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], undefined, "…and left NO production entry behind");

  clock.t += 60_000; // ONE MINUTE later — 359 minutes inside the interval
  const resident = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest, now: () => clock.t }));

  // ⛔ THE CLAIM: the resident round is still due because it reads the last PRODUCTION time (absent/old),
  // NOT the manual round's. Were the manual round to have advanced it (the mutation AC3 applies), the
  // resident round would be `not-evaluated: not due` one minute later and this goes red.
  assert.equal(resident.state, "verified", "the resident round is STILL DUE — a manual round does not consume the window");
  assert.equal(ingest.calls.length, 2, "BOTH rounds reached the ingest step (neither returned early at the due gate)");
  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], clock.t, "the resident round is what advanced the production entry");
});

test("case (d) — the carrier line names its caller: manual vs resident-driver, side by side", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const clock = { t: ROUND_AT };
  await runDiscoveryMethod(ws, runOpts(ws, { invokedBy: INVOKED_BY_MANUAL, ingestFn: countingIngest(), now: () => clock.t }));
  clock.t += 2 * 360 * 60_000; // past the interval, so the resident round is due whatever the manual one did
  await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: countingIngest(), now: () => clock.t }));

  const [first, second] = rounds(ws);
  assert.equal(first.invoked_by, "manual", "a round invoked by hand says so on the carrier");
  assert.equal(second.invoked_by, "resident-driver", "…and a round from the driver's routine table says that");
  // The stamp is the LITERAL string on the line (the carrier is read by tools that never see this file),
  // not an enum that happens to compare equal.
  assert.equal(JSON.parse(fs.readFileSync(carrierPath(ws), "utf8").split("\n").filter(Boolean)[0]).invoked_by, "manual");
});

test("the due gate for a MANUAL round: an in-window run is a no-op, `--force` runs one and STILL does not advance last-run", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeProductionLastRun(ws, ROUND_AT); // production ran "now" ⇒ NOT due
  const before = fs.readFileSync(lastRunPath(ws), "utf8");
  const ingest = countingIngest();
  const at = () => ROUND_AT + 60_000;

  const plain = await runDiscoveryMethod(ws, runOpts(ws, { invokedBy: INVOKED_BY_MANUAL, ingestFn: ingest, now: at }));
  assert.equal(plain.state, "not-evaluated", "a manual round still answers its own due gate");
  assert.match(plain.reason, /not due/);
  assert.match(plain.reason, /--force/, "…and the refusal says how to run one anyway");
  assert.equal(plain.value.invoked_by, INVOKED_BY_MANUAL, "the Fact names the caller even when nothing spawned");

  const forced = await runDiscoveryMethod(ws, runOpts(ws, { invokedBy: INVOKED_BY_MANUAL, force: true, ingestFn: ingest, now: at }));
  assert.equal(forced.state, "verified", "--force runs the round inside the interval");
  assert.match(forced.reason, /--force/, "…and the Fact says the gate was bypassed for this round");
  assert.equal(fs.readFileSync(lastRunPath(ws), "utf8"), before, "⛔ forcing past the window must not CONSUME the window — last-run is still byte-identical");
  assert.equal(ingest.calls.length, 1, "only the forced round spawned");
});

test("the `--once` CLI is a MANUAL round: it appends its line and never advances the production last-run", () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  // An EMPTY evidence store: the real ingester finds nothing, so the round needs no model seam and the
  // CLI can run with `--no-model` (the acceptance-run shape this task exists for).
  fs.writeFileSync(path.join(ws, ".quay", "architecture-evidence-store.jsonl"), "", "utf8");
  writeProductionLastRun(ws, ROUND_AT); // recent ⇒ the round is only reached via `--force`
  const before = fs.readFileSync(lastRunPath(ws), "utf8");

  const run = spawnSync(process.execPath, [ROUTINE_SRC, "--once", "--root", ws, "--no-model", "--force", "--json"], { encoding: "utf8", env: GIT_ENV });
  assert.equal(run.status, 0, `the CLI must exit 0 — stdout: ${run.stdout} stderr: ${run.stderr}`);
  const out = JSON.parse(run.stdout);
  assert.equal(out.fact.state, "verified");
  assert.equal(out.fact.value.invoked_by, "manual", "the CLI declares itself manual");
  assert.equal(rounds(ws).length, 1);
  assert.equal(rounds(ws)[0].invoked_by, "manual");
  assert.equal(fs.readFileSync(lastRunPath(ws), "utf8"), before, "⛔ the CLI — the very path that caused the defect — must not move production's clock");
});

// ── (5) the budget breach ───────────────────────────────────────────────────────────────────────────
test("case (5) — a wall-budget breach ⇒ failed, carrier byte-identical, last-run NOT advanced", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  discovery_method:\n    enabled: true\n    interval: interval:360m\n    max_wall_ms: 1\n");
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  // A pre-existing carrier line: the failure must leave it BYTE-IDENTICAL.
  fs.writeFileSync(carrierPath(ws), JSON.stringify({ kind: "scan-round", routine: DISCOVERY_METHOD_NAME, seed: true }) + "\n", "utf8");
  const before = fs.readFileSync(carrierPath(ws), "utf8");

  // A clock that advances 1s per read: `started` is read once, the post-ingest read is already past the
  // 1ms budget — deterministic, and it exercises the REAL check rather than a mocked one.
  let t = Date.parse("2026-10-12T00:00:00Z");
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { now: () => { t += 1000; return t; } }));

  assert.equal(fact.state, "failed");
  assert.match(fact.reason, /budget breach/);
  assert.match(fact.reason, /max_wall_ms 1/);
  assert.equal(fs.readFileSync(carrierPath(ws), "utf8"), before, "carrier must stay byte-identical");
  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], undefined, "last-run must NOT advance");
});

// ── (6) an ingest refusal is the round's own failure, with the step's OWN code ──────────────────────
test("case (6) — an ingest refusal (WATERMARK_MISMATCH) ⇒ failed with that reason, carrier untouched", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeFixtureStore(ws, FIXTURE_OUTCOMES);

  // Round 1: ingest both outcomes and persist the watermark + one scan-round line.
  const clock = { t: Date.parse("2026-10-12T00:00:00Z") };
  const reflect = reflectStub();
  const f1 = await runDiscoveryMethod(ws, runOpts(ws, { reflectFn: reflect, now: () => clock.t }));
  assert.equal(f1.state, "verified");
  assert.equal(rounds(ws).length, 1);

  // Rewrite the store so the watermarked line no longer hashes to what was recorded. The ingester must
  // REFUSE — never silently restart from line 0 (硬规则 3b).
  const storeFile = path.join(ws, ".quay", "architecture-evidence-store.jsonl");
  const lines = fs.readFileSync(storeFile, "utf8").split("\n").filter(Boolean);
  lines[lines.length - 1] = lines[lines.length - 1].replace('"E-FIX cluster 2"', '"E-FIX cluster 2 REWRITTEN"');
  fs.writeFileSync(storeFile, lines.join("\n") + "\n", "utf8");

  const before = fs.readFileSync(carrierPath(ws), "utf8");
  clock.t += 2 * 360 * 60_000;
  const f2 = await runDiscoveryMethod(ws, runOpts(ws, { reflectFn: reflect, now: () => clock.t }));
  assert.equal(f2.state, "failed");
  assert.match(f2.reason, /WATERMARK_MISMATCH/);
  assert.equal(fs.readFileSync(carrierPath(ws), "utf8"), before, "nothing appended on a refused ingest");
  assert.equal(rounds(ws).length, 1, "still exactly one scan-round line");
});

// ── (7) two rounds, identical inputs ────────────────────────────────────────────────────────────────
test("case (7) — two rounds on identical inputs ⇒ round 2 ingests 0 and makes 0 model calls", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeFixtureStore(ws, FIXTURE_OUTCOMES);

  const clock = { t: Date.parse("2026-10-12T00:00:00Z") };
  const reflect = reflectStub();
  const opts = () => runOpts(ws, { reflectFn: reflect, now: () => clock.t });

  const f1 = await runDiscoveryMethod(ws, opts());
  assert.equal(f1.state, "verified");
  assert.equal(rounds(ws)[0].ingested.experiences, FIXTURE_OUTCOMES.length, "round 1 ingests the whole (watermarkless) store");
  assert.equal(reflect.calls.length, 1, "round 1 reflects exactly once");
  assert.equal(rounds(ws)[0].model_calls, 1, "…and records the model calls it made");

  clock.t += 2 * 360 * 60_000; // advance past the interval
  const f2 = await runDiscoveryMethod(ws, opts());
  assert.equal(f2.state, "verified");
  assert.equal(rounds(ws).length, 2, "round 2 appends exactly one scan-round line");
  assert.equal(rounds(ws)[1].ingested.experiences, 0, "round 2 ingests ZERO (the watermark is durable)");
  assert.equal(rounds(ws)[1].reflected, null, "nothing new ⇒ the reflection step never ran");
  assert.equal(rounds(ws)[1].model_calls, 0, "ZERO model calls");
  assert.equal(reflect.calls.length, 1, "the reflection seam was NOT called a second time");
  assert.equal(typeof rounds(ws)[1].wall_ms, "number");
  assert.equal(rounds(ws)[1].candidates.minted, 0);
  assert.deepEqual(rounds(ws)[1].promotions, []);
  assert.deepEqual(rounds(ws)[1].retirements, []);
});

// ── the FRESH-HOST round (task gap-discovery-method-evidence-store-never-autonomously-populated) ────
// ⛔ THE DEFECT THIS PINS, end to end through the REAL round: NOTHING RESIDENT writes the evidence store,
// so on a host whose store was never seeded by hand this step refused EVERY round with
// `EVIDENCE_STORE_MISSING` — the round's own failure, with a prerequisite the round can never produce.
// The round must now be `verified` with 0 to ingest, and the store it creates must be EMPTY (a
// bootstrap, never a fabricated record).
test("BOOTSTRAP — a round on a host with NO evidence store is `verified`, not `failed: EVIDENCE_STORE_MISSING`", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  // ⛔ Deliberately NO `writeFixtureStore`: the fresh-host state is the fixture. `makeWorkspace` creates
  // `.quay/` and nothing else, which is exactly what `quay init` leaves behind on a new deployment.
  const storeFile = path.join(ws, ".quay", "architecture-evidence-store.jsonl");
  assert.equal(fs.existsSync(storeFile), false, "the fixture really starts with no evidence store");

  const f = await runDiscoveryMethod(ws, runOpts(ws, { now: () => Date.parse("2026-10-12T00:00:00Z") }));
  assert.equal(f.state, "verified", f.reason);
  assert.doesNotMatch(f.reason, /EVIDENCE_STORE_MISSING/, "the permanent dead end is gone");

  assert.equal(fs.existsSync(storeFile), true, "the round CREATED the store");
  assert.equal(fs.readFileSync(storeFile, "utf8"), "", "…EMPTY — the fix fabricates no evidence record");

  assert.equal(rounds(ws).length, 1, "the round appended its one scan-round line");
  assert.equal(rounds(ws)[0].ingested.experiences, 0);
  assert.equal(rounds(ws)[0].ingested.store_bootstrapped, true, "and the line says THIS round created the store");
  assert.equal(rounds(ws)[0].reflected, null, "0 to ingest ⇒ the reflection step never ran, so no model seam was needed");
});

// ── WHAT THE ZERO MEANS (task gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-
//    nothing-forever, Plan item 2) ─────────────────────────────────────────────────────────────────────
// ⛔ THE DEFECT THIS PINS: `ingested 0` was ONE reading for TWO facts — «this store has never held a
//    record, so no producer is writing it» (a wiring defect that stays true forever) and «this store
//    holds records, none of them new since the watermark» (the ordinary second run). Reported in the
//    same shape, the first was invisible: a capability structurally unable to ingest anything looked
//    exactly like one with nothing to do (硬规则 3b/4).
test("STORE STATE — «no producer has ever written this store» is NAMED, and is never the same reading as «nothing new since the watermark»", async () => {
  // (1) the host whose store has NEVER HELD A RECORD.
  const fresh = makeWorkspace();
  writeConfig(fresh, ENABLED_YAML);
  const f1 = await runDiscoveryMethod(fresh, runOpts(fresh, { now: () => Date.parse("2026-10-12T00:00:00Z") }));
  assert.equal(f1.state, "verified", f1.reason);
  const emptyRound = rounds(fresh)[0];
  assert.equal(emptyRound.ingested.store_state, "empty", "the state this round reports is the EMPTY one");
  assert.equal(emptyRound.ingested.store_records, 0, "…with the raw count it was derived from, on the same line");
  assert.equal(emptyRound.ingested.experiences, 0);
  assert.match(f1.reason, new RegExp(EVIDENCE_STORE_NO_PRODUCER), "the Fact NAMES the wiring condition");
  assert.match(f1.reason, /NOT «nothing new since the watermark»/, "…and says what it is not");

  // (2) the SAME config, a host whose store HOLDS RECORDS and whose watermark sits at the end of them.
  const used = makeWorkspace();
  writeConfig(used, ENABLED_YAML);
  writeFixtureStore(used, FIXTURE_OUTCOMES);
  const clock = { t: Date.parse("2026-10-12T00:00:00Z") };
  const reflect = reflectStub();
  const g1 = await runDiscoveryMethod(used, runOpts(used, { reflectFn: reflect, now: () => clock.t }));
  assert.equal(g1.state, "verified");
  assert.equal(rounds(used)[0].ingested.store_state, "ingested", "a round that really ingested says so");
  clock.t += 2 * 360 * 60_000;
  const g2 = await runDiscoveryMethod(used, runOpts(used, { reflectFn: reflect, now: () => clock.t }));
  const noNewRound = rounds(used)[1];
  assert.equal(noNewRound.ingested.store_state, "no-new-since-watermark");
  assert.equal(noNewRound.ingested.store_records, FIXTURE_OUTCOMES.length, "the store really holds records — that is what makes this a different state");
  assert.doesNotMatch(g2.reason, new RegExp(EVIDENCE_STORE_NO_PRODUCER), "a store WITH records never reports the missing-producer state");
  assert.match(g2.reason, /no new outcome records since the watermark/);

  // ⛔ THE POINT OF THE WHOLE CASE: both rounds ingested ZERO, and they are two DIFFERENT readings.
  assert.equal(emptyRound.ingested.experiences, 0);
  assert.equal(noNewRound.ingested.experiences, 0);
  assert.notEqual(emptyRound.ingested.store_state, noNewRound.ingested.store_state, "0-new-from-empty ≠ 0-new-from-unchanged");
  assert.notEqual(f1.reason, g2.reason, "…and the two Facts are not the same sentence");

  // The vocabulary itself is the ledger module's, consumed rather than re-spelled: the raw ingester names
  // the same states through its OWN exports, so a routine and a caller cannot drift apart.
  const realLedger = await import("../../docs/analysis/discovery-experience-ledger.mjs");
  assert.equal(emptyRound.ingested.store_state, realLedger.STORE_STATE_EMPTY);
  assert.equal(noNewRound.ingested.store_state, realLedger.STORE_STATE_NO_NEW);
  assert.equal(realLedger.storeStateOf({ store_records: 0, scanned: 0, ingested: 0 }), realLedger.STORE_STATE_EMPTY);
});

test("STORE STATE — a store whose outcomes are all NOT-INGESTIBLE is its own state (read, and none of them usable)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  // An ownership-loop verdict: a perfectly valid store record that is NOT a discovery finding, so the
  // deriver skips it by name rather than coercing it into a role (see `VERDICT_ROLE`).
  writeFixtureStore(ws, [{ experiment_ref: "E-FIX cluster 1", verdict: "proposed", subject_key: "concern|plugin/scripts/alpha.ts" }]);
  const f = await runDiscoveryMethod(ws, runOpts(ws, { now: () => Date.parse("2026-10-12T00:00:00Z") }));
  assert.equal(f.state, "verified", f.reason);
  const r = rounds(ws)[0];
  assert.equal(r.ingested.experiences, 0);
  assert.equal(r.ingested.scanned, 1, "the outcome WAS read past the watermark");
  assert.equal(r.ingested.store_state, "scanned-none-ingested", "the third zero: records read, none usable");
  assert.doesNotMatch(f.reason, new RegExp(EVIDENCE_STORE_NO_PRODUCER));
  assert.match(f.reason, /NONE of them became an Experience/);
  assert.equal(r.reflected, null, "nothing ingested ⇒ the reflection step never ran");
});

test("a round with new Experiences and NO model seam ⇒ failed (never a silent no-op)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  const fact = await runDiscoveryMethod(ws, runOpts(ws, {}));
  assert.equal(fact.state, "failed");
  assert.match(fact.reason, /model-seam-missing/);
  assert.equal(fs.existsSync(carrierPath(ws)), false, "a failed round writes nothing to the carrier");

  // …and an unresolvable LAZY factory is the same refusal with the factory's own reason.
  const ws2 = makeWorkspace();
  writeConfig(ws2, ENABLED_YAML);
  writeFixtureStore(ws2, FIXTURE_OUTCOMES);
  const f2 = await runDiscoveryMethod(ws2, runOpts(ws2, { modelFactory: async () => ({ ok: false, reason: "DRIVER_RUNTIME_IMPORT_FAILED" }) }));
  assert.equal(f2.state, "failed");
  assert.match(f2.reason, /model-seam-unavailable/);
  assert.match(f2.reason, /DRIVER_RUNTIME_IMPORT_FAILED/);
});

// ── (8) report-only: no task/goal created, and no authoring symbol in the source ─────────────────────
test("case (8) — after a full round nothing under tasks/ or goals/ changed, and the source is filing-free", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  writeFixtureStore(ws, FIXTURE_OUTCOMES);

  const statusBefore = spawnSync("git", ["-C", ws, "status", "--porcelain", "tasks/", "goals/"], { encoding: "utf8", env: GIT_ENV }).stdout;
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { reflectFn: reflectStub() }));
  assert.equal(fact.state, "verified");
  const statusAfter = spawnSync("git", ["-C", ws, "status", "--porcelain", "tasks/", "goals/"], { encoding: "utf8", env: GIT_ENV }).stdout;
  assert.equal(statusAfter, statusBefore, "no file under tasks/ or goals/ changed");
  assert.equal(statusAfter, "", "tasks/ and goals/ are empty — the routine created no task and no goal");
  assert.equal(fs.readdirSync(path.join(ws, "tasks")).length, 0, "tasks/ is still empty");
  assert.equal(fs.readdirSync(path.join(ws, "goals")).length, 0, "goals/ is still empty");

  // The STATIC control: the routine source names none of the authoring symbols, judged BY POSITION
  // (the predicate is applied to the real file's source text, not to a prose claim about it).
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  const FORBIDDEN = /selectFilings|fileRoutineTask|driveItems|task_write|goal_write|writeTask|writeGoal|lifecycle_promote|lifecycle_retreat|lifecycle_complete/;
  assert.doesNotMatch(src, FORBIDDEN, "discovery-method-routine.ts must import/call no filing or authoring symbol");
  // A non-zero control on the SAME predicate: it CAN fire, so the zero above is a real zero (硬规则 2).
  assert.match(src, /appendCarrierRecords/, "the predicate finds a token that IS present in this file");

  // THE MUTATION CONTROL: injecting one authoring import into a copy of this very source turns the SAME
  // predicate red. Without it the assertion above proves only that the regex compiles.
  const mutated = `${src}\nimport { writeTask } from "./nowhere.ts";\n`;
  assert.match(mutated, FORBIDDEN, "the mutation must turn the same predicate red — otherwise the control is vacuous");
  assert.notEqual(mutated, src, "the mutation control must actually change the source");
});

// ── the engine modules are resolved from DISK, never statically imported ─────────────────────────────
// WHY THIS IS A TEST AND NOT A COMMENT: a static `../../docs/analysis/*.mjs` specifier in THIS file is a
// build-breaking defect, not a style choice. `publish-dist-branch` stages `plugin/` as the artifact root
// and bundles `scripts/*.ts` — so the specifier escapes the artifact (`Could not resolve
// "../../docs/analysis/…"`, which reds npm-pack-e2e / shipped-shell-reachability / build-plugin-dist),
// AND esbuild inlines those modules, whose own entry guards then HIJACK the driver bundles' mains. Both
// halves were observed on this task before this control existed; the predicate below is what keeps the
// third one from being written.
test("the engine modules are resolved at runtime — NO static out-of-artifact import (with mutation control)", () => {
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  // Judged BY POSITION on the real source text (硬规则 2): a static import/export-from specifier that
  // walks OUT of the shipped artifact into docs/analysis.
  const STATIC_ENGINE_IMPORT = /(?:^|\n)\s*(?:import|export)[^;\n]*from\s*["'][^"']*docs\/analysis\/[^"']*["']/;
  assert.doesNotMatch(src, STATIC_ENGINE_IMPORT, "no static import may reach docs/analysis from this shipped file");
  // Non-zero control on the SAME predicate: it CAN fire. `src` must not be silently un-matchable.
  const mutated = `${src}\nimport { reflect } from "../../docs/analysis/discovery-reflection.mjs";\n`;
  assert.match(mutated, STATIC_ENGINE_IMPORT, "the mutation must turn the same predicate red — otherwise the control is vacuous");
  assert.notEqual(mutated, src, "the mutation control must actually change the source");
  // …and the runtime resolution it is replaced by is really there.
  assert.match(src, /await import\(\/\* @vite-ignore \*\/ pathToFileURL\(/, "the loader must import a RESOLVED path, so the bundler cannot see a specifier to inline");
});

test("resolveEngineModule — resolves from the script's own repo, and a missing module is a NAMED refusal", () => {
  const ws = makeWorkspace();
  // A real module: resolved, and from the SCRIPT's repo (candidate 1), not from the workspace root.
  const real = resolveEngineModule(ws, LEDGER_MODULE_FILE);
  assert.notEqual(real.path, null, "a real engine module resolves even for a bare workspace");
  assert.equal(real.path, path.join(SCRIPT_REPO_ROOT, "docs", "analysis", LEDGER_MODULE_FILE), "code resolves with the code, not with the observed workspace");
  assert.equal(real.tried.length, 2, "both candidate roots are tried and BOTH are named on refusal");
  // TAKE-FALSE: a module that is not there is null — and it says WHERE it looked, so the round's
  // `failed` reason can name the paths rather than reporting a bare "unresolved" (硬规则 3b).
  const missing = resolveEngineModule(ws, "discovery-no-such-module.mjs");
  assert.equal(missing.path, null, "an absent module must be null, never a fallback to some other file");
  assert.equal(missing.tried.length, 2);
  assert.ok(missing.tried.every((p) => p.endsWith("discovery-no-such-module.mjs")), "the refusal names the file it looked for at each root");
});

test("loadDiscoveryModules — the three engine modules load with callable seams, and are cached", async () => {
  const ws = makeWorkspace();
  const mods = await loadDiscoveryModules(ws);
  for (const [name, fn] of [
    ["ledger.ingestNewOutcomes", mods.ledger.ingestNewOutcomes],
    ["ledger.readExperienceLedger", mods.ledger.readExperienceLedger],
    ["reflection.runReflectionRound", mods.reflection.runReflectionRound],
    ["reflection.validateGeneralization", mods.reflection.validateGeneralization],
    ["reflection.liveModelFactory", mods.reflection.liveModelFactory],
    ["registry.appendMethodRecord", mods.registry.appendMethodRecord],
    ["registry.readMethodRegistry", mods.registry.readMethodRegistry],
  ]) {
    assert.equal(typeof fn, "function", `${name} must be callable — a shape mismatch must not pass as a load`);
  }
  // Cached by RESOLVED path: a second resolution hands back the SAME module instances rather than
  // re-importing them. (The wrapper object is rebuilt — it is the module graph that is shared, and that
  // is the claim that matters: a re-import would re-initialise the engine's own module-level state.)
  const again = await loadDiscoveryModules(ws);
  assert.equal(again.ledger, mods.ledger, "the ledger module is the same instance — cached, not re-imported");
  assert.equal(again.reflection, mods.reflection, "the reflection module is the same instance");
  assert.equal(again.registry, mods.registry, "the registry module is the same instance");
});

// ── the held-out pool: only pinned Experiences are usable, and an unreadable ledger is its OWN value ─
test("readHeldOutCases — only Experiences carrying an evaluation_pin, and an unreadable ledger is not 'no cases'", async () => {
  const ws = makeWorkspace();
  const pinned = await readHeldOutCases(ws);
  assert.equal(pinned.ok, true, "an absent ledger is a real empty pool");
  assert.deepEqual(pinned.cases, []);

  const unpinnedRoot = makeWorkspace();
  fs.mkdirSync(path.join(unpinnedRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(unpinnedRoot, ".quay", "discovery-experience-ledger.jsonl"),
    [
      JSON.stringify({ kind: "experience", id: "experience-aaaa", case_id: "E-1", role: "confirmed-negative", evaluation_pin: "abc123" }),
      JSON.stringify({ kind: "experience", id: "experience-bbbb", case_id: "E-2", role: "confirmed-negative", evaluation_pin: null }),
    ].join("\n") + "\n",
    "utf8",
  );
  const read = await readHeldOutCases(unpinnedRoot);
  assert.equal(read.ok, true);
  assert.equal(read.cases.length, 1, "an Experience with a null pin is NOT a held-out case");
  assert.equal(read.cases[0].case_id, "E-1");

  // A torn ledger line must NOT read as "the pool is smaller than it is" (硬规则 3b).
  fs.appendFileSync(path.join(unpinnedRoot, ".quay", "discovery-experience-ledger.jsonl"), "{ not json\n", "utf8");
  const torn = await readHeldOutCases(unpinnedRoot);
  assert.equal(torn.ok, false);
  assert.match(torn.reason, /LEDGER_UNREADABLE/);
});

// ── the RoutineSpec wrapper (what the driver's routine table receives) ───────────────────────────────
test("RoutineSpec — buildDiscoveryMethodRoutine wires config + ctx.halted into the round", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const read = readDiscoveryMethodConfig(ws);
  assert.equal(read.present, true);
  assert.equal(read.config.enabled, true);
  assert.equal(read.config.trigger.minutes, 360, "the RoutineSpec schedule is the declared interval");

  const ingest = countingIngest();
  const spec = buildDiscoveryMethodRoutine(ws, read, { ingestFn: ingest });
  assert.equal(spec.name, DISCOVERY_METHOD_NAME);
  const facts = await spec.run({ halted: true });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].state, "not-evaluated", "ctx.halted reaches the round");
  assert.equal(ingest.calls.length, 0);
});

test("readDiscoveryMethodConfig — an absent section is present:false with no error (off by default)", () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  board: native\n");
  const read = readDiscoveryMethodConfig(ws);
  assert.equal(read.present, false);
  assert.equal(read.config, null);
  assert.equal(read.error, null);

  // and the carrier reader on a missing file is a real "no previous rounds", not an error
  assert.deepEqual(readCarrierRounds(path.join(ws, CARRIER_REL)), { missing: true, records: [] });
  // …while a torn carrier THROWS rather than reading as "0 previous rounds" (硬规则 3b).
  fs.mkdirSync(path.dirname(path.join(ws, CARRIER_REL)), { recursive: true });
  fs.writeFileSync(path.join(ws, CARRIER_REL), "{ this is not json\n", "utf8");
  assert.throws(() => readCarrierRounds(path.join(ws, CARRIER_REL)), /not valid JSON/);
});

test("discoveryMethodRoutineFromConfig — absent ⇒ NO routine assembled (the host's routine set is unchanged)", () => {
  const absent = makeWorkspace();
  writeConfig(absent, "loop:\n  board: native\n");
  const a = discoveryMethodRoutineFromConfig(absent);
  assert.equal(a.present, false);
  assert.equal(a.routine, null, "no section ⇒ the driver adds no routine at all (off by default)");

  // A DECLARED section always yields a routine — the declaration must be observable, including the
  // kill switch (enabled:false) and a malformed section (failed), never silence.
  const disabled = makeWorkspace();
  writeConfig(disabled, "loop:\n  discovery_method:\n    enabled: false\n");
  const b = discoveryMethodRoutineFromConfig(disabled);
  assert.equal(b.routine !== null, true, "enabled:false is still assembled (it must record not-evaluated:disabled)");
  assert.equal(b.enabled, false);

  const bad = makeWorkspace();
  writeConfig(bad, "loop:\n  discovery_method:\n    enabled: true\n    interval: interval:5m\n");
  const c = discoveryMethodRoutineFromConfig(bad);
  assert.equal(c.routine !== null, true, "a malformed section is still assembled (it must record failed)");
  assert.match(c.error, new RegExp(`below the ${MIN_INTERVAL_MINUTES}m floor`));
  assert.equal(c.intervalMinutes, null, "a malformed section assembled no cadence ⇒ nothing to report as assembled");
});

// ── the driver's routine table: the new routine is INJECTED, never self-read ────────────────────────
test("qualityGateRoutines — the discovery-method routine joins the table ONLY when it is passed in", async () => {
  const mod = await import("../scripts/quality-gate-driver.ts");
  const base = {
    planCmd: null, judgeArgv: null, judgmentCmd: null, resourceGateArgv: null,
    identityCmd: null, lineageCmd: null, deletionCmd: null, archJudgeArgv: null,
    poolJudgeIntervalMinutes: 10, judgmentIntervalMinutes: 30, archReviewIntervalMinutes: 60,
    packagingCheckCmd: null, packagingGapWorkerCmd: null, packagingGapWorkerTimeoutMs: 900_000,
    packagingHygieneIntervalMinutes: 60,
    archGapWorkerCmd: null, archGapWorkerTimeoutMs: 900_000,
  };
  const withoutIt = mod.qualityGateRoutines("/repo", base);
  assert.equal(withoutIt.some((r) => r.name === DISCOVERY_METHOD_NAME), false, "absent ⇒ the routine table is unchanged (old behaviour)");

  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const spec = buildDiscoveryMethodRoutine(ws, readDiscoveryMethodConfig(ws), { ingestFn: countingIngest() });
  const withIt = mod.qualityGateRoutines("/repo", { ...base, discoveryMethodRoutine: spec });
  assert.equal(withIt.some((r) => r.name === DISCOVERY_METHOD_NAME), true, "declared ⇒ the routine joins the table");
  assert.equal(withIt.length, withoutIt.length + 1);
});

// ── the TEMPORARY faster cadence: 60m + interval_until + a 24h ceiling (AC1 (a)-(g)) ────────────────
// The user's ask (2026-10-12) was to run ONLY this routine every 60m, temporarily. The three rules under
// test exist so that "temporarily" cannot quietly become "standing": a sub-360m interval must NAME its
// expiry, must carry a cross-round model-call ceiling, and must revert on its own when the expiry passes.
//
// ⛔ All of the new cases are written against the DUE BASIS this task introduced (resident carrier lines /
// the resident stamp), because that is what makes the cadence real: with the legacy unstamped entry
// still in `.quay/routine-last-run.json`, a 60m cadence would still be six hours away from firing.
const FUTURE_UNTIL = "2026-10-19T12:00:00Z"; // 7 days after the 2026-10-12 landing

test("case (a) — interval:60m WITH a future interval_until ⇒ accepted, and DUE 60m after the last resident run", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL));
  const read = readDiscoveryMethodConfig(ws);
  assert.equal(read.error, null, `60m must be accepted when it declares its expiry: ${read.error}`);
  assert.equal(read.config.trigger.minutes, 60);
  assert.equal(read.config.intervalUntil, Date.parse(FUTURE_UNTIL), "the expiry is parsed to an instant");
  assert.equal(read.config.maxModelCallsPer24h, 24, "the required 24h ceiling is read");
  // …and the ASSEMBLED cadence is handed back by the production entry, which is what the host driver
  // REPORTS at startup (its stderr line names the interval — see AC3's real reload evidence).
  const assembled = discoveryMethodRoutineFromConfig(ws);
  assert.equal(assembled.intervalMinutes, 60, "the assembled cadence is reportable, not only re-parseable");
  assert.equal(assembled.intervalUntil, Date.parse(FUTURE_UNTIL));
  assert.equal(assembled.maxModelCallsPer24h, 24);

  const t0 = Date.parse("2026-10-12T13:00:00Z");
  // A RESIDENT run 60m before the round ⇒ exactly at the boundary (isDue is `>=`).
  const wsDue = makeWorkspace();
  writeConfig(wsDue, temporaryYaml(FUTURE_UNTIL));
  writeCarrier(wsDue, [scanRoundLine({ ts: new Date(t0).toISOString(), invokedBy: INVOKED_BY_RESIDENT })]);
  const ingest = countingIngest();
  const due = await runDiscoveryMethod(wsDue, runOpts(wsDue, { ingestFn: ingest, now: () => t0 + 60 * 60_000 }));
  assert.equal(due.state, "verified", `60m after the last resident run the round must be DUE: ${due.reason}`);
  assert.equal(ingest.calls.length, 1);
  assert.equal(due.value.interval.minutes, 60, "the Fact reports the cadence that governed the round");
  assert.equal(due.value.interval.reverted, false);

  // …and 59m after it, NOT due — the reading the old 360m floor made impossible.
  const wsNotYet = makeWorkspace();
  writeConfig(wsNotYet, temporaryYaml(FUTURE_UNTIL));
  writeCarrier(wsNotYet, [scanRoundLine({ ts: new Date(t0).toISOString(), invokedBy: INVOKED_BY_RESIDENT })]);
  const ingest2 = countingIngest();
  const notYet = await runDiscoveryMethod(wsNotYet, runOpts(wsNotYet, { ingestFn: ingest2, now: () => t0 + 59 * 60_000 }));
  assert.equal(notYet.state, "not-evaluated");
  assert.match(notYet.reason, /within the 60m interval/, "the refusal names the DECLARED 60m interval");
  assert.equal(ingest2.calls.length, 0, "ZERO spawns inside the 60m window");
});

test("case (b) — interval:60m WITHOUT interval_until ⇒ config error, ZERO spawns", async () => {
  // Pure parse: the missing expiry, and (independently) the missing 24h ceiling.
  const noUntil = parseDiscoveryMethodSection({ enabled: true, interval: "interval:60m", max_model_calls_per_24h: 24 });
  assert.equal(noUntil.config, null, "a sub-360m interval with no expiry is refused, not rounded");
  assert.match(noUntil.error, /no 'interval_until' is declared/);
  assert.match(noUntil.error, /must not be able to become permanent silently/);

  const noCap = parseDiscoveryMethodSection({ enabled: true, interval: "interval:60m", interval_until: FUTURE_UNTIL });
  assert.equal(noCap.config, null, "a sub-360m interval must declare its cross-round ceiling");
  assert.match(noCap.error, /'max_model_calls_per_24h' is REQUIRED/);

  // …and the same two refusals THROUGH the round: failed, zero spawns, nothing written.
  for (const yaml of [
    "loop:\n  discovery_method:\n    enabled: true\n    interval: interval:60m\n    max_model_calls_per_24h: 24\n",
    `loop:\n  discovery_method:\n    enabled: true\n    interval: interval:60m\n    interval_until: ${FUTURE_UNTIL}\n`,
    `loop:\n  discovery_method:\n    enabled: true\n    interval: interval:60m\n    interval_until: not-a-date\n    max_model_calls_per_24h: 24\n`,
  ]) {
    const ws = makeWorkspace();
    writeConfig(ws, yaml);
    const ingest = countingIngest();
    const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest }));
    assert.equal(fact.state, "failed", `expected failed for config: ${JSON.stringify(yaml)}`);
    assert.equal(ingest.calls.length, 0, "ZERO spawns on a bad config");
    assert.equal(fs.existsSync(carrierPath(ws)), false, "a failed round writes nothing");
  }
});

test("case (c) — after interval_until passes ⇒ the 360m default applies and the Fact says so", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml("2026-10-13T00:00:00Z")); // ALREADY expired relative to the round's clock
  const t0 = Date.parse("2026-10-13T10:00:00Z");
  writeCarrier(ws, [scanRoundLine({ ts: new Date(t0).toISOString(), invokedBy: INVOKED_BY_RESIDENT })]);
  const ingest = countingIngest();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest, now: () => t0 + 61 * 60_000 }));

  assert.equal(fact.state, "not-evaluated", "61m after the last resident run is INSIDE the reverted 360m window");
  assert.equal(fact.value.interval.minutes, 360, "the effective interval reverted to the permanent default");
  assert.equal(fact.value.interval.declared_minutes, 60, "…while the Fact still reports what the config DECLARED");
  assert.equal(fact.value.interval.reverted, true);
  assert.match(fact.reason, /interval_until .* has passed ⇒ the 360m default applies/, "the Fact SAYS the temporary window expired");
  assert.match(fact.reason, /within the 360m interval/);
  assert.equal(ingest.calls.length, 0, "ZERO spawns");

  // ⛔ The revert is re-derived from the CONFIG on every round, not remembered: the SAME parsed config
  // read at a clock BEFORE the expiry still yields 60m. (A spec that froze the first answer would make
  // the driver's in-memory RoutineSpec the authority on a question the config owns.)
  const early = readDiscoveryMethodConfig(ws);
  assert.equal(early.config.trigger.minutes, 60, "the declared interval is unchanged — only its EFFECT epoch is");
});

test("case (d) — an unstamped legacy last-run entry is IGNORED; a resident-stamped one is HONOURED", async () => {
  // (i) PRODUCTION'S ACTUAL 2026-10-12 STATE: a recent `discovery-method` entry with no stamp, written by
  //     a worker acceptance run. It must not hold production's clock for six hours.
  const legacy = makeWorkspace();
  writeConfig(legacy, ENABLED_YAML);
  const legacyText = JSON.stringify({ ...OTHER_ROUTINE_KEYS, [DISCOVERY_METHOD_NAME]: ROUND_AT }, null, 1);
  fs.writeFileSync(lastRunPath(legacy), legacyText, "utf8");
  const ingest = countingIngest();
  const ignored = await runDiscoveryMethod(legacy, runOpts(legacy, { invokedBy: INVOKED_BY_MANUAL, ingestFn: ingest, now: () => ROUND_AT + 60_000 }));
  assert.equal(ignored.state, "verified", "an unattributed entry grants NO window — the round is due");
  assert.equal(ignored.value.due.source, "none", "the Fact enumerates that NOTHING was believed");
  assert.equal(ignored.value.due.legacy_ignored, ROUND_AT, "the Fact names the entry it ignored, as a value");
  assert.match(ignored.value.due.basis, /^routine-last-run\.json holds \d+/, "…and says WHY it was refused");
  assert.match(ignored.reason, /legacy .*routine-last-run\.json entry .* was NOT written by the resident driver and is ignored/);
  assert.equal(fs.readFileSync(lastRunPath(legacy), "utf8"), legacyText, "⛔ the legacy entry is left BYTE-IDENTICAL — ignored, never edited or deleted");
  assert.equal(ingest.calls.length, 1, "…and the round really ran");

  // (ii) The SAME entry, STAMPED as the resident driver's: it IS believed ⇒ not due.
  const stamped = makeWorkspace();
  writeConfig(stamped, ENABLED_YAML);
  writeProductionLastRun(stamped, ROUND_AT);
  const ingest2 = countingIngest();
  const honoured = await runDiscoveryMethod(stamped, runOpts(stamped, { ingestFn: ingest2, now: () => ROUND_AT + 60_000 }));
  assert.equal(honoured.state, "not-evaluated", "a resident-stamped entry IS the production window");
  assert.match(honoured.reason, /not due/);
  assert.equal(honoured.value.due.legacy_ignored, null, "a stamped entry is not 'ignored' — nothing to report");
  assert.equal(honoured.value.due.source, "last-run-stamped");
  assert.equal(ingest2.calls.length, 0, "ZERO spawns");
});

test("case (e) — a manual round BETWEEN two resident rounds does not shift the resident due time", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL));
  const t0 = Date.parse("2026-10-12T13:00:00Z");
  const ingest = countingIngest();

  // Resident at t0 (no prior entry ⇒ due). This is the reading the resident due time comes from.
  const r1 = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest, now: () => t0 }));
  assert.equal(r1.state, "verified");
  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], t0, "the resident round advanced production's clock");

  // A MANUAL round 61m later (due against the same basis) — it appends its line, and moves no clock.
  const manualAt = t0 + 61 * 60_000;
  const lastRunBefore = fs.readFileSync(lastRunPath(ws), "utf8");
  const manual = await runDiscoveryMethod(ws, runOpts(ws, { invokedBy: INVOKED_BY_MANUAL, ingestFn: ingest, now: () => manualAt }));
  assert.equal(manual.state, "verified", "the manual round ran");
  assert.equal(rounds(ws).length, 2);
  assert.equal(rounds(ws)[1].invoked_by, INVOKED_BY_MANUAL);
  assert.equal(fs.readFileSync(lastRunPath(ws), "utf8"), lastRunBefore, "…and left production's entry byte-identical");

  // ⛔ THE DISCRIMINATING READING: 30m after the MANUAL line — but 91m after the RESIDENT one — a resident
  //    round must be DUE. Were the manual line the basis, the elapsed time would read as 30m (< 60m) and
  //    the round would refuse. This is the whole claim, and it is the only instant at which the two
  //    readings disagree.
  const residentAt = t0 + 91 * 60_000;
  const r2 = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest, now: () => residentAt }));
  assert.equal(r2.state, "verified", `the resident due time ignores the manual round between: ${r2.reason}`);
  assert.equal(r2.value.due.last_resident_run, new Date(t0).toISOString(), "the basis is the t0 RESIDENT round, not the t61 MANUAL one");
  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], residentAt);
  assert.equal(rounds(ws).length, 3);
});

test("case (f) — max_model_calls_per_24h reached ⇒ not-evaluated:budget-24h, ZERO spawns", async () => {
  const t0 = Date.parse("2026-10-12T13:00:00Z");
  const fourCalls = [
    scanRoundLine({ ts: new Date(t0 - 200 * 60_000).toISOString(), invokedBy: INVOKED_BY_RESIDENT, modelCalls: 2 }),
    scanRoundLine({ ts: new Date(t0 - 61 * 60_000).toISOString(), invokedBy: INVOKED_BY_RESIDENT, modelCalls: 2 }),
  ];

  // AT the ceiling. The newest resident line is 61m old ⇒ the round IS due, so the refusal can only be
  // the 24h ceiling (a "not due" refusal would be a different state and would not match `^budget-24h:`).
  const reachedWs = makeWorkspace();
  writeConfig(reachedWs, temporaryYaml(FUTURE_UNTIL, 4));
  writeCarrier(reachedWs, fourCalls);
  const ingest = countingIngest();
  const reached = await runDiscoveryMethod(reachedWs, runOpts(reachedWs, { ingestFn: ingest, now: () => t0 }));
  assert.equal(reached.state, "not-evaluated");
  assert.match(reached.reason, /^budget-24h:/, "the refusal names its own cause on the first token");
  assert.equal(reached.value.budget_24h.used, 4);
  assert.equal(reached.value.budget_24h.cap, 4);
  assert.equal(reached.value.budget_24h.window_ms, BUDGET_24H_MS);
  assert.equal(ingest.calls.length, 0, "ZERO spawns once the ceiling is reached");
  assert.equal(rounds(reachedWs).length, 2, "…and no scan-round line was appended");

  // ONE call UNDER the ceiling, same fixture ⇒ RUNS. Without this the assertion above would also pass if
  // the round refused for an unrelated reason (a non-zero control on the same predicate — 硬规则 2).
  const underWs = makeWorkspace();
  writeConfig(underWs, temporaryYaml(FUTURE_UNTIL, 5));
  writeCarrier(underWs, fourCalls);
  const ingest2 = countingIngest();
  const under = await runDiscoveryMethod(underWs, runOpts(underWs, { ingestFn: ingest2, now: () => t0 }));
  assert.equal(under.state, "verified", `one call under the ceiling must RUN: ${under.reason}`);
  assert.equal(ingest2.calls.length, 1);

  // A call OLDER than the trailing 24h is outside the window and does not count.
  const oldWs = makeWorkspace();
  writeConfig(oldWs, temporaryYaml(FUTURE_UNTIL, 4));
  writeCarrier(oldWs, [
    scanRoundLine({ ts: new Date(t0 - BUDGET_24H_MS - 60_000).toISOString(), invokedBy: INVOKED_BY_RESIDENT, modelCalls: 99 }),
    scanRoundLine({ ts: new Date(t0 - 61 * 60_000).toISOString(), invokedBy: INVOKED_BY_RESIDENT, modelCalls: 0 }),
  ]);
  const ingest3 = countingIngest();
  const old = await runDiscoveryMethod(oldWs, runOpts(oldWs, { ingestFn: ingest3, now: () => t0 }));
  assert.equal(old.state, "verified", `calls before the trailing 24h are outside the window: ${old.reason}`);
  assert.equal(old.value.budget_24h.used, 0, "…so the reading is 0, not 99");

  // MANUAL rounds count too: the ceiling bounds MODEL CALLS, and a hand-run spends them the same way.
  assert.equal(modelCallsInWindow([scanRoundLine({ ts: new Date(t0 - 60_000).toISOString(), invokedBy: INVOKED_BY_MANUAL, modelCalls: 3 })], t0, BUDGET_24H_MS), 3);
  // …and a non-resident line with no `model_calls` cannot be read as 0 — the budget is not established
  // from a partially-readable window (硬规则 3b).
  assert.throws(() => modelCallsInWindow([{ kind: "scan-round", ts: new Date(t0 - 60_000).toISOString() }], t0, BUDGET_24H_MS), /cannot be established from a partially-readable window/);
});

test("case (g) — arch-discovery's own interval and floor are UNTOUCHED by this routine's temporary cadence", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, `loop:\n  discovery_method:\n    enabled: true\n    interval: interval:60m\n    interval_until: ${FUTURE_UNTIL}\n    max_model_calls_per_24h: 24\n  arch_discovery:\n    enabled: true\n    interval: interval:360m\n    since_days: 7\n    max_ms: 60000\n    max_records: 2000\n    max_old_space_mb: 512\n`);

  const dm = readDiscoveryMethodConfig(ws);
  assert.equal(dm.error, null, `discovery-method's own parse: ${dm.error}`);
  assert.equal(dm.config.trigger.minutes, 60, "discovery-method takes the declared 60m");

  const arch = readArchDiscoveryConfig(ws);
  assert.equal(arch.error, null, `arch-discovery's own parse, from the SAME fixture: ${arch.error}`);
  assert.equal(arch.config.trigger.minutes, 360, "arch-discovery keeps ITS OWN declared interval");
  assert.equal("intervalUntil" in arch.config, false, "the temporary-window key is discovery-method's; arch-discovery's config has no such field");

  // The floor each routine enforces is its OWN constant, and this task moved exactly one of them.
  assert.equal(MIN_INTERVAL_MINUTES, 60, "discovery-method's floor is now 60m");
  assert.equal(ARCH_MIN_INTERVAL_MINUTES, 60, "arch-discovery's floor is its own 60m (unchanged by this task)");
  assert.equal(parseArchDiscoverySection({ enabled: true, interval: "interval:5m" }).error === null, false, "…and arch-discovery still refuses below ITS floor");
  assert.match(parseArchDiscoverySection({ enabled: true, interval: "interval:5m" }).error, /below the 60m floor/);

  // ⛔ The sub-360m-must-declare-an-expiry rule does NOT leak into arch-discovery: 60m with no
  //    `interval_until` is still a valid arch-discovery declaration (its floor is its only gate).
  const archShort = parseArchDiscoverySection({ enabled: true, interval: "interval:60m" });
  assert.equal(archShort.error, null, "the temporary-cadence rule is discovery-method's, not a repo-wide policy");
  // …nor does discovery-method's 24h ceiling mean anything to it (its parse reads only its own keys).
  assert.equal(parseArchDiscoverySection({ enabled: true, interval: "interval:60m", max_model_calls_per_24h: 1 }).error, null);
});

test("latestResidentRoundTs — only invoked_by:\"resident-driver\" lines count, and an unreadable one is a NAMED refusal", () => {
  const t0 = Date.parse("2026-10-12T13:00:00Z");
  const iso = (t) => new Date(t).toISOString();
  // Legacy (unstamped) and manual lines are NOT the resident due time.
  assert.equal(latestResidentRoundTs([scanRoundLine({ ts: iso(t0) })]), null, "a line with no invoked_by is LEGACY — it cannot say who ran it");
  assert.equal(latestResidentRoundTs([scanRoundLine({ ts: iso(t0), invokedBy: INVOKED_BY_MANUAL })]), null, "a manual round is not production's clock");
  assert.equal(latestResidentRoundTs([]), null, "an empty carrier ⇒ never ran");
  assert.equal(latestResidentRoundTs([{ kind: "finding", invoked_by: INVOKED_BY_RESIDENT, ts: iso(t0) }]), null, "only scan-round lines are rounds");
  // The NEWEST resident line wins, whatever the file order.
  assert.equal(latestResidentRoundTs([
    scanRoundLine({ ts: iso(t0), invokedBy: INVOKED_BY_RESIDENT }),
    scanRoundLine({ ts: iso(t0 + 61 * 60_000), invokedBy: INVOKED_BY_MANUAL }),
    scanRoundLine({ ts: iso(t0 - 120 * 60_000), invokedBy: INVOKED_BY_RESIDENT }),
  ]), t0);
  // ⛔ "Cannot read when production ran" is NOT "production never ran" (硬规则 3b).
  assert.throws(() => latestResidentRoundTs([scanRoundLine({ ts: iso(t0), invokedBy: INVOKED_BY_RESIDENT }), { kind: "scan-round", invoked_by: INVOKED_BY_RESIDENT }]), /has no parseable 'ts'/);
});

test("the temporary cadence does not require a driver restart to EXPIRE, and the stamp survives the advance", async () => {
  // The driver holds `schedule` in memory; the ROUND re-reads the config each time. So the same spec run
  // at two clocks — one inside the window, one past it — must reach two different verdicts.
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml("2026-10-12T14:30:00Z")); // expiry 90m after t0 — inside the 360m window that follows
  const t0 = Date.parse("2026-10-12T13:00:00Z");
  writeCarrier(ws, [scanRoundLine({ ts: new Date(t0).toISOString(), invokedBy: INVOKED_BY_RESIDENT })]);
  // Two OTHER routines' entries, so the "same write" claim below has something to preserve.
  fs.writeFileSync(lastRunPath(ws), JSON.stringify({ ...OTHER_ROUTINE_KEYS }, null, 1), "utf8");
  const clock = { t: t0 + 61 * 60_000 };
  const spec = buildDiscoveryMethodRoutine(ws, readDiscoveryMethodConfig(ws), { ingestFn: countingIngest(), now: () => clock.t });

  // (i) +61m is past the 60m cadence and before the expiry ⇒ DUE, and the round ADVANCES both the
  //     carrier line and the stamped entry.
  const inside = await spec.run({ halted: false });
  assert.equal(inside[0].state, "verified", `inside the window the round runs: ${inside[0].reason}`);
  const map = JSON.parse(fs.readFileSync(lastRunPath(ws), "utf8"));
  assert.equal(map[DISCOVERY_METHOD_NAME], t0 + 61 * 60_000, "the advance landed");
  assert.equal(map[invokedByStampKey(DISCOVERY_METHOD_NAME)], INVOKED_BY_RESIDENT, "…and it landed WITH the stamp, in the same write");
  for (const [k, v] of Object.entries(OTHER_ROUTINE_KEYS)) {
    assert.equal(map[k], v, `${k} survives the stamped merge write`);
  }
  assert.equal(rounds(ws).length, 2, "the seeded resident line + the round this spec just ran");
  assert.equal(rounds(ws)[1].interval.minutes, 60, "the carrier line records the cadence that governed the round");
  assert.equal(rounds(ws)[1].due.source, "carrier");
  assert.equal(rounds(ws)[1].due.basis.startsWith("carrier: latest invoked_by:resident-driver"), true);

  // (ii) SAME spec, a clock past the expiry: the round reverts to 360m and refuses — no restart needed.
  // 30m after the run above — well inside the reverted 360m window, and past the expiry.
  clock.t = Date.parse("2026-10-12T14:31:00Z");
  const after = await spec.run({ halted: false });
  assert.equal(after[0].state, "not-evaluated", "past interval_until the routine stops firing on the fast cadence");
  assert.equal(after[0].value.interval.minutes, 360);
  assert.equal(after[0].value.interval.reverted, true);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// THE 24h CEILING AS A HARD, PRE-SPAWN RESERVATION
// (task gap-discovery-method-24h-budget-hard-reservation)
//
// The 60m task left `max_model_calls_per_24h` SOFT: consulted once before the round (⇒ overshoot), read
// only off `scan-round` lines (⇒ every failure path under-counted), and unlocked (⇒ no cross-process
// atomicity). These cases pin the replacement: ONE durable record appended UNDER A LOCK before each
// subprocess spawns, never deleted, with an outcome appended afterwards; a reservation with no outcome
// counts as SPENT.
//
// ⛔ The cases below drive the REAL engine (`runReflectionRound` → `reflect` from
// docs/analysis/discovery-reflection.mjs) through the REAL ingester over a real fixture evidence store,
// with only the MODEL SEAM stubbed. A helper that re-implemented the engine's budget loop would prove
// nothing about the engine.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

const ledgerFile = (ws) => path.join(ws, BUDGET_LEDGER_REL);
const lockFile = (ws) => path.join(ws, BUDGET_LOCK_REL);
const ledgerLines = (ws) => (fs.existsSync(ledgerFile(ws))
  ? fs.readFileSync(ledgerFile(ws), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : []);
const ledgerReserves = (ws) => ledgerLines(ws).filter((l) => l.kind === "reserve");
const ledgerOutcomes = (ws) => ledgerLines(ws).filter((l) => l.kind === "outcome");

/** Seed N GRANTED reservations at one instant — "the trailing 24h already spent N". */
function seedReservations(ws, n, tsMs) {
  appendLedgerRecords(ledgerFile(ws), Array.from({ length: n }, (_, i) => ({
    kind: "reserve", id: `seed-${i}`, ts: new Date(tsMs).toISOString(), pid: 1,
    step: "reflection", tools: REFLECTION_TOOLS, max_turns: REFLECTION_MAX_TURNS,
  })));
}

/** SIX outcomes with six DISTINCT subject keys ⇒ six reflection units ⇒ six model calls if unbounded.
 *  Written through the real evidence-store writer, so the real ingester reads them. */
const SIX_OUTCOMES = Array.from({ length: 6 }, (_, i) => ({
  experiment_ref: `E-FIX six ${i + 1}`,
  verdict: i % 2 === 0 ? "supported" : "refuted",
  subject_key: `concern|plugin/scripts/six-${i + 1}.ts`,
}));

/** A model seam that COUNTS its invocations and answers the one decision that mints nothing. */
function noMethodModel() {
  const calls = [];
  const fn = async () => { calls.push(1); return { stdout: JSON.stringify({ decision: "no-method" }) }; };
  fn.calls = calls;
  return fn;
}

const t0 = Date.parse("2026-10-12T13:00:00Z");
void t0;

// ── AC1 (a): overshoot is gone ───────────────────────────────────────────────────────────────────────
test("AC1(a) — used=23, cap=24, a round requesting 6 ⇒ exactly 1 call, 5 skipped BUDGET_24H, ledger total 24", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 24)); // cap 24, max_model_calls 6
  writeFixtureStore(ws, SIX_OUTCOMES);
  const at = Date.parse("2026-10-13T13:00:00Z");
  seedReservations(ws, 23, at - 60_000); // 23 already spent inside the trailing 24h

  const model = noMethodModel();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now: () => at }));

  assert.equal(fact.state, "verified", `the round ran: ${fact.reason}`);
  assert.equal(model.calls.length, 1, "⛔ EXACTLY ONE call: the round spends cap − used, not the full per-round max_model_calls");
  assert.equal(fact.value.reservations.granted, 1);
  assert.equal(fact.value.reservations.refused, 5, "the 5 the ceiling removed from the round's request of 6");
  assert.equal(fact.value.reservations.refusal_reason, BUDGET_REFUSAL_CODE);
  assert.equal(fact.value.statements ?? fact.value.reflected.skipped_budget, 5, "the ENGINE's own budget loop reports the same 5 as skipped");
  assert.equal(fact.value.reservations.effective_max_model_calls, 1, "the per-round request was reduced to what the ceiling left");

  const reserves = ledgerReserves(ws);
  assert.equal(reserves.length, 24, "ledger total = 23 seeded + 1 granted — it can never exceed the cap");
  assert.equal(reserves.filter((r) => r.id.startsWith("seed-")).length, 23);
  assert.equal(ledgerOutcomes(ws).length, 1, "the one call recorded its outcome");
  assert.equal(ledgerOutcomes(ws)[0].outcome, "completed");
  // ⛔ The reservation carries the launcher params of the arm the CONFIG selects — the DEFAULT arm now
  // carries tools (task ..., Plan item 2), and this test declares no `reflection_tools`.
  assert.equal(reserves[23].tools, DEFAULT_REFLECTION_TOOLS, "the reservation carries the launcher params it bounds");
  assert.equal(reserves[23].max_turns, DEFAULT_REFLECTION_MAX_TURNS);
  // The carrier line carries the reservation block ⇒ `modelCallsInWindow` will NOT re-count this round.
  assert.equal(rounds(ws).length, 1);
  assert.equal(rounds(ws)[0].reservations.granted, 1);
});

// ── AC1 (b): two REAL processes share the ceiling ────────────────────────────────────────────────────
/** A child script that runs the SAME reservation protocol a second time, in its own process, out of the
 *  module's EXPORTED primitives: `acquireBudgetLock` → read usage → **sleep (the read-to-write window,
 *  widened on purpose and only here)** → append. The two children rendezvous on a barrier FIRST, so both
 *  enter that window at a known instant.
 *  ⛔ The delay lives in the CHILD, never in the shipped module: `openModelBudget.reserve` does read and
 *  append under ONE lock, so widening the window from outside would mean a seam in production code. The
 *  protocol is written out here instead, which is what makes the (b) control deterministic rather than
 *  scheduler-dependent — drop the lock and both children decide on the same stale `used`. */
const CONTEND_CHILD = (moduleUrl) => `
import fs from "node:fs";
import path from "node:path";
import {
  acquireBudgetLock, readLedgerRecords, appendLedgerRecords, budgetUsage,
  BUDGET_24H_MS, BUDGET_LEDGER_REL, BUDGET_LOCK_REL,
} from ${JSON.stringify(moduleUrl)};
const [root, capRaw, delayRaw, barrier, tag] = process.argv.slice(2);
const cap = Number(capRaw);
const delayMs = Number(delayRaw);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockPath = path.join(root, BUDGET_LOCK_REL);
const ledgerPath = path.join(root, BUDGET_LEDGER_REL);
fs.writeFileSync(path.join(barrier, tag), "");
while (fs.readdirSync(barrier).length < 2) await sleep(2);
let granted = 0, refused = 0, error = null;
try {
  for (let i = 0; i < 6; i++) {
    const h = await acquireBudgetLock(lockPath);
    if (!h.ok) throw new Error(h.code + ": " + h.reason);
    try {
      const used = budgetUsage({
        ledgerRecords: readLedgerRecords(ledgerPath).records,
        carrierRounds: [], nowMs: Date.now(), windowMs: BUDGET_24H_MS,
      }).total;
      await sleep(delayMs);   // the read -> write window: inside the lock it serialises, outside it races
      if (used >= cap) { refused++; break; }
      appendLedgerRecords(ledgerPath, [{ kind: "reserve", id: tag + "-" + i, ts: new Date().toISOString(), pid: process.pid, step: "reflection", tools: "", max_turns: 1 }]);
      granted++;
    } finally { h.release(); }
  }
} catch (e) { error = String(e && e.message || e); }
process.stdout.write(JSON.stringify({ granted, refused, error }) + "\\n");
`;

function spawnAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, opts);
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code, signal) => resolve({ code, signal, stdout: out, stderr: err }));
  });
}

test("AC1(b) — TWO REAL PROCESSES, 20 used, each requesting 6 ⇒ combined 4 calls, never more", async () => {
  const ws = makeWorkspace();
  seedReservations(ws, 20, Date.now() - 60_000);
  const barrier = tmpDir("dm-barrier-");
  const script = path.join(tmpDir("dm-contend-"), "contend.mjs");
  fs.writeFileSync(script, CONTEND_CHILD(pathToFileURL(ROUTINE_SRC).href), "utf8");

  // ⛔ The delays DIFFER on purpose. With the lock, whoever holds it is the only one reading, so the
  // count can only ever reach the cap. With the lock dropped, the slow child's first read (20) stays
  // current long enough for the fast child to spend the whole remaining budget — and then the slow one
  // appends ON TOP of a cap that is already reached. That is the overshoot, and it is deterministic.
  const [a, b] = await Promise.all([
    spawnAsync(process.execPath, [script, ws, "24", "30", barrier, "a"], { encoding: "utf8" }),
    spawnAsync(process.execPath, [script, ws, "24", "600", barrier, "b"], { encoding: "utf8" }),
  ]);
  assert.equal(a.code, 0, `child A must exit 0 — stdout ${a.stdout} stderr ${a.stderr}`);
  assert.equal(b.code, 0, `child B must exit 0 — stdout ${b.stdout} stderr ${b.stderr}`);
  const ra = JSON.parse(a.stdout);
  const rb = JSON.parse(b.stdout);
  assert.equal(ra.error, null);
  assert.equal(rb.error, null);

  const combined = ra.granted + rb.granted;
  assert.equal(combined, 4, `20 used, cap 24 ⇒ the ceiling grants exactly 4 more, whatever the interleaving (got A=${ra.granted} B=${rb.granted})`);
  assert.equal(ledgerReserves(ws).length, 24, "…and the LEDGER never exceeds the cap either");
  assert.equal(ledgerReserves(ws).length <= 24, true, "never more");
});

// ── AC1 (c): a crash between the reservation and the outcome ─────────────────────────────────────────
const CRASH_CHILD = (moduleUrl) => `
import { openModelBudget, reservingModel } from ${JSON.stringify(moduleUrl)};
const root = process.argv[2];
const budget = openModelBudget({ root, cap: 100 });
const model = reservingModel(async () => { process.kill(process.pid, "SIGKILL"); throw new Error("unreachable"); },
  budget, { step: "reflection", tools: "", max_turns: 1 });
await model("prompt").catch(() => {});
process.exit(0);
`;

test("AC1(c) — a crash AFTER the reservation and BEFORE the outcome stays SPENT", async () => {
  const ws = makeWorkspace();
  const script = path.join(tmpDir("dm-crash-"), "crash.mjs");
  fs.writeFileSync(script, CRASH_CHILD(pathToFileURL(ROUTINE_SRC).href), "utf8");

  const r = spawnSync(process.execPath, [script, ws], { encoding: "utf8" });
  assert.equal(r.signal, "SIGKILL", `the child was killed mid-call — stderr ${r.stderr}`);

  assert.equal(ledgerReserves(ws).length, 1, "the reservation EXISTS — it was written before the spawn");
  assert.equal(ledgerOutcomes(ws).length, 0, "…and no outcome was ever recorded (the process died first)");

  // AFTER RESTART: a fresh reader still counts it.
  const usage = await openModelBudget({ root: ws, cap: 24 }).usage();
  assert.equal(usage.total, 1, "⛔ a reservation with NO OUTCOME counts as SPENT — this is the under-count defect");
  assert.equal(usage.reservations, 1);
  // …and a round that has no room left is refused BECAUSE of it.
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 1));
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model: noMethodModel() }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /^budget-24h:/);
  assert.equal(fact.value.budget_24h.used, 1, "the crashed call is the reading");
});

// ── AC1 (d): a call that throws or times out is counted ──────────────────────────────────────────────
test("AC1(d) — a model call that THROWS or TIMES OUT is counted, with its own outcome class", async () => {
  for (const [label, err, expected] of [
    ["throws", new Error("boom"), "failed"],
    ["times out", Object.assign(new Error("spawn timed out after 300000ms"), { code: "ETIMEDOUT" }), "timeout"],
  ]) {
    const ws = makeWorkspace();
    writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 24));
    writeFixtureStore(ws, FIXTURE_OUTCOMES);
    const model = async () => { throw err; };

    const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now: () => ROUND_AT }));
    assert.equal(fact.state, "failed", `a call that ${label} fails the round: ${fact.reason}`);
    assert.match(fact.reason, /reflection threw/);

    const outs = ledgerOutcomes(ws);
    assert.equal(ledgerReserves(ws).length, 1, `the ${label} call was RESERVED before it was spawned`);
    assert.equal(outs.length, 1, "…and it recorded an outcome");
    assert.equal(outs[0].outcome, expected, `a ${label} call is recorded as '${expected}'`);
    assert.equal(outs[0].turns, null);
    assert.equal(typeof outs[0].turns_reason, "string");

    // ⛔ THE CLAIM: the spent call is COUNTED by the next reader, whatever happened to it.
    // ⛔ THE READER MUST USE THE SAME CLOCK THE ROUND DID. This fixture dates its round at `ROUND_AT`
    // (2026-10-12T00:00Z), so reading with the WALL clock drops the just-written line out of the trailing
    // 24h window the moment real time passes ROUND_AT + 24h — the assertion then fails on a date, with
    // nothing about the code having changed (measured: green on 2026-10-12, red from 2026-10-13T00:00Z).
    // The injection is the convention this very file already uses two tests below.
    const usage = await openModelBudget({ root: ws, cap: 24, now: () => ROUND_AT }).usage();
    assert.equal(usage.total, 1, `a call that ${label} still counts against the 24h ceiling`);
  }
});

// ── AC1 (e): a wall-breach round appends no line, and is still counted ───────────────────────────────
test("AC1(e) — a wall-breach round PERSISTS a partial line (its spent calls' results are not thrown away) AND its calls are counted exactly once", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, `loop:\n  discovery_method:\n    enabled: true\n    interval: interval:60m\n    interval_until: ${FUTURE_UNTIL}\n    max_model_calls_per_24h: 24\n    max_experiences: 8\n    max_model_calls: 6\n    max_wall_ms: 1000\n`);
  writeFixtureStore(ws, SIX_OUTCOMES);
  const at = Date.parse("2026-10-13T13:00:00Z");
  // The clock only jumps AFTER the first model call, so the round really spends calls before it breaches.
  let called = false;
  const now = () => (called ? at + 5_000 : at);
  const model = async () => { called = true; return { stdout: JSON.stringify({ decision: "no-method" }) }; };

  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now }));
  assert.equal(fact.state, "failed");
  assert.match(fact.reason, /budget breach/);
  // ⛔ CONTRACT CHANGE (task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection, Plan
  //   item 3): the round no longer appends NOTHING. Its spent calls produced RESULTS, and throwing them
  //   away while the calls themselves stayed COUNTED was the loss this task closes — so the line lands,
  //   marked `partial:true`, and the last-run is still not advanced.
  const lines = rounds(ws);
  assert.equal(lines.length, 1, "the partial round is persisted");
  assert.equal(lines[0].partial, true);
  assert.equal(lines[0].partial_reason, "BUDGET_MAX_WALL_MS:after-reflection");
  assert.equal(lines[0].model_calls, SIX_OUTCOMES.length, "…carrying every call it made and every decision it recorded");
  assert.equal(lines[0].reflected.decisions, SIX_OUTCOMES.length);
  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], undefined, "the clock is still NOT consumed");

  const spent = ledgerReserves(ws).length;
  assert.equal(spent, SIX_OUTCOMES.length, "the round spent one call per unit before it breached");
  // The NEXT ROUND's reading — taken with the SAME clock the round ran on (a reservation's ts is written
  // from the round's own clock, so a reader on a different clock is asking about a different window).
  const usage = await openModelBudget({ root: ws, cap: 24, now: () => at + 10_000 }).usage();
  assert.equal(usage.legacy_model_calls, 0, "the partial line carries `reservations`, so the carrier term SKIPS it — no double count");
  assert.equal(usage.total, spent, "⛔ the next round counts them OFF THE LEDGER, exactly once");
});

// ── AC1 (f): the window boundary ─────────────────────────────────────────────────────────────────────
test("AC1(f) — the window is HALF-OPEN (now−24h, now]: excluded AT the boundary, included 1ms inside", () => {
  const at = Date.parse("2026-10-12T13:00:00Z");
  const res = (ms) => ({ kind: "reserve", id: `r${ms}`, ts: new Date(ms).toISOString() });

  assert.equal(inTrailing24hWindow(at - BUDGET_24H_MS, at, BUDGET_24H_MS), false, "exactly 24h old is OUT");
  assert.equal(inTrailing24hWindow(at - BUDGET_24H_MS + 1, at, BUDGET_24H_MS), true, "1ms inside is IN");
  assert.equal(inTrailing24hWindow(at + 1, at, BUDGET_24H_MS), false, "the FUTURE is out too (the window ends at `now`)");
  assert.equal(inTrailing24hWindow(at, at, BUDGET_24H_MS), true, "`now` itself is IN");

  assert.equal(ledgerReservationsInWindow([res(at - BUDGET_24H_MS)], at, BUDGET_24H_MS).count, 0, "reservation AT the boundary ⇒ excluded");
  assert.equal(ledgerReservationsInWindow([res(at - BUDGET_24H_MS + 1)], at, BUDGET_24H_MS).count, 1, "reservation 1ms inside ⇒ included");

  // ⛔ The SAME predicate governs the legacy carrier term — one boundary, not two.
  const line = (ms) => ({ kind: "scan-round", routine: DISCOVERY_METHOD_NAME, ts: new Date(ms).toISOString(), model_calls: 5 });
  assert.equal(modelCallsInWindow([line(at - BUDGET_24H_MS)], at, BUDGET_24H_MS), 0, "a legacy line AT the boundary ⇒ excluded");
  assert.equal(modelCallsInWindow([line(at - BUDGET_24H_MS + 1)], at, BUDGET_24H_MS), 5, "…and 1ms inside ⇒ included");
});

// ── AC1 (g): the three zero-reservation paths ────────────────────────────────────────────────────────
test("AC1(g) — enabled:false, halted and --no-model ⇒ ZERO reservations", async () => {
  // (i) the kill switch
  const disabled = makeWorkspace();
  writeConfig(disabled, "loop:\n  discovery_method:\n    enabled: false\n");
  const f1 = await runDiscoveryMethod(disabled, runOpts(disabled, { ingestFn: countingIngest() }));
  assert.equal(f1.state, "not-evaluated");
  assert.match(f1.reason, /disabled/);
  assert.equal(fs.existsSync(ledgerFile(disabled)), false, "enabled:false ⇒ the ledger is not even created");

  // (ii) halted
  const halted = makeWorkspace();
  writeConfig(halted, temporaryYaml(FUTURE_UNTIL, 24));
  const f2 = await runDiscoveryMethod(halted, runOpts(halted, { halted: true, ingestFn: countingIngest() }));
  assert.equal(f2.state, "not-evaluated");
  assert.match(f2.reason, /halted/);
  assert.equal(fs.existsSync(ledgerFile(halted)), false, "halted ⇒ zero reservations");

  // (iii) --no-model, through the REAL CLI. An empty store ⇒ the round completes with no calls;
  //       a populated store ⇒ it FAILS at the model seam. BOTH must reserve nothing.
  for (const [label, populate] of [["an empty store", false], ["a populated store", true]]) {
    const ws = makeWorkspace();
    writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 24));
    if (populate) writeFixtureStore(ws, FIXTURE_OUTCOMES);
    else fs.writeFileSync(path.join(ws, ".quay", "architecture-evidence-store.jsonl"), "", "utf8");
    const run = spawnSync(process.execPath, [ROUTINE_SRC, "--once", "--root", ws, "--no-model", "--force", "--json"], { encoding: "utf8", env: GIT_ENV });
    assert.equal(run.status, populate ? 1 : 0, `--no-model against ${label}: ${run.stdout} ${run.stderr}`);
    assert.equal(ledgerReserves(ws).length, 0, `--no-model reserves NOTHING (${label})`);
    assert.equal(fs.existsSync(ledgerFile(ws)), false, `--no-model never opens the ledger (${label})`);
  }
});

// ── AC1 (h): --force never bypasses the ceiling ──────────────────────────────────────────────────────
test("AC1(h) — a manual `--force` round at the cap is REFUSED; `--force` bypasses the GATE, not the BUDGET", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 24));
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  const at = Date.parse("2026-10-13T13:00:00Z");
  seedReservations(ws, 24, at - 60_000); // exactly at the cap
  const before = fs.existsSync(ledgerFile(ws)) ? fs.readFileSync(ledgerFile(ws), "utf8") : "";
  const ingest = countingIngest();

  const fact = await runDiscoveryMethod(ws, runOpts(ws, { invokedBy: INVOKED_BY_MANUAL, force: true, ingestFn: ingest, now: () => at }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /^budget-24h:/, "the refusal names its own cause, never «idle»");
  assert.match(fact.reason, /not idle/);
  assert.equal(fact.value.budget_24h.used, 24);
  assert.equal(fact.value.budget_24h.cap, 24);
  assert.equal(ingest.calls.length, 0, "⛔ ZERO spawns — `--force` is a DUE-gate flag and nothing else");
  assert.equal(fs.readFileSync(ledgerFile(ws), "utf8"), before, "and it granted nothing");

  // NON-VACUITY: the same round with cap 25 RUNS — so the refusal above was the ceiling and not
  // something else that happens to also produce `not-evaluated`.
  const ok = makeWorkspace();
  writeConfig(ok, temporaryYaml(FUTURE_UNTIL, 25));
  writeFixtureStore(ok, FIXTURE_OUTCOMES);
  seedReservations(ok, 24, at - 60_000);
  const ingest2 = countingIngest();
  const ran = await runDiscoveryMethod(ok, runOpts(ok, { invokedBy: INVOKED_BY_MANUAL, force: true, model: noMethodModel(), ingestFn: ingest2, now: () => at }));
  assert.equal(ran.state, "verified", `one under the cap ⇒ it runs: ${ran.reason}`);
  assert.equal(ingest2.calls.length, 1);
});

// ── AC1 (i): budget refusals never consume the window ────────────────────────────────────────────────
test("AC1(i) — a MID-ROUND budget refusal persists what was done but does NOT advance the production last-run", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 24));
  writeFixtureStore(ws, SIX_OUTCOMES);
  const at = Date.parse("2026-10-13T13:00:00Z");
  seedReservations(ws, 20, at - 60_000); // cap − used = 4, so the round's per-round cap is min(6, 4) = 4
  writeProductionLastRun(ws, at - 2 * 360 * 60_000); // due, and there IS an entry to prove it is not moved
  const lastRunBefore = fs.readFileSync(lastRunPath(ws), "utf8");
  const ledgerBefore = fs.readFileSync(ledgerFile(ws), "utf8");

  // ⛔ A CONCURRENT CONSUMER, forced deterministically: the seam spends the rest of the budget the
  // instant the round's first call lands. From there every further reservation is refused — which is
  // exactly the state a second process produces, without depending on a scheduler race.
  let calls = 0;
  const model = async () => {
    calls++;
    if (calls === 1) seedReservations(ws, 4, at - 1_000);
    return { stdout: JSON.stringify({ decision: "no-method" }) };
  };

  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now: () => at }));
  assert.equal(fact.state, "not-evaluated", `the round is cut short by the ceiling: ${fact.reason}`);
  assert.match(fact.reason, /^budget-24h:/);
  assert.match(fact.reason, /BUDGET_24H/);
  assert.equal(fact.value.reservations.mid_round_refusal.step, "reflection");
  assert.equal(fact.value.reservations.granted, 1, "the first call was granted");
  assert.equal(calls, 1, "the refused call was NEVER spawned");

  assert.equal(rounds(ws).length, 1, "⛔ the round still PERSISTS what it did");
  assert.equal(rounds(ws)[0].reservations.mid_round_refusal.step, "reflection");
  assert.equal(fs.readFileSync(lastRunPath(ws), "utf8"), lastRunBefore, "⛔ and it does NOT advance the production last-run");
  assert.notEqual(fs.readFileSync(ledgerFile(ws), "utf8"), ledgerBefore, "…while the calls it DID make are on the ledger");

  // The PRE-ROUND refusal behaves the same way (and is already covered by case (f) for the ceiling; here
  // the claim is only about the CLOCK).
  const pre = makeWorkspace();
  writeConfig(pre, temporaryYaml(FUTURE_UNTIL, 24));
  writeFixtureStore(pre, FIXTURE_OUTCOMES);
  seedReservations(pre, 24, at - 60_000);
  writeProductionLastRun(pre, at - 2 * 360 * 60_000);
  const preBefore = fs.readFileSync(lastRunPath(pre), "utf8");
  const f2 = await runDiscoveryMethod(pre, runOpts(pre, { ingestFn: countingIngest(), now: () => at }));
  assert.equal(f2.state, "not-evaluated");
  assert.equal(fs.readFileSync(lastRunPath(pre), "utf8"), preBefore, "a pre-round budget refusal leaves the clock alone too");
});

// ── AC1 (j): stale-lock recovery is bounded AND logged ───────────────────────────────────────────────
test("AC1(j) — a lock held by a DEAD pid is recovered at once; a merely OLD one after the bound; both LOGGED", async () => {
  const ws = makeWorkspace();
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });

  // A real process that has really exited.
  const exited = spawnSync(process.execPath, ["-e", ""]);
  const deadPid = exited.pid;
  assert.equal(pidAlive(deadPid), false, "the fixture pid is genuinely dead");
  fs.writeFileSync(lockFile(ws), JSON.stringify({ pid: deadPid, ts: new Date().toISOString(), token: "dead-holder" }), "utf8");

  const t = Date.now();
  const budget = openModelBudget({ root: ws, cap: 5, waitMs: 5_000 });
  const r = await budget.reserve({ step: "reflection", tools: REFLECTION_TOOLS, max_turns: REFLECTION_MAX_TURNS });
  const elapsed = Date.now() - t;
  assert.equal(r.ok, true, "a DEAD holder must not wedge the budget");
  assert.ok(elapsed < 2_000, `recovery from a dead holder is immediate, not after the ${BUDGET_LOCK_STALE_MS}ms bound (took ${elapsed}ms)`);
  assert.equal(fs.existsSync(lockFile(ws)), false, "…and the lock is released again");

  const recov = ledgerLines(ws).filter((l) => l.kind === "lock-recovered");
  assert.equal(recov.length, 1, "the recovery is LOGGED on the ledger, not only inferred");
  assert.equal(recov[0].reason, "holder-dead");
  assert.equal(recov[0].lock.pid, deadPid, "…and names the holder it reclaimed");
  assert.equal(typeof recov[0].waited_ms, "number");

  // (ii) a LIVE holder that is merely OLD (a recycled pid / a wedged shell / another host): recovered
  //      once the stated bound has elapsed, and logged with the OTHER reason.
  const ws2 = makeWorkspace();
  fs.mkdirSync(path.join(ws2, ".quay"), { recursive: true });
  fs.writeFileSync(lockFile(ws2), JSON.stringify({ pid: process.pid, ts: new Date(Date.now() - 60_000).toISOString(), token: "live-but-old" }), "utf8");
  const old = new Date(Date.now() - 5_000);
  fs.utimesSync(lockFile(ws2), old, old);
  const r2 = await openModelBudget({ root: ws2, cap: 5, staleMs: 1_000, waitMs: 5_000 }).reserve({ step: "reflection", tools: REFLECTION_TOOLS, max_turns: REFLECTION_MAX_TURNS });
  assert.equal(r2.ok, true, "an OLD lock is recovered once the bound has elapsed");
  assert.equal(ledgerLines(ws2).filter((l) => l.kind === "lock-recovered")[0].reason, "holder-stale");

  // (iii) BOUNDED: a LIVE, FRESH holder is NOT reclaimed — the acquisition gives up and says so, with a
  //       code of its OWN (`BUDGET_LOCK_TIMEOUT`), never shaped like «the budget is exhausted».
  const ws3 = makeWorkspace();
  fs.mkdirSync(path.join(ws3, ".quay"), { recursive: true });
  fs.writeFileSync(lockFile(ws3), JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token: "live-and-fresh" }), "utf8");
  const fail = await acquireBudgetLock(lockFile(ws3), { waitMs: 120, staleMs: 60_000, ledgerPath: ledgerFile(ws3) });
  assert.equal(fail.ok, false);
  assert.equal(fail.code, "BUDGET_LOCK_TIMEOUT");
  assert.match(fail.reason, /could not take/);
  assert.equal(fs.existsSync(lockFile(ws3)), true, "⛔ a live holder is NEVER stolen");
  await assert.rejects(
    () => openModelBudget({ root: ws3, cap: 5, waitMs: 120, staleMs: 60_000 }).reserve({ step: "reflection", tools: "", max_turns: 1 }),
    /BUDGET_LOCK_TIMEOUT/,
    "a lock we cannot take is its OWN refusal — NOT «you are out of budget»",
  );
});

// ── MIGRATION: the window is seeded at cut-over, never reset ─────────────────────────────────────────
test("MIGRATION — the ledger's trailing-24h total at cut-over EQUALS the carrier's trailing-24h model_calls sum", async () => {
  const ws = makeWorkspace();
  const at = Date.parse("2026-10-12T13:00:00Z");
  // The carrier AS THE PREVIOUS BUILD LEFT IT: plain `scan-round` lines, no `reservations` field.
  // (The 2026-10-12 14:59:56Z production round's 6 calls are the real instance of this shape.)
  const legacy = [
    scanRoundLine({ ts: new Date(at - 200 * 60_000).toISOString(), invokedBy: INVOKED_BY_RESIDENT, modelCalls: 6 }),
    scanRoundLine({ ts: new Date(at - 61 * 60_000).toISOString(), invokedBy: INVOKED_BY_RESIDENT, modelCalls: 0 }),
  ];
  writeCarrier(ws, legacy);

  const carrier = readCarrierRounds(carrierPath(ws)).records;
  const ledgerRecords = readLedgerRecords(ledgerFile(ws)).records;
  assert.deepEqual(ledgerRecords, [], "at cut-over the ledger is EMPTY — the whole point is that the window is not");

  const carrierSum = modelCallsInWindow(carrier, at, BUDGET_24H_MS);
  const usage = budgetUsage({ ledgerRecords, carrierRounds: carrier, nowMs: at, windowMs: BUDGET_24H_MS });
  assert.equal(carrierSum, 6, "the carrier's trailing-24h model_calls sum");
  assert.equal(usage.total, carrierSum, "⛔ the LEDGER's trailing-24h total EQUALS it — the cut-over does not reset the window");
  assert.equal(usage.reservations, 0);
  assert.equal(usage.legacy_model_calls, 6);

  // …and a round from THIS build is counted ONCE (by its reservations), never twice.
  const newLine = { kind: "scan-round", routine: DISCOVERY_METHOD_NAME, invoked_by: INVOKED_BY_RESIDENT, ts: new Date(at).toISOString(), model_calls: 2, reservations: { granted: 2 } };
  const u2 = budgetUsage({
    ledgerRecords: [
      { kind: "reserve", id: "new-a", ts: new Date(at - 2_000).toISOString() },
      { kind: "reserve", id: "new-b", ts: new Date(at - 1_000).toISOString() },
    ],
    carrierRounds: [...legacy, newLine],
    nowMs: at,
    windowMs: BUDGET_24H_MS,
  });
  assert.equal(u2.reservations, 2);
  assert.equal(u2.legacy_model_calls, 6, "⛔ the ledger-tracked line is SKIPPED by the carrier term — no double count");
  assert.equal(u2.total, 8);
});

// ── COUNTING SEMANTICS: what a counted call bounds, and the computable worst case ────────────────────
test("COUNTING SEMANTICS — one counted call = one subprocess; the turns inside it are bounded per step", () => {
  const p = seamParamsFor({ verifierMaxTurns: 12 });
  // ⛔ THE DEFAULT ARM NOW CARRIES TOOLS (task gap-discovery-method-per-round-quota-verify-reserve-deep-
  // reflection, Plan item 2): a reflection that cannot read the code it reflects on is a mechanical
  // summary-shuffler. The EMPTY-tools arm is still reachable and is asserted right below — it is the
  // baseline every measurement in that task is read against, and it is what keeps "one counted call = one
  // turn" true for the arm where that claim was originally made.
  assert.equal(p.reflection.tools, DEFAULT_REFLECTION_TOOLS);
  assert.equal(p.reflection.tools, "Read,Grep,Glob", "the reflection launcher reads code by default");
  assert.equal(p.reflection.maxTurns, DEFAULT_REFLECTION_MAX_TURNS, "…and gets an explicit turn budget for it");
  const base = seamParamsFor({ verifierMaxTurns: 12, reflectionTools: "" });
  assert.equal(base.reflection.tools, REFLECTION_TOOLS);
  assert.equal(base.reflection.tools, "", "the fallback arm gets NO tools");
  assert.equal(base.reflection.maxTurns, REFLECTION_MAX_TURNS);
  assert.equal(base.reflection.maxTurns, 1, "…so in THAT arm one counted call is exactly one turn");
  assert.equal(p.verification.tools, VERIFIER_TOOLS);
  assert.equal(p.verification.tools, "Read,Grep", "the verifier gets the bounded-verifier tool set");
  assert.equal(p.verification.maxTurns, 12, "…and an EXPLICIT turn budget from the config");
  assert.equal(seamParamsFor(null).verification.maxTurns, DEFAULT_VERIFIER_MAX_TURNS, "the default is stated, not implied");
  // ⛔ Turning code access ON must not raise the 24h worst case: the reflection turn default is kept ≤ the
  // verifier's, which is the whole reason it is stated as a constant rather than left implicit.
  assert.ok(DEFAULT_REFLECTION_MAX_TURNS <= DEFAULT_VERIFIER_MAX_TURNS);

  assert.equal(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m" }).config.verifierMaxTurns, DEFAULT_VERIFIER_MAX_TURNS);
  assert.equal(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", verifier_max_turns: 7 }).config.verifierMaxTurns, 7);
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", verifier_max_turns: 0 }).error, /must be an integer >= 1/);

  // The assembled WORST CASE, reported by the production entry (what the driver's assembly line prints).
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 24).replace("max_wall_ms: 900000", "max_wall_ms: 900000\n    verifier_max_turns: 7"));
  const assembled = discoveryMethodRoutineFromConfig(ws);
  assert.equal(assembled.verifierMaxTurns, 7);
  assert.equal(assembled.reflectionMaxTurns, DEFAULT_REFLECTION_MAX_TURNS);
  // ⛔ The product is cap × max(reflection turns, verifier turns), and with the verifier lowered to 7 the
  // REFLECTION budget (10) is now the larger term — the reading moves with the config instead of being
  // pinned to a remembered value. (With the DEFAULT verifier budget of 12 it is unchanged at cap × 12.)
  assert.equal(assembled.worstCaseTurns24h, 24 * Math.max(DEFAULT_REFLECTION_MAX_TURNS, 7), "cap × max(effective reflection turns, verifier turns)");
  const wsDef = makeWorkspace();
  writeConfig(wsDef, temporaryYaml(FUTURE_UNTIL, 24));
  assert.equal(discoveryMethodRoutineFromConfig(wsDef).worstCaseTurns24h, 24 * DEFAULT_VERIFIER_MAX_TURNS, "…and at the DEFAULT verifier budget the product is the verifier's, i.e. code access did not raise it");

  // ── the per-round values the assembly line must now REPORT (task ..., Plan item 4) ─────────────────
  const ws2 = makeWorkspace();
  // The values PRODUCTION carries after this task (`.quay/config.yml discovery_method`), so the assembly
  // line this case asserts is the one the reload will actually print.
  writeConfig(ws2, reserveYaml(240, 4)
    .replace("max_model_calls: 6", "max_model_calls: 16")
    .replace("max_experiences: 8", "max_experiences: 16")
    .replace("max_wall_ms: 900000", "max_wall_ms: 1200000"));
  const a2 = discoveryMethodRoutineFromConfig(ws2);
  assert.equal(a2.maxExperiences, 16);
  assert.equal(a2.maxModelCalls, 16);
  assert.equal(a2.verifyReserve, 4);
  assert.equal(a2.reflectionMaxModelCalls, 12, "reflection <= 16 − 4");
  assert.equal(a2.reflectionTools, DEFAULT_REFLECTION_TOOLS);
  assert.equal(a2.worstCaseTurns24h, 240 * DEFAULT_VERIFIER_MAX_TURNS, "240 is THIS routine's launcher-subprocess ceiling; the worst case is cap × verifier turns");

  // …and the driver's assembly line prints all of it (the reload's observable surface).
  const line = formatDiscoveryMethodAssembly(a2);
  assert.match(line, /max_model_calls=16 \(per round\)/);
  assert.match(line, /verify_reserve=4/);
  assert.match(line, /reflection <= 12/);
  assert.match(line, /reflection_tools="Read,Grep,Glob"/);
  assert.match(line, /reflection_max_turns=10/);
  assert.match(line, /max_wall_ms=1200000/);

  // A DISABLED section has nothing to report — the line says so and invents no numbers.
  const off = formatDiscoveryMethodAssembly({ ...a2, enabled: false });
  assert.match(off, /enabled:false/);
  assert.ok(!off.includes("verify_reserve"));
});

test("COUNTING SEMANTICS — a reservation records the launcher params AND the realized turns, or null WITH a reason", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 24));
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  // A stub that speaks the launcher's stream-json shape: `num_turns` is what the outcome line must carry.
  const model = async () => ({ stdout: `${JSON.stringify({ type: "result", subtype: "success", num_turns: 1, result: JSON.stringify({ decision: "no-method" }) })}\n` });
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now: () => ROUND_AT }));
  assert.equal(fact.state, "verified", fact.reason);

  const res = ledgerReserves(ws);
  const outs = ledgerOutcomes(ws);
  assert.equal(res.length, outs.length, "one outcome per reservation");
  assert.equal(res[0].step, "reflection");
  assert.equal(res[0].tools, DEFAULT_REFLECTION_TOOLS);
  assert.equal(res[0].max_turns, DEFAULT_REFLECTION_MAX_TURNS);
  assert.equal(outs[0].outcome, "completed");
  // ⛔ `max_turns` is the BOUND the launcher was given; the realized count is what the stream reported, and
  // the two are different quantities — a call that stops early must not be recorded as having used its cap.
  assert.equal(outs[0].turns, 1, "the realized turn count came off the stream, never substituted by the cap");

  // ⛔ TWO ways to be unreadable, and they are DIFFERENT reasons — never a silent 0, which would read as
  // «this call was free» (硬规则 3b):
  //   (i) a stream that PARSED but carried no `result` event (`num_turns` absent);
  //   (ii) stdout that is not a stream at all.
  const ws2 = makeWorkspace();
  writeConfig(ws2, temporaryYaml(FUTURE_UNTIL, 24));
  writeFixtureStore(ws2, FIXTURE_OUTCOMES);
  await runDiscoveryMethod(ws2, runOpts(ws2, { model: noMethodModel(), now: () => ROUND_AT }));
  const outs2 = ledgerOutcomes(ws2);
  assert.equal(outs2[0].turns, null);
  assert.equal(outs2[0].turns_reason, "STREAM_REPORTED_NO_NUM_TURNS", "a plain-JSON answer parses as a stream with no result event");

  const ws3 = makeWorkspace();
  writeConfig(ws3, temporaryYaml(FUTURE_UNTIL, 24));
  writeFixtureStore(ws3, FIXTURE_OUTCOMES);
  await runDiscoveryMethod(ws3, runOpts(ws3, { model: async () => ({ stdout: "no json here at all" }), now: () => ROUND_AT }));
  const outs3 = ledgerOutcomes(ws3);
  assert.equal(outs3[0].turns, null);
  assert.equal(outs3[0].turns_reason, "UNINSTRUMENTED_STREAM", "stdout that is not a stream at all is its OWN reason");
});

// ── the negative controls, as RUNNABLE code paths (each is applied by hand in a scratch copy) ────────
test("NEGATIVE-CONTROL SUPPORT — the seams the three controls mutate are reachable, and the (b) race is forced deterministically", async () => {
  // (b)'s race is not left to the scheduler: the child's critical section sleeps INSIDE the lock, and
  // the two delays DIFFER, so dropping the lock makes the slow child decide on a stale `used` after the
  // fast one has already spent the budget. This case proves the seam is real (a budget with an injected
  // lock uses it, not the real one) — the RED run itself is pasted in the task evidence.
  const ws = makeWorkspace();
  let acquired = 0;
  const stubLock = {
    acquire: async () => { acquired++; return { ok: true, release: () => {}, waitedMs: 0, recovered: [] }; },
  };
  const budget = openModelBudget({ root: ws, cap: 3, lock: stubLock });
  assert.equal((await budget.reserve({ step: "reflection", tools: "", max_turns: 1 })).ok, true);
  assert.equal(acquired, 1, "the injected lock is what guarded the critical section");
  assert.equal(fs.existsSync(lockFile(ws)), false, "…and the REAL lock file was never created");

  // (c)/(e)'s control moves the reservation AFTER the spawn; (a)'s restores the pre-round-only check.
  // Both are single-site edits, listed in the task evidence with their pasted RED output.
  assert.equal(ledgerReserves(ws).length, 1, "the reservation is written by `reserve()` — the one call site the control moves");
  assert.equal(typeof reservingModel, "function", "…and `reservingModel` is the seam whose order the control inverts");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection
//   AC (a) verify_reserve holds back calls + a minted candidate is validated in the SAME round
//   AC (b) verify_reserve > max_model_calls is a config error
//   AC (c) default config ⇒ reflection argv carries Read,Grep,Glob, the pin dir, --max-turns
//   AC (d) reflection_tools:"" ⇒ argv identical to today (--tools "") — the fallback/baseline arm
//   AC (e) a wall breach after k calls ⇒ k results persisted with partial:true, last-run not advanced,
//          all k calls on the 24h reservation ledger
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** A config with an explicit reflection/verify-reserve declaration, on the temporary 60m cadence. */
const reserveYaml = (cap, reserve, extra = "") =>
  temporaryYaml(FUTURE_UNTIL, cap).replace("max_wall_ms: 900000", `max_wall_ms: 900000\n    verify_reserve: ${reserve}${extra}`);

// ── AC (a), half 1: reflection STOPS at max_model_calls − verify_reserve (the real reflection engine) ─
test("AC(a) — verify_reserve holds reflection at max_model_calls − verify_reserve (real engine, 24h ledger)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, reserveYaml(240, 2)); // max_model_calls 6, verify_reserve 2 ⇒ reflection <= 4
  writeFixtureStore(ws, SIX_OUTCOMES);  // six distinct units ⇒ six calls if unbounded

  const model = noMethodModel();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now: () => ROUND_AT }));
  assert.equal(fact.state, "verified", fact.reason);

  assert.equal(model.calls.length, 4, "⛔ reflection stops at 6 − 2 = 4: the reserve is never spent on reflection");
  const line = rounds(ws)[0];
  assert.equal(line.reflected.model_calls, 4);
  assert.equal(line.reflected.skipped_budget, 2, "the engine's own budget loop reports the other 2 as skipped");
  assert.equal(line.reservations.requested_max_model_calls, 6, "the round's request is still 6 …");
  assert.equal(line.reservations.reflection_max_model_calls, 4, "… and the REFLECTION share is 6 − verify_reserve");
  assert.equal(line.reservations.verify_reserve, 2);
  assert.equal(line.reservations.effective_max_model_calls, 6, "generalization's bound is the WHOLE per-round budget, so it gets the reserve back");
  // Every counted call is on the ledger — and every one of them is a REFLECTION call (nothing was minted).
  const reserves = ledgerReserves(ws);
  assert.equal(reserves.length, 4);
  assert.ok(reserves.every((r) => r.step === "reflection"), "the reserve was NOT consumed by this round's reflection");
});

// ── AC (a), half 2: a candidate minted on reflection's last allowed call is VALIDATED in the SAME round ─
test("AC(a) — a candidate minted on reflection's LAST allowed call is validated in the SAME round", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, reserveYaml(240, 2));
  writeFixtureStore(ws, FIXTURE_OUTCOMES);

  // ⛔ A reflection round that SPENDS ITS WHOLE HANDED BUDGET and mints a candidate on its last allowed
  // call — the shape the real engine produces when the model answers `new` on the final call it is
  // permitted. Spending the whole budget is what makes this case REFUTABLE: with `verify_reserve: 0` the
  // round's shared counter is already at its per-round bound when generalization starts, so the candidate
  // is never tested (the negative control in the task evidence runs exactly this, twice).
  const seen = {};
  const reflect = async (root, opts) => {
    seen.reflectionBudget = opts.budget.maxModelCalls;
    const n = seen.reflectionBudget;
    return {
      ok: true,
      decisions: Array.from({ length: n }, (_, i) => ({
        signature: `sig-${i}`, ok: true,
        decision: i === n - 1 ? "new" : "no-method",
        candidate: i === n - 1 ? { method_id: "m-one", version: 1, status: "draft" } : null,
        model_call: { usage: null, cost_usd: null },
      })),
      model_calls: n,
      skipped_budget: 0,
      wall_ms: 1,
      selection: { units_evaluated: n, batch_size: n, skipped_prior: 0, skipped_cap: 0, merged_within_batch: 0 },
    };
  };
  const heldOut = async () => ({ ok: true, cases: [{ case_id: "h1", evaluation_pin: "deadbeef" }], reason: null, malformed_lines: 0 });
  const seenVerifications = [];
  const validate = async (a) => {
    seenVerifications.push(a);
    return { outcome: "not-applicable", applies: "no", model_call: { usage: null, cost_usd: null } };
  };
  const fact = await runDiscoveryMethod(ws, runOpts(ws, {
    reflectFn: reflect,
    heldOutFn: heldOut,
    pinFn: () => ({ ok: true, dir: "/tmp/dm-stub-pin" }),
    validateFn: validate,
    appendFn: () => ({ ok: true, reasons: [] }),
    now: () => ROUND_AT,
  }));

  assert.equal(fact.state, "verified", fact.reason);
  // ⛔ THE POINT, ASSERTED FIRST: reflection spent its WHOLE share (4 of the round's 6), and the candidate
  // it minted was STILL verified — in the round that minted it. Before the reserve, a reflection round
  // that spent its whole quota left the verifier with nothing, so a candidate could never be tested by the
  // round that produced it. (Setting `verify_reserve: 0` in this fixture is the task's negative control:
  // reflection is handed 6, spends 6, and THIS assertion is the one that goes red.)
  assert.equal(seenVerifications.length, 1, "the candidate minted by THIS round was validated IN THIS round");
  assert.equal(seen.reflectionBudget, 4, "reflection is handed 6 − 2, not 6");
  assert.equal(fact.value.model_calls, 5, "4 reflection + 1 verification — the reserve is what paid for the fifth");
  assert.equal(seenVerifications[0].candidate.method_id, "m-one");
  assert.equal(seenVerifications[0].pinDir, "/tmp/dm-stub-pin");
  assert.equal(fact.value.verdicts.total, 1);
});

// ── AC (b): a reserve larger than the round's own request is a CONFIG ERROR (zero spawns) ─────────────
test("AC(b) — verify_reserve > max_model_calls is a config error, and the round spawns nothing", async () => {
  const parsed = parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", max_model_calls: 3, verify_reserve: 4 });
  assert.equal(parsed.config, null, "a reserve larger than the request is REFUSED, never clamped");
  assert.match(parsed.error, /'verify_reserve' \(4\) must be <= 'max_model_calls' \(3\)/);
  // …and the boundary is ACCEPTED (reserve == request ⇒ reflection gets 0, which is a legal declaration).
  const boundary = parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", max_model_calls: 3, verify_reserve: 3 });
  assert.equal(boundary.error, null);
  assert.equal(boundary.config.verifyReserve, 3);
  // Shape gates: a negative / non-integer reserve is its own refusal.
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", verify_reserve: -1 }).error, /must be an integer >= 0/);
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", verify_reserve: 1.5 }).error, /must be an integer >= 0/);

  // Through the ROUND: the malformed section is `failed` with ZERO spawns and no carrier line.
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML.replace("max_model_calls: 6", "max_model_calls: 3\n    verify_reserve: 4"));
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  const model = noMethodModel();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now: () => ROUND_AT }));
  assert.equal(fact.state, "failed");
  assert.match(fact.reason, /verify_reserve.*must be <= 'max_model_calls'/);
  assert.equal(model.calls.length, 0, "a bad declaration must never be read as a licence to spend");
  assert.equal(fs.existsSync(carrierPath(ws)), false, "nothing is appended");
});

// ── AC (c): the DEFAULT config's reflection launcher argv carries the tools, the pin and the turns ────
test("AC(c) — default config ⇒ reflection argv carries Read,Grep,Glob, the pin dir AND --max-turns <reflection_max_turns>", () => {
  const cfg = parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m" }).config;
  assert.equal(cfg.reflectionTools, DEFAULT_REFLECTION_TOOLS);
  assert.equal(cfg.reflectionTools, "Read,Grep,Glob", "code access is ON by default (SEMANTIC FIRST)");
  assert.equal(cfg.reflectionMaxTurns, DEFAULT_REFLECTION_MAX_TURNS);

  const seam = seamParamsFor(cfg).reflection;
  const stubLaunchArgv = (role, prompt, root, opts) => ["claude", "-n", role, ...(opts.promptViaStdin === true ? ["-p"] : ["-p", prompt])];
  const PIN = "/tmp/dm-reflection-pin-abc123";
  const argv = reflectionLaunchArgv({ launchArgv: stubLaunchArgv, prompt: "P", root: "/r", tools: seam.tools, maxTurns: seam.maxTurns, pinDir: PIN, outputFormat: "stream-json" });

  const val = (flag) => argv[argv.indexOf(flag) + 1];
  assert.equal(val("--tools"), "Read,Grep,Glob", "the reflection launcher carries the read set");
  assert.equal(val("--max-turns"), String(DEFAULT_REFLECTION_MAX_TURNS), "…and an EXPLICIT turn budget");
  assert.equal(val("--add-dir"), PIN, "…and the pin dir it may read");
  assert.equal(argv[argv.length - 1], "-p", "the pin is inserted BEFORE the trailing prompt flag");
  assert.equal(argv.filter((t) => t === "--add-dir").length, 1);
  // ⛔ The prompt NAMES the tree, or the tools are decorative: the routine renders codeAccess from the
  // SAME pin. (Asserted here as the prompt-level half of the same wiring.)
  const prompt = buildReflectionPrompt({ unit: { signature: "s", experiences: [] }, registry: [], toolNames: [], codeAccess: { tools: seam.tools, pinDir: PIN } });
  assert.ok(prompt.includes(PIN), "the prompt names the pinned tree the launcher was given");
  assert.match(prompt, /Do NOT turn this into a scan/, "…and it is still a semantic question, never a scan recipe");
  assert.ok(!buildReflectionPrompt({ unit: { signature: "s", experiences: [] }, registry: [], toolNames: [] }).includes(PIN), "no codeAccess ⇒ no tree in the prompt");
});

// ── AC (d): reflection_tools:"" ⇒ the launcher argv is IDENTICAL to the pre-change one ───────────────
test("AC(d) — reflection_tools:\"\" ⇒ argv byte-identical to the pre-change launcher (--tools \"\"), no pin, one turn", () => {
  const cfg = parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", reflection_tools: "" }).config;
  assert.equal(cfg.reflectionTools, "");
  const seam = seamParamsFor(cfg).reflection;
  assert.equal(seam.tools, "");
  assert.equal(seam.maxTurns, REFLECTION_MAX_TURNS, "with no tools there is nothing to iterate on ⇒ ONE turn");
  assert.equal(seam.maxTurns, 1);

  const stubLaunchArgv = (role, prompt, root, opts) => ["claude", "-n", role, ...(opts.promptViaStdin === true ? ["-p"] : ["-p", prompt])];
  const argv = reflectionLaunchArgv({ launchArgv: stubLaunchArgv, prompt: "P", root: "/r", tools: seam.tools, maxTurns: seam.maxTurns, pinDir: null, outputFormat: "stream-json" });
  // The BASELINE is built by the PRE-CHANGE construction itself (hardenedArgv with the old parameters) —
  // not by a hand-written literal, which could drift with it.
  const baseline = hardenedArgv(stubLaunchArgv, "P", "/r", { tools: "", maxTurns: 1, outputFormat: "stream-json" });
  assert.deepEqual(argv, baseline, "the fallback arm's argv is EXACTLY what the launcher ran with before this task");
  assert.ok(!argv.includes("--add-dir"), "the baseline arm is given no tree at all");
  // A non-string declaration is refused rather than silently selecting the baseline arm.
  const bad = parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m", reflection_tools: false });
  assert.equal(bad.config, null);
  assert.match(bad.error, /'reflection_tools' must be a string/);
});

// ── AC (e): a wall breach after k calls PERSISTS k results, marked partial, and advances nothing ─────
test("AC(e) — a wall breach after k calls persists k results with partial:true, does NOT advance last-run, keeps all k calls on the 24h ledger", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, reserveYaml(240, 2));
  writeFixtureStore(ws, SIX_OUTCOMES);

  // The clock jumps 10 minutes INSIDE each model call, and the round's wall budget is 5 minutes: the
  // post-INGEST check is clean (nothing has been spent yet), the post-REFLECTION check fires. k = 4
  // (6 − verify_reserve 2) — deterministic, and it exercises the real wall check rather than a mock.
  let tNow = ROUND_AT;
  const model = async () => { tNow += 10 * 60_000; return { stdout: JSON.stringify({ decision: "no-method" }) }; };
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { model, now: () => tNow }));

  assert.equal(fact.state, "failed");
  assert.match(fact.reason, /budget breach/);
  assert.match(fact.reason, /persisted 1 PARTIAL scan-round line/);

  const lines = rounds(ws);
  assert.equal(lines.length, 1, "the partial round IS persisted — the results of its spent calls are not thrown away");
  const line = lines[0];
  assert.equal(line.partial, true);
  assert.equal(line.partial_reason, "BUDGET_MAX_WALL_MS:after-reflection");
  assert.equal(line.reflected.model_calls, 4, "k = 4 completed calls");
  // ⛔ `decisions` is the BATCH the engine walked (one row per unit, skipped ones included) — not the call
  // count. The two are different quantities and the partial line carries both.
  assert.equal(line.reflected.decisions, SIX_OUTCOMES.length);
  assert.equal(line.reflected.skipped_budget, 2);
  assert.equal(line.model_calls, 4);
  assert.equal(line.reservations.granted, 4);
  assert.equal(line.reservations.reflection_max_model_calls, 4);

  assert.equal(readLastRunMap(lastRunPath(ws))[DISCOVERY_METHOD_NAME], undefined, "last-run must NOT advance");
  assert.equal(latestResidentRoundTs(lines), null, "⛔ the partial line is NOT production's clock — otherwise the retry would never be due");

  const reserves = ledgerReserves(ws);
  assert.equal(reserves.length, 4, "all k calls are present in the 24h reservation ledger");
  assert.equal(ledgerOutcomes(ws).length, 4);
  assert.ok(reserves.every((r) => r.step === "reflection"));

  // …and the NEXT round IS due (the units this one never reached get retried). The watermark advanced, so
  // round 2 ingests 0 and makes 0 calls — what is asserted is the DUE GATE, which is the whole point of
  // not advancing the last-run.
  const r2 = await runDiscoveryMethod(ws, runOpts(ws, { model: noMethodModel(), now: () => ROUND_AT + 90 * 60_000 }));
  assert.equal(r2.state, "verified", `the round after a partial one must still be DUE: ${r2.reason}`);
  assert.equal(rounds(ws).length, 2);
  assert.equal(rounds(ws)[1].ingested.experiences, 0);
});

// ── the k = 0 boundary: a breach before ANY call still appends nothing (nothing to persist) ─────────
test("AC(e) boundary — a wall breach with ZERO completed calls appends nothing, exactly as before", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  discovery_method:\n    enabled: true\n    interval: interval:360m\n    max_wall_ms: 1\n");
  writeFixtureStore(ws, FIXTURE_OUTCOMES);
  fs.writeFileSync(carrierPath(ws), JSON.stringify({ kind: "scan-round", routine: DISCOVERY_METHOD_NAME, seed: true }) + "\n", "utf8");
  const before = fs.readFileSync(carrierPath(ws), "utf8");
  let t = Date.parse("2026-10-12T00:00:00Z");
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { now: () => { t += 1000; return t; } }));
  assert.equal(fact.state, "failed");
  assert.match(fact.reason, /nothing appended/);
  assert.equal(fs.readFileSync(carrierPath(ws), "utf8"), before, "a breach with nothing produced persists nothing");
});

// ── the factory seam is the ONE place that knows the reflection pin (found by a live round) ──────────
test("a round that gets its seams from `modelFactory` NAMES the reflection pin in the prompt and records it on the carrier", async () => {
  // ⛔ THE DEFECT THIS PINS (observed on a real 2026-10-12 round): the `--once` CLI built its two
  // launchers ITSELF instead of going through `modelFactory`, so the round never saw the reflection pin
  // — the carrier said `reflection_launcher: null`, and the prompt named no tree while the launcher had
  // been given `Read,Grep,Glob`. Tools the model is not told about are decorative, and its cwd is the
  // LIVE checkout, so "read code" would have read the moving tree rather than the pin. The pin below is
  // a real directory so the assertion is about the value the prompt receives, not a placeholder.
  const ws = makeWorkspace();
  writeConfig(ws, temporaryYaml(FUTURE_UNTIL, 240).replace("max_model_calls: 6", "max_model_calls: 6\n    verify_reserve: 2"));
  writeFixtureStore(ws, FIXTURE_OUTCOMES);

  const PIN_DIR = tmpDir("dm-reflect-pin-test-");
  const seen = [];
  const reflectFn = async (root, opts) => {
    seen.push(opts.codeAccess);
    return {
      ok: true,
      decisions: [{ signature: "sig-1", ok: true, decision: "no-method", candidate: null, model_call: { usage: null, cost_usd: null } }],
      model_calls: 1, skipped_budget: 0, wall_ms: 1,
      selection: { units_evaluated: 1, batch_size: 1, skipped_prior: 0, skipped_cap: 0, merged_within_batch: 0 },
    };
  };
  const fact = await runDiscoveryMethod(ws, runOpts(ws, {
    reflectFn,
    modelFactory: async () => ({
      ok: true,
      model: async () => ({ stdout: "{}" }),
      verifierModel: async () => ({ stdout: "{}" }),
      modelId: "stub-model",
      reflectionPin: { rev: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", dir: PIN_DIR },
    }),
    now: () => ROUND_AT,
  }));
  assert.equal(fact.state, "verified", fact.reason);

  // (1) the PROMPT was told which tree the tools may read — the absolute path, not the carrier's relative one.
  assert.deepEqual(seen.length, 1, "the reflection step ran once");
  assert.equal(seen[0].pinDir, PIN_DIR, "⛔ the prompt NAMES the pinned tree the launcher was given");
  assert.equal(seen[0].tools, DEFAULT_REFLECTION_TOOLS);
  const prompt = buildReflectionPrompt({ unit: { signature: "s", experiences: [] }, registry: [], toolNames: [], codeAccess: seen[0] });
  assert.ok(prompt.includes(PIN_DIR));

  // (2) the carrier records what the launcher ran with, so "reflection could read the code" is a READING.
  const line = rounds(ws)[0];
  assert.equal(line.reflection_launcher.tools, DEFAULT_REFLECTION_TOOLS);
  assert.equal(line.reflection_launcher.max_turns, DEFAULT_REFLECTION_MAX_TURNS);
  assert.equal(line.reflection_launcher.pin.rev, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  assert.equal(line.reflection_launcher.pin.dir, path.relative(ws, PIN_DIR), "the carrier path is repo-relative; the prompt's is absolute");
  assert.equal(line.model_id, "stub-model");

  // ⛔ The INJECTED-seam case is its own reading: no launcher was built, so the carrier says `null` rather
  // than printing the config's INTENT as if it were a measurement.
  const ws2 = makeWorkspace();
  writeConfig(ws2, temporaryYaml(FUTURE_UNTIL, 240));
  writeFixtureStore(ws2, FIXTURE_OUTCOMES);
  const f2 = await runDiscoveryMethod(ws2, runOpts(ws2, { reflectFn: reflectStub(), now: () => ROUND_AT }));
  assert.equal(f2.state, "verified", f2.reason);
  assert.equal(rounds(ws2)[0].reflection_launcher, null, "an injected seam never went through a launcher ⇒ the block is null, not a config echo");
  assert.equal(rounds(ws2)[0].model_id, null);
});
