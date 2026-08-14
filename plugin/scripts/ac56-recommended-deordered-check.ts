// ac56-recommended-deordered-check.ts — mechanical checker for AC56 (tasks/
// gap-ac56-recommended-deordered, "AC56 去锚"). THE PRODUCT: slot-refill --json's `recommended`
// array used to carry a MEANINGFUL priority order (blocking_suite → delivery_critical → id), so the
// inner's dispatch loop — which iterates `recommended` in order — was anchored to "the mechanism's
// first pick" (SPEC §5: inner gets anchored even against its own semantic leanings; 不去序则新划分
// 只是名义上的). AC56 判据1: `recommended` must be an UNORDERED feasible set OR a dictionary
// (lexicographic) order with an explicit "order meaningless" annotation. THIS checker makes 判据1/2/3
// mechanical:
//   判据1 — a length>1 `recommended` must be lexicographically sorted by id (the verifiable
//           meaningless order) AND the output must carry an explicit "order meaningless" annotation
//           field (`recommended_order` matching /order meaningless|序无意义/i, or `recommended_unordered
//           === true`).
//   判据2 — FALSIFIABLE: an output STILL ordered by a meaningful priority (a 1/cost — in this repo the
//           blocking_suite/delivery-critical sort) is NOT lexicographic ⇒ RED. The negative-control
//           fixture pins exactly this.
//   判据3 — ANTI-只改文案: the checker reads the OUTPUT ITSELF (`recommended` array + the annotation
//           field), NEVER documentation or comments. A comment claiming "序无意义" while the array
//           still encodes a priority order fails the lexicographic check ⇒ RED.
//
// POSITIONAL, never keyword-based: the checker reads only the structured `recommended` array and the
// `recommended_order` / `recommended_unordered` fields. It never greps prose — a doc that merely
// QUOTES the criterion cannot be mistaken for evidence (the exact false-positive class the repo's
// 按位置不按关键词 rule is about).
//
// MODES:
//   --input <file>  a slot-refill --json output file
//   --stdin         read the slot-refill --json output from stdin
//   --root <dir>    run the REAL slot-refill CLI against <dir> and check its live output (the
//                   standing static-check mode; QUAY_TELEMETRY_SUBAGENTS=0 keeps it hermetic)
//   --json          machine-readable output ({ok, reason, checks})
//   --help
//
// Exit codes: 0 = PASS (判据1/2/3 verified); 1 = FAIL (a criterion violated); 2 = usage.
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/ac56-recommended-deordered-check.ts \
//     --input /tmp/slot-refill.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

/** True iff the array is lexicographically (dictionary) sorted by id — the verifiable meaningless
 *  stable order AC56 判据1 option 2 allows. localeCompare on the raw ids. */
export function isLexicographic(ids) {
  if (!Array.isArray(ids) || ids.length <= 1) return true;
  for (let i = 1; i < ids.length; i++) {
    if (typeof ids[i - 1] !== "string" || typeof ids[i] !== "string") return false;
    if (ids[i - 1].localeCompare(ids[i]) > 0) return false;
  }
  return true;
}

/** True iff the result carries an explicit "order meaningless" annotation on the OUTPUT — either a
 *  `recommended_order` string that declares the order meaningless, or `recommended_unordered: true`.
 *  This is the 判据1 "明确标注" half; it must be a field on the output, never a comment. */
export function hasOrderMeaninglessAnnotation(result) {
  if (result && result.recommended_unordered === true) return true;
  const note = result && result.recommended_order;
  return typeof note === "string" && /order meaningless|序无意义/i.test(note);
}

/**
 * The AC56 判据1/2/3 mechanical judgment — PURE.
 *
 * @param {object} result  parsed slot-refill --json output
 * @returns {{ok: boolean, reason: string[], checks: object}}
 */
export function checkRecommendedDeordered(result) {
  const checks = { recommendedPresent: false, order: null, annotation: null };
  const violations = [];

  // The checker reads the OUTPUT ITSELF — a missing/malformed `recommended` is RED, never a silent
  // pass (判据3: 读输出本身; 缺值=未查, 硬规则 6).
  const recommended = result && result.recommended;
  if (!Array.isArray(recommended)) {
    return {
      ok: false,
      reason: ["recommended is not an array — the checker reads the output itself (AC56 判据3)"],
      checks,
    };
  }
  checks.recommendedPresent = true;
  checks.order = { length: recommended.length };

  // 判据1 (明确标注 half): a recommendation must carry the explicit "order meaningless" annotation —
  // the mechanism is required to SAY the order is meaningless, not just be ordered meaninglessly by
  // accident. Read from the output field, never a comment (判据3).
  const annotated = hasOrderMeaninglessAnnotation(result);
  checks.annotation = { present: annotated };
  if (recommended.length > 1 && !annotated) {
    violations.push(
      "order-meaningless-annotation-missing — the output must explicitly mark the recommended order as meaningless (recommended_order matching /order meaningless|序无意义/i, or recommended_unordered: true); a comment in code does not count (AC56 判据3)",
    );
  }

  // 判据1 (order half) + 判据2 (falsifiable): a length>1 `recommended` must be lexicographically
  // sorted (the verifiable meaningless dictionary order). A meaningful priority/1-cost order
  // (blocking_suite → delivery_critical → id) is NOT lexicographic ⇒ RED — this is the exact defect
  // AC56 removes.
  if (recommended.length > 1) {
    const lex = isLexicographic(recommended);
    checks.order.lexicographic = lex;
    if (!lex) {
      violations.push(
        "recommended-not-lexicographic — the array carries a non-dictionary order; a meaningful priority/1-cost sort (blocking_suite/delivery-critical first) is caught here (AC56 判据2, falsifiable)",
      );
    }
  }

  return { ok: violations.length === 0, reason: violations, checks };
}

function main(argv) {
  const args = argv.slice(2);
  let inputPath = null;
  let rootDir = null;
  let jsonOut = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input") {
      inputPath = args[++i];
    } else if (args[i] === "--stdin") {
      inputPath = "-";
    } else if (args[i] === "--root") {
      rootDir = args[++i];
    } else if (args[i] === "--json") {
      jsonOut = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write("usage: ac56-recommended-deordered-check.ts (--input <file> | --stdin | --root <dir>) [--json]\n");
      return 0;
    } else {
      process.stderr.write(`ac56-recommended-deordered-check: unknown argument "${args[i]}"\n`);
      return 2;
    }
  }
  if (inputPath === null && rootDir === null) {
    process.stderr.write("ac56-recommended-deordered-check: --input <file>, --stdin or --root <dir> is required\n");
    return 2;
  }
  let raw;
  if (rootDir !== null) {
    // Standing static-check mode: run the REAL slot-refill CLI against <dir> and check its live
    // output. QUAY_TELEMETRY_SUBAGENTS=0 keeps the in-flight measurement hermetic (same pin the
    // ac36/slot-refill E2E tests apply) — the de-order property is order-based, not count-based, so
    // this does not change the verdict.
    const slotRefill = path.join(path.dirname(fileURLToPath(import.meta.url)), "slot-refill.ts");
    const p = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", slotRefill, "--root", rootDir, "--json"],
      { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
    );
    if (p.status !== 0) {
      process.stderr.write(`ac56-recommended-deordered-check: slot-refill exited ${p.status}: ${p.stderr || p.stdout}\n`);
      return 1; // FAIL-CLOSED (硬规则 3b): cannot evaluate the output ⇒ RED, never a silent pass.
    }
    raw = p.stdout;
  } else {
    try {
      raw = inputPath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(inputPath, "utf8");
    } catch (e) {
      process.stderr.write(`ac56-recommended-deordered-check: could not read input: ${e.message}\n`);
      return 2;
    }
  }
  let result;
  try {
    result = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`ac56-recommended-deordered-check: could not parse input JSON: ${e.message}\n`);
    return 2;
  }
  const r = checkRecommendedDeordered(result);
  if (jsonOut) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } else if (r.ok) {
    process.stdout.write(`PASS — AC56 判据1/2/3: recommended (${r.checks.order.length}) is de-ordered (lexicographic) and the output marks the order as meaningless\n`);
  } else {
    for (const v of r.reason) process.stdout.write(`FAIL — ${v}\n`);
  }
  return r.ok ? 0 : 1;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
