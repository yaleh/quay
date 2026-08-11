// @test-group product
// gap-mcp-server-test-deadlocks-at-high-test-concurrency — deterministic
// reproduction of the batch-tail deadlock shape: `quay mcp`'s provider
// subprocess is orphaned mid-close and holds the parent's STDERR pipe open,
// which keeps a `node --test` runner waiting on the test file's stderr EOF
// indefinitely (wchan=ep_poll, ~0% CPU — the exact signature in the task's
// three reproductions).
//
// WHY this is the repro (and why it is deterministic where the field was not):
// the real deadlocks appeared at the tail of 300-600 file batches at conc=8/16,
// when the machine was under sustained load. Under that load, `quay mcp`'s
// provider cleanup (sequential `client.close()` per provider in the onclose
// handler) can exceed the 2s grace window the SDK's StdioClientTransport.close()
// allows before it SIGTERMs / SIGKILLs the `quay mcp` child. When the child is
// killed BEFORE finishing provider cleanup, the provider subprocesses are
// orphaned. Those orphans inherit the test file's STDERR (StdioClientTransport
// defaults stderr to "inherit"), so the test file's stderr pipe never reaches
// EOF and the runner waits forever.
//
// This file makes that race deterministic WITHOUT needing 600 files: the
// provider is a deliberately "stubborn" MCP server that ignores stdin EOF and
// SIGTERM, so `quay mcp`'s cleanup of it takes the full 4s (2s grace + SIGTERM
// ignored + 2s + SIGKILL). The test closes its client, which SIGTERMs the
// `quay mcp` child at the 2s mark — mid-cleanup — orphaning the stubborn
// provider.
//
// With the FIX (provider stderr piped + forwarded in provider-client.ts), the
// orphaned provider holds a pipe to the dead `quay mcp`, NOT the test file's
// stderr, so the runner's stderr EOF is unaffected and this test completes in
// ~6-8s. Without the fix, the orphaned provider holds the test file's stderr
// and `node --test` hangs here (no timeout is possible from inside the file —
// the process is healthy and idle; the hang is in the runner waiting on EOF).
//
// Run: node --test packages/quay/test/mcp-server-deadlock-repro.test.mjs
// (a 30s wall-clock timeout on the invocation is the hang detector).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { QUAY_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the repo root so we can symlink node_modules into the temp workspace
// (the stubborn provider script lives there and needs the SDK to resolve).
const repoRoot = path.resolve(__dirname, "..", "..", "..");

// A provider that speaks just enough MCP to connect, but NEVER exits on stdin
// EOF and IGNORES SIGTERM — so closing it takes the full SIGKILL path (4s) and
// the owning `quay mcp` child gets SIGTERMed mid-cleanup, orphaning it.
const STUBBORN_PROVIDER_SRC = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const server = new McpServer({ name: "stubborn", version: "1.0.0" });
server.registerTool("task_list", { description: "ok", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { tasks: [] } }));
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("stubborn provider started");
process.stdin.on("close", () => { /* deliberately ignore stdin EOF */ });
process.on("SIGTERM", () => { /* deliberately ignore SIGTERM */ });
setInterval(() => {}, 1000); // keep the event loop alive forever
`;

test("quay mcp provider orphan no longer holds the test file's stderr (deadlock repro)", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-deadlock-repro-"));
  try {
    // Stubborn provider + node_modules symlink so the SDK resolves from the
    // temp workspace.
    fs.writeFileSync(path.join(workspaceRoot, "stubborn-provider.mjs"), STUBBORN_PROVIDER_SRC);
    try {
      fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(workspaceRoot, "node_modules"));
    } catch {
      // already linked or non-symlink-capable — proceed anyway
    }
    fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  stubborn:",
        "    enabled: true",
        `    path: "${workspaceRoot}"`,
        `    mcp_entry: ["node", "${path.join(workspaceRoot, "stubborn-provider.mjs")}"]`,
        "",
      ].join("\n")
    );

    // 1. Connect the real `quay mcp` subprocess (stderr inherits this test
    //    file's stderr — that is the pipe the deadlock hangs).
    const transport = new StdioClientTransport({
      command: "node",
      args: [QUAY_CLI, "mcp"],
      cwd: workspaceRoot,
      env: process.env,
    });
    const client = new Client({ name: "deadlock-repro", version: "0.0.1" });
    await client.connect(transport);
    assert.ok(transport.pid, `quay mcp spawned (pid ${transport.pid})`);

    // 2. Trigger the provider connection (lazy getClient).
    const r = await client.callTool({ name: "task_list", arguments: {} });
    assert.ok(!r.isError, "tool call routed through the stubborn provider succeeds");

    // 3. Graceful close. With the bug, `quay mcp` is SIGTERMed at the 2s mark
    //    mid-cleanup and the stubborn provider is orphaned holding this test
    //    file's stderr -> the runner hangs here (never returns). With the fix,
    //    the orphan holds only a pipe to the dead child and this returns.
    const t0 = Date.now();
    await client.close();
    const closeMs = Date.now() - t0;
    assert.ok(
      closeMs < 12000,
      `close completed in ${closeMs}ms (no hang — orphaned provider no longer holds this test's stderr)`
    );

    // 4. Give any orphaned provider a moment to be (or not be) reaped, then
    //    SIGKILL it so this test never accumulates orphan processes across a
    //    long suite (the stubborn provider deliberately ignores SIGTERM/stdin
    //    EOF, so only SIGKILL works; in the real providers — quay-native —
    //    there is no lingering process at all because they exit on stdin EOF).
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const pid of findStubbornProviders(workspaceRoot)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

// The stubborn provider's command line carries its temp workspace path, which
// uniquely identifies the orphan (and only the orphan) from this test run.
function findStubbornProviders(workspaceRoot) {
  const marker = path.join(workspaceRoot, "stubborn-provider.mjs");
  let out = [];
  try {
    const listing = fs.readdirSync("/proc").filter((e) => /^\d+$/.test(e));
    for (const pid of listing) {
      let cmdline = "";
      try {
        cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
      } catch {
        continue;
      }
      if (cmdline.includes(marker)) out.push(Number(pid));
    }
  } catch {
    // /proc unavailable — skip cleanup; the orphan is harmless (piped stderr)
  }
  return out;
}
