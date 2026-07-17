// QN-031 (iteration 21): regression test for serve.js's HTTP list/detail/
// action-button loop and action.js's composePayload() — the literal running
// code behind the `skeleton` V_instance factor (protocol §5.1: "the v0 loop
// runs end-to-end (config -> mcp -> serve -> action -> Skill -> done)").
// Prior to this task, this chain had only ever been exercised by a manual
// curl/browser walkthrough once, in iteration 0
// (experiments/quay-native-bootstrap/timing/iteration-0.log) — never by an automated, re-runnable
// test. This closes that gap, following the same isolation pattern
// task-check.test.mjs (QN-027) already established: a real quay-native MCP
// child process over stdio, spun up against a temporary tasks dir, with a
// real HTTP server from serve.js listening on an ephemeral port.
//
// This test deliberately does NOT exercise real manda delivery (out of
// scope — this task is about the HTTP/composition chain that FEEDS manda,
// not manda itself, which already has its own live G6 precondition check
// each iteration). mandaAvailable() is left to naturally return false in
// this environment when no workspace .manda config resolves against the
// isolated tmp tasks dir, so deliverTrigger() takes its real "degraded:
// print the command" branch — itself a real, unmocked code path, not a stub.
//
// Run: node test/serve.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.js";
import { composePayload } from "../src/action.js";

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
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-workspace-"));

  // Two tasks: one at `todo` (has a matching action_button per provider.yml's
  // whenStatus: ["todo","ready"]) and one at `done` (NO matching action
  // button — the negative control, mirroring QN-030's GAME-C discipline).
  execFileSync("node", [nativeBin, "task", "create", "SRV-1", "--title", "Servable task one",
    "--status", "todo", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "SRV-2", "--title", "Servable task two (done, no button)",
    "--status", "done", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });

  // Write a throwaway .quay/config.yml pointing at the isolated tasks dir,
  // since serve.js's startServer() reads config via loadConfig()/
  // activeProvider() (config.js), not an env var directly. QN-045: startServer()
  // now resolves the spawned quay-native mcp child's env via the SAME shared
  // resolveProviderEnv() (provider.env) that the CLI/MCP legs already used —
  // `tasks_dir` alone is no longer sufficient (closing DESIGN.md §4.4's
  // asymmetry), so this fixture sets both, matching the real repo's own
  // .quay/config.yml convention.
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );

  const port = 41730 + (process.pid % 1000);
  const originalCwd = process.cwd();
  let server;
  try {
    // serve.js's startServer() calls loadConfig() with no args (cwd-relative
    // upward search, config.js's own findConfig() convention) — chdir into
    // the isolated workspace so it resolves this test's own throwaway config,
    // not the real repo's .quay/config.yml.
    process.chdir(workspaceRoot);
    server = await startServer({ port });

    // --- GET / (list) ---
    const list = await get(port, "/");
    assert(list.status === 200, `GET / returns 200 (got ${list.status})`);
    assert(list.body.includes("SRV-1") && list.body.includes("SRV-2"),
      "GET / body contains both seeded task ids");
    assert(list.body.includes("todo") && list.body.includes("done"),
      "GET / body contains both seeded tasks' statuses");
    assert(list.body.includes("Servable task one"),
      "GET / body contains the seeded task's title");

    // --- GET /task/<id> (detail, button PRESENT for todo status) ---
    const detail1 = await get(port, "/task/SRV-1");
    assert(detail1.status === 200, `GET /task/SRV-1 returns 200 (got ${detail1.status})`);
    assert(detail1.body.includes("Advance"),
      "GET /task/SRV-1 (status=todo) renders the 'Advance' action button (matches provider.yml whenStatus)");
    assert(detail1.body.includes("action/advance"),
      "GET /task/SRV-1 button form posts to /task/SRV-1/action/advance");

    // --- GET /task/<id> (detail, button ABSENT for done status — negative control) ---
    const detail2 = await get(port, "/task/SRV-2");
    assert(detail2.status === 200, `GET /task/SRV-2 returns 200 (got ${detail2.status})`);
    // QX-017 (iteration 4): CSS comment now mentions "Advance button" in pageStyles(),
    // so the string "Advance" appears in the <style> block. Check the actual button element instead.
    assert(!detail2.body.includes('<button') || !detail2.body.includes('>Advance<'),
      "GET /task/SRV-2 (status=done, no matching whenStatus) does NOT render the 'Advance' button element (negative control)");

    // --- GET /task/<nonexistent> -> 404 ---
    const notFound = await get(port, "/task/NOPE-999");
    assert(notFound.status === 404, `GET /task/NOPE-999 returns 404 (got ${notFound.status})`);

    // --- POST /task/<id>/action/<actionId> -> 302 redirect ---
    // QX-013 (iteration 3): gate passes (VALID_SECTIONS has all ACs checked) so
    // redirect now includes ?success= param. Check the redirect starts with /task/SRV-1.
    const action = await post(port, "/task/SRV-1/action/advance");
    assert(action.status === 302, `POST /task/SRV-1/action/advance returns 302 (got ${action.status})`);
    assert(action.headers.location && action.headers.location.startsWith("/task/SRV-1"),
      `POST redirect Location header points back to /task/SRV-1 (got ${action.headers.location})`);
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(originalCwd);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  // --- QX-004 (experiment 4, iteration 1): prefix filter via ?prefix= query param ---
  // Tests for the new ?prefix=<value> filtering added to serve.js's list route.
  // Runs a fresh isolated server with tasks across two distinct prefixes.
  {
    const pfxTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-prefix-test-"));
    const pfxWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-prefix-workspace-"));
    fs.mkdirSync(path.join(pfxWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(pfxWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${pfxTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${pfxTasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // Seed tasks with two distinct prefixes: PFXA and PFXB
    execFileSync("node", [nativeBin, "task", "create", "PFXA-1", "--title", "Prefix A task",
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: pfxTasksDir },
    });
    execFileSync("node", [nativeBin, "task", "create", "PFXB-1", "--title", "Prefix B task",
      "--status", "done", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: pfxTasksDir },
    });

    const pfxPort = port + 1;
    const pfxOriginalCwd = process.cwd();
    let pfxServer;
    try {
      process.chdir(pfxWorkspaceRoot);
      pfxServer = await startServer({ port: pfxPort });

      // ?prefix=PFXA — should return only PFXA-1, not PFXB-1
      const filteredA = await get(pfxPort, "/?prefix=PFXA");
      assert(filteredA.status === 200, "GET /?prefix=PFXA returns 200");
      assert(filteredA.body.includes("PFXA-1"), "GET /?prefix=PFXA body includes PFXA-1");
      assert(!filteredA.body.includes("PFXB-1"), "GET /?prefix=PFXA body excludes PFXB-1 (different prefix)");

      // ?prefix=PFXB — should return only PFXB-1
      const filteredB = await get(pfxPort, "/?prefix=PFXB");
      assert(filteredB.status === 200, "GET /?prefix=PFXB returns 200");
      assert(filteredB.body.includes("PFXB-1"), "GET /?prefix=PFXB body includes PFXB-1");
      assert(!filteredB.body.includes("PFXA-1"), "GET /?prefix=PFXB body excludes PFXA-1");

      // No prefix — all tasks returned (no regression)
      const noFilter = await get(pfxPort, "/");
      assert(noFilter.status === 200, "GET / (no prefix) returns 200 for prefix-test workspace");
      assert(noFilter.body.includes("PFXA-1") && noFilter.body.includes("PFXB-1"),
        "GET / (no prefix) includes both PFXA-1 and PFXB-1 — no regression");

      // Prefix nav appears since 2 distinct prefixes exist (PFXA, PFXB)
      assert(noFilter.body.includes("Prefix:"), "GET / body includes 'Prefix:' nav row when 2+ distinct prefixes exist");

      // case-insensitive: ?prefix=pfxa should match PFXA-1
      const filteredLower = await get(pfxPort, "/?prefix=pfxa");
      assert(filteredLower.status === 200, "GET /?prefix=pfxa (lowercase) returns 200");
      assert(filteredLower.body.includes("PFXA-1"), "GET /?prefix=pfxa (lowercase) includes PFXA-1 (case-insensitive)");
      assert(!filteredLower.body.includes("PFXB-1"), "GET /?prefix=pfxa (lowercase) excludes PFXB-1");
    } finally {
      if (pfxServer) {
        pfxServer.close();
        if (pfxServer.client) await pfxServer.client.close();
      }
      process.chdir(pfxOriginalCwd);
      fs.rmSync(pfxTasksDir, { recursive: true, force: true });
      fs.rmSync(pfxWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- QX-008 (experiment 4, iteration 2): ?sort=updated on Web UI list page ---
  // Tests for "Updated ↓" sort support, closing CB-005 and the Web UI analog
  // of CB-012. Creates tasks in time-ordered sequence in a fresh isolated server.
  {
    const sortTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-sort-test-"));
    const sortWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-sort-workspace-"));
    fs.mkdirSync(path.join(sortWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(sortWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${sortTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${sortTasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // Create tasks in sequence with distinct mtimes.
    execFileSync("node", [nativeBin, "task", "create", "SRT-A", "--title", "Sort A (oldest)",
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sortTasksDir },
    });
    const t0 = Date.now(); while (Date.now() - t0 < 50) { /* spin wait for distinct mtime */ }
    execFileSync("node", [nativeBin, "task", "create", "SRT-B", "--title", "Sort B (middle)",
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sortTasksDir },
    });
    const t1 = Date.now(); while (Date.now() - t1 < 50) { /* spin */ }
    execFileSync("node", [nativeBin, "task", "create", "SRT-C", "--title", "Sort C (most recent)",
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sortTasksDir },
    });

    const sortPort = port + 2;
    const sortOrigCwd = process.cwd();
    let sortServer;
    try {
      process.chdir(sortWorkspaceRoot);
      sortServer = await startServer({ port: sortPort });

      // ?sort=updated: SRT-C (most recent) should appear before SRT-A (oldest).
      // Default (?sort=id) alphabetical order would be SRT-A, SRT-B, SRT-C.
      const sortedByUpdated = await get(sortPort, "/?sort=updated");
      assert(sortedByUpdated.status === 200, "GET /?sort=updated returns 200");
      assert(
        sortedByUpdated.body.includes("SRT-C") && sortedByUpdated.body.includes("SRT-A"),
        "GET /?sort=updated body includes both SRT-C and SRT-A"
      );
      // Verify SRT-C appears before SRT-A in the rendered HTML body.
      const posC = sortedByUpdated.body.indexOf("SRT-C");
      const posA = sortedByUpdated.body.indexOf("SRT-A");
      assert(
        posC < posA,
        `GET /?sort=updated: SRT-C (most recent) appears before SRT-A (oldest) in the HTML (posC=${posC}, posA=${posA})`
      );

      // Sort nav should include "Updated" link.
      assert(
        sortedByUpdated.body.includes("Updated"),
        "GET /?sort=updated body includes 'Updated' in the sort nav"
      );

      // No regression: default order (no sort param) still returns 200.
      const noSort = await get(sortPort, "/");
      assert(noSort.status === 200, "GET / (no sort param) returns 200 after adding sort-by-updated");
      assert(noSort.body.includes("SRT-A") && noSort.body.includes("SRT-C"),
        "GET / (no sort param) includes both seeded tasks — no regression");
    } finally {
      if (sortServer) {
        sortServer.close();
        if (sortServer.client) await sortServer.client.close();
      }
      process.chdir(sortOrigCwd);
      fs.rmSync(sortTasksDir, { recursive: true, force: true });
      fs.rmSync(sortWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- QX-009 (experiment 4, iteration 2): inline action buttons on list page ---
  // Tests for CB-003 (action buttons only on detail page; not on list page).
  // Uses the existing fixture's tasks (SRV-1 at todo with advance button, SRV-2 at done without).
  // This reuses the main server (already closed above) so creates a fresh one.
  {
    const actTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-listaction-test-"));
    const actWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-listaction-workspace-"));
    fs.mkdirSync(path.join(actWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(actWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${actTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${actTasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // SRV2-1: todo status → should have Advance button on list page.
    // SRV2-2: done status → should NOT have Advance button (whenStatus: ["todo","ready"]).
    execFileSync("node", [nativeBin, "task", "create", "SRV2-1", "--title", "List action task (todo)",
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: actTasksDir },
    });
    execFileSync("node", [nativeBin, "task", "create", "SRV2-2", "--title", "List action task (done, no button)",
      "--status", "done", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: actTasksDir },
    });

    const actPort = port + 3;
    const actOrigCwd = process.cwd();
    let actServer;
    try {
      process.chdir(actWorkspaceRoot);
      actServer = await startServer({ port: actPort });

      // GET / (list): Advance button appears for SRV2-1 (todo), absent for SRV2-2 (done).
      const listPage = await get(actPort, "/");
      assert(listPage.status === 200, "GET / (list page with actions) returns 200");
      assert(listPage.body.includes("SRV2-1") && listPage.body.includes("SRV2-2"),
        "GET / body includes both seeded tasks");
      // The list page should include at least one "Advance" button (for SRV2-1).
      assert(
        listPage.body.includes("Advance"),
        "GET / list page body includes 'Advance' action button for todo-status task (QX-009)"
      );
      // The table should have an "actions" column header.
      assert(
        listPage.body.toLowerCase().includes("actions"),
        "GET / list page body includes 'actions' column header (QX-009)"
      );
      // The action form on the list page posts to the task's action URL.
      assert(
        listPage.body.includes(`/task/${encodeURIComponent("SRV2-1")}/action/advance`) ||
        listPage.body.includes("/task/SRV2-1/action/advance"),
        "GET / list page body includes action form posting to SRV2-1's advance action endpoint"
      );

      // POST action from list page: should redirect back to the list (not /task/<id>).
      // The from= param is URL-encoded "/" (the list root).
      // QX-013 (iteration 3): gate passes (VALID_SECTIONS all ACs checked) so redirect
      // now includes ?success= appended to the from= target. Check starts-with "/" (list root).
      const fromEncoded = encodeURIComponent("/");
      const actionPost = await post(actPort, `/task/SRV2-1/action/advance?from=${fromEncoded}`);
      assert(actionPost.status === 302, `POST /task/SRV2-1/action/advance?from=/ returns 302 (got ${actionPost.status})`);
      assert(
        actionPost.headers.location && actionPost.headers.location.startsWith("/"),
        `POST action from list page redirects back to list (starts with /) (Location: ${actionPost.headers.location})`
      );
      assert(
        actionPost.headers.location && actionPost.headers.location.includes("success="),
        `POST action from list page redirect includes ?success= param (QX-013) (Location: ${actionPost.headers.location})`
      );

      // POST action without from= param: should still redirect to task detail (existing behavior).
      // QX-013: now also appends ?success= to the task detail redirect.
      const actionPostNoFrom = await post(actPort, `/task/SRV2-1/action/advance`);
      assert(actionPostNoFrom.status === 302, `POST /task/SRV2-1/action/advance (no from=) returns 302 (got ${actionPostNoFrom.status})`);
      assert(
        actionPostNoFrom.headers.location && actionPostNoFrom.headers.location.startsWith("/task/SRV2-1"),
        `POST action without from= redirects to task detail (starts with /task/SRV2-1) (Location: ${actionPostNoFrom.headers.location})`
      );
    } finally {
      if (actServer) {
        actServer.close();
        if (actServer.client) await actServer.client.close();
      }
      process.chdir(actOrigCwd);
      fs.rmSync(actTasksDir, { recursive: true, force: true });
      fs.rmSync(actWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- composePayload() unit-level check (action.js), real manifest shape ---
  const manifest = {
    action_buttons: [
      { id: "advance", label: "Advance", payload: "Drive task {{id}} forward.", whenStatus: ["todo", "ready"] },
    ],
    status_skill_map: { todo: "quay:author", ready: "quay:execute" },
  };
  const payload = composePayload({ providerManifest: manifest, task: { id: "SRV-1", status: "todo" }, actionId: "advance" });
  assert(payload.label === "Advance", "composePayload() returns the button's label");
  assert(payload.payload === "Drive task SRV-1 forward.", "composePayload() substitutes {{id}} in the payload template");
  assert(payload.skill === "quay:author", "composePayload() resolves skill from status_skill_map for the task's current status");
  assert(payload.taskId === "SRV-1" && payload.status === "todo", "composePayload() carries taskId and status through");

  let threw = false;
  try {
    composePayload({ providerManifest: manifest, task: { id: "SRV-1", status: "todo" }, actionId: "nonexistent-button" });
  } catch {
    threw = true;
  }
  assert(threw, "composePayload() throws for an unknown actionId (no such action button)");

  // --- QX-011..QX-015 (experiment 4, iteration 3): back-link context, mobile columns,
  //     gate-fail feedback, button tooltips, orientation banner ---
  // Uses a fresh isolated server with one todo task (unchecked ACs for gate-fail testing)
  // and one todo task with all ACs checked (for gate-pass testing and back-link testing).
  {
    const ux3TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-ux3-test-"));
    const ux3WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-ux3-workspace-"));
    fs.mkdirSync(path.join(ux3WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(ux3WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${ux3TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${ux3TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // UX3-1: todo with all ACs checked (gate passes) — tests back-link, tooltip, success redirect
    execFileSync("node", [nativeBin, "task", "create", "UX3-1", "--title", "Gate-pass task (todo, all ACs checked)",
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ux3TasksDir },
    });
    // UX3-2: todo with unchecked ACs — tests gate-fail redirect and error banner
    const UNCHECKED_SECTIONS =
      "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
      "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
      "## AC\n- [ ] a sufficiently long acceptance criterion line — NOT YET CHECKED\n" +
      "## DoD\n- [ ] a sufficiently long definition-of-done line — NOT YET CHECKED\n";
    execFileSync("node", [nativeBin, "task", "create", "UX3-2", "--title", "Gate-blocked task (todo, ACs unchecked)",
      "--status", "todo", "--body", UNCHECKED_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ux3TasksDir },
    });

    const ux3Port = port + 4;
    const ux3OrigCwd = process.cwd();
    let ux3Server;
    try {
      process.chdir(ux3WorkspaceRoot);
      ux3Server = await startServer({ port: ux3Port });

      // --- QX-015 (UQ-003): orientation banner removed by DIR-007 (iteration 10) ---
      // Banner was misleading (depicted needs-human as sequential step, not side-branch)
      // and had disproportionate layout cost. Assertions updated to reflect removal.
      const listForBanner = await get(ux3Port, "/");
      assert(listForBanner.status === 200, "GET / (UX3 server) returns 200");
      assert(
        !listForBanner.body.includes("AI-assisted task management"),
        "GET / list page no longer contains orientation banner text (DIR-007, QX-015 removed)"
      );
      assert(
        listForBanner.body.includes("todo"),
        "GET / list page HTML still contains 'todo' status (filter nav present) (DIR-007)"
      );

      // --- QX-012 (UQ-011, UQ-012): col-role, col-labels classes in list HTML + CSS rule ---
      assert(
        listForBanner.body.includes('class="col-role"'),
        'GET / list page table header includes class="col-role" (QX-012, UQ-012)'
      );
      assert(
        listForBanner.body.includes('class="col-labels"'),
        'GET / list page table header includes class="col-labels" (QX-012, UQ-011/012)'
      );
      assert(
        listForBanner.body.includes(".col-role, .col-labels { display: none; }") ||
        listForBanner.body.includes(".col-role,.col-labels{display:none}") ||
        (listForBanner.body.includes(".col-role") && listForBanner.body.includes("display: none")),
        "GET / page styles include media-query rule hiding .col-role and .col-labels (QX-012)"
      );

      // --- QX-014 / QX-019 (UQ-014, UQ-018): Advance button on list page has target-status
      //     tooltip (QX-019 backport: was generic "Advance task to next status";
      //     now shows "Advance to ready" for todo-status tasks).
      assert(
        listForBanner.body.includes('title="Advance to ready"') ||
        listForBanner.body.includes('title="Advance task to next status"'),
        'GET / list page Advance button has title= tooltip attribute (QX-014/QX-019, UQ-014/UQ-018)'
      );

      // --- QX-011 (UQ-009): task title links include ?from= on list page ---
      assert(
        listForBanner.body.includes("?from="),
        "GET / list page task title links include ?from= query param (QX-011, UQ-009)"
      );

      // --- QX-011 (UQ-009): detail page back link uses ?from= param ---
      // Access detail page with ?from=%2F%3Fprefix%3DQX (encodes /?prefix=QX)
      const fromValue = encodeURIComponent("/?prefix=QX");
      const detailWithFrom = await get(ux3Port, `/task/UX3-1?from=${fromValue}`);
      assert(detailWithFrom.status === 200, `GET /task/UX3-1?from=/?prefix=QX returns 200`);
      assert(
        detailWithFrom.body.includes('href="/?prefix=QX"'),
        `GET /task/UX3-1?from=/?prefix=QX: back link href is "/?prefix=QX" (QX-011, UQ-009)`
      );

      // --- QX-011 (UQ-009): detail page back link defaults to "/" when no from= ---
      const detailNoFrom = await get(ux3Port, `/task/UX3-1`);
      assert(detailNoFrom.status === 200, "GET /task/UX3-1 (no from=) returns 200");
      assert(
        detailNoFrom.body.includes('href="/"') && detailNoFrom.body.includes("back to list"),
        'GET /task/UX3-1 (no from=): back link defaults to href="/" (QX-011)'
      );

      // --- QX-011 (UQ-009): open-redirect guard — from= with external URL rejected ---
      const externalFrom = encodeURIComponent("https://evil.com");
      const detailExternal = await get(ux3Port, `/task/UX3-1?from=${externalFrom}`);
      assert(
        detailExternal.body.includes('href="/"') && !detailExternal.body.includes("evil.com"),
        "GET /task/UX3-1?from=https://evil.com: open-redirect guard rejects external URL, defaults to / (QX-011)"
      );

      // --- SH-002: open-redirect guard — protocol-relative URL //evil.com rejected ---
      const protoRelFrom = encodeURIComponent("//evil.com");
      const detailProtoRel = await get(ux3Port, `/task/UX3-1?from=${protoRelFrom}`);
      assert(
        detailProtoRel.body.includes('href="/"') && !detailProtoRel.body.includes("evil.com"),
        "GET /task/UX3-1?from=//evil.com: open-redirect guard rejects protocol-relative URL, defaults to / (SH-002)"
      );

      // --- CR-010 / UQ-016: orientation banner removed (DIR-007); verify no 'in_progress' status leaks ---
      // The banner text was the only known location using 'in_progress'; verify it's gone.
      assert(
        !listForBanner.body.includes("in_progress"),
        "GET / page does NOT contain 'in_progress' (non-existent status) anywhere (CR-010, UQ-016, DIR-007)"
      );
      assert(
        listForBanner.body.includes("ready"),
        "GET / page still contains 'ready' status (filter nav) (CR-010, UQ-016)"
      );

      // --- QX-014 (UQ-014): detail page Advance button has target-status tooltip ---
      // UX3-1 is at status=todo, so next status is "ready"
      assert(
        detailNoFrom.body.includes('title="Advance to ready"'),
        'GET /task/UX3-1 (todo status) detail page Advance button has title="Advance to ready" (QX-014)'
      );

      // --- QX-013 (UQ-013): gate-fail feedback — POST on UX3-2 (unchecked ACs) ---
      // Gate should block and redirect with ?error= instead of silently delivering
      const gateFailPost = await post(ux3Port, `/task/UX3-2/action/advance`);
      assert(gateFailPost.status === 302, `POST /task/UX3-2/action/advance (blocked gate) returns 302 (got ${gateFailPost.status})`);
      assert(
        gateFailPost.headers.location && gateFailPost.headers.location.includes("error="),
        `POST /task/UX3-2/action/advance: gate-blocked redirect includes ?error= param (QX-013, UQ-013) (Location: ${gateFailPost.headers.location})`
      );
      assert(
        !(gateFailPost.headers.location && gateFailPost.headers.location.includes("success=")),
        `POST /task/UX3-2/action/advance: gate-blocked redirect does NOT include ?success= (QX-013)`
      );

      // --- QX-013 (UQ-013): error banner rendered on list page when ?error= is in URL ---
      const errorInURL = await get(ux3Port, "/?error=Gate+check+failed");
      assert(errorInURL.status === 200, "GET /?error=Gate+check+failed returns 200");
      assert(
        errorInURL.body.includes("error-banner"),
        'GET /?error=...: list page renders .error-banner element (QX-013, UQ-013)'
      );
      assert(
        errorInURL.body.includes("Gate check failed"),
        'GET /?error=Gate+check+failed: list page error banner shows the error message (QX-013)'
      );

      // --- QX-013 (UQ-013): error banner on detail page ---
      const detailWithError = await get(ux3Port, `/task/UX3-1?error=Gate+blocked`);
      assert(
        detailWithError.body.includes("error-banner"),
        'GET /task/UX3-1?error=...: detail page renders .error-banner element (QX-013)'
      );

      // --- QX-013 (UQ-013): gate-pass → redirect includes ?success= ---
      // UX3-1 has all ACs checked, so gate passes
      const gatePassPost = await post(ux3Port, `/task/UX3-1/action/advance`);
      assert(gatePassPost.status === 302, `POST /task/UX3-1/action/advance (gate passes) returns 302 (got ${gatePassPost.status})`);
      assert(
        gatePassPost.headers.location && gatePassPost.headers.location.includes("success="),
        `POST /task/UX3-1/action/advance: gate-pass redirect includes ?success= param (QX-013) (Location: ${gatePassPost.headers.location})`
      );
      assert(
        !(gatePassPost.headers.location && gatePassPost.headers.location.includes("error=")),
        `POST /task/UX3-1/action/advance: gate-pass redirect does NOT include ?error= (QX-013)`
      );

      // --- QX-013 (UQ-013): success banner rendered on list page when ?success= is in URL ---
      const successInURL = await get(ux3Port, "/?success=Task+advanced");
      assert(
        successInURL.body.includes("success-banner"),
        'GET /?success=...: list page renders .success-banner element (QX-013)'
      );

    } finally {
      if (ux3Server) {
        ux3Server.close();
        if (ux3Server.client) await ux3Server.client.close();
      }
      process.chdir(ux3OrigCwd);
      fs.rmSync(ux3TasksDir, { recursive: true, force: true });
      fs.rmSync(ux3WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- QX-016..QX-019 (experiment 4, iteration 4): multi-label filter, sticky actions,
  //     updatedAt display, and target-status tooltip backport ---
  {
    const qx16TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx16-test-"));
    const qx16WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx16-workspace-"));
    fs.mkdirSync(path.join(qx16WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx16WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx16TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx16TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // BOTH-1: has both labels "bug" and "cli"
    execFileSync("node", [nativeBin, "task", "create", "BOTH-1", "--title", "Has both labels",
      "--status", "todo", "--body", VALID_SECTIONS, "--labels", "bug,cli"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx16TasksDir },
    });
    // BUGONLY-1: has only label "bug"
    execFileSync("node", [nativeBin, "task", "create", "BUGONLY-1", "--title", "Has only bug label",
      "--status", "todo", "--body", VALID_SECTIONS, "--labels", "bug"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx16TasksDir },
    });
    // NOLAB-1: no labels
    execFileSync("node", [nativeBin, "task", "create", "NOLAB-1", "--title", "Has no labels",
      "--status", "done", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx16TasksDir },
    });

    const qx16Port = port + 5;
    const qx16OrigCwd = process.cwd();
    let qx16Server;
    try {
      process.chdir(qx16WorkspaceRoot);
      qx16Server = await startServer({ port: qx16Port });

      // --- QX-016 (CB-013): Web UI multi-label AND-filter ---
      // ?label=bug&label=cli should return only BOTH-1 (has both), not BUGONLY-1 (only bug)
      const multiLabel = await get(qx16Port, "/?label=bug&label=cli");
      assert(multiLabel.status === 200, "GET /?label=bug&label=cli returns 200 (multi-label AND-filter)");
      assert(multiLabel.body.includes("BOTH-1"), "GET /?label=bug&label=cli includes BOTH-1 (has both labels) (QX-016, CB-013)");
      assert(!multiLabel.body.includes("BUGONLY-1"), "GET /?label=bug&label=cli excludes BUGONLY-1 (has only bug, not cli) (QX-016, CB-013)");
      assert(!multiLabel.body.includes("NOLAB-1"), "GET /?label=bug&label=cli excludes NOLAB-1 (has no labels) (QX-016, CB-013)");

      // Single-label still works (no regression from QW-005).
      const singleLabel = await get(qx16Port, "/?label=bug");
      assert(singleLabel.status === 200, "GET /?label=bug returns 200 (single-label, no regression) (QX-016)");
      assert(singleLabel.body.includes("BOTH-1"), "GET /?label=bug includes BOTH-1 (has bug label) (QX-016)");
      assert(singleLabel.body.includes("BUGONLY-1"), "GET /?label=bug includes BUGONLY-1 (has bug label) (QX-016)");
      assert(!singleLabel.body.includes("NOLAB-1"), "GET /?label=bug excludes NOLAB-1 (no labels) (QX-016)");

      // No label filter — all tasks returned.
      const noLabel = await get(qx16Port, "/");
      assert(noLabel.status === 200, "GET / (no label filter) returns 200 — no regression (QX-016)");
      assert(noLabel.body.includes("BOTH-1") && noLabel.body.includes("BUGONLY-1") && noLabel.body.includes("NOLAB-1"),
        "GET / (no label filter) returns all tasks — no regression (QX-016)");

      // --- QX-017 (UQ-011): sticky actions column in CSS ---
      assert(
        noLabel.body.includes(".col-actions") && noLabel.body.includes("position: sticky") && noLabel.body.includes("right: 0"),
        "GET / page styles include .col-actions with position:sticky and right:0 (QX-017, UQ-011)"
      );
      // The actions column header has class="col-actions".
      assert(
        noLabel.body.includes('class="col-actions"'),
        'GET / list page actions column header has class="col-actions" (QX-017, UQ-011)'
      );

      // --- QX-018 (UQ-017): updatedAt displayed on list page as "updated" column ---
      assert(
        noLabel.body.includes(">updated<") || noLabel.body.includes(">updated</th>"),
        'GET / list page table includes "updated" column header (QX-018, UQ-017)'
      );
      // Tasks with updatedAt (from quay-native store.js) render a relative time.
      assert(
        noLabel.body.includes(" ago") || noLabel.body.includes("col-updated"),
        "GET / list page rows include relative-time ago display or col-updated class (QX-018, UQ-017)"
      );

      // --- QX-018 (UQ-017): "last updated" on detail page ---
      const detailQX18 = await get(qx16Port, "/task/BOTH-1");
      assert(detailQX18.status === 200, "GET /task/BOTH-1 returns 200 (QX-018 detail page check)");
      assert(
        detailQX18.body.includes("last updated"),
        'GET /task/BOTH-1 detail page includes "last updated" meta (QX-018, UQ-017)'
      );

      // --- QX-019 (UQ-018): list-page Advance button has target-status tooltip ---
      // BOTH-1 is at todo status, so next status should be "ready"
      assert(
        noLabel.body.includes('title="Advance to ready"'),
        'GET / list page Advance button for todo-status task has title="Advance to ready" (QX-019, UQ-018)'
      );

    } finally {
      if (qx16Server) {
        qx16Server.close();
        if (qx16Server.client) await qx16Server.client.close();
      }
      process.chdir(qx16OrigCwd);
      fs.rmSync(qx16TasksDir, { recursive: true, force: true });
      fs.rmSync(qx16WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- QX-020 (experiment 4, iteration 5): label-nav toggling (UQ-019) ---
  // --- QX-021 (experiment 4, iteration 5): full-text search (CB-007) ---
  {
    const qx20TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx20-test-"));
    const qx20WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx20-workspace-"));
    fs.mkdirSync(path.join(qx20WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx20WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx20TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx20TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // TOGGLE-1: has labels "alpha" and "beta"
    execFileSync("node", [nativeBin, "task", "create", "TOGGLE-1", "--title", "Alpha beta task",
      "--status", "todo", "--body", VALID_SECTIONS, "--labels", "alpha,beta"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx20TasksDir },
    });
    // TOGGLE-2: has label "alpha" only
    execFileSync("node", [nativeBin, "task", "create", "TOGGLE-2", "--title", "Alpha only task",
      "--status", "todo", "--body", VALID_SECTIONS, "--labels", "alpha"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx20TasksDir },
    });
    // TOGGLE-3: has label "gamma" only (not alpha or beta)
    execFileSync("node", [nativeBin, "task", "create", "TOGGLE-3", "--title", "Gamma search task",
      "--status", "done", "--body", VALID_SECTIONS, "--labels", "gamma"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx20TasksDir },
    });

    const qx20Port = port + 6;
    const qx20OrigCwd = process.cwd();
    let qx20Server;
    try {
      process.chdir(qx20WorkspaceRoot);
      qx20Server = await startServer({ port: qx20Port });

      // --- QX-020 (UQ-019): label-nav toggle semantics ---
      // With ?label=alpha&label=beta active, the label nav should offer toggle links.
      const twolabel = await get(qx20Port, "/?label=alpha&label=beta");
      assert(twolabel.status === 200, "GET /?label=alpha&label=beta returns 200 (QX-020, UQ-019)");
      // The page should include TOGGLE-1 (has both) but not TOGGLE-2 (only alpha)
      assert(twolabel.body.includes("TOGGLE-1"), "GET /?label=alpha&label=beta includes TOGGLE-1 (has both) (QX-020)");
      assert(!twolabel.body.includes("TOGGLE-2"), "GET /?label=alpha&label=beta excludes TOGGLE-2 (only alpha) (QX-020)");

      // Toggle-off: the link for "alpha" (already active) should produce a URL to remove alpha.
      // With alpha and beta both active, clicking "alpha remove" should leave only ?label=beta.
      // The "(remove)" link pattern is: <a href="/?label=beta">remove</a> somewhere on page.
      // We check the page includes the pattern href="/?label=beta" (or with other params) as a remove link.
      assert(
        twolabel.body.includes(">remove<") || twolabel.body.includes("remove</a>"),
        "GET /?label=alpha&label=beta label nav contains (remove) link for active labels (QX-020, UQ-019)"
      );

      // Active label "alpha" should be shown as bold (strong tag).
      // QX-034 (UQ-032): label now renders with count badge: <strong>alpha (N)</strong>
      assert(
        twolabel.body.includes("<strong>alpha") && twolabel.body.includes("</strong>"),
        "GET /?label=alpha&label=beta shows active label 'alpha' in bold (QX-020, UQ-019)"
      );

      // Active label "beta" should also be shown as bold.
      assert(
        twolabel.body.includes("<strong>beta") && twolabel.body.includes("</strong>"),
        "GET /?label=alpha&label=beta shows active label 'beta' in bold (QX-020, UQ-019)"
      );

      // A clear-all link ("All") should be present when 2+ labels are active.
      assert(
        twolabel.body.includes(">All<") || twolabel.body.includes("Label: <a"),
        "GET /?label=alpha&label=beta label nav includes an All/clear link (QX-020, UQ-019)"
      );

      // Toggle-on: with no labels active, clicking "alpha" should produce ?label=alpha.
      const noLabelPage = await get(qx20Port, "/");
      assert(noLabelPage.status === 200, "GET / (no label filter) returns 200 for toggle-on test (QX-020)");
      // The unfiltered page's label nav should link to ?label=alpha for the alpha label.
      assert(
        noLabelPage.body.includes("label=alpha"),
        "GET / (no labels) label nav includes link with label=alpha (toggle-on semantics) (QX-020, UQ-019)"
      );

      // --- QX-021 (CB-007): Web UI title search via ?q= ---
      // ?q=gamma should return only TOGGLE-3 (title: "Gamma search task")
      const searchGamma = await get(qx20Port, "/?q=gamma");
      assert(searchGamma.status === 200, "GET /?q=gamma returns 200 (QX-021, CB-007)");
      assert(searchGamma.body.includes("TOGGLE-3"), "GET /?q=gamma includes TOGGLE-3 (title contains Gamma) (QX-021)");
      assert(!searchGamma.body.includes("TOGGLE-1"), "GET /?q=gamma excludes TOGGLE-1 (title: Alpha beta task) (QX-021, CB-007)");
      assert(!searchGamma.body.includes("TOGGLE-2"), "GET /?q=gamma excludes TOGGLE-2 (title: Alpha only task) (QX-021)");

      // ?q= (empty) should return all tasks (no filter applied)
      const searchEmpty = await get(qx20Port, "/?q=");
      assert(searchEmpty.status === 200, "GET /?q= (empty) returns 200 — no filter applied (QX-021)");
      assert(
        searchEmpty.body.includes("TOGGLE-1") && searchEmpty.body.includes("TOGGLE-2") && searchEmpty.body.includes("TOGGLE-3"),
        "GET /?q= (empty) returns all tasks — no regression (QX-021)"
      );

      // The search form must be present: <input name="q"
      assert(
        noLabelPage.body.includes('name="q"') || noLabelPage.body.includes("name='q'"),
        'GET / page includes search form with input name="q" (QX-021, CB-007)'
      );

      // Case-insensitive search: ?q=ALPHA should match "Alpha beta task" and "Alpha only task"
      const searchUpper = await get(qx20Port, "/?q=ALPHA");
      assert(searchUpper.status === 200, "GET /?q=ALPHA returns 200 (case-insensitive search, QX-021)");
      assert(searchUpper.body.includes("TOGGLE-1"), "GET /?q=ALPHA includes TOGGLE-1 (case-insensitive) (QX-021)");
      assert(searchUpper.body.includes("TOGGLE-2"), "GET /?q=ALPHA includes TOGGLE-2 (case-insensitive) (QX-021)");
      assert(!searchUpper.body.includes("TOGGLE-3"), "GET /?q=ALPHA excludes TOGGLE-3 (Gamma title) (QX-021)");

    } finally {
      if (qx20Server) {
        qx20Server.close();
        if (qx20Server.client) await qx20Server.client.close();
      }
      process.chdir(qx20OrigCwd);
      fs.rmSync(qx20TasksDir, { recursive: true, force: true });
      fs.rmSync(qx20WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- QX-023 (experiment 4, iteration 6): body search (CB-016) ---
  // --- QX-024 (experiment 4, iteration 6): label nav truncation (UQ-025) ---
  // --- QX-025 (experiment 4, iteration 6): clear link filter preservation (UQ-026) ---
  {
    const qx23TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx23-test-"));
    const qx23WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx23-workspace-"));
    fs.mkdirSync(path.join(qx23WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx23WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx23TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx23TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // BSRCH-1: unique term ONLY in body, not in title
    const bodyOnlyBody = VALID_SECTIONS + "\nThis body contains xyzzy-unique-body-term here.\n";
    execFileSync("node", [nativeBin, "task", "create", "BSRCH-1", "--title", "Unrelated title only",
      "--status", "todo", "--body", bodyOnlyBody], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx23TasksDir },
    });
    // BSRCH-2: term NOT in title or body (control — must be excluded)
    execFileSync("node", [nativeBin, "task", "create", "BSRCH-2", "--title", "Other task no match",
      "--status", "todo", "--body", VALID_SECTIONS], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx23TasksDir },
    });
    // QX-024 setup: 30 tasks with distinct labels (label-01 through label-30)
    // to trigger the "more labels" truncation threshold (25).
    for (let i = 1; i <= 30; i++) {
      const labelId = `LBL${String(i).padStart(2, "0")}`;
      const labelName = `label-${String(i).padStart(2, "0")}`;
      execFileSync("node", [nativeBin, "task", "create", labelId, "--title", `Label task ${i}`,
        "--status", "todo", "--body", VALID_SECTIONS, "--labels", labelName], {
        env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx23TasksDir },
      });
    }

    const qx23Port = port + 7;
    const qx23OrigCwd = process.cwd();
    let qx23Server;
    try {
      process.chdir(qx23WorkspaceRoot);
      qx23Server = await startServer({ port: qx23Port });

      // --- QX-023 (CB-016): body search ---
      // ?q=xyzzy-unique-body-term must return BSRCH-1 (body match) but not BSRCH-2 (no match)
      const bodySearch = await get(qx23Port, "/?q=xyzzy-unique-body-term");
      assert(bodySearch.status === 200, "GET /?q=body-term returns 200 (QX-023, CB-016)");
      assert(bodySearch.body.includes("BSRCH-1"),
        "GET /?q=body-term includes BSRCH-1 (body match, not title) (QX-023, CB-016)");
      assert(!bodySearch.body.includes("BSRCH-2"),
        "GET /?q=body-term excludes BSRCH-2 (no match) (QX-023, CB-016)");

      // Case-insensitive body search
      const bodySearchUpper = await get(qx23Port, "/?q=XYZZY-UNIQUE-BODY-TERM");
      assert(bodySearchUpper.status === 200, "GET /?q=BODY-TERM (uppercase) returns 200 (QX-023, CB-016)");
      assert(bodySearchUpper.body.includes("BSRCH-1"),
        "GET /?q=BODY-TERM (uppercase) finds body match case-insensitively (QX-023, CB-016)");

      // --- QX-024 (UQ-025): label nav truncation ---
      // With 30 labels in the workspace, the label nav should be truncated at 25
      // and show a "more labels" indicator.
      const manyLabels = await get(qx23Port, "/");
      assert(manyLabels.status === 200, "GET / with 30 labels returns 200 (QX-024, UQ-025)");
      assert(manyLabels.body.includes("more labels"),
        "GET / with 30 labels: label nav shows 'more labels' truncation indicator (QX-024, UQ-025)");
      // Confirm the truncation count is correct: 30 - 25 = 5 more labels
      assert(manyLabels.body.includes("5 more labels"),
        "GET / with 30 labels: label nav shows '5 more labels' (QX-024, UQ-025)");

      // --- QX-025 (UQ-026): clear link preserves other filters ---
      // When status and label are active, the search clear link must preserve them
      // and only clear ?q=. The clear link href should include status= and label= but NOT q=.
      const filteredSearch = await get(qx23Port, "/?status=todo&label=label-01&q=something");
      assert(filteredSearch.status === 200,
        "GET /?status=todo&label=label-01&q=something returns 200 (QX-025, UQ-026)");
      // The clear link for search should include status and label, but not q
      // buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, null) produces
      // /?status=todo&label=label-01 (no q param).
      assert(
        filteredSearch.body.includes("status=todo") && filteredSearch.body.includes("label=label-01"),
        "GET /?status=todo&label=label-01&q=something page contains filter params in nav (QX-025, UQ-026)"
      );
      // The clear link href must contain status=todo&label=label-01 and must NOT be bare "/"
      // (which would reset all filters). Verify the clear link includes the preserved params.
      assert(
        filteredSearch.body.includes(">clear</a>"),
        "GET /?status=todo&label=label-01&q=something page contains a clear link for search (QX-025, UQ-026)"
      );
      // Verify clear link preserves status filter (href includes status=todo)
      const clearWithStatus = filteredSearch.body.match(/href="([^"]*)"[^>]*>clear<\/a>/);
      assert(
        clearWithStatus && clearWithStatus[1].includes("status=todo"),
        `GET clear link preserves ?status=todo filter (QX-025, UQ-026): href="${clearWithStatus ? clearWithStatus[1] : "not found"}"`
      );

    } finally {
      if (qx23Server) {
        qx23Server.close();
        if (qx23Server.client) await qx23Server.client.close();
      }
      process.chdir(qx23OrigCwd);
      fs.rmSync(qx23TasksDir, { recursive: true, force: true });
      fs.rmSync(qx23WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- QX-026 (experiment 4, iteration 7): frequency-sort labels + pin active (UQ-028 + UQ-027) ---
  // --- QX-027 (experiment 4, iteration 7): doc staleness — placeholder updated (UQ-029) ---
  // --- QX-028 (experiment 4, iteration 7): body search heading exclusion (CB-017) ---
  {
    const qx26TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx26-test-"));
    const qx26WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx26-workspace-"));
    fs.mkdirSync(path.join(qx26WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx26WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx26TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx26TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // Create 30 tasks with label "freq-common" (the most-used label).
    // Then create 5 tasks with each of "zzz-rare-a" through "zzz-rare-y" (25 rare labels).
    // With frequency sort, "freq-common" should appear first in the nav.
    // "zzz-rare-*" labels come last alphabetically but may fill top-25 slots if not sorted by freq.
    for (let i = 1; i <= 30; i++) {
      execFileSync("node", [nativeBin, "task", "create", `FREQ-${String(i).padStart(2, "0")}`, "--title", `Freq task ${i}`,
        "--status", "todo", "--body", VALID_SECTIONS, "--labels", "freq-common"], {
        env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx26TasksDir },
      });
    }
    // 26 rare labels (zzz-rare-a through zzz-rare-z) each on 1 task.
    // With freq sort, "freq-common" (30 tasks) beats all of these.
    for (let i = 0; i < 26; i++) {
      const rareLabel = `zzz-rare-${String.fromCharCode(97 + i)}`; // zzz-rare-a .. zzz-rare-z
      execFileSync("node", [nativeBin, "task", "create", `RARE-${String.fromCharCode(65 + i)}`, "--title", `Rare label task ${i}`,
        "--status", "todo", "--body", VALID_SECTIONS, "--labels", rareLabel], {
        env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx26TasksDir },
      });
    }
    // Active label that would be position >25 alphabetically but should appear due to pinning.
    // "zzz-rare-z" is the last alphabetically of the rare labels and won't appear in top-25
    // by frequency (all have count=1; "freq-common" has count=30 and takes position 1;
    // the 26 rare labels fill positions 2-27, but only 24 fit within the 25-slot cap after
    // "freq-common"). The last ones alphabetically ("zzz-rare-x", "zzz-rare-y", "zzz-rare-z")
    // will be beyond position 25. Filter by "zzz-rare-z" to trigger the pin.

    const qx26Port = port + 8;
    const qx26OrigCwd = process.cwd();
    let qx26Server;
    try {
      process.chdir(qx26WorkspaceRoot);
      qx26Server = await startServer({ port: qx26Port });

      // --- QX-026a (UQ-028): frequency sort puts most-used label first ---
      const freqPage = await get(qx26Port, "/");
      assert(freqPage.status === 200, "GET / with freq-labeled tasks returns 200 (QX-026, UQ-028)");
      // The label nav should contain "freq-common" and it should appear before the rare labels.
      // Check it's in the HTML at all first.
      assert(freqPage.body.includes("freq-common"),
        "GET / label nav includes freq-common (most-used label with 30 tasks) (QX-026, UQ-028)");
      // Frequency sort: freq-common (30 tasks) must appear before any zzz-rare-* (1 task each).
      const freqPos = freqPage.body.indexOf("freq-common");
      const rarePos = freqPage.body.indexOf("zzz-rare-");
      assert(freqPos !== -1 && rarePos !== -1 && freqPos < rarePos,
        `GET / freq-common appears before zzz-rare-* labels in nav (QX-026, UQ-028): freqPos=${freqPos}, rarePos=${rarePos}`);

      // --- QX-026b (UQ-027): active label pinned to front if it would be hidden ---
      // Filter by zzz-rare-z — this label is alphabetically last among 27 total labels,
      // so without pinning it would be hidden (position >25). With pinning it must be visible.
      const pinnedPage = await get(qx26Port, "/?label=zzz-rare-z");
      assert(pinnedPage.status === 200, "GET /?label=zzz-rare-z returns 200 (QX-026, UQ-027)");
      // The active label must appear in the nav with a remove link (bold + "remove").
      assert(pinnedPage.body.includes("zzz-rare-z"),
        "GET /?label=zzz-rare-z shows active label zzz-rare-z in nav (QX-026, UQ-027)");
      assert(pinnedPage.body.includes("remove"),
        "GET /?label=zzz-rare-z shows remove link for active label (QX-026, UQ-027)");

      // --- QX-026c: hidden count reflects correct number of non-visible labels ---
      // Total distinct labels: 1 (freq-common) + 26 (zzz-rare-a..z) = 27.
      // Without active pin: visibleLabels = first 25 (freq-common + zzz-rare-a..zzz-rare-x).
      // hidden = 27 - 25 = 2 (zzz-rare-y and zzz-rare-z).
      // Check "more labels" appears (not exact count check since pinning may shift it).
      assert(freqPage.body.includes("more labels"),
        "GET / with 27 labels shows 'more labels' truncation note (QX-026)");

      // --- QX-027 (UQ-029): search placeholder updated ---
      assert(freqPage.body.includes("Search titles and descriptions"),
        "GET / search input placeholder says 'Search titles and descriptions' not 'Search titles' (QX-027, UQ-029)");
      assert(!freqPage.body.includes('placeholder="Search titles…"'),
        "GET / old placeholder 'Search titles…' no longer present (QX-027, UQ-029)");

      // --- QX-028 (CB-017): heading-excluded body search (dedicated minimal workspace) ---
      // Use a separate server with only 2 tasks to avoid pagination interfering with results.
    } finally {
      if (qx26Server) {
        qx26Server.close();
        if (qx26Server.client) await qx26Server.client.close();
      }
      process.chdir(qx26OrigCwd);
      fs.rmSync(qx26TasksDir, { recursive: true, force: true });
      fs.rmSync(qx26WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- QX-028 (experiment 4, iteration 7): body search heading exclusion (CB-017) ---
  // Dedicated minimal server with exactly 2 tasks: one heading-only body, one prose body.
  {
    const qx28TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx28-test-"));
    const qx28WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx28-workspace-"));
    fs.mkdirSync(path.join(qx28WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx28WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx28TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx28TasksDir.replaceAll("\\", "\\\\")}"\n`
    );
    // HDNG-1: body is ONLY heading lines — no prose content at all.
    // Searching "Proposal" must NOT return this task (headings stripped).
    execFileSync("node", [nativeBin, "task", "create", "HDNG-1", "--title", "Heading-only body task",
      "--status", "todo", "--body", "## Proposal\n## Plan\n## AC\n## DoD\n"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx28TasksDir },
    });
    // HDNG-2: body has a unique prose token "xyzzy-prose-only-42z" in a non-heading line.
    // This token must NOT contain "Proposal" or "Plan" (to avoid matching the exclusion test).
    // The heading line "## Proposal" is present but must be stripped before search indexing.
    execFileSync("node", [nativeBin, "task", "create", "HDNG-2", "--title", "Prose body task",
      "--status", "todo", "--body", "## Proposal\n## Plan\nThis line has xyzzy-prose-only-42z token.\n## AC\n## DoD\n"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: qx28TasksDir },
    });

    const qx28Port = port + 9;
    const qx28OrigCwd = process.cwd();
    let qx28Server;
    try {
      process.chdir(qx28WorkspaceRoot);
      qx28Server = await startServer({ port: qx28Port });

      // Search for "Proposal" — HDNG-1 must NOT match (headings stripped, no prose),
      // HDNG-2 must NOT match either (its prose is "xyzzy-prose-only-42z" — does not contain "Proposal").
      // Neither task should appear when searching for the heading term "Proposal".
      const headingSearch = await get(qx28Port, "/?q=Proposal");
      assert(headingSearch.status === 200, "GET /?q=Proposal returns 200 (QX-028, CB-017)");
      assert(!headingSearch.body.includes("HDNG-1"),
        "GET /?q=Proposal excludes HDNG-1 (heading-only body, headings stripped) (QX-028, CB-017)");
      assert(!headingSearch.body.includes("HDNG-2"),
        "GET /?q=Proposal excludes HDNG-2 (prose lacks 'Proposal'; heading stripped) (QX-028, CB-017)");

      // Search for the unique prose token — must match HDNG-2, not HDNG-1.
      const proseSearch = await get(qx28Port, "/?q=xyzzy-prose-only-42z");
      assert(proseSearch.status === 200, "GET /?q=unique-prose-token returns 200 (QX-028, CB-017)");
      assert(proseSearch.body.includes("HDNG-2"),
        "GET /?q=unique-prose-token includes HDNG-2 (prose under heading is searchable) (QX-028, CB-017)");
      assert(!proseSearch.body.includes("HDNG-1"),
        "GET /?q=unique-prose-token excludes HDNG-1 (heading-only, no prose match) (QX-028, CB-017)");

    } finally {
      if (qx28Server) {
        qx28Server.close();
        if (qx28Server.client) await qx28Server.client.close();
      }
      process.chdir(qx28OrigCwd);
      fs.rmSync(qx28TasksDir, { recursive: true, force: true });
      fs.rmSync(qx28WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // ---- QX-034 (experiment 4, iteration 9) block — usability polish:
  //      label counts (UQ-032), details/summary expand (UQ-033), search
  //      result count banner (UQ-031). ----
  //
  // Fixture: a workspace with tasks carrying multiple labels, so the label
  // nav renders with counts and the "N more labels" overflow.
  {
    const nativeBin = path.resolve(__dirname, "../../quay-native/bin/quay-native.js");
    const nativeProviderDir = path.resolve(__dirname, "../../quay-native");

    const qx34TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx34-tasks-"));
    const qx34WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx34-workspace-"));
    fs.mkdirSync(path.join(qx34WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx34WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx34TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}","mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx34TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // Create tasks with various labels. We need enough labels to trigger the
    // LABEL_NAV_MAX=25 truncation so the details/summary expand appears.
    // We'll create 30 distinct labels (A-label-01..A-label-20 + B-label-01..B-label-10),
    // plus a known "common-label" that appears on 3 tasks to verify the count display.
    const envOverride = { ...process.env, QUAY_NATIVE_TASKS_DIR: qx34TasksDir };
    const COMMON_LABEL = "common-label";
    const SEARCH_TERM = "searchable-unique-qx34";

    // Create 3 tasks with common-label (count should be 3 in nav)
    for (let i = 1; i <= 3; i++) {
      const id = `QX34-${String(i).padStart(2, "0")}`;
      const title = i === 1 ? `Task with ${SEARCH_TERM} in title` : `Task ${id}`;
      execFileSync("node", [nativeBin, "task", "create", id,
        "--title", title,
        "--status", "todo",
        "--labels", `${COMMON_LABEL},A-label-${String(i).padStart(2, "0")}`],
        { env: envOverride });
    }
    // Create 22 more tasks each with a unique rare label to push total distinct labels > 25
    for (let i = 4; i <= 25; i++) {
      const id = `QX34-${String(i).padStart(2, "0")}`;
      execFileSync("node", [nativeBin, "task", "create", id,
        "--title", `Task ${id}`,
        "--status", "todo",
        "--labels", `rare-label-${String(i).padStart(2, "0")}`],
        { env: envOverride });
    }

    const qx34Port = port + 10;
    const qx34OrigCwd = process.cwd();
    let qx34Server;
    try {
      process.chdir(qx34WorkspaceRoot);
      qx34Server = await startServer({ port: qx34Port });

      // Test 1 (UQ-032): label count display — nav should show "common-label (3)"
      const homeResp = await get(qx34Port, "/");
      assert(homeResp.status === 200, "GET / returns 200 (QX-034 setup)");
      assert(homeResp.body.includes(`common-label (3)`),
        `Label nav shows count: "common-label (3)" should appear in HTML (UQ-032, QX-034)`);
      assert(homeResp.body.match(/A-label-0[123] \(\d+\)/),
        "Label nav shows per-label counts for A-label-* entries (UQ-032, QX-034)");

      // Test 2 (UQ-033): details/summary expand — with 25+ distinct labels, the
      // "N more labels" overflow should be rendered as a <details> element.
      assert(homeResp.body.includes("<details"),
        "Label nav overflow rendered as <details> element (UQ-033, QX-034)");
      assert(homeResp.body.includes("<summary>"),
        "Label nav overflow <details> has <summary> child (UQ-033, QX-034)");
      assert(homeResp.body.includes("more labels"),
        "Label nav overflow summary contains 'more labels' text (UQ-033, QX-034)");

      // Test 3 (UQ-031): search result count banner — GET /?q=<term> shows count line
      const searchResp = await get(qx34Port, `/?q=${encodeURIComponent(SEARCH_TERM)}`);
      assert(searchResp.status === 200, "GET /?q=<term> returns 200 (QX-034 search banner)");
      assert(searchResp.body.includes("results for"),
        `Search result banner contains "results for" when ?q= is active (UQ-031, QX-034)`);
      assert(searchResp.body.includes(SEARCH_TERM),
        `Search result banner includes the search query term (UQ-031, QX-034)`);

    } finally {
      if (qx34Server) {
        qx34Server.close();
        if (qx34Server.client) await qx34Server.client.close();
      }
      process.chdir(qx34OrigCwd);
      fs.rmSync(qx34TasksDir, { recursive: true, force: true });
      fs.rmSync(qx34WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // ---- QX-037 (experiment 4, iteration 10) block — filter-scoped label counts (UQ-034) ----
  //
  // Fixture: tasks where a "mixed-label" appears on both todo and done tasks.
  // When filtered to ?status=todo, the label count badge should show only the
  // count of todo tasks with that label (2), NOT the global total (5).
  {
    const qx37TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx37-tasks-"));
    const qx37WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx37-workspace-"));
    fs.mkdirSync(path.join(qx37WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx37WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx37TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}","mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx37TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    const envOverride37 = { ...process.env, QUAY_NATIVE_TASKS_DIR: qx37TasksDir };
    const MIXED_LABEL = "mixed-status-label";

    // Create 2 todo tasks with MIXED_LABEL
    for (let i = 1; i <= 2; i++) {
      const id = `SC37-TODO-${i}`;
      execFileSync("node", [nativeBin, "task", "create", id,
        "--title", `Todo task ${i}`,
        "--status", "todo",
        "--labels", MIXED_LABEL],
        { env: envOverride37 });
    }
    // Create 3 done tasks with MIXED_LABEL (global total = 5, todo-scoped = 2)
    for (let i = 1; i <= 3; i++) {
      const id = `SC37-DONE-${i}`;
      execFileSync("node", [nativeBin, "task", "create", id,
        "--title", `Done task ${i}`,
        "--status", "done",
        "--labels", MIXED_LABEL],
        { env: envOverride37 });
    }

    let qx37Server = null;
    const qx37OrigCwd = process.cwd();
    try {
      process.chdir(qx37WorkspaceRoot);
      const qx37Port = port + 11;
      qx37Server = await startServer({ port: qx37Port });

      // Unfiltered page: mixed-status-label should show count 5 (global total)
      const unfilteredResp = await get(qx37Port, "/");
      assert(unfilteredResp.status === 200, "GET / returns 200 (QX-037 setup)");
      assert(
        unfilteredResp.body.includes(`${MIXED_LABEL} (5)`),
        `Unfiltered page shows global count 5 for ${MIXED_LABEL} (UQ-034, QX-037)`
      );

      // Status=todo filter: mixed-status-label should show filter-scoped count 2
      const todoResp = await get(qx37Port, "/?status=todo");
      assert(todoResp.status === 200, "GET /?status=todo returns 200 (QX-037)");
      assert(
        todoResp.body.includes(`${MIXED_LABEL} (2)`),
        `?status=todo page shows filter-scoped count 2 for ${MIXED_LABEL} (UQ-034, QX-037)`
      );
      assert(
        !todoResp.body.includes(`${MIXED_LABEL} (5)`),
        `?status=todo page does NOT show global count 5 for ${MIXED_LABEL} (UQ-034, QX-037)`
      );

    } finally {
      if (qx37Server) {
        qx37Server.close();
        if (qx37Server.client) await qx37Server.client.close();
      }
      process.chdir(qx37OrigCwd);
      fs.rmSync(qx37TasksDir, { recursive: true, force: true });
      fs.rmSync(qx37WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // ---- QX-041 (experiment 4, iteration 11) block — stripHeadings() code-block fix (SH-003) ----
  //
  // Fixture: a task whose body contains a fenced code block with a `# bash comment` line.
  // Before the fix, stripHeadings() would strip that line from the search index, making
  // the task invisible when searching for "bash-comment-token". After the fix, lines inside
  // fences are preserved and the task IS found.
  // Also verifies that a genuine structural heading (## Proposal) outside a fence IS
  // still stripped (i.e., the task is NOT found when searching for "Proposal-outside-fence").
  {
    const qx41TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx41-tasks-"));
    const qx41WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx41-workspace-"));
    fs.mkdirSync(path.join(qx41WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx41WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx41TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}","mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx41TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    const envOverride41 = { ...process.env, QUAY_NATIVE_TASKS_DIR: qx41TasksDir };

    // Create a task with a fenced code block containing # bash-comment-token
    // and a genuine heading outside the fence (## Proposal-outside-fence)
    const taskBody = [
      "## Proposal-outside-fence",
      "",
      "Some body text with a code sample:",
      "",
      "```bash",
      "# bash-comment-token",
      "echo hello",
      "```",
      "",
      "End of body.",
    ].join("\n");

    const taskFile = path.join(qx41TasksDir, "SH03-1.md");
    fs.writeFileSync(taskFile, [
      "---",
      "id: SH03-1",
      "title: Task with code-block hash comments",
      "status: todo",
      "labels: []",
      "---",
      taskBody,
    ].join("\n"));

    let qx41Server = null;
    const qx41OrigCwd = process.cwd();
    try {
      process.chdir(qx41WorkspaceRoot);
      const qx41Port = port + 12;
      qx41Server = await startServer({ port: qx41Port });

      // Search for the fenced code block content — should be found (SH-003 fix)
      const foundResp = await get(qx41Port, "/?q=bash-comment-token");
      assert(foundResp.status === 200, "GET /?q=bash-comment-token returns 200 (QX-041 setup)");
      assert(
        foundResp.body.includes("SH03-1"),
        "Task with # comment in fenced code block IS found by search (SH-003, QX-041)"
      );

      // Search for heading text outside fence — should NOT be found (still stripped)
      const notFoundResp = await get(qx41Port, "/?q=Proposal-outside-fence");
      assert(notFoundResp.status === 200, "GET /?q=Proposal-outside-fence returns 200 (QX-041 negative)");
      assert(
        !notFoundResp.body.includes("SH03-1"),
        "Task heading outside fence is still stripped from search index (QX-041 negative control)"
      );

    } finally {
      if (qx41Server) {
        qx41Server.close();
        if (qx41Server.client) await qx41Server.client.close();
      }
      process.chdir(qx41OrigCwd);
      fs.rmSync(qx41TasksDir, { recursive: true, force: true });
      fs.rmSync(qx41WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // ---- QX-043 (experiment 4, iteration 11) block — search form order + label nav (UQ-030, UQ-006) ----
  //
  // Verifies that the search form HTML (`<input name="q"`) appears BEFORE the label nav
  // (`Label:`) in the list-page response (UQ-030 fix). Also verifies label nav is wrapped
  // in `.label-nav-wrap` div for horizontal scroll on mobile (UQ-006).
  {
    const qx43TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx43-tasks-"));
    const qx43WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx43-workspace-"));
    fs.mkdirSync(path.join(qx43WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx43WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx43TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}","mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx43TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    const envOverride43 = { ...process.env, QUAY_NATIVE_TASKS_DIR: qx43TasksDir };

    // Create a task with a label so label nav renders
    execFileSync("node", [nativeBin, "task", "create", "UQ30-1",
      "--title", "Task with label",
      "--status", "todo",
      "--labels", "test-label"],
      { env: envOverride43 });

    let qx43Server = null;
    const qx43OrigCwd = process.cwd();
    try {
      process.chdir(qx43WorkspaceRoot);
      const qx43Port = port + 13;
      qx43Server = await startServer({ port: qx43Port });

      const homeResp = await get(qx43Port, "/");
      assert(homeResp.status === 200, "GET / returns 200 (QX-043 setup)");

      // Search form should appear BEFORE label nav (UQ-030).
      // Use the <div class="label-nav-wrap"> opening tag in the HTML body (not the CSS class
      // definition in <style>, which would appear earlier due to pageStyles() position).
      const searchFormPos = homeResp.body.indexOf('name="q"');
      const labelNavDivPos = homeResp.body.indexOf('<div class="label-nav-wrap">');
      assert(
        searchFormPos !== -1 && labelNavDivPos !== -1 && searchFormPos < labelNavDivPos,
        `Search form (name="q") appears before label nav div in HTML body (UQ-030, QX-043). searchFormPos=${searchFormPos}, labelNavDivPos=${labelNavDivPos}`
      );

      // Label nav should be wrapped in .label-nav-wrap div (UQ-006)
      assert(
        homeResp.body.includes('<div class="label-nav-wrap">'),
        "Label nav is wrapped in .label-nav-wrap container for mobile scroll (UQ-006, QX-043)"
      );

    } finally {
      if (qx43Server) {
        qx43Server.close();
        if (qx43Server.client) await qx43Server.client.close();
      }
      process.chdir(qx43OrigCwd);
      fs.rmSync(qx43TasksDir, { recursive: true, force: true });
      fs.rmSync(qx43WorkspaceRoot, { recursive: true, force: true });
    }
  }

  console.log(failures === 0 ? "\nAll QN-031 serve/action regression tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
