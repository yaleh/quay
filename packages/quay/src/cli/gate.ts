// cli/gate.ts — `quay gate` / `quay gate --list` command handlers.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change (golden-replay
// equivalence verified in packages/quay/test/cli.test.mjs).

import { loadConfig } from "../config.ts";
import { resolveWorkspaceRootOrThrow } from "../gate/config/loader.ts";
import { runGate } from "../gate/engine.ts";
import { listGates, listGatesVerbose } from "../gate/registry.ts";
import { resolveGateLogPath } from "../gate/gate-log.ts";
import { runAcceptanceCapture } from "../gate/acceptance-runner.ts";
import { resolveRunnerOptions } from "../kernel/gate-run-options.ts";
import {
  parseFlags,
  parseVerbless,
  withProvider,
  printJson,
  pinAcceptanceEnv,
  resolveAcceptanceEnvFile,
  withGuardedErrors,
} from "./shared.ts";
import type { CliCtx } from "./context.ts";

// QENG-1: gate engine. `gate`/`gate-log` are verb-less top-level commands, so
// the task id lands in `sub` (not positional[0]), and `--list` is detected as
// `sub === "--list"` — parseFlags never runs on it, so `flags.list` is never
// set (proposal §"Architect review notes" #1).
export async function handleGate({ sub, rest, argv }: CliCtx) {
  if (sub === "--list") {
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

  // DIR-103-A (M223): normalize -n short flag to --dry-run before parsing.
  // parseFlags handles only --prefixed flags, so a raw -n would fall through
  // to positional and be misread as the task id.
  const gateSub = sub === "-n" ? "--dry-run" : sub;
  const gateRest = rest.map((a) => (a === "-n" ? "--dry-run" : a));
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
