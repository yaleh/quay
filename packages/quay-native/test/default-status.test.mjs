// @test-group product
// DIR-047: configurable creation default status via .quay/config.yml.
//
// RED→GREEN tests (ADR-001) for:
//   1. resolveDefaultStatus() — valid values pass, illegal values throw
//   2. createStore({ defaultStatus }) — new task creation uses the configured default
//   3. CLI task create with config default (via QUAY_CONFIG_DEFAULT_STATUS env, tested below)
//   4. MCP task_write with status omitted uses the configured default
//   5. Backward compatibility: absent key / "todo" → "todo" (no regression)
//
// Run: node --test packages/quay-native/test/default-status.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createStore, resolveDefaultStatus } from "../src/store.ts";
import { QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = QUAY_NATIVE_CLI;

// ── helper ────────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "quay-dir047-"));
}

function writeConfig(workspaceRoot, defaultStatus) {
  const quayDir = path.join(workspaceRoot, ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  const providerBlock = defaultStatus !== undefined
    ? `    default_task_status: ${defaultStatus}\n`
    : "";
  fs.writeFileSync(
    path.join(quayDir, "config.yml"),
    `providers:\n  native:\n    enabled: true\n${providerBlock}    mcp_entry: ["node", "${binPath}", "mcp"]\n    env: {}\n`,
    "utf8"
  );
}

// ── 1. resolveDefaultStatus() unit tests ─────────────────────────────────────

describe("resolveDefaultStatus", () => {
  it("accepts 'todo' (identity)", () => {
    assert.equal(resolveDefaultStatus("todo"), "todo");
  });
  it("accepts 'ready'", () => {
    assert.equal(resolveDefaultStatus("ready"), "ready");
  });
  it("accepts 'done'", () => {
    assert.equal(resolveDefaultStatus("done"), "done");
  });
  it("accepts 'needs-human'", () => {
    assert.equal(resolveDefaultStatus("needs-human"), "needs-human");
  });
  it("rejects an illegal value with a clear error", () => {
    assert.throws(
      () => resolveDefaultStatus("invalid-status"),
      /invalid.*default_task_status.*invalid-status|default_task_status.*must be one of/i
    );
  });
  it("rejects 'READY' (case-sensitive)", () => {
    assert.throws(
      () => resolveDefaultStatus("READY"),
      /invalid.*default_task_status|default_task_status.*must be one of/i
    );
  });
});

// ── 2. createStore with defaultStatus — new task uses configured default ──────

describe("createStore defaultStatus option", () => {
  let tasksDir;
  before(() => { tasksDir = tmpDir(); });
  after(() => { fs.rmSync(tasksDir, { recursive: true, force: true }); });

  it("new task gets defaultStatus when status omitted from write()", () => {
    const store = createStore(tasksDir, { defaultStatus: "ready" });
    store.write("T-1", { title: "task one" });
    const t = store.get("T-1");
    assert.equal(t.status, "ready", "status should be 'ready' (configured default)");
  });

  it("explicit status always wins over defaultStatus", () => {
    const store = createStore(tasksDir, { defaultStatus: "ready" });
    store.write("T-2", { title: "task two", status: "todo" });
    const t = store.get("T-2");
    assert.equal(t.status, "todo", "explicit --status todo overrides configured default 'ready'");
  });

  it("no defaultStatus option: new task defaults to 'todo' (backward compat)", () => {
    const store = createStore(tasksDir);
    store.write("T-3", { title: "task three" });
    const t = store.get("T-3");
    assert.equal(t.status, "todo", "no defaultStatus → 'todo' (original behavior)");
  });

  it("defaultStatus: 'todo': new task is still 'todo' (no-op compat)", () => {
    const store = createStore(tasksDir, { defaultStatus: "todo" });
    store.write("T-4", { title: "task four" });
    const t = store.get("T-4");
    assert.equal(t.status, "todo", "defaultStatus: 'todo' → 'todo'");
  });

  it("patch on existing task does NOT use defaultStatus", () => {
    const store = createStore(tasksDir, { defaultStatus: "ready" });
    store.write("T-5", { title: "task five", status: "done" });
    // Patch without status — should NOT change existing status to 'ready'
    store.write("T-5", { title: "task five updated" });
    const t = store.get("T-5");
    assert.equal(t.status, "done", "patching existing task without status does not overwrite its current status");
  });
});

// ── 3. CLI task create with config default ────────────────────────────────────

describe("CLI task create with default_task_status in config", () => {
  let workspaceRoot, tasksDir;
  before(() => {
    workspaceRoot = tmpDir();
    tasksDir = path.join(workspaceRoot, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
  });
  after(() => { fs.rmSync(workspaceRoot, { recursive: true, force: true }); });

  it("with default_task_status: ready — no --status flag yields 'ready'", () => {
    writeConfig(workspaceRoot, "ready");
    const env = { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir };
    execFileSync("node", [binPath, "task", "create", "CLI-1", "--title", "CLI test"], {
      cwd: workspaceRoot, env,
    });
    const result = JSON.parse(
      execFileSync("node", [binPath, "task", "get", "CLI-1", "--json"], { cwd: workspaceRoot, env, encoding: "utf8" })
    );
    assert.equal(result.status, "ready", "task created without --status should land 'ready'");
  });

  it("with default_task_status: ready — explicit --status todo yields 'todo'", () => {
    const env = { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir };
    execFileSync("node", [binPath, "task", "create", "CLI-2", "--title", "CLI explicit", "--status", "todo"], {
      cwd: workspaceRoot, env,
    });
    const result = JSON.parse(
      execFileSync("node", [binPath, "task", "get", "CLI-2", "--json"], { cwd: workspaceRoot, env, encoding: "utf8" })
    );
    assert.equal(result.status, "todo", "explicit --status todo overrides configured default 'ready'");
  });

  it("with no default_task_status key — no --status flag yields 'todo' (backward compat)", () => {
    writeConfig(workspaceRoot, undefined);
    const env = { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir };
    execFileSync("node", [binPath, "task", "create", "CLI-3", "--title", "CLI compat"], {
      cwd: workspaceRoot, env,
    });
    const result = JSON.parse(
      execFileSync("node", [binPath, "task", "get", "CLI-3", "--json"], { cwd: workspaceRoot, env, encoding: "utf8" })
    );
    assert.equal(result.status, "todo", "absent key → 'todo' (original behavior)");
  });

  it("with default_task_status set to an illegal value — CLI exits non-zero with clear error", () => {
    writeConfig(workspaceRoot, "illegal-value");
    const env = { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir };
    let threw = false;
    let stderr = "";
    try {
      execFileSync("node", [binPath, "task", "create", "CLI-4", "--title", "CLI bad"], {
        cwd: workspaceRoot, env,
      });
    } catch (err) {
      threw = true;
      stderr = err.stderr || "";
    }
    assert.ok(threw, "illegal default_task_status: CLI exits non-zero");
    assert.ok(
      /illegal-value|default_task_status|invalid/i.test(stderr),
      `illegal default_task_status: stderr names the problem (got: ${stderr})`
    );
  });
});

// ── 4. MCP task_write with status omitted uses configured default ──────────────

describe("MCP task_write with status omitted uses defaultStatus", () => {
  let workspaceRoot, tasksDir, client, transport;
  before(async () => {
    workspaceRoot = tmpDir();
    tasksDir = path.join(workspaceRoot, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    writeConfig(workspaceRoot, "ready");

    transport = new StdioClientTransport({
      command: "node",
      args: [binPath, "mcp"],
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
      cwd: workspaceRoot,
    });
    client = new Client({ name: "dir047-mcp-test", version: "0.0.1" });
    await client.connect(transport);
  });
  after(async () => {
    await client.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("task_write without status creates task with configured default 'ready'", async () => {
    const result = await client.callTool({
      name: "task_write",
      arguments: { id: "MCP-1", title: "MCP no-status test" },
    });
    assert.ok(!result.isError, `task_write should not error: ${JSON.stringify(result.content)}`);
    const task = result.structuredContent.task;
    assert.equal(task.status, "ready", "MCP task_write without status → configured default 'ready'");
  });

  it("task_write with explicit status overrides the configured default", async () => {
    const result = await client.callTool({
      name: "task_write",
      arguments: { id: "MCP-2", title: "MCP explicit status", status: "todo" },
    });
    assert.ok(!result.isError, `task_write should not error: ${JSON.stringify(result.content)}`);
    const task = result.structuredContent.task;
    assert.equal(task.status, "todo", "explicit status: 'todo' overrides configured default 'ready'");
  });
});
