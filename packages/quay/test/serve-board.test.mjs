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
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  readBoardLanding,
  readBoardExecution,
  runProcessAliveSync,
  clearLandingCache,
  getLandingColdRunCount,
  LANDING_CACHE_TTL_MS,
  readTaskStatusAtRef,
  clearTaskStatusRefCache,
} from "../src/observation.ts";
import { renderBoardPage } from "../src/serve-handlers.ts";
import { handleBoard, BOARD_SNAPSHOT_DISABLED_ENV } from "../src/serve-board.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const DRIFT_CHECKER = path.join(__dirname, "..", "..", "..", "plugin", "scripts", "task-status-drift-check.ts");

// ⛔ `freePort()` (probe an ephemeral port on 127.0.0.1, CLOSE it, return the number) is DELETED from
// this file, together with the 9 call sites that fed its result to `startServer({ port })`.
//
// THE DEFECT (measured, CI run 35121096175, tokyo-alpha at suite concurrency 128):
//   `✖ AC7/execution column … Error: listen EADDRINUSE: address already in use 0.0.0.0:44203`
// Probe-then-bind is a two-step TOCTOU over a SHARED resource: the probe's socket is closed before
// it returns, so between the probe and the real `listen()` the port belongs to nobody — and at 128
// concurrent test files, several processes are running exactly this dance, so the same ephemeral
// port can be handed to two of them. (The probe also bound loopback while `startServer` binds
// 0.0.0.0, so it was not even asking about the same interface — that half is the `tailscaled`-class
// false negative recorded in `cli-test-serve-eaddrinuse-tailscaled-port-collision`.)
//
// THE FIX is not a retry or a bigger port range — it is to stop guessing: bind `port: 0` and read the
// port the KERNEL actually bound off the live handle. `startServer` resolves only after the
// 'listening' event (serve.ts#listenWeb), so `server.address().port` is authoritative and the socket
// is held continuously — the window is structurally zero. `port: 0` is the repo's own documented
// test convention for exactly this (`serve.ts`: "`--port 0` is the test convention for an ephemeral
// port").
//
// 硬规则 5b: the same defect lived in the sibling files that fed a probed port to an IN-PROCESS
// `startServer` (serve-handlers / gap-webui-tests-page-* / gap-dashboard-* / serve-live-implcomplete
// / serve-ac95-views / serve-tests-empty-state / live-state) — all fixed in the same commit. The
// residue is the files that hand the port to a SEPARATE PROCESS (`build-dist`, `plugin/test/
// start-drivers`), where port 0 cannot be read back in-process; that residue is recorded in the
// task's Finding rather than left implicit.

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** AC-292: the SAME GET, with request headers. The locale switch is exercised through
 *  `Cookie: lang=zh` — the exact header AC-292's criterion sends — rather than `?lang=`, because the
 *  cookie is the arm the criterion asserts on and it needs no redirect to take effect. */
function getWithHeaders(port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** The `<nav>…</nav>` region of a response, extracted the SAME way AC-292's criterion does it
 *  (`tr '\n' ' '` then a greedy `<nav.*</nav>`): from the first `<nav` to the last `</nav>`, which
 *  on this page spans the mobile menu AND the desktop site nav and nothing inside `<main>`.
 *  Reproducing the criterion's own extraction is the point — a test that narrowed the scope
 *  differently could pass while the criterion stayed red. */
function navRegion(body) {
  const m = body.replace(/\n/g, " ").match(/<nav.*<\/nav>/);
  return m ? m[0] : "";
}

/** The first `<title>…</title>` text, exactly as AC-292's `title_of` extracts it. */
function titleOf(body) {
  const m = body.replace(/\n/g, " ").match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : "";
}

/** The visible label of a nav current-item span, by its own class — the two places a page's nav
 *  label appears (`nav-item` desktop / `mobile-menu-item` mobile). Captured up to the first `<` so
 *  any trailing child element inside the span (formerly the `nav-badge` NEW span on /board, removed
 *  by gap-webui-remove-board-nav-new-badge) is not swallowed into the label. */
function currentItemLabels(body) {
  return {
    desktop: (body.match(/<span class="nav-item nav-current"[^>]*>([^<]*)/) || [])[1] ?? null,
    mobile: (body.match(/<span class="mobile-menu-item nav-current"[^>]*>([^<]*)/) || [])[1] ?? null,
  };
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
 * invariant). git-inits the ws so findRepoRoot resolves. Returns { ws, tasksDir, parent } — ws is
 * nested under a private parent so dirname(ws)/quay-worktrees stays test-private; callers
 * rmSync(parent), not ws (gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees).
 */
function makeWorkspace(prefix) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const ws = path.join(parent, "main");
  fs.mkdirSync(ws, { recursive: true });
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
  return { ws, tasksDir, parent };
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
  const { ws, tasksDir, parent } = makeWorkspace("board-ac2-");
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

    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;
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
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC3 negative control: done task with Touches→nonexistent code is flagged by BOTH (same kind); fixing the touch unflags BOTH", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-ac3-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "NC-1", { title: "Negative control", status: "done", body: BD_BODY("ncNeverSymbol", "packages/quay/src/never-created.ts") });
    // gap-ac292-criterion-cold-miss-30s-ttl-always-expired: this test drives the PRE-SNAPSHOT
    // in-request path — it mutates the fixture BETWEEN two requests and requires the second to
    // reflect the mutation. `/board` now serves a background-built snapshot, so the tick is switched
    // off here; that is exactly the fallback `clearLandingCache()` below was reaching for.
    process.env[BOARD_SNAPSHOT_DISABLED_ENV] = "1";
    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const board1 = await get(port, "/board");
    const checker1 = runChecker(ws);
    assert.ok(checker1.reverse.includes("NC-1"), `AC3: checker reverse flags NC-1 (got ${JSON.stringify(checker1.reverse)})`);
    assert.ok(board1.body.includes("data-flag=\"done-unlanded\"") && board1.body.includes("NC-1"),
      "AC3: board flags NC-1 as done-unlanded");

    // Fix the artificial condition: create the Touches code-root file → the code-root touch now
    // exists → no longer reverse-drift. BOTH sides must stop flagging.
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/never-created.ts"), "// now the touch exists\n");
    // gap-webui-board-load-120s: readBoardLanding is short-TTL-cached — the fixture changed between
    // the two requests, so drop the cache to force a fresh read (the display is a 30s snapshot).
    clearLandingCache();

    const board2 = await get(port, "/board");
    const checker2 = runChecker(ws);
    assert.ok(!checker2.reverse.includes("NC-1"), "AC3: checker stops flagging NC-1 after the touch exists");
    const ncRow2 = board2.body.split("</tr>").find((r) => r.includes(">NC-1<"));
    assert.ok(ncRow2 && !/data-flag="done-unlanded"/.test(ncRow2),
      "AC3: board stops flagging NC-1 after the touch exists");
  } finally {
    delete process.env[BOARD_SNAPSHOT_DISABLED_ENV];
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(parent, { recursive: true, force: true });
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
    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    // ⚠️ MIGRATED by gap-webui-board-body-copy-en-zh: `?lang=zh`. The default language is now `en`,
    // so the assertions below — which pin CHINESE literals — would be testing the other column.
    // Requesting zh leaves every assertion byte-identical AND makes this test a zh-output regression
    // guard (this task's AC3: zh must not move). The en side is covered by the new
    // serve-board-body-i18n.test.mjs. (Same migration rule as the pattern task's decision record ④.)
    const board = await get(port, "/board?lang=zh");
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
  const { ws, tasksDir, parent } = makeWorkspace("board-exec-");
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

    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const board = await get(port, "/board?lang=zh"); // migrated to explicit zh — see the note above
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
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// gap-inflight-states-missing-impl-complete-event AC5 负控制 — /board's execution column splits
// the in-flight view into TWO independent counts: implementing (start, no impl-complete — 真正在
// 实现) vs awaiting-land (impl-complete, no end — 排队待落地). Build dispatch reads the former;
// the land single-flight gate reads the latter. A start+impl-complete+no-end task must NOT render
// as implementing — it renders as awaiting-land ("待落地"), and the two counts stay independent.
test("AC8/execution column: /board renders implementing vs awaiting-land as two independent counts (impl-complete boundary)", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-impl-");
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

    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const board = await get(port, "/board?lang=zh"); // migrated to explicit zh — see the note above
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
    fs.rmSync(parent, { recursive: true, force: true });
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
  const { ws, tasksDir, parent } = makeWorkspace("board-neg-");
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
    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const board = await get(port, "/board?lang=zh"); // migrated to explicit zh — see the note above
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
    fs.rmSync(parent, { recursive: true, force: true });
    try { if (wtPath) fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* already gone */ }
  }
});

test("gap-webui-board-no-pagination: /board supports server-side ?page=N pagination, ?status= and ?label= filtering, zero client JS", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-pg-");
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

    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;

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
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── gap-webui-board-load-120s: /board cold-load ~120s → single-digit seconds ──────────────────────
// The landing judgment (readBoardLanding) cold-runs plugin/scripts/task-status-drift-check.ts, which
// on a large repo does a FULL git-log pass over the landing ref (>150s — the checker's own comment
// documents it). The fix: a short-TTL cache (LANDING_CACHE_TTL_MS, 30s — the same window as the
// slot-refill probe) so a cache hit never spawns the subprocess (AC2); a second-level subprocess
// timeout (LANDING_TIMEOUT_MS) so a slow/hung checker fails open (AC3); and a distinct 「读取超时」
// render. These three tests prove AC1 (cold load single-digit seconds), AC2 (negative control:
// cache hit ⇒ no cold subprocess, second request fast), and AC3 (timeout ⇒ 读取超时, fail-open).

test("AC1: /board cold load completes in single-digit seconds (TTL + 秒级 timeout + fail-open)", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-ac1-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "CL-1", { title: "Cold load", status: "todo", body: BD_BODY("clSymbol", "packages/quay/src/board-symbol.ts") });
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol.ts"), "export const clSymbol = 1;\n");
    assert.ok(LANDING_CACHE_TTL_MS > 0 && LANDING_CACHE_TTL_MS <= 60_000,
      `AC1: the landing TTL (${LANDING_CACHE_TTL_MS}ms) is a short bounded window`);
    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    clearLandingCache();
    const t0 = Date.now();
    const board = await get(port, "/board");
    const elapsed = Date.now() - t0;
    assert.equal(board.status, 200, "AC1: cold /board returns 200");
    assert.ok(board.body.includes("CL-1"), "AC1: the cold request still renders the task");
    // Single-digit seconds — vs the ~120s cold load the defect measured. The deterministic bound is
    // LANDING_TIMEOUT_MS (8s, pinned by the AC3 timeout test); this wall-clock assertion is the
    // real-output smoke bound against the fixture's fast checker.
    assert.ok(elapsed < 10_000, `AC1: cold /board load ${elapsed}ms is single-digit seconds`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC2 negative control: a cache-hit /board request does NOT cold-run the checker (second request fast)", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-cache-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "CC-1", { title: "Cache control", status: "todo", body: BD_BODY("ccSymbol", "packages/quay/src/board-symbol.ts") });
    fs.mkdirSync(path.join(ws, "packages/quay/src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "packages/quay/src/board-symbol.ts"), "export const ccSymbol = 1;\n");
    // gap-ac292-criterion-cold-miss-30s-ttl-always-expired: this test measures `readBoardLanding`'s
    // TTL cache THROUGH the HTTP path — it requires the first request to pay the subprocess and the
    // second not to. With the /board snapshot on, NEITHER request pays it, so the assertion below
    // would be measuring the snapshot instead. Switch the tick off to keep testing the pre-snapshot
    // in-request path deterministically (without this it is a race against the tick's first build).
    process.env[BOARD_SNAPSHOT_DISABLED_ENV] = "1";
    process.chdir(ws);
    // ⛔ NEVER probe-then-bind (see the header note): `startServer({ port: 0 })` binds ONCE and the
    // kernel-assigned port is read back from the live handle — there is no window for another test
    // process to be handed the same port.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    clearLandingCache();
    const before = getLandingColdRunCount();

    const t0 = Date.now();
    const board1 = await get(port, "/board");
    const coldElapsed = Date.now() - t0;
    const afterCold = getLandingColdRunCount();
    assert.equal(board1.status, 200, "AC2: cold request 200");
    assert.ok(afterCold > before, "AC2: the cold request spawns the checker subprocess");

    const t1 = Date.now();
    const board2 = await get(port, "/board");
    const warmElapsed = Date.now() - t1;
    assert.equal(board2.status, 200, "AC2: cache-hit request 200");
    assert.equal(getLandingColdRunCount(), afterCold,
      "AC2: the cache-hit request does NOT spawn the checker subprocess (counter flat)");
    assert.ok(warmElapsed < coldElapsed,
      `AC2: the cache-hit request (${warmElapsed}ms) is faster than the cold request (${coldElapsed}ms)`);
    assert.ok(board2.body.includes("CC-1"), "AC2: the cache-hit response still renders the task");
    assert.ok(board2.body.includes("task-status-drift-check.ts"), "AC2: the landing column still renders");
  } finally {
    delete process.env[BOARD_SNAPSHOT_DISABLED_ENV];
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC3 fail-open: a landing subprocess exceeding the second-level timeout renders 「读取超时」, not an empty wait", async () => {
  const { ws } = makeWorkspace("board-timeout-");
  const slowChecker = path.join(ws, "slow-checker.mjs");
  fs.writeFileSync(slowChecker,
    "// fake drift checker that hangs — the second-level timeout must kill it and fail open\n" +
    "await new Promise((r) => setTimeout(r, 60_000));\n" +
    "console.log(JSON.stringify({ suspects: [], reverse: [], scanned: 0 }));\n");

  // (a) The observation layer returns a timedOut reading promptly (well under the old 120s cap),
  //     and caches it — a second call within the TTL hits the cache (no re-spawn).
  const before = getLandingColdRunCount();
  const t0 = Date.now();
  const landing = await readBoardLanding(ws, { checkerPath: slowChecker, timeoutMs: 300 });
  const elapsed = Date.now() - t0;
  const afterTimeout = getLandingColdRunCount();
  assert.equal(landing.status, "error", "AC3: a timed-out landing is status error (fail-open, never throws)");
  assert.equal(landing.timedOut, true, "AC3: the timed-out landing carries timedOut:true");
  assert.ok(landing.reason.includes("fail-open"), `AC3: the reason describes the fail-open (got ${landing.reason})`);
  assert.ok(elapsed < 5_000, `AC3: the timeout returns in ~${elapsed}ms, not the old 120s cap`);
  assert.ok(afterTimeout > before, "AC3: the first call cold-runs the (hanging) checker");

  const landing2 = await readBoardLanding(ws, { checkerPath: slowChecker, timeoutMs: 300 });
  assert.equal(getLandingColdRunCount(), afterTimeout,
    "AC2/AC3: the cached timeout is served without re-spawning the checker");
  assert.equal(landing2.timedOut, true, "AC2/AC3: the cached reading is still the timeout");

  // (b) The render emits 「读取超时」 distinctly from a generic 读失败.
  // ⚠️ MIGRATED by gap-webui-board-body-copy-en-zh: `renderBoardPage`'s THIRD positional argument is
  // `lang` and defaults to `en` — so the two Chinese-literal assertions below must pass "zh"
  // explicitly, exactly as decision record ④ prescribes for direct render callers. Assertions
  // unchanged ⇒ this stays a zh-output regression guard; the en side is asserted in the new
  // serve-board-body-i18n.test.mjs.
  const page = renderBoardPage({
    landing: { status: "error", timedOut: true, reason: landing.reason, flags: new Map(), scanned: 0 },
    execution: { status: "empty", reason: null, flags: new Map(), inFlight: [] },
    intentStatus: "ok",
    intentReason: null,
    rows: [],
  }, null, "zh");
  assert.ok(page.includes("读取超时"), "AC3: the rendered page shows 读取超时");
  const okPage = renderBoardPage({
    landing: { status: "error", reason: "landing 判断源读失败：boom", flags: new Map(), scanned: 0 },
    execution: { status: "empty", reason: null, flags: new Map(), inFlight: [] },
    intentStatus: "ok",
    intentReason: null,
    rows: [],
  }, null, "zh");
  assert.ok(okPage.includes("读失败") && !okPage.includes("读取超时"),
    "AC3: a non-timeout failure renders 读失败, not 读取超时 (the two are distinguishable)");
});

// ── gap-web-task-status-reads-stale-main-checkout: the board's 意图 column must read the develop
// ref, not the stale manager working branch's disk (AC1). The board handler is driven directly with
// a mock Provider client returning the DISK view (stale ready); the develop override is the fix.

test("AC1 — /board 意图 column renders the develop status (done), not the stale disk status (ready)", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "board-stale-"));
  try {
    const tasksDir = path.join(ws, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const writeTask = (id, status) => fs.writeFileSync(path.join(tasksDir, `${id}.md`),
      `---\nid: ${id}\nstatus: ${status}\n---\n## Proposal\nproposal for ${id}\n`);
    git("init", "-b", "develop", "-q", ".");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeTask("gap-stale", "done");
    writeTask("gap-fresh", "ready");
    git("add", ".");
    git("commit", "-q", "-m", "develop: gap-stale done, gap-fresh ready");
    git("checkout", "-q", "-b", "manager-stale");
    writeTask("gap-stale", "ready"); // stale branch rewrites it back to ready
    git("add", ".");
    git("commit", "-q", "-m", "manager-stale: reset gap-stale to ready");

    // Falsifiability: develop=done, working tree=ready.
    assert.equal(readTaskStatusAtRef(ws, "develop", "gap-stale"), "done", "develop ref carries done");
    assert.match(fs.readFileSync(path.join(tasksDir, "gap-stale.md"), "utf8"), /^status:\s*ready/m, "working tree carries ready");

    clearTaskStatusRefCache();
    const client = {
      taskList: async () => ({
        tasks: [
          { id: "gap-stale", title: "stale", status: "ready", labels: [], parent: null, children: [], body: "x", extra: {} },
          { id: "gap-fresh", title: "fresh", status: "ready", labels: [], parent: null, children: [], body: "x", extra: {} },
        ],
        malformed: [],
      }),
    };
    let body = "";
    const res = { writeHead: () => {}, end: (chunk) => { body = chunk; } };
    const url = new URL("http://localhost/board");
    await handleBoard({}, res, url, client, { name: "test", id: "native" }, { workspaceRoot: ws });

    const cell = body.match(/gap-stale<\/a><\/td>\s*<td>([^<]*)/);
    assert.ok(cell, "gap-stale board row present");
    assert.equal(cell[1], "done", "AC1: /board 意图 column renders done (⛔ 仍 ready ⇒ 假)");
    const freshCell = body.match(/gap-fresh<\/a><\/td>\s*<td>([^<]*)/);
    assert.equal(freshCell?.[1], "ready", "AC2: gap-fresh (ready in both) renders ready unchanged");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC-292 (gap-ac292-board-page-zh-chrome-nav-current-and-own-title): /board's OWN chrome is
// wired to AC-288's locale switch — not just the shared nav bar. BEFORE this change the page read
// `handleBoard`'s `cfg.lang` and dropped it: `renderBoardPage` was called with `cfg.identity` only,
// so the page's `<html lang>`, its `<title>` and its `<h1>` were byte-identical under `lang=zh`.
//
// WHY THESE ASSERTIONS LOOK LIKE THE GOAL CRITERION: the criterion is a live HTTP probe, so a test
// that only called `renderBoardPage({...}, identity, "zh")` would prove the FUNCTION can produce zh
// while saying nothing about the RESPONSE — the exact "fixture-only" shape of 硬规则 4 推论三. These
// drive a real `startServer` over real HTTP and read the bytes off the wire, reusing the criterion's
// own `navRegion` / `titleOf` extraction, so a green here and a red criterion cannot coexist for
// extraction reasons.
//
// The en arm is a NEGATIVE CONTROL, not decoration: ② and ③ are "the zh value differs", and a bug
// that made the page render zh for EVERY request (e.g. `pageNameFor` ignoring its `lang` argument)
// would satisfy them while breaking every English reader. Only the en literals rule that out.
test("AC-292 — /board's own chrome switches under Cookie: lang=zh; en baseline unchanged", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-ac292-i18n-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "BD-ZH", { title: "Board i18n fixture", status: "ready", body: BD_BODY("bdZhSymbol", "packages/quay/src/board-symbol.ts") });
    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const en = await get(port, "/board");
    const zh = await getWithHeaders(port, "/board", { Cookie: "lang=zh" });
    assert.equal(en.status, 200, "AC-292: GET /board returns 200 (en)");
    assert.equal(zh.status, 200, "AC-292: GET /board returns 200 (zh)");

    // ── NEGATIVE CONTROL (first, so a broken en baseline is read as such rather than as a zh bug):
    // the default-locale response is exactly what this page rendered before the wiring.
    assert.ok(en.body.includes('<html lang="en"'), "control: en response is <html lang=\"en\"");
    assert.equal(currentItemLabels(en.body).desktop, "Board", "control: en desktop nav current item is Board");
    assert.equal(currentItemLabels(en.body).mobile, "Board", "control: en mobile nav current item is Board");
    assert.ok(navRegion(en.body).includes("Board"),
      "control: the en NAV REGION carries the literal Board — the same predicate ② reverses for zh");
    // ⚠️ MIGRATED by gap-webui-board-body-copy-en-zh: this control used to pin the en token
    // `Board — 三源 join 看板`, i.e. it asserted that the page's own English `<title>` still carried
    // a CHINESE subtitle — a control guarding the very defect the body-copy task removes. The token
    // is now English (`Board — three-source join`); the arm is unchanged in PURPOSE (the en title is
    // still a fixed, pinned string, not whatever the dictionary happens to return).
    assert.equal(titleOf(en.body).endsWith(" — Board — three-source join"), true,
      `control: en <title> carries this page's English token (got ${JSON.stringify(titleOf(en.body))})`);
    assert.ok(en.body.includes("<h1>Board — intent / execution / landing</h1>"), "control: en <h1> carries its English subtitle");

    // ── ① the document's own lang attribute (AC-288's mechanism reaching THIS page).
    assert.ok(zh.body.includes('<html lang="zh"'),
      "AC-292 ①: zh response is <html lang=\"zh\" — a page that dropped cfg.lang renders lang=\"en\" here");

    // ── ② BOTH nav current items — asserted separately (硬规则 3: enumerate, do not boolean-ify).
    const zhLabels = currentItemLabels(zh.body);
    assert.equal(zhLabels.desktop, "看板", `AC-292 ②a: desktop nav current item is the zh label (got ${JSON.stringify(zhLabels.desktop)})`);
    assert.equal(zhLabels.mobile, "看板", `AC-292 ②b: mobile nav current item is the zh label (got ${JSON.stringify(zhLabels.mobile)})`);
    assert.ok(!navRegion(zh.body).includes("Board"),
      "AC-292 ②: the zh NAV REGION no longer carries the literal Board");

    // ── ③ this page's OWN <title> (the arm that separates "the nav switched" from "THIS page
    //    switched" — the criterion's CAUSE=title-unchanged).
    const tEn = titleOf(en.body);
    const tZh = titleOf(zh.body);
    assert.notEqual(tZh, "", "AC-292 ③: the zh response HAS a <title> to compare (never blank)");
    assert.notEqual(tZh, tEn, `AC-292 ③: zh <title> differs from en (en=${JSON.stringify(tEn)} zh=${JSON.stringify(tZh)})`);
    assert.ok(tZh.includes("看板") && !tZh.includes("Board"),
      `AC-292 ③: the zh <title> is translated, not merely different (got ${JSON.stringify(tZh)})`);

    // ── the page's <h1> is chrome too (the criterion does not read it; the wiring covers it).
    assert.ok(zh.body.includes("<h1>看板 — 意图 / 执行 / 落地</h1>"),
      "AC-292: the page <h1> uses its own zh token — pageNameFor, not the shared NAV_LABELS lookup");
  } finally {
    process.chdir(cwd0);
    // ⛔ NOT `await new Promise((r) => server.close(r))`. `startServer` spawns the provider as a
    // child MCP subprocess and hands it back on `server.client`; closing only the HTTP listener
    // leaves that child alive, so the test's event loop has an open handle and node:test never
    // exits — the file hangs instead of failing. Every other live-server test in this file tears
    // down with this exact pair for this reason.
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// AC-292's second arm is a LIVE probe; the dictionary half is a pure function and is pinned
// DIRECTLY, so a future edit that renames the token at the call site (`serve-board.ts`) without
// renaming the PAGE_LABELS key fails HERE, with the reason, instead of silently degrading the live
// page back to an English <title> (which the criterion would then report as `title-unchanged`).
test("AC-292 — the PAGE_LABELS tokens serve-board.ts passes to pageTitle/pageNameFor resolve in zh", async () => {
  const { pageNameFor } = await import("../src/serve-i18n.ts");
  // The FULL token `pageTitle` receives (em dash + subtitle included) — ROW 3's key shape.
  // ⚠️ MIGRATED by gap-webui-board-body-copy-en-zh: the token itself is now ENGLISH. Only the TOKEN
  // moved; AC-292's four arms are unchanged, because `pageNameFor`'s en column is the identity for
  // every token (ROW 3) — so the zh value stays byte-identical and the en value is whatever the call
  // site passes, i.e. the two arms below (zh ≠ en, zh carries no ASCII "Board") hold either way.
  assert.equal(pageNameFor("Board — three-source join", "zh"), "看板 — 三源 join 看板",
    "AC-292: the whole <title> token is registered (a `Board`-only key misses it ⇒ title-unchanged)");
  assert.equal(pageNameFor("Board", "zh"), "看板", "AC-292: the <h1> token is registered");
  // `en` is the identity for EVERY token (ROW 3) — this is what keeps the en baseline byte-identical.
  assert.equal(pageNameFor("Board — three-source join", "en"), "Board — three-source join", "AC-292: en is the identity");
  assert.equal(pageNameFor("Board", "en"), "Board", "AC-292: en is the identity");
  // The gate-gameability guard the criterion's second arm exists for: a zh value that merely LOOKS
  // translated while still carrying the English literal would satisfy "non-empty" and stay red live.
  assert.ok(!pageNameFor("Board — three-source join", "zh").includes("Board"), "AC-292: zh <title> token carries no ASCII Board");
  assert.ok(!pageNameFor("Board", "zh").includes("Board"), "AC-292: zh <h1> token carries no ASCII Board");
});

// ── gap-task-status-drift-check-serve-labels-no-rel-accessor ───────────────────────────────────────
// The landing column used to name the drift checker FOUR times as a product-layer literal (the four
// `<code>` below) and SIX more in serve-i18n.ts's three `srcLanding*` rows, while a THIRD spelling in
// observation.ts decided what was actually spawned — three independent naming points for one entity.
// Now there is one (observation.TASK_STATUS_DRIFT_CHECK_REL) and every surface derives it.
//
// ⛔ These tests are ADDITIVE BY REQUIREMENT (the task's AC4 counts deletion lines in this file):
// every symbol they need beyond what the file already imports comes through a dynamic import, exactly
// as the AC-292 test above does for `pageNameFor`. No existing line may be edited to add an import.
//
// On falsifiability, stated plainly: a hardcoded literal that happens to EQUAL the constant today
// would satisfy the two rendering assertions below (they compare rendered text to the constant, and
// the values coincide). What those two do prove is that a future rename of the rel PROPAGATES to the
// rendered page instead of silently leaving the label behind — and the third test is the one that
// makes a second literal impossible to introduce: it reads the two product sources and requires ZERO
// occurrences of the basename, with a known-hit control so a zero cannot mean "predicate never fires".
// The live propagation proof (change the rel ⇒ the real HTTP response follows) is AC3/DoD evidence,
// not a unit test: no test can mutate a module constant and observe a re-render in the same process.
test("AC3/AC4 — the landing <code> renders the DERIVED name in all four landing states (ok/empty/timeout/failed)", async () => {
  const { TASK_STATUS_DRIFT_CHECK_NAME, TASK_STATUS_DRIFT_CHECK_REL, scriptBasename } =
    await import("../src/observation.ts");
  // The derivation is the identity the renderer consumes — asserted here so a page that happened to
  // agree with a stale literal would still be caught by the value check below.
  assert.equal(TASK_STATUS_DRIFT_CHECK_NAME, scriptBasename(TASK_STATUS_DRIFT_CHECK_REL));

  // All four states the landing column can render. Only "empty" is reachable over HTTP in this
  // fixture (it needs the checker script to be absent); the other three need a real subprocess that
  // succeeds/hangs/dies, so they are driven through the same `renderBoardPage` the handler calls.
  const states = [
    { label: "ok", landing: { status: "ok", reason: null, flags: new Map(), scanned: 3 } },
    { label: "empty", landing: { status: "empty", reason: "landing 判断源缺失", flags: new Map(), scanned: 0 } },
    { label: "timedOut", landing: { status: "error", timedOut: true, reason: "boom", flags: new Map(), scanned: 0 } },
    { label: "failed", landing: { status: "error", reason: "boom", flags: new Map(), scanned: 0 } },
  ];
  const code = `<code>${TASK_STATUS_DRIFT_CHECK_NAME}</code>`;
  for (const { label, landing } of states) {
    const page = renderBoardPage({
      landing,
      execution: { status: "empty", reason: null, flags: new Map(), inFlight: [] },
      intentStatus: "ok",
      intentReason: null,
      rows: [],
    }, null, "zh");
    assert.ok(page.includes(code),
      `${label}: the landing <code> names the checker through the derived constant (${code})`);
    assert.ok(page.includes(TASK_STATUS_DRIFT_CHECK_NAME),
      `${label}: …and the name renders at all (not silently dropped)`);
  }
  // The four states are actually four `else if` arms, so assert they are distinguishable — otherwise
  // the loop above could be exercising one arm four times and call it four.
  const distinct = new Set(states.map(({ landing }) => renderBoardPage({
    landing,
    execution: { status: "empty", reason: null, flags: new Map(), inFlight: [] },
    intentStatus: "ok",
    intentReason: null,
    rows: [],
  }, null, "zh")));
  assert.equal(distinct.size, 4, "the four landing states render four DIFFERENT pages");
});

test("AC2 — the three srcLanding* rows carry a {source} SLOT, not a second literal", async () => {
  const { boardLabel } = await import("../src/serve-i18n.ts");
  const { TASK_STATUS_DRIFT_CHECK_NAME } = await import("../src/observation.ts");
  for (const key of ["srcLandingTimeout", "srcLandingUnavailable", "srcLandingFailed"]) {
    for (const lang of ["en", "zh"]) {
      // ⛔ THE DISCRIMINATOR: an unfilled call must THROW. A row that spells the basename as a
      // literal returns its text happily here (no placeholder to leave unfilled) — so "it throws"
      // is exactly the difference between 「一个 {source} 槽」 and 「一份恰好相等的第二份字面量」.
      assert.throws(() => boardLabel(key, lang, {}), /\{source\}/,
        `${key}/${lang}: the row is a {source} placeholder (a literal would NOT throw — that is the point)`);
      // …and filling it with the derived constant is what the production call site does.
      assert.ok(boardLabel(key, lang, { source: TASK_STATUS_DRIFT_CHECK_NAME }).includes(TASK_STATUS_DRIFT_CHECK_NAME),
        `${key}/${lang}: the filled text names the source the caller supplied`);
      assert.ok(!boardLabel(key, lang, { source: TASK_STATUS_DRIFT_CHECK_NAME }).includes("{"),
        `${key}/${lang}: no placeholder survives into the rendered text`);
    }
  }
});

test("AC1 — no product-layer source names the checker a second time (source scan, with a known-hit control)", async () => {
  const { TASK_STATUS_DRIFT_CHECK_NAME } = await import("../src/observation.ts");
  const occurrenceLines = (file) => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
    return src.split("\n").map((line, i) => [i + 1, line]).filter(([, line]) => line.includes(TASK_STATUS_DRIFT_CHECK_NAME));
  };
  for (const file of ["serve-board.ts", "serve-i18n.ts"]) {
    const hits = occurrenceLines(file);
    assert.equal(hits.length, 0,
      `${file} must not name the checker (a second naming point reopens the defect): ` +
      JSON.stringify(hits.slice(0, 3).map(([n, l]) => `${n}: ${l.trim().slice(0, 90)}`)));
  }
  // 硬规则 2's other half — a zero count is only evidence if the predicate fires on a known-true
  // sample. observation.ts is the ONE remaining naming point, so the same predicate must find it.
  const control = occurrenceLines("observation.ts");
  assert.equal(control.length, 1,
    `control: the predicate DOES fire on the one legitimate naming point (found ${control.length}: ` +
    JSON.stringify(control.slice(0, 3).map(([n, l]) => `${n}: ${l.trim().slice(0, 90)}`)));
  assert.ok(control[0][1].includes("TASK_STATUS_DRIFT_CHECK_REL"),
    "control: …and it is the REL constant's own definition, not some other line");
});
