// cli/lanes.ts — the `quay lanes` verb: the read-only, machine-readable LANES view of the
// dashboard's "Loop pulse" gantt (task gap-cli-lanes-json-verb-for-gantt-consumers).
//
// WHY THIS EXISTS: claudecodeui's Quay tab renders its own gantt component and must agree with
// quay's OWN card lane-for-lane. It consumes quay as a SUBPROCESS (it already shells
// `quay driver live --json`) — it does not take an npm dependency on quay and does not import
// anything out of the plugin's versioned bundle directory (人 2026-10-10: 交付机制取 A).
//
// ⛔ NO SECOND PACKING IMPLEMENTATION (this file's whole reason for being): the interval merging
// and the greedy lane packing are the SAME code the Web card runs — the SAME live call chain
// (`observation.readLive` + `observation.readWorkerOutcomeRecords`) feeding the SAME kernel
// (`dashboard-kernel.mergeLiveAndHistoryIntervals` / `packLanes` / `FIXED_GANTT_LANES`, whose only
// other consumer is `serve-dashboard.renderLiveCard`, see its `live.status === "ok"` guard). This
// verb is an EXIT for that one implementation, not a re-derivation of it. A lane-assignment change
// in the kernel moves this output and the card together, by construction.
//
// ⛔ 车道数恒为 FIXED_GANTT_LANES(5) — 那是【视觉契约】（窗口为空时也要画 5 条参考线），不是「实际
// 占用了几条」。`packLanes` returns only the lanes it had to open, so the view is PADDED to 5 with
// empty lanes here. The excess beyond 5 concurrent intervals is NOT dropped: it is `overflow`.
//
// ⛔ 3b（读不懂 ≠ 合格）：the output's shape is fixed at `{windowHours, nowMs, lanes, overflow}` by
// the consumer's `QuayGanttLanes` type, so "could not read the carrier" CANNOT be expressed by
// adding a field to it. It is expressed by the EXIT CODE instead: a live-telemetry read failure
// (`live.status === "error"`) exits 1 with a reason on stderr and no JSON on stdout, while
// "窗口内无记录" is exit 0 carrying 5 empty lanes. The two states never share a byte.

import { readLive, readWorkerOutcomeRecords } from "../observation.ts";
import { FIXED_GANTT_LANES, mergeLiveAndHistoryIntervals, packLanes, type LiveGanttInterval } from "../dashboard-kernel.ts";
// ⛔ The window's DEFAULT and its VALIDATOR are imported, not re-typed: the card's `?hours=` param
// resolves through the very same `parseTimelineHours` (safe-default on missing/illegal/out-of-range)
// and the very same `DEFAULT_TIMELINE_HOURS` (3). A local `3` here would be a second definition
// point for a value the Contract requires to equal the card's, i.e. exactly the drift class this
// repo forbids. The import is paid only by THIS verb — bin/quay.ts loads handlers lazily at dispatch.
import { DEFAULT_TIMELINE_HOURS, parseTimelineHours } from "../serve-dashboard.ts";
import { resolveRoot } from "../driver-control.ts";
import type { CliCtx } from "./context.ts";

/** The published document — field-for-field the consumer's `QuayGanttLanes` shape
 *  (`{windowHours, nowMs, lanes[], overflow}`, each interval carrying exactly
 *  `taskId/runId/startMs/endMs/phase/finalState/fanInOutcome`). ⛔ Adding a field here is a breaking
 *  change for that consumer: it would be a field the consumer's type does not have. */
export interface GanttLanesDocument {
  windowHours: number;
  nowMs: number;
  lanes: LiveGanttInterval[][];
  overflow: number;
}

/** One reading of a workspace: the published document PLUS the reader's own status, so the caller
 *  can keep 「读不到 carrier」 distinct from 「窗口内无记录」 without widening the published shape. */
export interface GanttLanesReading {
  status: "ok" | "empty" | "error";
  reason: string | null;
  document: GanttLanesDocument;
}

/**
 * Read ONE workspace into the lanes document. Pure w.r.t. the clock (the caller passes `nowMs`), so
 * a caller that needs a specific instant — the parity check against the Web card path — passes it
 * explicitly and both sides then agree by construction.
 *
 * `live.status !== "ok"` ⇒ no intervals, exactly as the card does (its gantt is computed only on the
 * `ok` arm). That is the CARD's rule, mirrored here on purpose: a parity check that "improved" on it
 * would report a difference that is not a defect.
 */
export function readGanttLanes(
  root: string,
  { nowMs = Date.now(), windowHours = DEFAULT_TIMELINE_HOURS }: { nowMs?: number; windowHours?: number } = {},
): GanttLanesReading {
  // The SAME live call chain the card's snapshot uses (observation.readLive), with the caller's
  // instant — ⛔ not a second /proc scan and not a second event parser.
  const live = readLive(root, { nowMs });
  const intervals =
    live.status === "ok"
      ? mergeLiveAndHistoryIntervals(
          live.inFlight,
          readWorkerOutcomeRecords(root),
          nowMs - windowHours * 3_600_000,
          nowMs,
        )
      : [];
  const { lanes, overflow } = packLanes(intervals, FIXED_GANTT_LANES);
  // The visual contract: ALWAYS FIXED_GANTT_LANES reference lanes, empty ones included. `packLanes`
  // opens a lane only when an interval needs it, so the tail is filled here — the consumer draws 5
  // guide lines from this array's length.
  const padded = [...lanes];
  while (padded.length < FIXED_GANTT_LANES) padded.push([]);
  return {
    status: live.status,
    reason: live.reason,
    document: { windowHours, nowMs, lanes: padded, overflow },
  };
}

/**
 * The `quay lanes` body — a pure function of (flags, resolved root), the `runDriverLive` pattern.
 * Always JSON (the machine-readable counterpart to the card, like `quay driver live`). Read-only:
 * it never starts/stops/spawns anything and needs no serve process.
 *
 * Exit codes: 0 = a real reading (including an empty window — 5 empty lanes); 1 = no workspace, or
 * the live telemetry carrier could not be read (3b: that is NOT the same value as an empty window).
 */
export function runLanes(
  flags: Record<string, any>,
  root: string | null,
): { stdout: string; reason: string | null; exitCode: number } {
  if (!root) {
    return {
      stdout: "",
      reason: `quay lanes: no .quay/config.yml found (searched from ${flags.root ?? process.cwd()} upward). Run from a quay workspace root, or pass --root <workspace-root>.`,
      exitCode: 1,
    };
  }
  const rawWindow = typeof flags["window-hours"] === "string" ? flags["window-hours"] : null;
  const windowHours = parseTimelineHours(rawWindow);
  const reading = readGanttLanes(root, { windowHours });
  if (reading.status === "error") {
    return {
      stdout: "",
      reason: `quay lanes: the live telemetry carrier could not be read under ${root}${reading.reason != null ? ` (${reading.reason})` : ""}. ⛔ This is NOT "no records in the window" — refusing to print 5 empty lanes for a failed read.`,
      exitCode: 1,
    };
  }
  return { stdout: JSON.stringify(reading.document, null, 2) + "\n", reason: null, exitCode: 0 };
}

export async function handleLanes({ flags }: CliCtx) {
  const r = runLanes(flags, resolveRoot(flags.root));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.reason) process.stderr.write(r.reason + "\n");
  process.exitCode = r.exitCode;
}
