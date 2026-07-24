#!/usr/bin/env node --experimental-strip-types
// termination-delta-v-check.ts — CRYST-D3 R7 (2026-07-24): mechanically determine
// whether the ΔV < ε (0.02) for K=2 consecutive termination condition is met.
//
// This is ONE of the five §3.2 termination conditions (inherited-core.md):
// "ΔV<0.02 both-layers K=2 consecutive"
//
// Usage: node --experimental-strip-types scripts/termination-delta-v-check.ts
//   --dashboard <path> [--json]
//
// Reads the dashboard VT curve lines, extracts the last K=2 Δv values, and checks
// if all are < ε (0.02). Returns TERMINATION-DUE if the condition is met, OK otherwise.
// FAIL-CLOSED: exits 2 on unparseable dashboard.
//
// Single-source (ADR-004): this module IS the definition of the ΔV termination check.
// OUTER-LOOP.md's step 5 termination conditions reference it, never re-derive the logic.

import fs from "node:fs";

const DEFAULT_DASHBOARD = "experiments/quay-perpetual-stream/dashboard.md";
const EPSILON_DELTA_V = 0.02;
const K_CONSECUTIVE = 2;

export interface TerminationDeltaVResult {
  verdict: "TERMINATION-DUE" | "OK";
  lastK: number[];          // last K Δv values (most recent first)
  epsilon: number;
  consecutiveBelowThreshold: number;
}

// ── extractDeltaVs ────────────────────────────────────────────────────────────────────
// Extract Δv values from dashboard VT curve lines.
// VT curve format: (m121/..., Δv=+6.0 ..., (m122/..., Δv=+12.0 ..., (m126/..., Δv=+10.0 ...) ]`
function extractDeltaVs(dashboardPath: string): number[] {
  const text = fs.readFileSync(dashboardPath, "utf-8");

  // Find the VT curve (append, chart-2 basis) section
  const curveSection = text.split("VT curve (append, chart-2 basis)")[1];
  if (!curveSection) {
    throw new Error("termination-delta-v-check: FAIL-CLOSED — no chart-2 VT curve found in dashboard");
  }

  // Extract Δv values: Δv=+6.0, Δv=+12.0, Δv=+10.0, etc.
  const deltaVRe = /Δv=([+-]?\d+(?:\.\d+)?)/g;
  const values: number[] = [];
  let match;
  while ((match = deltaVRe.exec(curveSection)) !== null) {
    const v = parseFloat(match[1]);
    if (Number.isFinite(v)) {
      values.push(Math.abs(v)); // use absolute value for below-threshold check
    }
  }

  if (values.length === 0) {
    throw new Error("termination-delta-v-check: FAIL-CLOSED — no Δv values found in chart-2 VT curve");
  }

  return values.reverse(); // oldest first → newest last
}

// ── check ─────────────────────────────────────────────────────────────────────────────
export function check(dashboardPath: string): TerminationDeltaVResult {
  const all = extractDeltaVs(dashboardPath);
  const lastK = all.slice(-K_CONSECUTIVE).reverse(); // most recent first

  if (lastK.length < K_CONSECUTIVE) {
    // Not enough data points — cannot confirm termination
    return {
      verdict: "OK",
      lastK,
      epsilon: EPSILON_DELTA_V,
      consecutiveBelowThreshold: 0,
    };
  }

  let consecutive = 0;
  for (const dv of lastK) {
    if (dv < EPSILON_DELTA_V) consecutive++;
    else break;
  }

  const verdict = consecutive >= K_CONSECUTIVE ? "TERMINATION-DUE" : "OK";
  return { verdict, lastK, epsilon: EPSILON_DELTA_V, consecutiveBelowThreshold: consecutive };
}

// ── selftest ──────────────────────────────────────────────────────────────────────────
export function selftest(): boolean {
  let allPassed = true;
  function check_ok(name: string, condition: boolean, detail: string): void {
    if (condition) console.log(`SELFTEST PASS: ${name} — ${detail}`);
    else { console.error(`SELFTEST FAIL: ${name} — ${detail}`); allPassed = false; }
  }

  // GREEN 1: real dashboard
  try {
    const r = check(DEFAULT_DASHBOARD);
    check_ok("real-dashboard", r.verdict === "OK" || r.verdict === "TERMINATION-DUE",
      `verdict=${r.verdict}, lastK=[${r.lastK}], consecutive=${r.consecutiveBelowThreshold}`);
  } catch (e: any) {
    check_ok("real-dashboard", false, `exception: ${e.message}`);
  }

  // GREEN 2: two consecutive below-threshold → TERMINATION-DUE
  const tmpDir = fs.mkdtempSync("term-dv-selftest-");
  try {
    fs.writeFileSync(`${tmpDir}/dashboard.md`,
      "VT curve (append, chart-2 basis): `[" +
      "(m121/..., Δv=+0.001 ...), " +
      "(m122/..., Δv=+0.005 ...) ]`"
    );
    const r = check(`${tmpDir}/dashboard.md`);
    check_ok("two-below-threshold", r.verdict === "TERMINATION-DUE" && r.consecutiveBelowThreshold === 2,
      `verdict=${r.verdict}, lastK=[${r.lastK}]`);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }

  // GREEN 3: mixed (one above, one below) → OK
  const tmpDir2 = fs.mkdtempSync("term-dv-selftest-");
  try {
    fs.writeFileSync(`${tmpDir2}/dashboard.md`,
      "VT curve (append, chart-2 basis): `[" +
      "(m121/..., Δv=+0.001 ...), " +
      "(m122/..., Δv=+6.0 ...) ]`"
    );
    const r = check(`${tmpDir2}/dashboard.md`);
    check_ok("mixed-above-below", r.verdict === "OK",
      `verdict=${r.verdict}, lastK=[${r.lastK}]`);
  } finally { fs.rmSync(tmpDir2, { recursive: true, force: true }); }

  // RED 1: missing dashboard
  try {
    check("/nonexistent/path/dashboard.md");
    check_ok("missing-dashboard-throws", false, "should have thrown");
  } catch (e: any) {
    check_ok("missing-dashboard-throws", true, "threw as expected (fail-closed)");
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

// ── main ──────────────────────────────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2);
  let dashboardPath = DEFAULT_DASHBOARD;
  let jsonOut = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dashboard" && i + 1 < args.length) dashboardPath = args[++i];
    else if (args[i] === "--json") jsonOut = true;
    else if (args[i] === "--selftest") { selftest(); return; }
  }

  try {
    const r = check(dashboardPath);
    if (jsonOut) console.log(JSON.stringify(r));
    else console.log(r.verdict);
    process.exit(r.verdict === "TERMINATION-DUE" ? 1 : 0);
  } catch (e: any) {
    console.error(`termination-delta-v-check: ${e.message}`);
    process.exit(2);
  }
}

main();