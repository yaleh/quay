// suite-bucket-reattr-ratchet-check.ts — the reattribution-coverage ratchet for
// gap-suite-bucket-dynamic-truth-drift-detector (phase C, ③-AC6 / ③-AC7).
//
// THE DEFECT THIS CLOSES (the silent half of AC121): AC121 re-attributed 230 "test.sh-as-shell"
// tests to a singleton S|M judgment (`.quay/suite-bucket-reattribution.jsonl`), but the coverage
// guarantee was a one-time manual claim ("重扫=0"), never a mechanical ratchet. A NEW test whose
// STATIC attribution is PURE S (its only subject signal is a `scripts/test.sh` mention — likely a
// Run: header or a shell-spawn, NOT evidence of what it actually tests) that is NOT re-attributed
// reopens the AC121 mis-attribution risk SILENTLY: it would be bucketed S and skipped on an M change
// while its true subject is an M mechanism. This checker makes that漏测 loud.
//
// TWO LAYERS (a judgment, not a single boolean):
//   1. (BLOCKING, ③-AC6) — a suite test file OUTSIDE `packages/*/test/` whose static bucket set is
//      EXACTLY {S} (pure S) but which has NO reattribution entry ⇒ RED (exit 1). Baseline = 0: a
//      pure-S test's S attribution comes solely from a scripts/test.sh mention, so its true subject
//      is un-judged until re-attributed — the exact AC121 shape, and a real漏测.
//   2. (REPORT, non-blocking, ③-AC7) — a suite test file whose static bucket set CONTAINS S alongside
//      another bucket (S+M / P+S / P+S+M) but which has NO reattribution entry ⇒ REPORT a count, never
//      block. These are over-selection (the SAFE direction — the test is selected for M/P changes
//      anyway, so the un-rejudged S signal cannot skip it), so they are留痕 for补判, not a forced
//      rework. Currently 14 (9 predate AC121's "重扫=0" claim and expose its incompleteness).
//
// NOT-EVALUATED (exit 3, hard rule 3b): with NO reattribution FILE the ratchet cannot distinguish
// "genuinely unattributed" from "no reattribution data exists yet" — it reports NOT-EVALUATED (exit
// 3, run_checker's third state), never a green "0". A PRESENT-but-empty file IS evaluated (0 entries
// ⇒ every pure-S test is unattributed ⇒ RED) — the file presence is the fail-closed boundary.
//
// MODES:
//   --gate [--root <dir>] [--json]   gate mode (wired into run_static_checks). Exit 1 iff any layer-1
//                                    (pure-S unattributed) test is RED.
// Exit codes: 0 PASS · 1 gate FAIL (>=1 layer-1) · 2 usage/env error · 3 NOT-EVALUATED (no reattribution file).

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry, helpExit } from "./gate-script-base.ts";
import { bucketSetOf } from "./suite-bucket-attribution.ts";
import { repoRoot } from "./repo-root.ts";
import { listSuiteFiles, loadReattribution } from "./suite-bucket-select.ts";

// The AC121 reattribution record path (shared with suite-bucket-select.ts).
const REATTRIBUTION_PATH = ".quay/suite-bucket-reattribution.jsonl";

// `packages/*/test/` product tests are attributed P by directory home, never subject to the S/M
// "test.sh-as-shell" mis-attribution the ratchet guards — the reattribution record does not (and
// should not) cover them, so they are excluded from the ratchet's universe (the audit's predicate).
const P_TEST_DIR = /^packages\/[^/]+\/test\//;

export interface ReattrRatchetReport {
  /** false ⇒ NO reattribution file (NOT-EVALUATED — the ratchet cannot judge without its input). */
  evaluated: boolean;
  /** layer 1 (blocking): pure-S suite tests with no reattribution entry. */
  layer1: string[];
  /** layer 2 (report, non-blocking): S-signal-multi (S+M/P+S/P+S+M) tests with no reattribution entry. */
  layer2: string[];
}

/**
 * The reattribution-coverage ratchet over every suite test file (excluding the packages test tree). A
 * test already in the reattribution record is judged (skip); an un-judged test is classified by its
 * STATIC bucket set — pure S ⇒ layer 1 (漏测, blocking), contains-S-with-others ⇒ layer 2 (over-
 * selection, report). `evaluated` is false when the reattribution FILE is absent (NOT-EVALUATED).
 */
export function checkReattrRatchet(root: string): ReattrRatchetReport {
  const reattrFile = path.join(root, REATTRIBUTION_PATH);
  if (!fs.existsSync(reattrFile)) {
    return { evaluated: false, layer1: [], layer2: [] };
  }
  const reattr = loadReattribution(root);
  const layer1: string[] = [];
  const layer2: string[] = [];
  for (const rel of listSuiteFiles(root)) {
    if (P_TEST_DIR.test(rel)) continue; // product tests are P-by-home, never S/M-shell mis-attributed
    if (reattr.has(rel)) continue; // already re-attributed (judged)
    const staticSet = bucketSetOf(rel, root);
    if (staticSet.size === 0) continue; // UNRESOLVED — reported elsewhere (always selected, safe side)
    if (staticSet.size === 1 && staticSet.has("S")) layer1.push(rel); // pure S — the AC121 mis-attribution shape
    else if (staticSet.has("S")) layer2.push(rel); // S + (M|P) — over-selection, safe direction
  }
  return { evaluated: true, layer1, layer2 };
}

const usage = `suite-bucket-reattr-ratchet-check.ts — reattribution-coverage ratchet (gap-suite-bucket-dynamic-truth-drift-detector)

Usage:
  node --experimental-strip-types suite-bucket-reattr-ratchet-check.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff any pure-S (layer-1) test has no reattribution entry.`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  // --help is the shared checker contract: usage FIRST, exit 0, NO side effect — before root resolution.
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(getArgValue(args, "--root") ?? repoRoot());
  const asJson = args.includes("--json");
  const gate = args.includes("--gate");
  const scan = args.includes("--scan");

  if (!gate && !scan) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const rep = checkReattrRatchet(root);

  if (asJson) {
    console.log(JSON.stringify(rep, null, 2));
  } else if (!rep.evaluated) {
    console.log(`suite-bucket-reattr-ratchet-check: NOT-EVALUATED — no reattribution file (${REATTRIBUTION_PATH}); the ratchet cannot judge unattributed tests without its input (never conflated with '0 uncovered')`);
  } else if (rep.layer1.length === 0) {
    console.log(`PASS — reattribution ratchet: 0 pure-S un-attributed test(s) (layer 1, blocking); ${rep.layer2.length} S-signal-multi un-attributed (layer 2, report-only)`);
  } else {
    console.log(`FAIL — ${rep.layer1.length} pure-S suite test(s) with no reattribution entry (layer 1, blocking — the AC121 mis-attribution shape):`);
    for (const f of rep.layer1) console.log(`  - ${f}`);
    console.log(`  (layer 2 report-only: ${rep.layer2.length} S-signal-multi un-attributed)`);
  }

  if (scan) return 0;
  if (!rep.evaluated) return 3; // NOT-EVALUATED (run_checker third state)
  return rep.layer1.length > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "suite-bucket-reattr-ratchet-check")) {
  process.exitCode = main(process.argv);
}
