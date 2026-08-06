// @test-group product
// DIR-046 — gate ergonomics for foreign worktrees + long suites.
//
// Three real frictions surfaced by the real archguard iteration (meta-cc
// session 8b74052c, 2026-07-20): a gate that ran the acceptance command in
// the WRONG tree (workspaceRoot, not the worktree the user explicitly asked
// for) and a 60s default timeout too short for a real suite, both env-only
// and undiscoverable. This suite proves (RED->GREEN, ADR-001):
//
//   A — an explicit `--cwd` (or a pre-set QUAY_ACCEPTANCE_CWD, or a gates.yml
//       per-gate `cwd`) wins over the workspaceRoot default pin.
//   B — a per-gate `timeoutMs` in .quay/gates.yml lets a slow-but-passing
//       command PASS where the (lower) default would time out.
//   C — `quay gate --help` documents --cwd/--timeout; a TIMEOUT failure's
//       `reason` names the timeoutMs knob.
//
// Run: node --test packages/quay/test/gate-ergonomics.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { runAcceptance } from "../src/gate/acceptance-runner.ts";
import { loadWorkspaceGates } from "../src/gate/registry.ts";
import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// mirrors gate.test.mjs makeWorkspace()
function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-dir046-${tag}`, { nativeBin, nativeProviderDir });
}

function runQuay(args, cwd, env) {
  try {
    const out = execFileSync("node", [quayBin, ...args], {
      encoding: "utf8",
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
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

const validSections =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";

// ===========================================================================
// A — explicit --cwd wins over the workspaceRoot pin
// ===========================================================================

test("A [RED->GREEN]: `quay gate --cwd <dir>` runs the acceptance command IN <dir>, not workspaceRoot", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cwd-flag");
  // A distinct "worktree" directory, deliberately NOT workspaceRoot.
  const worktree = makeTmpDir("quay-dir046-cwd-flag-worktree-");
  const logFile = path.join(workspaceRoot, "g.jsonl");

  runNative(["task", "create", "CWD-T1", "--title", "cwd override fixture",
    "--status", "todo", "--body", validSections], tasksDir);
  runNative(["task", "edit", "CWD-T1", "--extra",
    JSON.stringify({ acceptance: `test "$(pwd)" = "${worktree}"` })], tasksDir);

  // Without --cwd: default behavior pins workspaceRoot — the acceptance's
  // `pwd` check (which asserts it ran IN the worktree) must FAIL.
  const withoutOverride = runQuay(["gate", "CWD-T1", "--file", logFile], workspaceRoot);
  assert.equal(withoutOverride.status, 1,
    `expected default (no override) to run in workspaceRoot, not the worktree, so the pwd-check FAILs; got ${withoutOverride.status}, stdout=${withoutOverride.stdout}`);

  // With --cwd <worktree>: explicit override wins — the pwd-check PASSes.
  const withOverride = runQuay(["gate", "CWD-T1", "--cwd", worktree, "--file", logFile], workspaceRoot);
  assert.equal(withOverride.status, 0,
    `expected --cwd override to run in <worktree>, so the pwd-check PASSes; got ${withOverride.status}, stdout=${withOverride.stdout}, stderr=${withOverride.stderr}`);
  assert.match(withOverride.stdout, /PASS/);
});

test("A: a pre-set QUAY_ACCEPTANCE_CWD env var is honored, not clobbered by the workspaceRoot pin", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cwd-env");
  const worktree = makeTmpDir("quay-dir046-cwd-env-worktree-");
  const logFile = path.join(workspaceRoot, "g.jsonl");

  runNative(["task", "create", "CWD-T2", "--title", "cwd env fixture",
    "--status", "todo", "--body", validSections], tasksDir);
  runNative(["task", "edit", "CWD-T2", "--extra",
    JSON.stringify({ acceptance: `test "$(pwd)" = "${worktree}"` })], tasksDir);

  const r = runQuay(["gate", "CWD-T2", "--file", logFile], workspaceRoot, { QUAY_ACCEPTANCE_CWD: worktree });
  assert.equal(r.status, 0,
    `expected pre-set QUAY_ACCEPTANCE_CWD to win over the workspaceRoot pin; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);
});

test("A: no override given -> default behavior unchanged (runs in workspaceRoot)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cwd-default");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "CWD-T3", "--title", "cwd default fixture",
    "--status", "todo", "--body", validSections], tasksDir);
  runNative(["task", "edit", "CWD-T3", "--extra",
    JSON.stringify({ acceptance: `test "$(pwd)" = "${workspaceRoot}"` })], tasksDir);

  const r = runQuay(["gate", "CWD-T3", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0,
    `expected default (no override) to still run in workspaceRoot; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
});

// ===========================================================================
// B — per-gate timeoutMs in .quay/gates.yml
// ===========================================================================

test("B [unit]: loadWorkspaceGates wires a testPass gate's own timeoutMs (slow-but-passing PASSes where default would time out)", async () => {
  const workspaceRoot = makeTmpDir("quay-dir046-timeoutms-");
  fs.writeFileSync(
    path.join(workspaceRoot, "gates.yml.fixture"),
    "" // unused, just to keep the dir non-empty; loadWorkspaceGates reads .quay/gates.yml
  );
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "gates.yml"),
    [
      "testPass:",
      "  - name: slow-suite",
      "    command: \"sleep 0.3 && true\"",
      "    timeoutMs: 5000",
      "",
    ].join("\n")
  );
  delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
  const gates = loadWorkspaceGates(workspaceRoot);
  assert.ok(typeof gates["slow-suite"] === "function", "expected slow-suite gate to be registered");
  const r = await gates["slow-suite"]({});
  assert.equal(r.ok, true, `expected slow-but-passing command to PASS under its own 5000ms timeoutMs; got ${JSON.stringify(r)}`);
});

test("B [RED]: without a per-gate timeoutMs, a slow command exceeds the (lower) default and times out", async () => {
  const workspaceRoot = makeTmpDir("quay-dir046-timeoutms-red-");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "gates.yml"),
    [
      "testPass:",
      "  - name: slow-suite-no-budget",
      "    command: \"sleep 0.3 && true\"",
      "",
    ].join("\n")
  );
  const prevTimeout = process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
  process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = "50"; // deliberately below the 300ms sleep
  try {
    const gates = loadWorkspaceGates(workspaceRoot);
    const r = await gates["slow-suite-no-budget"]({});
    assert.equal(r.ok, false, `expected the default (no gates.yml timeoutMs) 50ms budget to time out; got ${JSON.stringify(r)}`);
    assert.match(r.reason, /timed out/);
  } finally {
    if (prevTimeout === undefined) delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
    else process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = prevTimeout;
  }
});

test("B: a per-gate cwd in gates.yml is honored by a testPass gate", async () => {
  const workspaceRoot = makeTmpDir("quay-dir046-gatecwd-");
  const worktree = makeTmpDir("quay-dir046-gatecwd-worktree-");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "gates.yml"),
    [
      "testPass:",
      "  - name: cwd-pinned-suite",
      `    command: "test \\"$(pwd)\\" = \\"${worktree}\\""`,
      `    cwd: "${worktree}"`,
      "",
    ].join("\n")
  );
  const gates = loadWorkspaceGates(workspaceRoot);
  const r = await gates["cwd-pinned-suite"]({});
  assert.equal(r.ok, true, `expected gates.yml per-gate cwd to be honored; got ${JSON.stringify(r)}`);
});

// ===========================================================================
// C — discoverability: --help + timeout-reason names the knob
// ===========================================================================

test("C: `quay gate --help` (via `quay --help`) documents --cwd and --timeout", () => {
  const r = runQuay(["--help"], process.cwd());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--cwd\s*<dir>/, "expected --cwd documented in help text");
  assert.match(r.stdout, /--timeout\s*<ms>/, "expected --timeout documented in help text");
});

test("C: a TIMEOUT failure's reason names the timeoutMs knob to raise", () => {
  const r = runAcceptance({ command: "sleep 0.3", cwd: process.cwd(), timeoutMs: 50 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.match(r.reason, /timeoutMs.*--timeout|--timeout.*timeoutMs/i,
    `expected reason to name the timeoutMs/--timeout knob; got: ${r.reason}`);
});

test("C: `quay gate --cwd <dir>` real CLI TIMEOUT failure names the knob in its printed reason", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("timeout-reason-cli");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "TO-T1", "--title", "timeout reason fixture",
    "--status", "todo", "--body", validSections], tasksDir);
  runNative(["task", "edit", "TO-T1", "--extra",
    JSON.stringify({ acceptance: "sleep 1" })], tasksDir);
  const r = runQuay(["gate", "TO-T1", "--timeout", "100", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /timeoutMs.*--timeout|--timeout.*timeoutMs/i,
    `expected printed reason to name the timeoutMs/--timeout knob; got: ${r.stdout}`);
});
