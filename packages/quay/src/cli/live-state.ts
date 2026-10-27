// cli/live-state.ts — the `quay live-state` verb (task
// gap-live-state-small-carrier-for-subsecond-inflight-read, first shipped in 0.23.0).
//
// WHY THIS EXISTS: "what is running right now" used to be reachable only through a reader that
// spawns a process and imports the whole module graph (`quay driver live`, `readLive`) or through
// carriers that are either phase-less (`.quay/worker-dispatch.json`) or huge and slow to write
// (`.quay/worker-round.jsonl`, measured 90–124 MB at a 50–60 s cadence). An external read-only
// consumer — claudecodeui's workspace title bar — needs a snapshot it can obtain by reading ONE
// small file, so the worker driver maintains `.quay/live-state.json` event-driven and this verb is
// the thin exit over the ONE reader (`observation.readLiveState`). ⛔ No second parse, no second
// phase derivation, no process spawn, no task-store walk: this file only formats the reading.
//
// ⛔ 3b（读不懂 ≠ 合格）: the reader returns FOUR distinct states — `ok` / `stale` / `missing` /
// `unreadable` — and this verb prints them verbatim. ⛔ "the file is not there" and "the snapshot is
// older than the staleness threshold" must never look like "zero in flight": the `inFlight` field is
// `null` for the not-evaluated states, and only `ok` with `[]` means a real empty reading.
//
// Exit codes: 0 = an evaluated reading (`ok` / `stale` / `missing` are all real readings — a
// workspace whose driver never ran genuinely has no snapshot); 1 = no workspace found, or the file
// exists but cannot be read/validated (`unreadable`). Always JSON, like `quay lanes` /
// `quay driver live`: it is a machine-facing read surface.

import { readLiveState, LIVE_STATE_STALE_MS, type LiveStateReading } from "../observation.ts";
import { resolveRoot } from "../driver-control.ts";
import type { CliCtx } from "./context.ts";

/**
 * The `quay live-state` body — a pure function of (flags, resolved root), the `runLanes` pattern.
 * Read-only: it never starts/stops/spawns anything and needs no serve process.
 *
 * `root` is null when no `.quay/config.yml` was found (reported, never guessed).
 */
export function runLiveState(
  flags: Record<string, any>,
  root: string | null,
): { stdout: string; reason: string | null; exitCode: number; reading: LiveStateReading | null } {
  if (!root) {
    return {
      stdout: "",
      reason: `quay live-state: no .quay/config.yml found (searched from ${flags.root ?? process.cwd()} upward). Run from a quay workspace root, or pass --root <workspace-root>.`,
      exitCode: 1,
      reading: null,
    };
  }
  // Optional --stale-ms: an explicit threshold for a consumer with a different heartbeat budget.
  // ⛔ It is NOT a way to launder a stale snapshot into `ok` (the value is printed either way).
  const staleMs = flags["stale-ms"] !== undefined ? Number(flags["stale-ms"]) : LIVE_STATE_STALE_MS;
  if (!Number.isFinite(staleMs) || staleMs < 0) {
    return {
      stdout: "",
      reason: `quay live-state: --stale-ms requires a non-negative number of milliseconds (got ${JSON.stringify(flags["stale-ms"])})`,
      exitCode: 1,
      reading: null,
    };
  }
  const reading = readLiveState(root, { staleMs });
  if (reading.status === "unreadable") {
    return {
      stdout: "",
      reason: `quay live-state: ${reading.reason}`,
      exitCode: 1,
      reading,
    };
  }
  return { stdout: JSON.stringify(reading, null, 2) + "\n", reason: null, exitCode: 0, reading };
}

export async function handleLiveState({ flags }: CliCtx) {
  const r = runLiveState(flags, resolveRoot(flags.root));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.reason) process.stderr.write(r.reason + "\n");
  process.exitCode = r.exitCode;
}
