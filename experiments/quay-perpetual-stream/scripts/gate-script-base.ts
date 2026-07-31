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

// ── parseArgs ──────────────────────────────────────────────────────────────────────────────────────
// Parse CLI arguments according to a spec. Flags are parsed as --name value or --name=value (string),
// or --name alone (boolean). Positional args are everything else.
//
// Exits with code 2 and a usage message if fewer than minArgs positional args are provided.
export function parseArgs(argv: string[], spec: CliSpec): ParsedArgs {
  const result: ParsedArgs = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};

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
    const scriptName = path.basename(argv[1] || "script");
    console.error(`Usage: ${scriptName} ${spec.usage}`);
    process.exit(2);
  }

  return result;
}

// ── readFrontmatter ─────────────────────────────────────────────────────────────────────────────────
// Read and parse YAML frontmatter from a markdown file.
// Returns a Record of key→value for simple scalar/list fields, or null if no frontmatter found.
export function readFrontmatter(filePath: string): Record<string, any> | null {
  const text = fs.readFileSync(filePath, "utf8");
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
export function isDirectEntry(importMeta: ImportMeta, argv1?: string): boolean {
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fileURLToPath(importMeta.url);
  } catch {
    return false;
  }
}
