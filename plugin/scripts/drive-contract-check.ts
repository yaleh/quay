#!/usr/bin/env node
// drive-contract-check.ts — mechanical checker for the outer→inner drive-text contract
// (tasks/gap-drive-text-carries-data-not-behavior-outer-inner-handoff, AC3/AC4).
//
// WHAT IT DETECTS (by POSITION, never by keyword):
//   A DRIVE TEXT is what the OUTER sends to the INNER to dispatch/steer tasks. Under outer ruling
//   R2 (orchestration/outer-rulings-2026-08-04-A-F.md) a drive text carries DATA only (task ids,
//   rulings, dependency facts); HOW to dispatch (concurrency, worktree, discipline, limits) comes
//   from the shipped fast-mode-loop-tick.md — the outer must not restate it. If a drive text DOES
//   assert an explicit task order (e.g. "按 A→D→B 顺序"), it MUST include the checkTouchesPair
//   output that justifies that order ("A-D: {"disjoint":true,...}"). An order assertion without
//   that output in the SAME text is the exact incident shape: the 2026-08-04 drive text opened
//   "本批实现三个任务，按 A→D→B 顺序" with no pair output, the inner (deepseek-v4-flash) faithfully
//   serialized A (6m11s) while the shipped doc §4 mandates concurrent Agent(run_in_background) —
//   the standing concurrent-dispatch directive's second silent drop.
//
//   The judgment is POSITIONAL: an order assertion (an arrow-chain of uppercase task-like ids,
//   e.g. "A→D→B", "M222 → M246") and a checkTouchesPair output (a disjoint:true value or a
//   batch:/deferred: JSON key) must COEXIST in the same drive text. It is NOT keyword-based: the
//   checker never greps for words like 并发派发/顺序 — ruling and analysis docs necessarily contain
//   those words (the 2026-08-03 6×-recorded false-positive class: "a word that describes a defect
//   necessarily appears in the defect's own docs"). An arrow-chain of UPPERCASE ids is the
//   structural signature precisely because lowercase lifecycle words (todo→ready) and state names
//   (ready→done) are not task ids and must not match.
//
// MODES:
//   default        — scan the three normative drive-contract docs under --root:
//                    plugin/loop/fast-mode-loop-tick.md,
//                    plugin/loop/orchestrator-loop-tick.md,
//                    orchestration/QUAY-OUTER-HANDOFF.md.
//                    Exit 0 iff no order assertion lacks a pair output in the same text.
//                    (orchestration/* is deliberately NOT scanned wholesale: tick-log/briefs are
//                    historical records that quote old violations as evidence, and merge-order
//                    records like "M222 → M246" are not task-dispatch drive text.)
//   --judge <path> — judge ONE arbitrary drive text (absolute, or relative to --root). Exit 1 iff
//                    it contains an order assertion without a pair output. (The AC4 control + tests.)
//   --json         — machine-readable output; the ## Contract measure reads the `violations` field.
//
// Exit codes: 0 = PASS; 1 = FAIL (an order-asserting drive text lacks a checkTouchesPair output);
//             2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// gap-crystallization-five-directions ④: 位置判定原语抽到 checker-lib — 按位置不按关键词。
import { matchAtCommandPosition, hasMatchAtCommandPosition } from "./checker-lib.ts";

/**
 * An ORDER ASSERTION: a chain of two or more UPPERCASE task-like identifiers joined by → arrows,
 * e.g. "A→D→B", "M222 → M246 → M243". The uppercase-first requirement is structural: it excludes
 * lowercase lifecycle words (todo→ready, ready→done) and command keystrokes (C-u → 文本) that
 * routinely appear in the tick docs and are NOT task-order assertions. A single arrow pair is a
 * minimal chain; the whole maximal chain is matched as one assertion (so "A→D→B" counts once).
 */
export const ORDER_ASSERTION_RE =
  /\b[A-Z][A-Z0-9-]*(?:\s*→\s*[A-Z][A-Z0-9-]*)+\b/g;

/**
 * A checkTouchesPair / concurrent-batch-scheduler OUTPUT marker. The pair check's real output is
 * JSON carrying a `disjoint` key with a boolean value ("A-D: {"disjoint":true,...}"), or the
 * batch scheduler's `batch` / `deferred` keys. The value MUST be present — the bare word "disjoint"
 * ("六对全部 disjoint") is a PROSE summary, not the mechanical output, and does not count.
 */
export const PAIR_OUTPUT_RE =
  /"disjoint"\s*[:：]\s*(?:true|false)|\bdisjoint\s*[:：]\s*(?:true|false)|"batch"\s*:|"deferred"\s*:/;

/** A single order-assertion hit in a text. */
export interface OrderHit {
  line: number;
  hit: string;
  snippet: string;
}

/** Result of judging one drive text. */
export interface DriveTextResult {
  source: string;
  orderAssertions: OrderHit[];
  hasPairOutput: boolean;
  violations: number; // orderAssertions.length when the same text LACKS a pair output, else 0
}

/** Find all order-assertion chains in `src`, each with its line + trimmed snippet.
 * 位置判定 (按位置不按关键词): 用 checker-lib 的 matchAtCommandPosition 在全文跑结构性签名
 * (大写任务 id 的箭头链), 不用关键词 grep — 判据就是结构本身。 */
export function findOrderAssertions(src: string): OrderHit[] {
  const lines = src.split("\n");
  return matchAtCommandPosition(src, ORDER_ASSERTION_RE, { maskNonCode: false }).map((h) => ({
    line: h.line,
    hit: h.match,
    snippet: (lines[h.line - 1] ?? "").trim().slice(0, 90),
  }));
}

/** Whether the same text carries a checkTouchesPair output marker. 同样走 checker-lib 位置判定。 */
export function hasPairOutput(src: string): boolean {
  return hasMatchAtCommandPosition(src, PAIR_OUTPUT_RE, { maskNonCode: false });
}

/**
 * Judge one drive text by POSITION: an order assertion and a checkTouchesPair output must coexist
 * in the SAME text. An order assertion with no pair output anywhere in the text is a violation.
 */
export function judgeText(src: string, source: string): DriveTextResult {
  const orderAssertions = findOrderAssertions(src);
  const hasOutput = hasPairOutput(src);
  return {
    source,
    orderAssertions,
    hasPairOutput: hasOutput,
    violations: !hasOutput ? orderAssertions.length : 0,
  };
}

/** The normative drive-contract docs scanned by the default gate (relative to --root). */
export const DEFAULT_DRIVE_FILES = [
  "plugin/loop/fast-mode-loop-tick.md",
  "plugin/loop/orchestrator-loop-tick.md",
  "orchestration/QUAY-OUTER-HANDOFF.md",
] as const;

function usage(): never {
  console.error(
    "usage: node drive-contract-check.ts [--root <dir>] [--judge <path>] [--json]\n" +
      "  default: scan the three normative drive-contract docs under --root\n" +
      "  --judge <path>: judge ONE drive text (absolute or relative to --root)\n" +
      "  Exit: 0 = PASS; 1 = FAIL (an order-asserting drive text lacks a checkTouchesPair output); 2 = usage/env error",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const judgeIdx = args.indexOf("--judge");
  const judgePath = judgeIdx !== -1 ? args[judgeIdx + 1] : undefined;
  if (!fs.existsSync(root)) {
    console.error(`ERROR: scan root not found: ${root}`);
    process.exit(2);
  }

  // ── --judge mode (AC4 control / tests / ad-hoc drive text) ──────────────────────────────────────
  if (judgePath !== undefined) {
    const abs = path.isAbsolute(judgePath) ? judgePath : path.join(root, judgePath);
    if (!fs.existsSync(abs)) {
      console.error(`ERROR: --judge file not found: ${judgePath}`);
      return 2;
    }
    const src = fs.readFileSync(abs, "utf8");
    const res = judgeText(src, judgePath);
    const flagged = res.violations > 0;
    if (asJson) {
      console.log(JSON.stringify({ mode: "judge", source: judgePath, ...res }, null, 2));
    } else if (flagged) {
      console.log(`drive-contract-check --judge ${judgePath}`);
      console.log(`VIOLATION: ${res.violations} order assertion(s) WITHOUT a checkTouchesPair output in the same text`);
      for (const o of res.orderAssertions) console.log(`  ${judgePath}:${o.line}  [${o.hit}]  ${o.snippet}`);
      console.log("FAIL: an order-asserting drive text lacks its checkTouchesPair evidence");
    } else {
      console.log(`drive-contract-check --judge ${judgePath}: clean (${res.orderAssertions.length} order assertion(s), pair output ${res.hasPairOutput ? "present" : "n/a"})`);
    }
    return flagged ? 1 : 0;
  }

  // ── default doc gate (wired into run_static_checks) ────────────────────────────────────────────
  const results: DriveTextResult[] = [];
  for (const rel of DEFAULT_DRIVE_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    results.push(judgeText(fs.readFileSync(abs, "utf8"), rel));
  }
  const violations = results.reduce((n, r) => n + r.violations, 0);
  const flaggedDocs = results.filter((r) => r.violations > 0);
  const ok = flaggedDocs.length === 0;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          mode: "drive-contract-docs",
          scanned: results.length,
          violations, // the ## Contract measure (band 0)
          flagging_docs: flaggedDocs.map((r) => ({
            source: r.source,
            violations: r.violations,
            orderAssertions: r.orderAssertions,
          })),
          ok,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`drive-contract-check — ${results.length} drive-contract doc(s) scanned (fast-mode-loop-tick / orchestrator-loop-tick / QUAY-OUTER-HANDOFF)`);
    console.log(`violations: ${violations}`);
    for (const r of results) {
      const status = r.violations > 0 ? "VIOLATION" : "ok";
      console.log(`  [${status}] ${r.source}: ${r.orderAssertions.length} order assertion(s), pair output ${r.hasPairOutput ? "present" : "n/a"}`);
      if (r.violations > 0) {
        for (const o of r.orderAssertions) console.log(`      ${r.source}:${o.line}  [${o.hit}]  ${o.snippet}`);
      }
    }
    if (ok) {
      console.log("PASS: no drive-contract doc asserts a task order without its checkTouchesPair output");
    } else {
      console.log(`FAIL: ${violations} order assertion(s) in a drive-contract doc lack a checkTouchesPair output`);
    }
  }
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "drive-contract-check")) {
  process.exit(main(process.argv));
}
