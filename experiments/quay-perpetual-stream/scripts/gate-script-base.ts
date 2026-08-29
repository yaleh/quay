// gate-script-base.ts — shared framework primitives for TypeScript gate scripts.
// Import the functions/classes you need from this module.
//
// Usage:
//   import { parseArgs, readFrontmatter, emitPass, emitFail, requireArg, isDirectEntry } from "./gate-script-base.ts";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// ── emitPass / emitFail ─────────────────────────────────────────────────────────────────────────────
// Standardized PASS / FAIL output lines.
export function emitPass(message: string): void {
  console.log(`PASS: ${message}`);
}

export function emitFail(message: string): void {
  console.log(`FAIL: ${message}`);
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
// Usage:
//   if (isDirectEntry(import.meta)) main(process.argv).then(code => process.exit(code));
//   // bundler-friendly form (see expectedBase below):
//   if (isDirectEntry(import.meta, undefined, "tool-name")) main(process.argv).then(code => process.exit(code));
//
// BUNDLER-FRIENDLY (gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact): when a
// plugin .ts is bundled into a single ESM file, EVERY inlined module shares the bundle's
// `import.meta.url`, so the URL-equality check alone returns true for imported libraries too — the
// library's top-level CLI block would fire while another tool runs. Callers therefore pass their own
// canonical basename as `expectedBase`; when provided, the check requires the executed file's
// basename to match, which holds for the entry in both source and bundle forms and never for an
// inlined library (the bundle's basename is the entry's, not the library's).
export function isDirectEntry(importMeta: ImportMeta, argv1?: string, expectedBase?: string): boolean {
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  try {
    if (expectedBase !== undefined) {
      return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
    }
    return fs.realpathSync(path.resolve(entry)) === fileURLToPath(importMeta.url);
  } catch {
    return false;
  }
}
