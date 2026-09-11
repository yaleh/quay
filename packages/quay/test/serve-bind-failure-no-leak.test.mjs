// @test-group product
// gap-ac244-freshness-subject-set-mechanically-derived — a bind failure (EADDRINUSE) must
// reject `startServer` AND leave no provider child process behind.
//
// Why this is a test and not a comment: the leak is invisible in-process except as "the event
// loop never drains". Measured cost on 2026-09-11, not hypothetical: `serve-needs-human.test.mjs`
// picked a port with a loopback-only probe, `startServer` binds 0.0.0.0, the bind failed, and the
// already-spawned `quay-native mcp` child leaked. That file's `node --test` process then never
// exited: a 614-file suite completed 613 files and sat in silence until the silence watchdog
// killed the run — 23.5 minutes of suite wall-clock lost, reported as "killed" rather than as a
// failing test.
//
// The assertion is that black-box fact: a node process that hits the bind failure EXITS.
//
// 能取假 (pre-fix control, run 2026-09-11): with `packages/quay/src/serve.ts` reverted to its
// pre-fix version, the child below prints `CHILD:EADDRINUSE` and then HANGS until the test's
// timeout kills it ⇒ this test fails on `signal === null`. Post-fix it exits on its own (code 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serveTs = path.join(__dirname, "..", "src", "serve.ts");
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const nativeBin = QUAY_NATIVE_CLI;

const TIMEOUT_MS = 20000;

function makeWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "bindfail-ws-"));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  return ws;
}

/** Wait for `child` to exit on its own; if it does not, kill it and report how it died. */
function exitWithin(child, ms) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, signal: "DID-NOT-EXIT", stdout, stderr });
    }, ms);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("AC-leak: an EADDRINUSE bind failure rejects startServer AND the process still exits on its own", async () => {
  const ws = makeWorkspace();
  // Hold the port on 0.0.0.0 — the same interface startServer binds — so the bind must fail.
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, "0.0.0.0", resolve));
  const port = holder.address().port;

  const script = [
    `const { startServer } = await import(${JSON.stringify(serveTs)});`,
    `let code = "UNEXPECTED-SUCCESS";`,
    `try { await startServer({ port: ${port} }); } catch (e) { code = (e && e.code) || String(e); }`,
    `console.log("CHILD:" + code);`,
    // Deliberately NO process.exit(): the child must drain its own event loop. A leaked
    // provider child keeps it alive, which is exactly what the pre-fix code did.
  ].join("\n");

  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e", script],
    { cwd: ws, stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    const { signal, stdout } = await exitWithin(child, TIMEOUT_MS);
    assert.match(stdout, /CHILD:EADDRINUSE/, "the bind failure is reported as EADDRINUSE to the caller");
    assert.equal(
      signal,
      null,
      "the child must exit on its own — a leaked provider child keeps the process alive " +
        "(pre-fix: the child hung and the suite's silence watchdog killed the whole run)",
    );
    assert.doesNotMatch(stdout, /UNEXPECTED-SUCCESS/, "the held port really did make startServer fail");
  } finally {
    await new Promise((resolve) => holder.close(resolve));
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
