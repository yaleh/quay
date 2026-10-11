// @test-group engine
// arch-discovery-routine.test.mjs — the contract for plugin/scripts/arch-discovery-routine.ts, the
// REPORT-ONLY routine that wires the two arch-discovery instruments into the quality-gate driver's
// routine track (task gap-arch-discovery-not-wired-into-routine-track-report-only).
//
// Coverage map (task AC1 cases (1)–(9)):
//   (1) section absent              ⇒ not-evaluated:disabled, zero spawns
//   (2) enabled:false               ⇒ same
//   (3) halted                      ⇒ not-evaluated:halted, zero spawns
//   (4) malformed / interval < 60m  ⇒ failed, zero spawns
//   (5) instrument non-zero exit / timeout / unparseable / validator-refused / unreadable carrier
//                                   ⇒ failed, carrier byte-identical, last-run NOT advanced
//   (6) two rounds, identical inputs⇒ round 2 appends 0 finding lines + 1 scan-round (new=0, repeated=N)
//   (7) a changed verdict           ⇒ exactly 1 new finding line, transition counted
//   (8) not due inside the interval ⇒ zero spawns
//   (9) after a full round          ⇒ nothing under tasks/ or goals/ changed, AND the routine source
//                                     carries none of the authoring symbols (static control).
//
// Run: scripts/test.sh plugin/test/arch-discovery-routine.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ARCH_DISCOVERY_NAME,
  CARRIER_REL,
  MIN_INTERVAL_MINUTES,
  parseArchDiscoverySection,
  readArchDiscoveryConfig,
  readCarrierFindings,
  runArchDiscovery,
  buildArchDiscoveryRoutine,
  archDiscoveryRoutineFromConfig,
} from "../scripts/arch-discovery-routine.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "../scripts/probe-routine.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const ROUTINE_SRC = path.join(REPO_ROOT, "plugin", "scripts", "arch-discovery-routine.ts");
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

/** A temp workspace: `.quay/` + empty `tasks/`/`goals/`, git-initialised (case (9) reads git status). */
function makeWorkspace() {
  const ws = tmpDir("arch-disc-ws-");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  spawnSync("git", ["-C", ws, "init", "-q"], { encoding: "utf8", env: GIT_ENV });
  return ws;
}

function writeConfig(ws, body) {
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), body, "utf8");
}

const ENABLED_YAML = `loop:\n  arch_discovery:\n    enabled: true\n    interval: interval:360m\n    since_days: 7\n    max_ms: 60000\n    max_records: 2000\n    max_old_space_mb: 512\n`;

/** One instrument row. `finding_fp` is carried verbatim (the routine does not recompute it). */
const findingRow = (fp, subject, verdict, kind = "outcome") => ({
  kind,
  validator_ok: true,
  validator_reasons: [],
  subject_key: subject,
  rule_verdict: verdict,
  finding_fp: fp,
});

/** A fixture instrument: reads `--out` from argv and writes `rows` (or garbage), then exits `exit`.
 *  `write:false` models the instruments' fail-closed "a bound breach writes NOTHING". */
function fixtureInstrument(dir, name, { rows = [], exit = 0, write = true, garbage = null } = {}) {
  const p = path.join(dir, name);
  const emit = garbage !== null
    ? `fs.writeFileSync(out, ${JSON.stringify(garbage)});`
    : `fs.writeFileSync(out, ${JSON.stringify(rows.map((r) => JSON.stringify(r)).join("\n") + "\n")});`;
  const body = [
    `import fs from "node:fs";`,
    `const a = process.argv.slice(2);`,
    `const i = a.indexOf("--out");`,
    `if (i >= 0 && ${write ? "true" : "false"}) { const out = a[i + 1]; ${emit} }`,
    `process.exit(${exit});`,
    ``,
  ].join("\n");
  fs.writeFileSync(p, body, "utf8");
  return p;
}

/** A spawn primitive backed by spawnSync (deterministic, blockingly-sequenced). */
function syncSpawn(argv, { timeoutMs } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1 << 26 });
  return Promise.resolve({ status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ?? null });
}

/** A spawn primitive that counts calls and delegates (or refuses). */
function countingSpawn(delegate) {
  const calls = [];
  const fn = (argv, opts) => { calls.push(argv); return delegate ? delegate(argv, opts) : Promise.resolve({ status: 0, stdout: "", stderr: "", error: null }); };
  fn.calls = calls;
  return fn;
}

/** Build the run options from a workspace's real config read. */
function runOpts(ws, extra = {}) {
  const read = extra.configRead ?? readArchDiscoveryConfig(ws);
  return {
    config: read.config,
    configPresent: read.present,
    configError: read.error,
    halted: false,
    measureRss: false,
    ...extra,
  };
}

const carrierPath = (ws) => path.join(ws, CARRIER_REL);
const lastRunPath = (ws) => path.join(ws, ROUTINE_LAST_RUN_REL);
const carrierLines = (ws) => {
  const raw = fs.existsSync(carrierPath(ws)) ? fs.readFileSync(carrierPath(ws), "utf8") : "";
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const findings = (ws) => carrierLines(ws).filter((l) => l.kind === "finding");
const rounds = (ws) => carrierLines(ws).filter((l) => l.kind === "scan-round");

// ── (1)/(2)/(4) config: parse + the disabled/malformed gates (pure + through the round) ─────────────
test("case (1)/(2)/(4) — parseArchDiscoverySection: disabled section, malformed section, interval floor", () => {
  assert.deepEqual(parseArchDiscoverySection({ enabled: false }).config.enabled, false, "enabled:false ⇒ a disabled config");
  assert.equal(parseArchDiscoverySection({ enabled: false }).error, null, "a disabled section is valid (the kill switch)");
  assert.match(parseArchDiscoverySection({}).error, /needs a boolean 'enabled'/, "a present section with no 'enabled' is malformed");
  assert.match(parseArchDiscoverySection({ enabled: "yes" }).error, /needs a boolean 'enabled'/, "a non-boolean 'enabled' is malformed");
  assert.match(parseArchDiscoverySection({ enabled: true }).error, /needs an 'interval' string/, "enabled ⇒ interval is required");
  assert.match(parseArchDiscoverySection({ enabled: true, interval: "every(5)" }).error, /must be interval:<N>m/, "a non-interval trigger is refused");
  assert.match(parseArchDiscoverySection({ enabled: true, interval: "interval:5m" }).error, /below the 60m floor/, "an interval under the floor is refused");
  const ok = parseArchDiscoverySection({ enabled: true, interval: "interval:60m" });
  assert.equal(ok.error, null);
  assert.equal(ok.config.trigger.minutes, MIN_INTERVAL_MINUTES, "exactly the floor is accepted");
  assert.equal(ok.config.sinceDays, 7, "absent bounds take their documented default");
});

test("case (1) — section absent ⇒ not-evaluated:disabled and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  board: native\n");
  const spawn = countingSpawn(null);
  const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /disabled/);
  assert.equal(fact.value.enabled, false);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
  assert.equal(fs.existsSync(carrierPath(ws)), false, "nothing written to the carrier");
});

test("case (2) — enabled:false ⇒ not-evaluated:disabled and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  arch_discovery:\n    enabled: false\n");
  const spawn = countingSpawn(null);
  const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /disabled/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
});

test("case (4) — malformed section / interval < 60m ⇒ failed and ZERO spawns", async () => {
  for (const yaml of [
    "loop:\n  arch_discovery:\n    enabled: yes-please\n",
    `loop:\n  arch_discovery:\n    enabled: true\n    interval: interval:${MIN_INTERVAL_MINUTES - 1}m\n`,
  ]) {
    const ws = makeWorkspace();
    writeConfig(ws, yaml);
    const spawn = countingSpawn(null);
    const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn }));
    assert.equal(fact.state, "failed", `expected failed for config: ${JSON.stringify(yaml)}`);
    assert.equal(spawn.calls.length, 0, "ZERO spawns on a bad config");
    assert.equal(fs.existsSync(carrierPath(ws)), false, "a failed round writes nothing");
  }
});

// ── (3) halt ────────────────────────────────────────────────────────────────────────────────────────
test("case (3) — halted ⇒ not-evaluated:halted and ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const spawn = countingSpawn(null);
  const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn, halted: true }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /halted/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
});

// ── (8) durable due gate ────────────────────────────────────────────────────────────────────────────
test("case (8) — not due inside the interval ⇒ ZERO spawns", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  fs.writeFileSync(lastRunPath(ws), JSON.stringify({ [ARCH_DISCOVERY_NAME]: Date.now() }), "utf8");
  const spawn = countingSpawn(null);
  const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not due/);
  assert.equal(spawn.calls.length, 0, "ZERO spawns");
});

// ── (5) fail-closed rounds ──────────────────────────────────────────────────────────────────────────
test("case (5) — instrument failure modes ⇒ failed, carrier byte-identical, last-run NOT advanced", async () => {
  const cases = [
    ["non-zero exit (a bound code)", (dir, ws) => ({ exit: 4, write: false })],
    ["unparseable output", (dir, ws) => ({ exit: 0, garbage: "not json at all\n" })],
    ["validator-refused record", (dir, ws) => ({ exit: 0, rows: [{ kind: "outcome", validator_ok: false, validator_reasons: ["bad"], subject_key: "s", finding_fp: "fpX" }] })],
  ];
  for (const [label, spec] of cases) {
    const ws = makeWorkspace();
    writeConfig(ws, ENABLED_YAML);
    // A pre-existing carrier line: the failure must leave it BYTE-IDENTICAL.
    fs.writeFileSync(carrierPath(ws), JSON.stringify({ kind: "finding", finding_fp: "seed", subject_key: "seed", verdict: "v" }) + "\n", "utf8");
    const before = fs.readFileSync(carrierPath(ws), "utf8");
    const dir = tmpDir("arch-disc-fix-");
    const s = spec(dir, ws);
    const prefix = { space: ["node", fixtureInstrument(dir, "space.mjs", s)], time: ["node", fixtureInstrument(dir, "time.mjs", s)] };
    const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: syncSpawn, argvPrefix: prefix }));
    assert.equal(fact.state, "failed", `${label} ⇒ failed`);
    assert.equal(fs.readFileSync(carrierPath(ws), "utf8"), before, `${label}: carrier must stay byte-identical`);
    assert.equal(readLastRunMap(lastRunPath(ws))[ARCH_DISCOVERY_NAME], undefined, `${label}: last-run must NOT advance`);
  }

  // timeout (a spawn that returns a timeout error)
  {
    const ws = makeWorkspace();
    writeConfig(ws, ENABLED_YAML);
    const spawn = countingSpawn(() => Promise.resolve({ status: null, stdout: "", stderr: "", error: new Error("spawn timeout after 10ms (SIGKILL): node") }));
    const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn }));
    assert.equal(fact.state, "failed");
    assert.match(fact.reason, /spawn failed/);
    assert.equal(fs.existsSync(carrierPath(ws)), false, "timeout: nothing appended");
    assert.equal(readLastRunMap(lastRunPath(ws))[ARCH_DISCOVERY_NAME], undefined, "timeout: last-run must NOT advance");
  }

  // unreadable carrier (never shaped like "0 previous findings")
  {
    const ws = makeWorkspace();
    writeConfig(ws, ENABLED_YAML);
    fs.writeFileSync(carrierPath(ws), "{ this is not json\n", "utf8");
    const spawn = countingSpawn(null);
    const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn }));
    assert.equal(fact.state, "failed");
    assert.match(fact.reason, /unreadable carrier/);
    assert.equal(spawn.calls.length, 0, "an unreadable carrier is detected BEFORE any spawn");
    assert.equal(fs.readFileSync(carrierPath(ws), "utf8"), "{ this is not json\n", "carrier untouched");
  }
});

// ── (6)/(7) dedup across rounds ─────────────────────────────────────────────────────────────────────
test("case (6) — two rounds on identical inputs ⇒ round 2 appends 0 finding lines + 1 scan-round (new=0, repeated=N)", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const dir = tmpDir("arch-disc-fix-");
  const rows = [
    { kind: "evidence", validator_ok: true, subject_key: "k1", sha256: "aa" },
    findingRow("fp1", "k1", "rule:drift"),
    findingRow("fp2", "k2", "rule:legit"),
  ];
  const prefix = { space: ["node", fixtureInstrument(dir, "space.mjs", { rows })], time: ["node", fixtureInstrument(dir, "time.mjs", { rows: [] })] };

  const clock = { t: Date.parse("2026-10-11T00:00:00Z") };
  const opts = () => runOpts(ws, { spawnFn: syncSpawn, argvPrefix: prefix, now: () => clock.t });

  const f1 = await runArchDiscovery(ws, opts());
  assert.equal(f1.state, "verified");
  assert.equal(findings(ws).length, 2, "round 1 appends one finding line per NEW fingerprint");
  assert.equal(rounds(ws).length, 1);
  assert.equal(rounds(ws)[0].findings.new, 2);
  assert.equal(rounds(ws)[0].findings.repeated, 0);

  clock.t += 2 * 360 * 60_000; // advance past the interval
  const f2 = await runArchDiscovery(ws, opts());
  assert.equal(f2.state, "verified");
  assert.equal(findings(ws).length, 2, "round 2 appends ZERO finding lines (both fingerprints already recorded)");
  assert.equal(rounds(ws).length, 2, "round 2 appends exactly 1 scan-round line");
  assert.equal(rounds(ws)[1].findings.new, 0);
  assert.equal(rounds(ws)[1].findings.repeated, 2);
  assert.equal(rounds(ws)[1].findings.gone, 0);
  assert.deepEqual(rounds(ws)[1].transitions, [], "no verdict changed ⇒ no transition");
  assert.equal(rounds(ws)[1].kinds.evidence, 1, "per-kind counts are recorded");
  assert.equal(typeof rounds(ws)[1].wall_ms, "number");
});

test("argv — each instrument is bounded, and the time scan pins BOTH window ends", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const dir = tmpDir("arch-disc-fix-");
  const empty = { space: ["node", fixtureInstrument(dir, "space.mjs", { rows: [] })], time: ["node", fixtureInstrument(dir, "time.mjs", { rows: [] })] };
  const spawn = countingSpawn(syncSpawn);
  await runArchDiscovery(ws, runOpts(ws, { spawnFn: spawn, argvPrefix: empty }));
  assert.equal(spawn.calls.length, 2, "one spawn per instrument");
  for (const argv of spawn.calls) {
    assert.ok(argv.includes("--scan"), "scan mode");
    assert.ok(argv.includes("--root") && argv.includes(ws), "--root is the scan root");
    assert.equal(argv[argv.indexOf("--max-ms") + 1], "60000", "--max-ms is passed (bounds the instrument)");
    assert.equal(argv[argv.indexOf("--max-records") + 1], "2000", "--max-records is passed");
  }
  const timeArgv = spawn.calls[1];
  // The window is pinned at BOTH ends so two rounds read the same frozen interval while the live loop
  // keeps appending carriers (otherwise `new` would be dominated by carrier growth, not by findings).
  assert.ok(timeArgv.includes("--since"), "time scan needs --since");
  assert.ok(timeArgv.includes("--until"), "time scan pins --until to the round's start");
});

test("case (7) — a changed verdict ⇒ exactly 1 new finding line and 1 transition", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const dir = tmpDir("arch-disc-fix-");
  const clock = { t: Date.parse("2026-10-11T00:00:00Z") };

  const inst = (rows) => ({ space: ["node", fixtureInstrument(dir, "space.mjs", { rows })], time: ["node", fixtureInstrument(dir, "time.mjs", { rows: [] })] });

  const f1 = await runArchDiscovery(ws, runOpts(ws, { spawnFn: syncSpawn, argvPrefix: inst([findingRow("fpA", "kA", "rule:drift")]), now: () => clock.t }));
  assert.equal(f1.state, "verified");
  assert.equal(findings(ws).length, 1);
  assert.equal(findings(ws)[0].subject_key, "kA");

  clock.t += 2 * 360 * 60_000;
  const f2 = await runArchDiscovery(ws, runOpts(ws, { spawnFn: syncSpawn, argvPrefix: inst([findingRow("fpB", "kA", "rule:legit")]), now: () => clock.t }));
  assert.equal(f2.state, "verified");
  assert.equal(findings(ws).length, 2, "the changed verdict produces exactly ONE new finding line");
  assert.equal(findings(ws)[1].finding_fp, "fpB");
  assert.equal(rounds(ws)[1].findings.new, 1);
  assert.equal(rounds(ws)[1].findings.gone, 1, "the old fingerprint is gone");
  assert.deepEqual(rounds(ws)[1].transitions, ["kA"], "the verdict change on kA is recorded as a transition");
  assert.equal(rounds(ws)[1].recurrence.kA, 2, "recurrence per subject_key counts the cumulative distinct fingerprints");
});

// ── (9) report-only: no task/goal created, and no authoring symbol in the source ─────────────────────
test("case (9) — after a full round nothing under tasks/ or goals/ changed, and the source is filing-free", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const dir = tmpDir("arch-disc-fix-");
  const rows = [findingRow("fp1", "k1", "rule:drift")];
  const prefix = { space: ["node", fixtureInstrument(dir, "space.mjs", { rows })], time: ["node", fixtureInstrument(dir, "time.mjs", { rows: [] })] };

  const statusBefore = spawnSync("git", ["-C", ws, "status", "--porcelain", "tasks/", "goals/"], { encoding: "utf8", env: GIT_ENV }).stdout;
  const fact = await runArchDiscovery(ws, runOpts(ws, { spawnFn: syncSpawn, argvPrefix: prefix }));
  assert.equal(fact.state, "verified");
  const statusAfter = spawnSync("git", ["-C", ws, "status", "--porcelain", "tasks/", "goals/"], { encoding: "utf8", env: GIT_ENV }).stdout;
  assert.equal(statusAfter, statusBefore, "no file under tasks/ or goals/ changed");
  assert.equal(statusAfter, "", "tasks/ and goals/ are empty — the routine created no task and no goal");
  assert.equal(fs.readdirSync(path.join(ws, "tasks")).length, 0, "tasks/ is still empty");
  assert.equal(fs.readdirSync(path.join(ws, "goals")).length, 0, "goals/ is still empty");

  // The STATIC control: the routine source names none of the authoring symbols. This assertion is the
  // one AC2's mutation control turns red (add such an import ⇒ this fails while case (9) runs).
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  const forbidden = /selectFilings|fileRoutineTask|driveItems|task_write|goal_write|writeTask|writeGoal/;
  assert.doesNotMatch(src, forbidden, "arch-discovery-routine.ts must import/call no filing or authoring symbol");
});

// ── the RoutineSpec wrapper (what the driver's routine table receives) ───────────────────────────────
test("RoutineSpec — buildArchDiscoveryRoutine wires config + ctx.halted into the round", async () => {
  const ws = makeWorkspace();
  writeConfig(ws, ENABLED_YAML);
  const read = readArchDiscoveryConfig(ws);
  assert.equal(read.present, true);
  assert.equal(read.config.enabled, true);
  assert.equal(read.config.trigger.minutes, 360, "the RoutineSpec schedule is the declared interval");

  const spawn = countingSpawn(null);
  const spec = buildArchDiscoveryRoutine(ws, read, { spawnFn: spawn, measureRss: false });
  assert.equal(spec.name, ARCH_DISCOVERY_NAME);
  const facts = await spec.run({ halted: true });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].state, "not-evaluated", "ctx.halted reaches the round");
  assert.equal(spawn.calls.length, 0);
});

// ── case (1) config read: absent section is `present:false`, not an error ─────────────────────────────
test("readArchDiscoveryConfig — an absent section is present:false with no error (off by default)", () => {
  const ws = makeWorkspace();
  writeConfig(ws, "loop:\n  board: native\n");
  const read = readArchDiscoveryConfig(ws);
  assert.equal(read.present, false);
  assert.equal(read.config, null);
  assert.equal(read.error, null);

  // and the carrier reader on a missing file is a real "no previous findings", not an error
  assert.deepEqual(readCarrierFindings(path.join(ws, CARRIER_REL)), { missing: true, records: [] });
});

test("archDiscoveryRoutineFromConfig — absent ⇒ NO routine assembled (the host's routine set is unchanged)", () => {
  const absent = makeWorkspace();
  writeConfig(absent, "loop:\n  board: native\n");
  const a = archDiscoveryRoutineFromConfig(absent);
  assert.equal(a.present, false);
  assert.equal(a.routine, null, "no section ⇒ the driver adds no routine at all (off by default)");

  // A DECLARED section always yields a routine — the declaration must be observable, including the
  // kill switch (enabled:false) and a malformed section (failed), never silence.
  const disabled = makeWorkspace();
  writeConfig(disabled, "loop:\n  arch_discovery:\n    enabled: false\n");
  const b = archDiscoveryRoutineFromConfig(disabled);
  assert.equal(b.routine !== null, true, "enabled:false is still assembled (it must record not-evaluated:disabled)");
  assert.equal(b.enabled, false);

  const bad = makeWorkspace();
  writeConfig(bad, "loop:\n  arch_discovery:\n    enabled: true\n    interval: interval:5m\n");
  const c = archDiscoveryRoutineFromConfig(bad);
  assert.equal(c.routine !== null, true, "a malformed section is still assembled (it must record failed)");
  assert.match(c.error, /below the 60m floor/);
});
