#!/usr/bin/env node --experimental-strip-types
// chart-headroom.ts — DIR-063 gap fix (2026-07-24): mechanically extract the current chart's
// remaining headroom from dashboard.md, for use by chart-saturation-check.ts.
//
// Usage: node --experimental-strip-types scripts/chart-headroom.ts [--dashboard <path>] [--json]
// Output: headroom fraction ∈ [0,1], or exit 2 on parse failure (fail-closed — never
//   silently return 0 or 1 on unparseable dashboard).
//
// The headroom definition lives HERE (single-source — ADR-004). OUTER-LOOP.md's self-halt
// step references this script, never re-derives the arithmetic.

import fs from "node:fs";

const DEFAULT_DASHBOARD = "experiments/quay-perpetual-stream/dashboard.md";

export interface HeadroomResult {
  wired: number;
  max: number;
  headroom: number; // (max - wired) / max
}

// ── extractHeadroom — parse the dashboard.md prose table. ──────────────────────────────
export function extractHeadroom(dashboardPath: string): HeadroomResult {
  const text = fs.readFileSync(dashboardPath, "utf-8");

  // Find the chart-2 wired current line: "| **chart-2 wired current ... **/NN wired** | ... **X** |"
  // Pattern: **/NN wired** with NN as the max, then later **X** as the wired current.
  const wiredLineRe = /\*\*chart-2 wired current\s*\([^)]*\)\*\*.*?\*\*\/\s*(\d+(?:\.\d+)?)\s*wired\*\*.*?\*\*\s*(\d+(?:\.\d+)?)\s*\*\*/;
  const match = text.match(wiredLineRe);

  if (!match) {
    throw new Error(
      "chart-headroom: FAIL-CLOSED — could not parse 'chart-2 wired current' line from dashboard. " +
      "Ensure the line matches the expected format: | **chart-2 wired current (...) | | **/NN wired** | | **X** | |"
    );
  }

  const max = parseFloat(match[1]);
  const wired = parseFloat(match[2]);

  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(wired) || wired < 0) {
    throw new Error(
      `chart-headroom: FAIL-CLOSED — parsed max=${max} wired=${wired} (invalid — max must be > 0, wired ≥ 0)`
    );
  }

  const headroom = (max - wired) / max;
  return { wired, max, headroom };
}

// ── main ──────────────────────────────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2);
  let dashboardPath = DEFAULT_DASHBOARD;
  let jsonOut = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dashboard" && i + 1 < args.length) {
      dashboardPath = args[++i];
    } else if (args[i] === "--json") {
      jsonOut = true;
    } else if (args[i] === "--selftest") {
      selftest();
      return;
    }
  }

  try {
    const result = extractHeadroom(dashboardPath);
    if (jsonOut) {
      console.log(JSON.stringify(result));
    } else {
      console.log(String(result.headroom));
    }
  } catch (e: any) {
    console.error(`chart-headroom: ${e.message}`);
    process.exit(2);
  }
}

// ── selftest ──────────────────────────────────────────────────────────────────────────
export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  // GREEN 1: parse the real dashboard
  try {
    const result = extractHeadroom(DEFAULT_DASHBOARD);
    check("parse-real-dashboard", result.max > 0 && result.wired >= 0 && result.headroom >= 0 && result.headroom <= 1,
      `max=${result.max}, wired=${result.wired}, headroom=${result.headroom}`);
  } catch (e: any) {
    check("parse-real-dashboard", false, `exception: ${e.message}`);
  }

  // GREEN 2: known values from a synthetic dashboard
  const tmpDir = fs.mkdtempSync("chart-headroom-selftest-");
  const tmpFile = `${tmpDir}/dashboard.md`;
  try {
    fs.writeFileSync(tmpFile,
      "| **chart-2 wired current (S1+S2+S3, after m130)** | | **/85 wired** | | **42.5** | |\n"
    );
    const r = extractHeadroom(tmpFile);
    check("known-values-42.5/85", r.max === 85 && r.wired === 42.5 && Math.abs(r.headroom - 0.5) < 0.001,
      `headroom=${r.headroom}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // RED 1: missing line → throws
  const tmpDir2 = fs.mkdtempSync("chart-headroom-selftest-");
  const tmpFile2 = `${tmpDir2}/dashboard.md`;
  try {
    fs.writeFileSync(tmpFile2, "no chart line here\n");
    try {
      extractHeadroom(tmpFile2);
      check("missing-line-throws", false, "should have thrown");
    } catch (e: any) {
      check("missing-line-throws", true, "threw as expected (fail-closed)");
    }
  } finally {
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }

  // RED 2: zero max → throws
  const tmpDir3 = fs.mkdtempSync("chart-headroom-selftest-");
  const tmpFile3 = `${tmpDir3}/dashboard.md`;
  try {
    fs.writeFileSync(tmpFile3,
      "| **chart-2 wired current (S1+S2+S3, after m130)** | | **/0 wired** | | **0** | |\n"
    );
    try {
      extractHeadroom(tmpFile3);
      check("zero-max-throws", false, "should have thrown");
    } catch (e: any) {
      check("zero-max-throws", true, "threw as expected (fail-closed)");
    }
  } finally {
    fs.rmSync(tmpDir3, { recursive: true, force: true });
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

main();