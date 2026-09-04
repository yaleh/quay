// @test-group product
// Stage 2 — ADR ABI over MCP: the native provider's adr_list/adr_get/adr_write
// tools, exercised through a live MCP client (the same transport Core uses).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = QUAY_NATIVE_CLI;

let client, adrDir, tasksDir;

before(async () => {
  adrDir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-abi-"));
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-abi-tasks-"));
  const transport = new StdioClientTransport({
    command: "node",
    args: [binPath, "mcp"],
    env: { ...process.env, QUAY_NATIVE_ADR_DIR: adrDir, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  client = new Client({ name: "adr-abi-test", version: "0.0.1" });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  fs.rmSync(adrDir, { recursive: true, force: true });
  fs.rmSync(tasksDir, { recursive: true, force: true });
});

test("adr_write → adr_get round-trip over MCP", async () => {
  const w = await client.callTool({
    name: "adr_write",
    arguments: { id: "ADR-001", title: "TDD scope", status: "accepted", date: "2026-07-19", tags: ["testing"], body: "## Decision\nd" },
  });
  assert.equal(w.structuredContent.adr.status, "accepted");
  const g = await client.callTool({ name: "adr_get", arguments: { id: "ADR-001" } });
  assert.equal(g.structuredContent.adr.title, "TDD scope");
  assert.ok(!("parent" in g.structuredContent.adr), "ADR view-model has no parent");
});

test("adr_write with status:'done' → isError (decision lifecycle, not task)", async () => {
  const r = await client.callTool({ name: "adr_write", arguments: { id: "ADR-002", title: "x", status: "done" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /invalid ADR status/);
});

test("adr_get unknown id → isError", async () => {
  const r = await client.callTool({ name: "adr_get", arguments: { id: "ADR-999" } });
  assert.equal(r.isError, true);
});

test("superseded_by round-trips through the wire (snake→camel)", async () => {
  await client.callTool({ name: "adr_write", arguments: { id: "ADR-003", title: "old", status: "superseded", superseded_by: ["ADR-001"], body: "## Decision\nd" } });
  const g = await client.callTool({ name: "adr_get", arguments: { id: "ADR-003" } });
  assert.deepEqual(g.structuredContent.adr.supersededBy, ["ADR-001"]);
});

test("adr_list filters by status", async () => {
  const r = await client.callTool({ name: "adr_list", arguments: { status: "accepted" } });
  assert.ok(r.structuredContent.adrs.every((a) => a.status === "accepted"));
  assert.ok(r.structuredContent.adrs.some((a) => a.id === "ADR-001"));
});
