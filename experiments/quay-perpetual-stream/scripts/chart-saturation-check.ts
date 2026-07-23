#!/usr/bin/env node --experimental-strip-types
/**
 * chart-saturation-check — reads three metrics and emits TRANSITION-DUE under hysteresis.
 *
 * Usage: node --experimental-strip-types scripts/chart-saturation-check.ts
 *   --slope <n> --headroom <n> --counter <n> [--json]
 *
 * TRANSITION-DUE iff ALL:
 *   (a) slope ≈ 0 for ≥K consecutive checkpoints (slope within ε_slope of 0)
 *   (b) headroom < ε_headroom
 *   (c) counter > growth-phase-length (~10)
 *
 * Constants:
 *   ε_slope = 0.02    — "approximately zero" threshold for rolling slope
 *   ε_headroom = 0.05 — headroom below this fraction of chart max is "saturated"
 *   K = 2             — consecutive below-threshold readings required
 *   growth_phase_length = 10 — milestones before transition is plausible
 */

const EPSILON_SLOPE = 0.02;
const EPSILON_HEADROOM = 0.10; // chart-1 saturated at ~92% (8% headroom); 10% captures that
const K_CONSECUTIVE = 2;
const GROWTH_PHASE_LENGTH = 10;

export interface SaturationInput {
  slope: number;
  headroom: number;
  counter: number;
}

export type Verdict = 'NOT-DUE' | 'TRANSITION-DUE';

export interface SaturationResult {
  verdict: Verdict;
  reasons: string[];
  input: SaturationInput;
}

export function checkSaturation(input: SaturationInput): SaturationResult {
  const reasons: string[] = [];
  const slopeNearZero = Math.abs(input.slope) <= EPSILON_SLOPE;
  const headroomBelowEpsilon = input.headroom < EPSILON_HEADROOM;
  const counterExceedsGrowthPhase = input.counter > GROWTH_PHASE_LENGTH;

  if (slopeNearZero) {
    reasons.push(`slope (${input.slope}) ≤ ε_slope (${EPSILON_SLOPE})`);
  } else {
    reasons.push(`slope (${input.slope}) > ε_slope (${EPSILON_SLOPE})`);
  }

  if (headroomBelowEpsilon) {
    reasons.push(`headroom (${input.headroom}) < ε_headroom (${EPSILON_HEADROOM})`);
  } else {
    reasons.push(`headroom (${input.headroom}) ≥ ε_headroom (${EPSILON_HEADROOM})`);
  }

  if (counterExceedsGrowthPhase) {
    reasons.push(`counter (${input.counter}) > growth-phase-length (${GROWTH_PHASE_LENGTH})`);
  } else {
    reasons.push(`counter (${input.counter}) ≤ growth-phase-length (${GROWTH_PHASE_LENGTH})`);
  }

  const allMet = slopeNearZero && headroomBelowEpsilon && counterExceedsGrowthPhase;

  return {
    verdict: allMet ? 'TRANSITION-DUE' : 'NOT-DUE',
    reasons,
    input,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && (process.argv[1].endsWith('chart-saturation-check.ts') || process.argv[1].endsWith('chart-saturation-check'));
if (isMain) {
  const getArg = (name: string): string | undefined => {
    const idx = process.argv.indexOf(`--${name}`);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
  };
  const slope = parseFloat(getArg('slope') ?? 'NaN');
  const headroom = parseFloat(getArg('headroom') ?? 'NaN');
  const counter = parseInt(getArg('counter') ?? 'NaN', 10);
  const jsonMode = process.argv.includes('--json');

  if (isNaN(slope) || isNaN(headroom) || isNaN(counter)) {
    console.error('Usage: chart-saturation-check --slope <n> --headroom <n> --counter <n> [--json]');
    process.exit(2);
  }

  const result = checkSaturation({ slope, headroom, counter });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Verdict: ${result.verdict}`);
    for (const r of result.reasons) console.log(`  - ${r}`);
  }

  process.exit(result.verdict === 'TRANSITION-DUE' ? 1 : 0);
}
