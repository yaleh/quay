// quay Core: goal-staleness signal — the append-only carrier behind the GOAL `staleness` column
// (gap-goal-status-stale-achieved-after-new-active-criterion-filed; extracted verbatim from
// `core/goal-store.ts` by tasks/gap-routine-architecture-analysis-god-module-goal-store).
//
// WHY THIS IS ITS OWN MODULE. The signal is one JSONL file with its own lifecycle (append a `stale`
// event, append a `resolved` event, fold the stream per goal) and it shares NOTHING with the goal
// store's record mechanics except the workspace path — the store's job is the GOAL/AC records, this
// module's job is the divergence audit trail. Keeping it in the store made a 4,167-line module out of
// at least five separable concerns (archguard `god-module` finding `god-module-goal-store`).
//
// ⛔ The DIRECTION of the dependency matters: this is a LEAF. It imports only `node:fs`/`node:path`
// and the record file-name/frontmatter helpers — never the store, never the gate. The store imports
// it (one call site in `write()`: the signal is recorded in the SAME file lock as the record write)
// and re-exports its public surface, so external consumers keep their historical import path.
//
// ⛔ The three-state contract is NOT relaxed by the move (hard rule 3b): a carrier that exists but
// cannot be parsed reads `not-evaluated`, never `clean` — an unreadable carrier is an INSTRUMENT
// failure, not an empty one.

import fs from "node:fs";
import path from "node:path";

// ── goal-staleness signal (gap-goal-status-stale-achieved-after-new-active-criterion-filed) ──────
// THE DEFECT. The store's `write()` is PER-RECORD (its own structure, not an oversight): writing
// `AC-029 {goal: "GOAL-003", status: "active", …}` touches nothing on GOAL-003's record. So a GOAL
// whose `status` is `achieved` while a NEW undischarged criterion has since been filed under it
// reads EXACTLY like a genuinely closed GOAL — one `achieved` token for two different worlds
// (hard rule 3b). Measured 2026-09-14 in a third-party workspace (quay-fleet): GOAL-003 sat at
// `achieved` while AC-029/030/031/032 were filed `active` under it; only a human noticing the
// inconsistency corrected it. Nothing on any carrier distinguished the two states.
//
// ⛔ WHAT THIS IS NOT. It is NOT an auto-reopen. `plugin/scripts/goal-driver.ts:516`（and `:2243`）
// records 裁定 3 verbatim: 「不得反向翻转状态（achieved→active；激活归人）」 — activation is a human /
// authorized-actor decision, and a mechanism must never flip `achieved`→`active` on its own. A fix
// phrased as "detect a new AC and flip the GOAL back" would collide with that ruling head-on. So
// the GOAL record is NEVER written here — only a SIDE CARRIER (append-only, gitignored, the same
// shape as `goal-round.jsonl` / `*-sync.jsonl`): the reader can then SEE the divergence and a human
// can decide. Visibility, not automation.
//
// ⛔ AND IT IS NOT THE SUFFICIENCY VERDICT. Sufficiency (`covered` / `insufficient` /
// `not-evaluated`) answers 「do the ACs cover the goal's exit conditions」; this answers 「does the
// GOAL's `status` FIELD still reflect its children as they are now」. Different dimensions — folding
// them into one field would re-commit the very conflation (hard rule 3b) this task exists to remove.
//
// CARRIER SHAPE — one JSONL line per event, append-only, resolution is a SECOND line (the signal's
// audit trail is never deleted or rewritten, mirroring the `*-sync.jsonl` 「事件不删只追加状态」
// convention this repo already uses):
//   {"ts":"<iso>","event":"stale",   "goalId","staleSince","triggeringAcId","goalStatusAtTime"}
//   {"ts":"<iso>","event":"resolved","goalId","actor","reason"}
// A goal's state = the tail of its own event stream: `stale` with no later `resolved` ⇒ unresolved.
export const GOAL_STALENESS_SIGNAL_REL = ".quay/goal-staleness-signal.jsonl";

/** One unresolved signal's DISCRIMINATING fields — the four the task names, so a reader can see
 *  WHICH AC introduced the divergence (an enumeration, ⛔ never a bare boolean; hard rule 3). */
export interface GoalStalenessSignal {
  goalId: string;
  /** When the triggering write happened (this is the signal's own `ts`). */
  staleSince: string;
  /** The criterion whose write introduced the undischarged child. */
  triggeringAcId: string;
  /** The owning GOAL's status AS READ at that moment — recorded, not re-derived from today's file
   *  (a value re-derived later would answer a different question: hard rule 4 corollary 2). */
  goalStatusAtTime: string;
}

/**
 * The derived judgment for ONE goal. THREE-STATE, ⛔ never a boolean (hard rule 3b): a carrier that
 * exists but cannot be parsed must not read the same as "read it, there is nothing" — an
 * unreadable carrier is an INSTRUMENT failure, and reporting it as `clean` would be the exact
 * "读不懂 ⇒ 伪装成检查通过" shape this repo names as its most expensive failure mode.
 */
export interface GoalStaleness {
  state: "clean" | "stale" | "not-evaluated";
  /** The unresolved signals, in append order. Empty unless `state === "stale"`; enumerated so the
   *  output can name N and WHICH AC — not just "something is off". */
  signals: GoalStalenessSignal[];
  /** Present only for `not-evaluated`: why the carrier could not be read. */
  reason?: string;
}

/** `<workspaceRoot>/.quay/goal-staleness-signal.jsonl` — derived from goalDir the SAME way
 *  `ledgerEvidenceMap` derives the gate ledger (`dirname(goalDir)/.quay/…`), so both carriers
 *  follow one rule instead of two. */
function stalenessSignalPath(goalDir: string): string {
  return path.join(path.dirname(goalDir), GOAL_STALENESS_SIGNAL_REL);
}

/**
 * Append ONE signal line (never rewrites the carrier — the whole point of an append-only audit
 * trail). Returns the carrier path so a caller can report where the evidence landed.
 * ⛔ Best-effort: a failure to record visibility must never abort a record write that already
 * succeeded — but it IS reported on stderr, never swallowed (hard rule 3b).
 */
export function appendGoalStalenessSignal(goalDir: string, rec: GoalStalenessSignal): string {
  const file = stalenessSignalPath(goalDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: rec.staleSince, event: "stale", ...rec }) + "\n", "utf8");
  } catch (err) {
    console.error(
      `goal-store: could not append the goal-staleness signal for ${rec.goalId} (${rec.triggeringAcId}) — the record was written but the divergence is NOT recorded: ${(err as Error).message}`,
    );
  }
  return file;
}

/**
 * AC3 — the HUMAN CONFIRMATION PATH, and the ONLY writer of `resolved`. Deliberately NOT a new
 * verb: it is called by `write()` when a GOAL is written with `status: active` (the existing
 * 「确认重开」 path), so "activation is a human decision" (裁定 3) is preserved — the mechanism
 * records THAT a human decided, it never decides. Resolution APPENDS (never deletes/rewrites), so
 * the original signal stays auditable. Returns how many signals were resolved (enumerated).
 */
export function resolveGoalStaleness(
  goalDir: string,
  goalId: string,
  opts: { actor: string; reason?: string },
): number {
  const n = readGoalStalenessIndex(goalDir).byGoal.get(goalId)?.length ?? 0;
  if (n === 0) return 0;
  const file = stalenessSignalPath(goalDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "resolved",
        goalId,
        actor: opts.actor,
        reason: opts.reason ?? "",
      }) + "\n",
      "utf8",
    );
  } catch (err) {
    console.error(
      `goal-store: could not append the goal-staleness RESOLUTION for ${goalId} — the reopen was written but the signal stays marked unresolved: ${(err as Error).message}`,
    );
    return 0;
  }
  return n;
}

/**
 * Read the carrier ONCE and fold each goal's event stream to its UNRESOLVED signals (append order
 * = on-disk order; a `resolved` line clears everything before it). `evaluated:false` means the
 * carrier exists but could not be parsed — the caller must surface that as `not-evaluated`, ⛔ not
 * as `clean`.
 */
export function readGoalStalenessIndex(goalDir: string): {
  evaluated: boolean;
  reason?: string;
  byGoal: Map<string, GoalStalenessSignal[]>;
} {
  const byGoal = new Map<string, GoalStalenessSignal[]>();
  const file = stalenessSignalPath(goalDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    // ENOENT = the carrier does not exist ⇒ no signal has ever been recorded ⇒ a definite "clean".
    // Anything else (EACCES, EISDIR) means we could NOT read it — a different answer.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { evaluated: true, byGoal };
    return { evaluated: false, reason: `${file}: ${(err as Error).message}`, byGoal };
  }
  for (const [i, line] of raw.split("\n").entries()) {
    if (line.trim() === "") continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      return { evaluated: false, reason: `${file}:${i + 1}: unparseable JSON (${(err as Error).message})`, byGoal };
    }
    const goalId = typeof rec.goalId === "string" ? rec.goalId : "";
    if (goalId === "") {
      return { evaluated: false, reason: `${file}:${i + 1}: no goalId`, byGoal };
    }
    if (rec.event === "resolved") {
      byGoal.delete(goalId);
    } else if (rec.event === "stale") {
      const arr = byGoal.get(goalId) ?? [];
      arr.push({
        goalId,
        staleSince: String(rec.staleSince ?? rec.ts ?? ""),
        triggeringAcId: String(rec.triggeringAcId ?? ""),
        goalStatusAtTime: String(rec.goalStatusAtTime ?? ""),
      });
      byGoal.set(goalId, arr);
    } else {
      // An event kind this reader does not know ⇒ it cannot say what the stream means (hard rule
      // 3b). Fail the READ, ⛔ never silently skip the line and report `clean`.
      return { evaluated: false, reason: `${file}:${i + 1}: unknown event ${JSON.stringify(rec.event)}`, byGoal };
    }
  }
  return { evaluated: true, byGoal };
}

/** The derived staleness judgment for ONE goal id (the exported single-goal reader). */
export function readGoalStaleness(goalDir: string, goalId: string): GoalStaleness {
  const idx = readGoalStalenessIndex(goalDir);
  if (!idx.evaluated) return { state: "not-evaluated", signals: [], reason: idx.reason };
  const signals = idx.byGoal.get(goalId) ?? [];
  return { state: signals.length > 0 ? "stale" : "clean", signals };
}
