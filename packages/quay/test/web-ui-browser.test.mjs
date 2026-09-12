// @test-group product
// QC-001 (experiment 2, iteration 1): browser-automation verification of
// packages/quay's Web UI pages — GET / and GET /task/:id flows.
// QC-002 (experiment 2, iteration 2): historically extended browser-automation
// verification to the POST action trigger flow — the third reachable Web UI
// flow, completing web_ui_verification (0.5 → 1.0).
//
// NOTE (2026-08-06): the web action-buttons POST route and its form renders
// were REMOVED (gap-web-action-buttons-unused-route-and-open-redirect-delete).
// The QC-002 POST-action-trigger flow below is now historical only — the
// browser-automation observations it recorded are kept as the audit trail, but
// the committed file no longer mechanically guards the action button form or
// the POST /task/:id/action/:actionId route (those assertions were removed
// with the route).
//
// BROWSER-AUTOMATION VERIFICATION (playwright MCP, iteration 1, 2026-07-16):
// A live browser session was driven via playwright MCP tooling (the session-
// level capability — per §Core-scope constraint 1: "browser-automation tooling
// (chrome-devtools / playwright MCP)", never bare "MCP testing") against a
// real startServer() instance seeded with two tasks (QC-T1 status=todo,
// QC-T2 status=done). Observations recorded below, verbatim from the
// accessibility snapshot tool output:
//
// GET / (task list page):
//   - Page title: "Quay — quay-native"
//   - Heading: "Quay — task list (native provider)" [level=1]
//   - Table with columns: id, status, role, title
//   - Row for QC-T1: link "QC-T1" -> /task/QC-T1, "todo", "primitive",
//     "Browser test task one"
//   - Row for QC-T2: link "QC-T2" -> /task/QC-T2, "done", "primitive",
//     "Browser test task two (done)"
//
// GET /task/QC-T1 (todo — action button PRESENT):
//   - Page title: "QC-T1"
//   - Heading: "QC-T1: Browser test task one [todo]" [level=1]
//   - Back link: "← back to list" -> /
//   - Paragraph: "role: primitive · labels:"
//   - pre/generic block with task body text rendered
//   - Button "Advance" present (from provider.yml whenStatus: [todo, ready])
//
// GET /task/QC-T2 (done — action button ABSENT, negative control):
//   - Page title: "QC-T2"
//   - Heading: "QC-T2: Browser test task two (done) [done]" [level=1]
//   - Back link: "← back to list" -> /
//   - Paragraph: "role: primitive · labels:"
//   - pre/generic block with task body text rendered
//   - NO button element (done status has no matching whenStatus entry)
//
// GET /task/NONEXISTENT-999: HTTP status 404 (confirmed in browser navigation)
//
// BROWSER-AUTOMATION VERIFICATION (playwright MCP, iteration 2, 2026-07-16):
// QC-002 — POST action trigger flow (the third reachable flow). A live browser
// session was driven against a startServer() instance seeded with one task
// (ACT-1 status=todo) and with QUAY_ACTION_MOCK_LOG set to a temp file path.
//
// GET /task/ACT-1 (todo — before POST):
//   - Page URL: http://127.0.0.1:47210/task/ACT-1
//   - Page title: "ACT-1"
//   - Heading: "ACT-1: Action trigger test task [todo]" [level=1]
//   - Button "Advance" present [ref=f4e9]
//
// POST /task/ACT-1/action/advance (via clicking "Advance" button):
//   - Button clicked via playwright MCP `browser_click` on ref f4e9
//   - Browser followed 302 redirect → GET /task/ACT-1
//   - Final page URL: http://127.0.0.1:47210/task/ACT-1 (same as before)
//   - Final page title: "ACT-1" (unchanged)
//   - Accessibility snapshot after redirect: same detail page structure,
//     "Advance" button still present (task status not changed by action trigger)
//
// Mock log record written to /tmp/quay-act-mock.jsonl (verbatim):
//   {"channel":"task-ACT-1","payload":"Drive task ACT-1 forward one status
//    transition using its current status's Skill (see status_skill_map).",
//    "taskId":"ACT-1","status":"todo","skill":"quay:author",
//    "timestamp":"2026-07-16T16:41:00.405Z"}
//
// This confirms the POST action trigger:
//   1. Fires deliverTrigger() in mock mode when QUAY_ACTION_MOCK_LOG is set
//   2. Composes the correct channel ("task-<id>"), payload, taskId, status, skill
//   3. Responds with 302 redirect to /task/<id>
//   4. The browser follows the redirect and lands back on the detail page
//
// This committed test file, like QN-046's serve-browser-render.test.mjs,
// cannot itself invoke a real browser from within a plain `node test.mjs`
// process (no browser-automation npm dependency exists in this package,
// consistent with G5's "no framework" discipline; `npm ls playwright` in
// the workspace root returns empty). The live browser-automation run above
// IS this iteration's real, one-time verification (recorded permanently in
// experiments/quay-core-bootstrap/iterations/iteration-1.md and this header).
//
// What THIS committed file mechanically guards (re-runnable in CI without a
// browser): the structurally-detectable properties that any correct browser
// rendering depends on — page titles embedded in <title> tags, heading text
// in <h1> tags, table rows with the correct task data, the detail-page back
// link, the 404 for nonexistent tasks, and the list-page structural columns.
// A regression in serve.js that breaks these structural properties is caught
// here even in a browser-less CI run, just as QN-046 catches the charset
// regression mechanically.
//
// Scoped strictly to existing behavior per G5: no appearance or interactivity
// changes made to src/serve.js. Any gap found is filed as a separate QC-*
// task.
//
// Run: node test/web-ui-browser.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

async function main() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-web-ui-browser-test-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-web-ui-browser-workspace-"));
  // NOTE (2026-08-06): the web action-buttons POST route and its form renders were
  // removed (gap-web-action-buttons-unused-route-and-open-redirect-delete), so the
  // QC-002 POST /task/:id/action/:actionId trigger flow and the QUAY_ACTION_MOCK_LOG
  // setup this file previously exercised are gone. WUI-ACT remains as a plain todo
  // fixture used by the status-filter/sort/label/pagination assertions below. CLI-side
  // deliverTrigger() mock-mode behavior is still covered by action-mock-delivery.test.mjs
  // / serve-action-delivery.test.mjs.

  // Three tasks seeded for core UI tests, plus three for QW-004 sort tests,
  // plus three for QW-005 label filter tests, plus 25 for QW-007 pagination tests:
  // - WUI-1 (todo): detail-page rendering fixture
  // - WUI-2 (done): detail-page rendering fixture (done status)
  // - WUI-ACT (todo): extra todo fixture used by the status-filter / sort / label
  //   / pagination assertions (previously the POST action trigger fixture, QC-002).
  // - SORT-A (todo), SORT-B (done), SORT-C (ready): QW-004 sort verification tasks.
  //   Inserted in C, A, B order to test that sort overrides insertion order.
  // - LBL-1 (todo, labels:[alpha]), LBL-2 (done, labels:[beta]), LBL-3 (todo, labels:[alpha,beta]):
  //   QW-005 label filter verification tasks.
  // - ZPG-01..ZPG-25 (todo): QW-007 pagination verification tasks. Seeded LAST (after all
  //   other tasks) so WUI-*/SORT-*/LBL-* appear on page 1 in insertion-order mode. ZPG-
  //   prefix (Z > W alphabetically) ensures these sort to the end with ?sort=id. With 34
  //   total tasks and PAGE_SIZE=20, page 1 = first 20; page 2 = remaining 14 (ZPG-12..25).
  execFileSync("node", [nativeBin, "task", "create", "LBL-1", "--title", "Label test task 1 (alpha)",
    "--status", "todo", "--labels", "alpha", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "LBL-2", "--title", "Label test task 2 (beta)",
    "--status", "done", "--labels", "beta", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "LBL-3", "--title", "Label test task 3 (alpha+beta)",
    "--status", "todo", "--labels", "alpha,beta", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "SORT-C", "--title", "Sort test task C (ready)",
    "--status", "ready", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "SORT-A", "--title", "Sort test task A (todo)",
    "--status", "todo", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "SORT-B", "--title", "Sort test task B (done)",
    "--status", "done", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "WUI-1", "--title", "Web UI browser test task one",
    "--status", "todo", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "WUI-2", "--title", "Web UI browser test task two (done)",
    "--status", "done", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "WUI-ACT", "--title", "Web UI action trigger test task",
    "--status", "todo", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  // QW-008: seed parent/child tasks for frontmatter rendering tests.
  // PC-PARENT: compound task with children=[PC-CHILD]. PC-CHILD: task with parent=PC-PARENT.
  // Note: task create does not support --children; use task edit after creation to set children.
  execFileSync("node", [nativeBin, "task", "create", "PC-PARENT", "--title", "Parent task (compound)",
    "--status", "todo", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "PC-CHILD", "--title", "Child task (primitive)",
    "--status", "todo", "--parent", "PC-PARENT", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  // Set children on PC-PARENT after creation (task create doesn't support --children)
  execFileSync("node", [nativeBin, "task", "edit", "PC-PARENT", "--children", "PC-CHILD"], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  // QW-007: seed 25 pagination test tasks (ZPG-01..ZPG-25).
  // Seeded LAST so that in insertion-order (default, no sort), non-ZPG tasks appear on page 1.
  // ZPG- prefix sorts after W alphabetically — with ?sort=id and 36 total tasks (11 non-ZPG
  // + 25 ZPG): page 1 (20 tasks) = LBL-1..3 + PC-CHILD + PC-PARENT + SORT-A/B/C +
  // WUI-1/2/ACT + ZPG-01..ZPG-09; page 2 (16 tasks) = ZPG-10..ZPG-25.
  for (let i = 1; i <= 25; i++) {
    const padded = String(i).padStart(2, "0");
    execFileSync("node", [nativeBin, "task", "create", `ZPG-${padded}`, "--title", `Pagination test task ${padded}`,
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
  }

  // Workspace config wiring — same pattern as serve.test.mjs (QN-031) and
  // serve-browser-render.test.mjs (QN-046): serve.js's loadConfig() does a
  // cwd-relative upward search, so we chdir into an isolated workspace whose
  // .quay/config.yml points at the ephemeral tasks dir.
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );

  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // ── GET /tasks (task list page) — `/` is now the dashboard landing page ──
    // Browser-rendered observation (playwright MCP, iteration 1):
    //   Page title: "Quay — quay-native"
    //   Heading h1: "Quay — task list (native provider)"
    //   Table rows: WUI-1 (todo) and WUI-2 (done) as linked cells
    const list = await get(port, "/tasks");
    assert(list.status === 200, `GET /tasks returns 200 (got ${list.status})`);

    // Page title: the <title> tag carries the PROJECT IDENTITY (the workspace root's basename) —
    // gap-web-ui-pages-carry-no-host-project-identity changed this contract. It used to be
    // "Quay — <manifest.name>", i.e. the product brand plus the PROVIDER's name ("quay-native"),
    // which is the same string in every workspace using the native provider — so two quay webs
    // open at once rendered identical tab labels. The project label is now the workspace root's
    // own basename, which is what makes the two distinguishable; the provider name still appears
    // in the page's <meta name="description"> and in the <h1>.
    // The assertion is written so it holds in BOTH label regimes: a basename at or under the
    // 32-char budget renders verbatim, a longer one renders truncated-with-a-digest (this temp
    // workspace's own name is 36 chars, so it takes the second path). What is pinned either way is
    // the property that matters: the prefix is DERIVED FROM THIS WORKSPACE'S ROOT (a generic
    // "Dashboard"/"Quay"/"quay-native" prefix fails the `base.startsWith(head)` check) and the
    // page token survives intact at the end.
    const pageTitleTag = /<title>([^<]*)<\/title>/.exec(list.body)?.[1] ?? "";
    assert(pageTitleTag.endsWith(" — Tasks"),
      `GET /tasks <title> ends with the page token " — Tasks" — got: ${pageTitleTag}`);
    const base = path.basename(workspaceRoot);
    const label = pageTitleTag.slice(0, pageTitleTag.lastIndexOf(" — Tasks"));
    const head = label.includes("…") ? label.slice(0, label.indexOf("…")) : label;
    assert(head.length > 0 && base.startsWith(head),
      `GET /tasks <title>'s project label is derived from this workspace root (${base}) — label head: "${head}"`);

    // Heading: the <h1> tag confirms the "task list" label and provider id.
    assert(/<h1>[^<]*task list[^<]*<\/h1>/i.test(list.body),
      'GET /tasks <h1> heading contains "task list" text (browser-observed: "Quay — task list (native provider)")');

    // Table structure: both tasks appear as linked rows.
    assert(list.body.includes("WUI-1") && list.body.includes("WUI-2"),
      "GET /tasks body contains both seeded task ids (WUI-1, WUI-2)");
    assert(list.body.includes("todo") && list.body.includes("done"),
      "GET /tasks body contains both seeded tasks' statuses (todo, done)");
    assert(list.body.includes("Web UI browser test task one"),
      "GET /tasks body contains seeded WUI-1 title");
    assert(list.body.includes("Web UI browser test task two"),
      "GET /tasks body contains seeded WUI-2 title");

    // Links: task ids are clickable links to detail pages (browser-observed:
    // link "WUI-1" -> /task/WUI-1, link "WUI-2" -> /task/WUI-2).
    // QX-011 (iteration 3): links now include ?from= for back-link context preservation.
    // Check that /task/WUI-1 appears somewhere in the href (may have ?from= appended).
    assert(list.body.includes('href="/task/WUI-1'),
      'GET /tasks body contains link href starting with "/task/WUI-1" (task id is a clickable link, QX-011 may add ?from=)');
    assert(list.body.includes('href="/task/WUI-2'),
      'GET /tasks body contains link href starting with "/task/WUI-2" (task id is a clickable link, QX-011 may add ?from=)');

    // ── GET /task/:id (detail page — todo) ────────────────────────────────
    // Browser-rendered observation (playwright MCP, iteration 1):
    //   Page title: "WUI-1"
    //   Heading h1: "WUI-1: Web UI browser test task one [todo]"
    //   Back link: "← back to list" -> /
    //   Paragraph: "role: primitive · labels:"
    // NOTE (2026-08-06): the "Advance" action button was removed from the detail
    // page with the web action-buttons route
    // (gap-web-action-buttons-unused-route-and-open-redirect-delete), so the
    // button-presence/absence assertions that lived here are gone.
    const detail1 = await get(port, "/task/WUI-1");
    assert(detail1.status === 200, `GET /task/WUI-1 returns 200 (got ${detail1.status})`);

    // Page title: the task's own id (browser-observed: "WUI-1").
    assert(/<title>WUI-1<\/title>/.test(detail1.body),
      "GET /task/WUI-1 <title> tag is the task id (WUI-1)");

    // Heading: id, title, and status in brackets (browser-observed:
    // "WUI-1: Web UI browser test task one [todo]").
    assert(detail1.body.includes("WUI-1") && detail1.body.includes("[todo]"),
      'GET /task/WUI-1 <h1> heading contains task id and [todo] status bracket');
    assert(detail1.body.includes("Web UI browser test task one"),
      "GET /task/WUI-1 heading includes the task's title");

    // Back link to list (browser-observed: "← back to list" -> /tasks).
    assert(detail1.body.includes('href="/tasks'),
      'GET /task/WUI-1 body contains href="/tasks" back-to-list link');

    // Role/labels paragraph (browser-observed: "role: primitive · labels:").
    assert(detail1.body.includes("role:") && detail1.body.includes("primitive"),
      'GET /task/WUI-1 body contains role paragraph with "primitive" role');

    // ── GET /task/:id (detail page — done) ────────────────────────────────
    // Browser-rendered observation (playwright MCP, iteration 1):
    //   Page title: "WUI-2"
    //   Heading h1: "WUI-2: Web UI browser test task two (done) [done]"
    //   Back link: "← back to list" -> /
    const detail2 = await get(port, "/task/WUI-2");
    assert(detail2.status === 200, `GET /task/WUI-2 returns 200 (got ${detail2.status})`);

    assert(/<title>WUI-2<\/title>/.test(detail2.body),
      "GET /task/WUI-2 <title> tag is the task id (WUI-2)");
    assert(detail2.body.includes("[done]"),
      "GET /task/WUI-2 heading includes [done] status bracket");
    assert(detail2.body.includes('href="/tasks'),
      'GET /task/WUI-2 body contains href="/tasks" back-to-list link');

    // ── GET /task/:id (nonexistent id — 404) ──────────────────────────────
    // Browser-observed (playwright MCP, iteration 1): HTTP 404 Not Found.
    const notFound = await get(port, "/task/NONEXISTENT-999");
    assert(notFound.status === 404, `GET /task/NONEXISTENT-999 returns 404 (got ${notFound.status})`);

    // ── Content-Type charset (belt-and-suspenders alongside QN-046) ───────
    // QN-046 already guards this regression mechanically; confirmed again
    // here so this file is a complete standalone regression guard.
    assert(/charset=utf-8/i.test(list.headers["content-type"] || ""),
      `GET / Content-Type declares charset=utf-8 (got "${list.headers["content-type"]}")`);
    assert(/charset=utf-8/i.test(detail1.headers["content-type"] || ""),
      `GET /task/WUI-1 Content-Type declares charset=utf-8 (got "${detail1.headers["content-type"]}")`);

    // ── QW-001: CSS styling system assertions ────────────────────────────
    // QW-001 (experiment 3, iteration 1): verify the pageStyles() CSS system
    // is applied to both list and detail pages, and that the table no longer
    // uses the raw border="1" attribute.

    // <style> tag present in list page (CSS system applied)
    assert(list.body.includes("<style>"),
      "GET / <head> includes <style> tag (QW-001: CSS styling system)");

    // <style> tag present in detail page
    assert(detail1.body.includes("<style>"),
      "GET /task/WUI-1 <head> includes <style> tag (QW-001: CSS styling system)");

    // Table no longer uses HTML border attribute (replaced by CSS)
    assert(!list.body.includes('border="1"'),
      "GET / table does not use border=\"1\" attribute (QW-001: CSS replaces inline styling)");

    // <main> wrapper present in list page (semantic structure; may carry id="main" — the
    // skip-link target added by gap-webui-a11y-focus-ring-and-token-contrast-unvalidated).
    assert(/<main[\s>]/.test(list.body),
      "GET / body includes <main> wrapper element (QW-001: semantic structure)");

    // <main> wrapper present in detail page
    assert(/<main[\s>]/.test(detail1.body),
      "GET /task/WUI-1 body includes <main> wrapper element (QW-001: semantic structure)");

    // <nav> element wraps back link in detail page (semantic structure)
    assert(detail1.body.includes("<nav>"),
      "GET /task/WUI-1 body includes <nav> element wrapping back link (QW-001: semantic structure)");

    // viewport meta tag present (required for Lighthouse best-practices ≥ 90)
    assert(list.body.includes('name="viewport"'),
      'GET / <head> includes viewport meta tag (QW-001: Lighthouse best-practices prerequisite)');
    assert(detail1.body.includes('name="viewport"'),
      'GET /task/WUI-1 <head> includes viewport meta tag (QW-001: Lighthouse best-practices prerequisite)');

    // lang attribute on <html> (accessibility)
    assert(list.body.includes('<html lang="en">'),
      'GET / <html> has lang="en" attribute (QW-001: accessibility)');
    assert(detail1.body.includes('<html lang="en">'),
      'GET /task/WUI-1 <html> has lang="en" attribute (QW-001: accessibility)');

    // ── QW-002: rendered markdown body assertions ─────────────────────────
    // QW-002 (experiment 3, iteration 1): verify the task detail page renders
    // the body using renderMarkdown() instead of a bare <pre> block. The
    // VALID_SECTIONS fixture body contains "## Proposal" etc. — these should
    // appear as <h3> elements in the output (## = 2 hashes → h3, since h1
    // is reserved for the page title).

    // Body is inside a .body div (not bare <pre> at top level)
    assert(detail1.body.includes('<div class="body">'),
      'GET /task/WUI-1 body contains <div class="body"> wrapper (QW-002: renderMarkdown() used)');

    // "## Proposal" heading rendered as <h3>Proposal</h3>
    assert(detail1.body.includes("<h3>Proposal</h3>"),
      "GET /task/WUI-1 body: ## Proposal rendered as <h3>Proposal</h3> (QW-002: rendered markdown)");

    // "## Plan" heading rendered as <h3>Plan</h3>
    assert(detail1.body.includes("<h3>Plan</h3>"),
      "GET /task/WUI-1 body: ## Plan rendered as <h3>Plan</h3> (QW-002: rendered markdown)");

    // List items from "- [x] ..." appear as <li> elements. Matches the "<li" tag-open prefix
    // (not the exact "<li>" substring): DIR-025/M41 added task-list-checkbox rendering, so a
    // checkbox item is `<li class="task-list-item">`, not a bare `<li>` — and VALID_SECTIONS'
    // AC/DoD lines are all "- [x] ..." checkbox items, so the exact "<li>" substring never
    // actually appears here even though list rendering is working correctly.
    assert(detail1.body.includes("<li"),
      "GET /task/WUI-1 body: list items rendered as <li> elements (QW-002: rendered markdown)");

    // No bare top-level <pre> wrapping the entire body text
    // (the body text should NOT start with "<pre>" as it did before QW-002)
    assert(!detail1.body.match(/<div class="body"><pre>/),
      "GET /task/WUI-1 body: no bare <pre> wrapping the entire body (QW-002: markdown rendered)");

    // ── QW-003: filter-by-status assertions ─────────────────────────────
    // QW-003 (experiment 3, iteration 2): verify the ?status=<value> filter
    // query param in GET /tasks. Three tasks are seeded: WUI-1 (todo), WUI-2 (done),
    // WUI-ACT (todo). Filter navigation links must be present in GET /tasks.

    // GET /tasks (no param) — all tasks visible (baseline, re-verified)
    assert(list.body.includes("WUI-1") && list.body.includes("WUI-2") && list.body.includes("WUI-ACT"),
      "GET /tasks (no param) shows all three seeded tasks (QW-003: unfiltered baseline)");

    // Filter nav is present in the list page
    assert(list.body.includes("/tasks?status=todo") || list.body.includes("/tasks?status=done"),
      "GET /tasks body includes filter navigation links for status values (QW-003: filter nav)");

    // GET /?status=todo — only todo tasks (WUI-1, WUI-ACT); done task (WUI-2) excluded
    const listTodo = await get(port, "/tasks?status=todo");
    assert(listTodo.status === 200, `GET /?status=todo returns 200 (got ${listTodo.status})`);
    assert(listTodo.body.includes("WUI-1"),
      "GET /?status=todo includes WUI-1 (todo task) (QW-003: filter includes matching)");
    assert(listTodo.body.includes("WUI-ACT"),
      "GET /?status=todo includes WUI-ACT (todo task) (QW-003: filter includes matching)");
    assert(!listTodo.body.includes("WUI-2"),
      "GET /?status=todo excludes WUI-2 (done task) (QW-003: filter excludes non-matching)");

    // GET /?status=done — only done tasks (WUI-2); todo tasks (WUI-1, WUI-ACT) excluded
    const listDone = await get(port, "/tasks?status=done");
    assert(listDone.status === 200, `GET /?status=done returns 200 (got ${listDone.status})`);
    assert(listDone.body.includes("WUI-2"),
      "GET /?status=done includes WUI-2 (done task) (QW-003: filter includes matching)");
    assert(!listDone.body.includes("WUI-1"),
      "GET /?status=done excludes WUI-1 (todo task) (QW-003: filter excludes non-matching)");
    assert(!listDone.body.includes("WUI-ACT"),
      "GET /?status=done excludes WUI-ACT (todo task) (QW-003: filter excludes non-matching)");

    // GET /?status=ready — returns only SORT-C (the one ready task in fixture)
    const listReady = await get(port, "/tasks?status=ready");
    assert(listReady.status === 200, `GET /?status=ready returns 200 (got ${listReady.status})`);
    assert(!listReady.body.includes("WUI-1") && !listReady.body.includes("WUI-2"),
      "GET /?status=ready excludes WUI-1/WUI-2 (todo/done) (QW-003: filter excludes non-matching)");
    assert(listReady.body.includes("SORT-C"),
      "GET /?status=ready includes SORT-C (ready task) (QW-003: filter includes matching)");

    // ── QW-004: sort-by-id and sort-by-status assertions ────────────────────
    // QW-004 (experiment 3, iteration 3): verify ?sort=id and ?sort=status query
    // params in GET /. Three tasks seeded in C, A, B order (non-alphabetical
    // insertion) to prove sort overrides insertion order:
    //   SORT-A (todo), SORT-B (done), SORT-C (ready) — inserted as C, A, B.

    // Sort nav is present in the list page (check for sort links)
    assert(list.body.includes("/tasks?sort=id") || list.body.includes("sort=id"),
      "GET / body includes sort navigation link for sort=id (QW-004: sort nav)");
    assert(list.body.includes("/tasks?sort=status") || list.body.includes("sort=status"),
      "GET / body includes sort navigation link for sort=status (QW-004: sort nav)");

    // GET /?sort=id — tasks sorted alphabetically by id (SORT-A before SORT-B before SORT-C)
    const listSortId = await get(port, "/tasks?sort=id");
    assert(listSortId.status === 200, `GET /?sort=id returns 200 (got ${listSortId.status})`);
    assert(listSortId.body.includes("SORT-A") && listSortId.body.includes("SORT-B") && listSortId.body.includes("SORT-C"),
      "GET /?sort=id includes all three SORT-* tasks (QW-004: sort=id returns all tasks)");
    // Verify SORT-A appears before SORT-B in HTML output (index comparison)
    assert(listSortId.body.indexOf("SORT-A") < listSortId.body.indexOf("SORT-B"),
      "GET /?sort=id: SORT-A appears before SORT-B (alphabetical by id) (QW-004: sort=id order)");
    assert(listSortId.body.indexOf("SORT-B") < listSortId.body.indexOf("SORT-C"),
      "GET /?sort=id: SORT-B appears before SORT-C (alphabetical by id) (QW-004: sort=id order)");

    // GET /?sort=status — tasks sorted alphabetically by status (done, ready, todo)
    // then by id as tiebreaker. Expected order: SORT-B(done), SORT-C(ready), SORT-A(todo).
    const listSortStatus = await get(port, "/tasks?sort=status");
    assert(listSortStatus.status === 200, `GET /?sort=status returns 200 (got ${listSortStatus.status})`);
    assert(listSortStatus.body.includes("SORT-A") && listSortStatus.body.includes("SORT-B") && listSortStatus.body.includes("SORT-C"),
      "GET /?sort=status includes all three SORT-* tasks (QW-004: sort=status returns all tasks)");
    // done < ready < todo alphabetically, so SORT-B(done) first, SORT-C(ready) second, SORT-A(todo) third
    assert(listSortStatus.body.indexOf("SORT-B") < listSortStatus.body.indexOf("SORT-C"),
      "GET /?sort=status: SORT-B(done) appears before SORT-C(ready) (QW-004: sort=status order)");
    assert(listSortStatus.body.indexOf("SORT-C") < listSortStatus.body.indexOf("SORT-A"),
      "GET /?sort=status: SORT-C(ready) appears before SORT-A(todo) (QW-004: sort=status order)");

    // GET /?status=todo&sort=id — filter first (only todo tasks), then sort by id.
    // Fixture todo tasks: WUI-1, WUI-ACT, SORT-A. Sorted: SORT-A, WUI-1, WUI-ACT.
    const listStatusTodoSortId = await get(port, "/tasks?status=todo&sort=id");
    assert(listStatusTodoSortId.status === 200, `GET /?status=todo&sort=id returns 200 (got ${listStatusTodoSortId.status})`);
    assert(!listStatusTodoSortId.body.includes("SORT-B") && !listStatusTodoSortId.body.includes("SORT-C"),
      "GET /?status=todo&sort=id excludes done/ready tasks (QW-004: combined filter+sort)");
    assert(listStatusTodoSortId.body.includes("SORT-A") && listStatusTodoSortId.body.includes("WUI-1"),
      "GET /?status=todo&sort=id includes todo tasks SORT-A and WUI-1 (QW-004: combined filter+sort)");
    // SORT-A < WUI-1 alphabetically (S < W)
    assert(listStatusTodoSortId.body.indexOf("SORT-A") < listStatusTodoSortId.body.indexOf("WUI-1"),
      "GET /?status=todo&sort=id: SORT-A appears before WUI-1 (alphabetical, S<W) (QW-004: combined sort)");

    // Sort nav links preserve the active status filter in their href
    // When ?status=todo is active, sort links should include status=todo in href
    const listTodoForSortNav = await get(port, "/tasks?status=todo");
    assert(listTodoForSortNav.body.includes("status=todo") && listTodoForSortNav.body.includes("sort=id"),
      "GET /?status=todo sort nav links preserve status=todo filter in sort hrefs (QW-004: sortNav href)");

    // ── QW-005: filter-by-label assertions ──────────────────────────────────
    // QW-005 (experiment 3, iteration 3): verify ?label=<value> filter in GET /.
    // Three label tasks seeded: LBL-1 (labels:[alpha]), LBL-2 (labels:[beta]),
    // LBL-3 (labels:[alpha, beta]).

    // Label nav is present in the list page (check for label links, since some tasks have labels)
    assert(list.body.includes("label=alpha") || list.body.includes("Label:"),
      "GET / body includes label navigation (QW-005: label nav present when tasks have labels)");

    // GET /?label=alpha — includes LBL-1 (alpha) and LBL-3 (alpha+beta); excludes LBL-2 (beta only)
    const listLabelAlpha = await get(port, "/tasks?label=alpha");
    assert(listLabelAlpha.status === 200, `GET /?label=alpha returns 200 (got ${listLabelAlpha.status})`);
    assert(listLabelAlpha.body.includes("LBL-1"),
      "GET /?label=alpha includes LBL-1 (has label alpha) (QW-005: label filter includes matching)");
    assert(listLabelAlpha.body.includes("LBL-3"),
      "GET /?label=alpha includes LBL-3 (has labels alpha+beta) (QW-005: label filter includes matching)");
    assert(!listLabelAlpha.body.includes("LBL-2"),
      "GET /?label=alpha excludes LBL-2 (has label beta only) (QW-005: label filter excludes non-matching)");

    // GET /?label=beta — includes LBL-2 (beta) and LBL-3 (alpha+beta); excludes LBL-1 (alpha only)
    const listLabelBeta = await get(port, "/tasks?label=beta");
    assert(listLabelBeta.status === 200, `GET /?label=beta returns 200 (got ${listLabelBeta.status})`);
    assert(listLabelBeta.body.includes("LBL-2"),
      "GET /?label=beta includes LBL-2 (has label beta) (QW-005: label filter includes matching)");
    assert(listLabelBeta.body.includes("LBL-3"),
      "GET /?label=beta includes LBL-3 (has labels alpha+beta) (QW-005: label filter includes matching)");
    assert(!listLabelBeta.body.includes("LBL-1"),
      "GET /?label=beta excludes LBL-1 (has label alpha only) (QW-005: label filter excludes non-matching)");

    // GET /?label=gamma — no task has label 'gamma': returns empty for label tasks
    const listLabelGamma = await get(port, "/tasks?label=gamma");
    assert(listLabelGamma.status === 200, `GET /?label=gamma returns 200 (got ${listLabelGamma.status})`);
    assert(!listLabelGamma.body.includes("LBL-1") && !listLabelGamma.body.includes("LBL-2") && !listLabelGamma.body.includes("LBL-3"),
      "GET /?label=gamma returns no LBL-* tasks (unknown label → empty result) (QW-005: unknown label not an error)");

    // GET /?status=todo&label=alpha — filter by both status and label.
    // LBL-1 (todo, alpha) → included; LBL-3 (todo, alpha+beta) → included;
    // LBL-2 (done, beta) → excluded by status filter; WUI-1/WUI-ACT (todo, no labels) → excluded by label filter.
    const listStatusTodoLabelAlpha = await get(port, "/tasks?status=todo&label=alpha");
    assert(listStatusTodoLabelAlpha.status === 200, `GET /?status=todo&label=alpha returns 200 (got ${listStatusTodoLabelAlpha.status})`);
    assert(listStatusTodoLabelAlpha.body.includes("LBL-1"),
      "GET /?status=todo&label=alpha includes LBL-1 (todo, alpha) (QW-005: combined status+label filter)");
    assert(listStatusTodoLabelAlpha.body.includes("LBL-3"),
      "GET /?status=todo&label=alpha includes LBL-3 (todo, alpha+beta) (QW-005: combined status+label filter)");
    assert(!listStatusTodoLabelAlpha.body.includes("LBL-2"),
      "GET /?status=todo&label=alpha excludes LBL-2 (done, beta) (QW-005: combined status+label filter)");
    assert(!listStatusTodoLabelAlpha.body.includes("WUI-1"),
      "GET /?status=todo&label=alpha excludes WUI-1 (todo, no labels) (QW-005: label filter excludes no-label tasks)");

    // ── QW-006: heading-order fix and mobile CSS assertions ──────────────────
    // QW-006 (experiment 3, iteration 3): structural tests for heading-order
    // fix (.sr-only h2 before .body div on detail page) and mobile @media rule.

    // Detail page: h2.sr-only element present before .body div (heading-order fix)
    assert(detail1.body.includes('<h2 class="sr-only">Details</h2>'),
      'GET /task/WUI-1 detail page contains <h2 class="sr-only">Details</h2> before .body div (QW-006: heading-order fix)');

    // .sr-only CSS rule is defined in pageStyles (visually hidden heading)
    assert(list.body.includes(".sr-only"),
      'GET / pageStyles() includes .sr-only CSS rule (QW-006: visually hidden semantic heading)');

    // @media (max-width: 600px) responsive block is present in pageStyles
    assert(list.body.includes("@media") && list.body.includes("max-width"),
      'GET / pageStyles() includes @media (max-width) responsive CSS block (QW-006: mobile responsive layout / DIR-003)');

    // Mobile media query includes table display:block for horizontal scroll
    assert(list.body.includes("overflow-x: auto") || list.body.includes("overflow-x:auto"),
      'GET / pageStyles() includes overflow-x:auto in @media block for mobile table scrolling (QW-006: DIR-003)');

    // ── QW-009: labels column in list table assertions ───────────────────────
    // QW-009 (experiment 3, iteration 4): verify labels column in task list table.
    // LBL-1 has label 'alpha', LBL-2 has label 'beta', WUI-1 has no labels.

    // Table header includes 'labels' column
    // QX-012 (iteration 3): labels column <th> now has class="col-labels" for mobile hiding.
    assert(
      list.body.includes('<th class="col-labels">labels</th>') || list.body.includes("<th>labels</th>"),
      'GET / table header includes labels column th (QW-009: labels column header; QX-012 adds col-labels class)'
    );

    // LBL-1 (label 'alpha') appears on page 1 of default GET /.
    // Verify it appears in the table body (within td element) with its label value.
    const listAlphaPage = await get(port, "/tasks?label=alpha");
    // QX-012 (iteration 3): labels <td> now has class="col-labels". Check for label value within a td.
    assert(
      listAlphaPage.body.includes(">alpha<") || listAlphaPage.body.includes("col-labels"),
      "GET /?label=alpha task rows show 'alpha' label in labels column (QW-009; QX-012 adds col-labels class)"
    );

    // WUI-1 has no labels — its row should have an empty labels td (column present)
    // GET /?status=todo&sort=id shows WUI-1 on page 1 (before ZPG-* tasks)
    const listTodoForLabels = await get(port, "/tasks?status=todo&sort=id");
    // WUI-1 appears with empty labels td (between title and </tr>)
    assert(listTodoForLabels.body.includes("WUI-1"),
      "GET /?status=todo&sort=id includes WUI-1 (QW-009: labelscolumn fixture sanity)");
    // The labels column header is present in this filtered view too
    // QX-012: th now has class="col-labels"
    assert(
      listTodoForLabels.body.includes('class="col-labels"') || listTodoForLabels.body.includes("<th>labels</th>"),
      "GET /?status=todo table header still includes labels column (QW-009: labels column persists across filters; QX-012 adds class)"
    );

    // ── QW-008: parent/children frontmatter rendering assertions ────────────
    // QW-008 (experiment 3, iteration 4): verify parent and children links in detail page.
    // PC-PARENT has children=[PC-CHILD]; PC-CHILD has parent=PC-PARENT.

    // PC-CHILD detail page: must show parent link to PC-PARENT
    const detailPcChild = await get(port, "/task/PC-CHILD");
    assert(detailPcChild.status === 200, `GET /task/PC-CHILD returns 200 (got ${detailPcChild.status})`);
    assert(detailPcChild.body.includes('href="/task/PC-PARENT"'),
      'GET /task/PC-CHILD detail page contains parent link href="/task/PC-PARENT" (QW-008: parent link rendered)');
    assert(detailPcChild.body.includes("PC-PARENT"),
      "GET /task/PC-CHILD detail page shows parent id PC-PARENT in meta (QW-008: parent id text)");

    // PC-PARENT detail page: must show children list with link to PC-CHILD
    const detailPcParent = await get(port, "/task/PC-PARENT");
    assert(detailPcParent.status === 200, `GET /task/PC-PARENT returns 200 (got ${detailPcParent.status})`);
    assert(detailPcParent.body.includes('href="/task/PC-CHILD"'),
      'GET /task/PC-PARENT detail page contains child link href="/task/PC-CHILD" (QW-008: children links rendered)');
    assert(detailPcParent.body.includes("PC-CHILD"),
      "GET /task/PC-PARENT detail page shows child id PC-CHILD in meta (QW-008: children id text)");

    // Negative controls: WUI-1 (no parent, no children) — neither field shown
    assert(!detail1.body.includes("parent:"),
      "GET /task/WUI-1 detail page does NOT show parent field (no parent set) (QW-008: negative control)");
    assert(!detail1.body.includes("children:"),
      "GET /task/WUI-1 detail page does NOT show children field (no children) (QW-008: negative control)");

    // ── QW-007: pagination assertions ───────────────────────────────────────
    // QW-007 (experiment 3, iteration 4): verify ?page=N pagination with PAGE_SIZE=20.
    // Total fixture: 36 tasks (LBL-1..3, PC-CHILD, PC-PARENT, SORT-A/B/C, WUI-1/2/ACT, ZPG-01..ZPG-25).
    // With ?sort=id (alphabetical): 11 non-ZPG tasks + ZPG-01..ZPG-09 = 20 on page 1.
    // Page 2 = ZPG-10..ZPG-25 (16 tasks). ZPG-09 is the last ZPG task on page 1.

    // GET /?sort=id — page 1 (default): includes ZPG-01 (first ZPG), includes ZPG-09 (last on p1),
    // excludes ZPG-10 (first on page 2), excludes ZPG-25 (last task overall).
    const listPage1SortId = await get(port, "/tasks?sort=id");
    assert(listPage1SortId.status === 200, `GET /?sort=id returns 200 for pagination test (got ${listPage1SortId.status})`);
    assert(listPage1SortId.body.includes("ZPG-01"),
      "GET /?sort=id page 1 includes ZPG-01 (first ZPG task on page 1) (QW-007: pagination first page)");
    assert(listPage1SortId.body.includes("ZPG-09"),
      "GET /?sort=id page 1 includes ZPG-09 (last ZPG task on page 1) (QW-007: pagination first page boundary)");
    assert(!listPage1SortId.body.includes("ZPG-10"),
      "GET /?sort=id page 1 excludes ZPG-10 (first task on page 2) (QW-007: pagination excludes page 2 tasks)");
    assert(!listPage1SortId.body.includes("ZPG-25"),
      "GET /?sort=id page 1 excludes ZPG-25 (last task on page 2) (QW-007: pagination excludes page 2 tasks)");

    // GET /?sort=id&page=2 — page 2: shows ZPG-10..ZPG-25, NOT ZPG-01..ZPG-09
    const listPage2SortId = await get(port, "/tasks?sort=id&page=2");
    assert(listPage2SortId.status === 200, `GET /?sort=id&page=2 returns 200 (got ${listPage2SortId.status})`);
    assert(listPage2SortId.body.includes("ZPG-10"),
      "GET /?sort=id&page=2 includes ZPG-10 (first task on page 2) (QW-007: pagination second page)");
    assert(listPage2SortId.body.includes("ZPG-25"),
      "GET /?sort=id&page=2 includes ZPG-25 (last task on page 2) (QW-007: pagination second page boundary)");
    assert(!listPage2SortId.body.includes("ZPG-01"),
      "GET /?sort=id&page=2 excludes ZPG-01 (first ZPG task on page 1) (QW-007: pagination excludes page 1 tasks)");
    assert(!listPage2SortId.body.includes("ZPG-09"),
      "GET /?sort=id&page=2 excludes ZPG-09 (last ZPG task on page 1) (QW-007: pagination excludes page 1 tasks)");

    // Page navigation links present when multiple pages exist
    assert(listPage1SortId.body.includes("page=2") || listPage1SortId.body.includes("Next"),
      "GET /?sort=id page 1 contains page navigation to page 2 (QW-007: page nav present)");
    assert(listPage2SortId.body.includes("page=1") || listPage2SortId.body.includes("Previous") || listPage2SortId.body.includes("laquo"),
      "GET /?sort=id&page=2 contains page navigation back (QW-007: page nav present)");

    // Page info present in response
    assert(listPage1SortId.body.includes("Page 1") || listPage1SortId.body.includes("page 1"),
      "GET /?sort=id page 1 contains 'Page 1' info text (QW-007: page info rendered)");

    // GET /?sort=id&page=1 and GET /?sort=id are equivalent (page=1 is the default)
    const listPage1Explicit = await get(port, "/tasks?sort=id&page=1");
    assert(listPage1Explicit.body.includes("ZPG-01") && !listPage1Explicit.body.includes("ZPG-10"),
      "GET /?sort=id&page=1 is equivalent to page 1 default (ZPG-01 in, ZPG-10 out) (QW-007: explicit page=1 matches default)");

    // Pagination interacts with filters: GET /?sort=id&status=todo&page=2 paginates filtered tasks
    // All ZPG-* tasks are todo. With ?status=todo&sort=id: todo tasks = LBL-1,LBL-3,SORT-A,
    // WUI-1,WUI-ACT,ZPG-01..ZPG-25 (total 30). Page 2 (tasks 21-30) = ZPG-16..ZPG-25.
    const listFilteredPage2 = await get(port, "/tasks?sort=id&status=todo&page=2");
    assert(listFilteredPage2.status === 200, `GET /?sort=id&status=todo&page=2 returns 200 (got ${listFilteredPage2.status})`);
    // ZPG-16 is the 21st todo task (alphabetically: LBL-1, LBL-3, SORT-A, WUI-1, WUI-ACT, ZPG-01..ZPG-25
    // = 5 non-ZPG + 25 ZPG = 30 todo tasks; page 2 starts at task 21 = ZPG-16)
    assert(listFilteredPage2.body.includes("ZPG-"),
      "GET /?sort=id&status=todo&page=2 shows ZPG-* tasks on page 2 of filtered results (QW-007: filter+pagination)");
    assert(!listFilteredPage2.body.includes("LBL-1"),
      "GET /?sort=id&status=todo&page=2 excludes LBL-1 (page 1 task, not on page 2) (QW-007: filter+pagination)");

  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(originalCwd);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  console.log(failures === 0
    ? "\nAll QC-001/QC-002/QW-001/QW-002/QW-003/QW-004/QW-005/QW-006/QW-007/QW-008/QW-009 web-ui-browser regression tests passed."
    : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
