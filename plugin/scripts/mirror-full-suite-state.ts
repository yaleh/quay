#!/usr/bin/env node
// mirror-full-suite-state.ts — mirror-write the terminal suite state for the fan-in detached suite.
// gap-full-suite-state-stale-no-writer AC1/AC3: fan-in-execute.js's detached-suite path (`setsid
// bash scripts/test.sh`) never goes through full-suite-runner.ts (the ONLY full-suite-state.json
// writer) ⇒ `<shared-checkout>/.quay/full-suite-state.json` goes stale ⇒ the /tests page reads a
// stale currentState AND collectFailureFiles carries a latent unbounded-union of a stale state's
// failures[]. This thin writer mirror-writes the terminal state (green — the only state the fan-in
// phase-2 path reaches) reflecting the fan-in's REAL suite round, reusing full-suite-runner.ts's
// mirrorStateFile pattern (write `<shared-checkout>/.quay/full-suite-state.json`; the CALLER resolves
// the shared main checkout — same resolution pre-verified-round-record.ts / per-task-suite-record.ts
// use — so a fan-in run inside a worktree still lands in the MAIN repo's state file consumers read).
//
// State shape (full-suite-runner SuiteState-compatible): state/runner/startedAt/finishedAt/
// durationMs/laneCount/scope/commit (+ optional taskId/runId/load/reason). `finishedAt` is EPOCH
// SECONDS (integer) — the same convention full-suite-runner writes (gap-batch-merge-gate-reads-stale-
// green: the freshness gate parses epoch); `startedAt` stays ISO 8601. load is best-effort (the
// /proc/loadavg 1min at the suite's end, already carried in the fan-in capture).
//
// Fail-closed (硬规则 3b): buildMirrorState returns `{error}` for a missing/invalid required field
// and the caller writes NOTHING — a partial or fabricated state is never written. NOT a
// verification-round writer: it OVERWRITES the single-state full-suite-state.json (the same
// single-state file full-suite-runner overwrites each round), never appends.
//
// ⛔ MODULE LIBRARY — no CLI entry (gap-mirror-full-suite-state-retire-dead-cli-face, 2026-09-18).
// The former `main(argv)` + `usage` + direct-entry guard were retired: their only caller was the
// deleted `# mirror-state-block` (fan-in-execute workflow step 4.5), so the CLI face was dead while
// the MODULE face was — and still is — live. The live caller is worker-driver.ts's mechanical fan-in:
// `mirrorMechanicalFanInSuiteState` (worker-driver.ts:5094) imports buildMirrorState / writeMirrorState
// / shouldSkipMirrorWrite / readCurrentState and owns the argv/env plumbing itself. Do NOT re-add a CLI
// entry here without a real caller — a registration that names a caller which does not exist is the
// exact defect this retirement removed (same shape as gap-mirror-measure-history-retire-dead-writer).
//
// The four exports are the interface:
//   buildMirrorState(o)            → {state} | {error}  (fail-closed; no IO)
//   writeMirrorState(file, state)  → atomic overwrite of the single-state file
//   readCurrentState(file)         → parsed state | null
//   shouldSkipMirrorWrite(cur)     → true when a non-terminal on-disk state owns the file

import { toIsoTimestamp } from "./per-task-suite-record.ts";
import { writeJsonAtomic } from "./write-json-atomic.ts";
// readJsonOrNull — the shared parse-or-null reader (was a byte-identical private copy here and in
// red-window-triage.ts; semantic-dedup-scan finding `read-current-state-duplicate`).
import { readJsonOrNull } from "./gate-script-base.ts";

const COMMIT_RE = /^[0-9a-f]{40}$/i;
const VALID_STATES = new Set(["green", "red"]);

/** EPOCH SECONDS from an ISO-8601 string (the same conversion full-suite-runner.toEpochSeconds uses
 *  for `finishedAt` — the freshness gate parses epoch). */
function toEpochSeconds(iso) {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Build the mirror state object. Returns {state} or {error} (fail-closed). */
export function buildMirrorState(o) {
  const state = String(o.state ?? "").trim();
  if (!VALID_STATES.has(state)) {
    return { error: `--state must be green|red (got ${JSON.stringify(o.state)})` };
  }
  const startedAt = toIsoTimestamp(o.startedAt);
  if (startedAt == null) {
    return { error: `--started-at must be an ISO/epoch timestamp (got ${JSON.stringify(o.startedAt)})` };
  }
  const durationMs = Number(o.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return { error: `--duration-ms must be a non-negative number (got ${JSON.stringify(o.durationMs)})` };
  }
  const laneCount = Number(o.laneCount);
  if (!Number.isFinite(laneCount) || laneCount < 0) {
    return { error: `--lane-count must be a non-negative number (got ${JSON.stringify(o.laneCount)})` };
  }
  const commit = o.commit ? String(o.commit).trim() : "";
  if (!COMMIT_RE.test(commit)) {
    return { error: `--commit must be a 40-hex commit sha (got ${JSON.stringify(o.commit)})` };
  }
  // finishedAt: explicit ISO/epoch, or derived (startedAt + durationMs) when absent — a terminal
  // mirror must always carry a non-null finishedAt (a null finishedAt reads as "still running" to
  // the early-RED detection in suite-state-trigger).
  let finishedAtIso;
  if (o.finishedAt != null && String(o.finishedAt).trim() !== "") {
    finishedAtIso = toIsoTimestamp(o.finishedAt);
    if (finishedAtIso == null) {
      return { error: `--finished-at must be an ISO/epoch timestamp (got ${JSON.stringify(o.finishedAt)})` };
    }
  } else {
    finishedAtIso = new Date(Date.parse(startedAt) + durationMs).toISOString();
  }
  let load;
  if (o.load != null) {
    const v = Number(o.load);
    if (!Number.isFinite(v) || v < 0) {
      return { error: `--load must be a non-negative number (got ${JSON.stringify(o.load)})` };
    }
    load = v;
  }
  const runner = o.runner != null ? String(o.runner).trim() : "inner";
  if (!runner) return { error: "--runner must be a non-empty string" };
  const scope = o.scope != null ? String(o.scope).trim() : "worktree";
  if (!scope) return { error: "--scope must be a non-empty string" };
  const reason = o.reason != null ? String(o.reason).trim() : "";
  if (state === "red" && !reason) return { error: "--reason is required when --state red" };

  const record = {
    state,
    runner,
    scope,
    startedAt,
    finishedAt: toEpochSeconds(finishedAtIso),
    durationMs,
    laneCount,
    commit,
  };
  if (load != null) record.load = load;
  if (o.taskId != null && String(o.taskId).trim()) record.taskId = String(o.taskId).trim();
  if (o.runId != null && String(o.runId).trim()) record.runId = String(o.runId).trim();
  if (reason) record.reason = reason;
  return { state: record };
}

/** Overwrite the single-state file atomically via writeJsonAtomic (tmp + renameSync). The
 *  consumers (the /tests page currentState, collectFailureFiles, suite-state-trigger) read a
 *  terminal state, but a concurrent reader now also never observes a torn mid-overwrite — the one
 *  write every state writer shares (tasks/gap-writestate-atomicity-split). */
export function writeMirrorState(file, state) {
  writeJsonAtomic(file, state);
}

/** Read the current on-disk state, or null when absent/unparseable (an unparseable state is treated
 *  as absent — overwriting garbage with a fresh terminal state is harmless). Kept as the public name
 *  its callers import (worker-fan-in.ts / worker-driver.ts / the test) — the body now delegates to
 *  the shared `readJsonOrNull` (semantic-dedup-scan finding `read-current-state-duplicate`). */
export function readCurrentState(file) {
  return readJsonOrNull(file);
}

/** gap-full-suite-state-stale-no-writer AC1 — should the mirror-write be SKIPPED to avoid clobbering
 *  an IN-FLIGHT round? full-suite-runner.ts (the outer auto-suite, spawned by suite-state-trigger's
 *  retrigger) still writes the SAME single-state file with a GENERATION GUARD: its `running` write
 *  establishes its runId, and every later terminal write is refused once a DIFFERENT runId owns the
 *  file. An UNGUARDED fan-in mirror-write landing mid-round would overwrite `running` (or an early-red)
 *  with a fan-in runId ⇒ the runner's terminal green/red write is then silently DROPPED (its guard
 *  reads a foreign runId). The guard: a non-terminal on-disk state (`finishedAt` null/undefined =
 *  running / early-red) is an in-flight round — SKIP (the runner's own terminal write will land and is
 *  authoritative). A terminal state (finishedAt set) or an absent state is safe to overwrite with the
 *  fan-in's newer completed green. Conservative: a stale `running` (crashed runner) also skips — that
 *  is the crash-watchdog's to convert, never this writer's to clobber. */
export function shouldSkipMirrorWrite(currentState) {
  if (!currentState) return false;
  return currentState.finishedAt == null;
}

// (no CLI entry — see the header. The caller builds the state file path itself:
//  worker-driver.ts's mechanical fan-in resolves <shared-checkout>/.quay/full-suite-state.json.)
