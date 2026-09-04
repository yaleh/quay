// @test-group product
// gap-webui-root-should-show-dashboard — `/` is the design's landing page → dashboard.
//
// AC95 had kept `/` wired to the legacy task list; the design (docs/design/quay-webui-improved-
// 2026-08-16/Quay改进版WebUI.dc.html:1049 state.page: 'dashboard' default; :1067-1068 navGroupDefs
// 核心 order [dashboard, tasks]) says dashboard lands first. This gap makes:
//   AC1 — GET / returns 3xx redirecting to /dashboard (no longer the task list);
//   AC2 — the task list stays reachable at /tasks (nav "Tasks" → /tasks, list's in-page filter/sort
//         links → /tasks, detail pages' back-to-list default → /tasks);
//   AC3 — route tests cover both paths and are green.
//
// Run (scoped): node --test packages/quay/test/gap-webui-root-should-show-dashboard.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-root-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gap-root-ws-"));
  fs.writeFileSync(path.join(tasksDir, "ROOT-001.md"),
    "---\nid: ROOT-001\ntitle: root landing fixture\ntodo: false\nstatus: todo\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n");
  fs.writeFileSync(path.join(tasksDir, "ROOT-002.md"),
    "---\nid: ROOT-002\ntitle: root landing fixture two\nstatus: done\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [x] c\n## Definition of Done\n- [x] d\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  // git-init + a commit so /dashboard's git-history card renders real data (not 读失败).
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "gap-root fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("AC1: GET / redirects to /dashboard (3xx) and no longer serves the task list", async () => {
  const r = await request(port, "/");
  assert.ok(r.status >= 300 && r.status < 400, `GET / returns 3xx (got ${r.status})`);
  assert.equal(r.headers.location, "/dashboard", `GET / Location header points at /dashboard (got ${r.headers.location})`);
  assert.equal(r.body, "", "GET / redirect body is empty (no task-list content served at /)");
});

test("AC2: GET /tasks returns the task list (200) with the seeded rows", async () => {
  const r = await request(port, "/tasks");
  assert.equal(r.status, 200, `GET /tasks returns 200 (got ${r.status})`);
  assert.match(r.body, /<h1>[^<]*task list[^<]*<\/h1>/i, "GET /tasks h1 carries the task-list label");
  assert.ok(r.body.includes("ROOT-001") && r.body.includes("ROOT-002"), "GET /tasks lists both seeded task ids");
  assert.ok(r.body.includes("root landing fixture"), "GET /tasks renders a seeded task title");
});

test("AC2: GET /dashboard returns the dashboard (200) and its nav links to /tasks (not /)", async () => {
  const r = await request(port, "/dashboard");
  assert.equal(r.status, 200, `GET /dashboard returns 200 (got ${r.status})`);
  assert.ok(r.body.includes("Dashboard"), "GET /dashboard renders the Dashboard heading");
  assert.ok(r.body.includes('href="/tasks"'), "dashboard nav/ledger links to /tasks");
  assert.ok(!r.body.includes('href="/"'), "dashboard carries no task-list href to /");
});

test("AC2: detail page back-to-list default is /tasks", async () => {
  const r = await request(port, "/task/ROOT-001");
  assert.equal(r.status, 200, `GET /task/ROOT-001 returns 200 (got ${r.status})`);
  assert.ok(r.body.includes('href="/tasks'), "detail page back-to-list link points at /tasks");
});
