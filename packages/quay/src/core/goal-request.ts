// core/goal-request.ts — the GOAL REQUEST QUEUE (tasks/gap-goal-request-queue; GOAL-914 / AC-936).
//
// THE GAP THIS FILLS. Until now the goal layer could only VERIFY: every round it runs each active
// AC's criterion, flips status, and computes gaps. It had no way to answer the one question the
// layers above it actually have — 「请重新评估这条判据」 (manager / quay-fleet / a human). Without
// such a face the only options were (a) read the driver's internal state, or (b) hand-write the goal
// store. This module is the queue that makes the third option real:
//
//   submit (CLI `quay goal request <goal> <ac> --reason …`)
//      → append a `submitted` row to `<root>/.quay/goal-requests.jsonl`
//   consume (goal-driver, every round)
//      → re-run that AC's criterion through the EXISTING `gateCriterion`
//      → append ONE terminal row: accepted / refused / not-evaluated, carrying `consumedAt`
//
// ⛔ BOUNDARY (GOAL-914 非目标): a request does NOT change the gap classification, flip any status,
// file a task, or notify anyone. It asks for ONE re-evaluation and records the answer. The gap ring
// stays the gap ring.
//
// THE ROW SHAPES ARE AN EXTERNAL CONTRACT. AC-936's criterion reads `state` / `requestId` /
// `consumedAt` out of this carrier literally (≥1 terminal row, one terminal per requestId, every
// terminal row carries a non-empty `consumedAt`). ⛔ Renaming a field turns that criterion red.
//
// THREE STATES, ⛔ NEVER A BOOLEAN (硬规则 3b). The terminal vocabulary is
//   accepted       the criterion ran and PASSED
//   refused        the criterion ran and FAILED
//   not-evaluated  the criterion could not be run / read (the request is not "answered" — it is
//                  RECORDED AS UNANSWERABLE, which is a different thing from `refused`)
// and `readGoalRequestLedger` distinguishes "the ledger does not exist yet" (`readable:true`,
// `rows:[]` — a measurement) from "the ledger exists but cannot be read" (`readable:false` + a cause).
//
// IDEMPOTENCY. `requestId` is derived purely from (goal, ac, reason): `<goal>|<ac>|<sha256[0..16]>`.
// ⇒ the same request submitted twice is the SAME request: no second `submitted` row, and — via
// `settleGoalRequests` — never a second terminal row. A DIFFERENT reason is a different request (a
// caller who re-asks after new evidence has said something new).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** Carrier basename under `.quay/` (gitignored runtime carrier; declared in docs/carrier-registry.json). */
export const GOAL_REQUEST_BASENAME = "goal-requests.jsonl";
/** Carrier path relative to the workspace root (one construction point). */
export const GOAL_REQUEST_REL = path.join(".quay", GOAL_REQUEST_BASENAME);

/** `--reason` must carry at least this many NON-WHITESPACE characters. The same floor `dispatch-record`
 *  uses, and for the same reason: a reason of "ok"/"  " records that a decision was taken without
 *  recording WHY, and this queue exists precisely to carry the why. */
export const GOAL_REQUEST_MIN_REASON_CHARS = 8;

/** The request's life-cycle states. `submitted` is the only non-terminal one. */
export type GoalRequestState = "submitted" | GoalRequestTerminalState;

/** Terminal states. ⛔ `not-evaluated` is NOT a synonym for `refused` (see the header). */
export type GoalRequestTerminalState = "accepted" | "refused" | "not-evaluated";

/** The row a submit appends. */
export interface GoalRequestSubmittedRow {
  state: "submitted";
  requestId: string;
  goal: string;
  ac: string;
  /** The caller's verbatim reason — the whole point of the queue. */
  reason: string;
  /** Submission instant (ISO). */
  at: string;
}

/** The row the consumer appends. */
export interface GoalRequestTerminalRow {
  state: GoalRequestTerminalState;
  requestId: string;
  goal: string;
  ac: string;
  /** Copied from the `submitted` row so a reader never has to join two lines. */
  reason: string;
  /** The `submitted` row's instant (ISO). */
  at: string;
  /** When the driver settled it (ISO). AC-936 requires this to be a non-empty string on EVERY
   *  terminal row — "consumed" without a consumption time is an unfalsifiable claim. */
  consumedAt: string;
  /** The criterion's raw verdict, or null when it never ran (the AC was gone). ⛔ Not folded into
   *  `state`: a reader must be able to tell "ran and failed" from "never ran". */
  verdict: "pass" | "fail" | "not-evaluated" | null;
  /** One line, from the criterion's own reason (or the consumer's named cause). */
  detail: string;
}

export type GoalRequestRow = GoalRequestSubmittedRow | GoalRequestTerminalRow;

/** Is `row.state` terminal? */
export function isTerminalState(state: unknown): state is GoalRequestTerminalState {
  return state === "accepted" || state === "refused" || state === "not-evaluated";
}

/** The ONE construction point for the carrier path. */
export function goalRequestLedgerPath(root: string): string {
  return path.join(root, GOAL_REQUEST_REL);
}

/** Count of NON-WHITESPACE characters (`\s` excluded). The `--reason` floor is expressed in these,
 *  ⛔ not in `.length`: "        " is 8 characters of nothing. */
export function nonWhitespaceLength(s: unknown): number {
  return typeof s === "string" ? s.replace(/\s+/g, "").length : 0;
}

/** The stable requestId: `(goal, ac, reason)` → one id, forever, with no clock and no randomness.
 *  Two properties the whole idempotency story rests on, and both are testable without a store:
 *    · deterministic  — the same triple always derives the same id (so a replay is recognised);
 *    · discriminating — a different goal / AC / reason derives a different id (so a genuinely new
 *      request is never swallowed by an old one).
 *  The reason is HASHED rather than embedded: reasons are prose (they carry spaces, newlines and
 *  arbitrary unicode) and a `|`-separated id must stay one parseable token. */
export function goalRequestId(goal: string, ac: string, reason: string): string {
  const digest = createHash("sha256").update(`${goal}\u0000${ac}\u0000${reason}`).digest("hex").slice(0, 16);
  return `${goal}|${ac}|${digest}`;
}

export interface GoalRequestLedgerRead {
  /** false = the ledger EXISTS but could not be read. ⛔ A MISSING ledger is `readable:true` + zero
   *  rows: "no request was ever submitted" is a measurement, not an instrument failure (硬规则 3b). */
  readable: boolean;
  rows: GoalRequestRow[];
  /** Lines that could not be parsed / lacked a recognisable state + requestId. Skipped and COUNTED,
   *  ⛔ never fatal: one bad line must not blind the whole queue. */
  badLines: number;
  cause: string | null;
}

/** Read the queue. See `GoalRequestLedgerRead.readable` for the missing-vs-unreadable contract. */
export function readGoalRequestLedger(ledgerPath: string): GoalRequestLedgerRead {
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { readable: true, rows: [], badLines: 0, cause: null };
    return { readable: false, rows: [], badLines: 0, cause: `ledger-unreadable: ${(e as Error).message}` };
  }
  const rows: GoalRequestRow[] = [];
  let badLines = 0;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      badLines++;
      continue;
    }
    const rec = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const state = String(rec.state ?? "");
    const requestId = rec.requestId;
    if (!(state === "submitted" || isTerminalState(state)) || typeof requestId !== "string" || requestId === "") {
      badLines++;
      continue;
    }
    rows.push(rec as unknown as GoalRequestRow);
  }
  return { readable: true, rows, badLines, cause: null };
}

/** Append exactly one row. Returns a named error instead of throwing: the submit ladder must be able
 *  to report "read-only workspace" as a REFUSAL (AC4), ⛔ not as an unhandled crash. */
export function appendGoalRequestRow(ledgerPath: string, row: GoalRequestRow): { ok: boolean; error: string | null } {
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The requestIds that already carry a terminal row (the consume-side dedupe key). */
export function settledRequestIds(rows: GoalRequestRow[]): Set<string> {
  return new Set(rows.filter((r) => isTerminalState(r.state)).map((r) => r.requestId));
}

/** `submitted` rows with NO terminal row — i.e. what the driver still owes an answer. */
export function openGoalRequests(rows: GoalRequestRow[]): GoalRequestSubmittedRow[] {
  const settled = settledRequestIds(rows);
  return rows.filter((r): r is GoalRequestSubmittedRow => r.state === "submitted" && !settled.has(r.requestId));
}

/** verdict → terminal state. The mapping lives here ONCE so the CLI, the driver and the tests cannot
 *  drift (硬规则 5b); ⛔ it is not a boolean ("did it pass?" loses `not-evaluated`). */
export function terminalStateOfVerdict(verdict: "pass" | "fail" | "not-evaluated" | null): GoalRequestTerminalState {
  if (verdict === "pass") return "accepted";
  if (verdict === "fail") return "refused";
  // null (never ran) and "not-evaluated" are the SAME honest answer: we cannot say. ⛔ Never `refused`.
  return "not-evaluated";
}

// ── submit (the CLI's refusal ladder) ─────────────────────────────────────────────────────────────

/** Every way a submit can be refused. ⛔ Enum, never a boolean: "the AC does not exist" and "the goal
 *  store could not be read" are different facts and the caller is told which one it hit. */
export type GoalRequestRefusalCode =
  | "missing-goal"
  | "missing-ac"
  | "reason-too-short"
  | "no-such-goal"
  | "no-such-ac"
  | "goal-store-unreadable"
  | "ledger-unreadable"
  | "ledger-unwritable";

export interface GoalRequestRefusal {
  code: GoalRequestRefusalCode;
  message: string;
}

/** Three-state existence probe (`exists` / `absent` / `unreadable`). ⛔ The third value is
 *  load-bearing: a store we cannot read must not be reported as "no such AC" (硬规则 3b) — that would
 *  turn an instrument failure into a substantive refusal. */
export type GoalRequestPresence = "exists" | "absent" | "unreadable";
export type GoalRequestProbe = (goalId: string, acId?: string) => GoalRequestPresence;

export interface GoalRequestSubmitOutcome {
  /** true ⇔ the queue now holds this request (freshly appended OR already present). */
  ok: boolean;
  /** `submitted` = a row was appended now; `already-queued` = an identical request is still waiting;
   *  `already-settled` = an identical request already has its terminal row; `refused` = nothing written. */
  state: "submitted" | "already-queued" | "already-settled" | "refused";
  requestId: string | null;
  ledger: string;
  row: GoalRequestSubmittedRow | null;
  /** The terminal state of an identical EARLIER request, when `state === "already-settled"`. */
  settledAs: GoalRequestTerminalState | null;
  refusal: GoalRequestRefusal | null;
}

/** Submit one request, or refuse by name without writing anything.
 *
 *  REFUSAL ORDER is fixed and each step is a distinct code (AC4's negative controls are exactly the
 *  first six): missing positional → reason floor → AC existence (three-state) → ledger readability →
 *  ledger writability. ⛔ Every refusal path returns BEFORE the append, which is what "zero write"
 *  in the AC means and what the tests assert on the carrier's byte length. */
export function submitGoalRequest(opts: {
  root: string;
  goal: string | undefined | null;
  ac: string | undefined | null;
  reason: string | undefined | null;
  /** The existence probes. Injected so the ladder is testable without a goal store, and so the CLI
   *  keeps the layout knowledge of `goals/` (⛔ this module must not learn it a second time).
   *  `probe(goal)` answers "does the GOAL record exist"; `probe(goal, ac)` answers "is that AC filed
   *  under it". Calling a probe with no goal asks about the store itself. */
  probe: GoalRequestProbe;
  now?: () => Date;
}): GoalRequestSubmitOutcome {
  const ledger = goalRequestLedgerPath(opts.root);
  const refuse = (code: GoalRequestRefusalCode, message: string): GoalRequestSubmitOutcome => ({
    ok: false,
    state: "refused",
    requestId: null,
    ledger,
    row: null,
    settledAs: null,
    refusal: { code, message },
  });

  const goal = typeof opts.goal === "string" ? opts.goal.trim() : "";
  const ac = typeof opts.ac === "string" ? opts.ac.trim() : "";
  const reason = typeof opts.reason === "string" ? opts.reason : "";

  if (goal === "") return refuse("missing-goal", "missing required <goal> (e.g. GOAL-914)");
  if (ac === "") return refuse("missing-ac", "missing required <ac> (e.g. AC-936)");
  const reasonChars = nonWhitespaceLength(reason);
  if (reasonChars < GOAL_REQUEST_MIN_REASON_CHARS) {
    return refuse(
      "reason-too-short",
      `--reason must carry at least ${GOAL_REQUEST_MIN_REASON_CHARS} non-whitespace characters (got ${reasonChars})`,
    );
  }

  const presence = opts.probe(goal, ac);
  if (presence === "unreadable") {
    return refuse("goal-store-unreadable", `goals/ could not be read — the existence of ${ac} is UNKNOWN, not denied`);
  }
  if (presence === "absent") {
    // Which of the two ids was missing is the useful half of the message.
    const goalPresence = opts.probe(goal);
    if (goalPresence === "unreadable") {
      return refuse("goal-store-unreadable", `goals/ could not be read — the existence of ${goal} is UNKNOWN, not denied`);
    }
    if (goalPresence === "absent") return refuse("no-such-goal", `no such goal: ${goal}`);
    return refuse("no-such-ac", `${goal} has no criterion ${ac}`);
  }

  const existing = readGoalRequestLedger(ledger);
  if (!existing.readable) {
    return refuse("ledger-unreadable", `the request ledger exists but cannot be read (${existing.cause}) — refusing to write on top of an unreadable queue`);
  }

  const requestId = goalRequestId(goal, ac, reason);
  const terminal = existing.rows.find((r) => r.requestId === requestId && isTerminalState(r.state));
  if (terminal) {
    return {
      ok: true,
      state: "already-settled",
      requestId,
      ledger,
      row: null,
      settledAs: terminal.state as GoalRequestTerminalState,
      refusal: null,
    };
  }
  const queued = existing.rows.find((r) => r.requestId === requestId && r.state === "submitted");
  if (queued) {
    return {
      ok: true,
      state: "already-queued",
      requestId,
      ledger,
      row: queued as GoalRequestSubmittedRow,
      settledAs: null,
      refusal: null,
    };
  }

  const row: GoalRequestSubmittedRow = {
    state: "submitted",
    requestId,
    goal,
    ac,
    reason,
    at: (opts.now ?? (() => new Date()))().toISOString(),
  };
  const w = appendGoalRequestRow(ledger, row);
  if (!w.ok) return refuse("ledger-unwritable", `could not append to ${ledger} (${w.error})`);
  return { ok: true, state: "submitted", requestId, ledger, row, settledAs: null, refusal: null };
}

// ── settle (the driver's write half) ─────────────────────────────────────────────────────────────

/** One answer the consumer produced for one open request. */
export interface GoalRequestSettlement {
  requestId: string;
  goal: string;
  ac: string;
  reason: string;
  submittedAt: string;
  state: GoalRequestTerminalState;
  verdict: "pass" | "fail" | "not-evaluated" | null;
  detail: string;
}

export interface GoalRequestSettleReading {
  appended: number;
  /** requestIds that were ALREADY terminal when this call arrived ⇒ no second row (idempotency). */
  alreadySettled: string[];
  errors: string[];
}

/** Append the terminal rows for `settlements`, skipping any requestId that already has one.
 *
 *  WHY THE CHECK IS HERE AND NOT ONLY AT THE CALLER: the crash window between "criterion ran" and
 *  "terminal row written" is exactly a re-run, and a re-run must not be able to produce a SECOND
 *  terminal row (AC-936 judges uniqueness across the whole carrier). Reading the ledger immediately
 *  before the append makes that a property of this function rather than a promise made by its caller. */
export function settleGoalRequests(
  ledgerPath: string,
  settlements: GoalRequestSettlement[],
  opts: { now?: () => Date } = {},
): GoalRequestSettleReading {
  const out: GoalRequestSettleReading = { appended: 0, alreadySettled: [], errors: [] };
  if (settlements.length === 0) return out;
  const read = readGoalRequestLedger(ledgerPath);
  if (!read.readable) {
    out.errors.push(`ledger-unreadable: ${read.cause}`);
    return out;
  }
  const settled = settledRequestIds(read.rows);
  const consumedAt = (opts.now ?? (() => new Date()))().toISOString();
  for (const s of settlements) {
    if (settled.has(s.requestId)) {
      out.alreadySettled.push(s.requestId);
      continue;
    }
    const row: GoalRequestTerminalRow = {
      state: s.state,
      requestId: s.requestId,
      goal: s.goal,
      ac: s.ac,
      reason: s.reason,
      at: s.submittedAt,
      consumedAt,
      verdict: s.verdict,
      detail: s.detail,
    };
    const w = appendGoalRequestRow(ledgerPath, row);
    if (!w.ok) {
      out.errors.push(`${s.requestId}: ${w.error}`);
      continue; // ⛔ a failed append is NOT a settled request — the next round owes the answer again.
    }
    settled.add(s.requestId);
    out.appended++;
  }
  return out;
}
