// @test-group engine
// slice-readings.test.mjs — per-task before/after structural readings
// (task gap-slice-before-after-readings-at-dispatch-and-fanin; 人 2026-10-22).
//
// WHAT THIS PINS, in decreasing order of how easy it is to lose:
//   ① THE RECORD SHAPE (AC1) — `evaluated:true` carries the seven required keys (+ `cycles`) AND a
//      per-metric `metricBasis`, so a reader can tell an archguard graph quantity from a git
//      line-count quantity. The numbers are asserted against a fixture whose values are known by
//      construction (entities/relations are supplied; line spans are read from the real file).
//   ② THE BINDING (AC2) — post.baselineHeadSha === baseline.headSha, identical scope + metricBasis,
//      and a `delta` entry for EVERY metric key.
//   ③ THE THREE-VALUED FAILURE (AC3, 硬规则 3b) — a forced archguard resolution failure yields
//      `evaluated:false` + non-empty reason + EVERY numeric metric null (⛔ never 0). This is the
//      failure class the task exists for: a missing instrument must not look like a clean reading.
//   ④ THE STRUCTURAL IDEMPOTENCE (AC4) — same HEAD for baseline and post ⇒ every delta is EXACTLY 0
//      (no epsilon / threshold: the two sides compute identical inputs).
//   ⑤ WORKTREE DEAD ≠ BACKFILL — a post pointed at a missing tree is NOT-EVALUATED with a reason,
//      never silently re-read from the carrier checkout.
//   ⑥ HISTORICAL REPLAY + WIRING (AC5/AC6) — `--head <older-sha>` really analyzes that commit (a
//      temp worktree), and both production paths name the script.
//
// The suite never needs a real archguard: a fake CLI is injected through the SAME
// ARCHGUARD_RUNNER_CLI seam archguard-runner.ts documents. The REAL-commit evidence (AC1/AC5) is
// taken manually against quay's own history — a fixture can prove the shape, not the measurement
// (硬规则 4 推论三).
//
// Run:
//   node --experimental-strip-types --test plugin/test/slice-readings.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "slice-readings.ts");
const DRIVER = path.join(REPO_ROOT, "plugin", "scripts", "worker-driver.ts");
const FAN_IN = path.join(REPO_ROOT, "plugin", "scripts", "worker-fan-in.ts");
// The post reading migrated OUT of the centre file (gap-worker-fan-in-cross-cutting-hooks-not-covered-
// by-extension-point): it is now a REGISTERED post-flip hook. The pin below follows the call, it does
// not relax it — the mechanical fan-in path still takes a POST reading, just from its new home.
const FAN_IN_HOOKS = path.join(REPO_ROOT, "plugin", "scripts", "worker-fan-in-hooks.ts");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** The fixture's central file: entity spans 1-10 (body), 12-20 (body), 22 (shell, no brace). The
 *  first 22 lines are IDENTICAL across commits so the method metrics are stable; later commits grow
 *  the tail, which moves `centralFileLines` and the churn/slim numerators. */
function centralSource(tailExtraLines) {
  const head = [
    "export function a() {", // 1  — body
    "  const x = 1;",
    "  const y = 2;",
    "  const z = 3;",
    "  const p = 4;",
    "  const q = 5;",
    "  const r = 6;",
    "  const s = 7;",
    "  return x + y;",
    "}", // 10
    "",
    "export function b() {", // 12 — body
    "  const x = 1;",
    "  const y = 2;",
    "  const z = 3;",
    "  const p = 4;",
    "  const q = 5;",
    "  const r = 6;",
    "  return x + y;",
    "}", // 20
    "",
    "export function c(): void;", // 22 — SHELL (declaration only)
  ];
  const tail = [];
  for (let i = 0; i < tailExtraLines; i++) tail.push(`// tail filler ${i}`);
  return [...head, ...tail].join("\n") + "\n";
}

const FAKE_SPEC = {
  entities: [
    { id: "central.ts.a", name: "a", type: "function", sourceLocation: { file: "central.ts", startLine: 1, endLine: 10 } },
    { id: "central.ts.b", name: "b", type: "function", sourceLocation: { file: "central.ts", startLine: 12, endLine: 20 } },
    // A shell: the span has no `{`, so it counts in methodCount but NOT in centralFileBodyLines.
    { id: "central.ts.c", name: "c", type: "function", sourceLocation: { file: "central.ts", startLine: 22, endLine: 22 } },
    // A callable OUTSIDE the central file — must not be counted.
    { id: "other.ts.z", name: "z", type: "function", sourceLocation: { file: "other.ts", startLine: 1, endLine: 5 } },
  ],
  relations: [
    { id: "call:a-b", type: "call", source: "central.ts.a", target: "central.ts.b" },
    { id: "call:a-z", type: "call", source: "central.ts.a", target: "other.ts.z" },
    { id: "call:b-z", type: "call", source: "central.ts.b", target: "other.ts.z" },
    { id: "dep:c-z", type: "dependency", source: "central.ts.c", target: "other.ts.z" },
  ],
  cycles: [{ modules: ["src/central", "src/other"] }],
};

const FAKE_ARCHGUARD_SOURCE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  process.stdout.write("9.9.9-fake\\n");
  process.exit(0);
}
const workIdx = argv.indexOf("--work-dir");
const srcIdx = argv.indexOf("-s");
const workDir = workIdx >= 0 ? argv[workIdx + 1] : "";
const source = srcIdx >= 0 ? argv[srcIdx + 1] : "";
if (!workDir || !source) process.exit(2);
const spec = JSON.parse(fs.readFileSync(process.env.SLICE_FAKE_SPEC, "utf8"));
const abs = path.resolve(process.cwd(), source);
let real = abs;
try { real = fs.realpathSync(abs); } catch {}
const key = "fixture";
const queryDir = path.join(workDir, "query");
fs.mkdirSync(path.join(queryDir, key), { recursive: true });
const arch = {
  version: "1.1",
  language: "typescript",
  timestamp: new Date().toISOString(),
  sourceFiles: [real],
  entities: spec.entities,
  relations: spec.relations,
  extensions: { tsAnalysis: { version: "1.0", moduleGraph: { nodes: [], edges: [], cycles: spec.cycles } } },
};
fs.writeFileSync(path.join(queryDir, key, "arch.json"), JSON.stringify(arch));
const manifest = {
  version: "1.0",
  generatedAt: new Date().toISOString(),
  globalScopeKey: key,
  scopes: [
    {
      key,
      label: path.basename(source) + " (typescript)",
      language: "typescript",
      kind: "parsed",
      sources: [real],
      entityCount: spec.entities.length,
      relationCount: spec.relations.length,
      hasAtlasExtension: false,
      generatedAt: new Date().toISOString(),
    },
  ],
};
fs.writeFileSync(path.join(queryDir, "manifest.json"), JSON.stringify(manifest));
process.exit(0);
`;

/** A git repo with a declared subsystem, three commits, and a task whose Touches name the central
 *  file (so scope auto-resolution can be exercised without --scope). */
function makeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slice-readings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  const write = (rel, content) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const commit = (msg) => {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
    return git(dir, "rev-parse", "HEAD");
  };
  write("src/central.ts", centralSource(0));
  write("src/other.ts", "export function z() {\n  return 1;\n}\n");
  const c1 = commit("c1");
  write("src/central.ts", centralSource(5));
  const c2 = commit("c2");
  write("src/central.ts", centralSource(8));
  const c3 = commit("c3");
  const config = `loop:\n  design_evolution_readings:\n    enabled: true\n    subsystems:\n      - name: demo\n        baseline: ${c1}\n        central:\n          - src/central.ts\n        modules:\n          - src/*.ts\n`;
  write(".quay/config.yml", config);
  write(
    "tasks/demo-task.md",
    `---\nid: demo-task\nstatus: ready\n---\n## Touches\n\n- src/central.ts\n`,
  );
  const c4 = commit("config + task");
  return { dir, c1, c2, c3, c4, write, commit, git: (...a) => git(dir, ...a) };
}

function fakeCli(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slice-fake-archguard-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(dir, "fake-archguard.js");
  fs.writeFileSync(cli, FAKE_ARCHGUARD_SOURCE, "utf8");
  fs.chmodSync(cli, 0o755);
  const spec = path.join(dir, "spec.json");
  fs.writeFileSync(spec, JSON.stringify(FAKE_SPEC));
  return { cli, spec };
}

function run(repoDir, args, extraEnv = {}) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, ...extraEnv },
  });
}

function carrier(repoDir, taskId) {
  return JSON.parse(fs.readFileSync(path.join(repoDir, ".quay", "slice-readings", `${taskId}.json`), "utf8"));
}

// ── AC1: baseline record shape + real values from the analyzed tree ─────────────────────────────

test("AC1 — baseline evaluated:true, seven required keys + cycles, per-metric metricBasis", (t) => {
  const repo = makeFixture(t);
  const fake = fakeCli(t);
  const r = run(repo.dir, ["--baseline", "--task-id", "t1", "--scope", "demo", "--head", repo.c3, "--root", repo.dir, "--json"], {
    ARCHGUARD_RUNNER_CLI: fake.cli,
    SLICE_FAKE_SPEC: fake.spec,
  });
  assert.equal(r.status, 0, `baseline must be evaluated; stderr=${r.stderr}`);
  const rec = JSON.parse(r.stdout);
  assert.equal(rec.evaluated, true);
  assert.equal(rec.reason, null);
  assert.equal(rec.headSha, repo.c3);
  assert.equal(rec.scope, "demo");

  const required = [
    "centralFileLines", "centralFileBodyLines", "callOutDegree", "methodCount", "methodShellCount",
    "centralChurnShare", "centralSlimRatio",
  ];
  for (const k of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(rec.metrics, k), `metrics must carry ${k}`);
    assert.ok(Object.prototype.hasOwnProperty.call(rec.metricBasis, k), `metricBasis must label ${k}`);
    assert.ok(["summary", "cognitive-summary", "git"].includes(rec.metricBasis[k]), `unexpected basis for ${k}`);
  }
  assert.ok(Object.prototype.hasOwnProperty.call(rec.metrics, "cycles"), "cycles is the eighth key");

  // Values known by construction.
  const fileText = fs.readFileSync(path.join(repo.dir, "src", "central.ts"), "utf8");
  assert.equal(rec.metrics.centralFileLines, (fileText.match(/\n/g) ?? []).length);
  assert.equal(rec.metrics.methodCount, 3, "three callables in central.ts (a, b, c)");
  assert.equal(rec.metrics.methodShellCount, 1, "c is a declaration-only shell");
  assert.equal(rec.metrics.centralFileBodyLines, 19, "a (10 lines) + b (9 lines); the shell contributes 0");
  assert.equal(rec.metrics.callOutDegree, 3, "three call relations whose source is a central callable");
  assert.equal(rec.metrics.cycles, 1);
  assert.equal(typeof rec.metrics.centralChurnShare, "number");
  assert.equal(typeof rec.metrics.centralSlimRatio, "number");

  assert.ok(fs.existsSync(path.join(repo.dir, ".quay", "slice-readings", "t1.json")), "carrier written");
});

// ── AC2: post is bound to the baseline, same scope/caliber, full delta ─────────────────────────

test("AC2 — post.baselineHeadSha === baseline.headSha, identical scope/metricBasis, every delta key has a value", (t) => {
  const repo = makeFixture(t);
  const fake = fakeCli(t);
  const env = { ARCHGUARD_RUNNER_CLI: fake.cli, SLICE_FAKE_SPEC: fake.spec };
  const b = run(repo.dir, ["--baseline", "--task-id", "t2", "--scope", "demo", "--head", repo.c2, "--root", repo.dir, "--json"], env);
  assert.equal(b.status, 0, b.stderr);
  const baseline = JSON.parse(b.stdout);
  const p = run(repo.dir, ["--post", "--task-id", "t2", "--head", repo.c3, "--root", repo.dir, "--json"], env);
  assert.equal(p.status, 0, p.stderr);
  const post = JSON.parse(p.stdout);

  assert.equal(post.baselineHeadSha, baseline.headSha, "post must name the baseline commit it is bound to");
  assert.equal(post.scope, baseline.scope);
  assert.deepEqual(post.metricBasis, baseline.metricBasis, "the caliber must be identical on both sides");
  const keys = Object.keys(baseline.metrics);
  assert.equal(Object.keys(post.delta).length, keys.length, "delta must carry every metric key");
  for (const k of keys) {
    assert.equal(typeof post.delta[k], "number", `delta.${k} must have a value on evaluated readings`);
  }
  // The fixture grew central.ts by 3 lines between c2 and c3.
  assert.equal(post.delta.centralFileLines, 3);

  const doc = carrier(repo.dir, "t2");
  assert.equal(doc.baseline.headSha, baseline.headSha);
  assert.equal(doc.post.headSha, repo.c3);
});

// ── AC3: forced instrument failure is a DISTINCT value, never zeros ─────────────────────────────

test("AC3 — forced archguard resolution failure ⇒ evaluated:false + reason + NO zero metrics", (t) => {
  const repo = makeFixture(t);
  const r = run(repo.dir, ["--baseline", "--task-id", "t3", "--scope", "demo", "--root", repo.dir, "--json"], {
    // An explicit-but-missing override is authoritative (the negative-control seam): it must NOT
    // fall back to the plugin-cache discovery.
    ARCHGUARD_RUNNER_CLI: path.join(repo.dir, "no-such-archguard"),
  });
  assert.equal(r.status, 3, `NOT-EVALUATED exits 3 (a distinct value); stderr=${r.stderr}`);
  const rec = JSON.parse(r.stdout);
  assert.equal(rec.evaluated, false);
  assert.equal(typeof rec.reason, "string");
  assert.ok(rec.reason.length > 0, "an unevaluated record must say WHY");
  assert.match(rec.reason, /archguard-cli-unresolvable/);
  for (const [k, v] of Object.entries(rec.metrics)) {
    assert.equal(v, null, `${k} must be null — ⛔ never 0 (「没读到」≠「读到了 0」)`);
  }
});

// 同名正对照: the normal seam resolves and the reading IS evaluated (proves the failure above was
// caused by the instrument, not by the record being structurally incapable of success).
test("AC3 positive control — a resolvable archguard CLI yields evaluated:true", (t) => {
  const repo = makeFixture(t);
  const fake = fakeCli(t);
  const r = run(repo.dir, ["--baseline", "--task-id", "t3-pos", "--scope", "demo", "--root", repo.dir, "--json"], {
    ARCHGUARD_RUNNER_CLI: fake.cli,
    SLICE_FAKE_SPEC: fake.spec,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).evaluated, true);
});

// ── AC4: the structural negative control — same HEAD ⇒ every delta exactly 0 ───────────────────

test("AC4 — same HEAD for baseline and post: every delta key is exactly 0", (t) => {
  const repo = makeFixture(t);
  const fake = fakeCli(t);
  const env = { ARCHGUARD_RUNNER_CLI: fake.cli, SLICE_FAKE_SPEC: fake.spec };
  const b = run(repo.dir, ["--baseline", "--task-id", "t4", "--scope", "demo", "--root", repo.dir, "--json"], env);
  assert.equal(b.status, 0, b.stderr);
  const p = run(repo.dir, ["--post", "--task-id", "t4", "--root", repo.dir, "--json"], env);
  assert.equal(p.status, 0, p.stderr);
  const post = JSON.parse(p.stdout);
  assert.equal(post.headSha, JSON.parse(b.stdout).headSha);
  const nonZero = Object.entries(post.delta).filter(([, v]) => v !== 0);
  assert.deepEqual(nonZero, [], `AC4 requires exact 0 for every delta key; got ${JSON.stringify(post.delta)}`);
});

// ── failure path: the worktree is gone ⇒ NOT-EVALUATED, never backfilled ────────────────────────

test("worktree torn down — post names worktree-missing instead of reading the carrier checkout", (t) => {
  const repo = makeFixture(t);
  const fake = fakeCli(t);
  const env = { ARCHGUARD_RUNNER_CLI: fake.cli, SLICE_FAKE_SPEC: fake.spec };
  const b = run(repo.dir, ["--baseline", "--task-id", "t5", "--scope", "demo", "--root", repo.dir, "--json"], env);
  assert.equal(b.status, 0, b.stderr);
  const p = run(repo.dir, ["--post", "--task-id", "t5", "--root", repo.dir, "--tree", path.join(repo.dir, "gone-worktree"), "--json"], env);
  assert.equal(p.status, 3);
  const rec = JSON.parse(p.stdout);
  assert.equal(rec.evaluated, false);
  assert.match(rec.reason, /worktree-missing/);
  assert.equal(rec.delta, null);
});

// ── historical replay: --head older than the tree really analyzes that commit ────────────────────

test("historical --head — a commit older than the tree is analyzed in a temp worktree (not the live tree)", (t) => {
  const repo = makeFixture(t);
  const fake = fakeCli(t);
  const r = run(repo.dir, ["--baseline", "--task-id", "t6", "--scope", "demo", "--head", repo.c1, "--root", repo.dir, "--json"], {
    ARCHGUARD_RUNNER_CLI: fake.cli,
    SLICE_FAKE_SPEC: fake.spec,
  });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(r.stdout);
  assert.equal(rec.headSha, repo.c1);
  assert.equal(rec.analyzedTree.kind, "temp-worktree", "an older commit must be materialized, not read from the current tree");
  // `centralSource(0)` is exactly what commit c1 contains — known by construction (the `git()`
  // helper trims trailing whitespace, so it must not be used for a newline-count caliber).
  assert.equal(rec.metrics.centralFileLines, (centralSource(0).match(/\n/g) ?? []).length);
});

// ── scope auto-resolution from the task's own Touches ───────────────────────────────────────────

test("scope auto-resolution — no --scope, the task's ## Touches picks the declared subsystem", (t) => {
  const repo = makeFixture(t);
  const fake = fakeCli(t);
  const r = run(repo.dir, ["--baseline", "--task-id", "demo-task", "--root", repo.dir, "--json"], {
    ARCHGUARD_RUNNER_CLI: fake.cli,
    SLICE_FAKE_SPEC: fake.spec,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).scope, "demo");
});

// ── AC6: both production paths name the script (grep evidence, pinned as a test) ────────────────

test("AC6 — worker-driver.ts (dispatch) and the fan-in hook module (mechanical fan-in) both name slice-readings", () => {
  const driver = fs.readFileSync(DRIVER, "utf8");
  const fanIn = fs.readFileSync(FAN_IN, "utf8");
  const fanInHooks = fs.readFileSync(FAN_IN_HOOKS, "utf8");
  assert.match(driver, /slice-readings/, "the dispatch path must invoke the reading");
  assert.match(fanInHooks, /slice-readings/, "the mechanical fan-in path must invoke the reading");
  // Position, not keyword: the dispatch path queues a BASELINE and fan-in takes a POST.
  assert.match(driver, /queueSliceBaseline\(/, "worker-driver must actually call the baseline helper");
  assert.match(fanInHooks, /runSlicePostReading\(/, "the fan-in hooks module must actually call the post helper");
  assert.match(fanInHooks, /phase:\s*"post-flip"/, "the post reading must be registered as a post-flip hook");
  // ⛔ And the CENTRE must no longer call it directly — otherwise the migration is cosmetic and the
  // next cross-cutting step still edits the centre (the defect this task exists to close).
  assert.doesNotMatch(fanIn, /runSlicePostReading\(/, "worker-fan-in.ts must not call the post helper directly");
});
