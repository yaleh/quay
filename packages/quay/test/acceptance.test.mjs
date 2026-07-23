// QENG-2 — AC-as-runnable-meter: `quay gate` runs `task.extra.acceptance`.
//
// Layered per plan 9 (docs/plans/9-quay-acceptance-meter.md):
//   Phase A — pure runner (src/gate/acceptance-runner.js) via direct import over
//             a real mkdtemp cwd (real process I/O, deterministic short timeout).
//   Phase B — the `acceptance` gate fn (src/gate/registry.js) reads
//             extra.acceptance, resolves cwd/timeout from env, calls the runner.
//   Phase C — the real CLI (`node bin/quay.js task edit ... --acceptance` then
//             `node bin/quay.js gate ...`) driven against a disposable
//             native-provider workspace, mirroring gate.test.mjs's makeWorkspace().
//
// Run: node --test --experimental-test-coverage packages/quay/test/acceptance.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { runAcceptance } from "../src/gate/acceptance-runner.ts";
import { gateRegistry, listGates } from "../src/gate/registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = path.join(__dirname, "..", "bin", "quay.ts");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.ts");
const nativeProviderDir = path.dirname(nativeBin);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpCwd(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `quay-qeng2-${tag}-`));
}

// mirrors gate.test.mjs / gap-cli-gate-enforcement.test.mjs makeWorkspace()
function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-qeng2-${tag}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-qeng2-${tag}-ws-`));
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
    ].join("\n")
  );
  return { workspaceRoot, tasksDir };
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

// ===========================================================================
// Phase A / Stage A2 — pure runner unit tests (real process I/O over a tmp cwd)
// ===========================================================================

test("A2: runAcceptance('exit 0') -> { ok:true, code:0, timedOut:false }", () => {
  const r = runAcceptance({ command: "exit 0", cwd: tmpCwd("a2-pass"), timeoutMs: 5000 });
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.timedOut, false);
  assert.match(r.reason, /passed/);
});

test("A2: runAcceptance('exit 1') -> { ok:false, code:1, timedOut:false }", () => {
  const r = runAcceptance({ command: "exit 1", cwd: tmpCwd("a2-fail"), timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.equal(r.timedOut, false);
  assert.match(r.reason, /failed \(exit 1/);
});

test("A2: runAcceptance('exit 3') reports the real nonzero code in the reason", () => {
  const r = runAcceptance({ command: "exit 3", cwd: tmpCwd("a2-fail3"), timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
  assert.match(r.reason, /exit 3/);
});

test("A2: runAcceptance('sleep 30', timeoutMs:200) -> killed { timedOut:true, signal:SIGKILL, code:null }", () => {
  const r = runAcceptance({ command: "sleep 30", cwd: tmpCwd("a2-timeout"), timeoutMs: 200 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.signal, "SIGKILL");
  assert.equal(r.code, null);
  assert.match(r.reason, /timed out after 200ms/);
});

test("A2: runAcceptance defaults timeoutMs to 60000 when omitted (fast passing cmd)", () => {
  const r = runAcceptance({ command: "exit 0", cwd: tmpCwd("a2-default") });
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
});

test("A2: runAcceptance on a spawn failure (unrunnable cwd) -> { ok:false } with a spawn reason", () => {
  const r = runAcceptance({ command: "exit 0", cwd: path.join(os.tmpdir(), "no-such-dir-" + Date.now()), timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, false);
  assert.match(r.reason, /failed to spawn/);
});

// ===========================================================================
// Phase B / Stage B1 — the `acceptance` gate fn (registry) — env-driven cwd/timeout
// ===========================================================================

test("B1: listGates() includes 'acceptance'", () => {
  assert.ok(listGates().includes("acceptance"));
});

test("B1: acceptance gate fails-closed when extra.acceptance is unset", async () => {
  const r = await gateRegistry.acceptance({ id: "T", extra: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no acceptance command defined/);
});

test("B1: acceptance gate fails-closed when extra is entirely absent", async () => {
  const r = await gateRegistry.acceptance({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no acceptance command defined/);
});

test("B1: acceptance gate fails-closed on a whitespace-only command", async () => {
  const r = await gateRegistry.acceptance({ id: "T", extra: { acceptance: "   " } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no acceptance command defined/);
});

test("B1: acceptance gate passes for `exit 0`, honoring QUAY_ACCEPTANCE_CWD", async () => {
  const cwd = tmpCwd("b1-pass");
  const prev = process.env.QUAY_ACCEPTANCE_CWD;
  process.env.QUAY_ACCEPTANCE_CWD = cwd;
  try {
    const r = await gateRegistry.acceptance({ id: "T", extra: { acceptance: "exit 0" } });
    assert.equal(r.ok, true);
    assert.match(r.reason, /passed/);
  } finally {
    if (prev === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
    else process.env.QUAY_ACCEPTANCE_CWD = prev;
  }
});

test("B1: acceptance gate fails for `exit 1`", async () => {
  const cwd = tmpCwd("b1-fail");
  const prev = process.env.QUAY_ACCEPTANCE_CWD;
  process.env.QUAY_ACCEPTANCE_CWD = cwd;
  try {
    const r = await gateRegistry.acceptance({ id: "T", extra: { acceptance: "exit 1" } });
    assert.equal(r.ok, false);
    assert.match(r.reason, /failed/);
  } finally {
    if (prev === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
    else process.env.QUAY_ACCEPTANCE_CWD = prev;
  }
});

test("B1: acceptance gate honors QUAY_ACCEPTANCE_TIMEOUT_MS (short timeout kills a hang)", async () => {
  const cwd = tmpCwd("b1-timeout");
  const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;
  const prevTo = process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
  process.env.QUAY_ACCEPTANCE_CWD = cwd;
  process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = "200";
  try {
    const r = await gateRegistry.acceptance({ id: "T", extra: { acceptance: "sleep 30" } });
    assert.equal(r.ok, false);
    assert.match(r.reason, /timed out after 200ms/);
  } finally {
    if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
    else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
    if (prevTo === undefined) delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
    else process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = prevTo;
  }
});

// ===========================================================================
// Phase C / Stage C1 — real CLI against a native-provider workspace (AC1-AC3)
// ===========================================================================

test("C1 [AC1]: `task edit X --acceptance 'exit 0'` then `gate X` exits 0 and prints PASS", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2A", "--title", "acc pass fixture", "--status", "todo"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2A", "--acceptance", "exit 0"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const gate = runQuay(["gate", "QENG2A", "--file", logFile], workspaceRoot);
  assert.equal(gate.status, 0, `expected PASS exit 0; got ${gate.status}, stdout=${gate.stdout}, stderr=${gate.stderr}`);
  assert.match(gate.stdout, /PASS/);
});

test("C1 [AC2]: `task edit X --acceptance 'exit 1'` then `gate X` exits 1 and prints FAIL", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2B", "--title", "acc fail fixture", "--status", "todo"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2B", "--acceptance", "exit 1"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const gate = runQuay(["gate", "QENG2B", "--file", logFile], workspaceRoot);
  assert.equal(gate.status, 1, `expected FAIL exit 1; got ${gate.status}, stdout=${gate.stdout}, stderr=${gate.stderr}`);
  assert.match(gate.stdout, /FAIL/);
});

test("C1 [AC3]: a hanging acceptance is killed at the enforced timeout and reported FAIL (exit 1)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2C", "--title", "acc hang fixture", "--status", "todo"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2C", "--acceptance", "sleep 30"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const gate = runQuay(["gate", "QENG2C", "--file", logFile], workspaceRoot, { QUAY_ACCEPTANCE_TIMEOUT_MS: "200" });
  assert.equal(gate.status, 1, `expected timeout FAIL exit 1; got ${gate.status}, stdout=${gate.stdout}, stderr=${gate.stderr}`);
  assert.match(gate.stdout, /FAIL/);
  assert.match(gate.stdout, /timed out/);
});

test("C1: unset acceptance -> default gate fails-closed (exit 1) with actionable reason", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac-unset");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2D", "--title", "no acc fixture", "--status", "todo"], tasksDir);

  const gate = runQuay(["gate", "QENG2D", "--file", logFile], workspaceRoot);
  assert.equal(gate.status, 1, `expected fail-closed exit 1; got ${gate.status}, stdout=${gate.stdout}`);
  assert.match(gate.stdout, /no acceptance command defined/);
});

test("C1: --acceptance merges into extra without clobbering existing keys", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac-merge");
  runNative(["task", "create", "QENG2E", "--title", "merge fixture", "--status", "todo"], tasksDir);
  // native `create` doesn't persist --extra; seed the pre-existing key via edit.
  runNative(["task", "edit", "QENG2E", "--extra", JSON.stringify({ keep: "me" })], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2E", "--acceptance", "exit 0"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const view = runQuay(["task", "view", "QENG2E", "--json"], workspaceRoot);
  const t = JSON.parse(view.stdout);
  assert.equal(t.extra.keep, "me");
  assert.equal(t.extra.acceptance, "exit 0");
});

test("C1: a list-valued --acceptance is joined with && at edit time", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac-list");
  runNative(["task", "create", "QENG2F", "--title", "list fixture", "--status", "todo"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2F", "--acceptance", "exit 0", "--acceptance", "true"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const view = runQuay(["task", "view", "QENG2F", "--json"], workspaceRoot);
  const t = JSON.parse(view.stdout);
  assert.equal(t.extra.acceptance, "exit 0 && true");
});

test("C1: --acceptance with a non-string value is a usage error (exit 1)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac-badtype");
  runNative(["task", "create", "QENG2G", "--title", "badtype fixture", "--status", "todo"], tasksDir);
  // a bare `--acceptance` (no value) parses to boolean true -> rejected pre-provider.
  const edit = runQuay(["task", "edit", "QENG2G", "--acceptance"], workspaceRoot);
  assert.equal(edit.status, 1, `expected usage error exit 1; got ${edit.status}, stdout=${edit.stdout}`);
  assert.match(edit.stderr, /--acceptance requires a command string/);
});

test("C1 [regression]: `--gate dod` still routes to QENG-1's dod gate", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dod-regress");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  const validSections =
    "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
    "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
  const acDodChecked =
    "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
    "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";
  runNative(["task", "create", "COMPLIANT", "--title", "Compliant fixture",
    "--status", "todo", "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["gate", "COMPLIANT", "--gate", "dod", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected dod PASS exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);
});
