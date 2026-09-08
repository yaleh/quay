// @test-group product
// mcp-handlers.test.mjs — gap-task-write-labels-replace-not-append-no-safe-add-action: the Core MCP
// `task_add_label` verb is the safe "append one label, keep the rest" action, because
// `task_write.labels` REPLACES the whole set. This test pins the AC: append delivery-critical to a
// task that already has [gap, defect] → [gap, defect, delivery-critical] (original labels intact),
// and a second append of the same label is a no-op (no duplicate).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

let core, workspaceRoot, tasksDir;
before(async () => {
  workspaceRoot = makeTmpDir("mcp-handlers-ws-");
  tasksDir = makeTmpDir("mcp-handlers-tasks-");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    `    path: "${nativeProviderDir}"`,
    `    mcp_entry: ["node", "${QUAY_NATIVE_CLI}", "mcp"]`,
    "    env:",
    `      QUAY_NATIVE_TASKS_DIR: "${tasksDir}"`,
    "",
  ].join("\n"));
  const transport = new StdioClientTransport({ command: "node", args: [QUAY_CLI, "mcp"], cwd: workspaceRoot, env: process.env });
  core = new Client({ name: "mcp-handlers-test", version: "0.0.1" });
  await core.connect(transport);
});
after(async () => { await core?.close(); });

// Seed a task carrying [gap, defect], ready to receive the safe label add.
async function seedTask(id) {
  const r = await core.callTool({
    name: "task_write",
    arguments: { id, title: id, status: "todo", labels: ["gap", "defect"], body: "## Proposal\n\nprose\n" },
  });
  assert.ok(!r.isError, `seed task_write ${id} must succeed (got isError=${r.isError})`);
}

test("task_add_label — appends delivery-critical to [gap, defect] without losing either (AC3)", async () => {
  const id = "gap-labels-add-ac3";
  await seedTask(id);
  const r = await core.callTool({ name: "task_add_label", arguments: { id, label: "delivery-critical" } });
  assert.ok(!r.isError, `task_add_label must not error (got isError=${r.isError})`);
  assert.equal(r.structuredContent.added, true);
  assert.deepEqual([...r.structuredContent.task.labels].sort(), ["defect", "delivery-critical", "gap"].sort());
});

test("task_add_label — second append of the same label is a no-op, no duplicate (AC4)", async () => {
  const id = "gap-labels-add-ac4";
  await seedTask(id);
  await core.callTool({ name: "task_add_label", arguments: { id, label: "delivery-critical" } });
  const r2 = await core.callTool({ name: "task_add_label", arguments: { id, label: "delivery-critical" } });
  assert.ok(!r2.isError, `second task_add_label must not error (got isError=${r2.isError})`);
  assert.equal(r2.structuredContent.added, false, "second append reports added:false");
  const labels = r2.structuredContent.task.labels;
  assert.equal(labels.filter((l) => l === "delivery-critical").length, 1, "no duplicate delivery-critical");
  assert.deepEqual([...labels].sort(), ["defect", "delivery-critical", "gap"].sort());
});
