// @test-group product
// QN-045: regression test closing the config-resolution asymmetry named,
// but honestly NOT fixed, in DESIGN.md §4.4 at iteration 33 (DIR-010).
//
// Before this task: serve.js's startServer() built the spawned quay-native
// mcp child's env from `provider.tasks_dir` directly, while bin/quay.js's
// withProvider() and mcp-server.js's connectToProvider() both built it via
// resolveProviderEnv(cfg, provider), reading only `provider.env`. A
// workspace config that set `tasks_dir` and `env.QUAY_NATIVE_TASKS_DIR` to
// DIFFERENT directories would silently serve a different task store to the
// Web UI than to the CLI/MCP legs — a real, live footgun, not just a stub
// discrepancy (the two existing fixtures, serve.test.mjs and cli.test.mjs's
// test 9, both happened to set `tasks_dir` and `env` to the SAME directory,
// which is why this asymmetry went undetected by the existing suite).
//
// This test constructs the adversarial case directly: `tasks_dir` points at
// an EMPTY directory (a decoy with zero task files), `env.
// QUAY_NATIVE_TASKS_DIR` points at the real, seeded directory. After the
// fix (all three Core bindings sharing src/provider-env.js's single
// resolveProviderEnv()), the Web UI must serve tasks from the `env`-named
// directory — matching the CLI/MCP legs — NOT from the `tasks_dir` decoy.
//
// Run: node test/provider-env-symmetry.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

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
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

async function main() {
  const decoyTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-pev-decoy-")); // tasks_dir: EMPTY
  const realTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-pev-real-"));   // env: seeded
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-pev-workspace-"));

  execFileSync("node", [nativeBin, "task", "create", "PEV-1", "--title", "Real task, only in env dir",
    "--status", "todo", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: realTasksDir },
  });

  // Adversarial config: tasks_dir (decoy, empty) != env.QUAY_NATIVE_TASKS_DIR (real, seeded).
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${decoyTasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${realTasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );

  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    // Ephemeral port (0): the fixed PID-derived range (41900 + pid%500) collided under the 4-lane
    // parallel suite (two processes whose PIDs differ by exactly 500 compute the same port →
    // EADDRINUSE at round 313). The OS assigns a free port; read it back after 'listening'.
    server = await startServer({ port: 0 });
    // startServer() now awaits the 'listening' event before resolving (serve.ts,
    // port-collision fix), so the explicit once("listening") wait that used to
    // be required here is gone — re-registering it now would hang (the event has
    // already fired and EventEmitter never replays past events). Read the bound
    // port back directly.
    const port = server.address().port;

    const res = await get(port, "/");
    assert(res.status === 200, "GET / returns 200 (got " + res.status + ")");
    assert(
      res.body.includes("PEV-1"),
      "GET / body includes PEV-1 -- proves startServer() resolved env.QUAY_NATIVE_TASKS_DIR (the seeded, 'real' dir), NOT tasks_dir (the empty 'decoy' dir), closing DESIGN.md §4.4's asymmetry"
    );

    // Cross-check: the CLI leg (bin/quay.js, via withProvider()/resolveProviderEnv())
    // must resolve to the SAME directory -- proving all three bindings are now symmetric.
    const cliOut = execFileSync("node", [QUAY_CLI, "task", "list", "--json"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    });
    const cliTasks = JSON.parse(cliOut);
    assert(
      cliTasks.some((t) => t.id === "PEV-1"),
      "quay task list --json (CLI leg) also resolves to the 'real' env dir, confirming Web UI and CLI are now symmetric (same resolveProviderEnv() call)"
    );
  } finally {
    process.chdir(originalCwd);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      if (server.client) await server.client.close();
    }
    fs.rmSync(decoyTasksDir, { recursive: true, force: true });
    fs.rmSync(realTasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nAll QN-045 provider-env symmetry tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
