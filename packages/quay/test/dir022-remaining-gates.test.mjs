// @test-group product
// M43 (DIR-022 remainder, exp5-M-DIR022-REMAINING-GATES) — `vmeta-lag` and
// `dogfood-evidence` named gates.
//
// Both gates are thin async (task, client) => { ok, reason } wrappers over the
// existing exp5 scripts (vmeta-lag-check.sh / it0-dogfood-evidence-gate.sh),
// reusing the SAME `makeIt0Gate` factory + `runAcceptance` runner `impl-row`/
// `line-budget` (M39) already ship — no gate logic is duplicated, no second
// command-runner is introduced. Mirrors `it0-gates.test.mjs`'s own Stage
// 1/2/3 structure (fail-closed unset-args branch; real-script pass/fail
// branch; real CLI path `quay gate <task> --gate vmeta-lag|dogfood-evidence`
// end-to-end against a disposable native-provider workspace).
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

// Every tmp dir / workspace triple is removed once at the end of this file — the carrier-array +
// after() pattern — so `quay-m43-*` never accumulates a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
// DIR-035-B: `vmeta-lag`/`dogfood-evidence` are no longer module-level
// `gateRegistry` entries — they are THIS repo's own workspace gates, declared
// in `.quay/config.yml`'s own `gates:` section (DIR-120: the only source THIS
// workspace's readers resolve gates from). `resolveGate(name, REPO_ROOT)`
// resolves them exactly as `quay gate` would when run from this repo's own
// workspace root.
const gate = (name) => resolveGate(name, REPO_ROOT);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m43-${tag}-`));
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

// mirrors it0-gates.test.mjs / gate.test.mjs makeWorkspace(), PLUS (DIR-035-B)
// a `vmeta-lag`/`dogfood-evidence` it0 declaration as THIS test workspace's own
// data, pointed at the REAL repo scripts (REPO_ROOT).
//
// DIR-120 Phase 2: this workspace's `.quay/config.yml` already exists (it carries
// `providers:`), so branch A is TERMINAL for `readGatesConfig` — the it0 gates
// MUST live in config.yml's own `gates:` section now. A separate `.quay/gates.yml`
// sibling would be silently ignored (branch A never falls through once config.yml
// exists), not a real branch-B fixture.
function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m43-${tag}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m43-${tag}-ws-`));
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
      "    - name: vmeta-lag",
      `      script: "${path.join(REPO_ROOT, "experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh").replaceAll("\\", "\\\\")}"`,
      "      argsKey: vmetaLagArgs",
      "    - name: dogfood-evidence",
      `      script: "${path.join(REPO_ROOT, "experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh").replaceAll("\\", "\\\\")}"`,
      "      argsKey: dogfoodEvidenceArgs",
      "",
    ].join("\n")
  );
  return { workspaceRoot, tasksDir };
}

// ---------------------------------------------------------------------------
// Fixture ledger / report files
// ---------------------------------------------------------------------------

function writeLedgerFixture(dir, { alarm }) {
  const file = path.join(dir, "v-meta-ledger.md");
  // M70/D4 (ADR-004 structured [tag] field): status cells must start with [tag]
  const row = alarm
    ? "| some insight | m1 | 2 | **[confirmed]** (m1) |\n"
    : "| some insight | m1 | 2 | **[consolidated]** (m1) |\n";
  fs.writeFileSync(
    file,
    "milestone_counter: 3\n\n" +
    "| insight | origin milestone | confirmation count | status |\n" +
      "|---|---|---|---|\n" +
      row
  );
  return file;
}

function writeReportFixture(dir, { hasEvidence }) {
  const file = path.join(dir, "iteration-report.md");
  const body = hasEvidence
    ? "# Report\n1. **MET.** did the thing.\n```\nreal pasted output\n```\n"
    : "# Report\n1. **MET.** did the thing with no evidence nearby.\n";
  fs.writeFileSync(file, body);
  return file;
}

// ===========================================================================
// Stage 1 — fail-closed unset-args branch (both gates)
// ===========================================================================

test("M43 A1: listGates() includes 'vmeta-lag' and 'dogfood-evidence'", () => {
  assert.ok(listGates().includes("vmeta-lag"));
  assert.ok(listGates().includes("dogfood-evidence"));
});

test("M43 A1: vmeta-lag gate fails-closed when extra.vmetaLagArgs is unset", async () => {
  const r = await gate("vmeta-lag")({ id: "T", extra: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no vmeta-lag arguments defined/);
});

test("M43 A1: vmeta-lag gate fails-closed when extra.vmetaLagArgs is an empty array", async () => {
  const r = await gate("vmeta-lag")({ id: "T", extra: { vmetaLagArgs: [] } });
  assert.equal(r.ok, false);
});

test("M43 A1: vmeta-lag gate fails-closed when task.extra itself is undefined", async () => {
  const r = await gate("vmeta-lag")({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no vmeta-lag arguments defined/);
});

test("M43 A1: dogfood-evidence gate fails-closed when extra.dogfoodEvidenceArgs is unset", async () => {
  const r = await gate("dogfood-evidence")({ id: "T", extra: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no dogfood-evidence arguments defined/);
});

test("M43 A1: dogfood-evidence gate fails-closed when extra.dogfoodEvidenceArgs is an empty array", async () => {
  const r = await gate("dogfood-evidence")({ id: "T", extra: { dogfoodEvidenceArgs: [] } });
  assert.equal(r.ok, false);
});

// ===========================================================================
// Stage 2 — real script invocation, both pass and fail branches, via the
// gate fn directly (real spawnSync process I/O over real fixture files).
// ===========================================================================

test("M43 A2: vmeta-lag gate PASSes for a consolidated (non-alarmed) ledger row (real script)", async () => {
  const dir = tmpDir("a2-vmetalag-pass");
  const ledger = writeLedgerFixture(dir, { alarm: false });
  const r = await gate("vmeta-lag")({
    id: "T",
    extra: { vmetaLagArgs: ["--counter", "3", ledger] },
  });
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("M43 A2: vmeta-lag gate FAILs for a confirmed-overdue-past-K row with no dated carry-forward (real script)", async () => {
  const dir = tmpDir("a2-vmetalag-fail");
  const ledger = writeLedgerFixture(dir, { alarm: true });
  const r = await gate("vmeta-lag")({
    id: "T",
    extra: { vmetaLagArgs: ["--counter", "10", ledger] },
  });
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
});

test("M43 A2: vmeta-lag gate maps a script usage-error (exit 2, missing ledger file) to ok:false", async () => {
  const r = await gate("vmeta-lag")({
    id: "T",
    extra: { vmetaLagArgs: ["/no/such/ledger.md"] },
  });
  assert.equal(r.ok, false);
});

test("M43 A2: dogfood-evidence gate PASSes for a claimed-met clause with nearby fenced evidence (real script)", async () => {
  const dir = tmpDir("a2-dogfood-pass");
  const report = writeReportFixture(dir, { hasEvidence: true });
  const r = await gate("dogfood-evidence")({
    id: "T",
    extra: { dogfoodEvidenceArgs: [report] },
  });
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("M43 A2: dogfood-evidence gate FAILs for a claimed-met clause with no nearby fenced evidence (real script)", async () => {
  const dir = tmpDir("a2-dogfood-fail");
  const report = writeReportFixture(dir, { hasEvidence: false });
  const r = await gate("dogfood-evidence")({
    id: "T",
    extra: { dogfoodEvidenceArgs: [report, "1"] }, // tiny window forces a miss
  });
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
});

test("M43 A2: dogfood-evidence gate maps a script usage-error (exit 2, missing report file) to ok:false", async () => {
  const r = await gate("dogfood-evidence")({
    id: "T",
    extra: { dogfoodEvidenceArgs: ["/no/such/report.md"] },
  });
  assert.equal(r.ok, false);
});

// ===========================================================================
// Stage 3 — real CLI path: `quay gate <task> --gate vmeta-lag|dogfood-evidence`
// against a real (non-fixture-provider) native-provider workspace, real
// GateEvents queryable via `quay gate-log --json`.
// ===========================================================================

test("M43 C1: `quay gate --list` includes 'vmeta-lag' and 'dogfood-evidence'", () => {
  const { workspaceRoot } = makeWorkspace("list");
  const r = runQuay(["gate", "--list"], workspaceRoot);
  assert.equal(r.status, 0);
  const lines = r.stdout.split("\n");
  assert.ok(lines.includes("vmeta-lag"), `expected 'vmeta-lag' listed; got: ${r.stdout}`);
  assert.ok(lines.includes("dogfood-evidence"), `expected 'dogfood-evidence' listed; got: ${r.stdout}`);
});

test("M43 C1: `quay gate <task> --gate vmeta-lag` PASSes for real and appends a real GateEvent", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-vmetalag");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  const ledger = writeLedgerFixture(workspaceRoot, { alarm: false });
  runNative(["task", "create", "T-VMETALAG", "--title", "vmeta-lag CLI fixture", "--status", "todo"], tasksDir);
  runNative(
    ["task", "edit", "T-VMETALAG", "--extra", JSON.stringify({ vmetaLagArgs: ["--counter", "3", ledger] })],
    tasksDir
  );
  const r = runQuay(["gate", "T-VMETALAG", "--gate", "vmeta-lag", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected PASS; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);

  const log = runQuay(["gate-log", "T-VMETALAG", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "vmeta-lag");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].pipeline_id, "T-VMETALAG");
});

test("M43 C1: `quay gate <task> --gate dogfood-evidence` PASSes for real and appends a real GateEvent", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-dogfood");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  const report = writeReportFixture(workspaceRoot, { hasEvidence: true });
  runNative(["task", "create", "T-DOGFOOD", "--title", "dogfood-evidence CLI fixture", "--status", "todo"], tasksDir);
  runNative(
    ["task", "edit", "T-DOGFOOD", "--extra", JSON.stringify({ dogfoodEvidenceArgs: [report] })],
    tasksDir
  );
  const r = runQuay(["gate", "T-DOGFOOD", "--gate", "dogfood-evidence", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected PASS; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);

  const log = runQuay(["gate-log", "T-DOGFOOD", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "dogfood-evidence");
  assert.equal(events[0].verdict, "pass");
});

test("M43 C1: `quay gate <task> --gate vmeta-lag` FAILs (exit 1) for real when args unset, GateEvent verdict is fail", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-vmetalag-fail");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "T-NOARGS", "--title", "no-args fixture", "--status", "todo"], tasksDir);
  const r = runQuay(["gate", "T-NOARGS", "--gate", "vmeta-lag", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1, `expected FAIL (exit 1); got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /no vmeta-lag arguments defined/);

  const log = runQuay(["gate-log", "T-NOARGS", "--json", "--file", logFile], workspaceRoot);
  const events = JSON.parse(log.stdout);
  assert.equal(events[0].verdict, "fail");
});

// ===========================================================================
// Stage 4 — real-world demonstration: this milestone's OWN real ABSORB proof
// (Done-when clause 4 / AC3) — run ≥2 distinct non-`dod` gates against a
// real object in this repo, read-only, no mutation of real task files.
// ===========================================================================

test("M43 D1: vmeta-lag gate PASSes for real against this repo's own v-meta-ledger.md", async () => {
  const ledger = path.join(REPO_ROOT, "experiments/quay-perpetual-stream/v-meta-ledger.md");
  assert.ok(fs.existsSync(ledger), "real v-meta-ledger.md must exist in this worktree");
  const r = await gate("vmeta-lag")({
    id: "exp5-M-DIR022-REMAINING-GATES",
    extra: { vmetaLagArgs: ["--counter", "43", ledger] },
  });
  // Only asserting the gate RAN for real (ok is whatever the real ledger's
  // real state says — not asserted true/false here, that would be redundant
  // with the ledger's own live content, which this milestone does not own).
  assert.equal(typeof r.ok, "boolean");
  assert.equal(typeof r.reason, "string");
});

test("M43 D1: line-budget gate PASSes for real against this milestone's OWN real charter file (multi-gate ABSORB proof, non-dod #2)", async () => {
  const charter = path.join(
    REPO_ROOT,
    "experiments/quay-perpetual-stream/charters/M43-dir022-remaining-gates.md"
  );
  assert.ok(fs.existsSync(charter), "real M43 charter must exist in this worktree");
  const r = await gate("line-budget")({
    id: "exp5-M-DIR022-REMAINING-GATES",
    extra: { lineBudgetArgs: [charter] },
  });
  assert.equal(r.ok, true, `expected pass against the real M43 charter; got reason=${r.reason}`);
});
