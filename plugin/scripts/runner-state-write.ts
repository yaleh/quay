// runner-state-write.ts — the suite-state WRITE family, extracted from full-suite-runner.ts
// (gap-ac128-hub-split-harness-concerns).
//
// WHY A SEPARATE FILE: full-suite-runner.ts is a HUB file (any change forces the full suite). The
// state-write family (readStateRunId / writeStateGuarded / writeState / appendVerificationRound) is
// HARNESS-CRITICAL — it owns the generation-guarded state write + the verification-round ledger — so
// this file is ALSO a hub (listed in suite-bucket-hub-list.ts HUB_FILES). Extracting it out of the
// monolith shrinks that monolith WITHOUT weakening the hub rule (a change here still forces the full
// suite).
//
// Moved verbatim from full-suite-runner.ts. `writeState` (the private guarded-write helper) gains
// `export` HERE so full-suite-runner.ts can import it for its internal `run()` calls — it is NOT
// re-exported from full-suite-runner.ts, so the runner's public API surface is unchanged (writeState
// stays module-private to the full-suite-runner boundary). readStateRunId / writeStateGuarded /
// appendVerificationRound are re-exported from full-suite-runner.ts (unchanged public API).

import fs from "node:fs";
import path from "node:path";
// gap-arch-import-cycles-zero — these types are DEFINED in full-suite-runner.ts, which VALUE-imports
// this module: importing them from there made this a type-level import cycle. They now live in the
// leaf module full-suite-runner-types.ts (full-suite-runner.ts re-exports them, so nothing else moves).
import type { SuiteState, SuiteRoundRecord } from "./full-suite-runner-types.ts";
import { writeJsonAtomic } from "./write-json-atomic.ts";

/**
 * Read the runId (generation token) currently on disk at `file`, or undefined when absent /
 * unparseable (legacy state, missing file, or a concurrent mid-write). A legacy/missing file has
 * no generation to protect, so the caller treats undefined as "no guard active" (fail-open).
 */
export function readStateRunId(file: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed?.runId === "string" && parsed.runId ? parsed.runId : undefined;
  } catch {
    return undefined;
  }
}
/**
 * GENERATION GUARD — write `state` to `file`, but when `opts.guard` is set the write is REFUSED
 * (silently dropped) if a DIFFERENT run currently owns the file. Without the guard every write was
 * last-write-wins: if two runners overlap briefly (even a superseded runner still finishing its
 * cleanup), the older runner's red terminal state could land AFTER the newer runner's `running`
 * write and silently clobber it — no mechanism could distinguish "is this red from the current
 * round" (gap-full-suite-state-race-last-write-wins-no-generation-guard). Guard semantics:
 *   - the run's INITIAL `running` write is UNGUARDED (opts.establish in run()) — it establishes
 *     the generation; a newer run taking over MUST be able to overwrite an older run's state.
 *   - every later write (in-progress red, terminal green/red, signal abort) is GUARDED — it only
 *     succeeds while the writer is still the current generation.
 *   - a state without runId, or an unreadable/legacy on-disk file, never blocks a write (fail-open).
 */
export function writeStateGuarded(file: string, state: SuiteState): void {
  writeState(file, state, { guard: true });
}

export function writeState(file: string, state: SuiteState, opts?: { guard?: boolean }): void {
  if (opts?.guard && state.runId) {
    const current = readStateRunId(file);
    if (current !== undefined && current !== state.runId) {
      // A NEWER run owns the file — this writer is stale; its write would clobber the current
      // round's state. Drop it (the current runner's state stays authoritative).
      return;
    }
  }
  writeJsonAtomic(file, state);
}
/**
 * Append one suite-round record to <stateDir>/verification-round.jsonl (round = prior lines + 1).
 * `stateDir` is the .quay STATE directory — the state/log/ledger write location, decoupled from the
 * TESTED CHECKOUT by --state-dir (gap-suite-state-split-across-worktree-and-gate). Pre-split callers
 * passed a workspace root; the equivalent stateDir is `<root>/.quay`.
 */
export function appendVerificationRound(stateDir: string, rec: SuiteRoundRecord): void {
  try {
    const file = path.join(stateDir, "verification-round.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let prior = 0;
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8");
      for (const l of text.split("\n")) if (l.trim()) prior++;
    }
    fs.appendFileSync(file, JSON.stringify({ ...rec, round: rec.round > 0 ? rec.round : prior + 1 }) + "\n", "utf8");
  } catch {
    // best-effort — never let the ledger fail the run
  }
}
