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
// Run: scripts/test.sh plugin/test/discovery-method-routine.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DISCOVERY_METHOD_NAME,
  CARRIER_REL,
  MIN_INTERVAL_MINUTES,
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
} from "../scripts/discovery-method-routine.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "../scripts/probe-routine.ts";
import { appendOutcomeRecord } from "../../docs/analysis/architecture-evidence-store.mjs";

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
  assert.match(parseDiscoveryMethodSection({ enabled: true, interval: "interval:5m" }).error, /below the 360m floor/, "an interval under the floor is refused");
  const ok = parseDiscoveryMethodSection({ enabled: true, interval: "interval:360m" });
  assert.equal(ok.error, null);
  assert.equal(ok.config.trigger.minutes, MIN_INTERVAL_MINUTES, "exactly the floor is accepted");
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
  fs.writeFileSync(lastRunPath(ws), JSON.stringify({ [DISCOVERY_METHOD_NAME]: Date.now() }), "utf8");
  const ingest = countingIngest();
  const fact = await runDiscoveryMethod(ws, runOpts(ws, { ingestFn: ingest }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not due/);
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
 *  routines' entries that must survive every write untouched. */
function writeProductionLastRun(ws, discoveryMethodTs) {
  fs.writeFileSync(lastRunPath(ws), JSON.stringify({ [DISCOVERY_METHOD_NAME]: discoveryMethodTs, ...OTHER_ROUTINE_KEYS }, null, 1), "utf8");
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
  assert.deepEqual(
    Object.fromEntries(Object.entries(after).filter(([k]) => k !== DISCOVERY_METHOD_NAME)),
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
  assert.match(c.error, /below the 360m floor/);
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
