// @test-group product
// Stage 4 — Core MCP adr_list/adr_get/adr_write proxies (fan-out to the active
// provider), so an agent connected via `quay mcp` can consult/author ADRs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

let core, workspaceRoot;
before(async () => {
  workspaceRoot = makeTmpDir("adr-mcp-ws-");
  const tasksDir = makeTmpDir("adr-mcp-tasks-");
  const adrDir = makeTmpDir("adr-mcp-adr-");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"), [
    "providers:", "  native:", "    enabled: true",
    `    path: "${nativeProviderDir}"`,
    `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
    "    env:",
    `      QUAY_NATIVE_TASKS_DIR: "${tasksDir}"`,
    `      QUAY_NATIVE_ADR_DIR: "${adrDir}"`, "",
  ].join("\n"));
  const transport = new StdioClientTransport({ command: "node", args: [coreBin, "mcp"], cwd: workspaceRoot, env: process.env });
  core = new Client({ name: "adr-mcp-test", version: "0.0.1" });
  await core.connect(transport);
});
after(async () => { await core?.close(); });

test("adr_write → adr_get → adr_list through Core MCP", async () => {
  const w = await core.callTool({ name: "adr_write", arguments: { id: "ADR-001", title: "TDD", status: "accepted", body: "## Decision\nd" } });
  assert.equal(w.structuredContent.adr.status, "accepted");
  const g = await core.callTool({ name: "adr_get", arguments: { id: "ADR-001" } });
  assert.equal(g.structuredContent.adr.title, "TDD");
  const l = await core.callTool({ name: "adr_list", arguments: {} });
  assert.ok(l.structuredContent.adrs.some((a) => a.id === "ADR-001"));
});

test("adr_write invalid status → isError through Core MCP", async () => {
  const r = await core.callTool({ name: "adr_write", arguments: { id: "ADR-002", title: "x", status: "done" } });
  assert.equal(r.isError, true);
});

test("adr_get unknown → isError", async () => {
  const r = await core.callTool({ name: "adr_get", arguments: { id: "ADR-404" } });
  assert.equal(r.isError, true);
});
