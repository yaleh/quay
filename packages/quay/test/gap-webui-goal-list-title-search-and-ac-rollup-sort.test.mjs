// @test-group product
// gap-webui-goal-list-title-search-and-ac-rollup-sort — the /goal list gains the two affordances
// /tasks already had: a `?q=` search box and a sortable 「AC 达成」 column.
//
// Proposal (measured by the human comparing /tasks and /goal, 2026-09-24):
//   a) /tasks has a search box; /goal has only the status filter and the pre-existing sort/dir
//      parameters — so finding one goal among 27 means scanning by eye. Fix: `?q=`, case-insensitive
//      substring over goal id + title (Goals tab) and AC id + title + owning goal id (Criteria tab),
//      with the /tasks form STRUCTURE reused and the copy coming from serve-i18n.
//   b) the 「AC 达成」 column is a RENDER-TIME rollup — computed by the column from the full `all`
//      array, not carried on a record — so it is not reachable from the store-layer sort. Fix:
//      `?sort=acRollup`, ordered in the handler through the SAME accessor the column renders through.
//   c) the existing AC6 invariant holds: every request still calls `goalList()` exactly ONCE.
//   d) "your search matched nothing" and "there are no goals" are two different facts and must not
//      render the same sentence (硬规则 3b).
//
// ⛔ WHAT THIS FILE IS CAREFUL ABOUT:
//   • 硬规则 2 — the first three rows' ACTUAL content is printed before any count is quoted, and every
//     "absent" arm has a control proving the predicate can hit on this very page.
//   • 硬规则 3 — `0/0` ("no AC to evaluate") is NOT 0%. It has its own value, and the arm that pins it
//     is the ASCENDING order: ranking it as a ratio would put it FIRST there, not last.
//   • 硬规则 3b — "no search" (`?q=`, empty) is not "search for the empty string"; "no match" is not
//     "empty store"; a `total=0` rollup is not `—`.
//   • The hand-computed orders below are written as LITERAL arrays plus an independently-written
//     rollup table, never derived by re-running the page's own arithmetic (硬规则 4b).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { GOAL_LABELS, fillLabel } from "../src/serve-i18n.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ── helpers ──────────────────────────────────────────────────────────────────────────────────

/** `cookie` (optional): the page language. The default is `en`, so every arm that pins a
 *  PRE-EXISTING or dictionary-owned string asks for its language explicitly rather than relying on
 *  which one happens to be the default. */
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
const visibleText = (s) => stripTags(s).replace(/\s+/g, " ").trim();
const hrefsOf = (s) => [...(s || "").matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

/** The list table's data rows, each as an array of cell INNER-HTML strings. */
function dataRows(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((x) => x[1])
    .filter((r) => !/<th/.test(r))
    .map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]));
}

/** Goals-tab rows (6 cols): id / status / title / AC 达成 / merged progress / 挂靠任务. */
function goalRows(html) {
  return dataRows(html).map((c) => {
    const roll = /^(\d+)\/(\d+)$/.exec(visibleText(c[3]));
    return {
      id: (/href="\/goal\/([^"]+)"/.exec(c[0] || "") || [])[1] || "",
      status: stripTags(c[1]),
      title: stripTags(c[2]),
      rollupText: visibleText(c[3]),
      rollup: roll ? { achieved: Number(roll[1]), total: Number(roll[2]) } : null,
    };
  });
}

/** Criteria-tab rows (7 cols): id / goal / status / title / recent verdict / last progress / 挂靠. */
function criterionRows(html) {
  return dataRows(html).map((c) => ({
    id: (/href="\/goal\/([^"]+)"/.exec(c[0] || "") || [])[1] || "",
    goal: decodeURIComponent((/goal=([^"&]+)/.exec((/href="([^"]+)"/.exec(c[1] || "") || [])[1] || "") || [])[1] || ""),
    title: stripTags(c[3]),
  }));
}

/** The sortable `<th>` anchors, in column order (the `挂靠任务` header is a plain `<th>` — no link). */
function headerHrefs(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  const head = m[1].split("</tr>")[0];
  return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].flatMap((x) => hrefsOf(x[1]));
}

/** The status filter row's anchors (`<p class="meta">Status: …</p>`), in order. */
function statusNavHrefs(html) {
  const m = /<p class="meta">Status: ([\s\S]*?)<\/p>/.exec(html);
  return m ? hrefsOf(m[1]) : [];
}

// ── fixture ──────────────────────────────────────────────────────────────────────────────────
// Designed so that EVERY asserted number is hand-computable from this table alone:
//
//   goal      title                     status     ACs                        rollup  ratio
//   GOAL-001  plugin layer surface      active     AC-101✓ AC-102✗ AC-103✓      2/3    0.667
//   GOAL-002  store layer internals     achieved   AC-201✓ AC-202✓              2/2    1.000
//   GOAL-003  searchable needle item    active     AC-301✗ AC-302✗ AC-303✗ ✓304  1/4    0.250
//   GOAL-004  no criteria here          active     (none)                       0/0    —
//   GOAL-005  only retired criteria     active     AC-501 (superseded)          0/0    —
//
// ① "needle" is in EXACTLY ONE goal title (AC1's count == 1 arm).
// ② "layer" is in TWO goal titles with DIFFERENT statuses (the `q` ∧ `status` AND arm: 2 → 1 from
//    either direction, so the arm cannot pass on "status wins" or "q wins").
// ③ GOAL-004 has no criteria and GOAL-005's only criterion is `superseded`, i.e. OUT of the rollup
//    denominator — so both render 0/0, and 005 is the arm that pins the `isAcRollupCounted` 口径
//    (a looser denominator would render it 0/1, a ratio of 0, and rank it FIRST under `dir=asc`).
// ④ the three non-zero ratios are DISTINCT (1.000 / 0.667 / 0.250), so no ordering arm below depends
//    on a tie-break the fixture never exercises.

const FIXTURE = [
  { id: "GOAL-001", title: "plugin layer surface", status: "active" },
  { id: "GOAL-002", title: "store layer internals", status: "achieved" },
  { id: "GOAL-003", title: "searchable needle item", status: "active" },
  { id: "GOAL-004", title: "no criteria here", status: "active" },
  { id: "GOAL-005", title: "only retired criteria", status: "active" },
];

/** The rollup every goal row must render — written by hand from the AC table above, and compared
 *  against the PAGE (served over HTTP), never against the page's own sort order. */
const HAND_ROLLUPS = {
  "GOAL-001": { achieved: 2, total: 3 },
  "GOAL-002": { achieved: 2, total: 2 },
  "GOAL-003": { achieved: 1, total: 4 },
  "GOAL-004": { achieved: 0, total: 0 },
  "GOAL-005": { achieved: 0, total: 0 },
};

const ACS = [
  { id: "AC-101", goal: "GOAL-001", status: "achieved" },
  { id: "AC-102", goal: "GOAL-001", status: "active" },
  { id: "AC-103", goal: "GOAL-001", status: "achieved" },
  { id: "AC-201", goal: "GOAL-002", status: "achieved" },
  { id: "AC-202", goal: "GOAL-002", status: "achieved" },
  { id: "AC-301", goal: "GOAL-003", status: "active" },
  { id: "AC-302", goal: "GOAL-003", status: "active" },
  { id: "AC-303", goal: "GOAL-003", status: "active" },
  { id: "AC-304", goal: "GOAL-003", status: "achieved" },
  { id: "AC-501", goal: "GOAL-005", status: "superseded" },
];

// The handed orders for `?sort=acRollup`. `0/0` sinks to the BOTTOM in both directions, so the tail
// is the same in both — and in the ASCENDING one it is the whole point (see ③ above).
const EXPECTED_DESC = ["GOAL-002", "GOAL-001", "GOAL-003", "GOAL-004", "GOAL-005"];
const EXPECTED_ASC = ["GOAL-003", "GOAL-001", "GOAL-002", "GOAL-004", "GOAL-005"];

let server, port, originalCwd;

before(async () => {
  const tasksDir = makeTmpDir("goal-search-tasks-");
  const adrDir = makeTmpDir("goal-search-adr-");
  const workspaceRoot = makeTmpDir("goal-search-ws-");
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  for (const g of FIXTURE) {
    fs.writeFileSync(path.join(goalsDir, `${g.id}-goal.md`),
      `---\nid: ${g.id}\ntitle: ${g.title}\nstatus: ${g.status}\nkind: goal\norigin: test\n---\n## 背景\nmeasured\n`);
  }
  for (const a of ACS) {
    fs.writeFileSync(path.join(goalsDir, `${a.id}-criterion.md`),
      `---\nid: ${a.id}\ntitle: criterion ${a.id}\nstatus: ${a.status}\nkind: criterion\ngoal: ${a.goal}\ncriterion: exit 0\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);
  }
  // The ledger: the fixture deliberately has NO events, so `lastProgressAt` is the not-recorded marker
  // on every row. That keeps this file's arms about the SEARCH and the ROLLUP, and leaves the
  // ledger-derived columns to the test that owns them (gap-webui-goal-list-sort-and-column-set).

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

// ── AC1 (proposal a): `?q=` — case-insensitive substring, per-tab fields ──────────────────────

test("AC1: ?q= matches one goal title (case-insensitively); the Criteria tab matches AC id and owning goal id", async () => {
  const all = goalRows((await get(port, "/goal")).body);
  assert.equal(all.length, FIXTURE.length, `precondition: all ${FIXTURE.length} goals render unfiltered`);

  // 硬规则 2: read the ACTUAL rows before quoting any count.
  const hit = goalRows((await get(port, "/goal?q=needle")).body);
  console.log(`[/goal?q=needle] ${hit.length} row(s):`);
  for (const r of hit.slice(0, 3)) console.log(`  ${r.id}  |  ${r.title}  |  rollup=${r.rollupText}`);
  assert.equal(hit.length, 1, "exactly ONE goal title carries `needle` (hand-counted from FIXTURE)");
  assert.equal(hit[0].id, "GOAL-003");

  // Case-insensitivity is a property of the MATCHER, so it is read through three spellings of the
  // same needle — one of them would pass on a case-sensitive implementation only by luck.
  for (const q of ["NEEDLE", "NeEdLe", "needle"]) {
    assert.deepEqual(goalRows((await get(port, `/goal?q=${q}`)).body).map((r) => r.id), ["GOAL-003"],
      `q=${q}: case-insensitive match`);
  }
  // ⛔ The zero arm needs its control (硬规则 2): the SAME predicate that returns 0 for the absent
  // needle returns 1 for the present one, so the 0 below is about the needle, not about a predicate
  // that never fires. And an absent needle renders the no-match state, not the full list.
  const miss = await get(port, "/goal?q=absent-needle-xyz");
  assert.equal(goalRows(miss.body).length, 0, "an absent needle matches no goal");
  assert.ok(miss.body.includes(fillLabel(GOAL_LABELS.searchNoMatch.en, { q: "absent-needle-xyz" })),
    "…and renders the no-match state (the control that the matcher did run)");

  // `?q=` (EMPTY) is "no search", never "search for the empty string" (硬规则 3b): an empty needle
  // would match every row, which would look like a filter that does nothing.
  assert.equal(goalRows((await get(port, "/goal?q=")).body).length, FIXTURE.length,
    "an empty ?q= filters nothing");

  // — the Criteria tab: the AC's own id …
  const byAcId = criterionRows((await get(port, "/goal?kind=criterion&q=AC-202")).body);
  console.log(`[/goal?kind=criterion&q=AC-202] ${byAcId.length} row(s):`);
  for (const r of byAcId.slice(0, 3)) console.log(`  ${r.id}  |  goal=${r.goal}  |  ${r.title}`);
  assert.equal(byAcId.length, 1, "AC id needle ⇒ 1 row");
  assert.equal(byAcId[0].id, "AC-202");

  // — … and the goal it belongs to (the field the Goals tab does not search, and the reason the two
  //   tabs have different field lists rather than one shared haystack).
  const byGoalId = criterionRows((await get(port, "/goal?kind=criterion&q=GOAL-003")).body);
  console.log(`[/goal?kind=criterion&q=GOAL-003] ${byGoalId.length} row(s):`);
  for (const r of byGoalId.slice(0, 3)) console.log(`  ${r.id}  |  goal=${r.goal}`);
  const expectedAcs = ACS.filter((a) => a.goal === "GOAL-003").map((a) => a.id);
  assert.equal(byGoalId.length, expectedAcs.length, "the owning goal id finds exactly that goal's ACs (hand-counted)");
  assert.deepEqual(byGoalId.map((r) => r.id).sort(), [...expectedAcs].sort());
  assert.ok(byGoalId.every((r) => r.goal === "GOAL-003"), "every hit's own goal field is the needle");

  // The tab-scoping control: `needle` lives in a GOAL title and in no AC title, so the same needle
  // that returns 1 on the Goals tab returns 0 here. A single shared matcher would return the goal row
  // (or the AC row) for both tabs.
  assert.equal(criterionRows((await get(port, "/goal?kind=criterion&q=needle")).body).length, 0,
    "control: a goal-title needle does not match on the Criteria tab (per-tab fields, not one haystack)");
});

// ── AC2 (proposals a + d): AND with the other filters, no-match state, and hrefs that keep `q` ─

test("AC2: q AND status; a no-match state DISTINCT from the empty-store state; every filter/sort link keeps q", async () => {
  // — `q` ∧ `status`: the two needles have different statuses, so BOTH directions narrow 2 → 1 …
  const both = goalRows((await get(port, "/goal?q=layer")).body);
  assert.deepEqual(both.map((r) => r.id).sort(), ["GOAL-001", "GOAL-002"], "precondition: `layer` hits 2 goals");
  assert.deepEqual(goalRows((await get(port, "/goal?q=layer&status=active")).body).map((r) => r.id), ["GOAL-001"],
    "q ∧ status=active ⇒ only the active one");
  assert.deepEqual(goalRows((await get(port, "/goal?q=layer&status=achieved")).body).map((r) => r.id), ["GOAL-002"],
    "q ∧ status=achieved ⇒ only the achieved one (so this is AND, not status-wins or q-wins)");
  assert.equal(goalRows((await get(port, "/goal?q=layer&status=retired")).body).length, 0,
    "q ∧ status=retired ⇒ 0 (neither hit is retired)");

  // — the TWO zero-row states must not render the same sentence (硬规则 3b) —
  const noMatch = (await get(port, "/goal?q=absent-needle-xyz")).body;
  const emptyFiltered = (await get(port, "/goal?status=retired")).body;
  assert.equal(goalRows(emptyFiltered).length, 0, "precondition: ?status=retired is also a zero-row render");
  // 硬规则 2 controls: in EACH render its own sentence is present and the other's is not.
  assert.ok(noMatch.includes(fillLabel(GOAL_LABELS.searchNoMatch.en, { q: "absent-needle-xyz" })),
    "the no-match render carries the no-match sentence, with the reader's own query interpolated");
  assert.ok(!noMatch.includes(GOAL_LABELS.emptyDir.en), "…and NOT the empty-store sentence");
  // ⛔ nor the sentences that EXPLAIN the store is empty: they are false here (the store has records;
  // the needle missed), and they are what would send the reader to `goals/` to debug nothing.
  assert.ok(!noMatch.includes(GOAL_LABELS.emptyFiltered.en), "…nor the filtered-empty sentence");
  assert.ok(!noMatch.includes("goals/ 目录为空") && !/goals\/<\/code>/.test(noMatch),
    "…nor the pointer note that explains an empty `goals/`");
  assert.ok(emptyFiltered.includes(GOAL_LABELS.emptyFiltered.en),
    "control: the no-`q` zero-row render still carries the pre-existing filtered-empty sentence");
  assert.ok(!emptyFiltered.includes(GOAL_LABELS.searchNoMatch.en.replace("{q}", "")),
    "…and no no-match sentence (the new state is q-gated, not any-zero-row-render)");

  // — href preservation: EVERY column-header sort link and EVERY status filter link carries the
  //   search. Asserted as explicit per-href arrays (`逐个`), not as "some href contains q".
  const withQ = await get(port, "/goal?q=layer");
  assert.deepEqual(headerHrefs(withQ.body), [
    "/goal?q=layer&sort=id&dir=asc",
    "/goal?q=layer&sort=status&dir=asc",
    "/goal?q=layer&sort=title&dir=asc",
    // ⚠️ the 「AC 达成」 header is a SORT LINK — it is the only entry point `?sort=acRollup` has.
    "/goal?q=layer&sort=acRollup&dir=asc",
    "/goal?q=layer&sort=lastProgressAt&dir=asc",
  ], "every sortable header link keeps `q` (and the AC 达成 header IS one of them)");
  assert.deepEqual(statusNavHrefs(withQ.body), [
    "/goal?status=draft&q=layer",
    "/goal?status=active&q=layer",
    "/goal?status=achieved&q=layer",
    "/goal?status=superseded&q=layer",
    "/goal?status=retired&q=layer",
  ], "every status filter link keeps `q`");
  // …and the Criteria tab + a query with characters that need encoding survive the round trip.
  const critQ = await get(port, "/goal?kind=criterion&q=a%20b");
  assert.ok(headerHrefs(critQ.body).every((h) => h.includes("q=a+b") || h.includes("q=a%20b")),
    `every Criteria-tab header link keeps the encoded query; got ${JSON.stringify(headerHrefs(critQ.body))}`);

  // — the search form: the query is echoed in the box so the reader can see what is filtering, and the
  //   ACTIVE view parameters ride as hidden fields so submitting the search does not drop them.
  const onCriteria = await get(port, "/goal?kind=criterion&status=active&q=AC-3");
  const form = /<form[^>]*action="\/goal"[\s\S]*?<\/form>/.exec(onCriteria.body);
  assert.ok(form, "the /goal page renders the search form");
  assert.match(form[0], /name="q"[^>]*value="AC-3"/, "the box echoes the active query");
  assert.match(form[0], /type="hidden" name="kind" value="criterion"/, "the tab survives a search submit");
  assert.match(form[0], /type="hidden" name="status" value="active"/, "the status filter survives a search submit");
  // ⛔ an INACTIVE filter contributes no hidden field: `sort=""` and "no sort" are different states,
  // and a round-tripped empty key would render them the same (硬规则 3b).
  assert.ok(!/name="sort"/.test(form[0]), "an inactive sort contributes no hidden field");
  assert.ok(!/name="goal"/.test(form[0]), "an inactive goal filter contributes no hidden field");
});

// ── AC3 (proposal b): `?sort=acRollup` — ratio order, with 0/0 sunk in BOTH directions ────────

test("AC3: ?sort=acRollup orders by hand-computed ratio; 0/0 rows are LAST in both directions and are not 0%", async () => {
  const rows = goalRows((await get(port, "/goal")).body);
  console.log("[/goal] rollup column vs the hand-written table:");
  for (const r of rows.slice(0, 3)) console.log(`  ${r.id}  |  ${r.rollupText}`);

  // (i) the VALUES first, against a table written by hand from the AC list — independent of any
  //     ordering, so this arm would fail on its own if the口径 drifted.
  for (const r of rows) {
    assert.deepEqual(r.rollup, HAND_ROLLUPS[r.id], `${r.id}: rollup == the hand-written value`);
  }

  // (ii) the ORDERS, as literal arrays.
  const desc = goalRows((await get(port, "/goal?sort=acRollup&dir=desc")).body).map((r) => r.id);
  const asc = goalRows((await get(port, "/goal?sort=acRollup&dir=asc")).body).map((r) => r.id);
  assert.deepEqual(desc, EXPECTED_DESC, "dir=desc: ratios descending");
  assert.deepEqual(asc, EXPECTED_ASC, "dir=asc: ratios ascending");
  // the two directions really differ (a no-op sort would return the same array twice and pass a
  // naive "it returns rows" arm).
  assert.notDeepEqual(desc, asc, "the two directions are not the same order");

  // (iii) 0/0 is NOT 0%. Ranked as a ratio it would be the MINIMUM, i.e. FIRST under `dir=asc`; the
  //       arm that pins this is therefore the ascending tail, not the descending one.
  assert.deepEqual(asc.slice(-2), ["GOAL-004", "GOAL-005"], "the two 0/0 rows are LAST under dir=asc");
  assert.deepEqual(desc.slice(-2), ["GOAL-004", "GOAL-005"], "…and last under dir=desc");
  assert.notEqual(asc[0], "GOAL-004", "0/0 is not ranked as the lowest ratio");
  // ⛔ and it is its OWN value: not `—` (the "no evidence" marker elsewhere on this page) and not a
  // percentage. GOAL-005 is the discriminating row — its only AC is `superseded`, OUT of the rollup
  // denominator, so a looser denominator would render `0/1` and rank it as a real 0%.
  const zero = rows.find((r) => r.id === "GOAL-005");
  assert.equal(zero.rollupText, "0/0", "a goal whose only AC is out-of-domain renders 0/0, not 0/1");
  assert.notEqual(zero.rollupText, "—", "…and not the no-evidence marker");

  // (iv) `q` and the rollup sort compose: the sort applies to the SEARCHED rows, and the rollups stay
  //      the full-population values (a search narrows the rows, never the denominator).
  const searched = goalRows((await get(port, "/goal?q=layer&sort=acRollup&dir=desc")).body);
  assert.deepEqual(searched.map((r) => r.id), ["GOAL-002", "GOAL-001"], "the searched subset keeps the ratio order");
  assert.deepEqual(searched.map((r) => r.rollup), [HAND_ROLLUPS["GOAL-002"], HAND_ROLLUPS["GOAL-001"]],
    "…and each row's rollup is still computed over the FULL record set, not over the search hits");
});

// ── AC4 (proposal a + d): the new copy is serve-i18n copy, measured by rendering BOTH languages ─

test("AC4: the search box and the no-match state are dictionary-driven (they move with the language)", async () => {
  // ⚠️ The measurement is the DIFFERENCE between the two renders, not a source grep (硬规则 2: a
  // literal inside a comment would be a false hit). A page that hard-coded English would satisfy the
  // en arms below and fail exactly here.
  for (const key of ["searchPlaceholder", "searchButton", "searchNoMatch", "searchClear"]) {
    assert.notEqual(GOAL_LABELS[key].en, GOAL_LABELS[key].zh, `${key}: the two columns are not the same string`);
  }
  for (const key of ["searchNoMatch"]) {
    assert.deepEqual(
      [...GOAL_LABELS[key].en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      [...GOAL_LABELS[key].zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      `${key}: both columns carry the same placeholder names (a one-sided template is not translatable)`,
    );
  }

  const zh = await get(port, "/goal?q=absent-needle-xyz", "lang=zh");
  const en = await get(port, "/goal?q=absent-needle-xyz", "lang=en");
  assert.ok(zh.body.includes(`placeholder="${GOAL_LABELS.searchPlaceholder.zh}"`),
    "the zh page carries the zh placeholder");
  assert.ok(!zh.body.includes(`placeholder="${GOAL_LABELS.searchPlaceholder.en}"`),
    "…and not the en one");
  assert.ok(zh.body.includes(`>${GOAL_LABELS.searchButton.zh}</button>`), "the zh page carries the zh button label");
  assert.ok(zh.body.includes(fillLabel(GOAL_LABELS.searchNoMatch.zh, { q: "absent-needle-xyz" })),
    "the zh no-match sentence is the dictionary's zh column");
  assert.ok(!zh.body.includes(fillLabel(GOAL_LABELS.searchNoMatch.en, { q: "absent-needle-xyz" })),
    "…and not the en sentence");
  assert.ok(en.body.includes(`placeholder="${GOAL_LABELS.searchPlaceholder.en}"`), "the en page carries the en placeholder");
  // ⛔ the reader's OWN query is HTML-escaped on the way into the sentence (it is user input, and the
  // dictionary is copy-only): `?q=<img>` must not become an element.
  const escaped = await get(port, "/goal?q=%3Cimg%20src%3Dx%3E");
  assert.ok(!/<img/.test(escaped.body), "a tag-shaped query is escaped, never rendered as markup");
  assert.ok(escaped.body.includes("&lt;img"), "…it appears as text");
});
