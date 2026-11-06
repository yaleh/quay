// quay Core: goal-round-carrier — the ONE reader of the goal driver's append-only round log
// (`<root>/.quay/goal-round.jsonl`).
//
// WHY THIS MODULE EXISTS (gap-goal-next-unchanged-rounds-escalation). The round log is the only
// carrier that holds TIME: a single round record is a snapshot (one `goal-next` fact, one `goal-ring`
// verdict set), and every cross-round question — "how many rounds has this row looked the same?" —
// needs the previous rounds' records. The tail reader already existed but was PRIVATE to the Core CLI
// (`cli/goal.ts`); the goal-driver now needs the SAME read to feed the projection's `history` input.
// Two copies of a bounded tail reader is exactly the drift class this repo keeps removing (hard rule
// 5b: fixing the half-line handling in one and not the other would make two readers disagree about
// the same file), so it lives here and both consume it.
//
// ⛔ BOUNDED, ALWAYS. The production carrier measured 368MB on 2026-11-07: a full parse per round is
// not an option, and it grows without bound. Every entry point here reads a TAIL (`maxBytes`) and
// then stops as soon as it has what it was asked for (`maxRounds`).
//
// ⛔ THREE-VALUED (hard rule 3b). "The file does not exist / could not be read" is `null`, ⛔ NOT
// `[]`: an empty history means "read it, this is the first round" and a reader that confuses the two
// would report a 50-round wait as a brand-new one.

import fs from "node:fs";

import type { GoalNextHistoryRound } from "./goal-analysis.ts";

/** How much of the tail to read by default. One round record measured ~0.2MB ⇒ 8MiB is ~40 rounds of
 *  headroom, and the streak threshold is 8 — the cap is honest about being a window, and a fact not
 *  found inside it is reported as not-found (⛔ never as "there is nothing"). */
export const GOAL_ROUND_TAIL_BYTES = 8 * 1024 * 1024;

/** How many `goal-next`-carrying rounds to hand back by default (the newest N, oldest → newest). */
export const GOAL_NEXT_HISTORY_MAX_ROUNDS = 64;

/** Read the tail of the round log as complete lines.
 *
 *  The FIRST line is dropped when the window began mid-line: a half-parsed record must never be read
 *  as a record (it would silently contribute a truncated fact).
 *
 *  Throws on I/O failure (callers turn that into their own `null`/NOT-EVALUATED reading) — ⛔ it does
 *  not return an empty tail, because "unreadable" and "empty" are different worlds. */
export function readRoundLogTail(file: string, maxBytes: number): { lines: string[]; bytes: number } {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - maxBytes);
  const len = st.size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  const lines = buf.toString("utf8").split("\n");
  if (start > 0) lines.shift(); // partial first line
  return { lines, bytes: len };
}

/** The `goal-next` rows of the newest `maxRounds` rounds that carry a READABLE projection.
 *
 *  Returns oldest → newest (so `history[history.length - 1]` is the round before this one).
 *
 *  · file missing / unreadable ⇒ `null` (⛔ NOT `[]`).
 *  · a round with no `goal-next` fact, or one whose fact is `evaluated:false`, is FILTERED OUT — it
 *    says nothing about any row, so it neither counts nor breaks (a truncated round is the common
 *    case: a stop request legitimately leaves the fact absent).
 *  · ⛔ no row validation happens here. A row this reader cannot fully understand is still a
 *    reading of that round; the per-row "cannot anchor a streak" case is handled where the streak is
 *    counted (`streakKeyOf` ⇒ `null` ⇒ break), which is a decision about the ROW, not about the file. */
export function readGoalNextHistory(
  file: string,
  opts: { maxRounds?: number; maxBytes?: number } = {},
): GoalNextHistoryRound[] | null {
  const maxRounds = opts.maxRounds ?? GOAL_NEXT_HISTORY_MAX_ROUNDS;
  const maxBytes = opts.maxBytes ?? GOAL_ROUND_TAIL_BYTES;
  let tail: { lines: string[]; bytes: number };
  try {
    tail = readRoundLogTail(file, maxBytes);
  } catch {
    return null;
  }
  const out: GoalNextHistoryRound[] = [];
  for (let i = tail.lines.length - 1; i >= 0 && out.length < maxRounds; i--) {
    const line = tail.lines[i];
    if (line.trim() === "") continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // an unparseable line is not a reading
    }
    if (rec === null || typeof rec !== "object") continue;
    const facts = Array.isArray(rec.facts) ? (rec.facts as Array<Record<string, unknown>>) : [];
    const fact = facts.find((f) => f !== null && typeof f === "object" && f.name === "goal-next");
    if (!fact) continue;
    const value = fact.value as Record<string, unknown> | undefined;
    if (!value || value.evaluated !== true || !Array.isArray(value.rows)) continue;
    out.push({ round: rec.round, rows: value.rows as Array<Record<string, unknown>> });
  }
  return out.reverse();
}
