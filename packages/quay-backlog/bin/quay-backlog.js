#!/usr/bin/env node
// quay-backlog — the Backlog.md Provider's binary (glossary.md pattern:
// quay-<providerId>). `mcp` is the formal ABI transport; `task` subcommands
// below are a convenience CLI mirroring quay-native's/quay-github's own
// (design §6 symmetry), read-only (list/get/check only — no create/edit,
// this Provider does not implement data.write).

import { createBacklogClient } from "../src/backlog-client.js";

function resolveTasksDir() {
  const dir = process.env.QUAY_BACKLOG_TASKS_DIR;
  if (!dir) {
    throw new Error("QUAY_BACKLOG_TASKS_DIR must be set to the Backlog.md board's tasks directory (e.g. /path/to/backlog/tasks)");
  }
  return dir;
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function main() {
  const [, , cmd, sub, ...rest] = process.argv;
  const tasksDir = resolveTasksDir();

  if (cmd === "mcp") {
    const { startMcpServer } = await import("../src/mcp-server.js");
    await startMcpServer({ tasksDir });
    return;
  }

  if (cmd === "manifest") {
    const { readManifest } = await import("../src/manifest.js");
    printJson(readManifest());
    return;
  }

  if (cmd === "task") {
    const client = createBacklogClient(tasksDir);
    const { flags, positional } = parseFlags(rest);

    if (sub === "list") {
      const tasks = client.list({ status: flags.status, label: flags.label });
      if (flags.json) printJson(tasks);
      else for (const t of tasks) console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}`);
      return;
    }

    if (sub === "get") {
      const id = positional[0];
      const t = client.get(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (flags.json) printJson(t);
      else {
        console.log(`${t.id}: ${t.title} [${t.status}]`);
        console.log(t.body);
      }
      return;
    }

    if (sub === "check") {
      const id = positional[0];
      const result = client.check(id);
      if (flags.json) printJson(result);
      else console.log(`${id}: ${result.ok ? "PASS" : "FAIL"} — ${result.reason}`);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    console.error(`unknown task subcommand: ${sub} (supports list/get/check — this Provider is read-only)`);
    process.exitCode = 1;
    return;
  }

  console.error("usage: quay-backlog <task list|get|check|mcp|manifest> ...");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
