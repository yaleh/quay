// @test-group product
// gap-ac294-manager-page-zh-chrome-nav-current-and-own-title — /manager's own zh chrome (AC-294 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the label
// DICTIONARY + wired /dashboard; AC-290..293 wired /tasks, /live, /board and /system. This task
// wires the NEXT page: /manager.
//
// Why this file exists at all, and why it asserts on a REAL server: the failure it guards against is
// not "the code has no lang parameter" — it is "the shared nav bar switched but THIS page did not".
// `handleManager` already received `cfg.lang` from the dispatcher (serve-handlers.ts) and dropped it;
// the goal criterion's own `title-unchanged` arm fails a page whose nav translated but whose OWN
// `<title>` stayed English. So the assertions are split the way the defect is:
//
//   AC-dict      — the dictionary as a PURE function, imported directly. The zh token is asserted
//                  non-empty, distinct from its en peer, and free of the ASCII literal "Manager"
//                  (a "translated" column that still carried the English word would satisfy
//                  "non-empty" while leaving the criterion's nav-literal arm red — the
//                  gate-gameability shape). `en` is asserted to be the IDENTITY: that is what makes
//                  the en baseline byte-stable by construction rather than by everyone remembering
//                  not to re-word it.
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
// ⚠️ An earlier draft of this file carried an AC-scope tier imported from AC-293's test, asserting
// that /manager's `Manager` nav item was NOT translated. That assertion was correct under AC-293 and
// is FALSE by construction under AC-294 — this task IS the one that retires that boundary — so it
// was deleted here rather than weakened. (The same-file boundary is still asserted, from the other
// side, by serve-system.test.mjs's own AC-scope tier.)
//
// ⛔ `renderManagerPage` is deliberately NOT exported (it never was), so the en-baseline tier reads
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

/** This page's OWN chrome tokens, pinned as the literals the page passes at its call sites.
 *  ⛔ Not imported from serve-i18n.ts: deriving the expectation from the thing under test would
 *  make the assertion a tautology.
 *
 *  ⚠️ /manager is the first wired page whose `<title>` token and `<h1>` page-name token are the SAME
 *  string: its `<h1>` is that page name plus the ` — 三层状态` subtitle. So there is exactly ONE
 *  page token here, and it is NOT the nav label `Manager` — the nav label resolves independently
 *  through NAV_LABELS (ROW 1), the page token through pageNameFor (ROW 3). Keeping the two apart in
 *  this file is what lets the nav-current assertion and the title assertion fail independently. */
const TITLE_TOKEN = "Manager / Outer / Inner";
const TITLE_TOKEN_ZH = "管理器 / 外层 / 内层";
/** The SHARED nav label for this page's nav-current item — from NAV_LABELS, not PAGE_LABELS. */
const NAV_LABEL_EN = "Manager";
const NAV_LABEL_ZH = "管理器";

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

/** The nav region, extracted exactly as the AC-294 goal criterion extracts it. */
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

// ── AC-dict: the /manager page-chrome token, as a pure function ───────────────────────────────

test("AC-dict: the /manager page token translates under zh and is the identity under en", () => {
  assert.equal(pageNameFor(TITLE_TOKEN, "en"), TITLE_TOKEN, "en is the identity for the page token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_TOKEN_ZH,
    `the zh page token is ${JSON.stringify(TITLE_TOKEN_ZH)}`);

  // (a) the criterion's own literal, asserted absent from the zh value directly. A zh value of
  //     e.g. "Manager 管理器" would satisfy "non-empty" while leaving the nav-literal arm red.
  const zhValue = pageNameFor(TITLE_TOKEN, "zh");
  assert.ok(!zhValue.includes(NAV_LABEL_EN),
    `a zh /manager token must not carry the ASCII literal "Manager" (got ${JSON.stringify(zhValue)})`);
  // (b) control — that same predicate DOES fire on the en value, so (a) is not vacuous.
  assert.ok(pageNameFor(TITLE_TOKEN, "en").includes(NAV_LABEL_EN),
    "control: the \"no ASCII Manager\" predicate fires on the en page token it must reject");
  // (c) control — the function is not constant across languages for this token.
  assert.notEqual(pageNameFor(TITLE_TOKEN, "zh"), pageNameFor(TITLE_TOKEN, "en"),
    "control: pageNameFor is not constant across languages for the page token");
  // (d) an unmapped token stays English rather than blanking (ROW 3's visible degradation) — the
  //     control that the translation above came from THIS token's entry and not from a blanket rule.
  assert.equal(pageNameFor("Journal / Some Other Page", "zh"), "Journal / Some Other Page",
    "control: a token with no entry is left as its English self, not blanked");
  // (e) the full-token lookup is what actually fires: the page passes the WHOLE `Manager / Outer /
  //     Inner` string (spaces and slashes included). A dictionary keyed on the bare `Manager` would
  //     miss and leave the title English — which IS the `title-unchanged` arm.
  assert.notEqual(pageNameFor(TITLE_TOKEN, "zh"), pageNameFor(NAV_LABEL_EN, "zh"),
    "the page token resolves differently from the bare nav label");
});

// ── AC-black-box: a real server, read through raw HTTP ────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "ac294-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac294-ws-"));
  const fm = (id, title, status) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n`;
  fs.writeFileSync(path.join(tasksDir, "AC294-001.md"),
    fm("AC294-001", "Manager 数据面的任务标题不是本判据的对象", "ready"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac294 fixture workspace\n");
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

test("AC-black-box: /manager under Cookie lang=zh switches html lang, both nav current items, and its OWN <title>", async () => {
  const en = await request(port, "/manager");
  const zh = await request(port, "/manager", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /manager (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /manager (zh) returns 200 (got ${zh.status})`);

  // (0) the mechanism itself, restated so a regression in AC-288 reds THIS file too.
  assert.ok(en.body.includes('<html lang="en">'), "the en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "the zh response is <html lang=\"zh\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // (1a) the en baseline still carries the literal — otherwise "absent under zh" would be vacuous.
  assert.ok(navEn.includes(NAV_LABEL_EN),
    "the en nav region carries the literal \"Manager\" (the baseline the criterion asserts on)");

  // (1b) THE NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3).
  const desktopEn = currentItem(navEn, "nav-");
  const desktopZh = currentItem(navZh, "nav-");
  const mobileEn = currentItem(navEn, "mobile-menu-");
  const mobileZh = currentItem(navZh, "mobile-menu-");
  console.log(`  [ac294] en desktop/mobile current nav item = ${JSON.stringify(desktopEn)} / ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac294] zh desktop/mobile current nav item = ${JSON.stringify(desktopZh)} / ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, NAV_LABEL_EN, "the en desktop current item is the baseline \"Manager\"");
  assert.equal(mobileEn, NAV_LABEL_EN, "the en mobile current item is the baseline \"Manager\"");
  assert.equal(desktopZh, NAV_LABEL_ZH, `the desktop current item is ${JSON.stringify(NAV_LABEL_ZH)} under zh`);
  assert.equal(mobileZh, NAV_LABEL_ZH, `the mobile current item is ${JSON.stringify(NAV_LABEL_ZH)} under zh`);
  assert.notEqual(desktopZh, NAV_LABEL_EN, "the zh desktop current item is not the English literal");
  assert.notEqual(mobileZh, NAV_LABEL_EN, "the zh mobile current item is not the English literal");

  // (1c) the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(NAV_LABEL_EN), "the zh nav region carries no literal \"Manager\"");

  // (2) THIS PAGE'S OWN <title> — the arm the criterion's `title-unchanged` CAUSE exists for.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac294] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac294] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.endsWith(` — ${TITLE_TOKEN}`), `the en <title> ends with " — ${TITLE_TOKEN}" (got ${JSON.stringify(tEn)})`);
  assert.ok(tZh.endsWith(` — ${TITLE_TOKEN_ZH}`), `the zh <title> ends with " — ${TITLE_TOKEN_ZH}" (got ${JSON.stringify(tZh)})`);
  assert.notEqual(tZh, tEn, "this page's OWN <title> is not byte-identical across the two languages");
  assert.ok(!tZh.includes(NAV_LABEL_EN), `the zh <title> carries no ASCII literal "Manager" (got ${JSON.stringify(tZh)})`);

  // (3) THIS PAGE'S OWN <h1> (GOAL-024's "本页 chrome", though the criterion does not read it).
  assert.equal(h1Of(en.body), `${TITLE_TOKEN} — 三层状态`, "the en <h1> is the baseline");
  assert.equal(h1Of(zh.body), `${TITLE_TOKEN_ZH} — 三层状态`, "the zh <h1> is translated");
});

test("AC-en-baseline: the en chrome is the pre-AC-294 rendering verbatim", async () => {
  const en = await request(port, "/manager");
  assert.equal(en.status, 200, "GET /manager (en) returns 200");

  // The pre-AC-294 literals, pinned. Each one is something the change COULD have moved.
  assert.ok(en.body.includes('<html lang="en">'), "the en page is <html lang=\"en\">");
  assert.ok(headTitle(en.body).endsWith(` — ${TITLE_TOKEN}`),
    "the en <title> still ends with its English page token, byte for byte");
  assert.ok(en.body.replace(/\n/g, " ").includes(`<h1>${TITLE_TOKEN} — 三层状态</h1>`),
    "the en <h1> is still the pre-AC-294 literal, byte for byte");
  assert.ok(en.body.includes('<span class="mobile-header-page">manager</span>'),
    "the en mobile header page label is still the lowercase \"manager\" (not re-worded by this task)");

  // The en nav region is unchanged: the shared chrome was already translated by AC-289's dictionary
  // and this task must not have re-worded the `en` column of NAV_LABELS.
  const navEn = navRegion(en.body);
  assert.equal(currentItem(navEn, "nav-"), NAV_LABEL_EN, "the en desktop current nav item is the baseline \"Manager\"");
  assert.equal(currentItem(navEn, "mobile-menu-"), NAV_LABEL_EN, "the en mobile current nav item is the baseline \"Manager\"");
});
