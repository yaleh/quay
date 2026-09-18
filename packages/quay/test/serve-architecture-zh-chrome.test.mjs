// @test-group product
// gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title — the /architecture page's OWN zh
// chrome (AC-303 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the two
// dictionaries (the 15 shared nav labels + the per-page PAGE_LABELS). AC-290 wired the FIRST page to
// them; AC-291~302 wired the next thirteen. This task wires the FIFTEENTH — /architecture, the last
// remaining page of the 15-view `SITE_NAV_ROUTES` set — and nothing in the mechanism or the shared
// dictionaries moves: only this page's call sites and this page's THREE new PAGE_LABELS tokens.
//
// The judge is a REAL server read through raw HTTP (hard rule 4 推论三: grepping the source proves the
// code CAN produce a reading, not that a live process DID). Every arm is asserted SEPARATELY and each
// one prints its raw fragment (hard rule 3: enumerate, don't report a boolean "the page looks
// translated") — a single combined assertion would leave it unknowable WHICH site a regression broke,
// which is precisely the granularity the goal criterion's `CAUSE=` names.
//
// ⚠️ TWO of this page's chrome sites are OUTSIDE the goal criterion's reach, and AC1b asserts them
// from the raw body rather than through the nav region:
//   ① `<span class="mobile-header-page">` — rendered before the first `<nav>`;
//   ② the `<h1>` — inside `<main>`, after the nav.
// Leaving either English would be a mechanical criterion weaker than the spec's intent: this page's
// OWN chrome must switch as a whole.
//
// ⚠️ THREE tokens, not the family's usual two (⛔ do not copy AC-300/AC-301's count): /architecture's
// `<title>` token, its `<h1>` name token and its mobile header label are three DIFFERENT strings.
// `pageNameFor` is an EXACT-token lookup, and here the difference is especially easy to get wrong —
// the `<title>` token CONTAINS the `<h1>` token as a prefix (`Architecture — 系统组件图` starts with
// `Architecture`), so it is tempting to register the bare word once and assume it serves both. It does
// NOT: looking up the full string against a table that only had the bare key misses and renders the
// English title under zh — i.e. exactly the `title-unchanged` arm AC-303 exists to remove. The
// `AC-dict` arms below MEASURE that (a prefix/whitespace perturbation must MISS) rather than asserting
// "the three entries exist", which would pass on a table that had collapsed them.
//
// ⚠️ AC-303 takes the STRICTER reading of GOAL-024's scope for the mobile page label: AC-291 (/live)
// and AC-292 (/board) left `<span class="mobile-header-page">` English, while AC-302 (/doc) wired it.
// This task follows AC-302 — the label is this page's own shell copy — and the AC1b arm below is the
// one that can go red on that decision. Recorded as a judgement, not a derivation.
//
// ⚠️ NAMED OUT-OF-SCOPE RESIDUE, asserted so it cannot be mistaken for an oversight: the `<head>`'s
// `<meta name="description" content="Quay architecture — system component map">` carries the LOWERCASE
// literal and is deliberately NOT translated. It does not pass through any dictionary (PAGE_LABELS is
// consumed only by `pageNameFor`), the criterion cannot read it (not in the nav region, not the
// `<title>`), and AC-291/AC-292/AC-293 left the equivalent meta lines on their pages untouched. The
// AC3 arm below asserts it is STILL there under zh, verbatim — so a later "translate everything"
// change cannot quietly rewrite it without reddening this file.
//
// The nav region is extracted with the SAME method the goal criterion uses (flatten newlines, then a
// GREEDY `/<nav.*<\/nav>/`) so this test and the criterion cannot drift on what "the nav region"
// means. That greedy region is chrome-ONLY by construction: the two `<nav` producers live in
// `renderSiteNav`/`renderMobileChrome`, both of which emit before `<main>`, so the match can never
// swallow this page's `<h1>` or the component table. (The two other `<nav>` producers in this repo —
// `serve-task.ts:731/799` — belong to the task detail page, which /architecture never renders.) The
// scoping arms below MEASURE that rather than assuming it.
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

/** The THREE tokens THIS page registers — pinned as literals, byte-equal to the `serve-architecture.ts`
 *  call sites. Deriving them from PAGE_LABELS would make the assertions below a tautology (硬规则 4).
 *
 *  ⚠️ RE-KEYED by gap-webui-architecture-body-copy-en-zh (2026-09-18): `TITLE_TOKEN` was
 *  `Architecture — 系统组件图` and is now `Architecture — system component map`. AC-303 could not fix
 *  this: ROW 3's `en` column is the IDENTITY, so no dictionary edit can move this page's en `<title>`
 *  — the token had to change at the call site, exactly as AC-291/292/293/296/298 did. ⚠️ The zh
 *  column is untouched, so `TITLE_ZH` below is unchanged and every zh arm in this file still asserts
 *  the pre-change bytes (`架构 — 系统组件图`). Asserted in the AC-dict arm. */
const TITLE_TOKEN = "Architecture — system component map";
/** ⚠️ The `<h1>` token is a strict PREFIX of `TITLE_TOKEN` — the property that makes this page's
 *  three-entry shape easy to get wrong, and the reason the `AC-dict` arms perturb the title token
 *  rather than only asserting the bare word resolves. */
const H1_TOKEN = "Architecture";
const MOBILE_TOKEN = "architecture";
const TITLE_ZH = "架构 — 系统组件图";
const H1_ZH = "架构";
const MOBILE_ZH = "架构";

/** The literal the goal criterion fails the page on. Pinned as a literal on purpose — see the note
 *  on TITLE_TOKEN. ⚠️ The LIVE en `<title>` is `quay — Architecture — 系统组件图`, but its prefix is
 *  `projectLabel(identity)` — the WORKSPACE's project name — so under this fixture it is either the
 *  temp dir's basename or the explicit 「未接入项目身份」 label. The arms below therefore assert the
 *  ` — <token>` SUFFIX (which is this page's own chrome, and is what the task actually moves) rather
 *  than the whole string; the identity prefix is AC-289's pageTitle contract, not this task's
 *  surface. */
const LABEL_EN = "Architecture";

/** The nav's CURRENT item on this page. It is NOT this page's own chrome: it resolves through
 *  `NAV_LABELS.architecture` (shared chrome, ROW 1, wired by AC-289 before this task — 「架构」), and
 *  the criterion's "the English label is gone from the nav region" arm is precisely about it. Pinned
 *  as its own literal so the assertion is not a restatement of the PAGE_LABELS lookups above. */
const NAV_ZH = "架构";

/** The page's own `<head>` meta description — the NAMED out-of-scope residue (see the header comment).
 *  Pinned verbatim so the AC3 arm proves it is untouched rather than merely "still English". */
const META_DESCRIPTION = 'content="Quay architecture — system component map"';

/** The two fixture components. ⚠️ Deliberately named so that NEITHER carries the literal
 *  `Architecture` in any case: this page's data side (the component table) must contribute ZERO hits
 *  of the criterion's label, which is exactly why the criterion is satisfiable here (contrast /board,
 *  whose in-page CSS comment carries "Board", and /dashboard, whose activity feed renders task titles
 *  containing "Dashboard"/"Tasks"). Asserted in the AC3 arms — a fixture that injected the literal
 *  would silently turn "absent from the nav region" into a statement about the whole page. */
const FIXTURE_COMPONENTS = ["quay", "quay-native"];

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

/** The nav region, extracted exactly as the AC-303 goal criterion extracts it. */
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
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac303-ws-"));
  const tasksDir = path.join(workspaceRoot, "tasks");
  const adrDir = path.join(workspaceRoot, "adr");
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(adrDir, { recursive: true });
  fs.mkdirSync(goalsDir, { recursive: true });
  // A non-empty `packages/` so the page renders its component table (status "ok") rather than the
  // "未接入/无数据" empty note — i.e. the DATA side is genuinely present and still contributes zero
  // hits of the criterion's literal. `readArchitecture` shells out to `git -C <root> log`, which
  // fails in this temp dir (not a repo) and is caught internally → recentCommits 0, which is stable
  // across requests and therefore safe for the byte-identity arm below.
  for (const name of FIXTURE_COMPONENTS) {
    const dir = path.join(workspaceRoot, "packages", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
  }
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

test("AC-dict: this page's three tokens resolve through pageNameFor, `en` is the identity, and the lookup is BYTE-EXACT", () => {
  assert.equal(pageNameFor(TITLE_TOKEN, "en"), TITLE_TOKEN,
    "en is the identity for the /architecture <title> token — the en baseline cannot move by construction");
  assert.equal(pageNameFor(H1_TOKEN, "en"), H1_TOKEN,
    "en is the identity for the /architecture <h1> token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "en"), MOBILE_TOKEN,
    "en is the identity for the /architecture mobile-header token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_ZH,
    "zh translates the /architecture <title> token — the FULL string, subtitle included");
  assert.equal(pageNameFor(H1_TOKEN, "zh"), H1_ZH, "zh translates the /architecture <h1> token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "zh"), MOBILE_ZH, "zh translates the /architecture mobile-header token");

  // ⚠️ The load-bearing distinction on THIS page: the `<title>` token strictly CONTAINS the `<h1>`
  // token as a prefix. If the table had only the bare `Architecture` key, the lookup above would miss
  // and return the English string — this arm asserts the shape that makes the third entry necessary.
  assert.ok(TITLE_TOKEN.startsWith(H1_TOKEN) && TITLE_TOKEN !== H1_TOKEN,
    `the <title> token really is the <h1> token plus a subtitle (got ${JSON.stringify(TITLE_TOKEN)})`);
  // A prefix-perturbation control: `pageNameFor` is EXACT, so even appending a single space misses.
  // This is the shape that can actually fail — asserting "the entry exists" would pass on a table that
  // resolved by prefix instead of by exact key, which is precisely how the `<title>` would stay English.
  assert.equal(pageNameFor(`${TITLE_TOKEN} `, "zh"), `${TITLE_TOKEN} `,
    "byte-exact control: a trailing space is a DIFFERENT token and falls back to itself (the " +
    "visible-degradation contract) — a prefix-resolving table would have silently absorbed it");
  assert.notEqual(pageNameFor(TITLE_TOKEN, "zh"), pageNameFor(H1_TOKEN, "zh"),
    "the <title> token and the <h1> token resolve to DIFFERENT zh values — one entry does not serve both");
  // ⚠️ Case is part of the key: `Architecture` and `architecture` are two INDEPENDENT lookups.
  // Asserting "both entries exist" would pass on a table that had collapsed them, so assert the
  // behaviour that distinguishes them — an all-caps token is NOT registered and must MISS.
  assert.equal(pageNameFor("ARCHITECTURE", "zh"), "ARCHITECTURE",
    "case control: the all-caps token `ARCHITECTURE` is not registered — the lookup is byte-exact");
  assert.equal(pageNameFor(MOBILE_TOKEN, "en"), "architecture",
    "the lowercase mobile token's en value is the LOWERCASE literal — collapsing it into the " +
    "capitalised entry would silently move the en baseline from `architecture` to `Architecture`");
  // Vocabulary note, asserted so that a later re-wording of ONE of the three zh values is a deliberate
  // act rather than an unnoticed divergence (they are independent lookups that happen to coincide).
  assert.equal(pageNameFor(H1_TOKEN, "zh"), pageNameFor(MOBILE_TOKEN, "zh"),
    "vocabulary note: the <h1> and mobile zh values coincide today — asserted so a re-wording is deliberate");

  // The criterion fails the page on the ASCII literal inside the NAV region; the title arm fails it on
  // the same literal in this page's own <title>. A zh value that still carried the English word
  // ("架构 Architecture") would satisfy "non-empty" while defeating both — assert the absent literal.
  //
  // ⚠️ The MOBILE token is lowercase (`architecture`), so asserting the capitalised literal alone
  // would be a TAUTOLOGY, not a measurement (硬规则 4). Its arm is therefore case-INSENSITIVE — the
  // shape that can actually fail — and the controls below show the en peers tripping the predicates.
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
    `control: the "${LABEL_EN}" predicate fires on the en <h1> token it must reject`);
  assert.ok(pageNameFor(MOBILE_TOKEN, "en").toLowerCase().includes(LABEL_EN.toLowerCase()),
    `control: the case-insensitive "${LABEL_EN}" predicate fires on the en mobile token it must reject`);
  // The real discriminator for each token, stated directly: en is the identity and zh is NOT — i.e.
  // these tokens genuinely switch. Asserting only "zh is 架构" would pass on a table whose en column had
  // been (wrongly) set to the zh value too.
  for (const [tok, label] of [[TITLE_TOKEN, "title"], [H1_TOKEN, "h1"], [MOBILE_TOKEN, "mobile"]]) {
    assert.notEqual(pageNameFor(tok, "zh"), pageNameFor(tok, "en"),
      `the ${label} token really switches between the two languages (en is the identity, zh is not)`);
  }
});

test("AC1: /architecture under Cookie lang=zh switches the page header, nav current item (desktop+mobile) and own <title>", async () => {
  const en = await request(port, "/architecture");
  const zh = await request(port, "/architecture", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /architecture (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /architecture (zh) returns 200 (got ${zh.status})`);

  // ① the page-header language attribute — the criterion's FIRST arm, i.e. the one that was red before
  //    this task (`CAUSE=html-lang-not-zh` on the pre-implementation reading).
  assert.ok(en.body.includes('<html lang="en"'), "① en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "① zh response is <html lang=\"zh\">");
  // Control: the two readings are not the same response re-fetched — the attribute really moved.
  assert.notEqual(zh.body.includes('<html lang="en"'), true,
    "① the zh response does NOT also carry <html lang=\"en\" — the attribute really switched");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // ⑥ (stated first because every "absent under zh" arm below is VACUOUS without it): the en negative
  //    control is unchanged from the pre-AC-303 live baseline.
  assert.ok(navEn.includes(LABEL_EN),
    `⑥ en nav region still carries the literal "${LABEL_EN}" (the criterion's own baseline assumption)`);
  assert.ok(headTitle(en.body).endsWith(` — ${TITLE_TOKEN}`),
    `⑥ en <title> still ends with this page's own pre-AC-303 token (got ${JSON.stringify(headTitle(en.body))})`);

  // ② NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3: enumerate, don't report
  //    a boolean "the nav looks translated"). This page's current item is `NAV_LABELS.architecture` —
  //    shared chrome wired by AC-289, 「架构」 — so these arms prove the page renders through the dict.
  const desktopEn = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const desktopZh = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  const mobileEn = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const mobileZh = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  console.log(`  [ac303] en desktop nav-current = ${JSON.stringify(desktopEn)}`);
  console.log(`  [ac303] zh desktop nav-current = ${JSON.stringify(desktopZh)}`);
  console.log(`  [ac303] en mobile  nav-current = ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac303] zh mobile  nav-current = ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, LABEL_EN, `② en desktop current item is the baseline (got ${JSON.stringify(desktopEn)})`);
  assert.equal(mobileEn, LABEL_EN, `② en mobile current item is the baseline (got ${JSON.stringify(mobileEn)})`);
  assert.equal(desktopZh, NAV_ZH, `② zh desktop current item is translated (got ${JSON.stringify(desktopZh)})`);
  assert.equal(mobileZh, NAV_ZH, `② zh mobile current item is translated (got ${JSON.stringify(mobileZh)})`);

  // ③ the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(LABEL_EN),
    `③ the zh nav region carries no literal "${LABEL_EN}"`);

  // Scoping control: the SAME predicate on the SAME response DOES fire outside the nav region. On this
  // page the outside hits are chrome — the `<title>` and the `<h1>` — so "absent from the nav region"
  // is demonstrably a statement about SCOPE, not about the page having no such string at all.
  const navHits = occurrences(navEn, LABEL_EN).length;
  const bodyHits = occurrences(en.body, LABEL_EN).length;
  const titleHits = occurrences(headTitle(en.body), LABEL_EN).length;
  const h1Hits = occurrences(h1Of(en.body), LABEL_EN).length;
  console.log(`  [ac303] en literal "${LABEL_EN}": nav region ${navHits} hit(s), <title> ${titleHits}, <h1> ${h1Hits}, whole body ${bodyHits} hit(s)`);
  for (const frag of occurrences(en.body, LABEL_EN)) console.log(`  [ac303]   en hit: …${frag}…`);
  assert.equal(navHits, 2, `control: the en nav region carries the literal exactly twice (desktop+mobile), got ${navHits}`);
  assert.equal(titleHits, 1, `control: the en <title> carries the literal exactly once, got ${titleHits}`);
  assert.equal(h1Hits, 1, `control: the en <h1> carries the literal exactly once, got ${h1Hits}`);
  // ⚠️ The four chrome hits ACCOUNT FOR THE WHOLE BODY (4 = 2 nav + 1 title + 1 h1) — i.e. the DATA
  // side (the component table, whose rows are FIXTURE_COMPONENTS) contributes ZERO hits of the literal.
  // That is why AC-303's criterion is satisfiable on this page, and it is asserted rather than assumed:
  // a fixture or a later data change that injected the literal would redden here instead of silently
  // making the criterion unpassable (the failure mode /board and /dashboard have).
  assert.equal(bodyHits, navHits + titleHits + h1Hits,
    `control: every en occurrence of "${LABEL_EN}" is chrome (4 = 2 nav + 1 title + 1 h1); the data side ` +
    `contributes 0 — got body ${bodyHits}, nav ${navHits} + title ${titleHits} + h1 ${h1Hits}`);
  assert.ok(bodyHits > navHits,
    `control: the en literal also occurs OUTSIDE the nav region (${bodyHits} > ${navHits}) — the nav match is really scoping`);
  // …and the DATA side is still rendered verbatim under zh: the dictionary translates CHROME, never
  // records. Asserted so a future "translate everything" change cannot quietly rewrite stored data.
  for (const name of FIXTURE_COMPONENTS) {
    assert.ok(zh.body.includes(name),
      `control: the zh response still renders the component record ${JSON.stringify(name)} verbatim — data is not chrome`);
  }

  // ④ this page's OWN <title>. Asserted as a pair AND as a difference (the criterion's shape), with
  //    both raw fragments printed side by side.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac303] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac303] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.includes(LABEL_EN), `④ en <title> carries the literal baseline (got ${JSON.stringify(tEn)})`);
  assert.notEqual(tZh, tEn, "④ the page's OWN <title> is not byte-identical across the two languages");
  assert.ok(!tZh.includes(LABEL_EN), `④ the zh <title> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(tZh)})`);
  assert.ok(tZh.includes(TITLE_ZH), `④ the zh <title> carries the translated token (got ${JSON.stringify(tZh)})`);
  // ⚠️ The `<title>` token is the FULL string: a table that had registered only the bare
  // `Architecture` would leave the subtitle English and this arm would read `quay — Architecture —
  // 系统组件图` under zh, i.e. identical to `tEn` (caught by the notEqual above) — stated here so the
  // exact failure mode is named rather than merely excluded.
  assert.ok(tZh.endsWith(TITLE_ZH),
    `④ the zh <title> ENDS with the full translated token — a bare-word-only table would emit the ` +
    `English subtitle and fail the notEqual arm above (got ${JSON.stringify(tZh)})`);
});

test("AC1b: the two chrome sites OUTSIDE the criterion's nav region also switch (mobile header, <h1>)", async () => {
  // The criterion CANNOT see either of these: `<span class="mobile-header-page">` sits before the
  // first `<nav>`, and the `<h1>` sits inside `<main>` after it, so the greedy `/<nav.*<\/nav>/`
  // region contains neither. They are nevertheless this page's own chrome, and leaving them English
  // would be a mechanical criterion that is weaker than the spec's intent. Asserted from the raw
  // body, NOT via the nav region (hard rule 3: two separate arms, two separate fragments).
  const en = await request(port, "/architecture");
  const zh = await request(port, "/architecture", { Cookie: "lang=zh" });

  // ① the mobile header page label — the ONLY site that consumes the LOWERCASE `architecture` entry.
  //    If the table ever lost that entry this is the arm that fails, and the criterion's own arms
  //    would all stay green (it reads only the nav region and the <title>).
  const enLabel = mobileHeaderPage(en.body);
  const zhLabel = mobileHeaderPage(zh.body);
  console.log(`  [ac303] en mobile-header-page = ${JSON.stringify(enLabel)}`);
  console.log(`  [ac303] zh mobile-header-page = ${JSON.stringify(zhLabel)}`);
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
  // ⚠️ This is the STRICTER reading of GOAL-024's scope (AC-302's shape; AC-291/AC-292 left their
  // mobile label English). Asserted explicitly so that decision cannot be silently reverted to the
  // laxer shape: if a later change passed the literal through, this arm fails.
  assert.notEqual(MOBILE_TOKEN, MOBILE_ZH,
    "the mobile header label really switches (the stricter AC-303 reading, recorded as a judgement)");

  // ② this page's OWN <h1> — the site that consumes the bare `Architecture` entry.
  const h1En = h1Of(en.body);
  const h1Zh = h1Of(zh.body);
  console.log(`  [ac303] en <h1> = ${JSON.stringify(h1En)}`);
  console.log(`  [ac303] zh <h1> = ${JSON.stringify(h1Zh)}`);
  assert.equal(h1En, TITLE_TOKEN, `② the en <h1> is this page's name token plus the subtitle (got ${JSON.stringify(h1En)})`);
  assert.equal(h1Zh, TITLE_ZH, `② the zh <h1> is the translated name token with the SAME subtitle (got ${JSON.stringify(h1Zh)})`);
  assert.ok(!h1Zh.includes(LABEL_EN),
    `② the zh <h1> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(h1Zh)})`);
  assert.ok(!navRegion(zh.body).includes("<h1>"),
    "control: the <h1> is NOT inside the criterion's nav region — a distinct site");
  // Control: the equality predicates above are not vacuous — the en `<h1>` is NOT already the zh one,
  // and the zh value is NOT the identity it would be if the entry were missing.
  assert.notEqual(h1En, h1Zh, "control: the <h1> really differs across languages");
  assert.notEqual(h1Zh, H1_TOKEN,
    "control: the zh <h1> is not the bare English token — i.e. the entry is registered, not merely absent");
  // The third entry is load-bearing and has no other consumer: the `<h1>` uses the BARE token while
  // the `<title>` uses the full one, so a table with only the title entry would leave this site
  // English (`Architecture — 系统组件图` under zh). Asserted so that shape cannot be copied in unnoticed.
  assert.notEqual(H1_TOKEN, TITLE_TOKEN,
    "the <h1> token is distinct from the <title> token — the third entry is not a duplicate");
});

test("AC1⑥: the en baseline is byte-identical with and without an explicit ?lang=en", async () => {
  // A lang-parameterised renderer that quietly changed the DEFAULT rendering would move the
  // criterion's en baseline. This pins it: no query, no cookie ≡ an explicit `?lang=en`.
  const bare = await request(port, "/architecture");
  const explicit = await request(port, "/architecture?lang=en");
  assert.equal(navRegion(bare.body), navRegion(explicit.body),
    "the default-locale nav region is identical with and without an explicit ?lang=en");
  assert.equal(headTitle(bare.body), headTitle(explicit.body),
    "the default-locale <title> is identical with and without an explicit ?lang=en");
  assert.equal(h1Of(bare.body), h1Of(explicit.body),
    "the default-locale <h1> is identical with and without an explicit ?lang=en");
  assert.equal(mobileHeaderPage(bare.body), mobileHeaderPage(explicit.body),
    "the default-locale mobile header page label is identical with and without an explicit ?lang=en");
  // /architecture has no per-request counters (unlike /sessions' lifecycle lines), and its data side
  // is a fixed `packages/` listing, so the WHOLE body is pinnable — a stronger reading than the
  // chrome-only comparison above.
  assert.equal(bare.body, explicit.body,
    "the whole default-locale /architecture response is byte-identical with and without an explicit ?lang=en");
});

test("AC3-scope: the criterion's nav region is chrome-ONLY on this page (the greedy match cannot swallow <main>)", async () => {
  // The criterion uses a GREEDY `/<nav.*<\/nav>/`, so a page that emitted a `<nav>` after `<main>`
  // would let the match swallow page content and make the "no English label in the nav region" arm
  // unpassable (or, in the other direction, vacuous). /architecture's two `<nav>` producers both live
  // in serve-render.ts and both emit before `<main>`, so the region is chrome-only BY CONSTRUCTION.
  // Measured here rather than asserted, because "by construction" is exactly the kind of claim that
  // goes stale silently (硬规则 4b).
  const en = await request(port, "/architecture");
  const flat = en.body.replace(/\n/g, " ");
  const navOpens = occurrences(flat, "<nav").length;
  const navCloses = occurrences(flat, "</nav>").length;
  console.log(`  [ac303] en <nav occurrences = ${navOpens}, </nav> occurrences = ${navCloses}`);
  assert.equal(navOpens, 2, `exactly two <nav> producers on this page (site nav + mobile menu), got ${navOpens}`);
  assert.equal(navCloses, 2, `the two <nav> elements are closed, got ${navCloses}`);
  const region = navRegion(en.body);
  assert.ok(!region.includes("<h1>"),
    "the greedy nav region does not contain the <h1> — it ends before <main>");
  assert.ok(!region.includes("<table"),
    "the greedy nav region does not contain the component table — it ends before <main>");
  assert.ok(!region.includes("component map"),
    "the greedy nav region does not contain the <head> meta description — it starts after <head>");
  console.log(`  [ac303] en nav region: ${region.length} bytes of ${en.body.length} total`);

  // ── NAMED OUT-OF-SCOPE RESIDUE (see the header comment) ──────────────────────────────────────────
  // The `<head>` meta description carries the LOWERCASE literal and is deliberately NOT translated.
  // Asserted verbatim in BOTH responses so it cannot be mistaken for an oversight, and so a later
  // "translate everything" change cannot rewrite it without reddening this file.
  const zh = await request(port, "/architecture", { Cookie: "lang=zh" });
  assert.ok(en.body.includes(META_DESCRIPTION),
    `residue: the en response carries the meta description verbatim (${META_DESCRIPTION})`);
  assert.ok(zh.body.includes(META_DESCRIPTION),
    `residue: the zh response STILL carries the meta description verbatim — deliberately out of scope, ` +
    `since PAGE_LABELS is consumed only by pageNameFor and this node passes through no dictionary`);
  // …and it is provably outside everything the criterion reads: not in the nav region, not the <title>.
  assert.ok(!region.includes("component map"),
    "residue scoping: the meta description is NOT inside the nav region");
  assert.ok(!headTitle(zh.body).includes("component map"),
    "residue scoping: the meta description is NOT part of the <title> the criterion compares");
  // The lowercase literal after this task's change: 1 hit (the meta) — the mobile header, which was
  // the OTHER lowercase site, is now translated. Stated with its count so a regression that reverted
  // the mobile header would show up as 2 here (hard rule 3: a count, not a boolean).
  const lowerZh = occurrences(zh.body, "architecture").length;
  const lowerZhNav = occurrences(navRegion(zh.body), "architecture").length;
  console.log(`  [ac303] zh lowercase "architecture": whole body ${lowerZh} hit(s), nav region ${lowerZhNav} hit(s)`);
  assert.equal(lowerZhNav, 0, `the zh nav region carries no lowercase "architecture", got ${lowerZhNav}`);
  assert.equal(lowerZh, 1,
    `the zh body's ONLY remaining lowercase "architecture" is the named out-of-scope meta description, got ${lowerZh}`);
});
