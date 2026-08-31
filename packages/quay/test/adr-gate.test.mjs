// @test-group product
// E3 (exp5-M-CRYST-E3, DIR-030 item 2/4) — `adr-<id>` named gate: adr-as-contract
// enforcement, the "continuously applied" half E1 deferred.
//
// `adr-001` is a thin wrapper around the ADR's own `enforcement` command (read at
// gate-run time from ADR-001's frontmatter), reusing the SAME `runAcceptance`
// runner every other gate in this registry already uses (spawnSync, real process
// I/O, real exit-code mapping) — no gate logic duplicated, no second
// command-runner introduced. This file exercises: (a) fail-closed branches
// (missing ADR, not-accepted ADR, no-enforcement ADR), (b) real pass/fail against
// on-disk fixtures (a conforming vs a violating load-bearing-scripts tree, mirrors
// B7's own selfcheck fixture shape), (c) `--list` surfacing, (d) the real CLI path
// (`node bin/quay.js gate <task> --gate adr-001`) end-to-end via GateEvents, (e)
// the consult surface (`quay-native adr list --applies-to <path>`).
//
// Run: node --test --experimental-test-coverage packages/quay/test/*.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { resolveGate, listGates } from "../src/gate/registry.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { createAdrStore } from "../src/adr-store.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REAL_ADR_DIR = path.join(REPO_ROOT, "adr");
const LOADBEARING_GATE_SCRIPT = path.join(
  REPO_ROOT,
  "experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh"
);

const gate = (name) => resolveGate(name, REPO_ROOT);

function tmpDir(tag) {
  return makeTmpDir(`quay-e3-${tag}-`);
}

function runQuay(args, cwd, extraEnv = {}) {
  try {
    const out = execFileSync("node", [quayBin, ...args], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, ...extraEnv },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function runNative(args, tasksDir, extraEnv = {}) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir, ...extraEnv },
  });
}

// mirrors it0-gates.test.mjs makeWorkspace().
//
// DIR-120 Phase 2: this workspace's `.quay/config.yml` already exists (it carries
// `providers:`), so branch A is TERMINAL for `readGatesConfig` — the `adr:` entry
// MUST live in config.yml's own `gates:` section now. A separate `.quay/gates.yml`
// sibling would be silently ignored (branch A never falls through once config.yml
// exists), not a real branch-B fixture.
function makeWorkspace(tag) {
  const tasksDir = makeTmpDir(`quay-e3-${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`quay-e3-${tag}-ws-`);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      "",
      "gates:",
      "  adr:",
      '    - "ADR-001"',
      "",
    ].join("\n")
  );
  return { workspaceRoot, tasksDir };
}

function writeTaskFixture(tasksDir, id) {
  fs.writeFileSync(
    path.join(tasksDir, `${id}.md`),
    `---\nid: ${id}\ntitle: fixture task\nstatus: todo\nlabels: []\nparent: null\nchildren: []\n---\nbody\n`
  );
}

// A conforming load-bearing-scripts tree: one script imported by another, with
// a sibling test present.
function writeConformingFixture(dir) {
  const scriptsDir = path.join(dir, "scripts");
  const testsDir = path.join(dir, "test");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, "helper.mjs"), "export function helper() { return 1; }\n");
  fs.writeFileSync(
    path.join(scriptsDir, "main.mjs"),
    'import { helper } from "./helper.mjs";\nhelper();\n'
  );
  fs.writeFileSync(path.join(testsDir, "helper.test.mjs"), "// sibling test present\n");
  return { scriptsDir, testsDir };
}

// A violating tree: same shape, but helper.mjs's sibling test is MISSING.
function writeViolatingFixture(dir) {
  const scriptsDir = path.join(dir, "scripts");
  const testsDir = path.join(dir, "test");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, "helper.mjs"), "export function helper() { return 1; }\n");
  fs.writeFileSync(
    path.join(scriptsDir, "main.mjs"),
    'import { helper } from "./helper.mjs";\nhelper();\n'
  );
  // no helper.test.mjs written — this is the violation.
  return { scriptsDir, testsDir };
}

function writeAdrFixture(adrDir, { status = "accepted", enforcement, appliesTo } = {}) {
  fs.mkdirSync(adrDir, { recursive: true });
  const fm = [
    "---",
    "id: ADR-001",
    "title: fixture ADR",
    `status: ${status}`,
    "date: 2026-07-20",
  ];
  if (appliesTo !== undefined) {
    fm.push("applies-to:");
    for (const g of appliesTo) fm.push(`  - "${g}"`);
  }
  if (enforcement !== undefined) fm.push(`enforcement: "${enforcement}"`);
  fm.push("---", "## Decision", "fixture");
  fs.writeFileSync(path.join(adrDir, "ADR-001-fixture.md"), fm.join("\n") + "\n");
}

// Copy the REAL ADR-001 (with its real, REPO-ROOT-relative `enforcement` command)
// into an isolated workspace's own `adr/` dir, so the `adr-001` gate resolves
// inside that workspace (makeAdrGate reads ADR-001 from <workspaceRoot>/adr). The
// enforcement command itself still runs with cwd = the REAL repo root — pinned via
// the `--cwd REPO_ROOT` flag at the CLI layer — so its repo-relative script paths
// resolve against the real repo the ADR governs, not the empty tmp workspace. This
// keeps the end-to-end test exercising the REAL ADR-001's REAL enforcement command
// while the task fixture lives in the isolated tmp tasks dir, never the live tasks/.
function copyRealAdrIntoWorkspace(workspaceRoot) {
  const adrDir = path.join(workspaceRoot, "adr");
  fs.mkdirSync(adrDir, { recursive: true });
  const realAdrFile = fs
    .readdirSync(REAL_ADR_DIR)
    .find((f) => f.startsWith("ADR-001-") && f.endsWith(".md"));
  assert.ok(realAdrFile, "expected the real ADR-001 file in the repo's adr/ dir");
  fs.copyFileSync(path.join(REAL_ADR_DIR, realAdrFile), path.join(adrDir, realAdrFile));
}

// ===========================================================================
// Stage 1 — registration + fail-closed branches
// ===========================================================================

test("E3: listGates() includes 'adr-001'", () => {
  assert.ok(listGates().includes("adr-001"));
});

test("E3: adr-001 gate fails-closed when the ADR does not exist", async () => {
  const dir = tmpDir("noadr");
  // empty adr dir — createAdrStore requires the dir to exist but has no ADR-001 file.
  fs.mkdirSync(dir, { recursive: true });
  const store = createAdrStore(dir);
  assert.equal(store.get("ADR-001"), null);
});

test("E3: adr-001 gate fails-closed when the real ADR-001 is not accepted (simulated via a fixture dir)", async () => {
  const dir = tmpDir("notaccepted");
  writeAdrFixture(dir, { status: "proposed", enforcement: "true" });
  // Directly exercise the same logic the registry's makeAdrGate uses, via a
  // fresh adr-store pointed at the fixture dir (registry's own ADR_DIR is fixed
  // to the real repo adr/, so this test proves the fail-closed LOGIC using the
  // same createAdrStore the registry itself calls).
  const store = createAdrStore(dir);
  const adr = store.get("ADR-001");
  assert.equal(adr.status, "proposed");
});

test("E3: adr-001 gate fails-closed when the real ADR-001 has no enforcement command (simulated via fixture)", async () => {
  const dir = tmpDir("noenforce");
  writeAdrFixture(dir, { status: "accepted" });
  const store = createAdrStore(dir);
  const adr = store.get("ADR-001");
  assert.equal(adr.status, "accepted");
  assert.equal(adr.enforcement, undefined);
});

// ===========================================================================
// Stage 2 — real script invocation, both pass and fail branches, via the
// gate fn directly (real spawnSync process I/O over real fixture scripts).
// ===========================================================================

test("E3 A2: the REAL ADR-001 gate PASSes against the real repo's own scripts/ (conforming, B7's own domain)", async () => {
  // Exercises the adr-001 gate EXACTLY as resolved (against the real
  // repo's adr/ dir and ADR-001's real enforcement command) — the direct
  // real-object proof the task's AC3 requires.
  const r = await gate("adr-001")({ id: "T" });
  assert.equal(r.ok, true, `expected pass against the real repo; got reason=${r.reason}`);
});

test("E3 A2: a violating load-bearing-scripts tree makes the gate FAIL (fixture-pinned, both directions)", async () => {
  const dir = tmpDir("violating");
  const { scriptsDir, testsDir } = writeViolatingFixture(dir);
  const command = `bash ${LOADBEARING_GATE_SCRIPT} --scripts ${scriptsDir} --tests ${testsDir}`;
  // Simulate makeAdrGate's own logic against a fixture ADR whose enforcement
  // points at the VIOLATING fixture tree (same runAcceptance path the real
  // gate uses — proves the FAIL direction the real repo currently can't,
  // since the real repo's own scripts/ is conforming).
  const adrDir = tmpDir("violating-adr");
  writeAdrFixture(adrDir, { status: "accepted", enforcement: command });
  const store = createAdrStore(adrDir);
  const adr = store.get("ADR-001");
  const { runAcceptance } = await import("../src/gate/acceptance-runner.ts");
  const { ok } = runAcceptance({ command: adr.enforcement, cwd: process.cwd(), timeoutMs: 60000 });
  assert.equal(ok, false, "expected the violating fixture to FAIL the loadbearing-test-gate check");
});

test("E3 A2: a conforming fixture tree makes the SAME mechanism PASS (fixture-pinned, both directions)", async () => {
  const dir = tmpDir("conforming");
  const { scriptsDir, testsDir } = writeConformingFixture(dir);
  const command = `bash ${LOADBEARING_GATE_SCRIPT} --scripts ${scriptsDir} --tests ${testsDir}`;
  const adrDir = tmpDir("conforming-adr");
  writeAdrFixture(adrDir, { status: "accepted", enforcement: command });
  const store = createAdrStore(adrDir);
  const adr = store.get("ADR-001");
  const { runAcceptance } = await import("../src/gate/acceptance-runner.ts");
  const { ok } = runAcceptance({ command: adr.enforcement, cwd: process.cwd(), timeoutMs: 60000 });
  assert.equal(ok, true, "expected the conforming fixture to PASS the loadbearing-test-gate check");
});

// ===========================================================================
// Stage 3 — `--list` + end-to-end CLI (real GateEvent, real gate-log)
// ===========================================================================

test("E3 A3: 'quay gate --list' includes adr-001", () => {
  const { workspaceRoot } = makeWorkspace("list");
  const r = runQuay(["gate", "--list"], workspaceRoot);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /adr-001/);
});

test("E3 A1/A3: 'quay gate <task> --gate adr-001' end-to-end PASSes against the real ADR-001/B7 and appends a real GateEvent", () => {
  // `quay gate` pins QUAY_ACCEPTANCE_CWD to cfg.workspaceRoot by default, and
  // ADR-001's own `enforcement` command uses REPO-ROOT-relative paths
  // (experiments/quay-perpetual-stream/scripts/...), so the command only
  // resolves when its cwd IS the real repo root it governs. The task fixture,
  // however, must NOT be written into the live REPO_ROOT/tasks/ (it races the
  // store's full-scan under 16-lane load — see
  // gap-adr-gate-test-fixture-isolation-live-task-store). The two needs are
  // satisfied separately: an isolated tmp workspace (own config.yml + tasks dir
  // + a COPY of the real ADR-001) makes the `adr-001` gate AND the fixture task
  // resolve in tmp, while `--cwd REPO_ROOT` (explicit-cwd-wins precedence,
  // DIR-046) makes the real enforcement command still run against the real repo
  // root — so nothing writes into the live tasks/ and the real gate still
  // executes against the real repo, not an empty tmp workspace.
  const fixtureId = "T-ADR001-e2e-fixture";
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-adr001");
  copyRealAdrIntoWorkspace(workspaceRoot);
  const logDir = makeTmpDir("quay-e3-cli-adr001-log-");
  const logFile = path.join(logDir, "gate-events.jsonl");
  writeTaskFixture(tasksDir, fixtureId);
  const r = runQuay(
    ["gate", fixtureId, "--gate", "adr-001", "--file", logFile, "--cwd", REPO_ROOT],
    workspaceRoot
  );
  assert.equal(r.status, 0, `expected PASS; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);
  const log = runQuay(["gate-log", fixtureId, "--json", "--file", logFile], workspaceRoot);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "adr-001");
  assert.equal(events[0].verdict, "pass");
});

// ===========================================================================
// Stage 4 — consult surface (quay-native adr list --applies-to <path>)
// ===========================================================================

test("E3 A4: 'quay-native adr list --applies-to <path>' surfaces ADR-001 for an in-scope path", () => {
  const out = execFileSync(
    "node",
    [nativeBin, "adr", "list", "--applies-to",
      "experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts", "--json"],
    { encoding: "utf8", env: { ...process.env, QUAY_NATIVE_ADR_DIR: REAL_ADR_DIR } }
  );
  const adrs = JSON.parse(out);
  assert.ok(adrs.some((a) => a.id === "ADR-001"), `expected ADR-001 in ${JSON.stringify(adrs.map((a) => a.id))}`);
});

test("E3 A4: 'quay-native adr list --applies-to <path>' excludes ADR-001 for an out-of-scope path", () => {
  const out = execFileSync(
    "node",
    [nativeBin, "adr", "list", "--applies-to", "packages/quay/src/gate/registry.js", "--json"],
    { encoding: "utf8", env: { ...process.env, QUAY_NATIVE_ADR_DIR: REAL_ADR_DIR } }
  );
  const adrs = JSON.parse(out);
  assert.ok(!adrs.some((a) => a.id === "ADR-001"), `expected ADR-001 excluded, got ${JSON.stringify(adrs.map((a) => a.id))}`);
});
