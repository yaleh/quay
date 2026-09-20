// @test-group product
// gap-ac146-human-interface-explicit-owner — /needs-human is the explicit human owner interface for
// needs-human tasks: it joins 当前待办 (store status) + 升级台账 (.quay/promotion-outcome.jsonl
// `action:"needs-human"`), so a human can see a needs-human without reading any transcript.
//
// AC1 (能取假, 显式承接者): a needs-human task (status + `## Needs-Human` 阻碍原因) renders on
//   /needs-human with its reason.
// AC2 (能取假, 负控制): a needs-human event whose store status has since MOVED ON (the exact
//   situation of the 3 real samples in `.quay/promotion-outcome.jsonl` — re-dispatched to
//   done/superseded) is still visible, because the page reads the LEDGER, not just the status.
//   Negative control: if the page dropped the ledger read, that sample would vanish.
//
// Run (scoped): node --test packages/quay/test/serve-needs-human.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { parsePromotionOutcomeRecords, readNeedsHumanLedger } from "../src/observation.ts";
import { extractNeedsHumanReason } from "../src/serve-needs-human.ts";
import { pageNameFor } from "../src/serve-i18n.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// gap-ac244-freshness-subject-set-mechanically-derived (2026-09-11): this file used to pick a
// port with a `net.createServer().listen(0, "127.0.0.1")` probe and then hand it to
// `startServer({ port })`, which binds **0.0.0.0**. The probe only proves the port is free on
// loopback, so a port already held on another interface (measured here: tailscaled holds a
// high port on the Tailscale interface) passes the probe and then fails the bind with
// EADDRINUSE. `port: 0` + reading the bound port back is the construction that cannot collide
// — the convention established by gap-serve-pid-derived-port-collision-family, which
// converted the 12 pid-derived-port sites to it.

// AC-295: `headers` is optional and unused by the AC-146 tests above, so the default request they
// issue is byte-identical to the one they issued before — the zh tests below are the only callers
// that pass it.
function get(port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "needs-human fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}

function seed(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

/** The `## Needs-Human` body the promotion-driver.markNeedsHuman writes — carries the 阻碍原因 line. */
function needsHumanBody(reason) {
  return (
    `## Proposal\nA sufficiently long proposal section for the needs-human fixture.\n` +
    `## Plan\nA sufficiently long plan section for the needs-human fixture.\n` +
    `## Acceptance Criteria\n- [ ] a sufficiently long acceptance criterion line\n` +
    `## Definition of Done\n- [x] a sufficiently long definition-of-done line\n` +
    `## Needs-Human\n\n**执行 2026-08-23T09:09:46.037Z — promotion-driver AC133：连续修满上限仍不合格**\n\n- 阻碍原因：${reason}\n`
  );
}

test("extractNeedsHumanReason: reads the 阻碍原因 line, null when absent", () => {
  assert.equal(
    extractNeedsHumanReason(needsHumanBody("连续修满 3 次仍不合格（闸在重验证后仍判不合格）")),
    "连续修满 3 次仍不合格（闸在重验证后仍判不合格）",
    "extracts the reason from the 阻碍原因 line",
  );
  assert.equal(extractNeedsHumanReason("## Proposal\nno reason here\n"), null, "no reason line ⇒ null");
  assert.equal(extractNeedsHumanReason(undefined), null, "undefined body ⇒ null");
});

test("parsePromotionOutcomeRecords / readNeedsHumanLedger: action:needs-human ledger, newest first, malformed skipped", () => {
  const text = [
    JSON.stringify({ task_id: "A", action: "promote", result: { ok: true, detail: "todo->ready" }, ts: "2026-08-23T00:00:00.000Z" }),
    JSON.stringify({ task_id: "B", action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T04:14:47.064Z" }),
    "not-json\n",
    JSON.stringify({ task_id: "C", action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T09:09:46.037Z" }),
  ].join("\n");
  const all = parsePromotionOutcomeRecords(text);
  assert.equal(all.length, 3, "malformed line is skipped (3 of 4 parsed)");
  const nh = all.filter((r) => r.action === "needs-human");
  assert.deepEqual(nh.map((r) => r.task_id), ["B", "C"], "both needs-human records parsed");
  assert.equal(nh[0].detail, "retry-cap-exhausted", "result.detail is surfaced");

  // readNeedsHumanLedger reads from disk and sorts newest first.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nh-ledger-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "promotion-outcome.jsonl"), text);
  const ledger = readNeedsHumanLedger(ws);
  assert.deepEqual(ledger.map((r) => r.task_id), ["C", "B"], "ledger is newest-first (C then B)");
  fs.rmSync(ws, { recursive: true, force: true });

  // Absent ledger ⇒ [] (a real "none", not a throw).
  const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), "nh-empty-"));
  fs.mkdirSync(path.join(emptyWs, ".quay"), { recursive: true });
  assert.deepEqual(readNeedsHumanLedger(emptyWs), [], "absent ledger ⇒ []");
  fs.rmSync(emptyWs, { recursive: true, force: true });
});

test("AC1 + AC2: /needs-human renders 当前待办 (status+reason) AND 升级台账 (status-moved-on sample)", async () => {
  const { ws, tasksDir } = makeWorkspace("nh-page-");
  const cwd0 = process.cwd();
  let server;
  try {
    // AC1 — an ACTIVE needs-human task: store status needs-human + a ## Needs-Human reason.
    seed(tasksDir, "NH-ACTIVE", { title: "Active needs-human", status: "needs-human", body: needsHumanBody("连续修满 3 次仍不合格（闸在重验证后仍判不合格）") });
    // AC2 negative-control sample — a needs-human event whose store status has SINCE MOVED ON to
    // done (the real 3-sample situation). It must STILL be visible, via the ledger.
    seed(tasksDir, "NH-MOVED-ON", { title: "Re-dispatched", status: "done", body: needsHumanBody("was needs-human, now done") });
    fs.writeFileSync(
      path.join(ws, ".quay", "promotion-outcome.jsonl"),
      [
        JSON.stringify({ task_id: "NH-MOVED-ON", gate: { eligible: false, missing: [] }, action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T04:14:47.064Z" }),
        JSON.stringify({ task_id: "NH-ACTIVE", gate: { eligible: false, missing: [] }, action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T09:09:46.037Z" }),
      ].join("\n") + "\n",
    );

    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;
    // ⚠️ gap-webui-needs-human-body-copy-en-zh: the DEFAULT language is `en`, so a bare GET now
    // renders English section headings. These assertions pin the CHINESE literals on purpose (they
    // are the zh zero-change regression guard, decision record ④), so the request is EXPLICIT.
    const page = await get(port, "/needs-human", { Cookie: "lang=zh" });
    const pageEn = await get(port, "/needs-human");
    assert.equal(page.status, 200, "GET /needs-human returns 200");

    // AC1 — the active task and its reason are visible (no transcript read).
    assert.ok(page.body.includes("NH-ACTIVE"), "AC1: the active needs-human task id is rendered");
    assert.ok(page.body.includes("连续修满 3 次仍不合格"), "AC1: the 阻碍原因 reason is rendered");
    assert.ok(page.body.includes("当前待办") && page.body.includes("升级台账"),
      "AC1: the page renders both 当前待办 and 升级台账 sections");

    // The en side of the same two facts — the lang plumbing must not have disturbed the DATA.
    assert.equal(pageEn.status, 200, "GET /needs-human (en) returns 200");
    assert.ok(pageEn.body.includes("NH-ACTIVE") && pageEn.body.includes("连续修满 3 次仍不合格"),
      "AC1 (en): the active task and its reason render identically under the default language");
    assert.ok(pageEn.body.includes("Currently awaiting") && pageEn.body.includes("Escalation ledger"),
      "AC1 (en): the two section headings render in English under the default language");

    // AC2 — the status-moved-on sample is STILL visible via the ledger (the negative control: drop
    // the ledger read and this row vanishes even though the event really happened).
    assert.ok(page.body.includes("NH-MOVED-ON"), "AC2: the status-moved-on needs-human event is still visible via the ledger");
    assert.ok(page.body.includes("retry-cap-exhausted"), "AC2: the ledger detail (retry-cap-exhausted) is rendered");

    // The active task's id appears in BOTH sections is fine; the moved-on task appears ONLY in the
    // ledger (its store status is done, so the 当前待办 table must not contain it as an active row).
    // Split the body at the ledger HEADING (not the word 升级台账, which also appears in the meta
    // line above) to assert the active table does NOT render NH-MOVED-ON.
    const [activePart] = page.body.split("<h2>升级台账");
    assert.ok(activePart.includes("NH-ACTIVE"), "AC1/AC2: active section contains NH-ACTIVE");
    assert.ok(!activePart.includes("NH-MOVED-ON"), "AC2: the active section does NOT contain the done NH-MOVED-ON (ledger-only)");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("degradation: no needs-human tasks and no ledger still renders 200 (never a 500)", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nh-degrade-"));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  const cwd0 = process.cwd();
  let server;
  try {
    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;
    // ⚠️ EXPLICIT zh (decision record ④): the empty-state notes are exactly the copy this task moved
    // behind the dictionary, so a bare GET (default en) would assert them in the wrong language.
    const page = await get(port, "/needs-human", { Cookie: "lang=zh" });
    const pageEn = await get(port, "/needs-human");
    assert.equal(page.status, 200, "empty workspace still returns 200");
    assert.ok(page.body.includes("当前无 needs-human 任务"), "empty active table renders the none note");
    assert.ok(page.body.includes("无 needs-human 升级记录"), "empty ledger renders the none note");

    // The en counterparts — the empty states are localized too, not left Chinese under en.
    assert.equal(pageEn.status, 200, "empty workspace still returns 200 under en");
    assert.ok(pageEn.body.includes("No needs-human tasks currently"), "en: the empty active note is English");
    assert.ok(pageEn.body.includes("No needs-human escalations recorded"), "en: the empty ledger note is English");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AC-295 (GOAL-024) — /needs-human's OWN zh chrome.
//
// AC-288 built the language MECHANISM (which language is this request?) and AC-289 built the label
// DICTIONARY plus the four shared render functions. `handleNeedsHuman` already RECEIVED `cfg.lang`
// from the dispatcher (serve-handlers.ts passes AC-288's `reqCfg`) and dropped it — it called
// `renderNeedsHumanPage(active, ledger, manifest, cfg.identity)` and the page hard-coded
// `<html lang="en">`, rendering its `<title>`/`<h1>`/nav from the English columns.
//
// Why the assertions are SPLIT the way they are: the goal criterion fails this page on two
// INDEPENDENT chrome arms — the nav region still carrying the English nav label
// (`CAUSE=nav-label-untranslated`) and this page's OWN `<title>` being byte-identical across the two
// languages (`CAUSE=title-unchanged`). The two arms resolve through two DIFFERENT dictionaries:
//   · the nav current item      → NAV_LABELS["needs-human"] (shared chrome, ROW 1) — already present
//   · this page's <title>/<h1>  → PAGE_LABELS["Needs Human"] (this page's chrome, ROW 3) — added here
// and /needs-human is the case where the SAME literal string is the input to BOTH. Wiring one and
// not the other is therefore a real, reachable half-fix, and each half reds a different CAUSE. The
// separation below is what keeps those two arms from being collapsed into one "the page looks
// translated" boolean (hard rule 3: enumerate, do not report a boolean).
//
// The `<h1>` and the `<title>` share ONE token here (`Needs Human`) — the AC-294 /manager shape —
// because this page passes the same string to both call sites; AC-291's / AC-292's / AC-293's /
// AC-296's pages each had a separate short token, this one does not.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** The page-chrome token, pinned as the literal the call site passes. ⛔ Not imported from
 *  serve-i18n.ts: deriving the expectation from the thing under test would make the assertion a
 *  tautology. Note it is the FULL string WITH ITS INTERNAL SPACE — registering the bare `Needs`, or
 *  the nav key `needs-human`, MISSES the lookup and leaves the title English, which IS the
 *  criterion's `title-unchanged` arm. */
const NH_TOKEN = "Needs Human";
const NH_TOKEN_ZH = "待人工";

/** The `<h1>`'s SUFFIX, pinned as the literal the dictionary renders under en
 *  (gap-webui-needs-human-body-copy-en-zh). ⛔ Not imported from serve-i18n.ts — same anti-tautology
 *  rule as `NH_TOKEN`: a page that rendered the dictionary's own value would satisfy an assertion
 *  that read the dictionary back. */
const NH_SUFFIX_EN = "Awaiting human decision";

/** The nav current item's zh label — NAV_LABELS's `needs-human` row (shared chrome, ROW 1). Pinned
 *  separately from NH_TOKEN_ZH even though both are 待人工 today: they are two independent lookups
 *  (see the AC-dict test), and a re-wording of one must not silently move the other's expectation. */
const NH_NAV_CURRENT_ZH = "待人工";

/** The nav region, extracted EXACTLY as the AC-295 goal criterion extracts it (flatten newlines,
 *  then greedy `/<nav.*<\/nav>/`) so this file and the criterion cannot drift on what "the nav
 *  region" means. The greediness matters: it spans the mobile menu's `<nav>` through the desktop
 *  bar's `</nav>`, so BOTH current-item renderings sit inside the region under assertion. */
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

test("AC-295 AC-dict: the /needs-human page token translates under zh and is the identity under en", () => {
  // (0) THE TRAP, asserted first: the PAGE_LABELS key must be byte-equal to the token the call site
  //     passes. Keyed by the bare "Needs", or by the nav key "needs-human", pageNameFor() returns
  //     the English string here — the `title-unchanged` arm — so this is the assertion that fails
  //     when the entry is mis-keyed, before any HTTP is involved.
  assert.equal(pageNameFor(NH_TOKEN, "en"), NH_TOKEN, "en is the identity for the page token");
  assert.equal(pageNameFor(NH_TOKEN, "zh"), NH_TOKEN_ZH,
    `the zh page token is ${JSON.stringify(NH_TOKEN_ZH)} (a bare "Needs" / "needs-human" key misses this lookup)`);

  // (a) the criterion's own literal, asserted absent from the zh value directly. A zh value of e.g.
  //     "Needs Human 待人工" would satisfy "non-empty" while leaving the criterion's nav-literal arm
  //     red — the gate-gameability shape the dictionary's own WHY note calls out.
  assert.ok(!pageNameFor(NH_TOKEN, "zh").includes(NH_TOKEN),
    `the zh page token must not carry the ASCII literal ${JSON.stringify(NH_TOKEN)}`);
  // (b) control — that same predicate DOES fire on the en value, so (a) is not vacuous.
  assert.ok(pageNameFor(NH_TOKEN, "en").includes(NH_TOKEN),
    "control: the \"no ASCII literal\" predicate fires on the en token it must reject");
  // (c) control — the function is not constant across languages for this token.
  assert.notEqual(pageNameFor(NH_TOKEN, "zh"), pageNameFor(NH_TOKEN, "en"),
    "control: pageNameFor is not constant across languages for the page token");
  // (d) control — NEAR-MISS tokens are NOT mapped: the lookup is byte-exact, not fuzzy. Each of
  //     these is a plausible mis-key, and each would leave the title English.
  for (const nearMiss of ["Needs", "needs-human", "Needs  Human", "needs human", "Needs humans"]) {
    assert.equal(pageNameFor(nearMiss, "zh"), nearMiss,
      `control: the near-miss token ${JSON.stringify(nearMiss)} is NOT mapped — the lookup is byte-exact`);
  }
});

test("AC-295 AC-black-box: /needs-human under Cookie lang=zh switches html lang, both nav current items, and its OWN <title>", async () => {
  const { ws, tasksDir } = makeWorkspace("nh-zh-");
  const cwd0 = process.cwd();
  let server;
  try {
    // A real DATA hit carrying the literal, seeded DELIBERATELY: this page's <main> renders task
    // titles, and a title containing the literal is the exact false-failure shape the criterion's
    // own origin note records for /dashboard ("the activity stream renders task TITLES containing
    // Dashboard/Tasks"). The criterion matches only `<title>` and `<nav>…</nav>`, so this title must
    // NOT red it — and the assertions below pin that scoping claim rather than assuming it.
    seed(tasksDir, "NH-ZH-DATA", {
      title: `${NH_TOKEN} 数据面的任务标题不是本判据的对象`,
      status: "needs-human",
      body: needsHumanBody("数据面命中，用于证明本判据只对 chrome 作用域断言"),
    });

    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const en = await get(port, "/needs-human");
    const zh = await get(port, "/needs-human", { Cookie: "lang=zh" });
    assert.equal(en.status, 200, `GET /needs-human (en) returns 200 (got ${en.status})`);
    assert.equal(zh.status, 200, `GET /needs-human (zh) returns 200 (got ${zh.status})`);

    // (0) the mechanism itself, restated so a regression in AC-288 reds THIS file too.
    assert.ok(en.body.includes('<html lang="en">'), 'the en response is <html lang="en">');
    assert.ok(zh.body.includes('<html lang="zh"'), 'the zh response is <html lang="zh">');

    const navEn = navRegion(en.body);
    const navZh = navRegion(zh.body);
    assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
    assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

    // (1a) the en baseline still carries the literal — otherwise "absent under zh" would be vacuous.
    assert.ok(navEn.includes(NH_TOKEN),
      `the en nav region carries the literal ${JSON.stringify(NH_TOKEN)} (the baseline the criterion asserts on)`);

    // (1b) THE NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3).
    const desktopEn = currentItem(navEn, "nav-");
    const desktopZh = currentItem(navZh, "nav-");
    const mobileEn = currentItem(navEn, "mobile-menu-");
    const mobileZh = currentItem(navZh, "mobile-menu-");
    console.log(`  [ac295] en desktop/mobile current nav item = ${JSON.stringify(desktopEn)} / ${JSON.stringify(mobileEn)}`);
    console.log(`  [ac295] zh desktop/mobile current nav item = ${JSON.stringify(desktopZh)} / ${JSON.stringify(mobileZh)}`);
    assert.equal(desktopEn, NH_TOKEN, `the en desktop current item is the baseline ${JSON.stringify(NH_TOKEN)}`);
    assert.equal(mobileEn, NH_TOKEN, `the en mobile current item is the baseline ${JSON.stringify(NH_TOKEN)}`);
    assert.equal(desktopZh, NH_NAV_CURRENT_ZH, `the desktop current item is ${JSON.stringify(NH_NAV_CURRENT_ZH)} under zh`);
    assert.equal(mobileZh, NH_NAV_CURRENT_ZH, `the mobile current item is ${JSON.stringify(NH_NAV_CURRENT_ZH)} under zh`);
    assert.notEqual(desktopZh, NH_TOKEN, "the zh desktop current item is not the English literal");
    assert.notEqual(mobileZh, NH_TOKEN, "the zh mobile current item is not the English literal");

    // (1c) the whole nav region is free of the English label under zh — the criterion's own assertion.
    assert.ok(!navZh.includes(NH_TOKEN), `the zh nav region carries no literal ${JSON.stringify(NH_TOKEN)}`);

    // (1d) THE SCOPING CLAIM, pinned rather than assumed: this page's DATA area DOES carry the
    //      literal (the seeded task title) in the SAME zh response, while the nav region does not.
    //      Without this pair, (1c) could be satisfied by a page that had simply stopped rendering
    //      its data — and the criterion's nav-only scoping would then be untested.
    assert.ok(zh.body.includes(NH_TOKEN),
      "control: the zh response DOES carry the literal OUTSIDE the nav region (the seeded task title) — so (1c) is a scoping claim, not a page-wide one");
    assert.ok(en.body.includes(NH_TOKEN),
      "control: the en response carries that same data hit, so (1d) is not an artifact of the zh request");

    // (2) THIS PAGE'S OWN <title> — the arm the criterion's `title-unchanged` CAUSE exists for.
    const tEn = headTitle(en.body);
    const tZh = headTitle(zh.body);
    console.log(`  [ac295] en <title> = ${JSON.stringify(tEn)}`);
    console.log(`  [ac295] zh <title> = ${JSON.stringify(tZh)}`);
    assert.ok(tEn.endsWith(` — ${NH_TOKEN}`), `the en <title> ends with " — ${NH_TOKEN}" (got ${JSON.stringify(tEn)})`);
    assert.ok(tZh.endsWith(` — ${NH_TOKEN_ZH}`), `the zh <title> ends with " — ${NH_TOKEN_ZH}" (got ${JSON.stringify(tZh)})`);
    assert.notEqual(tZh, tEn, "this page's OWN <title> is not byte-identical across the two languages");

    // (3) THIS PAGE'S OWN <h1> (GOAL-024's "本页 chrome", though the criterion does not read it).
    //     ⚠️ gap-webui-needs-human-body-copy-en-zh moved the SUFFIX behind the dictionary, so the en
    //     expectation is now the NEW English text rather than the pre-existing Chinese. The literal
    //     is PINNED here (⛔ not imported from serve-i18n.ts) for the same anti-tautology reason the
    //     token above is: deriving the expectation from the thing under test asserts nothing.
    assert.equal(h1Of(en.body), `${NH_TOKEN} — ${NH_SUFFIX_EN}`, "the en <h1> carries the English suffix");
    assert.equal(h1Of(zh.body), `${NH_TOKEN_ZH} — 待人类决定`, "the zh <h1> is unchanged");
    assert.notEqual(h1Of(zh.body), h1Of(en.body), "the <h1> suffix is not byte-identical across languages");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC-295 AC-en-baseline + gap-webui-needs-human-body-copy-en-zh: the en SHARED chrome is the pre-AC-295 page verbatim, and the en BODY copy is the new English", async () => {
  const { ws, tasksDir } = makeWorkspace("nh-zh-en-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "NH-EN-BASE", { title: "en baseline fixture", status: "needs-human", body: needsHumanBody("en 基线夹具") });

    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const en = await get(port, "/needs-human");
    assert.equal(en.status, 200, "GET /needs-human (en) returns 200");
    const body = en.body.replace(/\n/g, " ");

    // The pre-AC-295 literals, pinned. Each one is something this change COULD have moved — in
    // particular the two substitutions that replaced a hard-coded literal with a lang-driven call.
    assert.ok(body.includes('<html lang="en"><head>'),
      'the en page still opens <html lang="en"><head> — htmlLangTag(DEFAULT_LANG) must be byte-identical to the literal it replaced');
    assert.ok(headTitle(body).endsWith(` — ${NH_TOKEN}`), "the en <title> token is unchanged");
    assert.equal(currentItem(navRegion(body), "nav-"), NH_TOKEN, "the en desktop nav current item is unchanged");
    assert.equal(currentItem(navRegion(body), "mobile-menu-"), NH_TOKEN, "the en mobile nav current item is unchanged");
    assert.ok(!body.includes(NH_TOKEN_ZH), "the en page carries no zh label anywhere");

    // ── the BODY copy (gap-webui-needs-human-body-copy-en-zh) ────────────────────────────────────
    // The <h1> SUFFIX is the one pre-existing literal this task intentionally MOVED (it used to be
    // 待人类决定 under en); the section headings and the reason header follow it. Each expectation is
    // pinned literally (⛔ not read back from the dictionary) — see NH_SUFFIX_EN's note.
    assert.equal(h1Of(body), `${NH_TOKEN} — ${NH_SUFFIX_EN}`, "the en <h1> suffix is the new English copy");
    assert.ok(body.includes("Currently awaiting") && body.includes("Escalation ledger"),
      "the en page still renders both data sections, now under their English headings");
    assert.ok(body.includes("<th>Blocking reason</th>"), "the reason column's header is English under en");
    // The zh label is absent from the en page — including the reason column's absent-value word,
    // which only renders for a task carrying no 阻碍原因 line (this fixture HAS one, so the word's
    // en/zh pair is asserted by the sibling body-i18n file instead).
    assert.ok(!body.includes("待人类决定") && !body.includes("当前待办") && !body.includes("升级台账"),
      "no pre-extraction zh interface literal survives anywhere on the en page");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── gap-needs-human-raw-fan-in-reason-observation-surface ─────────────────────────────────────────
// 人 2026-09-20：「driver 当然应当记录相应的日志，人类观测面（如 quay cli/mcp/web）也应提供这些日志的
// 访问。」 The 阻碍原因 column said WHAT the driver pasted into the body; nothing on any surface said
// WHICH STEP each attempt died on or what the failure text actually was. This page now shows it, RAW
// (⛔ no classification — the same ruling: an exception's cause does not enumerate reliably), and it
// reads through observation.readFanInAttempts, the ONE reader the CLI and MCP tools also use.
test("AC3: /needs-human renders a needs-human task's latest RAW fan-in failure, HTML-escaped", async () => {
  const { ws, tasksDir } = makeWorkspace("nh-fanin-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "NH-FANIN", {
      title: "needs-human with a failed attempt",
      status: "needs-human",
      body: needsHumanBody("连续修满 3 次仍不合格"),
    });
    // The reason carries an HTML payload ON PURPOSE — the negative control for the escaping arm.
    const reason = "AssertionError [ERR_ASSERTION]: <script>alert(1)</script> stdout differs between symlink and real invocation";
    fs.writeFileSync(
      path.join(ws, ".quay", "worker-outcome.jsonl"),
      [
        JSON.stringify({
          ts: "2026-09-20T04:00:00.000Z", task: "NH-FANIN", run_id: "r-landed",
          started_at: "2026-09-20T03:50:00.000Z", final_state: "completed",
          mechanical_fan_in: { outcome: "landed", step: null, reason: null },
        }),
        JSON.stringify({
          ts: "2026-09-20T05:25:06.591Z", task: "NH-FANIN", run_id: "r-red",
          started_at: "2026-09-20T04:36:41.511Z", final_state: "exited-not-landed",
          mechanical_fan_in: { outcome: "red", step: "suite", reason, suiteLog: "fan-in-suite-NH-FANIN.log" },
        }),
      ].join("\n") + "\n",
    );

    process.chdir(ws);
    server = await startServer({ port: 0 });
    const page = await get(server.address().port, "/needs-human");
    assert.equal(page.status, 200, "GET /needs-human returns 200");

    // AC3 — the latest attempt's failing step and its RAW reason are on the page.
    assert.ok(page.body.includes("Latest failure (raw)"), "the new column header renders (en default)");
    assert.ok(page.body.includes("<code>suite</code>"), "the failing step name renders (verbatim from the record)");
    assert.ok(page.body.includes("stdout differs between symlink and real invocation"), "the raw failure text renders");
    assert.ok(page.body.includes("AssertionError [ERR_ASSERTION]:"), "the reason is NOT truncated before the UI");

    // Negative control: the payload is ESCAPED TEXT, never markup.
    assert.ok(!page.body.includes("<script>alert(1)</script>"), "an HTML payload in the reason is NOT emitted as markup");
    assert.ok(page.body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "it is emitted as escaped text");

    // The page reads through the ONE reader: a reason that never reaches the carrier never reaches
    // the page either (the landed attempt's null reason must not be back-filled from the body prose).
    assert.ok(!page.body.includes('alert("not-on-the-carrier")'), "nothing is invented from the 阻碍原因 prose");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ⚠️ WHY THE LEDGER ROW CARRIES THE SAME COLUMN (and why it is asserted separately): the task the
// column exists for is the one whose status has ALREADY moved on — escalated by the driver, then
// taken forward by a human or a re-dispatch. The active table no longer lists it, so a failure column
// only on the active rows would be structurally blind to exactly the case the problem statement names
// (「3 个任务因同一原因被打成 needs-human」). This is the REAL-STORE shape: today's store has 0 active
// needs-human tasks and 23 real ledger samples.
test("AC3 (ledger): an ALREADY-ESCALATED task's raw failure text is visible on /needs-human", async () => {
  const { ws, tasksDir } = makeWorkspace("nh-fanin-ledger-");
  const cwd0 = process.cwd();
  let server;
  try {
    // The task's store status has moved on to done — it is in the ledger only.
    seed(tasksDir, "NH-LEDGER", { title: "escalated then re-dispatched", status: "done", body: needsHumanBody("was needs-human, now done") });
    fs.writeFileSync(
      path.join(ws, ".quay", "promotion-outcome.jsonl"),
      JSON.stringify({ task_id: "NH-LEDGER", action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-09-01T06:18:06.497Z" }) + "\n",
    );
    const ledgerReason = "fan-in-ac-completion-gate: AC 未全勾（checked 0/3，剩余未勾 3 含非待外部项）——未翻 done";
    fs.writeFileSync(
      path.join(ws, ".quay", "worker-outcome.jsonl"),
      JSON.stringify({
        ts: "2026-09-01T06:18:06.497Z", task: "NH-LEDGER", run_id: "r-ac-gate",
        final_state: "exited-not-landed",
        mechanical_fan_in: { outcome: "red", step: "ac-gate", reason: ledgerReason },
      }) + "\n",
    );

    process.chdir(ws);
    server = await startServer({ port: 0 });
    const page = await get(server.address().port, "/needs-human");
    assert.equal(page.status, 200, "GET /needs-human returns 200");
    const ledgerPart = page.body.split("Escalation ledger")[1] ?? "";
    assert.ok(ledgerPart.includes("NH-LEDGER"), "the escalated task is in the ledger section");
    assert.ok(ledgerPart.includes("<code>ac-gate</code>"), "the ledger row carries the failing step");
    assert.ok(ledgerPart.includes("AC 未全勾（checked 0/3"), "the ledger row carries the RAW failure text");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3 (3b): an UNREADABLE attempt carrier renders 读不出, never the empty-looking word", async () => {
  const { ws, tasksDir } = makeWorkspace("nh-fanin-unreadable-");
  const cwd0 = process.cwd();
  let server;
  try {
    seed(tasksDir, "NH-UNREADABLE", { title: "needs-human, log unreadable", status: "needs-human", body: needsHumanBody("连续修满 3 次仍不合格") });
    // A DIRECTORY at the carrier path: the read fails for a reason that is NOT "it does not exist".
    fs.mkdirSync(path.join(ws, ".quay", "worker-outcome.jsonl"), { recursive: true });

    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const zh = await get(port, "/needs-human", { Cookie: "lang=zh" });
    const en = await get(port, "/needs-human");
    assert.equal(zh.status, 200, "an unreadable carrier still renders 200");
    assert.ok(zh.body.includes("尝试日志读不出"), "zh: the unreadable state has its OWN word");
    assert.ok(!zh.body.includes("无尝试记录"), "zh: 读不出 is NOT rendered as 无记录 (硬规则 3b)");
    assert.ok(en.body.includes("Attempt log unreadable"), "en: the unreadable state has its OWN word");
    assert.ok(!en.body.includes("No attempt recorded"), "en: 读不出 is NOT rendered as 无记录 (硬规则 3b)");

    // Negative control for the same page: with NO carrier at all, the honest word IS 无记录 —
    // so the two states are distinguishable by rendering, not merely by an internal field.
    fs.rmSync(path.join(ws, ".quay", "worker-outcome.jsonl"), { recursive: true, force: true });
    const en2 = await get(port, "/needs-human");
    assert.ok(en2.body.includes("No attempt recorded"), "an ABSENT carrier renders the not-recorded word");
    assert.ok(!en2.body.includes("Attempt log unreadable"), "and NOT the unreadable word");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
