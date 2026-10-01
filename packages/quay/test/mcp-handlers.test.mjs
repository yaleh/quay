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

// ── silent-completion guard (gap-silent-completion-path-writes-no-gate-event) ───────────────────
// The 2026-09-30 defect: a bare `task_write` flipped `needs-human → done` and produced ZERO
// `complete` GateEvents. gate-event-coverage-check (fail-closed, ahead of the suite) then reddened
// the next day and every code delta's fan-in aborted at the static gate. These three tests pin the
// write-side closure: refused without the channel, recorded with it, and the reason is required.
// NB: resolved per call — `workspaceRoot` is assigned by the `before` hook, after module load.
const completeEventsFor = (id) => {
  const gateLogPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  if (!fs.existsSync(gateLogPath)) return [];
  return fs.readFileSync(gateLogPath, "utf8").split("\n").filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((e) => e && e.gate === "complete" && e.verdict === "pass" && e.pipeline_id === id);
};

test("task_write status=done without completeReason is refused, and writes no complete event (AC3 negative control)", async () => {
  const id = "gap-silent-guard-neg";
  await seedTask(id);
  // A state the normal promote path refuses — this is the exact 2026-09-30 shape (a task parked at
  // needs-human completed because its blocker was infrastructure).
  const parked = await core.callTool({ name: "task_write", arguments: { id, status: "needs-human" } });
  assert.ok(!parked.isError, `parking at needs-human must succeed (got isError=${parked.isError})`);

  const r = await core.callTool({ name: "task_write", arguments: { id, status: "done" } });
  assert.equal(r.isError, true, "status:'done' with no completeReason must be refused (isError:true)");
  assert.match(r.content?.[0]?.text ?? "", /completeReason/, "the refusal names the out-of-band channel");

  const after = await core.callTool({ name: "task_get", arguments: { id } });
  assert.equal(after.structuredContent.task.status, "needs-human", "the refused write did not mutate the task");
  assert.equal(completeEventsFor(id).length, 0, "the refused write produced no complete GateEvent");
});

test("task_write status=done with a too-short completeReason is refused (reason required, AC3)", async () => {
  const id = "gap-silent-guard-short";
  await seedTask(id);
  const r = await core.callTool({ name: "task_write", arguments: { id, status: "done", completeReason: "ok" } });
  assert.equal(r.isError, true, "a 2-char reason must not force a task to done");
  const after = await core.callTool({ name: "task_get", arguments: { id } });
  assert.equal(after.structuredContent.task.status, "todo", "the refused write left the task untouched");
  assert.equal(completeEventsFor(id).length, 0, "the refused write produced no complete GateEvent");
});

test("task_write status=done via the out-of-band channel writes status AND the complete event (AC3 positive control)", async () => {
  const id = "gap-silent-guard-pos";
  await seedTask(id);
  await core.callTool({ name: "task_write", arguments: { id, status: "needs-human" } });

  const reason = "blocker was infrastructure, not the implementation; evidence recorded in the task body";
  const r = await core.callTool({ name: "task_write", arguments: { id, status: "done", completeReason: reason } });
  assert.ok(!r.isError, `the out-of-band channel must succeed (got isError=${r.isError})`);
  assert.equal(r.structuredContent.task.status, "done", "the channel persists status=done");

  const events = completeEventsFor(id);
  assert.equal(events.length, 1, "the channel wrote exactly ONE complete/pass GateEvent");
  assert.equal(events[0].payload.verifiedBy, reason, "the event carries the caller's reason as evidence");
  assert.equal(events[0].payload.from, "needs-human", "the event records the real source status");
  assert.equal(events[0].payload.via, "out-of-band", "the event is marked as an out-of-band completion");
});
