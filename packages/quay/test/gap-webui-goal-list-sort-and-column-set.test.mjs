// @test-group product
// gap-webui-goal-list-sort-and-column-set — the /goal list page's column set, sort, and read path.
// Pre-fix defects (all measured by the task's Proposal): the 8-column table carried a whole-prose
// `origin` column (median 191 / max 2775 chars) that blew row height to 109–156px and table width to
// 1538px vs an 870px <main>; the one chronologically meaningful quantity (`lastProgressAt`, already
// derived for the fresh/stale badge) was never rendered; sort was hard-coded to id-locale in the
// store with no display entry point; `?goal=` reached the store but was dropped in the handler; and
// the handler made TWO `goalList` calls (filtered + draft) that could collapse to one unfiltered
// read with the AC rollup derived in memory.
//
// The fix: ONE unfiltered `client.goalList()`, then status/kind/goal filtering, draft counting, and
// the AC rollup are all derived in memory; `origin` leaves the list (detail keeps it in its own
// block); two ledger-derived time columns (lastProgressAt / firstEvidenceAt, NEVER mtime) join the
// list and the detail page; sort moves to the handler (?sort=<col>&dir=); the goal column links to
// ?goal=<id>.
//
// gap-webui-goal-list-tab-split-goal-ac (follow-up, NOT a duplicate): the merged GOAL+AC view was
// then split into two tabs — `/goal` (default) = Goals tab (7 cols, goal rows only) and
// `/goal?kind=criterion` = Criteria tab (8 cols, criterion rows only; `firstEvidenceAt` left the
// criteria list — it remains on the detail page). The surviving list assertions below therefore
// target the tab whose rows they concern: criteria-time/sort/goal-filter tests hit
// `?kind=criterion`, goal-rollup/detail-sync tests hit `/goal` (Goals tab). The tab-split invariants
// themselves (column sets, cross-tab links, status-priority default, draft cross-tab banner) live in
// gap-webui-goal-list-tab-split-goal-ac.test.mjs.
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

// A distinctive long origin (> 400 chars) — pre-fix this sat inside a single <p class="meta">
// (measured 1138 chars on /goal/GOAL-008); post-fix it must live outside any p.meta. No `:` in the
// value (an unquoted YAML scalar with `: ` would be parsed as a nested mapping).
const LONG_ORIGIN = "empirical basis for this criterion, recorded at length and in full detail across many sentences. ".repeat(8);

/** `cookie` (optional) — gap-webui-goal-body-copy-en-zh: the default language is `en`, so every
 *  assertion below that pins a PRE-EXISTING Chinese literal passes `lang=zh` EXPLICITLY and thereby
 *  becomes a zh regression guard (the dashboard series' 决定记录 ④). A negative assertion is the case
 *  that matters most: without the cookie it would be vacuous under `en` (the string is absent for the
 *  wrong reason). */
function get(port, urlPath, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** The content of the LAST <main>…</main> pair (the stylesheet's CSS comment may carry a literal
 *  "<main id=\"main\">" before the real element — the sibling test hit the same shape). */
function mainHtml(html) {
  const opens = [...html.matchAll(/<main\b[^>]*>/g)];
  if (opens.length === 0) return html;
  const start = opens[opens.length - 1].index;
  const end = html.indexOf("</main>", start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

/** Parse a tab's list table into row objects. `tab` selects the column map:
 *   - "goal"      (7 cols): id / status / title / AC rollup / last progress / first evidence / 挂靠任务
 *   - "criterion" (8 cols): id / goal / status / title / criterion / recent verdict / last progress / 挂靠任务
 *  Time cells expose the absolute `title` timestamp (null when the cell is the 未记录 marker). */
function listRows(html, tab) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  const trs = [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((x) => x[1]).filter((r) => !/<th/.test(r));
  const idOf = (cell) => (/href="\/goal\/([^"]+)"/.exec(cell || "") || [])[1] || "";
  const titleOf = (cell) => (/title="([^"]*)"/.exec(cell || "") || [])[1] ?? null;
  return trs.map((r) => {
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (tab === "goal") {
      const rollupM = /(\d+)\/(\d+)/.exec(cells[3] || "");
      return {
        id: idOf(cells[0]),
        kind: "goal",
        status: (cells[1] || "").trim(),
        lastAt: titleOf(cells[4]),
        firstAt: titleOf(cells[5]),
        lastRaw: cells[4] || "",
        firstRaw: cells[5] || "",
        rollup: rollupM ? { achieved: Number(rollupM[1]), total: Number(rollupM[2]) } : null,
      };
    }
    return {
      id: idOf(cells[0]),
      kind: "criterion",
      status: (cells[2] || "").trim(),
      goal: (/href="\/goal\?kind=criterion&goal=([^"]+)"/.exec(cells[1] || "") || [])[1] || "",
      lastAt: titleOf(cells[6]),
      lastRaw: cells[6] || "",
    };
  });
}

/** Independent read of the ledger (chronological append order): last = last line, first = first line. */
function ledgerExtremes(logPath, id) {
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const ts = lines.filter((e) => (e.pipeline_id ?? e.item_id) === id).map((e) => e.timestamp);
  if (ts.length === 0) return { last: null, first: null };
  return { last: ts[ts.length - 1], first: ts[0] };
}

/** renderGoalCard's per-active-goal "AC 达成 N/M", parsed from its HTML (the reference口径). */
function renderGoalCardRollups(records) {
  // gap-webui-dashboard-body-copy-en-zh: pinned to `zh` — this helper exists to be compared
  // against the /goal PAGE's 「AC 达成」 column (serve-goal.ts, still zh in both languages), so the
  // two sides must be rendered in the same language or the comparison measures our own default.
  const html = renderGoalCard(records, { nowMs: Date.now(), lang: "zh" });
  const out = {};
  const re = /href="\/goal\/(GOAL-\d+)"[^>]*>[\s\S]*?AC 达成 (\d+)\/(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) out[m[1]] = { achieved: Number(m[2]), total: Number(m[3]) };
  return out;
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

// ── AC7 (unit): the handler makes ONE unfiltered read — spy, no server ─────────────────────────

test("AC7: handler makes ONE unfiltered goalList call (spy), never goalGet", async () => {
  const calls = { goalList: 0, goalGet: 0 };
  const records = [
    { id: "GOAL-001", title: "g1", status: "active", kind: "goal", body: "" },
    { id: "AC-101", title: "c", status: "achieved", kind: "criterion", goal: "GOAL-001", criterion: "exit 0", body: "" },
  ];
  const client = {
    goalList: async (filter) => { calls.goalList++; assert.equal(filter, undefined, "unfiltered read (no status/kind/goal)"); return records; },
    goalGet: async () => { calls.goalGet++; return records[0]; },
  };
  const res = captureRes();
  await handleGoalList({}, res, new URL("http://localhost/goal"), client);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.goalList, 1, "goalList == 1 (pre-fix was 2)");
  assert.equal(calls.goalGet, 0, "goalGet never called");
});

// ── integration: a real running serve instance ───────────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, goalsDir;

before(async () => {
  const tasksDir = makeTmpDir("goal-list-tasks-");
  const adrDir = makeTmpDir("goal-list-adr-");
  workspaceRoot = makeTmpDir("goal-list-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  const goal = (id, title, origin) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-goal.md`),
      `---\nid: ${id}\ntitle: ${title}\nstatus: active\nkind: goal\norigin: ${origin}\n---\n## 背景\nmeasured\n`);
  const ac = (id, status, goalId) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-criterion.md`),
      `---\nid: ${id}\ntitle: criterion ${id}\nstatus: ${status}\nkind: criterion\ngoal: ${goalId}\ncriterion: exit 0\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);

  goal("GOAL-001", "plugin surface", "test");
  goal("GOAL-002", "store", "test");
  goal("GOAL-008", "commit", LONG_ORIGIN);
  ac("AC-101", "achieved", "GOAL-001");
  ac("AC-102", "active", "GOAL-001");
  ac("AC-103", "achieved", "GOAL-001");
  ac("AC-201", "active", "GOAL-002");
  ac("AC-202", "achieved", "GOAL-002");
  ac("AC-801", "active", "GOAL-008");
  ac("AC-802", "achieved", "GOAL-008");

  // Ledger events (chronological append order): AC-101/102/103 have real multi-event histories
  // (AC2's max/min); AC-201 has one OLD event (AC4's "real timestamp, not 未记录"); AC-801/AC-802
  // have none (AC4's 未记录 side).
  const ev = (id, verdict, timestamp) =>
    JSON.stringify({ id: "e", item_id: id, pipeline_id: id, gate: "goal", actor: "test", verdict, timestamp, payload: { reason: "ok" } });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "gate-events.jsonl"),
    [
      ev("AC-201", "pass", "2020-01-01T00:00:00.000Z"),
      ev("AC-101", "pass", "2026-09-01T10:00:00.000Z"),
      ev("AC-102", "pass", "2026-09-02T08:00:00.000Z"),
      ev("AC-102", "pass", "2026-09-02T09:00:00.000Z"),
      ev("AC-101", "fail", "2026-09-03T12:00:00.000Z"),
      ev("AC-103", "pass", "2026-09-04T00:00:00.000Z"),
    ].join("\n") + "\n");

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

// ── AC1: origin column removed (header + value absent; new columns present) ───────────────────

test("AC1: origin column removed; time + rollup columns present", async () => {
  // `lang=zh`: the 「AC 达成」 header literal is this page's zh column (serve-i18n ROW 21's
  // `colAcRollup`), so pinning it requires asking for zh — under the default `en` the header is
  // 「AC achieved」 and this arm would be testing the wrong rendering.
  const r = await get(port, "/goal", "lang=zh");
  assert.equal(r.status, 200);
  const tableMatch = /<table[^>]*>([\s\S]*?)<\/table>/.exec(r.body);
  assert.ok(tableMatch, "list page has a table");
  const header = tableMatch[1].split("</tr>")[0];
  assert.doesNotMatch(header, /origin/, "no origin column in header");
  assert.match(header, /last progress/, "last progress column present");
  assert.match(header, /first evidence/, "first evidence column present");
  assert.match(header, /AC 达成/, "AC rollup column present");
  assert.doesNotMatch(r.body, /recorded at length and in full detail/, "GOAL-008's long origin prose is not in the list");
  // …and the en peer, so the zh arm above cannot be satisfied by a page that renders zh in both
  // languages (the 5b direction: the header token must actually follow the request's language).
  const en = await get(port, "/goal", "lang=en");
  assert.match(/<table[^>]*>([\s\S]*?)<\/table>/.exec(en.body)[1].split("</tr>")[0], /AC achieved/,
    "the en header carries the translated rollup column");
});

// ── AC2: the two time columns are ledger-derived (max / min) ─────────────────────────────────
// (gap-webui-goal-list-tab-split-goal-ac: the criteria now live on the Criteria tab; `lastProgressAt`
// is its surviving time column — `firstEvidenceAt` left the criteria list but stays on the detail
// page, still derived from the same ledger extremes.)

test("AC2: lastProgressAt == ledger max on the Criteria tab (3 ACs)", async () => {
  const r = await get(port, "/goal?kind=criterion");
  const rows = listRows(r.body, "criterion");
  const logPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  const mismatches = [];
  for (const id of ["AC-101", "AC-102", "AC-103"]) {
    const row = rows.find((x) => x.id === id);
    assert.ok(row, `row for ${id} present`);
    const exp = ledgerExtremes(logPath, id);
    if (row.lastAt !== exp.last) mismatches.push(`(${id}, last=${row.lastAt}, ledger=${exp.last})`);
  }
  assert.deepEqual(mismatches, [], `time-column mismatches:\n  ${mismatches.join("\n  ")}`);
});

// ── AC3: the time columns are NOT mtime (touch negative control) ─────────────────────────────

test("AC3: touch (mtime only) leaves the two time columns byte-identical, while updatedAt changes", async () => {
  const goalFile = path.join(goalsDir, "GOAL-001-goal.md");
  const before = await get(port, "/goal");
  const beforeGoal = listRows(before.body, "goal").find((x) => x.id === "GOAL-001");
  assert.ok(beforeGoal, "GOAL-001 row present pre-touch");
  const mtimeBefore = fs.statSync(goalFile).mtimeMs;
  await new Promise((r) => setTimeout(r, 5));
  fs.utimesSync(goalFile, new Date(), new Date());
  const mtimeAfter = fs.statSync(goalFile).mtimeMs;
  assert.notEqual(mtimeAfter, mtimeBefore, "mtime actually changed (the touch took effect)");
  const after = await get(port, "/goal");
  const afterGoal = listRows(after.body, "goal").find((x) => x.id === "GOAL-001");
  assert.equal(afterGoal.lastAt, beforeGoal.lastAt, "lastProgressAt unchanged by touch (ledger-derived)");
  assert.equal(afterGoal.firstAt, beforeGoal.firstAt, "firstEvidenceAt unchanged by touch (ledger-derived)");
});

// ── AC4: 未记录 is a distinct value; a real (old) timestamp is not the marker ────────────────

test("AC4: no-event → 未记录 (no timestamp, not —); with-event → real timestamp", async () => {
  // `lang=zh` — the marker literal is ROW 21's `notRecorded` zh column; under the default `en` it
  // renders 「not recorded」 and every arm below would be asserting the wrong language (and the
  // negative arm would be vacuous).
  const r = await get(port, "/goal?kind=criterion", "lang=zh");
  const rows = listRows(r.body, "criterion");
  const noEvent = rows.find((x) => x.id === "AC-801");
  assert.ok(noEvent, "AC-801 (no ledger event) present");
  assert.equal(noEvent.lastAt, null, "no-event lastProgressAt carries no timestamp");
  assert.match(noEvent.lastRaw, /未记录/, "last progress cell renders the 未记录 marker");
  assert.doesNotMatch(noEvent.lastRaw, /—/, "the 未记录 marker is not —");
  const oldEvent = rows.find((x) => x.id === "AC-201");
  assert.ok(oldEvent, "AC-201 (old event) present");
  assert.equal(oldEvent.lastAt, "2020-01-01T00:00:00.000Z", "old-event record renders its real timestamp");
  assert.doesNotMatch(oldEvent.lastRaw, /未记录/, "a real timestamp is not the 未记录 marker");
  // The en peer: the same cell switches (and the absent-literal arm above is therefore about the
  // language, not about the marker being gone from the page).
  const en = listRows((await get(port, "/goal?kind=criterion", "lang=en")).body, "criterion");
  assert.match(en.find((x) => x.id === "AC-801").lastRaw, /not recorded/, "the en cell renders the translated marker");
  assert.doesNotMatch(en.find((x) => x.id === "AC-201").lastRaw, /not recorded/, "a real timestamp is not the en marker either");
});

// ── AC5: server-side sort really reorders; no client sorting script ──────────────────────────

test("AC5: ?sort=<col>&dir= reverses first row for >= 4 columns; no client script", async () => {
  for (const col of ["id", "status", "title", "goal", "lastProgressAt"]) {
    const asc = await get(port, `/goal?kind=criterion&sort=${col}&dir=asc`);
    const desc = await get(port, `/goal?kind=criterion&sort=${col}&dir=desc`);
    const ascFirst = listRows(asc.body, "criterion")[0];
    const descFirst = listRows(desc.body, "criterion")[0];
    assert.ok(ascFirst && descFirst, `sort=${col} returns rows`);
    assert.notEqual(ascFirst.id, descFirst.id, `sort=${col}: first id must differ asc vs desc`);
  }
  const r = await get(port, "/goal?kind=criterion&sort=id&dir=asc");
  assert.doesNotMatch(r.body, /addEventListener/, "no client-side sorting script added");
});

// ── AC6: Criteria-tab default order — grouped by goal (contiguous), AC id desc within group ──

test("AC6: Criteria-tab default order — criteria contiguous by goal, AC id desc within group", async () => {
  const r = await get(port, "/goal?kind=criterion");
  const rows = listRows(r.body, "criterion");
  assert.ok(rows.length > 0, "criteria present");
  assert.ok(rows.every((x) => x.kind === "criterion"), "all rows are criteria");
  let prevGoal = null;
  let prevId = null;
  const seenGoals = new Set();
  const order = [];
  for (const c of rows) {
    if (c.goal !== prevGoal) {
      if (seenGoals.has(c.goal)) order.push(`goal ${c.goal} reappears (not contiguous)`);
      seenGoals.add(c.goal);
      prevGoal = c.goal;
      prevId = c.id;
    } else {
      if (String(c.id).localeCompare(String(prevId)) >= 0) order.push(`goal ${c.goal}: ${prevId} → ${c.id} (not descending)`);
      prevId = c.id;
    }
  }
  assert.deepEqual(order, [], `default-order violations:\n  ${order.join("\n  ")}`);
});

// ── AC7: p50 response time stays within the pre-fix baseline + margin ────────────────────────

test("AC7: /goal p50 <= 590ms (0.49s baseline + 100ms margin)", async () => {
  await get(port, "/goal"); // warmup
  const times = [];
  for (let i = 0; i < 11; i++) {
    const t0 = process.hrtime.bigint();
    const r = await get(port, "/goal");
    const t1 = process.hrtime.bigint();
    assert.equal(r.status, 200);
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)];
  assert.ok(p50 <= 590, `p50 = ${p50.toFixed(1)}ms (want <= 590ms)`);
});

// ── AC8: AC rollup matches renderGoalCard, and survives ?kind=goal ───────────────────────────

test("AC8: AC rollup == renderGoalCard per goal, and does not collapse under ?kind=goal", async () => {
  const store = createGoalStore(goalsDir);
  const expected = renderGoalCardRollups(store.list());
  assert.ok(Object.keys(expected).length >= 3, `renderGoalCard has ${Object.keys(expected).length} active goals`);
  const r = await get(port, "/goal");
  const goalRows = listRows(r.body, "goal").filter((x) => x.rollup !== null);
  for (const gr of goalRows) {
    assert.deepEqual(gr.rollup, expected[gr.id], `rollup for ${gr.id} matches renderGoalCard`);
  }
  const rk = await get(port, "/goal?kind=goal");
  const goalRowsK = listRows(rk.body, "goal").filter((x) => x.rollup !== null);
  assert.ok(goalRowsK.length >= 3, "?kind=goal still shows goal rows");
  for (const gr of goalRowsK) {
    assert.deepEqual(gr.rollup, expected[gr.id], `rollup for ${gr.id} survives ?kind=goal (not 0/N)`);
  }
});

// ── AC9: ?goal= filter narrows and every row's goal matches; goal column is a link ────────────

test("AC9: ?kind=criterion&goal=GOAL-008 narrows rows; all rows goal == GOAL-008; goal column links", async () => {
  const unfiltered = listRows((await get(port, "/goal?kind=criterion")).body, "criterion");
  const r = await get(port, "/goal?kind=criterion&goal=GOAL-008");
  const rows = listRows(r.body, "criterion");
  assert.ok(rows.length > 0, "?kind=criterion&goal=GOAL-008 returns rows");
  assert.ok(rows.length < unfiltered.length, `GOAL-008 rows (${rows.length}) < unfiltered (${unfiltered.length})`);
  const violations = rows.filter((x) => x.goal !== "GOAL-008").map((x) => `id=${x.id} goal=${x.goal}`);
  assert.deepEqual(violations, [], `rows whose goal != GOAL-008:\n  ${violations.join("\n  ")}`);
  assert.match(r.body, /href="\/goal\?kind=criterion&goal=GOAL-008"/, "goal column renders a link to ?kind=criterion&goal=GOAL-008");
});

// ── AC10: detail page has the same time info as the list; no >400-char p.meta ─────────────────

test("AC10: detail time info == list time info; no p.meta over 400 chars", async () => {
  // `lang=zh` on BOTH fetches so the two regexes below can pin the pre-existing 「最近进展: 」「首次证据: 」
  // prefixes (ROW 21's `detailRecentProgress` / `detailFirstEvidence` zh columns). The comparison
  // itself is language-independent — it is the `title` ATTRIBUTE's absolute timestamp, which is DATA
  // and is byte-identical in both languages, so asking for zh does not weaken the reading.
  const listGoal = listRows((await get(port, "/goal", "lang=zh")).body, "goal").find((x) => x.id === "GOAL-001");
  assert.ok(listGoal, "GOAL-001 in list");
  const detail = await get(port, "/goal/GOAL-001", "lang=zh");
  assert.equal(detail.status, 200);
  const detailLast = /最近进展: <span title="([^"]*)"/.exec(detail.body);
  const detailFirst = /首次证据: <span title="([^"]*)"/.exec(detail.body);
  assert.ok(detailLast, "detail page has 最近进展");
  assert.ok(detailFirst, "detail page has 首次证据");
  assert.equal(detailLast[1], listGoal.lastAt, "detail lastProgressAt == list lastProgressAt");
  assert.equal(detailFirst[1], listGoal.firstAt, "detail firstEvidenceAt == list firstEvidenceAt");
  // The en peer: the same two prefixes are translated, so the zh arms above are a language reading
  // rather than a statement about prefixes that are hard-coded.
  const enDetail = await get(port, "/goal/GOAL-001", "lang=en");
  assert.match(enDetail.body, /last progress: <span title="/, "the en detail page carries the translated prefix");
  assert.doesNotMatch(enDetail.body, /最近进展/, "the en detail page carries no Chinese prefix");

  // The long-origin goal must not inflate any <p class="meta"> past 400 chars (scan only <main>,
  // since the <head> stylesheet inlines CSS whose comments mention <p>/<main> fragments).
  const d8 = await get(port, "/goal/GOAL-008");
  assert.equal(d8.status, 200);
  const metas = [...mainHtml(d8.body).matchAll(/<p class="meta">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  const long = metas.filter((t) => t.length > 400);
  assert.deepEqual(long, [], `p.meta over 400 chars: ${long.map((t) => t.length).join(", ")} (pre-fix 1138)`);
  assert.match(d8.body, /class="origin-block"/, "origin is its own block, not a p.meta");
});
