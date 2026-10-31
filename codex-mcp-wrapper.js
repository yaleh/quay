#!/usr/bin/env node
"use strict";
// codex-mcp-wrapper.js — the Codex plugin's MCP entry point (gap-codex-plugin-mcp-json-nested-in-
// wrong-level, Bug B). codex resolves a RELATIVE `cwd` in the plugin's .mcp.json against the
// PLUGIN INSTALL ROOT (not the session cwd), so this wrapper runs with process.cwd() === plugin
// root. That makes the self-contained dist reachable, but the quay MCP server must operate on the
// CODEX SESSION workspace (the directory codex was launched from), not the plugin root — and codex
// passes NO workspace signal to the spawned server. So the wrapper recovers the session cwd from
// the codex parent process (/proc/<ppid>/cwd, Linux) and re-spawns the real dist with cwd pinned
// there, while exporting QUAY_PLUGIN_ROOT so Core can resolve the vendored native provider entry.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = __dirname;
const dist = path.join(pluginRoot, "vendor", "quay", "dist", "quay.js");

let sessionCwd = process.cwd();
try {
  const parentCwd = fs.readlinkSync(`/proc/${process.ppid}/cwd`);
  if (parentCwd && fs.existsSync(parentCwd)) sessionCwd = parentCwd;
} catch {
  // non-Linux or /proc unavailable — fall back to this wrapper's cwd (the plugin root).
}

const child = spawn(process.execPath, [dist, ...process.argv.slice(2)], {
  cwd: sessionCwd,
  stdio: "inherit",
  env: { ...process.env, QUAY_PLUGIN_ROOT: pluginRoot },
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 0 : code);
});
