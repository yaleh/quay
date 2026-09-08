#!/usr/bin/env node
// git-lens-l-s-behavior-variance.ts — L_S (stability) convergence proxy, ADR-007/exp5-M-CRYST-G1.
//
// Reports BEHAVIOR VARIANCE for a touched module: a lightweight mutation-testing-style probe that
// (a) runs the module's existing test file once (baseline), (b) applies a small set of MECHANICAL
// source mutations (operator/literal flips — a tiny mutation-testing kernel, not a full mutation
// framework), re-running the SAME tests after each mutation, and (c) reports the fraction of
// mutants the test suite KILLED (test failed, as it should) vs SURVIVED (test still passed despite
// the behavior change — a stability/coverage gap signal). This module IS the rule: pure functions
// for mutation generation + a thin CLI orchestration. If this header and the code ever disagree,
// THE CODE WINS.
//
// ── The rule ───────────────────────────────────────────────────────────────────────────────────
// mutationScore = killed / total_mutants  (1.0 = fully stable under this probe's mutant set; lower
// = tests do not actually pin the module's behavior, i.e. HIGH variance / low stability). FLAG when
// mutationScore < FLAG_THRESHOLD (default 0.5) AND total_mutants > 0. Zero mutants generated (e.g.
// no matching operators/literals in the file) reports verdict "N/A".
//
// Usage:
//   git-lens-l-s-behavior-variance.ts <module-file> <test-file> [--node-test-cmd "node --test <f>"]
//
// Exit codes: 0 = PASS (mutationScore >= threshold) or N/A; 1 = FLAGGED (low mutation score).

import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { isDirectEntry } from './gate-script-base.ts';

export const FLAG_THRESHOLD = 0.5;

export interface MutationOperator {
  name: string;
  re: RegExp;
  to: string;
}

export interface Mutant {
  name: string;
  mutatedSource: string;
  start: number;
  end: number;
}

export interface ProbeResult {
  totalMutants: number;
  killed: number;
  survived: number;
  survivedNames?: string[];
  mutationScore: number | null;
  verdict: string;
  flagged: boolean;
  baselinePass: boolean;
}

// A small, deliberately conservative set of mechanical mutation operators — each is a regex
// substitution applied ONCE per match, producing one mutant per match. Kept intentionally simple
// (a real mutation-testing framework is out of scope; this is a cheap proxy, not a replacement).
export const MUTATION_OPERATORS: MutationOperator[] = [
  { name: 'flip-strict-equal', re: /===/g, to: '!==' },
  { name: 'flip-strict-not-equal', re: /!==/g, to: '===' },
  { name: 'flip-and-or', re: /&&/g, to: '||' },
  { name: 'flip-or-and', re: /\|\|/g, to: '&&' },
  { name: 'flip-lt-gte', re: /(?<![<>=!])</g, to: '>=' },
  { name: 'flip-gt-lte', re: /(?<![<>=!])>/g, to: '<=' },
];

// ── generateMutants — pure function: source text -> [{name, mutatedSource, index}] ───────────────
export function generateMutants(source: string): Mutant[] {
  const mutants: Mutant[] = [];
  for (const op of MUTATION_OPERATORS) {
    let match: RegExpExecArray | null;
    const re = new RegExp(op.re.source, op.re.flags);
    let count = 0;
    while ((match = re.exec(source))) {
      const start = match.index;
      const end = start + match[0].length;
      const mutatedSource = source.slice(0, start) + op.to + source.slice(end);
      mutants.push({ name: `${op.name}#${count}`, mutatedSource, start, end });
      count++;
      // Only mutate one occurrence per (operator, position) pass to keep the mutant count bounded;
      // re.lastIndex already advanced past this match for the next iteration.
    }
  }
  return mutants;
}

// ── runTest — run a test command, return true if it exits 0 (tests PASS) ─────────────────────────
function runTest(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── probe — orchestrate: for each mutant, write it, run tests, restore original, classify ────────
export function probe(moduleFile: string, testCmd: string): ProbeResult {
  const original = readFileSync(moduleFile, 'utf8');
  const backup = `${moduleFile}.l-s-backup`;
  copyFileSync(moduleFile, backup);

  const baselinePass = runTest(testCmd);
  if (!baselinePass) {
    unlinkSync(backup);
    return { totalMutants: 0, killed: 0, survived: 0, mutationScore: null, verdict: 'N/A (baseline test does not pass)', flagged: false, baselinePass };
  }

  const mutants = generateMutants(original);
  let killed = 0;
  let survived = 0;
  const survivedNames: string[] = [];
  try {
    for (const mutant of mutants) {
      writeFileSync(moduleFile, mutant.mutatedSource);
      const testsPass = runTest(testCmd);
      if (testsPass) {
        survived++;
        survivedNames.push(mutant.name);
      } else {
        killed++;
      }
    }
  } finally {
    copyFileSync(backup, moduleFile);
    unlinkSync(backup);
  }

  const total = mutants.length;
  if (total === 0) {
    return { totalMutants: 0, killed: 0, survived: 0, mutationScore: null, verdict: 'N/A (no mutants generated)', flagged: false, baselinePass };
  }
  const mutationScore = killed / total;
  const flagged = mutationScore < FLAG_THRESHOLD;
  return {
    totalMutants: total,
    killed,
    survived,
    survivedNames,
    mutationScore,
    verdict: flagged ? 'FLAGGED (low mutation score / high variance)' : 'PASS',
    flagged,
    baselinePass,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const [moduleFile, testFile] = args;
  if (!moduleFile || !testFile) {
    console.error('Usage: git-lens-l-s-behavior-variance.ts <module-file> <test-file>');
    process.exit(2);
  }
  if (!existsSync(moduleFile) || !existsSync(testFile)) {
    console.error(`ERROR: module or test file not found (${moduleFile}, ${testFile})`);
    process.exit(2);
  }
  const testCmd = `node --test ${JSON.stringify(testFile)}`;
  const result = probe(moduleFile, testCmd);
  console.log(`L_S behavior-variance — module=${moduleFile} totalMutants=${result.totalMutants} killed=${result.killed} survived=${result.survived} mutationScore=${result.mutationScore === null ? 'N/A' : result.mutationScore.toFixed(3)} verdict=${result.verdict}`);
  if (result.survivedNames && result.survivedNames.length) {
    console.log(`  surviving mutants: ${result.survivedNames.join(', ')}`);
  }
  process.exit(result.flagged ? 1 : 0);
}

if (isDirectEntry(import.meta, undefined, "git-lens-l-s-behavior-variance")) {
  main();
}
