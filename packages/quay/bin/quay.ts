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

import { fileURLToPath, pathToFileURL } from "node:url";
import { QUAY_VERSION } from "../src/version.ts";
import { parseFlags, resolveJsonFlag } from "../src/cli/shared.ts";
import { printHelp } from "../src/cli/help.ts";
// Command handlers — one module per verb family, migrated verbatim from this
// dispatch body (each is import-callable directly, zero process derivation).
import { handleAdr } from "../src/cli/adr.ts";
import { handleTaskList } from "../src/cli/task-list.ts";
import { handleTaskView } from "../src/cli/task-view.ts";
import { handleTaskCreate } from "../src/cli/task-create.ts";
import { handleTaskEdit } from "../src/cli/task-edit.ts";
import { handleTaskCheck } from "../src/cli/task-check.ts";
import { handleActionList, handleActionRun } from "../src/cli/action.ts";
import { handleServe } from "../src/cli/serve.ts";
import { handleMcp } from "../src/cli/mcp.ts";
import { handleInit } from "../src/cli/init.ts";
import { handleConfigValidate } from "../src/cli/config.ts";
import { handleGate } from "../src/cli/gate.ts";
import { handleGateLog } from "../src/cli/gate-log.ts";
import {
  handleComplete,
  handleAdjudicate,
  handlePromote,
  handleRetreat,
} from "../src/cli/lifecycle.ts";
import { handleRun } from "../src/cli/run.ts";
import { handleMigrate } from "../src/cli/migrate.ts";
import { handleManager } from "../src/cli/manager.ts";
// Pure-helper re-exports — cli.test.mjs block27 import-calls these from
// ../bin/quay.ts (zero-coverage pure-helper tests, AC2).
export { parseFlags, resolveJsonFlag, parseVerbless, resolvePageSize, relativeTimeCli, stripHeadings } from "../src/cli/shared.ts";

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
  if (cmd === "adr") return handleAdr(ctx);
  if (cmd === "task" && sub === "list") return handleTaskList(ctx);
  if (cmd === "task" && sub === "view") return handleTaskView(ctx);
  if (cmd === "task" && sub === "create") return handleTaskCreate(ctx);
  if (cmd === "task" && sub === "edit") return handleTaskEdit(ctx);
  if (cmd === "task" && sub === "check") return handleTaskCheck(ctx);
  if (cmd === "action" && sub === "list") return handleActionList(ctx);
  if (cmd === "action" && sub === "run") return handleActionRun(ctx);
  if (cmd === "serve") return handleServe(ctx);
  if (cmd === "mcp") return handleMcp(ctx);
  if (cmd === "init") return handleInit(ctx);
  // DIR-099-A: config validate/check + unknown config subcommand both route here.
  if (cmd === "config") return handleConfigValidate(ctx);
  // QENG-1: gate (verb-less: id in `sub`; `--list` detected as sub === "--list").
  if (cmd === "gate") return handleGate(ctx);
  if (cmd === "gate-log") return handleGateLog(ctx);
  // QENG-3: complete/adjudicate/promote/retreat lifecycle (verb-less, id in `sub`).
  if (cmd === "complete") return handleComplete(ctx);
  if (cmd === "adjudicate") return handleAdjudicate(ctx);
  if (cmd === "promote") return handlePromote(ctx);
  if (cmd === "retreat") return handleRetreat(ctx);
  // QENG-4: `quay run` driver (verb-less, no positional id).
  if (cmd === "run") return handleRun(ctx);
  // DIR-039: `quay migrate --from <id> --to <id>`.
  if (cmd === "migrate") return handleMigrate(ctx);
  // Manager commands (C1-C5): start/adopt/arm.
  if (cmd === "manager") return handleManager(ctx);

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
