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
// STRUCTURAL SIGNAL（DoD「依赖结构」维度）: `metricVector.sccCount`（非平凡强连通分量 = 依赖环）。
// 环是一个【无阈值的布尔不变量】——0 = 无环, >0 = 有环 —— 不引入任何数值阈值（CLAUDE.md 硬规则 4
// 推论一：成本结构未知前不设数值阈值）。god-package / 重复抽象是需要阈值的维度，留待数据积累
// （本 runner 每次把 maxInDegree/maxOutDegree 记进 metrics-history，供日后有数据再设阈）。
//
// ── 三态（gap-archguard-runner-missing-not-evaluated-state-and-version；CLAUDE.md 硬规则 3b）─────
// 旧实现把 `Number(mv.sccCount ?? 0)` 当读数：产物路径错、分析为空、metricVector 缺失时都得到 0 并
// 通过 ——「读不到」与「无环」同形。现在每条 scope 信号带 `evaluated: boolean` + `reason`：
//   • evaluated:true  — 真的跑了 analyze、真的读到了产物、metricVector 有数值字段。
//   • evaluated:false — 产物缺失/不可解析/无 metricVector/sourceFiles 缺失/0 实体/git 对账失败/
//                       analyze 非 0 —— 数值字段一律 `null`（⛔ 不以 0 冒充「无环」），exit 1。
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
// sccCount > 0，全部 exit 1（红）。exit 0 仅当「真的跑了 analyze、每条 scope 都 evaluated、且
// 六个 scope 的 sccCount 全为 0」。一个「注掉调用后仍绿」的检查是假保证
// （CLAUDE.md 硬规则 3b：读不懂输入不得返回与合格同形的值）。
//
// CARRIER（AC3）: 每次跑完（含 fail-closed）把结构信号 append 进 `<work-dir>/metrics-history.jsonl`
// （默认 `<root>/.archguard/metrics-history.jsonl`；追加，不覆盖），使 `.archguard/` 的产物进入一个
// 【可查】载体（`cat .archguard/metrics-history.jsonl` 即可读到逐次的结构信号史）。`.archguard/`
// 本身 gitignored（archguard 自己的 cache/metrics），故 AC3 走「被某判据读」半边（本 runner 读
// class/all-classes.json），不走「git 提交」半边。
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
// Exit: 0 = 六个 scope 都跑通 analyze、都 evaluated、且 sccCount 全 0（PASS）;
//       1 = 结构违例（sccCount > 0）或任一条 not-evaluated（fail-closed RED —— archguard 缺失/
//           analyze 失败/产物缺失/不可解析/0 实体/版本读不到）;
//       2 = usage/environment error（缺 --root）。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

/** One scope's structural reading. `evaluated:false` ⇒ every numeric field is `null` (⛔ never 0):
 *  a scope the runner could not read must not carry the same values as a scope with no cycles. */
interface ScopeSignal {
  scope: string;
  evaluated: boolean;
  reason: string | null;
  sccCount: number | null;
  entityCount: number | null;
  totalRelations: number | null;
  maxInDegree: number | null;
  maxOutDegree: number | null;
  /** Unique files the analyze actually reported (deduped by realpath). */
  sourceFiles: number | null;
  /** Independent caliber: `git ls-files <source> | wc -l` (AC4). */
  gitSourceFiles: number | null;
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
  sourceFiles: number | null;
  entityCount: number | null;
  verdict: "pass" | "fail";
  scopes: ScopeSignal[];
}

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

/** Resolve the archguard CLI. `ARCHGUARD_RUNNER_CLI` is the negative-control seam (the fake CLI);
 *  production resolution is PATH. null ⇒ fail-closed (the meter must be runnable). */
function resolveArchguardCli(): string | null {
  const override = (process.env.ARCHGUARD_RUNNER_CLI ?? "").trim();
  if (override) return fs.existsSync(override) ? override : null;
  const r = spawnSync("sh", ["-c", "command -v archguard"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  return r.stdout.trim();
}

/** `archguard --version` first line. null ⇒ version source unreadable (record becomes evaluated:false). */
function readArchguardVersion(cli: string): string | null {
  const r = spawnSync(cli, ["--version"], { encoding: "utf8" });
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
function runAnalyze(cli: string, root: string, workDir: string, source: string, label: string): number {
  const outputDir = path.join(workDir, "output", label);
  const r = spawnSync(
    cli,
    ["analyze", "--lang", "typescript", "--format", "json", "--work-dir", workDir, "--output-dir", outputDir, "-s", source],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
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

function numeric(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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
    sccCount: null,
    entityCount: null,
    totalRelations: null,
    maxInDegree: null,
    maxOutDegree: null,
    sourceFiles: null,
    gitSourceFiles: null,
  };
  const unevaluated = (reason: string): ScopeSignal => ({ ...base, reason });

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

  const sccCount = numeric(mv.sccCount);
  const entityCount = numeric(mv.totalEntities);
  const missingMetrics = [
    sccCount === null ? "sccCount" : null,
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
    ...base,
    evaluated: true,
    reason: notes.length > 0 ? `reconciliation: ${notes.join("; ")}` : null,
    sccCount,
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
  const cli = resolveArchguardCli();
  if (!cli) {
    const reason = "archguard CLI not found (PATH / ARCHGUARD_RUNNER_CLI) — the meter must be runnable";
    appendHistory(workDir, {
      timestamp: new Date().toISOString(),
      tool: "archguard-runner",
      commitSha: currentCommitSha(root),
      archguardVersion: null,
      evaluated: false,
      reason,
      sourceFiles: null,
      entityCount: null,
      verdict: "fail",
      scopes: [],
    });
    fail(`${reason} (fail-closed)`);
  }

  // 2. Version provenance. A record without a comparable version is not comparable across runs
  //    (archguard 0.1.35→0.1.40 changed detect_cycles' shape and scope resolution).
  const archguardVersion = readArchguardVersion(cli);
  const versionReason =
    archguardVersion === null ? "archguard --version produced no readable version — record is not version-anchored" : null;

  // 3. REAL analyze on every scope (AC1: a real archguard call, not a comment / project-name mention).
  //    A non-zero exit does NOT abort the loop: each scope still produces a not-evaluated signal, so
  //    the carrier records WHICH scopes failed to evaluate instead of collapsing them into one error.
  const scopes = SCOPES.map(({ source, label }) => {
    process.stdout.write(`archguard-runner: analyzing ${label} (${source})\n`);
    const rc = runAnalyze(cli, root, workDir, source, label);
    return readScopeSignal(root, workDir, label, source, rc);
  });

  // 4. Evaluate: every scope must actually be READ, then the structural invariant (sccCount === 0).
  const unevaluated = scopes.filter((s) => !s.evaluated);
  const violated = scopes.filter((s) => s.evaluated && s.sccCount !== 0);
  const evaluated = versionReason === null && unevaluated.length === 0;
  const verdict: HistoryRecord["verdict"] = evaluated && violated.length === 0 ? "pass" : "fail";

  const reasons: string[] = [];
  if (versionReason) reasons.push(versionReason);
  for (const s of scopes) {
    if (s.reason) reasons.push(`${s.scope}: ${s.reason}`);
  }

  // Record-level aggregates are null unless EVERY scope was evaluated — a partial sum would impersonate
  // a complete measurement (⛔ never substitute the sum of the readable scopes for the whole).
  const complete = unevaluated.length === 0;
  const record: HistoryRecord = {
    timestamp: new Date().toISOString(),
    tool: "archguard-runner",
    commitSha: currentCommitSha(root),
    archguardVersion,
    evaluated,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    sourceFiles: complete ? scopes.reduce((n, s) => n + (s.sourceFiles ?? 0), 0) : null,
    entityCount: complete ? scopes.reduce((n, s) => n + (s.entityCount ?? 0), 0) : null,
    verdict,
    scopes,
  };

  // 5. Append the structural signal to the queryable carrier — ALWAYS, including fail-closed runs.
  appendHistory(workDir, record);

  for (const s of scopes) {
    process.stdout.write(
      `archguard-runner: ${s.scope} — evaluated=${s.evaluated} sccCount=${fmt(s.sccCount)} entities=${fmt(s.entityCount)} relations=${fmt(s.totalRelations)} sourceFiles=${fmt(s.sourceFiles)} gitSourceFiles=${fmt(s.gitSourceFiles)} maxInDegree=${fmt(s.maxInDegree)} maxOutDegree=${fmt(s.maxOutDegree)}${s.reason ? ` reason=${s.reason}` : ""}\n`
    );
  }

  if (!evaluated) {
    fail(`NOT EVALUATED — at least one scope could not be read; refusing to report "0 cycles" (硬规则 3b): ${reasons.join("; ")}`);
  }
  if (violated.length > 0) {
    fail(
      `structural violation: dependency cycles detected in ${violated.map((s) => s.scope).join(", ")} — sccCount must be 0`
    );
  }
  process.stdout.write("archguard-runner: PASS — no dependency cycles in any scope\n");
}

main();
