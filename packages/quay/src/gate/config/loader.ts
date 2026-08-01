// Workspace gate loader — discovers workspace root and reads .quay/gates.yml
// (or .quay/config.yml `gates:` section) to produce the workspace-data-driven
// gate set. Extracted from gate/factories/loader.ts to reduce fanOut.
//
// Imports factories from ../factories/index.ts; types from ../registry.ts
// (type-only, no runtime circular); config types from ./types.ts; Node
// fs/path/YAML.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { GateFn } from "../registry.ts";
import { gateFactories } from "../factories/index.ts";
import { type GateConfig, resolveRunnerOptions } from "./utils.ts";
import type {
  It0Entry,
  FixedEntry,
  TestPassEntry,
  CoverageFloorEntry,
  RedGreenEntry,
  GatesConfig,
} from "./types.ts";
import { findConfig } from "../../config.ts";

// Re-export types so consumers can import from a single module.
export type {
  It0Entry,
  FixedEntry,
  TestPassEntry,
  CoverageFloorEntry,
  RedGreenEntry,
  GatesConfig,
};

// ---------------------------------------------------------------------------
// Diagnostic output channel (DIR-100-C)
// ---------------------------------------------------------------------------

/**
 * Severity taxonomy for gate loader diagnostics — reconciled per DIR-100-C:
 * `error` = gate will not be registered (missing required field, unrecognized
 * key/nesting defect that drops the gate); `warn` = gate registered but entry
 * has unexpected extra fields.
 */
export type DiagnosticSeverity = "error" | "warn";

/** Rendered label per severity (data, not prose — AC4 grep-confirmable). */
export const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  error: "[error]",
  warn: "[warn]",
};

/** Sink contract for diagnostic output. */
export interface GateDiagnosticsSink {
  append(line: string): void;
}

/**
 * The six gate sections recognized as top-level keys under a `gates:` mapping
 * (DIR-100-A/C). Single source for the "expected set" string in diagnostics.
 */
export const KNOWN_GATE_SECTIONS = ["it0", "adr", "fixed", "testPass", "coverageFloor", "redGreen"];

// Memoized sink — resolved once per process.
let cachedSink: GateDiagnosticsSink | undefined;

/**
 * Resolve the diagnostics sink from `QUAY_GATE_DIAGNOSTICS` (once per process).
 *
 * - absent / "stderr" / empty / whitespace-only → `process.stderr`
 * - "quiet" → null sink (no-op)
 * - any other non-empty, non-whitespace value → append-mode file stream
 *   with an `error` listener that falls back to `process.stderr` on
 *   unwritable/invalid paths (ENOENT, EISDIR, etc.).
 *
 * Never writes to `process.stdout` under ANY value.
 */
export function resolveGateDiagnosticsSink(): GateDiagnosticsSink {
  if (cachedSink) return cachedSink;
  const raw = process.env.QUAY_GATE_DIAGNOSTICS;
  if (raw === undefined || raw === "stderr" || raw.trim() === "") {
    cachedSink = {
      append(line: string): void { process.stderr.write(line + "\n"); },
    };
    return cachedSink;
  }
  if (raw === "quiet") {
    cachedSink = { append(_line: string): void {} };
    return cachedSink;
  }
  const pending: string[] = [];
  const stream = fs.createWriteStream(raw, { flags: "a" });
  let writer: (line: string) => void = (line: string) => {
    pending.push(line);
    stream.write(line + "\n");
  };
  let degraded = false;
  stream.on("error", (err) => {
    if (!degraded) {
      degraded = true;
      for (const line of pending) {
        process.stderr.write(line + "\n");
      }
      process.stderr.write("[error] QUAY_GATE_DIAGNOSTICS: cannot write to '" + raw + "' (" + err.message + "); falling back to stderr\n");
      writer = (line: string) => process.stderr.write(line + "\n");
    }
  });
  cachedSink = {
    append(line: string): void { writer(line); },
  };
  return cachedSink;
}

/**
 * Emit one diagnostic line through the resolved sink. This is the SINGLE
 * emission point for ALL loader diagnostics (DIR-100-A/B route through here).
 */
export function emitDiagnostic(severity: DiagnosticSeverity, message: string): void {
  resolveGateDiagnosticsSink().append(`${SEVERITY_LABEL[severity]} ${message}`);
}

// ---------------------------------------------------------------------------
// Workspace root discovery
// ---------------------------------------------------------------------------

export function discoverWorkspaceRoot(startDir: string = process.cwd()): string | null {
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  return path.dirname(path.dirname(configPath));
}

// ---------------------------------------------------------------------------
// gates.yml / config.yml reader
// ---------------------------------------------------------------------------

export function readGatesConfig(workspaceRoot: string): GatesConfig {
  const empty: GatesConfig = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  if (!workspaceRoot) return empty;
  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");
  let parsed: unknown;
  if (fs.existsSync(unifiedConfigPath)) {
    let unified: unknown;
    try {
      unified = YAML.parse(fs.readFileSync(unifiedConfigPath, "utf8"));
    } catch {
      return empty;
    }
    if (unified && typeof unified === "object" && "gates" in unified) {
      parsed = (unified as Record<string, unknown>).gates;
    }
    if (parsed === undefined) return empty;
  } else {
    const legacyGatesPath = path.join(workspaceRoot, ".quay", "gates.yml");
    if (!fs.existsSync(legacyGatesPath)) return empty;
    try {
      parsed = YAML.parse(fs.readFileSync(legacyGatesPath, "utf8"));
    } catch {
      return empty;
    }
  }
  const it0 = Array.isArray((parsed as Record<string, unknown>)?.it0) ? (parsed as Record<string, unknown>).it0 as It0Entry[] : [];
  const adr = Array.isArray((parsed as Record<string, unknown>)?.adr) ? (parsed as Record<string, unknown>).adr as string[] : [];
  const fixed = Array.isArray((parsed as Record<string, unknown>)?.fixed) ? (parsed as Record<string, unknown>).fixed as FixedEntry[] : [];
  const testPass = Array.isArray((parsed as Record<string, unknown>)?.testPass) ? (parsed as Record<string, unknown>).testPass as TestPassEntry[] : [];
  const coverageFloor = Array.isArray((parsed as Record<string, unknown>)?.coverageFloor) ? (parsed as Record<string, unknown>).coverageFloor as CoverageFloorEntry[] : [];
  const redGreen = Array.isArray((parsed as Record<string, unknown>)?.redGreen) ? (parsed as Record<string, unknown>).redGreen as RedGreenEntry[] : [];

  // DIR-100-C: fail-loud scan. null and arrays silent; scalars get error; objects scanned.
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const key of Object.keys(parsed)) {
      if (!KNOWN_GATE_SECTIONS.includes(key)) {
        emitDiagnostic("error", "unrecognized gate section '" + key + "' — expected one of " + KNOWN_GATE_SECTIONS.join(", ") + "; section ignored");
      } else if (!Array.isArray((parsed as Record<string, unknown>)[key])) {
        emitDiagnostic("error", "gate section '" + key + "' must be a list (wrong nesting level); entries ignored");
      }
    }
  } else if (parsed !== null && parsed !== undefined && typeof parsed !== "object") {
    emitDiagnostic("error", "gates: is not a mapping of gate sections (got " + typeof parsed + "); expected sections: " + KNOWN_GATE_SECTIONS.join(", "));
  }

  return { it0, adr, fixed, testPass, coverageFloor, redGreen };
}

// ---------------------------------------------------------------------------
// Workspace gate set builder
// ---------------------------------------------------------------------------

export function loadWorkspaceGates(workspaceRoot: string | null): Record<string, GateFn> {
  if (!workspaceRoot) return {};
  const { it0, adr, fixed, testPass, coverageFloor, redGreen } = readGatesConfig(workspaceRoot);
  const gates: Record<string, GateFn> = {};
  const gateConfigOf = (entry: GateConfig & { cwd?: string; timeoutMs?: number }): GateConfig => {
    const cwd = typeof entry?.cwd === "string" && entry.cwd.trim() !== ""
      ? (path.isAbsolute(entry.cwd) ? entry.cwd : path.resolve(workspaceRoot, entry.cwd))
      : undefined;
    const timeoutMs = typeof entry?.timeoutMs === "number" && entry.timeoutMs > 0 ? entry.timeoutMs : undefined;
    return { cwd, timeoutMs };
  };

  // DIR-100-C: known-field sets for extra-field warn checks
  const K_IT0 = new Set(["name", "script", "argsKey", "cwd", "timeoutMs"]);
  const K_FIXED = new Set(["name", "script", "cwd", "timeoutMs"]);
  const K_TP = new Set(["name", "command", "cwd", "timeoutMs"]);
  const K_COV = new Set(["name", "command", "floor", "pattern", "cwd", "timeoutMs"]);
  const K_RG = new Set(["name", "red", "green", "cwd", "timeoutMs"]);

  const warnExtra = (type: string, entry: Record<string, unknown>, known: Set<string>): void => {
    const extras = Object.keys(entry).filter((k) => !known.has(k));
    if (extras.length > 0) {
      const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name : "<unnamed>";
      emitDiagnostic("warn", type + " gate '" + name + "' has unexpected extra field(s) — registered");
    }
  };

  // it0 — required: name, script, argsKey
  for (const entry of it0) {
    const name = entry?.name || "<unnamed>";
    if (!entry?.name) { emitDiagnostic("error", "it0 gate '" + name + "' missing required field 'name' — gate will not be registered"); continue; }
    if (!entry?.script) { emitDiagnostic("error", "it0 gate '" + entry.name + "' missing required field 'script' — gate will not be registered"); continue; }
    if (!entry?.argsKey) { emitDiagnostic("error", "it0 gate '" + entry.name + "' missing required field 'argsKey' — gate will not be registered"); continue; }
    const scriptPath = path.isAbsolute(entry.script) ? entry.script : path.resolve(workspaceRoot, entry.script);
    gates[entry.name] = gateFactories["it0"](scriptPath, entry.argsKey, entry.name, gateConfigOf(entry));
    warnExtra("it0", entry as unknown as Record<string, unknown>, K_IT0);
  }

  // adr — plain string array, second of six silent-skip guards in source order
  const adrDir = path.join(workspaceRoot, "adr");
  for (const adrId of adr) {
    if (typeof adrId !== "string" || adrId.trim() === "") continue;
    gates[adrId.toLowerCase()] = gateFactories["adr"](adrId, adrDir);
  }

  // fixed — required: name, script
  for (const entry of fixed) {
    const name = entry?.name || "<unnamed>";
    if (!entry?.name) { emitDiagnostic("error", "fixed gate '" + name + "' missing required field 'name' — gate will not be registered"); continue; }
    if (!entry?.script) { emitDiagnostic("error", "fixed gate '" + entry.name + "' missing required field 'script' — gate will not be registered"); continue; }
    const scriptPath = path.isAbsolute(entry.script) ? entry.script : path.resolve(workspaceRoot, entry.script);
    gates[entry.name] = gateFactories["fixed-script"](scriptPath, entry.name, gateConfigOf(entry));
    warnExtra("fixed", entry as unknown as Record<string, unknown>, K_FIXED);
  }

  // testPass — required: name, command
  for (const entry of testPass) {
    if (!entry?.name) { emitDiagnostic("error", "testPass gate '<unnamed>' missing required field 'name' — gate will not be registered"); continue; }
    if (typeof entry?.command !== "string") { emitDiagnostic("error", "testPass gate '" + entry.name + "' missing required field 'command' — gate will not be registered"); continue; }
    gates[entry.name] = gateFactories["test-pass"](entry.command, entry.name, gateConfigOf(entry));
    warnExtra("testPass", entry as unknown as Record<string, unknown>, K_TP);
  }

  // coverageFloor — required: name, command, floor (pattern is OPTIONAL)
  for (const entry of coverageFloor) {
    if (!entry?.name) { emitDiagnostic("error", "coverageFloor gate '<unnamed>' missing required field 'name' — gate will not be registered"); continue; }
    if (typeof entry?.command !== "string") { emitDiagnostic("error", "coverageFloor gate '" + entry.name + "' missing required field 'command' — gate will not be registered"); continue; }
    if (typeof entry?.floor !== "number") { emitDiagnostic("error", "coverageFloor gate '" + entry.name + "' missing required field 'floor' — gate will not be registered"); continue; }
    gates[entry.name] = gateFactories["coverage-floor"](entry.command, entry.floor, entry.pattern, entry.name, gateConfigOf(entry));
    warnExtra("coverageFloor", entry as unknown as Record<string, unknown>, K_COV);
  }

  // redGreen — required: name, red, green
  for (const entry of redGreen) {
    if (!entry?.name) { emitDiagnostic("error", "redGreen gate '<unnamed>' missing required field 'name' — gate will not be registered"); continue; }
    if (typeof entry?.red !== "string") { emitDiagnostic("error", "redGreen gate '" + entry.name + "' missing required field 'red' — gate will not be registered"); continue; }
    if (typeof entry?.green !== "string") { emitDiagnostic("error", "redGreen gate '" + entry.name + "' missing required field 'green' — gate will not be registered"); continue; }
    gates[entry.name] = gateFactories["red-green"](entry.red, entry.green, entry.name, gateConfigOf(entry));
    warnExtra("redGreen", entry as unknown as Record<string, unknown>, K_RG);
  }

  return gates;
}
