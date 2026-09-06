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
// FAIL-CLOSED（AC2）: 只要「读不到 archguard 的分析产物」就 exit 1 —— archguard CLI 缺失、
// analyze 失败、class/all-classes.json 缺失/不可解析、sccCount > 0，全部 exit 1（红）。exit 0
// 仅当「真的跑了 analyze 且六个 scope 的 sccCount 全为 0」。一个「注掉调用后仍绿」的检查是假保证
// （CLAUDE.md 硬规则 3b：读不懂输入不得返回与合格同形的值）。
//
// CARRIER（AC3）: 每次跑完把结构信号 append 进 `.archguard/metrics-history.jsonl`（追加，不覆盖），
// 使 `.archguard/` 的产物进入一个【可查】载体（`cat .archguard/metrics-history.jsonl` 即可读到
// 逐次的结构信号史）。`.archguard/` 本身 gitignored（archguard 自己的 cache/metrics），故 AC3 走
// 「被某判据读」半边（本 runner 读 class/all-classes.json），不走「git 提交」半边。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root>
//
// Exit: 0 = 六个 scope 都跑通 analyze 且 sccCount 全 0（PASS）;
//       1 = 结构违例（sccCount > 0）或读不到产物（fail-closed RED —— archguard 缺失/analyze 失败/
//           产物缺失/不可解析）;
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

interface ScopeSignal {
  scope: string;
  sccCount: number;
  totalEntities: number;
  totalRelations: number;
  maxInDegree: number;
  maxOutDegree: number;
}

interface HistoryRecord {
  timestamp: string;
  tool: "archguard-runner";
  commitSha: string | null;
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
  process.stderr.write("usage: node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root>\n");
  process.exit(2);
}

/** Resolve the archguard CLI from PATH. null ⇒ fail-closed (the meter must be runnable). */
function resolveArchguardCli(): string | null {
  const r = spawnSync("sh", ["-c", "command -v archguard"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  return r.stdout.trim();
}

/** Run `archguard analyze` on ONE source dir. Returns the exit code (0 = ok).
 *
 *  ⚠️ `--output-dir <workDir>/output/<label>` is NOT optional: archguard derives its own output subdir
 *  from the source's BASENAME (`output/<basename>/class/all-classes.json`), and three provider packages
 *  all share the `src/` basename (plus two `scripts/` dirs). Without a per-scope output-dir the later
 *  analyzes would silently overwrite the earlier ones' `output/src/` / `output/scripts/` (the trap
 *  reproduced in gap-archguard-scope-expand-provider-packages-experiments' probe). The explicit `label`
 *  parents each scope's output so the basename collision is contained and never eats another scope. */
function runAnalyze(cli: string, root: string, source: string, label: string): number {
  const workDir = path.join(root, ".archguard");
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

/** Read the archguard-produced class-level ArchJSON and extract its structural signal.
 *
 *  archguard nests the class output under the source's BASENAME inside the per-scope output dir
 *  (`<workDir>/output/<label>/<basename>/class/all-classes.json`), so the read path mirrors
 *  `runAnalyze`'s `--output-dir <label>` + basename layout. */
function readScopeSignal(root: string, label: string, source: string): ScopeSignal {
  const file = path.join(root, ".archguard", "output", label, path.basename(source), "class", "all-classes.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    fail(`cannot read archguard output ${file} — did analyze actually run? (fail-closed)`);
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    fail(`archguard output ${file} is not valid JSON (fail-closed)`);
  }
  const mv = data?.metricVector;
  if (mv == null || typeof mv !== "object") {
    fail(`archguard output ${file} has no metricVector (fail-closed)`);
  }
  return {
    scope: label,
    sccCount: Number(mv.sccCount ?? 0),
    totalEntities: Number(mv.totalEntities ?? 0),
    totalRelations: Number(mv.totalRelations ?? 0),
    maxInDegree: Number(mv.maxInDegree ?? 0),
    maxOutDegree: Number(mv.maxOutDegree ?? 0),
  };
}

function currentCommitSha(root: string): string | null {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Append ONE history record to `.archguard/metrics-history.jsonl` (the queryable carrier). */
function appendHistory(root: string, record: HistoryRecord): void {
  const file = path.join(root, ".archguard", "metrics-history.jsonl");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch (e) {
    // Carrier write failure must not silently pass — the artifact stays unqueryable (AC3 ⛔).
    fail(`cannot append to ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  let root = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[i + 1] ?? "";
      i++;
    } else {
      usage(`unknown argument: ${args[i]}`);
    }
  }
  if (!root) usage("--root is required");
  if (!fs.existsSync(path.join(root, ".quay", "config.yml")) && !fs.existsSync(path.join(root, ".git"))) {
    usage(`--root ${root} is not a repo worktree`);
  }

  // 1. The meter must be runnable (fail-closed on a missing CLI).
  const cli = resolveArchguardCli();
  if (!cli) fail("archguard CLI not found on PATH (fail-closed — the meter must be runnable)");

  // 2. REAL analyze on every scope (AC1: a real archguard call, not a comment / project-name mention).
  for (const { source, label } of SCOPES) {
    process.stdout.write(`archguard-runner: analyzing ${label} (${source})\n`);
    const rc = runAnalyze(cli, root, source, label);
    if (rc !== 0) fail(`archguard analyze failed for ${label} (exit ${rc})`);
  }

  // 3. Read the produced artifact back (AC3: the criterion reads the .archguard product).
  const scopes = SCOPES.map(({ label, source }) => readScopeSignal(root, label, source));

  // 4. Evaluate the structural invariant: no dependency cycles (sccCount === 0) in every scope.
  const violated = scopes.filter((s) => s.sccCount !== 0);
  const verdict: HistoryRecord["verdict"] = violated.length === 0 ? "pass" : "fail";

  // 5. Append the structural signal to the queryable carrier.
  appendHistory(root, {
    timestamp: new Date().toISOString(),
    tool: "archguard-runner",
    commitSha: currentCommitSha(root),
    verdict,
    scopes,
  });

  for (const s of scopes) {
    process.stdout.write(
      `archguard-runner: ${s.scope} — sccCount=${s.sccCount} entities=${s.totalEntities} relations=${s.totalRelations} maxInDegree=${s.maxInDegree} maxOutDegree=${s.maxOutDegree}\n`
    );
  }

  if (violated.length > 0) {
    fail(
      `structural violation: dependency cycles detected in ${violated.map((s) => s.scope).join(", ")} — sccCount must be 0`
    );
  }
  process.stdout.write("archguard-runner: PASS — no dependency cycles in any scope\n");
}

main();
