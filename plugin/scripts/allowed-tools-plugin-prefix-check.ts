// allowed-tools-plugin-prefix-check.ts — plugin/skills allowed-tools 命名空间机械检查
// (tasks/gap-skill-allowed-tools-plugin-namespace, SPEC-plugin-lifecycle-single-bundle §3c/§7-2/AC2)。
//
// PROBLEM IT FIXES: allowed-tools is EXACT-string matching with NO prefix alias (SPEC §3c — official
// doc: plugin-internal skill referencing a bare name "never fires"). The quay MCP server is shipped as a
// plugin, so a correctly-onboarded downstream project sees ONLY mcp__plugin_quay_quay__* — the bare
// mcp__quay__* list in plugin/skills/{loop-driver,routines}/SKILL.md therefore fires for NO supported
// channel and is only accidentally rescued on this dev machine by a stray root .mcp.json. Because it is
// rescued here, it never surfaced as a fault — "存在 ≠ 生效". This checker makes the invariant mechanical
// so the next skill author writing a bare name reddens the commit instead of silently shipping a dead list
// (硬规则 9: 可见性 ≠ 执行 — a rule whose "kept" and "broken" states are indistinguishable in records needs
// a product, not more conspicuous prose).
//
// AC2 (SPEC §8 不变式): every mcp__ tool name in plugin/skills/*/SKILL.md must be of the form
// mcp__plugin_quay_quay__*. POSITIONAL (硬规则 2): only the allowed-tools FRONTMATTER FIELD VALUE is
// judged — a bare mcp__quay__* mention in prose/body does NOT count (e.g. quay-task-to-plan/SKILL.md:26
// prose "Use mcp__quay__task_get" is not a violation).
//
// AC3 (falsifiable, three readings): before the fix the checker goes RED naming the two files; after the
// fix it goes GREEN; writing a bare name back goes RED again. The negative control is pinned by
// plugin/test/allowed-tools-plugin-prefix-check.test.mjs + the mutation case.
//
// NOT-EVALUATED (hard rule 3b/4): no plugin/skills dir, or no SKILL.md files under it ⇒ exit 3 (the
// harness-canonical NOT-EVALUATED, gap-not-evaluated-harness-third-state) — a check that found nothing to
// verify must not read as PASS.
//
// Run:
//   node --experimental-strip-types plugin/scripts/allowed-tools-plugin-prefix-check.ts [--root <dir>] [--json]
// stdout: a human line + (with --json) a machine-readable result object
// exit: 0 = every allowed-tools mcp__ tool name is plugin-prefixed · 1 = ≥1 bare/mis-namespaced name ·
//       3 = NOT-EVALUATED (no skills dir / no SKILL.md files)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// parseArg now lives in gate-script-base.ts as `flagValue` (it was one of the ~57 copies of the
// indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { helpExit, emitPass, emitFail, emitNotEvaluated, readFrontmatter, flagValue } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The default checked surface = the quay repo root (this script lives at <repo>/plugin/scripts/).
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

// The shipped-skill surface whose allowed-tools field is judged.
export const SKILLS_DIR_REL = "plugin/skills";
// The ONLY correct mcp__ prefix for the quay MCP server (SPEC §3c/§4/§7-2).
export const REQUIRED_PREFIX = "mcp__plugin_quay_quay__";

export interface SkillViolation {
  // Repo-relative path of the SKILL.md (e.g. plugin/skills/loop-driver/SKILL.md).
  path: string;
  // The offending tool names (bare mcp__quay__* or any other non-plugin-quay mcp__ namespace).
  tools: string[];
}

export interface SkillAllowedToolsResult {
  // true iff evaluated && no violation.
  ok: boolean;
  // false when the check could not be evaluated (hard rule 3b — never conflated with green).
  evaluated: boolean;
  // Why not-evaluated, when evaluated is false.
  notEvaluatedReason?: string;
  // Repo-relative paths of every SKILL.md scanned (sorted).
  skills: string[];
  // Repo-relative paths of SKILL.md files that declare an allowed-tools field.
  withAllowedTools: string[];
  // The skill files whose allowed-tools carries a non-plugin-quay mcp__ name.
  violations: SkillViolation[];
}

// List every <skillsDir>/<name>/SKILL.md (absolute paths, sorted) — the positional judgment surface.
export function listSkillFiles(skillsDir: string): string[] {
  if (!fs.existsSync(skillsDir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillMd = path.join(skillsDir, e.name, "SKILL.md");
    if (fs.existsSync(skillMd)) out.push(skillMd);
  }
  return out.sort();
}

// Extract the mcp__ tool names from an allowed-tools value. The value is a comma-separated plain
// scalar (readFrontmatter keeps it a string) or, defensively, a bracket-list already parsed into an array.
// Only entries beginning with mcp__ are tool names of interest; Bash/Read/TaskCreate etc. are
// ignored (they are not MCP namespaces and are out of this checker's scope).
export function extractMcpTools(allowedTools: unknown): string[] {
  const parts: string[] = Array.isArray(allowedTools)
    ? allowedTools.map((s) => String(s))
    : String(allowedTools ?? "")
        .split(",")
        .map((s) => s.trim());
  return parts.filter((p) => p.startsWith("mcp__"));
}

// Judge the allowed-tools namespace surface at root. Pure filesystem read, no writes. A violation is a
// mcp__ tool name in a skill's allowed-tools field that does NOT start with mcp__plugin_quay_quay__.
export function checkSkillAllowedToolsNamespaces(root: string): SkillAllowedToolsResult {
  const skillsDir = path.join(root, SKILLS_DIR_REL);
  if (!fs.existsSync(skillsDir)) {
    return {
      ok: false,
      evaluated: false,
      notEvaluatedReason: `no ${SKILLS_DIR_REL} dir under ${root}`,
      skills: [],
      withAllowedTools: [],
      violations: [],
    };
  }

  const skillFiles = listSkillFiles(skillsDir);
  if (skillFiles.length === 0) {
    return {
      ok: false,
      evaluated: false,
      notEvaluatedReason: `no SKILL.md files under ${skillsDir}`,
      skills: [],
      withAllowedTools: [],
      violations: [],
    };
  }

  const skills: string[] = [];
  const withAllowedTools: string[] = [];
  const violations: SkillViolation[] = [];

  for (const skill of skillFiles) {
    const rel = path.relative(root, skill);
    skills.push(rel);
    const front = readFrontmatter(skill);
    if (!front) continue;
    // POSITIONAL: only the allowed-tools frontmatter field value is judged (hard rule 2). Prose and
    // comment mentions of mcp__quay__* in the body are never read.
    if (!("allowed-tools" in front)) continue;
    const at = front["allowed-tools"];
    if (at == null || at === "") continue;
    withAllowedTools.push(rel);
    const bad = extractMcpTools(at).filter((t) => !t.startsWith(REQUIRED_PREFIX));
    if (bad.length > 0) violations.push({ path: rel, tools: bad });
  }

  return { ok: violations.length === 0, evaluated: true, skills, withAllowedTools, violations };
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    helpExit("usage: node allowed-tools-plugin-prefix-check.ts [--root <dir>] [--json]");
  }
  const root = path.resolve(flagValue(argv, "--root") ?? DEFAULT_ROOT);
  const json = argv.includes("--json");

  const res = checkSkillAllowedToolsNamespaces(root);

  if (!res.evaluated) {
    return emitNotEvaluated(res.notEvaluatedReason ?? "could not evaluate the allowed-tools namespace surface", res, {
      json,
      stream: json ? "stdout" : "stderr",
    });
  }

  if (res.ok) {
    return emitPass(
      `all ${res.withAllowedTools.length} SKILL.md with allowed-tools use the ${REQUIRED_PREFIX}* namespace (${res.violations.length} violation(s))`,
      res,
      { json },
    );
  }

  if (!json) {
    for (const v of res.violations) {
      process.stderr.write(`  ${v.path} allowed-tools has non-plugin-quay mcp__ names:\n`);
      for (const t of v.tools) process.stderr.write(`    - ${t}\n`);
    }
  }
  return emitFail(
    `${res.violations.length} SKILL.md file(s) carry a non-${REQUIRED_PREFIX}* mcp__ tool name in allowed-tools`,
    res,
    { json, stream: json ? "stdout" : "stderr" },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
