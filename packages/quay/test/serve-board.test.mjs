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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
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

test("AC7/execution column: /board renders the execution (telemetry) column with in-flight + timeout flags", async () => {
  const { ws, tasksDir } = makeWorkspace("board-exec-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "EX-1", { title: "In-flight", status: "todo", body: BD_BODY("exSymbol", "packages/quay/src/board-symbol.ts") });
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol.ts"), "export const exSymbol = 1;\n");
    // Telemetry: EX-1 started 100 minutes ago, no end → in-flight-timeout (90-min threshold).
    const eventsDir = path.join(ws, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "fm-EX-1.jsonl"),
      JSON.stringify({ schemaVersion: "1", runId: "fm-EX-1-1", candidateId: "EX-1", taskId: "EX-1", stage: "Fast", attempt: 0, eventKind: "start", timing: { queuedAtMs: null, startedAtMs: Date.now() - 100 * 60_000, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:task-start", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: Date.now() - 100 * 60_000 }) + "\n"
    );

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const board = await get(port, "/board");
    assert.equal(board.status, 200, "AC7: /board 200 with telemetry present");
    assert.ok(board.body.includes("在飞"), "AC7: execution column shows the in-flight marker");
    assert.ok(board.body.includes("EX-1"), "AC7: execution column renders the in-flight task id");
    const exRow = board.body.split("</tr>").find((r) => r.includes(">EX-1<"));
    assert.ok(exRow && /data-exec-flag="[^"]*in-flight-timeout/.test(exRow),
      "AC7: EX-1 row carries data-exec-flag containing in-flight-timeout");
  } finally {
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
  try {
    seed(tasksDir, "IM-1", { title: "Implementing", status: "todo", body: BD_BODY("imSymbol", "packages/quay/src/board-symbol-a.ts") });
    seed(tasksDir, "AL-1", { title: "Awaiting-land", status: "todo", body: BD_BODY("alSymbol", "packages/quay/src/board-symbol-b.ts") });
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol-a.ts"), "export const imSymbol = 1;\n");
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol-b.ts"), "export const alSymbol = 1;\n");

    const eventsDir = path.join(ws, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    const now = Date.now();
    // IM-1: start only ⇒ implementing.
    fs.writeFileSync(path.join(eventsDir, "fm-IM-1.jsonl"),
      JSON.stringify({ schemaVersion: "1", runId: "fm-IM-1-1", candidateId: "IM-1", taskId: "IM-1", stage: "Fast", attempt: 0, eventKind: "start", timing: { queuedAtMs: null, startedAtMs: now - 10 * 60_000, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:task-start", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: now - 10 * 60_000 }) + "\n");
    // AL-1: start + impl-complete (no end) ⇒ awaiting-land.
    fs.writeFileSync(path.join(eventsDir, "fm-AL-1.jsonl"),
      JSON.stringify({ schemaVersion: "1", runId: "fm-AL-1-1", candidateId: "AL-1", taskId: "AL-1", stage: "Fast", attempt: 0, eventKind: "start", timing: { queuedAtMs: null, startedAtMs: now - 20 * 60_000, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:task-start", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: now - 20 * 60_000 }) + "\n" +
      JSON.stringify({ schemaVersion: "1", runId: "fm-AL-1-1", candidateId: "AL-1", taskId: "AL-1", stage: "Fast", attempt: 0, eventKind: "impl-complete", timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null }, agentLabel: "fast-mode", commandIdentity: "fast-mode-telemetry:impl-complete", executionCwd: ws, worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: now - 5 * 60_000 }) + "\n");

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
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
