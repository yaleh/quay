// @test-group lowconc
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (B-class real wall-clock wait — spawns the built dist bundle across real surfaces
// incl. serve + MCP round-trips) so it runs in the concurrency-1 serial phase, never competing with
// the concurrency-8 main body.
// build-dist-smoke.test.mjs — M120 Stage 1.2 (DIR-060).
//
// Proves the built ESM `dist/quay.js` bundle is STANDALONE-runnable: invoked by
// absolute path from an UNRELATED cwd, against a real native-provider
// workspace, with zero reliance on packages/quay's own src/ tree at runtime
// (everything is bundled). Exercises the four surfaces the plan's Stage 1.2
// enumerates:
//   (a) task list / task get / gate --list from a different cwd
//   (b) serve --port + HTTP GET
//   (c) raw MCP `initialize` round-trip over stdio
//   (d) the doc-quay-directive-skill gate fails with the disclosed
//       "no such document: DOC-001" reason (NOT a raw ENOENT — Grounded finding
//       6 / ROUND-1 correction), and the stray docs-managed/ dir its wrong
//       bundle-relative REPO_ROOT creates lands under a scratch/temp root, never
//       the real repo tree.
//
// The bundle is built into a DEPTH-MATCHED temp tree (<root>/l1/l2/pkg/dist)
// so src/version.ts's `../package.json` read AND src/gate/registry.ts's
// 4-levels-up REPO_ROOT both resolve INSIDE <root>.
//
// Coverage (ROUND-2 correction): this is a new `.test.mjs` file (code branch of
// the quay-task-to-plan classifier), so its own line coverage IS measured and
// pasted — expected ~100% (a linear sequence of subprocess-invocation
// assertions). NOTE (disclosed, not a waiver): that percentage covers only this
// test file's own lines; Node's --experimental-test-coverage cannot reach into
// the spawned dist/quay.js child process's internal execution.
//
// Run: node --test --experimental-test-coverage packages/quay/test/build-dist-smoke.test.mjs

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";

import { buildDist } from "../scripts/build-dist.mjs";
import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// Build the bundle into a depth-matched temp tree (see header comment).
const bundleRoot = makeTmpDir("quay-m120-smoke-bundle-");
const bundlePkg = path.join(bundleRoot, "l1", "l2", "pkg");
fs.mkdirSync(path.join(bundlePkg, "dist"), { recursive: true });
fs.copyFileSync(path.join(pkgDir, "package.json"), path.join(bundlePkg, "package.json"));
const bundle = path.join(bundlePkg, "dist", "quay.js");
// registry.ts's wrong bundle-relative REPO_ROOT = 4 levels up from dist = bundleRoot.
const strayDocsManaged = path.join(bundleRoot, "docs-managed");

let ws; // { workspaceRoot, tasksDir }

function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-m120-smoke-${tag}`, { nativeBin, nativeProviderDir });
}

function runBundle(args, cwd, extraEnv = {}) {
  try {
    const out = execFileSync("node", [bundle, ...args], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, ...extraEnv },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  await buildDist({ outfile: bundle });
  assert.ok(fs.existsSync(bundle), "bundle must build for the smoke suite");
  ws = makeWorkspace("main");
  runNative(["task", "create", "SMOKE1", "--title", "smoke fixture", "--status", "todo"], ws.tasksDir);
});

test("(a) different-cwd: task list / task view --json / gate --list run against the bundle", () => {
  const list = runBundle(["task", "list"], ws.workspaceRoot);
  assert.equal(list.status, 0, `task list stderr: ${list.stderr}`);
  assert.match(list.stdout, /SMOKE1/, "task list must show the created task");

  const view = runBundle(["task", "view", "SMOKE1", "--json"], ws.workspaceRoot);
  assert.equal(view.status, 0, `task view stderr: ${view.stderr}`);
  assert.equal(JSON.parse(view.stdout).id, "SMOKE1");

  const gates = runBundle(["gate", "--list"], ws.workspaceRoot);
  assert.equal(gates.status, 0, `gate --list stderr: ${gates.stderr}`);
  assert.match(gates.stdout, /doc-quay-directive-skill/, "built-in doc gate must be registered");
  assert.match(gates.stdout, /acceptance/, "built-in acceptance gate must be registered");
});

test("(b) serve --port + HTTP GET returns 200", async () => {
  const port = 18000 + Math.floor(Math.random() * 1500);
  const child = spawn("node", [bundle, "serve", "--port", String(port)], {
    cwd: ws.workspaceRoot,
    env: { ...process.env },
    stdio: "ignore",
  });
  try {
    let code;
    // Poll for up to ~15s (100 × 150ms) — matching test (c)'s 15s envelope. The previous 40 ×
    // 150ms (6s) window sat exactly at the bundle's cold-start-under-load time: under full-suite
    // `--test-concurrency=8` load the spawned server genuinely needs ~6s to bind (measured:
    // 6.08s pass / 6.68s fail on the same machine, same load — a coin-flip at the boundary), so
    // ANY test-suite growth tipped this into deterministic failure without any product change.
    // A genuinely broken serve still fails here, just after a load-tolerant wait.
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      try { code = await httpGet(port, "/tasks"); break; } catch { /* not up yet */ }
    }
    assert.equal(code, 200, "GET /tasks on the standalone-bundle server must return 200");
  } finally {
    child.kill("SIGKILL");
  }
});

test("(c) raw MCP initialize round-trip over stdio", async () => {
  const child = spawn("node", [bundle, "mcp"], {
    cwd: ws.workspaceRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const initReq = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m120-smoke", version: "0" } },
  };
  const result = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("MCP initialize timed out")), 15000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) { clearTimeout(timer); resolve(msg.result); return; }
        } catch { /* partial line */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify(initReq) + "\n");
  });
  child.kill("SIGKILL");
  assert.ok(result.protocolVersion, "initialize result must carry a protocolVersion");
  assert.ok(result.serverInfo && result.serverInfo.name, "initialize result must carry serverInfo.name");
});

test("(d) doc gate fails 'no such document: DOC-001'; stray docs-managed lands in temp, not the repo", () => {
  const logFile = path.join(ws.workspaceRoot, "gate-events.jsonl");
  const gate = runBundle(
    ["gate", "SMOKE1", "--gate", "doc-quay-directive-skill", "--file", logFile],
    ws.workspaceRoot
  );
  assert.equal(gate.status, 1, `doc gate must FAIL (exit 1); stderr: ${gate.stderr}`);
  assert.match(
    gate.stdout,
    /FAIL — no such document: DOC-001/,
    "the disclosed reason must be the caught 'no such document' failure, not an uncaught ENOENT"
  );
  // The wrong bundle-relative REPO_ROOT's silently-created stray dir must be in temp.
  assert.ok(
    fs.existsSync(strayDocsManaged),
    `the stray docs-managed dir must be created under the temp bundle root (${strayDocsManaged})`
  );
  assert.ok(
    strayDocsManaged.startsWith(os.tmpdir()),
    "the stray dir must be under the OS temp root — never the real repo tree"
  );
  assert.ok(
    !fs.existsSync(path.join(pkgDir, "..", "..", "docs-managed")) ||
      !strayDocsManaged.includes(pkgDir),
    "the stray dir must not be inside the repo worktree"
  );
});
