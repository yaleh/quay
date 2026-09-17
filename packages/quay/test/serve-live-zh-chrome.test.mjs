// @test-group product
// gap-ac291-live-page-zh-chrome-nav-current-and-own-title — /live's own zh chrome (AC-291 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the label
// DICTIONARY + wired /dashboard. This task wires the SECOND page: /live.
//
// Why this file exists at all, and why it asserts on a REAL server: the failure it guards against is
// not "the code has no lang parameter" — it is "the shared nav bar switched but THIS page did not".
// `handleLive` already received `cfg.lang` from the dispatcher (serve-handlers.ts) and dropped it;
// the goal criterion's own `title-unchanged` arm fails a page whose nav translated but whose OWN
// `<title>` stayed English. So the assertions are split the way the defect is:
//
//   AC-black-box — a REAL `startServer` on a real workspace, read through raw HTTP. The nav region
//                  is extracted with the SAME method the goal criterion uses (flatten newlines,
//                  then `/<nav.*<\/nav>/`) so this file and the criterion cannot drift on what
//                  "the nav region" means. The current nav item is asserted SEPARATELY for the
//                  desktop and mobile renderings (hard rule 3: enumerate, do not report a boolean
//                  "the nav looks translated").
//
//   AC-dict      — the dictionary as a PURE function, imported directly. The zh tokens are asserted
//                  non-empty, distinct from their en peers, and free of the ASCII literal "Live"
//                  (a "translated" column that still carried the English word would satisfy
//                  "non-empty" while leaving the criterion's nav-literal arm red — the
//                  gate-gameability shape). `en` is asserted to be the IDENTITY for both tokens:
//                  that is what makes the en baseline byte-stable by construction rather than by
//                  everyone remembering not to re-word it.
//
//   AC-en-baseline — the en rendering pinned VERBATIM. A lang-parameterised renderer that quietly
//                  moved the default rendering would move the criterion's own baseline, and the
//                  criterion would then be measuring a moving target. Pinned as literals, never
//                  derived from the dictionary (硬规则 4 — a structural identity is not a
//                  measurement).
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
import { renderLivePage } from "../src/serve-live.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The two page-chrome tokens /live resolves, pinned as the literals the page passes at its call
 *  sites. ⛔ Not imported from serve-i18n.ts: deriving the expectation from the thing under test
 *  would make the assertion a tautology. */
const TITLE_TOKEN = "Live — loop activity";
const H1_TOKEN = "Live";
const TITLE_TOKEN_ZH = "实时 — 循环活动";
const H1_TOKEN_ZH = "实时";

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

/** The nav region, extracted exactly as the AC-291 goal criterion extracts it. */
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

// ── AC-dict: the two /live page-chrome tokens, as a pure function ─────────────────────────────

test("AC-dict: the two /live page tokens translate under zh and are the identity under en", () => {
  assert.equal(pageNameFor(TITLE_TOKEN, "en"), TITLE_TOKEN, "en is the identity for the <title> token");
  assert.equal(pageNameFor(H1_TOKEN, "en"), H1_TOKEN, "en is the identity for the <h1> token");
  assert.equal(pageNameFor(TITLE_TOKEN, "zh"), TITLE_TOKEN_ZH,
    `the zh <title> token is ${JSON.stringify(TITLE_TOKEN_ZH)}`);
  assert.equal(pageNameFor(H1_TOKEN, "zh"), H1_TOKEN_ZH,
    `the zh <h1> token is ${JSON.stringify(H1_TOKEN_ZH)}`);

  // (a) the criterion's own literal, asserted absent from BOTH zh values directly. A zh value of
  //     e.g. "Live 实时" would satisfy "non-empty" while leaving the nav-literal arm red.
  for (const zhValue of [pageNameFor(TITLE_TOKEN, "zh"), pageNameFor(H1_TOKEN, "zh")]) {
    assert.ok(!zhValue.includes("Live"),
      `a zh /live token must not carry the ASCII literal "Live" (got ${JSON.stringify(zhValue)})`);
  }
  // (b) control — that same predicate DOES fire on the en values, so (a) is not vacuous.
  assert.ok(pageNameFor(TITLE_TOKEN, "en").includes("Live"),
    "control: the \"no ASCII Live\" predicate fires on the en <title> token it must reject");
  assert.ok(pageNameFor(H1_TOKEN, "en").includes("Live"),
    "control: the \"no ASCII Live\" predicate fires on the en <h1> token it must reject");
  // (c) control — the function is not constant across languages for either token.
  assert.notEqual(pageNameFor(TITLE_TOKEN, "zh"), pageNameFor(TITLE_TOKEN, "en"),
    "control: pageNameFor is not constant across languages for the <title> token");
  assert.notEqual(pageNameFor(H1_TOKEN, "zh"), pageNameFor(H1_TOKEN, "en"),
    "control: pageNameFor is not constant across languages for the <h1> token");
});

// ── AC-en-baseline: the default rendering is byte-stable by construction ──────────────────────

test("AC-en-baseline: the en rendering is the pre-AC-291 page verbatim, and `lang` absent ≡ lang: \"en\"", () => {
  const live = {
    status: "ok", reason: null, inFlight: [], concurrencyCap: 4, cpuPressure: null,
    liveState: "running", liveExplanation: null, activity: null,
  };
  const implicit = renderLivePage(live, null);
  const explicit = renderLivePage(live, null, "en");
  assert.equal(implicit, explicit,
    "omitting `lang` renders byte-identically to an explicit `lang: \"en\"` (the default did not move)");

  // The pre-AC-291 literals, pinned. Each one is something the change COULD have moved.
  assert.ok(implicit.includes('<html lang="en">'), "the en page is <html lang=\"en\">");
  assert.ok(implicit.includes(`<title>未接入项目身份 — ${TITLE_TOKEN}</title>`),
    "the en <title> is still the bare page token with no project identity resolved");
  assert.ok(implicit.includes(`<h1>${H1_TOKEN} — 循环此刻在做什么</h1>`),
    "the en <h1> is still the pre-AC-291 literal, byte for byte");
  assert.ok(currentItem(implicit, "nav-") === H1_TOKEN,
    `the en desktop current nav item is still "Live" (got ${JSON.stringify(currentItem(implicit, "nav-"))})`);
  assert.ok(currentItem(implicit, "mobile-menu-") === H1_TOKEN,
    "the en mobile current nav item is still \"Live\"");
  assert.ok(implicit.includes('<span class="mobile-header-page">live</span>'),
    "the en mobile header page label is still the lowercase \"live\" (not re-worded by this task)");
});

// ── AC-black-box: a real server, read through raw HTTP ────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "ac291-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac291-ws-"));
  const fm = (id, title, status) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n`;
  fs.writeFileSync(path.join(tasksDir, "AC291-001.md"),
    fm("AC291-001", "Live 数据面的任务标题不是本判据的对象", "ready"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac291 fixture workspace\n");
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

test("AC-black-box: /live under Cookie lang=zh switches html lang, both nav current items, and its OWN <title>", async () => {
  const en = await request(port, "/live");
  const zh = await request(port, "/live", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /live (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /live (zh) returns 200 (got ${zh.status})`);

  // (0) the mechanism itself, restated so a regression in AC-288 reds THIS file too.
  assert.ok(en.body.includes('<html lang="en">'), "the en response is <html lang=\"en\">");
  assert.ok(zh.body.includes('<html lang="zh"'), "the zh response is <html lang=\"zh\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // (1a) the en baseline still carries the literal — otherwise "absent under zh" would be vacuous.
  assert.ok(navEn.includes(H1_TOKEN),
    "the en nav region carries the literal \"Live\" (the baseline the criterion asserts on)");

  // (1b) THE NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3).
  const desktopEn = currentItem(navEn, "nav-");
  const desktopZh = currentItem(navZh, "nav-");
  const mobileEn = currentItem(navEn, "mobile-menu-");
  const mobileZh = currentItem(navZh, "mobile-menu-");
  console.log(`  [ac291] en desktop/mobile current nav item = ${JSON.stringify(desktopEn)} / ${JSON.stringify(mobileEn)}`);
  console.log(`  [ac291] zh desktop/mobile current nav item = ${JSON.stringify(desktopZh)} / ${JSON.stringify(mobileZh)}`);
  assert.equal(desktopEn, H1_TOKEN, "the en desktop current item is the baseline \"Live\"");
  assert.equal(mobileEn, H1_TOKEN, "the en mobile current item is the baseline \"Live\"");
  assert.equal(desktopZh, H1_TOKEN_ZH, `the desktop current item is ${JSON.stringify(H1_TOKEN_ZH)} under zh`);
  assert.equal(mobileZh, H1_TOKEN_ZH, `the mobile current item is ${JSON.stringify(H1_TOKEN_ZH)} under zh`);
  assert.notEqual(desktopZh, H1_TOKEN, "the zh desktop current item is not the English literal");
  assert.notEqual(mobileZh, H1_TOKEN, "the zh mobile current item is not the English literal");

  // (1c) the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes(H1_TOKEN), "the zh nav region carries no literal \"Live\"");

  // (2) THIS PAGE'S OWN <title> — the arm the criterion's `title-unchanged` CAUSE exists for.
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac291] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac291] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.endsWith(` — ${TITLE_TOKEN}`), `the en <title> ends with " — ${TITLE_TOKEN}" (got ${JSON.stringify(tEn)})`);
  assert.ok(tZh.endsWith(` — ${TITLE_TOKEN_ZH}`), `the zh <title> ends with " — ${TITLE_TOKEN_ZH}" (got ${JSON.stringify(tZh)})`);
  assert.notEqual(tZh, tEn, "this page's OWN <title> is not byte-identical across the two languages");

  // (3) THIS PAGE'S OWN <h1> (GOAL-024's "本页 chrome", though the criterion does not read it).
  assert.equal(h1Of(en.body), `${H1_TOKEN} — 循环此刻在做什么`, "the en <h1> is the baseline");
  assert.equal(h1Of(zh.body), `${H1_TOKEN_ZH} — 循环此刻在做什么`, "the zh <h1> is translated");
});

test("AC-black-box: /journal is untouched by this task (its <title> is the same in both languages)", async () => {
  // ⛔ /live and /journal share serve-live.ts. Wiring the wrong one of the two would still pass
  // every assertion above, so the scope boundary is asserted rather than assumed: /journal belongs
  // to AC-296 and must render its English token under zh for now — a VISIBLE degradation (ROW 3),
  // never a blank title.
  const en = await request(port, "/journal");
  const zh = await request(port, "/journal", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, "GET /journal (en) returns 200");
  assert.equal(zh.status, 200, "GET /journal (zh) returns 200");
  assert.equal(headTitle(zh.body), headTitle(en.body),
    "/journal's own <title> is unchanged by this task (it is AC-296's page, not AC-291's)");
  assert.ok(headTitle(en.body).endsWith(" — Journal — recent loop record"),
    "the /journal <title> still carries its English page token");
});
