#!/usr/bin/env node
// git-lens-l-g-structural-drift.ts — L_G (generative-alignment) convergence proxy,
// ADR-007/exp5-M-CRYST-G1.
//
// Surfaces dependency cycles / god-modules / duplicated-abstraction signals for the LIVE repo.
// PRIMARY mechanism: archguard (the owner-maintained L_D/L_G instrument, ADR-007) — but see the
// KNOWN GAP below. FALLBACK mechanism (this module's own, when archguard cannot be used): a plain
// Node/ESM `import`-graph cycle detector + a simple god-module heuristic (file exceeds a line-count
// AND fan-in threshold). This module IS the rule: pure functions consumed by the CLI (below) and
// wrappable, unchanged, by a future `quay gate --gate l-g` (M39 registry precedent). If this header
// and the code ever disagree, THE CODE WINS.
//
// ── KNOWN GAP (recorded 2026-07-20, M41-cryst-g1-observability charter-authoring time) ───────────
// `archguard_analyze` was probed live (MCP tool) against this repo with `lang: "typescript"` both
// with explicit `sources` (packages/quay/src etc.) and without (whole projectRoot), with and
// without `noCache`. EVERY variant returned:
//     "Analysis failed: No query scopes were persisted."
// archguard currently cannot produce a usable scope for quay's plain-JS/ESM packages (no
// tsconfig.json, no .ts files present — this is a plain-JS ESM repo, not TypeScript). This is a
// REAL upstream tool gap (see CLAUDE.md: "archguard ... maintained by the repo owner ... report
// bugs"), not a design choice — report it, do not silently route around it forever. The fallback
// below is what makes THIS milestone's own AC (a real, non-fixture L_G finding) land despite the
// gap; it is intentionally simple (import-graph cycles + a size/fan-in god-module heuristic) and
// is expected to be SUPERSEDED by a true archguard-backed proxy once the upstream gap is fixed
// (tracked as a follow-up, not silently absorbed as "done forever with the fallback").
//
// ── The fallback rule ──────────────────────────────────────────────────────────────────────────
// Given a set of .mjs/.js/.ts source files under a root:
//   1. Parse each file's static `import ... from '<spec>'` / `import '<spec>'` specifiers that
//      resolve to another file UNDER THE SAME ROOT (relative specifiers only — external packages
//      are not part of this repo's own dependency graph and are excluded).
//   2. Build a directed graph file -> [files it imports]. Detect cycles via DFS (grey/black
//      coloring). Any cycle found is a FLAG.
//   3. God-module heuristic: a file is a "god-module" if its own line count exceeds
//      GOD_MODULE_MIN_LINES (default 400) AND its fan-in (number of distinct other files that
//      import it) is >= GOD_MODULE_MIN_FANIN (default 5). Any god-module found is a FLAG.
// Verdict is "FLAGGED" if either signal fires, else "PASS". An empty file set is "N/A".
//
// Usage:
//   git-lens-l-g-structural-drift.ts <root-dir> [--min-lines N] [--min-fanin N] [--use-archguard]
//     --use-archguard: attempt the archguard MCP-equivalent path first (this CLI cannot itself call
//     an MCP tool — that integration is the caller/orchestrator's job; this flag is accepted for
//     forward-compat with a future direct-archguard-API mode and currently just falls through to
//     the plain-JS fallback with a note). Fixtures always exercise the fallback path directly.
//
// Exit codes: 0 = PASS or N/A; 1 = FLAGGED (cycle or god-module found).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { isDirectEntry } from './gate-script-base.ts';

export const GOD_MODULE_MIN_LINES = 400;
export const GOD_MODULE_MIN_FANIN = 5;

export interface GodModule {
  file: string;
  lines: number;
  fanin: number;
}

export interface AnalyzeResult {
  files: string[];
  cycles: string[][];
  godModules: GodModule[];
  verdict: 'N/A' | 'PASS' | 'FLAGGED';
  flagged: boolean;
}

export interface AnalyzeOpts {
  minLines?: number;
  minFanin?: number;
}

// ── listSourceFiles — recursively list .mjs/.js/.ts files under root, skipping node_modules/.git ─────
export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/\.(mjs|js|ts)$/.test(e.name)) out.push(full);
    }
  }
  return out.sort();
}

// ── parseImports — extract relative import specifiers from a file's source text ──────────────────
export function parseImports(source: string): string[] {
  const specs: string[] = [];
  const re = /\bimport\s+(?:[\s\S]*?\bfrom\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[1].startsWith('.')) specs.push(m[1]);
  }
  return specs;
}

// ── resolveImport — resolve a relative specifier from `fromFile` to an actual file in `allFiles` ─
function resolveImport(fromFile: string, spec: string, allFilesSet: Set<string>): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.mjs'), join(base, 'index.js')];
  for (const c of candidates) {
    if (allFilesSet.has(c)) return c;
  }
  return null;
}

// ── buildGraph — file -> Set(files it imports), restricted to files under root ───────────────────
export function buildGraph(files: string[]): Map<string, Set<string>> {
  const set = new Set(files);
  const graph = new Map<string, Set<string>>();
  for (const f of files) {
    let source: string;
    try {
      source = readFileSync(f, 'utf8');
    } catch {
      graph.set(f, new Set());
      continue;
    }
    const deps = new Set<string>();
    for (const spec of parseImports(source)) {
      const resolved = resolveImport(f, spec, set);
      if (resolved && resolved !== f) deps.add(resolved);
    }
    graph.set(f, deps);
  }
  return graph;
}

// ── detectCycles — DFS grey/black cycle detection over the import graph ──────────────────────────
export function detectCycles(graph: Map<string, Set<string>>): string[][] {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const f of graph.keys()) color.set(f, WHITE);
  const cycles: string[][] = [];

  function dfs(node: string, stack: string[]): void {
    color.set(node, GREY);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (color.get(dep) === GREY) {
        const idx = stack.indexOf(dep);
        cycles.push(stack.slice(idx).concat(dep));
      } else if (color.get(dep) === WHITE) {
        dfs(dep, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const f of graph.keys()) {
    if (color.get(f) === WHITE) dfs(f, []);
  }
  return cycles;
}

// ── detectGodModules — files exceeding both a line-count and fan-in threshold ─────────────────────
export function detectGodModules(graph: Map<string, Set<string>>, files: string[], { minLines = GOD_MODULE_MIN_LINES, minFanin = GOD_MODULE_MIN_FANIN }: AnalyzeOpts = {}): GodModule[] {
  const fanin = new Map<string, number>();
  for (const f of graph.keys()) fanin.set(f, 0);
  for (const [, deps] of graph) {
    for (const dep of deps) fanin.set(dep, (fanin.get(dep) || 0) + 1);
  }
  const godModules: GodModule[] = [];
  for (const f of files) {
    let lineCount = 0;
    try {
      lineCount = readFileSync(f, 'utf8').split('\n').length;
    } catch {
      continue;
    }
    const fi = fanin.get(f) || 0;
    if (lineCount >= minLines! && fi >= minFanin!) {
      godModules.push({ file: f, lines: lineCount, fanin: fi });
    }
  }
  return godModules;
}

// ── analyze — the pure orchestration: files -> {cycles, godModules, verdict, flagged} ────────────
export function analyze(root: string, opts: AnalyzeOpts = {}): AnalyzeResult {
  const files = listSourceFiles(root);
  if (files.length === 0) {
    return { files: [], cycles: [], godModules: [], verdict: 'N/A', flagged: false };
  }
  const graph = buildGraph(files);
  const cycles = detectCycles(graph);
  const godModules = detectGodModules(graph, files, opts);
  const flagged = cycles.length > 0 || godModules.length > 0;
  return { files, cycles, godModules, verdict: flagged ? 'FLAGGED' : 'PASS', flagged };
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args[0];
  if (!root) {
    console.error('Usage: git-lens-l-g-structural-drift.ts <root-dir> [--min-lines N] [--min-fanin N] [--use-archguard]');
    process.exit(2);
  }
  const minLinesIdx = args.indexOf('--min-lines');
  const minFaninIdx = args.indexOf('--min-fanin');
  const opts: AnalyzeOpts = {};
  if (minLinesIdx !== -1) opts.minLines = parseInt(args[minLinesIdx + 1], 10);
  if (minFaninIdx !== -1) opts.minFanin = parseInt(args[minFaninIdx + 1], 10);
  if (args.includes('--use-archguard')) {
    console.log('NOTE: --use-archguard requested, but this CLI has no direct archguard API access '
      + '(that integration is MCP-tool-only, caller/orchestrator-side). Falling back to the plain-JS '
      + 'import-graph proxy below. See this file\'s header "KNOWN GAP" comment: archguard_analyze '
      + 'currently fails ("No query scopes were persisted") for this repo\'s plain-JS/ESM packages.');
  }
  const result = analyze(resolve(root), opts);
  const relFiles = (arr: string[]) => arr.map((f) => (typeof f === 'string' ? relative(process.cwd(), f) : f));
  console.log(`L_G structural-drift (fallback proxy) — scanned ${result.files.length} files under ${root}`);
  console.log(`  cycles found: ${result.cycles.length}`);
  for (const c of result.cycles) console.log(`    CYCLE: ${relFiles(c).join(' -> ')}`);
  console.log(`  god-modules found: ${result.godModules.length}`);
  for (const g of result.godModules) console.log(`    GOD-MODULE: ${relative(process.cwd(), g.file)} (lines=${g.lines}, fanin=${g.fanin})`);
  console.log(`  verdict: ${result.verdict}`);
  process.exit(result.flagged ? 1 : 0);
}

if (isDirectEntry(import.meta, undefined, "git-lens-l-g-structural-drift")) {
  main();
}
