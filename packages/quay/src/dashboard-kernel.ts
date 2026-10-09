// dashboard-kernel.ts — the REUSABLE half of the dashboard's "Loop pulse" gantt
// (gap-dashboard-kernel-export-for-cross-project-reuse).
//
// WHY THIS FILE EXISTS: the fixed-5-lane gantt's *packing* logic — merge in-flight + history into
// one interval list, then greedily assign intervals to lanes — is the half another project can
// reuse verbatim. claudecodeui's Quay tab renders its own React component (Tailwind + dark mode)
// but must agree with quay's own card lane-for-lane; re-implementing the packing there is exactly
// the drift this subpath removes. It is published as the package subpath `quay/dashboard-kernel`
// (see packages/quay/package.json `exports`); the fixture `dashboard-kernel-vectors.json` beside
// this file is the cross-project equivalence vector for the same contract.
//
// ⛔ ZERO IMPORTS, DELIBERATELY — this is a LEAF module. It imports NOTHING, not even `import type`
// from observation.ts / serve-render.ts / serve-i18n.ts. A consumer that only wants lane packing
// must not drag the web layer's transitive dependency graph (render / i18n / CSS colour tokens)
// into its bundle. The two input shapes below are therefore declared STRUCTURALLY — the minimum
// fields this module actually reads — rather than imported from observation.ts. They are satisfied
// by `InFlightTask` and `WorkerOutcomeRecord`, so `serve-dashboard.ts` passes its own values
// through unchanged (no cast, no adapter).
//
// ⛔ THE RENDERING HALF STAYS BEHIND. `renderLiveGanttSvg` (plus its `ganttIntervalColorVar` colour
// tokens and `phaseLabel` i18n wording) is coupled to quay's own visual system — CSS custom-property
// names, the dashboard's colour-token functions, the label catalogue. It is NOT part of the
// published surface: consumers map the phase / final-state VALUES published here onto their own
// palette. Only the state vocabulary (`LiveIntervalPhase` / `LiveIntervalFinalState`) is published.

/** The dispatch concurrency cap — also the fixed Y-axis lane count ("this is the concurrency cap").
 *  Matches the driver's FIXED_DISPATCH_CAP so the two can never drift apart. */
export const FIXED_GANTT_LANES = 5;

/** The execution phases an in-flight interval can carry — the published state vocabulary a consumer
 *  maps onto its own palette. Mirrors `InFlightPhase` in observation.ts (declared here as a value +
 *  type so a zero-import leaf can hand the list to a consumer at runtime, not only to its type
 *  checker). */
export const LIVE_INTERVAL_PHASES = ["implementing", "fan-in", "awaiting-land", "landed"] as const;
export type LiveIntervalPhase = (typeof LIVE_INTERVAL_PHASES)[number];

/** The terminal states a HISTORICAL (worker-outcome) interval can carry — the second half of the
 *  published state vocabulary. Mirrors `WorkerOutcomeRecord.final_state`'s terminal values. */
export const LIVE_INTERVAL_FINAL_STATES = ["completed", "failed", "killed", "timed-out", "exited-not-landed"] as const;
export type LiveIntervalFinalState = (typeof LIVE_INTERVAL_FINAL_STATES)[number];

/** The minimum an in-flight run must expose for `mergeLiveAndHistoryIntervals` — a structural subset
 *  of observation.ts's `InFlightTask` (which supplies these plus pid/sessionId/status/…). */
export interface LiveInFlightTask {
  taskId: string;
  runId: string;
  startedAtMs: number;
  phase: string | null;
}

/** The minimum a worker-outcome history record must expose for `mergeLiveAndHistoryIntervals` — a
 *  structural subset of observation.ts's `WorkerOutcomeRecord`. */
export interface LiveHistoryRecord {
  task: string | null;
  run_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  final_state: string | null;
  mechanical_fan_in: { outcome: string | null } | null;
}

/** A merged in-flight-or-historical run interval for the liveCard gantt. `phase` (in-flight) and
 *  `finalState`/`fanInOutcome` (historical) are mutually exclusive: exactly one side is non-null. */
export interface LiveGanttInterval {
  taskId: string;
  runId: string;
  startMs: number;
  endMs: number;
  phase: string | null;
  finalState: string | null;
  fanInOutcome: string | null;
}

/** Merge readLive's in-flight runs (open interval to `now`) with worker-outcome history (closed
 *  interval, filtered to `[windowStartMs, nowMs]`) into ONE interval list. Pure — no I/O.
 *  A run that is both in-flight AND already on the outcome carrier appears once: in-flight wins
 *  (added first). The dedup key is (taskId, startMs) — NOT `run_id`, which is the driver-process
 *  round id shared by EVERY task dispatched in that driver lifetime (⛔ gap-dashboard-gantt-
 *  runid-dedup-collapses-driver-round-shared-id: deduping on run_id collapsed dozens of distinct
 *  historical tasks per driver round into one). (taskId, startMs) is unique per dispatch and, for
 *  the same run, `Date.parse(started_at)` round-trips to the exact `startedAtMs` the in-flight
 *  side carries, so the cross-source dedup still fires for a genuinely-shared run. */
export function mergeLiveAndHistoryIntervals(
  inFlight: readonly LiveInFlightTask[],
  records: readonly LiveHistoryRecord[],
  windowStartMs: number,
  nowMs: number,
): LiveGanttInterval[] {
  const seen = new Set<string>();
  const out: LiveGanttInterval[] = [];
  const add = (iv: LiveGanttInterval): void => {
    // startMs is always finite here (both callers guard it), so the key is always well-defined even
    // when taskId is "" (an unknown task — the key still distinguishes by start time).
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

/** Greedy "meeting-room" packing of intervals onto ≤ maxLanes lanes (sorted by start, assigned to the
 *  earliest lane whose last interval has ended). Returns the packed lanes PLUS an explicit `overflow`
 *  count: when a moment has > maxLanes overlapping intervals (e.g. a fan-in phase not counted against
 *  the driver's worker cap), the excess is NEVER silently dropped or index-clipped — it surfaces as a
 *  visible "+N 更多" badge, not a swallowed interval. (The bounded-overlap ⇒ ≤5-lane convergence claim
 *  holds only when the window's true concurrency never exceeds the cap; the overflow arm is the honest
 *  degradation when that assumption breaks.) */
export function packLanes(
  intervals: readonly LiveGanttInterval[],
  maxLanes: number = FIXED_GANTT_LANES,
): { lanes: LiveGanttInterval[][]; overflow: number } {
  const sorted = [...intervals].sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));
  const lanes: LiveGanttInterval[][] = [];
  const laneEnds: number[] = [];
  let overflow = 0;
  for (const iv of sorted) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (laneEnds[i] <= iv.startMs) { lane = i; break; }
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
