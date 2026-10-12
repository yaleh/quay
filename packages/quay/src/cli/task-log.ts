// cli/task-log.ts — the READ surface for the task-status transition carrier:
//   `quay task log   [--since <ISO8601|cursor>] [--until <ISO8601>] [--limit <n≤500>] [--json] [--root <path>]`
//   `quay task trace <task-id> [--json] [--root <path>]`
//
// WHY (tasks/gap-quay-task-log-trace-read-surface): consumers need a SUPPORTED read surface over
// `.quay/task-status-events.jsonl`, not a parse of the raw file. The named consumers are
// ClaudeCodeUI's `changes` feed (whose proposal, docs/proposals/cloudcli-mcp-control-observability-
// 2026-10.md §4 2b′, asks for exactly these two verbs in the `task list --json` family) and Quay's own
// semantic discovery loop. Neither may read the file directly: the carrier's contract (paging,
// cursor, epoch, dedup, coverage) lives HERE, and a second reader would be a second contract.
//
// ⛔ READ-ONLY, ZERO MODEL CALLS. This module never writes a carrier, never promotes/dispatches and
// creates no state — even the epoch sidecar, which `appendTaskStatusEvent` creates under its write
// lock, is READ through `readCarrierEpoch` (a read verb must not materialize the thing it reads).
//
// ── THE CONTRACT SHAPE (the same text is in `--help`, so a cross-project acceptance can pin it) ──
//
//   {
//     "transitions": [ { order, schema, seq, eventId, carrierEpoch, taskId, from, to, kind, at,
//                        recordedAt, actor, evidence, reason?, source, inferred, commit } ],
//     "nextCursor": { "v": 1, "carrierEpoch": "<epoch>", "seq": <carrier position of the last delivered event> },
//     "complete": false,
//     "coverage": { ... },
//     "generatedAt": "<ISO>",
//     "rebase": false,
//     "rebaseReason": null
//   }
//
// ── THE FOUR GUARANTEES (each one is a decision that had a cheaper wrong answer) ─────────────────
//
// 1. AT-LEAST-ONCE, dedupe by `eventId`. `nextCursor.seq` names the LAST DELIVERED event, and a
//    resumed cursor is read INCLUSIVE of it — so a consumer that crashes between "read a page" and
//    "commit the processing" gets that boundary event again rather than losing it. The cost is one
//    duplicated event per resume, which is exactly the trade the contract takes (lossless > unique);
//    `eventId` is the documented dedup key. A consumer that only needs exactly-once paging passes
//    each page's `nextCursor` straight back and drops the repeat by `eventId`.
//
// 2. NO SILENT SKIP ACROSS A ROTATION. A cursor names the epoch it was taken under. When the carrier
//    has rotated (a new epoch — the sidecar is created by the first v1 write, and any future rotation
//    bumps it), the cursor CANNOT be honoured; the read reports `rebase: true` with the reason and
//    replays from the beginning of the CURRENT epoch. The wrong answer — treating an unreadable
//    cursor as "start at 0 and say nothing" — would make a rotation indistinguishable from "nothing
//    happened", the 硬规则 3b failure this field exists to prevent.
//
// 3. COVERAGE IS ENUMERATED, not boolean (硬规则 3). `complete: true` requires all three of: the page
//    reached the end of what it was reading, every IN-SCOPE writer class is wired, and the reconcile
//    watermark is current. Otherwise `complete: false` and `coverage.reasons` names every unmet
//    condition — including the writer classes that write statuses WITHOUT appending an event (today:
//    the CLI and MCP Provider-ABI paths). A consumer must be able to tell "nothing happened" from
//    "this class of change is invisible here".
//
// 4. A TRANSITION'S `source` IS NEVER A COMMIT SUBJECT. `source: "task-status-events"` for an event a
//    live writer appended; `source: "git"` + `inferred: true` for one the reconcile pass derived from
//    the status-line diff a commit carries. A commit MESSAGE is a claim, not a positional reading
//    (硬规则 2), so it is never consulted.

import {
  PRE_EPOCH,
  TASK_STATUS_EVENT_WRITER_CLASSES,
  readCarrierEpoch,
  readTaskStatusTransitions,
  type TaskStatusEventCarrier,
  type TaskStatusEventWriterClass,
  type TaskStatusTransitionView,
} from "../kernel/task-transition.ts";
import { resolveRoot } from "../driver-control.ts";
import { printJson, withProvider } from "./shared.ts";
import type { CliCtx } from "./context.ts";

/** The maximum page a caller may ask for — a bound on this verb's own output, not a policy. */
export const MAX_TASK_LOG_LIMIT = 500;
/** The page size when `--limit` is absent (the whole carrier for every carrier this repo has). */
export const DEFAULT_TASK_LOG_LIMIT = 500;

/** The opaque resume token. `seq` is the CARRIER POSITION of the last delivered event; on an
 *  append-only carrier that position equals a v1 record's `seq` (⛔ v1 never truncates), and a v0
 *  record — which has no `seq` — still has exactly one position. */
export interface TaskLogCursor {
  v: 1;
  carrierEpoch: string;
  seq: number;
}

export interface TaskLogWriterClassView {
  id: string;
  wired: boolean;
  inScope: boolean;
  callSites: readonly string[];
  reason?: string;
}

export interface TaskLogCoverage {
  carrier: {
    path: string;
    /** ⛔ An ABSENT carrier is not an empty one that was read (硬规则 3) — this is the field that
     *  keeps the two apart; `complete` is false when it is false. */
    exists: boolean;
    epoch: string;
    lines: number;
    v0: number;
    v1: number;
    corrupt: number;
  };
  writerClasses: TaskLogWriterClassView[];
  /** The declared classes that are IN SCOPE and NOT wired — the enumerated reason a page cannot be
   *  complete. A bare boolean here would hide WHICH class is missing. */
  unwiredInScope: string[];
  reconcile: {
    /** The ref a reconcile pass reads (the authority for git-evidenced transitions). */
    ref: string;
    /** The newest reconcile-inferred event: the last git-evidenced transition the carrier knows was
     *  reconciled. `null` when no inferred event exists. */
    watermark: { commit: string | null; at: string } | null;
    /** The newest LIVE-written transition time, or null. */
    newestWrittenAt: string | null;
    state: "current" | "lagging" | "not-run" | "not-evaluated";
    reason: string;
  };
  reasons: string[];
}

export interface TaskLogDocument {
  transitions: TaskStatusTransitionView[];
  nextCursor: TaskLogCursor | null;
  complete: boolean;
  coverage: TaskLogCoverage;
  generatedAt: string;
  /** true iff a supplied cursor could not be honoured (an epoch mismatch) and the read restarted at
   *  the beginning of the current epoch. */
  rebase: boolean;
  rebaseReason: string | null;
}

export interface TaskTraceDocument {
  taskId: string;
  /** The task's CURRENT status, read through the Provider ABI (the provider is the authority on a
   *  task's status — ⛔ never the last carrier event, which is exactly the quantity the coverage
   *  block warns may be incomplete). `null` is unreachable: a task that does not resolve is a
   *  not-found exit, never an empty success. */
  status: string;
  transitions: TaskStatusTransitionView[];
  generatedAt: string;
  coverage: TaskLogCoverage;
}

// ── coverage ─────────────────────────────────────────────────────────────────────────────────────

export interface CoverageInput {
  ref: string;
  carrier: TaskStatusEventCarrier;
  transitions: TaskStatusTransitionView[];
  corrupt: number;
  epoch: string;
  writerClasses: readonly TaskStatusEventWriterClass[];
}

/** The newest `at` among `views`, or null when none carries one (⛔ never "now"). */
function newestAt(views: TaskStatusTransitionView[]): string | null {
  let newest: string | null = null;
  for (const v of views) {
    if (v.at === null) continue;
    if (newest === null || v.at > newest) newest = v.at;
  }
  return newest;
}

/**
 * Enumerate the page's coverage. PURE w.r.t. the carrier (every input is a reading taken by the
 * caller), so a test can supply an all-wired registry and reach `complete: true` — the negative
 * control that proves `complete` is a measurement rather than a constant.
 */
export function computeCoverage(input: CoverageInput): TaskLogCoverage {
  const { carrier, transitions, corrupt, epoch, writerClasses, ref } = input;
  const writerClassesView: TaskLogWriterClassView[] = writerClasses.map((c) => ({
    id: c.id,
    wired: c.wired,
    inScope: c.inScope,
    callSites: [...c.callSites],
    ...(c.reason !== undefined ? { reason: c.reason } : {}),
  }));
  const unwiredInScope = writerClasses.filter((c) => c.inScope && !c.wired).map((c) => c.id);
  const v0 = transitions.filter((t) => t.schema === "v0").length;
  const v1 = transitions.filter((t) => t.schema === "v1").length;

  // ── the reconcile watermark, derived from the CARRIER (the reconcile pass owns no state of its
  //    own — see the kernel's own note; so what CAN be read is the newest transition it appended).
  const inferred = transitions.filter((t) => t.schema === "v1" && t.inferred);
  const written = transitions.filter((t) => t.schema === "v1" && !t.inferred);
  const newestWrittenAt = newestAt(written);
  let reconcile: TaskLogCoverage["reconcile"];
  if (inferred.length === 0) {
    reconcile = {
      ref,
      watermark: null,
      newestWrittenAt,
      state: "not-run",
      reason:
        `no reconcile-inferred event is present — either no reconcile pass has run against ${ref}, or one ran and found no gap. ` +
        `The carrier alone cannot tell these apart (硬规则 3b), so this is reported as not-run rather than as "current".`,
    };
  } else {
    const stamped = inferred.filter((t) => t.at !== null);
    if (stamped.length === 0) {
      reconcile = {
        ref,
        watermark: null,
        newestWrittenAt,
        state: "not-evaluated",
        reason: "reconcile-inferred events are present but none carries an `at` — the watermark position cannot be read",
      };
    } else {
      let wm = stamped[0];
      for (const t of stamped) if (t.at !== null && wm.at !== null && t.at > wm.at) wm = t;
      const watermark = { commit: wm.commit, at: wm.at as string };
      const lagging = newestWrittenAt !== null && watermark.at < newestWrittenAt;
      reconcile = {
        ref,
        watermark,
        newestWrittenAt,
        state: lagging ? "lagging" : "current",
        reason: lagging
          ? `the newest reconcile-inferred transition (${watermark.at}) is older than the newest live-written transition (${newestWrittenAt}) — ` +
            `a status flip landed after the last reconcile pass, so git-evidenced transitions after ${watermark.at} may be missing`
          : `the newest reconcile-inferred transition (${watermark.at}) is not older than the newest live-written transition` +
            (newestWrittenAt === null ? " (there is none)" : ` (${newestWrittenAt})`),
      };
    }
  }

  const reasons: string[] = [];
  if (!carrier.exists) {
    reasons.push(`the carrier ${carrier.path} does not exist — an ABSENT carrier is not an empty one that was read (硬规则 3)`);
  }
  if (corrupt > 0) {
    reasons.push(`${corrupt} corrupt carrier line(s) were counted and skipped — they are neither v0 nor v1 records`);
  }
  for (const c of writerClasses) {
    if (c.inScope && !c.wired) {
      reasons.push(`writer class "${c.id}" is IN SCOPE but not wired: ${c.reason ?? "(no reason declared — a bare wired:false is a defect)"}`);
    }
  }
  if (reconcile.state !== "current") reasons.push(`reconcile is not current (${reconcile.state}): ${reconcile.reason}`);

  return {
    carrier: {
      path: carrier.path,
      exists: carrier.exists,
      epoch,
      lines: transitions.length + corrupt,
      v0,
      v1,
      corrupt,
    },
    writerClasses: writerClassesView,
    unwiredInScope,
    reconcile,
    reasons,
  };
}

// ── the `--since` argument: an ISO instant OR a cursor ───────────────────────────────────────────

export type SinceArg =
  | { kind: "none" }
  | { kind: "iso"; iso: string }
  | { kind: "cursor"; cursor: TaskLogCursor }
  | { kind: "error"; reason: string };

/**
 * Classify `--since`. A value that LOOKS like a cursor (leading `{`) must BE a valid one — a
 * malformed cursor is a usage error, never silently re-read as an ISO timestamp (which would replay
 * from a position nobody asked for). Anything else must be a parseable ISO instant.
 */
export function parseSinceArg(raw: string | null | undefined): SinceArg {
  if (raw === null || raw === undefined) return { kind: "none" };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      return { kind: "error", reason: `--since looks like a cursor but is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "error", reason: "--since cursor must be a JSON object {v, carrierEpoch, seq}" };
    }
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1) return { kind: "error", reason: `--since cursor must carry v: 1 (got ${JSON.stringify(o.v)})` };
    if (typeof o.carrierEpoch !== "string" || o.carrierEpoch.length === 0) {
      return { kind: "error", reason: "--since cursor must carry a non-empty carrierEpoch string" };
    }
    if (typeof o.seq !== "number" || !Number.isInteger(o.seq) || o.seq < 0) {
      return { kind: "error", reason: "--since cursor must carry a non-negative integer seq" };
    }
    return { kind: "cursor", cursor: { v: 1, carrierEpoch: o.carrierEpoch, seq: o.seq } };
  }
  if (Number.isNaN(Date.parse(trimmed))) {
    return { kind: "error", reason: `--since ${JSON.stringify(raw)} is neither a parseable ISO-8601 instant nor a cursor` };
  }
  return { kind: "iso", iso: trimmed };
}

export type LimitArg = { ok: true; limit: number } | { ok: false; reason: string };

/** `--limit` must be an integer in [1, MAX_TASK_LOG_LIMIT]; anything else is a usage error, never a
 *  silent fall-back to the default (UQ-048's rule, applied here). */
export function resolveTaskLogLimit(raw: unknown): LimitArg {
  if (raw === undefined || raw === true) {
    return raw === true
      ? { ok: false, reason: `--limit requires a value (a positive integer ≤ ${MAX_TASK_LOG_LIMIT})` }
      : { ok: true, limit: DEFAULT_TASK_LOG_LIMIT };
  }
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (typeof raw !== "string" || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, reason: `--limit requires a positive integer (got ${JSON.stringify(raw)})` };
  }
  if (n > MAX_TASK_LOG_LIMIT) {
    return { ok: false, reason: `--limit must be ≤ ${MAX_TASK_LOG_LIMIT} (got ${n}) — page instead of asking for the whole carrier` };
  }
  return { ok: true, limit: n };
}

// ── the reader ───────────────────────────────────────────────────────────────────────────────────

export interface TaskLogOptions {
  since?: string | null;
  until?: string | null;
  limit?: number;
  nowMs?: number;
  /** Test/extension seam: the writer-class registry. Defaults to the kernel declaration. A caller
   *  that supplies an all-wired registry can reach `complete: true` — see the kernel block comment. */
  writerClasses?: readonly TaskStatusEventWriterClass[];
  /** The ref a reconcile pass would read (reported in `coverage.reconcile.ref`). */
  ref?: string;
}

export type TaskLogReading = { ok: true; document: TaskLogDocument } | { ok: false; reason: string };

/**
 * Read one page of the transition carrier. PURE w.r.t. the clock when `nowMs` is passed (the tests
 * pin it); it NEVER writes — the epoch is read, not created.
 */
export function readTaskLog(root: string, opts: TaskLogOptions = {}): TaskLogReading {
  const since = parseSinceArg(opts.since ?? null);
  if (since.kind === "error") return { ok: false, reason: `quay task log: ${since.reason}` };
  const untilRaw = opts.until ?? null;
  if (untilRaw !== null && Number.isNaN(Date.parse(untilRaw))) {
    return { ok: false, reason: `quay task log: --until ${JSON.stringify(untilRaw)} is not a parseable ISO-8601 instant` };
  }
  const limit = opts.limit ?? DEFAULT_TASK_LOG_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_TASK_LOG_LIMIT) {
    return { ok: false, reason: `quay task log: internal limit ${limit} out of range (1..${MAX_TASK_LOG_LIMIT})` };
  }

  const { carrier, transitions, corrupt } = readTaskStatusTransitions(root);
  const epoch = readCarrierEpoch(root);
  const writerClasses = opts.writerClasses ?? TASK_STATUS_EVENT_WRITER_CLASSES;
  const ref = opts.ref ?? "develop";
  const coverage = computeCoverage({ ref, carrier, transitions, corrupt, epoch, writerClasses });

  // ── the cursor: honour it, or REBASE with a reason (⛔ never a silent skip) ──
  let rebase = false;
  let rebaseReason: string | null = null;
  let fromOrder = 0;
  let iso: string | null = null;
  if (since.kind === "cursor") {
    if (since.cursor.carrierEpoch !== epoch) {
      rebase = true;
      rebaseReason =
        `cursor carrierEpoch ${JSON.stringify(since.cursor.carrierEpoch)} does not match the carrier's current epoch ${JSON.stringify(epoch)} — ` +
        `the cursor cannot be honoured; replaying from the beginning of the current epoch. ` +
        `${PRE_EPOCH === since.cursor.carrierEpoch || PRE_EPOCH === epoch ? "(A carrier whose epoch is " + JSON.stringify(PRE_EPOCH) + " is one with no epoch sidecar and no v1 record — the first v1 append rotates it.)" : ""}`;
    } else {
      fromOrder = since.cursor.seq;
    }
  } else if (since.kind === "iso") {
    iso = since.iso;
  }

  let selected = transitions.filter((t) => t.order >= fromOrder);
  if (iso !== null) selected = selected.filter((t) => t.at !== null && t.at >= iso);
  if (untilRaw !== null) selected = selected.filter((t) => t.at !== null && t.at <= untilRaw);

  const reachedEnd = selected.length <= limit;
  const page = selected.slice(0, limit);
  const last = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor: TaskLogCursor | null = last === null ? null : { v: 1, carrierEpoch: epoch, seq: last.order };

  const reasons = [...coverage.reasons];
  if (!reachedEnd) {
    reasons.push(
      `the page was truncated by --limit ${limit}: ${selected.length - page.length} more transition(s) matched. Follow nextCursor for the remainder.`,
    );
  }
  const complete = reachedEnd && coverage.carrier.exists && coverage.unwiredInScope.length === 0 && coverage.reconcile.state === "current";
  if (complete) reasons.length = 0;

  const nowMs = opts.nowMs ?? Date.now();
  return {
    ok: true,
    document: {
      transitions: page,
      nextCursor,
      complete,
      coverage: { ...coverage, reasons },
      generatedAt: new Date(nowMs).toISOString(),
      rebase,
      rebaseReason,
    },
  };
}

/** Read the transitions of ONE task, ordered by carrier position. */
export function readTaskTrace(
  root: string,
  taskId: string,
  status: string,
  opts: TaskLogOptions = {},
): TaskTraceDocument {
  const { carrier, transitions, corrupt } = readTaskStatusTransitions(root);
  const epoch = readCarrierEpoch(root);
  const coverage = computeCoverage({
    ref: opts.ref ?? "develop",
    carrier,
    transitions,
    corrupt,
    epoch,
    writerClasses: opts.writerClasses ?? TASK_STATUS_EVENT_WRITER_CLASSES,
  });
  const nowMs = opts.nowMs ?? Date.now();
  return {
    taskId,
    status,
    transitions: transitions.filter((t) => t.taskId === taskId),
    generatedAt: new Date(nowMs).toISOString(),
    coverage,
  };
}

// ── the CLI handlers ─────────────────────────────────────────────────────────────────────────────

/** Flags arrive as strings / true / arrays; this narrows the two we read into `string | null`. */
function stringFlag(v: unknown): string | null {
  if (typeof v === "string") return v;
  return null;
}

function resolveWorkspaceRootOrReport(verb: string, flags: Record<string, any>): string | null {
  if (flags.root !== undefined && typeof flags.root !== "string") {
    process.stderr.write(`quay ${verb}: --root requires a value (e.g., --root /path/to/workspace)\n`);
    return null;
  }
  const root = resolveRoot(typeof flags.root === "string" ? flags.root : undefined);
  if (root === null) {
    process.stderr.write(
      `quay ${verb}: no .quay/config.yml found (searched from ${flags.root ?? process.cwd()} upward). ` +
        `Run from a quay workspace root, or pass --root <workspace-root>.\n`,
    );
  }
  return root;
}

/** The human-readable page: one line per transition, oldest first. */
function renderLogTable(doc: TaskLogDocument): string {
  const lines = doc.transitions.map(
    (t) =>
      `${String(t.order).padStart(6)}  ${t.schema.padEnd(2)}  ${(t.eventId ?? "-").slice(0, 12).padEnd(12)}  ` +
      `${(t.taskId ?? "").padEnd(48)}  ${(t.from ?? "?").padEnd(11)}→${(t.to ?? "?").padEnd(11)}  ` +
      `${t.at ?? "-"}  ${t.source}${t.inferred ? " (inferred)" : ""}`,
  );
  const head = `transitions=${doc.transitions.length} complete=${doc.complete} rebase=${doc.rebase} epoch=${doc.coverage.carrier.epoch}`;
  const tail = doc.complete ? "" : `\nincomplete: ${doc.coverage.reasons.join(" | ")}`;
  return [`${head}`, ...lines, `nextCursor: ${doc.nextCursor === null ? "null" : JSON.stringify(doc.nextCursor)}${tail}`].join("\n");
}

export async function handleTaskLog(ctx: CliCtx): Promise<void> {
  const { flags, wantsJson } = ctx;
  const limit = resolveTaskLogLimit(flags.limit);
  if (!limit.ok) {
    process.stderr.write(`quay task log: ${limit.reason}\n`);
    process.exitCode = 1;
    return;
  }
  const root = resolveWorkspaceRootOrReport("task log", flags);
  if (root === null) {
    process.exitCode = 1;
    return;
  }
  const reading = readTaskLog(root, {
    since: stringFlag(flags.since),
    until: stringFlag(flags.until),
    limit: limit.limit,
  });
  if (!reading.ok) {
    process.stderr.write(`${reading.reason}\n`);
    process.exitCode = 1;
    return;
  }
  if (wantsJson) printJson(reading.document);
  else process.stdout.write(`${renderLogTable(reading.document)}\n`);
}

/** The exit code for a `trace` on a task the provider does not know: DISTINCT from 0 and from the
 *  usage error 1, so "no such task" can never be read as "a task with no transitions". */
export const TRACE_NOT_FOUND_EXIT = 3;

export async function handleTaskTrace(ctx: CliCtx): Promise<void> {
  const { positional, flags, wantsJson } = ctx;
  const taskId = positional[0];
  if (typeof taskId !== "string" || taskId.trim() === "") {
    process.stderr.write("quay task trace: <task-id> is required\n");
    process.exitCode = 1;
    return;
  }
  if (flags.root !== undefined && typeof flags.root !== "string") {
    process.stderr.write("quay task trace: --root requires a value (e.g., --root /path/to/workspace)\n");
    process.exitCode = 1;
    return;
  }
  await withProvider(
    async (client, cfg) => {
      const task = await client.taskGet(taskId);
      if (!task) {
        process.stderr.write(`quay task trace: no such task: ${taskId} (exit ${TRACE_NOT_FOUND_EXIT} — NOT an empty success)\n`);
        process.exitCode = TRACE_NOT_FOUND_EXIT;
        return;
      }
      const doc = readTaskTrace(cfg.workspaceRoot, taskId, String(task.status));
      if (wantsJson) printJson(doc);
      else {
        process.stdout.write(`${doc.taskId}: ${doc.status} — ${doc.transitions.length} transition(s)\n`);
        for (const t of doc.transitions) {
          process.stdout.write(
            `${String(t.order).padStart(6)}  ${t.from ?? "?"}→${t.to ?? "?"}  ${t.at ?? "-"}  ${t.source}${t.inferred ? " (inferred)" : ""}${t.commit ? ` @${t.commit.slice(0, 12)}` : ""}\n`,
          );
        }
        if (doc.coverage.reasons.length > 0) process.stdout.write(`incomplete: ${doc.coverage.reasons.join(" | ")}\n`);
      }
    },
    { providerId: flags.provider, root: typeof flags.root === "string" ? flags.root : undefined },
  );
}
