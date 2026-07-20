#!/usr/bin/env node
// quay-native — the native Provider's binary (glossary.md).
//   `quay-native task …` — raw local file operations (convenience / internal impl).
//   `quay-native mcp`    — starts the MCP server, the formal ABI transport.
// CLI/MCP symmetry (design §6): this file and src/mcp-server.js both call
// into src/store.js — neither has logic the other lacks.

import fs from "node:fs";
import path from "node:path";
import { createStore } from "../src/store.js";
import { createAdrStore } from "../src/adr-store.js";
import { readManifest } from "../src/manifest.js";

function findRepoRoot(startDir) {
  // Walk upward looking for the workspace marker (.quay/config.yml) so the
  // default tasks dir resolves to the repo root's `tasks/`, not to whatever
  // directory `quay-native` happened to be invoked from. This fixes the
  // CWD-resolution footgun flagged by the independent audit in iteration 2
  // and reconfirmed in iteration 3 (experiments/quay-native-bootstrap/audits/iteration-3-independent-
  // adjudicate.md "New bugs found" #1): omitting QUAY_NATIVE_TASKS_DIR while
  // running from packages/quay-native/ silently resolved tasks from
  // packages/quay-native/tasks/ (a near-empty stray directory) instead of the
  // real repo-root tasks/, producing confusing "not found" gate failures.
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveTasksDir() {
  // v0: resolve relative to CWD's .quay/config.yml if present, else ./tasks
  // (kept minimal per G5 — a real config loader is `quay` Core's job, not
  // quay-native's; quay-native itself just needs *a* tasks dir).
  const envDir = process.env.QUAY_NATIVE_TASKS_DIR;
  if (envDir) return path.resolve(envDir);
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) return path.resolve(repoRoot, "tasks");
  return path.resolve(process.cwd(), "tasks");
}

function resolveAdrDir() {
  // ADRs live in a directory that SHARES a common parent with tasks/ (a repo-root
  // sibling by default). Env override QUAY_NATIVE_ADR_DIR, else repo-root ./adr.
  const envDir = process.env.QUAY_NATIVE_ADR_DIR;
  if (envDir) return path.resolve(envDir);
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) return path.resolve(repoRoot, "adr");
  return path.resolve(process.cwd(), "adr");
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

  if (cmd === "mcp") {
    const { startMcpServer } = await import("../src/mcp-server.js");
    await startMcpServer({ tasksDir: resolveTasksDir(), adrDir: resolveAdrDir() });
    return;
  }

  if (cmd === "adr") {
    const adrStore = createAdrStore(resolveAdrDir());
    const { flags, positional } = parseFlags(rest);

    if (sub === "list") {
      // E3: `--applies-to <path>` is the consult surface — filter to ADRs
      // whose `applies-to` glob(s) match the given repo-relative path (see
      // adr-store.js#appliesToMatches). Composable with --status/--tag.
      const adrs = adrStore.list({ status: flags.status, tag: flags.tag, appliesTo: flags["applies-to"] });
      if (flags.json) printJson(adrs);
      else for (const a of adrs) console.log(`${a.id}\t${a.status}\t${a.title}`);
      return;
    }
    if (sub === "get") {
      const a = adrStore.get(positional[0]);
      if (!a) { console.error(`no such ADR: ${positional[0]}`); process.exitCode = 1; return; }
      if (flags.json) printJson(a);
      else { console.log(`${a.id}: ${a.title} [${a.status}]`); console.log(a.body); }
      return;
    }
    if (sub === "write" || sub === "new" || sub === "edit") {
      const id = positional[0];
      const patch = {};
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.date !== undefined) patch.date = flags.date;
      if (flags.supersedes !== undefined) patch.supersedes = String(flags.supersedes).split(",").filter(Boolean);
      if (flags["superseded-by"] !== undefined) patch.supersededBy = String(flags["superseded-by"]).split(",").filter(Boolean);
      if (flags.tags !== undefined) patch.tags = String(flags.tags).split(",").filter(Boolean);
      if (flags["body-file"] !== undefined) patch.body = fs.readFileSync(flags["body-file"], "utf8");
      else if (flags.body !== undefined) patch.body = flags.body;
      const a = adrStore.write(id, patch);
      if (flags.json) printJson(a);
      else console.log(`wrote ${id}`);
      return;
    }
    console.error(`unknown adr subcommand: ${sub}`);
    process.exitCode = 1;
    return;
  }

  if (cmd === "manifest") {
    printJson(readManifest());
    return;
  }

  if (cmd === "task") {
    const store = createStore(resolveTasksDir());
    const { flags, positional } = parseFlags(rest);

    if (sub === "list") {
      const tasks = store.list({ status: flags.status, label: flags.label });
      if (flags.json) {
        printJson(tasks);
      } else {
        for (const t of tasks) {
          console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}`);
        }
      }
      return;
    }

    if (sub === "get") {
      const id = positional[0];
      const t = store.get(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (flags.json) {
        printJson(t);
      } else {
        console.log(`${t.id}: ${t.title} [${t.status}]`);
        console.log(t.body);
      }
      return;
    }

    if (sub === "edit") {
      const id = positional[0];
      if (!id || typeof id !== "string" || id.trim() === "") {
        console.error("task edit: missing required <id> positional argument");
        process.exitCode = 1;
        return;
      }
      const patch = {};
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
      if (flags.parent !== undefined) patch.parent = flags.parent;
      if (flags.body !== undefined) patch.body = flags.body;
      if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
      if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
      // QN-015: --expect-status wires the CAS option through the CLI path
      // (design §6 symmetry — must match the MCP task_write inputSchema
      // identically). Omitted entirely => patch.expectedStatus stays
      // undefined => store.write()'s existing, unaffected behavior.
      if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];
      if (flags["append-notes"] !== undefined) {
        const t = store.appendNote(id, flags["append-notes"]);
        if (flags.json) printJson(t);
        else console.log(`appended note to ${id}`);
        return;
      }
      try {
        const t = store.write(id, patch);
        if (flags.json) printJson(t);
        else console.log(`updated ${id}`);
      } catch (err) {
        if (err && err.name === "ConflictError") {
          if (flags.json) printJson({ error: "ConflictError", message: err.message, id: err.id, expectedStatus: err.expectedStatus, actualStatus: err.actualStatus });
          else console.error(`CAS conflict: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "create") {
      const id = positional[0];
      if (!id || typeof id !== "string" || id.trim() === "") {
        console.error("task create: missing required <id> positional argument");
        process.exitCode = 1;
        return;
      }
      const patch = {
        title: flags.title ?? id,
        status: flags.status ?? "todo",
        labels: flags.labels ? String(flags.labels).split(",").filter(Boolean) : [],
        parent: flags.parent,
        body: flags.body ?? "",
      };
      const t = store.write(id, patch);
      if (flags.json) printJson(t);
      else console.log(`created ${id}`);
      return;
    }

    if (sub === "check") {
      const id = positional[0];
      const result = store.check(id);
      if (flags.json) {
        printJson(result);
      } else {
        console.log(`${result.id}: ${result.ok ? "PASS" : "FAIL"} — ${result.reason}`);
      }
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    console.error(`unknown task subcommand: ${sub}`);
    process.exitCode = 1;
    return;
  }

  console.error(`usage: quay-native <task|mcp|manifest> ...`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
