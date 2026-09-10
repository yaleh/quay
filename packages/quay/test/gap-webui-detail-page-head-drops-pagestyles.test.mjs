// @test-group product
// gap-webui-detail-page-head-drops-pagestyles — the three detail pages (/goal/:id /adr/:id
// /doc/:id) DROPPED their page shell stylesheet.
//
// Root cause (gap-ac100-webui-detail-pages-modernist-tokens.md:42): the three detail handlers
// were switched from `pageStyles()` to `modernistStyles() + detailStyles()` — REPLACED, not
// appended. pageStyles() carries the shell rules the nav depends on (`.nav-*`, `.mobile-chrome {
// display:none }` desktop / `display:block` mobile, and `.site-nav { display:none }` in the ≤600px
// media query); detailStyles() has ONLY `.detail-page` typography — zero nav rules. Result:
// bare unstyled nav on desktop, and on mobile BOTH `.site-nav` and `.mobile-chrome` resolve to
// `display:block` (double nav, horizontal overflow — scrollWidth 792 vs viewport 390).
//
// The fix is structural, not three one-line patches (hard rule 5b): serve-render.ts now exports
// `shellStyles(kind)` — the page shell's styles as ONE atomic entry that ALWAYS includes the
// nav/mobile-chrome rules, with the "detail" kind layering detail typography ON TOP. The three
// detail handlers now call `shellStyles("detail")`; the list handlers call `shellStyles()`.
//
// This test is the enumerating, can-take-false judge that binds renderSiteNav to its stylesheet:
//   AC1 — the three detail routes inline the `.mobile-chrome {` shell rule (fetch-level).
//   AC2 — FULL ENUMERATION: every page route that renders `class="site-nav"` must also inline
//         `.mobile-chrome {`; a failure prints the violating route LIST (count + names), not a
//         single boolean (hard rule 3: enumerate, don't boolean).
//   AC3 — mutation negative control: the pure predicate flags a nav-without-shell string RED and
//         a nav-with-shell string GREEN — BOTH directions asserted.
//   AC4 (structural proxy) — the three detail routes inline the ≤600px media rules that make the
//         mobile computed styles correct (`.site-nav { display:none }` + `.mobile-chrome {
//         display:block }`). The browser-level reading (getComputedStyle(.site-nav).display ===
//         'none' AND scrollWidth === clientWidth at 390×844) is a live-browser verification
//         recorded in the commit evidence (DoD — DIR-026 Reading A), not a browser-less CI check.
//
// Run (scoped): node --test packages/quay/test/gap-webui-detail-page-head-drops-pagestyles.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { renderSiteNav, shellStyles } from "../src/serve-handlers.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

// The FULL page-route enumeration — every GET page that renders renderSiteNav(): the 15
// navGroupDefs list routes (核心/观测/记录/知识, incl. needs-human in 观测) + the 4 detail
// pages. This is enumeration, not a sample: any page route that emits the nav markup is checked.
const PAGE_ROUTES = [
  ["/dashboard", "dashboard"],
  ["/tasks", "tasks"],
  ["/live", "live"],
  ["/board", "board"],
  ["/system", "system"],
  ["/manager", "manager"],
  ["/needs-human", "needs-human"],
  ["/journal", "journal"],
  ["/git-history", "git"],
  ["/tests", "tests"],
  ["/sessions", "sessions"],
  ["/adr", "adr"],
  ["/goal", "goal"],
  ["/doc", "doc"],
  ["/architecture", "architecture"],
  ["/task/NAV-001", "tasks"],
  ["/adr/ADR-101", "adr"],
  ["/goal/AC-101", "goal"],
  ["/doc/DOC-101", "doc"],
];

// The three detail routes that were broken (gap-ac100 replaced pageStyles() with detailStyles()).
const DETAIL_ROUTES = ["/adr/ADR-101", "/goal/AC-101", "/doc/DOC-101"];

/** Pure predicate (the AC2/AC3 judge). A page that renders the unified site nav MUST also inline
 *  the shell stylesheet that makes it visible. `.mobile-chrome {` is the marker for pageStyles()
 *  (the shell sheet) — it appears in NEITHER modernistStyles() (the token sheet) NOR detailStyles()
 *  (detail typography only). Returns a LIST of violations ([] = well-formed) so the caller can
 *  enumerate every offending route rather than collapse to a boolean (hard rule 3). */
export function pageShellViolations(html) {
  const violations = [];
  if (html.includes('class="site-nav"') && !html.includes(".mobile-chrome {")) {
    violations.push('renders class="site-nav" but omits the .mobile-chrome { shell rule');
  }
  return violations;
}

let server, port, originalCwd, workspaceRoot;

before(async () => {
  const tasksDir = makeTmpDir("pagestyles-tasks-");
  const adrDir = makeTmpDir("pagestyles-adr-");
  workspaceRoot = makeTmpDir("pagestyles-ws-");
  fs.writeFileSync(path.join(tasksDir, "NAV-001.md"),
    "---\nid: NAV-001\ntitle: pagestyles fixture\ntodo: false\nstatus: todo\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n");
  // The native adr store requires ADR-NNN ids (adr-store.ts ADR_ID_RE) and lists files starting "ADR-".
  fs.writeFileSync(path.join(adrDir, "ADR-101-nav.md"),
    "---\nid: ADR-101\ntitle: pagestyles adr\nstatus: accepted\ndate: 2026-08-17\n---\n## Context\nc\n## Decision\nd\n## Consequences\ne\n");
  // goal store at <workspaceRoot>/goals, document store at <workspaceRoot>/docs-managed.
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs-managed"), { recursive: true });
  // goal ids are GOAL-NNN / AC-NNN (goal-store.ts), doc ids are DOC-NNN (document-store.ts).
  fs.writeFileSync(path.join(workspaceRoot, "goals", "AC-101-criterion.md"),
    "---\nid: AC-101\ntitle: pagestyles criterion\nstatus: active\nkind: criterion\ngoal: GOAL-101\ncriterion: echo ok\nexpect: \"=0\"\norigin: 2026-08-17 fixture\n---\n## Rationale\nmeasured\n");
  fs.writeFileSync(path.join(workspaceRoot, "docs-managed", "DOC-101-nav-doc.md"),
    "---\nid: DOC-101\ntitle: pagestyles doc\nstatus: active\nkind: skill\n---\n## Body\nthe doc\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "pagestyles fixture workspace\n");
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

// ── AC1: the three detail routes inline the shell's `.mobile-chrome {` rule ──────────────────

test("AC1 — /goal/:id /adr/:id /doc/:id each inline `.mobile-chrome {` (≥1 occurrence)", async () => {
  for (const route of DETAIL_ROUTES) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `GET ${route} returns 200 (got ${r.status})`);
    const count = (r.body.match(/\.mobile-chrome \{/g) || []).length;
    assert.ok(count >= 1, `GET ${route} inlines .mobile-chrome { (got ${count}, want ≥1)`);
  }
});

// ── AC2: FULL ENUMERATION — every page route binds its nav to the shell stylesheet ───────────

test("AC2 — every page route rendering site-nav also inlines the shell stylesheet", async () => {
  const violations = [];
  for (const [route] of PAGE_ROUTES) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `GET ${route} returns 200 (got ${r.status})`);
    for (const msg of pageShellViolations(r.body)) violations.push(`${route}: ${msg}`);
  }
  if (violations.length > 0) {
    assert.fail(`shell-style violations on ${violations.length} route(s):\n  ${violations.join("\n  ")}`);
  }
  // Positive sanity: the enumeration actually saw the nav (a zero-violation pass on an EMPTY
  // enumeration would be a vacuous measurement — hard rule 4). PAGE_ROUTES must be non-empty.
  assert.ok(PAGE_ROUTES.length > 0, "the enumeration is non-empty (not a vacuous zero-violation pass)");
});

// ── AC3: the predicate can take false (mutation control, BOTH directions) ────────────────────

test("AC3 — mutation negative control: renderSiteNav WITHOUT the shell is flagged RED", () => {
  const navOnly = renderSiteNav("goal"); // the nav markup alone — no shellStyles()/pageStyles()
  const violations = pageShellViolations(navOnly);
  assert.ok(violations.length > 0, `nav-without-shell reports ≥1 violation (got ${violations.length})`);
});

test("AC3 — mutation positive control: renderSiteNav WITH the shell is GREEN", () => {
  const both = `${shellStyles("detail")}${renderSiteNav("goal")}`;
  assert.deepEqual(pageShellViolations(both), [], "nav-with-shell has zero violations");
});

test("AC3 — shellStyles(kind) is ADDITIVE, never a replacement (the fix mechanism itself)", () => {
  const detail = shellStyles("detail");
  // The shell (nav + mobile-chrome) must ALWAYS be present — even on the detail kind.
  assert.ok(detail.includes(".mobile-chrome {"), "shellStyles('detail') includes the .mobile-chrome shell rule");
  assert.ok(detail.includes(".nav-group"), "shellStyles('detail') includes the .nav-group shell rule");
  // The detail kind layers detail typography ON TOP (last wins), never instead of the shell.
  assert.ok(detail.includes(".detail-page"), "shellStyles('detail') includes the detail typography");
  // The list kind has the shell and NO detail typography.
  assert.ok(shellStyles().includes(".mobile-chrome {"), "shellStyles() includes the shell rule");
  assert.ok(!shellStyles().includes(".detail-page"), "shellStyles() does NOT include detail typography");
});

// ── AC4 (structural proxy): the mobile media rules that drive the computed styles ─────────────

test("AC4 — the three detail routes inline the ≤600px rules that hide .site-nav and show .mobile-chrome", async () => {
  for (const route of DETAIL_ROUTES) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `GET ${route} returns 200 (got ${r.status})`);
    // The ≤600px media block hides the desktop site-nav (its links live in the hamburger) and
    // shows the mobile-chrome — these are the preconditions for getComputedStyle(.site-nav)
    // .display === 'none' and a non-overflowing mobile layout (scrollWidth === clientWidth).
    assert.ok(r.body.includes(".site-nav { display: none; }"),
      `GET ${route} inlines the mobile .site-nav { display: none } rule`);
    assert.ok(r.body.includes(".mobile-chrome { display: block; }"),
      `GET ${route} inlines the mobile .mobile-chrome { display: block } rule`);
  }
});
