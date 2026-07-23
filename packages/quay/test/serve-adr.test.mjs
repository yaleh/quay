// Stage 5 — ADR web views (/adr list, /adr/<id> detail). ADRs render live from
// the native store's adr/ dir; the task list (/) must NOT show them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.ts");
const nativeProviderDir = path.dirname(nativeBin);

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

let server, port, originalCwd, workspaceRoot;

before(async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-serve-tasks-"));
  const adrDir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-serve-adr-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adr-serve-ws-"));
  fs.writeFileSync(path.join(adrDir, "ADR-001-tdd-scope.md"),
    "---\nid: ADR-001\ntitle: TDD scope\nstatus: accepted\ndate: 2026-07-19\n---\n## Context\nc\n## Decision\nThe invariant we adopt.\n## Consequences\ne\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n`);
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  port = 41830 + (process.pid % 900);
  server = await startServer({ port });
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

test("GET /adr lists ADRs", async () => {
  const r = await get(port, "/adr");
  assert.equal(r.status, 200);
  assert.match(r.body, /ADR-001/);
  assert.match(r.body, /accepted/);
});

test("GET /adr/ADR-001 renders the decision body", async () => {
  const r = await get(port, "/adr/ADR-001");
  assert.equal(r.status, 200);
  assert.match(r.body, /The invariant we adopt/);
  assert.match(r.body, /Decision/);
});

test("GET /adr/nope → 404", async () => {
  assert.equal((await get(port, "/adr/ADR-999")).status, 404);
});

test("the task list (/) does not list ADRs", async () => {
  const r = await get(port, "/");
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes("ADR-001"), "ADR must not appear on the task list page");
});
