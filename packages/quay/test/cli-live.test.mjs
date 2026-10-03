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
import { readLive, readLiveWorkers } from "../src/observation.ts";

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
