// @test-group product
// gap-one-unparseable-task-takes-down-the-whole-board — AC1..AC7.
//
// The incident: one task file whose frontmatter fails to parse (title unquoted
// and containing `## Contract` — in YAML a space-then-`#` starts a comment, so
// the title truncated and the continuation line lost its continuable object →
// "All mapping items must start at the same column") 500'd the ENTIRE web board
// at `/`. The previous per-task tolerance (gap-serve-task-list-dies-on-one-
// malformed-task) sat DOWNSTREAM of the throw in provider-client.ts's taskList()
// — the provider's task_list MCP tool threw on the one bad file, so the
// downstream store/serve tolerance never ran.
//
// The fix (this task): the PROVIDER's task_list returns PARTIAL SUCCESS — the
// parseable tasks PLUS a machine-readable malformed list ({file, error}) — so
// one bad task poisons exactly its own row. The Core's taskList() STILL throws
// on a genuine call-level failure (AC5): the earlier "silent coercion to empty
// array" hid the real failure AND every legitimate task, and that throw is what
// keeps it from coming back. The web board renders each malformed file as a
// visible .malformed-row (AC2/AC3/AC4). AC6 scans the whole repo with the real
// yaml.parse — never shape heuristics (the operator's shape-heuristic first
// pass reported 0 bad tasks; the real parser found the 1).
//
// Run: node --test packages/quay/test/unparseable-frontmatter.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import YAML from "yaml";
import { startServer } from "../src/serve.ts";
import { connectProvider } from "../src/provider-client.ts";
import { createStore } from "../../quay-native/src/store.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

// The exact root-cause shape from the incident: unquoted title containing
// `## Contract` (space + `#` = YAML comment start) with a following indented
// continuation line that then has no continuable object.
const BAD_FRONTMATTER = `---
id: UNPARSE-1
title: The ## Contract
  all mapping items must start at the same column
status: todo
---\nbody of a task whose frontmatter cannot parse\n`;
const BAD_ERROR = /All mapping items must start at the same column/;

function seedTask(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

function writeConfig(workspaceRoot, tasksDir) {
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
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

// ── AC1: the provider layer returns partial success, not a throw ─────────────

test("AC1: store.listWithMalformed() returns parseable tasks + a malformed list (file + parser error)", () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-unparse-store-"));
  try {
    seedTask(tasksDir, "GOOD-1", { title: "Good one", status: "todo", body: "ok" });
    seedTask(tasksDir, "GOOD-2", { title: "Good two", status: "todo", body: "ok" });
    fs.writeFileSync(path.join(tasksDir, "UNPARSE-1.md"), BAD_FRONTMATTER);

    const { tasks, malformed } = createStore(tasksDir).listWithMalformed();
    assert.equal(tasks.length, 2, "both parseable tasks are returned despite the 1 bad file");
    assert.deepEqual(tasks.map((t) => t.id).sort(), ["GOOD-1", "GOOD-2"]);
    assert.equal(malformed.length, 1, "exactly one malformed entry");
    assert.equal(malformed[0].file, "UNPARSE-1.md", "malformed entry names the file");
    assert.match(malformed[0].error, BAD_ERROR, "malformed entry carries the parser's raw error");

    // The plain list() (used by the native CLI) must STILL throw — a clear,
    // loud error is safe degradation; the tolerance lives in the task_list ABI.
    assert.throws(() => createStore(tasksDir).list(), BAD_ERROR, "list() keeps the loud throw (CLI surface unchanged)");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC1: the provider's task_list MCP tool returns tasks + malformed list end-to-end (no isError, no throw)", async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-unparse-mcp-"));
  let client;
  try {
    seedTask(tasksDir, "GOOD-1", { title: "Good one", status: "todo", body: "ok" });
    fs.writeFileSync(path.join(tasksDir, "UNPARSE-1.md"), BAD_FRONTMATTER);
    client = await connectProvider({
      command: "node",
      args: [nativeBin, "mcp"],
      cwd: nativeProviderDir,
      env: { QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const r = await client.taskList({});
    assert.equal(r.tasks.length, 1, "task_list returns the parseable task");
    assert.equal(r.tasks[0].id, "GOOD-1");
    assert.equal(r.malformed.length, 1, "task_list returns the malformed list");
    assert.equal(r.malformed[0].file, "UNPARSE-1.md");
    assert.match(r.malformed[0].error, BAD_ERROR, "parser error is machine-readable");
  } finally {
    if (client) await client.close();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

// ── AC2/AC3/AC4: the web board renders the bad task as a visible row ─────────

test("AC2/AC3/AC4: /tasks returns 200; the unparseable task is an explicit malformed row; removing it restores the clean list", async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-unparse-web-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "quay-unparse-web-ws-"));
  seedTask(tasksDir, "GOOD-1", { title: "Good one", status: "todo", body: "ok" });
  seedTask(tasksDir, "GOOD-2", { title: "Good two", status: "done", body: "ok" });
  fs.writeFileSync(path.join(tasksDir, "UNPARSE-1.md"), BAD_FRONTMATTER);
  writeConfig(ws, tasksDir);

  const orig = process.cwd();
  let server;
  try {
    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // ── inject direction ──
    const list = await get(port, "/tasks");
    assert.equal(list.status, 200, "AC2: GET /tasks returns 200 with 1 unparseable task (not a 500)");
    assert.match(list.body, /class="malformed-row"/, "AC3: the bad task renders as a .malformed-row");
    assert.ok(list.body.includes("UNPARSE-1.md"), "AC3: the row names which file is broken");
    assert.ok(list.body.includes("解析失败"), "AC3: the row is visibly a parse failure");
    assert.match(list.body, BAD_ERROR, "AC3: the row shows why (the parser's own error)");
    assert.ok(list.body.includes("GOOD-1") && list.body.includes("GOOD-2"), "AC4: all good tasks still list normally");
    // header row + GOOD-1 + GOOD-2 + UNPARSE-1 malformed row = 4 rows.
    assert.equal((list.body.match(/<\/tr>/g) || []).length, 4, "AC4: N-1 good rows + 1 bad row (4 </tr> total)");

    // ── remove direction (negative control: the bad row came from THAT file) ──
    fs.rmSync(path.join(tasksDir, "UNPARSE-1.md"));
    const clean = await get(port, "/tasks");
    assert.equal(clean.status, 200, "AC4: GET /tasks still 200 after removing the bad file");
    assert.ok(!clean.body.includes("class=\"malformed-row\"") && !clean.body.includes("UNPARSE-1.md"),
      "AC4: the malformed row disappears once the bad file is removed");
    assert.ok(clean.body.includes("GOOD-1") && clean.body.includes("GOOD-2"), "AC4: the good tasks are intact");
    assert.equal((clean.body.match(/<\/tr>/g) || []).length, 3, "AC4: rendered rows drop by exactly 1 (3 </tr> total)");
  } finally {
    process.chdir(orig);
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC5: a GENUINE task_list call failure still throws / still 500s ──────────

test("AC5: Core taskList() throws on a genuine call failure (provider child unusable) — never a silent empty list", async () => {
  // Point the native provider's tasks_dir at a path that is a FILE, so its
  // store creation fails at startup and the child dies. Depending on the exact
  // timing of the crash, the failure surfaces either at connect() or at the
  // first taskList() call — EITHER WAY it is loud (a rejection/throw), never a
  // silent resolve-to-[] (the old behavior this AC forbids coming back).
  const fileAsDir = path.join(os.tmpdir(), `quay-unparse-fileasdir-${process.pid}-${Date.now()}`);
  fs.writeFileSync(fileAsDir, "i am a file, not a dir\n");
  let client;
  try {
    try {
      client = await connectProvider({
        command: "node",
        args: [nativeBin, "mcp"],
        cwd: nativeProviderDir,
        env: { QUAY_NATIVE_TASKS_DIR: fileAsDir },
      });
    } catch {
      // connect() itself rejected — the failure is loud; that is what AC5 pins.
      return;
    }
    await assert.rejects(
      () => client.taskList({}),
      undefined,
      "taskList() must throw on a genuine call failure — it must NOT silently resolve to an empty list"
    );
  } finally {
    if (client) await client.close();
    fs.rmSync(fileAsDir, { force: true });
  }
});

test("AC5: the web board 500s on a genuine task_list failure, never a silent 200 with '0 tasks'", async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-unparse-ac5-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "quay-unparse-ac5-ws-"));
  writeConfig(ws, tasksDir);

  const orig = process.cwd();
  let server;
  try {
    process.chdir(ws);
    server = await startServer({ port: 0 });
    const port = server.address().port;
    // sanity: with a valid (empty) store the list page renders 200.
    const before = await get(port, "/tasks");
    assert.equal(before.status, 200, "precondition: GET /tasks is 200 with a healthy store");

    // Now make the store itself unusable at the call level: delete the tasks
    // dir out from under the running provider. The next task_list call throws
    // (ENOENT → provider isError → Core taskList throws), and the board must
    // degrade to a 500 — the ADV-001/002 "silent 200 with 0 tasks" must stay dead.
    fs.rmSync(tasksDir, { recursive: true, force: true });
    const after = await get(port, "/tasks");
    assert.equal(after.status, 500, "AC5: a genuine task_list failure degrades to 500, not a silent 200 with 0 tasks");
    assert.ok(/internal server error/i.test(after.body), "AC5: 500 body is a real error response");
  } finally {
    process.chdir(orig);
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC6: the whole repo's frontmatter parses with the REAL yaml.parse ────────

test("AC6: every task frontmatter in the repo parses with yaml.parse (0 failures) — no shape heuristics", () => {
  const tasksDir = path.join(REPO_ROOT, "tasks");
  assert.ok(fs.existsSync(tasksDir), `repo tasks dir exists at ${tasksDir}`);
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 0, "repo has tasks to scan");

  let failures = 0;
  let titlesWithHashOrColon = 0;
  const bad = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
    if (!m) {
      failures++;
      bad.push(`${f}: no YAML frontmatter block`);
      continue;
    }
    try {
      // Real parser, not shape heuristics: the operator's shape-heuristic first
      // pass reported 0 bad tasks and MISSED the one that 500'd the board.
      const fm = YAML.parse(m[1]);
      const title = typeof fm?.title === "string" ? fm.title : "";
      // 44% of titles contain " #" or ": " — harmless ONLY because writers quoted
      // them; an unquoted one is exactly this incident's root cause.
      if (/[#]|:\s/.test(title)) titlesWithHashOrColon++;
    } catch (e) {
      failures++;
      bad.push(`${f}: ${String(e.message).split("\n")[0]}`);
    }
  }

  assert.equal(
    failures,
    0,
    `yaml.parse over all ${files.length} task frontmatters: 0 failures (got: ${bad.join("; ")})`
  );
  // The hazard-surface number is reported for the record, not asserted as a
  // constant (it drifts as tasks are added): the point is 0 real failures AND
  // that a large share of titles would break if written unquoted.
  assert.ok(titlesWithHashOrColon >= 0, `titles containing # or ': ' count is a number (${titlesWithHashOrColon})`);
  console.log(`[AC6] scanned ${files.length} task files: 0 parse failures; ${titlesWithHashOrColon} titles contain '#' or ': '`);
});
