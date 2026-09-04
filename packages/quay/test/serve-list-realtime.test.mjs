// @test-group product
// gap-task-list-route-is-linear-in-task-count (AC5 + ABI): the task-list
// route now (a) asks the Provider for frontmatter-only tasks (`includeBody:
// false`) so the MCP round-trip stops carrying all task bodies, and (b) the
// native store keeps an mtime-keyed parse cache so repeated requests are
// O(stats) instead of O(read+YAML.parse) — WITHOUT ever serving stale data.
//
// This file is the AC5 real-time negative control for (b) — the task's own
// DoD: "用「页面显示旧数据」换来的速度，是把一个可见的慢换成一个静默的错" —
// and the ABI check for (a). It drives the REAL quay-native MCP child process
// over stdio plus a REAL serve server against a temp store, so the mtime
// cache is exercised end-to-end (a store write bumps the file's mtime → the
// next task_list must re-read it).
//
// Uses node:test (AC7) — this file is a NEW test file and therefore must use
// node:test + `// @test-group product` (web routes are a user-visible
// contract), unlike the grandfathered legacy serve.test.mjs.
//
// Run: node --test packages/quay/test/serve-list-realtime.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer } from "../src/serve.ts";
import { createStore } from "../../quay-native/src/store.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same fixture-seeding discipline as serve.test.mjs: the provider cwd is the
// SOURCE bin dir, and the MCP entry uses the resolved CLI (prebuilt dist when
// fresh, else the .ts source). A brand-new temp store is created per test.
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

function makeConfig(workspaceRoot, tasksDir) {
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
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

/** Create a temp workspace + tasks dir, seed initial tasks, start a real serve server. */
async function startFixture({ seed = [] }) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-lr-tasks-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-lr-ws-"));
  makeConfig(workspaceRoot, tasksDir);
  const store = createStore(tasksDir);
  for (const { id, ...fields } of seed) store.write(id, { labels: [], ...fields });
  const origCwd = process.cwd();
  process.chdir(workspaceRoot);
  let server;
  try {
    server = await startServer({ port: 0 });
  } catch (err) {
    process.chdir(origCwd);
    throw err;
  }
  const port = server.address().port;
  return { tasksDir, workspaceRoot, port, server, store, origCwd };
}

async function closeFixture(fx) {
  try {
    if (fx.server) {
      fx.server.close();
      if (fx.server.client) await fx.server.client.close();
    }
  } finally {
    process.chdir(fx.origCwd);
    fs.rmSync(fx.tasksDir, { recursive: true, force: true });
    fs.rmSync(fx.workspaceRoot, { recursive: true, force: true });
  }
}

test("AC5: a task written to the store appears on the very next request (mtime cache must not serve stale data)", async () => {
  const fx = await startFixture({ seed: [{ id: "LR-1", title: "initial", status: "todo", body: VALID_SECTIONS }] });
  try {
    // Baseline: LR-1 visible, LR-NEW absent.
    let page = await get(fx.port, "/tasks");
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("LR-1"), "baseline list shows the seeded task");

    // NEW task: write via the validated store path (bumps file mtime).
    fx.store.write("LR-NEW", { title: "brand new", status: "todo", body: VALID_SECTIONS });
    page = await get(fx.port, "/tasks");
    assert.ok(page.body.includes("LR-NEW"), "a NEW task file is visible on the very next GET /tasks (AC5)");

    // EDIT: change the title in place; the next request must show the new title.
    fx.store.write("LR-NEW", { title: "edited title", status: "done" });
    page = await get(fx.port, "/tasks");
    assert.ok(page.body.includes("edited title"), "an EDITED task reflects its new title on the next GET /tasks (AC5)");
    assert.ok(!page.body.includes("brand new"), "the edited task no longer shows its old title (AC5)");

    // DELETE: removing the file must hide it on the next request.
    fs.rmSync(path.join(fx.tasksDir, "LR-NEW.md"));
    page = await get(fx.port, "/tasks");
    assert.ok(!page.body.includes("edited title"), "a DELETED task disappears on the next GET /tasks (AC5)");
  } finally {
    await closeFixture(fx);
  }
});

test("AC5: body search (?q=) still matches task bodies", async () => {
  // gap-serve-search-timeout-all-body-fetch: when ?q= IS active the list route
  // pushes `search` down to the Provider (the task_list `search` param) instead
  // of requesting every task's body — the provider filters title+body
  // server-side, so the MCP round-trip carries only the matches and body search
  // keeps working without the 1572-body payload that timed out (-32001). This
  // drives the REAL quay-native MCP child process + a REAL serve server, so the
  // server-side filter is exercised end-to-end.
  const fx = await startFixture({
    seed: [
      { id: "SRCH-1", title: "Unrelated title", status: "todo", body: VALID_SECTIONS + "\nunique-body-token-lr-42\n" },
      { id: "SRCH-2", title: "Other task", status: "todo", body: VALID_SECTIONS },
    ],
  });
  try {
    const page = await get(fx.port, "/tasks?q=unique-body-token-lr-42");
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("SRCH-1"), "?q= finds a task by a body-only token (body search preserved)");
    assert.ok(!page.body.includes("SRCH-2"), "?q= excludes the non-matching task (body search is precise)");
  } finally {
    await closeFixture(fx);
  }
});

test("includeBody=false omits task bodies over the Provider ABI; the default keeps them (backward compat)", async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-lr-abi-tasks-"));
  const store = createStore(tasksDir);
  store.write("ABI-1", { title: "abi task", status: "todo", body: "## Proposal\nsecret body text that only detail needs\n" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [nativeBin, "mcp"],
    cwd: nativeProviderDir,
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  const client = new Client({ name: "serve-list-realtime-test", version: "0.0.1" });
  try {
    await client.connect(transport);

    // Default (no includeBody arg): bodies present — backward compatible.
    const full = await client.callTool({ name: "task_list", arguments: {} });
    assert.ok(!full.isError, "default task_list succeeds (isError is absent/falsy on success)");
    const fullTasks = full.structuredContent.tasks;
    assert.equal(fullTasks.length, 1);
    assert.equal(fullTasks[0].id, "ABI-1");
    assert.ok(typeof fullTasks[0].body === "string" && fullTasks[0].body.length > 0,
      "default task_list keeps the full body (backward compat)");

    // includeBody:false: bodies stripped, frontmatter fields kept.
    const slim = await client.callTool({ name: "task_list", arguments: { includeBody: false } });
    assert.ok(!slim.isError, "includeBody:false task_list succeeds");
    const slimTasks = slim.structuredContent.tasks;
    assert.equal(slimTasks.length, 1);
    assert.equal(slimTasks[0].id, "ABI-1");
    assert.equal(slimTasks[0].title, "abi task");
    assert.ok(!("body" in slimTasks[0]), "includeBody:false strips the body field from each task");
    assert.ok("status" in slimTasks[0] && "labels" in slimTasks[0] && "role" in slimTasks[0],
      "includeBody:false keeps the frontmatter fields the list page renders");
  } finally {
    try { await client.close(); } catch { /* ignore */ }
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("search param filters server-side over the Provider ABI (title + body, heading-excluded)", async () => {
  // gap-serve-search-timeout-all-body-fetch: the native task_list accepts a
  // `search` param and filters title+body server-side. This drives the REAL
  // quay-native MCP child process (same as the includeBody ABI test above) to
  // prove the filtering happens in the provider, not the caller — which is what
  // lets the web UI stop requesting every task's body for search.
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-lr-search-tasks-"));
  const store = createStore(tasksDir);
  const bodyWithFence =
    VALID_SECTIONS +
    "\n```\n# not-a-heading-just-code\n```\n" +
    "\nunique-body-token-srch\n";
  store.write("SRCH-A", { title: "Alpha search task", status: "todo", body: bodyWithFence });
  store.write("SRCH-B", { title: "Beta unrelated", status: "todo", body: VALID_SECTIONS + "\n## OnlyHeadingToken\n" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [nativeBin, "mcp"],
    cwd: nativeProviderDir,
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  const client = new Client({ name: "serve-list-realtime-search-test", version: "0.0.1" });
  try {
    await client.connect(transport);

    // Title match.
    const byTitle = await client.callTool({ name: "task_list", arguments: { search: "Alpha search" } });
    assert.ok(!byTitle.isError, "search task_list succeeds");
    assert.deepEqual(byTitle.structuredContent.tasks.map((t) => t.id), ["SRCH-A"],
      "search matches the task title server-side");

    // Body-only token match (the token is in the body, never the title).
    const byBody = await client.callTool({ name: "task_list", arguments: { search: "unique-body-token-srch" } });
    assert.deepEqual(byBody.structuredContent.tasks.map((t) => t.id), ["SRCH-A"],
      "search matches a body-only token server-side");

    // Heading lines are excluded from the body index (template boilerplate must
    // not cause false positives — the stripHeadings mirror of serve-render).
    const byHeading = await client.callTool({ name: "task_list", arguments: { search: "OnlyHeadingToken" } });
    assert.equal(byHeading.structuredContent.tasks.length, 0,
      "a token that only appears in a ## heading is NOT matched (headings stripped)");

    // Fenced code content (including `# comment` lines) IS searchable.
    const byFence = await client.callTool({ name: "task_list", arguments: { search: "not-a-heading-just-code" } });
    assert.deepEqual(byFence.structuredContent.tasks.map((t) => t.id), ["SRCH-A"],
      "a token inside a ``` fence is still searchable (fence content preserved)");

    // Case-insensitive.
    const byCase = await client.callTool({ name: "task_list", arguments: { search: "ALPHA SEARCH" } });
    assert.deepEqual(byCase.structuredContent.tasks.map((t) => t.id), ["SRCH-A"],
      "search is case-insensitive");
  } finally {
    try { await client.close(); } catch { /* ignore */ }
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("list route still renders correctly and /adr + /live stay healthy with the optimized path", async () => {
  const fx = await startFixture({
    seed: [
      { id: "OK-1", title: "List task A", status: "todo", labels: ["bug"], body: VALID_SECTIONS },
      { id: "OK-2", title: "List task B", status: "done", labels: ["bug"], body: VALID_SECTIONS },
    ],
  });
  try {
    const page = await get(fx.port, "/tasks");
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("OK-1") && page.body.includes("OK-2"), "list renders both tasks");
    assert.ok(page.body.includes("todo") && page.body.includes("done"), "list renders task statuses");
    assert.ok(page.body.includes("bug"), "label nav renders labels");

    // AC6 negative control: /adr and /live must not regress.
    const adr = await get(fx.port, "/adr");
    assert.equal(adr.status, 200);
    const live = await get(fx.port, "/live");
    assert.equal(live.status, 200);
  } finally {
    await closeFixture(fx);
  }
});
