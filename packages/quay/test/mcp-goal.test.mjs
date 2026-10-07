// @test-group product
// gap-goal-get-meta-get-mcp-name-collision — Core MCP goal_list/goal_get/goal_write/goal_gate
// proxies (fan-out to the active provider), so an agent connected via `quay mcp` can read and
// author GOAL-NNN / AC-NNN records.
//
// Before this fix these four tools were registered ONLY on the native provider's standalone MCP
// server (`packages/quay-native/src/mcp-server.ts`); the Core aggregator a normal Claude Code
// session connects to as `mcp__plugin_quay_quay__*` re-exposed adr_*/task_*/meta_* but NOT goal_*.
// goal-driver's gap-worker dispatch prompts say "Read the AC record (goal_get MCP)" — a tool that,
// on the aggregator, did not exist. The confirmed incident (2026-10-03): an agent dispatched under
// that prompt called the nearest-sounding `meta_get` by mistake (got `no such META: AC-326`) and
// fell back to grep. These tests pin the fix at the aggregator surface.
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

let core, workspaceRoot;
before(async () => {
  workspaceRoot = makeTmpDir("goal-mcp-ws-");
  const tasksDir = makeTmpDir("goal-mcp-tasks-");
  // Goal dir lives UNDER the workspace so goal_gate's evaluation root (dirname(goalDir)) is the
  // workspace itself — its ledger lands at <workspaceRoot>/.quay/gate-events.jsonl, not a shared
  // /tmp/.quay (the native provider derives evalRoot = dirname(goalDir)).
  const goalDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"), [
    "providers:", "  native:", "    enabled: true",
    `    path: "${nativeProviderDir}"`,
    `    mcp_entry: ["node", "${QUAY_NATIVE_CLI}", "mcp"]`,
    "    env:",
    `      QUAY_NATIVE_TASKS_DIR: "${tasksDir}"`,
    `      QUAY_NATIVE_GOAL_DIR: "${goalDir}"`, "",
  ].join("\n"));
  const transport = new StdioClientTransport({ command: "node", args: [QUAY_CLI, "mcp"], cwd: workspaceRoot, env: process.env });
  core = new Client({ name: "goal-mcp-test", version: "0.0.1" });
  await core.connect(transport);
});
after(async () => { await core?.close(); });

// Author an AC first (the store's legal order: an AC may name a GOAL that does not exist yet), then
// the GOAL — a {draft,active} GOAL must carry ≥1 AC at every instant.
async function seedGoalPair() {
  const ac = await core.callTool({
    name: "goal_write",
    arguments: {
      id: "AC-901", title: "the goal tool family is reachable", goal: "GOAL-900",
      criterion: "exit 0", expect: "the criterion runs and passes",
      origin: "gap-goal-get-meta-get-mcp-name-collision regression test",
    },
  });
  assert.ok(!ac.isError, `goal_write AC-901 must succeed (got ${JSON.stringify(ac.content)})`);
  const goal = await core.callTool({
    name: "goal_write",
    arguments: {
      id: "GOAL-900", title: "goal MCP tools are exposed on the aggregator", status: "draft",
      origin: "gap-goal-get-meta-get-mcp-name-collision regression test",
      body: "## 背景\nThis GOAL exists so the aggregator's goal_* surface can be exercised end-to-end.",
    },
  });
  assert.ok(!goal.isError, `goal_write GOAL-900 must succeed (got ${JSON.stringify(goal.content)})`);
}

test("tools/list exposes all four goal_* tools on the Core aggregator (AC1)", async () => {
  const { tools } = await core.listTools();
  const names = (tools ?? []).map((t) => t.name);
  for (const n of ["goal_list", "goal_get", "goal_write", "goal_gate"]) {
    assert.ok(names.includes(n), `aggregator tools/list includes ${n} (got: ${names.join(", ")})`);
  }
});

test("goal_write → goal_get → goal_list through Core MCP (AC1)", async () => {
  await seedGoalPair();

  const ac = await core.callTool({ name: "goal_get", arguments: { id: "AC-901" } });
  assert.ok(!ac.isError, "goal_get AC-901 succeeds through the aggregator");
  assert.equal(ac.structuredContent.goal.id, "AC-901");
  assert.equal(ac.structuredContent.goal.criterion, "exit 0");

  const goal = await core.callTool({ name: "goal_get", arguments: { id: "GOAL-900" } });
  assert.ok(!goal.isError, "goal_get GOAL-900 succeeds through the aggregator");
  assert.equal(goal.structuredContent.goal.id, "GOAL-900");

  const list = await core.callTool({ name: "goal_list", arguments: {} });
  assert.ok(!list.isError, "goal_list succeeds through the aggregator");
  const ids = (list.structuredContent.goals ?? []).map((g) => g.id);
  assert.ok(ids.includes("GOAL-900"), `goal_list includes GOAL-900 (got: ${ids.join(", ")})`);
  assert.ok(ids.includes("AC-901"), `goal_list includes AC-901 (got: ${ids.join(", ")})`);
});

test("goal_gate runs the record's criterion and returns a verdict (AC1)", async () => {
  await seedGoalPair();
  const r = await core.callTool({ name: "goal_gate", arguments: { id: "AC-901" } });
  assert.ok(!r.isError, `goal_gate AC-901 succeeds through the aggregator (got ${JSON.stringify(r.content)})`);
  assert.equal(r.structuredContent.verdict, "pass", "criterion `exit 0` yields verdict pass");
});

test("goal_get unknown id → isError (AC1)", async () => {
  const r = await core.callTool({ name: "goal_get", arguments: { id: "AC-404" } });
  assert.equal(r.isError, true);
});

// The incident (2026-10-03): the agent, unable to find goal_get, called meta_get with an AC id.
// Pin the corrected state: the right tool resolves the AC; the near-name tool still (honestly)
// reports it out of range — so a reader gets a USABLE answer instead of a name-substitution miss.
test("the confirmed incident's call (meta_get with an AC id) cannot recur as a dead end (DoD)", async () => {
  await seedGoalPair();
  const wrong = await core.callTool({ name: "meta_get", arguments: { id: "AC-901" } });
  assert.equal(wrong.isError, true, "meta_get is NOT the AC-record tool");
  assert.match(wrong.content[0].text, /no such META/);

  const right = await core.callTool({ name: "goal_get", arguments: { id: "AC-901" } });
  assert.ok(!right.isError, "goal_get IS the AC-record tool the prompt names");
  assert.equal(right.structuredContent.goal.id, "AC-901");
});
