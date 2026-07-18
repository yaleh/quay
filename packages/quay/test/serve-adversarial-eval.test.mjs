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
//     origin). Fixed: both routes now share one isSafeRelativeRedirect()
//     helper that closes all of these.
//
// Run: node test/serve-adversarial-eval.test.mjs

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

function post(port, urlPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "POST", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("TIMEOUT"));
    });
    req.end();
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
// server or silently mask as an empty list -- it must degrade to a clean
// 500 for the affected request, while the server stays up and healthy for
// every other request (including a later request AFTER the bad file is
// removed, with no restart).
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

  const port = 41720 + (process.pid % 500);
  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port });

    // GET / with the malformed file present: must NOT crash the process
    // (this call itself succeeding at all, rather than the whole test
    // process dying, is part of the proof) and must NOT silently return an
    // empty/misleading task list -- it must return a clear 500.
    const withBadFile = await get(port, "/");
    assert(
      withBadFile.status === 500,
      `GET / with a malformed task file present returns 500, not a silently-empty 200 (ADV-001) or a hung/crashed connection (ADV-002) (got ${withBadFile.status})`
    );
    assert(
      withBadFile.body.toLowerCase().includes("internal server error"),
      `GET / 500 response body is a clear error message, not an empty page (got: ${withBadFile.body.slice(0, 200)})`
    );

    // The server process must still be alive and healthy for a DIFFERENT
    // request right after the failing one -- proving ADV-002's fix isolates
    // the failure to the single request, not the whole process.
    const detailStillWorks = await get(port, "/task/ADV-1");
    assert(
      detailStillWorks.status === 200,
      `GET /task/ADV-1 (a DIFFERENT, unaffected task) still returns 200 right after the malformed-file 500 -- server survived (got ${detailStillWorks.status})`
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

// --- ADV-003: POST .../action/<id>?from=//evil.com open-redirect bypass
// (the route that previously had a WEAKER guard than the GET detail route).
async function testActionRouteOpenRedirectProtocolRelative() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-adv-redirect-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-adv-redirect-ws-"));

  execFileSync(
    "node",
    [nativeBin, "task", "create", "RDR-1", "--title", "Redirect target task", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } }
  );
  writeConfig(workspaceRoot, tasksDir);

  const port = 41730 + (process.pid % 500);
  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port });

    const protoRel = encodeURIComponent("//evil.com");
    const r1 = await post(port, `/task/RDR-1/action/advance?from=${protoRel}`);
    assert(r1.status === 302, `POST .../action/advance?from=//evil.com returns 302 (got ${r1.status})`);
    assert(
      r1.headers.location && !r1.headers.location.startsWith("//") && !r1.headers.location.includes("evil.com"),
      `POST .../action/advance?from=//evil.com redirect Location does NOT point at evil.com (open-redirect guard, ADV-003) (Location: ${r1.headers.location})`
    );

    // Backslash-prefixed bypass (browsers normalize \ to / per WHATWG URL,
    // so "/\\evil.com" resolves to http://evil.com/ despite starting with a
    // single "/" -- confirmed during Phase A audit with a direct `new URL()`
    // resolution check).
    const backslashTarget = "/\\evil.com";
    const backslashEncoded = encodeURIComponent(backslashTarget);
    const r2 = await post(port, `/task/RDR-1/action/advance?from=${backslashEncoded}`);
    assert(r2.status === 302, `POST .../action/advance?from=/\\evil.com returns 302 (got ${r2.status})`);
    assert(
      r2.headers.location && !r2.headers.location.includes("evil.com"),
      `POST .../action/advance?from=/\\evil.com redirect Location does NOT point at evil.com (backslash-normalization bypass guard, ADV-003) (Location: ${r2.headers.location})`
    );

    // A genuinely safe same-origin from= target must still work normally
    // (no false-positive regression from the tightened guard).
    const safeTarget = encodeURIComponent("/?status=todo");
    const r3 = await post(port, `/task/RDR-1/action/advance?from=${safeTarget}`);
    assert(r3.status === 302, `POST .../action/advance?from=/?status=todo (safe, same-origin) returns 302 (got ${r3.status})`);
    assert(
      r3.headers.location && r3.headers.location.startsWith("/?status=todo"),
      `POST .../action/advance with a genuinely safe from= target redirects there correctly (no over-blocking regression) (Location: ${r3.headers.location})`
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

  const port = 41740 + (process.pid % 500);
  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port });

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
  await testActionRouteOpenRedirectProtocolRelative();
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
