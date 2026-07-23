#!/usr/bin/env node --experimental-strip-types
/**
 * milestones-since-transition — computes the counter from dashboard.md's chart-transition history.
 *
 * Reads chart-transition markers from dashboard.md and returns how many milestones have elapsed
 * since the last chart transition.
 *
 * Usage: node --experimental-strip-types scripts/milestones-since-transition.ts [--json]
 *   Outputs: counter=<N> (exits 0)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ → quay-perpetual-stream/ → experiments/ → quay/
const repoRoot = resolve(__dirname, '../../..');
export const GROWTH_PHASE_LENGTH = 10;

export interface TransitionHistory {
  currentChart: number;
  lastTransitionMilestone: number;
  milestonesSinceTransition: number;
  currentMilestone: number;
}

/**
 * Parse dashboard.md to extract chart transition history.
 * Looks for:
 *   - "Chart-N transition" markers (e.g., "chart: 1→2 at M121")
 *   - chart: N in the header
 *   - milestone_counter: N in the header
 */
export function compute(dashboardPath?: string): TransitionHistory {
  const path = dashboardPath ?? resolve(repoRoot, 'experiments/quay-perpetual-stream/dashboard.md');
  const content = readFileSync(path, 'utf-8');

  // Find chart transitions: "chart: 1→2 at M121" or "Chart-N transition"
  const transitionPattern = /chart:\s*(\d+)\s*→\s*(\d+)\s+at\s+M(\d+)/gi;
  const transitions: { from: number; to: number; milestone: number }[] = [];
  let match;
  while ((match = transitionPattern.exec(content)) !== null) {
    transitions.push({ from: parseInt(match[1]), to: parseInt(match[2]), milestone: parseInt(match[3]) });
  }

  // Also check for "Chart-1 transition" / "Chart-2 transition" section headers
  const chartTransitionHeaders = /###\s+Chart-(\d+)\s+transition/gi;
  while ((match = chartTransitionHeaders.exec(content)) !== null) {
    // Parse the section to find milestone context
  }

  // Find current chart from header: **chart: N**
  const chartMatch = content.match(/\*\*chart:\s*(\d+)\*\*/);
  const currentChart = chartMatch ? parseInt(chartMatch[1]) : 0;

  // Find current milestone counter
  const counterMatch = content.match(/\*\*milestone_counter:\s*(\d+)\*\*/);
  const currentMilestone = counterMatch ? parseInt(counterMatch[1]) : 0;

  // Sort transitions by milestone to find the last one
  transitions.sort((a, b) => a.milestone - b.milestone);

  // Chart-1 opened at m3 (DIR-001), chart-2 at M121 (DIR-064)
  // Hard-code known transition points as fallback
  const knownTransitions = [
    { chart: 1, milestone: 3 },   // chart-1 opened at m3
    { chart: 2, milestone: 121 }, // chart-2 opened at M121
  ];

  // Find last chart transition from dashboard markers
  let lastTransitionMilestone = 3; // chart-1 opened at m3
  if (transitions.length > 0) {
    lastTransitionMilestone = transitions[transitions.length - 1].milestone;
  } else if (currentChart >= 2) {
    lastTransitionMilestone = 121; // chart-2 at M121
  }

  return {
    currentChart,
    lastTransitionMilestone,
    milestonesSinceTransition: currentMilestone - lastTransitionMilestone,
    currentMilestone,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && (process.argv[1].endsWith('milestones-since-transition.ts') || process.argv[1].endsWith('milestones-since-transition'));
if (isMain) {
  const jsonMode = process.argv.includes('--json');
  const result = compute();

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`milestones-since-transition: ${result.milestonesSinceTransition}`);
    console.log(`  current chart: ${result.currentChart}`);
    console.log(`  last transition: M${result.lastTransitionMilestone}`);
    console.log(`  current milestone: ${result.currentMilestone}`);
    console.log(`  growth-phase-length threshold: ${GROWTH_PHASE_LENGTH}`);
  }

  process.exit(0);
}
