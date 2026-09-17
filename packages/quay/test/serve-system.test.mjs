// @test-group product
// gap-ac293-system-page-zh-chrome-nav-current-and-own-title — /system's own zh chrome (AC-293 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the label
// DICTIONARY + wired /dashboard; AC-290/291/292 wired /tasks, /live and /board. This task wires the
// NEXT page: /system.
//
// Why this file exists at all, and why it asserts on a REAL server: the failure it guards against is
// not "the code has no lang parameter" — it is "the shared nav bar switched but THIS page did not".
// `handleSystem` already received `cfg.lang` from the dispatcher (serve-handlers.ts) and dropped it;
// the goal criterion's own `title-unchanged` arm fails a page whose nav translated but whose OWN
// `<title>` stayed English. So the assertions are split the way the defect is:
//
//   AC-dict      — the dictionary as a PURE function, imported directly. The zh tokens are asserted
//                  non-empty, distinct from their en peers, and free of the ASCII literal "System"
//                  (a "translated" column that still carried the English word would satisfy
//                  "non-empty" while leaving the criterion's nav-literal arm red — the
//                  gate-gameability shape). `en` is asserted to be the IDENTITY for both tokens:
//                  that is what makes the en baseline byte-stable by construction rather than by
//                  everyone remembering not to re-word it.
//
//   AC-black-box — a REAL `startServer` on a real workspace, read through raw HTTP. The nav region
//                  is extracted with the SAME method the goal criterion uses (flatten newlines,
//                  then `/<nav.*<\/nav>/`) so this file and the criterion cannot drift on what
//                  "the nav region" means. The current nav item is asserted SEPARATELY for the
//                  desktop and mobile renderings (hard rule 3: enumerate, do not report a boolean
//                  "the nav looks translated").
//
//   AC-en-baseline — the en rendering pinned VERBATIM over HTTP. A lang-parameterised renderer that
//                  quietly moved the default rendering would move the criterion's own baseline, and
//                  the criterion would then be measuring a moving target. Pinned as literals, never
//                  derived from the dictionary (硬规则 4 — a structural identity is not a
//                  measurement).
//
//   AC-scope     — /system and /manager live in the SAME source file (serve-system.ts). Wiring the
//                  wrong one of the two, or copy-pasting one page's tokens onto the other, would
//                  still pass every assertion above, so the scope boundary is asserted rather than
//                  assumed: the two pages keep DISTINCT page tokens under BOTH languages.
//                  ⚠️ Under AC-293 this tier additionally asserted that /manager kept its hard-coded
//                  `<html lang="en">` and its English page token. AC-294 wired /manager, so that
//                  half is gone — it was TRUE then and is FALSE now, and leaving it would have made
//                  the suite permanently red for a state the repo deliberately moved past. What
//                  survives is the part that stays true for every later page: the shared file did
//                  not collapse the two pages' chrome into one.
//
// ⛔ `renderSystemPage` is deliberately NOT exported (it never was), so the en-baseline tier reads
// the page over HTTP like the criterion does rather than importing a private renderer: widening the
// module's export surface just to make a unit test cheaper would be a product change made for the
// test's convenience.
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

/** The two page-chrome tokens /system resolves, pinned as the literals the page passes at its call
 *  sites. ⛔ Not imported from serve-i18n.ts: deriving the expectation from the thing under test
 *  would make the assertion a tautology. */
const TITLE_TOKEN = "System — 系统状态";
const H1_TOKEN = "System";
const TITLE_TOKEN_ZH = "系统 — 系统状态";
const H1_TOKEN_ZH = "系统";

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

/** The nav region, extracted exactly as the AC-293 goal criterion extracts it. */
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

// ── AC-dict: the two /system page-chrome tokens, as a pure function ───────────────────────────

test("AC-dict: the two /system page tokens translate under zh and are the identity under en", () => {
  assert.equal(pageNameFor(TITLE_TOKEN, "en"), TITLE_TOKEN, "en is the identity for the <title> token");
  assert.equal(pageNameFor(H1_TOKEN, "en"), H1_TOKEN, "en is the identity for the <h1> token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_TOKEN_ZH,
    `the zh <title> token is ${JSON.stringify(TITLE_TOKEN_ZH)}`);
  assert.equal(pageNameFor(H1_TOKEN, "zh"), H1_TOKEN_ZH,
    `the zh <h1> token is ${JSON.stringify(H1_TOKEN_ZH)}`);

  // (a) the criterion's own literal, asserted absent from BOTH zh values directly. A zh value of
  //     e.g. "System 系统" would satisfy "non-empty" while leaving the nav-literal arm red.
  for (const zhValue of [pageNameFor(TITLE_TOKEN, "zh"), pageNameFor(H1_TOKEN, "zh")]) {
    assert.ok(!zhValue.includes(H1_TOKEN),
      `a zh /system token must not carry the ASCII literal "System" (got ${JSON.stringify(zhValue)})`);
  }
  // (b) control — that same predicate DOES fire on the en values, so (a) is not vacuous.
  assert.ok(pageNameFor(TITLE_TOKEN, "en").includes(H1_TOKEN),
    "control: the \"no ASCII System\" predicate fires on the en <title> token it must reject");
  assert.ok(pageNameFor(H1_TOKEN, "en").includes(H1_TOKEN),
    "control: the \"no ASCII System\" predicate fires on the en <h1> token it must reject");
  // (c) control — the function is not constant across languages for either token.
  assert.notEqual(pageNameFor(TITLE_TOKEN, "zh"), pageNameFor(TITLE_TOKEN, "en"),
    "control: pageNameFor is not constant across languages for the <title> token");
  assert.notEqual(pageNameFor(H1_TOKEN, "zh"), pageNameFor(H1_TOKEN, "en"),
    "control: pageNameFor is not constant across languages for the <h1> token");
  // (d) the FULL-token lookup is what actually fires. The page passes `System — 系统状态` to
  //     `pageTitle`, not the bare `System`; a dictionary keyed only on the short token would leave
  //     the title English and this is the assertion that says so (the `title-unchanged` arm).
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_TOKEN_ZH,
    "the dictionary is keyed on the FULL pageTitle token, em dash included");
  assert.notEqual(pageNameFor(TITLE_TOKEN, "zh"), H1_TOKEN_ZH,
    "control: the full token and the short token do not resolve to the same string");
});

// ── AC-black-box: a real server, read through raw HTTP ────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "ac293-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac293-ws-"));
  const fm = (id, title, status) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n`;
  fs.writeFileSync(path.join(tasksDir, "AC293-001.md"),
    fm("AC293-001", "System 数据面的任务标题不是本判据的对象", "ready"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac293 fixture workspace\n");
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

test("AC-black-box: /system under Cookie lang=zh switches html lang, both nav current items, and its OWN <title>", async () => {
  const en = await request(port, "/system");
  const zh = await request(port, "/system", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /system (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /system (zh) returns 200 (got ${zh.status})`);

  // (0) the mechanism itself, restated so a regression in AC-288 reds THIS file too.
  assert.ok(en.body.includes('<html lang="en">'), "the en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "the zh response is <html lang=\"zh\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // (1a) the en baseline still carries the literal — otherwise "absent under zh" would be vacuous.
  assert.ok(navEn.includes(H1_TOKEN),
    "the en nav region carries the literal \"System\" (the baseline the criterion asserts on)");

  // (1b) THE NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3).
  const desktopEn = currentItem(navEn, "nav-");
  const desktopZh = currentItem(navZh, "nav-");
  const mobileEn = currentItem(navEn, "mobile-menu-");
  const mobileZh = currentItem(navZh, "mobile-menu-");
  console.log(`  [ac293] en desktop/mobile current nav item = ${JSON.stringify(desktopEn)} / ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac293] zh desktop/mobile current nav item = ${JSON.stringify(desktopZh)} / ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, H1_TOKEN, "the en desktop current item is the baseline \"System\"");
  assert.equal(mobileEn, H1_TOKEN, "the en mobile current item is the baseline \"System\"");
  assert.equal(desktopZh, H1_TOKEN_ZH, `the desktop current item is ${JSON.stringify(H1_TOKEN_ZH)} under zh`);
  assert.equal(mobileZh, H1_TOKEN_ZH, `the mobile current item is ${JSON.stringify(H1_TOKEN_ZH)} under zh`);
  assert.notEqual(desktopZh, H1_TOKEN, "the zh desktop current item is not the English literal");
  assert.notEqual(mobileZh, H1_TOKEN, "the zh mobile current item is not the English literal");

  // (1c) the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(H1_TOKEN), "the zh nav region carries no literal \"System\"");

  // (2) THIS PAGE'S OWN <title> — the arm the criterion's `title-unchanged` CAUSE exists for.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac293] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac293] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.endsWith(` — ${TITLE_TOKEN}`), `the en <title> ends with " — ${TITLE_TOKEN}" (got ${JSON.stringify(tEn)})`);
  assert.ok(tZh.endsWith(` — ${TITLE_TOKEN_ZH}`), `the zh <title> ends with " — ${TITLE_TOKEN_ZH}" (got ${JSON.stringify(tZh)})`);
  assert.notEqual(tZh, tEn, "this page's OWN <title> is not byte-identical across the two languages");
  assert.ok(!tZh.includes(H1_TOKEN), `the zh <title> carries no ASCII literal "System" (got ${JSON.stringify(tZh)})`);

  // (3) THIS PAGE'S OWN <h1> (GOAL-024's "本页 chrome", though the criterion does not read it).
  assert.equal(h1Of(en.body), `${H1_TOKEN} — 系统状态`, "the en <h1> is the baseline");
  assert.equal(h1Of(zh.body), `${H1_TOKEN_ZH} — 系统状态`, "the zh <h1> is translated");
});

test("AC-en-baseline: the en chrome is the pre-AC-293 rendering verbatim", async () => {
  const en = await request(port, "/system");
  assert.equal(en.status, 200, "GET /system (en) returns 200");

  // The pre-AC-293 literals, pinned. Each one is something the change COULD have moved.
  assert.ok(en.body.includes('<html lang="en">'), "the en page is <html lang=\"en\">");
  assert.ok(headTitle(en.body).endsWith(` — ${TITLE_TOKEN}`),
    "the en <title> still ends with its English page token, byte for byte");
  assert.ok(en.body.replace(/\n/g, " ").includes(`<h1>${H1_TOKEN} — 系统状态</h1>`),
    "the en <h1> is still the pre-AC-293 literal, byte for byte");
  assert.ok(en.body.includes('<span class="mobile-header-page">system</span>'),
    "the en mobile header page label is still the lowercase \"system\" (not re-worded by this task)");

  // The en nav region is unchanged: the shared chrome was already translated by AC-289's dictionary
  // and this task must not have re-worded the `en` column of NAV_LABELS.
  const navEn = navRegion(en.body);
  assert.equal(currentItem(navEn, "nav-"), H1_TOKEN, "the en desktop current nav item is the baseline \"System\"");
  assert.equal(currentItem(navEn, "mobile-menu-"), H1_TOKEN, "the en mobile current nav item is the baseline \"System\"");
});

test("AC-scope: /system and /manager keep DISTINCT page tokens across both languages", async () => {
  // ⛔ /system and /manager share serve-system.ts. Wiring the wrong one of the two, or letting the
  // edit that wired the second page copy the first page's tokens into it, would still pass every
  // assertion above (they only look at /system), so the boundary is asserted rather than assumed.
  //
  // ⚠️ This tier USED to assert that /manager was still <html lang="en"> under the zh cookie and
  // that its <title> was byte-identical across languages. AC-294 wired /manager; that assertion is
  // now false by construction and was replaced (not weakened) by the distinctness check below —
  // which stays meaningful for every further page wired into this file.
  const sysEn = await request(port, "/system");
  const mgrEn = await request(port, "/manager");
  const mgrZh = await request(port, "/manager", { Cookie: "lang=zh" });
  assert.equal(mgrEn.status, 200, "GET /manager (en) returns 200");
  assert.equal(mgrZh.status, 200, "GET /manager (zh) returns 200");

  // /manager is now wired by its own AC (AC-294) — the runtime counterpart of the file-level count
  // (`serve-system.ts`: `html lang="en"` 2 → 1 under AC-293, → 0 under AC-294).
  assert.ok(mgrZh.body.includes('<html lang="zh"'),
    "/manager is <html lang=\"zh\"> under the zh cookie — AC-294 wired it");
  assert.notEqual(headTitle(mgrZh.body), headTitle(mgrEn.body),
    "/manager's own <title> moves with the locale");
  assert.ok(headTitle(mgrEn.body).endsWith(" — Manager / Outer / Inner"),
    "the en /manager <title> still carries its English page token (its en baseline did not move)");

  // THE surviving scope assertion: the two pages sharing this file did not collapse into one
  // another. Under en AND under zh, each page's own <title> token is its own.
  assert.ok(headTitle(mgrEn.body).endsWith(" — Manager / Outer / Inner"),
    "the /manager <title> token is /manager's own");
  assert.ok(headTitle(sysEn.body).endsWith(" — System — 系统状态"),
    "the /system <title> token is /system's own");
  assert.notEqual(headTitle(mgrEn.body), headTitle(sysEn.body),
    "the two pages in the shared file do not render the same <title>");
  assert.ok(mgrZh.body.replace(/\n/g, " ").includes("<h1>管理器 / 外层 / 内层 — 三层状态</h1>"),
    "the /manager <h1> carries /manager's own zh token, not /system's");
  assert.ok(!mgrZh.body.replace(/\n/g, " ").includes("系统状态"),
    "the /manager page carries none of /system's page chrome");
});
