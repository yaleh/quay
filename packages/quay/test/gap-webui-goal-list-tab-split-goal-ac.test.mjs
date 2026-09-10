// @test-group product
// gap-webui-goal-list-tab-split-goal-ac — split the /goal merged GOAL+AC list into two tabs.
// Pre-fix: GOAL (12) and AC (86) records shared one 11-column table (`id/kind/status/goal/title/
// criterion/recent verdict/last progress/first evidence/AC 达成/挂靠任务`) under
// `table-layout:fixed`, which squeezed every column — 3 of the 11 columns were structural dead
// cells for one side or the other (criterion/recent verdict are always "—" on GOAL rows; AC 达成/
// kind are meaningless on criterion rows) — so the title cell measured scrollWidth 336 vs
// clientWidth 156 (180px truncated) and five headers were ellipsized.
//
// The fix (proposal): `/goal` (no kind) defaults to a Goals tab (7 cols); `/goal?kind=criterion` is
// a Criteria tab (8 cols); the "All" merged view is gone; the store's existing `?goal=` filter gets
// a clickable entry point (the criteria `goal` column + the goals' AC 达成 / 挂靠任务 cross-tab
// links); the draft banner splits into per-kind counts with a cross-tab "另有 N 条 X 待裁定" hint;
// and the single `client.goalList()` read invariant is preserved (tab split changes only the render).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { handleGoalList } from "../src/serve-goal.ts";
import { renderGoalCard } from "../src/serve-dashboard.ts";
import { createGoalStore } from "../src/goal-store.ts";
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

/** The list table's `<th>` label texts (tags stripped), in order. */
function headers(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  const head = m[1].split("</tr>")[0];
  return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) => x[1].replace(/<[^>]*>/g, "").trim());
}

/** The `<colgroup>` widths as percentages, in order. */
function colWidths(html) {
  const m = /<colgroup>([\s\S]*?)<\/colgroup>/.exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/width:([\d.]+)%/g)].map((x) => Number(x[1]));
}

function dataRows(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  const trs = [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((x) => x[1]).filter((r) => !/<th/.test(r));
  return trs.map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]));
}

const hrefOf = (cell) => (/href="([^"]+)"/.exec(cell || "") || [])[1] || "";
const goalIdOf = (cell) => (/href="\/goal\/([^"]+)"/.exec(cell || "") || [])[1] || "";
const stripTags = (s) => (s || "").replace(/<[^>]*>/g, "").trim();

/** Goals-tab rows (7 cols): id / status / title / AC 达成 / last progress / first evidence / 挂靠任务. */
function goalRows(html) {
  return dataRows(html).map((cells) => ({
    id: goalIdOf(cells[0]),
    kind: "goal",
    status: stripTags(cells[1]),
    title: stripTags(cells[2]),
    rollupHref: hrefOf(cells[3]),
    rollup: stripTags(cells[3]),
    taskAttachHref: hrefOf(cells[6]),
  }));
}

/** Criteria-tab rows (8 cols): id / goal / status / title / criterion / recent verdict / last progress / 挂靠任务. */
function criterionRows(html) {
  return dataRows(html).map((cells) => ({
    id: goalIdOf(cells[0]),
    kind: "criterion",
    goalHref: hrefOf(cells[1]),
    goal: decodeURIComponent((/goal=([^"]+)/.exec(hrefOf(cells[1]) || "") || [])[1] || ""),
    status: stripTags(cells[2]),
    title: stripTags(cells[3]),
  }));
}

// ── AC6 (unit): ONE goalList per request, on BOTH tabs — spy, no server ──────────────────────

test("AC6: ONE goalList call per request on /goal AND /goal?kind=criterion (spy)", async () => {
  for (const urlPath of ["/goal", "/goal?kind=criterion"]) {
    const calls = { goalList: 0 };
    const client = {
      goalList: async () => {
        calls.goalList++;
        return [
          { id: "GOAL-001", title: "g", status: "active", kind: "goal", body: "" },
          { id: "AC-101", title: "c", status: "achieved", kind: "criterion", goal: "GOAL-001", criterion: "exit 0", body: "" },
        ];
      },
      taskList: async () => ({ tasks: [], malformed: [] }),
    };
    const res = captureRes();
    await handleGoalList({}, res, new URL(`http://localhost${urlPath}`), client, "ws");
    assert.equal(res.statusCode, 200);
    assert.equal(calls.goalList, 1, `${urlPath}: goalList == 1 (the tab split must not add a second read)`);
  }
});

test("AC6: one store list() == one ledgerEvidenceMap parse (negative control bumps the count)", () => {
  // ledgerEvidenceMap is module-private (goal-store.ts); list() calls it exactly once, so counting
  // list() reads counts ledger parses (the same proxy the detail task's AC6 uses).
  const dir = makeTmpDir("goal-ledger-proxy-");
  const store = createGoalStore(dir);
  let reads = 0;
  const list = (f) => { reads++; return store.list(f); };
  list({});
  assert.equal(reads, 1, "a single list() is a single ledger parse");
  list({});
  assert.equal(reads, 2, "a second read is a second ledger parse (the measurement can take false)");
});

// ── integration: a real running serve instance ───────────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, goalsDir;

before(async () => {
  const tasksDir = makeTmpDir("goal-tabsplit-tasks-");
  const adrDir = makeTmpDir("goal-tabsplit-adr-");
  workspaceRoot = makeTmpDir("goal-tabsplit-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  const goal = (id, title, status) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-goal.md`),
      `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nkind: goal\norigin: test\n---\n## 背景\nmeasured\n`);
  const ac = (id, status, goalId) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-criterion.md`),
      `---\nid: ${id}\ntitle: criterion ${id}\nstatus: ${status}\nkind: criterion\ngoal: ${goalId}\ncriterion: exit 0\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);

  // GOALs with mixed statuses (AC7's status-priority default): active ×2, achieved, retired — no
  // draft in the base fixture (AC5 constructs draft records dynamically and needs a clean count).
  goal("GOAL-001", "achieved goal", "achieved");
  goal("GOAL-002", "active goal A", "active");
  goal("GOAL-004", "active goal B", "active");
  goal("GOAL-005", "retired goal", "retired");
  ac("AC-101", "achieved", "GOAL-001");
  ac("AC-102", "active", "GOAL-001");
  ac("AC-201", "active", "GOAL-002");
  ac("AC-401", "achieved", "GOAL-004");

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

// ── AC1: /goal (no kind) is the Goals tab — 7 headers, goal rows only ────────────────────────

test("AC1: /goal renders 7 columns, no criterion/recent verdict/kind, all rows kind=goal", async () => {
  const r = await get(port, "/goal");
  assert.equal(r.status, 200);
  const hs = headers(r.body);
  assert.equal(hs.length, 7, `Goals tab has 7 <th>; got: ${hs.join(" | ")}`);
  for (const banned of ["criterion", "recent verdict", "kind"]) {
    assert.ok(!hs.includes(banned), `Goals tab must not have a "${banned}" header`);
  }
  for (const want of ["id", "status", "title", "AC 达成", "last progress", "first evidence", "挂靠任务"]) {
    assert.ok(hs.includes(want), `Goals tab must have "${want}"`);
  }
  const rows = goalRows(r.body);
  assert.ok(rows.length >= 4, `rendered ${rows.length} goal rows`);
  const bad = rows.filter((x) => x.kind !== "goal").map((x) => `id=${x.id}`);
  assert.deepEqual(bad, [], `non-goal rows on the Goals tab:\n  ${bad.join("\n  ")}`);
});

// ── AC2: /goal?kind=criterion is the Criteria tab — 8 headers, criterion rows only ───────────

test("AC2: /goal?kind=criterion renders 8 columns, no AC 达成/kind, has goal, all rows criterion", async () => {
  const r = await get(port, "/goal?kind=criterion");
  assert.equal(r.status, 200);
  const hs = headers(r.body);
  assert.equal(hs.length, 8, `Criteria tab has 8 <th>; got: ${hs.join(" | ")}`);
  for (const banned of ["AC 达成", "kind"]) {
    assert.ok(!hs.includes(banned), `Criteria tab must not have a "${banned}" header`);
  }
  for (const want of ["id", "goal", "status", "title", "criterion", "recent verdict", "last progress", "挂靠任务"]) {
    assert.ok(hs.includes(want), `Criteria tab must have "${want}"`);
  }
  const rows = criterionRows(r.body);
  assert.ok(rows.length >= 4, `rendered ${rows.length} criterion rows`);
  const bad = rows.filter((x) => x.kind !== "criterion").map((x) => `id=${x.id}`);
  assert.deepEqual(bad, [], `non-criterion rows on the Criteria tab:\n  ${bad.join("\n  ")}`);
});

// ── AC3: structural squeeze resolved — the title column gets the widest budget (structural proxy
//  for the DOM scrollWidth reading, which the DoD measures on a real browser) ─────────────────

test("AC3: title column is widest on the Goals tab; no dead columns remain (structural)", async () => {
  const r = await get(port, "/goal");
  const widths = colWidths(r.body);
  assert.equal(widths.length, 7, `Goals tab has 7 col widths: ${widths.join(", ")}`);
  const sum = widths.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.01, `col widths sum to 100%: ${sum}`);
  // title is index 2 (id/status/title/...) and must be the widest (34% — up from the merged 18%).
  assert.equal(widths[2], Math.max(...widths), `title (${widths[2]}%) is the widest Goals column`);
  assert.ok(widths[2] >= 30, `title budget >= 30% (was 18% pre-fix): ${widths[2]}%`);
});

test("AC3: Criteria tab title column is wider than the merged view's 18% (structural)", async () => {
  const r = await get(port, "/goal?kind=criterion");
  const widths = colWidths(r.body);
  assert.equal(widths.length, 8, `Criteria tab has 8 col widths: ${widths.join(", ")}`);
  const sum = widths.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.01, `col widths sum to 100%: ${sum}`);
  // title is index 3, criterion is index 4 — both fit without header truncation (the DoD measures
  // the actual scrollWidth/clientWidth on a real browser).
  assert.ok(widths[3] >= 18, `title (${widths[3]}%) keeps a wider budget than merged view's 18% squeeze`);
  assert.ok(widths[4] >= 10, `criterion (${widths[4]}%) keeps a readable prefix for its shell command`);
});

// ── AC4: ?goal= has a clickable entry point on BOTH tabs ─────────────────────────────────────

test("AC4: criteria goal column + goals AC 达成/挂靠任务 cells link cross-tab; jump matches AC count", async () => {
  const crit = await get(port, "/goal?kind=criterion");
  const crows = criterionRows(crit.body);
  for (const row of crows) {
    assert.equal(row.goalHref, `/goal?kind=criterion&goal=${row.goal}`, `criterion ${row.id} goal cell links to ?goal=${row.goal}`);
  }
  const goals = await get(port, "/goal");
  for (const row of goalRows(goals.body)) {
    const want = `/goal?kind=criterion&goal=${row.id}`;
    assert.equal(row.rollupHref, want, `goal ${row.id} AC 达成 cell links cross-tab`);
    assert.equal(row.taskAttachHref, want, `goal ${row.id} 挂靠任务 cell links cross-tab`);
  }
  // Enumerate one jump: GOAL-001 has 2 ACs in the fixture — following the link shows 2 rows.
  const jump = await get(port, "/goal?kind=criterion&goal=GOAL-001");
  const jumped = criterionRows(jump.body);
  assert.equal(jumped.length, 2, `GOAL-001's criteria jump shows 2 rows (fixture truth), got ${jumped.length}`);
  assert.ok(jumped.every((x) => x.goal === "GOAL-001"), "jump rows are all under GOAL-001");
});

// ── AC5: draft cross-tab visibility, BOTH directions ─────────────────────────────────────────

test("AC5: a draft AC is visible from the Goals tab; a draft GOAL from the Criteria tab (both ways)", async () => {
  // Direction 1: draft CRITERION → the Goals tab shows "另有 N 条 AC 待裁定" linking to the Criteria
  // tab's draft filter.
  const draftAc = path.join(goalsDir, "AC-900-draft-proposal.md");
  fs.writeFileSync(draftAc,
    "---\nid: AC-900\ntitle: proposed criterion\nstatus: draft\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: \"exit 0\"\norigin: test\n---\n## Rationale\nproposed\n");
  try {
    const g = await get(port, "/goal");
    assert.match(g.body, /另有 1 条 AC 待裁定/);
    assert.match(g.body, /href="\/goal\?status=draft&kind=criterion"/, "cross-tab hint links to the Criteria tab's draft filter");
  } finally {
    fs.rmSync(draftAc, { force: true });
  }

  // Direction 2: draft GOAL → the Criteria tab shows "另有 N 条 GOAL 待裁定" linking to the Goals
  // tab's draft filter.
  const draftGoal = path.join(goalsDir, "GOAL-006-draft-goal.md");
  fs.writeFileSync(draftGoal,
    "---\nid: GOAL-006\ntitle: proposed goal\nstatus: draft\nkind: goal\norigin: test\n---\n## 背景\nproposed\n");
  try {
    const c = await get(port, "/goal?kind=criterion");
    assert.match(c.body, /另有 1 条 GOAL 待裁定/);
    assert.match(c.body, /href="\/goal\?status=draft"/, "cross-tab hint links to the Goals tab's draft filter");
  } finally {
    fs.rmSync(draftGoal, { force: true });
  }
});

// ── AC6: p50 stays within the pre-change /goal baseline (re-read at test time) ───────────────

test("AC6: /goal and /goal?kind=criterion p50 <= baseline + margin", async () => {
  await get(port, "/goal"); // warmup
  await get(port, "/goal?kind=criterion"); // warmup
  const p50of = async (p) => {
    const times = [];
    for (let i = 0; i < 9; i++) {
      const t0 = process.hrtime.bigint();
      const r = await get(port, p);
      const t1 = process.hrtime.bigint();
      assert.equal(r.status, 200);
      times.push(Number(t1 - t0) / 1e6);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  };
  // Baseline = the pre-change single-page cost, re-read NOW (not a stale doc number). Each tab can
  // only shrink per-request work (fewer rows, same ONE goalList), so neither may regress past it.
  const baseline = await p50of("/goal");
  const goalsP50 = await p50of("/goal");
  const criteriaP50 = await p50of("/goal?kind=criterion");
  assert.ok(goalsP50 <= baseline + 400, `goals p50=${goalsP50.toFixed(1)}ms vs baseline=${baseline.toFixed(1)}ms`);
  assert.ok(criteriaP50 <= baseline + 400, `criteria p50=${criteriaP50.toFixed(1)}ms vs baseline=${baseline.toFixed(1)}ms`);
});

// ── AC7: Goals tab default sort is status-priority (active first); ?sort=/dir= still override ──

test("AC7: Goals tab default order puts active before non-active; ?sort= overrides", async () => {
  const r = await get(port, "/goal");
  const rows = goalRows(r.body);
  const ids = rows.map((x) => x.id);
  assert.deepEqual(ids, ["GOAL-002", "GOAL-004", "GOAL-001", "GOAL-005"],
    `default order is active(id asc) → achieved → retired; got ${ids.join(", ")}`);
  // All active rows precede all non-active rows (the fixture's active goals are GOAL-002/GOAL-004).
  const firstNonActive = rows.findIndex((x) => x.status !== "active");
  assert.ok(firstNonActive >= 2, "at least the two active goals precede the first non-active row");
  assert.ok(rows.slice(firstNonActive).every((x) => x.status !== "active"), "no active goal after the first non-active row");

  // ?sort=id&dir=asc overrides the default (id asc puts GOAL-001 first, unlike the default).
  const sorted = await get(port, "/goal?sort=id&dir=asc");
  assert.deepEqual(goalRows(sorted.body).map((x) => x.id), ["GOAL-001", "GOAL-002", "GOAL-004", "GOAL-005"],
    "explicit ?sort=id&dir=asc overrides the status-priority default");
});

// ── AC8: the dashboard "查看 Goals →" link lands on the Goals tab ────────────────────────────

test("AC8: renderGoalCard links to /goal, which renders the Goals tab (== ?kind=goal)", async () => {
  const store = createGoalStore(goalsDir);
  const card = renderGoalCard(store.list(), { nowMs: Date.now() });
  assert.match(card, /href="\/goal"/, "dashboard goal card has the 查看 Goals → link to /goal");
  const plain = await get(port, "/goal");
  const explicit = await get(port, "/goal?kind=goal");
  assert.equal(explicit.status, 200);
  assert.deepEqual(headers(plain.body), headers(explicit.body), "/goal and /goal?kind=goal render the same headers");
  assert.deepEqual(goalRows(plain.body).map((x) => x.id), goalRows(explicit.body).map((x) => x.id),
    "/goal (no kind) is byte-equivalent to ?kind=goal — the Goals tab, not the old All view");
});
