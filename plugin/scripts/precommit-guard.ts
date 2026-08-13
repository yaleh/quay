#!/usr/bin/env node
// precommit-guard.ts — 写入那一刻的守卫：① 文档类检查（AC51 断言面拆分）；② 拒绝「轮 running
// 且触及断言面」的写入（覆盖全部写入者）。
//
// MERGE-PATH COVERAGE (gap-precommit-guard-merge-bypass, 2026-08-13): `git merge --no-ff` does NOT
// fire the pre-commit hook (git runs pre-commit only from git-commit(1)) — so assertion-surface files
// landed via a merge bypassed the guard entirely (inner's empirical test: 2 commits → 2 fires /
// 1 merge → 0 fires; round 123's idempotency fan-in merge was a live sample — the guard never saw it).
// The fix is the PRE-MERGE-COMMIT hook (--install-hook writes BOTH pre-commit and pre-merge-commit):
// git-merge(1) runs pre-merge-commit for a `--no-ff` merge after carrying it out and BEFORE creating
// the merge commit, and it can abort the merge by exiting non-zero. At that moment the index holds the
// merged result, so the SAME `stagedFiles()` read (`git diff --cached --name-only`) is the merge's
// incoming file set — judge() needs no new write-path logic, only the --merge flag for message/ledger
// clarity. A blocked merge leaves MERGE_HEAD + staged changes (git does NOT auto-abort); the caller
// (e.g. the A6 fan-in failure path) must `git merge --abort`. Fast-forward merges create no merge
// commit, so pre-merge-commit does not fire for them — the guard's merge coverage is scoped to the
// --no-ff family (the fan-in convention, round-123 shape).
//
// ② 的实证（2026-08-12，三独立支撑，manager 判定）：「round 期间零提交」约定守不住：
//   ① 约定无产物（C17）——round 60 约定后 26s 即破（外层 47023142）；
//   ② 连事后都难区分——要靠人拿 startedAt 逐笔比对 commit 时刻；
//   ③ 参与方不完整且名单无人维护（最硬）——inner 从不在约定里，round 63 窗口内
//      以 30-40s 一次提交 4 笔任务体更新，无人告诉它有一轮在跑。
//   ①②可靠「更小心」缓解，③结构上不可能靠小心解决。守卫必须覆盖名单之外的写入者，
//   因此机制 = 共享 pre-commit 钩子（--install-hook 写入 <git-dir>/hooks/pre-commit）——
//   不是各层各自记得调的 commit 包装。约定参与方名单不可维护，钩子天然覆盖所有提交者。
//
// AC51 断言面拆分（gap-ac51-assertion-surface-split, SPEC §13）：文档类检查（strategic-doc-
// staleness / drive-contract / threshold-scope / state-worded-clause / red-on-omission /
// tick-core-static / instrument-failure）从全量套件移出，落到本守卫（提交那一刻）跑——
// 见 runDocChecks()：shell 到 `bash scripts/test.sh --static-checks-doc`（run_doc_checks 单源）。
// 因为它们不再进套件，文档文件不再被在跑的轮读取 ⇒ 断言面剔除文档（docClassFiles），
// 编辑文档不再使在跑的轮变红、也不需要窗口（① 踏空 / ②' override 作废认证 全消失）。
//
// 判定（读 .quay/full-suite-state.json）：
//   A. 文档类检查：失败 ⇒ 拒提交（reason=doc-check-failed），输出含失败检查器的文件+行号
//      （= 补救位置，SPEC §13.4）。--allow-dirty-round 只覆盖 B，不覆盖 A。
//   B. state == "running" 且 本次提交触及（代码类）断言面文件 ⇒ 拒提交（exit 1）+ 预检清单
//   state 文件缺失 / state 字段 null ⇒ 拒（fail-loud——参照系缺失时谓词必须崩，AC2）
//   断言面集合 = plugin/scripts/judged-object-registry.json 的 patterns（A0b③ 生成，
//     非手工维护；守卫只读它）。缺失/空/不可解析 ⇒ 回退「实证闯祸类 + 判定对象声明」：
//     tasks/**（round 60/63/67）+ plugin/loop/**（cp 事故面）+ scripts/test.sh 的
//     @static-object 聚合（套件检查器判定对象，含 orchestration/*-tick-core.md）——
//     不再回退全 tracked（4113/4316 实测不可用，外层裁定 B 修正；fail-closed 保留）。
//     AC51 起：该面再剔除 scripts/test.sh run_doc_checks() 的 `# @static-class doc` 对象的
//     .md 文档（docClassFiles）——文档检查已移到 pre-commit，不再被套件读取。
//   --allow-dirty-round（CLI 参数或 QUAY_ALLOW_DIRTY_ROUND=1 环境变量）显式覆盖 B——
//     有记录可追责，不静默绕过。
//
// 使用（本仓库路径）：
//   node --no-warnings --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
//       [--allow-dirty-round] [--install-hook] [--uninstall-hook] [--json] [--merge] [--help]
//   --install-hook     把 <git-dir>/hooks/pre-commit 与 <git-dir>/hooks/pre-merge-commit 写成调用
//                      本守卫的 shim（幂等；pre-merge-commit 带 --merge）——commit 与 merge 两个
//                      写路径同覆盖（merge 路径：gap-precommit-guard-merge-bypass）
//   --uninstall-hook   移除上述两个钩子中的本守卫 shim（幂等）
//   --json             机器可读输出（{verdict, reason, state, assertionSurface, staged, merge}）
//   --merge            本轮判定在 merge 上下文（pre-merge-commit 钩子传此 flag；消息与拒绝台账
//                      标注 kind=merge，判定逻辑与 commit 完全一致）
//   --allow-dirty-round / QUAY_ALLOW_DIRTY_ROUND=1  显式覆盖 B（记录可追责；A 仍生效）
//
// 退出码：0 = 放行；1 = 拒（doc-check-failed / running+断言面 / fail-loud 缺失/null）；
// 2 = 用法/环境错。
//
// 作为钩子运行时 git 不传参数，--allow-dirty-round 只能经
// QUAY_ALLOW_DIRTY_ROUND=1 环境变量显式给出（git commit / git merge 前设置）。
//
// <!-- enforcement: plugin/scripts/precommit-guard.ts -->

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 常量 ─────────────────────────────────────────────────────────────────────────────────────────────

/** state 文件 well-known 位置（相对 --root）。full-suite-runner.ts 写它。 */
const STATE_FILE_REL = path.join(".quay", "full-suite-state.json");
/** 断言面注册表（A0b③ 生成；守卫只读，缺失/空回退全 tracked——fail-closed）。 */
const REGISTRY_REL = path.join("plugin", "scripts", "judged-object-registry.json");
/** 钩子 shim 里的固定指纹（--uninstall-hook 据此识别、移除本守卫的 shim）。 */
const HOOK_FINGERPRINT = "precommit-guard.ts";

export const RUNNING = "running";

export interface Verdict {
  verdict: "allow" | "reject" | "error";
  reason: string;
  message: string;
  state: Record<string, unknown> | null;
  stateFile: string | null;
  assertionSurface: string[];
  staged: string[];
  touchedAssertion: string[];
  override: boolean;
  registryMode: "registry" | "fallback-narrowed" | "error";
  /** AC51: doc-class check failure output (present when reason === "doc-check-failed"). */
  docCheckOutput?: string;
}

// ── 小工具 ───────────────────────────────────────────────────────────────────────────────────────────

function repoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

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

/** 已暂存（即将提交）的文件列表，repo-相对路径。pre-commit 钩子与包装脚本同一读取面。 */
export function stagedFiles(root: string): string[] {
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

/** 全 tracked 文件列表（fail-closed 回退面）。 */
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
 * scripts/test.sh 的 `@static-object` 标注聚合（判定对象由被约束者声明，机械派生、不手列）。
 * 这些是套件内检查器的判定对象——轮中改它们会让检查在改后状态上跑 ⇒ 可翻转轮结论
 * （12a6b18b 改 orchestration/manager-tick-core.md 落在 round 53 窗口，manager 亲手闯的类）。
 * 无 scripts/test.sh（如临时测试仓）⇒ 返回 []，fallback 退回 tasks/** + plugin/loop/** 两组。
 */
export function staticObjectPatterns(root: string): string[] {
  const testSh = path.join(root, "scripts", "test.sh");
  if (!fs.existsSync(testSh)) return [];
  const src = fs.readFileSync(testSh, "utf8");
  const patterns = new Set<string>();
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*#\s*@static-object\s+(.+)$/);
    if (m) {
      for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) patterns.add(tok);
    }
  }
  return [...patterns];
}

// ── AC51 文档类（pre-commit 检查）───────────────────────────────────────────────────────────────────

/**
 * Doc-class object patterns — the union of `# @static-object` annotations in scripts/test.sh's
 * run_doc_checks() body (AC51 断言面拆分, SPEC §13.2 — the doc-consistency checkers moved to
 * pre-commit). A missing run_doc_checks() / missing test.sh ⇒ [] (nothing excluded — conservative:
 * a non-quay workspace has no doc checks to move, so nothing drops out of the assertion surface).
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
 * The concrete DOC files excluded from the running-round assertion surface under AC51: tracked
 * files that are (a) markdown documents (`.md`, incl. CLAUDE.md) AND (b) match a doc-class object
 * pattern. The doc checkers' NON-doc objects (their own `.ts` / `.test.mjs` implementations) are
 * deliberately NOT excluded — those are code still read by the running suite (their unit tests run
 * in the glob), so modifying them during a round must stay blocked.
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

// ── 断言面集合 ───────────────────────────────────────────────────────────────────────────────────────

export interface RegistryShape {
  version?: number;
  patterns?: string[];
  [k: string]: unknown;
}

/**
 * 断言面集合 = 实证闯祸类 ∪ @static-object 聚合 ∪ 注册表派生面（外层裁定 B 修正收窄 seed patterns）。
 * 守卫只读注册表（A0b③ 生成，非手工维护）：
 *   - 注册表存在、可解析、patterns 为非空数组 ⇒ 用其 patterns 对全 tracked 文件求交（registry 分支）；
 *   - 缺失 / 空 / 不可解析 ⇒ 回退「实证闯祸类 + 判定对象声明」：
 *       tasks/**（round 60/63/67 全在这）+ plugin/loop/**（cp 事故面）
 *       + scripts/test.sh 的 @static-object 聚合（套件检查器的判定对象；含 orchestration/*-tick-core.md）
 *     ——不再回退全 tracked（4113/4316 实测不可用，ruling B）。
 *   - AC51 起两个分支都再剔除 docClassFiles()（run_doc_checks 的 `# @static-class doc` 对象里
 *     的 .md 文档）——文档检查已移到 pre-commit，不再被套件读取，编辑文档不再使在跑的轮变红。
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

// ── 状态读取（fail-loud）─────────────────────────────────────────────────────────────────────────────

/**
 * 读 .quay/full-suite-state.json。
 * 缺失 / 不可解析 ⇒ 返回 { stateFile: null }（调用方必须 fail-loud 拒绝——参照系缺失时谓词必须崩）。
 */
export function readSuiteState(root: string): { stateFile: string | null; data: Record<string, unknown> | null } {
  const p = path.join(root, STATE_FILE_REL);
  if (!fs.existsSync(p)) return { stateFile: null, data: null };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    return { stateFile: p, data };
  } catch {
    return { stateFile: null, data: null };
  }
}

// ── 主判定 ───────────────────────────────────────────────────────────────────────────────────────────

export function judge(
  root: string,
  opts: { allowDirtyRound: boolean; staged?: string[]; merge?: boolean } = { allowDirtyRound: false },
): Verdict {
  const allowOverride = opts.allowDirtyRound;
  // merge 上下文（pre-merge-commit 钩子 / --merge）：判定逻辑与 commit 完全一致（stagedFiles() 在
  // pre-merge-commit 时刻读 git diff --cached = merge 引入的文件集），仅消息与台账标注 kind 区分。
  const mergeContext = opts.merge === true;

  const { stateFile, data } = readSuiteState(root);
  const surface = resolveAssertionSurface(root);
  const staged = opts.staged ?? stagedFiles(root);

  // A. 文档类检查（AC51 断言面拆分——文档检查在提交这一刻跑，不进全量套件）。失败 ⇒ 拒。
  //    失败输出含检查器打印的文件+行号 = 补救位置（SPEC §13.4）。--allow-dirty-round 只覆盖 B
  //    （轮窗口风险），不覆盖 A（文档内容错误）。
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
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: false,
      registryMode: surface.mode,
      docCheckOutput: docResult.output,
    };
  }

  // B. 轮窗口门（AC6 显式覆盖有记录可追责，不静默绕过）——作者显式接受一切不确定性
  // （含 state 缺失/fail-loud 情形）。reason 恒定 allow-dirty-round-override，可追责。
  if (allowOverride) {
    return {
      verdict: "allow",
      reason: "allow-dirty-round-override",
      message: "pre-commit 守卫：--allow-dirty-round 显式覆盖——本次提交进入 running 轮窗口，已记录可追责。",
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: true,
      registryMode: surface.mode,
    };
  }

  // fail-loud（AC2）：state 文件缺失 / 不可解析 ⇒ 拒。不给看似合理的值（"无文件=没在跑" 是假装有参照系）。
  if (stateFile === null || data === null) {
    return {
      verdict: "reject",
      reason: "state-file-missing",
      message:
        "pre-commit 守卫：.quay/full-suite-state.json 缺失或不可解析——参照系缺失，谓词必须崩（fail-loud）。\n" +
        "无法证明当前没有轮在跑；拒绝提交。若你确认这是刻意维护的缺口，用 --allow-dirty-round 显式覆盖。",
      state: null,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: false,
      registryMode: surface.mode,
    };
  }

  // fail-loud（AC2）：state 字段缺失 / null ⇒ 拒。
  const state = data.state;
  if (typeof state !== "string" || state.length === 0) {
    return {
      verdict: "reject",
      reason: "state-null",
      message:
        "pre-commit 守卫：state 文件存在但 state 字段缺失/null——参照系缺失，谓词必须崩（fail-loud）。\n" +
        "无法证明当前没有轮在跑；拒绝提交。",
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: false,
      registryMode: surface.mode,
    };
  }

  // 轮是否在跑（early-red 完备：state=red 但 finishedAt=null 时 runner 仍活收集，同样触守卫）。
  // finishedAt 是权威「轮结束没有」字段（与 parseTerminalFinishedAt 同判据）。
  const isRunning = state === RUNNING || data.finishedAt == null;
  if (!isRunning) {
    return {
      verdict: "allow",
      reason: "not-running",
      message: `pre-commit 守卫：state=${state}, finishedAt=${data.finishedAt ?? "null"}，无运行中的轮，放行。`,
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: false,
      registryMode: surface.mode,
    };
  }

  const touchedAssertion = staged.filter((f) => surface.files.includes(f));

  if (touchedAssertion.length > 0) {
    const startedAt = data.startedAt ?? "unknown";
    const runId = data.runId ?? "unknown";
    const kind = mergeContext ? "merge" : "commit";
    // 拒绝记录：append 一行到 .quay/precommit-guard-rejections.jsonl（runtime-state，gitignored）。
    // 写失败不阻拒绝（append 是观测记录，不是闸门本体——fail-closed 冲突在此处单向：拒必须发生）。
    appendRejection(root, { at: new Date().toISOString(), runId, startedAt, files: touchedAssertion, verdict: "reject", kind });
    return {
      verdict: "reject",
      reason: "running-round-assertion-surface",
      message:
        `pre-commit 守卫：一轮正在跑（state=${data.state}, finishedAt=${data.finishedAt ?? "null"}, runId=${runId}, startedAt=${startedAt}），` +
        `本次${kind}触及断言面文件（${touchedAssertion.length} 个），会使该轮结论不可用。\n` +
        `用 --allow-dirty-round 显式覆盖，或等终态（green/red）后再${mergeContext ? "merge" : "提交"}。\n` +
        "拒绝文件：" + touchedAssertion.slice(0, 10).join(", ") +
        (touchedAssertion.length > 10 ? ` …(+${touchedAssertion.length - 10})` : "") + "\n" +
        preflightChecklist(),
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion,
      override: false,
      registryMode: surface.mode,
    };
  }

  return {
    verdict: "allow",
    reason: "no-assertion-surface-touched",
    message: "pre-commit 守卫：轮在跑，但本次提交不触及断言面文件，放行。",
    state: data,
    stateFile,
    assertionSurface: surface.files,
    staged,
    touchedAssertion: [],
    override: false,
    registryMode: surface.mode,
  };
}

/** 守卫拒绝后给作者的预检清单（等待期可做、只读、可反复）——强制等待让预检可做。 */
/**
 * 拒绝记录：append 一行到 <root>/.quay/precommit-guard-rejections.jsonl。
 * 纯观测（runtime-state，gitignored）——写失败绝不影响闸门判定（append 失败 ⇒ 忽略，拒绝照常发生）。
 */
export function appendRejection(root: string, rec: { at: string; runId: string; startedAt: string; files: string[]; verdict: "reject"; kind?: "commit" | "merge" }): void {
  try {
    const dir = path.join(root, ".quay");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "precommit-guard-rejections.jsonl"), JSON.stringify(rec) + "\n", "utf8");
  } catch {
    // 写失败不阻拒绝（观测记录丢失不改变拒绝结论）。
  }
}

export function preflightChecklist(): string {
  return (
    "预检清单（等待期可做，只读，可反复）：\n" +
    "  1. 等该轮终态：state 文件转 green/red 后再提交（最安全）。\n" +
    "  2. 看进度：tail -f .quay/full-suite.log（该轮 stdout 日志）。\n" +
    "  3. 只读复核：读任务/读 diff/审阅已落地的 commit（git log）。\n" +
    "  4. 若确需立即提交且确认无害：显式 QUAY_ALLOW_DIRTY_ROUND=1 git commit …（有记录可追责）。"
  );
}

// ── 钩子安装/卸载 ────────────────────────────────────────────────────────────────────────────────────

function hookShim(root: string): string {
  return [
    "#!/usr/bin/env bash",
    `# ${HOOK_FINGERPRINT} — installed by plugin/scripts/precommit-guard.ts --install-hook`,
    "# pre-commit guard: ① runs the DOC-CLASS checks at commit time (AC51 断言面拆分 — doc checks",
    "# are no longer in the full suite, so editing docs no longer makes a running round red);",
    "# ② rejects commits while a suite round is running AND the commit touches code-class",
    "# assertion-surface files (covers ALL writers — the shared hook, not an agreed participant list).",
    "# Round-window override (recorded, not silent): QUAY_ALLOW_DIRTY_ROUND=1 git commit …",
    "# (the override does NOT bypass doc-check failures — those are content errors, not round risk).",
    'ROOT="$(git rev-parse --show-toplevel)"',
    `exec node --no-warnings --experimental-strip-types "$ROOT/plugin/scripts/${HOOK_FINGERPRINT}" --root "$ROOT"`,
    "",
  ].join("\n");
}

/**
 * The pre-merge-commit hook shim (merge-path coverage, gap-precommit-guard-merge-bypass). git runs
 * pre-merge-commit for `git merge --no-ff` after carrying out the merge and BEFORE creating the merge
 * commit (pre-commit is NOT fired for merges — git-merge does not go through git-commit's hook path;
 * the task's empirical test: 2 commits → 2 fires / 1 merge → 0 fires). At that moment the index holds
 * the merged result, so the guard's stagedFiles() read (`git diff --cached`) IS the merge's incoming
 * file set — the SAME judge() logic applies; `--merge` only relabels the message/ledger kind.
 */
export function preMergeCommitShim(root: string): string {
  return [
    "#!/usr/bin/env bash",
    `# ${HOOK_FINGERPRINT} — installed by plugin/scripts/precommit-guard.ts --install-hook`,
    "# pre-merge-commit guard: ① runs the DOC-CLASS checks at merge time (AC51 断言面拆分);",
    "# ② rejects MERGES while a suite round is running AND the merge lands code-class assertion-surface",
    "# files (git merge --no-ff does NOT fire pre-commit — this hook is the merge-path coverage,",
    "# gap-precommit-guard-merge-bypass; round 123's mid-round fan-in merge was the live sample).",
    "# Round-window override (recorded, not silent): QUAY_ALLOW_DIRTY_ROUND=1 git merge …",
    "# (the override does NOT bypass doc-check failures — those are content errors, not round risk).",
    'ROOT="$(git rev-parse --show-toplevel)"',
    `exec node --no-warnings --experimental-strip-types "$ROOT/plugin/scripts/${HOOK_FINGERPRINT}" --root "$ROOT" --merge`,
    "",
  ].join("\n");
}

export function installHook(root: string): string {
  const gd = gitDir(root);
  const hooksDir = path.join(gd, "hooks");
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
  // NOT fire pre-commit, so the merge path needs its own hook. Same guard, --merge context.
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
  const gd = gitDir(root);
  const hooksDir = path.join(gd, "hooks");
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

const USAGE = `precommit-guard.ts — 写入那一刻的守卫：① 文档类检查（AC51 断言面拆分）；② 拒绝「轮
running 且触及（代码类）断言面」的提交/merge（覆盖全部写入者；merge 路径经 pre-merge-commit 钩子，
gap-precommit-guard-merge-bypass）

用法:
  node --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
       [--allow-dirty-round] [--install-hook] [--uninstall-hook] [--json] [--merge] [--help]

参数:
  --install-hook      把 <git-dir>/hooks/pre-commit 与 <git-dir>/hooks/pre-merge-commit 写成调用
                      本守卫的 shim（幂等；pre-merge-commit 带 --merge）
  --uninstall-hook    移除上述两个钩子中的本守卫 shim（幂等）
  --merge             本轮判定在 merge 上下文（pre-merge-commit 钩子传此 flag；判定逻辑与 commit
                      一致，仅消息与台账 kind 标注）
  --allow-dirty-round 显式覆盖轮窗口门 B（等价 QUAY_ALLOW_DIRTY_ROUND=1；有记录可追责；
                     不覆盖文档类检查 A——那是内容错误，不是轮风险）
  --json              机器可读输出（{verdict, reason, message, docCheckOutput, merge, ...}）
  --help              本帮助

退出码: 0=放行 1=拒（doc-check-failed / running+断言面 / fail-loud 缺失/null） 2=用法/环境错`;

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let root: string | null = null;
  let allowDirtyRound = false;
  let json = false;
  let install = false;
  let uninstall = false;
  let mergeContext = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") {
      root = args[++i] ?? null;
    } else if (a === "--allow-dirty-round") {
      allowDirtyRound = true;
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

  // 环境变量显式覆盖（pre-commit 钩子不传参数，只能经 env 给出）。
  if (process.env.QUAY_ALLOW_DIRTY_ROUND === "1" || process.env.QUAY_ALLOW_DIRTY_ROUND === "true") {
    allowDirtyRound = true;
  }

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
    verdict = judge(root, { allowDirtyRound, merge: mergeContext });
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
          state: verdict.state,
          finishedAt: verdict.state?.finishedAt ?? null,
          isRunning: verdict.state != null && (verdict.state.state === "running" || verdict.state.finishedAt == null),
          assertionSurfaceCount: verdict.assertionSurface.length,
          staged: verdict.staged,
          touchedAssertion: verdict.touchedAssertion,
          override: verdict.override,
          registryMode: verdict.registryMode,
          docCheckOutput: verdict.docCheckOutput ?? null,
          merge: mergeContext,
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
    return fs.realpathSync(path.resolve(entry)) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  process.exit(main());
}

export { repoRoot, gitDir, hookShim };
