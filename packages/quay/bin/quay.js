#!/usr/bin/env node
// quay — the Core CLI (glossary.md). Provider-agnostic, MCP client, sibling
// to the Web UI (proposal §9): `serve` / `task` / `action`.

import path from "node:path";
import { loadConfig, activeProvider } from "../src/config.js";
import { connectProvider } from "../src/provider-client.js";
import { composePayload, deliverTrigger } from "../src/action.js";
import { resolveProviderEnv } from "../src/provider-env.js";

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
        // QX-016 (experiment 4, iteration 4): support repeated flags (e.g. --label A --label B).
        // If the key already has a value, convert to array or push to existing array.
        // This fixes CB-013 (CLI last-wins bug): previously `flags[key] = next` silently
        // overwrote any prior value, so --label A --label B silently used only B.
        if (flags[key] !== undefined && flags[key] !== true) {
          flags[key] = Array.isArray(flags[key]) ? [...flags[key], next] : [flags[key], next];
        } else {
          flags[key] = next;
        }
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

// resolveProviderEnv is now imported from ../src/provider-env.js (QN-045):
// this file, src/mcp-server.js, and src/serve.js all share the single
// implementation there, closing the DESIGN.md §4.4 asymmetry.

async function withProvider(fn, { providerId } = {}) {
  const cfg = loadConfig();
  const provider = activeProvider(cfg, providerId);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;
  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    env: resolveProviderEnv(cfg, provider),
  });
  try {
    return await fn(client, cfg, provider);
  } finally {
    await client.close();
  }
}

// QX-022 (experiment 4, iteration 5): relative-time helper for CLI timestamp column.
// Mirror of serve.js's relativeTime() — kept self-contained here to avoid importing
// serve.js (which starts an HTTP server as a side effect of startServer() being called
// on import in some scenarios, and imports http/config/connectProvider at module load).
function relativeTimeCli(ts) {
  const elapsed = Date.now() - ts;
  if (elapsed < 0) return "just now";
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// QX-005 (experiment 4, iteration 1): structured help text for --help / -h.
// Previously `quay --help` fell through to the generic usage error on stderr
// (UQ-001) and `quay task --help` / `quay task list --help` likewise showed
// nothing useful (UQ-002). This closes both gaps.
//
// QX-007 (experiment 4, iteration 1): `quay serve --help` and
// `quay action --help` previously exited 0 with no output (UQ-010). Fixed by
// adding a fallback stub for unrecognised subcommand names so callers always
// get at least minimal guidance.
function printHelp(sub) {
  if (!sub || sub === "task") {
    process.stdout.write(`quay — task management for AI-assisted development

Usage:
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--json]
  quay task view <task-id> [--json]
  quay task edit <task-id> --status <status> [--json]
  quay task check <task-id> [--json]
  quay action list <task-id> [--json]
  quay action run <task-id> <action-id> [--json]
  quay serve [--port <port>]
  quay mcp

Options for task list:
  --status <status>   Filter by status (todo, ready, done, needs-human)
  --label <label>     Filter by label (repeatable: --label A --label B for AND-filter)
  --prefix <prefix>   Filter by task id prefix (e.g. QX for QX-* tasks)
  --sort id|status|updated  Sort by id, status, or last-updated time (default: insertion order)
  --search <query>    Filter by title substring (case-insensitive full-text search)
  --json              Output as JSON

Examples:
  quay task list --prefix QX          List only QX-* tasks
  quay task list --status todo        List todo tasks
  quay task list --search "bootstrap" List tasks with "bootstrap" in title
  quay task view QX-001               View task details
  quay task edit QX-001 --status done Mark task done
`);
  } else {
    // QX-007: stub for subcommands not yet documented in detail (serve, action, mcp, …).
    process.stdout.write(`Usage: quay ${sub} [...]\nRun \`quay --help\` for full usage documentation.\n`);
  }
}

async function main() {
  const [, , cmd, sub, ...rest] = process.argv;
  const { flags, positional } = parseFlags(rest);

  // QX-005: top-level --help / -h detection (UQ-001: was a one-line fallback).
  // Matches: `quay --help`, `quay -h`, `quay` with no command.
  if (cmd === "--help" || cmd === "-h" || (cmd === undefined && flags.help)) {
    printHelp();
    return;
  }

  // QX-005: subcommand-level --help (UQ-002: was missing/broken).
  // Matches: `quay task --help`, `quay task list --help`, `quay task -h`,
  //   `quay task list -h`, `quay task list --help --json`, etc.
  // When `quay task list --help` is parsed: cmd="task", sub="list", flags.help=true.
  // When `quay task --help` is parsed: cmd="task", sub="--help".
  if (sub === "--help" || sub === "-h" || flags.help) {
    printHelp(cmd);
    return;
  }

  if (cmd === "task" && sub === "list") {
    // QX-005: task list --help is caught above by the sub === "--help" branch.
    await withProvider(async (client) => {
      // QX-016 (iteration 4): pass only status to taskList; label filtering handled
      // client-side below so we can apply AND-logic for multiple --label values.
      const tasks = await client.taskList({ status: flags.status });
      // QX-002 (experiment 4, iteration 1): --prefix filter for experiment scoping.
      // Closes CB-001: `quay task list --prefix QX` returns only QX-* tasks.
      // Client-side filter after provider fetch — no provider-side changes needed.
      //
      // QX-006 (experiment 4, iteration 1): guard against `--prefix` passed with
      // no value. parseFlags() sets flags.prefix = true (boolean) in that case,
      // which causes prefix.toUpperCase() to throw a TypeError (SH-001 regression
      // from QX-002). Detect early and exit with a clear usage error.
      const prefix = flags.prefix;
      if (prefix !== undefined && typeof prefix !== "string") {
        console.error("Error: --prefix requires a value (e.g., --prefix QX)");
        process.exitCode = 1;
        return;
      }
      const filteredByPrefix = prefix
        ? tasks.filter((t) => t.id.toUpperCase().startsWith(prefix.toUpperCase()))
        : tasks;
      // QX-016 (experiment 4, iteration 4): AND-logic multi-label filter.
      // flags.label may be: undefined (no filter), a string (single --label),
      // or an array of strings (repeated --label, collected by parseFlags).
      // [].concat(flags.label).filter(Boolean) normalises all three cases to an array.
      const labelFilters = [].concat(flags.label).filter(Boolean);
      const filteredByLabel = labelFilters.length > 0
        ? filteredByPrefix.filter((t) =>
            Array.isArray(t.labels) && labelFilters.every((l) => t.labels.includes(l))
          )
        : filteredByPrefix;
      // QX-021 (experiment 4, iteration 5): --search <query> title filter.
      // Case-insensitive substring match on task title. Closes CB-007.
      // QX-023 (experiment 4, iteration 6): extend to body content too.
      // Closes CB-016 (significant: title-only search misses body content).
      const searchQuery = typeof flags.search === "string" ? flags.search : null;
      const filtered = searchQuery
        ? filteredByLabel.filter((t) =>
            (t.title + " " + (t.body || "")).toLowerCase().includes(searchQuery.toLowerCase())
          )
        : filteredByLabel;
      // QX-008 (experiment 4, iteration 2): sort-by-updated support.
      // Closes CB-004 (no sort-by-time on CLI) and CB-012 (--sort updated
      // silently ignored). Tasks include `updatedAt` (file mtime in ms) from
      // the provider (quay-native's store.js list() path). Sort descending
      // (most-recently-modified first). Tasks without updatedAt (e.g. from a
      // provider that doesn't expose it) sort after those that have it.
      const sortKey = flags.sort;
      let sorted;
      if (sortKey === "updated") {
        sorted = filtered.slice().sort((a, b) => {
          const ta = typeof a.updatedAt === "number" ? a.updatedAt : -Infinity;
          const tb = typeof b.updatedAt === "number" ? b.updatedAt : -Infinity;
          return tb - ta; // descending: most-recent first
        });
      } else if (sortKey === "id") {
        sorted = filtered.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      } else if (sortKey === "status") {
        sorted = filtered.slice().sort((a, b) =>
          a.status < b.status ? -1 : a.status > b.status ? 1 :
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        );
      } else {
        sorted = filtered; // insertion order (default)
      }
      if (flags.json) {
        printJson(sorted);
      } else {
        // QX-021 (iteration 5): show active search query in header line.
        // QX-022 (iteration 5): include "updated" timestamp as rightmost column.
        if (prefix) console.log(`# filtered: ${prefix.toUpperCase()}-* (${sorted.length} tasks)${searchQuery ? ` --search "${searchQuery}"` : ""}`);
        else if (searchQuery) console.log(`# search: "${searchQuery}" (${sorted.length} matches)`);
        for (const t of sorted) {
          const updatedStr = typeof t.updatedAt === "number" ? relativeTimeCli(t.updatedAt) : "—";
          console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}\t${updatedStr}`);
        }
        // QX-025 (experiment 4, iteration 6): zero-result hint when --search
        // returns nothing — users often search for a label name and are confused
        // by an empty result with no guidance. Closes UQ-024 (minor).
        if (sorted.length === 0 && searchQuery !== null) {
          console.log(`Hint: use --label to filter by label, or --search to match title/body content.`);
        }
      }
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "task" && sub === "view") {
    const id = positional[0];
    await withProvider(async (client) => {
      const t = await client.taskGet(id);
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
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "task" && sub === "edit") {
    // QN-024 (iteration 10): generic task_write passthrough, provider-
    // agnostic — same withProvider() path as list/view, zero backend
    // branch. Whether the active Provider actually implements task_write
    // is a Provider-manifest question (data.write capability), not
    // something this command special-cases.
    const id = positional[0];
    if (!flags.status) {
      console.error("quay task edit: --status <s> is required (v1 supports status-only writes)");
      process.exitCode = 1;
      return;
    }
    await withProvider(async (client) => {
      const t = await client.taskWrite({ id, status: flags.status });
      if (flags.json) printJson(t);
      else console.log(`${t.id}: ${t.title} [${t.status}]`);
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "task" && sub === "check") {
    // QN-027 (iteration 13): generic task_check passthrough — same
    // withProvider() path as list/view/edit, zero backend branch. Whether
    // the active Provider actually implements task_check (gate capability)
    // is a Provider-manifest question, not something this command
    // special-cases (mirrors task edit's own comment, QN-024).
    const id = positional[0];
    let result;
    await withProvider(async (client) => {
      result = await client.taskCheck(id);
    }, { providerId: flags.provider });
    if (flags.json) {
      printJson(result);
    } else {
      console.log(`${result.id}: ${result.ok ? "PASS" : "FAIL"} — ${result.reason}`);
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (cmd === "action" && sub === "list") {
    const id = positional[0];
    await withProvider(async (client) => {
      const manifest = await client.manifest();
      const t = await client.taskGet(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      const buttons = (manifest.action_buttons ?? []).filter(
        (b) => !b.whenStatus || b.whenStatus.includes(t.status)
      );
      if (flags.json) printJson(buttons);
      else for (const b of buttons) console.log(`${b.id}\t${b.label}`);
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "action" && sub === "run") {
    const [id, actionId] = positional;
    await withProvider(async (client, cfg) => {
      const manifest = await client.manifest();
      const t = await client.taskGet(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      const payloadObj = composePayload({ providerManifest: manifest, task: t, actionId });
      console.log(`[quay action run] composed trigger for ${id} (status=${t.status}, skill=${payloadObj.skill}):`);
      console.log(`  ${payloadObj.payload}`);
      const channel = `task-${id}`;
      // QN-042 (DIR-009): QUAY_ACTION_MOCK_LOG opts into the deterministic
      // mock/file-log delivery mode instead of manda/print — see
      // src/action.js#deliverTrigger's own doc comment.
      const mockLogPath = process.env.QUAY_ACTION_MOCK_LOG || undefined;
      const result = await deliverTrigger({ root: cfg.workspaceRoot, channel, payloadObj, mockLogPath });
      printJson({ ...payloadObj, channel, ...result });
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "serve") {
    const { startServer } = await import("../src/serve.js");
    // `serve` has no subcommand token — reparse from argv[2] so `--port` etc.
    // is read correctly instead of being swallowed into `sub`.
    const { flags: serveFlags } = parseFlags(process.argv.slice(3));
    await startServer({ port: serveFlags.port ? Number(serveFlags.port) : undefined });
    return;
  }

  if (cmd === "mcp") {
    // DIR-007: Core's own MCP server — the "MCP projection -> Agent" binding
    // (quay-proposal.md §5). Aggregates every Provider currently
    // `enabled: true` in .quay/config.yml behind a single MCP endpoint, so
    // an Agent (Claude Code) registers `quay mcp` once instead of each
    // Provider's own `<provider> mcp` separately. No subcommand token or
    // flags — mirrors quay-native/quay-github's own `mcp` subcommand shape.
    const { startMcpServer } = await import("../src/mcp-server.js");
    await startMcpServer();
    return;
  }

  // QX-005: updated fallback with --help hint (UQ-001/UQ-002).
  console.error("usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...\nRun `quay --help` for full usage documentation.");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
