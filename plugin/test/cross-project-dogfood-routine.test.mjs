// cross-project-dogfood-routine.test.mjs — the cross-project dogfood routine's own judgements, each
// pinned to a real predicate (never to a proxy): the read-only isolation invariant (static + runtime +
// a real round against a permission-restricted copy), the config schema, the hard reservation ledger and
// its kill switch, the root-unreadable reading, due/last-run stamping, the OSD confirmation bar, the
// Portfolio dedup path, and the scope guard that keeps a project-local item out of the Portfolio.
//
// The engine (`docs/analysis/arch-hypothesis-generation.mjs`) is NOT imported here: every round in this
// file runs against an injected `hypModule`, which is exactly the seam the module exposes. Real rounds
// against real artifacts are pasted as evidence in the task body, not asserted here (a fixture can prove
// "it can produce a reading", never "production produced one" — 硬规则 4 推论三).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  CROSS_PROJECT_DOGFOOD_NAME,
  CARRIER_REL,
  BUDGET_LEDGER_REL,
  MIN_INTERVAL_MINUTES,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_ARTIFACTS,
  assertNotSourceRoot,
  buildCrossProjectDogfoodRoutine,
  clearSourceRoots,
  crossProjectDogfoodRoutineFromConfig,
  declareSourceRoot,
  isConfirmed,
  parseCrossProjectDogfoodSection,
  renderEvidencePack,
  renderFiledTaskBody,
  runCrossProjectDogfood,
  scanJsonlArtifact,
  scanSourceProject,
  scanTasksDir,
  sourceRootOwning,
  verdictOf,
  writeOwnedFile,
} from "../scripts/cross-project-dogfood-routine.ts";
import { INVOKED_BY_MANUAL, INVOKED_BY_RESIDENT } from "../scripts/discovery-method-routine.ts";

const ROUTINE_SRC = new URL("../scripts/cross-project-dogfood-routine.ts", import.meta.url);

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
function tmpdir(prefix = "cpd-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

/** A minimal source project on disk: `.quay/worker-outcome.jsonl` + a `tasks/` board. */
function makeSourceProject(root, { outcomes = [], tasks = {} } = {}) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  writeJsonl(path.join(root, ".quay", "worker-outcome.jsonl"), outcomes);
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  for (const [id, status] of Object.entries(tasks)) {
    fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `---\nid: ${id}\nstatus: ${status}\n---\n\n# ${id}\n\n原因: fixture reason for ${id}\n`, "utf8");
  }
  return root;
}

const BASE_CFG = {
  enabled: true,
  trigger: { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES },
  intervalUntil: null,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  sourceProjects: [],
  maxProjectsPerRound: 4,
  maxRecordsPerFile: 20,
  maxFileBytes: 4 * 1024 * 1024,
  maxArtifactBytesPerProject: 8 * 1024 * 1024,
  investigatorMaxTurns: 8,
  verifierMaxTurns: 6,
  refutationMaxTurns: 4,
  maxClustersVerified: 3,
  maxWallMs: 600_000,
  maxModelCallsPer24h: 20,
  maxUsdPer24h: 10,
  fileConfirmed: true,
};

function cfg(over = {}) {
  return { ...BASE_CFG, ...over, trigger: { kind: "interval", minutes: over.intervalMinutes ?? BASE_CFG.intervalMinutes } };
}

function project(name, root, over = {}) {
  return { name, root, enabled: true, artifacts: DEFAULT_ARTIFACTS, ...over };
}

const HYPOTHESIS = {
  components: ["plugin/scripts/worker-driver.ts"],
  concept_kind: "attribution",
  claim: "the fan-in loser is recorded as a worker failure so the project's own defect rate overcounts",
  scope: "quay_generic",
  source_project: "alpha",
  evidence: [{ source_project: "alpha", file: ".quay/worker-outcome.jsonl", line: 2, excerpt: "final_state=exited-not-landed" }],
};

/** An injected engine. `verdicts` are consumed in call order by `runVerifier` — first the verifier for
 *  each selected cluster, then the refuter for each `supported` one. */
function makeHyp({ hypotheses = [HYPOTHESIS], verdicts = ["supported", "supported"] } = {}) {
  const calls = { investigator: 0, verifier: [] };
  const queue = [...verdicts];
  return {
    calls,
    module: {
      hardenedArgv: () => ["stub-launcher"],
      clusterHypotheses: (runs) => (runs[0]?.hyps ?? []).map((h, i) => ({ rep: h, members: [h], comps: h.components, cluster: i + 1 })),
      parseJsonObject: () => null,
      runInvestigator: async (opts) => {
        calls.investigator++;
        await opts.runModel("investigator prompt", 0); // drives the reserve→spawn seam for real
        return { ok: true, records: [{ hyps: hypotheses }], parsed: 1, total: 1 };
      },
      runVerifier: async (opts) => {
        const wanted = queue.length > 0 ? queue.shift() : "undetermined";
        calls.verifier.push({ template: String(opts.promptTemplate).includes("INDEPENDENT REFUTER") ? "refuter" : "verifier", onlyCluster: opts.onlyCluster ?? null });
        await opts.runModel("verifier prompt", { cluster: 1 });
        return { ok: true, results: [{ cluster: 1, verdict: wanted, verdict_cause: wanted === "undetermined" ? "no-counter-evidence" : null, checked: ["plugin/scripts/worker-driver.ts:1"], counterexample: wanted === "refuted" ? "counter-observation" : null }] };
      },
    },
  };
}

function makeSpawn() {
  const seen = [];
  const spawn = async (argv, opts) => {
    seen.push({ argv, cwd: opts.cwd, timeoutMs: opts.timeoutMs, viaStdin: typeof opts.stdinData === "string" });
    return { status: 0, signal: null, stdout: "", stderr: "", error: null };
  };
  return { seen, spawn };
}

function readCarrier(root) {
  const p = path.join(root, CARRIER_REL);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

function hashTree(root) {
  const h = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs);
      else h.update(`${path.relative(root, abs)}\u0000${fs.readFileSync(abs)}\u0000`);
    }
  };
  walk(root);
  return h.digest("hex");
}

// ── AC1: the read-only isolation invariant ──────────────────────────────────────────────────────────
test("AC1(a) STATIC — this file reaches no fs mutator outside writeOwnedFile (with a mutation control)", () => {
  const src = fs.readFileSync(ROUTINE_SRC, "utf8");
  // Every mutating fs method, in both the sync and promise spellings, plus the stream constructor.
  const FS_MUTATOR = /\bfs\s*\.\s*(?:write|append|rm|unlink|rename|copy|cp|mkdir|chmod|chown|truncate|symlink|link|utimes)[A-Za-z]*\s*\(/;
  assert.doesNotMatch(src, FS_MUTATOR, "no fs mutator may be called through the `fs` namespace — writes go through writeOwnedFile's MUTATE indirection, which asserts the target is not a source root");
  // The MUTATE indirection must be the ONE place the mutators are bound.
  assert.match(src, /const MUTATE = Object\.freeze\(\{\n\s*writeFileSync: fs\.writeFileSync,\n\s*mkdirSync: fs\.mkdirSync,\n\}\)/, "the write surface must stay the two-element MUTATE binding");
  // Mutation control: the SAME predicate must go red when a mutator is introduced where it does not belong.
  const mutated = `${src}\nfunction sneak(p) { fs.rmSync(p, { recursive: true }); }\n`;
  assert.match(mutated, FS_MUTATOR, "the mutation must turn the same predicate red");
});

test("AC1(b) RUNTIME — writeOwnedFile refuses any target inside a declared source project, and allows its own", () => {
  clearSourceRoots();
  const src = makeSourceProject(path.join(tmpdir(), "src"));
  declareSourceRoot(src, "alpha");
  try {
    assert.throws(() => writeOwnedFile(path.join(src, "sneak.txt"), "x"), /CROSS_PROJECT_SOURCE_WRITE_REFUSED .*"alpha"/, "a write into the source project must be refused BY NAME");
    assert.throws(() => writeOwnedFile(path.join(src, ".quay", "worker-outcome.jsonl"), "x"), /CROSS_PROJECT_SOURCE_WRITE_REFUSED/, "even a path that already exists there is refused");
    assert.equal(fs.existsSync(path.join(src, "sneak.txt")), false, "nothing may have been created");
    // A sibling directory whose name merely STARTS with the root's is NOT inside it (position, not prefix
    // string — 硬规则 2).
    assert.equal(sourceRootOwning(`${src}-sibling`), null);
    const mine = path.join(tmpdir(), "own");
    writeOwnedFile(path.join(mine, "ok.txt"), "hello");
    assert.equal(fs.readFileSync(path.join(mine, "ok.txt"), "utf8"), "hello");
    // The spawn-cwd check is the same check.
    assert.throws(() => assertNotSourceRoot(src, "spawn cwd for step x"), /CROSS_PROJECT_SOURCE_WRITE_REFUSED/);
  } finally {
    clearSourceRoots();
  }
});

test("AC1(c) REAL RUN against a permission-restricted copy — the source tree is byte-identical afterwards", async () => {
  const base = tmpdir();
  const src = makeSourceProject(path.join(base, "readonly-alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  const before = hashTree(src);
  // A permission-restricted copy: no write bit anywhere in the tree. A write would fail loudly rather
  // than silently succeed, so "the hash is unchanged" is not merely "the guard held".
  const chmodAll = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) { chmodAll(abs); fs.chmodSync(abs, 0o555); }
      else fs.chmodSync(abs, 0o444);
    }
  };
  chmodAll(src);
  try {
    const root = tmpdir();
    const { module } = makeHyp();
    const { seen, spawn } = makeSpawn();
    const fact = await runCrossProjectDogfood(root, {
      config: cfg({ sourceProjects: [project("alpha", src)] }),
      configPresent: true,
      hypModule: module,
      portfolioModule: null,
      spawnFn: spawn,
      scratchRoot: tmpdir(),
      now: () => 1_800_000_000_000,
    });
    assert.equal(fact.state, "verified", `round must complete: ${fact.reason}`);
    assert.ok(seen.length >= 1, "the round must really have spawned a model subprocess (otherwise this proves nothing)");
    for (const s of seen) assert.notEqual(s.cwd, src, "no subprocess may be rooted in a source project");
    assert.ok(!seen.some((s) => s.cwd.startsWith(`${src}${path.sep}`)), "no subprocess may be rooted inside a source project");
    assert.equal(hashTree(src), before, "the source project's tree must be byte-identical after the round");
  } finally {
    // Restore write bits so the temp tree can be cleaned up by the OS.
    try {
      const restore = (dir) => {
        fs.chmodSync(dir, 0o755);
        for (const name of fs.readdirSync(dir)) {
          const abs = path.join(dir, name);
          if (fs.statSync(abs).isDirectory()) restore(abs); else fs.chmodSync(abs, 0o644);
        }
      };
      restore(src);
    } catch { /* best effort */ }
  }
});

// ── AC2: the cost boundary and the kill switch ──────────────────────────────────────────────────────
test("AC2(a) enabled:false is a kill switch — the disabled shape needs no other key and spawns nothing", async () => {
  const read = parseCrossProjectDogfoodSection({ enabled: false });
  assert.equal(read.error, null);
  assert.equal(read.config.enabled, false);
  assert.equal(read.config.sourceProjects.length, 0, "a kill switch must not be blocked by the config it kills");
  const root = tmpdir();
  const { module } = makeHyp();
  const { seen, spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, { config: read.config, configPresent: true, hypModule: module, spawnFn: spawn, scratchRoot: tmpdir() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:disabled/);
  assert.equal(seen.length, 0, "a disabled round must spawn nothing");
  assert.equal(fs.existsSync(path.join(root, CARRIER_REL)), false, "a disabled round must not even create the carrier");
});

test("AC2(b) the 24h call cap is a HARD pre-spawn reservation, and hitting it refuses the round with zero calls", async () => {
  const base = tmpdir();
  const root = path.join(base, "ws");
  const ledger = path.join(root, BUDGET_LEDGER_REL);
  writeJsonl(ledger, [{ kind: "reserve", id: "pre-1", ts: new Date(1_800_000_000_000 - 60_000).toISOString(), step: "cross-project-investigator", used_before: 0 }]);
  const { module } = makeHyp();
  const { seen, spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", makeSourceProject(path.join(base, "a")))], maxModelCallsPer24h: 1 }),
    configPresent: true,
    hypModule: module,
    spawnFn: spawn,
    scratchRoot: tmpdir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:budget-24h/);
  assert.equal(seen.length, 0, "a round refused by the cap must spawn nothing");
  assert.equal(fact.value.budget_24h.used_at_start, 1);
});

test("AC2(c) a round that runs really writes reserve lines, and a mid-round refusal stops it with the cause named", async () => {
  const base = tmpdir();
  const root = path.join(base, "ws");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  const { module } = makeHyp();
  const { spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", src)] }),
    configPresent: true,
    hypModule: module,
    spawnFn: spawn,
    scratchRoot: tmpdir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(fact.state, "verified", fact.reason);
  const ledgerLines = fs.readFileSync(path.join(root, BUDGET_LEDGER_REL), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  const reserves = ledgerLines.filter((l) => l.kind === "reserve");
  const outcomes = ledgerLines.filter((l) => l.kind === "outcome");
  assert.ok(reserves.length >= 3, `investigator + verifier + refuter must each reserve BEFORE spawning (got ${reserves.length})`);
  assert.equal(reserves.length, outcomes.length, "every reservation must be closed by an outcome (a reservation with no outcome counts as spent)");
  assert.ok(reserves.every((r) => typeof r.id === "string" && r.max_turns >= 1 && r.round.startsWith("cpd-")), "each reserve line must name its step budget and round");

  // The refusal arm: a cap of 1 lets the investigator through and refuses the verifier's reservation.
  const root2 = path.join(base, "ws2");
  const { module: m2 } = makeHyp();
  const { spawn: s2 } = makeSpawn();
  const refused = await runCrossProjectDogfood(root2, {
    config: cfg({ sourceProjects: [project("alpha", src)], maxModelCallsPer24h: 1 }),
    configPresent: true,
    hypModule: m2,
    spawnFn: s2,
    scratchRoot: tmpdir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(refused.state, "failed", "a refused reservation must not be reported as a completed round");
  assert.match(refused.reason, /BUDGET_REFUSED:BUDGET_24H/, "the refusal cause must be named, not inferred");
  // The project lines were already appended (the READ happened and is on the record); what must NOT
  // exist is a `dogfood-round` line, because the round never reached an outcome — a reader counting
  // rounds must not see a refused round as a completed one.
  const refusedLines = readCarrier(root2);
  assert.equal(refusedLines.filter((r) => r.kind === "dogfood-round").length, 0, "a refused round must not write a round line");
  assert.equal(refusedLines.filter((r) => r.kind === "dogfood-project").length, 1, "the read that DID happen stays on the record");
});

// ── AC3: the config schema and the unreadable root ──────────────────────────────────────────────────
test("AC3(a) the schema accepts ≥2 source projects and refuses the malformed shapes by name", () => {
  const ok = parseCrossProjectDogfoodSection({
    enabled: true, interval: "interval:360m",
    source_projects: [{ name: "claudecodeui", root: "/data/home/yale/work/claudecodeui", enabled: true }, { name: "quay-self-usage", root: "/data/home/yale/work/quay", enabled: true }, { name: "third", root: "/nope", enabled: true }],
    max_projects_per_round: 3, max_records_per_file: 60, max_file_bytes: 4194304, max_artifact_bytes_per_project: 8388608,
    investigator_max_turns: 30, verifier_max_turns: 12, refutation_max_turns: 10, max_clusters_verified: 3,
    max_wall_ms: 1800000, max_model_calls_per_24h: 40, max_usd_per_24h: 12, file_confirmed: true,
  });
  assert.equal(ok.error, null);
  assert.equal(ok.config.sourceProjects.length, 3);
  assert.deepEqual(ok.config.sourceProjects.map((p) => p.name), ["claudecodeui", "quay-self-usage", "third"]);

  const cases = [
    [{ enabled: true, interval: "interval:360m", source_projects: [] }, /source_projects must be a non-empty list/],
    [{ enabled: true, interval: "interval:360m", source_projects: [{ name: "a", root: "relative/path", enabled: true }] }, /must be ABSOLUTE/],
    [{ enabled: true, interval: "interval:360m", source_projects: [{ name: "a", root: "/a", enabled: true }, { name: "a", root: "/b", enabled: true }] }, /duplicate name/],
    [{ enabled: true, interval: "interval:30m", source_projects: [{ name: "a", root: "/a", enabled: true }] }, new RegExp(`below the ${MIN_INTERVAL_MINUTES}m floor`)],
    [{ enabled: true, interval: "interval:60m", source_projects: [{ name: "a", root: "/a", enabled: true }] }, /interval_until .* is REQUIRED/],
    [{ enabled: true, interval: "interval:360m", source_projects: [{ name: "a", root: "/a", enabled: true }], max_usd_per_24h: 1 }, /max_projects_per_round must be an integer >= 1/],
    [{ enabled: true, interval: "interval:360m", source_projects: [{ name: "a", root: "/a", enabled: "yes" }] }, /enabled must be a boolean/],
  ];
  for (const [raw, re] of cases) {
    const r = parseCrossProjectDogfoodSection(raw);
    assert.equal(r.config, null, `must be refused: ${JSON.stringify(raw).slice(0, 80)}`);
    assert.match(r.error, re);
  }
});

test("AC3(b) a THIRD, deliberately-unreadable root reads not-evaluated:root-unreadable for THAT project and the round still runs", async () => {
  const base = tmpdir();
  const root = path.join(base, "ws");
  const alpha = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  const gamma = makeSourceProject(path.join(base, "gamma"), { outcomes: [{ kind: "worker", final_state: "completed", exit_code: 0 }] });
  const missing = path.join(base, "does-not-exist");
  const { module } = makeHyp();
  const { spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", alpha), project("gamma", gamma), project("third", missing)] }),
    configPresent: true,
    hypModule: module,
    spawnFn: spawn,
    scratchRoot: tmpdir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(fact.state, "verified", `the unreadable third root must NOT fail the round: ${fact.reason}`);
  const third = fact.value.projects.find((p) => p.name === "third");
  assert.equal(third.reading, "root-unreadable");
  assert.equal(third.not_evaluated, "not-evaluated:root-unreadable");
  assert.match(third.reason, /ENOENT/);
  const lines = readCarrier(root).filter((r) => r.kind === "dogfood-project");
  assert.equal(lines.length, 3, "one project line per configured project — including the unreadable one");
  assert.equal(lines.find((l) => l.source_project === "third").not_evaluated, "not-evaluated:root-unreadable");
  assert.equal(lines.find((l) => l.source_project === "alpha").not_evaluated, null, "a readable project carries no not-evaluated token");
});

test("AC3(c) every enabled project unreadable ⇒ its own not-evaluated token, and nothing is spawned", async () => {
  const base = tmpdir();
  const root = path.join(base, "ws");
  const { module } = makeHyp();
  const { seen, spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("a", path.join(base, "nope-a")), project("b", path.join(base, "nope-b"))] }),
    configPresent: true,
    hypModule: module,
    spawnFn: spawn,
    scratchRoot: tmpdir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:no-readable-source-project/);
  assert.equal(seen.length, 0);
});

// ── due / last-run / invoked_by ─────────────────────────────────────────────────────────────────────
test("not-due is its own reading, and a completed round advances the last-run stamp WITH its invoked_by", async () => {
  const base = tmpdir();
  const root = path.join(base, "ws");
  const lastRun = path.join(root, ".quay", "routine-last-run.json");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "completed", exit_code: 0 }] });
  const { module } = makeHyp();
  const { spawn } = makeSpawn();
  const common = { config: cfg({ sourceProjects: [project("alpha", src)] }), configPresent: true, hypModule: module, spawnFn: spawn, scratchRoot: tmpdir(), lastRunPath: lastRun };

  const t0 = 1_800_000_000_000;
  const first = await runCrossProjectDogfood(root, { ...common, now: () => t0, invokedBy: INVOKED_BY_RESIDENT });
  assert.equal(first.state, "verified", first.reason);
  const stamped = JSON.parse(fs.readFileSync(lastRun, "utf8"));
  assert.equal(stamped[CROSS_PROJECT_DOGFOOD_NAME], t0);
  assert.equal(stamped[`${CROSS_PROJECT_DOGFOOD_NAME}@invoked_by`], INVOKED_BY_RESIDENT, "a resident round must stamp its own identity in the SAME write as the timestamp");

  const second = await runCrossProjectDogfood(root, { ...common, now: () => t0 + 60_000 });
  assert.equal(second.state, "not-evaluated");
  assert.match(second.reason, /not-evaluated:not-due/);
  assert.equal(JSON.parse(fs.readFileSync(lastRun, "utf8"))[CROSS_PROJECT_DOGFOOD_NAME], t0, "a not-due round must not advance the stamp");

  // --force is the MANUAL path and must never masquerade as an autonomous one.
  const forced = await runCrossProjectDogfood(root, { ...common, now: () => t0 + 60_000, invokedBy: INVOKED_BY_MANUAL, force: true });
  assert.equal(forced.state, "verified", forced.reason);
  assert.equal(forced.value.invoked_by, INVOKED_BY_MANUAL);
  assert.equal(JSON.parse(fs.readFileSync(lastRun, "utf8"))[`${CROSS_PROJECT_DOGFOOD_NAME}@invoked_by`], INVOKED_BY_MANUAL);
  assert.ok(readCarrier(root).some((r) => r.invoked_by === "manual" && r.kind === "dogfood-round"));
});

test("the routine spec is stamped resident-driver by construction, and null only when no section is declared", () => {
  const read = parseCrossProjectDogfoodSection({ enabled: false });
  const built = buildCrossProjectDogfoodRoutine("/tmp/whatever", { present: true, config: read.config, error: null });
  assert.equal(built.name, CROSS_PROJECT_DOGFOOD_NAME);
  assert.deepEqual(built.schedule, { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES });
  const fromConfig = crossProjectDogfoodRoutineFromConfig("/tmp/whatever", {}, { present: false, config: null, error: null });
  assert.equal(fromConfig.routine, null, "an undeclared section must not even add a routine to the driver's table");
  const declared = crossProjectDogfoodRoutineFromConfig("/tmp/whatever", {}, { present: true, config: read.config, error: null });
  assert.notEqual(declared.routine, null, "a DECLARED section (even enabled:false) must stay observable as a routine");
  assert.equal(declared.enabled, false);
});

// ── AC4: dedup against the existing Portfolio ───────────────────────────────────────────────────────
function makePortfolio({ existing = [], failIngest = false } = {}) {
  const ingestCalls = [];
  return {
    ingestCalls,
    module: {
      readPortfolio: () => ({ ok: true, records: existing }),
      // The REAL module's matcher semantics: normalize (trim/collapse/lowercase) claim + set-equal components.
      findDuplicate: (earlier, q) => (earlier ?? []).find((r) => {
        const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
        const setEq = (a, b) => {
          const A = [...new Set((a ?? []).map(String))].sort().join("|");
          const B = [...new Set((b ?? []).map(String))].sort().join("|");
          return A === B && A !== "";
        };
        return r.duplicate_of === null && setEq(r.components, q.components) && norm(r.claim) === norm(q.claim);
      }) ?? null,
      ingestFinding: (root, input) => {
        ingestCalls.push(input);
        return failIngest ? { ok: false, reasons: ["REFUSED_BY_FIXTURE"] } : { ok: true, id: input.finding_id };
      },
    },
  };
}

async function runWithPortfolio(portfolio, { cfgOver = {}, hypotheses } = {}) {
  const base = tmpdir();
  const root = path.join(base, "ws");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  const { module } = makeHyp(hypotheses ? { hypotheses } : {});
  const { spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", src)], ...cfgOver }),
    configPresent: true,
    hypModule: module,
    portfolioModule: portfolio.module,
    spawnFn: spawn,
    scratchRoot: tmpdir(),
    now: () => 1_800_000_000_000,
  });
  return { fact, root, clusters: readCarrier(root).filter((r) => r.kind === "dogfood-cluster"), rounds: readCarrier(root).filter((r) => r.kind === "dogfood-round") };
}

test("AC4(a) a claim+components set already on the Portfolio is recognised as a duplicate and writes NO second row", async () => {
  const existing = [{
    id: "pf-existing-1", finding_id: "osd-existing", duplicate_of: null,
    components: ["plugin/scripts/worker-driver.ts"],
    claim: "The   FAN-IN loser is recorded as a worker failure so the project's own defect rate overcounts",
    outcome: "supported",
  }];
  const portfolio = makePortfolio({ existing });
  const { fact, clusters, rounds } = await runWithPortfolio(portfolio, { hypotheses: [HYPOTHESIS] });
  assert.equal(fact.state, "verified", fact.reason);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].confirmed, true, "the confirmation bar must have been met for this arm to test dedup at all");
  assert.equal(portfolio.ingestCalls.length, 0, "a duplicate must NOT reach the Portfolio writer");
  assert.equal(clusters[0].portfolio.written, false);
  assert.equal(clusters[0].portfolio.duplicate_of, "pf-existing-1", "the existing row must be NAMED");
  assert.equal(rounds.at(-1).duplicates, 1);

  // Negative control: the SAME run with a claim that differs by one word is NOT a duplicate ⇒ the writer
  // IS reached. Without this arm, "ingest never called" would be indistinguishable from "ingest broken".
  const other = makePortfolio({ existing: [{ ...existing[0], claim: "a completely different claim about something else entirely" }] });
  const ctrl = await runWithPortfolio(other, { hypotheses: [HYPOTHESIS] });
  assert.equal(other.ingestCalls.length, 1, "a non-matching claim must reach the writer — otherwise the duplicate arm proves nothing");
  assert.equal(ctrl.clusters[0].portfolio.written, true);
});

test("AC4(b) a project_local claim is neither ingested nor filed, even when it is confirmed", async () => {
  const localHyp = { ...HYPOTHESIS, scope: "project_local", claim: "the project's own UI copy doubles a button label in its settings sheet", components: ["src/components/Settings.tsx"] };
  const portfolio = makePortfolio();
  const { clusters, rounds } = await runWithPortfolio(portfolio, {
    hypotheses: [localHyp],
    cfgOver: { fileConfirmed: true },
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].confirmed, true, "the scope guard, not the confirmation bar, is what this arm tests");
  assert.equal(clusters[0].scope, "project_local");
  assert.equal(portfolio.ingestCalls.length, 0, "a project-local item must never reach the Portfolio");
  assert.equal(clusters[0].portfolio.written, false);
  assert.equal(rounds.at(-1).filed.length, 0, "a project-local item must file NOTHING");
  assert.deepEqual(rounds.at(-1).scope_split, { quay_generic: 0, project_local: 1 });

  // The fail-closed half: an UNSTATED scope is not a Quay-generic claim either.
  const unstated = { ...HYPOTHESIS, scope: undefined };
  const p2 = makePortfolio();
  const r2 = await runWithPortfolio(p2, { hypotheses: [unstated] });
  assert.equal(r2.clusters[0].scope, "unstated");
  assert.equal(p2.ingestCalls.length, 0, "an unreadable scope must not be treated as quay_generic (硬规则 3b)");
});

// ── the confirmation bar (OSD's, not a second one) ──────────────────────────────────────────────────
test("the confirmation bar needs BOTH the verifier and an independent refuter, and an undetermined refuter confirms nothing", () => {
  assert.equal(isConfirmed("supported", "supported", null), true);
  assert.equal(isConfirmed("supported", "supported", "no-counter-evidence"), false, "a refuter that could not examine the positions confirms NOTHING");
  assert.equal(isConfirmed("supported", "undetermined", null), false);
  assert.equal(isConfirmed("supported", "refuted", null), false);
  assert.equal(isConfirmed("undetermined", "supported", null), false);
  assert.equal(isConfirmed(undefined, "supported", null), false);
  assert.equal(verdictOf({ verdict: "supported" }), "supported");
  assert.equal(verdictOf({ verdict: "definitely-a-bug" }), "undetermined", "an out-of-vocabulary verdict must never read as a confirmation");
  assert.equal(verdictOf(null), "undetermined");
});

test("a refuted cluster is recorded with the refuter's counterexample and writes nothing", async () => {
  const portfolio = makePortfolio();
  const base = tmpdir();
  const root = path.join(base, "ws");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  const { module } = makeHyp({ verdicts: ["supported", "refuted"] });
  const { spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", src)] }),
    configPresent: true, hypModule: module, portfolioModule: portfolio.module, spawnFn: spawn, scratchRoot: tmpdir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(fact.state, "verified", fact.reason);
  const cluster = readCarrier(root).find((r) => r.kind === "dogfood-cluster");
  assert.equal(cluster.verifier_verdict, "supported");
  assert.equal(cluster.refutation_verdict, "refuted");
  assert.equal(cluster.refutation_counterexample, "counter-observation");
  assert.equal(cluster.confirmed, false);
  assert.equal(portfolio.ingestCalls.length, 0);
});

// ── the digest (counts + excerpts, never a verdict) ─────────────────────────────────────────────────
test("the artifact digest reports reading/line-provenance and never invents a line number for a tail read", () => {
  const base = tmpdir();
  const root = makeSourceProject(path.join(base, "alpha"), {
    outcomes: [{ kind: "worker", final_state: "completed", exit_code: 0 }, { kind: "worker", final_state: "exited-not-landed", exit_code: 0 }, { kind: "fan-in", final_state: "landed" }],
  });
  const full = scanJsonlArtifact("alpha", root, ".quay/worker-outcome.jsonl", { maxRecords: 2, maxFileBytes: 1_000_000 });
  assert.equal(full.reading, "ok");
  assert.equal(full.lines, 3);
  assert.equal(full.samples.length, 2, "samples come from the RECENT end, bounded by maxRecords");
  assert.deepEqual(full.samples.map((s) => s.line), [2, 3], "sample provenance must be the ABSOLUTE carrier line");
  assert.deepEqual(full.counts.final_state, { completed: 1, "exited-not-landed": 1, landed: 1 });

  const absent = scanJsonlArtifact("alpha", root, ".quay/not-there.jsonl", { maxRecords: 5, maxFileBytes: 1_000 });
  assert.equal(absent.reading, "absent");
  assert.equal(absent.reason, "file not present", "an absent file is a NAMED reading, never a silent zero");

  const tail = scanJsonlArtifact("alpha", root, ".quay/worker-outcome.jsonl", { maxRecords: 5, maxFileBytes: 40 });
  assert.equal(tail.reading, "truncated-tail");
  assert.equal(tail.lines, null, "a tail read cannot know absolute line numbers — absent, never guessed");
  assert.ok(tail.samples.every((s) => s.line === null));

  const tasks = scanTasksDir("alpha", root, { maxFiles: 10, headBytes: 4096 });
  assert.equal(tasks.error, null);
});

test("the project scan marks a task count taken over a PREFIX as not-a-census", () => {
  const base = tmpdir();
  const tasks = {};
  for (let i = 0; i < 5; i++) tasks[`t-${i}`] = "done";
  const root = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "w" }], tasks });
  const scan = scanSourceProject(project("alpha", root), { maxRecords: 3, maxFileBytes: 1_000_000, maxBytes: 1_000_000 });
  assert.equal(scan.reading, "ok");
  assert.equal(scan.task_counts.done, 5);
  assert.equal(scan.task_counts_censused, true);
  const pack = renderEvidencePack([scan]);
  assert.match(pack, /## source project "alpha"/);
  assert.match(pack, /5\/5 files read/);
});

test("a root that is a FILE, not a directory, is root-unreadable rather than an empty project", () => {
  const base = tmpdir();
  const asFile = path.join(base, "not-a-dir");
  fs.writeFileSync(asFile, "x");
  const scan = scanSourceProject(project("alpha", asFile), { maxRecords: 3, maxFileBytes: 1_000, maxBytes: 1_000 });
  assert.equal(scan.reading, "root-unreadable");
  assert.match(scan.reason, /is not a directory/);
});

// ── the filed task body carries its own provenance ──────────────────────────────────────────────────
test("the filed task body carries the round, the source project, the cited positions and both verdicts", () => {
  const entry = {
    round_id: "cpd-1-2-ab", record_id: "cpd-1-2-ab::c1", cluster: 1,
    claim: "the fan-in loser is counted as a worker failure", components: ["plugin/scripts/worker-driver.ts"],
    source_project: "claudecodeui", verifier_verdict: "supported", refutation_verdict: "supported",
    evidence: [{ file: ".quay/worker-outcome.jsonl", line: 1327, excerpt: "final_state=exited-not-landed" }],
  };
  const body = renderFiledTaskBody(entry, []);
  assert.match(body, /## Proposal/);
  assert.match(body, /cpd-1-2-ab/);
  assert.match(body, /claudecodeui/);
  assert.match(body, /\.quay\/worker-outcome\.jsonl:1327/);
  assert.match(body, /verifier verdict: `supported`; refuter verdict: `supported`/);
  assert.match(body, /## Acceptance Criteria/);
  assert.match(body, /## Definition of Done/);
});
