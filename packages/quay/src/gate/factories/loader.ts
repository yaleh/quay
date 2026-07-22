// Workspace gate loader — discovers workspace root and reads .quay/gates.yml
// (or .quay/config.yml `gates:` section) to produce the workspace-data-driven
// gate set. Moved from registry.ts to avoid circular imports.
//
// Imports factories from ./index.ts; types from ../registry.ts (type-only,
// no runtime circular); GateConfig from ./utils.ts; Node fs/path/YAML.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { GateFn } from "../registry.ts";
import { gateFactories } from "./index.ts";
import { type GateConfig, resolveRunnerOptions as _resolveRunnerOptions } from "./utils.ts";
import { findConfig } from "../../config.ts";

// ---------------------------------------------------------------------------
// Entry interfaces (moved from registry.ts)
// ---------------------------------------------------------------------------

export interface It0Entry {
  name: string;
  script: string;
  argsKey: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface FixedEntry {
  name: string;
  script: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface TestPassEntry {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface CoverageFloorEntry {
  name: string;
  command: string;
  floor: number;
  pattern?: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface RedGreenEntry {
  name: string;
  red: string;
  green: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface GatesConfig {
  it0: It0Entry[];
  adr: string[];
  fixed: FixedEntry[];
  testPass: TestPassEntry[];
  coverageFloor: CoverageFloorEntry[];
  redGreen: RedGreenEntry[];
}

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
 * DIR-050: tries unified .quay/config.yml (gates: section) first, falls back
 * to .quay/gates.yml.
 */
export function readGatesConfig(workspaceRoot: string): GatesConfig {
  const empty: GatesConfig = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  if (!workspaceRoot) return empty;

  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");
  const legacyGatesPath = path.join(workspaceRoot, ".quay", "gates.yml");

  let parsed: unknown;
  if (fs.existsSync(unifiedConfigPath)) {
    let unified: unknown;
    try {
      unified = YAML.parse(fs.readFileSync(unifiedConfigPath, "utf8"));
    } catch {
      // malformed unified config -> fall through to legacy
    }
    if (unified && typeof unified === "object" && "gates" in unified) {
      parsed = (unified as Record<string, unknown>).gates;
    }
  }
  if (parsed === undefined) {
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
