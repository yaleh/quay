#!/usr/bin/env node --experimental-strip-types
/**
 * anti-gaming-guard — validates candidate value surfaces for chart transitions.
 *
 * A candidate surface PASSes iff:
 *   (a) cov source is machine-verifiable, capped, un-inflatable
 *       (CI exit-code / GateEvent / registry-bounded — not subjective judgment)
 *   AND
 *   (b) old chart's residual headroom has an explicit adjudication recorded
 *       (pursue / abandon / fold into new chart) — never silently skipped
 *
 * Usage: node --experimental-strip-types scripts/anti-gaming-guard.ts
 *   --cov-source <machine|subjective> --cov-capped <true|false> --cov-inflatable <true|false>
 *   --adjudication <pursue|abandon|fold|none> [--json]
 */

export interface CandidateSurface {
  /** How the cov is sourced: 'machine' = CI-exit/GateEvent/registry-bounded; 'subjective' = human judgment */
  covSource: 'machine' | 'subjective';
  /** Whether the cov is capped (has an upper bound) */
  covCapped: boolean;
  /** Whether the cov measure is inflatable (can be gamed by adding spurious items) */
  covInflatable: boolean;
  /** Residual headroom adjudication for the old chart */
  adjudication: 'pursue' | 'abandon' | 'fold' | 'none';
}

export interface GuardResult {
  pass: boolean;
  failures: string[];
  surface: CandidateSurface;
}

export function validateSurface(surface: CandidateSurface): GuardResult {
  const failures: string[] = [];

  // (a) cov must be machine-verifiable
  if (surface.covSource !== 'machine') {
    failures.push(`cov source is '${surface.covSource}' — must be 'machine' (CI-exit/GateEvent/registry-bounded)`);
  }

  // (a) cov must be capped
  if (!surface.covCapped) {
    failures.push('cov is uncapped — must have an explicit ceiling (e.g., /N registry entries)');
  }

  // (a) cov must not be inflatable
  if (surface.covInflatable) {
    failures.push('cov is inflatable — can be gamed by adding spurious items; must use a fixed denominator');
  }

  // (b) residual headroom must have an explicit adjudication
  if (surface.adjudication === 'none') {
    failures.push('no residual-headroom adjudication recorded — must state pursue/abandon/fold for old chart headroom');
  }

  return {
    pass: failures.length === 0,
    failures,
    surface,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && (process.argv[1].endsWith('anti-gaming-guard.ts') || process.argv[1].endsWith('anti-gaming-guard'));
if (isMain) {
  const getArg = (name: string): string | undefined => {
    const idx = process.argv.indexOf(`--${name}`);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
  };
  const jsonMode = process.argv.includes('--json');

  const surface: CandidateSurface = {
    covSource: (getArg('cov-source') as 'machine' | 'subjective') || 'subjective',
    covCapped: getArg('cov-capped') !== 'false',
    covInflatable: getArg('cov-inflatable') === 'true',
    adjudication: (getArg('adjudication') as 'pursue' | 'abandon' | 'fold' | 'none') || 'none',
  };

  const result = validateSurface(surface);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Verdict: ${result.pass ? 'PASS' : 'REJECT'}`);
    for (const f of result.failures) {
      console.log(`  FAIL: ${f}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}
