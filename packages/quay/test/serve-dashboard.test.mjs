// @test-group product
// serve-dashboard.test.mjs — gap-dashboard-live-swimlane-fixed-lane-gantt-timeline: the 循环脉搏卡
// swimlane becomes a fixed-5-lane gantt merging in-flight + worker-outcome history.
//   AC1 — mergeLiveAndHistoryIntervals dedups by run_id (a run in BOTH sources appears once) and uses
//         ended_at for historical end / now for in-flight end.
//   AC2 — packLanes greedy packing: (a) non-overlap → one lane; (b) 5 overlap → exactly 5 lanes;
//         (c) a 6th overlap → overflow (no index clip, not silently dropped).
//   AC3 — renderLiveGanttSvg renders one <rect> per input interval + exactly 5 lane guide lines.
//   AC4 — every <rect> carries a native <title> with the task id + a duration.
//   AC5 — renderLiveCard keeps the in-flight mini-list AND renders the merged gantt (both present).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderLiveCard,
  renderLiveGanttSvg,
  mergeLiveAndHistoryIntervals,
  packLanes,
  FIXED_GANTT_LANES,
} from "../src/serve-dashboard.ts";

const FIXED_NOW_MS = 1_700_000_000_000; // deterministic wall-clock anchor
const HOUR_MS = 3_600_000;

test("AC1: mergeLiveAndHistoryIntervals dedups by run_id, ends historical at ended_at and in-flight at now", () => {
  const nowMs = FIXED_NOW_MS;
  const winStart = nowMs - 3 * HOUR_MS;
  const endedMs = nowMs - 30 * 60_000;
  const inFlight = [
    { taskId: "T-shared", runId: "R1", startedAtMs: nowMs - 10 * 60_000, phase: "implementing" },
    { taskId: "T-live-only", runId: "R2", startedAtMs: nowMs - 5 * 60_000, phase: "fan-in" },
  ];
  // R1 appears in BOTH sources (in-flight + already-written outcome) — must dedup to one interval.
  const records = [
    { task: "T-shared", run_id: "R1", started_at: new Date(nowMs - 10 * 60_000).toISOString(), ended_at: new Date(nowMs - 20 * 60_000).toISOString(), final_state: "completed", mechanical_fan_in: null },
    { task: "T-hist-only", run_id: "R3", started_at: new Date(nowMs - 2 * HOUR_MS).toISOString(), ended_at: new Date(endedMs).toISOString(), final_state: "completed", mechanical_fan_in: { outcome: "landed" } },
  ];

  const out = mergeLiveAndHistoryIntervals(inFlight, records, winStart, nowMs);

  assert.equal(out.filter((i) => i.runId === "R1").length, 1, "R1 (in both sources) appears exactly once");
  const shared = out.find((i) => i.runId === "R1");
  assert.equal(shared.endMs, nowMs, "the deduped R1 keeps the in-flight end (now), not ended_at");
  assert.equal(shared.phase, "implementing", "the deduped R1 keeps its in-flight phase");

  const liveOnly = out.find((i) => i.runId === "R2");
  assert.equal(liveOnly.endMs, nowMs, "an in-flight-only interval ends at now");

  const histOnly = out.find((i) => i.runId === "R3");
  assert.equal(histOnly.endMs, endedMs, "a historical interval ends at ended_at");
  assert.equal(histOnly.fanInOutcome, "landed", "the mechanical fan-in outcome is carried through");
});

test("AC2: packLanes greedy packing — non-overlap, exactly-cap overlap, and the overflow arm", () => {
  const nowMs = FIXED_NOW_MS;
  const mk = (runId, startMs, endMs) => ({ taskId: runId, runId, startMs, endMs, phase: null, finalState: "completed", fanInOutcome: null });

  // (a) non-overlapping intervals all pack onto lane 0.
  const non = [0, 1, 2, 3, 4].map((i) => mk(`N${i}`, nowMs + i * 2000, nowMs + i * 2000 + 1000));
  const a = packLanes(non, 5);
  assert.equal(a.lanes.length, 1, "(a) non-overlapping intervals all share one lane");
  assert.equal(a.lanes[0].length, 5, "(a) all five on lane 0");
  assert.equal(a.overflow, 0, "(a) no overflow");

  // (b) 5 fully-overlapping intervals exactly fill the 5 lanes.
  const five = [0, 1, 2, 3, 4].map((i) => mk(`O${i}`, nowMs, nowMs + 1000));
  const b = packLanes(five, 5);
  assert.equal(b.lanes.length, 5, "(b) 5 overlapping intervals occupy exactly 5 lanes");
  assert.ok(b.lanes.every((l) => l.length === 1), "(b) one interval per lane");
  assert.equal(b.overflow, 0, "(b) no overflow at exactly the cap");

  // (c) a 6th interval overlapping all five must hit the overflow arm, not be clipped or dropped.
  const six = [0, 1, 2, 3, 4, 5].map((i) => mk(`S${i}`, nowMs, nowMs + 1000));
  const c = packLanes(six, 5);
  assert.equal(c.overflow, 1, "(c) the 6th overlapping interval overflows");
  assert.ok(c.lanes.every((l) => l.length === 1), "(c) no lane carries two (no index clip)");
  const total = c.lanes.reduce((s, l) => s + l.length, 0);
  assert.equal(total + c.overflow, 6, "(c) overflow is counted, not silently dropped");
});

test("AC3: renderLiveGanttSvg renders one <rect> per interval + exactly 5 lane guide lines", () => {
  const nowMs = FIXED_NOW_MS;
  const ivs = [0, 1, 2].map((i) => ({
    taskId: `T${i}`,
    runId: `R${i}`,
    startMs: nowMs - i * 10 * 60_000,
    endMs: nowMs,
    phase: "implementing",
    finalState: null,
    fanInOutcome: null,
  }));
  const svg = renderLiveGanttSvg(ivs, 3, nowMs);

  const rects = svg.match(/<rect[^>]*>/g) ?? [];
  assert.equal(rects.length, ivs.length, "one <rect> per input interval (exact count, same convention)");
  const laneLines = svg.match(/class="lane-line"/g) ?? [];
  assert.equal(laneLines.length, FIXED_GANTT_LANES, "exactly 5 lane guide lines (the fixed concurrency cap), even when some lanes are empty");
});

test("AC4: every gantt <rect> carries a native <title> with the task id + a duration", () => {
  const nowMs = FIXED_NOW_MS;
  const ivs = [
    { taskId: "task-alpha", runId: "R1", startMs: nowMs - 10 * 60_000, endMs: nowMs, phase: "implementing", finalState: null, fanInOutcome: null },
    { taskId: "task-beta", runId: "R2", startMs: nowMs - 20 * 60_000, endMs: nowMs - 5 * 60_000, phase: null, finalState: "completed", fanInOutcome: "landed" },
  ];
  const svg = renderLiveGanttSvg(ivs, 3, nowMs);

  const titles = svg.match(/<title>([^<]*)<\/title>/g) ?? [];
  assert.equal(titles.length, ivs.length, "every <rect> carries a <title> child");
  for (const t of titles) {
    assert.match(t, /task-alpha|task-beta/, "title carries the task id");
    assert.match(t, /\d+(h\d+m|m\d+s|s)/, "title carries a duration");
  }
});

test("AC5: renderLiveCard keeps the in-flight mini-list AND renders the merged gantt", () => {
  const nowMs = FIXED_NOW_MS;
  const live = {
    status: "ok",
    liveState: "running",
    concurrency: 1,
    inFlight: [{ taskId: "T-1", runId: "R1", startedAtMs: nowMs - 60_000, phase: "implementing" }],
  };
  const records = [
    { task: "T-hist", run_id: "R9", started_at: new Date(nowMs - HOUR_MS).toISOString(), ended_at: new Date(nowMs - 30 * 60_000).toISOString(), final_state: "completed", mechanical_fan_in: { outcome: "landed" } },
  ];
  const html = renderLiveCard(live, nowMs, [], records, 3);

  // The mini-list (liveMiniList) is a hard constraint — its task-id anchor is UNIQUE to the mini-list
  // (the gantt svg has no <a>), so its presence proves the list was NOT removed by the gantt upgrade.
  assert.match(html, /<a href="\/task\/T-1"/, "the in-flight mini-list task-id anchor survives");
  assert.match(html, /实现中/, "the mini-list tag text renders");
  assert.match(html, /循环脉搏甘特图/, "the merged fixed-lane gantt svg renders");
  // Both must be in the SAME card render (indexOf order is irrelevant; coexistence is the assertion).
  assert.ok(html.includes('aria-label="循环脉搏甘特图'), "gantt svg present");
});
