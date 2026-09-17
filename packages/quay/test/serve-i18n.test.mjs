// @test-group product
// gap-ac289-dashboard-zh-nav-label-and-own-title — the label dictionary + /dashboard's own chrome
// (AC-289 / GOAL-024).
//
// AC-288 built the language MECHANISM (which language is this request?); it answered with the
// `<html lang>` attribute and nothing else. This task is the half that makes the answer visible:
// the 15 shared nav labels and this page's OWN `<title>`/`<h1>` now resolve through a dictionary.
//
// The judge is split the same way the mechanism is, and BOTH halves are asserted in both
// directions (hard rule 4: a reading that cannot take a false value is not a measurement):
//
//   AC-dict — the dictionary as a PURE function, imported directly. The `en` column is pinned to
//             the pre-AC-289 roster VERBATIM (a later re-wording would silently move the goal
//             criterion's own baseline); the `zh` column is asserted non-empty, distinct from its
//             `en` peer, and free of the ASCII literal "Dashboard" (a "translated" column that
//             still carried the English word would satisfy "non-empty" while defeating the
//             assertion the column exists to satisfy); and an UNKNOWN key must throw — not fall
//             back to English, which is indistinguishable from a view that was never wired.
//
//   AC-black-box — a REAL `startServer` on a real workspace, read through raw HTTP. The nav region
//             is extracted with the SAME method the goal criterion uses (flatten newlines, then
//             `/<nav.*<\/nav>/`) so this test and the criterion cannot drift apart on what "the
//             nav region" means. A fixture task whose TITLE contains the English label is seeded
//             on purpose: it lands in the dashboard's card body, which is the negative control
//             proving the nav-scoped assertion is scoping something (a whole-body substring match
//             would be unsatisfiable here for a reason that has nothing to do with translation).
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
import { NAV_KEYS, NAV_LABELS, navLabel, navLabelsFor, pageNameFor, isNavKey } from "../src/serve-i18n.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The 15 labels the nav rendered BEFORE this task — the baseline the goal criterion reads off the
 *  live page. Pinned as literals on purpose: deriving it from NAV_LABELS would make the assertion
 *  a tautology (硬规则 4 — a structural identity is not a measurement). */
const EN_BASELINE = {
  dashboard: "Dashboard",
  tasks: "Tasks",
  live: "Live",
  board: "Board",
  system: "System",
  manager: "Manager",
  "needs-human": "Needs Human",
  journal: "Journal",
  git: "Git History",
  tests: "Tests",
  sessions: "Sessions",
  adr: "ADRs",
  goal: "Goals",
  doc: "Docs",
  architecture: "Architecture",
};

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

/** The nav region, extracted exactly as the AC-289 goal criterion extracts it. */
function navRegion(body) {
  const m = /<nav.*<\/nav>/.exec(body.replace(/\n/g, " "));
  return m ? m[0] : "";
}

function headTitle(body) {
  const m = /<title>([^<]*)<\/title>/.exec(body.replace(/\n/g, " "));
  return m ? m[1] : "";
}

// ── AC-dict: the dictionary as a pure function ────────────────────────────────────────────────

test("AC-dict: the roster is 15 views and the en column is the pre-AC-289 baseline verbatim", () => {
  assert.equal(NAV_KEYS.length, 15, `the nav roster is 15 views (got ${NAV_KEYS.length})`);
  assert.deepEqual([...NAV_KEYS].sort(), Object.keys(EN_BASELINE).sort(),
    "the roster and the pinned baseline name the same 15 views");
  const en = navLabelsFor("en");
  for (const key of NAV_KEYS) {
    assert.equal(en[key], EN_BASELINE[key],
      `en label for "${key}" is unchanged from the live baseline (got ${JSON.stringify(en[key])})`);
  }
  // Control — the comparison CAN fail: the same predicate over a one-word perturbation is rejected.
  assert.notEqual({ ...en, dashboard: "Dashboards" }, en,
    "control: the baseline comparison rejects a re-worded column");
});

test("AC-dict: every zh label is non-empty, differs from its en peer, and carries no ASCII \"Dashboard\"", () => {
  const en = navLabelsFor("en");
  const zh = navLabelsFor("zh");
  for (const key of NAV_KEYS) {
    assert.ok(typeof zh[key] === "string" && zh[key].trim().length > 0,
      `zh label for "${key}" is non-empty (got ${JSON.stringify(zh[key])})`);
    assert.notEqual(zh[key], en[key],
      `zh label for "${key}" is a real translation, not a copy of the en peer (both ${JSON.stringify(zh[key])})`);
    assert.ok(!zh[key].includes("Dashboard"),
      `zh label for "${key}" does not carry the ASCII literal "Dashboard" (got ${JSON.stringify(zh[key])})`);
  }
  assert.equal(zh.dashboard, "仪表盘", "the zh label for the /dashboard nav item is 仪表盘");
  // Control — the literal predicate is not vacuous: it DOES fire on the English value.
  assert.ok(en.dashboard.includes("Dashboard"),
    "control: the \"no ASCII Dashboard\" predicate fires on the en value it must reject");
});

test("AC-dict: an unknown key THROWS (never a silent English fallback)", () => {
  assert.ok(isNavKey("dashboard") && !isNavKey("dashbord") && !isNavKey("constructor"),
    "isNavKey accepts the 15 views and rejects a typo / an inherited object member");
  assert.throws(() => navLabel("dashbord", "zh"), /unknown nav key/,
    "an unknown nav key throws rather than rendering its English (or undefined) fallback");
  assert.equal(navLabel("dashboard", "zh"), "仪表盘", "a known key resolves normally (positive control)");
});

test("AC-dict: pageNameFor translates the page's own token, `en` is the identity, unmapped stays English", () => {
  assert.equal(pageNameFor("Dashboard", "en"), "Dashboard", "en is the identity for the mapped token");
  assert.equal(pageNameFor("Dashboard", "zh"), "仪表盘", "zh translates the page's own token");
  // AC-290 mapped the /tasks page's two tokens. Asserted here, in the DICTIONARY's own test, so the
  // handoff is checked where the words live and not only at the page that consumes them.
  assert.equal(pageNameFor("Tasks", "en"), "Tasks", "en is the identity for the /tasks <title> token (AC-290)");
  assert.equal(pageNameFor("Tasks", "zh"), "任务", "zh translates the /tasks <title> token (AC-290)");
  assert.equal(pageNameFor("task list", "zh"), "任务列表",
    "zh translates the /tasks <h1> + mobile-header token (AC-290)");
  // The UNMAPPED-token example below used to be `"Tasks"`. A real page token stops being unmapped
  // the moment that page's task lands, so the old line would have turned this assertion into a
  // claim about AC-290's progress rather than about the function's behaviour. The token below is
  // named by no page, so the property (unmapped ⇒ English identity, never blank) stays measurable
  // across the whole AC-291~303 series instead of re-staling at each page.
  assert.equal(pageNameFor("Not A Page", "zh"), "Not A Page",
    "an unmapped page token under zh keeps its English token (AC-291~303 own the other pages) — never blank");
  assert.equal(pageNameFor("Not A Page", "en"), "Not A Page", "unmapped tokens are the identity under en too");
  // Control — the function CAN take a different value; otherwise the identity asserts above are noise.
  assert.notEqual(pageNameFor("Dashboard", "zh"), pageNameFor("Dashboard", "en"),
    "control: pageNameFor is not constant across languages for the mapped token");
});

// ── AC-black-box: a real server, read through raw HTTP ────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "ac289-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac289-ws-"));
  const fm = (id, title, status, extra = "") =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nlabels: []\n${extra}---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n`;
  // The title deliberately carries the English nav label: it is rendered into the dashboard's
  // CARD BODY, i.e. OUTSIDE the nav region. It is the negative control for nav-scoping.
  fs.writeFileSync(path.join(tasksDir, "AC289-001.md"),
    fm("AC289-001", "Dashboard 双列不等高拉伸留白", "ready"));
  fs.writeFileSync(path.join(tasksDir, "AC289-002.md"), fm("AC289-002", "fixture done task", "done"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac289 fixture workspace\n");
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

test("AC-black-box: /dashboard under Cookie lang=zh translates the nav current item, <title> and <h1>", async () => {
  const en = await request(port, "/dashboard");
  const zh = await request(port, "/dashboard", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /dashboard (en) returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /dashboard (zh) returns 200 (got ${zh.status})`);

  // (0) the mechanism itself, restated here so a regression in AC-288 reds THIS file too.
  assert.ok(zh.body.includes('<html lang="zh"'), "zh response is <html lang=\"zh\">");
  assert.ok(en.body.includes('<html lang="en"'), "en response is <html lang=\"en\">");

  const navEn = navRegion(en.body);
  const navZh = navRegion(zh.body);
  assert.ok(navEn.length > 0, "the en response exposes a <nav>…</nav> region to assert on");
  assert.ok(navZh.length > 0, "the zh response exposes a <nav>…</nav> region to assert on");

  // (1a) the en baseline still carries the literal — otherwise "absent under zh" would be vacuous.
  assert.ok(navEn.includes("Dashboard"),
    "en nav region carries the literal \"Dashboard\" (the baseline the criterion asserts on)");

  // (1b) NAV CURRENT ITEM, desktop and mobile, asserted SEPARATELY (hard rule 3: enumerate, don't
  //      report a boolean "the nav looks translated").
  const desktopEn = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const desktopZh = /<span class="nav-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  const mobileEn = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navEn)?.[1];
  const mobileZh = /<span class="mobile-menu-item nav-current"[^>]*>([^<]*)<\/span>/.exec(navZh)?.[1];
  assert.equal(desktopEn, "Dashboard", `desktop current item is the en baseline (got ${JSON.stringify(desktopEn)})`);
  assert.equal(mobileEn, "Dashboard", `mobile current item is the en baseline (got ${JSON.stringify(mobileEn)})`);
  assert.equal(desktopZh, "仪表盘", `desktop current item is translated under zh (got ${JSON.stringify(desktopZh)})`);
  assert.equal(mobileZh, "仪表盘", `mobile current item is translated under zh (got ${JSON.stringify(mobileZh)})`);

  // (1c) the whole nav region is free of the English label under zh — the criterion's own assertion.
  assert.ok(!navZh.includes("Dashboard"),
    "the zh nav region carries no literal \"Dashboard\"");

  // (1d) NEGATIVE CONTROL for the scoping: the same literal IS in the page BODY (the seeded task
  //      title), so "absent from the nav region" is a statement about the nav, not about the seed.
  assert.ok(zh.body.includes("Dashboard 双列不等高拉伸留白"),
    "control: the seeded fixture title (outside the nav region) does carry the literal — the nav is really scoping");

  // (2) this page's OWN <title>. Asserted as a pair AND as a difference (the criterion's shape).
  const tEn = headTitle(en.body);
  const tZh = headTitle(zh.body);
  console.log(`  [ac289] en <title> = ${JSON.stringify(tEn)}`);
  console.log(`  [ac289] zh <title> = ${JSON.stringify(tZh)}`);
  assert.ok(tEn.endsWith(" — Dashboard"), `en <title> ends with the page token " — Dashboard" (got ${JSON.stringify(tEn)})`);
  assert.ok(tZh.endsWith(" — 仪表盘"), `zh <title> ends with the translated token " — 仪表盘" (got ${JSON.stringify(tZh)})`);
  assert.notEqual(tZh, tEn, "the page's OWN <title> is not byte-identical across the two languages");

  // (3) this page's OWN <h1>.
  const h1En = /<h1>([^<]*)<\/h1>/.exec(en.body)?.[1];
  const h1Zh = /<h1>([^<]*)<\/h1>/.exec(zh.body)?.[1];
  assert.equal(h1En, "Dashboard", `<h1> is the en baseline (got ${JSON.stringify(h1En)})`);
  assert.equal(h1Zh, "仪表盘", `<h1> is translated under zh (got ${JSON.stringify(h1Zh)})`);
});

test("AC-black-box: the en response is byte-identical for the nav region whether or not lang is omitted", async () => {
  // A lang-parameterised renderer that quietly changed the DEFAULT rendering would move the
  // criterion's en baseline. This pins it: no query, no cookie ≡ an explicit `?lang=en`.
  const bare = await request(port, "/dashboard");
  const explicit = await request(port, "/dashboard?lang=en");
  assert.equal(navRegion(bare.body), navRegion(explicit.body),
    "the default-locale nav region is identical with and without an explicit ?lang=en");
  assert.equal(headTitle(bare.body), headTitle(explicit.body),
    "the default-locale <title> is identical with and without an explicit ?lang=en");
});
