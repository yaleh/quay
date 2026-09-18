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
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// `freePort()` DELETED — probe-then-bind is a TOCTOU over the shared ephemeral-port space, and its
// loopback probe did not even match startServer's 0.0.0.0 bind. Measured EADDRINUSE + the fix (bind
// port 0, read server.address().port) are recorded in packages/quay/test/serve-board.test.mjs.

// `headers` is optional and defaults to none, so every pre-existing call site is unchanged
// (gap-webui-dashboard-body-copy-en-zh added it: the dashboard's body copy is now
// language-dependent, so a test that asserts a particular language must be able to ASK for it).
function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
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
// before the observation instant, so its awaiting-land duration renders as "5m". Both tasks also get
// an on-disk lifecycle status (ready) so the two-axis 状态 column renders a real lifecycle value.
function writeFixture(ws) {
  const eventsDir = path.join(ws, ".workflow-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "IM-1.md"), "---\nid: IM-1\nstatus: ready\n---\nbody\n");
  fs.writeFileSync(path.join(tasksDir, "AL-1.md"), "---\nid: AL-1\nstatus: ready\n---\nbody\n");
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

test("AC1: /live table renders the two axes — 状态 (lifecycle) vs 阶段 (execution phase) — and 待落地时长 only for awaiting-land", async () => {
  const { ws } = makeWorkspace("live-impl-");
  const cwd0 = process.cwd();
  let server;
  try {
    writeFixture(ws);
    process.chdir(ws);
    // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // ⚠️ gap-webui-live-body-copy-en-zh: the /live BODY copy now resolves through serve-i18n.ts's
    // LIVE_LABELS and the DEFAULT language is `en` — so the original zh assertions below are made
    // against an EXPLICIT `Cookie: lang=zh` request (they keep their original meaning, now as the zh
    // regression guard) and the en arm is pinned right after them. A bare `/live` would render
    // English and these assertions would fail for the WRONG reason (see 决定记录 ④ in the task body).
    const live = await get(port, "/live", { Cookie: "lang=zh" });
    assert.equal(live.status, 200, "AC1: GET /live (zh) returns 200");
    // The two-axis columns render (状态 = lifecycle, 阶段 = execution phase).
    assert.ok(live.body.includes("<th>状态</th>"), "AC1: /live table has a 状态 column");
    assert.ok(live.body.includes("<th>阶段</th>"), "AC1: /live table has a 阶段 column");
    assert.ok(live.body.includes("<th>待落地时长</th>"), "AC1: /live table has a 待落地时长 column");

    const imRow = live.body.split("</tr>").find((r) => r.includes("IM-1"));
    const alRow = live.body.split("</tr>").find((r) => r.includes("AL-1"));
    assert.ok(imRow, "AC1: /live renders the implementing task row (IM-1)");
    assert.ok(alRow, "AC1: /live renders the awaiting-land task row (AL-1)");
    // 状态 column renders the lifecycle status (ready) for both — the two axes are no longer
    // crammed into one label (the old 「已完工待落地」 conflated an execution signal with lifecycle words).
    assert.ok(imRow.includes(">ready<"), "AC1: the 状态 column renders the lifecycle status (ready) for the implementing task");
    assert.ok(alRow.includes(">ready<"), "AC1: the 状态 column renders the lifecycle status (ready) for the awaiting-land task");
    // 阶段 column renders the execution phase: implementing vs awaiting-land.
    assert.ok(imRow.includes("实现中"), "AC1: the implementing task's 阶段 column shows 实现中");
    assert.ok(!imRow.includes("待落地"), "AC1: the implementing task's 阶段 column does NOT show 待落地");
    assert.ok(alRow.includes("待落地"), "AC1: the awaiting-land task's 阶段 column shows 待落地");
    assert.ok(!alRow.includes("实现中"), "AC1: the awaiting-land task's 阶段 column does NOT show 实现中");
    assert.ok(!live.body.includes("已完工待落地"), "AC1: the old conflated 已完工待落地 label is gone");
    // The implementing task's 待落地时长 cell is a placeholder (not awaiting-land ⇒ no duration).
    assert.ok(imRow.includes("—"), "AC1: the implementing task's 待落地时长 cell is a placeholder (—)");
    // The awaiting-land task's 待落地时长 is now − implCompletedAtMs = ~5 minutes → "5m".
    assert.ok(alRow.includes("5m"), "AC1: the awaiting-land task shows the 待落地时长 (~5m)");

    // …and the SAME table under the default language (the arm that would have been left unwatched).
    // The two-axis STRUCTURE is unchanged — only the words moved — so this arm re-asserts the
    // structure in English rather than only checking that Chinese is gone.
    const liveEn = await get(port, "/live");
    assert.equal(liveEn.status, 200, "AC1 (en): GET /live (the default) returns 200");
    assert.ok(liveEn.body.includes("<th>status</th>"), "AC1 (en): the 状态 column header is English");
    assert.ok(liveEn.body.includes("<th>phase</th>"), "AC1 (en): the 阶段 column header is English");
    assert.ok(liveEn.body.includes("<th>awaiting-land duration</th>"), "AC1 (en): the 待落地时长 column header is English");
    const imRowEn = liveEn.body.split("</tr>").find((r) => r.includes("IM-1"));
    const alRowEn = liveEn.body.split("</tr>").find((r) => r.includes("AL-1"));
    assert.ok(imRowEn && alRowEn, "AC1 (en): both task rows still render");
    assert.ok(imRowEn.includes("Implementing"), "AC1 (en): the implementing task's phase cell is English");
    assert.ok(alRowEn.includes("Awaiting land"), "AC1 (en): the awaiting-land task's phase cell is English");
    assert.ok(imRowEn.includes(" min<"), "AC1 (en): the elapsed cell carries the English minute unit");
    assert.ok(!liveEn.body.includes("实现中") && !liveEn.body.includes("待落地") && !liveEn.body.includes("分钟"),
      "AC1 (en): no zh body word leaks into the en table");
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
    process.chdir(ws);
    // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // ⚠️ gap-webui-dashboard-body-copy-en-zh: the liveCard's tag words now resolve through
    // serve-i18n.ts's DASHBOARD_LABELS and the DEFAULT language is `en` — so the original zh
    // assertions below are made against an EXPLICIT `Cookie: lang=zh` request (they keep their
    // original meaning as the zh regression guard) and the en arm is pinned right after them. A bare
    // `/dashboard` would now render English and these assertions would fail for the wrong reason.
    const dash = await get(port, "/dashboard", { Cookie: "lang=zh" });
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

    // …and the SAME card under the default language. Asserting only the zh arm would leave the
    // language every user actually gets unwatched.
    const dashEn = await get(port, "/dashboard");
    assert.equal(dashEn.status, 200, "AC2: GET /dashboard (en, the default) returns 200");
    assert.ok(dashEn.body.includes('href="/task/IM-1"'), "AC2 (en): mini list links to IM-1");
    assert.ok(dashEn.body.includes("Implementing"), "AC2 (en): liveCard tags the implementing task");
    assert.ok(dashEn.body.includes("Awaiting land 5m"), "AC2 (en): liveCard tags the awaiting-land task with its dwell time");
    assert.ok(dashEn.body.includes("In flight 2"), "AC2 (en): liveCard still shows the in-flight count");
    assert.ok(!dashEn.body.includes("实现中"), "AC2 (en): no zh tag word leaks into the en card");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
