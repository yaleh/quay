// @test-group product
// gap-ac301-goal-page-zh-chrome-nav-current-and-own-title — the /goal LIST page's OWN zh chrome
// (AC-301 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the two
// dictionaries (the 15 shared nav labels + the per-page PAGE_LABELS). AC-290 wired the FIRST page to
// them; AC-291~300 wired the next eleven. This task wires the THIRTEENTH — the /goal LIST route —
// and nothing in the mechanism or the dictionaries moves: only this page's call sites and this
// page's TWO new PAGE_LABELS tokens.
//
// The judge is a REAL server read through raw HTTP (hard rule 4 推论三: grepping the source proves
// the code CAN produce a reading, not that a live process DID). Every arm is asserted SEPARATELY and
// each one prints its raw fragment (hard rule 3: enumerate, don't report a boolean "the page looks
// translated") — a single combined assertion would leave it unknowable WHICH site a regression
// broke, which is precisely the granularity the goal criterion's `CAUSE=` names.
//
// ⚠️ THREE of this page's chrome sites are OUTSIDE the goal criterion's reach, and AC1b asserts them
// from the raw body rather than through the nav region:
//   ① `<span class="mobile-header-page">` — rendered before the first `<nav>`;
//   ② the `<h1>` — inside `<main>`, after the nav;
//   ③ the `Tab: <strong>…</strong>` indicator — likewise inside `<main>`.
// Leaving any of them English would be a mechanical criterion weaker than the spec's intent: this
// page's OWN chrome must switch as a whole.
//
// ⚠️ TWO tokens, and they differ ONLY IN CASE (`Goals` / `goals`) — the same case-split trap AC-300
// set on /adr. `pageNameFor` is an EXACT-token lookup, so `Goals` does not serve `goals`: registering
// only the capitalised key leaves the mobile header English while the <title> switches, and
// registering only the lowercase one does the reverse. The `AC-dict` arms below assert the case
// distinction MEASURABLY (an all-caps `GOALS` token must MISS) rather than asserting "both entries
// exist" — the latter would pass on a table that had collapsed them.
//
// ⚠️ The `<h1>` is a DYNAMIC string: `<token> — <subtitle> (<n>)`. Only its constant prefix is
// registered; the subtitle and the count are interpolated raw at the call site. The arms below
// therefore assert the SHAPE rather than a finished string — asserting `"Goals — 阶段目标 (2)"` would
// pin the fixture's record count and go stale the moment a goal is added, which is exactly the
// failure mode the task warns against.
//
// The nav region is extracted with the SAME method the goal criterion uses (flatten newlines, then a
// GREEDY `/<nav.*<\/nav>/`) so this test and the criterion cannot drift on what "the nav region"
// means. That greedy region is chrome-ONLY by construction: the two `<nav` producers live in
// `renderSiteNav`/`renderMobileChrome`, both of which emit before `<main>`, so the match can never
// swallow this page's `<h1>` or the goals table. (The two other `<nav>` producers in this repo —
// `serve-task.ts:731/799` — belong to the task detail page, which /goal never renders.) The scoping
// arms below MEASURE that rather than assuming it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { pageNameFor } from "../src/serve-i18n.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The two tokens THIS page registers — pinned as literals, byte-equal to the `serve-goal.ts` call
 *  sites. Deriving them from PAGE_LABELS would make the assertions below a tautology (硬规则 4).
 *  `TITLE_TOKEN` is what `pageTitle` receives; `H1_TOKEN` is what the `<h1>`'s constant prefix and
 *  the tab-nav label carry — the three are byte-equal HERE (the AC-294/AC-295/AC-298/AC-300
 *  one-entry shape), and the `AC-dict` arm asserts that too so a later divergence cannot pass
 *  unnoticed. `MOBILE_TOKEN` is the LOWERCASE label the mobile header carries (the AC-290
 *  `"task list"` / AC-297 `"git history"` / AC-298 `tests` / AC-299 `sessions` / AC-300 `adrs`
 *  shape). */
const TITLE_TOKEN = "Goals";
const H1_TOKEN = "Goals";
const TAB_TOKEN = "Goals";
const MOBILE_TOKEN = "goals";
const TITLE_ZH = "目标";
const H1_ZH = "目标";
const TAB_ZH = "目标";
const MOBILE_ZH = "目标";

/** The literal the goal criterion fails the page on. Pinned as a literal on purpose — see the note
 *  on TITLE_TOKEN. ⚠️ The LIVE en `<title>` is `quay — Goals`, but its prefix is
 *  `projectLabel(identity)` — the WORKSPACE's project name — so under this fixture it is either the
 *  temp dir's basename or the explicit 「未接入项目身份」 label. The arms below therefore assert the
 *  ` — <token>` SUFFIX (which is this page's own chrome, and is what the task actually moves) rather
 *  than the whole string; the identity prefix is AC-289's pageTitle contract, not this task's
 *  surface. */
const LABEL_EN = "Goals";

/** A fixture goal whose TITLE carries the literal `Goals` — the DATA-side hit, deliberately present.
 *  Without it, every "the literal is absent" arm below would be satisfiable by a page that simply had
 *  no such string anywhere, and the chrome/data split AC3 asks for could not be measured at all
 *  (hard rule 2: a zero count needs a predicate-proof, not an assertion). It renders inside `<main>`,
 *  i.e. OUTSIDE the criterion's nav region — which is exactly the scoping statement the control arms
 *  make. */
const DATA_GOAL_TITLE = "Goals rollup for the web face";

let server, port, originalCwd, workspaceRoot;

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

/** The nav region, extracted exactly as the AC-301 goal criterion extracts it. */
function navRegion(body) {
  const m = /<nav.*<\/nav>/.exec(body.replace(/\n/g, " "));
  return m ? m[0] : "";
}

function headTitle(body) {
  const m = /<title>([^<]*)<\/title>/.exec(body.replace(/\n/g, " "));
  return m ? m[1] : "";
}

function h1Of(body) {
  const m = /<h1>([^<]*)<\/h1>/.exec(body);
  return m ? m[1] : "";
}

function mobileHeaderPage(body) {
  const m = /<span class="mobile-header-page">([^<]*)<\/span>/.exec(body);
  return m ? m[1] : "";
}

/** The `Tab: <strong>…</strong>` indicator — this page's own chrome, rendered inside `<main>`
 *  (therefore outside the criterion's nav region, exactly like the `<h1>`). */
function tabStrong(body) {
  const m = /<p class="meta">Tab: <strong>([^<]*)<\/strong>/.exec(body.replace(/\n/g, " "));
  return m ? m[1] : "";
}

/** Every occurrence of `needle` (case-sensitive) with a little surrounding context, for the AC3
 *  enumeration. Returned as raw fragments so the evidence is quotable rather than summarised. */
function occurrences(body, needle) {
  const flat = body.replace(/\n/g, " ");
  const out = [];
  let i = flat.indexOf(needle);
  while (i !== -1) {
    out.push(flat.slice(Math.max(0, i - 24), i + needle.length + 12));
    i = flat.indexOf(needle, i + needle.length);
  }
  return out;
}

before(async () => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac301-ws-"));
  const tasksDir = path.join(workspaceRoot, "tasks");
  const adrDir = path.join(workspaceRoot, "adr");
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(adrDir, { recursive: true });
  fs.mkdirSync(goalsDir, { recursive: true });
  // The DATA-side literal (see DATA_GOAL_TITLE): a goal whose title is not chrome. It renders into
  // the goals table's `<td>`, i.e. inside `<main>` and outside the nav region.
  fs.writeFileSync(path.join(goalsDir, "GOAL-001-web-face.md"),
    `---\nid: GOAL-001\ntitle: ${DATA_GOAL_TITLE}\nstatus: active\nkind: goal\norigin: 2026-09-17 fixture\n---\n## Goal\none target statement\n`);
  // A second, literal-free goal so the fixture is not "the page that has the word everywhere".
  fs.writeFileSync(path.join(goalsDir, "GOAL-002-plain.md"),
    "---\nid: GOAL-002\ntitle: plain record\nstatus: active\nkind: goal\norigin: 2026-09-17 fixture\n---\n## Goal\nanother statement\n");
  // A criterion record so the sibling tab exists (it must NOT be required to switch: see the AC-301
  // residue note in serve-goal.ts — `Criteria` needs a third PAGE_LABELS entry this task does not
  // grant).
  fs.writeFileSync(path.join(goalsDir, "AC-900-plain.md"),
    "---\nid: AC-900\ntitle: plain criterion\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\norigin: 2026-09-17 fixture\n---\n## Rationale\nmeasured\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`,
  );
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  // port 0: let the kernel pick — probe-then-bind is a TOCTOU that races the kernel and leaks the
  // provider child process on a collision (recorded in packages/quay/test/serve-board.test.mjs).
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("AC-dict: this page's two tokens resolve through pageNameFor, `en` is the identity, and the lookup is CASE-EXACT", () => {
  assert.equal(pageNameFor(TITLE_TOKEN, "en"), TITLE_TOKEN,
    "en is the identity for the /goal <title> token — the en baseline cannot move by construction");
  assert.equal(pageNameFor(H1_TOKEN, "en"), H1_TOKEN,
    "en is the identity for the /goal <h1> token");
  assert.equal(pageNameFor(TAB_TOKEN, "en"), TAB_TOKEN,
    "en is the identity for the /goal tab-nav token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "en"), MOBILE_TOKEN,
    "en is the identity for the /goal mobile-header token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_ZH, "zh translates the /goal <title> token");
  assert.equal(pageNameFor(H1_TOKEN, "zh"), H1_ZH, "zh translates the /goal <h1> token");
  assert.equal(pageNameFor(TAB_TOKEN, "zh"), TAB_ZH, "zh translates the /goal tab-nav token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "zh"), MOBILE_ZH, "zh translates the /goal mobile-header token");
  // This page is one of the family's one-entry cases: the <title> token, the <h1> prefix token and
  // the tab-nav token are the same string. Asserted explicitly — if a later change gave the <h1> or
  // the tab its own token, this arm is what says the one-entry assumption moved.
  assert.equal(TITLE_TOKEN, H1_TOKEN,
    "this page's <title> and <h1> tokens really are byte-equal (the one-entry shape is the assumption)");
  assert.equal(TITLE_TOKEN, TAB_TOKEN,
    "this page's <title> and tab-nav tokens really are byte-equal (same one-entry shape)");
  // ⚠️ The case distinction is the load-bearing part: `Goals` and `goals` are two INDEPENDENT
  // lookups. Asserting "both entries exist" would pass on a table that had collapsed them, so assert
  // the behaviour that distinguishes them — an all-caps `GOALS` is NOT a registered key and must
  // MISS.
  assert.notEqual(pageNameFor("GOALS", "zh"), TITLE_ZH,
    "case control: the all-caps token `GOALS` is NOT registered — the lookup is byte-exact, so the " +
    "`Goals` entry does not silently absorb it");
  assert.equal(pageNameFor("GOALS", "zh"), "GOALS",
    "case control: an unregistered token falls back to itself (the visible-degradation contract)");
  assert.notEqual(pageNameFor("goal", "zh"), MOBILE_ZH,
    "case control: the singular nav-key spelling `goal` is NOT a PAGE_LABELS key either — the page " +
    "dictionary is keyed by the page's OWN token, not by the nav roster's keys");
  // The criterion fails the page on the ASCII literal inside the NAV region; the title arm fails it
  // on the same literal in this page's own <title>/<h1>. A zh value that still carried the English
  // word ("目标 Goals") would satisfy "non-empty" while defeating both — assert the absent literal.
  //
  // ⚠️ The MOBILE token is lowercase (`goals`), so asserting the capitalised literal alone would be
  // a TAUTOLOGY, not a measurement (硬规则 4). Its arm is therefore case-INSENSITIVE — the shape
  // that can actually fail — and the controls below show the en peers tripping the very same
  // predicates.
  assert.ok(!pageNameFor(TITLE_TOKEN, "zh").includes(LABEL_EN),
    `the zh <title> token does not carry the ASCII literal "${LABEL_EN}"`);
  assert.ok(!pageNameFor(H1_TOKEN, "zh").includes(LABEL_EN),
    `the zh <h1> token does not carry the ASCII literal "${LABEL_EN}"`);
  assert.ok(!pageNameFor(TAB_TOKEN, "zh").includes(LABEL_EN),
    `the zh tab-nav token does not carry the ASCII literal "${LABEL_EN}"`);
  assert.ok(!pageNameFor(MOBILE_TOKEN, "zh").toLowerCase().includes(LABEL_EN.toLowerCase()),
    `the zh mobile token does not carry "${LABEL_EN}" in any case`);
  // Control — the literal predicates are not vacuous: they DO fire on the en tokens they must reject.
  assert.ok(pageNameFor(TITLE_TOKEN, "en").includes(LABEL_EN),
    `control: the "${LABEL_EN}" predicate fires on the en title token it must reject`);
  assert.ok(pageNameFor(H1_TOKEN, "en").includes(LABEL_EN),
    `control: the "${LABEL_EN}" predicate fires on the en h1 token it must reject`);
  assert.ok(pageNameFor(TAB_TOKEN, "en").includes(LABEL_EN),
    `control: the "${LABEL_EN}" predicate fires on the en tab-nav token it must reject`);
  assert.ok(pageNameFor(MOBILE_TOKEN, "en").toLowerCase().includes(LABEL_EN.toLowerCase()),
    `control: the case-insensitive "${LABEL_EN}" predicate fires on the en mobile token it must reject`);
});

test("AC1: /goal under Cookie lang=zh switches the page header, nav current item (desktop+mobile) and own <title>", async () => {
  const en = await request(port, "/goal");
  const zh = await request(port, "/goal", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /goal (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /goal (zh) returns 200 (got ${zh.status})`);

  // ① the page-header language attribute — the criterion's FIRST arm, i.e. the one that is red today.
  assert.ok(en.body.includes('<html lang="en"'), "① en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "① zh response is <html lang=\"zh\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // ⑥ (stated first because every "absent under zh" arm below is VACUOUS without it): the en negative
  //    control is unchanged from the pre-AC-301 live baseline.
  assert.ok(navEn.includes(LABEL_EN),
    `⑥ en nav region still carries the literal "${LABEL_EN}" (the criterion's own baseline assumption)`);
  assert.ok(headTitle(en.body).endsWith(` — ${TITLE_TOKEN}`),
    `⑥ en <title> still ends with this page's own pre-AC-301 token (got ${JSON.stringify(headTitle(en.body))})`);

  // ② NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3: enumerate, don't report
  //    a boolean "the nav looks translated"). This page's current item is `NAV_LABELS.goal` — shared
  //    chrome wired by AC-289 — so these arms prove the page actually renders through the dictionary.
  const desktopEn = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const desktopZh = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  const mobileEn = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const mobileZh = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  console.log(`  [ac301] en desktop nav-current = ${JSON.stringify(desktopEn)}`);
  console.log(`  [ac301] zh desktop nav-current = ${JSON.stringify(desktopZh)}`);
  console.log(`  [ac301] en mobile  nav-current = ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac301] zh mobile  nav-current = ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, LABEL_EN, `② en desktop current item is the baseline (got ${JSON.stringify(desktopEn)})`);
  assert.equal(mobileEn, LABEL_EN, `② en mobile current item is the baseline (got ${JSON.stringify(mobileEn)})`);
  assert.equal(desktopZh, MOBILE_ZH, `② zh desktop current item is translated (got ${JSON.stringify(desktopZh)})`);
  assert.equal(mobileZh, MOBILE_ZH, `② zh mobile current item is translated (got ${JSON.stringify(mobileZh)})`);

  // ③ the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(LABEL_EN),
    `③ the zh nav region carries no literal "${LABEL_EN}"`);

  // Scoping control: the SAME predicate on the SAME response DOES fire outside the nav region. This
  // page is a STRONGER instance of that control than its siblings: the fixture data itself carries
  // the literal (`${DATA_GOAL_TITLE}` in a <td>, plus this page's own <title>/<h1>/tab chrome), so
  // "absent from the nav region" is demonstrably a statement about SCOPE and not about the page
  // having no such string at all.
  const navHits = occurrences(navEn, LABEL_EN).length;
  const bodyHits = occurrences(en.body, LABEL_EN).length;
  console.log(`  [ac301] en literal "${LABEL_EN}": nav region ${navHits} hit(s), whole body ${bodyHits} hit(s)`);
  assert.equal(navHits, 2, `control: the en nav region carries the literal exactly twice (desktop+mobile), got ${navHits}`);
  assert.ok(bodyHits > navHits,
    `control: the en literal also occurs OUTSIDE the nav region (${bodyHits} > ${navHits}) — the nav match is really scoping`);
  // …and the DATA-side hit is still there under zh: the dictionary translates CHROME, never records.
  // Asserted so a future "translate everything" change cannot quietly rewrite stored data.
  assert.ok(zh.body.includes(DATA_GOAL_TITLE),
    `control: the zh response still renders the record's own title verbatim (${JSON.stringify(DATA_GOAL_TITLE)}) — data is not chrome`);

  // ④ this page's OWN <title>. Asserted as a pair AND as a difference (the criterion's shape), with
  //    both raw fragments printed side by side.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac301] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac301] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.includes(LABEL_EN), `④ en <title> carries the literal baseline (got ${JSON.stringify(tEn)})`);
  assert.notEqual(tZh, tEn, "④ the page's OWN <title> is not byte-identical across the two languages");
  assert.ok(!tZh.includes(LABEL_EN), `④ the zh <title> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(tZh)})`);
  assert.ok(tZh.includes(TITLE_ZH), `④ the zh <title> carries the translated token (got ${JSON.stringify(tZh)})`);
});

test("AC1b: the three chrome sites OUTSIDE the criterion's nav region also switch (mobile header, <h1>, tab indicator)", async () => {
  // The criterion CANNOT see any of these: `<span class="mobile-header-page">` sits before the first
  // `<nav>`, and the `<h1>` and the `Tab:` indicator sit inside `<main>` after it, so the greedy
  // `/<nav.*<\/nav>/` region contains none of them. They are nevertheless this page's own chrome,
  // and leaving them English would be a mechanical criterion that is weaker than the spec's intent.
  // Asserted from the raw body, NOT via the nav region (hard rule 3: three separate arms, three
  // separate fragments).
  const en = await request(port, "/goal");
  const zh = await request(port, "/goal", { Cookie: "lang=zh" });

  // ① the mobile header page label — the ONLY site that consumes the LOWERCASE `goals` entry. If the
  //    table ever lost that entry this is the arm that fails, and the criterion's own arms would all
  //    stay green (it reads only the nav region and the <title>).
  const enLabel = mobileHeaderPage(en.body);
  const zhLabel = mobileHeaderPage(zh.body);
  console.log(`  [ac301] en mobile-header-page = ${JSON.stringify(enLabel)}`);
  console.log(`  [ac301] zh mobile-header-page = ${JSON.stringify(zhLabel)}`);
  assert.equal(enLabel, MOBILE_TOKEN, `① en mobile header page label is the baseline (got ${JSON.stringify(enLabel)})`);
  assert.equal(zhLabel, MOBILE_ZH, `① zh mobile header page label is translated (got ${JSON.stringify(zhLabel)})`);
  assert.ok(!zhLabel.toLowerCase().includes(LABEL_EN.toLowerCase()),
    `① the zh mobile header page label carries no "${LABEL_EN}" in any case`);
  // Control: the label is genuinely OUTSIDE the criterion's nav region — otherwise this arm would be
  // a restatement of AC1②'s mobile arm rather than a second, independent site.
  assert.ok(!navRegion(zh.body).includes('class="mobile-header-page"'),
    "control: the mobile header page label is NOT inside the criterion's nav region — a distinct site");
  // Control: the en label DOES trip the predicate this arm asserts on — a vacuous predicate would
  // pass the arm above without measuring anything.
  assert.ok(enLabel.toLowerCase().includes(LABEL_EN.toLowerCase()),
    `control: the "${LABEL_EN}" predicate fires on the en mobile header label it must reject`);

  // ② this page's OWN <h1> — a DYNAMIC string. Asserted by SHAPE, not by a finished literal: the
  //    constant prefix must be the translated token and the subtitle/count must still be
  //    interpolated raw (pinning `目标 — 阶段目标 (2)` would make this arm go stale as soon as the
  //    fixture gains a goal).
  const h1En = h1Of(en.body);
  const h1Zh = h1Of(zh.body);
  console.log(`  [ac301] en <h1> = ${JSON.stringify(h1En)}`);
  console.log(`  [ac301] zh <h1> = ${JSON.stringify(h1Zh)}`);
  assert.match(h1En, new RegExp(`^${LABEL_EN} — .+ \\(\\d+\\)$`),
    `② the en <h1> is "<token> — <subtitle> (<n>)" with the count interpolated (got ${JSON.stringify(h1En)})`);
  assert.match(h1Zh, new RegExp(`^${H1_ZH} — .+ \\(\\d+\\)$`),
    `② the zh <h1> is the translated token with the SAME interpolated shape (got ${JSON.stringify(h1Zh)})`);
  assert.ok(!h1Zh.includes(LABEL_EN), `② the zh <h1> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(h1Zh)})`);
  assert.ok(!navRegion(zh.body).includes("<h1>"),
    "control: the <h1> is NOT inside the criterion's nav region — a distinct site");
  // Control: the shape predicate is not vacuous — it rejects a <h1> that dropped the count entirely,
  // which is what a naive "translate the whole string" fix would have produced.
  assert.ok(!new RegExp(`^${LABEL_EN}$`).test(h1En), "control: the shape predicate rejects a count-less <h1>");

  // ③ the `Tab: <strong>…</strong>` indicator — the "trap 3" site the task names. The sibling
  //    `Criteria` label on the same line is DELIBERATELY not wired (it would need a third
  //    PAGE_LABELS entry outside this task's two-token scope); it is registered as named residue in
  //    serve-goal.ts, so what is asserted here is only the `Goals` half.
  const tabEn = tabStrong(en.body);
  const tabZh = tabStrong(zh.body);
  console.log(`  [ac301] en tab indicator = ${JSON.stringify(tabEn)}`);
  console.log(`  [ac301] zh tab indicator = ${JSON.stringify(tabZh)}`);
  assert.equal(tabEn, TAB_TOKEN, `③ en tab indicator is the baseline (got ${JSON.stringify(tabEn)})`);
  assert.equal(tabZh, TAB_ZH, `③ zh tab indicator is translated (got ${JSON.stringify(tabZh)})`);
  assert.ok(!tabZh.includes(LABEL_EN), `③ the zh tab indicator carries no ASCII "${LABEL_EN}"`);
  assert.ok(!navRegion(zh.body).includes('class="meta">Tab:'),
    "control: the tab indicator is NOT inside the criterion's nav region — a distinct site");
  // Control: the en indicator DOES trip the predicate — the arm is not vacuous.
  assert.ok(tabEn.includes(LABEL_EN),
    `control: the "${LABEL_EN}" predicate fires on the en tab indicator it must reject`);
  // Named residue, asserted as PRESENT so it cannot be silently claimed as wired: the sibling label
  // is still English under zh. If a later task wires it, this arm fails and forces that task to
  // update this file deliberately rather than discovering the change by accident.
  assert.ok(zh.body.includes("<strong>Criteria</strong>") || zh.body.includes(">Criteria</a>"),
    "residue: the sibling `Criteria` tab label is still English under zh — registered by name in " +
    "serve-goal.ts, ⛔ not silently counted as bilingual");
});

test("AC1⑥: the en baseline is byte-identical with and without an explicit ?lang=en", async () => {
  // A lang-parameterised renderer that quietly changed the DEFAULT rendering would move the
  // criterion's en baseline. This pins it: no query, no cookie ≡ an explicit `?lang=en`.
  const bare = await request(port, "/goal");
  const explicit = await request(port, "/goal?lang=en");
  assert.equal(navRegion(bare.body), navRegion(explicit.body),
    "the default-locale nav region is identical with and without an explicit ?lang=en");
  assert.equal(headTitle(bare.body), headTitle(explicit.body),
    "the default-locale <title> is identical with and without an explicit ?lang=en");
  assert.equal(h1Of(bare.body), h1Of(explicit.body),
    "the default-locale <h1> is identical with and without an explicit ?lang=en");
  assert.equal(mobileHeaderPage(bare.body), mobileHeaderPage(explicit.body),
    "the default-locale mobile header page label is identical with and without an explicit ?lang=en");
  assert.equal(tabStrong(bare.body), tabStrong(explicit.body),
    "the default-locale tab indicator is identical with and without an explicit ?lang=en");
  // /goal has no per-request counters (no `age Ns` lifecycle lines like /sessions), so the WHOLE body
  // is pinnable — a stronger reading than the chrome-only comparison above.
  assert.equal(bare.body, explicit.body,
    "the whole default-locale /goal response is byte-identical with and without an explicit ?lang=en");
});

test("AC3-scope: the criterion's nav region is chrome-ONLY on this page (the greedy match cannot swallow <main>)", async () => {
  // The criterion uses a GREEDY `/<nav.*<\/nav>/`, so a page that emitted a `<nav>` after `<main>`
  // would let the match swallow page content and make the "no English label in the nav region" arm
  // unpassable (or, in the other direction, vacuous). /goal's two `<nav>` producers both live in
  // serve-render.ts and both emit before `<main>`, so the region is chrome-only BY CONSTRUCTION.
  // Measured here rather than asserted, because "by construction" is exactly the kind of claim that
  // goes stale silently (硬规则 4b).
  const en = await request(port, "/goal");
  const flat = en.body.replace(/\n/g, " ");
  const navOpens = occurrences(flat, "<nav").length;
  const navCloses = occurrences(flat, "</nav>").length;
  console.log(`  [ac301] en <nav occurrences = ${navOpens}, </nav> occurrences = ${navCloses}`);
  assert.equal(navOpens, 2, `exactly two <nav> producers on this page (site nav + mobile menu), got ${navOpens}`);
  assert.equal(navCloses, 2, `the two <nav> elements are closed, got ${navCloses}`);
  const region = navRegion(en.body);
  assert.ok(!region.includes("<h1>"),
    "the greedy nav region does not contain the <h1> — it ends before <main>");
  assert.ok(!region.includes("<table"),
    "the greedy nav region does not contain the goals table — it ends before <main>");
  assert.ok(!region.includes(DATA_GOAL_TITLE),
    "the greedy nav region does not contain the DATA record (the data/chrome split AC3 asks for)");
  console.log(`  [ac301] en nav region: ${region.length} bytes of ${en.body.length} total`);
});
