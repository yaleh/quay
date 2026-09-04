// @test-group product
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-09 real MCP server subprocess spawns; suite-level spawn contention (round-188 9.9s fail)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this test spawns a
// REAL quay-github MCP server subprocess over stdio and drives a full task_write CREATE+EDIT roundtrip
// (~11 synchronous gh-api subprocess spawns inside the server). It passed solo / --test-concurrency=8 /
// 4-busy-loop CPU burn but FAILED under full-suite concurrency (round-188 2026-08-09: 9.9s file
// duration, failing subtest 3.9s) — suite-level subprocess spawn contention, NOT CPU load
// (gap-create-mcp-suite-context-flake-after-speedup-rework). Routed OUT of the concurrent main body to
// the concurrency-1 serial phase (same real-subprocess family as npm-pack-e2e / install-config-driven-e2e)
// and carries the machine-readable `heavy` family marker. The MCP roundtrip assertions are UNCHANGED —
// only the subprocess stderr is now piped for failure diagnosis (AC3).
// DIR-041 (M57): RED->GREEN regression test for the MCP-level CREATE
// routing -- confirms `task_write` with `id: CREATE_SENTINEL_ID` ("gh-new")
// actually reaches client.create() (not client.setStatus/writeFields, which
// would 404 against a nonexistent issue) through the REAL quay-github mcp
// stdio subprocess (bin/quay-github.ts mcp), against a STUBBED `gh` (same
// fake-gh-on-PATH technique as create.test.mjs / gh-api-buffer.test.mjs --
// no live network call, no destructive write against the real, precious
// yaleh/quay issue backlog).
//
// Run: node --test packages/quay-github/test/create-mcp.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "quay-github.ts");

/** Same fake-gh shape as create.test.mjs, trimmed to only what the MCP
 * create/edit round-trip in this file needs: POST (create), single-issue
 * GET (re-read after create/status-write), single-issue PATCH (state), and
 * collection GET (empty page -- writeRelations' parent-index rebuild, only
 * exercised if a test below supplies parent/children, which none do). */
function makeFakeGhBin({ nextNumber }) {
  const dir = mkdtempSync(join(tmpdir(), "quay-github-fake-gh-create-mcp-"));
  const stateFile = join(dir, "state.json");
  writeFileSync(stateFile, JSON.stringify({ nextNumber, issues: {} }));
  const script = join(dir, "gh");
  writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require("fs");
const stateFile = ${JSON.stringify(stateFile)};
const args = process.argv.slice(2);

function loadState() { return JSON.parse(fs.readFileSync(stateFile, "utf8")); }
function saveState(s) { fs.writeFileSync(stateFile, JSON.stringify(s)); }

function fieldsFromArgs(a) {
  const fields = {};
  const labels = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "-f") {
      const kv = a[i + 1];
      const eq = kv.indexOf("=");
      const k = kv.slice(0, eq);
      const v = kv.slice(eq + 1);
      if (k === "labels[]") labels.push(v);
      else fields[k] = v;
      i++;
    }
  }
  if (labels.length > 0) fields.labels = labels;
  return fields;
}

if (args[0] !== "api") {
  process.stderr.write("fake-gh: only 'api' subcommand supported\\n");
  process.exit(1);
}

const path = args[1];
const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";

if (/\\/issues$/.test(path) && method === "POST") {
  const fields = fieldsFromArgs(args);
  const state = loadState();
  const number = state.nextNumber;
  const issue = {
    number,
    title: fields.title,
    body: fields.body ?? null,
    state: "open",
    labels: (fields.labels ?? []).map((name) => ({ name })),
    user: { login: "test-actor" },
    html_url: "https://github.com/o/r/issues/" + number,
  };
  state.issues[String(number)] = issue;
  state.nextNumber = number + 1;
  saveState(state);
  process.stdout.write(JSON.stringify(issue));
  process.exit(0);
}

if (/\\/issues$/.test(path) && (method === "GET" || !args.includes("-X"))) {
  const state = loadState();
  process.stdout.write(JSON.stringify(Object.values(state.issues)));
  process.exit(0);
}

const getMatch = /\\/issues\\/(\\d+)$/.exec(path);
if (getMatch && (method === "GET" || !args.includes("-X"))) {
  const state = loadState();
  const issue = state.issues[getMatch[1]];
  if (!issue) {
    process.stderr.write("fake-gh: no such issue " + getMatch[1] + "\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(issue));
  process.exit(0);
}

const patchMatch = /\\/issues\\/(\\d+)$/.exec(path);
if (patchMatch && method === "PATCH") {
  const state = loadState();
  const issue = state.issues[patchMatch[1]];
  if (!issue) {
    process.stderr.write("fake-gh: no such issue " + patchMatch[1] + "\\n");
    process.exit(1);
  }
  const fields = fieldsFromArgs(args);
  if (fields.state !== undefined) issue.state = fields.state;
  if (fields.title !== undefined) issue.title = fields.title;
  if (fields.body !== undefined) issue.body = fields.body;
  saveState(state);
  process.stdout.write(JSON.stringify(issue));
  process.exit(0);
}

process.stderr.write("fake-gh: unsupported invocation: " + JSON.stringify(args) + "\\n");
process.exit(1);
`
  );
  chmodSync(script, 0o755);
  return dir;
}

test("DIR-041 GREEN: task_write with id:'gh-new' over the real MCP transport creates a real issue (stubbed gh) and returns its REAL id", async () => {
  const fakeBinDir = makeFakeGhBin({ nextNumber: 900 });
  const nodeDir = dirname(process.execPath);
  const stderrChunks = [];
  const serverStderr = () => stderrChunks.join("").trim();
  const transport = new StdioClientTransport({
    command: "node",
    args: [bin, "mcp"],
    cwd: __dirname,
    // gap-create-mcp-suite-context-flake-after-speedup-rework (AC3 diagnosis): pipe the MCP server
    // subprocess's stderr instead of inheriting it, so a suite-context failure reports the server's
    // own stderr (crash stack / task_write error) instead of only a bare SDK timeout.
    stderr: "pipe",
    env: {
      ...process.env,
      QUAY_GITHUB_REPO: "o/r",
      PATH: `${fakeBinDir}:${nodeDir}`,
    },
  });
  transport.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString()));
  const client = new Client({ name: "test-agent-create", version: "0.0.1" });
  try {
    await client.connect(transport);
  } catch (err) {
    rmSync(fakeBinDir, { recursive: true, force: true });
    assert.fail(
      `MCP connect failed: ${err.message}\n--- quay-github mcp server stderr ---\n${serverStderr() || "(no stderr captured)"}`
    );
  }
  try {
    const r = await client.callTool({
      name: "task_write",
      arguments: { id: "gh-new", title: "created via mcp task_write", body: "probe body" },
    });
    assert.equal(
      r.isError,
      undefined,
      `task_write create call did not error (got: ${JSON.stringify(r).slice(0, 300)})\n--- quay-github mcp server stderr ---\n${serverStderr() || "(no stderr captured)"}`
    );
    const task = r.structuredContent?.task;
    assert.equal(task?.id, "gh-900", "task_write with id:'gh-new' returns the REAL GitHub-assigned id, not the sentinel");
    assert.equal(task?.title, "created via mcp task_write");
    assert.equal(task?.body, "probe body");

    // A follow-up EDIT against the real returned id (status close) proves
    // the real id is genuinely usable for subsequent writes, exactly the
    // same as any pre-existing issue.
    const edited = await client.callTool({
      name: "task_write",
      arguments: { id: task.id, status: "done" },
    });
    assert.equal(
      edited.isError,
      undefined,
      `follow-up task_write status edit against the real created id succeeds (got: ${JSON.stringify(edited).slice(0, 300)})\n--- quay-github mcp server stderr ---\n${serverStderr() || "(no stderr captured)"}`
    );
    assert.equal(edited.structuredContent?.task?.status, "done");
  } finally {
    await client.close();
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("DIR-041 GREEN: task_write id:'gh-new' with NO title returns isError:true (create()'s fail-closed guard surfaces through the MCP layer, not a crash)", async () => {
  const fakeBinDir = makeFakeGhBin({ nextNumber: 1000 });
  const nodeDir = dirname(process.execPath);
  const stderrChunks = [];
  const serverStderr = () => stderrChunks.join("").trim();
  const transport = new StdioClientTransport({
    command: "node",
    args: [bin, "mcp"],
    cwd: __dirname,
    // AC3 diagnosis — see the sibling test: pipe stderr so a suite-context failure reports it.
    stderr: "pipe",
    env: {
      ...process.env,
      QUAY_GITHUB_REPO: "o/r",
      PATH: `${fakeBinDir}:${nodeDir}`,
    },
  });
  transport.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString()));
  const client = new Client({ name: "test-agent-create-notitle", version: "0.0.1" });
  try {
    await client.connect(transport);
  } catch (err) {
    rmSync(fakeBinDir, { recursive: true, force: true });
    assert.fail(
      `MCP connect failed: ${err.message}\n--- quay-github mcp server stderr ---\n${serverStderr() || "(no stderr captured)"}`
    );
  }
  try {
    const r = await client.callTool({
      name: "task_write",
      arguments: { id: "gh-new", status: "ready" },
    });
    assert.equal(
      r.isError,
      true,
      `task_write id:'gh-new' with no title is a clear isError, not a crash or silent success (got: ${JSON.stringify(r).slice(0, 300)})\n--- quay-github mcp server stderr ---\n${serverStderr() || "(no stderr captured)"}`
    );
  } finally {
    await client.close();
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});
