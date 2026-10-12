// cli/lifecycle.ts — QENG-3 lifecycle command handlers (`complete` /
// `adjudicate` / `promote` / `retreat`).
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { resolveGateLogPath } from "../gate/gate-log.ts";
import { runComplete, runAdjudicate, runPromote, runRetreat } from "../gate/lifecycle.ts";
import {
  parseVerbless,
  withProvider,
  pinAcceptanceEnv,
  resolveAcceptanceEnvFile,
  withGuardedErrors,
} from "./shared.ts";
import type { CliCtx } from "./context.ts";

// QENG-3: complete/adjudicate/promote/retreat lifecycle. Verb-less top-level
// commands (id lands in `sub`), each mirroring the `gate` branch: withProvider
// resolves the client + cfg; logPath via resolveGateLogPath; each run* fn sets
// its own process.exitCode. QUAY_ACCEPTANCE_CWD is pinned before commands that
// may run the acceptance gate (complete, and promote's ready→done delegate).
//
// gap-task-status-events-abi-writes-and-creation: every flip these three verbs perform is stamped
// with its provenance — `actorKind:"cli"` (this IS the CLI surface) plus the caller's optional
// `--correlation-id`. The `actor.kind` term is NOT a flag: a caller must not be able to label its own
// write something it is not, so the surface declares itself. The correlation id IS a flag, because
// only the caller knows that two writes belong to one operation; omitted, the record carries no
// `cause.correlationId` at all rather than an empty one (hard rule 6).

/** The provenance pair every lifecycle verb stamps on its status write. */
function cliProvenance(vf: { "correlation-id"?: unknown }): { actorKind: string; correlationId?: string } {
  const correlationId = typeof vf["correlation-id"] === "string" ? vf["correlation-id"] : undefined;
  return { actorKind: "cli", ...(correlationId !== undefined ? { correlationId } : {}) };
}

export async function handleComplete({ sub, rest }: CliCtx) {
  const { flags: vf, id } = parseVerbless(sub, rest);
  if (!id) { console.error("quay complete: missing required <task-id> argument"); process.exitCode = 1; return; }
  await withProvider(async (client, cfg, provider) => {
    const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: vf.file });
    // DIR-046-A: `--cwd`/`--timeout` (or a pre-set env var) win over the
    // workspaceRoot pin — see pinAcceptanceEnv's own doc comment.
    pinAcceptanceEnv({ workspaceRoot: cfg.workspaceRoot, cwd: vf.cwd, timeout: vf.timeout, envFile: resolveAcceptanceEnvFile(cfg, provider) });
    // M56-gate-cli-error-ux (AC1): missing-task is a guarded error.
    await withGuardedErrors(async () => {
      await runComplete({ client, id, logPath, workspaceRoot: cfg.workspaceRoot, ...cliProvenance(vf) });
    });
  }, { providerId: vf.provider, root: vf.root });
  return;
}

export async function handleAdjudicate({ sub, rest }: CliCtx) {
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

export async function handlePromote({ sub, rest }: CliCtx) {
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
      await runPromote({ client, id, logPath, workspaceRoot: cfg.workspaceRoot, ...cliProvenance(vf) });
    });
  }, { providerId: vf.provider, root: vf.root });
  return;
}

export async function handleRetreat({ sub, rest }: CliCtx) {
  const { flags: vf, id } = parseVerbless(sub, rest);
  if (!id) { console.error("quay retreat: missing required <task-id> argument"); process.exitCode = 1; return; }
  await withProvider(async (client, cfg) => {
    const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: vf.file });
    // M56-gate-cli-error-ux (AC1): missing-task / illegal-transition are
    // guarded errors — assertTransition() throws `illegal transition: ...`.
    await withGuardedErrors(async () => {
      await runRetreat({ client, id, reason: vf.reason, logPath, ...cliProvenance(vf) });
    });
  }, { providerId: vf.provider, root: vf.root });
  return;
}
