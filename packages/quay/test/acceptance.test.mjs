// @test-group serial
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-12 real node CLI subprocess spawns (execFileSync) + real mkdtemp I/O; moved product→serial 2026-08-12 (8-lane flakes, isolated 36/36 — gap-suite-tiering-kind-heavy-not-a-mechanism 补缺省 kind)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — spawns real node CLI subprocesses for the acceptance gate; flaked under 8-lane (moved to serial by outer 2026-08-12)
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
import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpCwd(tag) {
  return makeTmpDir(`quay-qeng2-${tag}-`);
}

// mirrors gate.test.mjs / gap-cli-gate-enforcement.test.mjs makeWorkspace(); the shared helper
// registers cleanup so the /tmp dirs are removed at the end of the file.
function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-qeng2-${tag}`, { nativeBin, nativeProviderDir });
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

// ===========================================================================
// Phase D / dry-run — `gate --dry-run` / `gate -n` (DIR-103-A, M223)
// ===========================================================================

// D1: helper unit — runAcceptanceCapture on exit 0 with stdout
test("D1: runAcceptanceCapture('printf dry-ok; exit 0') -> { output contains stdout, code:0, timedOut:false }", async () => {
  const { runAcceptanceCapture } = await import("../src/gate/acceptance-runner.ts");
  const r = runAcceptanceCapture({ command: "printf 'dry-ok'; exit 0", cwd: tmpCwd("d1-pass"), timeoutMs: 5000 });
  assert.equal(r.code, 0);
  assert.equal(r.timedOut, false);
  assert.ok(r.output.includes("dry-ok"), `expected output to include 'dry-ok', got: ${JSON.stringify(r.output)}`);
  assert.equal(r.error, null);
});

// D1: helper unit — runAcceptanceCapture on exit 3 with stderr
test("D1: runAcceptanceCapture('printf dry-err >&2; exit 3') -> { code:3, output contains stderr }", async () => {
  const { runAcceptanceCapture } = await import("../src/gate/acceptance-runner.ts");
  const r = runAcceptanceCapture({ command: "printf 'dry-err' >&2; exit 3", cwd: tmpCwd("d1-fail"), timeoutMs: 5000 });
  assert.equal(r.code, 3);
  assert.equal(r.timedOut, false);
  assert.ok(r.output.includes("dry-err"), `expected output to include 'dry-err', got: ${JSON.stringify(r.output)}`);
  assert.equal(r.error, null);
});

// D1: helper unit — runAcceptanceCapture on timeout
test("D1: runAcceptanceCapture('sleep 30', timeoutMs:200) -> { timedOut:true, code:null }", async () => {
  const { runAcceptanceCapture } = await import("../src/gate/acceptance-runner.ts");
  const r = runAcceptanceCapture({ command: "sleep 30", cwd: tmpCwd("d1-timeout"), timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.equal(r.code, null);
  assert.equal(r.error, null);
});

// D2 [AC4]: dry-run appends ZERO GateEvents (real before/after) + positive assertion
test("D2 [AC4]: gate --dry-run appends zero GateEvents, log byte-identical before/after", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("d2-nolog");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2DR1", "--title", "dry-run out fixture", "--status", "todo"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2DR1", "--acceptance", "printf 'dry-out'; exit 3"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const beforeLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";

  const gate = runQuay(["gate", "--dry-run", "QENG2DR1", "--file", logFile], workspaceRoot);
  // Positive: the command actually executed
  assert.ok(gate.stdout.includes("dry-out"), `expected stdout to contain 'dry-out', got: ${gate.stdout}`);
  assert.ok(gate.stdout.includes("dry-run: exit 3"), `expected stdout to contain 'dry-run: exit 3', got: ${gate.stdout}`);

  const afterLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  assert.equal(afterLog, beforeLog, `gate-event log changed: before=${JSON.stringify(beforeLog)} after=${JSON.stringify(afterLog)}`);
});

// D3 [AC5]: dry-run leaves status unchanged (ready fixture stays ready)
test("D3 [AC5]: gate --dry-run leaves task status unchanged (ready stays ready)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("d3-status");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2DR2", "--title", "dry-run ready fixture", "--status", "ready"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2DR2", "--acceptance", "exit 0"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const gate = runQuay(["gate", "--dry-run", "QENG2DR2", "--file", logFile], workspaceRoot);
  // Positive: the dry-run actually executed
  assert.ok(gate.stdout.includes("dry-run: exit 0"), `expected stdout to contain 'dry-run: exit 0', got: ${gate.stdout}`);

  const view = runQuay(["task", "view", "QENG2DR2", "--json"], workspaceRoot);
  const t = JSON.parse(view.stdout);
  assert.equal(t.status, "ready", `expected status 'ready', got ${JSON.stringify(t.status)}`);
});

// D4 [AC1/AC2]: exit code surfaced + output printed
test("D4 [AC1/AC2]: gate --dry-run prints stdout/stderr and mirrors exit code", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("d4-exitcode");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2DR3", "--title", "dry-run ok fixture", "--status", "todo"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2DR3", "--acceptance", "printf 'DRYRUN-OK'; exit 7"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  const gate = runQuay(["gate", "--dry-run", "QENG2DR3", "--file", logFile], workspaceRoot);
  assert.equal(gate.status, 7, `expected exit 7, got ${gate.status}, stdout=${gate.stdout}, stderr=${gate.stderr}`);
  assert.ok(gate.stdout.includes("DRYRUN-OK"), `expected stdout to contain 'DRYRUN-OK', got: ${gate.stdout}`);
  assert.ok(gate.stdout.includes("dry-run: exit 7"), `expected stdout to contain 'dry-run: exit 7', got: ${gate.stdout}`);
});

// D5 [AC3]: -n short flag equivalence (both positions)
test("D5 [AC3]: gate -n behaves identically to gate --dry-run (both positions)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("d5-shortflag");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "QENG2DR4", "--title", "dry-run -n fixture", "--status", "todo"], tasksDir);

  const edit = runQuay(["task", "edit", "QENG2DR4", "--acceptance", "printf 'DRYRUN-N-OK'; exit 7"], workspaceRoot);
  assert.equal(edit.status, 0, `edit failed: ${edit.stderr}`);

  // flag-first: gate -n <id>
  const beforeLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const gate1 = runQuay(["gate", "-n", "QENG2DR4", "--file", logFile], workspaceRoot);
  assert.equal(gate1.status, 7, `flag-first -n: expected exit 7, got ${gate1.status}, stdout=${gate1.stdout}`);
  assert.ok(gate1.stdout.includes("DRYRUN-N-OK"), `flag-first -n: expected 'DRYRUN-N-OK' in stdout, got: ${gate1.stdout}`);
  assert.ok(gate1.stdout.includes("dry-run: exit 7"), `flag-first -n: expected 'dry-run: exit 7' in stdout, got: ${gate1.stdout}`);
  const afterLog1 = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  assert.equal(afterLog1, beforeLog, `-n flag-first appended a GateEvent`);

  // id-first: gate <id> -n
  const gate2 = runQuay(["gate", "QENG2DR4", "-n", "--file", logFile], workspaceRoot);
  assert.equal(gate2.status, 7, `id-first -n: expected exit 7, got ${gate2.status}, stdout=${gate2.stdout}`);
  assert.ok(gate2.stdout.includes("DRYRUN-N-OK"), `id-first -n: expected 'DRYRUN-N-OK' in stdout, got: ${gate2.stdout}`);
  assert.ok(gate2.stdout.includes("dry-run: exit 7"), `id-first -n: expected 'dry-run: exit 7' in stdout, got: ${gate2.stdout}`);
  const afterLog2 = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  assert.equal(afterLog2, beforeLog, `-n id-first appended a GateEvent`);
});

// ===========================================================================
// Phase D / M225 — DIR-103-C: per-provider acceptance_env env file sourcing
// T1–T2: unit tests (direct import runAcceptance with envFile)
// T3: per-provider CLI (two providers, different env files)
// T4: MCP gate_run surface via connectStdio
// ===========================================================================

// ---------------------------------------------------------------------------
// T1–T2: A2-level — direct-import runAcceptance env-file tests (AC #1, AC #2)
// ---------------------------------------------------------------------------

test("A2 [T1]: runAcceptance with envFile sources exports so the command sees them (AC #1)", () => {
  const cwd = tmpCwd("t1-env");
  const envFile = path.join(cwd, "acceptance.env");
  fs.writeFileSync(envFile, "export QUAY_ACCEPTANCE_TEST_VAR=from_file\n");
  const r = runAcceptance({
    command: 'test "$QUAY_ACCEPTANCE_TEST_VAR" = "from_file"',
    cwd,
    timeoutMs: 5000,
    envFile,
  });
  assert.equal(r.ok, true, `expected ok:true; got ${JSON.stringify(r)}`);
  assert.match(r.reason, /passed/);
});

test("A2 [T1-control]: same command WITHOUT envFile fails — proving the var came from the file", () => {
  const cwd = tmpCwd("t1-ctrl");
  const r = runAcceptance({
    command: 'test "$QUAY_ACCEPTANCE_TEST_VAR" = "from_file"',
    cwd,
    timeoutMs: 5000,
  });
  assert.equal(r.ok, false, `expected ok:false (var not set); got ${JSON.stringify(r)}`);
});

test("A2 [T1]: envFile with multiple exports all visible to the command", () => {
  const cwd = tmpCwd("t1-multi");
  const envFile = path.join(cwd, "acceptance.env");
  fs.writeFileSync(envFile, "export A=hello\nexport B=world\n");
  const r = runAcceptance({
    command: 'test "$A" = "hello" && test "$B" = "world"',
    cwd,
    timeoutMs: 5000,
    envFile,
  });
  assert.equal(r.ok, true, `expected ok:true; got ${JSON.stringify(r)}`);
});

test("A2 [T2]: runAcceptance with non-existent envFile fails-closed BEFORE execution (AC #2)", () => {
  const cwd = tmpCwd("t2-missing");
  const marker = path.join(cwd, "marker");
  const missingFile = path.join(cwd, "no-such-env.env");
  const r = runAcceptance({
    command: `touch ${marker}`,
    cwd,
    timeoutMs: 5000,
    envFile: missingFile,
  });
  assert.equal(r.ok, false, `expected ok:false; got ${JSON.stringify(r)}`);
  assert.match(r.reason, /acceptance_env file not found|no such file/i, `reason should name missing file: ${r.reason}`);
  assert.equal(fs.existsSync(marker), false, "marker must NOT exist — acceptance command was never executed");
});

test("A2 [T2]: missing envFile reason names the specific path", () => {
  const cwd = tmpCwd("t2-path");
  const missingFile = path.join(cwd, "really-missing.env");
  const r = runAcceptance({
    command: "exit 0",
    cwd,
    timeoutMs: 5000,
    envFile: missingFile,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, new RegExp(missingFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// ---------------------------------------------------------------------------
// T3: C1-level — per-provider CLI with two providers, different env files (AC #3, AC #5)
// ---------------------------------------------------------------------------

test("C1 [T3]: two providers with different acceptance_env — enabled provider honors its own (AC #3, #5)", () => {
  const tag = "t3-2prov";
  const tasksDir = makeTmpDir(`quay-qeng2-${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`quay-qeng2-${tag}-ws-`);

  const envA = path.join(workspaceRoot, "envA.env");
  const envB = path.join(workspaceRoot, "envB.env");
  fs.writeFileSync(envA, "export WHICH_PROVIDER=provider_a\n");
  fs.writeFileSync(envB, "export WHICH_PROVIDER=provider_b\n");

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
      `    acceptance_env: "${envA.replaceAll("\\", "\\\\")}"`,
      "  native-b:",
      "    enabled: false",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    acceptance_env: "${envB.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );

  runNative(["task", "create", "T3PROVA", "--title", "per-provider a", "--status", "todo"], tasksDir);
  const editA = runQuay(["task", "edit", "T3PROVA", "--acceptance", 'test "$WHICH_PROVIDER" = "provider_a"'], workspaceRoot);
  assert.equal(editA.status, 0, `editA failed: ${editA.stderr}`);

  runNative(["task", "create", "T3PROVB", "--title", "per-provider b", "--status", "todo"], tasksDir);
  const editB = runQuay(["task", "edit", "T3PROVB", "--acceptance", 'test "$WHICH_PROVIDER" = "provider_b"'], workspaceRoot);
  assert.equal(editB.status, 0, `editB failed: ${editB.stderr}`);

  const logFile = path.join(workspaceRoot, "g.jsonl");

  // Enabled provider native → envA
  const gateA = runQuay(["gate", "T3PROVA", "--file", logFile], workspaceRoot);
  assert.equal(gateA.status, 0, `expected native gate PASS exit 0 (envA); got ${gateA.status}, stdout=${gateA.stdout}, stderr=${gateA.stderr}`);
  assert.match(gateA.stdout, /PASS/);

  // Explicit --provider native-b → envB
  const gateB = runQuay(["gate", "T3PROVB", "--file", logFile, "--provider", "native-b"], workspaceRoot);
  assert.equal(gateB.status, 0, `expected native-b gate PASS exit 0 (envB); got ${gateB.status}, stdout=${gateB.stdout}, stderr=${gateB.stderr}`);
  assert.match(gateB.stdout, /PASS/);

  // Negative control: native-b envB is wrong for envA's task
  const gateWrong = runQuay(["gate", "T3PROVA", "--file", logFile, "--provider", "native-b"], workspaceRoot);
  assert.equal(gateWrong.status, 1, `expected FAIL (wrong provider env); got ${gateWrong.status}, stdout=${gateWrong.stdout}`);
  assert.match(gateWrong.stdout, /FAIL/);
});

// ---------------------------------------------------------------------------
// T4: C1-level — MCP gate_run surface sees env exports (AC #4)
// ---------------------------------------------------------------------------

test("C1 [T4]: MCP gate_run surface sees acceptance_env exports (AC #4)", async () => {
  const tag = "t4-mcp";
  const tasksDir = makeTmpDir(`quay-qeng2-${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`quay-qeng2-${tag}-ws-`);

  const envFile = path.join(workspaceRoot, "mcp-test.env");
  fs.writeFileSync(envFile, "export MCP_ENV_TEST_VAR=hello_from_mcp_env\n");

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
      `    acceptance_env: "${envFile.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );

  runNative(["task", "create", "T4MCP", "--title", "mcp env test", "--status", "todo"], tasksDir);
  runNative(["task", "edit", "T4MCP", "--extra", JSON.stringify({ acceptance: 'test "$MCP_ENV_TEST_VAR" = "hello_from_mcp_env"' })], tasksDir);

  // Drive the REAL MCP surface via StdioClientTransport (mirrors mcp-server.test.mjs pattern)
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const coreBin = QUAY_CLI;

  const transport = new StdioClientTransport({
    command: "node",
    args: [coreBin, "mcp"],
    cwd: workspaceRoot,
    env: process.env,
  });
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(transport);

  try {
    const result = await client.callTool({ name: "gate_run", arguments: { id: "T4MCP" } });
    const sc = result.structuredContent;
    assert.ok(sc, `structuredContent missing: ${JSON.stringify(result)}`);
    assert.equal(sc.ok, true, `expected ok:true; got ${JSON.stringify(sc)}`);
    assert.match(sc.reason, /passed/);
  } finally {
    await client.close();
  }
});

test("C1 [T4-control]: MCP gate_run with NO acceptance_env configured does not invent env exports", async () => {
  const tag = "t4-mcp-ctrl";
  const tasksDir = makeTmpDir(`quay-qeng2-${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`quay-qeng2-${tag}-ws-`);

  // deliberately NO acceptance_env key on this provider block
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

  runNative(["task", "create", "T4MCPCTRL", "--title", "mcp env control", "--status", "todo"], tasksDir);
  runNative(["task", "edit", "T4MCPCTRL", "--extra", JSON.stringify({ acceptance: 'test -z "$MCP_ENV_TEST_VAR"' })], tasksDir);

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const coreBin = QUAY_CLI;

  const transport = new StdioClientTransport({
    command: "node",
    args: [coreBin, "mcp"],
    cwd: workspaceRoot,
    env: process.env,
  });
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(transport);

  try {
    const result = await client.callTool({ name: "gate_run", arguments: { id: "T4MCPCTRL" } });
    const sc = result.structuredContent;
    assert.ok(sc, `structuredContent missing: ${JSON.stringify(result)}`);
    assert.equal(sc.ok, true, `expected ok:true (var correctly absent, no phantom env file); got ${JSON.stringify(sc)}`);
    assert.match(sc.reason, /passed/);
  } finally {
    await client.close();
  }
});
