// @test-group product
// gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title — /git-history's own zh chrome
// (AC-297 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the label
// DICTIONARY + wired /dashboard; AC-290..296 wired one page each. This task wires /git-history —
// and it is the FIRST of the series with TWO view branches in one page.
//
// Why this file exists at all, and why it asserts on a REAL server: the failure it guards against is
// not "the code has no lang parameter" — it is "the shared nav bar switched but THIS page did not".
// `handleGitHistory` already received `cfg.lang` from the dispatcher (serve-handlers.ts) and dropped
// it (`renderGitHistoryPage(history, gitHistoryViewOf(url), remotes, cfg.identity)`), so the page
// hard-coded `<html lang="en">` and rendered every label from the English columns. The goal
// criterion's own `title-unchanged` arm fails a page whose nav translated but whose OWN `<title>`
// stayed English. So the assertions are split the way the defect is:
//
//   AC-dict      — the dictionary as a PURE function, imported directly. This is where the SHARPEST
//                  trap of this task lives, and it bites TWICE: `renderGitHistoryPage` has two view
//                  branches (`"git"` — the DEFAULT — and `?view=task`), each passing pageTitle its
//                  OWN full token (`"Git history — vertical commit timeline"` /
//                  `"Git history — 任务分组"`, U+2014 EM DASH included). A PAGE_LABELS entry keyed by
//                  a bare `"Git history"` — or one registered for only ONE of the two branches —
//                  MISSES the lookup, and the title stays English: the exact `title-unchanged` arm,
//                  one branch over. The byte-equality assertions below are what make that miss
//                  impossible to land unnoticed. The zh tokens are also asserted non-empty, distinct
//                  from their en peers, and free of the ASCII literals "Git History" / "Git history"
//                  (a "translated" column that still carried the English words would satisfy
//                  "non-empty" while leaving the criterion's nav-literal arm red — the
//                  gate-gameability shape).
//
//   AC-black-box — a REAL `startServer` on a real workspace, read through raw HTTP, for BOTH view
//                  branches. The nav region is extracted with the SAME method the goal criterion uses
//                  (flatten newlines, then `/<nav.*<\/nav>/`, greedy) so this file and the criterion
//                  cannot drift on what "the nav region" means. The current nav item is asserted
//                  SEPARATELY for the desktop and mobile renderings (hard rule 3: enumerate, do not
//                  report a boolean "the nav looks translated"). ⛔ The page's body renders commit
//                  subjects (data) — every literal assertion below is scoped to the nav region, a
//                  `<title>`, or the `<h1>`, never to the whole response body, because a data hit
//                  would make a whole-body substring assertion unsatisfiable (the /board, /dashboard
//                  failure mode GOAL-024's criterion was rewritten to avoid).
//
//   AC-en-baseline — the en rendering pinned VERBATIM, for both branches. A lang-parameterised
//                  renderer that quietly moved the default rendering would move the criterion's own
//                  baseline, and the criterion would then be measuring a moving target. Pinned as
//                  literals, never derived from the dictionary (硬规则 4 — a structural identity is
//                  not a measurement).
//
//   ⚠️ MIGRATION (gap-webui-git-history-body-copy-en-zh): the CHROME this file pins did not move —
//                  html lang, both nav current items, the mobile page label, the two `<title>`s and
//                  the en page NAME in the `<h1>` are all still asserted against the same literals.
//                  What changed is the `<h1>` SUBTITLE, which AC-297 had deliberately left Chinese on
//                  the en page ("already Chinese in the en baseline"); the follow-up task's AC1
//                  red-baseline lists that line among the 12 en-visible Chinese lines, so it is now
//                  localized and the suffix is pinned per language. The zh arm is byte-identical to
//                  the pre-extraction literal — that is the regression guard, and it is unchanged.
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

/** This page's four page-chrome tokens, pinned as the literals the page passes at its call sites.
 *  ⛔ Not imported from serve-i18n.ts: deriving the expectation from the thing under test would make
 *  the assertion a tautology. The two TITLE tokens are deliberately the WHOLE strings the two
 *  `<title>` call sites pass — em dash and trailing phrase included — because that byte-equality is
 *  the property under test (see the AC-dict comment above). NOTE the capitalisation split: the nav
 *  label and the `<h1>` say `Git History`, while both `<title>` tokens say `Git history`; they are
 *  separate lookups, and registering one does NOT serve the other. */
const TITLE_TOKEN_GIT = "Git history — vertical commit timeline";
const TITLE_TOKEN_TASK = "Git history — 任务分组";
const H1_TOKEN = "Git History";
const MOBILE_TOKEN = "git history";
const TITLE_TOKEN_GIT_ZH = "Git 历史 — 提交纵向时间轴";
const TITLE_TOKEN_TASK_ZH = "Git 历史 — 任务分组";
const H1_TOKEN_ZH = "Git 历史";
/** `NAV_LABELS.git.zh` (ROW 1 — shared chrome, NOT this task's dictionary). Pinned as a literal for
 *  the same reason: the current nav item's text comes from the nav dictionary, and deriving the
 *  expectation from it would assert nothing. */
const NAV_CURRENT_ZH = "Git 历史";
/** The `<h1>` subtitle suffixes, per language.
 *
 *  ⚠️ MIGRATED by gap-webui-git-history-body-copy-en-zh. AC-297 left these as ONE Chinese pair
 *  because "the subtitle was already Chinese in the en baseline" — i.e. the en `<h1>` read
 *  `Git History — 提交纵向时间轴`. That WAS the body-copy defect the follow-up task exists to remove
 *  (its AC1 red baseline lists the en `<h1>` line among the 12), so the suffix now comes from
 *  serve-i18n.ts ROW 17 and the two columns are asserted SEPARATELY. The zh pair is byte-identical
 *  to the pre-extraction literals — that is the arm this file has always guarded, and it is
 *  unchanged; only the en pair is new. */
const H1_SUFFIX_GIT = " — vertical commit timeline";
const H1_SUFFIX_TASK = " — task grouping timeline";
const H1_SUFFIX_GIT_ZH = " — 提交纵向时间轴";
const H1_SUFFIX_TASK_ZH = " — 任务分组时间轴";
/** The three ASCII spellings of this page's name that a "translated" value must NOT still carry.
 *  The criterion's own two greps are case-SENSITIVE (`Git History` / `Git history`); the
 *  all-lowercase mobile token is the third the page emits. */
const ASCII_GIT_HISTORY = ["Git History", "Git history", "git history"];

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

/** The nav region, extracted exactly as the AC-297 goal criterion extracts it (flatten newlines,
 *  then the GREEDY `/<nav.*<\/nav>/`). Greedy is load-bearing: the first `<nav` is the mobile menu's
 *  and the last `</nav>` is the desktop bar's, so the region covers BOTH current-item renderings —
 *  which is why the criterion reads two hits and why this file asserts both. */
function navRegion(body) {
  const m = /<nav.*<\/nav>/.exec(body.replace(/\n/g, " "));
  return m ? m[0] : "";
}

function headTitle(body) {
  const m = /<title>([^<]*)<\/title>/.exec(body.replace(/\n/g, " "));
  return m ? m[1] : "";
}

function h1Of(body) {
  const m = /<h1>([^<]*)<\/h1>/.exec(body.replace(/\n/g, " "));
  return m ? m[1] : "";
}

/** The nav item the page marks as CURRENT — one match per rendering (desktop / mobile). */
function currentItem(region, prefix) {
  const m = new RegExp(`<span class="${prefix}item nav-current"[^>]*>([^<]*)</span>`).exec(region);
  return m ? m[1] : null;
}

function mobilePageLabel(body) {
  const m = /<span class="mobile-header-page">([^<]*)<\/span>/.exec(body);
  return m ? m[1] : null;
}

// ── AC-dict: this page's four page-chrome tokens, as a pure function ──────────────────────────────

test("AC-dict: the four /git-history page tokens translate under zh and are the identity under en", () => {
  const pairs = [
    [TITLE_TOKEN_GIT, TITLE_TOKEN_GIT_ZH],
    [TITLE_TOKEN_TASK, TITLE_TOKEN_TASK_ZH],
    [H1_TOKEN, H1_TOKEN_ZH],
    [MOBILE_TOKEN, H1_TOKEN_ZH],
  ];
  for (const [enToken, zhToken] of pairs) {
    // (0) THE TRAPS, asserted first: each key must be byte-equal to the token its call site passes.
    //     A dictionary keyed by a bare "Git history"/"Git History", or registering only ONE of the
    //     two branches' title tokens, returns the English string here — the `title-unchanged` arm —
    //     so this is the assertion that fails when an entry is mis-keyed, before any HTTP is
    //     involved.
    assert.equal(pageNameFor(enToken, "en"), enToken, `en is the identity for ${JSON.stringify(enToken)}`);
    assert.equal(pageNameFor(enToken, "zh"), zhToken,
      `${JSON.stringify(enToken)} resolves to ${JSON.stringify(zhToken)} under zh`);
    // (a) the criterion's own literals, asserted absent from the zh value directly. A zh value of
    //     e.g. "Git History 历史" would satisfy "non-empty" while leaving the nav-literal arm red.
    //     All three spellings are checked: the criterion greps case-sensitively for the CAPITALISED
    //     pair (the nav label and the two `<title>` tokens), while the mobile header's token is
    //     all-lowercase — a zh column carrying any of the three is "translated" only in appearance.
    for (const literal of ASCII_GIT_HISTORY) {
      assert.ok(!pageNameFor(enToken, "zh").includes(literal),
        `a zh /git-history token must not carry the ASCII literal ${JSON.stringify(literal)} (got ${JSON.stringify(zhToken)})`);
    }
    // (b) control — that same predicate DOES fire on the en token, so (a) is not vacuous.
    assert.ok(ASCII_GIT_HISTORY.some((literal) => pageNameFor(enToken, "en").includes(literal)),
      `control: the "no ASCII Git history" predicate fires on ${JSON.stringify(enToken)}, which it must reject`);
  }

  // (c) the two title tokens are DISTINCT keys — if they had collapsed to one string, registering
  //     one would cover both branches and the branch-coverage test below would be vacuous.
  assert.notEqual(TITLE_TOKEN_GIT, TITLE_TOKEN_TASK,
    "the two view branches pass DIFFERENT pageTitle tokens — they need separate dictionary entries");

  // (d) the em dash is U+2014, not a hyphen — the keys' byte-equality is claimed against a specific
  //     character, so pin the character rather than trusting the glyph.
  assert.ok(TITLE_TOKEN_GIT.includes("—") && TITLE_TOKEN_TASK.includes("—"),
    "the <title> tokens carry U+2014 EM DASH, not an ASCII hyphen");
  assert.equal(pageNameFor(TITLE_TOKEN_GIT.replace("—", "-"), "zh"), TITLE_TOKEN_GIT.replace("—", "-"),
    "control: a hyphen-spelled token is NOT mapped — the lookup is byte-exact, not fuzzy");

  // (e) the lookup is byte-exact on CASE too: the capitalised `<h1>` key must not serve the two
  //     lowercase `<title>` tokens (and vice versa) — the capitalisation split pinned above.
  assert.equal(pageNameFor("Git history", "zh"), "Git history",
    "control: the bare \"Git history\" token is NOT a registered key — only the two FULL title tokens are");
  assert.equal(pageNameFor("git History", "zh"), "git History",
    "control: a case-flipped token is NOT mapped — the lookup is byte-exact, not case-insensitive");

  // (f) this edit appended rows to a SHARED table; the pre-existing pages' rows must be untouched.
  assert.equal(pageNameFor("Dashboard", "zh"), "仪表盘", "AC-289's /dashboard row is intact");
  assert.equal(pageNameFor("task list", "zh"), "任务列表", "AC-290's /tasks row is intact");
  assert.equal(pageNameFor("Needs Human", "zh"), "待人工", "AC-295's /needs-human row is intact");
});

// ── AC-black-box: a real server, read through raw HTTP ───────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "ac297-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac297-ws-"));
  const fm = (id, title, status) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n`;
  fs.writeFileSync(path.join(tasksDir, "AC297-001.md"),
    fm("AC297-001", "Git History 数据面的任务标题不是本判据的对象", "ready"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac297 fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  // port 0: let the kernel pick. Probing for a free port ourselves would race the kernel and leak
  // the provider child process on a collision — which hangs the whole suite, not just this file.
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

/** All four arms of AC-297's AC1/AC1b, asserted SEPARATELY against one (view, lang) pair. */
async function assertViewSwitches(viewQuery, titleToken, titleTokenZh, h1SuffixEn, h1SuffixZh) {
  const url = `/git-history${viewQuery}`;
  const en = await request(port, url);
  const zh = await request(port, url, { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET ${url} (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET ${url} (zh) returns 200 (got ${zh.status})`);

  // (0) the mechanism itself, restated so a regression in AC-288 reds THIS file too.
  assert.ok(en.body.includes('<html lang="en">'), `the ${url} en response is <html lang="en">`);
  assert.ok(zh.body.includes('<html lang="zh"'), `the ${url} zh response is <html lang="zh">`);

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, `${url}: the en response exposes a <nav>…</nav> region to assert on`);
  assert.ok(navZh.length > 0, `${url}: the zh response exposes a <nav>…</nav> region to assert on`);

  // (1a) the en baseline still carries the literal — otherwise "absent under zh" would be vacuous.
  assert.ok(navEn.includes(H1_TOKEN),
    `${url}: the en nav region carries the literal "Git History" (the baseline the criterion asserts on)`);

  // (1b) THE NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3).
  const desktopEn = currentItem(navEn, "nav-");
  const desktopZh = currentItem(navZh, "nav-");
  const mobileEn = currentItem(navEn, "mobile-menu-");
  const mobileZh = currentItem(navZh, "mobile-menu-");
  console.log(`  [ac297] ${url} en desktop/mobile current nav item = ${JSON.stringify(desktopEn)} / ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac297] ${url} zh desktop/mobile current nav item = ${JSON.stringify(desktopZh)} / ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, H1_TOKEN, `${url}: the en desktop current item is the baseline "Git History"`);
  assert.equal(mobileEn, H1_TOKEN, `${url}: the en mobile current item is the baseline "Git History"`);
  assert.equal(desktopZh, NAV_CURRENT_ZH, `${url}: the desktop current item is ${JSON.stringify(NAV_CURRENT_ZH)} under zh`);
  assert.equal(mobileZh, NAV_CURRENT_ZH, `${url}: the mobile current item is ${JSON.stringify(NAV_CURRENT_ZH)} under zh`);
  assert.notEqual(desktopZh, H1_TOKEN, `${url}: the zh desktop current item is not the English literal`);
  assert.notEqual(mobileZh, H1_TOKEN, `${url}: the zh mobile current item is not the English literal`);

  // (1c) the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(H1_TOKEN), `${url}: the zh nav region carries no literal "Git History"`);

  // (2) THIS PAGE'S OWN <title> — the arm the criterion's `title-unchanged` CAUSE exists for.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac297] ${url} en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac297] ${url} zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.endsWith(` — ${titleToken}`), `${url}: the en <title> ends with " — ${titleToken}" (got ${JSON.stringify(tEn)})`);
  assert.ok(tZh.endsWith(` — ${titleTokenZh}`), `${url}: the zh <title> ends with " — ${titleTokenZh}" (got ${JSON.stringify(tZh)})`);
  assert.notEqual(tZh, tEn, `${url}: this page's OWN <title> is not byte-identical across the two languages`);
  // ⛔ The criterion's `title-unchanged` arm compares the two titles byte-for-byte, so a zh title that
  // still carried the English page token would be rejected even though it "changed" — assert the
  // literal's absence in the zh title directly rather than trusting the inequality above.
  assert.ok(!tZh.includes("Git history"), `${url}: the zh <title> carries no ASCII "Git history" (got ${JSON.stringify(tZh)})`);

  // (3) THIS PAGE'S OWN <h1> (GOAL-024's "本页 chrome", though the criterion does not read it). It is
  //     a SECOND call site of the same page name, so wiring only the <title> would leave it English.
  // ⚠️ The suffix is per-language since gap-webui-git-history-body-copy-en-zh: the en `<h1>` used to
  // carry the CHINESE suffix (AC-297 read it as "already Chinese in the en baseline", which is exactly
  // the body-copy defect the follow-up task removed). Both arms are asserted — the zh pair is the one
  // that must not have moved, the en pair is the one that had to.
  assert.equal(h1Of(en.body), `${H1_TOKEN}${h1SuffixEn}`, `${url}: the en <h1>`);
  assert.equal(h1Of(zh.body), `${H1_TOKEN_ZH}${h1SuffixZh}`, `${url}: the zh <h1> is translated`);
  assert.notEqual(h1Of(zh.body), h1Of(en.body), `${url}: the <h1> is not byte-identical across the two languages`);
  assert.ok(!h1Of(zh.body).includes("Git History"), `${url}: the zh <h1> carries no ASCII "Git History"`);
  // The en side of the same rule (the follow-up task's AC2): the en <h1> carries no CJK at all.
  assert.ok(!/[一-鿿]/.test(h1Of(en.body)), `${url}: the en <h1> carries no CJK (got ${JSON.stringify(h1Of(en.body))})`);
}

test("AC1: /git-history (DEFAULT view) under Cookie lang=zh switches html lang, both nav current items, its OWN <title> and <h1>", async () => {
  // The criterion requests the bare route, so THIS is the branch it reads.
  await assertViewSwitches("", TITLE_TOKEN_GIT, TITLE_TOKEN_GIT_ZH, H1_SUFFIX_GIT, H1_SUFFIX_GIT_ZH);
});

test("AC1b: /git-history?view=task under Cookie lang=zh switches the same four points (the SECOND branch)", async () => {
  // An independent control against a half-fix: wiring only the default branch leaves THIS branch
  // English, and wiring only this one leaves the CRITERION red. Neither reading substitutes for the
  // other — that is why the two are separate tests.
  await assertViewSwitches("?view=task", TITLE_TOKEN_TASK, TITLE_TOKEN_TASK_ZH, H1_SUFFIX_TASK, H1_SUFFIX_TASK_ZH);
});

// ── AC-en-baseline: the default rendering is byte-stable by construction ──────────────────────────

test("AC-en-baseline: both en renderings are the pre-AC-297 page verbatim", async () => {
  const enGit = await request(port, "/git-history");
  const enTask = await request(port, "/git-history?view=task");

  // The pre-AC-297 literals, pinned. Each one is something the change COULD have moved.
  assert.ok(enGit.body.includes('<html lang="en"><head>'),
    'the en page still opens <html lang="en"><head> — htmlLangTag(DEFAULT_LANG) must be byte-identical to the literal it replaced');
  assert.ok(headTitle(enGit.body).endsWith(` — ${TITLE_TOKEN_GIT}`),
    `the en default-view <title> still carries its English page token (got ${JSON.stringify(headTitle(enGit.body))})`);
  assert.ok(headTitle(enTask.body).endsWith(` — ${TITLE_TOKEN_TASK}`),
    `the en task-view <title> still carries its English page token (got ${JSON.stringify(headTitle(enTask.body))})`);
  // The en `<h1>`: its PAGE NAME is the AC-297 baseline verbatim; its SUBTITLE was localized by the
  // follow-up task, so it is now pinned as the ROW 17 en literal (see the MIGRATION note above).
  assert.ok(enGit.body.includes(`<h1>${H1_TOKEN}${H1_SUFFIX_GIT}</h1>`),
    "the en default-view <h1> keeps the AC-297 page name and the localized subtitle");
  assert.ok(enTask.body.includes(`<h1>${H1_TOKEN}${H1_SUFFIX_TASK}</h1>`),
    "the en task-view <h1> keeps the AC-297 page name and the localized subtitle");

  const navEn = navRegion(enGit.body);
  assert.equal(currentItem(navEn, "nav-"), H1_TOKEN,
    `the en desktop current nav item is still "Git History" (got ${JSON.stringify(currentItem(navEn, "nav-"))})`);
  assert.equal(currentItem(navEn, "mobile-menu-"), H1_TOKEN,
    'the en mobile current nav item is still "Git History"');
  assert.equal(mobilePageLabel(enGit.body), MOBILE_TOKEN,
    'the en mobile header page label is still the lowercase "git history" (not re-worded by this task)');

  // The dictionary half of "byte-stable by construction": `en` is the IDENTITY for every token, so
  // the en baseline cannot drift as pages are added to PAGE_LABELS.
  for (const token of [TITLE_TOKEN_GIT, TITLE_TOKEN_TASK, H1_TOKEN, MOBILE_TOKEN]) {
    assert.equal(pageNameFor(token, "en"), token, `en is the identity for ${JSON.stringify(token)}`);
  }
});

// ── Scope boundary: this task wired /git-history, and nothing else ────────────────────────────────

test("AC-scope: a neighbouring page's zh chrome is unaffected (no de-wiring while wiring this one)", async () => {
  // The shared dictionary is the one artifact every wired page reads, so the boundary is asserted
  // rather than assumed: /tasks (AC-290) and /dashboard (AC-289) must STILL switch under zh.
  for (const [route, enToken, zhToken] of [["/tasks", "Tasks", "任务"], ["/dashboard", "Dashboard", "仪表盘"]]) {
    const en = await request(port, route);
    const zh = await request(port, route, { Cookie: "lang=zh" });
    assert.equal(en.status, 200, `GET ${route} (en) returns 200`);
    assert.equal(zh.status, 200, `GET ${route} (zh) returns 200`);
    assert.ok(headTitle(en.body).endsWith(` — ${enToken}`),
      `${route}: the en <title> still carries its English page token (got ${JSON.stringify(headTitle(en.body))})`);
    assert.ok(headTitle(zh.body).endsWith(` — ${zhToken}`),
      `${route}: the zh <title> is still translated (got ${JSON.stringify(headTitle(zh.body))})`);
    assert.equal(currentItem(navRegion(zh.body), "nav-"), zhToken,
      `${route}: the zh nav current item is still translated`);
  }
});
