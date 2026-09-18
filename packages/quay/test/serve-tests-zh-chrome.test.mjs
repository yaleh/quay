// @test-group product
// gap-ac298-tests-page-zh-chrome-nav-current-and-own-title — the /tests page's OWN zh chrome
// (AC-298 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the two
// dictionaries (the 15 shared nav labels + the per-page PAGE_LABELS). AC-290 wired the FIRST page
// to them; AC-291~297 wired the next eight. This task wires the NINTH — /tests — and nothing in the
// mechanism or the dictionaries moves: only this page's four call sites and this page's TWO new
// PAGE_LABELS tokens.
//
// The judge is a REAL server read through raw HTTP (hard rule 4 推论三: grepping the source proves
// the code CAN produce a reading, not that a live process DID). Every arm is asserted SEPARATELY and
// each one prints its raw fragment (hard rule 3: enumerate, don't report a boolean "the page looks
// translated") — a single combined assertion would leave it unknowable WHICH of the four sites a
// regression broke, which is precisely the granularity the goal criterion's `CAUSE=` names.
//
// ⚠️ THE TOKEN THE CALL SITES PASS, AND THE COMPOSED STRINGS THEY RENDER. When AC-298 wrote this
// test the call sites passed the FULL composite `"Tests — 验证轮记录"` — em dash and the
// (already-Chinese) subtitle included — and this header argued the composite had to be registered
// because `pageNameFor` is an EXACT-token lookup.
//
// ⚠️ MIGRATED by gap-webui-tests-body-copy-en-zh (2026-09-18). That argument is INVERTED by
// measurement: `pageNameFor` returns its argument UNCHANGED for `en` (ROW 3's contract), so a
// composite token renders its OWN Chinese bytes under the DEFAULT locale and its `en` column is dead
// code no lookup reads — i.e. the composite WAS the "title renders Chinese under en" defect, not the
// cure for it. The page now passes the bare `Tests` token with the subtitle appended from ROW 20
// (`pageSubtitle`), exactly as /system (ROW 14 ③) and /sessions (ROW 15) were re-keyed before it.
// The tokens below are therefore the strings the call sites ACTUALLY pass, spelled the same way, and
// the composed `<h1>`/`<title>` are asserted as compositions rather than as one opaque token.
//
// The nav region is extracted with the SAME method the goal criterion uses (flatten newlines, then a
// GREEDY `/<nav.*<\/nav>/`) so this test and the criterion cannot drift on what "the nav region"
// means. That greedy region is chrome-ONLY by construction: the two `<nav` producers live in
// `renderSiteNav`/`renderMobileChrome`, both of which emit before `<main>`, so the match can never
// swallow this page's `<h1>` or any data the page renders. The scoping arm below MEASURES that
// rather than assuming it (a whole-body substring match would be a different, weaker assertion).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { pageNameFor, TESTS_LABELS } from "../src/serve-i18n.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The two tokens THIS page registers — pinned as literals, byte-equal to the `serve-tests.ts` call
 *  sites. Deriving them from PAGE_LABELS would make the assertion below a tautology (硬规则 4).
 *  `TITLE_TOKEN` is what `pageTitle` AND the `<h1>` receive; `MOBILE_TOKEN` is the lowercase label
 *  the mobile header carries (the AC-290 `"task list"` / AC-297 `"git history"` shape). */
const TITLE_TOKEN = "Tests";
const MOBILE_TOKEN = "tests";
const TITLE_ZH = "测试";
const MOBILE_ZH = "测试";
/** The COMPOSED page header — `pageNameFor(NAME_TOKEN, lang)` + ` — ` + ROW 20's `pageSubtitle`.
 *  Pinned as literals on the same reasoning as the tokens: they are what the RENDERED page carries. */
const H1_EN = "Tests — verification rounds";
const H1_ZH = "测试 — 验证轮记录";

/** The literal the goal criterion fails the page on. Pinned as a literal on purpose — see the note
 *  on TITLE_TOKEN. ⚠️ The LIVE en `<title>` now ends ` — Tests — verification rounds`, but its prefix is
 *  `projectLabel(identity)` — the WORKSPACE's project name — so under this fixture it is the temp
 *  dir's basename, not `quay`. The arms below therefore assert the ` — <token>` SUFFIX (which is
 *  this page's own chrome, and is what the task actually moves) rather than the whole string; the
 *  identity prefix is AC-289's pageTitle contract and is not this task's surface. */
const LABEL_EN = "Tests";

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

/** The nav region, extracted exactly as the AC-298 goal criterion extracts it. */
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

before(async () => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac298-ws-"));
  const tasksDir = path.join(workspaceRoot, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  // One real round, so the page renders its populated branch rather than the empty state (the
  // chrome is identical either way, but the populated branch is the one the live criterion reads).
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "verification-round.jsonl"),
    JSON.stringify({
      round: 1, startedAt: "2026-09-17T00:00:00Z", durationMs: 1000, state: "green",
      pass: 7, fail: 0, cancelled: 0, tests: 7, reason: null, commit: "abcdef123456",
      scope: "repo", runner: "test.sh", failures: [],
    }) + "\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac298 fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
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

test("AC-dict: this page's two tokens resolve through pageNameFor, and `en` is the identity for both", () => {
  assert.equal(pageNameFor(TITLE_TOKEN, "en"), TITLE_TOKEN,
    "en is the identity for the /tests <title>+<h1> token — the en baseline cannot move by construction");
  assert.equal(pageNameFor(MOBILE_TOKEN, "en"), MOBILE_TOKEN,
    "en is the identity for the /tests mobile-header token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_ZH, `zh translates the /tests <title>+<h1> token`);
  assert.equal(pageNameFor(MOBILE_TOKEN, "zh"), MOBILE_ZH, "zh translates the /tests mobile-header token");
  // The SUBTITLE is ROW 20's copy, appended OUTSIDE the token by both call sites — assert the two
  // halves compose to the rendered header, so a re-key that moved the name but lost the subtitle
  // (or a subtitle row whose zh column drifted) is caught here rather than by reading the page.
  assert.equal(`${pageNameFor(TITLE_TOKEN, "en")} — ${TESTS_LABELS.pageSubtitle.en}`, H1_EN,
    "the en header composes from the bare token + ROW 20's subtitle");
  assert.equal(`${pageNameFor(TITLE_TOKEN, "zh")} — ${TESTS_LABELS.pageSubtitle.zh}`, H1_ZH,
    "the zh header composes from the same two rows and is the pre-existing Chinese");
  // The criterion fails the page on the ASCII literal inside the NAV region; the title arm fails it
  // on the same literal in this page's own <title>. A zh value that still carried the English word
  // ("测试 Tests") would satisfy "non-empty" while defeating both — assert the absent literal.
  //
  // ⚠️ The MOBILE token is lowercase (`tests`), so it can never contain the capitalised literal —
  // asserting that alone would be a TAUTOLOGY, not a measurement (硬规则 4). Its arm is therefore
  // case-INSENSITIVE, which is the shape that can actually fail, and the control below shows the
  // en peer tripping the very same predicate.
  assert.ok(!pageNameFor(TITLE_TOKEN, "zh").includes(LABEL_EN),
    `the zh title token does not carry the ASCII literal "${LABEL_EN}"`);
  assert.ok(!pageNameFor(MOBILE_TOKEN, "zh").toLowerCase().includes(LABEL_EN.toLowerCase()),
    `the zh mobile token does not carry "${LABEL_EN}" in any case`);
  // Control — the literal predicates are not vacuous: they DO fire on the en tokens they must reject.
  assert.ok(pageNameFor(TITLE_TOKEN, "en").includes(LABEL_EN),
    `control: the "${LABEL_EN}" predicate fires on the en title token it must reject`);
  assert.ok(pageNameFor(MOBILE_TOKEN, "en").toLowerCase().includes(LABEL_EN.toLowerCase()),
    `control: the case-insensitive "${LABEL_EN}" predicate fires on the en mobile token it must reject`);
});

test("AC1: /tests under Cookie lang=zh switches the page header, nav current item (desktop+mobile) and own <title>", async () => {
  const en = await request(port, "/tests");
  const zh = await request(port, "/tests", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /tests (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /tests (zh) returns 200 (got ${zh.status})`);

  // ① the page-header language attribute — the criterion's FIRST arm, i.e. the one that is red today.
  assert.ok(en.body.includes('<html lang="en"'), "① en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "① zh response is <html lang=\"zh\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // ⑥ (stated first because every "absent under zh" arm below is VACUOUS without it): the en negative
  //    control is unchanged from the pre-AC-298 live baseline.
  assert.ok(navEn.includes(LABEL_EN),
    `⑥ en nav region still carries the literal "${LABEL_EN}" (the criterion's own baseline assumption)`);
  assert.ok(headTitle(en.body).endsWith(` — ${H1_EN}`),
    `⑥ en <title> still ends with this page's own header (got ${JSON.stringify(headTitle(en.body))})`);

  // ② NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3: enumerate, don't report
  //    a boolean "the nav looks translated").
  const desktopEn = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const desktopZh = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  const mobileEn = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const mobileZh = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  console.log(`  [ac298] en desktop nav-current = ${JSON.stringify(desktopEn)}`);
  console.log(`  [ac298] zh desktop nav-current = ${JSON.stringify(desktopZh)}`);
  console.log(`  [ac298] en mobile  nav-current = ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac298] zh mobile  nav-current = ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, LABEL_EN, `② en desktop current item is the baseline (got ${JSON.stringify(desktopEn)})`);
  assert.equal(mobileEn, LABEL_EN, `② en mobile current item is the baseline (got ${JSON.stringify(mobileEn)})`);
  assert.equal(desktopZh, MOBILE_ZH, `② zh desktop current item is translated (got ${JSON.stringify(desktopZh)})`);
  assert.equal(mobileZh, MOBILE_ZH, `② zh mobile current item is translated (got ${JSON.stringify(mobileZh)})`);

  // ③ the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(LABEL_EN),
    `③ the zh nav region carries no literal "${LABEL_EN}"`);

  // Scoping control: the SAME predicate on the SAME response DOES fire outside the nav region (this
  // page's <title> and <h1> carry the literal in en, and both live in <head>/<main>). Without this,
  // "absent from the nav region" could be satisfied by a page that had no such literal anywhere.
  const navHits = (navEn.match(/Tests/g) || []).length;
  const bodyHits = (en.body.match(/Tests/g) || []).length;
  console.log(`  [ac298] en literal "${LABEL_EN}": nav region ${navHits} hit(s), whole body ${bodyHits} hit(s)`);
  assert.equal(navHits, 2, `control: the en nav region carries the literal exactly twice (desktop+mobile), got ${navHits}`);
  assert.ok(bodyHits > navHits,
    `control: the en literal also occurs OUTSIDE the nav region (${bodyHits} > ${navHits}) — the nav match is really scoping`);

  // ④ this page's OWN <title>. Asserted as a pair AND as a difference (the criterion's shape), with
  //    both raw fragments printed side by side.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac298] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac298] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.includes(LABEL_EN), `④ en <title> carries the literal baseline (got ${JSON.stringify(tEn)})`);
  assert.notEqual(tZh, tEn, "④ the page's OWN <title> is not byte-identical across the two languages");
  assert.ok(!tZh.includes(LABEL_EN), `④ the zh <title> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(tZh)})`);
  assert.ok(tZh.includes("测试"), `④ the zh <title> carries the translated token (got ${JSON.stringify(tZh)})`);
  assert.ok(tZh.endsWith(` — ${H1_ZH}`),
    `④ the zh <title> ends with the pre-existing Chinese header (got ${JSON.stringify(tZh)})`);

  // ⑤ this page's OWN <h1>.
  const h1En = h1Of(en.body);
  const h1Zh = h1Of(zh.body);
  console.log(`  [ac298] en <h1> = ${JSON.stringify(h1En)}`);
  console.log(`  [ac298] zh <h1> = ${JSON.stringify(h1Zh)}`);
  assert.equal(h1En, H1_EN, `⑤ the en <h1> is the composed header (got ${JSON.stringify(h1En)})`);
  assert.ok(!h1Zh.includes(LABEL_EN), `⑤ the zh <h1> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(h1Zh)})`);
  assert.equal(h1Zh, H1_ZH, `⑤ the zh <h1> is the pre-existing Chinese header (got ${JSON.stringify(h1Zh)})`);
});

test("AC1b: the mobile header page label (rendered OUTSIDE the nav region) also switches", async () => {
  // The criterion CANNOT see this one: `<span class="mobile-header-page">` sits before the first
  // `<nav>`, so the greedy `/<nav.*<\/nav>/` region never contains it. It is nevertheless this
  // page's own chrome, and leaving it English would be a mechanical criterion that is weaker than
  // the spec's intent. Asserted from the raw body, NOT via the nav region.
  const en = await request(port, "/tests");
  const zh = await request(port, "/tests", { Cookie: "lang=zh" });
  const enLabel = mobileHeaderPage(en.body);
  const zhLabel = mobileHeaderPage(zh.body);
  console.log(`  [ac298] en mobile-header-page = ${JSON.stringify(enLabel)}`);
  console.log(`  [ac298] zh mobile-header-page = ${JSON.stringify(zhLabel)}`);
  assert.equal(enLabel, MOBILE_TOKEN, `en mobile header page label is the baseline (got ${JSON.stringify(enLabel)})`);
  assert.equal(zhLabel, MOBILE_ZH, `zh mobile header page label is translated (got ${JSON.stringify(zhLabel)})`);
  assert.ok(!zhLabel.includes(LABEL_EN), `the zh mobile header page label carries no ASCII "${LABEL_EN}"`);
  // Control: the label is genuinely OUTSIDE the criterion's nav region — otherwise this test would be
  // a restatement of AC1②'s mobile arm rather than a second, independent site.
  assert.ok(!navRegion(zh.body).includes('class="mobile-header-page"'),
    "control: the mobile header page label is NOT inside the criterion's nav region — a distinct site");
});

test("AC1⑥: the en baseline is byte-identical with and without an explicit ?lang=en", async () => {
  // A lang-parameterised renderer that quietly changed the DEFAULT rendering would move the
  // criterion's en baseline. This pins it: no query, no cookie ≡ an explicit `?lang=en`.
  const bare = await request(port, "/tests");
  const explicit = await request(port, "/tests?lang=en");
  assert.equal(navRegion(bare.body), navRegion(explicit.body),
    "the default-locale nav region is identical with and without an explicit ?lang=en");
  assert.equal(headTitle(bare.body), headTitle(explicit.body),
    "the default-locale <title> is identical with and without an explicit ?lang=en");
  assert.equal(h1Of(bare.body), h1Of(explicit.body),
    "the default-locale <h1> is identical with and without an explicit ?lang=en");
  assert.equal(bare.body, explicit.body,
    "the whole default-locale /tests response is byte-identical with and without an explicit ?lang=en");
});
