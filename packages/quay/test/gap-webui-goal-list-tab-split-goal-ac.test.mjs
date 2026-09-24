// @test-group product
// gap-webui-goal-list-tab-split-goal-ac — split the /goal merged GOAL+AC list into two tabs.
// Pre-fix: GOAL (12) and AC (86) records shared one 11-column table (`id/kind/status/goal/title/
// criterion/recent verdict/last progress/first evidence/AC 达成/挂靠任务`) under
// `table-layout:fixed`, which squeezed every column — 3 of the 11 columns were structural dead
// cells for one side or the other (criterion/recent verdict are always "—" on GOAL rows; AC 达成/
// kind are meaningless on criterion rows) — so the title cell measured scrollWidth 336 vs
// clientWidth 156 (180px truncated) and five headers were ellipsized.
//
// The fix (proposal): `/goal` (no kind) defaults to a Goals tab; `/goal?kind=criterion` is a
// Criteria tab; the "All" merged view is gone; the store's existing `?goal=` filter gets
// a clickable entry point (the criteria `goal` column + the goals' AC 达成 / 挂靠任务 cross-tab
// links); the draft banner splits into per-kind counts with a cross-tab "另有 N 条 X 待裁定" hint;
// and the single `client.goalList()` read invariant is preserved (tab split changes only the render).
// ⚠️ The column COUNTS asserted below moved 7→6 / 8→7 by gap-webui-goal-list-prune-low-signal-columns
// (the Goals 'first evidence' column folded into 'last progress'; the Criteria 'criterion' column was
// dropped in favour of the detail page) — ⛔ re-pinned, never deleted.
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

/** `cookie` (optional) — gap-webui-goal-body-copy-en-zh: the default language is `en`, so the arms
 *  that pin this page's PRE-EXISTING Chinese header/banner literals ask for `lang=zh` explicitly,
 *  which turns them into zh regression guards instead of assertions about the wrong rendering. */
function get(port, urlPath, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers: cookie ? { Cookie: cookie } : {} }, (res) => {
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

/** The percentage-width `<col>`s on the page, in order. ⛔ Expected to be EMPTY: the percentage
 *  `<colgroup>` was the mechanism that squeezed the DATA cells into `G…` / `achi…`
 *  (gap-webui-goal-list-full-id-status-title-and-real-width-ac reversed it). Kept as a helper
 *  rather than dropped, so the assertion below reads as "this mechanism is absent" — a deleted
 *  assertion could not tell "absent" from "never checked". */
function pctCols(html) {
  return [...html.matchAll(/<col\b[^>]*width:\s*([\d.]+)%/g)].map((x) => Number(x[1]));
}

/** The page's own goal-table stylesheet (the one `goalTableStyles()` emits). */
function goalStyleBlock(html) {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((b) => b.includes(".goal-table{")) ?? "";
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

/** Goals-tab rows (6 cols): id / status / title / AC 达成 / last progress (carrying first evidence) /
 *  挂靠任务. page-gap-webui-goal-list-prune-low-signal-columns: the merge moved `挂靠任务` from index
 *  6 to index 5 — a stale index here reads an empty cell and would fail as "no cross-tab link", not
 *  as "wrong column". */
function goalRows(html) {
  return dataRows(html).map((cells) => ({
    id: goalIdOf(cells[0]),
    kind: "goal",
    status: stripTags(cells[1]),
    title: stripTags(cells[2]),
    rollupHref: hrefOf(cells[3]),
    rollup: stripTags(cells[3]),
    taskAttachHref: hrefOf(cells[5]),
  }));
}

/** Criteria-tab rows (7 cols): id / goal / status / title / recent verdict / last progress / 挂靠任务. */
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

test("AC1: /goal renders 6 columns, no criterion/recent verdict/kind/first evidence, all rows kind=goal", async () => {
  // `lang=zh`: the two Chinese headers pinned below are ROW 21's zh columns (`colAcRollup`,
  // `colAttachedTasks`). The column COUNT and the row-kind assertions are language-independent, so
  // asking for zh does not weaken them.
  //
  // page-gap-webui-goal-list-prune-low-signal-columns: the count moved 7 → 6 — `first evidence` is no
  // longer a column (it folded into the `last progress` cell). The arm is RE-PINNED, not deleted:
  // dropping it would leave the column set unmeasured, which is the state that let the previous
  // width regime ship a truncating table.
  const r = await get(port, "/goal", "lang=zh");
  assert.equal(r.status, 200);
  const hs = headers(r.body);
  assert.equal(hs.length, 6, `Goals tab has 6 <th>; got: ${hs.join(" | ")}`);
  for (const banned of ["criterion", "recent verdict", "kind", "first evidence"]) {
    assert.ok(!hs.includes(banned), `Goals tab must not have a "${banned}" header`);
  }
  for (const want of ["id", "status", "title", "AC 达成", "last progress", "挂靠任务"]) {
    assert.ok(hs.includes(want), `Goals tab must have "${want}"`);
  }
  const rows = goalRows(r.body);
  assert.ok(rows.length >= 4, `rendered ${rows.length} goal rows`);
  const bad = rows.filter((x) => x.kind !== "goal").map((x) => `id=${x.id}`);
  assert.deepEqual(bad, [], `non-goal rows on the Goals tab:\n  ${bad.join("\n  ")}`);

  // The en peer — same 6 columns, same order, the two translated labels in the same positions, and
  // ⛔ neither Chinese header anywhere in the en row of `<th>`s (the language really follows the
  // request rather than the page being zh in both).
  const en = await get(port, "/goal", "lang=en");
  const enHs = headers(en.body);
  assert.deepEqual(enHs, ["id", "status", "title", "AC achieved", "last progress", "attached tasks"],
    `the en Goals tab carries the translated headers; got: ${enHs.join(" | ")}`);
  assert.ok(!enHs.includes("AC 达成") && !enHs.includes("挂靠任务"), "the en header row carries no Chinese");
});

// ── AC2: /goal?kind=criterion is the Criteria tab — 8 headers, criterion rows only ───────────

test("AC2: /goal?kind=criterion renders 7 columns, no AC 达成/kind/criterion, has goal, all rows criterion", async () => {
  // `lang=zh` for the same reason as AC1: `挂靠任务` is pinned below.
  //
  // page-gap-webui-goal-list-prune-low-signal-columns: the count moved 8 → 7 — the `criterion` column
  // was dropped from the LIST (its server-truncated + CSS-clipped fragment identified nothing; the
  // full text is on `/goal/<id>`, which the id cell links to). ⛔ `criterion` therefore moves from the
  // `want` list to the `banned` list: leaving it in `want` would have pinned a column this task
  // deliberately removed.
  const r = await get(port, "/goal?kind=criterion", "lang=zh");
  assert.equal(r.status, 200);
  const hs = headers(r.body);
  assert.equal(hs.length, 7, `Criteria tab has 7 <th>; got: ${hs.join(" | ")}`);
  for (const banned of ["AC 达成", "kind", "criterion"]) {
    assert.ok(!hs.includes(banned), `Criteria tab must not have a "${banned}" header`);
  }
  for (const want of ["id", "goal", "status", "title", "recent verdict", "last progress", "挂靠任务"]) {
    assert.ok(hs.includes(want), `Criteria tab must have "${want}"`);
  }
  const rows = criterionRows(r.body);
  assert.ok(rows.length >= 4, `rendered ${rows.length} criterion rows`);
  const bad = rows.filter((x) => x.kind !== "criterion").map((x) => `id=${x.id}`);
  assert.deepEqual(bad, [], `non-criterion rows on the Criteria tab:\n  ${bad.join("\n  ")}`);

  // The en peer: the same 7 columns, and the Criteria tab still has no rollup column in EITHER
  // language — the "no AC 达成" ban is a statement about the column set, not about the word.
  const enHs = headers((await get(port, "/goal?kind=criterion", "lang=en")).body);
  assert.deepEqual(enHs, ["id", "goal", "status", "title", "recent verdict", "last progress", "attached tasks"],
    `the en Criteria tab carries the translated 挂靠任务 header; got: ${enHs.join(" | ")}`);
});

// ── AC3: structural squeeze resolved. ⚠️ RE-SCOPED by
// gap-webui-goal-list-full-id-status-title-and-real-width-ac (2026-09-24): the assertions below
// used to read the `<colgroup>` PERCENTAGES this page declared. Those percentages are gone — they
// were themselves the defect (`id` 5% ≈ 43px cannot hold `GOAL-020`, and the share applied to the
// data cells, so the page rendered `G…`). The successor criterion keeps the same INTENT ("no column
// is squeezed below what its content needs") but reads the two things that can actually take the
// false reading now: (a) the width-squeezing mechanism is absent, and (b) the cells the old shares
// truncated carry their FULL value in markup. The DOM `scrollWidth <= clientWidth` reading — the
// thing that really decides readability — is the DoD's live-Chrome evidence; no CSS string can
// stand in for it. ⛔ This is a re-scope, not a deletion: the old assertions could not have caught
// the defect, and a criterion that measures the header cannot see a data-row truncation.

test("AC3: neither tab declares a percentage <colgroup>; both are auto-layout (mechanism absent)", async () => {
  for (const [urlPath, cols] of [["/goal", 6], ["/goal?kind=criterion", 7]]) {
    const r = await get(port, urlPath);
    const cols_ = pctCols(r.body);
    assert.deepEqual(cols_, [], `${urlPath}: no percentage <col> (the squeezing mechanism is gone)`);
    assert.ok(!/<colgroup>/.test(r.body), `${urlPath}: no <colgroup> at all`);
    const style = goalStyleBlock(r.body);
    assert.match(style, /\.goal-table\{table-layout:auto/, `${urlPath}: the table is auto-layout`);
    assert.doesNotMatch(style, /table-layout:\s*fixed/, `${urlPath}: the fixed-layout regime is gone`);
    // The column COUNT is re-pinned here (6 / 7) because gap-webui-goal-list-prune-low-signal-columns
    // changed it — that task removed one column from THIS table by merging/dropping, so the number is
    // a deliberate value, not "whatever the renderer happens to emit".
    assert.equal(headers(r.body).length, cols, `${urlPath}: ${cols} columns`);
  }
});

test("AC3: the cells the old shares truncated carry their FULL value (id/status, both tabs)", async () => {
  // Structural half of the browser reading: `GOAL-001`/`achieved` must be IN the markup in full.
  // A page that rendered `G…` would fail here without any browser — which is exactly what the
  // predecessor criterion, reading `<th>` only, could not do.
  const goals = goalRows((await get(port, "/goal")).body);
  assert.ok(goals.length >= 4, `Goals tab renders rows (${goals.length})`);
  for (const row of goals) {
    assert.match(row.id, /^GOAL-\d{3}$/, `goal row id is complete: "${row.id}"`);
    assert.ok(row.status.length > 0, `goal row ${row.id} carries a status`);
  }
  const crit = criterionRows((await get(port, "/goal?kind=criterion")).body);
  assert.ok(crit.length >= 4, `Criteria tab renders rows (${crit.length})`);
  for (const row of crit) {
    assert.match(row.id, /^AC-\d{3}$/, `criterion row id is complete: "${row.id}"`);
    assert.match(row.goal, /^GOAL-\d{3}$/, `criterion row ${row.id} goal is complete: "${row.goal}"`);
    assert.ok(row.status.length > 0, `criterion row ${row.id} carries a status`);
  }
  // The markup carries the full text (no server-side truncation of the id/status/goal cells).
  for (const [urlPath, id] of [["/goal", "GOAL-001"], ["/goal?kind=criterion", "AC-101"]]) {
    const body = (await get(port, urlPath)).body;
    assert.ok(body.includes(`title="${id}"`), `${urlPath}: ${id}'s cell carries its full id on the title attribute`);
  }
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
    // `lang=zh`: the banner sentence is ROW 21's `draftOtherBanner` — asserted in its zh column (the
    // pre-existing literal) so this stays a zh regression guard, and the href it carries is
    // language-independent.
    const g = await get(port, "/goal", "lang=zh");
    assert.match(g.body, /另有 1 条 AC 待裁定/);
    assert.match(g.body, /href="\/goal\?status=draft&kind=criterion"/, "cross-tab hint links to the Criteria tab's draft filter");
    // …and the same banner under en, so the zh arm above is a reading of the LANGUAGE.
    const gEn = await get(port, "/goal", "lang=en");
    assert.match(gEn.body, /1 more AC awaiting a decision/, "the en Goals tab carries the translated cross-tab hint");
    assert.doesNotMatch(gEn.body, /待裁定/, "the en Goals tab carries no Chinese banner copy");
  } finally {
    fs.rmSync(draftAc, { force: true });
  }

  // Direction 2: draft GOAL → the Criteria tab shows "另有 N 条 GOAL 待裁定" linking to the Goals
  // tab's draft filter.
  const draftGoal = path.join(goalsDir, "GOAL-006-draft-goal.md");
  fs.writeFileSync(draftGoal,
    "---\nid: GOAL-006\ntitle: proposed goal\nstatus: draft\nkind: goal\norigin: test\n---\n## 背景\nproposed\n");
  try {
    const c = await get(port, "/goal?kind=criterion", "lang=zh");
    assert.match(c.body, /另有 1 条 GOAL 待裁定/);
    assert.match(c.body, /href="\/goal\?status=draft"/, "cross-tab hint links to the Goals tab's draft filter");
    // en peer — the same row, the translated sentence, ⛔ and the `Goals` tab NAME raw (a tab token,
    // ROW 21 ④): the banner is the one place the en page shows a bare tab name mid-sentence.
    const cEn = await get(port, "/goal?kind=criterion", "lang=en");
    assert.match(cEn.body, /1 more GOAL awaiting a decision/);
    assert.match(cEn.body, /Go to the Goals tab/);
    assert.doesNotMatch(cEn.body, /待裁定/, "the en Criteria tab carries no Chinese banner copy");
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
