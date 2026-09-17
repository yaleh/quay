// @test-group product
// gap-ac299-sessions-page-zh-chrome-nav-current-and-own-title — the /sessions page's OWN zh chrome
// (AC-299 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the two
// dictionaries (the 15 shared nav labels + the per-page PAGE_LABELS). AC-290 wired the FIRST page to
// them; AC-291~298 wired the next eight. This task wires the TENTH — /sessions — and nothing in the
// mechanism or the dictionaries moves: only this page's four call sites and this page's THREE new
// PAGE_LABELS tokens.
//
// The judge is a REAL server read through raw HTTP (hard rule 4 推论三: grepping the source proves
// the code CAN produce a reading, not that a live process DID). Every arm is asserted SEPARATELY and
// each one prints its raw fragment (hard rule 3: enumerate, don't report a boolean "the page looks
// translated") — a single combined assertion would leave it unknowable WHICH of the four sites a
// regression broke, which is precisely the granularity the goal criterion's `CAUSE=` names.
//
// ⚠️ THREE tokens, not the usual TWO. /tests (AC-298) got away with two because its `<title>` and its
// `<h1>` carry the SAME string. /sessions does not: its `<h1>` is `"Sessions — 会话观测（运行中 +
// 已结束）"` while its `<title>` is the shorter `"Sessions — 会话观测"`, and its mobile header carries
// the bare lowercase `sessions`. `pageNameFor` is an EXACT-token lookup, so a single entry cannot
// serve them — registering the bare nav word `Sessions` would leave the `<title>` and `<h1>` English
// while the shared nav bar switched, i.e. exactly the `title-unchanged` arm this task exists to
// remove. The tokens asserted below are the strings the call sites actually pass, spelled the same
// way (em dash U+2014, full-width parens).
//
// The nav region is extracted with the SAME method the goal criterion uses (flatten newlines, then a
// GREEDY `/<nav.*<\/nav>/`) so this test and the criterion cannot drift on what "the nav region"
// means. That greedy region is chrome-ONLY by construction: the two `<nav` producers live in
// `renderSiteNav`/`renderMobileChrome`, both of which emit before `<main>`, so the match can never
// swallow this page's `<h1>` or any data the page renders. (The two other `<nav>` producers in this
// repo — `serve-task.ts:731/799` — belong to the task detail page, which /sessions never renders.)
// The scoping arms below MEASURE that rather than assuming it.
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
import { pageNameFor } from "../src/serve-i18n.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The three tokens THIS page registers — pinned as literals, byte-equal to the `serve-sessions.ts`
 *  call sites. Deriving them from PAGE_LABELS would make the assertions below a tautology
 *  (硬规则 4). `TITLE_TOKEN` is what `pageTitle` receives; `H1_TOKEN` is what the `<h1>` receives
 *  (⛔ NOT the same string — the trailing `（运行中 + 已结束）` is the whole reason this page needs a
 *  third entry); `MOBILE_TOKEN` is the lowercase label the mobile header carries (the AC-290
 *  `"task list"` / AC-297 `"git history"` / AC-298 `tests` shape). */
const TITLE_TOKEN = "Sessions — 会话观测";
const H1_TOKEN = "Sessions — 会话观测（运行中 + 已结束）";
const MOBILE_TOKEN = "sessions";
const TITLE_ZH = "会话 — 会话观测";
const H1_ZH = "会话 — 会话观测（运行中 + 已结束）";
const MOBILE_ZH = "会话";

/** The literal the goal criterion fails the page on. Pinned as a literal on purpose — see the note
 *  on TITLE_TOKEN. ⚠️ The LIVE en `<title>` is `quay — Sessions — 会话观测`, but its prefix is
 *  `projectLabel(identity)` — the WORKSPACE's project name — so under this fixture it is the temp
 *  dir's basename, not `quay`. The arms below therefore assert the ` — <token>` SUFFIX (which is
 *  this page's own chrome, and is what the task actually moves) rather than the whole string; the
 *  identity prefix is AC-289's pageTitle contract and is not this task's surface. */
const LABEL_EN = "Sessions";

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

/** The nav region, extracted exactly as the AC-299 goal criterion extracts it. */
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
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac299-ws-"));
  const tasksDir = path.join(workspaceRoot, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac299 fixture workspace\n");
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

test("AC-dict: this page's three tokens resolve through pageNameFor, and `en` is the identity for all three", () => {
  assert.equal(pageNameFor(TITLE_TOKEN, "en"), TITLE_TOKEN,
    "en is the identity for the /sessions <title> token — the en baseline cannot move by construction");
  assert.equal(pageNameFor(H1_TOKEN, "en"), H1_TOKEN,
    "en is the identity for the /sessions <h1> token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "en"), MOBILE_TOKEN,
    "en is the identity for the /sessions mobile-header token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_ZH, "zh translates the /sessions <title> token");
  assert.equal(pageNameFor(H1_TOKEN, "zh"), H1_ZH, "zh translates the /sessions <h1> token");
  assert.equal(pageNameFor(MOBILE_TOKEN, "zh"), MOBILE_ZH, "zh translates the /sessions mobile-header token");
  // The <h1> token and the <title> token are DIFFERENT STRINGS — the reason this page needs a third
  // entry. If the table ever collapsed them into one lookup, the <h1> would silently fall back to
  // its English token and this arm is what says so.
  assert.notEqual(TITLE_TOKEN, H1_TOKEN,
    "this page's <title> and <h1> tokens really are distinct (the three-entry shape is not decorative)");
  // The criterion fails the page on the ASCII literal inside the NAV region; the title arm fails it
  // on the same literal in this page's own <title>/<h1>. A zh value that still carried the English
  // word ("会话 Sessions") would satisfy "non-empty" while defeating both — assert the absent
  // literal.
  //
  // ⚠️ The MOBILE token is lowercase (`sessions`), so it can never contain the capitalised literal —
  // asserting that alone would be a TAUTOLOGY, not a measurement (硬规则 4). Its arm is therefore
  // case-INSENSITIVE, which is the shape that can actually fail, and the controls below show the en
  // peers tripping the very same predicates.
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

test("AC1: /sessions under Cookie lang=zh switches the page header, nav current item (desktop+mobile) and own <title>", async () => {
  const en = await request(port, "/sessions");
  const zh = await request(port, "/sessions", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /sessions (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /sessions (zh) returns 200 (got ${zh.status})`);

  // ① the page-header language attribute — the criterion's FIRST arm, i.e. the one that is red today.
  assert.ok(en.body.includes('<html lang="en"'), "① en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "① zh response is <html lang=\"zh\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // ⑥ (stated first because every "absent under zh" arm below is VACUOUS without it): the en negative
  //    control is unchanged from the pre-AC-299 live baseline.
  assert.ok(navEn.includes(LABEL_EN),
    `⑥ en nav region still carries the literal "${LABEL_EN}" (the criterion's own baseline assumption)`);
  assert.ok(headTitle(en.body).endsWith(` — ${TITLE_TOKEN}`),
    `⑥ en <title> still ends with this page's own pre-AC-299 token (got ${JSON.stringify(headTitle(en.body))})`);

  // ② NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3: enumerate, don't report
  //    a boolean "the nav looks translated").
  const desktopEn = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const desktopZh = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  const mobileEn = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const mobileZh = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  console.log(`  [ac299] en desktop nav-current = ${JSON.stringify(desktopEn)}`);
  console.log(`  [ac299] zh desktop nav-current = ${JSON.stringify(desktopZh)}`);
  console.log(`  [ac299] en mobile  nav-current = ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac299] zh mobile  nav-current = ${JSON.stringify(mobileZh)}`);
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
  const navHits = (navEn.match(/Sessions/g) || []).length;
  const bodyHits = (en.body.match(/Sessions/g) || []).length;
  console.log(`  [ac299] en literal "${LABEL_EN}": nav region ${navHits} hit(s), whole body ${bodyHits} hit(s)`);
  assert.equal(navHits, 2, `control: the en nav region carries the literal exactly twice (desktop+mobile), got ${navHits}`);
  assert.ok(bodyHits > navHits,
    `control: the en literal also occurs OUTSIDE the nav region (${bodyHits} > ${navHits}) — the nav match is really scoping`);

  // ④ this page's OWN <title>. Asserted as a pair AND as a difference (the criterion's shape), with
  //    both raw fragments printed side by side.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac299] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac299] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.includes(LABEL_EN), `④ en <title> carries the literal baseline (got ${JSON.stringify(tEn)})`);
  assert.notEqual(tZh, tEn, "④ the page's OWN <title> is not byte-identical across the two languages");
  assert.ok(!tZh.includes(LABEL_EN), `④ the zh <title> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(tZh)})`);
  assert.ok(tZh.includes("会话"), `④ the zh <title> carries the translated token (got ${JSON.stringify(tZh)})`);

  // ⑤ this page's OWN <h1>.
  const h1En = h1Of(en.body);
  const h1Zh = h1Of(zh.body);
  console.log(`  [ac299] en <h1> = ${JSON.stringify(h1En)}`);
  console.log(`  [ac299] zh <h1> = ${JSON.stringify(h1Zh)}`);
  assert.equal(h1En, H1_TOKEN, `⑤ the en <h1> is the full h1 token (got ${JSON.stringify(h1En)})`);
  assert.ok(!h1Zh.includes(LABEL_EN), `⑤ the zh <h1> carries no ASCII "${LABEL_EN}" (got ${JSON.stringify(h1Zh)})`);
  assert.equal(h1Zh, H1_ZH, `⑤ the zh <h1> is translated (got ${JSON.stringify(h1Zh)})`);
});

test("AC1b: the mobile header page label (rendered OUTSIDE the nav region) also switches", async () => {
  // The criterion CANNOT see this one: `<span class="mobile-header-page">` sits before the first
  // `<nav>`, so the greedy `/<nav.*<\/nav>/` region never contains it. It is nevertheless this
  // page's own chrome, and leaving it English would be a mechanical criterion that is weaker than
  // the spec's intent. Asserted from the raw body, NOT via the nav region.
  const en = await request(port, "/sessions");
  const zh = await request(port, "/sessions", { Cookie: "lang=zh" });
  const enLabel = mobileHeaderPage(en.body);
  const zhLabel = mobileHeaderPage(zh.body);
  console.log(`  [ac299] en mobile-header-page = ${JSON.stringify(enLabel)}`);
  console.log(`  [ac299] zh mobile-header-page = ${JSON.stringify(zhLabel)}`);
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
  const bare = await request(port, "/sessions");
  const explicit = await request(port, "/sessions?lang=en");
  assert.equal(navRegion(bare.body), navRegion(explicit.body),
    "the default-locale nav region is identical with and without an explicit ?lang=en");
  assert.equal(headTitle(bare.body), headTitle(explicit.body),
    "the default-locale <title> is identical with and without an explicit ?lang=en");
  assert.equal(h1Of(bare.body), h1Of(explicit.body),
    "the default-locale <h1> is identical with and without an explicit ?lang=en");
  assert.equal(mobileHeaderPage(bare.body), mobileHeaderPage(explicit.body),
    "the default-locale mobile header page label is identical with and without an explicit ?lang=en");
  // The whole body differs only by the per-request `age Ns` counters (session.lifecycle lines), which
  // tick between two HTTP round-trips; pin the CHROME (above) rather than the volatile data line.
  assert.equal(
    bare.body.replace(/age \d+s/g, "age Ns"),
    explicit.body.replace(/age \d+s/g, "age Ns"),
    "the whole default-locale /sessions response is byte-identical (age counters apart) with and without an explicit ?lang=en");
});
