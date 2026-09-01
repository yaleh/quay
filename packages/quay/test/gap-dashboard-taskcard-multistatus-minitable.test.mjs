// @test-group product
// gap-dashboard-taskcard-multistatus-minitable — dashboard taskCard 升级为按状态分栏的迷你表.
//
// 48h access log (.quay/quay-access.log) shows /tasks is the highest-frequency base path (170 hits),
// including 78 cross-status (done/ready/todo/needs-human × sort × pageSize) requests in ONE hour on
// 08-30 — a "整页跳转来回切换状态巡检" pattern, one full round-trip per status switch. The dashboard
// taskCard's single mixed "最近更新（非 done）" list could not answer "what is currently needs-human?"
// without that round-trip, so users bypassed /dashboard (only 4 hits) and went straight to /tasks.
//
// This task turns the taskCard from "count bar + one mixed list" into per-status mini lists for the
// three NON-terminal states (ready/todo/needs-human), N=3, updatedAt descending, /task/<id> links —
// derived IN-MEMORY from the same readTaskSummary() array (30s-TTL-cached client.taskList result), so
// no new provider call and no new network round-trip. done/superseded stay pure counts (no expansion).
//
// Tests:
//   AC1/AC4 — a four-status mixed fixture renders three per-status blocks (each heading + the correct
//             task-id links in updatedAt-descending order, N=3 cap), and done/superseded are NOT
//             expanded into mini-list rows.
//   AC2 — a status with 0 tasks renders no mini-list block (no empty-placeholder noise) but the count
//         row still shows 0.
//   AC3 — zero additional provider calls: one readTaskSummary() → exactly one client.taskList call
//         (the gap-webui-dashboard-load-time-optimization AC3 "零额外调用" judgment), and
//         renderDashboardPage's own source never references the provider (it is a pure render function).
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { renderDashboardPage } from "../src/serve-dashboard.ts";
import { readTaskSummary, clearTaskSummaryCache } from "../src/serve-handlers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");

/** Minimal-but-shape-valid dashboard args: every nested field renderDashboardPage touches, with
 *  the sys/mgr/live probes at their benign no-op values so the render function is exercised as a
 *  pure function of `tasks` (the only input the per-status mini lists depend on). */
function makeDashboardArgs(tasks) {
  return {
    live: { status: "ok", liveState: "running", inFlight: [], concurrency: 0 },
    sys: {
      resourceGate: { status: "ok", verdict: "GO", cpuStallAvg10: null, loadAvg: null },
      processBudget: { status: "ok", verdict: "GO" },
    },
    mgr: { liveness: { sessions: [] }, loopDriver: { verdict: "GO" } },
    tests: { runs: [], reason: null },
    history: { status: "empty", commits: [] },
    tasks,
  };
}

/** Extract `function <name>(...) { ... }` (balanced parens + braces) from a source file — the same
 *  structural-pin helper gap-dashboard-parallelize.test.mjs uses for its source-shape assertions. */
function fnBody(src, fnName) {
  const m = new RegExp(`function\\s+${fnName}\\s*\\(`).exec(src);
  assert.ok(m, `${fnName} found in ${src.length}-char source`);
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    if (src[i] === "(") parenDepth++;
    else if (src[i] === ")") parenDepth--;
    i++;
  }
  while (i < src.length && src[i] !== "{") i++;
  assert.ok(src[i] === "{", `${fnName} has a body`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`${fnName} body not terminated`);
}

test("AC1/AC4: four-status fixture renders ready/todo/needs-human mini lists (N=3, updatedAt desc) and skips done/superseded", () => {
  const tasks = [
    { id: "R-1", title: "ready one",   status: "ready",       labels: [], updatedAt: 100 },
    { id: "R-2", title: "ready two",   status: "ready",       labels: [], updatedAt: 50 },
    { id: "R-3", title: "ready three", status: "ready",       labels: [], updatedAt: 10 },
    { id: "R-4", title: "ready four",  status: "ready",       labels: [], updatedAt: 200 },
    { id: "T-1", title: "todo one",    status: "todo",        labels: [], updatedAt: 300 },
    { id: "T-2", title: "todo two",    status: "todo",        labels: [], updatedAt: 20 },
    { id: "N-1", title: "needs one",   status: "needs-human", labels: [], updatedAt: 5 },
    { id: "D-1", title: "done one",    status: "done",        labels: [], updatedAt: 999 },
    { id: "D-2", title: "done two",    status: "done",        labels: [], updatedAt: 998 },
    { id: "S-1", title: "sup one",     status: "superseded",  labels: [], updatedAt: 500 },
  ];
  const html = renderDashboardPage(makeDashboardArgs(tasks));

  // Each non-terminal status renders its own block heading.
  for (const s of ["ready", "todo", "needs-human"]) {
    assert.ok(html.includes(`${s}（最近 3 条）`), `renders the ${s} mini-list heading`);
  }
  // done / superseded stay pure counts — no mini-list block.
  assert.ok(!html.includes("done（最近 3 条）"), "done has no mini-list block");
  assert.ok(!html.includes("superseded（最近 3 条）"), "superseded has no mini-list block");

  // ready: top-3 by updatedAt (200, 100, 50) — R-3 (10) is dropped by the N=3 cap.
  assert.ok(html.includes("/task/R-4"), "ready lists R-4 (updatedAt 200)");
  assert.ok(html.includes("/task/R-1"), "ready lists R-1 (updatedAt 100)");
  assert.ok(html.includes("/task/R-2"), "ready lists R-2 (updatedAt 50)");
  assert.ok(!html.includes("/task/R-3"), "ready drops R-3 beyond the N=3 cap");
  const iR4 = html.indexOf("/task/R-4");
  const iR1 = html.indexOf("/task/R-1");
  const iR2 = html.indexOf("/task/R-2");
  assert.ok(iR4 >= 0 && iR1 > iR4 && iR2 > iR1, "ready rows are updatedAt-descending (R-4 → R-1 → R-2)");

  // todo + needs-human list their correct ids.
  assert.ok(html.includes("/task/T-1") && html.includes("/task/T-2"), "todo lists T-1 and T-2");
  assert.ok(html.includes("/task/N-1"), "needs-human lists N-1");

  // done / superseded ids never appear as mini-list links.
  assert.ok(!html.includes("/task/D-1"), "done D-1 is not expanded");
  assert.ok(!html.includes("/task/D-2"), "done D-2 is not expanded");
  assert.ok(!html.includes("/task/S-1"), "superseded S-1 is not expanded");
});

test("AC2: a status with 0 tasks renders no mini-list block (no empty-placeholder noise) but the count row still shows 0", () => {
  const tasks = [
    { id: "R-1", title: "ready one", status: "ready", labels: [], updatedAt: 100 },
    { id: "D-1", title: "done one", status: "done", labels: [], updatedAt: 999 },
  ];
  const html = renderDashboardPage(makeDashboardArgs(tasks));

  assert.ok(html.includes("ready（最近 3 条）"), "ready (1 task) still renders its block");
  assert.ok(html.includes("/task/R-1"), "ready lists its single task");

  // todo / needs-human have 0 tasks → no block heading, no empty placeholder.
  assert.ok(!html.includes("todo（最近 3 条）"), "todo (0 tasks) renders no mini-list block");
  assert.ok(!html.includes("needs-human（最近 3 条）"), "needs-human (0 tasks) renders no mini-list block");

  // …but the count row still shows their 0.
  assert.ok(html.includes("<b>0</b> todo"), "count row still shows 0 todo");
  assert.ok(html.includes("<b>0</b> needs-human"), "count row still shows 0 needs-human");
  assert.ok(!html.includes("/task/D-1"), "done D-1 is not expanded");
});

test("AC3: one task-summary read → exactly one client.taskList call (zero additional provider calls)", async () => {
  clearTaskSummaryCache();
  const root = `gap-tsum-minitable-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fixture = [
    { id: "A-1", title: "one", status: "ready", labels: [], updatedAt: 1 },
    { id: "A-2", title: "two", status: "done", labels: [], updatedAt: 2 },
  ];
  const calls = { n: 0 };
  const client = { taskList: async () => { calls.n += 1; return { tasks: fixture, malformed: [] }; } };
  try {
    const t1 = await readTaskSummary(root, client);
    assert.equal(t1, fixture, "first read returns the provider's task array");
    assert.equal(calls.n, 1, "one read → one client.taskList call");
    // The per-status mini lists are derived IN-MEMORY from THIS array; a second read within TTL adds
    // zero provider calls — the gap-webui-dashboard-load-time-optimization AC3 "零额外调用" judgment.
    const t2 = await readTaskSummary(root, client);
    assert.equal(t2, fixture, "cache hit returns the same array object (no re-read)");
    assert.equal(calls.n, 1, "cache hit adds zero provider calls");
  } finally {
    clearTaskSummaryCache();
  }
});

test("AC3: renderDashboardPage is a pure render function — its source never references the provider", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const body = fnBody(src, "renderDashboardPage");
  assert.ok(!body.includes("taskList"), "renderDashboardPage body never references taskList");
  assert.ok(!body.includes("client"), "renderDashboardPage body never references client");
  assert.ok(!body.includes("readTaskSummary"), "renderDashboardPage body never references readTaskSummary");
});
