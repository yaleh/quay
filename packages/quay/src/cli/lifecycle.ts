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
      await runComplete({ client, id, logPath, workspaceRoot: cfg.workspaceRoot });
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
      await runPromote({ client, id, logPath, workspaceRoot: cfg.workspaceRoot });
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
      await runRetreat({ client, id, reason: vf.reason, logPath });
    });
  }, { providerId: vf.provider, root: vf.root });
  return;
}
