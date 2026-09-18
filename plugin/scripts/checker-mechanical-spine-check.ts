#!/usr/bin/env node
// checker-mechanical-spine-check.ts — B1 (层 1 机械脊柱): mechanical enforcement of the checker
// "mechanical spine" contract (orchestration/SPEC-checker-mechanical-spine-contract-2026-08-28.md):
//   ① exit 码词表 ∈ {0,1,2,3}  (0=PASS, 1=FAIL/RED, 2=usage/env-error, 3=NOT-EVALUATED);
//   ② 声称支持 --json 就必须真产出 JSON (`.ts`→JSON.stringify; `.sh`→jq/python/node/delegation).
// A checker whose source contains an exit-code literal OUTSIDE {0,1,2,3}, or claims --json with no
// JSON primitive, is NON-COMPLIANT. The SHRINK-ONLY exemption list
// (plugin/scripts/checker-mechanical-spine-exemptions.json) grandfathers the historical debt and
// turns each eventual fix into the ratchet — a NEW violation (not on the list) or an ADDED list
// entry (vs the git-HEAD baseline) red-lights the commit.
//
// CHECKS (mapped to ACs):
//   C1 (AC1)  exit-code vocabulary — scan CODE positions only (comments/strings/regex masked, hard
//             rule 2): process.exit(N) / process.exitCode = N / `return N;` for .ts, `exit N` for
//             .sh; any N ∉ {0,1,2,3} is a violation.
//   C2 (AC2)  --json shape — a checker that claims --json (the flag token appears) must emit JSON;
//             a claim with no JSON primitive is a violation. Checkers with NO --json flag are
//             legacy-human-output (recorded, NOT a hard violation).
//   C3 (AC2)  ratchet — the exemption list is SHRINK-ONLY: an entry in the working tree but NOT in
//             the git-HEAD baseline was ADDED → fail (same-count swaps / smuggled exemptions).
//
// Exit codes: 0 = no unexempted violation and no added exemption; 1 = >=1 unexempted violation or
// added exemption; 2 = usage/environment error.
//
// Usage:
//   node --experimental-strip-types checker-mechanical-spine-check.ts [--root <dir>] [--json]
//     [--scripts-dir <dir>] [--exemptions <path>] [--baseline-exemptions <path>]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildNonCodeMask } from "./checker-lib.ts";
// argValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { emitPass, emitFail, flagValue } from "./gate-script-base.ts";

/** The exemption list's repo-root-relative location (a DATA file, not scattered code). */
export const EXEMPTIONS_REL = "plugin/scripts/checker-mechanical-spine-exemptions.json";

/** The mechanical-spine exit-code vocabulary (exit 3 = NOT-EVALUATED is the sanctioned extension). */
export const ALLOWED_EXIT_CODES: ReadonlySet<number> = new Set([0, 1, 2, 3]);

export type CheckerKind = "ts" | "sh";

export interface SpineFile {
  name: string;
  kind: CheckerKind;
  source: string;
}

export interface SpineViolation {
  checker: string;
  dimension: "exit" | "json";
  detail: string;
}

export interface Exemptions {
  exit: string[];
  json: string[];
}

export interface CheckInput {
  files: SpineFile[];
  exemptions: Exemptions;
  baselineExemptions: Exemptions;
}

export interface CheckResult {
  violations: SpineViolation[]; // all raw violations (before exemption)
  exempted: SpineViolation[]; // violations covered by the (grandfathered) exemption list
  unexempted: SpineViolation[]; // violations NOT on the list → RED
  ratchetAdded: string[]; // "exit:name" / "json:name" entries ADDED vs the git-HEAD baseline
}

// ── shell comment/string mask (the .sh analog of buildNonCodeMask, code-position discipline) ───────

/** Mark `#…` comments (to EOL) and `"…"`/`'…'` strings as non-code. Over-masks (treats every `#` as
 * a comment start) on purpose: a false NEGATIVE (miss a real `exit N`) is safer than a false
 * POSITIVE (red the suite over a comment). */
export function buildShellMask(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "#") {
      while (i < n && src[i] !== "\n") { mask[i] = 1; i++; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      mask[i] = 1; i++;
      while (i < n) {
        mask[i] = 1;
        if (src[i] === "\\") { if (i + 1 < n) { mask[i + 1] = 1; i += 2; } else { i++; } continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return mask;
}

// ── C1: exit-code vocabulary (code positions only) ─────────────────────────────────────────────────

/** Literal exit codes referenced by a .ts checker source, code positions only. */
export function tsExitCodeLiterals(source: string): number[] {
  const mask = buildNonCodeMask(source);
  const codes: number[] = [];
  // process.exit(0) / process.exitCode = 0 / exitCode = 0 / bare `return 0;` (main-style).
  const patterns: RegExp[] = [
    /\bprocess\.exit\(\s*(\d+)\s*\)/g,
    /\b(?:process\.)?exitCode\s*=\s*(\d+)/g,
    /\breturn\s+(\d+)\s*;/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (mask[m.index] === 1) continue; // comment/string/regex position — not code
      codes.push(Number(m[1]));
    }
  }
  return codes;
}

/** Literal exit codes referenced by a .sh checker source, code positions only. */
export function shExitCodeLiterals(source: string): number[] {
  const mask = buildShellMask(source);
  const codes: number[] = [];
  const re = /\bexit\s+(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (mask[m.index] === 1) continue;
    codes.push(Number(m[1]));
  }
  return codes;
}

// ── C2: --json shape ───────────────────────────────────────────────────────────────────────────────

/** Does the source claim to accept `--json`? The flag token is a string literal in arg parsing, so
 * this is a raw substring (a `--json` mention in a comment is a false-NEGATIVE risk, never a false
 * positive — acceptable). */
export function claimsJson(source: string): boolean {
  return source.includes("--json");
}

/** Does a .ts checker actually emit JSON? `JSON.stringify` (the JSON-output primitive) appears
 * anywhere in the source — including a template-literal `${JSON.stringify(…)}` interpolation, which
 * IS executed code. A comment/string that merely mentions `JSON.stringify` without a real call is a
 * false-NEGATIVE risk (we'd miss that violation), not a false positive — the safe direction. */
export function emitsJsonTs(source: string): boolean {
  if (source.includes("JSON.stringify")) return true;
  // The base's verdict emitters (gate-script-base.ts emitVerdict / emitPass / emitFail /
  // emitNotEvaluated) own JSON.stringify — a checker that delegates `--json` to them satisfies the
  // JSON primitive requirement without a literal JSON.stringify in its own source
  // (gap-gate-script-base-behavior-contract-unusable: the contract verifier is aligned with the
  // redesigned behavior contract). A false NEGATIVE (missing a violation) is the safe direction.
  return /\bemit(?:Verdict|Pass|Fail|NotEvaluated)\s*\(/.test(source);
}

/** Does a .sh checker actually emit JSON? Direct (jq / python / `printf '{…}'` JSON literal) or
 * delegation (node). Heuristic — a .sh that claims --json but only `echo`s human text has none of
 * these (documented as a heuristic in the SPEC §5, not a structure-impossible-to-fail quantity). */
export function emitsJsonSh(source: string): boolean {
  return /\b(jq|python3?|node)\b/.test(source) || /printf\s+['"]\s*\{/.test(source);
}

/** C2 violation: claims --json but has no JSON primitive. No --json flag ⇒ NOT a violation. */
export function jsonViolation(source: string, kind: CheckerKind): boolean {
  if (!claimsJson(source)) return false;
  return kind === "ts" ? !emitsJsonTs(source) : !emitsJsonSh(source);
}

// ── enumeration + exemption parsing ────────────────────────────────────────────────────────────────

/** Enumerate the checker corpus: plugin/scripts/*-check.ts + *-check.sh (glob-derived, never 77/32). */
export function enumCheckers(scriptsDir: string): SpineFile[] {
  const files: SpineFile[] = [];
  for (const ext of ["ts", "sh"] as const) {
    const names = fs.readdirSync(scriptsDir)
      .filter((n) => n.endsWith(`-check.${ext}`))
      .sort();
    for (const n of names) {
      files.push({ name: n, kind: ext, source: fs.readFileSync(path.join(scriptsDir, n), "utf8") });
    }
  }
  return files;
}

/** Parse the exemptions JSON. Throws on invalid JSON (callers FAIL CLOSED — a corrupt data file must
 * not read as "empty list" = "nothing grandfathered", hard rule 3b). */
export function parseExemptions(text: string): Exemptions {
  const obj = JSON.parse(text);
  return {
    exit: Array.isArray(obj?.exit) ? obj.exit : [],
    json: Array.isArray(obj?.json) ? obj.json : [],
  };
}

// ── the check ───────────────────────────────────────────────────────────────────────────────────────

export function checkSpine(input: CheckInput): CheckResult {
  const violations: SpineViolation[] = [];
  for (const f of input.files) {
    const exitCodes = f.kind === "ts" ? tsExitCodeLiterals(f.source) : shExitCodeLiterals(f.source);
    for (const c of exitCodes) {
      if (!ALLOWED_EXIT_CODES.has(c)) {
        violations.push({ checker: f.name, dimension: "exit", detail: `exit code ${c}` });
      }
    }
    if (jsonViolation(f.source, f.kind)) {
      violations.push({ checker: f.name, dimension: "json", detail: "--json claimed but no JSON primitive" });
    }
  }

  const isExempt = (v: SpineViolation): boolean =>
    v.dimension === "exit"
      ? input.exemptions.exit.includes(v.checker)
      : input.exemptions.json.includes(v.checker);

  const exempted = violations.filter(isExempt);
  const unexempted = violations.filter((v) => !isExempt(v));

  // C3: the list can only SHRINK — any working-tree entry absent from the git-HEAD baseline was ADDED.
  const ratchetAdded: string[] = [];
  for (const dim of ["exit", "json"] as const) {
    const baseline = new Set(input.baselineExemptions[dim]);
    for (const entry of input.exemptions[dim]) {
      if (!baseline.has(entry)) ratchetAdded.push(`${dim}:${entry}`);
    }
  }

  return { violations, exempted, unexempted, ratchetAdded };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage(): never {
  console.error(
    "usage: node --experimental-strip-types checker-mechanical-spine-check.ts [--root <dir>] [--json]\n" +
      "       [--scripts-dir <dir>] [--exemptions <path>] [--baseline-exemptions <path>]\n" +
      "Exit: 0 = no unexempted violation / no added exemption; 1 = violation; 2 = usage/environment error.",
  );
  process.exit(0);
}

/** Read the committed (git HEAD) form of the exemptions file; null on bootstrap (not yet committed). */
function readHeadBaseline(root: string): Exemptions | null {
  try {
    return parseExemptions(
      execFileSync("git", ["-C", root, "show", `HEAD:${EXEMPTIONS_REL}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null; // not committed at HEAD (this mechanism's own first commit) — bootstrap
  }
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const asJson = args.includes("--json");

  const rootArg = flagValue(args, "--root");
  const scriptsDirArg = flagValue(args, "--scripts-dir");
  const exemptionsArg = flagValue(args, "--exemptions");
  const baselineArg = flagValue(args, "--baseline-exemptions");

  const root = rootArg ? path.resolve(rootArg) : process.cwd();
  const scriptsDir = scriptsDirArg ? path.resolve(scriptsDirArg) : path.join(root, "plugin", "scripts");

  if (!fs.existsSync(scriptsDir)) {
    console.error(`ERROR: scripts dir not found: ${scriptsDir} — is <root>/--scripts-dir correct?`);
    process.exit(2);
  }

  // Exemptions (working tree). A corrupt data file FAILS CLOSED (exit 2), never reads as empty.
  const exemptionsPath = exemptionsArg
    ? path.resolve(exemptionsArg)
    : path.join(root, EXEMPTIONS_REL);
  let exemptions: Exemptions;
  try {
    exemptions = parseExemptions(fs.readFileSync(exemptionsPath, "utf8"));
  } catch (e) {
    console.error(
      `ERROR: cannot read/parse exemptions file ${exemptionsPath}: ${(e as Error).message} — ` +
        `a corrupt ratchet list must not read as "nothing grandfathered".`,
    );
    process.exit(2);
  }

  const baseline: Exemptions = baselineArg
    ? (() => {
        try {
          return parseExemptions(fs.readFileSync(path.resolve(baselineArg), "utf8"));
        } catch (e) {
          console.error(`ERROR: cannot parse --baseline-exemptions: ${(e as Error).message}`);
          process.exit(2);
        }
      })()
    : (readHeadBaseline(root) ?? exemptions);

  const files = enumCheckers(scriptsDir);
  const result = checkSpine({ files, exemptions, baselineExemptions: baseline });

  const ok = result.unexempted.length === 0 && result.ratchetAdded.length === 0;

  if (asJson) {
    console.log(JSON.stringify({
      ok,
      checkers: files.length,
      exemptions,
      violations: result.violations,
      unexempted: result.unexempted,
      ratchetAdded: result.ratchetAdded,
    }, null, 2));
  } else {
    console.log(
      `checker-mechanical-spine-check — ${files.length} checker(s), ` +
        `${result.violations.length} violation(s), ${result.exempted.length} exempted`,
    );
    if (ok) {
      return emitPass("every checker's exit-code vocabulary is within {0,1,2,3} and every --json claim emits JSON; the exemption list did not grow.");
    }
    let code = 0;
    if (result.unexempted.length > 0) {
      code = emitFail(`${result.unexempted.length} unexempted violation(s):`);
      for (const v of result.unexempted) console.log(`  - ${v.checker} (${v.dimension}): ${v.detail}`);
    }
    if (result.ratchetAdded.length > 0) {
      code = emitFail(`${result.ratchetAdded.length} exemption entry/entries ADDED (the list can only shrink):`);
      for (const r of result.ratchetAdded) console.log(`  - ${r}`);
    }
    return code;
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv);
}
