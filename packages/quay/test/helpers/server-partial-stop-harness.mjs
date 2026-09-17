// Shared harness for the server-partial-stop shards (split of server-partial-stop.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../server-partial-stop.test.mjs", import.meta.url).href;

// @test-group product
// GOAL-017 / AC-254 — SPEC §6.9 stage B: the services are INDEPENDENTLY startable and stoppable
// units and the process is only their host.
//
// WHAT THIS FILE DEFENDS. The failure this repo has already paid for more than once is a *folded
// reading*: two different facts reported as one value, so an operator cannot tell them apart.
// Stage B has three of them, and each is asserted in BOTH directions here:
//
//   §6.9 不变式 1  IDEMPOTENT       `start` on a running service is a NO-OP, **not** a silent
//                                   restart. The discriminator is the host pid: restarting would
//                                   change it, and restarting a driver kills its in-flight worker
//                                   children. So: same pid in, same pid out.
//   §6.9 不变式 2  PARTIAL          `stop --only web` must release the WEB listener WITHOUT taking
//                                   the host down. Four readings, all required: web was reachable
//                                   before, is unreachable after, the host pid is UNCHANGED, and the
//                                   SAME process's `control` face still answers. Drop the "before"
//                                   and "unreachable after" is vacuous; drop the control face and a
//                                   whole-process kill would pass.
//   §6.9 不变式 3  ⛔ 非整体重启     `driver:<kind>` delegates to the existing `quay driver stop
//                                   --kind X` — this file does NOT re-test that (its own suite
//                                   owns it) and does NOT run it against any live driver.
//
// 硬规则 3b: `stopped` and `already-stopped` are DIFFERENT values, and `not-evaluated` is a third.
// "I stopped it" and "it was already stopped" must not be the same reading — otherwise `stop`'s
// exit 0 is not a reading of anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_CLI, QUAY_NATIVE_CLI } from ".././helpers/cli-entry.mjs";


/** A minimal but REAL workspace (a bare `tasks/` dir is not a valid workspace — the config is a
 *  provider map, not a flat path). */

/** Run the Core CLI as a REAL child process against `cwd`; returns { code, stdout, stderr, json }.
 *  ASYNC (never spawnSync): tests that host a server must keep the event loop free to answer the
 *  child's probes — a blocking spawn would make the server unreachable and turn green into red. */

/** Spawn a REAL `quay serve` (the unified host) rooted at `ws`, detached so the group can be killed. */





// ── the verb surface (SPEC §6.8/§6.9: 四个动词是同一能力的四个面) ─────────────────────────────────

const __dirname = path.dirname(fileURLToPath(SRC_URL));

const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const START_TIMEOUT_MS = 30000;

function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${QUAY_NATIVE_CLI.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  return ws;
}

function cli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", QUAY_CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("exit", (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        /* left null; a test that expects JSON asserts on it */
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

function spawnServe(ws) {
  const child = spawn(process.execPath, ["--no-warnings", QUAY_CLI, "serve", "--port", "0", "--host", "127.0.0.1"], {
    cwd: ws,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  return {
    child,
    out: () => ({ stdout, stderr }),
    kill() {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    },
  };
}

async function waitForCarrier(ws, timeoutMs = START_TIMEOUT_MS) {
  const p = path.join(ws, ".quay", "server.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        /* half-written — retry */
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function health(host, port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(4000) });
    return res.status;
  } catch {
    return 0; // transport failure = nothing listening (the interesting case for a stopped face)
  }
}

async function controlAnswers(host, port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ac254-test", version: "1" } } }),
      signal: AbortSignal.timeout(4000),
    });
    const text = await res.text();
    const cands = [...text.split(/\r?\n/).map((l) => /^data:\s*(.+)$/.exec(l)?.[1]).filter(Boolean), text];
    return cands.some((c) => {
      try {
        return typeof JSON.parse(c)?.jsonrpc === "string";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

const serviceOf = (json, name) => (json?.services ?? []).find((s) => s.name === name);

export { QUAY_CLI, QUAY_NATIVE_CLI, START_TIMEOUT_MS, __dirname, assert, cli, controlAnswers, fileURLToPath, fs, health, makeWorkspace, nativeProviderDir, os, path, serviceOf, spawn, spawnServe, spawnSync, test, waitForCarrier };
