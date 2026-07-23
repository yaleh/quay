// deliverable-governor.ts — DIR-066: the SOFT, per-SELECT deliverable governor that REPLACES DIR-038-B's
// hard governance:product checkpoint halt. It never halts. It biases only the Round-1 SELECT shortlist
// composition (the "candidates considered this pass" set in OUTER-LOOP step 1); Round 2 (the VT Δv̂ +
// value-typed ledger + governance/infra hard-floor ranker) is untouched.
//
// The (丙) `deliverable:yes|no` classification is a recorded per-task JUDGMENT (consumer-outside-loop),
// NOT auto-computed here — this module consumes it and computes the mechanical streak / floor / shortlist.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI (fixture replay) over them.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const K = 0.5;          // penalty slope (agreed)
export const CAP = 3.0;        // penalty cap (agreed) — floor saturates at streak = CAP/K = 6
export const DEFAULT_SMAX = 4; // Round-2 upper bound: shortlist size S ∈ [1, SMAX]

// ── floor ────────────────────────────────────────────────────────────────────────────────────────
// Rising D-quota floor on the Round-1 shortlist. floor = min(1, K·streak / CAP) = min(1, streak/6).
export function floor(streak: number): number {
  if (!Number.isFinite(streak) || streak < 0) throw new Error("deliverable-governor: streak must be a non-negative number");
  return Math.min(1, (K * streak) / CAP);
}

// ── nextStreak ───────────────────────────────────────────────────────────────────────────────────
// Consecutive SELECTed `deliverable:no`. A `deliverable:yes` SELECT resets to 0. An EXEMPT milestone
// (mandatory explore / arch-audit — cadence-forced, not SELECT-chosen) is streak-neutral.
export function nextStreak(streak: number, pickedDeliverable: "yes" | "no", exempt = false): number {
  if (exempt) return streak;
  return pickedDeliverable === "yes" ? 0 : streak + 1;
}

export interface Candidate { id: string; deliverable: "yes" | "no"; rank: number; } // rank: lower = better (Round-2's own ranking)
export interface ShortlistResult {
  shortlist: Candidate[];
  size: number;            // S ∈ [1, sMax] (or 0 only if there are no candidates at all)
  floor: number;
  nSeats: number;
  dSeats: number;
  starvation: boolean;     // floor≥1 ∧ no autonomous D available → run best-N + emit the visible signal
}

// ── composeShortlist ─────────────────────────────────────────────────────────────────────────────
// Round-1 only. Over the AUTONOMOUS-selectable candidates (human-steered already excluded upstream):
//   N_seats = round((1−floor)·sMax);  D_seats = sMax − N_seats.
// Take the best (lowest-rank) min(availD, D_seats) D + best min(availN, N_seats) N. As floor→1, N_seats→0
// so the shortlist becomes all-D (size = availD, ≥1 if any D) — hence S can shrink to 1. If floor≥1 and NO
// D is available, that is deliverable-starvation: run the best N (up to sMax) and flag it (the loop
// continues; the signal is pure-soft, surfaced for a watching human).
export function composeShortlist(
  { candidates, streak, sMax = DEFAULT_SMAX }: { candidates: Candidate[]; streak: number; sMax?: number },
): ShortlistResult {
  if (!Array.isArray(candidates)) throw new Error("deliverable-governor: candidates must be an array");
  if (!Number.isInteger(sMax) || sMax < 1) throw new Error("deliverable-governor: sMax must be a positive integer");
  const fl = floor(streak);
  const nSeats = Math.round((1 - fl) * sMax);
  const dSeats = sMax - nSeats;
  const byRank = (a: Candidate, b: Candidate) => a.rank - b.rank;
  const D = candidates.filter((c) => c.deliverable === "yes").sort(byRank);
  const N = candidates.filter((c) => c.deliverable === "no").sort(byRank);

  const starvation = fl >= 1 && D.length === 0;
  let shortlist: Candidate[];
  if (starvation) {
    shortlist = N.slice(0, sMax);                                  // no D exists → run best N, flag it
  } else {
    shortlist = [...D.slice(0, dSeats), ...N.slice(0, nSeats)];    // D floor honored; unfilled seats stay empty (no padding)
  }
  return { shortlist, size: shortlist.length, floor: fl, nSeats, dSeats, starvation };
}

export interface FixtureEntry { m: string; class: "D" | "N" | "X"; }
export interface ReplayRow { m: string; class: string; streak: number; floor: number; }
export interface ReplayResult { rows: ReplayRow[]; deliverableShare: number; maxStreak: number; }

// ── replayFloors ─────────────────────────────────────────────────────────────────────────────────
// Walk a classified milestone sequence (D/N/X), maintaining the streak and reporting the floor per
// milestone. Used by the golden-oracle. X = exempt (streak-neutral). NB: this asserts the streak/floor
// trajectory only — shortlist composition needs candidate pools the historical stream does not record,
// so bounds/self-limiting are covered by synthetic-pool unit tests instead.
export function replayFloors(fixture: FixtureEntry[]): ReplayResult {
  let streak = 0, maxStreak = 0, dCount = 0, nCount = 0;
  const rows: ReplayRow[] = [];
  for (const e of fixture) {
    if (e.class === "X") { rows.push({ m: e.m, class: e.class, streak, floor: floor(streak) }); continue; }
    streak = nextStreak(streak, e.class === "D" ? "yes" : "no", false);
    if (e.class === "D") dCount++; else nCount++;
    if (streak > maxStreak) maxStreak = streak;
    rows.push({ m: e.m, class: e.class, streak, floor: floor(streak) });
  }
  return { rows, deliverableShare: dCount / (dCount + nCount), maxStreak };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// `deliverable-governor.ts <fixture.json>` → prints the replay trajectory. Emits NO HALT-RECOMMENDED and
// touches no `.halt` — the whole point is that this mechanism never halts.
export async function main(argv: string[]): Promise<number> {
  const file = argv[2];
  if (!file || !fs.existsSync(file)) { process.stderr.write("Usage: deliverable-governor.ts <fixture.json>\n"); return 2; }
  let fixture: FixtureEntry[];
  try { fixture = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e: any) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  const r = replayFloors(fixture);
  for (const row of r.rows) {
    process.stdout.write(`${row.m.padEnd(5)} ${row.class}  streak=${String(row.streak).padStart(2)}  floor=${row.floor.toFixed(2)}\n`);
  }
  process.stdout.write(`deliverable-share=${r.deliverableShare.toFixed(2)}  maxStreak=${r.maxStreak}  (soft governor — no halt emitted)\n`);
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) { main(process.argv).then((c) => process.exit(c)); }
