// @test-group product
// gap-webui-goal-list-full-id-status-title-and-real-width-ac — the /goal list must show the FULL
// id and status, not `G…` / `achi…`, and must use the page's real width.
//
// Measured defect (production /goal, headless Chrome at 1440px AND 900px, 2026-09-24): the Goals
// tab rendered id `G…`, status `achi…`, title single-line truncated; the Criteria tab rendered `A…`
// and goal `GO…`. At the same moment /tasks (auto layout) was fully readable.
//
// Root cause, read from source rather than inferred: `GOAL_COL_WIDTHS` / `CRITERIA_COL_WIDTHS` gave
// `id` 5% (≈43px; `GOAL-020` needs ≈75px) and `status` 9% (≈78px; `achieved`/`superseded` need
// ≈80px); `.goal-table{table-layout:fixed}` applied those shares to the DATA cells; and
// `serve-render.ts`'s `main{max-width:900px}` capped the table at ≈868px on a 1440px screen, so the
// page also wasted ≈280px of gutter per side.
//
// ⛔ The reason the PREVIOUS criterion (AC3 of `gap-webui-goal-list-tab-split-goal-ac`) never went
// red is the point of this file: it measured `<th>` `scrollWidth` only, in one viewport. **A
// criterion that measures the header structurally cannot see a data-row truncation.** This file
// therefore measures the DATA cells — every id/status/goal cell's markup, on BOTH tabs — and the
// browser-level `scrollWidth <= clientWidth` reading (the thing that actually decides "is it
// readable") is the DoD's live-Chrome evidence, because CSS strings are necessary, not sufficient.
//
// What is asserted here (mechanically, forever, without a browser):
//   1. the fixed-layout regime is GONE — `table-layout:fixed` absent, no percentage `<col>`;
//   2. id/status/goal cells are `white-space:nowrap` and ⛔ NOT `text-overflow:ellipsis`;
//   3. every id cell carries `title` = the full id (the hover escape hatch must never be the ONLY
//      way to read it — hence 1 & 2 — but it must exist for the squeezed case);
//   4. the title cell clamps to 2 lines and carries `title` = the full title;
//   5. `/goal` lifts `main` to `min(1400px,96vw)` and ⛔ `/tasks` does not (negative control);
//   6. the table is inside the `overflow-x:auto` shell and the id column is `position:sticky`
//      at ≤900px.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { handleGoalList } from "../src/serve-goal.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

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

/** The page's OWN `<style>` block — the one `goalTableStyles()` emits. Selected by content rather
 *  than by index, because the head carries several `<style>` blocks (modernist + base + this one). */
function goalStyleBlock(html) {
  const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  return blocks.find((b) => b.includes(".goal-table{")) ?? "";
}

/** The CSS rule whose selector list starts with `sel` (e.g. ".goal-table .c-id"). Rules in this
 *  sheet are flat (no nesting), so "up to the first `}`" is the whole declaration block. */
function cssRule(styleBlock, sel) {
  const m = new RegExp(`${sel.replace(/[.[\]()*+?^$\\{}|]/g, "\\$&")}[^{}]*\\{[^}]*\\}`).exec(styleBlock);
  return m ? m[0] : "";
}

/** Data rows of the list table, as raw `<td>` inner HTML (header row excluded). */
function dataRows(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((x) => x[1]).filter((r) => !/<th/.test(r));
}

function cells(rowHtml) {
  return [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[0]);
}

const attr = (cellHtml, name) => (new RegExp(`${name}="([^"]*)"`).exec(cellHtml) || [])[1];
const textOf = (cellHtml) => cellHtml.replace(/<[^>]*>/g, "").trim();
const hrefOf = (cellHtml) => (/href="([^"]+)"/.exec(cellHtml) || [])[1] || "";

/** Rows of the two tabs, projected to the fields this file judges. `tab` picks the column map:
 *  Goal      (7 cols): id / status / title / AC 达成 / last progress / first evidence / 挂靠任务
 *  Criterion (8 cols): id / goal / status / title / criterion / recent verdict / last progress / 挂靠任务 */
function rowsOf(html, tab) {
  return dataRows(html).map((r) => {
    const c = cells(r);
    if (tab === "goal") {
      return { cellId: c[0], cellStatus: c[1], cellTitle: c[2], id: textOf(c[0]), status: textOf(c[1]), title: textOf(c[2]) };
    }
    return { cellId: c[0], cellGoal: c[1], cellStatus: c[2], cellTitle: c[3], id: textOf(c[0]), goal: textOf(c[1]), status: textOf(c[2]), title: textOf(c[3]) };
  });
}

// ── fixture ──────────────────────────────────────────────────────────────────────────────────
// Ids and statuses are REALISTIC (8-char ids, `superseded`/`achieved` statuses, a title long enough
// to need more than two lines at any sane column width) — a fixture of short ids would pass under
// the old regime too, i.e. it would not be able to take the false reading this file exists for.

let server, port, originalCwd, workspaceRoot, goalsDir;

/** The goal records, written by `before`; also re-read by the assertions below so the test judges
 *  the RENDERED page against the same source of truth the renderer read. */
const GOALS = [
  { id: "GOAL-020", title: "阶段目标二十：把 /goal 列表的 id 与标题完整呈现给读者，并让窄屏也能横向滚动", status: "superseded", kind: "goal" },
  { id: "GOAL-003", title: "active goal", status: "active", kind: "goal" },
];
const ACS = [
  { id: "AC-156", title: "criterion AC-156 with a long title that must clamp to two lines", status: "achieved", kind: "criterion", goal: "GOAL-020", criterion: "grep -c 'text-overflow:ellipsis' packages/quay/src/serve-goal.ts" },
  { id: "AC-161", title: "criterion AC-161", status: "superseded", kind: "criterion", goal: "GOAL-003", criterion: "exit 0" },
];

before(async () => {
  const tasksDir = makeTmpDir("goal-fullid-tasks-");
  const adrDir = makeTmpDir("goal-fullid-adr-");
  workspaceRoot = makeTmpDir("goal-fullid-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  for (const g of GOALS) {
    fs.writeFileSync(path.join(goalsDir, `${g.id}-goal.md`),
      `---\nid: ${g.id}\ntitle: ${g.title}\nstatus: ${g.status}\nkind: goal\norigin: test\n---\n## 背景\nmeasured\n`);
  }
  for (const a of ACS) {
    fs.writeFileSync(path.join(goalsDir, `${a.id}-criterion.md`),
      `---\nid: ${a.id}\ntitle: ${a.title}\nstatus: ${a.status}\nkind: criterion\ngoal: ${a.goal}\ncriterion: ${a.criterion}\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);
  }

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

// ── AC1: the rendered markup — every id cell carries its full id ──────────────────────────────

test("AC1: both tabs — every id cell has title = the full id, and id/status markup is not lossy", async () => {
  for (const [urlPath, tab] of [["/goal", "goal"], ["/goal?kind=criterion", "criterion"]]) {
    const r = await get(port, urlPath);
    assert.equal(r.status, 200, `${urlPath} returns 200`);
    const rows = rowsOf(r.body, tab);
    assert.ok(rows.length >= 1, `${urlPath}: at least one data row (got ${rows.length})`);

    // 硬规则 2: print the first 3 rows' ACTUAL content before quoting any count — a count whose
    // matches were never looked at cannot tell "the thing I want" from "a string that mentions it".
    console.log(`[${urlPath}] first 3 data rows (id cell / status cell):`);
    for (const row of rows.slice(0, 3)) {
      console.log(`  ${row.cellId}  |  ${row.cellStatus}`);
    }

    // Every id cell: `title` present, equal to the LINK TEXT, equal to the href's last segment.
    const badTitle = rows.filter((x) => attr(x.cellId, "title") !== x.id).map((x) => `id=${x.id} title=${attr(x.cellId, "title")}`);
    assert.deepEqual(badTitle, [], `${urlPath}: every id cell's title must equal the full id:\n  ${badTitle.join("\n  ")}`);

    const badLink = rows.filter((x) => textOf(x.cellId) !== x.id || !hrefOf(x.cellId).endsWith(encodeURIComponent(x.id)))
      .map((x) => `id=${x.id} linkText=${textOf(x.cellId)} href=${hrefOf(x.cellId)}`);
    assert.deepEqual(badLink, [], `${urlPath}: the id link text/href must carry the full id:\n  ${badLink.join("\n  ")}`);

    // The ids really are the store's ids (a fixture whose ids were already short could not have
    // produced the truncation this task fixes — assert the source of truth, not just self-consistency).
    const sourceIds = (tab === "goal" ? GOALS : ACS).map((x) => x.id).sort();
    assert.deepEqual(rows.map((x) => x.id).sort(), sourceIds, `${urlPath}: rendered ids == the fixture's ids`);

    // The statuses that the old 9% share could not hold must appear IN FULL in the markup.
    const statuses = rows.map((x) => x.status);
    assert.ok(statuses.includes(tab === "goal" ? "superseded" : "superseded"),
      `${urlPath}: a 'superseded' status renders in full; got ${statuses.join(", ")}`);
  }
});

// ── AC1 (CSS regime): fixed layout and percentage <col> are gone ──────────────────────────────

test("AC1: no table-layout:fixed and no percentage <col> on either tab", async () => {
  for (const urlPath of ["/goal", "/goal?kind=criterion"]) {
    const r = await get(port, urlPath);
    const style = goalStyleBlock(r.body);
    assert.ok(style.length > 0, `${urlPath}: the goal table's own <style> block is present`);
    assert.doesNotMatch(style, /table-layout:\s*fixed/, `${urlPath}: the fixed-layout regime is gone`);
    assert.match(style, /\.goal-table\{table-layout:auto/, `${urlPath}: the table is auto-layout`);
    // The percentage <colgroup> was the mechanism that squeezed the DATA cells; a page carrying a
    // percentage <col> would reintroduce it no matter what the stylesheet says.
    const pctCols = [...r.body.matchAll(/<col\b[^>]*width:\s*[\d.]+%/g)].map((m) => m[0]);
    assert.deepEqual(pctCols, [], `${urlPath}: the page carries no percentage-width <col>:\n  ${pctCols.join("\n  ")}`);
    assert.doesNotMatch(r.body, /<colgroup>/, `${urlPath}: no <colgroup> at all`);
  }
});

test("AC1: id/status/goal cells are nowrap and ⛔ never ellipsized; the sheet has no text-overflow", async () => {
  const r = await get(port, "/goal?kind=criterion");
  const style = goalStyleBlock(r.body);
  // `goal` only exists on the Criteria tab; `id`/`status` on both — assert all three here and the
  // shared ones are then covered for the Goals tab by the same rule text.
  for (const sel of [".goal-table .c-id", ".goal-table .c-status", ".goal-table .c-goal"]) {
    const rule = cssRule(style, sel);
    assert.ok(rule.length > 0, `${sel} has a rule`);
    assert.match(rule, /white-space:\s*nowrap/, `${sel}: nowrap`);
    assert.doesNotMatch(rule, /text-overflow/, `${sel}: must NOT ellipsize`);
  }
  // ⛔ The stronger, sheet-wide statement: NOTHING in this page's own table stylesheet ellipsizes.
  // A per-selector check alone would pass on a sheet that ellipsized via some OTHER selector that
  // happens to match the same cells (e.g. `.goal-table td`), which is exactly the old regime's shape.
  assert.doesNotMatch(style, /text-overflow/, "the goal table stylesheet contains no text-overflow at all");
});

// ── AC2: title clamps to two lines, full title on the attribute ───────────────────────────────

test("AC2: title cell clamps to 2 lines and carries the full title; wide main is /goal-only", async () => {
  for (const [urlPath, tab] of [["/goal", "goal"], ["/goal?kind=criterion", "criterion"]]) {
    const r = await get(port, urlPath);
    const style = goalStyleBlock(r.body);
    // ⚠️ The clamp is on the title cell's CONTENT element, not on the `<td>` — a table cell that
    // carries `display:-webkit-box` loses `table-cell` and Chrome wraps it in an anonymous
    // table-cell, which on this page left a third line painted outside the two-line box (measured
    // in headless Chrome). So the criterion ("the title cell clamps to 2 lines") is judged on the
    // cell's content box: the `<td class="c-title">` must CONTAIN an element carrying the clamp.
    const rule = cssRule(style, ".goal-table .c-title>.c-title-text");
    assert.match(rule, /-webkit-line-clamp:\s*2/, `${urlPath}: the title cell clamps to 2 lines`);
    assert.match(rule, /-webkit-box-orient:\s*vertical/, `${urlPath}: the clamp is vertical`);
    assert.match(cssRule(style, ".goal-table .c-title"), /white-space:\s*normal/,
      `${urlPath}: the title cell itself may wrap`);

    const rows = rowsOf(r.body, tab);
    assert.ok(rows.length >= 1, `${urlPath}: at least one title cell to judge`);
    const bad = rows.filter((x) => attr(x.cellTitle, "title") !== x.title || x.title === "")
      .map((x) => `title="${attr(x.cellTitle, "title")}" cellText="${x.title}"`);
    assert.deepEqual(bad, [], `${urlPath}: every title cell's title attribute == the full title:\n  ${bad.join("\n  ")}`);
    // …and the clamped content really is inside an element the rule matches (a rule with no
    // matching element in the markup would be a stylesheet that clamps nothing).
    assert.match(r.body, /<td class="c-title" title="[^"]*"><span class="c-title-text">/,
      `${urlPath}: the title cell wraps its content in the clamped element`);
  }

  // The long-title fixture really is long enough to clamp (>= 2 lines at any plausible width) — a
  // fixture of short titles would make the clamp assertions above vacuous.
  const longest = GOALS.map((g) => g.title).concat(ACS.map((a) => a.title)).sort((a, b) => b.length - a.length)[0];
  assert.ok(longest.length > 40, `the fixture carries a title long enough to need clamping (${longest.length} chars)`);
});

test("AC2 (negative control): /goal widens main; /tasks keeps the 900px base width", async () => {
  const goal = await get(port, "/goal");
  assert.match(goalStyleBlock(goal.body), /main\{max-width:min\(1400px,96vw\)\}/,
    "/goal's own stylesheet lifts main to min(1400px,96vw)");

  const tasks = await get(port, "/tasks");
  assert.equal(tasks.status, 200, "/tasks returns 200 (the negative control is a real page, not a 404)");
  assert.doesNotMatch(tasks.body, /min\(1400px,96vw\)/, "/tasks must NOT carry the widened-main rule");
  assert.match(tasks.body, /max-width:\s*900px/, "/tasks still renders through the 900px base rule");
});

// ── AC3: the scroll shell + the sticky id column at ≤900px ────────────────────────────────────

test("AC3: the goal table scrolls inside .table-wrap and the id column is sticky at ≤900px", async () => {
  for (const urlPath of ["/goal", "/goal?kind=criterion"]) {
    const r = await get(port, urlPath);
    // The table sits INSIDE the shared scroll shell, and the shell really carries overflow-x:auto
    // (the rule lives in the base sheet, so assert it on the page rather than re-deriving it).
    assert.match(r.body, /<div class="table-wrap">\s*<table class="goal-table">/,
      `${urlPath}: the goal table is wrapped by the .table-wrap scroll container`);
    assert.match(r.body, /\.table-wrap\s*\{[^}]*overflow-x:\s*auto/,
      `${urlPath}: .table-wrap carries overflow-x:auto`);

    const style = goalStyleBlock(r.body);
    // Group 1 = the media block's BODY, with its closing `}` kept so each inner rule is complete
    // (a body sliced without it would make `cssRule` unable to see the declaration block at all).
    const media = /@media\s*\(max-width:\s*900px\)\s*\{([\s\S]*?\})\s*\}/.exec(style);
    assert.ok(media, `${urlPath}: a @media (max-width:900px) block is present in the goal stylesheet`);
    const sticky = cssRule(media[1], ".goal-table .c-id");
    assert.match(sticky, /position:\s*sticky/, `${urlPath}: the id column is sticky at ≤900px`);
    assert.match(sticky, /left:\s*0/, `${urlPath}: the id column sticks to the container's left edge`);
    assert.match(sticky, /background:/, `${urlPath}: the sticky cell is opaque (else scrolled cells show through)`);
    // ⚠️ `position:sticky` ALONE IS INERT HERE — and asserting only the declaration would be the
    // 4b trap (a proxy that reads "fine" while nothing happens). The base sheet's `table{overflow:
    // hidden}` makes the table its own cells' nearest scroll container, so the cell would resolve
    // against a container that never scrolls. Measured: the declaration without `overflow:visible`
    // left the cell at `left:-266` under `scrollLeft=300`. So the exemption is part of the
    // criterion, not an implementation detail.
    assert.match(cssRule(media[1], ".goal-table"), /overflow:\s*visible/,
      `${urlPath}: the table must opt out of the base sheet's overflow:hidden, else the sticky cell is inert`);
  }
});

// ── the direct-handler shape (the unit-level entry point) sees the same regime ────────────────

test("the direct handleGoalList call renders the same regime (no server, legacy cfg shape)", async () => {
  const client = {
    goalList: async () => [
      { id: "GOAL-020", title: "a long goal title that will not fit on one line at any sane width", status: "superseded", kind: "goal", goal: "", criterion: "", lastProgressAt: "", firstEvidenceAt: "", evidence: null, body: "" },
    ],
    taskList: async () => ({ tasks: [], malformed: [] }),
  };
  const res = captureRes();
  await handleGoalList({}, res, new URL("http://localhost/goal"), client, "ws");
  assert.equal(res.statusCode, 200);
  const rows = rowsOf(res.body, "goal");
  assert.equal(rows.length, 1);
  assert.equal(attr(rows[0].cellId, "title"), "GOAL-020", "the full id is on the id cell's title attribute");
  assert.equal(rows[0].id, "GOAL-020", "the id cell's link text is the full id");
  assert.equal(rows[0].status, "superseded", "the full status renders");
  assert.doesNotMatch(goalStyleBlock(res.body), /table-layout:\s*fixed/);
});
