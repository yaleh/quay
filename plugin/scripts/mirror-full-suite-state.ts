#!/usr/bin/env node
// mirror-full-suite-state.ts — mirror-write the terminal suite state for the fan-in detached suite.
// gap-full-suite-state-stale-no-writer AC1/AC3: fan-in-execute.js's detached-suite path (`setsid
// bash scripts/test.sh`) never goes through full-suite-runner.ts (the ONLY full-suite-state.json
// writer) ⇒ `<shared-checkout>/.quay/full-suite-state.json` goes stale ⇒ the /tests page reads a
// stale currentState AND collectFailureFiles carries a latent unbounded-union of a stale state's
// failures[]. This thin writer mirror-writes the terminal state (green — the only state the fan-in
// phase-2 path reaches) reflecting the fan-in's REAL suite round, reusing full-suite-runner.ts's
// mirrorStateFile pattern (write `<root>/.quay/full-suite-state.json`) via resolveSharedCheckout
// (the shared main checkout — same resolution as pre-verified-round-record.ts / per-task-suite-
// record.ts, so a worktree-invoked write lands in the MAIN repo's state file the consumers read).
//
// State shape (full-suite-runner SuiteState-compatible): state/runner/startedAt/finishedAt/
// durationMs/laneCount/scope/commit (+ optional taskId/runId/load/reason). `finishedAt` is EPOCH
// SECONDS (integer) — the same convention full-suite-runner writes (gap-batch-merge-gate-reads-stale-
// green: the freshness gate parses epoch); `startedAt` stays ISO 8601. load is best-effort (the
// /proc/loadavg 1min at the suite's end, already carried in the fan-in capture).
//
// Fail-closed (硬规则 3b): a missing/invalid required field exits 2 and writes NOTHING — a partial
// or fabricated state is never written. NOT a verification-round writer: it OVERWRITES the
// single-state full-suite-state.json (the same single-state file full-suite-runner overwrites each
// round), never appends.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/mirror-full-suite-state.ts
//       --state green --started-at <iso> --duration-ms <ms> --lane-count <n> --commit <sha>
//       [--finished-at <iso>] [--load <n>] [--task-id <id>] [--run-id <id>] [--runner <name>]
//       [--scope <name>] [--reason <s>] [--root <dir>] [--state-file <path>] [--json] [--help]
//
//   --state           the terminal state to write: green|red (required)
//   --started-at      the suite start, ISO-8601 (required)
//   --finished-at     the suite end, ISO-8601 or epoch-seconds (optional — when absent, derived as
//                     startedAt + durationMs)
//   --duration-ms     the suite wall-clock in ms (required, non-negative)
//   --lane-count      suite lane count (required, non-negative)
//   --commit          the pinned verified HEAD (suite_head), 40-hex (required)
//   --load            /proc/loadavg 1min at the suite's end (optional, non-negative)
//   --task-id         the fan-in task (optional, traceability)
//   --run-id          the fan-in runId (optional, traceability)
//   --runner          nominal runner identity (default 'inner' — the fan-in suite is an inner-layer run)
//   --scope           the tested tree scope (default 'worktree' — the fan-in suite ran against the worktree HEAD)
//   --reason          red reason (optional; only meaningful with --state red)
//   --root            repo root (default: cwd) — resolves the shared checkout via git common-dir
//   --state-file      override the state path (hermetic tests)
//   --json            machine-readable output {ok, state, file}
//   --help            this help
//
// Exit codes:
//   0  state written
//   2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveSharedCheckout, toIsoTimestamp } from "./per-task-suite-record.ts";
import { writeJsonAtomic } from "./write-json-atomic.ts";

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
 *  as absent — overwriting garbage with a fresh terminal state is harmless). */
export function readCurrentState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
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

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `mirror-full-suite-state.ts — gap-full-suite-state-stale-no-writer AC1/AC3 writer:
  mirror-write the terminal full-suite-state.json reflecting a fan-in detached-suite round (green).
  OVERWRITES the single-state <shared-checkout>/.quay/full-suite-state.json (never appends).

Usage:
  node --experimental-strip-types plugin/scripts/mirror-full-suite-state.ts
      --state green --started-at <iso> --duration-ms <ms> --lane-count <n> --commit <sha>
      [--finished-at <iso>] [--load <n>] [--task-id <id>] [--run-id <id>] [--runner <name>]
      [--scope <name>] [--reason <s>] [--root <dir>] [--state-file <path>] [--json] [--help]

Exit codes:
  0  state written
  2  usage / environment error — nothing written`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const stateFileOverride = getArgValue(args, "--state-file");
  const asJson = args.includes("--json");

  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`mirror-full-suite-state: ${msg}`);
    return 2;
  };

  const built = buildMirrorState({
    state: getArgValue(args, "--state"),
    startedAt: getArgValue(args, "--started-at"),
    finishedAt: getArgValue(args, "--finished-at"),
    durationMs: getArgValue(args, "--duration-ms"),
    laneCount: getArgValue(args, "--lane-count"),
    load: getArgValue(args, "--load"),
    commit: getArgValue(args, "--commit"),
    taskId: getArgValue(args, "--task-id"),
    runId: getArgValue(args, "--run-id"),
    runner: getArgValue(args, "--runner"),
    scope: getArgValue(args, "--scope"),
    reason: getArgValue(args, "--reason"),
  });
  if (built.error) return fail(built.error);
  const state = built.state;

  let stateFile;
  if (stateFileOverride) {
    stateFile = path.resolve(stateFileOverride);
  } else {
    const shared = resolveSharedCheckout(root);
    if (!shared) return fail(`cannot resolve the shared checkout from ${root} (git common-dir failed)`);
    stateFile = path.join(shared, ".quay", "full-suite-state.json");
  }

  // gap-full-suite-state-stale-no-writer AC1 — do NOT clobber an in-flight round (a non-terminal
  // on-disk state is owned by the full-suite-runner; its generation-guarded terminal write would be
  // dropped if we overwrite `running`/early-red with a foreign runId). Skip is a legitimate outcome
  // (exit 0, no write), NOT a failure — the runner's own terminal write is authoritative.
  if (shouldSkipMirrorWrite(readCurrentState(stateFile))) {
    if (asJson) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: "running-in-flight", file: stateFile }));
    } else {
      console.log(`mirror-full-suite-state: skip — state in flight (finishedAt null ⇒ running/early-red); not overwriting → ${stateFile}`);
    }
    return 0;
  }

  try {
    writeMirrorState(stateFile, state);
  } catch (e) {
    return fail(`write failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: true, state, file: stateFile }));
  } else {
    console.log(`mirror-full-suite-state: wrote state=${state.state} (${state.taskId ?? "-"} run ${state.runId ?? "-"}) → ${stateFile}`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "mirror-full-suite-state")) {
  process.exitCode = main(process.argv);
}
