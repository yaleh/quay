// @test-group engine
// resource-anomaly-detector.test.mjs — the Quality continuous resource diagnostic
// (task gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic).
//
// Coverage map (task ACs):
//   AC1 — a fixture unified-record history with a planted watchdog-class anomaly is flagged by the
//         MECHANICAL pass with ZERO model calls (measured: the budget ledger is counted around the
//         pass, so `reservations_delta === 0` is a reading, not a constant). Negative control: a
//         fixture with the same file in a stable shape flags NOTHING.
//   AC2 — the SAME planted anomaly recurring across 3 fixture rounds is ONE Finding, not three: the
//         identity key (the EXISTING `conceptKeyOfCluster`) folds 3 readings into 1, and a SECOND
//         pass over the same signal appends nothing.
//   AC3 — the Finding reaches the EXISTING verifier/refuter (the engine's own `clustersFromAnomalySeeds`
//         + two `runVerifier` passes) and, on confirmation, files through the ABI with the EXISTING
//         mechanism dedup active; an already-filed subject is NOT re-filed.
//   AC4 — the post-merge effect re-test compares the SAME metric by the SAME method before/after a
//         fixture "fix", and says `restored` / `still-anomalous` / `not-evaluated` distinctly.
//   AC5 — scripts/test.sh --for-task <this task> green.
//
// Run:
//   scripts/test.sh plugin/test/resource-anomaly-detector.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CARRIER_REL,
  BUDGET_LEDGER_REL,
  RESOURCE_DIAGNOSTIC_NAME,
  ANOMALY_CLASSES,
  detectResourceAnomalies,
  detectWatchdogShifts,
  detectLongTail,
  detectOomKills,
  detectLeakedProcesses,
  detectRepeatExpensive,
  anomalyConceptKey,
  anomalyToSeed,
  anomalyTaskId,
  renderAnomalyTaskBody,
  foldAnomalies,
  effectRetest,
  routeAnomaly,
  resolveConceptKeyOf,
  readCarrierRecords,
  appendCarrierRecords,
  countReservations,
  openResourceBudget,
  parseResourceDiagnosticSection,
  runResourceDiagnostic,
  buildResourceDiagnosticRoutine,
} from "../scripts/resource-anomaly-detector.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const DETECTOR = path.join(REPO_ROOT, "plugin", "scripts", "resource-anomaly-detector.ts");
const ENGINE = path.join(REPO_ROOT, "docs", "analysis", "arch-hypothesis-generation.mjs");

const tmpdirs = [];
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => { for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true }); });

const writeJsonl = (p, rows) => fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
const round = (commit, file, durations) => ({
  commit,
  perFile: durations.map(([durationMs, passed]) => ({ file, durationMs, passed })),
});

// ── AC1: the mechanical pass flags a planted watchdog anomaly, with ZERO model calls ─────────────
test("AC1 — a planted watchdog-class shape shift is flagged by the mechanical pass, zero reservations", async () => {
  const tmp = mkTmp("rad-ac1-");
  const rounds = path.join(tmp, "rounds.jsonl");
  writeJsonl(rounds, [
    round("c1", "plugin/test/foo.test.mjs", [[1800, true], [1900, true], [1700, true]]),
    round("c2", "plugin/test/foo.test.mjs", [[60000, false], [61000, false], [60500, false]]),
  ]);
  const r = spawnSync(process.execPath, [
    "--experimental-strip-types", DETECTOR,
    "--rounds", rounds, "--root", tmp, "--no-carrier", "--json",
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, `CLI must exit 0 (stderr: ${r.stderr})`);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.anomalies, 1, "exactly one mechanical anomaly reading");
  assert.deepEqual(out.classes, ["watchdog-shape-shift"]);
  assert.equal(out.fresh, 1);
  assert.equal(out.reservations_delta, 0, "⛔ the MECHANICAL pass must make ZERO budget reservations (measured, not asserted)");
  assert.equal(out.reservations_before, 0);
  assert.equal(out.concept_key_module !== null, true, "the identity key must be resolved from the landed ledger module");

  // NEGATIVE CONTROL: the same file, same commit, stable shape ⇒ NOTHING is flagged.
  const stable = path.join(tmp, "stable.jsonl");
  writeJsonl(stable, [
    round("c1", "plugin/test/foo.test.mjs", [[1800, true], [1900, true], [1700, true]]),
    round("c2", "plugin/test/foo.test.mjs", [[1850, true], [1800, true], [1900, true]]),
  ]);
  const c = spawnSync(process.execPath, [
    "--experimental-strip-types", DETECTOR, "--rounds", stable, "--root", tmp, "--no-carrier", "--json",
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(c.status, 0);
  const cout = JSON.parse(c.stdout.trim().split("\n").pop());
  assert.equal(cout.anomalies, 0, "negative control: a stable shape flags nothing");
  assert.equal(cout.classes.length, 0);
  assert.equal(cout.reservations_delta, 0);
});

test("AC1 — the pure detectors are pure (no ledger, no spawn) and the class list is complete", () => {
  assert.deepEqual([...ANOMALY_CLASSES], ["watchdog-shape-shift", "long-tail-duration", "oom-kill", "leaked-process", "repeat-expensive-experiment"]);
  const rounds = [
    { commit: "c1", perFile: [{ file: "a.test.mjs", durationMs: 1000, passed: true }], oomKill: 2, leakedProcesses: [{ pid: 7, cmdline: "node x" }] },
    { commit: "c2", perFile: [{ file: "a.test.mjs", durationMs: 900, passed: true }] },
  ];
  assert.equal(detectOomKills(rounds).length, 1);
  assert.equal(detectLeakedProcesses(rounds).length, 1);
  assert.equal(detectWatchdogShifts(rounds).length, 0);
  assert.equal(detectLongTail(rounds).length, 0, "fewer observations than the minimum ⇒ nothing (⛔ an absent history is not a tail)");
  assert.equal(detectRepeatExpensive([{ experimentId: "E1", durationMs: 900_000, resumedFromCheckpoint: false, checkpointAvailable: true }]).length, 1);
  assert.equal(detectRepeatExpensive([{ experimentId: "E1", durationMs: 900_000, resumedFromCheckpoint: true, checkpointAvailable: true }]).length, 0);
  assert.equal(detectOomKills([{ oomKill: "unknown", notEvaluated: null }]).length, 0, "⛔ 'unknown' is not a positive OOM reading");
});

// ── AC2: the SAME anomaly across 3 fixture rounds is ONE Finding ─────────────────────────────────
test("AC2 — the same anomaly recurring 3 times is exactly ONE identity-keyed Finding, not three", async () => {
  const tmp = mkTmp("rad-ac2-");
  const rounds = path.join(tmp, "rounds.jsonl");
  // THREE successive commit boundaries, each with the same pass→fail/duration shift for ONE file.
  writeJsonl(rounds, [
    round("c1", "plugin/test/foo.test.mjs", [[1800, true], [1850, true]]),
    round("c2", "plugin/test/foo.test.mjs", [[60000, false], [60500, false]]),
    round("c3", "plugin/test/foo.test.mjs", [[61000, false], [60000, false]]),
    round("c4", "plugin/test/foo.test.mjs", [[61500, false], [61000, false]]),
  ]);
  const carrier = path.join(tmp, "carrier.jsonl");
  const runOnce = () => spawnSync(process.execPath, [
    "--experimental-strip-types", DETECTOR, "--rounds", rounds, "--root", tmp, "--carrier", carrier, "--json",
  ], { encoding: "utf8", timeout: 120_000 });
  const r1 = runOnce();
  assert.equal(r1.status, 0, r1.stderr);
  const o1 = JSON.parse(r1.stdout.trim().split("\n").pop());
  assert.ok(o1.anomalies >= 2, `the pass emitted several readings of the SAME anomaly (got ${o1.anomalies})`);
  assert.equal(o1.distinct_concept_keys, 1, "all readings carry the SAME identity key");
  assert.equal(o1.keyed, o1.anomalies, "every reading is keyed");
  assert.equal(o1.fresh, 1, "⛔ three readings ⇒ ONE Finding");
  assert.equal(o1.repeated, o1.anomalies - 1);
  assert.equal(o1.appended, 2, "exactly ONE anomaly line + one scan-round line");

  // SECOND pass over the SAME signal ⇒ nothing new is appended (the fold is durable).
  const r2 = runOnce();
  const o2 = JSON.parse(r2.stdout.trim().split("\n").pop());
  assert.equal(o2.fresh, 0, "the recurrence is not a new Finding");
  assert.equal(o2.repeated, o2.anomalies);
  assert.equal(o2.appended, 1, "only the scan-round line");
  const lines = readCarrierRecords(carrier).records.filter((x) => x.kind === "anomaly");
  assert.equal(lines.length, 1, "⛔ exactly ONE Finding line after two passes over the same signal");
  assert.match(lines[0].concept_key, /^resource-watchdog-shape-shift\|plugin\/test\/foo\.test\.mjs$/);
  const scans = readCarrierRecords(carrier).records.filter((x) => x.kind === "scan-round");
  assert.equal(scans.length, 2, "each pass leaves one scan-round line recording its own readings");
  assert.equal(scans[1].repeated, o2.anomalies, "the recurrence is visible on the scan-round line");
});

// ── AC3: existing verifier/refuter + existing mechanism dedup ────────────────────────────────────
test("AC3 — clustersFromAnomalySeeds (the engine's own adapter) refuses a subject-less seed", async () => {
  const { clustersFromAnomalySeeds, SEED_WITHOUT_SUBJECT } = await import(pathToFileURL(ENGINE).href);
  assert.deepEqual(clustersFromAnomalySeeds([]), [], "an empty seed set is a legitimate no-op");
  assert.equal(clustersFromAnomalySeeds([{ concept_kind: "k", components: ["a.ts"] }])[0].rep.comps[0], "a.ts");
  // ⛔ A seed with no subject is REFUSED by name — never silently skipped (硬规则 3b).
  assert.throws(() => clustersFromAnomalySeeds([{ concept_kind: "k", components: [] }]), new RegExp(SEED_WITHOUT_SUBJECT));
  assert.throws(() => clustersFromAnomalySeeds([{ components: ["a.ts"] }]), new RegExp(SEED_WITHOUT_SUBJECT));
});

test("AC3 — the Finding reaches the EXISTING verifier/refuter and files via the ABI, dedup suppressed", async () => {
  const { clustersFromAnomalySeeds } = await import(pathToFileURL(ENGINE).href);
  const tmp = mkTmp("rad-ac3-");
  const calls = { verify: 0, refute: 0, created: [] };

  const deps = {
    verify: async (clusters) => {
      calls.verify++;
      // the cluster handed over IS the shape the existing `runVerifier` consumes
      assert.equal(clusters.length, 1);
      assert.equal(clusters[0].rep.concept_kind, "resource-watchdog-shape-shift");
      assert.deepEqual(clusters[0].rep.comps, ["foo.test.mjs"]);
      assert.deepEqual(clusters[0].members, ["seed:1"]);
      assert.ok(String(clusters[0].rep.claim).length > 0);
      return { results: [{ cluster: 1, verdict: "supported" }] };
    },
    refute: async () => { calls.refute++; return { results: [{ cluster: 1, verdict: "supported" }] }; },
    clustersFromAnomalySeeds: (seeds) => clustersFromAnomalySeeds(seeds),
    refutationPromptFor: (evidence) => `REFUTE: ${JSON.stringify(evidence)}`,
    verifierPrompt: "VERIFY {{HYP}}",
    existingKeys: [],
    createTask: async (root, id, title, labels, body) => { calls.created.push({ id, title, labels, body }); },
  };

  const [a] = detectResourceAnomalies({
    rounds: [
      round("c1", "plugin/test/foo.test.mjs", [[1800, true], [1850, true]]),
      round("c2", "plugin/test/foo.test.mjs", [[60000, false], [60500, false]]),
    ],
  });
  const ck = await resolveConceptKeyOf(REPO_ROOT);
  assert.equal(ck.error, null, `the existing ledger module must resolve (${ck.error})`);

  const ok = await routeAnomaly(tmp, a, 1, deps, ck.conceptKeyOf);
  assert.equal(calls.verify, 1, "exactly one verifier pass");
  assert.equal(calls.refute, 1, "exactly one INDEPENDENT refuter pass");
  assert.equal(ok.confirmed, true);
  assert.equal(ok.filed, true);
  assert.match(ok.task_id, /^gap-routine-resource-/);
  assert.equal(calls.created.length, 1);
  assert.match(calls.created[0].body, /## Finding/);
  assert.match(calls.created[0].body, /观测符号/);

  // ⛔ THE DEDUP CONTROL: the SAME mechanical signal, already on the board ⇒ NOT re-filed.
  const { findingKey } = await import("../scripts/routine-file-gate.ts");
  const key = findingKey(calls.created[0].body);
  const dupDeps = { ...deps, existingKeys: [key] };
  const dup = await routeAnomaly(tmp, a, 2, dupDeps, ck.conceptKeyOf);
  assert.equal(dup.confirmed, true, "confirmation is independent of the dedup gate");
  assert.equal(dup.filed, false, "⛔ an already-filed subject is NOT re-filed");
  assert.match(dup.gate_reason, /^dedup:/, "the suppression NAMES the holder (硬规则 3: 枚举不布尔)");
  assert.equal(calls.created.length, 1, "no second ABI task was created");

  // A refuter that does not let it through ⇒ confirmed:false, nothing filed.
  const refuseDeps = { ...deps, refute: async () => ({ results: [{ cluster: 1, verdict: "refuted" }] }) };
  const refused = await routeAnomaly(tmp, a, 3, refuseDeps, ck.conceptKeyOf);
  assert.equal(refused.confirmed, false);
  assert.equal(refused.filed, false);
  assert.equal(calls.created.length, 1);
  // An UNREADABLE verifier verdict is its own value — never a confirmation.
  const unreadable = await routeAnomaly(tmp, a, 4, { ...deps, verify: async () => ({ results: [] }) }, ck.conceptKeyOf);
  assert.equal(unreadable.verified, null);
  assert.equal(unreadable.confirmed, false);
  assert.match(unreadable.gate_reason, /unreadable/);
});

test("AC3 — the round only spawns the semantic pass for NEW anomalies, past the budget gate", async () => {
  const tmp = mkTmp("rad-ac3b-");
  const carrier = path.join(tmp, CARRIER_REL);
  const ck = await resolveConceptKeyOf(REPO_ROOT);
  let verified = 0;
  const pipeline = {
    verify: async () => { verified++; return { results: [{ cluster: 1, verdict: "supported" }] }; },
    refute: async () => ({ results: [{ cluster: 1, verdict: "supported" }] }),
    clustersFromAnomalySeeds: (seeds) => [{ rep: { concept_kind: seeds[0].concept_kind, components: seeds[0].components, comps: seeds[0].components, claim: seeds[0].claim }, members: ["seed:1"] }],
    refutationPromptFor: () => "R",
    verifierPrompt: "V",
    existingKeys: [],
    createTask: async () => {},
  };
  const cfg = { enabled: true, intervalMinutes: 60, maxModelCallsPer24h: 10, maxAnomaliesPerRound: 3 };
  const rounds = [
    round("c1", "plugin/test/foo.test.mjs", [[1800, true], [1850, true]]),
    round("c2", "plugin/test/foo.test.mjs", [[60000, false], [60500, false]]),
  ];
  const opts = { config: cfg, configPresent: true, halted: false, rounds, pipeline, conceptKeyOf: ck.conceptKeyOf, carrierPath: carrier, ledgerPath: path.join(tmp, BUDGET_LEDGER_REL) };

  const f1 = await runResourceDiagnostic(tmp, { ...opts, round: 1 });
  assert.equal(f1.state, "verified");
  assert.equal(f1.value.fresh, 1);
  assert.equal(verified, 1, "one model-side pass for the one NEW anomaly");
  assert.ok(countReservations(opts.ledgerPath) >= 1, "the semantic pass DID reserve (so AC1's delta-0 is a real contrast)");

  // SECOND round, same signal ⇒ no new anomaly ⇒ ZERO further model calls.
  const f2 = await runResourceDiagnostic(tmp, { ...opts, round: 2 });
  assert.equal(f2.value.fresh, 0);
  assert.equal(verified, 1, "⛔ a recurrence must not buy another model call");
  assert.equal(f2.value.submittedKeys.length, 0);

  // NEGATIVE CONTROL on the budget: a cap of 0 refuses the semantic pass and says so. A DIFFERENT
  // subject, so the submit-once throttle (which already holds foo.test.mjs's key) is not what blocks.
  const roundsBar = [
    round("c1", "plugin/test/bar.test.mjs", [[1800, true], [1850, true]]),
    round("c2", "plugin/test/bar.test.mjs", [[60000, false], [60500, false]]),
  ];
  const f3 = await runResourceDiagnostic(tmp, {
    ...opts, round: 3, rounds: roundsBar, carrierPath: path.join(tmp, "carrier2.jsonl"), ledgerPath: path.join(tmp, "ledger2.jsonl"),
    config: { ...cfg, maxModelCallsPer24h: 0 },
  });
  assert.equal(verified, 1, "a zero cap blocks the spawn");
  assert.match(String(f3.value.refused), /^budget-24h:/);

  // halt gates the SPAWN but never the mechanical reading.
  const f4 = await runResourceDiagnostic(tmp, { ...opts, round: 4, halted: true, rounds: roundsBar, carrierPath: path.join(tmp, "carrier3.jsonl"), ledgerPath: path.join(tmp, "ledger3.jsonl") });
  assert.equal(f4.state, "not-evaluated");
  assert.match(f4.reason, /^halted:/);
  assert.equal(verified, 1, "halted ⇒ zero spawn");
  assert.ok(readCarrierRecords(path.join(tmp, "carrier3.jsonl")).records.some((x) => x.kind === "anomaly"), "the mechanical reading is still appended under halt");
});

// ── AC4: the post-merge effect re-test ───────────────────────────────────────────────────────────
test("AC4 — the effect re-test compares the same metric by the same method, before vs after", async () => {
  const restored = effectRetest({
    metric: "per-file durationMs",
    method: "median of __PERFILE__ durations over the window",
    baseline: [1800, 1850, 1750, 1900],
    anomalous: [30000, 31000, 30500],
    after: [1850, 1800, 1900],
  });
  assert.equal(restored.verdict, "restored");
  assert.equal(restored.baseline.medianMs, 1825);
  assert.equal(restored.anomalous.medianMs, 30500);
  assert.equal(restored.after.medianMs, 1850);
  assert.ok(restored.ratio_after_vs_baseline < 1.5);

  const still = effectRetest({
    metric: "per-file durationMs", method: "median",
    baseline: [1800, 1850], anomalous: [30000, 31000], after: [29000, 30000],
  });
  assert.equal(still.verdict, "still-anomalous");

  const ne = effectRetest({ metric: "m", method: "x", baseline: [1800], anomalous: [30000], after: [] });
  assert.equal(ne.verdict, "not-evaluated", "⛔ an empty post window is NOT 'restored'");
  // ⛔ A ZERO-median window is not a fast run — measured defect: `--effect-after ""` parsed to [0]
  // and read as `restored` (a 0 ratio is ≤ any tolerance).
  assert.equal(effectRetest({ metric: "m", method: "x", baseline: [1800, 1850], anomalous: [60000, 61000], after: [0] }).verdict, "not-evaluated");
  const cliBlank = spawnSync(process.execPath, [
    "--experimental-strip-types", DETECTOR, "--json",
    "--effect-baseline", "1800,1850", "--effect-before", "60000,61000", "--effect-after", "",
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(JSON.parse(cliBlank.stdout.trim()).verdict, "not-evaluated", "⛔ a blank --effect-after must NOT read as restored");
  // The anomalous window must really be anomalous — otherwise the re-test proves nothing.
  const misanchored = effectRetest({ metric: "m", method: "x", baseline: [1800, 1850], anomalous: [1900, 1910], after: [1850, 1860] });
  assert.equal(misanchored.verdict, "not-evaluated");

  // CLI mode: the same computation, pasted from stdout.
  const r = spawnSync(process.execPath, [
    "--experimental-strip-types", DETECTOR, "--json",
    "--effect-baseline", "1800,1850,1750,1900", "--effect-before", "30000,31000,30500", "--effect-after", "1850,1800,1900",
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  const cli = JSON.parse(r.stdout.trim());
  assert.equal(cli.verdict, "restored");
  assert.equal(cli.metric, "per-file durationMs");
  assert.match(cli.method, /__PERFILE__|median/);
});

// ── the 24h ledger + config surface (the OSD/discovery-method pattern) ───────────────────────────
test("budget ledger — reservations are windowed, capped and never deleted", () => {
  const tmp = mkTmp("rad-budget-");
  const ledger = path.join(tmp, "b.jsonl");
  const b = openResourceBudget({ ledgerPath: ledger, cap: 2 });
  assert.equal(b.used, 0);
  assert.equal(b.reserve("verify"), true);
  assert.equal(b.reserve("refute"), true);
  assert.equal(b.reserve("verify"), false, "the cap refuses the third reservation");
  assert.equal(b.used, 2, "a refused reservation does not count");
  assert.equal(countReservations(ledger), 2);
  // A reservation older than the window is not counted.
  fs.writeFileSync(ledger, JSON.stringify({ kind: "reserve", ts: "2000-01-01T00:00:00.000Z", step: "verify" }) + "\n", "utf8");
  assert.equal(countReservations(ledger), 0, "reservations outside the 24h window are not in it");
});

test("config — a declared section is always observable; a bad one is fail-closed", () => {
  assert.equal(parseResourceDiagnosticSection(null).error !== null, true);
  assert.equal(parseResourceDiagnosticSection({ interval: "interval:60m" }).error !== null, true, "enabled is required");
  assert.equal(parseResourceDiagnosticSection({ enabled: false }).config.enabled, false);
  assert.equal(parseResourceDiagnosticSection({ enabled: true, interval: "interval:30m", max_model_calls_per_24h: 1, max_anomalies_per_round: 1 }).error !== null, true, "below the floor ⇒ refused, not silently rounded");
  const ok = parseResourceDiagnosticSection({ enabled: true, interval: "interval:360m", max_model_calls_per_24h: 24, max_anomalies_per_round: 3 });
  assert.equal(ok.error, null);
  assert.deepEqual(ok.config, { enabled: true, intervalMinutes: 360, maxModelCallsPer24h: 24, maxAnomaliesPerRound: 3 });
});

test("RoutineSpec — a declared-but-disabled section still yields an observable routine", async () => {
  const spec = buildResourceDiagnosticRoutine("/nonexistent-root", { present: true, config: { enabled: false, intervalMinutes: 60, maxModelCallsPer24h: 0, maxAnomaliesPerRound: 0 }, error: null });
  assert.equal(spec.name, RESOURCE_DIAGNOSTIC_NAME);
  const [f] = await spec.run({ halted: false });
  assert.equal(f.state, "not-evaluated");
  assert.match(f.reason, /^disabled:/);
});

test("identity — the key comes from the landed ledger module, never from a local vocabulary", async () => {
  const ck = await resolveConceptKeyOf(REPO_ROOT);
  assert.equal(ck.error, null);
  assert.match(ck.modulePath, /discovery-experience-ledger\.mjs$/);
  const [a] = detectResourceAnomalies({ rounds: [
    round("c1", "plugin/test/foo.test.mjs", [[1800, true], [1850, true]]),
    round("c2", "plugin/test/foo.test.mjs", [[60000, false], [60500, false]]),
  ] });
  const k = anomalyConceptKey(a, ck.conceptKeyOf);
  assert.equal(k, "resource-watchdog-shape-shift|plugin/test/foo.test.mjs", "the key shape is the landed one: <concept_kind>|<sorted components>");
  assert.equal(anomalyConceptKey(a, null), null, "⛔ an unresolved key function yields null, never a fabricated key");
  const seed = anomalyToSeed(a, ck.conceptKeyOf);
  assert.equal(seed.concept_key, k);
  assert.match(anomalyTaskId(a, ck.conceptKeyOf), /^gap-routine-resource-watchdog-shape-shift-[0-9a-f]{8}$/);
});

test("carrier — append-only, bad lines skipped, and the task body is keyed by the EXISTING parser", async () => {
  const tmp = mkTmp("rad-carrier-");
  const p = path.join(tmp, "c.jsonl");
  appendCarrierRecords(p, [{ kind: "anomaly", concept_key: "k1" }]);
  fs.appendFileSync(p, "{ not json\n", "utf8");
  appendCarrierRecords(p, [{ kind: "scan-round" }]);
  const { missing, records } = readCarrierRecords(p);
  assert.equal(missing, false);
  assert.deepEqual(records.map((r) => r.kind), ["anomaly", "scan-round"]);
  assert.deepEqual(readCarrierRecords(path.join(tmp, "nope.jsonl")), { missing: true, records: [] });

  const { findingKey, gateFinding } = await import("../scripts/routine-file-gate.ts");
  const [a] = detectResourceAnomalies({ rounds: [
    round("c1", "plugin/test/foo.test.mjs", [[1800, true], [1850, true]]),
    round("c2", "plugin/test/foo.test.mjs", [[60000, false], [60500, false]]),
  ] });
  const body = renderAnomalyTaskBody(a, 1);
  const key = findingKey(body);
  assert.match(key, /^symbols:/, "the EXISTING parser keys the anomaly body by its symbols line");
  assert.equal(gateFinding(body, { existingKeys: [] }).accept, true);
  assert.equal(gateFinding(body, { existingKeys: [key] }).accept, false);
});
