#!/usr/bin/env node
// import-graph-check.ts — 按【语句位置】解析 import/export 的模块依赖图检查器：三个结构量只降不升。
// (tasks/gap-arch-import-graph-check; 来源 orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md
//  §2 P1 / §5 Phase 0a —— 本检查器是那份 SPEC 的 Phase 0a 机械载体。)
//
// THE DEFECT THIS CLOSES（实测，非印象）:
//   archguard 把 plugin/scripts 当成单个 `(root)` 包 ⇒ `detect_cycles` 返回 `[]`；而对同一批文件自写的
//   import 图算出 3 个文件级环（1 值级 + 2 类型级）。⇒ archguard 的「0 环」只能读作「未评估」。
//   另有 packages/quay 与 quay-native 反向 import plugin/scripts 的 5 条边，没有任何检查在盯。
//   这三个量都会【回升】，所以必须是棘轮，不是一次性读数。
//
// THREE QUANTITIES（每个都是「会回升」的量 ⇒ shrink-only 棘轮）:
//   valueSccs    只用【值导入】边（`import x from` / `export … from` / 动态 `import()`；`import type`
//                与 `export type` 不算）构成的强连通分量，大小 ≥2。
//   typeSccs     把类型边也算进去才成立、但仅用值边【不】成立的 SCC（大小 ≥2）。判定：合并图上大小 ≥2
//                的 SCC 里，文件集合不等于任何 valueScc 的那些。
//   reverseEdges `packages/**` 下的文件 import `plugin/**` 或 `experiments/**` 的边 `{from,to,line}`。
//
// FOURTH RULE（kernel 边界，条件性）: 若 `packages/quay/src/kernel/` 存在，其下文件不得 import 该目录
//   之外【仓库内可解析】的模块（也不得 import `plugin/`、`experiments/`）。裸说明符（`node:fs`、npm 包）
//   不在此列 —— kernel 落点若连 node 内建都不能用就没有意义；本检查器量的是【层间越界】，不是依赖白名单。
//   目录不存在 ⇒ `kernelChecked:false` —— ⛔【不得】返回与「已检查且合格」同形的值（硬规则 3b）。
//
// 设计约束（每条都对应一次已发生的错误）:
//   · 按位置判定（硬规则 2）: 只认真实的 import/export 语句，注释/字符串里出现 `from "…plugin/…"` 不算。
//     复用仓库已有的 `buildNonCodeMask`（plugin/scripts 中 13 处依赖它），不新造掩码。
//   · 数据源 `git ls-files`，不用 `find` —— 一次 `find` 曾扫进 `.claude/worktrees/*`（4806 个副本）把计数
//     污染 10 倍以上。
//   · 符号链接按 realpath 去重: `experiments/quay-perpetual-stream/scripts/` 有 22 个指向 `plugin/scripts/`
//     的符号链接，同一文件只算一个节点。
//   · 读不懂输入要说出来（硬规则 3b）: `evaluated:true|false`；解析失败 / git 不可用 / 无文件 ⇒
//     `evaluated:false` + exit 2，**不得** exit 0。⚠️ 本文件因此【不使用仓库惯用的 exit 3 = NOT-EVALUATED】：
//     本任务的 CLI 契约把「用法/环境错误」与「读不懂」合并为 exit 2，理由是这条不变量的判据就是
//     「图能不能被读出来」——读不出来本身就是该不变量被违反，fail-closed。套件侧 run_checker 对 exit 2
//     与 exit 1 同样处理（RED），对 exit 3 才会吞成 0，因此这里不存在「静默变绿」的通道。
//   · 棘轮形态照 plugin/scripts/quay-init-closure-ratchet.ts：基线是数据文件 plugin/import-graph-baseline.json；
//     读数 > 基线 ⇒ exit 1；同时【工作树基线的值相对 git HEAD 基线只许降不许升】（防止「调高基线」绕过）。
//     bootstrap（HEAD 尚无该文件）以当前为基线并在输出里注明 headBaseline:"absent-bootstrap"。
//
// CLI:
//   node --experimental-strip-types plugin/scripts/import-graph-check.ts [<root>] [--json] [--selftest]
//        [--baseline <file>]
// exit 0 = 全部不超基线 · 1 = 有超出（读数回升 / 基线被调高 / kernel 越界）· 2 = 用法/环境错误(含读不懂输入)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildNonCodeMask } from "./checker-lib.ts";
import { helpExit, isDirectEntry, flagValue } from "./gate-script-base.ts";

// ── the three measured quantities + the conditional fourth rule ─────────────────────────────────────

export interface ImportEdge {
  from: string;
  to: string;
  line: number;
  kind: "value" | "type";
}

export interface Scc {
  files: string[];
}

export interface ReverseEdge {
  from: string;
  to: string;
  line: number;
}

export interface NotAnalyzed {
  mjs: number;
  js: number;
}

export interface GraphReading {
  /** false ⇒ the graph could not be read (NOT-EVALUATED — never conflated with "0 cycles"). */
  evaluated: boolean;
  reason?: string;
  files: number;
  edges: number;
  valueEdges: number;
  typeEdges: number;
  valueSccs: Scc[];
  typeSccs: Scc[];
  reverseEdges: ReverseEdge[];
  kernelChecked: boolean;
  kernelViolations: ReverseEdge[];
  notAnalyzed: NotAnalyzed;
  /** tracked source paths that resolve to no readable target (dangling symlinks) — absent, not hidden. */
  dangling: string[];
}

/** The committed baseline shape — exactly the three ratchet counters. */
export interface Baseline {
  valueSccs: number;
  typeSccs: number;
  reverseEdges: number;
}

export const BASELINE_FILE_REL = "plugin/import-graph-baseline.json";

/** The counted namespace's roots — the three layers whose import edges this checker owns. */
const PACKAGES_PREFIX = "packages/";
const REVERSE_TARGET_PREFIXES = ["plugin/", "experiments/"];

/** The conditional kernel boundary (SPEC §2 P1: 共享原语落点 `packages/quay/src/kernel/`). */
export const KERNEL_DIR_REL = "packages/quay/src/kernel";
const KERNEL_PREFIX = `${KERNEL_DIR_REL}/`;

// ── file selection (git ls-files, never find) ───────────────────────────────────────────────────────

/** Path segments that disqualify a tracked path from the graph's node set. Applied to repo-relative
 *  POSIX paths. `/dist/` and `/archive/` are EXCLUDED (generated / retired trees); `/test/` and
 *  `.test.` are EXCLUDED (the graph is over production modules — a test file importing a module is
 *  not a dependency edge of the module). `.claude/worktrees/` is EXCLUDED defensively: a `find` once
 *  scanned 4806 worktree copies and polluted the count 10×; `git ls-files` cannot reach them, but the
 *  exclusion is asserted by AC4 so the read is pinned by the more robust of the two sources. */
const EXCLUDED_SEGMENTS = ["node_modules", "dist", "archive", "test", "__tests__", "fixtures"];
const EXCLUDED_PREFIXES = [".claude/worktrees/"];

export function isExcludedPath(rel: string): boolean {
  if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (rel.split("/").some((seg) => EXCLUDED_SEGMENTS.includes(seg))) return true;
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  if (/\.d\.ts$/.test(base)) return true;
  return false;
}

/** Run `git ls-files` in `root` for the three extensions this checker enumerates. Throws on failure
 *  (a caller turns that into evaluated:false — a checker that cannot enumerate its input is never
 *  conflated with "the graph is empty"). */
export function gitLsFiles(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "*.ts", "*.mts", "*.cts", "*.mjs", "*.js"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], // stderr captured (a non-git root must not print git's fatal to the console)
  });
  return out.split("\0").filter((s) => s.length > 0);
}

// ── import extraction (BY STATEMENT POSITION — 硬规则 2) ──────────────────────────────────────────────

/** A candidate static `import … from "spec"` / `export … from "spec"` at a line boundary.
 *  `[^;\n]*?` bounds the statement to ONE line so an unterminated scan can never swallow the next
 *  statement (this repo is semicolon-less — an unbounded `[^;]*?` would merge two imports into one). */
const STATIC_FROM_RE = /(^|[\n;])([ \t]*)(import|export)\b([^;\n]*?)(from)[ \t]*["']([^"']+)["']/g;
/** The brace form, allowed to span lines (`import {\n a,\n b\n} from "spec"`). Bounded by `[^}]*`. */
const BRACE_FROM_RE = /(^|[\n;])([ \t]*)(import|export)[ \t]+((?:type[ \t]+)?\{[^}]*\})([ \t]*)(from)[ \t]*["']([^"']+)["']/g;
/** Side-effect import: `import "spec";` */
const BARE_IMPORT_RE = /(^|[\n;])([ \t]*)import[ \t]*["']([^"']+)["']/g;
/** Dynamic import: `await import("spec")` — any position; `import.meta` cannot match (no `(` + quote). */
const DYNAMIC_IMPORT_RE = /\bimport[ \t]*\([ \t]*["']([^"']+)["']/g;

export interface RawImport {
  spec: string;
  line: number;
  kind: "value" | "type";
}

/** 1-based line number of a source index. */
function lineAt(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/**
 * Extract the module specifiers a source file imports, BY POSITION: a candidate matches only when the
 * `import` / `export` KEYWORD sits at a code position (mask === 0). The specifier STRING is of course
 * inside the mask — that is why the check is anchored on the keyword's offset, never the match start
 * (a match starting on a preceding `\n` would otherwise let a `// import x from "y"` comment through:
 * the classic off-by-one that makes a comment satisfy a position judgment).
 */
export function extractImports(src: string): RawImport[] {
  const mask = buildNonCodeMask(src);
  const found = new Map<string, RawImport>(); // key `${line}\t${spec}` — dedupes the brace form's overlap
  /** `kwIdx` = the `import`/`export` token; `fromIdx` = the `from` token (or -1 when the form has no
   *  `from`). BOTH must sit at a code position. Requiring only the keyword is not enough: in
   *  `export const doc = 'import { b } from "./b.ts";'` the `export` IS code while the `from` is
   *  string content — anchoring on the keyword alone would read a module edge out of a string literal. */
  const add = (kwIdx: number, fromIdx: number, spec: string, kind: "value" | "type"): void => {
    if (kwIdx < 0 || kwIdx >= src.length || mask[kwIdx] !== 0) return;
    if (fromIdx >= 0 && (fromIdx >= src.length || mask[fromIdx] !== 0)) return;
    const line = lineAt(src, kwIdx);
    found.set(`${line}\t${spec}`, { spec, line, kind });
  };

  let m: RegExpExecArray | null;
  STATIC_FROM_RE.lastIndex = 0;
  while ((m = STATIC_FROM_RE.exec(src)) !== null) {
    const kwIdx = m.index + m[1].length + m[2].length;
    const fromIdx = kwIdx + m[3].length + m[4].length;
    // statement-level `type` keyword ⇒ a TYPE edge. Inline `{ type X }` is intentionally NOT counted
    // as type-only: with elision the statement may still emit a runtime import, and erring toward the
    // value edge is the conservative direction for a value-cycle ratchet.
    const kind: "value" | "type" = /^type[\s{]/.test(m[4].trimStart()) ? "type" : "value";
    add(kwIdx, fromIdx, m[6], kind);
  }
  BRACE_FROM_RE.lastIndex = 0;
  while ((m = BRACE_FROM_RE.exec(src)) !== null) {
    const kwIdx = m.index + m[1].length + m[2].length;
    const fromIdx = kwIdx + m[3].length + m[4].length + m[5].length;
    add(kwIdx, fromIdx, m[7], m[4].trimStart().startsWith("type") ? "type" : "value");
  }
  BARE_IMPORT_RE.lastIndex = 0;
  while ((m = BARE_IMPORT_RE.exec(src)) !== null) {
    add(m.index + m[1].length + m[2].length, -1, m[3], "value");
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(src)) !== null) {
    add(m.index, -1, m[1], "value");
  }
  return [...found.values()];
}

/**
 * Resolve a specifier to a node id (repo-relative POSIX path) or null when it is external / unresolved.
 * Relative specifiers only — a bare specifier (`node:fs`, `yaml`, `#internal`) is out of scope. The
 * `.js` → `.ts` rewrite is the TypeScript-ESM convention; `index.ts` covers directory imports.
 */
export function resolveSpecifier(fromRel: string, spec: string, nodes: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates: string[] = [];
  if (/\.(ts|mts|cts|tsx)$/.test(base)) {
    candidates.push(base);
  } else if (/\.js$/.test(base) || /\.mjs$/.test(base)) {
    candidates.push(base.replace(/\.m?js$/, ".ts"), base);
  } else if (/\.json$/.test(base)) {
    return null; // data import — not a module edge
  } else {
    candidates.push(`${base}.ts`, `${base}.mts`, `${base}.cts`, `${base}/index.ts`);
  }
  for (const c of candidates) if (nodes.has(c)) return c;
  return null;
}

// ── SCC (iterative Tarjan — no recursion depth limit on a large consumer repo) ──────────────────────

export function tarjanSccs(nodes: readonly string[], adj: ReadonlyMap<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const start of nodes) {
    if (index.has(start)) continue;
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    const work: { v: string; i: number }[] = [{ v: start, i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const nbrs = adj.get(frame.v) ?? [];
      if (frame.i < nbrs.length) {
        const w = nbrs[frame.i++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].v;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.v)!));
        }
        if (low.get(frame.v) === index.get(frame.v)) {
          const comp: string[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === frame.v) break;
          }
          comp.sort();
          sccs.push(comp);
        }
      }
    }
  }
  return sccs;
}

/** Build an adjacency map over `edges` restricted to `nodes` (edges outside the node set are dropped). */
function adjacency(edges: readonly ImportEdge[], nodes: readonly string[]): Map<string, string[]> {
  const nodeSet = new Set(nodes);
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
  }
  return adj;
}

// ── the analysis ────────────────────────────────────────────────────────────────────────────────────

/**
 * Read the module dependency graph of `root` and compute the three quantities + the kernel boundary.
 *
 * Canonicalisation: every tracked path is mapped through `fs.realpathSync` and re-expressed relative to
 * `root`. Two tracked paths sharing one realpath (the 22 experiments/ symlinks → plugin/scripts) collapse
 * to ONE node whose id is the realpath's relative form; a relative import is then resolved from the
 * CANONICAL from-path, so a symlinked file's `./sibling.ts` resolves next to its real target, not next
 * to the symlink.
 */
export function readImportGraph(root: string): GraphReading {
  const empty: GraphReading = {
    evaluated: false,
    files: 0,
    edges: 0,
    valueEdges: 0,
    typeEdges: 0,
    valueSccs: [],
    typeSccs: [],
    reverseEdges: [],
    kernelChecked: false,
    kernelViolations: [],
    notAnalyzed: { mjs: 0, js: 0 },
    dangling: [],
  };

  let tracked: string[];
  try {
    tracked = gitLsFiles(root);
  } catch (err) {
    return { ...empty, reason: `git ls-files failed in ${root}: ${(err as Error).message.split("\n")[0]}` };
  }

  const notAnalyzed: NotAnalyzed = {
    mjs: tracked.filter((p) => p.endsWith(".mjs") && !isExcludedPath(p)).length,
    js: tracked.filter((p) => p.endsWith(".js") && !isExcludedPath(p)).length,
  };

  // ── node set (canonical, realpath-deduped) ──
  const candidates = tracked.filter((p) => /\.(ts|mts|cts)$/.test(p) && !isExcludedPath(p));
  const dangling: string[] = []; // tracked path with no readable target (a broken symlink — a real state)
  const repOf = new Map<string, string>(); // canonical node id → the tracked path that reads it
  const nodes = new Set<string>();
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    let real: string;
    try {
      real = fs.realpathSync(abs);
    } catch {
      // A tracked path whose target does not exist (a dangling symlink — e.g. the retired git-lens
      // proxy symlinks) is NOT A NODE: it carries no module. It is LISTED (hard rule 3 — an absence
      // is an enumerated fact), never silently dropped and never fatal: it is the repo's own state,
      // not this checker's inability to read its input.
      dangling.push(rel);
      continue;
    }
    let canon = path.relative(root, real).split(path.sep).join("/");
    if (canon.startsWith("../")) canon = rel; // points outside the root — keep the tracked path
    if (!repOf.has(canon)) repOf.set(canon, rel);
    nodes.add(canon);
  }
  if (nodes.size === 0) {
    return { ...empty, evaluated: false, notAnalyzed, dangling, reason: `no analyzable TypeScript files under ${root}` };
  }

  // ── edges ── (iterated over the CANONICAL node set, so a symlink's file is read once, as its target)
  const allEdges: ImportEdge[] = [];
  const parseFailures: string[] = [];
  for (const [canon, rel] of repOf) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(root, rel), "utf8");
    } catch (err) {
      parseFailures.push(`${rel}: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    for (const imp of extractImports(src)) {
      const to = resolveSpecifier(canon, imp.spec, nodes);
      if (to === null) continue; // external / bare / unresolvable — not a node edge
      allEdges.push({ from: canon, to, line: imp.line, kind: imp.kind });
    }
  }
  if (parseFailures.length > 0) {
    return {
      ...empty,
      evaluated: false,
      notAnalyzed,
      dangling,
      reason: `could not read ${parseFailures.length} tracked source file(s): ${parseFailures.slice(0, 3).join("; ")}`,
    };
  }

  const nodeList = [...nodes].sort();
  const valueEdges = allEdges.filter((e) => e.kind === "value");
  const typeEdges = allEdges.filter((e) => e.kind === "type");

  const valueSccs: Scc[] = tarjanSccs(nodeList, adjacency(valueEdges, nodeList))
    .filter((c) => c.length >= 2)
    .map((files) => ({ files }));
  const combinedSccs = tarjanSccs(nodeList, adjacency(allEdges, nodeList)).filter((c) => c.length >= 2);
  const valueSccKeys = new Set(valueSccs.map((s) => s.files.join("\n")));
  // A combined SCC that IS a value SCC is a value cycle; one that is not (by exact file-set equality)
  // only closes once the type edges are added.
  const typeSccs: Scc[] = combinedSccs.filter((c) => !valueSccKeys.has(c.join("\n"))).map((files) => ({ files }));

  const reverseEdges: ReverseEdge[] = [];
  for (const e of allEdges) {
    if (!e.from.startsWith(PACKAGES_PREFIX)) continue;
    if (!REVERSE_TARGET_PREFIXES.some((p) => e.to.startsWith(p))) continue;
    reverseEdges.push({ from: e.from, to: e.to, line: e.line });
  }
  reverseEdges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) || a.line - b.line : a.from.localeCompare(b.from)));

  const kernelExists = fs.existsSync(path.join(root, KERNEL_DIR_REL)) && fs.statSync(path.join(root, KERNEL_DIR_REL)).isDirectory();
  const kernelViolations: ReverseEdge[] = [];
  if (kernelExists) {
    for (const e of allEdges) {
      if (!e.from.startsWith(KERNEL_PREFIX)) continue;
      if (e.to.startsWith(KERNEL_PREFIX)) continue;
      kernelViolations.push({ from: e.from, to: e.to, line: e.line });
    }
    kernelViolations.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.line - b.line);
  }

  return {
    evaluated: true,
    files: nodeList.length,
    edges: allEdges.length,
    valueEdges: valueEdges.length,
    typeEdges: typeEdges.length,
    valueSccs,
    typeSccs,
    reverseEdges,
    kernelChecked: kernelExists,
    kernelViolations,
    notAnalyzed,
    dangling,
  };
}

// ── the ratchet ─────────────────────────────────────────────────────────────────────────────────────

export function countsOf(r: Pick<GraphReading, "valueSccs" | "typeSccs" | "reverseEdges">): Baseline {
  return { valueSccs: r.valueSccs.length, typeSccs: r.typeSccs.length, reverseEdges: r.reverseEdges.length };
}

export interface RatchetVerdict {
  ok: boolean;
  /** per-axis: the reading exceeds the committed baseline. */
  over: (keyof Baseline)[];
  /** per-axis: the WORKING-TREE baseline was raised above the git-HEAD baseline (the bypass this guards). */
  baselineRaised: (keyof Baseline)[];
  headBaseline: Baseline | null;
  /** true when HEAD carries no baseline file — the bootstrap state, explicitly labelled, never silent. */
  bootstrap: boolean;
  kernelBlocked: boolean;
}

/**
 * The shrink-only judgment for the baseline FILE ITSELF (AC5): the working-tree baseline may not exceed
 * the git-HEAD baseline on any axis. A `head` of null is the bootstrap state (HEAD has no baseline file
 * yet) — it is labelled, never treated as "no constraint". Pure, so the self-test can exercise the
 * ±1 judgment without a git repo.
 */
export function checkBaselineShrinkOnly(
  worktree: Baseline | null,
  head: Baseline | null,
): { raised: (keyof Baseline)[]; bootstrap: boolean } {
  if (head === null) return { raised: [], bootstrap: true };
  if (worktree === null) return { raised: [], bootstrap: false };
  const raised = (Object.keys(worktree) as (keyof Baseline)[]).filter((k) => worktree[k] > head[k]);
  return { raised, bootstrap: false };
}

/** The gate judgment: the reading must not exceed the baseline, the baseline must not have been raised
 *  past HEAD, and the kernel boundary (when the directory exists) must hold. */
export function judge(
  reading: GraphReading,
  baseline: Baseline,
  worktreeBaseline: Baseline | null,
  headBaseline: Baseline | null,
): RatchetVerdict {
  const counts = countsOf(reading);
  const over = (Object.keys(counts) as (keyof Baseline)[]).filter((k) => counts[k] > baseline[k]);
  const shrink = checkBaselineShrinkOnly(worktreeBaseline, headBaseline);
  const kernelBlocked = reading.kernelChecked && reading.kernelViolations.length > 0;
  return {
    ok: over.length === 0 && shrink.raised.length === 0 && !kernelBlocked,
    over,
    baselineRaised: shrink.raised,
    headBaseline,
    bootstrap: shrink.bootstrap,
    kernelBlocked,
  };
}

/** The committed baseline's absolute path under `root`. */
export function baselineFile(root: string): string {
  return path.join(root, ...BASELINE_FILE_REL.split("/"));
}

export function readBaselineFile(abs: string): Baseline | null {
  try {
    const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as Partial<Baseline>;
    if (typeof raw.valueSccs !== "number" || typeof raw.typeSccs !== "number" || typeof raw.reverseEdges !== "number") {
      return null;
    }
    return { valueSccs: raw.valueSccs, typeSccs: raw.typeSccs, reverseEdges: raw.reverseEdges };
  } catch {
    return null;
  }
}

/** Read the baseline that git HEAD carries (`git show HEAD:<rel>`). Returns null when HEAD has no such
 *  file (bootstrap) — the caller distinguishes that from a git failure by first checking HEAD resolves. */
export function readHeadBaseline(root: string, relPath: string): Baseline | null {
  try {
    const out = execFileSync("git", ["-C", root, "show", `HEAD:${relPath}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const raw = JSON.parse(out) as Partial<Baseline>;
    if (typeof raw.valueSccs !== "number" || typeof raw.typeSccs !== "number" || typeof raw.reverseEdges !== "number") return null;
    return { valueSccs: raw.valueSccs, typeSccs: raw.typeSccs, reverseEdges: raw.reverseEdges };
  } catch {
    return null;
  }
}

// ── self-test (the injected seams — AC1) ────────────────────────────────────────────────────────────

export interface SelftestCase {
  name: string;
  /** fixture files, repo-relative → content. */
  files: Record<string, string>;
  /** git-init the fixture (the git-dependent cases) — false exercises the not-git path. */
  git: boolean;
  baseline: Baseline;
  expect: {
    evaluated: boolean;
    valueSccs: number;
    typeSccs: number;
    reverseEdges: number;
    kernelChecked?: boolean;
    kernelViolations?: number;
    /** the gate exit code this case must produce. */
    exit: number;
  };
  /** an expected-valueSCC membership assertion (the case is about WHICH files cycled). */
  valueSccContains?: string[];
  reverseEdgeFrom?: string[];
  reverseEdgeTo?: string[];
}

/** AC5's case is expressed as a pure-function pair (no git needed): a raised baseline must be caught. */
export const BASELINE_RAISE_CASE = {
  name: "baseline-raised-above-head",
  head: { valueSccs: 1, typeSccs: 2, reverseEdges: 5 } as Baseline,
  equal: { valueSccs: 1, typeSccs: 2, reverseEdges: 5 } as Baseline,
  lowered: { valueSccs: 0, typeSccs: 2, reverseEdges: 5 } as Baseline,
  raised: { valueSccs: 2, typeSccs: 2, reverseEdges: 5 } as Baseline,
};

/** ±1 on every axis: equal ⇒ no raise, one lower ⇒ no raise, one higher ⇒ RAISE (exit 1's trigger). */
export function runBaselineRaiseCase(): { ok: boolean; detail: string } {
  const c = BASELINE_RAISE_CASE;
  const eq = checkBaselineShrinkOnly(c.equal, c.head);
  const lo = checkBaselineShrinkOnly(c.lowered, c.head);
  const hi = checkBaselineShrinkOnly(c.raised, c.head);
  const boot = checkBaselineShrinkOnly(c.raised, null);
  const ok =
    eq.raised.length === 0 &&
    eq.bootstrap === false &&
    lo.raised.length === 0 &&
    hi.raised.length === 1 &&
    hi.raised[0] === "valueSccs" &&
    boot.bootstrap === true;
  return {
    ok,
    detail: `equal⇒raised=[${eq.raised}] lowered⇒raised=[${lo.raised}] raised(+1 valueSccs)⇒raised=[${hi.raised}] head=absent⇒bootstrap=${boot.bootstrap}`,
  };
}

const F = (body: string): string => `${body}\n`;

export const SELFTEST_CASES: SelftestCase[] = [
  {
    name: "value-cycle-two-files (A↔B both VALUE imports ⇒ valueSccs 1 ⇒ over baseline 0 ⇒ FAIL)",
    git: true,
    files: {
      "src/a.ts": F(`import { b } from "./b.ts";\nexport const a = 1;`),
      "src/b.ts": F(`import { a } from "./a.ts";\nexport const b = 2;`),
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 1, typeSccs: 0, reverseEdges: 0, exit: 1 },
    valueSccContains: ["src/a.ts", "src/b.ts"],
  },
  {
    name: "type-only-closure (A value-imports B, B `import type` back ⇒ PASS at valueSccs 0 ⇒ typeSccs +1)",
    git: true,
    files: {
      "src/a.ts": F(`import { b } from "./b.ts";\nexport const a = b;`),
      "src/b.ts": F(`import type { A } from "./a.ts";\nexport const b: A | null = null;`),
    },
    baseline: { valueSccs: 0, typeSccs: 1, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 1, reverseEdges: 0, exit: 0 },
  },
  {
    name: "reverse-edge (packages/x.ts → plugin/y.ts ⇒ reverseEdges 1 ⇒ FAIL at baseline 0)",
    git: true,
    files: {
      "packages/quay/src/x.ts": F(`import { y } from "../../../plugin/scripts/y.ts";\nexport const x = y;`),
      "plugin/scripts/y.ts": F(`export const y = 1;`),
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 1, exit: 1 },
    reverseEdgeFrom: ["packages/quay/src/x.ts"],
    reverseEdgeTo: ["plugin/scripts/y.ts"],
  },
  {
    name: "comment-and-string-mentions-not-counted (only `// import …` and \"import …\" text ⇒ 0 edges)",
    git: true,
    files: {
      "src/a.ts": F(
        `// import { b } from "./b.ts";\nexport const doc = 'import { b } from "./b.ts";';\nexport const a = 1;`,
      ),
      "src/b.ts": F(`import { a } from "./a.ts";\nexport const b = a;`),
    },
    // If the comment/string WERE counted, a and b would form a value cycle ⇒ valueSccs 1 (> baseline 0)
    // and the gate would go RED. The case asserts GREEN and valueSccs === 0.
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 0, exit: 0 },
  },
  {
    name: "kernel-boundary-violation (kernel file imports outside kernel ⇒ FAIL, kernelChecked true)",
    git: true,
    files: {
      "packages/quay/src/kernel/k.ts": F(`import { outside } from "../outside.ts";\nexport const k = outside;`),
      "packages/quay/src/outside.ts": F(`export const outside = 1;`),
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 0, kernelChecked: true, kernelViolations: 1, exit: 1 },
  },
  {
    name: "kernel-absent (no kernel dir ⇒ kernelChecked false, NOT conflated with 'checked and clean')",
    git: true,
    files: {
      "packages/quay/src/kernel-free.ts": F(`export const x = 1;`),
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 0, kernelChecked: false, kernelViolations: 0, exit: 0 },
  },
  {
    name: "non-git-directory (cannot enumerate ⇒ evaluated false + exit 2, NEVER exit 0)",
    git: false,
    files: { "src/a.ts": F(`import { b } from "./b.ts";`) },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: false, valueSccs: 0, typeSccs: 0, reverseEdges: 0, exit: 2 },
  },
];

function buildFixture(dir: string, c: SelftestCase): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(c.files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (!c.git) return;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  execFileSync("git", ["-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null", "init", "-q"], { cwd: dir, env, stdio: "pipe" });
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: dir, env, stdio: "pipe" });
}

/** Run one case end-to-end: fixture → readImportGraph → judge → compare every expected field. */
export function runSelftestCase(c: SelftestCase): { name: string; ok: boolean; detail: string } {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "import-graph-selftest-"));
  try {
    buildFixture(dir, c);
    const reading = readImportGraph(dir);
    const counts = countsOf(reading);
    const exit = reading.evaluated ? (judge(reading, c.baseline, c.baseline, null).ok ? 0 : 1) : 2;
    const problems: string[] = [];
    if (reading.evaluated !== c.expect.evaluated) problems.push(`evaluated=${reading.evaluated} want ${c.expect.evaluated}`);
    if (counts.valueSccs !== c.expect.valueSccs) problems.push(`valueSccs=${counts.valueSccs} want ${c.expect.valueSccs}`);
    if (counts.typeSccs !== c.expect.typeSccs) problems.push(`typeSccs=${counts.typeSccs} want ${c.expect.typeSccs}`);
    if (counts.reverseEdges !== c.expect.reverseEdges) problems.push(`reverseEdges=${counts.reverseEdges} want ${c.expect.reverseEdges}`);
    if (c.expect.kernelChecked !== undefined && reading.kernelChecked !== c.expect.kernelChecked) {
      problems.push(`kernelChecked=${reading.kernelChecked} want ${c.expect.kernelChecked}`);
    }
    if (c.expect.kernelViolations !== undefined && reading.kernelViolations.length !== c.expect.kernelViolations) {
      problems.push(`kernelViolations=${reading.kernelViolations.length} want ${c.expect.kernelViolations}`);
    }
    if (exit !== c.expect.exit) problems.push(`exit=${exit} want ${c.expect.exit}`);
    if (c.valueSccContains) {
      const hit = reading.valueSccs.some((s) => c.valueSccContains!.every((f) => s.files.includes(f)));
      if (!hit) problems.push(`no valueScc contains [${c.valueSccContains.join(", ")}]`);
    }
    if (c.reverseEdgeFrom && !reading.reverseEdges.some((e) => c.reverseEdgeFrom!.includes(e.from))) {
      problems.push(`no reverseEdge.from in [${c.reverseEdgeFrom.join(", ")}]`);
    }
    if (c.reverseEdgeTo && !reading.reverseEdges.some((e) => c.reverseEdgeTo!.includes(e.to))) {
      problems.push(`no reverseEdge.to in [${c.reverseEdgeTo.join(", ")}]`);
    }
    return {
      name: c.name,
      ok: problems.length === 0,
      detail:
        problems.length === 0
          ? `evaluated=${reading.evaluated} valueSccs=${counts.valueSccs} typeSccs=${counts.typeSccs} reverseEdges=${counts.reverseEdges} kernelChecked=${reading.kernelChecked} exit=${exit}`
          : problems.join("; "),
    };
  } catch (err) {
    return { name: c.name, ok: false, detail: `INFRASTRUCTURE: ${(err as Error).message.split("\n")[0]}` };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function runSelftest(): { ok: boolean; results: { name: string; ok: boolean; detail: string }[] } {
  const results = SELFTEST_CASES.map(runSelftestCase);
  const raise = runBaselineRaiseCase();
  results.push({
    name: "baseline-raised-above-head (AC5: raising ANY baseline axis past git HEAD ⇒ exit 1)",
    ok: raise.ok,
    detail: raise.detail,
  });
  return { ok: results.every((r) => r.ok), results };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `import-graph-check.ts — statement-position module dependency graph (value SCCs / type-only
SCCs / packages→plugin|experiments reverse edges / the conditional kernel boundary), shrink-only ratchet.

Usage:
  node --experimental-strip-types import-graph-check.ts [<root>] [--json] [--selftest] [--baseline <file>]

  <root>            repository root to analyze (default: this script's repo root).
  --json            machine-readable reading.
  --selftest        run the injected self-test cases (fixtures + the baseline-raise case) and exit.
  --baseline <f>    baseline file (default plugin/import-graph-baseline.json under <root>).

Exit: 0 = every quantity ≤ baseline, baseline not raised past HEAD, kernel boundary holds
      1 = a quantity exceeded the baseline / the baseline was raised / a kernel violation
      2 = usage or environment error, INCLUDING "the graph could not be read" (evaluated:false)`;

function defaultRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function reportReading(reading: GraphReading, v: RatchetVerdict | null, baseline: Baseline | null, asJson: boolean): void {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          evaluated: reading.evaluated,
          reason: reading.reason ?? null,
          files: reading.files,
          edges: reading.edges,
          valueEdges: reading.valueEdges,
          typeEdges: reading.typeEdges,
          valueSccs: reading.valueSccs,
          typeSccs: reading.typeSccs,
          reverseEdges: reading.reverseEdges,
          kernelChecked: reading.kernelChecked,
          kernelViolations: reading.kernelViolations,
          notAnalyzed: reading.notAnalyzed,
          dangling: reading.dangling,
          baseline,
          verdict: v,
        },
        null,
        2,
      ),
    );
    return;
  }
  const counts = countsOf(reading);
  console.log(
    `import-graph-check: files=${reading.files} edges=${reading.edges} (value ${reading.valueEdges} / type ${reading.typeEdges})`,
  );
  console.log(`  valueSccs=${counts.valueSccs} typeSccs=${counts.typeSccs} reverseEdges=${counts.reverseEdges}`);
  for (const s of reading.valueSccs) console.log(`  value SCC: ${s.files.join(", ")}`);
  for (const s of reading.typeSccs) console.log(`  type-only SCC: ${s.files.join(", ")}`);
  for (const e of reading.reverseEdges) console.log(`  reverse edge: ${e.from}:${e.line} → ${e.to}`);
  console.log(
    `  kernelChecked=${reading.kernelChecked}` +
      (reading.kernelChecked ? ` (violations=${reading.kernelViolations.length})` : " (packages/quay/src/kernel/ absent — not conflated with 'checked and clean')"),
  );
  console.log(`  notAnalyzed (tracked non-test, outside this checker's TS scope): mjs=${reading.notAnalyzed.mjs} js=${reading.notAnalyzed.js}`);
  if (reading.dangling.length > 0) console.log(`  dangling (tracked, no readable target — not a node): ${reading.dangling.join(", ")}`);
  if (baseline) console.log(`  baseline: ${JSON.stringify(baseline)}`);
  if (v) {
    console.log(`  headBaseline: ${v.bootstrap ? "absent-bootstrap" : JSON.stringify(v.headBaseline)}`);
    if (v.over.length > 0) console.log(`  OVER baseline on: ${v.over.join(", ")}`);
    if (v.baselineRaised.length > 0) console.log(`  BASELINE RAISED past HEAD on: ${v.baselineRaised.join(", ")}`);
    if (v.kernelBlocked) console.log(`  KERNEL BOUNDARY VIOLATED by ${reading.kernelViolations.length} edge(s)`);
  }
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);
  const asJson = args.includes("--json");

  if (args.includes("--selftest")) {
    const { ok, results } = runSelftest();
    if (asJson) {
      console.log(JSON.stringify({ selftest: results, ok }, null, 2));
    } else {
      console.log(`import-graph-check --selftest — ${results.length} injected case(s)`);
      for (const r of results) console.log(`  [${r.ok ? "ok" : "FAIL"}] ${r.name}\n      ${r.detail}`);
    }
    console.log(ok ? `PASS — all ${results.length} case(s) behaved` : "FAIL — see the cases above");
    return ok ? 0 : 1;
  }

  const positional = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--baseline"));
  const root = path.resolve(flagValue(args, "--root") ?? positional ?? defaultRoot());
  const baselineAbs = path.resolve(flagValue(args, "--baseline") ?? baselineFile(root));

  const reading = readImportGraph(root);
  if (!reading.evaluated) {
    reportReading(reading, null, null, asJson);
    process.stderr.write(`import-graph-check: NOT-EVALUATED — ${reading.reason ?? "the import graph could not be read"}\n`);
    return 2;
  }

  const baseline = readBaselineFile(baselineAbs);
  if (baseline === null) {
    reportReading(reading, null, null, asJson);
    process.stderr.write(
      `import-graph-check: NOT-EVALUATED — baseline file missing or malformed (${baselineAbs}); a checker that cannot read its baseline is never conflated with "≤ baseline"\n`,
    );
    return 2;
  }

  // HEAD comparison only applies when the baseline lives inside the analyzed root's repo (the
  // --baseline override in the self-test/mutation paths points at a temp file with no HEAD counterpart).
  const relForHead = path.relative(root, baselineAbs).split(path.sep).join("/");
  const inRepo = !relForHead.startsWith("../") && !path.isAbsolute(relForHead);
  let headBaseline: Baseline | null = null;
  if (inRepo) {
    try {
      execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { stdio: "pipe" });
      headBaseline = readHeadBaseline(root, relForHead);
    } catch {
      headBaseline = null; // no HEAD (a fresh fixture repo) ⇒ bootstrap
    }
  }

  const verdict = judge(reading, baseline, baseline, headBaseline);
  reportReading(reading, verdict, baseline, asJson);

  const counts = countsOf(reading);
  if (verdict.over.length > 0) {
    process.stderr.write(
      `import-graph-check: FAIL — ${verdict.over.map((k) => `${k} ${counts[k]} > baseline ${baseline[k]}`).join("; ")}\n`,
    );
    return 1;
  }
  if (verdict.baselineRaised.length > 0) {
    process.stderr.write(
      `import-graph-check: FAIL — the working-tree baseline was RAISED past git HEAD on ${verdict.baselineRaised.join(", ")} (a baseline may only shrink)\n`,
    );
    return 1;
  }
  if (verdict.kernelBlocked) {
    process.stderr.write(
      `import-graph-check: FAIL — ${reading.kernelViolations.length} import edge(s) leave ${KERNEL_DIR_REL}/ (first: ${reading.kernelViolations[0].from}:${reading.kernelViolations[0].line} → ${reading.kernelViolations[0].to})\n`,
    );
    return 1;
  }
  const boot = verdict.bootstrap
    ? ` (headBaseline: absent-bootstrap — HEAD carries no ${relForHead}; this reading is the new baseline)`
    : ` (headBaseline ${JSON.stringify(verdict.headBaseline)})`;
  process.stdout.write(
    `PASS — valueSccs=${counts.valueSccs} ≤ ${baseline.valueSccs}, typeSccs=${counts.typeSccs} ≤ ${baseline.typeSccs}, reverseEdges=${counts.reverseEdges} ≤ ${baseline.reverseEdges}${boot}\n`,
  );
  return 0;
}

if (isDirectEntry(import.meta, undefined, "import-graph-check")) {
  process.exit(main(process.argv));
}
