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
import type { GateFn } from "../types.ts";
import { gateFactories } from "../factories/index.ts";
import { type GateConfig, resolveRunnerOptions } from "../../kernel/gate-run-options.ts";
import type {
  It0Entry,
  FixedEntry,
  TestPassEntry,
  CoverageFloorEntry,
  RedGreenEntry,
  GatesConfig,
  GateSource,
  GateDiagnostic,
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
  GateSource,
  GateDiagnostic,
};

// ---------------------------------------------------------------------------
// Diagnostic output channel (DIR-100-C)
// ---------------------------------------------------------------------------

/** Severity taxonomy: error = gate not registered, warn = registered with extras. */
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

/** Known top-level gate sections under `gates:` (DIR-100-A/C). */
export const KNOWN_GATE_SECTIONS = ["it0", "adr", "fixed", "testPass", "coverageFloor", "redGreen"];

// Memoized sink — resolved once per process.
let cachedSink: GateDiagnosticsSink | undefined;

/** Resolve the diagnostics sink from QUAY_GATE_DIAGNOSTICS (once per process). */
export function resolveGateDiagnosticsSink(): GateDiagnosticsSink {
  if (cachedSink) return cachedSink;
  const raw = process.env.QUAY_GATE_DIAGNOSTICS;
  if (raw === undefined || raw === "stderr" || raw.trim() === "") {
    cachedSink = { append(line: string): void { process.stderr.write(line + "\n"); } };
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
      for (const line of pending) process.stderr.write(line + "\n");
      process.stderr.write("[error] QUAY_GATE_DIAGNOSTICS: cannot write to '" + raw + "' (" + err.message + "); falling back to stderr\n");
      writer = (line: string) => process.stderr.write(line + "\n");
    }
  });
  cachedSink = { append(line: string): void { writer(line); } };
  return cachedSink;
}

/** Emit one diagnostic line through the resolved sink — single emission point. */
export function emitDiagnostic(severity: DiagnosticSeverity, message: string): void {
  resolveGateDiagnosticsSink().append(`${SEVERITY_LABEL[severity]} ${message}`);
}

// ---------------------------------------------------------------------------
// Workspace root discovery
// ---------------------------------------------------------------------------

/**
 * Resolve the workspace root, starting the `.quay/config.yml` search at
 * `startDir` and walking up as needed (single mechanism for BOTH the default
 * process.cwd() case and the explicit `--root <path>` case —
 * gap-task-list-root-does-not-scope-config-lookup AC4: no second semantics).
 *
 * Returns null when no config is discoverable from `startDir` upward — the
 * caller decides whether to fail closed or fall back. The CLI's `--root`
 * surface uses {@link resolveWorkspaceRootOrThrow} so it NEVER silently falls
 * back to process.cwd() (AC2).
 */
export function discoverWorkspaceRoot(startDir: string = process.cwd()): string | null {
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  return path.dirname(path.dirname(configPath));
}

/**
 * Fail-closed workspace-root resolution for the CLI's `--root <path>` surface
 * (gap-task-list-root-does-not-scope-config-lookup AC2): resolves the workspace
 * root by starting the config search at `startDir` (walk-up, same findConfig
 * mechanism discoverWorkspaceRoot/loadConfig use everywhere), and THROWS a
 * clear error instead of returning null — so a `--root` that points at a
 * directory with no `.quay/config.yml` produces a clean failure rather than a
 * silent fallback to process.cwd().
 */
export function resolveWorkspaceRootOrThrow(startDir: string): string {
  const root = discoverWorkspaceRoot(startDir);
  if (!root) {
    throw new Error(
      `no .quay/config.yml found under --root "${startDir}" (searched from there upward). ` +
        `Point --root at a quay workspace root (a directory containing .quay/config.yml).`
    );
  }
  return root;
}

// ---------------------------------------------------------------------------
// Shared file resolver — single owner of branch-A-terminal precedence
// ---------------------------------------------------------------------------

function resolveGateConfigFile(workspaceRoot: string | null): { file: string; text: string } | null {
  if (!workspaceRoot) return null;
  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (fs.existsSync(unifiedConfigPath)) {
    return { file: unifiedConfigPath, text: fs.readFileSync(unifiedConfigPath, "utf8") };
  }
  const legacyGatesPath = path.join(workspaceRoot, ".quay", "gates.yml");
  if (!fs.existsSync(legacyGatesPath)) return null;
  return { file: legacyGatesPath, text: fs.readFileSync(legacyGatesPath, "utf8") };
}

// ---------------------------------------------------------------------------
// Private single-pass CST parser (DIR-104)
// ---------------------------------------------------------------------------

function parseGatesConfig(text: string, srcFile?: string): {
  config: GatesConfig;
  adrLines: Array<{ id: string; line: number }>;
} {
  const empty: GatesConfig = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  const adrLines: Array<{ id: string; line: number }> = [];

  let doc: YAML.Document;
  const lc = new YAML.LineCounter();
  try { doc = YAML.parseDocument(text, { keepSourceTokens: true, lineCounter: lc }); }
  catch { return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] }; }

  // Fail-quiet on syntax errors: parseDocument reports errors (does not throw)
  // and can still expose a partial tree — proceeding would fabricate phantom
  // gates from malformed input. Treat any parse error as "no config" (DIR-104
  // provenance still recorded), matching readGatesConfig's documented contract.
  if (doc.errors.length > 0) {
    return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] };
  }

  if (!doc.contents || !YAML.isMap(doc.contents)) {
    return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] };
  }

  let gatesMap: YAML.YAMLMap | null = null;
  if (doc.contents.has("gates")) {
    const gNode = doc.contents.get("gates", true);
    if (YAML.isMap(gNode)) gatesMap = gNode;
  } else {
    // Top-level-as-gates-map applies ONLY to a legacy .quay/gates.yml source.
    // A unified config.yml without a `gates:` section carries providers/loop/
    // etc. at the top level — treating it as a gates map fabricates phantom
    // "unrecognized gate section 'providers'/'loop'" diagnostics via the
    // fail-loud scan below. Return empty for any non-legacy source
    // (cand-gate-loader-unified-config-no-gates-spurious-diagnostics).
    const isLegacyGatesYml = srcFile !== undefined && path.basename(srcFile) === "gates.yml";
    if (isLegacyGatesYml) gatesMap = doc.contents;
  }
  if (!gatesMap) return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] };

  // DIR-100-C: fail-loud scan of top-level keys (M226 scope, wired through emitDiagnostic)
  for (const pair of gatesMap.items) {
    if (!YAML.isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    if (!KNOWN_GATE_SECTIONS.includes(key)) {
      emitDiagnostic("error", "unrecognized gate section '" + key + "' — expected one of " + KNOWN_GATE_SECTIONS.join(", ") + "; section ignored");
    } else if (!YAML.isSeq(pair.value)) {
      emitDiagnostic("error", "gate section '" + key + "' must be a list (wrong nesting level); entries ignored");
    }
  }

  const lineOf = (node: unknown): number => {
    const n = node as { range?: [number, number, number?] };
    if (!n?.range?.[0]) return 0;
    return lc.linePos(n.range[0]).line;
  };

  const parseSection = (key: string): Array<{ data: Record<string, unknown>; line: number }> => {
    const node = gatesMap!.get(key, true);
    if (!node || !YAML.isSeq(node)) return [];
    return node.items.map((item) => {
      const line = lineOf(item);
      if (YAML.isMap(item)) {
        const data: Record<string, unknown> = {};
        for (const pair of item.items) {
          if (YAML.isScalar(pair.key)) {
            const k = String(pair.key.value);
            data[k] = YAML.isScalar(pair.value) ? pair.value.value : ((pair.value as { toJSON?: () => unknown })?.toJSON?.() ?? null);
          }
        }
        return { data, line };
      }
      return { data: {}, line };
    }).filter((e) => Object.keys(e.data).length > 0);
  };

  const mkSrc = (line: number): GateSource | undefined =>
    srcFile && line > 0 ? { file: srcFile, line } : undefined;

  const it0Parsed = parseSection("it0");
  const fixedParsed = parseSection("fixed");
  const testPassParsed = parseSection("testPass");
  const coverageFloorParsed = parseSection("coverageFloor");
  const redGreenParsed = parseSection("redGreen");

  const adrNode = gatesMap.get("adr", true);
  if (adrNode && YAML.isSeq(adrNode)) {
    for (const item of adrNode.items) {
      if (YAML.isScalar(item) && typeof item.value === "string" && item.value.trim() !== "") {
        adrLines.push({ id: item.value.trim(), line: lineOf(item) });
      }
    }
  }

  const config: GatesConfig = {
    it0: it0Parsed.map((e) => ({ ...e.data, src: mkSrc(e.line) } as It0Entry)),
    adr: adrLines.map((a) => a.id),
    fixed: fixedParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) } as FixedEntry)),
    testPass: testPassParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) } as TestPassEntry)),
    coverageFloor: coverageFloorParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) } as CoverageFloorEntry)),
    redGreen: redGreenParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) } as RedGreenEntry)),
    srcFile,
  };

  return { config, adrLines };
}

// ---------------------------------------------------------------------------
// gates.yml / config.yml reader (thin wrapper)
// ---------------------------------------------------------------------------

export function readGatesConfig(workspaceRoot: string): GatesConfig {
  const empty: GatesConfig = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  const resolved = resolveGateConfigFile(workspaceRoot);
  if (!resolved) return empty;
  try { return parseGatesConfig(resolved.text, resolved.file).config; }
  catch { return empty; }
}

// ---------------------------------------------------------------------------
// Per-entry required-field diagnostics (DIR-100-B, routed through DIR-100-C channel)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  it0: ["name", "script", "argsKey"],
  fixed: ["name", "script"],
  testPass: ["name", "command"],
  coverageFloor: ["name", "command", "floor"],
  redGreen: ["name", "red", "green"],
};

function fieldPresent(entry: unknown, field: string): boolean {
  const v = (entry as Record<string, unknown>)[field];
  switch (field) {
    case "name": case "script": case "argsKey": return Boolean(v);
    case "command": case "red": case "green": return typeof v === "string";
    case "floor": return typeof v === "number";
    default: return true;
  }
}

/** Collect missing-field diagnostics as GateDiagnostic[] for programmatic consumers. */
function collectEntryDiagnostics(type: string, entry: unknown): GateDiagnostic[] {
  const e = entry as Record<string, unknown> | undefined;
  const missing = (REQUIRED_FIELDS[type] ?? []).filter((f) => !e || !fieldPresent(e, f));
  if (missing.length === 0) return [];
  const name = typeof e?.name === "string" && (e.name as string).trim() !== "" ? e.name : "<unnamed>";
  return missing.map((field) => ({
    level: "ERROR" as const,
    message: type + " gate '" + name + "' missing required field '" + field + "' — gate will not be registered",
  }));
}

// DIR-100-C: known-field sets for extra-field warn checks
const KNOWN_IT0 = new Set(["name", "script", "argsKey", "cwd", "timeoutMs", "src"]);
const KNOWN_FIXED = new Set(["name", "script", "cwd", "timeoutMs", "src"]);
const KNOWN_TP = new Set(["name", "command", "cwd", "timeoutMs", "src"]);
const KNOWN_COV = new Set(["name", "command", "floor", "pattern", "cwd", "timeoutMs", "src"]);
const KNOWN_RG = new Set(["name", "red", "green", "cwd", "timeoutMs", "src"]);

function warnExtraFields(type: string, entry: Record<string, unknown>, known: Set<string>): void {
  const extras = Object.keys(entry).filter((k) => !known.has(k));
  if (extras.length > 0) {
    const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name : "<unnamed>";
    emitDiagnostic("warn", type + " gate '" + name + "' has unexpected extra field(s) — registered");
  }
}

// ---------------------------------------------------------------------------
// Workspace gate metadata pass (DIR-104 — provenance + diagnostics)
// ---------------------------------------------------------------------------

export function loadWorkspaceGateMetadata(workspaceRoot: string | null): {
  gates: Record<string, GateFn>;
  rows: Array<{ name: string; source: string; type: string; detail: string }>;
  diagnostics: GateDiagnostic[];
} {
  if (!workspaceRoot) return { gates: {}, rows: [], diagnostics: [] };

  const resolved = resolveGateConfigFile(workspaceRoot);
  const diagnostics: GateDiagnostic[] = [];
  const rows: Array<{ name: string; source: string; type: string; detail: string }> = [];
  const gates: Record<string, GateFn> = {};

  if (resolved) {
    let cfg: GatesConfig;
    let adrLines: Array<{ id: string; line: number }>;
    try {
      const parsed = parseGatesConfig(resolved.text, resolved.file);
      cfg = parsed.config;
      adrLines = parsed.adrLines;
    } catch { return { gates: {}, rows: [], diagnostics: [] }; }

    const srcFile = cfg.srcFile ?? resolved.file;
    const srcStr = (line: number) => (line > 0 ? srcFile + ":" + line : srcFile);

    // branch-A shadow probe
    const configYmlPath = path.join(workspaceRoot, ".quay", "config.yml");
    if (fs.existsSync(configYmlPath)) {
      const legacyPath = path.join(workspaceRoot, ".quay", "gates.yml");
      if (fs.existsSync(legacyPath)) {
        try {
          const legacyCfg = parseGatesConfig(fs.readFileSync(legacyPath, "utf8"), legacyPath).config;
          const registered: Set<string> = new Set([
            ...cfg.it0.map((e) => e.name), ...cfg.adr,
            ...cfg.fixed.map((e) => e.name), ...cfg.testPass.map((e) => e.name),
            ...cfg.coverageFloor.map((e) => e.name), ...cfg.redGreen.map((e) => e.name),
          ].filter(Boolean));
          for (const arr of [legacyCfg.it0, legacyCfg.fixed, legacyCfg.testPass, legacyCfg.coverageFloor, legacyCfg.redGreen]) {
            for (const e of arr) {
              const nm = (e as { name?: string }).name;
              if (nm && !registered.has(nm)) {
                const legacySrc = (e as { src?: GateSource }).src;
                const loc = legacySrc ? legacySrc.file + ":" + legacySrc.line : legacyPath;
                diagnostics.push({
                  level: "WARNING",
                  message: "gate '" + nm + "' declared in " + loc + " as testPass but NOT registered — .quay/config.yml has a gates: section that takes precedence (DIR-050).",
                });
              }
            }
          }
        } catch { /* best-effort */ }
      }
    }

    const gateConfigOf = (entry: { cwd?: string; timeoutMs?: number }) => {
      const cwd = typeof entry?.cwd === "string" && entry.cwd.trim() !== ""
        ? (path.isAbsolute(entry.cwd) ? entry.cwd : path.resolve(workspaceRoot, entry.cwd)) : undefined;
      const timeoutMs = typeof entry?.timeoutMs === "number" && entry.timeoutMs > 0 ? entry.timeoutMs : undefined;
      return { cwd, timeoutMs };
    };

    // it0
    for (const entry of cfg.it0) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "script") || !fieldPresent(entry, "argsKey")) {
        diagnostics.push(...collectEntryDiagnostics("it0", entry));
        continue;
      }
      const scriptPath = path.isAbsolute(entry.script) ? entry.script : path.resolve(workspaceRoot, entry.script);
      gates[entry.name] = gateFactories["it0"](scriptPath, entry.argsKey, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "it0", detail: "script: " + entry.script + " argsKey: " + entry.argsKey });
      warnExtraFields("it0", entry as unknown as Record<string, unknown>, KNOWN_IT0);
    }

    // adr
    const adrDir = path.join(workspaceRoot, "adr");
    for (const a of adrLines) {
      if (!a.id || a.id.trim() === "") continue;
      gates[a.id.toLowerCase()] = gateFactories["adr"](a.id, adrDir);
      rows.push({ name: a.id.toLowerCase(), source: srcStr(a.line), type: "adr", detail: "adr: " + a.id });
    }

    // fixed
    for (const entry of cfg.fixed) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "script")) {
        diagnostics.push(...collectEntryDiagnostics("fixed", entry));
        continue;
      }
      const scriptPath = path.isAbsolute(entry.script) ? entry.script : path.resolve(workspaceRoot, entry.script);
      gates[entry.name] = gateFactories["fixed-script"](scriptPath, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "fixed", detail: "script: " + entry.script });
      warnExtraFields("fixed", entry as unknown as Record<string, unknown>, KNOWN_FIXED);
    }

    // testPass
    for (const entry of cfg.testPass) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "command")) {
        diagnostics.push(...collectEntryDiagnostics("testPass", entry));
        continue;
      }
      gates[entry.name] = gateFactories["test-pass"](entry.command, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "testPass", detail: "command: " + entry.command });
      warnExtraFields("testPass", entry as unknown as Record<string, unknown>, KNOWN_TP);
    }

    // coverageFloor
    for (const entry of cfg.coverageFloor) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "command") || !fieldPresent(entry, "floor")) {
        diagnostics.push(...collectEntryDiagnostics("coverageFloor", entry));
        continue;
      }
      gates[entry.name] = gateFactories["coverage-floor"](entry.command, entry.floor, entry.pattern, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "coverageFloor", detail: "command: " + entry.command + " floor: " + entry.floor + "%" });
      warnExtraFields("coverageFloor", entry as unknown as Record<string, unknown>, KNOWN_COV);
    }

    // redGreen
    for (const entry of cfg.redGreen) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "red") || !fieldPresent(entry, "green")) {
        diagnostics.push(...collectEntryDiagnostics("redGreen", entry));
        continue;
      }
      gates[entry.name] = gateFactories["red-green"](entry.red, entry.green, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "redGreen", detail: "red: " + entry.red + " green: " + entry.green });
      warnExtraFields("redGreen", entry as unknown as Record<string, unknown>, KNOWN_RG);
    }
  }

  // DIR-100-C: route collected diagnostics through the channel
  for (const d of diagnostics) {
    if (d.level === "ERROR") {
      emitDiagnostic("error", d.message);
    }
  }

  return { gates, rows, diagnostics };
}

// ---------------------------------------------------------------------------
// Workspace gate set builder (thin wrapper — G3 contract preserved)
// ---------------------------------------------------------------------------

export function loadWorkspaceGates(workspaceRoot: string | null): Record<string, GateFn> {
  return loadWorkspaceGateMetadata(workspaceRoot).gates;
}
