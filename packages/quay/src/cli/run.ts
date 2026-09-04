// cli/run.ts — QENG-4 `quay run` driver command handler (autonomous loop AS CODE).
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { resolveGateLogPath } from "../gate/gate-log.ts";
import { runOnce, runLoop } from "../gate/driver.ts";
import {
  parseFlags,
  withProvider,
  pinAcceptanceEnv,
  resolveAcceptanceEnvFile,
} from "./shared.ts";
import type { CliCtx } from "./context.ts";

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
export async function handleRun({ sub, rest }: CliCtx) {
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
