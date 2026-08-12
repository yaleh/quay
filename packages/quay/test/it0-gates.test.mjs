// @test-group product
// M39 (DIR-022 Layer 2 phase 1) — `impl-row` and `line-budget` named gates.
//
// Both gates are thin async (task, client) => { ok, reason } wrappers over
// the existing exp5 it0 scripts (it0-impl-row-check.sh /
// it0-ceiling-line-budget-check.sh), reusing the SAME `runAcceptance` runner
// QENG-2's `acceptance` gate already ships (spawnSync, real process I/O, real
// exit-code mapping) — no gate logic is duplicated, no second command-runner
// is introduced. This file exercises the fail-closed unset-args branch, the
// real-script pass/fail branches (against small on-disk fixture files created
// per-test), `--list` surfacing, and the real CLI path (`node bin/quay.js
// gate <task> --gate impl-row|line-budget`) end-to-end against a disposable
// native-provider workspace, mirroring gate.test.mjs / acceptance.test.mjs's
// own makeWorkspace() pattern.
//
// Run: node --test --experimental-test-coverage packages/quay/test/*.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { resolveGate, listGates } from "../src/gate/registry.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
// DIR-035-B: `impl-row`/`line-budget` are no longer module-level `gateRegistry`
// entries — they are THIS repo's own `.quay/gates.yml`-declared workspace
// gates. `resolveGate(name, REPO_ROOT)` resolves them exactly as `quay gate`
// would when run from this repo's own workspace root (see registry.js).
const gate = (name) => resolveGate(name, REPO_ROOT);

// Every tmp dir / workspace pair is removed once at the end of this file — the carrier-array +
// after() pattern — so `quay-m39-*` never accumulates a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m39-${tag}-`));
  _tmpDirs.push(dir);
  return dir;
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

function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

// mirrors gate.test.mjs / acceptance.test.mjs makeWorkspace(), PLUS (DIR-035-B)
// an `it0`-gate declaration for `impl-row`/`line-budget` as THIS test
// workspace's own data — the exact shape a real exp5-style workspace uses,
// pointed at the REAL repo scripts (REPO_ROOT) so the CLI path still exercises
// real process I/O, not a synthetic fixture script.
//
// DIR-120 Phase 2: this workspace's `.quay/config.yml` already exists (it
// carries `providers:`), so branch A is TERMINAL for `readGatesConfig` —
// the it0 gates MUST live in config.yml's own `gates:` section now. A
// separate `.quay/gates.yml` sibling would be silently ignored (the exact
// silent-data-loss scenario this milestone's own gate-config-loader.test.mjs
// names), not a real branch-B fixture, since a `config.yml` is present.
function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m39-${tag}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m39-${tag}-ws-`));
  _tmpDirs.push(tasksDir);
  _tmpDirs.push(workspaceRoot);
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
      "  it0:",
      "    - name: impl-row",
      `      script: "${path.join(REPO_ROOT, "experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh").replaceAll("\\", "\\\\")}"`,
      "      argsKey: implRowArgs",
      "    - name: line-budget",
      `      script: "${path.join(REPO_ROOT, "experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh").replaceAll("\\", "\\\\")}"`,
      "      argsKey: lineBudgetArgs",
      "",
    ].join("\n")
  );
  return { workspaceRoot, tasksDir };
}

// ---------------------------------------------------------------------------
// Fixture backlog.md / charter.md files (small, real files on disk — the
// scripts themselves are the source of truth, these fixtures just give them
// real, script-shaped input).
// ---------------------------------------------------------------------------

function writeBacklogFixture(dir, { designOnly }) {
  const file = path.join(dir, "backlog.md");
  const row = designOnly
    ? "| M-FIXTURE | some design-doc only milestone | OPEN | governance | milestone-candidate |\n"
    : "| M-FIXTURE | some ordinary milestone | OPEN | governance | milestone-candidate |\n";
  fs.writeFileSync(file, "| id | desc | status | value | labels |\n" + row);
  return file;
}

function writeCharterFixture(dir, { overBudget }) {
  const file = path.join(dir, "charter.md");
  const body = overBudget
    ? "# Charter\nLine budget: 5000\n## In scope\n1. a\n2. b\n"
    : "# Charter\n## In scope\n1. a\n2. b\n";
  fs.writeFileSync(file, body);
  return file;
}

// ===========================================================================
// Stage 1 — fail-closed unset-args branch (both gates)
// ===========================================================================

test("M39 A1: listGates() includes 'impl-row' and 'line-budget'", () => {
  assert.ok(listGates().includes("impl-row"));
  assert.ok(listGates().includes("line-budget"));
});

test("M39 A1: impl-row gate fails-closed when extra.implRowArgs is unset", async () => {
  const r = await gate("impl-row")({ id: "T", extra: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no impl-row arguments defined/);
});

test("M39 A1: impl-row gate fails-closed when extra.implRowArgs is an empty array", async () => {
  const r = await gate("impl-row")({ id: "T", extra: { implRowArgs: [] } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no impl-row arguments defined/);
});

test("M39 A1: impl-row gate fails-closed when extra.implRowArgs[0] is not a non-empty string", async () => {
  const r1 = await gate("impl-row")({ id: "T", extra: { implRowArgs: [""] } });
  assert.equal(r1.ok, false);
  const r2 = await gate("impl-row")({ id: "T", extra: { implRowArgs: [42] } });
  assert.equal(r2.ok, false);
});

test("M39 A1: impl-row gate fails-closed when task.extra itself is undefined", async () => {
  const r = await gate("impl-row")({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no impl-row arguments defined/);
});

test("M39 A1: line-budget gate fails-closed when extra.lineBudgetArgs is unset", async () => {
  const r = await gate("line-budget")({ id: "T", extra: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no line-budget arguments defined/);
});

test("M39 A1: line-budget gate fails-closed when extra.lineBudgetArgs is an empty array", async () => {
  const r = await gate("line-budget")({ id: "T", extra: { lineBudgetArgs: [] } });
  assert.equal(r.ok, false);
});

// ===========================================================================
// Stage 2 — real script invocation, both pass and fail branches, via the
// gate fn directly (real spawnSync process I/O over real fixture files).
// ===========================================================================

test("M39 A2: impl-row gate PASSes for a non-design-only backlog row (real script)", async () => {
  const dir = tmpDir("a2-implrow-pass");
  const backlog = writeBacklogFixture(dir, { designOnly: false });
  const r = await gate("impl-row")({
    id: "T",
    extra: { implRowArgs: ["M-FIXTURE", backlog] },
  });
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("M39 A2: impl-row gate FAILs for a design-only row with no -IMPL row (real script)", async () => {
  const dir = tmpDir("a2-implrow-fail");
  const backlog = writeBacklogFixture(dir, { designOnly: true });
  const r = await gate("impl-row")({
    id: "T",
    extra: { implRowArgs: ["M-FIXTURE", backlog] },
  });
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
});

test("M39 A2: impl-row gate maps a script usage-error (exit 2, missing backlog file) to ok:false", async () => {
  const r = await gate("impl-row")({
    id: "T",
    extra: { implRowArgs: ["M-NOPE", "/no/such/backlog.md"] },
  });
  assert.equal(r.ok, false);
});

test("M39 A2: line-budget gate PASSes for a small-scope charter (real script)", async () => {
  const dir = tmpDir("a2-linebudget-pass");
  const charter = writeCharterFixture(dir, { overBudget: false });
  const r = await gate("line-budget")({
    id: "T",
    extra: { lineBudgetArgs: [charter] },
  });
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("M39 A2: line-budget gate FAILs for an over-budget charter with no phase/stage plan (real script)", async () => {
  const dir = tmpDir("a2-linebudget-fail");
  const charter = writeCharterFixture(dir, { overBudget: true });
  const r = await gate("line-budget")({
    id: "T",
    extra: { lineBudgetArgs: [charter] },
  });
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
});

test("M39 A2: line-budget gate maps a script usage-error (exit 2, missing charter file) to ok:false", async () => {
  const r = await gate("line-budget")({
    id: "T",
    extra: { lineBudgetArgs: ["/no/such/charter.md"] },
  });
  assert.equal(r.ok, false);
});

test("M39 A2: impl-row gate tolerates an optional second arg (backlog-file override) and shell-quotes it safely", async () => {
  const dir = tmpDir("a2-implrow-quote");
  // A path containing a single quote exercises the shQuote escaping branch.
  const weirdDir = path.join(dir, "weird's dir");
  fs.mkdirSync(weirdDir, { recursive: true });
  const backlog = writeBacklogFixture(weirdDir, { designOnly: false });
  const r = await gate("impl-row")({
    id: "T",
    extra: { implRowArgs: ["M-FIXTURE", backlog] },
  });
  assert.equal(r.ok, true, `expected pass even with a quote in the path; got reason=${r.reason}`);
});

// ===========================================================================
// Stage 3 — real CLI path (AC3): `quay gate <task> --gate impl-row|line-budget`
// against a real (non-fixture-provider) native-provider workspace, real
// GateEvents queryable via `quay gate-log --json`.
// ===========================================================================

test("M39 C1 [AC2]: `quay gate --list` includes 'impl-row' and 'line-budget'", () => {
  const { workspaceRoot } = makeWorkspace("list");
  const r = runQuay(["gate", "--list"], workspaceRoot);
  assert.equal(r.status, 0);
  const lines = r.stdout.split("\n");
  assert.ok(lines.includes("impl-row"), `expected 'impl-row' listed; got: ${r.stdout}`);
  assert.ok(lines.includes("line-budget"), `expected 'line-budget' listed; got: ${r.stdout}`);
});

test("M39 C1 [AC3]: `quay gate <task> --gate impl-row` PASSes for real and appends a real GateEvent", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-implrow");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  const backlog = writeBacklogFixture(workspaceRoot, { designOnly: false });
  runNative(["task", "create", "T-IMPLROW", "--title", "impl-row CLI fixture", "--status", "todo"], tasksDir);
  runNative(
    ["task", "edit", "T-IMPLROW", "--extra", JSON.stringify({ implRowArgs: ["M-FIXTURE", backlog] })],
    tasksDir
  );
  const r = runQuay(["gate", "T-IMPLROW", "--gate", "impl-row", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected PASS; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);

  const log = runQuay(["gate-log", "T-IMPLROW", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "impl-row");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].pipeline_id, "T-IMPLROW");
});

test("M39 C1 [AC3]: `quay gate <task> --gate line-budget` PASSes for real and appends a real GateEvent", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-linebudget");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  const charter = writeCharterFixture(workspaceRoot, { overBudget: false });
  runNative(["task", "create", "T-LINEBUDGET", "--title", "line-budget CLI fixture", "--status", "todo"], tasksDir);
  runNative(
    ["task", "edit", "T-LINEBUDGET", "--extra", JSON.stringify({ lineBudgetArgs: [charter] })],
    tasksDir
  );
  const r = runQuay(["gate", "T-LINEBUDGET", "--gate", "line-budget", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected PASS; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);

  const log = runQuay(["gate-log", "T-LINEBUDGET", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "line-budget");
  assert.equal(events[0].verdict, "pass");
});

test("M39 C1 [AC3]: `quay gate <task> --gate impl-row` FAILs (exit 1) for real when args unset, GateEvent verdict is fail", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-implrow-fail");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(
    ["task", "create", "T-NOARGS", "--title", "no-args fixture", "--status", "todo"],
    tasksDir
  );
  const r = runQuay(["gate", "T-NOARGS", "--gate", "impl-row", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1, `expected FAIL (exit 1); got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /no impl-row arguments defined/);

  const log = runQuay(["gate-log", "T-NOARGS", "--json", "--file", logFile], workspaceRoot);
  const events = JSON.parse(log.stdout);
  assert.equal(events[0].verdict, "fail");
});

// ===========================================================================
// Stage 4 — real-world demonstration against this milestone's OWN real task
// and an already-ABSORBed prior milestone's real task (AC3's "REAL exp5
// task, not a synthetic fixture" requirement), run directly against the
// repo's own real tasks/ and backlog.md/charters/ — read-only positive
// confirmation, no mutation of the real task files themselves (extra was
// already seeded via `quay task edit` at demonstration time, see report).
// ===========================================================================

test("M39 D1: impl-row gate PASSes for real against the M38 real milestone task + real backlog.md", async () => {
  const backlog = path.join(REPO_ROOT, "experiments/quay-perpetual-stream/backlog.md");
  assert.ok(fs.existsSync(backlog), "real backlog.md must exist in this worktree");
  const r = await gate("impl-row")({
    id: "exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE",
    extra: { implRowArgs: ["exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE", backlog] },
  });
  assert.equal(r.ok, true, `expected pass against the real backlog row; got reason=${r.reason}`);
});

test("M39 D1: line-budget gate PASSes for real against this milestone's OWN real charter file", async () => {
  const charter = path.join(
    REPO_ROOT,
    "experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md"
  );
  assert.ok(fs.existsSync(charter), "real M39 charter must exist in this worktree");
  const r = await gate("line-budget")({
    id: "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    extra: { lineBudgetArgs: [charter] },
  });
  assert.equal(r.ok, true, `expected pass against the real M39 charter; got reason=${r.reason}`);
});
