// Stage 6 — the GitHub provider declares ADRs UNSUPPORTED (they are architectural
// decisions, not GitHub Issues). Degrades cleanly: adr_list → empty, adr_get /
// adr_write → isError. These handlers never touch the gh CLI, so this runs offline.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(__dirname, "..", "bin", "quay-github.js");

let client;
before(async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: [bin, "mcp"],
    env: { ...process.env, QUAY_GITHUB_REPO: "yaleh/quay" },
  });
  client = new Client({ name: "adr-unsupported-test", version: "0.0.1" });
  await client.connect(transport);
});
after(async () => { await client?.close(); });

test("adr_list → empty (clean degradation, no error)", async () => {
  const r = await client.callTool({ name: "adr_list", arguments: {} });
  assert.notEqual(r.isError, true);
  assert.deepEqual(r.structuredContent.adrs, []);
});

test("adr_get → isError with a clear 'not supported' message", async () => {
  const r = await client.callTool({ name: "adr_get", arguments: { id: "ADR-001" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /does not support ADRs/);
});

test("adr_write → isError with a clear 'not supported' message", async () => {
  const r = await client.callTool({ name: "adr_write", arguments: { id: "ADR-001" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /does not support ADRs/);
});
