// @test-group product
// QENG-2 / DIR-103-C — acceptance_env env file sourcing tests
// M225: per-provider acceptance_env + clean-environment contract
//
// Tests T1–T4 from the M225 plan (docs/plans/M225-dir-103-c.md):
//   T1/T2 — direct-import runAcceptance envFile unit tests (AC #1, #2)
//   T3 — per-provider CLI (two providers, different env files) (AC #3, #5)
//   T4 — MCP gate_run surface via connectStdio (AC #4)
//
// Run: node --test packages/quay/test/acceptance-env.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { runAcceptance } from "../src/gate/acceptance-runner.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpCwd(tag) {
  return makeTmpDir(`quay-acceptance-env-${tag}-`);
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

// ---------------------------------------------------------------------------
// T1: runAcceptance with envFile sources exports so the command sees them
// ---------------------------------------------------------------------------

test("T1: runAcceptance with envFile sources exports so the command sees them (AC #1)", () => {
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

test("T1-control: same command WITHOUT envFile fails — proving the var came from the file", () => {
  const cwd = tmpCwd("t1-ctrl");
  const r = runAcceptance({
    command: 'test "$QUAY_ACCEPTANCE_TEST_VAR" = "from_file"',
    cwd,
    timeoutMs: 5000,
  });
  assert.equal(r.ok, false, `expected ok:false (var not set); got ${JSON.stringify(r)}`);
});

test("T1: envFile with multiple exports all visible to the command", () => {
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

// ---------------------------------------------------------------------------
// T2: runAcceptance with non-existent envFile fails-closed BEFORE execution
// ---------------------------------------------------------------------------

test("T2: runAcceptance with non-existent envFile fails-closed BEFORE execution (AC #2)", () => {
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
  assert.match(r.reason, /not found/i, `reason should name missing file: ${r.reason}`);
  assert.equal(fs.existsSync(marker), false, "marker must NOT exist — acceptance command was never executed");
});

test("T2: missing envFile reason names the specific path", () => {
  const cwd = tmpCwd("t2-path");
  const missingFile = path.join(cwd, "really-missing.env");
  const r = runAcceptance({
    command: "exit 0",
    cwd,
    timeoutMs: 5000,
    envFile: missingFile,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, new RegExp(missingFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ---------------------------------------------------------------------------
// T3: per-provider CLI with two providers, different env files (AC #3, #5)
// ---------------------------------------------------------------------------

test("T3: two providers with different acceptance_env — enabled provider honors its own (AC #3, #5)", () => {
  const tag = "t3-2prov";
  const tasksDir = makeTmpDir(`quay-acceptance-env-${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`quay-acceptance-env-${tag}-ws-`);

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

  const logFile = path.join(workspaceRoot, "g.jsonl");

  runNative(["task", "create", "T3PROVA", "--title", "per-provider a", "--status", "todo"], tasksDir);
  const editA = runQuay(["task", "edit", "T3PROVA", "--acceptance", 'test "$WHICH_PROVIDER" = "provider_a"'], workspaceRoot);
  assert.equal(editA.status, 0, `editA failed: ${editA.stderr}`);

  // Enabled provider native → envA
  const gateA = runQuay(["gate", "T3PROVA", "--file", logFile], workspaceRoot);
  assert.equal(gateA.status, 0, `expected native gate PASS exit 0 (envA); got ${gateA.status}, stdout=${gateA.stdout}, stderr=${gateA.stderr}`);
  assert.match(gateA.stdout, /PASS/);

  runNative(["task", "create", "T3PROVB", "--title", "per-provider b", "--status", "todo"], tasksDir);
  const editB = runQuay(["task", "edit", "T3PROVB", "--acceptance", 'test "$WHICH_PROVIDER" = "provider_b"'], workspaceRoot);
  assert.equal(editB.status, 0, `editB failed: ${editB.stderr}`);

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
// T4: MCP gate_run surface sees acceptance_env exports (AC #4)
// ---------------------------------------------------------------------------

test("T4: MCP gate_run surface sees acceptance_env exports (AC #4)", async () => {
  const tag = "t4-mcp";
  const tasksDir = makeTmpDir(`quay-acceptance-env-${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`quay-acceptance-env-${tag}-ws-`);

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
