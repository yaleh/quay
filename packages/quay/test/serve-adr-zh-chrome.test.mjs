// @test-group product
// gap-ac300-adr-page-zh-chrome-nav-current-and-own-title — the /adr page's OWN zh chrome
// (AC-300 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the two
// dictionaries (the 15 shared nav labels + the per-page PAGE_LABELS). AC-290 wired the FIRST page to
// them; AC-291~299 wired the next ten. This task wires the TWELFTH — /adr — and nothing in the
// mechanism or the dictionaries moves: only this page's four call sites and this page's TWO new
// PAGE_LABELS tokens.
//
// The judge is a REAL server read through raw HTTP (hard rule 4 推论三: grepping the source proves
// the code CAN produce a reading, not that a live process DID). Every arm is asserted SEPARATELY and
// each one prints its raw fragment (hard rule 3: enumerate, don't report a boolean "the page looks
// translated") — a single combined assertion would leave it unknowable WHICH of the four sites a
// regression broke, which is precisely the granularity the goal criterion's `CAUSE=` names.
//
// ⚠️ TWO tokens, and they differ ONLY IN CASE (`ADRs` / `adrs`) — the trap this page sets and no
// earlier page in the family did. `pageNameFor` is an EXACT-token lookup, so `ADRs` does not serve
// `adrs`: registering only the capitalised key would leave the mobile header English while the
// <title> switched, and registering only the lowercase one would do the reverse. The `AC-dict` arms
// below assert the case distinction MEASURABLY (an all-caps `ADRS` token must MISS) rather than
// asserting "both entries exist" — the latter would pass on a table that had collapsed them.
//
// ⚠️ The `<h1>` is a DYNAMIC string: `ADRs (${adrs.length})`. Only its constant part is registered;
// the count is interpolated raw at the call site. The arms below therefore assert the SHAPE
// `<token> (<n>)` rather than a finished string — asserting `"ADRs (2)"` would pin the fixture's
// record count and go stale the moment an ADR is added, which is exactly the failure mode the task
// warns about.
//
// The nav region is extracted with the SAME method the goal criterion uses (flatten newlines, then a
// GREEDY `/<nav.*<\/nav>/`) so this test and the criterion cannot drift on what "the nav region"
// means. That greedy region is chrome-ONLY by construction: the two `<nav` producers live in
// `renderSiteNav`/`renderMobileChrome`, both of which emit before `<main>`, so the match can never
// swallow this page's `<h1>` or the ADR table. (The two other `<nav>` producers in this repo —
// `serve-task.ts:731/799` — belong to the task detail page, which /adr never renders.) The scoping
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

/** The two tokens THIS page registers — pinned as literals, byte-equal to the `serve-adr.ts` call
 *  sites. Deriving them from PAGE_LABELS would make the assertions below a tautology (硬规则 4).
 *  `TITLE_TOKEN` is what `pageTitle` receives; `H1_TOKEN` is what the `<h1>` receives — the two are
 *  byte-equal HERE (the one page in the family where one entry serves both), and the `AC-dict` arm
 *  asserts that too so a later divergence cannot pass unnoticed. `MOBILE_TOKEN` is the LOWERCASE
 *  label the mobile header carries (the AC-290 `"task list"` / AC-297 `"git history"` / AC-298
 *  `tests` / AC-299 `sessions` shape). */
const TITLE_TOKEN = "ADRs";
const H1_TOKEN = "ADRs";
const MOBILE_TOKEN = "adrs";
const TITLE_ZH = "架构决策";
const H1_ZH = "架构决策";
const MOBILE_ZH = "架构决策";

/** The literal the goal criterion fails the page on. Pinned as a literal on purpose — see the note
 *  on TITLE_TOKEN. ⚠️ The LIVE en `<title>` is `quay — ADRs`, but its prefix is
 *  `projectLabel(identity)` — the WORKSPACE's project name — so under this fixture it is the temp
 *  dir's basename, not `quay`. The arms below therefore assert the ` — <token>` SUFFIX (which is
 *  this page's own chrome, and is what the task actually moves) rather than the whole string; the
 *  identity prefix is AC-289's pageTitle contract and is not this task's surface. */
const LABEL_EN = "ADRs";

/** A fixture ADR whose TITLE carries the literal `ADRs` — the DATA-side hit, deliberately present.
 *  Without it, every "the literal is absent" arm below would be satisfiable by a page that simply
 *  had no such string anywhere, and the chrome/data split AC3 asks for could not be measured at all
 *  (hard rule 2: a zero count needs a predicate-proof, not an assertion). */
const DATA_ADR_TITLE = "Serve ADRs as HTML";

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

/** The nav region, extracted exactly as the AC-300 goal criterion extracts it. */
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
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac300-ws-"));
  const tasksDir = path.join(workspaceRoot, "tasks");
  const adrDir = path.join(workspaceRoot, "adr");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(adrDir, { recursive: true });
  fs.writeFileSync(path.join(adrDir, "ADR-001-tdd-scope.md"),
    "---\nid: ADR-001\ntitle: TDD scope\nstatus: accepted\ndate: 2026-07-19\n---\n## Context\nc\n## Decision\nThe invariant we adopt.\n## Consequences\ne\n");
  fs.writeFileSync(path.join(adrDir, "ADR-002-serve-adrs-as-html.md"),
    `---\nid: ADR-002\ntitle: ${DATA_ADR_TITLE}\nstatus: accepted\ndate: 2026-07-20\n---\n## Context\nc\n## Decision\nd\n## Consequences\ne\n`);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n`,
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
    "en is the identity for the /adr <title> token — the en baseline cannot move by construction");
  assert.equal(pageNameFor(H1_TOKEN, "en"), H1_TOKEN,
    "en is the identity for the /adr <h1> token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "en"), MOBILE_TOKEN,
    "en is the identity for the /adr mobile-header token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_ZH, "zh translates the /adr <title> token");
  assert.equal(pageNameFor(H1_TOKEN, "zh"), H1_ZH, "zh translates the /adr <h1> token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "zh"), MOBILE_ZH, "zh translates the /adr mobile-header token");
  // This page is the family's ONE case (so far) where the <title> token and the <h1> token are the
  // same string, which is why a single entry serves both. Asserted explicitly: if a later change
  // gave the <h1> its own token, this arm is what says the two-entry assumption moved.
  assert.equal(TITLE_TOKEN, H1_TOKEN,
    "this page's <title> and <h1> tokens really are byte-equal (the one-entry shape is the assumption)");
  // ⚠️ The case distinction is the load-bearing part: `ADRs` and `adrs` are two INDEPENDENT lookups.
  // Asserting "both entries exist" would pass on a table that had collapsed them, so assert the
  // behaviour that distinguishes them — an all-caps `ADRS` is NOT a registered key and must MISS.
  assert.notEqual(pageNameFor("ADRS", "zh"), TITLE_ZH,
    "case control: the all-caps token `ADRS` is NOT registered — the lookup is byte-exact, so the " +
    "`ADRs` entry does not silently absorb it");
  assert.equal(pageNameFor("ADRS", "zh"), "ADRS",
    "case control: an unregistered token falls back to itself (the visible-degradation contract)");
  // The criterion fails the page on the ASCII literal inside the NAV region; the title arm fails it
  // on the same literal in this page's own <title>/<h1>. A zh value that still carried the English
  // word ("架构决策 ADRs") would satisfy "non-empty" while defeating both — assert the absent
  // literal.
  //
  // ⚠️ The MOBILE token is lowercase (`adrs`), so asserting the capitalised literal alone would be a
  // TAUTOLOGY, not a measurement (硬规则 4). Its arm is therefore case-INSENSITIVE — the shape that
  // can actually fail — and the controls below show the en peers tripping the very same predicates.
  assert.ok(!pageNameFor(TITLE_TOKEN, "zh").includes(LABEL_EN),
    `the zh <title> token does not carry the ASCII literal "${LABEL_EN}"`);
  assert.ok(!pageNameFor(H1_TOKEN, "zh").includes(LABEL_EN),
    `the zh <h1> token does not carry the ASCII literal "${LABEL_EN}"`);
  assert.ok(!pageNameFor(MOBILE_TOKEN, "zh").toLowerCase().includes(LABEL_EN.toLowerCase()),
    `the zh mobile token does not carry "${LABEL_EN}" in any case`);
  // Control — the literal predicates are not vacuous: they DO fire on the en tokens they must reject.
  assert.ok(pageNameFor(TITLE_TOKEN, "en").includes(LABEL_EN),
    `control: the "${LABEL_EN}" predicate fires on the en title token it must reject`);
  assert.ok(pageNameFor(H1_TOKEN, "en").includes(LABEL_EN),
    `control: the "${LABEL_EN}" predicate fires on the en h1 token it must reject`);
  assert.ok(pageNameFor(MOBILE_TOKEN, "en").toLowerCase().includes(LABEL_EN.toLowerCase()),
    `control: the case-insensitive "${LABEL_EN}" predicate fires on the en mobile token it must reject`);
});

test("AC1: /adr under Cookie lang=zh switches the page header, nav current item (desktop+mobile), own <title> and <h1>", async () => {
  const en = await request(port, "/adr");
  const zh = await request(port, "/adr", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /adr (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /adr (zh) returns 200 (got ${zh.status})`);

  // ① the page-header language attribute — the criterion's FIRST arm, i.e. the one that is red today.
  assert.ok(en.body.includes('<html lang="en"'), "① en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "① zh response is <html lang=\"zh\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // ⑥ (stated first because every "absent under zh" arm below is VACUOUS without it): the en negative
  //    control is unchanged from the pre-AC-300 live baseline.
  assert.ok(navEn.includes(LABEL_EN),
    `⑥ en nav region still carries the literal "${LABEL_EN}" (the criterion's own baseline assumption)`);
  assert.ok(headTitle(en.body).endsWith(` — ${TITLE_TOKEN}`),
    `⑥ en <title> still ends with this page's own pre-AC-300 token (got ${JSON.stringify(headTitle(en.body))})`);

  // ② NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3: enumerate, don't report
  //    a boolean "the nav looks translated"). This page's current item is `NAV_LABELS.adr` — shared
  //    chrome wired by AC-289 — so these arms prove the page actually renders through the dictionary.
  const desktopEn = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const desktopZh = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  const mobileEn = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const mobileZh = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  console.log(`  [ac300] en desktop nav-current = ${JSON.stringify(desktopEn)}`);
  console.log(`  [ac300] zh desktop nav-current = ${JSON.stringify(desktopZh)}`);
  console.log(`  [ac300] en mobile  nav-current = ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac300] zh mobile  nav-current = ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, LABEL_EN, `② en desktop current item is the baseline (got ${JSON.stringify(desktopEn)})`);
  assert.equal(mobileEn, LABEL_EN, `② en mobile current item is the baseline (got ${JSON.stringify(mobileEn)})`);
  assert.equal(desktopZh, MOBILE_ZH, `② zh desktop current item is translated (got ${JSON.stringify(desktopZh)})`);
  assert.equal(mobileZh, MOBILE_ZH, `② zh mobile current item is translated (got ${JSON.stringify(mobileZh)})`);

  // ③ the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(LABEL_EN),
    `③ the zh nav region carries no literal "${LABEL_EN}"`);

  // Scoping control: the SAME predicate on the SAME response DOES fire outside the nav region. This
  // page is a STRONGER instance of that control than its siblings: the fixture data itself carries
  // the literal (`${DATA_ADR_TITLE}` in a <td>), so "absent from the nav region" is demonstrably a
  // statement about SCOPE and not about the page having no such string at all.
  const navHits = occurrences(navEn, LABEL_EN).length;
  const bodyHits = occurrences(en.body, LABEL_EN).length;
  console.log(`  [ac300] en literal "${LABEL_EN}": nav region ${navHits} hit(s), whole body ${bodyHits} hit(s)`);
  assert.equal(navHits, 2, `control: the en nav region carries the literal exactly twice (desktop+mobile), got ${navHits}`);
  assert.ok(bodyHits > navHits,
    `control: the en literal also occurs OUTSIDE the nav region (${bodyHits} > ${navHits}) — the nav match is really scoping`);

  // ④ this page's OWN <title>. Asserted as a pair AND as a difference (the criterion's shape), with
  //    both raw fragments printed side by side.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac300] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac300] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.includes(LABEL_EN), `④ en <title> carries the literal baseline (got ${JSON.stringify(tEn)})`);
  assert.notEqual(tZh, tEn, "④ the page's OWN <title> is not byte-identical across the two languages");
  assert.ok(!tZh.includes(LABEL_EN), `④ the zh <title> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(tZh)})`);
  assert.ok(tZh.includes(TITLE_ZH), `④ the zh <title> carries the translated token (got ${JSON.stringify(tZh)})`);

  // ⑤ this page's OWN <h1> — a DYNAMIC string. Asserted by SHAPE, not by a finished literal: the
  //    constant part must be the translated token and the record count must still be interpolated
  //    raw (pinning `ADRs (2)` would make this arm go stale as soon as the fixture gains an ADR).
  const h1En = h1Of(en.body);
  const h1Zh = h1Of(zh.body);
  console.log(`  [ac300] en <h1> = ${JSON.stringify(h1En)}`);
  console.log(`  [ac300] zh <h1> = ${JSON.stringify(h1Zh)}`);
  assert.match(h1En, new RegExp(`^${LABEL_EN} \\(\\d+\\)$`),
    `⑤ the en <h1> is "<token> (<n>)" with the count interpolated (got ${JSON.stringify(h1En)})`);
  assert.match(h1Zh, new RegExp(`^${H1_ZH} \\(\\d+\\)$`),
    `⑤ the zh <h1> is the translated token with the SAME interpolated-count shape (got ${JSON.stringify(h1Zh)})`);
  assert.ok(!h1Zh.includes(LABEL_EN), `⑤ the zh <h1> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(h1Zh)})`);
  // Control: the shape predicate is not vacuous — it rejects a <h1> that dropped the count entirely,
  // which is what a naive "translate the whole string" fix would have produced.
  assert.ok(!/^ADRs$/.test(h1En), "control: the shape predicate rejects a count-less <h1>");
});

test("AC1b: the mobile header page label (rendered OUTSIDE the nav region) also switches", async () => {
  // The criterion CANNOT see this one: `<span class="mobile-header-page">` sits before the first
  // `<nav>`, so the greedy `/<nav.*<\/nav>/` region never contains it. It is nevertheless this
  // page's own chrome, and leaving it English would be a mechanical criterion that is weaker than
  // the spec's intent. Asserted from the raw body, NOT via the nav region.
  //
  // ⚠️ This is also the ONLY site that consumes the LOWERCASE `adrs` entry — the case-split trap.
  // If the table ever lost that entry this is the arm that fails, and the criterion's own arms above
  // would all stay green (it reads only the nav region and the <title>).
  const en = await request(port, "/adr");
  const zh = await request(port, "/adr", { Cookie: "lang=zh" });
  const enLabel = mobileHeaderPage(en.body);
  const zhLabel = mobileHeaderPage(zh.body);
  console.log(`  [ac300] en mobile-header-page = ${JSON.stringify(enLabel)}`);
  console.log(`  [ac300] zh mobile-header-page = ${JSON.stringify(zhLabel)}`);
  assert.equal(enLabel, MOBILE_TOKEN, `en mobile header page label is the baseline (got ${JSON.stringify(enLabel)})`);
  assert.equal(zhLabel, MOBILE_ZH, `zh mobile header page label is translated (got ${JSON.stringify(zhLabel)})`);
  assert.ok(!zhLabel.toLowerCase().includes(LABEL_EN.toLowerCase()),
    `the zh mobile header page label carries no "${LABEL_EN}" in any case`);
  // Control: the label is genuinely OUTSIDE the criterion's nav region — otherwise this test would be
  // a restatement of AC1②'s mobile arm rather than a second, independent site.
  assert.ok(!navRegion(zh.body).includes('class="mobile-header-page"'),
    "control: the mobile header page label is NOT inside the criterion's nav region — a distinct site");
  // Control: the en label DOES trip the predicate this test asserts on — a vacuous predicate would
  // pass the arm above without measuring anything.
  assert.ok(enLabel.toLowerCase().includes(LABEL_EN.toLowerCase()),
    `control: the "${LABEL_EN}" predicate fires on the en mobile header label it must reject`);
});

test("AC1⑥: the en baseline is byte-identical with and without an explicit ?lang=en", async () => {
  // A lang-parameterised renderer that quietly changed the DEFAULT rendering would move the
  // criterion's en baseline. This pins it: no query, no cookie ≡ an explicit `?lang=en`.
  const bare = await request(port, "/adr");
  const explicit = await request(port, "/adr?lang=en");
  assert.equal(navRegion(bare.body), navRegion(explicit.body),
    "the default-locale nav region is identical with and without an explicit ?lang=en");
  assert.equal(headTitle(bare.body), headTitle(explicit.body),
    "the default-locale <title> is identical with and without an explicit ?lang=en");
  assert.equal(h1Of(bare.body), h1Of(explicit.body),
    "the default-locale <h1> is identical with and without an explicit ?lang=en");
  assert.equal(mobileHeaderPage(bare.body), mobileHeaderPage(explicit.body),
    "the default-locale mobile header page label is identical with and without an explicit ?lang=en");
  // /adr has no per-request counters (unlike /sessions' `age Ns` lifecycle lines), so the WHOLE body
  // is pinnable — a stronger reading than the chrome-only comparison above.
  assert.equal(bare.body, explicit.body,
    "the whole default-locale /adr response is byte-identical with and without an explicit ?lang=en");
});

test("AC3: full residue enumeration of the literal in both responses, with chrome/data attribution", async () => {
  // 硬规则 3: enumerate, don't report a boolean. And 硬规则 2's both halves: the predicate is proven
  // NON-ZERO on a known-true sample before any zero is read off it.
  const en = await request(port, "/adr");
  const zh = await request(port, "/adr", { Cookie: "lang=zh" });
  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);

  const capEn = occurrences(en.body, "ADRs");
  const capZh = occurrences(zh.body, "ADRs");
  const lowEn = occurrences(en.body, "adrs");
  const lowZh = occurrences(zh.body, "adrs");

  console.log("  [ac300] ── AC3 residue enumeration ──");
  console.log(`  [ac300] en "${LABEL_EN}" hits (whole body) = ${capEn.length}`);
  capEn.forEach((f, i) => console.log(`    en#${i + 1}: …${f}…`));
  console.log(`  [ac300] zh "${LABEL_EN}" hits (whole body) = ${capZh.length}`);
  capZh.forEach((f, i) => console.log(`    zh#${i + 1}: …${f}…`));
  console.log(`  [ac300] en "adrs" hits (whole body) = ${lowEn.length}`);
  lowEn.forEach((f, i) => console.log(`    en#${i + 1}: …${f}…`));
  console.log(`  [ac300] zh "adrs" hits (whole body) = ${lowZh.length}`);
  lowZh.forEach((f, i) => console.log(`    zh#${i + 1}: …${f}…`));

  // The predicate is proven to be able to fire (non-zero on the en sample) BEFORE any absence is
  // read off the zh side — the half of 硬规则 2 that a green assertion cannot supply by itself.
  assert.ok(capEn.length > 0, "predicate proof: the case-sensitive predicate fires on the en response");
  assert.ok(lowEn.length > 0, "predicate proof: the lowercase predicate fires on the en response");

  // ── CHROME vs DATA, counted separately (⛔ never one total).
  // chrome = inside the nav region + this page's own <title>/<h1>/mobile-header. data = the <td>
  // cell rendered from the ADR store. The split is computed by REMOVING the chrome sites and seeing
  // what is left, rather than by eyeballing the printed fragments.
  const chromeSites = (body, nav) => ({
    nav: occurrences(nav, LABEL_EN).length,
    title: occurrences(headTitle(body), LABEL_EN).length,
    h1: occurrences(h1Of(body), LABEL_EN).length,
  });
  const enChrome = chromeSites(en.body, navEn);
  const zhChrome = chromeSites(zh.body, navZh);
  const enData = capEn.length - (enChrome.nav + enChrome.title + enChrome.h1);
  const zhData = capZh.length - (zhChrome.nav + zhChrome.title + zhChrome.h1);
  console.log(`  [ac300] en chrome: nav=${enChrome.nav} title=${enChrome.title} h1=${enChrome.h1}; DATA=${enData}`);
  console.log(`  [ac300] zh chrome: nav=${zhChrome.nav} title=${zhChrome.title} h1=${zhChrome.h1}; DATA=${zhData}`);
  assert.deepEqual(enChrome, { nav: 2, title: 1, h1: 1 },
    "en chrome enumeration: 2 nav (desktop+mobile) + 1 <title> + 1 <h1>");
  assert.deepEqual(zhChrome, { nav: 0, title: 0, h1: 0 },
    "zh chrome enumeration: ALL FOUR chrome sites moved");
  // ⚠️ The DATA hit is deliberately NON-ZERO in BOTH languages: the ADR store's own title is not this
  // page's chrome and MUST NOT be rewritten by a language switch. A zh response with 0 data hits
  // would mean the fix had started translating user data — the mirror-image defect of the one this
  // task exists to remove.
  assert.equal(enData, 1, `the en response carries exactly 1 DATA hit (the fixture ADR title) — got ${enData}`);
  assert.equal(zhData, 1, `the zh response carries exactly 1 DATA hit, UNCHANGED — got ${zhData}`);
  assert.ok(zh.body.includes(DATA_ADR_TITLE),
    "the data-side literal survives the language switch verbatim (chrome switched, data did not)");
  // The lowercase token is chrome-ONLY and exists in exactly one place: the mobile header.
  assert.equal(lowEn.length, 1, `the lowercase token occurs exactly once in en (the mobile header) — got ${lowEn.length}`);
  assert.equal(lowZh.length, 0, `the lowercase token is GONE under zh — got ${lowZh.length}`);

  // ── Scoping, MEASURED rather than assumed: the greedy nav region is chrome-only because every
  //    `</nav>` precedes the `<main id="main">` ELEMENT. If that ever stopped holding, the "nav
  //    region carries no literal" arm above would silently start scoping over this page's data.
  //
  //    ⚠️ lastIndexOf, NOT indexOf — and the reason is a live instance of hard rule 2 (a keyword hit
  //    is not the object). `shellStyles()` carries a CSS COMMENT that mentions the literal
  //    `<main id="main">` verbatim, so the FIRST occurrence of that string in the response is prose
  //    inside a <style> block, not the element. Measured on this page: `indexOf("<main")` = 16522
  //    (the comment) vs the element at 32219. An `indexOf`-based control therefore reports "the nav
  //    region extends past <main>" on a page where it demonstrably does not — a false red whose
  //    cause is the measurement, not the page. The real element is the LAST match.
  const flat = en.body.replace(/\n/g, " ");
  const lastNavClose = flat.lastIndexOf("</nav>");
  const realMainStart = flat.lastIndexOf('<main id="main">');
  console.log(`  [ac300] scoping: lastIndexOf("</nav>") = ${lastNavClose}, lastIndexOf('<main id="main">') = ${realMainStart}, (naive indexOf("<main") = ${flat.indexOf("<main")} — the CSS comment)`);
  assert.ok(lastNavClose !== -1 && realMainStart !== -1 && lastNavClose < realMainStart,
    "control: every </nav> precedes the <main id=\"main\"> element, so the greedy nav region cannot reach this page's data");
  assert.ok(!navRegion(en.body).includes(DATA_ADR_TITLE),
    "control: the data cell's title is NOT inside the nav region");
  assert.ok(!navRegion(en.body).includes("<h1"),
    "control: this page's <h1> is NOT inside the nav region (it is a separate chrome site)");
});

test("AC3-residue (out of scope, registered by name): /adr/<id> is NOT wired by this task", async () => {
  // The sibling route keeps its own `<html lang="en">` and its lang-less
  // `renderMobileChrome`/`renderSiteNav`. GOAL-024's scope is the nav route only, so this task
  // deliberately leaves it — but it is registered HERE, by name, rather than being silently counted
  // into "the ADR pages are bilingual". This arm PINS the residue: if a later task wires it, this
  // test goes red and whoever wired it must update the registration (which is the point).
  const zh = await request(port, "/adr/ADR-001", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200, "the detail route still serves");
  assert.ok(zh.body.includes('<html lang="en"'), "RESIDUE: /adr/<id> is still <html lang=\"en\"> under zh");
  const navZh = navRegion(zh.body);
  console.log(`  [ac300] RESIDUE /adr/ADR-001 zh nav-current = ${JSON.stringify(/<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1])}`);
  assert.ok(navZh.includes(LABEL_EN),
    "RESIDUE: /adr/<id>'s nav current item is still the English label under zh (out of AC-300's scope)");
});
