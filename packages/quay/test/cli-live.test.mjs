// @test-group product
//
// gap-no-readonly-surface-for-live-inflight-workers: the read-only `quay driver live` surface —
// the machine-readable "current in-flight workers" reading, the counterpart to the web dashboard's
// "Loop pulse" card. Before this, "what is running right now" was only computed INSIDE the serve
// process (observation.readLive), so an external read-only consumer had to re-implement the
// host-global `/proc` scan — and that scan matches quay's INTERNAL cmdline convention (`Repo root:`),
// which fails silently to an empty panel when it drifts (hard rule 3b: 读不到 与 没有在跑 同形).
//
// These tests pin the SHAPE + the tri-state + the single-implementation invariant DETERMINISTICALLY,
// with no dependence on host worker processes. The REAL end-to-end reading (with real workers in
// flight, and the two-root negative control) is recorded in the task's `## Evidence` section — a
// fixture cannot be that measurement (hard rule 4 推论三).
//
// ⛔ DoD2: no second `/proc` scan is produced. This file CALLS the reader; it never scans /proc itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { run } from "../bin/quay.ts";
import {
  LIVE_STATE_REL,
  LIVE_STATE_SCHEMA,
  LIVE_STATE_STALE_MS,
  readLive,
  readLiveState,
  readLiveWorkers,
} from "../src/observation.ts";
// gap-live-state-small-carrier-for-subsecond-inflight-read: the WRITER's projection (the SAME class
// the resident worker driver runs) — imported so the transition tests drive the real code path, not
// a re-implementation of it. The module's direct-entry guard keeps `main()` from running on import.
import { LiveStateProjection } from "../../../plugin/scripts/worker-driver.ts";

/** A throwaway workspace: `.quay/config.yml` is all `resolveRoot`/`findConfig` need. */
function mkWorkspace(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `quay-driver-live-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "provider: native\n");
  return root;
}

/** Make this workspace's worker driver read as ACTIVE (workerDriverActive → true): a round carrier
 *  that exists (its content is irrelevant to the active gate). */
function markDriverActive(root) {
  fs.writeFileSync(path.join(root, ".quay", "worker-round.jsonl"), "");
}

/** A round carrier naming one in-flight task ⇒ a CARRIER-ONLY in-flight entry (worker process gone,
 *  so `pid === null`) — the mechanical fan-in window shape. */
function writeRoundCarrier(root, taskId, startedAtMs) {
  fs.writeFileSync(
    path.join(root, ".quay", "worker-round.jsonl"),
    JSON.stringify({ in_flight_tasks: [taskId], in_flight_task_starts: { [taskId]: startedAtMs } }) + "\n",
  );
}

async function runCli(args) {
  try {
    const r = await run(args, { capture: true });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  } finally {
    process.exitCode = 0; // run() mutates the shared global; keep the test runner's exit clean
  }
}

test("AC1: `quay driver live --json` prints the in-flight set with taskId/pid/startedAtMs per entry", async () => {
  const root = mkWorkspace("ac1");
  writeRoundCarrier(root, "task-fixture-one", 1_700_000_000_000);
  try {
    const r = await runCli(["driver", "live", "--json", "--root", root]);
    assert.equal(r.code, 0, `exit 0 (stderr: ${r.stderr})`);
    const out = JSON.parse(r.stdout);
    assert.equal(typeof out, "object");
    assert.equal(out.root, root);
    assert.ok(Array.isArray(out.inFlight), "inFlight is an array");
    assert.equal(out.inFlight.length, 1);
    const entry = out.inFlight[0];
    assert.equal(entry.taskId, "task-fixture-one");
    assert.ok("pid" in entry, "entry carries pid");
    assert.ok("startedAtMs" in entry, "entry carries startedAtMs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4: `workerSignal.evaluated` separates 'zero in flight' from 'not evaluated'", async () => {
  const active = mkWorkspace("ac4-active");
  const noDriver = mkWorkspace("ac4-nodriver");
  markDriverActive(active); // driver active → /proc scan RUNS
  try {
    const a = JSON.parse((await runCli(["driver", "live", "--json", "--root", active])).stdout);
    const b = JSON.parse((await runCli(["driver", "live", "--json", "--root", noDriver])).stdout);

    // A workspace with an active driver: the process signal WAS evaluated (even with an empty set).
    assert.equal(a.workerSignal.evaluated, true);
    assert.equal(a.workerSignal.reason, null);

    // A workspace with NO worker driver: the /proc scan never ran → "not evaluated", NOT "zero".
    assert.equal(b.workerSignal.evaluated, false);
    assert.equal(typeof b.workerSignal.reason, "string");
    assert.ok(b.workerSignal.reason.length > 0, "reason explains why it was not evaluated");

    // The two readings are programatically distinguishable by the field alone — the whole point of
    // the tri-state (a boolean "hasWorkers" would collapse them).
    assert.notEqual(a.workerSignal.evaluated, b.workerSignal.evaluated);
  } finally {
    fs.rmSync(active, { recursive: true, force: true });
    fs.rmSync(noDriver, { recursive: true, force: true });
  }
});

test("AC5: carrier-only entry has pid === null; a live worker has a string pid; startedAtMs is a number", () => {
  const root = mkWorkspace("ac5");
  writeRoundCarrier(root, "task-carrier-only", 1_700_000_111_000);
  try {
    // ① carrier-only (round carrier names the task; the worker process is gone) ⇒ pid null.
    const carrierOnly = readLiveWorkers(root, { liveWorkers: [] });
    const c = carrierOnly.inFlight.find((t) => t.taskId === "task-carrier-only");
    assert.ok(c, "the round-carried task is in-flight");
    assert.equal(c.pid, null, "carrier-only entry carries no pid");
    assert.equal(typeof c.startedAtMs, "number", "readLive fills startedAtMs from the round's start");
    assert.equal(c.startedAtMs, 1_700_000_111_000);

    // ② a live worker (process scan shape) ⇒ pid is a STRING, startedAtMs a number.
    const withWorker = readLiveWorkers(root, {
      liveWorkers: [{ taskId: "task-live", pid: "4242", startedAtMs: 1_700_000_222_000, repoRoot: root }],
    });
    const w = withWorker.inFlight.find((t) => t.taskId === "task-live");
    assert.ok(w, "the live worker is in-flight");
    assert.equal(w.pid, "4242");
    assert.equal(typeof w.pid, "string", "LiveWorker.pid is a string, not a number");
    assert.equal(typeof w.startedAtMs, "number");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3: the verb and the dashboard's readLive chain change in the SAME direction (one implementation)", () => {
  const root = mkWorkspace("ac3");
  markDriverActive(root);
  const seam = [{ taskId: "task-seam", pid: "777", startedAtMs: 1_700_000_333_000, repoRoot: root }];
  try {
    // The dashboard's "Loop pulse" card reads `readLive(root, {computeBlocking:false})`.
    const dashWith = readLive(root, { liveWorkers: seam, computeBlocking: false });
    const verbWith = readLiveWorkers(root, { liveWorkers: seam });
    const dashEmpty = readLive(root, { liveWorkers: [], computeBlocking: false });
    const verbEmpty = readLiveWorkers(root, { liveWorkers: [] });

    const has = (res) => res.inFlight.some((t) => t.taskId === "task-seam");
    // Two readings, same direction — the verb reuses readLive, so there is no second implementation.
    assert.equal(has(dashWith), true);
    assert.equal(has(verbWith), true);
    assert.equal(has(dashEmpty), false);
    assert.equal(has(verbEmpty), false);
    assert.deepEqual(verbWith.inFlight.map((t) => t.taskId), dashWith.inFlight.map((t) => t.taskId));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("read-only surface: an explicit non-worker --kind is refused, not answered with worker data", async () => {
  const root = mkWorkspace("kind");
  try {
    const r = await runCli(["driver", "live", "--json", "--kind", "promotion", "--root", root]);
    assert.notEqual(r.code, 0, "refuses a kind it cannot answer for");
    assert.match(r.stderr, /promotion/);
    assert.equal(r.stdout, "", "prints no (misleading) worker JSON");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("read-only surface: no workspace found ⇒ explicit refusal (never a fabricated empty reading)", async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "quay-driver-live-bare-"));
  try {
    const r = await runCli(["driver", "live", "--json", "--root", bare]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\.quay\/config\.yml/);
    assert.equal(r.stdout, "");
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test("DoD4: the read path imports no serve module (a pure function of carriers + /proc, needs no server)", () => {
  // The verb must answer with no serve process in the loop. Its read-path modules — observation.ts
  // (readLive/readLiveWorkers) and cli/driver.ts (the handler) — carry no serve import; the reading
  // below then runs in-process with no server involved.
  for (const rel of ["../src/observation.ts", "../src/cli/driver.ts"]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
    // Only import SPECIFIERS count (a bare `export const OBSERVER_…` contains "serve" too).
    const specs = [...src.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    const bad = specs.filter((s) => /(^|\/)serve(\.ts|\.js|\/|$)/.test(s));
    assert.equal(bad.length, 0, `${rel} must not import a serve module (found: ${bad.join(" ; ")})`);
  }
  const root = mkWorkspace("dod4");
  markDriverActive(root);
  try {
    const r = readLiveWorkers(root);
    assert.equal(r.workerSignal.evaluated, true);
    assert.ok(Array.isArray(r.inFlight));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── `.quay/live-state.json` — the byte-level, event-driven in-flight snapshot ──────────────────
// (gap-live-state-small-carrier-for-subsecond-inflight-read, AC1–AC4)
//
// The carrier is the driver's PROJECTION of its own in-flight set, written at the four instants the
// driver actually knows (spawn / child exit / outcome computed / per-round heartbeat) and read by
// `quay live-state` with a FOUR-state discriminator. These tests drive the REAL writer
// (`LiveStateProjection` — the same class the resident loop instantiates) against a temp workspace,
// so the transition→rewrite relation is exercised through the production code path; they never
// touch the real `.quay/`.

/** Write a snapshot file directly (the "lagged one round" / stale fixtures need a controlled
 *  `writtenAt`; the writer always stamps `now`). */
function writeLiveStateFile(root, snapshot) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, LIVE_STATE_REL), JSON.stringify(snapshot, null, 2) + "\n");
}

function readLiveStateFile(root) {
  return JSON.parse(fs.readFileSync(path.join(root, LIVE_STATE_REL), "utf8"));
}

test("AC1: the snapshot carries the exact quay-live-state/v1 shape (one entry in flight, then an empty in-flight array)", () => {
  const root = mkWorkspace("ls-ac1");
  try {
    const projection = new LiveStateProjection(root, { nowMs: () => 1_700_000_500_000 });
    projection.spawn({
      taskId: "task-live-a",
      runId: "run-live-a",
      phase: "implementing",
      startedAtMs: 1_700_000_400_000,
      workerPid: 4242,
    });

    const withOne = readLiveStateFile(root);
    assert.equal(withOne.schema, LIVE_STATE_SCHEMA, "schema is the published constant");
    assert.equal(withOne.source, "worker-driver", "source names the one writer");
    assert.equal(withOne.writtenAt, new Date(1_700_000_500_000).toISOString(), "writtenAt is the write instant (ISO)");
    assert.equal(withOne.inFlight.length, 1);
    const e = withOne.inFlight[0];
    assert.deepEqual(Object.keys(e).sort(), ["lastHeartbeatMs", "phase", "runId", "startedAtMs", "taskId", "workerPid"].sort(),
      "the entry field set is the published contract");
    assert.equal(e.taskId, "task-live-a");
    assert.equal(e.runId, "run-live-a");
    assert.equal(e.phase, "implementing");
    assert.equal(e.startedAtMs, 1_700_000_400_000);
    assert.equal(e.workerPid, 4242);
    assert.equal(e.lastHeartbeatMs, 1_700_000_500_000);

    // The second required reading: a REAL empty in-flight set (not a fabricated one).
    projection.terminal("task-live-a");
    const empty = readLiveStateFile(root);
    assert.equal(empty.schema, LIVE_STATE_SCHEMA);
    assert.deepEqual(empty.inFlight, [], "an empty snapshot is a real reading: inFlight [] + a fresh writtenAt");
    assert.equal(empty.writtenAt, new Date(1_700_000_500_000).toISOString());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: each driver-known transition rewrites the file immediately (no poll interval involved)", () => {
  const root = mkWorkspace("ls-ac2");
  let now = 1_700_000_600_000;
  try {
    const projection = new LiveStateProjection(root, { nowMs: () => now });
    const entry = { taskId: "task-step", runId: "run-step", phase: "implementing", startedAtMs: 1_700_000_600_000, workerPid: 777 };

    // ① spawn success → implementing.
    projection.spawn(entry);
    const afterSpawn = readLiveStateFile(root);
    assert.equal(afterSpawn.inFlight[0].phase, "implementing");
    assert.equal(afterSpawn.inFlight[0].workerPid, 777);

    // ② child exit → fan-in (implementing → fan-in), same clock + 1 ms: the change is the EVENT's,
    //    not a clock rollover's.
    now += 1;
    projection.exit("task-step", "fan-in");
    const afterExit = readLiveStateFile(root);
    assert.equal(afterExit.inFlight[0].phase, "fan-in", "exit rewrote the phase");
    assert.notEqual(afterExit.writtenAt, afterSpawn.writtenAt, "the exit event stamped a new writtenAt");
    assert.notEqual(afterExit.inFlight[0].phase, afterSpawn.inFlight[0].phase, "state change → file content change");

    // ④ heartbeat refreshes the freshness stamp without inventing a phase change.
    now += 1;
    projection.heartbeat([{ ...entry, phase: "fan-in" }]);
    const afterBeat = readLiveStateFile(root);
    assert.equal(afterBeat.inFlight[0].phase, "fan-in", "the heartbeat does not fabricate a phase");
    assert.equal(afterBeat.inFlight[0].lastHeartbeatMs, now, "lastHeartbeatMs advanced to the beat instant");

    // ③ outcome computed → the entry leaves the in-flight snapshot.
    now += 1;
    assert.equal(projection.terminal("task-step"), true, "terminal removed the entry");
    const afterTerminal = readLiveStateFile(root);
    assert.deepEqual(afterTerminal.inFlight, [], "terminal outcome ⇒ no longer in flight");
    assert.equal(afterTerminal.writtenAt, new Date(now).toISOString());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3: `quay live-state --json` reports missing / stale / ok as THREE distinct values (plus unreadable)", async () => {
  const root = mkWorkspace("ls-ac3");
  try {
    // ① missing — no file was ever written. inFlight is null (NOT evaluated), never [].
    const missing = JSON.parse((await runCli(["live-state", "--json", "--root", root])).stdout);
    assert.equal(missing.status, "missing");
    assert.equal(missing.inFlight, null, "missing ⇒ not evaluated (⛔ not 「zero in flight」)");
    assert.equal(missing.carrier, LIVE_STATE_REL);
    assert.equal(missing.staleAfterMs, LIVE_STATE_STALE_MS);

    // ② stale — the file is readable but writtenAt is far outside the threshold.
    const entry = {
      taskId: "task-stale", runId: "run-stale", phase: "implementing",
      startedAtMs: 1_700_000_000_000, workerPid: 9, lastHeartbeatMs: 1_700_000_000_000,
    };
    writeLiveStateFile(root, {
      schema: LIVE_STATE_SCHEMA, writtenAt: "2000-01-01T00:00:00.000Z", source: "worker-driver", inFlight: [entry],
    });
    const staleRun = await runCli(["live-state", "--json", "--root", root]);
    assert.equal(staleRun.code, 0, "a stale snapshot is an evaluated reading (exit 0)");
    const stale = JSON.parse(staleRun.stdout);
    assert.equal(stale.status, "stale");
    assert.ok(stale.ageMs > LIVE_STATE_STALE_MS, "ageMs is the measured distance past the threshold");
    assert.ok(Array.isArray(stale.inFlight), "the stale reading still reports what the file says…");
    assert.match(stale.reason, /staleness threshold/, "…and says WHY it may not be trusted");

    // ③ ok — readable and within the threshold.
    writeLiveStateFile(root, {
      schema: LIVE_STATE_SCHEMA, writtenAt: new Date().toISOString(), source: "worker-driver", inFlight: [entry],
    });
    const ok = JSON.parse((await runCli(["live-state", "--json", "--root", root])).stdout);
    assert.equal(ok.status, "ok");
    assert.equal(ok.inFlight.length, 1);
    assert.equal(ok.inFlight[0].taskId, "task-stale");

    // The three values are programmatically distinct — the whole point (a boolean "is it fresh"
    // would collapse missing+stale into the same false).
    assert.equal(new Set([missing.status, stale.status, ok.status]).size, 3);

    // ④ unreadable — exists but does not validate. A failed read is NOT an empty in-flight set:
    //    exit 1, no document on stdout (硬规则 3b).
    fs.writeFileSync(path.join(root, LIVE_STATE_REL), "{ not json\n");
    const bad = await runCli(["live-state", "--json", "--root", root]);
    assert.equal(bad.code, 1, "an unreadable carrier exits non-zero");
    assert.equal(bad.stdout, "", "…and prints no document that could be read as a reading");
    assert.match(bad.stderr, /unreadable|not valid JSON/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4: the snapshot's taskId set equals readLive's worker-driver source set; a one-round lag is surfaced as stale", () => {
  const root = mkWorkspace("ls-ac4");
  const startedAtMs = 1_700_000_900_000;
  try {
    // The ONLY in-flight source in this fixture is the worker-driver's round carrier ⇒
    // `readLive`'s set IS the worker-driver-source set (no /proc: the seam is injected empty).
    writeRoundCarrier(root, "task-agree", startedAtMs);
    writeLiveStateFile(root, {
      schema: LIVE_STATE_SCHEMA,
      writtenAt: new Date().toISOString(),
      source: "worker-driver",
      inFlight: [{
        taskId: "task-agree", runId: "worker-task-agree", phase: "implementing",
        startedAtMs, workerPid: null, lastHeartbeatMs: Date.now(),
      }],
    });

    const live = readLive(root, { liveWorkers: [], computeBlocking: false });
    const snapshot = readLiveState(root);
    const liveIds = live.inFlight.map((t) => t.taskId).sort();
    assert.equal(snapshot.status, "ok");
    assert.deepEqual(snapshot.inFlight.map((e) => e.taskId).sort(), liveIds,
      "same instant + same fixture ⇒ the snapshot agrees with readLive's worker-driver source");

    // Deliberately let the snapshot lag one round: it still says "nobody in flight" while the
    // authoritative read says the task IS in flight. The difference exists — and the stale status
    // is what tells a consumer not to trust the lagged snapshot.
    writeLiveStateFile(root, {
      schema: LIVE_STATE_SCHEMA, writtenAt: "2000-01-01T00:00:00.000Z", source: "worker-driver", inFlight: [],
    });
    const lagged = readLiveState(root);
    const liveAgain = readLive(root, { liveWorkers: [], computeBlocking: false });
    assert.equal(lagged.status, "stale", "the lag is identified by the stale state");
    assert.deepEqual(lagged.inFlight, [], "the lagged snapshot says nobody is in flight");
    assert.deepEqual(liveAgain.inFlight.map((t) => t.taskId), ["task-agree"], "the authoritative read disagrees");
    assert.notDeepEqual(lagged.inFlight.map((e) => e.taskId), liveAgain.inFlight.map((t) => t.taskId),
      "…so the two readings ARE different, and the difference is flagged (not silently served as current)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
