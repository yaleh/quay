// runtime-usage-inventory.ts — gap-no-inventory-of-what-the-two-layer-mode-actually-runs.
// Build the evidence table of what the two-layer (fast) mode actually RUNS: for every script in
// the four script roots (plugin/scripts · experiments/**/scripts · .claude/workflows · scripts),
// measure executed / imported_by / ci_invoked / in_test_glob and assign one of six classes.
// The table is the deliverable that makes "what to cut" mechanically decidable — this task DELETES
// NOTHING (AC9). `unaccounted` means "no evidence why it's here", NOT "safe to delete".
//
// ── Evidence sources ───────────────────────────────────────────────────────────────────────────────────
//   executed    — command-position occurrences in Claude Code session transcripts (the inner-layer
//                 fast-mode session + subagents, window-filtered by --since/--until). Quotes are
//                 STRIPPED before matching, and only interpreter/executor argument positions count:
//                 `ls x.ts` / `grep 'x.ts'` / `cat x.sh` MENTION a script but never execute it.
//                 Bash tool_use commands AND Workflow tool_use scriptPath/name are both read.
//   imported_by — parsed import/require STATEMENTS across the whole repo (comment-stripped), the
//                 module specifier resolved relative to the importing file; NOT bare-substring.
//   ci_invoked  — occurrences of the script path inside .github/workflows/*.yml.
//   in_test_glob— whether the file falls in scripts/test.sh's canonical glob (ADR-019/DIR-109).
//
// ── class (six values, each mechanical) ────────────────────────────────────────────────────────────────
//   live                executed > 0
//   library             executed == 0 && imported_by > 0
//   ci-only             executed == 0 && ci_invoked > 0
//   dormant-by-decision in the EXPLICIT exp6 §0 seal list (see DORMANT_BY_DECISION below)
//   never-runs-test     *.test.* && in_test_glob == false
//   unaccounted         none of the above  ← the count THIS task exists to produce
//
// ── Windows ────────────────────────────────────────────────────────────────────────────────────────────
//   main window: --since (default 2026-08-02T11:00:00Z, the two-layer mode start) → --until.
//   long window: --long-hours (default 72) before --until → --until. A script unaccounted in the
//   main window but executed in the long window is LOW-FREQUENCY, not dead — listed in the diff set.
//
// Run:
//   node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts \
//        --since 2026-08-02T11:00:00Z --until 2026-08-03T02:54:00Z --sessions-dir ~/.claude/projects/-home-yale-work-quay
//   node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts --json   # stdout JSON
//   node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts --no-write --json
//
// Output: docs/analysis/runtime-usage-inventory.{json,md} (unless --no-write).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SINCE = "2026-08-02T11:00:00Z"; // two-layer (fast) mode start
export const DEFAULT_LONG_HOURS = 72;

export const SCRIPT_ROOTS = ["plugin/scripts", "experiments", ".claude/workflows", "scripts"];

// Directories/names excluded from script enumeration AND the import scan. `worktrees` covers
// milestones/M*/worktrees/ (per-milestone git worktrees whose plugin/experiments files are mirrors
// of the main checkout — same precedent as select-tests-for-touches.ts's SKIP_DIRS).
const SKIP_DIR_NAMES = new Set([".git", "node_modules", "worktrees", ".quay", "dist", "vendor", "archive"]);

// Canonical test glob (ADR-019 / DIR-109) — single source of truth: scripts/test.sh's glob=(...)
// line. Kept in sync by hand (same three patterns, same order). Only *.test.* files consult it.
export const TEST_GLOB_PATTERNS = [
  "packages/*/test/*.test.mjs",
  "plugin/test/*.test.mjs",
  "experiments/quay-perpetual-stream/test/*.test.mjs",
];

/** Extensions that make a file a runnable script (vs. config/fixture data in a scripts dir). */
export function isScriptFile(basename: string): boolean {
  return /\.(ts|mts|cts|js|mjs|cjs|sh|bash|zsh|py|rb|pl)$/.test(basename);
}

// ── dormant-by-decision (exp6 §0) ──────────────────────────────────────────────────────────────────────
// EXPLICIT list, never inferred from a path prefix (AC5). Source cited in each family:
//   * VT / chart2 / portfolio / git-lens: docs/proposals/exp6-queue-driven-concurrent-executor.md §0
//     ("对现存机制的处置含义"): "exp5 的 VT / chart2 / portfolio / git-lens 度量机器：测的是产品交付
//     进度。阶段 1 期间它测的是一个几乎不动的量，因此不删、不进 CI 默认组，封存待阶段 2 启用。删掉它
//     等于在阶段 2 重建。"
//   * governance-product-ratio-*: task body gap-no-inventory-of-what-the-two-layer-mode-actually-runs,
//     "死名单里至少有三个不同的类" table — the same exp6 §0 "方法论治理（封存）" governance group
//     (scripts/test.sh's governance group comment: "PARKED but not deleted — exp6 phase-2 needs it").
export const DORMANT_BY_DECISION: string[] = [
  // chart2 family (exp6 §0)
  "experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts",
  "experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts",
  "experiments/quay-perpetual-stream/scripts/chart2-s3-external-validation.ts",
  // git-lens family (exp6 §0)
  "experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts",
  "experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts",
  "experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts",
  "experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh",
  // governance-product-ratio family (task body + exp6 §0 governance group)
  "experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts",
  "experiments/quay-perpetual-stream/scripts/governance-product-ratio-selfcheck.sh",
  // VT family (exp6 §0)
  "experiments/quay-perpetual-stream/scripts/outward-vt-check.ts",
  "experiments/quay-perpetual-stream/scripts/outward-vt-selfcheck.sh",
  // portfolio family (exp6 §0) — BOTH copies are real byte-identical files (not symlinks), both sealed
  "experiments/quay-perpetual-stream/scripts/portfolio-choice.ts",
  "plugin/scripts/portfolio-choice.ts",
];

// Programs that EXECUTE the script given as an argument (interpreter/runner).
const EXECUTORS = new Set([
  "node", "nodejs", "bun", "deno", "python", "python3", "pypy", "ruby", "perl", "php",
  "bash", "sh", "dash", "zsh", "ksh", "fish", "ash", "tsx", "ts-node", "source",
]);

// Wrappers that transparently forward to a real program (unwrapped to find it).
const WRAPPERS = new Set([
  "env", "timeout", "sudo", "command", "exec", "nice", "nohup", "setsid", "stdbuf",
]);

// Per-executor code-execution flags whose VALUE is inline code (not a script file). When present,
// the segment's other args are arguments to that inline code, not executed script files — skip the
// segment. Executor-specific: `-e` is inline code for node/python but `errexit` for bash/sh.
const INLINE_CODE_FLAGS: Record<string, Set<string>> = {
  node: new Set(["-e", "--eval", "-p", "--print", "--input-type"]),
  nodejs: new Set(["-e", "--eval", "-p", "--print", "--input-type"]),
  bun: new Set(["-e", "--eval"]),
  deno: new Set(["eval", "-"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  bash: new Set(["-c", "--command"]),
  sh: new Set(["-c"]),
  dash: new Set(["-c"]),
  zsh: new Set(["-c"]),
};
function hasInlineCodeFlag(program: string, args: string[]): boolean {
  const flags = INLINE_CODE_FLAGS[program];
  if (!flags) return false;
  return args.some((a) => flags.has(a));
}

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────

export interface ScriptEntry {
  relPath: string;        // repo-relative path of THIS filesystem entry
  realPath: string;       // repo-relative resolved realpath (symlink target)
  basename: string;
  category: "plugin-scripts" | "experiments-scripts" | "workflows" | "scripts";
  isSymlink: boolean;
  aliases: string[];      // other entry paths that resolve to the same realPath
  isTestFile: boolean;    // basename contains ".test."
  main: WindowMeasure;
  long: WindowMeasure;
  class: ClassValue;
}

export interface WindowMeasure {
  executed: number;           // EFFECTIVE: transcript command-position + indirect (drives class)
  executedTranscript: number; // raw transcript command-position count only
  indirectExec: boolean;      // executed indirectly via a live same-folder `.sh` wrapper
  importedBy: string[];   // repo-relative importing files (distinct)
  importedCount: number;
  ciInvoked: number;
  inTestGlob: boolean;
  note: string;
}

export type ClassValue =
  | "live" | "library" | "ci-only" | "dormant-by-decision" | "never-runs-test" | "unaccounted";

export interface TranscriptData {
  commandCount: number;
  files: string[];
}

export interface Inventory {
  generatedAt: string;
  root: string;
  sessionsDir: string;
  innerSessions: string[]; // main-window session scope (empty = all sessions)
  windows: { main: { since: string; until: string; hours: number }; long: { since: string; until: string; hours: number } };
  transcripts: { main: TranscriptData; long: TranscriptData };
  scriptsTotal: number;       // distinct scripts by realpath
  rawEntries: number;         // filesystem entries including symlinks
  scripts: ScriptEntry[];
  summary: {
    byClass: Record<ClassValue, number>;
    unaccounted: string[];
    neverRunsTest: string[];
    dormantByDecision: string[];
    ciOnly: string[];
    diffMainToLong: { script: string; mainClass: ClassValue; mainExecuted: number; longExecuted: number }[];
    unaccountedToLive: { script: string; longExecuted: number }[];
  };
}

// ── Enumeration ────────────────────────────────────────────────────────────────────────────────────────

function dirContainsSkip(fullDir: string): boolean {
  return fullDir.split(path.sep).some((seg) => SKIP_DIR_NAMES.has(seg));
}

function isFileOrSymlink(full: string): boolean {
  try {
    const st = fs.lstatSync(full);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Find every directory named `name` under `base`, skipping worktrees/node_modules/.git. */
function findDirsNamed(base: string, name: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === name && e.isDirectory()) out.push(path.join(dir, e.name));
      else if (e.isDirectory() && !SKIP_DIR_NAMES.has(e.name)) walk(path.join(dir, e.name));
    }
  };
  walk(base);
  return out;
}

function categoryOf(relPath: string): ScriptEntry["category"] {
  if (relPath.startsWith("plugin/scripts/")) return "plugin-scripts";
  if (relPath.startsWith("experiments/")) return "experiments-scripts";
  if (relPath.startsWith(".claude/workflows/")) return "workflows";
  if (relPath.startsWith("scripts/")) return "scripts";
  return "scripts";
}

/**
 * Enumerate every script file in the four roots. Distinct scripts are keyed by realpath (a symlink
 * into plugin/scripts is the same script as its target — the experiments symlinks ARE the plugin
 * files). `aliases` records every entry path that resolves to the same realpath, so a transcript
 * command spelling ANY alias counts as executing the canonical script.
 */
export function enumerateScripts(root: string): { scripts: ScriptEntry[]; rawEntries: number } {
  const byReal = new Map<string, ScriptEntry>();
  let rawEntries = 0;

  const add = (full: string) => {
    rawEntries++;
    const rel = path.relative(root, full).split(path.sep).join("/");
    let realRel: string;
    try {
      realRel = path.relative(root, fs.realpathSync(full)).split(path.sep).join("/");
    } catch {
      realRel = rel;
    }
    let entry = byReal.get(realRel);
    if (entry) {
      entry.aliases.push(rel);
      return;
    }
    const isSymlink = (() => {
      try {
        return fs.lstatSync(full).isSymbolicLink();
      } catch {
        return false;
      }
    })();
    entry = {
      relPath: realRel,
      realPath: realRel,
      basename: path.basename(realRel),
      category: categoryOf(realRel),
      isSymlink,
      aliases: rel === realRel ? [] : [rel],
      isTestFile: /\.test\.[^/]+$/.test(realRel),
      main: { executed: 0, importedBy: [], importedCount: 0, ciInvoked: 0, inTestGlob: false, note: "" },
      long: { executed: 0, importedBy: [], importedCount: 0, ciInvoked: 0, inTestGlob: false, note: "" },
      class: "unaccounted",
    };
    byReal.set(realRel, entry);
  };

  for (const rootDir of SCRIPT_ROOTS) {
    if (rootDir === "experiments") {
      const dirs = findDirsNamed(path.join(root, "experiments"), "scripts");
      for (const d of dirs) {
        if (dirContainsSkip(d)) continue;
        let names: string[] = [];
        try {
          names = fs.readdirSync(d);
        } catch {
          continue;
        }
        for (const n of names) {
          const full = path.join(d, n);
          if (isFileOrSymlink(full)) add(full);
        }
      }
    } else {
      const dir = path.join(root, rootDir);
      if (!fs.existsSync(dir)) continue;
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        const full = path.join(dir, n);
        if (isFileOrSymlink(full)) add(full);
      }
    }
  }

  const scripts = [...byReal.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { scripts, rawEntries };
}

// ── Transcript reading ─────────────────────────────────────────────────────────────────────────────────

/** Remove single-quoted, double-quoted and backtick-quoted regions (respecting backslash escapes). */
export function stripQuotedContent(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i++;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === ch) {
          i++;
          break;
        }
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Split a (quote-stripped) shell command into argv segments on command separators. */
export function splitCommandSegments(cleaned: string): string[][] {
  const segments: string[][] = [];
  const tokens = cleaned.split(/(?:;|&&|\|\||\||\(|\)|\n)/);
  for (const tok of tokens) {
    const argv = tok.trim().split(/\s+/).filter(Boolean);
    if (argv.length) segments.push(argv);
  }
  return segments;
}

/** Unwrap `env/timeout/sudo/...` (and a leading `VAR=value` env-prefix) to find the real program. */
function unwrapWrapper(argv: string[]): { program: string; args: string[] } {
  let i = 0;
  // `VAR=value node foo.ts` — env-prefix assignments before the program.
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  let prog = argv[i] ?? "";
  let rest = argv.slice(i + 1);
  if (!WRAPPERS.has(prog)) return { program: prog, args: rest };
  let j = 0;
  while (j < rest.length) {
    const t = rest[j];
    if (t.startsWith("-")) {
      j++;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      j++;
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(t)) {
      j++;
      continue;
    }
    break;
  }
  return { program: rest[j] ?? "", args: rest.slice(j + 1) };
}

/** Does `token` (a shell word) reference this script's path (any alias / realpath)? */
export function tokenMatchesScript(token: string, script: ScriptEntry): boolean {
  if (!token) return false;
  let norm = token;
  if (norm.startsWith("./")) norm = norm.slice(2);
  const candidates = [script.relPath, script.realPath, ...script.aliases].filter(Boolean);
  for (const c of candidates) {
    if (norm === c) return true;
    // absolute / worktree-prefixed path ending at a path boundary
    if (norm.length > c.length && norm.endsWith(c) && norm[norm.length - c.length - 1] === "/") return true;
  }
  return false;
}

/**
 * Count command-position executions of `script` inside ONE raw command string. Quotes are stripped
 * first; a mention only counts when it is the segment's program, or an argument to an executor
 * (node/bash/sh/./...). `ls x.ts` / `grep 'x.ts'` / `cat x.sh` never count (AC2).
 */
export function countExecutedInCommand(command: string, script: ScriptEntry, paths: string[]): number {
  if (!paths.some((p) => command.includes(p))) return 0;
  const cleaned = stripQuotedContent(command);
  const segments = splitCommandSegments(cleaned);
  let n = 0;
  for (const argv of segments) {
    const { program, args } = unwrapWrapper(argv);
    if (program && tokenMatchesScript(program, script)) {
      n++;
      continue;
    }
    if (EXECUTORS.has(program) || /(^|\/)(node|nodejs|bash|sh|deno|bun|python3?|tsx)$/.test(program)) {
      if (hasInlineCodeFlag(program, args)) continue; // -e/-c: the "code" is inline, not a file
      for (const a of args) {
        if (tokenMatchesScript(a, script)) n++;
      }
    }
    // else: program is a reference-only tool (ls/grep/cat/git/...) — its args merely mention the file.
  }
  return n;
}

/** Match a Workflow tool_use invocation (scriptPath/name) against a workflow script entry. */
function countWorkflowExecutions(script: ScriptEntry, invocations: { scriptPath?: string; name?: string }[]): number {
  if (script.category !== "workflows") return 0;
  const stem = script.basename.replace(/\.js$/, "");
  let n = 0;
  for (const inv of invocations) {
    const sp = inv.scriptPath || "";
    const base = path.basename(sp).replace(/\.js$/, "");
    if (sp.endsWith(script.relPath) || base === stem || base.startsWith(stem + "-wf_")) {
      n++;
      continue;
    }
    const nm = (inv.name || "").replace(/^quay:/, "").replace(/\.js$/, "");
    if (nm === stem) n++;
  }
  return n;
}

/**
 * Recursively collect *.jsonl transcript files under a subagents dir. Covers BOTH the direct
 * `<session>/subagents/agent-*.jsonl` layer AND the nested
 * `<session>/subagents/workflows/<run>/agent-*.jsonl` layer — the workflow layer was previously
 * never enumerated (gap-runtime-usage-inventory-workflow-blind-spot). Only recurses into real
 * directories (a symlinked dir is not followed, so symlink cycles cannot recurse).
 */
function collectJsonlFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      collectJsonlFiles(path.join(dir, e.name), out);
    } else if ((e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".jsonl")) {
      out.push(path.join(dir, e.name));
    }
  }
}

/**
 * Read transcript records in [since, until): Bash commands + Workflow invocations.
 * `includeSessions` (when non-empty) restricts the read to those session ids (top-level file +
 * their subagents, including nested workflows/<run>/ agents) — used to scope the MAIN window to the
 * fast-mode inner-layer sessions. An empty set reads EVERY session under sessionsDir (used for the
 * broad long contrast window).
 */
export function readTranscripts(
  sessionsDir: string,
  since: string,
  until: string,
  includeSessions: Set<string> = new Set(),
  excludeTopLevelSessions: Set<string> = new Set(),
): { commands: string[]; workflowInvocations: { scriptPath?: string; name?: string }[]; files: string[]; commandCount: number } {
  const commands: string[] = [];
  const workflowInvocations: { scriptPath?: string; name?: string }[] = [];
  const files: string[] = [];
  if (!fs.existsSync(sessionsDir)) return { commands, workflowInvocations, files, commandCount: 0 };

  const topLevel = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  const jsonlFiles: string[] = [];
  for (const f of topLevel) {
    const id = f.replace(/\.jsonl$/, "");
    if (excludeTopLevelSessions.has(id)) continue;
    if (includeSessions.size > 0 && !includeSessions.has(id)) continue;
    jsonlFiles.push(path.join(sessionsDir, f));
  }
  // subagents: every <session-id>/subagents/**/*.jsonl — BOTH the direct layer and the nested
  // workflows/<run>/ layer. The workflow layer was the enumeration blind spot
  // (gap-runtime-usage-inventory-workflow-blind-spot): readTranscripts previously read only the
  // direct subagents and never recursed into subagents/workflows/<run>/, where workflow agents do
  // their work — so executions inside workflow agents were invisible and the live count read low.
  for (const d of fs.readdirSync(sessionsDir)) {
    if (includeSessions.size > 0 && !includeSessions.has(d)) continue;
    const sub = path.join(sessionsDir, d, "subagents");
    let subStat;
    try {
      subStat = fs.statSync(sub);
    } catch {
      continue;
    }
    if (!subStat.isDirectory()) continue;
    collectJsonlFiles(sub, jsonlFiles);
  }

  const sinceMs = Date.parse(since);
  for (const f of jsonlFiles) {
    let inFile = false;
    try {
      // A transcript file cannot contain records newer than its mtime — skip files whose mtime
      // predates the window so the long (72h) scan over ~6800 subagent files stays cheap.
      if (fs.statSync(f).mtimeMs < sinceMs) continue;
      const content = fs.readFileSync(f, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let rec: any;
        try {
          rec = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const ts: string | undefined = rec?.timestamp;
        if (!ts || ts < since || ts >= until) continue;
        if (rec?.type !== "assistant") continue;
        const contentBlocks = rec?.message?.content;
        if (!Array.isArray(contentBlocks)) continue;
        for (const blk of contentBlocks) {
          if (blk?.type !== "tool_use") continue;
          if (blk.name === "Bash" && typeof blk?.input?.command === "string") {
            commands.push(blk.input.command);
            inFile = true;
          } else if (blk.name === "Workflow" && blk?.input) {
            const inp = blk.input;
            workflowInvocations.push({
              scriptPath: typeof inp.scriptPath === "string" ? inp.scriptPath : undefined,
              name: typeof inp.name === "string" ? inp.name : undefined,
            });
            inFile = true;
          }
        }
      }
    } catch {
      continue;
    }
    if (inFile) files.push(f);
  }

  return { commands, workflowInvocations, files, commandCount: commands.length };
}

// ── Import parsing (AC3) ───────────────────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  // Remove line comments and block comments (naive — good enough for import-statements; a string
  // literal containing "import ... from" is an acceptable, documented false positive).
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

const IMPORT_SPEC_RE = /(?:import\s*\(\s*|require\s*\(\s*|from\s*|import\s*)(['"])([^'"]+)\1/g;

/** Extract every import/require module specifier from (comment-stripped) source. */
export function extractModuleSpecifiers(src: string): string[] {
  const out: string[] = [];
  const cleaned = stripComments(src);
  let m: RegExpExecArray | null;
  IMPORT_SPEC_RE.lastIndex = 0;
  while ((m = IMPORT_SPEC_RE.exec(cleaned)) !== null) {
    out.push(m[2]);
  }
  return out;
}

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(e.name)) walk(full);
      } else if (e.isFile() && /\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * For every script realpath, the list of repo-relative files whose import/require statements resolve
 * to it. Only RELATIVE (or absolute-within-root) specifiers resolve to repo scripts.
 */
export function parseImports(root: string, scripts: ScriptEntry[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const realSet = new Set(scripts.map((s) => s.realPath));
  const files = walkSourceFiles(root);
  for (const f of files) {
    const relF = path.relative(root, f).split(path.sep).join("/");
    if (relF.startsWith("milestones/") && relF.includes("/worktrees/")) continue;
    let content = "";
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const specs = extractModuleSpecifiers(content);
    const dir = path.dirname(f);
    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const base = spec.startsWith("/") ? path.join(root, spec.slice(1)) : path.resolve(dir, spec);
      const candidates = [base, base + ".ts", base + ".tsx", base + ".mts", base + ".js", base + ".mjs", base + ".cjs", base + "/index.ts", base + "/index.js"];
      for (const c of candidates) {
        let real: string;
        try {
          real = path.relative(root, fs.realpathSync(c)).split(path.sep).join("/");
        } catch {
          continue;
        }
        if (realSet.has(real)) {
          const list = result.get(real) ?? [];
          list.push(relF);
          result.set(real, list);
          break;
        }
      }
    }
  }
  return result;
}

// ── Wrapper-indirect execution ─────────────────────────────────────────────────────────────────────────
// A `*-check.sh` wrapper delegates to its `*-check.ts` via `node "$(dirname "$0")/X.ts"` — the .ts path
// is constructed at runtime, so it never appears in the transcript command. A script referenced by a
// transcript-LIVE `.sh` wrapper is therefore executed indirectly; treat it as executed for the class.
function computeWrapperIndirect(root: string, scripts: ScriptEntry[], liveRealPaths: Set<string>): Set<string> {
  const result = new Set<string>();
  // Index scripts by their directory so the per-line loop only scans same-dir candidates
  // (the wrapper convention) instead of all ~205 scripts for every line.
  const byDir = new Map<string, ScriptEntry[]>();
  for (const s of scripts) {
    const dir = path.posix.dirname(s.realPath);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(s);
  }
  const liveSh = scripts.filter((s) => liveRealPaths.has(s.realPath) && /\.(sh|bash)$/.test(s.basename));
  for (const sh of liveSh) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(root, sh.realPath), "utf8");
    } catch {
      continue;
    }
    // RAW content (NOT quote-stripped): the delegation path is typically inside quotes
    // (`node "$(dirname "$0")/X.ts"`), which quote-stripping would erase.
    const shDir = path.posix.dirname(sh.realPath);
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      // Skip lines whose first word is a text-emission command (`echo`/`printf`/`cat`): a mention
      // inside an echo string is NOT an execution (REFUTE round-1 finding 1: `echo "...node X.ts..."`).
      const firstWord = t.split(/\s+/)[0] ?? "";
      if (firstWord === "echo" || firstWord === "printf" || firstWord === "cat" || firstWord === ">&2") continue;
      const gd = t.match(/gate_delegate_ts\s+["']?([^"'\s]+)/);
      // Same-directory delegation (`dirname $0`/X.ts / gate_delegate_ts "X.ts") — a live
      // plugin/scripts/*.sh must NOT mark the experiments/.../scripts mirror copy live.
      for (const script of byDir.get(shDir) ?? []) {
        if (script.realPath === sh.realPath) continue;
        const base = script.basename;
        if (gd && gd[1] === base) {
          result.add(script.realPath);
          continue;
        }
        if (!t.includes(base)) continue;
        // Invocation keyword, checked AFTER removing the basename so a `.sh` extension cannot
        // satisfy `\bsh\b`. `$(` catches command-substitution executions; `bash`/`node`/`exec`/
        // `source`/`dirname`/`run_check` catch the wrapper delegation and orchestrator lines.
        const tMinus = t.split(base).join(" ");
        if (/(\bnode\b|\bbash\b|\bexec\b|\bsource\b|dirname|\$\(|\brun_check\b)/.test(tMinus)) {
          result.add(script.realPath);
        }
      }
      // Explicit repo-relative path reference to a script in ANOTHER dir (e.g. scripts/test.sh →
      // plugin/scripts/X.sh). Only pays the full-scan cost when the line actually looks like a path.
      if (t.includes("/scripts/") || t.includes("/workflows/")) {
        for (const script of scripts) {
          if (script.realPath === sh.realPath || result.has(script.realPath)) continue;
          if (!t.includes(script.realPath)) continue;
          const tMinus = t.split(script.basename).join(" ");
          if (/(\bnode\b|\bbash\b|\bexec\b|\bsource\b|dirname|\$\(|\brun_check\b)/.test(tMinus)) {
            result.add(script.realPath);
          }
        }
      }
    }
  }
  return result;
}

// ── CI invocation ──────────────────────────────────────────────────────────────────────────────────────

export function readCiInvocation(root: string, scripts: ScriptEntry[]): Map<string, number> {
  const result = new Map<string, number>();
  const ciDir = path.join(root, ".github", "workflows");
  if (!fs.existsSync(ciDir)) return result;
  let files: string[] = [];
  try {
    files = fs.readdirSync(ciDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return result;
  }
  let content = "";
  for (const f of files) {
    try {
      content += fs.readFileSync(path.join(ciDir, f), "utf8") + "\n";
    } catch {
      continue;
    }
  }
  // Strip `#` comments so prose mentions of a script path (e.g. a comment citing it) do not count
  // as CI invocation (REFUTE round-1 finding 9).
  content = content
    .split("\n")
    .map((l) => (l.trimStart().startsWith("#") ? "" : l))
    .join("\n");
  for (const s of scripts) {
    let n = 0;
    const paths = [s.relPath, ...s.aliases];
    for (const p of paths) {
      let idx = 0;
      while ((idx = content.indexOf(p, idx)) !== -1) {
        n++;
        idx += p.length;
      }
    }
    result.set(s.realPath, n);
  }
  return result;
}

// ── test glob (ADR-019) ────────────────────────────────────────────────────────────────────────────────

/** Simple glob matcher for the three canonical patterns (`*` matches within a path segment). */
export function globMatch(pattern: string, relPath: string): boolean {
  const esc = pattern
    .split("")
    .map((c) => (c === "*" ? " " : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("")
    .replace(/ /g, "[^/]*");
  return new RegExp("^" + esc + "$").test(relPath);
}

export function inTestGlob(relPath: string): boolean {
  return TEST_GLOB_PATTERNS.some((p) => globMatch(p, relPath));
}

// ── Classification ─────────────────────────────────────────────────────────────────────────────────────

export function classifyScript(
  executed: number,
  importedCount: number,
  ciInvoked: number,
  relPath: string,
  isTestFile: boolean,
  inGlob: boolean,
): ClassValue {
  if (executed > 0) return "live"; // 1
  if (importedCount > 0) return "library"; // 2
  if (ciInvoked > 0) return "ci-only"; // 3
  if (DORMANT_BY_DECISION.includes(relPath)) return "dormant-by-decision"; // 4
  if (isTestFile && !inGlob) return "never-runs-test"; // 5
  return "unaccounted"; // 6
}

// ── Inventory build ────────────────────────────────────────────────────────────────────────────────────

export function buildInventory(
  root: string,
  sessionsDir: string,
  since: string,
  until: string,
  longHours: number,
  opts: { excludeSessions?: Set<string>; innerSessions?: Set<string> } = {},
): Inventory {
  const { scripts, rawEntries } = enumerateScripts(root);
  const excludeSessions = opts.excludeSessions ?? new Set();
  const innerSessions = opts.innerSessions ?? new Set();

  // Main window — scoped to the fast-mode INNER layer sessions when --inner-sessions is given.
  const mainTx = readTranscripts(sessionsDir, since, until, innerSessions, excludeSessions);
  // Long window — broad contrast over the same sessions-dir: [until - longHours, until). Reads
  // EVERY session (the classic-loop milestone sessions are exactly why low-frequency scripts show up).
  const longSince = new Date(new Date(until).getTime() - longHours * 3600 * 1000).toISOString();
  const longTx = readTranscripts(sessionsDir, longSince, until, new Set(), excludeSessions);

  // Imports + CI are window-independent (whole-repo static analysis)
  const imports = parseImports(root, scripts);
  const ci = readCiInvocation(root, scripts);

  // First pass: transcript-only executed counts (for wrapper inference + raw numbers).
  for (const s of scripts) {
    const paths = [s.relPath, s.realPath, ...s.aliases].filter(Boolean);
    s.main.executedTranscript = countExecutedFor(s, mainTx, paths);
    s.long.executedTranscript = countExecutedFor(s, longTx, paths);
    s.main.executed = s.main.executedTranscript;
    s.long.executed = s.long.executedTranscript;
  }
  const mainLiveSet = new Set(scripts.filter((s) => s.main.executedTranscript > 0).map((s) => s.realPath));
  const longLiveSet = new Set(scripts.filter((s) => s.long.executedTranscript > 0).map((s) => s.realPath));
  const wrapperMain = computeWrapperIndirect(root, scripts, mainLiveSet);
  const wrapperLong = computeWrapperIndirect(root, scripts, longLiveSet);

  for (const s of scripts) {
    const mainExec = s.main.executedTranscript + (wrapperMain.has(s.realPath) ? 1 : 0);
    const longExec = s.long.executedTranscript + (wrapperLong.has(s.realPath) ? 1 : 0);
    s.main.executed = mainExec;
    s.main.indirectExec = wrapperMain.has(s.realPath);
    s.long.executed = longExec;
    s.long.indirectExec = wrapperLong.has(s.realPath);
    const imp = imports.get(s.realPath) ?? [];
    const ciN = ci.get(s.realPath) ?? 0;
    const inGlob = inTestGlob(s.relPath);
    s.main.importedBy = imp;
    s.main.importedCount = imp.length;
    s.main.ciInvoked = ciN;
    s.main.inTestGlob = inGlob;
    s.long.importedBy = imp;
    s.long.importedCount = imp.length;
    s.long.ciInvoked = ciN;
    s.long.inTestGlob = inGlob;
    s.class = classifyScript(mainExec, imp.length, ciN, s.relPath, s.isTestFile, inGlob);
    if (s.isSymlink) s.main.note = `symlink alias → ${s.realPath}`;
    if (!isScriptFile(s.basename)) s.main.note = (s.main.note ? s.main.note + " · " : "") + "non-script file (config/fixture)";
    if (s.main.indirectExec) s.main.note = (s.main.note ? s.main.note + " · " : "") + "executed via live .sh wrapper";
  }

  // Summary
  const byClass: Record<ClassValue, number> = { live: 0, library: 0, "ci-only": 0, "dormant-by-decision": 0, "never-runs-test": 0, unaccounted: 0 };
  const unaccounted: string[] = [];
  const neverRunsTest: string[] = [];
  const dormantByDecision: string[] = [];
  const ciOnly: string[] = [];
  const diffMainToLong: Inventory["summary"]["diffMainToLong"] = [];
  const unaccountedToLive: Inventory["summary"]["unaccountedToLive"] = [];

  for (const s of scripts) {
    byClass[s.class]++;
    if (s.class === "unaccounted") unaccounted.push(s.relPath);
    if (s.class === "never-runs-test") neverRunsTest.push(s.relPath);
    if (s.class === "dormant-by-decision") dormantByDecision.push(s.relPath);
    if (s.class === "ci-only") ciOnly.push(s.relPath);
    if (s.main.executed === 0 && s.long.executed > 0) {
      diffMainToLong.push({ script: s.relPath, mainClass: s.class, mainExecuted: s.main.executed, longExecuted: s.long.executed });
    }
    if (s.class === "unaccounted" && s.long.executed > 0) {
      unaccountedToLive.push({ script: s.relPath, longExecuted: s.long.executed });
    }
  }

  const mainHours = (new Date(until).getTime() - new Date(since).getTime()) / 3600_000;

  return {
    generatedAt: new Date().toISOString(),
    root,
    sessionsDir,
    innerSessions: [...innerSessions],
    windows: {
      main: { since, until, hours: Math.round(mainHours * 10) / 10 },
      long: { since: longSince, until, hours: longHours },
    },
    transcripts: {
      main: { commandCount: mainTx.commandCount, files: mainTx.files.map((f) => path.basename(f)) },
      long: { commandCount: longTx.commandCount, files: longTx.files.map((f) => path.basename(f)) },
    },
    scriptsTotal: scripts.length,
    rawEntries,
    scripts,
    summary: {
      byClass,
      unaccounted,
      neverRunsTest,
      dormantByDecision,
      ciOnly,
      diffMainToLong,
      unaccountedToLive,
    },
  };
}

function countExecutedFor(
  s: ScriptEntry,
  tx: { commands: string[]; workflowInvocations: { scriptPath?: string; name?: string }[] },
  paths: string[],
): number {
  let n = 0;
  for (const c of tx.commands) n += countExecutedInCommand(c, s, paths);
  n += countWorkflowExecutions(s, tx.workflowInvocations);
  return n;
}

// ── Markdown rendering ─────────────────────────────────────────────────────────────────────────────────

export function renderMarkdown(inv: Inventory): string {
  const lines: string[] = [];
  lines.push("# Runtime-Usage Inventory — what the two-layer mode actually runs");
  lines.push("");
  lines.push(`Generated at: \`${inv.generatedAt}\` · repo root \`${inv.root}\``);
  lines.push("");
  lines.push(`## Scope`);
  lines.push("");
  lines.push(`- **Enumerated:** ${inv.scriptsTotal} distinct scripts by realpath (${inv.rawEntries} raw filesystem entries incl. symlinks) across \`plugin/scripts\` · \`experiments/**/scripts\` · \`.claude/workflows\` · \`scripts\`.`);
  lines.push(`- **Main window:** \`${inv.windows.main.since}\` → \`${inv.windows.main.until}\` (${inv.windows.main.hours.toFixed(1)}h), ${inv.transcripts.main.commandCount} Bash/Workflow commands read from \`${inv.sessionsDir}\`${inv.innerSessions.length ? `, scoped to inner-layer sessions \`${inv.innerSessions.join("`, `")}\`` : " (all sessions)"}.`);
  lines.push(`- **Long contrast window:** \`${inv.windows.long.since}\` → \`${inv.windows.long.until}\` (${inv.windows.long.hours}h), ${inv.transcripts.long.commandCount} commands. A script unaccounted in the main window but executed in the long window is **low-frequency, not dead** — listed in the diff set.`);
  lines.push(`- **Class semantics:** \`live\` executed>0 · \`library\` imported>0 · \`ci-only\` in \`.github/workflows\` · \`dormant-by-decision\` in the exp6 §0 seal list · \`never-runs-test\` a \`*.test.*\` outside \`scripts/test.sh\`'s canonical glob · \`unaccounted\` none of the above.`);
  lines.push("");
  lines.push(`> **unaccounted ≠ deletable.** \`unaccounted\` means "no evidence explains why this script is here" — it is the *candidate pool* for a later decision, not a deletion list. Calling it "safe to delete" would delete exp5's deliberately sealed metering machinery (chart2/git-lens/portfolio/VT).`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| class | count |`);
  lines.push(`|---|---|`);
  for (const c of ["live", "library", "ci-only", "dormant-by-decision", "never-runs-test", "unaccounted"] as ClassValue[]) {
    lines.push(`| ${c} | ${inv.summary.byClass[c]} |`);
  }
  lines.push(`| **total** | ${inv.scriptsTotal} |`);
  lines.push("");
  lines.push(`**unaccounted (${inv.summary.unaccounted.length}):**`);
  lines.push("");
  for (const s of inv.summary.unaccounted) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`**never-runs-test (${inv.summary.neverRunsTest.length})** — written but never in the canonical suite:`);
  lines.push("");
  for (const s of inv.summary.neverRunsTest) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`**dormant-by-decision (${inv.summary.dormantByDecision.length})** — classified dormant in the main window (exp6 §0 seal list, explicit, source-cited):`);
  lines.push("");
  for (const s of inv.summary.dormantByDecision) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`**Sealed by exp6 §0 (full ${DORMANT_BY_DECISION.length}-entry list, shown with their ACTUAL class):**`);
  lines.push("");
  const sealedByRel = new Map(inv.scripts.map((s) => [s.realPath, s]));
  for (const p of DORMANT_BY_DECISION) {
    const s = sealedByRel.get(p);
    const classLabel = s ? `\`${s.class}\`` : "not-enumerated";
    const eclipse = s && s.class !== "dormant-by-decision" ? ` — sealed, but \`${s.class}\` takes priority (imported by its own governance test)` : "";
    lines.push(`- \`${p}\` → **${classLabel}**${eclipse}`);
  }
  lines.push("");
  lines.push(`**ci-only (${inv.summary.ciOnly.length}):**`);
  lines.push("");
  for (const s of inv.summary.ciOnly) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`## Main → long window diff (${inv.summary.diffMainToLong.length}) — low-frequency, not dead`);
  lines.push("");
  lines.push(`Scripts with \`executed == 0\` in the main window but \`executed > 0\` in the ${inv.windows.long.hours}h window. These are cadence-driven (milestone / CI-triggered), not dead.`);
  lines.push("");
  lines.push(`| script | main class | main executed | long executed |`);
  lines.push(`|---|---|---|---|`);
  for (const d of inv.summary.diffMainToLong) {
    lines.push(`| \`${d.script}\` | ${d.mainClass} | ${d.mainExecuted} | ${d.longExecuted} |`);
  }
  lines.push("");
  if (inv.summary.unaccountedToLive.length) {
    lines.push(`Of those, **unaccounted → live** (${inv.summary.unaccountedToLive.length}): ` + inv.summary.unaccountedToLive.map((d) => `\`${d.script}\` (×${d.longExecuted})`).join(", "));
    lines.push("");
  }
  lines.push(`## Full table (${inv.scripts.length})`);
  lines.push("");
  lines.push(`| script | cat | exec | imp | ci | test-glob | class | long-exec | note |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const s of inv.scripts) {
    const catshort = s.category.replace("-scripts", "").replace("plugin", "plug").replace("experiments", "exp");
    lines.push(`| \`${s.relPath}\` | ${catshort} | ${s.main.executed} | ${s.main.importedCount} | ${s.main.ciInvoked} | ${s.main.inTestGlob ? "y" : "—"} | **${s.class}** | ${s.long.executed} | ${s.main.note} |`);
  }
  lines.push("");
  lines.push(`## Methodology & known limitations`);
  lines.push("");
  lines.push(`- **executed** is command-position matching: single/double/backtick-quoted content is stripped, then only interpreter/executor argument positions count. \`ls x.ts\` / \`grep 'x.ts'\` / \`cat x.sh\` never count. Known conservative miss: a script referenced inside \`bash -c '...'\` / \`node -e '...'\` inline code is not counted (the code is quote-stripped).`);
  lines.push(`- **imported_by** parses \`import\`/\`require\` statements (comment-stripped) and resolves the specifier; it is not a substring scan. Known false positive: a string literal containing \`import ... from "..."\`.`);
  lines.push(`- **in_test_glob** only matters for \`*.test.*\` files; the three glob patterns are the canonical \`scripts/test.sh\` glob (ADR-019/DIR-109).`);
  lines.push(`- The transcripts read are whatever sessions exist under \`--sessions-dir\` within the window. For the main window these are the fast-mode inner-layer sessions; for the long window the same scan naturally includes the pre-fast-mode classic-loop sessions — which is exactly why cadence-driven scripts surface in the diff.`);
  lines.push(`- The task body cited 211 scripts at 2026-08-03 02:5xZ (a rough first measurement; a raw filesystem count that excluded the 7 \`*.test.*\` files). This inventory's current HEAD count is ${inv.scriptsTotal} distinct-by-realpath / ${inv.rawEntries} raw — the delta is \`plugin/scripts\` +1 (\`task-contract-check.ts\`, added 03:04Z) plus the 7 \`*.test.*\` files this inventory deliberately includes (AC6 requires listing them).`);
  lines.push(`- Some \`unaccounted\` entries are non-script files (config/fixture) that sit in a scripts dir — they are flagged in the \`note\` column (e.g. \`tsconfig.json\`, \`deliverable-governor-fixture.json\`, the 4 \`fixtures/loadbearing/scripts/fixture-*.mjs\`). They are included for full filesystem coverage but are not runnable scripts.`);
  lines.push(`- \`never-runs-test\` is eclipsed by \`live\` when a \`*.test.*\` outside the canonical glob was nonetheless executed in the window (e.g. \`it0-enforcement-with-design-check.test.mjs\`, run once manually). Such a file is genuinely "not in the suite" but has execution evidence — the class follows the priority, so it shows \`live\`, not \`never-runs-test\`.`);
  lines.push(`- The \`executed\` count is command-position matching (quotes stripped) plus a conservative wrapper-indirect signal (a transcript-live \`.sh\` that delegates to a same-dir \`.ts\`/references it via \`node\`/\`bash\`/ \`gate_delegate_ts\` marks that target as executed too). Known conservative misses: a script referenced inside \`bash -c '...'\` inline code, or invoked by bare basename after \`cd\`.`);
  lines.push("");
  lines.push(`## Entry point (gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point)`);
  lines.push("");
  lines.push(`The \`plugin/scripts\` instruments are discoverable through ONE entry point instead of remembered paths:`);
  lines.push("");
  lines.push(`- **MCP:** the Core \`instrument\` tool (\`packages/quay/src/mcp-server.ts\`) — \`action: "list"\` returns the derived instrument directory (each admitted instrument declaring what question it answers); \`action: "run"\` + \`name\` + \`args\` invokes one. The directory is DERIVED from the filesystem by this tool's \`--instruments-json\` mode:`);
  lines.push(`  \`node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts --instruments-json\``);
  lines.push(`- **Admission filter (AC4):** an instrument is admitted only when it declares its question — explicitly via \`@instrument "<question>"\` in its header comment, or derived from the header's own \`<basename> — <description>\` line. Instruments that cannot say are kept OUT, listed under \`notAdmitted\`.`);
  lines.push(`- **The count is derived, never hardcoded** — the "81" in the task body is a snapshot; the manifest's \`total\` reflects the current filesystem.`);
  lines.push("");
  return lines.join("\n");
}

// ── Instrument manifest ────────────────────────────────────────────────────────────────────────────────
// gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point: the ENTRY POINT data source.
// The plugin/scripts instruments are discoverable only by remembering a path; this section derives the
// machine-readable directory (name/path/declared-question) that a consumer (the Core `instrument` MCP
// tool in packages/quay/src/mcp-server.ts) surfaces. The count is DERIVED from the filesystem — never a
// hardcoded "81" — and the ADMISSION FILTER (AC4: a script that cannot say what question it answers
// does not get in) is mechanical: an instrument is admitted only when it DECLARES its question, either
// explicitly via an `@instrument "<question>"` tag in its header comment or derived from the header's
// own `<basename> — <description>` line.

/** Extract the leading header comment block (a block comment, a `//` run, or a `#` run) from script source. */
export function extractHeaderComment(src: string): string {
  const text = src.replace(/^﻿/, "").trimStart();
  if (text.startsWith("/*")) {
    const end = text.indexOf("*/");
    if (end !== -1) return text.slice(2, end);
  }
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimStart();
    if (line.startsWith("//")) out.push(line.slice(2).trim());
    else if (line.startsWith("#!")) out.push(line.slice(2).trim());
    else if (line.startsWith("#")) out.push(line.slice(1).trim());
    else if (out.length && line === "") out.push("");
    else if (out.length) break;
    else break;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

const INSTRUMENT_TAG_RE = /@instrument\s+(.+?)\s*$/;

/**
 * The declared "what question this instrument answers". Returns null when the script cannot say — and a
 * null here is the admission filter: the instrument stays OUT of the entry-point directory (AC4).
 * Explicit `@instrument "<question>"` wins; otherwise the header's own `<basename> — <description>`
 * line is the derived fallback (the repo's established header convention).
 */
export function extractInstrumentDeclaration(src: string, basename: string): string | null {
  const header = extractHeaderComment(src);
  if (!header) return null;
  for (const line of header.split("\n")) {
    const m = line.match(INSTRUMENT_TAG_RE);
    if (m) return m[1].trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  }
  const dashLine = header.split("\n").find((l) => l.includes("—") || l.includes("–"));
  if (dashLine) {
    const dashAt = dashLine.indexOf("—") !== -1 ? dashLine.indexOf("—") : dashLine.indexOf("–");
    const desc = dashLine.slice(dashAt + 1).trim();
    if (desc) return desc;
  }
  return null;
}

/** The interpreter an instrument runs under (drives the `instrument` tool's `run` dispatch). */
export function instrumentKind(basename: string): string {
  return /\.(sh|bash|zsh)$/.test(basename) ? "bash" : "node";
}

export interface InstrumentEntry {
  name: string;        // basename without extension — the `instrument run <name>` handle
  path: string;        // workspace-root-relative script path
  description: string; // the declared "what question this answers"
  kind: string;        // "node" | "bash" — interpreter hint for the run action
}

export interface InstrumentsManifest {
  generatedAt: string;
  root: string;
  total: number;         // derived plugin/scripts script count (never hardcoded)
  admitted: number;      // instruments that declared their question (in the directory)
  notAdmitted: string[]; // plugin/scripts scripts that could not say — kept OUT (the filter is visible)
  instruments: InstrumentEntry[];
}

/** Derive the plugin/scripts instrument directory. Cheap: filesystem scan + header read, no transcripts. */
export function buildInstrumentsManifest(root: string): InstrumentsManifest {
  const { scripts } = enumerateScripts(root);
  const pluginScripts = scripts
    .filter((s) => s.category === "plugin-scripts" && isScriptFile(s.basename))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
  const instruments: InstrumentEntry[] = [];
  const notAdmitted: string[] = [];
  for (const s of pluginScripts) {
    let src = "";
    try {
      src = fs.readFileSync(path.join(root, s.realPath), "utf8");
    } catch {
      src = "";
    }
    const description = extractInstrumentDeclaration(src, s.basename);
    if (description) {
      instruments.push({
        name: s.basename.replace(/\.[^.]+$/, ""),
        path: s.realPath,
        description,
        kind: instrumentKind(s.basename),
      });
    } else {
      notAdmitted.push(s.realPath);
    }
  }
  instruments.sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: new Date().toISOString(),
    root,
    total: pluginScripts.length,
    admitted: instruments.length,
    notAdmitted,
    instruments,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────

function parseArgv(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq !== -1) {
        out[key.slice(0, eq)] = key.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        out[key] = argv[++i];
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function defaultSessionsDir(root: string): string {
  // ~/.claude/projects/-<root-with-dashes>
  const base = path.join(os.homedir(), ".claude", "projects");
  const mangled = "-" + root.replace(/\//g, "-");
  return path.join(base, mangled);
}

export function main(argv: string[]): number {
  const args = parseArgv(argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(args.root ?? path.resolve(here, "..", ".."));
  // --instruments-json: the entry-point directory (gap-eighty-one-instruments...). Cheap (filesystem
  // scan + header reads only — NO transcript reading), so it is the mode the Core `instrument` MCP
  // tool spawns for `action: "list"`. The count is derived, never hardcoded.
  if (args["instruments-json"] === "true") {
    process.stdout.write(JSON.stringify(buildInstrumentsManifest(root), null, 2) + "\n");
    return 0;
  }
  const since = args.since ?? DEFAULT_SINCE;
  const until = args.until ?? new Date().toISOString();
  const longHours = Number(args["long-hours"] ?? DEFAULT_LONG_HOURS);
  const sessionsDir = args["sessions-dir"] ? path.resolve(args["sessions-dir"]) : defaultSessionsDir(root);
  const noWrite = args["no-write"] === "true";
  const asJson = args["json"] === "true";
  // When run INSIDE a top-level Claude Code session (not a subagent), exclude that session's own
  // top-level transcript so the tool never counts its own invocation commands as execution evidence.
  // A subagent run does NOT auto-exclude the parent session (the parent IS the inner layer) — its
  // own in-flight commands are timestamped after the run's --until, so they stay out naturally.
  const excludeSessions = new Set((args["exclude-session"] ?? "").split(",").filter(Boolean));
  if (process.env.CLAUDE_CODE_SESSION_ID && !process.env.CLAUDE_CODE_CHILD_SESSION) {
    excludeSessions.add(process.env.CLAUDE_CODE_SESSION_ID);
  }
  // --inner-sessions restricts the MAIN window to the fast-mode inner-layer sessions (the outer
  // tick/analyst session is deliberately NOT inner). The long contrast window is always broad.
  const innerSessions = new Set((args["inner-sessions"] ?? "").split(",").filter(Boolean));

  const inv = buildInventory(root, sessionsDir, since, until, longHours, { excludeSessions, innerSessions });

  if (asJson) {
    process.stdout.write(JSON.stringify(inv, null, 2) + "\n");
  } else {
    const outDir = path.join(root, "docs", "analysis");
    if (!noWrite) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "runtime-usage-inventory.json"), JSON.stringify(inv, null, 2) + "\n");
      fs.writeFileSync(path.join(outDir, "runtime-usage-inventory.md"), renderMarkdown(inv));
    }
    const s = inv.summary;
    console.log(`runtime-usage-inventory: ${inv.scriptsTotal} scripts (${inv.rawEntries} raw) | ` +
      `live ${s.byClass.live} · library ${s.byClass.library} · ci-only ${s.byClass["ci-only"]} · ` +
      `dormant ${s.byClass["dormant-by-decision"]} · never-runs-test ${s.byClass["never-runs-test"]} · ` +
      `unaccounted ${s.byClass.unaccounted}`);
    if (!noWrite) console.log(`wrote docs/analysis/runtime-usage-inventory.{json,md}`);
  }
  return 0;
}

if (process.argv[1] && path.basename(process.argv[1]) === "runtime-usage-inventory.ts") {
  process.exit(main(process.argv.slice(2)));
}
