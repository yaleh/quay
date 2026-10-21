// observation/events.ts — the FAST-MODE EVENT-PAIRING seam (split out of observation.ts, task
// gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module).
//
// Responsibility: read `.workflow-events/*.jsonl` and pair start/end events into in-flight tasks.
// Nothing here touches the task store, /proc, or a `.quay/` carrier — the pairing is PURE over the
// events it is handed (the process/worktree annotation belongs to liveness.ts and readLive).
//
// ⛔ Both predicates come from ../start-end-like.ts — the ONE definition shared with the plugin's
// fast-mode-telemetry.ts. observation.ts keeps its own `export { isStartLike, isEndLike }` line so the
// SSOT ratchet (`plugin/test/start-end-like-ssot.test.mjs`) still finds the Core consumer there.
import fs from "node:fs";
import path from "node:path";
import { isStartLike, isEndLike } from "../start-end-like.ts";
import type { InFlightTask } from "./model.ts";

interface RawEvent {
  stage?: unknown;
  eventKind?: unknown;
  runId?: unknown;
  taskId?: unknown;
  timing?: { startedAtMs?: unknown; endedAtMs?: unknown };
  /** The impl-complete boundary instant (gap-inflight-states-missing-impl-complete-event). */
  recordedAtMs?: unknown;
}

/**
 * Pair parsed `Fast`-stage events into in-flight tasks — mirrors fast-mode-telemetry.ts
 * aggregate()'s inProgress branch exactly: blocked-wait events (`eventKind === "blocked"`) are
 * not task pairs; pairing key is runId; FIRST start wins, LAST end wins; a run with a start and
 * NO end is in-flight; sorted by taskId then runId. Malformed/untyped records are skipped, never
 * thrown. `nowMs` is the observation instant used for elapsed minutes.
 *
 * gap-inflight-states-missing-impl-complete-event: the impl-complete boundary (a third lifecycle
 * event, `eventKind === "impl-complete"`, timing all-null) splits the in-flight view into two
 * segments — implementing (implCompletedAtMs null: start, no impl-complete — 真正在实现) vs
 * awaiting-land (implCompletedAtMs non-null: impl-complete, no end — 排队待落地). FIRST
 * impl-complete wins (a re-write on ff-retry never flips a run back to implementing).
 */
export function pairInFlight(events: RawEvent[], nowMs: number): InFlightTask[] {
  const byRun = new Map<string, { runId: string; taskId: string; start: RawEvent | null; implComplete: RawEvent | null; ends: RawEvent[] }>();
  for (const e of events) {
    if (!e || e.stage !== "Fast" || e.eventKind === "blocked") continue;
    const runId = typeof e.runId === "string" ? e.runId : "";
    const taskId = typeof e.taskId === "string" ? e.taskId : "";
    if (!runId) continue;
    let rec = byRun.get(runId);
    if (!rec) {
      rec = { runId, taskId, start: null, implComplete: null, ends: [] };
      byRun.set(runId, rec);
    }
    // impl-complete is classified BEFORE start/end: its timing is all-null so it is neither
    // start-like nor end-like, but the explicit branch keeps the boundary unambiguous.
    if (e.eventKind === "impl-complete") {
      if (!rec.implComplete) rec.implComplete = e;
    } else if (isStartLike(e)) {
      if (!rec.start) rec.start = e;
    } else if (isEndLike(e)) {
      rec.ends.push(e);
    }
  }

  const out: InFlightTask[] = [];
  for (const rec of byRun.values()) {
    const end = rec.ends.length ? rec.ends[rec.ends.length - 1] : null;
    if (rec.start && !end && typeof rec.start.timing?.startedAtMs === "number") {
      out.push({
        taskId: rec.taskId,
        runId: rec.runId,
        pid: null, // pure event pairing: no live process known (readLive annotates it for 方向二)
        sessionId: null, // pure event pairing: no process ⇒ no live session join (readLive annotates)
        startedAtMs: rec.start.timing.startedAtMs,
        implCompletedAtMs:
          rec.implComplete && typeof rec.implComplete.recordedAtMs === "number"
            ? rec.implComplete.recordedAtMs
            : null,
        // pairInFlight is PURE and cannot read the task store — status stays null, readLive annotates.
        status: null,
        // Provisional phase from the impl-complete event only (the pure function knows no fan-in
        // lock / worker process); readLive re-derives the real phase from the direct signals.
        phase:
          rec.implComplete && typeof rec.implComplete.recordedAtMs === "number"
            ? "awaiting-land"
            : "implementing",
        suite: null,
        minutes: Math.max(0, (nowMs - rec.start.timing.startedAtMs) / 60_000),
        // pairInFlight is a PURE event-pairing function and cannot probe /proc — the fail-closed
        // "unknown" default keeps the field total. readLive overwrites it with the real process
        // liveness (classifyRunLiveness(runProcessAliveSync(runId))).
        liveness: "unknown",
        // blocks/blockedBy are likewise pure-function defaults — readLive annotates the real values
        // from the on-disk task store (computeInFlightBlocking).
        blocks: [],
        blockedBy: [],
      });
    }
  }
  out.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  return out;
}

/** Read every JSON object across all `<eventsDir>/*.jsonl`. Malformed lines are skipped (never crash). */
export function readEventsFromDir(eventsDir: string, files?: string[]): RawEvent[] {
  const list = files ?? fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl")).sort();
  const events: RawEvent[] = [];
  for (const file of list) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(eventsDir, file), "utf8");
    } catch {
      continue; // one unreadable file must not 500 the whole /live page
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) events.push(parsed);
      } catch {
        // skip malformed line — never crash the read
      }
    }
  }
  return events;
}
