// cli/shared.ts — shared helpers for the Core CLI command handlers.
//
// Migrated out of packages/quay/bin/quay.ts by
// gap-cli-import-command-migration-into-src: the run()/shell architecture
// (gap-cli-import-refactor-run-shell-architecture) left the command
// implementations in bin/quay.ts's dispatch body; this module is the shared
// helper layer both bin/quay.ts (the thin dispatch shell) and the per-command
// handler modules under src/cli/*.ts import from. Every function here is moved
// VERBATIM from bin/quay.ts — no behavior change during migration (golden-replay
// equivalence is verified per migrated command in packages/quay/test/cli.test.mjs).

import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { loadConfig, activeProvider } from "../config.ts";
// gap-task-list-root-does-not-scope-config-lookup: the fail-closed `--root`
// workspace-root resolver — the same findConfig mechanism loadConfig uses
// everywhere (config-validate, serve, mcp-server), so `--root <path>` on any
// workspace-scoped command resolves config the same way (AC4: no second
// semantics) and never silently falls back to process.cwd() (AC2).
import { resolveWorkspaceRootOrThrow } from "../gate/config/loader.ts";
import { connectProvider } from "../provider-client.ts";
import { resolveProviderEnv } from "../provider-env.ts";

// CliFlags — the dynamic flag bag produced by parseFlags/parseVerbless.
// Flag values are strings (--key value), booleans (a bare --key), or arrays of
// strings (repeated flags, e.g. --label A --label B). The object is keyed
// arbitrarily by whichever flags a command surface declares, so it is typed as
// a loose `any`-valued record — restoring the dynamic-shape behavior of the
// pre-migration bin/quay.ts dispatch (gap-cli-import-command-migration-into-src
// dropped the type; the handlers read verb-specific fields like gate/file/json/
// provider/root directly off it).
export type CliFlags = Record<string, any>;

export function fsSyncExists(p) {
  try { fsSync.accessSync(p); return true; } catch { return false; }
}

export function printJson(obj) {
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
export const GUARDED_ERROR_PATTERN = /^(unknown gate: |no such task: |illegal transition: )/;

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
export async function withGuardedErrors(fn) {
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
export function resolveJsonFlag(flags: CliFlags): { json: boolean } | null {
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
export function resolvePageSize(flags: CliFlags): { pageSize: number | null; error: string | null } {
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

export function parseFlags(argv: string[]): { flags: CliFlags; positional: string[] } {
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
export function parseVerbless(sub: string | undefined, rest: string[]): { flags: CliFlags; id: string | undefined } {
  const { flags, positional } = parseFlags([sub, ...rest].filter((a) => a !== undefined));
  return { flags, id: positional[0] };
}

// M16-cli-edit-parity-impl (design doc §1.3): read all of a readable stream
// (used for `--body-file -` / stdin) into a single string.
export async function readAll(stream) {
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
export async function resolveBody(flags) {
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
export function resolveAcceptanceEnvFile(cfg, provider) {
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
export function pinAcceptanceEnv({ workspaceRoot, cwd, timeout, envFile }) {
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

export async function withProvider(fn, { providerId, root }: { providerId?: string; root?: string } = {}) {
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
export async function connectNamedProvider(cfg, providerId) {
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
