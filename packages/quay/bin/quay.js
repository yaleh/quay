#!/usr/bin/env node
// quay — the Core CLI (glossary.md). Provider-agnostic, MCP client, sibling
// to the Web UI (proposal §9): `serve` / `task` / `action`.

import path from "node:path";
import fs from "node:fs/promises";
import { loadConfig, activeProvider } from "../src/config.js";
import { connectProvider } from "../src/provider-client.js";
import { composePayload, deliverTrigger } from "../src/action.js";
import { resolveProviderEnv } from "../src/provider-env.js";
import { QUAY_VERSION } from "../src/version.js";

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

// CB-021 (M08-merge-recover): `--format json` is a documented alias for
// `--json` (both flags are accepted everywhere `--json` is; see printHelp()).
// Any other `--format <value>` (e.g. `--format yaml`, `--format` with no
// value) is a usage error — it must NOT silently fall through to
// human-readable output, which is exactly the bug this closes.
// Returns { json: boolean } | null (null = invalid --format value, caller
// should print an error and exit 1).
function resolveJsonFlag(flags) {
  if (flags.format === undefined) {
    return { json: flags.json === true };
  }
  if (typeof flags.format === "string" && flags.format.toLowerCase() === "json") {
    return { json: true };
  }
  return null; // invalid --format value
}

// UQ-047/UQ-048 (M08-merge-recover): shared --page-size parser used by every
// `task list` output mode (CLI table, --json/--format json) AND documented
// for the Web UI's own ?pageSize= param (src/serve.js). A missing --page-size
// means "no limit" (existing behavior, preserved); an explicitly-invalid
// value (0, negative, non-numeric) is a hard usage error, not a silent
// fall-back to "show everything" (UQ-048).
function resolvePageSize(flags) {
  if (flags["page-size"] === undefined) {
    return { pageSize: null, error: null };
  }
  const raw = flags["page-size"];
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (typeof raw !== "string" || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return {
      pageSize: null,
      error: `Error: --page-size requires a positive integer (got ${JSON.stringify(raw)})`,
    };
  }
  return { pageSize: n, error: null };
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

// M16-cli-edit-parity-impl (design doc §1.3): read all of a readable stream
// (used for `--body-file -` / stdin) into a single string.
async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8");
}

// M16-cli-edit-parity-impl (design doc §1.3's `resolveBody` sketch):
// whole-body-replacement mode. `--body-file <path>` reads the file's full
// contents as the new body verbatim; `--body-file -` reads from stdin.
// Plain `--body <string>` remains available for short bodies passed
// directly as a shell argument. Mutual exclusion with `--body` is validated
// by the caller (task edit handler) before this is invoked.
async function resolveBody(flags) {
  if (flags["body-file"] !== undefined) {
    if (flags["body-file"] === "-") {
      return await readAll(process.stdin); // whole-body replacement from stdin
    }
    return await fs.readFile(flags["body-file"], "utf8"); // whole-body replacement from file
  }
  return flags.body; // short-string mode, already validated present by the caller
}

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

// QX-028 (experiment 4, iteration 7): strip structural heading lines from
// body content before using it as a search index. Heading lines (matching
// /^#+\s/) are template boilerplate ("## Proposal", "## Plan", "## AC",
// "## DoD") that appear in every task body and cause false positives when
// users search for those terms. Closes CB-017 (significant).
function stripHeadings(text) {
  return (text || "").split("\n").filter((line) => !/^#+\s/.test(line)).join(" ");
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
  quay --version | -V
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--page-size <n>] [--json|--format json]
  quay task view <task-id> [--json]
  quay task create <task-id> --title <title> [--body <text>|--body-file <path>] [--status <status>] [--labels <a,b>] [--parent <id>] [--children <a,b>] [--extra <json>] [--json]
  quay task edit <task-id> [--title <title>] [--status <status>] [--body <text>|--body-file <path>] [--labels <a,b>] [--extra <json>] [--parent <id>] [--children <a,b>] [--expect-status <status>] [--append-notes <text>] [--json]
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
  --search <query>    Filter by title/body content (case-insensitive)
  --page-size <n>     Limit output to the first <n> tasks (must be a positive integer)
  --json              Output as JSON
  --format json       Alias for --json (any other --format value is a usage error)

Options for task create:
  --title <title>      Title for the new task (REQUIRED — hard usage error, no provider call, if missing/empty)
  --body <text>        Initial body text (mutually exclusive with --body-file)
  --body-file <path>   Read initial body from a file ("-" for stdin; mutually exclusive with --body)
  --status <status>    Initial status (todo, ready, done, needs-human)
  --labels <a,b>       Comma-separated initial labels
  --parent <id>        Parent task id
  --children <a,b>     Comma-separated child task ids
  --extra <json>       Extra metadata as a JSON object string
  --json                Output the created task as JSON

Options for task edit:
  --title <title>       New title (see note below: required if <task-id> does not yet exist)
  --status <status>     New status (todo, ready, done, needs-human)
  --body <text>         Replace body with this text (mutually exclusive with --body-file)
  --body-file <path>    Replace body with file contents ("-" for stdin; mutually exclusive with --body)
  --labels <a,b>        Comma-separated labels (replaces existing labels)
  --extra <json>        Extra metadata as a JSON object string (merged into existing extra)
  --parent <id>         New parent task id
  --children <a,b>      Comma-separated child task ids (replaces existing children)
  --expect-status <status>  Compare-and-swap: fail if the task's current status is not this value
  --append-notes <text>     Append text to the existing body (read-then-write convenience)
  --json                 Output the edited task as JSON
  Note: editing a task id that does NOT currently exist requires --title (this is an
  upsert-as-create; a missing --title is refused with a usage error instead of silently
  creating a titleless task — use 'quay task create' for a dedicated create path instead).

Examples:
  quay task list --prefix QX          List only QX-* tasks
  quay task list --status todo        List todo tasks
  quay task list --search "bootstrap" List tasks with "bootstrap" in title or body
  quay task view QX-001               View task details
  quay task create QX-002 --title "New task"  Create a new task (title required)
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

  // UQ-047 (M08-merge-recover): top-level --version / -V. Prints the real
  // packages/quay/package.json version (via src/version.js, which is also
  // what the SEA build's build-time-embedded shim replaces — see that
  // module's header comment) and exits 0. Previously both flags fell
  // through to the generic usage error (exit 1).
  if (cmd === "--version" || cmd === "-V") {
    console.log(QUAY_VERSION);
    return;
  }

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

  // CB-021 (M08-merge-recover): --format json / --json normalization,
  // shared by every subcommand that supports JSON output (task list/view/
  // edit/check, action list). Validated up front, before connecting to any
  // provider, so an invalid --format value (e.g. --format yaml) fails fast
  // with a usage error instead of silently falling through to human-readable
  // output (the original bug this closes). Commands that don't accept
  // --json (serve, mcp) never read wantsJson, so this is a no-op for them.
  const jsonFlag = resolveJsonFlag(flags);
  const jsonCommands =
    (cmd === "task" && ["list", "view", "edit", "check", "create"].includes(sub)) ||
    (cmd === "action" && ["list", "run"].includes(sub));
  if (jsonFlag === null && jsonCommands) {
    console.error(`Error: unsupported --format value ${JSON.stringify(flags.format)} (only "json" is supported; use --json instead of --format for non-JSON output)`);
    process.exitCode = 1;
    return;
  }
  const wantsJson = jsonFlag !== null && jsonFlag.json;

  if (cmd === "task" && sub === "list") {
    // QX-005: task list --help is caught above by the sub === "--help" branch.
    // UQ-047/UQ-048: --page-size validated up front — invalid values (0, -1,
    // "abc") are a hard error, not a silent "show everything" fallback.
    const { pageSize, error: pageSizeError } = resolvePageSize(flags);
    if (pageSizeError) {
      console.error(pageSizeError);
      process.exitCode = 1;
      return;
    }
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
      // QX-037 (experiment 4, iteration 10): UQ-021 — guard --label with no value.
      // parseFlags() sets flags.label = true (boolean) when --label is passed with no value.
      // Inconsistency with --prefix (which exits 1) filed as UQ-021; fix mirrors QX-006.
      // [].concat(flags.label).filter(Boolean) below would silently drop a boolean true,
      // producing no label filter — even more confusing than a crash.
      const rawLabel = flags.label;
      if (rawLabel !== undefined && typeof rawLabel !== "string" && !Array.isArray(rawLabel)) {
        console.error("Error: --label requires a value (e.g., --label experiment-4)");
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
      // QX-028 (experiment 4, iteration 7): use stripHeadings() to exclude
      // structural markdown heading lines from the body search index.
      // Closes CB-017 (significant: template boilerplate false positives).
      const searchQuery = typeof flags.search === "string" ? flags.search : null;
      const filtered = searchQuery
        ? filteredByLabel.filter((t) =>
            (t.title + " " + stripHeadings(t.body)).toLowerCase().includes(searchQuery.toLowerCase())
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
      // CB-006/CB-022/UQ-047 (M08-merge-recover): --page-size N truncates to
      // the first N tasks (post-filter, post-sort), applied identically in
      // BOTH output modes below — this is the printJson(sorted) bug fix
      // (previously the full array was always printed in JSON mode
      // regardless of --page-size).
      const totalCount = sorted.length;
      const paged = pageSize != null ? sorted.slice(0, pageSize) : sorted;
      if (wantsJson) {
        printJson(paged);
      } else {
        // QX-021 (iteration 5): show active search query in header line.
        // QX-022 (iteration 5): include "updated" timestamp as rightmost column.
        if (prefix) console.log(`# filtered: ${prefix.toUpperCase()}-* (${totalCount} tasks)${searchQuery ? ` --search "${searchQuery}"` : ""}`);
        else if (searchQuery) console.log(`# search: "${searchQuery}" (${totalCount} matches)`);
        if (pageSize != null && pageSize < totalCount) {
          console.log(`# showing ${paged.length} of ${totalCount} tasks (--page-size ${pageSize})`);
        }
        for (const t of paged) {
          const updatedStr = typeof t.updatedAt === "number" ? relativeTimeCli(t.updatedAt) : "—";
          console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}\t${updatedStr}`);
        }
        // QX-025 (experiment 4, iteration 6): zero-result hint when --search
        // returns nothing — users often search for a label name and are confused
        // by an empty result with no guidance. Closes UQ-024 (minor).
        if (paged.length === 0 && searchQuery !== null) {
          console.log(`Hint: use --label to filter by label, or --search to match title/body content.`);
        }
        // QX-037 (experiment 4, iteration 10): UQ-020 — "No tasks found." message
        // when any filter combination returns zero results. Without this, the CLI
        // exits silently with no output and no message, which users cannot distinguish
        // from a command that failed silently or a tool that is malfunctioning.
        // The --search hint above fires for the specific search-with-no-results case;
        // this is a broader catch-all for status/label/prefix filter combinations.
        // Written to stdout (consistent with other informational output in this branch).
        if (paged.length === 0 && searchQuery === null) {
          console.log("No tasks found.");
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
      if (wantsJson) printJson(t);
      else {
        console.log(`${t.id}: ${t.title} [${t.status}]`);
        console.log(t.body);
      }
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "task" && sub === "create") {
    // M29-cli-create-ergonomics (GAP-001): dedicated Core-CLI `task create`
    // verb. --title is MANDATORY at the CLI-parsing layer — a hard usage
    // error (no provider call made at all) if missing or empty. This is
    // the structural/ergonomic complement to the `task edit` guard below;
    // together they close GAP-002 (see that guard's own comment for the
    // full mechanism trace).
    const id = positional[0];
    if (!id) {
      console.error("quay task create: missing required <id> argument");
      process.exitCode = 1;
      return;
    }
    if (flags.body !== undefined && flags["body-file"] !== undefined) {
      console.error("quay task create: --body and --body-file are mutually exclusive");
      process.exitCode = 1;
      return;
    }
    if (typeof flags.title !== "string" || flags.title.trim() === "") {
      console.error("quay task create: --title <title> is required (and must be non-empty)");
      process.exitCode = 1;
      return;
    }

    const patch = { title: flags.title };
    if (flags.status !== undefined) patch.status = flags.status;
    if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
    if (flags.parent !== undefined) patch.parent = flags.parent;
    if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
    if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
    if (flags.body !== undefined || flags["body-file"] !== undefined) {
      patch.body = await resolveBody(flags);
    }

    await withProvider(async (client) => {
      const t = await client.taskWrite({ id, ...patch });
      if (wantsJson) printJson(t);
      else console.log(`${t.id}: ${t.title} [${t.status}]`);
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "task" && sub === "edit") {
    // QN-024 (iteration 10): generic task_write passthrough, provider-
    // agnostic — same withProvider() path as list/view, zero backend
    // branch. Whether the active Provider actually implements task_write
    // is a Provider-manifest question (data.write capability), not
    // something this command special-cases.
    //
    // M16-cli-edit-parity-impl (design doc §1.2): relaxed from status-only
    // to full-field parity with the native provider CLI's own `task edit`
    // flag surface — --title/--body/--body-file/--labels/--extra/--parent/
    // --children/--expect-status/--append-notes. `--status` is no longer
    // solely required; the guard below now requires at least one
    // patch-producing flag instead.
    const id = positional[0];

    if (flags.body !== undefined && flags["body-file"] !== undefined) {
      console.error("quay task edit: --body and --body-file are mutually exclusive");
      process.exitCode = 1;
      return;
    }

    const patch = {};
    if (flags.title !== undefined) patch.title = flags.title;
    if (flags.status !== undefined) patch.status = flags.status;
    if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
    if (flags.parent !== undefined) patch.parent = flags.parent;
    if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
    if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
    if (flags.body !== undefined || flags["body-file"] !== undefined) {
      patch.body = await resolveBody(flags);
    }
    if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];

    if (Object.keys(patch).length === 0 && flags["append-notes"] === undefined) {
      console.error(
        "quay task edit: at least one of --title/--status/--body/--body-file/--labels/--extra/" +
        "--parent/--children/--append-notes is required"
      );
      process.exitCode = 1;
      return;
    }

    await withProvider(async (client) => {
      // M29-cli-create-ergonomics (GAP-002 fix): `task edit`'s own contract
      // is "patch an EXISTING task." The silent-corruption failure mode
      // (store.js#write()'s title-omission-on-create path, YAML.stringify
      // dropping an `undefined` title key) is specific to editing a
      // currently-non-existent id with no --title supplied — that path
      // upserts a titleless record instead of failing. Guard: read first
      // (taskGet), and if the id does not exist AND no --title was
      // supplied, refuse with a clear usage error instead of proceeding to
      // the taskWrite patch call below. This closes GAP-002 unconditionally
      // for every flag combination reaching this handler (not just the one
      // --status-only reproduction shape), because the check runs before
      // ANY patch is applied, regardless of which other flags were passed.
      if (flags.title === undefined) {
        const existing = await client.taskGet(id);
        if (!existing) {
          console.error(
            `quay task edit: task ${id} does not exist yet; creating a new task requires --title ` +
            `(or use 'quay task create')`
          );
          process.exitCode = 1;
          return;
        }
      }
      // M16-cli-edit-parity-impl (design doc §4 non-goals): --append-notes
      // is a Core-CLI-side read-then-write convenience, not a new ABI tool
      // — read the current body via taskGet, append the note text, then
      // taskWrite the whole new body. No native `appendNote` ABI passthrough
      // is introduced (mirrors the native CLI's own scope discipline; see
      // design doc §4's explicit non-goal).
      if (flags["append-notes"] !== undefined) {
        const current = await client.taskGet(id);
        if (!current) {
          console.error(`no such task: ${id}`);
          process.exitCode = 1;
          return;
        }
        const noteText = String(flags["append-notes"]);
        const newBody = `${current.body ?? ""}\n\n${noteText}`;
        const t = await client.taskWrite({ id, ...patch, body: newBody });
        if (wantsJson) printJson(t);
        else console.log(`${t.id}: ${t.title} [${t.status}] (note appended)`);
        return;
      }
      const t = await client.taskWrite({ id, ...patch });
      if (wantsJson) printJson(t);
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
    if (wantsJson) {
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
      if (wantsJson) printJson(buttons);
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
  console.error("usage: quay <task list|view|create|edit|check|action list|run|serve|mcp> ...\nRun `quay --help` for full usage documentation.");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
