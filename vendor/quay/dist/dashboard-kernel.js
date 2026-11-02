// src/dashboard-kernel.ts
var FIXED_GANTT_LANES = 5;
var LIVE_INTERVAL_PHASES = ["implementing", "fan-in", "awaiting-land", "landed"];
var LIVE_INTERVAL_FINAL_STATES = ["completed", "failed", "killed", "timed-out", "exited-not-landed"];
function mergeLiveAndHistoryIntervals(inFlight, records, windowStartMs, nowMs) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const add = (iv) => {
    const key = `${iv.taskId}|${iv.startMs}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(iv);
  };
  for (const t of inFlight) {
    if (!Number.isFinite(t.startedAtMs) || t.startedAtMs > nowMs) continue;
    add({ taskId: t.taskId, runId: t.runId, startMs: t.startedAtMs, endMs: nowMs, phase: t.phase, finalState: null, fanInOutcome: null });
  }
  for (const r of records) {
    const startMs = r.started_at != null ? Date.parse(r.started_at) : NaN;
    const endMs = r.ended_at != null ? Date.parse(r.ended_at) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) continue;
    if (endMs < windowStartMs || startMs > nowMs) continue;
    add({ taskId: r.task ?? "", runId: r.run_id ?? "", startMs, endMs, phase: null, finalState: r.final_state, fanInOutcome: r.mechanical_fan_in?.outcome ?? null });
  }
  return out;
}
function packLanes(intervals, maxLanes = FIXED_GANTT_LANES) {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const lanes = [];
  const laneEnds = [];
  let overflow = 0;
  for (const iv of sorted) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (laneEnds[i] <= iv.startMs) {
        lane = i;
        break;
      }
    }
    if (lane >= 0) {
      lanes[lane].push(iv);
      laneEnds[lane] = iv.endMs;
    } else if (lanes.length < maxLanes) {
      lanes.push([iv]);
      laneEnds.push(iv.endMs);
    } else {
      overflow++;
    }
  }
  return { lanes, overflow };
}
export {
  FIXED_GANTT_LANES,
  LIVE_INTERVAL_FINAL_STATES,
  LIVE_INTERVAL_PHASES,
  mergeLiveAndHistoryIntervals,
  packLanes
};
