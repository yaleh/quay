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

      // --- QX-015 (UQ-003): orientation banner on list page ---
      const listForBanner = await get(ux3Port, "/");
      assert(listForBanner.status === 200, "GET / (UX3 server) returns 200");
      assert(
        listForBanner.body.includes("orientation-banner"),
        "GET / list page includes orientation-banner class (QX-015, UQ-003)"
      );
      assert(
        listForBanner.body.includes("AI-assisted task management"),
        "GET / list page orientation banner includes project description text (QX-015)"
      );
      assert(
        listForBanner.body.includes("todo"),
        "GET / list page orientation banner mentions status lifecycle (QX-015)"
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

      // --- CR-010 / UQ-016: orientation banner must say 'ready', not 'in_progress' ---
      assert(
        !listForBanner.body.includes("in_progress"),
        "GET / orientation banner does NOT contain 'in_progress' (non-existent status) (CR-010, UQ-016)"
      );
      assert(
        listForBanner.body.includes("ready"),
        "GET / orientation banner contains 'ready' (actual status in model) (CR-010, UQ-016)"
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

  console.log(failures === 0 ? "\nAll QN-031 serve/action regression tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
