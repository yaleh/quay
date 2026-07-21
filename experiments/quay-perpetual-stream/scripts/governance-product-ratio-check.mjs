// governance-product-ratio-check.mjs — DIR-038-B (eval-rebase fix #2): the governance:product ratio
// as a first-class checkpoint health signal, wired to the HARD self-halt "degradation" clause. The
// value-typed ledger counts governance-integrity / risk-option / discovery / instrument-correction as
// value while "not touching VT", so a loop can spend thousands of lines building its OWN instruments
// while the product freezes and NOTHING trips the halt. This check makes that runaway a mechanical
// degradation signal: governance-lines : product-lines over a window; a breach of the declared
// threshold CAN trip HALT-RECOMMENDED (not just be narrated).
//
// Golden oracle (recorded, DIR-038 finding #2): the restart window was governance:product ≈ 8:1
// (≈6249 governance : 756 product lines). PRODUCT = the shippable quay itself (`packages/`, `plugin/`);
// GOVERNANCE = the loop's own method/eval instruments + narrative (`experiments/`, `docs/`, `tasks/`,
// `adr/`, root docs). The ratio is governance ÷ product.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Default breach threshold: governance may be up to 5× product before it reads as degradation. Generous
// on purpose — exp5's explore-cadence legitimately runs method-infra milestones; this catches a RUNAWAY
// (the recorded 8.27), not ordinary instrument work. Tunable via --threshold.
export const DEFAULT_THRESHOLD = 5.0;

// ── classifyPath ─────────────────────────────────────────────────────────────────────────────────
// PRODUCT = shippable product CODE (a non-prose file under packages/ or plugin/). GOVERNANCE =
// everything else — the method/eval layer AND all PROSE (.md/.txt/…) WHEREVER it lives, INCLUDING
// under packages/ or plugin/. Classifying by directory alone let prose be laundered into "product" by
// parking a .md under packages/ (DIR-038-B adversarial-audit finding: the recorded 8:1 runaway
// collapsed to 0.78:1). So a prose extension is GOVERNANCE regardless of directory — this is a
// code:prose ratio, not a directory ratio.
const PROSE_EXT = /\.(md|markdown|txt|rst|adoc)$/i;
export function classifyPath(p) {
  const s = String(p).replace(/^\.\//, "");
  if (PROSE_EXT.test(s)) return "governance";                            // prose is governance wherever it lives
  if (s.startsWith("packages/") || s.startsWith("plugin/")) return "product";
  return "governance";
}

// ── sumByClass ───────────────────────────────────────────────────────────────────────────────────
// entries: [{ path, added }]. Returns { governance, product } total added-line counts.
export function sumByClass(entries) {
  if (!Array.isArray(entries)) throw new Error("governance-product-ratio: entries must be an array of {path, added}");
  const totals = { governance: 0, product: 0 };
  for (const e of entries) {
    const added = Number(e?.added);
    if (!Number.isFinite(added) || added < 0) throw new Error(`governance-product-ratio: bad 'added' for ${e?.path}`);
    totals[classifyPath(e?.path)] += added;
  }
  return totals;
}

// ── ratio ────────────────────────────────────────────────────────────────────────────────────────
// governance ÷ product. product === 0 with governance > 0 → Infinity (pure-governance window = maximal
// degradation). both 0 → 0 (no activity).
export function ratio({ governance, product }) {
  if (typeof governance !== "number" || typeof product !== "number" || governance < 0 || product < 0) {
    throw new Error("governance-product-ratio: governance/product must be non-negative numbers");
  }
  if (product === 0) return governance === 0 ? 0 : Infinity;
  return governance / product;
}

// ── isBreach / haltInput ─────────────────────────────────────────────────────────────────────────
export function isBreach(r, threshold = DEFAULT_THRESHOLD) {
  return r > threshold;
}

// The halt-evaluation input: a breach IS degradation → can trip HALT-RECOMMENDED (OUTER-LOOP self-halt
// "hypothesis-falsified / degradation across tracks" clause).
export function haltInput(totals, { threshold = DEFAULT_THRESHOLD } = {}) {
  const r = ratio(totals);
  return { ratio: r, threshold, halt: isBreach(r, threshold) };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// Reads either a pre-totaled {governance, product} JSON or an array of {path, added} numstat entries
// (the driver produces the latter from `git diff --numstat <range>`). Exit: 0 = within threshold;
// 1 = BREACH (governance runaway → degradation, a halt input); 2 = usage/parse error.
function usage() { process.stderr.write("Usage: governance-product-ratio-check.mjs [--threshold <N>] <window.json>\n"); }

export async function main(argv) {
  const args = argv.slice(2);
  let threshold = DEFAULT_THRESHOLD;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--threshold") { threshold = Number(args[++i]); continue; }
    files.push(args[i]);
  }
  if (files.length !== 1 || !Number.isFinite(threshold) || threshold <= 0) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  let data;
  try { data = JSON.parse(fs.readFileSync(files[0], "utf8")); }
  catch (e) { process.stderr.write(`ERROR: not valid JSON: ${e.message}\n`); return 2; }
  let totals;
  try { totals = Array.isArray(data) ? sumByClass(data) : data; } catch (e) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  let v;
  try { v = haltInput(totals, { threshold }); } catch (e) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  const rStr = v.ratio === Infinity ? "∞" : v.ratio.toFixed(2);
  process.stdout.write(`GOVERNANCE:PRODUCT = ${totals.governance}:${totals.product} = ${rStr}:1 (threshold ${threshold}:1)\n`);
  if (v.halt) {
    process.stdout.write(`BREACH → DEGRADATION: governance:product exceeds ${threshold}:1 — a runaway instrument-vs-product ratio IS degradation → HALT-RECOMMENDED input\n`);
    return 1;
  }
  process.stdout.write("within threshold — no degradation-halt input\n");
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) { main(process.argv).then((c) => process.exit(c)); }
