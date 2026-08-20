// @test-group product
// gap-web-board-needs-an-inconsistency-verdict-it-does-not-have — /board must join 意图
// (task store) + 执行 (telemetry) + 落地 (git code existence), and its LANDING flags must agree
// PER-TASK with plugin/scripts/task-status-drift-check.ts (AC2, the Contract's band). The
// architecture decision (AC1) is REUSE: the board's landing column consumes the drift checker's
// own `--json` output via observation.readBoardLanding, so agreement holds by construction — the
// test below proves it end-to-end against the real checker CLI, plus the AC3 negative control
// (a done task whose Touches point at nonexistent code is flagged by BOTH, same kind; fixing the
// touch unflags both) and the AC5/AC6 degradation contract (three visible data sources; a missing
// source still returns 200, never a 500).
//
// Run (scoped): node --test packages/quay/test/serve-board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { readBoardExecution, runProcessAliveSync } from "../src/observation.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const DRIFT_CHECKER = path.join(__dirname, "..", "..", "..", "plugin", "scripts", "task-status-drift-check.ts");

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

/** Run the real drift checker CLI against a workspace root, return { suspects, reverse, scanned }. */
function runChecker(wsRoot) {
  const out = execFileSync("node", ["--experimental-strip-types", DRIFT_CHECKER, "--json"], {
    cwd: wsRoot, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(out);
  return {
    suspects: (parsed.suspects ?? []).map((s) => s.taskId),
    reverse: (parsed.reverse ?? []).map((s) => s.taskId),
    scanned: parsed.scanned ?? 0,
  };
}

/**
 * Build a workspace whose tasks live at `<ws>/tasks` (workspace-relative, so the drift checker's
 * default tasksDir = `<repoRoot>/tasks` matches the provider's tasks_dir — the Contract's
 * invariant). git-inits the ws so findRepoRoot resolves. Returns { ws, tasksDir }.
 */
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
  fs.writeFileSync(path.join(ws, "README.md"), "board fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "board fixture"], { cwd: ws });
  return { ws, tasksDir };
}

function seed(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

const BD_BODY = (symbol, touches) =>
  `## Proposal\nA sufficiently long proposal section for the board fixture task ${symbol}.\n` +
  `## Plan\nA sufficiently long plan section for the board fixture task.\n` +
  `## Acceptance Criteria\n- [ ] \`${symbol}\` implemented and verified\n` +
  `## Definition of Done\n- [x] acceptance gate passes\n` +
  `## Touches\n- ${touches}\n`;

/**
 * gap-in-flight-liveness-worktree-proxy-not-process: spawn a detached keep-alive process whose
 * cmdline carries the runId's distinctive tail, so the /proc liveness probe sees the run as ALIVE.
 * Returns the ChildProcess (caller must SIGKILL it in finally). runId must end in a distinctive
 * `<ts>-<rand>` tail (never a bare "1-1") so the probe's needle cannot match unrelated processes.
 */
function spawnLiveRun(runId) {
  const p = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)", runId], { detached: true, stdio: "ignore" });
  p.unref();
  return p;
}

/** Poll runProcessAliveSync until the spawned process shows up in /proc (bounded). */
async function waitForLiveProcess(runId) {
  for (let i = 0; i < 50; i++) {
    if (runProcessAliveSync(runId) === true) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`test fixture: live process for ${runId} never became visible in /proc`);
}

/** A distinctive runId tail for fixtures — never a generic "1-1" that could match stray processes. */
function distinctiveRunId(taskId) {
  return `fm-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("AC2: /board data-flag agrees with the drift checker per-task (reuse by construction)", async () => {
  const { ws, tasksDir } = makeWorkspace("board-ac2-");
  const cwd0 = process.cwd();
  let server;
  try {
    // BD-1: done, Touches → a code-root file that does NOT exist, AC symbol that does NOT resolve
    //       → reverse-drift-suspect → data-flag="done-unlanded"
    seed(tasksDir, "BD-1", { title: "Done but unlanded", status: "done", body: BD_BODY("bdNeverSymbol", "packages/quay/src/never-exists.ts") });
    // BD-2: todo, Touches → an EXISTING code-root file, AC symbol that RESOLVES
    //       → status-drift-suspect → data-flag="landed-not-closed"
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol.ts"), "export const bdExistsSymbol = 1;\n");
    seed(tasksDir, "BD-2", { title: "Landed but not closed", status: "todo", body: BD_BODY("bdExistsSymbol", "packages/quay/src/board-symbol.ts") });
    // BD-3: ready, no distinctive symbols → clean (no flag)
    seed(tasksDir, "BD-3", { title: "Clean task", status: "ready", body: BD_BODY("cleanWord", "packages/quay/src/board-symbol.ts") });

    const checker = runChecker(ws);
    assert.ok(checker.reverse.includes("BD-1"), `AC2: checker reverse contains BD-1 (got ${JSON.stringify(checker.reverse)})`);
    assert.ok(checker.suspects.includes("BD-2"), `AC2: checker suspects contains BD-2 (got ${JSON.stringify(checker.suspects)})`);
    assert.ok(!checker.suspects.includes("BD-3") && !checker.reverse.includes("BD-3"), "AC2: checker flags neither for BD-3");
    assert.equal(checker.scanned, 3, `AC2: checker scanned the 3 fixture tasks (got ${checker.scanned})`);

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const board = await get(port, "/board");
    assert.equal(board.status, 200, "AC2: GET /board returns 200");
    assert.ok(board.body.includes("data-flag=\"done-unlanded\""), "AC2: board marks a done-unlanded task");
    assert.ok(board.body.includes("data-flag=\"landed-not-closed\""), "AC2: board marks a landed-not-closed task");
    assert.ok(board.body.includes("BD-1") && board.body.includes("BD-2") && board.body.includes("BD-3"),
      "AC2: board renders all three fixture tasks");

    // Per-task agreement: the count of data-flag attributes equals suspects+reverse length, and
    // each flagged task carries exactly the checker's classification.
    const flagCount = (board.body.match(/data-flag="/g) || []).length;
    assert.equal(flagCount, checker.suspects.length + checker.reverse.length,
      `AC2: board data-flag count (${flagCount}) == suspects+reverse (${checker.suspects.length + checker.reverse.length})`);
    for (const tid of checker.reverse) {
      const row = board.body.split("</tr>").find((r) => r.includes(`>${tid}<`));
      assert.ok(row && /data-flag="done-unlanded"/.test(row), `AC2: ${tid} row carries data-flag="done-unlanded"`);
    }
    for (const tid of checker.suspects) {
      const row = board.body.split("</tr>").find((r) => r.includes(`>${tid}<`));
      assert.ok(row && /data-flag="landed-not-closed"/.test(row), `AC2: ${tid} row carries data-flag="landed-not-closed"`);
    }
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3 negative control: done task with Touches→nonexistent code is flagged by BOTH (same kind); fixing the touch unflags BOTH", async () => {
  const { ws, tasksDir } = makeWorkspace("board-ac3-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "NC-1", { title: "Negative control", status: "done", body: BD_BODY("ncNeverSymbol", "packages/quay/src/never-created.ts") });
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const board1 = await get(port, "/board");
    const checker1 = runChecker(ws);
    assert.ok(checker1.reverse.includes("NC-1"), `AC3: checker reverse flags NC-1 (got ${JSON.stringify(checker1.reverse)})`);
    assert.ok(board1.body.includes("data-flag=\"done-unlanded\"") && board1.body.includes("NC-1"),
      "AC3: board flags NC-1 as done-unlanded");

    // Fix the artificial condition: create the Touches code-root file → the code-root touch now
    // exists → no longer reverse-drift. BOTH sides must stop flagging.
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/never-created.ts"), "// now the touch exists\n");

    const board2 = await get(port, "/board");
    const checker2 = runChecker(ws);
    assert.ok(!checker2.reverse.includes("NC-1"), "AC3: checker stops flagging NC-1 after the touch exists");
    const ncRow2 = board2.body.split("</tr>").find((r) => r.includes(">NC-1<"));
    assert.ok(ncRow2 && !/data-flag="done-unlanded"/.test(ncRow2),
      "AC3: board stops flagging NC-1 after the touch exists");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5/AC6: three data sources visible; a missing source degrades to 200 (never 500)", async () => {
  // No git, no .workflow-events, no plugin-layer drift checker reachable → every observation
  // source must degrade and /board still return 200.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "board-ac6-"));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  seed(tasksDir, "DG-1", { title: "Degrade", status: "todo", body: BD_BODY("dgSymbol", "packages/quay/src/x.ts") });
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const board = await get(port, "/board");
    assert.equal(board.status, 200, "AC6: /board still 200 when observation sources are missing");
    assert.ok(board.body.includes("意图") && board.body.includes("执行") && board.body.includes("落地"),
      "AC5: three columns (意图/执行/落地) are rendered");
    assert.ok(board.body.includes("task-status-drift-check.ts") && board.body.includes(".workflow-events/"),
      "AC5: landing + execution data sources are named on the page");
    assert.ok(board.body.includes("读失败") || board.body.includes("无数据"),
      "AC5/AC6: a degraded column shows 读失败 or 无数据 (distinguishable), not a 500");
    assert.ok(board.body.includes("DG-1"), "AC6: the intent column still renders the provider's task");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC7/execution column: live run (process present) renders in-flight + timeout; process-dead run renders 孤儿 (not in-flight)", async () => {
  const { ws, tasksDir } = makeWorkspace("board-exec-");
  const cwd0 = process.cwd();
  let server;
  const procs = [];
  try {
    seed(tasksDir, "EX-1", { title: "Orphan", status: "todo", body: BD_BODY("exOrphanSymbol", "packages/quay/src/board-symbol-a.ts") });
    seed(tasksDir, "EX-2", { title: "In-flight", status: "todo", body: BD_BODY("exLiveSymbol", "packages/quay/src/board-symbol-b.ts") });
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol-a.ts"), "export const exOrphanSymbol = 1;\n");
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol-b.ts"), "export const exLiveSymbol = 1;\n");

    // EX-2: started 100 minutes ago, no end, WITH a live process carrying the runId → in-flight-timeout.
    const liveRunId = distinctiveRunId("EX-2");
    const liveProc = spawnLiveRun(liveRunId);
    procs.push(liveProc);
    await waitForLiveProcess(liveRunId);
    // EX-1: started 100 minutes ago, no end, NO live process → orphan, NOT in-flight-timeout.
    const orphanRunId = distinctiveRunId("EX-1");

    const eventsDir = path.join(ws, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    const startEvent = (runId, taskId, startedAtMs) =>
      JSON.stringify({ schemaVersion: "1", runId, candidateId: taskId, taskId, stage: "Fast", attempt: 0, eventKind: "start", timing: { queuedAtMs: null, startedAtMs, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:task-start", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: startedAtMs }) + "\n";
    const startedAt = Date.now() - 100 * 60_000;
    fs.writeFileSync(path.join(eventsDir, "fm-EX-1.jsonl"), startEvent(orphanRunId, "EX-1", startedAt));
    fs.writeFileSync(path.join(eventsDir, "fm-EX-2.jsonl"), startEvent(liveRunId, "EX-2", startedAt));

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const board = await get(port, "/board");
    assert.equal(board.status, 200, "AC7: /board 200 with telemetry present");
    // EX-2 (live process) is in-flight: renders 在飞 minutes + timeout flag.
    assert.ok(board.body.includes("在飞"), "AC7: execution column shows the in-flight marker for the live run");
    const ex2Row = board.body.split("</tr>").find((r) => r.includes(">EX-2<"));
    assert.ok(ex2Row && /data-exec-flag="[^"]*in-flight-timeout/.test(ex2Row),
      "AC7: EX-2 (live process) row carries data-exec-flag containing in-flight-timeout");
    assert.ok(ex2Row && ex2Row.includes("在飞 "), "AC7: EX-2 renders as 在飞 minutes");
    // EX-1 (no live process) is orphan: flagged orphan, NOT in-flight-timeout, NO 在飞 minutes.
    const ex1Row = board.body.split("</tr>").find((r) => r.includes(">EX-1<"));
    assert.ok(ex1Row && /data-exec-flag="[^"]*orphan/.test(ex1Row),
      "AC7: EX-1 (no live process) row carries data-exec-flag containing orphan");
    assert.ok(!ex1Row.includes("in-flight-timeout"), "AC7: an orphan is NOT flagged in-flight-timeout");
    assert.ok(!ex1Row.includes("在飞 "), "AC7: an orphan does NOT render as 在飞 minutes");
    // The exec summary counts ONLY the live in-flight run.
    assert.ok(board.body.includes("1 实现中"), "AC7: exec summary counts the single live in-flight run");
  } finally {
    for (const p of procs) { try { process.kill(p.pid, "SIGKILL"); } catch { /* already gone */ } }
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// gap-inflight-states-missing-impl-complete-event AC5 负控制 — /board's execution column splits
// the in-flight view into TWO independent counts: implementing (start, no impl-complete — 真正在
// 实现) vs awaiting-land (impl-complete, no end — 排队待落地). Build dispatch reads the former;
// the land single-flight gate reads the latter. A start+impl-complete+no-end task must NOT render
// as implementing — it renders as awaiting-land ("待落地"), and the two counts stay independent.
test("AC8/execution column: /board renders implementing vs awaiting-land as two independent counts (impl-complete boundary)", async () => {
  const { ws, tasksDir } = makeWorkspace("board-impl-");
  const cwd0 = process.cwd();
  let server;
  const procs = [];
  try {
    seed(tasksDir, "IM-1", { title: "Implementing", status: "todo", body: BD_BODY("imSymbol", "packages/quay/src/board-symbol-a.ts") });
    seed(tasksDir, "AL-1", { title: "Awaiting-land", status: "todo", body: BD_BODY("alSymbol", "packages/quay/src/board-symbol-b.ts") });
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol-a.ts"), "export const imSymbol = 1;\n");
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol-b.ts"), "export const alSymbol = 1;\n");

    const eventsDir = path.join(ws, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    const now = Date.now();
    const imRunId = distinctiveRunId("IM-1");
    const alRunId = distinctiveRunId("AL-1");
    // Both runs carry a LIVE process (gap-in-flight-liveness-worktree-proxy-not-process: without a
    // live process they'd be orphans, not in-flight — the impl-complete boundary test needs them
    // to stay in the in-flight display).
    procs.push(spawnLiveRun(imRunId));
    procs.push(spawnLiveRun(alRunId));
    await waitForLiveProcess(imRunId);
    await waitForLiveProcess(alRunId);
    const startEvent = (runId, taskId, startedAtMs) =>
      JSON.stringify({ schemaVersion: "1", runId, candidateId: taskId, taskId, stage: "Fast", attempt: 0, eventKind: "start", timing: { queuedAtMs: null, startedAtMs, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:task-start", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: startedAtMs }) + "\n";
    const implCompleteEvent = (runId, taskId, recordedAtMs) =>
      JSON.stringify({ schemaVersion: "1", runId, candidateId: taskId, taskId, stage: "Fast", attempt: 0, eventKind: "impl-complete", timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:impl-complete", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs }) + "\n";
    // IM-1: start only ⇒ implementing.
    fs.writeFileSync(path.join(eventsDir, "fm-IM-1.jsonl"), startEvent(imRunId, "IM-1", now - 10 * 60_000));
    // AL-1: start + impl-complete (no end) ⇒ awaiting-land.
    fs.writeFileSync(path.join(eventsDir, "fm-AL-1.jsonl"),
      startEvent(alRunId, "AL-1", now - 20 * 60_000) + implCompleteEvent(alRunId, "AL-1", now - 5 * 60_000));

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const board = await get(port, "/board");
    assert.equal(board.status, 200, "AC8: /board 200 with the two-segment telemetry present");
    // The two INDEPENDENT counts render (1 implementing + 1 awaiting-land), not a single "2 在飞".
    assert.ok(board.body.includes("1 实现中"), "AC8: the implementing count renders");
    assert.ok(board.body.includes("1 待落地"), "AC8: the awaiting-land count renders");
    // AL-1's row carries the 待落地 marker (impl-complete, no end); IM-1's row does NOT.
    const alRow = board.body.split("</tr>").find((r) => r.includes(">AL-1<"));
    const imRow = board.body.split("</tr>").find((r) => r.includes(">IM-1<"));
    assert.ok(alRow && alRow.includes("待落地"), "AC8: the awaiting-land task row shows 待落地");
    assert.ok(imRow && !imRow.includes("待落地"), "AC8: the implementing task row does NOT show 待落地");
    assert.ok(imRow && imRow.includes("在飞"), "AC8: the implementing task still shows the in-flight marker");
  } finally {
    for (const p of procs) { try { process.kill(p.pid, "SIGKILL"); } catch { /* already gone */ } }
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// gap-in-flight-liveness-worktree-proxy-not-process AC2/AC3 — negative control on the PRODUCTION
// carrier. A real task with 「worktree 存在 + status=ready + 无活进程」:
//   * display granularity (process-level liveness): readBoardExecution / /board classify it as
//     orphan — NOT in-flight (the worktree's existence is no longer treated as an in-flight signal);
//   * telemetry/reconcile granularity: --slot-status --json still classifies the bracket via its OWN
//     existing probe (processAlive / subagent transcript / branch-merged — the reconcile retention
//     criteria are UNCHANGED, AC3), and the worktree is still present.
// Two granularities coexist without mixing. NOTE: the task body's a8 snapshot showed --reconcile
// keeping brackets via `worktree-present`; that probe was RETIRED by
// gap-inflight-states-missing-impl-complete-event (a927d7e5) — the impl-complete event is now the
// state record. What survives is the PRINCIPLE AC2/AC3 pin: the display's process liveness is
// independent of reconcile's retention, and this change does not touch the latter.
test("AC2/AC3 negative control: worktree exists + status=ready + no live process ⇒ NOT in-flight (display), reconcile retention unchanged", async () => {
  const { ws, tasksDir } = makeWorkspace("board-neg-");
  const cwd0 = process.cwd();
  let server;
  let wtPath = null;
  try {
    seed(tasksDir, "LV-1", { title: "Worktree but no process", status: "ready", body: BD_BODY("lvSymbol", "packages/quay/src/board-symbol.ts") });
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol.ts"), "export const lvSymbol = 1;\n");

    // A REAL git worktree on task/LV-1 with an unmerged commit inside it → worktreeExists=true and
    // isBranchMerged=false (so reconcile's existing probe falls through to executor-gone, the
    // deterministic unchanged-verdict for a no-process bracket).
    wtPath = `${ws}-wt`;
    execFileSync("git", ["-C", ws, "worktree", "add", "-b", "task/LV-1", wtPath], { stdio: "ignore" });
    fs.writeFileSync(path.join(wtPath, "lv-impl.txt"), "implemented in the worktree\n");
    execFileSync("git", ["-C", wtPath, "-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", wtPath, "-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "impl"], { stdio: "ignore" });

    // Telemetry: LV-1 started, no end, runId with a distinctive tail, NO live process.
    const runId = distinctiveRunId("LV-1");
    const eventsDir = path.join(ws, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    const startedAt = Date.now() - 10 * 60_000;
    fs.writeFileSync(
      path.join(eventsDir, "fm-LV-1.jsonl"),
      JSON.stringify({ schemaVersion: "1", runId, candidateId: "LV-1", taskId: "LV-1", stage: "Fast", attempt: 0, eventKind: "start", timing: { queuedAtMs: null, startedAtMs: startedAt, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:task-start", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: startedAt }) + "\n"
    );

    // 1) Display granularity — process-level liveness says NON in-flight (orphan).
    const exec = await readBoardExecution(ws, { nowMs: Date.now() });
    assert.ok(!exec.inFlight.some((t) => t.taskId === "LV-1"),
      "AC2: worktree+ready+no-process task is NOT in the board's in-flight list");
    const lvFlags = exec.flags.get("LV-1");
    assert.ok(lvFlags && lvFlags.has("orphan"), "AC2: the task is flagged orphan (process observably gone)");
    assert.ok(!(lvFlags && lvFlags.has("in-flight-timeout")), "AC2: an orphan is not also in-flight-timeout");

    // 2) The process-liveness reading is effective against the REAL /board output.
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const board = await get(port, "/board");
    assert.equal(board.status, 200, "AC2: /board 200");
    const lvRow = board.body.split("</tr>").find((r) => r.includes(">LV-1<"));
    assert.ok(lvRow && /data-exec-flag="[^"]*orphan/.test(lvRow), "AC2: /board renders LV-1 as 孤儿");
    assert.ok(!lvRow.includes("在飞 "), "AC2: /board does NOT render LV-1 as in-flight minutes");
    assert.ok(board.body.includes("0 实现中"), "AC2: exec summary counts 0 implementing (orphan excluded from in-flight)");

    // 3) Telemetry/reconcile granularity — UNCHANGED (AC3): --slot-status still classifies the
    //    bracket via the existing executor-gone probe (stale/closed for a no-process, unmerged-branch
    //    run), exposes per-bracket process liveness, and the worktree is still present.
    const telemetryBin = path.join(__dirname, "..", "..", "..", "plugin", "scripts", "fast-mode-telemetry.ts");
    const slotOut = execFileSync("node", ["--experimental-strip-types", telemetryBin, "--slot-status", "--cap", "5", "--json", "--root", ws], { cwd: ws, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] });
    const slot = JSON.parse(slotOut);
    const lvBracket = [...(slot.closed ?? []), ...(slot.kept ?? [])].find((r) => r.taskId === "LV-1");
    assert.ok(lvBracket, "AC2: --slot-status still classifies the LV-1 bracket (reconcile probe unchanged)");
    assert.equal(lvBracket.reconcileReason, "no-observable-executor",
      "AC3: the existing probe's verdict is untouched (no new close condition added by this change)");
    const livenessRow = (slot.bracket_liveness ?? []).find((r) => r.taskId === "LV-1");
    assert.ok(livenessRow && livenessRow.process_alive === false,
      "AC2: --slot-status exposes process_alive=false for LV-1 (the DoD-named real output)");
    const wtList = execFileSync("git", ["-C", ws, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    assert.ok(wtList.includes("branch refs/heads/task/LV-1"),
      "AC2: the task worktree is still present (retention/presence granularity unchanged)");
  } finally {
    try { if (wtPath) execFileSync("git", ["-C", ws, "worktree", "remove", "--force", wtPath], { stdio: "ignore" }); } catch { /* already removed */ }
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
    try { if (wtPath) fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* already gone */ }
  }
});

test("gap-webui-board-no-pagination: /board supports server-side ?page=N pagination, ?status= and ?label= filtering, zero client JS", async () => {
  const { ws, tasksDir } = makeWorkspace("board-pg-");
  const cwd0 = process.cwd();
  let server;
  try {
    // 25 tasks (default page size is 20 → 2 pages): PGT-01..10 status=done label=gap,
    // PGT-11..20 status=ready label=webui, PGT-21..25 status=todo no label.
    for (let i = 1; i <= 25; i++) {
      const id = `PGT-${String(i).padStart(2, "0")}`;
      const status = i <= 10 ? "done" : i <= 20 ? "ready" : "todo";
      const labels = i <= 10 ? ["gap"] : i <= 20 ? ["webui"] : [];
      seed(tasksDir, id, { title: `Pagination fixture ${id}`, status, labels, body: BD_BODY(`pg${id}Sym`, "packages/quay/src/pg-never-exists.ts") });
    }

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const countRows = (body) => body.split("</tr>").filter((r) => r.includes(">PGT-")).length;

    // AC3: zero client JS — the board page carries no <script> element.
    const board = await get(port, "/board");
    assert.equal(board.status, 200, "AC1: GET /board returns 200");
    assert.ok(!/<script/i.test(board.body), "AC3: board output contains no client JS <script> tag");

    // AC1: default page 1 shows PGT-01..20, not PGT-21; page nav reports 2 pages / 25 rows.
    assert.ok(board.body.includes("Page 1 of 2 (25 rows)"), "AC1: board reports Page 1 of 2 (25 rows)");
    assert.ok(board.body.includes(">PGT-01<") && board.body.includes(">PGT-20<"), "AC1: page 1 shows PGT-01..PGT-20");
    assert.ok(!board.body.includes(">PGT-21<"), "AC1: page 1 does NOT show PGT-21");
    assert.equal(countRows(board.body), 20, "AC1: page 1 renders exactly 20 rows");

    // AC1: ?page=2 returns the remaining 5 rows.
    const page2 = await get(port, "/board?page=2");
    assert.equal(page2.status, 200, "AC1: GET /board?page=2 returns 200");
    assert.ok(page2.body.includes("Page 2 of 2 (25 rows)"), "AC1: board reports Page 2 of 2");
    assert.ok(page2.body.includes(">PGT-21<") && page2.body.includes(">PGT-25<"), "AC1: page 2 shows PGT-21..PGT-25");
    assert.ok(!page2.body.includes(">PGT-20<"), "AC1: page 2 does NOT show PGT-20");
    assert.equal(countRows(page2.body), 5, "AC1: page 2 renders exactly 5 rows");

    // AC1: an out-of-range page clamps to the last page — 200, never a 500.
    const overflow = await get(port, "/board?page=999");
    assert.equal(overflow.status, 200, "AC1: out-of-range page clamps (200, not 500)");
    assert.ok(overflow.body.includes("Page 2 of 2 (25 rows)"), "AC1: out-of-range page clamps to page 2");

    // AC2: ?status=done filters to the 10 done rows only.
    const statusFiltered = await get(port, "/board?status=done");
    assert.equal(statusFiltered.status, 200, "AC2: GET /board?status=done returns 200");
    assert.ok(statusFiltered.body.includes(">PGT-01<") && statusFiltered.body.includes(">PGT-10<"), "AC2: status=done shows done rows");
    assert.ok(!statusFiltered.body.includes(">PGT-11<"), "AC2: status=done excludes ready rows");
    assert.ok(!statusFiltered.body.includes(">PGT-21<"), "AC2: status=done excludes todo rows");
    assert.equal(countRows(statusFiltered.body), 10, "AC2: status=done renders exactly 10 rows");

    // AC2: ?label=gap filters to tasks carrying the gap label.
    const labelFiltered = await get(port, "/board?label=gap");
    assert.equal(labelFiltered.status, 200, "AC2: GET /board?label=gap returns 200");
    assert.ok(labelFiltered.body.includes(">PGT-01<") && labelFiltered.body.includes(">PGT-10<"), "AC2: label=gap shows labeled rows");
    assert.ok(!labelFiltered.body.includes(">PGT-11<"), "AC2: label=gap excludes webui-labeled rows");
    assert.equal(countRows(labelFiltered.body), 10, "AC2: label=gap renders exactly 10 rows");

    // AC2: AND-logic — status+label both present → 10; mismatch → 0 (200, not an error).
    const both = await get(port, "/board?status=done&label=gap");
    assert.equal(both.status, 200, "AC2: combined status+label filter returns 200");
    assert.equal(countRows(both.body), 10, "AC2: status=done&label=gap → 10 rows");
    const mismatch = await get(port, "/board?status=ready&label=gap");
    assert.equal(mismatch.status, 200, "AC2: empty-filter result is 200, not an error");
    assert.equal(countRows(mismatch.body), 0, "AC2: status=ready&label=gap → 0 rows (AND)");

    // AC1/AC2: pagination respects filters — the filtered set (10 ready rows) fits one page.
    const readyFiltered = await get(port, "/board?status=ready");
    assert.ok(readyFiltered.body.includes("Page 1 of 1 (10 rows)"), "AC2/AC1: filter result paginates correctly");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
