// @test-group product
// gap-webui-lang-switcher-control — the language switcher: the CLICKABLE entry point into the
// AC-288 language mechanism.
//
// THE GAP THIS FILE JUDGES (not "the mechanism", which already worked): AC-288 landed
// `?lang=` → `resolveLang` → `Set-Cookie` → `<html lang>` and AC-289~303 wired that into all 15
// pages' copy — and yet NO rendered page ever emitted a `?lang=` link. The mechanism was reachable
// only by hand-editing the URL. "The mechanism works" and "a user can operate it" are two
// properties; this file is the judge for the second one.
//
//   ① AC2 — the pure renderer, imported DIRECTLY, asserted in BOTH directions. The falsifier is
//      the pair: the active language must NOT be a link to itself while the other one must be.
//      Either assertion alone is satisfiable by a broken renderer (emit both links ⇒ the `!`
//      side fails; emit neither ⇒ the positive side fails), so the pair — not one of them — is
//      the measurement.
//   ② AC3 — the black box: a REAL `startServer`, raw HTTP, and the two chrome regions extracted
//      and asserted SEPARATELY. Both must carry the control: the desktop one lives in
//      `.site-nav`, which is `display:none` on mobile, so a desktop-only wiring leaves every
//      phone with no entry point at all — and a body-wide substring match would call that green.
//   ③ AC4 — ENUMERATION, not a spot check: all 15 `SITE_NAV_ROUTES` pages, one HTTP GET each, with
//      a printed per-route row. "It works on /dashboard" is not evidence for the other fourteen.
//   ④ AC6 — the ROAD TEST: take the `href` the page actually rendered, resolve it the way the
//      browser would, follow it, and read the `Set-Cookie` + `<html lang="zh">` back off the wire.
//      The switcher is an entry point INTO AC-288's mechanism — this proves the click arrives
//      there without re-deriving the mechanism's own four-state table (that is serve-lang.test.mjs's
//      job, and duplicating it here would make one of the two the untested copy).
//
// Run (scoped): node --test packages/quay/test/serve-lang-switcher.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { renderLangSwitcher, SITE_NAV_ROUTES } from "../src/serve-handlers.ts";
import { NAV_KEYS, LANG_NAMES, LANG_SWITCHER_GROUP, LANG_SWITCH_ARIA } from "../src/serve-i18n.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The 15 nav routes, PINNED AS LITERALS. Pinned (rather than read off `SITE_NAV_ROUTES`) so the
 *  enumeration below cannot silently shrink to whatever the renderer happens to do — 硬规则 4: a
 *  roster derived from the thing under test is a tautology, not a measurement. The pin is then
 *  asserted EQUAL to the table, so a route added/removed in the source reds THIS list instead of
 *  quietly leaving it at 15. */
const PINNED_ROUTES = [
  "/dashboard", "/tasks", "/live", "/board", "/system", "/manager", "/needs-human",
  "/journal", "/git-history", "/tests", "/sessions", "/adr", "/goal", "/doc", "/architecture",
];

/** Raw HTTP GET returning the RESPONSE (status + headers + body). A cookie jar is deliberately
 *  absent — each call carries exactly the headers the caller spelled out, so the zh reading below
 *  can only be green because of the `Cookie:` it sent. */
function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** The DESKTOP chrome region: the `.nav` header bar inside `<nav class="site-nav">`, from the open
 *  tag to the `</nav>` that closes the strip. Bounded at `<nav`, not at `</div>`, on purpose — the
 *  switcher is the LAST child of `.nav`, so a slice that stopped at the first `</div>` would cut
 *  off exactly the thing being asserted (and would have passed before this task too). */
function desktopNavRegion(body) {
  const start = body.indexOf('<div class="nav">');
  if (start < 0) return "";
  const end = body.indexOf("</nav>", start);
  return end < 0 ? "" : body.slice(start, end);
}

/** The MOBILE chrome region: `<header class="mobile-header">…</header>`. A separate extractor from
 *  the one above because the two chromes are separate render paths — one function returning "the
 *  nav region" would let a desktop-only wiring satisfy both assertions. */
function mobileHeaderRegion(body) {
  const start = body.indexOf('<header class="mobile-header">');
  if (start < 0) return "";
  const end = body.indexOf("</header>", start);
  return end < 0 ? "" : body.slice(start, end + "</header>".length);
}

// ── ① AC2: the pure renderer, both directions ──────────────────────────────────────────────────

test("AC2① — the ACTIVE language is not a link to itself; the other one is (both directions)", () => {
  const en = renderLangSwitcher("en");
  const zh = renderLangSwitcher("zh");

  // (a) on an `en` page the clickable entry is the zh one …
  assert.ok(en.includes('href="?lang=zh"'),
    "an en page offers a link to switch to zh");
  // (b) … and there is NO link back to the language the reader is already reading. A self-link is a
  //     dead affordance AND would re-write the lang cookie for no reason.
  assert.ok(!en.includes('href="?lang=en"'),
    "an en page does NOT link to ?lang=en (the current language is a non-link state)");
  assert.ok(en.includes('aria-current="true"'),
    "the current language is marked aria-current=true, not merely left unlinked");

  // (c) the mirror image — asserted on its own terms, never inferred from (a)/(b).
  assert.ok(zh.includes('href="?lang=en"'), "a zh page offers a link to switch to en");
  assert.ok(!zh.includes('href="?lang=zh"'), "a zh page does NOT link to ?lang=zh");

  // NEGATIVE CONTROL: the two readings differ. Without this, "the mirror image" could be a claim
  // about a constant — and the two `!`-assertions above would then be the only thing standing
  // between a hardwired renderer and a green run.
  assert.notEqual(en, zh, "the two language states render DIFFERENT markup");

  // Both visible names come from the dictionary, so re-wording the button is a one-file change and
  // neither language can be left unnamed.
  for (const lang of ["en", "zh"]) {
    assert.ok(renderLangSwitcher(lang).includes(`>${LANG_NAMES[lang]}<`),
      `every state renders the dictionary's own name for ${lang}`);
  }
});

test("AC2② — the accessible names are keyed on BOTH axes (reader AND target), and are complete", () => {
  // The type is `Record<Lang, Record<Lang, string>>`; this asserts the runtime table is as complete
  // as the type claims, so a cast or a hand-built object cannot slip an undefined sentence through
  // (an undefined aria-label renders as `aria-label="undefined"` — a silent English-ish fallback).
  for (const reader of ["en", "zh"]) {
    for (const target of ["en", "zh"]) {
      const s = LANG_SWITCH_ARIA[reader][target];
      assert.ok(typeof s === "string" && s.trim().length > 0,
        `LANG_SWITCH_ARIA[${reader}][${target}] is a non-empty sentence (got ${JSON.stringify(s)})`);
    }
    assert.ok(typeof LANG_SWITCHER_GROUP[reader] === "string" && LANG_SWITCHER_GROUP[reader].length > 0,
      `the group name exists for a ${reader} reader`);
  }
  // The reader axis is REAL: collapsing it (one row for both readers) would read 「切换到英文」 to a
  // reader who is on the English page — the wrong sentence, not just a missing translation.
  assert.notDeepEqual(LANG_SWITCH_ARIA.en, LANG_SWITCH_ARIA.zh,
    "the two reader rows differ — the table has a reader dimension, not just a target one");

  // The rendered markup uses the reader's row: an en page's zh entry is described in English.
  assert.ok(renderLangSwitcher("en").includes(LANG_SWITCH_ARIA.en.zh),
    "an en page describes the zh entry with the en reader's sentence");
  assert.ok(renderLangSwitcher("zh").includes(LANG_SWITCH_ARIA.zh.en),
    "a zh page describes the en entry with the zh reader's sentence");
});

// ── the black box: a real server, real HTTP ────────────────────────────────────────────────────

let server, port, originalCwd, workspaceRoot, tasksDir, adrDir, goalsDir;

before(async () => {
  tasksDir = makeTmpDir("langsw-tasks-");
  adrDir = makeTmpDir("langsw-adr-");
  workspaceRoot = makeTmpDir("langsw-ws-");
  // One live page of each shape so every one of the 15 routes has something real to render (an
  // empty store is a different code path — an empty-state page must carry the switcher too, but a
  // populated one is the case a reader actually meets).
  fs.writeFileSync(path.join(tasksDir, "SW-001.md"),
    "---\nid: SW-001\ntitle: lang switcher fixture\ntodo: false\nstatus: ready\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n");
  fs.writeFileSync(path.join(adrDir, "ADR-201-sw.md"),
    "---\nid: ADR-201\ntitle: lang switcher adr\nstatus: accepted\ndate: 2026-09-18\n---\n## Context\nc\n## Decision\nd\n## Consequences\ne\n");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs-managed"), { recursive: true });
  fs.writeFileSync(path.join(goalsDir, "AC-201-sw.md"),
    "---\nid: AC-201\ntitle: lang switcher criterion\nstatus: active\nkind: criterion\ngoal: GOAL-201\ncriterion: echo ok\nexpect: \"=0\"\norigin: 2026-09-18 fixture\n---\n## Rationale\nmeasured\n");
  fs.writeFileSync(path.join(workspaceRoot, "docs-managed", "DOC-201-sw.md"),
    "---\nid: DOC-201\ntitle: lang switcher doc\nstatus: active\nkind: skill\n---\n## Body\nthe doc\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "lang-switcher fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  // `port: 0` — let the KERNEL pick. Probing for a free port ourselves races other workers, and a
  // bind collision here leaks the provider child and hangs the whole suite (serve-bind-failure-no-leak).
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

// ── ② AC3: both chromes carry the control, asserted SEPARATELY ─────────────────────────────────

test("AC3② — /dashboard's DESKTOP and MOBILE chrome EACH carry the control, in both languages", async () => {
  const en = await request(port, "/dashboard");
  const zh = await request(port, "/dashboard", { Cookie: "lang=zh" });
  assert.equal(en.status, 200, `GET /dashboard returns 200 (got ${en.status})`);
  assert.equal(zh.status, 200, `GET /dashboard (Cookie lang=zh) returns 200 (got ${zh.status})`);

  const regions = [
    ["desktop", desktopNavRegion(en.body), desktopNavRegion(zh.body)],
    ["mobile", mobileHeaderRegion(en.body), mobileHeaderRegion(zh.body)],
  ];

  for (const [name, regionEn, regionZh] of regions) {
    // (0) the region was really found — otherwise every assertion below is vacuously "present in
    //     the empty string", which is the shape a silently-renamed class produces.
    assert.ok(regionEn.length > 0, `the ${name} chrome region was extracted from the en response`);
    assert.ok(regionZh.length > 0, `the ${name} chrome region was extracted from the zh response`);

    // (1) the control is IN this region — asserted per region, never once for the whole body.
    assert.ok(regionEn.includes("lang-switcher"),
      `the ${name} chrome renders the language switcher`);
    assert.ok(regionEn.includes('href="?lang=zh"'),
      `the ${name} chrome's switcher links to ?lang=zh on an en page`);
    assert.ok(!regionEn.includes('href="?lang=en"'),
      `the ${name} chrome does NOT self-link to the language already active`);

    // (2) the mirror direction — the control tracks the RESOLVED language rather than being a
    //     static pair of links that happens to look right on an en page.
    assert.ok(regionZh.includes('href="?lang=en"'),
      `the ${name} chrome's switcher links to ?lang=en on a zh page`);
    assert.ok(!regionZh.includes('href="?lang=zh"'),
      `the ${name} chrome does NOT self-link when zh is the active language`);
  }

  // The two regions are genuinely different slices — a coincidence of substring matching cannot
  // make one region's reading stand in for the other's.
  assert.ok(!desktopNavRegion(en.body).includes("mobile-header"),
    "the desktop region is not the mobile chrome");
  assert.ok(!mobileHeaderRegion(en.body).includes('class="nav-item"'),
    "the mobile region is not the desktop nav strip");
});

// ── ③ AC4: full enumeration over every nav route ───────────────────────────────────────────────

test("AC4③ — every one of the 15 nav routes renders the switcher (per-route rows, not a total)", async () => {
  // The pin and the source table must agree, so this loop covers the real roster — and a route
  // added to SITE_NAV_ROUTES reds HERE (the pin is stale) instead of going unenumerated.
  assert.deepEqual([...Object.values(SITE_NAV_ROUTES)].sort(), [...PINNED_ROUTES].sort(),
    "the pinned 15-route roster equals SITE_NAV_ROUTES (a new route must be added to BOTH)");
  assert.deepEqual([...Object.keys(SITE_NAV_ROUTES)].sort(), [...NAV_KEYS].sort(),
    "the route table and the label dictionary name the same 15 views");

  const rows = [];
  const failures = [];
  for (const route of PINNED_ROUTES) {
    const res = await request(port, route);
    const region = desktopNavRegion(res.body);
    const mobile = mobileHeaderRegion(res.body);
    const desktopOk = region.includes('href="?lang=zh"') && region.includes("lang-switcher");
    const mobileOk = mobile.includes('href="?lang=zh"') && mobile.includes("lang-switcher");
    const ok = res.status === 200 && desktopOk && mobileOk;
    if (!ok) failures.push(route);
    rows.push(`  [ac-lang-switcher] ${ok ? "PASS" : "FAIL"}  ${route}  status=${res.status}`
      + `  desktop=${desktopOk}  mobile=${mobileOk}`);
  }
  console.log(rows.join("\n"));

  // Every offending route is reported at once (硬规则 3: enumerate, don't collapse the loop into
  // one boolean) — the message carries the whole per-route table, not just the first miss.
  assert.equal(failures.length, 0, `routes whose chrome lacks the switcher: ${failures.join(", ")}\n${rows.join("\n")}`);
  assert.equal(rows.length, 15, `all 15 routes were enumerated (got ${rows.length})`);
});

// ── ④ AC6: follow the rendered link, read the mechanism's answer off the wire ─────────────────

test("AC6 — following the rendered link really switches the language (Set-Cookie + <html lang=zh>)", async () => {
  const before = await request(port, "/dashboard");
  assert.ok(before.body.includes('<html lang="en"'), "the walk starts on an en page");

  // Take the href THE PAGE RENDERED — not a string this test composed. If the renderer's href ever
  // stopped being the `?lang=` shape the resolver reads, this extraction goes empty and the test
  // reds, which is the point: the contact surface is the rendered markup.
  const href = /href="(\?lang=zh)"/.exec(desktopNavRegion(before.body))?.[1];
  assert.ok(href, "the desktop chrome rendered a ?lang=zh href to follow");

  // Resolve it with the BROWSER's own rule (`new URL(href, base)`) rather than concatenating the
  // query onto the path by hand: the switcher's href is deliberately RELATIVE, and the property
  // that buys — "the reader stays on the page they were reading" — is exactly what this resolution
  // exercises. A hand-built `/dashboard?lang=zh` would pass even if the href were absolute to
  // somewhere else.
  const target = new URL(href, `http://127.0.0.1:${port}/dashboard`);
  assert.equal(target.pathname, "/dashboard", "the relative href resolves back onto the same page");
  assert.equal(target.search, "?lang=zh", "the relative href carries exactly the language query");

  const after = await request(port, target.pathname + target.search);
  assert.equal(after.status, 200, `following the link returns 200 (got ${after.status})`);

  // The two halves of AC-288's answer, asserted separately: the language THIS response renders in,
  // and the persistence the NEXT request will read. One green never stands in for the other.
  assert.ok(after.body.includes('<html lang="zh"'),
    "following the rendered link renders the page in zh");
  const setCookie = after.headers["set-cookie"];
  assert.ok(setCookie && String(setCookie).includes("lang=zh"),
    `following the rendered link sets the persistence cookie (got ${JSON.stringify(setCookie)})`);

  // …and the new page's switcher points BACK — the control is a two-way switch, not a one-shot.
  assert.ok(desktopNavRegion(after.body).includes('href="?lang=en"'),
    "the zh page's switcher offers the way back to en");
});
