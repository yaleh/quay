// uncalled-verifier-check.ts — gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check.
//
// THE DEFECT CLASS THIS KILLS: SHIPPED-BUT-UNCALLED verifiers. A verifier exists, is correct, is
// shipped — and nothing invokes it. A NAIVE grep cannot see this class, because the verifier's own
// file, its own test, and pure description strings (capability-catalog.sh entries, task-body Contract
// "invoke" lines) all count as "mentions" — the grep returns non-zero and the thing looks wired.
// The real question (the task's core): does a loop doc / gate / CI job / script actually EXECUTE it?
//
// WHAT THIS CHECK DOES: for every executable verifier under plugin/scripts/ (the same derived set the
// capability catalog enumerates — `plugin/scripts/*.{sh,ts,mjs}`), determine whether it has an
// EXECUTION-TYPE call site. The following do NOT count as call sites:
//   (a) the file itself (incl. symlink mirrors, deduped by realpath),
//   (b) its own plugin/test/<same-name>.test.mjs,
//   (c) pure description strings — capability-catalog.sh entries, prose docs, task bodies.
//
// EXECUTION SURFACES scanned (files that can actually RUN a script — the same 4-surface discipline
// as gate-dispatch-coverage.ts, widened to the loop-doc/skill surfaces the task names):
//   scripts/*.{sh,ts,mjs}                     — the canonical test.sh + repo-level gates
//   plugin/scripts/*.{sh,ts,mjs}              — sibling invocations (${SCRIPT_DIR}/x / bash "…/x")
//   test/*.{sh,ts,mjs}                        — the repo's own orchestration/e2e scripts (cold-start e2e)
//   .github/workflows/*.{yml,yaml}            — CI jobs
//   plugin/workflows/*.js  .claude/workflows/*.js — workflow phases
//   plugin/loop/*.md  plugin/skills/*/SKILL.md — the loop tick docs + skills (a "tick 步骤" call site)
//   .quay/config.yml                           — provider mcp_entry / gate command wiring
//   experiments/*/scripts/*.{sh,ts,mjs}        — the live experiment layer's own exec paths
//   NOT scanned: tasks/*, docs/*, orchestration/*, adr/*, milestones/*, packages/*, plugin/test/*
//   (a verifier executed ONLY by a node:test file is NOT executed in production — plugin/test/* is
//   deliberately NOT a surface; a verifier's own test is excluded explicitly per the task, and this
//   is the conservative direction: it can only over-report uncalled, never hide one).
//
// A reference counts as EXECUTION-TYPE when the referencing line carries an execution construct
// (bash/node/sh/exec/source/spawn/execFile/execSync/fork/import/require/run:/mcp_entry) OR the
// ScriptDir sibling-invocation convention (`${SCRIPT_DIR}/<name>` / `$SCRIPT_DIR/<name>` /
// `$(dirname "$0")/<name>`) OR a path-capture that the same file later executes (`path.join(__dirname,
// "<name>")` + an exec primitive) — see `classifyFile`. The basename is matched as a whole token, so
// a prose mention of `resource-gate` (no `.sh`) never matches `resource-gate.sh`.
//
// EXEMPTIONS — plugin/uncalled-verifier-exemptions.txt, a SHRINK-ONLY ratchet with the SAME shape as
// test-framework-policy-exemptions.txt: a `# baseline-count: <n>` ceiling (commit-surviving — the
// list can never exceed it, even at a clean commit) + a git-HEAD strict-subset (an entry ADDED in the
// working tree that is not in the committed baseline fails before it can land). An exempted entry
// whose file NOW HAS a call site is stale (C2c) — wire the verifier, then REMOVE its exemption line.
//
// Contract (task gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check):
//   measure   uncalled_verifiers = --json 输出的 uncalled 数组长度
//   band      uncalled_verifiers = 0（豁免名单内的不计）
//   measure   mentions_not_counted = --json 输出的 mentions_excluded 布尔字段
//   band      mentions_not_counted = 1
//   invariant 一个被裁定为"权威/单一事实源"的检查器，必须存在至少一个执行型调用点；能力目录条目和自带测试都不构成调用点
//   invoke    node --experimental-strip-types plugin/scripts/uncalled-verifier-check.ts --json
//   control   给一个当前有调用点的检查器（如 resource-gate.sh）临时摘掉其唯一执行调用点，只留
//             capability-catalog 条目与自带测试 ⇒ 该检查必须把它报为 uncalled；若报绿，说明"提及"
//             仍然在冒充调用点，本机制无效
//
// Usage:
//   node --experimental-strip-types plugin/scripts/uncalled-verifier-check.ts [--root <dir>] [--json]
// Exit: 0 = PASS (no un-exempted uncalled verifier, ratchet intact); 1 = violations; 2 = usage/root error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The exemptions data file, repo-root-relative (a data file, never scattered code — same discipline
// as test-framework-policy-exemptions.txt).
export const EXEMPTIONS_REL = "plugin/uncalled-verifier-exemptions.txt";

export const VERIFIER_EXT_RE = /\.(?:sh|ts|mjs)$/;
export const SURFACE_FILE_RE = /\.(?:sh|ts|mjs|js|yml|yaml|md)$/;
export const CATALOG_REL = "plugin/scripts/capability-catalog.sh";

// ── repo-root discovery ──────────────────────────────────────────────────────────────────────────────

/** Walk up from the script's own location to the bundle root (package.json + plugin/ + scripts/test.sh). */
export function findRepoRoot(startDir = __dirname): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, "package.json")) &&
      fs.existsSync(path.join(dir, "plugin")) &&
      fs.existsSync(path.join(dir, "scripts", "test.sh"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find bundle root (package.json + plugin/ + scripts/test.sh) upward from " + startDir);
}

// ── execution surfaces ────────────────────────────────────────────────────────────────────────────────

/** Collect the execution-surface files under `root` (the files that can actually RUN a script). */
export function collectSurfaces(root: string): string[] {
  const out: string[] = [];
  const addDir = (dir: string, re: RegExp) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (re.test(f)) out.push(p);
    }
  };
  addDir(path.join(root, "scripts"), /\.(?:sh|ts|mjs)$/);
  addDir(path.join(root, "plugin", "scripts"), VERIFIER_EXT_RE);
  addDir(path.join(root, "test"), /\.(?:sh|ts|mjs)$/);
  addDir(path.join(root, ".github", "workflows"), /\.ya?ml$/);
  addDir(path.join(root, "plugin", "workflows"), /\.js$/);
  addDir(path.join(root, ".claude", "workflows"), /\.js$/);
  addDir(path.join(root, "plugin", "loop"), /\.md$/);
  const skillsRoot = path.join(root, "plugin", "skills");
  if (fs.existsSync(skillsRoot)) {
    for (const sub of fs.readdirSync(skillsRoot)) {
      addDir(path.join(skillsRoot, sub), /SKILL\.md$/);
    }
  }
  const expRoot = path.join(root, "experiments");
  if (fs.existsSync(expRoot)) {
    for (const proj of fs.readdirSync(expRoot)) {
      addDir(path.join(expRoot, proj, "scripts"), VERIFIER_EXT_RE);
    }
  }
  const cfg = path.join(root, ".quay", "config.yml");
  if (fs.existsSync(cfg)) out.push(cfg);
  return out;
}

function realpathOf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Dedupe surfaces by realpath (a symlink mirror — e.g. an experiments/ copy of a plugin script — is
 * the same file as its target, so its own basename reference must not count as a self-call either). */
export function dedupeByRealpath(files: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of files) {
    const rp = realpathOf(f);
    if (seen.has(rp)) continue;
    seen.add(rp);
    out.push(f);
  }
  return out;
}

// ── detection ─────────────────────────────────────────────────────────────────────────────────────────

/** A line that is purely a comment / heading / blockquote — never an executable instruction. */
export function isNonCodeLine(line: string, ext: string): boolean {
  const t = line.trimStart();
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("<!--")) return true;
  if (ext === ".md") {
    // headings and blockquotes are prose; bullet steps are kept (they can carry an exec instruction).
    if (t.startsWith("#")) return true;
    if (t.startsWith(">")) return true;
    if (t.startsWith("|")) return true; // a table row is description data, not an instruction
    return false;
  }
  if (t.startsWith("#")) return true; // .sh / .yml comment
  return false;
}

/** Execution construct markers that can accompany a basename reference on a line. The target basename
 * is removed FIRST so its own `.sh`/`.ts` extension cannot satisfy `\bsh\b`; `sh` additionally uses a
 * negative lookbehind so a SIBLING's `.sh` extension on the same line cannot satisfy it either
 * (e.g. `capability-catalog.sh uncalled-verifier-check.ts >> "$out"` is a lay-down, not an execution). */
export const EXEC_MARKER_RE =
  /(\bnode\b|\bbash\b|(?<![.\w])sh\b|\bexec\b|\bsource\b|dirname|\$\(|\brun_check\b|\bspawn\b|\bexecFile\b|\bexecSync\b|\bfork\b|\bimport\b|\brequire\b|\brun:|\bmcp_entry\b)/;

/** The ScriptDir sibling-invocation spellings (the repo's cross-script wiring convention). */
export function scriptDirRef(basename: string): RegExp {
  const esc = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:\\$\\{SCRIPT_DIR\\}|\\$SCRIPT_DIR|dirname "?\\$0|dirname \\$0)/${esc}`);
}

/** Does `line` carry an execution-type reference to `basename`? The basename is matched as a whole
 * token, so a prose mention of `resource-gate` never matches `resource-gate.sh`. */
export function lineExecutes(basename: string, line: string): boolean {
  const re = new RegExp(`\\b${basename.replace(/\./g, "\\.")}\\b`);
  if (!re.test(line)) return false;
  if (scriptDirRef(basename).test(line)) return true;
  const tMinus = line.split(basename).join(" ");
  return EXEC_MARKER_RE.test(tMinus);
}

/** A path-capture line: the basename is captured into a variable / path.join for LATER execution
 * (`const gate = path.join(__dirname, "x.sh")`, `push_script="${SCRIPT_DIR}/x.sh"`). */
export function capturesPath(basename: string, line: string): boolean {
  const re = new RegExp(`\\b${basename.replace(/\./g, "\\.")}\\b`);
  if (!re.test(line)) return false;
  if (scriptDirRef(basename).test(line)) return true; // assignment into a var, executed later
  if (/path\.join\(/.test(line) && (line.includes(`"${basename}"`) || line.includes(`'${basename}'`))) return true;
  if (/=\s*["']?[^"'\n]*plugin\/scripts\//.test(line)) return true; // repo-root-relative path capture
  return false;
}

/** A line that EXECUTES a captured script variable (`bash "${push_script}"`, `execFileSync(gate, …)`,
 * `node "$gate"`, `spawn(gate, …)`) — the second half of the path-capture indirection. */
export const CAPTURED_EXEC_RE =
  /(?:bash|node|sh|source|exec)\s+"?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|(?:execFileSync|spawn|execSync|fork|exec)\s*\(\s*[A-Za-z_][A-Za-z0-9_]*/;

/** Classify one surface file against one verifier basename: true iff the file is an execution-type
 * caller. Self / own-test / capability-catalog exclusions are handled by the caller. */
export function classifyFile(basename: string, surfaceRel: string, text: string): boolean {
  const ext = path.extname(surfaceRel);
  const lines = text.split(/\r?\n/);
  let sawPathCapture = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.includes(basename)) continue;
    if (isNonCodeLine(line, ext)) continue;
    if (lineExecutes(basename, line)) return true;
    if (capturesPath(basename, line)) sawPathCapture = true;
  }
  if (sawPathCapture) {
    for (const raw of lines) {
      const line = raw.trim();
      if (isNonCodeLine(line, ext)) continue;
      if (CAPTURED_EXEC_RE.test(line)) return true;
    }
  }
  return false;
}

// ── exemption ratchet (same shape as test-framework-policy-exemptions.txt) ──────────────────────────

export function parseExemptionList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export function parseBaselineCount(text: string): number | null {
  const m = text.match(/^#\s*baseline-count:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

// ── the core census ───────────────────────────────────────────────────────────────────────────────────

export interface VerifierResult {
  basename: string;
  callers: string[];     // surface files (repo-relative) with an execution-type call site
  mentions: number;      // excluded mentions found (self refs / own test / catalog) — for the measure
  exempted: boolean;
}

export interface Census {
  root: string;
  totalVerifiers: number;
  verifiers: VerifierResult[];
  uncalled: string[];            // measure uncalled_verifiers (un-exempted, no callers)
  exempted: string[];            // on the exemption list (with or without a call site)
  mentionsExcluded: boolean;     // measure mentions_not_counted (band 1)
  mentionsExcludedCount: number;
  callers: Record<string, string[]>;
  exemptionsFile: string;
  baselineCount: number | null;
  ratchetFailures: string[];     // shrink-only ratchet violations (grown list / ceiling / stale)
}

function repoRel(root: string, p: string): string {
  return path.relative(root, p).split(path.sep).join("/");
}

/** Run the census. `exemptionList` = parsed working-tree exemptions; `baselineList` = committed form. */
export function runCensus(root: string, exemptionList: string[]): Census {
  const scriptsDir = path.join(root, "plugin", "scripts");
  const verifierBases = fs
    .readdirSync(scriptsDir)
    .filter((f) => VERIFIER_EXT_RE.test(f) && fs.statSync(path.join(scriptsDir, f)).isFile())
    .sort();

  const exemptSet = new Set(exemptionList.map((e) => {
    // normalize: accept `plugin/scripts/x.ts` or bare `x.ts`
    const base = path.basename(e);
    return base;
  }));

  const surfaces = dedupeByRealpath(collectSurfaces(root));
  const surfaceTexts: { rel: string; text: string }[] = [];
  for (const s of surfaces) {
    try {
      surfaceTexts.push({ rel: repoRel(root, s), text: fs.readFileSync(s, "utf8") });
    } catch {
      /* unreadable surface — skip */
    }
  }

  const verifiers: VerifierResult[] = [];
  let mentionsExcludedCount = 0;

  for (const basename of verifierBases) {
    const stem = basename.replace(VERIFIER_EXT_RE, "");
    const ownRp = realpathOf(path.join(scriptsDir, basename));
    const ownTestRp = realpathOf(path.join(root, "plugin", "test", `${stem}.test.mjs`));
    const callers: string[] = [];
    let mentions = 0;
    for (const surf of surfaceTexts) {
      const rp = realpathOf(path.join(root, surf.rel));
      if (rp === ownRp) { mentions++; continue; }                 // (a) the file itself (incl. mirror)
      if (rp === ownTestRp) { mentions++; continue; }             // (b) its own test
      if (surf.rel === CATALOG_REL) { mentions++; continue; }     // (c) capability-catalog description strings
      if (!surf.text.includes(basename)) continue;
      if (classifyFile(basename, surf.rel, surf.text)) {
        callers.push(surf.rel);
      }
    }
    mentionsExcludedCount += mentions;
    const exempted = exemptSet.has(basename);
    verifiers.push({ basename, callers, mentions, exempted });
  }

  const uncalled = verifiers
    .filter((v) => v.callers.length === 0 && !v.exempted)
    .map((v) => v.basename);
  const exemptedNames = verifiers.filter((v) => v.exempted).map((v) => v.basename);
  const callers: Record<string, string[]> = {};
  for (const v of verifiers) if (v.callers.length > 0) callers[v.basename] = v.callers;

  return {
    root,
    totalVerifiers: verifiers.length,
    verifiers,
    uncalled,
    exempted: exemptedNames,
    mentionsExcluded: mentionsExcludedCount > 0,
    mentionsExcludedCount,
    callers,
    exemptionsFile: EXEMPTIONS_REL,
    baselineCount: null,
    ratchetFailures: [],
  };
}

// ── ratchet validation ────────────────────────────────────────────────────────────────────────────────

export interface RatchetInput {
  root: string;
  currentList: string[];
  baselineList: string[];      // committed form at git HEAD; [] on bootstrap
  baselineCount: number | null; // ceiling parsed from the working-tree data file header
  baselineCountHead: number | null; // ceiling parsed from the HEAD copy
  verifierSet: Set<string>;    // current plugin/scripts basenames
  hasCallSite: (basename: string) => boolean; // does the verifier now have an execution call site?
}

/** Run the shrink-only ratchet checks. Returns violation strings; [] = PASS. Mirrors
 * test-framework-policy-check.ts's C0/C2 shape. */
export function runRatchetChecks(i: RatchetInput): string[] {
  const failures: string[] = [];
  const currentSet = new Set(i.currentList);
  const baselineSet = new Set(i.baselineList);
  const bootstrap = i.baselineList.length === 0;

  // C0: commit-surviving ceiling — the list can never exceed `# baseline-count`.
  if (i.baselineCount !== null && i.currentList.length > i.baselineCount) {
    failures.push(
      `ratchet: the exemption list has ${i.currentList.length} entries, over the ceiling of ${i.baselineCount} (${EXEMPTIONS_REL} header "# baseline-count"). The list can only get SHORTER.`
    );
  }
  // C0b: the ceiling itself is shrink-only.
  if (!bootstrap && i.baselineCountHead !== null && i.baselineCount !== null && i.baselineCount > i.baselineCountHead) {
    failures.push(
      `ratchet: the ceiling was RAISED from ${i.baselineCountHead} to ${i.baselineCount} — the ceiling is shrink-only (it can only get LOWER).`
    );
  }
  if (!bootstrap) {
    // C2a: an entry ADDED in the working tree (not in the committed baseline) — catches same-count swaps.
    for (const rel of i.currentList) {
      const base = path.basename(rel);
      if (!baselineSet.has(rel) && ![...baselineSet].some((b) => path.basename(b) === base)) {
        failures.push(
          `ratchet: ${rel} was ADDED to the exemption list — the list can only get SHORTER. Wire the verifier instead; there is no way to exempt a newly-uncalled verifier.`
        );
      }
    }
  }
  // C2b / C2c / C2d — every entry must be a real, still-uncalled, verifier-set file.
  for (const rel of i.currentList) {
    const base = path.basename(rel);
    if (!i.verifierSet.has(base)) {
      failures.push(
        `ratchet: exemption entry ${rel} names ${base}, which is not in the verifier set (plugin/scripts/*.{sh,ts,mjs}) — remove it.`
      );
      continue;
    }
    if (i.hasCallSite(base)) {
      failures.push(
        `ratchet: exemption entry ${rel} now HAS an execution call site — the verifier was wired but the list was not shortened. Remove it (the list only shrinks).`
      );
    }
  }
  return failures;
}

// ── git baseline resolution ───────────────────────────────────────────────────────────────────────────

function gitShowFile(root: string, ref: string, rel: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "show", `${ref}:${rel}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function gitHeadExists(root: string): boolean {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

// ── output ────────────────────────────────────────────────────────────────────────────────────────────

export function formatHuman(c: Census): string {
  const lines: string[] = [];
  lines.push(`uncalled-verifier-check — ${c.totalVerifiers} verifiers under ${c.root}`);
  lines.push(`mentions_excluded=${c.mentionsExcluded ? "1" : "0"} (${c.mentionsExcludedCount} self/own-test/catalog mentions excluded from call-site counting)`);
  lines.push(`uncalled_verifiers=${c.uncalled.length} (un-exempted; band 0)`);
  if (c.uncalled.length === 0) {
    lines.push("  (none)");
  } else {
    for (const u of c.uncalled) lines.push(`  ${u}`);
  }
  lines.push(`exempted=${c.exempted.length}`);
  if (c.exempted.length > 0) lines.push(`  ${c.exempted.join(" ")}`);
  for (const f of c.ratchetFailures) lines.push(`RATCHET-FAIL: ${f}`);
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  const args = argv.slice(2);
  let rootArg: string | null = null;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") asJson = true;
    else if (a === "--root") { rootArg = args[i + 1]; i++; }
    else if (a.startsWith("--root=")) rootArg = a.slice("--root=".length);
    else if (a === "--strict-subset") { i++; /* accepted (scoped-tier mode); whole-store check ignores it */ }
    else if (a === "--help" || a === "-h") { /* usage */ }
    else {
      process.stderr.write(`ERROR: unknown argument: ${a}\n`);
      return 2;
    }
  }
  let root: string;
  try {
    root = path.resolve(rootArg ?? findRepoRoot());
  } catch (e) {
    process.stderr.write(`ERROR: ${(e as Error).message}\n`);
    return 2;
  }
  if (!fs.existsSync(path.join(root, "plugin", "scripts"))) {
    process.stderr.write(`ERROR: ${path.join(root, "plugin", "scripts")} not found — is --root correct?\n`);
    return 2;
  }

  const dataFileAbs = path.join(root, EXEMPTIONS_REL);
  const dataText = fs.existsSync(dataFileAbs) ? fs.readFileSync(dataFileAbs, "utf8") : "";
  const currentList = parseExemptionList(dataText);
  const baselineCount = parseBaselineCount(dataText);

  // Git baseline: the data file's committed form. A broken git baseline FAILS CLOSED unless this is
  // a TRUE bootstrap (the data file genuinely does not exist at HEAD).
  let baselineList: string[] = currentList;
  let baselineCountHead: number | null = null;
  const gitOk = gitHeadExists(root);
  if (gitOk) {
    const committed = gitShowFile(root, "HEAD", EXEMPTIONS_REL);
    if (committed !== null) {
      baselineList = parseExemptionList(committed);
      baselineCountHead = parseBaselineCount(committed);
    }
    // else: true bootstrap — current list becomes the baseline (ratchet enforceable after this commit).
  }

  const census = runCensus(root, currentList);
  census.baselineCount = baselineCount;

  const verifierSet = new Set(census.verifiers.map((v) => v.basename));
  const hasCallSite = (base: string) =>
    (census.verifiers.find((v) => v.basename === base)?.callers.length ?? 0) > 0;
  census.ratchetFailures = runRatchetChecks({
    root,
    currentList,
    baselineList,
    baselineCount,
    baselineCountHead,
    verifierSet,
    hasCallSite,
  });

  const ok = census.uncalled.length === 0 && census.ratchetFailures.length === 0;

  if (asJson) {
    const out = {
      ok,
      root: census.root,
      total_verifiers: census.totalVerifiers,
      uncalled: census.uncalled,
      exempted: census.exempted,
      mentions_excluded: census.mentionsExcluded,
      mentions_excluded_count: census.mentionsExcludedCount,
      callers: census.callers,
      exemptions_file: EXEMPTIONS_REL,
      baseline_count: baselineCount,
      ratchet_failures: census.ratchetFailures,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write(formatHuman(census) + "\n");
    if (census.ratchetFailures.length > 0) {
      process.stdout.write("FAIL: ratchet violated (see RATCHET-FAIL lines)\n");
    } else if (census.uncalled.length > 0) {
      process.stdout.write(`FAIL: ${census.uncalled.length} uncalled verifier(s) (band 0) — wire them or add a justified exemption\n`);
    } else {
      process.stdout.write("PASS: every verifier has an execution call site or a listed exemption; ratchet intact\n");
    }
  }
  return ok ? 0 : 1;
}

const isDirect =
  process.argv[1] && realpathOf(process.argv[1]) === realpathOf(fileURLToPath(import.meta.url));
if (isDirect) {
  process.exitCode = main(process.argv);
}
