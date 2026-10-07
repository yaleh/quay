#!/usr/bin/env node
// shipped-shell-reachability.ts — WHICH `.sh` files the artifact must carry, derived from what the
// runtime actually EXECUTES.
//
// (tasks/gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact;
//  GOAL-029 「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」,人 2026-10-07 裁定.)
//
// ── WHY THIS EXISTS (the sibling task narrowed by PATTERN; this one narrows by REACHABILITY) ─────
// `plugin/shipped-set-rules.txt` + `shipped-set-rules.ts` (tasks/gap-shipped-plugin-tree-excludes-…)
// narrowed the artifact by PATTERN: test trees, mutation fixtures, dev-period manifests. That is the
// right shape for "dev-only by KIND". It cannot express "dev-only by REACHABILITY": on the 0.17.0
// artifact the tree still carried 184 `.sh` / 36,910 lines, of which 90 files / 28,642 lines were
// neither test nor fixture — they were release/delivery/verification tooling for channels that no
// longer exist, and retired classic-pipeline gates nothing calls. A filename list cannot express that
// either: it goes stale the moment a script is renamed, and it answers "did I remember every file?"
// instead of "can anything reach this file?" (硬规则 5).
//
// ── THE DERIVATION (roots → execution closure), never a filename list ────────────────────────────
// A `.sh` SHIPS iff some ROOT actually executes it, directly or through a chain of executing files.
// The roots are exactly the surfaces the runtime can start from:
//   · `plugin/bin/quay` + `plugin/.mcp.json`  — the CLI/MCP entry forms
//   · fenced command blocks in `plugin/skills/**` and `plugin/loop/**`  — what an agent is told to run
//   · `plugin/workflows/**`  — what a workflow issues
//   · `packages/*/src/**`  — the Core literals (`resolvePluginScript*` / `resolveKernelShellSibling`
//     call sites and their `*_REL` constants)
//   · `plugin/scripts/dist/**` + `plugin/gate-scripts/dist/**` (when built)  — the bundled entrypoints
//   · `plugin/scripts/capability-catalog-declarations.json`  — the scripts the CATALOG declares.
//     ⛔ These are the `quay instrument` surface: a checker is a PRODUCT FEATURE (the task's AC2 red
//     control pins this) and must never fall out merely because its name ends in `-check.sh`.
// ⛔ DELIBERATELY NOT A ROOT: "any file that mentions the name". That is the text closure this task
//    replaces — it counts prose, ledger entries and catalog prose as if they were calls, and it
//    over-selects exactly the dev tooling that must leave (measured 2026-10-07: a mention-closure
//    kept 85 of 90; the execution closure below keeps 75). The difference is the point.
//
// ── EXCEPTIONS ARE DECLARED, WITH A REASON — never a silent list ─────────────────────────────────
// `UNSHIPPED_BY_DECISION` is the ONLY hand-written exclusion, and every entry carries why. It exists
// because reachability alone cannot express "this tool would be reachable, but the thing it serves no
// longer exists". It is deliberately small; a new entry is a decision, not a maintenance chore.
//
// ── THREE-VALUED (硬规则 3b) ─────────────────────────────────────────────────────────────────────
// `evaluated:false` when a root surface or the candidate set cannot be read. An empty reachable set
// is NOT "nothing ships"; it is reported, never folded into a pass.
//
// CLI:
//   node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --print-excludes [--repo-root <dir>]
//   node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --json [--repo-root <dir>]
//   node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --check <artifactDir> [--repo-root <dir>]
// exit 0 = reading produced (and, for --check, the artifact is within it) · 1 = the artifact carries an
// unreachable `.sh` · 2 = NOT-EVALUATED (a root surface or the rule set could not be read).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { parseRules, isExcluded, type ShippedSetRule } from "./shipped-set-rules.ts";

// ── the declared exceptions (the ONLY hand-written exclusion; every entry says WHY) ──────────────
//
// ⛔ Reachability cannot see that the CHANNEL a tool serves was cancelled, so this list has to exist.
// It stays small on purpose: an entry is a human decision, and the task's AC3 requires each one to
// carry its reason into the completion record.
export const UNSHIPPED_BY_DECISION: Readonly<Record<string, string>> = {
  "scripts/verify-deliver-coldstart.sh":
    "serves the npm/tgz delivery channel, cancelled by human ruling 2026-09-16 — the channel it verifies no longer exists",
  "scripts/develop-deliver-tgz.sh":
    "serves the npm/tgz delivery channel, cancelled by human ruling 2026-09-16 — the channel it builds no longer exists",
  "scripts/deliver-verify-usage.sh":
    "serves the npm/tgz delivery channel, cancelled by human ruling 2026-09-16 — it runs the post-tgz-install usage probe on a target machine, and the only thing that invokes it (develop-deliver-tgz.sh) is itself unshipped",
};

/** Root surfaces, relative to the repo root. Absent ones are skipped (a shipped install has no
 *  `plugin/scripts/dist`, a synthetic stub may have no `packages/`). */
const SKILL_DOC_DIRS = ["plugin/skills", "plugin/loop"] as const;
const CODE_ROOT_DIRS = ["plugin/workflows"] as const;
const DIST_DIRS = ["plugin/scripts/dist", "plugin/gate-scripts/dist"] as const;
const CORE_SRC_DIRS = ["packages/quay/src", "packages/quay-native/src", "packages/quay-github/src"] as const;

const CATALOG_FILE_REL = "plugin/scripts/capability-catalog-declarations.json";

/** Directories never walked: build output, deps, and the trees the shipped-set rules already exclude
 *  (walking them would only re-derive what `shipped-set-rules.txt` says, from a second place). */
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "vendor",
  "test",
  "tests",
  "fixtures",
  "checker-mutation-cases",
]);

const SH_TOKEN_RE = /[\w./${}-]+\.sh\b/g;

/** A `.sh` reference in a SHELL file or a fenced doc block counts only at a COMMAND POSITION:
 *  preceded (on its line) by an interpreter / `.`, or standing as the line's own command word. */
const EXEC_PREFIX_RE = /(?:^|[\s;&|()`])(?:bash|sh|zsh|source|exec|\.)\s+[^\s;&|)`]*$/;
const BARE_CMD_BEFORE_RE = /^[ \t]*["'`]?$/;
const BARE_CMD_AFTER_RE = /^["'`]?[ \t]*(?:$|[-|>&])/;

/** A `.sh` reference in CODE counts only when it is a whole-string PATH literal, or when the line
 *  carries one of the calls that actually starts a process. Both shapes are deliberate: a `.sh` name
 *  inside prose, a doc-comment, or a longer sentence-in-a-string is not a call — that is precisely
 *  the over-selection this module replaces (硬规则 2 — 按位置判定，不按关键词). */
const CODE_CALLEE_RE =
  /\b(?:path\.join|resolvePluginScript|resolvePluginScriptExec|runPluginScript|spawnSync|execFileSync|execSync|spawn|execFile)\s*\(/;
const CODE_STRING_PATH_RE = /["'`]([^"'`\n]*?\.sh)["'`]/g;

/** The `.sh` tokens a shell text EXECUTES (comment lines dropped first). */
export function shellExecRefs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = /^\s*#/.test(raw) ? "" : raw;
    if (line === "") continue;
    for (const m of line.matchAll(SH_TOKEN_RE)) {
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      if (EXEC_PREFIX_RE.test(before) || (BARE_CMD_BEFORE_RE.test(before) && BARE_CMD_AFTER_RE.test(after))) {
        out.push(m[0]);
      }
    }
  }
  return out;
}

/** The `.sh` tokens a code text EXECUTES. Comments are dropped; then a line either carries a
 *  process-starting call (every `.sh` on it counts) or must offer a whole-string path literal. */
export function codeExecRefs(text: string): string[] {
  const out: string[] = [];
  for (const line of stripJsComments(text).split("\n")) {
    if (CODE_CALLEE_RE.test(line)) {
      for (const m of line.matchAll(SH_TOKEN_RE)) out.push(m[0]);
    } else {
      for (const m of line.matchAll(CODE_STRING_PATH_RE)) out.push(m[1]);
    }
  }
  return out;
}

export interface ReachabilityReading {
  /** false ⇒ NOT a "nothing ships" reading (硬规则 3b). */
  evaluated: boolean;
  reason: string | null;
  /** artifact-relative `.sh` paths a root executes (directly or transitively), sorted. */
  reachable: string[];
  /** candidate `.sh` paths NO root reaches — these must not be in the artifact. */
  unreachable: string[];
  /** one line of WHY per unreachable path (a declared decision, or "no executing reference"). */
  unreachableReasons: Record<string, string>;
  /** one line of WHY per reachable path (which root/edge selected it) — the closure's own trace. */
  reachableReasons: Record<string, string>;
  /** how many root files were read (0 ⇒ the derivation saw nothing; never read as "clean"). */
  rootFiles: number;
  /** how many rules were in force when the candidate set was computed. */
  rulesInForce: number;
}

function notEvaluated(reason: string): ReachabilityReading {
  return {
    evaluated: false,
    reason,
    reachable: [],
    unreachable: [],
    unreachableReasons: {},
    reachableReasons: {},
    rootFiles: 0,
    rulesInForce: 0,
  };
}

function readText(abs: string): string {
  try {
    if (fs.statSync(abs).size > 4_000_000) return "";
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

/** Every file under `dir`, repo-relative POSIX paths. `skipDirs` is matched on the BASENAME. */
function walkFiles(absDir: string, skipDirs: ReadonlySet<string>, out: string[] = [], relPrefix = ""): string[] {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirents) {
    const rel = relPrefix === "" ? d.name : `${relPrefix}/${d.name}`;
    if (d.isDirectory()) {
      if (skipDirs.has(d.name)) continue;
      walkFiles(path.join(absDir, d.name), skipDirs, out, rel);
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** Shell comment lines are dropped before matching (a `.sh` named in a comment is prose, not a call).
 *  Whole-line comments only: a trailing `#` heuristic would eat `#` inside strings and URLs. */
function stripShellCommentLines(text: string): string {
  return text
    .split("\n")
    .map((l) => (/^\s*#/.test(l) ? "" : l))
    .join("\n");
}

/** JS/TS comments are dropped before matching — the same reason, and the reason the closure reads
 *  `.ts` sources at all: a name in a doc-comment is not a call (硬规则 2). */
function stripJsComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** The bodies of fenced code blocks only. Prose in a skill that names a script is NOT a command the
 *  agent is told to run — only a fenced command is. */
function fencedBodies(markdown: string): string {
  const out: string[] = [];
  const re = /^```[^\n]*\n([\s\S]*?)^```/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) out.push(m[1]);
  return out.join("\n");
}

/**
 * Resolve a textual `.sh` token to a candidate path.
 *
 * A token carrying a directory component resolves to the LONGEST suffix that names a candidate
 * (`${PLUGIN_ROOT}/scripts/x.sh` → `scripts/x.sh`, `plugin/gate-scripts/y.sh` → `gate-scripts/y.sh`).
 * A BARE basename prefers `scripts/` — the plugin-script root the Core resolver and the catalog use —
 * and only falls back to `gate-scripts/` / the plugin root when no `scripts/` file carries that name.
 * ⛔ Never "whatever candidate has this basename": `it0-impl-row-check.sh` exists in BOTH roots, and
 * collapsing them would silently mark the retired gate as reached by the live script's name (or the
 * reverse) — a false reading in whichever direction the map happened to be built.
 */
export function resolveRef(token: string, candidates: ReadonlySet<string>): string | null {
  const s = token.replace(/^\.\//, "");
  const parts = s.split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join("/");
    if (candidates.has(suffix)) return suffix;
  }
  // A LITERAL directory that named no candidate is a NO, not an invitation to guess by basename:
  // `experiments/…/scripts/it0-ceiling-check.sh` must not resolve to the plugin's own gate of that
  // name. A VARIABLE / placeholder directory (`$SCRIPT_DIR/`, `${PLUGIN_ROOT}/`) carries no
  // information, so the basename is the only thing left to resolve against.
  const literalDir = !/[$<>{}]/.test(s.slice(0, s.lastIndexOf("/") === -1 ? 0 : s.lastIndexOf("/")));
  if (literalDir && s.includes("/")) return null;
  const b = path.basename(s);
  for (const prefix of ["scripts/", "gate-scripts/", ""]) {
    if (candidates.has(prefix + b)) return prefix + b;
  }
  return null;
}

/** The catalog's declared question-holders — the `quay instrument` surface. A missing/unparseable
 *  catalog is a NOT-EVALUATED root surface, never an empty one (硬规则 3b). */
function readCatalogDeclaredScripts(catalogAbs: string): { ok: boolean; basenames: Set<string>; notShipped: Set<string> } {
  const text = readText(catalogAbs);
  if (text === "") return { ok: false, basenames: new Set(), notShipped: new Set() };
  try {
    const parsed = JSON.parse(text) as { QUESTION?: Record<string, unknown>; NOT_SHIPPED?: Record<string, unknown> };
    const q = parsed.QUESTION;
    if (!q || typeof q !== "object") return { ok: false, basenames: new Set(), notShipped: new Set() };
    return {
      ok: true,
      basenames: new Set(Object.keys(q)),
      notShipped: new Set(Object.keys(parsed.NOT_SHIPPED ?? {})),
    };
  } catch {
    return { ok: false, basenames: new Set(), notShipped: new Set() };
  }
}

/** The candidate `.sh`: every `.sh` under the plugin root that the shipped-set rules do NOT already
 *  exclude. ⛔ Reuses `shipped-set-rules.ts`'s matcher — one definition of "dev-only by kind", so this
 *  module's candidate set and the assembly step's rsync excludes can never drift (硬规则 5b). */
export function candidateShells(repoRoot: string, rules: readonly ShippedSetRule[]): string[] {
  const pluginRoot = path.join(repoRoot, "plugin");
  const out: string[] = [];
  for (const rel of walkFiles(pluginRoot, SKIP_DIR_NAMES)) {
    if (!rel.endsWith(".sh")) continue;
    if (isExcluded(rel, false, rules)) continue;
    out.push(rel);
  }
  return out.sort();
}

/**
 * Derive the runtime-reachable `.sh` set. Pure filesystem reads; no network, no spawn.
 * @param repoRoot the SOURCE repo root (holds `plugin/` and `packages/`)
 * @param overrides test seam for the two ROOT-side inputs a red control must be able to perturb:
 *        `catalog` (the declared-instrument root) and `unshippedByDecision`. Production callers pass
 *        neither — the defaults are the real files. ⛔ The artifact-side reading never uses this seam.
 */
export interface DeriveOverrides {
  catalog?: { basenames: Set<string>; notShipped: Set<string> };
  unshippedByDecision?: Readonly<Record<string, string>>;
}

export function deriveReachability(repoRoot: string, overrides: DeriveOverrides = {}): ReachabilityReading {
  const pluginRoot = path.join(repoRoot, "plugin");
  if (!fs.existsSync(pluginRoot)) return notEvaluated(`the source plugin tree is missing (${pluginRoot})`);

  let rules: ShippedSetRule[];
  try {
    rules = parseRules(fs.readFileSync(path.join(pluginRoot, "shipped-set-rules.txt"), "utf8"));
  } catch (err) {
    return notEvaluated(`the shipped-set rule file is unreadable: ${(err as Error).message.split("\n")[0]}`);
  }
  if (rules.length === 0) {
    return notEvaluated("the shipped-set rule file parsed to ZERO rules — the candidate set would be undefined");
  }

  const candidates = new Set(candidateShells(repoRoot, rules));
  if (candidates.size === 0) {
    return notEvaluated(`no candidate .sh under ${pluginRoot} — an empty candidate set is not a clean derivation`);
  }

  const reachable = new Map<string, string>();
  let rootFiles = 0;

  const unshipped = overrides.unshippedByDecision ?? UNSHIPPED_BY_DECISION;
  const add = (rel: string | null, why: string): boolean => {
    if (rel === null) return false;
    if (unshipped[rel]) return false;
    if (reachable.has(rel)) return false;
    reachable.set(rel, why);
    return true;
  };

  // add every resolvable reference an extractor yields. Returns true when something new landed.
  const scanRefs = (refs: readonly string[], why: string): boolean => {
    let added = false;
    for (const r of refs) if (add(resolveRef(r, candidates), why)) added = true;
    return added;
  };
  const scanShell = (text: string, why: string): boolean => scanRefs(shellExecRefs(text), why);
  const scanCode = (text: string, why: string): boolean => scanRefs(codeExecRefs(text), why);

  // ── roots ──────────────────────────────────────────────────────────────────────────────────────
  const catalog = overrides.catalog ? { ok: true, ...overrides.catalog } : readCatalogDeclaredScripts(path.join(repoRoot, CATALOG_FILE_REL));
  if (!catalog.ok) {
    return notEvaluated(
      `the capability-catalog declarations are unreadable (${path.join(pluginRoot, "scripts", "capability-catalog-declarations.json")}) — the instrument root would be silently empty`,
    );
  }
  for (const b of catalog.basenames) {
    if (!b.endsWith(".sh")) continue;
    if (catalog.notShipped.has(b)) continue; // the catalog's own "ships: false" judgement
    add(candidates.has(`scripts/${b}`) ? `scripts/${b}` : null, "catalog:QUESTION");
  }

  const scanDocRoots = (relDir: string, label: string): void => {
    for (const rel of walkFiles(path.join(repoRoot, relDir), SKIP_DIR_NAMES)) {
      if (!rel.endsWith(".md")) continue;
      rootFiles++;
      scanShell(fencedBodies(readText(path.join(repoRoot, relDir, rel))), `${label}:${rel}`);
    }
  };
  for (const d of SKILL_DOC_DIRS) if (fs.existsSync(path.join(repoRoot, d))) scanDocRoots(d, d);

  for (const d of CODE_ROOT_DIRS) {
    const abs = path.join(repoRoot, d);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walkFiles(abs, SKIP_DIR_NAMES)) {
      if (!/\.(js|mjs|ts)$/.test(rel)) continue;
      rootFiles++;
      scanCode(readText(path.join(abs, rel)), `${d}:${rel}`);
    }
  }

  for (const d of DIST_DIRS) {
    const abs = path.join(repoRoot, d);
    if (!fs.existsSync(abs)) continue; // built form — absent in a fresh checkout, equivalent when present
    for (const rel of walkFiles(abs, SKIP_DIR_NAMES)) {
      if (!rel.endsWith(".js")) continue;
      rootFiles++;
      scanCode(readText(path.join(abs, rel)), `${d}:${rel}`);
    }
  }

  for (const d of CORE_SRC_DIRS) {
    const abs = path.join(repoRoot, d);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walkFiles(abs, SKIP_DIR_NAMES)) {
      if (!/\.(ts|mjs|js)$/.test(rel)) continue;
      rootFiles++;
      scanCode(readText(path.join(abs, rel)), `core:${d}/${rel}`);
    }
  }

  const mcp = readText(path.join(pluginRoot, ".mcp.json"));
  if (mcp !== "") {
    rootFiles++;
    scanCode(mcp, "plugin/.mcp.json");
  }

  // ── the execution closure ─────────────────────────────────────────────────────────────────────
  // A reachable file is itself an executing surface, and a Core source file is one by construction.
  // Iterate to a fixpoint so a chain (skill → a.sh → b.sh) lands. Bounded: each round either adds a
  // reachable `.sh` or stops, and no `.sh` is scanned twice.
  const coreFiles: string[] = [];
  for (const d of CORE_SRC_DIRS) {
    const abs = path.join(repoRoot, d);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walkFiles(abs, SKIP_DIR_NAMES)) if (/\.(ts|mjs|js)$/.test(rel)) coreFiles.push(path.join(abs, rel));
  }
  const declaredTs: string[] = [];
  for (const b of catalog.basenames) {
    if (!/\.(ts|mjs|js)$/.test(b)) continue;
    const abs = path.join(pluginRoot, "scripts", b);
    if (fs.existsSync(abs)) declaredTs.push(abs);
  }
  const scanned = new Set<string>();
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (const rel of [...reachable.keys()]) {
      if (scanned.has(rel)) continue;
      scanned.add(rel);
      if (scanShell(readText(path.join(pluginRoot, rel)), `closure:${rel}`)) changed = true;
    }
    for (const abs of coreFiles) {
      const key = `core:${abs}`;
      if (scanned.has(key)) continue;
      scanned.add(key);
      if (scanCode(readText(abs), `closure:${path.relative(repoRoot, abs)}`)) changed = true;
    }
    for (const abs of declaredTs) {
      const key = `ts:${abs}`;
      if (scanned.has(key)) continue;
      scanned.add(key);
      if (scanCode(readText(abs), `closure:${path.relative(repoRoot, abs)}`)) changed = true;
    }
    if (!changed) break;
  }

  const reachableList = [...reachable.keys()].sort();
  const unreachable = [...candidates].filter((c) => !reachable.has(c)).sort();
  const unreachableReasons: Record<string, string> = {};
  for (const rel of unreachable) {
    unreachableReasons[rel] = unshipped[rel] ?? "no executing reference from any root (无引用)";
  }
  return {
    evaluated: true,
    reason: null,
    reachable: reachableList,
    unreachable,
    unreachableReasons,
    reachableReasons: Object.fromEntries([...reachable.entries()].sort()),
    rootFiles,
    rulesInForce: rules.length,
  };
}

/** The rsync-ready artifact-relative paths the assembly step must NOT copy. */
export function shippedShellExcludes(reading: ReachabilityReading): string[] {
  return reading.unreachable;
}

// ── the release-gate assertion (mirrors judgeShippedSetClean's shape) ─────────────────────────────

export interface ShellReachabilityVerdict {
  id: "shipped-shell-reachable";
  state: "PASS" | "FAIL" | "NOT-EVALUATED";
  detail: string;
}

/** Every `.sh` PRESENT in an artifact must be one the runtime can reach. The reading of the artifact
 *  is a walk of `artifactRoot` itself — never a number the artifact reports about itself (硬规则 4b). */
export function judgeShellReachability(artifactRoot: string, reading: ReachabilityReading): ShellReachabilityVerdict {
  const id = "shipped-shell-reachable" as const;
  if (!reading.evaluated) {
    return { id, state: "NOT-EVALUATED", detail: reading.reason ?? "the reachable shell set could not be derived" };
  }
  const reachable = new Set(reading.reachable);
  const present: string[] = [];
  for (const rel of walkFiles(artifactRoot, new Set([".git"]))) {
    if (rel.endsWith(".sh")) present.push(rel);
  }
  const stray = present.filter((r) => !reachable.has(r)).sort();
  if (stray.length > 0) {
    const named = stray.slice(0, 8).join(", ");
    return {
      id,
      state: "FAIL",
      detail: `${stray.length} .sh file(s) in the artifact no runtime surface reaches: ${named}${stray.length > 8 ? ", …" : ""} — the assembly step shipped tooling nothing executes (plugin/scripts/publish-dist-branch.sh + plugin/scripts/shipped-shell-reachability.ts)`,
    };
  }
  return {
    id,
    state: "PASS",
    detail: `all ${present.length} artifact .sh file(s) are reachable from the runtime roots (${reading.reachable.length} reachable, ${reading.rootFiles} root file(s) read)`,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `shipped-shell-reachability.ts — which .sh files the artifact must carry, by execution reachability.

Usage:
  node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --print-excludes [--repo-root <dir>]
  node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --json [--repo-root <dir>]
  node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --check <artifactDir> [--repo-root <dir>]

  --print-excludes     one artifact-relative path per line — the .sh a root does NOT execute, for the
                       assembly step to --exclude (publish-dist-branch.sh consumes exactly this)
  --check <dir>        assert every .sh PRESENT in <dir> is reachable
  --json               the full reading (reachable / unreachable / why, per path)
  --repo-root <dir>    the source repo root (default: two levels above this file)

Exit: 0 = derived (and, for --check, the artifact is within it) · 1 = --check found an unreachable .sh
      2 = NOT-EVALUATED (a root surface or the rule set could not be read)`;

export function defaultRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here = <repo>/plugin/scripts (source) or <repo>/plugin/scripts/dist (bundled)
  const pluginRoot = path.basename(here) === "dist" ? path.dirname(here) : here;
  return path.dirname(path.dirname(pluginRoot));
}

export function main(argv: string[]): number {
  const repoRoot = path.resolve(flagValue(argv, "--repo-root") ?? defaultRepoRoot());
  const reading = deriveReachability(repoRoot);
  if (argv.includes("--print-excludes")) {
    if (!reading.evaluated) {
      console.error(`shipped-shell-reachability: NOT-EVALUATED — ${reading.reason}`);
      return 2;
    }
    for (const rel of shippedShellExcludes(reading)) console.log(rel);
    return 0;
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify(reading, null, 2));
    return reading.evaluated ? 0 : 2;
  }
  const artifact = flagValue(argv, "--check");
  if (artifact !== undefined) {
    const verdict = judgeShellReachability(path.resolve(artifact), reading);
    console.log(`shipped-shell-reachability: ${verdict.state} — ${verdict.detail}`);
    if (verdict.state === "PASS") return 0;
    return verdict.state === "FAIL" ? 1 : 2;
  }
  console.log(USAGE);
  return 2;
}

if (isDirectEntry(import.meta, process.argv[1], "shipped-shell-reachability")) process.exit(main(process.argv.slice(2)));
