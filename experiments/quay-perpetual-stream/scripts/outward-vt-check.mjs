// outward-vt-check.mjs — DIR-038-C (eval-rebase fix #1): an UNBOUNDED, OUTWARD VT term. The existing
// VT ruler is `Σ weight·cov` with `cov ∈ [0,1]` — BOUNDED, so it saturates (chart-1 ≈0.93) and can
// only score FILLING pre-enumerated surfaces, never ADDING a capability or being USED externally. Two
// real forms of value scored 0 under it: M45's new document-management capability ("no VT chart cell"),
// and the archguard deployment where quay's own loop autonomously drove real foreign-repo tasks to done.
// This term reads that OUTWARD signal and is NON-SATURATING (a monotone sum of unbounded counts — more
// external deployment / foreign tasks driven / new capabilities always scores strictly higher, no ceiling).
//
// Golden/real oracle: this session's REAL archguard signals (fixtures/outward-vt/archguard-signals.json,
// provenance in the file): 1 external deployment, ~9 foreign tasks the loop drove to done, ≥5 new
// capabilities the cov ruler could not cell. Bounded cov gave these ≈0; the outward term gives non-zero.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Declared, soft weights (revisable at a checkpoint like the cov surface weights). Each signal is an
// UNBOUNDED count (≥0), unlike cov's [0,1] — that is the whole point (an unbounded outward term).
export const DEFAULT_WEIGHTS = { externalDeployments: 10, foreignTasksDriven: 1, newCapabilities: 5 };

function num(x, name) {
  const n = typeof x === "number" ? x : NaN;
  if (!Number.isFinite(n) || n < 0) throw new Error(`outward-vt: '${name}' must be a non-negative number (got ${x})`);
  return n;
}

// ── outwardVT ────────────────────────────────────────────────────────────────────────────────────
// Weighted sum of the unbounded outward signals. No cap — adding external value always raises it.
export function outwardVT(signals, weights = DEFAULT_WEIGHTS) {
  const d = num(signals?.externalDeployments, "externalDeployments");
  const t = num(signals?.foreignTasksDriven, "foreignTasksDriven");
  const c = num(signals?.newCapabilities, "newCapabilities");
  return d * weights.externalDeployments + t * weights.foreignTasksDriven + c * weights.newCapabilities;
}

// ── nonSaturating ────────────────────────────────────────────────────────────────────────────────
// Proves the term is NOT bounded: increasing any signal strictly increases the score, with no fixed
// max. Returns true iff (a) each positive weight makes its signal strictly monotone, and (b) an
// arbitrarily large signal produces an arbitrarily large score (sampled at a big value — no ceiling).
export function nonSaturating(weights = DEFAULT_WEIGHTS) {
  const base = outwardVT({ externalDeployments: 0, foreignTasksDriven: 0, newCapabilities: 0 }, weights);
  if (base !== 0) return false;
  // strict monotonicity per signal
  for (const key of ["externalDeployments", "foreignTasksDriven", "newCapabilities"]) {
    const one = outwardVT({ externalDeployments: 0, foreignTasksDriven: 0, newCapabilities: 0, [key]: 1 }, weights);
    if (!(one > base)) return false;
  }
  // no ceiling: a huge input yields a proportionally huge score (would be impossible for a bounded cov)
  const big = outwardVT({ externalDeployments: 0, foreignTasksDriven: 1e6, newCapabilities: 0 }, weights);
  return big >= 1e6 * weights.foreignTasksDriven;
}

// ── rescore ──────────────────────────────────────────────────────────────────────────────────────
// A concrete re-score: a case the bounded cov ruler scored 0 (no VT cell) gains a NON-ZERO outward
// value. Returns { cov, outward, rescued } for a case contributing `newCapabilities` new capability(ies).
export function rescore(covScore, newCapabilities, weights = DEFAULT_WEIGHTS) {
  const outward = outwardVT({ externalDeployments: 0, foreignTasksDriven: 0, newCapabilities }, weights);
  return { cov: covScore, outward, rescued: covScore === 0 && outward > 0 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() { process.stderr.write("Usage: outward-vt-check.mjs <signals.json>\n"); }

export async function main(argv) {
  const files = argv.slice(2).filter((a) => a !== undefined);
  if (files.length !== 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  let signals;
  try { signals = JSON.parse(fs.readFileSync(files[0], "utf8")); }
  catch (e) { process.stderr.write(`ERROR: not valid JSON: ${e.message}\n`); return 2; }
  let term;
  try { term = outwardVT(signals); } catch (e) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  process.stdout.write(`OUTWARD VT TERM = ${term} (unbounded): ${signals.externalDeployments} external deployment(s)×${DEFAULT_WEIGHTS.externalDeployments} + ${signals.foreignTasksDriven} foreign tasks driven×${DEFAULT_WEIGHTS.foreignTasksDriven} + ${signals.newCapabilities} new capabilities×${DEFAULT_WEIGHTS.newCapabilities}\n`);
  // fail-closed if the term is somehow bounded/saturating (a mis-designed replacement)
  if (!nonSaturating()) { process.stdout.write("FAIL: outward term is saturating — it must be unbounded (DIR-038-C)\n"); return 1; }
  process.stdout.write(`  non-saturating: confirmed (a bounded cov cell scored this ≈0; the outward term scores ${term})\n`);
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) { main(process.argv).then((c) => process.exit(c)); }
