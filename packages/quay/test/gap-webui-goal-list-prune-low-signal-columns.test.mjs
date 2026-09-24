// @test-group product
// gap-webui-goal-list-prune-low-signal-columns — the /goal LIST stops spending width on cells that
// carry no information. Five defects, all measured on production `/goal` at 1440px (Proposal):
//   ① the Criteria tab's `criterion` column rendered a shell command that the SERVER truncated to 60
//      chars and the STYLESHEET then clipped to ~10 (`node -…`, `python…`) — zero information, ~11% of
//      the table width;
//   ② the `recent verdict` cell showed `pass · 2026-…` — the cut half was the useful one (`2d ago`),
//      the surviving half was a 4-digit year;
//   ③ `last progress` (`10s ago`) and `first evidence` (`9d ago`) were two columns (~31% of the
//      width) carrying one short text each;
//   ④ `AC 达成` and `挂靠任务` are LINKS but rendered exactly like the id link — same colour, no
//      underline — so the reader could not tell which cells were clickable;
//   ⑤ the decision banner (up to two `<p>`s plus a three-line explanatory sentence) cost ~200px of
//      the first screen and pushed the table below the fold.
//
// ⛔ WHAT THIS FILE IS CAREFUL ABOUT, and why each arm is written the way it is:
//   • "removed" must not become "lost". Every removed surface is paired with an arm that reads the
//     value SOMEWHERE ELSE (① → the detail page; ③ → the merged cell's second `title`).
//   • 硬规则 3b: the UN-JUDGED verdict cell (`—`, and the pre-existing `unknown · <at>` form) must
//     stay distinguishable from a judged one, so the arms below pin its bytes EXACTLY rather than
//     asserting "it renders something".
//   • 硬规则 6: a missing `firstEvidenceAt` renders the not-recorded marker, never an empty half.
//   • 硬规则 2: the first three rows' ACTUAL content is printed before any count is quoted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { GOAL_LABELS, fillLabel } from "../src/serve-i18n.ts";
import { relativeTime } from "../src/serve-render.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ── helpers ──────────────────────────────────────────────────────────────────────────────────

/** `cookie` (optional): the page language. The default is `en`, so every arm that pins a
 *  PRE-EXISTING Chinese literal asks for `lang=zh` explicitly and thereby becomes a zh regression
 *  guard instead of an assertion about the wrong rendering. */
function get(port, urlPath, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

const stripTags = (s) => (s || "").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** Reader-visible text: tags removed, runs of whitespace collapsed to ONE space (an HTML reader
 *  collapses them, and the page's own template whitespace must not read as content). */
const visibleText = (s) => stripTags(s).replace(/\s+/g, " ").trim();
const titlesOf = (cell) => [...(cell || "").matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
const hrefsOf = (cell) => [...(cell || "").matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

/** The list table's `<th>` label texts (tags stripped), in order. */
function headers(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  const head = m[1].split("</tr>")[0];
  return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) => x[1].replace(/<[^>]*>/g, "").trim());
}

/** The list table's data rows, each as an array of cell INNER-HTML strings. */
function dataRows(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((x) => x[1])
    .filter((r) => !/<th/.test(r))
    .map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]));
}

/** Goals-tab rows (6 cols). gap-webui-goal-list-prune-low-signal-columns: index 4 is the MERGED
 *  progress cell (`last progress · since first evidence`) and `挂靠任务` moved 6 → 5 — the two facts
 *  this file exists to pin. A stale index here would read an EMPTY cell and fail as "the value is
 *  missing", which is the same symptom as the defect this task fixes. */
function goalRows(html) {
  return dataRows(html).map((c) => ({
    id: (/href="\/goal\/([^"]+)"/.exec(c[0] || "") || [])[1] || "",
    status: stripTags(c[1]),
    progress: c[4] || "",
    taskAttach: c[5] || "",
  }));
}

/** Criteria-tab rows (7 cols) — the `criterion` cell is gone, so `recent verdict` moved 5 → 4 and
 *  `last progress` 6 → 5. */
function criterionRows(html) {
  return dataRows(html).map((c) => ({
    id: (/href="\/goal\/([^"]+)"/.exec(c[0] || "") || [])[1] || "",
    goal: decodeURIComponent((/goal=([^"&]+)/.exec((/href="([^"]+)"/.exec(c[1] || "") || [])[1] || "") || [])[1] || ""),
    verdict: c[4] || "",
    lastProgress: c[5] || "",
  }));
}

/** The draft banner's own `<div class="info-banner">` block. The page ALSO uses `info-banner` for the
 *  empty state and the read-failure banner, so the block is selected by a MARKER that only the draft
 *  banner carries (`viewDrafts` — the link label, which appears nowhere else on the page). */
function draftBanner(html, marker) {
  const blocks = [...html.matchAll(/<div class="info-banner" role="status">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  return blocks.find((b) => b.includes(marker)) ?? null;
}

/** Independent read of the ledger: the min / max timestamp across `ids`. Read from the FILE, so the
 *  assertions judge the page against the source of truth the renderer read — not against the
 *  renderer's own arithmetic (硬规则 4b). */
function ledgerExtremes(logPath, ids) {
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let last = null;
  let first = null;
  for (const e of lines) {
    if (!ids.includes(String(e.pipeline_id ?? e.item_id))) continue;
    if (last === null || e.timestamp > last) last = e.timestamp;
    if (first === null || e.timestamp < first) first = e.timestamp;
  }
  return { last, first };
}

// ── fixture ──────────────────────────────────────────────────────────────────────────────────
// ① GOAL-001 / GOAL-002 have real multi-event ledgers, with last ≠ first on BOTH (a fixture where the
//    two timestamps were equal could not tell a swapped implementation from a correct one).
// ② GOAL-003 has NO ledger events at all → the merged cell's BOTH halves are the not-recorded marker,
//    which is the arm that catches "merged by dropping the empty half".
// ③ AC-201's only event carries NO `verdict` key → the pre-existing `unknown · <at>` state, i.e. the
//    un-judged cell that must stay byte-identical.
// ④ one draft GOAL + one draft AC so the banner's BOTH-kinds branch renders.

const LONG_CRITERION = "node --experimental-strip-types scripts/verify-low-signal-columns.ts --flag=value";

let server, port, originalCwd, workspaceRoot, goalsDir, ledgerPath;

before(async () => {
  const tasksDir = makeTmpDir("goal-prune-tasks-");
  const adrDir = makeTmpDir("goal-prune-adr-");
  workspaceRoot = makeTmpDir("goal-prune-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  ledgerPath = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  const goal = (id, title, status) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-goal.md`),
      `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nkind: goal\norigin: test\n---\n## 背景\nmeasured\n`);
  const ac = (id, status, goalId, criterion) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-criterion.md`),
      `---\nid: ${id}\ntitle: criterion ${id}\nstatus: ${status}\nkind: criterion\ngoal: ${goalId}\ncriterion: ${criterion}\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);

  goal("GOAL-001", "goal one", "active");
  goal("GOAL-002", "goal two", "active");
  goal("GOAL-003", "goal three — no evidence", "active");
  goal("GOAL-900", "draft goal awaiting a decision", "draft");
  ac("AC-101", "achieved", "GOAL-001", "exit 0");
  ac("AC-102", "active", "GOAL-001", LONG_CRITERION);
  ac("AC-103", "achieved", "GOAL-001", "exit 0");
  ac("AC-201", "active", "GOAL-002", "exit 0");
  ac("AC-202", "active", "GOAL-002", "exit 0");
  ac("AC-301", "active", "GOAL-003", "exit 0");
  ac("AC-900", "draft", "GOAL-001", "exit 1");

  // Chronological append order. AC-201's event deliberately omits `verdict`.
  const ev = (id, verdict, timestamp) => {
    const e = { id: `ev-${id}-${timestamp}`, item_id: id, pipeline_id: id, gate: "goal", actor: "test", timestamp, payload: { reason: "ok" } };
    if (verdict !== null) e.verdict = verdict;
    return JSON.stringify(e);
  };
  fs.writeFileSync(ledgerPath, [
    ev("AC-101", "pass", "2026-09-01T10:00:00.000Z"),
    ev("AC-103", "pass", "2026-09-05T00:00:00.000Z"),
    ev("AC-102", "fail", "2026-09-02T08:00:00.000Z"),
    ev("AC-201", null, "2026-09-03T00:00:00.000Z"),
    ev("AC-202", "pass", "2026-09-04T00:00:00.000Z"),
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

// ── AC1: the criterion column is GONE from the list and the text is NOT lost ──────────────────

test("AC1: the Criteria tab has 7 columns and no `criterion` header; the detail page still has the full text", async () => {
  const r = await get(port, "/goal?kind=criterion");
  assert.equal(r.status, 200);
  const hs = headers(r.body);
  assert.equal(hs.length, 7, `Criteria tab has 7 <th>; got: ${hs.join(" | ")}`);
  assert.ok(!hs.includes("criterion"), `no \`criterion\` header; got: ${hs.join(" | ")}`);
  // ⛔ The zero above only means something if the predicate CAN hit — the same header list contains
  // `recent verdict`, the column that sat immediately to its right.
  assert.ok(hs.includes("recent verdict"), "control: the header predicate does hit this header row");

  // The value that used to live in that column: absent from the LIST…
  assert.ok(!r.body.includes(LONG_CRITERION), "the criterion command is not in the list body");
  assert.ok(!r.body.includes(LONG_CRITERION.slice(0, 60)), "…not even its 60-char server-side prefix");

  // …and present IN FULL on the record's own page, which the id cell one column to the left links to.
  const detail = await get(port, "/goal/AC-102");
  assert.equal(detail.status, 200);
  assert.ok(detail.body.includes(LONG_CRITERION), "the detail page renders the criterion command, in full");
  assert.ok(detail.body.includes("criterion:"), "…under its own label");
});

// ── AC2: the Goals tab merges `first evidence` into `last progress` ────────────────────────────

test("AC2: the Goals tab has 6 columns, no `first evidence` header, and one merged cell carrying both times", async () => {
  const r = await get(port, "/goal");
  assert.equal(r.status, 200);
  const hs = headers(r.body);
  assert.equal(hs.length, 6, `Goals tab has 6 <th>; got: ${hs.join(" | ")}`);
  assert.ok(!hs.includes("first evidence"), `no \`first evidence\` header; got: ${hs.join(" | ")}`);
  assert.ok(hs.includes("last progress"), "control: the header predicate does hit this header row");

  const rows = goalRows(r.body);
  // 硬规则 2: print the ACTUAL merged cells before quoting any count — a count whose matches were
  // never read cannot tell "the cell I mean" from "a cell that mentions it".
  console.log("[/goal] first 3 data rows (merged progress cell):");
  for (const row of rows.slice(0, 3)) console.log(`  ${row.id}  |  ${visibleText(row.progress)}  |  titles=${JSON.stringify(titlesOf(row.progress))}`);

  // GOAL-001 is the discriminating row: its ledger's min (AC-101) and max (AC-103) differ, so a
  // renderer that swapped the two halves (or emitted one twice) fails here.
  const exp = ledgerExtremes(ledgerPath, ["AC-101", "AC-102", "AC-103"]);
  assert.ok(exp.last && exp.first && exp.last !== exp.first,
    `precondition: the fixture's two extremes differ (last=${exp.last} first=${exp.first})`);
  const g1 = rows.find((x) => x.id === "GOAL-001");
  assert.ok(g1, "GOAL-001 row present");
  assert.deepEqual(titlesOf(g1.progress), [exp.last, exp.first],
    "the merged cell carries BOTH absolute timestamps, last first (values read from the LEDGER, not from the renderer)");

  // The visible half: BOTH relative times, spelled by the page's own `relativeTime`.
  const text = visibleText(g1.progress);
  assert.ok(text.includes(relativeTime(Date.parse(exp.last))), `the cell shows the last-progress relative time; text=${JSON.stringify(text)}`);
  assert.ok(text.includes(relativeTime(Date.parse(exp.first))), `…AND the first-evidence relative time; text=${JSON.stringify(text)}`);
  // The `since {rel}` wording is serve-i18n copy, not a literal at the call site — asserted by VALUE
  // read from the dictionary (the page's default language is `en`).
  assert.ok(text.includes(fillLabel(GOAL_LABELS.sincePrefix.en, { rel: relativeTime(Date.parse(exp.first)) })),
    `the second half is introduced by the dictionary's own wording; text=${JSON.stringify(text)}`);

  // 硬规则 6: a record with no evidence at all keeps BOTH markers — never an empty half.
  const g3 = rows.find((x) => x.id === "GOAL-003");
  assert.ok(g3, "GOAL-003 row present (no ledger events)");
  const g3text = visibleText(g3.progress);
  assert.deepEqual(titlesOf(g3.progress), [], "no timestamp is claimed for a record with no events");
  assert.equal((g3text.match(new RegExp(GOAL_LABELS.notRecorded.en, "g")) ?? []).length, 2,
    `both halves carry the not-recorded marker (not an empty cell); text=${JSON.stringify(g3text)}`);

  // …and the zh render moves the marker, so the arm above is a reading of the LANGUAGE.
  const zh = goalRows((await get(port, "/goal", "lang=zh")).body).find((x) => x.id === "GOAL-003");
  assert.ok(visibleText(zh.progress).includes(GOAL_LABELS.notRecorded.zh),
    `the zh cell carries the zh marker; text=${JSON.stringify(visibleText(zh.progress))}`);
});

// ── AC3: the verdict cell is badge + relative time; the un-judged cells are UNMOVED ───────────

test("AC3: verdict = badge + relative time (absolute on `title`); the un-judged cells keep their exact bytes", async () => {
  const rows = criterionRows((await get(port, "/goal?kind=criterion")).body);
  console.log("[/goal?kind=criterion] first 3 data rows (verdict cell):");
  for (const row of rows.slice(0, 3)) console.log(`  ${row.id}  |  ${visibleText(row.verdict)}  |  titles=${JSON.stringify(titlesOf(row.verdict))}`);

  // — a JUDGED row —
  const judged = rows.find((x) => x.id === "AC-202");
  assert.ok(judged, "AC-202 (a judged row) present");
  const judgedText = visibleText(judged.verdict);
  assert.ok(judgedText.includes("pass"), `the badge survives; text=${JSON.stringify(judgedText)}`);
  assert.ok(!/\b(19|20)\d{2}\b/.test(judgedText),
    `no 4-digit year in the visible text; text=${JSON.stringify(judgedText)}`);
  assert.deepEqual(titlesOf(judged.verdict), ["2026-09-04T00:00:00.000Z"],
    "the absolute stamp moved to `title`, byte-identical to the ledger's value");

  // — the un-judged rows: byte-identical to the pre-change rendering, one arm each —
  //  (a) no ledger event at all ⇒ `—` (the "no evidence" value)
  const none = rows.find((x) => x.id === "AC-301");
  assert.ok(none, "AC-301 (no ledger event) present");
  assert.equal(none.verdict, "—", `the no-evidence cell is exactly the pre-change bytes; got ${JSON.stringify(none.verdict)}`);
  //  (b) `at` present but NO verdict ⇒ the pre-existing `unknown · <at>` form, absolute and unmoved
  const unknown = rows.find((x) => x.id === "AC-201");
  assert.ok(unknown, "AC-201 (an event with no verdict) present");
  assert.equal(unknown.verdict, `<strong class="verdict-fail">unknown</strong> · 2026-09-03T00:00:00.000Z`,
    `the un-judged cell is byte-identical to the pre-change rendering; got ${JSON.stringify(unknown.verdict)}`);
  // ⛔ …and all three states stay DISTINGUISHABLE from one another (硬规则 3b): the judged row carries
  // a `title` and no year, the two un-judged rows carry neither and differ from each other.
  assert.notEqual(judged.verdict, none.verdict);
  assert.notEqual(judged.verdict, unknown.verdict);
  assert.notEqual(none.verdict, unknown.verdict, "`no evidence` and `not judged` are different states, not one blank");
});

// ── AC4: the decision banner collapses to one line, keeping both links and both hrefs ─────────

test("AC4: with BOTH kinds pending the banner is ONE line carrying both links, hrefs unchanged", async () => {
  const en = await get(port, "/goal");
  const enBanner = draftBanner(en.body, GOAL_LABELS.viewDrafts.en);
  assert.ok(enBanner, "the draft banner renders (both a draft GOAL and a draft AC are pending)");
  console.log(`[/goal] banner block: ${JSON.stringify(visibleText(enBanner))}`);
  assert.equal((enBanner.match(/<p[\s>]/g) ?? []).length, 1, `the banner is ONE line (one <p>); got ${JSON.stringify(enBanner)}`);

  const summary = fillLabel(GOAL_LABELS.draftBothBanner.en, { n: 1, kind: "GOAL", m: 1, kind2: "AC" });
  const text = visibleText(enBanner);
  assert.ok(text.startsWith(summary), `the visible text IS the dictionary's summary sentence; want prefix ${JSON.stringify(summary)} got ${JSON.stringify(text)}`);
  // ⛔ The two per-kind sentences and the long explanation are what the collapse removes — asserted as
  // ABSENT so this arm cannot pass on a page that still renders the old two-`<p>` banner.
  assert.ok(!text.includes(fillLabel(GOAL_LABELS.draftOwnBanner.en, { n: 1, kind: "GOAL" })), "the per-kind own sentence is gone");
  assert.ok(!text.includes(fillLabel(GOAL_LABELS.draftOtherBanner.en, { n: 1, kind: "AC" })), "the per-kind cross-tab sentence is gone");
  assert.ok(!/<code>/.test(enBanner), "the three-line explanation (whose only element is a <code>) is gone");

  // Both jump links survive, with the hrefs they had before the collapse.
  assert.deepEqual(hrefsOf(enBanner), ["/goal?status=draft", "/goal?status=draft&kind=criterion"],
    "the own-drafts link and the cross-tab link, hrefs byte-identical to the pre-change values");

  // The Criteria tab: the same collapse with the OWN/OTHER roles swapped — so an implementation that
  // hard-coded "GOAL first" fails here.
  const crit = await get(port, "/goal?kind=criterion");
  const critBanner = draftBanner(crit.body, GOAL_LABELS.viewDrafts.en);
  assert.ok(critBanner, "the draft banner renders on the Criteria tab too");
  assert.equal((critBanner.match(/<p[\s>]/g) ?? []).length, 1, "the Criteria-tab banner is one line");
  const critSummary = fillLabel(GOAL_LABELS.draftBothBanner.en, { n: 1, kind: "AC", m: 1, kind2: "GOAL" });
  assert.ok(visibleText(critBanner).startsWith(critSummary),
    `the Criteria tab names its OWN kind first; want ${JSON.stringify(critSummary)} got ${JSON.stringify(visibleText(critBanner))}`);
  assert.deepEqual(hrefsOf(critBanner), ["/goal?status=draft&kind=criterion", "/goal?status=draft"],
    "the hrefs are the same two filters, byte-identical, just in the other order");
});

// ── AC5: every new string is serve-i18n copy — measured by rendering BOTH languages ───────────

test("AC5: the new copy switches language (dictionary-driven, not a hard-coded English string)", async () => {
  // ⚠️ The measurement is the DIFFERENCE between the two renders, not a source grep (硬规则 2: a
  // literal inside a comment or another string would be a false hit). A page that hard-coded English
  // would satisfy the en arms and fail exactly here.
  for (const key of ["sincePrefix", "draftBothBanner"]) {
    assert.notEqual(GOAL_LABELS[key].en, GOAL_LABELS[key].zh, `${key}: the two columns are not the same string`);
    assert.deepEqual(
      [...GOAL_LABELS[key].en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      [...GOAL_LABELS[key].zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      `${key}: both columns carry the same placeholder names`);
  }

  const zhGoals = await get(port, "/goal", "lang=zh");
  const mergedOf = (body) => visibleText(goalRows(body).find((x) => x.id === "GOAL-001").progress);
  const zhMerged = mergedOf(zhGoals.body);
  const enMerged = mergedOf((await get(port, "/goal", "lang=en")).body);
  const zhWord = GOAL_LABELS.sincePrefix.zh.replace("{rel}", "").trim();
  const enWord = GOAL_LABELS.sincePrefix.en.replace("{rel}", "").trim();
  assert.ok(zhMerged.includes(zhWord), `the zh merged cell carries the zh wording; got ${JSON.stringify(zhMerged)}`);
  assert.ok(!zhMerged.includes(enWord), `…and NOT the en wording; got ${JSON.stringify(zhMerged)}`);
  assert.notEqual(zhMerged, enMerged, "the merged cell really switches with the language");

  const zhBanner = draftBanner(zhGoals.body, GOAL_LABELS.viewDrafts.zh);
  assert.ok(zhBanner, "the zh banner renders (selected by its own link label)");
  const zhSummary = fillLabel(GOAL_LABELS.draftBothBanner.zh, { n: 1, kind: "GOAL", m: 1, kind2: "AC" });
  assert.ok(visibleText(zhBanner).startsWith(zhSummary),
    `the zh banner carries the zh summary; want ${JSON.stringify(zhSummary)} got ${JSON.stringify(visibleText(zhBanner))}`);
  assert.ok(!zhBanner.includes(GOAL_LABELS.draftBothBanner.en.replace(/\{\w+\}/g, "").replace(/\s+/g, " ").trim()),
    "…and none of the en wording");
});
