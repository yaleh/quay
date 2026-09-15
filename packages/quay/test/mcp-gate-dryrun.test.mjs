// @test-group product
// DIR-103-B: MCP `gate_run` dryRun — regression test for the `dryRun` boolean
// added to the `gate_run` tool (packages/quay/src/mcp-handlers.ts schema +
// handler, packages/quay/src/gate/engine.ts `RunGateArgs` + `runGate`).
//
// Drives the REAL `quay mcp` binary as a subprocess MCP server (same SDK usage
// as mcp-server.test.mjs), and asserts, against the real on-disk gate-event
// log (<workspaceRoot>/.quay/gate-events.jsonl, read via fs BEFORE and AFTER
// each dispatch):
//
//   - `dryRun: true`  executes the acceptance command via the shared
//                      runAcceptance() runner and returns { ok, reason, event },
//                      but appends ZERO new GateEvents and leaves the task's
//                      status unchanged.
//   - `dryRun: false` / omitted behaves exactly as today — one GateEvent is
//                      appended, status lifecycle untouched by gate_run itself.
//
// AC1 is the real RED/GREEN differentiator (GateEvent present-without / absent-
// with dryRun:true). AC2 (status unchanged) holds on the current codebase
// regardless of dryRun (gate_run never mutates status) — it is asserted as a
// safety invariant, not framed as RED-then-GREEN (Grounded fact #2).
//
// Coverage note (Grounded fact #3): the subprocess is torn down via
// `transport.close()` (stdin.end() → clean child exit), NEVER child.kill() — a
// SIGTERM/SIGKILL'd child contributes ZERO coverage, and engine.ts's
// `if (!dryRun) appendGateEvent` guard + the handler's `dryRun,` forward would
// never appear in `node --experimental-test-coverage` output.
//
// Run: node --experimental-test-coverage --test test/mcp-gate-dryrun.test.mjs

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const AC_DOD_CHECKED =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

function seedTask(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

async function connectStdio(command, args, cwd, env) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const client = new Client({ name: "dir-103-b-test", version: "0.0.1" });
  await client.connect(transport);
  return { client, transport };
}

// Read the gate-event log at `logPath` and return the entries whose
// pipeline_id === taskId (gate_log's own event shape, read from the same file
// the engine appends to).
function eventsForTask(logPath, taskId) {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
    .filter((e) => e.pipeline_id === taskId);
}

test("DIR-103-B MCP gate_run dryRun: executes the meter without recording a GateEvent", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-dryrun-ws-"));
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-dryrun-tasks-"));
  const gateLogPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");

  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir}"`,
      "",
    ].join("\n")
  );

  // Fixtures: distinct tasks per assertion group so per-task GateEvent counts
  // stay clean across the whole test.
  //   D103-DRY-PASS    dryRun:true  on a passing acceptance command
  //   D103-DRY-FAIL    dryRun:true  on a failing  acceptance command
  //   D103-NORM-PASS   dryRun omitted (the byte-identical-to-today path)
  //   D103-FALSE-PASS  dryRun:false explicit (the byte-identical-to-today path)
  seedTask(tasksDir, "D103-DRY-PASS", { title: "DIR-103-B dry-run pass", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: "true" } });
  seedTask(tasksDir, "D103-DRY-FAIL", { title: "DIR-103-B dry-run fail", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: "false" } });
  seedTask(tasksDir, "D103-NORM-PASS", { title: "DIR-103-B normal pass", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: "true" } });
  seedTask(tasksDir, "D103-FALSE-PASS", { title: "DIR-103-B explicit-false pass", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: "true" } });

  const { client, transport } = await connectStdio("node", [QUAY_CLI, "mcp"], workspaceRoot);
  // gap-release-run-tests-hangs-on-shared-mcp-client-leak (Requested action 4, hard rule 5b): the
  // same defect shape as mcp-server.test.mjs lived here — `const { client, transport } = await
  // connectStdio(…)` with no `finally`, so any throwing assertion skipped the teardown and left the
  // `quay mcp` child (plus its provider child) holding the event loop open: `node --test` would
  // never exit. This file has no live-network trigger (it is fully local), but the leak mechanism
  // is verbatim the same, so the close is unconditional here too.
  try {

  // ── AC1 + AC2: dryRun:true executes and appends ZERO GateEvents, status unchanged ──
  {
    const before = eventsForTask(gateLogPath, "D103-DRY-PASS").length;
    const r = await client.callTool({ name: "gate_run", arguments: { id: "D103-DRY-PASS", dryRun: true } });
    assert.ok(r.isError !== true, "gate_run dryRun:true on D103-DRY-PASS returns no error");
    assert.ok(r.structuredContent?.ok === true, `gate_run dryRun:true on D103-DRY-PASS executes the acceptance command and returns ok:true (got: ${JSON.stringify(r.structuredContent)})`);
    const after = eventsForTask(gateLogPath, "D103-DRY-PASS").length;
    assert.ok(before === after, `AC1: dryRun:true appends ZERO GateEvents for D103-DRY-PASS (before=${before}, after=${after})`);
    const t = await client.callTool({ name: "task_get", arguments: { id: "D103-DRY-PASS" } });
    assert.ok(t.structuredContent?.task?.status === "ready", `AC2: dryRun:true leaves D103-DRY-PASS status unchanged (ready) (got: ${JSON.stringify(t.structuredContent?.task?.status)})`);
  }

  // ── AC1 on the fail path: dryRun:true with a failing command, still zero events ──
  {
    const before = eventsForTask(gateLogPath, "D103-DRY-FAIL").length;
    const r = await client.callTool({ name: "gate_run", arguments: { id: "D103-DRY-FAIL", dryRun: true } });
    assert.ok(r.isError !== true, "gate_run dryRun:true on D103-DRY-FAIL (failing meter) is NOT isError");
    assert.ok(r.structuredContent?.ok === false, `gate_run dryRun:true on D103-DRY-FAIL returns ok:false (the command still ran) (got: ${JSON.stringify(r.structuredContent)})`);
    const after = eventsForTask(gateLogPath, "D103-DRY-FAIL").length;
    assert.ok(before === after, `AC1 (fail path): dryRun:true appends ZERO GateEvents for D103-DRY-FAIL (before=${before}, after=${after})`);
  }

  // ── AC3: dryRun omitted behaves byte-identically to today (GateEvent appended) ──
  {
    const before = eventsForTask(gateLogPath, "D103-NORM-PASS").length;
    const r = await client.callTool({ name: "gate_run", arguments: { id: "D103-NORM-PASS" } });
    assert.ok(r.isError !== true, "gate_run (dryRun omitted) on D103-NORM-PASS returns no error");
    assert.ok(r.structuredContent?.ok === true, "gate_run (dryRun omitted) on D103-NORM-PASS returns ok:true");
    const after = eventsForTask(gateLogPath, "D103-NORM-PASS").length;
    assert.ok(after === before + 1, `AC3 (omitted): a GateEvent IS appended for D103-NORM-PASS (before=${before}, after=${after})`);
  }

  // ── AC3: dryRun:false explicit behaves byte-identically to today ──
  {
    const before = eventsForTask(gateLogPath, "D103-FALSE-PASS").length;
    const r = await client.callTool({ name: "gate_run", arguments: { id: "D103-FALSE-PASS", dryRun: false } });
    assert.ok(r.isError !== true, "gate_run dryRun:false on D103-FALSE-PASS returns no error");
    assert.ok(r.structuredContent?.ok === true, "gate_run dryRun:false on D103-FALSE-PASS returns ok:true");
    const after = eventsForTask(gateLogPath, "D103-FALSE-PASS").length;
    assert.ok(after === before + 1, `AC3 (explicit false): a GateEvent IS appended for D103-FALSE-PASS (before=${before}, after=${after})`);
  }

  // Clean-exit teardown (Grounded fact #3): stdin.end() → quay mcp exits cleanly
  // → child-process coverage is merged. Never child.kill() here.
  } finally {
    await client.close();
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
