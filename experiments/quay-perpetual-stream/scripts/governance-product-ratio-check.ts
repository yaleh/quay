// governance-product-ratio-check.ts — originally DIR-038-B (eval-rebase fix #2): the governance:product
// ratio as a checkpoint health signal. DIR-038-B originally wired a breach to the HARD self-halt
// "degradation" clause; **DIR-066 (2026-07-23) RETIRED that hard-halt wiring** — a breach is now
// INFORMATIONAL ONLY (reported at a checkpoint, never trips HALT-RECOMMENDED; see OUTER-LOOP.md's
// self-halt section and DIR-066-B). This module still computes and classifies the ratio (useful
// observability — the value-typed ledger counts governance-integrity/risk-option/discovery/
// instrument-correction as value while "not touching VT"), but no longer asserts a halt input.
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

export interface NumstatEntry {
  path: string;
  added: number;
}

export interface Totals {
  governance: number;
  product: number;
}

export interface RatioReport {
  ratio: number;
  threshold: number;
  breach: boolean; // informational only since DIR-066 — no longer a halt input
}

// ── classifyPath ─────────────────────────────────────────────────────────────────────────────────
// PRODUCT = shippable product CODE (a non-prose file under packages/ or plugin/). GOVERNANCE =
// everything else — the method/eval layer AND all PROSE (.md/.txt/…) WHEREVER it lives, INCLUDING
// under packages/ or plugin/. Classifying by directory alone let prose be laundered into "product" by
// parking a .md under packages/ (DIR-038-B adversarial-audit finding: the recorded 8:1 runaway
// collapsed to 0.78:1). So a prose extension is GOVERNANCE regardless of directory — this is a
// code:prose ratio, not a directory ratio.
const PROSE_EXT = /\.(md|markdown|txt|rst|adoc)$/i;
export function classifyPath(p: string): "governance" | "product" {
  const s = String(p).replace(/^\.\//, "");
  if (PROSE_EXT.test(s)) return "governance";                            // prose is governance wherever it lives
  if (s.startsWith("packages/") || s.startsWith("plugin/")) return "product";
  return "governance";
}

// ── sumByClass ───────────────────────────────────────────────────────────────────────────────────
// entries: [{ path, added }]. Returns { governance, product } total added-line counts.
export function sumByClass(entries: NumstatEntry[]): Totals {
  if (!Array.isArray(entries)) throw new Error("governance-product-ratio: entries must be an array of {path, added}");
  const totals: Totals = { governance: 0, product: 0 };
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
export function ratio({ governance, product }: Totals): number {
  if (typeof governance !== "number" || typeof product !== "number" || governance < 0 || product < 0) {
    throw new Error("governance-product-ratio: governance/product must be non-negative numbers");
  }
  if (product === 0) return governance === 0 ? 0 : Infinity;
  return governance / product;
}

// ── isBreach / evaluateRatio ─────────────────────────────────────────────────────────────────────
export function isBreach(r: number, threshold: number = DEFAULT_THRESHOLD): boolean {
  return r > threshold;
}

// Informational evaluation ONLY since DIR-066 (2026-07-23): a breach is reported at a checkpoint but
// does NOT trip HALT-RECOMMENDED (DIR-038-B's hard self-halt wiring was retired — see OUTER-LOOP.md's
// self-halt section + DIR-066-B). Kept as a distinct function from `ratio`/`isBreach` only to bundle
// the threshold + verdict for the CLI's single call site.
export function evaluateRatio(totals: Totals, { threshold = DEFAULT_THRESHOLD }: { threshold?: number } = {}): RatioReport {
  const r = ratio(totals);
  return { ratio: r, threshold, breach: isBreach(r, threshold) };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// Reads either a pre-totaled {governance, product} JSON or an array of {path, added} numstat entries
// (the driver produces the latter from `git diff --numstat <range>`). Exit: 0 = within threshold;
// 1 = BREACH (informational signal only since DIR-066 — does NOT trip HALT-RECOMMENDED); 2 = usage/
// parse error.
function usage(): void { process.stderr.write("Usage: governance-product-ratio-check.ts [--threshold <N>] <window.json>\n"); }

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let threshold = DEFAULT_THRESHOLD;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--threshold") { threshold = Number(args[++i]); continue; }
    files.push(args[i]);
  }
  if (files.length !== 1 || !Number.isFinite(threshold) || threshold <= 0) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  let data: unknown;
  try { data = JSON.parse(fs.readFileSync(files[0], "utf8")); }
  catch (e: any) { process.stderr.write(`ERROR: not valid JSON: ${e.message}\n`); return 2; }
  let totals: Totals;
  try { totals = Array.isArray(data) ? sumByClass(data as NumstatEntry[]) : data as Totals; } catch (e: any) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  let v: RatioReport;
  try { v = evaluateRatio(totals, { threshold }); } catch (e: any) { process.stderr.write(`ERROR: ${e.message}\n`); return 2; }
  const rStr = v.ratio === Infinity ? "∞" : v.ratio.toFixed(2);
  process.stdout.write(`GOVERNANCE:PRODUCT = ${totals.governance}:${totals.product} = ${rStr}:1 (threshold ${threshold}:1)\n`);
  if (v.breach) {
    process.stdout.write(`BREACH: governance:product exceeds ${threshold}:1 — INFORMATIONAL ONLY since DIR-066 (2026-07-23): reported at a checkpoint, does NOT trip HALT-RECOMMENDED (DIR-038-B's hard-halt wiring was retired; see OUTER-LOOP.md's self-halt section + DIR-066-B).\n`);
    return 1;
  }
  process.stdout.write("within threshold — no breach\n");
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) { main(process.argv).then((c) => process.exit(c)); }
