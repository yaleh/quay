// @test-group product
// gap-live-cannot-tell-a-dead-loop-from-an-unwired-one — /live must NOT collapse the two
// telemetry-empty states into one generic 「无数据」. When telemetry is empty it must say
// 「在跑但未接遥测」(running-unwired) if ANY activity signal is present (recent commits / fresh
// tick-log mtime) and 「未在运行」(not-running) if NONE is — and it must explain WHICH signals
// decided it (the hard explainability requirement). The read-failure degradation stays a bare
// 「读失败」, distinct from both empty-state texts (AC4 — no regression).
//
// /live is a user-visible web contract ⇒ `product` group. New file ⇒ node:test.
//
// Run (scoped): node --test packages/quay/test/live-state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { readLive, decideLiveState } from "../src/observation.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const VALID_SECTIONS =
  "## Proposal\nproposal body for the live-state fixture task\n" +
  "## Plan\nplan body for the live-state fixture task\n" +
  "## AC\n- [x] an acceptance criterion line\n" +
  "## DoD\n- [x] a definition-of-done line\n";

// `freePort()` DELETED — probe-then-bind is a TOCTOU over the shared ephemeral-port space, and its
// loopback probe did not even match startServer's 0.0.0.0 bind. Measured EADDRINUSE + the fix (bind
// port 0, read server.address().port) are recorded in packages/quay/test/serve-board.test.mjs.

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** Build an isolated workspace (.quay/config.yml → a temp tasks dir) and seed one task. */
function makeWorkspace(prefix) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}tasks-`));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  createStore(tasksDir).write("LV-1", { title: "Live-state fixture", status: "todo", labels: [], body: VALID_SECTIONS });
  return { ws, tasksDir };
}

/** Start a serve server bound to `ws` (chdir is restored by the caller). */
/** ⛔ never probe-then-bind (see serve-board.test.mjs header): bind 0 and read the kernel's port back. */
async function startFor(ws) {
  process.chdir(ws);
  return startServer({ port: 0 });
}

test("decideLiveState pins the contract decision rule (any activity ⇒ running-unwired; none ⇒ not-running)", () => {
  assert.equal(decideLiveState({ recentCommits: 3, tickLogFresh: false, tickLogAgeMinutes: 61 }).state, "running-unwired");
  assert.equal(decideLiveState({ recentCommits: 0, tickLogFresh: true, tickLogAgeMinutes: 5 }).state, "running-unwired");
  assert.equal(decideLiveState({ recentCommits: 0, tickLogFresh: false, tickLogAgeMinutes: null }).state, "not-running");
  assert.equal(decideLiveState({ recentCommits: 0, tickLogFresh: false, tickLogAgeMinutes: 45 }).state, "not-running");
  const explained = decideLiveState({ recentCommits: 2, tickLogFresh: false, tickLogAgeMinutes: 61 });
  assert.ok(explained.explanation.includes("2 条提交"), "explanation names the present commit signal");
});

test("AC2 negative control: telemetry absent + activity present ⇒ /live says 「在跑但未接遥测」(running-unwired)", async () => {
  const wsObj = makeWorkspace("live-a-");
  const cwd0 = process.cwd();
  let server;
  try {
    // git-init + one RECENT commit + a freshly-written tick-log.md ⇒ both activity signals ON.
    execFileSync("git", ["init", "-q"], { cwd: wsObj.ws });
    fs.writeFileSync(path.join(wsObj.ws, "README.md"), "live-state workspace A\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: wsObj.ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "live activity commit"], { cwd: wsObj.ws });
    fs.mkdirSync(path.join(wsObj.ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(wsObj.ws, "orchestration", "tick-log.md"), "# tick\n| 时刻 | 动作 |\n|---|---|\n| now | fresh |\n");
    // NO .workflow-events/ — telemetry is empty.

    server = await startFor(wsObj.ws);
    const port = server.address().port;
    const live = await get(port, "/live");
    assert.equal(live.status, 200, "AC2: /live still 200");
    assert.ok(live.body.includes("在跑但未接遥测"), "AC2: page says 「在跑但未接遥测」");
    assert.ok(live.body.includes("live_state=running-unwired"), "AC2: machine key live_state=running-unwired present");
    assert.ok(live.body.includes("最近 30 分钟有 1 条提交"), "AC1: explanation names the commit signal");
    assert.ok(live.body.includes("tick 日志在"), "AC1: explanation names the tick-log signal");
    assert.ok(live.body.includes("--task-start"), "mechanism: next step points at --task-start/--task-end");
    assert.ok(!live.body.includes("未在运行"), "AC1: not-running text is NOT shown for the running-unwired state");

    // Unit-level pin on the same workspace.
    const unit = readLive(wsObj.ws, { nowMs: Date.now() });
    assert.equal(unit.liveState, "running-unwired");
    assert.equal(unit.status, "empty");
    assert.ok(unit.activity.recentCommits >= 1, "activity: recent commit counted");
    assert.equal(unit.activity.tickLogFresh, true, "activity: tick log fresh");
    assert.ok(unit.liveExplanation.includes("有活动信号"), "explanation is present and explains the decision");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(wsObj.tasksDir, { recursive: true, force: true });
    fs.rmSync(wsObj.ws, { recursive: true, force: true });
  }
});

test("AC3 negative control: telemetry absent + NO activity ⇒ /live says 「未在运行」(not-running)", async () => {
  const wsObj = makeWorkspace("live-b-"); // no git, no orchestration/, no .workflow-events/
  const cwd0 = process.cwd();
  let server;
  try {
    server = await startFor(wsObj.ws);
    const port = server.address().port;
    const live = await get(port, "/live");
    assert.equal(live.status, 200, "AC3: /live still 200");
    assert.ok(live.body.includes("未在运行"), "AC3: page says 「未在运行」");
    assert.ok(live.body.includes("live_state=not-running"), "AC3: machine key live_state=not-running present");
    assert.ok(live.body.includes("无任何活动信号"), "AC1: explanation states no activity signal is present");
    assert.ok(live.body.includes("会话/cron"), "mechanism: next step points at session/cron");
    assert.ok(!live.body.includes("在跑但未接遥测"), "AC1: running-unwired text is NOT shown for the not-running state");

    const unit = readLive(wsObj.ws, { nowMs: Date.now() });
    assert.equal(unit.liveState, "not-running");
    assert.equal(unit.status, "empty");
    assert.equal(unit.activity.recentCommits, 0, "activity: no recent commits");
    assert.equal(unit.activity.tickLogFresh, false, "activity: no tick log");
    assert.ok(unit.liveExplanation.includes("30 分钟内无提交"), "explanation names the absent commit signal");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(wsObj.tasksDir, { recursive: true, force: true });
    fs.rmSync(wsObj.ws, { recursive: true, force: true });
  }
});

test("positive + AC4 no-regression: telemetry present ⇒ running; unreadable store ⇒ 读失败 (still 200, distinct from both empty-state texts)", async () => {
  const wsObj = makeWorkspace("live-c-");
  const cwd0 = process.cwd();
  let server;
  try {
    const eventsDir = path.join(wsObj.ws, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "fm-LV.jsonl"),
      JSON.stringify({ stage: "Fast", runId: "fm-LV-1", taskId: "LV-1", eventKind: "start", timing: { startedAtMs: Date.now() - 60_000 } }) + "\n"
    );

    server = await startFor(wsObj.ws);
    const port = server.address().port;

    // Positive: telemetry records exist ⇒ live_state=running.
    const live = await get(port, "/live");
    assert.equal(live.status, 200, "positive: /live 200 with telemetry present");
    assert.ok(live.body.includes("live_state=running"), "positive: machine key live_state=running present");
    assert.ok(live.body.includes("上限"), "positive: running summary renders the cap label (上限), not the retired 并发数");
    assert.ok(!live.body.includes("在跑但未接遥测") && !live.body.includes("未在运行"),
      "positive: neither telemetry-empty state text appears when telemetry is present");

    // AC4: turn the store into a plain FILE so readdirSync fails ⇒ 读失败, still 200, and NOT
    // one of the empty-state texts (never masked).
    fs.rmSync(eventsDir, { recursive: true, force: true });
    fs.writeFileSync(eventsDir, "i am a file, not a directory\n");
    const err = await get(port, "/live");
    assert.equal(err.status, 200, "AC4: /live still 200 when the store is unreadable");
    assert.ok(err.body.includes("读失败"), "AC4: page says 「读失败」");
    assert.ok(!err.body.includes("在跑但未接遥测") && !err.body.includes("未在运行") && !err.body.includes("无数据"),
      "AC4: 「读失败」 is distinguishable from both empty-state texts and the retired generic 「无数据」");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(wsObj.tasksDir, { recursive: true, force: true });
    fs.rmSync(wsObj.ws, { recursive: true, force: true });
  }
});
