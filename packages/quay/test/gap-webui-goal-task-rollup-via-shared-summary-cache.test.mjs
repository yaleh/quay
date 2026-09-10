// @test-group product
// gap-webui-goal-task-rollup-via-shared-summary-cache — the goal↔task structured relationship
// (top-level `goal_ac`, task→AC linkage) finally gets a read surface. Pre-fix, `goal_ac` was
// WRITE-only through the ABI: task_write accepted it, task_list dropped it — so /goal, /goal/<id>
// and /task/<id> all had the relationship recorded but no way to consume it. The fix surfaces
// `goal_ac` in the view-model (abi.ts + native toViewModel), then /goal rolls it up — per-criterion
// task count + status distribution, a goal-level sum over its criteria — reusing the dashboard's
// 30s-TTL taskSummaryCache (方案 A), never a second Map. The three states (count / 未挂靠 / 未读到)
// are pairwise distinct (hard rule 6/3b).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { handleGoalList, renderTaskAttachText, goalAcOf } from "../src/serve-goal.ts";
import { readTaskSummary, clearTaskSummaryCache } from "../src/serve-dashboard.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

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

function captureRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body || ""; },
  };
}

/** Parse the /goal list table into rows. gap-webui-goal-list-tab-split-goal-ac: the list is now the
 *  Goals tab (7 cols: id / status / title / AC 达成 / last progress / first evidence / 挂靠任务), so
 *  the task-attach cell is index 6 and — because it links cross-tab — is wrapped in an <a>. Strip the
 *  anchor to read the plain count text the detail page (which renders no anchor) shares. */
function goalTableRows(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  const trs = [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((x) => x[1]).filter((r) => !/<th/.test(r));
  return trs.map((r) => {
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    const idM = /href="\/goal\/([^"]+)"/.exec(cells[0] || "");
    return {
      id: idM ? idM[1] : "",
      kind: "goal",
      taskAttach: (cells[6] || "").replace(/<[^>]*>/g, "").trim(),
    };
  });
}

// ── AC2 (unit): three states pairwise distinct; 未挂靠 != "0"; 未读到 != 未挂靠 ───────────────

test("AC2: count / 未挂靠 / 未读到 are pairwise distinct (hard rule 6/3b)", () => {
  const a = renderTaskAttachText({ ok: true, tasks: [
    { id: "T-1", status: "done", goal_ac: "AC-1" },
    { id: "T-2", status: "ready", goal_ac: "AC-1" },
  ] }, ["AC-1"]);
  const b = renderTaskAttachText({ ok: true, tasks: [] }, ["AC-1"]);
  const c = renderTaskAttachText({ ok: false, error: "boom" }, ["AC-1"]);

  assert.match(a, /^2（/, "attached state renders its count first");
  assert.match(b, /未挂靠/, "no-reference state is the 未挂靠 marker");
  assert.match(c, /未读到/, "failed-read state is the 未读到 marker");
  assert.notEqual(a, b, "count != 未挂靠");
  assert.notEqual(a, c, "count != 未读到");
  assert.notEqual(b, c, "未挂靠 != 未读到");
  assert.notEqual(b, "0", "未挂靠 is NOT the string \"0\" (hard rule 6)");
  assert.notEqual(c, b, "未读到 is NOT 未挂靠 (hard rule 3b)");
});

test("goalAcOf: top-level goal_ac wins; extra.goal_ac fallback; unset => null", () => {
  assert.equal(goalAcOf({ goal_ac: "AC-177", extra: { goal_ac: "AC-178" } }), "AC-177", "top-level goal_ac wins over extra");
  assert.equal(goalAcOf({ extra: { goal_ac: "AC-178" } }), "AC-178", "github provider's extra.goal_ac fallback");
  assert.equal(goalAcOf({}), null, "absent goal_ac => null (缺值 = 未查)");
  assert.equal(goalAcOf({ goal_ac: "" }), null, "empty goal_ac => null, never an empty string");
});

// ── AC6 (unit): goal rollup == sum of its criteria; a direct-on-goal task is not counted ────────

test("AC6: goal rollup == sum of criteria; direct-on-goal task excluded", () => {
  const read = { ok: true, tasks: [
    { id: "T-1", status: "done", goal_ac: "AC-101" },
    { id: "T-2", status: "ready", goal_ac: "AC-101" },
    { id: "T-3", status: "todo", goal_ac: "AC-102" },
    { id: "T-4", status: "done", goal_ac: "GOAL-001" }, // hangs on the GOAL, not an AC
  ] };
  const ac101 = renderTaskAttachText(read, ["AC-101"]);
  const ac102 = renderTaskAttachText(read, ["AC-102"]);
  const goal = renderTaskAttachText(read, ["AC-101", "AC-102"]);
  assert.match(ac101, /^2（/, "AC-101 has 2 tasks");
  assert.match(ac102, /^1（/, "AC-102 has 1 task");
  assert.match(goal, /^3（/, "goal = 2 + 1, NOT 4 (the GOAL-001-hanging task is excluded)");
});

// ── AC3 (static + unit): reuses the dashboard accessor, not a second Map ────────────────────────

test("AC3a: serve-goal imports the dashboard cache accessor (never its own cache)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "serve-goal.ts"), "utf8");
  assert.match(src, /import\s*\{[^}]*readTaskSummary[^}]*\}\s*from\s*"\.\/serve-dashboard\.ts"/,
    "serve-goal.ts imports readTaskSummary from ./serve-dashboard.ts");
  assert.doesNotMatch(src, /taskSummaryCache\s*=\s*new\s+Map|TASK_SUMMARY_CACHE_TTL_MS\s*=\s*\d/,
    "serve-goal.ts does not declare its own task-summary cache or TTL");
});

test("AC3b: one taskList call across /dashboard + /goal in the same 30s window", async () => {
  clearTaskSummaryCache();
  const calls = { taskList: 0 };
  const client = {
    goalList: async () => [{ id: "GOAL-001", title: "g", status: "active", kind: "goal", body: "" }],
    taskList: async (filter) => {
      calls.taskList++;
      assert.equal(filter.includeBody, false, "taskList called with includeBody:false");
      return { tasks: [], malformed: [] };
    },
  };
  // The /dashboard path reads the same accessor (handleDashboard calls readTaskSummary).
  await readTaskSummary("ws", client);
  // The /goal path reuses the SAME cache.
  const res = captureRes();
  await handleGoalList({}, res, new URL("http://localhost/goal"), client, "ws");
  assert.equal(res.statusCode, 200);
  assert.equal(calls.taskList, 1, "taskList called once total (shared cache), not once per page");
});

// ── AC5 (unit): taskList throw => 200, columns intact, 未读到 carries the reason ────────────────

test("AC5: taskList failure renders 未读到 with the reason, never a bare —", async () => {
  clearTaskSummaryCache();
  const client = {
    goalList: async () => [
      { id: "GOAL-001", title: "g", status: "active", kind: "goal", body: "" },
      { id: "AC-101", title: "c", status: "active", kind: "criterion", goal: "GOAL-001", criterion: "exit 0", body: "" },
    ],
    taskList: async () => { throw new Error("boom-read-failed"); },
  };
  // gap-webui-goal-list-tab-split-goal-ac: criteria render on the Criteria tab — the criterion
  // row's 挂靠任务 cell is where the three-state 未读到（reason） shows up.
  const res = captureRes();
  await handleGoalList({}, res, new URL("http://localhost/goal?kind=criterion"), client, "ws");
  assert.equal(res.statusCode, 200, "fail-open: page still 200");
  assert.match(res.body, /AC-101/, "criterion row still renders");
  assert.match(res.body, /未读到/, "stats column shows the 未读到 state");
  assert.match(res.body, /boom-read-failed/, "未读到 carries the failure reason substring");
});

// ── integration: a real running serve instance ─────────────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, tasksDir, goalsDir;

before(async () => {
  tasksDir = makeTmpDir("goal-task-rollup-tasks-");
  const adrDir = makeTmpDir("goal-task-rollup-adr-");
  workspaceRoot = makeTmpDir("goal-task-rollup-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  const writeGoal = (id) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-goal.md`),
      `---\nid: ${id}\ntitle: ${id} title\nstatus: active\nkind: goal\norigin: test\n---\n## Goal\nmeasured\n`);
  const writeCriterion = (id, goalId) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-criterion.md`),
      `---\nid: ${id}\ntitle: criterion ${id}\nstatus: active\nkind: criterion\ngoal: ${goalId}\ncriterion: exit 0\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);
  const writeTask = (id, goalAc, status) =>
    fs.writeFileSync(path.join(tasksDir, `${id}.md`),
      `---\nid: ${id}\ntitle: fixture ${id}\nstatus: ${status}\nlabels:\n  - gap\nparent: null\nchildren: []\nextra:\n  schema: v1\ngoal_ac: ${goalAc}\n---\n## Proposal\nfixture task body over forty non-whitespace chars long for the shape check.\n`);

  for (const gid of ["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-004", "GOAL-005", "GOAL-006", "GOAL-007", "GOAL-008"]) writeGoal(gid);
  const criteria = [
    ["AC-101", "GOAL-001"], ["AC-102", "GOAL-001"],
    ["AC-201", "GOAL-002"],
    ["AC-301", "GOAL-003"],
    ["AC-401", "GOAL-004"],
    ["AC-501", "GOAL-005"],
    ["AC-601", "GOAL-006"],
    ["AC-701", "GOAL-007"], ["AC-702", "GOAL-007"],
    ["AC-801", "GOAL-008"],
  ];
  for (const [acid, gid] of criteria) writeCriterion(acid, gid);

  // Task→AC linkages matching the 2026-09-08 production truth (11 / 13 / 6 / 5), recomputed here as
  // the fixture's own ledger truth. The other 4 goals carry zero tasks → 未挂靠.
  const plan = [
    ["AC-101", 6], ["AC-102", 5], // GOAL-001 = 11
    ["AC-301", 13],               // GOAL-003 = 13
    ["AC-701", 3], ["AC-702", 3], // GOAL-007 = 6
    ["AC-801", 5],                // GOAL-008 = 5
  ];
  let n = 0;
  for (const [ac, count] of plan) {
    for (let i = 0; i < count; i++) {
      const status = ["done", "ready", "todo"][n % 3];
      writeTask(`T-${String(++n).padStart(3, "0")}`, ac, status);
    }
  }
  // One task hanging DIRECTLY on the goal id (not an AC) — AC6's negative control.
  writeTask("T-DIRECT", "GOAL-001", "done");

  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

// ── AC1: production-carrier reading — per-goal task counts match the ledger truth ───────────────

test("AC1: /goal shows 11/13/6/5 for the four attached goals, 未挂靠 for the rest", async () => {
  const r = await get(port, "/goal");
  assert.equal(r.status, 200);
  const rows = goalTableRows(r.body);
  const expected = { "GOAL-001": 11, "GOAL-003": 13, "GOAL-007": 6, "GOAL-008": 5 };
  const mismatches = [];
  for (const gid of Object.keys(expected)) {
    const row = rows.find((x) => x.id === gid && x.kind === "goal");
    assert.ok(row, `goal row ${gid} present`);
    const m = /^(\d+)/.exec(row.taskAttach);
    if (!m || Number(m[1]) !== expected[gid]) mismatches.push(`(${gid}, page=${row.taskAttach}, truth=${expected[gid]})`);
  }
  for (const gid of ["GOAL-002", "GOAL-004", "GOAL-005", "GOAL-006"]) {
    const row = rows.find((x) => x.id === gid && x.kind === "goal");
    assert.ok(row, `goal row ${gid} present`);
    assert.match(row.taskAttach, /未挂靠/, `${gid} shows 未挂靠, got "${row.taskAttach}"`);
  }
  assert.deepEqual(mismatches, [], `(goal, page, truth) mismatches:\n  ${mismatches.join("\n  ")}`);
});

// ── AC7: detail page provides the SAME rollup as the list for the same id ──────────────────────

test("AC7: /goal/<id> shows the same task-attach value as /goal for the same id", async () => {
  const list = await get(port, "/goal");
  const goalRow = goalTableRows(list.body).find((x) => x.id === "GOAL-001" && x.kind === "goal");
  assert.ok(goalRow, "GOAL-001 in list");
  const detail = await get(port, "/goal/GOAL-001");
  assert.equal(detail.status, 200);
  const detailM = /挂靠任务: ([^<]+)/.exec(detail.body);
  assert.ok(detailM, "detail page shows the 挂靠任务 statistic");
  assert.equal(detailM[1].trim(), goalRow.taskAttach, "detail value == list value for GOAL-001");
  // Per-criterion rows in the detail block also carry the column.
  assert.match(detail.body, /<th>挂靠任务<\/th>/, "detail criterion block has the task-attach column");
});

// ── AC4: cache-hit p50 vs cache-miss latency, both bounded, both rendered fully ─────────────────

test("AC4: cache-hit stays fast; cache-miss renders fully and stays bounded", async () => {
  // Warm the shared taskSummaryCache (the /dashboard and /goal paths share the same 30s cache).
  await get(port, "/goal");

  const hitTimes = [];
  for (let i = 0; i < 11; i++) {
    const t0 = process.hrtime.bigint();
    const r = await get(port, "/goal");
    const t1 = process.hrtime.bigint();
    assert.equal(r.status, 200);
    hitTimes.push(Number(t1 - t0) / 1e6);
  }
  hitTimes.sort((a, b) => a - b);
  const hitP50 = hitTimes[Math.floor(hitTimes.length / 2)];

  // Cold-miss: drop the shared cache so each request re-pays ONE taskList (fixture-trivial, 2.9s on
  // the production store). Take the max of 3 cold requests for a stable miss cost.
  const missTimes = [];
  for (let i = 0; i < 3; i++) {
    clearTaskSummaryCache();
    const t0 = process.hrtime.bigint();
    const r = await get(port, "/goal");
    const t1 = process.hrtime.bigint();
    assert.equal(r.status, 200, "cold-miss page still 200");
    assert.match(r.body, /GOAL-001/, "cold-miss page still renders goal rows");
    assert.match(r.body, /<th>挂靠任务<\/th>/, "cold-miss page still renders the stats column");
    missTimes.push(Number(t1 - t0) / 1e6);
  }
  const missMax = Math.max(...missTimes);

  console.log(`AC4: cache-hit p50=${hitP50.toFixed(1)}ms  cache-miss max=${missMax.toFixed(1)}ms`);

  // The dependency task's baseline (0.49s) + the AC's margins. These are loose canaries — the REAL
  // "did not re-read taskList on hit" check is AC3b's spy count; the timing here only fails on a
  // gross regression (e.g. a synchronous task-store scan per /goal request).
  assert.ok(hitP50 <= 2000, `cache-hit p50=${hitP50.toFixed(1)}ms > 2000ms`);
  assert.ok(missMax <= hitP50 + 3500, `cache-miss max=${missMax.toFixed(1)}ms > hit+3500ms`);
});
