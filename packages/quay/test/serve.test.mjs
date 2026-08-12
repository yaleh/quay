// @test-group product
// @load-sensitive child-spawn
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file binds
// ephemeral HTTP ports, spawns real quay-native CLI processes (execFileSync), and chdirs across
// isolated workspaces; it passes isolated under low load but failed under full-suite cc8 concurrency
// (2026-08-08 07:06:49, 1/0 in isolation both primary and integration worktrees). Predeclared marker so
// its isolation-pass can legitimately release the red window (gap-load-sensitive-requires-predeclared-marker).
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
import { startServer } from "../src/serve.ts";
import { composePayload } from "../src/action.ts";
import { readLive, readJournal } from "../src/observation.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";
// gap-web-cannot-show-what-the-loop-is-doing-now (AC2): /live's in-flight list must match
// `fast-mode-telemetry.ts --report --json`'s inProgress ENTRY BY ENTRY. The strongest pin is to
// compare observation.ts's pairing against the REAL aggregate()/readAllEvents the CLI itself
// runs (fast-mode-telemetry.ts --report calls these same functions). Importing them here is the
// no-spawn equivalent of running `--report --json` against the same fixtures.
import { readAllEvents, aggregate } from "../../../plugin/scripts/fast-mode-telemetry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// gap-tests-spawn-cli-from-ts-source (AC9): route native CLI fixture-seeding
// through the prebuilt dist bundle (freshness-checked by cli-entry.mjs) instead
// of the .ts source. The provider cwd (config.yml `path:`) stays pinned to the
// SOURCE bin dir — it is independent of which entry binary mcp_entry launches.
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// gap-tests-use-cli-where-module-import-suffices (AC1/AC2): fixture seeding now
// goes through the quay-native store module's write() — the SAME validated
// write path the CLI's `task create` subcommand uses (bin/quay-native.ts is a
// thin wrapper over store.write(id, {title, status, labels, body})), so this
// preserves every write semantic the fixtures depend on (status whitelist
// validation, ADV-004 path-traversal guard, M89 post-write YAML validation,
// M35 parent/children relation sync) WITHOUT spawning a Node process per
// fixture. All serve fixtures below are flat id/title/status/labels/body
// pure-data tasks — none depend on cross-file write semantics (parent/child
// relation sync), so every one classifies as "pure data → seedTask()". The one
// retained real CLI invocation (the primary SRV-1/SRV-2 block) is the AC7
// end-to-end entry-wiring proof (a broken `quay-native task create` would go
// silent if we sank every spawn).
function seedTask(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

let failures = 0;
let _lastAssertMs = 0; // AC1b assertion-gap timing (gap-suite-cost-model-is-wrong-optimizations-buy-nothing)
function assert(cond, msg) {
  if (process.env.QUAY_TEST_ASSERT_TIMING) {
    const now = Date.now();
    if (_lastAssertMs) {
      const gap = now - _lastAssertMs;
      if (gap >= 1000) console.error(`[timing] +${Math.round(gap)}ms: ${String(msg).slice(0, 80)}`);
    }
    _lastAssertMs = now;
  }
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
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-workspace-"));

  // Two tasks: one at `todo` (has a matching action_button per provider.yml's
  // whenStatus: ["todo","ready"]) and one at `done` (NO matching action
  // button — the negative control, mirroring QN-030's GAME-C discipline).
  // AC7 (≥1 real end-to-end call): these TWO fixtures are the retained real
  // `quay-native task create` invocations for this file — they prove the CLI
  // entry actually connects, so a broken entry cannot go silent. Every other
  // fixture below sinks to the validated store write (seedTask). SRV-1 also
  // carries a `--labels` flag so the retained CLI call still exercises the
  // CLI's own comma-splitting/validation path (the sunk fixtures pass labels
  // as store arrays directly), keeping per-file CLI-flag coverage intact.
  execFileSync("node", [nativeBin, "task", "create", "SRV-1", "--title", "Servable task one",
    "--status", "todo", "--body", VALID_SECTIONS, "--labels", "cli-flag-proof"], {
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

  const originalCwd = process.cwd();
  let server;
  try {
    // serve.js's startServer() calls loadConfig() with no args (cwd-relative
    // upward search, config.js's own findConfig() convention) — chdir into
    // the isolated workspace so it resolves this test's own throwaway config,
    // not the real repo's .quay/config.yml.
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // --- GET / (list) ---
    const list = await get(port, "/");
    assert(list.status === 200, `GET / returns 200 (got ${list.status})`);
    assert(list.body.includes("SRV-1") && list.body.includes("SRV-2"),
      "GET / body contains both seeded task ids");
    assert(list.body.includes("todo") && list.body.includes("done"),
      "GET / body contains both seeded tasks' statuses");
    assert(list.body.includes("Servable task one"),
      "GET / body contains the seeded task's title");

    // --- GET /task/<id> (detail) ---
    // The web action-buttons POST route and its form renders were removed
    // (gap-web-action-buttons-unused-route-and-open-redirect-delete), so the
    // detail page no longer renders an Advance button. The detail page itself
    // still returns 200 and renders the task's data.
    const detail1 = await get(port, "/task/SRV-1");
    assert(detail1.status === 200, `GET /task/SRV-1 returns 200 (got ${detail1.status})`);

    // --- GET /task/<id> (detail, done status) ---
    const detail2 = await get(port, "/task/SRV-2");
    assert(detail2.status === 200, `GET /task/SRV-2 returns 200 (got ${detail2.status})`);

    // --- GET /task/<nonexistent> -> 404 ---
    const notFound = await get(port, "/task/NOPE-999");
    assert(notFound.status === 404, `GET /task/NOPE-999 returns 404 (got ${notFound.status})`);
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
    // Pure-data fixture (flat id/title/status/body; no write semantics) → store write.
    seedTask(pfxTasksDir, "PFXA-1", { title: "Prefix A task", status: "todo", body: VALID_SECTIONS });
    seedTask(pfxTasksDir, "PFXB-1", { title: "Prefix B task", status: "done", body: VALID_SECTIONS });

    const pfxOriginalCwd = process.cwd();
    let pfxServer;
    try {
      process.chdir(pfxWorkspaceRoot);
      pfxServer = await startServer({ port: 0 });
      const pfxPort = pfxServer.address().port;

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
    // Pure-data fixtures (distinct mtime via the spin-waits between writes; the
    // store write uses fs.writeFileSync so mtime ordering is preserved) → store write.
    seedTask(sortTasksDir, "SRT-A", { title: "Sort A (oldest)", status: "todo", body: VALID_SECTIONS });
    const t0 = Date.now(); while (Date.now() - t0 < 50) { /* spin wait for distinct mtime */ }
    seedTask(sortTasksDir, "SRT-B", { title: "Sort B (middle)", status: "todo", body: VALID_SECTIONS });
    const t1 = Date.now(); while (Date.now() - t1 < 50) { /* spin */ }
    seedTask(sortTasksDir, "SRT-C", { title: "Sort C (most recent)", status: "todo", body: VALID_SECTIONS });

    const sortOrigCwd = process.cwd();
    let sortServer;
    try {
      process.chdir(sortWorkspaceRoot);
      sortServer = await startServer({ port: 0 });
      const sortPort = sortServer.address().port;

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
  //     error/success banners, orientation banner ---
  // Uses a fresh isolated server with one todo task (AC section with no
  // checkboxes, for error-banner rendering) and one todo task with all ACs checked
  // (for back-link testing). The web action-buttons POST route's gate-fail/gate-pass
  // redirect tests that lived here were REMOVED with the route itself
  // (gap-web-action-buttons-unused-route-and-open-redirect-delete); the read-only
  // banner-rendering assertions are kept (AC5).
  {
    const ux3TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-ux3-test-"));
    const ux3WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-ux3-workspace-"));
    fs.mkdirSync(path.join(ux3WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(ux3WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${ux3TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${ux3TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // UX3-1: todo with all ACs checked (gate passes) — tests back-link, tooltip, success redirect
    // UX3-2: todo with an AC section that has NO checkboxes — tests gate-fail
    //        redirect and error banner
    // Pure-data fixtures (the gate-pass/fail distinction lives in the BODY text,
    // not in any write semantic) → store write.
    seedTask(ux3TasksDir, "UX3-1", { title: "Gate-pass task (todo, all ACs checked)", status: "todo", body: VALID_SECTIONS });
    // gap-both-gates-read-one-signal-so-done-costs-nothing: an unchecked AC box
    // no longer fails author->ready (checked-state belongs to ready->done), so
    // the gate-block fixture must instead be an AC section with NO checkboxes.
    const UNCHECKED_SECTIONS =
      "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
      "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
      "## AC\nThis acceptance criteria section is prose only, with no machine-checkable checkbox lines at all, comfortably past forty non-whitespace characters.\n" +
      "## DoD\n- [ ] a sufficiently long definition-of-done line — NOT YET CHECKED\n";
    seedTask(ux3TasksDir, "UX3-2", { title: "Gate-blocked task (todo, AC has no checkboxes)", status: "todo", body: UNCHECKED_SECTIONS });

    const ux3OrigCwd = process.cwd();
    let ux3Server;
    try {
      process.chdir(ux3WorkspaceRoot);
      ux3Server = await startServer({ port: 0 });
      const ux3Port = ux3Server.address().port;

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

  // --- QX-016..QX-019 (experiment 4, iteration 4): multi-label filter, updatedAt
  //     display, and target-status tooltip backport (the former M33 G-S4-01 POST
  //     action-route banner-honesty block and the sticky .col-actions CSS checks
  //     were REMOVED with the web action-buttons route —
  //     gap-web-action-buttons-unused-route-and-open-redirect-delete; CLI-side
  //     deliverTrigger() banner honesty remains covered by
  //     action-mock-delivery.test.mjs / serve-action-delivery.test.mjs) ---
  {
    const qx16TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx16-test-"));
    const qx16WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-qx16-workspace-"));
    fs.mkdirSync(path.join(qx16WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx16WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx16TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx16TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // BOTH-1: has both labels "bug" and "cli"; BUGONLY-1: only "bug"; NOLAB-1: none.
    // Pure-data fixtures (labels are a plain array in frontmatter) → store write.
    seedTask(qx16TasksDir, "BOTH-1", { title: "Has both labels", status: "todo", body: VALID_SECTIONS, labels: ["bug", "cli"] });
    seedTask(qx16TasksDir, "BUGONLY-1", { title: "Has only bug label", status: "todo", body: VALID_SECTIONS, labels: ["bug"] });
    seedTask(qx16TasksDir, "NOLAB-1", { title: "Has no labels", status: "done", body: VALID_SECTIONS });

    const qx16OrigCwd = process.cwd();
    let qx16Server;
    try {
      process.chdir(qx16WorkspaceRoot);
      qx16Server = await startServer({ port: 0 });
      const qx16Port = qx16Server.address().port;

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

    // TOGGLE-1: labels "alpha"+"beta"; TOGGLE-2: "alpha" only; TOGGLE-3: "gamma" only (done).
    // Pure-data fixtures (labels as plain array) → store write.
    seedTask(qx20TasksDir, "TOGGLE-1", { title: "Alpha beta task", status: "todo", body: VALID_SECTIONS, labels: ["alpha", "beta"] });
    seedTask(qx20TasksDir, "TOGGLE-2", { title: "Alpha only task", status: "todo", body: VALID_SECTIONS, labels: ["alpha"] });
    seedTask(qx20TasksDir, "TOGGLE-3", { title: "Gamma search task", status: "done", body: VALID_SECTIONS, labels: ["gamma"] });

    const qx20OrigCwd = process.cwd();
    let qx20Server;
    try {
      process.chdir(qx20WorkspaceRoot);
      qx20Server = await startServer({ port: 0 });
      const qx20Port = qx20Server.address().port;

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

    // BSRCH-1: unique term ONLY in body, not in title; BSRCH-2: control (no match).
    // Pure-data fixtures (search-behavior distinction lives in body text) → store write.
    const bodyOnlyBody = VALID_SECTIONS + "\nThis body contains xyzzy-unique-body-term here.\n";
    seedTask(qx23TasksDir, "BSRCH-1", { title: "Unrelated title only", status: "todo", body: bodyOnlyBody });
    seedTask(qx23TasksDir, "BSRCH-2", { title: "Other task no match", status: "todo", body: VALID_SECTIONS });
    // QX-024 setup: 30 tasks with distinct labels (label-01 through label-30)
    // to trigger the "more labels" truncation threshold (25). Pure data → store write.
    for (let i = 1; i <= 30; i++) {
      const labelId = `LBL${String(i).padStart(2, "0")}`;
      const labelName = `label-${String(i).padStart(2, "0")}`;
      seedTask(qx23TasksDir, labelId, { title: `Label task ${i}`, status: "todo", body: VALID_SECTIONS, labels: [labelName] });
    }

    const qx23OrigCwd = process.cwd();
    let qx23Server;
    try {
      process.chdir(qx23WorkspaceRoot);
      qx23Server = await startServer({ port: 0 });
      const qx23Port = qx23Server.address().port;

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
    // Pure-data fixtures (30 freq-common + 26 rare-label tasks; label frequency
    // is derived from the label arrays by serve, no write semantics) → store write.
    for (let i = 1; i <= 30; i++) {
      seedTask(qx26TasksDir, `FREQ-${String(i).padStart(2, "0")}`, { title: `Freq task ${i}`, status: "todo", body: VALID_SECTIONS, labels: ["freq-common"] });
    }
    // 26 rare labels (zzz-rare-a through zzz-rare-z) each on 1 task.
    // With freq sort, "freq-common" (30 tasks) beats all of these.
    for (let i = 0; i < 26; i++) {
      const rareLabel = `zzz-rare-${String.fromCharCode(97 + i)}`; // zzz-rare-a .. zzz-rare-z
      seedTask(qx26TasksDir, `RARE-${String.fromCharCode(65 + i)}`, { title: `Rare label task ${i}`, status: "todo", body: VALID_SECTIONS, labels: [rareLabel] });
    }
    // Active label that would be position >25 alphabetically but should appear due to pinning.
    // "zzz-rare-z" is the last alphabetically of the rare labels and won't appear in top-25
    // by frequency (all have count=1; "freq-common" has count=30 and takes position 1;
    // the 26 rare labels fill positions 2-27, but only 24 fit within the 25-slot cap after
    // "freq-common"). The last ones alphabetically ("zzz-rare-x", "zzz-rare-y", "zzz-rare-z")
    // will be beyond position 25. Filter by "zzz-rare-z" to trigger the pin.

    const qx26OrigCwd = process.cwd();
    let qx26Server;
    try {
      process.chdir(qx26WorkspaceRoot);
      qx26Server = await startServer({ port: 0 });
      const qx26Port = qx26Server.address().port;

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
    // HDNG-2: body has a unique prose token "xyzzy-prose-only-42z" in a non-heading line.
    // Pure-data fixtures (search-index behavior lives in body text) → store write.
    seedTask(qx28TasksDir, "HDNG-1", { title: "Heading-only body task", status: "todo", body: "## Proposal\n## Plan\n## AC\n## DoD\n" });
    seedTask(qx28TasksDir, "HDNG-2", { title: "Prose body task", status: "todo", body: "## Proposal\n## Plan\nThis line has xyzzy-prose-only-42z token.\n## AC\n## DoD\n" });

    const qx28OrigCwd = process.cwd();
    let qx28Server;
    try {
      process.chdir(qx28WorkspaceRoot);
      qx28Server = await startServer({ port: 0 });
      const qx28Port = qx28Server.address().port;

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
    const nativeBin = QUAY_NATIVE_CLI;
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
    const COMMON_LABEL = "common-label";
    const SEARCH_TERM = "searchable-unique-qx34";

    // Create 3 tasks with common-label (count should be 3 in nav)
    // Pure-data fixtures (labels as plain arrays) → store write.
    for (let i = 1; i <= 3; i++) {
      const id = `QX34-${String(i).padStart(2, "0")}`;
      const title = i === 1 ? `Task with ${SEARCH_TERM} in title` : `Task ${id}`;
      seedTask(qx34TasksDir, id, { title, status: "todo", labels: [COMMON_LABEL, `A-label-${String(i).padStart(2, "0")}`] });
    }
    // Create 22 more tasks each with a unique rare label to push total distinct labels > 25
    for (let i = 4; i <= 25; i++) {
      const id = `QX34-${String(i).padStart(2, "0")}`;
      seedTask(qx34TasksDir, id, { title: `Task ${id}`, status: "todo", labels: [`rare-label-${String(i).padStart(2, "0")}`] });
    }

    const qx34OrigCwd = process.cwd();
    let qx34Server;
    try {
      process.chdir(qx34WorkspaceRoot);
      qx34Server = await startServer({ port: 0 });
      const qx34Port = qx34Server.address().port;

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

    const MIXED_LABEL = "mixed-status-label";

    // Create 2 todo tasks with MIXED_LABEL, and 3 done tasks (global total = 5, todo-scoped = 2).
    // Pure-data fixtures (counts derived from status+labels in frontmatter) → store write.
    for (let i = 1; i <= 2; i++) {
      seedTask(qx37TasksDir, `SC37-TODO-${i}`, { title: `Todo task ${i}`, status: "todo", labels: [MIXED_LABEL] });
    }
    for (let i = 1; i <= 3; i++) {
      seedTask(qx37TasksDir, `SC37-DONE-${i}`, { title: `Done task ${i}`, status: "done", labels: [MIXED_LABEL] });
    }

    let qx37Server = null;
    const qx37OrigCwd = process.cwd();
    try {
      process.chdir(qx37WorkspaceRoot);
      qx37Server = await startServer({ port: 0 });
      const qx37Port = qx37Server.address().port;

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
      qx41Server = await startServer({ port: 0 });
      const qx41Port = qx41Server.address().port;

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

    // Pure-data fixture (one labeled task so label nav renders) → store write.
    seedTask(qx43TasksDir, "UQ30-1", { title: "Task with label", status: "todo", labels: ["test-label"] });

    let qx43Server = null;
    const qx43OrigCwd = process.cwd();
    try {
      process.chdir(qx43WorkspaceRoot);
      qx43Server = await startServer({ port: 0 });
      const qx43Port = qx43Server.address().port;

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

  // ---- QX-046 (experiment 4, iteration 12) block — search banner page indicator (UQ-035) ----
  //
  // When ?q= is active and results span multiple pages, the search result banner should show
  // "Showing N results for 'query' · Page X of Y" (page indicator suffix).
  // When results fit on one page, the banner should show "Showing N results for 'query'" (no suffix).
  //
  // Fixture: a workspace with 25 tasks all having "xyzzy-qx46" in title (to ensure all match
  // the search query). PAGE_SIZE=20, so 25 tasks → 2 pages. Page 1 should show "Page 1 of 2",
  // page 2 should show "Page 2 of 2". A search returning ≤20 results should NOT show page indicator.
  {
    const qx46TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx46-tasks-"));
    const qx46WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-qx46-workspace-"));
    fs.mkdirSync(path.join(qx46WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx46WorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${qx46TasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}","mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${qx46TasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // Create 25 tasks matching "xyzzy-qx46" in title. Pure-data fixtures → store write.
    for (let i = 1; i <= 25; i++) {
      const id = `PGSRCH-${String(i).padStart(2, "0")}`;
      seedTask(qx46TasksDir, id, { title: `xyzzy-qx46 task ${i}`, status: "todo" });
    }

    let qx46Server = null;
    const qx46OrigCwd = process.cwd();
    try {
      process.chdir(qx46WorkspaceRoot);
      qx46Server = await startServer({ port: 0 });
      const qx46Port = qx46Server.address().port;

      // Page 1: search returns 25 results across 2 pages → banner shows "Page 1 of 2"
      const page1Resp = await get(qx46Port, "/?q=xyzzy-qx46&page=1");
      assert(page1Resp.status === 200, "GET /?q=xyzzy-qx46&page=1 returns 200 (QX-046 setup)");
      assert(
        page1Resp.body.includes("Showing 25 results"),
        `Page 1 search banner shows total count (QX-046, UQ-035). body snippet: ${page1Resp.body.slice(0, 500)}`
      );
      assert(
        page1Resp.body.includes("Page 1 of 2"),
        `Page 1 search banner shows '· Page 1 of 2' indicator when results span 2 pages (QX-046, UQ-035). body snippet: ${page1Resp.body.slice(0, 500)}`
      );

      // Page 2: banner shows "Page 2 of 2"
      const page2Resp = await get(qx46Port, "/?q=xyzzy-qx46&page=2");
      assert(page2Resp.status === 200, "GET /?q=xyzzy-qx46&page=2 returns 200 (QX-046)");
      assert(
        page2Resp.body.includes("Page 2 of 2"),
        `Page 2 search banner shows '· Page 2 of 2' indicator (QX-046, UQ-035). body snippet: ${page2Resp.body.slice(0, 500)}`
      );

      // Single-page search (only 1 task matches unique term) → banner has NO page indicator
      // "xyzzy-qx46-unique-singleton" only appears in PGSRCH-01's title (add it now).
      // Pure-data fixture → store write.
      seedTask(qx46TasksDir, "PGSRCH-SINGLE", { title: "xyzzy-qx46-unique-singleton task", status: "todo" });

      const singleResp = await get(qx46Port, "/?q=xyzzy-qx46-unique-singleton");
      assert(singleResp.status === 200, "GET /?q=xyzzy-qx46-unique-singleton returns 200 (QX-046 single-page)");
      // Extract the search result banner (the blue p.meta element with color:#0066cc)
      // to verify it does NOT contain the "· Page X of Y" suffix when totalPages=1.
      // NOTE: pageNav separately renders "Page 1 of 1 (N tasks)" on the page — that is
      // expected and is not the element being tested here. We test that the BANNER itself
      // (the "Showing N results for…" paragraph) has no page indicator when 1 page.
      const singleBannerMatch = singleResp.body.match(/<p[^>]*color:#0066cc[^>]*>([^<]*)<\/p>/);
      const singleBannerText = singleBannerMatch ? singleBannerMatch[0] : "";
      assert(
        singleBannerText.includes("Showing 1 results") || singleBannerText.includes("Showing 1 result"),
        `Single-page search banner shows 1 result (QX-046, UQ-035). banner: ${singleBannerText}`
      );
      assert(
        !singleBannerText.includes("Page") && !singleBannerText.includes("·"),
        `Single-page search banner does NOT contain page indicator when totalPages=1 (QX-046, UQ-035). banner: ${singleBannerText}`
      );

    } finally {
      if (qx46Server) {
        qx46Server.close();
        if (qx46Server.client) await qx46Server.client.close();
      }
      process.chdir(qx46OrigCwd);
      fs.rmSync(qx46TasksDir, { recursive: true, force: true });
      fs.rmSync(qx46WorkspaceRoot, { recursive: true, force: true });
    }
  }

  // M08-merge-recover: ?pageSize=N on the Web UI list page (CB-006/CB-022).
  // Mirrors the CLI --page-size test in cli.test.mjs. 5 tasks, default
  // PAGE_SIZE=20 shows all on 1 page; ?pageSize=2 forces 3 pages (2+2+1) and
  // the page-size selector reflects the active value; an invalid ?pageSize=
  // value falls back to the default with a visible warning banner.
  {
    const pgszTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-pgsz-tasks-"));
    const pgszWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-test-pgsz-workspace-"));
    fs.mkdirSync(path.join(pgszWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(pgszWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${pgszTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}","mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${pgszTasksDir.replaceAll("\\", "\\\\")}"\n`
    );
    // Pure-data fixtures (5 flat tasks for pageSize tests) → store write.
    for (let i = 1; i <= 5; i++) {
      seedTask(pgszTasksDir, `PGSZ-${i}`, { title: `pgsz task ${i}`, status: "todo" });
    }

    let pgszServer = null;
    const pgszOrigCwd = process.cwd();
    try {
      process.chdir(pgszWorkspaceRoot);
      pgszServer = await startServer({ port: 0 });
      const pgszPort = pgszServer.address().port;

      // Default page size (20): all 5 tasks on page 1, "Page 1 of 1".
      const defaultResp = await get(pgszPort, "/");
      assert(defaultResp.status === 200, "GET / returns 200 (pageSize default)");
      assert(
        defaultResp.body.includes("Page 1 of 1 (5 tasks)"),
        `default page size shows all 5 tasks on 1 page. body snippet: ${defaultResp.body.slice(0, 300)}`
      );

      // ?pageSize=2: 5 tasks / 2 per page = 3 pages.
      const pgsz2Resp = await get(pgszPort, "/?pageSize=2");
      assert(pgsz2Resp.status === 200, "GET /?pageSize=2 returns 200");
      assert(
        pgsz2Resp.body.includes("Page 1 of 3"),
        `?pageSize=2 with 5 tasks shows 3 pages. body snippet: ${pgsz2Resp.body.slice(0, 300)}`
      );
      const pgsz2RowCount = (pgsz2Resp.body.match(/>PGSZ-\d</g) || []).length;
      assert(
        pgsz2RowCount === 2,
        `?pageSize=2 renders exactly 2 task rows on page 1 (got ${pgsz2RowCount})`
      );

      // Page 2 of the pageSize=2 view carries the pageSize param through page nav.
      const pgsz2Page2Resp = await get(pgszPort, "/?pageSize=2&page=2");
      assert(pgsz2Page2Resp.status === 200, "GET /?pageSize=2&page=2 returns 200");
      assert(
        pgsz2Page2Resp.body.includes("Page 2 of 3"),
        `?pageSize=2&page=2 shows 'Page 2 of 3'. body snippet: ${pgsz2Page2Resp.body.slice(0, 300)}`
      );

      // The page-size selector reflects a standard option (10/20/50/100) as active;
      // ?pageSize=2 is a custom (non-menu) value so none of the menu options are
      // highlighted for it — verify instead with a standard option, ?pageSize=10.
      const pgsz10Resp = await get(pgszPort, "/?pageSize=10");
      assert(pgsz10Resp.status === 200, "GET /?pageSize=10 returns 200");
      assert(
        /Page size:[\s\S]*?<strong>10<\/strong>/.test(pgsz10Resp.body),
        `?pageSize=10 page-size selector highlights 10 as active. body snippet: ${pgsz10Resp.body.slice(0, 500)}`
      );
      assert(
        pgsz10Resp.body.includes("Page 1 of 1 (5 tasks)"),
        `?pageSize=10 with 5 tasks shows 1 page. body snippet: ${pgsz10Resp.body.slice(0, 300)}`
      );

      // Invalid ?pageSize= value: falls back to default (20), with a warning banner —
      // NOT a silent full-list dump with no indication anything was wrong (UQ-048's
      // Web-UI-side analog).
      const pgszBadResp = await get(pgszPort, "/?pageSize=abc");
      assert(pgszBadResp.status === 200, "GET /?pageSize=abc returns 200 (falls back, does not error the page)");
      assert(
        pgszBadResp.body.includes("Page 1 of 1 (5 tasks)"),
        `?pageSize=abc falls back to the default page size (20 > 5 tasks -> 1 page). body snippet: ${pgszBadResp.body.slice(0, 300)}`
      );
      assert(
        pgszBadResp.body.includes("Invalid pageSize value ignored"),
        `?pageSize=abc renders a visible warning banner rather than silently falling back. body snippet: ${pgszBadResp.body.slice(0, 500)}`
      );

      const pgszZeroResp = await get(pgszPort, "/?pageSize=0");
      assert(
        pgszZeroResp.body.includes("Invalid pageSize value ignored"),
        "?pageSize=0 is also treated as invalid (warning banner shown)"
      );
    } finally {
      if (pgszServer) {
        pgszServer.close();
        if (pgszServer.client) await pgszServer.client.close();
      }
      process.chdir(pgszOrigCwd);
      fs.rmSync(pgszTasksDir, { recursive: true, force: true });
      fs.rmSync(pgszWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- M26-F4 (M26-adversarial-eval, Phase B hardening): a single malformed
  // task file (missing YAML frontmatter delimiters) among an otherwise-good
  // task store must not crash `quay serve`'s list route (GET /) — it should
  // degrade safely (clean 500, error logged, process stays up), not hang or
  // corrupt the good tasks already on disk. Found during the Phase A audit:
  // quay-native/src/store.js's parse() throws "malformed task file: missing
  // YAML frontmatter block" (store.js, parse()) with NO try/catch anywhere
  // in list()'s per-item get() loop, so ONE bad file poisons the ENTIRE
  // task_list call — verified directly against store.js (independent of
  // this HTTP layer) as part of the audit. At the MCP layer the SDK's own
  // registerTool dispatcher already catches any thrown handler error into
  // an isError:true CallToolResult (node_modules/@modelcontextprotocol/sdk
  // dist/.../server/mcp.js's registerTool try/catch, calling
  // createToolError() — confirmed by reading the SDK source directly), and
  // M26-F2 already made provider-client.js's taskList() throw on isError
  // instead of silently returning []), and serve.js's handleRequest() is
  // now wrapped in a top-level try/catch (also M26-F2) — so the full chain
  // (store throw -> MCP isError -> client throw -> HTTP 500) is exercised
  // end-to-end here for the first time.
  {
    const badTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-badfm-test-"));
    const badWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-badfm-workspace-"));
    fs.mkdirSync(path.join(badWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(badWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${badTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${badTasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    // One well-formed task — pure-data fixture → store write (the validated
    // path, so BADFM-GOOD is guaranteed well-formed, which is the whole point
    // of the negative control).
    seedTask(badTasksDir, "BADFM-GOOD", { title: "Good task", status: "todo", body: VALID_SECTIONS });
    // ...and one malformed task file written directly to disk (no CLI path
    // validates frontmatter shape, so this simulates hand-edited/corrupted
    // task-store content, the DIR-001 "malformed frontmatter" category).
    fs.writeFileSync(path.join(badTasksDir, "BADFM-BAD.md"), "this file has no YAML frontmatter delimiters at all\n");

    const badOrigCwd = process.cwd();
    let badServer;
    try {
      process.chdir(badWorkspaceRoot);
      badServer = await startServer({ port: 0 });
      const badPort = badServer.address().port;

      // gap-one-unparseable-task-takes-down-the-whole-board: the behavior
      // CHANGED from M26-F4's original "clean 500" — the provider's task_list
      // now returns PARTIAL SUCCESS for a bad file (parseable tasks + a
      // machine-readable malformed list) instead of isError, so the list page
      // renders 200 with a VISIBLE `.malformed-row` for the bad file and the
      // good tasks listed normally. 500 is reserved for genuine call failures
      // (AC5 — see unparseable-frontmatter.test.mjs's AC5 web test).
      const badResp = await get(badPort, "/");
      assert(
        badResp.status === 200,
        `GET / with one unparseable task file returns 200, not a 500 — the bad task must poison only its own row (M26-F4 / gap-one-unparseable-task-takes-down-the-whole-board) (got ${badResp.status})`
      );
      assert(
        badResp.body.includes('class="malformed-row"') && badResp.body.includes("BADFM-BAD.md"),
        `GET / renders a visible .malformed-row naming the unparseable file (M26-F4 / gap-one-unparseable-task-takes-down-the-whole-board)`
      );
      assert(
        badResp.body.includes("BADFM-GOOD"),
        `GET / still lists the good task BADFM-GOOD alongside the malformed row (M26-F4 / gap-one-unparseable-task-takes-down-the-whole-board)`
      );

      // The server process itself must survive — a second, unrelated request
      // (list page again, after fixing the bad file) must still succeed
      // normally. This is the "no crash, no corrupted state" half of
      // DIR-001's own framing: the good task's file on disk is untouched
      // and still readable once the bad file is removed (simulating a human
      // fixing the one bad task) — same server process, same port, no restart.
      fs.rmSync(path.join(badTasksDir, "BADFM-BAD.md"));
      const recovered = await get(badPort, "/");
      assert(
        recovered.status === 200 && recovered.body.includes("BADFM-GOOD") && !recovered.body.includes('class="malformed-row"'),
        `GET / recovers to a clean 200 with no malformed row once the bad file is removed — good task's on-disk content was never corrupted, and the server process survived (M26-F4 / gap-one-unparseable-task-takes-down-the-whole-board) (got status ${recovered.status})`
      );
    } finally {
      if (badServer) {
        badServer.close();
        if (badServer.client) await badServer.client.close();
      }
      process.chdir(badOrigCwd);
      fs.rmSync(badTasksDir, { recursive: true, force: true });
      fs.rmSync(badWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- DIR-025/M41: GFM task-list checkbox glyph rendering ---
  // The directive-task full-body projection (DIR-025) puts raw `## Acceptance Criteria` /
  // `## Definition of Done` checklists (with `- [ ]` / `- [x]` items) into task bodies for the
  // first time at scale. Verified live against `/task/DIR-021` that the bracket glyphs rendered
  // as literal `[ ]` text inside `<li>`, not a checkbox — this is the "specific construct
  // rendering incorrectly" case DIR-025's own Requested action item 4 names as the (only)
  // trigger for a minimal serve.js tweak. This test locks in that fix: renderMarkdown() now
  // emits a disabled `<input type="checkbox">` for `- [ ]` / `- [x]` list items instead of
  // leaving the bracket glyph as plain text, and preserves existing plain-`-`/ordered-list
  // rendering unaffected.
  {
    const cbTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-checkbox-test-"));
    const cbWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-checkbox-workspace-"));
    fs.mkdirSync(path.join(cbWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(cbWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${cbTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${cbTasksDir.replaceAll("\\", "\\\\")}"\n`
    );

    const CHECKBOX_BODY =
      "## Acceptance Criteria\n" +
      "- [ ] an unchecked item\n" +
      "- [x] a checked item\n" +
      "- a plain unordered item with no checkbox\n";
    // Pure-data fixture (checkbox body rendered by renderMarkdown) → store write.
    seedTask(cbTasksDir, "CBX-1", { title: "Checkbox render task", status: "todo", body: CHECKBOX_BODY });

    const cbOrigCwd = process.cwd();
    let cbServer;
    try {
      process.chdir(cbWorkspaceRoot);
      cbServer = await startServer({ port: 0 });
      const cbPort = cbServer.address().port;

      const cbResp = await get(cbPort, "/task/CBX-1");
      assert(cbResp.status === 200, `GET /task/CBX-1 returns 200 (got ${cbResp.status})`);
      assert(
        /<input type="checkbox" disabled>/.test(cbResp.body),
        "unchecked '- [ ]' item renders as a disabled, unchecked <input type=\"checkbox\">"
      );
      assert(
        /<input type="checkbox" disabled checked>/.test(cbResp.body),
        "checked '- [x]' item renders as a disabled, checked <input type=\"checkbox\" checked>"
      );
      assert(
        !/<li>\[ \]/.test(cbResp.body) && !/<li>\[x\]/i.test(cbResp.body),
        "no raw '[ ]'/'[x]' bracket-glyph text leaks into a plain <li> (the pre-fix behavior)"
      );
      assert(
        /<li>a plain unordered item with no checkbox<\/li>/.test(cbResp.body),
        "a plain '- item' (no checkbox prefix) still renders as an ordinary <li>, unaffected by the checkbox tweak"
      );
    } finally {
      if (cbServer) {
        cbServer.close();
        if (cbServer.client) await cbServer.client.close();
      }
      process.chdir(cbOrigCwd);
      fs.rmSync(cbTasksDir, { recursive: true, force: true });
      fs.rmSync(cbWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- gap-serve-task-list-dies-on-one-malformed-task ---
  // A task file whose frontmatter lacks `id:` must not take down the whole
  // list page (3/588 = 0.5% malformed data -> 100% of the only graphical UI
  // unavailable). Serve must degrade: HTTP 200 + a VISIBLE placeholder row
  // marked "缺少 id", never a 500, and never a silent drop. Fixture: MAL-1.md
  // planted directly (bypassing store.write(), which always requires an id) so
  // its frontmatter genuinely has no `id:` field — the exact real-world case.
  {
    const mTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-malformed-test-"));
    const mWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-malformed-workspace-"));
    fs.mkdirSync(path.join(mWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(mWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${mTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${mTasksDir.replaceAll("\\", "\\\\")}"\n`
    );
    seedTask(mTasksDir, "GOOD-1", { title: "Good task one", status: "todo", body: VALID_SECTIONS });
    seedTask(mTasksDir, "GOOD-2", { title: "Good task two", status: "done", body: VALID_SECTIONS });
    // Plant a malformed task file: valid YAML frontmatter but NO `id:` field.
    fs.writeFileSync(
      path.join(mTasksDir, "MAL-1.md"),
      "---\ntitle: Malformed missing-id task\nstatus: todo\n---\nbody of a task whose frontmatter lost its id\n"
    );

    // AC5 (provider layer): quay-native list() falls back to the filename for
    // the id and marks extra.malformed=["missing-id"], while good tasks are
    // NOT marked.
    {
      const listed = createStore(mTasksDir).list();
      const mal = listed.find((t) => t.id === "MAL-1");
      assert(mal && mal.id === "MAL-1", "AC5: provider list() falls back to the filename for a missing-id task");
      assert(mal && Array.isArray(mal.extra.malformed) && mal.extra.malformed.includes("missing-id"),
        "AC5: provider list() marks extra.malformed=['missing-id'] for a missing-id task");
      const good = listed.find((t) => t.id === "GOOD-1");
      assert(good && good.extra.malformed === undefined,
        "AC5: a good task is NOT marked malformed (only genuinely missing-id tasks are)");
    }

    // AC5 (CLI surface): `quay task list --json` exposes the fallback id and
    // the extra.malformed marker end-to-end through the Provider ABI.
    {
      const r = execFileSync("node", [QUAY_CLI, "task", "list", "--json"], {
        cwd: mWorkspaceRoot,
        encoding: "utf8",
      });
      const cliTasks = JSON.parse(r);
      const cliMal = (cliTasks || []).find((t) => t.id === "MAL-1");
      assert(cliMal && Array.isArray(cliMal.extra?.malformed) && cliMal.extra.malformed.includes("missing-id"),
        "AC5: `quay task list --json` exposes extra.malformed=['missing-id'] for a missing-id task");
    }

    const mOrigCwd = process.cwd();
    let mServer;
    try {
      process.chdir(mWorkspaceRoot);
      mServer = await startServer({ port: 0 });
      const mPort = mServer.address().port;

      const list = await get(mPort, "/");
      assert(list.status === 200, "AC1: GET / returns 200 with a missing-id task present (not 500)");
      assert(list.body.includes("缺少 id"), "AC2: page visibly marks the malformed task '缺少 id'");
      assert(list.body.includes("MAL-1"), "AC2: page shows the malformed task's filename fallback");
      assert(list.body.includes('class="malformed-row"'),
        "AC2: the malformed task renders as a visibly distinct placeholder row");
      // <table> header row + GOOD-1 + GOOD-2 + MAL-1 placeholder = 4 rows.
      const trCount = (list.body.match(/<\/tr>/g) || []).length;
      assert(trCount === 4, `AC2: the malformed task renders as a real row (expected 4 rows, got ${trCount})`);
      assert(!/undefined/.test(list.body), "AC4: no 'undefined' string leaks into the page (prefix calc skips missing ids)");
      assert(list.body.includes("Prefix:"), "AC4: prefix nav still renders with a missing-id task present");
      assert(list.body.includes(">GOOD<") && list.body.includes(">MAL<"),
        "AC4: prefix nav shows GOOD and MAL (never an 'undefined' pseudo-prefix)");

      // AC3 (negative control): removing the malformed fixture removes exactly
      // the placeholder row — proving AC2's placeholder came from it, i.e. the
      // task was surfaced, not silently swallowed.
      fs.rmSync(path.join(mTasksDir, "MAL-1.md"));
      const list2 = await get(mPort, "/");
      assert(list2.status === 200, "AC3: GET / still returns 200 after removing the malformed fixture");
      assert(!list2.body.includes("缺少 id"), "AC3: '缺少 id' marker is gone after removing the fixture");
      const trCount2 = (list2.body.match(/<\/tr>/g) || []).length;
      assert(trCount2 === 3, `AC3: rendered rows drop by exactly 1 after removing the fixture (expected 3 rows, got ${trCount2})`);
    } finally {
      if (mServer) {
        mServer.close();
        if (mServer.client) await mServer.client.close();
      }
      process.chdir(mOrigCwd);
      fs.rmSync(mTasksDir, { recursive: true, force: true });
      fs.rmSync(mWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // --- gap-web-cannot-show-what-the-loop-is-doing-now ---
  // /live + /journal render what the loop is doing right now. The data access is quarantined
  // in observation.ts (the ONLY serve-path module that knows `.workflow-events/`,
  // `orchestration/`, `git`); serve-handlers only renders. Every data source must degrade:
  // absent → 200 「无数据」; present-but-unreadable → 200 「读失败」(never a 500). AC2 pins
  // /live's in-flight list against fast-mode-telemetry.ts --report --json's inProgress — the
  // test below compares observation.ts's pairing against the real aggregate()/readAllEvents.
  {
    const obsTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-obs-test-"));
    const obsWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-obs-workspace-"));
    fs.mkdirSync(path.join(obsWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(obsWorkspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${obsTasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${obsTasksDir.replaceAll("\\", "\\\\")}"\n`
    );
    seedTask(obsTasksDir, "OBS-1", { title: "Obs task one", status: "todo", body: VALID_SECTIONS });

    // git-init the workspace + one commit so /journal's commits section has real data and
    // AC6's git-status-zero-side-effect check is meaningful. The observation fixtures below are
    // created AFTER the commit, so they are untracked — git status --porcelain is stable across
    // the GETs (AC6 compares the snapshot before vs after, not "clean").
    execFileSync("git", ["init", "-q"], { cwd: obsWorkspaceRoot });
    fs.writeFileSync(path.join(obsWorkspaceRoot, "README.md"), "observation test workspace\n");
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: obsWorkspaceRoot });
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture commit"], { cwd: obsWorkspaceRoot });
    const obsCommitHash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: obsWorkspaceRoot, encoding: "utf8" }).trim().slice(0, 7);

    // ── Telemetry fixtures (.workflow-events/) ──
    // Schema-valid Fast events (must pass workflow-event-schema.mjs validateEvent so the
    // aggregate()/readAllEvents comparison is against REAL parsed events, not my own parser).
    // OBS-A: start, no end → in-flight. OBS-B: start+end → completed, NOT in-flight.
    // OBS-BLK: blocked-wait event → NOT a task pair. One malformed line → must be skipped.
    const nowMs = Date.now();
    const fastEvent = (overrides) => ({
      schemaVersion: "1", agentLabel: "fast-mode", attempt: 0, baseCommit: "deadbeef",
      candidateCommit: null, commandIdentity: "fast-mode-telemetry:task-start",
      executionCwd: obsWorkspaceRoot, isolationMode: null, observedWrites: [],
      outcome: null, recordedAtMs: nowMs, resourceClaim: null, stage: "Fast",
      waitReason: null, worktreePath: null, dispatchMode: "serial",
      timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null },
      ...overrides,
    });
    const eventsDir = path.join(obsWorkspaceRoot, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "fm-OBS-A.jsonl"),
      JSON.stringify(fastEvent({ runId: "fm-OBS-A-1", candidateId: "OBS-A", taskId: "OBS-A", eventKind: "start", timing: { queuedAtMs: null, startedAtMs: nowMs - 120_000, endedAtMs: null } })) + "\n"
    );
    fs.writeFileSync(
      path.join(eventsDir, "fm-OBS-B.jsonl"),
      JSON.stringify(fastEvent({ runId: "fm-OBS-B-1", candidateId: "OBS-B", taskId: "OBS-B", eventKind: "start", timing: { queuedAtMs: null, startedAtMs: nowMs - 300_000, endedAtMs: null } })) + "\n" +
      JSON.stringify(fastEvent({ runId: "fm-OBS-B-1", candidateId: "OBS-B", taskId: "OBS-B", eventKind: "end", commandIdentity: "fast-mode-telemetry:task-end", outcome: "done", timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: nowMs - 240_000 } })) + "\n"
    );
    fs.writeFileSync(
      path.join(eventsDir, "fm-OBS-BLK.jsonl"),
      JSON.stringify(fastEvent({ runId: "fm-OBS-BLK-1", candidateId: "OBS-BLK", taskId: "OBS-BLK", eventKind: "blocked", commandIdentity: "inner-blocked-signal:clear", timing: { queuedAtMs: null, startedAtMs: nowMs - 10_000, endedAtMs: nowMs - 5_000 } })) + "\n" +
      "{ this is not valid json }\n"
    );

    // ── Journal fixtures (orchestration/) ──
    const orchDir = path.join(obsWorkspaceRoot, "orchestration");
    fs.mkdirSync(orchDir, { recursive: true });
    fs.writeFileSync(
      path.join(orchDir, "escalations.md"),
      "# 升级项\n\n## 9. 测试升级项\n\n**发现时刻**：2026-08-03T00:00:00Z\n\n这是一条测试升级项。\n\n## 10. 更新一条\n\n另一条测试条目。\n"
    );
    fs.writeFileSync(
      path.join(orchDir, "tick-log.md"),
      "# 外层 tick 记录\n\n| 时刻 | 动作类型 | 做了什么 | 内层状态 | 核实了哪一项 |\n|---|---|---|---|---|\n| 2026-08-03 05:45Z | `correct` | 测试 tick 行 | 在飞 OBS-A | 核实 X |\n| 2026-08-03 05:33Z | `no-action` | 更早 tick | - | - |\n"
    );

    const obsOrigCwd = process.cwd();
    let obsServer;
    try {
      process.chdir(obsWorkspaceRoot);
      obsServer = await startServer({ port: 0 });
      const obsPort = obsServer.address().port;

      // AC6 baseline: snapshot the working tree before any render.
      const gitBefore = execFileSync("git", ["status", "--porcelain"], { cwd: obsWorkspaceRoot, encoding: "utf8" });

      // --- /live ---
      const live = await get(obsPort, "/live");
      assert(live.status === 200, "AC4: GET /live returns 200 with the telemetry store present (got " + live.status + ")");
      assert(live.body.includes("OBS-A"), "AC2: /live page shows the in-flight task id (OBS-A)");
      assert(!live.body.includes("OBS-B"), "AC2: /live does NOT list the completed task (OBS-B)");
      assert(!live.body.includes("OBS-BLK"), "AC2: /live does NOT list the blocked-wait event (OBS-BLK)");
      assert(live.body.includes("并发数"), "AC2: /live shows the concurrency summary");
      assert(live.body.includes("分钟"), "AC2: /live shows the elapsed-minutes column");
      if (fs.existsSync("/proc/pressure/cpu")) {
        assert(live.body.includes("CPU 压力"), "AC2: /live shows the CPU-pressure row when /proc/pressure/cpu is readable");
      }
      // Nav links present on the task list page (the observation surface is reachable).
      const obsList = await get(obsPort, "/");
      assert(obsList.status === 200 && obsList.body.includes('href="/live"') && obsList.body.includes('href="/journal"'),
        "nav: task list page links to /live and /journal");

      // AC2 (entry-by-entry): readLive().inFlight must match the REAL --report inProgress.
      const allEvents = [];
      for await (const ev of readAllEvents(obsWorkspaceRoot)) allEvents.push(ev);
      const expected = aggregate(allEvents);
      const liveData = readLive(obsWorkspaceRoot, { nowMs });
      const expIds = expected.inProgress.map((p) => p.taskId).sort();
      const liveIds = liveData.inFlight.map((t) => t.taskId).sort();
      assert(JSON.stringify(expIds) === JSON.stringify(liveIds),
        `AC2: readLive inFlight ids match --report inProgress ids (${JSON.stringify(expIds)} vs ${JSON.stringify(liveIds)})`);
      assert(expected.inProgress.length === 1 && expected.inProgress[0].taskId === "OBS-A",
        "AC2: --report inProgress contains exactly the one in-flight task (OBS-A)");
      const matched = expected.inProgress.every((p) => {
        const l = liveData.inFlight.find((t) => t.runId === p.runId);
        return l && l.startedAtMs === p.startedAtMs;
      });
      assert(matched, "AC2: readLive inFlight startedAtMs matches --report inProgress per runId");
      assert(liveData.inFlight[0].minutes > 1.5, "AC2: elapsed minutes for the in-flight task is ~2m (got " + (liveData.inFlight[0].minutes || 0) + ")");

      // --- /journal ---
      const journal = await get(obsPort, "/journal");
      assert(journal.status === 200, "AC3: GET /journal returns 200 (got " + journal.status + ")");
      assert(journal.body.includes("升级项") && journal.body.includes("测试升级项"),
        "AC3: /journal renders the recent escalations.md entry");
      assert(journal.body.includes("tick-log.md") && journal.body.includes("2026-08-03 05:45Z"),
        "AC3: /journal renders the recent tick-log.md row");
      assert(journal.body.includes("fixture commit") && journal.body.includes(obsCommitHash),
        "AC3: /journal renders the recent git commits (fixture commit)");
      const jData = readJournal(obsWorkspaceRoot);
      assert(jData.escalations.status === "ok" && jData.tickLog.status === "ok" && jData.commits.status === "ok",
        "AC3: readJournal returns ok status for all three sources");

      // AC6: the read path wrote nothing — working tree unchanged across the PURE renders above
      // (this snapshot must happen BEFORE the AC4/AC5 mutations below, which legitimately change
      // the untracked-file listing: they rename the store and turn it into a file).
      const gitAfter = execFileSync("git", ["status", "--porcelain"], { cwd: obsWorkspaceRoot, encoding: "utf8" });
      assert(gitBefore === gitAfter, "AC6: git status --porcelain is unchanged by /live + /journal renders (zero side effects)");

      // gap-live-cannot-tell-a-dead-loop-from-an-unwired-one: telemetry absent no longer shows
      // the generic 「无数据」. This workspace HAS activity signals (the fixture commit above +
      // a freshly-written tick-log.md) ⇒ /live must say 「在跑但未接遥测」 (running-unwired), the
      // AC2 negative control. Then restore and confirm recovery.
      fs.renameSync(eventsDir, eventsDir + ".bak");
      const liveEmpty = await get(obsPort, "/live");
      assert(liveEmpty.status === 200, "AC4: GET /live still returns 200 when the telemetry store is renamed (got " + liveEmpty.status + ")");
      assert(liveEmpty.body.includes("在跑但未接遥测") && liveEmpty.body.includes("live_state=running-unwired"),
        "AC2/AC4: telemetry absent + activity signals present ⇒ /live says 「在跑但未接遥测」(running-unwired)");
      assert(!liveEmpty.body.includes("未在运行"), "AC2/AC4: running-unwired and not-running are distinguishable on the page");
      fs.renameSync(eventsDir + ".bak", eventsDir);
      const liveRestored = await get(obsPort, "/live");
      assert(liveRestored.status === 200 && liveRestored.body.includes("OBS-A"),
        "AC4: /live recovers (shows OBS-A) after the telemetry store is restored");

      // AC5 (无数据 vs 读失败 distinguishable): make the store a plain FILE so readdirSync
      // fails ⇒ /live must show 「读失败」, NOT 「无数据」, and still 200.
      fs.rmSync(eventsDir, { recursive: true, force: true });
      fs.writeFileSync(eventsDir, "i am a file, not a directory\n");
      const liveErr = await get(obsPort, "/live");
      assert(liveErr.status === 200, "AC5: /live returns 200 even when the telemetry store is unreadable (got " + liveErr.status + ")");
      assert(liveErr.body.includes("读失败"), "AC5: /live shows 「读失败」 for a present-but-unreadable store");
      assert(!liveErr.body.includes("无数据"), "AC5: 「读失败」 and 「无数据」 are distinguishable on the page");
    } finally {
      if (obsServer) {
        obsServer.close();
        if (obsServer.client) await obsServer.client.close();
      }
      process.chdir(obsOrigCwd);
      fs.rmSync(obsTasksDir, { recursive: true, force: true });
      fs.rmSync(obsWorkspaceRoot, { recursive: true, force: true });
    }
  }

  console.log(failures === 0 ? "\nAll QN-031 serve/action regression tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
