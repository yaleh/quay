// @test-group product
// AC96 (gap-ac96-webui-responsive-two-form) — the web UI's true two-form responsive:
// a mobile (≤600px) hamburger-header + full-screen nav menu (the sc-if isMobile /
// mobileMenuOpen form, done with a checkbox toggle so the zero-client-JS AC4
// invariant holds) and a chip/pill label nav that is a single-row horizontal scroll
// on mobile but wraps on desktop — so the 375×812 first screen shows the task
// table's first row. Also fixes the audit bug where an inline `white-space:normal`
// override fought `.label-nav-wrap`'s `white-space:nowrap`, and the invalid-HTML
// bug where a <details> inside a <p class="meta"> made the HTML parser break the <p>
// open and stack the label expandable onto its own line (a 2-block label nav).
//
// The AC96 judge is a REAL browser screenshot (375×812 and 1440×900), which this
// browser-less suite cannot run. What it CAN assert mechanically, forever:
//   ① the mobile chrome + chip label-nav markup is emitted (AC1's structural basis);
//   ② the CSS preconditions that make the screenshot pass exist and are token-derived
//     (desktop hides the mobile chrome; mobile flips it on; label nav wraps on desktop
//     and is a single-row scroll on mobile; the desktop site-nav is hidden on mobile);
//   ③ the white-space:normal inline override is gone (AC3) and the <details> is a flex
//     CHILD of .label-nav-wrap, not a <p>-nested element (the invalid-HTML fix);
//   ④ AC102 is preserved: the list response still inlines the Modernist token sheet and
//     serve-handlers.ts still carries zero hardcoded hex.
//
// The browser-measured evidence (firstRow top at 375×812 and the desktop form) is
// recorded in the task file's Evidence section.
//
// Run (scoped): node --test packages/quay/test/serve-ac96-responsive-two-form.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { pageStyles, renderMobileChrome } from "../src/serve-handlers.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
// gap-serve-handlers-split-by-concern: the rendering code (pageStyles + verdict classes) moved to
// serve-render.ts; the AC102-preserved zero-hex + token-derived invariant now pins that file.
const SERVE_RENDER = path.join(__dirname, "..", "src", "serve-render.ts");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** One task body with the four artifacts + a label, so the label nav renders. */
function taskBody(id, label) {
  return `---\nid: ${id}\ntitle: "${id} fixture"\ntodo: false\nstatus: todo\nlabels:\n  - ${label}\n  - shared\n---\n\n## Proposal\na sufficiently long proposal body for the author gate\n## Plan\na sufficiently long plan body for the author gate\n## Acceptance Criteria\n- [ ] a sufficiently long acceptance criterion\n## Definition of Done\n- [x] a sufficiently long definition-of-done line\n`;
}

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = makeTmpDir("ac96-serve-tasks-");
  workspaceRoot = makeTmpDir("ac96-serve-ws-");
  // Seed enough labels that the "… N more labels" <details> expandable renders
  // (LABEL_NAV_MAX = 25), which is the element that used to be invalid-HTML-nested
  // inside the <p> and must now be a flex child of .label-nav-wrap.
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(tasksDir, `AC96-${i}.md`), taskBody(`AC96-${i}`, `label-${i}`));
  }
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac96 fixture workspace\n");
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

test("AC1 structural — the list page emits the mobile chrome (hamburger header + toggle + menu)", async () => {
  const r = await get(port, "/tasks");
  assert.equal(r.status, 200);
  // The mobile-only chrome is emitted before <main>.
  assert.ok(r.body.includes('class="mobile-chrome"'), "list page renders the mobile chrome wrapper");
  assert.ok(r.body.includes('class="mobile-menu-toggle-input"'), "mobile nav toggle checkbox is present");
  assert.ok(r.body.includes('class="mobile-header"'), "mobile hamburger header is present");
  assert.ok(r.body.includes('class="mobile-menu"'), "mobile full-screen menu is present");
  assert.ok(r.body.includes('class="mobile-menu-burger"'), "hamburger burger button is present");
  assert.ok(r.body.includes('class="mobile-header-title"') && r.body.includes('mobile-header-page'), "mobile header carries title + page label");
  // The mobile menu carries the full 15-view site nav (the "go anywhere" affordance).
  assert.ok(r.body.includes("Git History"), "mobile menu links to Git History");
  assert.ok(r.body.includes("Architecture"), "mobile menu links to Architecture");
});

test("AC1/AC2 — desktop site-nav is the .nav header bar tagged .site-nav; filter/sort are .list-nav; label nav is chips", async () => {
  const r = await get(port, "/tasks");
  // gap-webui-nav-inconsistent-routes: the desktop nav is now the unified header bar
  // (<nav class="site-nav"> wrapping the .nav/.nav-brand strip — hidden on mobile), no longer
  // a <p class="meta site-nav"> text line.
  assert.ok(r.body.includes('<nav class="site-nav"'), "desktop nav is a <nav class=\"site-nav\"> header bar (hidden on mobile)");
  assert.ok(r.body.includes('class="nav-brand"'), "desktop nav carries the Quay .nav-brand");
  assert.ok(r.body.includes('class="nav-group"'), "desktop nav groups its items in .nav-group bars");
  assert.ok(r.body.includes('class="nav-badge"'), "desktop nav renders the Board NEW badge");
  assert.ok(!r.body.includes('class="meta site-nav"'), "the old <p class=\"meta site-nav\"> text nav line is gone");
  assert.ok(r.body.includes('class="meta list-nav"'), "filter line is tagged .list-nav");
  assert.ok(r.body.includes('class="meta list-nav"') && r.body.indexOf("Sort:") > -1, "sort line is tagged .list-nav");
  assert.ok(r.body.includes('<div class="label-nav-wrap"'), "label nav keeps its .label-nav-wrap container (QX-043 UQ-006)");
  assert.ok(r.body.includes('<span class="label-chip">'), "label nav items are chip/pill spans");
  assert.ok(r.body.includes('class="label-chip-label"'), "label nav carries the 'Label:' chip-label prefix");
});

test("AC3 — the inline white-space:normal override is gone (audit §1.4-3)", async () => {
  const r = await get(port, "/tasks");
  // The audit bug was an INLINE style attribute fighting .label-nav-wrap's nowrap:
  // <p class="meta" style="white-space:normal">. AC3 removes that inline override.
  // (A `white-space: normal` value inside the CSS sheet is legitimate and unrelated.)
  assert.ok(!r.body.includes('style="white-space:normal"'), "no inline white-space:normal override attribute in the list page");
  assert.ok(!r.body.includes('style="white-space: normal"'), "no inline white-space: normal override attribute in the list page");
  assert.ok(!r.body.includes("white-space:normal"), "no white-space:normal literal anywhere (AC3's exact string is gone)");
});

test("invalid-HTML fix — the … more-labels <details> is a flex child of .label-nav-wrap, not nested in a <p>", async () => {
  const r = await get(port, "/tasks");
  // The old buggy form wrapped the labelNav (including the <details>) inside
  // <p class="meta">Label: …</p>, which the HTML parser breaks open — stacking the
  // <details> onto its own line. AC96 renders each chip as a flex item directly in
  // the .label-nav-wrap flex container.
  assert.ok(!r.body.includes('<p class="meta">Label:'), "label nav is no longer a <p class=\"meta\">Label: wrapper");
  assert.ok(r.body.includes('<details class="label-chip label-chip-more">'), "the … N more labels <details> is itself a chip flex item");
  // The search-form-before-label-nav order (QX-043 UQ-030) must be preserved.
  const searchFormPos = r.body.indexOf('name="q"');
  const labelNavDivPos = r.body.indexOf('<div class="label-nav-wrap"');
  assert.ok(searchFormPos !== -1 && labelNavDivPos !== -1 && searchFormPos < labelNavDivPos, "search form appears before the label nav (QX-043 UQ-030)");
});

test("AC96 CSS — the two-form media-query preconditions are present and token-derived", () => {
  const css = pageStyles();
  // Desktop (base) form: the mobile chrome is hidden, label nav wraps.
  assert.ok(/\.mobile-chrome\s*\{\s*display:\s*none/.test(css), "base CSS hides the mobile chrome on desktop");
  assert.ok(/\.site-nav\s*\{\s*display:\s*block/.test(css), "base CSS shows the desktop site-nav");
  assert.ok(css.includes(".label-nav-wrap {") && /\.label-nav-wrap\s*\{[^}]*flex-wrap:\s*wrap/.test(css), "base .label-nav-wrap wraps chips on desktop");
  // Mobile (≤600px) form: chrome flips on, site-nav hides, label nav becomes a single-row scroll.
  assert.ok(css.includes("@media (max-width: 600px)"), "mobile media query present");
  const mobile = css.slice(css.indexOf("@media (max-width: 600px)"));
  assert.ok(/\.mobile-chrome\s*\{\s*display:\s*block/.test(mobile), "mobile form shows the mobile chrome");
  assert.ok(/\.site-nav\s*\{\s*display:\s*none/.test(mobile), "mobile form hides the desktop site-nav");
  assert.ok(/\.label-nav-wrap\s*\{\s*flex-wrap:\s*nowrap;\s*overflow-x:\s*auto/.test(mobile), "mobile label nav is a single-row horizontal scroll");
  assert.ok(/\.mobile-menu-toggle-input:checked\s*~\s*\.mobile-menu\s*\{\s*display:\s*block/.test(mobile), "checkbox :checked opens the mobile menu (zero JS)");
  assert.ok(css.includes(".label-chip {") && css.includes("border-radius: 999px"), "chip pill styling present");
});

test("renderMobileChrome — emits the zero-JS checkbox toggle + full 15-view nav", () => {
  const html = renderMobileChrome("tasks", "task list");
  assert.ok(html.includes('id="mobile-menu-toggle"'), "mobile toggle has a stable id");
  assert.ok(html.includes('type="checkbox"'), "toggle is a checkbox (CSS-only, zero client JS)");
  assert.ok(html.includes("Dashboard") && html.includes("Architecture"), "menu carries the full site nav");
  assert.ok(html.includes("task list"), "page label rendered");
});

test("AC102 preserved — list response inlines the Modernist token sheet and serve-handlers.ts stays zero-hex", async () => {
  const r = await get(port, "/tasks");
  assert.ok(r.body.includes("--color-bg"), "list page still inlines the Modernist token sheet (AC102 ①)");
  assert.ok(r.body.includes("var(--color-"), "list page uses var(--color-*) tokens");
  const src = fs.readFileSync(SERVE_RENDER, "utf8");
  const hex = src.match(/#[0-9a-fA-F]{6}/g) || [];
  assert.deepEqual(hex, [], `AC102 ②: serve-render.ts carries zero hardcoded hex (got ${hex.length}: ${hex.join(", ")})`);
  assert.ok(src.includes("color: var(--color-accent-700)"), "shared base verdict class stays token-derived");
});
