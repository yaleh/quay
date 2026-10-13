// cross-project-dogfood-routine.test.mjs — the cross-project dogfood routine's own judgements, each
// pinned to a real predicate (never to a proxy): the read-only isolation invariant (static + runtime +
// a real round against a permission-restricted copy), the config schema, the hard reservation ledger and
// its kill switch, the root-unreadable reading, due/last-run stamping, the OSD confirmation bar, the
// Portfolio dedup path, and the scope guard that keeps a project-local item out of the Portfolio.
//
// The engine (`docs/analysis/arch-hypothesis-generation.mjs`) is reached ONLY through the module's own
// seams: every round in this file runs against an injected `hypModule`, which is exactly the seam the
// module exposes. Its two STRUCTURAL READERS (`streamDiagnostics`, `parseVerifierStream`) and its pure
// verdict mapper (`verifierVerdict`) ARE imported — deliberately, and only those three — because the task
// this file pins requires the routine to consume the ENGINE's readers rather than a second copy of them
// (硬规则 5b): stubbing them here would make the classification assertions prove nothing about what
// production reads. Real rounds against real artifacts are pasted as evidence in the task body, not
// asserted here (a fixture can prove "it can produce a reading", never "production produced one" —
// 硬规则 4 推论三).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

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
  verifierLookupPreamble,
  filedTaskId,
  truncateOnWord,
  crossProjectRecordId,
  selectClustersForVerification,
  writeOwnedFile,
  CALL_CAPTURE_DIR_REL,
} from "../scripts/cross-project-dogfood-routine.ts";
import { INVOKED_BY_MANUAL, INVOKED_BY_RESIDENT } from "../scripts/discovery-method-routine.ts";
import {
  RETRYABLE_CALL_FAILURES,
  callFailureClass,
} from "../scripts/open-semantic-discovery-routine.ts";
// ⛔ The ENGINE's OWN readers, imported so the injected `hypModule` below delegates to them instead of
// re-implementing them. That is the whole point of AC1: if this file carried its own `streamDiagnostics`,
// the assertion "the call is classified from the stream" would be a tautology about the fixture.
import { streamDiagnostics, parseVerifierStream, verifierVerdict, runVerifier as realRunVerifier } from "../../docs/analysis/arch-hypothesis-generation.mjs";
import { artifactsComplete, detectShape } from "../../packages/quay/src/kernel/task-shape-artifacts.ts";

const ROUTINE_SRC = new URL("../scripts/cross-project-dogfood-routine.ts", import.meta.url);

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
// Every temp tree this file makes is registered here and removed once, at the end: an unpaired
// mkdtemp leaks a directory per run, and this suite runs hundreds of times a day.
const _tmpDirs = [];
after(() => {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
function tmpDir(prefix = "cpd-test-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(d);
  return d;
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
      // The engine's OWN readers, not a second copy — see the import block above.
      streamDiagnostics,
      parseVerifierStream,
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

/** The `stream-json` a REAL successful call leaves behind: an `init` event naming the served model, then
 *  the `result` event. ⛔ An empty stdout is NOT a representative success — since this task a call is only
 *  "it ran" when its stream carries a `result` event, so a fixture returning `""` would be describing a
 *  result-less call while pretending to be a clean one (硬规则 3b). */
const OK_STREAM = [
  JSON.stringify({ type: "system", subtype: "init", model: "claude-fixture-1" }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "{}" }] } }),
  JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 3, result: "{}", usage: { input_tokens: 11, output_tokens: 7 } }),
].join("\n") + "\n";

function makeSpawn({ stdout = OK_STREAM, stderr = "", status = 0, error = null } = {}) {
  const seen = [];
  const spawn = async (argv, opts) => {
    seen.push({ argv, cwd: opts.cwd, timeoutMs: opts.timeoutMs, viaStdin: typeof opts.stdinData === "string" });
    return { status, signal: null, stdout, stderr, error };
  };
  return { seen, spawn };
}

/** A spawn that answers each call from a QUEUE, the last entry repeating forever. Used to pin a call
 *  SEQUENCE (investigator ok → verifier <fixture> → retry <fixture>), which a constant spawn cannot. */
function makeQueuedSpawn(responses) {
  const seen = [];
  const spawn = async (argv, opts) => {
    const r = responses.length > 1 ? responses.shift() : responses[0];
    seen.push({ argv, cwd: opts.cwd, timeoutMs: opts.timeoutMs, viaStdin: typeof opts.stdinData === "string" });
    return { status: 0, signal: null, stderr: "", error: null, ...r };
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
  const src = makeSourceProject(path.join(tmpDir(), "src"));
  declareSourceRoot(src, "alpha");
  try {
    assert.throws(() => writeOwnedFile(path.join(src, "sneak.txt"), "x"), /CROSS_PROJECT_SOURCE_WRITE_REFUSED .*"alpha"/, "a write into the source project must be refused BY NAME");
    assert.throws(() => writeOwnedFile(path.join(src, ".quay", "worker-outcome.jsonl"), "x"), /CROSS_PROJECT_SOURCE_WRITE_REFUSED/, "even a path that already exists there is refused");
    assert.equal(fs.existsSync(path.join(src, "sneak.txt")), false, "nothing may have been created");
    // A sibling directory whose name merely STARTS with the root's is NOT inside it (position, not prefix
    // string — 硬规则 2).
    assert.equal(sourceRootOwning(`${src}-sibling`), null);
    const mine = path.join(tmpDir(), "own");
    writeOwnedFile(path.join(mine, "ok.txt"), "hello");
    assert.equal(fs.readFileSync(path.join(mine, "ok.txt"), "utf8"), "hello");
    // The spawn-cwd check is the same check.
    assert.throws(() => assertNotSourceRoot(src, "spawn cwd for step x"), /CROSS_PROJECT_SOURCE_WRITE_REFUSED/);
  } finally {
    clearSourceRoots();
  }
});

test("AC1(c) REAL RUN against a permission-restricted copy — the source tree is byte-identical afterwards", async () => {
  const base = tmpDir();
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
    const root = tmpDir();
    const { module } = makeHyp();
    const { seen, spawn } = makeSpawn();
    const fact = await runCrossProjectDogfood(root, {
      config: cfg({ sourceProjects: [project("alpha", src)] }),
      configPresent: true,
      hypModule: module,
      portfolioModule: null,
      spawnFn: spawn,
      scratchRoot: tmpDir(),
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
  const root = tmpDir();
  const { module } = makeHyp();
  const { seen, spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, { config: read.config, configPresent: true, hypModule: module, spawnFn: spawn, scratchRoot: tmpDir() });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:disabled/);
  assert.equal(seen.length, 0, "a disabled round must spawn nothing");
  assert.equal(fs.existsSync(path.join(root, CARRIER_REL)), false, "a disabled round must not even create the carrier");
});

test("AC2(b) the 24h call cap is a HARD pre-spawn reservation, and hitting it refuses the round with zero calls", async () => {
  const base = tmpDir();
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
    scratchRoot: tmpDir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:budget-24h/);
  assert.equal(seen.length, 0, "a round refused by the cap must spawn nothing");
  assert.equal(fact.value.budget_24h.used_at_start, 1);
});

test("AC2(c) a round that runs really writes reserve lines, and a mid-round refusal stops it with the cause named", async () => {
  const base = tmpDir();
  const root = path.join(base, "ws");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  const { module } = makeHyp();
  const { spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", src)] }),
    configPresent: true,
    hypModule: module,
    spawnFn: spawn,
    scratchRoot: tmpDir(),
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
    scratchRoot: tmpDir(),
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
  const base = tmpDir();
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
    scratchRoot: tmpDir(),
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
  const base = tmpDir();
  const root = path.join(base, "ws");
  const { module } = makeHyp();
  const { seen, spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("a", path.join(base, "nope-a")), project("b", path.join(base, "nope-b"))] }),
    configPresent: true,
    hypModule: module,
    spawnFn: spawn,
    scratchRoot: tmpDir(),
    now: () => 1_800_000_000_000,
  });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:no-readable-source-project/);
  assert.equal(seen.length, 0);
});

// ── due / last-run / invoked_by ─────────────────────────────────────────────────────────────────────
test("not-due is its own reading, and a completed round advances the last-run stamp WITH its invoked_by", async () => {
  const base = tmpDir();
  const root = path.join(base, "ws");
  const lastRun = path.join(root, ".quay", "routine-last-run.json");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "completed", exit_code: 0 }] });
  const { module } = makeHyp();
  const { spawn } = makeSpawn();
  const common = { config: cfg({ sourceProjects: [project("alpha", src)] }), configPresent: true, hypModule: module, spawnFn: spawn, scratchRoot: tmpDir(), lastRunPath: lastRun };

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

test("an investigator subprocess that EXITS NONZERO fails the round and does not advance the last-run stamp", async () => {
  const base = tmpDir();
  const root = path.join(base, "ws");
  const lastRun = path.join(root, ".quay", "routine-last-run.json");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "completed", exit_code: 0 }] });
  const { module } = makeHyp();
  const failCalls = [];
  const failingSpawn = async () => {
    failCalls.push(1);
    return { status: 1, signal: null, stdout: "", stderr: "boom", error: null };
  };
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", src)] }),
    configPresent: true, hypModule: module, spawnFn: failingSpawn, scratchRoot: tmpDir(), lastRunPath: lastRun,
    now: () => 1_800_000_000_000, retryBackoffMs: 0,
  });
  assert.equal(fact.state, "failed", "a dead subprocess is not a round that found nothing (硬规则 3b)");
  // ⛔ The token CHANGED with this task, and the change is the point: `exit-1` was the whole record before
  // (7 production calls read exactly that and nothing else). Now the exit reading is `uninstrumented-…`
  // — the stream was never even readable — while the CLASS (`no-stdout`) says what the bytes were.
  assert.match(fact.reason, /not-evaluated:uninstrumented-exit-1/);
  assert.equal(failCalls.length, 2, "a `no-stdout` call is RETRYABLE: exactly one retry must have fired");
  assert.equal(fact.value.calls.length, 2);
  assert.equal(fact.value.calls[0].call_failure, "no-stdout");
  assert.equal(fact.value.calls[1].retry_of, fact.value.calls[0].reservation_id, "the retry must name the reservation it repeats");
  assert.equal(fact.value.calls[1].retry_cause, "no-stdout");
  assert.equal(fact.value.calls[1].ok, false, "a retry that failed again must NOT be laundered into a clean pass");
  assert.equal(fs.existsSync(lastRun), false, "a failed round must not advance the last-run stamp");
  assert.equal(readCarrier(root).filter((r) => r.kind === "dogfood-round").length, 0, "a failed round writes no round line");

  // Negative control: the SAME fixture with a clean exit and an EMPTY hypothesis array is a real
  // "looked and found nothing" — verified, stamped, and recorded as 0 hypotheses.
  const clean = makeHyp({ hypotheses: [] });
  const root2 = path.join(base, "ws2");
  const lastRun2 = path.join(root2, ".quay", "routine-last-run.json");
  const ok = await runCrossProjectDogfood(root2, {
    config: cfg({ sourceProjects: [project("alpha", src)] }),
    configPresent: true, hypModule: clean.module, spawnFn: makeSpawn().spawn, scratchRoot: tmpDir(), lastRunPath: lastRun2,
    now: () => 1_800_000_000_000,
  });
  assert.equal(ok.state, "verified", ok.reason);
  assert.equal(ok.value.hypotheses, 0);
  assert.equal(JSON.parse(fs.readFileSync(lastRun2, "utf8"))[CROSS_PROJECT_DOGFOOD_NAME], 1_800_000_000_000, "a real empty round DOES advance the stamp");
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
        // ⛔ ORDERING CONTRACT, enforced rather than assumed: the REAL module resolves `origin_ref` by
        // reading the record out of the round's carrier, so an ingest that arrives before its cluster
        // line is on that carrier is refused with ORIGIN_REF_UNRESOLVED — measured 2026-10-13. A stub
        // that only recorded the call would not notice the two being swapped.
        const carrier = path.join(root, CARRIER_REL);
        const present = fs.existsSync(carrier) && fs.readFileSync(carrier, "utf8").includes(`"record_id":"${input.finding_id}"`);
        if (!present) return { ok: false, reasons: [`ORIGIN_REF_UNRESOLVED:${input.finding_id}-names-no-record-in-${CARRIER_REL}`] };
        ingestCalls.push(input);
        return failIngest ? { ok: false, reasons: ["REFUSED_BY_FIXTURE"] } : { ok: true, id: input.finding_id };
      },
    },
  };
}

async function runWithPortfolio(portfolio, { cfgOver = {}, hypotheses } = {}) {
  const base = tmpDir();
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
    scratchRoot: tmpDir(),
    now: () => 1_800_000_000_000,
  });
  const rounds = readCarrier(root).filter((r) => r.kind === "dogfood-round");
  // The cluster lines are IMMUTABLE origin records (they must be on the carrier before the Portfolio is
  // asked to resolve their record_ids), so what happened to each one lives on the round's `ingestion`.
  return { fact, root, clusters: readCarrier(root).filter((r) => r.kind === "dogfood-cluster"), rounds, ingestion: rounds.at(-1)?.ingestion ?? [] };
}

test("AC4(a) a claim+components set already on the Portfolio is recognised as a duplicate and writes NO second row", async () => {
  const existing = [{
    id: "pf-existing-1", finding_id: "osd-existing", duplicate_of: null,
    components: ["plugin/scripts/worker-driver.ts"],
    claim: "The   FAN-IN loser is recorded as a worker failure so the project's own defect rate overcounts",
    outcome: "supported",
  }];
  const portfolio = makePortfolio({ existing });
  const { fact, clusters, rounds, ingestion } = await runWithPortfolio(portfolio, { hypotheses: [HYPOTHESIS] });
  assert.equal(fact.state, "verified", fact.reason);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].confirmed, true, "the confirmation bar must have been met for this arm to test dedup at all");
  assert.equal(portfolio.ingestCalls.length, 0, "a duplicate must NOT reach the Portfolio writer");
  assert.equal(ingestion[0].written, false);
  assert.equal(ingestion[0].duplicate_of, "pf-existing-1", "the existing row must be NAMED");
  assert.equal(rounds.at(-1).duplicates, 1);

  // Negative control: the SAME run with a claim that differs by one word is NOT a duplicate ⇒ the writer
  // IS reached. Without this arm, "ingest never called" would be indistinguishable from "ingest broken".
  const other = makePortfolio({ existing: [{ ...existing[0], claim: "a completely different claim about something else entirely" }] });
  const ctrl = await runWithPortfolio(other, { hypotheses: [HYPOTHESIS] });
  assert.equal(other.ingestCalls.length, 1, "a non-matching claim must reach the writer — otherwise the duplicate arm proves nothing");
  assert.equal(ctrl.ingestion[0].written, true);
});

test("AC4(b) a project_local claim is neither ingested nor filed, even when it is confirmed", async () => {
  const localHyp = { ...HYPOTHESIS, scope: "project_local", claim: "the project's own UI copy doubles a button label in its settings sheet", components: ["src/components/Settings.tsx"] };
  const portfolio = makePortfolio();
  const { clusters, rounds, ingestion } = await runWithPortfolio(portfolio, {
    hypotheses: [localHyp],
    cfgOver: { fileConfirmed: true },
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].confirmed, true, "the scope guard, not the confirmation bar, is what this arm tests");
  assert.equal(clusters[0].scope, "project_local");
  assert.equal(portfolio.ingestCalls.length, 0, "a project-local item must never reach the Portfolio");
  assert.equal(ingestion[0].written, false);
  assert.match(String(ingestion[0].skipped), /^scope:project_local/);
  assert.equal(rounds.at(-1).filed.length, 0, "a project-local item must file NOTHING");
  assert.deepEqual(rounds.at(-1).scope_split, { quay_generic: 0, project_local: 1 });

  // The fail-closed half: an UNSTATED scope is not a Quay-generic claim either.
  const unstated = { ...HYPOTHESIS, scope: undefined };
  const p2 = makePortfolio();
  const r2 = await runWithPortfolio(p2, { hypotheses: [unstated] });
  assert.equal(r2.clusters[0].scope, "unstated");
  assert.equal(r2.ingestion[0].written, false);
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
  const base = tmpDir();
  const root = path.join(base, "ws");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  const { module } = makeHyp({ verdicts: ["supported", "refuted"] });
  const { spawn } = makeSpawn();
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", src)] }),
    configPresent: true, hypModule: module, portfolioModule: portfolio.module, spawnFn: spawn, scratchRoot: tmpDir(),
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
  const base = tmpDir();
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
  const base = tmpDir();
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
  const base = tmpDir();
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
  // The SHAPE is load-bearing: without `## Plan` the author→ready gate's plan-shape recognizer would not
  // see four artifacts, and without `## Touches` the task could never be dispatched.
  assert.match(body, /## Plan\n/);
  assert.match(body, /## Touches\n/);
  assert.match(body, /- `plugin\/scripts\/worker-driver\.ts`/);
  assert.ok(body.includes(`\`tasks/${filedTaskId(entry)}.md\``), "the task must declare its OWN file in Touches");
  // ⛔ The filed task must be PROMOTABLE. A body the author→ready gate cannot recognize would make the
  // whole point of filing it (a real fix landing on Quay's tree) unreachable, and nothing else in this
  // file would notice — so the SAME shape judge the pool uses is run against the rendered body.
  assert.equal(detectShape(body), "plan");
  assert.deepEqual(artifactsComplete(body), { shape: "plan", complete: true, artifacts: { proposal: true, plan: true, ac: true, dod: true }, missing: [] });
});

test("the Portfolio's OWN resolveOriginRef resolves the exact record_id this routine writes (the carrier agreement)", async () => {
  // ⛔ This is the pin the OSD module's doc comment describes for ITS carrier, applied to this one, and it
  // is not decoration: measured 2026-10-13, a round whose record_id lacked the carrier prefix had EVERY
  // confirmed finding refused at ingestion with `ORIGIN_REF_UNRESOLVED:…-names-no-record-in-
  // .quay/routine-findings.jsonl` — the failure named the wrong carrier, so it read like a data problem
  // rather than a missing branch. The ref prefix is what selects the carrier, and only this assertion
  // keeps the two literals in step.
  const repo = path.join(tmpDir(), "portfolio-root");
  fs.mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  const recordId = crossProjectRecordId("cpd-1-2-abcdef", "c1");
  writeJsonl(path.join(repo, ".quay", "cross-project-dogfood-findings.jsonl"), [{
    kind: "dogfood-cluster", round_id: "cpd-1-2-abcdef", record_id: recordId, ts: "2026-10-13T09:47:51.000Z",
    components: ["plugin/scripts/driver-runtime.ts"], claim: "a claim",
  }]);
  const { resolveOriginRef } = await import("../../docs/analysis/discovery-portfolio.mjs");
  const resolved = resolveOriginRef(repo, { origin: "autonomous-routine", origin_ref: recordId });
  assert.equal(resolved.ok, true, `the Portfolio must resolve this routine's ref: ${resolved.reason}`);
  assert.equal(resolved.carrier, ".quay/cross-project-dogfood-findings.jsonl");
  assert.deepEqual(resolved.components, ["plugin/scripts/driver-runtime.ts"], "the components must be read off the carrier record");
  // Negative control: a bare `<round>::c1` (the pre-fix shape) must NOT resolve — otherwise this test
  // would pass for any ref at all.
  assert.equal(resolveOriginRef(repo, { origin: "autonomous-routine", origin_ref: "cpd-1-2-abcdef::c1" }).ok, false);
});

test("the verifier/refuter preamble names the repo root, each readable project root and the cited positions", () => {
  // Without this, a verifier rooted in the round's scratch dir cannot open a single repo-relative path
  // and every verdict comes back undetermined — a whole round spent proving the prompt was incomplete.
  const scan = { name: "alpha", root: "/tmp/alpha", reading: "ok", reason: null, artifacts: [], task_counts: {}, task_lines: [], task_files_scanned: 0, task_files_total: 0, task_counts_censused: false, bytes_read: 0 };
  const unreadable = { ...scan, name: "third", root: "/tmp/nope", reading: "root-unreadable", reason: "ENOENT" };
  const preamble = verifierLookupPreamble([scan, unreadable], [{ source_project: "alpha", file: ".quay/worker-outcome.jsonl", line: 12, kind: "worker", excerpt: "final_state=exited-not-landed" }], "/repo");
  assert.match(preamble, /the Quay repository this round judges → \/repo/);
  assert.match(preamble, /source project "alpha" → \/tmp\/alpha/);
  assert.doesNotMatch(preamble, /\/tmp\/nope/, "an unreadable project's root must not be offered as a place to read");
  assert.match(preamble, /alpha: `\.quay\/worker-outcome\.jsonl:12`/);
});

test("the filed task id is deterministic, so re-running the same round addresses the same task", () => {
  const entry = { source_project: "Claude Code UI", cluster: 2, round_id: "cpd-1-2-abcdef" };
  assert.equal(filedTaskId(entry), "gap-cross-project-dogfood-claude-code-ui-c2-abcdef");
  assert.equal(filedTaskId(entry), filedTaskId({ ...entry }), "the same cluster must always resolve to the same id");
  assert.notEqual(filedTaskId(entry), filedTaskId({ ...entry, cluster: 3 }));
});

test("a filed task title is shortened on a word boundary and marked as shortened", () => {
  const long = "When the pool-quality-judge or architecture-review LLM judge prints non-JSON stdout, Quay records the whole round state=failed with zero verdicts";
  const out = truncateOnWord(long, 120);
  assert.ok(out.length <= 121, `title must fit the bound (got ${out.length})`);
  assert.ok(out.endsWith("…"), "a shortened title must say so");
  assert.doesNotMatch(out, /state=$/, "it must not cut mid-token");
  assert.ok(long.startsWith(out.slice(0, -1).trim()), "the kept text must be a prefix of the claim");
  assert.equal(truncateOnWord("short claim", 120), "short claim", "a claim that fits is returned unchanged");
});

test("the digest carries the project's OWN task titles as local material (the half the scope judgment needs)", () => {
  // Three real rounds returned ZERO project_local items because nothing in the digest said what the host
  // was working on; this block is that missing half, and it must reach the pack with provenance.
  const base = tmpDir();
  const root = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "w" }], tasks: { "t-1": "done", "t-2": "needs-human" } });
  fs.writeFileSync(path.join(root, "tasks", "t-1.md"), "---\nid: t-1\nstatus: done\ntitle: the host's own voice feature\n---\n\n# t-1\n", "utf8");
  const scan = scanSourceProject(project("alpha", root), { maxRecords: 5, maxFileBytes: 1_000_000, maxBytes: 1_000_000 });
  assert.equal(scan.task_titles.length, 2);
  assert.ok(scan.task_titles.every((t) => t.source_project === "alpha" && t.file.startsWith("tasks/")), "each title keeps its provenance");
  const pack = renderEvidencePack([scan]);
  assert.match(pack, /### local material — the project's OWN task titles/);
  assert.match(pack, /the host's own voice feature/);
});

test("the verification budget reserves a slot for the project_local control arm", () => {
  // Measured 2026-10-13 across four real rounds: the engine orders clusters by confidence, so a plain
  // slice(0, cap) spent the whole budget on quay_generic clusters while the project_local items the
  // investigator HAD produced sat past the cap — never verified, never recorded, and scope_split read
  // "project_local: 0" although the model had classified two.
  const g = (n) => ({ rep: { scope: "quay_generic", claim: `q${n}`, components: [`f${n}.ts`] } });
  const l = (n) => ({ rep: { scope: "project_local", claim: `p${n}`, components: [`h${n}.ts`] } });
  const got = selectClustersForVerification([g(1), g(2), g(3), l(1), l(2)], 3);
  assert.deepEqual(got.map((c) => c.rep.claim), ["q1", "q2", "p1"], "two Quay-side clusters and the control, in round order");
  assert.equal(got.length, 3, "the cap is respected — the control is RESERVED a slot, not added on top");
  // Below the cap nothing is dropped, and no slot is taken from the primary product when there is no room.
  assert.equal(selectClustersForVerification([g(1), l(1)], 3).length, 2);
  assert.deepEqual(selectClustersForVerification([g(1), g(2), l(1)], 1).map((c) => c.rep.claim), ["q1"], "a cap of 1 goes to the round's primary product");
  assert.deepEqual(selectClustersForVerification([g(1), l(1), l(2)], 3).map((c) => c.rep.claim), ["q1", "p1", "l2".replace("l2", "p2")], "spare slots stay filled");
  assert.deepEqual(selectClustersForVerification([g(1), g(2), g(3)], 2).map((c) => c.rep.claim), ["q1", "q2"], "no control ⇒ an ordinary prefix");
});

// ── the ATTRIBUTION + RETRY layer ───────────────────────────────────────────────────────────────────
// WHAT THIS BLOCK PINS (task gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-
// unattributed-exit1): the routine's call path now consumes OSD's OWN attribution machinery, so a call
// that produced no answer is ATTRIBUTABLE — an enumerated class, the stream's structural readings, the
// bounded bytes on disk — and a RETRYABLE one gets exactly ONE counted retry.
//
// The seven historical production calls (5 verifier + 2 refuter across rounds cpd-3283888 / cpd-3716725 /
// cpd-943549 / cpd-1241325) each read, in full:
//   {"step":"cross-project-verifier","reservation_id":"dmr-3716725-1-165jinxk","ok":false,
//    "not_evaluated":"not-evaluated:exit-1","turns":null,"exit":1}
// — no stdout, no stderr, no wall time, no signal, no timeout flag, no model. A crashed CLI, a non-JSON
// reply, a provider API error and an environment fault were the SAME record, and none was retried.

const SYS_EVENT = JSON.stringify({ type: "system", subtype: "init", model: "claude-fixture-1" });
const ASSIST_EVENT = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "reasoning…" }] } });

/** The SEVEN historical shapes as the launcher's own bytes. Six are spawn outcomes; the seventh (a budget
 *  refusal) is not a spawn at all — it is the ordinary `BUDGET_REFUSED` throw, pinned separately below. */
const SHAPES = [
  {
    name: "no-stdout", status: 1, stdout: "", stderr: "",
    class: "no-stdout", has_result: false, not_evaluated: "not-evaluated:uninstrumented-exit-1", retryable: true,
  },
  {
    name: "stream-without-result", status: 1, stdout: `${SYS_EVENT}\n${ASSIST_EVENT}\n`, stderr: "",
    class: "stream-without-result", has_result: false, not_evaluated: "not-evaluated:uninstrumented-exit-1", retryable: true,
  },
  {
    // The gateway answering an unknown model: `subtype:"success"` and `is_error:true` on the SAME result
    // event — the shape whose subtype is NOT a usable name, which is why the class keys on the stream
    // reader's own `api_error_event` predicate instead.
    name: "api-error-event", status: 1, stderr: "",
    stdout: `${JSON.stringify({ type: "system", subtype: "error", error: "model_not_found" })}\n${JSON.stringify({ type: "result", subtype: "success", is_error: true, num_turns: 0 })}\n`,
    class: "api-error-event", has_result: true, not_evaluated: "not-evaluated:api-error-event", retryable: true,
  },
  {
    // Cut MID-WRITE: the last non-empty line begins with `{` and never parses. Deliberately NOT retryable
    // — a stream cut short usually means the ceiling was reached, and re-spending a reservation cuts it
    // in the same place.
    name: "truncated-json", status: 1, stderr: "",
    stdout: `${SYS_EVENT}\n{"type":"assistant","message":{"content":[{"type":"te`,
    class: "truncated-json", has_result: false, not_evaluated: "not-evaluated:uninstrumented-exit-1", retryable: false,
  },
  {
    // A clean exit 1 whose own stream names the REAL error, with stderr corroborating it: the CLI exited
    // 1 after running, and the cap it hit is a budget fact the stream states itself. There is no
    // `call_failure` class to key a retry on — re-spending a reservation would only hit the same cap.
    name: "clean-named-failure", status: 1, stderr: "Error: Reached max turns (12)\n",
    stdout: `${SYS_EVENT}\n${JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 12 })}\n`,
    class: null, has_result: true, not_evaluated: "not-evaluated:error_max_turns", retryable: false,
  },
  {
    // ALSO a clean exit 1 with real stderr naming the error, but the stream is NOT the launcher's own
    // envelope at all (plain text on stdout). ⛔ The honest reading is `unclassified` — "the bytes match
    // no known shape" — which is a READING, not an absence of one; it is deliberately not on OSD's retry
    // list, and this arm is what keeps the retry bounded to the three classes it is meant for.
    name: "unclassified-plain-text", status: 1, stderr: "Error: unable to resolve project root '/nope'\n",
    stdout: "fatal: could not read configuration\n",
    class: "unclassified", has_result: false, not_evaluated: "not-evaluated:uninstrumented-exit-1", retryable: false,
  },
  {
    // The timeout reaper: no exit code at all (the child was SIGKILLed), so the spawn wrapper's own
    // message is the only in-band signal. NOT retryable — the ceiling was reached.
    name: "killed-by-timeout", status: null, stdout: "", stderr: "", error: new Error("spawn timeout after 1000ms (SIGKILL): stub-launcher"),
    class: "killed-by-timeout", has_result: false, not_evaluated: "not-evaluated:killed-by-timeout", retryable: false,
  },
];

/** ⛔ THE NEGATIVE CONTROL — the pre-task reading, quoted verbatim from the two lines this task replaced
 *  inside `reservingStep`:
 *      const outcome = res.error ? "timeout" : res.status === 0 ? "completed" : "failed";
 *      const notEvaluated = res.error ? `not-evaluated:spawn-${outcome}`
 *                                     : res.status !== 0 ? `not-evaluated:exit-${res.status}` : null;
 *  It reads NOTHING of the bytes, so on these fixtures it must collapse every spawn shape to one string —
 *  which is exactly what the production carrier shows for all seven historical calls. A fixture set that
 *  the OLD reading already distinguished would prove nothing about the fix. */
function preFixNotEvaluated(status, error) {
  const outcome = error ? "timeout" : status === 0 ? "completed" : "failed";
  return error ? `not-evaluated:spawn-${outcome}` : status !== 0 ? `not-evaluated:exit-${status}` : null;
}

/** Run ONE real round in which the investigator succeeds and every later call returns `shape`'s bytes —
 *  so a retry, if one fires, repeats the SAME fixture. Returns the persisted round line, which is where
 *  the reading has to survive (the fact value alone would not prove it reached the carrier). */
async function roundWithVerifierShape(shape, { retryBackoffMs = 0, cfgOver = {}, realVerifier = false } = {}) {
  const base = tmpDir();
  const root = path.join(base, "ws");
  const src = makeSourceProject(path.join(base, "alpha"), { outcomes: [{ kind: "worker", final_state: "exited-not-landed", exit_code: 0 }] });
  // `undetermined` for the verifier keeps the refuter out of the call sequence, so the byte index of
  // every assertion below is stable.
  const { module: stub } = makeHyp({ verdicts: ["undetermined"] });
  // ⛔ `realVerifier` swaps in the ENGINE's own `runVerifier`, so the persisted verdict is a reading of
  // the returned bytes rather than a value a fixture queued. It is the only way to assert "the cluster
  // stays undetermined" without that assertion being about the stub.
  const module = realVerifier ? { ...stub, runVerifier: realRunVerifier } : stub;
  const { spawn, seen } = makeQueuedSpawn([{ stdout: OK_STREAM }, shape]);
  const fact = await runCrossProjectDogfood(root, {
    config: cfg({ sourceProjects: [project("alpha", src)], ...cfgOver }),
    configPresent: true, hypModule: module, spawnFn: spawn, scratchRoot: tmpDir(),
    now: () => 1_800_000_000_000, retryBackoffMs,
  });
  const carrier = readCarrier(root);
  return { fact, root, seen, roundLine: carrier.find((r) => r.kind === "dogfood-round"), clusters: carrier.filter((r) => r.kind === "dogfood-cluster") };
}

test("AC1: each historical shape is classified by the REUSED callFailureClass/streamDiagnostics, and the pre-fix reading collapses them all", async () => {
  const oldReadings = new Set();
  const newClasses = new Set();
  const newTokens = new Set();

  for (const shape of SHAPES) {
    const { fact, root, roundLine } = await roundWithVerifierShape(shape);
    const where = `shape=${shape.name}`;
    assert.equal(fact.state, "verified", `${where}: the round itself completes — a failed VERIFIER call is not a failed round (${fact.reason})`);
    assert.ok(roundLine, `${where}: the round line must exist`);
    // calls[0] = investigator (clean), calls[1] = the verifier call under test, calls[2] = its retry.
    const n = shape.retryable ? 3 : 2;
    assert.equal(roundLine.calls.length, n, `${where}: expected investigator + verifier${shape.retryable ? " + ONE retry" : " and NO retry"}`);
    const rec = roundLine.calls[1];
    assert.equal(rec.step, "cross-project-verifier", where);

    // ── THE CLASS, read by the ENGINE's own function off the ENGINE's own diagnostics of these bytes ──
    const diag = streamDiagnostics(shape.stdout);
    const expected = callFailureClass({
      timed_out: Boolean(shape.error), stdout_bytes: diag.bytes, json_lines: diag.json_lines,
      truncated_json: diag.truncated_json, api_error_event: diag.api_error_event, has_result: diag.has_result,
    });
    assert.equal(rec.call_failure, expected, `${where}: the record's class must be the reused classifier's answer on the same bytes`);
    assert.equal(rec.call_failure, shape.class, `${where}: class`);
    assert.equal(rec.has_result, shape.has_result, `${where}: has_result`);
    assert.equal(rec.not_evaluated, shape.not_evaluated, `${where}: the token`);
    assert.equal(rec.ok, false, `${where}: a call that produced no answer is never ok`);
    assert.equal(rec.stdout_bytes, Buffer.byteLength(shape.stdout, "utf8"), `${where}: the byte count is the stream's, not a guess`);

    // ── THE RETAINED BYTES ─────────────────────────────────────────────────────────────────────────
    // ⛔ The direct reading of AC1: the capture file must EXIST on disk and carry the stream, because the
    // whole defect was that the bytes were in hand and then lost. "no bytes to show" and "no capture
    // file" must stay different readings (硬规则 3b), so the path is asserted non-null AND stat-ed.
    assert.ok(rec.stdout_capture && typeof rec.stdout_capture.path === "string", `${where}: a result-less call must carry a capture path`);
    assert.ok(rec.stdout_capture.path.startsWith(`${CALL_CAPTURE_DIR_REL}/`), `${where}: the capture lives in THIS routine's own directory, not OSD's (${rec.stdout_capture.path})`);
    const capAbs = path.join(root, rec.stdout_capture.path);
    assert.ok(fs.existsSync(capAbs), `${where}: the capture file must exist at ${capAbs}`);
    assert.match(fs.readFileSync(capAbs, "utf8"), /# stdout head/, `${where}: the capture must be the bounded head/tail rendering`);

    oldReadings.add(preFixNotEvaluated(shape.status, shape.error));
    newClasses.add(String(rec.call_failure));
    newTokens.add(String(rec.not_evaluated));
  }

  // ── THE NEGATIVE CONTROL, both halves ────────────────────────────────────────────────────────────
  // Half one: the PRE-FIX reading is DEGENERATE on exactly the shapes production recorded. Every one of
  // the seven historical calls was a `exit:1` spawn with no `error`, so the old expression — which never
  // looked at the bytes — produced the ONE string `not-evaluated:exit-1` for all of them, whatever the
  // stream said. (It did split a spawn ERROR off as `spawn-timeout`; that is the whole of its resolving
  // power, and it is not what any of the seven were.) A fixture set the old reading already
  // distinguished would prove nothing about the fix, so this half is what makes the fix falsifiable.
  const exitOneShapes = SHAPES.filter((s) => !s.error);
  assert.equal(exitOneShapes.length, 6, "six of the shapes are `exit 1` spawns — the historical shape");
  assert.deepEqual([...new Set(exitOneShapes.map((s) => preFixNotEvaluated(s.status, s.error)))], ["not-evaluated:exit-1"], "the PRE-FIX reading must collapse all six `exit 1` shapes to the single token the production carrier shows for all seven historical calls");
  assert.deepEqual([...new Set(SHAPES.map((s) => preFixNotEvaluated(s.status, s.error)))].sort(), ["not-evaluated:exit-1", "not-evaluated:spawn-timeout"], "…and that single split is its ENTIRE resolving power");
  // Half two: the fix must actually distinguish them.
  assert.ok(newClasses.size >= 5, `the fix must actually distinguish them (got ${newClasses.size} distinct classes: ${[...newClasses].join(", ")})`);
  assert.ok(newTokens.size >= 4, `...and the tokens too (got ${newTokens.size}: ${[...newTokens].join(", ")})`);
});

test("AC1(b): the capture directory is this routine's OWN sibling of OSD's, never the same one", () => {
  assert.equal(CALL_CAPTURE_DIR_REL, ".quay/cross-project-dogfood-call-captures");
  assert.notEqual(CALL_CAPTURE_DIR_REL, ".quay/open-semantic-discovery-call-captures", "the two routines' rounds must not collide on a capture filename");
});

test("AC2: exactly one retry per RETRYABLE class, through a fresh reservation on the SAME ledger; a retry that fails again stays undetermined", async () => {
  // ── (i) one retry, and it is a FRESH reservation on the same ledger ──────────────────────────────
  const shape = SHAPES.find((s) => s.name === "stream-without-result");
  const { root, seen, roundLine, clusters } = await roundWithVerifierShape(shape, { realVerifier: true });
  assert.equal(seen.length, 3, "investigator + verifier + exactly ONE retry — never two");
  assert.equal(roundLine.calls.length, 3);
  const [inv, first, retry] = roundLine.calls;
  assert.equal(inv.step, "cross-project-investigator");
  assert.equal(first.step, "cross-project-verifier");
  assert.equal(retry.step, "cross-project-verifier");
  assert.notEqual(retry.reservation_id, first.reservation_id, "the retry must take a FRESH reservation");
  assert.equal(retry.retry_of, first.reservation_id, "and name the reservation it repeats");
  assert.equal(retry.retry_cause, "stream-without-result");
  assert.equal(retry.retry_of_kind, "cross-project-verifier");

  // The ledger is the SAME one, and every reservation — the retry's included — is counted and closed.
  const ledger = fs.readFileSync(path.join(root, BUDGET_LEDGER_REL), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  const reserves = ledger.filter((l) => l.kind === "reserve");
  const outcomes = ledger.filter((l) => l.kind === "outcome");
  assert.equal(reserves.length, 3, "the retry is COUNTED: three reservations, not two");
  assert.equal(outcomes.length, reserves.length, "every reservation — the retry's included — must be closed by an outcome");
  assert.ok(reserves.some((r) => r.id === retry.reservation_id), "the retry's own reservation must be on the shared ledger");
  assert.equal(new Set(reserves.map((r) => r.round)).size, 1, "all three reservations belong to the SAME round");

  // ── (ii) the retry that ALSO failed is recorded as such and the cluster stays undetermined ────────
  // ⛔ The verdict is the ENGINE's own (`verifierVerdict` on the very bytes the routine handed back), so
  // "undetermined" is a reading of this failure, not a fixture's opinion.
  assert.equal(retry.ok, false, "a retry that failed again must NOT be laundered into a clean pass");
  assert.equal(retry.not_evaluated, "not-evaluated:uninstrumented-exit-1");
  assert.equal(roundLine.not_evaluated, "not-evaluated:uninstrumented-exit-1", "the round's own summary must carry the loss, not hide it");
  const real = verifierVerdict({ stdout: shape.stdout, stderr: "", status: shape.status });
  assert.equal(real.verdict, "undetermined", "the engine maps these bytes to undetermined");
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].verifier_verdict, "undetermined", "the persisted cluster must read undetermined");
  assert.equal(clusters[0].confirmed, false, "and it must NOT be confirmed");
});

test("AC2(b): the retryable classes are exactly OSD's, and a refusal at the RETRY's own reservation is not retried", async () => {
  assert.deepEqual([...RETRYABLE_CALL_FAILURES], ["no-stdout", "stream-without-result", "api-error-event"]);
  for (const s of SHAPES) {
    assert.equal(RETRYABLE_CALL_FAILURES.includes(s.class), s.retryable, `${s.name}: retryability is the list's, not a second predicate`);
  }

  // ── the ledger refuses the retry: the ordinary BUDGET_REFUSED path, no third spawn ────────────────
  // Cap 2: the investigator takes one and the verifier's FIRST attempt takes the other; the RETRY's own
  // reservation is then refused, which must surface as the round's ordinary budget failure — never as a
  // silent second call nobody granted.
  const shape = SHAPES.find((s) => s.name === "no-stdout");
  const { fact, seen, roundLine } = await roundWithVerifierShape(shape, { cfgOver: { maxModelCallsPer24h: 2 } });
  assert.equal(fact.state, "failed", "a refused reservation must not be reported as a completed round");
  assert.match(fact.reason, /BUDGET_REFUSED:BUDGET_24H/, "the refusal cause must be named, not inferred");
  assert.equal(seen.length, 2, "the refused retry must NOT have spawned a subprocess");
  assert.equal(roundLine, undefined, "a round that never reached an outcome writes no round line");
});

test("AC3: a non-retryable class is NOT retried — the retry is bounded to the classes it is meant for", async () => {
  for (const name of ["truncated-json", "clean-named-failure", "unclassified-plain-text", "killed-by-timeout"]) {
    const shape = SHAPES.find((s) => s.name === name);
    const { fact, seen, roundLine } = await roundWithVerifierShape(shape);
    assert.equal(fact.state, "verified", `${name}: the round completes (${fact.reason})`);
    assert.equal(seen.length, 2, `${name}: investigator + verifier ONLY — a retry here would spend a reservation on a call that already accounted for itself`);
    assert.equal(roundLine.calls.length, 2, name);
    assert.equal(roundLine.calls[1].call_failure, shape.class, name);
    assert.equal(roundLine.calls[1].not_evaluated, shape.not_evaluated, name);
    assert.equal(roundLine.calls[1].retry_of, undefined, `${name}: no retry record may exist`);
  }
});

test("AC2(c): the round reads its caps from the config it is handed, and this task changed no budget value", () => {
  // The caps are READ, not hardcoded (硬规则 4 推论二: a literal that means "unlimited on this host" is a
  // host-dependent constant). Pinning the shape here keeps a future hardcode from passing silently.
  // ⛔ The numbers below are THIS workspace's `.quay/config.yml` `cross_project_dogfood:` section, pasted
  // in the task body byte-identical to before the task. If a future change to this routine's retry path
  // moved a ceiling, this pin is where it would show up.
  const section = (calls, usd) => ({
    enabled: true, interval: "interval:360m",
    source_projects: [{ name: "quay-self-usage", root: "/data/home/yale/work/quay", enabled: true }],
    max_projects_per_round: 2, max_records_per_file: 60, max_file_bytes: 4194304, max_artifact_bytes_per_project: 8388608,
    investigator_max_turns: 30, verifier_max_turns: 12, refutation_max_turns: 10, max_clusters_verified: 3,
    max_wall_ms: 1800000, max_model_calls_per_24h: calls, max_usd_per_24h: usd, file_confirmed: true,
  });
  const read = parseCrossProjectDogfoodSection(section(60, 15));
  assert.equal(read.error, null);
  assert.equal(read.config.maxModelCallsPer24h, 60);
  assert.equal(read.config.maxUsdPer24h, 15);

  // Negative control: the value must TRACK the section, so a different number is a different reading.
  const other = parseCrossProjectDogfoodSection(section(7, 3));
  assert.equal(other.config.maxModelCallsPer24h, 7);
  assert.equal(other.config.maxUsdPer24h, 3);
});
