// config-validate.ts — workspace config structural validation (DIR-099-A/C).
//
// Single shared module for both the CLI `quay config validate` (DIR-099-A)
// and the MCP `config_validate` tool (DIR-099-C). The MCP handler is a thin
// passthrough — zero duplicated validation logic.
//
// Exports:
//   validateConfig({ workspaceRoot, checkFiles? }) -> { ok, issues[] }
//   ConfigIssue = { severity: "error"|"warn", field, message, suggestion? }
//
// ok is true iff no issue has severity "error" (warn-only is still ok:true).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { listGates } from "./gate/registry.ts";

// Re-exported from loop-params.ts so the validator imports constants rather
// than duplicating them (DIR-099-A mechanism claim M5).
const VALID_EXECUTION = new Set(["dispatched", "inline"]);
const VALID_AUDIT = new Set(["adversarial", "none"]);
const VALID_STOP_RE = /^(once|until\(.+\))$/;

// Gate-type schemas co-located in this module (DIR-099-A mechanism claim M2).
// Each entry: { required: string[], typeLabel: string }
const GATE_TYPE_SCHEMAS: Record<string, { required: string[]; typeLabel: string }> = {
  it0: { required: ["name", "script", "argsKey"], typeLabel: "it0" },
  fixed: { required: ["name", "script"], typeLabel: "fixed" },
  testPass: { required: ["name", "command"], typeLabel: "testPass" },
  coverageFloor: { required: ["name", "command", "floor"], typeLabel: "coverageFloor" },
  redGreen: { required: ["name", "red", "green"], typeLabel: "redGreen" },
  adr: { required: [], typeLabel: "adr (string array)" },
};

// Shell keywords — never flagged by --check-files PATH-binary heuristic.
const SHELL_KEYWORDS = new Set([
  "for", "while", "if", "case", "until", "do", "done", "then", "else",
  "elif", "fi", "esac", "time", "exec", "eval", "source", ".",
]);

export interface ConfigIssue {
  severity: "error" | "warn";
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidateConfigInput {
  workspaceRoot: string;
  checkFiles?: boolean;
}

export interface ValidateConfigResult {
  ok: boolean;
  issues: ConfigIssue[];
}

// ── helpers ──

function issue(severity: "error" | "warn", field: string, message: string, suggestion?: string): ConfigIssue {
  const i: ConfigIssue = { severity, field, message };
  if (suggestion) i.suggestion = suggestion;
  return i;
}

function existsSafe(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

function isOnPath(binary: string): boolean {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const d of dirs) {
    const candidate = path.join(d, binary);
    try {
      if (fs.existsSync(candidate)) {
        try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { /* not exec */ }
      }
    } catch { /* skip */ }
  }
  return false;
}

function isShellKeyword(token: string): boolean {
  return SHELL_KEYWORDS.has(token);
}

function firstToken(command: string): string {
  return (command || "").trim().split(/\s+/)[0] || "";
}

/**
 * Classify a command's first token for --check-files.
 * Returns null if the token is a shell keyword or PATH-resolvable binary.
 * Returns { severity: "error", field, message } if explicit file path missing.
 * Returns { severity: "warn", field, message } if bare unqualified token not on PATH.
 */
function checkCommandToken(token: string, workspaceRoot: string, field: string): ConfigIssue | null {
  if (!token) return null;
  if (isShellKeyword(token)) return null;
  if (token.startsWith("./") || token.startsWith("../") || token.startsWith("/")) {
    const resolved = token.startsWith("/") ? token : path.resolve(workspaceRoot, token);
    if (!existsSafe(resolved)) {
      return issue("error", field, `file not found: ${resolved}`, "verify the script path exists or is generated before running the command");
    }
    return null;
  }
  if (isOnPath(token)) return null;
  // Bare unqualified token not on PATH — warn (could be in node_modules/.bin)
  return issue("warn", field, `command "${token}" not found on PATH`, "it may become available at build time (e.g. via npm install)");
}

// ── validation pipeline ──

export function validateConfig(input: ValidateConfigInput): ValidateConfigResult {
  const { workspaceRoot, checkFiles = false } = input;
  const issues: ConfigIssue[] = [];

  // 1. Config file discovery + YAML parsing
  const unifiedPath = path.join(workspaceRoot, ".quay", "config.yml");
  let rawConfig: string;
  let parsed: Record<string, unknown>;
  try {
    rawConfig = fs.readFileSync(unifiedPath, "utf8");
  } catch {
    return { ok: false, issues: [issue("error", ".quay/config.yml", `config file not readable at ${unifiedPath}`)] };
  }
  try {
    parsed = YAML.parse(rawConfig) as Record<string, unknown> || {};
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, issues: [issue("error", ".quay/config.yml", `YAML parse error: ${msg}`)] };
  }

  // 2. Provider check: every enabled provider must have mcp_entry
  const providers = (parsed.providers || {}) as Record<string, Record<string, unknown>>;
  for (const [pid, pcfg] of Object.entries(providers)) {
    if (!pcfg || typeof pcfg !== "object") continue;
    if (pcfg.enabled === true) {
      if (!Array.isArray(pcfg.mcp_entry) || (pcfg.mcp_entry as unknown[]).length === 0) {
        issues.push(issue("error", `providers.${pid}.mcp_entry`,
          `enabled provider "${pid}" is missing a valid mcp_entry`,
          "add a mcp_entry: [command, ...args] to the provider config"));
      }
    }
  }

  // 3. Gate nesting check + shape check
  const gates = (parsed.gates || {}) as Record<string, unknown>;
  if (gates && typeof gates === "object" && !Array.isArray(gates)) {
    for (const [key, value] of Object.entries(gates)) {
      if (!(key in GATE_TYPE_SCHEMAS)) {
        issues.push(issue("error", `gates.${key}`,
          `unrecognized gate type key "${key}"`,
          `valid gate type keys: ${Object.keys(GATE_TYPE_SCHEMAS).join(", ")}. ` +
          `Gate entries must be nested under a gate-type key, e.g. gates:\n  it0:\n    - name: mygate\n      script: ./mygate.sh\n      argsKey: mygate`));
      } else {
        const schema = GATE_TYPE_SCHEMAS[key]!;
        const entries = Array.isArray(value) ? value : [];
        if (key === "adr") {
          // adr is a string array, check each element is non-empty
          if (!Array.isArray(value)) {
            issues.push(issue("error", `gates.${key}`, `"${key}" entries must be an array of strings`));
          } else {
            for (let i = 0; i < entries.length; i++) {
              if (typeof entries[i] !== "string" || (entries[i] as string).trim() === "") {
                issues.push(issue("error", `gates.${key}[${i}]`, `adr entry at index ${i} must be a non-empty string`));
              }
            }
          }
        } else {
          // Array of objects with required fields
          if (!Array.isArray(value)) {
            issues.push(issue("error", `gates.${key}`, `"${key}" gate type expects an array of entries, got ${typeof value}`));
          } else {
            for (let i = 0; i < (entries as unknown[]).length; i++) {
              const entry = (entries as unknown[])[i] as Record<string, unknown> | null | undefined;
              if (!entry || typeof entry !== "object") {
                issues.push(issue("error", `gates.${key}[${i}]`, `gate entry at index ${i} is not an object`));
                continue;
              }
              for (const req of schema.required) {
                if (entry[req] === undefined || entry[req] === null) {
                  issues.push(issue("error", `gates.${key}[${i}].${req}`,
                    `missing required field "${req}" in ${schema.typeLabel} gate entry`,
                    `add "${req}": <value> to this gate entry`));
                }
              }
              // --check-files for it0/fixed scripts
              if (checkFiles) {
                if ((key === "it0" || key === "fixed") && typeof entry.script === "string") {
                  const scriptPath = path.resolve(workspaceRoot, entry.script as string);
                  if (!existsSafe(scriptPath)) {
                    issues.push(issue("error", `gates.${key}[${i}].script`,
                      `file not found: ${scriptPath}`,
                      "verify the script path exists or is generated before running the gate"));
                  }
                }
                if (["testPass", "coverageFloor"].includes(key) && typeof entry.command === "string") {
                  const tok = firstToken(entry.command as string);
                  const r = checkCommandToken(tok, workspaceRoot, `gates.${key}[${i}].command`);
                  if (r) issues.push(r);
                }
                if (key === "redGreen") {
                  for (const f of ["red", "green"]) {
                    if (typeof entry[f] === "string") {
                      const tok = firstToken(entry[f] as string);
                      const r = checkCommandToken(tok, workspaceRoot, `gates.${key}[${i}].${f}`);
                      if (r) issues.push(r);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 4. Gate reference resolution + loop field checks
  if (parsed.loop !== undefined && parsed.loop !== null && typeof parsed.loop === "object") {
    const loop = parsed.loop as Record<string, unknown>;
    // Build set of known gate names: listGates() for built-ins + parse workspace gates from raw YAML
    const knownGateNames = new Set(listGates(workspaceRoot));
    // Also add workspace-declared gate names from raw parsed gates section
    if (gates && typeof gates === "object" && !Array.isArray(gates)) {
      for (const [key, value] of Object.entries(gates)) {
        if (key in GATE_TYPE_SCHEMAS && key !== "adr" && Array.isArray(value)) {
          for (const entry of value as unknown[]) {
            if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string") {
              knownGateNames.add((entry as Record<string, unknown>).name as string);
            }
          }
        }
      }
    }

    if (loop.gates !== undefined) {
      const loopGates = Array.isArray(loop.gates) ? (loop.gates as string[]) :
        (typeof loop.gates === "string" ? [loop.gates as string] : []);
      for (const g of loopGates) {
        if (typeof g !== "string" || !knownGateNames.has(g)) {
          issues.push(issue("error", "loop.gates",
            `unresolved gate reference: "${g}"`,
            `known gates: [${[...knownGateNames].sort().join(", ")}]. Register the gate in .quay/config.yml's gates: section.`));
        }
      }
    }

    // 5. Loop required fields
    if (loop.board === undefined || (typeof loop.board === "string" && loop.board.trim() === "")) {
      issues.push(issue("error", "loop.board", "missing required field \"board\" in loop section",
        "set board to the provider name (e.g. board: native)"));
    }

    // 6. Loop field validation
    if (loop.execution !== undefined && !VALID_EXECUTION.has(loop.execution as string)) {
      issues.push(issue("error", "loop.execution",
        `invalid execution value: "${loop.execution}"`,
        `must be one of: ${[...VALID_EXECUTION].join(", ")}`));
    }
    if (loop.audit !== undefined && !VALID_AUDIT.has(loop.audit as string)) {
      issues.push(issue("error", "loop.audit",
        `invalid audit value: "${loop.audit}"`,
        `must be one of: ${[...VALID_AUDIT].join(", ")}`));
    }
    if (loop.concurrency !== undefined) {
      const c = Number(loop.concurrency);
      if (!Number.isInteger(c) || c < 1) {
        issues.push(issue("error", "loop.concurrency",
          `concurrency must be an integer >= 1, got "${loop.concurrency}"`));
      }
    }
    if (loop.stop !== undefined && typeof loop.stop === "string" && !VALID_STOP_RE.test(loop.stop as string)) {
      issues.push(issue("error", "loop.stop",
        `invalid stop value: "${loop.stop}"`,
        `must match once, until(.halt), or until(...)`));
    }

    // 7. Routine shape check
    if (loop.routines !== undefined && Array.isArray(loop.routines)) {
      const TRIGGER_RE = /^(every\(\s*\d+\s*\)|on\(\s*[\w-]+\s*\))$/;
      const routines = loop.routines as unknown[];
      for (let i = 0; i < routines.length; i++) {
        const r = routines[i] as Record<string, unknown> | null | undefined;
        if (!r || typeof r !== "object") {
          issues.push(issue("error", `loop.routines[${i}]`, "routine entry is not an object"));
          continue;
        }
        if (!r.name || typeof r.name !== "string" || r.name.trim() === "") {
          issues.push(issue("error", `loop.routines[${i}].name`, "routine must have a non-empty name"));
        }
        if (r.trigger === undefined || typeof r.trigger !== "string" || r.trigger.trim() === "") {
          issues.push(issue("error", `loop.routines[${i}].trigger`,
            "routine must have a trigger",
            "use every(N) for interval or on(name) for named trigger"));
        } else if (!TRIGGER_RE.test(r.trigger as string)) {
          issues.push(issue("error", `loop.routines[${i}].trigger`,
            `invalid trigger pattern: "${r.trigger}"`,
            "must match every(N) or on(name)"));
        } else {
          // Check N >= 1 for every(N)
          const m = (r.trigger as string).match(/^every\(\s*(\d+)\s*\)$/);
          if (m && parseInt(m[1]!, 10) < 1) {
            issues.push(issue("error", `loop.routines[${i}].trigger`,
              `every(N) requires N >= 1, got ${m[1]}`));
          }
        }
        const hasDispatch = r.dispatch && typeof r.dispatch === "string" && r.dispatch.trim() !== "";
        const hasProbe = r.probe && typeof r.probe === "string" && r.probe.trim() !== "";
        if (!hasDispatch && !hasProbe) {
          issues.push(issue("error", `loop.routines[${i}]`,
            "routine must have at least one of dispatch or probe",
            "add dispatch: '<command>' or probe: '<command>'"));
        }
      }
    }
  }

  // 8. --check-files: also check gates in top-level section
  // (already done inline during gate shape check for it0/fixed/testPass/coverageFloor/redGreen)

  const hasErrors = issues.some((i) => i.severity === "error");
  return { ok: !hasErrors, issues };
}
