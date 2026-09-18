// @test-group product
// gap-webui-board-transient-columns-drowned-by-history — /board's 「执行」 (.workflow-events/) and
// 「落地」 (task-status-drift-check.ts) columns are TRANSIENT signals: a row is non-empty only while
// its task is in flight, awaiting fan-in, or carrying a drift flag. Spread across the whole store
// (production: 2248 rows, 2171 done, mostly 57+ days idle) the DEFAULT view is near-necessarily a
// wall of 「—」 (measured: page 1 of 113, every row 「—」, while the page's own counters said
// 「0 实现中 · 0 待落地」). The fix is not new join logic — it is the default PRESENTATION: show only
// the rows where either transient column is non-empty, keep the full store one click away.
//
// THE FOUR STATES THIS FILE PINS (硬规则 3b — the un-evaluated state needs its OWN value, never a
// value shaped like the passing one):
//   applied + 0 rows      → explicit empty state (NOT an empty table / dash wall)          [AC1]
//   applied + ≥1 row      → ONLY that row; the clean history rows do not render           [AC1/AC3]
//   off-source-incomplete → a source did not read ⇒ show ALL rows + say so (an unread source
//                           is not evidence of absence — 硬规则 5; «无法判定» must never be
//                           rendered as «没有»)                                            [AC1 guard]
//   explicit filter / ?all=1 → the manual status/label filters and the way back to the full
//                           store both survive                                        [AC2]
//
// Run (scoped): node --experimental-strip-types --test packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { runProcessAliveSync, clearLandingCache } from "../src/observation.ts";
import { renderBoardPage } from "../src/serve-handlers.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** Same shape as the sibling board tests: a real workspace (git-inited so findRepoRoot resolves)
 *  with the native provider enabled, under a private parent so cleanup never touches shared dirs. */
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
  fs.writeFileSync(path.join(ws, "README.md"), "board transient-view fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "board fixture"], { cwd: ws });
  return { ws, tasksDir, parent };
}

function seed(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

/** A task body whose Touches point at a file that does NOT exist and whose AC symbol does NOT
 *  resolve ⇒ the drift checker flags it in NEITHER direction (suspects need touchesAllExist ∧ a
 *  symbol ratio floor; reverse needs a done task) — i.e. a pure history row, the 2242 cases. */
const CLEAN_BODY = (symbol) =>
  `## Proposal\nA sufficiently long proposal section for the clean history fixture ${symbol}.\n` +
  `## Plan\nA sufficiently long plan section for the clean history fixture task.\n` +
  `## Acceptance Criteria\n- [ ] \`${symbol}\` implemented and verified\n` +
  `## Definition of Done\n- [x] acceptance gate passes\n` +
  `## Touches\n- packages/quay/src/bq-never-exists-${symbol}.ts\n`;

/**
 * A telemetry record. `endedAtMs == null` with a LIVE process carrying the runId = a genuine
 * in-flight run (gap-in-flight-liveness-worktree-proxy-not-process: without a live process the
 * board classifies the run as an orphan, not in-flight). An ENDED pair (end != null) is used to
 * make the telemetry source READ (`status: "ok"`) with ZERO in-flight — the empty-state fixture.
 */
function eventLine(runId, taskId, { eventKind, startedAtMs = null, endedAtMs = null, recordedAtMs }) {
  return JSON.stringify({
    schemaVersion: "1", runId, candidateId: taskId, taskId, stage: "Fast", attempt: 0, eventKind,
    timing: { queuedAtMs: null, startedAtMs, endedAtMs },
    agentLabel: "fast-mode", commandIdentity: `fast-mode-telemetry:${eventKind}`,
    executionCwd: null, worktreePath: null, baseCommit: null, candidateCommit: null,
    outcome: eventKind === "end" ? "success" : null, waitReason: null, resourceClaim: null,
    observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs,
  }) + "\n";
}

function writeTelemetry(ws, baseName, lines) {
  const dir = path.join(ws, ".workflow-events");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, baseName), lines.join(""));
}

/** A distinctive runId tail — never a bare "1-1" the /proc probe could match by accident. */
function distinctiveRunId(taskId) {
  return `fm-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function spawnLiveRun(runId) {
  const p = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)", runId], { detached: true, stdio: "ignore" });
  p.unref();
  return p;
}

async function waitForLiveProcess(runId) {
  for (let i = 0; i < 50; i++) {
    if (runProcessAliveSync(runId) === true) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`test fixture: live process for ${runId} never became visible in /proc`);
}

// ── AC1: the default view with ZERO transient rows is an EXPLICIT empty state ──────────────────────
test("AC1: default view with 0 in-flight/awaiting-land rows renders an explicit empty state, not a dash wall", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-tv-empty-");
  const cwd0 = process.cwd();
  let server;
  try {
    // Three pure history rows (the 2242) + one ENDED run so the telemetry source READS (status ok)
    // while in-flight count stays 0 — exactly the production shape the Finding measured.
    seed(tasksDir, "BQ-history-1", { title: "History row 1", status: "ready", body: CLEAN_BODY("bqHistOne") });
    seed(tasksDir, "BQ-history-2", { title: "History row 2", status: "todo", body: CLEAN_BODY("bqHistTwo") });
    seed(tasksDir, "BQ-history-3", { title: "History row 3", status: "ready", body: CLEAN_BODY("bqHistThree") });
    const oldRun = distinctiveRunId("BQ-history-1");
    writeTelemetry(ws, "fm-BQ-history-1.jsonl", [
      eventLine(oldRun, "BQ-history-1", { eventKind: "start", startedAtMs: Date.now() - 3 * 3600_000, recordedAtMs: Date.now() - 3 * 3600_000 }),
      eventLine(oldRun, "BQ-history-1", { eventKind: "end", endedAtMs: Date.now() - 2 * 3600_000, recordedAtMs: Date.now() - 2 * 3600_000 }),
    ]);

    process.chdir(ws);
    clearLandingCache();
    // ⛔ NEVER probe-then-bind: port 0 binds ONCE and the kernel-assigned port is read off the live handle.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    // ⚠️ MIGRATED by gap-webui-board-body-copy-en-zh: `?lang=zh`. Every assertion in this file pins
    // the page's copy, and the default language is now `en` — so without this the Chinese-literal
    // assertions below would silently test the wrong column (and the `!includes(...)` ones would
    // become vacuous: the string is absent for the wrong reason). Requesting zh leaves all of them
    // byte-identical and turns this file into a zh-output regression guard (this task's AC3).
    const board = await get(port, "/board?lang=zh");
    assert.equal(board.status, 200, "AC1: default /board returns 200");

    // The page's own counters agree that nothing is transient — the empty state is a TRUE reading.
    assert.ok(board.body.includes("0 实现中") && board.body.includes("0 待落地"),
      "AC1: the exec counters read 0 implementing / 0 awaiting-land (the empty state is not a lie)");
    assert.ok(board.body.includes("当前没有在飞 / 待落地的任务"),
      "AC1: the default view states the empty cause in words");
    assert.ok(board.body.includes("board_default_view=transient-empty"),
      "AC1: the empty state carries its own machine-readable key (distinguishable from filtered/legacy)");
    // Not an empty table, not a dash wall.
    assert.ok(!board.body.includes("<th>id</th>"), "AC1: no table (not even an empty one) is rendered");
    for (const id of ["BQ-history-1", "BQ-history-2", "BQ-history-3"]) {
      assert.ok(!board.body.includes(`>${id}<`), `AC1: the history row ${id} is NOT painted on the default view`);
    }
    // AC2's escape hatch is ON the empty state itself.
    assert.ok(board.body.includes("/board?all=1"), "AC1/AC2: the empty state links to the full store");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── AC1 + AC3: ONE transient row ⇒ the default view shows that row and NOT the history ────────────
test("AC1/AC3: with 1 in-flight task the default view shows ONLY that row; ?all=1 and ?status= restore the full store", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-tv-live-");
  const cwd0 = process.cwd();
  let server;
  const procs = [];
  try {
    seed(tasksDir, "BQ-history-1", { title: "History row 1", status: "ready", body: CLEAN_BODY("bqHistOne") });
    seed(tasksDir, "BQ-history-2", { title: "History row 2", status: "todo", body: CLEAN_BODY("bqHistTwo") });
    seed(tasksDir, "BQ-live-1", { title: "In flight", status: "todo", labels: ["gap"], body: CLEAN_BODY("bqLiveOne") });

    const runId = distinctiveRunId("BQ-live-1");
    procs.push(spawnLiveRun(runId));
    await waitForLiveProcess(runId);
    writeTelemetry(ws, "fm-BQ-live-1.jsonl", [
      eventLine(runId, "BQ-live-1", { eventKind: "start", startedAtMs: Date.now() - 5 * 60_000, recordedAtMs: Date.now() - 5 * 60_000 }),
    ]);

    process.chdir(ws);
    clearLandingCache();
    // ⛔ NEVER probe-then-bind: port 0 binds ONCE and the kernel-assigned port is read off the live handle.
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const board = await get(port, "/board?lang=zh"); // migrated to explicit zh — see the note above
    assert.equal(board.status, 200, "AC1: default /board returns 200");
    assert.ok(board.body.includes(">BQ-live-1<"), "AC1: the single in-flight row IS rendered");
    assert.ok(board.body.includes("在飞 "), "AC1: it renders as 在飞 minutes (the transient signal itself)");
    for (const id of ["BQ-history-1", "BQ-history-2"]) {
      assert.ok(!board.body.includes(`>${id}<`), `AC1/AC3: the clean history row ${id} is NOT rendered by default`);
    }
    assert.ok(board.body.includes("Page 1 of 1 (1 rows)"), "AC1: one page, no paging needed to see it");
    assert.ok(board.body.includes("/board?all=1"), "AC1: the default view links to the full store");

    // AC2: the manual filters still work (they are one of the two ways back to the full store).
    const filtered = await get(port, "/board?status=ready");
    assert.equal(filtered.status, 200, "AC2: ?status= still returns 200");
    assert.ok(filtered.body.includes(">BQ-history-1<") && !filtered.body.includes(">BQ-history-2<"),
      "AC2: ?status=ready shows the ready rows, unfiltered by transience");

    // AC2: ?all=1 is the explicit way back to the whole store (the 2243-row view).
    const all = await get(port, "/board?all=1&lang=zh"); // migrated to explicit zh — see the note above
    assert.equal(all.status, 200, "AC2: ?all=1 returns 200");
    for (const id of ["BQ-history-1", "BQ-history-2", "BQ-live-1"]) {
      assert.ok(all.body.includes(`>${id}<`), `AC2: ?all=1 renders ${id} — the full store is one click away`);
    }
    assert.ok(all.body.includes("已显示全部 3 行"),
      "AC2: ?all=1 states that it is showing the whole store (all 3 rows)");
    assert.ok(all.body.includes("<th>id</th>"), "AC2: ?all=1 renders the table");
  } finally {
    for (const p of procs) { try { process.kill(p.pid, "SIGKILL"); } catch { /* already gone */ } }
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── The «cannot judge» value is NOT the «judged and empty» value (硬规则 3b / 硬规则 5) ─────────────
test("guard: an unread transient source does NOT render as an empty default view — it says so and shows all rows", async () => {
  const { ws, tasksDir, parent } = makeWorkspace("board-tv-incomplete-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "BQ-history-1", { title: "History row 1", status: "ready", body: CLEAN_BODY("bqHistOne") });
    seed(tasksDir, "BQ-history-2", { title: "History row 2", status: "todo", body: CLEAN_BODY("bqHistTwo") });
    // ⛔ NO .workflow-events/ is created ⇒ the execution source reads `empty` — it did NOT read.
    // Hiding rows on its authority would turn 「无法判定哪些任务在飞」 into 「没有任务在飞」.

    process.chdir(ws);
    clearLandingCache();
    // ⛔ NEVER probe-then-bind: port 0 binds ONCE and the kernel-assigned port is read off the live handle.
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const board = await get(port, "/board?lang=zh"); // migrated to explicit zh — see the note above
    assert.equal(board.status, 200, "guard: default /board still 200 with an unread source");
    assert.ok(board.body.includes("board_default_view=unfiltered-source-incomplete"),
      "guard: the view reports its own un-evaluated state (a distinct value, not the empty-state's)");
    assert.ok(!board.body.includes("当前没有在飞 / 待落地的任务"),
      "guard: «cannot judge» is NOT rendered with the «judged and empty» wording");
    assert.ok(board.body.includes("默认过滤未生效"), "guard: the page says the default filter did not apply, and why");
    for (const id of ["BQ-history-1", "BQ-history-2"]) {
      assert.ok(board.body.includes(`>${id}<`),
        `guard: ${id} renders — an absent source is not evidence of absence (硬规则 5)`);
    }
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── Direct render unit: the empty state is table-less; the legacy callers keep their table ─────────
test("render: transientView=applied with 0 rows renders no table; an omitted transientView keeps legacy rendering", () => {
  const base = {
    landing: { status: "ok", reason: null, flags: new Map(), scanned: 0 },
    execution: { status: "ok", reason: null, flags: new Map(), inFlight: [] },
    intentStatus: "ok",
    intentReason: null,
    rows: [],
  };
  // ⚠️ MIGRATED by gap-webui-board-body-copy-en-zh: `renderBoardPage`'s THIRD positional argument is
  // `lang`, defaulting to `en`. Both calls below pass "zh" explicitly (decision record ④): the
  // positive assertions keep the identical Chinese literal, AND the `!legacy.includes(...)` negative
  // below stays MEANINGFUL — under `en` it would be vacuously true (the string is absent because the
  // page is English, not because the legacy path suppressed the note), which is the "a negative
  // assertion keyed on a zh literal silently becomes a no-op" trap ④ names.
  const applied = renderBoardPage({ ...base, transientView: "applied", joinedTotal: 2248, incompleteSources: [] }, null, "zh");
  assert.ok(applied.includes("当前没有在飞 / 待落地的任务"), "render: the applied-empty state renders the cause");
  assert.ok(applied.includes("2248"), "render: it names the number of rows it is NOT painting");
  assert.ok(!applied.includes("<th>id</th>"), "render: no table is rendered in the applied-empty state");

  const legacy = renderBoardPage({ ...base }, null, "zh");
  assert.ok(legacy.includes("<th>id</th>"), "render: an omitted transientView (direct callers) keeps the table");
  assert.ok(!legacy.includes("当前没有在飞"), "render: the legacy path adds no transient note");
});
