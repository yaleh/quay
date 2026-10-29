// quay Core: the goal store's LEDGER read substrate — the bounded scan of
// `<workspaceRoot>/.quay/gate-events.jsonl` and the two derived maps over it.
//
// Extracted verbatim from `./goal-store.ts` (tasks/gap-routine-architecture-analysis-god-function-
// creategoalstore). These were already free functions taking only a path, so the move leaves their
// behaviour byte-identical; the store now imports them instead of owning them.
//
// Two readers, two questions (⛔ one scan each, bounded memory):
//   · `gateTails`         — per-record LAST event + last ROTATION-written event (the rotation's
//                           eligibility and the amendment gate read this).
//   · `ledgerEvidenceMap` — per-record ledger-DERIVED evidence (the view-model's `evidence`).
// `SWEEP_ACTOR` / `AMEND_ACTOR` live here because `gateTails` is the ONE place that classifies a
// row as rotation-written; a second copy of those strings would silently stop matching.

import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export const SWEEP_ACTOR = "goal-sweep";
/** The AMENDMENT dry-run's actor — deliberately a DIFFERENT string from `SWEEP_ACTOR`
 *  (gap-ac242-derived-criterion-double-judged-and-amendment-unguarded, defect ②):
 *  「对一条已 achieved 的 AC 修订 criterion」时，本轮对**新**判据的空跑以本 actor 落账，读台账的人
 *  能区分「轮转按年龄轮到了它」与「判据文本变了，所以立刻重跑了一次」——两者是不同的**成因**，
 *  用同一个 actor 记就不可归因（硬规则 3：枚举态而非布尔态；这里的第二态就是「为什么这次跑了它」）。
 *  ⛔ 它与 `SWEEP_ACTOR` 一样是**轮转写者**：`gateTails` 把两者的尾部都读进 `lastSweep`（见下），
 *  否则这条空跑写下的 verdict 不会被判定面读到，机制就等于没接。 */
export const AMEND_ACTOR = "goal-amend";

/** One `gate:"goal"` ledger row, reduced to the fields a rotation judgment needs.
 *  `criterionHash` = the criterion fingerprint the writer verified (`payload.criterionHash`),
 *  empty string when the event predates the amendment gate or carries none — see
 *  `checkStalePass`, where "no fingerprint" is read as「不知道这条 verdict 针对哪一版判据」,
 *  ⛔ never as "it matches the current one" (hard rule 3b: 读不懂输入不得伪装成合格). */
export type GateTail = { at: string; verdict: string; actor: string; reason: string; criterionHash: string };

/**
 * Per-record ledger TAILS in ONE pass: `last` = the most recent `gate:"goal"` event for the id;
 * `lastSweep` = the most recent one written by the ROTATION (`actor` ∈ {`SWEEP_ACTOR`, `AMEND_ACTOR`}).
 * Two maps because they answer two different questions — "what does the ledger say" vs "has the
 * rotation actually looked at this recently" — and collapsing them would make a rotation-written
 * verdict indistinguishable from a per-round-loop one (hard rule 4b: the tail is read as a proxy for
 * current truth, so who wrote it and when is part of the reading, not decoration).
 *
 * ⚠️ `AMEND_ACTOR` counts as a rotation writer ON PURPOSE: the amendment dry-run IS a re-verification
 * (it runs the criterion and records the verdict) — the only difference is WHY this one was picked.
 * Excluding it would make an amendment-triggered verdict invisible to the judgment it exists to feed.
 */
// ── the BOUNDED goal-ledger scan (gap-suite-heavy-files-and-phase-concurrency-…) ─────────────────
// THE DEFECT THIS REPLACES. Both readers below used to call
// `queryGateEvents(logPath, { gate: "goal" })`, which materializes a `GateEvent[]` for the WHOLE
// ledger before either of them looks at a single row. Measured 2026-10-16 on the production ledger
// (148.7 MB / 560,752 lines, 559,192 of them `gate:"goal"`): **588.6 MB heap + 781 MB peak RSS per
// call**, paid on EVERY goal read (`get()` and `list()` both reach `ledgerEvidenceMap`). Four
// otherwise-trivial suite files that only READ the stored criterion — ac341, ac260-ac261, ac272,
// gap-dashboard-goal-card-… — were measured at 1.7-1.8 GB peak for exactly this reason, and at
// 64-way under the 16 GiB suite cgroup that is what tipped the main phase into OOM. The cost is not
// the ledger's content, it is the ARRAY: every row is parsed and retained even though both callers
// keep only an id-keyed running maximum.
//
// WHAT THIS DOES INSTEAD. Scan the file in fixed-size chunks, parse ONE line at a time, and hand
// each `gate:"goal"` row to `visit` — so the live set is one decoded line plus the caller's own (id
// → ≤5 fields) accumulators, and the peak no longer tracks the ledger's length. The answers are
// unchanged by construction: on-disk order is preserved, so "last wins" and "first seen" still
// resolve to the same rows the eager array gave.
//
// FORMAT CONSTRAINT. `core/gate-event-store.ts` owns the JSONL contract (one GateEvent per line);
// this is the same read without the array, deliberately NOT a second format — the row shape below
// mirrors the `GateEvent` fields the two readers actually consume.
//
// ⛔ `StringDecoder`, not `Buffer.toString()` per chunk: a multi-byte character can straddle a chunk
// boundary and decoding the halves independently would corrupt the line (the ledger carries CJK task
// subjects).
//
// FAIL-SAFE, byte-compatible with the call it replaces: `queryGateEvents` built its array EAGERLY,
// so one malformed line threw before ANY caller saw a row and the caller's `catch` returned an empty
// result. `false` reproduces that exactly — the caller must discard what it accumulated so far,
// never keep a prefix of the ledger (a half-read ledger is not "no evidence", it is "unknown", and
// hard rule 3b forbids the two sharing an output).
export type GoalLedgerRow = { id: string; timestamp: unknown; verdict: unknown; actor: unknown; payload: unknown };

/** Fixed chunk size, so the scan's own memory is O(chunk) and independent of the ledger's size. */
export const GOAL_LEDGER_CHUNK_BYTES = 1 << 20;

/** Visit every `gate:"goal"` row on disk at `logPath`, in append order, with bounded memory.
 *  Returns `true` when the whole ledger was read; `false` when it could not be (unreadable /
 *  malformed) — in which case the caller has seen a PREFIX and must discard it. A missing ledger is
 *  `true` with no rows (a fresh checkout has no evidence — hard rule 6, missing ≠ false). */
export function scanGoalLedger(logPath: string, visit: (row: GoalLedgerRow) => void): boolean {
  let fd: number;
  try {
    fd = fs.openSync(logPath, "r");
  } catch {
    return true; // no ledger ⇒ no rows (the eager read produced `[]` for the same reason)
  }
  try {
    const decoder = new StringDecoder("utf8");
    const chunk = Buffer.allocUnsafe(GOAL_LEDGER_CHUNK_BYTES);
    let carry = "";
    const consume = (line: string): void => {
      if (line === "") return; // blank lines: `queryGateEvents` filtered these before parsing
      const ev = JSON.parse(line) as Record<string, unknown>;
      if (ev.gate !== "goal") return;
      const id = String(ev.pipeline_id ?? ev.item_id ?? "");
      if (id === "") return;
      visit({ id, timestamp: ev.timestamp, verdict: ev.verdict, actor: ev.actor, payload: ev.payload });
    };
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, GOAL_LEDGER_CHUNK_BYTES, null);
      if (n <= 0) break;
      const text = carry + decoder.write(chunk.subarray(0, n));
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    carry += decoder.end();
    if (carry !== "") consume(carry);
    return true;
  } catch {
    return false; // unreadable/malformed ⇒ the caller keeps NO evidence (never crashes a read)
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* best-effort */
    }
  }
}

export function gateTails(goalDir: string): { last: Map<string, GateTail>; lastSweep: Map<string, GateTail> } {
  const last = new Map<string, GateTail>();
  const lastSweep = new Map<string, GateTail>();
  const logPath = path.join(path.dirname(goalDir), ".quay", "gate-events.jsonl");
  const complete = scanGoalLedger(logPath, ({ id, timestamp, verdict, actor, payload }) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const row: GateTail = {
      at: String(timestamp ?? ""),
      verdict: String(verdict ?? ""),
      actor: String(actor ?? ""),
      reason: typeof p.reason === "string" ? p.reason : "",
      criterionHash: typeof p.criterionHash === "string" ? p.criterionHash : "",
    };
    last.set(id, row); // append order = on-disk order ⇒ the LAST matching event wins
    if (row.actor === SWEEP_ACTOR || row.actor === AMEND_ACTOR) lastSweep.set(id, row);
  });
  // An unreadable/malformed ledger yields NO tails — the partial scan's rows are discarded, exactly
  // as the eager read threw before the caller's loop started (never a half-read tail).
  return complete ? { last, lastSweep } : { last: new Map(), lastSweep: new Map() };
}

// ── evidence is ledger-DERIVED (gap-goal-evidence-cache-should-not-enter-git) ───────────────────
// `evidence` is NOT a stored field: it is the gitignored `.quay/gate-events.jsonl`'s LAST
// `gate:"goal"` event for a record, read back into the view-model at read time. The ledger path is
// DERIVED from goalDir (`<workspaceRoot>/.quay/gate-events.jsonl`, where goalDir is
// `<workspaceRoot>/goals`) — the same `dirname(goalDir)` derivation `readGoalConfig` already uses.
// A fresh checkout with no ledger ⇒ no evidence ⇒ notEvaluated / "—" (hard rule 6: missing =
// not-checked, not false). This is the SINGLE point both consumers share: `checkStaleness` reads
// `ac.evidence.at` from `list()`'s view-models, and the native provider's `goal_list`/`goal_get`
// verbs surface the same view-models to serve-goal.
export type LedgerEvidence = { at?: string; verdict?: string; reading?: string; firstAt?: string };

export function ledgerEvidenceMap(goalDir: string): Map<string, LedgerEvidence> {
  const map = new Map<string, LedgerEvidence>();
  const logPath = path.join(path.dirname(goalDir), ".quay", "gate-events.jsonl");
  const complete = scanGoalLedger(logPath, ({ id, timestamp, verdict, payload }) => {
    const reading = payload && typeof payload === "object"
      && typeof (payload as Record<string, unknown>).reason === "string"
      ? (payload as Record<string, unknown>).reason as string
      : undefined;
    // Append order = on-disk order, so the LAST matching event wins (the most recent). `firstAt`
    // keeps the FIRST matching event (the earliest evidence) — the SAME single pass supplies both
    // extremes with zero extra I/O (firstEvidenceAt's min is the first-seen timestamp).
    const prev = map.get(id);
    map.set(id, {
      at: timestamp as string | undefined,
      verdict: verdict as string | undefined,
      reading,
      firstAt: prev?.firstAt ?? (timestamp as string | undefined),
    });
  });
  // An unreadable/malformed ledger yields NO evidence for any record: the partial scan's rows are
  // discarded, exactly as the eager read threw before the caller's loop started.
  return complete ? map : new Map();
}
