// gate-script-base.ts — shared framework primitives for TypeScript gate scripts.
// Import the functions/classes you need from this module.
//
// Usage:
//   import { parseArgs, flagValue, readFrontmatter, emitPass, emitFail, emitNotEvaluated, emitVerdict, requireArg, isDirectEntry } from "./gate-script-base.ts";

import fs from "node:fs";
import path from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface FlagSpec {
  type: "string" | "boolean";
  description?: string;
}

export interface CliSpec {
  /** Minimum number of positional args required (default: 1). */
  minArgs?: number;
  /** Usage string for error messages, e.g. "<task-file> [<task-file> ...]". */
  usage: string;
  /** Named flags accepted by this command. */
  flags?: Record<string, FlagSpec>;
}

export interface ParsedArgs {
  /** Positional (non-flag) args. */
  args: string[];
  /** Flag values keyed by flag name (without leading --). */
  flags: Record<string, string | boolean>;
}

// ── helpExit ────────────────────────────────────────────────────────────────────────────────────────
// Print a usage line to stdout and exit 0 — the single `--help` contract shared by every checker
// (gap-help-contract-incompatible-behaviors): usage FIRST, exit 0, NO business side effect. Call this
// BEFORE any argument parsing / repo-root resolution / file write; a checker that reaches its own
// full-check logic on `--help` violates the contract (it silently runs — or worse, appends to a
// history/ledger file, as measure-trend-check did to .quay/measure-history.jsonl).
export function helpExit(usage: string): never {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}

// ── parseArgs ──────────────────────────────────────────────────────────────────────────────────────
// Parse CLI arguments according to a spec. Flags are parsed as --name value or --name=value (string),
// or --name alone (boolean). Positional args are everything else.
//
// `--help` / `-h` anywhere in argv ⇒ print usage to stdout and exit 0 (the shared contract above),
// evaluated BEFORE the minArgs failure path so `--help` never reads as a missing-arg error.
// Otherwise exits with code 2 and a usage message if fewer than minArgs positional args are provided.
export function parseArgs(argv: string[], spec: CliSpec): ParsedArgs {
  const result: ParsedArgs = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};

  const scriptName = path.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }

  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    console.error(`Usage: ${scriptName} ${spec.usage}`);
    process.exit(2);
  }

  return result;
}

// ── flagValue ───────────────────────────────────────────────────────────────────────────────────────
// Read ONE `--flag <value>` pair out of an already-sliced argv (callers pass `argv.slice(2)` — the
// positional args, NOT the whole `process.argv`). Returns the token following `name`, or `undefined`
// when `name` is absent or is the last token with no value after it.
//
// WHY THIS EXPORT EXISTS — it is an extraction, not a new idea. A `semantic-dedup-scan` pass
// (.quay/routine-findings.jsonl, routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1789723686226`,
// finding `arg-parsing-helper-family`, verdict `real-duplication`, suggestedAction `extract`) found
// ~60 private copies of this idiom across plugin/scripts under 9 spellings (getArgValue / argValue /
// getFlagValue / parseArg / flagVal / …) and noted that THIS file, imported by the whole checker
// surface, exported no arg helper for them to converge on. Every copy carried the SAME
// `indexOf(name)` + "next token" algorithm; they differed only in trivia (ternary vs early-return,
// typed vs untyped) EXCEPT at one input where the trivia is load-bearing — an EMPTY-STRING value
// (`prog --flag ""`):
//   • `""`          — the majority form: `idx === -1 ? undefined : args[idx + 1]`
//   • `undefined`   — the falsy form:  `idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined`
// The falsy form is RETIRED here rather than preserved, because its only effect is that a value the
// user DID pass reads as absent, and the caller's `?? default` then silently substitutes the
// default for it (硬规则 3b: "读不懂" 不得伪装成 "没给"). A caller that wants that reading must say
// so at its own call site (`flagValue(args, "--x") || undefined`) instead of inheriting it from a
// private copy. See plugin/test/gate-script-base-flag-value.test.mjs for the control that pins the
// two apart.
//
// ⛔ What this helper deliberately does NOT do:
//   • It does NOT accept the `--flag=value` spelling. No copy it replaces did either (`indexOf`
//     matches the exact token `--flag`), so gaining the `=` form here would change every caller's
//     input language at once. Use parseArgs()'s spec-driven path where `=` must be supported.
//   • It does NOT treat a missing value as an error. Pair it with requireArg() when an absent value
//     must be a usage error (exit 2) rather than a silent fallback.
//   • It is NOT the arity-1 `argvFlag(name)` shape: the callers that read `process.argv` directly
//     now write `flagValue(process.argv, name)`, so the token source stays visible at the call site.
export function flagValue(argv: readonly string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx === -1 ? undefined : argv[idx + 1];
}

// ── readFrontmatter ─────────────────────────────────────────────────────────────────────────────────
// Read and parse YAML frontmatter from a markdown file.
// Returns a Record of key→value for simple scalar/list fields, or null if no frontmatter found.
export function readFrontmatter(filePath: string): Record<string, any> | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e: any) {
    // 文件在扫描期间被并发删除（测试 fixture 竞态 / 并发写 tasks/）⇒ 视为不存在（缺值=未查，
    // 硬规则 6——不因 ENOENT 崩溃整个检测器）。missing file has no frontmatter → null（与注释语义一致）。
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw e;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;

  const front: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value: any = trimmed.slice(colonIdx + 1).trim();
    if (value === "" || value === "[]" || value === "null") {
      value = value === "null" ? null : value === "[]" ? [] : "";
    } else if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^['"]|['"]$/g, ""));
    }
    front[key] = value;
  }
  return front;
}

// ── readFileSafe ────────────────────────────────────────────────────────────────────────────────────
// Read a file as UTF-8, returning "" on any error (missing file, permission, etc.) instead of
// throwing — the single shared "read or empty" primitive (gap-b3-readfilesafe-normalizerel-unification:
// was 4 byte-identical per-checker copies). Callers that must distinguish "absent" from "unreadable"
// should read directly; this is the checker convention of "treat unreadable as empty".
export function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// ── normalizeRel ────────────────────────────────────────────────────────────────────────────────────
// Normalize a repo-relative path or glob to a canonical form: backslashes → forward slashes, drop
// empty (`//`) and `.` segments, resolve `..` (a leading `..` is dropped), strip a leading `./`,
// drop a trailing `/`. Wildcard segments are preserved untouched. This is the single normalization
// the touches/resolver scripts share so path-shape tricks (`./`, `//`, trailing `/`) cannot spoof
// identity (gap-b3: was 4 byte-identical per-file copies, two of whose comments each claimed to be
// the canonical version — the code was identical, so this is that shared code).
export function normalizeRel(p: string): string {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

// ── Verdict emission (the behavior contract) ─────────────────────────────────────────────────────────
// The three-state verdict output layer shared by checkers: PASS (exit 0) / FAIL (exit 1) /
// NOT-EVALUATED (exit 3 — the harness-canonical third state per gap-not-evaluated-harness-third-state;
// the mechanical-spine vocabulary {0,1,2,3} reserves 2 for usage/env error and 3 for NOT-EVALUATED).
// The three states converge on driver-result.ts's DriverResult<T> (verified↔pass, failed↔fail,
// not-evaluated↔not-evaluated) — this is the OUTPUT rendering of that same three-state, NOT a new
// competing vocabulary (SPEC-methodology-layer-architecture §2.3a: reuse, don't design a new contract).
//
// Each emit* accepts an optional structured `detail` (violations, counts, exemptions, …) that is
// merged into the `--json` output, so a checker expresses a violations list / structured verdict
// without hand-rolling JSON.stringify. `emitVerdict` (and each emit*) RETURNS the exit code — the
// base owns the verdict→exit-code mapping, not each checker (the behavior contract this module was
// missing: emitPass/emitFail used to print only and leave the exit code to the caller).

export type VerdictStatus = "pass" | "fail" | "not-evaluated";

export interface Verdict {
  status: VerdictStatus;
  message: string;
  /** Arbitrary structured payload (violations, counts, …) merged into the --json output. */
  detail?: unknown;
}

export interface EmitOptions {
  /** Emit a structured JSON verdict (single line) instead of a human "PASS: …" line. */
  json?: boolean;
  /** Which stream the verdict line goes to (default "stdout"). */
  stream?: "stdout" | "stderr";
}

/** Verdict status → exit code (pass→0, fail→1, not-evaluated→3). The single statement of the mapping. */
export const VERDICT_EXIT_CODE: Readonly<Record<VerdictStatus, number>> = {
  pass: 0,
  fail: 1,
  "not-evaluated": 3,
};

export function verdictExitCode(status: VerdictStatus): number {
  return VERDICT_EXIT_CODE[status];
}

/** Emit a three-state verdict and return its exit code. Human mode prints one
 *  `PASS:` / `FAIL:` / `NOT-EVALUATED:` line; --json mode prints
 *  `{ status, ok, message, ...detail }`. */
export function emitVerdict(verdict: Verdict, opts: EmitOptions = {}): number {
  const { json = false, stream = "stdout" } = opts;
  const out = stream === "stderr" ? process.stderr : process.stdout;
  if (json) {
    const detail = verdict.detail;
    const base: Record<string, unknown> =
      detail !== null && typeof detail === "object" && !Array.isArray(detail)
        ? { ...(detail as Record<string, unknown>) }
        : detail === undefined
          ? {}
          : { detail };
    base.status = verdict.status;
    base.ok = verdict.status === "pass";
    base.message = verdict.message;
    out.write(JSON.stringify(base) + "\n");
  } else {
    const prefix =
      verdict.status === "pass" ? "PASS" : verdict.status === "fail" ? "FAIL" : "NOT-EVALUATED";
    out.write(`${prefix}: ${verdict.message}\n`);
  }
  return verdictExitCode(verdict.status);
}

export function emitPass(message: string, detail?: unknown, opts?: EmitOptions): number {
  return emitVerdict({ status: "pass", message, detail }, opts);
}

export function emitFail(message: string, detail?: unknown, opts?: EmitOptions): number {
  return emitVerdict({ status: "fail", message, detail }, opts);
}

export function emitNotEvaluated(message: string, detail?: unknown, opts?: EmitOptions): number {
  return emitVerdict({ status: "not-evaluated", message, detail }, opts);
}

// ── requireArg ──────────────────────────────────────────────────────────────────────────────────────
// Check that a value is present (not undefined, null, or empty string).
// Exits with code 2 if the value is missing.
export function requireArg(value: any, name: string): void {
  if (value === undefined || value === null || value === "") {
    console.error(`ERROR: ${name} is required`);
    process.exit(2);
  }
}

// ── isDirectEntry ───────────────────────────────────────────────────────────────────────────────────
// Standard "is this file being run directly?" check for CLI scripts.
// Usage (expectedBase is REQUIRED — see below):
//   if (isDirectEntry(import.meta, undefined, "tool-name")) main(process.argv).then(code => process.exit(code));
//
// BUNDLER-FRIENDLY (gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact): when a
// plugin .ts is bundled into a single ESM file, EVERY inlined module shares the bundle's
// `import.meta.url`, so the URL-equality check alone returns true for imported libraries too — the
// library's top-level CLI block would fire while another tool runs. Callers therefore pass their own
// canonical basename as `expectedBase`; the check requires the executed file's basename to match,
// which holds for the entry in both source and bundle forms and never for an inlined library (the
// bundle's basename is the entry's, not the library's).
//
// ⛔ The bare `isDirectEntry(import.meta)` form NO LONGER EXISTS, on purpose
// (gap-drivers-yml-interval-not-honored-for-routine-kinds). It compared `realpath(argv[1])` against
// `import.meta.url`, which is a FILE identity — correct in the source layout, but under bundling the
// whole inlined module set shares one file, so every inlined module's guard became true at once and
// the FIRST one in bundle order won. Measured 2026-09-13 on the shipped `plugin/scripts/dist/`
// bundles: `dist/{goal,quality-gate,meta}-driver.js` all executed `pool-quality-judge`'s main (the
// first inlined library carrying a bare guard) instead of their own — the routine drivers therefore
// printed the pool judge's JSON and exited 0 in <1s, and the supervisor respawned them every
// `--restart-delay` (5s). The declared `drivers.yml <kind>.interval_ms` never entered the cadence
// because the driver process never reached its resident loop. Making `expectedBase` REQUIRED is the
// mechanism, not a reminder: a bare guard is now a type error instead of a silent wrong-module run.
// `importMeta` is kept ONLY for call-site compatibility (100+ callers pass it positionally) and is
// deliberately not consulted — module identity cannot come from the URL under bundling.
export function isDirectEntry(importMeta: ImportMeta, argv1: string | undefined, expectedBase: string): boolean {
  void importMeta; // identity is name-based, never URL-based (see above)
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}
