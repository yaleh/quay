// @test-group product
// gap-live-read-cost-linear-in-round-carrier — `readLive`'s round-carrier read stopped being
// O(carrier size). The live `.quay/worker-round.jsonl` is 94 MB / 61k lines; the old reader read every
// byte and JSON-parsed every line to answer two questions that live at the carrier's two ENDS: "the
// LAST record carrying `in_flight_tasks`" (a tail property) and "the driver's earliest `ts`" (a head
// property, because the carrier is append-ordered). `quay lanes --json` therefore cost 1.1–1.6 s and
// grew with the file, not with the in-flight count.
//
// AC2 (cost + equivalence) and AC3 (negative control: "last key-bearing line" is NOT "last line", and
// "no key anywhere" is an empty set, never an error) are asserted here against SYNTHETIC carriers in
// private temp dirs — ⛔ never the real `.quay/`. The cost assertion compares the new tail read with
// the OLD algorithm (full read + per-line JSON.parse + keep-last) run on the SAME ≥50 MB file in the
// SAME process, so it is a ratio, not a wall-clock constant that a loaded host could falsify.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readLive,
  readCarrierHeadText,
  readWorkerRoundInFlightTasks,
  workerDriverOnlineMs,
  WORKER_ROUND_REL,
} from "../src/observation.ts";

const NOW_MS = Date.UTC(2026, 9, 25, 12, 0, 0);
const FIRST_TS = "2026-10-01T00:00:00.000Z";
const KEY_LINE =
  '{"ts":"2026-10-02T00:00:00.000Z","round":999999,"action":"dispatch",' +
  '"in_flight_tasks":["task-A","task-B"],' +
  '"in_flight_task_starts":{"task-A":1792454400000,"task-B":"2026-10-20T01:00:00.000Z"}}';

/** A private workspace root (the round carrier lives at `<root>/.quay/worker-round.jsonl`). */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  return ws;
}

function writeRound(ws, lines) {
  fs.writeFileSync(path.join(ws, WORKER_ROUND_REL), lines.join("\n") + "\n");
  return path.join(ws, WORKER_ROUND_REL);
}

/** The OLD reader, verbatim: read the whole carrier, JSON-parse every line, keep the LAST
 *  `in_flight_tasks` array. This is the baseline the fix must beat — not a re-implementation of the
 *  new one. Returns null when no line carries the key. */
function oldFullScanInFlight(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  let last = null;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let j;
    try { j = JSON.parse(s); } catch { continue; }
    if (Array.isArray(j.in_flight_tasks)) last = j.in_flight_tasks;
  }
  return last;
}

function ms(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

test("AC2 — a ≥50MB round carrier produces the same reading as a tiny one, and costs < 60% of the old full scan", () => {
  const big = makeWorkspace("glr-ac2-big");
  const small = makeWorkspace("glr-ac2-small");
  try {
    // ~50k filler heartbeats × ~1KB ≈ 50 MB (the AC's floor), then the one key-bearing record.
    const PAD = "x".repeat(1000);
    const filler = [];
    for (let i = 0; i < 50_000; i++) {
      filler.push(`{"ts":"${new Date(Date.parse(FIRST_TS) + i * 60_000).toISOString()}","round":${i},"action":"idle","pad":"${PAD}"}`);
    }
    const bigPath = writeRound(big, [...filler, KEY_LINE]);
    const bigBytes = fs.statSync(bigPath).size;
    assert.ok(bigBytes >= 50 * 1024 * 1024, `synthetic carrier must be ≥50MB, got ${bigBytes} bytes`);

    // The "same logical content" small carrier: the SAME first ts (the head fact) + the SAME
    // key-bearing record (the tail fact). Nothing in between is semantic.
    const smallPath = writeRound(small, [`{"ts":"${FIRST_TS}","round":0,"action":"idle"}`, KEY_LINE]);

    // (1) Equivalence at the reader seam.
    const expected = [
      { taskId: "task-A", startedAtMs: 1792454400000 },
      { taskId: "task-B", startedAtMs: Date.parse("2026-10-20T01:00:00.000Z") },
    ];
    assert.deepEqual(readWorkerRoundInFlightTasks(big), expected, "big carrier: last key-bearing record wins");
    assert.deepEqual(readWorkerRoundInFlightTasks(small), expected, "small carrier: same reading");
    assert.deepEqual(readWorkerRoundInFlightTasks(big), readWorkerRoundInFlightTasks(small),
      "the carrier's size must not change the semantic reading");

    // (2) Equivalence through the PRODUCTION call chain (readLive, the function `quay lanes` and
    // `quay driver live` both call). liveWorkers: [] keeps this hermetic (no host /proc scan).
    const liveBig = readLive(big, { nowMs: NOW_MS, liveWorkers: [] });
    const liveSmall = readLive(small, { nowMs: NOW_MS, liveWorkers: [] });
    assert.equal(liveBig.status, "ok");
    assert.deepEqual(liveBig.inFlight, liveSmall.inFlight, "readLive output must be byte-equal in content across carrier sizes");
    assert.deepEqual(liveBig.inFlight.map((t) => t.taskId).sort(), ["task-A", "task-B"]);

    // (3) The head slice still yields the carrier's EARLIEST ts — the only fact workerDriverOnlineMs
    // derives from the round text. Compared against the old full scan on the SAME file.
    assert.equal(workerDriverOnlineMs(big), Date.parse(FIRST_TS), "full scan: earliest ts is the first record's");
    assert.equal(workerDriverOnlineMs(big, { roundText: readCarrierHeadText(big, WORKER_ROUND_REL) }), Date.parse(FIRST_TS),
      "head slice: same earliest ts (the carrier is append-ordered)");

    // (4) Cost: new tail read ≤ 60% of the OLD full read+parse on the same file. Both readings are
    // warm (page cache) so the comparison is about ALGORITHM, and the ratio is ~100× not ~1.1×.
    fs.readFileSync(bigPath); // warm the page cache for BOTH sides
    const oldMs = ms(() => oldFullScanInFlight(bigPath));
    const newMs = ms(() => readWorkerRoundInFlightTasks(big));
    assert.ok(newMs <= oldMs * 0.6,
      `tail read must be ≤60% of the old full scan: new=${newMs.toFixed(3)}ms old=${oldMs.toFixed(3)}ms`);
    assert.ok(newMs < 50, `tail read must not scale with the carrier: ${newMs.toFixed(3)}ms on ${bigBytes} bytes`);
  } finally {
    fs.rmSync(big, { recursive: true, force: true });
    fs.rmSync(small, { recursive: true, force: true });
  }
});

test("AC3 — the LAST KEY-BEARING line wins even when it is not the last line; no key at all ⇒ []", () => {
  // (a) key-bearing record 3 lines from the end.
  const a = makeWorkspace("glr-ac3-a");
  // (b) no line carries the key.
  const b = makeWorkspace("glr-ac3-b");
  // (c) key-bearing record deeper than the FIRST tail window (256 KiB) — the window must grow.
  const c = makeWorkspace("glr-ac3-c");
  // (d) the key-bearing line ITSELF is larger than the first window — the window is one no-newline
  //     fragment on the first pass and must grow to cover the whole line.
  const d = makeWorkspace("glr-ac3-d");
  try {
    writeRound(a, [
      `{"ts":"${FIRST_TS}","round":1,"action":"idle"}`,
      KEY_LINE,
      `{"ts":"2026-10-03T00:00:00.000Z","round":2,"action":"idle"}`,
      `{"ts":"2026-10-04T00:00:00.000Z","round":3,"action":"idle"}`,
    ]);
    assert.deepEqual(readWorkerRoundInFlightTasks(a).map((t) => t.taskId), ["task-A", "task-B"],
      "(a) the earlier key-bearing record is still returned when later lines carry no key");

    writeRound(b, [
      `{"ts":"${FIRST_TS}","round":1,"action":"idle"}`,
      `{"ts":"2026-10-03T00:00:00.000Z","round":2,"action":"idle"}`,
    ]);
    assert.deepEqual(readWorkerRoundInFlightTasks(b), [],
      "(b) every line was considered and none carries the key ⇒ a real empty set, not an error");

    const deep = [];
    for (let i = 0; i < 5_000; i++) deep.push(`{"ts":"2026-10-05T00:00:00.000Z","round":${i},"action":"idle","pad":"${"y".repeat(1000)}"}`);
    writeRound(c, [KEY_LINE, ...deep]);
    assert.deepEqual(readWorkerRoundInFlightTasks(c).map((t) => t.taskId), ["task-A", "task-B"],
      "(c) the key-bearing record ~5MB from EOF is found as the tail window grows");

    const huge = `{"ts":"2026-10-06T00:00:00.000Z","round":7,"action":"dispatch","pad":"${"z".repeat(400_000)}","in_flight_tasks":["task-C"]}`;
    writeRound(d, [`{"ts":"${FIRST_TS}","round":0,"action":"idle"}`, huge]);
    assert.deepEqual(readWorkerRoundInFlightTasks(d).map((t) => t.taskId), ["task-C"],
      "(d) a key-bearing line larger than the first window (no newline in it) is still parsed");
  } finally {
    for (const ws of [a, b, c, d]) fs.rmSync(ws, { recursive: true, force: true });
  }
});
