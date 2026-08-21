#!/usr/bin/env node
// @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
// quay — the Core CLI (glossary.md). Provider-agnostic, MCP client, sibling
// to the Web UI (proposal §9): `serve` / `task` / `action`.
//
// gap-cli-import-command-migration-into-src: this file is now a THIN shell.
// The command handlers that used to live in the run() dispatch body were
// migrated verbatim into packages/quay/src/cli/<command>.ts (import-callable,
// zero process derivation); the shared helpers they use live in
// packages/quay/src/cli/shared.ts. This file keeps only:
//   - run(argv, ctx) — the import-callable Core CLI (the shell contract:
//     argv → run() → { code, stdout, stderr })
//   - the pre-dispatch plumbing (--version/--help/--format-json normalization)
//   - the dispatch skeleton that routes each verb to its src/cli handler
//   - the thin argv → run() → exit shell at the bottom
//   - re-exports of the six pure helpers so existing tests keep importing them
//     from ../bin/quay.ts (parseFlags/parseVerbless/resolveJsonFlag/
//     resolvePageSize/relativeTimeCli/stripHeadings)

import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { QUAY_VERSION } from "../src/version.ts";
// gap-reduce-sync-spawn-floor-suite-slowdown: parseFlags/resolveJsonFlag come
// from the LIGHT ./cli/flags.ts (NOT ./cli/shared.ts), so the eager pre-dispatch
// plumbing no longer drags in the provider machinery (config/provider-client/
// provider-env/gate-config-loader) that cli/shared.ts imports — the per-spawn
// floor for `--version`/`--help` and every verb drops with it.
import { parseFlags, resolveJsonFlag } from "../src/cli/flags.ts";
import { printHelp } from "../src/cli/help.ts";
// Pure-helper re-exports — cli.test.mjs block27 import-calls these from
// ../bin/quay.ts (zero-coverage pure-helper tests, AC2). Re-exported from
// flags.ts (the light module) so the re-export never pulls the provider graph.
export { parseFlags, resolveJsonFlag, parseVerbless, resolvePageSize, relativeTimeCli, stripHeadings } from "../src/cli/flags.ts";

// gap-reduce-sync-spawn-floor-suite-slowdown: the command handlers are now
// loaded LAZILY (dynamic import at dispatch) instead of eagerly at module load.
// The CLI is spawned ~200+ times per suite and its per-spawn floor was dominated
// by loading the WHOLE handler graph (gate engine, MCP server, serve machinery,
// provider clients) even for `--version` / `--help` / a bare `task list`. Each
// handler module is still import-callable directly (zero process derivation) and
// the dispatch behavior is byte-identical — only WHEN the module graph loads
// changed (deferred to first use of each verb). esbuild bundles the dynamic
// imports into the same single dist/quay.js file and evaluates each module
// lazily on first import, so the prebuilt bundle's per-spawn floor drops too.

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
// former main() body — no command behavior was rewritten during import-ification
// nor during the command-handler migration (gap-cli-import-command-migration-into-src:
// each verb's handler moved VERBATIM into src/cli/<command>.ts), so shell mode
// (run(argv) with no ctx) and capture mode (run(argv, { capture: true }))
// execute the exact same code path. Equivalence is verified by the golden-replay
// blocks in packages/quay/test/cli.test.mjs (spawn vs run() byte-compare).
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

  // ── the command dispatch (former main() body) ──
  // Pre-dispatch plumbing + verb routing to the src/cli handlers. Each handler
  // receives the per-invocation context (argv/sub/rest/flags/positional/
  // wantsJson) and imports its own helpers from src/cli/shared.ts.
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

  // ── per-invocation context handed to every handler ──
  const ctx = { argv, sub, rest, flags, positional, wantsJson };

  // ── verb routing → src/cli/<command>.ts handlers ──
  // gap-reduce-sync-spawn-floor-suite-slowdown: each handler is now loaded via
  // dynamic import AT DISPATCH (deferred), so an invocation of one verb never
  // loads the handler modules of the other 20 verbs (the old per-spawn floor).
  // Behavior is unchanged — same module, same ctx, same return value.
  if (cmd === "adr") return (await import("../src/cli/adr.ts")).handleAdr(ctx);
  if (cmd === "task" && sub === "list") return (await import("../src/cli/task-list.ts")).handleTaskList(ctx);
  if (cmd === "task" && sub === "view") return (await import("../src/cli/task-view.ts")).handleTaskView(ctx);
  if (cmd === "task" && sub === "create") return (await import("../src/cli/task-create.ts")).handleTaskCreate(ctx);
  if (cmd === "task" && sub === "edit") return (await import("../src/cli/task-edit.ts")).handleTaskEdit(ctx);
  if (cmd === "task" && sub === "check") return (await import("../src/cli/task-check.ts")).handleTaskCheck(ctx);
  if (cmd === "action" && sub === "list") return (await import("../src/cli/action.ts")).handleActionList(ctx);
  if (cmd === "action" && sub === "run") return (await import("../src/cli/action.ts")).handleActionRun(ctx);
  if (cmd === "serve") return (await import("../src/cli/serve.ts")).handleServe(ctx);
  if (cmd === "mcp") return (await import("../src/cli/mcp.ts")).handleMcp(ctx);
  if (cmd === "init") return (await import("../src/cli/init.ts")).handleInit(ctx);
  // DIR-099-A: config validate/check + unknown config subcommand both route here.
  if (cmd === "config") return (await import("../src/cli/config.ts")).handleConfigValidate(ctx);
  // QENG-1: gate (verb-less: id in `sub`; `--list` detected as sub === "--list").
  if (cmd === "gate") return (await import("../src/cli/gate.ts")).handleGate(ctx);
  if (cmd === "gate-log") return (await import("../src/cli/gate-log.ts")).handleGateLog(ctx);
  // QENG-3: complete/adjudicate/promote/retreat lifecycle (verb-less, id in `sub`).
  if (cmd === "complete") return (await import("../src/cli/lifecycle.ts")).handleComplete(ctx);
  if (cmd === "adjudicate") return (await import("../src/cli/lifecycle.ts")).handleAdjudicate(ctx);
  if (cmd === "promote") return (await import("../src/cli/lifecycle.ts")).handlePromote(ctx);
  if (cmd === "retreat") return (await import("../src/cli/lifecycle.ts")).handleRetreat(ctx);
  // QENG-4: `quay run` driver (verb-less, no positional id).
  if (cmd === "run") return (await import("../src/cli/run.ts")).handleRun(ctx);
  // DIR-039: `quay migrate --from <id> --to <id>`.
  if (cmd === "migrate") return (await import("../src/cli/migrate.ts")).handleMigrate(ctx);
  // Manager commands (C1-C5): start/adopt/arm.
  if (cmd === "manager") return (await import("../src/cli/manager.ts")).handleManager(ctx);

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
// capture buffer). The check must fire in BOTH module systems the CLI ships as:
//   - ESM (source via --experimental-strip-types, and the ESM dist/quay.js
//     npm-pack bundle): import.meta.url is the real module URL, so the
//     import.meta.url === pathToFileURL(process.argv[1]).href test applies.
//   - CJS (the SEA build's dist-sea/quay-bundle.cjs, format:cjs): esbuild
//     rewrites `import.meta` to an EMPTY OBJECT (import.meta.url === undefined),
//     so the import.meta.url test is ALWAYS FALSE there and the standard CJS
//     main-module test (require.main === module) must fire instead.
//     gap-sea-verify-node-free-fails-050: without the require.main branch, the
//     SEA binary's CLI shell never ran and every command (--help/--version/
//     serve) exited 0 silently — sea-verify-node-free's serve+curl step failed
//     not from a missing embedded runtime but because the bundled CLI never
//     executed. `typeof require !== "undefined"` guards the ESM case where
//     referencing require.main would throw ReferenceError, and
//     `typeof module !== "undefined"` guards the ESM bundle (dist/quay.js,
//     where esbuild aliases require to a createRequire-injected __require but
//     `module` does not exist at ESM scope).
// gap-quay-entry-guard-symlink-broken: the ESM main-module check must survive
// the npm-installed symlink topology. Under `npm install -g`, bin/quay is a
// symlink (node_modules/.bin/quay -> ../quay/dist/quay.js): import.meta.url
// resolves to the REAL file the symlink points at, while process.argv[1] keeps
// the symlink path itself, so a plain string compare is ALWAYS false and run()
// never fired (empty `quay --version`, EXIT=0 — v0.6.0 was fully broken for
// npm global installs). Canonicalize argv[1] with fs.realpathSync so both sides
// are the same real path (realpath of a non-symlink is the path itself, so this
// also covers the plain source/bundle case). import.meta.main would be cleaner
// but needs Node >=24.2 — the npm-pack dist must run on the Node-20 floor, so no.
const isMain =
  process.argv[1] &&
  ((typeof require !== "undefined" &&
    typeof module !== "undefined" &&
    require.main === module) ||
    (typeof import.meta !== "undefined" &&
      import.meta.url !== undefined &&
      (import.meta.url === pathToFileURL(process.argv[1]).href ||
        (() => {
          try {
            return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
          } catch {
            return false; // argv[1] not resolvable — fall back to the literal-path compare above
          }
        })())));
if (isMain) {
  run(process.argv.slice(2)).then((res) => {
    if (typeof res.code === "number") process.exitCode = res.code;
  }).catch((err) => {
    console.error(err.stack || String(err));
    process.exitCode = 1;
  });
}
