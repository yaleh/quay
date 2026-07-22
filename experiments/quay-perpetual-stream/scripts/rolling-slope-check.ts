// rolling-slope-check.ts — DIR-038-A (eval-rebase fix #3): the self-halt VT slope over a rolling
// window of the LAST K milestones INCLUDING zero-Δv ones. This is the SINGLE SOURCE of "the
// halt-relevant slope", retiring the qualifying-only denominator that averaged ONLY the nonzero
// (capability-growth) milestones and so froze at 3.80 forever — structurally blind to a stall
// (16 consecutive zero-VT milestones M34–M49 never tripped the `< +1.0` self-halt threshold).
//
// The honest number the stream ALREADY hand-computed as a cross-check (dashboard.md §341(d)) is the
// golden oracle: recent window m29–m35 = 0.90 total / 7 → ≈0.643 per 5; m41–m49 ≈ 0. The
// qualifying-only artifact is 22.82/6 = 3.803. This module reproduces both from a recorded Δv
// sequence and feeds the ROLLING one (not 3.80) to the halt evaluation.
//
// NON-WAIVABLE monotonicity guardrail (DIR-038 anti-gaming): a re-based ruler that scores the loop
// BETTER (a HIGHER slope, less likely to halt) than the retired qualifying-only figure is presumptively
// gaming. The guard is `honestNotInflated` and it FAILS-LOUD (CLI exit 1) whenever the rolling slope
// exceeds the qualifying-only slope. NOTE (per the DIR-038-A adversarial audit): this is NOT a
// structural identity — rolling (last-K incl. zeros) and qualifying (all nonzero) average DIFFERENT
// subsets, so `rolling > qualifying` is arithmetically possible for some sequences; the guard exists
// precisely to CATCH those and flag them, not because the inequality holds by construction.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const HALT_THRESHOLD = 1.0; // OUTER-LOOP.md self-halt: VT slope < +1.0 (per 5) → HALT-RECOMMENDED
export const DEFAULT_K = 7;        // rolling window; K ≥ 5 (the stream's recent-window convention)

export interface HaltVerdictResult {
  slope: number;
  slopePer5: number;
  halt: boolean;
}

function assertDeltas(deltas: number[]): void {
  if (!Array.isArray(deltas) || deltas.length === 0) {
    throw new Error("rolling-slope-check: deltas must be a non-empty array of per-milestone Δv numbers");
  }
  for (const d of deltas) {
    if (typeof d !== "number" || Number.isNaN(d)) throw new Error(`rolling-slope-check: non-numeric Δv "${d}"`);
  }
}

// ── windowSlope ──────────────────────────────────────────────────────────────────────────────────
// Mean per-milestone Δv over the last K entries (zeros INCLUDED) — the honest denominator.
export function windowSlope(deltas: number[], K: number = DEFAULT_K): number {
  assertDeltas(deltas);
  const w = deltas.slice(-Math.max(1, K));
  return w.reduce((a, b) => a + b, 0) / w.length;
}

// The dashboard's "Δv per 5 milestones" form (× 5). This is the number the self-halt threshold (+1.0)
// is stated against.
export function windowSlopePer5(deltas: number[], K: number = DEFAULT_K): number {
  return windowSlope(deltas, K) * 5;
}

// ── qualifyingSlope ──────────────────────────────────────────────────────────────────────────────
// The OLD, WRONG computation, kept ONLY so the golden-replay + monotonicity guard can compare against
// it: mean of the NONZERO deltas (zeros excluded from the denominator) — the 3.80 artifact.
export function qualifyingSlope(deltas: number[]): number {
  assertDeltas(deltas);
  const nz = deltas.filter((d) => d !== 0);
  if (nz.length === 0) return 0;
  return nz.reduce((a, b) => a + b, 0) / nz.length;
}

// ── monotonicity guardrail (NON-WAIVABLE) ────────────────────────────────────────────────────────
// The honest rolling slope must not EXCEED the qualifying-only slope. Returns true if honest ≤ qual.
export function honestNotInflated(deltas: number[], K: number = DEFAULT_K): boolean {
  return windowSlope(deltas, K) <= qualifyingSlope(deltas) + 1e-9;
}

// ── halt verdict ─────────────────────────────────────────────────────────────────────────────────
// Compares the ROLLING per-milestone slope to the threshold (the same unit cp-65 compares the 3.80
// qualifying figure against). halt=true = HALT-RECOMMENDED. Returns the per-5 form too (the
// dashboard's reporting convention). This is what a checkpoint must report — never the 3.80 artifact.
export function haltVerdict(deltas: number[], { K = DEFAULT_K, threshold = HALT_THRESHOLD }: { K?: number; threshold?: number } = {}): HaltVerdictResult {
  const slope = windowSlope(deltas, K);
  return { slope, slopePer5: slope * 5, halt: slope < threshold };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// Reads a JSON array of per-milestone Δv (a data file, e.g. fixtures) and prints the honest rolling
// slope + halt verdict + the (retired) qualifying-only figure for contrast. Exit: 0 always for a
// well-formed sequence (the verdict is informational — the loop acts on `halt`); 1 if the monotonicity
// guardrail is violated (a re-based ruler that inflated the number — a gaming signal); 2 usage error.
function usage(): void { process.stderr.write("Usage: rolling-slope-check.ts [--k <N>] <deltas.json>\n"); }

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let K = DEFAULT_K;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--k") { K = Number(args[++i]); continue; }
    files.push(args[i]);
  }
  if (files.length !== 1 || !Number.isInteger(K) || K < 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  let deltas: number[];
  try { deltas = JSON.parse(fs.readFileSync(files[0], "utf8")); }
  catch (e: any) { process.stderr.write(`ERROR: not valid JSON: ${e.message}\n`); return 2; }
  let v: HaltVerdictResult;
  try { v = haltVerdict(deltas, { K }); } catch (e: any) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  const qual = qualifyingSlope(deltas);
  process.stdout.write(`ROLLING SLOPE (honest, last ${K} incl. zeros): ${v.slope.toFixed(3)} /milestone (${v.slopePer5.toFixed(3)} per 5) — ${v.halt ? "HALT-RECOMMENDED (< " + HALT_THRESHOLD + ")" : "above threshold"}\n`);
  process.stdout.write(`  qualifying-only (RETIRED artifact): ${qual.toFixed(3)} /qualifying-milestone — do NOT use for the halt\n`);
  if (!honestNotInflated(deltas, K)) {
    process.stdout.write("MONOTONICITY VIOLATION: honest rolling slope EXCEEDS the qualifying-only slope — a re-based ruler must never score the loop better (gaming signal)\n");
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) { main(process.argv).then((c) => process.exit(c)); }
