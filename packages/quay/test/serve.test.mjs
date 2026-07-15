// QN-031 (iteration 21): regression test for serve.js's HTTP list/detail/
// action-button loop and action.js's composePayload() — the literal running
// code behind the `skeleton` V_instance factor (protocol §5.1: "the v0 loop
// runs end-to-end (config -> mcp -> serve -> action -> Skill -> done)").
// Prior to this task, this chain had only ever been exercised by a manual
// curl/browser walkthrough once, in iteration 0
// (experiment/timing/iteration-0.log) — never by an automated, re-runnable
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
    assert(!detail2.body.includes("Advance"),
      "GET /task/SRV-2 (status=done, no matching whenStatus) does NOT render the 'Advance' button (negative control)");

    // --- GET /task/<nonexistent> -> 404 ---
    const notFound = await get(port, "/task/NOPE-999");
    assert(notFound.status === 404, `GET /task/NOPE-999 returns 404 (got ${notFound.status})`);

    // --- POST /task/<id>/action/<actionId> -> 302 redirect ---
    const action = await post(port, "/task/SRV-1/action/advance");
    assert(action.status === 302, `POST /task/SRV-1/action/advance returns 302 (got ${action.status})`);
    assert(action.headers.location === "/task/SRV-1",
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

  console.log(failures === 0 ? "\nAll QN-031 serve/action regression tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
