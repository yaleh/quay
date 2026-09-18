// @test-group product
// gap-webui-nav-inconsistent-routes — 14-route navigation consistency.
//
// Two layers of the defect (08-16 P0 audit, docs/design/quay-webui-improved-2026-08-16/
// uploads/quaywebuiauditandproposal.md:361-362):
//   ① STRUCTURE — every route's nav must be the SAME renderSiteNav(current) call (the design's
//     navGroupDefs), not a hand-written variant. The audit's P0 table + §1.2 documented that
//     only ~8/14 routes had migrated and "no page linked to /board". This suite asserts, for
//     ALL 14 routes (+ the 4 detail pages), that the response's nav strip carries all 14
//     SITE_NAV_GROUPS items INCLUDING /board — a FULL ENUMERATION, not a test of the new parts.
//   ② VISUAL — renderSiteNav() emits the Modernist `.nav` + `.nav-brand` header bar (the design
//     system's components/navigation.html): brand flush left, vertical bars (.nav-group)
//     separating the four groups, current page red+bold (.nav-current, accent-700 + weight 800),
//     and the Board NEW badge. Asserted structurally here; the CSS preconditions are pinned too.
//   ③ MOBILE — renderMobileChrome() is wired into EVERY route (not just /tasks), and the mobile
//     menu carries the full navGroupDefs under per-group section labels.
//
// Run (scoped): node --test packages/quay/test/serve-nav-inconsistent-routes.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { pageStyles, renderMobileChrome, renderSiteNav } from "../src/serve-handlers.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const SERVE_HANDLERS = path.join(__dirname, "..", "src", "serve-handlers.ts");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** GET a route and return the redirect status + Location header (drains the body). */
function getRedirect(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location || "" }));
    }).on("error", reject);
  });
}

// The 14 navGroupDefs routes (the design's navGroupDefs, key → href) — the FULL enumeration.
// The 4 detail pages map to their list page's current-key.
const ALL_NAV_HREFS = [
  'href="/dashboard"', 'href="/tasks"', 'href="/live"', 'href="/board"', 'href="/system"',
  'href="/manager"', 'href="/journal"', 'href="/git-history"', 'href="/tests"', 'href="/sessions"',
  'href="/adr"', 'href="/goal"', 'href="/doc"', 'href="/architecture"',
];

// [route, currentKey, currentLabel, currentHref] — the full 14 + 4 detail pages.
const ROUTES = [
  ["/dashboard", "dashboard", "Dashboard", "/dashboard"],
  ["/tasks", "tasks", "Tasks", "/tasks"],
  ["/live", "live", "Live", "/live"],
  ["/board", "board", "Board", "/board"],
  ["/system", "system", "System", "/system"],
  ["/manager", "manager", "Manager", "/manager"],
  ["/journal", "journal", "Journal", "/journal"],
  ["/git-history", "git", "Git History", "/git-history"],
  ["/tests", "tests", "Tests", "/tests"],
  ["/sessions", "sessions", "Sessions", "/sessions"],
  ["/adr", "adr", "ADRs", "/adr"],
  ["/goal", "goal", "Goals", "/goal"],
  ["/doc", "doc", "Docs", "/doc"],
  ["/architecture", "architecture", "Architecture", "/architecture"],
  ["/task/NAV-001", "tasks", "Tasks", "/tasks"],
  ["/adr/ADR-101", "adr", "ADRs", "/adr"],
  ["/goal/AC-101", "goal", "Goals", "/goal"],
  ["/doc/DOC-101", "doc", "Docs", "/doc"],
];

// The exact hand-written nav fragments the 8 legacy routes used (08-16 audit §1.2: "12 处变体
// 无一相同"). AC1: none may survive on any route.
const LEGACY_NAV_FRAGMENTS = [
  "← tasks</a>", "← ADRs</a>", "← goals</a>", "← docs</a>",
  "ADRs →</a>", "goals →</a>", "docs →</a>", "git-history →</a>",
  "class=\"meta site-nav\"",
];

let server, port, originalCwd, workspaceRoot;

before(async () => {
  const tasksDir = makeTmpDir("nav-serve-tasks-");
  const adrDir = makeTmpDir("nav-serve-adr-");
  workspaceRoot = makeTmpDir("nav-serve-ws-");
  fs.writeFileSync(path.join(tasksDir, "NAV-001.md"),
    "---\nid: NAV-001\ntitle: nav fixture\ntodo: false\nstatus: todo\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n");
  // The native adr store requires ADR-NNN ids (adr-store.ts ADR_ID_RE) and lists files
  // starting with "ADR-".
  fs.writeFileSync(path.join(adrDir, "ADR-101-nav.md"),
    "---\nid: ADR-101\ntitle: nav adr\nstatus: accepted\ndate: 2026-08-17\n---\n## Context\nc\n## Decision\nd\n## Consequences\ne\n");
  // goal store at <workspaceRoot>/goals, document store at <workspaceRoot>/docs-managed.
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs-managed"), { recursive: true });
  // goal ids are GOAL-NNN / AC-NNN (goal-store.ts), doc ids are DOC-NNN (document-store.ts).
  fs.writeFileSync(path.join(workspaceRoot, "goals", "AC-101-criterion.md"),
    "---\nid: AC-101\ntitle: nav criterion\nstatus: active\nkind: criterion\ngoal: GOAL-101\ncriterion: echo ok\nexpect: \"=0\"\norigin: 2026-08-17 fixture\n---\n## Rationale\nmeasured\n");
  fs.writeFileSync(path.join(workspaceRoot, "docs-managed", "DOC-101-nav-doc.md"),
    "---\nid: DOC-101\ntitle: nav doc\nstatus: active\nkind: skill\n---\n## Body\nthe doc\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "nav fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

/** Extract the <nav class="site-nav"> strip from a route body (the unified header bar). */
function navStrip(body) {
  const start = body.indexOf('<nav class="site-nav"');
  assert.ok(start !== -1, "route body renders the unified <nav class=\"site-nav\"> header bar");
  const end = body.indexOf("</nav>", start);
  assert.ok(end !== -1, "site-nav strip closes");
  return body.slice(start, end + "</nav>".length);
}

// ── AC2: FULL ENUMERATION — every one of the 14 routes (+4 detail pages) carries ALL 14 ──────

test("AC2 — every route's nav strip links to all 14 SITE_NAV_GROUPS items INCLUDING /board", async () => {
  for (const [route, currentKey, currentLabel, currentHref] of ROUTES) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `GET ${route} returns 200 (got ${r.status})`);
    const strip = navStrip(r.body);
    // The FULL enumeration: every nav item EXCEPT the current page (which is intentionally
    // not a link) must appear as a link in the strip.
    for (const href of ALL_NAV_HREFS) {
      if (href === `href="${currentHref}"`) continue; // current page is rendered as a span
      assert.ok(strip.includes(href), `GET ${route} nav strip links to ${href}`);
    }
    // The audit's headline gap: NOTHING linked to /board. It must be present on every page
    // except the board page itself (which marks Board as the current page, not a link).
    if (currentHref !== "/board") {
      assert.ok(strip.includes('href="/board"'), `GET ${route} nav strip includes /board`);
    }
    // The current page is rendered red+bold (span with the nav-current class, which the CSS
    // styles as accent-700 + weight 800), not as a link to itself.
    assert.ok(strip.includes('nav-current'), `GET ${route} marks the current page .nav-current`);
    assert.ok(strip.includes(`>${currentLabel}<`), `GET ${route} current page label is "${currentLabel}"`);
    assert.ok(!strip.includes(`href="${currentHref}"`), `GET ${route} current page (${currentHref}) is NOT a link`);
  }
});

// ── AC1: STRUCTURE — no hand-written nav variant survives on any route ───────────────────────

test("AC1 — no route body retains a hand-written legacy nav fragment", async () => {
  for (const [route] of ROUTES) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `GET ${route} returns 200`);
    for (const frag of LEGACY_NAV_FRAGMENTS) {
      assert.ok(!r.body.includes(frag), `GET ${route} does not contain legacy nav fragment "${frag}"`);
    }
  }
  // The source itself: the only nav renderer left is renderSiteNav (no <p class="meta site-nav">).
  const src = fs.readFileSync(SERVE_HANDLERS, "utf8");
  assert.ok(!src.includes("class=\"meta site-nav\""), "serve-handlers.ts has no <p class=\"meta site-nav\">");
  assert.ok(!src.includes("← tasks</a>") && !src.includes("ADRs →</a>"), "serve-handlers.ts has no legacy nav link fragments");
});

// ── AC3: VISUAL STRUCTURE — the .nav/.nav-brand header bar + token-derived CSS ────────────────

test("AC3 — renderSiteNav emits the Modernist .nav/.nav-brand header bar with all design marks", () => {
  const nav = renderSiteNav("board");
  assert.ok(nav.includes('<nav class="site-nav"'), "nav is a <nav class=\"site-nav\"> element");
  assert.ok(nav.includes('class="nav"'), "nav uses the design system's .nav class (the header bar)");
  assert.ok(nav.includes('class="nav-brand"'), "nav renders the Quay .nav-brand");
  assert.ok(nav.includes(">Quay</span>"), "brand text is Quay");
  assert.ok(nav.includes('class="nav-group"'), "groups are wrapped in .nav-group (vertical-bar separators)");
  // Four groups → four .nav-group wrappers.
  assert.equal((nav.match(/class="nav-group"/g) || []).length, 4, "exactly four .nav-group separators");
  // Current page (board) is red+bold: span.nav-current with aria-current.
  assert.ok(nav.includes('class="nav-item nav-current" aria-current="page"'), "current page is span.nav-current with aria-current");
  // Board carries the design's NEW badge (sc-if mkItem.badge) — both as current and as a link.
  assert.ok(nav.includes('class="nav-badge">NEW'), "nav renders the Board NEW badge");
  // Non-current items are real links.
  assert.ok(nav.includes('<a class="nav-item" href="/tasks"'), "non-current items are links");
  // Dashboard (a non-current) is a link when board is current.
  assert.ok(nav.includes('<a class="nav-item" href="/dashboard"'), "dashboard is a link when board is current");
});

test("AC3 — every route inlines the .nav header-bar CSS and the nav visual classes", async () => {
  const r = await get(port, "/dashboard");
  assert.ok(r.body.includes(".nav-group"), "response inlines the .nav-group CSS");
  assert.ok(r.body.includes(".nav-current"), "response inlines the .nav-current CSS");
  assert.ok(r.body.includes(".nav-brand"), "response inlines the .nav-brand CSS");
  assert.ok(r.body.includes(".nav-badge"), "response inlines the .nav-badge CSS");
  // Token-derived: current-page colour comes from the accent-700 token, not a hardcoded hex.
  assert.ok(r.body.includes("color: var(--color-accent-700)"), "current-page red is token-derived (accent-700)");
});

test("AC3 — pageStyles() carries the nav CSS preconditions, token-derived (AC102 ②)", () => {
  const css = pageStyles();
  assert.ok(css.includes(".nav-brand"), "base sheet styles .nav-brand");
  assert.ok(/\.nav-group\s*\{/.test(css), "base sheet styles .nav-group");
  assert.ok(/\.nav-current\s*\{[^}]*var\(--color-accent-700\)/.test(css), ".nav-current is accent-700 (red)");
  assert.ok(/\.nav-current\s*\{[^}]*font-weight:\s*800/.test(css), ".nav-current is weight 800 (bold)");
  assert.ok(/\.nav-badge\s*\{/.test(css), "base sheet styles .nav-badge");
  // AC102 ② — serve-handlers.ts carries zero hardcoded hex.
  const src = fs.readFileSync(SERVE_HANDLERS, "utf8");
  const hex = src.match(/#[0-9a-fA-F]{6}/g) || [];
  assert.deepEqual(hex, [], `AC102 ②: serve-handlers.ts carries zero hardcoded hex (got ${hex.length}: ${hex.join(", ")})`);
});

// ── AC4: MOBILE — renderMobileChrome is wired into EVERY route, not just /tasks ──────────────

test("AC4 — every route emits the mobile chrome (hamburger header + full 14-view menu)", async () => {
  for (const [route] of ROUTES) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `GET ${route} returns 200`);
    assert.ok(r.body.includes('class="mobile-chrome"'), `GET ${route} emits the mobile chrome wrapper`);
    assert.ok(r.body.includes('class="mobile-menu-toggle-input"'), `GET ${route} emits the mobile toggle`);
    assert.ok(r.body.includes('class="mobile-menu"'), `GET ${route} emits the mobile menu`);
  }
});

test("AC4 — renderMobileChrome carries the full 14-view nav under per-group section labels", () => {
  // ⚠️ gap-webui-dashboard-body-copy-en-zh: the four group section labels (核心/观测/记录/知识)
  // moved into serve-i18n.ts's CHROME_LABELS (ROW 9) — they were the last piece of shared chrome
  // still hard-coded Chinese, found by that task's `lang=en` baseline probe. The DEFAULT language
  // is `en`, so this test now asks for `zh` explicitly (keeping its original assertions as the zh
  // regression guard) and pins the en arm in a second test below. The 14 VIEW labels were already
  // language-dependent before this change; they happen to be identical in both columns.
  // ⚠️ TWO renders, not one: the group section labels and the 14 VIEW labels are different rows of
  // the dictionary (CHROME_LABELS ROW 9 vs NAV_LABELS ROW 1), and they do not answer to the same
  // language in this assertion's original form — the group labels used to be Chinese in BOTH
  // languages while the view labels were Chinese only under zh. Rendering once and asserting both
  // halves in the same language is what broke; each half is now pinned in the language it is defined
  // for. (The pre-change single render was `en`-for-views + `zh`-for-groups, i.e. it agreed with
  // neither column.)
  const zh = renderMobileChrome("tasks", "task list", "zh");
  assert.ok(zh.includes('id="mobile-menu-toggle"'), "mobile toggle has a stable id");
  assert.ok(zh.includes('class="mobile-menu-group"'), "mobile menu groups its items");
  assert.ok(zh.includes("task list"), "page label rendered");
  for (const label of ["核心", "观测", "记录", "知识"]) {
    assert.ok(zh.includes(label), `mobile menu renders the ${label} group section label under zh`);
  }
  for (const label of ["仪表盘", "任务", "实时", "看板", "系统", "管理器", "日志",
    "Git 历史", "测试", "会话", "架构决策", "目标", "文档", "架构"]) {
    assert.ok(zh.includes(label), `mobile menu includes the zh view label ${label}`);
  }
  assert.ok(zh.includes("NEW"), "mobile menu renders the Board NEW badge");
  assert.ok(zh.includes("nav-current"), "mobile menu marks the current page");

  // …and the en render: the English group labels AND the English view labels, same 14 views.
  const en = renderMobileChrome("tasks", "task list", "en");
  for (const label of ["Core", "Observation", "Records", "Knowledge"]) {
    assert.ok(en.includes(label), `mobile menu renders the en ${label} group section label`);
  }
  for (const label of ["Dashboard", "Tasks", "Live", "Board", "System", "Manager", "Journal",
    "Git History", "Tests", "Sessions", "ADRs", "Goals", "Docs", "Architecture"]) {
    assert.ok(en.includes(label), `mobile menu includes ${label}`);
  }
  assert.ok(en.includes("NEW"), "mobile menu renders the Board NEW badge");
  assert.ok(en.includes("nav-current"), "mobile menu marks the current page");
});

/** Han, built from a code point so this file stays ASCII (a literal range would make the file that
 *  asserts "no Chinese" itself contain Chinese — and every CJK sweep of the tree would flag it). */
const CJK_HAN = new RegExp("[" + String.fromCharCode(0x4e00) + "-" + String.fromCharCode(0x9fff) + "]");

test("AC4 (en) — the same menu under `en` renders English group section labels and no Chinese at all", () => {
  const html = renderMobileChrome("tasks", "task list", "en");
  for (const label of ["Core", "Observation", "Records", "Knowledge"]) {
    assert.ok(html.includes(label), `mobile menu renders the en ${label} group section label`);
  }
  // The endonym 中文 in the switcher is the ONE deliberate exception (serve-i18n ROW 4).
  const withoutSwitcher = html.replace(/<span class="lang-switcher-item"[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<a class="lang-switcher-item"[^>]*>[\s\S]*?<\/a>/g, "");
  assert.ok(!CJK_HAN.test(withoutSwitcher), "the en mobile chrome carries no Chinese outside the language switcher's endonym");
});

test("AC4 — mobile CSS: the menu-group section labels and 48px touch targets exist in the ≤600px form", () => {
  const css = pageStyles();
  assert.ok(css.includes("@media (max-width: 600px)"), "mobile media query present");
  const mobile = css.slice(css.indexOf("@media (max-width: 600px)"));
  assert.ok(/\.site-nav\s*\{\s*display:\s*none/.test(mobile), "mobile form hides the desktop header bar");
  assert.ok(/\.mobile-menu-group-label\s*\{/.test(mobile), "mobile menu styles the per-group section labels");
  assert.ok(/\.mobile-menu\s*\.mobile-menu-item\s*\{[^}]*min-height:\s*48px/.test(mobile), "mobile menu items are ≥48px touch targets");
  assert.ok(/\.mobile-menu\s*\.mobile-menu-item\.nav-current\s*\{[^}]*var\(--color-accent-700\)/.test(mobile), "mobile current item is accent-700 (red)");
});

// ── AC5: the observation surface stays reachable from the list page (regression) ─────────────

test("AC5 — the task list page's nav still links to /live and /journal (observation reachable)", async () => {
  const r = await get(port, "/tasks");
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('href="/live"') && r.body.includes('href="/journal"'),
    "task list nav links to /live and /journal");
});

// ── gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead AC5: /git redirects ──────────

test("gap-git-graph-fold-control AC5 — /git 302s to the canonical /git-history", async () => {
  const r = await getRedirect(port, "/git");
  assert.ok(r.status === 301 || r.status === 302, `GET /git returns a redirect (got ${r.status})`);
  assert.ok(r.location.endsWith("/git-history"), `redirect_url ends with /git-history (got "${r.location}")`);
});
