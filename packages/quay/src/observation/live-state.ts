// observation/live-state.ts — the LIVE-STATE SNAPSHOT seam (split out of observation.ts, task
// gap-routine-architecture-analysis-fan-hub-quay-src).
//
// Responsibility: read `.quay/live-state.json` — the byte-level, event-driven in-flight snapshot
// the worker-driver writes — and return the FOUR-state reading (ok / stale / missing / unreadable).
// ONE small file, no process spawn, no /proc scan, no task-store walk.
//
// ⛔ A boolean "is it fresh" would collapse 「载体不存在」/「载体在但过期」/「可读且在阈值内」 into
// one value, so the reading is four-state. The carrier name, wire schema, staleness threshold and
// phase vocabulary live in the ZERO-IMPORT leaf `../driver-vocab.ts` (shared with the writer
// `plugin/scripts/worker-driver.ts` so the two sides cannot name the same carrier differently).
import { LIVE_STATE_PHASES, LIVE_STATE_REL, LIVE_STATE_SCHEMA, LIVE_STATE_STALE_MS, type WorkerLivePhase } from "../driver-vocab.ts";
import { readCarrierText } from "./records.ts";

export interface LiveStateEntry {
  taskId: string;
  runId: string;
  phase: WorkerLivePhase;
  /** Dispatch instant (epoch ms). */
  startedAtMs: number;
  /** The worker process id, or null when the driver has no live pid for this entry (e.g. an entry
   *  carried across a driver restart whose process id was not recoverable). */
  workerPid: number | null;
  /** The snapshot instant this entry was last rewritten at (epoch ms). */
  lastHeartbeatMs: number;
}

/**
 * The reading's FOUR-state discriminator. `ok` / `stale` / `missing` / `unreadable` are mutually
 * exclusive values; ⛔ none of them is shaped like "zero in flight" except `ok` with an empty
 * `inFlight` array, which is a real, evaluated reading.
 */
export type LiveStateStatus = "ok" | "stale" | "missing" | "unreadable";

export interface LiveStateReading {
  status: LiveStateStatus;
  /** Why this status was chosen (null for `ok`). Carried verbatim so a caller can say WHAT was wrong. */
  reason: string | null;
  carrier: string;
  /** The file's own schema string (echoed only when it validated). */
  schema: string | null;
  writtenAt: string | null;
  writtenAtMs: number | null;
  /** `nowMs - writtenAtMs` (may be negative under clock skew; null when not evaluated). */
  ageMs: number | null;
  staleAfterMs: number;
  source: string | null;
  /**
   * The entries verbatim from the file. `null` means NOT EVALUATED (`missing` / `unreadable`) —
   * ⛔ never `[]`, which would read as "the driver wrote a snapshot with nobody in flight". For
   * `stale` the entries ARE returned (they exist) but the status says they may not be trusted.
   */
  inFlight: LiveStateEntry[] | null;
}

// One interface (not a tagged union): the repo's tsconfig has `strict: false` (no strictNullChecks),
// where narrowing a literal-boolean discriminant does not apply — an optional-field shape says the
// same thing and type-checks. `snapshot` is non-null exactly when `ok` is true.
interface ParsedLiveState {
  ok: boolean;
  /** Why the parse failed (null on success). */
  reason: string | null;
  snapshot: { schema: string; writtenAt: string; writtenAtMs: number; source: string; inFlight: LiveStateEntry[] } | null;
}

/** Validate one snapshot document. Fail-closed: a shape we cannot read is `unreadable`, never a
 *  partially-trusted reading (硬规则 3b — "could not read" must not look like "read and OK"). */
function parseLiveStateSnapshot(text: string): ParsedLiveState {
  const fail = (reason: string): ParsedLiveState => ({ ok: false, reason, snapshot: null });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return fail(`not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail("top-level value is not an object");
  const o = raw as Record<string, unknown>;
  if (o.schema !== LIVE_STATE_SCHEMA) return fail(`schema ${JSON.stringify(o.schema)} ≠ ${LIVE_STATE_SCHEMA}`);
  if (typeof o.source !== "string" || o.source.length === 0) return fail("missing/empty source");
  if (typeof o.writtenAt !== "string") return fail("missing writtenAt");
  const writtenAtMs = Date.parse(o.writtenAt);
  if (!Number.isFinite(writtenAtMs)) return fail(`writtenAt is not an ISO timestamp: ${JSON.stringify(o.writtenAt)}`);
  if (!Array.isArray(o.inFlight)) return fail("inFlight is not an array");
  const inFlight: LiveStateEntry[] = [];
  for (let i = 0; i < o.inFlight.length; i++) {
    const e = o.inFlight[i];
    if (e === null || typeof e !== "object" || Array.isArray(e)) return fail(`inFlight[${i}] is not an object`);
    const r = e as Record<string, unknown>;
    const num = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
    if (typeof r.taskId !== "string" || r.taskId.length === 0) return fail(`inFlight[${i}].taskId is missing/empty`);
    if (typeof r.runId !== "string" || r.runId.length === 0) return fail(`inFlight[${i}].runId is missing/empty`);
    if (typeof r.phase !== "string" || !(LIVE_STATE_PHASES as readonly string[]).includes(r.phase)) {
      return fail(`inFlight[${i}].phase ${JSON.stringify(r.phase)} ∉ ${LIVE_STATE_PHASES.join("|")}`);
    }
    if (!num(r.startedAtMs)) return fail(`inFlight[${i}].startedAtMs is not a finite number`);
    if (r.workerPid !== null && !num(r.workerPid)) return fail(`inFlight[${i}].workerPid is neither null nor a finite number`);
    if (!num(r.lastHeartbeatMs)) return fail(`inFlight[${i}].lastHeartbeatMs is not a finite number`);
    inFlight.push({
      taskId: r.taskId,
      runId: r.runId,
      phase: r.phase as WorkerLivePhase,
      startedAtMs: r.startedAtMs as number,
      workerPid: (r.workerPid === null ? null : r.workerPid) as number | null,
      lastHeartbeatMs: r.lastHeartbeatMs as number,
    });
  }
  return {
    ok: true,
    reason: null,
    snapshot: { schema: LIVE_STATE_SCHEMA, writtenAt: o.writtenAt, writtenAtMs, source: o.source, inFlight },
  };
}

/**
 * Read `.quay/live-state.json` — ONE small file, no process spawn, no `/proc` scan, no task-store
 * walk. The four-state result is the whole point: a caller can distinguish 「载体不存在」(the
 * driver never wrote it / this workspace has no worker driver) from 「载体在但过期」(the driver
 * stopped rewriting) from 「可读且在阈值内」. ⛔ A boolean "is it fresh" would collapse those.
 *
 * `nowMs` is a test seam (the caller controls the observation instant, like `readLive`); the
 * staleness threshold is a parameter only so a caller with a different heartbeat budget can say so
 * — it is NOT a per-call tuning knob for hiding staleness.
 */
export function readLiveState(
  root: string,
  { nowMs = Date.now(), staleMs = LIVE_STATE_STALE_MS }: { nowMs?: number; staleMs?: number } = {},
): LiveStateReading {
  const carrier = readCarrierText(root, LIVE_STATE_REL);
  const base = { carrier: LIVE_STATE_REL, staleAfterMs: staleMs };
  if (carrier.status === "absent") {
    return {
      ...base, status: "missing",
      reason: `${LIVE_STATE_REL} does not exist — the worker driver has not written a snapshot for this workspace (⛔ NOT "zero in flight")`,
      schema: null, writtenAt: null, writtenAtMs: null, ageMs: null, source: null, inFlight: null,
    };
  }
  if (carrier.status === "unreadable" || carrier.text == null) {
    return {
      ...base, status: "unreadable",
      reason: `${LIVE_STATE_REL} exists but could not be read: ${carrier.reason ?? "unknown error"} (⛔ NOT "zero in flight")`,
      schema: null, writtenAt: null, writtenAtMs: null, ageMs: null, source: null, inFlight: null,
    };
  }
  const parsed = parseLiveStateSnapshot(carrier.text);
  if (!parsed.ok) {
    return {
      ...base, status: "unreadable",
      reason: `${LIVE_STATE_REL} exists but its shape is not ${LIVE_STATE_SCHEMA}: ${parsed.reason} (⛔ NOT "zero in flight")`,
      schema: null, writtenAt: null, writtenAtMs: null, ageMs: null, source: null, inFlight: null,
    };
  }
  const snap = parsed.snapshot;
  const ageMs = nowMs - snap.writtenAtMs;
  const common = {
    ...base,
    schema: snap.schema,
    writtenAt: snap.writtenAt,
    writtenAtMs: snap.writtenAtMs,
    ageMs,
    source: snap.source,
    inFlight: snap.inFlight,
  };
  if (ageMs > staleMs) {
    return { ...common, status: "stale", reason: `writtenAt is ${ageMs}ms old (> ${staleMs}ms staleness threshold) — the snapshot is a projection and may be out of date` };
  }
  return { ...common, status: "ok", reason: null };
}
