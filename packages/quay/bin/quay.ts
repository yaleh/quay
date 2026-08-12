#!/usr/bin/env node
// @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
// quay — the Core CLI (glossary.md). Provider-agnostic, MCP client, sibling
// to the Web UI (proposal §9): `serve` / `task` / `action`.

import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

function fsSyncExists(p) {
  try { fsSync.accessSync(p); return true; } catch { return false; }
}
import { loadConfig, activeProvider } from "../src/config.ts";
// gap-task-list-root-does-not-scope-config-lookup: the fail-closed `--root`
// workspace-root resolver — the same findConfig mechanism loadConfig uses
// everywhere (config-validate, serve, mcp-server), so `--root <path>` on any
// workspace-scoped command resolves config the same way (AC4: no second
// semantics) and never silently falls back to process.cwd() (AC2).
import { resolveWorkspaceRootOrThrow } from "../src/gate/config/loader.ts";
import { connectProvider } from "../src/provider-client.ts";
import { composePayload, deliverTrigger } from "../src/action.ts";
import { resolveProviderEnv } from "../src/provider-env.ts";
import { QUAY_VERSION } from "../src/version.ts";
// QENG-1: gate engine + GateEvent log. `gate`/`gate-log` are verb-less
// top-level commands (see the main() dispatch below and their arg-extraction
// note). runGate appends one GateEvent per run; runGateLogQuery is read-only.
import { runGate } from "../src/gate/engine.ts";
import { listGates, listGatesVerbose } from "../src/gate/registry.ts";
import { resolveGateLogPath, runGateLogQuery } from "../src/gate/gate-log.ts";
// DIR-103-A (M223): dry-run imports — runAcceptanceCapture (the capture
// sibling) and resolveRunnerOptions (same cwd/timeout resolution a real
// gate run uses)
import { runAcceptanceCapture } from "../src/gate/acceptance-runner.ts";
import { resolveRunnerOptions } from "../src/gate/config/utils.ts";
// QENG-3: complete/adjudicate/promote/retreat lifecycle — the thin
// status-WRITING layer over the gate engine. Four verb-less top-level commands
// (id in `sub`), each mirroring the `gate` branch's withProvider/resolveGateLogPath
// plumbing. Illegal transitions throw → the top-level catch reports them.
import { runComplete, runAdjudicate, runPromote, runRetreat } from "../src/gate/lifecycle.ts";
// QENG-4: the `quay run` driver — autonomous loop AS CODE. Verb-less top-level
// `run` command (NO positional id), mirroring the `complete` branch's plumbing
// (withProvider → resolveGateLogPath → QUAY_ACCEPTANCE_CWD). `--once` = one
// observation; bare `run` = bounded loop to fixpoint/sentinel/cap.
import { runOnce, runLoop } from "../src/gate/driver.ts";
// DIR-039 (A): generic provider-to-provider migration over the Provider ABI.
// Verb-less-style top-level `migrate` command (no positional task id) —
// mirrors `run`'s own no-positional-id shape (both scan/act over the whole
// board, not a single task).
import { migrateTasks } from "../src/migrate.ts";
// DIR-098: quay init — workspace scaffolding
import { runInit, printNextSteps } from "../src/init.ts";

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

// M56-gate-cli-error-ux (AC1): the QENG gate/lifecycle engine (engine.js
// `runGate`, lifecycle.js `assertTransition` via runPromote/runRetreat) throws
// a plain Error on a small, closed set of EXPECTED/guarded conditions —
// unknown gate name, unknown task id, illegal lifecycle transition — by
// design (lifecycle.js's own header comment: "Illegal transitions throw").
// Previously these fell through to the generic top-level `main().catch()`
// handler, which prints `err.stack` — a raw Node stack trace — for what is,
// in every one of these cases, a well-understood, already-named error
// condition (unlike `complete`'s analogous not-ready precondition, which
// already prints a clean one-line message with no stack trace). This helper
// recognizes exactly those three message shapes and prints them the same way
// `complete`'s guarded path already does: `console.error(message)` +
// `process.exitCode = 1`, no stack. Any OTHER thrown error (a genuine,
// unanticipated bug) is NOT recognized here and re-thrown, so it still falls
// through to the top-level catch and DOES print its stack trace — that
// remains correct/desired for a true programmer error.
const GUARDED_ERROR_PATTERN = /^(unknown gate: |no such task: |illegal transition: )/;

// DIR-103-A (M223): known boolean flags — when a flag name is in this set,
// parseFlags sets flags[key]=true WITHOUT consuming the next token (it stays
// a positional / next flag). Name-scoped and safe: `--dry-run` is already a
// pure boolean on the `init` surface (:1077) and no command anywhere takes a
// value after it, so this changes no existing command's parse.
const BOOLEAN_FLAGS = new Set(["dry-run"]);

/**
 * Run `fn`; on a thrown Error matching the guarded-error shapes above, print
 * its message cleanly (no stack) and set exit code 1 instead of letting it
 * propagate to the top-level stack-trace handler. Any other error re-throws.
 * @param {() => Promise<void>} fn
 */
async function withGuardedErrors(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && GUARDED_ERROR_PATTERN.test(err.message)) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

// CB-021 (M08-merge-recover): `--format json` is a documented alias for
// `--json` (both flags are accepted everywhere `--json` is; see printHelp()).
// Any other `--format <value>` (e.g. `--format yaml`, `--format` with no
// value) is a usage error — it must NOT silently fall through to
// human-readable output, which is exactly the bug this closes.
// Returns { json: boolean } | null (null = invalid --format value, caller
// should print an error and exit 1).
export function resolveJsonFlag(flags) {
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
export function resolvePageSize(flags) {
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

export function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      // DIR-103-A (M223): known boolean flags never consume the next token
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else {
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
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

// Verb-less CLI arg ordering: the six verb-less commands (gate/gate-log/complete/
// adjudicate/promote/retreat) take <task-id> as their first positional. The
// top-level destructure `const [, , cmd, sub, ...rest] = process.argv` puts
// argv[3] in `sub` and parses ONLY `rest`, so a LEADING flag (e.g.
// `quay gate --gate dod ID`) was misread as the id AND its value was dropped
// from the flag parse (flags.gate lost -> silently defaulted). Re-parse the full
// `[sub, ...rest]` — exactly as the `run` command already does — so the id and
// flags are recovered flag-aware, in either order. Returns { flags, id }; `id`
// is undefined when no positional was given (caller must emit a usage error).
export function parseVerbless(sub, rest) {
  const { flags, positional } = parseFlags([sub, ...rest].filter((a) => a !== undefined));
  return { flags, id: positional[0] };
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

// DIR-103-C — resolve the enabled provider's `acceptance_env` key to an
// absolute file path (relative paths resolve against `cfg.workspaceRoot`).
// Returns undefined when the provider has no `acceptance_env` key, so the
// caller only pins `QUAY_ACCEPTANCE_ENV` when an env file is configured.
// Defined at module scope so all 4 call sites (gate/complete/promote/run)
// share a single resolution point (DRY at the CLI layer).
function resolveAcceptanceEnvFile(cfg, provider) {
  if (typeof provider.acceptance_env !== "string" || provider.acceptance_env.trim() === "") {
    return undefined;
  }
  return path.resolve(cfg.workspaceRoot, provider.acceptance_env);
}

// DIR-046-A — pin the acceptance runner's cwd/timeout/envFile env vars for gates that
// read them (registry.js#resolveRunnerOptions), with an EXPLICIT-OVERRIDE-
// WINS precedence, replacing the previous unconditional
// `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` at each of the 4
// call sites (gate/complete/promote/run), which clobbered any pre-set env var
// or explicit flag (the exact session-8b74052c bug: the user reverse-
// engineered QUAY_ACCEPTANCE_CWD and set it, but the CLI overwrote it).
//
// Precedence (cwd): explicit `--cwd <dir>` flag > a PRE-SET QUAY_ACCEPTANCE_CWD
// (already in the env before this process's own CLI logic runs) >
// `cfg.workspaceRoot` (the default — unchanged behavior with no override).
// A per-gate `cwd` entry in the workspace's gates config (DIR-120: `.quay/
// config.yml`'s own `gates:` section for a migrated workspace; a legacy
// `.quay/gates.yml` only for a workspace with no `config.yml` at all) is a
// THIRD source, applied inside `registry.js#resolveRunnerOptions` itself
// (this function has no per-gate visibility at the CLI layer, only a
// per-INVOCATION one) — see that function's own precedence rule for how the
// two layers compose.
//
// Precedence (timeout): explicit `--timeout <ms>` flag > a pre-set
// `QUAY_ACCEPTANCE_TIMEOUT_MS` > left unset (registry.js's own 60000ms
// default / a per-gate `timeoutMs` entry in the workspace's gates config,
// per the same DIR-120 source note above, apply from there).
//
// Precedence (envFile): explicit `envFile` arg (from the enabled provider's
// `acceptance_env` config key, resolved to an absolute path by the caller) >
// a PRE-SET `QUAY_ACCEPTANCE_ENV` env var > unset (DIR-103-C). Never clobber
// a pre-set env var — same session-8b74052c bug class.
//
// @param {{ workspaceRoot: string, cwd?: string, timeout?: string|number, envFile?: string }} args
function pinAcceptanceEnv({ workspaceRoot, cwd, timeout, envFile }) {
  if (cwd) {
    process.env.QUAY_ACCEPTANCE_CWD = cwd;
  } else if (!process.env.QUAY_ACCEPTANCE_CWD) {
    process.env.QUAY_ACCEPTANCE_CWD = workspaceRoot;
  }
  // else: a pre-set QUAY_ACCEPTANCE_CWD already wins — leave it untouched.
  if (timeout !== undefined) {
    process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = String(timeout);
  }
  // else: leave QUAY_ACCEPTANCE_TIMEOUT_MS as whatever the environment
  // already has (unset by default) — registry.js's own precedence takes it
  // from there (env > per-gate timeoutMs entry in the workspace's gates
  // config > 60000ms default).
  // DIR-103-C: explicit-override-wins for QUAY_ACCEPTANCE_ENV, mirroring the
  // cwd branch's precedence exactly.
  if (envFile) {
    process.env.QUAY_ACCEPTANCE_ENV = envFile;
  }
  // else: leave QUAY_ACCEPTANCE_ENV as whatever the environment already has
  // (unset by default); a pre-set env var wins — never clobber.
}

async function withProvider(fn, { providerId, root } = {}) {
  // gap-task-list-root-does-not-scope-config-lookup: `--root <path>` scopes
  // config discovery to <path> — the start of the .quay/config.yml search is
  // moved from process.cwd() to <path> (walk-up), and a --root with no config
  // FAILS CLOSED with a clear error (AC2), never silently falling back to the
  // process cwd's config. A bare `--root` (parseFlags sets boolean true) is a
  // usage error, not a config path.
  if (root !== undefined && typeof root !== "string") {
    console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
    process.exitCode = 1;
    return;
  }
  let cfg;
  try {
    cfg = root ? loadConfig(resolveWorkspaceRootOrThrow(root)) : loadConfig();
  } catch (err) {
    if (root) {
      // Fail-closed (AC2): the error is already a clear message (from
      // resolveWorkspaceRootOrThrow) — print it cleanly, no stack, and do not
      // silently retry from process.cwd().
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
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

// DIR-039 (A): connect to a single named provider, same resolution logic
// withProvider() uses, but returning the live client (not running a
// callback then closing it) — needed by `migrate`, which must hold TWO
// provider connections (source + target) open simultaneously, unlike every
// other command here (exactly one active provider at a time).
async function connectNamedProvider(cfg, providerId) {
  const provider = activeProvider(cfg, providerId);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;
  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    env: resolveProviderEnv(cfg, provider),
  });
  return { client, provider };
}

// QX-022 (experiment 4, iteration 5): relative-time helper for CLI timestamp column.
// Mirror of serve.js's relativeTime() — kept self-contained here to avoid importing
// serve.js (which starts an HTTP server as a side effect of startServer() being called
// on import in some scenarios, and imports http/config/connectProvider at module load).
export function relativeTimeCli(ts) {
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
export function stripHeadings(text) {
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
  quay init [--force] [--dry-run] [--root <path>]   (scaffold an EMPTY task store; the loop install is the /quay:init skill, NOT this command)
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--page-size <n>] [--root <path>] [--json|--format json]
  quay task view <task-id> [--json]
  quay task create <task-id> --title <title> [--body <text>|--body-file <path>] [--status <status>] [--labels <a,b>] [--parent <id>] [--children <a,b>] [--extra <json>] [--json]
  quay task edit <task-id> [--title <title>] [--status <status>] [--body <text>|--body-file <path>] [--labels <a,b>] [--extra <json>] [--parent <id>] [--children <a,b>] [--expect-status <status>] [--acceptance <cmd>] [--append-notes <text>] [--enforce-gate] [--json]
  quay task check <task-id> [--json]
  quay action list <task-id> [--json]
  quay action run <task-id> <action-id> [--json]
  quay gate <task-id> [--gate <name>] [--cwd <dir>] [--timeout <ms>] [--dry-run]
  quay gate --list [--verbose|-v] [--json]
  quay gate-log <task-id> [--gate <name>] [--json] [--file <log-path>]
  quay complete <task-id> [--file <log-path>] [--cwd <dir>] [--timeout <ms>]
  quay adjudicate <task-id> [--file <log-path>]
  quay promote <task-id> [--file <log-path>] [--cwd <dir>] [--timeout <ms>]
  quay retreat <task-id> --reason <reason> [--file <log-path>]
  quay run [--once] [--file <log-path>] [--cwd <dir>] [--timeout <ms>]
  quay migrate --from <providerId> --to <providerId> [--json]
  quay serve [--port <port>] [--host <host>]
  quay mcp

Options for task list:
  --status <status>   Filter by status (todo, ready, done, needs-human, superseded)
  --label <label>     Filter by label (repeatable: --label A --label B for AND-filter)
  --prefix <prefix>   Filter by task id prefix (e.g. QX for QX-* tasks)
  --sort id|status|updated  Sort by id, status, or last-updated time (default: insertion order)
  --search <query>    Filter by title/body content (case-insensitive)
  --page-size <n>     Limit output to the first <n> tasks (must be a positive integer)
  --root <path>       Scope the workspace to <path>: resolve .quay/config.yml from
                      <path> (not the process cwd). Fails closed when <path> has no
                      config (no silent cwd fallback). Workspace-scoped commands
                      (task/adr/action/gate/gate-log/complete/adjudicate/promote/
                      retreat/run/migrate/config validate) all accept --root.
  --json              Output as JSON
  --format json       Alias for --json (any other --format value is a usage error)

Options for task create:
  --title <title>      Title for the new task (REQUIRED — hard usage error, no provider call, if missing or empty)
  --body <text>        Initial body text (mutually exclusive with --body-file)
  --body-file <path>   Read initial body from a file ("-" for stdin; mutually exclusive with --body)
  --status <status>    Initial status (todo, ready, done, needs-human, superseded)
  --labels <a,b>       Comma-separated initial labels
  --parent <id>        Parent task id
  --children <a,b>     Comma-separated child task ids
  --extra <json>       Extra metadata as a JSON object string
  --json                Output the created task as JSON

Options for task edit:
  --title <title>       New title (see note below: required and non-empty if <task-id> does not yet exist)
  --status <status>     New status (todo, ready, done, needs-human, superseded)
  --body <text>         Replace body with this text (mutually exclusive with --body-file)
  --body-file <path>    Replace body with file contents ("-" for stdin; mutually exclusive with --body)
  --labels <a,b>        Comma-separated labels (replaces existing labels)
  --extra <json>        Extra metadata as a JSON object string (merged into existing extra)
  --parent <id>         New parent task id
  --children <a,b>      Comma-separated child task ids (replaces existing children)
  --expect-status <status>  Compare-and-swap: fail if the task's current status is not this value
  --acceptance <cmd>        Set the runnable acceptance meter (stored in extra.acceptance; run by
                            'quay gate <id>', the default gate). Repeatable: multiple values are
                            joined with ' && '. Merged into existing extra without clobbering.
  --append-notes <text>     Append text to the existing body (read-then-write convenience)
  --enforce-gate         Opt-in: when a --status change is present, run the same gate check
                          'task check' performs BEFORE writing; refuses (exit 1, no write) if the
                          gate fails, printing the gate's reason. Without this flag (the default),
                          status transitions are UNGUARDED — no gate check is performed, matching
                          today's behavior — analogous to 'git commit --no-verify': a deliberate
                          low-level write path that does not enforce process gates unless asked to.
                          A no-op guard-check if --status is not also given (e.g. --labels alone).
  --json                 Output the edited task as JSON
  (at least one of the above patch-producing flags, or --append-notes, is required)
  Note: editing a task id that does NOT currently exist requires a non-empty --title (this is an
  upsert-as-create; a missing or empty --title is refused with a usage error instead of silently
  creating a titleless or empty-titled task — use 'quay task create' for a dedicated create path
  instead).

Gate engine commands (QENG-1/2) — evaluate a named check and append an immutable GateEvent:
  gate <task-id>    Run a named gate check against <task-id> (default gate: acceptance — runs
                    task.extra.acceptance as a shell command, fail-closed if unset). Exit 0 = PASS,
                    1 = FAIL. Appends a GateEvent to the log (see gate-log).
  gate --list       List every registered gate name (no task id required).
                    --verbose, -v     Show NAME, SOURCE, TYPE, DETAIL columns + diagnostics (DIR-104).
                    --json            Output as JSON (gates array + diagnostics array). Takes
                                      precedence over --verbose when both are present.
  gate-log <task-id>  Print the GateEvent history for <task-id> (human-readable by default).
  --gate <name>     Select a non-default named gate for 'gate'/'gate-log' (e.g. --gate dod).
  --list            With 'gate' (no task id): list registered gate names instead of running one.
  --json            With 'gate-log': output the GateEvent array as JSON instead of human-readable
                    text. With 'gate --list': output gate listing as JSON (DIR-104).
  --file <log-path>  Override the GateEvent log path for 'gate-log' (default
                    <workspaceRoot>/.quay/gate-events.jsonl).
  --cwd <dir>       DIR-046: run the acceptance command IN <dir> instead of the workspace root
                    (e.g. gate a milestone worktree BEFORE merge, not the main repo). Wins over
                    both the workspaceRoot default AND a pre-set QUAY_ACCEPTANCE_CWD env var.
                    Also honored by 'complete'/'promote'/'run'. A per-gate 'cwd' field in the
                    workspace's gates config (DIR-120: .quay/config.yml's own 'gates:' section
                    for a migrated workspace, or a legacy .quay/gates.yml — see
                    packages/quay/src/gate/config/loader.ts's own doc comment) is a
                    lower-precedence third option.
  --timeout <ms>    DIR-046: override the acceptance runner's kill deadline in milliseconds
                    (default 60000). Also honored by 'complete'/'promote'/'run'. A per-gate
                    'timeoutMs' field in that same workspace gates config is a lower-precedence
                    workspace-data alternative — a TIMEOUT failure's reason names both knobs
                    ("raise the gates config's timeoutMs / --timeout").

// Environment contract — when the acceptance gate spawns a command:
  The runner spawns 'sh -c' (a clean shell — no .bashrc/.profile is sourced).
  PATH is inherited from the invoking process, not a fixed system default.
  Override the environment with a per-provider 'acceptance_env' file:
    acceptance_env  DIR-103-C: per-provider config key in .quay/config.yml's provider
                    block — a path to an env file that is dot-sourced before every
                    acceptance command dispatched through that provider. Relative paths
                    resolve against the workspace root. If the configured file does not
                    exist, the runner fails closed BEFORE executing the acceptance
                    command. The QUAY_ACCEPTANCE_ENV env var overrides the config key
                    when pre-set (mirrors the QUAY_ACCEPTANCE_CWD / QUAY_ACCEPTANCE_
                    TIMEOUT_MS explicit-override-wins precedence — a pre-set env var is
                    never clobbered).

  --dry-run         DIR-103-A: execute task.extra.acceptance with the same cwd/timeout/env as a
                    real gate run, print stdout/stderr + exit code, but do NOT append a GateEvent
                    or mutate task status. Short form: -n. Only valid with the default
                    'acceptance' gate (--dry-run --gate dod is a usage error).

Lifecycle commands (QENG-3) — status-writing verbs over the {todo,ready,done,needs-human} phases:
  complete <id>     Precondition status=ready; runs the acceptance gate; on pass writes status=done
                    (exit 0), on fail leaves status unchanged (exit 1). Not-ready → exit 1, no gate/write.
  adjudicate <id>   Independent read-only audit pass; records an audit GateEvent (see gate-log);
                    never writes status; exit 0 always.
  promote <id>      One legal forward step (todo->ready via the dod gate; ready->done via complete).
  retreat <id> --reason <r>   One legal backward step (done->ready, ready->todo, needs-human->todo);
                    --reason is required and recorded in the GateEvent. An illegal transition
                    exits nonzero with a message.
  --file <log-path>  Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)

Driver command (QENG-4) — the autonomous loop AS CODE (scan -> gate -> complete):
  run [--once]      Scan the board for actionable 'ready' tasks (status=ready AND a non-empty
                    acceptance meter) and drive each through 'complete'. NO positional id — 'run'
                    scans the board itself, lowest actionable id first (deterministic).
                    --once  Process exactly ONE actionable task then stop (exit 0 always; a meter
                            fail leaves the task ready + records a GateEvent — a driver observation,
                            not an error). No actionable task -> prints "nothing to do", exit 0.
                    (no flag)  Bounded loop until a fixpoint (no actionable tasks left) or the stop
                            sentinel <workspaceRoot>/.quay/.stop (checked at each iteration boundary);
                            both exit 0. Only the runaway safety ceiling (maxIterations) exits 1.

Migration command (DIR-039) — generic ABI provider-to-provider task migration:
  migrate --from <providerId> --to <providerId>
                    Reads EVERY task from the --from provider via the Provider ABI (task_list) and
                    writes each one to the --to provider via the ABI (task_write) — provider-
                    agnostic, works for any pair declared in .quay/config.yml (e.g. --from github
                    --to native). Both providers connect simultaneously (does not require either
                    to be the config's 'enabled' default). Exit 0 if every task migrated cleanly;
                    exit 1 if any per-task write failed (errors are still reported, not fatal to the
                    whole run — a partial migration is visible, not silently swallowed).
  --from <providerId>  Source provider id (must exist in .quay/config.yml's providers map)
  --to <providerId>    Target provider id (must exist in .quay/config.yml's providers map, and
                        differ from --from)
  --json              Output a { total, migrated, errors } JSON summary instead of one line per task

Examples:
  quay task list --prefix QX          List only QX-* tasks
  quay task list --status todo        List todo tasks
  quay task list --search "bootstrap" List tasks with "bootstrap" in title or body
  quay task view QX-001               View task details
  quay task create QX-002 --title "New task"  Create a new task (--title required, non-empty)
  quay task edit QX-001 --status done Mark task done
`);
  } else if (sub === "init") {
    process.stdout.write(`quay init — scaffold a new quay workspace

Usage:
  quay init [--force] [--dry-run] [--root <path>]

Flags:
  --force      Overwrite existing .quay/config.yml if present.
  --dry-run    Print the generated config to stdout without writing to disk.
  --root <path>  Scaffold at <path> instead of the current working directory.

Description:
  Creates .quay/config.yml (with all 3 sections: providers, gates, loop) and
  a tasks/ directory at the project root. Auto-detects project type (Node.js /
  Go) to suggest appropriate gate defaults.

  If .quay/config.yml already exists, refuses to overwrite unless --force.

  This command only scaffolds a brand-new EMPTY task store. It does NOT lay
  down the loop mechanism (workflows, agents, gate scripts, tick docs) — the
  canonical path for onboarding an existing project onto quay-driven
  development is the /quay:init skill inside a Claude Code session:
  /quay:init --all --loop. CLI init has no --loop flag; passing it is an error.
`);
  } else if (sub === "config") {
    process.stdout.write(`quay config — validate workspace configuration

Usage:
  quay config validate [--json|--format json] [--check-files] [--root <path>]
  quay config check [--json|--format json] [--check-files] [--root <path>]

Description:
  Validates .quay/config.yml (or legacy .quay/gates.yml + .quay/loop.yml) for
  structural correctness: YAML syntax, provider fields, gate schemas, gate
  reference resolution, loop fields, and routine shapes. Exits 0 when the
  config is valid; exits 1 with diagnostics when errors are found.

  'check' is an alias for 'validate'.

  --root <path> resolves the workspace from <path> (not the process cwd),
  with the same semantics every workspace-scoped command uses — so
  "task list --root <path>" and "config validate --root <path>" agree on
  which config is in scope (no second semantics).

Options:
  --json          Output issues as a JSON array (empty on valid).
  --format json   Alias for --json.
  --check-files   Also verify that gate script/command paths reference files
                  that exist on disk.
  --root <path>   Scope the workspace to <path> (fail-closed when <path> has
                  no .quay/config.yml).
`);
  } else if (sub === "gate") {
    process.stdout.write(`quay gate — run a named gate check against a task

Usage:
  quay gate <task-id> [--gate <name>] [--cwd <dir>] [--timeout <ms>] [--dry-run]
  quay gate --list

  gate <task-id>    Run a named gate check against <task-id> (default gate: acceptance — runs
                    task.extra.acceptance as a shell command, fail-closed if unset). Exit 0 = PASS,
                    1 = FAIL. Appends a GateEvent to the gate-event log.
  gate --list       List every registered gate name (no task id required).

Flags:
  --gate <name>     Select a non-default named gate (e.g. --gate dod).
  --list            With 'gate' (no task id): list registered gate names.
  --cwd <dir>       Run the acceptance command in <dir> instead of the workspace root.
  --timeout <ms>    Override the acceptance runner's kill deadline in ms (default 60000).
  --dry-run         Execute task.extra.acceptance with the same cwd/timeout/env as a real
                    gate run, print stdout/stderr + exit code, but do NOT append a GateEvent
                    or mutate task status. Short form: -n. Only valid with the default
                    'acceptance' gate.

Environment contract — when the default 'acceptance' gate spawns a command:
  The runner spawns 'sh -c' (a clean shell — no .bashrc/.profile is sourced).
  PATH is inherited from the invoking process, not a fixed system default.
  Override the environment with a per-provider 'acceptance_env' file:
    acceptance_env  DIR-103-C: per-provider config key in .quay/config.yml's provider
                    block — a path to an env file that is dot-sourced before every
                    acceptance command dispatched through that provider. Relative paths
                    resolve against the workspace root. If the configured file does not
                    exist, the runner fails closed BEFORE executing the acceptance
                    command. The QUAY_ACCEPTANCE_ENV env var overrides the config key
                    when pre-set (mirrors the QUAY_ACCEPTANCE_CWD / QUAY_ACCEPTANCE_
                    TIMEOUT_MS explicit-override-wins precedence — a pre-set env var is
                    never clobbered).
`);
  } else {
    // QX-007: stub for subcommands not yet documented in detail (serve, action, mcp, …).
    process.stdout.write(`Usage: quay ${sub} [...]\nRun \`quay --help\` for full usage documentation.\n`);
  }
}

// ── run() — the import-callable Core CLI (gap-cli-import-refactor-run-shell-architecture) ──
// run(argv, ctx) is the whole former main() body: the command dispatch is now a
// testable unit that RETURNS { code, stdout, stderr } instead of only writing to
// the real process streams. The shell at the bottom of this file is a thin
// argv → run() → exit/write wrapper; tests import run() directly and call it
// with ctx.capture to get the command's output as return values (zero process
// derivation for command-behavior coverage).
//
// ctx (all optional):
//   capture: boolean — capture stdout/stderr into the return value
//   cwd: string      — process.chdir() for the run's duration (restored after)
//   env: object      — process.env key overrides for the run's duration (restored after)
//
// Golden-replay guarantee (AC4): the command dispatch below is byte-for-byte the
// former main() body — no command behavior was rewritten during import-ification,
// so shell mode (run(argv) with no ctx) and capture mode (run(argv, { capture: true }))
// execute the exact same code path. Equivalence is verified by the golden-replay
// blocks in packages/quay/test/cli-run.test.mjs (spawn vs run() byte-compare).
export async function run(argv, ctx = {}) {
  process.exitCode = 0;
  const capture = ctx.capture === true;
  const prevCwd = process.cwd();
  let chdirRestore = null;
  const envSavedKeys = [];
  const envSavedValues = [];
  let outBuf = "";
  let errBuf = "";
  const origStdoutWrite = process.stdout.write;
  const origStderrWrite = process.stderr.write;

  if (typeof ctx.cwd === "string" && ctx.cwd !== prevCwd) {
    process.chdir(ctx.cwd);
    chdirRestore = prevCwd;
  }
  if (ctx.env) {
    for (const k of Object.keys(ctx.env)) {
      envSavedKeys.push(k);
      envSavedValues.push(process.env[k]);
      if (ctx.env[k] === undefined) delete process.env[k];
      else process.env[k] = ctx.env[k];
    }
  }
  if (capture) {
    process.stdout.write = (s) => { outBuf += s; return true; };
    process.stderr.write = (s) => { errBuf += s; return true; };
  }

  try {
    await dispatch(argv);
    return { code: process.exitCode, stdout: outBuf, stderr: errBuf };
  } catch (err) {
    console.error(err.stack || String(err));
    process.exitCode = 1;
    return { code: 1, stdout: outBuf, stderr: errBuf };
  } finally {
    if (origStdoutWrite) process.stdout.write = origStdoutWrite;
    if (origStderrWrite) process.stderr.write = origStderrWrite;
    if (ctx.env) {
      for (let i = 0; i < envSavedKeys.length; i++) {
        const k = envSavedKeys[i];
        if (envSavedValues[i] === undefined) delete process.env[k];
        else process.env[k] = envSavedValues[i];
      }
    }
    if (chdirRestore !== null) process.chdir(chdirRestore);
  }

  // ── the command dispatch (former main() body, unchanged) ──
  async function dispatch(argv) {
    const [cmd, sub, ...rest] = argv;
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
    (cmd === "adr" && ["list", "show", "view", "new", "accept", "deprecate", "reject", "supersede"].includes(sub)) ||
    (cmd === "action" && ["list", "run"].includes(sub)) ||
    (cmd === "config" && ["validate", "check"].includes(sub));
  if (jsonFlag === null && jsonCommands) {
    console.error(`Error: unsupported --format value ${JSON.stringify(flags.format)} (only "json" is supported; use --json instead of --format for non-JSON output)`);
    process.exitCode = 1;
    return;
  }
  const wantsJson = jsonFlag !== null && jsonFlag.json;

  // ── ADR commands (separate object kind — decision lifecycle, not task lifecycle) ──
  if (cmd === "adr") {
    if (sub === "list") {
      await withProvider(async (client) => {
        const adrs = await client.adrList({ status: flags.status, tag: flags.tag });
        if (wantsJson) printJson(adrs);
        else if (adrs.length === 0) console.log("(no ADRs)");
        else for (const a of adrs) console.log(`${a.id}\t${a.status}\t${a.title}`);
      }, { providerId: flags.provider, root: flags.root });
      return;
    }
    if (sub === "show" || sub === "view") {
      const id = positional[0];
      await withProvider(async (client) => {
        const a = await client.adrGet(id);
        if (!a) { console.error(`no such ADR: ${id}`); process.exitCode = 1; return; }
        if (wantsJson) printJson(a);
        else {
          console.log(`${a.id}: ${a.title} [${a.status}]${a.date ? `  (${a.date})` : ""}`);
          if (a.supersedes?.length) console.log(`supersedes: ${a.supersedes.join(", ")}`);
          if (a.supersededBy?.length) console.log(`superseded-by: ${a.supersededBy.join(", ")}`);
          console.log(a.body);
        }
      }, { providerId: flags.provider, root: flags.root });
      return;
    }
    if (sub === "new") {
      const id = positional[0];
      if (!id) { console.error("quay adr new: missing required <id> (ADR-NNN)"); process.exitCode = 1; return; }
      if (typeof flags.title !== "string" || flags.title.trim() === "") {
        console.error("quay adr new: --title <title> is required"); process.exitCode = 1; return;
      }
      if (flags.body !== undefined && flags["body-file"] !== undefined) {
        console.error("quay adr new: --body and --body-file are mutually exclusive"); process.exitCode = 1; return;
      }
      const body = flags["body-file"] !== undefined ? await fs.readFile(flags["body-file"], "utf8") : flags.body;
      await withProvider(async (client) => {
        const patch = { id, title: flags.title, status: flags.status ?? "proposed" };
        if (flags.date !== undefined) patch.date = flags.date;
        if (flags.supersedes !== undefined) patch.supersedes = String(flags.supersedes).split(",").filter(Boolean);
        if (flags.tags !== undefined) patch.tags = String(flags.tags).split(",").filter(Boolean);
        if (body !== undefined) patch.body = body;
        const a = await client.adrWrite(patch);
        if (wantsJson) printJson(a); else console.log(`created ${id}`);
      }, { providerId: flags.provider, root: flags.root });
      return;
    }
    if (["accept", "deprecate", "reject"].includes(sub)) {
      const statusMap = { accept: "accepted", deprecate: "deprecated", reject: "rejected" };
      const id = positional[0];
      if (!id) { console.error(`quay adr ${sub}: missing required <id>`); process.exitCode = 1; return; }
      await withProvider(async (client) => {
        const a = await client.adrWrite({ id, status: statusMap[sub] });
        if (wantsJson) printJson(a); else console.log(`${id} → ${statusMap[sub]}`);
      }, { providerId: flags.provider, root: flags.root });
      return;
    }
    if (sub === "supersede") {
      const id = positional[0];
      const by = flags.by;
      if (!id || typeof by !== "string") { console.error("quay adr supersede <id> --by <newId>"); process.exitCode = 1; return; }
      await withProvider(async (client) => {
        await client.adrWrite({ id, status: "superseded", superseded_by: [by] });
        const target = await client.adrGet(by);
        const supersedes = [...new Set([...(target?.supersedes ?? []), id])];
        await client.adrWrite({ id: by, supersedes });
        if (wantsJson) printJson({ id, status: "superseded", superseded_by: [by] });
        else console.log(`${id} superseded by ${by}`);
      }, { providerId: flags.provider, root: flags.root });
      return;
    }
    console.error(`unknown adr subcommand: ${sub} (try: list, show, new, accept, deprecate, reject, supersede)`);
    process.exitCode = 1;
    return;
  }

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
      // gap-one-unparseable-task-takes-down-the-whole-board: taskList() returns
      // partial success { tasks, malformed }. The unparseable files are reported
      // on stderr — never silently dropped, and never treated as "0 tasks".
      const { tasks, malformed } = await client.taskList({ status: flags.status });
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
      // gap-one-unparseable-task-takes-down-the-whole-board: report unparseable
      // task files on stderr (so --json stays parseable) instead of silently
      // dropping them or letting them 500 the whole list.
      if (malformed.length > 0) {
        console.error(`Warning: ${malformed.length} task file(s) could not be parsed and were excluded from the list:`);
        for (const m of malformed) console.error(`  ${m.file}: ${m.error}`);
      }
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
    }, { providerId: flags.provider, root: flags.root });
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
    }, { providerId: flags.provider, root: flags.root });
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
    }, { providerId: flags.provider, root: flags.root });
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
    //
    // M31-cli-gate-enforcement: this handler's status-transition write is,
    // by design, UNGUARDED by default — it does not consult `task check`'s
    // gate logic before writing, analogous to `git commit --no-verify`.
    // `task edit` is a low-level, provider-agnostic primitive (the generic
    // taskWrite passthrough); a caller who wants gate enforcement opts in
    // explicitly via --enforce-gate, which calls the SAME client.taskCheck(id)
    // logic `task check` uses (no duplicated gate logic) before the write,
    // and refuses (exit 1, no write) if result.ok === false. This was a
    // deliberate charter-time decision (option (b) hard-block-by-default was
    // explicitly rejected: an unknown number of existing callers may rely on
    // being able to force a transition past a gate they've manually verified
    // is safe to bypass) — see charter's "Decision" section for the full
    // reasoning: the M31-cli-gate-enforcement design record. A future reader should not have to
    // re-derive this from scratch.
    const id = positional[0];
    const enforceGate = flags["enforce-gate"] !== undefined;

    if (flags.body !== undefined && flags["body-file"] !== undefined) {
      console.error("quay task edit: --body and --body-file are mutually exclusive");
      process.exitCode = 1;
      return;
    }

    // QENG-2: --acceptance sets extra.acceptance (a runnable meter). Syntactic
    // type check runs here (before withProvider), because the "at least one
    // patch-producing flag" guard below runs before the provider callback too;
    // the actual read-merge-write needs client.taskGet and so happens INSIDE
    // withProvider (proposal §2 / review note 1). A bare `--acceptance` (no
    // value) parses to boolean true and is rejected here.
    if (flags.acceptance !== undefined
        && typeof flags.acceptance !== "string" && !Array.isArray(flags.acceptance)) {
      console.error("quay task edit: --acceptance requires a command string");
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

    if (Object.keys(patch).length === 0 && flags["append-notes"] === undefined
        && flags.acceptance === undefined) {
      console.error(
        "quay task edit: at least one of --title/--status/--body/--body-file/--labels/--extra/" +
        "--parent/--children/--acceptance/--append-notes is required"
      );
      process.exitCode = 1;
      return;
    }

    await withProvider(async (client) => {
      // M31-cli-gate-enforcement (charter Decision section): `task edit
      // --status` is, and remains, UNGUARDED by default — a deliberate
      // low-level write primitive analogous to `git commit --no-verify`,
      // not a process-gate-enforcing command. This was a considered
      // rejection of hard-block-by-default (option a in the charter),
      // because flipping the default would be a breaking change to an
      // already-shipped CLI surface with an unknown number of external
      // callers (scripts, other agents' Skill-level automation) that may
      // rely on being able to force a status transition. `--enforce-gate`
      // is the additive, opt-in escape hatch for callers who DO want
      // enforcement: it calls the exact same `client.taskCheck(id)` path
      // `task check` uses (no duplicated gate logic) and refuses the write
      // if the gate fails. Only fires when the patch includes a `status`
      // field — Done-when clause 4, option (b): a non-status patch (e.g.
      // --labels only) with --enforce-gate present is a deliberate no-op
      // guard-check, not a check against irrelevant/stale gate state.
      // Placed here, BEFORE the --append-notes branch below, so a
      // combined --append-notes + --status write is also gated — the
      // gate's purpose (don't let a status transition slip past `task
      // check`) applies regardless of which code path performs the write.
      // See the M31-cli-gate-enforcement design record for the full reasoning.
      if (enforceGate && patch.status !== undefined) {
        const gateResult = await client.taskCheck(id);
        if (gateResult.ok === false) {
          console.error(
            `quay task edit: --enforce-gate refused this write — gate check failed: ${gateResult.reason}`
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
      // M29-cli-create-ergonomics (GAP-002 fix): task edit's own contract is
      // "patch an EXISTING task" — the actual silent-corruption failure mode
      // (M27-competitive-bench's most severe finding) is specific to editing
      // a NON-EXISTENT id with no (usable) --title, which reaches the native
      // provider's store.js#write() upsert-as-create path with title
      // `undefined` and silently omits the title key from the serialized
      // frontmatter (YAML.stringify drops undefined-valued keys). Guard:
      // read-before-write via taskGet — if the id does not currently exist
      // AND no non-empty --title was supplied, refuse with a clear usage
      // error instead of silently upserting a titleless (or, per iteration-1's
      // own skepticism-pass finding, empty-titled) record. This covers every
      // non-title flag combination (--status/--body/--labels/--parent/
      // --children/--extra/--expect-status), not just the --status-only
      // shape M27 happened to reproduce, because the guard fires on the
      // (missing-or-empty-title, non-existent-id) precondition alone,
      // independent of which other flags were supplied.
      //
      // Empty-string --title check added independently by iteration-1 after
      // discovering `task edit <new-id> --title "" --status todo` slipped
      // past a title!==undefined-only guard and wrote `title: ""` — a
      // different but sibling degenerate-title defect to GAP-002's literal
      // "no title key at all" symptom, closed here under the same guard for
      // consistency with `task create`'s own empty-title rejection above.
      if (patch.title === undefined || String(patch.title).trim() === "") {
        const existing = await client.taskGet(id);
        if (!existing) {
          console.error(
            `quay task edit: task ${id} does not exist yet; creating a new task requires ` +
            `--title (or use 'quay task create')`
          );
          process.exitCode = 1;
          return;
        }
      }
      // QENG-2 (proposal §2, review note 1): read-merge-write extra.acceptance
      // INSIDE withProvider (needs client.taskGet). A list value is joined with
      // `&&` so the stored value is always one string the acceptance gate runs
      // as-is. Merge preserves other extra keys and any --extra patch.
      if (flags.acceptance !== undefined) {
        const cmd = Array.isArray(flags.acceptance) ? flags.acceptance.join(" && ") : flags.acceptance;
        const current = await client.taskGet(id);
        patch.extra = { ...(current?.extra ?? {}), ...(patch.extra ?? {}), acceptance: cmd };
      }
      const t = await client.taskWrite({ id, ...patch });
      if (wantsJson) printJson(t);
      else console.log(`${t.id}: ${t.title} [${t.status}]`);
    }, { providerId: flags.provider, root: flags.root });
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
    }, { providerId: flags.provider, root: flags.root });
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
    }, { providerId: flags.provider, root: flags.root });
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
    }, { providerId: flags.provider, root: flags.root });
    return;
  }

  if (cmd === "serve") {
    const { startServer } = await import("../src/serve.ts");
    // `serve` has no subcommand token — reparse from argv[2] so `--port` etc.
    // is read correctly instead of being swallowed into `sub`.
    const { flags: serveFlags } = parseFlags(argv.slice(1));
    await startServer({
      port: serveFlags.port ? Number(serveFlags.port) : undefined,
      host: serveFlags.host || undefined,
    });
    return;
  }

  if (cmd === "mcp") {
    // DIR-007: Core's own MCP server — the "MCP projection -> Agent" binding
    // (quay-proposal.md §5). Aggregates every Provider currently
    // `enabled: true` in .quay/config.yml behind a single MCP endpoint, so
    // an Agent (Claude Code) registers `quay mcp` once instead of each
    // Provider's own `<provider> mcp` separately. No subcommand token or
    // flags — mirrors quay-native/quay-github's own `mcp` subcommand shape.
    const { startMcpServer } = await import("../src/mcp-server.ts");
    await startMcpServer();
    return;
  }

  // DIR-098: quay init — scaffold a new workspace (.quay/config.yml + tasks/ dir).
  // Does NOT require an existing config (loadConfig() throws without one — that
  // is the whole point of `init`). No provider connection needed.
  if (cmd === "init") {
    // Re-parse flags from [sub, ...rest] so --force, --dry-run, --root are seen
    // regardless of whether they land in sub or rest.
    const { flags: initFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

    // --help / -h for init subcommand
    if (sub === "--help" || sub === "-h" || initFlags.help) {
      process.stdout.write(`quay init — scaffold a new quay workspace

Usage:
  quay init [--force] [--dry-run] [--root <path>]

Flags:
  --force      Overwrite existing .quay/config.yml if present.
  --dry-run    Print the generated config to stdout without writing to disk.
  --root <path>  Scaffold at <path> instead of the current working directory.

Description:
  Creates .quay/config.yml (with all 3 sections: providers, gates, loop) and
  a tasks/ directory at the project root. Auto-detects project type (Node.js /
  Go) to suggest appropriate gate defaults.

  If .quay/config.yml already exists, refuses to overwrite unless --force.

  This command only scaffolds a brand-new EMPTY task store. It does NOT lay
  down the loop mechanism (workflows, agents, gate scripts, tick docs) — the
  canonical path for onboarding an existing project onto quay-driven
  development is the /quay:init skill inside a Claude Code session:
  /quay:init --all --loop. CLI init has no --loop flag; passing it is an error.
`);
      return;
    }

    // Collision guard (gap-cli-quay-init-collides-with-the-canonical-slash-quay-init).
    // CLI `quay init` (DIR-098) scaffolds a brand-new EMPTY task store
    // (.quay/config.yml + tasks/) — it does NOT lay down the loop mechanism.
    // The full two-layer loop install (workflows, agents, gate scripts, tick
    // docs) is the /quay:init skill — the human-ruled CANONICAL onboarding path.
    // A real user on B ran `quay init --loop`; the flag was silently swallowed
    // and exit 0 reported success while plugin/scripts=0 and orchestration/=0
    // (nothing but the empty store was laid). Fail closed and point at the skill.
    if (initFlags.loop) {
      console.error(
        "quay init: unrecognized option --loop.\n" +
        "CLI `quay init` only scaffolds a brand-new EMPTY quay task store\n" +
        "(.quay/config.yml + tasks/); it accepts only --force / --dry-run / --root.\n" +
        "\n" +
        "To lay the full quay loop mechanism into an existing project, the canonical\n" +
        "path is the /quay:init skill inside a Claude Code session:\n" +
        "\n" +
        "    /quay:init --all --loop\n" +
        "\n" +
        "Run `quay init --help` for the CLI surface, or open Claude Code in this\n" +
        "project and run /quay:init."
      );
      process.exitCode = 1;
      return;
    }

    const targetRoot = typeof initFlags.root === "string" ? initFlags.root : process.cwd();
    const force = initFlags.force === true;
    const dryRun = initFlags["dry-run"] === true;

    try {
      const result = runInit({ root: targetRoot, force, dryRun });

      if (result.outcome === "skipped") {
        console.error(
          `.quay/config.yml already exists at ${result.configPath}. ` +
          "Use --force to overwrite, or --dry-run to preview."
        );
        process.exitCode = 1;
        return;
      }

      if (result.outcome === "dry-run") {
        console.log(result.content);
        console.log(`\n# Dry run — nothing written to disk.`);
        console.log(`# Would create: ${result.configPath}`);
        console.log(`# Would create: ${result.tasksDir}/`);
        console.log(`# Would create: ${result.launchSettingsPath}`);
        return;
      }

      console.log(`Created ${result.configPath}`);
      console.log(`Created ${result.tasksDir}/ (or already existed)`);
      console.log(`Created ${result.launchSettingsPath}`);
      printNextSteps("native", result.tasksDir);
    } catch (err) {
      console.error(`quay init: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  // DIR-099-A: config validate — structural validation pass over workspace config.
  // Does NOT require a provider connection (pure static analysis of config files).
  // gap-task-list-root-does-not-scope-config-lookup AC4: `--root <path>` is
  // supported with the SAME semantics as every workspace-scoped command —
  // config discovery starts at <path> (walk-up), fail-closed when no config.
  if (cmd === "config" && (sub === "validate" || sub === "check")) {
    if (flags.root !== undefined && typeof flags.root !== "string") {
      console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
      process.exitCode = 1;
      return;
    }
    let cfg;
    try {
      cfg = flags.root ? loadConfig(resolveWorkspaceRootOrThrow(flags.root)) : loadConfig();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    const workspaceRoot = cfg.workspaceRoot;
    const checkFiles = flags["check-files"] === true;

    const { validateConfig } = await import("../src/config-validate.ts");
    const result = validateConfig({ workspaceRoot, checkFiles });

    if (wantsJson) {
      printJson(result.issues);
    } else {
      if (result.issues.length === 0) {
        console.log("Config valid.");
      } else {
        for (const issue of result.issues) {
          console.log(`${issue.severity}: ${issue.field} — ${issue.message}`);
          if (issue.suggestion) console.log(`  suggestion: ${issue.suggestion}`);
        }
        const errorCount = result.issues.filter((i) => i.severity === "error").length;
        const warnCount = result.issues.filter((i) => i.severity === "warn").length;
        const parts = [];
        if (errorCount > 0) parts.push(`${errorCount} error(s)`);
        if (warnCount > 0) parts.push(`${warnCount} warning(s)`);
        console.log(`${parts.join(", ")} found.`);
      }
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  // DIR-099-A: unknown config subcommand
  if (cmd === "config") {
    console.error(`quay config: unknown subcommand "${sub}" (try "validate" or "check")`);
    process.exitCode = 1;
    return;
  }

  // QENG-1: gate engine. `gate`/`gate-log` are verb-less top-level commands, so
  // the task id lands in `sub` (not positional[0]), and `--list` is detected as
  // `sub === "--list"` — parseFlags never runs on it, so `flags.list` is never
  // set (proposal §"Architect review notes" #1). Both handlers sit before the
  // generic-usage fallback.
  if (cmd === "gate" && sub === "--list") {
    // DIR-104: normalize -v → --verbose (parseFlags handles only --prefixed flags)
    // and parse flags so `--verbose` / `--json` reach the handler.
    const listArgs = (rest ?? []).map((a) => (a === "-v" ? "--verbose" : a));
    const { flags: listFlags } = parseFlags(listArgs);
    // AC1: list registered gates, one per line, exit 0. No provider connection
    // (loadConfig() only reads .quay/config.yml — no MCP process spawned).
    // DIR-035-B: pass this workspace's own root explicitly so `--list` reflects
    // ITS declared gates (DIR-120: `.quay/config.yml`'s own `gates:` section
    // for a migrated workspace, or a legacy `.quay/gates.yml` only for a
    // workspace with no `config.yml` — see loader.ts's own doc comment) +
    // the product's built-ins, not whatever workspace happens to be
    // discoverable from cwd. A workspace with no `.quay/config.yml` at all
    // (loadConfig throws) falls back to cwd-based auto-discovery
    // (listGates()'s own default), same as before this change.
    let workspaceRoot;
    try {
      // gap-task-list-root-does-not-scope-config-lookup: honor `--root` the
      // same way every workspace-scoped command does — start config discovery
      // at <path> (walk-up), fail-closed when no config. The lenient
      // no-config fallback (workspaceRoot = undefined → built-ins only) is
      // preserved for the no-`--root` case.
      if (listFlags.root !== undefined) {
        if (typeof listFlags.root !== "string") {
          console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
          process.exitCode = 1;
          return;
        }
        workspaceRoot = loadConfig(resolveWorkspaceRootOrThrow(listFlags.root)).workspaceRoot;
      } else {
        workspaceRoot = loadConfig().workspaceRoot;
      }
    } catch {
      workspaceRoot = undefined;
    }
    const verbose = listFlags.verbose === true;
    const json = listFlags.json === true;
    if (!verbose && !json) {
      // AC6: flagless path — byte-identical to current behavior.
      console.log(listGates(workspaceRoot).join("\n"));
    } else {
      const { rows, diagnostics } = listGatesVerbose(workspaceRoot);
      if (json) {
        // AC7: JSON output (takes precedence over verbose table when both flags present).
        printJson({ gates: rows, diagnostics });
      } else {
        // AC1/AC2/AC3: verbose table with NAME, SOURCE, TYPE, DETAIL columns.
        const nameWidth = Math.max(...rows.map((r) => r.name.length), 4);
        const sourceWidth = Math.max(...rows.map((r) => r.source.length), 6);
        const typeWidth = Math.max(...rows.map((r) => r.type.length), 4);
        const pad = (s: string, w: number) => s.padEnd(w);
        for (const r of rows) {
          console.log(`${pad(r.name, nameWidth)}  ${pad(r.source, sourceWidth)}  ${pad(r.type, typeWidth)}  ${r.detail}`);
        }
        // AC4/AC5: diagnostics section. The count-label must agree with the
        // per-line severity labels (DIR-100-C moved missing-required-field to
        // ERROR while shadowed-legacy stays WARNING) — compute per-level counts
        // instead of assuming all diagnostics are warnings.
        if (diagnostics.length > 0) {
          const errCount = diagnostics.filter((d) => d.level === "ERROR").length;
          const warnCount = diagnostics.filter((d) => d.level === "WARNING").length;
          const label = errCount > 0 && warnCount > 0
            ? `${errCount} error${errCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"}`
            : errCount > 0
              ? `${errCount} error${errCount === 1 ? "" : "s"}`
              : `${warnCount} warning${warnCount === 1 ? "" : "s"}`;
          console.log(`\n## Diagnostics (${label})`);
          for (const d of diagnostics) {
            console.log(`\n${d.level}: ${d.message}`);
          }
        }
      }
    }
    return;
  }

  if (cmd === "gate") {
    // DIR-103-A (M223): normalize -n short flag to --dry-run before parsing.
    // parseFlags handles only --prefixed flags, so a raw -n would fall through
    // to positional and be misread as the task id.
    const gateSub = sub === "-n" ? "--dry-run" : sub;
    const gateRest = rest.map(a => a === "-n" ? "--dry-run" : a);
    // AC2: evaluate a named gate against <task>; exit 0 pass / 1 fail; append
    // exactly one GateEvent. Mirrors `task check`'s exit-code plumbing
    // (process.exitCode = ok ? 0 : 1). Id + flags are flag-aware in either order
    // (see the verb-less CLI arg-ordering note above).
    const { flags: vf, id } = parseVerbless(gateSub, gateRest);
    if (!id) { console.error("quay gate: missing required <task-id> argument"); process.exitCode = 1; return; }
    await withProvider(async (client, cfg, provider) => {
      const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: vf.file });
      // QENG-2 (proposal §4, review note 2): default gate is `acceptance` at the
      // CLI layer only (engine's own `gate="dod"` default is untouched — only
      // direct programmatic callers hit it). `--gate dod` still routes to QENG-1's
      // dod gate. DIR-046-A: `--cwd`/`--timeout` (or a pre-set env var) win over
      // the workspaceRoot pin — see pinAcceptanceEnv's own doc comment.
      const gate = vf.gate ?? "acceptance";
      pinAcceptanceEnv({ workspaceRoot: cfg.workspaceRoot, cwd: vf.cwd, timeout: vf.timeout, envFile: resolveAcceptanceEnvFile(cfg, provider) });
      // DIR-103-A (M223): --dry-run / -n — execute the acceptance command with
      // stdout/stderr capture WITHOUT appending a GateEvent or mutating status.
      const dryRun = vf["dry-run"] === true;
      if (dryRun) {
        // M56-gate-cli-error-ux (AC1): named-gate dry-run / missing-task are
        // guarded (expected) errors — see withGuardedErrors' own comment.
        await withGuardedErrors(async () => {
          if (gate !== "acceptance") {
            console.error("quay gate --dry-run: only the 'acceptance' gate supports dry-run (it executes a shell command)");
            process.exitCode = 1;
            return;
          }
          const task = await client.taskGet(id);
          if (!task) throw new Error(`no such task: ${id}`);
          const command = (task.extra as Record<string, unknown>)?.acceptance;
          if (typeof command !== "string" || command.trim() === "") {
            throw new Error(`no acceptance command defined (set with \`quay task edit <id> --acceptance '<cmd>'\`)`);
          }
          const { cwd, timeoutMs } = resolveRunnerOptions();
          const r = runAcceptanceCapture({ command, cwd, timeoutMs });
          process.stdout.write(r.output);
          if (r.timedOut) {
            console.log(`dry-run: timed out after ${timeoutMs}ms`);
          } else {
            console.log(`dry-run: exit ${r.code ?? "?"}`);
          }
          process.exitCode = r.code ?? 1;
        });
        return;
      }
      // DIR-035-B: thread the resolved workspace root through so a named
      // gate declared in THIS workspace's own gates config (DIR-120:
      // `.quay/config.yml`'s own `gates:` section for a migrated workspace,
      // or a legacy `.quay/gates.yml` only for a workspace with no
      // `config.yml`) resolves correctly regardless of the process's cwd at
      // invocation time.
      // M56-gate-cli-error-ux (AC1): unknown-gate / missing-task are
      // guarded (expected) errors — see withGuardedErrors' own comment.
      await withGuardedErrors(async () => {
        const { ok, reason } = await runGate({ client, id, gate, logPath, workspaceRoot: cfg.workspaceRoot });
        console.log(ok ? "PASS" : `FAIL — ${reason}`);
        process.exitCode = ok ? 0 : 1;
      });
    }, { providerId: vf.provider, root: vf.root });
    return;
  }

  if (cmd === "gate-log") {
    // AC3: read-only query of GateEvents for <task>, filtered by pipeline_id.
    // Never appends. `--json` is read directly off flags.json. Id + flags are
    // flag-aware in either order (see the verb-less CLI arg-ordering note above).
    // A missing id is an
    // explicit usage error (exit 1) — chosen deliberately over the previous
    // silent-empty output, to mirror the other five verb-less commands, which all
    // require an id; querying ALL ids unfiltered is a distinct operation that
    // would need its own explicit flag, not a missing-argument fallthrough.
    const { flags: vf, id } = parseVerbless(sub, rest);
    if (!id) { console.error("quay gate-log: missing required <task-id> argument"); process.exitCode = 1; return; }
    await withProvider(async (client, cfg) => {
      const events = runGateLogQuery(cfg.workspaceRoot, {
        pipelineId: id,
        gate: vf.gate,
        file: vf.file,
      });
      if (vf.json) printJson(events);
      else events.forEach((e) => console.log(`${e.timestamp} ${e.gate} ${e.verdict}`));
    }, { providerId: vf.provider, root: vf.root });
    return;
  }

  // QENG-3: complete/adjudicate/promote/retreat lifecycle. Verb-less top-level
  // commands (id lands in `sub`), each mirroring the `gate` branch: withProvider
  // resolves the client + cfg; logPath via resolveGateLogPath; each run* fn sets
  // its own process.exitCode. QUAY_ACCEPTANCE_CWD is pinned before commands that
  // may run the acceptance gate (complete, and promote's ready→done delegate).
  if (cmd === "complete") {
    const { flags: vf, id } = parseVerbless(sub, rest);
    if (!id) { console.error("quay complete: missing required <task-id> argument"); process.exitCode = 1; return; }
    await withProvider(async (client, cfg, provider) => {
      const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: vf.file });
      // DIR-046-A: `--cwd`/`--timeout` (or a pre-set env var) win over the
      // workspaceRoot pin — see pinAcceptanceEnv's own doc comment.
      pinAcceptanceEnv({ workspaceRoot: cfg.workspaceRoot, cwd: vf.cwd, timeout: vf.timeout, envFile: resolveAcceptanceEnvFile(cfg, provider) });
      // M56-gate-cli-error-ux (AC1): missing-task is a guarded error.
      await withGuardedErrors(async () => {
        await runComplete({ client, id, logPath, workspaceRoot: cfg.workspaceRoot });
      });
    }, { providerId: vf.provider, root: vf.root });
    return;
  }

  if (cmd === "adjudicate") {
    const { flags: vf, id } = parseVerbless(sub, rest);
    if (!id) { console.error("quay adjudicate: missing required <task-id> argument"); process.exitCode = 1; return; }
    await withProvider(async (client, cfg) => {
      const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: vf.file });
      // M56-gate-cli-error-ux (AC1): missing-task is a guarded error.
      await withGuardedErrors(async () => {
        await runAdjudicate({ client, id, logPath });
      });
    }, { providerId: vf.provider, root: vf.root });
    return;
  }

  if (cmd === "promote") {
    const { flags: vf, id } = parseVerbless(sub, rest);
    if (!id) { console.error("quay promote: missing required <task-id> argument"); process.exitCode = 1; return; }
    await withProvider(async (client, cfg, provider) => {
      const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: vf.file });
      // DIR-046-A: `--cwd`/`--timeout` (or a pre-set env var) win over the
      // workspaceRoot pin — see pinAcceptanceEnv's own doc comment.
      pinAcceptanceEnv({ workspaceRoot: cfg.workspaceRoot, cwd: vf.cwd, timeout: vf.timeout, envFile: resolveAcceptanceEnvFile(cfg, provider) });
      // M56-gate-cli-error-ux (AC1): missing-task / illegal-transition are
      // guarded errors — assertTransition() throws `illegal transition: ...`.
      await withGuardedErrors(async () => {
        await runPromote({ client, id, logPath, workspaceRoot: cfg.workspaceRoot });
      });
    }, { providerId: vf.provider, root: vf.root });
    return;
  }

  if (cmd === "retreat") {
    const { flags: vf, id } = parseVerbless(sub, rest);
    if (!id) { console.error("quay retreat: missing required <task-id> argument"); process.exitCode = 1; return; }
    await withProvider(async (client, cfg) => {
      const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: vf.file });
      // M56-gate-cli-error-ux (AC1): missing-task / illegal-transition are
      // guarded errors — assertTransition() throws `illegal transition: ...`.
      await withGuardedErrors(async () => {
        await runRetreat({ client, id, reason: vf.reason, logPath });
      });
    }, { providerId: vf.provider, root: vf.root });
    return;
  }

  // QENG-4: `quay run` driver — the autonomous loop AS CODE (capstone composing
  // QENG-1/2/3). NO positional id: `run` scans the board itself. Mirrors the
  // `complete` branch's plumbing (withProvider → resolveGateLogPath →
  // QUAY_ACCEPTANCE_CWD pins the acceptance runner's cwd, QENG-2).
  //   --once → one deterministic observation (lowest actionable id), exit 0
  //            ALWAYS — a meter fail leaves the task `ready` + records a
  //            GateEvent, a successful driver OBSERVATION, not a driver error.
  //            runComplete sets process.exitCode=1 on a meter fail, so the
  //            --once branch MUST reset it to 0 (see below).
  //   (loop) → bounded scan→complete loop; exit 0 on fixpoint/sentinel; only the
  //            runaway-cap safety ceiling maps to exit 1.
  if (cmd === "run") {
    // `run` takes NO positional id (it scans the board itself), so any flag
    // lands in `sub` (e.g. `quay run --once` → sub="--once", rest=[]). Re-parse
    // from [sub, ...rest] so `--once`/`--file`/`--provider` are all seen.
    const { flags: runFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));
    await withProvider(async (client, cfg, provider) => {
      const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: runFlags.file });
      // DIR-046-A: `--cwd`/`--timeout` (or a pre-set env var) win over the
      // workspaceRoot pin — see pinAcceptanceEnv's own doc comment.
      pinAcceptanceEnv({ workspaceRoot: cfg.workspaceRoot, cwd: runFlags.cwd, timeout: runFlags.timeout, envFile: resolveAcceptanceEnvFile(cfg, provider) });
      if (runFlags.once) {
        const r = await runOnce({ client, logPath });
        if (!r.processed) console.log("nothing to do");
        else console.log(`${r.processed}: ${r.ok ? "PASS — done" : `FAIL — ${r.reason} (left ready)`}`);
        // CRITICAL (proposal review note 3): runComplete sets process.exitCode=1
        // on a meter fail. AC1 requires `quay run --once` to exit 0 — the
        // contract is "one observation made, exit 0", distinct from `complete`'s
        // "this task passed/failed" exit code. Reset AFTER runOnce returns.
        process.exitCode = 0;
      } else {
        const r = await runLoop({ client, cfg, logPath });
        console.log(`run: ${r.completed.length} completed in ${r.iterations} iters (stop=${r.stopped})`);
        // AC2 (M56-gate-cli-error-ux): a `fixpoint`/`sentinel` stop exits 0
        // regardless of whether any individual task failed its acceptance gate
        // along the way (runComplete unconditionally sets process.exitCode=1 on
        // a per-task meter fail, inside runLoop — there is no equivalent reset
        // for the non-`--once` branch, unlike `--once` above). Only the runaway
        // safety `cap` ceiling is a real driver-level failure and maps to exit 1.
        process.exitCode = r.stopped === "cap" ? 1 : 0;
      }
    }, { providerId: runFlags.provider, root: runFlags.root });
    return;
  }

  // DIR-039 (A): `quay migrate --from <providerId> --to <providerId>` — the
  // generic ABI provider-to-provider migration command. No positional task
  // id (mirrors `run`'s own shape: it acts over the WHOLE board, not one
  // task), so any flag lands in `sub` exactly like `run` — re-parse from
  // [sub, ...rest].
  if (cmd === "migrate") {
    const { flags: mf } = parseFlags([sub, ...rest].filter((a) => a !== undefined));
    if (typeof mf.from !== "string" || mf.from.trim() === "") {
      console.error("quay migrate: --from <providerId> is required");
      process.exitCode = 1;
      return;
    }
    if (typeof mf.to !== "string" || mf.to.trim() === "") {
      console.error("quay migrate: --to <providerId> is required");
      process.exitCode = 1;
      return;
    }
    if (mf.from === mf.to) {
      console.error("quay migrate: --from and --to must name different providers");
      process.exitCode = 1;
      return;
    }
    // gap-task-list-root-does-not-scope-config-lookup: honor `--root` the same
    // way every workspace-scoped command does (start config discovery at
    // <path>, walk-up, fail-closed when no config).
    if (mf.root !== undefined && typeof mf.root !== "string") {
      console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
      process.exitCode = 1;
      return;
    }
    let cfg;
    try {
      cfg = mf.root ? loadConfig(resolveWorkspaceRootOrThrow(mf.root)) : loadConfig();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    const { client: source } = await connectNamedProvider(cfg, mf.from);
    try {
      const { client: target } = await connectNamedProvider(cfg, mf.to);
      try {
        const result = await migrateTasks({
          source,
          target,
          onTask: mf.json ? undefined : (t) => console.log(`migrated ${t.id}: ${t.title}`),
        });
        if (mf.json) {
          printJson(result);
        } else {
          console.log(
            `migrate --from ${mf.from} --to ${mf.to}: ${result.migrated.length}/${result.total} tasks migrated` +
              (result.errors.length ? `, ${result.errors.length} error(s)` : "")
          );
          for (const e of result.errors) console.error(`  error: ${e.id ?? "(no id)"}: ${e.error}`);
        }
        process.exitCode = result.errors.length > 0 ? 1 : 0;
      } finally {
        await target.close();
      }
    } finally {
      await source.close();
    }
    return;
  }

  // ── manager commands (C1-C5, gap-manager-productization-five-constraints) ─────────────────────────
  // `quay manager start` / `quay manager adopt <root>`. The manager is a plugin-layer product
  // component: the CLI locates the plugin scripts (plugin/scripts/manager-*.sh) relative to this
  // package's own root (the plugin ships under the repo root's plugin/ dir, and the npm pack's
  // `files` includes `plugin`). Dispatches to the plugin scripts — the manager implementation lives
  // in plugin/, not in Core (build ownership = outer/inner; SPEC-manager-productization §3).
  if (cmd === "manager") {
    const { flags: mgrFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

    if (sub === "--help" || sub === "-h" || mgrFlags.help) {
      process.stdout.write(`quay manager — start/adopt the manager layer (C4/C5)

Usage:
  quay manager start                 Start the manager independently (no project args; C5)
  quay manager adopt <root>          Adopt a project (three-state: healthy/empty-shell/missing)
  quay manager arm                   (re)arm the manager loop anchor (sentinel-idempotent; AC5/AC5c)

Flags:
  --dry-run            Print the plan without changing anything (start/adopt/arm)
  --json               Machine-readable output
  --check-idle-watch   (start) verify the manager's idle-watch is mounted+delivering (AC3)
  --verify             (arm) externally verify the loop-registry carries a fresh CronCreate receipt (AC4)

The manager is CROSS-PROJECT (SPEC-manager-productization C2): its session (quay-manager), home
(\$QUAY_GLOBAL_DIR/manager/) and loop anchor belong to no single project. 'start' and 'adopt' are
separate commands on purpose (C5: two commands, not one parameterised command).
`);
      return;
    }

    // Locate the plugin scripts dir. Walk upward from this file looking for a dir that contains
    // manager-start.sh — works in the dev tree (repo-root/plugin/scripts), the npm-pack root
    // (plugin/ shipped under the pack root), and the vendored plugin bundle (plugin/scripts at the
    // plugin root). Env override for hermetic tests.
    const scriptsDir = (() => {
      if (process.env.QUAY_MANAGER_SCRIPTS_DIR) return process.env.QUAY_MANAGER_SCRIPTS_DIR;
      let dir = path.dirname(fileURLToPath(import.meta.url));
      for (let i = 0; i < 6; i++) {
        for (const rel of [path.join("plugin", "scripts"), "scripts"]) {
          const cand = path.join(dir, rel);
          if (fsSyncExists(path.join(cand, "manager-start.sh"))) return cand;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return path.resolve(dir, "plugin", "scripts");
    })();
    const managerStart = path.join(scriptsDir, "manager-start.sh");
    const managerAdopt = path.join(scriptsDir, "manager-adopt.sh");
    const managerArm = path.join(scriptsDir, "manager-arm-loop.sh");

    const runManagerScript = (script, args) => {
      const r = spawnSync("bash", [script, ...args], { encoding: "utf8" });
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      return r.status;
    };

    if (sub === "start") {
      // C5: start 与 adopt 分开——`quay manager start` 不接受任何项目参数。CLI 层即拒绝，
      // 不把多余位置参数静默吞掉（脚本层也拒绝，双层防漏）。
      if (positional.length > 0) {
        console.error(`quay manager start: accepts NO project args (C5: 'start' ≠ 'adopt <root>') — unexpected: ${positional.join(" ")}`);
        process.exitCode = 1;
        return;
      }
      const args = [];
      if (mgrFlags["dry-run"]) args.push("--dry-run");
      if (mgrFlags.json) args.push("--json");
      if (mgrFlags["check-idle-watch"]) args.push("--check-idle-watch");
      process.exitCode = runManagerScript(managerStart, args) ?? 1;
      return;
    }
    if (sub === "adopt") {
      const root = positional[0];
      if (!root) {
        console.error("quay manager adopt: missing required <root> (the project root to adopt)");
        process.exitCode = 1;
        return;
      }
      const args = [root];
      if (mgrFlags["dry-run"]) args.push("--dry-run");
      if (mgrFlags.json) args.push("--json");
      process.exitCode = runManagerScript(managerAdopt, args) ?? 1;
      return;
    }
    if (sub === "arm") {
      const args = [];
      if (mgrFlags["dry-run"]) args.push("--dry-run");
      if (mgrFlags.json) args.push("--json");
      if (mgrFlags.verify) args.push("--verify");
      process.exitCode = runManagerScript(managerArm, args) ?? 1;
      return;
    }
    console.error(`unknown manager subcommand: ${sub} (try: start, adopt <root>, arm)`);
    process.exitCode = 1;
    return;
  }

  // QX-005: updated fallback with --help hint (UQ-001/UQ-002).
  console.error("usage: quay <init|task list|view|create|edit|check|gate|gate-log|complete|adjudicate|promote|retreat|run|migrate|config validate|action list|serve|mcp|manager start|manager adopt> ...\nRun `quay --help` for full usage documentation.");
  process.exitCode = 1;
    }
}

// ── thin shell (gap-cli-import-refactor-run-shell-architecture) ──
// argv → run() → exit/write. run() already writes to the real process streams
// in shell mode (no ctx.capture) and returns the exit code; the shell maps that
// onto process.exitCode and handles a top-level rejection the same way the old
// `main().catch()` did (a thrown error that run() itself did not absorb — run()
// catches command errors and returns { code: 1 }, so this catch is only reached
// for errors thrown OUTSIDE run()'s dispatch, i.e. wrapper-setup failures).
//
// Entrypoint-guarded (ESM): this shell must run ONLY when this file is the
// main module. When a test imports run() from this file, the module still
// executes top-to-bottom, and an UNGUARDED shell would fire `run([])` with the
// test's own process.argv — its async finally would later restore
// process.stdout.write/process.stderr.write and clobber the capture patch the
// test's run(ctx.capture) installed mid-dispatch (the module-load run stays
// pending until the test's first await, then its finally reverts the write
// patch, so command output leaks to the real process streams instead of the
// capture buffer). The import.meta.url === process.argv[1] check is the
// standard ESM main-module test and is byte-identical under the esbuild dist
// bundle (import.meta.url is rewritten to the bundle's own file:// URL).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((res) => {
    if (typeof res.code === "number") process.exitCode = res.code;
  }).catch((err) => {
    console.error(err.stack || String(err));
    process.exitCode = 1;
  });
}
