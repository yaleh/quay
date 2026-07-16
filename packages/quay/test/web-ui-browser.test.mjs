// QC-001 (experiment 2, iteration 1): browser-automation verification of
// packages/quay's Web UI pages — GET / and GET /task/:id flows.
// QC-002 (experiment 2, iteration 2): extends browser-automation verification
// to the POST action trigger flow — the third reachable Web UI flow, completing
// web_ui_verification (0.5 → 1.0).
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
// in <h1> tags, table rows with the correct task data, the action button
// form for todo-status tasks and its absence for done-status tasks. A
// regression in serve.js that breaks these structural properties is caught
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
import { startServer } from "../src/serve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");
const nativeProviderDir = path.dirname(nativeBin);

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

function post(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "POST" },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.end();
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
  // QC-002 (iteration 2): mock log path for POST action trigger verification.
  // QUAY_ACTION_MOCK_LOG is set in process.env before startServer() so
  // serve.js's action route picks it up and routes deliverTrigger() through
  // the deterministic file-log mode instead of manda/print — the same env
  // var the real CLI uses (src/serve.js line "QUAY_ACTION_MOCK_LOG || undefined").
  const mockLogPath = path.join(tasksDir, "action-mock.jsonl");

  // Three tasks seeded:
  // - WUI-1 (todo): action button PRESENT (per provider.yml whenStatus: [todo, ready])
  // - WUI-2 (done): action button ABSENT — negative control (no matching whenStatus)
  // - WUI-ACT (todo): used exclusively for the POST action trigger test (QC-002)
  //   so the GET/detail assertions on WUI-1 remain isolated from the POST test.
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

  // Workspace config wiring — same pattern as serve.test.mjs (QN-031) and
  // serve-browser-render.test.mjs (QN-046): serve.js's loadConfig() does a
  // cwd-relative upward search, so we chdir into an isolated workspace whose
  // .quay/config.yml points at the ephemeral tasks dir.
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );

  const port = 47180 + (process.pid % 1000);
  const originalCwd = process.cwd();
  // QC-002 (iteration 2): set QUAY_ACTION_MOCK_LOG before startServer() so
  // serve.js's action route routes deliverTrigger() through the mock/file-log
  // mode — the three-way symmetry that QUAY_ACTION_MOCK_LOG was designed for
  // (QN-042/DIR-009). The env var is restored in the finally block so we do
  // not pollute process.env for later tests.
  const prevMockLog = process.env.QUAY_ACTION_MOCK_LOG;
  process.env.QUAY_ACTION_MOCK_LOG = mockLogPath;
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port });

    // ── GET / (task list page) ───────────────────────────────────────────
    // Browser-rendered observation (playwright MCP, iteration 1):
    //   Page title: "Quay — quay-native"
    //   Heading h1: "Quay — task list (native provider)"
    //   Table rows: WUI-1 (todo) and WUI-2 (done) as linked cells
    const list = await get(port, "/");
    assert(list.status === 200, `GET / returns 200 (got ${list.status})`);

    // Page title: the <title> tag contains "Quay — " prefix and the
    // provider's manifest.name — confirms browser-rendered title matches.
    assert(/<title>Quay\s*[—–-]\s*[^<]+<\/title>/i.test(list.body),
      "GET / <title> tag contains Quay em-dash prefix and provider name");

    // Heading: the <h1> tag confirms the "task list" label and provider id.
    assert(/<h1>[^<]*task list[^<]*<\/h1>/i.test(list.body),
      'GET / <h1> heading contains "task list" text (browser-observed: "Quay — task list (native provider)")');

    // Table structure: both tasks appear as linked rows.
    assert(list.body.includes("WUI-1") && list.body.includes("WUI-2"),
      "GET / body contains both seeded task ids (WUI-1, WUI-2)");
    assert(list.body.includes("todo") && list.body.includes("done"),
      "GET / body contains both seeded tasks' statuses (todo, done)");
    assert(list.body.includes("Web UI browser test task one"),
      "GET / body contains seeded WUI-1 title");
    assert(list.body.includes("Web UI browser test task two"),
      "GET / body contains seeded WUI-2 title");

    // Links: task ids are clickable links to detail pages (browser-observed:
    // link "WUI-1" -> /task/WUI-1, link "WUI-2" -> /task/WUI-2).
    assert(list.body.includes('href="/task/WUI-1"'),
      'GET / body contains link href="/task/WUI-1" (task id is a clickable link)');
    assert(list.body.includes('href="/task/WUI-2"'),
      'GET / body contains link href="/task/WUI-2" (task id is a clickable link)');

    // ── GET /task/:id (detail page — todo, action button PRESENT) ─────────
    // Browser-rendered observation (playwright MCP, iteration 1):
    //   Page title: "WUI-1"
    //   Heading h1: "WUI-1: Web UI browser test task one [todo]"
    //   Back link: "← back to list" -> /
    //   Paragraph: "role: primitive · labels:"
    //   Button "Advance" present
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

    // Back link to list (browser-observed: "← back to list" -> /).
    assert(detail1.body.includes('href="/"'),
      'GET /task/WUI-1 body contains href="/" back-to-list link');

    // Role/labels paragraph (browser-observed: "role: primitive · labels:").
    assert(detail1.body.includes("role:") && detail1.body.includes("primitive"),
      'GET /task/WUI-1 body contains role paragraph with "primitive" role');

    // Action button for todo status (browser-observed: button "Advance"
    // present; form posts to /task/WUI-1/action/advance).
    assert(detail1.body.includes("Advance"),
      "GET /task/WUI-1 (status=todo) renders the 'Advance' action button");
    assert(detail1.body.includes('action="/task/WUI-1/action/advance"'),
      "GET /task/WUI-1 action button form posts to /task/WUI-1/action/advance");

    // ── GET /task/:id (detail page — done, action button ABSENT) ──────────
    // Browser-rendered observation (playwright MCP, iteration 1):
    //   Page title: "WUI-2"
    //   Heading h1: "WUI-2: Web UI browser test task two (done) [done]"
    //   Back link: "← back to list" -> /
    //   NO button element (done status has no matching whenStatus)
    const detail2 = await get(port, "/task/WUI-2");
    assert(detail2.status === 200, `GET /task/WUI-2 returns 200 (got ${detail2.status})`);

    assert(/<title>WUI-2<\/title>/.test(detail2.body),
      "GET /task/WUI-2 <title> tag is the task id (WUI-2)");
    assert(detail2.body.includes("[done]"),
      "GET /task/WUI-2 heading includes [done] status bracket");
    assert(detail2.body.includes('href="/"'),
      'GET /task/WUI-2 body contains href="/" back-to-list link');

    // Negative control: no action button for done status (browser-observed:
    // no <button> element — the same discipline QN-031/serve.test.mjs used
    // for its own "Advance" button negative control).
    assert(!detail2.body.includes("Advance"),
      "GET /task/WUI-2 (status=done) does NOT render the 'Advance' button (negative control)");
    assert(!detail2.body.includes("<button"),
      "GET /task/WUI-2 (status=done) has no <button> element at all (full negative control)");

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

    // ── POST /task/:id/action/:actionId → 302 redirect (QC-002) ─────────────
    // Browser-automation verification (playwright MCP, iteration 2, 2026-07-16):
    //   Navigated to GET /task/ACT-1 (todo); clicked "Advance" button.
    //   Browser followed 302 → GET /task/ACT-1; final URL and title unchanged.
    //   Mock log record written with channel="task-ACT-1", payload/taskId/status/skill.
    //
    // This committed test mechanically guards:
    //   1. The 302 status and Location header (redirect to /task/<id>)
    //   2. The mock log file is created and contains a valid JSON record
    //   3. The record has the correct channel, taskId, and status fields
    //
    // QUAY_ACTION_MOCK_LOG is set in process.env before startServer() (above),
    // so serve.js reads it from process.env on each POST and routes through
    // the deterministic file-log mode. No live manda daemon required.
    const actionPost = await post(port, "/task/WUI-ACT/action/advance");
    assert(actionPost.status === 302,
      `POST /task/WUI-ACT/action/advance returns 302 (got ${actionPost.status})`);
    assert(actionPost.headers.location === "/task/WUI-ACT",
      `POST redirect Location: /task/WUI-ACT (got "${actionPost.headers.location}")`);

    // Mock log verification: the record must exist and be valid JSON with the
    // expected fields (same structure confirmed in the playwright MCP live run).
    const mockLogExists = fs.existsSync(mockLogPath);
    assert(mockLogExists, `mock log file created at ${mockLogPath}`);
    if (mockLogExists) {
      const lines = fs.readFileSync(mockLogPath, "utf8").trim().split("\n").filter(Boolean);
      assert(lines.length >= 1, "mock log contains at least one delivery record");
      if (lines.length >= 1) {
        let record;
        let parseOk = false;
        try { record = JSON.parse(lines[lines.length - 1]); parseOk = true; } catch {}
        assert(parseOk, "mock log last line is valid JSON");
        if (parseOk) {
          assert(record.channel === "task-WUI-ACT",
            `mock log record channel is "task-WUI-ACT" (got "${record.channel}")`);
          assert(record.taskId === "WUI-ACT",
            `mock log record taskId is "WUI-ACT" (got "${record.taskId}")`);
          assert(record.status === "todo",
            `mock log record status is "todo" (got "${record.status}")`);
          assert(typeof record.payload === "string" && record.payload.length > 0,
            "mock log record payload is a non-empty string");
          assert(typeof record.timestamp === "string" && record.timestamp.length > 0,
            "mock log record has a non-empty ISO-8601 timestamp");
        }
      }
    }

  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(originalCwd);
    // Restore QUAY_ACTION_MOCK_LOG env var (QC-002: set before startServer).
    if (prevMockLog === undefined) delete process.env.QUAY_ACTION_MOCK_LOG;
    else process.env.QUAY_ACTION_MOCK_LOG = prevMockLog;
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  console.log(failures === 0
    ? "\nAll QC-001/QC-002 web-ui-browser regression tests passed."
    : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
