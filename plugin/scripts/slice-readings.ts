#!/usr/bin/env node
// slice-readings.ts — PER-TASK before/after structural readings, bound to ONE task
// (tasks/gap-slice-before-after-readings-at-dispatch-and-fanin; 人 2026-10-22 立项).
//
// ── THE QUESTION THIS MAKES ASKABLE ───────────────────────────────────────────────────────────────
// 「这一刀重构到底把中心文件削掉了多少、方法体搬走了多少、调用出度降了多少？」——
// 用**同一任务、同一 scope、同一口径**的成对读数回答，而不是靠人记得在两个时间点各跑一次
// archguard 再肉眼对照。claudecodeui 的 OO 重构会话 2026-10-22 报告的正是这个缺口：它的每一刀
// 都是手工跑两次，两次的 scope 设置还可能不一致（同口径问题没人守）。
//
// 记录两端：
//   baseline —— 派发那一刻（fork point 的 HEAD）的结构读数；
//   post     —— 机械 fan-in 之后（合并树仍在世时）的同一 scope 读数 + 逐量 delta。
// 两者写在 `<root>/.quay/slice-readings/<taskId>.json`（gitignored；一个任务一个文件，两端同文）。
//
// ── WHY NOT REUSE design-evolution-readings.ts ────────────────────────────────────────────────────
// 那个机件回答的是**跨窗口趋势**（时间窗内新增代码有多少落回中心文件），它的读数按 subsystem
// 的 baseline..head 窗口定义，没有「某个任务的派发前 / fan-in 后」这一对时间点。本脚本复用它的
// **声明与口径**（.quay/config.yml 的 loop.design_evolution_readings.subsystems: 的 central /
// modules 定义、git 行数口径、resolveCommit / lineCountAt），只新增「成对记录 + 逐量 delta」。
// ⛔ 不复用它的 carrier（.quay/design-evolution-history.jsonl）：那是例行趋势线，这是单任务证据。
//
// ── THREE SHARE-LIKE QUANTITIES, THREE KEYS, NEVER INTERCHANGEABLE (硬规则 / 本任务 DoD ③) ──────
//   ① `centralChurnShare` — 本记录 churnWindow（**该次提交** `head^..head`，两侧同一定义）内：
//      中心文件改动行（insertions+deletions）÷ 全部改动行。分母含测试/装配代码的新增，**只作连续性
//      对照**（claudecodeui 刀1 里 ~1000 行新增的判据文件把分母撑大）。
//   ② `centralSlimRatio` — 同一窗口内：中心文件**删除**行 ÷ 中心文件在窗口起点的行数。
//      回答「这一刀把中心的多少比例搬走了」。
//   ③ 时间窗增长占比（**不在本文件**，见 design-evolution-readings.ts 的 RM1）= 时间窗内中心文件
//      **新增**行 ÷ 窗口内全部新增行。只有它能回答「后续增长会不会回流」。
// ⛔ 三者不可互相换算、不可合并成一个 `centralΔ`、不可拿一个替代另一个。三个键在这里各自出现。
//
// ── THREE-VALUED, NEVER BOOLEAN (硬规则 3b) ──────────────────────────────────────────────────────
// archguard 解析不到 / analyze 失败 / 产物缺失 / 实体缺 sourceLocation / 中心文件读不到 /
// worktree 已拆…… 全部落到 `evaluated:false` + 非空 `reason`，且 **metrics 的每个数值键都是 null**
// （⛔ 不是 0——「没读到」与「读到了 0」必须不同形）。同一次记录里 git 侧读数若单独不可得，也只
// 记 null 并在 `metricNullReasons` 点名成因，⛔ 不用 0 顶替。
//
// ── ARCHGUARD RESOLUTION (硬规则 1 / 5b) ─────────────────────────────────────────────────────────
// 主解析器复用 `archguard-runner.ts` 的 `resolveArchguardCli()`（PATH / ARCHGUARD_RUNNER_CLI），
// ⛔ 不写第二份。本机的实际安装形态是 Claude plugin 运行时缓存（`.../plugins/npm-cache/node_modules/
// @yalehwang/archguard/dist/cli/index.js`），PATH 上没有；所以：
//   • ARCHGUARD_RUNNER_CLI **显式设置**（哪怕是坏路径）⇒ 它权威，⛔ 不回退（负控制的强制造法）；
//   • 未设置 ⇒ resolveArchguardCli() 失配后**才**按 plugin 运行时缓存布局发现（见
//     discoverPluginCacheArchguard；版本目录取最高，⛔ 不写死版本号）；
//   • 都失败 ⇒ `evaluated:false` + 点名查过什么。
//
// ── HISTORICAL COMMITS ───────────────────────────────────────────────────────────────────────────
// `--head <sha>` 可以指向**历史提交**（AC1/AC5 的回放要求）。当待分析树的 HEAD ≠ --head 时，本脚本
// 用 `git worktree add --detach <tmp> <sha>` 造一个临时树再 analyze（archguard analyze 只看工作树），
// 结束后 `git worktree remove --force` + 删临时目录。生产的两条路径（派发 / fan-in）都发生在
// 「树就是 head」的时刻，故不付这份成本。
//
// ── WORKTREE DEAD = NOT-EVALUATED, NEVER BACKFILL ────────────────────────────────────────────────
// post 读数必须在 worktree **存活期间**抓（fan-in 提交之后、cleanup 之前）。显式传了 `--tree` 而该
// 路径不存在 ⇒ `evaluated:false` + `worktree-missing: …`，⛔ 不悄悄改读主检出（那是另一棵树）。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/slice-readings.ts --baseline \
//     --task-id <id> [--scope <subsystem>] [--head <rev>] [--root <repo>] [--tree <path>] \
//     [--config <section.yml>] [--json]
//   node --experimental-strip-types plugin/scripts/slice-readings.ts --post \
//     --task-id <id> [--head <rev>] [--root <repo>] [--tree <path>] [--config <section.yml>] [--json]
//
//   --root  carrier 根（.quay/slice-readings/ 写在这里；git 历史也从这里读）——缺省 = repo root
//   --tree  待分析的树——缺省 = --root。fan-in 传 worktree 路径（合并树在，carrier 在主检出）
//   --head  待分析提交——缺省 = --tree 的 HEAD。与 --tree 的 HEAD 不同 ⇒ 临时 worktree 回放
//   --scope 子系统名（.quay/config.yml loop.design_evolution_readings.subsystems[].name）；
//           baseline 缺省时按任务 `## Touches` 与声明匹配
//
// Exit: 0 = record produced, evaluated:true
//       3 = record produced, NOT-EVALUATED（独立取值，⛔ 不是 "failed"）
//       4 = carrier 写失败
//       2 = usage / input error

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { repoRoot as findRepoRoot } from "./repo-root.ts";
// 单一解析器（硬规则 5b）：⛔ 不在这里重写 PATH / ARCHGUARD_RUNNER_CLI 的语义。
import { resolveArchguardCli } from "./archguard-runner.ts";
// 声明与口径的单一真相源：subsystem 的 central / modules 定义、提交解析、行数口径。
import {
  globToRegExp,
  lineCountAt,
  listTrackedPaths,
  readDesignEvolutionConfig,
  readStandaloneSection,
  resolveCommit,
} from "./design-evolution-readings.ts";
import type { SubsystemSpec } from "./design-evolution-readings.ts";
// Touches 的唯一 bullet 解析器（⛔ 不写第二份正则）。
import { extractTouchesSection, parseTouchEntries } from "./touches-parser.ts";

// ── Carrier + schema ─────────────────────────────────────────────────────────────────────────────

/** `<root>/.quay/slice-readings/` — one JSON per task, both phases in the same file. */
export const SLICE_READINGS_DIR_REL = path.posix.join(".quay", "slice-readings");

export const SLICE_READINGS_SCHEMA = "slice-readings-v1";

/** The numeric keys a reading carries. AC1 names seven; `cycles` is the eighth (Plan schema + the
 *  ADR-007 L_G reading the fan-in wants). Order is the record's key order. */
export const METRIC_KEYS = Object.freeze([
  "centralFileLines",
  "centralFileBodyLines",
  "callOutDegree",
  "methodCount",
  "methodShellCount",
  "cycles",
  "centralChurnShare",
  "centralSlimRatio",
] as const);

export type MetricKey = (typeof METRIC_KEYS)[number];

/** Which archguard (or git) surface a quantity came from — recorded PER METRIC (AC1).
 *  `summary`         = archguard's graph/entity query artifact (`query/<key>/arch.json`);
 *  `cognitive-summary` = archguard's cognitive-summary surface (reserved; not the source of any
 *                        quantity in v1 — kept in the union so a future metric can declare it);
 *  `git`             = a pure git/source reading (line counts, numstat churn) — NOT an archguard
 *                        claim, and must not be presented as one. */
export type MetricBasis = "summary" | "cognitive-summary" | "git";

export const METRIC_BASIS: Readonly<Record<MetricKey, MetricBasis>> = Object.freeze({
  centralFileLines: "git",
  centralFileBodyLines: "summary",
  callOutDegree: "summary",
  methodCount: "summary",
  methodShellCount: "summary",
  cycles: "summary",
  centralChurnShare: "git",
  centralSlimRatio: "git",
});

export interface SliceMetrics {
  /** Lines of the central file(s) at the reading commit (`wc -l` caliber: newline count). */
  centralFileLines: number | null;
  /** Lines covered by callable entities that HAVE a block body (implementation spans). This is the
   *  quantity that DROPS when method bodies move out; `methodCount` alone does not (the proposal's
   *  measured trap: 88 → 86 while the bodies left). */
  centralFileBodyLines: number | null;
  /** Distinct `call` relations whose source entity lives in a central file. */
  callOutDegree: number | null;
  /** Callable entities (function/method/constructor) whose sourceLocation is in a central file. */
  methodCount: number | null;
  /** Of those, the ones with NO block body — interface/declaration/overload shells left on the
   *  contract. `methodCount - methodShellCount` = callables with a body. */
  methodShellCount: number | null;
  /** Directory-granularity cycles in the analyze scope (`moduleGraph.cycles.length`). */
  cycles: number | null;
  /** See the header's three-quantities section. Window = `churnWindow`. */
  centralChurnShare: number | null;
  /** See the header's three-quantities section. Denominator = central lines at the window start. */
  centralSlimRatio: number | null;
}

export interface ChurnWindow {
  from: string;
  to: string;
}

export interface SliceReadingRecord {
  schema: typeof SLICE_READINGS_SCHEMA;
  taskId: string;
  phase: "baseline" | "post";
  evaluated: boolean;
  /** null iff evaluated: actually names the failure otherwise (硬规则 3b). */
  reason: string | null;
  ts: string;
  /** The commit this reading describes (resolved SHA). null only when it could not be resolved. */
  headSha: string | null;
  /** post only: the baseline's headSha this post is bound to (null when no readable baseline). */
  baselineHeadSha: string | null;
  /** The subsystem name (config key), identical on both sides by construction. */
  scope: string;
  /** Snapshot of the scope declaration at reading time. A post whose current declaration differs
   *  from the baseline's snapshot is NOT-EVALUATED (`scope-declaration-changed`) — same name with a
   *  different file set is a different measurement. */
  scopeSpec: { source: string; central: { atBaseline: string; atHead: string }[]; modules: string[] } | null;
  metricBasis: Readonly<Record<MetricKey, MetricBasis>>;
  metrics: SliceMetrics;
  /** Which commits the two churn/slim quantities were computed over. Named, not assumed. */
  churnWindow: ChurnWindow | null;
  /** Why a metric is null while the record is otherwise evaluated (e.g. a root commit has no ^). */
  metricNullReasons: Partial<Record<MetricKey, string>>;
  archguardCli: string | null;
  archguardVersion: string | null;
  /** Where the analysis actually ran (an in-place tree, or the temp worktree used for a historical
   *  commit). null when no analysis happened. */
  analyzedTree: { kind: "in-place" | "temp-worktree"; path: string } | null;
  /** post only: per-metric post − baseline (0 when the tree did not move — AC4's structural
   *  negative control). null when the record is not a post or the baseline was unusable. */
  delta?: Record<MetricKey, number | null> | null;
}

export interface SliceReadingsFile {
  schema: typeof SLICE_READINGS_SCHEMA;
  taskId: string;
  scope: string | null;
  baseline: SliceReadingRecord | null;
  post: SliceReadingRecord | null;
  delta: Record<MetricKey, number | null> | null;
}

// ── Small, explicit result types (⛔ exceptions for expected failures) ────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const fail = <T>(reason: string): Result<T> => ({ ok: false, reason });

// ── git helpers ───────────────────────────────────────────────────────────────────────────────────

interface GitRead {
  ok: boolean;
  stdout: string;
  error: string | null;
}

function gitRead(root: string, args: string[]): GitRead {
  try {
    const stdout = spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (stdout.status !== 0) {
      return { ok: false, stdout: "", error: (stdout.stderr || stdout.stdout || `git ${args[0]} exited ${stdout.status}`).trim() };
    }
    return { ok: true, stdout: stdout.stdout ?? "", error: null };
  } catch (e) {
    return { ok: false, stdout: "", error: e instanceof Error ? e.message : String(e) };
  }
}

/** The tree's HEAD SHA, or null with a reason (⛔ never the literal "HEAD"). */
export function treeHead(tree: string): Result<string> {
  const r = gitRead(tree, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (!r.ok || r.stdout.trim() === "") return fail(`tree-head-unresolvable: git rev-parse HEAD failed in ${tree}${r.error ? ` — ${r.error}` : ""}`);
  return { ok: true, value: r.stdout.trim() };
}

/** Newline-count caliber (`wc -l`) — the SAME line caliber design-evolution-readings uses, so the
 *  numbers are comparable across the two mechanisms. */
export function countLines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

// ── Subsystem declaration → analyze source ───────────────────────────────────────────────────────

/** The literal (wildcard-free) part of a glob. */
function staticPrefix(glob: string): string {
  const i = glob.search(/[*?]/);
  return i === -1 ? glob : glob.slice(0, i);
}

/** The common ancestor directory of every central file and module glob prefix.
 *
 *  archguard `analyze -s <dir>` takes ONE source root; the subsystem declares files/globs, not a
 *  root. The common ancestor is the smallest directory that covers all of them (worker-history ⇒
 *  `plugin/scripts`; serve ⇒ `packages/quay/src`). `.` (repo root) is legal. */
export function deriveAnalyzeSource(spec: SubsystemSpec): string {
  const dirs: string[] = [];
  for (const c of spec.central) {
    dirs.push(path.posix.dirname(c.atHead), path.posix.dirname(c.atBaseline));
  }
  for (const m of spec.modules) {
    const pref = staticPrefix(m);
    const dir = pref.endsWith("/") ? pref.replace(/\/+$/, "") : path.posix.dirname(pref);
    dirs.push(dir === "" ? "." : dir);
  }
  if (dirs.length === 0) return ".";
  const split = dirs.map((d) => (d === "." ? [] : d.split("/").filter((s) => s !== "")));
  const first = split[0];
  let common = first.length;
  for (let i = 1; i < split.length; i++) {
    let n = 0;
    while (n < common && n < split[i].length && split[i][n] === first[n]) n++;
    common = n;
  }
  return common === 0 ? "." : first.slice(0, common).join("/");
}

// ── Task → scope resolution (baseline only; post reuses the baseline's scope) ────────────────────

export interface TaskScopeMatch {
  scope: string;
  spec: SubsystemSpec;
  /** Which task file supplied the Touches (repo-relative). */
  taskFile: string;
  exactCentralMatches: number;
  moduleGlobMatches: number;
}

/** Resolve the scope for a task WITHOUT an explicit `--scope`:
 *  1. an explicit frontmatter `extra.slice_scope: <name>` wins (the task literally declares it);
 *  2. otherwise the declared subsystem whose central/module files overlap the task's `## Touches`
 *     the MOST; ties go to the FIRST declared subsystem (deterministic — the config order is the
 *     declaration order).
 *  No overlap at all ⇒ a named refusal (⛔ silently reading "the biggest file" would be a different
 *  measurement than the one the task asked for). */
export function resolveScopeForTask(
  root: string,
  taskId: string,
  subsystems: readonly SubsystemSpec[],
): Result<TaskScopeMatch> {
  const taskFile = path.join(root, "tasks", `${taskId}.md`);
  let text: string;
  try {
    text = fs.readFileSync(taskFile, "utf8");
  } catch (e) {
    return fail(`task-unreadable: ${taskFile} — ${(e as Error).message}`);
  }
  const declared = /^extra:[\s\S]*?^\s+slice_scope:\s*["']?([A-Za-z0-9_.-]+)["']?\s*$/m.exec(text);
  if (declared !== null) {
    const spec = subsystems.find((s) => s.name === declared[1]);
    if (spec === undefined) return fail(`scope-undeclared: extra.slice_scope '${declared[1]}' is not a declared subsystem`);
    return {
      ok: true,
      value: { scope: spec.name, spec, taskFile: `tasks/${taskId}.md`, exactCentralMatches: 0, moduleGlobMatches: 0 },
    };
  }
  const { hasSection, section } = extractTouchesSection(text);
  if (!hasSection) return fail(`touches-missing: ${taskFile} has no '## Touches' section — cannot pick a scope`);
  const touches = parseTouchEntries(section);
  if (touches.length === 0) return fail(`touches-empty: ${taskFile}'s '## Touches' yields no entries`);
  const touchSet = new Set(touches);

  let best: TaskScopeMatch | null = null;
  for (const spec of subsystems) {
    const central = spec.central.flatMap((c) => [c.atBaseline, c.atHead]);
    const centralSet = new Set(central);
    const moduleRes = spec.modules.map(globToRegExp);
    let exact = 0;
    let glob = 0;
    for (const t of touchSet) {
      if (centralSet.has(t)) exact++;
      if (moduleRes.some((re) => re.test(t))) glob++;
    }
    if (exact === 0 && glob === 0) continue;
    const candidate: TaskScopeMatch = {
      scope: spec.name, spec, taskFile: `tasks/${taskId}.md`, exactCentralMatches: exact, moduleGlobMatches: glob,
    };
    if (best === null) best = candidate;
    else if (exact > best.exactCentralMatches || (exact === best.exactCentralMatches && glob > best.moduleGlobMatches)) {
      best = candidate;
    }
  }
  if (best === null) {
    return fail(
      `no-subsystem-matches-task-touches: none of ${subsystems.map((s) => s.name).join(", ") || "(no subsystems declared)"} covers ${touches.join(", ")}`,
    );
  }
  return { ok: true, value: best };
}

// ── archguard resolution ─────────────────────────────────────────────────────────────────────────

export interface ArchguardCommand {
  /** argv prefix up to (not including) the subcommand. */
  argv: string[];
  /** What the human/report sees. */
  display: string;
  source: "env-or-path" | "plugin-cache";
}

/** Discover the archguard runtime under the Claude plugin cache.
 *
 *  This is NOT a second PATH/env resolver (硬规则 5b): it only runs AFTER `resolveArchguardCli()`
 *  returned null, and only when ARCHGUARD_RUNNER_CLI is UNSET (an explicit override — even a broken
 *  one — is authoritative, which is what makes AC3's forced failure possible).
 *
 *  Layout (documented by the archguard plugin's own mcp-launcher.mjs): the plugin package lives in
 *  `<pluginsRoot>/cache/<marketplace>/<plugin>/<version>/`, while its runtime dependency is hoisted
 *  into the SIBLING `<pluginsRoot>/npm-cache/node_modules/@yalehwang/archguard/`. We also accept a
 *  version-directory-local `node_modules` (nested installs). Version directories are sorted
 *  lexicographically as versions (⛔ no hard-coded version number). */
export function discoverPluginCacheArchguard(pluginsRoot: string | null = defaultPluginsRoot()): Result<ArchguardCommand> {
  if (pluginsRoot === null) return fail("plugin-cache-discovery: cannot locate the Claude plugins root (no $HOME)");
  const candidates: string[] = [];
  const entryRel = path.join("@yalehwang", "archguard", "dist", "cli", "index.js");
  const hoisted = path.join(pluginsRoot, "npm-cache", "node_modules", entryRel);
  if (fs.existsSync(hoisted)) candidates.push(hoisted);
  const cacheDir = path.join(pluginsRoot, "cache");
  let markets: string[] = [];
  try {
    markets = fs.readdirSync(cacheDir);
  } catch {
    markets = [];
  }
  for (const market of markets) {
    const pluginDir = path.join(cacheDir, market, "archguard");
    let versions: string[] = [];
    try {
      versions = fs.readdirSync(pluginDir);
    } catch {
      continue;
    }
    versions
      .filter((v) => /^\d+\.\d+\.\d+/.test(v))
      .sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const d = (pb[i] ?? 0) - (pa[i] ?? 0);
          if (d !== 0) return d;
        }
        return a.localeCompare(b);
      })
      .forEach((v) => {
        const nested = path.join(pluginDir, v, "node_modules", entryRel);
        if (fs.existsSync(nested)) candidates.push(nested);
      });
  }
  if (candidates.length === 0) {
    return fail(
      `archguard-cli-unresolvable: ARCHGUARD_RUNNER_CLI unset, no archguard on PATH, and no plugin-cache runtime under ${path.join(pluginsRoot, "npm-cache", "node_modules", entryRel)} or ${cacheDir}/*/archguard/*/node_modules/${entryRel}`,
    );
  }
  const cli = candidates[0];
  return { ok: true, value: { argv: [process.execPath, cli], display: cli, source: "plugin-cache" } };
}

function defaultPluginsRoot(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  return home ? path.join(home, ".claude", "plugins") : null;
}

/** Resolve the archguard command. Order and authority are documented in the header. */
export function resolveArchguardCommand(): Result<ArchguardCommand> {
  const explicit = (process.env.ARCHGUARD_RUNNER_CLI ?? "").trim();
  const viaRunner = resolveArchguardCli();
  if (viaRunner !== null) {
    return { ok: true, value: { argv: [viaRunner], display: viaRunner, source: "env-or-path" } };
  }
  if (explicit !== "") {
    // resolveArchguardCli already returned null for a set-but-missing override; an explicit path is
    // authoritative (the negative-control seam) ⇒ do NOT fall back to discovery.
    return fail(`archguard-cli-unresolvable: ARCHGUARD_RUNNER_CLI=${explicit} does not exist (explicit override is authoritative; not falling back)`);
  }
  return discoverPluginCacheArchguard();
}

/** First line of `<cli> --version`; null when unreadable (record then says so, ⛔ not "0"). */
export function readArchguardVersion(cmd: ArchguardCommand): string | null {
  const r = spawnSync(cmd.argv[0], [...cmd.argv.slice(1), "--version"], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) return null;
  const first = String(r.stdout ?? "").trim().split("\n")[0].trim();
  return first === "" ? null : first;
}

// ── analyze (historical commits ⇒ temp worktree) ─────────────────────────────────────────────────

export interface AnalysisTree {
  root: string;
  kind: "in-place" | "temp-worktree";
  cleanup: () => void;
}

/** Return the tree whose working files ARE `headSha`:
 *  - the given tree when its HEAD already equals headSha (the production path — no cost);
 *  - a detached temp worktree otherwise (historical replay, AC1/AC5).
 *  A missing `--tree` is a named failure (worktree torn down), ⛔ never a silent switch to root. */
export function prepareAnalysisTree(opts: {
  root: string;
  tree: string;
  treeExplicit: boolean;
  headSha: string;
}): Result<AnalysisTree> {
  if (!fs.existsSync(opts.tree)) {
    return fail(
      opts.treeExplicit
        ? `worktree-missing: ${opts.tree} does not exist — a post reading must be taken while the worktree is alive (⛔ never backfilled from the main checkout)`
        : `tree-missing: ${opts.tree} does not exist`,
    );
  }
  const head = treeHead(opts.tree);
  if (head.ok && head.value === opts.headSha) {
    return { ok: true, value: { root: opts.tree, kind: "in-place", cleanup: () => {} } };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-readings-tree-"));
  const add = gitRead(opts.root, ["worktree", "add", "--detach", tmp, opts.headSha]);
  if (!add.ok) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return fail(`temp-worktree-add-failed: git worktree add --detach ${opts.headSha} failed — ${add.error ?? "unknown"}`);
  }
  return {
    ok: true,
    value: {
      root: tmp,
      kind: "temp-worktree",
      cleanup: () => {
        const rm = gitRead(opts.root, ["worktree", "remove", "--force", tmp]);
        // A failed `git worktree remove` must not leave the directory behind as a phantom worktree;
        // the filesystem removal is the fallback, and `git worktree prune` is left to the caller's
        // own housekeeping (⛔ no destructive global prune from a reading).
        if (!rm.ok) fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
  };
}

interface RunAnalyzeResult {
  workDir: string;
  exit: number;
  stdout: string;
  stderr: string;
}

/** Run one `archguard analyze` for `source` inside `analyzedRoot`, into a fresh temp work dir.
 *  The work dir is a temp (not the repo's `.archguard`) so the reading can never read a STALE
 *  artifact produced by a different scope/tree (硬规则 4b: a stale reading looks exactly like a
 *  fresh one). */
export function runAnalyze(
  cmd: ArchguardCommand,
  analyzedRoot: string,
  source: string,
  label: string,
): Result<RunAnalyzeResult> {
  let workDir: string;
  try {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "slice-readings-archguard-"));
  } catch (e) {
    return fail(`analyze-workdir-failed: ${(e as Error).message}`);
  }
  const outputDir = path.join(workDir, "output", label.replace(/[^A-Za-z0-9_.-]/g, "_"));
  const r = spawnSync(
    cmd.argv[0],
    [
      ...cmd.argv.slice(1),
      "analyze",
      "--lang",
      "typescript",
      "--format",
      "json",
      "--work-dir",
      workDir,
      "--output-dir",
      outputDir,
      "-s",
      source,
    ],
    { cwd: analyzedRoot, encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const exit = r.status ?? 1;
  if (exit !== 0) {
    fs.rmSync(workDir, { recursive: true, force: true });
    return fail(
      `analyze-failed: archguard analyze exited ${exit} for source '${source}'${r.stderr ? ` — ${String(r.stderr).split("\n").slice(-3).join(" ").trim()}` : ""}`,
    );
  }
  return { ok: true, value: { workDir, exit, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") } };
}

// ── Read the analyze scope artifact ─────────────────────────────────────────────────────────────

/** Find the query scope covering `source` in `<workDir>/query/manifest.json` and read its arch.json.
 *
 *  The layout is archguard's own (`query/manifest.json` + `query/<key>/arch.json`), the same one
 *  `archguard-runner.ts` reads from a persistent work dir. We deliberately do NOT reuse that
 *  module's per-scope loop: it analyzes the SIX fixed kernel scopes, while this reading analyzes
 *  ONE declared subsystem (which may be a third-party project's path). The layout vocabulary is
 *  duplicated in ONE small reader here and named as such; a future consolidation should export the
 *  two `readQuery*` helpers from archguard-runner.ts rather than grow a third copy. */
export function readScopeArch(workDir: string, analyzedRoot: string, source: string): Result<{ arch: any; scopeKey: string }> {
  const queryDir = path.join(workDir, "query");
  const manifestFile = path.join(queryDir, "manifest.json");
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch (e) {
    return fail(`query-manifest-unreadable: ${manifestFile} — ${(e as Error).message}`);
  }
  const entries: any[] = Array.isArray(manifest?.scopes) ? manifest.scopes : [];
  const abs = path.resolve(analyzedRoot, source);
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    /* not fatal — compare the literal spelling too */
  }
  const norm = (p: unknown): string => {
    if (typeof p !== "string") return "";
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const matches = entries.filter(
    (e) => Array.isArray(e?.sources) && e.sources.some((s: unknown) => norm(s) === real || norm(s) === abs),
  );
  if (matches.length === 0) {
    return fail(`query-scope-missing: manifest ${manifestFile} has no scope covering ${source} (analyzed ${entries.length} scope(s))`);
  }
  matches.sort((a, b) => String(b?.generatedAt ?? "").localeCompare(String(a?.generatedAt ?? "")));
  const key = matches[0]?.key;
  if (typeof key !== "string" || key === "") return fail(`query-scope-missing-key: the matching scope in ${manifestFile} has no key`);
  const archFile = path.join(queryDir, key, "arch.json");
  let arch: any;
  try {
    arch = JSON.parse(fs.readFileSync(archFile, "utf8"));
  } catch (e) {
    return fail(`query-artifact-unreadable: ${archFile} — ${(e as Error).message}`);
  }
  return { ok: true, value: { arch, scopeKey: key } };
}

// ── Metrics from the artifact + the analyzed source tree ─────────────────────────────────────────

interface ArchMetrics {
  centralFileBodyLines: number;
  callOutDegree: number;
  methodCount: number;
  methodShellCount: number;
  cycles: number;
}

/** Compute the archguard-derived quantities for one analyze scope. Three-valued: an entity without
 *  a sourceLocation, or a missing entities/relations/moduleGraph array, is a named failure (⛔ never
 *  0 — "could not read" must not look like "nothing there"). */
export function computeArchMetrics(
  analyzedRoot: string,
  centralFiles: readonly string[],
  arch: any,
): Result<ArchMetrics> {
  if (arch === null || typeof arch !== "object") return fail("artifact-not-an-object");
  if (!Array.isArray(arch.entities)) return fail("artifact-has-no-entities-array");
  if (!Array.isArray(arch.relations)) return fail("artifact-has-no-relations-array");
  const cyclesRaw = arch?.extensions?.tsAnalysis?.moduleGraph?.cycles;
  if (!Array.isArray(cyclesRaw)) {
    return fail("artifact-has-no-moduleGraph-cycles: directory-level cycles are NOT evaluated (not '0 cycles')");
  }

  // The artifact identifies files by BASENAME inside the analyze scope; map those back to the
  // declared central paths so the numbers are about the files the subsystem declared, not every
  // file that happens to share a name elsewhere in the scope.
  const byBase = new Map<string, string[]>();
  for (const rel of centralFiles) {
    const base = path.posix.basename(rel);
    const arr = byBase.get(base);
    if (arr === undefined) byBase.set(base, [rel]);
    else arr.push(rel);
  }

  const sourceCache = new Map<string, string[]>();
  const linesFor = (rel: string): Result<string[]> => {
    const cached = sourceCache.get(rel);
    if (cached !== undefined) return { ok: true, value: cached };
    try {
      const lines = fs.readFileSync(path.join(analyzedRoot, rel), "utf8").split("\n");
      sourceCache.set(rel, lines);
      return { ok: true, value: lines };
    } catch (e) {
      return fail(`central-file-unreadable: ${rel} — ${(e as Error).message}`);
    }
  };

  const callableTypes = new Set(["function", "method", "constructor"]);
  const callables = arch.entities.filter((e: any) => {
    if (e === null || typeof e !== "object" || !callableTypes.has(e.type)) return false;
    const file = typeof e?.sourceLocation?.file === "string" ? path.posix.basename(e.sourceLocation.file) : "";
    return byBase.has(file);
  });

  let bodyLines = 0;
  let shells = 0;
  for (const e of callables) {
    const loc = e?.sourceLocation;
    const start = Number(loc?.startLine);
    const end = Number(loc?.endLine);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      return fail(`entity-missing-sourceLocation: ${String(e?.id ?? e?.name ?? "?")} — method metrics are NOT evaluated`);
    }
    const base = path.posix.basename(loc.file);
    const rels = byBase.get(base) ?? [];
    const rel = rels[0];
    const lines = linesFor(rel);
    if (!lines.ok) return lines;
    const span = lines.value.slice(start - 1, end).join("\n");
    if (span.includes("{")) bodyLines += end - start + 1;
    else shells += 1;
  }

  const callableIds = new Set(callables.map((e: any) => e.id));
  const callEdges = new Set<string>();
  for (const r of arch.relations) {
    if (r === null || typeof r !== "object" || r.type !== "call") continue;
    if (!callableIds.has(r.source)) continue;
    callEdges.add(typeof r.id === "string" ? r.id : `${String(r.source)}→${String(r.target)}`);
  }

  return {
    ok: true,
    value: {
      centralFileBodyLines: bodyLines,
      callOutDegree: callEdges.size,
      methodCount: callables.length,
      methodShellCount: shells,
      cycles: cyclesRaw.length,
    },
  };
}

// ── git-derived share quantities (churn / slim) ─────────────────────────────────────────────────

export interface GitShareMetrics {
  centralChurnShare: number | null;
  centralSlimRatio: number | null;
  nullReasons: Partial<Record<MetricKey, string>>;
}

/** Compute `centralChurnShare` + `centralSlimRatio` over ONE named window.
 *
 *  `centralChurnShare` — (insertions+deletions of central files) / (insertions+deletions of ALL
 *  files) in the window. continuity only; it includes deletions, so a big central deletion RAISES
 *  it — that is why it ⛔ must not be read as "the refactor was thorough" (proposal 2026-10-22).
 *  `centralSlimRatio` — (deletions of central files) / (central lines at the window start).
 *  Both are null (with a named cause) when the denominator is zero or the diff is unreadable —
 *  ⛔ never 0. */
export function computeGitShareMetrics(
  root: string,
  centralPaths: readonly string[],
  window: ChurnWindow,
): GitShareMetrics {
  const nullReasons: Partial<Record<MetricKey, string>> = {};
  const centralSet = new Set(centralPaths);
  const diff = gitRead(root, ["diff", "--numstat", "--no-renames", window.from, window.to]);
  if (!diff.ok) {
    nullReasons.centralChurnShare = `git-diff-unreadable: ${window.from}..${window.to} — ${diff.error ?? "unknown"}`;
    nullReasons.centralSlimRatio = nullReasons.centralChurnShare;
    return { centralChurnShare: null, centralSlimRatio: null, nullReasons };
  }
  let centralChanged = 0;
  let centralDeleted = 0;
  let allChanged = 0;
  for (const row of diff.stdout.split("\n")) {
    if (row.trim() === "") continue;
    const [ins, del, file] = row.split("\t");
    if (file === undefined || ins === "-" || del === "-") continue; // binary: no line caliber
    const n = Number(ins) + Number(del);
    if (!Number.isFinite(n)) continue;
    allChanged += n;
    if (centralSet.has(file)) {
      centralChanged += n;
      centralDeleted += Number(del);
    }
  }
  const churnShare = allChanged > 0 ? centralChanged / allChanged : null;
  if (churnShare === null) nullReasons.centralChurnShare = `zero-changed-lines: ${window.from}..${window.to} has no line changes — a share of nothing is not a reading`;

  // A central file CREATED inside the window (worker-fan-in.ts at 2440b52d0 is exactly this) has
  // 0 lines before the window — not an error. Only a git read failure is unevaluable; absence at
  // `from` is a real 0. `listTrackedPaths(from)` is the present-set authority, so `git show` is not
  // even asked about a path that cannot exist there.
  let beforeLines = 0;
  const fromPaths = listTrackedPaths(root, window.from);
  if (fromPaths === null) {
    nullReasons.centralSlimRatio = `central-tree-unreadable-at-window-start: git ls-tree failed at ${window.from}`;
  } else {
    const present = new Set(fromPaths);
    for (const rel of centralPaths) {
      const r = lineCountAt(root, window.from, rel, present);
      if (r.error !== null) {
        nullReasons.centralSlimRatio = `central-lines-unreadable-at-window-start: ${rel} — ${r.error}`;
        break;
      }
      beforeLines += r.lines ?? 0;
    }
  }
  const slimRatio = beforeLines > 0 && nullReasons.centralSlimRatio === undefined ? centralDeleted / beforeLines : null;
  if (slimRatio === null && nullReasons.centralSlimRatio === undefined) {
    nullReasons.centralSlimRatio = `zero-central-lines-at-window-start: ${window.from} has 0 central lines — a ratio of nothing is not a reading`;
  }
  return { centralChurnShare: churnShare, centralSlimRatio: slimRatio, nullReasons };
}

// ── The reading ─────────────────────────────────────────────────────────────────────────────────

const NULL_METRICS: SliceMetrics = Object.freeze({
  centralFileLines: null,
  centralFileBodyLines: null,
  callOutDegree: null,
  methodCount: null,
  methodShellCount: null,
  cycles: null,
  centralChurnShare: null,
  centralSlimRatio: null,
});

function unevaluatedRecord(opts: {
  taskId: string;
  phase: "baseline" | "post";
  scope: string;
  headSha: string | null;
  baselineHeadSha: string | null;
  reason: string;
  scopeSpec?: SliceReadingRecord["scopeSpec"];
}): SliceReadingRecord {
  return {
    schema: SLICE_READINGS_SCHEMA,
    taskId: opts.taskId,
    phase: opts.phase,
    evaluated: false,
    reason: opts.reason,
    ts: new Date().toISOString(),
    headSha: opts.headSha,
    baselineHeadSha: opts.baselineHeadSha,
    scope: opts.scope,
    scopeSpec: opts.scopeSpec ?? null,
    metricBasis: METRIC_BASIS,
    metrics: { ...NULL_METRICS },
    churnWindow: null,
    metricNullReasons: {},
    archguardCli: null,
    archguardVersion: null,
    analyzedTree: null,
    ...(opts.phase === "post" ? { delta: null } : {}),
  };
}

export interface TakeReadingOptions {
  root: string;
  /** Tree to analyze (default `root`). */
  tree?: string;
  treeExplicit?: boolean;
  taskId: string;
  phase: "baseline" | "post";
  head?: string;
  spec: SubsystemSpec;
  scopeName: string;
  /** post only: the baseline record this reading is bound to. */
  baseline?: SliceReadingRecord | null;
  /** Override the resolved archguard command (tests). */
  archguard?: ArchguardCommand;
}

/** Produce ONE reading. Never throws; every failure is `evaluated:false` + a named reason. */
export function takeReading(opts: TakeReadingOptions): SliceReadingRecord {
  const tree = opts.tree ?? opts.root;
  const treeExplicit = opts.treeExplicit ?? false;
  const scopeSpec: SliceReadingRecord["scopeSpec"] = {
    source: deriveAnalyzeSource(opts.spec),
    central: opts.spec.central.map((c) => ({ atBaseline: c.atBaseline, atHead: c.atHead })),
    modules: [...opts.spec.modules],
  };
  const baselineHeadSha = opts.phase === "post" ? (opts.baseline?.headSha ?? null) : null;

  // 1. Resolve the commit. With no --head the ANSWER COMES FROM THE ANALYZED TREE, not --root:
  //    the fan-in post reads a worktree whose HEAD is ahead of the (not-yet-ff'd) carrier checkout;
  //    resolving "HEAD" in --root there would describe the wrong tree entirely.
  if (treeExplicit && !fs.existsSync(tree)) {
    return unevaluatedRecord({
      taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha: null, baselineHeadSha,
      reason: `worktree-missing: ${tree} does not exist — a post reading must be taken while the worktree is alive (⛔ never backfilled from the main checkout)`,
      scopeSpec,
    });
  }
  let headSha: string;
  if (opts.head !== undefined) {
    const headResolved = resolveCommit(opts.root, opts.head);
    if (headResolved.sha === null) {
      return unevaluatedRecord({
        taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha: null, baselineHeadSha,
        reason: `head-unresolvable: ${opts.head} — ${headResolved.error ?? "does not resolve"}`, scopeSpec,
      });
    }
    headSha = headResolved.sha;
  } else {
    const headOfTree = treeHead(tree);
    if (!headOfTree.ok) {
      return unevaluatedRecord({
        taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha: null, baselineHeadSha,
        reason: headOfTree.reason, scopeSpec,
      });
    }
    headSha = headOfTree.value;
  }

  // 2. A post whose current declaration differs from the baseline's snapshot is a DIFFERENT
  //    measurement (same name, different files) — refuse rather than compare unlike readings.
  if (opts.phase === "post" && opts.baseline !== null && opts.baseline !== undefined && opts.baseline.scopeSpec !== null) {
    const a = JSON.stringify(opts.baseline.scopeSpec);
    const b = JSON.stringify(scopeSpec);
    if (a !== b) {
      return unevaluatedRecord({
        taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
        reason: `scope-declaration-changed: baseline snapshot ${a} vs current ${b} — same caliber is required`, scopeSpec,
      });
    }
  }

  // 3. The tree that holds this commit's working files (in-place, or a temp worktree for a
  //    historical replay).
  const treeRes = prepareAnalysisTree({ root: opts.root, tree, treeExplicit, headSha });
  if (!treeRes.ok) {
    return unevaluatedRecord({
      taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
      reason: treeRes.reason, scopeSpec,
    });
  }
  const analysisTree = treeRes.value;
  try {
    // 4. archguard — resolve, version, analyze, read the artifact.
    const cmdRes: Result<ArchguardCommand> =
      opts.archguard !== undefined ? { ok: true, value: opts.archguard } : resolveArchguardCommand();
    if (!cmdRes.ok) {
      return unevaluatedRecord({
        taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
        reason: cmdRes.reason, scopeSpec,
      });
    }
    const cmd = cmdRes.value;
    const version = readArchguardVersion(cmd);
    const analyze = runAnalyze(cmd, analysisTree.root, scopeSpec.source, opts.scopeName);
    if (!analyze.ok) {
      return unevaluatedRecord({
        taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
        reason: analyze.reason, scopeSpec,
      });
    }
    try {
      const artifact = readScopeArch(analyze.value.workDir, analysisTree.root, scopeSpec.source);
      if (!artifact.ok) {
        return unevaluatedRecord({
          taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
          reason: artifact.reason, scopeSpec,
        });
      }

      // 5. Central paths for this reading. `atHead` when it exists at head, else `atBaseline`
      //    (a moved central file is declared with both; using the wrong end silently reads 0).
      const headPaths = centralPathsAt(analysisTree.root, opts.spec, "head");
      if (!headPaths.ok) {
        return unevaluatedRecord({
          taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
          reason: headPaths.reason, scopeSpec,
        });
      }
      const centralFiles = headPaths.value;
      const archMetrics = computeArchMetrics(analysisTree.root, centralFiles, artifact.value.arch);
      if (!archMetrics.ok) {
        return unevaluatedRecord({
          taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
          reason: `archguard-metrics-unevaluated: ${archMetrics.reason}`, scopeSpec,
        });
      }

      // 6. centralFileLines (git/source caliber, read from the analyzed tree = the commit's tree).
      let centralFileLines = 0;
      for (const rel of centralFiles) {
        try {
          centralFileLines += countLines(fs.readFileSync(path.join(analysisTree.root, rel), "utf8"));
        } catch (e) {
          return unevaluatedRecord({
            taskId: opts.taskId, phase: opts.phase, scope: opts.scopeName, headSha, baselineHeadSha,
            reason: `central-file-unreadable: ${rel} — ${(e as Error).message}`, scopeSpec,
          });
        }
      }

      // 7. churn/slim over the reading's OWN head commit (`head^..head`) on both sides — the same
      //    quantity on each side, so `delta` compares like with like and is EXACTLY 0 when the tree
      //    did not move (AC4's structural negative control).
      const window = churnWindowFor(opts.root, headSha);
      const allCentral = [...new Set(opts.spec.central.flatMap((c) => [c.atBaseline, c.atHead]))];
      const shares = window === null
        ? {
            centralChurnShare: null,
            centralSlimRatio: null,
            nullReasons: { centralChurnShare: `window-unresolvable: ${headSha} has no parent commit`, centralSlimRatio: `window-unresolvable: ${headSha} has no parent commit` } as Partial<Record<MetricKey, string>>,
          }
        : computeGitShareMetrics(opts.root, allCentral, window);

      const metrics: SliceMetrics = {
        centralFileLines,
        centralFileBodyLines: archMetrics.value.centralFileBodyLines,
        callOutDegree: archMetrics.value.callOutDegree,
        methodCount: archMetrics.value.methodCount,
        methodShellCount: archMetrics.value.methodShellCount,
        cycles: archMetrics.value.cycles,
        centralChurnShare: shares.centralChurnShare,
        centralSlimRatio: shares.centralSlimRatio,
      };

      const record: SliceReadingRecord = {
        schema: SLICE_READINGS_SCHEMA,
        taskId: opts.taskId,
        phase: opts.phase,
        evaluated: true,
        reason: null,
        ts: new Date().toISOString(),
        headSha,
        baselineHeadSha,
        scope: opts.scopeName,
        scopeSpec,
        metricBasis: METRIC_BASIS,
        metrics,
        churnWindow: window,
        metricNullReasons: shares.nullReasons,
        archguardCli: cmd.display,
        archguardVersion: version,
        analyzedTree: { kind: analysisTree.kind, path: analysisTree.root },
      };
      if (opts.phase === "post") {
        record.delta = computeDelta(metrics, opts.baseline?.metrics ?? null);
      }
      return record;
    } finally {
      fs.rmSync(analyze.value.workDir, { recursive: true, force: true });
    }
  } finally {
    analysisTree.cleanup();
  }
}

/** `atHead` path when present at the analyzed tree, else `atBaseline` (a move's old spelling is
 *  the only one that exists at an older commit). Neither present ⇒ a named failure. */
function centralPathsAt(
  analyzedRoot: string,
  spec: SubsystemSpec,
  _end: "head",
): Result<string[]> {
  const out: string[] = [];
  for (const c of spec.central) {
    if (fs.existsSync(path.join(analyzedRoot, c.atHead))) out.push(c.atHead);
    else if (fs.existsSync(path.join(analyzedRoot, c.atBaseline))) out.push(c.atBaseline);
    else {
      return fail(
        `central-file-absent: neither '${c.atHead}' nor '${c.atBaseline}' exists in the analyzed tree ${analyzedRoot}`,
      );
    }
  }
  return { ok: true, value: out };
}

/** The window the two churn/slim quantities describe: the reading's OWN HEAD COMMIT
 *  (`head^..head`), on BOTH sides.
 *
 *  WHY the head commit and not `baselineHeadSha..headSha`: the proposal defines
 *  `centralChurnShare` as 「该次提交内」 — one cut = one commit (claudecodeui's 刀1/刀2 comparison is
 *  exactly per-cut). More importantly, the two phases must be the SAME quantity for `delta` to
 *  mean anything: a baseline has no slice window yet, so a post-only window would compare a
 *  per-commit share against an N-commit share (measured on quay's 2440b52d0 → ff32d031d window:
 *  per-commit 0.978 vs window 0.014 — a nonsense delta). Same head ⇒ identical inputs ⇒ every
 *  delta is EXACTLY 0, which is AC4's structural negative control (no epsilon needed).
 *  `null` when `head^` does not resolve (a root commit) — never a fabricated empty window. */
export function churnWindowFor(root: string, headSha: string): ChurnWindow | null {
  const parent = gitRead(root, ["rev-parse", "--verify", "--quiet", `${headSha}^{commit}^`]);
  if (!parent.ok || parent.stdout.trim() === "") return null;
  return { from: parent.stdout.trim(), to: headSha };
}

/** Per-metric `post − baseline`; `null` stays null (a missing quantity is not a zero delta).
 *  Identical inputs give EXACT `0` (no epsilon, no threshold) — AC4's negative control. */
export function computeDelta(
  post: SliceMetrics,
  baseline: SliceMetrics | null,
): Record<MetricKey, number | null> {
  const out = {} as Record<MetricKey, number | null>;
  for (const k of METRIC_KEYS) {
    const p = post[k];
    const b = baseline === null ? null : baseline[k];
    out[k] = typeof p === "number" && typeof b === "number" ? normalizeZero(p - b) : null;
  }
  return out;
}

function normalizeZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

// ── Carrier I/O ─────────────────────────────────────────────────────────────────────────────────

export function carrierPathFor(root: string, taskId: string): string {
  return path.join(root, SLICE_READINGS_DIR_REL, `${taskId}.json`);
}

/** Read the carrier. Absent ⇒ `{ok:true,value:null}`; unparseable ⇒ a named failure (⛔ never an
 *  empty object, which would read as "no baseline" and silently unbind a post). */
export function readCarrier(file: string): Result<SliceReadingsFile | null> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
    return fail(`carrier-unreadable: ${file} — ${(e as Error).message}`);
  }
  try {
    const parsed = JSON.parse(text) as SliceReadingsFile;
    if (parsed === null || typeof parsed !== "object") return fail(`carrier-malformed: ${file} is not an object`);
    return { ok: true, value: parsed };
  } catch (e) {
    return fail(`carrier-malformed: ${file} is not valid JSON — ${(e as Error).message}`);
  }
}

/** Atomic write (temp + rename): a dispatch baseline is written by a detached process while the
 *  fan-in may read the same file minutes later — a partial file must never be observable. */
export function writeCarrier(file: string, doc: SliceReadingsFile): Result<string> {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
    fs.renameSync(tmp, file);
    return { ok: true, value: file };
  } catch (e) {
    return fail(`carrier-write-failed: ${file} — ${(e as Error).message}`);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_NOT_EVALUATED = 3;
export const EXIT_CARRIER_WRITE_FAILED = 4;

const USAGE = `usage: slice-readings --baseline --task-id <id> [--scope <subsystem>] [--head <rev>]
                               [--root <repo>] [--tree <path>] [--config <section.yml>] [--json]
       slice-readings --post --task-id <id> [--head <rev>]
                               [--root <repo>] [--tree <path>] [--config <section.yml>] [--json]

  --baseline  write the dispatch-time reading into <root>/${SLICE_READINGS_DIR_REL}/<taskId>.json
              (scope auto-resolves from the task's ## Touches when --scope is omitted)
  --post      read that baseline, take the same scope/caliber again, write post + per-metric delta

  exit 0 = evaluated:true   exit 3 = NOT-EVALUATED (a distinct value, not "failed")
  exit 4 = carrier not writable   exit 2 = usage / input error`;

interface ParsedArgs {
  phase: "baseline" | "post";
  taskId: string;
  scope?: string;
  head?: string;
  root?: string;
  tree?: string;
  treeExplicit: boolean;
  configPath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Result<ParsedArgs> {
  let phase: "baseline" | "post" | null = null;
  let taskId: string | undefined;
  let scope: string | undefined;
  let head: string | undefined;
  let root: string | undefined;
  let tree: string | undefined;
  let treeExplicit = false;
  let configPath: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline" || a === "--post") {
      if (phase !== null) return fail("both --baseline and --post given (exactly one phase per invocation)");
      phase = a === "--baseline" ? "baseline" : "post";
    } else if (a === "--task-id") {
      taskId = argv[++i];
      if (taskId === undefined || taskId === "") return fail("--task-id requires a non-empty id");
    } else if (a === "--scope") {
      scope = argv[++i];
      if (scope === undefined || scope === "") return fail("--scope requires a non-empty subsystem name");
    } else if (a === "--head") {
      head = argv[++i];
      if (head === undefined || head === "") return fail("--head requires a rev");
    } else if (a === "--root") {
      root = argv[++i];
      if (root === undefined || root === "") return fail("--root requires a path");
    } else if (a === "--tree") {
      tree = argv[++i];
      if (tree === undefined || tree === "") return fail("--tree requires a path");
      treeExplicit = true;
    } else if (a === "--config") {
      configPath = argv[++i];
      if (configPath === undefined || configPath === "") return fail("--config requires a path");
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      return fail("help");
    } else if (a.startsWith("--")) {
      return fail(`unknown flag ${a}`);
    } else {
      return fail(`unexpected argument ${a}`);
    }
  }
  if (phase === null) return fail("one of --baseline / --post is required");
  if (taskId === undefined) return fail("--task-id is required");
  return {
    ok: true,
    value: { phase, taskId, scope, head, root, tree, treeExplicit, configPath, json },
  };
}

/** Load the declared subsystems (same source/parser as design-evolution-readings). */
function loadSubsystems(root: string, configPath: string | undefined): Result<SubsystemSpec[]> {
  const section = configPath !== undefined ? readStandaloneSection(configPath) : readDesignEvolutionConfig(root);
  if (section.error !== null) return fail(`config-error: ${section.error}`);
  if (!section.present || section.config === null) {
    return fail(
      "no-subsystems-declared: neither --config nor .quay/config.yml loop.design_evolution_readings declares a subsystem — a slice reading needs an explicit scope",
    );
  }
  if (!section.config.enabled) return fail("config-disabled: loop.design_evolution_readings.enabled=false — kill switch engaged");
  if (section.config.subsystems.length === 0) return fail("no-subsystems-declared: loop.design_evolution_readings.subsystems is empty");
  return { ok: true, value: section.config.subsystems };
}

export function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    if (parsed.reason === "help") {
      process.stdout.write(`${USAGE}\n`);
      return EXIT_OK;
    }
    process.stderr.write(`slice-readings: ${parsed.reason}\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const root = path.resolve(args.root ?? findRepoRoot());
  const tree = args.tree !== undefined ? path.resolve(args.tree) : root;
  const carrierFile = carrierPathFor(root, args.taskId);

  const subsystems = loadSubsystems(root, args.configPath);
  if (!subsystems.ok) {
    process.stderr.write(`slice-readings: ${subsystems.reason}\n`);
    return EXIT_USAGE;
  }

  const existing = readCarrier(carrierFile);
  if (!existing.ok) {
    process.stderr.write(`slice-readings: ${existing.reason}\n`);
    return EXIT_USAGE;
  }

  if (args.phase === "baseline") {
    // Resolve the scope: explicit flag, else the task's own declaration/Touches.
    let scopeName: string;
    let spec: SubsystemSpec;
    if (args.scope !== undefined) {
      const found = subsystems.value.find((s) => s.name === args.scope);
      if (found === undefined) {
        process.stderr.write(`slice-readings: scope-undeclared: '${args.scope}' is not in ${subsystems.value.map((s) => s.name).join(", ")}\n`);
        return EXIT_USAGE;
      }
      spec = found;
      scopeName = found.name;
    } else {
      const resolved = resolveScopeForTask(root, args.taskId, subsystems.value);
      if (!resolved.ok) {
        process.stderr.write(`slice-readings: ${resolved.reason}\n`);
        return EXIT_USAGE;
      }
      spec = resolved.value.spec;
      scopeName = resolved.value.scope;
    }
    const record = takeReading({
      root, tree, treeExplicit: args.treeExplicit, taskId: args.taskId, phase: "baseline",
      spec, scopeName, ...(args.head !== undefined ? { head: args.head } : {}),
    });
    const doc: SliceReadingsFile = {
      schema: SLICE_READINGS_SCHEMA,
      taskId: args.taskId,
      scope: scopeName,
      baseline: record,
      post: null,
      delta: null,
    };
    const wrote = writeCarrier(carrierFile, doc);
    if (!wrote.ok) {
      process.stderr.write(`slice-readings: ${wrote.reason}\n`);
      return EXIT_CARRIER_WRITE_FAILED;
    }
    process.stdout.write((args.json ? JSON.stringify(record, null, 2) : renderHuman(record)) + "\n");
    return record.evaluated ? EXIT_OK : EXIT_NOT_EVALUATED;
  }

  // ── post ─────────────────────────────────────────────────────────────────────────────────────
  if (existing.value === null || existing.value.baseline === null) {
    const record = unevaluatedRecord({
      taskId: args.taskId, phase: "post", scope: args.scope ?? existing.value?.scope ?? "unknown",
      headSha: null, baselineHeadSha: null,
      reason: `baseline-missing: ${carrierFile} has no baseline — a post without a baseline cannot be bound`,
    });
    const wrote = writeCarrier(carrierFile, {
      schema: SLICE_READINGS_SCHEMA, taskId: args.taskId, scope: record.scope,
      baseline: null, post: record, delta: null,
    });
    if (!wrote.ok) {
      process.stderr.write(`slice-readings: ${wrote.reason}\n`);
      return EXIT_CARRIER_WRITE_FAILED;
    }
    process.stdout.write((args.json ? JSON.stringify(record, null, 2) : renderHuman(record)) + "\n");
    return EXIT_NOT_EVALUATED;
  }

  const baseline = existing.value.baseline;
  const spec = subsystems.value.find((s) => s.name === baseline.scope);
  if (spec === undefined) {
    const record = unevaluatedRecord({
      taskId: args.taskId, phase: "post", scope: baseline.scope, headSha: null,
      baselineHeadSha: baseline.headSha,
      reason: `scope-undeclared: the baseline's scope '${baseline.scope}' is no longer declared — cannot re-read the same caliber`,
      scopeSpec: baseline.scopeSpec,
    });
    const wrote = writeCarrier(carrierFile, {
      schema: SLICE_READINGS_SCHEMA, taskId: args.taskId, scope: baseline.scope,
      baseline, post: record, delta: null,
    });
    if (!wrote.ok) {
      process.stderr.write(`slice-readings: ${wrote.reason}\n`);
      return EXIT_CARRIER_WRITE_FAILED;
    }
    process.stdout.write((args.json ? JSON.stringify(record, null, 2) : renderHuman(record)) + "\n");
    return EXIT_NOT_EVALUATED;
  }

  const record = takeReading({
    root, tree, treeExplicit: args.treeExplicit, taskId: args.taskId, phase: "post",
    spec, scopeName: baseline.scope, baseline, ...(args.head !== undefined ? { head: args.head } : {}),
  });
  const delta = record.delta ?? null;
  const wrote = writeCarrier(carrierFile, {
    schema: SLICE_READINGS_SCHEMA, taskId: args.taskId, scope: baseline.scope,
    baseline, post: record, delta,
  });
  if (!wrote.ok) {
    process.stderr.write(`slice-readings: ${wrote.reason}\n`);
    return EXIT_CARRIER_WRITE_FAILED;
  }
  process.stdout.write((args.json ? JSON.stringify(record, null, 2) : renderHuman(record)) + "\n");
  return record.evaluated ? EXIT_OK : EXIT_NOT_EVALUATED;
}

function renderHuman(r: SliceReadingRecord): string {
  const out: string[] = [];
  out.push(`slice-readings ${r.phase}  evaluated=${r.evaluated}  task=${r.taskId}  scope=${r.scope}`);
  out.push(`  head=${r.headSha ?? "(unresolved)"}${r.baselineHeadSha !== null ? `  baselineHead=${r.baselineHeadSha}` : ""}`);
  if (r.reason !== null) out.push(`  reason: ${r.reason}`);
  for (const k of METRIC_KEYS) {
    const v = r.metrics[k];
    const why = r.metricNullReasons[k];
    out.push(`  ${k}=${v === null ? "null" : String(v)}  [${r.metricBasis[k]}]${v === null && why ? ` — ${why}` : ""}`);
  }
  if (r.churnWindow !== null) out.push(`  churnWindow=${r.churnWindow.from}..${r.churnWindow.to}`);
  if (r.delta !== undefined && r.delta !== null) {
    for (const k of METRIC_KEYS) out.push(`  Δ${k}=${r.delta[k] === null ? "null" : String(r.delta[k])}`);
  }
  return out.join("\n");
}

if (isDirectEntry(import.meta, process.argv[1], "slice-readings")) {
  process.exitCode = main(process.argv.slice(2));
}
