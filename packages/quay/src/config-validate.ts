// config-validate.ts — structural validation pass over workspace config files.
// Exports validateConfig({ workspaceRoot, checkFiles? }) -> { ok, issues }.
//
// Fail-closed: every check that encounters unexpected shape returns an error-
// severity issue. The module is a pure diagnostic layer — the runtime loaders
// (readGatesConfig, loadWorkspaceGates, readLoopParams) remain fail-quiet (their
// existing contract), but the validator surfaces what the runtime silently absorbs.
//
// DIR-099-A: this module is the mechanism for the `quay config validate` CLI
// command. It is also importable by the MCP server (DIR-099-C) and other tools.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { loadConfig, resolveProviderEntry, NATIVE_PROVIDER_UNRESOLVABLE } from "./config.ts";
import { listGates } from "./gate/registry.ts";
import { VALID_EXECUTION, VALID_AUDIT, VALID_STOP_RE } from "./loop-params.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigIssue {
  severity: "error" | "warn";
  field: string;
  message: string;
  suggestion?: string;
  /** A stable machine-readable code for issues that a caller/gate must be able to match on (e.g.
   *  `native-provider-unresolvable`) — message text alone is display, not a contract. */
  code?: string;
}

export interface ValidateConfigArgs {
  workspaceRoot: string;
  checkFiles?: boolean;
  /** Test/fixture seam: the plugin root to resolve the native provider's default binding from.
   *  Omitted (undefined) ⇒ the real `resolvePluginRoot()`; `null` ⇒ "no plugin root could be
   *  resolved" (the state a fixture injects to exercise `native-provider-unresolvable`). */
  pluginRoot?: string | null;
}

export interface ValidateConfigResult {
  ok: boolean;
  issues: ConfigIssue[];
}

// ---------------------------------------------------------------------------
// Gate type schemas — co-located here (NOT imported from gate/config/types.ts)
// so a type-change that breaks validation is a test failure, not silent drift.
// ---------------------------------------------------------------------------

const KNOWN_GATE_KEYS = ["it0", "fixed", "testPass", "coverageFloor", "redGreen", "adr"] as const;

interface GateTypeSchema {
  requiredFields: string[];
  shape: string;
}

const GATE_SCHEMAS: Record<string, GateTypeSchema> = {
  it0: {
    requiredFields: ["name", "script", "argsKey"],
    shape: '{ name: "<name>", script: "<path>", argsKey: "<key>" }',
  },
  fixed: {
    requiredFields: ["name", "script"],
    shape: '{ name: "<name>", script: "<path>" }',
  },
  testPass: {
    requiredFields: ["name", "command"],
    shape: '{ name: "<name>", command: "<shell command>" }',
  },
  coverageFloor: {
    requiredFields: ["name", "command", "floor"],
    shape: '{ name: "<name>", command: "<shell command>", floor: <number> }',
  },
  redGreen: {
    requiredFields: ["name", "red", "green"],
    shape: '{ name: "<name>", red: "<command>", green: "<command>" }',
  },
  adr: {
    requiredFields: [],
    shape: '- "ADR-NNN"',
  },
};

// Shell keywords that are never flagged by the PATH-binary heuristic.
const SHELL_KEYWORDS = new Set([
  "for", "while", "if", "case", "until", "do", "done", "then", "else",
  "elif", "fi", "esac", "time", "exec", "eval", "source", ".",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the set of workspace-declared gate names from RAW parsed gates section.
 * We do NOT use loadWorkspaceGates() because it silently skips malformed entries.
 */
function extractWorkspaceGateNames(gatesSection: unknown): string[] {
  if (!gatesSection || typeof gatesSection !== "object") return [];
  const names: string[] = [];
  const g = gatesSection as Record<string, unknown>;
  for (const key of KNOWN_GATE_KEYS) {
    const arr = g[key];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (key === "adr") {
          if (typeof entry === "string" && entry.trim() !== "") {
            names.push(entry.toLowerCase());
          }
        } else if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string") {
          names.push((entry as Record<string, unknown>).name as string);
        }
      }
    }
  }
  return names;
}

/**
 * Resolve a gate entry's name from its object for error messages.
 */
function gateEntryName(entry: unknown, index: number): string {
  if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string") {
    return (entry as Record<string, unknown>).name as string;
  }
  return `[${index}]`;
}

// ---------------------------------------------------------------------------
// Check functions — each returns ConfigIssue[]
// ---------------------------------------------------------------------------

/**
 * 1+2. Config file discovery + YAML syntax check.
 */
function discoverAndParse(workspaceRoot: string): {
  issues: ConfigIssue[];
  unifiedParsed: unknown | null;
  gatesParsed: unknown | null;
  loopParsed: unknown | null;
} {
  const issues: ConfigIssue[] = [];
  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");

  if (fs.existsSync(unifiedConfigPath)) {
    // Branch A: unified config.yml
    let raw: string;
    try {
      raw = fs.readFileSync(unifiedConfigPath, "utf8");
    } catch (e: unknown) {
      issues.push({
        severity: "error",
        field: "config.yml",
        message: `Cannot read .quay/config.yml: ${(e as Error).message}`,
      });
      return { issues, unifiedParsed: null, gatesParsed: null, loopParsed: null };
    }

    let unified: unknown;
    try {
      unified = YAML.parse(raw);
    } catch (e: unknown) {
      issues.push({
        severity: "error",
        field: "config.yml",
        message: `YAML syntax error in .quay/config.yml: ${(e as Error).message}`,
      });
      return { issues, unifiedParsed: null, gatesParsed: null, loopParsed: null };
    }

    const u = unified && typeof unified === "object" ? (unified as Record<string, unknown>) : null;
    const gatesParsed = u?.gates ?? null;
    const loopParsed = u?.loop ?? null;
    return { issues, unifiedParsed: unified, gatesParsed, loopParsed };
  }

  // Branch B: legacy .quay/gates.yml + .quay/loop.yml
  const legacyGatesPath = path.join(workspaceRoot, ".quay", "gates.yml");
  const legacyLoopPath = path.join(workspaceRoot, ".quay", "loop.yml");

  let gatesParsed: unknown = null;
  let loopParsed: unknown = null;
  let foundAny = false;

  if (fs.existsSync(legacyGatesPath)) {
    foundAny = true;
    try {
      const raw = fs.readFileSync(legacyGatesPath, "utf8");
      gatesParsed = YAML.parse(raw);
    } catch (e: unknown) {
      issues.push({
        severity: "error",
        field: "gates.yml",
        message: `YAML syntax error in .quay/gates.yml: ${(e as Error).message}`,
      });
    }
  }

  if (fs.existsSync(legacyLoopPath)) {
    foundAny = true;
    try {
      const raw = fs.readFileSync(legacyLoopPath, "utf8");
      loopParsed = YAML.parse(raw);
    } catch (e: unknown) {
      issues.push({
        severity: "error",
        field: "loop.yml",
        message: `YAML syntax error in .quay/loop.yml: ${(e as Error).message}`,
      });
    }
  }

  if (!foundAny) {
    issues.push({
      severity: "error",
      field: "config",
      message: "No config file found — neither .quay/config.yml nor legacy .quay/gates.yml/.quay/loop.yml exist",
    });
  }

  return { issues, unifiedParsed: null, gatesParsed, loopParsed };
}

/** A provider path frozen to a VERSIONED plugin install-cache dir (`…/cache/quay/quay/<version>/…`):
 *  the version segment pins the runtime, so a later plugin upgrade leaves the project reading the
 *  old one. Explicit paths only — an omitted path is resolved from the plugin root and cannot freeze. */
const FROZEN_CACHE_PATH_RE = /(^|[\\/])cache[\\/]quay[\\/]quay[\\/][^\\/]+([\\/]|$)/;

/**
 * 3. Provider check: every enabled provider must resolve to a launchable `mcp_entry`.
 *
 * ⛔ SINGLE JUDGE (gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver): the
 * question "does this provider have an mcp_entry?" is answered by `resolveProviderEntry` — the SAME
 * function the runtime uses (`activeProvider` → `withNativeDefaults`). This module must NOT re-derive
 * it from the raw YAML: that second copy is exactly how the validator came to demand an `mcp_entry`
 * the runtime does not need (native omits it and Core derives it from the plugin root).
 */
function checkProviders(
  unifiedParsed: unknown | null,
  workspaceRoot: string,
  pluginRoot: string | null | undefined,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!unifiedParsed || typeof unifiedParsed !== "object") return issues;

  const providers = (unifiedParsed as Record<string, unknown>).providers;
  if (!providers || typeof providers !== "object") return issues;

  for (const [pid, pdata] of Object.entries(providers as Record<string, unknown>)) {
    if (!pdata || typeof pdata !== "object") continue;
    const p = pdata as Record<string, unknown>;
    if (p.enabled !== true) continue;

    // Explicit native `path` diagnostics. Only for a path the config ACTUALLY declares — an omitted
    // path is the supported form (resolved from the plugin root) and is never warned about.
    if (pid === "native" && typeof p.path === "string" && p.path !== "") {
      const resolved = path.isAbsolute(p.path) ? p.path : path.resolve(workspaceRoot, p.path);
      if (FROZEN_CACHE_PATH_RE.test(p.path)) {
        issues.push({
          severity: "warn",
          field: `providers.${pid}.path`,
          message:
            `Native provider path "${p.path}" is frozen to a versioned plugin install-cache directory — ` +
            `the version segment pins the runtime and will not follow a plugin upgrade`,
          suggestion: `Remove providers.native.path and mcp_entry to let Core resolve them from the plugin root`,
        });
      } else if (!fs.existsSync(resolved)) {
        issues.push({
          severity: "error",
          field: `providers.${pid}.path`,
          message: `Native provider path does not exist: "${p.path}" (resolved to ${resolved})`,
          suggestion:
            `Remove providers.native.path and mcp_entry to let Core resolve them from the plugin root, ` +
            `or point path at an existing directory`,
        });
      }
    }

    const resolvedEntry = resolveProviderEntry(pid, p, pluginRoot);
    if (resolvedEntry.mcpEntry) continue;

    if (resolvedEntry.unresolvable) {
      issues.push({
        severity: "error",
        field: `providers.${pid}`,
        code: NATIVE_PROVIDER_UNRESOLVABLE,
        message:
          `${NATIVE_PROVIDER_UNRESOLVABLE}: enabled provider "native" omits path/mcp_entry ` +
          `(Core resolves them from the plugin root) but no plugin root could be resolved`,
        suggestion:
          `Re-run /quay:init from an installed plugin, set QUAY_PLUGIN_ROOT, or declare ` +
          `mcp_entry: ["node", "<provider-runtime>", "mcp"] explicitly`,
      });
    } else {
      issues.push({
        severity: "error",
        field: `providers.${pid}`,
        code: "provider-missing-mcp-entry",
        message: `Enabled provider "${pid}" is missing mcp_entry (must be a non-empty array)`,
        suggestion: 'Add mcp_entry: ["node", "./bin/<provider>.ts", "mcp"] to this provider',
      });
    }
  }

  return issues;
}

/**
 * 4. Gate nesting check: unknown keys under `gates:` are errors.
 */
function checkGateNesting(gatesParsed: unknown | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!gatesParsed || typeof gatesParsed !== "object") return issues;

  const g = gatesParsed as Record<string, unknown>;
  for (const key of Object.keys(g)) {
    if (!KNOWN_GATE_KEYS.includes(key as (typeof KNOWN_GATE_KEYS)[number])) {
      issues.push({
        severity: "error",
        field: `gates.${key}`,
        message: `"${key}" is not a recognized gate type key`,
        suggestion: `Gate entries must be nested under one of: ${KNOWN_GATE_KEYS.join(", ")}. Example: gates:\n  testPass:\n    - name: ${key}\n      command: "<cmd>"`,
      });
    }
  }

  return issues;
}

/**
 * 5. Gate shape check: validate each gate entry against its type schema.
 */
function checkGateShapes(gatesParsed: unknown | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!gatesParsed || typeof gatesParsed !== "object") return issues;

  const g = gatesParsed as Record<string, unknown>;

  for (const key of KNOWN_GATE_KEYS) {
    const arr = g[key];
    if (!Array.isArray(arr)) continue;

    if (key === "adr") {
      for (let i = 0; i < (arr as unknown[]).length; i++) {
        const entry = (arr as unknown[])[i];
        if (typeof entry !== "string" || entry.trim() === "") {
          issues.push({
            severity: "error",
            field: `gates.adr[${i}]`,
            message: `adr entry at index ${i} must be a non-empty string (got ${typeof entry})`,
            suggestion: 'Each adr entry must be a string like "ADR-NNN"',
          });
        }
      }
      continue;
    }

    const schema = GATE_SCHEMAS[key];
    if (!schema) continue;

    for (let i = 0; i < (arr as unknown[]).length; i++) {
      const entry = (arr as unknown[])[i];
      if (!entry || typeof entry !== "object") {
        issues.push({
          severity: "error",
          field: `gates.${key}[${i}]`,
          message: `Expected an object for ${key} gate entry at index ${i}, got ${typeof entry}`,
          suggestion: `Should be: ${schema.shape}`,
        });
        continue;
      }

      const e = entry as Record<string, unknown>;

      for (const field of schema.requiredFields) {
        if (field === "floor") {
          if (typeof e[field] !== "number") {
            issues.push({
              severity: "error",
              field: `gates.${key}[${i}].${field}`,
              message: `${key} entry "${gateEntryName(entry, i)}" is missing required field "${field}" (must be a number)`,
              suggestion: `Should be: ${schema.shape}`,
            });
          }
        } else {
          if (!e[field] || (typeof e[field] === "string" && (e[field] as string).trim() === "")) {
            issues.push({
              severity: "error",
              field: `gates.${key}[${i}].${field}`,
              message: `${key} entry "${gateEntryName(entry, i)}" is missing required field "${field}"`,
              suggestion: `Should be: ${schema.shape}`,
            });
          }
        }
      }
    }
  }

  return issues;
}

/**
 * 6. Gate reference resolution: check that loop.gates names resolve.
 */
function checkGateReferences(
  loopParsed: unknown | null,
  gatesParsed: unknown | null,
  workspaceRoot: string,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;

  const lp = loopParsed as Record<string, unknown>;
  if (lp.gates === undefined) return issues;

  let gateRefs: string[];
  if (Array.isArray(lp.gates)) {
    gateRefs = lp.gates.filter((g: unknown): g is string => typeof g === "string");
  } else if (typeof lp.gates === "string") {
    gateRefs = [lp.gates];
  } else {
    return issues;
  }

  const builtInNames = listGates(workspaceRoot);
  const workspaceNames = extractWorkspaceGateNames(gatesParsed);
  const knownNames = new Set([...builtInNames, ...workspaceNames]);

  for (const ref of gateRefs) {
    if (!knownNames.has(ref)) {
      issues.push({
        severity: "error",
        field: `loop.gates`,
        message: `Unresolved gate reference: "${ref}" is not a registered gate name`,
        suggestion: `Registered gates: ${[...knownNames].sort().join(", ") || "(none)"}. Check that the gate is defined under "gates:" in your config.`,
      });
    }
  }

  return issues;
}

/**
 * 7. Loop required fields: board and gates must be present.
 */
function checkLoopRequiredFields(loopParsed: unknown | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;

  const lp = loopParsed as Record<string, unknown>;

  if (!lp.board || typeof lp.board !== "string" || (lp.board as string).trim() === "") {
    issues.push({
      severity: "error",
      field: "loop.board",
      message: `Missing required field "board" (provider name, e.g. "native")`,
    });
  }

  if (lp.gates === undefined || lp.gates === null) {
    issues.push({
      severity: "error",
      field: "loop.gates",
      message: `Missing required field "gates" (gate name or list, e.g. ["acceptance"])`,
    });
  } else if (!Array.isArray(lp.gates) && typeof lp.gates !== "string") {
    issues.push({
      severity: "error",
      field: "loop.gates",
      message: `Field "gates" must be a string or non-empty array (got ${typeof lp.gates})`,
    });
  } else if (typeof lp.gates === "string" && (lp.gates as string).trim() === "") {
    issues.push({
      severity: "error",
      field: "loop.gates",
      message: `Field "gates" is an empty string — must be a non-empty gate name`,
    });
  }

  return issues;
}

/**
 * 8. Loop field validation: execution, audit, concurrency, stop.
 */
function checkLoopFieldValues(loopParsed: unknown | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;

  const lp = loopParsed as Record<string, unknown>;

  if (lp.execution !== undefined) {
    const v = lp.execution;
    if (typeof v !== "string" || !VALID_EXECUTION.has(v)) {
      issues.push({
        severity: "error",
        field: "loop.execution",
        message: `Invalid execution value "${v}" — must be "dispatched" or "inline"`,
      });
    }
  }

  if (lp.audit !== undefined) {
    const v = lp.audit;
    if (typeof v !== "string" || !VALID_AUDIT.has(v)) {
      issues.push({
        severity: "error",
        field: "loop.audit",
        message: `Invalid audit value "${v}" — must be "adversarial" or "none"`,
      });
    }
  }

  if (lp.concurrency !== undefined) {
    const v = lp.concurrency;
    if (!Number.isInteger(v) || (v as number) < 1) {
      issues.push({
        severity: "error",
        field: "loop.concurrency",
        message: `Invalid concurrency value "${v}" — must be an integer >= 1`,
      });
    }
  }

  if (lp.stop !== undefined) {
    const v = lp.stop;
    if (typeof v !== "string" || !VALID_STOP_RE.test(v.trim())) {
      issues.push({
        severity: "error",
        field: "loop.stop",
        message: `Invalid stop value "${v}" — must be "once", "until(.halt)", "until(empty)", or "until(<condition>)"`,
      });
    }
  }

  return issues;
}

/**
 * 9. Routine shape validation.
 */
function checkRoutines(loopParsed: unknown | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;

  const lp = loopParsed as Record<string, unknown>;
  const routines = lp.routines;
  if (routines === undefined) return issues;

  if (!Array.isArray(routines)) {
    issues.push({
      severity: "error",
      field: "loop.routines",
      message: `Field "routines" must be an array (got ${typeof routines})`,
    });
    return issues;
  }

  for (let i = 0; i < (routines as unknown[]).length; i++) {
    const r = (routines as unknown[])[i];
    if (!r || typeof r !== "object") {
      issues.push({
        severity: "error",
        field: `loop.routines[${i}]`,
        message: `Routine at index ${i} must be an object (got ${typeof r})`,
      });
      continue;
    }

    const entry = r as Record<string, unknown>;

    if (typeof entry.name !== "string" || entry.name.trim() === "") {
      issues.push({
        severity: "error",
        field: `loop.routines[${i}].name`,
        message: `Routine at index ${i} needs a non-empty string "name"`,
      });
    }

    if (typeof entry.trigger !== "string") {
      issues.push({
        severity: "error",
        field: `loop.routines[${i}].trigger`,
        message: `Routine "${entry.name ?? `[${i}]`}" is missing required field "trigger"`,
        suggestion: 'Must be "every(N)" (N>=1), "interval:<N>m" (N>=1), or "on(<event>)"',
      });
    } else {
      const triggerStr = entry.trigger.trim();
      // Mirrors loop-params readLoopParams (packages/quay/src/loop-params.ts): the
      // runtime accepts every(N) / interval:<N>m / on(<event>). This regex must not
      // drift from the runtime — interval:<N>m is the two-layer time form (DIR-056).
      if (!/^(every\(\s*\d+\s*\)|interval:\s*\d+\s*m|on\(\s*[\w-]+\s*\))$/.test(triggerStr)) {
        issues.push({
          severity: "error",
          field: `loop.routines[${i}].trigger`,
          message: `Routine "${entry.name ?? `[${i}]`}" trigger "${triggerStr}" is invalid`,
          suggestion: 'Must be "every(N)" (N>=1), "interval:<N>m" (N>=1), or "on(<event>)"',
        });
      } else {
        const m = triggerStr.match(/^every\(\s*(\d+)\s*\)$/);
        if (m && Number(m[1]) < 1) {
          issues.push({
            severity: "error",
            field: `loop.routines[${i}].trigger`,
            message: `Routine "${entry.name ?? `[${i}]`}" trigger "every(${m[1]})" invalid — N must be >= 1`,
          });
        }
        const intervalMatch = triggerStr.match(/^interval:\s*(\d+)\s*m$/);
        if (intervalMatch && Number(intervalMatch[1]) < 1) {
          issues.push({
            severity: "error",
            field: `loop.routines[${i}].trigger`,
            message: `Routine "${entry.name ?? `[${i}]`}" trigger "interval:${intervalMatch[1]}m" invalid — N must be >= 1`,
          });
        }
      }
    }

    const hasDispatch = typeof entry.dispatch === "string" && (entry.dispatch as string).trim() !== "";
    const hasProbe = typeof entry.probe === "string" && (entry.probe as string).trim() !== "";
    if (!hasDispatch && !hasProbe) {
      issues.push({
        severity: "error",
        field: `loop.routines[${i}]`,
        message: `Routine "${entry.name ?? `[${i}]`}" needs at least one of "dispatch" or "probe"`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 10. Provider env validation
// ---------------------------------------------------------------------------

/**
 * Validate that the enabled provider has the expected env vars set.
 * Reads the provider's `env:` map ONLY (grounded fact #4: resolveProviderEnv
 * reads `provider.env`, never `provider.tasks_dir`).
 *
 * - native: QUAY_NATIVE_TASKS_DIR missing → warn (resolveTasksDir defaults
 *   to repo-root ./tasks)
 * - github: QUAY_GITHUB_REPO missing or empty-string → warn (resolveRepo
 *   defaults to yaleh/quay)
 * - github: QUAY_GITHUB_REPO present-but-malformed (split by "/" doesn't
 *   produce at least 2 non-empty parts) → error (matches the runtime throw)
 */
function validateProviderEnv(unifiedParsed: unknown | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!unifiedParsed || typeof unifiedParsed !== "object") return issues;

  const providers = (unifiedParsed as Record<string, unknown>).providers;
  if (!providers || typeof providers !== "object") return issues;

  for (const [pid, pdata] of Object.entries(providers as Record<string, unknown>)) {
    if (!pdata || typeof pdata !== "object") continue;
    const p = pdata as Record<string, unknown>;
    if (p.enabled !== true) continue;

    const env = p.env;
    const envMap = (env && typeof env === "object") ? (env as Record<string, string>) : {};

    if (pid === "native") {
      // QUAY_NATIVE_TASKS_DIR is OPTIONAL — resolveTasksDir() defaults to
      // repo-root ./tasks; Core never fails closed on its absence.
      if (!envMap.QUAY_NATIVE_TASKS_DIR) {
        issues.push({
          severity: "warn",
          field: `providers.${pid}.env.QUAY_NATIVE_TASKS_DIR`,
          message: `Native provider "${pid}" has no QUAY_NATIVE_TASKS_DIR env var — defaulting to ./tasks`,
        });
      }
    } else if (pid === "github") {
      const repo = envMap.QUAY_GITHUB_REPO;
      // Falsy OR empty string → runtime defaults to yaleh/quay (no throw).
      // Must check BEFORE the malformed check to avoid re-introducing the
      // false-positive class (AC8: present-but-empty → warn, not error).
      if (!repo) {
        issues.push({
          severity: "warn",
          field: `providers.${pid}.env.QUAY_GITHUB_REPO`,
          message: `GitHub provider "${pid}" has no QUAY_GITHUB_REPO env var — defaulting to yaleh/quay`,
        });
      } else {
        // Present and non-empty — check for malformed (mirrors the runtime
        // throw predicate at quay-github.ts L18-27, NOT a strict ^owner/repo$
        // regex). The runtime does (repo || "yaleh/quay").split("/") and
        // throws if either of the first two segments is falsy.
        const parts = repo.split("/");
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          issues.push({
            severity: "error",
            field: `providers.${pid}.env.QUAY_GITHUB_REPO`,
            message: `QUAY_GITHUB_REPO must be "owner/repo" (got: "${repo}")`,
          });
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// File-existence check helpers (only when checkFiles is true)
// ---------------------------------------------------------------------------

function isPathBinary(token: string): boolean {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, token);
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return true;
      }
    } catch {
      // Permission error — skip
    }
  }
  return false;
}

function classifyCommandToken(token: string, fieldPath: string, workspaceRoot: string): ConfigIssue | null {
  if (SHELL_KEYWORDS.has(token)) return null;

  if (isPathBinary(token)) return null;

  if (token.startsWith("./") || token.startsWith("../") || token.startsWith("/")) {
    const resolved = path.isAbsolute(token) ? token : path.resolve(workspaceRoot, token);
    if (!fs.existsSync(resolved)) {
      return {
        severity: "error",
        field: fieldPath,
        message: `Script file not found: "${token}" (resolved to ${resolved})`,
      };
    }
    return null;
  }

  return {
    severity: "warn",
    field: fieldPath,
    message: `Command token "${token}" is not resolvable on PATH and is not an explicit file path — may become available at build time`,
  };
}

function checkFileExistence(
  gatesParsed: unknown | null,
  workspaceRoot: string,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!gatesParsed || typeof gatesParsed !== "object") return issues;

  const g = gatesParsed as Record<string, unknown>;

  // it0 entries: script path
  const it0Arr = g.it0;
  if (Array.isArray(it0Arr)) {
    for (let i = 0; i < (it0Arr as unknown[]).length; i++) {
      const entry = (it0Arr as unknown[])[i];
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.script === "string" && e.script.trim() !== "") {
          const script = e.script.trim();
          const resolved = path.isAbsolute(script) ? script : path.resolve(workspaceRoot, script);
          if (!fs.existsSync(resolved)) {
            issues.push({
              severity: "error",
              field: `gates.it0[${i}].script`,
              message: `Script file not found: "${script}" (resolved to ${resolved})`,
            });
          }
        }
      }
    }
  }

  // fixed entries: script path
  const fixedArr = g.fixed;
  if (Array.isArray(fixedArr)) {
    for (let i = 0; i < (fixedArr as unknown[]).length; i++) {
      const entry = (fixedArr as unknown[])[i];
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.script === "string" && e.script.trim() !== "") {
          const script = e.script.trim();
          const resolved = path.isAbsolute(script) ? script : path.resolve(workspaceRoot, script);
          if (!fs.existsSync(resolved)) {
            issues.push({
              severity: "error",
              field: `gates.fixed[${i}].script`,
              message: `Script file not found: "${script}" (resolved to ${resolved})`,
            });
          }
        }
      }
    }
  }

  // testPass entries: command first token
  const tpArr = g.testPass;
  if (Array.isArray(tpArr)) {
    for (let i = 0; i < (tpArr as unknown[]).length; i++) {
      const entry = (tpArr as unknown[])[i];
      if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).command === "string") {
        const cmd = ((entry as Record<string, unknown>).command as string).trim();
        if (cmd) {
          const firstToken = cmd.split(/\s+/)[0];
          const issue = classifyCommandToken(firstToken, `gates.testPass[${i}].command`, workspaceRoot);
          if (issue) issues.push(issue);
        }
      }
    }
  }

  // coverageFloor entries: command first token
  const cfArr = g.coverageFloor;
  if (Array.isArray(cfArr)) {
    for (let i = 0; i < (cfArr as unknown[]).length; i++) {
      const entry = (cfArr as unknown[])[i];
      if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).command === "string") {
        const cmd = ((entry as Record<string, unknown>).command as string).trim();
        if (cmd) {
          const firstToken = cmd.split(/\s+/)[0];
          const issue = classifyCommandToken(firstToken, `gates.coverageFloor[${i}].command`, workspaceRoot);
          if (issue) issues.push(issue);
        }
      }
    }
  }

  // redGreen entries: red and green command first tokens
  const rgArr = g.redGreen;
  if (Array.isArray(rgArr)) {
    for (let i = 0; i < (rgArr as unknown[]).length; i++) {
      const entry = (rgArr as unknown[])[i];
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        for (const field of ["red", "green"]) {
          if (typeof e[field] === "string") {
            const cmd = (e[field] as string).trim();
            if (cmd) {
              const firstToken = cmd.split(/\s+/)[0];
              const issue = classifyCommandToken(firstToken, `gates.redGreen[${i}].${field}`, workspaceRoot);
              if (issue) issues.push(issue);
            }
          }
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// The ONE check pipeline + its two entry points (file-backed, text-backed)
// ---------------------------------------------------------------------------

interface CheckInputs {
  unifiedParsed: unknown | null;
  gatesParsed: unknown | null;
  loopParsed: unknown | null;
  workspaceRoot: string;
  pluginRoot: string | null | undefined;
  checkFiles: boolean;
}

/**
 * Checks 3–11 over an ALREADY-PARSED config. THE single check pipeline: both `validateConfig`
 * (file-backed) and `validateConfigText` (text-backed) below call this and nothing else, so the
 * checks cannot fork into two implementations (gap-init-single-engine-state-based-upgrade-
 * validate-before-write AC3). The individual `check*` functions above stay the one implementation
 * of each check; this function is only their fixed ORDER, which was previously inlined in
 * `validateConfig` and would otherwise have had to be copied into the text entry point.
 */
function runChecks({ unifiedParsed, gatesParsed, loopParsed, workspaceRoot, pluginRoot, checkFiles }: CheckInputs): ConfigIssue[] {
  const allIssues: ConfigIssue[] = [];

  // 3. Provider check
  if (unifiedParsed) allIssues.push(...checkProviders(unifiedParsed, workspaceRoot, pluginRoot));
  // 4. Gate nesting check
  if (gatesParsed) allIssues.push(...checkGateNesting(gatesParsed));
  // 5. Gate shape check
  if (gatesParsed) allIssues.push(...checkGateShapes(gatesParsed));
  // 6. Gate reference resolution
  if (loopParsed) allIssues.push(...checkGateReferences(loopParsed, gatesParsed, workspaceRoot));
  // 7. Loop required fields
  if (loopParsed) allIssues.push(...checkLoopRequiredFields(loopParsed));
  // 8. Loop field values
  if (loopParsed) allIssues.push(...checkLoopFieldValues(loopParsed));
  // 9. Routine shape
  if (loopParsed) allIssues.push(...checkRoutines(loopParsed));
  // 10. Provider env check
  if (unifiedParsed) allIssues.push(...validateProviderEnv(unifiedParsed));
  // 11. File-existence check
  if (checkFiles && gatesParsed) allIssues.push(...checkFileExistence(gatesParsed, workspaceRoot));

  return allIssues;
}

/** The warn-exit contract: `ok` iff no issue is severity "error". */
function verdict(issues: ConfigIssue[]): ValidateConfigResult {
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

export interface ValidateConfigTextArgs {
  /** The candidate config bytes to judge — a STRING, not a path. */
  text: string;
  workspaceRoot: string;
  checkFiles?: boolean;
  pluginRoot?: string | null;
}

/**
 * Validate a candidate `.quay/config.yml` TEXT — the SAME checks `validateConfig` runs on the
 * file, applied to bytes that are not (yet) on disk.
 *
 * WHY THIS EXISTS (gap-init-single-engine-state-based-upgrade-validate-before-write): `init` must
 * be able to compute a new config in memory and REFUSE TO WRITE IT if it does not validate — a
 * check that can only read the file cannot judge a candidate that has not been written. The write
 * ordering is the whole point: validate-then-write, never write-then-validate. Sharing `runChecks`
 * (not a second copy of the checks) is what makes "init's verdict ⇔ `config validate`'s verdict on
 * the same bytes" true by construction rather than by a test that could drift.
 */
export function validateConfigText({ text, workspaceRoot, checkFiles = false, pluginRoot }: ValidateConfigTextArgs): ValidateConfigResult {
  let unified: unknown;
  try {
    unified = YAML.parse(text);
  } catch (e: unknown) {
    return {
      ok: false,
      issues: [{ severity: "error", field: "config.yml", message: `YAML syntax error in .quay/config.yml: ${(e as Error).message}` }],
    };
  }
  const u = unified && typeof unified === "object" ? (unified as Record<string, unknown>) : null;
  const issues = runChecks({
    unifiedParsed: unified,
    gatesParsed: u?.gates ?? null,
    loopParsed: u?.loop ?? null,
    workspaceRoot,
    pluginRoot,
    checkFiles,
  });
  return verdict(issues);
}

export function validateConfig({ workspaceRoot, checkFiles = false, pluginRoot }: ValidateConfigArgs): ValidateConfigResult {
  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");

  // Branch A: a unified config.yml exists ⇒ judge its bytes through the text entry point, so the
  // file-backed and text-backed verdicts are the SAME code path.
  if (fs.existsSync(unifiedConfigPath)) {
    let raw: string;
    try {
      raw = fs.readFileSync(unifiedConfigPath, "utf8");
    } catch (e: unknown) {
      return { ok: false, issues: [{ severity: "error", field: "config.yml", message: `Cannot read .quay/config.yml: ${(e as Error).message}` }] };
    }
    return validateConfigText({ text: raw, workspaceRoot, checkFiles, pluginRoot });
  }

  // Branch B: legacy .quay/gates.yml + .quay/loop.yml
  const { issues: parseIssues, unifiedParsed, gatesParsed, loopParsed } = discoverAndParse(workspaceRoot);

  // If no config at all was found, stop (nothing for the checks to judge).
  if (parseIssues.some((i) => i.field === "config" && i.message.startsWith("No config file found"))) {
    return { ok: false, issues: parseIssues };
  }

  const allIssues = [
    ...parseIssues,
    ...runChecks({ unifiedParsed, gatesParsed, loopParsed, workspaceRoot, pluginRoot, checkFiles }),
  ];

  return verdict(allIssues);
}
