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
// Workspace root discovery
// ---------------------------------------------------------------------------

/**
 * DIR-035-B: locate this process's workspace root the SAME way `config.js`'s
 * `findConfig` does (walk up from `startDir` for `.quay/config.yml`), so gate
 * discovery works both from a real CLI invocation and from an in-process test
 * or module caller. Returns `null` (never throws) when no `.quay/config.yml`
 * is found upward from `startDir`.
 */
export function discoverWorkspaceRoot(startDir: string = process.cwd()): string | null {
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  // configPath is <workspaceRoot>/.quay/config.yml
  return path.dirname(path.dirname(configPath));
}

// ---------------------------------------------------------------------------
// gates.yml / config.yml reader
// ---------------------------------------------------------------------------

/**
 * Read `<workspaceRoot>/.quay/gates.yml` (if present) and return its parsed
 * `{it0, adr, fixed, testPass, coverageFloor, redGreen}` shape. Missing file
 * / unparsable YAML / missing keys all degrade to all-empty-arrays
 * (fail-quiet — an ABSENT gates.yml is the fresh-workspace default, not an
 * error condition).
 *
 * DIR-050/DIR-120 Phase 2: branch A (unified `.quay/config.yml` exists) is
 * TERMINAL — it resolves to the config-derived `gates:` value or the empty
 * six-key shape and NEVER falls through to a legacy `.quay/gates.yml`, even
 * if one is present with real content (a deliberate, tested behavior change
 * — see gate-config-loader.test.mjs's silent-data-loss case). Branch B (no
 * `.quay/config.yml`) is untouched pre-DIR-050 back-compat behavior, kept
 * reachable ONLY when branch A does not apply — the legacy root files
 * `.quay/gates.yml`/`.quay/loop.yml` were deleted as part of this same
 * change (DIR-120), since branch A is unconditionally true for THIS
 * workspace; branch B remains live for any workspace (e.g. one sharing a
 * task store with a sibling experiment layer) with no
 * `.quay/config.yml` of their own.
 */
export function readGatesConfig(workspaceRoot: string): GatesConfig {
  const empty: GatesConfig = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  if (!workspaceRoot) return empty;

  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");

  let parsed: unknown;
  if (fs.existsSync(unifiedConfigPath)) {
    // Branch A — terminal. Resolve entirely from config.yml and return/exit
    // this branch WITHOUT ever constructing/checking a legacy gates.yml path.
    let unified: unknown;
    try {
      unified = YAML.parse(fs.readFileSync(unifiedConfigPath, "utf8"));
    } catch {
      // malformed unified config -> fail-quiet empty shape (no fallback to legacy)
      return empty;
    }
    if (unified && typeof unified === "object" && "gates" in unified) {
      parsed = (unified as Record<string, unknown>).gates;
    }
    if (parsed === undefined) return empty;
  } else {
    // Branch B — no config.yml at all. Untouched pre-DIR-050 legacy path,
    // reachable ONLY here.
    const legacyGatesPath = path.join(workspaceRoot, ".quay", "gates.yml");
    if (!fs.existsSync(legacyGatesPath)) return empty;
    try {
      parsed = YAML.parse(fs.readFileSync(legacyGatesPath, "utf8"));
    } catch {
      return empty; // malformed gates.yml -> no workspace gates, not a hard crash
    }
  }
  const it0 = Array.isArray((parsed as Record<string, unknown>)?.it0) ? (parsed as Record<string, unknown>).it0 as It0Entry[] : [];
  const adr = Array.isArray((parsed as Record<string, unknown>)?.adr) ? (parsed as Record<string, unknown>).adr as string[] : [];
  const fixed = Array.isArray((parsed as Record<string, unknown>)?.fixed) ? (parsed as Record<string, unknown>).fixed as FixedEntry[] : [];
  const testPass = Array.isArray((parsed as Record<string, unknown>)?.testPass) ? (parsed as Record<string, unknown>).testPass as TestPassEntry[] : [];
  const coverageFloor = Array.isArray((parsed as Record<string, unknown>)?.coverageFloor) ? (parsed as Record<string, unknown>).coverageFloor as CoverageFloorEntry[] : [];
  const redGreen = Array.isArray((parsed as Record<string, unknown>)?.redGreen) ? (parsed as Record<string, unknown>).redGreen as RedGreenEntry[] : [];
  return { it0, adr, fixed, testPass, coverageFloor, redGreen };
}

// ---------------------------------------------------------------------------
// Workspace gate set builder
// ---------------------------------------------------------------------------

/**
 * Build the WORKSPACE-DATA-DRIVEN gate set for `workspaceRoot`: one
 * `makeIt0Gate` per `gates.yml`'s `it0[]` entry, one `makeAdrGate` per
 * `adr[]` entry (lowercased), one `makeFixedScriptGate` per `fixed[]` entry
 * (DIR-035-D), plus (DIR-042-A) one `makeTestPassGate` per `testPass[]`
 * entry, one `makeCoverageFloorGate` per `coverageFloor[]` entry, and one
 * `makeRedGreenGate` per `redGreen[]` entry. Returns `{}` for a workspace
 * with no `gates.yml` (or an empty one).
 */
export function loadWorkspaceGates(workspaceRoot: string | null): Record<string, GateFn> {
  if (!workspaceRoot) return {};
  const { it0, adr, fixed, testPass, coverageFloor, redGreen } = readGatesConfig(workspaceRoot);
  const gates: Record<string, GateFn> = {};
  // DIR-046-B: pull each entry's own optional `cwd`/`timeoutMs` gates.yml
  // fields into a `{cwd, timeoutMs}` gateConfig, resolved relative to
  // workspaceRoot for a relative `cwd`.
  const gateConfigOf = (entry: GateConfig & { cwd?: string; timeoutMs?: number }): GateConfig => {
    const cwd = typeof entry?.cwd === "string" && entry.cwd.trim() !== ""
      ? (path.isAbsolute(entry.cwd) ? entry.cwd : path.resolve(workspaceRoot, entry.cwd))
      : undefined;
    const timeoutMs = typeof entry?.timeoutMs === "number" && entry.timeoutMs > 0 ? entry.timeoutMs : undefined;
    return { cwd, timeoutMs };
  };
  for (const entry of it0) {
    if (!entry?.name || !entry?.script || !entry?.argsKey) continue;
    const scriptPath = path.isAbsolute(entry.script)
      ? entry.script
      : path.resolve(workspaceRoot, entry.script);
    gates[entry.name] = gateFactories["it0"](scriptPath, entry.argsKey, entry.name, gateConfigOf(entry));
  }
  const adrDir = path.join(workspaceRoot, "adr");
  for (const adrId of adr) {
    if (typeof adrId !== "string" || adrId.trim() === "") continue;
    gates[adrId.toLowerCase()] = gateFactories["adr"](adrId, adrDir);
  }
  for (const entry of fixed) {
    if (!entry?.name || !entry?.script) continue;
    const scriptPath = path.isAbsolute(entry.script)
      ? entry.script
      : path.resolve(workspaceRoot, entry.script);
    gates[entry.name] = gateFactories["fixed-script"](scriptPath, entry.name, gateConfigOf(entry));
  }
  for (const entry of testPass) {
    if (!entry?.name || typeof entry?.command !== "string") continue;
    gates[entry.name] = gateFactories["test-pass"](entry.command, entry.name, gateConfigOf(entry));
  }
  for (const entry of coverageFloor) {
    if (!entry?.name || typeof entry?.command !== "string" || typeof entry?.floor !== "number") continue;
    gates[entry.name] = gateFactories["coverage-floor"](entry.command, entry.floor, entry.pattern, entry.name, gateConfigOf(entry));
  }
  for (const entry of redGreen) {
    if (!entry?.name || typeof entry?.red !== "string" || typeof entry?.green !== "string") continue;
    gates[entry.name] = gateFactories["red-green"](entry.red, entry.green, entry.name, gateConfigOf(entry));
  }
  return gates;
}

// DIR-103-A compat: thin wrapper for registry.ts's listGatesVerbose (which
// imports loadWorkspaceGateMetadata). Returns gates + empty rows/diagnostics
// (full metadata pass not yet wired in this refactored loader).

export function loadWorkspaceGateMetadata(workspaceRoot) {
  return { gates: loadWorkspaceGates(workspaceRoot), rows: [], diagnostics: [] };
}
