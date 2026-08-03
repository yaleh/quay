// @test-group product
// DIR-039 (B): regression test for quay-backlog's own MCP stdio transport
// (src/mcp-server.js, wired into bin/quay-backlog.ts's `mcp` subcommand).
// Mirrors quay-github's own mcp-server.test.mjs shape/header convention.
// Uses a small synthetic fixture board (isolated tmp dir) — the REAL
// archguard board round-trip is exercised by the milestone's captured
// `quay migrate --from backlog --to native` live-run evidence (ABSORB
// record), not repeated here as an automated test (this repo does not own
// /home/yale/work/archguard and must not depend on its exact contents for
// a repeatable CI-style assertion).
//
// Run: node --test test/mcp-server.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(__dirname, "..", "bin", "quay-backlog.ts");

function makeFixtureBoard() {
  const dir = makeTmpDir("quay-backlog-mcp-fixture-");
  fs.writeFileSync(
    path.join(dir, "task-1.md"),
    ["---", "id: TASK-1", "title: MCP fixture task", "status: Done", "labels:", "  - x", "---", "", "## Description", "Fixture body."].join("\n"),
    "utf8"
  );
  return dir;
}

async function connect(tasksDir) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [bin, "mcp"],
    env: { ...process.env, QUAY_BACKLOG_TASKS_DIR: tasksDir },
  });
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

test("provider://manifest resource returns the correct name/read-only capabilities", async () => {
  const dir = makeFixtureBoard();
  const client = await connect(dir);
  try {
    const r = await client.readResource({ uri: "provider://manifest" });
    const manifest = JSON.parse(r.contents[0].text);
    assert.equal(manifest.id, "backlog");
    assert.equal(manifest.name, "quay-backlog");
    assert.equal(manifest.capabilities["data.write"], false);
    assert.equal(manifest.capabilities.gate, false);
  } finally {
    await client.close();
  }
});

test("task_list returns the fixture task with the mapped view-model shape", async () => {
  const dir = makeFixtureBoard();
  const client = await connect(dir);
  try {
    const r = await client.callTool({ name: "task_list", arguments: {} });
    assert.equal(r.isError, undefined);
    const tasks = r.structuredContent.tasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, "TASK-1");
    assert.equal(tasks[0].status, "done");
  } finally {
    await client.close();
  }
});

test("task_get for a known id returns the task; for an unknown id returns isError:true", async () => {
  const dir = makeFixtureBoard();
  const client = await connect(dir);
  try {
    const r = await client.callTool({ name: "task_get", arguments: { id: "TASK-1" } });
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.task.title, "MCP fixture task");

    const rMissing = await client.callTool({ name: "task_get", arguments: { id: "NOPE" } });
    assert.equal(rMissing.isError, true);
  } finally {
    await client.close();
  }
});

test("adr_list degrades to an empty array (this Provider does not support ADRs)", async () => {
  const dir = makeFixtureBoard();
  const client = await connect(dir);
  try {
    const r = await client.callTool({ name: "adr_list", arguments: {} });
    assert.deepEqual(r.structuredContent.adrs, []);
  } finally {
    await client.close();
  }
});

test("there is no task_write tool registered (read-only provider, no write surface)", async () => {
  const dir = makeFixtureBoard();
  const client = await connect(dir);
  try {
    const { tools } = await client.listTools();
    assert.ok(!tools.some((t) => t.name === "task_write"), "task_write must not be registered on a read-only Provider");
  } finally {
    await client.close();
  }
});
