// @test-group product
// gap-webui-live-implcomplete-state-render — /live must render the impl-complete boundary
// (implCompletedAtMs null vs non-null) as two distinct states, and the dashboard liveCard must
// upgrade from a bare count line to a mini in-flight list with per-task state tags. The data is
// ALREADY present on InFlightTask (observation.ts pairInFlight); this is a pure render-layer task.
//
// Run (scoped): node --test packages/quay/test/serve-live-implcomplete.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** A git-initialized workspace with a valid .quay/config.yml and an empty tasks dir. */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "live-implcomplete fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}

/** A distinctive runId tail — never a generic "1-1" that could match stray processes. */
function distinctiveRunId(taskId) {
  return `fm-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Two-segment telemetry: IM-1 = start only (implementing, implCompletedAtMs null); AL-1 = start +
// impl-complete (awaiting-land, implCompletedAtMs non-null). AL-1's impl-complete is exactly 5 min
// before the observation instant, so its awaiting-land duration renders as "5m".
function writeFixture(ws) {
  const eventsDir = path.join(ws, ".workflow-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  const now = Date.now();
  const imRunId = distinctiveRunId("IM-1");
  const alRunId = distinctiveRunId("AL-1");
  const startEvent = (runId, taskId, startedAtMs) =>
    JSON.stringify({ schemaVersion: "1", runId, candidateId: taskId, taskId, stage: "Fast", attempt: 0, eventKind: "start", timing: { queuedAtMs: null, startedAtMs, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:task-start", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: startedAtMs }) + "\n";
  const implCompleteEvent = (runId, taskId, recordedAtMs) =>
    JSON.stringify({ schemaVersion: "1", runId, candidateId: taskId, taskId, stage: "Fast", attempt: 0, eventKind: "impl-complete", timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:impl-complete", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs }) + "\n";
  fs.writeFileSync(path.join(eventsDir, "fm-IM-1.jsonl"), startEvent(imRunId, "IM-1", now - 10 * 60_000));
  fs.writeFileSync(path.join(eventsDir, "fm-AL-1.jsonl"),
    startEvent(alRunId, "AL-1", now - 20 * 60_000) + implCompleteEvent(alRunId, "AL-1", now - 5 * 60_000));
}

test("AC1: /live table distinguishes 实现中 (implCompletedAtMs null) vs 已完工待落地 (non-null) with 待落地时长", async () => {
  const { ws } = makeWorkspace("live-impl-");
  const cwd0 = process.cwd();
  let server;
  try {
    writeFixture(ws);
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const live = await get(port, "/live");
    assert.equal(live.status, 200, "AC1: GET /live returns 200");
    // The two NEW columns render.
    assert.ok(live.body.includes("<th>状态</th>"), "AC1: /live table has a 状态 column");
    assert.ok(live.body.includes("<th>待落地时长</th>"), "AC1: /live table has a 待落地时长 column");

    const imRow = live.body.split("</tr>").find((r) => r.includes("IM-1"));
    const alRow = live.body.split("</tr>").find((r) => r.includes("AL-1"));
    assert.ok(imRow, "AC1: /live renders the implementing task row (IM-1)");
    assert.ok(alRow, "AC1: /live renders the awaiting-land task row (AL-1)");
    assert.ok(imRow.includes("实现中"), "AC1: the implementing task row shows 实现中");
    assert.ok(!imRow.includes("已完工待落地"), "AC1: the implementing task row does NOT show 已完工待落地");
    assert.ok(alRow.includes("已完工待落地"), "AC1: the awaiting-land task row shows 已完工待落地");
    assert.ok(!alRow.includes("实现中"), "AC1: the awaiting-land task row does NOT show 实现中");
    // The implementing task's 待落地时长 cell is a placeholder (no impl-complete ⇒ no duration).
    assert.ok(imRow.includes("—"), "AC1: the implementing task's 待落地时长 cell is a placeholder (—)");
    // The awaiting-land task's 待落地时长 is now − implCompletedAtMs = ~5 minutes → "5m".
    assert.ok(alRow.includes("5m"), "AC1: the awaiting-land task shows the 待落地时长 (~5m)");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: dashboard liveCard renders a mini in-flight list with state tags (not a bare count line)", async () => {
  const { ws } = makeWorkspace("dash-impl-");
  const cwd0 = process.cwd();
  let server;
  try {
    writeFixture(ws);
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const dash = await get(port, "/dashboard");
    assert.equal(dash.status, 200, "AC2: GET /dashboard returns 200");
    // The mini list links to the in-flight tasks and tags each with its state — "实现中" and
    // "待落地 <duration>" appear ONLY in the liveCard on the dashboard (the taskCard renders
    // status counts, not these impl-state labels).
    assert.ok(dash.body.includes('href="/task/IM-1"'), "AC2: liveCard mini list links to IM-1");
    assert.ok(dash.body.includes('href="/task/AL-1"'), "AC2: liveCard mini list links to AL-1");
    assert.ok(dash.body.includes("实现中"), "AC2: liveCard tags the implementing task 实现中");
    assert.ok(dash.body.includes("待落地 5m"), "AC2: liveCard tags the awaiting-land task with 待落地 5m");
    // The count line is still present (not removed), but the card is no longer ONLY that count.
    assert.ok(dash.body.includes("在飞 2"), "AC2: liveCard still shows the in-flight count");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
