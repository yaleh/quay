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
import { loadConfig, activeProvider, providerMcpEntry } from "../config.ts";
// gap-task-list-root-does-not-scope-config-lookup: the fail-closed `--root`
// workspace-root resolver — the same findConfig mechanism loadConfig uses
// everywhere (config-validate, serve, mcp-server), so `--root <path>` on any
// workspace-scoped command resolves config the same way (AC4: no second
// semantics) and never silently falls back to process.cwd() (AC2).
import { resolveWorkspaceRootOrThrow } from "../gate/config/loader.ts";
import { connectProvider } from "../provider-client.ts";
import { resolveProviderEnv } from "../provider-env.ts";

// gap-reduce-sync-spawn-floor-suite-slowdown: the LIGHT pure helpers (flag
// parsing, pure string/body helpers — node builtins only) moved to ./flags.ts
// so bin/quay.ts's eager dispatch plumbing no longer drags in the provider
// machinery above. Re-exported here so every existing importer of shared.ts
// keeps working unchanged.
export {
  parseFlags,
  parseVerbless,
  resolveJsonFlag,
  resolvePageSize,
  relativeTimeCli,
  stripHeadings,
  fsSyncExists,
  readAll,
  resolveBody,
} from "./flags.ts";
export type { CliFlags } from "./flags.ts";

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
  const [command, ...args] = providerMcpEntry(provider);
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
  const [command, ...args] = providerMcpEntry(provider);
  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    env: resolveProviderEnv(cfg, provider),
  });
  return { client, provider };
}
