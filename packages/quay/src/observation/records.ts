// observation/records.ts — the RUNTIME-RECORD PARSING seam (split out of observation.ts, task
// gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module).
//
// Responsibility: turn the worker-driver's append-only `.quay/*.jsonl` carriers into typed records —
// worker outcomes, the mechanical fan-in sub-record, fan-in attempts, and the round heartbeat's
// in-flight list — keeping the line accounting that makes "read it all" distinguishable from "read
// some of it" (硬规则 ③: enumerate, never a boolean).
//
// ⛔ Pure parsers + carrier reads. Liveness decisions over these records (driver online instant,
// in-flight derivation) live in ./liveness.ts; the task store is never touched here.
import fs from "node:fs";
import path from "node:path";
import { WORKER_OUTCOME_REL, WORKER_ROUND_REL } from "./model.ts";
import type { InFlightTask } from "./model.ts";

// ── Worker-driver carrier (gap-live-page-worker-driver-inflight-invisible) ─────────────────────
// The worker-driver (the production executor since AC138) does NOT write `.workflow-events/*.jsonl`
// (the old inner fast-mode-telemetry store). It writes its own runtime carriers — `.quay/worker-
// outcome.jsonl` (one record per FINISHED worker run) and `.quay/worker-round.jsonl` (an unconditional
// heartbeat carrying only the in-flight COUNT, no task list). readLive previously read ONLY the
// workflow-events store, so the driver's real in-flight work was invisible on the Live page (AC136's
// other half — AC136 wired the promotion-driver into the POOL metric; nobody wired the worker-driver
// into the IN-FLIGHT table).
//
// Carrier fact (why "in-flight" is DERIVED, not read): the outcome record is written at worker END —
// the driver has no persisted per-task "started" record. So a task whose worker is STILL RUNNING has
// no outcome record yet and surfaces on its first outcome write. "Worker-driver in-flight" below is
// therefore the carrier-derivable open set: a task whose LATEST outcome is not `completed` (dispatched
// but not landed — the driver keeps re-dispatching it until it lands). This is the same "open run"
// notion the workflow-events pairing gives (start without end).

/** The worker-driver's mechanical-fan-in result (gap-mech-fan-in-log-webui-visible-clickable A3):
 *  the per-task mechanical fan-in terminal state the driver writes into worker-outcome.jsonl. Unknown/
 *  missing fields degrade to null rather than a fabricated reading (hard rule ③b) — same best-effort
 *  carrier contract as WorkerOutcomeRecord. */
export interface MechanicalFanInRecord {
  /** Terminal mechanical fan-in state: "landed" | "red". */
  outcome: string | null;
  /** First failing step name (outcome=red); null when landed. */
  step: string | null;
  /** Failure reason (outcome=red); null when landed. */
  reason: string | null;
  /** fan-in workflow lock hold duration (sec), read from lock-events. */
  lockHoldSecs: number | null;
  lockAcquireEpoch: number | null;
  lockReleaseEpoch: number | null;
  /** suite end epoch (sec), only when the suite actually ran. */
  suiteFinishedEpoch: number | null;
  /** suite three-state outcome ("done" | "red" | "hung"), only when it ran. */
  suiteOutcome: string | null;
  /** suite child pid (AC3 ppid probe input), only when it ran. */
  suitePid: number | null;
  /** landed sha (develop tip after ff); null when red. */
  landedSha: string | null;
  /** suite process log file name (`.quay/fan-in-suite-<task>~<runId>~<ts>-<hash>.log` basename) —
   *  the step="suite" failure's full output carrier. On disk since the mechanical fan-in landed, but
   *  NOT parsed until gap-needs-human-raw-fan-in-reason-observation-surface: the field was written
   *  (driver-filters.test.mjs's own fixture carries it) and read by nobody, so the one artifact that
   *  says WHAT the suite failed on was invisible to every observation surface. null when absent. */
  suiteLog: string | null;
  /** fan-in process log file name (`.quay/fan-in-<task>-<runId>.log` basename) — the Runs block's
   *  view/download link key. null when absent. */
  fanInLog: string | null;
}

/** The full outcome record the worker-driver writes (computeOutcome's 14 fields + the
 *  gap-worker-task-transcript-access-webui `session_id` that lands later). Unknown/missing fields
 *  degrade to null rather than a fabricated reading (hard rule ③b) — the carrier is a best-effort
 *  runtime log, so a missing `worker_pid`/`exit_code` must read as null, never as a fake 0. */
export interface WorkerOutcomeRecord {
  /** ISO-8601 UTC write time (the carrier's `ts`). */
  ts: string | null;
  task: string | null;
  selector_reason: string | null;
  /** Process exit code (null on signal / spawn-failed / timed-out). */
  exit_code: number | null;
  /** Termination signal (null unless killed). */
  signal: string | null;
  /** Wall-clock duration of the worker run, ms. */
  wall_clock_ms: number | null;
  /** Terminal state: completed | exited-not-landed | failed | killed | timed-out | spawn-failed | not-dispatched. */
  final_state: string | null;
  failure_reason: string | null;
  /** ISO-8601 UTC worker-run start (the carrier's `started_at`). */
  started_at: string | null;
  /** ISO-8601 UTC worker-run end (the carrier's `ended_at`). */
  ended_at: string | null;
  worker_pid: number | null;
  run_id: string | null;
  in_flight_count: number | null;
  timed_out: boolean | null;
  /** Transcript session id — written by gap-worker-task-transcript-access-webui (not yet on disk).
   *  Parses to null until that lands, so a Runs block can link the transcript with zero
   *  re-implementation (this task reuses that task's read+validation, hard rule ③b / AC3). */
  session_id: string | null;
  /** Mechanical fan-in terminal state (gap-mech-fan-in-log-webui-visible-clickable B1); null when the
   *  record predates mechanical fan-in or the driver didn't run it. */
  mechanical_fan_in: MechanicalFanInRecord | null;
}

/** Parse the driver's `mechanical_fan_in` sub-object into a MechanicalFanInRecord. Pure — a non-object
 *  / malformed value degrades to null (best-effort runtime log, never a fabricated reading — hard rule ③b). */
export function parseMechanicalFanIn(v: unknown): MechanicalFanInRecord | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const j = v as Record<string, unknown>;
  const str = (x: unknown): string | null => (typeof x === "string" && x.length > 0 ? x : null);
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    outcome: str(j.outcome),
    step: str(j.step),
    reason: str(j.reason),
    lockHoldSecs: num(j.lockHoldSecs),
    lockAcquireEpoch: num(j.lockAcquireEpoch),
    lockReleaseEpoch: num(j.lockReleaseEpoch),
    suiteFinishedEpoch: num(j.suiteFinishedEpoch),
    suiteOutcome: str(j.suiteOutcome),
    suitePid: num(j.suitePid),
    landedSha: str(j.landedSha),
    suiteLog: str(j.suiteLog),
    fanInLog: str(j.fanInLog),
  };
}

/** A parsed carrier + the line accounting that makes "read it all" distinguishable from "read some
 *  of it". `malformedLines` is ENUMERATED rather than folded into a boolean — hard rule ③ (枚举，不布尔):
 *  a boolean `ok` would make "every line parsed" and "3 of 400 lines were unreadable" the same value. */
export interface ParsedWorkerOutcomes {
  records: WorkerOutcomeRecord[];
  /** Non-blank lines seen (the parse input size). */
  totalLines: number;
  /** Lines that carried data but could not be read as a JSON object. */
  malformedLines: number;
}

/** Parse `.quay/worker-outcome.jsonl` (one JSON object per line) into outcome records, WITH the line
 *  accounting. Pure — never throws; a malformed line is skipped (best-effort runtime log, not a store).
 *  Reads every field the driver writes (computeOutcome's 14) rather than a hand-picked subset —
 *  `worker_pid` was on disk but dropped by the old 4-field parse (gap-webui-task-runs-block AC2).
 *
 *  ⚠️ A line that parses to a NON-OBJECT (a bare `5` / `"x"` / `[]` straight into JSON.parse) counts
 *  as malformed rather than being pushed as an all-null record: the old shape fabricated a record with
 *  16 null fields out of a line that carried no record at all, which is exactly the 硬规则 3b form
 *  (「读不懂」伪装成「读到了一个空记录」). */
export function parseWorkerOutcomeRecordsDetailed(text: string): ParsedWorkerOutcomes {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const out: WorkerOutcomeRecord[] = [];
  let totalLines = 0;
  let malformedLines = 0;
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    totalLines++;
    let j: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) { malformedLines++; continue; }
      j = parsed as Record<string, unknown>;
    } catch { malformedLines++; continue; }
    out.push({
      ts: str(j.ts),
      task: str(j.task),
      selector_reason: str(j.selector_reason),
      exit_code: num(j.exit_code),
      signal: str(j.signal),
      wall_clock_ms: num(j.wall_clock_ms),
      final_state: str(j.final_state),
      failure_reason: str(j.failure_reason),
      started_at: str(j.started_at),
      ended_at: str(j.ended_at),
      worker_pid: num(j.worker_pid),
      run_id: str(j.run_id),
      in_flight_count: num(j.in_flight_count),
      timed_out: bool(j.timed_out),
      session_id: str(j.session_id),
      mechanical_fan_in: parseMechanicalFanIn(j.mechanical_fan_in),
    });
  }
  return { records: out, totalLines, malformedLines };
}

/** Parse `.quay/worker-outcome.jsonl` into outcome records (no line accounting). Pure — see
 *  `parseWorkerOutcomeRecordsDetailed`, which this delegates to (⛔ one parser, two views — hard rule 5b). */
export function parseWorkerOutcomeRecords(text: string): WorkerOutcomeRecord[] {
  return parseWorkerOutcomeRecordsDetailed(text).records;
}

/**
 * A task's latest worker outcome is "open" (still in play). For the worker-driver this is NEVER true
 * from the outcome carrier alone: the carrier is written only at worker END, so every `final_state`
 * is terminal — completed | exited-not-landed | failed | killed | timed-out | spawn-failed |
 * not-dispatched. A worker whose process is STILL RUNNING has no outcome record yet (方向二 surfaces
 * those via the /proc process signal instead). gap-live-page-worker-inflight-bidirectional-error
 * 方向一: the old list excluded only completed/spawn-failed/not-dispatched, leaving exited-not-landed
 * / failed / killed / timed-out misjudged as in-flight (a destroyed worker shown as 实现中 forever).
 * Whitelist, fail-closed (hard rule ③b): no terminal state is open, and a null / unknown state is
 * NOT open either — never a fabricated "open" from an unreadable field.
 */
function workerOutcomeOpen(_finalState: string | null): boolean {
  return false;
}

/**
 * Derive the worker-driver's in-flight set from its outcome carrier: for each task, keep its LATEST
 * record (most-recent `started_at`) and surface it as in-flight iff that record is open. After
 * gap-live-page-worker-inflight-bidirectional-error 方向一 every `final_state` is terminal, so this
 * set is now ALWAYS empty — the outcome carrier is written only at worker END and cannot signal a
 * still-running worker. The live in-flight set comes from the /proc process signal
 * (readLiveWorkerProcesses) instead; this function stays as the pure outcome-carrier reader (and its
 * shape stays pairInFlight-compatible). Pure and /proc-free.
 */
export function workerInFlightTasks(records: WorkerOutcomeRecord[], nowMs: number): InFlightTask[] {
  const latest = new Map<string, WorkerOutcomeRecord & { startedMs: number }>();
  for (const r of records) {
    if (!r.task) continue;
    const startedMs = r.started_at != null ? Date.parse(r.started_at) : NaN;
    if (!Number.isFinite(startedMs)) continue;
    const prev = latest.get(r.task);
    if (!prev || startedMs >= prev.startedMs) latest.set(r.task, { ...r, startedMs });
  }
  const out: InFlightTask[] = [];
  for (const [task, r] of latest) {
    if (!workerOutcomeOpen(r.final_state)) continue;
    out.push({
      taskId: task,
      runId: r.run_id ?? `worker-${task}`,
      pid: null, // outcome-carrier task: no live process known (written only at worker END)
      sessionId: null, // outcome-carrier task: no live process ⇒ no live session join (readLive annotates)
      startedAtMs: r.startedMs,
      implCompletedAtMs: null,
      status: null,
      phase: "implementing",
      suite: null,
      minutes: Math.max(0, (nowMs - r.startedMs) / 60_000),
      liveness: "unknown",
      blocks: [],
      blockedBy: [],
    });
  }
  return out;
}

/** The three-state result of reading a `.quay/` carrier's TEXT: `absent` (no such file — a real
 *  "nothing was ever written here") is a DIFFERENT value from `unreadable` (the file is there but
 *  could not be read), and neither may be shaped like a successful empty read (硬规则 3b — a
 *  boolean "could I read it" would collapse both into the same false). */
export type CarrierTextStatus = "ok" | "absent" | "unreadable";

export interface CarrierText {
  status: CarrierTextStatus;
  text: string | null;
  /** Why the read failed (null for ok/absent) — carried so the caller can say WHAT was wrong. */
  reason: string | null;
}

/** Read a `<root>/<rel>` carrier as text, KEEPING the absent-vs-unreadable distinction. */
export function readCarrierText(root: string, rel: string): CarrierText {
  try {
    return { status: "ok", text: fs.readFileSync(path.join(root, rel), "utf8"), reason: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return { status: "absent", text: null, reason: null };
    return { status: "unreadable", text: null, reason: (err as Error)?.message ?? String(err) };
  }
}

/** Read `.quay/worker-outcome.jsonl` as text. Absent/unreadable ⇒ null (degrade, never throw). The
 *  distinction is dropped HERE on purpose (this is the pre-existing lossy view); callers that must
 *  tell the two apart use `readCarrierText`/`readFanInAttempts`. */
function readWorkerOutcomeText(root: string): string | null {
  return readCarrierText(root, WORKER_OUTCOME_REL).text;
}

/** Read + parse all worker-outcome records for a workspace root (the /task/<id> Runs block's data
 *  source — gap-webui-task-runs-block). Absent/unreadable ⇒ [] (degrade, never throw). */
export function readWorkerOutcomeRecords(root: string): WorkerOutcomeRecord[] {
  const text = readWorkerOutcomeText(root);
  return text != null ? parseWorkerOutcomeRecords(text) : [];
}

// ── the fan-in attempt reader (gap-needs-human-raw-fan-in-reason-observation-surface) ───────────
//
// THE GAP THIS CLOSES (人 2026-09-20 逐字): 「driver 当然应当记录相应的日志，人类观测面（如 quay
// cli/mcp/web）也应提供这些日志的访问。」 The driver already writes one record per attempt into
// `.quay/worker-outcome.jsonl` (2295 records on the live store, 978 carrying `mechanical_fan_in`),
// but only ONE observation surface read it (web `/task/<id>`'s Runs block); CLI and MCP had no entry
// point at all, and `/needs-human` showed only the 阻碍原因 prose the promotion-driver pasted into
// the task body. An operator looking at a needs-human task could not see WHICH STEP each attempt died
// on, or the raw failure text.
//
// ⛔ NO CLASSIFICATION, NO INTERPRETATION (same ruling): the enum of "causes" is unreliable for an
// exception, so this reader surfaces the RAW text and nothing else. `step`/`reason`/`suiteLog`/
// `fanInLog` are lifted verbatim from the record; `reason` is NEVER truncated here — truncation is a
// rendering decision and belongs to whoever renders (a reader that cut the text would make the CLI/MCP
// surfaces permanently lossy for a caller that wants the whole line).

/** One worker attempt, as the human observation surface needs it. A SUPERSET of the 8 fields the
 *  proposal names: `extends WorkerOutcomeRecord` so an existing consumer that wants the full record
 *  (the /task/<id> Runs block's fan-in cell) can take the same object rather than re-reading the
 *  carrier — ⛔ one reader, not two (硬规则 5b). The lifted `outcome`/`step`/`reason`/`suiteLog`/
 *  `fanInLog` are the `mechanical_fan_in` sub-object's own values, promoted so a caller that only
 *  wants the failure原文 does not have to know the nesting. All of them are null when the record
 *  predates mechanical fan-in — the honest "not recorded", never a fabricated value. */
export interface FanInAttempt extends WorkerOutcomeRecord {
  /** `mechanical_fan_in.outcome` — "landed" | "red" (null when the attempt never reached fan-in). */
  outcome: string | null;
  /** `mechanical_fan_in.step` — the first FAILING step name; null when landed / never reached. */
  step: string | null;
  /** `mechanical_fan_in.reason` — the failure原文, verbatim and untruncated. */
  reason: string | null;
  /** `mechanical_fan_in.suiteLog` — the suite step's full-output log file basename (step="suite"). */
  suiteLog: string | null;
  /** `mechanical_fan_in.fanInLog` — the fan-in process log file basename. */
  fanInLog: string | null;
}

/** The three-state outcome of reading the attempt carrier — NOT a boolean and NOT an array length.
 *  `carrier-absent` (this workspace never ran a worker → a real "no attempts") is a different value
 *  from `carrier-unreadable` (attempts exist but cannot be read right now) and from
 *  `malformed-lines` (read, but not all of it parsed). Hard rule 3b: 「读不出」 must be readable as
 *  itself, never as 「这里没有」. */
export type FanInAttemptsStatus = "ok" | "carrier-absent" | "carrier-unreadable" | "malformed-lines";

export interface FanInAttemptsResult {
  status: FanInAttemptsStatus;
  /** Why the carrier could not be read in full (null for `ok`/`carrier-absent`) — a sentence the
   *  caller can render, never a bare flag. */
  reason: string | null;
  /** The carrier path this result is ABOUT, repo-relative (data, so a caller need not hardcode it). */
  carrier: string;
  /** Non-blank lines seen (0 when the carrier was absent/unreadable). */
  totalLines: number;
  /** Lines that carried data but could not be read as a JSON object (enumerated — hard rule ③). */
  malformedLines: number;
  /** The attempts, in carrier order (oldest → newest). */
  attempts: FanInAttempt[];
}

/** Project a parsed outcome record onto the attempt view. Pure. */
export function fanInAttemptFromRecord(r: WorkerOutcomeRecord): FanInAttempt {
  const mfi = r.mechanical_fan_in;
  return {
    ...r,
    outcome: mfi?.outcome ?? null,
    step: mfi?.step ?? null,
    reason: mfi?.reason ?? null,
    suiteLog: mfi?.suiteLog ?? null,
    fanInLog: mfi?.fanInLog ?? null,
  };
}

/**
 * The ONE reader behind web / CLI / MCP (⛔ the three surfaces must not each write their own parse).
 *
 * `taskId` filters to one task's attempts (null = every task); `limit` keeps the most recent N of the
 * selected set (null = all). The returned `attempts` are in carrier order (oldest → newest) — a
 * `limit` therefore trims the OLD end, the natural "tail" reading of a runtime log.
 *
 * Degradation is explicit, never silent: an absent carrier answers `carrier-absent` (this workspace
 * ran no worker — correct and distinguishable), an existing-but-unreadable one answers
 * `carrier-unreadable` WITH the underlying error, and a partially-parsed one answers
 * `malformed-lines` with the count. Only `ok` means "every line was read".
 */
export function readFanInAttempts(
  root: string,
  { taskId = null, limit = null }: { taskId?: string | null; limit?: number | null } = {},
): FanInAttemptsResult {
  const base = { carrier: WORKER_OUTCOME_REL, totalLines: 0, malformedLines: 0, attempts: [] as FanInAttempt[] };
  const carrier = readCarrierText(root, WORKER_OUTCOME_REL);
  if (carrier.status !== "ok") {
    return {
      ...base,
      status: carrier.status === "absent" ? "carrier-absent" : "carrier-unreadable",
      reason: carrier.status === "absent"
        ? null
        : `${WORKER_OUTCOME_REL} could not be read: ${carrier.reason ?? "unknown error"}`,
    };
  }
  const parsed = parseWorkerOutcomeRecordsDetailed(carrier.text as string);
  let attempts = parsed.records.map(fanInAttemptFromRecord);
  if (taskId != null) attempts = attempts.filter((a) => a.task === taskId);
  if (limit != null && Number.isFinite(limit) && limit >= 0 && attempts.length > limit) {
    attempts = attempts.slice(attempts.length - limit);
  }
  return {
    ...base,
    status: parsed.malformedLines > 0 ? "malformed-lines" : "ok",
    reason: parsed.malformedLines > 0
      ? `${parsed.malformedLines} of ${parsed.totalLines} line(s) in ${WORKER_OUTCOME_REL} could not be parsed as a JSON record`
      : null,
    totalLines: parsed.totalLines,
    malformedLines: parsed.malformedLines,
    attempts,
  };
}

/** A task the worker-driver's round carrier names in-flight, with its dispatch start (when known). */
interface RoundInFlightTask {
  taskId: string;
  /** Dispatch wall-clock ms, read from `in_flight_task_starts`. null when the round carries no start
   *  for this task (unknown ⇒ the caller falls back to the observation instant — never a fabricated
   *  long elapsed). */
  startedAtMs: number | null;
}

/**
 * The tasks the worker-driver's LATEST round record considers in-flight (`in_flight_tasks`:
 * implementing + mechanical-fan-in + cold-start-inflight), each with its dispatch start when the
 * round carries one (`in_flight_task_starts` — gap-live-fan-in-window-elapsed-zero: the round carrier
 * previously named only the task id, no per-task start, so readLive fell back to nowMs and the
 * fan-in window read as elapsed 0). This is the ONLY carrier that names the specific task during the
 * mechanical fan-in window — the worker process has exited (no /proc), no outcome record yet (written
 * at `finish()`, AFTER `runMechanicalFanIn`), and the driver never writes workflow-events task-start.
 * gap-live-mechanical-fan-in-inflight-invisible. Absent/unreadable round file, or a round record
 * predating the field, ⇒ [] (degrade, never throw — a real "none", not a fabricated empty). Iterates
 * every line and keeps the LAST `in_flight_tasks` array (append-order ⇒ newest wins, so a stale earlier
 * snapshot is superseded). A missing/ill-formed start for a task ⇒ startedAtMs null (honest unknown,
 * not a fabricated value).
 */
export function readWorkerRoundInFlightTasks(root: string, preReadRoundText?: string | null): RoundInFlightTask[] {
  try {
    // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: the round carrier is 11.7 MB on the live
    // store; readLive already holds its text (it passes the same value to workerDriverOnlineMs), so it
    // hands it in rather than making this read it a second time. Omitted ⇒ read from disk, unchanged.
    const roundText = preReadRoundText !== undefined ? preReadRoundText : fs.readFileSync(path.join(root, WORKER_ROUND_REL), "utf8");
    if (roundText == null) return [];
    let tasks: RoundInFlightTask[] = [];
    for (const line of String(roundText).split("\n")) {
      const s = line.trim();
      if (!s) continue;
      let j: Record<string, unknown>;
      try { j = JSON.parse(s) as Record<string, unknown>; } catch { continue; }
      const arr = j.in_flight_tasks;
      if (!Array.isArray(arr)) continue;
      const starts = j.in_flight_task_starts;
      tasks = arr
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .map((taskId) => {
          let startedAtMs: number | null = null;
          if (starts != null && typeof starts === "object" && !Array.isArray(starts)) {
            const raw = (starts as Record<string, unknown>)[taskId];
            if (typeof raw === "number" && Number.isFinite(raw)) {
              startedAtMs = raw;
            } else if (typeof raw === "string") {
              const parsed = Date.parse(raw);
              if (Number.isFinite(parsed)) startedAtMs = parsed;
            }
          }
          return { taskId, startedAtMs };
        });
    }
    return tasks;
  } catch {
    return [];
  }
}
