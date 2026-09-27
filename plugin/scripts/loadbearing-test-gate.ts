// loadbearing-test-gate.ts — the ONE canonical implementation of the LOAD-BEARING-TEST gate: it
// mechanically enforces ADR-001 Decision clause 2 (load-bearing method-infra must be fixture-first +
// covered), which until now lived only as prose. This module IS the rule: pure, side-effect-free
// check functions consumed by the standalone CLI (this file's own `main` below, invoked via
// loadbearing-test-gate.sh) and wrappable, unchanged, by a future `quay gate --gate loadbearing-test`
// (M39 registry precedent — a named gate WRAPS this module, never reimplements the logic). If this
// header comment and the code ever disagree, THE CODE WINS. This gate must EXEMPLARILY follow the very
// policy it enforces — it is itself load-bearing and ships with a sibling test/loadbearing-test-gate.test.mjs.
//
// ── The 'load-bearing' MECHANICAL criterion (concrete, this is the single source of the definition) ─
//   A `scripts/*.mjs` or `scripts/*.ts` is LOAD-BEARING iff AT LEAST ONE of:
//     (a) IMPORTED by another module in the repo — some OTHER .mjs/.ts under an import-search-root has an
//         `import ... from "<...>/<name>.mjs"` (or `.ts`) line naming it (a module importing ITSELF does not count).
//     (b) WRAPPED / REGISTERED by the gate registry — its basename appears in
//         packages/quay/src/gate/registry.js.
//     (c) NAMED by OUTER-LOOP.md as a `milestone_counter++` gate — its basename appears on a line of
//         OUTER-LOOP.md that also mentions the `milestone_counter++` token.
//   A 'SIBLING TEST' = a `<name>.test.mjs` file under the configured test/ dir.
//   Verdict per script:
//     load-bearing AND has sibling test           → PASS
//     load-bearing AND NO sibling test             → FAIL   (the debt ADR-001 clause 2 forbids)
//     NOT load-bearing                             → N/A    (EXPLICIT — never a silent skip; ADR-001
//                                                            clause 3: throwaway/one-shot scripts exempt)
//   Overall tree verdict: FAIL iff >=1 script FAILs; else PASS (N/A-only or PASS+N/A both PASS).
//
//   This gate ONLY reports presence/absence of a sibling test for load-bearing scripts. It does NOT
//   measure coverage percentage (ADR-001's >=80% floor is enforced per-stage by Clause-7 / the TDD
//   classifier at ABSORB); the sibling-test presence check is the mechanical FLOOR this gate adds so a
//   load-bearing script can never land with ZERO unit tests — the exact hole ADR-001 clause 2 named.

import fs from "node:fs";
import path from "node:path";

export interface ScriptCfg {
  scriptsDir: string;
  testDir: string | null;
  importSearchRoots: string[];
  registryFile: string | null;
  outerLoopFile: string | null;
}

export interface ScriptResult {
  file: string;
  loadBearing: boolean;
  reasons: string[];
  hasTest: boolean;
  verdict: "PASS" | "FAIL" | "N/A";
}

export interface TreeResult {
  verdict: "PASS" | "FAIL";
  results: ScriptResult[];
  pass: number;
  fail: number;
  na: number;
}

// ── basenameOf — the file's basename (used everywhere a script is identified by name). ────────────
export function basenameOf(file: string): string {
  return path.basename(file);
}

// ── enumerateScripts — all `*.ts` and `*.mjs` directly in scriptsDir (non-recursive), as ABSOLUTE paths. ─────
// Missing dir → [] (no throw): an absent scripts dir is "nothing to gate", not an error.
export function enumerateScripts(scriptsDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".mjs")) && !e.name.endsWith(".test.mjs") && !e.name.endsWith(".test.ts"))
    .map((e) => path.resolve(scriptsDir, e.name))
    .sort();
}

// ── readAllMjs — every `*.mjs` and `*.ts` under the given roots (non-recursive per root), as {file, text}. ───
function readAllMjs(roots: string[]): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || (!e.name.endsWith(".mjs") && !e.name.endsWith(".ts"))) continue;
      const file = path.resolve(root, e.name);
      let text = "";
      try { text = fs.readFileSync(file, "utf8"); } catch { text = ""; }
      out.push({ file, text });
    }
  }
  return out;
}

// ── detectImported (criterion a) — some OTHER .mjs/.ts under importSearchRoots imports this basename. ─
// Matches `from "<...>/<name>.mjs"` / `from "<...>/<name>.ts"` or bare `from "<name>.mjs"` / `from "<name>.ts"`.
// A module that imports itself (the same file carrying the import line) does NOT count as making itself load-bearing.
export function detectImported(name: string, importSearchRoots: string[]): boolean {
  // Match every `from "<spec>"` / `from '<spec>'` import specifier, then compare its basename to
  // `name` — so `from "./x/<name>.mjs"` and `from "<name>.mjs"` both count, but `from "other.mjs"`
  // does not, without brittle path-prefix regex escaping.
  const specRe = /from\s+["']([^"']*)["']/g;
  // The caller's name may be a .ts file; also check for the same stem with .mjs extension (legacy imports).
  const stem = name.replace(/\.(ts|mjs)$/, "");
  for (const { file, text } of readAllMjs(importSearchRoots)) {
    const fileStem = basenameOf(file).replace(/\.(ts|mjs)$/, "");
    if (fileStem === stem) continue; // self-import does not count
    let m: RegExpExecArray | null;
    while ((m = specRe.exec(text)) !== null) {
      const importedStem = basenameOf(m[1]).replace(/\.(ts|mjs)$/, "");
      if (importedStem === stem) return true;
    }
    specRe.lastIndex = 0;
  }
  return false;
}

// ── detectRegistered (criterion b) — basename appears in the gate registry file. ──────────────────
// Missing registry file → false (no throw).
export function detectRegistered(name: string, registryFile: string): boolean {
  let text: string;
  try { text = fs.readFileSync(registryFile, "utf8"); } catch { return false; }
  // Check for both the .ts and .mjs forms of the name (stem-based match for portability)
  const stem = name.replace(/\.(ts|mjs)$/, "");
  return text.includes(name) || text.includes(`${stem}.mjs`) || text.includes(`${stem}.ts`);
}

// ── detectCounterGate (criterion c) — basename appears in the SAME OUTER-LOOP BULLET BLOCK as a
// `milestone_counter++` token. Bullet-block granularity (not per-line) because OUTER-LOOP describes
// each gate as one `   - **…**` bullet whose script reference and `milestone_counter++` HARD-BLOCK
// token routinely wrap onto different physical lines; a per-line rule under-detects the real doc. A
// block starts at a line matching `^\s*-\s` (a Markdown list item) and runs until the next such line
// (or a blank-line-separated non-bullet paragraph). Missing outer-loop file → false (no throw).
export function splitBulletBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let cur: string[] | null = null;
  const isBulletStart = (l: string) => /^\s*[-*]\s/.test(l);
  for (const line of lines) {
    if (isBulletStart(line)) {
      if (cur !== null) blocks.push(cur.join("\n"));
      cur = [line];
    } else if (cur !== null) {
      // A continuation line (indented / wrapped) stays in the current bullet; a top-level
      // non-indented non-blank line ends the block.
      if (/^\s+\S/.test(line) || line.trim() === "") cur.push(line);
      else { blocks.push(cur.join("\n")); cur = null; }
    }
  }
  if (cur !== null) blocks.push(cur.join("\n"));
  return blocks;
}

export function detectCounterGate(name: string, outerLoopFile: string): boolean {
  let text: string;
  try { text = fs.readFileSync(outerLoopFile, "utf8"); } catch { return false; }
  // Check for both the .ts and .mjs forms of the stem
  const stem = name.replace(/\.(ts|mjs)$/, "");
  for (const block of splitBulletBlocks(text)) {
    if ((block.includes(name) || block.includes(`${stem}.mjs`) || block.includes(`${stem}.ts`)) && /milestone_counter\s*\+\+/.test(block)) return true;
  }
  return false;
}

// ── hasSiblingTest — a `<name-without-extension>.test.mjs` or `.test.ts` exists in testDir
//    OR in the same directory as the script. ──────────────────────────────────────────────────────
export function hasSiblingTest(name: string, testDir: string, scriptsDir?: string): boolean {
  const stem = name.replace(/\.(ts|mjs)$/, "");
  const candidates = [path.join(testDir, `${stem}.test.mjs`), path.join(testDir, `${stem}.test.ts`)];
  if (scriptsDir) {
    candidates.push(path.join(scriptsDir, `${stem}.test.mjs`), path.join(scriptsDir, `${stem}.test.ts`));
  }
  return candidates.some((p) => fs.existsSync(p));
}

// ── classifyScript — the per-script disposition. cfg: { testDir, importSearchRoots, registryFile,
//    outerLoopFile }. Returns { file, loadBearing, reasons, hasTest, verdict }. ────────────────────
export function classifyScript(file: string, cfg: ScriptCfg): ScriptResult {
  const name = basenameOf(file);
  const reasons: string[] = [];
  if (detectImported(name, cfg.importSearchRoots || [])) reasons.push("imported");
  if (cfg.registryFile && detectRegistered(name, cfg.registryFile)) reasons.push("registered");
  if (cfg.outerLoopFile && detectCounterGate(name, cfg.outerLoopFile)) reasons.push("counter-gate");
  const loadBearing = reasons.length > 0;
  const hasTest = hasSiblingTest(name, cfg.testDir!, cfg.scriptsDir);
  let verdict: "PASS" | "FAIL" | "N/A";
  if (!loadBearing) verdict = "N/A";
  else verdict = hasTest ? "PASS" : "FAIL";
  return { file, loadBearing, reasons, hasTest, verdict };
}

// ── checkTree — the SINGLE entry point (CLI + any future quay gate both call this). ───────────────
// cfg: { scriptsDir, testDir, importSearchRoots, registryFile, outerLoopFile }.
export function checkTree(cfg: ScriptCfg): TreeResult {
  const scripts = enumerateScripts(cfg.scriptsDir);
  const results = scripts.map((f) => classifyScript(f, cfg));
  const pass = results.filter((r) => r.verdict === "PASS").length;
  const fail = results.filter((r) => r.verdict === "FAIL").length;
  const na = results.filter((r) => r.verdict === "N/A").length;
  return {
    verdict: fail > 0 ? "FAIL" : "PASS",
    results,
    pass,
    fail,
    na,
  };
}

// ── CLI arg parse. --scripts (required), --tests, --import-root (repeatable), --registry, --outer-loop. ─
// ⛔ NOT foldable onto gate-script-base's parseArgs — the blocker is this function's CONTROL-FLOW
// contract, not its syntax (semantic-dedup-scan finding `parseargs-local-copies`, runId
// `semantic-dedup-scan-1790503843524`, which named this file's copy as one of its exemplars).
// This is a LIBRARY-shaped parser: a bad argument is RETURNED as `{error}`, and the CALLER decides
// what to do with it (main turns it into exit 2; an importer could ignore it). The shared parser
// OWNS `process.exit` on both its `--help` path (helpExit) and its minArgs path, so adopting it here
// would let an argument typo terminate the process from inside what is currently a pure function —
// and `--import-root` is likewise repeatable (`<dir> ...`), which the shared one-value-per-flag
// parser cannot express either. Absorbing this caller needs a non-exiting error mode in the base.
function parseArgs(argv: string[]): { cfg?: ScriptCfg; allowEmpty?: boolean; error?: string } {
  const cfg: ScriptCfg = { scriptsDir: null as any, testDir: null, importSearchRoots: [], registryFile: null, outerLoopFile: null };
  let allowEmpty = false;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--scripts") cfg.scriptsDir = args[++i];
    else if (a === "--tests") cfg.testDir = args[++i];
    else if (a === "--import-root") cfg.importSearchRoots.push(args[++i]);
    else if (a === "--registry") cfg.registryFile = args[++i];
    else if (a === "--outer-loop") cfg.outerLoopFile = args[++i];
    else if (a === "--allow-empty") allowEmpty = true;
    else return { error: `unknown argument: ${a}` };
  }
  return { cfg, allowEmpty };
}

// ── CLI main (only when run directly). Prints a per-script report + summary; exits 0/1/2. ─────────
function main(argv: string[]): number {
  const { cfg, allowEmpty, error } = parseArgs(argv);
  if (error) { console.error(`ERROR: ${error}`); return 2; }
  if (!cfg!.scriptsDir) {
    console.error("usage: node loadbearing-test-gate.ts --scripts <dir> [--tests <dir>] " +
      "[--import-root <dir> ...] [--registry <file>] [--outer-loop <file>] [--allow-empty]");
    return 2;
  }
  // Sensible defaults: tests dir sibling of scripts dir; import search = the scripts dir itself.
  if (!cfg!.testDir) cfg!.testDir = path.resolve(cfg!.scriptsDir, "..", "test");
  if (cfg!.importSearchRoots.length === 0) cfg!.importSearchRoots = [cfg!.scriptsDir];

  const rep = checkTree(cfg!);
  // EMPTY-SET guard (gap-checks-that-verify-an-empty-set-must-fail-closed): an empty scripts dir
  // means the gate verified ZERO scripts — "PASS: every load-bearing script has a sibling test" is
  // indistinguishable from "never looked". Fail-closed by default; --allow-empty waives it.
  if (rep.results.length === 0 && !allowEmpty) {
    console.log(`FAIL: 0 scripts to gate — the scripts directory ${cfg!.scriptsDir} has no *.ts/*.mjs, so this gate verified nothing (fail-closed: 'no problems' must not be indistinguishable from 'never looked'; pass --allow-empty to waive)`);
    return 1;
  }
  console.log(`load-bearing test-gate — scripts=${cfg!.scriptsDir}`);
  for (const r of rep.results) {
    const name = basenameOf(r.file);
    if (r.verdict === "N/A") {
      console.log(`  [N/A] ${name} — not load-bearing (no import/registry/counter-gate trigger)`);
    } else if (r.verdict === "PASS") {
      console.log(`  [PASS] ${name} — load-bearing (${r.reasons.join(",")}) + sibling test present`);
    } else {
      console.log(`  [FAIL] ${name} — load-bearing (${r.reasons.join(",")}) but NO sibling ${name.replace(/\.(ts|mjs)$/, "")}.test.mjs`);
    }
  }
  console.log("");
  console.log(`${rep.results.length} total, ${rep.pass} pass, ${rep.na} N/A, ${rep.fail} fail`);
  if (rep.fail > 0) {
    console.log(`FAIL: ${rep.fail} load-bearing script(s) lack a sibling *.test.mjs (ADR-001 Decision clause 2)`);
    return 1;
  }
  console.log("PASS: every load-bearing script has a sibling *.test.mjs");
  return 0;
}

// Run the CLI only when this file is the entry point (not when imported by tests / a quay gate).
// ⛔ NOT a URL-equality check. Under a mirror invocation (`experiments/**/scripts/<name>.ts` is a
// symlink to `plugin/scripts/<name>.ts`), Node resolves `import.meta.url` to the REALPATH (plugin
// side) while `process.argv[1]` keeps the path as written (experiments side) ⇒ URL equality is
// permanently false, `main()` never runs, and the process exits 0 with ZERO output — the "could not
// read the input" failure printed in the same shape as "all clear" (gap-arch-duplicate-copies-zero).
// `isDirectEntry` judges by basename, so both call paths agree.
import { isDirectEntry } from "./gate-script-base.ts";
const isDirect = isDirectEntry(import.meta, process.argv[1], "loadbearing-test-gate");
if (isDirect) {
  process.exit(main(process.argv));
}
