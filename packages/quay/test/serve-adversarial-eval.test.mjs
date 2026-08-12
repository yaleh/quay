// @test-group product
// M26-adversarial-eval (DIR-001 item 4): targeted fault-injection regression
// tests for the highest-risk real gaps this milestone's Phase A audit found
// in serve.js and provider-client.js. Each test asserts SAFE degradation
// (clear error, no crash, no corrupted task-store state) per DIR-001's own
// framing and this charter's Done-when clause 5.
//
// Covers:
//   ADV-001: provider-client.js's taskList() previously did not check
//     r.isError (unlike taskGet/taskWrite/taskCheck) -- a Provider-side
//     error silently degraded to an empty array, indistinguishable from "no
//     tasks". Fixed: taskList() now throws on isError, matching the other
//     three passthroughs.
//   ADV-002: serve.js's http.createServer handler had no try/catch
//     anywhere -- ANY thrown/rejected error (including the one ADV-001
//     newly surfaces) crashed the entire Node process, taking down the Web
//     UI for every task and every request, not just the failing one. Fixed:
//     the whole handler body is now wrapped, degrading to a 500 for the
//     single failing request while the server (and all other tasks/
//     requests) stays healthy.
//   ADV-003: the POST .../action/<id> route's ?from= open-redirect guard
//     was WEAKER than the GET /task/<id> route's own guard (missing
//     !startsWith("//")), and even the stronger guard missed two further
//     real bypass shapes (backslash-prefixed and control-char-prefixed
//     targets that WHATWG URL / real browsers normalize to an external
//     origin). Fixed: both routes once shared one isSafeRelativeRedirect()
//     helper that closes all of these. NOTE (2026-08-06): the POST .../action/
//     <id> route itself was REMOVED by
//     gap-web-action-buttons-unused-route-and-open-redirect-delete, so the
//     POST-route open-redirect regression test below was deleted with it; the
//     GET detail route (which still uses the shared helper via backHref)
//     remains covered by testDetailRouteOpenRedirectBackslashBypass().
//
// Run: node test/serve-adversarial-eval.test.mjs

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

function get(port, urlPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("TIMEOUT: request never completed (this is exactly the crash/hang failure mode ADV-002 fixes)"));
    });
  });
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

function writeConfig(workspaceRoot, tasksDir) {
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
}

// --- ADV-001 + ADV-002: a single malformed task file must not crash the
// server or silently mask as an empty list. gap-one-unparseable-task-takes-
// down-the-whole-board CHANGED the degradation from a clean 500 to a 200 with
// a visible .malformed-row (the provider's task_list now returns partial
// success for one bad frontmatter instead of isError); the server stays up
// and healthy for every other request (including a later request AFTER the
// bad file is removed, with no restart). ADV-001's core invariant — taskList()
// throws on isError, never a silent empty list — is preserved (AC5).
async function testMalformedTaskFileDegradesSafely() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-adv-serve-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-adv-serve-ws-"));

  execFileSync(
    "node",
    [nativeBin, "task", "create", "ADV-1", "--title", "Good task", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } }
  );
  // Plant a malformed task file directly (bypassing CLI validation, the same
  // way a hand-edited or externally-corrupted file would arise in practice).
  fs.writeFileSync(path.join(tasksDir, "BAD-1.md"), "---\nid: BAD-1\n  bad: [unterminated\n---\nbody\n");

  writeConfig(workspaceRoot, tasksDir);

  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // gap-one-unparseable-task-takes-down-the-whole-board: the malformed-file
    // behavior CHANGED from ADV-001/002's original "clean 500". The provider's
    // task_list now returns PARTIAL SUCCESS for one bad frontmatter (parseable
    // tasks + a machine-readable malformed list) instead of isError, so GET /
    // renders 200 with a VISIBLE .malformed-row naming the bad file, and the
    // good task lists normally. The 500 path (AC5) is still exercised for a
    // genuine call-level failure — see serve.test.mjs's unparseable block.
    // ADV-001's core assertion (taskList() throws on isError, never a silent
    // empty list) is preserved at the provider-client level.
    const withBadFile = await get(port, "/");
    assert(
      withBadFile.status === 200,
      `GET / with an unparseable task file present returns 200, not a 500 — one bad task must poison only its own row (gap-one-unparseable-task-takes-down-the-whole-board, superseding ADV-001/002) (got ${withBadFile.status})`
    );
    assert(
      withBadFile.body.includes('class="malformed-row"') && withBadFile.body.includes("BAD-1.md"),
      `GET / renders a visible .malformed-row naming the unparseable file BAD-1.md (gap-one-unparseable-task-takes-down-the-whole-board)`
    );
    assert(
      withBadFile.body.includes("ADV-1"),
      `GET / still lists the good task ADV-1 alongside the malformed row (gap-one-unparseable-task-takes-down-the-whole-board)`
    );

    // The server process must still be alive and healthy for a DIFFERENT
    // request right after the failing one -- proving ADV-002's fix isolates
    // the failure to the single request, not the whole process.
    const detailStillWorks = await get(port, "/task/ADV-1");
    assert(
      detailStillWorks.status === 200,
      `GET /task/ADV-1 (a DIFFERENT, unaffected task) still returns 200 right after the malformed-file request -- server survived (got ${detailStillWorks.status})`
    );

    // Remove the bad file and confirm the list route self-heals with NO
    // restart -- proving no corrupted state was left behind by the failure.
    fs.rmSync(path.join(tasksDir, "BAD-1.md"));
    const afterFix = await get(port, "/");
    assert(afterFix.status === 200, `GET / after removing the malformed file returns 200 (self-healed, got ${afterFix.status})`);
    assert(afterFix.body.includes("ADV-1"), "GET / after removing the malformed file lists the good task correctly");
  } finally {
    process.chdir(originalCwd);
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

// --- ADV-003: GET /task/<id>?from=/\evil.com backslash-bypass on the
// detail-page route too (the route that already had the //-guard, but not
// the backslash-normalization guard, before this milestone's fix).
async function testDetailRouteOpenRedirectBackslashBypass() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-adv-redirect2-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-adv-redirect2-ws-"));

  execFileSync(
    "node",
    [nativeBin, "task", "create", "RDR-2", "--title", "Detail route target", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } }
  );
  writeConfig(workspaceRoot, tasksDir);

  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const backslashTarget = encodeURIComponent("/\\evil.com");
    const resp = await get(port, `/task/RDR-2?from=${backslashTarget}`);
    assert(resp.status === 200, `GET /task/RDR-2?from=/\\evil.com returns 200 (got ${resp.status})`);
    assert(
      resp.body.includes('href="/"') && !resp.body.includes("evil.com"),
      "GET /task/RDR-2?from=/\\evil.com: back link defaults to / (backslash-normalization bypass rejected), no evil.com in body"
    );
  } finally {
    process.chdir(originalCwd);
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

async function main() {
  await testMalformedTaskFileDegradesSafely();
  await testDetailRouteOpenRedirectBackslashBypass();

  console.log(
    failures === 0
      ? "\nAll M26-adversarial-eval serve.js/provider-client.js fault-injection tests passed."
      : `\n${failures} test(s) FAILED`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
