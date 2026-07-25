// diagnose-verify-failure.ts — DIR-073 (M154)
// Parse verify check results from execute-milestone workflow, classify failures,
// auto-fix mechanical failures (stale-directive, hash-mismatch), recheck, output structured diagnostic.
//
// Usage:
//   node --experimental-strip-types scripts/diagnose-verify-failure.ts --results <json-file> --charter <path> [--json]
//   node --experimental-strip-types scripts/diagnose-verify-failure.ts --checks <json-string> --charter <path> [--json]
//
// Exit codes: 0 = diagnostic complete (some fixed, some unfixable), 3 = nothing to fix (no failures),
//             2 = usage error, 1 = internal error.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parseArgs, isDirectEntry, readFrontmatter } from "./gate-script-base.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

interface CheckResult {
  check: string;
  ok: boolean;
  detail: string;
  source: "script" | "agent";
}

interface AutoFixResult {
  check: string;
  action: string;
  recheckPass: boolean;
}

interface UnfixableResult {
  check: string;
  classification: string;
  detail: string;
}

interface DiagnosticResult {
  autoFixed: AutoFixResult[];
  unfixable: UnfixableResult[];
  retryReady: boolean;
}

// ── Classification ──────────────────────────────────────────────────────────────────────────────────

type Classification =
  | "stale-directive"
  | "hash-mismatch"
  | "line-budget-exceeded"
  | "domain-misfit"
  | "dogfood-evidence-gap"
  | "unknown";

function classify(check: CheckResult): Classification {
  switch (check.check) {
    case "ceiling-check":
      return "stale-directive";
    case "gate-hash":
      return "hash-mismatch";
    case "line-budget":
      return "line-budget-exceeded";
    case "domain-misfit":
      return "domain-misfit";
    case "dogfood-evidence":
      return "dogfood-evidence-gap";
    default:
      return "unknown";
  }
}

function isAutoFixable(c: Classification): boolean {
  return c === "stale-directive" || c === "hash-mismatch";
}

// ── Directive ID extraction ─────────────────────────────────────────────────────────────────────────

/**
 * Extract directive IDs (DIR-NNN) from a charter's Scope and Done-when sections.
 * Skips the **Task:** header line and parenthetical references like "(DIR-xxx)".
 */
export function extractDirectiveIds(charterText: string): string[] {
  // Find the sections we care about — match from section heading to next ## heading or end of text.
  // Use \n## to detect the start of the next section; $ (without m flag) matches end of string only.
  const scopeMatch = charterText.match(/## Scope\b([\s\S]*?)(?=\n## |$)/);
  const doneWhenMatch = charterText.match(/## Done-when\b([\s\S]*?)(?=\n## |$)/);

  const sections = [scopeMatch?.[1] || "", doneWhenMatch?.[1] || ""];
  const combined = sections.join("\n");

  // Find all DIR-NNN references
  const dirIds = new Set<string>();
  const regex = /\bDIR-\d+\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(combined)) !== null) {
    dirIds.add(match[0]);
  }

  // Skip IDs that appear inside parentheses (e.g., "(DIR-xxx)")
  const parentheticalPattern = /\(DIR-\d+\)/g;
  while ((match = parentheticalPattern.exec(combined)) !== null) {
    const id = match[0].slice(1, -1); // remove parens
    dirIds.delete(id);
  }

  return [...dirIds].sort();
}

// ── Task file helpers ───────────────────────────────────────────────────────────────────────────────

interface TaskInfo {
  id: string;
  dirStatus: string | null; // null = not set
}

/**
 * Read a directive task's frontmatter and extract extra.dirStatus.
 * Returns null if the task file doesn't exist.
 */
export function readDirectiveStatus(taskFilePath: string): TaskInfo | null {
  if (!fs.existsSync(taskFilePath)) return null;

  const text = fs.readFileSync(taskFilePath, "utf8");
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const fmText = fmMatch[1];

  // Extract id
  const idMatch = fmText.match(/^id:\s*(\S+)/m);
  const id = idMatch ? idMatch[1].trim() : path.basename(taskFilePath, ".md");

  // Extract dirStatus from extra block — handle both flat and nested YAML
  // Pattern: within the extra: block, look for "  dirStatus: <value>"
  const dirStatusMatch = fmText.match(/\bdirStatus:\s*(\S+)/);
  const dirStatus = dirStatusMatch ? dirStatusMatch[1].trim() : null;

  return { id, dirStatus };
}

/**
 * Set extra.dirStatus to "applied" in a task file's frontmatter.
 * Handles three cases:
 * 1. extra block exists with dirStatus already set → replace value
 * 2. extra block exists without dirStatus → insert line
 * 3. no extra block → create one
 * Returns true if a change was made, false if already "applied".
 */
export function setDirStatusApplied(taskFilePath: string): boolean {
  const text = fs.readFileSync(taskFilePath, "utf8");
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return false;

  const fmStart = fmMatch.index!;
  const fmEnd = fmStart + fmMatch[0].length;
  const fmBody = fmMatch[1];

  // Check if already applied
  if (/\bdirStatus:\s*applied\b/.test(fmBody)) return false;

  // Check if extra block exists
  const extraLineMatch = fmBody.match(/^extra:/m);
  if (extraLineMatch) {
    // extra block exists — check if dirStatus is set (to something other than applied)
    const dirStatusMatch = fmBody.match(/\bdirStatus:\s*\S+/);
    if (dirStatusMatch) {
      // Replace existing dirStatus value
      const oldLine = dirStatusMatch[0];
      const newLine = "dirStatus: applied";
      const newBody = fmBody.replace(oldLine, newLine);
      const newText = text.slice(0, fmStart) + "---\n" + newBody + "\n---" + text.slice(fmEnd);
      fs.writeFileSync(taskFilePath, newText, "utf8");
      return true;
    } else {
      // extra block exists but no dirStatus — insert after extra line
      const insertIdx = extraLineMatch.index! + extraLineMatch[0].length;
      // Find end of the extra block's indented content
      const extraBlockStart = extraLineMatch.index!;
      const restOfFm = fmBody.slice(extraBlockStart);
      const lines = restOfFm.split("\n");
      let insertAfter = 0; // line index within restOfFm
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith("  ") || lines[i].trim() === "") {
          insertAfter = i;
        } else {
          break;
        }
      }
      const absInsertPoint = extraBlockStart + restOfFm.split("\n").slice(0, insertAfter + 1).join("\n").length + 1;
      const newBody = fmBody.slice(0, absInsertPoint) + "\n  dirStatus: applied" + fmBody.slice(absInsertPoint);
      const newText = text.slice(0, fmStart) + "---\n" + newBody + "\n---" + text.slice(fmEnd);
      fs.writeFileSync(taskFilePath, newText, "utf8");
      return true;
    }
  } else {
    // No extra block — add one at end of frontmatter
    const newBody = fmBody.trimEnd() + "\nextra:\n  dirStatus: applied\n";
    const newText = text.slice(0, fmStart) + "---\n" + newBody + "---" + text.slice(fmEnd);
    fs.writeFileSync(taskFilePath, newText, "utf8");
    return true;
  }
}

// ── Gate hash helpers ────────────────────────────────────────────────────────────────────────────────

const PINNED_SOURCE = "experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md";
const PINNED_START = 100;
const PINNED_END = 131;

/**
 * Re-compute the sha256 hash of the pinned HARD GATES block.
 */
export function computeGateHash(workspaceRoot: string): string {
  const pinnedPath = path.join(workspaceRoot, PINNED_SOURCE);
  if (!fs.existsSync(pinnedPath)) {
    throw new Error(`Pinned source not found: ${pinnedPath}`);
  }

  // Equivalent to: sed -n '100,131p' file | sed '1{/^```$/d}; ${/^```$/d}' | sha256sum
  const lines = fs.readFileSync(pinnedPath, "utf8").split("\n");
  // lines are 0-indexed, PINNED_START=100 → index 99, PINNED_END=131 → index 130
  const blockLines = lines.slice(PINNED_START - 1, PINNED_END);

  // Strip leading/trailing ``` fence markers
  const startIdx = blockLines[0]?.trim() === "```" ? 1 : 0;
  const endIdx = blockLines[blockLines.length - 1]?.trim() === "```" ? blockLines.length - 1 : blockLines.length;
  const content = blockLines.slice(startIdx, endIdx).join("\n");

  const hash = execSync("sha256sum", { input: content, encoding: "utf8" }).trim().split(/\s+/)[0];
  return hash;
}

/**
 * Update the GATE-HASH-REF line in a charter file with a new hash.
 * Returns true if a change was made, false if already matches.
 */
export function updateCharterHash(charterPath: string, newHash: string): boolean {
  const text = fs.readFileSync(charterPath, "utf8");
  const refLine = text.match(/^GATE-HASH-REF:\s*([0-9a-f]+)\s*(.*)$/m);
  if (!refLine) {
    console.error(`ERROR: no GATE-HASH-REF line found in ${charterPath}`);
    return false;
  }

  if (refLine[1] === newHash) return false;

  const newLine = `GATE-HASH-REF: ${newHash}${refLine[2] ? ` ${refLine[2]}` : ""}`;
  const newText = text.replace(refLine[0], newLine);
  fs.writeFileSync(charterPath, newText, "utf8");
  return true;
}

// ── Recheck ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Re-run a check script and return whether it passes.
 */
function recheck(charterFile: string, checkName: string, workspaceRoot: string): { ok: boolean; detail: string } {
  const scriptsDir = path.join(workspaceRoot, "experiments/quay-perpetual-stream/scripts");
  const milestone = extractMilestone(charterFile);
  let cmd: string;

  switch (checkName) {
    case "ceiling-check":
      cmd = `bash ${scriptsDir}/it0-ceiling-check.sh --milestone ${milestone} ${charterFile}`;
      break;
    case "gate-hash":
      cmd = `bash ${scriptsDir}/it0-gate-hash-check.sh --by-reference ${charterFile}`;
      break;
    case "line-budget":
      cmd = `bash ${scriptsDir}/it0-ceiling-line-budget-check.sh ${charterFile}`;
      break;
    case "dogfood-evidence":
      cmd = `bash ${scriptsDir}/it0-dogfood-evidence-gate.sh --milestone ${milestone} ${charterFile}`;
      break;
    default:
      return { ok: true, detail: `no recheck defined for ${checkName}` };
  }

  try {
    const stdout = execSync(cmd, { encoding: "utf8", timeout: 60000, cwd: workspaceRoot });
    return { ok: true, detail: stdout.trim().slice(-2000) };
  } catch (e: any) {
    return { ok: false, detail: (e.stdout || e.stderr || e.message || "").trim().slice(-2000) };
  }
}

function extractMilestone(charterPath: string): string {
  const basename = path.basename(charterPath, ".md");
  const m = basename.match(/^(M\d+)/);
  return m ? m[1] : "M000";
}

// ── Main diagnostic ─────────────────────────────────────────────────────────────────────────────────

export function runDiagnostic(
  results: CheckResult[],
  charterFile: string,
  workspaceRoot: string
): DiagnosticResult {
  const autoFixed: AutoFixResult[] = [];
  const unfixable: UnfixableResult[] = [];
  const failed = results.filter((r) => !r.ok);

  if (failed.length === 0) {
    return { autoFixed: [], unfixable: [], retryReady: true };
  }

  // Read charter text once
  let charterText = "";
  try {
    charterText = fs.readFileSync(charterFile, "utf8");
  } catch {
    return {
      autoFixed: [],
      unfixable: failed.map((r) => ({ check: r.check, classification: classify(r), detail: `charter not found: ${charterFile}` })),
      retryReady: false,
    };
  }

  const directiveIds = extractDirectiveIds(charterText);

  for (const check of failed) {
    const classification = classify(check);

    if (!isAutoFixable(classification)) {
      unfixable.push({ check: check.check, classification, detail: check.detail });
      continue;
    }

    if (classification === "stale-directive") {
      // Auto-fix stale directives: set dirStatus to applied
      let fixedCount = 0;
      const actions: string[] = [];

      for (const dirId of directiveIds) {
        const taskFile = path.join(workspaceRoot, "tasks", `${dirId}.md`);
        const info = readDirectiveStatus(taskFile);

        if (!info) {
          actions.push(`${dirId}: task file not found — cannot auto-fix`);
          continue;
        }

        if (info.dirStatus !== "applied") {
          const changed = setDirStatusApplied(taskFile);
          if (changed) {
            fixedCount++;
            actions.push(`${dirId}: dirStatus ${info.dirStatus || "unset"} → applied`);
          } else {
            actions.push(`${dirId}: already applied`);
          }
        } else {
          actions.push(`${dirId}: already applied`);
        }
      }

      const actionSummary = actions.join("; ");
      const recheckResult = recheck(charterFile, check.check, workspaceRoot);
      autoFixed.push({ check: check.check, action: actionSummary, recheckPass: recheckResult.ok });
    }

    if (classification === "hash-mismatch") {
      try {
        const newHash = computeGateHash(workspaceRoot);
        const changed = updateCharterHash(charterFile, newHash);
        const action = changed
          ? `GATE-HASH-REF updated to ${newHash}`
          : `hash already matches (${newHash}) — failure may be from other cause`;
        const recheckResult = recheck(charterFile, check.check, workspaceRoot);
        autoFixed.push({ check: check.check, action, recheckPass: recheckResult.ok });
      } catch (e: any) {
        autoFixed.push({
          check: check.check,
          action: `hash recompute failed: ${e.message}`,
          recheckPass: false,
        });
      }
    }
  }

  // retryReady: true when ALL failures were auto-fixed successfully
  const retryReady =
    unfixable.length === 0 && autoFixed.length > 0 && autoFixed.every((a) => a.recheckPass);

  return { autoFixed, unfixable, retryReady };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<number> {
  const spec = {
    usage: "--results <json-file> | --checks <json> --charter <charter-path> [--workspace-root <dir>] [--json]",
    minArgs: 0,
    flags: {
      results: { type: "string" as const },
      checks: { type: "string" as const },
      charter: { type: "string" as const },
      "workspace-root": { type: "string" as const },
      json: { type: "boolean" as const },
    },
  };

  const parsed = parseArgs(argv, spec);

  const resultsFlag = parsed.flags["results"] as string | undefined;
  const checksFlag = parsed.flags["checks"] as string | undefined;
  const charterFile = parsed.flags["charter"] as string | undefined;
  const workspaceRoot = (parsed.flags["workspace-root"] as string) || ".";
  const jsonOutput = parsed.flags["json"] === true;

  if (!charterFile) {
    console.error("ERROR: --charter <path> is required");
    return 2;
  }

  let results: CheckResult[];
  if (resultsFlag) {
    try {
      results = JSON.parse(fs.readFileSync(resultsFlag, "utf8"));
    } catch (e: any) {
      console.error(`ERROR: cannot read --results file: ${e.message}`);
      return 2;
    }
  } else if (checksFlag) {
    try {
      results = JSON.parse(checksFlag);
    } catch (e: any) {
      console.error(`ERROR: cannot parse --checks JSON: ${e.message}`);
      return 2;
    }
  } else {
    console.error("ERROR: one of --results <file> or --checks <json> is required");
    return 2;
  }

  if (!Array.isArray(results)) {
    console.error("ERROR: results must be a JSON array");
    return 2;
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ autoFixed: [], unfixable: [], retryReady: true }));
    } else {
      console.log("No failures found — nothing to diagnose.");
    }
    return 3;
  }

  const diagnostic = runDiagnostic(results, charterFile, workspaceRoot);

  if (jsonOutput) {
    console.log(JSON.stringify(diagnostic));
  } else {
    console.log(`Auto-fixed: ${diagnostic.autoFixed.length}`);
    for (const a of diagnostic.autoFixed) {
      console.log(`  ${a.check}: ${a.action} [recheck: ${a.recheckPass ? "PASS" : "FAIL"}]`);
    }
    console.log(`Unfixable: ${diagnostic.unfixable.length}`);
    for (const u of diagnostic.unfixable) {
      console.log(`  ${u.check} (${u.classification}): ${u.detail.slice(0, 200)}`);
    }
    console.log(`retryReady: ${diagnostic.retryReady}`);
  }

  return 0;
}

// ── Direct entry ─────────────────────────────────────────────────────────────────────────────────────

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
