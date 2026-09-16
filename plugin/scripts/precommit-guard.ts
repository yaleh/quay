#!/usr/bin/env node
// precommit-guard.ts — 写入那一刻的守卫：① 文档类检查（AC51 断言面拆分）。
//
// ② 拒绝「轮 running 且触及断言面」的写入（覆盖全部写入者）已退役（AC64 2026-08-14，
// gap-ac64-precommit-guard-clause2-retire）：它保护的危险随 AC42 结构性消失——per-task suite
// 跑在各自 worktree、读 worktree 的文件副本，改共享检出的 develop 完全不影响正在跑的 worktree
// suite ⇒ 不是「参照系失效」，是「输入不存在」。退役条款 + 三条立条教训（merge 锁必须共享机制，
// 不得是「各层记得调的约定」）落点 → orchestration/archive/AC58-retired-clauses.md#R27。
// 断言面解析（resolveAssertionSurface）保留：full-suite-runner.ts 的 mid-round-edit 检测
// 仍复用它（同一 judged-object 注册表单源，CLAUDE.md 硬规则 1），但守卫本身不再读 state / 断言面。
//
// MERGE-PATH COVERAGE (gap-precommit-guard-merge-bypass, 2026-08-13): `git merge --no-ff` does NOT
// fire the pre-commit hook (git runs pre-commit only from git-commit(1)) — so assertion-surface files
// landed via a merge bypassed the guard. The pre-merge-commit hook (--install-hook writes BOTH
// pre-commit and pre-merge-commit) covers the --no-ff merge write path for ① (doc checks):
// git-merge(1) runs pre-merge-commit for a `--no-ff` merge and can abort it by exiting non-zero.
// Fast-forward merges create no merge commit, so pre-merge-commit does not fire for them.
// AC62+ (SPEC-fan-in-ff-merge-lock-2026-08-14): the fan-in convention is now **ff-only** —
// `git merge --ff-only` creates no merge commit, so on the fan-in path NEITHER pre-commit (commit-only)
// NOR pre-merge-commit (--no-ff-only) fires ⇒ the DOC check has NO hook trigger there. AC63: the A6
// 无锁段 step 3 EXPLICITLY runs `bash scripts/test.sh --static-checks-doc` BEFORE the ff (not
// hook-dependent — the subagent must run it by hand). The two doc-check runs are DELIBERATELY not
// deduplicated: the first (this guard's pre-commit) covers only the author's own changes; the second
// (step 3) covers content AFTER merging develop — dedup would miss doc conflicts introduced by the
// merge (human-confirmed 2026-08-14).
//
// AC51 断言面拆分（gap-ac51-assertion-surface-split, SPEC §13）：文档类检查（strategic-doc-
// staleness / drive-contract / threshold-scope / state-worded-clause / red-on-omission /
// tick-core-static / instrument-failure）从全量套件移出，落到本守卫（提交那一刻）跑——
// 见 runDocChecks()：shell 到 `bash scripts/test.sh --static-checks-doc`（run_doc_checks 单源）。
//
// 判定（AC64 起无 state 读取——② 退役后不再有轮窗口门，fail-loud 一并退役）：
//   ① 文档类检查：失败 ⇒ 拒提交（reason=doc-check-failed），输出含失败检查器的文件+行号
//      （= 补救位置，SPEC §13.4）——见 runDocChecks()。
//   ③ goal_ac 写入面：见下方「③ `delivery-critical` 新立案任务必须声明 goal_ac」段。
//   ④ quay-init closure-ratchet 新鲜度：见下方「④ quay-init closure-ratchet freshness」段——只在本
//      次提交 staged 了 laydown 源文件时才跑，普通提交零额外开销。
//   state 文件 / 断言面 / --allow-dirty-round 覆盖全部随 ② 退役——见 archive#R27。
//
// 使用（本仓库路径）：
//   node --no-warnings --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
//       [--install-hook] [--uninstall-hook] [--json] [--merge] [--help]
//   --install-hook     把 <git-dir>/hooks/pre-commit 与 <git-dir>/hooks/pre-merge-commit 写成调用
//                      本守卫的 shim（幂等；pre-merge-commit 带 --merge）——commit 与 --no-ff merge
//                      两个写路径同覆盖 ①（文档类检查）
//   --uninstall-hook   移除上述两个钩子中的本守卫 shim（幂等）
//   --json             机器可读输出（{verdict, reason, message, docCheckOutput, merge}）
//   --merge            本轮判定在 merge 上下文（pre-merge-commit 钩子传此 flag；文档检查行为与
//                      commit 完全一致，仅输出标注 merge 上下文）
//
// 退出码：0 = 放行；1 = 拒（doc-check-failed / touches-multi-path-bullet /
//         delivery-critical-without-goal-ac / closure-ratchet-stale / closure-ratchet-grown /
//         closure-ratchet-not-evaluated）；2 = 用法/环境错。
//
// Touches「一条目一路径」detector (gap-touches-one-entry-detector-not-enforcer, 2026-08-16):
//   一个 staged tasks/*.md 的 ## Touches 若含多路径 bullet（AC93/ac86/AC91/AC99 形状——" / " / " + "
//   / "、" / "，" / "," 连接 ≥2 个路径），在【提交这一刻】即拒（touches-multi-path-bullet），
//   不必等套件静态层——每犯一次的代价是 fork→在飞→静态红→改 Touches 重跑 一整条循环。
//   复用与静态检查器（touches-one-entry-one-path-check.ts）【同一个】判定 + shrink-only 祖父基线，
//   不新增第二个 Touches parser。scoped 静态层 check（run_static_checks）原地保留——本 detector 是
//   撰写面补充（提交时红），不是替换。
//
// ③ `delivery-critical` 新立案任务必须声明 `goal_ac`（gap-ac190-goal-ac-rule-not-enforced-at-filing）:
//   （编号原写作 ④，与已退役条款的 ④ 撞号；judge() 与 USAGE 一直称它为 ③，此处对齐——硬规则 8。）
//   AC-190 的判据（long-term-guarantee-goal-backed-check.ts）住在 goal 层、每轮【事后】跑：它看得见
//   违反，却没有任何权力阻止违反发生——一份只读报告。实证（2026-09-13）：生效线
//   （2026-09-09T00:00:00Z）之后第一条 delivery-critical 任务经本仓自己的立案路径写入、promotion-driver
//   机械晋升到 ready，全程没有任何一步问过 goal_ac（硬规则⑨：规则只在违反发生之后有产物 ⇒ 等于靠意志）。
//   本 detector 把【同一条规则】接到写入那一刻：凡 staged `tasks/*.md` 中带 `delivery-critical` 标签、
//   生效线之后立案、且 `goal_ac` 空者 ⇒ 拒提交（reason=delivery-critical-without-goal-ac），输出含文件
//   路径（= 补救位置）。判定函数【单源复用】检测器已导出的纯函数（`isDeliveryCritical` / `hasGoalAc` /
//   `filedAfterCutoff`），⛔ 不复制第二份字符串比较（硬规则 1）。
//   生效线语义与检测器逐字一致（AC5 不误伤）：判定的 scope 是【全部 staged tasks/*.md】，每条按 git
//   first-add 时刻定「立案时刻」——已存在于 HEAD 的存量（生效线之前那批无 goal_ac 的 delivery-critical）
//   照跑判定、结果是 grandfathered ⇒ 放行。⛔ 不把 scope 收成 `--diff-filter=A`：那会把存量排除在
//   判定之外，让 grandfather 分支在写入面【结构上不可达】（硬规则 4b：一个永不被执行的判定不是测量）。
//   无 add commit 的路径 = 本提交正在新增它 ⇒ 按「现在立案」判；下限取生效线，使宿主时钟落后于生效线时
//   也不得静默 grandfathered（fail-closed，硬规则 3b）。
//
//   ⛔ 本条【不是】该规则的执行面（gap-ac190-write-face-rule-unreachable-under-no-verify, 2026-09-14）。
//   本 detector 只在 git `pre-commit` 钩子上跑，而生产立案路径根本不过钩子：`task_write` →
//   `store.ts write()` → `commitStoreWrite()` → `git commit --no-verify`（store-commit.ts:13-15 把
//   `--no-verify` 明写为设计），实测 370/400 条 tasks 提交是该形态 ⇒ ③ 在写者路径上【结构性不可达】
//   （同硬规则 4 推论三：只有那条没人走的路径能满足它）。规则的执行面现落在 `packages/quay-native/
//   src/store.ts` 的 write() 创建路径（判定正本 = `packages/quay/src/goal-ac-write-face.ts`），本
//   detector 保留为【提交那一刻】的第二道判定，与 store 面共用同一个 `judgeStagedDeliveryCritical`。
//
// <!-- enforcement: plugin/scripts/precommit-guard.ts -->

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// Touches「一条目一路径」judgment — the SAME judgment the static checker uses (no second parser).
import { checkTaskOneEntryOnePath, readOneEntryBaseline } from "./touches-one-entry-one-path-check.ts";
import { repoRoot, mainCheckoutRoot } from "./repo-root.ts";
// goal_ac write-surface judgment — the SAME pure functions the AC-190 detector and the STORE's
// creation path use (no second string comparison; single source of the delivery-critical / goal_ac /
// activation-line semantics — 正本 = packages/quay/src/goal-ac-write-face.ts, re-exported by the
// detector so this file's import surface is unchanged).
import {
  activationLineMs,
  filedAfterCutoff,
  hasGoalAc,
  isDeliveryCritical,
  judgeStagedDeliveryCritical,
  type StagedTaskCandidate,
} from "./long-term-guarantee-goal-backed-check.ts";
// ④ closure-ratchet freshness — the SAME judgment the suite's @static-tier change layer runs
// (`--check-stale` / `--gate`), reused IN-PROCESS at the commit moment. `LAYDOWN_SOURCES` is imported,
// never re-typed: the trigger set is the checker's own exported constant (硬规则 1 用机件不手搓 /
// 硬规则 5b 单源).
import {
  LAYDOWN_SOURCES,
  baselineFile,
  checkClosureRatchet,
  collectSourceEntries,
  fingerprintOf,
  readBaseline,
  runLaydown,
} from "./quay-init-closure-ratchet.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 常量 ─────────────────────────────────────────────────────────────────────────────────────────────

/** 断言面注册表（A0b③ 生成；full-suite-runner 的 mid-round-edit 检测经 resolveAssertionSurface 只读它）。 */
const REGISTRY_REL = path.join("plugin", "scripts", "judged-object-registry.json");
/** 钩子 shim 里的固定指纹（--uninstall-hook 据此识别、移除本守卫的 shim）。 */
const HOOK_FINGERPRINT = "precommit-guard.ts";

export interface Verdict {
  verdict: "allow" | "reject" | "error";
  reason: string;
  message: string;
  /** AC51: doc-class check failure output (present when reason === "doc-check-failed"). */
  docCheckOutput: string | null;
  /** gap-touches-one-entry-detector-not-enforcer: Touches detector output (present when reason === "touches-multi-path-bullet"). */
  touchesCheckOutput: string | null;
  /** gap-ac190-goal-ac-rule-not-enforced-at-filing: goal_ac write-surface output (present when reason === "delivery-critical-without-goal-ac"). */
  goalAcCheckOutput: string | null;
  /** gap-closure-ratchet-stale-wire-into-precommit-guard: closure-ratchet freshness output (present when reason === "closure-ratchet-stale" / "closure-ratchet-grown" / "closure-ratchet-not-evaluated"). */
  closureRatchetCheckOutput: string | null;
  /** pre-merge-commit 上下文（钩子传 --merge；文档检查行为与 commit 一致，仅标注）。 */
  merge: boolean;
}

// ── 小工具 ───────────────────────────────────────────────────────────────────────────────────────────

function gitDir(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("not a git repository (git rev-parse --git-dir failed)");
  }
}

/**
 * The hooks directory git actually reads. For a linked worktree this is the COMMON dir's hooks
 * (git resolves `$GIT_DIR/hooks` to the common dir), NOT the worktree-specific gitdir — naively
 * `path.join(gitDir(root), "hooks")` writes a hook git ignores (shared-hook reality, 2026-08-16).
 * `git rev-parse --git-path hooks` is the canonical resolution (main checkout, worktree, AND
 * core.hooksPath overrides all resolve correctly).
 */
export function resolveHooksDir(root: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return path.resolve(root, out);
  } catch { /* fall through to the naive join */ }
  return path.join(gitDir(root), "hooks");
}

/** 全 tracked 文件列表（resolveAssertionSurface 的 fail-closed 回退面）。 */
export function allTrackedFiles(root: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) return [];
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function escapeRegExp(s: string): string {
  const SPECIAL = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  let out = "";
  for (const ch of String(s)) out += SPECIAL.has(ch) ? `\\${ch}` : ch;
  return out;
}

/**
 * glob/path 匹配——语义镜像 select-static-checks-for-touches.ts 的 matchesObject
 * （判定对象语义单源，本守卫不另造一套）：globstar（折叠为 `.*`）、单段通配、
 * 字面目录前缀（`docs/proposals/`）、字面文件精确匹配。含通配的 pattern 视作前缀 + 尾通配
 * （形如 `packages/…/test/` 的目录通配按 `^packages/…/test/.*$` 匹配），与 @static-object
 * 标注的语义一致。注意：块注释里不写 `*` 紧跟 `/` 的字面量（会提前闭合注释）。
 */
export function matchesGlob(pattern: string, rel: string): boolean {
  const p = String(pattern).replace(/\\/g, "/");
  const t = String(rel).replace(/\\/g, "/");
  if (!p || !t) return false;
  if (p === "**") return true;
  if (p.startsWith("**/")) {
    const rest = p.slice(3);
    if (rest.includes("*")) {
      return new RegExp(`${rest.split("*").map(escapeRegExp).join(".*")}$`).test(t);
    }
    return t === rest || t.endsWith(`/${rest}`);
  }
  if (p.includes("*")) {
    return new RegExp(`^${p.split("*").map(escapeRegExp).join(".*")}.*$`).test(t);
  }
  if (p.endsWith("/")) return t.startsWith(p);
  return t === p || t.startsWith(`${p}/`);
}

/**
 * `@static-object` 标注聚合（判定对象由被约束者声明，机械派生、不手列）。
 * gap-ac128-hub-split-harness-concerns: run_static_checks 及其 `@static-object` 标注迁出 scripts/test.sh
 * 到 runner-static-gate.ts ⇒ 聚合须覆盖两文件（test.sh 残留 run_doc_checks 的标注，runner-static-gate.ts
 * 持 run_static_checks 的标注）。两者均缺（如临时测试仓）⇒ 返回 []，fallback 退回 tasks/** + plugin/loop/** 两组。
 */
export function staticObjectPatterns(root: string): string[] {
  const sources: string[] = [];
  const testSh = path.join(root, "scripts", "test.sh");
  if (fs.existsSync(testSh)) sources.push(fs.readFileSync(testSh, "utf8"));
  const staticGate = path.join(root, "plugin", "scripts", "runner-static-gate.ts");  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  if (fs.existsSync(staticGate)) sources.push(fs.readFileSync(staticGate, "utf8"));
  const patterns = new Set<string>();
  for (const src of sources) {
    for (const line of src.split("\n")) {
      const m = line.match(/^\s*#\s*@static-object\s+(.+)$/);
      if (m) {
        for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) patterns.add(tok);
      }
    }
  }
  return [...patterns];
}

// ── AC51 文档类（pre-commit 检查）───────────────────────────────────────────────────────────────────

/**
 * Doc-class object patterns — the union of `# @static-object` annotations in scripts/test.sh's
 * run_doc_checks() body (AC51 断言面拆分, SPEC §13.2 — the doc-consistency checkers moved to
 * pre-commit). A missing run_doc_checks() / missing test.sh ⇒ [] (nothing excluded — conservative).
 * Retained for resolveAssertionSurface (full-suite-runner's mid-round-edit detection reuses the
 * same doc-class exclusion the guard used to apply).
 */
export function docClassPatterns(root: string): string[] {
  const testSh = path.join(root, "scripts", "test.sh");
  if (!fs.existsSync(testSh)) return [];
  const src = fs.readFileSync(testSh, "utf8");
  const lines = src.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^run_doc_checks\(\)\s*\{/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) { end = i; break; }
  }
  const patterns = new Set<string>();
  for (const line of lines.slice(start + 1, end)) {
    const m = line.match(/^\s*#\s*@static-object\s+(.+)$/);
    if (m) for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) patterns.add(tok);
  }
  return [...patterns];
}

/**
 * The concrete DOC files excluded from the assertion surface: tracked files that are (a) markdown
 * documents (`.md`, incl. CLAUDE.md) AND (b) match a doc-class object pattern. Retained for
 * resolveAssertionSurface (the runner's mid-round-edit surface excludes doc files the same way).
 */
export function docClassFiles(root: string): Set<string> {
  const patterns = docClassPatterns(root);
  if (patterns.length === 0) return new Set();
  const tracked = allTrackedFiles(root);
  const docFiles = new Set<string>();
  for (const f of tracked) {
    if (!/\.md$/i.test(f)) continue;
    if (patterns.some((p) => matchesGlob(p, f))) docFiles.add(f);
  }
  return docFiles;
}

/** Run the doc-class static checks at the pre-commit moment (AC51). See the header comment. */
export interface DocCheckResult {
  ok: boolean;
  output: string;
}

export function runDocChecks(root: string): DocCheckResult {
  const testSh = path.join(root, "scripts", "test.sh");
  if (!fs.existsSync(testSh)) return { ok: true, output: "" };
  // AC51 portability: the doc-check gate is only ACTIVE where the split is actually implemented —
  // the workspace's scripts/test.sh must declare the doc-check surface (run_doc_checks + the
  // `--static-checks-doc` branch). A third-party workspace with a plain test.sh must NOT start
  // rejecting every commit (its test.sh would fall through to an unknown-arg error).
  const src = fs.readFileSync(testSh, "utf8");
  if (!/^run_doc_checks\(\)\s*\{/m.test(src) || !src.includes("--static-checks-doc")) {
    return { ok: true, output: "" };
  }
  try {
    const res = spawnSync("bash", [testSh, "--static-checks-doc"], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    if (res.status !== 0) return { ok: false, output };
    return { ok: true, output };
  } catch (e) {
    return { ok: false, output: String((e as Error).message) };
  }
}

// ── Touches「一条目一路径」detector（gap-touches-one-entry-detector-not-enforcer）───────────────────
// 撰写/提交那一刻红掉：一个 staged tasks/*.md 的 ## Touches 含多路径 bullet ⇒ 拒提交。复用静态检查器
// 的同一判定（checkTaskOneEntryOnePath）+ shrink-only 祖父基线——不新增第二个 Touches parser。

export interface TouchesCheckResult {
  ok: boolean;
  output: string;
}

/**
 * Every staged path in the current commit (`git diff --cached --name-only`) — the SINGLE source of
 * this git invocation: the Touches scope, the goal_ac scope and the closure-ratchet trigger set all
 * derive from it (硬规则 1 — no second `git diff --cached` call, no second parser).
 */
export function stagedFilePaths(root: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) return [];
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** Staged task files (tasks/*.md) in the current commit, the Touches-check scope. */
export function stagedTaskFiles(root: string): string[] {
  return stagedFilePaths(root).filter((f) => f.startsWith("tasks/") && f.endsWith(".md"));
}

/** The STAGED (index) content of a file — what WILL be committed (not the working-tree copy). */
export function stagedBlob(root: string, rel: string): string {
  try {
    return execFileSync("git", ["show", `:${rel}`], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/**
 * Run the Touches detector on the staged task files. A staged task whose ## Touches carries a
 * multi-path bullet (AC93/ac86/AC91/AC99 shape) is RED here, at the commit moment — not only at the
 * suite's static layer. Grandfathered files (the shrink-only baseline) are skipped, matching the
 * static checker. A commit with NO staged task file is always ok (nothing to judge).
 */
export function runTouchesChecks(root: string): TouchesCheckResult {
  const staged = stagedTaskFiles(root);
  if (staged.length === 0) return { ok: true, output: "" };
  const { baseline } = readOneEntryBaseline(root);
  const lines: string[] = [];
  for (const rel of staged) {
    const body = stagedBlob(root, rel);
    if (!body) continue;
    const v = checkTaskOneEntryOnePath(body, rel, baseline);
    for (const x of v) lines.push(`  ${rel}: ${x.what}`);
  }
  if (lines.length === 0) return { ok: true, output: "" };
  return { ok: false, output: lines.join("\n") };
}

// ── goal_ac 写入面判定（gap-ac190-goal-ac-rule-not-enforced-at-filing）────────────────────────────
// AC-190 的规则原文（goals/AC-190-task-ac.md）：带 `delivery-critical` 标签的【新立案】任务必须声明
// 非空 `goal_ac`（task→AC 的 goal 层背书）。检测器每轮在 goal 层事后跑；本段把【同一条规则】的判定
// 搬到提交这一刻。scope = staged `tasks/*.md`（复用 stagedTaskFiles——与 Touches detector 同一 scope
// 派生，不新增第二个 `git diff --cached` 调用）。

export interface GoalAcCheckResult {
  ok: boolean;
  output: string;
}

/** A staged task candidate: the STAGED blob (what WILL be committed) + its first-add time.
 *  ⛔ The type (and the judgment below) live in Core (`packages/quay/src/goal-ac-write-face.ts`) and
 *  are re-exported by the detector — the STORE's creation path runs the very same judgment, so this
 *  file may not carry a second copy (gap-ac190-write-face-rule-unreachable-under-no-verify). */

/**
 * First-add epoch ms of a repo-relative path — the committer date of the commit that ADDED it
 * (`git log --diff-filter=A -1`), i.e. the same event the detector's post-cutoff set is built from.
 * null when git has no add commit for the path (a new, not-yet-committed file) or git fails
 * (缺值 = 未查, 硬规则 6 — the caller decides, never conflated with "filed long ago").
 */
export function pathFirstAddMs(root: string, rel: string): number | null {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", rel], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const sec = Number(out.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "");
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Run the goal_ac judgment over the staged task files. A commit with NO staged task file is always ok
 * (nothing to judge). The staged BLOB is read (`git show :<rel>`), not the working-tree copy — the
 * commit being judged carries the index content, and a working-tree edit that is not staged must not
 * change the verdict (same discipline as the Touches detector).
 */
export function runGoalAcChecks(root: string): GoalAcCheckResult {
  const staged = stagedTaskFiles(root);
  if (staged.length === 0) return { ok: true, output: "" };
  const candidates: StagedTaskCandidate[] = staged.map((rel) => ({
    rel,
    content: stagedBlob(root, rel),
    filedAtMs: pathFirstAddMs(root, rel),
  }));
  // The activation line is passed EXPLICITLY (identical to the judgment's own default) so the import
  // stays load-bearing at this call site: the commit-moment judgment and the store's creation-time
  // judgment must read the same cutoff from the same place (硬规则 1).
  const offenders = judgeStagedDeliveryCritical(candidates, activationLineMs());
  if (offenders.length === 0) return { ok: true, output: "" };
  return { ok: false, output: offenders.join("\n") };
}

// ── ④ quay-init closure-ratchet freshness（gap-closure-ratchet-stale-wire-into-precommit-guard）─────
// THE DEFECT THIS CLOSES (2026-09-16, real v0.8.0 release cut): the closure ratchet's freshness
// judgment (`--check-stale`, gap-quay-init-closure-ratchet-manual-reanchor-recurs) lived ONLY in the
// suite's @static-tier change layer — i.e. it was evaluated only when a FULL test suite ran (local
// `scripts/test.sh` or the remote CI `test` job). Both release-cut commits changed
// `plugin/.claude-plugin/plugin.json` (a laydown source) without re-anchoring the committed baseline,
// passed the local pre-commit hook (which judged ①②③ only) and were pushed; two CI runs (35100733320 /
// 35100607207) then failed in ~1-2 min with `STATIC_CHECK_FAILED: quay-init-closure-ratchet-stale`,
// and the human had to re-anchor by hand. Same shape as ③: the judgment already existed and was
// already correct — only its WRITE-FACE half was missing (硬规则 9: 可见性 ≠ 执行).
//
// WHAT IT DOES: if the commit stages a path in the checker's own `LAYDOWN_SOURCES` (imported, never
// re-listed), run the checker's own judgment in-process. The COMMON case (a commit that touches no
// laydown source) returns before any fingerprint/laydown work — see runClosureRatchetChecks' first
// branch, which is what AC3's "普通提交的耗时不受影响" pins (and what makes it a real reading rather
// than a claim: the laydown path is observable — the real `runLaydown` runs `bash quay-init.sh`).
//
// VERDICT POLARITY — ⛔ REJECT-ALWAYS, NEVER AUTO-REPAIR. The task's Plan offered two implementations:
// auto-run the `--reanchor` write + `git add` the baseline into the same commit, or reject with the
// remedy named. This file takes the SECOND (the Plan's degenerate option) because the first one is
// unsound here, not merely riskier:
//   • the index is CROSS-LAYER SHARED MUTABLE STATE in this repo (CLAUDE.md 硬规则 11: three layers
//     share one checkout) — a hook that `git add`s during another layer's commit changes what that
//     commit contains, invisibly to the layer that made it;
//   • `--reanchor` measures the WORKING TREE (`runLaydown` runs `<root>/plugin/scripts/quay-init.sh`;
//     `collectSourceEntries` reads files from disk), while the commit carries the INDEX. When the two
//     diverge, an auto-written baseline would record a fingerprint matching neither, and a fresh
//     checkout would then red — a defect shipped BY the guard that was supposed to prevent one.
// Rejecting keeps the guard read-only on the index and, like ②/③, does not do the author's repair for
// them. The DoD explicitly accepts 挡住 ("在 commit 那一刻就被挡住或自动补全").
//
// THREE-STATE OUTPUT (硬规则 3b): `not-evaluated` (baseline missing/unreadable, or a laydown source
// unreadable) is a DISTINCT status from `stale` and from `fresh` — a judgment that cannot read its
// input never shares an output word with one that passed. It is fail-CLOSED here (fires only when the
// commit already carries a laydown source, so it cannot block ordinary work) — see the AC5 test.

export type ClosureRatchetStatus =
  /** The commit stages no laydown source (or none exists here) — nothing to judge; zero extra work. */
  | "not-applicable"
  /** Fingerprint matches the committed baseline — in sync, allow. */
  | "fresh"
  /** A laydown source changed without a re-anchor AND the real laydown did not grow past the baseline. */
  | "stale"
  /** A laydown source changed AND the real laydown exceeds the baseline (true growth) — must be refused. */
  | "stale-and-grown"
  /** The freshness judgment could not be read (baseline/sources) or the gate could not classify. */
  | "not-evaluated";

export interface ClosureRatchetCheckResult {
  status: ClosureRatchetStatus;
  ok: boolean;
  /** Human-readable detail; null on the allow path (hard rule 3b — nothing to report is not a report). */
  output: string | null;
}

/** Staged paths that ARE laydown sources — the trigger set. Derived from the checker's exported
 *  `LAYDOWN_SOURCES` (硬规则 5b: never a second hand-copied list). */
export function stagedLaydownSources(root: string): string[] {
  return stagedFilePaths(root).filter((rel) => LAYDOWN_SOURCES.includes(rel));
}

/**
 * Run the closure-ratchet freshness judgment against the STAGED commit. Returns `not-applicable` (ok)
 * without touching the fingerprint machinery when the commit stages no laydown source — the ordinary
 * commit path pays one `git diff --cached` that ②/③ already paid.
 */
export function runClosureRatchetChecks(root: string): ClosureRatchetCheckResult {
  const touched = stagedLaydownSources(root);
  if (touched.length === 0) return { status: "not-applicable", ok: true, output: null };

  const baselinePath = baselineRelPath(root);
  const head = `  staged laydown source(s): ${touched.join(", ")}`;

  if (!fs.existsSync(baselineFile(root))) {
    return {
      status: "not-evaluated",
      ok: false,
      output:
        `${head}\n` +
        `  committed baseline MISSING: ${baselinePath} — freshness cannot be judged either way.\n` +
        "  (a checker that cannot read its baseline is never conflated with \"in sync\" — 硬规则 3b)",
    };
  }
  const baseline = readBaseline(root);
  if (baseline === null) {
    return {
      status: "not-evaluated",
      ok: false,
      output: `${head}\n  committed baseline UNREADABLE (${baselinePath}: not JSON / missing fields).`,
    };
  }
  const entries = collectSourceEntries(root);
  if (entries === null) {
    return {
      status: "not-evaluated",
      ok: false,
      output: `${head}\n  a laydown source under the checker's LAYDOWN_SOURCES could not be read (fingerprint unavailable).`,
    };
  }

  const currentFp = fingerprintOf(entries);
  if (currentFp === baseline.fingerprint) return { status: "fresh", ok: true, output: null };

  // STALE. Classify with the REAL laydown (the `--gate` measurement) so the message can say WHICH
  // failure this is — shrink-only (content changed, footprint did not) or true growth. Paid only on
  // commits that change a laydown source AND are stale, i.e. exactly the release-cut-shaped commit.
  const measured = runLaydown(root);
  if (!measured.evaluated) {
    return {
      status: "stale",
      ok: false,
      output:
        `${head}\n` +
        `  fingerprint ${currentFp.slice(0, 16)}… ≠ baseline ${baseline.fingerprint.slice(0, 16)}… (stale)\n` +
        `  gate classification NOT-EVALUATED — the real laydown could not run: ${measured.error ?? "unknown"}`,
    };
  }
  const verdict = checkClosureRatchet(measured, baseline);
  if (!verdict.ok) {
    return {
      status: "stale-and-grown",
      ok: false,
      output:
        `${head}\n` +
        `  the real laydown GREW past the shrink-only baseline: ${measured.files} files (baseline ${baseline.files})` +
        ` / ${measured.bytes} bytes (baseline ${baseline.bytes})` +
        `${verdict.overFiles ? " [over files]" : ""}${verdict.overBytes ? " [over bytes]" : ""}\n` +
        `  fingerprint ${currentFp.slice(0, 16)}… ≠ baseline ${baseline.fingerprint.slice(0, 16)}… (stale)`,
    };
  }
  return {
    status: "stale",
    ok: false,
    output:
      `${head}\n` +
      `  fingerprint ${currentFp.slice(0, 16)}… ≠ baseline ${baseline.fingerprint.slice(0, 16)}… (stale)\n` +
      `  real laydown ${measured.files} files / ${measured.bytes} bytes ≤ baseline ${baseline.files} files / ` +
      `${baseline.bytes} bytes ⇒ shrink-only (footprint did not grow; the source content changed)`,
  };
}

// ── 断言面集合（full-suite-runner 复用；守卫本身不再读它——② 退役）─────────────────────────────────

export interface RegistryShape {
  version?: number;
  patterns?: string[];
  [k: string]: unknown;
}

/**
 * 断言面集合 = 实证闯祸类 ∪ @static-object 聚合 ∪ 注册表派生面（外层裁定 B 修正收窄 seed patterns）。
 * AC64 起本守卫不再消费它（② 退役）；full-suite-runner.ts 的 mid-round-edit 检测仍复用它——
 * 同一 judged-object 注册表单源，缺失/空回退「实证闯祸类 + 判定对象声明」。
 */
export const FALLBACK_TROUBLE_CLASSES = ["tasks/**", "plugin/loop/**"] as const;

export function resolveAssertionSurface(root: string): {
  mode: "registry" | "fallback-narrowed";
  patterns: string[];
  files: string[];
} {
  const tracked = allTrackedFiles(root);
  const regPath = path.join(root, REGISTRY_REL);
  let patterns: string[] = [];
  if (fs.existsSync(regPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(regPath, "utf8")) as RegistryShape;
      if (Array.isArray(raw.patterns) && raw.patterns.length > 0) {
        patterns = raw.patterns.map(String);
      }
    } catch {
      patterns = []; // 不可解析 ⇒ 回退（fail-closed）
    }
  }
  const docFiles = docClassFiles(root);
  const excludeDoc = (files: string[]): string[] => files.filter((f) => !docFiles.has(f));
  if (patterns.length === 0) {
    const fallback = [...FALLBACK_TROUBLE_CLASSES, ...staticObjectPatterns(root)];
    const files = excludeDoc(tracked.filter((f) => fallback.some((p) => matchesGlob(p, f))));
    return { mode: "fallback-narrowed", patterns: [], files };
  }
  const files = excludeDoc(tracked.filter((f) => patterns.some((p) => matchesGlob(p, f))));
  return { mode: "registry", patterns, files };
}

// ── 主判定 ───────────────────────────────────────────────────────────────────────────────────────────

export function judge(
  root: string,
  opts: { merge?: boolean } = {},
): Verdict {
  // ① 文档类检查（AC51 断言面拆分——文档检查在提交这一刻跑，不进全量套件）。失败 ⇒ 拒。
  //    失败输出含检查器打印的文件+行号 = 补救位置（SPEC §13.4）。
  const docResult = runDocChecks(root);
  if (!docResult.ok) {
    return {
      verdict: "reject",
      reason: "doc-check-failed",
      message:
        "pre-commit 守卫：文档类检查失败（AC51 断言面拆分——文档检查在提交这一刻跑，不再等一轮套件）。\n" +
        "失败检查器的输出含文件+行号（= 补救位置）；修复后重新提交。\n" +
        "─── 文档类检查输出 ───\n" +
        docResult.output,
      docCheckOutput: docResult.output,
      touchesCheckOutput: null,
      goalAcCheckOutput: null,
      closureRatchetCheckOutput: null,
      merge: opts.merge === true,
    };
  }

  // ② Touches「一条目一路径」detector（gap-touches-one-entry-detector-not-enforcer）：提交这一刻红掉
  //    staged tasks/*.md 的多路径 Touches bullet——不必等套件静态层（fork→在飞→静态红→改 Touches
  //    重跑 的循环）。复用静态检查器同一判定 + 祖父基线（不新增第二个 parser）。
  const touchesResult = runTouchesChecks(root);
  if (!touchesResult.ok) {
    return {
      verdict: "reject",
      reason: "touches-multi-path-bullet",
      message:
        'pre-commit 守卫：Touches 多路径 bullet（touches-one-entry-one-path 判据1——每个 ## Touches ' +
        'bullet 只允许一个路径/glob 条目）。\n' +
        '多路径 bullet（" / " / " + " / "、" / "，" / "," 连接 ≥2 个真实路径）会被 parseTouchEntriesWithTags ' +
        '当【单一 glob】——匹配不到任何文件、且把每个真实路径藏起来使重叠判不到。\n' +
        '修复：把多路径 bullet 拆成每行一个条目后重新提交。\n' +
        '─── Touches 检查输出 ───\n' +
        touchesResult.output,
      docCheckOutput: null,
      touchesCheckOutput: touchesResult.output,
      goalAcCheckOutput: null,
      closureRatchetCheckOutput: null,
      merge: opts.merge === true,
    };
  }

  // ③ goal_ac 写入面判定（gap-ac190-goal-ac-rule-not-enforced-at-filing）：staged tasks/*.md 里
  //    「delivery-critical + 生效线之后立案 + goal_ac 空」在提交这一刻即拒——不再只有 goal 层的事后
  //    报告（那时任务已经写进 store、并且已被机械晋升到 ready）。
  const goalAcResult = runGoalAcChecks(root);
  if (!goalAcResult.ok) {
    return {
      verdict: "reject",
      reason: "delivery-critical-without-goal-ac",
      message:
        "pre-commit 守卫：delivery-critical 新立案任务未声明 goal_ac（AC-190 判据的写入面，\n" +
        "goals/AC-190-task-ac.md）。带 `delivery-critical` 标签的任务必须有 goal 层背书：它的\n" +
        "top-level frontmatter 要有非空 `goal_ac: <AC-id>`（指向 goal store 里领域覆盖本任务的那条 AC）。\n" +
        "修复：给该任务的 frontmatter 补 `goal_ac`（并说明为什么是这条 AC）后重新提交。\n" +
        "⛔ 去掉 `delivery-critical` 标签也能绕开本判定——那属于放宽判据，需在该任务体里写明理由。\n" +
        "─── goal_ac 检查输出 ───\n" +
        goalAcResult.output,
      docCheckOutput: null,
      touchesCheckOutput: null,
      goalAcCheckOutput: goalAcResult.output,
      closureRatchetCheckOutput: null,
      merge: opts.merge === true,
    };
  }

  // ④ quay-init closure-ratchet freshness（gap-closure-ratchet-stale-wire-into-precommit-guard）：
  //    本次提交 staged 了 laydown 源文件（checker 自己的 LAYDOWN_SOURCES，import 单源）而 committed
  //    baseline 陈旧 ⇒ 提交这一刻即拒。先前这条判据只活在套件的 @static-tier change 层——改动能干净
  //    commit + push，直到远端 CI 跑完整套件才报 STATIC_CHECK_FAILED（2026-09-16 v0.8.0 release cut
  //    实证：两次 CI run 白跑）。⛔ 不自动重锚：见上方 ④ 段落的理由（索引是跨层共享可变状态；--reanchor
  //    量的是工作树而提交带的是索引）。本条与 ②③ 同形：判定已存在且正确，缺的是写入面这一半。
  const ratchetResult = runClosureRatchetChecks(root);
  if (!ratchetResult.ok) {
    const grown = ratchetResult.status === "stale-and-grown";
    const reason =
      ratchetResult.status === "not-evaluated"
        ? "closure-ratchet-not-evaluated"
        : grown
          ? "closure-ratchet-grown"
          : "closure-ratchet-stale";
    const why = grown
      ? "committed baseline 陈旧，且真实 laydown 已【膨胀】越过 shrink-only 基线——棘轮只许降不许升，必须改小 laydown，不得重锚放行。"
      : ratchetResult.status === "not-evaluated"
        ? "本次提交改了 laydown 源文件，但棘轮的 committed baseline 读不到（缺 / 不可解析 / 源文件不可读）——无法判定新鲜与否，按 fail-closed 拒绝。"
        : "committed baseline 的 source fingerprint 已陈旧（改了 laydown 源文件却没有同步重锚）——实测未膨胀，只是内容变化导致指纹过期。";
    return {
      verdict: "reject",
      reason,
      message:
        `pre-commit 守卫：${why}\n` +
        "（判据正本 = plugin/scripts/quay-init-closure-ratchet.ts；本条把套件 @static-tier change 层的\n" +
        " `--check-stale` 提前到提交这一刻——不再等到跑一次完整套件/远端 CI 才发现。）\n" +
        "修复（先分类，再决定）：\n" +
        "  ① 先看是哪一种（--gate 会真跑一次 laydown 去量 footprint）：\n" +
        "     node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --check-stale\n" +
        "     node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --gate\n" +
        "  ② --gate 绿（shrink-only：只是内容变了）⇒ 机械重锚，并把新基线纳入本次提交：\n" +
        "     node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor\n" +
        `     git add ${baselineRelPath(root)}\n` +
        "  ③ --gate 红（footprint 真实膨胀）⇒ 改小 laydown 本身；⛔ 重锚不是修复方式（会把棘轮放宽成恒真）。\n" +
        "─── closure-ratchet 检查输出 ───\n" +
        ratchetResult.output,
      docCheckOutput: null,
      touchesCheckOutput: null,
      goalAcCheckOutput: null,
      closureRatchetCheckOutput: ratchetResult.output,
      merge: opts.merge === true,
    };
  }

  return {
    verdict: "allow",
    reason: "doc-checks-pass",
    message:
      "pre-commit 守卫：文档类检查通过（①）+ Touches 单路径（②）+ goal_ac 写入面（③）+ " +
      "quay-init closure-ratchet 新鲜度（④：本次提交未触及 laydown 源文件，或指纹与 committed baseline 一致），放行。",
    docCheckOutput: null,
    touchesCheckOutput: null,
    goalAcCheckOutput: null,
    closureRatchetCheckOutput: null,
    merge: opts.merge === true,
  };
}

/** Repo-relative path of the committed baseline file (for the messages above). */
function baselineRelPath(root: string): string {
  return path.relative(root, baselineFile(root)).split(path.sep).join("/");
}

// ── 钩子安装/卸载 ────────────────────────────────────────────────────────────────────────────────────

/** The `exec node …` line the hook shim runs — the guard's OWN resolved executable, baked at INSTALL
 *  time. ⛔ Not `"$ROOT/plugin/scripts/…"` — AC168 removes the workspace copy, and a runtime `$ROOT`
 *  join would hit a worktree copy (AC139-4). The guard is SELF-REFERENTIAL (it locates itself, not an
 *  arbitrary plugin script), so the resolution is its own `import.meta.url` (raw `.ts` in the dev
 *  tree, the bundled `dist/*.js` in the shipped artifact — strip-types follows the extension) PLUS the
 *  plugin layer's existing `mainCheckoutRoot` (repo-root.ts) to redirect a worktree copy to the main
 *  checkout. ⛔ Not the Core `plugin-root.ts` resolver: a plugin→Core static import breaks under
 *  npm-pack staging (esbuild cannot resolve `../../packages/quay/src/…` from the staged
 *  `packages/quay/plugin/scripts/…`), and the self-location idiom is the correct resolution for a
 *  self-referential hook rather than re-inventing the Core resolver in bash. */
function guardExecLine(merge: boolean): string {
  const selfPath = fileURLToPath(import.meta.url);
  let scriptPath = selfPath;
  const main = mainCheckoutRoot(path.dirname(selfPath));
  if (main) {
    const mainGuard = path.join(main, "plugin", "scripts", HOOK_FINGERPRINT);
    if (fs.existsSync(mainGuard)) scriptPath = mainGuard;
  }
  const strip = scriptPath.endsWith(".ts") ? " --experimental-strip-types" : "";
  return `exec node --no-warnings${strip} "${scriptPath}" --root "$ROOT"${merge ? " --merge" : ""}`;
}

function hookShim(root: string): string {
  return [
    "#!/usr/bin/env bash",
    `# ${HOOK_FINGERPRINT} — installed by plugin/scripts/precommit-guard.ts --install-hook`,
    "# pre-commit guard: ① runs the DOC-CLASS checks at commit time (AC51 断言面拆分 — doc checks",
    "# are no longer in the full suite, so editing docs no longer makes a running round red);",
    "# ② runs the Touches「一条目一路径」detector on staged tasks/*.md at the commit moment",
    "#    (gap-touches-one-entry-detector-not-enforcer — a multi-path Touches bullet reds HERE,",
    "#    not at the suite's static layer).",
    "# ③ runs the goal_ac write-surface judgment on staged tasks/*.md (gap-ac190-goal-ac-rule-not-",
    "#    enforced-at-filing — a delivery-critical task filed after the activation line WITHOUT",
    "#    goal_ac is rejected HERE, where it is written, instead of only in the goal-layer report).",
    "# ④ runs the quay-init closure-ratchet freshness judgment when the commit stages a laydown",
    "#    source (gap-closure-ratchet-stale-wire-into-precommit-guard — a changed laydown source",
    "#    with a stale baseline is rejected HERE, instead of only at the suite's @static-tier change",
    "#    layer / the remote CI, which is ~1-2 min and a whole CI run later).",
    "# (rejecting running-round assertion-surface commits was RETIRED under AC64 — see",
    "# orchestration/archive/AC58-retired-clauses.md#R27.)",
    'ROOT="$(git rev-parse --show-toplevel)"',
    guardExecLine(false),
    "",
  ].join("\n");
}

/**
 * The pre-merge-commit hook shim (merge-path coverage, gap-precommit-guard-merge-bypass). git runs
 * pre-merge-commit for `git merge --no-ff` after carrying out the merge and BEFORE creating the merge
 * commit (pre-commit is NOT fired for merges — git-merge does not go through git-commit's hook path).
 * At that moment the index holds the merged result; the hook runs the SAME doc-check gate (①).
 * AC62: fan-in is ff-only (no merge commit ⇒ pre-merge-commit does not fire there); the A6 无锁段
 * step 3 runs the doc check explicitly (AC63).
 */
export function preMergeCommitShim(root: string): string {
  return [
    "#!/usr/bin/env bash",
    `# ${HOOK_FINGERPRINT} — installed by plugin/scripts/precommit-guard.ts --install-hook`,
    "# pre-merge-commit guard: ① runs the DOC-CLASS checks at merge time (AC51 断言面拆分);",
    "# ② runs the Touches「一条目一路径」detector on the merged-in tasks/*.md at the merge moment;",
    "# ③ runs the goal_ac write-surface judgment on the merged-in tasks/*.md (a delivery-critical",
    "#    task filed after the activation line without goal_ac is rejected at the merge moment too).",
    "# ④ runs the quay-init closure-ratchet freshness judgment on the merged-in laydown sources",
    "#    (a merge that carries a changed laydown source past a stale baseline is rejected here too).",
    "# (rejecting running-round merges was RETIRED under AC64 — see",
    "# orchestration/archive/AC58-retired-clauses.md#R27.)",
    'ROOT="$(git rev-parse --show-toplevel)"',
    guardExecLine(true),
    "",
  ].join("\n");
}

export function installHook(root: string): string {
  const hooksDir = resolveHooksDir(root);
  fs.mkdirSync(hooksDir, { recursive: true });
  // pre-commit (commit write-path) — the original guard hook (idempotent; refuses unrelated hook).
  const hookPath = path.join(hooksDir, "pre-commit");
  const shim = hookShim(root);
  if (fs.existsSync(hookPath) && !fs.readFileSync(hookPath, "utf8").includes(HOOK_FINGERPRINT)) {
    throw new Error(
      `pre-existing pre-commit hook at ${hookPath} does not carry the ${HOOK_FINGERPRINT} fingerprint; ` +
        "refusing to overwrite. Merge manually.",
    );
  }
  fs.writeFileSync(hookPath, shim, { mode: 0o755 });
  // pre-merge-commit (merge write-path — gap-precommit-guard-merge-bypass): git merge --no-ff does
  // NOT fire pre-commit, so the merge path needs its own hook. Same doc-check gate, --merge context.
  const mergeHookPath = path.join(hooksDir, "pre-merge-commit");
  const mergeShim = preMergeCommitShim(root);
  if (fs.existsSync(mergeHookPath) && !fs.readFileSync(mergeHookPath, "utf8").includes(HOOK_FINGERPRINT)) {
    throw new Error(
      `pre-existing pre-merge-commit hook at ${mergeHookPath} does not carry the ${HOOK_FINGERPRINT} fingerprint; ` +
        "refusing to overwrite. Merge manually.",
    );
  }
  fs.writeFileSync(mergeHookPath, mergeShim, { mode: 0o755 });
  return hookPath;
}

export function uninstallHook(root: string): { removed: boolean; hookPath: string } {
  const hooksDir = resolveHooksDir(root);
  let removed = false;
  // Remove BOTH the pre-commit and pre-merge-commit guard shims (idempotent; a hook that does not
  // carry the fingerprint is left untouched — never clobber an unrelated hook).
  for (const name of ["pre-commit", "pre-merge-commit"]) {
    const hookPath = path.join(hooksDir, name);
    if (fs.existsSync(hookPath)) {
      const content = fs.readFileSync(hookPath, "utf8");
      if (content.includes(HOOK_FINGERPRINT)) {
        fs.rmSync(hookPath, { force: true });
        removed = true;
      }
    }
  }
  return { removed, hookPath: path.join(hooksDir, "pre-commit") };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `precommit-guard.ts — 写入那一刻的守卫：① 文档类检查（AC51 断言面拆分）；
② Touches「一条目一路径」detector（gap-touches-one-entry-detector-not-enforcer——staged tasks/*.md
的 ## Touches 多路径 bullet 在提交这一刻红掉，不必等套件静态层）；
③ delivery-critical 新立案任务必须声明 goal_ac（gap-ac190-goal-ac-rule-not-enforced-at-filing——
AC-190 判据的写入面：带 delivery-critical 标签、生效线之后立案、goal_ac 空 ⇒ 拒提交）；
④ 本次提交 staged 了 quay-init laydown 源文件（checker 自己的 LAYDOWN_SOURCES，import 单源）而
committed baseline 陈旧 ⇒ 拒提交（gap-closure-ratchet-stale-wire-into-precommit-guard——把套件
@static-tier change 层的 --check-stale 提前到提交这一刻；⛔ 不自动重锚，理由见 ④ 段落）；
（拒绝「轮 running 且触及断言面」的写入已退役——AC64）→ orchestration/archive/AC58-retired-clauses.md#R27。

用法:
  node --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
       [--install-hook] [--uninstall-hook] [--json] [--merge] [--help]

参数:
  --install-hook      把 <git-dir>/hooks/pre-commit 与 <git-dir>/hooks/pre-merge-commit 写成调用
                      本守卫的 shim（幂等；pre-merge-commit 带 --merge）。hooks 目录用
                      git rev-parse --git-path hooks 解析（worktree 下是 common dir 的 hooks）
  --uninstall-hook    移除上述两个钩子中的本守卫 shim（幂等）
  --merge             本轮判定在 merge 上下文（pre-merge-commit 钩子传此 flag；文档检查行为与
                      commit 一致，仅输出标注）
  --json              机器可读输出（{verdict, reason, message, docCheckOutput, touchesCheckOutput,
                      goalAcCheckOutput, closureRatchetCheckOutput, merge}）
  --help              本帮助

退出码: 0=放行 1=拒（doc-check-failed / touches-multi-path-bullet /
        delivery-critical-without-goal-ac / closure-ratchet-stale / closure-ratchet-grown /
        closure-ratchet-not-evaluated） 2=用法/环境错`;

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let root: string | null = null;
  let json = false;
  let install = false;
  let uninstall = false;
  let mergeContext = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") {
      root = args[++i] ?? null;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--install-hook") {
      install = true;
    } else if (a === "--uninstall-hook") {
      uninstall = true;
    } else if (a === "--merge") {
      mergeContext = true;
    } else {
      console.error(`unknown arg: ${a}\n\n${USAGE}`);
      return 2;
    }
  }
  if (!root) {
    try {
      root = repoRoot(process.cwd());
    } catch {
      root = process.cwd();
    }
  }
  root = path.resolve(root);

  try {
    if (install) {
      const hp = installHook(root);
      console.log(`precommit-guard: installed pre-commit hook at ${hp}`);
      return 0;
    }
    if (uninstall) {
      const { removed, hookPath } = uninstallHook(root);
      console.log(removed ? `precommit-guard: removed hook at ${hookPath}` : `precommit-guard: no guard hook at ${hookPath}`);
      return 0;
    }
  } catch (e) {
    console.error(`precommit-guard: ${(e as Error).message}`);
    return 2;
  }

  let verdict: Verdict;
  try {
    verdict = judge(root, { merge: mergeContext });
  } catch (e) {
    console.error(`precommit-guard: internal error: ${(e as Error).message}`);
    return 2;
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          verdict: verdict.verdict,
          reason: verdict.reason,
          message: verdict.message,
          docCheckOutput: verdict.docCheckOutput,
          touchesCheckOutput: verdict.touchesCheckOutput,
          goalAcCheckOutput: verdict.goalAcCheckOutput,
          closureRatchetCheckOutput: verdict.closureRatchetCheckOutput,
          merge: verdict.merge,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(verdict.message);
  }
  return verdict.verdict === "reject" ? 1 : 0;
}

/** 直跑判定（import 测试时不执行 main）：realpath(process.argv[1]) === 本文件自身。 */
function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // Bundling-safe basename check: under esbuild import.meta.url is the BUNDLE path for every
    // inlined module, so a realpath comparison would fire this module's CLI when it is inlined
    // into another entry (verified: ready-pool-check.js ran precommit-guard's main). Compare the
    // invoked file's basename against THIS module's own basename instead.
    return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === "precommit-guard";
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  process.exit(main());
}

export { repoRoot, gitDir, hookShim };
