#!/usr/bin/env node
// archguard-runner.ts — gap-archguard-zero-production-calls: the REAL mechanism that wires
// archguard (CLI, not the MCP tool) into the suite as a fail-closed structural gate.
//
// CLAUDE.md 明令「archguard (MCP) — Consult it before calling a milestone done」而实测 `.archguard/`
// 从未被真实调用（8 处命中全是「另一个项目名」的提及，零个真实 MCP 调用）。本 runner 是那条规定
// 的机械落地：它在 suite 里【真实】跑 `archguard analyze`（不是注释、不是项目名提及——按位置判定，
// 见 AC1），把分析产物读回来当判据（判据读到 —— AC3 的「被某判据读」半边），并 fail-closed（注掉
// 调用 ⇒ 读不到产物 ⇒ 红 —— AC2 负控制）。
//
// STRUCTURAL SIGNAL（DoD「依赖结构」维度）: 两个【不同的】粒度，各自是独立读数（gap-archguard-
// structural-gate-reads-entity-scc-not-directory-cycles）：
//   • entitySccCount      — class/all-classes.json 的 `metricVector.sccCount`，实体/类粒度 SCC。
//   • directoryCycleCount — query/<scope>/arch.json 的 `extensions.tsAnalysis.moduleGraph.cycles`，
//                           目录级环（MCP `detect_cycles(outputScope=package)` 的同一数据源）。
// ⛔ 二者不可互相代替：实测 ClaudeCodeUI chat scope（HEAD 6952b3091）目录环 8 元而实体 cycleCount
// 全 0；本仓库的 2 文件 fixture（a/x.ts 与 b/y.ts 互相 side-effect import）同样是 sccCount=0 而
// moduleGraph.cycles=[["b","a"]]。只读前者 ⇒ 只有目录环的树恒绿（false-clean）。
// 环是一个【无阈值的布尔不变量】——0 = 无环, >0 = 有环 —— 不引入任何数值阈值（CLAUDE.md 硬规则 4
// 推论一：成本结构未知前不设数值阈值）。god-package / 重复抽象是需要阈值的维度，留待数据积累
// （本 runner 每次把 maxInDegree/maxOutDegree 记进 metrics-history，供日后有数据再设阈）。
//
// ── 三态（gap-archguard-runner-missing-not-evaluated-state-and-version；CLAUDE.md 硬规则 3b）─────
// 旧实现把 `Number(mv.sccCount ?? 0)` 当读数：产物路径错、分析为空、metricVector 缺失时都得到 0 并
// 通过 ——「读不到」与「无环」同形。现在每条 scope 信号带 `evaluated: boolean` + `reason`：
//   • evaluated:true  — 真的跑了 analyze、真的读到了产物、metricVector 有数值字段（entity）/
//                       moduleGraph.cycles 可读（directory）。
//   • evaluated:false — 产物缺失/不可解析/无 metricVector/sourceFiles 缺失/0 实体/git 对账失败/
//                       analyze 非 0（entity）；manifest 缺失/无匹配 scope/arch.json 不可读/
//                       moduleGraph 或 cycles 缺失（directory）—— 数值字段一律 `null`
//                       （⛔ 不以 0 冒充「无环」），exit 1。
// `evaluated:false` 仍然【写进 metrics-history】—— 读不到也必须落痕，否则「没跑」与「跑干净」同形。
//
// ── 版本与覆盖率对账（同一 gap 任务）──────────────────────────────────────────────────────────────
// archguard 0.1.35→0.1.40 间 `detect_cycles` 返回形状与 scope 解析已变，跨版本记录不可比 ⇒ 每条
// HistoryRecord 带 `archguardVersion`（`archguard --version` 首行，读不到 ⇒ evaluated:false）、
// `sourceFiles`（产物里真实分析到的文件数，按 realpath 去重）与 `entityCount`。
// `sourceFiles` 与 `git ls-files <source> | wc -l` 是【两个独立口径】；不一致时 reason 点名差异
// （含同一 realpath 被解析两次的 symlink 重复解析——实测 454+46=500），⛔ 不静默吞掉。
// 0 实体 fail-closed：source 目录有 git 跟踪文件而 analyze 出 0 实体 ⇒ exit 1（「该有文件却 0 实体」
// 不是「干净」）。
//
// FAIL-CLOSED（AC2）: 只要「读不到 archguard 的分析产物」就 exit 1 —— archguard CLI 缺失、
// analyze 失败、class/all-classes.json 缺失/不可解析、metricVector 缺数值、任一条 evaluated:false、
// entitySccCount > 0，全部 exit 1（红）。directory 读数同理：manifest/moduleGraph 读不到 ⇒
// directoryCyclesEvaluated:false ⇒ exit 1（⛔ 不是「0 环」），directoryCycleCount > 0 ⇒ exit 1。
// exit 0 仅当「真的跑了 analyze、每条 scope 的两个粒度都 evaluated、且两粒度全为 0」。
// 一个「注掉调用后仍绿」的检查是假保证（CLAUDE.md 硬规则 3b：读不懂输入不得返回与合格同形的值）。
//
// CARRIER（AC3）: 每次跑完（含 fail-closed）把结构信号 append 进 `<work-dir>/metrics-history.jsonl`
// （默认 `<root>/.archguard/metrics-history.jsonl`；追加，不覆盖），使 `.archguard/` 的产物进入一个
// 【可查】载体（`cat .archguard/metrics-history.jsonl` 即可读到逐次的结构信号史）。`.archguard/`
// 本身 gitignored（archguard 自己的 cache/metrics），故 AC3 走「被某判据读」半边（本 runner 读
// class/all-classes.json），不走「git 提交」半边。
//
// CROSS-SCOPE BOUNDARY（gap-archguard-cross-scope-edges-structurally-invisible）: 六个 SCOPES 各自
// 单独分析（multi-source ⇒ 每 source 一个 scope），跨 scope 边（`plugin/scripts` ↔ `packages/*/src`）
// 【结构上不存在于任何一次分析】。因此本 runner 对跨 scope 环的结论不是「测得 0」，而是【未测】：
// 每条 metrics 记录带 `crossScope:"not-evaluated"` + 非空 `crossScopeReason`（⛔ 缺席或 0/false 都
// 会让「没测」与「干净」同形）。真正测到跨 scope 边需要单根复制分析，是后续任务、不在本 runner 内。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root>
//                                        [--work-dir <dir>]   # default <root>/.archguard
//
// Test seams (⛔ not switches a production caller sets):
//   --work-dir <dir>        put archguard's work dir (and metrics-history carrier) elsewhere; pointing
//                           it at a path the analyze did not write is the AC1 negative control.
//   ARCHGUARD_RUNNER_CLI    resolve the archguard executable from this path instead of PATH, so the
//                           negative controls can inject a fake CLI (this host has no archguard on PATH).
//
// Exit: 0 = 六个 scope 都跑通 analyze、两个粒度都 evaluated、且 entitySccCount 与
//           directoryCycleCount 全 0（PASS）;
//       1 = 结构违例（entitySccCount > 0 或 directoryCycleCount > 0）或任一条 not-evaluated
//           （fail-closed RED —— archguard 缺失/analyze 失败/产物缺失/不可解析/0 实体/版本读不到/
//           moduleGraph 读不到）;
//       2 = usage/environment error（缺 --root）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

// ── The six scopes archguard analyzes. Each scope carries an EXPLICIT label (NOT basename(sourceDir)):
//    packages/quay-native|github|backlog all have a `src/` basename (and two dirs a `scripts/` basename),
//    so a basename-derived label would silently overwrite the earlier scopes' output (the trap reproduced
//    during the gap-archguard-scope-expand-provider-packages-experiments probe). The label is passed to
//    `runAnalyze` as `--output-dir output/<label>`, so each scope's output lands in its OWN parent dir
//    (output/<label>/<basename>/class/all-classes.json) and no scope's product is eaten by another's.
//    The label must therefore be unique across SCOPES (it is NOT archguard's own basename-derived label,
//    which the runner deliberately does not rely on).
const SCOPES: Array<{ source: string; label: string }> = [
  { source: "packages/quay/src", label: "src" },
  { source: "plugin/scripts", label: "scripts" },
  { source: "packages/quay-native/src", label: "quay-native-src" },
  { source: "packages/quay-github/src", label: "quay-github-src" },
  { source: "packages/quay-backlog/src", label: "quay-backlog-src" },
  { source: "experiments/quay-perpetual-stream/scripts", label: "experiments-scripts" },
];

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────

/** One directory-level cycle (a strongly connected component of the TS module graph, size > 1). */
export interface DirectoryCycle {
  size: number;
  modules: string[];
}

/** One scope's structural reading. `evaluated:false` ⇒ every numeric field is `null` (⛔ never 0):
 *  a scope the runner could not read must not carry the same values as a scope with no cycles.
 *
 *  TWO INDEPENDENT GRANULARITIES:
 *   • entitySccCount       — class artifact `metricVector.sccCount` (gated by `evaluated`/`reason`).
 *   • directoryCycleCount  — query artifact `extensions.tsAnalysis.moduleGraph.cycles` (gated by
 *                            `directoryCyclesEvaluated`/`directoryCyclesReason`).
 *  They are NOT two names for one number: a directory cycle made of side-effect imports yields
 *  entitySccCount=0 while directoryCycleCount>=1 (measured on a 2-file fixture). */
interface ScopeSignal {
  scope: string;
  evaluated: boolean;
  reason: string | null;
  entitySccCount: number | null;
  entityCount: number | null;
  totalRelations: number | null;
  maxInDegree: number | null;
  maxOutDegree: number | null;
  /** Unique files the analyze actually reported (deduped by realpath). */
  sourceFiles: number | null;
  /** Independent caliber: `git ls-files <source> | wc -l` (AC4). */
  gitSourceFiles: number | null;
  /** Directory-granularity reading — independently three-valued (AC4: no module graph ⇒
   *  evaluated:false + reason, NOT the same value as "0 cycles"). */
  directoryCyclesEvaluated: boolean;
  directoryCyclesReason: string | null;
  directoryCycleCount: number | null;
  /** The cycles themselves (so the failure message can name their members). null when unevaluated. */
  directoryCycles: DirectoryCycle[] | null;
  /** Which evidence the directory reading came from (`module-graph` / `single-directory`), null when
   *  unevaluated — carried so a run record says WHY an absent module graph was still readable. */
  directoryCyclesBasis: "module-graph" | "single-directory" | null;
}

interface HistoryRecord {
  timestamp: string;
  tool: "archguard-runner";
  commitSha: string | null;
  /** `archguard --version` (first line). null ⇒ the record cannot be compared to other versions ⇒
   *  the record is marked evaluated:false (version drift 0.1.35→0.1.40 changed the output shape). */
  archguardVersion: string | null;
  evaluated: boolean;
  reason: string | null;
  /** Entity/class-granularity aggregate (sum over scopes). null unless EVERY scope was evaluated. */
  entitySccCount: number | null;
  entitySccEvaluated: boolean;
  entitySccReason: string | null;
  /** Directory-granularity aggregate (sum over scopes). null unless EVERY scope was evaluated. */
  directoryCycleCount: number | null;
  directoryCyclesEvaluated: boolean;
  directoryCyclesReason: string | null;
  sourceFiles: number | null;
  entityCount: number | null;
  verdict: "pass" | "fail";
  /** Cross-scope dependency edges (`plugin/scripts` ↔ `packages/<pkg>/src`) are STRUCTURALLY ABSENT from
   *  every analysis: SCOPES below are analyzed one source at a time (multi-source ⇒ one scope per
   *  source, no cross-scope edges; only a single-root copy produces them). So "no cross-scope cycles"
   *  is NOT a measured 0 — it was never evaluated. The literal `"not-evaluated"` (never `false` /
   *  `0` / omitted) makes the boundary visible on every record (硬规则 3b/4: an unmeasured edge set
   *  must not share the value of a measured-clean one).
   *  gap-archguard-cross-scope-edges-structurally-invisible. */
  crossScope: "not-evaluated";
  /** Why cross-scope edges are unmeasured. Non-empty by construction — `crossScope` alone would say
   *  "not evaluated" without saying WHICH boundary, which reads the same as a generic unreadable. */
  crossScopeReason: string;
  scopes: ScopeSignal[];
}

/** The invariant carried by EVERY metrics record (including fail-closed ones): the six SCOPES are
 *  analyzed independently, so no analysis can contain a cross-scope edge. Spread into each record so
 *  a record can never be written without the boundary declaration. */
const CROSS_SCOPE_NOT_EVALUATED = {
  crossScope: "not-evaluated",
  crossScopeReason:
    "six scopes are analyzed independently (one scope per source ⇒ no cross-scope edges); " +
    "plugin/scripts ↔ packages/*/src edges are absent from EVERY analysis — unmeasured, not measured-zero",
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────

function fail(msg: string): never {
  process.stderr.write(`archguard-runner: ${msg}\n`);
  process.exit(1);
}

function usage(msg: string): never {
  process.stderr.write(`archguard-runner: ${msg}\n`);
  process.stderr.write(
    "usage: node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root> [--work-dir <dir>]\n"
  );
  process.exit(2);
}

/** Where a resolved archguard CLI came from. The provenance is recorded on every refresh so a
 *  not-evaluated record can say WHERE the instrument was looked for instead of only "absent". */
export type ArchguardCliSource = "env" | "path" | "plugin";

export interface ArchguardCliResolution {
  cli: string | null;
  source: ArchguardCliSource | null;
  /** The resolved entry is a JS file that is not directly executable ⇒ it must be spawned as
   *  `node <cli>` (a plugin runtime installed without the exec bit is still a real instrument). */
  viaNode: boolean;
  /** Every location probed, in order — so `not-evaluated:instrument-absent` can name them (硬规则 3b/6). */
  searched: string[];
}

/** `@yalehwang/archguard`'s CLI entry, relative to a resolved package root. This is the SAME entry the
 *  archguard Claude plugin's own MCP launcher execs (`mcp-launcher.mjs`'s `ENTRY`). */
const ARCHGUARD_PKG_NAME = "@yalehwang/archguard";
const ARCHGUARD_CLI_REL = path.posix.join("dist", "cli", "index.js");

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The Claude plugin roots to consult. `$CLAUDE_CONFIG_DIR` wins when set (Claude Code honours it),
 *  otherwise `~/.claude` — ⛔ the caller's absolute home path is never written down here. */
function claudePluginRoots(): string[] {
  const roots: string[] = [];
  const cfg = (process.env.CLAUDE_CONFIG_DIR ?? "").trim();
  if (cfg) roots.push(path.join(cfg, "plugins"));
  try {
    roots.push(path.join(os.homedir(), ".claude", "plugins"));
  } catch {
    /* no home dir ⇒ this source contributes nothing */
  }
  return [...new Set(roots)];
}

/** Plugin install directories that could carry the archguard runtime, newest install record first.
 *  Two sources, both read from the install metadata rather than a hardcoded path:
 *   (b) `installed_plugins.json` — `archguard@<marketplace>` entries' `installPath`;
 *   (c) the cache layout `<plugins>/cache/<marketplace>/archguard/<version>/` (version dirs are
 *       DISCOVERED, never pinned — the same rule `mcp-blacklist-resolve.ts` follows). */
function archguardPluginCandidateRoots(pluginsRoot: string): string[] {
  const out: string[] = [];
  const push = (p: unknown) => {
    if (typeof p === "string" && p.length > 0 && !out.includes(p) && fs.existsSync(p)) out.push(p);
  };
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(pluginsRoot, "installed_plugins.json"), "utf8"));
    const plugins = rec?.plugins;
    if (plugins && typeof plugins === "object" && !Array.isArray(plugins)) {
      for (const [key, entries] of Object.entries(plugins as Record<string, unknown>)) {
        if (!key.startsWith("archguard@")) continue;
        for (const e of Array.isArray(entries) ? entries : []) push((e as Record<string, unknown> | null)?.installPath);
      }
    }
  } catch {
    /* install record missing/unreadable ⇒ this source contributes nothing (the cache glob still applies) */
  }
  try {
    const cacheParent = path.join(pluginsRoot, "cache");
    for (const marketplace of fs.readdirSync(cacheParent)) {
      const pkgParent = path.join(cacheParent, marketplace, "archguard");
      let versions: string[] = [];
      try {
        versions = fs.readdirSync(pkgParent);
      } catch {
        continue;
      }
      for (const v of versions) push(path.join(pkgParent, v));
    }
  } catch {
    /* no plugin cache ⇒ nothing */
  }
  return out;
}

/** Resolve the archguard CLI entry under one plugin install dir. Checks, in order:
 *   1. `createRequire(<plugin>/package.json)` — the plugin's own dependency tree (nested or hoisted);
 *   2. `<plugin>/node_modules/@yalehwang/archguard/dist/cli/index.js`;
 *   3. the Claude Code npm-cache sibling: walk UP from the plugin root and take the first
 *      `<ancestor>/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js`.
 *  (3) exists because Claude Code installs plugin dependencies into a sibling `npm-cache` OUTSIDE the
 *  upward node_modules walk — the same discovery the plugin's own launcher performs. */
function resolveArchguardInPluginRoot(pluginRoot: string, searched: string[]): string | null {
  const direct = path.join(pluginRoot, "node_modules", ...ARCHGUARD_PKG_NAME.split("/"), ...ARCHGUARD_CLI_REL.split("/"));
  searched.push(direct);
  if (isFile(direct)) return direct;
  try {
    const req = createRequire(path.join(pluginRoot, "package.json"));
    const resolved = req.resolve(`${ARCHGUARD_PKG_NAME}/${ARCHGUARD_CLI_REL}`);
    searched.push(`createRequire(${pluginRoot}) → ${resolved}`);
    if (isFile(resolved)) return resolved;
  } catch (err) {
    searched.push(`createRequire(${pluginRoot}) → ${(err as Error)?.message?.split("\n")[0] ?? "unresolvable"}`);
  }
  let cur = path.resolve(pluginRoot);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(cur, "npm-cache", "node_modules", ...ARCHGUARD_PKG_NAME.split("/"), ...ARCHGUARD_CLI_REL.split("/"));
    searched.push(candidate);
    if (isFile(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/** Resolve the archguard CLI, WITH provenance and the list of probed locations.
 *
 *  Order (Plan 步骤 4 of gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts):
 *    1. `ARCHGUARD_RUNNER_CLI` — the negative-control seam; when set it WINS and a missing path is a
 *       hard null (no silent fallthrough to PATH, which would make the negative control vacuous);
 *    2. PATH (`command -v archguard`);
 *    3. an INSTALLED archguard plugin runtime, discovered from the plugin install metadata.
 *  Step 3 is what makes the routine's refresh possible on this host at all: archguard 0.1.42 is
 *  installed as a Claude plugin (`~/.claude/plugins/...`) and is NOT on PATH, so the old two-step
 *  resolver answered null while the instrument was right there. */
export function resolveArchguardCliWithSource(): ArchguardCliResolution {
  const searched: string[] = [];
  const override = (process.env.ARCHGUARD_RUNNER_CLI ?? "").trim();
  if (override) {
    searched.push(`ARCHGUARD_RUNNER_CLI=${override}`);
    if (fs.existsSync(override)) {
      return { cli: override, source: "env", viaNode: !isExecutableFile(override), searched };
    }
    return { cli: null, source: null, viaNode: false, searched };
  }
  searched.push("PATH (command -v archguard)");
  const r = spawnSync("sh", ["-c", "command -v archguard"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) {
    const cli = r.stdout.trim();
    return { cli, source: "path", viaNode: !isExecutableFile(cli), searched };
  }
  for (const pluginsRoot of claudePluginRoots()) {
    const candidates = archguardPluginCandidateRoots(pluginsRoot);
    if (candidates.length === 0) searched.push(`${pluginsRoot} (no archguard plugin install recorded)`);
    for (const pluginRoot of candidates) {
      const found = resolveArchguardInPluginRoot(pluginRoot, searched);
      if (found) return { cli: found, source: "plugin", viaNode: !isExecutableFile(found), searched };
    }
  }
  return { cli: null, source: null, viaNode: false, searched };
}

/** Resolve the archguard CLI. `ARCHGUARD_RUNNER_CLI` is the negative-control seam (the fake CLI);
 *  production resolution is PATH, then an installed plugin runtime (see the resolver above).
 *  null ⇒ fail-closed (the meter must be runnable).
 *  **Exported** (gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init): the
 *  architecture-analysis probe's host-availability preflight asks the SAME question ("is archguard
 *  installed here?") and must not grow a second reader of it (硬规则 5b). */
export function resolveArchguardCli(): string | null {
  return resolveArchguardCliWithSource().cli;
}

/** `archguard --version` first line. null ⇒ version source unreadable (record becomes evaluated:false). */
function readArchguardVersion(cli: string, viaNode = false): string | null {
  const r = viaNode
    ? spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" })
    : spawnSync(cli, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const first = String(r.stdout ?? "").trim().split("\n")[0].trim();
  return first.length > 0 ? first : null;
}

/** Run `archguard analyze` on ONE source dir. Returns the exit code (0 = ok).
 *
 *  ⚠️ `--output-dir <workDir>/output/<label>` is NOT optional: archguard derives its own output subdir
 *  from the source's BASENAME (`output/<basename>/class/all-classes.json`), and three provider packages
 *  all share the `src/` basename (plus two `scripts/` dirs). Without a per-scope output-dir the later
 *  analyzes would silently overwrite the earlier ones' `output/src/` / `output/scripts/` (the trap
 *  reproduced in gap-archguard-scope-expand-provider-packages-experiments' probe). The explicit `label`
 *  parents each scope's output so the basename collision is contained and never eats another scope. */
function runAnalyze(
  cli: string,
  root: string,
  workDir: string,
  source: string,
  label: string,
  opts: {
    /** Restrict the generated diagram levels. `package` is what makes archguard build the module
     *  graph (`diagram-processor.ts`'s `needsModuleGraph`), i.e. what puts `extensions.tsAnalysis
     *  .moduleGraph` into the query artifact. Without it the artifact has no cycles to read — the
     *  exact state that made 25/25 arch-cycle rounds unevaluable. */
    diagrams?: string[];
    /** Output subdir under `<workDir>/output`. Defaults to the scope label; the refresh path passes
     *  its own so a package-only run can never overwrite the on-demand runner's class artifact. */
    outputLabel?: string;
    viaNode?: boolean;
    /** Pass `--no-cache`. The refresh uses it: its whole trigger is "the sources moved after this
     *  artifact", and a cache hit would rewrite the query artifact with the PREVIOUS run's timestamp
     *  (measured: a 2.1s run restored the old `arch.json` verbatim), leaving `behindSources` exactly
     *  where it was. One forced re-analysis per interval is what the refresh is FOR. */
    noCache?: boolean;
  } = {},
): number {
  const outputDir = path.join(workDir, "output", opts.outputLabel ?? label);
  const argv = [
    "analyze",
    "--lang",
    "typescript",
    "--format",
    "json",
    ...(opts.diagrams && opts.diagrams.length > 0 ? ["--diagrams", ...opts.diagrams] : []),
    ...(opts.noCache ? ["--no-cache"] : []),
    "--work-dir",
    workDir,
    "--output-dir",
    outputDir,
    "-s",
    source,
  ];
  const r = opts.viaNode
    ? spawnSync(process.execPath, [cli, ...argv], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    : spawnSync(cli, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    process.stderr.write(
      `archguard-runner: analyze failed for ${source} (exit ${r.status})\n${(r.stderr || "").split("\n").slice(-5).join("\n")}\n`
    );
  }
  return r.status ?? 1;
}

/** Independent caliber for AC4: `git ls-files <source> | wc -l`. null ⇒ git could not answer
 *  (missing repo / git error) ⇒ the reconciliation is NOT EVALUATED (硬规则 6: 缺值 ≠ 为假). */
function gitTrackedFileCount(root: string, source: string): number | null {
  const r = spawnSync("git", ["ls-files", "--", source], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout ?? "").split("\n").filter((l) => l.trim().length > 0).length;
}

/** `git ls-files -z -- <source>` as a list. null ⇒ git could not answer (⛔ never `[]`, which would read
 *  as "a scope with no files"). */
function gitTrackedFiles(root: string, source: string): string[] | null {
  const r = spawnSync("git", ["ls-files", "-z", "--", source], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout ?? "").split("\0").filter((l) => l.length > 0);
}

/** TypeScript module files vs. test files. Test files are excluded from the single-directory judgment:
 *  they are not modules of the production graph (and are frequently in a sibling `__tests__/`). */
const TS_SOURCE_FILE_RE = /\.(ts|tsx|mts|cts)$/;
const TS_TEST_FILE_RE = /\.(test|spec)\.[cm]?[tj]sx?$/;

/** The structural basis for a scope whose query artifact carries no `moduleGraph`.
 *
 *  WHY THIS EXISTS (gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts): archguard
 *  only builds `extensions.tsAnalysis.moduleGraph` when the analysis REQUESTED the package-level
 *  diagram (`diagram-processor.ts`'s `needsModuleGraph`). For `packages/quay-github/src` and
 *  `packages/quay-backlog/src` no such request was ever made, so their artifacts carry no graph — and
 *  the old reading collapsed that into "not evaluated", voiding the whole aggregate forever.
 *  A scope whose tracked non-test TypeScript files ALL live in the scope directory itself cannot have
 *  a directory-level cycle (an SCC of directory nodes needs ≥2 distinct nodes). That conclusion is
 *  derived from the FILE LIST — ⛔ never from the absence of `moduleGraph` (硬规则 3b: "no graph" only
 *  says "not requested", it does not say "acyclic").
 *
 *  Returns `single:false` with a REASON whenever the judgment is impossible (git failed / no source
 *  files) — so the caller can spell out why it fell back to not-evaluated. */
export function singleDirectoryBasis(
  root: string,
  source: string,
): { single: boolean; files: number; dirs: string[]; reason: string | null } {
  const all = gitTrackedFiles(root, source);
  if (all === null) {
    return { single: false, files: 0, dirs: [], reason: `git ls-files -- ${source} failed — the single-directory judgment is NOT evaluated` };
  }
  const srcDir = path.posix.normalize(source.replace(/\/+$/, ""));
  const dirs = new Set<string>();
  let files = 0;
  for (const f of all) {
    if (!TS_SOURCE_FILE_RE.test(f) || TS_TEST_FILE_RE.test(f)) continue;
    if (/(^|\/)__tests__\//.test(f)) continue;
    files += 1;
    dirs.add(path.posix.dirname(f));
  }
  if (files === 0) {
    return { single: false, files: 0, dirs: [], reason: `no tracked non-test TypeScript files under ${source}` };
  }
  const sorted = [...dirs].sort();
  return { single: sorted.length === 1 && sorted[0] === srcDir, files, dirs: sorted, reason: null };
}

/** How many commits AFTER `since` touched `source`. null ⇒ not computable (bad timestamp / git error),
 *  ⛔ never 0 — "could not tell" must not read as "nothing changed since".
 *
 *  ⚠️ TWO git-timestamp traps, both measured:
 *   1. An out-of-range `--since` is SILENTLY IGNORED (e.g. `2999-01-01` returns the FULL history). A
 *      future timestamp therefore never reaches git: no commit can be after it ⇒ 0.
 *   2. `--since` is INCLUSIVE at second granularity, so a commit made in the SAME second as the
 *      artifact counts as "after" it. Right after a refresh that is always the case ⇒ every refreshed
 *      scope would immediately re-report itself as behind and be re-analyzed forever. The window is
 *      therefore shifted to strictly-after the artifact's second: a same-second commit is treated as
 *      covered by the analysis (it read the tree at some point inside that second). */
export function commitsSince(root: string, source: string, since: string | null): number | null {
  if (typeof since !== "string" || since === "") return null;
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return null;
  if (sinceMs > Date.now()) return 0;
  const strictlyAfter = new Date(Math.floor(sinceMs / 1000) * 1000 + 1000).toISOString();
  const r = spawnSync("git", ["rev-list", "--count", `--since=${strictlyAfter}`, "HEAD", "--", source], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const n = Number.parseInt(String(r.stdout ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function numeric(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** realpath when it resolves, else the absolute path — used to match the manifest's `sources`
 *  (archguard normalizes with realpathOrSelf(path.resolve(s))) against our own source spelling. */
function normalizeFsPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Directory-granularity reading, taken from the query artifact that `archguard analyze` persists
 *  under `<workDir>/query/` (`manifest.json` + `<scope.key>/arch.json`).
 *
 *  WHY this source (gap-archguard-structural-gate-reads-entity-scc-not-directory-cycles): the class
 *  artifact's `metricVector.sccCount` is ENTITY granularity. Directory cycles live only in
 *  `extensions.tsAnalysis.moduleGraph.cycles` — the same data the MCP `detect_cycles(outputScope=
 *  package)` surface reads. Reading the class artifact alone is false-clean on a tree whose only
 *  cycles are directory-level.
 *
 *  Three-valued (硬规则 3b): any of {no manifest, no scope for this source, arch.json unreadable,
 *  no tsAnalysis.moduleGraph, malformed cycles} ⇒ evaluated:false + reason, never `count: 0`.
 */
/** Read `<workDir>/query/manifest.json` — the ONE place the query-artifact layout is spelled.
 *
 *  Both readers below (directory cycles and the graph summary) resolve their artifacts through this
 *  helper, so the layout / parse-failure vocabulary is one implementation, not a paraphrase (the
 *  same single-source-of-truth reason `readDirectoryCycleReading` exists at all). */
function readQueryManifest(
  workDir: string,
): { ok: true; manifestFile: string; manifest: any } | { ok: false; code: "unreadable" | "malformed"; reason: string } {
  const queryDir = path.join(workDir, "query");
  const manifestFile = path.join(queryDir, "manifest.json");
  let manifestRaw: string;
  try {
    manifestRaw = fs.readFileSync(manifestFile, "utf8");
  } catch {
    return { ok: false, code: "unreadable", reason: `cannot read query manifest ${manifestFile}` };
  }
  try {
    return { ok: true, manifestFile, manifest: JSON.parse(manifestRaw) };
  } catch {
    return { ok: false, code: "malformed", reason: `query manifest ${manifestFile} is not valid JSON` };
  }
}

/** Read one query scope's `arch.json` by manifest key. Failure is a REASON, never an empty artifact
 *  (硬规则 3b: "could not read" must not look like "the graph is empty"). */
function readQueryScopeArch(
  workDir: string,
  key: string,
): { ok: true; archFile: string; arch: any } | { ok: false; code: "unreadable" | "malformed"; reason: string } {
  const archFile = path.join(workDir, "query", key, "arch.json");
  let raw: string;
  try {
    raw = fs.readFileSync(archFile, "utf8");
  } catch {
    return { ok: false, code: "unreadable", reason: `cannot read query scope artifact ${archFile}` };
  }
  try {
    return { ok: true, archFile, arch: JSON.parse(raw) };
  } catch {
    return { ok: false, code: "malformed", reason: `query scope artifact ${archFile} is not valid JSON` };
  }
}

function readDirectoryCycles(root: string, workDir: string, source: string): {
  directoryCyclesEvaluated: boolean;
  directoryCyclesReason: string | null;
  directoryCycleCount: number | null;
  directoryCycles: DirectoryCycle[] | null;
  /** WHICH measurement produced this reading: `module-graph` (read from the artifact's
   *  `extensions.tsAnalysis.moduleGraph`) or `single-directory` (derived from the tracked file list
   *  because no package-level diagram was requested). null ⇒ not evaluated. A reader must be able to
   *  tell the two apart: they are different evidence for the same "0 cycles". */
  directoryCyclesBasis: "module-graph" | "single-directory" | null;
  /** WHEN the artifact this reading came from was produced (`arch.json.timestamp`, falling back to the
   *  manifest scope's `generatedAt`). null ⇒ no artifact was read. A reading without this cannot be
   *  told apart from a current one (硬规则 4b: stale readings look exactly like fresh ones). */
  artifactTimestamp: string | null;
} {
  const notEvaluated = (reason: string, artifactTimestamp: string | null = null) => ({
    directoryCyclesEvaluated: false,
    directoryCyclesReason: reason,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null,
    artifactTimestamp,
  });

  const manifestRead = readQueryManifest(workDir);
  if (!manifestRead.ok) {
    return notEvaluated(
      manifestRead.code === "unreadable"
        ? `${manifestRead.reason} — directory-level cycles are NOT evaluated (not "0 cycles")`
        : manifestRead.reason
    );
  }
  const { manifestFile, manifest } = manifestRead;
  const entries: any[] = Array.isArray(manifest?.scopes) ? manifest.scopes : [];
  if (entries.length === 0) {
    return notEvaluated(`query manifest ${manifestFile} lists no scopes`);
  }

  const wanted = normalizeFsPath(path.resolve(root, source));
  const matches = entries.filter(
    (e) => Array.isArray(e?.sources) && e.sources.some((s: unknown) => typeof s === "string" && normalizeFsPath(s) === wanted)
  );
  if (matches.length === 0) {
    return notEvaluated(
      `query manifest ${manifestFile} has no scope covering ${source} — directory-level cycles are NOT evaluated`
    );
  }
  // Stale duplicate scopes can survive `persistQueryScopes`' merge; the newest write is the reading.
  matches.sort((a, b) => String(b?.generatedAt ?? "").localeCompare(String(a?.generatedAt ?? "")));
  const entry = matches[0];
  if (typeof entry?.key !== "string" || entry.key.length === 0) {
    return notEvaluated(`query manifest ${manifestFile}: the matching scope has no key`);
  }
  // The manifest scope's own write time is the fallback freshness source when the arch.json itself
  // carries no `timestamp` (older archguard versions / hand-written fixtures).
  const manifestTimestamp =
    typeof entry.generatedAt === "string" && entry.generatedAt !== "" ? entry.generatedAt : null;

  const archRead = readQueryScopeArch(workDir, entry.key);
  if (!archRead.ok) {
    // Same wording as before the helper extraction: an unreadable artifact is spelled out as a
    // not-evaluated reading (never "0 cycles"); a malformed one keeps its own reason.
    return notEvaluated(
      archRead.code === "unreadable"
        ? `${archRead.reason} — directory-level cycles are NOT evaluated`
        : archRead.reason,
      manifestTimestamp
    );
  }
  const { arch } = archRead;
  // ⛔ THE FRESHNESS OF THIS READING: the artifact's own `timestamp` is authoritative; the manifest
  // entry's `generatedAt` is the fallback. It is recorded even on the not-evaluated paths below
  // (an artifact WAS read — it just lacked a moduleGraph), so a routine record can always say HOW OLD
  // the data it looked at is (gap-arch-cycle-report-record-artifact-timestamp).
  const artifactTimestamp =
    typeof arch.timestamp === "string" && arch.timestamp !== "" ? arch.timestamp : manifestTimestamp;

  const moduleGraph = arch?.extensions?.tsAnalysis?.moduleGraph;
  if (moduleGraph == null || typeof moduleGraph !== "object") {
    // ⛔ "NO GRAPH" IS NOT "ACYCLIC" (硬规则 3b): archguard only builds the module graph when the
    // analysis requested the package-level diagram. The ONE thing that may turn an absent graph into a
    // real reading is the scope's own FILE LIST — a scope whose tracked non-test .ts files all live in
    // one directory cannot have a directory-level cycle. That is the single-directory basis.
    const sd = singleDirectoryBasis(root, source);
    if (sd.single) {
      return {
        directoryCyclesEvaluated: true,
        directoryCyclesReason: null,
        directoryCycleCount: 0,
        directoryCycles: [],
        directoryCyclesBasis: "single-directory",
        artifactTimestamp,
      };
    }
    const why = sd.reason
      ?? `${sd.files} tracked non-test TypeScript file(s) across ${sd.dirs.length} directories (${sd.dirs.slice(0, 4).join(", ")}${sd.dirs.length > 4 ? ", …" : ""}) — NOT single-directory`;
    return notEvaluated(
      `moduleGraph not produced (package-level diagram not requested) — query scope ${entry.key} for ${source} has no extensions.tsAnalysis.moduleGraph (language: ${String(arch?.language ?? "unknown")}); ${why}; directory-level cycles are NOT evaluated (not "0 cycles")`,
      artifactTimestamp
    );
  }
  const rawCycles = moduleGraph.cycles;
  if (!Array.isArray(rawCycles)) {
    return notEvaluated(
      `query scope ${entry.key} for ${source}: moduleGraph.cycles is not an array — directory-level cycles are NOT evaluated`,
      artifactTimestamp
    );
  }

  const cycles: DirectoryCycle[] = [];
  for (const c of rawCycles) {
    if (c == null || !Array.isArray(c.modules) || !c.modules.every((m: unknown) => typeof m === "string")) {
      return notEvaluated(
        `query scope ${entry.key} for ${source}: moduleGraph.cycles contains a malformed entry (modules must be string[])`,
        artifactTimestamp
      );
    }
    cycles.push({ size: c.modules.length, modules: [...c.modules] });
  }

  return {
    directoryCyclesEvaluated: true,
    directoryCyclesReason: null,
    directoryCycleCount: cycles.length,
    directoryCycles: cycles,
    directoryCyclesBasis: "module-graph",
    artifactTimestamp,
  };
}

// ── Reusable directory-cycle reading ───────────────────────────────────────────────────────────────
// The quality-gate-driver's arch-CYCLE report-only routine (gap-arch-cycle-report-only-routine) needs
// EXACTLY the reading above and must not grow a second copy of it (single source of truth: the query
// artifact layout, the manifest scope matching and the three-valued failure vocabulary are one
// implementation, not a paraphrase). The routine reads what the LAST `analyze` persisted — it does NOT
// run analyze itself (that is the on-demand runner's job; running a 27s/task analyze on a routine tick
// is exactly what `gap-fan-in-remove-archguard-gate` removed).
//
// ⛔ THREE-VALUED AT THE AGGREGATE LEVEL TOO (硬规则 3b), BUT NO LONGER ALL-OR-NOTHING:
// gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts measured 25/25 rounds with
// `evaluated:false` because TWO of the six scopes never produced a module graph — one permanently
// unreadable scope voided five readable ones. The aggregate now reports per scope:
//   • `status:"complete"` — every scope produced a reading.
//   • `status:"partial"`  — at least one did, at least one did not; `totalCycleCount` is the sum over
//                           the scopes that DID, and `notEvaluatedScopes` names the ones that did not.
//   • `status:"none"`     — nothing could be read; `totalCycleCount` is `null` (⛔ never 0).
// The sum stays `null` for `none` for the original reason: an empty sum would read like a complete
// "0 cycles" measurement. It is non-null for `partial` because the scopes it covers really were read,
// and the record names the ones it does not cover (硬规则 3b: the unmeasured part stays visible).

/** One scope's directory-granularity reading, as the report-only routine persists it. */
export interface DirectoryCycleScopeReading {
  scope: string;
  source: string;
  evaluated: boolean;
  reason: string | null;
  cycleCount: number | null;
  /** The cycle MEMBERS (AC2: a non-empty reading must name its members, not just count them). */
  cycles: DirectoryCycle[] | null;
  /** Which evidence produced this reading (see `readDirectoryCycles`). null ⇒ not evaluated. */
  basis: "module-graph" | "single-directory" | null;
  /** When the artifact THIS scope was read from was produced (arch.json `timestamp`, else the
   *  manifest scope's `generatedAt`). null ⇒ no artifact was read for this scope.
   *  ⚠️ A `single-directory` reading is derived from the CURRENT file list, not from the artifact —
   *  the timestamp is still recorded (it says which artifact we looked at) but it does not age the
   *  reading; see `commitsSinceArtifact`/`behindSources` below. */
  artifactTimestamp: string | null;
  /** Commits AFTER `artifactTimestamp` that touched this scope's source directory — i.e. how far the
   *  tree has moved past the artifact the reading came from. null ⇒ NOT COMPUTABLE (no artifact
   *  timestamp / git failed), ⛔ never 0 (硬规则 3b: "could not tell" must not read as "up to date").
   *  For a `single-directory` reading this is 0: the reading is taken from the live file list, so it
   *  cannot be behind its sources no matter how old the artifact is. */
  commitsSinceArtifact: number | null;
  /** `commitsSinceArtifact > 0`. Three-valued: null when the count is not computable.
   *  ⛔ NOT the same thing as the record-level `stale` (artifact age > scheduling interval): this one
   *  says "the sources changed after the artifact", which is what makes a reading WRONG rather than
   *  merely old. Both are kept, with their own names (hard rule 8: never reuse a name for a new
   *  meaning). A behind scope still reports its cycle count — but it must be marked, never presented
   *  as the current reading. */
  behindSources: boolean | null;
}

/** The aggregate reading over SCOPES. */
export interface DirectoryCycleReading {
  workDir: string;
  /** `status !== "none"` — a reading was produced for at least one scope. (Before this task this
   *  meant "every scope evaluated"; `status` now carries that distinction, so an older reader that
   *  only looks at this boolean still sees `false` for "nothing readable" as before.) */
  evaluated: boolean;
  status: "complete" | "partial" | "none";
  /** Non-null when `status === "complete"` (every scope read) or `"partial"` (names the scopes that
   *  were not, with their reasons). null for `"none"`. */
  reason: string | null;
  /** Sum over the scopes that produced a reading. `null` ONLY when `status === "none"`. */
  totalCycleCount: number | null;
  /** The scope labels with `behindSources === true` (empty when none / not computable for any). */
  behindScopes: string[];
  notEvaluatedScopes: string[];
  scopes: DirectoryCycleScopeReading[];
  /** THE OLDEST artifact timestamp among the scopes that ACTUALLY PRODUCED AN ARTIFACT-DERIVED READING
   *  (evaluated AND `basis:"module-graph"`), because those are the numbers this record reports and a
   *  reading is only as fresh as its stalest contributing part.
   *  Excluded, with reasons:
   *   • `not-evaluated` rows contribute nothing to the reported cycles;
   *   • `single-directory` rows are derived from the file list, not the artifact — counting their
   *     (often ancient) artifact timestamps would make `stale` permanently true and information-free
   *     (硬规则 4).
   *  null ⇒ no artifact-derived reading, and staleness is NOT EVALUABLE (硬规则 3b: ⛔ never `false`).
   *  Per-scope timestamps remain available in `scopes`. */
  artifactTimestamp: string | null;
}

/** Read the directory-level cycles from the artifacts the LAST `archguard analyze` persisted.
 *
 *  NEVER throws and NEVER spawns an analyzer: a missing/unreadable `.archguard/query` tree is reported
 *  as `evaluated:false` + a per-scope reason (the same shape the gate uses), which is what makes the
 *  routine's 硬规则-3b test meaningful — "could not read" must not look like "0 cycles".
 *  It DOES read `git` (file list for the single-directory basis, commit counts for `behindSources`);
 *  those are cheap local reads, never an analysis. */
export function readDirectoryCycleReading(root: string, workDir?: string): DirectoryCycleReading {
  const resolvedRoot = path.resolve(root);
  const resolvedWorkDir = workDir ? path.resolve(workDir) : path.join(resolvedRoot, ".archguard");
  const scopes: DirectoryCycleScopeReading[] = SCOPES.map(({ source, label }) => {
    const r = readDirectoryCycles(resolvedRoot, resolvedWorkDir, source);
    const basis = r.directoryCyclesBasis;
    // A single-directory reading is taken from the live file list ⇒ it cannot be behind its sources.
    const commitsSinceArtifact =
      r.directoryCyclesEvaluated && basis === "single-directory"
        ? 0
        : commitsSince(resolvedRoot, source, r.artifactTimestamp);
    return {
      scope: label,
      source,
      evaluated: r.directoryCyclesEvaluated,
      reason: r.directoryCyclesReason,
      cycleCount: r.directoryCycleCount,
      cycles: r.directoryCycles,
      basis,
      artifactTimestamp: r.artifactTimestamp,
      commitsSinceArtifact,
      behindSources: commitsSinceArtifact === null ? null : commitsSinceArtifact > 0,
    };
  });
  // Oldest timestamp among the ARTIFACT-DERIVED readings this record reports (见 the interface comment:
  // unevaluated and single-directory scopes are not averaged in). Entries whose timestamp cannot be
  // parsed as ISO are skipped rather than silently treated as "fresh".
  const timestamps = scopes
    .filter((s) => s.evaluated && s.basis === "module-graph")
    .map((s) => s.artifactTimestamp)
    .filter((v): v is string => typeof v === "string" && v !== "" && Number.isFinite(Date.parse(v)));
  const artifactTimestamp = timestamps.length > 0 ? timestamps.reduce((a, b) => (a <= b ? a : b)) : null;
  const failed = scopes.filter((s) => !s.evaluated);
  const status: DirectoryCycleReading["status"] =
    failed.length === 0 ? "complete" : failed.length === scopes.length ? "none" : "partial";
  const evaluated = status !== "none";
  return {
    workDir: resolvedWorkDir,
    evaluated,
    status,
    reason:
      status === "complete"
        ? null
        : `${status === "partial" ? "partial" : "not-evaluated"} (${failed.length} of ${scopes.length} scopes not evaluated): ${failed
            .map((s) => `${s.scope}: ${s.reason}`)
            .join(" | ")}`,
    totalCycleCount: status === "none" ? null : scopes.reduce((n, s) => n + (s.cycleCount ?? 0), 0),
    behindScopes: scopes.filter((s) => s.behindSources === true).map((s) => s.scope),
    notEvaluatedScopes: failed.map((s) => s.scope),
    scopes,
    artifactTimestamp,
  };
}

// ── Refresh: re-analyze a scope whose artifact is behind its sources ──────────────────────────────
// WHY (gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts): the routine is a REPORT
// (it must not run a 27s/task analyze every tick — `gap-fan-in-remove-archguard-gate`), but NOTHING
// ever rewrote the artifacts it reads. Measured: the src artifact was produced at 16:17Z while the
// cycle it should have shown was introduced at 16:26Z — the routine kept reporting "evaluated, 0
// cycles" from a 9-minute-old artifact, and the cycle lived ~7h until a human ran archguard by hand.
// So the routine refreshes AT MOST ONE scope per scheduling interval (the driver already gates the
// routine by that interval; this function additionally only ever spends ONE analyze, so a refresh can
// never turn a report tick into a 6×27s sweep, and a `stop` request still lands inside its window).
//
// It lives HERE, next to `runAnalyze`, because the spawn command (and the `--diagrams package` flag
// that makes archguard emit the module graph at all) has exactly one spelling.
export type ArchCycleRefreshSkip =
  | "no-scope-needs-refresh"
  | "instrument-absent"
  | "analyze-failed";

export interface ArchCycleRefreshResult {
  attempted: boolean;
  /** The scope label re-analyzed (at most one per call). */
  refreshedScope: string | null;
  refreshedSource: string | null;
  skipped: ArchCycleRefreshSkip | null;
  /** Human-readable explanation, always set when `skipped !== null` — for `instrument-absent` it lists
   *  EVERY location probed (硬规则 3b/6: "not found" is only meaningful with the search spelled out). */
  detail: string | null;
  instrument: string | null;
  instrumentSource: ArchguardCliSource | null;
  searched: string[];
  /** `archguard analyze` exit code; null when no analyze ran. */
  exitCode: number | null;
  at: string;
}

/** Does this scope's reading need a re-analysis? Three independent triggers, each NAMED:
 *   • `behindSources === true` — the tree moved past the artifact (the reading is WRONG, not just old);
 *   • not-evaluated BECAUSE the artifact carries no module graph — a package-level run is the only way
 *     to give it one (⛔ NOT every not-evaluated state: "no manifest at all" is not curable by one
 *     scope's analyze and must not turn a report tick into a blind spawn);
 *   • not-evaluated AND every scope is unreadable is NOT a refresh case for the same reason.
 *  `behindSources === null` (not computable) is NOT a trigger — ⛔ never treat "could not tell" as
 *  "behind" (that would spend an analyze on every round of a non-git workspace). */
export function scopeNeedsRefresh(scope: DirectoryCycleScopeReading): boolean {
  if (scope.behindSources === true) return true;
  if (!scope.evaluated && typeof scope.reason === "string" && scope.reason.includes("moduleGraph not produced")) return true;
  return false;
}

/** Re-analyze ONE scope that needs it, requesting the package-level diagram so the query artifact
 *  carries `extensions.tsAnalysis.moduleGraph`. Returns a record of what was done (never throws). */
export function refreshBehindScopes(
  root: string,
  workDir: string | undefined,
  reading: DirectoryCycleReading,
  opts: { now?: string } = {},
): ArchCycleRefreshResult {
  const at = opts.now ?? new Date().toISOString();
  const target = reading.scopes.find(scopeNeedsRefresh) ?? null;
  const base = {
    attempted: false,
    refreshedScope: null,
    refreshedSource: null,
    instrument: null as string | null,
    instrumentSource: null as ArchguardCliSource | null,
    searched: [] as string[],
    exitCode: null as number | null,
    at,
  };
  if (!target) {
    return { ...base, skipped: "no-scope-needs-refresh", detail: "every scope's artifact is current (or its staleness is not computable)" };
  }
  const resolvedRoot = path.resolve(root);
  const resolvedWorkDir = workDir ? path.resolve(workDir) : path.join(resolvedRoot, ".archguard");
  const resolution = resolveArchguardCliWithSource();
  if (!resolution.cli) {
    return {
      ...base,
      skipped: "instrument-absent",
      detail: `archguard CLI not found — probed: ${resolution.searched.join(" ; ")}`,
      searched: resolution.searched,
    };
  }
  const rc = runAnalyze(resolution.cli, resolvedRoot, resolvedWorkDir, target.source, target.scope, {
    diagrams: ["package"],
    outputLabel: `arch-cycle-refresh-${target.scope}`,
    viaNode: resolution.viaNode,
    noCache: true,
  });
  return {
    ...base,
    attempted: true,
    refreshedScope: target.scope,
    refreshedSource: target.source,
    skipped: rc === 0 ? null : "analyze-failed",
    detail: rc === 0 ? `archguard analyze --diagrams package → ${target.source}` : `archguard analyze exited ${rc} for ${target.source}`,
    instrument: resolution.cli,
    instrumentSource: resolution.source,
    searched: resolution.searched,
    exitCode: rc,
  };
}


// ── Reusable GRAPH-SUMMARY reading (topByOutDegree + relationCountByType) ─────────────────────────
// gap-quality-round-facts-surface-top-out-degree-god-functions: the two non-cycle readings that
// `archguard_summary` exposes were, until now, only visible to whoever remembered to call the MCP
// tool — no standing fact carried them. They are NOT a different product: both are derived from the
// very same `.archguard/query/<globalScopeKey>/arch.json` the report-only routines already read
// (`entities[]` + `relations[]`), so this reader is a PURE FILE READ like the one above.
//
// ⛔ WHICH SCOPE: the GLOBAL scope (`manifest.globalScopeKey`), not the six per-source scopes. The
// findings this task is about (run / handleAllRoutes / runResidentLoop god functions; inheritance /
// call relation counts) are whole-tree readings — exactly what `archguard_summary` returns. The
// per-source scopes are disjoint by construction (cross-scope edges are structurally invisible, see
// the header), so summing them would NOT be the same measurement as the global scope; it would be a
// different (and silently incomplete) one.
//
// ⛔ THREE-VALUED (硬规则 3b): no manifest / no globalScopeKey / unreadable or malformed artifact /
// non-array `entities` or `relations` / a malformed relation entry ⇒ `evaluated:false` with a reason
// and `null` readings — never `{}` / `0` / `[]`, which would read as "a graph with nothing in it".

/** Default top-N for the god-function reading. N is a REPORTING GRAIN, not a threshold (硬规则 4):
 *  it bounds how much of the carrier line each round carries; `topByOutDegreeTruncated` +
 *  `entitiesWithOutgoingRelations` make any truncation visible instead of silently dropping ties. */
export const TOP_OUT_DEGREE_LIMIT_DEFAULT = 10;

/** One high-out-degree entity, WITH positional evidence (file/line) so a reader can reproduce it
 *  without re-running archguard (AC1: "贴出前 3 条位置证据"). */
export interface TopOutDegreeEntry {
  /** The entity id as the artifact spells it (unique within the scope). */
  entityId: string;
  /** Short entity name (`entities[].name`), falling back to the id's last segment. */
  name: string;
  outDegree: number;
  /** `entities[].type` (function/method/class/…) when the entity record is present. */
  kind: string | null;
  file: string | null;
  startLine: number | null;
}

/** The reading, as the arch-cycle routine persists it into its carrier and its quality-round Fact. */
export interface GraphSummaryReading {
  workDir: string;
  evaluated: boolean;
  reason: string | null;
  /** The manifest key this reading came from (`globalScopeKey`). */
  scopeKey: string | null;
  scopeLabel: string | null;
  /** The artifact's own `timestamp`, falling back to the manifest scope's `generatedAt` — the same
   *  freshness discipline as the directory-cycle reading (硬规则 4b). */
  artifactTimestamp: string | null;
  entityCount: number | null;
  relationCount: number | null;
  /** Relations per `relation.type` (dependency / composition / inheritance / call / …). The FULL
   *  distribution, not a selected subset: which types are absent is itself the graph's capability
   *  boundary (`call=2` next to `dependency=6490` was the reading that motivated this task). */
  relationCountByType: Record<string, number> | null;
  /** How many entities have at least one outgoing relation (the population the top-N was cut from —
   *  lets a reader see that the list is a SAMPLE, not the whole graph). */
  entitiesWithOutgoingRelations: number | null;
  topByOutDegreeLimit: number;
  /** Sorted by outDegree DESC, then entityId ASC (deterministic ties — the M118 audit's finding was a
   *  silently dropped TIED entry, so truncation must be disclosed rather than resolved by luck). */
  topByOutDegree: TopOutDegreeEntry[] | null;
  /** `entitiesWithOutgoingRelations > topByOutDegree.length`; null when unevaluated. */
  topByOutDegreeTruncated: boolean | null;
}

/** Read `topByOutDegree` + `relationCountByType` from the artifact the LAST `archguard analyze`
 *  persisted. NEVER throws and NEVER spawns (no `analyze`, no CLI lookup — see the section comment). */
export function readGraphSummaryReading(
  root: string,
  workDir?: string,
  opts: { limit?: number } = {},
): GraphSummaryReading {
  const resolvedRoot = path.resolve(root);
  const resolvedWorkDir = workDir ? path.resolve(workDir) : path.join(resolvedRoot, ".archguard");
  const limit = opts.limit ?? TOP_OUT_DEGREE_LIMIT_DEFAULT;
  const unevaluated = (reason: string, known: Partial<GraphSummaryReading> = {}): GraphSummaryReading => ({
    workDir: resolvedWorkDir,
    evaluated: false,
    reason,
    scopeKey: null,
    scopeLabel: null,
    artifactTimestamp: null,
    ...known,
    entityCount: null,
    relationCount: null,
    relationCountByType: null,
    entitiesWithOutgoingRelations: null,
    topByOutDegreeLimit: limit,
    topByOutDegree: null,
    topByOutDegreeTruncated: null,
  });

  const manifestRead = readQueryManifest(resolvedWorkDir);
  if (!manifestRead.ok) {
    return unevaluated(`${manifestRead.reason} — the graph summary is NOT evaluated (not an empty graph)`);
  }
  const { manifestFile, manifest } = manifestRead;
  const key = manifest?.globalScopeKey;
  if (typeof key !== "string" || key.length === 0) {
    return unevaluated(`query manifest ${manifestFile} carries no globalScopeKey — the graph summary is NOT evaluated`);
  }
  const entry = Array.isArray(manifest?.scopes) ? manifest.scopes.find((e: any) => e?.key === key) : undefined;
  const scopeLabel = typeof entry?.label === "string" ? entry.label : null;
  const manifestTimestamp =
    typeof entry?.generatedAt === "string" && entry.generatedAt !== "" ? entry.generatedAt : null;
  const archRead = readQueryScopeArch(resolvedWorkDir, key);
  if (!archRead.ok) {
    return unevaluated(`${archRead.reason} — the graph summary is NOT evaluated (not an empty graph)`, {
      scopeKey: key,
      scopeLabel,
      artifactTimestamp: manifestTimestamp,
    });
  }
  const arch = archRead.arch;
  const artifactTimestamp =
    typeof arch?.timestamp === "string" && arch.timestamp !== "" ? arch.timestamp : manifestTimestamp;
  const known = { scopeKey: key, scopeLabel, artifactTimestamp };
  if (arch == null || typeof arch !== "object") {
    return unevaluated(`query scope ${key} is not an object — the graph summary is NOT evaluated`, known);
  }
  if (!Array.isArray(arch.entities) || !Array.isArray(arch.relations)) {
    return unevaluated(`query scope ${key} has no entities[]/relations[] arrays — the graph summary is NOT evaluated`, known);
  }

  const byType: Record<string, number> = {};
  const outDegree = new Map<string, number>();
  for (let i = 0; i < arch.relations.length; i += 1) {
    const rel = arch.relations[i];
    if (rel == null || typeof rel !== "object" || typeof rel.source !== "string" || typeof rel.type !== "string") {
      return unevaluated(
        `query scope ${key}: relations[${i}] is malformed (source/type must be strings) — the graph summary is NOT evaluated`,
        known,
      );
    }
    byType[rel.type] = (byType[rel.type] ?? 0) + 1;
    outDegree.set(rel.source, (outDegree.get(rel.source) ?? 0) + 1);
  }

  const entityById = new Map<string, any>();
  for (const e of arch.entities) {
    if (e != null && typeof e === "object" && typeof e.id === "string") entityById.set(e.id, e);
  }
  const ranked = [...outDegree.entries()]
    .map(([entityId, degree]): TopOutDegreeEntry => {
      const e = entityById.get(entityId);
      const loc = e?.sourceLocation;
      return {
        entityId,
        name: typeof e?.name === "string" && e.name !== "" ? e.name : entityId.split(".").pop() ?? entityId,
        outDegree: degree,
        kind: typeof e?.type === "string" ? e.type : null,
        file: typeof loc?.file === "string" ? loc.file : null,
        startLine: typeof loc?.startLine === "number" && Number.isFinite(loc.startLine) ? loc.startLine : null,
      };
    })
    .sort((a, b) => b.outDegree - a.outDegree || a.entityId.localeCompare(b.entityId));

  const top = ranked.slice(0, Math.max(0, limit));
  return {
    workDir: resolvedWorkDir,
    evaluated: true,
    reason: null,
    scopeKey: key,
    scopeLabel,
    artifactTimestamp,
    entityCount: arch.entities.length,
    relationCount: arch.relations.length,
    relationCountByType: byType,
    entitiesWithOutgoingRelations: ranked.length,
    topByOutDegreeLimit: limit,
    topByOutDegree: top,
    topByOutDegreeTruncated: ranked.length > top.length,
  };
}

/** Read the archguard-produced class-level ArchJSON and extract its structural signal.
 *
 *  archguard nests the class output under the source's BASENAME inside the per-scope output dir
 *  (`<workDir>/output/<label>/<basename>/class/all-classes.json`), so the read path mirrors
 *  `runAnalyze`'s `--output-dir <label>` + basename layout.
 *
 *  Every failure path returns `evaluated:false` with a reason — it does NOT throw here, because the
 *  record (including the not-evaluated state) must still be appended to the carrier before exit 1. */
function readScopeSignal(root: string, workDir: string, label: string, source: string, analyzeRc: number): ScopeSignal {
  const base: ScopeSignal = {
    scope: label,
    evaluated: false,
    reason: null,
    entitySccCount: null,
    entityCount: null,
    totalRelations: null,
    maxInDegree: null,
    maxOutDegree: null,
    sourceFiles: null,
    gitSourceFiles: null,
    directoryCyclesEvaluated: false,
    directoryCyclesReason: null,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null,
  };
  // The directory-granularity reading is taken INDEPENDENTLY of the class artifact: it comes from a
  // different persisted product (query scope) and must carry its own evaluated/reason triad (AC4).
  // A failed analyze leaves no product for either caliber.
  const directory =
    analyzeRc === 0
      ? readDirectoryCycles(root, workDir, source)
      : {
          directoryCyclesEvaluated: false,
          directoryCyclesReason: `analyze exited ${analyzeRc} — no product to read`,
          directoryCycleCount: null,
          directoryCycles: null,
          directoryCyclesBasis: null,
        };
  const withDirectory = { ...base, ...directory };
  const unevaluated = (reason: string): ScopeSignal => ({ ...withDirectory, reason });

  if (analyzeRc !== 0) return unevaluated(`analyze exited ${analyzeRc} — no product to read`);

  const file = path.join(workDir, "output", label, path.basename(source), "class", "all-classes.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return unevaluated(`cannot read archguard output ${file} — did analyze actually run?`);
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return unevaluated(`archguard output ${file} is not valid JSON`);
  }
  const mv = data?.metricVector;
  if (mv == null || typeof mv !== "object") {
    return unevaluated(`archguard output ${file} has no metricVector`);
  }

  const entitySccCount = numeric(mv.sccCount);
  const entityCount = numeric(mv.totalEntities);
  const missingMetrics = [
    entitySccCount === null ? "sccCount" : null,
    entityCount === null ? "totalEntities" : null,
  ].filter((k): k is string => k !== null);
  if (missingMetrics.length > 0) {
    return unevaluated(`archguard output ${file}: metricVector lacks numeric ${missingMetrics.join(", ")}`);
  }

  if (!Array.isArray(data.sourceFiles)) {
    return unevaluated(`archguard output ${file}: artifact has no sourceFiles array — analysis coverage cannot be reconciled`);
  }
  const entries = data.sourceFiles.filter((e: unknown): e is string => typeof e === "string");
  if (entries.length !== data.sourceFiles.length) {
    return unevaluated(`archguard output ${file}: sourceFiles contains non-string entries`);
  }

  // Dedupe by realpath: archguard reports the path it was handed, and a symlinked source tree lets the
  // SAME file be reported twice under two spellings (measured 454+46=500 during the task's probe).
  const unique = new Set<string>();
  const duplicateSamples: string[] = [];
  for (const entry of entries) {
    let key: string;
    try {
      key = fs.realpathSync(entry);
    } catch {
      key = path.resolve(root, entry);
    }
    if (unique.has(key)) {
      if (duplicateSamples.length < 3) duplicateSamples.push(entry);
    } else {
      unique.add(key);
    }
  }

  const gitSourceFiles = gitTrackedFileCount(root, source);
  if (gitSourceFiles === null) {
    return unevaluated(`git ls-files -- ${source} failed — sourceFiles cannot be reconciled (not evaluated, not "clean")`);
  }

  // 0 实体 fail-closed: a scope that HAS tracked files but analyzed 0 entities is a broken/incomplete
  // analysis, not an empty scope. (Without this, a wrong `-s` path silently yields 0 and passes.)
  if (gitSourceFiles > 0 && entityCount === 0) {
    return unevaluated(
      `${source}: ${gitSourceFiles} git-tracked file(s) but analyze produced 0 entities — analysis did not cover its input`
    );
  }

  const notes: string[] = [];
  const duplicateCount = entries.length - unique.size;
  if (duplicateCount > 0) {
    notes.push(
      `${duplicateCount} duplicate sourceFiles entr${duplicateCount === 1 ? "y" : "ies"} (same realpath resolved twice — symlink double-resolution?): ${duplicateSamples.join(", ")}`
    );
  }
  if (unique.size !== gitSourceFiles) {
    notes.push(
      `sourceFiles=${unique.size} vs git ls-files ${source}=${gitSourceFiles} (diff ${unique.size - gitSourceFiles})`
    );
  }

  return {
    ...withDirectory,
    evaluated: true,
    reason: notes.length > 0 ? `reconciliation: ${notes.join("; ")}` : null,
    entitySccCount,
    entityCount,
    totalRelations: numeric(mv.totalRelations),
    maxInDegree: numeric(mv.maxInDegree),
    maxOutDegree: numeric(mv.maxOutDegree),
    sourceFiles: unique.size,
    gitSourceFiles,
  };
}

function currentCommitSha(root: string): string | null {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Append ONE history record to `<workDir>/metrics-history.jsonl` (the queryable carrier). */
function appendHistory(workDir: string, record: HistoryRecord): void {
  const file = path.join(workDir, "metrics-history.jsonl");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch (e) {
    // Carrier write failure must not silently pass — the artifact stays unqueryable (AC3 ⛔).
    fail(`cannot append to ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function fmt(v: number | null): string {
  return v === null ? "null" : String(v);
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  let root = "";
  let workDirArg = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[i + 1] ?? "";
      i++;
    } else if (args[i] === "--work-dir") {
      workDirArg = args[i + 1] ?? "";
      i++;
    } else {
      usage(`unknown argument: ${args[i]}`);
    }
  }
  if (!root) usage("--root is required");
  root = path.resolve(root);
  const workDir = workDirArg ? path.resolve(workDirArg) : path.join(root, ".archguard");
  if (!fs.existsSync(path.join(root, ".quay", "config.yml")) && !fs.existsSync(path.join(root, ".git"))) {
    usage(`--root ${root} is not a repo worktree`);
  }

  // 1. The meter must be runnable (fail-closed on a missing CLI) — and the not-evaluated state is
  //    itself written to the carrier before exiting, so "no run" never looks like "clean run".
  const resolution = resolveArchguardCliWithSource();
  const cli = resolution.cli;
  if (!cli) {
    const reason = `archguard CLI not found — probed: ${resolution.searched.join(" ; ")} — the meter must be runnable`;
    appendHistory(workDir, {
      timestamp: new Date().toISOString(),
      tool: "archguard-runner",
      commitSha: currentCommitSha(root),
      archguardVersion: null,
      evaluated: false,
      reason,
      entitySccCount: null,
      entitySccEvaluated: false,
      entitySccReason: reason,
      directoryCycleCount: null,
      directoryCyclesEvaluated: false,
      directoryCyclesReason: reason,
      sourceFiles: null,
      entityCount: null,
      verdict: "fail",
      ...CROSS_SCOPE_NOT_EVALUATED,
      scopes: [],
    });
    fail(`${reason} (fail-closed)`);
  }

  // 2. Version provenance. A record without a comparable version is not comparable across runs
  //    (archguard 0.1.35→0.1.40 changed detect_cycles' shape and scope resolution).
  const archguardVersion = readArchguardVersion(cli, resolution.viaNode);
  const versionReason =
    archguardVersion === null ? "archguard --version produced no readable version — record is not version-anchored" : null;

  // 3. REAL analyze on every scope (AC1: a real archguard call, not a comment / project-name mention).
  //    A non-zero exit does NOT abort the loop: each scope still produces a not-evaluated signal, so
  //    the carrier records WHICH scopes failed to evaluate instead of collapsing them into one error.
  const scopes = SCOPES.map(({ source, label }) => {
    process.stdout.write(`archguard-runner: analyzing ${label} (${source})\n`);
    const rc = runAnalyze(cli, root, workDir, source, label, { viaNode: resolution.viaNode });
    return readScopeSignal(root, workDir, label, source, rc);
  });

  // 4. Evaluate BOTH granularities independently. Every scope must actually be READ in each
  //    granularity, then the structural invariant (each cycle count === 0). A scope whose
  //    directory reading is not evaluated is NOT "0 directory cycles" (硬规则 3b / AC4).
  const entityUnevaluated = scopes.filter((s) => !s.evaluated);
  const directoryUnevaluated = scopes.filter((s) => !s.directoryCyclesEvaluated);
  const entityViolated = scopes.filter((s) => s.evaluated && s.entitySccCount !== 0);
  const directoryViolated = scopes.filter(
    (s) => s.directoryCyclesEvaluated && (s.directoryCycleCount ?? 0) > 0
  );
  const entityEvaluated = versionReason === null && entityUnevaluated.length === 0;
  const directoryEvaluated = versionReason === null && directoryUnevaluated.length === 0;
  const evaluated = entityEvaluated && directoryEvaluated;
  const violated = entityViolated.length > 0 || directoryViolated.length > 0;
  const verdict: HistoryRecord["verdict"] = evaluated && !violated ? "pass" : "fail";

  const reasons: string[] = [];
  if (versionReason) reasons.push(versionReason);
  for (const s of scopes) {
    if (s.reason) reasons.push(`${s.scope}: ${s.reason}`);
  }

  const entityReasons = [
    ...(versionReason ? [versionReason] : []),
    ...entityUnevaluated.map((s) => `${s.scope}: ${s.reason ?? "not evaluated"}`),
  ];
  const directoryReasons = [
    ...(versionReason ? [versionReason] : []),
    ...directoryUnevaluated.map((s) => `${s.scope}: ${s.directoryCyclesReason ?? "not evaluated"}`),
  ];

  // Record-level aggregates are null unless EVERY scope was evaluated — a partial sum would impersonate
  // a complete measurement (⛔ never substitute the sum of the readable scopes for the whole).
  const complete = entityUnevaluated.length === 0;
  const directoryComplete = directoryUnevaluated.length === 0;
  const record: HistoryRecord = {
    timestamp: new Date().toISOString(),
    tool: "archguard-runner",
    commitSha: currentCommitSha(root),
    archguardVersion,
    evaluated,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    entitySccCount: complete ? scopes.reduce((n, s) => n + (s.entitySccCount ?? 0), 0) : null,
    entitySccEvaluated: entityEvaluated,
    entitySccReason: entityReasons.length > 0 ? entityReasons.join("; ") : null,
    directoryCycleCount: directoryComplete
      ? scopes.reduce((n, s) => n + (s.directoryCycleCount ?? 0), 0)
      : null,
    directoryCyclesEvaluated: directoryEvaluated,
    directoryCyclesReason: directoryReasons.length > 0 ? directoryReasons.join("; ") : null,
    sourceFiles: complete ? scopes.reduce((n, s) => n + (s.sourceFiles ?? 0), 0) : null,
    entityCount: complete ? scopes.reduce((n, s) => n + (s.entityCount ?? 0), 0) : null,
    verdict,
    ...CROSS_SCOPE_NOT_EVALUATED,
    scopes,
  };

  // 5. Append the structural signal to the queryable carrier — ALWAYS, including fail-closed runs.
  appendHistory(workDir, record);

  for (const s of scopes) {
    process.stdout.write(
      `archguard-runner: ${s.scope} — evaluated=${s.evaluated} entitySccCount=${fmt(s.entitySccCount)} directoryCycleCount=${fmt(s.directoryCycleCount)} directoryCyclesEvaluated=${s.directoryCyclesEvaluated} entities=${fmt(s.entityCount)} relations=${fmt(s.totalRelations)} sourceFiles=${fmt(s.sourceFiles)} gitSourceFiles=${fmt(s.gitSourceFiles)} maxInDegree=${fmt(s.maxInDegree)} maxOutDegree=${fmt(s.maxOutDegree)}${s.reason ? ` reason=${s.reason}` : ""}${s.directoryCyclesReason ? ` directoryReason=${s.directoryCyclesReason}` : ""}\n`
    );
  }

  if (!evaluated) {
    const detail = [
      entityEvaluated ? null : `entity: ${entityReasons.join("; ")}`,
      directoryEvaluated ? null : `directory: ${directoryReasons.join("; ")}`,
    ]
      .filter((v): v is string => v !== null)
      .join(" | ");
    fail(`NOT EVALUATED — at least one scope could not be read; refusing to report "0 cycles" (硬规则 3b): ${detail}`);
  }
  if (entityViolated.length > 0) {
    fail(
      `structural violation: entity-level dependency cycles detected in ${entityViolated.map((s) => s.scope).join(", ")} — entitySccCount must be 0`
    );
  }
  if (directoryViolated.length > 0) {
    // JSON.stringify so every member is unambiguous — including the project-root module id "".
    const detail = directoryViolated
      .map((s) => `${s.scope}: ${(s.directoryCycles ?? []).map((c) => JSON.stringify(c.modules)).join(" ")}`)
      .join("; ");
    fail(
      `structural violation: directory-level dependency cycles detected — ${detail} — directoryCycleCount must be 0`
    );
  }
  process.stdout.write("archguard-runner: PASS — no dependency cycles in any scope\n");
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
// ⛔ 本文件自 gap-arch-cycle-report-only-routine 起【也是被 import 的库】（quality-gate-driver 的
// arch-cycle 例程复用 readDirectoryCycleReading）；无守卫的顶层 main() 会在 import 时真的去 spawn
// `archguard analyze`（一个 27s/task 的按需动作），把「读上次产物」变成「每次 import 都重分析」。
// expectedBase 是必填的名字（不是 URL — 打包后所有 inlined 模块共享同一个 import.meta.url，见
// gate-script-base.ts#isDirectEntry）。
if (isDirectEntry(import.meta, process.argv[1], "archguard-runner")) main();
